-- ═══ FASE 2.5A · CONTENCIÓN ══════════════════════════════════════════════
-- APLICADO en producción el 12 de septiembre de 2026 (migración
-- `fase_2_5a_contencion_borrado_y_modificacion`). Este fichero es la copia
-- para el repositorio, igual que los demás cambios de base de datos.
--
-- EL PROBLEMA
-- La clave pública va en el código fuente de la página, a la vista de
-- cualquiera. Con ella se podía BORRAR las fichas de los 22 empleados y
-- REESCRIBIR o BORRAR las 427 filas del histórico de puntuaciones. No hacía
-- falta la aplicación: bastaba una petición a la API.
--
-- POR QUÉ SE PUEDE REVOCAR SIN ROMPER NADA
-- Medido antes de tocar nada, sobre `pg_stat_statements`, con el histórico
-- entero del proyecto: los UPDATE y DELETE de estas dos tablas se hicieron
-- SIEMPRE por SQL directo (mantenimiento: limpiar cuentas de prueba, reponer
-- PINes, borrar puntuaciones imposibles). Ni uno solo llevaba la envoltura
-- `pgrst_source`, que es la firma de PostgREST, que es por donde entra la
-- aplicación. Revocárselo al rol anónimo no le quita nada a nadie, y el
-- mantenimiento por SQL sigue funcionando porque corre como `postgres`.
--
-- LO QUE NO SE TOCA, Y POR QUÉ
-- El UPDATE de `employees` se queda abierto. La sincronización de progreso es
-- un upsert —100 095 llamadas— y PostgREST lo traduce a
--   INSERT ... ON CONFLICT ("name") DO UPDATE SET ... "name" = EXCLUDED."name" ...
-- Sin privilegio de UPDATE deja de guardarse el XP, las rachas, los platos
-- aprendidos, los logros y los extras de todo el equipo. Comprobado
-- ejecutando la revocación dentro de una transacción que aborta: el upsert
-- falla con «sin privilegio UPDATE». Cerrar esa puerta exige saber QUIÉN
-- escribe, y eso es identidad: es la fase 2.5B, no ésta.

-- ── 1 · Los permisos ─────────────────────────────────────────────────────
revoke delete on public.employees from anon, authenticated, public;
revoke update, delete on public.scores from anon, authenticated, public;

-- ── 2 · Y las políticas, para que no baste con volver a conceder ─────────
-- `allow_all` cubría el comando ALL (leer, crear, modificar y BORRAR) con la
-- condición `true`. Se sustituye por una política por comando, con la MISMA
-- condición y los MISMOS roles: mismo comportamiento, menos el borrado. Así,
-- si algún día alguien vuelve a conceder el permiso por descuido, sigue sin
-- haber política que lo ampare.
drop policy if exists allow_all on public.employees;

create policy employees_leer on public.employees
  for select to public using (true);

create policy employees_alta on public.employees
  for insert to public with check (true);   -- el trigger del código de alta manda

create policy employees_progreso on public.employees
  for update to public using (true) with check (true);

-- Sin política de DELETE: nadie borra por la API.

-- En `scores`, `insert_scores` y `read_scores` ya cubren lo que la aplicación
-- necesita; `allow_all` sólo añadía el modificar y el borrar.
drop policy if exists allow_all on public.scores;

comment on table public.employees is
  'Fase 2.5A: el rol anónimo no puede borrar. El UPDATE sigue abierto porque la sincronización de progreso lo necesita (upsert); lo cierra la fase 2.5B con identidad de servidor.';
comment on table public.scores is
  'Fase 2.5A: el rol anónimo sólo puede leer e insertar. El histórico no se reescribe ni se borra desde la API.';

-- ── CÓMO SE VUELVE ATRÁS, si hiciera falta ───────────────────────────────
--   grant update, delete on public.scores to anon, authenticated;
--   grant delete on public.employees to anon, authenticated;
--   create policy allow_all on public.employees for all to public
--     using (true) with check (true);
--   create policy allow_all on public.scores for all to anon
--     using (true) with check (true);
-- (No debería hacer falta: la aplicación no usa ninguna de las cuatro.)
