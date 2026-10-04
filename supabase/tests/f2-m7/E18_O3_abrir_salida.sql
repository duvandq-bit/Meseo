-- E18 · O3 · Observador: abrir la salida y esperar el estado de carrera resuelta.
-- El bucle sólo ESPERA a que se alcance el estado; la prueba es el estado observado, no el tiempo.
select pg_advisory_unlock(hashtext('zz_e18'), hashtext('salida')) as salida_abierta;
do $o$
declare
  ns_r  oid := hashtext('push_envios')::oid;
  k_r   oid := hashtext('r:00000000-0000-4000-8000-00000000e180')::oid;
  ns_g  oid := hashtext('zz_e18')::oid;
  k_c   oid := hashtext('commit')::oid;
  gan   int; per int; esp boolean; n int;
  t0    timestamptz := clock_timestamp();
begin
  loop
    select pid into gan from pg_locks where locktype = 'advisory' and classid = ns_r and objid = k_r and objsubid = 2 and granted;
    select pid into per from pg_locks where locktype = 'advisory' and classid = ns_r and objid = k_r and objsubid = 2 and not granted;
    select exists (select 1 from pg_locks where locktype = 'advisory' and classid = ns_g and objid = k_c and objsubid = 2
                    and pid = gan and not granted) into esp;
    exit when gan is not null and per is not null and esp;
    if clock_timestamp() - t0 > interval '30 seconds' then
      raise exception 'E18 O3: estado no alcanzado en 30 s (ganador %, perdedor %, ganador esperando commit %)', gan, per, esp;
    end if;
    perform pg_sleep(0.1);
  end loop;
  n := (select count(*) from public.push_envios
         where remitente = '00000000-0000-4000-8000-00000000e180' and destino = 'zz_e18_dest_invalid');
  raise notice 'E18 CERROJO: ganador pid % tiene r: (granted) y espera la puerta de commit; perdedor pid % espera r: (granted=false); filas confirmadas del par = % (esperado 5)', gan, per, n;
  if n <> 5 then raise exception 'E18 O3: filas confirmadas % <> 5', n; end if;
end $o$;
