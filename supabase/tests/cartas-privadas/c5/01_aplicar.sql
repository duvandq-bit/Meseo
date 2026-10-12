-- ═══ meseo-c5-test · APLICAR LA PREPARACIÓN Y LAS DOS MIGRACIONES DE CARTAS ═══
-- Meseo · oct 2026. NO EJECUTADO. Sólo para el proyecto de PRUEBAS meseo-c5-test
-- (bykcngwgruqmyecyrjmm), con autorización expresa. NUNCA en producción.
--
-- Qué es: los tres archivos siguientes, COPIADOS SIN UN SOLO CAMBIO, dentro de una
-- transacción explícita con una salvaguarda delante y una verificación detrás.
-- Las migraciones originales siguen siendo las de supabase/; esto no las sustituye.
-- Cada bloque copiado va entre marcas «BEGIN COPIA» / «FIN COPIA» con la sha256 del
-- original: se puede comprobar extrayendo el texto entre las marcas.
--   aaefbdc41b857d1f05eb9459e44ed978cfbd8d63dc1a11dab434689a07ef08a6  supabase/tests/cartas-privadas/c5/00_minimo_c5_cartas.sql
--   537a2c72d7509a54765fb9c555fca09202e7838ce312bc2b345d028e1336ecba  supabase/cartas_privadas.sql
--   32f68afef11a307477c8e09363d4192048d0f45d1494ed5dad2ce541fcf651b4  supabase/cartas_revisores.sql
--
-- Cómo se comporta (ver también D_revisores.sql):
--   · Se ejecuta ENTERO en una sola ejecución del editor SQL (pegar todo y Run).
--   · Si la salvaguarda, cualquier sentencia o la verificación final fallan, el
--     COMMIT no llega a confirmar nada: si el editor se detiene en el error, la
--     transacción abierta nunca se confirma; si siguiera ejecutando, PostgreSQL
--     convierte el COMMIT de una transacción fallida en ROLLBACK. En los dos casos
--     no queda NINGÚN objeto: ni a medias ni entero.
--   · Éxito: termina sin error y la verificación final no se queja.
--   · Fallo: un error cuyo mensaje empieza por «ABORTA:» (salvaguarda o
--     verificación) u otro error de PostgreSQL. Ante cualquier error, nada aplicado.
--
-- Deshacer después de un éxito (sólo en meseo-c5-test):
--   drop table public.cartas_revisores, public.cartas, public.employees cascade;
--   drop schema app cascade;

begin;

-- ── SALVAGUARDA ──────────────────────────────────────────────────────────
do $guarda_c5$
begin
  if (select system_identifier::text from pg_control_system()) <> '7690937621030482216' then
    raise exception 'ABORTA: esta base no es meseo-c5-test (system_identifier %). Producción es 7581440907192989109.',
      (select system_identifier::text from pg_control_system());
  end if;
  if to_regnamespace('app') is not null
     or to_regclass('public.employees') is not null
     or to_regclass('public.cartas') is not null
     or to_regclass('public.cartas_revisores') is not null then
    raise exception 'ABORTA: ya existen objetos de una aplicación anterior (app, employees, cartas o cartas_revisores); no se sobrescribe nada.';
  end if;
end
$guarda_c5$;

-- ═══ BEGIN COPIA supabase/tests/cartas-privadas/c5/00_minimo_c5_cartas.sql · sha256 aaefbdc41b857d1f05eb9459e44ed978cfbd8d63dc1a11dab434689a07ef08a6 ═══
-- ═══ meseo-c5-test · MÍNIMO PARA PROBAR LAS CARTAS PRIVADAS ═════════════════
-- Meseo · oct 2026. NO EJECUTADO. Sólo para el proyecto de PRUEBAS meseo-c5-test
-- (bykcngwgruqmyecyrjmm), con autorización expresa. NUNCA en producción.
--
-- Qué crea (lo mínimo de lo que dependen las migraciones y la prueba):
--   · esquema app, con uso para authenticated y service_role (no anon);
--   · public.employees, sólo con las columnas que leen las funciones y la prueba;
--   · app.venue_actual() y app.rol_actual(), con la misma definición que en
--     producción (leen la TABLA por auth.uid(), nunca el token).
-- Qué NO crea: auth.users, auth.uid() ni los roles anon/authenticated/service_role,
-- porque Supabase ya los trae. No crea ningún dato.
--
-- Orden de ejecución en el editor SQL de meseo-c5-test:
--   1. este archivo
--   2. supabase/cartas_privadas.sql
--   3. supabase/cartas_revisores.sql
--   4. supabase/tests/cartas-privadas/D_revisores.sql   (termina SIEMPRE con un
--      error «RESULTADO {…}» o «ABORTA: …»: es a propósito, así se deshace todo)
--   5. la consulta de comprobación del final (sólo lectura)

