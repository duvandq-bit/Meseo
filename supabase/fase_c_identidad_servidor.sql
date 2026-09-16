-- ═══════════════════════════════════════════════════════════════════════════
-- FASE C · LA IDENTIDAD DE UNA FILA LA PONE EL SERVIDOR
-- ═══════════════════════════════════════════════════════════════════════════
-- Estado APLICADO en producción (proyecto advkoujfgbrrjvqexrcu).
--   C-1  migración `fase_c1_identidad_del_servidor`     · 2026-09-16
--   C-3  migración `fase_c3_cierre_escritura_identidad` · 2026-09-16
-- C-2 es el cliente (`_cuerpoPropio` en index.html) y no tiene SQL.
--
-- Este fichero es la copia de referencia de lo aplicado. `tests/smoke.mjs` lo
-- vigila: si alguien reescribe los grants con la forma que NO funciona, o
-- vuelve a conceder una columna de identidad, la suite lo dice.
--
-- POR QUÉ ESTE ORDEN Y NO OTRO
--   C-1 pone el mecanismo (DEFAULT + disparador) sin cambiar nada observable.
--   C-2 hace que el cliente deje de mandar identidad.
--   C-3 retira el permiso, y sólo entonces el ataque deja de ser posible.
--   Aplicar C-3 primero habría roto producción entera; aplicar C-2 primero,
--   también (sin los DEFAULT, omitir `employee` da 23502).


-- ═══ C-1 · DE DÓNDE SALE LA IDENTIDAD ══════════════════════════════════════

-- Se reutilizan las funciones que ya existían de la fase de identidad:
--   app.emp_actual()   -> employees.name  where auth_user_id = auth.uid()
--   app.venue_actual() -> employees.venue where auth_user_id = auth.uid()
-- Las dos son STABLE SECURITY DEFINER con search_path vacío. NO se crea ninguna
-- función de identidad nueva.

alter table public.scores
  alter column employee set default app.emp_actual(),
  alter column venue    set default app.venue_actual();
alter table public.actividad
  alter column employee set default app.emp_actual(),
  alter column venue    set default app.venue_actual();

-- Nulable a propósito: las 427 puntuaciones y las 5 actividades históricas no
-- tienen dueño demostrable, y no se inventa uno.
alter table public.scores    add column auth_user_id uuid default auth.uid();
alter table public.actividad add column auth_user_id uuid default auth.uid();

-- SECURITY INVOKER A PROPÓSITO. Dentro de una función SECURITY DEFINER,
-- `current_user` es el DUEÑO (postgres), no el rol que llama, así que una
-- guarda por rol no distinguiría a nadie. Medido en este proyecto.
create or replace function public.marca_del_servidor()
returns trigger
language plpgsql
set search_path to ''
as $fn$
begin
  if current_user in ('anon', 'authenticated') then
    new.auth_user_id := auth.uid();                     -- identidad: sólo del token
    new.id           := pg_catalog.gen_random_uuid();   -- clave: sólo del servidor
    new.created_at   := pg_catalog.now();               -- sello: sólo del servidor
  end if;
  return new;
end
$fn$;

drop trigger if exists trg_marca_del_servidor on public.scores;
drop trigger if exists trg_marca_del_servidor on public.actividad;
create trigger trg_marca_del_servidor before insert on public.scores
  for each row execute function public.marca_del_servidor();
create trigger trg_marca_del_servidor before insert on public.actividad
  for each row execute function public.marca_del_servidor();


-- ═══ C-3 · EL CIERRE ═══════════════════════════════════════════════════════

-- (1) QUITAR EL INSERT DE TABLA.
--     LA TRAMPA, Y ESTÁ MEDIDA: en PostgreSQL un GRANT INSERT de tabla implica
--     TODAS las columnas, y `REVOKE INSERT (columna)` sobre quien tiene el de
--     tabla es un NO-OP SILENCIOSO. El primer ensayo de esta fase parecía
--     proteger y no protegía nada. Hay que quitar el de tabla y reconceder.
revoke insert on public.scores    from anon, authenticated;
revoke insert on public.actividad from anon, authenticated;

-- (2) RECONCEDER SÓLO LAS COLUMNAS DE NEGOCIO, y sólo a quien tiene identidad.
--     Quedan FUERA las cinco del servidor: employee, venue, auth_user_id, id,
--     created_at. `anon` no recibe nada: no puede insertar.
grant insert (score, total, topic, cat, time_sec)
  on public.scores to authenticated;
grant insert (activity, competency, kind, score, total, seconds, meta)
  on public.actividad to authenticated;

-- (3) EL SEGUNDO CERROJO. Los grants impiden ELEGIR la identidad; la política
--     impide ESCRIBIR SIN ella: un JWT válido de alguien sin ficha pasa los
--     grants (no nombra ninguna columna prohibida) y sólo lo para esto.
drop policy if exists insert_scores    on public.scores;
drop policy if exists actividad_insert on public.actividad;

create policy scores_alta_propia on public.scores
  for insert to authenticated
  with check ( employee     = app.emp_actual()
           and venue        = app.venue_actual()
           and auth_user_id = auth.uid() );

create policy actividad_alta_propia on public.actividad
  for insert to authenticated
  with check ( employee     = app.emp_actual()
           and venue        = app.venue_actual()
           and auth_user_id = auth.uid() );

-- La LECTURA no se toca: `read_scores` y `actividad_select` siguen como estaban,
-- así que el ranking y el panel de Supervisor funcionan igual.


-- ═══ ROLLBACK ══════════════════════════════════════════════════════════════
-- LEER ANTES DE EJECUTAR: revertir C-3 REABRE el agujero. A partir del primer
-- `grant insert` de tabla, cualquiera con la clave anónima vuelve a poder
-- escribir una fila a nombre de quien quiera y del restaurante que quiera.
-- No es una reversión neutra: es volver a la vulnerabilidad, a propósito.
--
-- revoke insert on public.scores    from authenticated;   -- quita los de columna
-- revoke insert on public.actividad from authenticated;
-- grant  insert on public.scores    to anon, authenticated;
-- grant  insert on public.actividad to anon, authenticated;
-- drop policy if exists scores_alta_propia    on public.scores;
-- drop policy if exists actividad_alta_propia on public.actividad;
-- create policy insert_scores    on public.scores    for insert to public with check (true);
-- create policy actividad_insert on public.actividad for insert to anon, authenticated with check (true);
--
-- Revertir C-1 además descartaría la identidad ya escrita; ver docs/fase-c1-aplicada.md §6.
