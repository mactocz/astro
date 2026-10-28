<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Employee roster Implementation Plan (S-01)

- **Plan**: context/changes/employee-roster/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4
- **Date**: 2026-10-28
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Evidence

HEAD `b733ad0`, working tree clean.

- Automated: `npx astro sync`, `npm run lint`, `npx astro check` (0 errors, 0 warnings, 0 hints), `npm test` (4 files, 276 tests), `npm run build`, `"zod": "^4.6.7"` in `package.json`, no `Placeholder behind` in `src/`, both migrations applied on the local stack (`npx supabase migration list --local`), `npm run smoke` 81 PASS / 0 FAIL. `npx supabase db reset` was not repeated in this review (it would wipe the local test accounts); it passed in Phase 2 and the final state of the local stack came from a reset with the real migration.
- "What We're NOT Doing": no service-role references in `src/` (0 hits), `src/lib/services/access.ts`, `src/layouts/Layout.astro` and `src/pages/dashboard.astro` unchanged, no delete policy or delete grant in the migration, no `user_id`, one `console.*` call in application code (`src/lib/employees.ts`) with a documented `eslint-disable-next-line`.
- Files: every planned code and documentation file is present in `git diff master...HEAD`; the only code file not named in the plan is `src/lib/json-response.ts` (F1).
- Manual items marked done: 1.5, 2.4, 2.5, 4.4, 4.5, 4.6 were confirmed by the author in the session; 2.4 (migration on the hosted project) cannot be verified from the repository. Pending: 2.6, 3.3, 4.7 (pull request CI) and 4.8 (production deploy).
- Merge hazard check: `master` working tree was clean at review time.

## Findings

### F1 — Changes beyond the plan are not recorded in it

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/lib/json-response.ts, AGENTS.md, README.md, scripts/smoke.mjs
- **Detail**: All extras are harmless, but the plan does not mention them: (1) `src/lib/json-response.ts` (new file) with `jsonResponse` and `readJsonBody`, shared by both routes so the 415 / 400 steps and the headers are not duplicated; (2) the `npm run smoke` bullet in `AGENTS.md` also lists the employee data (the plan names only `CLAUDE.md` for this); (3) `README.md`: the "Auth routes" heading is now "Routes", one paragraph on planner-only answers was added and the stale line about "one migration, no tables" was rewritten; (4) `scripts/smoke.mjs`: a `cacheControl` expectation on the list, add and edit pages, which guards the no-store decision from plan review F4. Without a note, a later reader of the plan will not know why these exist.
- **Fix**: Add a short addendum to `plan.md` under Phase 3 §3 and Phase 4 §4/§5 listing the four additions, so the plan matches the code before archive. No code change.
- **Decision**: FIXED (Fix now: "Addendum: zmiany ponad plan" w plan.md, przed sekcją References; obejmuje też dodatki z F2)

### F2 — Several documented API responses have no automated step

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: scripts/smoke.mjs (API steps), src/pages/api/employees/[id].ts
- **Detail**: The Testing Strategy lists 201, 200, 404, 409, 415, 422, 401, 403 and all of them are covered. The Phase 3 response table also defines 400 `invalid_json` and 503 `not_configured`, and `PUT` can answer 409 and 422; none of these has a step (grep of the smoke: no `invalid_json`, no `status: 400`, no `status: 503`; the only API 409 and 422 steps are `POST`). During the Phase 3 break-check the 400 branch showed up only as a side effect of a deliberately broken 415 check, never as an assertion of its own. The `PUT` conflict path (`email_taken` in `updateEmployee`) is therefore unverified end to end. 503 cannot be provoked without breaking the app's configuration, so it can stay untested.
- **Fix**: Add two planner steps: a `POST` with `Content-Type: application/json` and the body `{` expecting 400 `invalid_json` (needs a raw-body option in `request()`), and a `PUT` that reuses another smoke employee's e-mail expecting 409 (create a second smoke employee first; its e-mail starts with `smoke-` so the final cleanup removes it).
- **Decision**: FIXED (Fix now: opcja `jsonText` w `request()` oraz kroki w smoke.mjs: POST z ciałem `{` -> 400 `invalid_json`, drugi pracownik smoke, PUT z jego e-mailem -> 409; smoke 84 kroki PASS; kontrola celowego uszkodzenia: 422 zamiast 400 i usunięta gałąź `email_taken` w PUT dały 2 czerwone kroki)
