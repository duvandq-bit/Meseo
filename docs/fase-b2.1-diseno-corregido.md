# FASE B2.1 — Diseño corregido de la cola de eventos

**Nada implementado. Ningún SQL, ningún esquema, ningún dato, ningún despliegue,
ningún cambio en `sesion`, RLS sin tocar.** Este documento sustituye a
`fase-b2-especificacion.md` y a `fase-b2-unicidad-y-limites.md` como
especificación vigente; aquéllos quedan como registro de cómo se llegó aquí.

Base: producción v7.451. Rama `claude/check-app-version-rDp39` en v7.452 (B1,
`b1-cerrada`, **sin publicar**). B2 sería v7.453 o posterior.

Origen: auditoría independiente de Fable 5.1 sobre `fase-b2-especificacion.md`,
que encontró tres fallos críticos, siete altos y ocho medios. Todos se tratan
aquí, ninguno se descarta.

---

## 1 · Cambios respecto a B2

Lo que **no** cambia, y sigue siendo la arquitectura: `evento_id` generado en el
momento del hecho; `UNIQUE (auth_user_id, evento_id)` y no `UNIQUE (evento_id)`;
`auth_user_id` derivado siempre por el servidor de `auth.uid()`; 409 con `23505`
del índice correcto como éxito idempotente; cola local; eventos de evaluación y
práctica; alérgenos con prioridad; **cero heurísticas de identidad**.

Lo que cambia:

| # | B2 decía | B2.1 dice | Por qué |
|---|---|---|---|
| 1 | La identidad es `_authUid`, que se llena tras hablar con `sesion` | **`authContext` congelado**, reconstruible **sin red** desde el `sub` del JWT persistido | C1: sin red `_authUid` era `null` y el evento acababa enviado por otro |
| 2 | El filtro por `uid` y la cabecera se leen cuando toca | **Un solo snapshot inmutable** por drenaje, verificado por identidad de referencia antes de cada POST | C2: `_authToken` y `_authUid` cambian en instantes distintos |
| 3 | «El cuerpo no lleva `employee` ni `venue`» | **Opción A formalizada**: B2 *depende* de la fase de autoridad. Antes de ella, B2 **no envía** | C3: hoy esas columnas son `NOT NULL` sin `DEFAULT` |
| 4 | «409 / `23505`» | Clasificación por **HTTP + código PostgREST + SQLSTATE + nombre del índice** | A4: 409 también es `23503`; 401 también es `42501` |
| 5 | El evento se guarda con la ficha | **Persistencia síncrona en el instante del hecho**, fuera de `saveDB()` | A5/J: `saveDB` tiene 1 500 ms de retardo y `beforeunload` no es fiable en iOS |
| 6 | `_colaGuardar` traga el fallo de `setItem` | **`no_persistido` y `bloqueado_por_cuota` son estados reales y visibles** | A1: se afirmaba «guardado» sin haber guardado |
| 7 | Cuarentena recortada a 200 en silencio | **Sin recorte silencioso**; desbordamiento contabilizado y mostrado | A2 |
| 8 | Misma clave `txk_cola_v2` que B1 | **Clave propia `txk_eventos_v1`** | A6: el parser de B1 destruye lo que no tiene `nombre` |
| 9 | 500 es un tope duro; a 500 la cola se «bloquea» | **500 es umbral de aviso, no de rechazo.** Sólo la prioridad 3 se rechaza (a 400). Las evaluaciones sólo las limita lo físico | La medición demostró que ni los bytes ni la CPU justifican rechazar una evaluación a 500 |
| 10 | «El chip de sincronización lo dice» | **Falso hoy**: `_setSyncPill` (`index.html:4731`) sólo pinta `offline`; el resto está oculto por decisión del propietario. B2.1 define una superficie propia | M1/M2 |
| 11 | Reintento sin cota | **Backoff por evento + estado `revisar`** | M3 |
| 12 | Cuota medida con `Blob` en Chromium | **`JSON.stringify(x).length`** (unidades UTF-16) y medición obligatoria en iPad | M6 |
| 13 | No se hablaba de dos pestañas | **`navigator.locks`** con suelo de plataforma declarado | M8 |

---

## 2 · Arquitectura final

```
   EL HECHO OCURRE  (fin de un simulacro, de un examen, de un repaso)
          │
          │  síncrono, en el mismo tick, ANTES de puntuar, renderizar o await
          ▼
   ┌──────────────────────────────────────────────────────────────┐
   │  _eventoCrear(destino, prioridad, datos)                     │
   │    evento_id = uuidv4()        ← crypto, nunca Math.random   │
   │    snapshot  = authContext     ← congelado, puede ser vacío  │
   │    ts        = Date.now()      ← el momento del HECHO        │
   └───────────────┬──────────────────────────────────────────────┘
                   │
       ¿snapshot.uid?  ──no──►  txk_eventos_sin_identidad   (nunca se envía)
                   │ sí
                   ▼
       ¿cabe? (lógico y físico)  ──no──►  descartado (P3)  |  no_persistido (P1/P2)
                   │ sí
                   ▼
            txk_eventos_v1      ← setItem SÍNCRONO; su resultado manda
                   │
                   │  disparadores: online · visibilitychange · 120 s · +4 s
                   ▼
   ┌──────────────────────────────────────────────────────────────┐
   │  _eventosDrenar()                                            │
   │    const s = authContext            ← UN solo snapshot        │
   │    por cada evento, en orden (prioridad ↑, ts ↑):            │
   │      e.uid !== s.uid            → retenido, no se toca       │
   │      authContext !== s          → ABORTA el drenaje entero   │
   │      jwtSub(s.token) !== s.uid  → no se envía                │
   │      POST con Authorization: Bearer s.token                  │
   └───────────────┬──────────────────────────────────────────────┘
                   ▼
            clasificar respuesta (§8)  →  fuera | pendiente | cuarentena | revisar
```

**Las tres autoridades, separadas a propósito:**

| Quién | De qué es autoridad | Qué pasa si falla |
|---|---|---|
| **El servidor** | de quién es la fila (`auth.uid()`), qué nombre y restaurante lleva (`DEFAULT`), si es duplicada (`UNIQUE`) | nada: es la única autoridad real |
| **El cliente** | si *intenta* enviar, y si cabe | retención o rechazo visible, **nunca atribución errónea** |
| **El almacenamiento** | si el hecho sobrevive a cerrar la pestaña | estado `no_persistido` **visible**, nunca un falso «guardado» |

---

## 3 · Identidad y sesión

### 3.1 · Un único objeto, congelado (C2, M4)

Desaparecen `_authUid` y `_authToken` como variables independientes.

```js
// La identidad de la sesión. INMUTABLE: no se muta nunca, se SUSTITUYE entera.
// Que sea un objeto congelado es lo que permite detectar un cambio de empleado
// con una sola comparación de referencia, incluso a mitad de un await.
let _auth = Object.freeze({
  uid:      null,   // sub del JWT. Etiqueta local, NUNCA autoridad
  token:    null,   // access_token vigente, o null si caducado/ausente
  exp:      0,      // caducidad del token, en segundos epoch
  empleado: null,   // a nombre de quién, según el servidor. Diagnóstico
  estado:   'anonimo'   // ver tabla 3.2
});
function _authCtx(){ return _auth; }                      // síncrono siempre
function _authPoner(next){ _auth = Object.freeze(next); } // ÚNICA vía de cambio
```

`_bearer()` **desaparece del camino de eventos**. Ninguna función de B2 lee la
identidad global: la recibe como parámetro desde el snapshot capturado arriba.

### 3.2 · Los cuatro estados de la sesión

| `estado` | `uid` | `token` | Puede crear eventos | Puede enviarlos |
|---|---|---|---|---|
| `anonimo` | `null` | `null` | sí, como `sin_identidad` | **no** |
| `identidad_sin_token` | **sí** | `null` | **sí, con dueño** | no, hasta renovar |
| `activa` | sí | sí | sí | **sí** |
| `caducando` | sí | sí, con `exp` pasado | sí | se renueva antes de enviar |

El estado que B2 añade y que B2 no tenía es **`identidad_sin_token`**: sé quién
eres, no puedo hablar por ti todavía. Es el estado normal de un móvil que se
abre sin cobertura, y es exactamente el agujero de C1.

### 3.3 · Caso A — sesión persistida y recarga sin red

**Cómo se restaura la identidad.** Al arrancar, **antes** de cualquier petición y
de forma síncrona, se lee la entrada que `supabase-js` dejó en el almacén
`meseo-auth` (hoy `localStorage` si hay «recordarme», memoria si no —
`index.html:969-985`). De ella se extrae el `access_token` y se decodifica **sólo
su carga útil**:

```js
function _jwtSub(t){
  try{
    const p = String(t).split('.')[1];
    if(!p) return null;
    const j = JSON.parse(atob(p.replace(/-/g,'+').replace(/_/g,'/')));
    return (typeof j.sub === 'string' && j.sub) ? j.sub : null;
  }catch(_){ return null; }
}
```

> **Esto no verifica nada y no pretende hacerlo.** El cliente no puede validar la
> firma y no le hace falta: el `sub` se usa **como etiqueta de propiedad local**,
> para decidir a quién pertenece una entrada de la cola. La autoridad sigue
> saliendo del token firmado cuando el servidor lo valida. Manipular ese `sub` en
> `localStorage` no permite escribir nada a nombre de nadie (caso 5 de §17).

