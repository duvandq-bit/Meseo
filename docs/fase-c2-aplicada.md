# FASE C-2 — APLICADA

El cliente deja de enviar identidad semántica en `scores` y `actividad`. Rama
`claude/check-app-version-rDp39`, **v7.453**, **sin publicar**.

**Lo que NO se ha tocado:** grants, políticas, RLS, `employees`, Auth, PIN,
`sesion`, datos históricos. **C-3 y B2 siguen sin empezar.**

---

## 1 · Inventario de escritores

Barrido de todo el repositorio, no sólo de `registrarActividad`. **Cuatro rutas
de escritura, ni una más**; ninguna Edge Function toca estas dos tablas.

| Actividad | Archivo:línea | Tabla | Columnas que enviaba | Quién la invoca | Uso |
|---|---|---|---|---|---|
| `registrarActividad` | `index.html:2419` | `actividad` | `employee`, **`venue`** (por `_vSello`), `activity`, `competency`, `kind`, `score`, `total`, `seconds`, `meta` | **14 sitios**: examen, simulacro de alérgenos, examen de sala, LQA (examen/situaciones/auditor), fantasma, quiz de vinos, maridaje, repaso, recorrido, reto del día, Survivors, Mr. Shoesmith | el más usado: toda evaluación y práctica |
| `supaInsertScore` | `index.html:2861` | `scores` | `employee`, **`venue`**, `score`, `total`, `topic`, `cat`, `time_sec` | 2 sitios (×2 con el reintento del aviso): examen general (21920) y simulacro de alérgenos (25154) | alto |
| `supaInsertTxokoRecord` | `index.html:2911` | `scores` | `employee`, **`venue`**, `score`, `total`, `topic:'txoko'`, `cat`, `time_sec` | 1 sitio (32703): récord del juego Txoko | bajo |
| `supaInsertEtRecord` | `index.html:2970` | `scores` | `employee`, **`venue`**, `score`, `total`, `topic:'elturno'`, `cat`, `time_sec` | 1 sitio (32315): récord de El Turno | bajo |

**Lecturas (no se tocan):** `supaFetchLeaderboard` (2884), `supaFetchTxokoTop10`
(2928), `supaFetchEtTop` (2985) y `_supCargarHistorial` (25253). Las cuatro piden
columnas explícitas, así que añadir `auth_user_id` en C-1 no las afectó.

**Ninguna** de las cuatro enviaba `auth_user_id`, `id` ni `created_at`. Y **no hay
`event_id` en ninguna ruta**, así que no se ha añadido en ningún sitio.

---

## 2 · Cambios exactos

### 2.1 · Un ayudante propio, y `_vSello` intacto

`_vSello()` lo usan **12 sitios**: chat, notificaciones, duelos, fotos de plato,
retos… Tocarlo habría cambiado tablas que no son de esta fase. Así que C-2 añade
un ayudante **sólo para estas cuatro rutas** (`index.html:1873`):

```js
function _cuerpoPropio(datos, nombre){
  if(_authToken) return datos;                  // hay identidad: la pone el servidor
  return Object.assign({}, datos, { employee: nombre, venue: _venueActual() });
}
```

### 2.2 · Los cuatro cuerpos

| Función | Antes | Después |
|---|---|---|
| `registrarActividad` | `_vSello({ employee: currentUser, activity, … })` | `_cuerpoPropio({ activity, … }, currentUser)` |
| `supaInsertScore` | `_vSello({ employee, score, … })` | `_cuerpoPropio({ score, … }, employee)` |
| `supaInsertTxokoRecord` | `_vSello({ employee, score: record, … })` | `_cuerpoPropio({ score: record, … }, employee)` |
| `supaInsertEtRecord` | `_vSello({ employee, score: secs, … })` | `_cuerpoPropio({ score: secs, … }, employee)` |

Las columnas de negocio salen **del esquema real**, no de suponer nombres:

```
scores    : score, total, topic, cat, time_sec
actividad : activity, competency, kind, score, total, seconds, meta
```

