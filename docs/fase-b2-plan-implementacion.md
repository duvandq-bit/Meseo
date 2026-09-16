# FASE B2 — Plan de implementación

**Nada implementado.** Ni esquema, ni cliente, ni datos, ni despliegue, ni
publicación. Este documento es el plan que se somete a aprobación.

Base: C-1, C-2 y C-3 aplicadas y verificadas. Producción en v7.451, rama en
v7.453. `evento_id` no existe todavía; los índices de evento tampoco.

---

## 1 · Arquitectura final

```
        EL HECHO OCURRE   (fin de una evaluación o de una práctica)
               │
               │  SÍNCRONO, mismo tick, ANTES de puntuar, pintar o esperar nada
               ▼
   _eventoCrear(destino, prioridad, datos)
       evento_id = crypto UUID v4      ← nunca Math.random
       snapshot  = _authCtx()          ← objeto congelado {uid, token, exp}
       ts        = Date.now()          ← el momento del HECHO
               │
       ¿snapshot.uid? ──no──► txk_eventos_sin_identidad   (el drenaje NO la abre)
               │ sí
       ¿cabe? ────no, P3──► descartado (contado y visible)
               │ sí
       setItem síncrono ──falla──► no_persistido / bloqueado_por_cuota (visible)
               │ ok
               ▼
        txk_eventos_v1  (clave PROPIA; la de B1 no se toca)
               │
               │  disparadores: online · visibilitychange · 120 s · +4 s · al crear
               ▼
   _eventosDrenar()
       const s = _authCtx()                    ← UN solo snapshot
       por evento, orden (prioridad ↑, ts ↑):
         e.uid !== s.uid          → retenido, no se toca
         _authCtx() !== s         → ABORTA el drenaje entero
         !s.token                 → no se envía
         jwtSub(s.token) !== s.uid→ no se envía
         POST con Bearer s.token  ← el MISMO snapshot da uid y token
               ▼
        clasificar por `code` → fuera | pendiente+backoff | cuarentena | revisar
```

**Las tres autoridades, separadas:** el **servidor** decide de quién es la fila y
si es duplicada (C-1 + C-3 + índice único); el **cliente** sólo decide si intenta
enviar; el **almacenamiento** decide si el hecho sobrevive, y cuando dice que no,
se dice.

---

## 2 · Esquema SQL exacto

```sql
-- ═══ B2 · ESQUEMA. PROPUESTA, NO EJECUTADA ═══

-- (1) La columna. Nulable: las 427 puntuaciones y las 5 actividades históricas
--     no tienen evento y no se inventa uno.
alter table public.scores    add column evento_id uuid;
alter table public.actividad add column evento_id uuid;

-- (2) UN EVENTO SIEMPRE TIENE DUEÑO. Impide que una fila con evento_id quede
--     fuera del índice parcial (y por tanto sin idempotencia) por tener
--     auth_user_id nulo. `not valid` para no recorrer el histórico, y se valida
--     después: las filas existentes lo cumplen porque su evento_id es NULL.
alter table public.scores    add constraint scores_evento_con_dueno
  check (evento_id is null or auth_user_id is not null) not valid;
alter table public.actividad add constraint actividad_evento_con_dueno
  check (evento_id is null or auth_user_id is not null) not valid;
alter table public.scores    validate constraint scores_evento_con_dueno;
alter table public.actividad validate constraint actividad_evento_con_dueno;

-- (3) LA IDEMPOTENCIA, ATADA A LA IDENTIDAD.
--     Parcial: `NULL` no colisiona consigo mismo, así que el histórico queda
--     intacto. Compuesto con auth_user_id: nadie puede quemar el id de otro.
--     NO se crea UNIQUE(evento_id) global, ni ahora ni nunca.
--     SIN `concurrently` a propósito: `create index concurrently` no puede ir
--     dentro de una transacción, y estas tablas tienen 427 y 5 filas — el
--     bloqueo es de milisegundos y así la migración es atómica.
create unique index scores_evt_uk
  on public.scores (auth_user_id, evento_id) where evento_id is not null;
create unique index actividad_evt_uk
  on public.actividad (auth_user_id, evento_id) where evento_id is not null;

-- (4) EL PERMISO QUE FALTA. Tras C-3 `authenticated` sólo puede insertar las
--     columnas de negocio; `evento_id` es una más y hay que concederla
--     explícitamente, o B2 recibirá 42501 en cada envío.
grant insert (evento_id) on public.scores    to authenticated;
grant insert (evento_id) on public.actividad to authenticated;
```

