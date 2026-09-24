-- ═══════════════════════════════════════════════════════════════════════════
-- nda_signatures: la prueba de aceptación sólo la escribe la RPC
-- ═══════════════════════════════════════════════════════════════════════════
--
-- HALLAZGO (auditoría del compromiso de uso, sep 2026). La tabla que guarda
-- las firmas tenía RLS activado pero NINGUNA política, y a la vez `anon` y
-- `authenticated` conservaban TODOS los privilegios: INSERT, SELECT, UPDATE,
-- DELETE, TRUNCATE, REFERENCES y TRIGGER. Con RLS sin políticas, SELECT /
-- INSERT / UPDATE / DELETE se quedan en cero filas desde la API — pero
-- TRUNCATE no pasa por RLS. Y, política aparte, un registro que sirve como
-- prueba no debería ser tocable por nadie más que por la función que lo
-- escribe.
--
-- QUÉ HACE. Retira todos los privilegios de la tabla a los dos roles de la
-- API. La RPC `nda_sign` es SECURITY DEFINER y sigue escribiendo igual: no
-- necesita que el que llama tenga permisos sobre la tabla. `ndaPendiente`
-- lee `employees.nda_version`, no esta tabla, así que la app no cambia.
--
-- CÓMO SE COMPRUEBA. Antes y después:
--   select grantee, privilege_type from information_schema.role_table_grants
--    where table_schema='public' and table_name='nda_signatures'
--      and grantee in ('anon','authenticated');
-- Antes: 14 filas. Después: 0. Y una firma de prueba por la RPC sigue
-- entrando.
--
-- NO APLICADO todavía: toca Supabase y eso lo autoriza el propietario.

revoke all privileges on table public.nda_signatures from anon, authenticated;

comment on table public.nda_signatures is
  'Prueba de aceptación del compromiso de uso. Sólo escribe la RPC nda_sign (security definer). Ningún rol de la API tiene privilegios directos: no se lee, no se edita, no se borra desde la app. Conservar hasta cinco años tras la baja de la cuenta (privacidad.html §5).';