### 2.3 · La rendija, y por qué la he dejado abierta a propósito

**Esto es una desviación de lo que pediste y quiero que la veas antes que nada.**

Pediste que el cliente **nunca** mande `employee` ni `venue`. No lo he hecho
incondicionalmente, y la razón está medida: **sin sesión de Auth, el servidor no
tiene identidad que poner.** `anon` no puede ejecutar `app.emp_actual()`, así que
un cuerpo sin `employee` muere con `401 / 42501 permission denied for function
emp_actual` — medido en C-1 (sonda V5). Y hoy **el 100 % de las escrituras
observadas llegan como `anon`**.

Callarse el nombre en ese caso, hoy, sería **perder en silencio el examen de
alguien**: `registrarActividad` se traga el error por diseño. La cola que debería
retener esas escrituras es B2, que aún no existe.

Así que: **con token, cuerpo limpio. Sin token, como hasta ahora.** Esa rama muere
en C-3, que es cuando el servidor deja de aceptarla — y para entonces B2 ya la
sostendrá. Tres de tus constantes la exigen: «no cierres todavía los grants anon»,
«comportamiento actual de anon» en la lista de verificación, y «no romper legacy».

Si prefieres la versión incondicional, es una línea (`return datos;` siempre) y el
test `C-2 · SIN sesión…` te dirá exactamente qué se rompe.

---

## 3 · Petición antes y después

**Antes** — `POST /rest/v1/actividad`:
```json
{"employee":"Ana","activity":"simulacro_alergenos","competency":"alergenos",
 "kind":"evaluacion","score":18,"total":20,"seconds":240,"meta":{"cat":"all"},
 "venue":"txoko"}
```

**Después, con sesión** — capturado del `fetch` real en la suite:
```json
{"activity":"simulacro_alergenos","competency":"alergenos","kind":"evaluacion",
 "score":18,"total":20,"seconds":240,"meta":{"cat":"all"}}
```

**Después, sin sesión** — idéntico al de antes. Es la rendija de §2.3.

`POST /rest/v1/scores`, con sesión: `{"score":18,"total":20,"topic":"alergenos","cat":"all","time_sec":240}`.

---

## 4 · Pruebas contra la base real

### 4.1 · Requisito crítico — empleado autenticado, cuerpo de C-2

Identidad real (`set local role authenticated` + `request.jwt.claims` con el `sub`
de un empleado de verdad: exactamente lo que PostgREST hace por dentro tras
validar la firma). Revertido.

```
Sesión de: Aless   ·   atacaría a: Alexis

── REQUISITO CRÍTICO · cuerpo C-2, sin ninguno de los cinco ──
  scores    -> CREADA. employee=Aless (true) venue=txoko (true) auth_user_id=true
               id_no_nulo=true created_at_de_ahora=true
  actividad -> CREADA. employee=Aless (true) venue=txoko (true) auth_user_id=true
```

**Los cinco campos del servidor corresponden al usuario autenticado.** ✓

### 4.2 · Ataque explícito, con C-1 sola y los grants abiertos

```
── ATAQUE · employee ajeno + venue mb + auth_user_id ajeno + id + created_at ──
  RESULTADO: FILA CREADA
    employee     -> Alexis   ¿coló el ajeno? true
    venue        -> mb       ¿coló mb?       true
    auth_user_id -> EL SUYO (rechazado el ajeno)
    id           -> ¿respetó el inventado? false
    created_at   -> ¿respetó el año 2000?  false
```

**Con C-1 sola: dos de los cinco siguen en manos del atacante.** La fila **se
crea**; no hay rechazo que pueda confundirse con una prueba de C-3. `employee` y
`venue` cuelan porque **el grant sigue abierto**, que es justo lo que C-3 cerrará.
Los otros tres los ignora el disparador `marca_del_servidor`.

