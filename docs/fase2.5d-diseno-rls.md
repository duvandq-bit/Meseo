# Fase 2.5D — Diseño de RLS e integridad de identidad

**Documento de diseño. No se ha ejecutado ninguna migración, ni cambiado ninguna
política, ni tocado ningún dato.** Todo lo que aparece aquí como SQL está para
revisarlo, no para lanzarlo.

Fecha de la auditoría: 15 de septiembre de 2026. Todo lo que se afirma aquí está
medido contra el proyecto `advkoujfgbrrjvqexrcu` en producción.

---

## A · Estado actual real

### A.0 · Tres correcciones a la premisa de partida

El encargo daba por hecho que «RLS todavía NO está activado». No es así, y la
diferencia cambia el plan entero.

**1 · RLS ya está activado en las 21 tablas de `public`.** Lo que pasa es que las
políticas son permisivas: `using (true)`, `with check (true)`. Encender RLS no es
el trabajo; **sustituir esas políticas lo es**. Diez tablas tienen RLS activo y
**cero políticas**, lo que significa que ya están completamente cerradas a
`anon` y `authenticated` — sólo `service_role`, que la salta por diseño, las ve:
`ai_usage`, `emp_pin_attempts`, `employee_recovery`, `nda_signatures`,
`password_resets`, `sup_pin_attempts`, `supervisor_pin_secret`,
`supervisor_pins`, `venue_code_attempts`, `venue_codes`.

**2 · `employees` ya está protegida por COLUMNA, y bastante bien.** No hay
permisos de tabla para `anon`/`authenticated`; hay permisos por columna:

| Operación | Columnas concedidas a anon/authenticated |
|---|---|
| SELECT | 21 de 25 — **no** `pin`, **no** `auth_user_id`, **no** `registered_at`, **no** `nda_signed_at` |
| INSERT / UPDATE | 17 — sólo progreso: `xp`, `streak`, `topic_scores`, `known_dishes`, `exam_correct`, `sessions_*`, `achievements`, `extras`, `avatar`, `txoko_record`, `duel_wins`, `last_*`, `name`, `updated_at` |
| DELETE | ninguna |

Es decir: **`role`, `venue`, `auth_user_id` y `pin` ya son inescribibles desde el
cliente**, y `pin` y `auth_user_id` son además ilegibles. Varios de los requisitos
del encargo (no cambiar rol, no cambiar restaurante, no cambiar `auth_user_id`)
**ya están cumplidos**, y no por RLS sino por los grants de columna. Conviene
saberlo para no «arreglar» lo que ya está arreglado y para no retirar sin querer
la protección que de verdad está sujetando esto.

**3 · Y sin embargo el agujero es grave, porque es de FILA, no de columna.**
Medido, no supuesto. Ejecutado como `anon` dentro de una transacción que aborta:

```
PRUEBA SIN EFECTO >> fichas legibles por anon: 22 |
ESCRITURA AJENA PERMITIDA: xp de Sol 2270 -> 999999
```

Con la clave pública que va en el HTML, cualquiera puede **leer las 22 fichas del
equipo** y **reescribir el progreso de cualquier compañero**. Eso es exactamente
lo que RLS tiene que cerrar. (Comprobado después: el XP de Sol sigue en 2270. La
transacción abortó.)

### A.1 · La pieza que falta y que nadie ha puesto todavía

**El cliente obtiene una sesión de Auth pero NO la usa para hablar con la base de
datos.** Las ~45 llamadas REST de `index.html` mandan todas:

