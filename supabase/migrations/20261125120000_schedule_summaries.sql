-- Schedule list (S-03 review, F7). The list page used to select every schedule with the embedded rows of schedule_staffing
-- and schedule_employees and to add the counts up in the app. That fetched every cell of every schedule only to sum it, and
-- PostgREST cuts a response at max_rows (1000 by default) without a word, so a long list would have shown wrong totals.
-- The view below does the counting in the database and returns one flat row per schedule, so the page asks for a bounded
-- number of rows and the select embedding in src/lib/schedules.ts is gone.
-- One row per schedule, with the number of people on its roster and the sum of the required counts of its grid. Both are
-- correlated subqueries, so a schedule without people or without a grid (the app never saves one, but the tables allow it)
-- still has its row, with a zero.
-- non-obvious: security_invoker = true makes the view read its tables with the rights and the row-level security of the
-- caller. A plain view runs as its owner, which bypasses RLS, so every signed-in user would see every schedule in it,
-- employees included. With security_invoker the planner-only select policies of the three tables decide, exactly as they
-- do for a direct select, and an employee or an account without a role gets an empty list. The option needs PostgreSQL 15
-- or newer (the project runs 17).
create view public.schedule_summaries
with (security_invoker = true)
as
select
  schedule.id,
  schedule.start_date,
  schedule.label,
  schedule.created_at,
  (
    select count(*)
    from public.schedule_employees as roster
    where roster.schedule_id = schedule.id
  )::int as employee_count,
  (
    select coalesce(sum(staffing.required_count), 0)
    from public.schedule_staffing as staffing
    where staffing.schedule_id = schedule.id
  )::int as total_required
from public.schedules as schedule;

-- non-obvious: Supabase default privileges give anon and authenticated every right on a new public view as well as on a
-- table. The view is read-only, so only select is granted, to signed-in users; anon gets nothing (and could not read the
-- tables below it anyway).
revoke all on table public.schedule_summaries from anon, authenticated;
grant select on table public.schedule_summaries to authenticated;
