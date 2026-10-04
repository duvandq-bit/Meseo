-- F2 · M8-A · Prueba funcional de push_suscripcion_registrar (rama f2-push)
-- Un solo bloque. Todo se deshace al final con raise exception 'RESULTADO %'.
-- Válido ANTES y DESPUÉS de B+: los casos de vía directa (P1–P3) informan del
-- estado de los permisos en lugar de dar por hecho uno u otro.
DO $t$
declare
  r jsonb := '{}'; x json; n int; t0 timestamptz := clock_timestamp(); resp jsonb := '[]';
  uA uuid := gen_random_uuid(); uB uuid := gen_random_uuid(); uC uuid := gen_random_uuid(); uN uuid := gen_random_uuid();
  ep1 text := 'https://fcm.googleapis.com/fcm/send/zz-m8a-ep1';
  ep2 text := 'https://web.push.apple.com/zz-m8a-ep2';
  ep3 text := 'https://fcm.googleapis.com/fcm/send/zz-m8a-ep3';
  ep4 text := 'https://web.push.apple.com/zz-m8a-ep4';
  ep5 text := 'https://fcm.googleapis.com/fcm/send/zz-m8a-ep5';
  ep6 text := 'https://fcm.googleapis.com/fcm/send/zz-m8a-ep6';
  kp1 text := repeat('A', 87); kp2 text := repeat('B', 87);
  ka1 text := repeat('a', 22); ka2 text := repeat('b', 22);
  id_a bigint; ca_a timestamptz; total0 int;
