<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Schedule generation

- **Plan**: context/changes/schedule-generation/plan.md
- **Mode**: Deep
- **Date**: 2026-11-27
- **Verdict**: REVISE (SOUND after the fixes, with the risk of F1 accepted)
- **Findings**: 2 critical, 3 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | FAIL |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | FAIL |
| Plan Completeness | WARNING |

## Grounding

6/6 paths ✓, symbols ✓, brief↔plan ✓, Progress↔phases ✓. One sub-agent verified the code; the time of one evaluation (about 0,05 ms) and the gap of F2 were also run in a temporary test, removed afterwards.

## Findings

### F1 — One generation can lock the assignment page

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2
- **Detail**: `listAssignments` throws from 1000 rows (`src/lib/assignments.ts:72`), and the plan's cap (sum of the required counts) allows 34 650. The page, with "Usuń wygenerowane", stops opening. Reachable with about 100-200 people.
- **Fix**: Refuse in the route when stored plus new would reach 1000, stop the generator earlier and say so, count exactly.
- **Decision**: ACCEPTED (the author accepts the risk)

### F2 — The generator can add a shift that breaks 8 h in a day

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Implementation Approach; Phase 1
- **Detail**: `dailyHours` skips windows that open inside a reported one (`rules.ts:377-395`), so for a person with a violation a new breach gives no new key and no anchor. The planned property test shares the blind spot.
- **Fix A ⭐ Recommended**: A person with an existing `daily_hours` violation gets nothing.
  - Strength: Complete and simple, like the weekly limits.
  - Tradeoff: More gaps.
  - Confidence: HIGH — without an existing violation nothing is skipped before the first new breach.
  - Blind spot: None significant.
- **Fix B**: A check in `rules.ts` of every window holding the new shift.
  - Strength: Fewer gaps.
  - Tradeoff: New code in the rules.
  - Confidence: MEDIUM — not designed.
  - Blind spot: The same skip stays in the live list.
- **Decision**: FIXED via Fix A (and an independent window check in the property test)

### F3 — The performance target is out of reach

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 1; Critical Implementation Details
- **Detail**: 100 people and 350 cells under 3 s needs far more evaluations than 0,05 ms each allows.
- **Fix A ⭐ Recommended**: A realistic target (30 people, 100 cells) and lazy evaluation.
  - Strength: Fits the PRD's typical team.
  - Tradeoff: Very large schedules take longer.
  - Confidence: MEDIUM — measured in the test runtime, not in a browser.
  - Blind spot: Browser timing.
- **Fix B**: A faster check in `rules.ts`.
  - Strength: Keeps the large scale.
  - Tradeoff: A second way of judging the rules.
  - Confidence: LOW — not designed.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A

### F4 — A rolled back click loses `source`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 3 — useAssignments
- **Detail**: `toggle` rolls back with an input without `source` (`useAssignments.ts:103-128`).
- **Fix**: Restore the previous stored entry.
- **Decision**: FIXED

### F5 — DELETE checks the status before deleting

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2
- **Detail**: An approval in between makes the delete a silent no-op answered with 200.
- **Fix**: Delete first, check the status on zero rows.
- **Decision**: FIXED

### F6 — The place of the new section is undecided

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3
- **Detail**: "Above the list or under the grid"; the smoke helpers cut the HTML by sections and compare row and cell texts.
- **Fix**: Above the people's table, the hidden description outside the table.
- **Decision**: FIXED

### F7 — The stale-page check would be copied

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2
- **Detail**: `approve.ts:33-47` already reads and compares the same data.
- **Fix**: Extract it and use it in both routes.
- **Decision**: FIXED

### F8 — The generator does not see other schedules of the week

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: What We're NOT Doing
- **Detail**: A person on two schedules of the same week can be put on both.
- **Fix**: Say so in the scope and under the buttons.
- **Decision**: SKIPPED
