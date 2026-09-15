# Fase 2.5B — Diseño definitivo de identidad, sesión y RLS

**Documento de diseño. No se ha implementado nada.** Ni migraciones, ni
`ALTER TABLE`, ni cambios de RLS, ni de Auth, ni Edge Functions, ni cliente, ni
`localStorage`, ni offline, ni interfaz. Lo único escrito es este documento.

Meseo v7.448, después de la Fase 2.5A. Continúa
`docs/fase2.5-diseno-autenticacion.md`, que sigue siendo válido en lo general;
esto lo concreta y **corrige dos cosas** que allí quedaron mal medidas.

---

## 1 · Diagnóstico actualizado

### Lo que cerró la 2.5A

| Tabla | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `employees` | ✅ | ✅ | ⚠️ **abierto** | ✅ cerrado |
| `scores` | ✅ | ✅ | ✅ cerrado | ✅ cerrado |
| `actividad` | ✅ | ✅ | ✅ cerrado | ✅ cerrado |

Queda **una sola puerta de escritura sin control de identidad**: el UPDATE de
`employees`. Y dos de lectura sin aislamiento: cualquiera lee las 22 fichas y
las 427 puntuaciones, de cualquier restaurante.

### Dos correcciones a lo que informé antes

**1. Sí hay un `owner`.** En el informe de la 2.5 escribí «0 supervisores».
Busqué `role = 'supervisor'`, y ese valor no existe en este sistema: el
vocabulario real es `staff | admin | manager | owner`. El reparto de verdad es:

| Rol | Cuántos | Sin PIN |
|---|---|---|
| `staff` | 20 | 4 |
| `owner` | 1 | 0 |
| `admin` | 1 | 0 |

Eso **simplifica el apartado 13**: no hay que crear el primer supervisor desde
cero, ya existe.

**2. Hay 58 puntuaciones huérfanas.** 58 de las 427 filas de `scores` apuntan a
4 nombres que ya no están en `employees` — secuela de los 15 borrados
históricos por SQL. No es un problema nuevo, pero **la migración tiene que
tenerlo previsto** o esas filas se quedan sin poder vincular.

### Un hallazgo bueno

`employees` tiene `employees_name_ci_unique` sobre `lower(name)`: **no puede
haber dos empleados que sólo se diferencien en mayúsculas**, y hoy no hay
ninguno. La vinculación por nombre es, por tanto, inequívoca.

---

## 2 · Matriz de columnas de `employees`

Medido columna a columna sobre los permisos reales del rol `anon`, y contrastado
con el `INSERT ... ON CONFLICT` que PostgREST ha ejecutado de verdad
(100 095 llamadas registradas).

| Columna | `anon` puede modificar | La app la modifica | ¿Debe poder desde el cliente? |
|---|---|---|---|
| `name` *(clave primaria)* | 🔴 **SÍ** | sí, en el `SET` del upsert | **NO** — es la identidad |
| `venue` | ✅ no | no | **NO** — es la pertenencia |
| `role` | ✅ no | no | **NO** — son los permisos |
| `pin` | ✅ no (ni leer) | no | **NO** — es la credencial |
| `display_name` | ✅ no | no (va por RPC) | no |
| `registered_at` | ✅ no | no | no |
| `nda_signed_at` | ✅ no (ni leer) | no | no |
| `nda_version` | ✅ no | no | no |
| `xp` | 🟡 sí | **sí** | sí, **pero sólo la suya** |
| `streak` | 🟡 sí | **sí** | sí, sólo la suya |
| `last_study_day` | 🟡 sí | **sí** | sí, sólo la suya |
| `topic_scores` | 🟡 sí | **sí** | sí, sólo la suya |
| `known_dishes` | 🟡 sí | **sí** | sí, sólo la suya |
| `exam_correct` | 🟡 sí | **sí** | sí, sólo la suya |
| `sessions_count` / `sessions_data` | 🟡 sí | **sí** | sí, sólo la suya |
| `txoko_record` | 🟡 sí | **sí** | sí, sólo la suya |
| `duel_wins` | 🟡 sí | **sí** | sí, sólo la suya |
| `achievements` | 🟡 sí | **sí** | sí, sólo la suya |
| `avatar` | 🟡 sí | **sí** | sí, sólo la suya |
| `extras` | 🟡 sí | **sí** | sí, sólo la suya — **ojo, ver abajo** |
| `last_login` | 🟡 sí | **sí** | sí, sólo la suya |
| `last_active_at` | 🟡 sí | no (lo pone SQL) | no |
| `updated_at` | 🟡 sí | **sí** | sí, sólo la suya |

### Respuesta directa a la pregunta crítica

**`role` y `venue` NO son modificables por `anon`.** Ya estaban cerrados a nivel
de columna desde `permisos_columnas_empleados.sql`. Eso es una buena noticia y
acota mucho el problema: **nadie puede ascenderse ni cambiarse de restaurante
escribiendo en la tabla.**

Lo que **sí** está abierto, y es lo que hay que cerrar:

1. **`name`, la clave primaria.** Se puede renombrar a cualquiera. Como
   `scores.employee` y `actividad.employee` son texto sin clave ajena, un
   renombrado parte el histórico en silencio — y el índice único por
   `lower(name)` significa que renombrar a alguien *con el nombre de otro*
   falla, pero renombrar a alguien a un nombre libre funciona.
2. **El progreso de cualquiera, no sólo el propio.** Se puede inflar o poner a
   cero el XP, la racha y los logros de un compañero.
3. **`extras`, que es el peor de los tres.** Dentro viaja `ab`, la mejor marca
   del Simulacro de alérgenos, y `ps`, las estadísticas del Pase — **y el panel
   del supervisor las lee**. Es decir: hoy se puede escribir que un compañero
   saca 100 % en alérgenos sin que haya hecho el simulacro nunca. De todo lo que
   queda abierto, esto es lo único que puede acabar en una decisión de seguridad
   alimentaria.

**Ninguna de las tres se puede cerrar con permisos de columna**, porque las tres
usan las mismas columnas que el guardado legítimo. Se cierran sabiendo **de
quién** es la fila, y eso es identidad. Es exactamente lo que justifica esta
fase.

---

## 3 · El registro público de Supabase Auth

### Lo que se puede determinar desde la base de datos

| Pregunta | Respuesta | Evidencia |
|---|---|---|
| ¿Hubo alta pública? | **Sí, al menos el 2026-07-20** | existe una cuenta que nadie del equipo creó, con `provider: email` |
| ¿Se exige confirmar el correo? | **Sí** | la cuenta lleva 54 días con `email_confirmed_at` nulo y un `confirmation_token` pendiente. Con autoconfirmación estaría confirmada |
| ¿Una cuenta sin confirmar obtiene sesión? | **No** | 0 sesiones, 0 refrescos, `last_sign_in_at` nulo |
| ¿Qué camino permite el alta? | `POST /auth/v1/signup` de GoTrue, con la clave anon | es el endpoint estándar; no hay ninguna Edge Function de registro |
| ¿Hay más cuentas sospechosas? | **No. Sólo esa.** | 1 usuario, 1 identidad, 0 MFA, 0 SSO, 0 clientes OAuth |
| ¿Hay Edge Functions de registro o auth? | **No** | las 6 son de otra cosa (ver abajo) |

