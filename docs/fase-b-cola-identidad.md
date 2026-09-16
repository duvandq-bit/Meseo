# La cola offline de Meseo, de extremo a extremo

**No se ha implementado nada en este documento, ni ejecutado SQL, ni cambiado
esquema, políticas, permisos o `sesion`, ni publicado.**

## Aviso previo: hay TRES colas distintas y conviene no mezclarlas

| | Dónde | Qué protege | Identidad |
|---|---|---|---|
| **P · Producción (v7.451)** | lo que usa el equipo hoy | el progreso de la ficha | **ninguna**: nombres sueltos |
| **B · Rama (v7.452, `b1-cerrada`, sin publicar)** | B1, ya implementada y probada | el progreso de la ficha | **`auth.uid()` de quien la creó** |
| **E · La cola de eventos** | **no existe en ninguna de las dos** | exámenes y actividad | — |

Buena parte de lo que pides ya está **construido y probado** en B, no diseñado.
Lo documento como lo que es, y diseño de nuevo sólo **E**, que es lo que falta.

---

## 1 · Estado actual real de la cola

### 1.1 · Producción (v7.451) — lo que corre hoy en los móviles del equipo

```js
// index.html:3211 en el commit ab34bdf
const _OUTBOX_KEY = 'txk_sync_outbox';
function _outboxAdd(name){ … s.add(name) … }     // 3214
```

`localStorage.txk_sync_outbox` → **un array JSON de cadenas**: `["Duvan","Sol"]`.
Sin identidad, sin marca de tiempo, sin versión, sin identificador de evento.

### 1.2 · Rama (v7.452) — B1, cerrada y sin publicar

```js
// index.html:3255-3257
const _OUTBOX_KEY   = 'txk_sync_outbox';     // formato 1: nombres sueltos
const _COLA_KEY     = 'txk_cola_v2';         // formato 2: con identidad
const _CUARENTENA   = 'txk_cola_cuarentena'; // lo que no se pudo atribuir
```

**Estructura exacta de un elemento (formato 2):**

```js
{ v: 2, nombre: 'Ana', uid: '2369a651-…', ts: 1789430000000 }
```

| Campo | ¿Lo hay? | Origen |
|---|---|---|
| nombre | **sí** | `currentUser` — **no es identidad**, sólo la clave para leer `DB.employees[nombre]` |
| `auth_user_id` / uid | **sí** | `_authUid`, que sólo escribe `_authSesionEntrar` tras validar la sesión |
| venue | **no** | deliberadamente: lo pondrá el servidor |
| sesión | no como objeto; el `uid` **es** la sesión | |
| timestamp | **sí** (`ts`) | del cliente, sólo diagnóstico |
| `event_id` | **no** | no hace falta: no son eventos (§5) |
| versión | **sí** (`v`) | para que una versión futura no rompa la cola |

### 1.3 · Lo que no existe en ninguna de las dos

**No hay cola para `scores` ni para `actividad`.** Lo que se hace sin cobertura
se pierde. `registrarActividad` (2370) tiene un comentario que promete un
reintento que no existe, y los tres escritores de `scores` se tragan el error.

---

## 2 · Flujo completo: crear → almacenar → sincronizar

*(Referencias a la rama, que es el estado propuesto.)*

```
 saveDB()                                   4844  retardo de 1,5 s
   └─ _saveDBNow()                          4834
        ├─ _guardarLocal()                  4811  ← guarda y NADA MÁS
        └─ _sincronizarFicha(currentUser)   3358  ← ÚNICO punto de entrada
             │
             ├─ const uid = _authUid        ← la identidad, CONGELADA aquí
             ├─ _colaAnotar(nombre, uid)    3308  → txk_cola_v2
             ├─ supaUpsertEmployee(nombre)  3122
             │     └─ POST /rest/v1/employees?select=name
             │        Prefer: resolution=merge-duplicates,return=representation
             └─ al resolver:
                  'confirmado' | 'nada'  → _colaQuitar(nombre, uid)
                  'permanente'           → _colaQuitar + _cuarentenaPoner
                  'reintentable'         → se queda encolada
```

