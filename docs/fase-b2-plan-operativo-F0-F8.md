# B2 — Plan operativo F0 → F8

**Nada implementado. Ningún commit.** Esquema, cliente, Supabase, políticas,
grants, UI y tests quedan como estaban. `evento_id`: 0 columnas. Índices de
evento: 0.

## La ventana que está abierta ahora mismo

Desde C-3, una sesión sin token **no escribe**. Y en `actividad` el fallo es
invisible: `registrarActividad` termina en `return false` dentro de un `catch`
con el comentario *«Silencio a propósito… se reintentará cuando vuelva la
conexión»* (`index.html:2439-2443`). **Ese reintento no existe.** El comentario
describía un mundo en el que había cola; hoy no la hay, y lo que hay es pérdida
silenciosa de evaluaciones.

En `scores` sí hay un aviso (`21923`, `25157`), pero dice *«No se pudo guardar la
puntuación en la nube. Guardada localmente»* — y «guardada localmente» significa
hoy un anillo de 50 sesiones y un porcentaje, no el hecho.

**Cerrar esa ventana es el objetivo de B2, y es lo que fija el orden de las fases.**

---

# F0 · Identidad única e inmutable

**Fase:** F0 — el contexto de autenticación pasa a ser un solo objeto congelado.

**Objetivo:** que no exista ninguna operación que compruebe un `uid` y después,
tras un `await`, obtenga el token de otra persona por una variable global
distinta.

**Archivos/objetos afectados:** `index.html` — bloque de autenticación
(937-1116) y los **11 puntos** que hoy leen `_authUid` o `_authToken`:
`_bearer()` (960), `onAuthStateChange` (1009), `_authSesionSalir` (1027, 1030),
`_authSesionEntrar` (1076, 1078), `_cuerpoPropio` (1896), y los cinco de la cola
de fichas de B1 (3364, 3365, 3370, 3385, 3420). `tests/smoke.mjs`.

**Cambios exactos:**

```js
// El contexto. INMUTABLE: no se muta, se SUSTITUYE entero. Que sea un objeto
// congelado es lo que permite detectar un cambio de identidad con una sola
// comparación de referencia, incluso a mitad de un await.
let _auth = Object.freeze({ uid:null, token:null, exp:0, empleado:null, estado:'anonimo' });
function _authCtx(){ return _auth; }                       // síncrono siempre
function _authPoner(next){ _auth = Object.freeze(next); }  // ÚNICA vía de cambio
```

- `_authUid` y `_authToken` **desaparecen como variables**. Los 11 sitios pasan a
  `_authCtx().uid` / `_authCtx().token`.
- `_bearer()` → `return _authCtx().token || SUPA_KEY`. Los ~51 puntos que lo usan
  no se tocan.
- `_authSesionSalir` y `_authSesionEntrar` hacen **una sola** asignación cada uno,
  vía `_authPoner`.
- Se añade `_jwtSub(token)` (decodifica sólo la carga útil; no verifica nada y no
  lo pretende) y `exp` se guarda en el contexto.

**Invariantes de seguridad:**
- **I0.1** — sólo `_authPoner` modifica la identidad. Nadie muta `_auth`.
- **I0.2** — `_authCtx()` es síncrona y nunca lanza.
- **I0.3** — B1 sigue funcionando exactamente igual: su cola de fichas lee el
  `uid` del mismo sitio, congelado igual que antes.

**Migración/rollback:** `git revert` de un commit. **No toca la base, ni datos, ni
almacenamiento local.** Reversión sin consecuencias.

**Tests:**
- `_authCtx()` devuelve el mismo objeto entre llamadas mientras nadie entre o salga.
- Tras `_authPoner`, `_authCtx() !== anterior` (identidad de referencia).
- `_bearer()` devuelve el token cuando lo hay y `SUPA_KEY` cuando no.
- `_jwtSub` sobre un JWT real devuelve el `sub`; sobre basura devuelve `null` sin lanzar.
- **Mutación:** volver a declarar `_authToken` como global y leerlo en `_bearer` →
  debe caer una guarda estática de «no quedan lecturas sueltas de identidad».

**Criterio de aceptación:** suite en verde, **cero** apariciones de `_authUid`/
`_authToken` fuera del bloque de autenticación, y comportamiento idéntico medido
en las pruebas existentes de B1 y C-2.

**Riesgos:** un punto que se olvide de migrar seguiría leyendo una variable que ya
no se actualiza. Lo cubre la guarda estática. **Bajo**: es un refactor mecánico y
no cambia ninguna decisión.

---

# F1 · Esquema y permiso de `evento_id`

**Fase:** F1 — la idempotencia existe en el servidor antes de que nadie la use.

**Objetivo:** que `evento_id` exista, esté indexado por identidad y sea
insertable por `authenticated`, **sin que nada cambie todavía**.

**Archivos/objetos afectados:** Supabase (`public.scores`, `public.actividad`),
`supabase/fase_c_identidad_servidor.sql`, `tests/smoke.mjs`.

**Cambios exactos:**

