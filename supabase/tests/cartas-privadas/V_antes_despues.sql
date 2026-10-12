-- Meseo · verificación de solo lectura de public.cartas, ANTES y DESPUÉS de
-- aplicar supabase/cartas_privadas.sql en un proyecto. No escribe nada.

-- ANTES · la tabla no existe y las funciones de identidad están listas
select to_regclass('public.cartas') is null                                  as tabla_no_existe,
       to_regprocedure('app.venue_actual()') is not null                     as venue_actual_existe,
       to_regprocedure('app.rol_actual()') is not null                       as rol_actual_existe,
       has_function_privilege('authenticated','app.venue_actual()','EXECUTE') as auth_ejecuta_venue,
       has_function_privilege('authenticated','app.rol_actual()','EXECUTE')   as auth_ejecuta_rol;
-- Esperado: true, true, true, true, true.

-- DESPUÉS · forma, RLS, política y permisos
select relrowsecurity as rls, relforcerowsecurity as rls_forzada, relacl::text as acl,
       pg_get_userbyid(relowner) as dueno
  from pg_class where oid = 'public.cartas'::regclass;
-- Esperado: true, false, {postgres=arwdDxtm/postgres,authenticated=r/postgres}, postgres

select conname, pg_get_constraintdef(oid) from pg_constraint
 where conrelid = 'public.cartas'::regclass order by conname;
-- Esperado: cartas_check, cartas_formato_check, cartas_pkey (venue), cartas_venue_check

select polname, polcmd, pg_get_expr(polqual, polrelid) from pg_policy
 where polrelid = 'public.cartas'::regclass;
-- Esperado: una sola, cartas_leer, r (SELECT), venue = app.venue_actual() OR app.rol_actual() = 'admin'

select r.rolname,
  has_table_privilege(r.rolname,'public.cartas','SELECT') lee,
  has_table_privilege(r.rolname,'public.cartas','INSERT,UPDATE,DELETE,TRUNCATE') escribe
from pg_roles r where r.rolname in ('anon','authenticated','service_role');
-- Esperado: anon f/f · authenticated t/f · service_role f/f

select count(*) as triggers from pg_trigger where tgrelid = 'public.cartas'::regclass and not tgisinternal;
-- Esperado: 0