**Quién recupera los pendientes:** `_colaCargar()` (3273). Lee el formato 2 y
además el formato 1 heredado, al que asigna `uid: null` y **no adopta**.

**Quién los sincroniza:** `_outboxFlush()` (3385), disparado por `online`, por
`visibilitychange`, por temporizador de 120 s y 4 s tras arrancar.

**Qué endpoint recibe cada tipo:**

| Tipo | Endpoint | Hoy |
|---|---|---|
| ficha (snapshot) | `POST /rest/v1/employees?select=name` | en cola |
| examen / simulacro | `POST /rest/v1/scores` | **sin cola** |
| actividad | `POST /rest/v1/actividad` | **sin cola** |

### Respuestas a los 22 puntos

| # | Situación | Producción (v7.451) | Rama (B1) |
|---|---|---|---|
| 9 | **200** | `res.ok` → `true` → desencola **aunque no haya escrito** | se cuentan las filas: 1 → `confirmado`; **0 → `permanente`** |
| 10 | **4xx** | `false`, reintento interno a 3 s, y se traga | 403 y 4xx (salvo 401/408/429) → `permanente` → cuarentena |
| 11 | **5xx** | ídem | `reintentable`: sigue en cola |
| 12 | **timeout tras aceptación** | se reenvía; inocuo por la fusión monótona | igual: la fusión es monótona (`max` y unión) |
| 13 | **doble envío** | inocuo, misma razón | inocuo |
| 14 | **`_beaconSync`** (32876) | camino aparte, **sin cola**, con valores absolutos; **puede reducir XP**; ignora `_esAdmin` | respeta `_esAdmin`; manda contadores **sólo si la ficha ya se fusionó** en esta sesión |
| 15 | **logout** (11625) | borra `txoko_session` y el token; **la cola sobrevive** | igual, y además `_authUid = null`, así que nada ajeno se intenta |
| 16 | **cambio de empleado** | la entrada de Ana **se intenta con el token de Bruno** | **se salta**; no se intenta y no se desencola |
| 17 | **token expirado** | `_bearer()` cae a la clave anónima y escribe igual | `_authUid` nulo → no se intenta nada, nada se pierde |
| 18 | **días offline** | la cola no crece: es un conjunto por nombre | igual |
| 19 | **empleado desactivado** | **no existe ese concepto** en el esquema | tampoco |
| 20 | **los 4 sin identidad** | no pueden entrar → no encolan | igual |
| 21 | **eventos anteriores a v7.450** | no hay versión: indistinguibles | se leen como `v:1, uid:null` y **no se adoptan** |
| 22 | **manipular `employee`/`venue` en localStorage** | **funciona**: se escribe lo que diga | el `uid` falseado sólo consigue que la petición salga y **la rechace el servidor** |

---

## 3 · Identidad actual y vulnerabilidades

### En producción

La identidad de una entrada es **la cadena que había en `currentUser` al
guardar**. `currentUser` es una variable de ámbito de script modificable desde la
consola. No interviene Auth en ningún punto.

**Vulnerabilidad principal, y es de pérdida, no de robo:** con RLS activo, la
entrada de Ana sale con el token de Bruno, la política deja el `UPDATE` en cero
filas, PostgREST responde **200 con cuerpo vacío** (`Prefer: return=minimal`), el
cliente lo lee como éxito y **desencola**. El progreso de Ana desaparece sin un
solo error y el aviso se pone en verde.

### En la rama

La identidad es `_authUid`, escrito únicamente por `_authSesionEntrar` después de
comprobar que el `sub` del token coincide con el `auth_user_id` de la ficha.

**Lo que el cliente puede hacer y lo que no:** puede editar el `uid` de una
entrada en `localStorage`. Con eso sólo consigue que la petición **salga**. Quien
decide si se **escribe** es la política del servidor contra el `auth.uid()` del
token firmado. El `uid` de la cola **no es una credencial: es un filtro de
cortesía** que evita intentos inútiles y pérdidas silenciosas.

