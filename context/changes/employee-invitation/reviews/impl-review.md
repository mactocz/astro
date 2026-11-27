<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Employee invitation (S-10)

- **Plan**: context/changes/employee-invitation/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4
- **Date**: 2026-11-27
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 4 warnings, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | FAIL (F1) |
| Scope Discipline | PASS |
| Safety & Quality | WARNING (F2, F3, F4) |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Success criteria: on 2026-11-27 `npx astro sync`, `npm run lint`, `npx astro check` (0 errors), `npm test` (2105 passed) and `npm run build` passed. `npm run smoke` and `npx supabase db reset` were not run again; CI on `master` (`2fefd8b`) is green. The manual items rest on the author's confirmations. Nothing planned is missing; the small extras (shared link parser, `recordInvitation`, `FormField` props, an `email` prop and a `not_found` message of the invite button) are harmless. The account activation tracking is an approved deviation (`change.md`).

## Findings

### F1 — The hosted link lives 24 hours, the application says 7 days

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: src/lib/services/invitation.ts:4; supabase/templates/invite.html:40; supabase/templates/recovery.html:43; supabase/config.toml:234; context/foundation/prd.md:115
- **Detail**: The hosted project takes at most `otp_expiry = 86400`. The mail still promises 7 days and the employee list shows "link ważny do" a date 7 days ahead, so after a day the link is dead while both say it works. Password-reset links are affected too.
- **Fix A ⭐ Recommended**: Move the application, templates, local config, tests, smoke, PRD, roadmap and docs to 24 hours, and update the two templates in the hosted dashboard.
  - Strength: Matches what Auth really does; no new security code.
  - Tradeoff: Changes a PRD requirement; an employee has one day to react.
  - Confidence: HIGH — the places are known.
  - Blind spot: The templates in the hosted dashboard were not read.
- **Fix B**: Own invitation token with a 7-day life.
  - Strength: Keeps the PRD.
  - Tradeoff: A token table, expiry and single use to build and secure.
  - Confidence: LOW — not designed.
  - Blind spot: The plan ruled this out of scope.
- **Decision**: FIXED via Fix A

### F2 — A link or reset can go to an address that is not the linked account's

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/employees/[id]/invite.ts:43-100; src/lib/employees.ts:128-142; src/pages/api/employees/[id].ts:29-49; supabase/migrations/20261123100833_employee_accounts.sql:21-25
- **Detail**: The e-mail lock exists only in the PUT route (the column grant still lets a planner token change it), and both PUT and the invitation are check-then-write. `recordInvitation` updates by `id` only. Correcting a mistyped address while the mail is being sent can link the wrong mailbox's account to the row. Once the row and the Auth account differ, re-invite and reset mail `employees.email` without comparing it. Timing not reproduced.
- **Fix A ⭐ Recommended**: A migration that refuses an e-mail change while `user_id` is set, a conditional link write (same e-mail, `user_id` still null), and a comparison with the Auth e-mail in the route.
  - Strength: The rule holds whatever path writes the row.
  - Tradeoff: A new migration, to be applied to the hosted project; do it together with F3.
  - Confidence: HIGH — the gaps are visible in the code.
  - Blind spot: How a dashboard e-mail change of an Auth user should be handled.
- **Fix B**: Only the checks in the route.
  - Strength: No migration.
  - Tradeoff: The race and the PostgREST path stay.
  - Confidence: MEDIUM — covers the mail, not the data.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A

### F3 — The cleanup can delete an account this request did not create

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/employees/[id]/invite.ts:57-79, 127-132
- **Detail**: `inviteUserByEmail` returns an existing unconfirmed user (change.md). If that user is already linked to another employee (possible after F2), the link write fails on the unique `user_id` and `removeAccount` deletes the other employee's account. Two parallel invitations where one write fails can do the same. The role write would also relabel an existing unconfirmed account. The parallel case is not reproduced.
- **Fix**: Before the role write and any delete, check with the planner's session that no employee row holds this user id, and delete only an account this request created.
  - Strength: Keeps the compensation and removes its destructive case.
  - Tradeoff: "Created by this request" needs a check of the returned user.
  - Confidence: MEDIUM — depends on what Auth returns for a pending user.
  - Blind spot: Behaviour of two simultaneous invitations is unverified.
- **Decision**: FIXED

### F4 — Every verifyOtp failure is reported as a dead link

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/auth/set-password.ts:40-47
- **Detail**: A 429, a 5xx or a network error also answers `invalid_link`, so the employee is told to ask for a new invitation although the link is probably unspent. A 429 is not logged either.
- **Fix**: Answer `invalid_link` only for the expired or invalid cases; otherwise 429/503 with "spróbuj ponownie za chwilę", logged, with its message in the form hook.
- **Decision**: FIXED

### F5 — A refused password after the token is spent ends in a dead end

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/auth/set-password.ts:49-53
- **Detail**: With `same_password` on a reset the old password still works and the browser is signed in, but the message says to ask for a new invitation (open point in change.md).
- **Fix**: Give `same_password` its own message.
- **Decision**: FIXED

### F6 — The set-password page does not warn that it replaces the current session

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/auth/set-password.astro:21-27
- **Detail**: In a browser signed in as the planner, submitting the form silently switches to the employee's session.
- **Fix**: When a user is signed in, say that this session will end.
- **Decision**: FIXED

### F7 — Half-finished invitations and invite errors are hard to read

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/employees/[id]/invite.ts:60-101; src/components/hooks/useInviteEmployee.ts:8-14
- **Detail**: A failed cleanup leaves an unlinked account; once it is used, every invitation answers 409 until somebody removes it in the dashboard. A mail rate limit reads "check the mail configuration". A sent mail with a failed `invited_at` write reads as a failure, and the retry kills the delivered link.
- **Fix**: Map 429 to "wait and retry", report "sent, date not saved" separately, and document the dashboard recovery step.
- **Decision**: FIXED

### F8 — Small documentation gaps and one unchecked log

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/lib/services/password.ts:39-42; README.md:135; wrangler.jsonc:12-14
- **Detail**: The password maximum is 72 bytes, not 72 characters as planned (deliberate, stricter, not recorded). README says new accounts can sign in right away, which is not true for invited ones. Worker observability is on, so logs may keep `/auth/set-password?token_hash=...`; not verified.
- **Fix**: Record the byte limit in change.md, correct the README sentence, and look at one production log entry.
- **Decision**: SKIPPED
