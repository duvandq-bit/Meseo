-- E18 · 10 · Limpieza (borra SÓLO lo creado por E18) y verificación
begin;
delete from public.push_envios
 where remitente = '00000000-0000-4000-8000-00000000e180' or destino like 'zz\_e18\_%';
delete from public.employees where name in ('zz_e18_rem_invalid', 'zz_e18_dest_invalid');
delete from auth.users where id = '00000000-0000-4000-8000-00000000e180';
commit;
select (select count(*) from public.push_envios)          as push_envios,
       (select count(*) from public.push_pin_intentos)    as push_pin_intentos,
       (select count(*) from public.push_subscriptions)   as push_subscriptions,
       (select count(*) from public.employees)            as employees,
       (select count(*) from public.supervisor_pins)      as supervisor_pins,
       (select count(*) from public.supervisor_pin_secret) as supervisor_pin_secret,
       (select count(*) from auth.users)                  as auth_users,
       (select count(*) from pg_locks where locktype = 'advisory') as advisory;
