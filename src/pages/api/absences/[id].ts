import type { APIRoute } from "astro";
import { deleteAbsence, updateAbsence } from "@/lib/absences";
import { jsonResponse, readJsonBody } from "@/lib/json-response";
import { isUuid } from "@/lib/postgrest";
import { validateAbsenceInput } from "@/lib/services/absence";

export const prerender = false;

// Access is decided by the middleware gate (planner-only by default), so only planners get this far. The body carries the
// four fields, as the form sends them, but only the type and the two days are written: the person of an absence does not
// change (that is removing it and adding another) and the status is never written by a session. The answer shows the
// stored row, so an `employeeId` that differs from the stored one is ignored, not refused.
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

  const validation = validateAbsenceInput(parsed.body);
  if (!validation.ok) {
    return jsonResponse(422, { errors: validation.errors });
  }

  const result = await updateAbsence(supabase, id, validation.value);
  if (result.ok) {
    return jsonResponse(200, { absence: result.absence });
  }
  if (result.error === "not_found") {
    return jsonResponse(404, { error: "not_found" });
  }
  return jsonResponse(500, { error: "failed" });
};

// Idempotent like the removal of an assignment: an absence that is already gone answers 200 as well, because the planner's
// goal (it is not there) is met. An id that is not a UUID is no absence at all and gets 404. There is no body to read.
export const DELETE: APIRoute = async (context) => {
  const { supabase } = context.locals;
  if (!supabase) {
    return jsonResponse(503, { error: "not_configured" });
  }

  const { id } = context.params;
  if (id === undefined || !isUuid(id)) {
    return jsonResponse(404, { error: "not_found" });
  }

  const result = await deleteAbsence(supabase, id);
  if (result.ok || result.error === "not_found") {
    return jsonResponse(200, { ok: true });
  }
  return jsonResponse(500, { error: "failed" });
};