```sql
alter table public.scores    add column evento_id uuid;
alter table public.actividad add column evento_id uuid;

alter table public.scores    add constraint scores_evento_con_dueno
  check (evento_id is null or auth_user_id is not null) not valid;
alter table public.actividad add constraint actividad_evento_con_dueno
  check (evento_id is null or auth_user_id is not null) not valid;
alter table public.scores    validate constraint scores_evento_con_dueno;
alter table public.actividad validate constraint actividad_evento_con_dueno;

-- SIN `concurrently`: no puede ir en una transacción, y con 427 y 5 filas el
-- bloqueo es de milisegundos. Así la migración es atómica.
create unique index scores_evt_uk
  on public.scores (auth_user_id, evento_id) where evento_id is not null;
create unique index actividad_evt_uk
  on public.actividad (auth_user_id, evento_id) where evento_id is not null;

-- SIN ESTO, B2 RECIBE 42501 EN CADA ENVÍO. Tras C-3 `authenticated` sólo puede
-- insertar las columnas concedidas, y `evento_id` es una más.
grant insert (evento_id) on public.scores    to authenticated;
grant insert (evento_id) on public.actividad to authenticated;
```

Y **obligatoriamente en el mismo commit**: actualizar la lista esperada de la
guarda `C-3 · lo concedido es exactamente el negocio del esquema real`
(`tests/smoke.mjs:11662-11665`) para añadir `evento_id`. Si no, la suite se pone
roja — y eso es correcto: esa guarda existe justo para que nadie amplíe los grants
sin decirlo.

**Invariantes de seguridad:**
- **I1.1** — **no se crea `UNIQUE(evento_id)` global.** Con él, cualquiera que lea
  `txk_eventos_v1` en un iPad compartido podría gastar los identificadores de otro
  y hacer que sus evaluaciones se rechacen como duplicadas. Con el compuesto es
  imposible por construcción.
- **I1.2** — el índice es **parcial**: las 427 puntuaciones y las 5 actividades
  históricas tienen `evento_id` nulo y no colisionan.
- **I1.3** — `auth_user_id` lo sigue poniendo el servidor (C-1 + C-3). `evento_id`
  no es identidad y no entra en el `with check` de las políticas.
- **I1.4** — el `CHECK` impide que una fila con evento quede fuera del índice por
  tener dueño nulo, es decir, sin idempotencia.

**Migración/rollback:**
```sql
drop index if exists public.scores_evt_uk;
drop index if exists public.actividad_evt_uk;
alter table public.scores    drop constraint if exists scores_evento_con_dueno;
alter table public.actividad drop constraint if exists actividad_evento_con_dueno;
revoke insert (evento_id) on public.scores    from authenticated;
revoke insert (evento_id) on public.actividad from authenticated;
alter table public.scores    drop column if exists evento_id;
alter table public.actividad drop column if exists evento_id;
```
Inocuo mientras ninguna fila tenga `evento_id`; a partir de la primera, descarta
esa marca de idempotencia. **No toca datos históricos ni reabre ninguna
vulnerabilidad** (a diferencia del rollback de C-3).

**Tests:**
- Guardas sobre el `.sql`: existe el índice parcial compuesto; **no** existe
  `unique (evento_id)` a secas; el `CHECK` está; `evento_id` está en el grant.
- **Mutación:** añadir `create unique index … on scores (evento_id)` → debe caer.
- **Mutación:** quitar `grant insert (evento_id)` → debe caer.
- Verificación contra la base: conteos idénticos; `select count(*) where evento_id
  is not null` = 0 en ambas tablas.

**Criterio de aceptación:** conteos 427 / 5 / 22 sin cambios, 58 huérfanos, 0 filas
con `evento_id`, y una petición real con el cuerpo de C-2 **más** `evento_id`
devuelve 201.

**Riesgos:** **bajo**. Es aditivo y nadie manda `evento_id` todavía. El único
riesgo real sería crear el índice global por error, y hay mutación que lo caza.

---

# F2 · Alta del evento, persistencia síncrona y capacidad

**Fase:** F2 — el hecho se convierte en un evento durable en el instante en que
ocurre, y el envío directo pasa a llevar ese mismo `evento_id`.

**Objetivo:** que ninguna evaluación dependa ya de que haya red en ese segundo, y
que el solape con el camino actual sea **idempotente en vez de duplicador**.

**Archivos/objetos afectados:** `index.html` — nuevo bloque de cola de eventos;
`registrarActividad` (2395); `supaInsertScore` (2886); los 12 puntos de llamada.
`tests/smoke.mjs`.

**Cambios exactos:**

*Almacenes (claves nuevas, ninguna compartida con B1):*
```
txk_eventos_v1              cola de eventos CON dueño
txk_eventos_sin_identidad   eventos sin dueño — el drenaje NO abre esta clave
txk_eventos_registro        contadores de descartes, cuarentena e incidencias
```

*Alta, síncrona:*
```js
function _eventoCrear(destino, prioridad, datos) →
  'persistido' | 'sin_identidad' | 'descartado' | 'bloqueado_por_cuota' | 'no_persistido'
```
Se llama **en el mismo tick en que termina la prueba**, antes de `awardXP`, de
pintar el resultado y de cualquier `await`. **Quien la llama debe mirar lo que
devuelve.**

*El `evento_id`, generado al ocurrir el hecho:*
```js
function _uuid(){
  if(crypto && crypto.randomUUID) return crypto.randomUUID();
  const b = new Uint8Array(16); crypto.getRandomValues(b);   // NUNCA Math.random
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2,'0')).join('');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
```

*Guardado, sin tragarse nada:*
```js
function _eventosGuardar(lista){            // true | 'cuota' | false
  let s; try{ s = JSON.stringify(lista); }catch(_){ return false; }
  try{ localStorage.setItem(_EV_KEY, s); return true; }
  catch(e){
    const cuota = e && (e.name==='QuotaExceededError' || e.name==='NS_ERROR_DOM_QUOTA_REACHED'
                        || e.code===22 || e.code===1014);
    return cuota ? 'cuota' : false;
  }
}
```

