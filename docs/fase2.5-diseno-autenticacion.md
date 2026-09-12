# Fase 2.5 — Diseño de autenticación y aislamiento real

**Documento de diseño. No se ha modificado ni una línea de código, ni la base
de datos, ni las políticas, ni la autenticación.** Todo lo que sigue está
medido contra el proyecto real en septiembre de 2026, con la aplicación en
v7.448 (commit `2b995c0`).

Las comprobaciones de permisos se hicieron con filtros imposibles dentro de
bloques que **abortan siempre**, de modo que ninguna prueba pudo escribir,
modificar ni borrar nada.

---

## Resumen para decidir en dos minutos

El servidor **ya sabe** verificar el PIN de un empleado y **ya decide** a qué
restaurante pertenece. Lo único que falta es convertir esa verificación en una
**sesión** que la base de datos pueda leer. No hay que construir un sistema de
identidad: hay que terminar el que ya está a medias.

Pero antes de eso hay tres agujeros abiertos **hoy**, que no dependen de la
autenticación y que se pueden cerrar sin tocar el cliente:

| # | Agujero | Comprobado |
|---|---|---|
| 1 | Cualquiera puede **borrar** las 22 fichas de empleado | sí |
| 2 | Cualquiera puede **modificar y borrar** las 427 filas de `scores` | sí |
| 3 | `localStorage` guarda un **credencial reutilizable** del empleado 90 días | sí |

Y una anomalía que hay que mirar hoy mismo: **hay una cuenta desconocida en
`auth.users`** (`mass_advkoujf_60306@ues.edu.pl`), en un sistema de
autenticación que la aplicación **no usa en ninguna línea**.

---

## 1 · Arquitectura actual

```
NAVEGADOR (PWA, index.html de un solo fichero, 33k líneas)
    │
    │  clave anon en el código fuente, a la vista de cualquiera
    │  (línea 2048 de index.html)
    ▼
SUPABASE  advkoujfgbrrjvqexrcu.supabase.co
    ├── PostgREST   /rest/v1/<tabla>        ← 11 tablas, acceso directo
    ├── PostgREST   /rest/v1/rpc/<función>  ← 5 funciones desde el cliente
    ├── Edge Funcs  /functions/v1/<nombre>  ← 4: reset-pin, send-push,
    │                                          manage-content, leer-horario
    ├── Realtime    wss://…                 ← sólo el chat
    ├── Storage     dish-photos, wine-images, chat-images
    └── Auth (GoTrue)  ← ACTIVO, pero la aplicación NO LO USA (0 llamadas)
```

**Proveedor: Supabase.** Confirmado, no supuesto: la clave del cliente es un
JWT con `"role":"anon"` e `"iss":"supabase"`, el CSP declara
`connect-src https://advkoujfgbrrjvqexrcu.supabase.co`, y hay Edge Functions,
Storage y Realtime del propio proyecto.

**Hay 21 tablas, todas con RLS activado.** Diez de ellas tienen RLS **sin
ninguna política**, que en Postgres significa «cerrada a cal y canto salvo para
`service_role`». Eso no es un descuido: es el patrón que ya se usa para los
secretos (`supervisor_pins`, `venue_codes`, `*_pin_attempts`,
`employee_recovery`, `password_resets`, `nda_signatures`). **Ese patrón ya
funciona y es el que hay que extender.**

### Lo que ya está bien hecho

No hay que rehacerlo, hay que apoyarse en ello:

- **`verify_employee_pin_sha(name, sha)`** — `SECURITY DEFINER`, compara contra
  `employees.pin`, que la clave anon **no puede leer** (comprobado:
  `employees.pin SELECT = DENEGADO`). Lleva limitador por nombre: 10 fallos en
  15 minutos y bloquea.
- **`employee_register(name, sha, código, display)`** — el **restaurante lo
  decide el servidor** a partir del código del restaurante, no el cliente. El
  rol se fija a `'staff'` en duro. Limitador por IP: 8 fallos y bloquea.
- **Trigger `employees_solo_alta_con_codigo`** — impide crear fichas nuevas por
  REST; sólo pasan las que vienen de `employee_register`.
- **Triggers `admin_no_puntua` / `admin_sin_marcas`** — la cuenta de
  administración no puntúa, y eso se impone **en el servidor**.
- **`employees.venue` y `employees.role` son de sólo lectura para el cliente**
  (comprobado: `UPDATE venue = DENEGADO`, `UPDATE role = DENEGADO`).

Es decir: el trabajo de hacer al servidor autoritativo **ya empezó** y está a
medio camino.

---

## 2 · Mapa de identidad actual

### Las nueve preguntas

**1. ¿Cómo se selecciona el empleado?** Se toca su nombre en una lista y se
teclea un PIN de 4 cifras.

**2. ¿Dónde se almacena?** En la variable `currentUser` (un `let` de ámbito de
script) y en `localStorage.txoko_last_user`. La sesión persistente va en
`localStorage.txoko_session`.

**3. ¿Qué dato identifica al empleado?** **Su nombre, en texto.**
`employees` tiene como clave primaria `name text`. **No existe ninguna columna
`id`.** `actividad.employee` y `scores.employee` son `text` sin clave ajena.

**4. ¿Cómo se selecciona el restaurante?** De una lista definida en un fichero
de datos del propio cliente (`THEMES.venues`), filtrada por `enabled`.

**5. ¿Dónde se almacena?** `localStorage.txk_venue`. `_venueActual()` lo lee de
ahí y `_vSello()` lo estampa en cada fila que se escribe.

**6. ¿Cómo se valida?** **No se valida.** El servidor acepta el `venue` que
mande el cliente. No comprueba que el empleado pertenezca a él.

**7. ¿Qué puede cambiar cualquiera desde DevTools?**

| Variable | Efecto |
|---|---|
| `currentUser = 'Otro'` | escribe actividad y progreso a nombre de otro |
| `localStorage.txk_venue` | escribe y lee en otro restaurante |
| `localStorage.txoko_session` | **entra como cualquiera, sin red** |
| `DB.employees[X].role` | (sólo local; el rol real viene de la nube) |
| `localStorage.txk_sup_device` | activa avisos internos de supervisor |

**8. ¿Qué sabe realmente el servidor?** Que alguien con la clave pública está
escribiendo. Nada más. **No sabe quién.**

**9. ¿Qué parte de la identidad es sólo una convención del cliente?**
Prácticamente toda. El servidor sólo es autoritativo en tres momentos: el alta
(el restaurante sale del código), la verificación del PIN, y los triggers de la
cuenta de administración. Entre esos momentos, nada ata lo que el cliente dice
ser con lo que el servidor le deja hacer.

### El diagrama, con lo fiable marcado