**Qué ocurre si el access token está caducado.** El `sub` de un JWT caducado
sigue identificando al dueño: la caducidad limita *hablar*, no *ser*. Se entra en
`identidad_sin_token`:

```
uid = _jwtSub(persistido.access_token)      ← aunque exp < ahora
token = (exp > ahora + 60) ? access_token : null
estado = token ? 'activa' : 'identidad_sin_token'
```

Los eventos que se creen a partir de ahí llevan `uid` real y quedan `pendiente`.
No se envían: el drenaje exige `token` (§4.3).

**Qué dato se considera suficiente para identificar al propietario localmente.**
Sólo uno: **el `sub` de un JWT que GoTrue emitió y este dispositivo guardó**. No
el nombre, no `currentUser`, no el hash del PIN, no `txoko_session`, no
`txk_last_user`. Un `sub` sin JWT del que proceda no vale.

**Cuándo se puede volver a sincronizar.** Cuando exista un `token` cuyo `sub`
coincida con `uid`. Tres caminos, por orden de coste:

1. **Renovación automática** de `supabase-js` (`autoRefreshToken`), que necesita
   red y un refresh token vivo. Su `onAuthStateChange` sustituye el snapshot.
2. **Renovación forzada al volver la red**: `online` llama a `getSession()` /
   `refreshSession()`. Hoy eso **no existe** — la sesión sólo se vuelve a pedir
   al recargar (`index.html:33647`). Es un requisito nuevo de B2.1 (corrige A7).
3. **Re-autenticación** por `sesion` con el hash del PIN, como hoy, si el refresh
   token también caducó.

En los tres, si el `sub` que vuelve **no** coincide con el `uid` de un evento,
ese evento **no** se envía: pasa a `retenido`. Eso es D.

### 3.4 · Caso B — login sin red y sin sesión persistida

Es el iPad compartido sin «recordarme» que se abre sin cobertura. No hay ningún
JWT en el dispositivo, así que **no hay forma honesta de saber quién es**: el
login antiguo compara con la ficha local (`index.html:33640`) y eso identifica un
*nombre*, no una identidad.

**Contrato:**

- El evento se crea con `uid: null` y estado **`sin_identidad`**.
- Se persiste, síncronamente, en **`txk_eventos_sin_identidad`** — un almacén
  **distinto** del de la cola de envío.
- **No entra en la cola de envío.** Ninguna ruta de código lo lee para enviarlo.
  La invariante C se cumple por construcción, no por comprobación: el drenaje
  ni siquiera abre esa clave.
- **Es visible desde el primer momento** (§ «visibilidad», 6.5), no cuando vuelva
  la red: *«3 pruebas hechas sin identificar. No se han enviado.»*
- Guarda `nombre_tecleado` y `ts`. **`nombre_tecleado` no es identidad y no se
  envía nunca al servidor como atribución.** Sirve para dos cosas: enseñárselo a
  la persona, y el filtro del punto siguiente.

**Cómo puede recuperarse legítimamente.** Sólo hay un camino que no reintroduce
una heurística: **una reclamación explícita de un humano autenticado.**

```
Requisitos, los cuatro a la vez:
  1. existe una sesión con estado 'activa' (token válido, sub verificado por el
     servidor al emitirlo);
  2. `j.empleado` que devolvió `sesion` —el nombre que el SERVIDOR asoció a ese
     uid— es igual a `nombre_tecleado` del evento;
  3. la persona lo confirma con un gesto explícito en pantalla, viendo qué
     prueba es, de qué día y con qué resultado;
  4. el evento viaja marcado: `meta.origen = 'reclamado_sin_identidad'`,
     `meta.nombre_tecleado`, `meta.ts_hecho`.
```

El punto 2 es una **puerta**, no una atribución: quien atribuye sigue siendo el
servidor con `auth.uid()`. El punto 4 hace que la reclamación sea auditable: en
el panel de Supervisor una fila reclamada se distingue de una nativa.

> **Riesgo residual, dicho sin adornos.** En un iPad compartido, Bruno que
> conociera el nombre de Ana podría teclearlo, quedarse sin red, hacer una prueba,
> y más tarde… no: el evento quedaría a nombre del *tecleado*, y la puerta exige
> que su propia sesión sea de ese nombre. Lo que Bruno **sí** puede hacer es
> reclamar como suya una prueba que Ana hizo sin identidad **si Ana tecleó el
> nombre de Bruno**, que es un caso que no ocurre. El riesgo real es el inverso y
> menor: Ana no reclama y su prueba se queda sin enviar.
>
> **Aun así, el punto 2 es una comparación textual de nombre.** El propietario
> descartó las comparaciones textuales *para adoptar automáticamente*. Aquí no
> hay adopción automática —hay una persona autenticada confirmando— pero la
> diferencia es de matiz y **requiere su aprobación explícita**. Si la deniega, el
> comportamiento por defecto es el del párrafo siguiente, que es seguro y ya
> sirve.

**Por defecto, si no se aprueba la reclamación:** el evento `sin_identidad` no se
recupera nunca. Se muestra, se cuenta, no se borra, y el mensaje es *«esta prueba
no se pudo asociar a nadie; repítela cuando tengas conexión»*. Para un simulacro
de alérgenos de tres minutos, repetirlo cuesta menos que arriesgar una atribución
falsa. **Es la opción recomendada.**

**Cuándo ocurre de verdad este caso.** Sólo si en esa pestaña **nunca** hubo
sesión con red. Si Ana entró con cobertura y la perdió después, su `uid` está en
memoria y estamos en el caso A. Si tiene «recordarme», está en `localStorage` y
también. El caso B es el iPad compartido arrancado en frío sin wifi — estrecho,
pero es precisamente el dispositivo de mayor riesgo, y por eso su contrato es el
más restrictivo.

### 3.5 · Si cierra sesión antes de recuperar la red

`_authSesionSalir` sustituye el snapshot por el vacío (`anonimo`). Los eventos ya
creados conservan su `uid` en disco. A partir de ahí:

- Están **`retenido`**: el drenaje los salta (`e.uid !== s.uid`, y con
  `s.uid === null` ningún evento con dueño coincide).
- **Nadie más los envía.** Ni el siguiente empleado, ni el camino anónimo.
- Se cuentan y se ven, atribuidos a «otra persona» sin decir quién (en un
  dispositivo compartido, el nombre de quién tiene cosas pendientes no es asunto
  de quien está delante).
- Vuelven a `pendiente` en cuanto una sesión `activa` tenga ese mismo `uid`.
- Si pasan **30 días** en `retenido`, pasan a `revisar`: siguen sin borrarse,
  pero dejan de contar como «pendiente normal» y se señalan como incidencia.

**Invariantes C y D, y por qué se cumplen:**

> **C · Un evento con `uid:null` nunca viaja al endpoint de B2.** Porque vive en
> otra clave de almacenamiento que el drenaje no lee. No es una comprobación que
> se pueda olvidar: es una ruta de código que no existe.
>
> **D · Un evento de Ana nunca se envía con el token de Bruno.** Tres cierres
> independientes, y hacen falta los tres: (1) `e.uid !== s.uid` → no se toca;
> (2) `_authCtx() !== s` antes del POST → aborta; (3) `_jwtSub(s.token) !== s.uid`
> → no se envía. Cualquiera de los tres solo bastaría; están los tres porque el
> coste es una comparación y lo que protegen es la integridad de una evidencia
> de seguridad alimentaria.

---

## 4 · Contrato del evento

### 4.1 · Forma en disco

```js
{
  v: 1,                          // versión del formato de EVENTO (independiente de B1)
  evento_id: '<uuid v4>',        // en el instante del hecho
  destino: 'scores' | 'actividad',
  prioridad: 1 | 2 | 3,          // 1 alérgenos · 2 evaluación · 3 práctica
  uid: '<sub del JWT>' | null,   // congelado al crear. null ⇒ otro almacén
  ts: 1789430000000,             // Date.now() del HECHO
  datos: { … },                  // SIN employee, SIN venue, SIN auth_user_id
  intentos: 0,
  proximo: 0,                    // epoch ms; 0 = ya
  estado: 'pendiente'            // ver §7
}
```

`datos` para `scores`: `{ score, total, topic, cat, time_sec }`.
`datos` para `actividad`: `{ activity, competency, kind, score, total, seconds, meta }`.

`meta.ts_hecho` lleva el momento real del hecho. `created_at` lo sigue poniendo
el servidor. **Los dos coexisten**: uno es la verdad del servidor, el otro la del
hecho. Para un simulacro de alérgenos —que es evidencia— importa el segundo.

### 4.2 · Generación del `evento_id`

```js
function _uuid(){
  if(crypto && crypto.randomUUID) return crypto.randomUUID();
  const b = new Uint8Array(16); crypto.getRandomValues(b);   // NUNCA Math.random
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2,'0')).join('');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
```

`crypto.randomUUID` exige iOS 15.4+; `getRandomValues` está desde iOS 6. **En
ningún caso `Math.random`**: con él la colisión deja de ser 2⁻¹²² y la
idempotencia se convierte en pérdida de datos. Es una prohibición, no una
preferencia, y tiene test propio.

### 4.3 · El POST

