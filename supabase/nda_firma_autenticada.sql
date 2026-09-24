-- ═══════════════════════════════════════════════════════════════════════════
-- Compromiso de uso · la firma queda atada a la identidad autenticada
-- ═══════════════════════════════════════════════════════════════════════════
--
-- QUÉ CIERRA (auditoría técnica, sep 2026, probado como `anon` y revertido):
--   · nda_sign(p_name, p_full_name, p_version) se fiaba de `p_name`: cualquiera
--     con la clave anónima firmaba EN NOMBRE DE otro empleado, con cualquier
--     nombre y apellidos.
--   · Se fiaba de `p_version`: una versión inventada se guardaba y además
--     sobrescribía employees.nda_version.
--   · La firma no guardaba auth_user_id: no demostraba QUIÉN firmó.
--   · nda_signatures.employee → employees(name) ON DELETE/UPDATE CASCADE:
--     borrar o renombrar la ficha destruía o reescribía la evidencia.
--
-- REGLA NUEVA
--   cliente  → «quiero firmar»: nombre y apellidos + SHA-256 del texto mostrado
--   servidor → auth.uid() → employees.auth_user_id → employee, venue
--   servidor → versión vigente y su hash salen de public.nda_vigente
--   servidor → si el hash del cliente no es el vigente, NO firma
--   servidor → registra exactamente esa versión, con auth_user_id
--
-- LA FIRMA QUE YA EXISTÍA (Duvan, 2026-09-24 20:29:00 UTC) se conserva
-- íntegra. No se le atribuye auth_user_id: no hay sesión Auth registrada antes
-- de esa hora y no puede demostrarse que la petición fuese autenticada. Se
-- marca vinculo='legacy_sin_auth'. nda_estado() sólo cuenta firmas
-- autenticadas, así que a Duvan se le volverá a pedir la firma una vez.
--
-- ORDEN DE DESPLIEGUE. Esta migración retira la firma antigua de tres
-- parámetros. Se aplica A LA VEZ que el cliente que llama a la nueva
-- (nda_sign(p_full_name, p_texto_sha256) y nda_estado()). Un cliente anterior
-- recibirá error al firmar y no entrará hasta actualizar: fail-closed, a
-- propósito.
--
-- CAMBIAR EL TEXTO. Si cambia data/nda.json cambia su SHA-256: hay que subir
-- la versión en el fichero Y actualizar public.nda_vigente con una migración.
-- tests/smoke.mjs comprueba que el hash y la versión de este fichero
-- coinciden con data/nda.json byte a byte.
--
-- NO APLICADA todavía en producción. Verificada entera, con las pruebas
-- NDA-1..13, dentro de una transacción revertida.

-- ── 1 · Fuente de verdad de la versión vigente ─────────────────────────────
create table public.nda_vigente (
  unica        boolean primary key default true check (unica),
  version      text not null check (version <> ''),
  texto_sha256 text not null check (texto_sha256 ~ '^[0-9a-f]{64}$'),
  desde        timestamptz not null default now()
);
alter table public.nda_vigente enable row level security;
revoke all privileges on table public.nda_vigente from anon, authenticated;
comment on table public.nda_vigente is
  'Una fila: versión vigente del compromiso de uso y SHA-256 exacto de data/nda.json. La autoridad es el servidor; el cliente sólo la consulta con nda_estado().';

insert into public.nda_vigente(version, texto_sha256)
values ('2026-09-24-v1', '2977a9c47b3fc4c83f7f6a9f73aef788dd5dbe3882eed0f178dcb53abcfdd7c5');

-- ── 2 · Evidencia: identidad estable + instantáneas ─────────────────────────
-- Ni el nombre ni la ficha son ya la identidad histórica. employee, venue y
-- full_name son COPIAS del momento de firmar; auth_user_id es la identidad.
-- auth_user_id va SIN clave foránea a propósito: una FK a auth.users con
-- ON DELETE SET NULL borraría precisamente el dato que prueba quién firmó.
alter table public.nda_signatures drop constraint nda_signatures_employee_fkey;
alter table public.nda_signatures add column auth_user_id uuid;
alter table public.nda_signatures add column texto_sha256 text;
alter table public.nda_signatures add column vinculo text;

update public.nda_signatures set vinculo = 'legacy_sin_auth' where auth_user_id is null;

alter table public.nda_signatures alter column vinculo set not null;
alter table public.nda_signatures add constraint nda_signatures_vinculo_chk
  check (
    (vinculo = 'auth' and auth_user_id is not null and texto_sha256 ~ '^[0-9a-f]{64}$')
    or (vinculo = 'legacy_sin_auth' and auth_user_id is null)
  );

-- La unicidad pasa de (nombre, versión) a (identidad, versión). La antigua
-- impediría que Duvan firme autenticado la misma versión que ya firmó sin Auth.
drop index public.nda_signatures_emp_ver_idx;
create unique index nda_signatures_uid_ver_idx
  on public.nda_signatures (auth_user_id, nda_version) where auth_user_id is not null;

