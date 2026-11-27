import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { isUuid, logDatabaseError } from "@/lib/postgrest";
import { sortEmployees } from "@/lib/services/employee";
import type { Employee, EmployeeInput } from "@/types";

// The only module that knows the column names of the employees table. Every function runs on the client it is given,
// i.e. on the signed-in user's session, so row-level security decides what is visible and writable. The exception is
// recordInvitation, which the invitation route calls with the service-role client.
const COLUMNS =
  "id, first_name, last_name, email, fte_numerator, fte_denominator, created_at, user_id, invited_at, activated_at";
// The e-mail is the only unique column besides the primary key, so this code always means a taken address.
const UNIQUE_VIOLATION = "23505";
// The trigger employees_keep_account_email refuses a new e-mail for an employee with an account.
const EMAIL_LOCKED = "PT409";

export const EMAIL_TAKEN_MESSAGE = "Ten adres e-mail jest już przypisany do innego pracownika.";

interface EmployeeRow {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  fte_numerator: number;
  fte_denominator: number;
  created_at: string;
  user_id: string | null;
  invited_at: string | null;
  activated_at: string | null;
}

type WriteResult<Failure extends string> = { ok: true; employee: Employee } | { ok: false; error: Failure };
export type CreateEmployeeResult = WriteResult<"email_taken" | "failed">;
export type UpdateEmployeeResult = WriteResult<"email_taken" | "email_locked" | "not_found" | "failed">;

function toEmployees(data: unknown): Employee[] {
  return (data as EmployeeRow[]).map((row) => ({
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    fte: { numerator: row.fte_numerator, denominator: row.fte_denominator },
    createdAt: row.created_at,
    userId: row.user_id,
    invitedAt: row.invited_at,
    activatedAt: row.activated_at,
  }));
}

// toRow never carries user_id or invited_at: the column grants close them to every session, so only recordInvitation
// writes them, with the service-role client. activated_at is closed the same way and is written by the SQL function
// mark_account_active(), which the set-password route calls.
function toRow(input: EmployeeInput) {
  return {
    first_name: input.firstName,
    last_name: input.lastName,
    email: input.email,
    fte_numerator: input.fte.numerator,
    fte_denominator: input.fte.denominator,
  };
}

function readFailure(action: string, error: PostgrestError): Error {
  logDatabaseError("employees", action, error);
  return new Error(`Reading employees failed (${action}).`);
}

function writeFailure(action: string, error: PostgrestError): { ok: false; error: "email_taken" | "failed" } {
  if (error.code === UNIQUE_VIOLATION) {
    return { ok: false, error: "email_taken" };
  }
  logDatabaseError("employees", action, error);
  return { ok: false, error: "failed" };
}

/** Every employee the session may see, ordered by `sortEmployees`. Throws when the database fails. */
export async function listEmployees(supabase: SupabaseClient): Promise<Employee[]> {
  const { data, error } = await supabase.from("employees").select(COLUMNS);
  if (error) {
    throw readFailure("list", error);
  }
  return sortEmployees(toEmployees(data));
}

/** The employee, or null when there is none visible with this id (also for an id that is not a UUID). */
export async function getEmployee(supabase: SupabaseClient, id: string): Promise<Employee | null> {
  if (!isUuid(id)) {
    return null;
  }
  const { data, error } = await supabase.from("employees").select(COLUMNS).eq("id", id);
  if (error) {
    throw readFailure("get", error);
  }
  return toEmployees(data).at(0) ?? null;
}

/** Stores a new employee (the input is already validated and normalised) and returns the stored row. */
export async function createEmployee(supabase: SupabaseClient, input: EmployeeInput): Promise<CreateEmployeeResult> {
  const { data, error } = await supabase.from("employees").insert(toRow(input)).select(COLUMNS);
  if (error) {
    return writeFailure("create", error);
  }
  const employee = toEmployees(data).at(0);
  return employee ? { ok: true, employee } : { ok: false, error: "failed" };
}

/** Replaces every field of an employee. `not_found` when no row is visible with this id (missing, or hidden by RLS). */
export async function updateEmployee(
  supabase: SupabaseClient,
  id: string,
  input: EmployeeInput,
): Promise<UpdateEmployeeResult> {
  if (!isUuid(id)) {
    return { ok: false, error: "not_found" };
  }
  const { data, error } = await supabase.from("employees").update(toRow(input)).eq("id", id).select(COLUMNS);
  if (error) {
    // The route checks first; this answers an invitation that linked an account between that check and the write.
    return error.code === EMAIL_LOCKED ? { ok: false, error: "email_locked" } : writeFailure("update", error);
  }
  const employee = toEmployees(data).at(0);
  return employee ? { ok: true, employee } : { ok: false, error: "not_found" };
}

/** The id of the employee linked to this Auth account, or null. Throws when the database fails. */
export async function findEmployeeIdByUserId(supabase: SupabaseClient, userId: string): Promise<string | null> {
  const { data, error } = await supabase.from("employees").select("id").eq("user_id", userId);
  if (error) {
    throw readFailure("find_by_user", error);
  }
  return (data as { id: string }[]).at(0)?.id ?? null;
}

/**
 * Stores the time of the latest invitation and, when given, the Auth account the employee is linked to. No session may
 * write these two columns, so `admin` must be the service-role client the invitation route passes in. A new link also
 * clears `activated_at`: that account has not set a password yet, and an activation left over from an account that was
 * removed in the dashboard must not carry over. A link is written only while the row still has the address the mail went
 * to and the account it had when the route read it, so a change made in the meantime is not overwritten. False when the
 * database fails or no such row is left.
 */
export async function recordInvitation(
  admin: SupabaseClient,
  id: string,
  record: { invitedAt: string; link?: { userId: string; email: string; previousUserId: string | null } },
): Promise<boolean> {
  const { invitedAt, link } = record;
  const changes = {
    invited_at: invitedAt,
    ...(link === undefined ? {} : { user_id: link.userId, activated_at: null }),
  };
  let query = admin.from("employees").update(changes).eq("id", id);
  if (link !== undefined) {
    query = query.eq("email", link.email);
    query = link.previousUserId === null ? query.is("user_id", null) : query.eq("user_id", link.previousUserId);
  }
  const { data, error } = await query.select("id");
  if (error) {
    logDatabaseError("employees", "invite", error);
    return false;
  }
  return Array.isArray(data) && data.length > 0;
}
