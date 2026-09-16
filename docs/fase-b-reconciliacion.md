# Reconciliación del diseño de la FASE B

**Nada implementado, ningún SQL de escritura, ningún cambio de esquema, ningún
despliegue.** Todas las consultas de esta reconciliación son de lectura.

---

## 0 · Lo primero: la propuesta de adopción por hash del PIN es INSEGURA, y la retiro

Me pediste no darla por buena. Al analizarla he encontrado algo más grande que la
propia propuesta.

### El hash del PIN no es una prueba de posesión: **es la credencial**

`verify_employee_pin_sha` (verificada en el servidor) compara así:

```sql
select pin into stored from public.employees where name = emp_name;
if stored = sha_hex then ... return true;
```

El valor guardado **es** el SHA-256 en hexadecimal, y la comprobación es una
igualdad de cadenas. La Edge Function `sesion` recibe `{nombre, sha}` y llama a
esa función. Por tanto:

> **Quien tenga el hash de un empleado puede obtener una sesión real de Auth a su
> nombre. No hace falta el PIN.**

### Y ese hash está en el iPad, de todos los que han entrado en él

`index.html:9981` (y 11044, 11237): al validar el login,
`empObj.pin = hashedPin`. Queda en `txoko_data_v4`, dentro de `localStorage`.
`txoko_session` guarda el mismo hash (9975). **`logout()` borra `txoko_session`
pero NO borra `DB.employees[*].pin`.**

Lo que acota el daño: `_EMP_COLS` (línea 2270) **no incluye `pin`**, así que la
nube nunca entrega el hash de otro. La exposición se limita a **las personas que
han iniciado sesión en ese dispositivo** — que es exactamente el escenario de
quiosco que quieres proteger.

### Consecuencias, en orden

1. **Mi propuesta queda retirada.** «Adoptar la entrada si el hash de la ficha
   local coincide con el que acaba de validar el login» no demuestra posesión de
   nada: demuestra saber leer `localStorage`. Bruno puede producir el hash de Ana
   igual de bien que Ana.
2. **Introduciría una segunda identidad paralela**, que es justo lo que
   preguntabas: una identidad basada en un secreto compartido del dispositivo,
   compitiendo con `auth.uid()`. Dos sistemas de identidad son peor que uno malo.
3. **Cuando cambia el PIN**, el hash guardado deja de casar y las entradas
   antiguas quedarían huérfanas para siempre, sin diagnóstico.
4. **Con sesión caducada** no cambia nada: el hash no caduca. Eso es
   precisamente el problema — es una credencial sin vencimiento.
5. **Y el hallazgo que la excede:** en un dispositivo compartido, **RLS no va a
   darte el aislamiento entre compañeros que esperas**, porque la identidad se
   puede obtener legítimamente en la capa de login con material que quedó en el
   almacén local. RLS confía en `auth.uid()`, y `auth.uid()` es obtenible.

**El espacio de PIN son 4 dígitos: 10 000 combinaciones.** El limitador (10
fallos / 15 min por nombre) hace la fuerza bruta *en línea* lenta. Pero con el
hash delante no hace falta fuerza bruta ninguna.

### Qué propongo en su lugar para la adopción

**No adoptar. No hace falta ningún heurístico.**

La ventana en que `anon` sigue teniendo permiso —toda la fase A, B y C— **es el
mecanismo de migración**. Las entradas heredadas se vacían solas por el camino de
siempre en cuestión de días. Al llegar a la fase D, lo que quede sin `uid` va a
cuarentena y se pide recuperación explícita.

Es más simple, no inventa una segunda identidad y cumple tu criterio de retener
antes que reasignar. **La complejidad de la adopción era autoinfligida.**

---

## 1 · Hallazgos aceptados

