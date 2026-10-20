-- Role helpers for row level security. The role lives in the JWT's app_metadata, which only the admin API can write;
-- user_metadata is editable by every signed-in user, so it never counts. Only the exact strings below are roles, the
-- same rule as parseRole in src/lib/services/access.ts. This migration creates no tables and enables RLS on nothing.

-- The caller's role from the token, or null for no token, no role or any value that is not a known role.
create function public.current_app_role()
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select case when claims.app_role in ('planner', 'employee') then claims.app_role end
  from (select auth.jwt() -> 'app_metadata' ->> 'role' as app_role) as claims
$$;

-- The one definition of "who is a planner" for every RLS policy; false for everyone else, including anonymous callers.
create function public.is_planner()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(public.current_app_role() = 'planner', false)
$$;

-- non-obvious: explicit revoke from anon, because default privileges in Supabase grant execute on new public functions to it
revoke execute on function public.current_app_role() from public, anon;
grant execute on function public.current_app_role() to authenticated;

revoke execute on function public.is_planner() from public, anon;
grant execute on function public.is_planner() to authenticated;

-- RLS pattern for every table added from now on (a template: nothing below runs). CLAUDE.md requires RLS on each new
-- table, with a separate policy per operation and per role. Wrapping a helper in (select ...) lets Postgres evaluate it
-- once per statement instead of once per row.
--
-- alter table public.example_table enable row level security;
--
-- Planner: full access.
-- create policy "planner can select example_table" on public.example_table
--   for select to authenticated using ((select public.is_planner()));
-- create policy "planner can insert example_table" on public.example_table
--   for insert to authenticated with check ((select public.is_planner()));
-- create policy "planner can update example_table" on public.example_table
--   for update to authenticated using ((select public.is_planner())) with check ((select public.is_planner()));
-- create policy "planner can delete example_table" on public.example_table
--   for delete to authenticated using ((select public.is_planner()));
--
-- Employee: only their own rows (user_id holds auth.uid()). The role check keeps accounts without a role out.
-- create policy "employee can select own example_table rows" on public.example_table
--   for select to authenticated
--   using ((select public.current_app_role()) = 'employee' and user_id = (select auth.uid()));
--
-- Give employees insert, update or delete policies only where the feature needs them, each with the same own-row check
-- (in with check for insert and update).