### Lo que NO se puede determinar desde la base de datos

**Si el registro está habilitado *ahora*.** La configuración de GoTrue no vive
en Postgres: es configuración de plataforma. Hay que mirarla en el panel. No lo
he hecho porque supondría tocar la configuración de Auth, y eso está fuera de
esta fase.

### Las seis Edge Functions, ninguna de auth

| Función | `verify_jwt` | Cómo se protege |
|---|---|---|
| `manage-content` | **false** | verifica el **PIN de supervisor** por RPC, con `service_role` |
| `reset-pin` | **false** | exige el **hash del PIN actual** como prueba de identidad |
| `send-push` | false | — |
| `check-inactive` | false | — |
| `leer-horario` | true | — |
| `mesa-infinita` | true | — |

Dos apuntes que importan para el diseño:

- **`manage-content` ya es, exactamente, el patrón que propongo**: recibe un
  PIN, lo verifica en el servidor reutilizando la RPC que ya existe, y sólo
  entonces actúa con `service_role`. La función de sesión es ese mismo patrón
  aplicado a `verify_employee_pin_sha`. **No estoy inventando una arquitectura:
  estoy extendiendo una que ya está en la casa y funcionando.**
- `verify_jwt: true` en las otras dos **no** significa «hace falta un usuario».
  La clave anon ya es un JWT válido del proyecto. No es una protección de
  identidad.

### Qué debe cambiarse (en la implementación, no ahora)

1. **Desactivar el alta pública**: panel → Authentication → Sign In / Providers
   → *Allow new users to sign up* = off. Meseo nunca necesitará que un visitante
   se registre solo: las cuentas las crea `employee_register` con el código del
   restaurante.
2. **Mantener la confirmación de correo activada**, aunque el diseño use correos
   sintéticos que nunca se envían — para eso las creará `service_role`, que
   confirma directamente.
3. **Activar la protección de contraseñas filtradas** (hoy desactivada, lo avisa
   el propio Supabase).
4. Y lo del apartado siguiente.

---

## 4 · La cuenta desconocida

```
id             e0bfce7b-2387-4a2c-bda5-4c7bf09ae3ee
email          mass_advkoujf_60306@ues.edu.pl
creada         2026-07-20 15:11:46 UTC      confirmada   NO
accesos        NINGUNO       sesiones  0    refrescos    0
app_metadata   {"provider":"email","providers":["email"]}        ← limpio
user_metadata  {"role":"admin","is_admin":true,"email_verified":false}   ← plantado
pendiente      confirmation_token de hace 54 días
coincide con   ningún empleado
```

**No es un alta accidental. Es una sonda de escalada de privilegios.**

Quien se registró puso `"role":"admin"` e `"is_admin":true` en
`raw_user_meta_data`, que es **el único campo que el que se registra controla**.
`app_metadata` quedó limpio porque GoTrue no deja escribirlo desde el alta. El
patrón es conocido: registrarse en masa contra proyectos con el alta abierta
plantando una reclamación de administrador, por si la aplicación —o alguna
política de RLS— lee el rol del token.

**Hoy no puede hacer nada**: nunca confirmó el correo, no tiene sesión, y el rol
`authenticated` tiene los mismos permisos que `anon`, que no incluyen nada
sensible.

**Pero es una advertencia con nombre y apellidos sobre esta fase.** En cuanto
`authenticated` reciba permisos, cualquier cuenta que se registre sola pasa a
tenerlos. Y si alguna política leyera
`auth.jwt() -> 'user_metadata' ->> 'role'`, esta cuenta sería administradora el
mismo día. De ahí la regla del apartado 7.

Qué hacer en la implementación (no ahora): **cerrar el alta pública primero**,
luego revisar la cuenta y bloquearla o eliminarla, y sólo después dar permisos a
`authenticated`. Ese orden no es negociable.

Nota menor: el dominio `ues.edu.pl` es de una universidad real. No hay forma de
saber desde aquí si quien lo usó controla ese buzón. Mientras el alta esté
abierta y el token siga pendiente, la posibilidad de que alguien lo confirme
existe; con el alta cerrada y la cuenta eliminada, deja de existir.

---

## 5 · Arquitectura recomendada

```
┌── NAVEGADOR ────────────────────────────────────────────────────┐
│  el empleado teclea su PIN                                       │
│  SHA-256(pin + sal) ─ igual que hoy, el PIN nunca sale en claro   │
└───────────────────────┬──────────────────────────────────────────┘
                        │  { nombre, sha }
                        ▼
┌── EDGE FUNCTION «sesion» ────────────────── service_role ────────┐
│  1. verify_employee_pin_sha(nombre, sha)   ← el limitador intacto│
│  2. lee employees: venue y role  ← NUNCA del cliente             │
│  3. asegura la cuenta de Auth del empleado (la crea si falta)    │
│  4. inicia sesión con la contraseña de servicio (que sólo        │
│     conoce el servidor) y devuelve los tokens                    │
└───────────────────────┬──────────────────────────────────────────┘
                        │  { access_token (~1 h), refresh_token }
                        ▼
┌── NAVEGADOR ────────────────────────────────────────────────────┐
│  Authorization: Bearer <access_token>   en TODA petición         │
└───────────────────────┬──────────────────────────────────────────┘
                        ▼
┌── POSTGREST + RLS ──────────────────────────────────────────────┐
│  auth.uid() → employees.auth_user_id → name, venue, role         │
│  el cliente sólo PIDE la operación; el servidor decide           │
└──────────────────────────────────────────────────────────────────┘
```

**Por qué ésta y no otra**, en una frase: es la única que no tira nada. El PIN
verificado en servidor, el limitador de 10 intentos, el alta con código del
restaurante, `employee_register`, los triggers de la cuenta de administración y
las RPC del supervisor **siguen exactamente igual**. Lo único que se añade es
que, al final de una comprobación que ya existe, se entrega un token.

Las alternativas descartadas y sus motivos están en el documento anterior
(apartado 5). Nada de lo medido después las rehabilita.

---

## 6 · Flujo de sesión

### El camino feliz

