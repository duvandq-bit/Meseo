# Auditoría adversarial del diseño de la FASE B

**No se ha modificado ningún archivo de la aplicación, no se ha ejecutado SQL de
escritura, no se ha desplegado nada.** Las mediciones son lectura y navegador
local; la mutación de la línea 3160 se hizo sobre una copia y se restauró
(verificado: `index.html` idéntico).

Auditoría del código real, no del documento. Referencias a `index.html` de
`main` en v7.451.

---

## 0 · Lo que cambia el cuadro antes de entrar en los diez puntos

### C1 · CRÍTICO — la aplicación sincroniza en bucle cada 1,5 segundos

**Medido**, no deducido. Chromium, sesión iniciada, **app en reposo y nadie
tocando nada**:

```
peticiones a /rest/v1/employees en 45 s de reposo: 60
   por método: {"GET":30,"POST":30}
   intervalos (ms): 1502, 1500, 1500, 1501, 1501, 1501, …
```

Un GET + un POST **cada 1,5 s exactos** — el mismo intervalo que el retardo de
`saveDB()`.

**La causa, aislada por mutación.** `index.html:3160`, dentro de
`supaUpsertEmployee`, después de fusionar la nube en local:

```js
if(avatar) emp.avatar=avatar; if(lastStudy) emp.lastStudyDay=lastStudy;
try{ saveDB(); }catch(e){}          // ← línea 3160
```

`saveDB()` programa `_saveDBNow()` a 1,5 s, y `_saveDBNow()` (línea 4667) vuelve
a llamar a `supaUpsertEmployee`, que vuelve a fusionar, que vuelve a llamar a
`saveDB()`. **Retirando esa única línea: 60 → 0 peticiones en 45 s de reposo.**

Consecuencias, por orden de gravedad:

1. **Bajo RLS, el camino de pérdida silenciosa se dispara ~2 400 veces por hora
   y pestaña abierta**, no «de vez en cuando». Cualquier ventana de
   vulnerabilidad de la fase B se multiplica por ese factor.
2. Explica el acumulado: **203 299 de las 228 169 llamadas `anon` son a
   `employees`**. No es uso; es el bucle.
3. Datos y batería del móvil del personal durante el servicio.

**Esto no está en `docs/fase-b-cola-offline.md`.** Y condiciona toda la fase B:
diseñar una cola cuidadosa mientras el motor que la vacía corre en bucle es
arreglar la puerta de una casa sin paredes.

### C2 · CRÍTICO — sellar la cola arregla 1 de 18 caminos de escritura

`supaUpsertEmployee` se llama desde **18 sitios**. **Sólo uno pasa por la cola**
(`_saveDBNow`, línea 4667). Los otros diecisiete son llamadas directas, sin cola
y sin diagnóstico:

```
3195, 3201   auto-reintentos internos (setTimeout, 3 s)
3233         _outboxFlush            ← el único de la cola
4667         _saveDBNow              ← el que ENCOLA
8905         servicio fantasma       9204  reto del día
9983, 10093, 11224   tres caminos de login
11360, 11457, 23840, 27794   varios
24151        reset de PIN  (OTRO empleado)
26967        trofeo de temporada (OTRO empleado)
32729        respaldo de _beaconSync
32759        txokoDiag (consola)
```

El diseño del documento sella `_outboxAdd` con el `uid`. **Eso no toca los otros
diecisiete**, que seguirán saliendo con el token de quien esté dentro en ese
momento. Bajo RLS todos ellos devolverán «cero filas» y, con
`Prefer: return=minimal`, **se leerán como éxito**.

### C3 · CRÍTICO — dos escrituras a la ficha de OTRA persona

```js
// index.html:26961-26968
async function supaAwardSeasonTrophy(winner) {
  const emp = getEmp(winner);
  emp.trophies = (emp.trophies || 0) + 1;
  saveDB();
  await supaUpsertEmployee(winner);      // ← winner puede no ser quien está dentro
}
```

```js
// index.html:24145-24151 — reset de PIN desde el panel de supervisor
delete emp.pin;
saveDB();
supaUpsertEmployee(name);                // ← name es OTRO empleado
```

Las dos **se rompen con la política `auth_user_id = auth.uid()`**, y las dos
fallarán en silencio.

**Y las dos ya están rotas hoy, por otro motivo.** El payload del upsert
(líneas 3167-3184) no incluye `trophies` **ni** `pin`, y `_extrasCompose` tampoco.
Es decir:

- `supaAwardSeasonTrophy` **nunca ha subido un trofeo a la nube**. Sólo escribe
  local.
- El reset de PIN **nunca ha llegado a otros dispositivos**, pese a que el
  comentario del código dice literalmente *«Push to Supabase so the reset reaches
  other devices on their next sync»*.

Son dos defectos anteriores a RLS que la auditoría destapa de paso.

---

## 1 · Identidad: la garantía Ana → Bruno

**Con el diseño del documento tal cual está escrito, la garantía NO se sostiene.**
No por lo que el diseño dice, sino por lo que no cubre.

| Requisito | ¿Se cumple? | Por qué |
|---|---|---|
| sigue perteneciendo a Ana | **parcial** | la entrada de la cola sí; pero el progreso de Ana también se escribe por otros 17 caminos que no llevan sello |
| no se intenta con el token de Bruno | **NO** | `_saveDBNow` (4667) encola **y además llama directamente**. Y el bucle C1 lo repite cada 1,5 s |
| no se reasigna | **sí** | el servidor decide, no el cliente |
| no se elimina en silencio | **NO** | `Prefer: return=minimal` → 200 con cero filas → `return true` → `_outboxRemove` |
| puede volver a sincronizarse | **sí**, si no se desencoló antes | |
| queda diagnosticado | **NO** | no hay estado «permanente» ni cuarentena hoy |

### Caminos alternativos que rompen la garantía

**A1 · El auto-reintento se lleva el nombre, no la identidad.**
Líneas 3195 y 3201: `setTimeout(() => supaUpsertEmployee(name, retries-1), 3000)`.
Ese temporizador sobrevive al logout. Si Ana falla al sincronizar y sale, **tres
segundos después la app reintenta con el nombre de Ana y el token de quien haya
entrado**. La cola no interviene: es una llamada directa.

**A2 · `_beaconSync` no consulta la cola.** Línea 32694, disparado en
`visibilitychange→hidden` (32683) y `beforeunload` (32690), con
`if(currentUser)`. Si el temporizador de 120 s no ha corrido y Bruno cierra la
pestaña, el beacon manda **los datos de Bruno**, correctamente — pero el respaldo
de su `catch` (32729) llama a `supaUpsertEmployee(name)`, otra vez sin sello.

**A3 · El bucle C1 no espera al `visibilitychange`.** Ana sale, Bruno entra, y
1,5 s después ya hay un POST en vuelo. La ventana de carrera no es de dos
minutos: es de segundo y medio.

**A4 · `_ficha` es insensible a mayúsculas pero NO a tildes** (líneas
4676-4686):

```js
if(d[nombre]) return d[nombre];
const k = String(nombre).toLowerCase();
for(const n in d) if(n.toLowerCase() === k) return d[n];
```

La cola guarda `currentUser` **literal**; `DB.employees` puede tener la clave con
otra caja. `_outboxRemove(name)` borra por coincidencia **exacta**. Resultado:
una entrada encolada como `"duvan"` nunca se desencola si la ficha está como
`"Duvan"` — **entrada inmortal que se reintenta para siempre**.

---

## 2 · Dispositivo compartido: ataques concretos

| Ataque | Resultado hoy | Bajo RLS con el diseño propuesto |
|---|---|---|
| **logout/login rápido** | el POST en vuelo de Ana se completa con el token de Bruno (C1: hay uno cada 1,5 s) | **cero filas leídas como éxito**; la cola de Ana se desencola |
| **dos pestañas** | `_outboxFlushing` es **por pestaña**: dos vaciados simultáneos. `localStorage` no tiene bloqueo | duplicados absorbidos por la fusión monótona; pero las dos pueden desencolar tras cero filas |
| **dos sesiones** | `_authToken` es **una sola variable**: la última sesión gana en toda la pestaña | igual |
| **renovación de token** | cubierta por `onAuthStateChange` (fase A) | correcto |
| **token caducado** | `_bearer()` **cae a la clave anónima** y la escritura funciona igual | tras la fase D, 401 → debe ser *reintentable*, no permanente |
| **sesión revocada** | idéntico al anterior; el cliente no lo distingue | necesita distinguir 401 de 403 |
| **cierre inesperado** | `beforeunload` puede no dispararse en iOS; queda la cola | correcto |
| **service worker** | **no** participa: no hay Background Sync. Nada sincroniza con la app cerrada | correcto, y conviene no cambiarlo en B |
| **localStorage** | `_outboxLoad` devuelve `Set` vacío ante JSON corrupto: **la cola se pierde sin aviso** | sigue igual si no se arregla |
| **IndexedDB** | sólo telemetría local, no participa | — |
| **memoria** | `_authUid`, `_authToken`, `currentUser` y `DB` son **cuatro fuentes** que pueden discrepar | el diseño usa `_authUid`: correcto, pero ver carreras |
| **días sin conexión** | la cola no crece (conjunto por nombre) | correcto |