**Lo que NO lleva, a propósito:** ningún `UNIQUE(evento_id)` global; ninguna
identidad basada en `employee`; ninguna función nueva; ningún cambio en las
políticas de C-3 —`evento_id` no es identidad, así que el `with check` no lo
mira—; ningún cambio en la lectura.

**El nombre del índice es parte del contrato.** `scores_evt_uk` y
`actividad_evt_uk` viven en una constante compartida entre el SQL y el cliente:
la idempotencia se reconoce comparando el `message` del 409 con ese nombre, y
B2.2 midió que **`details` viene `null` en un `23505`**, así que no hay otra vía.

**Dependencia que hay que recordar:** la prueba `C-3 · lo concedido es exactamente
el negocio del esquema real` comprueba la lista de columnas concedidas. Añadir
`evento_id` **la hará fallar**, y eso es correcto: forma parte del cambio de B2
actualizar esa lista en `supabase/fase_c_identidad_servidor.sql` y en la guarda.

---

## 3 · Inventario exacto de las 12 rutas

Verificado sobre el fichero actual. **9 evaluaciones + 3 prácticas.**

| # | Actividad | Línea | Prioridad | `kind` | Competencia | Escribe en |
|---|---|---|---|---|---|---|
| 1 | **`simulacro_alergenos`** | 25153 | **1 — crítica** | evaluación | `alergenos` | `actividad` **+ `scores`** |
| 2 | `examen` | 21919 | 2 | evaluación | según tema | `actividad` **+ `scores`** |
| 3 | `examen_sala` | 12239 | 2 | evaluación | `sala` | `actividad` |
| 4 | `examen_lqa` | 29524 | 2 | evaluación | `protocolo` | `actividad` |
| 5 | `situaciones_lqa` | 29724 | 2 | evaluación | `protocolo` | `actividad` |
| 6 | `auditor_lqa` | 29984 | 2 | evaluación | `protocolo` | `actividad` |
| 7 | `fantasma` | 30300 | 2 | evaluación | `protocolo` | `actividad` |
| 8 | `quiz_vinos` | 20206 | 2 | evaluación | `vinos` | `actividad` |
| 9 | `maridaje` | 20743 | 2 | evaluación | `vinos` | `actividad` |
| 10 | `repaso` | 8428 | 3 | práctica | `carta` | `actividad` |
| 11 | `recorrido` | 6165 | 3 | práctica | `carta` | `actividad` |
| 12 | `reto_dia` | 9397 | 3 | práctica | `carta` | `actividad` |

**14 producciones de evento**, no 12: `simulacro_alergenos` y `examen` escriben en
las dos tablas, y **cada destino es un evento independiente con su propio
`evento_id`**. Que el `scores` de un simulacro fracase no puede arrastrar a su
`actividad`, ni al revés.

### Excluidos, y por qué

| Fuera | Línea | Motivo |
|---|---|---|
| `survivors` | 32315 | juego (`kind:'juego'`) |
| `mr_shoesmith` | 32703 | juego |
| `supaInsertTxokoRecord` | 2911 | récord: el máximo ya vive en `employees.txoko_record`, que tiene la cola de B1 |
| `supaInsertEtRecord` | 2970 | récord; un duplicado no falsea nada |

Duelos, tarjetas sueltas y pantallas de consulta **no generan ningún evento hoy**
y no se les añade ninguno. **No se inventa ninguna actividad nueva.**

---

## 4 · Contrato del evento

```js
{
  v: 1,                          // versión del formato de EVENTO
  evento_id: '<uuid v4>',        // crypto, en el instante del hecho
  destino: 'scores' | 'actividad',
  prioridad: 1 | 2 | 3,
  uid: '<sub del JWT>',          // congelado al crear. NUNCA null en esta clave
  ts: 1789430000000,             // Date.now() del HECHO
  datos: { … },                  // SÓLO negocio
  intentos: 0,
  proximo: 0,                    // epoch ms; 0 = ya
  estado: 'pendiente'
}
```

`datos` para `scores`: `{ score, total, topic, cat, time_sec }`.
`datos` para `actividad`: `{ activity, competency, kind, score, total, seconds, meta }`.

**Nada de identidad en `datos`.** Lo garantizan las tres capas de C-3: el cliente
no la manda (C-2), no podría aunque quisiera (grants), y la política la ata.

**El momento del hecho** viaja en `meta.ts_hecho`. `created_at` lo pone el
servidor y es el de la escritura. Los dos coexisten: para un simulacro de
alérgenos —que es evidencia— importa cuándo ocurrió, no cuándo se sincronizó.

### El `evento_id`