```js
headers: { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}` }
```

`SUPA_KEY` es la clave anónima. Por tanto **`auth.uid()` es NULL en todas ellas**,
hoy y aunque la sesión exista. Cualquier política basada en `auth.uid()` que se
active ahora mismo **denegaría el 100 % de las peticiones del cliente**.

Ésta es la conclusión operativa más importante del documento: el primer paso no
es una política, es que el cliente mande su token.

### A.2 · Inventario de tablas

| Tabla | RLS | Políticas | Grants anon/auth | Identidad |
|---|---|---|---|---|
| `employees` | on | 3 (`true`) | por columna (arriba) | `name` (PK), `auth_user_id` (UNIQUE), `venue`, `role` |
| `scores` | on | 2 (`true`) | INSERT, SELECT | `employee` (texto), `venue` |
| `actividad` | on | 2 (`true`) | INSERT, SELECT | `employee` (texto), `venue` |
| `duels` | on | 1 `ALL` a anon | todo | `challenger`, `challenged`, `venue` |
| `notifications` | on | 1 `ALL` a anon | todo | `target` |
| `chat_messages` | on | 3 a PUBLIC | todo | `employee` (FK), `room` |
| `dish_photo_submissions` | on | 3 a PUBLIC | todo | — |
| `push_subscriptions` | on | 3 a anon | todo | `employee`, `endpoint` |
| `custom_dishes` | on | 1 SELECT | todo | `venue` |
| `horarios` | on | 1 SELECT | todo | `venue`, `week_start` |
| `live_sessions` | on | 1 `ALL` a anon | todo | — |
| `employee_recovery` | on | **0** | todo (inalcanzable: RLS sin política) | `employee_name`, `email` |
| 9 tablas de secretos y limitadores | on | **0** | sólo service_role | — |

### A.3 · Lo que NO tiene clave ajena, y por qué importa

```
scores.employee     → texto libre, SIN FK
actividad.employee  → texto libre, SIN FK
actividad.venue     → texto libre, SIN FK
```

Sí hay FK a `employees(name)` desde `chat_messages`, `nda_signatures`,
`employee_recovery` y `password_resets`.

Consecuencia medida: **58 de las 427 filas de `scores` pertenecen a 4 nombres que
ya no existen** en `employees`. Y consecuencia de diseño: hoy se puede insertar
una puntuación a nombre de cualquiera, exista o no.

### A.4 · Disparadores existentes

| Tabla | Disparador | Qué hace |
|---|---|---|
| `employees` | `employees_alta_con_codigo` (BEFORE INSERT) | el alta exige el código del restaurante |
| `employees` | `trg_admin_no_puntua` (BEFORE INS/UPD) | la cuenta de administración no acumula progreso |
| `employees` | `trg_employees_identidad_inmutable` (BEFORE UPDATE) | para `anon`/`authenticated`: prohíbe cambiar `name` y `auth_user_id` |
| `scores` | `trg_admin_sin_marcas` (BEFORE INSERT) | la cuenta de administración no deja puntuaciones |

### A.5 · Funciones SECURITY DEFINER alcanzables desde el cliente

Son la **superficie que RLS no cubre**: se ejecutan como su dueño y saltan las
políticas. Hoy hay 15 con EXECUTE para `anon`:

`employee_register`, `employee_set_display_name`, `employee_set_role`,
`employee_has_pin`, `username_available`, `nda_sign`, `save_rota`,
`set_employee_pin_sha`, `verify_employee_pin_sha`, `verify_supervisor_pin`,
`venue_code_rotate`, `venue_code_show`, `venue_pin_list`, `venue_pin_set`,
`venue_staff_list`.

Cuatro de ellas (`venue_pin_list`, `venue_pin_set`, `venue_staff_list`, y los dos
disparadores) tienen además EXECUTE para **PUBLIC**. Todas las sensibles están
protegidas por PIN dentro de la función, pero **ninguna mira `auth.uid()`**: la
autoridad es el PIN que llega por parámetro. Eso está fuera del alcance de esta
fase y se anota en «riesgos residuales».

Casi todas usan `search_path=public` en vez de `search_path=''`. Las cinco más
recientes (`_sup_pin_evaluar`, `_sup_pin_ip_directa`, `verify_supervisor_pin`,
`verify_supervisor_pin_srv`, `employees_identidad_inmutable`) ya usan `''`.

---

## B · Modelo de confianza

**Una sola fuente de identidad: `auth.uid()`.**

```
PIN correcto → Edge Function `sesion` → sesión de Auth → JWT con sub = auth.uid()
                                                              │
                                    employees.auth_user_id ───┘   (UNIQUE, ilegible
                                                                   e inescribible
                                                                   desde el cliente)
                                             │
                        ┌────────────────────┼────────────────────┐
                     nombre                venue                 rol
                 (identidad en           (aislamiento          (autorización
                  scores/actividad)       entre restaurantes)    futura)
