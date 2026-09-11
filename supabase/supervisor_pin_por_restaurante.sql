-- ═══════════════════════════════════════════════════════════════
-- Meseo · Un PIN de supervisor POR RESTAURANTE
-- ═══════════════════════════════════════════════════════════════
--
-- El problema
--   Hasta aquí había UN solo PIN para toda la aplicación. Con M.B. de camino
--   eso significa que el manager de un restaurante abre el panel del otro: ve
--   su equipo, su cuadrante, sus notas y —lo más serio— puede renovar su
--   código de acceso y dejar a su gente sin poder registrarse.
--
-- Lo que hace este script
--   1. `supervisor_pins`: un PIN por restaurante, con hash bcrypt.
--   2. `sup_pin_scope(pin)`: el ÚNICO sitio donde se resuelve qué abre un PIN.
--      Devuelve '*' (el propietario, entra en todos), el id de un restaurante,
--      o null si no vale. NO se concede a anon: sólo la llaman funciones
--      security definer, que van detrás del limitador por IP.
--   3. `verify_supervisor_pin(pin, venue)`: el mismo verificador de siempre,
--      con su limitador intacto, ahora con el restaurante como segundo
--      argumento.
--   4. Las cinco funciones que se autorizan con el PIN pasan a comprobar
--      TAMBIÉN el restaurante: el código de acceso (ver y renovar), el rol de
--      un empleado y el cuadrante.
--
-- Lo que NO cambia
--   El PIN maestro (`supervisor_pin_secret`) sigue abriéndolo todo. Mientras
--   `supervisor_pins` esté vacía —que es como queda al aplicar esto— no cambia
--   absolutamente nada para el propietario. Imposible quedarse fuera.
--
-- Dar de alta el PIN de un restaurante (desde el editor SQL, service_role):
--   select set_supervisor_venue_pin('mb', '4821', 'Duvan');
-- Quitarlo:
--   select drop_supervisor_venue_pin('mb');
-- ═══════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ─── 1. Un PIN por restaurante ───────────────────────────────────
create table if not exists public.supervisor_pins (
  venue       text primary key,
  pin_hash    text not null,
  updated_at  timestamptz not null default now(),
  updated_by  text
);
alter table public.supervisor_pins enable row level security;
revoke all on public.supervisor_pins from anon, authenticated;