*El solape idempotente:* `registrarActividad` y `supaInsertScore` siguen enviando
como hoy, pero **añaden al cuerpo el `evento_id` del evento recién creado**, y al
recibir 201 lo confirman y lo sacan de la cola. Si el envío falla, el evento se
queda y F3 lo reintentará **con el mismo id** → 409 `23505` → idempotente.

### Los cuerpos exactos

**`scores`** — 5 columnas de negocio + `evento_id`:
```json
{ "score": 18, "total": 20, "topic": "alergenos", "cat": "all", "time_sec": 240,
  "evento_id": "3f2a91c4-…" }
```
**`actividad`** — 7 de negocio + `evento_id`:
```json
{ "activity": "simulacro_alergenos", "competency": "alergenos", "kind": "evaluacion",
  "score": 18, "total": 20, "seconds": 240, "meta": { "cat": "all", "ts_hecho": 1789430000000 },
  "evento_id": "8b1c…" }
```
**Nada más.** `employee`, `venue`, `auth_user_id`, `id` y `created_at` los completa
el servidor (C-1) y el cliente **no podría mandarlos aunque quisiera** (C-3). Los
datos de negocio viajan tal cual, con las mismas validaciones de hoy —vocabulario
cerrado de `competency`, `kind`, `total > 0`, `score ≤ total`— que ya se aplican
antes de crear el evento. El momento del hecho va en `meta.ts_hecho`; `created_at`
sigue siendo del servidor y es el de la escritura: **los dos coexisten**, y para
una evidencia de alérgenos importa el primero.

### Las tres situaciones offline

| Situación | Qué ocurre |
|---|---|
| **Hay JWT persistido, aunque esté caducado** | Al arrancar se lee `meseo-auth` de forma **síncrona** y se saca el `sub` con `_jwtSub`. El evento nace con **dueño real**. `token` sólo si `exp` está en el futuro; si no, estado `identidad_sin_token`: el evento entra en `txk_eventos_v1` como `pendiente` y **espera renovación o red** |
| **Hay sesión local pero aún no hay token utilizable** | Es el mismo caso: hay `uid` (del JWT persistido) y no hay `token`. El evento tiene dueño y espera. Si además no hay JWT —sólo `txoko_session`, que es el login antiguo— entonces **no hay identidad demostrable** y aplica la fila siguiente |
| **Ningún JWT: iPad compartido arrancado completamente sin red** | El evento va a **`txk_eventos_sin_identidad`**. **El drenaje no abre esa clave**: no es una comprobación que se pueda olvidar, es una ruta de código que no existe. Se muestra en el acto: *«Esta prueba no se ha podido asociar a nadie y no se enviará»* |

**Qué pasa con esos eventos al cambiar de empleado:** **nada.** No se adoptan, no
se atribuyen, no se envían. Bruno ve *«1 prueba sin identificar en este
dispositivo»* — sin decir de quién, porque en un aparato compartido eso no es
asunto suyo. **No hay auto-recuperación de ninguna clase.** Como no se implementa
reclamación humana, la única acción es repetir la prueba, y el mensaje lo dice.

**`anon` no se usa nunca como respaldo.** Tras C-3 devolvería 42501, y antes
tampoco debía.

### Capacidad

| Constante | Valor | Papel |
|---|---|---|
| `UMBRAL_P3` | 400 | desde aquí no entran prácticas |
| `UMBRAL_AVISO` | 500 | **aviso. No rechaza nada** |
| `LIMITE_DURO` | 1 000 | tope lógico, por coste de CPU al reparsear |
| `PRESUPUESTO` | 512 KB (UTF-16) | red de seguridad de la estimación |

| Ocupación | P1 alérgenos | P2 evaluación | P3 práctica |
|---|---|---|---|
| < 400 | entra | entra | entra |
| 400–499 | entra | entra | **descartado**, contado y visible |
| 500–999 | entra + aviso | entra + aviso | descartado |
| ≥ 1 000 o > 512 KB | **se intenta igual** | se intenta igual | descartado |
| `setItem` lanza | **`bloqueado_por_cuota`** visible | ídem | descartado |

**Si la cola está llena sólo de eventos prioritarios:** siguen entrando. El umbral
lógico no los rechaza nunca; lo único que puede impedirlo es el dispositivo. Al
superar `LIMITE_DURO` se dispara, en orden: (1) drenaje inmediato si hay red
—enviar libera sitio—; (2) liberar espacio **sin tocar jamás la cola de
evaluaciones**: purgar telemetría, recortar el diario por debajo de 14 días,
recortar `emp.sessions` por debajo de 50, colapsar el registro de descartes;
(3) reintentar el `setItem`. Si vuelve a fallar, `bloqueado_por_cuota` y aviso que
no se quita de un toque. **Nunca se borra una evaluación para hacer sitio a otra:
eso es descarte silencioso con otro nombre.**

**No se fija ninguna cuota de WebKit.** `PRESUPUESTO` es una aproximación medida
en Chromium; **la autoridad final es siempre lo que devuelve `setItem`**.

### Las 12 categorías, y dónde nace cada `evento_id`

