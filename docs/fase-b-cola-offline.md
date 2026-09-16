# FASE B — La cola offline y la identidad de lo que ocurrió sin red

**Diseño y medición. No se ha implementado nada, no se ha ejecutado ningún SQL,
no se ha cambiado ninguna política, permiso, tabla ni dato, y no se ha desplegado
nada.** Producción sigue en v7.451 con las políticas permisivas.

---

## 1 · A.3 — La medición

### Método

`query_logs` quedó pendiente de aprobación y no respondió, así que la medición va
por otra vía de lectura, y creo que mejor: **`pg_stat_statements` registra el rol
con el que se ejecutó cada consulta** (`userid`), y las consultas que entran por
PostgREST llevan la envoltura `pgrst_source`, que las distingue del mantenimiento
por SQL directo.

```sql
select r.rolname, sum(s.calls), count(*), min(s.stats_since)
from pg_stat_statements s join pg_roles r on r.oid = s.userid
where s.query ilike '%pgrst_source%'
group by r.rolname;
```

### Muestra

Dos cosas distintas, y conviene no mezclarlas:

- **Acumulado** desde el 11 de marzo de 2026 (la primera entrada registrada).
- **Ventana viva**: dos fotos, a las **14:16:24** y a las **14:23:51** UTC del 16
  de septiembre.

### Resultado

| Rol | Llamadas acumuladas | Consultas distintas | Primera vez |
|---|---|---|---|
| `anon` | 228 169 | 151 | 11 mar 2026 |
| `service_role` | 2 116 | 26 | 28 mar 2026 |
| **`authenticated`** | **498** | **11** | **16 sep 2026, 13:37:47.930** |

**El dato que importa: el rol `authenticated` no había aparecido NUNCA en este
proyecto hasta hoy a las 13:37:47.** Seis meses de historial y cero. La primera
vez coincide al segundo con el primer inicio de sesión de **Jenfry**
(`last_sign_in_at` 13:37:47.244). Es decir: la primera petición autenticada de la
historia de Meseo la hizo un empleado real entrando desde su móvil.

Reparto de esas 498: `employees` 485, `scores` 5, `verify_supervisor_pin` 5,
`actividad` 3.

**Señal de comportamiento, que es la más sólida que hay.** Desde que la fase A
está viva han escrito tres fichas, y las tres personas **tienen identidad y
sesión viva**:

| Empleado | Escribió | Identidad | Sesión |
|---|---|---|---|
| Jenfry | 13:42:25 | sí | sí (2) |
| Duvan | 14:12:09 | sí | sí (6) |
| Administrador | 14:12:39 | sí | sí (3) |

**Jenfry es una de las 17 identidades del provisioning y no es el propietario.**
Es la prueba de campo que faltaba.

### Lo que esta medición NO puede decir, y no voy a fingir que sí

1. **No puedo dar un porcentaje.** Los contadores de `pg_stat_statements` son
   acumulados y Postgres no guarda la hora de la última llamada de cada entrada,
   así que las peticiones `anon` de hoy son indistinguibles de las de marzo. El
   acumulado (228 169 contra 498) **no** es la proporción actual: es historia.
2. **La ventana viva no dio señal**: los tres contadores salieron idénticos en
   las dos fotos. No es que no llegara nada autenticado — es que **no llegó nada,
   de ningún tipo**. A las 14:20 UTC no había nadie usando la app.
3. **No puedo demostrar la ausencia** de peticiones REST post-login sin
   identidad. Ninguna observada, pero con este método eso no es una prueba.

**Lo que sí puedo afirmar con lo medido:** el camino autenticado funciona en
producción con empleados reales, y las únicas rutas que conservan la clave
anónima a propósito son las 10 llamadas a Edge Functions y las 2 subidas a
Storage — verificado por una prueba que vigila los dos sentidos.

**Cómo cerrarlo bien:** repetir las dos fotos **durante un servicio**
(20:00–22:00 locales) con una hora de separación. Con tráfico real, la resta da
la proporción exacta. Es lectura pura y puedo hacerlo cuando digas.

