-- E18 · Sesión B · ejecutar con: psql "<conexión de la rama>" -f E18_B.sql
\set ON_ERROR_STOP on
set statement_timeout = '180s';
set lock_timeout = '180s';
select 'B' as sesion, pg_backend_pid() as pid, current_setting('transaction_isolation') as aislamiento;
begin;
-- Puerta de salida: espera aquí hasta que O la abra
select pg_advisory_xact_lock_shared(hashtext('zz_e18'), hashtext('salida'));
select 'B' as sesion, clock_timestamp() as sale;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e180","role":"authenticated"}', true);
set local role authenticated;
select 'B' as sesion,
       public.push_envio_reservar('persona', 'zz_e18_dest_invalid', null, '00000000-0000-4000-8000-0000000e18b1'::uuid) as resultado,
       date_bin(interval '10 minutes', now(), timestamptz '2000-01-01 00:00:00+00') as ventana,
       clock_timestamp() as reservado;
reset role;
-- Puerta de commit: el que haya reservado espera aquí CON el candado r: tomado
select pg_advisory_xact_lock_shared(hashtext('zz_e18'), hashtext('commit'));
commit;
select 'B' as sesion, clock_timestamp() as confirmado;