```

Reglas, en orden de importancia:

1. **Nada que venga del cuerpo de la petición decide quién eres.** Ni
   `employee`, ni `venue`, ni `employee_id`, ni `currentUser`. El servidor
   resuelve las tres cosas desde `auth.uid()`.
2. **El rol NUNCA sale del token.** Sale de `employees.role`. El token se crea
   deliberadamente sin reclamaciones de autoridad y `sesion` v6 rechaza con 502
   cualquier sesión que las traiga. Comprobado hoy en las dos cuentas que han
   entrado: `reclamaciones_de_autoridad = false` en ambas.
3. **El nombre es la clave de negocio; el `uid` es la identidad.** `scores` y
   `actividad` se relacionan por nombre porque así nacieron, pero quién eres lo
   dice el `uid`. La traducción `uid → nombre` la hace el servidor.
4. **`service_role` está fuera de RLS por diseño**, y sólo lo usan las Edge
   Functions. Ninguna clave de servicio viaja al navegador.
5. **RLS responde «de quién es este dato», no «es este dato verdad».** Las
   puntuaciones las sigue calculando el cliente. Eso no lo arregla ninguna
   política; se anota como riesgo residual explícito.

---

## C · Matriz tabla × rol × operación

`E` = empleado autenticado (el propio). `O` = otro empleado. `V` = otro
restaurante. `S` = supervisor (futuro). `A` = owner/admin (futuro).
`SR` = service_role.

### employees

| Operación | E (propia) | O (misma venue) | V | S | A | SR |
|---|---|---|---|---|---|---|
| SELECT columnas de progreso | ✅ | ✅ sólo las públicas (ranking) | ❌ | ✅ su venue | ✅ todas | ✅ |
| SELECT `pin`, `auth_user_id` | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| INSERT | ❌ (sólo por RPC de alta) | ❌ | ❌ | ❌ | ❌ | ✅ |
| UPDATE progreso | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ |
| UPDATE `role`/`venue`/`auth_user_id`/`pin` | ❌ | ❌ | ❌ | ❌ | ❌ (por RPC) | ✅ |
| UPDATE `name` | ❌ (disparador) | ❌ | ❌ | ❌ | ❌ (por RPC) | ✅ |
| DELETE | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |

### scores

| Operación | E | O | V | S | A | SR |
|---|---|---|---|---|---|---|
| SELECT propias | ✅ | — | — | ✅ su venue | ✅ | ✅ |
| SELECT de compañeros | ✅ sólo agregado para el ranking | — | ❌ | ✅ | ✅ | ✅ |
| INSERT a su nombre | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ |
| INSERT a nombre de otro | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| UPDATE | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| DELETE | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |

### actividad

| Operación | E | O | V | S | A | SR |
|---|---|---|---|---|---|---|
| SELECT propia | ✅ | — | — | ✅ su venue | ✅ | ✅ |
| SELECT de otro | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ |
| INSERT a su nombre | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ |
| UPDATE / DELETE | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |

### employee_recovery

Sin políticas y con RLS activo: **nadie salvo `service_role`**. Ya es correcto;
no se toca.

---

## D · Políticas propuestas (SQL, SIN EJECUTAR)

### D.0 · Nota sobre `actividad` y el sello de restaurante

Hoy el cliente manda `venue` en el cuerpo (`_vSello()` lo pone desde
`_venueActual()`, que sale de `localStorage`). **Eso no puede seguir así**: es un
campo de aislamiento decidido por el cliente. La política lo exige igual al del
empleado, y el cliente deja de mandarlo (ver sección F).

### D.1 · actividad — la primera, por ser la más fácil

Cero filas, tabla nueva, sólo INSERT y SELECT. Si algo sale mal, no hay historial
que perder.

```sql
-- SIN EJECUTAR
drop policy if exists actividad_insert on public.actividad;
drop policy if exists actividad_select on public.actividad;

-- Sólo se puede anotar actividad a nombre propio, y con el restaurante que
-- dice la ficha, no el que diga el cliente.
create policy actividad_alta_propia on public.actividad
  for insert to authenticated
  with check ( employee = app.mi_nombre() and venue = app.mi_venue() );

-- Y sólo se lee la propia. El agregado del equipo, si algún día hace falta,
-- saldrá de una vista o un RPC, no de abrir esta tabla.
create policy actividad_leer_propia on public.actividad
  for select to authenticated
  using ( employee = app.mi_nombre() );

-- Sin UPDATE ni DELETE: el histórico no se reescribe.
revoke insert, select on public.actividad from anon;
```

### D.2 · scores

```sql
-- SIN EJECUTAR
drop policy if exists insert_scores on public.scores;
drop policy if exists read_scores   on public.scores;

create policy scores_alta_propia on public.scores
  for insert to authenticated
  with check ( employee = app.mi_nombre() and venue = app.mi_venue() );

-- Leer: las propias siempre; las del equipo sólo del mismo restaurante y sólo
-- porque el ranking las necesita. Las 58 filas huérfanas (empleados borrados)
-- dejan de ser visibles para todo el mundo salvo service_role, que es lo que
-- corresponde: no son de nadie.
create policy scores_leer_de_mi_restaurante on public.scores
  for select to authenticated
  using ( venue = app.mi_venue()
          and exists (select 1 from public.employees e
                      where e.name = scores.employee and e.venue = scores.venue) );