---

## 2 · Estado actual de la cola

Los veinte puntos, uno a uno.

**1 · Dónde se almacena.** `localStorage`, clave `txk_sync_outbox`. Nada más. No
hay IndexedDB para esto (la IndexedDB `txk_telemetry` es telemetría local que
nunca sale del dispositivo) y el service worker **no** usa Background Sync.

**2 · Estructura exacta.** Un array JSON de **cadenas**:

```
txk_sync_outbox  →  ["Duvan","Sol"]
```

En memoria, un `Set<string>`. **No hay eventos.** Es una lista de «fichas con
cambios sin confirmar». El dato vive aparte, en `txoko_data_v4 → DB.employees[nombre]`.

**3 · Cómo se crea.** Un único sitio, `_saveDBNow()` (`index.html:4633`):

```js
if(currentUser){
  _outboxAdd(currentUser);
  const _u = currentUser;
  supaUpsertEmployee(_u).then(ok => { if(ok) _outboxRemove(_u); }).catch(()=>{});
}
```

`saveDB()` lo llama con 1,5 s de retardo desde decenas de sitios: terminar un
examen, ganar XP, aprender un plato, firmar el acuerdo, cambiar el avatar.

**4 · Qué identidad guarda.** El **nombre**, tomado de `currentUser`, una
variable de ámbito de script que cualquiera cambia desde la consola. **Auth no
interviene en ningún punto de la cola.**

**5 · Cómo se recupera.** `_outboxLoad()` parsea la clave; si el JSON está roto
devuelve un `Set` vacío — es decir, **un `localStorage` corrupto vacía la cola en
silencio**.

**6 · Cómo se sincroniza.** `_outboxFlush()` recorre los nombres y llama a
`supaUpsertEmployee(name)`; si devuelve `true`, desencola. Disparadores: evento
`online`, `visibilitychange`, **temporizador cada 120 s** y **4 s después de
arrancar**. Los dos últimos corren **aunque no haya nadie dentro**: no comprueban
`currentUser`, ni sesión, ni quién es.

**7 · Al hacer logout.** `logout()` limpia `currentUser`, `txoko_session` y el
token de Auth. **No toca la cola ni `DB.employees`.** Los dos sobreviven.

**8 · Al cambiar de empleado.** La cola sigue con el nombre del anterior y el
temporizador la intenta con la sesión del nuevo. Hoy funciona porque `anon`
escribe la ficha de cualquiera; es la misma puerta del ataque T1.

**9 · Si expira el token.** `supabase-js` lo renueva solo. Si el refresco falla,
`_bearer()` cae a la clave anónima y **hoy la escritura sigue funcionando**.

**10 · Offline prolongado.** La cola no crece: es un conjunto **por nombre**. Mil
actividades sin red ocupan **una** entrada. Es la mayor virtud del diseño actual.

**11 · Varios eventos pendientes.** Se recorren en serie, uno por nombre.
Normalmente hay uno.

**12 · Si un envío se reintenta.** `supaUpsertEmployee` tiene además dos
reintentos propios a 3 s. Reintentar es seguro (ver 13).

**13 · Idempotencia actual.** **Existe, y es estructural, no explícita.** La
fusión es **monótona**: `xp = max(local, nube)`, ídem `streak`, `txoko_record`,
`duel_wins`, y **unión** de conjuntos en `known_dishes`, `exam_correct`,
`topic_scores` y `achievements`. Reintentar cien veces da el mismo resultado que
una. Por eso no hay identificador de evento ni tabla de deduplicación: **no hacen
falta para `employees`**.

**14 · Si el servidor acepta pero el cliente no recibe respuesta.** La entrada
sigue encolada y se reenvía. Por la fusión monótona, inocuo.

**15 · Empleado que ya no puede entrar.** Hoy da igual: `anon` escribe igual.