### Las carreras, nombradas

**R1 · `_authUid` se pone a null ANTES de que terminen las peticiones en vuelo.**
`_authSesionSalir` limpia `_authToken` y `_authUid` de inmediato, pero un `fetch`
ya lanzado lleva el token viejo en su cabecera. Una escritura de Ana puede
**completarse después** de que Ana haya salido. Es correcto (es suya), pero el
`.then` que la evalúa correrá con `_authUid` = Bruno o null. **El diseño no dice
qué hacer ahí**: hay que capturar el `uid` al lanzar y compararlo al resolver, no
leer la variable global en el callback.

**R2 · `_saveDBNow` captura `const _u = currentUser` (4668) pero el `_outboxAdd`
de la línea anterior usa `currentUser` sin capturar.** Entre las dos líneas no
hay `await`, así que hoy no puede divergir — pero es frágil y el diseño va a
meter un `await` ahí.

**R3 · Tres relojes independientes**: el bucle de 1,5 s, el vaciado de 120 s y el
auto-reintento de 3 s. Ninguno se coordina con el cambio de sesión.

---

## 3 · Estado frente a eventos: la clasificación es correcta a grandes rasgos y falla en tres campos

La separación `employees` = estado convergente / `scores` y `actividad` =
eventos **es correcta y es la mejor decisión del documento**. Pero dentro de
`employees` hay tres campos que **no** son estado convergente:

**E1 · `sessions_data` es un registro de eventos disfrazado de estado.**
Es un array de sesiones de estudio, **truncado a las últimas 20** (línea 3183:
`sess.slice(-20)`), y la fusión es:

```js
if(cs.length > sess.length) sess = cs.slice(-20);   // línea 3149
```

Gana **el array más largo**, no la unión. Dos dispositivos con sesiones distintas
**pierden las del más corto**, de forma permanente e irreversible. Es pérdida de
datos real, hoy, sin RLS de por medio.

**E2 · `extras.dq` (reto del día) es «gana el más reciente», no monótono.**
`_extrasMergeInto`: `if(x.dq.d > local)` hereda el estado de la nube entero. Dos
dispositivos el mismo día: el último en escribir manda. Racha de retos
sobrescribible.

**E3 · `trophies` y `pin` no están en ningún payload.** Son estado local puro
aunque el código actúa como si se sincronizaran (C3).

**Implicación para la fase B:** sellar la identidad no arregla E1 ni E2. Y si se
activa RLS sin tocarlos, E1 seguirá perdiendo sesiones — con la diferencia de que
entonces se le echará la culpa a RLS.

---

## 4 · Idempotencia: `event_id` + UNIQUE es necesario pero está incompleto

| Ataque | ¿Lo para `event_id` + UNIQUE? | Qué falta |
|---|---|---|
| envío duplicado | **sí** | — |
| timeout tras aceptación | **sí** | — |
| retry | **sí** | — |
| doble pestaña | **sí** | — |
| `_beaconSync` | **sí**, si reutiliza el mismo `event_id` | hoy el beacon no maneja eventos |
| recarga | **sí**, el id vive en `localStorage` | — |
| dos dispositivos | **sí** si el evento se creó una vez; **no** si cada dispositivo genera el suyo para el mismo hecho | el `event_id` debe nacer con el hecho, no con el envío |
| **mismo `event_id` con datos distintos** | **NO** | `ignore-duplicates` acepta el primero y **descarta el segundo en silencio**. Un cliente con un fallo que reutilice ids pierde datos sin enterarse |
| atacante cambia `employee` | **no es cosa del id** | `with check (employee = app.mi_nombre())` |
| atacante cambia `venue` | **no es cosa del id** | `DEFAULT app.mi_venue()` **y quitar el campo del cuerpo** |
| **atacante reutiliza un `event_id` ajeno válido** | **NO, y es un ataque real** | ver abajo |

