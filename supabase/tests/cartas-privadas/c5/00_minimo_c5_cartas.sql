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
