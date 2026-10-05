-- F2 · D7 · Prueba funcional del hardening de public.notifications (rama f2-push)
-- Ejecutar DESPUÉS de f2_h_notifications_hardening. Un solo bloque: todo se deshace
-- al final con raise exception 'RESULTADO %'. Cada operación devuelve:
--   ok:<filas>   la sentencia se ejecutó (filas afectadas o contadas)
--   PRIV         42501 por falta de permiso (tabla o columna)
--   RLS          42501 por política de RLS ("violates row-level security policy")
--   <SQLSTATE>   cualquier otro error
DO $t$
declare
  r jsonb := '{}';
  uA uuid := gen_random_uuid(); uA2 uuid := gen_random_uuid(); uM uuid := gen_random_uuid();
  uAd uuid := gen_random_uuid(); uW uuid := gen_random_uuid(); uN uuid := gen_random_uuid();
  n_a bigint; n_a2 bigint; n_allv bigint; n_w bigint; n_allw bigint; total int;
begin
  insert into auth.users(id, email) values
    (uA,'zz-h-a@zzv.meseo.invalid'),(uA2,'zz-h-a2@zzv.meseo.invalid'),(uM,'zz-h-m@zzv.meseo.invalid'),
    (uAd,'zz-h-ad@zzv.meseo.invalid'),(uW,'zz-h-w@zzw.meseo.invalid'),(uN,'zz-h-n@zzv.meseo.invalid');
  perform set_config('app.alta_valida', 'si', true);
  insert into public.employees(name, venue, role, display_name, auth_user_id) values
    ('zz_h_a_invalid','zzv','staff','zz',uA), ('zz_h_a2_invalid','zzv','staff','zz',uA2),
    ('zz_h_m_invalid','zzv','manager','zz',uM), ('zz_h_ad_invalid','zzv','admin','zz',uAd),
    ('zz_h_w_invalid','zzw','staff','zz',uW);
  insert into public.notifications(target, message, type, venue) values ('zz_h_a_invalid','zz para A','info','zzv') returning id into n_a;
  insert into public.notifications(target, message, type, venue) values ('zz_h_a2_invalid','zz para A2','info','zzv') returning id into n_a2;
  insert into public.notifications(target, message, type, venue) values ('all','zz todos zzv','info','zzv') returning id into n_allv;
  insert into public.notifications(target, message, type, venue) values ('zz_h_w_invalid','zz para W','info','zzw') returning id into n_w;
  insert into public.notifications(target, message, type, venue) values ('all','zz todos zzw','info','zzw') returning id into n_allw;

  execute $ddl$
  create function pg_temp.ej(p_uid uuid, p_sql text) returns text language plpgsql as $c$
  declare k int;
  begin
    if p_uid is null then
      perform set_config('request.jwt.claims', '', true);
      set local role anon;
    else
      perform set_config('request.jwt.claims', jsonb_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
      set local role authenticated;
    end if;
    begin
      execute p_sql;
      get diagnostics k = row_count;
      reset role;
      return 'ok:' || k;
    exception when others then
      reset role;
      if sqlstate = '42501' and sqlerrm ilike '%row-level security%' then return 'RLS'; end if;
      if sqlstate = '42501' then return 'PRIV'; end if;
      return sqlstate;
    end;
  end $c$;
  create function pg_temp.cuenta(p_uid uuid, p_where text) returns text language plpgsql as $c$
  declare k int;
  begin
    if p_uid is null then
      perform set_config('request.jwt.claims', '', true);
      set local role anon;
    else
      perform set_config('request.jwt.claims', jsonb_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
      set local role authenticated;
    end if;
    begin
      execute 'select count(*) from public.notifications where ' || p_where into k;
      reset role;
      return 'ok:' || k;
    exception when others then
      reset role;
      if sqlstate = '42501' then return 'PRIV'; end if;
      return sqlstate;
    end;
  end $c$;
  $ddl$;

  -- N1 anon cerrado
  r := r || jsonb_build_object('N1 anon SELECT', pg_temp.cuenta(null, 'true'),
    'N1 anon INSERT', pg_temp.ej(null, $$insert into public.notifications(target, message, type, read, venue) values ('all','zz','info',false,'zzv')$$),
    'N1 anon UPDATE', pg_temp.ej(null, format('update public.notifications set read = true where id = %s', n_a)),
    'N1 anon DELETE', pg_temp.ej(null, format('delete from public.notifications where id = %s', n_a)));
  -- N2 A lee lo propio y 'all' de zzv
  r := r || jsonb_build_object('N2 A ve en total', pg_temp.cuenta(uA, 'true'),
    'N2 A ve la suya', pg_temp.cuenta(uA, format('id = %s', n_a)),
    'N2 A ve all de zzv', pg_temp.cuenta(uA, format('id = %s', n_allv)),
    'N2 A ve la de A2', pg_temp.cuenta(uA, format('id = %s', n_a2)),
    'N2 A ve algo de zzw', pg_temp.cuenta(uA, format('id in (%s,%s)', n_w, n_allw)));
  -- N3 A → A2 (mismo restaurante, info)
  r := r || jsonb_build_object('N3 A inserta para A2 info',
    pg_temp.ej(uA, $$insert into public.notifications(target, message, type, read, venue) values ('zz_h_a2_invalid','zz mención','info',false,'zzv')$$));
  -- N4 A → W (otro restaurante)
  r := r || jsonb_build_object('N4 A para W con venue zzv',
    pg_temp.ej(uA, $$insert into public.notifications(target, message, type, read, venue) values ('zz_h_w_invalid','zz','info',false,'zzv')$$),
    'N4b A para W con venue zzw',
    pg_temp.ej(uA, $$insert into public.notifications(target, message, type, read, venue) values ('zz_h_w_invalid','zz','info',false,'zzw')$$));
  -- N5 'all' por rol
  r := r || jsonb_build_object('N5 staff A para all',
    pg_temp.ej(uA, $$insert into public.notifications(target, message, type, read, venue) values ('all','zz','info',false,'zzv')$$),
    'N5b manager M para all',
    pg_temp.ej(uM, $$insert into public.notifications(target, message, type, read, venue) values ('all','zz aviso','info',false,'zzv')$$),
    'N5c admin Ad para all',
    pg_temp.ej(uAd, $$insert into public.notifications(target, message, type, read, venue) values ('all','zz','info',false,'zzv')$$));
  -- N6 venue falso
  r := r || jsonb_build_object('N6 M all con venue zzw',
    pg_temp.ej(uM, $$insert into public.notifications(target, message, type, read, venue) values ('all','zz','info',false,'zzw')$$),
    'N6b A para A2 con venue zzw',
    pg_temp.ej(uA, $$insert into public.notifications(target, message, type, read, venue) values ('zz_h_a2_invalid','zz','info',false,'zzw')$$));
  -- N7 tipos por rol
  r := r || jsonb_build_object('N7 staff A tipo urgent',
    pg_temp.ej(uA, $$insert into public.notifications(target, message, type, read, venue) values ('zz_h_a2_invalid','zz','urgent',false,'zzv')$$),
    'N7b manager M tipo urgent',
    pg_temp.ej(uM, $$insert into public.notifications(target, message, type, read, venue) values ('zz_h_a_invalid','zz','urgent',false,'zzv')$$),
    'N7c manager M tipo hack',
    pg_temp.ej(uM, $$insert into public.notifications(target, message, type, read, venue) values ('zz_h_a_invalid','zz','hack',false,'zzv')$$),
    'N7d staff A tipo duel',
    pg_temp.ej(uA, $$insert into public.notifications(target, message, type, read, venue) values ('zz_h_a2_invalid','zz reto','duel',false,'zzv')$$),
    'N7e staff A sin tipo (default info)',
    pg_temp.ej(uA, $$insert into public.notifications(target, message, read, venue) values ('zz_h_a2_invalid','zz sin tipo',false,'zzv')$$));
  -- N8 mensaje y read
  r := r || jsonb_build_object('N8 mensaje vacío',
    pg_temp.ej(uA, $$insert into public.notifications(target, message, type, read, venue) values ('zz_h_a2_invalid','','info',false,'zzv')$$),
    'N8b mensaje 501',
    pg_temp.ej(uA, $$insert into public.notifications(target, message, type, read, venue) values ('zz_h_a2_invalid',repeat('z',501),'info',false,'zzv')$$),
    'N8c mensaje 500 (límite)',
    pg_temp.ej(uA, $$insert into public.notifications(target, message, type, read, venue) values ('zz_h_a2_invalid',repeat('z',500),'info',false,'zzv')$$),
    'N8d read=true al insertar',
    pg_temp.ej(uA, $$insert into public.notifications(target, message, type, read, venue) values ('zz_h_a2_invalid','zz','info',true,'zzv')$$));
  -- N9 columnas del servidor
  r := r || jsonb_build_object('N9 A con created_at',
    pg_temp.ej(uA, $$insert into public.notifications(target, message, type, read, venue, created_at) values ('zz_h_a2_invalid','zz','info',false,'zzv','2000-01-01')$$),
    'N9b A con id',
    pg_temp.ej(uA, $$insert into public.notifications(id, target, message, type, read, venue) overriding system value values (999999,'zz_h_a2_invalid','zz','info',false,'zzv')$$),
    'N9c A sin id ni created_at (normal)',
    pg_temp.ej(uA, $$insert into public.notifications(target, message, type, read, venue) values ('zz_h_a2_invalid','zz normal','info',false,'zzv')$$));
  -- N10 marcar como leída
  r := r || jsonb_build_object('N10 A marca la suya',
    pg_temp.ej(uA, format('update public.notifications set read = true where id = %s', n_a)),
    'N10b A marca la de A2',
    pg_temp.ej(uA, format('update public.notifications set read = true where id = %s', n_a2)),
    'N10c A marca all de zzv',
    pg_temp.ej(uA, format('update public.notifications set read = true where id = %s', n_allv)));
  -- N11 otras modificaciones
  r := r || jsonb_build_object('N11 A vuelve read=false',
    pg_temp.ej(uA, format('update public.notifications set read = false where id = %s', n_a)),
    'N11b A cambia message',
    pg_temp.ej(uA, format($$update public.notifications set message = 'zz cambiado' where id = %s$$, n_a)),
    'N11c A cambia target',
    pg_temp.ej(uA, format($$update public.notifications set target = 'zz_h_a2_invalid' where id = %s$$, n_a)),
    'N11d estado de la fila de A tras N11', (select jsonb_build_object('read', read, 'message', message, 'target', target) from public.notifications where id = n_a));
  -- N12 borrar / vaciar
  r := r || jsonb_build_object('N12 A borra la suya',
    pg_temp.ej(uA, format('delete from public.notifications where id = %s', n_a)),
    'N12b A TRUNCATE', pg_temp.ej(uA, 'truncate public.notifications'),
    'N12c filas sintéticas tras N12', (select count(*) from public.notifications where message like 'zz%'));
  -- N13 entre restaurantes
  r := r || jsonb_build_object('N13 W ve algo de zzv', pg_temp.cuenta(uW, 'venue = ''zzv'''),
    'N13b W ve lo suyo y all de zzw', pg_temp.cuenta(uW, 'true'),
    'N13c W inserta para A con venue zzv',
    pg_temp.ej(uW, $$insert into public.notifications(target, message, type, read, venue) values ('zz_h_a_invalid','zz','info',false,'zzv')$$),
    'N13d W inserta para A con venue zzw',
    pg_temp.ej(uW, $$insert into public.notifications(target, message, type, read, venue) values ('zz_h_a_invalid','zz','info',false,'zzw')$$),
    'N13e W marca la de A',
    pg_temp.ej(uW, format('update public.notifications set read = true where id = %s', n_a)));
  -- N14 uid sin ficha
  r := r || jsonb_build_object('N14 sin ficha ve', pg_temp.cuenta(uN, 'true'),
    'N14b sin ficha inserta',
    pg_temp.ej(uN, $$insert into public.notifications(target, message, type, read, venue) values ('zz_h_a_invalid','zz','info',false,'zzv')$$));
  -- N15 service_role (camino de check-inactive)
  begin
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
    set local role service_role;
    insert into public.notifications(target, venue, message, type, read) values ('zz_h_a_invalid','zzv','zz aviso de inactividad','warning',false);
    select count(*) into total from public.notifications;
    reset role;
    r := r || jsonb_build_object('N15 service_role inserta y lee', 'ok', 'N15 service_role ve filas', total);
  exception when others then
    reset role;
    r := r || jsonb_build_object('N15 service_role inserta y lee', sqlstate || ' ' || sqlerrm);
  end;
  -- N16 catálogo
  r := r || jsonb_build_object('N16 políticas', (select jsonb_agg(policyname || ' ' || cmd || ' ' || array_to_string(roles, ',') order by policyname) from pg_policies where schemaname = 'public' and tablename = 'notifications'),
    'N16 ACL tabla', (select relacl::text from pg_class where oid = 'public.notifications'::regclass),
    'N16 ACL columnas', (select jsonb_agg(attname || ':' || attacl::text order by attnum) from pg_attribute where attrelid = 'public.notifications'::regclass and attacl is not null),
    'N16 ACL secuencia', (select relacl::text from pg_class where oid = 'public.notifications_id_seq'::regclass),
    'N16 índices', (select jsonb_agg(indexname order by indexname) from pg_indexes where schemaname = 'public' and tablename = 'notifications'),
    'N16 RLS', (select relrowsecurity || '/' || relforcerowsecurity from pg_class where oid = 'public.notifications'::regclass));
  -- N17 congelados
  r := r || jsonb_build_object('N17 md5', jsonb_build_object(
    'push_autorizar', md5(pg_get_functiondef('public.push_autorizar(text,text,text)'::regprocedure)),
    '_push_pin_evaluar', md5(pg_get_functiondef('public._push_pin_evaluar(text)'::regprocedure)),
    '_push_pin_fallo', md5(pg_get_functiondef('public._push_pin_fallo(text,integer)'::regprocedure)),
    'push_envio_reservar', md5(pg_get_functiondef('public.push_envio_reservar(text,text,text,uuid)'::regprocedure)),
    'push_envio_inactividad', md5(pg_get_functiondef('public.push_envio_inactividad(text,text,uuid)'::regprocedure)),
    'push_suscripcion_registrar', md5(pg_get_functiondef('public.push_suscripcion_registrar(text,text,text)'::regprocedure))),
    'N17 ACL push_subscriptions', (select relacl::text from pg_class where oid = 'public.push_subscriptions'::regclass),
    'N17 políticas push_subscriptions', (select jsonb_agg(policyname order by policyname) from pg_policies where tablename = 'push_subscriptions'),
    'N17 ACL push_envios', (select relacl::text from pg_class where oid = 'public.push_envios'::regclass));
  -- N18 lo que se deshará
  r := r || jsonb_build_object('N18 filas sintéticas antes del rollback', (select count(*) from public.notifications));
  raise exception 'RESULTADO %', r;
end $t$;
