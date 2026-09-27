-- ═══════════════════════════════════════════════════════════════════════════
-- S2 · Nadie reclama una ficha ajena fijándole el PIN
-- ═══════════════════════════════════════════════════════════════════════════
--
-- QUÉ CIERRA (auditoría S2, sep 2026)
--   `set_employee_pin_sha(emp_name, sha_hex)` es SECURITY DEFINER y la podían
--   ejecutar `anon` y `authenticated`. Fija el PIN de cualquier ficha que aún
--   no lo tenga (`pin is null`) sin pedir ninguna prueba de quién llama. Con
--   ese PIN, la función `sesion` crea y vincula una identidad de Auth real a la
--   ficha. Es decir: cualquiera con la clave pública podía apropiarse de una
--   cuenta sin PIN.
--
--       anon → set_employee_pin_sha(ficha sin PIN, sha) → pin = sha
--            → sesion(nombre, sha) → usuario de Auth creado y vinculado
--
-- EL CAMBIO, Y SÓLO ÉSTE
--   Se retira EXECUTE a `anon`, `authenticated` y `public`. La definición, los
--   parámetros y el comportamiento no cambian; `service_role` y el propietario
--   la conservan. Ninguna otra función SQL ni Edge Function la llama: `sesion`
--   verifica con `verify_employee_pin_sha`, no con ésta.
--
-- QUÉ DEJA DE FUNCIONAR, Y ES DELIBERADO
--   El cliente la llamaba sin esperar respuesta (`setEmployeePinServer`) en la
--   primera configuración de PIN y en la migración perezosa de PINs antiguos.
--   Ahora esa llamada falla en silencio. Sólo afecta a fichas SIN PIN en el
--   servidor —cuatro, sin identidad de Auth—, que quedan pendientes de una
--   decisión aparte sobre cómo habilitarlas. Las cuentas con PIN no la usan.
--
-- NO APLICADA todavía en producción. Validada dentro de una transacción
-- revertida (CLAIM-01..03, 08..10).

revoke execute on function public.set_employee_pin_sha(text, text) from anon;
revoke execute on function public.set_employee_pin_sha(text, text) from authenticated;
revoke execute on function public.set_employee_pin_sha(text, text) from public;

-- ── VUELTA ATRÁS (no ejecutar salvo decisión expresa) ────────────────────────
--   grant execute on function public.set_employee_pin_sha(text, text) to anon;
--   grant execute on function public.set_employee_pin_sha(text, text) to authenticated;
-- (Antes de este cambio `public` no tenía el permiso: no hay que devolvérselo.)
