-- Meseo · prueba funcional de public.cartas (rama f2-push)
-- Un solo bloque con identidades sintéticas. Todo se deshace al final con
-- raise exception 'RESULTADO %', que lleva el resultado de cada caso.
--
-- Resultado en f2-push (6 oct 2026): C1 denegado · C2 0 · C3 1 · C4 1 · C5 0 ·
-- C6 0 · C8 rechazado · C9 rechazado · C10 rechazado.
--
-- C7 (nadie escribe desde la app) va en la consulta de permisos del final, y
-- no como INSERT/UPDATE/DELETE de verdad: el conector pide confirmación humana
-- para las sentencias destructivas y la prueba se quedaba esperando. Medido:
-- authenticated sólo SELECT; anon y service_role nada.
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

-- C7 · permisos: nadie escribe desde la app (esperado: authenticated sólo
-- SELECT; anon y service_role, nada).
select r.rolname,
  has_table_privilege(r.rolname,'public.cartas','SELECT') lee,
  has_table_privilege(r.rolname,'public.cartas','INSERT,UPDATE,DELETE,TRUNCATE') escribe
from pg_roles r where r.rolname in ('anon','authenticated','service_role');