revoke insert, select on public.scores from anon;
-- UPDATE y DELETE ya estaban revocados desde la fase 2.5A. No se devuelven.
```

### D.3 · employees — la difícil

```sql
-- SIN EJECUTAR
drop policy if exists employees_leer     on public.employees;
drop policy if exists employees_progreso on public.employees;
-- employees_alta se queda: el INSERT lo gobierna el disparador del código de
-- restaurante y el alta real va por `employee_register` (SECURITY DEFINER).

-- Leer: la ficha propia entera (de las columnas concedidas), y de los
-- compañeros del mismo restaurante sólo lo que el ranking enseña. La
-- separación fina de columnas NO la hace RLS —RLS es por fila—: la hacen los
-- grants de columna, que ya están puestos y no se tocan.
create policy employees_leer_mi_restaurante on public.employees
  for select to authenticated
  using ( auth_user_id = auth.uid() or venue = app.mi_venue() );

-- Escribir: sólo la fila propia. Las columnas sensibles ya son inescribibles
-- por grant, y el disparador de identidad inmutable sigue cubriendo `name` y
-- `auth_user_id` por si alguien devolviera el grant algún día.
create policy employees_progreso_propio on public.employees
  for update to authenticated
  using      ( auth_user_id = auth.uid() )
  with check ( auth_user_id = auth.uid() );

-- Sin política de DELETE: nadie borra por la API.
```

**Aviso importante sobre esta política.** `venue = app.mi_venue()` mantiene
visible a todo el restaurante, que es lo que el ranking, los duelos, el chat y el
panel de supervisor necesitan hoy. **No cumple el requisito literal «nunca puede
leer otro employee»**, y no lo cumple a propósito: cumplirlo rompería cuatro
funcionalidades. Está desarrollado en la sección L y es una de las dos decisiones
que hay que tomar antes de implementar nada.

### D.4 · Las tablas que el encargo no nombra pero comparten el problema

`duels`, `notifications`, `chat_messages`, `push_subscriptions` tienen hoy
políticas `true` para `anon` y permisos completos, incluido **DELETE**. Un
anónimo puede borrar mensajes del chat y notificaciones de cualquiera. No entran
en esta fase, pero quedan anotadas: cerrarlas es una fase 2.5E.

---

## E · Funciones SECURITY DEFINER propuestas (SQL, SIN EJECUTAR)

Sólo dos, y las dos existen por una razón concreta.

**Por qué hacen falta.** Las políticas de `scores` y `actividad` necesitan
traducir `auth.uid()` a nombre y a restaurante, y esa traducción vive en
`employees`, que estará bajo RLS. Resolverla con una subconsulta directa dentro
de cada política significa: (a) que la subconsulta queda sujeta a la política de
`employees`, con riesgo de recursión; (b) que se evalúa **por cada fila**
comprobada, sobre 427 puntuaciones y subiendo. Una función `stable` se evalúa una
vez por sentencia.

**Por qué son seguras.** No aceptan argumentos —no hay nada que manipular—, leen
una sola fila por `auth_user_id`, y no pueden devolver la de otro porque
`auth.uid()` lo pone el servidor a partir de la firma del JWT.

```sql
-- SIN EJECUTAR
-- El esquema `app` ya existe desde la fase 2.5B-1.

create or replace function app.mi_nombre()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select e.name from public.employees e where e.auth_user_id = auth.uid()
$$;

create or replace function app.mi_venue()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select e.venue from public.employees e where e.auth_user_id = auth.uid()
$$;

