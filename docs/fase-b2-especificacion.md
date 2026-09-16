# FASE B2 — Especificación cerrada de la cola de eventos

**Nada implementado. Ningún SQL, ningún esquema, ningún dato, ningún despliegue.**
Documento pensado para que otro desarrollador lo implemente sin tomar decisiones
adicionales, y para la revisión independiente posterior.

Base: producción v7.451; rama v7.452 (`b1-cerrada`) con la cola de ficha ya
construida y probada.

---

## 1 · Decisión de idempotencia

### 1.1 · Una corrección al contrato propuesto, antes de cerrarlo

El contrato pedía:

> *Mismo `event_id` + distinto `auth_user_id` → **rechazo de seguridad**.*

**Ese rechazo no se puede tener a la vez que la protección contra el «quemado» de
identificadores, y además no hace falta.** Las dos formas posibles de unicidad son
excluyentes:

| | `UNIQUE (evento_id)` global | `UNIQUE (auth_user_id, evento_id)` |
|---|---|---|
| Reutilizar el id de otro | **rechazado** | se inserta como fila **propia** |
| **Quemar el id de otro** antes de que lo envíe | **posible**: Bruno gasta el UUID de Ana y el evento real de ella se descarta como duplicado | **imposible** |
| Espacio de ids | compartido entre empleados | privado de cada identidad |

Con la unicidad por identidad **no hay apropiación que rechazar**: el
`auth_user_id` lo pone el servidor desde el token firmado, así que si Bruno manda
el `event_id` de Ana, lo único que consigue es **registrar un evento suyo** con un
UUID que casualmente coincide. No toca el de Ana, no lo invalida y no lo bloquea.

**Decisión: `UNIQUE (auth_user_id, evento_id)`.** El caso «mismo id, distinto
dueño» deja de ser un ataque y pasa a ser un no-evento. Lo que el contrato llamaba
«intento de apropiación» **es imposible por construcción**, que es mejor que
detectable.

### 1.2 · Estrategia de escritura: `INSERT` simple

Tres candidatas, y dos se descartan por motivos concretos:

| Estrategia | Duplicado devuelve | Por qué no / por qué sí |
|---|---|---|
| `resolution=merge-duplicates` (upsert) | 200 + la fila | **Descartada**: *sobrescribiría* el evento existente. El caso «mismo id, contenido distinto» reescribiría historia en silencio. Un hecho no se actualiza |
| `resolution=ignore-duplicates` | 201 + `[]` | **Descartada**: hace que «cero filas» signifique *ya estaba*, cuando en la cola de ficha significa **rechazo**. Dos significados para la misma señal en el mismo cliente es cómo se cuelan los fallos |
| **`INSERT` simple, sin cabecera de resolución** | **409 / `23505`** | **Elegida**: el duplicado es explícito y tiene su propio código. «Cero filas» conserva **un solo significado en toda la aplicación: rechazo** |

### 1.3 · El contrato cerrado

```
POST /rest/v1/{scores|actividad}?select=id
Prefer: return=representation
body: { evento_id, …datos }        ← sin employee, sin venue, sin auth_user_id
```

| Caso | HTTP | Cuerpo | Autoridad | Cliente hace |
|---|---|---|---|---|
| Primer envío | **201** | `[{"id":"…"}]` | servidor | **desencola** |
| Reintento del mismo evento, mismo dueño | **409** `23505` | error | servidor (`UNIQUE`) | **desencola** — éxito idempotente |
| Mismo `event_id`, contenido distinto | **409** `23505` | error | servidor | **desencola** y **anota la discrepancia** (§1.4) |
| `event_id` de otro empleado | **201** | fila propia | servidor (`DEFAULT`) | desencola. No afecta al de nadie |
| Rechazo de política | **403** / `42501` | error | servidor | **cuarentena** |
| Cero filas (no debería ocurrir con `INSERT`) | 2xx + `[]` | — | servidor | **cuarentena**: es un rechazo |
| Sesión caducada | **401** | — | servidor | **reintentable** |
| 5xx, red, timeout | — | — | — | **reintentable** |

**El cliente nunca decide si algo es duplicado.** Sólo traduce lo que el servidor
le dice. El `evento_id` es opaco para él: no lo compara, no lo busca, no lo juzga.

