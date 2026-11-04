import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { isUuid, logDatabaseError } from "@/lib/postgrest";
import { sortShifts } from "@/lib/services/shift";
import type { Shift, ShiftInput } from "@/types";

// The only module that knows the column names of the shifts table. Every function runs on the client it is given,
// i.e. on the signed-in user's session, so row-level security decides what is visible and writable.
const COLUMNS = "id, name, start_minute, end_minute, created_at";

interface ShiftRow {
  id: string;
  name: string;
  start_minute: number;
  end_minute: number;
  created_at: string;
}

type WriteResult<Failure extends string> = { ok: true; shift: Shift } | { ok: false; error: Failure };
export type CreateShiftResult = WriteResult<"failed">;
export type UpdateShiftResult = WriteResult<"not_found" | "failed">;

function toShifts(data: unknown): Shift[] {
  return (data as ShiftRow[]).map((row) => ({
    id: row.id,
    name: row.name,
    startMinute: row.start_minute,
    endMinute: row.end_minute,
    createdAt: row.created_at,
  }));
}

function toRow(input: ShiftInput) {
  return {
    name: input.name,
    start_minute: input.startMinute,
    end_minute: input.endMinute,
  };
}

function readFailure(action: string, error: PostgrestError): Error {
  logDatabaseError("shifts", action, error);
  return new Error(`Reading shifts failed (${action}).`);
}

function writeFailure(action: string, error: PostgrestError): { ok: false; error: "failed" } {
  logDatabaseError("shifts", action, error);
  return { ok: false, error: "failed" };
}

/** Every shift the session may see, ordered by `sortShifts`. Throws when the database fails. */
export async function listShifts(supabase: SupabaseClient): Promise<Shift[]> {
  const { data, error } = await supabase.from("shifts").select(COLUMNS);
  if (error) {
    throw readFailure("list", error);
  }
  return sortShifts(toShifts(data));
}

/** The shift, or null when there is none visible with this id (also for an id that is not a UUID). */
export async function getShift(supabase: SupabaseClient, id: string): Promise<Shift | null> {
  if (!isUuid(id)) {
    return null;
  }
  const { data, error } = await supabase.from("shifts").select(COLUMNS).eq("id", id);
  if (error) {
    throw readFailure("get", error);
  }
  return toShifts(data).at(0) ?? null;
}

/** Stores a new shift (the input is already validated and normalised) and returns the stored row. */
export async function createShift(supabase: SupabaseClient, input: ShiftInput): Promise<CreateShiftResult> {
  const { data, error } = await supabase.from("shifts").insert(toRow(input)).select(COLUMNS);
  if (error) {
    return writeFailure("create", error);
  }
  const shift = toShifts(data).at(0);
  return shift ? { ok: true, shift } : { ok: false, error: "failed" };
}

/** Replaces every field of a shift. `not_found` when no row is visible with this id (missing, or hidden by RLS). */
export async function updateShift(supabase: SupabaseClient, id: string, input: ShiftInput): Promise<UpdateShiftResult> {
  if (!isUuid(id)) {
    return { ok: false, error: "not_found" };
  }
  const { data, error } = await supabase.from("shifts").update(toRow(input)).eq("id", id).select(COLUMNS);
  if (error) {
    return writeFailure("update", error);
  }
  const shift = toShifts(data).at(0);
  return shift ? { ok: true, shift } : { ok: false, error: "not_found" };
}