-- Inmutable: la evidencia no se edita ni se borra, ni por error desde una
-- función de servidor. Purgarla tras cinco años (privacidad.html §5) exigirá
-- desactivar este trigger a mano, de forma deliberada.
create function public.nda_signatures_inmutable() returns trigger
language plpgsql set search_path = '' as $f$
begin
  raise exception 'nda_signatures es evidencia: no se modifica ni se borra'
    using errcode = '42501';
end $f$;
create trigger trg_nda_signatures_inmutable
  before update or delete on public.nda_signatures
  for each row execute function public.nda_signatures_inmutable();

comment on table public.nda_signatures is
  'Evidencia de aceptación del compromiso de uso. auth_user_id = identidad; employee/venue/full_name = instantáneas. Sólo escribe nda_sign (security definer). Sin privilegios para anon/authenticated. Inmutable (trigger). Conservar hasta cinco años tras la baja de la cuenta.';

-- ── 3 · La firma: sin p_name, sin p_version ─────────────────────────────────
drop function public.nda_sign(text, text, text);

create function public.nda_sign(p_full_name text, p_texto_sha256 text)
returns json
language plpgsql
security definer
set search_path = ''
as $f$
declare
  v_uid  uuid := auth.uid();
  v_emp  text;
  v_venue text;
  v_full text;
  v_vig  public.nda_vigente%rowtype;
  v_ip   text;
  v_ua   text;
  v_filas int;
begin
  if v_uid is null then
    return json_build_object('ok', false, 'error', 'no_autenticado');
  end if;

  -- El empleado lo decide el servidor, por la identidad. Nunca el navegador.
  select e.name, e.venue into v_emp, v_venue
    from public.employees e where e.auth_user_id = v_uid;
  if v_emp is null or v_venue is null then
    return json_build_object('ok', false, 'error', 'sin_empleado');
  end if;

  select * into v_vig from public.nda_vigente limit 1;
  if v_vig.version is null then
    return json_build_object('ok', false, 'error', 'sin_version_vigente');
  end if;
  -- El cliente sólo prueba que MOSTRÓ el texto vigente. Si no, no firma.
  if coalesce(p_texto_sha256, '') <> v_vig.texto_sha256 then
    return json_build_object('ok', false, 'error', 'texto_distinto');
  end if;

  v_full := regexp_replace(trim(coalesce(p_full_name, '')), '\s+', ' ', 'g');
  if v_full !~ '^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ''-]{2,}( [A-Za-zÁÉÍÓÚÜÑáéíóúüñ''-]{2,})+$'
     or length(v_full) > 80 then
    return json_build_object('ok', false, 'error', 'name_invalid');
  end if;

  begin
    v_ip := coalesce(nullif(split_part(
      (current_setting('request.headers', true)::json ->> 'x-forwarded-for'), ',', 1), ''), 'unknown');
    v_ua := left(coalesce(current_setting('request.headers', true)::json ->> 'user-agent', ''), 300);
  exception when others then v_ip := 'unknown'; v_ua := '';
  end;

  -- Idempotente y a prueba de doble envío: el índice único parcial decide.
  insert into public.nda_signatures
    (auth_user_id, employee, venue, full_name, nda_version, texto_sha256, vinculo, ip, user_agent)
  values
    (v_uid, v_emp, v_venue, v_full, v_vig.version, v_vig.texto_sha256, 'auth', v_ip, v_ua)
  on conflict (auth_user_id, nda_version) where auth_user_id is not null do nothing;
  get diagnostics v_filas = row_count;

  update public.employees
     set nda_version = v_vig.version, nda_signed_at = now()
   where auth_user_id = v_uid and (nda_version is distinct from v_vig.version);

  return json_build_object('ok', true, 'version', v_vig.version, 'nueva', v_filas = 1);
end $f$;

-- ── 4 · ¿Le toca firmar? Lo responde el servidor ────────────────────────────
-- Sólo cuenta una firma AUTENTICADA de la versión vigente. employees.nda_version
-- queda como espejo informativo; ya no decide nada.
create function public.nda_estado()
returns json
language sql
stable
security definer
set search_path = ''
as $f$
  select json_build_object(
    'autenticado', auth.uid() is not null,
    'version', v.version,
    'texto_sha256', v.texto_sha256,
    'firmada', exists (
      select 1 from public.nda_signatures s
       where s.auth_user_id = auth.uid()
         and s.nda_version = v.version
         and s.vinculo = 'auth'))
  from public.nda_vigente v
$f$;

-- ── 5 · Permisos: sólo autenticados, y sólo por las funciones ───────────────
revoke all on function public.nda_sign(text, text) from public, anon;
revoke all on function public.nda_estado() from public, anon;
grant execute on function public.nda_sign(text, text) to authenticated;
grant execute on function public.nda_estado() to authenticated;
-- H1 se mantiene: ningún privilegio directo sobre la tabla de evidencia.
revoke all privileges on table public.nda_signatures from anon, authenticated;
