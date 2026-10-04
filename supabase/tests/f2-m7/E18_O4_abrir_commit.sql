-- E18 · O4 · Observador: abrir la puerta de commit y esperar a que A y B terminen
select pg_advisory_unlock(hashtext('zz_e18'), hashtext('commit')) as commit_abierta;
do $o$
declare
  t0 timestamptz := clock_timestamp();
begin
  loop
    exit when not exists (
      select 1 from pg_locks
       where locktype = 'advisory' and objsubid = 2 and pid <> pg_backend_pid()
         and ((classid = hashtext('zz_e18')::oid) or
              (classid = hashtext('push_envios')::oid and objid = hashtext('r:00000000-0000-4000-8000-00000000e180')::oid)));
    if clock_timestamp() - t0 > interval '30 seconds' then
      raise exception 'E18 O4: A/B siguen con candados tras 30 s';
    end if;
    perform pg_sleep(0.1);
  end loop;
  raise notice 'E18 LIBERADO: las transacciones de A y B han terminado (commit o abort) y no queda ningún candado suyo; el éxito se comprueba en sus salidas y en el paso 9';
end $o$;
select pg_advisory_unlock_all();