revoke all     on function app.mi_nombre() from public, anon;
revoke all     on function app.mi_venue()  from public, anon;
grant  execute on function app.mi_nombre() to authenticated, service_role;
grant  execute on function app.mi_venue()  to authenticated, service_role;
```

Sin sesión, las dos devuelven `NULL`, y `columna = NULL` es `NULL`, que no es
`true`: **una petición anónima no pasa ninguna política**. El fallo cierra, no
abre.

No propongo ninguna otra función DEFINER. En particular, **no** hace falta una
para «comprobar si soy supervisor»: ese rol no existe todavía como rol operativo.

---

## F · Cambios necesarios en el cliente

### F.1 · El cambio que lo condiciona todo: mandar el token

Hoy: `Authorization: Bearer ${SUPA_KEY}` en las ~45 llamadas.
Hace falta: el `access_token` de la sesión cuando la haya, y la clave anónima
cuando no.

Un solo punto de cambio, un ayudante que devuelva las cabeceras:

```js
// BOCETO — no implementado
async function _cab(extra){
  let t = SUPA_KEY;
  try{
    const c = _getAuthClient();
    if(c){ const { data } = await c.auth.getSession(); if(data?.session?.access_token) t = data.session.access_token; }
  }catch(_){}
  return Object.assign({ 'apikey': SUPA_KEY, 'Authorization': 'Bearer ' + t }, extra || {});
}
```

Mientras las políticas sigan siendo `true`, este cambio **no altera ningún
comportamiento**: es exactamente el paso 1 de la transición, y es medible (se
puede contar cuántas peticiones llegan como `authenticated`).

### F.2 · Tabla de llamadas, una por una

| # | Tabla | Op | Identidad hoy | ¿Funciona con `authenticated`? | Política que hace falta | Riesgo | Cambio en el cliente |
|---|---|---|---|---|---|---|---|
| 1 | `actividad` (2361) | INSERT | `employee: currentUser`, `venue` del cliente | sí | `actividad_alta_propia` | **alto**: identidad y venue los pone el cliente | quitar `employee` y `venue` del cuerpo; el servidor los pone por DEFAULT o los valida |
| 2 | `scores` (2803, 2853, 2912) | INSERT | `employee` del cliente | sí | `scores_alta_propia` | **alto**: igual | ídem |
| 3 | `scores` (2826, 2870, 2927, 24960) | SELECT ranking | filtra por `venue` en la URL | sí | `scores_leer_de_mi_restaurante` | medio | ninguno; el filtro deja de ser necesario |
| 4 | `employees` (32625) `supaUpsertEmployee` | UPSERT | `name` del cliente | **NO tal cual** | `employees_progreso_propio` | **alto** | el upsert por `on_conflict=name` deja de valer: hay que hacer UPDATE de la fila propia |
| 5 | `employees` (3093, 3486, 24572) | SELECT ficha | por nombre | sí | `employees_leer_mi_restaurante` | bajo | ninguno |
| 6 | `employees` (3587, 32651, 2872) | SELECT ranking | por venue | sí | ídem | medio | ninguno |
| 7 | `employees` (3457) | SELECT lista de nombres | por venue | sí | ídem | bajo | ninguno |
| 8 | `employees` (3133, 3994) | INSERT/PATCH | por nombre | **NO** | — | alto | debe ir por RPC (`employee_register` ya existe) |
| 9 | `employees` (10121) | SELECT `nda_version` | por nombre | sí | ídem | bajo | ninguno |
| 10 | `_beaconSync` (32612) | UPSERT al cerrar | `keepalive`, sin sesión garantizada | **NO** | — | **alto** | al descargarse la página puede no haber token fresco; hay que decidir (ver L) |
| 11 | `duels`, `notifications`, `chat_messages`, `push_subscriptions`, `custom_dishes`, `horarios`, `dish_photo_submissions` | varias | anon | sí (siguen permisivas) | fuera de esta fase | — | ninguno ahora |
| 12 | RPCs (`verify_employee_pin_sha`, `employee_has_pin`, `set_employee_pin_sha`, `save_rota`, `verify_supervisor_pin`) | — | SECURITY DEFINER, saltan RLS | sí, sin cambios | — | medio | ninguno |

### F.3 · `registrarActividad()` — contrato actual vs. contrato compatible

Hoy manda `{ employee: currentUser, venue: _venueActual(), activity, competency,
kind, score, total, seconds, meta }`. Los dos primeros son de identidad y los
pone el cliente. **Incompatible con el modelo de confianza**, aunque la política
`with check` lo bloquearía: el cliente se llevaría un 403 y la actividad se
perdería en silencio (hoy el error se traga a propósito).

Dos caminos, y la elección es tuya:

- **(a) DEFAULT en el servidor.** `alter table actividad alter column employee
  set default app.mi_nombre()`, ídem `venue`, y el cliente deja de mandarlos.
  Sencillo, sin código nuevo, y el cliente no puede mentir porque el campo no
  viaja. Requiere un `alter table`, que es un cambio de esquema.
- **(b) Una Edge Function `registrar`.** Más control, pero añade una función,
  latencia y otra superficie que mantener, para algo que una política ya
  resuelve.

**Recomiendo (a).** Es menos código, menos superficie y la garantía la da el
mismo sitio que la comprueba.

---

## G · Orden de migración

La secuencia propuesta en el encargo (A→F) es razonable pero le falta el
principio y tiene el final en el sitio correcto por el motivo equivocado.
Corregida:

| Paso | Qué | Reversible | Por qué en este orden |
|---|---|---|---|
| **0** | **El cliente manda el token** (F.1). Sin políticas nuevas. | sí, es un despliegue | Sin esto `auth.uid()` es NULL y cualquier política de identidad deniega todo. Es el paso que falta y nadie ha dado. |
| **1** | **Medir.** Contar en los registros qué porcentaje de peticiones llega como `authenticated`. | — | Si no llega el ~100 %, activar una política deja gente fuera. Los 4 sin PIN nunca llegarán: ver L. |
| **2** | Crear `app.mi_nombre()` y `app.mi_venue()`. | `drop function` | No cambian nada por sí solas. |
| **3** | `actividad`: DEFAULT en servidor + políticas nuevas + el cliente deja de mandar identidad. | sí | Cero filas. Si rompe, no se pierde historial. |
| **4** | Pruebas negativas sobre `actividad` (sección K). | — | |
| **5** | `scores`: políticas nuevas. | sí | Sólo INSERT y SELECT; UPDATE/DELETE ya no existen. |
| **6** | Pruebas negativas sobre `scores`. | — | |
| **7** | `employees`: rediseñar `supaUpsertEmployee` (UPDATE de la fila propia) y `_beaconSync`, luego políticas. | sí, pero es el paso caro | Es el que toca el sincronizado de progreso de todo el equipo. |
| **8** | Pruebas negativas sobre `employees`. | — | |
| **9** | Retirar los grants de `anon` en las tres tablas. | sí (`grant` de vuelta) | **Al final, no antes**: mientras quede un solo dispositivo con la versión vieja en caché, `anon` es su único camino. |

Entre el paso 0 y el 9 la aplicación funciona en todo momento. Ningún paso deja
al equipo fuera si el siguiente se retrasa.

---

## H · Rollback

Cada paso tiene su vuelta atrás, y todas son una sentencia:

| Paso | Deshacer |
|---|---|
| 0 | desplegar la versión anterior de `index.html` |
| 2 | `drop function app.mi_nombre(); drop function app.mi_venue();` |
| 3, 5, 7 | `drop policy <nueva>` + `create policy <la vieja> ... using (true)` — el SQL exacto queda guardado en el fichero de la migración |
| 3 | `alter table public.actividad alter column employee drop default;` |
| 9 | `grant insert, select on public.actividad to anon;` etc. |

**Rollback de emergencia completo**, si algo deja al equipo sin poder trabajar en
mitad de un servicio:

```sql
-- SIN EJECUTAR — sólo para tenerlo escrito de antemano
create policy emergencia_todo on public.actividad for all to anon, authenticated
  using (true) with check (true);
