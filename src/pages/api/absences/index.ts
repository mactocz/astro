import type { APIRoute } from "astro";
import { createAbsence } from "@/lib/absences";
import { jsonResponse, readJsonBody } from "@/lib/json-response";
import { validateAbsenceInput } from "@/lib/services/absence";

export const prerender = false;

// Access is decided by the middleware gate (planner-only by default), so only planners get this far. The body carries the
// four fields of an absence; anything else in it, a `status` included, is left out by the validation: the database sets the
// status of a new absence to `approved`, and no session may write another.
export const POST: APIRoute = async (context) => {
  const parsed = await readJsonBody(context.request);
  if (!parsed.ok) {
    return parsed.response;
  }

  const { supabase } = context.locals;
  if (!supabase) {
    return jsonResponse(503, { error: "not_configured" });
  }

  const validation = validateAbsenceInput(parsed.body);
  if (!validation.ok) {
    return jsonResponse(422, { errors: validation.errors });
  }

  const result = await createAbsence(supabase, validation.value);
  if (result.ok) {
    return jsonResponse(201, { absence: result.absence });
  }
  // The body is well formed but no employee has the id it names.
  if (result.error === "unknown_reference") {
    return jsonResponse(422, { error: "unknown_reference" });
  }
  return jsonResponse(500, { error: "failed" });
};
