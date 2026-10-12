-- Meseo · C7c · DELETE como authenticated sobre public.cartas (rama f2-push)
-- Para ejecutar A MANO (editor SQL de Supabase o psql) en f2-push: el
-- conector de la sesión no devuelve resultado cuando el bloque lleva un DELETE.
-- Todo se deshace al final con raise exception. Esperado:
--   {"C7c delete authenticated": "denegado 42501", "fila sigue": 1}
DO $t$
declare r jsonb := '{}'; uA uuid := gen_random_uuid(); n int;
begin
  insert into auth.users(id, email) values (uA,'zz-c-a@zzt.meseo.invalid');
  perform set_config('app.alta_valida', 'si', true);
  insert into public.employees(name, venue, role, display_name, auth_user_id) values ('zz_c_a_invalid','zzt','admin','zz',uA);
  insert into public.cartas(venue, formato, contenido) values ('zzr', 2, '{"venue":"zzr"}');
  perform set_config('request.jwt.claims', jsonb_build_object('sub', uA, 'role', 'authenticated')::text, true);
  begin
    set local role authenticated;
    delete from public.cartas where venue = 'zzr';
    reset role; r := r || '{"C7c delete authenticated":"BORRÓ"}';
  exception when insufficient_privilege then
    reset role; r := r || '{"C7c delete authenticated":"denegado 42501"}';
  end;
  select count(*) into n from public.cartas where venue = 'zzr';
  r := r || jsonb_build_object('fila sigue', n);
  raise exception 'RESULTADO %', r;
end $t$;