```
CLIENTE                                    ¿fiable?
  currentUser = 'Ana'  (let en memoria)      NO ── cualquiera lo reasigna
  txk_venue   = 'txoko' (localStorage)       NO ── cualquiera lo edita
  txoko_session {user, hash}                 NO ── credencial reutilizable
  DB.employees (localStorage, TODO el equipo) NO ── de todos los que entraron
        │
        ▼
PETICIÓN
  apikey: <clave anon, pública>              NO ── la tiene cualquiera
  Authorization: Bearer <la misma anon>      NO
  body: { employee:'Ana', venue:'txoko', … } NO ── el cliente lo elige
        │
        ▼
BACKEND — PostgREST
  no hay sesión que consultar                ── no puede decidir nada
        │
        ▼
BASE DE DATOS
  RLS: employees/scores  allow_all (true)    NO protege
  RLS: actividad         insert/select true  NO protege identidad
  RLS: venue_codes, pins, nda  sin política   SÍ ── cerradas de verdad
  Triggers: alta con código, admin no puntúa  SÍ ── son autoritativos
  RPC SECURITY DEFINER: PIN, alta, roles      SÍ ── pero el PIN va de portador
```

**La única frontera real hoy está dentro de las funciones `SECURITY DEFINER`.**
Todo lo que va por REST directo es honor system.

---

## 3 · Vulnerabilidades confirmadas

Medidas contra la base real, con el rol `anon` —el mismo que lleva la página—,
con operaciones que no podían afectar a ninguna fila y en bloques que abortan.

### Matriz efectiva de la clave pública

Efectivo = permisos de columna ∩ políticas RLS. Es lo que de verdad pasa.

| Tabla | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `employees` | ✅ 22 filas (todo salvo `pin`) | ✅ (sólo con código) | ✅ xp, racha, progreso y **`name`**; ❌ `venue`, `role` | 🔴 **SÍ** |
| `scores` | ✅ 427 filas | ✅ | 🔴 **SÍ** | 🔴 **SÍ** |
| `actividad` | ✅ todas | ✅ cualquier `employee`/`venue` | ❌ | ❌ |
| `duels` | ✅ 40 | ✅ | ✅ | ✅ |
| `chat_messages` | ✅ 15 | ✅ | ✅ | ❌ |
| `horarios` | ✅ | ❌ | ❌ | ❌ |
| `venue_codes` | ⛔ 0 filas (RLS) | ⛔ | ⛔ | ⛔ |
| `nda_signatures` | ⛔ 0 filas (RLS) | ⛔ | ⛔ | ⛔ |
| `supervisor_pins`, `*_attempts`, `employee_recovery`, `password_resets`, `ai_usage` | ⛔ sin permiso | ⛔ | ⛔ | ⛔ |

### Corrección de lo que informé en la Fase 1

En `registro-actividad-cobertura.md` escribí que modificar y borrar filas
ajenas estaba **bloqueado**, y que `actividad` era «algo más estricta» que
`scores` y `employees`. **Eso era cierto sólo para `actividad`.** Medido ahora
tabla por tabla:

- `scores` **sí** permite UPDATE y DELETE a cualquiera. Las 427 filas del
  histórico del equipo se pueden reescribir o borrar enteras.
- `employees` **sí** permite DELETE a cualquiera. Las 22 fichas se pueden
  borrar.

La conclusión de aquel documento —hace falta autenticación— no cambia. La
gravedad, sí: no es sólo que se pueda falsear progreso; es que se puede
**destruir el histórico**.

### Las tres que hay que mirar ya

**V1 · Borrado de empleados.** `employees` tiene `DELETE` concedido a `anon` y
una política `allow_all` con `USING (true)` para el comando `ALL`. Comprobado
que `anon` ve las 22 filas, luego el `USING` se le aplica y el `DELETE` también.
Una petición borra la plantilla entera; con ella se van el XP, las rachas, los
logros y el progreso de todos.

**V2 · Reescritura del histórico.** `scores` permite UPDATE y DELETE. Es la
tabla de la que comen hoy el ranking, el panel del supervisor y la precisión de
cada persona.

**V3 · El credencial en el bolsillo.** `localStorage.txoko_session` guarda
`{user, hash}` durante **90 días deslizantes**, y ese `hash` es **exactamente**
el valor que `verify_employee_pin_sha(nombre, sha_hex)` acepta como PIN
correcto. Además:

- el hash es `SHA-256(pin + 'txoko_salt_2026')` — **sal global y fija**, sin
  derivación de clave. Un PIN de 4 cifras tiene 10 000 posibilidades: una tabla
  para todo el equipo se calcula en milisegundos;
- el auto-login compara `emp.pin === hash` **en local**, sin preguntar al
  servidor. Escribiendo dos claves de `localStorage` se entra como quien sea,
  **sin conexión y sin saber ningún PIN**.

**V4 · Renombrado.** `employees.name` es la clave primaria y el cliente puede
actualizarla. `actividad.employee` y `scores.employee` **no tienen clave
ajena**: renombrar a alguien deja su histórico huérfano, en silencio.

**V5 · Cuenta desconocida en Auth.** `auth.users` tiene exactamente una fila:
`mass_advkoujf_60306@ues.edu.pl`. No es del propietario. La aplicación no usa
Auth en ninguna línea, así que nadie del equipo la creó desde aquí. Encaja con
el patrón de altas automatizadas contra proyectos con el registro abierto. Hoy
ese usuario **no puede leer nada** (el rol `authenticated` tiene los mismos
permisos que `anon`, y las tablas sensibles están cerradas), pero:

> ⚠ **Si se implementa la autenticación sin cerrar antes el registro público,
> esa cuenta —y cualquier otra que se registre sola— pasaría a ser
> `authenticated`, que es justo el rol al que vamos a dar permisos.**

Es la razón por la que la primera tarea de la fase de implementación no es
autenticar: es **cerrar el registro y revisar esa cuenta**.

### Además, del informe del propio Supabase

- 17 funciones `SECURITY DEFINER` ejecutables por `anon`. Muchas lo necesitan
  (el PIN, el alta), pero `admin_no_puntua` y `admin_sin_marcas` son funciones
  **de trigger** y no deberían ser invocables por REST.
- La vista `cron_health` es `SECURITY DEFINER` (marcado como ERROR).
- La protección contra contraseñas filtradas está desactivada.

---

## 4 · Modelo de autorización actual

Hoy la autoridad no la da un rol: la da **el PIN de supervisor, que viaja como
credencial de portador en cada llamada**.

```
verify_supervisor_pin(pin, venue) ──► ¿es el PIN? sí/no
        │
        ├── venue_staff_list(pin, venue)   ← lee la plantilla
        ├── employee_set_role(pin, …)      ← cambia roles (sólo ámbito '*')
        ├── venue_code_rotate(pin, venue)  ← rota el código de alta
        ├── venue_pin_set(pin, …)          ← cambia PINes de supervisor
        └── save_rota(pin, …)              ← guarda el cuadrante
```

