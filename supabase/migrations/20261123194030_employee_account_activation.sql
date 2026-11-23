-- Employee account activation (S-10, decision change of 2026-11-23). employees.activated_at is the moment the employee
-- first set a password from an invitation link; the employee list reads it to show "Zarejestrowany dd.mm.rrrr" instead of
-- "Zaproszony ...". It stays null until public.mark_account_active() sets it.
-- Who calls the function, and when: the set-password route (POST /api/auth/set-password), with the employee's own session,
-- right after Auth has saved the password. It does so for invitation links and for password-reset links alike. The function
-- is idempotent: it writes only while activated_at is null, so the first activation wins and a later password reset leaves
-- it alone.
-- This is a deliberate departure from the earlier plan ("What We're NOT Doing": no tracking of acceptance, no SECURITY
-- DEFINER function); the author approved it. There is no trigger on auth.users: the route is the one place that knows a
-- password was set.
alter table public.employees add column activated_at timestamptz;

-- Marks the caller's own employee row as active. It touches only the row with user_id = auth.uid(), and only for an account
-- with the employee role (the condition of the own-row select policy), so a planner, an account without a role or an
-- anonymous caller changes nothing. A call from a session without a matching row is a no-op, not an error.
-- non-obvious: security definer, because an employee has no update policy and no column grant on employees; the owner's
-- rights let this one statement write this one column. search_path is empty, so every name below is schema-qualified.
create function public.mark_account_active()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.employees
  set activated_at = now()
  where user_id = (select auth.uid())
    and activated_at is null
    and (select public.current_app_role()) = 'employee'
$$;

-- non-obvious: Postgres grants execute on a new function to PUBLIC, and Supabase default privileges also grant it to anon.
-- That matters more for a security definer function, so both are revoked and only signed-in callers keep execute.
revoke execute on function public.mark_account_active() from public, anon;
grant execute on function public.mark_account_active() to authenticated;

-- activated_at is not in the column grants of the employee accounts migration (five roster columns only), so no session
-- writes it directly: only this function and the service-role key do.
