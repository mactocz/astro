---
change_id: employee-invitation
title: Employee invitation
status: implementing
created: 2026-11-05
updated: 2026-11-23
archived_at: null
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