> Esto es una debilidad **del servidor**, no del cliente. C-2 hace que el cliente
> honesto no mande identidad; no impide que un cliente manipulado la mande. Ése
> es el trabajo de C-3, y por eso C-2 sin C-3 no cierra nada por sí solo.

### 4.3 · Lo que no he podido probar, y cómo lo cierras tú

**No puedo emitir un JWT `authenticated`**: no hay secreto JWT accesible ni
`pgjwt`. Así que el camino completo «navegador autenticado → HTTPS → PostgREST»
está probado **en dos mitades**: el transporte en C-1 (sondas V1–V6, HTTP real) y
la identidad aquí (rol y claims reales). Para unirlas en una sola, con tu sesión
abierta en meseo.es:

```js
(async () => {
  const s = await _getAuthClient().auth.getSession();
  const t = s.data.session && s.data.session.access_token;
  if(!t) return console.log('sin sesión Auth: entra primero');
  const r = await fetch(SUPA_URL + '/rest/v1/scores?select=employee,venue,auth_user_id,id,created_at', {
    method:'POST',
    headers:{ apikey:SUPA_KEY, Authorization:'Bearer '+t,
              'Content-Type':'application/json', Prefer:'return=representation' },
    body: JSON.stringify({ score:1, total:1, topic:'__c2_navegador__', cat:'all', time_sec:1 })
  });
  console.log(r.status, await r.json());
})();
```

Espera `201` y una fila con **tu** nombre, **tu** restaurante y `auth_user_id` no
nulo. Dime el resultado y borro la fila de prueba.

---

## 5 · Conteos

| | Antes | Después |
|---|---|---|
| `scores` | 427 | **427** |
| `actividad` | 5 | **5** |
| `employees` | 22 | **22** |
| Huérfanos en `scores` | 58 | **58** — ninguno nuevo |
| Huérfanos en `actividad` | 0 | **0** |
| `scores`/`actividad` con `auth_user_id` | 0 | **0** |
| Puntuación más reciente | 2026-09-12 13:01:46 | **2026-09-12 13:01:46** |
| Restos de prueba | — | **0** |

Todas las pruebas de esta fase fueron en bloques revertidos: **no se creó ni se
borró ninguna fila real.**

---

## 6 · Mutation tests

Cada mutación rompe a propósito lo que una guarda protege. Las cuatro mueren:

| Mutación | ¿La detecta? | Qué cae |
|---|---|---|
| **M1** · devolver `employee: currentUser` al cuerpo de `registrarActividad` | **sí** | 4 pruebas, con el mensaje exacto *«registrarActividad vuelve a poner "employee:" en el cuerpo»* |
| **M2** · devolver `_vSello(` al récord de Txoko | **sí** | 4, incluida la guarda antigua de aislamiento por restaurante |
| **M3** · que `_cuerpoPropio` mande identidad **siempre** | **sí** | 4, *«…manda una columna inesperada: employee»* |
| **M4** · que `_cuerpoPropio` **nunca** la mande (romper la rendija) | **sí** | *«sin token debe seguir mandando employee»* |

M4 es la que más me importaba: protege la decisión de §2.3 de que alguien la
deshaga sin saber lo que cuesta.

> Nota de proceso: durante M3 subí la versión de la rama mientras el script de
> mutaciones estaba restaurando `index.html`, y dejé `sw.js` en 7.453 con
> `index.html` en 7.452. Lo vio la guarda de CI `APP_VERSION synced to the SW` en
> la salida de M4. Reparado y vuelto a verificar: **410 passed, 0 failed**.

---

## 7 · Compatibilidad