**16 · Los 4 sin PIN.** No pueden entrar, luego no pueden encolar. No hay
entradas suyas y no puede haberlas.

**17 · Eventos de versiones anteriores a v7.450.** El formato no ha cambiado
nunca: son nombres. Una cola de mayo es indistinguible de una de hoy. **No hay
versión de esquema**, y ése es justamente el problema de la migración.

**18 · Eventos pendientes cuando se active RLS.** Ver la sección 3: es el fallo
crítico.

**19 · `_beaconSync`.** Camino aparte (`index.html:32612`): al descargarse la
página manda un POST con `keepalive` que **no pasa por la cola ni por
`supaUpsertEmployee`**. Desde la fase A ya manda el token que haya en memoria.
Su payload es un subconjunto del de la cola y **no es monótono**: manda los
valores locales tal cual.

**20 · Datos sensibles.** La cola en sí sólo lleva nombres. Pero al lado, en el
mismo `localStorage`, `DB.employees` guarda **la ficha completa de todos los que
han entrado en ese dispositivo**, incluido el hash del PIN (`emp.pin`) que el
auto-login necesita. **No está cifrado ni se limpia al salir.** En un móvil de
barra compartido, eso es legible por quien venga detrás.

---

## 3 · Problemas encontrados

### P1 · CRÍTICO — bajo RLS, el progreso se pierde en silencio

La cadena exacta, con el código en la mano:

1. La cola tiene pendiente a Ana. Entra Bruno. El temporizador de 120 s salta.
2. `supaUpsertEmployee('Ana')` sale con **el token de Bruno**.
3. La política `employees_progreso_propio` exige `auth_user_id = auth.uid()`: el
   UPDATE afecta a **cero filas**.
4. La petición lleva **`Prefer: return=minimal`**, así que PostgREST responde
   **200 con cuerpo vacío**. Verificado en el código (`index.html`, cabecera del
   upsert).
5. `if(!res.ok)` es falso → **`return true`** → `_outboxRemove('Ana')`.
6. El progreso de Ana **desaparece sin un solo error**.

No es que RLS bloquee: es que bloquea y **la cola lo llama éxito**. Y el aviso de
sincronización se pondrá en verde.

### P2 · `actividad` no tiene cola, y el comentario dice que sí

`registrarActividad()` se llama desde **15 sitios** y su `catch` dice *«se
reintentará cuando vuelva la conexión»*. **No existe tal reintento.** Lo
comprobé: nadie vuelve a llamarla. Sin cobertura, la fila de `actividad` **se
pierde para siempre**. Lo único que sobrevive es `_anotarEnDiario`, que es local
y nunca sube.

Es un fallo de hoy, no de RLS. La tabla tiene 5 filas y debería tener muchas más.

### P3 · `scores` tampoco tiene cola

Mismo caso: un examen terminado sin red no deja puntuación.

### P4 · La cola no distingue «no hacía falta» de «no se pudo»

`supaUpsertEmployee` devuelve `true` en cinco caminos distintos, cuatro de los
cuales **no han escrito nada**: cuenta de administración, sin nombre, sin ficha
local, y «nube ilegible + local vacío». Hoy es correcto; bajo RLS, el quinto caso
(«cero filas») se disfraza entre ellos.

### P5 · Un `localStorage` corrupto vacía la cola sin avisar

`_outboxLoad()` devuelve `Set` vacío ante cualquier JSON inválido.

### P6 · `_beaconSync` no es monótono

Manda los valores locales tal cual. Si el dispositivo tiene una copia atrasada,
al cerrar la pestaña **puede reducir** XP o racha en la nube. Es anterior a todo
esto y está fuera del alcance de la fase B, pero queda anotado.

---

## 4 · Diseño propuesto de identidad offline

### 4.0 · La distinción que lo ordena todo

Hay **dos cosas distintas** que hoy se tratan igual:

