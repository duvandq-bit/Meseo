-- ═══════════════════════════════════════════════════════════════════════════
-- S3-C-02-F0 · push_autorizar: el servidor decide a quién puede avisar cada uno
-- S3-C-02-F0.1 · con su propio limitador del PIN, por identidad y restaurante
-- S3-C-02-F0.3 · un solo intento de PIN en curso por cuenta y por restaurante
-- ═══════════════════════════════════════════════════════════════════════════
--
-- PARA QUÉ
--   Hoy send-push es pública: cualquiera elige destinatario y restaurante.
--   Esta función es la pieza que send-push (versión futura) consultará con el
--   bearer del usuario ANTES de enviar nada. Por sí sola no cambia ningún
--   comportamiento: nadie la llama todavía.
--
-- FIRMA
--   push_autorizar(p_tipo text, p_target text default null, p_pin text default null)
--     p_tipo    'persona' | 'restaurante'. Cualquier otro valor → tipo_no_permitido.
--     p_target  nombre de la persona (sólo 'persona'). Se busca SIEMPRE en el
--               restaurante de quien llama.
--     p_pin     PIN de supervisor (sólo 'restaurante').
--   No hay parámetro de restaurante, de empleado, de auth_user_id, de rol ni
--   de IP: todo sale de auth.uid() vía app.emp_actual/venue_actual/rol_actual.
--
-- RETORNO (json)
--   {ok:true, alcance:'persona', destino:<nombre canónico>, venue:<propio>}
--   {ok:true, alcance:'restaurante', venue:<propio>}
--   {ok:false, error: no_autenticado | sin_identidad | denegado | tipo_no_permitido}
--   'denegado' es idéntico para "no existe", "es de otro restaurante",
--   "PIN malo", "PIN de otro restaurante", "rol sin permiso" y "bloqueado".
--   El PIN nunca aparece en el retorno, en errores ni en registros.
--
-- DECISIONES
--   · 'persona' a uno mismo: permitido (aviso de bienvenida).
--   · 'restaurante': sólo manager/owner + PIN válido PARA SU restaurante
--     (el del propietario, '*', también vale, pero sólo para el restaurante
--     de quien llama: el venue nunca lo elige el cliente).
--   · 'admin' NO difunde (F0.2): en el servidor sólo es una cuenta que no
--     puntúa; no tiene ninguna capacidad propia. No se infiere autoridad del
--     nombre del rol.
--   · Difusión global (todos los restaurantes): NO existe. Decisión pendiente.
--
-- EL LIMITADOR (F0.1) — POR QUÉ NO verify_supervisor_pin
--   verify_supervisor_pin cuenta por `cf-connecting-ip`. Detrás de una Edge
--   Function esa IP es la de salida de AWS, que ROTA en cada invocación
--   (medido el 13/09/2026, ver limitador_pin_supervisor_ip_real.sql): los
--   fallos se reparten entre filas y el bloqueo no llega nunca; y cuando
--   coincide, un restaurante bloquea a otro. La vía que ya existe para eso,
--   verify_supervisor_pin_srv, exige service_role, y aquí la llamada viaja con
--   el bearer DEL USUARIO (hace falta para auth.uid()). No se toca ninguna de
--   las dos: las usan el navegador y otras funciones tal como están.
--
--   Aquí se cuenta por lo que el servidor SÍ sabe con certeza:
--     · 'uid:<auth.uid()>'  5 fallos en 15 min → bloqueo 15 min de esa cuenta.
--     · 'venue:<propio>'   10 fallos en 15 min → bloqueo 15 min del PIN de
--                           difusión de ese restaurante (frena la rotación de
--                           cuentas dentro del mismo restaurante).
--   Ninguna clave la elige el cliente. La IP no interviene.
--   · Bloqueado → 'denegado' sin evaluar el PIN (no hay oráculo).
--   · Acierto → se borra el contador DE ESA CUENTA; el del restaurante sigue
--     hasta que caduque su ventana (un acierto legítimo no limpia los fallos
--     de otra cuenta).
--   · PIN de otro restaurante: CUENTA como fallo (a diferencia del limitador
--     global), para que no sirva para descubrir PINes ajenos.
--   · PIN vacío, nulo o de más de 64: 'denegado' sin contar (no es un intento).
--   · Rol sin permiso: 'denegado' antes de mirar el PIN; no cuenta.
--
-- CONCURRENCIA (F0.2 → F0.3)
--   Sin serializar, N peticiones simultáneas pasaban todas la comprobación de
--   bloqueo antes de que ninguna guardara su fallo: 20 de 20 evaluadas con
--   límite 5 (medido con sesiones reales). Ahora cada intento toma, SIN
--   esperar, un candado de transacción por cuenta y otro por restaurante
--   (pg_try_advisory_xact_lock). Si alguno está ocupado → 'denegado' sin
--   evaluar el PIN y sin contar. Coste asumido: dos difusiones del mismo
--   restaurante en el mismo instante → una se deniega y se repite.
--
-- NO APLICADA.

-- ── 1 · Contadores del PIN de difusión ─────────────────────────────────────
create table public.push_pin_intentos (
  clave        text primary key,              -- 'uid:<uuid>' | 'venue:<restaurante>'
  fails        integer not null default 0,
  window_start timestamptz not null default now(),
  locked_until timestamptz
);
alter table public.push_pin_intentos enable row level security;   -- sin políticas: nadie del cliente
revoke all on table public.push_pin_intentos from public, anon, authenticated;