| # | Hallazgo | Estado |
|---|---|---|
| C1 | Bucle de sincronización cada 1,5 s (`index.html:3160`) | **aceptado**, medido y aislado por mutación (60 → 0) |
| C2 | 18 puntos de entrada, 1 por la cola | **aceptado** |
| C3 | Dos escrituras a ficha ajena, ambas ya inoperantes | **aceptado**, ver §3 |
| — | Adopción por nombre insegura | **aceptado**, con los datos reales |
| — | `UNIQUE` global de `event_id` permite quemar el id ajeno | **aceptado** |
| — | `return=minimal` hace que «cero filas» se lea como éxito | **aceptado** |
| — | `sessions_data`, `extras.dq`, `trophies`, `pin` | **aceptado**, ver §7 |
| — | `headers-only` no verificado | **aceptado como supuesto**, ver §8 |
| **NUEVO** | **El hash del PIN es una credencial al portador y vive en el iPad** | **hallazgo de esta reconciliación** |

## 2 · Hallazgos rechazados o corregidos

| # | Qué | Por qué |
|---|---|---|
| 1 | **Adopción por hash del PIN** (propuesta mía) | **Rechazada por mí mismo**: no es prueba de posesión. Ver §0 y §6 |
| 2 | «`sessions_data` pierde datos» | **Matizado.** Pierde el *detalle* de las sesiones del dispositivo con el array más corto; `sessions_count` sí se conserva por `max()`. Es pérdida de historial fino, no de progreso ni de XP. Cambia su prioridad |
| 3 | `UNIQUE (employee, event_id)` | **Corregido a `(auth_user_id, event_id)`.** `employee` es texto mutable, y está **demostrado** que los nombres derivan (`Estefanía`→`Estefania`). Anclar la unicidad a un nombre que cambia es repetir el error que la fase B viene a corregir |
| 4 | «El bucle es sólo un problema de rendimiento» | **Rechazado.** Es de corrección: multiplica la ventana de pérdida silenciosa por ~2 400/hora |

## 3 · Qué hacen HOY exactamente las dos escrituras ajenas

**`supaAwardSeasonTrophy(winner)` — `index.html:26961-26968`**

```js
const emp = getEmp(winner);
emp.trophies = (emp.trophies || 0) + 1;
saveDB();
await supaUpsertEmployee(winner);
```

Hoy: incrementa `trophies` **en la copia local del dispositivo del ganador… o de
quien esté mirando**, y lanza un upsert de la ficha del ganador. El payload
(3167-3184) **no contiene `trophies`**, y `_extrasCompose` tampoco. **El trofeo
nunca llega a la nube.** Lo que sí llega es un upsert de la ficha del ganador con
los datos **que haya en ESTE dispositivo**, que pueden ser viejos.

→ **Es peor que inútil: puede pisar la ficha del ganador con datos atrasados.**
La fusión monótona lo amortigua, pero el `extras` y el `sessions_data` no son
monótonos (§7).

**Reset de PIN — `index.html:24145-24151`**

```js
delete emp.pin;
saveDB();
supaUpsertEmployee(name);   // «so the reset reaches other devices»
```

Hoy: borra el hash **en local** y lanza un upsert que **no lleva `pin`** — y aunque
lo llevara, `anon` no tiene permiso de columna sobre `pin`. **El reset nunca ha
llegado a otros dispositivos ni a la nube.** El comentario describe algo que no
ocurre. Lo que sí hace es dejar al empleado sin auto-login **en ese dispositivo
concreto**.

### Qué hacer con ellas antes de RLS

| | Acción | Fase |
|---|---|---|
| `supaAwardSeasonTrophy` | **Neutralizar**: quitar el `supaUpsertEmployee(winner)`. El incremento local puede quedarse; no sube de todas formas | **B1** |
| Reset de PIN | **Quitar el `supaUpsertEmployee(name)`** y corregir el comentario, que miente | **B1** |
| Que el trofeo suba de verdad | Requiere columna o campo en `extras` + una vía de servidor | **fuera de B** |
| Que el reset llegue a otros dispositivos | Ya existe la Edge Function `reset-pin`; el panel debería usarla | **fuera de B** |

**No se corrigen ahora: se neutralizan.** Corregirlas es funcionalidad, y
funcionalidad no debe bloquear RLS.

## 4 · Correcciones al diseño B1

Acepto la división, con **una corrección de alcance y una adición**.