```js
function _uuid(){
  if(crypto && crypto.randomUUID) return crypto.randomUUID();
  const b = new Uint8Array(16); crypto.getRandomValues(b);   // NUNCA Math.random
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2,'0')).join('');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
```

`crypto.randomUUID` exige iOS 15.4+; `getRandomValues` está desde iOS 6. Con
`Math.random` la colisión deja de ser 2⁻¹²² y la idempotencia se convierte en
pérdida de datos: es una prohibición con test propio.

---

## 5 · Identidad — el `authContext`

### 5.1 · Un solo objeto, congelado

```js
let _auth = Object.freeze({ uid:null, token:null, exp:0, empleado:null, estado:'anonimo' });
function _authCtx(){ return _auth; }                       // síncrono siempre
function _authPoner(next){ _auth = Object.freeze(next); }  // ÚNICA vía de cambio
```

**Los 11 sitios que hoy leen `_authUid` o `_authToken` pasan a `_authCtx()`.** Es
mecánico y no cambia comportamiento; incluye `_bearer()`, `_cuerpoPropio` y los
cinco puntos de la cola de fichas de B1, que **siguen funcionando igual**.

### 5.2 · Por qué esto mata la carrera

Ana está drenando doce eventos. En el tercero, durante el `await` del POST, Bruno
teclea su PIN. `_authSesionEntrar` llama a `_authSesionSalir`, que hace **una**
asignación: `_authPoner({uid:null, …})`. Cuando el `await` vuelve,
`_authCtx() !== s` es cierto —son objetos distintos— y el drenaje se detiene.

No hay que comparar campos ni acertar con el orden en que cambian: **el snapshot
es uno y se sustituye entero**, así que una comparación de referencia detecta
cualquier cambio de identidad en cualquier espera. Ése era exactamente el fallo:
`_authToken` pasaba a ser el de Bruno *antes* que `_authUid`, y entre esos dos
instantes el evento de Ana salía firmado por Bruno.

### 5.3 · Las cuatro comprobaciones antes del POST

```
1. e.uid === s.uid              → si no, retenido (no es suyo)
2. _authCtx() === s             → si no, ABORTA el drenaje entero
3. s.token != null              → si no, no se envía (identidad sin token)
4. _jwtSub(s.token) === s.uid   → si no, no se envía (credencial que no cuadra)
```

Cualquiera bastaría casi siempre. Están las cuatro porque cuestan una comparación
y lo que protegen es la integridad de una evidencia de seguridad alimentaria.

### 5.4 · Las dos rutas offline

**Ruta 1 — hay JWT persistido (aunque esté caducado).** Al arrancar se lee
`meseo-auth` de forma síncrona y se decodifica **sólo la carga útil** del
`access_token` para sacar el `sub`:

```js
function _jwtSub(t){
  try{ const p = String(t).split('.')[1]; if(!p) return null;
       const j = JSON.parse(atob(p.replace(/-/g,'+').replace(/_/g,'/')));
       return (typeof j.sub === 'string' && j.sub) ? j.sub : null; }
  catch(_){ return null; }
}
```

No verifica nada y no lo pretende: el `sub` se usa **como etiqueta de propiedad
local**. La autoridad sigue saliendo del token firmado cuando el servidor lo
valida; manipularlo en `localStorage` no permite escribir nada a nombre de nadie,
y la comprobación 4 lo rechazaría antes de salir.

Estado resultante: `uid` real, `token` sólo si `exp` está en el futuro. Los
eventos nacen con dueño y esperan red o renovación.

**Ruta 2 — no hay ningún JWT.** El evento va a **`txk_eventos_sin_identidad`**,
una clave distinta que **el drenaje no abre**. No es una comprobación que se
pueda olvidar: es una ruta de código que no existe.

- nunca se envía;
- nunca se adopta automáticamente por quien aparezca después;
- no se atribuye a nadie;
- **no se implementa reclamación humana**, así que la única acción disponible es
  repetir la prueba, y el mensaje lo dice en el acto.

**`anon` no se usa nunca como respaldo.** Después de C-3 no serviría de nada
—devuelve 42501— y antes tampoco debía.

### 5.5 · Cierre de sesión y cambio de usuario

