import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { isUuid, logDatabaseError } from "@/lib/postgrest";
import { sortAssignments } from "@/lib/services/assignment";
import type { Assignment, AssignmentInput, AssignmentSource } from "@/types";

// The only module that knows the table and column names of the assignments, and it holds no business rule. Every function
// runs on the client it is given, i.e. on the signed-in user's session, so row-level security decides what is visible and
// writable.
const TABLE = "schedule_assignments";
const COLUMNS = "shift_id, day_offset, employee_id, source";
// The columns of the primary key: the identity of an assignment, and so the conflict target of an add.
const KEY_COLUMNS = "schedule_id,shift_id,day_offset,employee_id";
// The most rows PostgREST answers with (`max_rows` in supabase/config.toml). It cuts a longer answer off without saying so,
// so a read that reaches this many rows may be a truncated one and is refused: whoever judges the assignments (the rules of
// S-05) would otherwise judge an incomplete set.
const READ_LIMIT = 1000;
// A cell without staffing or a person outside the roster of the schedule is the only foreign key an add can break, and a
// schedule that does not exist breaks both.
const FOREIGN_KEY_VIOLATION = "23503";

interface AssignmentRow {
  shift_id: string;
  day_offset: number;
  employee_id: string;
  source: AssignmentSource;
}

type WriteResult<Failure extends string> = { ok: true } | { ok: false; error: Failure };
export type AddAssignmentResult = WriteResult<"unknown_reference" | "failed">;
export type RemoveAssignmentResult = WriteResult<"failed">;

function toAssignments(data: unknown): Assignment[] {
  return (data as AssignmentRow[]).map((row) => ({
    shiftId: row.shift_id,
    dayOffset: row.day_offset,
    employeeId: row.employee_id,
    source: row.source,
  }));
}

function readFailure(action: string, error: PostgrestError): Error {
  logDatabaseError("assignments", action, error);
  return new Error(`Reading assignments failed (${action}).`);
}

function writeFailure(action: string, error: PostgrestError): { ok: false; error: "failed" } {
  logDatabaseError("assignments", action, error);
  return { ok: false, error: "failed" };
}

/**
 * Every assignment of the schedule that the session may see, ordered by `sortAssignments`; an empty list for an id that is
 * not a UUID (no query is made). Throws when the database fails, and when the answer is as long as the read limit of 1000
 * rows, because it may then be cut off.
 */
export async function listAssignments(supabase: SupabaseClient, scheduleId: string): Promise<Assignment[]> {
  if (!isUuid(scheduleId)) {
    return [];
  }
  const { data, error } = await supabase.from(TABLE).select(COLUMNS).eq("schedule_id", scheduleId);
  if (error) {
    throw readFailure("list", error);
  }
  const assignments = toAssignments(data);
  if (assignments.length >= READ_LIMIT) {
    throw new Error(`Reading assignments failed (list): the answer reached the read limit of ${READ_LIMIT} rows.`);
  }
  return sortAssignments(assignments);
}

/**
 * The number of assignments of the schedule that the session may see, counted by the database without reading the rows; 0
 * for an id that is not a UUID. Throws when the database fails.
 */
export async function countAssignments(supabase: SupabaseClient, scheduleId: string): Promise<number> {
  if (!isUuid(scheduleId)) {
    return 0;
  }
  const { count, error } = await supabase
    .from(TABLE)
    .select("shift_id", { count: "exact", head: true })
    .eq("schedule_id", scheduleId);
  if (error) {
    throw readFailure("count", error);
  }
  return count ?? 0;
}

/**
 * Puts the employee on the shift on that day of the schedule (the input is already validated and normalised). Adding what
 * is already there is not an error and changes nothing. The entry is a manual one: `source` is not sent, the column
 * defaults to `manual`. `unknown_reference` when the cell has no staffing (any more), the person is not in the roster of
 * the schedule or the schedule does not exist.
 */
export async function addAssignment(
  supabase: SupabaseClient,
  scheduleId: string,
  input: AssignmentInput,
): Promise<AddAssignmentResult> {
  // ignoreDuplicates makes PostgREST write INSERT ... ON CONFLICT DO NOTHING, which needs no update privilege (the planner
  // has none on this table).
  const { error } = await supabase.from(TABLE).upsert(
    {
      schedule_id: scheduleId,
      shift_id: input.shiftId,
      day_offset: input.dayOffset,
      employee_id: input.employeeId,
    },
    { onConflict: KEY_COLUMNS, ignoreDuplicates: true },
  );
  if (error) {
    return error.code === FOREIGN_KEY_VIOLATION
      ? { ok: false, error: "unknown_reference" }
      : writeFailure("add", error);
  }
  return { ok: true };
}

/**
 * Takes the employee off the shift on that day of the schedule, by the whole key. Removing what is not there is not an
 * error.
 */
export async function removeAssignment(
  supabase: SupabaseClient,
  scheduleId: string,
  input: AssignmentInput,
): Promise<RemoveAssignmentResult> {
  const { error } = await supabase
    .from(TABLE)
    .delete()
    .eq("schedule_id", scheduleId)
    .eq("shift_id", input.shiftId)
    .eq("day_offset", input.dayOffset)
    .eq("employee_id", input.employeeId);
  if (error) {
    return writeFailure("remove", error);
  }
  return { ok: true };
}
