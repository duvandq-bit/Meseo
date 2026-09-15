# Fase 2.5E — La cola offline, y la migración de RLS revisada

**Diseño. No se ha ejecutado ningún SQL, ni cambiado ninguna política o permiso,
ni modificado ningún dato, ni desplegado nada.**

Continúa `docs/fase2.5d-diseno-rls.md` e incorpora las siete decisiones del
propietario del 15 de septiembre de 2026.

---

# PARTE 1 · LA COLA OFFLINE

## A · Estructura actual exacta

Una sola clave de `localStorage`:

```
txk_sync_outbox  →  ["Duvan","Sol"]        (un array JSON de NOMBRES)
```

En memoria se maneja como `Set<string>`. **No hay nada más**: ni identidad, ni
marca de tiempo, ni versión, ni el evento en sí.

```js
const _OUTBOX_KEY = 'txk_sync_outbox';
function _outboxLoad(){ …JSON.parse(localStorage.getItem(_OUTBOX_KEY)||'[]')… }  // → Set
function _outboxSave(set){ …JSON.stringify([...set])… }
function _outboxAdd(name){ … }
function _outboxRemove(name){ … }
```

**No es una cola de eventos: es una lista de «fichas con cambios sin confirmar».**
El dato vive en `DB.employees[nombre]`, dentro de `txoko_data_v4`. La cola sólo
recuerda a quién hay que reintentar. Esa distinción importa para todo lo que
sigue.

## B · Dónde se crea cada evento

**Un único sitio.** `index.html:4633`, dentro de `_saveDBNow()`:

```js
if(currentUser){
  _outboxAdd(currentUser);
  const _u = currentUser;
  supaUpsertEmployee(_u).then(ok => { if(ok) _outboxRemove(_u); }).catch(()=>{});
}
```

`_saveDBNow()` lo invoca `saveDB()` con 1,5 s de retardo, y `saveDB()` se llama
desde decenas de sitios: terminar un examen, ganar XP, aprender un plato, cerrar
una sesión de estudio, firmar el acuerdo, cambiar el avatar. **Toda la aplicación
encola por este embudo, y la identidad que graba es `currentUser`** — una
variable de ámbito de script que el usuario puede cambiar desde la consola.

Fuera de la cola hay una segunda vía de escritura, `_beaconSync()`
(`index.html:32612`), que dispara al descargarse la página con `keepalive` y **no
pasa por la cola ni por `supaUpsertEmployee`**.

## C · Dónde se almacena

`localStorage` del navegador, clave `txk_sync_outbox`. Sobrevive a cerrar la
pestaña, a cerrar el navegador y a reiniciar el móvil. **Sobrevive también al
logout**: `logout()` borra `txoko_session` y el token de Auth, pero **no toca la
cola** ni `txoko_data_v4`.

No hay IndexedDB para esto. La IndexedDB `txk_telemetry` es otra cosa: telemetría
local que nunca sale del dispositivo. El service worker **no** usa Background
Sync.

## D · Qué datos contiene

La cola: nombres. El payload real lo reconstruye `supaUpsertEmployee(name)` en el
momento del envío, leyendo `DB.employees[name]`:

`xp`, `streak`, `topic_scores`, `known_dishes`, `exam_correct`, `sessions_count`,
`sessions_data` (últimas 20), `achievements`, `extras`, `txoko_record`, `avatar`,
`duel_wins`, `last_study_day`, `last_login`, `last_active_at`, `updated_at`.

**Consecuencia:** lo que se envía es el **estado actual** de la ficha, no el
evento que lo provocó. Por eso reintentar es seguro (ver N) y por eso no hay
«eventos huérfanos» que reconstruir.

## E · Cómo se identifica actualmente el empleado

Por **nombre**, y en tres saltos:

```
currentUser (variable JS)  →  _outboxAdd(nombre)  →  DB.employees[nombre]
                                                  →  POST /employees?on_conflict=name
```

**Ninguno de los tres pasos consulta a Auth.** `auth.uid()` no interviene en
ningún punto. La identidad de un evento encolado es exactamente «la cadena que
había en `currentUser` cuando se guardó».

## F · Cómo se sincroniza