| Situación | Qué ocurre |
|---|---|
| **Ana crea evento → logout → entra Bruno** | El evento conserva `uid: Ana` en disco. Para Bruno es `retenido`: el drenaje lo salta por la comprobación 1. **Bruno no puede drenarlo por ninguna vía.** Vuelve a `pendiente` sólo cuando una sesión con `uid = Ana` esté activa en ese dispositivo |
| **POST de Ana en vuelo → entra Bruno** | La petición ya salió con las cabeceras de Ana: un `fetch` no cambia su `Authorization` a mitad de vuelo. Y el bucle se detiene en el siguiente evento por la comprobación 2. **El POST de Ana no puede terminar usando el token de Bruno** |
| **Logout durante el POST** | Igual: la petición en vuelo se resuelve con el token con el que salió, y el resto queda `retenido` |
| **Renovación durante el POST** | El token viejo vale hasta su `exp` y tiene el mismo `sub`. Sin efecto |
| **Ana no vuelve en 30 días** | Pasa a `revisar`: visible, contado, **nunca borrado** |

---

## 6 · Máquina de estados

Nueve estados y dos salidas. Tres de los propuestos se fusionan porque serían el
mismo comportamiento con otro nombre: `creado`+`persistido` son `pendiente`;
`reintentable` no es un estado sino una clasificación de respuesta (vuelve a
`pendiente` con `proximo` en el futuro); `retenido_por_otro_usuario` es `retenido`.

| Estado | Lo mueve | Transición | ¿En disco? | ¿Puede perderse? | ¿Enviable? |
|---|---|---|---|---|---|
| `pendiente` | cliente | `setItem` devolvió `true` y hay `uid` | **sí** | no | sí, si `proximo ≤ ahora` |
| `retenido` | cliente | `e.uid !== s.uid` | sí | no | no |
| `enviando` | cliente | superadas las 4 comprobaciones | sí | no | en vuelo |
| `sin_identidad` | cliente | se creó sin `uid` | sí, **otra clave** | no | **nunca** |
| `no_persistido` | almacenamiento | `setItem` lanzó (no cuota) | **sólo memoria** | **SÍ** | sí |
| `bloqueado_por_cuota` | almacenamiento | `QuotaExceededError` | **sólo memoria** | **SÍ** | sí |
| `revisar` | cliente | 10 intentos, o 30 días retenido, o firma de precondición | sí | no | a mano |
| `cuarentena` | **servidor** | rechazo permanente (§8) | sí | **no se borra jamás** | no |
| `descartado` | cliente | P3 con la cola ≥ 400 | sólo el registro | el hecho sí, **contado y visible** | — |
| *salida* `confirmado` | servidor | 201 con fila | fuera | no: está en la nube | — |
| *salida* `duplicado` | servidor | 409+`23505`+índice esperado | fuera | no: ya estaba | — |

**Transiciones que no existen, a propósito:** `sin_identidad → enviando` por
ninguna vía automática; `retenido → confirmado` sin que vuelva su dueño;
`pendiente → fuera` sin respuesta del servidor; `cuarentena → borrado`;
`revisar → borrado`; `no_persistido → pendiente` sin un `setItem` que devuelva
`true`.

---

## 7 · Política de capacidad

### Las tres capas, que no son la misma

| Capa | Qué es | Quién manda |
|---|---|---|
| **Lógica** | cuántos aceptamos antes de proteger el presupuesto | nosotros |
| **Física estimada** | cuánto creemos que queda | `JSON.stringify(cola).length`, unidades **UTF-16** |
| **Imposibilidad física** | `setItem` lanzó | **el dispositivo** |

La capa 3 **no se predice, se observa**. Por eso el contrato no puede decir «el
alérgeno siempre entra»: dice que **nunca lo rechazamos nosotros**, y que si el
dispositivo lo rechaza, se dice.

### Los números

| Constante | Valor | Papel |
|---|---|---|
| `UMBRAL_P3` | **400** | desde aquí no entran prácticas |
| `UMBRAL_AVISO` | **500** | **aviso persistente. No rechaza nada** |
| `LIMITE_DURO` | **1 000** | tope lógico de todo, por coste de CPU |
| `PRESUPUESTO` | **512 KB** (UTF-16) | red de seguridad de la capa 2 |

| Ocupación | P1 alérgenos | P2 evaluación | P3 práctica |
|---|---|---|---|
| < 400 | entra | entra | entra |
| 400–499 | entra | entra | **descartado**, contado y visible |
| 500–999 | entra **+ aviso** | entra **+ aviso** | descartado |
| ≥ 1 000 o > 512 KB | **se intenta igual** | se intenta igual | descartado |
| `setItem` lanza | **`bloqueado_por_cuota`**, visible | ídem | descartado |

### Si la capacidad física impide guardar una evaluación

Ocurre esto, en este orden:

1. **Drenaje inmediato** si hay red: enviar libera sitio.
2. **Liberar espacio**, por prioridad y sin tocar nunca una evaluación de la cola:
   purgar telemetría (IndexedDB), recortar `emp.diario` por debajo de 14 días,
   recortar `emp.sessions` por debajo de 50, colapsar el registro de descartes.
