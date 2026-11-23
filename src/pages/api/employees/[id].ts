import type { APIRoute } from "astro";
import { EMAIL_TAKEN_MESSAGE, getEmployee, updateEmployee } from "@/lib/employees";
import { jsonResponse, readJsonBody } from "@/lib/json-response";
import { isUuid } from "@/lib/postgrest";
import { validateEmployeeInput } from "@/lib/services/employee";
import { EMAIL_LOCKED_MESSAGE, emailChangeBlocked } from "@/lib/services/invitation";
import type { Employee } from "@/types";

export const prerender = false;

// Access is decided by the middleware gate (planner-only by default), so only planners get this far. The body replaces
// the whole employee, so it carries every field, as the form sends them.
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

  // The stored employee is read first: once an account is linked, the e-mail address may not change (it is the address
  // of that account). getEmployee has already logged a database failure.
  let existing: Employee | null;
  try {
    existing = await getEmployee(supabase, id);
  } catch {
    return jsonResponse(500, { error: "failed" });
  }
  if (existing === null) {
    return jsonResponse(404, { error: "not_found" });
  }

  const validation = validateEmployeeInput(parsed.body);
  if (!validation.ok) {
    return jsonResponse(422, { errors: validation.errors });
  }
  if (emailChangeBlocked(existing, validation.value.email)) {
    return jsonResponse(422, { errors: { email: EMAIL_LOCKED_MESSAGE } });
  }

  const result = await updateEmployee(supabase, id, validation.value);
  if (result.ok) {
    return jsonResponse(200, { employee: result.employee });
  }
  if (result.error === "not_found") {
    return jsonResponse(404, { error: "not_found" });
  }
  if (result.error === "email_taken") {
    return jsonResponse(409, { errors: { email: EMAIL_TAKEN_MESSAGE } });
  }
  return jsonResponse(500, { error: "failed" });
};
