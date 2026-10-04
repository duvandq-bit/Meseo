-- F2 · M8-A2 · push_subscriptions: el alta pasa a ser SOLO por push_suscripcion_registrar (B+)
-- Primero en la rama f2-push (sslcgakpxiwhjxsgmngg). Migración NUEVA y separada:
-- no modifica la migración histórica de M5 ni la tabla.
--
-- POR QUÉ
--   Con la política push_propias_insert, un usuario autenticado podía saltarse la
--   RPC con un POST directo y dejar un endpoint con dos dueños (demostrado en la
--   rama: P1 de supabase/tests/f2-m8a/M8A_funcional.sql). El trigger de M5 fija
--   la identidad, así que no hay suplantación, pero se rompe «un endpoint, una
--   identidad», que solo la RPC garantiza bajo su candado.
--
-- QUÉ CAMBIA
--   · authenticated pierde INSERT y UPDATE sobre la tabla: arwdm → rdm.
--     UPDATE ya no tenía política (0 filas por RLS); se retira para que la
--     intención quede explícita y no la reabra una política futura.
--   · se elimina la política push_propias_insert.
--
-- QUÉ NO CAMBIA
--   Columnas, CHECK del endpoint, UNIQUE (employee_name, endpoint), índices,
--   trigger trg_push_subscriptions_propietario, políticas push_propias_select y
--   push_propias_delete, privilegios de service_role, secuencia.
--
-- ORDEN DE DESPLIEGUE (producción)
--   Solo DESPUÉS de que el cliente que usa la RPC esté publicado y adoptado: los
--   clientes anteriores hacen POST directo y, con esto, recibirían 42501 al
--   darse de alta (sus filas existentes siguen recibiendo avisos).

revoke insert, update on table public.push_subscriptions from authenticated;
drop policy push_propias_insert on public.push_subscriptions;

-- ── VUELTA ATRÁS (no ejecutar salvo decisión expresa) ────────────────────────
--   grant insert, update on table public.push_subscriptions to authenticated;
--   create policy push_propias_insert on public.push_subscriptions as permissive for insert to authenticated
--     with check (((employee_name = app.emp_actual()) AND (venue = app.venue_actual())));
