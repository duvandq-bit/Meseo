-- M8-A · C · O3 · Observador: abrir la salida y esperar el estado de carrera resuelta.
-- El bucle sólo ESPERA a que se alcance el estado; la prueba es el estado observado, no el tiempo.
select pg_advisory_unlock(hashtext('zz_m8c'), hashtext('salida')) as salida_abierta;
do $o$
declare
  ns_e  oid := hashtext('push_subscriptions')::oid;
  k_e   oid := hashtext('e:https://fcm.googleapis.com/fcm/send/zz-m8c-x')::oid;
  ns_g  oid := hashtext('zz_m8c')::oid;
  k_c   oid := hashtext('commit')::oid;
  primero int; segundo int; esp boolean; n int;
  t0    timestamptz := clock_timestamp();
begin
  loop
    select pid into primero from pg_locks where locktype = 'advisory' and classid = ns_e and objid = k_e and objsubid = 2 and granted;
    select pid into segundo from pg_locks where locktype = 'advisory' and classid = ns_e and objid = k_e and objsubid = 2 and not granted;
    select exists (select 1 from pg_locks where locktype = 'advisory' and classid = ns_g and objid = k_c and objsubid = 2
                    and pid = primero and not granted) into esp;
    exit when primero is not null and segundo is not null and esp;
    if clock_timestamp() - t0 > interval '30 seconds' then
      raise exception 'M8C O3: estado no alcanzado en 30 s (primero %, segundo %, primero esperando commit %)', primero, segundo, esp;
    end if;
    perform pg_sleep(0.1);
  end loop;
  n := (select count(*) from public.push_subscriptions where endpoint = 'https://fcm.googleapis.com/fcm/send/zz-m8c-x');
  raise notice 'M8C CERROJO: primero pid % tiene e:X (granted) y espera la puerta de commit; segundo pid % espera e:X (granted=false); filas confirmadas con X = % (esperado 0). Dueño final esperado: el pid %', primero, segundo, n, segundo;
  if n <> 0 then raise exception 'M8C O3: filas confirmadas % <> 0', n; end if;
end $o$;