Está **mejor diseñado de lo que parece**: el ámbito por restaurante
(`sup_pin_scope`), la protección del último propietario y el limitador por IP
son decisiones correctas. Pero el modelo tiene tres límites de fondo:

1. **El PIN es la identidad.** Quien lo sepa *es* el supervisor. No hay «quién»:
   no se puede saber qué persona hizo un cambio, sólo que alguien tenía el PIN.
2. **Viaja en cada petición** y se queda en memoria (`_supPin`).
3. **No caduca ni se revoca**, salvo rotándolo para todos a la vez.

Y en el cliente, `employees.role` tiene hoy **0 supervisores** y 1
administrador: la autoridad del supervisor **no pasa por el rol en absoluto**.

---

## 5 · Alternativas de autenticación

Sólo se consideran las que la arquitectura real soporta. No hay infraestructura
inventada.

### A · Supabase Auth con usuario y contraseña desde el cliente

Correo sintético (`ana@txoko.meseo.local`) y el PIN como contraseña.

**A favor**: cero código de servidor; sesiones, refresco y expiración de fábrica.

**En contra, decisivo**: expone un PIN de 4 cifras en el endpoint público de
autenticación, **perdiendo el limitador propio** que hoy sí existe
(`emp_pin_attempts`). Supabase exige 6 caracteres mínimo, así que habría que
alargar el PIN o rellenarlo — y rellenarlo en el cliente significa que el
relleno está en el código fuente. **Descartada.**

### B · Edge Function que canjea el PIN por una sesión ⭐

El PIN nunca sale hacia GoTrue. Una Edge Function con `service_role`:

```
1. recibe  { nombre, sha_del_pin }
2. llama   verify_employee_pin_sha()   ← el limitador de siempre, intacto
3. si vale, inicia sesión con la contraseña fuerte que el SERVIDOR guarda
   para esa cuenta (tabla cerrada a anon, como venue_codes)
4. devuelve { access_token, refresh_token }
5. el navegador hace setSession() y a partir de ahí manda su propio token
```

**A favor**: reutiliza **todo** lo que ya funciona (el PIN verificado en
servidor, el limitador, el alta con código); da JWT real con `auth.uid()`, que
es lo que RLS sabe leer; da refresco y expiración de fábrica; **no necesita
correo**; el PIN no se convierte en contraseña de nadie.

**En contra**: una Edge Function más que mantener (ya hay cuatro) y una columna
`auth_user_id` en `employees`.

### C · JWT propio firmado con el secreto del proyecto

Una Edge Function firma un token con las reclamaciones que queramos.

**A favor**: sin filas en `auth.users`, control total de las reclamaciones.

**En contra**: hay que implementar a mano caducidad, refresco y revocación —
exactamente lo que más fácil es equivocar—, y Supabase está migrando de claves
simétricas a asimétricas. **Descartada como solución principal.**

### D · Todo por RPC, con el PIN de portador

Extender a la actividad y al progreso lo que ya se hace con el supervisor.

**A favor**: ni Auth ni sesiones; el patrón ya está en la casa y funciona.

**En contra**: el PIN viaja en cada escritura, no caduca, no se revoca y no
resuelve la **lectura** (habría que envolver también cada consulta). **No sirve
como destino**, pero **sí como red de seguridad**: las funciones que ya existen
seguirán funcionando durante toda la migración.

### Comparativa

| | A · Auth directo | **B · Canje por Edge Function** | C · JWT propio | D · RPC con PIN |
|---|---|---|---|---|
| Seguridad | media | **alta** | media-alta | media |
| Complejidad | baja | **media** | alta | media |
| Coste | 0 | **0** (dentro del plan) | 0 | 0 |
| Sin correo | ✗ sintético | **✓** | ✓ | ✓ |
| Compatible PWA / offline | ✓ | **✓** | ✓ | ✓ |
| Conserva el limitador del PIN | ✗ | **✓** | ✓ | ✓ |
| Dispositivo compartido | ✓ | **✓** | ✓ | ✗ |
| `auth.uid()` en RLS | ✓ | **✓** | parcial | ✗ |
| Caducidad y revocación | ✓ | **✓** | a mano | ✗ |
| Impacto en el cliente | medio | **medio** | medio | alto |

### Recomendación: **B**

Y la razón principal no es la seguridad —A y C también la dan— sino que **B es
el único que no tira nada de lo que ya está construido y probado**. El PIN
verificado en servidor, el limitador por nombre, el alta con código del
restaurante y el restaurante decidido por el servidor **siguen intactos**: lo
único que se añade es que al final de esa comprobación, que ya existe, se
entrega un token.

---

## 6 · Dispositivos compartidos

Obligatorio, y hoy es donde peor está.

### Lo que pasa ahora

**`localStorage` guarda `DB`, un único objeto con la ficha de TODOS los
empleados que han entrado alguna vez en ese aparato.** Progreso, XP, rachas,
SRS, respuestas, y —en las fichas antiguas— el hash del PIN. En el iPad de la
cocina, eso es el equipo entero.

Al salir, `logout()` borra `txoko_session` pero **`DB` se queda**.

```
HOY                                    OBJETIVO
┌──────────── un aparato ───────────┐  ┌──────────── un aparato ───────────┐
│ DB = { Ana:{…}, Luis:{…}, … }     │  │ meseo:v1:<id de Ana>  → {…}       │
│ txoko_session = {Ana, hashPIN}    │  │ meseo:v1:<id de Luis> → {…}       │
│  ↑ credencial reutilizable 90 días│  │ sesión = token en memoria +       │
│ salir → sólo borra la sesión      │  │          refresh en almacén       │
│ Luis ve todo lo de Ana            │  │ salir → se purga la de quien sale │
└───────────────────────────────────┘  └───────────────────────────────────┘
```

### Diseño propuesto

**Un cajón por empleado, y la llave es el `id` de la sesión.**

| Almacén | Hoy | Propuesto |
|---|---|---|
| `localStorage` DB | un blob con todo el equipo | una clave por empleado, `meseo:v1:<auth_user_id>` |
| `txoko_session` | `{user, hash del PIN}` | **eliminado**; sólo el `refresh_token` de Supabase |
| `txk_venue` | elegido por el usuario | **derivado** de la sesión; sólo informativo en local |
| `txoko_last_user` | nombre | se puede quedar: es una comodidad, no una credencial |
| Cola offline | conjunto de nombres | una cola **por empleado**, con su `id` |
| IndexedDB | sólo mapas de imágenes | sin cambios (no tiene datos personales) |
| Caché del *service worker* | contenido estático y datos públicos | sin cambios; **nunca cachear respuestas con `Authorization`** |

**Al cerrar sesión**: se borra el cajón del empleado que sale, su cola offline
pendiente **sólo si está vacía**, y el refresco. Si le queda actividad sin
enviar, se avisa y se conserva **cifrada bajo su propia clave** hasta que
vuelva a entrar. Perder el trabajo de alguien por cambiar de turno sería peor
que el riesgo que evita borrarlo.