| # | Actividad | Función que la produce | Línea | Prio | Destinos |
|---|---|---|---|---|---|
| 1 | `simulacro_alergenos` | `renderAllergenResults` → `registrarActividad` + `supaInsertScore` | 25153 / 25156 | **1** | `actividad` **y** `scores` |
| 2 | `examen` | `nextExamQ` → `registrarActividad` + `supaInsertScore` | 21919 / 21922 | 2 | `actividad` **y** `scores` |
| 3 | `examen_sala` | `registrarActividad` | 12239 | 2 | `actividad` |
| 4 | `examen_lqa` | `registrarActividad` | 29524 | 2 | `actividad` |
| 5 | `situaciones_lqa` | `registrarActividad` | 29724 | 2 | `actividad` |
| 6 | `auditor_lqa` | `registrarActividad` | 29984 | 2 | `actividad` |
| 7 | `fantasma` | `registrarActividad` | 30300 | 2 | `actividad` |
| 8 | `quiz_vinos` | `registrarActividad` | 20206 | 2 | `actividad` |
| 9 | `maridaje` | `registrarActividad` | 20743 | 2 | `actividad` |
| 10 | `repaso` | `registrarActividad` | 8428 | 3 | `actividad` |
| 11 | `recorrido` | `registrarActividad` | 6165 | 3 | `actividad` |
| 12 | `reto_dia` | `registrarActividad` | 9397 | 3 | `actividad` |

**14 producciones de evento, no 12**: las dos primeras escriben en las dos tablas
y **cada destino lleva su propio `evento_id`**, para que el fracaso de uno no
arrastre al otro.

**Dónde nace el `evento_id`:** dentro de `_eventoCrear`, que se llama desde
`registrarActividad` y desde `supaInsertScore` **antes de construir el cuerpo y
antes de cualquier `fetch`**. Nunca en el reintento.

**Fuera, explícitamente:** `survivors` (32315) y `mr_shoesmith` (32703) —juegos—;
`supaInsertTxokoRecord` (2911) y `supaInsertEtRecord` (2970) —récords, cuyo máximo
ya vive en `employees.txoko_record` con la cola de B1—; duelos; tarjetas sueltas;
pantallas de consulta y de contenido. **No se inventa ninguna actividad.**

**Invariantes de seguridad:**
- **I2.1** — un evento con `uid` nulo **jamás** entra en `txk_eventos_v1`.
- **I2.2** — el `evento_id` se genera al ocurrir el hecho y **no cambia nunca**.
- **I2.3** — `QuotaExceededError` no se traga; no existe ruta que siga como si el
  evento estuviera guardado cuando `setItem` falló.
- **I2.4** — no se borra ninguna evaluación para hacer sitio.
- **I2.5** — el cuerpo no lleva las cinco columnas del servidor.

**Migración/rollback:** `git revert`. Las tres claves nuevas quedan huérfanas en
los dispositivos pero **nadie las lee ni las borra**; si se vuelve a poner B2, se
recuperan. **No se toca ninguna clave de B1** (`txk_sync_outbox`, `txk_cola_v2`,
`txk_cola_cuarentena`).

**Cómo se evita que una versión antigua destruya o filtre los eventos B2:** las
tres claves son **desconocidas** para v7.451 y v7.453 — no las leen, no las
escriben, no pueden destruirlas. Es la razón de no reutilizar `txk_cola_v2`: el
parser de B1 (`_colaCargar`, 3304) descarta toda entrada sin `nombre`, y la guarda
de versión `v > 2` está **dentro** de ese `if`, así que no protegería. *(Aparte y
sin mezclar con B2: conviene invertir ese orden en B1 algún día, porque la trampa
sigue armada para el siguiente formato.)*

**Tests:** alta de los 14 eventos; cuerpo sin las cinco columnas; `evento_id`
presente y estable; `sin_identidad` en clave separada y `txk_eventos_v1` vacía;
`setItem` que lanza → `bloqueado_por_cuota` y el llamante **no** recibe
«persistido»; cola a 399/400/500; evaluación con la cola a 500 → **entra**;
prohibición de `Math.random`. **Mutaciones:** generar el id al enviar; tragarse la
cuota; permitir descartar evaluaciones; escribir en `txk_cola_v2`.

**Criterio de aceptación:** comportamiento observable **idéntico** al de hoy
—mismas peticiones, mismos avisos— y la cola llenándose y vaciándose por
confirmación. Sin filas duplicadas en producción.

**Riesgos:** **medio.** Es la fase que más código toca. El riesgo concreto es el
doble envío, y lo neutraliza que F1 ya esté aplicada: el mismo `evento_id` en el
envío directo hace que cualquier solape sea un 409 idempotente.

---

# F3 · Drenaje, identidad congelada y concurrencia

**Fase:** F3 — el drenaje sustituye al envío directo y se convierte en el único
camino a la nube para esos 14 eventos.

**Objetivo:** que el reintento exista de verdad, con la identidad congelada.

**Archivos/objetos afectados:** `index.html` — bloque de cola de eventos;
`registrarActividad`, `supaInsertScore`. `tests/smoke.mjs`.

**Cambios exactos:** `_eventosDrenar()` con **un solo snapshot** y las cuatro
comprobaciones:

```
const s = _authCtx();                       // UNA vez, al principio
por cada evento, orden: prioridad ↑, luego ts ↑
  1. e.uid === s.uid              → si no: retenido, no se toca
  2. _authCtx() === s             → si no: ABORTA el drenaje entero
  3. s.token != null              → si no: no se envía
  4. _jwtSub(s.token) === s.uid   → si no: no se envía
  POST con Authorization: Bearer s.token    ← el MISMO snapshot da uid y token
```

El token viaja **explícitamente** desde el snapshot al POST; no se vuelve a leer
ninguna global después de ningún `await`. Disparadores: los de B1 —`online`,
`visibilitychange`, 120 s, +4 s al arrancar— **más** uno inmediato al crear un
evento. **No se añaden temporizadores propios de reintento**: el vaciado periódico
*es* el reintento.