### 1.4 · «Mismo id, contenido distinto»

El servidor conserva **el primero** y rechaza el segundo. Es lo correcto: el
primero es el hecho real y el segundo sólo puede venir de un fallo del cliente.

Pero **no se traga en silencio**: el cliente lo desencola *y* deja una anotación
en cuarentena con motivo `contenido-divergente`, para que el fallo sea
diagnosticable. No es pérdida —la fila existe— es una alarma.

---

## 2 · Decisión de límites de cola

La cola de ficha es un **conjunto por nombre** y no crece. La de eventos crece con
cada hecho, y ésa es la diferencia que obliga a poner límites.

### 2.1 · Los números

| | Valor | Razón |
|---|---|---|
| Máximo de eventos | **500** | Un turno intenso genera del orden de 10 hechos. 500 son ~50 días sin red |
| Tamaño máximo | **512 KB** | Un evento ronda los 200-300 bytes. Se aplica el que se alcance antes |
| Reserva para evaluaciones | **los últimos 100 huecos** | Al llegar a 400 se dejan de aceptar eventos de prioridad baja, y los 100 restantes quedan sólo para evaluaciones |

> Los tres números son **parámetros, no dogmas**, y deben validarse en un móvil
> real antes de fijarlos. `txoko_data_v4` ya consume parte de la cuota de 5-10 MB.

### 2.2 · Qué pasa al llegar al límite

**Regla que no se rompe: nunca se descarta en silencio una evaluación ni un
simulacro de alérgenos.** Ni por antigüedad, ni por espacio, ni por nada.

| Situación | Comportamiento |
|---|---|
| Cola por debajo de 400 | todo entra |
| Entre 400 y 500 | **sólo entran evaluaciones**. Los de prioridad baja (juegos, práctica) se descartan **al encolar**, contándolos en un `descartados_por_espacio`, y el chip lo dice |
| Cola llena de evaluaciones (500) | **estado `bloqueada`**. No se descarta nada. Se avisa al empleado con un mensaje que no se puede ignorar, y **se sigue guardando lo local**: el progreso de la ficha no depende de esta cola |
| Vuelve la conexión | el vaciado normal la drena; al bajar de 400 se vuelve a aceptar todo |
| Sigue offline días | la cola se llena, se bloquea y avisa. **No se pierde ninguna evaluación**, sólo se dejan de aceptar nuevas, y eso el empleado lo sabe |
| Permanentemente llena | no puede ocurrir si hay red alguna vez. Si ocurre, es una incidencia que hay que ver, y para eso está el aviso |

**El descarte al encolar es explícito, visible y justificable**, y sólo alcanza a
juegos y prácticas. Nunca a una evaluación.

### 2.3 · Estados de un evento — vocabulario cerrado

| Estado | Significado | Dónde vive |
|---|---|---|
| `pendiente` | creado, aún no enviado | cola |
| `enviando` | petición en vuelo | cola + cerrojo en memoria |
| `confirmado` | 201 con fila | se desencola |
| `duplicado` | 409 `23505` — ya estaba | se desencola (éxito idempotente) |
| `retenido` | su `uid` no es el de la sesión actual | cola, sin intentar |
| `irrecuperable` | 403/42501, cero filas, o `uid` nulo tras la fase D | **cuarentena** |
| `descartado` | prioridad baja rechazado al encolar por espacio | contador + aviso |
| **cola `bloqueada`** | 500 evaluaciones sin enviar | estado de la cola, no del evento |

---

## 3 · Inventario definitivo de eventos

Todo puede ocurrir sin red: es una PWA con el armazón cacheado. La columna «se
genera offline» es **sí** en todos los casos y no la repito.