3. **Reintentar el `setItem`.**
4. Si vuelve a fallar: estado **`bloqueado_por_cuota`**. El evento queda en una
   lista en memoria —volátil, **y el aviso lo dice**— y se muestra un mensaje que
   no se quita de un toque: *«N pruebas sin guardar: falta espacio en este
   dispositivo»*, con qué se puede liberar.

**Nunca se dice «guardado» cuando no se ha guardado.** Y **nunca** se borra una
evaluación para hacer sitio: una vez dentro, un evento no se elimina para meter
otro, porque eso es descarte silencioso con otro nombre.

---

## 8 · Clasificación de errores

Con los códigos **medidos** en B2.2 y C-3 contra este servidor, no con los de la
documentación.

```
si (no hubo respuesta: red, AbortError, timeout)       → pendiente + backoff
si (status >= 500 || status === 408 || status === 429) → pendiente + backoff
si (cuerpo ilegible)                                   → pendiente + backoff
si (status === 201 && filas.length > 0)                → CONFIRMADO, fuera
si (status 2xx && filas.length === 0)                  → CUARENTENA 'sin-fila'
si (status === 409)
     code==='23505' && message.includes(INDICE_B2)      → DUPLICADO, fuera
     code==='23503'                                     → CUARENTENA 'fk'
     cualquier otro                                     → CUARENTENA 'conflicto'
si (status === 401 || status === 403)
     code === '42501'                                   → CUARENTENA 'sin-autorizacion'
     code === 'PGRST301' && snapshot.exp <= ahora       → RENOVAR y reintentar
     code === 'PGRST301' && snapshot.exp  > ahora       → 1 renovación; si repite → REVISAR
     sin code, o cualquier otro                         → REVISAR
si (status === 400)
     code === 'PGRST204' || code === '23502'            → REVISAR + apagar el envío
     code === '23514'                                   → CUARENTENA 'datos-invalidos'
     cualquier otro                                     → CUARENTENA 'peticion-invalida'
en cualquier otro caso                                  → REVISAR
```

**Lo que la medición obliga y no es negociable:**

- **`409` no es sinónimo de duplicado**: `23503` también es 409. Medido.
- **`401` no es sinónimo de caducado**: `42501` llega como **401**. Medido en C-3,
  siete veces por HTTP real.
- **`PGRST301` no significa «caducado»**: un JWT sintácticamente roto devuelve el
  mismo código. Medido. Por eso **la caducidad la decide el cliente con su propio
  `exp`**, no el servidor. Sin esto, un token manipulado entraría en «renovar y
  reintentar» para siempre.
- **Un 401 puede llegar sin campo `code`**. Medido. Por defecto: `revisar`, nunca
  reintento ciego.
- **El nombre del índice se comprueba en `message`**, porque `details` viene
  `null` en un `23505`. Medido.
- **Nada se clasifica por estado HTTP a secas.**

**Backoff:** intento 1 inmediato, 2 → 5 min, 3 → 15, 4 → 1 h, 5 → 4 h, 6-10 → 24 h.
A los 10 → `revisar`. **Un evento nunca se elimina por agotar reintentos.**

---

## 9 · Persistencia

```js
function _eventoCrear(destino, prioridad, datos) → 'persistido' | 'sin_identidad'
                                                 | 'descartado' | 'bloqueado_por_cuota'
                                                 | 'no_persistido'
```

Se llama **en el mismo tick en que termina la prueba**, antes de `awardXP`, de
pintar el resultado y de cualquier `await`. Quien la llama **debe** mirar lo que
devuelve.

**No se usa `saveDB()`**, que difiere 1 500 ms. **No se confía en
`beforeunload`**, ni en `pagehide`, ni en el cierre de pestaña: la corrección de
verdad es que **no haya nada pendiente de volcar**, porque el evento se escribió
en el instante del hecho.

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

**`QuotaExceededError` no se traga jamás.** No existe ninguna ruta en la que el
código siga como si el evento estuviera guardado cuando `setItem` falló.

---

## 10 · Concurrencia

```js
async function _conCerrojo(fn){
  if(navigator.locks && navigator.locks.request) return navigator.locks.request('txk_eventos', fn);
  return fn();
}
```

**Dependencia declarada:** `navigator.locks` exige iOS/Safari **15.4+**, el mismo
suelo que `crypto.randomUUID`. Un solo umbral para las dos cosas, **y está en la
lista de lo que hay que confirmar en el iPad**.

