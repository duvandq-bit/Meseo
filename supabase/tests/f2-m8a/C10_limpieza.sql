-- M8-A · C10 · Limpieza (borra SÓLO lo creado por esta prueba) y verificación
begin;
delete from public.push_subscriptions where endpoint = 'https://fcm.googleapis.com/fcm/send/zz-m8c-x'
                                         or employee_name in ('zz_m8c_a_invalid', 'zz_m8c_b_invalid');
delete from public.employees where name in ('zz_m8c_a_invalid', 'zz_m8c_b_invalid');
delete from auth.users where id in ('00000000-0000-4000-8000-0000000e8ca1', '00000000-0000-4000-8000-0000000e8cb1');
commit;
select (select count(*) from public.push_subscriptions)   as push_subscriptions,
       (select count(*) from public.employees)            as employees,
       (select count(*) from auth.users)                  as auth_users,
       (select count(*) from public.push_envios)          as push_envios,
       (select count(*) from public.push_pin_intentos)    as push_pin_intentos,
       (select count(*) from pg_locks where locktype = 'advisory') as advisory;