| Hecho | Línea | Tipo | Debe persistir | Endpoint hoy | Fuente hoy | Prioridad |
|---|---|---|---|---|---|---|
| **Simulacro de alérgenos** | 25128 | evaluación | **sí** | `scores` + `actividad` | **ninguna otra** | **1 — crítica** |
| Examen general | 21894 | evaluación | sí | `scores` + `actividad` | `sessions_data` (83 %) | 2 |
| Examen de sala | 12214 | evaluación | sí | `actividad` | ninguna | 2 |
| Examen LQA | 29499 | evaluación | sí | `actividad` | ninguna | 2 |
| Situaciones LQA | 29699 | evaluación | sí | `actividad` | ninguna | 2 |
| Auditor LQA | 29959 | evaluación | sí | `actividad` | ninguna | 2 |
| Servicio fantasma | 30275 | evaluación | sí | `actividad` | ninguna | 2 |
| Quiz de vinos | 20181 | evaluación | sí | `actividad` | ninguna | 2 |
| Maridaje | 20718 | evaluación | sí | `actividad` | ninguna | 2 |
| Repaso / SRS | 8403 | práctica | conveniente | `actividad` | el estado SRS va en la ficha | 3 |
| Recorrido de carta | 6140 | práctica | conveniente | `actividad` | ídem | 3 |
| Reto del día | 9372 | práctica | conveniente | `actividad` | `extras.dq` en la ficha | 3 |
| Survivors | 32290 | juego | **no** | `actividad` | — | 4 |
| Mr. Shoesmith | 32678 | juego | **no** | `actividad` | — | 4 |
| **Récord Txoko** | 32677* | récord | **no** | `scores` | `employees.txoko_record` | 4 |
| **Récord El Turno** | 32289* | récord | **no** | `scores` | — | 4 |

\* llamadas a `supaInsertTxokoRecord` / `supaInsertEtRecord`.

**Prioridad 1-2 = evaluaciones: nunca se descartan.**
**Prioridad 3 = prácticas: se descartan al encolar sólo por espacio, contándolas.**
**Prioridad 4 = juegos y récords: no entran en la cola.**

### Por qué los 254 récords de juego NO entran

- `supaFetchTxokoTop10` y `supaFetchEtTop` sólo calculan **el máximo por persona**,
  nunca la secuencia ni las fechas.
- El máximo de Txoko **ya vive en `employees.txoko_record`**, que sí tiene cola.
- Un récord duplicado no falsea nada; un examen duplicado sí.
- `_supCargarHistorial` los **excluye explícitamente** (`_SUP_JUEGOS`, línea 25221).

Son el 59 % del volumen de `scores` y el 0 % del problema. Meterlos en la cola
sería pagar complejidad por nada.

### Qué debe preservarse exactamente de los 80 simulacros de alérgenos

Es el único hecho **sin ninguna otra red**: no entra en `sessions_data` (su
función no toca `emp.sessions`) y si se pierde, se pierde del todo. Y es la
medida de si el equipo sabe responder a un comensal alérgico.

Debe conservarse:

| Campo | De dónde | Por qué |
|---|---|---|
| identidad | `auth_user_id` del servidor | de quién es la prueba |
| `score` / `total` | el hecho | el resultado |
| `seconds` | el hecho | si respondió con criterio o al azar |
| `cat` | `meta.cat` | qué familia de alérgenos |
| **momento del HECHO** | `ts` del cliente, en `meta` | **no el de sincronización**: como evidencia, importa cuándo ocurrió |
| `competency: 'alergenos'` | fijo | para la media de seguridad |

`created_at` lo seguirá poniendo el servidor y es el momento de la escritura. **Los
dos deben coexistir**: uno es la verdad del servidor, el otro la del hecho.

---

## 4 · Decisión sobre «empleado desactivado»

### 4.1 · Cómo se representa hoy: no se representa

Las 25 columnas de `employees` son: `name, xp, streak, last_study_day,
topic_scores, known_dishes, exam_correct, sessions_count, txoko_record,
updated_at, sessions_data, duel_wins, avatar, last_active_at, pin, last_login,
achievements, extras, venue, display_name, role, nda_version, nda_signed_at,
registered_at, auth_user_id`.

**Ninguna expresa inactividad.** No hay `active`, ni `baja`, ni `estado`, ni
`deleted_at`.

### 4.2 · Lo que sí existe: borrado físico, y está roto

`supDeleteExecute(name, overlay)` hace:

```js
DELETE /rest/v1/employees?name=ilike.<name>
```

**Y eso ya no funciona.** La fase 2.5A revocó `DELETE` sobre `employees` a `anon`
y `authenticated`, y no hay política que lo ampare. La respuesta será 401/403,
`cloudOk` será `false`, y el panel enseñará *«No se pudo borrar de la nube — el
empleado podría reaparecer»*.

