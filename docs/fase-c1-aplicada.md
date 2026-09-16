# FASE C-1 — APLICADA

Identidad del servidor mediante `DEFAULT`, sin cerrar ningún grant y sin cambiar
el comportamiento de `anon`. Aplicada el **2026-09-16** como migración
`fase_c1_identidad_del_servidor`.

**Lo que NO se ha tocado:** grants, políticas, RLS, `employees`, Auth, PIN,
`sesion`, la aplicación, datos históricos. **No se ha publicado nada en
producción.** C-2, C-3 y B2 siguen sin empezar.

---

## 1 · SQL exacto aplicado

```sql
-- (1) De dónde saldrán `employee` y `venue` cuando el cliente deje de mandarlos
--     en C-2. Hoy los manda, y un valor explícito gana al DEFAULT, así que esto
--     no cambia ni una sola escritura existente.
--     Se reutilizan las funciones que ya existían: no se crea ninguna nueva.
alter table public.scores
  alter column employee set default app.emp_actual(),
  alter column venue    set default app.venue_actual();
alter table public.actividad
  alter column employee set default app.emp_actual(),
  alter column venue    set default app.venue_actual();

-- (2) La identidad real, derivada de la firma del JWT. NULABLE a propósito: las
--     427 puntuaciones y las 5 actividades históricas no tienen dueño
--     demostrable, y no se inventa uno.
alter table public.scores    add column auth_user_id uuid default auth.uid();
alter table public.actividad add column auth_user_id uuid default auth.uid();

comment on column public.scores.auth_user_id is '…';      -- (texto en la migración)
comment on column public.actividad.auth_user_id is '…';

-- (3) Lo que el servidor pone SIEMPRE, ignorando lo que mande el cliente:
--     la identidad, la clave primaria y el sello de tiempo.
--
--     SECURITY INVOKER A PROPÓSITO. Dentro de una función SECURITY DEFINER,
--     `current_user` es el DUEÑO (postgres), no el rol que llama, así que una
--     guarda `current_user in ('anon','authenticated')` no distinguiría a nadie
--     y no protegería nada. Medido en este proyecto antes de escribir esto (§7).
create or replace function public.marca_del_servidor()
returns trigger
language plpgsql
set search_path to ''
as $fn$
begin
  if current_user in ('anon', 'authenticated') then
    new.auth_user_id := auth.uid();                     -- identidad: sólo del token
    new.id           := pg_catalog.gen_random_uuid();   -- clave: sólo del servidor
    new.created_at   := pg_catalog.now();               -- sello: sólo del servidor
  end if;
  return new;
end
$fn$;

drop trigger if exists trg_marca_del_servidor on public.scores;
drop trigger if exists trg_marca_del_servidor on public.actividad;

create trigger trg_marca_del_servidor
  before insert on public.scores    for each row execute function public.marca_del_servidor();
create trigger trg_marca_del_servidor
  before insert on public.actividad for each row execute function public.marca_del_servidor();
```

**Funciones nuevas: una**, y sólo porque no había forma de fijar `id`,
`created_at` y `auth_user_id` sin tocar grants —que es justo lo que C-1 no debe
hacer—. Las tres de identidad (`app.emp_actual`, `app.venue_actual`,
`app.rol_actual`) **se reutilizan tal cual**; `app.rol_actual()` no la usa C-1,
queda para la fase de lectura.

### Por qué un disparador y no sólo `DEFAULT`

Un `DEFAULT` sólo actúa **cuando la columna no viene en el `INSERT`**. Como C-1 no
puede retirar grants, el cliente puede seguir nombrando cualquier columna, así que
un `DEFAULT` por sí solo dejaría a `auth_user_id`, `id` y `created_at` a merced del
cuerpo. El disparador los impone. **Para `employee` y `venue` NO se hace lo mismo
a propósito:** forzarlos rompería hoy mismo a `anon`, que manda `employee` y no
tiene identidad. Esos dos los cierra C-3 retirando el grant.

---

## 2 · Estado antes y después