```js
async function _outboxFlush(){
  if(_outboxFlushing || navigator.onLine === false) return;
  for(const name of [...s]){
    let ok = await supaUpsertEmployee(name);
    if(ok) _outboxRemove(name);
  }
}
```

Disparadores:

| Cuándo | Línea |
|---|---|
| al volver la conexión (`online`) | 3207 |
| al volver a primer plano (`visibilitychange`) | 3208 |
| **cada 120 s, por temporizador global** | 3209 |
| 4 s después de arrancar la aplicación | 3210 |

**Los dos últimos corren aunque no haya nadie dentro.** No comprueban
`currentUser`, ni que haya sesión, ni quién es. Es deliberado —recuperar lo que
quedó colgado de la sesión anterior— y hoy funciona porque `anon` puede escribir
la ficha de cualquiera. **Bajo RLS deja de funcionar, y falla en silencio.**

`supaUpsertEmployee` devuelve `true` también en varios caminos de «no había nada
que hacer» (`!name`, `!emp`, cuenta de administración, nube ilegible + local
vacío). En esos casos la entrada se desencola sin haber escrito nada, lo cual es
correcto hoy pero **no distingue «no hacía falta» de «no se pudo»**.

## G · Cómo se pierde el contexto al cambiar de empleado

Secuencia real, en el móvil de barra:

1. Ana entra, estudia sin cobertura. `txk_sync_outbox = ["Ana"]`.
2. Ana pulsa salir. `logout()` limpia `currentUser`, `txoko_session` y el token.
   **La cola sigue diciendo `["Ana"]`** y `DB.employees.Ana` sigue en el móvil.
3. Bruno entra. Ahora hay sesión de Auth de Bruno.
4. A los 120 s salta el temporizador: `_outboxFlush()` → `supaUpsertEmployee('Ana')`.

**Hoy:** la petición va con la clave anónima, escribe la fila de Ana y funciona.
Es la misma puerta que permite a Bruno pisar el progreso de Ana a mano (T1).

**Bajo RLS:** la petición va con el token de **Bruno**; la política
`employees_progreso_propio` exige `auth_user_id = auth.uid()`; el UPDATE afecta a
**cero filas**; PostgREST responde 200 con cuerpo vacío; `supaUpsertEmployee`
devuelve `true`; `_outboxRemove('Ana')` **desencola**; y el progreso de Ana
**desaparece sin un solo error**.

Ése es el fallo crítico. No es que RLS bloquee: es que bloquea y la cola lo
interpreta como éxito.

---

## H · Diseño propuesto: atar cada entrada a `auth.uid()`

### H.1 · Nueva estructura

```js
// BOCETO — no implementado
// txk_sync_outbox_v2  →
// [ { v:2, nombre:'Ana', uid:'2369a651-…', ts:1789430000000 }, … ]
```

| Campo | Qué es | Quién lo escribe |
|---|---|---|
| `v` | versión del formato | el código |
| `nombre` | clave para leer `DB.employees[nombre]` y para el UPDATE | `currentUser` |
| `uid` | **la identidad de la sesión que creó la entrada** | `_authUid`, que sale de la sesión de Auth |
| `ts` | cuándo se encoló | el código |

**El cliente no puede falsificar `uid` de forma útil.** Puede escribirlo a mano en
`localStorage`, sí — pero el servidor no se lo cree: el `uid` de la cola sólo
sirve para decidir **si se intenta**, y quien decide **si se escribe** es la
política contra el `auth.uid()` del token. Falsificar el `uid` de la cola sólo
consigue que la petición salga y la rechace el servidor.

### H.2 · Regla de sincronización

```js
// BOCETO — no implementado
async function _outboxFlush(){
  if(_outboxFlushing || navigator.onLine === false) return;
  const uidActivo = _authUid;            // null si no hay sesión
  for(const e of _outboxLoad()){
    if(e.uid && e.uid !== uidActivo) continue;   // no es mía: se queda esperando
    if(!e.uid && MIGRACION_TERMINADA) continue;  // heredada: ver I
    const r = await supaUpsertEmployeeVerificado(e.nombre);
    if(r === 'confirmado' || r === 'nada-que-hacer') _outboxQuitar(e);
    // 'rechazado' y 'sin-red' NO desencolan
  }
}
```

Tres cambios, y los tres importan:

1. **Se salta las entradas ajenas** en vez de intentarlas. No se borran: esperan a
   que esa persona vuelva a entrar en este dispositivo.