| | Qué es | Idempotencia | Qué hace falta |
|---|---|---|---|
| **Estado** (`employees`) | una foto del progreso; la última gana por fusión monótona | **ya la hay**, estructural | sellar con identidad |
| **Eventos** (`scores`, `actividad`) | hechos que ocurrieron: un examen, una práctica | **no hay ninguna**, ni cola | cola nueva + clave de idempotencia |

Meter los dos en el mismo saco es lo que ha llevado a pedir «una clave de
idempotencia por evento» para `employees`, donde **sería la herramienta
equivocada**: no hay eventos que deduplicar, hay un estado que converge.

### 4.1 · Identidad estable

Cada entrada de cola se sella, **en el momento de crearse**, con el `uid` de la
sesión activa:

```js
// BOCETO — no implementado
// txk_cola_v2 → [ { v:2, tipo:'estado', uid:'2369a651-…', nombre:'Ana', ts:… }, … ]
```

`uid` sale de `_authUid`, que sólo escribe `_authSesionEntrar` tras comprobar que
la sesión es de quien dice ser. **No sale de `currentUser`, ni del nombre, ni del
restaurante, ni del rol.**

**Por qué no basta con que el cliente lo escriba.** No basta, y no hace falta que
baste: el `uid` de la cola **sólo decide si se INTENTA**. Quien decide si se
**escribe** es la política del servidor contra el `auth.uid()` del token firmado.
Falsificar el `uid` de la cola sólo consigue que salga una petición que el
servidor rechaza.

### 4.2 · La regla de sincronización

```js
// BOCETO
for (const e of cola) {
  if (e.uid !== _authUid) continue;          // no es mía: se queda esperando
  const r = await enviarVerificado(e);
  if (r === 'confirmado' || r === 'nada-que-hacer') quitar(e);
  else if (r === 'permanente') aCuarentena(e);
  // 'reintentable' → se queda encolada
}
```

Tres cambios respecto a hoy:

1. **Se salta lo ajeno** en vez de intentarlo. No se borra: espera a que esa
   persona vuelva a entrar en ese dispositivo.
2. **El envío distingue cuatro resultados** en vez de un booleano. Para
   `employees` se consigue cambiando `Prefer: return=minimal` por
   **`return=representation`** y comprobando que vuelve **exactamente una fila**.
   Cero filas deja de ser éxito.
3. **Sólo se desencola lo confirmado.**

### 4.3 · El ejemplo obligatorio, resuelto

> Ana trabaja offline → deja pendiente → cierra sesión → Bruno entra en el mismo
> iPad → vuelve la conexión.

| Momento | Qué pasa |
|---|---|
| Ana estudia sin red | entrada `{uid: ana, nombre:'Ana'}` |
| Ana sale | `logout()` borra su token; **la cola se conserva intacta** |
| Bruno entra | `_authUid = bruno` |
| Vuelve la red, salta el temporizador | la entrada de Ana **no coincide** → se salta, **no se intenta y no se desencola** |
| El chip de sincronización | marca «1 pendiente de otra persona», no «sincronizado» |
| Ana vuelve a entrar en ese iPad | coincide → se envía → se confirma → se desencola |

**Nunca se convierte en un evento de Bruno. Nunca desaparece sin diagnóstico.**
Las dos condiciones del requisito.

### 4.4 · Qué valida el cliente y qué valida el servidor

| Caso | Cliente | Servidor |
|---|---|---|
| identidad del evento | sella con `_authUid`; sólo envía lo suyo | la política compara con `auth.uid()` del token firmado |
| restaurante | **deja de mandarlo** | `DEFAULT app.mi_venue()` |
| nombre del empleado | **deja de mandarlo** en eventos | `DEFAULT app.mi_nombre()` |
| rol | nunca lo manda | sale de `employees.role` |
| duplicados | reenvía sin miedo | `UNIQUE (evento_id)` |

La regla es una: **el cliente propone, el servidor decide, y lo que el cliente no
manda no se puede falsificar.**

---

## 5 · Migración de eventos existentes