| # | B1 según la auditoría | Corrección |
|---|---|---|
| 1 | Romper el bucle | **sin cambios** — una línea, `index.html:3160` |
| 2 | Punto único de entrada | **sin cambios**; los 18 caminos pasan por `sincronizarFicha(nombre, uidEsperado)` |
| 3 | No leer «0 filas» como éxito | **ampliado**: también las **tres** escrituras de `scores` (2835, 2885, 2944) |
| 4 | Cola sellada con identidad | **sin cambios** |
| 5 | Cuarentena / adopción segura | **CORREGIDO: sin adopción.** Cuarentena sí; heurístico de adopción **no** (§0) |
| 6 | Neutralizar las dos ajenas | **sin cambios** (§3) |
| 7 | `_beaconSync` sin absolutos | **ampliado**: además debe respetar `_esAdmin`, que hoy se salta |
| **8** | — | **NUEVO: capturar el `uid` al lanzar y compararlo al resolver.** Sin esto, el `.then` juzga con la identidad de quien esté dentro cuando vuelve la respuesta |

**Y quitar `employee` y `venue` del cuerpo de `scores`/`actividad`** — una línea
por sitio. No es opcional: sin ello las políticas los rechazarán.

## 5 · Correcciones al diseño B2

| | Según la auditoría | Corrección |
|---|---|---|
| Cola de eventos para `scores` y `actividad` | sí | **sin cambios** |
| `event_id` UUID | sí | **sin cambios**, y debe **nacer con el hecho**, no con el envío |
| Unicidad | `(employee, event_id)` | **`(auth_user_id, event_id)`** — ver §2.3 |
| Identidad de la fila | `employee` texto | **añadir `auth_user_id uuid` a `scores` y `actividad`**, con `default auth.uid()` |
| Reintentos | sí | **sin cambios** |

**Por qué `auth_user_id` y no `employee`:** los nombres de Meseo **han derivado
de hecho** —`Estefanía`/`Estefania`, `Faride`/`Faride Navarro`,
`Alessandra`/`Aless`— y `employees.name` es la clave primaria, editable por
supervisor. Un `uuid` estable no deriva. Las 427 filas históricas se quedan con
`auth_user_id` nulo y el índice parcial las ignora.

**Esquema descrito, NO ejecutado** (requiere tu aprobación):

```sql
-- SIN EJECUTAR
alter table public.scores    add column evento_id uuid, add column auth_user_id uuid;
alter table public.actividad add column evento_id uuid, add column auth_user_id uuid;
create unique index concurrently scores_evt_uk
  on public.scores (auth_user_id, evento_id) where evento_id is not null;
create unique index concurrently actividad_evt_uk
  on public.actividad (auth_user_id, evento_id) where evento_id is not null;
```

## 6 · Riesgos de la adopción por PIN — el análisis que pediste

| Pregunta | Respuesta |
|---|---|
| **¿Qué material existe en el cliente?** | El SHA-256 del PIN, en `DB.employees[nombre].pin` y en `txoko_session.hash`, de **cada persona que ha entrado en ese dispositivo**. Sobrevive al logout |
| **¿Puede reutilizarse como credencial?** | **Sí, y ES la credencial.** `verify_employee_pin_sha` compara `stored = sha_hex`. Con el hash se obtiene una sesión real por `sesion` |
| **¿Permite suplantación?** | **Sí.** Bruno lee el hash de Ana en el iPad y entra como Ana. Sin PIN, sin fuerza bruta |
| **¿Qué pasa si cambia el PIN?** | El hash guardado deja de casar; las entradas antiguas quedan huérfanas sin diagnóstico |
| **¿Sesión caducada?** | Irrelevante: el hash no caduca. Ése es el problema |
| **¿Segunda identidad paralela?** | **Sí**, y compitiendo con `auth.uid()`. Motivo suficiente para rechazarla |
| **¿Protege un evento offline antiguo?** | **No.** Protege tan poco como el nombre, y encima da falsa sensación de rigor |

**Veredicto: retirada.** Sustituida por «no adoptar» (§0).

**Y el corolario que hay que decidir aparte:** mientras el hash siga siendo una
credencial al portador y siga guardándose en el dispositivo, **RLS no aísla a
compañeros que comparten iPad**. Aísla restaurantes, aísla a un atacante externo
con la clave pública, y aísla a quien no ha usado nunca ese aparato. Eso no es
poco, pero no es lo que parece prometer.

