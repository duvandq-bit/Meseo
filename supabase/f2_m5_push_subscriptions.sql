-- F2-5 · M5 · Réplica de public.push_subscriptions de producción (advkoujfgbrrjvqexrcu)
-- Solo para la rama f2-push (sslcgakpxiwhjxsgmngg). Sin datos. Definiciones de
-- catálogo de producción; función de trigger literal. ACL explícitas.

-- 1 · Tabla (7 columnas; id identity ALWAYS bigint, start 1, inc 1, cache 1, sin ciclo)
create table public.push_subscriptions (
  id            bigint generated always as identity (start with 1 increment by 1 minvalue 1 maxvalue 9223372036854775807 cache 1 no cycle),
  employee_name text not null,
  endpoint      text not null,
  keys_p256dh   text not null,
  keys_auth     text not null,
  created_at    timestamp with time zone default now(),
  venue         text not null default 'txoko'::text
);

-- 2 · Constraints e índices
alter table public.push_subscriptions add constraint push_subscriptions_pkey primary key (id);
alter table public.push_subscriptions add constraint push_subscriptions_employee_name_endpoint_key unique (employee_name, endpoint);
alter table public.push_subscriptions add constraint push_subscriptions_endpoint_chk check ((endpoint ~ '^https://(fcm\.googleapis\.com|web\.push\.apple\.com)/'::text));
create index push_subscriptions_venue_idx on public.push_subscriptions using btree (venue);

-- 3 · Función de trigger (literal de producción)
CREATE OR REPLACE FUNCTION public.push_subscriptions_propietario()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$
;

-- 4 · Trigger
create trigger trg_push_subscriptions_propietario before insert on public.push_subscriptions
  for each row execute function public.push_subscriptions_propietario();

-- 5 · RLS activa, sin forzar
alter table public.push_subscriptions enable row level security;

-- 6 · Policies (authenticated, permissive), sin política de UPDATE
create policy push_propias_delete on public.push_subscriptions as permissive for delete to authenticated
  using (((employee_name = app.emp_actual()) AND (venue = app.venue_actual())));
create policy push_propias_insert on public.push_subscriptions as permissive for insert to authenticated
  with check (((employee_name = app.emp_actual()) AND (venue = app.venue_actual())));
create policy push_propias_select on public.push_subscriptions as permissive for select to authenticated
  using (((employee_name = app.emp_actual()) AND (venue = app.venue_actual())));

-- 7 · ACL explícitas
-- Tabla: {postgres=arwdDxtm, authenticated=arwdm, service_role=arwdDxtm}
revoke all on table public.push_subscriptions from public, anon, authenticated, service_role;
grant select, insert, update, delete, maintain on table public.push_subscriptions to authenticated;
grant select, insert, update, delete, truncate, references, trigger, maintain on table public.push_subscriptions to service_role;
-- Secuencia: {postgres=rwU, anon=rw, authenticated=rwU, service_role=rwU} (literal de producción, incl. anon=rw)
revoke all on sequence public.push_subscriptions_id_seq from public, anon, authenticated, service_role;
grant select, update on sequence public.push_subscriptions_id_seq to anon;
grant select, update, usage on sequence public.push_subscriptions_id_seq to authenticated, service_role;
-- Función: {postgres=X, service_role=X}
revoke all on function public.push_subscriptions_propietario() from public, anon, authenticated, service_role;
grant execute on function public.push_subscriptions_propietario() to service_role;
