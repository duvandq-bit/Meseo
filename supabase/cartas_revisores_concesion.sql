-- ═══ CONCESIÓN DE REVISIÓN · una cuenta, una carta ══════════════════════════
-- Meseo · oct 2026. NO APLICADA. Requiere supabase/cartas_revisores.sql.
--
-- Da a UNA cuenta (auth.uid()) permiso para leer la carta de UN restaurante
-- y revisarla. Antes de ejecutarla hay que sustituir los dos marcadores:
--
--   __AUTH_UID__  el auth.uid() exacto de la cuenta. Se obtiene de la propia
--                 sesión de esa cuenta (entrando con ella), nunca del nombre
--                 visible, del correo ni del PIN. Ver «CÓMO OBTENERLO».
--   __VENUE__     el id técnico del restaurante (por ejemplo r2).
--
-- Si un marcador sigue sin sustituir, o el uid no existe, o no es de una ficha
-- con role 'admin', el bloque aborta y no concede nada.
--
-- CÓMO OBTENERLO (procedimiento a autorizar)
--   1. Entrar en la app con la cuenta que va a revisar.
--   2. En la consola del navegador, con la sesión abierta:
--        JSON.parse(atob(_authCtx().token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).sub
--      Es el «sub» del token de esa sesión: lo firma Supabase, no el móvil.
--   3. Copiarlo aquí sin enseñarlo en ningún sitio público.

do $c$
declare
  v_txt   text := '__AUTH_UID__';
  v_venue text := '__VENUE__';
  v_uid   uuid;
  v_n     int;
begin
  if v_txt !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'ABORTA: falta el auth.uid() (marcador __AUTH_UID__ sin sustituir o mal formado)';
  end if;
  if v_venue !~ '^[a-z0-9][a-z0-9_-]{0,31}$' then
    raise exception 'ABORTA: falta el restaurante (marcador __VENUE__ sin sustituir o mal formado)';
  end if;
  v_uid := v_txt::uuid;
  perform 1 from auth.users where id = v_uid;
  if not found then raise exception 'ABORTA: ese auth.uid() no existe'; end if;
  select count(*) into v_n from public.employees where auth_user_id = v_uid and role = 'admin';
  if v_n <> 1 then raise exception 'ABORTA: ese auth.uid() no es de una ficha con role admin'; end if;
  insert into public.cartas_revisores(venue, auth_user_id, concedido_por)
  values (v_venue, v_uid, 'mantenimiento: concesión de revisión')
  on conflict (venue, auth_user_id) do nothing;
end
$c$;

-- Para retirarla:
--   delete from public.cartas_revisores where venue = '<venue>' and auth_user_id = '<uid>';
