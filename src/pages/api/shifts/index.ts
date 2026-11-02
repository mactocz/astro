import type { APIRoute } from "astro";
import { jsonResponse, readJsonBody } from "@/lib/json-response";
import { validateShiftInput } from "@/lib/services/shift";
import { createShift } from "@/lib/shifts";

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

  const validation = validateShiftInput(parsed.body);
  if (!validation.ok) {
    return jsonResponse(422, { errors: validation.errors });
  }

  const result = await createShift(supabase, validation.value);
  if (result.ok) {
    return jsonResponse(201, { shift: result.shift });
  }
  return jsonResponse(500, { error: "failed" });
};