**Modo quiosco** (recomendado para el iPad de sala): sesión corta, sin
recordar, y vuelta a la lista de nombres al cabo de N minutos de inactividad.
Es una decisión del propietario, no técnica — está en el apartado 21.

---

## 7 · Offline

La aplicación ya funciona sin conexión, y esa propiedad **no se puede perder**:
el personal la usa en zonas del hotel sin cobertura.

### Lo que hay hoy

- El *service worker* cachea la aplicación y los datos públicos. **No hay cola
  de sincronización en él**, ni `Background Sync`.
- El único reintento es `txk_sync_outbox`: **un conjunto de nombres**, no de
  datos. Al reconectar vuelve a subir la ficha entera de ese empleado.
- **`registrarActividad()` no tiene reintento ninguno.** Si falla, la fila se
  pierde para la nube. Sólo queda en el diario local de la Fase 2 (14 días), y
  nada la reenvía.

Es decir: **hoy la actividad generada sin cobertura no llega nunca al
servidor.** Con `actividad` a 0 filas eso todavía no ha hecho daño, pero lo hará
en cuanto el panel del supervisor dependa de esa tabla.

### Diseño propuesto

```
CON RED          sesión válida (token ~1 h, refresco ~30 días)
   │             escribir = enviar con el token; el servidor decide
   ▼
SIN RED          el token sigue en memoria; el servidor no está
   │             ├─ LEER: todo lo que ya estaba en el cajón del empleado
   │             ├─ ESCRIBIR: a la cola de ESE empleado, con su id de evento
   │             └─ la identidad NO se guarda en el evento
   ▼
VUELVE LA RED    1. refrescar la sesión
                 2. ¿la sesión que vuelve es del MISMO empleado que la cola?
                    · sí  → enviar, el servidor pone employee y venue
                    · no  → la cola se queda aparcada hasta que entre él
                 3. el servidor descarta lo repetido por el id de evento
```

**Las cuatro decisiones que importan:**

**1. La identidad no viaja en la cola.** Cada evento guarda qué se hizo, no
quién lo hizo. Al enviar, `employee` y `venue` los pone **el servidor** desde el
token. Manipular la cola no puede cambiar a nombre de quién se registra: el
campo ni siquiera existe ahí.

**2. La cola es del empleado, no del aparato.** Se guarda bajo su `id` y sólo
se vacía cuando la sesión activa es la suya. Si Ana deja trabajo pendiente y
entra Luis, lo de Ana **no** se manda como si fuera de Luis: espera.

**3. Cada evento nace con un identificador propio** (`crypto.randomUUID()`) que
va en la fila. Una restricción de unicidad por `(employee, client_id)` hace que
reenviar diez veces lo mismo escriba **una**. Es lo que hace seguro reintentar.

**4. Si la sesión caduca sin red**, no se cierra la sesión ni se echa a nadie:
se sigue entrenando y escribiendo a la cola. Al volver se intenta refrescar; si
el refresco también ha caducado, se pide el PIN **una vez**, y entonces se
vacía la cola. Nada se pierde y nadie se queda fuera en mitad de un servicio,
que es exactamente el criterio que ya aplicó el PIN de servidor.

---

## 8 · Modelo de autoridad

Cuatro papeles. `employees.role` ya existe con `'staff' | 'admin' | 'manager' |
'owner'`; se mantiene ese vocabulario y se le añade significado real.

| Acción | Empleado | Supervisor (manager/owner) | Admin |
|---|---|---|---|
| **LEER** | | | |
| su propia ficha | ✅ | ✅ | ✅ |
| ficha de otro de su restaurante | ❌ | ✅ | ✅ |
| ficha de otro restaurante | ❌ | ❌ | ✅ (sólo `owner`) |
| su propia actividad | ✅ | ✅ | ✅ |
| actividad de su restaurante | ❌ | ✅ | ✅ |
| ranking de su restaurante | ✅ (agregado) | ✅ | ✅ |
| contenido de su restaurante | ✅ | ✅ | ✅ (todos) |
| PINes, códigos, NDA | ❌ | ❌ | ❌ (sólo por RPC) |
| **CREAR** | | | |
| actividad propia | ✅ | ✅ | ❌ (no puntúa) |
| actividad de otro | ❌ | ❌ | ❌ |
| actividad en otro restaurante | ❌ | ❌ | ❌ |
| asignaciones (fase 4) | ❌ | ✅ en su restaurante | ✅ |
| alta de empleado | ❌ | ✅ (código) | ✅ |
| **MODIFICAR** | | | |
| su progreso | ✅ campos permitidos | ✅ | ✅ |
| progreso de otro | ❌ | ❌ | ❌ |
| su `venue` o su `role` | ❌ | ❌ | ❌ |
| `role` de otro | ❌ | ❌ | ✅ sólo `owner` |
| actividad ya escrita | ❌ | ❌ | ❌ **nadie** |
| **BORRAR** | | | |
| actividad | ❌ | ❌ | ❌ **nadie** |
| `scores` | ❌ | ❌ | ❌ **nadie** |
| empleado | ❌ | ❌ | ✅ sólo `owner`, por RPC, con baja lógica |

**Dos principios que conviene fijar por escrito:**

- **La actividad no se modifica ni se borra, por nadie.** Es un registro de lo
  que pasó. Si hay que anular algo, se anula con otra fila, no borrando la
  primera. Hoy `actividad` ya es así —fue la única decisión que salió bien— y
  hay que extenderlo a `scores`.
- **Nadie cambia su propio `role` ni su propio `venue`.** Ya es así. Se
  mantiene.

---

## 9 · RLS y políticas

### La pieza central

```sql
-- employees gana la identidad real; `name` sigue siendo la clave primaria
-- para no romper 33 000 líneas que la usan.
alter table public.employees
  add column auth_user_id uuid unique references auth.users(id);

-- Ayudantes STABLE SECURITY DEFINER, en un esquema no expuesto por la API.
create schema if not exists app;

create function app.emp_actual() returns text     -- nombre del que ha entrado
create function app.venue_actual() returns text   -- su restaurante, de la BD
create function app.rol_actual() returns text     -- su rol, de la BD
create function app.es_supervisor() returns boolean -- rol in ('manager','owner')
```

Los tres leen de `employees where auth_user_id = auth.uid()`. **A propósito
leen la tabla y no el token**: si a alguien se le quita el rol, deja de tenerlo
en la siguiente petición, no cuando le caduque el token.

En las políticas se escriben como `(select app.emp_actual())` — con el
paréntesis — para que Postgres lo evalúe una vez por consulta y no una vez por
fila.

### `actividad`

