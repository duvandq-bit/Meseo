-- ═══ FASE 1 · REGISTRO DE ACTIVIDAD ═══════════════════════════════════════
--
-- POR QUÉ EXISTE ESTA TABLA
--
-- Medido en septiembre de 2026: de las diecisiete actividades de la aplicación,
-- sólo DOS dejaban rastro en la nube — el Examen IA y el Simulacro de
-- alérgenos. Las otras quince se guardaban únicamente en el móvil del
-- empleado. Un jefe de sala mirando el panel no veía a su equipo con menos
-- detalle: veía otra cosa.
--
-- Y lo que sí llegaba estaba sucio: de las 427 filas de `scores`, 254 eran
-- marcadores de partidas de juego, no evaluaciones. Las evaluaciones reales
-- estaban repartidas en nueve nombres de tema, y dos de ellos —`alergenos` y
-- `allergens`— eran lo mismo registrado en dos idiomas, según en cuál
-- estuviera la aplicación cuando se hizo la prueba.
--
-- Esta tabla arregla las tres cosas: todas las actividades escriben aquí, el
-- vocabulario de competencias es CERRADO (una competencia, un nombre, un
-- idioma) y `kind` separa de una vez lo que puntúa de lo que no.
--
-- `scores` NO SE TOCA. Sigue recibiendo lo de siempre y el panel actual sigue
-- leyéndola. Las dos conviven hasta que el panel nuevo esté probado; el doble
-- registro es deliberado y se retira en la fase 3.
--
-- AISLAMIENTO ENTRE RESTAURANTES: igual que en `scores` y en `employees`, se
-- aplica en el cliente con el filtro `venue`. Las políticas de aquí replican
-- las que ya hay para no cambiar las reglas del juego a mitad de plan; cerrar
-- los permisos de verdad necesita sesiones autenticadas y es trabajo aparte.

create table if not exists public.actividad (
  id           uuid primary key default gen_random_uuid(),
  employee     text        not null,
  venue        text        not null,
  activity     text        not null,
  competency   text,
  kind         text        not null,
  score        integer,
  total        integer,
  seconds      integer,
  meta         jsonb,
  created_at   timestamptz not null default now()
);

comment on table public.actividad is
  'Toda la actividad de formación, de las diecisiete actividades. Fase 1 del rediseño.';
comment on column public.actividad.activity   is 'Qué hizo: examen, simulacro_alergenos, situaciones_lqa…';
comment on column public.actividad.competency is 'Vocabulario CERRADO de seis. Nulo sólo para kind=juego.';
comment on column public.actividad.kind       is 'evaluacion | practica | juego. Lo que separa lo que puntúa de lo que no.';
comment on column public.actividad.meta       is 'Lo específico de cada actividad: qué platos, qué alérgenos falló, qué escenario.';

-- ── Vocabulario cerrado ────────────────────────────────────────────────────
-- Seis competencias y tres tipos. Si mañana hace falta una séptima, se añade
-- AQUÍ y en el cliente a la vez: es justo la disciplina que faltaba, y lo que
-- produjo `alergenos` y `allergens` conviviendo durante seis meses.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'actividad_competency_ck') then
    alter table public.actividad add constraint actividad_competency_ck
      check (competency is null or competency in
        ('alergenos','carta','vinos','protocolo','sala','servicio'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'actividad_kind_ck') then
    alter table public.actividad add constraint actividad_kind_ck
      check (kind in ('evaluacion','practica','juego'));
  end if;
  -- Una evaluación sin competencia no se puede agregar en ninguna métrica:
  -- sería una nota que no pertenece a nada.
  if not exists (select 1 from pg_constraint where conname = 'actividad_competencia_obligatoria_ck') then
    alter table public.actividad add constraint actividad_competencia_obligatoria_ck
      check (kind = 'juego' or competency is not null);
  end if;
  -- Un resultado con total 0 rompe cualquier media. Se rechaza en la puerta.
  if not exists (select 1 from pg_constraint where conname = 'actividad_total_ck') then
    alter table public.actividad add constraint actividad_total_ck
      check (total is null or total > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'actividad_score_ck') then
    alter table public.actividad add constraint actividad_score_ck
      check (score is null or (score >= 0 and (total is null or score <= total)));
  end if;
end $$;

-- ── Índices ────────────────────────────────────────────────────────────────
-- Las tres preguntas que hará el panel: qué ha pasado en mi restaurante, qué
-- ha hecho esta persona, y cómo va cada competencia.
create index if not exists actividad_venue_fecha_idx
  on public.actividad (venue, created_at desc);
create index if not exists actividad_venue_empleado_idx
  on public.actividad (venue, employee, created_at desc);
create index if not exists actividad_venue_competencia_idx
  on public.actividad (venue, competency, created_at desc)
  where kind <> 'juego';

-- ── Permisos ───────────────────────────────────────────────────────────────
alter table public.actividad enable row level security;

drop policy if exists actividad_insert on public.actividad;
create policy actividad_insert on public.actividad for insert to anon, authenticated
  with check (true);

drop policy if exists actividad_select on public.actividad;
create policy actividad_select on public.actividad for select to anon, authenticated
  using (true);

-- Nadie edita ni borra actividad desde el cliente: un historial que se puede
-- reescribir no sirve para hacer seguimiento de nadie.
revoke update, delete on public.actividad from anon, authenticated;
grant select, insert on public.actividad to anon, authenticated;