| | Antes | Después |
|---|---|---|
| `scores.employee` default | *(ninguno)* | **`app.emp_actual()`** |
| `scores.venue` default | `'txoko'::text` | **`app.venue_actual()`** |
| `actividad.employee` default | *(ninguno)* | **`app.emp_actual()`** |
| `actividad.venue` default | *(ninguno)* | **`app.venue_actual()`** |
| `scores.auth_user_id` | **no existe** | `uuid` nulable, default `auth.uid()` |
| `actividad.auth_user_id` | **no existe** | `uuid` nulable, default `auth.uid()` |
| `id` / `created_at` | los podía fijar el cliente | **los impone el servidor** |
| Disparadores en `scores` | `trg_admin_sin_marcas` | `trg_admin_sin_marcas` + `trg_marca_del_servidor` |
| Disparadores en `actividad` | *(ninguno)* | `trg_marca_del_servidor` |
| **Grants `scores` / `actividad`** | `anon=arDxtm, authenticated=arDxtm` | **idénticos** |
| **Políticas** | las 4, todas `true` | **las 4, todas `true`** |
| **RLS** | activo, no forzado | **igual** |
| Funciones en `app` | 3 | **3** |

---

## 3 · Qué valor tiene cada columna, en los cinco casos

Medido, no deducido. «cuerpo actual» = el que mandan hoy los cuatro escritores:
`employee` y `venue` explícitos.

| # | Quién inserta | `employee` | `venue` | `auth_user_id` | `id` | `created_at` |
|---|---|---|---|---|---|---|
| **1** | **Empleado autenticado, cuerpo actual** | el que manda | el que manda | **su `uid`** | servidor | servidor |
| **1b** | **Empleado autenticado, cuerpo sin identidad** (lo que hará C-2) | **`app.emp_actual()`** | **`app.venue_actual()`** | **su `uid`** | servidor | servidor |
| **2** | **`anon`, cuerpo actual** | el que manda | el que manda | **`NULL`** | servidor | servidor |
| **3** | **Sin `auth.uid()`** y omitiendo `employee` | — | — | — | — | **rechazo `42501`** |
| **4** | **JWT válido sin ficha** en `employees` | `NULL` → | | | | **rechazo `23502`** |
| **5** | **Identidad válida** | igual que 1 / 1b | | | | |

**Caso 3, con detalle:** `401` + `{"code":"42501","message":"permission denied for
function emp_actual"}`. El `DEFAULT` llama a `app.emp_actual()`, y `EXECUTE` sobre
esa función está concedido a `authenticated` y `service_role`, **no a `anon`**. Es
un rechazo correcto —`anon` no debe poder escribir filas sin identidad— pero el
mensaje es confuso. **Hoy no lo alcanza nadie**: los cuatro escritores mandan
`employee`. Se vuelve alcanzable en C-2, cuando el cliente deje de mandarlo y
alguna sesión caiga a `anon`. **Decisión pendiente para C-2:** conceder `EXECUTE`
a `anon` (el rechazo pasaría a ser `23502 null value in column "employee"`, más
honesto, y la función no filtra nada porque para `anon` devuelve `NULL`). **No se
ha hecho en C-1** para no tocar ningún grant.

**Caso 4:** `400` + `{"code":"23502","message":"null value in column \"employee\"
of relation \"scores\" violates not-null constraint"}`. Un token legítimo de
alguien sin ficha no produce identidad válida y no escribe.

---

## 4 · Tests

Dos capas: ensayos SQL revertidos (antes de aplicar) y **peticiones HTTP reales
contra PostgREST** (después de aplicar), con el cuerpo literal del cliente actual.

### 4.1 · Compatibilidad — HTTP real, después de aplicar

| | Petición | HTTP | Resultado |
|---|---|---|---|
| **V1** | `anon` + cuerpo actual → `scores` | **201** | `employee=Duvan venue=txoko auth_user_id=null created_at=2026-09-16T22:47:36Z` |
| **V3** | `anon` + cuerpo actual → `actividad` | **201** | `employee=Duvan venue=txoko auth_user_id=null` |
| **V4** | `anon` lee el ranking | **200** | `[{"employee":"Duvan","score":8,"total":10}, …]` |
| **V6** | `anon` + `employee:'Administrador'` | **201** | `[]` — la cuenta de administración **sigue sin dejar rastro** |

**El cliente de producción no nota nada.** V1 confirma además el único caso que
quedaba pendiente de B2.2: **`INSERT` válido → 201 con fila**.

### 4.2 · Tests negativos — los cuatro exigidos