> **El botón de dar de baja del panel de Supervisor lleva roto desde el 12 de
> septiembre.** No lo causa B1 ni B2; lo causó la contención de 2.5A. Queda
> anotado como hallazgo, no se arregla aquí.

Y explica los 58 huérfanos: esas cuatro personas se borraron **antes** de 2.5A,
físicamente, y sus puntuaciones quedaron sueltas porque `scores` no tiene clave
ajena.

### 4.3 · Qué le pasa a la identidad Auth de un borrado

`employees.auth_user_id` → `auth.users(id)` con `ON DELETE SET NULL`, pero esa
dirección protege del borrado de la cuenta, no del de la ficha. Borrar la ficha
**deja la cuenta de Auth viva y huérfana**.

Esa cuenta queda **inerte**: el login pasa por `verify_employee_pin_sha`, que sin
fila devuelve `null` → `sin_pin`; y `sesion` devolvería `404 sin_ficha`. No puede
entrar. Pero existe, y `provisionar-identidades` la habría contado como huérfana.

### 4.4 · Eventos y bajas

| Situación | Comportamiento especificado |
|---|---|
| Eventos creados **antes** de la baja, aún en cola | Su `uid` sigue siendo válido mientras la cuenta de Auth exista. Si la persona vuelve a entrar en ese dispositivo, se sincronizan. Si no, quedan **retenidos** y acaban en cuarentena en la fase D |
| Eventos **nuevos** de alguien dado de baja | No puede generarlos: no puede entrar |
| Qué hace el servidor al sincronizarlos | **Hoy: los acepta.** No hay noción de inactividad que consultar |

### 4.5 · Requisito para una fase posterior (NO se implementa aquí)

```sql
-- REQUISITO, NO EJECUTAR
alter table public.employees add column activo boolean not null default true;
```

Con él, la baja pasa a ser `activo = false` en vez de un `DELETE`, y entonces:

- el historial deja de quedarse huérfano;
- el ranking puede filtrar (`Ana Kurzweil` dejaría de empatar en el primer puesto);
- las políticas de RLS pueden añadir `and e.activo`;
- el panel vuelve a tener un botón que funciona, sin necesitar `DELETE`.

**Es prerequisito de un RLS que distinga a quien está de baja, y no lo es de B2.**
B2 funciona sin él.

---

## 5 · Matriz de casos de seguridad

| # | Caso | Resultado | Autoridad | ¿Reintenta? | ¿Conserva? | ¿Irrecuperable? |
|---|---|---|---|---|---|---|
| 1 | Ana crea offline → Ana sincroniza | 201, fila de Ana | servidor | — | se desencola | no |
| 2 | Ana crea → logout → Bruno entra → sincroniza | **no se envía** | **cliente** (filtro por `uid`) | cuando vuelva Ana | **sí, retenido** | no |
| 3 | Atacante cambia el `uid` local | la petición sale y el servidor la registra **a nombre de quien firma el token** | **servidor** (`DEFAULT`) | — | — | no: no hay daño |
| 4 | Atacante cambia `employee` | **el campo no viaja**; lo pone el `DEFAULT` | servidor | — | — | no |
| 5 | Atacante cambia `venue` | ídem | servidor | — | — | no |
| 6 | El token de Ana expira | 401 | servidor | **sí** | sí | no |
| 7 | Ana renueva sesión → sincroniza | 201 | servidor | — | se desencola | no |
| 8 | Ana manda el mismo evento dos veces | 201 y luego **409** | servidor (`UNIQUE`) | no | se desencola | no |
| 9 | Mismo `event_id`, contenido distinto | **409**; queda el primero | servidor | no | se desencola **+ anotación** `contenido-divergente` | no |
| 10 | Bruno reutiliza el `event_id` de Ana | 201 **como evento de Bruno**; el de Ana intacto | servidor | — | — | no |
| 11 | Acepta → se pierde la respuesta → reintento | **409** | servidor | no | se desencola | no |
| 12 | Dos sincronizaciones concurrentes | una 201, otra 409 | servidor (`UNIQUE`) | no | se desencola | no |
| 13 | Empleado dado de baja con eventos pendientes | **hoy se aceptan**; con `activo` serían rechazados | servidor | — | retenidos si no vuelve | en la fase D, sí |
| 14 | Evento de empleado sin identidad Auth | **no puede existir**: sin identidad no hay login | — | — | — | — |
| 15 | Evento anterior a B1 | **no existe**: la cola de eventos nace en B2 | — | — | — | — |
| 16 | Cola llena | `bloqueada`; nada se descarta; aviso visible | cliente | sí al drenar | **sí, todo** | no |
| 17 | `_beaconSync` al cerrar la pestaña | **no toca eventos**; sólo el snapshot | cliente | — | la cola los conserva | no |

