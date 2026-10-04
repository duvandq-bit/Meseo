-- F2-2 · M2 · Esquema app + funciones de identidad (réplica de producción advkoujfgbrrjvqexrcu)
-- Solo para la rama f2-push (sslcgakpxiwhjxsgmngg). Definiciones literales de
-- pg_get_functiondef de producción. ACL explícitas.

-- 1 · Esquema: propietario postgres, ACL {postgres=UC, authenticated=U, service_role=U}
create schema app;
revoke all on schema app from public, anon, authenticated, service_role;
grant usage on schema app to authenticated, service_role;

-- 2 · Funciones (literales de producción)
CREATE OR REPLACE FUNCTION app.emp_actual()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ select e.name from public.employees e where e.auth_user_id = auth.uid() $function$
;

CREATE OR REPLACE FUNCTION app.venue_actual()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ select e.venue from public.employees e where e.auth_user_id = auth.uid() $function$
;

CREATE OR REPLACE FUNCTION app.rol_actual()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ select e.role from public.employees e where e.auth_user_id = auth.uid() $function$
;

-- 3 · ACL de las funciones: {postgres=X, authenticated=X, service_role=X}
revoke all on function app.emp_actual()   from public, anon, authenticated, service_role;
revoke all on function app.venue_actual() from public, anon, authenticated, service_role;
revoke all on function app.rol_actual()   from public, anon, authenticated, service_role;
grant execute on function app.emp_actual()   to authenticated, service_role;
grant execute on function app.venue_actual() to authenticated, service_role;
grant execute on function app.rol_actual()   to authenticated, service_role;
