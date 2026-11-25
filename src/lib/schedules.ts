import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { isUuid, logDatabaseError } from "@/lib/postgrest";
import { sortSchedules, totalRequired } from "@/lib/services/schedule";
import type { Schedule, ScheduleInput, ScheduleSummary, StaffingCell } from "@/types";

// The only module that knows the table and column names of a schedule. Every function runs on the client it is given,
// i.e. on the signed-in user's session, so row-level security decides what is visible and writable. The list asks for
// the number of employees as an embedded count and for the required counts of the grid, which the app adds up.
const LIST_SELECT = "id, start_date, label, created_at, schedule_employees(count), schedule_staffing(required_count)";
const DETAIL_SELECT =
  "id, start_date, label, created_at, schedule_staffing(shift_id, day_offset, required_count), schedule_employees(employee_id)";
// PostgREST turns the SQLSTATE PT404 that save_schedule raises for a missing schedule into HTTP 404 and keeps the code.
const NOT_FOUND = "PT404";
// A shift or an employee that does not exist (any more) is the only foreign key a save can break.
const FOREIGN_KEY_VIOLATION = "23503";
// The SQLSTATE PT409 that save_schedule raises when a save would remove assignments and was not confirmed; PostgREST turns
// it into HTTP 409 and returns the number of assignments, as text, in `details`.
const REMOVAL_UNCONFIRMED = "PT409";

interface ScheduleListRow {
  id: string;
  start_date: string;
  label: string | null;
  created_at: string;
  schedule_employees: { count: number }[];
  schedule_staffing: { required_count: number }[];
}

interface ScheduleRow {
  id: string;
  start_date: string;
  label: string | null;
  created_at: string;
  schedule_staffing: { shift_id: string; day_offset: number; required_count: number }[];
  schedule_employees: { employee_id: string }[];
}

type SaveFailure = "not_found" | "unknown_reference" | "failed";
// removal_unconfirmed carries the number of assignments the save would have removed, so it is a variant of its own.
interface RemovalUnconfirmed {
  ok: false;
  error: "removal_unconfirmed";
  removed: number;
}
export type SaveScheduleResult = { ok: true; id: string } | { ok: false; error: SaveFailure } | RemovalUnconfirmed;

// Plain code-unit order, the one validateScheduleInput sorts by, so a stored schedule reads back in the same order as a
// validated one.
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareCells(a: StaffingCell, b: StaffingCell): number {
  return compareText(a.shiftId, b.shiftId) || a.dayOffset - b.dayOffset;
}

function toSummaries(data: unknown): ScheduleSummary[] {
  return (data as ScheduleListRow[]).map((row) => ({
    id: row.id,
    startDate: row.start_date,
    label: row.label,
    createdAt: row.created_at,
    // An embedded count is a one-element list, even for a schedule without people.
    employeeCount: row.schedule_employees.at(0)?.count ?? 0,
    totalRequired: totalRequired(row.schedule_staffing.map((cell) => ({ requiredCount: cell.required_count }))),
  }));
}

function toSchedules(data: unknown): Schedule[] {
  return (data as ScheduleRow[]).map((row) => ({
    id: row.id,
    startDate: row.start_date,
    label: row.label,
    createdAt: row.created_at,
    staffing: row.schedule_staffing
      .map((cell) => ({ shiftId: cell.shift_id, dayOffset: cell.day_offset, requiredCount: cell.required_count }))
      .sort(compareCells),
    employeeIds: row.schedule_employees.map((person) => person.employee_id).sort(compareText),
  }));
}

function readFailure(action: string, error: PostgrestError): Error {
  logDatabaseError("schedules", action, error);
  return new Error(`Reading schedules failed (${action}).`);
}

function saveFailure(error: PostgrestError): { ok: false; error: SaveFailure } | RemovalUnconfirmed {
  if (error.code === NOT_FOUND) {
    return { ok: false, error: "not_found" };
  }
  if (error.code === FOREIGN_KEY_VIOLATION) {
    return { ok: false, error: "unknown_reference" };
  }
  if (error.code === REMOVAL_UNCONFIRMED) {
    const removed = Number.parseInt(error.details, 10);
    // A count that cannot be read cannot be shown to the planner to confirm, so it is a failure like any other.
    if (!Number.isNaN(removed) && removed >= 1) {
      return { ok: false, error: "removal_unconfirmed", removed };
    }
  }
  logDatabaseError("schedules", "save", error);
  return { ok: false, error: "failed" };
}

/**
 * Every schedule the session may see with its number of employees and its total required staffing, ordered by
 * `sortSchedules`. Throws when the database fails.
 */
export async function listSchedules(supabase: SupabaseClient): Promise<ScheduleSummary[]> {
  const response = await supabase.from("schedules").select(LIST_SELECT);
  if (response.error) {
    throw readFailure("list", response.error);
  }
  return sortSchedules(toSummaries(response.data));
}

/**
 * The schedule with its grid and its employees, or null when there is none visible with this id (also for an id that is
 * not a UUID). Throws when the database fails.
 */
export async function getSchedule(supabase: SupabaseClient, id: string): Promise<Schedule | null> {
  if (!isUuid(id)) {
    return null;
  }
  const response = await supabase.from("schedules").select(DETAIL_SELECT).eq("id", id);
  if (response.error) {
    throw readFailure("get", response.error);
  }
  return toSchedules(response.data).at(0) ?? null;
}

/**
 * Stores a schedule (the input is already validated and normalised) in one transaction through the `save_schedule`
 * function: a new one for an `id` of null, otherwise it changes the date and the label of that schedule and brings its
 * grid and its employees to the input, keeping the assignments of every cell and person that stays. `not_found` when no
 * schedule is visible with this id (missing, or hidden by RLS); `unknown_reference` when a shift or an employee of the
 * input does not exist; `removal_unconfirmed`, with the number of assignments concerned, when the save would remove a cell
 * or a person that has assignments and `confirmRemoval` is not true (it is meant for the second attempt, after the planner
 * was told that number). Either way nothing is stored.
 */
export async function saveSchedule(
  supabase: SupabaseClient,
  id: string | null,
  input: ScheduleInput,
  confirmRemoval = false,
): Promise<SaveScheduleResult> {
  if (id !== null && !isUuid(id)) {
    return { ok: false, error: "not_found" };
  }
  // The function has no default arguments, so all six are always sent, the schedule id too (null creates).
  const response = await supabase.rpc("save_schedule", {
    p_schedule_id: id,
    p_start_date: input.startDate,
    p_label: input.label,
    p_staffing: input.staffing.map(({ shiftId, dayOffset, requiredCount }) => ({ shiftId, dayOffset, requiredCount })),
    p_employee_ids: input.employeeIds,
    p_confirm_removals: confirmRemoval,
  });
  if (response.error) {
    return saveFailure(response.error);
  }
  // A function that returns a single uuid answers with a JSON string.
  const savedId: unknown = response.data;
  return typeof savedId === "string" ? { ok: true, id: savedId } : { ok: false, error: "failed" };
}