2. **`supaUpsertEmployee` deja de devolver un booleano** y pasa a distinguir
   `confirmado` / `nada-que-hacer` / `rechazado` / `sin-red`. Hoy «cero filas
   afectadas» y «escrito correctamente» son el mismo `true`, y eso es justo lo que
   convierte el bloqueo de RLS en pérdida silenciosa. Se consigue con
   `Prefer: return=representation` y comprobando que vuelve **una fila**.
3. **Sólo desencola lo confirmado.** Un rechazo deja la entrada en la cola y
   enciende el aviso de sincronización pendiente.

### H.3 · El UPDATE deja de ser un upsert por nombre

Hoy: `POST /employees?on_conflict=name` — un `INSERT … ON CONFLICT DO UPDATE`.
Bajo RLS eso exige pasar **la política de INSERT y la de UPDATE**. Funciona, pero
es una forma retorcida de decir «actualiza mi fila».

Propuesto: `PATCH /employees?auth_user_id=eq.<uid>` — o mejor,
`PATCH /employees?name=eq.<nombre>` dejando que la política haga el filtro. El
alta de cuentas nuevas ya va por `employee_register` (SECURITY DEFINER) desde
hace meses, así que el cliente **no necesita INSERT** sobre `employees` para nada.

Efecto lateral bueno: se puede retirar la política `employees_alta` y el grant de
INSERT, y entonces el disparador `employees_solo_alta_con_codigo` deja de ser la
única barrera contra el alta directa.

### H.4 · `_beaconSync`, según la decisión 3

Decidido: **no hay rendija anónima**. Entonces `_beaconSync` tiene dos salidas
posibles, y ninguna es gratis:

- **(a) Que mande el token que ya tenga en memoria.** `keepalive` admite
  cabeceras, así que se puede mandar el `access_token` vigente sin llamar a
  `getSession()` (que es asíncrono y puede no terminar durante el `unload`). Si el
  token está caducado, la petición se rechaza y **la cola lo recoge en el
  siguiente arranque**, porque la entrada sigue encolada. Es aceptable
  precisamente porque la cola es la red de seguridad.
- **(b) Retirarlo.** La cola ya cubre el caso: lo que `_beaconSync` intenta salvar
  ya está en `localStorage` y ya está encolado.

**Recomiendo (a) con el respaldo de (b)**: mandar el token que haya, y no tratar
su fallo como un problema, porque la cola lo reintenta. Lo que **no** se puede
hacer es dejarlo con la clave anónima: sería reabrir T1 por la puerta de atrás.

---

## I · Entradas creadas antes de la migración

Al desplegar el formato v2 habrá dispositivos con `txk_sync_outbox` (v1, nombres
sueltos) sin estrenar. **No se puede saber quién las creó**: esa información nunca
se guardó. Cualquier cosa que diga lo contrario sería inventada.

Tratamiento propuesto, en tres tiempos:

1. **Al cargar**, si existe la clave vieja, se convierte a
   `{v:2, nombre, uid:null, ts:0}` y se conserva la clave vieja hasta confirmar.
2. **Mientras `anon` siga teniendo permiso** (fases A–C), las entradas con
   `uid:null` se intentan por el camino de siempre. Se vacían solas en días.
3. **Adopción al entrar.** Cuando alguien inicia sesión, las entradas con
   `uid:null` **cuyo `nombre` coincide con el suyo** se sellan con su `uid`. Es
   seguro: esa persona podría escribir esa fila de todas formas.
4. Las que queden con `uid:null` y nombre de otro, al retirar `anon` (fase D),
   **dejan de ser sincronizables**. No se borran en silencio: pasan a una lista
   `txk_sync_huerfanas` y el chip de sincronización lo dice.

**Nunca se adopta una entrada a nombre de otro.** Preferimos un dato varado a un
dato atribuido a quien no es.

## J · Entradas de los cuatro empleados sin identidad

Decisión 1 del propietario: Gabriel, María, Monica y Sheila **se quedan sin
acceso**, sin PIN artificial ni identidad, y **no como excepción de RLS**.

Consecuencias, dichas sin rodeos:

| | Qué pasa |
|---|---|
| **Sus datos históricos en la nube** | Intactos. Nadie los borra. Sus fichas siguen en `employees` con su XP y su progreso, y siguen siendo legibles por sus compañeros del mismo restaurante, porque la política de lectura es por restaurante. |
| **Si intentan usar la aplicación hoy** | No pueden: no tienen PIN. El login los rechaza igual que ahora. Nada cambia. |
| **Si alguien les pone un PIN mañana** | `sesion` les crea la identidad de Auth la primera vez y quedan vinculados automáticamente. El camino existe y no hay que hacer nada especial. |
| **Sus entradas en alguna cola** | No puede haber ninguna: para encolar hace falta haber entrado, y no pueden. Si apareciera una de antes de perder el PIN, caería en `txk_sync_huerfanas` (I.4). |
| **Sus puntuaciones y actividad** | Se quedan. Bajo la política revisada de `scores` (parte 2) siguen visibles para su restaurante. |

**No se les hace ninguna excepción en ninguna política.** Simplemente no tienen
credenciales, y una política que sólo mira `auth.uid()` no necesita saber que
existen.

## K · Sesión expirada

El `access_token` dura 1 h; `supabase-js` lo renueva solo con el `refresh_token`
mientras la pestaña viva o al arrancar.

| Situación | Comportamiento propuesto |
|---|---|
| Token caducado, refresco correcto | transparente: `_authUid` sigue siendo el mismo, la cola sincroniza |
| Refresco fallido (sesión revocada, refresh caducado) | `_authUid = null` → **no se intenta nada**, todo se queda encolado, el chip marca «pendiente» |
| Sin sesión nunca (los 4 sin PIN, o alguien que no marcó «recordarme» y reabrió) | igual: nada se intenta, nada se pierde |

La regla es una sola: **sin `uid` activo no se sincroniza, y no se desencola.**

## L · Dispositivo compartido

Con el diseño propuesto, la secuencia de G queda:

1. Ana estudia sin cobertura → `[{nombre:'Ana', uid:'uid-ana'}]`.
2. Ana sale. La cola se conserva. El token de Ana se borra de los dos sitios (ya
   lo hace `_authSesionSalir`).
3. Bruno entra. `_authUid = 'uid-bruno'`.
4. Temporizador: la entrada de Ana **se salta**, no se intenta y **no se
   desencola**.
5. Ana vuelve a entrar en ese móvil cualquier día: su `uid` coincide, la entrada
   se envía y se confirma.

**Lo que sigue sin resolverse, y lo digo:** `DB.employees` en `txoko_data_v4`
conserva las fichas de todos los que han entrado en ese móvil. Bajo RLS deja de
ser un problema de servidor —nadie puede escribir la ficha de otro— pero el
progreso de Ana sigue siendo **legible en local** después de que se vaya. Cerrarlo
exige cifrar o purgar el almacén local al salir, con el coste de que Ana pierda
su copia offline. **Queda fuera de esta fase, anotado.**

## M · Offline prolongado

| Plazo | Qué pasa |
|---|---|
| Horas | El token caduca, se refresca al volver la conexión. Sin efecto. |
| Días o semanas | El `refresh_token` de Supabase no caduca por tiempo en la configuración actual, pero sí se invalida si la sesión se revoca. Si falla, se aplica K: todo queda encolado. |
| La cola crece | No crece: es un **conjunto por nombre**, no un registro por evento. Un empleado que estudie mil veces sin red sigue ocupando **una** entrada. Es la mayor virtud del diseño actual y se conserva. |
| `localStorage` lleno | Ya está contemplado: `_saveDBNow` detecta `QuotaExceededError` y avisa. La cola v2 añade ~60 bytes por entrada. |

## N · Idempotencia

**Ya es idempotente por construcción, y hay que conservarlo.**
`supaUpsertEmployee` fusiona de forma **monótona**: `xp = max(local, nube)`,
`streak = max(...)`, `txoko_record = max(...)`, y unión de conjuntos para
`known_dishes`, `exam_correct`, `topic_scores` y `achievements`. Reintentar cien
veces da el mismo resultado que una.

Por eso la cola puede reintentar para siempre sin llevar número de secuencia ni
identificador de evento, y por eso no hace falta una tabla de deduplicación.

El único cambio es que ahora se distinguirá «confirmado» de «rechazado» — lo cual
**no afecta** a la idempotencia, sólo a cuándo se desencola.