```
POST /rest/v1/{scores|actividad}?select=id
Authorization: Bearer <s.token>        ← del snapshot, no de una global
apikey: <SUPA_KEY>
Prefer: return=representation
Content-Type: application/json

{ "evento_id": "<uuid>", ...datos }    ← y NADA MÁS
```

**El cuerpo no lleva `employee`, ni `venue`, ni `auth_user_id`.** Eso sólo es
posible después de la fase de autoridad; §5.3 dice qué pasa si no está.

**Sin lotes.** En serie, uno a uno: un lote que falla a medias es indistinguible
de uno que falla entero, y eso reintroduce la ambigüedad que todo esto elimina.

### 4.4 · Qué genera eventos y qué no

Sin cambios respecto a B2 §3, que sigue siendo válido:

| Prioridad | Qué | Cuántos |
|---|---|---|
| **1** | Simulacro de alérgenos | 1 actividad |
| **2** | Examen general, examen de sala, examen LQA, situaciones LQA, auditor LQA, servicio fantasma, quiz de vinos, maridaje | 8 actividades |
| **3** | Repaso/SRS, recorrido de carta, reto del día | 3 actividades |
| **fuera** | Survivors, Mr. Shoesmith, récord Txoko, récord El Turno | 4 |

**La cuenta de administración no genera eventos.** `_esAdmin(currentUser)` corta
antes de crear, igual que hace hoy `supaInsertScore` (`index.html:2833`) y
`registrarActividad` (`2373`). Si un evento de administrador llegara al servidor,
`admin_sin_marcas` (`supabase/administracion_no_puntua.sql:59-72`) devuelve `NULL`
en el `BEFORE INSERT` → **201 con cuerpo `[]`**. Ésa es la única fuente conocida
de «2xx con cero filas», y §8 la manda a cuarentena. Correcto: significa que el
corte del cliente falló y hay que verlo.

---

## 5 · `event_id`, idempotencia y la dependencia de servidor

### 5.1 · La decisión de unicidad se mantiene

`UNIQUE (auth_user_id, evento_id) WHERE evento_id IS NOT NULL`, y **no**
`UNIQUE (evento_id)`, y **no** las dos. La razón está medida y no ha cambiado: en
un iPad compartido, Bruno puede leer los `evento_id` pendientes de Ana en
`localStorage` y, con un índice global, gastarlos antes que ella para que sus
simulacros se rechacen como duplicados. Con el índice compuesto eso es imposible
por construcción: Bruno obtiene `(Bruno, X)`, Ana conserva `(Ana, X)`.

El índice **parcial** deja intactas las 427 filas de `scores` y las 5 de
`actividad` que no tendrán `evento_id`: `NULL` no colisiona consigo mismo.

### 5.2 · Arquitectura elegida: **A** (la preferencia del propietario)

**El cliente no envía identidad semántica. El servidor la deriva.** B2 queda
**formalmente dependiente** de la fase de autoridad.

Lo que debe existir **antes** de que B2 pueda enviar un solo evento:

```sql
-- REQUISITOS. NO EJECUTAR. Orden significativo.

-- (1) Las dos funciones de identidad (fase C). SECURITY DEFINER, search_path fijo.
create or replace function app.mi_nombre() returns text
  language sql security definer stable set search_path = public as
  $$ select name  from public.employees where auth_user_id = auth.uid() $$;
create or replace function app.mi_venue() returns text
  language sql security definer stable set search_path = public as
  $$ select venue from public.employees where auth_user_id = auth.uid() $$;

-- (2) Columnas. auth_user_id NULLABLE: las 432 filas históricas no tienen dueño.
alter table public.scores
  add column evento_id uuid,
  add column auth_user_id uuid default auth.uid();
alter table public.actividad
  add column evento_id uuid,
  add column auth_user_id uuid default auth.uid();

-- (3) LA DEFENSA QUE PIDE EL CONTRATO: un evento SIEMPRE tiene dueño.
alter table public.scores    add constraint scores_evento_con_dueno
  check (evento_id is null or auth_user_id is not null) not valid;
alter table public.actividad add constraint actividad_evento_con_dueno
  check (evento_id is null or auth_user_id is not null) not valid;
-- `not valid` para no recorrer el histórico; luego `validate constraint`.

-- (4) Identidad semántica puesta por el servidor.
alter table public.scores    alter column employee set default app.mi_nombre(),
                             alter column venue    set default app.mi_venue();
alter table public.actividad alter column employee set default app.mi_nombre(),
                             alter column venue    set default app.mi_venue();

-- (5) SIN ESTO TODO LO ANTERIOR ES DECORATIVO.
revoke insert (auth_user_id, employee, venue) on public.scores    from anon, authenticated;
revoke insert (auth_user_id, employee, venue) on public.actividad from anon, authenticated;

-- (6) La idempotencia, atada a la identidad.
create unique index concurrently scores_evt_uk
  on public.scores    (auth_user_id, evento_id) where evento_id is not null;
create unique index concurrently actividad_evt_uk
  on public.actividad (auth_user_id, evento_id) where evento_id is not null;

-- (7) La política.
create policy scores_alta_propia on public.scores
  for insert to authenticated with check ( auth_user_id = auth.uid() );
create policy actividad_alta_propia on public.actividad
  for insert to authenticated with check ( auth_user_id = auth.uid() );
```

**Por qué el `revoke` del punto 5 es la pieza que sostiene todo.** Sin él, un
`DEFAULT` es sólo lo que se usa *cuando el cliente no manda la columna*: mandarla
lo anula. Con él, mandarla es `42501`. El caso que el propietario prohíbe
explícitamente —**token de Bruno + `employee:'Ana'` + `venue:'mb'` que resulte en
una fila válida**— muere aquí y **sólo** aquí: la política `with check
(auth_user_id = auth.uid())` no lo impediría, porque `auth_user_id` sería
correctamente Bruno y `employee` es una columna que la política no mira. Ése era
el fallo C3 de la auditoría y es el motivo de que el `revoke` incluya las tres
columnas y no sólo `auth_user_id`.

**Por qué hace falta además el `CHECK` del punto 3.** Un evento enviado con la
clave anónima tendría `auth_user_id = NULL` (`auth.uid()` es `NULL` para `anon`),
quedaría **fuera del índice parcial** y por tanto **sin idempotencia**: un timeout
seguido de reintento crearía dos filas. El `CHECK` lo convierte en `23514 → 400 →
cuarentena`, que es ruidoso y correcto. Es el cinturón de la invariante C del
lado del servidor.

### 5.3 · Qué ocurre si B2 se ejecuta antes de la precondición

Dos cierres, uno explícito y otro de fondo:

**1 · Interruptor explícito.** B2 se publica con

```js
const B2_ENVIO = false;   // se pone a true SÓLO tras verificar §18 en producción
```

Con `false`, **los eventos se crean y se persisten con normalidad, pero no se
envía ninguno**. Es una propiedad deseable, no una limitación: la cola empieza a
ser durable antes de que el servidor esté listo, y drena sola al activarla. Los
límites de §9 se aplican igual, así que no puede crecer sin freno.

**2 · Firma de diagnóstico, por si el interruptor se activa antes de tiempo.** El
cliente reconoce el síntoma y lo dice en vez de tragárselo:

| Falta | Respuesta | Estado B2.1 |
|---|---|---|
| La columna `evento_id` | **400 `PGRST204`** «column … does not exist» | **`revisar`, y `B2_ENVIO` se apaga solo** |
| El `DEFAULT` de `employee` | **400 `23502`** null value in column "employee" | **`revisar`**, y se apaga |
| El `revoke` (columna aún escribible) | 201 — indistinguible del éxito | **no detectable desde el cliente**: por eso §18 lo verifica contra el servidor antes de activar |

El apagado automático ante `PGRST204`/`23502` evita el peor escenario de C3: que
el 100 % de los eventos acabe en cuarentena mientras la aplicación parece sana.
Se detiene al primero y se avisa.

---

## 6 · Cola y almacenamiento

### 6.1 · Tres claves, y por qué son tres

| Clave | Qué guarda | Quién la lee |
|---|---|---|
| `txk_eventos_v1` | eventos con dueño, pendientes de envío | el drenaje de B2 |
| `txk_eventos_sin_identidad` | eventos sin dueño (§3.4) | **sólo la pantalla**; el drenaje jamás |
| `txk_eventos_registro` | descartes, desbordes de cuarentena y contadores | la pantalla |

La cuarentena sigue en `txk_cola_cuarentena`, compartida con B1, con el contrato
corregido de §14.

**Ninguna es `txk_cola_v2`.** Ésa es la cola de fichas de B1 y no se toca.

### 6.2 · Persistencia síncrona en el instante del hecho (A5, J)

```js
// Se llama EN EL MISMO TICK en que termina la prueba, ANTES de:
//   · awardXP()        · registrarActividad()   · supaInsertScore()
//   · renderizar el resultado    · cualquier await
// Devuelve el estado REAL de persistencia. Quien lo llama DEBE mirarlo.
function _eventoCrear(destino, prioridad, datos) → 'persistido'
                                                 | 'sin_identidad'
                                                 | 'descartado'
                                                 | 'bloqueado_por_cuota'
                                                 | 'no_persistido'
```