| # | Paso | Dónde | Detalle |
|---|---|---|---|
| 1 | El empleado teclea el PIN | cliente | pantalla de siempre, sin cambios visibles |
| 2 | `SHA-256(pin + sal)` | cliente | como hoy; el PIN en claro no sale del móvil |
| 3 | `POST /functions/v1/sesion` | red | `{ nombre, sha }` |
| 4 | `verify_employee_pin_sha` | servidor | **misma RPC, mismo limitador de 10 intentos** |
| 5 | Se determina el empleado | servidor | de `employees.name`, por el índice único |
| 6 | Se determina el restaurante | servidor | de `employees.venue` — jamás del cliente |
| 7 | Se determina el rol | servidor | de `employees.role` — jamás del token |
| 8 | Se emite la sesión | servidor | tokens de GoTrue, reales |
| 9 | El cliente guarda **sólo el refresco** | cliente | el token de acceso, en memoria |
| 10 | RLS decide | base de datos | `auth.uid()` → ficha → permisos |

### Los parámetros, y por qué

| Parámetro | Valor propuesto | Razón |
|---|---|---|
| Token de acceso | **1 hora** | si se roba, caduca solo |
| Token de refresco | **30 días**, deslizante | un camarero no debería teclear el PIN cada semana |
| Rotación del refresco | **sí** | detecta el robo: si se usa dos veces, se invalida la familia |
| Renovación | al arrancar y ~5 min antes de caducar | invisible |
| Cierre de sesión | revoca el refresco **en el servidor** | hoy «salir» sólo borra una clave local |

Compárese con lo de hoy: `txoko_session` dura **90 días deslizantes**, no se
puede revocar desde ningún sitio, y contiene un valor que vale como PIN.

### Los casos que no son el camino feliz

| Situación | Qué pasa |
|---|---|
| **PIN incorrecto** | igual que hoy: `verify_employee_pin_sha` devuelve falso, y su limitador cuenta el fallo |
| **Bloqueo (10 fallos / 15 min)** | la función de sesión **no** emite nada y devuelve el bloqueo. El limitador vive donde ya vive |
| **Empleado sin PIN** (hay 4) | la RPC devuelve `null` → se fija el PIN como hoy (`set_employee_pin_sha`) y luego se emite sesión |
| **Sesión caducada con red** | se refresca en silencio; si el refresco también caducó, se pide el PIN una vez |
| **Sesión caducada sin red** | **no se echa a nadie.** Se sigue entrenando y escribiendo a la cola; se resuelve al volver |
| **Sin red al entrar** | si hay refresco válido guardado, se entra en modo local con lo que ya estaba en su cajón. Si no hay refresco, no se puede verificar a nadie: se ofrece sólo el contenido público (la carta, las fichas), sin progreso |
| **Cambio de empleado** | cierre real: se revoca el refresco, se purga el cajón, se vuelve a la lista de nombres |

Sobre «sin red al entrar»: es la única degradación frente a hoy, porque hoy el
auto-login es local y funciona siempre. Es el precio de que el auto-login local
sea también el agujero. La mitigación es el refresco de 30 días: quien usó la
aplicación en el último mes entra igual.

---

## 7 · Modelo de identidad

```
auth.users.id  (uuid, lo emite GoTrue)
      │  1:1
      ▼
employees.auth_user_id  ← columna nueva, UNIQUE
      │
      ├── employees.name    ← sigue siendo la clave primaria
      ├── employees.venue   ← pertenencia. Server-side. Ya cerrada a anon
      └── employees.role    ← permisos. Server-side. Ya cerrada a anon
```

**De dónde saca el servidor cada cosa, sin excepción:**

| Dato | Origen | Nunca de |
|---|---|---|
| quién eres | `auth.uid()` del token firmado | `currentUser`, el cuerpo, `localStorage` |
| tu nombre | `employees.name` donde `auth_user_id = auth.uid()` | el cuerpo de la petición |
| tu restaurante | `employees.venue` de esa misma fila | `txk_venue`, el cuerpo |
| tu rol | `employees.role` de esa misma fila | **`user_metadata`**, `app_metadata`, el cuerpo |

### La regla que la cuenta desconocida obliga a escribir

> **El rol y el restaurante se leen SIEMPRE de la tabla `employees`, nunca de
> ninguna reclamación del token.** Ni de `user_metadata` (lo controla quien se
> registra) ni de `app_metadata` (no lo controla, pero quedaría rancio y sería
> una segunda fuente de verdad).

Tiene además una ventaja práctica: si a alguien se le cambia el rol, el cambio
vale en la petición siguiente, no cuando le caduque el token.

### Los ayudantes

```sql
create schema if not exists app;      -- fuera de la API expuesta

create or replace function app.emp_actual() returns text
  language sql stable security definer
  set search_path = ''                -- ← pinchado a vacío, ver abajo
as $$ select e.name from public.employees e where e.auth_user_id = auth.uid() $$;

-- y análogas: app.venue_actual(), app.rol_actual(), app.es_supervisor()
```

**Sobre `SECURITY DEFINER`, `search_path` y la escalada de privilegios** — que
es lo que se pregunta y con razón:

1. **`set search_path = ''` y todo cualificado** (`public.employees`,
   `auth.uid()`). Sin fijarlo, quien pueda crear objetos en un esquema que vaya
   antes en la ruta puede poner ahí una tabla o una función que suplante a la
   que la función llama — y se ejecutaría **con los privilegios del dueño**. Las
   funciones que ya existen en este proyecto usan `set search_path to 'public',
   'extensions'`, que es aceptable pero más flojo; las nuevas van a vacío.
2. **`revoke execute from public` y conceder sólo a `authenticated`.** Por
   defecto Postgres concede `EXECUTE` a `PUBLIC`, y ése es el motivo de los 17
   avisos que da hoy el propio Supabase.
3. **Que hagan una sola cosa y no reciban nada.** Estos ayudantes **no toman
   parámetros**: leen `auth.uid()`. Una función definer sin parámetros no se
   puede engañar con lo que se le pasa.
4. **`stable`, no `volatile`**, para que el planificador la evalúe una vez por
   consulta, y en las políticas se escriben como `(select app.emp_actual())`
   para forzar ese plan. Con 22 empleados da igual; con 200 y el panel del
   supervisor leyendo miles de filas, no.
5. **El esquema `app` no se expone en la API**, así que no son invocables por
   REST aunque alguien conozca el nombre.

---

## 8 · RLS propuesto

### `employees` — la que arregla el agujero que queda

```sql
-- LEER: la propia, y las del mismo restaurante (el ranking las necesita).
create policy employees_leer on public.employees for select to authenticated
using (
  auth_user_id = auth.uid()
  or venue = (select app.venue_actual())
);

-- ESCRIBIR PROGRESO: sólo la propia fila, y sólo puede seguir siendo la propia.
create policy employees_progreso on public.employees for update to authenticated
using      ( auth_user_id = auth.uid() )
with check ( auth_user_id = auth.uid() );

-- ALTA: sigue siendo exclusiva de employee_register (el trigger ya lo impone).
create policy employees_alta on public.employees for insert to authenticated
with check (true);

-- BORRAR: ninguna política. Cerrado desde la 2.5A.
```

