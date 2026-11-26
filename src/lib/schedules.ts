import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { isUuid, logDatabaseError } from "@/lib/postgrest";
import { classifySaveFailure, compareCells, compareText, sortSchedules } from "@/lib/services/schedule";
import type { Schedule, ScheduleInput, ScheduleSummary } from "@/types";

// The only module that knows the table and column names of a schedule. Every function runs on the client it is given,
// i.e. on the signed-in user's session, so row-level security decides what is visible and writable. The list reads the
// view schedule_summaries (security invoker, so the policies of the tables under it apply), which holds one flat row per
// schedule with the number of its employees and the sum of its required counts already worked out by the database. It is
// read newest first and cut at SCHEDULE_LIST_LIMIT rows, so a long list never reaches the response limit of PostgREST,
// which would drop rows without a word.
const LIST_SELECT = "id, start_date, label, created_at, employee_count, total_required";
const DETAIL_SELECT =
  "id, start_date, label, created_at, schedule_staffing(shift_id, day_offset, required_count), schedule_employees(employee_id)";

/** The most schedules the list shows; older ones are left out and the page says so. */
export const SCHEDULE_LIST_LIMIT = 100;

interface ScheduleSummaryRow {
  id: string;
  start_date: string;
  label: string | null;
  created_at: string;
  employee_count: number;
  total_required: number;
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

function toSummaries(data: unknown): ScheduleSummary[] {
  return (data as ScheduleSummaryRow[]).map((row) => ({
    id: row.id,
    startDate: row.start_date,
    label: row.label,
    createdAt: row.created_at,
    employeeCount: row.employee_count,
    totalRequired: row.total_required,
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
  // What the code and the details of the error mean is decided by classifySaveFailure; only a failure it does not know is
  // logged.
  const failure = classifySaveFailure(error.code, error.details);
  switch (failure.kind) {
    case "not_found":
      return { ok: false, error: "not_found" };
    case "unknown_reference":
      return { ok: false, error: "unknown_reference" };
    case "removal_unconfirmed":
      return { ok: false, error: "removal_unconfirmed", removed: failure.removed };
    case "failed":
      logDatabaseError("schedules", "save", error);
      return { ok: false, error: "failed" };
  }
}

/**
 * The newest schedules the session may see (at most `SCHEDULE_LIST_LIMIT`) with their number of employees and their
 * total required staffing, ordered by `sortSchedules`; `truncated` is true when older ones were left out. Throws when the
 * database fails.
 */
export async function listSchedules(
  supabase: SupabaseClient,
): Promise<{ schedules: ScheduleSummary[]; truncated: boolean }> {
  // One row more than the limit tells whether there is anything beyond it.
  const response = await supabase
    .from("schedule_summaries")
    .select(LIST_SELECT)
    .order("start_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(SCHEDULE_LIST_LIMIT + 1);
  if (response.error) {
    throw readFailure("list", response.error);
  }
  const summaries = toSummaries(response.data);
  return {
    schedules: sortSchedules(summaries.slice(0, SCHEDULE_LIST_LIMIT)),
    truncated: summaries.length > SCHEDULE_LIST_LIMIT,
  };
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
