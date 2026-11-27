-- Schedule approval (S-08). A schedule is a draft until the planner approves it; an approved one is final and locked, and
-- nothing takes the approval back (a change of an approved schedule is a new version, S-12). The lock lives in the
-- database, not only in the app:
-- * schedules.status is written by nobody's session: the table-wide grant of S-03 would cover every column added later,
--   so it is replaced by column grants on start_date and label, and only approve_schedule below sets the status;
-- * the write policies of schedules, schedule_staffing, schedule_employees and schedule_assignments refuse an approved
--   schedule, so a planner's token that bypasses the app cannot change one either. The cascades of the foreign keys and
--   the service-role key run without row level security, which is what the smoke cleanup relies on.
-- * approve_schedule is the one door: it locks the schedule and the tables, checks that the data the app judged is exactly
--   the live data, and stores the record and the snapshot in the same transaction.
-- non-obvious: the work-time rules live in TypeScript and the database does not repeat them. The function refuses findings
-- that are not warnings and warnings that were not confirmed, but a planner who calls it directly can hand it a shortened
-- list of findings. This residual risk is accepted (the planner is the trusted decision maker) and the record keeps who
-- approved.
-- non-obvious: a snapshot, not a lock on the dictionary: editing a used shift or an employee stays possible and does not
-- change an approved schedule, which reads its names, hours and FTE from the copies below.

alter table public.schedules add column status text not null default 'draft';
alter table public.schedules add constraint schedules_status_valid check (status in ('draft', 'approved'));

-- A table-level revoke removes every column privilege of that kind too, so the grants are made again column by column.
revoke insert, update on table public.schedules from authenticated;
grant insert (start_date, label), update (start_date, label) on table public.schedules to authenticated;

