-- ═══ EL LIMITADOR DEL PIN VUELVE A VER LA IP DE VERDAD ═══════════════════
-- APLICADO el 13 de septiembre de 2026 (migración
-- `limitador_pin_supervisor_ip_real`). Copia para el repositorio.
--
-- EL PROBLEMA, MEDIDO
--   Cuando la llamada pasa por una Edge Function, la IP que ve Postgres es la
--   de salida de AWS, y CAMBIA en cada invocación. Tres intentos fallidos
--   dejaron tres filas con fallos=1 (35.181.60.154, 13.36.173.70, 13.38.52.60)
--   en vez de una con 3, así que el bloqueo a los 10 no llegaba nunca.
--
-- DOS BARRERAS, NO UNA
--   La primera son los PERMISOS: el camino privilegiado vive en una función
--   APARTE que `anon` y `authenticated` no pueden ejecutar. No es una
--   comprobación esquivable: la llamada no existe para ellos.
--   La segunda, dentro, es el rol del JWT. Si la primera fallara, sigue en pie.
--
-- NI x-forwarded-for NI sb-forwarded-for
--   La primera es acumulativa y su primer elemento puede venir del cliente
--   (medido: llegó `85.31.131.142,85.31.131.142, 99.82.162.172`). La segunda no
--   está documentada. Se usa `cf-connecting-ip`, que pone Cloudflare y
--   sobrescribe lo que mande el cliente (medido: 85.31.131.142, un solo valor).
--
-- NO CAMBIA el umbral (10), ni la ventana (15 minutos), ni la semántica.

create or replace function public._sup_pin_evaluar(p_pin text, p_venue text, p_ip text)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare v_rec public.sup_pin_attempts%rowtype; v_scope text; v_ok boolean; v_ip text;
begin
  if p_pin is null or length(p_pin) = 0 or length(p_pin) > 64 then return false; end if;
  v_ip := coalesce(nullif(p_ip, ''), 'unknown');
  select * into v_rec from public.sup_pin_attempts where ip = v_ip;
  if v_rec.ip is not null and v_rec.locked_until is not null and v_rec.locked_until > now() then
    return false;                       -- bloqueado: misma respuesta que un PIN malo
  end if;
  v_scope := public.sup_pin_scope(p_pin);
  v_ok := v_scope is not null and (v_scope = '*' or p_venue is null or v_scope = p_venue);
  if v_ok then
    delete from public.sup_pin_attempts where ip = v_ip;
    return true;
  end if;
  if v_scope is not null then return false; end if;   -- PIN de otro restaurante: no cuenta
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
end $$;
revoke all on function public._sup_pin_evaluar(text,text,text) from public, anon, authenticated, service_role;

create or replace function public._sup_pin_ip_directa() returns text
language plpgsql stable security definer set search_path = ''
as $$
declare v text;
begin
  begin v := current_setting('request.headers', true)::json ->> 'cf-connecting-ip';
  exception when others then v := null; end;
  return coalesce(nullif(v, ''), 'unknown');
end $$;
revoke all on function public._sup_pin_ip_directa() from public, anon, authenticated, service_role;

-- La de siempre: MISMA FIRMA, mismo comportamiento. El navegador la sigue
-- llamando igual y ve su propia IP.
create or replace function public.verify_supervisor_pin(pin_input text, p_venue text default null)
returns boolean language plpgsql security definer set search_path = ''
as $$
begin
  return public._sup_pin_evaluar(pin_input, p_venue, public._sup_pin_ip_directa());
end $$;

-- HALLAZGO DE LA AUDITORÍA: tenía EXECUTE concedido a PUBLIC («=X/postgres»).
-- Se retira. `anon` y `authenticated` conservan el suyo, explícito.
revoke execute on function public.verify_supervisor_pin(text,text) from public;

-- El camino privilegiado, en función APARTE. `anon` y `authenticated` no
-- tienen EXECUTE: para ellos la llamada no existe. Ésa es la barrera de
-- verdad; la del rol es el refuerzo.
create or replace function public.verify_supervisor_pin_srv(
  pin_input text, p_venue text default null, p_ip text default null)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare v_rol text; v_ip text;
begin
  begin v_rol := current_setting('request.jwt.claims', true)::json ->> 'role';
  exception when others then v_rol := null; end;
  v_ip := null;
  if p_ip is not null and v_rol = 'service_role' then
    -- Validación robusta: el propio tipo `inet`. Acepta IPv4 e IPv6 y rechaza
    -- todo lo demás mejor que cualquier expresión regular.
    begin perform p_ip::inet; v_ip := p_ip;
    exception when others then v_ip := null; end;
  end if;
  if v_ip is null then v_ip := public._sup_pin_ip_directa(); end if;
  return public._sup_pin_evaluar(pin_input, p_venue, v_ip);
end $$;
revoke all     on function public.verify_supervisor_pin_srv(text,text,text) from public, anon, authenticated;
grant  execute on function public.verify_supervisor_pin_srv(text,text,text) to service_role;

-- ── CÓMO SE DESHACE ──────────────────────────────────────────────────────
--   drop function public.verify_supervisor_pin_srv(text,text,text);
--   (y restaurar verify_supervisor_pin desde supervisor_pin_por_restaurante.sql)