**Concurrencia:**
```js
async function _conCerrojo(fn){
  if(navigator.locks && navigator.locks.request) return navigator.locks.request('txk_eventos', fn);
  return fn();
}
```
El cerrojo envuelve **el ciclo leer-modificar-escribir de la cola**, no la petición
de red: mantenerlo durante un POST bloquearía la otra pestaña durante segundos.
Exige iOS/Safari **15.4+**, el mismo suelo que `crypto.randomUUID`: un único
umbral, y está en la lista de F8.

**Respaldo si no está:** no sustituir la lista entera, sino **releer justo antes de
escribir y fusionar por `evento_id`**. El peor caso es **duplicar** una entrada
local, no perderla, y el duplicado lo absorbe el `UNIQUE` del servidor con un 409.
La fusión falla hacia el lado que no pierde. Además, el evento `storage` permite
que una pestaña refresque sus contadores cuando la otra escribe.

Los cuatro escenarios de corrupción:

| Escenario | Qué lo evita |
|---|---|
| **Dos operaciones simultáneas** | `_eventosDrenando` (cerrojo en memoria por pestaña) + el cerrojo de escritura |
| **Dos pestañas** | `navigator.locks`, o la fusión por `evento_id` |
| **Logout/login durante un vaciado** | comprobación 2: `_authCtx() !== s` → aborta |
| **Ana → Bruno con una petición de Ana en vuelo** | la petición ya salió con las cabeceras de Ana —un `fetch` no cambia su `Authorization` a mitad de vuelo— y el bucle se detiene en el siguiente evento |

**Invariantes de seguridad:**
- **I3.1** — un evento de Ana **jamás** se envía con el token de Bruno.
- **I3.2** — si la identidad cambia durante un `await`, se aborta; nada se
  desencola sin respuesta del servidor.
- **I3.3** — el drenaje **no abre** `txk_eventos_sin_identidad`.
- **I3.4** — ninguna pestaña sobrescribe la cola de otra.

**Migración/rollback:** `git revert`. Volver a F2 deja el envío directo, que sigue
funcionando. **Reversible sin pérdida.**

**Tests:** cambio de usuario durante el `await`; logout durante el POST; refresco
durante el POST; `token`/`uid` descuadrados; orden de salida (alérgenos primero,
luego lo más antiguo); 300 eventos sin red se envían todos sin duplicar; dos
pestañas. **Mutaciones:** quitar la comprobación 2; quitar la 4; quitar el filtro
por `uid`; hacer que el drenaje lea la clave de `sin_identidad`.

**Criterio de aceptación:** cero peticiones con token cruzado en todas las pruebas
de identidad, y las cuatro mutaciones detectadas.

**Riesgos:** **medio-alto** — es el corazón de la corrección de seguridad. Mitigado
porque cada comprobación tiene mutación propia.

---

# F4 · Clasificación de errores y reintentos

**Fase:** F4 — el cliente deja de adivinar qué significó una respuesta.

**Objetivo:** que ningún error entre en un bucle infinito ni se confunda con un
éxito.

**Archivos/objetos afectados:** `index.html` — clasificador del drenaje.
`tests/smoke.mjs`.

**Cambios exactos:**

```
sin respuesta (red, AbortError, timeout)                → pendiente + backoff
status >= 500 || 408 || 429                             → pendiente + backoff
cuerpo ilegible                                         → pendiente + backoff
201 && filas.length > 0                                 → CONFIRMADO, fuera
2xx && filas.length === 0                               → CUARENTENA 'sin-fila'
409 · code==='23505' && message.includes(INDICE_B2)     → DUPLICADO, fuera
409 · code==='23503'                                    → CUARENTENA 'fk'
409 · cualquier otro                                    → CUARENTENA 'conflicto'
401/403 · code==='42501'                                → CUARENTENA 'sin-autorizacion'
401/403 · code==='PGRST301' && s.exp <= ahora           → RENOVAR y reintentar
401/403 · code==='PGRST301' && s.exp  >  ahora          → credencial inválida:
                                                           1 renovación, y si repite → REVISAR
401/403 · sin code, o cualquier otro                    → REVISAR
400 · code==='PGRST204' || '23502'                      → REVISAR + apagar el envío
400 · code==='23514'                                    → CUARENTENA 'datos-invalidos'
400 · cualquier otro                                    → CUARENTENA 'peticion-invalida'
cualquier otra cosa                                     → REVISAR
```

**Cómo se identifica el índice del `23505` sin `details`:** B2.2 midió que
PostgREST **omite `details` en un `23505`** (aunque sí lo manda en un `23503`). El
nombre del índice viaja en `message`:
`duplicate key value violates unique constraint "scores_evt_uk"`. Se compara
contra una constante **compartida entre el SQL y el cliente**:
```js
const INDICE_B2 = { scores: 'scores_evt_uk', actividad: 'actividad_evt_uk' };
```
Si el nombre del índice cambiara sin cambiar la constante, la idempotencia dejaría
de reconocerse y los reintentos acabarían en cuarentena — ruidoso, no silencioso,
que es el fallo correcto. Hay una guarda que comprueba que el nombre del `.sql` y
el del cliente coinciden.

**Backoff:** 1 inmediato · 2 → 5 min · 3 → 15 · 4 → 1 h · 5 → 4 h · 6-10 → 24 h. A
los 10 → `revisar`. **Un evento nunca se elimina por agotar reintentos.**