Esto resuelve **las tres cosas que quedaban abiertas** sin tocar la forma en que
el cliente escribe:

- **El upsert sigue funcionando tal cual.** El `WITH CHECK` no impide
  `name = EXCLUDED.name` cuando el nombre es el suyo: es un no-op.
- **Renombrar a otro deja de ser posible**: el `USING` no encuentra su fila.
- **Renombrarse a sí mismo a otro nombre** tampoco: `auth_user_id` sigue siendo
  el suyo, pero el índice único por `lower(name)` y —sobre todo— la revocación
  del permiso de columna `name` (que ahora **sí se puede hacer**, ver §9) lo
  cierran del todo.
- **Escribir el `extras` de un compañero** —la marca de alérgenos falsa— deja de
  ser posible.

### `actividad`

```sql
create policy actividad_leer on public.actividad for select to authenticated
using (
  employee = (select app.emp_actual())
  or ( (select app.es_supervisor()) and venue = (select app.venue_actual()) )
);

create policy actividad_crear on public.actividad for insert to authenticated
with check (
  employee = (select app.emp_actual())
  and venue = (select app.venue_actual())
);

-- UPDATE y DELETE: ninguna política. Un registro de lo que pasó no se edita.
```

**Y el cinturón, además del tirante:** un trigger `BEFORE INSERT` que
**sobrescribe** `employee` y `venue` con los de la sesión en vez de comprobarlos.

```sql
create or replace function public.actividad_sella() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  new.employee := app.emp_actual();
  new.venue    := app.venue_actual();
  if new.employee is null then raise exception 'sin_sesion'; end if;
  new.created_at := now();
  return new;
end $$;
```

La diferencia importa: con el `WITH CHECK` a secas, una petición con `employee`
ajeno **se rechaza** (y un cliente viejo dejaría de funcionar); con el trigger,
**se ignora y se escribe la verdad**.

### `scores`

```sql
create policy scores_leer on public.scores for select to authenticated
using ( employee = (select app.emp_actual()) or venue = (select app.venue_actual()) );

create policy scores_crear on public.scores for insert to authenticated
with check ( employee = (select app.emp_actual()) and venue = (select app.venue_actual()) );
-- UPDATE / DELETE: ya cerrados en la 2.5A.
```

Con el mismo trigger de sellado, por el mismo motivo.

### Tablas relevantes para el supervisor

| Tabla | Política propuesta |
|---|---|
| `duels` | hoy es CRUD abierto a `anon`. Leer: los del propio restaurante. Crear: sólo si eres uno de los dos duelistas. Modificar: sólo tu propio resultado |
| `chat_messages` | leer y escribir sólo en el propio restaurante; escribir sólo a tu nombre |
| `horarios` | leer el propio restaurante; escribir sigue siendo de `save_rota` (RPC con PIN) |
| `nda_signatures`, `venue_codes`, `supervisor_pins`, `*_attempts` | **no se tocan**: ya están cerradas sin política, que es como deben estar |

`duels` y `chat_messages` no son de esta fase, pero conviene que queden
apuntadas: cuando `anon` deje de tener permisos, hay que dárselos a
`authenticated` **con** predicado, no sin él.

---

## 9 · `employees` y el progreso

Es el punto delicado, porque hay que conservar `supaUpsertEmployee` funcionando.

### La solución recomendada: RLS, sin cambiar la forma de escribir

**Con las políticas del apartado anterior, el cliente no cambia su manera de
guardar.** Sigue enviando el mismo `POST` con `Prefer: resolution=merge-
duplicates`; lo único que cambia es la cabecera `Authorization`. RLS decide
**qué fila** puede tocar; los permisos de columna ya decidían **qué columnas**.

Y una vez hay identidad, **sí se puede revocar `UPDATE(name)`** — lo que en la
2.5A era imposible. Requiere un cambio mínimo en el cliente: dejar de mandar
`name` en el cuerpo del upsert y usar la fila que RLS ya ha seleccionado. Es una
línea, y va en la fase 2.5B-4.

### La alternativa más fuerte, y por qué NO la recomiendo ahora

Un RPC `guardar_progreso(p jsonb)` `SECURITY DEFINER` que hiciera la fusión
monótona **en el servidor** (que el XP sólo pueda subir, que los logros sólo se
añadan). Es estrictamente más seguro: impediría que alguien se ponga 99 999 XP
**a sí mismo**.

No lo recomiendo **en esta fase** por tres razones:

1. Duplicaría en SQL una lógica de fusión de 60 líneas que ya existe, está
   probada y es delicada (mezcla mapas, une logros, respeta lo que hay en la
   nube).
2. Obliga a reescribir el camino de guardado entero de golpe: mucho más riesgo
   por una ganancia que **no es de identidad, sino de integridad**.
3. Es el mismo problema que el de la puntuación (§11) y debe resolverse con él,
   en una fase propia y pensada, no de refilón.

**Decisión propuesta: RLS ahora, RPC de fusión monótona en la fase de
integridad.** Con RLS, lo peor que puede hacer alguien es mentir sobre sí mismo.
Hoy puede mentir sobre cualquiera, que es otra cosa.

### Comparativa de mecanismos, para que quede el criterio

| Mecanismo | Sirve para | Coste | ¿Ahora? |
|---|---|---|---|
| **RLS** | que sólo toques tu fila | bajo, no cambia el cliente | **sí** |
| Permisos de columna | que no toques `role`/`venue`/`pin` | ya hecho | ya está |
| **Trigger de sellado** | que el cuerpo no decida la identidad | bajo | **sí**, en `actividad` y `scores` |
| RPC `SECURITY DEFINER` | que el servidor imponga *cómo* cambia el dato | alto | no, fase de integridad |
| Edge Function | lo que necesita secretos (la sesión) | medio | **sí**, sólo para la sesión |

---

## 10 · `registrarActividad()`

| Campo | Hoy | Después | Quién manda |
|---|---|---|---|
| `employee` | `currentUser` del navegador | **de la sesión** | servidor (trigger) |
| `venue` | `localStorage.txk_venue` | **de `employees.venue`** | servidor (trigger) |
| `created_at` | `now()` de la BD | `now()`, forzado | servidor |
| `activity` | cliente | cliente | cliente |
| `competency` | cliente | cliente, validado por CHECK | cliente + CHECK |
| `kind` | cliente | cliente, validado por CHECK | cliente + CHECK |
| `score` / `total` | cliente | cliente, validado por CHECK | cliente — **ver §12** |
| `seconds` | cliente | cliente | cliente |
| `meta` | cliente | cliente | cliente |
| `client_id` | — | **nuevo**, del cliente | cliente (idempotencia) |
| `occurred_at` | — | **nuevo**, del cliente | cliente (orden offline) |

Forma futura, sin implementar:

```js
body: JSON.stringify({
  client_id: a.clientId,          // nace con el evento y sobrevive a los reintentos
  occurred_at: a.cuando,          // cuándo dice el móvil que pasó
  activity: a.activity, competency, kind, score, total, seconds,
  meta: a.meta || null
})
// y la cabecera deja de llevar la clave anon:
'Authorization': `Bearer ${sesion.access_token}`
```

`employee` y `venue` **desaparecen del cuerpo**. No es que se validen: es que ya
no se envían, y si un cliente viejo los enviara, el trigger los pisaría.

---

## 11 · Offline

### El escenario que se pide, resuelto paso a paso

```
1. Ana entra.                      sesión de Ana, uid = A
2. Trabaja sin red.                5 actividades → cola   meseo:cola:A
                                   cada evento: { client_id, occurred_at, datos }
                                   ← SIN employee, SIN venue: no existen ahí
3. Ana cierra sesión.              se revoca su refresco y se purga su CAJÓN.
                                   Su COLA NO se borra: queda cifrada bajo A,
                                   y se avisa: «te quedan 5 por enviar».
4. Carlos entra.                   sesión de Carlos, uid = C
5. Vuelve la red.                  el sincronizador busca  meseo:cola:C
                                   La cola de Ana es meseo:cola:A → NO SE MIRA.
                                   ⇒ las 5 actividades de Ana NO se envían,
                                     y es imposible que se atribuyan a Carlos.
6. Ana vuelve a entrar (cualquier día, cualquier aparato con esa cola).
                                   se vacía su cola; el servidor pone employee y
                                   venue desde SU sesión.
```

**La clave está en el paso 2**: el evento **no guarda a quién pertenece**. La
pertenencia es el nombre del cajón donde está, y el cajón se abre con la sesión.
Manipular la cola no puede cambiar de dueño a un evento, porque el campo no
existe; y moverlo de cajón no sirve, porque al enviarlo el servidor lo sella con
la sesión de quien lo envía.

### La estructura

```
meseo:cola:<auth_user_id>  →  [
  { client_id: "uuid-v4",           // nace con el evento
    occurred_at: "2026-09-12T19:40:11Z",
    activity, competency, kind, score, total, seconds, meta },
  …
]
```

| Asunto | Diseño |
|---|---|
| **Identidad del evento** | ninguna. La da el cajón + la sesión al enviar |
| **Idempotencia** | índice único `(employee, client_id)`; el servidor descarta repetidos |
| **Reintentos** | con espera creciente; reintentar es seguro por lo anterior |
| **Conflicto** | no hay: la actividad no se edita, sólo se añade. Un repetido se ignora |
| **Caducidad** | 30 días. Lo más viejo se descarta avisando, no en silencio |
| **Cierre de sesión** | la cola **se conserva**; el cajón de datos se purga |
| **Cambio de usuario** | sólo se vacía la cola cuyo nombre casa con la sesión |
| **Sesión caducada** | se sigue encolando; al volver se refresca y se vacía |
| **Aparato compartido** | cada cola con su nombre; nunca se cruzan |

### El detalle de las fechas, que es el que se suele estropear

Una actividad hecha el lunes sin cobertura y enviada el viernes **no puede
llegar con fecha del viernes**: rompería la racha, el plan de Hoy y cualquier
estadística. Pero el reloj del móvil tampoco es de fiar.

Solución: se guardan **las dos**. `created_at` lo pone el servidor (cuándo
llegó, indiscutible) y `occurred_at` lo dice el cliente (cuándo pasó, útil pero
no fiable), **acotado** por el servidor a `[created_at − 30 días, created_at]`
para que un reloj adelantado no meta actividad en el futuro. Las estadísticas
usan `occurred_at`; la auditoría, `created_at`.

---

## 12 · Dispositivos compartidos

| Almacén | Hoy | Después | Qué es |
|---|---|---|---|
| `DB` en `localStorage` | **un blob con TODO el equipo** | una clave por empleado: `meseo:v1:<uid>` | caché |
| `txoko_session` | `{user, hash del PIN}`, 90 días | **desaparece** | — |
| refresco | no existe | sí, revocable | **credencial** |
| token de acceso | no existe | **sólo en memoria** | credencial |
| `currentUser` | **fuente de verdad** | espejo de la sesión | caché de interfaz |
| `txk_venue` | **fuente de verdad** | espejo de `employees.venue` | sólo colores |
| `txoko_last_user` | nombre | se queda | comodidad |
| cola offline | conjunto de nombres | una por empleado | datos pendientes |
| SRS, plan de Hoy | dentro del blob común | dentro del cajón del empleado | caché |
| IndexedDB | mapas de imágenes | igual | sin datos personales |
| caché del *service worker* | estático y datos públicos | igual, **nunca respuestas con `Authorization`** | — |

**Al cerrar sesión**: se revoca el refresco en el servidor, se purga el cajón de
quien sale y se vuelve a la lista de nombres. La cola pendiente **se conserva**
(§11): perder el trabajo de alguien por cambiar de turno sería peor que el
riesgo que evita borrarlo.

**Modo quiosco** para el iPad de sala (opcional, decisión del propietario):
sesión corta, sin recordar, cierre por inactividad a los N minutos.

---

## 13 · Supervisor

**Corrección**: ya hay **1 `owner`** y **1 `admin`**. No hay que crear el primer
supervisor desde cero, y el riesgo de «dejar al administrador fuera» se reduce a
vincular bien esa cuenta.

### Cómo conviven las dos cosas

```
2.5B-2 a 2.5B-4    el panel abre con el PIN, EXACTAMENTE COMO HOY.
                   La sesión existe en paralelo pero no manda todavía.

2.5B-5             el panel abre con CUALQUIERA de las dos:
                     · PIN correcto (camino de siempre), o
                     · rol owner/manager en la sesión
                   Nadie se queda fuera en ningún momento.

2.5B-7             el panel abre por ROL. El PIN pasa a SEGUNDO FACTOR de lo
                   irreversible: cambiar roles, rotar el código del
                   restaurante, cambiar PINes, dar de baja.
```

El PIN **no desaparece**. Cambia de papel: de «ser el supervisor» a «confirmar
que eres tú quien hace algo que no se puede deshacer», que es una protección
razonable contra un aparato desbloqueado sobre la barra. Y desde 2.5B-7 cada
acción queda atribuida a **una persona**, no a «alguien que sabía el PIN».

### Cómo se asigna el rol con seguridad

Con lo que ya existe: `employee_set_role(p_pin, p_name, p_role)`, que exige el
PIN de supervisor, exige ámbito `'*'` (sólo el propietario), valida el
vocabulario y **protege al último `owner`** para que nadie pueda dejar la casa
sin mando. No hay que construir nada.

### La regla, por escrito

