-- Meseo — Recuperación de PIN por correo (jul 2026)
-- Esquema que respalda la Edge Function supabase/functions/reset-pin/index.ts.
-- Aplicado en producción vía migraciones:
--   email_recuperacion_pin  +  email_recuperacion_pin_v2_tabla_protegida
--
-- Decisión de privacidad/seguridad:
--   La tabla public.employees tiene una política `allow_all` (la anon key
--   PÚBLICA puede leer/escribir todo). Guardar correos ahí sería una fuga RGPD
--   (cualquiera con la anon key volcaría los correos del personal) y un vector
--   de robo de cuenta (poner tu correo en la cuenta de otro). Por eso los
--   correos viven en `employee_recovery`, con RLS SIN políticas: nadie salvo el
--   service-role del backend puede tocarla.

-- ── Correos de recuperación (tabla protegida) ──
CREATE TABLE IF NOT EXISTS public.employee_recovery (
  employee_name text PRIMARY KEY REFERENCES public.employees(name) ON DELETE CASCADE,
  email         text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS employee_recovery_email_lower_uidx
  ON public.employee_recovery (lower(email));
ALTER TABLE public.employee_recovery ENABLE ROW LEVEL SECURITY;
-- sin políticas → anon/authenticated denegados; solo service-role.

-- ── Tokens de reseteo de PIN ──
-- Se guarda sha256(token) (nunca el token en claro): una fuga de BD no expone
-- tokens válidos. Un solo uso, caduca a los 30 min.
CREATE TABLE IF NOT EXISTS public.password_resets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_name text NOT NULL REFERENCES public.employees(name) ON DELETE CASCADE,
  token_hash    text NOT NULL,
  expires_at    timestamptz NOT NULL,
  used          boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS password_resets_token_hash_idx ON public.password_resets (token_hash);
CREATE INDEX IF NOT EXISTS password_resets_employee_idx   ON public.password_resets (employee_name);
ALTER TABLE public.password_resets ENABLE ROW LEVEL SECURITY;
-- sin políticas → solo service-role.

-- ── Secretos que consume la Edge Function reset-pin ──
--   RESEND_API_KEY   (obligatorio)  clave de resend.com
--   RESEND_FROM      (opcional)     p. ej. 'Meseo <no-reply@meseo.es>'
--                                   (para pruebas: 'Meseo <onboarding@resend.dev>')
--   APP_ORIGIN       (opcional)     por defecto https://meseo.es
--   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY  los inyecta Supabase.
