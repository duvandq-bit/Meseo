-- F2 · M8-A · push_suscripcion_registrar: alta y reasignación de suscripciones push
-- Primero en la rama f2-push (sslcgakpxiwhjxsgmngg). Solo añade una función:
-- no toca la tabla, ni sus políticas, ni el trigger de M5, ni F1, ni M7.
--
-- PARA QUÉ
--   Un endpoint es un dispositivo, y un dispositivo pertenece a UNA sola
--   identidad activa: la última que se ha registrado en él. Esta función es la
--   vía de alta que lo garantiza. Sustituye al POST directo del cliente, que
--   además chocaba con el UNIQUE (employee_name, endpoint) al volver a
--   suscribirse (merge-duplicates sin on_conflict resuelve por la clave `id`).
--
-- FIRMA
--   push_suscripcion_registrar(p_endpoint text, p_p256dh text, p_auth text) returns json
--   No hay parámetro de empleado, de restaurante, de auth_user_id, de id ni de
--   created_at: la identidad sale de auth.uid() vía app.emp_actual/venue_actual.
--
-- RETORNO (json)
--   {ok:true}                         alta, repetición o reasignación (no se distingue)
--   {ok:false, error:'no_autenticado'} sin auth.uid()
--   {ok:false, error:'sin_identidad'}  uid sin ficha
--   {ok:false, error:'formato'}        algún argumento inválido (no dice cuál)
--
-- VALIDACIÓN (antes del candado; no escribe nada)
--   endpoint  no nulo, <= 1024, mismo host que el CHECK de la tabla
--   p256dh    exactamente 87 caracteres base64url (P-256 sin comprimir)
--   auth      exactamente 22 caracteres base64url (16 bytes)
--
-- REASIGNACIÓN Y CONCURRENCIA
--   Candado de transacción BLOQUEANTE por endpoint, en un espacio de claves
--   propio ('push_subscriptions', distinto de F1 y de M7). Un único candado por
--   llamada: no puede formar ciclos con los de M7. Bajo el candado:
--     1. se borran las filas de OTRAS identidades con ese endpoint;
--     2. se da de alta (o se actualizan las claves de) la fila propia.
--   No se hace UPDATE de employee_name: la fila del dueño anterior desaparece y
--   la nueva nace por INSERT, así que el trigger de M5 vuelve a fijar la
--   identidad. Si dos identidades llegan a la vez, la segunda en conseguir el
--   candado es la dueña final: la última que registró el dispositivo.
--
-- NO SE GUARDA NADA MÁS que lo que ya guardaba la tabla.

create function public.push_suscripcion_registrar(p_endpoint text, p_p256dh text, p_auth text)
returns json language plpgsql volatile security definer set search_path = '' as $f$
declare
  v_emp   text;
  v_venue text;
begin
  if auth.uid() is null then
    return json_build_object('ok', false, 'error', 'no_autenticado');
  end if;
  v_emp   := app.emp_actual();
  v_venue := app.venue_actual();
  if v_emp is null or v_venue is null then
    return json_build_object('ok', false, 'error', 'sin_identidad');
  end if;

  if p_endpoint is null or length(p_endpoint) > 1024
     or p_endpoint !~ '^https://(fcm\.googleapis\.com|web\.push\.apple\.com)/'
     or p_p256dh is null or p_p256dh !~ '^[A-Za-z0-9_-]{87}$'
     or p_auth   is null or p_auth   !~ '^[A-Za-z0-9_-]{22}$' then
    return json_build_object('ok', false, 'error', 'formato');
  end if;

  perform pg_advisory_xact_lock(hashtext('push_subscriptions'), hashtext('e:' || p_endpoint));

  delete from public.push_subscriptions
   where endpoint = p_endpoint and employee_name <> v_emp;

  insert into public.push_subscriptions (employee_name, venue, endpoint, keys_p256dh, keys_auth)
  values (v_emp, v_venue, p_endpoint, p_p256dh, p_auth)
  on conflict (employee_name, endpoint) do update
     set keys_p256dh = excluded.keys_p256dh,
         keys_auth   = excluded.keys_auth,
         venue       = excluded.venue;

  return json_build_object('ok', true);
end $f$;

revoke all on function public.push_suscripcion_registrar(text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.push_suscripcion_registrar(text, text, text) to authenticated;

-- ── VUELTA ATRÁS (no ejecutar salvo decisión expresa; solo si ningún cliente depende de ella) ──
--   drop function public.push_suscripcion_registrar(text, text, text);