```

Repetido por tabla. Devuelve el comportamiento de hoy en segundos.

---

## I · Threat model

Ana es una empleada real con sesión válida. `E` = comportamiento esperado
**después** de la migración.

| # | Ataque | Hoy | Defensa propuesta | Dónde la para | Esperado |
|---|---|---|---|---|---|
| T1 | Ana cambia `currentUser` a `Duvan` en memoria y sincroniza | **funciona: pisa el progreso de Duvan** | la fila se elige por `auth.uid()`, no por nombre | `employees_progreso_propio` | 0 filas afectadas (PostgREST 200 con cero filas, o 403 con `return=representation`) |
| T2 | Ana cambia `_venueActual()` a otro restaurante | **funciona: lee y escribe fuera de su sitio** | `venue = app.mi_venue()` | políticas de `scores`/`actividad`, lectura de `employees` | 42501 en escritura; cero filas en lectura |
| T3 | Ana manda `employee: 'Duvan'` en un score | **funciona** | `with check (employee = app.mi_nombre())` | `scores_alta_propia` | **42501** |
| T4 | Ana manda `auth_user_id` de Duvan | ya falla | sin grant de columna + disparador | grants + `employees_identidad_inmutable` | 42501 `identidad_no_editable` |
| T5 | Ana modifica `role` | ya falla | sin grant de columna | grants | 42501 |
| T6 | Ana modifica `venue` | ya falla | sin grant de columna | grants | 42501 |
| T7 | Ana actualiza o borra un score de Duvan | ya falla (2.5A) | sin grant UPDATE/DELETE | grants | 42501 |
| T8 | Ana inserta actividad a nombre de Duvan | **funciona** | `with check` + DEFAULT servidor | `actividad_alta_propia` | **42501** |
| T9 | Ana lee la actividad de Duvan | **funciona** | `using (employee = app.mi_nombre())` | `actividad_leer_propia` | cero filas |
| T10 | Ana llama a REST a mano con la clave pública | **funciona con todo lo anterior** | `anon` pierde los grants (paso 9) | grants | 42501 |
| T11 | Ana llama a un RPC directamente | funciona, y **seguirá funcionando** | las DEFINER están protegidas por PIN, no por RLS | dentro de cada función | fuera de alcance; ver L |
| T12 | Ana autenticada intenta actuar como Duvan | **funciona** | toda la sección D | políticas | 42501 / cero filas |
| T13 | Ana manipula el JWT | ya falla | firma HS256 verificada por GoTrue | Supabase | 401 |
| T14 | Empleada dada de baja | **no existe el concepto** | — | — | ver L: hoy no hay «baja» |
| T15 | Sesión expirada | el token dura 1 h y se renueva solo | `auth.uid()` NULL → ninguna política pasa | políticas | 401, y el cliente cae al camino anónimo mientras quede |

---

## J · Tests positivos

Ejecutables en `tests/smoke.mjs` contra la lógica, y en SQL contra la base con
`set local role authenticated` + `set_config('request.jwt.claims', ...)` dentro de
una transacción que aborta.

1. Ana autenticada inserta una actividad a su nombre → 1 fila.
2. Ana lee su propia actividad → sus filas, y sólo las suyas.
3. Ana inserta un score a su nombre → 1 fila.
4. Ana ve el ranking de su restaurante → las filas de sus compañeros.
5. Ana actualiza su propio XP → 1 fila.
6. Ana lee su propia ficha → 1 fila, sin `pin` ni `auth_user_id`.
7. La cuenta de administración sigue sin dejar rastro (disparadores).
8. `service_role` sigue pudiendo todo (provisioning, `sesion`, `manage-content`).
9. Las 427 puntuaciones históricas siguen ahí (`select count(*)` como
   `service_role`).
10. El login completo sigue funcionando sin sesión de Auth (respaldo).

## K · Tests negativos y mutaciones

Cada defensa se rompe a propósito y la prueba que la protege tiene que caer.

| Prueba | Mutación que debe tumbarla |
|---|---|
| T3 bloqueado | quitar `employee = app.mi_nombre()` del `with check` |
| T8 bloqueado | ídem en `actividad` |
| T2 bloqueado | quitar `venue = app.mi_venue()` |
| T1 bloqueado | cambiar `auth_user_id = auth.uid()` por `true` |
| T9 bloqueado | cambiar el `using` de `actividad` por `true` |
| sin sesión no se pasa | hacer que `app.mi_nombre()` devuelva un literal en vez de NULL |
| T10 bloqueado | devolver el `grant` a `anon` |

Y las pruebas de no-regresión que ya existen: **372 en la suite**, más las 25 del
navegador, tienen que seguir verdes.

---

## L · Riesgos residuales y decisiones pendientes

### L.1 · Los 4 empleados sin PIN nunca tendrán sesión

Gabriel, María, Monica y Sheila no tienen PIN, luego no pueden obtener sesión,
luego `auth.uid()` será NULL para ellos **siempre**. En cuanto se retire el grant
de `anon` (paso 9), **dejan de poder usar la aplicación**.

No lo arreglo por mi cuenta. Opciones: ponerles PIN antes del paso 9, o aceptar
que quedan fuera. **Hay que decidirlo antes de empezar.**

### L.2 · `employees` legible por todo el restaurante

La política propuesta permite leer las fichas de los compañeros del mismo
restaurante. **Incumple el requisito literal del encargo.** Si se cumple al pie de
la letra (`auth_user_id = auth.uid()` a secas), se rompen:

- el **ranking** y el podio (3587, 32651, 2872),
- los **duelos** (lista de rivales, 3457),
- el **chat** (lista de menciones),
- el **panel de supervisor**.

Alternativa si quieres el aislamiento estricto: una **vista** `ranking_publico`
con sólo `name, avatar, xp, streak, txoko_record, venue`, con
`security_invoker = off`, y que el cliente lea de ahí. Es más trabajo y más
código de cliente, pero es la única forma de tener las dos cosas.

**Decisión pendiente.**

### L.3 · `_beaconSync` al cerrar la página

Usa `keepalive` para sincronizar mientras la pestaña se muere. Obtener un token
fresco en ese momento no está garantizado. Si falla, se pierde el progreso de esa
sesión. Hay que decidir si se mantiene con `anon` como excepción (y entonces el
agujero de T1 sigue abierto por esa rendija) o si se acepta perder el sincronizado
de última hora. **No tengo una respuesta buena todavía.**

### L.4 · La cola offline lleva nombres, no identidades

`_outbox` guarda **nombres de empleado**, y al recuperar la conexión llama a
`supaUpsertEmployee(name)`. Bajo RLS, si la cola tiene pendiente a Ana y quien
está autenticado es Bruno, el UPDATE afectará a **cero filas** y el progreso de
Ana **se pierde en silencio** — el error ya se traga a propósito.

Diseño propuesto (sin implementar): que cada entrada de la cola guarde el `uid`
de la sesión que la creó y que el envío sólo se intente cuando el `uid` activo
coincida; si no, se queda esperando a que esa persona vuelva a entrar. El cliente
no puede cambiar ese `uid` porque no lo escribe él: sale de la sesión.

### L.5 · Dispositivo compartido

Al cambiar de empleado hoy: `logout()` borra `txoko_session`, llama a
`_authSesionSalir()` (que borra el token de los dos sitios y cancela peticiones en
vuelo) y `currentUser = null`. Lo que **no** se limpia es `DB.employees`, que
sigue en `localStorage` con las fichas de todos los que han entrado en ese móvil.
Bajo RLS eso deja de ser un problema de servidor —nadie puede escribir la ficha de
otro— pero sigue siendo una fuga local: el progreso de Ana es legible en el móvil
de barra después de que se vaya. **Fuera de alcance de esta fase, anotado.**

### L.6 · Las puntuaciones las sigue calculando el cliente

RLS garantiza que un score lleva el nombre de quien lo envía. **No garantiza que
sea verdad.** Ana puede mandarse un 10/10 sin hacer el examen. Cerrarlo exige
corregir en el servidor, que es la fase de integridad de evaluación que ya está
en la lista y no es ésta.

### L.7 · No existe el concepto de «empleado dado de baja» (T14)

No hay columna `activo`. Dar de baja hoy es borrar la ficha, y eso deja
puntuaciones huérfanas — de ahí las 58 actuales. Si se quiere T14, hace falta esa
columna y `and e.activo` en las políticas. **Fuera de alcance, anotado.**

### L.8 · Las 15 funciones DEFINER alcanzables desde `anon`

Saltan RLS por definición. Su autoridad es el PIN que reciben por parámetro, no
`auth.uid()`. RLS no las toca. Revisarlas una a una es una fase propia.

### L.9 · Hardening posterior, ya identificado

- **CORS de `sesion` es `*`.** Ahora que devuelve tokens, acotarlo a `meseo.es`.
- **`signOut({scope:'local'})` no revoca la sesión en el servidor.** Las 4 sesiones
  de Duvan siguen vivas pese a los logouts. Decidir si se pasa a `global`.
- **`search_path=public`** en ~20 funciones DEFINER, en vez de `''`.
- **`verify_supervisor_pin`** (la que llama el cliente) sigue con EXECUTE para
  `anon` y con el limitador por IP del navegador, que fue justo lo que se
  demostró que se puede repartir entre IPs. La versión buena
  (`verify_supervisor_pin_srv`) sólo la usa la Edge Function.
- **`duels`, `notifications`, `chat_messages`, `push_subscriptions`** permiten
  DELETE a `anon`.

### L.10 · Recovery

El flujo de recuperación por correo (`reset-pin`, `employee_recovery`,
`password_resets`) va entero por Edge Functions con `service_role`, y
`employee_recovery` ya está cerrada con RLS sin políticas. **No entra en
conflicto con nada de lo propuesto.** La única condición es que siga sin
depender de `auth.uid()`: quien ha perdido el PIN no tiene sesión, por
definición.

---

## M · Qué queda deliberadamente fuera

- Supervisor como rol operativo. Se reserva el sitio en la matriz y nada más.
- Owner/admin: hoy `role` ya distingue `owner`, `admin` y `staff`, pero ninguna
  política lo usa. No se añade hasta que haga falta.
- Las siete tablas del punto D.4.
- La integridad de las evaluaciones (corregir en servidor).
- El borrado de las 58 puntuaciones huérfanas: con la política propuesta dejan de
  ser visibles, que es suficiente. Borrarlas es una decisión de negocio.
- La fuga local de `DB.employees` en dispositivo compartido.
- Todo el hardening de L.9.

---

## Resumen para decidir

**Tres cosas hay que responder antes de escribir una sola migración:**

1. **Los 4 sin PIN** (L.1): ¿se les pone PIN, o se acepta que queden fuera?
2. **Lectura del equipo** (L.2): ¿se acepta que un empleado vea las fichas de su
   restaurante —y el ranking siga funcionando—, o se va a aislamiento estricto
   con una vista nueva y cambios de cliente?
3. **`_beaconSync`** (L.3): ¿se mantiene la rendija anónima al cerrar la página, o
   se acepta perder el sincronizado de última hora?

Y una advertencia de la que depende todo lo demás: **el paso 0 no es opcional ni
es un detalle**. Mientras el cliente mande la clave anónima en todas sus
peticiones, cualquier política basada en `auth.uid()` deja al equipo fuera de la
aplicación en el primer servicio.
