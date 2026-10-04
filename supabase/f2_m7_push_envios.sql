-- F2-7 · M7 · push_envios: límites de envío e idempotencia (contrato F2, apartado B)
-- Solo para la rama f2-push (sslcgakpxiwhjxsgmngg). Objeto NUEVO: no existe en
-- producción. Sin datos. ACL explícitas, independientes de los default privileges
-- (en producción darían anon/authenticated/service_role; aquí se retiran todos).
--
-- QUIÉN LO LLAMA (send-push v10, futura; no se despliega en M7)
--   · Usuario:  push_envio_reservar(tipo, target, pin, evento_id) con el bearer
--               DEL USUARIO. Dentro llama a push_autorizar (F1, sin cambios): la
--               autoridad sigue siendo F1; esto sólo añade límites y evento_id.
--   · Servicio: push_envio_inactividad(destino, venue, evento_id) con la service
--               key (check-inactive). Sólo service_role puede ejecutarla.
--   Sólo con enviar:true se envía. enviar:false = evento repetido, no reenviar.
--
-- LÍMITES (ventanas FIJAS alineadas a UTC con date_bin, como dice el contrato)
--   persona:      60 / 10 min por remitente
--                  6 / 10 min remitente → mismo destinatario
--                 30 / 10 min por destinatario (todos los remitentes)
--                 (la bienvenida a uno mismo es 'persona': cuenta igual)
--   restaurante:   3 / 60 min por restaurante (además del limitador de PIN de F1)
--   servicio:      1 aviso por destinatario y día (UTC)
--   Superado → {ok:false, error:'limite'}, sin decir cuál ni de quién, sin
--   guardar fila y sin tocar los contadores del PIN.
--
-- IDEMPOTENCIA
--   (remitente, evento_id) único; servicio = remitente null (NULLS NOT DISTINCT).
--   Repetido → {ok:true, enviar:false} antes de autorizar y antes de los límites.
--
-- CONCURRENCIA
--   Candados de transacción BLOQUEANTES (esperan, no deniegan), siempre en el
--   mismo orden: primero remitente ('r:'), después destinatario ('d:') o
--   restaurante ('v:'). Ningún camino toma un 'r:' después de un 'd:'/'v:', así
--   que no hay ciclo. Espacio de claves 'push_envios', distinto del de F1.
--
-- NO SE GUARDA: endpoint, claves, PIN, título, cuerpo, imagen, IP.

-- 1 · Tabla
create table public.push_envios (
  id         bigint generated always as identity primary key,
  evento_id  uuid not null,
  remitente  uuid,                                   -- auth.uid(); null = servicio
  tipo       text not null,
  venue      text not null,
  destino    text,                                   -- nombre canónico; null en 'restaurante'
  created_at timestamptz not null default now(),
  constraint push_envios_tipo_chk check (tipo in ('persona', 'restaurante', 'servicio')),
  constraint push_envios_forma_chk check (
    (tipo = 'persona'     and remitente is not null and destino is not null) or
    (tipo = 'restaurante' and remitente is not null and destino is null) or
    (tipo = 'servicio'    and remitente is null     and destino is not null)),
  constraint push_envios_evento_key unique nulls not distinct (remitente, evento_id)
);
create index push_envios_remitente_idx on public.push_envios (remitente, created_at);
create index push_envios_destino_idx   on public.push_envios (venue, destino, created_at);
create index push_envios_venue_idx     on public.push_envios (venue, tipo, created_at);

-- 2 · RLS activa, sin políticas: nadie fuera de las funciones
alter table public.push_envios enable row level security;
revoke all on table public.push_envios from public, anon, authenticated, service_role;
revoke all on sequence public.push_envios_id_seq from public, anon, authenticated, service_role;

-- 3 · Camino de usuario
create function public.push_envio_reservar(p_tipo text, p_target text default null, p_pin text default null, p_evento_id uuid default null)
returns json language plpgsql security definer set search_path = '' as $f$
declare
  v_uid   uuid := auth.uid();
  v_aut   json;
  v_alc   text;
  v_venue text;
  v_dest  text;
  v_v10   timestamptz := date_bin(interval '10 minutes', now(), timestamptz '2000-01-01 00:00:00+00');
  v_v60   timestamptz := date_bin(interval '60 minutes', now(), timestamptz '2000-01-01 00:00:00+00');
