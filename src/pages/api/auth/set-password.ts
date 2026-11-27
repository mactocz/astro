import type { APIRoute } from "astro";
import type { SupabaseClient } from "@supabase/supabase-js";
import { jsonResponse, readJsonBody } from "@/lib/json-response";
import { classifyVerifyFailure, parseSetPasswordLink } from "@/lib/services/invitation";
import { validatePassword } from "@/lib/services/password";

export const prerender = false;

const PASSWORD_NOT_SAVED_MESSAGE =
  "Nie udało się zapisać hasła, a link został już zużyty. Poproś planistę o nowe zaproszenie.";
const SAME_PASSWORD_MESSAGE =
  "To jest Twoje dotychczasowe hasło, więc nic się nie zmieniło. Link został zużyty, a hasło działa dalej.";

// Public path (the token in the body is the credential). One request spends the token and sets the password, in this
// order: the password is validated first, so a weak one never spends the token; verifyOtp then signs the user in with the
// session of the link, and updateUser sets the password on that session. The last step records the activation. The
// session cookies go to the browser through the request's own client (context.locals.supabase), like a sign-in.
export const POST: APIRoute = async (context) => {
  const parsed = await readJsonBody(context.request);
  if (!parsed.ok) {
    return parsed.response;
  }

  const { supabase } = context.locals;
  if (!supabase) {
    return jsonResponse(503, { error: "not_configured" });
  }

  const body = typeof parsed.body === "object" && parsed.body !== null ? (parsed.body as Record<string, unknown>) : {};
  const link = parseSetPasswordLink(body.tokenHash, body.type);
  if (link === null) {
    return jsonResponse(400, { error: "invalid_link" });
  }

  const passwordCheck = validatePassword(body.password);
  if (!passwordCheck.ok) {
    return jsonResponse(422, { errors: { password: passwordCheck.error } });
  }
  // validatePassword accepts nothing but a string.
  const password = body.password as string;

  const { error: verifyError } = await supabase.auth.verifyOtp({ token_hash: link.tokenHash, type: link.type });
  if (verifyError) {
    // An expired or used link is an answer of Auth (a 4xx other than the rate limit). Anything else says nothing about
    // the link, which is probably unspent: leave a trace and say to try again.
    const failure = classifyVerifyFailure(verifyError.status);
    if (failure === "invalid_link") {
      return jsonResponse(400, { error: "invalid_link" });
    }
    logAuthFailure("verify", verifyError.status, verifyError.code);
    return jsonResponse(failure === "rate_limited" ? 429 : 503, { error: "try_again" });
  }

  const { error: updateError } = await supabase.auth.updateUser({ password });
  if (updateError) {
    // A reset with the password the account already has: nothing is lost, that password still works.
    if (updateError.code === "same_password") {
      return jsonResponse(409, { error: "same_password", message: SAME_PASSWORD_MESSAGE });
    }
    logAuthFailure("update", updateError.status, updateError.code);
    return jsonResponse(500, { error: "password_not_saved", message: PASSWORD_NOT_SAVED_MESSAGE });
  }

  await markAccountActive(supabase);
  return jsonResponse(200, { ok: true });
};

// The password is saved, so the account is active: the employee list reads that from employees.activated_at, which only
// the SQL function mark_account_active() writes (security definer; it touches the row of the caller's own session, only
// while the column is still null, so it also runs for a recovery link and the first activation stays). A failure here
// must not undo the password the employee has just set, so it is logged and nothing more: the list then keeps showing
// the invitation until the next password set.
async function markAccountActive(supabase: SupabaseClient): Promise<void> {
  try {
    const { error, status } = await supabase.rpc("mark_account_active");
    if (error) {
      logAuthFailure("activate", status, error.code);
    }
  } catch {
    logAuthFailure("activate", undefined, undefined);
  }
}

// Status and code only: an Auth or database message can quote the address, the token or a row.
function logAuthFailure(step: string, status: number | undefined, code: string | undefined): void {
  // eslint-disable-next-line no-console -- the only trace of an Auth failure, visible in `wrangler tail`
  console.error(`set-password ${step} failed: ${status ?? "no status"} ${code ?? "no code"}`);
}