| Exigencia | Prueba | Resultado |
|---|---|---|
| **El cliente no puede hacer que el servidor derive `auth_user_id` de otro valor** | **V2**: cuerpo con `auth_user_id:"2222…"` | **201, y la fila quedó `auth_user_id: null`** — ignorado |
| **`id` no depende del cuerpo** | **V2**: cuerpo con `id:"1111-1111-4111-8111-111111111111"` | fila con `id: 01c96fc3-b786-4c44-98af-7e5331c16dea` — **ignorado** |
| **`created_at` no depende del cuerpo** | **V2**: cuerpo con `created_at:"2020-01-01T00:00:00Z"` | fila con `created_at: 2026-09-16T22:47:36Z` — **ignorado** |
| **Un JWT sin ficha no produce identidad válida** | ensayo SQL, `sub` sin fila en `employees` | **`23502`**, rechazo |
| *(extra)* `anon` no puede escribir sin identidad | **V5** | **`401` + `42501`** |
| *(extra)* El `DEFAULT` no toma valores arbitrarios | ensayo: autenticado sin identidad en el cuerpo | `employee=Aless venue=txoko`, **de su ficha** |

> **No se ha probado el cierre de grants.** Eso es C-3 y sigue sin aplicar: los
> ataques `employee:'Ana'` y `venue:'mb'` **siguen funcionando hoy**, exactamente
> igual que antes de C-1. C-1 no los cierra y no pretendía cerrarlos.

### 4.3 · Ensayos previos, revertidos

Tres bloques contra las tablas reales terminados en `raise exception`. El segundo
**encontró un fallo en mi propio SQL** (§2.3 del documento de diseño: `revoke
insert (columna)` es un no-op sobre quien tiene `INSERT` de tabla) y el ensayo de
C-1 verificó los siete casos de §3 antes de tocar nada.

---

## 5 · Conteos

| | Antes | Después | |
|---|---|---|---|
| `scores` | 427 | **427** | ✓ |
| `actividad` | 5 | **5** | ✓ |
| `employees` | 22 | **22** | ✓ |
| `employees` con `auth_user_id` | 18 | **18** | ✓ |
| Usuarios en `auth.users` | 18 | **18** | ✓ |
| Fichas con PIN | 18 | **18** | ✓ |
| Huérfanos en `scores` | 58 | **58** | ✓ sin nuevos |
| Huérfanos en `actividad` | 0 | **0** | ✓ |
| `scores` con `auth_user_id` | — | **0** | ✓ histórico intacto |
| `actividad` con `auth_user_id` | — | **0** | ✓ |
| Puntuación más reciente | 2026-09-12 13:01:46 | **2026-09-12 13:01:46** | ✓ |
| Restos de prueba | — | **0** | ✓ |

Las pruebas HTTP crearon **3 filas** (2 en `scores`, 1 en `actividad`), todas con
marca `__c1_prueba__`, **borradas inmediatamente**. Ninguna fila histórica se leyó
para modificarla, se actualizó ni se borró.

---

## 6 · Rollback exacto

```sql
-- REVERSIÓN COMPLETA DE C-1. Ejecutar de arriba abajo.

drop trigger  if exists trg_marca_del_servidor on public.scores;
drop trigger  if exists trg_marca_del_servidor on public.actividad;
drop function if exists public.marca_del_servidor();

-- OJO: esto descarta la identidad ya escrita en las filas posteriores a C-1.
-- Antes de ejecutarlo, comprobar cuántas hay:
--   select count(*) from public.scores    where auth_user_id is not null;
--   select count(*) from public.actividad where auth_user_id is not null;
alter table public.scores    drop column if exists auth_user_id;
alter table public.actividad drop column if exists auth_user_id;

-- Restaurar los DEFAULT EXACTOS de antes: `scores.venue` tenía 'txoko',
-- los otros tres no tenían ninguno.
alter table public.scores
  alter column employee drop default,
  alter column venue    set  default 'txoko'::text;
alter table public.actividad
  alter column employee drop default,
  alter column venue    drop default;
```

La reversión **no toca datos históricos, ni grants, ni políticas, ni Auth**. Con
los conteos de hoy (0 filas con `auth_user_id`) el rollback es **completamente
inocuo**; deja de serlo en cuanto entre la primera escritura autenticada.

---

## 7 · Incompatibilidades y hallazgos

### 7.1 · Incompatibilidades introducidas por C-1

**Ninguna.** Verificado por HTTP real con el cuerpo literal del cliente: login,
progreso, `scores`, `actividad`, lectura y la exclusión de la cuenta de
administración siguen igual. `anon` conserva exactamente los mismos permisos.