begin
  insert into auth.users(id, email) values
    (uA,'zz-m8a-a@zzv.meseo.invalid'),(uB,'zz-m8a-b@zzv.meseo.invalid'),
    (uC,'zz-m8a-c@zzw.meseo.invalid'),(uN,'zz-m8a-n@zzv.meseo.invalid');
  perform set_config('app.alta_valida', 'si', true);
  insert into public.employees(name, venue, role, display_name, auth_user_id) values
    ('zz_m8a_a_invalid','zzv','staff','zz',uA), ('zz_m8a_b_invalid','zzv','staff','zz',uB),
    ('zz_m8a_c_invalid','zzw','staff','zz',uC);
  execute $ddl$
  create function pg_temp.reg(p_uid uuid, p_ep text, p_p text, p_a text, p_extra jsonb default '{}')
  returns json language plpgsql as $c$
  declare x json;
  begin
    perform set_config('request.jwt.claims', (jsonb_build_object('sub', p_uid, 'role', 'authenticated') || p_extra)::text, true);
    set local role authenticated;
    x := public.push_suscripcion_registrar(p_ep, p_p, p_a);
    reset role;
    return x;
  end $c$;
  create function pg_temp.borrar(p_uid uuid, p_ep text) returns int language plpgsql as $c$
  declare k int;
  begin
    perform set_config('request.jwt.claims', jsonb_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
    set local role authenticated;
    delete from public.push_subscriptions where endpoint = p_ep;
    get diagnostics k = row_count;
    reset role;
    return k;
  end $c$;
  create function pg_temp.ver(p_uid uuid) returns int language plpgsql as $c$
  declare k int;
  begin
    perform set_config('request.jwt.claims', jsonb_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select count(*) into k from public.push_subscriptions;
    reset role;
    return k;
  end $c$;
  $ddl$;

  -- T1 alta
  x := pg_temp.reg(uA, ep1, kp1, ka1); resp := resp || jsonb_build_array(x::jsonb);
  select id, created_at into id_a, ca_a from public.push_subscriptions where endpoint = ep1;
  r := r || jsonb_build_object('T1 alta', x::jsonb,
        'T1 fila', (select jsonb_build_object('nombre', employee_name, 'venue', venue, 'claves_ok', keys_p256dh = kp1 and keys_auth = ka1) from public.push_subscriptions where endpoint = ep1),
        'T1 candado e:ep1 tomado por esta transacción', (select count(*) from pg_locks where locktype = 'advisory' and pid = pg_backend_pid() and granted
            and classid = hashtext('push_subscriptions')::oid and objid = hashtext('e:' || ep1)::oid and objsubid = 2));
  -- T2 idempotencia
  x := pg_temp.reg(uA, ep1, kp1, ka1); resp := resp || jsonb_build_array(x::jsonb);
  r := r || jsonb_build_object('T2 repetición', x::jsonb,
        'T2 filas ep1', (select count(*) from public.push_subscriptions where endpoint = ep1),
        'T2 mismo id y created_at', (select id = id_a and created_at = ca_a from public.push_subscriptions where endpoint = ep1));
  -- T3 claves nuevas
  x := pg_temp.reg(uA, ep1, kp2, ka2); resp := resp || jsonb_build_array(x::jsonb);
  r := r || jsonb_build_object('T3 claves nuevas', x::jsonb,
        'T3 claves actualizadas y mismo id', (select keys_p256dh = kp2 and keys_auth = ka2 and id = id_a from public.push_subscriptions where endpoint = ep1),
        'T3 filas ep1', (select count(*) from public.push_subscriptions where endpoint = ep1));
  -- T4 reasignación A → B
  x := pg_temp.reg(uB, ep1, kp1, ka1); resp := resp || jsonb_build_array(x::jsonb);
  r := r || jsonb_build_object('T4 B registra ep1 de A', x::jsonb,
        'T4 filas ep1', (select count(*) from public.push_subscriptions where endpoint = ep1),
        'T4 dueño ep1', (select employee_name from public.push_subscriptions where endpoint = ep1),
        'T4 filas de A con ep1', (select count(*) from public.push_subscriptions where endpoint = ep1 and employee_name = 'zz_m8a_a_invalid'),
        'T4 id nuevo', (select id <> id_a from public.push_subscriptions where endpoint = ep1));
  -- T5 identidad
  total0 := (select count(*) from public.push_subscriptions);
  x := pg_temp.reg(uN, ep2, kp1, ka1); resp := resp || jsonb_build_array(x::jsonb);
  r := r || jsonb_build_object('T5 uid sin ficha', x::jsonb);
  x := pg_temp.reg(null, ep2, kp1, ka1); resp := resp || jsonb_build_array(x::jsonb);
  r := r || jsonb_build_object('T5b sin uid', x::jsonb, 'T5 filas nuevas', (select count(*) from public.push_subscriptions) - total0);
  -- T6 / T7 ACL efectiva
  begin set local role anon; perform public.push_suscripcion_registrar(ep2, kp1, ka1); reset role; r := r || '{"T6 anon":"EJECUTÓ"}';
  exception when insufficient_privilege then reset role; r := r || '{"T6 anon":"42501"}'; end;
  begin perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
    set local role service_role; perform public.push_suscripcion_registrar(ep2, kp1, ka1); reset role; r := r || '{"T7 service_role":"EJECUTÓ"}';
  exception when insufficient_privilege then reset role; r := r || '{"T7 service_role":"42501"}'; end;
  -- T8 claims falsos: C (zzw) dice ser de zzv y service_role
  x := pg_temp.reg(uC, ep3, kp1, ka1, jsonb_build_object('venue','zzv','role','service_role','employee_name','zz_m8a_a_invalid')); resp := resp || jsonb_build_array(x::jsonb);
  r := r || jsonb_build_object('T8 claims falsos', x::jsonb,
        'T8 fila', (select jsonb_build_object('nombre', employee_name, 'venue', venue) from public.push_subscriptions where endpoint = ep3));
  -- T9–T15 formato (ninguno escribe)
  total0 := (select count(*) from public.push_subscriptions);
  x := pg_temp.reg(uA, 'https://evil.example.com/zz', kp1, ka1); resp := resp || jsonb_build_array(x::jsonb); r := r || jsonb_build_object('T9 host incorrecto', x::jsonb);
  x := pg_temp.reg(uA, 'https://fcm.googleapis.com.evil.example/zz', kp1, ka1); resp := resp || jsonb_build_array(x::jsonb); r := r || jsonb_build_object('T9b host prefijo engañoso', x::jsonb);
  x := pg_temp.reg(uA, 'http://fcm.googleapis.com/zz', kp1, ka1); resp := resp || jsonb_build_array(x::jsonb); r := r || jsonb_build_object('T10 http', x::jsonb);
  x := pg_temp.reg(uA, 'https://fcm.googleapis.com/' || repeat('x', 998), kp1, ka1); resp := resp || jsonb_build_array(x::jsonb); r := r || jsonb_build_object('T11 endpoint 1025', x::jsonb);
  x := pg_temp.reg(uA, null, kp1, ka1); resp := resp || jsonb_build_array(x::jsonb); r := r || jsonb_build_object('T11b endpoint nulo', x::jsonb);
  x := pg_temp.reg(uA, ep2, repeat('A', 86), ka1); resp := resp || jsonb_build_array(x::jsonb); r := r || jsonb_build_object('T12 p256dh 86', x::jsonb);
  x := pg_temp.reg(uA, ep2, repeat('A', 88), ka1); resp := resp || jsonb_build_array(x::jsonb); r := r || jsonb_build_object('T12b p256dh 88', x::jsonb);
  x := pg_temp.reg(uA, ep2, repeat('A', 86) || '+', ka1); resp := resp || jsonb_build_array(x::jsonb); r := r || jsonb_build_object('T13 p256dh con +', x::jsonb);
  x := pg_temp.reg(uA, ep2, repeat('A', 86) || '/', ka1); resp := resp || jsonb_build_array(x::jsonb); r := r || jsonb_build_object('T13b p256dh con /', x::jsonb);
  x := pg_temp.reg(uA, ep2, null, ka1); resp := resp || jsonb_build_array(x::jsonb); r := r || jsonb_build_object('T13c p256dh nulo', x::jsonb);
  x := pg_temp.reg(uA, ep2, kp1, repeat('a', 21)); resp := resp || jsonb_build_array(x::jsonb); r := r || jsonb_build_object('T14 auth 21', x::jsonb);
  x := pg_temp.reg(uA, ep2, kp1, repeat('a', 23)); resp := resp || jsonb_build_array(x::jsonb); r := r || jsonb_build_object('T14b auth 23', x::jsonb);
  x := pg_temp.reg(uA, ep2, kp1, repeat('a', 22) || '=='); resp := resp || jsonb_build_array(x::jsonb); r := r || jsonb_build_object('T15 auth con relleno ==', x::jsonb);
  x := pg_temp.reg(uA, ep2, kp1, repeat('a', 21) || '='); resp := resp || jsonb_build_array(x::jsonb); r := r || jsonb_build_object('T15b auth 22 con =', x::jsonb);
  x := pg_temp.reg(uA, ep2, kp1, null); resp := resp || jsonb_build_array(x::jsonb); r := r || jsonb_build_object('T15c auth nulo', x::jsonb);
  r := r || jsonb_build_object('T9–T15 filas nuevas', (select count(*) from public.push_subscriptions) - total0);
  x := pg_temp.reg(uA, 'https://fcm.googleapis.com/' || repeat('x', 997), kp1, ka1); resp := resp || jsonb_build_array(x::jsonb);
  r := r || jsonb_build_object('T11c endpoint de 1024 exactos (límite)', x::jsonb);
  delete from public.push_subscriptions where endpoint = 'https://fcm.googleapis.com/' || repeat('x', 997);
  -- T16 entre restaurantes: C (zzw) registra ep1, que es de B (zzv)
  x := pg_temp.reg(uC, ep1, kp2, ka2); resp := resp || jsonb_build_array(x::jsonb);
  r := r || jsonb_build_object('T16 C de zzw registra ep1 de B de zzv', x::jsonb,
        'T16 fila ep1', (select jsonb_agg(jsonb_build_object('nombre', employee_name, 'venue', venue)) from public.push_subscriptions where endpoint = ep1));
  -- T18 borrar lo ajeno (antes de T17 para que haya algo ajeno)
  n := pg_temp.borrar(uA, ep1); r := r || jsonb_build_object('T18 A borra ep1 (de C)', n);
  n := pg_temp.borrar(uB, ep3); r := r || jsonb_build_object('T18b B borra ep3 (de C)', n,
        'T18 filas de C intactas', (select count(*) from public.push_subscriptions where employee_name = 'zz_m8a_c_invalid'));
  r := r || jsonb_build_object('T18c A ve filas ajenas', pg_temp.ver(uA));
  -- T17 borrar lo propio
  n := pg_temp.borrar(uC, ep1); r := r || jsonb_build_object('T17 C borra su ep1', n,
        'T17 C conserva ep3', (select count(*) from public.push_subscriptions where endpoint = ep3 and employee_name = 'zz_m8a_c_invalid'));
  -- T19 mismo usuario, dos dispositivos
  x := pg_temp.reg(uA, ep4, kp1, ka1); resp := resp || jsonb_build_array(x::jsonb);
  x := pg_temp.reg(uA, ep5, kp1, ka1); resp := resp || jsonb_build_array(x::jsonb);
  r := r || jsonb_build_object('T19 A con ep4 y ep5', (select count(*) from public.push_subscriptions where employee_name = 'zz_m8a_a_invalid' and endpoint in (ep4, ep5)),
        'T19 A ve sus filas', pg_temp.ver(uA));
  -- T20 ACL y propiedades de la función
  r := r || jsonb_build_object('T20 función', (select jsonb_build_object('acl', proacl::text, 'security_definer', prosecdef, 'volatil', provolatile::text, 'search_path', proconfig::text, 'dueño', proowner::regrole::text)
                                  from pg_proc where oid = 'public.push_suscripcion_registrar(text,text,text)'::regprocedure));
  -- T21 campos del servidor dentro de la RPC (nombre, venue, created_at)
  r := r || jsonb_build_object('T21 filas con nombre/venue de su ficha', (select count(*) from public.push_subscriptions s join public.employees e on e.name = s.employee_name and e.venue = s.venue where s.endpoint like '%zz-m8a-%'),
        'T21 filas sintéticas', (select count(*) from public.push_subscriptions where endpoint like '%zz-m8a-%'),
        'T21 created_at = now() del servidor', (select bool_and(created_at = now()) from public.push_subscriptions where endpoint like '%zz-m8a-%'),
        'T21 trigger activo', (select tgenabled::text from pg_trigger where tgname = 'trg_push_subscriptions_propietario'));
  -- T23 un endpoint, un dueño (antes de la demostración de vía directa)
  r := r || jsonb_build_object('T23 endpoints con más de un dueño', (select count(*) from (select endpoint from public.push_subscriptions group by endpoint having count(*) > 1) d));
  -- P1–P3 vía directa (informa del estado de B+; ver documentación)
  begin
    perform set_config('request.jwt.claims', jsonb_build_object('sub', uA, 'role', 'authenticated')::text, true);
    set local role authenticated;
    insert into public.push_subscriptions(employee_name, venue, endpoint, keys_p256dh, keys_auth)
    values ('zz_m8a_c_invalid', 'zzw', ep3, kp1, ka1);
    reset role;
    r := r || jsonb_build_object('P1 INSERT directo de A con ep3 de C', 'ENTRÓ',
          'P1 dueños de ep3', (select jsonb_agg(employee_name || '/' || venue order by employee_name) from public.push_subscriptions where endpoint = ep3));
  exception when insufficient_privilege then reset role; r := r || '{"P1 INSERT directo de A con ep3 de C":"42501"}';
  end;
  begin
    perform set_config('request.jwt.claims', jsonb_build_object('sub', uA, 'role', 'authenticated')::text, true);
    set local role authenticated;
    update public.push_subscriptions set keys_auth = ka2 where endpoint in (ep4, ep3);
    get diagnostics n = row_count;
    reset role;
    r := r || jsonb_build_object('P2 UPDATE directo de A', 'filas=' || n);
  exception when insufficient_privilege then reset role; r := r || '{"P2 UPDATE directo de A":"42501"}';
  end;
  r := r || jsonb_build_object('P3 política push_propias_insert', (select count(*) from pg_policies where schemaname = 'public' and tablename = 'push_subscriptions' and policyname = 'push_propias_insert'),
        'P3 ACL tabla', (select relacl::text from pg_class where oid = 'public.push_subscriptions'::regclass));
  -- T22 respuestas
  r := r || jsonb_build_object('T22 respuestas', jsonb_array_length(resp),
    'T22 respuestas distintas', (select jsonb_agg(distinct e) from jsonb_array_elements(resp) e),
    'T22 fuga de claves/uuid/nombre', (resp::text ~ 'AAAA|aaaa|zz_m8a|[0-9a-f]{8}-[0-9a-f]{4}-|zz-m8a'),
    'segundos', round(extract(epoch from clock_timestamp() - t0)::numeric, 2));
  raise exception 'RESULTADO %', r;
end $t$;
