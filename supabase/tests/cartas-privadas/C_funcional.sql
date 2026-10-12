-- Meseo · prueba funcional de public.cartas (rama f2-push)
-- Cada bloque usa identidades sintéticas y se deshace al final con
-- raise exception 'RESULTADO %', que lleva el resultado de cada caso.
--
-- EVIDENCIA EN f2-push (6 oct 2026), sobre el esquema final (tras
-- cartas_privadas + cartas_privadas_sin_service_role):
--   EMPÍRICO (ejecutado, con su resultado):
--     C1 anon SELECT ............................ denegado 42501
--     C2 personal de otro restaurante SELECT .... 0 filas
--     C3 personal de su restaurante SELECT ...... 1 fila
--     C4 admin (ficha de otro restaurante) ...... 1 fila
--     C5 token sin ficha ........................ 0 filas
--     C6 rol admin plantado en el token ......... 0 filas
--     C7a authenticated INSERT .................. denegado 42501
--     C7b authenticated UPDATE .................. denegado 42501
--     S1  service_role INSERT ................... denegado 42501
--     S2  service_role UPDATE ................... denegado 42501
--     S3  service_role SELECT ................... denegado 42501
--     A1  anon INSERT ........................... denegado 42501
--     C8  carta que declara otro restaurante .... rechazada (check)
--     C9  formato 1 ............................. rechazado (check)
--     C10 identificador mal formado ............. rechazado (check)
--   NO EJECUTADO:
--     C7c authenticated DELETE: el conector de la sesión se queda esperando
--     (60 s, tres intentos en total) cada vez que el bloque lleva un DELETE, y
--     no devuelve resultado. No se reintenta. Queda en C7c_borrado.sql para
--     ejecutarlo a mano (editor SQL de Supabase o psql) en f2-push.
--   POR CATÁLOGO (ACL): authenticated tiene sólo SELECT; sin privilegio de
--     DELETE, PostgreSQL rechaza antes de mirar RLS. Y no hay política de
--     DELETE, así que RLS tampoco dejaría borrar. Es una conclusión del
--     catálogo, no una prueba ejecutada.
DO $t$
declare
  r jsonb := '{}'; n int;
  uT uuid := gen_random_uuid();   -- personal del restaurante zzt
  uR uuid := gen_random_uuid();   -- personal del restaurante zzr (el de la carta)
  uA uuid := gen_random_uuid();   -- administración (su ficha es de zzt)
  uX uuid := gen_random_uuid();   -- token válido sin ficha