```sql
-- LEER: lo tuyo, siempre. Lo de tu restaurante, sólo si mandas.
create policy actividad_select on public.actividad for select to authenticated
using (
  employee = (select app.emp_actual())
  or ( (select app.es_supervisor()) and venue = (select app.venue_actual()) )
);

-- CREAR: sólo a tu nombre y en tu restaurante.
create policy actividad_insert on public.actividad for insert to authenticated
with check (
  employee = (select app.emp_actual())
  and venue = (select app.venue_actual())
);

-- MODIFICAR y BORRAR: ninguna política. Nadie, nunca.
revoke update, delete on public.actividad from anon, authenticated;
revoke all on public.actividad from anon;     -- el rol anónimo deja de escribir
```

**Y además, el cinturón:** un trigger `BEFORE INSERT` que **sobrescribe**
`employee` y `venue` con los de la sesión en lugar de comprobarlos.

```sql
create function public.actividad_sella_identidad() returns trigger
  language plpgsql security definer as $$
begin
  new.employee   := app.emp_actual();
  new.venue      := app.venue_actual();
  new.created_at := now();
  if new.employee is null then raise exception 'sin_sesion'; end if;
  return new;
end $$;
```

La diferencia importa: con el `WITH CHECK`, una petición con `employee` ajeno
**se rechaza**; con el trigger, **se ignora y se escribe la verdad**. Lo
segundo es más robusto y no rompe a un cliente antiguo que aún mande el campo.

### `employees`

```sql
create policy employees_select on public.employees for select to authenticated
using (
  name = (select app.emp_actual())
  or venue = (select app.venue_actual())   -- el ranking necesita a los compañeros
);

create policy employees_update on public.employees for update to authenticated
using  (name = (select app.emp_actual()))
with check (name = (select app.emp_actual()));

-- El alta sigue siendo exclusiva de employee_register (trigger ya existente).
-- BORRAR: ninguna política.  ← cierra V1
revoke delete on public.employees from anon, authenticated;
revoke update (name) on public.employees from anon, authenticated;  -- cierra V4
```

Nota: el ranking necesita ver a los compañeros. Si se quiere ocultar el detalle
y enseñar sólo lo agregado, lo correcto es una **vista** con las columnas
públicas (nombre visible, XP, nivel) y quitar el `or venue = …` de arriba. Es
una decisión de producto — apartado 21.

### `scores`

```sql
create policy scores_select on public.scores for select to authenticated
using ( employee = (select app.emp_actual()) or venue = (select app.venue_actual()) );

create policy scores_insert on public.scores for insert to authenticated
with check ( employee = (select app.emp_actual()) and venue = (select app.venue_actual()) );

revoke update, delete on public.scores from anon, authenticated;   -- cierra V2
```

**Las dos revocaciones de `scores` y la de `employees` se pueden hacer HOY**,
antes de cualquier autenticación, y no rompen nada: la aplicación nunca
modifica ni borra filas de esas tablas. Es la primera fase del plan.

### Riesgos que quedan cubiertos

| Manipulación | Qué lo impide |
|---|---|
| `employee_id` cambiado | el trigger lo sobrescribe con el de la sesión |
| `venue_id` cambiado | ídem, y el `WITH CHECK` como segunda barrera |
| `role` cambiado en el cliente | el rol se lee de la BD, no del cliente ni del token |
| restaurante activo cambiado en `localStorage` | deja de tener efecto en el servidor; sólo cambia colores |
| token robado | caduca en ~1 h; el refresco se puede revocar |

---

## 10 · `registrarActividad()`

No se cambia ahora. Así quedaría el reparto:

| Campo | Hoy | Después | Por qué |
|---|---|---|---|
| `employee` | `currentUser` del navegador | **lo pone el servidor** | es la vulnerabilidad entera |
| `venue` | `localStorage` | **lo pone el servidor** | pertenencia, no elección |
| `created_at` | `now()` de la BD | igual, forzado por trigger | ya está bien |
| `activity` | cliente | **cliente** | es lo que se hizo |
| `competency` | cliente | **cliente**, validado por CHECK | ya hay vocabulario cerrado |
| `kind` | cliente | **cliente**, validado por CHECK | ídem |
| `score` / `total` | cliente | **cliente**, validado por CHECK | el servidor no puede saberlo |
| `seconds` | cliente | **cliente** | ídem |
| `meta` | cliente | **cliente** | información de apoyo |
| `client_id` | — | **nuevo, del cliente** | idempotencia de la cola offline |

Forma futura, sin implementar:

```js
// El cuerpo se queda sin employee ni venue: ya no son del cliente.
body: JSON.stringify({
  client_id: a.clientId,        // nace con el evento, sobrevive a los reintentos
  activity: a.activity, competency, kind, score, total,
  seconds: …, meta: a.meta || null
})
// y la cabecera deja de llevar la clave anon:
'Authorization': `Bearer ${sesion.access_token}`
```

Puntualización: **la puntuación y el total los sigue diciendo el cliente**, y no
hay forma de evitarlo sin llevar los exámenes al servidor. La autenticación
resuelve *a nombre de quién* se registra, no *si el resultado es cierto*. Quien
quiera inflar su propia nota podrá seguir haciéndolo. Conviene que quede dicho
ahora y no cuando el panel del supervisor tome decisiones con esos números.

---

## 11 · Estrategia para `scores`

`scores` no se retira. Hoy es de quien comen el ranking, el panel actual, la
precisión media y parte del XP.

```
FASE ACTUAL     scores (427) ── panel actual, ranking, precisión
                actividad (0) ── nadie todavía

2.5A            scores: se le quitan UPDATE y DELETE       ← sin tocar el cliente
2.5D-E          las dos escriben con identidad del servidor
FASE 3          el panel nuevo lee de `actividad`; el viejo sigue con `scores`
FASE 4+         cuando el panel nuevo esté probado, `scores` pasa a sólo lectura
                histórica. Nunca se borra: es el histórico real del equipo.
```

**Impacto de la autenticación en cada consumidor:**

| Consumidor | Fuente | Qué cambia |
|---|---|---|
| Ranking / liga | `scores` + `employees` | nada, si la política de lectura incluye el restaurante |
| Panel supervisor actual | `scores`, `employees.extras` | nada mientras el supervisor sea `manager`/`owner` |
| XP y niveles | local + `employees.xp` | nada |
| Juegos (Survivors, Shoesmith) | `scores` como marcador | nada; siguen insertando, ahora a su nombre real |
| Duelos | `duels` | **sí**: hoy es CRUD abierto; hay que darle política propia |
| SRS | **sólo local** | nada |
| Hoy (Fase 2) | local + diario | nada; el plan no toca la red |

El SRS y el plan de Hoy **no se ven afectados en absoluto**, porque son locales.
Eso es una ventaja del diseño de la Fase 2 que conviene no perder.

---

## 12 · El PIN de supervisor

### Qué protege hoy

