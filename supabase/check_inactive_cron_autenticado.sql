-- ═══════════════════════════════════════════════════════════════════════════
-- S3-A · El cron de inactividad se identifica ante `check-inactive`
-- ═══════════════════════════════════════════════════════════════════════════
--
-- QUÉ CAMBIA
--   El job `check-inactive-employees` (lunes 10:00 UTC) llamaba a la función
--   sólo con `Content-Type`. La nueva `check-inactive` exige
--   `Authorization: Bearer <service key>`, así que el job pasa a leerla de
--   Vault en cada ejecución. Horario, URL y cuerpo no cambian.
--
-- LA CREDENCIAL NO SE CREA AQUÍ
--   Se reutiliza la service key del proyecto. La guarda el propietario, a
--   mano, en Vault (panel de Supabase → Vault → nuevo secreto) con el nombre
--   `service_role_key`. Nunca va en el repositorio ni en la app.
--   Si el secreto no existe, esta migración FALLA y no toca el job: mejor
--   eso que dejar el cron llamando con una cabecera vacía.
--
-- ORDEN DE DESPLIEGUE
--   1 · el propietario crea el secreto en Vault;
--   2 · se aplica esta migración;
--   3 · se despliega la nueva `check-inactive`.
--   Al revés, el cron del lunes recibiría 401 (fail-closed: no avisa a nadie,
--   pero tampoco rompe nada más).
--
-- NO APLICADA.

do $m$
begin
  if not exists (select 1 from vault.secrets where name = 'service_role_key') then
    raise exception 'Falta el secreto service_role_key en Vault: créalo antes de aplicar esta migración';
  end if;
  if not exists (select 1 from cron.job where jobname = 'check-inactive-employees') then
    raise exception 'No existe el job check-inactive-employees';
  end if;
end $m$;

select cron.alter_job(
  (select jobid from cron.job where jobname = 'check-inactive-employees'),
  command := $cmd$
  SELECT net.http_post(
    url := 'https://advkoujfgbrrjvqexrcu.supabase.co/functions/v1/check-inactive',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $cmd$
);

-- ── VUELTA ATRÁS (no ejecutar salvo decisión expresa) ────────────────────────
--   select cron.alter_job(
--     (select jobid from cron.job where jobname = 'check-inactive-employees'),
--     command := $cmd$
--     SELECT net.http_post(
--       url := 'https://advkoujfgbrrjvqexrcu.supabase.co/functions/v1/check-inactive',
--       headers := '{"Content-Type": "application/json"}'::jsonb,
--       body := '{}'::jsonb
--     ) AS request_id;
--     $cmd$
--   );
--   y volver a desplegar supabase/functions/check-inactive/index.ts del commit
--   921ffc1 (la v5 que estaba en producción).