### El ataque del `event_id` reutilizado

Un `UNIQUE` global sobre `event_id` convierte el identificador en **un recurso
compartido entre empleados**. Ana observa (o adivina) el `event_id` de Bruno y lo
reenvía con sus propios datos: si Bruno aún no lo ha enviado, **Ana quema el id y
el evento real de Bruno se descartará como duplicado**. Denegación de servicio
por adelantado.

**Corrección**: el `UNIQUE` debe ser **por identidad**, no global:

```sql
-- SIN EJECUTAR
create unique index … on public.actividad (employee, evento_id) where evento_id is not null;
```

Con `employee` puesto por el `DEFAULT` del servidor, Ana no puede tocar el
espacio de ids de Bruno. Un UUIDv4 hace la colisión accidental despreciable; lo
que se cierra es la colisión **deliberada**.

### Reparto exacto de responsabilidades

**El cliente garantiza:** generar el `event_id` **cuando ocurre el hecho** (no al
enviar), conservarlo entre reintentos, recargas y cierres, y **no reutilizarlo
jamás** para un hecho distinto.

**El servidor garantiza:** que `employee` y `venue` los pone él (`DEFAULT`), que
el `UNIQUE` es por identidad, y que un duplicado se distingue de un rechazo por
autorización — 409/`23505` frente a 42501. **Son respuestas distintas y el
cliente debe tratarlas distinto**: la primera desencola, la segunda va a
cuarentena.

---

## 5 · Adopción por nombre: insegura, y hay pruebas en los propios datos

La propuesta de adoptar entradas heredadas «sólo si el nombre coincide» parece
prudente. **No lo es en este conjunto de datos concreto.** Los 4 nombres
huérfanos de `scores` son:

```
Alessandra | Ana Kurzweil | Estefanía | Faride
```

Y en `employees` hoy están: **`Aless`**, **`Estefania`** (sin tilde) y **`Faride
Navarro`**.

| Huérfano | Empleado actual | Qué demuestra |
|---|---|---|
| `Estefanía` | `Estefania` | **la tilde ya cambió una vez**; una adopción exacta la retiene mal, una laxa la adopta bien |
| `Faride` | `Faride Navarro` | **el nombre se alargó**; una comparación por prefijo la adoptaría, y por prefijo también casaría con cualquier otra Faride |
| `Alessandra` | `Aless` | **el nombre se acortó**; no casa ni exacto ni por prefijo |
| `Ana Kurzweil` | — | persona que ya no está |

Es decir: **en Meseo los nombres han derivado, y han derivado en las tres
direcciones** que rompen cualquier comparación textual. Y `_ficha` ya trata
`Estefanía` y `Estefania` como personas distintas mientras que `duvan` y `Duvan`
son la misma. Esa asimetría es exactamente el terreno de los falsos positivos.

Añádase que un solo iPad de barra puede haber tenido dentro a diez personas.

### Alternativa concreta

**No adoptar por nombre. Adoptar por prueba de posesión de la ficha local.**

Cuando alguien inicia sesión, la aplicación **ya tiene** en `DB.employees[nombre]`
el hash del PIN de esa persona (`emp.pin`, usado por el auto-login, línea 33167).
El login acaba de validar ese mismo hash contra el servidor.

Regla propuesta: una entrada heredada (`uid:null`) se adopta si, y sólo si,
**`DB.employees[entrada.nombre].pin` es exactamente el hash que acaba de validar
el login**. Es decir: adoptas lo tuyo porque puedes demostrar que la ficha local
a la que apunta la entrada es tuya, no porque el texto del nombre se parezca.

- `Estefanía` vs `Estefania`: si en ese dispositivo la ficha es la suya y el hash
  casa, se adopta correctamente pese a la tilde.
- Dos empleados en el mismo iPad: cada uno adopta sólo las entradas cuya ficha
  local lleva **su** hash.
- Nombre cambiado en el servidor: sigue funcionando, porque no se compara texto.

**Y si el hash no casa, la entrada NO se adopta: va a cuarentena.** Que es tu
criterio —retener antes que reasignar— aplicado con una prueba en vez de con una
heurística.

---

## 6 · `scores` y `actividad`: `event_id` + UNIQUE no basta

**Compatibilidad con lo existente: correcta.** El índice parcial
(`where evento_id is not null`) deja intactas las 427 filas y las 5 actividades,
y los 58 huérfanos no estorban. Confirmado: `NULL` no colisiona consigo mismo.

