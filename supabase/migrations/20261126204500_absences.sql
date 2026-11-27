-- Absences of employees (S-07): leave, sick leave (L4) or another absence, always in whole days (a first and a last day,
-- both included). The CHECK constraints repeat the boundaries of src/lib/services/absence.ts (a type of vacation,
-- sick_leave or other, a status of requested, approved or rejected, both days from 2020-01-01 to 2099-12-31, the last day
-- not before the first), so a client that bypasses the app cannot store what the app would refuse. There is no text column
-- on purpose: an L4 is health data, so the table holds the type and the days and nothing else. Nothing stops absences of
-- one person from overlapping (an L4 during a leave is legal); the rules take the strongest one.
-- non-obvious: the date bounds are those of schedules.start_date and of parseIsoDate in the app, and they are load-bearing.
-- The live rule check reads the absences of everyone on a schedule, and a date outside 2020-2099 makes its date helpers
-- throw a RangeError, which switches the check off for every schedule that person is on. So the database refuses such a
-- date instead of leaving the app to cope with it.
-- non-obvious: status exists for the leave requests of S-14 (requested) and their decision in S-15 (approved or rejected).
-- Only an approved absence is a critical collision and lowers the weekly norm; a requested one is a warning and a rejected
-- one is ignored. S-07 has only the planner entering absences, and an entry by the planner is approved by itself, so the
-- column defaults to 'approved' and no session may write it: the column grants below leave it out, for insert and for
-- update. A row with another status comes from the service-role key (the smoke steps write one); S-14 and S-15 add the
-- writes they need in a migration of their own, the way S-09 will for schedule_assignments.source.
-- employee_id cascades: an absence means nothing without its person. Nobody deletes employees through the API (they have no
-- delete grant), so the cascade only runs when the service-role key removes one (the smoke cleanup does).
create table public.absences (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete cascade,
  type text not null,
  status text not null default 'approved',
  start_date date not null,
  end_date date not null,
  created_at timestamptz not null default now(),
  constraint absences_type_valid check (type in ('vacation', 'sick_leave', 'other')),
  constraint absences_status_valid check (status in ('requested', 'approved', 'rejected')),
  constraint absences_dates_valid check (
    start_date between '2020-01-01' and '2099-12-31' and end_date between '2020-01-01' and '2099-12-31'
  ),
  constraint absences_range_valid check (end_date >= start_date)
);

-- Serves the foreign key to employees (the cascade looks up the rows of a deleted employee) and the lookup of everything
-- one person has.
create index absences_employee_idx on public.absences (employee_id);

alter table public.absences enable row level security;

-- Planner only. Employees get no policy: they see their own absences in S-13 and S-11, with an own-row policy of their own
-- (the pattern at the end of the role helpers migration) added then.
create policy "planner can select absences" on public.absences
  for select to authenticated using ((select public.is_planner()));
create policy "planner can insert absences" on public.absences
  for insert to authenticated with check ((select public.is_planner()));
create policy "planner can update absences" on public.absences
  for update to authenticated using ((select public.is_planner())) with check ((select public.is_planner()));
create policy "planner can delete absences" on public.absences
  for delete to authenticated using ((select public.is_planner()));

-- non-obvious: Supabase default privileges give anon and authenticated every right on a new public table
revoke all on table public.absences from anon, authenticated;
grant select, delete on table public.absences to authenticated;

-- non-obvious: insert and update are granted per column, never on the table, because a table-level grant would also cover
-- status (and every column added later). A session inserts the person, the type and the two days, and changes the type and
-- the two days; the status is left to the default and to the service-role key, and the person of an absence is not changed:
-- moving it to somebody else is removing it and adding another. A write that names any other column is refused with a
-- permission error (42501) before the policies are looked at.
grant insert (employee_id, type, start_date, end_date) on table public.absences to authenticated;
grant update (type, start_date, end_date) on table public.absences to authenticated;

-- S-07 lets the planner enter, correct and remove absences and feeds them to the rule check of the assignment page; S-13
-- adds the entries of employees, S-14 the leave requests (status requested) and S-15 their approval, which changes the
-- status; S-08 reads the absences to verify a schedule before it is approved.
