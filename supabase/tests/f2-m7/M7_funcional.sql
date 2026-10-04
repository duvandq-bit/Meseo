DO $t$
declare
  r jsonb := '{}'; x json; i int; j int; t0 timestamptz := clock_timestamp(); resp jsonb := '[]';
  uA uuid := gen_random_uuid(); uB uuid := gen_random_uuid(); uC uuid := gen_random_uuid();
  uS uuid := gen_random_uuid(); uAd uuid := gen_random_uuid(); uN uuid := gen_random_uuid();
  uSenders uuid[] := array[gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()];
  PV text := 'zz-pin-4321'; PW text := 'zz-pin-8765'; MAL text := 'zz-mal-0000';
  e1 uuid := gen_random_uuid(); n0 int; n1 int;
  v10 timestamptz := date_bin(interval '10 minutes', now(), timestamptz '2000-01-01 00:00:00+00');
  dia timestamptz := date_bin(interval '1 day', now(), timestamptz '2000-01-01 00:00:00+00');
begin
  insert into auth.users(id, email) values
    (uA,'zz-a@zzv.meseo.invalid'),(uB,'zz-b@zzv.meseo.invalid'),(uC,'zz-c@zzw.meseo.invalid'),
    (uS,'zz-s@zzv.meseo.invalid'),(uAd,'zz-ad@zzv.meseo.invalid'),(uN,'zz-n@zzv.meseo.invalid');
  for i in 1..6 loop insert into auth.users(id, email) values (uSenders[i], 'zz-s'||i||'@zzv.meseo.invalid'); end loop;
  perform set_config('app.alta_valida', 'si', true);
  insert into public.employees(name, venue, role, display_name, auth_user_id) values
    ('zz_a_invalid','zzv','manager','zz',uA), ('zz_b_invalid','zzv','staff','zz',uB),
    ('zz_c_invalid','zzw','manager','zz',uC), ('zz_s_invalid','zzv','staff','zz',uS),
    ('zz_ad_invalid','zzv','admin','zz',uAd), ('zz_victima_invalid','zzv','staff','zz',null),
    ('zz_w_invalid','zzw','staff','zz',null);
  for i in 1..6 loop insert into public.employees(name, venue, role, display_name, auth_user_id) values ('zz_s'||i||'_invalid','zzv','staff','zz',uSenders[i]); end loop;
  for i in 1..11 loop insert into public.employees(name, venue, role, display_name) values ('zz_d'||lpad(i::text,2,'0')||'_invalid','zzv','staff','zz'); end loop;
  insert into public.supervisor_pins(venue, pin_hash) values
    ('zzv', extensions.crypt(PV, extensions.gen_salt('bf'))), ('zzw', extensions.crypt(PW, extensions.gen_salt('bf')));
  execute $ddl$
  create function pg_temp.res(p_uid uuid, p_tipo text, p_target text, p_pin text, p_ev uuid, p_extra jsonb default '{}')
  returns json language plpgsql as $c$
  declare x json;
  begin
    perform set_config('request.jwt.claims', (jsonb_build_object('sub', p_uid, 'role', 'authenticated') || p_extra)::text, true);
    set local role authenticated;
    x := public.push_envio_reservar(p_tipo, p_target, p_pin, p_ev);
    reset role;
    return x;
  end $c$;
  create function pg_temp.srv(p_dest text, p_venue text, p_ev uuid)
  returns json language plpgsql as $c$
  declare x json;
  begin
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
    set local role service_role;
    x := public.push_envio_inactividad(p_dest, p_venue, p_ev);
    reset role;
    return x;
  end $c$;
  $ddl$;

  -- E1 persona válida
  x := pg_temp.res(uA, 'persona', 'ZZ_S_INVALID', null, e1); resp := resp || jsonb_build_array(x::jsonb);
  r := r || jsonb_build_object('E1 persona ok', x::jsonb,
        'E1 fila', (select jsonb_build_object('rem_ok', remitente = uA, 'tipo', tipo, 'venue', venue, 'destino', destino, 'ev_ok', evento_id = e1) from public.push_envios where evento_id = e1));
  -- E2 / E3 idempotencia
  x := pg_temp.res(uA, 'persona', 'zz_s_invalid', null, e1); resp := resp || jsonb_build_array(x::jsonb);
  r := r || jsonb_build_object('E2 mismo evento', x::jsonb);
  x := pg_temp.res(uA, 'persona', 'zz_b_invalid', null, e1); resp := resp || jsonb_build_array(x::jsonb);
  r := r || jsonb_build_object('E3 mismo evento otro destino', x::jsonb,
        'E2/E3 filas con e1', (select count(*) from public.push_envios where evento_id = e1));
  x := pg_temp.res(uS, 'persona', 'zz_s_invalid', null, e1); resp := resp || jsonb_build_array(x::jsonb);
  r := r || jsonb_build_object('E3b mismo evento OTRO remitente', x::jsonb);
  -- E4 formato
  x := pg_temp.res(uA, 'persona', 'zz_s_invalid', null, null); resp := resp || jsonb_build_array(x::jsonb);
  r := r || jsonb_build_object('E4 sin evento_id', x::jsonb);
  -- E5 identidad
  n0 := (select count(*) from public.push_envios);
  x := pg_temp.res(null, 'persona', 'zz_s_invalid', null, gen_random_uuid()); resp := resp || jsonb_build_array(x::jsonb);
  r := r || jsonb_build_object('E5 sin uid', x::jsonb);
  x := pg_temp.res(uN, 'persona', 'zz_s_invalid', null, gen_random_uuid()); resp := resp || jsonb_build_array(x::jsonb);
  r := r || jsonb_build_object('E5 uid sin ficha', x::jsonb);
  -- E6 otro restaurante / inexistente / tipo
  x := pg_temp.res(uA, 'persona', 'zz_w_invalid', null, gen_random_uuid()); resp := resp || jsonb_build_array(x::jsonb);
  r := r || jsonb_build_object('E6 persona de zzw', x::jsonb);
  x := pg_temp.res(uA, 'persona', 'zz_nadie_invalid', null, gen_random_uuid()); resp := resp || jsonb_build_array(x::jsonb);
  r := r || jsonb_build_object('E6 persona inexistente', x::jsonb);
  x := pg_temp.res(uA, 'all', null, null, gen_random_uuid()); resp := resp || jsonb_build_array(x::jsonb);
  r := r || jsonb_build_object('E6 tipo all', x::jsonb);
  x := pg_temp.res(uA, 'persona', 'zz_w_invalid', null, gen_random_uuid(), jsonb_build_object('venue','zzw','role','service_role')); resp := resp || jsonb_build_array(x::jsonb);
  r := r || jsonb_build_object('E6 claims falsos venue zzw', x::jsonb,
        'E5/E6 filas nuevas', (select count(*) from public.push_envios) - n0);
  -- E7 remitente → destinatario: 6 / 10 min (uA ya lleva 1 a zz_s)
  for i in 1..5 loop x := pg_temp.res(uA, 'persona', 'zz_s_invalid', null, gen_random_uuid()); end loop;
  r := r || jsonb_build_object('E7 6º a zz_s', x::jsonb);
  x := pg_temp.res(uA, 'persona', 'zz_s_invalid', null, gen_random_uuid()); resp := resp || jsonb_build_array(x::jsonb);
  r := r || jsonb_build_object('E7 7º a zz_s', x::jsonb,
        'E7 filas uA→zz_s', (select count(*) from public.push_envios where remitente = uA and destino = 'zz_s_invalid'));
  x := pg_temp.res(uA, 'persona', 'zz_b_invalid', null, gen_random_uuid()); resp := resp || jsonb_build_array(x::jsonb);
  r := r || jsonb_build_object('E7 uA a otro destino', x::jsonb);
  -- E8 por remitente: 60 / 10 min (uB: 10 destinos × 6)
  for i in 1..10 loop for j in 1..6 loop
    x := pg_temp.res(uB, 'persona', 'zz_d'||lpad(i::text,2,'0')||'_invalid', null, gen_random_uuid());
    if not (x::jsonb->>'ok')::boolean then r := r || jsonb_build_object('E8 fallo inesperado', jsonb_build_object('i',i,'j',j,'x',x::jsonb)); end if;
  end loop; end loop;
  r := r || jsonb_build_object('E8 filas uB', (select count(*) from public.push_envios where remitente = uB));
  x := pg_temp.res(uB, 'persona', 'zz_d11_invalid', null, gen_random_uuid()); resp := resp || jsonb_build_array(x::jsonb);
  r := r || jsonb_build_object('E8 61º (destino nuevo)', x::jsonb);
  x := pg_temp.res(uB, 'persona', 'zz_b_invalid', null, gen_random_uuid()); resp := resp || jsonb_build_array(x::jsonb);
  r := r || jsonb_build_object('E8 61º bienvenida a sí mismo', x::jsonb,
        'E8 filas uB final', (select count(*) from public.push_envios where remitente = uB));
  -- E9 por destinatario: 30 / 10 min (5 remitentes × 6 a la víctima)
  for i in 1..5 loop for j in 1..6 loop
    x := pg_temp.res(uSenders[i], 'persona', 'zz_victima_invalid', null, gen_random_uuid());
    if not (x::jsonb->>'ok')::boolean then r := r || jsonb_build_object('E9 fallo inesperado', jsonb_build_object('i',i,'j',j,'x',x::jsonb)); end if;
  end loop; end loop;
  r := r || jsonb_build_object('E9 filas a víctima', (select count(*) from public.push_envios where destino = 'zz_victima_invalid'));
  x := pg_temp.res(uSenders[6], 'persona', 'zz_victima_invalid', null, gen_random_uuid()); resp := resp || jsonb_build_array(x::jsonb);
  r := r || jsonb_build_object('E9 31º (6º remitente, su 1º)', x::jsonb);
  x := pg_temp.res(uSenders[6], 'persona', 'zz_s_invalid', null, gen_random_uuid()); resp := resp || jsonb_build_array(x::jsonb);
  r := r || jsonb_build_object('E9 6º remitente a otro', x::jsonb);
  -- E10 restaurante: 3 / 60 min por restaurante
  for i in 1..3 loop x := pg_temp.res(uA, 'restaurante', null, PV, gen_random_uuid()); resp := resp || jsonb_build_array(x::jsonb); end loop;
  r := r || jsonb_build_object('E10 3ª difusión zzv', x::jsonb);
  x := pg_temp.res(uA, 'restaurante', null, PV, gen_random_uuid()); resp := resp || jsonb_build_array(x::jsonb);
  r := r || jsonb_build_object('E10 4ª difusión zzv', x::jsonb,
        'E10 filas restaurante zzv', (select count(*) from public.push_envios where tipo = 'restaurante' and venue = 'zzv'),
        'E10 contadores PIN tras 429', (select count(*) from public.push_pin_intentos));
  x := pg_temp.res(uC, 'restaurante', null, PW, gen_random_uuid()); resp := resp || jsonb_build_array(x::jsonb);
  r := r || jsonb_build_object('E10 zzw no afectado', x::jsonb);
  -- E11 / E12 restaurante denegado (pasa por F1 sin cambios)
  n0 := (select count(*) from public.push_envios);
  x := pg_temp.res(uC, 'restaurante', null, MAL, gen_random_uuid()); resp := resp || jsonb_build_array(x::jsonb);
  r := r || jsonb_build_object('E11 PIN malo', x::jsonb,
        'E11 fallo PIN contado por F1', (select fails from public.push_pin_intentos where clave = 'uid:'||uC));
  x := pg_temp.res(uS, 'restaurante', null, PV, gen_random_uuid()); resp := resp || jsonb_build_array(x::jsonb);
  r := r || jsonb_build_object('E12 staff difunde', x::jsonb);
  x := pg_temp.res(uAd, 'restaurante', null, PV, gen_random_uuid()); resp := resp || jsonb_build_array(x::jsonb);
  r := r || jsonb_build_object('E12 admin difunde', x::jsonb,
        'E11/E12 filas nuevas', (select count(*) from public.push_envios) - n0);
  -- E13 ventana fija: lo de la ventana anterior no cuenta
  delete from public.push_envios where remitente = uA and destino = 'zz_s_invalid';
  for i in 1..6 loop insert into public.push_envios(evento_id, remitente, tipo, venue, destino, created_at)
    values (gen_random_uuid(), uA, 'persona', 'zzv', 'zz_s_invalid', v10 - interval '1 second'); end loop;
  x := pg_temp.res(uA, 'persona', 'zz_s_invalid', null, gen_random_uuid()); resp := resp || jsonb_build_array(x::jsonb);
  r := r || jsonb_build_object('E13 6 en ventana anterior', x::jsonb);
  delete from public.push_envios where remitente = uA and destino = 'zz_s_invalid';
  for i in 1..6 loop insert into public.push_envios(evento_id, remitente, tipo, venue, destino, created_at)
    values (gen_random_uuid(), uA, 'persona', 'zzv', 'zz_s_invalid', v10); end loop;
  x := pg_temp.res(uA, 'persona', 'zz_s_invalid', null, gen_random_uuid()); resp := resp || jsonb_build_array(x::jsonb);
  r := r || jsonb_build_object('E13 6 al inicio de la ventana actual', x::jsonb);
  -- E14 servicio (check-inactive)
  x := pg_temp.srv('zz_victima_invalid', 'zzv', e1); resp := resp || jsonb_build_array(x::jsonb);
  r := r || jsonb_build_object('E14 servicio ok (evento ya usado por uA)', x::jsonb);
  x := pg_temp.srv('zz_victima_invalid', 'zzv', e1); resp := resp || jsonb_build_array(x::jsonb);
  r := r || jsonb_build_object('E14 servicio mismo evento', x::jsonb);
  x := pg_temp.srv('zz_victima_invalid', 'zzv', gen_random_uuid()); resp := resp || jsonb_build_array(x::jsonb);
  r := r || jsonb_build_object('E14 servicio 2º mismo día', x::jsonb);
  x := pg_temp.srv('zz_w_invalid', 'zzw', gen_random_uuid()); resp := resp || jsonb_build_array(x::jsonb);
  r := r || jsonb_build_object('E14 servicio otro destino', x::jsonb);
  x := pg_temp.srv('zz_w_invalid', 'zzv', gen_random_uuid()); resp := resp || jsonb_build_array(x::jsonb);
  r := r || jsonb_build_object('E14 servicio venue ajeno', x::jsonb);
  x := pg_temp.srv('zz_nadie_invalid', 'zzv', gen_random_uuid()); resp := resp || jsonb_build_array(x::jsonb);
  r := r || jsonb_build_object('E14 servicio inexistente', x::jsonb);
  x := pg_temp.srv(null, 'zzv', gen_random_uuid()); resp := resp || jsonb_build_array(x::jsonb);
  r := r || jsonb_build_object('E14 servicio nulos', x::jsonb);
  delete from public.push_envios where tipo = 'servicio' and destino = 'zz_w_invalid';
  insert into public.push_envios(evento_id, remitente, tipo, venue, destino, created_at) values (gen_random_uuid(), null, 'servicio', 'zzw', 'zz_w_invalid', dia - interval '1 second');
  x := pg_temp.srv('zz_w_invalid', 'zzw', gen_random_uuid()); resp := resp || jsonb_build_array(x::jsonb);
  r := r || jsonb_build_object('E14 servicio con aviso de ayer', x::jsonb,
        'E14 filas servicio', (select count(*) from public.push_envios where tipo = 'servicio'));
  -- E15 ACL efectivas
  begin set local role anon; perform public.push_envio_reservar('persona', 'zz_s_invalid', null, gen_random_uuid()); reset role; r := r || '{"E15 anon reservar":"EJECUTÓ"}';
  exception when insufficient_privilege then reset role; r := r || '{"E15 anon reservar":"42501"}'; end;
  begin set local role service_role; perform public.push_envio_reservar('persona', 'zz_s_invalid', null, gen_random_uuid()); reset role; r := r || '{"E15 service_role reservar":"EJECUTÓ"}';
  exception when insufficient_privilege then reset role; r := r || '{"E15 service_role reservar":"42501"}'; end;
  begin perform set_config('request.jwt.claims', jsonb_build_object('sub', uA, 'role', 'authenticated')::text, true);
    set local role authenticated; perform public.push_envio_inactividad('zz_s_invalid', 'zzv', gen_random_uuid()); reset role; r := r || '{"E15 authenticated inactividad":"EJECUTÓ"}';
  exception when insufficient_privilege then reset role; r := r || '{"E15 authenticated inactividad":"42501"}'; end;
  begin set local role anon; perform public.push_envio_inactividad('zz_s_invalid', 'zzv', gen_random_uuid()); reset role; r := r || '{"E15 anon inactividad":"EJECUTÓ"}';
  exception when insufficient_privilege then reset role; r := r || '{"E15 anon inactividad":"42501"}'; end;
  begin set local role authenticated; perform count(*) from public.push_envios; reset role; r := r || '{"E15 authenticated lee tabla":"LEYÓ"}';
  exception when insufficient_privilege then reset role; r := r || '{"E15 authenticated lee tabla":"42501"}'; end;
  begin set local role service_role; perform count(*) from public.push_envios; reset role; r := r || '{"E15 service_role lee tabla":"LEYÓ"}';
  exception when insufficient_privilege then reset role; r := r || '{"E15 service_role lee tabla":"42501"}'; end;
  begin set local role service_role; insert into public.push_envios(evento_id, remitente, tipo, venue, destino) values (gen_random_uuid(), null, 'servicio', 'zzv', 'zz_s_invalid'); reset role; r := r || '{"E15 service_role inserta":"INSERTÓ"}';
  exception when insufficient_privilege then reset role; r := r || '{"E15 service_role inserta":"42501"}'; end;
  -- E16 restricción única como red de seguridad (evento dedicado, misma (remitente, evento_id) dos veces)
  declare e16 uuid := gen_random_uuid();
  begin
    insert into public.push_envios(evento_id, remitente, tipo, venue, destino) values (e16, uA, 'persona', 'zzv', 'zz_s_invalid');
    r := r || jsonb_build_object('E16 1er insert usuario', (select count(*) from public.push_envios where remitente = uA and evento_id = e16));
    begin insert into public.push_envios(evento_id, remitente, tipo, venue, destino) values (e16, uA, 'persona', 'zzv', 'zz_s_invalid'); r := r || '{"E16 duplicado usuario":"INSERTÓ"}';
    exception when unique_violation then r := r || '{"E16 duplicado usuario":"23505"}'; end;
    insert into public.push_envios(evento_id, remitente, tipo, venue, destino) values (e16, null, 'servicio', 'zzv', 'zz_s_invalid');
    r := r || jsonb_build_object('E16 1er insert servicio (null)', (select count(*) from public.push_envios where remitente is null and evento_id = e16));
    begin insert into public.push_envios(evento_id, remitente, tipo, venue, destino) values (e16, null, 'servicio', 'zzv', 'zz_s_invalid'); r := r || '{"E16 duplicado servicio (null)":"INSERTÓ"}';
    exception when unique_violation then r := r || '{"E16 duplicado servicio (null)":"23505"}'; end;
    r := r || jsonb_build_object('E16 filas con e16', (select count(*) from public.push_envios where evento_id = e16));
  end;
  begin insert into public.push_envios(evento_id, remitente, tipo, venue, destino) values (gen_random_uuid(), uA, 'restaurante', 'zzv', 'zz_s_invalid'); r := r || '{"E16 forma inválida":"INSERTÓ"}';
  exception when check_violation then r := r || '{"E16 forma inválida":"23514"}'; end;
  -- E17 respuestas
  r := r || jsonb_build_object('E17 respuestas', jsonb_array_length(resp),
    'E17 claves usadas', (select jsonb_agg(distinct k) from jsonb_array_elements(resp) e, jsonb_object_keys(e) k),
    'E17 errores usados', (select jsonb_agg(distinct e->>'error') from jsonb_array_elements(resp) e where e ? 'error'),
    'E17 limite exacto', (select bool_and(e = '{"ok":false,"error":"limite"}'::jsonb) from jsonb_array_elements(resp) e where e->>'error' = 'limite'),
    'E17 PIN/hash/secreto/uuid', (resp::text ~ 'zz-pin-|zz-mal-|\$2[aby]\$|eyJ|service_role|[0-9a-f]{8}-[0-9a-f]{4}-'),
    'E17 venues', (select jsonb_agg(distinct e->>'venue') from jsonb_array_elements(resp) e where e ? 'venue'),
    'segundos', round(extract(epoch from clock_timestamp() - t0)::numeric, 1));
  raise exception 'RESULTADO %', r;
end $t$;