| | Estado | Cómo se comprobó |
|---|---|---|
| Login | intacto | C-2 no toca login, PIN ni `sesion` |
| Guardar progreso (`employees`) | intacto | otra tabla, otro camino (`supaUpsertEmployee`) |
| Actividad real | **funciona** | las 14 llamadas siguen registrando; la suite ejecuta la función real |
| `scores` existentes | **funcionan** | los 3 escritores siguen enviando; 3 peticiones capturadas |
| Lectura / ranking | intacta | piden columnas explícitas; verificado por HTTP real en C-1 (V4 → 200) |
| Logout | intacto | `_authToken` a `null` → `_cuerpoPropio` vuelve a la rama de compatibilidad |
| Refresco de sesión | intacto | `onAuthStateChange` sigue manteniendo `_authToken` |
| Usuario autenticado | **cuerpo limpio** | §4.1 |
| **`anon` actual** | **sin cambios** | sigue mandando `employee` y `venue`, y sus grants están intactos |
| Cuenta de administración | sigue sin dejar rastro | prueba propia: 0 peticiones |
| `_vSello` y sus otras 8 tablas | intacto | guarda que falla si cambia o si pierde usos |

---

## 8 · Riesgos restantes

| | Riesgo | Estado |
|---|---|---|
| **R1** | **`employee` y `venue` siguen siendo falsificables** por un cliente manipulado | lo cierra **C-3**. Medido en §4.2 |
| **R2** | La rendija sin token es una ruta viva donde el cliente aún manda identidad | desaparece en C-3; su borrado prematuro lo detecta M4 |
| **R3** | Tras C-3, una sesión sin token perderá la escritura si no existe B2 | **es el orden C-2 → B2 → C-3**, no un riesgo nuevo |
| **R4** | El SHA del PIN sigue siendo credencial al portador | fuera de alcance; ninguna de estas fases lo arregla |
| **R5** | `anon` no puede ejecutar `app.emp_actual()`: el error de la rendija es confuso (`42501` en vez de `23502`) | decisión pendiente para C-3; conceder `EXECUTE` a `anon` lo aclararía sin filtrar nada |

### Deuda heredada de C-1 — documentada, no resuelta aquí

1. **`employees_identidad_inmutable` no protege nada**: es `SECURITY DEFINER`, y
   ahí `current_user` es `postgres`, no el rol que llama, así que su guarda es
   siempre falsa. Medido.
2. **`name` sí es actualizable por `authenticated`** — está en la lista de grants
   por columna. En la prueba sólo lo paró una clave ajena, y sólo 9 de 22 fichas
   la tienen.
3. **`scores` y `actividad` cuelgan del nombre por texto y sin clave ajena**, así
   que un renombrado mueve o huérfaniza el histórico de esa persona. Los 58
   huérfanos de hoy vienen de ahí.

Los tres son de `employees`/identidad, no de la autoridad de `scores`/`actividad`.
**Deuda separada.**

---

## 9 · Rollback

C-2 es sólo cliente. Revertir es volver a `_vSello` en los cuatro sitios y
eliminar `_cuerpoPropio`:

```
git revert <commit de C-2>        # o
git checkout <commit anterior> -- index.html tests/smoke.mjs sw.js
```

**No hace falta tocar la base**: C-1 es compatible con las dos formas del cuerpo
—con identidad y sin ella—, que es exactamente para lo que se diseñó como paso
aislado. Revertir C-2 sin revertir C-1 deja el sistema funcionando.

Y como nada está publicado, revertir es gratis: producción sigue en **v7.451**.

---

# C-2 APLICADA Y VERIFICADA

Con una salvedad que no quiero que pase desapercibida: **no es incondicional.**
Con sesión, el cuerpo va limpio —los cinco campos los pone el servidor y se ha
comprobado que corresponden al usuario autenticado—. Sin sesión, se sigue mandando
el nombre, porque hoy la alternativa es perder la prueba de alguien en silencio.
Está en §2.3, tiene test propio y mutación propia, y muere en C-3.

Lo que C-2 **no** hace, y conviene repetirlo: el ataque `employee:'Ana'` **sigue
colando hoy** —lo he medido, y crea la fila—. C-2 hace que el cliente honesto no
mande identidad; que el manipulado no pueda es C-3.

Suite: **410 passed, 0 failed**. Auditoría de alérgenos: 0/0. Nada publicado; C-3
y B2 sin empezar.