Al desplegar el formato nuevo habrá dispositivos con `txk_sync_outbox` (nombres
sueltos) sin estrenar. **No se puede saber quién los creó: esa información nunca
se guardó.** Cualquier cosa que diga lo contrario sería inventada.

Tratamiento, y sigue tu criterio de **retener antes que reasignar mal**:

1. **Al cargar**, la clave vieja se convierte a `{v:2, tipo:'estado', uid:null,
   nombre, ts:0}`. La clave vieja **no se borra** hasta confirmar (ver rollback).
2. **Mientras `anon` conserve permiso** (fases A–C), las entradas con `uid:null`
   se intentan por el camino de siempre y se vacían solas en días.
3. **Adopción al entrar**, y sólo ésta: cuando alguien inicia sesión, las
   entradas con `uid:null` **cuyo `nombre` coincide exactamente con el suyo** se
   sellan con su `uid`. Es seguro porque esa persona podría escribir esa fila de
   todas formas.
4. **Las demás nunca se adoptan.** Al retirar `anon` (fase D) pasan a
   `txk_cola_cuarentena` y el chip lo dice: «hay progreso de otra sesión sin
   sincronizar». Requiere que esa persona entre en ese dispositivo, o una
   recuperación explícita.

### Versión de formato

Cada entrada lleva `v`. El lector acepta `v` ausente (= formato 1, nombres
sueltos) y `v:2`. Ante una `v` **mayor** que la que conoce, **no la toca y no la
borra**: la deja para una versión futura del cliente. Así una actualización
parcial de la flota no destruye colas.

---

## 6 · Idempotencia

### 6.1 · Estado (`employees`): ya la hay, y hay que no romperla

La fusión monótona hace que reenviar sea inocuo. **No se añade clave de
idempotencia**, porque no hay evento: hay convergencia. Lo único que cambia es
cuándo se desencola.

Cubre por construcción: doble envío, timeout tras aceptación, recarga, cierre de
pestaña, `_beaconSync` y reintentos.

### 6.2 · Eventos (`scores`, `actividad`): hace falta crearla

**Clave propuesta: un UUID v4 generado en el cliente EN EL MOMENTO EN QUE OCURRE
EL EVENTO**, no al enviarlo.

```js
// BOCETO
{ v:2, tipo:'evento', tabla:'actividad', uid:'…', evento_id: crypto.randomUUID(), ts:…, datos:{…} }
```

Por qué un UUID del cliente y no un hash del contenido: dos exámenes idénticos el
mismo día son **dos hechos distintos** y deben contar dos veces. Un hash los
fundiría en uno.

**Dónde se valida: en el servidor, con una restricción `UNIQUE`.** Es la única
capa que no se puede saltar desde el cliente.

**Qué recibe el cliente cuando ya fue aceptado:** con
`Prefer: resolution=ignore-duplicates,return=representation`, un **201 con cuerpo
vacío** (cero filas) — que el cliente trata como **`nada-que-hacer`** y desencola.
Sin esa cabecera sería un **409 / SQLSTATE 23505**, que también se trata como
aceptado. Las dos son señales de «ya estaba», no de error.

| Situación | Qué pasa |
|---|---|
| doble envío | el segundo no inserta; el cliente desencola igual |
| timeout tras aceptación | se reenvía; el `UNIQUE` lo absorbe |
| recarga / cierre de pestaña | la entrada sigue en `localStorage` con su `evento_id` |
| `_beaconSync` | usa el mismo `evento_id` |
| reintentos | idénticos entre sí |

---

## 7 · Sesión, logout y quiosco

