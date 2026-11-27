import type { APIRoute } from "astro";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listAbsencesOverlapping } from "@/lib/absences";
import { approveSchedule } from "@/lib/approvals";
import { listAssignments } from "@/lib/assignments";
import { listEmployees } from "@/lib/employees";
import { jsonResponse, readJsonBody } from "@/lib/json-response";
import { isUuid } from "@/lib/postgrest";
import { toAbsenceOptions, toEmployeeOptions } from "@/lib/schedule-options";
import { getSchedule } from "@/lib/schedules";
import { absencesOfRoster } from "@/lib/services/absence";
import { buildApprovalPayload, decideApproval } from "@/lib/services/approval";
import { safeEvaluate } from "@/lib/services/safe-evaluate";
import { PERIOD_DAYS, addDays } from "@/lib/services/schedule";
import { summarizeWorkload } from "@/lib/services/workload";
import { listShifts } from "@/lib/shifts";
import type { Schedule } from "@/types";

export const prerender = false;

// The body is `{ confirmedKeys: string[] }`: the keys of the warnings the planner was shown and has confirmed.
function readConfirmedKeys(body: unknown): string[] | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const keys = (body as Record<string, unknown>).confirmedKeys;
  return Array.isArray(keys) && keys.every((key) => typeof key === "string") ? keys : null;
}

// Judges a draft from the data of the database, never from what the client counted, and approves it when the rules allow.
async function approve(supabase: SupabaseClient, schedule: Schedule, confirmedKeys: string[]): Promise<Response> {
  // The same reads as the assignment page, so that the findings and their texts are the ones the planner saw.
  const [shifts, employees, assignments, overlapping] = await Promise.all([
    listShifts(supabase),
    listEmployees(supabase),
    listAssignments(supabase, schedule.id),
    listAbsencesOverlapping(supabase, schedule.startDate, addDays(schedule.startDate, PERIOD_DAYS)),
  ]);
  const roster = new Set(schedule.employeeIds);
  const people = toEmployeeOptions(employees).filter((employee) => roster.has(employee.id));
  const absences = toAbsenceOptions(absencesOfRoster(overlapping, schedule.employeeIds));

  const { startDate, staffing } = schedule;
  const evaluation = safeEvaluate({ startDate, staffing, assignments, shifts, employees: people, absences });
  const decision = decideApproval(evaluation, confirmedKeys);
  if (!decision.ok) {
    switch (decision.error) {
      case "rules_unavailable":
        return jsonResponse(503, { error: decision.error });
      case "critical_violations":
        return jsonResponse(409, { error: decision.error, violations: decision.critical });
      case "confirmation_required":
        return jsonResponse(409, { error: decision.error, violations: decision.warnings });
    }
  }

  const payload = buildApprovalPayload({
    schedule,
    shifts,
    employees: people,
    assignments,
    absences,
    violations: decision.warnings,
    workload: summarizeWorkload({ startDate, assignments, shifts, employees: people, absences }),
  });
  const result = await approveSchedule(supabase, schedule.id, payload);
  if (result.ok) {
    return jsonResponse(200, { approvedAt: result.approvedAt });
  }
  switch (result.error) {
    case "not_found":
      return jsonResponse(404, { error: result.error });
    case "schedule_approved":
    case "schedule_changed":
      return jsonResponse(409, { error: result.error });
    default:
      return jsonResponse(500, { error: "failed" });
  }
}

// Access is decided by the middleware gate (planner-only by default), so only planners get this far.
export const POST: APIRoute = async (context) => {
  const parsed = await readJsonBody(context.request);
  if (!parsed.ok) {
    return parsed.response;
  }

  const { supabase } = context.locals;
  if (!supabase) {
    return jsonResponse(503, { error: "not_configured" });
  }

  const { id } = context.params;
  if (id === undefined || !isUuid(id)) {
    return jsonResponse(404, { error: "not_found" });
  }

  const confirmedKeys = readConfirmedKeys(parsed.body);
  if (confirmedKeys === null) {
    return jsonResponse(422, { error: "invalid_body" });
  }

  try {
    const schedule = await getSchedule(supabase, id);
    if (!schedule) {
      return jsonResponse(404, { error: "not_found" });
    }
    if (schedule.status === "approved") {
      return jsonResponse(409, { error: "schedule_approved" });
    }
    return await approve(supabase, schedule, confirmedKeys);
  } catch (error) {
    // A read or a count that threw; the data modules have logged the database error. Nothing was approved.
    // eslint-disable-next-line no-console -- the only trace of the failure, visible in `wrangler tail`
    console.error(`approvals approve failed: ${error instanceof Error ? error.message : "unknown error"}`);
    return jsonResponse(500, { error: "failed" });
  }
};
