-- F2-3 · M3 · Réplica de public.supervisor_pins de producción (advkoujfgbrrjvqexrcu)
-- Solo para la rama f2-push (sslcgakpxiwhjxsgmngg). Sin datos. ACL explícitas.

-- 1 · Tabla (4 columnas, mismo orden, tipos, nulabilidad y defaults)
create table public.supervisor_pins (
  venue      text not null,
  pin_hash   text not null,
  updated_at timestamp with time zone not null default now(),
  updated_by text
);

-- 2 · Constraints
alter table public.supervisor_pins add constraint supervisor_pins_pkey primary key (venue);

-- 3 · RLS activa, sin forzar, sin políticas (como en producción)
alter table public.supervisor_pins enable row level security;

-- 4 · ACL: {postgres=arwdDxtm, service_role=arwdDxtm}
revoke all on table public.supervisor_pins from public, anon, authenticated, service_role;
grant select, insert, update, delete, truncate, references, trigger, maintain on table public.supervisor_pins to service_role;