> **Los permisos no se derivan JAMÁS de `user_metadata`, `is_admin`, ni de
> ninguna reclamación del token.** Sólo de `employees.role`, leído de la tabla en
> cada petición.

La cuenta del apartado 4 es la prueba de por qué.

---

## 14 · Puntuaciones: autenticación ≠ integridad

Hay que decirlo sin ambigüedad, porque es fácil dar por resuelto lo que no lo
está:

| Pregunta | ¿Lo resuelve la 2.5B? |
|---|---|
| **¿Quién eres?** | **Sí, del todo.** |
| **¿De qué restaurante?** | **Sí, del todo.** |
| **¿Qué permisos tienes?** | **Sí, del todo.** |
| **¿Es cierta la nota que dices haber sacado?** | **No. En absoluto.** |

Después de la 2.5B, un empleado con conocimientos técnicos podrá seguir
enviando «he sacado 10 de 10» sin haber contestado nada. Lo que **no** podrá es
enviarlo **a nombre de otro**, ni en otro restaurante, ni borrarlo después.

Eso es una mejora real —hoy puede falsear el progreso de un compañero— pero **no
convierte la nota en un dato fiable**. Si el panel del supervisor (fase 3) o las
asignaciones (fase 4) toman decisiones sobre personas con esos números, hay que
saberlo antes, no después.

**Lo que haría falta, en una fase propia de integridad de evaluación:**

1. El servidor genera la sesión de examen y **guarda la plantilla de respuestas**
   sin enviarla al cliente.
2. El cliente envía las **respuestas**, no la nota.
3. El servidor corrige y escribe la nota. El cliente nunca la propone.
4. Con eso caen de paso los límites de tiempo y los reintentos infinitos.

Es un rediseño de los exámenes, no un ajuste de permisos, y choca de frente con
que hoy **todo funciona sin conexión**. Por eso va en su propia fase y con su
propia decisión: probablemente sólo para las evaluaciones que cuenten
formalmente (alérgenos, LQA), dejando la práctica como está.

---

## 15 · Migración del histórico

**Nada se borra y nada se reconstruye.**

### Lo que hay

| | Cuántos | Observación |
|---|---|---|
| Empleados | 22 | 20 staff, 1 owner, 1 admin; 4 sin PIN |
| Duplicados por mayúsculas | **0** | el índice único lo impide |
| Puntuaciones | 427 | de las cuales **58 huérfanas**, de 4 nombres borrados |
| Actividad | 0 | la fase 1 aún no está en producción |
| Restaurantes | 1 (`txoko`) | M.B. llegará |

### El plan

**Paso 1 — Preparar, sin tocar a nadie.** `employees.auth_user_id uuid unique`,
nulo al principio. Nada lo usa.

**Paso 2 — Crear las cuentas.** Un trabajo con `service_role` crea 22 cuentas de
Auth, una por ficha:

```
email     <slug del nombre>@<venue>.meseo.invalid     ← dominio reservado: no
                                                        existe y no se puede
                                                        enviar correo a él
password  32 bytes aleatorios, guardados en una tabla cerrada a anon
confirmed sí, la crea service_role: no hay correo que confirmar
metadata  VACÍO. Ni rol, ni nada. El rol vive en employees.role
```

**Paso 3 — Vincular.** `employees.auth_user_id` con el id correspondiente. Es la
única escritura sobre las fichas, y no toca ni progreso ni rol ni restaurante.

**Paso 4 — Los empleados no se enteran.** La próxima vez que Ana entre con su
PIN de siempre, la función de sesión lo verifica **como hoy** y le devuelve una
sesión. **Sin correos, sin contraseñas, sin migración visible.** Es el requisito
más importante de todo el apartado.

### Los casos incómodos

| Caso | Qué se hace |
|---|---|
| **58 puntuaciones huérfanas** | **se quedan.** Son historia del restaurante. Quedan legibles por el supervisor de `txoko` vía `venue`, y sin empleado que las reclame. No se inventa una ficha para ellas |
| **4 empleados sin PIN** | lo fijan en su primera entrada, con el camino que ya existe |
| **Empleado que se va** | baja lógica (`activo = false`), nunca borrado. Su histórico es del restaurante |
| **Renombrar a alguien** | sólo por RPC de supervisor, y **moviendo `scores.employee` y `actividad.employee` en la misma transacción** |
| **La cuenta desconocida de Auth** | **no se vincula a nadie.** Se cierra el alta y se elimina, antes de dar permisos a `authenticated` |
| **M.B. cuando llegue** | ya funciona: `employee_register` deriva el restaurante del código, y las políticas filtran por `venue` |

---

## 16 · Modelo de amenazas actualizado

| # | Amenaza | Hoy (tras 2.5A) | Tras 2.5B | Qué lo bloquea |
|---|---|---|---|---|
| 1 | Manipular `localStorage` para ser otro | 🔴 sí | ✅ no | la identidad viene de un token firmado |
| 2 | Cambiar `employee` en el cuerpo | 🔴 sí | ✅ no | el trigger lo sobrescribe |
| 3 | Cambiar `venue` en el cuerpo | 🔴 sí | ✅ no | ídem |
| 4 | Cambiar `role` | ✅ ya no | ✅ no | permiso de columna + rol leído de la tabla |
| 5 | Crear cuentas de Auth a voluntad | 🔴 sí | ✅ no | se cierra el alta pública |
| 6 | `user_metadata` falso (`is_admin`) | 🟡 inerte | ✅ no | **ninguna política lee el token para el rol** |
| 7 | REST directo con la clave pública | 🔴 sí | ✅ no | `anon` se queda sin permisos de escritura |
| 8 | DevTools | 🔴 sí | ✅ no | el cliente deja de ser autoridad |
| 9 | **Escribir el progreso de un compañero** | 🔴 **sí** | ✅ no | RLS por fila |
| 10 | **Falsear la marca de alérgenos de otro** (`extras`) | 🔴 **sí** | ✅ no | ídem — el peor de todos |
| 11 | **Renombrar a un empleado** | 🔴 **sí** | ✅ no | RLS + revocar `UPDATE(name)` |
| 12 | Leer otro restaurante | 🔴 sí | ✅ no | `venue = app.venue_actual()` |
| 13 | Repetir (replay) una petición | 🟡 duplica | ✅ no | `client_id` único |
| 14 | Sesión robada | 🔴 90 días, irrevocable | 🟡 1 h, refresco revocable | caducidad + rotación |
| 15 | Aparato compartido | 🔴 todo visible | ✅ no | cajón por empleado, purga al salir |
| 16 | Manipular la cola offline | 🔴 sí | ✅ no | la cola no guarda identidad |
| 17 | Sesión caducada | n/a | ✅ definido | se encola; se resuelve al volver |
| 18 | Borrar empleados o puntuaciones | ✅ ya no | ✅ no | cerrado en la 2.5A |
| 19 | **Falsear la propia nota** | 🔴 sí | 🔴 **SIGUE** | ninguna. Fase de integridad |
| 20 | **Robar el hash del PIN de `localStorage`** | 🔴 sí | ✅ no | `txoko_session` desaparece |