**Lectura de la matriz:** en once de los diecisiete la autoridad es el **servidor**.
El cliente sólo es autoridad en dos —el filtro por `uid` y el tope de cola— y en
los dos su fallo produce *retención*, nunca atribución errónea.

---

## 6 · Especificación final del evento

```js
{
  v: 2,                        // versión del formato; una v mayor no se toca ni se borra
  tipo: 'evento',              // lo distingue de las entradas de ficha ('estado')
  destino: 'scores' | 'actividad',
  evento_id: '<uuid v4>',      // crypto.randomUUID() EN EL MOMENTO DEL HECHO
  uid: '<auth.uid()>',         // de la sesión que lo vivió; congelado, nunca reconstruido
  prioridad: 1 | 2 | 3,        // 1 alérgenos · 2 evaluación · 3 práctica
  ts: 1789430000000,           // Date.now() del hecho
  intentos: 0,                 // diagnóstico; no decide nada
  datos: { … }                 // SIN employee, SIN venue, SIN auth_user_id
}
```

`datos` para `scores`: `{ score, total, topic, cat, time_sec }`.
`datos` para `actividad`: `{ activity, competency, kind, score, total, seconds, meta }`,
con `meta.ts_hecho` para el momento real (§3).

**Almacén:** la misma clave `txk_cola_v2` de B1, el mismo `_colaCargar`, el mismo
vaciado. **No es una cola paralela**: son entradas de otro `tipo`.

**Invariante que gobierna todo:** *la identidad del evento se congela cuando
ocurre y el servidor la vuelve a poner por su cuenta al escribir.* `currentUser`,
`nombre`, `venue` y `rol` no intervienen en ningún punto, ni al crear, ni al
enviar, ni al resolver.

---

## 7 · Máquina de estados

```
                    (ocurre el hecho)
                           │  evento_id = randomUUID(), uid = _authUid
                           ▼
    cola llena? ──sí, prioridad 3──►  descartado  (contado + aviso)
    cola llena? ──sí, prioridad 1-2─►  bloqueada  (nada se descarta, aviso)
          │ no
          ▼
     ┌─ pendiente ─┐
     │             │ uid ≠ sesión actual
     │             └──────────────►  retenido ──(vuelve su dueño)──┐
     │                                                             │
     │ uid = sesión actual                                         │
     ▼                                                             │
  enviando ◄─────────────────────────────────────────────────────┘
     │
     ├─ 201 ─────────────────────────►  confirmado   → fuera de la cola
     ├─ 409 / 23505 ─────────────────►  duplicado    → fuera de la cola
     ├─ 401 · 5xx · red · timeout ───►  pendiente    (reintenta)
     └─ 403 · 42501 · 2xx con [] ────►  irrecuperable → CUARENTENA
```

**Las transiciones que NO existen, a propósito:** `retenido → confirmado` sin que
vuelva su dueño; `pendiente → fuera de la cola` sin respuesta del servidor;
`irrecuperable → borrado`.

---

## 8 · Estrategia de sincronización

**Disparadores:** los mismos de B1 — `online`, `visibilitychange`, temporizador de
120 s, y 4 s tras arrancar. **No se añaden disparadores nuevos.**

**Orden:** por `prioridad` ascendente y luego por `ts` ascendente. Los alérgenos
salen primero; dentro de cada prioridad, lo más antiguo primero.

**Reintentos:** no hay temporizador propio. El vaciado periódico **es** el
reintento — es lo que B1 estableció al retirar los `setTimeout` internos, que
sobrevivían al cambio de usuario. `intentos` se incrementa sólo como diagnóstico.