### La vulnerabilidad que ninguna de las dos resuelve

El **hash SHA-256 del PIN es una credencial al portador** —
`verify_employee_pin_sha` compara `stored = sha_hex` — y vive en
`DB.employees[*].pin` de todos los que han entrado en ese iPad. Salir no lo borra.
Mientras eso siga así, **RLS no aísla a dos compañeros que comparten dispositivo**.
Decidido en su día: queda fuera de la fase B. Sigue siendo cierto.

---

## 4 · El caso obligatorio: Ana → Bruno

### Cómo se identifica al propietario original

**Por el `uid` que se congeló al crear la entrada**, nunca reconstruido.
`_sincronizarFicha` (3358) hace `const uid = _authUid;` **antes** de cualquier
`await`. El `.then` que evalúa el resultado usa **esa** variable capturada, no la
global:

```js
.then(res => {
  if(res === 'confirmado' || res === 'nada') _colaQuitar(nombre, uid);  // ← uid, no _authUid
```

Y el vaciado se salta lo que no es suyo (3385):

```js
if(e.uid != null && e.uid !== _authUid) continue;
```

### La secuencia

| Momento | Qué pasa |
|---|---|
| Ana trabaja sin red | `{v:2, nombre:'Ana', uid:'uid-ana', ts:…}` |
| Ana sale | `logout()` borra su token; **la cola se conserva** |
| Bruno entra | `_authUid = 'uid-bruno'` |
| Vuelve la red, salta el temporizador | la entrada de Ana **no coincide** → no se intenta, no se desencola |
| Chip de sincronización | «pendiente», no «sincronizado» |
| Ana vuelve a ese iPad | coincide → se envía → se confirma → se desencola |

**Probado, no razonado.** En `tests/smoke.mjs`, ejecutando la cola real con
relojes reales:

- *«si Bruno entra mientras viaja la petición de Ana, el resultado sigue siendo de Ana»*
- *«la entrada de Ana no se sincroniza con Bruno dentro»*

Y dos mutaciones confirman que muerden: quitar la captura del `uid` y quitar el
salto de lo ajeno. **396 pruebas en verde.**

### Cómo lo verificará el servidor con RLS

El cliente **no manda identidad**. La política compara `auth_user_id` de la fila
con `auth.uid()`, que sale del `sub` de un JWT firmado por GoTrue:

```sql
-- SIN EJECUTAR
using ( auth_user_id = auth.uid() ) with check ( auth_user_id = auth.uid() )
```

Si la petición de Ana saliera con el token de Bruno, el `UPDATE` afectaría a
**cero filas**. Y desde B1 eso **ya no se lee como éxito**.

---

## 5 · Arquitectura propuesta: la cola de EVENTOS (lo que falta)

La de la ficha ya está. Falta la de `scores` y `actividad`, y es distinta porque
**son hechos, no un estado que converge**.

### 5.1 · Estructura

```js
// txk_cola_v2, mismo almacén y mismo vaciado que B1, con entradas de otro tipo
{
  v: 2,
  tipo: 'evento',
  destino: 'scores' | 'actividad',
  evento_id: '<uuid v4>',        ← nace CON EL HECHO, no con el envío
  uid: '<auth.uid() de quien lo vivió>',
  ts: 1789430000000,
  datos: { score, total, topic, cat, time_sec }   ← sin employee, sin venue
}
```

**El `evento_id` se genera al terminar el examen**, en la misma línea que hoy
construye el objeto de sesión (21886), y se guarda con el evento. No al enviar:
si naciera al enviar, cada reintento crearía un hecho nuevo.

### 5.2 · Cómo se resuelve cada caso

