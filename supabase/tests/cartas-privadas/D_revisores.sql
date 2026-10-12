-- Meseo · prueba funcional de cartas_revisores. NO EJECUTADA EN SUPABASE.
-- Requiere cartas_privadas.sql y cartas_revisores.sql aplicadas (en meseo-c5-test:
-- supabase/tests/cartas-privadas/c5/01_aplicar.sql).
-- SALVAGUARDA: sólo corre en meseo-c5-test (system_identifier 7690937621030482216);
-- en cualquier otra base aborta ANTES de insertar nada.
--
-- CÓMO LEER EL RESULTADO (editor SQL de Supabase o psql)
--   La prueba NUNCA termina «bien»: acaba siempre con un error a propósito, porque
--   un RAISE EXCEPTION deshace todo lo que el bloque insertó.
--   · SUPERADA: el error dice exactamente
--       RESULTADO {"D1": 1, "D2": 0, "D3": 1, "D4": 0, "D5": 0, "D6": 0, "D7": "denegado", "D8": "denegado", "D9": "denegado", "D10": "denegado", "D11": "denegado", "D12": 0}
--   · FALLIDA: el error empieza por «ABORTA:» (otra base, o algún caso distinto
--     del esperado: el mensaje trae el resultado obtenido), o es cualquier otro
--     error de PostgreSQL (p. ej. sin permiso para insertar en auth.users): la
--     prueba no llegó a completarse.
--   En todos los casos no queda nada. Para comprobarlo (sólo lectura):
--     select (select count(*) from auth.users where email like '%.meseo.invalid') as usuarios_prueba,
--            (select count(*) from public.employees) as fichas,
--            (select count(*) from public.cartas) as cartas,
--            (select count(*) from public.cartas_revisores) as concesiones;
--   Esperado: 0, 0, 0, 0.
-- Identidades sintéticas; todo se deshace al final con raise exception
-- 'RESULTADO %'. Esperado (si algo no coincide, el bloque aborta con ABORTA):
--   D1  personal de zzr lee su carta ................................ 1
--   D2  personal de otro restaurante ................................ 0
--   D3  admin CON concesión para zzr ................................ 1
--   D4  OTRA cuenta admin, sin concesión ............................ 0
--   D5  admin con concesión para OTRA carta ......................... 0
--   D6  admin sin concesión con rol/venue plantados en el token ..... 0
--   D7  authenticated lee cartas_revisores .......................... denegado 42501
--   D8  authenticated escribe en cartas_revisores ................... denegado 42501
--   D9  anon ejecuta app.puede_revisar_carta ........................ denegado 42501
--   D10 anon lee cartas ............................................. denegado 42501
--   D11 authenticated escribe en cartas ............................. denegado 42501
--   D12 token sin ficha (uid desconocido) ........................... 0
DO $t$
declare
  r jsonb := '{}'; n int;
  uR  uuid := gen_random_uuid();   -- personal de zzr (el restaurante de la carta)
  uT  uuid := gen_random_uuid();   -- personal de zzt
  uA1 uuid := gen_random_uuid();   -- admin (ficha de zzt) CON concesión para zzr
  uA2 uuid := gen_random_uuid();   -- otra cuenta admin, sin concesión
  uA3 uuid := gen_random_uuid();   -- admin con concesión sólo para zzq
  uX  uuid := gen_random_uuid();   -- sesión sin ficha
  esperado jsonb := '{"D1":1,"D2":0,"D3":1,"D4":0,"D5":0,"D6":0,"D7":"denegado","D8":"denegado","D9":"denegado","D10":"denegado","D11":"denegado","D12":0}';
  lee constant text := 'select count(*) from public.cartas where venue = ''zzr''';