**Diecisiete de veinte se cierran.** La 14 se mitiga. **La 19 no se toca, y es
deliberado** (§14).

---

## 17 · Plan de implementación

---

**2.5B-0 · Cerrar el alta de Auth** *(antes que nada)*

- **Cambios**: desactivar el registro público; revisar y eliminar la cuenta
  desconocida; activar la protección de contraseñas filtradas.
- **Riesgo**: **muy bajo**. Nada usa Auth hoy.
- **Rollback**: volver a activarlo.
- **Tests**: que un alta contra `/auth/v1/signup` sea rechazada.
- **Depende de**: nada. **Es el primer paso, y es obligatorio**: dar permisos a
  `authenticated` con el alta abierta sería peor que no hacer nada.

---

**2.5B-1 · Identidad en el modelo**

- **Cambios**: `employees.auth_user_id` (nulo); tabla de contraseñas de servicio
  (cerrada); esquema `app` y los cuatro ayudantes.
- **Riesgo**: bajo. Nada lo usa todavía.
- **Rollback**: `drop column`, `drop schema`. El cliente no se entera.
- **Tests**: los ayudantes devuelven nulo sin sesión, y lo correcto con ella
  (suplantando `request.jwt.claims`).
- **Depende de**: 2.5B-0.

---

**2.5B-2 · La Edge Function de sesión**

- **Cambios**: función `sesion`; crear y vincular las 22 cuentas.
- **Riesgo**: bajo-medio. Existe, pero el cliente aún no la llama.
- **Rollback**: retirar la función; las cuentas quedan inertes.
- **Tests**: PIN bueno → sesión; PIN malo → nada; **el limitador de 10 sigue
  mordiendo**; empleado sin PIN → camino de migración; las 22 vinculadas.
- **Depende de**: 2.5B-1.

---

**2.5B-3 · El cliente obtiene la sesión (sin exigirla)**

- **Cambios**: al validar el PIN, canjear por sesión; guardar el refresco;
  renovar. **Las políticas siguen permisivas**: si algo falla, todo sigue
  funcionando.
- **Riesgo**: **medio** — primera fase que toca el camino de entrada.
- **Rollback**: dejar de canjear. Una condición.
- **Tests**: entrar, salir, recargar, sin red, caducidad, aparato compartido.
- **Depende de**: 2.5B-2.

---

**2.5B-4 · RLS estricto**

- **Cambios**: las políticas del §8; los triggers de sellado; revocar a `anon`;
  revocar `UPDATE(name)`; quitar `name` del cuerpo del upsert.
- **Riesgo**: **alto**. Es la fase que puede dejar a alguien sin guardar
  progreso. Hacerla **por tablas**: `actividad` (0 filas, riesgo mínimo) →
  `scores` → `employees`.
- **Rollback**: volver a las políticas permisivas y reconceder. Un guion
  preparado **de antemano**, no improvisado.
- **Tests**: toda la batería negativa del §19.
- **Depende de**: 2.5B-3 en uso real **varios días**.

---

**2.5B-5 · Supervisor con las dos llaves**

- **Cambios**: el panel acepta PIN **o** rol. Nada deja de funcionar.
- **Riesgo**: bajo.
- **Rollback**: quitar la comprobación por rol.
- **Depende de**: 2.5B-4.

---

**2.5B-6 · Offline y aparatos compartidos**

- **Cambios**: cola por empleado, `client_id`, `occurred_at`, cajón por
  empleado, purga al salir.
- **Riesgo**: **medio-alto**: aquí es donde se pierde trabajo si se hace mal.
- **Rollback**: volver al envío directo sin cola (se pierde lo pendiente: hay
  que vaciarla **antes** de revertir).
- **Tests**: §19 D, con la red cortada de verdad.
- **Depende de**: 2.5B-4.

---

**2.5B-7 · Retirar la confianza local**

- **Cambios**: fuera `txoko_session` y el auto-login local; `currentUser` y
  `txk_venue` pasan a espejo; el panel abre por rol; el PIN pasa a segundo
  factor.
- **Riesgo**: medio. Es el punto de no retorno.
- **Rollback**: el último posible; después, sólo hacia adelante.
- **Depende de**: todo lo anterior, en uso y sin incidencias.

---

**2.5B-8 · Pruebas de seguridad**

- La batería del §19 completa, **más las mutaciones**: romper a propósito cada
  política y comprobar que la prueba correspondiente se pone en rojo. Una
  política que no se ha visto denegar nada no está probada.

---

## 18 · Rollback

| Fase | Cómo se deshace | ¿Se pierde algo? |
|---|---|---|
| 2.5B-0 | reactivar el alta | no |
| 2.5B-1 | `drop column` / `drop schema` | no |
| 2.5B-2 | retirar la función | no (las cuentas quedan inertes) |
| 2.5B-3 | dejar de canjear la sesión | no |
| 2.5B-4 | guion de reversión de políticas y permisos, **escrito antes** | no |
| 2.5B-5 | quitar la comprobación por rol | no |
| 2.5B-6 | **vaciar la cola primero**, luego revertir | sí, si se revierte con cola llena |
| 2.5B-7 | punto de no retorno práctico | — |

Regla: **de la 2.5B-1 a la 2.5B-5, cada fase se puede deshacer sola y en
minutos.** De la 2.5B-6 en adelante, hay que vaciar antes de revertir.

---

## 19 · Batería de pruebas

Las de RLS se ejecutan contra la base suplantando la sesión, que es como se
comprueban de verdad:

```sql
set local role authenticated;
set local request.jwt.claims = '{"sub":"<uuid de Ana>"}';
```

**Ninguna prueba que sólo busque texto en un fichero cuenta.**

### A · Identidad (2.5B-1, 2.5B-2)

1. Sin sesión, `app.emp_actual()` devuelve nulo.
2. Con la sesión de Ana, devuelve «Ana» y su restaurante y su rol.
3. PIN correcto → sesión. PIN incorrecto → nada.
4. Tras 10 fallos, la función de sesión no emite nada (**el limitador sigue**).
5. Las 22 fichas quedan vinculadas; ninguna cuenta sin ficha ni ficha sin cuenta.
6. Ninguna cuenta creada lleva rol en `user_metadata`.

### B · Aislamiento (2.5B-4) — las negativas

