import type { APIRoute } from "astro";
import type { AuthError, SupabaseClient } from "@supabase/supabase-js";
import { findEmployeeIdByUserId, getEmployee, recordInvitation } from "@/lib/employees";
import { jsonResponse } from "@/lib/json-response";
import { isUuid } from "@/lib/postgrest";
import {
  accountEmailMatches,
  classifyAuthUser,
  decideInviteAction,
  isFreshInvitedAccount,
  mayBecomeEmployee,
} from "@/lib/services/invitation";
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
  // A link and a reset go to the employee's address, so it has to be the address of the linked account.
  if (account.state !== "none" && !accountEmailMatches(account.email, email)) {
    return jsonResponse(409, { error: "account_mismatch" });
  }

  const action = decideInviteAction(account.state);
  const invitedAt = new Date().toISOString();
  let result: InviteResult;

  if (action === "invite") {
    // The mail goes out in the first step, before the role exists. An account without a role is turned away from every
    // page that needs one, so the short gap opens nothing.
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email);
    if (error) {
      logAuthFailure("invite", error);
      return error.code === EMAIL_EXISTS ? jsonResponse(409, { error: "account_exists" }) : mailFailure(error);
    }
    const { user } = data;

    // Auth hands back an unconfirmed account that was already there, so this one need not be ours. Asked with the
    // planner's session: the service-role key reads no data.
    let holder: string | null;
    try {
      holder = await findEmployeeIdByUserId(supabase, user.id);
    } catch {
      return jsonResponse(500, { error: "failed" });
    }
    if (holder !== null) {
      // A second invitation of the same employee got there first, or the account is somebody else's. Leave it alone.
      return holder === employee.id
        ? jsonResponse(200, { status: "reinvited" })
        : jsonResponse(409, { error: "account_exists" });
    }
    if (!mayBecomeEmployee(user)) {
      return jsonResponse(409, { error: "account_exists" });
    }
    // A failure from here on removes the account again, but only one that this request made.
    const removable = isFreshInvitedAccount(user);

    const { error: roleError } = await admin.auth.admin.updateUserById(user.id, { app_metadata: { role: "employee" } });
    if (roleError) {
      logAuthFailure("role", roleError);
      await removeAccount(admin, user.id, removable);
      return jsonResponse(500, { error: "failed" });
    }
    const link = { userId: user.id, email, previousUserId: employee.userId };
    if (!(await recordInvitation(admin, employee.id, { invitedAt, link }))) {
      await removeAccount(admin, user.id, removable);
      return jsonResponse(500, { error: "failed" });
    }
    result = "invited";
  } else {
    if (action === "reinvite") {
      // Auth sends a new link to an account that never confirmed, and the earlier link stops working.
      const { error } = await admin.auth.admin.inviteUserByEmail(email);
      if (error) {
        logAuthFailure("reinvite", error);
        return mailFailure(error);
      }
      result = "reinvited";
    } else {
      // An active account gets the password-reset mail (template "recovery"), sent with the planner's own client.
      const { error } = await supabase.auth.resetPasswordForEmail(email);
      if (error) {
        logAuthFailure("reset", error);
        return mailFailure(error);
      }
      result = "password_reset";
    }
    // The mail is out. A failed write only leaves the old time in the list, so no account is touched, and the answer
    // says the mail went: sending again would stop the link that was just delivered.
    if (!(await recordInvitation(admin, employee.id, { invitedAt }))) {
      return jsonResponse(500, { error: "sent_not_recorded" });
    }
  }

  return jsonResponse(200, { status: result });
};

// A mail limit passes with time; anything else points at the mail setup.
function mailFailure(error: AuthError): Response {
  return error.status === 429
    ? jsonResponse(429, { error: "rate_limited" })
    : jsonResponse(502, { error: "mail_failed" });
}

// The state of the Auth account behind the employee: `none` without a link, or when Auth no longer knows the user.
async function readAccountState(
  admin: SupabaseClient,
  userId: string | null,
): Promise<{ ok: true; state: InviteAccountState; email: string | null } | { ok: false }> {
  if (userId === null) {
    return { ok: true, state: "none", email: null };
  }
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error) {
    if (error.code === USER_NOT_FOUND || error.status === 404) {
      return { ok: true, state: "none", email: null };
    }
    logAuthFailure("lookup", error);
    return { ok: false };
  }
  return { ok: true, state: classifyAuthUser(data.user), email: data.user.email ?? null };
}

// Best effort: the account has no role or no link yet, and it is not allowed to stay behind. An account that may not be
// removed, or whose removal fails, is logged by its id (never the address), so it can be found in the dashboard.
async function removeAccount(admin: SupabaseClient, userId: string, removable: boolean): Promise<void> {
  if (!removable) {
    // eslint-disable-next-line no-console -- the only trace of an account left behind, visible in `wrangler tail`
    console.error(`invitation cleanup kept account ${userId}`);
    return;
  }
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    logAuthFailure("cleanup", error);
    // eslint-disable-next-line no-console -- see above
    console.error(`invitation cleanup left account ${userId}`);
  }
}

// Status and code only: an Auth message can quote the e-mail address or the mail server's answer.
function logAuthFailure(step: string, error: AuthError): void {
  // eslint-disable-next-line no-console -- the only trace of an Auth failure, visible in `wrangler tail`
  console.error(`invitation ${step} failed: ${error.status ?? "no status"} ${error.code ?? "no code"}`);
}
