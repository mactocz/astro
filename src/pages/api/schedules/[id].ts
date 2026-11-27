import type { APIRoute } from "astro";
import { jsonResponse, readJsonBody } from "@/lib/json-response";
import { isUuid } from "@/lib/postgrest";
import { saveSchedule } from "@/lib/schedules";
import { validateScheduleInput } from "@/lib/services/schedule";

export const prerender = false;

// The confirmation that assignments may go with a removed cell or person. It is no part of the schedule, so it is read from
// the raw body and never reaches validateScheduleInput. Only the boolean true confirms: any other value, a string such as
// "yes" included, counts as no confirmation.
function readConfirmation(body: unknown): boolean {
  return typeof body === "object" && body !== null && (body as Record<string, unknown>).confirmRemoval === true;
}

// Access is decided by the middleware gate (planner-only by default), so only planners get this far. The body describes
// the whole schedule, so it carries every field, as the form sends them, and the optional `confirmRemoval`.
export const PUT: APIRoute = async (context) => {
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

  const validation = validateScheduleInput(parsed.body);
  if (!validation.ok) {
    return jsonResponse(422, { errors: validation.errors });
  }

  const result = await saveSchedule(supabase, id, validation.value, readConfirmation(parsed.body));
  if (result.ok) {
    return jsonResponse(200, { id: result.id });
  }
  if (result.error === "not_found") {
    return jsonResponse(404, { error: "not_found" });
  }
  // An approved schedule is final (S-08); nothing was stored.
  if (result.error === "schedule_approved") {
    return jsonResponse(409, { error: "schedule_approved" });
  }
  // The save would delete assignments with a cell or a person and nobody confirmed it; nothing was stored.
  if (result.error === "removal_unconfirmed") {
    return jsonResponse(409, { error: "assignments_would_be_removed", removed: result.removed });
  }
  // A shift or an employee of the grid was removed after the form was loaded, so the body no longer fits the data.
  if (result.error === "unknown_reference") {
    return jsonResponse(422, { error: "unknown_reference" });
  }
  return jsonResponse(500, { error: "failed" });
};
