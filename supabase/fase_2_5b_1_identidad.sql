-- ═══ FASE 2.5B-1 · LA IDENTIDAD EXISTE (todavía no manda) ════════════════
-- APLICADO en producción el 13 de septiembre de 2026 (migración
-- `fase_2_5b_1_identidad_columna_y_ayudantes`). Copia para el repositorio.
--
-- Nada de esto cambia el comportamiento de la aplicación: la columna llega
-- vacía y las funciones no las usa ninguna política todavía.

alter table public.employees
  add column if not exists auth_user_id uuid unique
    references auth.users(id) on delete set null;

comment on column public.employees.auth_user_id is
  'Fase 2.5B: identidad real del empleado. La rellena la Edge Function `sesion` la primera vez que entra. Nula = todavía no ha entrado con el sistema nuevo.';

create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;

-- Las tres leen la TABLA, no el token. A propósito: si a alguien se le cambia
-- el rol, el cambio vale en la siguiente petición, no cuando le caduque el
-- token. Y ninguna reclamación del cliente (user_metadata incluido) entra aquí.
--
-- `search_path = ''` y todo cualificado: sin fijarlo, quien pudiera crear
-- objetos en un esquema anterior de la ruta podría suplantar a `employees` y
-- su tabla se leería CON LOS PRIVILEGIOS DEL DUEÑO.
--
-- Y no reciben parámetros: leen `auth.uid()`. Una función definer a la que no
-- se le pasa nada no se puede engañar con lo que se le pasa.

create or replace function app.emp_actual() returns text
  language sql stable security definer set search_path = ''
as $$ select e.name from public.employees e where e.auth_user_id = auth.uid() $$;

create or replace function app.venue_actual() returns text
  language sql stable security definer set search_path = ''
as $$ select e.venue from public.employees e where e.auth_user_id = auth.uid() $$;

create or replace function app.rol_actual() returns text
  language sql stable security definer set search_path = ''
as $$ select e.role from public.employees e where e.auth_user_id = auth.uid() $$;

-- Postgres concede EXECUTE a PUBLIC por defecto, y ése es el motivo de los 17
-- avisos que ya da el propio Supabase sobre este proyecto. Aquí no.
revoke execute on function app.emp_actual()   from public;
revoke execute on function app.venue_actual() from public;
revoke execute on function app.rol_actual()   from public;
grant  execute on function app.emp_actual()   to authenticated, service_role;
grant  execute on function app.venue_actual() to authenticated, service_role;
grant  execute on function app.rol_actual()   to authenticated, service_role;

-- ── CÓMO SE DESHACE ──────────────────────────────────────────────────────
--   drop schema app cascade;
--   alter table public.employees drop column auth_user_id;
-- (Nada depende de ellas mientras no se active RLS.)
