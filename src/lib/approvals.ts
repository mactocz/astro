import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { assertExactCount, isUuid, logDatabaseError } from "@/lib/postgrest";
import { toStoredViolations, type ApprovalPayload } from "@/lib/services/approval";
import { compareText } from "@/lib/services/schedule";
import type { ApprovalSnapshotEmployee, ApprovalSnapshotShift, ScheduleApproval } from "@/types";

// The only module that knows the tables of an approval and the approve_schedule function. Every function runs on the
// client it is given, i.e. on the signed-in user's session: the approval tables are readable by a planner only, and the
// function refuses everyone else.

// What approve_schedule raises, as PostgREST reports it. 23505 is a second approval that got past the status check.
const NOT_FOUND = "PT404";
const APPROVED_ALREADY = "PT423";
const UNIQUE_VIOLATION = "23505";
const DATA_CHANGED = "PT412";
const PAYLOAD_REFUSED = "PT422";

export type ApproveScheduleResult =
  | { ok: true; approvedAt: string }
  | { ok: false; error: "not_found" | "schedule_approved" | "schedule_changed" | "invalid" | "failed" };

interface ApprovalRow {
  schedule_id: string;
  approved_at: string;
  approved_by_email: string;
  violations: unknown;
  confirmed_keys: string[];
  critical_count: number;
  warning_count: number;
}

interface SnapshotShiftRow {
  shift_id: string;
  name: string;
  start_minute: number;
  end_minute: number;
}

interface SnapshotEmployeeRow {
  employee_id: string;
  display_name: string;
  fte_numerator: number;
  fte_denominator: number;
  worked_minutes: number;
  norm_minutes: number;
}

function readFailure(action: string, error: PostgrestError): Error {
  logDatabaseError("approvals", action, error);
  return new Error(`Reading approvals failed (${action}).`);
}

async function readSnapshot(supabase: SupabaseClient, table: string, columns: string, scheduleId: string) {
  const { data, error, count } = await supabase
    .from(table)
    .select(columns, { count: "exact" })
    .eq("schedule_id", scheduleId);
  if (error) {
    throw readFailure(table, error);
  }
  assertExactCount("approvals", data.length, count, table);
  return data as unknown[];
}

/**
 * The record of the approval of a schedule with its snapshot (the shifts and the people ordered by id; the caller sorts
 * them for display), or null for a draft, for a schedule the session does not see and for an id that is not a UUID.
 * Throws when the database fails or an answer is cut off.
 */
export async function getApproval(supabase: SupabaseClient, scheduleId: string): Promise<ScheduleApproval | null> {
  if (!isUuid(scheduleId)) {
    return null;
  }
  const { data, error } = await supabase
    .from("schedule_approvals")
    .select("schedule_id, approved_at, approved_by_email, violations, confirmed_keys, critical_count, warning_count")
    .eq("schedule_id", scheduleId);
  if (error) {
    throw readFailure("get", error);
  }
  const row = (data as ApprovalRow[]).at(0);
  if (!row) {
    return null;
  }
  const [shiftRows, employeeRows] = await Promise.all([
    readSnapshot(supabase, "schedule_approval_shifts", "shift_id, name, start_minute, end_minute", scheduleId),
    readSnapshot(
      supabase,
      "schedule_approval_employees",
      "employee_id, display_name, fte_numerator, fte_denominator, worked_minutes, norm_minutes",
      scheduleId,
    ),
  ]);
  const shifts = (shiftRows as SnapshotShiftRow[])
    .map((shift): ApprovalSnapshotShift => ({
      shiftId: shift.shift_id,
      name: shift.name,
      startMinute: shift.start_minute,
      endMinute: shift.end_minute,
    }))
    .sort((a, b) => compareText(a.shiftId, b.shiftId));
  const employees = (employeeRows as SnapshotEmployeeRow[])
    .map((employee): ApprovalSnapshotEmployee => ({
      employeeId: employee.employee_id,
      displayName: employee.display_name,
      fte: { numerator: employee.fte_numerator, denominator: employee.fte_denominator },
      workedMinutes: employee.worked_minutes,
      normMinutes: employee.norm_minutes,
    }))
    .sort((a, b) => compareText(a.employeeId, b.employeeId));
  return {
    scheduleId: row.schedule_id,
    approvedAt: row.approved_at,
    approvedByEmail: row.approved_by_email,
    violations: toStoredViolations(row.violations),
    confirmedKeys: row.confirmed_keys,
    criticalCount: row.critical_count,
    warningCount: row.warning_count,
    shifts,
    employees,
  };
}

/**
 * Approves a draft through `approve_schedule`, which locks it, compares `payload.inputs` with the live data and stores the
 * record and the snapshot in one transaction. `schedule_changed` when the data is not the live data any more, `invalid`
 * when the function refuses the findings or the hours (the app does not send such a payload, so it is logged). Either way
 * nothing is stored.
 */
export async function approveSchedule(
  supabase: SupabaseClient,
  scheduleId: string,
  payload: ApprovalPayload,
): Promise<ApproveScheduleResult> {
  if (!isUuid(scheduleId)) {
    return { ok: false, error: "not_found" };
  }
  const response = await supabase.rpc("approve_schedule", {
    p_schedule_id: scheduleId,
    p_inputs: payload.inputs,
    p_violations: payload.violations,
    p_confirmed_keys: payload.confirmedKeys,
    p_workload: payload.workload,
  });
  if (response.error) {
    const { error } = response;
    switch (error.code) {
      case NOT_FOUND:
        return { ok: false, error: "not_found" };
      case APPROVED_ALREADY:
      case UNIQUE_VIOLATION:
        return { ok: false, error: "schedule_approved" };
      case DATA_CHANGED:
        return { ok: false, error: "schedule_changed" };
      default:
        logDatabaseError("approvals", "approve", error);
        return { ok: false, error: error.code === PAYLOAD_REFUSED ? "invalid" : "failed" };
    }
  }
  // A function that returns a single timestamp answers with a JSON string.
  const approvedAt: unknown = response.data;
  return typeof approvedAt === "string" ? { ok: true, approvedAt } : { ok: false, error: "failed" };
}