**No se usa `saveDB()`**, que difiere la escritura 1 500 ms (`index.html:4846`).
**No se confía en `beforeunload`**, que en iOS no se dispara de forma fiable al
matar la aplicación; `visibilitychange:hidden` ya existe (`32862`) y `pagehide`
debe añadirse, pero como refuerzo — **la corrección de verdad es que no haya nada
pendiente de volcar**, porque el evento se escribió en el instante del hecho.

Respuesta exacta a **J**: si el navegador muere inmediatamente después de aceptar
una evaluación, el evento ya está en `localStorage` porque `setItem` es síncrono y
ya devolvió. Si `setItem` no llegó a devolver, el hecho no se aceptó y el usuario
no vio «guardado».

### 6.3 · Qué ocurre si `setItem` falla (A1)

`_colaGuardar` **deja de tragar el error**. La regla dura:

> **No existe ninguna ruta en la que el código continúe como si el evento
> estuviera guardado cuando `setItem` falló.**

```js
function _eventosGuardar(lista){            // devuelve true | 'cuota' | false
  let s; try{ s = JSON.stringify(lista); }catch(_){ return false; }
  try{ localStorage.setItem(_EV_KEY, s); return true; }
  catch(e){
    const cuota = e && (e.name==='QuotaExceededError' ||
                        e.name==='NS_ERROR_DOM_QUOTA_REACHED' ||
                        e.code===22 || e.code===1014);
    return cuota ? 'cuota' : false;
  }
}
```

| Resultado | Estado del evento | Qué ve el usuario | Cómo se reintenta |
|---|---|---|---|
| `true` | `pendiente` | nada (es lo normal) | — |
| `'cuota'` | **`bloqueado_por_cuota`** | aviso persistente: *«N pruebas sin guardar — falta espacio en el dispositivo»*, con qué liberar | tras liberar espacio, en cada drenaje, y tras cada envío confirmado (que libera sitio) |
| `false` | **`no_persistido`** | aviso persistente: *«N pruebas sin guardar en este dispositivo»* | en cada drenaje y en cada nuevo evento |

En los dos casos de fallo el evento **permanece en una lista en memoria**
(`_eventosMemoria`), que es la unión de lo persistido y lo no persistido. Es
volátil **y el aviso lo dice**: es la diferencia entre perder datos y perderlos en
silencio. Un evento `no_persistido` que se **envía** con éxito termina igual de
bien que cualquier otro: la durabilidad sólo importa si la pestaña muere antes.

**Liberar espacio, por orden, y nunca a costa de una evaluación:** purgar
telemetría (IndexedDB, `_tmPurgeAll`), recortar `emp.diario` por debajo de
`DIARIO_DIAS` (14), recortar `emp.sessions` por debajo de 50, colapsar el
registro de descartes. Las evaluaciones de la cola **no se tocan nunca**.

### 6.4 · Dos pestañas (M8)

El `read-modify-write` actual (`_colaAnotar`, `index.html:3310-3313`) puede perder
una anotación si dos pestañas escriben entre el `getItem` y el `setItem`.

```js
async function _conCerrojo(fn){
  if(navigator.locks && navigator.locks.request)
    return navigator.locks.request('txk_eventos', fn);
  return fn();                       // sin cerrojo: ver residual abajo
}
```

**Dependencia de plataforma declarada:** `navigator.locks` exige **iOS/Safari
15.4+**, el mismo suelo que `crypto.randomUUID`. Un único umbral para las dos
cosas; hay que confirmar que la flota de iPads lo cumple (§18).

Por debajo de ese suelo, o si el cerrojo no está: se relee justo antes de escribir
y se fusiona por `evento_id` en vez de sustituir la lista entera. La ventana
residual es de microsegundos y el peor caso es **duplicar** un evento en la cola
local, no perderlo — y un duplicado local lo absorbe el `UNIQUE` del servidor con
un 409. Es la asimetría correcta: la fusión falla hacia el lado que no pierde.

Además, el evento `storage` permite que una pestaña se entere de lo que escribió
la otra y refresque sus contadores.

### 6.5 · Visibilidad (M1, M2) — y una corrección importante

**`_setSyncPill` no sirve para esto.** Leído hoy (`index.html:4731-4745`): sólo
pinta el estado `offline`; `pending`, `syncing` y `synced` están **deliberadamente
ocultos** por petición del propietario («el guardado y el outbox trabajan en
segundo plano sin molestar»). Cada vez que B2 decía «el chip lo dice», **no decía
nada**. Es un fallo de la especificación anterior, no del código.

B2.1 respeta esa preferencia y la distingue de lo que aquí hace falta:

| | Narrar la sincronización rutinaria | Avisar de algo que requiere acción |
|---|---|---|
| El propietario dijo | **no** | — |
| B2.1 hace | **nada**: sigue en silencio | **sí**, y sólo entonces |

La superficie es propia y **aparece únicamente si hay algo que el usuario deba
saber**: pruebas sin guardar, sin identidad, en `revisar` o en cuarentena. Nunca
por un simple «pendiente de enviar», que es normal sin cobertura.

**`_outboxReflect` deja de salir cuando no hay red** (hoy, `index.html:3343`,
`if(navigator.onLine === false) return;`). Ése es justo el momento en que ocurren
los descartes, y el contrato exige que se vean. Sin red se muestran los dos
hechos a la vez: que no hay conexión, y que hay N cosas que atender.

**Dónde viven los descartes, persistentemente** — `txk_eventos_registro`:

```js
{
  v: 1,
  contadores: { descartado_por_espacio: 7, sin_identidad: 3,
                cuarentena_desbordada: 0, no_persistido: 0 },
  ultimos: [ { motivo:'descartado_por_espacio', prioridad:3,
               actividad:'repaso', ts:1789430000000 }, … ],   // los 50 últimos
  colapsados: [ { motivo:'descartado_por_espacio', dia:'2026-09-16', n:41 } ]
}
```

Los contadores **no se recortan nunca**. Sólo se colapsa el detalle: pasados los
50 últimos, se agrega por `(motivo, día)`. Así el registro está acotado sin que
ninguna cifra desaparezca.

---

## 7 · Máquina de estados

### 7.1 · Estados que se fusionan, y por qué

El encargo listaba trece. Tres son el mismo comportamiento con otro nombre y
mantenerlos separados sería inventar diferencias:

| Propuesto | Decisión |
|---|---|
| `creado` + `persistido` + `pendiente` | **un solo estado: `pendiente`.** «Creado» dura menos de un tick; «persistido» es la *condición* de estar en la cola: si no se persistió, el estado es `no_persistido`, no `persistido` |
| `reintentable` | **no es un estado, es una clasificación de respuesta.** El evento vuelve a `pendiente` con `proximo` en el futuro. Dos estados con idéntico comportamiento y distinto reloj son un solo estado con un campo |
| `retenido_por_otro_usuario` | **`retenido`**, sin más. Cubre igual «hay otro dentro» y «no hay nadie dentro», que se comportan idénticamente |

Quedan **nueve** estados y dos salidas.

### 7.2 · La tabla

| Estado | Quién lo mueve | Transición que lo produce | ¿Local? | ¿Puede perderse? | ¿Enviable? | Reintento |
|---|---|---|---|---|---|---|
| **`pendiente`** | cliente | `setItem` devolvió `true` y hay `uid` | **sí, en disco** | no | **sí**, si `proximo ≤ ahora` y `uid` = sesión | drenaje cada 120 s |
| **`retenido`** | cliente | `e.uid !== snapshot.uid` | sí, en disco | no | no | al volver su dueño |
| **`enviando`** | cliente | superadas las tres comprobaciones de §3.5-D | sí, en disco | no | en vuelo | si la respuesta no llega, vuelve a `pendiente` |
| **`sin_identidad`** | cliente | se creó sin `uid` | sí, **en otra clave** | no | **nunca** | sólo por reclamación explícita (§3.4) |
| **`no_persistido`** | almacenamiento | `setItem` devolvió `false` | **sólo en memoria** | **SÍ, si muere la pestaña** | sí | en cada evento nuevo y en cada drenaje |
| **`bloqueado_por_cuota`** | almacenamiento | `QuotaExceededError` | **sólo en memoria** | **SÍ, si muere la pestaña** | sí | tras liberar espacio o tras confirmar envíos |
| **`revisar`** | cliente | 10 intentos agotados, o 30 días `retenido`, o firma de precondición ausente (§5.3) | sí, en disco | no | sí, a mano | manual, y un intento diario |
| **`cuarentena`** | **servidor** | 403/401+`42501`, 400, 409 que no es el duplicado esperado, 2xx con `[]` | sí, en disco | **no: no se borra jamás** | no automáticamente | ninguno |
| **`descartado`** | cliente | prioridad 3 con la cola ≥ 400 | **no**: sólo queda el registro | el hecho sí, y **se cuenta y se ve** | no | no aplica |
| *salida* **`confirmado`** | servidor | 201 con fila | sale de la cola | no: está en la nube | — | — |
| *salida* **`duplicado_idempotente`** | servidor | 409 + `23505` + índice esperado | sale de la cola | no: ya estaba | — | — |

### 7.3 · El diagrama