| Caso | Solución |
|---|---|
| **empleado** | no viaja: `DEFAULT app.mi_nombre()` |
| **`auth_user_id`** | no viaja: `DEFAULT auth.uid()`, **y con el `INSERT` de esa columna revocado** |
| **sesión / logout / cambio de usuario** | idéntico a B1: sellado con `uid`, se salta lo ajeno, cuarentena |
| **renovación / expiración** | 401 es `reintentable`; sin `uid` activo no se intenta nada |
| **dispositivo compartido** | cada evento espera a su dueño |
| **offline prolongado** | la cola de eventos **sí crece** (uno por hecho). Hace falta un tope y un aviso — es la diferencia con la de la ficha |
| **reintentos / doble envío / timeout tras aceptación** | el `evento_id` es estable → el `UNIQUE` los absorbe |
| **evento manipulado** | cambiar `employee` o `venue` no sirve: no viajan. Cambiar `uid` sólo hace que salga y el servidor lo registre **a nombre de quien firma el token** |
| **evento antiguo** | no habrá: la cola nace ahora, toda entrada lleva `uid` desde el primer día |
| **empleado desactivado** | no existe el concepto; ver §12 |
| **empleado sin identidad** | no puede entrar, no genera eventos |
| **`_beaconSync`** | **no toca eventos.** Es sólo para el snapshot. Lo que quede en la cola de eventos lo recoge el vaciado normal |

**La regla que lo sostiene todo:** *la identidad del evento no se reconstruye; se
congela al ocurrir, y el servidor la vuelve a poner por su cuenta al escribir.*
`currentUser`, nombre, venue y rol no intervienen en ningún punto.

---

## 6 · Idempotencia

**La ficha no la necesita** y sería la herramienta equivocada: la fusión es
monótona (`xp = max(...)`, unión de conjuntos), así que reenviar cien veces da lo
mismo que una. No hay evento que deduplicar; hay un estado que converge.

**Los eventos sí.** Clave: `evento_id` UUID v4 del cliente, generado con el hecho.

**Dónde se valida: en el servidor, con un índice único** — la única capa que no
se puede rodear:

```sql
-- SIN EJECUTAR
create unique index concurrently scores_evt_uk
  on public.scores (auth_user_id, evento_id) where evento_id is not null;
```

**Atado a `auth_user_id`, no al nombre.** Dos motivos: los nombres de Meseo
**han derivado de hecho** (`Estefanía`→`Estefania`, `Faride`→`Faride Navarro`), y
un `UNIQUE` global convertiría el identificador en un recurso compartido: Ana
podría **quemar el UUID de Bruno** antes de que él lo enviara, y su evento real se
descartaría como duplicado. Con la unicidad atada a una identidad que el cliente
no escribe, Ana sólo puede quemar el suyo.

**Qué recibe el cliente cuando ya estaba:** con
`Prefer: resolution=ignore-duplicates,return=representation`, cero filas → se
trata como *ya estaba* y **se desencola**. Sin esa cabecera sería `409`/`23505`,
que también es aceptado.

> **Cuidado:** esa cabecera **cambia el significado de «cero filas»**. En la cola
> de la ficha, cero filas es un **rechazo**. Hay que elegir por endpoint y no
> mezclar los dos criterios en la misma función. Es la decisión D1 de §12.

---

## 7 · Migración de los pendientes que ya existen

Los dispositivos tendrán `txk_sync_outbox` con nombres sueltos. **No se puede
saber quién los creó: esa información nunca se guardó.**

1. Se leen y se convierten a `{v:1, nombre, uid:null, ts:0}` (3273). **La clave
   vieja no se borra** hasta resolverse: volver a la versión anterior no pierde
   nada.
2. **No se adoptan.** Ni por nombre, ni por parecido, ni por hash del PIN, ni por
   nada.
3. Mientras `anon` conserve permiso —fases A, B y C— se intentan por el camino de
   siempre y se vacían solas en días. **Esa ventana ES el mecanismo de
   migración**: no hace falta ningún heurístico.
4. Lo que quede al llegar a la fase D pasa a **cuarentena**, contado y visible, y
   se recupera sólo si esa persona vuelve a entrar en ese dispositivo.

**Precondición de la fase D:** no se puede retirar `anon` con entradas `uid:null`
pendientes, o «retenido» se convierte en «irrecuperable».

---

## 8 · Logout, cambio de empleado, token expirado, quiosco

