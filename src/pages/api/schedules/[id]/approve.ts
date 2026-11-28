import type { APIRoute } from "astro";
import type { SupabaseClient } from "@supabase/supabase-js";
import { approveSchedule } from "@/lib/approvals";
import { jsonResponse, readJsonBody } from "@/lib/json-response";
import { isUuid } from "@/lib/postgrest";
import { getSchedule } from "@/lib/schedules";
import {
  buildApprovalPayload,
  decideApproval,
  readApprovalRequest,
  type ApprovalRequest,
} from "@/lib/services/approval";
import { safeEvaluate } from "@/lib/services/safe-evaluate";
import { summarizeWorkload } from "@/lib/services/workload";
import { readShownSchedule } from "@/lib/shown-schedule";
import type { Schedule } from "@/types";

export const prerender = false;

// Judges a draft from the data of the database, never from what the client counted, and approves it when the rules allow.
// The body is `{ confirmedKeys, basis, assignments }`: the keys of the warnings the planner has confirmed and what the
// page has on the screen, which must still be what the database holds.
async function approve(supabase: SupabaseClient, schedule: Schedule, request: ApprovalRequest): Promise<Response> {
  // The same reads as the assignment page, so that the findings and their texts are the ones the planner saw.
  const data = await readShownSchedule(supabase, schedule, request);
  if (data === null) {
    return jsonResponse(409, { error: "schedule_changed" });
  }
  const { shifts, employees: people, assignments, absences } = data;

  const { startDate, staffing } = schedule;
  const evaluation = safeEvaluate({ startDate, staffing, assignments, shifts, employees: people, absences });
  const decision = decideApproval(evaluation, request.confirmedKeys);
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

  const request = readApprovalRequest(parsed.body);
  if (request === null) {
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
    return await approve(supabase, schedule, request);
  } catch (error) {
    // A read or a count that threw; the data modules have logged the database error. Nothing was approved.
    // eslint-disable-next-line no-console -- the only trace of the failure, visible in `wrangler tail`
    console.error(`approvals approve failed: ${error instanceof Error ? error.message : "unknown error"}`);
    return jsonResponse(500, { error: "failed" });
  }
};
