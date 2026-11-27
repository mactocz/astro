---
change_id: employee-invitation
title: Employee invitation
status: archived
created: 2026-11-05
updated: 2026-11-27
archived_at: 2026-11-27T12:34:27Z
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

### Implementation notes: the Supabase assumptions of the plan (checked 2026-11-23 against the local stack, CLI 2.117.0)

Phase 2 and 3 checked the assumptions the plan marked as unverified. None of them contradicts the plan.

- `otp_expiry = 604800`: the local stack starts with it (`GOTRUE_MAILER_OTP_EXP=604800` in the Auth container). The hosted project still needs the same value through the Management API (Phase 4 checklist); Supabase advises against more than 86400.
- Inviting again an account that never confirmed: sends a NEW mail with a new `token_hash`, and the earlier token answers 403 `otp_expired`. A second invitation right after the first is not blocked by `max_frequency`.
- Which field marks a confirmed account: a pending user has `email_confirmed_at` and `confirmed_at` both null; after `verifyOtp` both are set. A user made by `admin.createUser({ email_confirm: true })` has only `email_confirmed_at` in the create response, but `getUserById` returns both. `classifyAuthUser` (either field) is right.
- `generate_link` of type `invite` for an existing pending user: works (200, `hashed_token`, `verification_type: "invite"`), and issuing a link replaces the token of the mail. For a confirmed user `invite` answers 422 `email_exists` and `recovery` works. The smoke test therefore uses `invite` for a pending account and `recovery` for an active one, and it does not prove that the token of a real mail is valid (the author chose not to read mails in the smoke test).
- Inviting an address that already has a confirmed account: 422 with `code: "email_exists"`, mapped to 409 `account_exists`.
- `resetPasswordForEmail` with the session client sends the `recovery` template. Its hash has the prefix `pkce_`; `verifyOtp` with it works without a code verifier, as in the browser of an employee. A second reset within a second answers 429 `over_email_send_rate_limit`, which the route reports as 502 `mail_failed` (the UI of Phase 4 says to check the mail setup, not to try again in a moment).
- `verifyOtp` spends the token (a second use: 403 `otp_expired`); `updateUser({ password })` right after it works on the session the client keeps in memory, for `invite` and `recovery`. The session cookie is set at sign-in and again after the update.

Open points for the author (none blocks the plan):

- The session client leaves three PKCE `...-code-verifier` cookies in the planner's browser after `resetPasswordForEmail`. Harmless noise; a plain client without PKCE would avoid it at the cost of more code.
- If `updateUser` fails after `verifyOtp` (for example `same_password`), the token is already spent and the session stays; the route answers 500 `password_not_saved` and does not sign the user out.
- An unconfirmed account at the address of an employee that is not linked (for example after a failed clean-up) is not an `email_exists` case: Auth sends a new invitation and the route links it. Practically unreachable, because sign-up is closed.
- `invited_at` is the clock of the Worker, not of Auth.

### Deployment 2026-11-27: the hosted link lives 24 hours, not 7 days

The hosted Supabase project does not accept `otp_expiry = 604800`; the author set the maximum it takes, 86400 (24 hours), and a minimum password length of 8. The author also confirmed the custom SMTP sender and an end-to-end invitation in production (4.7, 4.8).

**Aligned after the implementation review** (`reviews/impl-review.md`, F1 to F7 fixed, F8 skipped): the code, the mail templates, `supabase/config.toml`, the PRD, the roadmap and the documentation say 24 hours (`INVITE_VALIDITY_HOURS`). The two templates in the hosted dashboard are changed by hand. `plan.md` keeps the 7 days it was written with. The review also added the migration `*_employee_account_email_lock.sql`.

### Decision change 2026-11-23: the list shows an active account

**Cause.** Manual tests showed that after an employee opened the link and set a password, the planner's employee list still read "Zaproszony dd.mm.rrrr (link ważny do ...)", because acceptance of the invitation was not tracked and the list had no way to tell an active account from a pending one.

**Choice (the author).** Record the moment of activation with a SQL function that the set-password route calls, not with a trigger on `auth.users`. A new migration (`supabase/migrations/*_employee_account_activation.sql`) adds `employees.activated_at` (no column grant for any session) and `public.mark_account_active()`: `security definer`, `set search_path = ''`, execute for `authenticated` only, it sets `activated_at = now()` on the row with `user_id = auth.uid()`, only for the `employee` role and only while the column is null (the first activation wins, a password reset keeps it). `POST /api/auth/set-password` calls it with the employee's own session after `updateUser`, for `invite` and `recovery` links alike; a failure of the call is logged (status and code) and does not change the 200 answer. The list and the edit page show "Zarejestrowany dd.mm.rrrr" for an active account (`inviteStatus` kind `active`, `formatInviteLabel`), and the button reads "Resetuj hasło" instead of "Wyślij ponownie".

**Consequence.** The plan wrote the opposite under "What We're NOT Doing" ("Śledzenia akceptacji zaproszenia ... Żadnych funkcji `SECURITY DEFINER` ani triggerów na schemacie `auth`") and in the "Stan na liście" row of the plan brief. The author approved the reversal; `plan.md` is left as it was, and this note supersedes those lines. Side effects: `recordInvitation` clears `activated_at` when it links a new account (an activation of an account removed in the dashboard must not carry over); the smoke steps that look for the invited label and the "Wyślij ponownie" button now run before the invitee sets a password, and the steps after it look for "Zarejestrowany" and "Resetuj hasło". The server-rendered label updates only when the page is loaded again (known and accepted).