**Concurrencia:** un cerrojo en memoria por pestaña, como en B1. Dos pestañas
pueden enviar a la vez; el `UNIQUE` lo absorbe.

**Lote:** en serie, uno a uno. Sin envíos por lotes: un lote que falla a medias
es indistinguible de uno que falla entero, y eso reintroduce ambigüedad.

---

## 9 · Migración de colas antiguas

**Decisión mantenida: no se adopta heurísticamente ningún evento antiguo.**

**Matiz importante:** la cola de eventos **nace en B2**, así que **no hay eventos
antiguos que migrar**. Lo que hay que migrar son las entradas de **ficha** del
formato 1, y eso ya está resuelto en B1.

| Pregunta | Respuesta |
|---|---|
| **Cuánto dura la ventana** | Desde que se publique B1 hasta el primer `revoke` de la fase D. En la práctica, días: la cola de ficha se vacía sola con un solo servicio con cobertura |
| **Qué puede sincronizar todavía la versión antigua** | Todo: mientras `anon` conserve permisos, un dispositivo con v7.451 sigue funcionando igual |
| **Al retirar `anon`** | Las entradas `uid:null` dejan de poder enviarse → pasan a cuarentena |
| **Cómo se detectan** | `_colaCargar()` las marca con `uid:null` y `v:1` |
| **Cómo pasan a cuarentena** | `_cuarentenaPoner(entrada, 'sin-identidad')`, con fecha y motivo |
| **Cómo se informa** | El chip de sincronización deja de decir «sincronizado» y ofrece ver qué hay pendiente y de quién |
| **Cómo evitamos que «cuarentena» sea pérdida** | Tres cosas: **no se borra nunca**, **se cuenta y se enseña**, y **se puede recuperar** si esa persona vuelve a entrar en ese dispositivo |

**Precondición dura de la fase D:** no se retira `anon` mientras queden entradas
`uid:null` pendientes en el parque de dispositivos. Se comprueba antes.

---

## 10 · Requisitos de servidor y RLS futuro

Ninguno se crea ahora. Todos son requisitos descritos.

```sql
-- REQUISITOS. NO EJECUTAR.

-- (1) Identidad y clave de evento
alter table public.scores    add column evento_id uuid, add column auth_user_id uuid default auth.uid();
alter table public.actividad add column evento_id uuid, add column auth_user_id uuid default auth.uid();

-- (2) La idempotencia, atada a la identidad
create unique index concurrently scores_evt_uk
  on public.scores (auth_user_id, evento_id) where evento_id is not null;
create unique index concurrently actividad_evt_uk
  on public.actividad (auth_user_id, evento_id) where evento_id is not null;

-- (3) LA PIEZA SIN LA CUAL TODO LO ANTERIOR ES DECORATIVO
revoke insert (auth_user_id) on public.scores    from anon, authenticated;
revoke insert (auth_user_id) on public.actividad from anon, authenticated;

-- (4) Y lo mismo para el resto de la identidad (depende de la fase C)
alter table public.scores    alter column employee set default app.mi_nombre(),
                             alter column venue    set default app.mi_venue();
revoke insert (employee, venue) on public.scores from anon, authenticated;
-- ídem en actividad

-- (5) La política
create policy scores_alta_propia on public.scores
  for insert to authenticated with check ( auth_user_id = auth.uid() );
```

**Ninguna función `SECURITY DEFINER` nueva.** Las dos de la fase C
(`app.mi_nombre()`, `app.mi_venue()`) bastan, y son las que ya estaban diseñadas.

### Demostración de las siete garantías pedidas

| Garantía | Qué la produce |
|---|---|
| Sólo crea eventos propios | `with check (auth_user_id = auth.uid())` |
| No puede inventar `auth_user_id` | **`revoke insert (auth_user_id)`** — sin él, el `DEFAULT` es decorativo |
| No puede cambiar de propietario | no hay política de `UPDATE`; y el `INSERT` no acepta esa columna |
| No puede cambiar `venue` | `revoke insert (venue)` + `DEFAULT app.mi_venue()` |
| Un duplicado legítimo es idempotente | `UNIQUE (auth_user_id, evento_id)` → 409, que el cliente trata como éxito |
| El `event_id` de otro se rechaza | **no se rechaza: se vuelve suyo.** Y eso es *más* seguro que rechazarlo, porque elimina el quemado (§1.1) |
| `auth.uid()` es la fuente de autoridad | sale del `sub` de un JWT firmado por GoTrue; el cliente no lo escribe en ningún punto |