begin
  if (select system_identifier::text from pg_control_system()) <> '7690937621030482216' then
    raise exception 'ABORTA: esta base no es meseo-c5-test (system_identifier %); no se inserta nada.',
      (select system_identifier::text from pg_control_system());
  end if;
  insert into auth.users(id, email) values
    (uR,'zz-d-r@zzr.meseo.invalid'),(uT,'zz-d-t@zzt.meseo.invalid'),
    (uA1,'zz-d-a1@zzt.meseo.invalid'),(uA2,'zz-d-a2@zzt.meseo.invalid'),(uA3,'zz-d-a3@zzt.meseo.invalid'),
    (uX,'zz-d-x@zzt.meseo.invalid');
  perform set_config('app.alta_valida', 'si', true);
  insert into public.employees(name, venue, role, display_name, auth_user_id) values
    ('zz_d_r_invalid','zzr','staff','zz',uR), ('zz_d_t_invalid','zzt','staff','zz',uT),
    ('zz_d_a1_invalid','zzt','admin','zz',uA1), ('zz_d_a2_invalid','zzt','admin','zz',uA2),
    ('zz_d_a3_invalid','zzt','admin','zz',uA3);
  insert into public.cartas(venue, formato, contenido) values
    ('zzr', 2, '{"venue":"zzr","allergensValidated":false,"DISHES":[{"id":3000,"cat":"X","name":"Plato sintético","allergens":[]}]}');
  insert into public.cartas_revisores(venue, auth_user_id, concedido_por) values
    ('zzr', uA1, 'prueba'), ('zzq', uA3, 'prueba');

  perform set_config('request.jwt.claims', jsonb_build_object('sub', uR, 'role', 'authenticated')::text, true);
  set local role authenticated; execute lee into n; reset role; r := r || jsonb_build_object('D1', n);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', uT, 'role', 'authenticated')::text, true);
  set local role authenticated; execute lee into n; reset role; r := r || jsonb_build_object('D2', n);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', uA1, 'role', 'authenticated')::text, true);
  set local role authenticated; execute lee into n; reset role; r := r || jsonb_build_object('D3', n);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', uA2, 'role', 'authenticated')::text, true);
  set local role authenticated; execute lee into n; reset role; r := r || jsonb_build_object('D4', n);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', uA3, 'role', 'authenticated')::text, true);
  set local role authenticated; execute lee into n; reset role; r := r || jsonb_build_object('D5', n);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', uA2, 'role', 'authenticated',
    'user_metadata', jsonb_build_object('role','admin','venue','zzr'), 'app_metadata', jsonb_build_object('role','admin','venue','zzr'))::text, true);
  set local role authenticated; execute lee into n; reset role; r := r || jsonb_build_object('D6', n);

  perform set_config('request.jwt.claims', jsonb_build_object('sub', uA1, 'role', 'authenticated')::text, true);
  begin set local role authenticated; perform count(*) from public.cartas_revisores; reset role; r := r || '{"D7":"permitido"}';
  exception when insufficient_privilege then reset role; r := r || '{"D7":"denegado"}'; end;
  begin set local role authenticated; insert into public.cartas_revisores(venue, auth_user_id, concedido_por) values ('zzr', uA2, 'x'); reset role; r := r || '{"D8":"permitido"}';
  exception when insufficient_privilege then reset role; r := r || '{"D8":"denegado"}'; end;

  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  begin set local role anon; perform app.puede_revisar_carta('zzr'); reset role; r := r || '{"D9":"permitido"}';
  exception when insufficient_privilege then reset role; r := r || '{"D9":"denegado"}'; end;
  begin set local role anon; execute lee into n; reset role; r := r || '{"D10":"permitido"}';
  exception when insufficient_privilege then reset role; r := r || '{"D10":"denegado"}'; end;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', uA1, 'role', 'authenticated')::text, true);
  begin set local role authenticated; insert into public.cartas(venue, formato, contenido) values ('zzq', 2, '{"venue":"zzq"}'); reset role; r := r || '{"D11":"permitido"}';
  exception when insufficient_privilege then reset role; r := r || '{"D11":"denegado"}'; end;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', uX, 'role', 'authenticated')::text, true);
  set local role authenticated; execute lee into n; reset role; r := r || jsonb_build_object('D12', n);

  if r <> esperado then raise exception 'ABORTA: resultado distinto del esperado: %', r; end if;
  raise exception 'RESULTADO %', r;
end
$t$;
