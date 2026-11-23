-- Employee accounts (S-10). An employee row gets a link to its Auth account and the time of the latest invitation. Both
-- columns stay null until the invitation route (service-role key) writes them. The account is optional: an employee
-- exists in the roster before, and without, an invitation.
-- user_id is unique, so one account belongs to at most one row (employees_user_id_key). on delete set null keeps the
-- row when somebody removes the account in the Supabase dashboard; the employee then simply has no account again.
alter table public.employees
  add column user_id uuid constraint employees_user_id_key unique references auth.users (id) on delete set null,
  add column invited_at timestamptz;

-- An employee reads their own row and nothing else. The role check keeps accounts without a role out, even when such
-- an account is linked to a row. There is no insert, update or delete policy for employees: they never change a row.
create policy "employee can select own employee row" on public.employees
  for select to authenticated
  using ((select public.current_app_role()) = 'employee' and user_id = (select auth.uid()));

-- non-obvious: only the service-role key writes user_id and invited_at (the invitation route). A signed-in planner may
-- write the five columns below and nothing else, otherwise the planner could link a row to any account through
-- PostgREST. Column grants need the table-level insert and update revoked first, because a table-level grant covers
-- every column, present and future. select stays table-wide, so reads still return user_id and invited_at. A column
-- added to employees later is writable only after a grant of its own.
revoke insert, update on table public.employees from authenticated;
grant
  insert (first_name, last_name, email, fte_numerator, fte_denominator),
  update (first_name, last_name, email, fte_numerator, fte_denominator)
  on table public.employees to authenticated;

-- This is the "employee sees their own row" policy that the roster migration announced for S-10 and S-11. Tables added
-- later copy the own-row pattern at the end of the role helpers migration.
