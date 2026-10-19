-- ═══ TEST GRATUITO DE ALÉRGENOS (meseo.es/test/) ═══════════════════════════
--
-- Aplicada como migración `test_equipo_alergenos` (octubre de 2026).
-- Tablas nuevas; no toca ninguna existente.
--
-- Un encargado crea un test (sin cuenta ni email) y recibe dos enlaces:
--   · el del equipo   meseo.es/test/?e=<id>          (público, va por WhatsApp)
--   · el de resultados meseo.es/test/#r=<token>      (privado, token de 43 caracteres)
--
-- Seguridad:
--   · RLS activado. `anon` solo puede INSERT; no tiene SELECT en ninguna de las dos.
--   · Con el id público solo se obtiene el nombre del restaurante y el idioma
--     (RPC test_equipo_publico). Los resultados solo salen con el token
--     (RPC test_equipo_resultados). Ambas son security definer con search_path vacío.
--   · Límites en la propia tabla: longitudes máximas, total = 10, aciertos 0..10,
--     detalle = array de 10 elementos y < 4 kB, y un tope de 300 respuestas por test.
--   · Sin datos personales: solo un apodo opcional del camarero.

create table public.test_equipos (
  id uuid primary key default gen_random_uuid(),
  token_resultados text not null unique check (char_length(token_resultados) between 32 and 128 and token_resultados ~ '^[A-Za-z0-9_-]+$'),
  restaurante text not null check (char_length(btrim(restaurante)) between 1 and 80),
  encargado text check (encargado is null or char_length(encargado) <= 60),
  idioma text not null default 'es' check (idioma in ('es','en')),
  created_at timestamptz not null default now()
);
comment on table public.test_equipos is 'Test gratuito de alérgenos: un registro por test creado por un encargado. Sin cuenta ni email. Solo se lee por RPC (test_equipo_publico, test_equipo_resultados).';

create table public.test_respuestas (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references public.test_equipos(id) on delete cascade,
  nombre text check (nombre is null or char_length(nombre) <= 40),
  aciertos int not null check (aciertos between 0 and 10),
  total int not null check (total = 10),
  detalle jsonb not null check (jsonb_typeof(detalle) = 'array' and jsonb_array_length(detalle) = 10 and pg_column_size(detalle) < 4000),
  created_at timestamptz not null default now()
);
comment on table public.test_respuestas is 'Respuestas al test gratuito de alérgenos. Solo un apodo opcional, sin datos personales. Solo se lee por RPC con el token de resultados.';
create index test_respuestas_test_id_idx on public.test_respuestas (test_id, created_at);

alter table public.test_equipos enable row level security;
alter table public.test_respuestas enable row level security;

revoke all on public.test_equipos from anon, authenticated;
revoke all on public.test_respuestas from anon, authenticated;
grant insert on public.test_equipos to anon, authenticated;
grant insert on public.test_respuestas to anon, authenticated;

create policy test_equipos_insert on public.test_equipos for insert to anon, authenticated
  with check (char_length(token_resultados) >= 32 and char_length(btrim(restaurante)) >= 1);
create policy test_respuestas_insert on public.test_respuestas for insert to anon, authenticated
  with check (total = 10 and aciertos between 0 and 10);

-- Tope de respuestas por test (evita que un enlace filtrado llene la tabla).
create or replace function public.test_respuestas_tope()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.test_respuestas r where r.test_id = new.test_id) >= 300 then
    raise exception 'test_lleno' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function public.test_respuestas_tope() from public, anon, authenticated;
create trigger test_respuestas_tope before insert on public.test_respuestas
  for each row execute function public.test_respuestas_tope();

-- Página del equipo: con el id público solo se obtiene el nombre del restaurante y el idioma.
create or replace function public.test_equipo_publico(p_id uuid)
returns table (restaurante text, idioma text)
language sql stable security definer set search_path = '' as $$
  select e.restaurante, e.idioma from public.test_equipos e where e.id = p_id;
$$;

-- Resultados: solo con el token secreto.
create or replace function public.test_equipo_resultados(p_token text)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when p_token is null or char_length(p_token) < 32 then null else (
    select jsonb_build_object(
      'id', e.id,
      'restaurante', e.restaurante,
      'encargado', e.encargado,
      'idioma', e.idioma,
      'created_at', e.created_at,
      'respuestas', coalesce((
        select jsonb_agg(jsonb_build_object('nombre', r.nombre, 'aciertos', r.aciertos, 'total', r.total, 'detalle', r.detalle, 'created_at', r.created_at) order by r.created_at)
        from public.test_respuestas r where r.test_id = e.id
      ), '[]'::jsonb)
    )
    from public.test_equipos e where e.token_resultados = p_token
  ) end;
$$;

revoke all on function public.test_equipo_publico(uuid) from public;
revoke all on function public.test_equipo_resultados(text) from public;
grant execute on function public.test_equipo_publico(uuid) to anon, authenticated;
grant execute on function public.test_equipo_resultados(text) to anon, authenticated;