| Caso | Cliente | Servidor |
|---|---|---|
| **Token expirado** | `supabase-js` lo renueva; `onAuthStateChange` refresca `_authToken` (ya implementado en la fase A) | — |
| **Refresco fallido** | `_authUid` pasa a null → **no se intenta nada, no se desencola nada**; el chip marca pendiente | 401 |
| **Logout** | `_authSesionSalir()` borra el token de los dos sitios; **la cola se conserva**; `_authUid = null` | — |
| **Cambio de empleado** | la cola del anterior se salta por `uid` | la política lo bloquearía igualmente |
| **Dos pestañas** | comparten `localStorage`; el cerrojo `_outboxFlushing` es por pestaña, así que puede haber envíos simultáneos — inocuos por 6.1 y 6.2 | `UNIQUE` |
| **Quiosco** | el token vive en memoria si no se marcó «recordarme» (ya implementado); la cola persiste igual | — |
| **Offline prolongado** | la cola no crece; si el refresh token muere, todo queda retenido | — |

**Lo que sigue sin resolver, y lo digo:** `DB.employees` conserva las fichas de
todos los que han pasado por ese dispositivo, con el hash de su PIN. Bajo RLS deja
de ser un problema de servidor, pero sigue siendo una fuga local. **Fuera del
alcance de la fase B**, anotado.

---

## 8 · Eventos inválidos o irrecuperables

| Situación | Qué hace el cliente | Qué hace el servidor | Clasificación |
|---|---|---|---|
| `uid` ≠ sesión actual | **no envía**, retiene | — | retenido |
| `uid` de una cuenta borrada | envía una vez, recibe 401/403 | rechaza | **permanente** → cuarentena |
| `auth_user_id` inexistente | — | `auth.uid()` no casa: cero filas | permanente |
| Evento manipulado (otro empleado) | — | `with check` falla | **42501**, permanente |
| Evento manipulado (otro venue) | — | `venue` viene del DEFAULT del servidor; el del cliente se ignora | permanente |
| Evento sin identidad (`uid:null`) | tras la fase D, cuarentena | — | retenido |
| Empleado sin PIN | no puede haber entradas suyas | — | — |
| Empleado desactivado | — | **no existe ese concepto hoy** (ver riesgos) | — |
| Sin red / 5xx / timeout | retiene y reintenta | — | **reintentable** |
| 409 duplicado | desencola | `UNIQUE` | aceptado |

**La distinción permanente / reintentable es nueva y es el corazón del arreglo.**
Hoy todo error es igual: se traga y se sigue.

**Cuarentena** (`txk_cola_cuarentena`): no se borra nada nunca. Se aparta, se
cuenta y se enseña. Una entrada en cuarentena se puede recuperar entrando con la
identidad correcta en ese dispositivo.

---

## 9 · Integración con RLS

La arquitectura que pediste, con el estado real de cada paso:

| | | Estado |
|---|---|---|
| **A** | el cliente obtiene sesión real | **hecho** (v7.449) |
| **B** | REST usa Bearer | **hecho** (v7.450, medido hoy) |
| **C** | el evento offline conserva su identidad de origen | **este diseño** |
| **D** | la sincronización usa esa identidad, no la del dispositivo | **este diseño** |
| **E** | el servidor valida identidad y autorización | fase C de RLS |
| **F** | la idempotencia evita duplicados | **este diseño** + esquema |
| **G** | se activan las políticas | fase C de RLS |
| **H** | se retiran los permisos anónimos | fase D de RLS |

### Cambios al diseño de RLS de la fase 2.5D

1. **`Prefer: return=representation` es obligatorio** en toda escritura del
   cliente antes de activar ninguna política. Sin eso, «cero filas» es
   indistinguible de «escrito» y el paso G destruye datos. **Es una precondición,
   no una mejora.**
2. **`scores` y `actividad` necesitan `evento_id uuid UNIQUE`** para que la
   idempotencia viva en el servidor. Es un cambio de esquema (sección 11).
3. **El `DEFAULT` de servidor para `employee` y `venue`** pasa de conveniencia a
   requisito: es lo que impide que un evento retenido durante días se sincronice
   con un restaurante que ya no es el suyo.
4. **La fase D no puede empezar con la cuarentena sin vaciar.** Retirar `anon`
   con entradas `uid:null` pendientes convierte «retenido» en «irrecuperable».

