-- ═══ LA IDENTIDAD DE UNA FICHA NO SE TOCA DESDE FUERA ════════════════════
-- APLICADO en producción el 13 de septiembre de 2026 (migración
-- `fase_2_5b_2_identidad_inmutable_en_employees`). Copia para el repositorio.
--
-- EL PROBLEMA
--   `employees.name` es la clave primaria y `anon` podía escribirla. Como
--   `scores.employee` y `actividad.employee` son texto sin clave ajena,
--   renombrar a alguien parte su histórico en silencio. Y con `auth_user_id`
--   recién añadida aparecía uno peor: reclamar la ficha de otro escribiéndole
--   una identidad.
--
-- POR QUÉ UN TRIGGER Y NO UN PERMISO DE COLUMNA
--   Revocar UPDATE sobre `name` rompería la aplicación: la sincronización de
--   progreso es un upsert y PostgREST mete `"name" = EXCLUDED."name"` en el
--   SET. Pero eso es un NO-OP —el valor es el mismo, porque `name` es el
--   objeto del conflicto—, así que un trigger que mire si el valor CAMBIA deja
--   pasar el guardado legítimo y para el renombrado de verdad.
--
--   Medido antes de aplicarlo, en una transacción que aborta, y otra vez ya
--   en producción:
--     guardado de progreso de la app ....... FUNCIONA
--     renombrar a otro empleado ............ BLOQUEADO
--     escribir el auth_user_id de otro ..... BLOQUEADO
--     soltar el vínculo propio ............. BLOQUEADO
--
-- ALCANCE
--   Sólo muerde a `anon` y `authenticated`. El mantenimiento por SQL
--   (`postgres`) y las funciones SECURITY DEFINER siguen pudiendo renombrar o
--   vincular: es donde esas operaciones deben vivir, con una persona detrás.

create or replace function public.employees_identidad_inmutable() returns trigger
  language plpgsql security definer set search_path = ''
as $$
begin
  if current_user in ('anon','authenticated') then
    if new.name is distinct from old.name then
      raise exception 'renombrar_no_permitido'
        using errcode = '42501',
              hint = 'Renombrar a un empleado mueve su histórico: es una operación de supervisor, no del cliente.';
    end if;
    if new.auth_user_id is distinct from old.auth_user_id then
      raise exception 'identidad_no_editable'
        using errcode = '42501',
              hint = 'auth_user_id lo asigna el servidor tras verificar el PIN.';
    end if;
  end if;
  return new;
end $$;

revoke execute on function public.employees_identidad_inmutable() from public;

drop trigger if exists trg_employees_identidad_inmutable on public.employees;
create trigger trg_employees_identidad_inmutable
  before update on public.employees
  for each row execute function public.employees_identidad_inmutable();

-- ── CÓMO SE DESHACE ──────────────────────────────────────────────────────
--   drop trigger trg_employees_identidad_inmutable on public.employees;
--   drop function public.employees_identidad_inmutable();
