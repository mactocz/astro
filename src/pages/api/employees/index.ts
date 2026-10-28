import type { APIRoute } from "astro";
import { createEmployee, EMAIL_TAKEN_MESSAGE } from "@/lib/employees";
import { jsonResponse, readJsonBody } from "@/lib/json-response";
import { validateEmployeeInput } from "@/lib/services/employee";

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

  const validation = validateEmployeeInput(parsed.body);
  if (!validation.ok) {
    return jsonResponse(422, { errors: validation.errors });
  }

  const result = await createEmployee(supabase, validation.value);
  if (result.ok) {
    return jsonResponse(201, { employee: result.employee });
  }
  if (result.error === "email_taken") {
    return jsonResponse(409, { errors: { email: EMAIL_TAKEN_MESSAGE } });
  }
  return jsonResponse(500, { error: "failed" });
};