-- Un fallo más, atómico (sin leer-y-luego-escribir).
create function public._push_pin_fallo(p_clave text, p_max integer) returns void
language sql security definer set search_path = '' as $f$
  insert into public.push_pin_intentos as t (clave, fails, window_start, locked_until)
  values (p_clave, 1, now(), case when 1 >= p_max then now() + interval '15 minutes' end)
  on conflict (clave) do update set
    fails        = case when t.window_start < now() - interval '15 minutes' then 1 else t.fails + 1 end,
    window_start = case when t.window_start < now() - interval '15 minutes' then now() else t.window_start end,
    locked_until = case when (case when t.window_start < now() - interval '15 minutes' then 1 else t.fails + 1 end) >= p_max
                        then now() + interval '15 minutes' end;
$f$;
revoke all on function public._push_pin_fallo(text, integer) from public, anon, authenticated, service_role;

-- Sin parámetros de identidad: la cuenta y el restaurante los pone el servidor.
create function public._push_pin_evaluar(p_pin text) returns boolean
language plpgsql security definer set search_path = '' as $f$
declare
  v_uid   uuid := auth.uid();
  v_venue text := app.venue_actual();
  v_cu    text;
  v_cv    text;
begin
  if v_uid is null or v_venue is null then return false; end if;
  if p_pin is null or length(p_pin) = 0 or length(p_pin) > 64 then return false; end if;
  v_cu := 'uid:' || v_uid::text;
  v_cv := 'venue:' || v_venue;
  -- F0.2 · UN intento en curso por cuenta y por restaurante. Sin esto, N
  -- peticiones simultáneas pasaban todas la comprobación de bloqueo antes de
  -- que ninguna registrara su fallo (medido: 20 de 20 evaluadas con límite 5).
  -- Candado de transacción, sin espera: si otro intento de la misma cuenta o
  -- del mismo restaurante está evaluándose, éste se deniega SIN evaluar el PIN
  -- y SIN contar. Se suelta solo al terminar la transacción, después de que su
  -- fallo sea visible, así que el siguiente ve el contador ya actualizado.
  if not pg_try_advisory_xact_lock(hashtext('push_pin_intentos'), hashtext(v_cu))
     or not pg_try_advisory_xact_lock(hashtext('push_pin_intentos'), hashtext(v_cv)) then
    return false;
  end if;
  if exists (select 1 from public.push_pin_intentos
              where clave in (v_cu, v_cv) and locked_until > now()) then
    return false;                       -- bloqueado: misma respuesta que un PIN malo
  end if;
  if coalesce(public.sup_pin_ok(p_pin, v_venue), false) then
    delete from public.push_pin_intentos where clave = v_cu;
    return true;
  end if;
  perform public._push_pin_fallo(v_cu, 5);
  perform public._push_pin_fallo(v_cv, 10);
  return false;
end $f$;
revoke all on function public._push_pin_evaluar(text) from public, anon, authenticated, service_role;

-- ── 2 · La autorización ─────────────────────────────────────────────────────
create function public.push_autorizar(p_tipo text, p_target text default null, p_pin text default null)
returns json language plpgsql security definer set search_path = '' as $f$
declare
  v_emp   text;
  v_venue text;
  v_rol   text;
  v_dest  text;
begin
  if auth.uid() is null then
    return json_build_object('ok', false, 'error', 'no_autenticado');
  end if;
  v_emp   := app.emp_actual();
  v_venue := app.venue_actual();
  v_rol   := app.rol_actual();
  if v_emp is null or v_venue is null then
    return json_build_object('ok', false, 'error', 'sin_identidad');
  end if;

  if p_tipo = 'persona' then
    select e.name into v_dest from public.employees e
     where lower(e.name) = lower(trim(coalesce(p_target, ''))) and e.venue = v_venue;
    if v_dest is null then
      return json_build_object('ok', false, 'error', 'denegado');
    end if;
    return json_build_object('ok', true, 'alcance', 'persona', 'destino', v_dest, 'venue', v_venue);

  elsif p_tipo = 'restaurante' then
    -- 'admin' queda fuera a propósito (decidido en F0.2).
    if v_rol is null or v_rol not in ('manager', 'owner') then
      return json_build_object('ok', false, 'error', 'denegado');
    end if;
    if not public._push_pin_evaluar(p_pin) then
      return json_build_object('ok', false, 'error', 'denegado');
    end if;
    return json_build_object('ok', true, 'alcance', 'restaurante', 'venue', v_venue);
  end if;

  return json_build_object('ok', false, 'error', 'tipo_no_permitido');
end $f$;

revoke all on function public.push_autorizar(text, text, text) from public, anon;
grant execute on function public.push_autorizar(text, text, text) to authenticated;

-- ── VUELTA ATRÁS (no ejecutar salvo decisión expresa) ────────────────────────
--   drop function public.push_autorizar(text, text, text);
--   drop function public._push_pin_evaluar(text);
--   drop function public._push_pin_fallo(text, integer);
--   drop table public.push_pin_intentos;
