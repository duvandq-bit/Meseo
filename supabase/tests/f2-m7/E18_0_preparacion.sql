-- E18 · 0 · Preparación (una sola transacción; si algo falla, no queda nada)
-- Deja CONFIRMADOS: 1 auth.users + 2 employees zz_e18_* + 5 reservas previas del par.
begin;
do $p$
declare
  uid   uuid := '00000000-0000-4000-8000-00000000e180';
  x     json;
  i     int;
  v10   timestamptz := date_bin(interval '10 minutes', now(), timestamptz '2000-01-01 00:00:00+00');
  resto interval;
begin
  resto := v10 + interval '10 minutes' - now();
  if resto < interval '6 minutes' then
    raise exception 'E18 PREP: quedan % en la ventana de 10 min; espera al siguiente minuto múltiplo de 10', resto;
  end if;
  if (select count(*) from public.push_envios) <> 0 or (select count(*) from public.employees) <> 0
     or (select count(*) from auth.users) <> 0 or (select count(*) from public.push_pin_intentos) <> 0 then
    raise exception 'E18 PREP: la rama no está en la línea base (push_envios, employees, auth.users y push_pin_intentos deben ser 0)';
  end if;
  if exists (select 1 from auth.users where id = uid)
     or exists (select 1 from public.employees where name like 'zz\_e18\_%')
     or exists (select 1 from public.push_envios where remitente = uid or destino like 'zz\_e18\_%') then
    raise exception 'E18 PREP: hay restos de una ejecución anterior; ejecuta primero la limpieza';
  end if;

  insert into auth.users(id, email) values (uid, 'zz-e18-rem@zzv.meseo.invalid');
  perform set_config('app.alta_valida', 'si', true);
  insert into public.employees(name, venue, role, display_name, auth_user_id) values
    ('zz_e18_rem_invalid',  'zzv', 'staff', 'zz', uid),
    ('zz_e18_dest_invalid', 'zzv', 'staff', 'zz', null);

  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
  for i in 1..5 loop
    x := public.push_envio_reservar('persona', 'zz_e18_dest_invalid', null, gen_random_uuid());
    if not coalesce((x ->> 'enviar')::boolean, false) then
      raise exception 'E18 PREP: reserva previa % inesperada: %', i, x;
    end if;
  end loop;
  reset role;

  if (select count(*) from public.push_envios where remitente = uid and destino = 'zz_e18_dest_invalid') <> 5 then
    raise exception 'E18 PREP: no hay exactamente 5 reservas previas';
  end if;
  raise notice 'E18 PREP OK: 5 reservas previas del par, ventana %, quedan % en ella; auth.users=%, employees=%, push_envios=%', v10, resto,
    (select count(*) from auth.users), (select count(*) from public.employees), (select count(*) from public.push_envios);
end $p$;
commit;
