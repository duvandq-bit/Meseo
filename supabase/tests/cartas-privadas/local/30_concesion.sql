-- Prueba de la concesión: con marcadores aborta; con una ficha no admin aborta;
-- con la ficha admin concede exactamente una fila. Se deshace al final.
DO $t$
declare r jsonb := '{}'; uA uuid := gen_random_uuid(); uS uuid := gen_random_uuid(); src text; n int;
begin
  insert into auth.users(id,email) values (uA,'zz-c-a@zzt.meseo.invalid'),(uS,'zz-c-s@zzt.meseo.invalid');
  insert into public.employees(name,venue,role,auth_user_id) values ('zz_c_a','zzt','admin',uA),('zz_c_s','zzt','staff',uS);
  src := pg_read_file_concesion();
  begin execute src; r := r || '{"K1":"concedió"}'; exception when raise_exception then r := r || '{"K1":"aborta"}'; end;
  begin execute replace(replace(src,'__AUTH_UID__',uS::text),'__VENUE__','zzr'); r := r || '{"K2":"concedió"}';
  exception when raise_exception then r := r || '{"K2":"aborta"}'; end;
  execute replace(replace(src,'__AUTH_UID__',uA::text),'__VENUE__','zzr');
  select count(*) into n from public.cartas_revisores where venue='zzr' and auth_user_id=uA; r := r || jsonb_build_object('K3', n);
  select count(*) into n from public.cartas_revisores; r := r || jsonb_build_object('K4_total', n);
  if r <> '{"K1":"aborta","K2":"aborta","K3":1,"K4_total":1}' then raise exception 'ABORTA: %', r; end if;
  raise exception 'RESULTADO %', r;
end $t$;
