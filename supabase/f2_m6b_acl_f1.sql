-- F2-6 · M6b · ACL explícitas de F1 para igualar producción (advkoujfgbrrjvqexrcu)
-- Solo para la rama f2-push (sslcgakpxiwhjxsgmngg). En producción estos permisos
-- vienen de los default privileges de public (postgres → service_role); en la
-- rama esos defaults no existen. No cambia nada más.
--   push_autorizar:     {postgres=X, authenticated=X} → + service_role=X
--   push_pin_intentos:  {postgres=arwdDxtm, service_role=Dxtm} → service_role=arwdDxtm
grant execute on function public.push_autorizar(text, text, text) to service_role;
grant select, insert, update, delete, truncate, references, trigger, maintain on table public.push_pin_intentos to service_role;
