<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Schedule approval (S-08)

- **Plan**: context/changes/schedule-approval/plan.md
- **Scope**: Phases 1-5 of 6 (phase 6, deployment, is not complete)
- **Reviewed phases**: 1, 2, 3, 4, 5
- **Date**: 2026-11-27
- **Verdict**: APPROVED (fix F1 before real schedules are approved: approval cannot be undone)
- **Findings**: 0 critical, 1 warning, 6 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING (F1) |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Success criteria: lint, `astro check`, 2128 tests and the build passed on 2026-11-27 on a tree that holds the S-08 code (together with the S-10 review fixes). `npm run smoke` and `npx supabase db reset` were not run again; CI on `master` (`2fefd8b`) is green. The reviewers found no way through the app to approve with a critical violation or with unconfirmed warning keys, or to change an approved schedule with a planner session. Nothing planned is missing. The hosted project has the migration and the Worker was deployed on 2026-11-27; whether approval was tried there (6.5) and the CPU time (6.6) are not recorded.

## Findings

### F1 — Approval can freeze data the planner never saw

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/components/hooks/useApproval.ts:47-56; src/pages/api/schedules/[id]/approve.ts:31-45; src/components/schedules/ApprovalSection.tsx:103-112; src/components/schedules/AssignmentGrid.tsx:273
- **Detail**: The client sends only `confirmedKeys`; the route judges whatever the database holds now, and `PT412` covers only the milliseconds between its reads and the function. A tab left open while another changes assignments, roster, shifts or absences approves the new state if no new warning key and no critical finding appears. A click whose answer was lost is reverted in the grid but stays in the database. After a failure that asks for a reload the approve button stays usable, and the grid stays enabled while the approval is pending. Verified in code; goes beyond the accepted "keys only" risk.
- **Fix A ⭐ Recommended**: The page sends what it shows (its assignments and a fingerprint of the other inputs); the route answers 409 `schedule_changed` on a difference. Disable the grid while approving and the button after a reload failure.
  - Strength: Closes every listed path without a migration.
  - Tradeoff: A contract change of the route, its tests and smoke steps.
  - Confidence: HIGH — the route already builds the same sets in `buildApprovalPayload`.
  - Blind spot: The fingerprint must be built the same way on page and route.
- **Fix B**: Only the two interface locks.
  - Strength: Very small.
  - Tradeoff: The stale tab and the lost answer stay.
  - Confidence: HIGH.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A

### F2 — The approved page cannot say why a norm was lowered

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/schedules/[id]/assign.astro:38-56
- **Detail**: As planned, an approved schedule shows no absence markers and no copy of the absences is stored, so "Godziny" can show a lowered norm with no visible reason, and later absence edits make it unrecoverable.
- **Fix A ⭐ Recommended**: One sentence on the approved page: the norm counts the absences approved at the moment of approval, which are not shown.
  - Strength: No migration, no new health data.
  - Tradeoff: The reason is still not recorded.
  - Confidence: HIGH.
  - Blind spot: Whether a real planner needs the record.
- **Fix B**: A new migration with a planner-only snapshot of the absences.
  - Strength: The record explains itself.
  - Tradeoff: Frozen health data; old approvals cannot be filled reliably.
  - Confidence: MEDIUM.
  - Blind spot: Not designed.
- **Decision**: FIXED via Fix A

### F3 — A malformed record from a direct RPC breaks the approved page for good

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261127084657_schedule_approval.sql:428-461; src/lib/services/violation-view.ts:87
- **Detail**: `approve_schedule` accepts findings without `anchors` or `reason` from a planner calling it directly; the page would then fail on every load, and approval cannot be undone. The app never sends such a payload. The failed page is inferred, not run.
- **Fix**: Read stored findings tolerantly in `getApproval`.
- **Decision**: FIXED

### F4 — Shifts and employees are read without the completeness check

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/schedules/[id]/approve.ts:34-35; src/lib/employees.ts; src/lib/shifts.ts
- **Detail**: Past `max_rows` (1000 locally) a used shift or person could be cut off, and approval would fail forever with `schedule_changed`. It fails closed.
- **Fix**: Count exactly and use `assertExactCount`.
- **Decision**: FIXED

### F5 — Two gaps in the smoke assertions

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: scripts/smoke.mjs (approval tables and the role matrix of the approve route)
- **Detail**: No update on the three approval tables and no insert into the two snapshot tables is tried; the 401 and 403 steps of the route do not assert the `error` field.
- **Fix**: Add the missing steps and assertions.
- **Decision**: FIXED

### F6 — The confirmation panel steals the keyboard focus

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/schedules/ApprovalSection.tsx:59, 95
- **Detail**: With the panel open, a shift click unmounts it while saving; it mounts again and `autoFocus` pulls the focus away from the grid. From reading the code, not tried.
- **Fix**: Close the panel when a save starts.
- **Decision**: FIXED

### F7 — Small wording and documentation drift

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/components/schedules/ScheduleNotice.astro:9; CLAUDE.md (approval paragraphs); README.md:184-188; src/lib/schedule-options.ts:84-95
- **Detail**: The approved notice says "pracownikom", the plan fixed "pracownikowi". CLAUDE.md writes `set search_path = '` with a quote missing. README route rows do not mention the read-only pages or 409 `schedule_approved`. People of a snapshot can be ordered differently from the live list.
- **Fix**: Correct CLAUDE.md and README; keep the notice and the order unless the author wants them changed.
- **Decision**: FIXED
