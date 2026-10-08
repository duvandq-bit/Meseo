-- ═══ D1-M0b-B · LIMITADOR POR ORIGEN DE reset-pin ═══════════════════════════
-- Meseo · oct 2026. Primero en f2-push; en producción sólo con autorización.
--
-- EL PROBLEMA
--   reset-pin v7 comprueba el PIN en tres acciones (set-email, email-status,
--   change-pin) comparando el hash a mano, sin contar fallos: se podía probar
--   PIN tras PIN contra cualquier nombre sin límite. El login (`sesion`) sí
--   limita, porque pasa por verify_employee_pin_sha.
--
-- LO QUE HACE (junto con reset-pin v8)
--   · POR OBJETIVO: v8 deja de comparar a mano y llama a
--     verify_employee_pin_sha, la misma del login, sin tocarla: 10 fallos en
--     15 min bloquean ese nombre 15 min. Los fallos de reset-pin y los del
--     login cuentan juntos, así que no hay una segunda puerta sin límite.
--   · POR ORIGEN: esta tabla. Cuenta por IP del navegador (cf-connecting-ip,
--     la cabecera medida por la sonda del 13/09/2026), guardada como
--     HMAC-SHA256 con una clave del servidor: nunca la IP en claro.
--       'pin:<hmac>'     20 fallos de PIN en 15 min → 15 min sin evaluar PIN
--       'correo:<hmac>'   5 peticiones de enlace en 15 min → 15 min sin enviar
--     Frena a quien va rotando nombres desde el mismo sitio (lo que el límite
--     por objetivo no ve).
--   · Ningún PIN, hash de PIN ni correo se guarda aquí.
--
-- QUIÉN LO USA
--   Sólo reset-pin, con service_role. anon y authenticated no ven la tabla ni
--   pueden ejecutar las funciones.
create table public.reset_pin_origen (
  clave        text primary key
               check (clave ~ '^(pin|correo):[0-9a-f]{64}$'),
  fails        integer not null default 0,
  window_start timestamptz not null default now(),
  locked_until timestamptz
);
comment on table public.reset_pin_origen is
  'Limitador por origen de reset-pin: HMAC de la IP, nunca la IP ni el PIN. Sólo service_role vía funciones.';
alter table public.reset_pin_origen enable row level security;   -- sin políticas
revoke all on table public.reset_pin_origen from public, anon, authenticated, service_role;

-- ¿Está bloqueado este origen para este tipo de intento?
create function public.reset_pin_origen_bloqueado(p_clave text) returns boolean
language sql stable security definer set search_path = '' as $f$
  select exists (select 1 from public.reset_pin_origen
                  where clave = p_clave and locked_until > now());
$f$;

-- Un intento más, atómico (sin leer-y-luego-escribir). Mismo patrón que
-- _push_pin_fallo. El máximo depende del tipo y no lo elige quien llama.
create function public.reset_pin_origen_anotar(p_clave text) returns void
language plpgsql security definer set search_path = '' as $f$
declare
  v_max integer := case split_part(p_clave, ':', 1) when 'pin' then 20 when 'correo' then 5 end;
begin
  if v_max is null or p_clave !~ '^(pin|correo):[0-9a-f]{64}$' then
    raise exception 'clave no válida' using errcode = '22023';
  end if;
  insert into public.reset_pin_origen as t (clave, fails, window_start, locked_until)
  values (p_clave, 1, now(), case when 1 >= v_max then now() + interval '15 minutes' end)
  on conflict (clave) do update set
    fails        = case when t.window_start < now() - interval '15 minutes' then 1 else t.fails + 1 end,
    window_start = case when t.window_start < now() - interval '15 minutes' then now() else t.window_start end,
    locked_until = case when (case when t.window_start < now() - interval '15 minutes' then 1 else t.fails + 1 end) >= v_max
                        then now() + interval '15 minutes'
                        else t.locked_until end;
end $f$;

revoke all on function public.reset_pin_origen_bloqueado(text) from public, anon, authenticated;
revoke all on function public.reset_pin_origen_anotar(text) from public, anon, authenticated;
grant execute on function public.reset_pin_origen_bloqueado(text) to service_role;
grant execute on function public.reset_pin_origen_anotar(text) to service_role;

-- ── CÓMO SE DESHACE ──────────────────────────────────────────────────────
--   (antes, volver a desplegar reset-pin v7: v8 depende de estas funciones)
--   drop function public.reset_pin_origen_anotar(text);
--   drop function public.reset_pin_origen_bloqueado(text);
--   drop table public.reset_pin_origen;