**Lo que el documento no cubre:**

1. **Las tres escrituras de `scores` usan `Prefer: return=minimal`** (líneas 2835,
   2885, 2944) y **ninguna comprueba el resultado**. Bajo RLS, cualquiera de las
   tres devuelve 201 sin cuerpo tanto si insertó como si la política la rechazó.
   Es el mismo fallo que en `employees` y **afecta a las tres**.
2. **Las tres mandan `employee` desde el cliente** y `venue` vía `_vSello()`.
   Bajo la política propuesta, el `employee` debe dejar de viajar. Si no,
   `with check` rechaza y se pierde en silencio.
3. **`registrarActividad` no tiene reintento** pese a que su `catch` promete uno
   (línea 2408). Quince puntos de llamada, cero reintentos. **Es pérdida de datos
   de hoy**, no de RLS.
4. **Escritura parcial**: el examen de la línea 2835 escribe en `scores` **y**
   marca progreso en `employees` por separado. No hay transacción. Si la primera
   entra y la segunda no, el histórico y el perfil discrepan **y nadie se entera**.
   Esto no lo arregla `event_id`.

### Escenarios buscados, encontrados

| Escenario | ¿Existe? | Dónde |
|---|---|---|
| pérdida silenciosa | **sí**, cuatro veces | `employees` (minimal), 3× `scores` (minimal), `actividad` (sin reintento) |
| duplicación | **no hoy** (no hay cola); **sí en cuanto se cree** sin `event_id` | — |
| evento parcialmente escrito | **sí** | examen: `scores` + `employees` sin transacción |
| aceptado pero el cliente cree que falló | **sí** | `registrarActividad`: un timeout tras aceptación devuelve `false` y el evento **no se reintenta**, así que no duplica — pero tampoco informa |

---

## 7 · `return=representation` no hace falta

Lo que el cliente necesita saber, mirando el código que evalúa las respuestas
(3193-3203 en `employees`, y nada en `scores`):

| Necesita saber | Señal mínima suficiente |
|---|---|
| insertado / actualizado | **número de filas afectadas** |
| ya existía | 0 filas **con** `resolution=ignore-duplicates`, o 409/`23505` sin ella |
| rechazado por autorización | **HTTP 401/403** o `42501` |
| reintentable | 5xx, `TypeError` de red, timeout |
| permanente | 4xx que no sea 409 |

**No hace falta el cuerpo de la fila en ningún caso.** El cliente ya tiene los
datos que envió; lo único que le falta es *cuántas filas tocó*.

**Propuesta: `Prefer: return=headers-only,count=exact`** y leer la cabecera
`Content-Range`. Coste: unas decenas de bytes por petición, frente a los varios KB
de la fila entera con `sessions_data` y `known_dishes` dentro — y con el bucle C1
sin arreglar serían **varios KB cada segundo y medio**.

**Supuesto que hay que verificar antes de comprometerse:** que la versión de
PostgREST desplegada respeta `return=headers-only` **en un upsert con
`merge-duplicates`** y rellena `Content-Range`. Es un experimento de cinco
minutos contra producción, de sólo lectura si se hace con un `select`. **No doy
por hecho que funcione.**

---

## 8 · `_beaconSync`: el riesgo es real, pero más estrecho de lo que parecía

`_beaconSync` (32694-32731) manda **valores locales en crudo**, sin fusión
monótona, con `resolution=merge-duplicates` — es decir, **sobrescribe** `xp`,
`streak`, `txoko_record`, `duel_wins`, `sessions_count`.

**El atenuante que el documento no vio:** `supaUpsertEmployee` **sí escribe la
fusión de vuelta en local** (líneas 3156-3161), así que tras una sincronización
correcta la copia local ya no está atrasada y el beacon manda valores buenos.

**Las ventanas en las que el riesgo es real:**

1. **Dispositivo que nunca completó una sincronización** (entró sin cobertura y
   se cerró): manda su XP local, más bajo, y **lo sobrescribe**.
2. **Carrera entre `_flushSaveDB()` y el beacon.** Los disparadores hacen las dos
   cosas seguidas (32683, 32690): `_flushSaveDB()` lanza el upsert monótono
   asíncrono y **acto seguido** sale el beacon con `keepalive`. **No hay orden
   garantizado.** Si el beacon llega después, deshace la fusión.
