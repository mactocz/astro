import type { APIRoute } from "astro";
import type { AuthError, SupabaseClient } from "@supabase/supabase-js";
import { getEmployee, recordInvitation } from "@/lib/employees";
import { jsonResponse } from "@/lib/json-response";
import { isUuid } from "@/lib/postgrest";
import { classifyAuthUser, decideInviteAction } from "@/lib/services/invitation";
import { createAdminClient } from "@/lib/supabase-admin";
import type { Employee, InviteAccountState, InviteResult } from "@/types";

export const prerender = false;

// Auth's answers, as far as this route tells them apart: the code for an address that has a confirmed account, and the
// status for a user that does not exist.
const EMAIL_EXISTS = "email_exists";
const USER_NOT_FOUND = "user_not_found";

// The one place that uses the service-role key (ESLint lets nothing else import the admin client). Access is decided by
// the middleware gate (planner-only by default), so only planners get this far. The employee is read with the planner's
// session, so RLS decides that it exists; the admin client then only talks to Auth and writes the two columns no
// session may write.
export const POST: APIRoute = async (context) => {
  const { supabase } = context.locals;
  const admin = createAdminClient();
  if (!supabase || !admin) {
    return jsonResponse(503, { error: "not_configured" });
  }

  const { id } = context.params;
  if (id === undefined || !isUuid(id)) {
    return jsonResponse(404, { error: "not_found" });
  }

  let employee: Employee | null;
  try {
    employee = await getEmployee(supabase, id);
  } catch {
    // getEmployee has already logged the database failure.
    return jsonResponse(500, { error: "failed" });
  }
  if (employee === null) {
    return jsonResponse(404, { error: "not_found" });
  }
  const { email } = employee;
  if (email === null) {
    return jsonResponse(422, { error: "no_email" });
  }

  const account = await readAccountState(admin, employee.userId);
  if (!account.ok) {
    return jsonResponse(500, { error: "failed" });
  }

  const action = decideInviteAction(account.state);
  const invitedAt = new Date().toISOString();
  let result: InviteResult;

  if (action === "invite") {
    // The mail goes out in the first step, before the role exists. An account without a role is turned away from every
    // page that needs one, so the short gap opens nothing; any later failure removes the account again.
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email);
    if (error) {
      logAuthFailure("invite", error);
      return error.code === EMAIL_EXISTS
        ? jsonResponse(409, { error: "account_exists" })
        : jsonResponse(502, { error: "mail_failed" });
    }
    const userId = data.user.id;

    const { error: roleError } = await admin.auth.admin.updateUserById(userId, { app_metadata: { role: "employee" } });
    if (roleError) {
      logAuthFailure("role", roleError);
      await removeAccount(admin, userId);
      return jsonResponse(500, { error: "failed" });
    }
    if (!(await recordInvitation(admin, employee.id, { userId, invitedAt }))) {
      await removeAccount(admin, userId);
      return jsonResponse(500, { error: "failed" });
    }
    result = "invited";
  } else {
    if (action === "reinvite") {
      // Auth sends a new link to an account that never confirmed, and the earlier link stops working.
      const { error } = await admin.auth.admin.inviteUserByEmail(email);
      if (error) {
        logAuthFailure("reinvite", error);
        return jsonResponse(502, { error: "mail_failed" });
      }
      result = "reinvited";
    } else {
      // An active account gets the password-reset mail (template "recovery"), sent with the planner's own client.
      const { error } = await supabase.auth.resetPasswordForEmail(email);
      if (error) {
        logAuthFailure("reset", error);
        return jsonResponse(502, { error: "mail_failed" });
      }
      result = "password_reset";
    }
    // The mail is out. A failed write only leaves the old time in the list, so no account is touched.
    if (!(await recordInvitation(admin, employee.id, { invitedAt }))) {
      return jsonResponse(500, { error: "failed" });
    }
  }

  return jsonResponse(200, { status: result });
};

// The state of the Auth account behind the employee: `none` without a link, or when Auth no longer knows the user.
async function readAccountState(
  admin: SupabaseClient,
  userId: string | null,
): Promise<{ ok: true; state: InviteAccountState } | { ok: false }> {
  if (userId === null) {
    return { ok: true, state: "none" };
  }
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error) {
    if (error.code === USER_NOT_FOUND || error.status === 404) {
      return { ok: true, state: "none" };
    }
    logAuthFailure("lookup", error);
    return { ok: false };
  }
  return { ok: true, state: classifyAuthUser(data.user) };
}

// Best effort: the account has no role or no link yet, and it is not allowed to stay behind.
async function removeAccount(admin: SupabaseClient, userId: string): Promise<void> {
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    logAuthFailure("cleanup", error);
  }
}

// Status and code only: an Auth message can quote the e-mail address or the mail server's answer.
function logAuthFailure(step: string, error: AuthError): void {
  // eslint-disable-next-line no-console -- the only trace of an Auth failure, visible in `wrangler tail`
  console.error(`invitation ${step} failed: ${error.status ?? "no status"} ${error.code ?? "no code"}`);
}