---

## 11 · Tests que deben existir antes de implementar

**Positivos**

1. Ana crea offline y sincroniza → 1 fila, desencolada.
2. Reintento del mismo evento → 409 → desencolado, **1 sola fila**.
3. Orden de salida: alérgenos antes que práctica.
4. Token renovado a mitad del vaciado → sincroniza igual.
5. 300 eventos sin red → se envían todos, sin duplicar.
6. La cola sobrevive a cerrar la pestaña.

**Negativos**

7. Ana crea → Bruno entra → **0 envíos** de la entrada de Ana.
8. `uid` manipulado → la fila queda a nombre de quien firma el token.
9. `employee` manipulado → el campo no viaja.
10. `venue` manipulado → ídem.
11. `event_id` de otro empleado → fila propia, la ajena intacta.
12. Mismo id, contenido distinto → 409 + anotación `contenido-divergente`.
13. Dos pestañas a la vez → 1 fila.
14. Cola llena de evaluaciones → **bloqueada**, nada descartado, aviso.
15. Cola llena y llega una práctica → descartada **y contada**, nunca en silencio.
16. Cola llena y llega un simulacro de alérgenos → **nunca se descarta**.
17. 403 → cuarentena, no reintento infinito.
18. Cero filas → cuarentena.
19. `_beaconSync` no toca la cola de eventos.

**Mutaciones obligatorias**

20. Quitar el `UNIQUE` → caen 2, 5, 11, 13.
21. Devolver el `INSERT` de `auth_user_id` → caen 8, 11.
22. Generar el `evento_id` al enviar → cae 2.
23. Quitar el filtro por `uid` → cae 7.
24. Permitir descartar evaluaciones por espacio → caen 14, 16.
25. Usar `merge-duplicates` → cae 12 (reescribiría el original).

---

## 12 · Riesgos y lo que todavía no puede cerrarse

| | Qué | Por qué no se cierra aquí |
|---|---|---|
| R1 | **Los tres números del tope** (500 / 512 KB / reserva de 100) | Hay que medirlos en un móvil real con `txoko_data_v4` ya cargado. Son parámetros, no diseño |
| R2 | **Que PostgREST devuelva `23505` y no otra cosa** en un `INSERT` duplicado con índice único parcial | Es el comportamiento documentado, pero **no lo he verificado** contra este servidor. Prueba de cinco minutos, sin tocar datos, cuando se autorice |
| R3 | **`employee` y `venue` por `DEFAULT`** dependen de la fase C | B2 funciona sin ello, pero entonces esos campos siguen viniendo del cliente |
| R4 | **«Empleado activo» no existe** | Requisito descrito (§4.5). B2 no lo necesita; un RLS que distinga bajas sí |
| R5 | **El botón de dar de baja está roto** desde 2.5A | Hallazgo, no se arregla aquí |
| R6 | **El hash del PIN sigue siendo credencial al portador** | Decidido fuera de alcance. Mientras siga así, RLS no aísla a compañeros del mismo iPad |
| R7 | **La cuarentena no tiene pantalla** | Retener sin enseñar es esconder. Hace falta, como mínimo, que el chip lo diga y se pueda tocar |

### Lo que este documento SÍ cierra

- **D1 · Idempotencia:** `INSERT` simple, `UNIQUE (auth_user_id, evento_id)`,
  409 = éxito idempotente. Y «cero filas» conserva **un único significado en toda
  la aplicación: rechazo**.
- **D2 · Tope:** 500 / 512 KB, con reserva para evaluaciones y sin descarte
  silencioso jamás.
- **D3 · Qué entra:** las nueve evaluaciones y las tres prácticas. **Fuera** los
  dos juegos y los dos récords — 254 de 427 filas de `scores`.
- **D4 · Empleado desactivado:** hoy no existe, la baja es un `DELETE` que además
  está roto, y la noción formal queda como requisito de una fase posterior.
