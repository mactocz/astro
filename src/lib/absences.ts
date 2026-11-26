import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { isUuid, logDatabaseError } from "@/lib/postgrest";
import { sortAbsences } from "@/lib/services/absence";
import type { Absence, AbsenceInput, AbsenceStatus, AbsenceType } from "@/types";

// The only module that knows the table and column names of the absences, and it holds no business rule. Every function runs
// on the client it is given, i.e. on the signed-in user's session, so row-level security decides what is visible and
// writable (a planner only). A session may write only `employee_id`, `type`, `start_date` and `end_date` on an insert and
// `type`, `start_date` and `end_date` on an update: `status` is never sent (the column defaults to `approved` and no
// session has a grant on it), and the person of an absence does not change.
const TABLE = "absences";
const COLUMNS = "id, employee_id, type, status, start_date, end_date, created_at";
// The most rows PostgREST answers with (`max_rows` in supabase/config.toml). It cuts a longer answer off without saying so,
// so a read that reaches this many rows may be a truncated one and is refused: whoever judges the absences (the rules and
// the norm) would otherwise judge an incomplete set.
const READ_LIMIT = 1000;
// The only foreign key an insert can break is the one to the employee.
const FOREIGN_KEY_VIOLATION = "23503";

interface AbsenceRow {
  id: string;
  employee_id: string;
  type: AbsenceType;
  status: AbsenceStatus;
  start_date: string;
  end_date: string;
  created_at: string;
}

type WriteResult<Failure extends string> = { ok: true; absence: Absence } | { ok: false; error: Failure };
export type CreateAbsenceResult = WriteResult<"unknown_reference" | "failed">;
export type UpdateAbsenceResult = WriteResult<"not_found" | "failed">;
export type DeleteAbsenceResult = { ok: true } | { ok: false; error: "not_found" | "failed" };

function toAbsences(data: unknown): Absence[] {
  return (data as AbsenceRow[]).map((row) => ({
    id: row.id,
    employeeId: row.employee_id,
    type: row.type,
    status: row.status,
    startDate: row.start_date,
    endDate: row.end_date,
    createdAt: row.created_at,
  }));
}

// The columns of a new absence. No status: the database sets `approved`.
function toInsertRow(input: AbsenceInput) {
  return {
    employee_id: input.employeeId,
    type: input.type,
    start_date: input.startDate,
    end_date: input.endDate,
  };
}

// The columns of a corrected absence: the person and the status are not among them, no session has a grant on either.
function toUpdateRow(input: Pick<AbsenceInput, "type" | "startDate" | "endDate">) {
  return {
    type: input.type,
    start_date: input.startDate,
    end_date: input.endDate,
  };
}

function readFailure(action: string, error: PostgrestError): Error {
  logDatabaseError("absences", action, error);
  return new Error(`Reading absences failed (${action}).`);
}

function writeFailure(action: string, error: PostgrestError): { ok: false; error: "failed" } {
  logDatabaseError("absences", action, error);
  return { ok: false, error: "failed" };
}

// The rows of a list read as absences, latest start first. An answer as long as the read limit may have been cut off, so it
// is an error and not a short list.
function toSortedAbsences(data: unknown, action: string): Absence[] {
  const absences = toAbsences(data);
  if (absences.length >= READ_LIMIT) {
    throw new Error(`Reading absences failed (${action}): the answer reached the read limit of ${READ_LIMIT} rows.`);
  }
  return sortAbsences(absences);
}

/**
 * Every absence the session may see, ordered by `sortAbsences`. Throws when the database fails, and when the answer is as
 * long as the read limit of 1000 rows, because it may then be cut off.
 */
export async function listAbsences(supabase: SupabaseClient): Promise<Absence[]> {
  const { data, error } = await supabase.from(TABLE).select(COLUMNS);
  if (error) {
    throw readFailure("list", error);
  }
  return toSortedAbsences(data, "list");
}

/**
 * Every absence the session may see that shares a day with the days `from` to `to` (`YYYY-MM-DD`, both included): it starts
 * on or before `to` and ends on or after `from`. These are the absences of every employee, so the caller keeps those of
 * the people it needs. Ordered by `sortAbsences`. Throws when the database fails, and when the answer is as long as the
 * read limit of 1000 rows, because it may then be cut off.
 */
export async function listAbsencesOverlapping(supabase: SupabaseClient, from: string, to: string): Promise<Absence[]> {
  const { data, error } = await supabase.from(TABLE).select(COLUMNS).lte("start_date", to).gte("end_date", from);
  if (error) {
    throw readFailure("overlapping", error);
  }
  return toSortedAbsences(data, "overlapping");
}

/** The absence, or null when there is none visible with this id (also for an id that is not a UUID). */
export async function getAbsence(supabase: SupabaseClient, id: string): Promise<Absence | null> {
  if (!isUuid(id)) {
    return null;
  }
  const { data, error } = await supabase.from(TABLE).select(COLUMNS).eq("id", id);
  if (error) {
    throw readFailure("get", error);
  }
  return toAbsences(data).at(0) ?? null;
}

/**
 * Stores a new absence (the input is already validated and normalised) and returns the stored row, which is `approved`.
 * `unknown_reference` when no employee has the id of the input.
 */
export async function createAbsence(supabase: SupabaseClient, input: AbsenceInput): Promise<CreateAbsenceResult> {
  const { data, error } = await supabase.from(TABLE).insert(toInsertRow(input)).select(COLUMNS);
  if (error) {
    return error.code === FOREIGN_KEY_VIOLATION
      ? { ok: false, error: "unknown_reference" }
      : writeFailure("create", error);
  }
  const absence = toAbsences(data).at(0);
  return absence ? { ok: true, absence } : { ok: false, error: "failed" };
}

/**
 * Changes the type and the two days of an absence and returns the stored row. The person and the status stay as they are
 * (the database gives a session no grant on either), so an `employeeId` in the input is ignored: moving an absence to
 * somebody else is removing it and adding another. `not_found` when no row is visible with this id (missing, or hidden by
 * RLS).
 */
export async function updateAbsence(
  supabase: SupabaseClient,
  id: string,
  input: Pick<AbsenceInput, "type" | "startDate" | "endDate">,
): Promise<UpdateAbsenceResult> {
  if (!isUuid(id)) {
    return { ok: false, error: "not_found" };
  }
  // The rows come back with the write: an update of a row that RLS hides, like one of a row that does not exist, changes
  // nothing and still answers without an error, so the returned rows are what tells the two outcomes from a change.
  const { data, error } = await supabase.from(TABLE).update(toUpdateRow(input)).eq("id", id).select(COLUMNS);
  if (error) {
    return writeFailure("update", error);
  }
  const absence = toAbsences(data).at(0);
  return absence ? { ok: true, absence } : { ok: false, error: "not_found" };
}

/**
 * Removes the absence. `not_found` when no row is visible with this id (missing, or hidden by RLS), so nothing was
 * removed.
 */
export async function deleteAbsence(supabase: SupabaseClient, id: string): Promise<DeleteAbsenceResult> {
  if (!isUuid(id)) {
    return { ok: false, error: "not_found" };
  }
  // As with the update, the deleted rows come back: a delete that RLS turns into a no-op answers without an error too.
  const { data, error } = await supabase.from(TABLE).delete().eq("id", id).select("id");
  if (error) {
    return writeFailure("delete", error);
  }
  return Array.isArray(data) && data.length > 0 ? { ok: true } : { ok: false, error: "not_found" };
}
