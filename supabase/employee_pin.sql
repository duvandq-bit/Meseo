-- ═══════════════════════════════════════════════════════════════
-- TXOKO Formación · Employee PINs — server-side verification
-- ═══════════════════════════════════════════════════════════════
--
-- Problem this fixes
--   Employee PINs are stored as SHA-256(pin + 'txoko_salt_2026') in the
--   public `employees` table, which the browser reads with the anon key
--   (leaderboard, restore). Two compounding weaknesses:
--     • a 4-digit PIN has only 10 000 combinations, and
--     • every employee shares ONE static salt.
--   So a single 10 000-entry rainbow table reverses EVERY employee's PIN
--   the instant the table is read. Moving the secret server-side (bcrypt,
--   per-row salt, not anon-readable) removes the vector.
--
-- Design (mirrors supervisor_pin.sql)
--   1. Private table `employee_pin_secret(name, pin_hash)` — bcrypt, RLS on,
--      no grants to anon/authenticated (only service_role + the definer RPCs).
--   2. RPC `set_employee_pin(emp_name, new_pin)` — upserts a bcrypt hash.
--      Granted to anon so the browser can set/rotate a PIN during setup and
--      lazy-migration. Validates length; never returns the hash.
--   3. RPC `verify_employee_pin(emp_name, pin_input)` — returns:
--          true   → matches
--          false  → does not match
--          null   → no PIN set yet for this employee (NOT migrated)
--      The `null` lets the client fall back to its legacy local check for
--      one login, then call set_employee_pin to migrate seamlessly.
--
-- ROLLOUT (zero downtime, non-destructive)
--   a) Run this whole file in the Supabase SQL editor.
--   b) In index.html set  USE_SERVER_EMP_PIN_VERIFY = true  and deploy.
--      → New logins verify server-side; employees with no server hash yet
--        verify locally once and are migrated to bcrypt automatically.
--   c) After ~2–4 weeks (every active employee has logged in at least once),
--      stop syncing the legacy hash and clear it from the public table:
--          UPDATE public.employees SET pin = NULL;
--      and remove `pin` from the supaUpsertEmployee() payload in the bundle.
--      (Until then the legacy hash remains as the fallback — that's why this
--      step is deferred and manual.)
--
-- ROLLBACK
--   Set USE_SERVER_EMP_PIN_VERIFY = false in the bundle. The legacy local
--   compare still works (the public `pin` column is untouched until step c).
-- ═══════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ─── 1. Private secret table ─────────────────────────────────────
create table if not exists public.employee_pin_secret (
  name        text primary key,
  pin_hash    text not null,
  updated_at  timestamptz not null default now()
);

alter table public.employee_pin_secret enable row level security;
revoke all on public.employee_pin_secret from anon, authenticated;

-- ─── 2. Set / rotate an employee PIN (callable by the browser) ───
create or replace function public.set_employee_pin(emp_name text, new_pin text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if emp_name is null or length(trim(emp_name)) = 0 then
    raise exception 'employee name required';
  end if;
  if new_pin is null or length(new_pin) < 4 or length(new_pin) > 64 then
    raise exception 'PIN must be 4–64 characters';
  end if;
  insert into public.employee_pin_secret (name, pin_hash, updated_at)
  values (emp_name, crypt(new_pin, gen_salt('bf', 12)), now())
  on conflict (name) do update
    set pin_hash = excluded.pin_hash,
        updated_at = excluded.updated_at;
end;
$$;

-- ─── 3. Verify an employee PIN (callable by the browser) ─────────
-- Returns true / false / null(no hash yet → caller falls back + migrates).
create or replace function public.verify_employee_pin(emp_name text, pin_input text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  stored_hash text;
begin
  if emp_name is null or pin_input is null
     or length(pin_input) = 0 or length(pin_input) > 64 then
    return false;
  end if;
  select pin_hash into stored_hash
    from public.employee_pin_secret where name = emp_name;
  if stored_hash is null then
    return null;  -- not migrated yet
  end if;
  return crypt(pin_input, stored_hash) = stored_hash;  -- constant-time in crypt()
end;
$$;

-- Browser (anon) may set and verify, but never read the hash table directly.
revoke all on function public.set_employee_pin(text, text) from public;
revoke all on function public.verify_employee_pin(text, text) from public;
grant execute on function public.set_employee_pin(text, text) to anon, authenticated;
grant execute on function public.verify_employee_pin(text, text) to anon, authenticated;

-- ═══════════════════════════════════════════════════════════════
-- Done. Server-side employee PIN verification is ready.
-- Remember to flip USE_SERVER_EMP_PIN_VERIFY = true in index.html.
-- ═══════════════════════════════════════════════════════════════