-- ─── 2. El ámbito de un PIN — el único sitio donde se decide ─────
-- '*' = el propietario (entra en todos) · '<venue>' = sólo ése · null = no vale.
create or replace function public.sup_pin_scope(p_pin text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash  text;
  v_venue text;
begin
  if p_pin is null or length(p_pin) = 0 or length(p_pin) > 64 then
    return null;
  end if;
  -- El maestro primero: es el que no puede fallar nunca.
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
$$;
-- Sin limitador propio: si se pudiera llamar desde el navegador sería un
-- oráculo de fuerza bruta. Sólo la usan las funciones de aquí abajo.
revoke all on function public.sup_pin_scope(text) from public, anon, authenticated;

-- ¿Este PIN puede tocar ESTE restaurante?
create or replace function public.sup_pin_ok(p_pin text, p_venue text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_scope text;
begin
  v_scope := public.sup_pin_scope(p_pin);
  if v_scope is null then return false; end if;
  if v_scope = '*' then return true; end if;
  return coalesce(trim(p_venue),'') <> '' and v_scope = p_venue;
end;
$$;
revoke all on function public.sup_pin_ok(text, text) from public, anon, authenticated;

-- ─── 3. El verificador de siempre, ahora con restaurante ─────────
-- Se BORRA la versión de un argumento y se crea una de dos con valor por
-- defecto: si se dejaran las dos, una llamada con un solo argumento sería
-- ambigua y Postgres la rechazaría.
--
-- `p_venue` nulo significa «vale para cualquier restaurante». Es lo que envían
-- los móviles con una versión vieja de la app en caché, y tiene que seguir
-- funcionando: dejar a un supervisor fuera del panel porque su teléfono no ha
-- recargado todavía sería peor que lo que esto viene a arreglar. Las funciones
-- que de verdad tocan datos —el código de acceso, los roles, el cuadrante— sí
-- exigen el restaurante, y ésas son las que importan.
drop function if exists public.verify_supervisor_pin(text);

create or replace function public.verify_supervisor_pin(pin_input text, p_venue text default null)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_ip    text;
  v_rec   public.sup_pin_attempts%rowtype;
  v_scope text;
  v_ok    boolean;
begin
  if pin_input is null or length(pin_input) = 0 or length(pin_input) > 64 then
    return false;
  end if;

  begin
    v_ip := coalesce(nullif(split_part(
      (current_setting('request.headers', true)::json ->> 'x-forwarded-for'), ',', 1), ''), 'unknown');
  exception when others then v_ip := 'unknown';
  end;

  select * into v_rec from public.sup_pin_attempts where ip = v_ip;

  if v_rec.ip is not null and v_rec.locked_until is not null and v_rec.locked_until > now() then
    return false;
  end if;

  v_scope := public.sup_pin_scope(pin_input);
  v_ok := v_scope is not null
      and (v_scope = '*' or p_venue is null or v_scope = p_venue);

  if v_ok then
    delete from public.sup_pin_attempts where ip = v_ip;
    return true;
  end if;

  -- Un PIN bueno en el restaurante equivocado NO cuenta como intento fallido:
  -- si contara, el manager de M.B. abriendo Txoko por error bloquearía por IP
  -- a todo el hotel, que sale por la misma línea.
  if v_scope is not null then
    return false;
  end if;

  if v_rec.ip is null then
    insert into public.sup_pin_attempts(ip, fails, window_start) values (v_ip, 1, now());
  elsif v_rec.window_start < now() - interval '15 minutes' then
    update public.sup_pin_attempts set fails = 1, window_start = now(), locked_until = null where ip = v_ip;
  else
    update public.sup_pin_attempts
       set fails = fails + 1,
           locked_until = case when fails + 1 >= 10 then now() + interval '15 minutes' else null end
     where ip = v_ip;
  end if;
  return false;
end;
$$;
grant execute on function public.verify_supervisor_pin(text, text) to anon, authenticated;

-- ─── 4. Alta y baja del PIN de un restaurante (sólo service_role) ─
create or replace function public.set_supervisor_venue_pin(p_venue text, p_pin text, p_by text default null)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if coalesce(trim(p_venue),'') = '' then
    raise exception 'falta el restaurante';
  end if;
  if p_pin is null or length(p_pin) < 4 then
    raise exception 'el PIN necesita al menos 4 caracteres';
  end if;
  -- Un PIN de restaurante NO puede coincidir con el maestro: si no, quitárselo
  -- a un manager dejaría de servir de nada.
  if public.sup_pin_scope(p_pin) = '*' then
    raise exception 'ese PIN es el del propietario: elige otro';
  end if;
  insert into public.supervisor_pins(venue, pin_hash, updated_at, updated_by)
  values (p_venue, crypt(p_pin, gen_salt('bf', 12)), now(), p_by)
  on conflict (venue) do update
    set pin_hash = excluded.pin_hash, updated_at = now(), updated_by = excluded.updated_by;
end;
$$;
revoke all on function public.set_supervisor_venue_pin(text, text, text) from public, anon, authenticated;

create or replace function public.drop_supervisor_venue_pin(p_venue text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.supervisor_pins where venue = p_venue;
end;
$$;
revoke all on function public.drop_supervisor_venue_pin(text) from public, anon, authenticated;

-- ─── 5. Las funciones que se autorizan con el PIN ────────────────
-- A partir de aquí, tener un PIN bueno ya no basta: tiene que ser el DE ESE
-- restaurante (o el del propietario).

create or replace function public.venue_code_show(p_pin text, p_venue text)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not public.verify_supervisor_pin(p_pin, p_venue) then
    return json_build_object('ok', false, 'error', 'denied');
  end if;
  return coalesce(
    (select json_build_object('ok', true, 'venue', vc.venue, 'code', vc.code,
                              'rotated_at', vc.rotated_at)
       from public.venue_codes vc where vc.venue = p_venue),
    json_build_object('ok', true, 'venue', p_venue, 'code', null));
end;
$$;

create or replace function public.venue_code_rotate(p_pin text, p_venue text, p_by text default null)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_code text;
begin
  if coalesce(trim(p_venue),'') = '' then
    return json_build_object('ok', false, 'error', 'venue_missing');
  end if;
  -- Renovar el código de OTRO restaurante deja a su equipo sin poder
  -- registrarse. Es lo más destructivo que hay detrás de este PIN.
  if not public.verify_supervisor_pin(p_pin, p_venue) then
    return json_build_object('ok', false, 'error', 'denied');
  end if;
  -- Seis caracteres sin las parejas que se confunden al dictarlo por teléfono
  -- (0/O, 1/I/L). Se dice en voz alta en un pase, no se copia y pega.
  select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789',
                           1 + floor(random()*31)::int, 1), '')
    into v_code from generate_series(1,6);

  insert into public.venue_codes(venue, code, rotated_at, rotated_by)
  values (p_venue, v_code, now(), p_by)
  on conflict (venue) do update
    set code = excluded.code, rotated_at = now(), rotated_by = excluded.rotated_by;

  return json_build_object('ok', true, 'venue', p_venue, 'code', v_code);
end;
$$;

create or replace function public.employee_set_role(p_pin text, p_name text, p_role text)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_venue text;
begin
  -- Primero el verificador de siempre, que es quien lleva el limitador por IP;
  -- si no, lo de abajo sería un oráculo para adivinar PINes sin coste.
  if not public.verify_supervisor_pin(p_pin) then
    return json_build_object('ok', false, 'error', 'denied');
  end if;
  if p_role not in ('staff','admin','manager') then
    return json_build_object('ok', false, 'error', 'rol_invalido');
  end if;
  -- Sólo el propietario reparte administración y mando. Un manager que pudiera
  -- nombrar administradores se estaría dando a sí mismo la llave de TODOS los
  -- restaurantes, que es justo lo que este PIN por restaurante viene a cerrar.
  if p_role in ('admin','manager') and public.sup_pin_scope(p_pin) <> '*' then
    return json_build_object('ok', false, 'error', 'solo_propietario');
  end if;
  select e.venue into v_venue from public.employees e where e.name = p_name;
  if not found then
    return json_build_object('ok', false, 'error', 'unknown_employee');
  end if;
  -- Y nadie toca a alguien de otro restaurante.
  if not public.sup_pin_ok(p_pin, v_venue) then
    return json_build_object('ok', false, 'error', 'otro_restaurante');
  end if;
  update public.employees set role = p_role where name = p_name;
  return json_build_object('ok', true, 'name', p_name, 'role', p_role);
end;
$$;

create or replace function public.save_rota(pin_input text, week_start_input date, data_input jsonb, venue_input text default 'txoko'::text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if coalesce(trim(venue_input),'') = '' then
    raise exception 'falta el restaurante';
  end if;
  if not public.verify_supervisor_pin(pin_input, venue_input) then
    return false;
  end if;
  -- La semana debe empezar en LUNES: si no, dos semanas se solaparían y la app
  -- enseñaría turnos cruzados.
  if extract(isodow from week_start_input) <> 1 then
    raise exception 'week_start debe ser lunes';
  end if;
  if data_input is null or jsonb_typeof(data_input) <> 'object' then
    raise exception 'data inválida';
  end if;
  insert into public.horarios (venue, week_start, data, updated_at)
  values (venue_input, week_start_input, data_input, now())
  on conflict (venue, week_start) do update
    set data = excluded.data, updated_at = now();
  return true;
end;
$$;

-- ═══════════════════════════════════════════════════════════════
-- Comprobación después de aplicarlo (todo debe salir true):
--   select public.verify_supervisor_pin('<el PIN del propietario>', 'txoko');
--   select public.verify_supervisor_pin('<el PIN del propietario>', 'mb');
-- ═══════════════════════════════════════════════════════════════