3. **Cuenta de administración**: `supaUpsertEmployee` sale por `_esAdmin` (3112)
   **pero `_beaconSync` no comprueba nada**, así que el admin sí escribe por el
   beacon. Contradice la regla de «el administrador no deja rastro».

**Corrección mínima propuesta (no implementada):** que `_beaconSync` no mande
valores absolutos. Dos formas, de menos a más trabajo:

- **(a)** Que compruebe `_esAdmin` y que sólo mande los campos que no pueden
  retroceder (`last_active_at`, `avatar`) — los contadores los deja para la cola.
- **(b)** Que encole y deje que el vaciado normal lo haga. Pierde el «último
  segundo», que es justo lo que el beacon existe para salvar.

**¿En B1?** **Sí, la (a).** Es pequeña, y sin ella la fase B introduce un camino
que sobrescribe con el token correcto — pasa RLS y corrompe igual. Es peor que un
rechazo.

**Cómo evitar regresión y cómo probarlo:** sembrar dos «dispositivos» con XP
distinto, cerrar el atrasado, y afirmar que la nube no baja. Con la corrección
(a) la prueba pasa; sin ella, cae. Es una mutación limpia.

---

## 9 · Clasificación: qué bloquea RLS y qué no

**A — imprescindible antes de activar ninguna política**

| | Por qué |
|---|---|
| **A1 · Romper el bucle de 1,5 s (C1)** | multiplica por ~2 400/hora cualquier fallo de la fase B |
| **A2 · Dejar de leer «cero filas» como éxito** (`headers-only,count=exact`) en `employees` **y en las 3 de `scores`** | sin esto, activar políticas **destruye datos en silencio** |
| **A3 · Un único punto de entrada de sincronización** por el que pasen los 18 caminos | sellar la cola no sirve si hay 17 puertas sin sellar |
| **A4 · Sello de `uid` + saltar lo ajeno + cuarentena** | el requisito Ana/Bruno |
| **A5 · Neutralizar las 2 escrituras a fichas ajenas (C3)** | hoy ya no funcionan; bajo RLS fallarán ruidosamente |
| **A6 · Capturar el `uid` al lanzar y compararlo al resolver (R1)** | si no, el `.then` juzga con la identidad equivocada |
| **A7 · `_beaconSync` sin valores absolutos (8a)** | escribe con token válido: RLS no lo para |

**B — recomendable, puede esperar**

- Corrupción de `localStorage` que vacía la cola sin avisar.
- Pantalla de cuarentena (retener sin enseñar es esconder).
- Normalizar la clave de la cola con `_ficha` (A4 de §1).
- `sessions_data` que pierde sesiones (E1) — **no** lo empeora RLS.

**C — funcionalidad nueva, NO debe bloquear RLS**

- **La cola de eventos para `scores` y `actividad`.** Hoy no existe: lo que se
  hace sin cobertura ya se pierde. **RLS no lo empeora.** Crearla es arreglar un
  fallo distinto y puede ir después.
- `evento_id` + `UNIQUE` + `DEFAULT` de servidor: sólo hacen falta cuando exista
  esa cola. **Con una excepción**: quitar `employee` y `venue` del cuerpo de
  `scores`/`actividad` **sí** es A2, porque si no las políticas los rechazan.
- El concepto de «empleado desactivado».

**Esto es lo que impide que la fase B se convierta en una refactorización:** lo
que bloquea RLS son siete arreglos acotados, no una cola de eventos nueva.

---

## 10 · Veredicto técnico

### Problemas críticos

1. **C1 · Bucle de sincronización cada 1,5 s.** Medido (60 peticiones en 45 s de
   reposo) y aislado por mutación (`index.html:3160`, 60 → 0). No estaba en el
   diseño y lo condiciona entero.
2. **C2 · 17 de 18 caminos de escritura no pasan por la cola.** El sello de
   identidad, tal como está diseñado, cubre uno.
3. **C3 · Dos escrituras a la ficha de otro empleado** (24151, 26967), ambas ya
   inoperantes hoy y ambas rotas bajo RLS.
4. **Pérdida silenciosa por `return=minimal`** en `employees` y en las **tres**
   escrituras de `scores`.
5. **Adopción por nombre insegura**, con pruebas en los propios datos
   (`Estefanía`/`Estefania`, `Faride`/`Faride Navarro`, `Alessandra`/`Aless`).