**Respaldo si no está, o por debajo de ese suelo:** no sustituir la lista entera,
sino **releer justo antes de escribir y fusionar por `evento_id`**. La ventana
residual es de microsegundos y el peor caso es **duplicar** un evento en la cola
local, no perderlo — y un duplicado local lo absorbe el `UNIQUE` del servidor con
un 409 idempotente. Es la asimetría correcta: la fusión falla hacia el lado que no
pierde.

**Ninguna pestaña sobrescribe la cola de otra**, ni siquiera sin cerrojo. Además,
el evento `storage` permite que una pestaña se entere de lo que escribió la otra y
refresque sus contadores.

**Dos contextos de usuario a la vez** (dos pestañas, dos personas): cada evento
lleva su `uid`, y cada drenaje salta lo que no es suyo. El cerrojo protege la
estructura; el `uid` protege la atribución.

---

## 11 · Cuarentena

| Pregunta | Respuesta |
|---|---|
| ¿Hay límite? | Físico, compartido con el presupuesto. **No hay límite por número** |
| ¿Qué pasa al alcanzarlo? | **Nunca se borra una entrada de prioridad 1 o 2.** Las de prioridad 3 se **colapsan** en un resumen `{motivo, día, n, tipos}`: se pierde el detalle individual, no el hecho ni la cuenta |
| ¿Cómo se cuenta lo que no cabe? | `contadores.cuarentena_desbordada`, **que no se recorta nunca** |
| ¿Cómo se ve? | Superficie de §12, con pantalla propia: qué prueba, de qué día, por qué motivo |
| ¿Cómo se recupera? | Reintento manual desde esa pantalla |
| ¿Qué no puede perderse en silencio? | Todo lo de prioridad 1 y 2, **y cualquier contador** |

**El recorte silencioso a 200 de B1 (`index.html:3355`) desaparece** para la
cuarentena de eventos. La de fichas de B1 se deja como está: es otra clave y otra
fase.

---

## 12 · Superficie de incidencias

**Se respeta la preferencia existente.** `_setSyncPill` (`index.html:4756`) sólo
pinta `offline`; `pending` y `synced` están ocultos por decisión tuya, y eso **no
cambia**. Sincronizar es rutina y no se narra.

| | Narrar la sincronización | Avisar de algo que requiere acción |
|---|---|---|
| Hoy | no | — |
| Con B2 | **sigue sin narrarse** | **sí, y sólo entonces** |

Aparece **sólo** si hay: pruebas sin guardar, pruebas sin identidad, eventos en
`revisar`, o cuarentena. **Nunca** por un simple «pendiente de enviar», que es
normal sin cobertura.

Dos correcciones necesarias:

- **`_outboxReflect` deja de salir cuando no hay red** (`index.html:3368`). Ése es
  justo el momento en que ocurren los descartes.
- **Los contadores persisten** en `txk_eventos_registro`: `{contadores:{…},
  ultimos:[50], colapsados:[…]}`. Los contadores no se recortan nunca.

**No se rediseña la navegación.** Ni una pestaña nueva, ni un cambio de rutas.

---

## 13 · Migración y compatibilidad

| Clave | Quién | Se toca en B2 |
|---|---|---|
| `txk_sync_outbox` | B1, formato 1 heredado | **no** |
| `txk_cola_v2` | B1, cola de fichas | **no** |
| `txk_cola_cuarentena` | B1 | **no** |
| **`txk_eventos_v1`** | B2, cola de eventos | nueva |
| **`txk_eventos_sin_identidad`** | B2 | nueva |
| **`txk_eventos_registro`** | B2, contadores | nueva |

**B1 y B2 no comparten clave ni parser.** No se borra ni se reinterpreta ninguna
entrada heredada.

**Rollback de versión.** v7.451 y v7.453 no conocen las tres claves nuevas: no las
leen, no las escriben, **no pueden destruirlas**. Al volver a una versión con B2,
la cola sigue ahí y drena con su backoff; lo que pase de 30 días entra como
`revisar`. *(Además, conviene invertir la guarda de versión de `_colaCargar` para
que evalúe `v > 2` **antes** de exigir `nombre`: no hace falta para B2 —van por
claves distintas— pero la trampa seguiría armada para el siguiente formato.)*

---

## 14 · Matriz de tests

Los 28 casos que pides, con dónde se prueban. **Ninguno necesita red**: la CI sólo
ejecuta `node tests/smoke.mjs` con Node puro.

