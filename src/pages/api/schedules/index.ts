import type { APIRoute } from "astro";
import { jsonResponse, readJsonBody } from "@/lib/json-response";
import { saveSchedule } from "@/lib/schedules";
import { validateScheduleInput } from "@/lib/services/schedule";

export const prerender = false;

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

  const validation = validateScheduleInput(parsed.body);
  if (!validation.ok) {
    return jsonResponse(422, { errors: validation.errors });
  }

  const result = await saveSchedule(supabase, null, validation.value);
  if (result.ok) {
    return jsonResponse(201, { id: result.id });
  }
  // A shift or an employee of the grid was removed after the form was loaded, so the body no longer fits the data.
  if (result.error === "unknown_reference") {
    return jsonResponse(422, { error: "unknown_reference" });
  }
  // A new schedule has no id to miss, so not_found cannot happen here and is answered like any other failure.
  return jsonResponse(500, { error: "failed" });
};
