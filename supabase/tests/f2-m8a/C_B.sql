-- M8-A · C · Sesión B · ejecutar con: psql "<conexión de la rama>" -f C_B.sql
\set ON_ERROR_STOP on
set statement_timeout = '180s';
set lock_timeout = '180s';
select 'B' as sesion, pg_backend_pid() as pid, current_setting('transaction_isolation') as aislamiento;
begin;
-- Puerta de salida: espera aquí hasta que O la abra
select pg_advisory_xact_lock_shared(hashtext('zz_m8c'), hashtext('salida'));
select 'B' as sesion, clock_timestamp() as sale;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000e8cb1","role":"authenticated"}', true);
set local role authenticated;
select 'B' as sesion,
       public.push_suscripcion_registrar('https://fcm.googleapis.com/fcm/send/zz-m8c-x', repeat('B', 87), repeat('b', 22)) as resultado,
       clock_timestamp() as registrado;
reset role;
-- Puerta de commit: el primero en registrar espera aquí CON el candado e:X tomado
select pg_advisory_xact_lock_shared(hashtext('zz_m8c'), hashtext('commit'));
commit;
select 'B' as sesion, clock_timestamp() as confirmado;
