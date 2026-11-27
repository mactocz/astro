import type { APIContext, APIRoute } from "astro";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addAssignment, removeAssignment, type AddAssignmentResult } from "@/lib/assignments";
import { jsonResponse, readJsonBody } from "@/lib/json-response";
import { isUuid } from "@/lib/postgrest";
import { validateAssignmentInput } from "@/lib/services/assignment";
import type { AssignmentInput } from "@/types";

export const prerender = false;

type WriteAssignment = (
  supabase: SupabaseClient,
  scheduleId: string,
  input: AssignmentInput,
) => Promise<AddAssignmentResult>;

// POST and DELETE take the same body, `{ shiftId, dayOffset, employeeId }`, and answer alike, so they share one handler
// and differ only in what they write. Both are idempotent: adding what is there and removing what is not there answer 200.
// Access is decided by the middleware gate (planner-only by default), so only planners get this far.
async function handle(context: APIContext, write: WriteAssignment): Promise<Response> {
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

  const validation = validateAssignmentInput(parsed.body);
  if (!validation.ok) {
    return jsonResponse(422, { errors: validation.errors });
  }

  const result = await write(supabase, id, validation.value);
  if (result.ok) {
    return jsonResponse(200, { ok: true });
  }
  // An approved schedule is final (S-08); nothing was written.
  if (result.error === "schedule_approved") {
    return jsonResponse(409, { error: "schedule_approved" });
  }
  // The cell has no staffing any more, or the person is not in the roster of the schedule (or the schedule does not exist),
  // so the body no longer fits the data.
  if (result.error === "unknown_reference") {
    return jsonResponse(422, { error: "unknown_reference" });
  }
  return jsonResponse(500, { error: "failed" });
}

export const POST: APIRoute = (context) => handle(context, addAssignment);
export const DELETE: APIRoute = (context) => handle(context, removeAssignment);