**Invariantes de seguridad:**
- **I4.1** — nada se clasifica por estado HTTP a secas. **Medido:** 409 es `23505`
  *y* `23503`; 401 es `42501` *y* `PGRST301` *y* «sin código».
- **I4.2** — `PGRST301` **no** significa caducado: un JWT roto devuelve lo mismo.
  **La caducidad la decide el cliente con su propio `exp`.**
- **I4.3** — una credencial inválida no produce bucle: una renovación y `revisar`.
- **I4.4** — «cero filas» significa **rechazo** en toda la aplicación.

**Migración/rollback:** `git revert`. Se vuelve a F3, donde todo fallo era
reintentable. Sin pérdida de datos, sólo menos precisión.

**Tests:** los diez códigos, cada uno con su doble de `fetch`; backoff creciente;
`PGRST301` con `exp` pasado → renueva, con `exp` futuro → `revisar`; 10 fallos →
`revisar` **y el evento sigue en la cola**. **Mutaciones:** tratar cualquier 409
como duplicado; clasificar por estado HTTP; borrar al agotar intentos.

**Criterio de aceptación:** las tres mutaciones detectadas y ningún camino que
reintente indefinidamente.

**Riesgos:** **bajo**. Es lógica pura con dobles, y los códigos están medidos
contra este servidor, no leídos de la documentación.

---

# F5 · Cuarentena

**Fase:** F5 — lo que el servidor rechaza de forma permanente no desaparece.

**Objetivo:** ninguna pérdida silenciosa, ningún truncado silencioso.

**Archivos/objetos afectados:** `index.html` — `txk_eventos_registro` y la
cuarentena de eventos. `tests/smoke.mjs`.

**Cambios exactos:** cuarentena propia de B2, **separada de la de B1**
(`txk_cola_cuarentena`, que se deja como está, con su recorte a 200: es otra clave
y otra fase). Estructura:
```js
{ v:1, entradas:[…], colapsados:[{motivo, dia, n, tipos}],
  contadores:{ cuarentena:0, cuarentena_desbordada:0, descartado_por_espacio:0,
               sin_identidad:0, no_persistido:0 } }
```

| Pregunta | Respuesta |
|---|---|
| ¿Hay límite? | Físico, compartido con el presupuesto. **Ninguno por número** |
| **¿Qué pasa al alcanzarlo?** | **Nunca se borra una entrada de prioridad 1 o 2.** Las de prioridad 3 se **colapsan** en `{motivo, día, n, tipos}`: se pierde el detalle individual, **no el hecho ni la cuenta**. Si ni siquiera el resumen cabe, el estado pasa a `bloqueado_por_cuota` y se avisa |
| ¿Cómo se cuenta lo que no cabe? | `contadores.cuarentena_desbordada`, **que no se recorta nunca** |
| ¿Se ve cuántos hay? | Sí: el contador es persistente y la superficie de F6 lo muestra |
| ¿Se borra algo automáticamente? | **No.** Ni para mantener el contador bonito ni por ningún otro motivo |

**Invariantes de seguridad:**
- **I5.1** — ningún evento de prioridad 1 o 2 se borra jamás.
- **I5.2** — ningún contador se recorta.
- **I5.3** — la cuarentena de B1 no se toca.

**Migración/rollback:** `git revert`; la clave queda y nadie la borra.

**Tests:** entrada 201 → nada desaparece sin contador; prioridad 1 y 2 nunca se
colapsan; el contador sobrevive a recargar. **Mutación:** recortar en silencio →
debe caer.

**Criterio de aceptación:** imposible construir un caso donde un evento de
evaluación desaparezca sin dejar cuenta.

**Riesgos:** **bajo.**

---

# F6 · Superficie de incidencias

**Fase:** F6 — se habla sólo cuando hay algo que atender.

**Objetivo:** sustituir un aviso que con cola pasaría a ser **falso** por una
superficie que distinga cinco situaciones.

**Archivos/objetos afectados:** `index.html` — `_setSyncPill` (4756),
`_outboxReflect` (3368), y los dos avisos de `supaInsertScore` (21923, 25157).
`styles.css` si hace falta. **No se toca la navegación.**

**Cambios exactos:**

- **Se retira el toast** *«No se pudo guardar la puntuación en la nube. Guardada
  localmente»* de los dos puntos. Con la cola, «no se pudo guardar» es **falso**:
  sí se guardó, en el dispositivo, y se enviará solo.
- **`_setSyncPill` no cambia**: sigue pintando sólo `offline`. Sincronizar es
  rutina y **no se narra** — tu preferencia se mantiene intacta.
- **`_outboxReflect` deja de salir cuando no hay red** (`if(navigator.onLine ===
  false) return;`). Ése es justo el momento en que ocurren los descartes.
- Superficie nueva, discreta, que **sólo aparece si hay algo que atender**:

| Situación | ¿Aparece? | Qué ve el empleado |
|---|---|---|
| **Pendiente de sincronizar** | **no** | nada. Es normal sin cobertura y no es un problema |
| **Identidad ausente** | **sí** | *«Esta prueba no se ha podido asociar a nadie y no se enviará. Repítela cuando tengas conexión.»* — en la propia pantalla de resultados, en el acto |
| **Credencial inválida** | **sí** | *«Hay que volver a entrar: tu sesión no es válida.»* con un botón que lleva al login |
| **Evento en cuarentena** | **sí** | *«N pruebas no se pudieron enviar.»* y, al tocar, qué prueba, de qué día y por qué motivo, con reintento manual |
| **Almacenamiento insuficiente** | **sí**, y no se quita de un toque | *«N pruebas sin guardar: falta espacio en este dispositivo»*, con qué se puede liberar |
| Descartes por capacidad (prácticas) | **sí**, discreto | *«N prácticas no se han registrado por falta de espacio»* |