| Caso | Cliente | Servidor |
|---|---|---|
| **Logout** | `_authSesionSalir()` borra el token de los dos sitios y pone `_authUid = null`; **la cola se conserva** | — |
| **Cambio de empleado** | lo ajeno se salta por `uid` | la política lo bloquearía igualmente |
| **Token expirado** | `supabase-js` lo renueva; `onAuthStateChange` refresca la copia en memoria | — |
| **Refresco fallido** | `_authUid` nulo → **no se intenta y no se desencola nada** | 401 |
| **Quiosco** | si no se marcó «recordarme», el token vive en memoria y muere con la pestaña; la cola persiste | — |
| **Dos pestañas** | comparten `localStorage`; el cerrojo es por pestaña. Inocuo para la ficha (monótona) y para los eventos (`UNIQUE`) | `UNIQUE` |

**Lo que sigue sin resolver:** `DB.employees` conserva las fichas —y el hash del
PIN— de todos los que han pasado por ese aparato. Fuera de la fase B, anotado.

---

## 9 · Eventos inválidos o irrecuperables

| Situación | Cliente | Clasificación |
|---|---|---|
| `uid` ≠ sesión actual | no envía, retiene | **retenido** |
| `uid` de una cuenta borrada | envía una vez, 401/403 | **permanente** → cuarentena |
| cero filas (ficha) | — | **permanente** → cuarentena |
| cero filas (evento con `ignore-duplicates`) | — | **aceptado** → desencola |
| `409` / `23505` | — | **aceptado** → desencola |
| `403` / `42501` | — | **permanente** |
| `401` | — | **reintentable** (la sesión se renueva) |
| 5xx, red, timeout | retiene | **reintentable** |
| `uid:null` tras la fase D | — | **retenido** → cuarentena |

**La cuarentena no borra nada.** Guarda la entrada con su motivo y su fecha, la
cuenta y la refleja en el chip (3325, 3333). Máximo 200 entradas.

---

## 10 · Integración futura con RLS

Sin cambios respecto a lo ya diseñado, más tres precondiciones que **esta
solución convierte en obligatorias**:

1. **Ninguna escritura puede leer «cero filas» como éxito.** Hecho para la ficha
   en B1; **falta para las tres de `scores` y para `actividad`**.
2. **`employee` y `venue` dejan de viajar en el cuerpo**, y los pone el servidor
   por `DEFAULT`. Sin eso, `with check` los rechazará.
3. **El `INSERT` sobre `auth_user_id` revocado al cliente.** Sin ese `revoke`, el
   `DEFAULT` es decorativo: bastaría con mandar el ajeno.

Políticas, sin cambios:

```sql
-- SIN EJECUTAR
create policy scores_alta_propia on public.scores
  for insert to authenticated
  with check ( auth_user_id = auth.uid() );
```

---

## 11 · Tests

### Positivos

| # | Caso | Esperado |
|---|---|---|
| 1 | Ana crea offline → Ana sincroniza | 1 fila, desencolada |
| 2 | Un cambio real → **una** sincronización | *(ya en la suite)* |
| 3 | App en reposo → **cero** sincronizaciones | *(ya en la suite)* |
| 4 | Token renovado a mitad | sincroniza igual |
| 5 | 200 eventos sin red durante días | se envían todos, sin duplicar |
| 6 | Reenvío de un evento aceptado | una sola fila |

### Negativos