---

## 10 · Tests propuestos

Ejecutables: la lógica de cola en `tests/smoke.mjs` con el almacenamiento y la
red interceptados; las políticas en SQL dentro de transacciones que abortan.

### Positivos

| # | Caso | Esperado | Capa |
|---|---|---|---|
| 1 | Ana crea offline → Ana sincroniza | 1 fila escrita, desencolada | política + cola |
| 2 | Token renovado a mitad | sincroniza igual, `uid` no cambia | `onAuthStateChange` |
| 3 | Offline 3 días, 200 guardados | **1 entrada**, un envío | cola |
| 4 | Doble sincronización de un evento | 1 fila en total | `UNIQUE` |
| 5 | Timeout tras aceptación | reenvío absorbido, desencolado | `UNIQUE` |
| 6 | `_beaconSync` con token vigente | escribe; si falla, la cola lo recoge | cola |
| 7 | Dos pestañas a la vez | 1 fila, sin duplicar | `UNIQUE` |

### Negativos

| # | Ataque / fallo | Esperado | Qué lo impide |
|---|---|---|---|
| 8 | Ana crea → **Bruno entra** → sincroniza | **0 envíos** de la entrada de Ana; sigue encolada | cola (`uid`) |
| 9 | Ana logout → Bruno login → evento de Ana | idéntico a 8; **nunca pasa a Bruno** | cola (`uid`) |
| 10 | Token expirado sin refresco | 0 envíos, 0 desencolados | cola (`_authUid` null) |
| 11 | Entrada manipulada: `nombre` de otro | el servidor rechaza | `with check` → **42501** |
| 12 | Entrada manipulada: `uid` de otro | sale y **se rechaza** | política contra el token firmado |
| 13 | Entrada manipulada: `venue` de otro | el campo **ni se manda**; DEFAULT del servidor | esquema |
| 14 | Evento sin identidad tras fase D | cuarentena, con aviso | cola |
| 15 | `auth_user_id` inexistente | 0 filas → **permanente**, no desencola | política |
| 16 | Empleado desactivado | **hoy no existe**; documentado como pendiente | — |
| 17 | Empleado sin PIN | no puede encolar | login |
| 18 | Entrada de formato antiguo | migrada, adoptada sólo si el nombre coincide | cola |
| 19 | Replay de un evento ya aceptado | 0 filas nuevas, cliente desencola | `UNIQUE` |
| 20 | `localStorage` corrupto | **no se vacía en silencio**: se avisa | cola |

### Mutaciones obligatorias

Cada guarda se rompe a propósito y la prueba que la protege tiene que caer:
quitar la comparación de `uid`, volver a `return=minimal`, tratar «cero filas»
como éxito, quitar el `UNIQUE`, adoptar entradas de otro nombre, y borrar la
cuarentena en vez de retenerla.

---

## 11 · Cambios de código y de esquema necesarios

### Código de cliente (fase B propiamente dicha)

| # | Qué | Riesgo |
|---|---|---|
| 1 | Formato de cola v2 con `uid`, `v`, `ts`, leyendo también el v1 | bajo |
| 2 | `supaUpsertEmployee` devuelve estado en vez de booleano | medio: lo llaman 3 sitios |
| 3 | `Prefer: return=representation` en el upsert, y contar filas | **medio-alto**: cambia el tamaño de la respuesta de todos los guardados |
| 4 | Flush por identidad + cuarentena + aviso en el chip | bajo |
| 5 | Adopción de entradas heredadas al iniciar sesión | bajo |
| 6 | **Cola de eventos para `scores` y `actividad`** (hoy no existe) | alto: es funcionalidad nueva |
| 7 | `_beaconSync` usa la misma cola y el mismo `evento_id` | medio |

### Cambios de esquema — **NO ejecutados, descritos y justificados**

