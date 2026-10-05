-- F2 · D7 · H0 · Réplica LITERAL de public.notifications de producción (advkoujfgbrrjvqexrcu)
-- Solo para la rama f2-push (sslcgakpxiwhjxsgmngg). Sin datos. Reproduce el estado
-- actual de producción tal cual —incluida la política abierta `allow_all` para anon—
-- para que el hardening (f2_h_notifications_hardening) se pruebe sobre lo mismo
-- que habrá en producción. Definiciones tomadas del catálogo de producción el
-- 2026-10-05. ACL explícitas: en la rama los default privileges son distintos.

-- 1 · Tabla (7 columnas, mismo orden, tipos, nulabilidad y defaults)
create table public.notifications (
  id         bigint generated always as identity (start with 1 increment by 1 minvalue 1 maxvalue 9223372036854775807 cache 1 no cycle),
  target     text not null,
  message    text not null,
  type       text default 'info'::text,
  read       boolean default false,
  created_at timestamp with time zone default now(),
  venue      text not null default 'txoko'::text
);

-- 2 · Constraints e índices
alter table public.notifications add constraint notifications_pkey primary key (id);
create index notifications_venue_idx on public.notifications using btree (venue, target, read);

-- 3 · RLS activa, sin forzar; la única política de producción
alter table public.notifications enable row level security;
create policy allow_all on public.notifications as permissive for all to anon using (true) with check (true);

-- 4 · ACL explícitas (literal de producción)
-- Tabla: {postgres=arwdDxtm, anon=arwdDxtm, authenticated=arwdDxtm, service_role=arwdDxtm}
revoke all on table public.notifications from public, anon, authenticated, service_role;
grant select, insert, update, delete, truncate, references, trigger, maintain on table public.notifications to anon, authenticated, service_role;
-- Secuencia: {postgres=rwU, anon=rwU, authenticated=rwU, service_role=rwU}
revoke all on sequence public.notifications_id_seq from public, anon, authenticated, service_role;
grant select, update, usage on sequence public.notifications_id_seq to anon, authenticated, service_role;
