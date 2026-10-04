-- F2-4 · M4 · supervisor_pin_secret + sup_pin_scope + sup_pin_ok (réplica de producción advkoujfgbrrjvqexrcu)
-- Solo para la rama f2-push (sslcgakpxiwhjxsgmngg). Sin datos ni secretos.
-- Funciones literales de pg_get_functiondef de producción. ACL explícitas.

-- 1 · Tabla (3 columnas, mismo orden, tipos, nulabilidad y defaults)
create table public.supervisor_pin_secret (
  id         smallint not null default 1,
  pin_hash   text not null,
  updated_at timestamp with time zone not null default now()
);

-- 2 · Constraints
alter table public.supervisor_pin_secret add constraint supervisor_pin_secret_pkey primary key (id);
alter table public.supervisor_pin_secret add constraint single_row check ((id = 1));

-- 3 · RLS activa, sin forzar, sin políticas (como en producción)
alter table public.supervisor_pin_secret enable row level security;

-- 4 · ACL de la tabla: {postgres=arwdDxtm, service_role=arwdDxtm}
revoke all on table public.supervisor_pin_secret from public, anon, authenticated, service_role;
grant select, insert, update, delete, truncate, references, trigger, maintain on table public.supervisor_pin_secret to service_role;

-- 5 · Funciones (literales de producción)
CREATE OR REPLACE FUNCTION public.sup_pin_scope(p_pin text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_hash  text;
  v_venue text;
begin
  if p_pin is null or length(p_pin) = 0 or length(p_pin) > 64 then
    return null;
  end if;
  select pin_hash into v_hash from public.supervisor_pin_secret where id = 1;
  if v_hash is not null and crypt(p_pin, v_hash) = v_hash then
    return '*';
  end if;
  select sp.venue into v_venue
    from public.supervisor_pins sp
   where crypt(p_pin, sp.pin_hash) = sp.pin_hash
   limit 1;
  return v_venue;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.sup_pin_ok(p_pin text, p_venue text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare v_scope text;
begin
  v_scope := public.sup_pin_scope(p_pin);
  if v_scope is null then return false; end if;
  if v_scope = '*' then return true; end if;
  return coalesce(trim(p_venue),'') <> '' and v_scope = p_venue;
end;
$function$
;

-- 6 · ACL de las funciones: {postgres=X, service_role=X}
revoke all on function public.sup_pin_scope(text)    from public, anon, authenticated, service_role;
revoke all on function public.sup_pin_ok(text, text) from public, anon, authenticated, service_role;
grant execute on function public.sup_pin_scope(text)    to service_role;
grant execute on function public.sup_pin_ok(text, text) to service_role;