Mitigación mínima posible dentro de B1: **borrar `DB.employees[*].pin` al salir**.
Coste: se pierde el login local sin cobertura para esa persona en ese aparato
hasta que vuelva a entrar con red. **Es una decisión de producto, no técnica.**

## 7 · `sessions_data`, `extras.dq`, `trophies`, `pin`

| Campo | Qué le pasa | Dónde va |
|---|---|---|
| **`sessions_data`** | fusiona quedándose con el array **más largo** (3149), no con la unión. Se pierde el detalle de sesiones del dispositivo más corto; el **contador** sí sobrevive por `max()` | **Fase propia.** No lo empeora RLS ni la cola. Es un fallo de fusión, no de identidad |
| **`extras.dq`** | «gana el día más reciente»; dentro del mismo día, gana el último en escribir | **B2**, junto con la revisión de la fusión. Hoy sólo afecta a la racha del reto |
| **`trophies`** | no viaja en ningún payload; sólo local | **Fuera de B.** El `supaUpsertEmployee(winner)` que lo acompaña sí se neutraliza en **B1** |
| **`pin`** | no viaja; `anon` no tiene grant de columna | **Fuera de B** para su sincronización. Pero el **hash como credencial** (§0/§6) es una decisión aparte y **anterior** a dar por buena la promesa de aislamiento de RLS |

## 8 · Qué significa exactamente «éxito» en un upsert bajo RLS

Hoy el cliente sólo distingue `res.ok`, que es cierto en todos estos casos:

| HTTP | Qué pasó de verdad | Hoy se lee como |
|---|---|---|
| 200/201, 1 fila | escrito | éxito ✅ |
| 200/201, **0 filas** | **la política lo rechazó** | **éxito** ❌ |
| 200/201, 0 filas | ya existía (con `ignore-duplicates`) | éxito ✅ (correcto) |
| 401 | sesión caducada o revocada | fallo |
| 403 / `42501` | autorización denegada | fallo |
| 409 / `23505` | duplicado | fallo ❌ (debería ser éxito) |
| 5xx, red | reintentable | fallo |

**Definición propuesta.** «Éxito» = **el servidor confirma que la fila queda en el
estado pretendido**, y eso son dos casos: *filas afectadas ≥ 1* (escrito) o
*duplicado reconocido* (ya estaba). Todo lo demás se clasifica:

- **reintentable**: 5xx, red, timeout, 401 (la sesión se puede renovar).
- **permanente**: 403/`42501`, 4xx que no sea 409, y **0 filas sin
  `ignore-duplicates`** — porque bajo RLS eso es un rechazo.

**Cero filas deja de ser ambiguo sólo si el cliente puede contarlas.** De ahí §8
del punto siguiente.

### El experimento de `headers-only` — descrito, NO ejecutado

**Qué quiero saber:** si PostgREST, en un `POST` con
`Prefer: resolution=merge-duplicates,return=headers-only,count=exact`, devuelve
`Content-Range` con el número de filas afectadas, y si ese valor distingue 1 de 0.

**Prueba controlada propuesta, sin modificar datos:**

Un `PATCH` sobre `employees` con un filtro que **no casa con ninguna fila**:

```
PATCH /rest/v1/employees?name=eq.__inexistente_prueba__
Prefer: return=headers-only,count=exact
body: {"updated_at":"<ahora>"}
```

Cero filas por construcción, así que **no modifica nada**, y la respuesta enseña
si `Content-Range` viene y qué trae. Después, el mismo `PATCH` con
`name=eq.Duvan` y `updated_at` **al valor que ya tiene**, que es una escritura
idempotente sin efecto observable.

**No lo ejecuto sin tu autorización**, aunque el primero sea inocuo por
construcción.

**Si `headers-only` no funciona**, la alternativa es
`return=representation&select=name` — devuelve `[{"name":"Duvan"}]` o `[]`, unos
20 bytes, y distingue 1 de 0 igual de bien. **Esa alternativa no depende de
ninguna suposición** y creo que es la que hay que usar por defecto.

## 9 · Garantías necesarias antes de activar RLS