7. Ana lee la ficha de alguien de otro restaurante → **0 filas**.
8. Ana **escribe progreso de Luis** → **denegado**.
9. Ana **escribe el `extras` de Luis** (marca de alérgenos) → **denegado**.
10. Ana **renombra a Luis** → **denegado**.
11. Ana se renombra a sí misma → **denegado**.
12. Ana se cambia el `venue` → **denegado**.
13. Ana se pone `role = 'owner'` → **denegado**.
14. Ana inserta actividad con `employee = 'Luis'` → **se escribe como Ana**.
15. Ana inserta actividad con `venue` ajeno → **se escribe en el suyo**.
16. Ana modifica o borra actividad → **denegado**.
17. Ana lee actividad de otro restaurante → **0 filas**.
18. Un supervisor de A lista la plantilla de B → **0 filas**.
19. Sin sesión (`auth.uid()` nulo), cualquier escritura → **denegada**.
20. **Su propio progreso sí se guarda** — si esto falla, todo lo demás sobra.

### C · Cliente (2.5B-3, 2.5B-7), en navegador real

21. Cambiar `currentUser` en la consola → la fila llega con el nombre **de la
    sesión**.
22. Cambiar `txk_venue` → la fila llega con el restaurante **del empleado**.
23. Manipular el token → el servidor lo rechaza.
24. Tras salir, **no queda en el aparato ningún valor que sirva para
    autenticarse**.

### D · Offline y aparato compartido (2.5B-6)

25. Sin red, 5 actividades → quedan en cola y **Hoy las da por hechas**.
26. Vuelve la red → llegan **5 filas, no 10**.
27. Reintentar 5 veces el mismo evento → **una fila** (`client_id`).
28. **El escenario del §11**: Ana encola 5, sale, entra Carlos, vuelve la red →
    **no se envía nada de Ana**, y **nada se atribuye a Carlos**.
29. Ana vuelve → se envían sus 5, a su nombre.
30. Editar la cola a mano poniendo otro empleado → **se escribe a nombre de
    quien tiene la sesión**.
31. La sesión caduca sin red → se sigue trabajando; al volver, se refresca y se
    vacía.
32. Ana sale y entra Carlos → Carlos **no ve** progreso, SRS ni plan de Ana, ni
    en la interfaz ni en `localStorage`.

### E · Supervisor (2.5B-5)

33. Con el PIN, el panel abre (camino de siempre).
34. Con rol `owner` y sin PIN, el panel abre.
35. Con rol `staff` y sin PIN, **no abre**.
36. Una cuenta con `user_metadata.is_admin = true` y rol `staff` → **no abre**.
    *(Es exactamente la cuenta del §4. Esta prueba es obligatoria.)*

### F · Regresión

37. Las 354 pruebas verdes (con la del cuerpo de `actividad` actualizada).
38. Auditoría de alérgenos 0/0.
39. Panel del supervisor y ranking: **lo mismo que antes**, con datos reales.
40. Hoy, SRS, XP y rachas: sin cambios.
41. Cinco anchos sin errores de JavaScript.

---

## 20 · Riesgos residuales

**Lo que este diseño NO arregla, dicho claro:**

1. **La nota la sigue diciendo el cliente** (§14). Es el riesgo residual
   principal y hay que decidirlo antes de la fase 3.
2. **Un empleado puede inflar su propio progreso.** RLS impide tocar el ajeno,
   no mentir sobre el propio. Lo arregla el RPC de fusión monótona, en la fase
   de integridad.
3. **`employees` sigue teniendo el nombre como clave primaria.** `auth_user_id`
   se añade **al lado**, no en su lugar, para no reescribir 33 000 líneas. Es un
   compromiso consciente: mientras `scores.employee` y `actividad.employee` sean
   texto sin clave ajena, un renombrado mal hecho parte el histórico. Por eso el
   renombrado pasa a ser una operación de supervisor transaccional.
4. **58 puntuaciones seguirán huérfanas.** No se inventan fichas para ellas.
5. **Un aparato desbloqueado y abierto sigue siendo un aparato abierto.** La
   sesión protege contra el que llega después, no contra el que está mirando.
6. **La sal del PIN sigue siendo global.** Deja de importar cuando el hash no
   esté al alcance, pero la sal por empleado sigue siendo lo correcto.
7. **Si la Edge Function cae, nadie entra.** Hoy el auto-login local funciona
   siempre. Mitigación: refresco de 30 días y modo local con el refresco válido.
8. **Sin red y sin refresco válido, no hay progreso.** Es la única degradación
   real frente a hoy.

Y lo que sigue abierto de antes: el PIN de Txoko `837083` sin cambiar, 16
`confirm()` del navegador, contraste sin medir, controles de cabecera por debajo
de 400 px, error de 430 px no reproducido.

---

## 21 · ¿Está listo para implementar?

**Sí, con dos condiciones y una decisión.**

El diseño está completo y apoyado en medidas, no en suposiciones: los permisos
columna a columna, el SQL real que ejecuta PostgREST, el reparto de roles, las
58 huérfanas, la cuenta desconocida y las seis Edge Functions. No queda ninguna
incógnita técnica que pueda cambiar la arquitectura.

**Condición 1 — 2.5B-0 va primero, y no es opcional.** Cerrar el alta pública y
eliminar la cuenta desconocida **antes** de conceder un solo permiso a
`authenticated`. Hacerlo al revés convierte una sonda inerte en una cuenta con
acceso.

**Condición 2 — Hay un dato que no se puede leer desde la base de datos**: si el
registro público está habilitado **ahora**. Está en el panel, y hay que mirarlo
antes de empezar.

**La decisión que falta es tuya, y es la de §14**: si el panel del supervisor y
las asignaciones van a tomar decisiones sobre personas con notas que el cliente
puede falsear. Si la respuesta es que sí, la fase de integridad de evaluación
debería ir **antes** de la fase 4, no después. No bloquea la 2.5B —son problemas
independientes— pero cambia el orden de lo que viene luego.

### Lo que necesita aprobación antes de tocar nada

1. ¿Se aprueba la arquitectura (Edge Function que canjea el PIN por sesión)?
2. ¿Se ejecuta 2.5B-0 ya —cerrar el alta y eliminar la cuenta— o se espera?
3. **Ranking**: ¿los compañeros siguen viéndose la ficha completa, o sólo una
   vista con nombre, XP y nivel?
4. **Aparato compartido**: ¿sesión de 30 días o modo quiosco en los comunes?
5. **Al salir con cola pendiente**: ¿se conserva (mi recomendación) o se
   descarta?
6. **Bajas**: ¿se acepta baja lógica, nunca borrado?
7. **Integridad de la nota**: ¿fase propia antes de la 4, o se asume el riesgo?

---

## Lo que NO se ha hecho en esta fase

No se ha creado ninguna migración, ni se ha ejecutado ningún `ALTER TABLE`, ni
se ha cambiado ninguna política, ni Auth, ni ninguna Edge Function, ni el
cliente, ni `localStorage`, ni el comportamiento offline, ni la interfaz. La
cuenta desconocida **no se ha tocado**: sigue exactamente como estaba.

Todas las consultas de este documento fueron de lectura.
