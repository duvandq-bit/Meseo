-- ═══ CARTAS PRIVADAS · REVISIÓN POR IDENTIDAD, NO POR ROL ═══════════════════
-- Meseo · oct 2026. Primero en la rama de pruebas f2-push; en producción sólo
-- con autorización expresa del propietario. NO APLICADA.
--
-- EL PROBLEMA
--   cartas_privadas.sql deja leer TODAS las cartas a cualquier cuenta con
--   role = 'admin'. Hoy hay una sola, pero nada lo garantiza: un ascenso con
--   employee_set_role (PIN de propietario) o una escritura de mantenimiento
--   crearía otra, y esa también leería la carta de un restaurante que todavía
--   no se puede enseñar.
--
-- LO QUE HACE
--   La lectura de una carta queda así:
--     · el personal de un restaurante lee la de su restaurante (igual que antes);
--     · además, quien figure en public.cartas_revisores para ESA carta, por su
--       auth.uid(), la lee para revisarla;
--     · el rol 'admin' por sí solo ya no da acceso a ninguna carta ajena.
--   La identidad es auth.uid() —la sesión de Supabase—, nunca el nombre
--   visible, el correo ni el PIN, y nunca nada que mande el móvil.
--
-- QUIÉN ESCRIBE cartas_revisores
--   Nadie desde la app: ni anon, ni authenticated, ni service_role tienen
--   privilegios, y no hay políticas. Se concede por mantenimiento con
--   supabase/cartas_revisores_concesion.sql, que exige el auth.uid() exacto.
--
-- POR QUÉ UNA FUNCIÓN SECURITY DEFINER
--   La política se evalúa con los permisos de quien lee (authenticated), que no
--   tiene SELECT sobre cartas_revisores: una subconsulta directa fallaría. La
--   función sólo responde «¿la sesión actual puede revisar esta carta?», con
--   search_path vacío y nombres cualificados, igual que app.venue_actual().
--
-- COMPATIBILIDAD
--   La app no cambia: sigue pidiendo rest/v1/cartas?venue=eq.<id>. Una cuenta
--   admin sin concesión recibe 0 filas y abre ese restaurante vacío, como
--   cuando no hay carta. Txoko no pasa por aquí (su carta va en index.html).

create table public.cartas_revisores (
  venue          text not null check (venue ~ '^[a-z0-9][a-z0-9_-]{0,31}$'),
  auth_user_id   uuid not null references auth.users(id) on delete cascade,
  concedido_por  text not null,
  concedido_en   timestamptz not null default now(),
  primary key (venue, auth_user_id)
);
comment on table public.cartas_revisores is
  'Quién (auth.uid()) puede leer la carta de un restaurante para revisarla, aunque su ficha sea de otro. Se escribe sólo por mantenimiento.';
alter table public.cartas_revisores enable row level security;   -- sin políticas
revoke all on table public.cartas_revisores from public, anon, authenticated, service_role;

create or replace function app.puede_revisar_carta(p_venue text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.cartas_revisores r
     where r.venue = p_venue and r.auth_user_id = auth.uid()
  )
$$;
revoke all on function app.puede_revisar_carta(text) from public, anon, service_role;
grant execute on function app.puede_revisar_carta(text) to authenticated;

-- La política de lectura: su restaurante, o una concesión de revisión para ESA
-- carta. Desaparece la cláusula «cualquier admin lee todas».
drop policy cartas_leer on public.cartas;
create policy cartas_leer on public.cartas
  for select to authenticated
  using ( venue = (select app.venue_actual())
          or app.puede_revisar_carta(venue) );

-- ── CÓMO SE DESHACE ──────────────────────────────────────────────────────
--   drop policy cartas_leer on public.cartas;
--   create policy cartas_leer on public.cartas for select to authenticated
--     using ( venue = (select app.venue_actual()) or (select app.rol_actual()) = 'admin' );
--   drop function app.puede_revisar_carta(text);
--   drop table public.cartas_revisores;
