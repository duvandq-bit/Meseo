-- ═══ D1-M0b-D · ACL MÍNIMO ═════════════════════════════════════════════════
-- Meseo · oct 2026. Endurecimiento previo a D1, sin cambiar ninguna ruta.
--
--   · TRUNCATE no lo usa nadie desde la app (PostgREST ni siquiera lo expone)
--     y se salta RLS: fuera para anon y authenticated.
--   · DELETE sólo donde NO hay política de borrado (RLS ya lo impedía) y
--     ninguna ruta del cliente borra. Se quedan duels, notifications y
--     live_sessions (su política ALL incluye borrar) y push_subscriptions
--     (borrado propio, lo usa el cierre de sesión): eso es D1, no esto.
--   · EXECUTE de PUBLIC en tres funciones de PIN: anon, authenticated y
--     service_role ya lo tienen por concesión explícita; PUBLIC sobraba.
revoke truncate on table
  public.actividad, public.ai_usage, public.chat_messages, public.custom_dishes,
  public.dish_photo_submissions, public.duels, public.employee_recovery,
  public.employees, public.horarios, public.live_sessions, public.notifications,
  public.password_resets, public.scores, public.venue_code_attempts, public.venue_codes
  from anon, authenticated;

revoke delete on table
  public.ai_usage, public.chat_messages, public.custom_dishes,
  public.dish_photo_submissions, public.employee_recovery, public.horarios,
  public.password_resets, public.venue_code_attempts, public.venue_codes
  from anon, authenticated;

revoke execute on function
  public.venue_pin_list(text), public.venue_pin_set(text,text,text,text),
  public.venue_staff_list(text,text)
  from public;
grant execute on function
  public.venue_pin_list(text), public.venue_pin_set(text,text,text,text),
  public.venue_staff_list(text,text)
  to anon, authenticated, service_role;

-- ── ROLLBACK ─────────────────────────────────────────────────────────────
--   grant truncate on table public.actividad, public.ai_usage, public.chat_messages,
--     public.custom_dishes, public.dish_photo_submissions, public.duels,
--     public.employee_recovery, public.employees, public.horarios, public.live_sessions,
--     public.notifications, public.password_resets, public.scores,
--     public.venue_code_attempts, public.venue_codes to anon, authenticated;
--   grant delete on table public.ai_usage, public.chat_messages, public.custom_dishes,
--     public.dish_photo_submissions, public.employee_recovery, public.horarios,
--     public.password_resets, public.venue_code_attempts, public.venue_codes
--     to anon, authenticated;
--   grant execute on function public.venue_pin_list(text),
--     public.venue_pin_set(text,text,text,text), public.venue_staff_list(text,text) to public;
