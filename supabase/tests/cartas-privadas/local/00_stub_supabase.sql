-- Réplica LOCAL y DESECHABLE (PostgreSQL 16) de lo mínimo de Supabase que usan
-- cartas_privadas.sql y cartas_revisores.sql. No es Supabase: sirve para probar
-- las políticas sin tocar ningún proyecto real.
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create schema auth; create schema app;
grant usage on schema auth, app, public to anon, authenticated, service_role;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid $$;
grant execute on function auth.uid() to anon, authenticated, service_role;
create table public.employees (
  name text primary key, venue text not null default 'txoko', role text not null default 'staff',
  display_name text, auth_user_id uuid unique references auth.users(id));
create function app.venue_actual() returns text language sql stable security definer set search_path = ''
  as $$ select e.venue from public.employees e where e.auth_user_id = auth.uid() $$;
create function app.rol_actual() returns text language sql stable security definer set search_path = ''
  as $$ select e.role from public.employees e where e.auth_user_id = auth.uid() $$;
revoke all on function app.venue_actual(), app.rol_actual() from public, anon;
grant execute on function app.venue_actual(), app.rol_actual() to authenticated, service_role;