| # | Caso | Cómo se prueba |
|---|---|---|
| 1 | Identidad offline con JWT persistido | arnés: `meseo-auth` con token caducado → `uid` recuperado, evento con dueño |
| 2 | JWT caducado | `exp` en el pasado → `identidad_sin_token`, 0 envíos |
| 3 | Ningún JWT | evento en `txk_eventos_sin_identidad`; `txk_eventos_v1` vacío |
| 4 | **Cambio de usuario durante un `await`** | drenaje con `_authPoner` a mitad → aborta, 0 peticiones con token cruzado |
| 5 | Logout durante el POST | ídem, el resto queda `retenido` |
| 6 | Refresco durante el POST | token nuevo, mismo `sub` → sin efecto |
| 7 | `token`/`uid` descuadrados | `_jwtSub(token) !== uid` → no se envía |
| 8 | **`uid:null` nunca enviado** | el drenaje no abre esa clave: 0 lecturas de `txk_eventos_sin_identidad` |
| 9 | `evento_id` estable en el reintento | 3 fallos y un éxito → mismo id las 4 veces |
| 10 | Duplicado propio → idempotente | 409+`23505`+índice → fuera, 1 sola fila |
| 11 | `evento_id` de Ana reutilizado por Bruno | fila de Bruno, la de Ana intacta *(probado ya en B2.2 con índice parcial real)* |
| 12-16 | `employee`/`venue`/`auth_user_id`/`id`/`created_at` falsificados | **ya cubierto y aplicado en C-2/C-3**; se repite la guarda del cuerpo |
| 17 | `23505` | doble de `fetch` → duplicado |
| 18 | `23503` | → cuarentena, **no** duplicado |
| 19 | `42501` | → cuarentena, sin reintento infinito |
| 20 | `PGRST301` | con `exp` pasado → renovar; con `exp` futuro → 1 intento y `revisar` |
| 21 | `400` | `PGRST204`/`23502` → `revisar`+apagar; `23514` → cuarentena |
| 22 | `5xx` | → `pendiente` con backoff creciente |
| 23 | timeout | → `pendiente` con backoff |
| 24 | **QuotaExceeded** | `setItem` que lanza → `bloqueado_por_cuota`, **el llamante no recibe «persistido»** |
| 25 | cola > 400 | práctica descartada, contada, contador **sobrevive a recargar** |
| 26 | cola > 500 | aviso; **nada se rechaza** |
| 27 | **evaluación con la cola > 500** | **entra** |
| 28 | rollback de versión | `_colaCargar` de v7.453 sobre `txk_eventos_v1` → intacta |
| 29 | dos pestañas | escrituras concurrentes simuladas → ninguna anotación perdida |

### Mutaciones obligatorias, una por invariante crítica

| Mutación | Debe caer |
|---|---|
| Quitar `_authCtx() !== s` del drenaje | el caso 4 |
| Quitar `_jwtSub(token) === uid` | el caso 7 |
| Hacer que el drenaje lea `txk_eventos_sin_identidad` | el caso 8 |
| Generar el `evento_id` al enviar en vez de al ocurrir | el caso 9 |
| Usar `Math.random` para el UUID | prueba propia |
| Tratar cualquier 409 como duplicado | el caso 18 |
| Clasificar por estado HTTP en vez de por `code` | los casos 19 y 20 |
| Volver a tragarse `QuotaExceededError` | el caso 24 |
| Permitir descartar evaluaciones por espacio | los casos 26 y 27 |
| Quitar el filtro por `uid` del drenaje | el caso *Ana→Bruno* |
| Usar `txk_cola_v2` para eventos | el caso 28 |
| Recortar la cuarentena en silencio | prueba propia |
| Quitar `evento_id` del `grant insert` | la guarda de C-3 |
| Añadir `UNIQUE(evento_id)` global | guarda sobre el SQL |

---

## 15 · Riesgos restantes

| | Riesgo | Gravedad | Estado |
|---|---|---|---|
| **R1** | **La medición en iPad sigue pendiente.** `LIMITE_DURO`, la penalización ×4 y el techo de 5 MB son Chromium de escritorio | **alta** | **bloquea declarar B2 lista**, no implementarla. La sonda está publicada |
| **R2** | **Desalojo de WebKit a los 7 días** si la app se usa en pestaña y no instalada | **alta** | si se confirma, el «offline prolongado» no tiene respaldo y hay que rediseñarlo |
| **R3** | **Ventana de pérdida entre C-3 y B2**: hoy, una sesión sin token no escribe, y en `actividad` en silencio | **alta** | **es lo que B2 cierra**; cuanto antes, mejor |
| **R4** | El SHA del PIN sigue siendo credencial al portador | alta | **B2 no lo arregla**: cierra la falsificación del cuerpo, no la suplantación de la sesión |
| **R5** | Sin reclamación humana, un evento `sin_identidad` no llega nunca a la nube | media | **decidido**: se repite la prueba. Visible, no silencioso |
| **R6** | `iOS < 15.4` sin `navigator.locks` ni `randomUUID` | media | respaldo definido para los dos; **confirmar la flota** |
| **R7** | Empleado desactivado | media | fuera de alcance |
| **R8** | Deuda de `employees`: disparador que no protege, `name` renombrable, histórico colgando del nombre | media | documentada; **no se toca** |