begin
  if v_uid is null then
    return json_build_object('ok', false, 'error', 'no_autenticado');
  end if;
  if p_evento_id is null then
    return json_build_object('ok', false, 'error', 'formato');
  end if;

  perform pg_advisory_xact_lock(hashtext('push_envios'), hashtext('r:' || v_uid::text));
  if exists (select 1 from public.push_envios where remitente = v_uid and evento_id = p_evento_id) then
    return json_build_object('ok', true, 'enviar', false);
  end if;

  v_aut := public.push_autorizar(p_tipo, p_target, p_pin);
  if not coalesce((v_aut ->> 'ok')::boolean, false) then
    return v_aut;                       -- no_autenticado | sin_identidad | denegado | tipo_no_permitido
  end if;
  v_alc   := v_aut ->> 'alcance';
  v_venue := v_aut ->> 'venue';
  v_dest  := v_aut ->> 'destino';

  if v_alc = 'persona' then
    perform pg_advisory_xact_lock(hashtext('push_envios'), hashtext('d:' || v_venue || ':' || v_dest));
    if (select count(*) from public.push_envios
         where remitente = v_uid and tipo = 'persona' and created_at >= v_v10) >= 60
    or (select count(*) from public.push_envios
         where remitente = v_uid and tipo = 'persona' and venue = v_venue and destino = v_dest and created_at >= v_v10) >= 6
    or (select count(*) from public.push_envios
         where tipo = 'persona' and venue = v_venue and destino = v_dest and created_at >= v_v10) >= 30 then
      return json_build_object('ok', false, 'error', 'limite');
    end if;
  elsif v_alc = 'restaurante' then
    perform pg_advisory_xact_lock(hashtext('push_envios'), hashtext('v:' || v_venue));
    if (select count(*) from public.push_envios
         where tipo = 'restaurante' and venue = v_venue and created_at >= v_v60) >= 3 then
      return json_build_object('ok', false, 'error', 'limite');
    end if;
  else
    return json_build_object('ok', false, 'error', 'tipo_no_permitido');
  end if;

  insert into public.push_envios (evento_id, remitente, tipo, venue, destino)
  values (p_evento_id, v_uid, v_alc, v_venue, v_dest);
  return json_build_object('ok', true, 'enviar', true, 'alcance', v_alc, 'venue', v_venue, 'destino', v_dest);
end $f$;
revoke all on function public.push_envio_reservar(text, text, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.push_envio_reservar(text, text, text, uuid) to authenticated;

-- 4 · Camino de servicio (check-inactive): sin límite de usuario, 1 aviso por destinatario y día
create function public.push_envio_inactividad(p_destino text, p_venue text, p_evento_id uuid)
returns json language plpgsql security definer set search_path = '' as $f$
declare
  v_dest text;
  v_dia  timestamptz := date_bin(interval '1 day', now(), timestamptz '2000-01-01 00:00:00+00');
begin
  if p_evento_id is null or p_destino is null or p_venue is null then
    return json_build_object('ok', false, 'error', 'formato');
  end if;
  select e.name into v_dest from public.employees e where e.name = p_destino and e.venue = p_venue;
  if v_dest is null then
    return json_build_object('ok', false, 'error', 'denegado');
  end if;

  perform pg_advisory_xact_lock(hashtext('push_envios'), hashtext('d:' || p_venue || ':' || v_dest));
  if exists (select 1 from public.push_envios where remitente is null and evento_id = p_evento_id) then
    return json_build_object('ok', true, 'enviar', false);
  end if;
  if exists (select 1 from public.push_envios
              where tipo = 'servicio' and venue = p_venue and destino = v_dest and created_at >= v_dia) then
    return json_build_object('ok', false, 'error', 'limite');
  end if;

  insert into public.push_envios (evento_id, remitente, tipo, venue, destino)
  values (p_evento_id, null, 'servicio', p_venue, v_dest);
  return json_build_object('ok', true, 'enviar', true, 'alcance', 'servicio', 'venue', p_venue, 'destino', v_dest);
end $f$;
revoke all on function public.push_envio_inactividad(text, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.push_envio_inactividad(text, text, uuid) to service_role;

-- ── VUELTA ATRÁS (no ejecutar salvo decisión expresa) ────────────────────────
--   drop function public.push_envio_inactividad(text, text, uuid);
--   drop function public.push_envio_reservar(text, text, text, uuid);
--   drop table public.push_envios;
