-- ═══ FOTOS PRIVADAS DE LAS CARTAS · BUCKET cartas-fotos ═════════════════════
-- Meseo · 12 oct 2026. APLICADA en producción con autorización del propietario
-- (fotos de Akira Back sacadas del Plating Guide 2026 y del menú degustación
-- del chef).
--
-- EL PROBLEMA
--   Las fotos de Txoko viven en img/platos/ y data/dish-photos.json, que sirve
--   la web y están en un repositorio público. Las de una carta privada no
--   pueden ir ahí: cualquiera las vería sin entrar en la app.
--
-- LO QUE HACE
--   · Un bucket PRIVADO, cartas-fotos, una carpeta por restaurante
--     (r2/3010.webp = plato 3010 de r2). Sólo webp, 300 KB como máximo.
--   · Una sola política, de LECTURA, con la misma regla que public.cartas:
--     tu restaurante (app.venue_actual()) o una carta que puedes revisar
--     (app.puede_revisar_carta, por auth.uid()).
--   · Ninguna política de escritura: desde la app no se sube, cambia ni borra
--     nada. Se sube por mantenimiento (panel de Supabase).
--   · La carta (public.cartas.contenido.FOTOS) lista qué plato tiene foto:
--     { "3010": "r2/3010.webp", ... }. La app la valida (_cartaFotosValidas),
--     pide cada foto por GET con la sesión real y la pinta como blob: local.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cartas-fotos', 'cartas-fotos', false, 307200, array['image/webp'])
on conflict (id) do nothing;

create policy "cartas_fotos_leer" on storage.objects for select to authenticated
using (
  bucket_id = 'cartas-fotos'
  and (
    (storage.foldername(name))[1] = (select app.venue_actual())
    or app.puede_revisar_carta((storage.foldername(name))[1])
  )
);

-- Mapa de fotos de la carta, a partir de lo que hay en el bucket.
-- update public.cartas c
--    set contenido = jsonb_set(c.contenido, '{FOTOS}',
--          (select jsonb_object_agg(split_part(split_part(o.name,'/',2),'.',1), o.name)
--             from storage.objects o
--            where o.bucket_id = 'cartas-fotos' and o.name ~ ('^' || c.venue || '/[0-9]+\.webp$')), true),
--        actualizado = now()
--  where c.venue = 'r2';
--
-- Comprobado el 12 oct 2026 simulando cada sesión: Administrador 38 fotos,
-- Duvan 38, un empleado de Txoko 0, sin sesión 0.