## O · Rollback de la cola

| Paso | Deshacer |
|---|---|
| Formato v2 | El lector acepta los dos formatos. Volver al código anterior deja `txk_sync_outbox_v2` sin leer y `txk_sync_outbox` intacto: **no se pierde nada**, se reintenta con el criterio viejo. |
| Flush por identidad | Volver al `index.html` anterior. Las entradas selladas se reintentan como antes. |
| `_beaconSync` con token | Ídem. |

La regla es: **escribir el formato nuevo sin destruir el viejo** hasta que esté
confirmado en el terreno.

---

# PARTE 2 · LA MIGRACIÓN DE RLS, REVISADA

Las nueve etapas del documento anterior se reorganizan en las cuatro fases que
pediste. **Ninguna está implementada.**

## FASE A — Identidad y sesión en línea

**Objetivo:** que las peticiones del cliente lleguen como `authenticated`.
**Ninguna política cambia. Ningún permiso se retira. Comportamiento idéntico.**

| A.1 | Un ayudante de cabeceras que use el `access_token` si hay sesión y la clave anónima si no. Punto único de cambio para las ~45 llamadas. |
| A.2 | `_beaconSync` manda el token que tenga en memoria (H.4). |
| A.3 | **Medir**: contar en `query_logs` qué proporción de peticiones llega con `role=authenticated`. |

**Criterio para pasar a B:** el porcentaje autenticado se estabiliza y sólo
quedan fuera los casos conocidos (los 4 sin PIN, que no entran; y dispositivos con
la versión vieja en caché).

**Rollback:** desplegar la versión anterior.

## FASE B — La cola offline

**Objetivo:** que ninguna entrada pueda sincronizarse bajo una identidad ajena, y
que un rechazo no se confunda con un éxito.
**Todavía sin políticas nuevas: esto se despliega y se observa antes de cerrar nada.**

| B.1 | Formato v2 con `uid` (H.1), leyendo los dos formatos (O). |
| B.2 | `supaUpsertEmployee` devuelve estado en vez de booleano (H.2). |
| B.3 | Flush por identidad: se salta lo ajeno, sólo desencola lo confirmado. |
| B.4 | Adopción de entradas heredadas al iniciar sesión (I.3) y lista de huérfanas (I.4). |
| B.5 | `PATCH` a la fila propia en vez de upsert por nombre (H.3). |

**Criterio para pasar a C:** ver en producción que las colas se vacían, que
`txk_sync_huerfanas` está vacía o es explicable, y que nadie reporta progreso
perdido.

**Por qué B va antes que C y no después:** si las políticas se cierran primero, el
fallo de G ocurre de verdad —progreso perdido en silencio— antes de que exista el
código que lo detecta. El orden inverso es el único seguro.

## FASE C — Políticas autenticadas

`anon` **conserva todos sus permisos durante toda esta fase.** Las políticas
nuevas se escriben para `authenticated`; las viejas, permisivas, se mantienen para
`anon`. Un dispositivo con la versión vieja sigue funcionando.

| C.1 | `app.mi_nombre()` y `app.mi_venue()` (SQL en el documento anterior, sección E). |
| C.2 | `actividad`: DEFAULT en servidor + políticas + el cliente deja de mandar `employee` y `venue`. |
| C.3 | Pruebas negativas sobre `actividad`. |
| C.4 | `scores`: políticas (revisadas abajo). |
| C.5 | Pruebas negativas sobre `scores`. |
| C.6 | `employees`: políticas. |
| C.7 | Pruebas negativas sobre `employees`. |

### C.4 revisado — `scores`, por la decisión 6

El documento anterior proponía exigir que el empleado exista:

```sql
-- PROPUESTA ANTERIOR, DESCARTADA
using ( venue = app.mi_venue()
        and exists (select 1 from public.employees e
                    where e.name = scores.employee and e.venue = scores.venue) )
```

Eso escondía las 58 filas huérfanas. **Decidiste no borrarlas y que sigan
consultables**, así que la política se simplifica:

```sql
-- SIN EJECUTAR
create policy scores_leer_de_mi_restaurante on public.scores
  for select to authenticated
  using ( venue = app.mi_venue() );
```