-- False for an approved schedule only. non-obvious: it is also true for an id that has no schedule, so that a write for a
-- missing schedule is still refused by the foreign key (23503, which the app tells apart) and not by the policy.
create function public.schedule_is_draft(p_schedule_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select not exists (
    select 1
    from public.schedules as schedule
    where schedule.id = p_schedule_id and schedule.status = 'approved'
  )
$$;

revoke execute on function public.schedule_is_draft(uuid) from public, anon;
grant execute on function public.schedule_is_draft(uuid) to authenticated;

-- The select policies stay as they are: the planner reads an approved schedule.
drop policy "planner can update schedules" on public.schedules;
create policy "planner can update schedules" on public.schedules
  for update to authenticated
  using ((select public.is_planner()) and status = 'draft')
  with check ((select public.is_planner()) and status = 'draft');

drop policy "planner can insert schedule_staffing" on public.schedule_staffing;
create policy "planner can insert schedule_staffing" on public.schedule_staffing
  for insert to authenticated
  with check ((select public.is_planner()) and public.schedule_is_draft(schedule_id));
drop policy "planner can update schedule_staffing" on public.schedule_staffing;
create policy "planner can update schedule_staffing" on public.schedule_staffing
  for update to authenticated
  using ((select public.is_planner()) and public.schedule_is_draft(schedule_id))
  with check ((select public.is_planner()) and public.schedule_is_draft(schedule_id));
drop policy "planner can delete schedule_staffing" on public.schedule_staffing;
create policy "planner can delete schedule_staffing" on public.schedule_staffing
  for delete to authenticated
  using ((select public.is_planner()) and public.schedule_is_draft(schedule_id));

drop policy "planner can insert schedule_employees" on public.schedule_employees;
create policy "planner can insert schedule_employees" on public.schedule_employees
  for insert to authenticated
  with check ((select public.is_planner()) and public.schedule_is_draft(schedule_id));
drop policy "planner can delete schedule_employees" on public.schedule_employees;
create policy "planner can delete schedule_employees" on public.schedule_employees
  for delete to authenticated
  using ((select public.is_planner()) and public.schedule_is_draft(schedule_id));

drop policy "planner can insert schedule_assignments" on public.schedule_assignments;
create policy "planner can insert schedule_assignments" on public.schedule_assignments
  for insert to authenticated
  with check ((select public.is_planner()) and public.schedule_is_draft(schedule_id));
drop policy "planner can delete schedule_assignments" on public.schedule_assignments;
create policy "planner can delete schedule_assignments" on public.schedule_assignments
  for delete to authenticated
  using ((select public.is_planner()) and public.schedule_is_draft(schedule_id));

-- The record of an approval and its snapshot. None of the three has a foreign key to shifts, employees or auth.users:
-- the copy must outlive an edit and the removal of an account (approved_by is kept with the e-mail next to it). All of
-- them go with their schedule. The planner reads them and no session writes them (only approve_schedule does). Employees
-- get no policy: the findings name the kind of an absence (sick leave included), so they stay with the planner.
create table public.schedule_approvals (
  schedule_id uuid primary key references public.schedules (id) on delete cascade,
  approved_at timestamptz not null default now(),
  approved_by uuid not null,
  approved_by_email text not null,
  violations jsonb not null,
  confirmed_keys jsonb not null,
  critical_count integer not null,
  warning_count integer not null
);

create table public.schedule_approval_shifts (
  schedule_id uuid not null references public.schedules (id) on delete cascade,
  shift_id uuid not null,
  name text not null,
  start_minute smallint not null,
  end_minute smallint not null,
  primary key (schedule_id, shift_id)
);

create table public.schedule_approval_employees (
  schedule_id uuid not null references public.schedules (id) on delete cascade,
  employee_id uuid not null,
  -- "Last name First name", as the app shows a person of a schedule.
  display_name text not null,
  fte_numerator smallint not null,
  fte_denominator smallint not null,
  worked_minutes integer not null,
  norm_minutes integer not null,
  primary key (schedule_id, employee_id)
);

alter table public.schedule_approvals enable row level security;
alter table public.schedule_approval_shifts enable row level security;
alter table public.schedule_approval_employees enable row level security;

create policy "planner can select schedule_approvals" on public.schedule_approvals
  for select to authenticated using ((select public.is_planner()));
create policy "planner can select schedule_approval_shifts" on public.schedule_approval_shifts
  for select to authenticated using ((select public.is_planner()));
create policy "planner can select schedule_approval_employees" on public.schedule_approval_employees
  for select to authenticated using ((select public.is_planner()));

-- non-obvious: Supabase default privileges give anon and authenticated every right on a new public table
revoke all on table public.schedule_approvals from anon, authenticated;
grant select on table public.schedule_approvals to authenticated;
revoke all on table public.schedule_approval_shifts from anon, authenticated;
grant select on table public.schedule_approval_shifts to authenticated;
revoke all on table public.schedule_approval_employees from anon, authenticated;
grant select on table public.schedule_approval_employees to authenticated;

-- The save of S-04 with one addition: an approved schedule raises PT423 (PostgREST: HTTP 423), not PT409, which the app
-- reads as unconfirmed removals. The check follows the update on purpose: the policy hides an approved row from the
-- update, also when the save waited for an approval that was running, so a check made before the update would still have
-- seen a draft and the call would have ended as "not found". The signature is unchanged, so the grants stay.
create or replace function public.save_schedule(
  p_schedule_id uuid,
  p_start_date date,
  p_label text,
  p_staffing jsonb,
  p_employee_ids jsonb,
  p_confirm_removals boolean
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_schedule_id uuid;
  v_removed bigint;
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

    -- The SQLSTATE PT404 is mapped by PostgREST to HTTP status 404, PT423 to 423.
    if v_schedule_id is null then
      if not public.schedule_is_draft(p_schedule_id) then
        raise sqlstate 'PT423' using message = 'Schedule is approved';
      end if;
      raise sqlstate 'PT404' using message = 'Schedule not found';
    end if;

    -- The count comes before the first delete, and the exception undoes the update above. A text from
    -- jsonb_array_elements_text is cast to uuid to be compared with the uuid column; not exists, unlike not in, does
    -- not go wrong on a null element.
    select count(*)
    into v_removed
    from public.schedule_assignments as assignment
    where assignment.schedule_id = v_schedule_id
      and (
        not exists (
          select 1
          from jsonb_to_recordset(p_staffing) as cell ("shiftId" uuid, "dayOffset" smallint)
          where cell."shiftId" = assignment.shift_id and cell."dayOffset" = assignment.day_offset
        )
        or not exists (
          select 1
          from jsonb_array_elements_text(p_employee_ids) as person (employee_id)
          where person.employee_id::uuid = assignment.employee_id
        )
      );

    -- The SQLSTATE PT409 is mapped by PostgREST to HTTP status 409.
    if v_removed > 0 and not coalesce(p_confirm_removals, false) then
      raise sqlstate 'PT409' using message = 'Assignments would be removed', detail = v_removed::text;
    end if;

    -- The deletes come before the inserts below. The cascade of the foreign keys removes the assignments of what is
    -- deleted here.
    delete from public.schedule_staffing as staffing
    where staffing.schedule_id = v_schedule_id
      and not exists (
        select 1
        from jsonb_to_recordset(p_staffing) as cell ("shiftId" uuid, "dayOffset" smallint)
        where cell."shiftId" = staffing.shift_id and cell."dayOffset" = staffing.day_offset
      );

    delete from public.schedule_employees as roster
    where roster.schedule_id = v_schedule_id
      and not exists (
        select 1
        from jsonb_array_elements_text(p_employee_ids) as person (employee_id)
        where person.employee_id::uuid = roster.employee_id
      );
  end if;

  -- A cell that already exists keeps its row, and with it its assignments; only its required count is set. This is the
  -- update that the column grant of S-04 allows.
  insert into public.schedule_staffing (schedule_id, shift_id, day_offset, required_count)
  select v_schedule_id, cell."shiftId", cell."dayOffset", cell."requiredCount"
  from jsonb_to_recordset(p_staffing) as cell ("shiftId" uuid, "dayOffset" smallint, "requiredCount" smallint)
  on conflict (schedule_id, shift_id, day_offset) do update set required_count = excluded.required_count;

  insert into public.schedule_employees (schedule_id, employee_id)
  select v_schedule_id, person.employee_id::uuid
  from jsonb_array_elements_text(p_employee_ids) as person (employee_id)
  on conflict (schedule_id, employee_id) do nothing;

  return v_schedule_id;
end;
$$;

-- Approves a draft. p_inputs is what the app judged: { startDate, staffing: [{ shiftId, dayOffset, requiredCount }],
-- employeeIds, assignments: [{ shiftId, dayOffset, employeeId }], shifts: [{ id, name, startMinute, endMinute }],
-- employees: [{ id, name, fte: { numerator, denominator } }], absences: [{ employeeId, type, status, startDate,
-- endDate }] }. p_violations are the findings to freeze, p_confirmed_keys the keys of the confirmed warnings and
-- p_workload [{ employeeId, workedMinutes, normMinutes }] for every person of the roster. Returns the time of the approval.
-- Errors: 42501 not a planner, PT404 no such schedule, PT423 approved already, PT412 the data is not the live data any
-- more, PT422 the findings or the hours are not acceptable (PostgREST answers PTxyz with HTTP status xyz).
-- non-obvious: security definer, the second function of the project that is (after mark_account_active), because no
-- session may write schedules.status or the approval tables. It therefore bypasses RLS, so the role check is its first
-- statement.
create function public.approve_schedule(
  p_schedule_id uuid,
  p_inputs jsonb,
  p_violations jsonb,
  p_confirmed_keys jsonb,
  p_workload jsonb
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_start_date date;
  v_approved_at timestamptz;
begin
  if not public.is_planner() then
    raise exception using errcode = '42501', message = 'Only a planner can approve a schedule';
  end if;

  -- The row lock comes first: a second approval and a save of this schedule wait here, and then see the new status.
  select schedule.status, schedule.start_date
  into v_status, v_start_date
  from public.schedules as schedule
  where schedule.id = p_schedule_id
  for update;

  if not found then
    raise sqlstate 'PT404' using message = 'Schedule not found';
  end if;
  if v_status <> 'draft' then
    raise sqlstate 'PT423' using message = 'Schedule is approved';
  end if;

  -- non-obvious: an assignment has no key to schedules, so the row lock does not stop one from being added; the tables
  -- are locked against writes (reads go on). The staffing comes first because every save writes it first and the cascade
  -- reaches the assignments later: the other order could deadlock with the save of another schedule.
  lock table
    public.schedule_staffing,
    public.schedule_employees,
    public.schedule_assignments,
    public.absences
  in share row exclusive mode;

  perform 1
  from public.shifts as shift
  where shift.id in (
    select staffing.shift_id from public.schedule_staffing as staffing where staffing.schedule_id = p_schedule_id
  )
  order by shift.id
  for share;

  perform 1
  from public.employees as employee
  where employee.id in (
    select roster.employee_id from public.schedule_employees as roster where roster.schedule_id = p_schedule_id
  )
  order by employee.id
  for share;

  -- A missing or mistyped list would read as an empty set below, so the shape is checked first. coalesce, because
  -- jsonb_typeof of a missing key is null and a null condition would let the call through.
  if coalesce(jsonb_typeof(p_inputs -> 'staffing'), '') <> 'array'
    or coalesce(jsonb_typeof(p_inputs -> 'employeeIds'), '') <> 'array'
    or coalesce(jsonb_typeof(p_inputs -> 'assignments'), '') <> 'array'
    or coalesce(jsonb_typeof(p_inputs -> 'shifts'), '') <> 'array'
    or coalesce(jsonb_typeof(p_inputs -> 'employees'), '') <> 'array'
    or coalesce(jsonb_typeof(p_inputs -> 'absences'), '') <> 'array'
    or coalesce(jsonb_typeof(p_violations), '') <> 'array'
    or coalesce(jsonb_typeof(p_confirmed_keys), '') <> 'array'
    or coalesce(jsonb_typeof(p_workload), '') <> 'array'
  then
    raise sqlstate 'PT422' using message = 'Approval arguments are not valid';
  end if;

  -- Each set of the payload against the live rows, both ways (except all, so that a repeated row counts too).
  if (p_inputs ->> 'startDate') is distinct from to_char(v_start_date, 'YYYY-MM-DD')
    or exists (
      with live as (
        select staffing.shift_id, staffing.day_offset, staffing.required_count
        from public.schedule_staffing as staffing
        where staffing.schedule_id = p_schedule_id
      ),
      seen as (
        select item."shiftId", item."dayOffset", item."requiredCount"
        from jsonb_to_recordset(p_inputs -> 'staffing')
          as item ("shiftId" uuid, "dayOffset" smallint, "requiredCount" smallint)
      )
      (select * from live except all select * from seen)
      union all
      (select * from seen except all select * from live)
    )
    or exists (
      with live as (
        select roster.employee_id
        from public.schedule_employees as roster
        where roster.schedule_id = p_schedule_id
      ),
      seen as (
        select item.value::uuid from jsonb_array_elements_text(p_inputs -> 'employeeIds') as item (value)
      )
      (select * from live except all select * from seen)
      union all
      (select * from seen except all select * from live)
    )
    or exists (
      with live as (
        select assignment.shift_id, assignment.day_offset, assignment.employee_id
        from public.schedule_assignments as assignment
        where assignment.schedule_id = p_schedule_id
      ),
      seen as (
        select item."shiftId", item."dayOffset", item."employeeId"
        from jsonb_to_recordset(p_inputs -> 'assignments')
          as item ("shiftId" uuid, "dayOffset" smallint, "employeeId" uuid)
      )
      (select * from live except all select * from seen)
      union all
      (select * from seen except all select * from live)
    )
    or exists (
      with live as (
        select shift.id, shift.name, shift.start_minute, shift.end_minute
        from public.shifts as shift
        where shift.id in (
          select staffing.shift_id from public.schedule_staffing as staffing where staffing.schedule_id = p_schedule_id
        )
      ),
      seen as (
        select item.id, item.name, item."startMinute", item."endMinute"
        from jsonb_to_recordset(p_inputs -> 'shifts')
          as item (id uuid, name text, "startMinute" smallint, "endMinute" smallint)
      )
      (select * from live except all select * from seen)
      union all
      (select * from seen except all select * from live)
    )
    or exists (
      with live as (
        select employee.id, employee.last_name || ' ' || employee.first_name as name,
          employee.fte_numerator, employee.fte_denominator
        from public.employees as employee
        where employee.id in (
          select roster.employee_id from public.schedule_employees as roster where roster.schedule_id = p_schedule_id
        )
      ),
      seen as (
        select (item.value ->> 'id')::uuid, item.value ->> 'name',
          (item.value -> 'fte' ->> 'numerator')::smallint, (item.value -> 'fte' ->> 'denominator')::smallint
        from jsonb_array_elements(p_inputs -> 'employees') as item (value)
      )
      (select * from live except all select * from seen)
      union all
      (select * from seen except all select * from live)
    )
    or exists (
      -- The window of the app: the seven days and the day after them, which a night shift of the last day runs into.
      with live as (
        select absence.employee_id, absence.type, absence.status, absence.start_date, absence.end_date
        from public.absences as absence
        where absence.employee_id in (
            select roster.employee_id from public.schedule_employees as roster where roster.schedule_id = p_schedule_id
          )
          and absence.start_date <= v_start_date + 7
          and absence.end_date >= v_start_date
      ),
      seen as (
        select item."employeeId", item.type, item.status, item."startDate", item."endDate"
        from jsonb_to_recordset(p_inputs -> 'absences')
          as item ("employeeId" uuid, type text, status text, "startDate" date, "endDate" date)
      )
      (select * from live except all select * from seen)
      union all
      (select * from seen except all select * from live)
    )
  then
    raise sqlstate 'PT412' using message = 'Schedule data has changed';
  end if;

  -- Only warnings are acceptable, each of them confirmed.
  if exists (
    select 1
    from jsonb_array_elements(p_violations) as item (value)
    where (item.value ->> 'severity') is distinct from 'warning'
      or (item.value ->> 'key') is null
      or not (p_confirmed_keys ? (item.value ->> 'key'))
  ) then
    raise sqlstate 'PT422' using message = 'Findings do not allow an approval';
  end if;

  -- The hours of every person of the roster, once.
  if exists (
      with roster_ids as (
        select roster.employee_id
        from public.schedule_employees as roster
        where roster.schedule_id = p_schedule_id
      ),
      hours_ids as (
        select item."employeeId"
        from jsonb_to_recordset(p_workload) as item ("employeeId" uuid)
      )
      (select * from roster_ids except all select * from hours_ids)
      union all
      (select * from hours_ids except all select * from roster_ids)
    )
    or exists (
      select 1
      from jsonb_to_recordset(p_workload) as item ("workedMinutes" integer, "normMinutes" integer)
      where item."workedMinutes" is null or item."workedMinutes" < 0
        or item."normMinutes" is null or item."normMinutes" < 0
    )
  then
    raise sqlstate 'PT422' using message = 'Hours do not match the roster';
  end if;

  insert into public.schedule_approvals (
    schedule_id, approved_by, approved_by_email, violations, confirmed_keys, critical_count, warning_count
  )
  values (
    p_schedule_id, auth.uid(), coalesce(auth.jwt() ->> 'email', ''), p_violations, p_confirmed_keys,
    0, jsonb_array_length(p_violations)
  )
  returning approved_at into v_approved_at;

  insert into public.schedule_approval_shifts (schedule_id, shift_id, name, start_minute, end_minute)
  select p_schedule_id, shift.id, shift.name, shift.start_minute, shift.end_minute
  from public.shifts as shift
  where shift.id in (
    select staffing.shift_id from public.schedule_staffing as staffing where staffing.schedule_id = p_schedule_id
  );

  insert into public.schedule_approval_employees (
    schedule_id, employee_id, display_name, fte_numerator, fte_denominator, worked_minutes, norm_minutes
  )
  select p_schedule_id, employee.id, employee.last_name || ' ' || employee.first_name, employee.fte_numerator,
    employee.fte_denominator, hours."workedMinutes", hours."normMinutes"
  from public.schedule_employees as roster
  join public.employees as employee on employee.id = roster.employee_id
  join jsonb_to_recordset(p_workload) as hours ("employeeId" uuid, "workedMinutes" integer, "normMinutes" integer)
    on hours."employeeId" = roster.employee_id
  where roster.schedule_id = p_schedule_id;

  update public.schedules set status = 'approved' where id = p_schedule_id;

  return v_approved_at;
end;
$$;

-- non-obvious: PostgreSQL grants execute on a new function to PUBLIC by default, and PostgREST exposes it as an RPC.
revoke execute on function public.approve_schedule(uuid, jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.approve_schedule(uuid, jsonb, jsonb, jsonb, jsonb) to authenticated;

-- The list gets the status and the time of the approval, added at the end (create or replace allows no other change).
-- non-obvious: the option is given again, because create or replace resets the options of a view to the ones it lists, and
-- without security_invoker the view would bypass row level security.
create or replace view public.schedule_summaries
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
  )::int as total_required,
  schedule.status,
  (
    select approval.approved_at
    from public.schedule_approvals as approval
    where approval.schedule_id = schedule.id
  ) as approved_at
from public.schedules as schedule;