```
                        (ocurre el hecho)
                               │ evento_id, snapshot, ts — todo síncrono
                               ▼
                    ¿hay snapshot.uid?
                    │                    │
                   no                   sí
                    ▼                    ▼
             sin_identidad        ¿cabe? (§9)  ──P3, ≥400──►  descartado
             (otra clave,              │                       (contado)
              nunca se envía)          ▼
                    │            setItem síncrono
                    │             │       │        │
       reclamación  │          true    'cuota'   false
       explícita ───┘             │       │        │
       (si se aprueba)            ▼       ▼        ▼
                               pendiente  bloqueado  no_persistido
                                   │      _por_cuota      │
                                   │          └───────────┘
                                   │        (en memoria; reintentan persistir)
                    uid ≠ sesión   │
                   ┌───────────────┤
                   ▼               │ uid = sesión, proximo ≤ ahora
                retenido           ▼
                   │          [3 comprobaciones: uid · snapshot · jwt.sub]
        vuelve su  │               │ fallan → no se envía, sigue pendiente
         dueño     └──────────►    ▼
                               enviando
                                   │
        ┌──────────────┬───────────┼──────────────┬──────────────┐
        ▼              ▼           ▼              ▼              ▼
   201 + fila    409+23505+uk   401 PGRST301   403/401 42501   10 fallos
   confirmado    duplicado_     5xx · red      400 · 409 otro   ó 30 días
      │          idempotente    timeout        2xx con []          │
      │               │         ilegible           │               ▼
      └── FUERA ──────┘             │               ▼            revisar
                                    ▼          cuarentena     (visible, a mano,
                              pendiente        (no se borra     nunca se borra)
                              (backoff)          jamás)
```

**Transiciones que NO existen, a propósito:** `sin_identidad → enviando` (por
ninguna vía automática); `retenido → confirmado` sin que vuelva su dueño;
`pendiente → fuera` sin respuesta del servidor; `cuarentena → borrado`;
`revisar → borrado`; `no_persistido → pendiente` sin un `setItem` que devuelva
`true`.

---

## 8 · Clasificación de errores (A3, A4)

**Nunca «409 = duplicado». Nunca «401 = caducado».** La decisión se toma con
cuatro datos: HTTP, `code` del cuerpo, SQLSTATE y el nombre del índice.

| HTTP | `code` | SQLSTATE | Índice | Significado | Acción |
|---|---|---|---|---|---|
| **201** | — | — | — | insertado | **fuera** (`confirmado`) |
| **2xx** | — | — | — | cuerpo `[]` → el `BEFORE INSERT` lo anuló | **cuarentena** `sin-fila` |
| **409** | `23505` | `23505` | `scores_evt_uk` / `actividad_evt_uk` | **ya estaba: éxito idempotente** | **fuera** (`duplicado_idempotente`) |
| **409** | `23505` | `23505` | **otro** | otra restricción única | **cuarentena** `unico-inesperado` |
| **409** | `23503` | `23503` | — | clave ajena | **cuarentena** `fk` |
| **409** | otro | — | — | desconocido | **cuarentena** `conflicto-desconocido` |
| **401** | `PGRST301` | — | — | **JWT caducado** | **renovar** y reintentar. No cuenta como intento fallido si la renovación va bien |
| **401** | `PGRST302` / JWSError | — | — | JWT ausente, ilegible o mal firmado | **`revisar`** (no reintento ciego: un token falsificado daría un bucle) |
| **401** | `42501` | `42501` | — | privilegio insuficiente **sin JWT válido** (rol `anon`) | **cuarentena** `sin-autorizacion` |
| **403** | `42501` | `42501` | — | privilegio insuficiente **con JWT válido** | **cuarentena** `sin-autorizacion` |
| **400** | `23502` | `23502` | — | `NOT NULL` → **falta el `DEFAULT` de la fase de autoridad** | **`revisar` + apagar `B2_ENVIO`** (§5.3) |
| **400** | `PGRST204` | — | — | columna inexistente → **falta la migración** | **`revisar` + apagar `B2_ENVIO`** |
| **400** | `23514` | `23514` | — | `CHECK` (total ≤ 0, competencia fuera de vocabulario, evento sin dueño) | **cuarentena** `datos-invalidos` |
| **400** | otro | — | — | petición mal formada | **cuarentena** `peticion-invalida` |
| **404 / 405** | — | — | — | ruta equivocada | **`revisar`** |
| **408 · 429 · 5xx** | — | — | — | transitorio | **pendiente** con backoff |
| — | — | — | — | red, `AbortError`, timeout | **pendiente** con backoff |
| 2xx | — | — | — | **JSON ilegible** | **pendiente** con backoff |

**Dos precisiones que importan:**

1. **401 tiene tres significados** y la diferencia decide entre reintentar para
   siempre y renunciar. PostgREST devuelve 401 —no 403— cuando el rol es `anon`
   y le falta el privilegio. En la ventana de retirada de `anon` (fase D), tratar
   todo 401 como reintentable sería un bucle cada 120 s eterno.
2. **El nombre del índice se comprueba en `message`**, que PostgREST devuelve como
   `duplicate key value violates unique constraint "scores_evt_uk"`. Si algún día
   se añade otra restricción única, un 409 suyo **no** puede leerse como éxito.
   Que este nombre esté en una constante compartida entre el SQL y el cliente es
   parte del contrato.

**Backoff (M3):** `intentos` 1→ inmediato (el drenaje de 120 s), 2→ 5 min, 3→ 15,
4→ 1 h, 5→ 4 h, 6-10→ 24 h. A los **10 intentos** → `revisar`. **Un evento nunca
se elimina por agotar reintentos**: `revisar` es local, visible, reintentable a
mano y permanente.

---

## 9 · Capacidad y límites

### 9.1 · Las tres capas, que B2 confundía en una

| Capa | Qué es | Cómo se mide | Quién la fija |
|---|---|---|---|
| **1 · Lógica** | cuántos eventos aceptamos antes de proteger el presupuesto | contando | nosotros |
| **2 · Física estimada** | cuánto sitio creemos que queda | `JSON.stringify(lista).length` | el navegador |
| **3 · Imposibilidad física** | `setItem` lanzó | **el propio `setItem`** | el dispositivo |

La capa 3 **no se predice, se observa**. Por eso el contrato no puede decir «el
alérgeno siempre entra»: puede decir que **nunca lo rechazamos nosotros**, y que
si el dispositivo lo rechaza, **se dice**.

### 9.2 · Los números

| Constante | Valor | Qué es |
|---|---|---|
| `UMBRAL_P3` | **400** | desde aquí no se aceptan prácticas |
| `UMBRAL_AVISO` | **500** | desde aquí se avisa de forma persistente. **No se rechaza nada** |
| `LIMITE_DURO` | **1 000** | tope lógico de todo, por CPU |
| `PRESUPUESTO` | **512 KB** en unidades UTF-16 | red de seguridad de la capa 2 |

**El cambio de fondo:** en B2, 500 era un tope duro y una evaluación que llegara
después «se conservaba en local». La auditoría demostró que ese «en local» no
tenía respaldo, y la medición demostró que el tope no protegía nada: 500 eventos
son 175 KB sobre un techo de ~5 MB (3,4 %) y 3,27 ms de encolado. **Rechazar una
evaluación a 500 era pagar una pérdida real por un ahorro imaginario.**

`LIMITE_DURO` en 1 000 sí tiene una razón medida: el encolado cuesta 5,75 ms en
escritorio, ~23 ms extrapolado a un móvil antiguo. Se pasa de un fotograma, pero
**sólo ocurre al terminar una prueba**, nunca dentro de una interacción continua.
A 2 000 (10,21 ms → ~41 ms) ya sería perceptible. Mil es el último número
defendible.

### 9.3 · La tabla de comportamiento

| Ocupación | P1 alérgenos | P2 evaluación | P3 práctica |
|---|---|---|---|
| **< 400** | entra | entra | entra |
| **400 – 499** | entra | entra | **`descartado`** — contado, persistido, visible |
| **500 – 999** | entra **+ aviso persistente** | entra **+ aviso** | descartado |
| **≥ 1 000** o **> 512 KB** | **se intenta igual** (§9.4) | se intenta igual | descartado |
| **`setItem` lanza** | **`bloqueado_por_cuota`**: visible, explícito, en memoria | ídem | descartado |

**No existe el estado «cola bloqueada» de B2.** Era el nombre de un rechazo
disfrazado de conservación. Lo sustituye una escala honesta: aviso → aviso fuerte
→ `no_persistido` visible.

### 9.4 · Por encima de `LIMITE_DURO`

Superarlo **no rechaza** una evaluación: dispara, en este orden, (1) un drenaje
inmediato si hay red, (2) la liberación de espacio de §6.3, (3) el intento de
`setItem` igualmente. Sólo si ese `setItem` falla el evento queda
`bloqueado_por_cuota`. La degradación es de rendimiento, no de integridad, y
llegar ahí exige mil pruebas sin una sola conexión.

### 9.5 · La métrica (M6)

**`JSON.stringify(lista).length`**, no `Blob.size`. Chromium y WebKit contabilizan
`localStorage` en **unidades UTF-16**, no en bytes UTF-8. Para texto con acentos,
`Blob` cuenta de más: mis 174,8 KB son una sobreestimación conservadora del
consumo real de cuota. La sobreestimación no hace daño; usar la métrica
equivocada en el guard, sí.