---

## 16 · Orden de implementación

Propongo un orden distinto del sugerido, y explico por qué.

**El esquema no puede ir primero del todo, y el `writer` no puede ir solo.** Si la
cola empieza a acumular eventos mientras el camino directo actual sigue
escribiendo *sin* `evento_id`, al encender el drenaje se duplicaría todo: esas
filas no están en el índice y no se deduplican. La transición segura es que **el
envío directo pase a llevar el mismo `evento_id` que el evento encolado**, y
entonces el solape es idempotente por construcción.

| Fase | Qué | Reversible | Observable |
|---|---|---|---|
| **F0** | **Identidad**: `_authCtx()` congelado; los 11 sitios pasan a leerlo. Puro refactor | `git revert` | **nada** |
| **F1** | **Esquema**: `evento_id`, los dos `CHECK`, los dos índices parciales, `grant insert (evento_id)`. Actualizar la guarda de C-3 | `drop` de índice, constraint y columna | **nada**: nadie manda `evento_id` todavía |
| **F2** | **Alta y persistencia**: `_eventoCrear`, escritura síncrona, capacidad, `sin_identidad`, registro de contadores. **Y el envío directo pasa a llevar el `evento_id` del evento y a confirmarlo al recibir 201** | `git revert` | **nada**: mismo comportamiento, ahora idempotente |
| **F3** | **Drenaje**: sustituye al envío directo (el primer intento lo hace él), orden por prioridad y `ts`, las cuatro comprobaciones, cerrojo | `git revert` | el aviso de «no se pudo guardar» deja de aparecer por falta de red |
| **F4** | **Errores y reintentos**: clasificación por `code`, backoff, `revisar` | `git revert` | mensajes más precisos |
| **F5** | **Cuarentena**: sin recorte, contadores persistentes | `git revert` | — |
| **F6** | **Superficie de incidencias**: sólo cuando hay algo que atender | `git revert` | aparece un aviso donde antes no había nada |
| **F7** | **Pruebas y mutaciones**: se escriben **en cada fase**, no al final. Ésta es el cierre | — | — |
| **F8** | **Verificación contra producción** y, **con tu autorización aparte**, publicación | — | — |

**Cada fase es un commit, con su suite en verde y sin publicar.** F0 y F1 se pueden
aplicar y dejar reposar sin ningún efecto visible, que es lo que las hace buen
sitio para empezar.

**Un cambio de comportamiento que conviene aprobar explícitamente (F3):** hoy
`supaInsertScore` muestra *«No se pudo guardar la puntuación en la nube»* con un
botón de reintentar. Con la cola, esa frase pasa a ser **falsa** —sí se ha
guardado, en el dispositivo, y se enviará sola—, así que desaparece para los
eventos encolados y se sustituye por la superficie de incidencias, que sólo habla
cuando hay algo que el empleado deba hacer.

---

## Lo que este plan NO hace

No publica. No despliega. No modifica datos. No elimina la cola de B1. No toca
C-3, ni Auth, ni el PIN, ni `sesion`, ni Supervisor, ni la navegación. No crea
`UNIQUE(evento_id)`. No usa `employee` como identidad. No inventa actividades. No
implementa la reclamación de eventos sin identidad. No arregla la deuda de
`employees`.

---

# B2 PLAN LISTO PARA APROBACIÓN

Tres cosas quiero que decidas al aprobarlo, porque cambian el resultado:

1. **El orden F0→F8**, y en particular que **F2 haga que el envío directo lleve el
   `evento_id`**. Es lo que hace la transición idempotente en vez de duplicadora.
2. **El cambio del aviso de `supaInsertScore`** en F3: hoy dice algo que con la
   cola dejaría de ser cierto.
3. **Que la medición en el iPad sigue pendiente** (R1, R2). No bloquea implementar
   —F0 a F7 no dependen de ella— pero **sí bloquea declarar B2 terminada**, porque
   si WebKit desaloja el almacenamiento a los siete días, la cola no puede
   sostener semanas sin red y eso es rediseño, no ajuste.

No he implementado nada y espero tu aprobación.
