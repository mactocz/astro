-- Shift dictionary. The CHECK constraints repeat the boundaries of src/lib/services/shift.ts (names of 1-50 characters,
-- start and end as minutes after midnight 0-1439, an end equal to the start refused), so a client that bypasses the app
-- cannot store what the app would refuse. An end earlier than the start is valid: the shift runs through midnight into
-- the next day. Collapsed inner whitespace and the ban on control characters are normalisation done by the app only;
-- the database does not enforce them. A name is not unique on purpose: two shifts may share a name.
create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  start_minute smallint not null,
  end_minute smallint not null,
  created_at timestamptz not null default now(),
  constraint shifts_name_valid check (
    name = btrim(name) and char_length(name) between 1 and 50
  ),
  constraint shifts_start_minute_valid check (start_minute between 0 and 1439),
  constraint shifts_end_minute_valid check (end_minute between 0 and 1439),
  constraint shifts_times_differ check (start_minute <> end_minute)
);

alter table public.shifts enable row level security;

-- Planner only; the delete policy of the template is left out on purpose, so nobody removes a row through the API.
create policy "planner can select shifts" on public.shifts
  for select to authenticated using ((select public.is_planner()));
create policy "planner can insert shifts" on public.shifts
  for insert to authenticated with check ((select public.is_planner()));
create policy "planner can update shifts" on public.shifts
  for update to authenticated using ((select public.is_planner())) with check ((select public.is_planner()));

-- non-obvious: Supabase default privileges give anon and authenticated every right on a new public table
revoke all on table public.shifts from anon, authenticated;
grant select, insert, update on table public.shifts to authenticated;

-- A shift is an editable row. S-03 refers to it by id; S-08 copies its name and times into the approved schedule, so
-- editing a shift later never rewrites a schedule that was already approved. Employees get no policy on this table:
-- they read that copy in S-11, not the dictionary.
