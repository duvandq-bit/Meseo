-- M8-A · C0 · Preparación de la prueba de concurrencia (una sola transacción)
-- Deja CONFIRMADOS: 2 auth.users + 2 employees zz_m8c_* (zzv). Ninguna suscripción.
begin;
do $p$
declare
  ua uuid := '00000000-0000-4000-8000-0000000e8ca1';
  ub uuid := '00000000-0000-4000-8000-0000000e8cb1';
  ex text := 'https://fcm.googleapis.com/fcm/send/zz-m8c-x';
begin
  if (select count(*) from public.push_subscriptions) <> 0 or (select count(*) from public.employees) <> 0
     or (select count(*) from auth.users) <> 0 then
    raise exception 'M8C PREP: la rama no está en la línea base (push_subscriptions, employees y auth.users deben ser 0)';
  end if;
  insert into auth.users(id, email) values (ua, 'zz-m8c-a@zzv.meseo.invalid'), (ub, 'zz-m8c-b@zzv.meseo.invalid');
  perform set_config('app.alta_valida', 'si', true);
  insert into public.employees(name, venue, role, display_name, auth_user_id) values
    ('zz_m8c_a_invalid', 'zzv', 'staff', 'zz', ua),
    ('zz_m8c_b_invalid', 'zzv', 'staff', 'zz', ub);
  raise notice 'M8C PREP OK: auth.users=%, employees=%, suscripciones con X=%',
    (select count(*) from auth.users), (select count(*) from public.employees),
    (select count(*) from public.push_subscriptions where endpoint = ex);
end $p$;
commit;
