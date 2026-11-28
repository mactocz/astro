import type { APIRoute } from "astro";
import { addGeneratedAssignments, removeGeneratedAssignments } from "@/lib/assignments";
import { jsonResponse, readJsonBody } from "@/lib/json-response";
import { isUuid } from "@/lib/postgrest";
import { getSchedule } from "@/lib/schedules";
import { readGenerationRequest } from "@/lib/services/assignment";
import { readShownSchedule } from "@/lib/shown-schedule";

export const prerender = false;

// The generated assignments of a schedule (S-09). The proposal is counted in the browser; the server only checks that the
// page was up to date and stores it, without counting the rules (the approval counts them on the server anyway).
// Access is decided by the middleware gate (planner-only by default), so only planners get this far.

// A read or a write that threw; the data modules have logged the database error.
function failed(action: string, error: unknown): Response {
  // eslint-disable-next-line no-console -- the only trace of the failure, visible in `wrangler tail`
  console.error(`generated ${action} failed: ${error instanceof Error ? error.message : "unknown error"}`);
  return jsonResponse(500, { error: "failed" });
}

// Stores a proposal. The body is `{ basis, assignments, additions }`: what the page has on the screen, which must still be
// what the database holds, and the assignments to add.
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

  const request = readGenerationRequest(parsed.body);
  if (request === null) {
    return jsonResponse(422, { error: "invalid_body" });
  }

  try {
    const schedule = await getSchedule(supabase, id);
    if (!schedule) {
      return jsonResponse(404, { error: "not_found" });
    }
    // A proposal fills the staffing at most, so a longer list is not one.
    const required = schedule.staffing.reduce((sum, cell) => sum + cell.requiredCount, 0);
    if (request.additions.length > required) {
      return jsonResponse(422, { error: "invalid_body" });
    }
    if (schedule.status === "approved") {
      return jsonResponse(409, { error: "schedule_approved" });
    }
    if ((await readShownSchedule(supabase, schedule, request)) === null) {
      return jsonResponse(409, { error: "schedule_changed" });
    }

    const result = await addGeneratedAssignments(supabase, schedule.id, request.additions);
    if (result.ok) {
      return jsonResponse(200, { added: result.added });
    }
    switch (result.error) {
      // A cell without staffing or a person outside the roster; nothing of the list was stored.
      case "unknown_reference":
        return jsonResponse(422, { error: result.error });
      // Approved since the status was read.
      case "schedule_approved":
        return jsonResponse(409, { error: result.error });
      default:
        return jsonResponse(500, { error: "failed" });
    }
  } catch (error) {
    return failed("add", error);
  }
};

// Takes every generated assignment off; no body. Idempotent: with nothing to remove it answers 200 with 0.
export const DELETE: APIRoute = async (context) => {
  const { supabase } = context.locals;
  if (!supabase) {
    return jsonResponse(503, { error: "not_configured" });
  }

  const { id } = context.params;
  if (id === undefined || !isUuid(id)) {
    return jsonResponse(404, { error: "not_found" });
  }

  try {
    const result = await removeGeneratedAssignments(supabase, id);
    if (result.ok) {
      return jsonResponse(200, { removed: result.removed });
    }
    if (result.error === "schedule_approved") {
      return jsonResponse(409, { error: result.error });
    }
    return jsonResponse(500, { error: "failed" });
  } catch (error) {
    return failed("remove", error);
  }
};
