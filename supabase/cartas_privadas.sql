-- ═══ CARTAS PRIVADAS POR RESTAURANTE ═════════════════════════════════════
-- Meseo · oct 2026. Primero en la rama de pruebas f2-push; en producción sólo
-- con autorización expresa del propietario.
--
-- EL PROBLEMA
--   La carta de Txoko vive dentro de index.html y la de cualquier otro
--   restaurante se buscaba en data/carta-<venue>.json. data/ es la web: lo que
--   se pone ahí lo lee cualquiera. Una carta que todavía no se puede enseñar
--   (sin permiso del restaurante, con alérgenos sin validar por cocina) no
--   puede vivir en un sitio público.
--
-- LO QUE HACE
--   Una fila por restaurante con su carta. Quién la lee lo decide el SERVIDOR
--   con la identidad del token, nunca el filtro que mande el móvil:
--     · el personal de un restaurante lee la de su restaurante
--       (employees.venue, que el cliente no puede escribir);
--     · la cuenta de administración —role 'admin', la que existe para revisar
--       contenido— lee todas;
--     · anon no lee nada; sin sesión real no hay fila.
--   Nadie escribe desde la app: no hay política de escritura. La carta se
--   carga por mantenimiento (service_role / SQL), con una persona detrás.
--
-- MIGRACIÓN OFICIAL
--   Este archivo ES la migración: una sola, para aplicarse de una vez con el
--   nombre `cartas_privadas` (la versión la pone Supabase al aplicarla).
--   En f2-push está aplicada en dos pasos —cartas_privadas (20261005235326) y
--   cartas_privadas_sin_service_role (20261006000652)— y el resultado es el
--   mismo: el archivo entero, ejecutado de una vez sobre un esquema de prueba
--   en f2-push, deja exactamente el mismo catálogo (ACL, RLS, política,
--   restricciones). Antes y después: supabase/tests/cartas-privadas/
--   V_antes_despues.sql (sólo lectura).
--
-- COMPATIBILIDAD
--   Una versión antigua de la app no conoce esta tabla: sigue pidiendo
--   data/carta-<venue>.json, no lo encuentra y se cierra (o abre vacía para la
--   administración). No puede enseñar unos alérgenos cuyo estado no entiende.
--   Txoko no pasa por aquí: su carta sigue en index.html.
create table public.cartas (
  venue       text primary key
              check (venue ~ '^[a-z0-9][a-z0-9_-]{0,31}$'),
  formato     integer not null check (formato >= 2),
  contenido   jsonb not null
              check (jsonb_typeof(contenido) = 'object' and contenido->>'venue' = venue),
  actualizado timestamptz not null default now()
);
comment on table public.cartas is
  'Carta de cada restaurante (salvo Txoko, que va en index.html). La lee el personal de su restaurante y la cuenta admin; se escribe sólo por mantenimiento.';

alter table public.cartas enable row level security;

-- Supabase concede por defecto todo a anon y authenticated en las tablas
-- nuevas de public. Aquí no: sólo lectura, y sólo con sesión.
revoke all on table public.cartas from public, anon, authenticated;
grant select on table public.cartas to authenticated;
-- service_role tampoco: los privilegios por defecto cambian de un proyecto a
-- otro (en la rama de pruebas le dejaban TRUNCATE). La carta la escribe el
-- dueño de la tabla, por mantenimiento; ninguna función la toca.
revoke all on table public.cartas from service_role;

-- Las funciones de identidad leen la TABLA employees por auth.uid(), no el
-- token: un rol plantado en user_metadata no sirve para nada.
create policy cartas_leer on public.cartas
  for select to authenticated
  using ( venue = (select app.venue_actual())
          or (select app.rol_actual()) = 'admin' );

-- ── CÓMO SE DESHACE ──────────────────────────────────────────────────────
--   drop table public.cartas;
-- (Nada más depende de ella. La app, sin la tabla, vuelve a buscar en data/.)