begin
  insert into auth.users(id, email) values
    (uT,'zz-c-t@zzt.meseo.invalid'),(uR,'zz-c-r@zzr.meseo.invalid'),
    (uA,'zz-c-a@zzt.meseo.invalid'),(uX,'zz-c-x@zzx.meseo.invalid');
  perform set_config('app.alta_valida', 'si', true);
  insert into public.employees(name, venue, role, display_name, auth_user_id) values
    ('zz_c_t_invalid','zzt','staff','zz',uT),
    ('zz_c_r_invalid','zzr','staff','zz',uR),
    ('zz_c_a_invalid','zzt','admin','zz',uA);
  insert into public.cartas(venue, formato, contenido) values
    ('zzr', 2, '{"venue":"zzr","allergensValidated":false,"DISHES":[{"id":3000,"cat":"X","name":"Plato sintético","allergens":[]}]}');

  -- C1 · anon no tiene ni permiso de lectura
  begin
    set local role anon;
    perform 1 from public.cartas;
    reset role; r := r || '{"C1 anon":"LEYÓ"}';
  exception when insufficient_privilege then
    reset role; r := r || '{"C1 anon":"denegado"}';
  end;

  -- C2 · personal de otro restaurante: 0 filas, aunque filtre por el venue
  perform set_config('request.jwt.claims', jsonb_build_object('sub', uT, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.cartas where venue = 'zzr';
  reset role; r := r || jsonb_build_object('C2 otro restaurante (esperado 0)', n);

  -- C3 · personal del restaurante de la carta: 1 fila
  perform set_config('request.jwt.claims', jsonb_build_object('sub', uR, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.cartas;
  reset role; r := r || jsonb_build_object('C3 su restaurante (esperado 1)', n);

  -- C4 · administración: 1 fila, aunque su ficha sea de otro restaurante
  perform set_config('request.jwt.claims', jsonb_build_object('sub', uA, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.cartas where venue = 'zzr';
  reset role; r := r || jsonb_build_object('C4 admin (esperado 1)', n);

  -- C5 · token válido sin ficha: 0 filas
  perform set_config('request.jwt.claims', jsonb_build_object('sub', uX, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.cartas;
  reset role; r := r || jsonb_build_object('C5 sin ficha (esperado 0)', n);

  -- C6 · reclamar admin en el token (app_metadata/user_metadata) no sirve
  perform set_config('request.jwt.claims', jsonb_build_object('sub', uT, 'role', 'authenticated',
    'app_metadata', jsonb_build_object('role','admin'), 'user_metadata', jsonb_build_object('role','admin','venue','zzr'))::text, true);
  set local role authenticated;
  select count(*) into n from public.cartas;
  reset role; r := r || jsonb_build_object('C6 rol plantado en el token (esperado 0)', n);

  -- C7a/C7b · la app no escribe: INSERT y UPDATE como authenticated (admin)
  perform set_config('request.jwt.claims', jsonb_build_object('sub', uA, 'role', 'authenticated')::text, true);
  begin
    set local role authenticated;
    insert into public.cartas(venue, formato, contenido) values ('zzq', 2, '{"venue":"zzq"}');
    reset role; r := r || '{"C7a insert authenticated":"ESCRIBIÓ"}';
  exception when insufficient_privilege then reset role; r := r || '{"C7a insert authenticated":"denegado 42501"}'; end;
  begin
    set local role authenticated;
    update public.cartas set formato = 3 where venue = 'zzr';
    reset role; r := r || '{"C7b update authenticated":"ESCRIBIÓ"}';
  exception when insufficient_privilege then reset role; r := r || '{"C7b update authenticated":"denegado 42501"}'; end;

  -- S1–S3 · service_role tampoco: ni escribe ni lee
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  begin
    set local role service_role;
    insert into public.cartas(venue, formato, contenido) values ('zzq', 2, '{"venue":"zzq"}');
    reset role; r := r || '{"S1 insert service_role":"ESCRIBIÓ"}';
  exception when insufficient_privilege then reset role; r := r || '{"S1 insert service_role":"denegado 42501"}'; end;
  begin
    set local role service_role;
    update public.cartas set formato = 3 where venue = 'zzr';
    reset role; r := r || '{"S2 update service_role":"ESCRIBIÓ"}';
  exception when insufficient_privilege then reset role; r := r || '{"S2 update service_role":"denegado 42501"}'; end;
  begin
    set local role service_role;
    select count(*) into n from public.cartas;
    reset role; r := r || jsonb_build_object('S3 select service_role', n);
  exception when insufficient_privilege then reset role; r := r || '{"S3 select service_role":"denegado 42501"}'; end;

  -- A1 · anon no escribe
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  begin
    set local role anon;
    insert into public.cartas(venue, formato, contenido) values ('zzp', 2, '{"venue":"zzp"}');
    reset role; r := r || '{"A1 insert anon":"ESCRIBIÓ"}';
  exception when insufficient_privilege then reset role; r := r || '{"A1 insert anon":"denegado 42501"}'; end;

  -- C8 · la carta declara su restaurante: si no coincide con la fila, no entra
  begin
    insert into public.cartas(venue, formato, contenido) values ('zzs', 2, '{"venue":"zzr"}');
    r := r || '{"C8 venue cruzado":"ENTRÓ"}';
  exception when check_violation then r := r || '{"C8 venue cruzado":"rechazado"}'; end;

  -- C9 · formato antiguo (1) no entra
  begin
    insert into public.cartas(venue, formato, contenido) values ('zzs', 1, '{"venue":"zzs"}');
    r := r || '{"C9 formato 1":"ENTRÓ"}';
  exception when check_violation then r := r || '{"C9 formato 1":"rechazado"}'; end;

  -- C10 · un identificador de restaurante mal formado no entra
  begin
    insert into public.cartas(venue, formato, contenido) values ('ZZ S', 2, '{"venue":"ZZ S"}');
    r := r || '{"C10 venue mal formado":"ENTRÓ"}';
  exception when check_violation then r := r || '{"C10 venue mal formado":"rechazado"}'; end;

  raise exception 'RESULTADO %', r;
end
$t$;

-- Catálogo · permisos (esperado: authenticated sólo SELECT; anon y
-- service_role, nada). Complementa a C7c, que no se pudo ejecutar.
select r.rolname,
  has_table_privilege(r.rolname,'public.cartas','SELECT') lee,
  has_table_privilege(r.rolname,'public.cartas','INSERT,UPDATE,DELETE,TRUNCATE') escribe
from pg_roles r where r.rolname in ('anon','authenticated','service_role');