El único cambio de comportamiento observable es el previsto: `id` y `created_at`
dejan de poder venir del cuerpo. **Ningún escritor del repositorio los manda** —
comprobado sobre `index.html` y sobre las Edge Functions, que ni siquiera tocan
estas dos tablas.

### 7.2 · Dos hallazgos que salieron de las sondas, fuera del alcance de C-1

**H1 · `employees_identidad_inmutable` no protege nada.** Es `SECURITY DEFINER`, y
dentro de una función así `current_user` es el **dueño** (`postgres`), no el rol que
llama. Medido:

```
SECDEF : current_user=postgres      session_user=postgres
INVOKER: current_user=authenticated session_user=postgres
```

Su guarda `current_user in ('anon','authenticated')` es **siempre falsa**, así que
ni el bloqueo de renombrado ni el de `auth_user_id` llegan a evaluarse. Es la
razón de que `marca_del_servidor()` se haya escrito `SECURITY INVOKER`.

**H2 · Un cliente autenticado puede renombrar a un empleado.** Lo que de verdad
protege `auth_user_id` en `employees` son los grants por columna —no está en la
lista de `UPDATE`, y el intento da `42501`—. Pero **`name` sí está en esa lista**:

```
UPDATE para authenticated: achievements, avatar, duel_wins, exam_correct, extras,
  known_dishes, last_active_at, last_login, last_study_day, NAME, sessions_count,
  sessions_data, streak, topic_scores, txoko_record, updated_at, xp
```

En la prueba, el renombrado sólo lo paró una **clave ajena** de
`employee_recovery`, y eso es una casualidad: sólo 9 de las 22 fichas tienen fila
de recuperación. Un empleado sin fila en `employee_recovery`, `chat_messages` ni
`nda_signatures` **es renombrable por cualquier cliente autenticado** — y como
`scores` y `actividad` cuelgan del nombre por texto y sin clave ajena, renombrar
a alguien le mueve o le huérfaniza el histórico.

**No se arregla aquí.** Es de `employees`, no de la autoridad de identidad de
`scores`/`actividad`, y tocarlo se sale de lo aprobado. Queda anotado y
corregida la afirmación equivocada de `fase-c-autoridad-servidor.md §1.3(c)`.

### 7.3 · Lo que C-1 sigue sin cerrar, por diseño

| Sigue abierto | Lo cierra |
|---|---|
| `employee:'Ana'` con el token de Bruno | **C-3** |
| `venue:'mb'` | **C-3** |
| `anon` escribiendo con identidad elegida | **C-3** |
| El SHA del PIN como credencial al portador | **nada de esto**; problema aparte |
| Empleado desactivado | fuera de alcance |

---

## 8 · C-2, C-3 y B2 siguen intactos

Verificado tras aplicar:

```
grants scores:   {postgres=arwdDxtm, anon=arDxtm, authenticated=arDxtm, service_role=arwdDxtm}
políticas:       scores.insert_scores=true | scores.read_scores=true
                 actividad.actividad_insert=true | actividad.actividad_select=true
columnas evento_id:        0
índices únicos de evento:  0
```

- **C-2** (cliente deja de mandar `employee`/`venue`): no empezado. Los cuatro
  escritores y `_vSello()` siguen exactamente como estaban.
- **C-3** (retirar el `INSERT` de tabla y reconceder por columnas): no aplicado.
  Los grants están intactos.
- **B2**: sin `evento_id`, sin índices únicos, sin cola, sin cambios de UI. Sus
  dos bloqueos siguen siendo los mismos — la medición en iPad y la aplicación de
  C-3.

---

# C-1 APLICADA Y VERIFICADA

Aplicada como migración `fase_c1_identidad_del_servidor`. Conteos idénticos, sin
huérfanos nuevos, sin filas históricas modificadas, sin cambios en Auth, PIN ni
`sesion`, y sin publicar nada en producción.

Lo que hoy es cierto y antes no: **`auth_user_id`, `id` y `created_at` de toda
fila nueva de `scores` y `actividad` los pone el servidor y el cuerpo no los puede
cambiar** — demostrado contra HTTP real, con las tres columnas ignoradas en la
misma petición. Y el mecanismo del que saldrán `employee` y `venue` ya está
instalado, esperando a que el cliente deje de mandarlos.

Lo que sigue sin ser cierto, y conviene no confundir: **el ataque `employee:'Ana'`
sigue funcionando hoy**. C-1 no lo cierra. Lo cierra C-3, después de C-2 y de B2.