**Medición mínima obligatoria en un iPad de la casa** (§18): el techo real de
`localStorage`, el tamaño de `txoko_data_v4` en ese dispositivo, y el coste de
encolar a 250 / 500 / 1 000. Tres cifras, una pestaña, sin tocar datos.

**¿Siguen siendo razonables 500 y 512 KB?** Sí, como **umbrales**. Su papel ha
cambiado —de tope a aviso— y en ese papel el margen es amplio incluso si WebKit
resulta ser más estrecho que Chromium. Lo que **no** puede seguir estimado es
`LIMITE_DURO`: la medición en iPad lo confirma o lo baja.

> **Riesgo que hay que verificar, no descartar.** WebKit puede **desalojar** el
> almacenamiento de un sitio que se usa en Safari (no instalado) tras siete días
> sin interacción. Un iPad instalado como PWA en la pantalla de inicio no está
> sujeto a eso. Para una cola pensada para sobrevivir semanas sin red, la
> diferencia es total: **hay que confirmar que la flota usa la aplicación
> instalada**, no una pestaña de Safari. Si no es así, el «offline prolongado» de
> §12 no tiene el respaldo que se le supone.

---

## 10 · Alérgenos

El simulacro es el único hecho **sin ninguna otra red**: su función
(`index.html:25121-25143`) no toca `emp.sessions`, sólo guarda `emp.allergenBest`
—un porcentaje— y una línea en `emp.diario`, que **rueda a 14 días**
(`DIARIO_DIAS`, línea 2427). Si el evento se pierde, se pierde del todo. Y es la
medida de si el equipo sabe responder a un comensal alérgico.

Por eso:

1. **Prioridad 1**: sale primero en todo drenaje.
2. **Nunca se rechaza por capacidad lógica.** Ni a 400, ni a 500, ni a 1 000.
3. **Sólo el dispositivo puede impedirlo**, y entonces se dice: `bloqueado_por_cuota`
   con aviso persistente. Nunca un falso éxito.
4. **Conserva el momento del hecho** en `meta.ts_hecho`, no el de sincronización.
   `created_at` es del servidor y los dos coexisten: como evidencia, importa
   cuándo ocurrió.
5. **Se envía a `scores` y a `actividad`** como hoy. **Son dos eventos con dos
   `evento_id` distintos**, no uno con dos destinos: cada uno se confirma o
   fracasa por su cuenta, y una fila duplicada en `scores` no debe depender de lo
   que le pase a `actividad`.
6. Si queda `sin_identidad`, el mensaje es explícito y propone repetirlo, que
   cuesta tres minutos.

---

## 11 · Dispositivo compartido

El caso que gobierna el diseño: un iPad de barra por el que pasan veintidós
personas.

| Momento | Qué protege | Mecanismo |
|---|---|---|
| Al crear | que el evento sepa de quién es | `uid` del snapshot, congelado |
| Al cambiar de empleado | que el token del anterior no sobreviva | `_authSesionSalir` sustituye el snapshot **antes** de esperar nada |
| Al decidir enviar | que no salga lo de otro | `e.uid !== s.uid` → `retenido` |
| **Durante el `await`** | **la carrera de C2** | `_authCtx() !== s` → **aborta el drenaje entero** |
| Antes del POST | que el token sea de quien creemos | `_jwtSub(s.token) !== s.uid` → no se envía |
| En el servidor | todo lo demás | `auth.uid()` + `revoke` + `UNIQUE` |

**Cómo muere exactamente la carrera de C2.** Ana tiene doce eventos drenando. En
el evento 3, durante el `await` del POST, Bruno teclea su PIN.
`_authSesionEntrar` llama a `_authSesionSalir`, que hace **una** asignación:
`_authPoner({uid:null, token:null, …})`. Cuando el `await` vuelve y el bucle va a
por el evento 4, `_authCtx() !== s` es cierto —son objetos distintos— y el
drenaje se detiene ahí mismo. No hay que comparar campos ni acertar con el orden
en que cambian: **el snapshot es uno y se sustituye entero**, así que una sola
comparación de referencia detecta cualquier cambio de identidad ocurrido en
cualquier punto de cualquier espera. Ése era el fallo: `_authToken` pasaba a ser
el de Bruno (en `onAuthStateChange`) *antes* de que `_authUid` lo fuese, y entre
esos dos instantes el evento de Ana salía firmado por Bruno.

---

## 12 · Offline prolongado

| Días sin red | Qué pasa |
|---|---|
| 1-3 | normal. La cola crece; nada se ve porque nada hay que hacer |
| ~7 | el **refresh token** puede caducar. El siguiente arranque queda en `identidad_sin_token`: los eventos conservan dueño y esperan |
| hasta 400 eventos | se dejan de aceptar prácticas, contadas y visibles |
| 500 | aviso persistente |
| 1 000 / 512 KB | §9.4 |
| 90 días | `txoko_session` caduca (`index.html:33638`) y hace falta PIN. Los eventos siguen con su `uid`: se enviarán cuando esa persona vuelva a entrar **en este dispositivo** |
| 30 días en `retenido` | pasa a `revisar`. Visible, no borrado |

**Al volver la red**, en este orden: renovar la sesión (requisito nuevo: hoy sólo
se renueva al recargar), luego drenar por prioridad ascendente y `ts` ascendente
—alérgenos primero, lo más antiguo primero dentro de cada prioridad—, uno a uno.

---

## 13 · Rollback y versiones (A6)

**El mecanismo de B2 era destructivo.** `_colaCargar` (`index.html:3279`) sólo
conserva entradas con `nombre` de tipo string; la guardia «`v > 2` no se toca»
(`3282`) está **dentro** de ese `if`, así que nunca protege a un formato que no
tenga `nombre`. Como B2 fijaba `v: 2` y los eventos no tienen `nombre`, el primer
`_colaGuardar` los habría borrado.

**Solución elegida: clave de almacenamiento separada.** `txk_eventos_v1` es
desconocida para v7.451 y para v7.452. Ninguna de las dos la lee, ninguna la
escribe, ninguna puede destruirla.

| Escenario | Qué ocurre |
|---|---|
| v7.453 crea eventos, se vuelve a **v7.451** | v7.451 no conoce la clave: **los eventos siguen ahí, intactos**. No se envían porque esa versión no sabe hacerlo. La aplicación funciona como antes |
| Estando en v7.451, se hacen más pruebas | van por el camino de siempre (`supaInsertScore` / `registrarActividad` directos, sin cola). Puede perderse alguna sin red, exactamente como hoy — no es una regresión |
| Se vuelve a **v7.453+** | lee `txk_eventos_v1`, encuentra lo de antes, aplica el backoff y drena. Los que hayan superado 30 días entran como `revisar` |
| Aparece un formato v2 de eventos en el futuro | el parser **descarta por versión antes de exigir ningún campo**: `if(e.v > EV_V) continue;` como primera comprobación, no como última |

**Además, endurecer B1 antes de publicarla** (barato y evita el mismo fallo en el
futuro): invertir el orden en `_colaCargar` para que la guardia de versión se
evalúe antes de exigir `nombre`. No es necesario para B2 —van por claves
distintas— pero la trampa seguiría armada para el siguiente formato.

---

## 14 · Cuarentena (A2)

**Hoy se recorta a 200 en silencio** (`index.html:3330`, `l.slice(-200)`). Con B2
la cuarentena recibiría volumen real, y perder la entrada 201 sin contarla
contradice frontalmente el contrato.

| Pregunta | Respuesta |
|---|---|
| **¿Hay límite?** | Sí, físico: la cuarentena comparte presupuesto. No hay límite por número |
| **¿Qué pasa al alcanzarlo?** | **Nunca se borra una entrada de prioridad 1 o 2.** Las de prioridad 3 se **colapsan** en un resumen `{motivo, día, n, tipos}` — se pierde el detalle individual, no el hecho ni la cuenta |
| **¿Cómo se contabiliza lo que no cabe?** | `contadores.cuarentena_desbordada`, que **nunca** se recorta, más el resumen colapsado |
| **¿Cómo se muestra?** | Superficie de §6.5, y **con pantalla propia**: qué prueba, de qué día, por qué motivo. Retener sin enseñar es esconder |
| **¿Cómo se recupera?** | Reintento manual desde esa pantalla. Un `42501` de la ventana de migración se resuelve solo cuando esa persona vuelve a entrar con identidad |
| **¿Qué no puede perderse nunca en silencio?** | Todo lo de prioridad 1 y 2, y **cualquier contador**. Lo único que puede perder detalle es una práctica, y aun así queda contada |

---

## 15 · Empleados sin identidad

**Estado real, medido:** 22 fichas, 18 con `auth_user_id`. Gabriel, María, Monica
y Sheila **no tienen PIN**, y por tanto ni identidad Auth ni acceso. Decisión del
propietario, vigente: no se les crea PIN artificial, no se les crea
`auth_user_id`, no se convierte esto en una excepción de RLS.

Consecuencia para B2: **no pueden generar eventos porque no pueden entrar.** No
hacen falta rutas especiales.

Lo que sí cambia respecto a B2, que daba por hecho que «sin identidad Auth no hay
evento»: **cualquier persona puede quedarse temporalmente sin identidad
utilizable** —sin red, token caducado, refresh caducado— y ése es el caso B de
§3.4, que sí tiene ruta propia. No confundir las dos cosas: una es una persona sin
cuenta, la otra una cuenta sin token.

