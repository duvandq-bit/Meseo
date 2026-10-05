-- F2 · D7 · H1 · Hardening de public.notifications
-- Primero en la rama f2-push (sslcgakpxiwhjxsgmngg). Migración NUEVA e independiente;
-- en producción se aplicaría esta misma, sin la réplica.
--
-- POR QUÉ
--   · anon (la clave pública) podía leer, insertar, modificar y borrar TODAS las
--     notificaciones de todos los restaurantes (política allow_all + arwdDxtm).
--   · authenticated no tenía ninguna política: con sesión, 0 filas al leer y todo
--     INSERT/UPDATE rechazado. El cliente usa el token de sesión, así que hoy no
--     ve ni crea notificaciones.
--
-- QUÉ CAMBIA
--   · se elimina allow_all y anon pierde todo (tabla y secuencia);
--   · authenticated: SELECT; INSERT solo de (target, message, type, read, venue);
--     UPDATE solo de (read). Sin DELETE, TRUNCATE, REFERENCES, TRIGGER ni MAINTAIN;
--   · tres políticas, con la identidad siempre desde auth.uid() vía app.*:
--       notif_leer_propias  lo propio y 'all' del restaurante propio
--       notif_alta          destino del mismo restaurante; 'all' solo manager/owner;
--                           staff solo info/duel; mensaje 1–500; read=false
--       notif_marcar_leida  solo lo propio, y solo a read=true
--
-- QUÉ NO CAMBIA
--   La tabla, sus columnas, índices, service_role (BYPASSRLS, arwdDxtm) y la
--   secuencia para authenticated y service_role. Ni F1, ni M7, ni M8-A/B+.

drop policy allow_all on public.notifications;

revoke all on table public.notifications from anon, authenticated;
grant select on table public.notifications to authenticated;
grant insert (target, message, type, read, venue) on table public.notifications to authenticated;
grant update (read) on table public.notifications to authenticated;
revoke all on sequence public.notifications_id_seq from anon;

create policy notif_leer_propias on public.notifications as permissive for select to authenticated
  using (venue = app.venue_actual()
         and (target = app.emp_actual() or target = 'all'));

create policy notif_alta on public.notifications as permissive for insert to authenticated
  with check (
    venue = app.venue_actual()
    and coalesce(read, false) = false
    and length(message) between 1 and 500
    and type in ('info', 'warning', 'success', 'urgent', 'duel')
    and (app.rol_actual() in ('manager', 'owner') or type in ('info', 'duel'))
    and (
      (notifications.target = 'all' and app.rol_actual() in ('manager', 'owner'))
      or (notifications.target <> 'all'
          and exists (select 1 from public.employees e
                       where e.name = notifications.target and e.venue = app.venue_actual()))
    )
  );

create policy notif_marcar_leida on public.notifications as permissive for update to authenticated
  using (venue = app.venue_actual() and target = app.emp_actual())
  with check (venue = app.venue_actual() and target = app.emp_actual() and read = true);

-- ── VUELTA ATRÁS (no ejecutar salvo decisión expresa): deja el estado literal anterior ──
--   drop policy notif_leer_propias on public.notifications;
--   drop policy notif_alta on public.notifications;
--   drop policy notif_marcar_leida on public.notifications;
--   grant select, insert, update, delete, truncate, references, trigger, maintain on table public.notifications to anon, authenticated;
--   grant select, update, usage on sequence public.notifications_id_seq to anon;
--   create policy allow_all on public.notifications as permissive for all to anon using (true) with check (true);