| # | Ataque / fallo | Esperado | Capa |
|---|---|---|---|
| 7 | **Ana crea → Bruno entra → sincroniza** | **0 envíos de la entrada de Ana** | cola (`uid`) *(ya en la suite)* |
| 8 | Bruno entra con la petición en vuelo | el resultado sigue siendo de Ana | `uid` capturado *(ya en la suite)* |
| 9 | Cero filas | **no es éxito** | clasificación *(ya en la suite)* |
| 10 | Error de red | sigue pendiente | *(ya en la suite)* |
| 11 | Entrada heredada con nombre parecido o con tilde | **no se adopta** | *(ya en la suite)* |
| 12 | Hash del PIN presente | **nunca se usa para atribuir** | *(ya en la suite)* |
| 13 | Manipular `employee` en el evento | el campo no viaja; DEFAULT del servidor | esquema |
| 14 | Manipular `venue` | ídem | esquema |
| 15 | Manipular `uid` del evento | se registra a nombre de quien firma el token | `DEFAULT` |
| 16 | Reutilizar el `evento_id` de otro | no le afecta | `UNIQUE (auth_user_id, evento_id)` |
| 17 | Dos pestañas enviando el mismo evento | una sola fila | `UNIQUE` |
| 18 | Timeout tras aceptación | el reenvío no duplica | `UNIQUE` |
| 19 | `localStorage` lleno al encolar | aviso, no pérdida silenciosa | cuota |
| 20 | La cola de eventos crece sin límite | tope y aviso | cliente |

**Mutaciones obligatorias:** quitar el `UNIQUE`, devolver el `INSERT` de
`auth_user_id`, generar el `evento_id` al enviar, adoptar por nombre, tratar cero
filas como éxito, quitar el salto de lo ajeno.

*(Las diez de B1 ya existen y muerden.)*

---

## 12 · Cambios necesarios y decisiones pendientes

### Cliente

| | Qué | Nota |
|---|---|---|
| C1 | Los tres escritores de `scores` y `registrarActividad` devuelven estado y miran `res.ok` | **se puede hacer ya**, sin esquema ni RLS |
| C2 | `evento_id` al ocurrir el hecho | |
| C3 | Entradas de `tipo:'evento'` en la cola de B1 | mismo almacén, mismo vaciado |
| C4 | Tope y aviso para la cola de eventos | no lo necesitaba la de la ficha |
| C5 | Quitar `employee` y `venue` de los cuerpos | precondición de las políticas |

### Esquema — **descrito, no ejecutado**

```sql
-- SIN EJECUTAR. Requiere aprobación explícita.
alter table public.scores    add column evento_id uuid, add column auth_user_id uuid default auth.uid();
alter table public.actividad add column evento_id uuid, add column auth_user_id uuid default auth.uid();
create unique index concurrently scores_evt_uk    on public.scores    (auth_user_id, evento_id) where evento_id is not null;
create unique index concurrently actividad_evt_uk on public.actividad (auth_user_id, evento_id) where evento_id is not null;
revoke insert (auth_user_id) on public.scores    from anon, authenticated;
revoke insert (auth_user_id) on public.actividad from anon, authenticated;
```

Las 427 filas y las 5 actividades **no se tocan**: quedan con `evento_id` nulo y
el índice parcial las ignora.

### Decisiones pendientes

- **D1 · `ignore-duplicates` sí o no.** Cambia el significado de «cero filas».
  Hay que elegir por endpoint y ser coherente.
- **D2 · Tope de la cola de eventos.** ¿Cuántos, y qué se hace al llegar?
  Descartar los más viejos es pérdida; no descartar es reventar la cuota.
- **D3 · ¿Qué eventos entran?** Los 254 récords de juego no lo necesitan
  (§ hallazgos). Si sólo entran las evaluaciones, la cola es la mitad.
- **D4 · «Empleado desactivado» no existe** en el esquema. Sin columna `activo`,
  una cuenta retirada sólo se distingue por no tener identidad.

---

## Hallazgos para una fase posterior

Registrados y **sin implementar**:

- `sessions_data` cubre el **45 %** del historial de exámenes.
- Los **80 simulacros de alérgenos** no entran nunca en `sessions_data`.
- La fusión de sesiones se queda con el **array más largo**, no con la unión.
- El historial completo se conserva en **`scores`**.
- La **gráfica semanal** del Supervisor se calcula hoy sobre `sessions_data`, es
  decir, sobre el 45 %.
- El **ranking no filtra por empleado activo**: `Ana Kurzweil`, que ya no está,
  empata hoy en el primer puesto.
- El **hash del PIN es una credencial al portador** y sobrevive al logout.
