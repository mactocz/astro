-- Manual shift assignment (S-04). An assignment puts one employee on one shift on one day of a schedule. The day is a
-- day_offset like in schedule_staffing, and the pair of shift and day is the cell of the staffing grid, so a row is unique
-- per schedule, shift, day and person. One person may hold several shifts on a day: whether that is allowed is a work-time
-- rule for S-05, not a property of the table.
-- Both relations are composite foreign keys to tables of S-03 whose primary keys have exactly those columns, so the
-- database itself refuses an assignment in a cell without staffing (a required count of 0 has no row) and one for a person
-- outside the roster of the schedule. on delete cascade removes the assignments of a cell or a person that leaves the
-- schedule. There is no foreign key to schedules, shifts or employees: the rows hang on the staffing and the roster, which
-- cascade from the schedule and restrict the deletion of a shift or an employee that a schedule uses.
-- source tells an entry made by hand from a generated one. S-04 writes only 'manual' (the column default); the value
-- 'generated' is reserved for S-09, so that a generator can leave what the planner assigned alone.
create table public.schedule_assignments (
  schedule_id uuid not null,
  shift_id uuid not null,
  day_offset smallint not null,
  employee_id uuid not null,
  source text not null default 'manual',
  primary key (schedule_id, shift_id, day_offset, employee_id),
  constraint schedule_assignments_cell_fkey foreign key (schedule_id, shift_id, day_offset)
    references public.schedule_staffing (schedule_id, shift_id, day_offset) on delete cascade,
  constraint schedule_assignments_employee_fkey foreign key (schedule_id, employee_id)
    references public.schedule_employees (schedule_id, employee_id) on delete cascade,
  constraint schedule_assignments_source_valid check (source in ('manual', 'generated'))
);

-- Serves the foreign key to the roster and the lookup of everything one person has in a schedule; the start of the
-- primary key (schedule_id, shift_id, day_offset) already serves the foreign key to the cell.
create index schedule_assignments_employee_idx on public.schedule_assignments (schedule_id, employee_id);

alter table public.schedule_assignments enable row level security;

-- Planner only. Employees get no policy: they read the approved schedule in S-11, not the drafts.
create policy "planner can select schedule_assignments" on public.schedule_assignments
  for select to authenticated using ((select public.is_planner()));
create policy "planner can insert schedule_assignments" on public.schedule_assignments
  for insert to authenticated with check ((select public.is_planner()));
create policy "planner can delete schedule_assignments" on public.schedule_assignments
  for delete to authenticated using ((select public.is_planner()));

-- non-obvious: Supabase default privileges give anon and authenticated every right on a new public table
revoke all on table public.schedule_assignments from anon, authenticated;
grant select, insert, delete on table public.schedule_assignments to authenticated;

-- non-obvious: no update policy and no update grant, on purpose. An entry is identified by its key, so correcting one means
-- removing it and adding another. S-09 adds an update of source in a migration of its own when it needs one. The delete
-- policy and grant above are for removing a single entry; the cascades of the foreign keys do not depend on them, because
-- the database runs referential actions without row level security and without the privileges of the caller.

-- non-obvious: S-03 gave schedule_staffing no update, because a save replaced the whole grid. save_schedule below now
-- changes the required count of an existing cell in place: deleting and inserting the cell again would cascade away its
-- assignments. The grant covers that one column only, so the shift and the day, which identify a cell, stay unchangeable;
-- the grant is on the column, not the table, because a table-level update would cover every column added later.
create policy "planner can update schedule_staffing" on public.schedule_staffing
  for update to authenticated using ((select public.is_planner())) with check ((select public.is_planner()));

grant update (required_count) on table public.schedule_staffing to authenticated;

-- Saves a whole schedule in one transaction, because PostgREST writes one table per request and nobody may delete the
-- header to undo a half-finished save. The save is a diff since S-04: the S-03 wording that it replaces the whole grid and
-- the whole roster no longer holds, because deleting every row and inserting it again would cascade away the assignments
-- on each save. p_schedule_id null creates the schedule from the grid and the roster. Otherwise the function changes the
-- start date and label, deletes only the cells and people that are not in the new lists, inserts the new ones and sets the
-- required count of the cells that stay; a person that stays is left alone. p_staffing is an array of
-- { shiftId, dayOffset, requiredCount } and p_employee_ids an array of employee ids, both already validated by the app.
-- A violated constraint or foreign key aborts the whole call, so either everything is saved or nothing.
-- Deleting a cell or a person deletes their assignments. Before anything is deleted the function counts the assignments of
-- the schedule that would vanish (those in a cell outside p_staffing or of a person outside p_employee_ids, each counted
-- once). When there are any and p_confirm_removals is not true (null counts as false), it raises the SQLSTATE PT409 with the
-- message 'Assignments would be removed' and the count as text in detail, which rolls the whole call back, the header
-- update included. PostgREST maps PT409 to HTTP status 409 and returns the detail as details. The caller has to ask again
-- with p_confirm_removals = true. All six parameters are required: the function has no default arguments.
-- The function is security invoker, so the policies of the caller apply: for anyone but a planner the update touches no row
-- and the call ends in the same 404 as an id that does not exist, before anything is counted or deleted. Returns the id of
-- the schedule.
-- Replacing the S-03 signature needs a drop: create or replace cannot change a parameter list, and a second overload would
-- make a call by name ambiguous for PostgREST.
drop function public.save_schedule(uuid, date, text, jsonb, jsonb);

create function public.save_schedule(
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

    -- The SQLSTATE PT404 is mapped by PostgREST to HTTP status 404.
    if v_schedule_id is null then
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
  -- update that the column grant above allows.
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

-- non-obvious: PostgreSQL grants execute on a new function to PUBLIC by default, and PostgREST exposes every function
-- of the public schema as an RPC endpoint, so the grant is narrowed to signed-in users explicitly (the policies would
-- stop an outsider anyway, but a function should not be callable by roles that never use it). The drop above removed the
-- grants of the old signature, so they are made again for the new one.
revoke execute on function public.save_schedule(uuid, date, text, jsonb, jsonb, boolean) from public, anon;
grant execute on function public.save_schedule(uuid, date, text, jsonb, jsonb, boolean) to authenticated;

-- S-05 reads the assignments to judge them (shortage, surplus, collisions, rest, hour limits), S-07 to refuse a person on
-- leave, S-08 copies them into the approved schedule, and S-09 writes generated entries with source = 'generated'.
