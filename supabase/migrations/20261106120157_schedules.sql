-- Weekly schedule draft. A schedule covers the seven days from its start date; each day is a day_offset 0-6 counted
-- from that date, so changing the start date never rewrites the grid. The CHECK constraints repeat the boundaries of
-- src/lib/services/schedule.ts (a start date from 2020-01-01 to 2099-12-31, a label of 1-60 characters, a day offset of
-- 0-6, a required count of 1-99), so a client that bypasses the app cannot store what the app would refuse. Collapsed
-- inner whitespace and the ban on control characters in the label are normalisation done by the app only; the database
-- does not enforce them. A period is not unique on purpose: several drafts may cover the same days.
create table public.schedules (
  id uuid primary key default gen_random_uuid(),
  start_date date not null,
  -- Optional, to tell drafts of the same period apart.
  label text,
  created_at timestamptz not null default now(),
  constraint schedules_start_date_valid check (start_date between '2020-01-01' and '2099-12-31'),
  constraint schedules_label_valid check (
    label is null or (label = btrim(label) and char_length(label) between 1 and 60)
  )
);

alter table public.schedules enable row level security;

-- Planner only; the delete policy of the template is left out on purpose, so nobody removes a schedule through the API.
create policy "planner can select schedules" on public.schedules
  for select to authenticated using ((select public.is_planner()));
create policy "planner can insert schedules" on public.schedules
  for insert to authenticated with check ((select public.is_planner()));
create policy "planner can update schedules" on public.schedules
  for update to authenticated using ((select public.is_planner())) with check ((select public.is_planner()));

-- non-obvious: Supabase default privileges give anon and authenticated every right on a new public table
revoke all on table public.schedules from anon, authenticated;
grant select, insert, update on table public.schedules to authenticated;

-- Required headcount per shift and day. Only cells with a count of 1-99 are stored; a cell of 0 means no shift that day
-- and has no row. A night shift counts for the day it starts, so the cell is the pair of shift and starting day. The
-- shift is referenced by id and read live from the dictionary, and on delete restrict keeps a shift that a schedule
-- uses from disappearing. The primary key starts with schedule_id, which also serves the foreign key to schedules.
create table public.schedule_staffing (
  schedule_id uuid not null references public.schedules (id) on delete cascade,
  shift_id uuid not null references public.shifts (id) on delete restrict,
  day_offset smallint not null,
  required_count smallint not null,
  primary key (schedule_id, shift_id, day_offset),
  constraint schedule_staffing_day_offset_valid check (day_offset between 0 and 6),
  constraint schedule_staffing_required_count_valid check (required_count between 1 and 99)
);

-- The lookup behind on delete restrict, so that deleting a shift does not scan the whole table.
create index schedule_staffing_shift_id_idx on public.schedule_staffing (shift_id);

-- The employees a schedule covers, referenced by id and read live from the roster. Nobody deletes employees, so a
-- person who left stays in the roster and on delete restrict is only a guard; the planner removes them from a schedule
-- here.
create table public.schedule_employees (
  schedule_id uuid not null references public.schedules (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete restrict,
  primary key (schedule_id, employee_id)
);

create index schedule_employees_employee_id_idx on public.schedule_employees (employee_id);

alter table public.schedule_staffing enable row level security;
alter table public.schedule_employees enable row level security;

-- non-obvious: unlike schedules, these two tables get a delete policy and grant, and no update. A save replaces the
-- whole grid and the whole roster (save_schedule deletes the old rows and inserts the new ones), so rows are never
-- edited in place, while the schedule row itself is never deleted.
create policy "planner can select schedule_staffing" on public.schedule_staffing
  for select to authenticated using ((select public.is_planner()));
create policy "planner can insert schedule_staffing" on public.schedule_staffing
  for insert to authenticated with check ((select public.is_planner()));
create policy "planner can delete schedule_staffing" on public.schedule_staffing
  for delete to authenticated using ((select public.is_planner()));

create policy "planner can select schedule_employees" on public.schedule_employees
  for select to authenticated using ((select public.is_planner()));
create policy "planner can insert schedule_employees" on public.schedule_employees
  for insert to authenticated with check ((select public.is_planner()));
create policy "planner can delete schedule_employees" on public.schedule_employees
  for delete to authenticated using ((select public.is_planner()));

-- non-obvious: Supabase default privileges give anon and authenticated every right on a new public table
revoke all on table public.schedule_staffing from anon, authenticated;
grant select, insert, delete on table public.schedule_staffing to authenticated;

revoke all on table public.schedule_employees from anon, authenticated;
grant select, insert, delete on table public.schedule_employees to authenticated;

-- Saves a whole schedule in one transaction, because PostgREST writes one table per request and nobody may delete the
-- header to undo a half-finished save. p_schedule_id null creates the schedule; otherwise it changes the start date and
-- label and replaces the grid and the roster. p_staffing is an array of { shiftId, dayOffset, requiredCount } and
-- p_employee_ids an array of employee ids, both already validated by the app. A violated constraint or foreign key
-- aborts the whole call, so either everything is saved or nothing. The function is security invoker, so the policies of
-- the caller apply: for anyone but a planner the update touches no row and the call ends in the same 404 as an id that
-- does not exist. Returns the id of the schedule.
create function public.save_schedule(
  p_schedule_id uuid,
  p_start_date date,
  p_label text,
  p_staffing jsonb,
  p_employee_ids jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_schedule_id uuid;
begin
  if p_schedule_id is null then
    insert into public.schedules (start_date, label)
    values (p_start_date, p_label)
    returning id into v_schedule_id;
  else
    update public.schedules
    set start_date = p_start_date, label = p_label
    where id = p_schedule_id
    returning id into v_schedule_id;

    -- The SQLSTATE PT404 is mapped by PostgREST to HTTP status 404.
    if v_schedule_id is null then
      raise sqlstate 'PT404' using message = 'Schedule not found';
    end if;

    delete from public.schedule_staffing where schedule_id = v_schedule_id;
    delete from public.schedule_employees where schedule_id = v_schedule_id;
  end if;

  insert into public.schedule_staffing (schedule_id, shift_id, day_offset, required_count)
  select v_schedule_id, cell."shiftId", cell."dayOffset", cell."requiredCount"
  from jsonb_to_recordset(p_staffing) as cell ("shiftId" uuid, "dayOffset" smallint, "requiredCount" smallint);

  insert into public.schedule_employees (schedule_id, employee_id)
  select v_schedule_id, person.employee_id::uuid
  from jsonb_array_elements_text(p_employee_ids) as person (employee_id);

  return v_schedule_id;
end;
$$;

-- non-obvious: PostgreSQL grants execute on a new function to PUBLIC by default, and PostgREST exposes every function
-- of the public schema as an RPC endpoint, so the grant is narrowed to signed-in users explicitly (the policies would
-- stop an outsider anyway, but a function should not be callable by roles that never use it).
revoke execute on function public.save_schedule(uuid, date, text, jsonb, jsonb) from public, anon;
grant execute on function public.save_schedule(uuid, date, text, jsonb, jsonb) to authenticated;

-- A schedule is a draft that reads the shift dictionary and the employees live, by id. S-04 adds the assignment of
-- people to shifts; S-08 adds a status and copies the name and times of each shift (and the data of each employee) into
-- the approved schedule, so editing the dictionary later never rewrites an approved one. Employees get no policy on
-- these tables: they read that approved copy in S-11, not the drafts.