**Invariantes de seguridad:**
- **I6.1** — nunca se dice «guardado» cuando no se ha persistido.
- **I6.2** — nunca se dice «falló» cuando sólo está pendiente.
- **I6.3** — todo estado que requiere acción es visible, **también sin red**.

**Migración/rollback:** `git revert`. Volvería el toast antiguo, que es incorrecto
pero no peligroso.

**Tests:** descarte sin red → el contador se actualiza igual; el contador
sobrevive a recargar; el aviso de cuota no es descartable. **Mutación:** devolver
el `return` por `onLine === false` → debe caer.

**Criterio de aceptación:** con todo bien, la pantalla está **igual que hoy**.

**Riesgos:** **bajo-medio** — es la única fase con cambio visible, y por eso la
decisión del toast necesita tu aprobación explícita.

---

# F7 · Pruebas, mutaciones y cierre en CI

**Fase:** F7 — cierre de la red de seguridad.

**Objetivo:** que cada invariante crítica tenga una mutación que la mate.

**Archivos/objetos afectados:** `tests/smoke.mjs`, `supabase/*.sql`.

**Cambios exactos:** completar la matriz de §Aceptación; ejecutar **todas** las
mutaciones y dejar constancia de cuál cae con cada una; verificar que la CI sigue
siendo Node puro (sin Playwright) y que `node tests/allergen-audit.mjs` sigue en
0/0.

**Invariantes de seguridad:** **I7.1** — ninguna invariante crítica sin mutación
que la demuestre.

**Migración/rollback:** no aplica.

**Tests:** los de la matriz.

**Criterio de aceptación:** suite en verde y **todas** las mutaciones detectadas,
cada una con el mensaje que nombra lo que se rompió.

**Riesgos:** el clásico —una prueba que pasa en falso—. Por eso las mutaciones
son obligatorias: en esta sesión ya han destapado dos pruebas ciegas mías.

---

# F8 · Verificación en producción y medición real en iPad

**Fase:** F8 — la única que puede declarar B2 terminada.

**Objetivo:** comprobar el comportamiento real, en el hardware real, antes de
declarar nada.

**Archivos/objetos afectados:** ninguno. Es medición.

**Cambios exactos:** ninguno en código. Se ejecuta:

**(a) Contra la base**, sin dejar datos: una escritura legítima autenticada con
`evento_id`; su reintento → 409 `23505` con el nombre del índice en `message`; el
mismo `evento_id` desde otra identidad → fila propia, la ajena intacta; conteos
antes y después.

**(b) En el iPad que usa el equipo** —**pendiente, y no se inventa**—:

| Qué medir | Por qué decide |
|---|---|
| Techo real de `localStorage` en WebKit | `LIMITE_DURO` y `PRESUPUESTO` son hoy Chromium de escritorio |
| Comportamiento observado de `setItem` al acercarse al límite | si hay escritura parcial, el contrato cambia |
| Tamaño real alcanzable | ídem |
| **Comportamiento tras reiniciar el dispositivo** | si no sobrevive, la cola no es durable |
| **Comportamiento sin red durante un periodo relevante** | es el caso de uso entero |
| **Comportamiento al recuperar la conexión** | que drene de verdad, y por prioridad |
| `navigator.locks` y `crypto.randomUUID` disponibles | suelo iOS 15.4 |
| Pestaña de Safari **frente a** PWA instalada | decide si aplica el desalojo de WebKit |

Instrumento ya publicado: **https://claude.ai/artifact/1JwUYr6qV7GkPqZNz595CH**
Protocolo de ejecución, con la checklist de lo que hay que anotar en el
aparato: `docs/fase-b2-f8b-protocolo-ipad.md`.

**Invariante de cierre:** **I8.1 — si WebKit demuestra una limitación estructural
que impida la retención offline prevista, B2 NO se declara cerrada y se abre
rediseño.** No hay excepción a esto y no se sustituye por una estimación.

**Migración/rollback:** no aplica.

**Tests:** los de (a), y los resultados de (b) tal como salgan.

**Criterio de aceptación:** los ocho puntos de (b) medidos y **compatibles** con el
diseño. Si uno no lo es, se documenta y B2 queda abierta.

**Riesgos:** **alto, y es el riesgo que queda.** Si el almacenamiento se desaloja a
los siete días en el modo en que se usa la app, la cola no puede sostener semanas
sin red. Eso es rediseño —probablemente IndexedDB—, no ajuste.

---

# MATRIZ DE ACEPTACIÓN B2

