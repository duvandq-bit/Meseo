-- F2-1 · M1 · Réplica de public.employees de producción (advkoujfgbrrjvqexrcu)
-- Solo para la rama f2-push (sslcgakpxiwhjxsgmngg). Definiciones copiadas de
-- pg_get_functiondef / pg_get_constraintdef / pg_get_indexdef / pg_policy de
-- producción. ACL explícitas: no se depende de los default privileges.

-- 1 · Tabla (25 columnas, mismo orden, tipos, nulabilidad y defaults)
create table public.employees (
  name            text not null,
  xp              integer default 0,
  streak          integer default 0,
  last_study_day  text,
  topic_scores    text default '{}'::text,
  known_dishes    text default '{}'::text,
  exam_correct    text default '{}'::text,
  sessions_count  integer default 0,
  txoko_record    integer default 0,
  updated_at      timestamp with time zone default now(),
  sessions_data   text default '[]'::text,
  duel_wins       integer default 0,
  avatar          text,
  last_active_at  timestamp with time zone default now(),
  pin             text,
  last_login      timestamp with time zone,
  achievements    text default '[]'::text,
  extras          text default '{}'::text,
  venue           text not null default 'txoko'::text,
  display_name    text,
  role            text not null default 'staff'::text,
  nda_version     text,
  nda_signed_at   timestamp with time zone,
  registered_at   timestamp with time zone,
  auth_user_id    uuid
);

-- 2 · Constraints e índices
alter table public.employees add constraint employees_pkey primary key (name);
alter table public.employees add constraint employees_auth_user_id_key unique (auth_user_id);
alter table public.employees add constraint employees_auth_user_id_fkey foreign key (auth_user_id) references auth.users(id) on delete set null;
create unique index employees_name_ci_unique on public.employees using btree (lower(name));
create index employees_role_idx on public.employees using btree (role);
create index employees_venue_idx on public.employees using btree (venue);

-- 3 · Funciones de trigger (literales de producción)
CREATE OR REPLACE FUNCTION public.employees_solo_alta_con_codigo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if current_setting('app.alta_valida', true) = 'si' then
    return new;
  end if;
  if exists (select 1 from public.employees e where e.name = new.name) then
    return new;  -- upsert sobre cuenta existente: es sincronización de progreso
  end if;
  raise exception 'alta_sin_codigo'
    using hint = 'Las cuentas se crean con employee_register y el código del restaurante';
end;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_no_puntua()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.role = 'admin' then
    new.xp := 0;
    new.streak := 0;
    new.sessions_count := 0;
    new.txoko_record := 0;
    new.duel_wins := 0;
    new.topic_scores := null;
    new.known_dishes := null;
    new.exam_correct := null;
    new.sessions_data := null;
    new.achievements := null;
    -- `extras` guarda la liga semanal y los intentos por plato: también es
    -- puntuación. Lo demás de la ficha (restaurante, nombre visible, firma,
    -- último acceso) se respeta: la cuenta tiene que poder usar la app.
    new.extras := null;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.employees_identidad_inmutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if current_user in ('anon','authenticated') then
    -- El nombre es la identidad, y el histórico cuelga de él por texto.
    if new.name is distinct from old.name then
      raise exception 'renombrar_no_permitido'
        using errcode = '42501',
              hint = 'Renombrar a un empleado mueve su histórico: es una operación de supervisor, no del cliente.';
    end if;
    -- Y la identidad de verdad la asigna el servidor, nunca quien llama.
    if new.auth_user_id is distinct from old.auth_user_id then
      raise exception 'identidad_no_editable'
        using errcode = '42501',
              hint = 'auth_user_id lo asigna el servidor tras verificar el PIN.';
    end if;
  end if;
  return new;
end $function$
;

-- 4 · Triggers
create trigger employees_alta_con_codigo before insert on public.employees
  for each row execute function public.employees_solo_alta_con_codigo();
create trigger trg_admin_no_puntua before insert or update on public.employees
  for each row execute function public.admin_no_puntua();
create trigger trg_employees_identidad_inmutable before update on public.employees
  for each row execute function public.employees_identidad_inmutable();

-- 5 · RLS (sin forzar, como en producción)
alter table public.employees enable row level security;

-- 6 · Policies (roles = public, permissive, como en producción)
create policy employees_alta     on public.employees as permissive for insert to public with check (true);
create policy employees_leer     on public.employees as permissive for select to public using (true);
create policy employees_progreso on public.employees as permissive for update to public using (true) with check (true);

-- 7 · ACL explícitas
-- Tabla: {postgres=arwdDxtm, anon=Dxtm, authenticated=Dxtm, service_role=arwdDxtm}
revoke all on table public.employees from public, anon, authenticated, service_role;
grant truncate, references, trigger, maintain on table public.employees to anon, authenticated;
grant select, insert, update, delete, truncate, references, trigger, maintain on table public.employees to service_role;
-- Columnas: arw (17) · r (4) · ninguna (pin, nda_signed_at, registered_at, auth_user_id)
grant select (name, xp, streak, last_study_day, topic_scores, known_dishes, exam_correct, sessions_count, txoko_record, updated_at, sessions_data, duel_wins, avatar, last_active_at, last_login, achievements, extras),
      insert (name, xp, streak, last_study_day, topic_scores, known_dishes, exam_correct, sessions_count, txoko_record, updated_at, sessions_data, duel_wins, avatar, last_active_at, last_login, achievements, extras),
      update (name, xp, streak, last_study_day, topic_scores, known_dishes, exam_correct, sessions_count, txoko_record, updated_at, sessions_data, duel_wins, avatar, last_active_at, last_login, achievements, extras)
  on public.employees to anon, authenticated;
grant select (venue, display_name, role, nda_version) on public.employees to anon, authenticated;
-- Funciones
revoke all on function public.employees_solo_alta_con_codigo() from public, anon, authenticated, service_role;
grant execute on function public.employees_solo_alta_con_codigo() to service_role;
revoke all on function public.admin_no_puntua() from public, anon, authenticated, service_role;
grant execute on function public.admin_no_puntua() to public, anon, authenticated, service_role;
revoke all on function public.employees_identidad_inmutable() from public, anon, authenticated, service_role;
grant execute on function public.employees_identidad_inmutable() to anon, authenticated, service_role;
