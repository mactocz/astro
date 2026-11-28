import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { assertExactCount, isUuid, logDatabaseError } from "@/lib/postgrest";
import { isScheduleApproved } from "@/lib/schedules";
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
// A policy turned the row down: for a planner that is an approved schedule (S-08).
const PERMISSION_DENIED = "42501";

interface AssignmentRow {
  shift_id: string;
  day_offset: number;
  employee_id: string;
  source: AssignmentSource;
}

type WriteResult<Failure extends string> = { ok: true } | { ok: false; error: Failure };
type AddFailure = "unknown_reference" | "schedule_approved" | "failed";
export type AddAssignmentResult = WriteResult<AddFailure>;
export type RemoveAssignmentResult = WriteResult<"schedule_approved" | "failed">;
export type AddGeneratedResult = { ok: true; added: number } | { ok: false; error: AddFailure };
export type RemoveGeneratedResult =
  { ok: true; removed: number } | { ok: false; error: "schedule_approved" | "failed" };

// The source of an entry the generator has proposed (S-09).
const GENERATED: AssignmentSource = "generated";

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

// Why the database refused an insert.
async function insertFailure(
  supabase: SupabaseClient,
  scheduleId: string,
  action: string,
  error: PostgrestError,
): Promise<{ ok: false; error: AddFailure }> {
  if (error.code === FOREIGN_KEY_VIOLATION) {
    return { ok: false, error: "unknown_reference" };
  }
  if (error.code === PERMISSION_DENIED && (await isScheduleApproved(supabase, scheduleId))) {
    return { ok: false, error: "schedule_approved" };
  }
  return writeFailure(action, error);
}

function toRow(scheduleId: string, { shiftId, dayOffset, employeeId }: AssignmentInput) {
  return { schedule_id: scheduleId, shift_id: shiftId, day_offset: dayOffset, employee_id: employeeId };
}

/**
 * Every assignment of the schedule that the session may see, ordered by `sortAssignments`; an empty list for an id that is
 * not a UUID (no query is made). Throws when the database fails, when the answer is shorter than the exact count the
 * database gives with it, and when it is as long as the read limit of 1000 rows, because it may then be cut off.
 */
export async function listAssignments(supabase: SupabaseClient, scheduleId: string): Promise<Assignment[]> {
  if (!isUuid(scheduleId)) {
    return [];
  }
  const { data, error, count } = await supabase
    .from(TABLE)
    .select(COLUMNS, { count: "exact" })
    .eq("schedule_id", scheduleId);
  if (error) {
    throw readFailure("list", error);
  }
  const assignments = toAssignments(data);
  assertExactCount("assignments", assignments.length, count, "list");
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
 * the schedule or the schedule does not exist; `schedule_approved` when the schedule is approved and so locked.
 */
export async function addAssignment(
  supabase: SupabaseClient,
  scheduleId: string,
  input: AssignmentInput,
): Promise<AddAssignmentResult> {
  // ignoreDuplicates makes PostgREST write INSERT ... ON CONFLICT DO NOTHING, which needs no update privilege (the planner
  // has none on this table).
  const { error } = await supabase
    .from(TABLE)
    .upsert(toRow(scheduleId, input), { onConflict: KEY_COLUMNS, ignoreDuplicates: true });
  if (error) {
    return insertFailure(supabase, scheduleId, "add", error);
  }
  return { ok: true };
}

/**
 * Adds the proposed assignments (the input is already validated and normalised) with the source `generated`, in one
 * statement, so either all of them are stored or none. What is already there, a manual entry too, is left as it is.
 * `added` is the number of new entries, counted by the database without reading the rows back, so `max_rows` does not cap
 * it. `unknown_reference` and `schedule_approved` as for `addAssignment`.
 */
export async function addGeneratedAssignments(
  supabase: SupabaseClient,
  scheduleId: string,
  list: readonly AssignmentInput[],
): Promise<AddGeneratedResult> {
  const { error, count } = await supabase.from(TABLE).upsert(
    list.map((input) => ({ ...toRow(scheduleId, input), source: GENERATED })),
    { onConflict: KEY_COLUMNS, ignoreDuplicates: true, count: "exact" },
  );
  if (error) {
    return insertFailure(supabase, scheduleId, "add generated", error);
  }
  return { ok: true, added: count ?? 0 };
}

/**
 * Takes every assignment with the source `generated` off the schedule, in one statement; the manual ones stay. `removed`
 * is the number of entries, counted by the database. Removing when there is none is not an error; `schedule_approved`
 * when the schedule is approved and so locked.
 */
export async function removeGeneratedAssignments(
  supabase: SupabaseClient,
  scheduleId: string,
): Promise<RemoveGeneratedResult> {
  const { error, count } = await supabase
    .from(TABLE)
    .delete({ count: "exact" })
    .eq("schedule_id", scheduleId)
    .eq("source", GENERATED);
  if (error) {
    return writeFailure("remove generated", error);
  }
  const removed = count ?? 0;
  // As in `removeAssignment`: a delete the policy of an approved schedule turned into a no-op raises no error.
  if (removed === 0 && (await isScheduleApproved(supabase, scheduleId))) {
    return { ok: false, error: "schedule_approved" };
  }
  return { ok: true, removed };
}

/**
 * Takes the employee off the shift on that day of the schedule, by the whole key. Removing what is not there is not an
 * error; `schedule_approved` when the schedule is approved and so locked.
 */
export async function removeAssignment(
  supabase: SupabaseClient,
  scheduleId: string,
  input: AssignmentInput,
): Promise<RemoveAssignmentResult> {
  // The deleted rows come back: the policy of an approved schedule turns a delete into a no-op without an error, so no
  // row means either that there was nothing to remove or that the schedule is locked.
  const { data, error } = await supabase
    .from(TABLE)
    .delete()
    .eq("schedule_id", scheduleId)
    .eq("shift_id", input.shiftId)
    .eq("day_offset", input.dayOffset)
    .eq("employee_id", input.employeeId)
    .select("shift_id");
  if (error) {
    return writeFailure("remove", error);
  }
  if (data.length === 0 && (await isScheduleApproved(supabase, scheduleId))) {
    return { ok: false, error: "schedule_approved" };
  }
  return { ok: true };
}
