-- ═══════════════════════════════════════════════════════════════════════════
-- S3-B · Cada persona gestiona sólo su suscripción push
-- ═══════════════════════════════════════════════════════════════════════════
--
-- QUÉ CIERRA (auditoría S3-B, sep 2026)
--   `anon` podía leer, dar de alta y borrar cualquier fila de
--   push_subscriptions; `authenticated` no podía nada (el cliente recibía 403).
--   employee_name y venue los ponía el cliente; endpoint era texto libre.
--
-- QUÉ QUEDA
--   · anon: sin acceso.
--   · authenticated: SELECT, INSERT y DELETE sólo de lo propio.
--   · UPDATE: sin política → imposible por RLS. El GRANT de UPDATE se MANTIENE
--     a propósito: el cliente registra con `resolution=merge-duplicates`
--     (INSERT … ON CONFLICT DO UPDATE) y Postgres exige ese privilegio aunque
--     nunca llegue a actualizar. Como `id` es GENERATED ALWAYS y el cliente no
--     lo envía, el conflicto por clave primaria no ocurre nunca.
--   · employee_name, venue y created_at los fija el servidor (trigger).
--   · endpoint sólo https a los servicios de push que hay hoy en los datos.
--
-- LAS 18 FILAS EXISTENTES NO SE TOCAN. Todas cumplen el CHECK (comprobado).
--
-- NO APLICADA.

-- ── 1 · Fuera anon ──────────────────────────────────────────────────────────
drop policy if exists "Allow anon select" on public.push_subscriptions;
drop policy if exists "Allow anon insert" on public.push_subscriptions;
drop policy if exists "Allow anon delete" on public.push_subscriptions;
revoke all on table public.push_subscriptions from anon;
revoke usage on sequence public.push_subscriptions_id_seq from anon;

-- ── 2 · Privilegios que no hacen falta a nadie del cliente ─────────────────
revoke truncate, references, trigger on table public.push_subscriptions from authenticated;

-- ── 3 · Lo propio, y nada más ───────────────────────────────────────────────
create policy push_propias_select on public.push_subscriptions
  for select to authenticated
  using (employee_name = app.emp_actual() and venue = app.venue_actual());

create policy push_propias_insert on public.push_subscriptions
  for insert to authenticated
  with check (employee_name = app.emp_actual() and venue = app.venue_actual());

create policy push_propias_delete on public.push_subscriptions
  for delete to authenticated
  using (employee_name = app.emp_actual() and venue = app.venue_actual());

-- Sin política de UPDATE: RLS deniega cualquier UPDATE, también el del
-- camino ON CONFLICT DO UPDATE.

-- ── 4 · El servidor decide quién y dónde ────────────────────────────────────
create function public.push_subscriptions_propietario() returns trigger
language plpgsql security definer set search_path = '' as $f$
declare
  v_rol   text := coalesce(nullif(current_setting('role', true), ''), 'none');
  v_emp   text;
  v_venue text;
begin
  -- QUIÉN LLAMA. No se usa `current_user`: dentro de SECURITY DEFINER es el
  -- dueño de la función. Sólo dos casos quedan FUERA de la lógica de usuario,
  -- y los dos de forma explícita:
  --   · service_role: el ajuste `role` sólo puede valer 'service_role' si quien
  --     hace SET ROLE es miembro de ese rol, y sólo lo son postgres y
  --     authenticator. Desde la API eso exige un JWT de servicio.
  --   · conexión directa del propietario (migraciones, mantenimiento): sin
  --     SET ROLE y fuera de `authenticator`, que es por donde entra PostgREST.
  if v_rol = 'service_role' then return new; end if;
  if v_rol = 'none' and session_user <> 'authenticator' then return new; end if;

  -- Todo lo demás es una petición de usuario (fallo cerrado): la identidad
  -- sale de auth.uid(), el mismo origen que usan app.emp_actual() y las RLS.
  if auth.uid() is null then
    raise exception 'sin_identidad' using errcode = '42501';
  end if;
  v_emp   := app.emp_actual();
  v_venue := app.venue_actual();
  if v_emp is null or v_venue is null then
    raise exception 'sin_identidad' using errcode = '42501';
  end if;
  new.employee_name := v_emp;
  new.venue         := v_venue;
  new.created_at    := now();
  return new;
end $f$;
revoke all on function public.push_subscriptions_propietario() from public, anon, authenticated;

create trigger trg_push_subscriptions_propietario
  before insert on public.push_subscriptions
  for each row execute function public.push_subscriptions_propietario();

-- ── 5 · Sólo destinos de push reales ────────────────────────────────────────
-- Hosts presentes hoy en las 18 filas: fcm.googleapis.com (7) y
-- web.push.apple.com (11). Ampliar la lista es una decisión aparte.
alter table public.push_subscriptions
  add constraint push_subscriptions_endpoint_chk
  check (endpoint ~ '^https://(fcm\.googleapis\.com|web\.push\.apple\.com)/');

-- ── VUELTA ATRÁS (no ejecutar salvo decisión expresa) ────────────────────────
--   alter table public.push_subscriptions drop constraint push_subscriptions_endpoint_chk;
--   drop trigger trg_push_subscriptions_propietario on public.push_subscriptions;
--   drop function public.push_subscriptions_propietario();
--   drop policy push_propias_select on public.push_subscriptions;
--   drop policy push_propias_insert on public.push_subscriptions;
--   drop policy push_propias_delete on public.push_subscriptions;
--   grant select, insert, update, delete, truncate, references, trigger
--     on table public.push_subscriptions to anon;
--   grant truncate, references, trigger on table public.push_subscriptions to authenticated;
--   grant usage on sequence public.push_subscriptions_id_seq to anon;
--   create policy "Allow anon select" on public.push_subscriptions for select to anon using (true);
--   create policy "Allow anon insert" on public.push_subscriptions for insert to anon with check (true);
--   create policy "Allow anon delete" on public.push_subscriptions for delete to anon using (true);