-- ── 0 · SALVAGUARDA: sólo en meseo-c5-test y sólo si está vacío ─────────────
do $guarda$
begin
  if (select system_identifier::text from pg_control_system()) <> '7690937621030482216' then
    raise exception 'ABORTA: esta base no es meseo-c5-test. Producción es 7581440907192989109.';
  end if;
  if to_regclass('public.employees') is not null or to_regnamespace('app') is not null
     or to_regclass('public.cartas') is not null then
    raise exception 'ABORTA: el esquema ya existe en esta base; no se sobrescribe.';
  end if;
end
$guarda$;

-- ── 1 · Esquema app ──────────────────────────────────────────────────────
create schema app;
revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;

-- ── 2 · employees mínima ─────────────────────────────────────────────────
create table public.employees (
  name          text primary key,
  venue         text not null default 'txoko',
  role          text not null default 'staff',
  display_name  text,
  auth_user_id  uuid unique references auth.users(id) on delete set null
);
alter table public.employees enable row level security;          -- sin políticas
revoke all on table public.employees from public, anon, authenticated;

-- ── 3 · Funciones de identidad (definición de producción) ─────────────────
create or replace function app.venue_actual() returns text
  language sql stable security definer set search_path to ''
  as $function$ select e.venue from public.employees e where e.auth_user_id = auth.uid() $function$;
create or replace function app.rol_actual() returns text
  language sql stable security definer set search_path to ''
  as $function$ select e.role from public.employees e where e.auth_user_id = auth.uid() $function$;
revoke all on function app.venue_actual(), app.rol_actual() from public, anon;
grant execute on function app.venue_actual(), app.rol_actual() to authenticated, service_role;

-- ── 5 · COMPROBACIÓN (sólo lectura; ejecutar al final) ────────────────────
-- select (select system_identifier::text from pg_control_system()) as base,
--        (select string_agg(policyname || ': ' || qual, ' | ') from pg_policies
--          where schemaname = 'public' and tablename = 'cartas') as politica_cartas,
--        (select string_agg(grantee || ':' || privilege_type, ', ' order by grantee, privilege_type)
--           from information_schema.role_table_grants
--          where table_schema = 'public' and table_name in ('cartas', 'cartas_revisores')
--            and grantee in ('anon', 'authenticated', 'service_role')) as privilegios,
--        (select count(*) from public.cartas) as cartas, (select count(*) from public.cartas_revisores) as concesiones;
-- Esperado: base 7690937621030482216; la política nombra puede_revisar_carta y NO rol_actual;
-- privilegios: sólo «authenticated:SELECT» sobre cartas; ninguno sobre cartas_revisores;
-- 0 cartas y 0 concesiones (la prueba no deja nada).

-- ── CÓMO SE DESHACE (sólo en meseo-c5-test) ───────────────────────────────
--   drop table public.cartas_revisores, public.cartas, public.employees cascade;
--   drop schema app cascade;
-- ═══ FIN COPIA supabase/tests/cartas-privadas/c5/00_minimo_c5_cartas.sql ═══