```sql
-- SIN EJECUTAR. Requiere tu aprobación explícita.

-- 1 · Idempotencia de eventos. Sin esto, la cola de scores/actividad duplica
--     filas en cuanto haya un timeout, y no hay forma de evitarlo desde el
--     cliente: el servidor es la única capa que puede decir «esto ya estaba».
alter table public.scores    add column evento_id uuid;
alter table public.actividad add column evento_id uuid;
create unique index concurrently scores_evento_id_uk    on public.scores(evento_id)    where evento_id is not null;
create unique index concurrently actividad_evento_id_uk on public.actividad(evento_id) where evento_id is not null;

-- 2 · Identidad y restaurante los pone el servidor. Sin esto, un evento
--     retenido varios días se sincronizaría con el restaurante que el cliente
--     tuviera seleccionado ESE día, no el de cuando ocurrió.
alter table public.actividad alter column employee set default app.mi_nombre();
alter table public.actividad alter column venue    set default app.mi_venue();
alter table public.scores    alter column employee set default app.mi_nombre();
alter table public.scores    alter column venue    set default app.mi_venue();
```

**Por qué el índice es parcial (`where evento_id is not null`)**: las 427
puntuaciones históricas y las 5 actividades existentes no tienen `evento_id`, y
no se les inventa uno. `NULL` no colisiona consigo mismo en un índice único, así
que conviven sin tocar una sola fila de datos.

**Por qué `concurrently`**: no bloquea la tabla. Con 427 filas da igual, pero es
la forma correcta y no cuesta nada.

Los `DEFAULT` dependen de `app.mi_nombre()` y `app.mi_venue()`, que son de la
fase C de RLS. **Orden obligado**: crear las funciones antes que los defaults.

---

## 12 · Riesgos y decisiones pendientes

### R1 · `return=representation` cambia el tráfico de todos los guardados

Hoy el upsert no devuelve cuerpo. Con `representation` devuelve la fila entera —
unos pocos KB con `sessions_data` y `known_dishes` dentro— **en cada guardado**,
y hay uno cada 1,5 s de actividad. En el wifi de sala eso se nota.

**Alternativa**: `Prefer: return=headers-only,count=exact`, que devuelve el
número de filas en la cabecera `Content-Range` sin cuerpo. Hay que **medir** que
PostgREST lo respeta en un upsert antes de comprometerse. **Decisión pendiente.**

### R2 · La cola de eventos es funcionalidad nueva, no un arreglo

Los puntos 6 y 7 de la sección 11 no son «adaptar la cola»: son **crear una que
no existe**, para dos tablas. Es la mitad del trabajo de la fase B y el grueso del
riesgo. **Se puede partir**: fase B1 sólo la cola de estado (arregla P1, el fallo
crítico), fase B2 la de eventos (arregla P2 y P3). **Lo recomiendo.**

### R3 · No existe «empleado desactivado»

Sin columna `activo`, el test 16 no se puede escribir y una cuenta retirada sólo
se distingue por no tener identidad. Fuera de alcance, anotado.

### R4 · La cuarentena necesita una pantalla

Retener sin enseñar es esconder. Hace falta, como mínimo, que el chip de
sincronización diga «hay progreso de otra sesión» y se pueda tocar para ver de
quién. Es diseño de interfaz, no sólo de datos.

### R5 · `_beaconSync` no es monótono (P6)

Anterior a esto y puede reducir XP al cerrar la pestaña desde un dispositivo
atrasado. **Decisión pendiente**: arreglarlo dentro de la fase B —haciéndolo
pasar por la misma fusión— o dejarlo anotado.

### Decisiones que necesito de ti

1. **¿B1 y B2 por separado** (recomendado), o la fase B entera de una vez?
2. **¿Apruebas los cambios de esquema** de la sección 11? Sin ellos, la cola de
   eventos no puede ser idempotente.
3. **¿`representation` o `headers-only`** para contar filas? Puedo medir los dos
   antes de decidir.
4. **¿`_beaconSync` monótono** ahora o después?
