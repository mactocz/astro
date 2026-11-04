import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { isUuid, logDatabaseError } from "@/lib/postgrest";
import { sortEmployees } from "@/lib/services/employee";
import type { Employee, EmployeeInput } from "@/types";

// The only module that knows the column names of the employees table. Every function runs on the client it is given,
// i.e. on the signed-in user's session, so row-level security decides what is visible and writable.
const COLUMNS = "id, first_name, last_name, email, fte_numerator, fte_denominator, created_at";
// The e-mail is the only unique column besides the primary key, so this code always means a taken address.
const UNIQUE_VIOLATION = "23505";

export const EMAIL_TAKEN_MESSAGE = "Ten adres e-mail jest już przypisany do innego pracownika.";

interface EmployeeRow {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  fte_numerator: number;
  fte_denominator: number;
  created_at: string;
}

type WriteResult<Failure extends string> = { ok: true; employee: Employee } | { ok: false; error: Failure };
export type CreateEmployeeResult = WriteResult<"email_taken" | "failed">;
export type UpdateEmployeeResult = WriteResult<"email_taken" | "not_found" | "failed">;

function toEmployees(data: unknown): Employee[] {
  return (data as EmployeeRow[]).map((row) => ({
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    fte: { numerator: row.fte_numerator, denominator: row.fte_denominator },
    createdAt: row.created_at,
  }));
}

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
    return writeFailure("update", error);
  }
  const employee = toEmployees(data).at(0);
  return employee ? { ok: true, employee } : { ok: false, error: "not_found" };
}