-- ═══ BEGIN COPIA supabase/cartas_privadas.sql · sha256 537a2c72d7509a54765fb9c555fca09202e7838ce312bc2b345d028e1336ecba ═══
-- ═══ CARTAS PRIVADAS POR RESTAURANTE ═════════════════════════════════════
-- Meseo · oct 2026. Primero en la rama de pruebas f2-push; en producción sólo
-- con autorización expresa del propietario.
--
-- EL PROBLEMA
--   La carta de Txoko vive dentro de index.html y la de cualquier otro
--   restaurante se buscaba en data/carta-<venue>.json. data/ es la web: lo que
--   se pone ahí lo lee cualquiera. Una carta que todavía no se puede enseñar
--   (sin permiso del restaurante, con alérgenos sin validar por cocina) no
--   puede vivir en un sitio público.
--
-- LO QUE HACE
--   Una fila por restaurante con su carta. Quién la lee lo decide el SERVIDOR
--   con la identidad del token, nunca el filtro que mande el móvil:
--     · el personal de un restaurante lee la de su restaurante
--       (employees.venue, que el cliente no puede escribir);
--     · la cuenta de administración —role 'admin', la que existe para revisar
--       contenido— lee todas;
--     · anon no lee nada; sin sesión real no hay fila.
--   Nadie escribe desde la app: no hay política de escritura. La carta se
--   carga por mantenimiento (service_role / SQL), con una persona detrás.
--
-- MIGRACIÓN OFICIAL
--   Este archivo ES la migración: una sola, para aplicarse de una vez con el
--   nombre `cartas_privadas` (la versión la pone Supabase al aplicarla).
--   En f2-push está aplicada en dos pasos —cartas_privadas (20261005235326) y
--   cartas_privadas_sin_service_role (20261006000652)— y el resultado es el
--   mismo: el archivo entero, ejecutado de una vez sobre un esquema de prueba
--   en f2-push, deja exactamente el mismo catálogo (ACL, RLS, política,
--   restricciones). Antes y después: supabase/tests/cartas-privadas/
--   V_antes_despues.sql (sólo lectura).
--
-- COMPATIBILIDAD
--   Una versión antigua de la app no conoce esta tabla: sigue pidiendo
--   data/carta-<venue>.json, no lo encuentra y se cierra (o abre vacía para la
--   administración). No puede enseñar unos alérgenos cuyo estado no entiende.
--   Txoko no pasa por aquí: su carta sigue en index.html.
create table public.cartas (
  venue       text primary key
              check (venue ~ '^[a-z0-9][a-z0-9_-]{0,31}$'),
  formato     integer not null check (formato >= 2),
  contenido   jsonb not null
              check (jsonb_typeof(contenido) = 'object' and contenido->>'venue' = venue),
  actualizado timestamptz not null default now()
);
comment on table public.cartas is
  'Carta de cada restaurante (salvo Txoko, que va en index.html). La lee el personal de su restaurante y la cuenta admin; se escribe sólo por mantenimiento.';

alter table public.cartas enable row level security;

-- Supabase concede por defecto todo a anon y authenticated en las tablas
-- nuevas de public. Aquí no: sólo lectura, y sólo con sesión.
revoke all on table public.cartas from public, anon, authenticated;
grant select on table public.cartas to authenticated;
-- service_role tampoco: los privilegios por defecto cambian de un proyecto a
-- otro (en la rama de pruebas le dejaban TRUNCATE). La carta la escribe el
-- dueño de la tabla, por mantenimiento; ninguna función la toca.
revoke all on table public.cartas from service_role;

-- Las funciones de identidad leen la TABLA employees por auth.uid(), no el
-- token: un rol plantado en user_metadata no sirve para nada.
create policy cartas_leer on public.cartas
  for select to authenticated
  using ( venue = (select app.venue_actual())
          or (select app.rol_actual()) = 'admin' );

-- ── CÓMO SE DESHACE ──────────────────────────────────────────────────────
--   drop table public.cartas;
-- (Nada más depende de ella. La app, sin la tabla, vuelve a buscar en data/.)
-- ═══ FIN COPIA supabase/cartas_privadas.sql ═══

-- ═══ BEGIN COPIA supabase/cartas_revisores.sql · sha256 32f68afef11a307477c8e09363d4192048d0f45d1494ed5dad2ce541fcf651b4 ═══
-- ═══ CARTAS PRIVADAS · REVISIÓN POR IDENTIDAD, NO POR ROL ═══════════════════
-- Meseo · oct 2026. Primero en la rama de pruebas f2-push; en producción sólo
-- con autorización expresa del propietario. NO APLICADA.
--
-- EL PROBLEMA
--   cartas_privadas.sql deja leer TODAS las cartas a cualquier cuenta con
--   role = 'admin'. Hoy hay una sola, pero nada lo garantiza: un ascenso con
--   employee_set_role (PIN de propietario) o una escritura de mantenimiento
--   crearía otra, y esa también leería la carta de un restaurante que todavía
--   no se puede enseñar.
--
-- LO QUE HACE
--   La lectura de una carta queda así:
--     · el personal de un restaurante lee la de su restaurante (igual que antes);
--     · además, quien figure en public.cartas_revisores para ESA carta, por su
--       auth.uid(), la lee para revisarla;
--     · el rol 'admin' por sí solo ya no da acceso a ninguna carta ajena.
--   La identidad es auth.uid() —la sesión de Supabase—, nunca el nombre
--   visible, el correo ni el PIN, y nunca nada que mande el móvil.
--
-- QUIÉN ESCRIBE cartas_revisores
--   Nadie desde la app: ni anon, ni authenticated, ni service_role tienen
--   privilegios, y no hay políticas. Se concede por mantenimiento con
--   supabase/cartas_revisores_concesion.sql, que exige el auth.uid() exacto.
--
-- POR QUÉ UNA FUNCIÓN SECURITY DEFINER
--   La política se evalúa con los permisos de quien lee (authenticated), que no
--   tiene SELECT sobre cartas_revisores: una subconsulta directa fallaría. La
--   función sólo responde «¿la sesión actual puede revisar esta carta?», con
--   search_path vacío y nombres cualificados, igual que app.venue_actual().
--
-- COMPATIBILIDAD
--   La app no cambia: sigue pidiendo rest/v1/cartas?venue=eq.<id>. Una cuenta
--   admin sin concesión recibe 0 filas y abre ese restaurante vacío, como
--   cuando no hay carta. Txoko no pasa por aquí (su carta va en index.html).

