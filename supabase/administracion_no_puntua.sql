-- ═══════════════════════════════════════════════════════════════
-- Meseo · La cuenta de administración no puntúa — lo dice el SERVIDOR
-- ═══════════════════════════════════════════════════════════════
--
-- El problema
--   La cuenta de administración está para revisar contenido, no para competir.
--   Eso se comprobaba sólo en el móvil (`_esAdmin`), y el móvil no protege
--   nada: `getEmp()` crea la ficha local SIN rol, así que entre entrar y que
--   baje la ficha de la nube hay una ventana en la que el corte no existe.
--   Por ahí se colaron 50 XP en septiembre y otros 90 después de «arreglarlo».
--
--   El corte del cliente se queda —ahorra viajes de red— pero ya no es lo que
--   sostiene la promesa.
--
-- Lo que hace
--   1. Al escribir una ficha con rol 'admin', recorta a cero todo lo que es
--      puntuación: xp, racha, sesiones, récord, duelos, temas, platos
--      conocidos, aciertos, logros y `extras` (que guarda la liga semanal).
--      El resto —restaurante, nombre visible, firma, último acceso— se
--      respeta: la cuenta tiene que poder usar la app.
--   2. Descarta en silencio cualquier fila de `scores` suya. En silencio y no
--      con error porque no es culpa de quien la usa.
--   3. Limpia lo que ya se había colado.
--
-- Aplicado en la migración `la_administracion_no_puntua_lo_dice_el_servidor`.
-- Comprobado intentando ponerle 5000 XP, racha 30 y una marca a mano: quedan
-- en 0, 0 y ninguna, y la cuenta sigue pudiendo usar la app.
-- ═══════════════════════════════════════════════════════════════

create or replace function public.admin_no_puntua()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role = 'admin' then
    new.xp := 0;
    new.streak := 0;
    new.sessions_count := 0;
    new.txoko_record := 0;
    new.duel_wins := 0;
    new.topic_scores := null;
    new.known_dishes := null;
    new.exam_correct := null;
    new.sessions_data := null;
    new.achievements := null;
    new.extras := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_admin_no_puntua on public.employees;
create trigger trg_admin_no_puntua
  before insert or update on public.employees
  for each row execute function public.admin_no_puntua();

create or replace function public.admin_sin_marcas()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.employees e
              where e.name = new.employee and e.role = 'admin') then
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_admin_sin_marcas on public.scores;
create trigger trg_admin_sin_marcas
  before insert on public.scores
  for each row execute function public.admin_sin_marcas();