Mejor en tres cosas: las 58 huérfanas **siguen visibles** para el restaurante al
que pertenecen (todas son de `txoko`); no hay subconsulta por fila, que sobre 427
filas y subiendo importa; y el aislamiento que de verdad se pide —entre
restaurantes— se cumple igual.

**Qué pasa con las 58 durante y después:**

| Momento | Estado |
|---|---|
| Hoy | visibles para todos, incluido `anon` |
| Fases A–C | sin cambios: las políticas de `anon` siguen en pie |
| Tras C.4 | visibles para los autenticados de `txoko`, y para `service_role` |
| Tras D | ya no visibles para `anon`, porque `anon` no leerá `scores` |
| Después | **no se borran.** Si algún día se quiere reatar el historial, hace falta una columna `activo` en `employees` y recrear esas 4 fichas como inactivas. Es decisión de negocio, no técnica. |

Siguen contaminando el ranking igual que hoy —el cliente ya filtra por nombres
conocidos al pintarlo—, así que no hay regresión visible.

### C.6 — `employees`, por la decisión 2

Lectura limitada al propio restaurante y sólo a las columnas que el producto
necesita; escritura sólo sobre la fila propia.

```sql
-- SIN EJECUTAR
create policy employees_leer_mi_restaurante on public.employees
  for select to authenticated
  using ( venue = app.mi_venue() or auth_user_id = auth.uid() );

create policy employees_progreso_propio on public.employees
  for update to authenticated
  using      ( auth_user_id = auth.uid() )
  with check ( auth_user_id = auth.uid() );
```

**Sobre «mantener fuera de SELECT cualquier dato sensible»: ya está hecho, y no
por RLS.** RLS filtra filas, no columnas. Quien lo hace son los grants de
columna, que hoy dejan fuera `pin`, `auth_user_id`, `registered_at` y
`nda_signed_at`. Esos grants **no se tocan en ninguna fase**, y conviene decirlo
en voz alta porque son la pieza que sujeta cinco de tus requisitos.

**Y por eso no hace falta `ranking_publico` todavía**, que es lo que pedías
verificar: la columna sensible ya no sale. Haría falta sólo si se quisiera
esconder también el progreso de los compañeros entre sí, y eso no es un dato
sensible, es lo que el ranking enseña a propósito.

Escritura: la decisión «nunca modificar `role`, `venue`, `auth_user_id`, `pin`»
está cubierta **dos veces** —por grant de columna y por el disparador
`employees_identidad_inmutable`— y ahora una tercera, porque la política
restringe la fila. DELETE sigue sin política y sin grant.

## FASE D — Retirada progresiva de `anon`

Sólo cuando A, B y C estén verificadas en producción.

| D.1 | `revoke insert, select on public.actividad from anon;` |
| D.2 | Observar 24-48 h. |
| D.3 | `revoke insert, select on public.scores from anon;` |
| D.4 | Observar. |
| D.5 | Retirar los grants de columna de `anon` sobre `employees` y su política permisiva. |
| D.6 | Observar. |

**En D.5 es cuando los cuatro sin PIN dejan de poder usar el flujo autenticado**,
que es exactamente lo que aceptaste en la decisión 1. Sus datos siguen intactos y
visibles; lo que pierden es la capacidad de escribir, que ya no tenían desde el
momento en que se quedaron sin PIN.

**Rollback de cualquier paso de D:** `grant … to anon;`. Una sentencia, efecto
inmediato.

---

## Lo que sigue explícitamente fuera

- CORS de `sesion` (`*`) y `signOut({scope:'local'})`: **hardening posterior**, no
  se tocan ahora (decisión 7).
- `duels`, `notifications`, `chat_messages`, `push_subscriptions`: permiten DELETE
  a `anon`. Fase aparte.
- Las 15 funciones SECURITY DEFINER alcanzables desde `anon`.
- La fuga local de `DB.employees` en dispositivo compartido (L).
- La integridad de las evaluaciones: RLS dice de quién es un dato, no si es
  verdad.
- El borrado o rescate de las 58 huérfanas.

## Lo que hace falta decidir antes de la FASE B

Sólo una cosa, y es la de H.4: **`_beaconSync` manda el token que tenga (a), o se
retira (b).** Recomiendo (a). Todo lo demás de este documento queda cerrado por
tus siete decisiones.
