import type { APIRoute } from "astro";
import { jsonResponse, readJsonBody } from "@/lib/json-response";
import { isUuid } from "@/lib/postgrest";
import { validateShiftInput } from "@/lib/services/shift";
import { updateShift } from "@/lib/shifts";

export const prerender = false;

// Access is decided by the middleware gate (planner-only by default), so only planners get this far. The body replaces
// the whole shift, so it carries every field, as the form sends them.
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

  const validation = validateShiftInput(parsed.body);
  if (!validation.ok) {
    return jsonResponse(422, { errors: validation.errors });
  }

  const result = await updateShift(supabase, id, validation.value);
  if (result.ok) {
    return jsonResponse(200, { shift: result.shift });
  }
  if (result.error === "not_found") {
    return jsonResponse(404, { error: "not_found" });
  }
  return jsonResponse(500, { error: "failed" });
};