6. **`UNIQUE` global sobre `event_id`** permite quemar el id de otro.

### Problemas importantes

7. `_beaconSync` sobrescribe con valores absolutos y **no respeta `_esAdmin`**.
8. `sessions_data` pierde sesiones al fusionar por longitud (E1).
9. `extras.dq` es «gana el último», no monótono (E2).
10. El auto-reintento de 3 s (3195, 3201) sobrevive al cambio de usuario.
11. `_ficha` insensible a caja pero no a tildes, con `_outboxRemove` exacto:
    entradas que no se desencolan nunca.
12. Examen = dos escrituras sin transacción (`scores` + `employees`).
13. `registrarActividad` promete un reintento que no existe (15 llamadas).

### Supuestos que hay que verificar antes de diseñar sobre ellos

- Que PostgREST respeta `return=headers-only` **y** `Content-Range` en un upsert
  con `merge-duplicates`.
- Que el `venue` del cliente coincide siempre con el de la ficha (la cuenta de
  administración cambia de restaurante: `_venueActual()` puede no ser el suyo).
- Que `beforeunload` dispara en iOS Safari lo bastante como para que el beacon
  importe. Si no, la opción (b) del §8 es gratis.
- Que las 498 llamadas autenticadas de hoy no incluyen ninguna del bucle con
  identidad equivocada (no se puede saber con `pg_stat_statements`).

### Decisiones correctas del diseño

- **Separar estado convergente de eventos.** Es la decisión que ordena todo lo
  demás, y es correcta.
- **No inventar una clave de idempotencia para `employees`**: la fusión monótona
  ya la da. Ponerla habría sido añadir maquinaria para nada.
- **Retener antes que reasignar.** Correcto, y lo mantengo.
- **Que el `uid` de la cola sólo decida si se INTENTA**, y el servidor decida si
  se escribe. Es el reparto correcto.
- **Que el `event_id` nazca con el hecho y no con el envío.**

### Decisiones que cambiaría

- **Adopción por nombre → adopción por prueba de posesión del hash del PIN local**
  (§5).
- **`UNIQUE (evento_id)` → `UNIQUE (employee, evento_id)`** (§4).
- **`return=representation` → `return=headers-only,count=exact`**, previa
  verificación (§7).
- **Sellar la cola → sellar el ÚNICO punto de entrada de sincronización**, y
  hacer que los 18 caminos pasen por él (A3).
- **La cola de eventos sale de la fase B.** Es funcionalidad nueva; que no
  bloquee RLS.

### Tests que faltan en el diseño

- El bucle: «en reposo, cero peticiones en 45 s». Es la prueba de no regresión de
  C1 y hoy fallaría.
- Cada uno de los 18 caminos de escritura, con identidad ajena.
- El auto-reintento de 3 s cruzando un cambio de sesión.
- Dos pestañas vaciando a la vez.
- `_beaconSync` desde un dispositivo atrasado (§8).
- `_beaconSync` con la cuenta de administración.
- Entrada encolada con la caja del nombre distinta a la de la ficha.
- `event_id` de otro empleado reenviado (§4).
- Respuesta de PostgREST con `headers-only` en upsert (supuesto).

### B1 mínima propuesta

Siete cambios, todos en el cliente, **ninguno de esquema**:

1. Romper el bucle (C1) — una línea.
2. Un único `sincronizarFicha(nombre, uidEsperado)` por el que pasen los 18
   caminos.
3. `headers-only,count=exact` y cuatro resultados en vez de un booleano
   (`confirmado` / `nada-que-hacer` / `reintentable` / `permanente`).
4. Cola v2 sellada con `uid`, saltando lo ajeno, desencolando sólo lo confirmado.
5. Cuarentena en vez de borrado, y adopción por hash del PIN.
6. Neutralizar las dos escrituras a fichas ajenas.
7. `_beaconSync` sin valores absolutos y respetando `_esAdmin`.

Y quitar `employee` y `venue` del cuerpo de `scores`/`actividad`, que es una línea
por sitio y evita que las políticas los rechacen.

### B2 separada

- Cola de eventos para `scores` y `actividad`, con `evento_id` nacido con el
  hecho.
- Esquema: `evento_id uuid` + `UNIQUE (employee, evento_id)` parcial + `DEFAULT`
  de servidor.
- Reintento real para `registrarActividad`.
- `sessions_data` que une en vez de elegir el array más largo.
- Pantalla de cuarentena.