---

## 16 · Empleados eliminados o desactivados (M5, L)

### 16.1 · El estado real de hoy, sin inventar nada

Verificado contra el esquema en producción:

- **No existe `activo`, ni `baja`, ni `estado`, ni `deleted_at`.** Las 25 columnas
  de `employees` son las de `fase2.5d-diseno-rls.md §4.1` y ninguna expresa
  inactividad.
- **La baja es un `DELETE` físico** (`supDeleteExecute` → `DELETE
  /rest/v1/employees?name=ilike.<name>`) **y está roto desde el 12 de septiembre**:
  la fase 2.5A revocó `DELETE` a `anon` y `authenticated` y no hay política que lo
  ampare. Lo causó la contención de 2.5A, no B1 ni B2.
- **Borrar la ficha deja viva la cuenta de Auth.** `employees.auth_user_id →
  auth.users(id) ON DELETE SET NULL` protege la dirección contraria. La cuenta
  queda inerte para entrar de nuevo (`verify_employee_pin_sha` sin fila → `sin_pin`;
  `sesion` → `404 sin_ficha`), **pero su refresh token sigue siendo válido**.
- **El auto-login compara contra la ficha local** (`index.html:33640`), así que en
  un dispositivo que ya la tiene, una persona borrada **sigue entrando sin red**.
- Eso explica los 58 `scores` huérfanos: cuatro personas borradas **antes** de
  2.5A, y `scores` no tiene clave ajena.

**Hoy, un evento de alguien dado de baja se acepta.** No hay noción de inactividad
que consultar. B2.1 no lo cambia.

### 16.2 · La dependencia futura, descrita y **no implementada**

Desactivar de verdad exige cuatro capas, y tenerlas a medias es peor que no
tenerlas:

| Capa | Qué significa | Qué pasa si falta |
|---|---|---|
| **Datos** | `activo boolean not null default true`; la baja deja de ser `DELETE` | el historial se queda huérfano y el ranking cuenta a quien ya no está |
| **Auth** | revocar la cuenta (`admin.deleteUser` o ban) **y** `signOut({scope:'global'})` | **el refresh token sigue renovándose**: una PWA abierta sigue escribiendo días después |
| **Cliente** | el auto-login local deja de valer si la nube no confirma la ficha | sin red se sigue entrando indefinidamente |
| **RLS** | `and e.activo` en las políticas | la identidad es válida y el servidor acepta |

Y sobre los eventos:

- **Eventos ya sincronizados:** se quedan. Son historial y no se reescribe.
- **Eventos pendientes de alguien dado de baja:** su `uid` sigue siendo válido
  mientras la cuenta exista. Si esa persona vuelve a entrar en ese dispositivo, se
  envían. Si no, quedan `retenido` → a los 30 días `revisar` → nunca borrados.
- **Con la desactivación implementada:** el servidor los rechazaría con `42501` →
  **cuarentena**, que es el sitio correcto: visible, no perdido, revisable.

**Nada de esto se implementa en B2.1, y B2 funciona sin ello.** Es prerequisito de
un RLS que distinga a quien está de baja, no de la cola.

---

## 17 · Matriz de ataques actualizada

Los veinticinco casos, después de las correcciones. «Residual» es lo que sigue
sin estar cubierto.

| # | Caso | Resultado | Identidad | Persistencia | Servidor | Riesgo residual |
|---|---|---|---|---|---|---|
| 1 | **Ana offline, sin sesión persistida** | `sin_identidad` en clave aparte; visible al instante | ninguna, y se admite | sí, en disco | **nunca lo ve** | el hecho no llega a la nube salvo reclamación explícita. **Visible, no silencioso** |
| 2 | **Ana offline, con sesión persistida** | `pendiente` con dueño real | `sub` del JWT persistido, aunque caducado | sí | cuando haya token | ninguno |
| 3 | **Ana vuelve online** | renovación → drenaje por prioridad | `sub` renovado = `uid` | sale de la cola al confirmar | 201 / 409 | ninguno |
| 4 | **Bruno entra en el mismo iPad** | los de Ana → `retenido`; **0 envíos** | la de Bruno para lo suyo | los de Ana siguen en disco | no los ve | Ana debe volver a ese iPad |
| 5 | **Bruno manipula el `uid` local** | la petición sale y el servidor la registra **a nombre de quien firma** | servidor | sí | `auth.uid()` manda | ninguno. Si además falsifica el token, `PGRST302` → `revisar`, sin bucle |
| 6 | **Bruno manipula `employee`** | **`42501` → 403 → cuarentena** | servidor (`DEFAULT`) | sí | `revoke insert (employee)` | **ninguno tras la fase de autoridad. Antes de ella, B2 no envía** |
| 7 | **Bruno manipula `venue`** | ídem | servidor | sí | `revoke insert (venue)` | ídem |
| 8 | **Bruno reutiliza el `evento_id` de Ana** | 201 **como evento de Bruno**; el de Ana intacto | servidor | — | `UNIQUE(auth_user_id, evento_id)` | ninguno: no hay apropiación que rechazar |
| 9 | **Ana reintenta su `evento_id`** | **409 `23505` + índice esperado** → éxito idempotente | — | sale de la cola | `UNIQUE` | ninguno |
| 10 | **Cambio de usuario durante el drenaje** | **`_authCtx() !== s` → aborta el drenaje entero** | congelada | intacta | no recibe nada | ninguno. Era C2 |
| 11 | **Token caducado** | `401 PGRST301` → renovar → reintentar | `uid` conservado | sí | — | si el refresh también caducó, hace falta PIN con red |
| 12 | **Token renovado en vuelo** | la petición viaja con el token viejo, mismo `sub`, válido hasta su `exp` | misma | — | acepta | ninguno |
| 13 | **Logout durante el drenaje** | snapshot sustituido → aborta; resto `retenido` | ninguna activa | en disco | nada más llega | ninguno |
| 14 | **Timeout con `INSERT` real** | reintento → **409** → `duplicado_idempotente` | — | sale | `UNIQUE` | ninguno. Es la razón de ser del `evento_id` |
| 15 | **409 que no es `23505` del índice** | **cuarentena**, no «éxito» | — | en disco | — | ninguno. Era A4 |
| 16 | **401 `PGRST301`** | reintentable tras renovar | — | en disco | — | ninguno |
| 17 | **401/403 `42501`** | **cuarentena** | — | en disco | rechazó | ninguno. Era A3 (antes: bucle eterno) |
| 18 | **5xx permanente** | backoff → 10 intentos → **`revisar`** | — | en disco, **nunca borrado** | — | ninguno. Era M3 |
| 19 | **`QuotaExceededError`** | **`bloqueado_por_cuota`**, aviso persistente, purga ofrecida | — | **sólo memoria — y se dice** | — | **muere con la pestaña.** Visible, no silencioso. Era A1 |
| 20 | **Rollback de versión** | clave propia: v7.451 no la conoce | intacta | **intacta** | — | ninguno. Era A6 |
| 21 | **Dos pestañas** | `navigator.locks`; sin él, fusión por `evento_id` | — | peor caso **duplicar**, no perder | el `UNIQUE` absorbe el duplicado | requiere iOS 15.4+ para el cerrojo |
| 22 | **500 eventos** | **aviso persistente. No se rechaza ninguna evaluación** | — | sí | — | ninguno. Era la contradicción del tope |
| 23 | **Alérgeno con la cola llena** | **entra** salvo que el dispositivo lo impida, y entonces `bloqueado_por_cuota` visible | — | según §9.3 | — | el caso físico, dicho en voz alta |
| 24 | **Almacenamiento físicamente lleno** | `bloqueado_por_cuota`; purga por orden; **las evaluaciones no se tocan** | — | memoria + aviso | — | pérdida real si muere la pestaña antes de liberar. **Nunca un falso éxito** |
| 25 | **Empleado eliminado** | hoy **se aceptan** sus eventos; el refresh sigue vivo; el auto-login local sigue entrando | su `uid` sigue siendo válido | sí | acepta | **deuda declarada en §16, no implementada** |

---

## 18 · Dependencias previas a la implementación

**Ninguna se ejecuta ahora.** Son la lista de lo que debe estar cerrado y
verificado *antes* de escribir código de B2, y nada de esto está autorizado.

### Bloqueantes

| # | Qué | Por qué |
|---|---|---|
| **D1** | **La fase de autoridad completa** (§5.2, los siete pasos) aplicada y verificada | Sin ella el cuerpo de §4.3 no puede escribir una fila. Es la elección A |
| **D2** | **Verificación contra el servidor real** de siete comportamientos, sin tocar datos: (a) duplicado en índice parcial → 409 `23505` con el nombre del índice en `message`; (b) `INSERT` con `auth_user_id` como `authenticated` → 403 `42501`; (c) el mismo como `anon` → **401** `42501`; (d) `INSERT` sin `employee` en el esquema actual → 400 `23502`; (e) `RETURNING` bajo una política de `SELECT` que no ve la fila → falla entera con `42501`, no devuelve `[]`; (f) columna inexistente → 400 `PGRST204`; (g) `PATCH`/`DELETE` sobre `scores`/`actividad` → 401/403 | Es el R2 ampliado. La tabla de §8 es documentación hasta que se mida |
| **D3** | **Medición en un iPad de la casa**: techo real de `localStorage`, tamaño de `txoko_data_v4` y coste de encolar a 250/500/1 000 | Todo lo medido es Chromium de escritorio. `LIMITE_DURO` es hoy una extrapolación |
| **D4** | **Confirmar que la aplicación se usa instalada** (pantalla de inicio), no en una pestaña de Safari | Si no, el desalojo a los siete días de WebKit invalida el «offline prolongado» |
| **D5** | **Confirmar iOS ≥ 15.4** en la flota | Suelo de `crypto.randomUUID` y `navigator.locks` |
| **D6** | **Decisión del propietario sobre la reclamación de `sin_identidad`** (§3.4): ¿se permite con confirmación explícita y marca de auditoría, o se queda en «repítelo»? | Roza su prohibición de comparar nombres. Recomendación: la opción conservadora |
| **D7** | **La cuarentena necesita pantalla** (R7) | B2.1 la convierte en un camino frecuente. Retener sin enseñar es esconder |