El panel del supervisor (`renderSupervisor` exige `supAuthenticated`, que sólo
se pone tras verificar contra el servidor), la lista de plantilla, el cambio de
roles, la rotación del código del restaurante, el cuadrante y los PINes por
restaurante. **Eso está bien hecho**: la verificación es de servidor, con
limitador, y el ámbito por restaurante existe.

### Qué NO protege

- **No identifica a nadie.** Registra que alguien sabía el PIN.
- **`localStorage.txk_sup_device = '1'`** hace que `_isSupDevice()` devuelva
  cierto sin ninguna verificación. Hoy sólo enciende un aviso interno en la guía
  de emplatado —no da acceso a datos—, pero es un permiso que se concede desde
  DevTools y conviene que no crezca.
- **El PIN queda en memoria** (`_supPin`) y se manda en cada llamada.
- **No caduca.** El PIN de Txoko `837083` sigue pendiente de cambiar desde que
  se documentó.

### Qué hacer

**Mantenerlo, y degradarlo a segundo factor.** No debe desaparecer y no debe
seguir siendo la credencial principal.

```
HOY        PIN supervisor ──────────────► autoridad completa

DESPUÉS    sesión (quién eres)  ──┐
                                  ├──► autoridad de supervisor
           rol manager/owner ─────┘     (y queda registrado QUIÉN)
                                  
           PIN supervisor ────────────► segundo factor para lo irreversible:
                                        cambiar roles, rotar el código,
                                        cambiar PINes, dar de baja
```

Así: el panel se abre por **rol**, no por PIN; cada acción queda atribuida a una
persona; y las operaciones que no se pueden deshacer siguen pidiendo el PIN,
que es una protección razonable contra un aparato desbloqueado sobre la barra.

Nota de transición: hoy hay **0 empleados con rol `manager` u `owner`**. Antes
de que el panel dependa del rol hay que asignarlo, y eso se hace con la función
que ya existe (`employee_set_role`, que pide el PIN). La primera asignación es
manual y es del propietario.

---

## 13 · Migración de los empleados existentes

22 fichas, 18 con PIN, 4 sin él. Un restaurante. Ninguna con correo.

**El correo no sirve aquí.** Pedir uno a cada camarero para entrar a estudiar la
carta es fricción por la que ya se perdió gente antes (el propietario lo
reportó: «acababan leyendo el PDF»). La identidad de un empleado en este entorno
es **su nombre y su PIN**, y el diseño lo respeta.

### Cómo se vincula

```
employees.name = 'Ana'          ← se queda como clave primaria
      + auth_user_id (nuevo) ──► auth.users.id
                                  email: ana@<venue>.meseo.invalid  (sintético)
                                  password: aleatoria de 32 bytes, que
                                            el empleado NUNCA ve ni escribe
```

El correo sintético usa `.invalid` a propósito: es un dominio reservado que no
puede existir, así que ningún correo real se va a intentar enviar nunca ahí. La
confirmación de correo se deja desactivada para ese flujo.

### El proceso, sin pedirle nada a nadie

1. Un trabajo de servidor crea una cuenta de Auth por cada una de las 22 fichas
   y guarda su contraseña fuerte en una tabla cerrada a `anon`.
2. La próxima vez que Ana entre con su PIN de siempre, la Edge Function lo
   verifica **como hoy** y le devuelve una sesión. **Ana no nota nada.**
3. Las 4 fichas sin PIN entran por el camino que ya existe: `set_employee_pin_sha`
   sólo lo fija si no había uno.

**No hay migración visible para el equipo.** Es el requisito más importante de
todo este apartado.

### Casos que hay que decidir

| Caso | Propuesta |
|---|---|
| Empleado sin PIN (4) | lo fija en su siguiente entrada, como ahora |
| Empleado que se fue | **baja lógica** (`activo=false`), nunca borrado: su histórico es del restaurante |
| Nombres duplicados | `employee_register` ya impide repetir sin mayúsculas; hay que comprobar los 22 actuales |
| Nombre cambiado | tras cerrar V4, sólo por RPC de supervisor, moviendo el histórico a la vez |
| PIN olvidado | ya existe `reset-pin` como Edge Function; hay que revisarla con el modelo nuevo |
| Supervisores | 0 hoy. El propietario asigna el primero a mano |
| La cuenta de Auth desconocida | **revisarla y eliminarla antes de dar permisos a `authenticated`** |

---

## 14 · Modelo de amenazas

«Hoy» = medido en este proyecto, en septiembre de 2026.

| # | Amenaza | ¿Posible hoy? | Cómo se bloquea | Capa |
|---|---|---|---|---|
| 1 | Cambiar `currentUser` en DevTools | **Sí** | el servidor pone `employee` desde el token | BD (trigger + RLS) |
| 2 | Cambiar el restaurante activo | **Sí** | el servidor pone `venue` desde `employees` | BD |
| 3 | Llamar al REST a pelo con la clave pública | **Sí** | se le revoca todo a `anon`; sin token no se escribe | BD (grants) |
| 4 | Enviar otro `employee_id` | **Sí** | sobrescrito por el trigger | BD |
| 5 | Enviar otro `venue_id` | **Sí** | ídem | BD |
| 6 | Leer otro restaurante | **Sí** | `USING (venue = app.venue_actual())` | BD |
| 7 | Crear actividad falsa a nombre de otro | **Sí** | (1) y (4) | BD |
| 8 | Modificar actividad | No | sin política de UPDATE; **mantener** | BD |
| 9 | Borrar actividad | No | sin política de DELETE; **mantener** | BD |
| 9b | **Borrar `employees` / `scores`** | **Sí** 🔴 | revocar DELETE | BD — **hoy** |
| 9c | **Reescribir `scores`** | **Sí** 🔴 | revocar UPDATE | BD — **hoy** |
| 10 | Manipular la cola offline | **Sí** | la cola no guarda identidad; se sella al enviar | Cliente + BD |
| 10b | Duplicar actividad al reintentar | **Sí** | `client_id` único por empleado | BD |
| 11 | Cambiar rol / ser supervisor | Parcial | `role` ya es de sólo lectura; `txk_sup_device` es cosmético pero hay que quitarlo | BD + cliente |
| 12 | Reusar la sesión en otro aparato | **Sí, 90 días** 🔴 | tokens que caducan y refrescos revocables | Auth |
| 13 | **Robar el hash del PIN de `localStorage`** | **Sí** 🔴 | dejar de guardarlo; guardar un refresco revocable | Cliente |
| 14 | **Fuerza bruta del PIN a partir del hash** | **Sí** | sal por usuario y derivación de clave, o que el hash deje de estar al alcance | BD + cliente |
| 15 | Una cuenta ajena en `auth.users` se vuelve `authenticated` | Sí, en cuanto se autentique | cerrar el registro público; revisar la cuenta existente | Auth |

Las cinco marcadas 🔴 son las que conviene atacar primero, y **cuatro de las
cinco no necesitan autenticación ninguna**.

