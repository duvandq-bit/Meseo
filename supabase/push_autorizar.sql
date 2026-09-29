-- ═══════════════════════════════════════════════════════════════════════════
-- S3-C-02-F0 · push_autorizar: el servidor decide a quién puede avisar cada uno
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
--   No hay parámetro de restaurante, de empleado, de auth_user_id ni de rol:
--   todo eso sale de auth.uid() vía app.emp_actual/venue_actual/rol_actual.
--
-- RETORNO (json)
--   {ok:true, alcance:'persona', destino:<nombre canónico>, venue:<propio>}
--   {ok:true, alcance:'restaurante', venue:<propio>}
--   {ok:false, error: no_autenticado | sin_identidad | denegado | tipo_no_permitido}
--   'denegado' es idéntico para "no existe" y "es de otro restaurante".
--   El PIN nunca aparece en el retorno, en errores ni en registros.
--
-- DECISIONES
--   · 'persona' a uno mismo: permitido (aviso de bienvenida).
--   · 'restaurante': sólo manager/owner + PIN válido PARA SU restaurante.
--     Se exige verify_supervisor_pin (limitador de intentos) Y sup_pin_ok con
--     el venue propio: el PIN maestro no abre otro restaurante porque el venue
--     nunca lo elige el cliente.
--   · Difusión global (todos los restaurantes): NO existe en esta función.
--     Decisión pendiente del owner.
--
-- RIESGO CONOCIDO (a resolver antes de que send-push la use)
--   El limitador de verify_supervisor_pin cuenta por IP (cf-connecting-ip).
--   Si la llamada llega desde la Edge Function, la IP puede ser la de salida
--   de la función, compartida por todos: bloqueo común o límite débil.
--
-- NO APLICADA.

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
    if v_rol is null or v_rol not in ('manager', 'owner') then
      return json_build_object('ok', false, 'error', 'denegado');
    end if;
    if not coalesce(public.verify_supervisor_pin(p_pin, v_venue), false)
       or not coalesce(public.sup_pin_ok(p_pin, v_venue), false) then
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