create table public.cartas_revisores (
  venue          text not null check (venue ~ '^[a-z0-9][a-z0-9_-]{0,31}$'),
  auth_user_id   uuid not null references auth.users(id) on delete cascade,
  concedido_por  text not null,
  concedido_en   timestamptz not null default now(),
  primary key (venue, auth_user_id)
);
comment on table public.cartas_revisores is
  'Quién (auth.uid()) puede leer la carta de un restaurante para revisarla, aunque su ficha sea de otro. Se escribe sólo por mantenimiento.';
alter table public.cartas_revisores enable row level security;   -- sin políticas
revoke all on table public.cartas_revisores from public, anon, authenticated, service_role;

create or replace function app.puede_revisar_carta(p_venue text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.cartas_revisores r
     where r.venue = p_venue and r.auth_user_id = auth.uid()
  )
$$;
revoke all on function app.puede_revisar_carta(text) from public, anon, service_role;
grant execute on function app.puede_revisar_carta(text) to authenticated;

-- La política de lectura: su restaurante, o una concesión de revisión para ESA
-- carta. Desaparece la cláusula «cualquier admin lee todas».
drop policy cartas_leer on public.cartas;
create policy cartas_leer on public.cartas
  for select to authenticated
  using ( venue = (select app.venue_actual())
          or app.puede_revisar_carta(venue) );

-- ── CÓMO SE DESHACE ──────────────────────────────────────────────────────
--   drop policy cartas_leer on public.cartas;
--   create policy cartas_leer on public.cartas for select to authenticated
--     using ( venue = (select app.venue_actual()) or (select app.rol_actual()) = 'admin' );
--   drop function app.puede_revisar_carta(text);
--   drop table public.cartas_revisores;
-- ═══ FIN COPIA supabase/cartas_revisores.sql ═══

-- ── VERIFICACIÓN: si el resultado no es el esperado, se aborta y no se confirma nada ──
do $verifica_c5$
declare q text; g text; f text;
begin
  select string_agg(qual, ' | ') into q from pg_policies where schemaname = 'public' and tablename = 'cartas';
  if q is null or q not like '%puede_revisar_carta%' or q like '%rol_actual%'
     or (select count(*) from pg_policies where schemaname = 'public' and tablename = 'cartas') <> 1
     or (select count(*) from pg_policies where schemaname = 'public' and tablename = 'cartas_revisores') <> 0 then
    raise exception 'ABORTA: la política de cartas no es la esperada: %', coalesce(q, '(ninguna)');
  end if;
  select string_agg(grantee || ':' || table_name || ':' || privilege_type, ', ' order by grantee, table_name, privilege_type) into g
    from information_schema.role_table_grants
   where table_schema = 'public' and table_name in ('cartas', 'cartas_revisores', 'employees')
     and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')
     -- Supabase da por defecto todo a service_role en las tablas nuevas de public; en la
     -- employees MÍNIMA de esta prueba no se le quita (service_role nunca llega al navegador).
     and not (grantee = 'service_role' and table_name = 'employees');
  if g is distinct from 'authenticated:cartas:SELECT' then
    raise exception 'ABORTA: privilegios inesperados sobre las tablas: %', coalesce(g, '(ninguno)');
  end if;
  select string_agg(p.proname || '→' || r.rolname, ', ' order by p.proname, r.rolname) into f
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   cross join pg_roles r
   where n.nspname = 'app' and r.rolname in ('anon', 'authenticated', 'service_role')
     and has_function_privilege(r.rolname, p.oid, 'EXECUTE');
  if f is distinct from 'puede_revisar_carta→authenticated, rol_actual→authenticated, rol_actual→service_role, venue_actual→authenticated, venue_actual→service_role' then
    raise exception 'ABORTA: permisos de ejecución inesperados en app: %', coalesce(f, '(ninguno)');
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.cartas'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.cartas_revisores'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.employees'::regclass) then
    raise exception 'ABORTA: RLS no está activada en las tres tablas';
  end if;
end
$verifica_c5$;

commit;