---

## 15 · Plan de implementación

Adaptado a lo que hay. Cada fase se puede parar y quedarse ahí sin dejar la
aplicación a medias.

---

**2.5A · Cerrar lo que no depende de autenticación** — *empezar por aquí*

- **Toca**: sólo la base de datos (grants y políticas). **Ni una línea de cliente.**
- **Qué**: revocar UPDATE y DELETE en `scores`; revocar DELETE en `employees`;
  revocar UPDATE de `employees.name`; revisar y eliminar la cuenta desconocida
  de `auth.users` y cerrar el registro público; quitar de la API las dos
  funciones de trigger; dar política propia a `duels` y `chat_messages`.
- **Riesgo**: bajo. La aplicación **no** modifica ni borra en esas tablas.
- **Pruebas**: las de la fase 17 §A — que el borrado y la modificación fallen de
  verdad, con el rol `anon`.
- **Vuelta atrás**: volver a conceder los permisos. Un `grant`.
- **Depende de**: nada. **Se puede hacer hoy.**

---

**2.5B · La identidad existe (sin exigirla todavía)**

- **Toca**: `employees` (+`auth_user_id`), tabla nueva de contraseñas de
  servicio (cerrada), Edge Function `sesion`, trabajo de alta de las 22 cuentas.
- **Riesgo**: bajo. Nada la usa aún.
- **Pruebas**: el canje devuelve sesión con el PIN bueno y no con el malo; el
  limitador sigue mordiendo; las 22 fichas quedan vinculadas.
- **Vuelta atrás**: borrar la columna y las cuentas. El cliente no se entera.
- **Depende de**: 2.5A (el registro cerrado).

---

**2.5C · El cliente obtiene y usa la sesión**

- **Toca**: `index.html` (entrada, salida, cabeceras de cada petición),
  `localStorage`.
- **Qué**: al validar el PIN, canjear por sesión; mandar `Authorization: Bearer
  <access_token>`; refrescar. **Las políticas siguen permisivas**: si algo falla,
  sigue funcionando.
- **Riesgo**: medio — es la primera fase que toca el camino de entrada.
- **Pruebas**: entrar, salir, recargar, sesión caducada, sin red, aparato
  compartido.
- **Vuelta atrás**: volver a mandar la clave anon. Un cambio de cabecera.
- **Depende de**: 2.5B.

---

**2.5D · `actividad` con identidad de servidor**

- **Toca**: políticas de `actividad`, trigger de sellado, `registrarActividad()`,
  `+client_id`.
- **Riesgo**: medio. `actividad` tiene **0 filas**: es el mejor momento posible
  para hacerlo, y por eso va antes que `employees` y `scores`.
- **Pruebas**: las negativas de §17 B, ejecutadas contra la base.
- **Vuelta atrás**: volver a las políticas de hoy.
- **Depende de**: 2.5C.

---

**2.5E · `employees` y `scores` con identidad de servidor**

- **Riesgo**: **alto** — aquí están el ranking, el XP y el panel actual.
- **Pruebas**: además de las negativas, que el ranking y el panel del supervisor
  **sigan viendo lo mismo que antes**, con datos reales.
- **Vuelta atrás**: volver a `allow_all`.
- **Depende de**: 2.5D probado en uso real unos días.

---

**2.5F · Offline con identidad**

- **Toca**: cola por empleado, `client_id`, purga al salir, cajones separados.
- **Riesgo**: medio-alto: aquí es donde se pierde trabajo si se hace mal.
- **Pruebas**: §17 D, con la red cortada de verdad en el navegador.
- **Depende de**: 2.5D.

---

**2.5G · El supervisor por rol; el PIN, segundo factor**

- **Riesgo**: medio. Requiere asignar roles **antes**, o alguien se queda fuera
  de su propio panel.
- **Depende de**: 2.5E. Es también la puerta de la Fase 4.

---

**2.5H · Retirar el modelo antiguo**

- Revocar a `anon` lo que quede, quitar el auto-login local, y `txoko_session`.
- **Depende de**: todo lo anterior, en uso y sin incidencias.

---

## 16 · Compatibilidad

| Qué | Impacto | Por qué |
|---|---|---|
| **Hoy (Fase 2)** | **ninguno** | el plan es local; no hace ni una petición |
| **SRS** | **ninguno** | vive sólo en el navegador |
| **Offline** | cambia, y a mejor | hoy la actividad sin red **se pierde**; con la cola, no |
| **PWA** | ninguno | el token no afecta al *service worker*; **no cachear respuestas con `Authorization`** |
| **`scores`** | se conserva | sólo pierde UPDATE y DELETE, que nadie usa |
| **`actividad`** | cambia el origen de 2 campos | 0 filas: el mejor momento |
| **XP y niveles** | ninguno | local + `employees.xp`, que sigue siendo escribible por su dueño |
| **Rankings** | depende de la política de lectura | hay que decidir: fichas completas del restaurante o vista agregada (§21) |
| **PIN supervisor** | se mantiene, cambia de papel | de credencial a segundo factor |
| **Contenido por restaurante** | ninguno | son ficheros estáticos, no van por RLS |
| **Aislamiento actual** | mejora | pasa de ser una convención a una regla |
| **Las 354 pruebas** | ninguna debería romperse | ninguna toca la red; la mayoría son de contenido y de lógica pura |

Sobre lo último, con precisión: las pruebas de la suite **no hacen peticiones
reales**; las que tocan `registrarActividad` la ejecutan con `fetch` inyectado.
Cambiar el cuerpo de la petición **sí** obligará a actualizar esa prueba —
concretamente la que comprueba `employee`, `venue` y `Prefer` en el cuerpo. Es
una actualización esperada, no una rotura.

---

## 17 · Plan de pruebas

**Ninguna prueba que sólo busque texto en un fichero cuenta.** Las de RLS se
ejecutan contra la base de datos suplantando la sesión, que es como se
comprueban de verdad:

```sql
set local role authenticated;
set local request.jwt.claims = '{"sub":"<uuid de Ana>"}';
-- …y a partir de aquí, la base se comporta exactamente como con Ana dentro.
```

### A · Antes de tocar nada (2.5A)

1. `anon` intenta borrar un empleado → **debe fallar**.
2. `anon` intenta modificar una fila de `scores` → **debe fallar**.
3. `anon` intenta borrar una fila de `scores` → **debe fallar**.
4. `anon` intenta renombrar un empleado → **debe fallar**.
5. La aplicación sigue escribiendo progreso y puntuaciones con normalidad.

### B · Aislamiento (2.5D–E) — las negativas que pidió el encargo

6. Ana lee la ficha de Luis (otro restaurante) → **0 filas**.
7. Ana lee actividad de otro restaurante → **0 filas**.
8. Ana inserta actividad con `employee = 'Luis'` → **se escribe como Ana**
   (trigger) o se rechaza (`WITH CHECK`). Las dos valen; hay que fijar cuál.
