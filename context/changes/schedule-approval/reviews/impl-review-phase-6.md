<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Schedule approval (S-08), phase 6

- **Plan**: context/changes/schedule-approval/plan.md
- **Scope**: Phase 6 of 6 (deployment)
- **Reviewed phases**: 6
- **Date**: 2026-11-27
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING (F1) |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Reviewed inline, without sub-agents: the phase changes no code, only `context/deployment/deploy-plan.md`.

Success criteria on `master` (`bca10f0`): `npx astro sync`, `npm run lint`, `npx astro check` (0 errors), `npm test` (2144 passed) and `npm run build` passed; CI on `master` after PR #19 is green (6.3; the smoke job covers 6.2, `npm run smoke` was not run again locally). 6.4: `npx supabase migration list` shows `20261127084657` on the hosted project. The deployment at 12:18 UTC follows the merge of PR #19 (`wrangler deployments list`). 6.5 and the number of 6.6 rest on the author's confirmation; production was not checked by the agent.

## Findings

### F1 — The CPU measurement is not the one the plan asked for

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/deployment/deploy-plan.md ("Czas CPU po S-08"); context/changes/schedule-approval/plan.md (phase 6, contract)
- **Detail**: The contract asks for the median and p99 of the approve route and of the assignment page, the first request of a new isolate, on a schedule with a dozen or so assignments. Recorded is one number, 7,7 ms, without percentile, route or size. If it is a median, p99 may be over the 10 ms limit; the value has grown from 4,8 ms (S-05) and 5,41 ms (S-07).
- **Fix**: Read p50 and p99 from the Cloudflare panel and add them to the record; otherwise keep the number and measure before S-09, as the record says.
- **Decision**: FIXED differently: p50 7,19 ms and p99 41,55 ms recorded; p99 is over the 10 ms limit; route, size and first request still unmeasured

### F2 — The decision in the deployment record was written by the agent

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/deployment/deploy-plan.md ("Czas CPU po S-08", "Decyzja")
- **Detail**: The author gave the number; the text "the architecture stays, measure again before S-09" follows the earlier records but the author has not confirmed it.
- **Fix**: Confirm or change the decision.
- **Decision**: ACCEPTED: the author confirmed the decision on 2026-11-27
