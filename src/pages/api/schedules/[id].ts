import type { APIRoute } from "astro";
import { jsonResponse, readJsonBody } from "@/lib/json-response";
import { isUuid } from "@/lib/postgrest";
import { saveSchedule } from "@/lib/schedules";
import { validateScheduleInput } from "@/lib/services/schedule";

export const prerender = false;

// Access is decided by the middleware gate (planner-only by default), so only planners get this far. The body replaces
// the whole schedule, so it carries every field, as the form sends them.
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

  const result = await saveSchedule(supabase, id, validation.value);
  if (result.ok) {
    return jsonResponse(200, { id: result.id });
  }
  if (result.error === "not_found") {
    return jsonResponse(404, { error: "not_found" });
  }
  // A shift or an employee of the grid was removed after the form was loaded, so the body no longer fits the data.
  if (result.error === "unknown_reference") {
    return jsonResponse(422, { error: "unknown_reference" });
  }
  return jsonResponse(500, { error: "failed" });
};