9. Ana inserta actividad con `venue = 'mb'` → **se escribe en el suyo**.
10. Ana modifica una actividad ya escrita → **denegado**.
11. Ana borra una actividad → **denegado**.
12. Ana se pone `role = 'owner'` → **denegado**.
13. Ana se cambia el `venue` → **denegado**.
14. Un supervisor de A lista la plantilla de B → **0 filas**.
15. Un supervisor de A lee actividad de B → **0 filas**.
16. Sin sesión (`auth.uid()` nulo) se intenta insertar → **denegado**.

### C · Que el cliente no mande (2.5C–D), en navegador real

17. Cambiar `currentUser` en la consola y registrar → la fila llega **con el
    nombre de la sesión**, no con el inventado.
18. Cambiar `localStorage.txk_venue` y registrar → la fila llega **con el
    restaurante del empleado**.
19. Borrar `txoko_session` a mano → pide PIN; no entra solo.
20. Manipular el token → el servidor lo rechaza.

### D · Offline (2.5F), con la red cortada de verdad

21. Sin red: completar una actividad → queda en la cola, marcada como hecha en
    el plan de Hoy.
22. Volver la red → se envía **una sola fila**.
23. Reintentar cinco veces el mismo evento → **una sola fila** (`client_id`).
24. Editar la cola a mano poniendo otro empleado → **se escribe a nombre del de
    la sesión**.
25. Ana deja cola pendiente, entra Luis, vuelve la red → **no se manda nada de
    Ana**; se manda cuando vuelve Ana.
26. La sesión caduca sin red → se sigue entrenando; al volver, se refresca y se
    vacía la cola.

### E · Aparato compartido (2.5C, 2.5F)

27. Ana entra, trabaja, sale; Luis entra → Luis **no ve** progreso, SRS ni plan
    de Ana, ni desde la interfaz ni desde `localStorage`.
28. Tras salir Ana, no queda en el aparato **ningún valor que sirva para
    autenticarse como ella**.
29. Ana vuelve a entrar en el mismo aparato → recupera lo suyo.

### F · Migración (2.5B)

30. Las 22 fichas quedan vinculadas, sin duplicados.
31. Las 18 con PIN entran **con el PIN de siempre**, sin notar nada.
32. Las 4 sin PIN lo fijan en su primera entrada.
33. El limitador de PIN sigue mordiendo tras la migración.
34. Ninguna fila de `scores` ni de `employees` pierde el vínculo con su persona.

### G · Regresión

35. Las 354 pruebas, verdes (con la del cuerpo de `actividad` actualizada).
36. Auditoría de alérgenos 0/0.
37. El panel del supervisor enseña **lo mismo** que antes, con datos reales.
38. El ranking enseña lo mismo.
39. Hoy, SRS y XP, sin cambios.

Y como en las fases anteriores: **cada guarda se verifica rompiendo a propósito
lo que protege**. Una política que no se ha visto denegar nada no está probada.

---

## 18 · Riesgos

**Del diseño**

- **`employees` tiene como clave primaria el nombre.** Es el riesgo estructural
  de fondo: `actividad.employee` y `scores.employee` son texto sin clave ajena.
  Mientras no haya un `id` estable, un renombrado parte el histórico. La
  propuesta añade `auth_user_id` **sin** cambiar la clave primaria, para no
  reescribir 33 000 líneas; es un compromiso consciente, no una solución.
- **La nota la sigue diciendo el cliente.** La autenticación arregla *quién*,
  no *cuánto*. Si en la Fase 4 se evalúa formalmente con esos números, hay que
  saberlo.
- **Roles hoy: 0 supervisores.** Si el panel pasa a depender del rol sin
  asignarlos antes, el propietario se queda fuera de su propio panel.

**De la ejecución**

- 2.5E toca a la vez ranking, XP y panel: es la fase con más superficie.
- Un error en la cola offline **pierde trabajo de una persona**, que es lo peor
  que puede pasar en esta aplicación.
- El limitador del PIN es por nombre: si el canje por sesión lo saltara, se
  abriría un oráculo de fuerza bruta. Debe seguir pasando **siempre** por
  `verify_employee_pin_sha`.

**Que se quedan fuera del alcance**

- El PIN de Txoko `837083` sigue sin cambiar.
- Sal global en el hash del PIN: se arregla de raíz al dejar de exponerlo, pero
  la sal por usuario sigue siendo lo correcto.
- Y lo de antes: 16 `confirm()` del navegador, contraste sin medir, controles de
  cabecera por debajo de 400 px, error de 430 px no reproducido.

---

## 19 · Decisiones que necesitan aprobación antes de implementar

Ninguna es técnica: todas son del propietario.

1. **¿Se cierra 2.5A ya?** Revocar borrado y modificación en `scores` y
   `employees` no toca el cliente, no rompe nada y quita cuatro de las cinco
   amenazas rojas. **Mi recomendación es hacerlo ya.**
2. **La cuenta desconocida de `auth.users`** — ¿se elimina y se cierra el
   registro público? Hoy es inofensiva; en cuanto haya autenticación, deja de
   serlo.
3. **Modelo de autenticación**: ¿se aprueba la **alternativa B** (canje del PIN
   por sesión mediante Edge Function)?
4. **Ranking**: ¿los compañeros del restaurante siguen viéndose la ficha
   completa, o sólo una vista con nombre, XP y nivel?
5. **Aparato compartido**: ¿sesión larga y cómoda (como hoy, 90 días) o modo
   quiosco con cierre por inactividad en los aparatos comunes? Se puede decidir
   por aparato.
6. **Al salir con trabajo sin enviar**: ¿se conserva hasta que vuelva esa
   persona (mi recomendación) o se descarta?
7. **Identidad ajena en la inserción**: ¿se **ignora** en silencio (trigger) o
   se **rechaza** con error? Recomiendo ignorar: no rompe clientes antiguos.
8. **Primer supervisor**: ¿a quién se le asigna `owner` antes de 2.5G?
9. **Bajas**: se propone baja lógica, nunca borrado. ¿Se acepta?
10. **Orden**: ¿2.5A ahora y el resto después de revisar la Fase 2 en uso real,
    o todo seguido?

---

## 20 · Lo que NO se ha hecho en esta fase

No se ha modificado `index.html`, `styles.css`, `sw.js`, ninguna tabla, ninguna
política, ninguna función, ninguna migración, ni la autenticación, ni el
`localStorage`, ni el *service worker*, ni el SRS, ni la actividad, ni los
marcadores, ni la navegación, ni la interfaz.

Lo único escrito es este documento.

Las comprobaciones de permisos se hicieron con filtros que no podían casar con
ninguna fila real, dentro de bloques que terminan siempre en error para que la
transacción se deshaga. Ninguna dejó rastro.
