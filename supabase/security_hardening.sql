-- Meseo — Endurecimiento de seguridad (jul 2026)
-- Documenta las migraciones de seguridad aplicadas a producción. El modelo
-- histórico usaba "anon key pública + allow_all" en muchas tablas (sin auth
-- real): confidencialidad e integridad nulas. Se va cerrando por partes.

-- ── B) custom_dishes: SOLO-LECTURA para anon ──────────────────────
-- Antes: allow_all (ALL) → cualquiera con la anon key podía inyectar/alterar
-- platos y sus ALÉRGENOS (relevante para seguridad alimentaria). Ahora las
-- escrituras van por la Edge Function `manage-content` (service-role), gateada
-- por el PIN de supervisor (verify_supervisor_pin). La anon key solo lee.
DROP POLICY IF EXISTS "allow_all" ON public.custom_dishes;
DROP POLICY IF EXISTS "custom_dishes_read" ON public.custom_dishes;
CREATE POLICY "custom_dishes_read" ON public.custom_dishes
  FOR SELECT TO anon, authenticated USING (true);
-- sin política de escritura → INSERT/UPDATE/DELETE denegados salvo service-role.