### Recomendadas antes de publicar B1

| # | Qué |
|---|---|
| **D8** | Invertir el orden de la guardia de versión en `_colaCargar` (§13) |
| **D9** | Añadir `pagehide` al volcado de `saveDB` (`index.html:33608` ya escucha el evento para otra cosa) |
| **D10** | Renovar la sesión en el evento `online`, no sólo al recargar (§3.3, corrige A7) |

---

## 19 · Tests obligatorios

Los 25 de `fase-b2-especificacion.md §11` siguen valiendo. Éstos son **además**, y
ninguno necesita red: todos se ejecutan en `tests/smoke.mjs` con dobles, que es lo
único que la CI ejecuta.

**Identidad (C1, C2, D)**

1. Login sin red y sin sesión persistida → el evento va a `txk_eventos_sin_identidad`; `txk_eventos_v1` sigue vacío; **0 peticiones** al drenar con Bruno dentro.
2. Recarga sin red con sesión persistida y **token caducado** → `uid` recuperado del `sub`; estado `identidad_sin_token`; el evento se crea con dueño; **0 envíos** hasta renovar.
3. **Bruno entra durante el `await` del drenaje de Ana** → 0 peticiones con el token de Bruno y `evento_id` de Ana. *Mutación: quitar `_authCtx() !== s` → debe caer.*
4. `s.token = null` con `s.uid` puesto → **0 peticiones**; nunca la clave anónima contra `scores`/`actividad`.
5. `_jwtSub(token) !== s.uid` (token de otro inyectado) → no se envía. *Mutación: quitar la comprobación → debe caer.*
6. Logout con eventos en cola → `retenido`, 0 envíos, contador visible, nada borrado.
7. `Math.random` como fuente de UUID → **el test falla**. La prohibición es verificable.

**Contrato y errores (C3, A3, A4)**

8. El cuerpo del POST **no contiene** `employee`, `venue` ni `auth_user_id`. Aserción sobre el `body` real, no sobre el texto del fichero.
9. 409 `23503` → cuarentena. 409 `23505` con **otro** nombre de índice → cuarentena. 409 `23505` con el nombre esperado → fuera.
10. 401 `PGRST301` → renovar y reintentar. 401 `42501` → cuarentena. 403 `42501` → cuarentena. *Mutación: clasificar sólo por HTTP → deben caer.*
11. 400 `PGRST204` y 400 `23502` → `revisar` **y `B2_ENVIO` queda apagado**.
12. 2xx con `[]` → cuarentena.
13. 5xx diez veces → `revisar`, **y el evento sigue en la cola**. *Mutación: borrar al agotar intentos → debe caer.*
14. Backoff: los `proximo` de los intentos 2..6 son crecientes y no hay envío antes de su hora.

**Almacenamiento (A1, A2, A5, A6, M8)**

15. `setItem` lanza `QuotaExceededError` → estado `bloqueado_por_cuota`, **el llamante no recibe «persistido»**, aviso registrado. *Mutación: volver a tragar el error → debe caer.*
16. `setItem` lanza otro error → `no_persistido`, mismo trato.
17. El evento está en `localStorage` **antes** de cualquier `await` posterior al hecho, y sin pasar por `saveDB`.
18. Entrada 201 en cuarentena → nada desaparece sin contador; prioridad 1 y 2 nunca se colapsan.
19. `_colaCargar` de v7.452 sobre un `localStorage` con `txk_eventos_v1` → **lo deja intacto**. *Mutación: usar `txk_cola_v2` para eventos → debe caer.*
20. Parser de eventos con `v` mayor que el conocido → se salta **antes** de exigir ningún campo.
21. Dos escrituras concurrentes simuladas → ninguna anotación se pierde; si se duplica, el 409 la absorbe.

**Capacidad y prioridad (§9, §10)**

22. Cola a 400 → una práctica se descarta, **se cuenta y el contador sobrevive a recargar**.
23. Cola a 500 → una evaluación **entra**; hay aviso. *Mutación: rechazarla → debe caer.*
24. Cola a 500 → un alérgeno **entra**. Sin excepciones lógicas.
25. Orden de salida: alérgenos antes que evaluación, y dentro de cada prioridad el más antiguo primero.
26. Descarte sin red → el contador se actualiza igual. *Mutación: devolver el `return` por `onLine===false` → debe caer.*
27. Un simulacro de alérgenos genera **dos** eventos con **dos** `evento_id` distintos, y el fallo de uno no arrastra al otro.

---

## 20 · Qué queda explícitamente FUERA de B2

| Fuera | Estado |
|---|---|
| **Activar RLS y cerrar políticas** | Fase posterior. B2 escribe con políticas permisivas y sale correcto igualmente |
| **Retirar los permisos de `anon`** | Fase D. Precondición dura: no se retira mientras queden entradas `uid:null` pendientes en el parque |
| **La desactivación de empleados** (`activo`, revocación en Auth, auto-login) | §16.2. Descrito, no implementado |
| **Arreglar el botón de dar de baja**, roto desde 2.5A | Hallazgo registrado |
| **El hash del PIN como credencial al portador** | Decidido fuera de alcance. Mientras siga así, **RLS no aísla a compañeros del mismo iPad** |
| **Los juegos y los récords** (Survivors, Mr. Shoesmith, récord Txoko, récord El Turno) | 254 de 427 filas de `scores`. No entran en la cola: el máximo ya vive en `employees.txoko_record`, `_supCargarHistorial` los excluye y un récord duplicado no falsea nada |
| **`scores` vs `sessions_data`** y la duplicación funcional | Hallazgo separado, ya documentado |
| **El cruce del ranking con `employees`** (`Ana Kurzweil` empatando en primer puesto) | Depende de `activo` |
| **Migrar los 58 `scores` huérfanos** | Decisión del propietario: no se borran |
| **CORS de `sesion` y `signOut({scope:'global'})`** | Hardening posterior |
| **Cambiar `sesion`** | Intocable en esta fase |
| **Publicar B1 (v7.452)** | Sigue sin autorizar |

---

# Veredicto

## NECESITA OTRA REVISIÓN

El diseño está cerrado y creo que los tres críticos, los siete altos y los ocho
medios quedan resueltos. Lo que impide declararlo listo **no es el diseño: son
cuatro hechos que no he podido medir**, y tres de ellos sostienen decisiones
concretas de este documento.

**Bloqueos, y sólo ellos:**

1. **D2 — el comportamiento real de PostgREST no está verificado.** Toda la tabla
   de §8 es documentación hasta que se compruebe contra este servidor: el nombre
   del índice en el `message` del 409, el 401-frente-a-403 del `42501`, y qué
   devuelve `RETURNING` bajo una política que no ve la fila. Si el punto (e) no se
   comporta como supongo, la fila «2xx con `[]`» de §8 cambia de sentido.

2. **D3/D4/D5 — no hay una sola medición en el hardware real.** `LIMITE_DURO`
   = 1 000 es una extrapolación de Chromium de escritorio; el desalojo de WebKit a
   los siete días puede invalidar el «offline prolongado» de §12 si la aplicación
   no se usa instalada; y `navigator.locks` y `crypto.randomUUID` exigen iOS 15.4+
   sin que sepamos qué iPads hay. Tres cifras y dos confirmaciones, una tarde.

3. **D6 — la reclamación de eventos `sin_identidad` necesita tu decisión.** El
   camino que he definido usa una comparación de nombre como **puerta** para una
   confirmación humana, y tú prohibiste las comparaciones textuales para adoptar.
   Creo que la diferencia es real —no hay adopción automática— pero no es mía la
   decisión. Mientras no la tomes, rige la opción conservadora: no se recupera,
   se repite la prueba.

4. **D1 — B2 ya no es independiente.** Al elegir la arquitectura A, B2 pasa a
   depender formalmente de la fase de autoridad, que no está diseñada al detalle
   ni aplicada. Publicar B2 antes es publicar una cola que no puede enviar nada; y
   el único fallo que el cliente **no** puede detectar por sí solo es
   precisamente el más peligroso —que el `revoke` falte y `employee` siga siendo
   escribible—, porque desde fuera se ve como un 201.

Nada de esto exige rediseñar. Son mediciones, una verificación y una decisión
tuya.

**No he implementado nada, no he ejecutado SQL, no he modificado datos, no he
desplegado, no he tocado RLS ni `sesion`, y no he publicado.**