| # | Requisito | Fase | Test que lo demuestra | Fallo que haría B2 **NO APROBADA** |
|---|---|---|---|---|
| 1 | Ana crea evento offline **con** JWT persistido | F2 | `meseo-auth` con token caducado → evento en `txk_eventos_v1` con `uid` de Ana | que nazca con `uid:null` teniendo JWT |
| 2 | Ana crea evento offline **sin** JWT | F2 | evento en `txk_eventos_sin_identidad`; `txk_eventos_v1` vacía | que entre en la cola que drena |
| 3 | Bruno entra después | F3 | los de Ana quedan `retenido` | que pasen a `pendiente` para Bruno |
| 4 | **Bruno no puede enviar ni apropiarse del evento de Ana** | F3 | 0 peticiones con `evento_id` de Ana y token de Bruno | **una sola petición cruzada** |
| 5 | Ana vuelve online y sincroniza | F3 | drenaje por prioridad; 201; fuera de la cola | que no drene o duplique |
| 6 | **Cambio Ana → Bruno durante un `await`** | F3 | `_authCtx() !== s` → aborta | que el bucle siga con el token nuevo |
| 7 | Reintento del mismo `evento_id` | F2+F4 | 3 fallos y un éxito → mismo id las 4 veces → 1 fila | que el id cambie en el reintento |
| 8 | Mismo `evento_id` usado por otro usuario | F1 | fila propia; la ajena intacta | que se rechace la de Ana (índice global) |
| 9 | JWT **realmente** caducado | F4 | `exp` pasado → renovar y reintentar | que vaya a cuarentena sin intentar renovar |
| 10 | JWT **no** caducado pero inválido | F4 | 1 renovación y `revisar` | **bucle infinito de renovación** |
| 11 | `23505` | F4 | + índice esperado → idempotente, fuera | que se trate como error |
| 12 | `23503` | F4 | → cuarentena | **que se trate como duplicado** |
| 13 | `42501` | F4 | → cuarentena, sin reintento infinito | reintento indefinido |
| 14 | 400 determinista | F4 | `PGRST204`/`23502` → `revisar` + apagar; `23514` → cuarentena | reintento indefinido |
| 15 | timeout / 5xx | F4 | → `pendiente` con backoff creciente | que vaya a cuarentena |
| 16 | **Fallo de `setItem`** | F2 | `bloqueado_por_cuota`; el llamante **no** recibe «persistido» | **que se trague el error** |
| 17 | Cola con 399 | F2 | entra todo | — |
| 18 | Cola con 400 | F2 | práctica descartada, contada y visible | descarte silencioso |
| 19 | Cola con 500 | F2 | aviso; **nada se rechaza** | que rechace una evaluación |
| 20 | **Cola llena sólo de evaluaciones** | F2 | siguen entrando hasta el límite físico | **que se borre una para hacer sitio** |
| 21 | Cuarentena llena | F5 | P3 colapsada; P1/P2 intactas; contador vivo | truncado silencioso |
| 22 | Logout durante el vaciado | F3 | aborta; el resto `retenido` | envío con identidad equivocada |
| 23 | Recarga offline | F2 | `uid` recuperado del JWT persistido | que pierda el dueño |
| 24 | **Versión antigua cargando la cola B2** | F2 | v7.451/7.453 no conocen las claves: intactas | **que las borre** |
| 25 | Dos operaciones concurrentes | F3 | ninguna anotación perdida; peor caso duplicar | pérdida silenciosa |
| 26 | **Evento persistido y cierre inmediato de la pestaña** | F2 | `setItem` síncrono ya devolvió: el evento está en disco | que dependa de `saveDB`, `beforeunload` o `pagehide` |

**Cualquier fila de la columna de la derecha que ocurra invalida B2.** Las cuatro
en negrita —4, 10, 16, 20, 24 y 26— son las que no admiten matiz.

---

# ORDEN DE IMPLEMENTACIÓN

| Fase | Por qué **aquí** |
|---|---|
| **F0** Identidad | Todo lo demás depende del snapshot congelado, y es la única fase que no cambia ningún comportamiento: sirve de base sin riesgo. |
| **F1** Esquema | La idempotencia tiene que existir en el servidor **antes** de que el primer `evento_id` salga por el cable, o el solape con el camino actual duplicaría filas. |
| **F2** Alta y persistencia | Cierra la ventana de pérdida en el instante del hecho, y al llevar el envío directo el mismo `evento_id` el solape es idempotente en lugar de duplicador. |
| **F3** Drenaje | Sólo tiene sentido cuando ya hay eventos durables que drenar y un índice que absorba los reintentos. |
| **F4** Errores | Necesita un drenaje que produzca respuestas reales que clasificar. |
| **F5** Cuarentena | Es el destino de lo que F4 clasifica como permanente: sin F4 no habría nada que poner ahí. |
| **F6** Superficie | Sólo se puede enseñar bien lo que las fases anteriores ya distinguen; y el aviso antiguo no puede retirarse antes de que la cola exista de verdad. |
| **F7** Pruebas | Las mutaciones se escriben en cada fase; ésta es el cierre y la verificación de que ninguna invariante quedó sin una que la mate. |
| **F8** Medición | Es lo único que puede declarar B2 terminada, y sólo puede hacerse sobre el sistema completo y en el hardware real. |

---

# LISTO PARA IMPLEMENTAR B2

Con tres condiciones explícitas, que no son reservas sino el contorno de lo que
apruebas:

1. **Esta aprobación cubre F0 a F7.** F8 no puede declarar B2 cerrada sin la
   medición en el iPad. Si WebKit muestra una limitación estructural, **B2 no se
   cierra y se abre rediseño** — es tu propia regla y la suscribo.
2. **F2 exige que el envío directo lleve el `evento_id`.** Sin eso, encender el
   drenaje duplicaría todo lo que el camino actual ya escribió sin marca.
3. **F6 retira el toast** *«No se pudo guardar la puntuación en la nube»*. Con la
   cola pasa a ser falso, y mantenerlo sería mentir al empleado en la dirección
   contraria a la de hoy.

Y el motivo por el que esto corre: **desde C-3 la ventana está abierta**. Una
sesión sin token no escribe, y en `actividad` el error se traga en silencio con un
comentario que promete un reintento que todavía no existe. F2 es la fase que lo
cierra.

**No he implementado nada, no he hecho ningún commit, y no he tocado SQL, código,
Supabase, políticas, grants, UI ni tests.**