Sin estas cinco, activar políticas **destruye datos en silencio**:

1. **Ninguna escritura del cliente interpreta «0 filas» como éxito.** Aplica a
   `employees` y a las tres de `scores`. *(B1-3)*
2. **Todas las escrituras de ficha pasan por un punto único** que conoce la
   identidad esperada. *(B1-2)*
3. **Ninguna escritura del cliente apunta a la ficha de otro empleado.**
   *(B1-6)*
4. **Ninguna escritura sale con una identidad distinta de la que creó el dato**,
   ni siquiera en un `.then` tardío o un `setTimeout` de 3 s. *(B1-4, B1-8)*
5. **El bucle está roto**, porque multiplica cualquier fallo residual por ~2 400
   a la hora. *(B1-1)*

Y una que **no** es técnica: entender que **RLS no aísla a compañeros que
comparten dispositivo** mientras el hash siga siendo credencial (§6). Si esa
garantía hace falta, es una fase propia y va **antes** de prometer aislamiento.

`scores` y `actividad` **no** necesitan cola para que RLS sea seguro: hoy ya
pierden lo que ocurre sin red, y RLS no lo empeora. Sólo necesitan **dejar de
mandar `employee` y `venue`**.

## 10 · Orden de implementación propuesto

| Orden | Qué | Por qué ahí |
|---|---|---|
| **0** | Decidir §6: ¿el hash como credencial bloquea o no? | condiciona qué promete RLS |
| **1** | **B1-1** romper el bucle | una línea, efecto inmediato, medible |
| **2** | **B1-3** contar filas (con `select=name`, sin suposiciones) + taxonomía de resultados | es la red de seguridad de todo lo demás |
| **3** | **B1-2** punto único de entrada | recoge los 18 caminos |
| **4** | **B1-6** neutralizar las dos ajenas | trivial una vez existe el punto único |
| **5** | **B1-4 + B1-8** cola sellada, captura de `uid`, cuarentena | el requisito Ana/Bruno |
| **6** | **B1-7** `_beaconSync` sin absolutos y con `_esAdmin` | último de B1: es el camino más raro |
| **7** | quitar `employee`/`venue` del cuerpo de `scores`/`actividad` | precondición de las políticas |
| **8** | **Fase C de RLS** (políticas) y **D** (retirada de `anon`) | ya con red de seguridad |
| **9** | **B2** cola de eventos, `evento_id`, `auth_user_id`, reintentos | funcionalidad, sin prisa |
| **10** | Fases propias: `sessions_data`, trofeos, reset de PIN por Edge Function, empleado desactivado | |

**Los pasos 1 y 2 son los que de verdad desbloquean.** Con esos dos, cualquier
fallo posterior deja de ser silencioso, que es la única propiedad que hace segura
una migración.

---

## A.3 — la medición, separada

**No hay porcentaje, y no lo voy a inventar.** `pg_stat_statements` acumula desde
marzo y Postgres no guarda la hora de la última llamada por entrada, así que las
peticiones anónimas de hoy son indistinguibles de las de hace seis meses.

**La única forma segura de obtener una ventana real** es la diferencia entre dos
fotos **con tráfico en medio**:

```sql
select now(), r.rolname, sum(s.calls)
from pg_stat_statements s join pg_roles r on r.oid=s.userid
where s.query ilike '%pgrst_source%' group by r.rolname;
```

Ejecutada al principio y al final de un servicio (20:00 y 22:00 locales). La
resta es tráfico real, y es lectura pura.

Lo intenté hoy con 7,5 minutos y salió **cero en los tres roles**: no había nadie
usando la app. No es que no llegara nada autenticado — es que no llegó nada.

**Alternativas descartadas:** `pg_stat_statements_reset()` daría una ventana
limpia pero **destruye el histórico de estadísticas del proyecto**; no compensa.
`query_logs` sigue pendiente de aprobación y daría la respuesta directa, con hora
por petición.

**Ojo con un detalle**: ahora sabemos que el bucle C1 genera ~2 400
peticiones/hora por pestaña abierta. **Cualquier porcentaje medido antes de
romperlo estará dominado por el bucle**, no por el uso real. Conviene medir
**después** del paso 1.
