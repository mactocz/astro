<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Absence entry (S-07)

- **Plan**: context/changes/absence-entry/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4, 5, 6
- **Date**: 2026-11-27
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 8 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

## Automated verification (run on master at 14437e7 plus the Progress commits)

- `npx astro sync`, `npm run lint`, `npx astro check` (126 files, 0/0/0), `npm test` (20 files, 2008 tests), `npm run build`: PASS.
- `npm run smoke`: not run in the main checkout (its `.env` points at a hosted project, the smoke refuses it). Evidence: 931/931 locally on the same code, and the jobs `ci` and `smoke` of PR #15 green on the last commit (0d01f3a, same tree as the merge).

## Notes without a finding

- Plan drift: no MISSING item. Differences where the code is better than the plan text: en dash in date ranges (as `formatPeriod`), the Sunday qualifier kept in `HOURS_NOTE`, "oraz" joining several holidays with an absence, `[id].astro` loads only the person of the absence, the marker says "(niezatwierdzona)" for a requested absence.
- EXTRA, harmless: a second smoke schedule `Smoke-<runId>-absences-holiday`, an empty-roster branch in `new.astro`, the roadmap note on the resolved unknown. Nothing from the "What We're NOT Doing" list was added.
- Documentation edits touched a few existing long lines of CLAUDE.md and AGENTS.md (they corrected statements that became false); expect hand-resolved conflicts there when S-08 is rebased.
- The roadmap still says S-07 `in-progress`; `/10x-archive` closes it.
- Manual Progress rows (1.4, 2.4, 3.4, 4.3, 4.4, 5.3, 5.4) were ticked in the phase commits; the author's approvals and the browser checks are not stored as artifacts in the repo (they happened in the session).

## Findings

### F1 — `/absences` reads and renders every absence ever stored

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/absences/index.astro:16; src/lib/absences.ts:16, 78-96
- **Detail**: `listAbsences` has no limit, no date filter and no pagination, and `toSortedAbsences` throws when the answer reaches 1000 rows. Scenario: about 50 employees with about 20 entries a year reach 1000 rows in roughly a year; from then on `/absences` answers 500 for every planner, and since the list is the only way to an edit or delete link, old entries can no longer be pruned from the app. Each row also calls `formatAbsenceRange` about four times and the HTML is rendered twice (table and cards), an unmeasured CPU cost near the cap against the 10 ms Free limit. `/schedules` solves the same problem with `SCHEDULE_LIST_LIMIT` (100) and a note on the page.
- **Fix A ⭐ Recommended**: List with a database-side order (latest start first) and a limit (200), and show a note on the page when more exist, as `/schedules` does; keep the throwing `READ_LIMIT` guard only for the reads that feed the rules.
  - Strength: Same pattern as the schedule list; the page can never fail from volume; the cost per render is bounded.
  - Tradeoff: Older entries are no longer reachable from the list (only by URL) until a filter or paging exists.
  - Confidence: HIGH — `SCHEDULE_LIST_LIMIT` and its note are in the repo.
  - Blind spot: The real CPU of the page near 200 rows was not measured.
- **Fix B**: Default to absences that end within the last 12 months and add a "Pokaż starsze" link (query parameter).
  - Strength: Keeps all history reachable and the default list short.
  - Tradeoff: A new query parameter, a second state of the page and more smoke steps.
  - Confidence: MEDIUM — depends on how planners actually use old entries.
  - Blind spot: Whether the filter should apply to start or end date.
- **Decision**: FIXED (0ef6d4d), Fix B: domyślnie nieobecności zakończone w ostatnich 12 miesiącach i link "Pokaż starsze", oba widoki z limitem i sortowaniem po stronie bazy (follow-ups/review-fixes.md, punkt 1)

### F2 — Phase 6 evidence is thinner than the contract (rows 6.5 and 6.6)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/deployment/deploy-plan.md:157-175; context/changes/absence-entry/plan.md (Progress 6.5, 6.6)
- **Detail**: Row 6.5 requires that `/absences` and the markers work on production, but `deploy-plan.md` only says the state was confirmed by the user and does not record that check (the author did confirm it in the session). Row 6.6 asks for the median and p99, preferably on a schedule with absences and with the first request in a new isolate; only a whole-Worker median of 5.41 ms is recorded (the file states the gaps and the risk for S-08 and S-09 itself, so the alternative "result with a decision" is met).
- **Fix**: Add one line to `deploy-plan.md` saying that on 2026-11-27 the author confirmed that `/absences` and the cell markers work on production; keep the p99 and cold-isolate measurement as an item for S-08.
- **Decision**: FIXED (0ef6d4d): linia z potwierdzeniem autora w deploy-plan.md; p99 i zimny izolat zostają dla S-08 (punkt 2)

### F3 — The truncation guard assumes the server's `max_rows` is exactly 1000

- **Severity**: 👁 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/absences.ts:16, 78-84; supabase/config.toml:18
- **Detail**: `READ_LIMIT` equals the local `max_rows`, but the hosted project's Max Rows is a separate setting that nobody checked. If it is lower than 1000, a truncated answer is not detected and the rules judge an incomplete absence set: a collision is silently missed, which is the false compliance `safeEvaluate` exists to avoid. `assignments.ts` has the same pattern, so this is not new, but absences feed the rules directly.
- **Fix**: Detect truncation independently of the setting: request an exact count (`select(COLUMNS, { count: "exact" })`) and throw when `count > data.length`; keep `READ_LIMIT` as the second guard.
  - Strength: Correct whatever the hosted `max_rows` is.
  - Tradeoff: One extra count per read; `assignments.ts` keeps the older pattern until it is changed too.
  - Confidence: MEDIUM — supabase-js count semantics with `.lte/.gte` filters were not run against the hosted project.
  - Blind spot: The actual hosted `max_rows`.
- **Decision**: FIXED (0ef6d4d): dokładna liczba (count exact) jako niezależne wykrywanie obcięcia, READ_LIMIT jako druga straż (punkt 3)

### F4 — The reason text of an absence violation carries the sick-leave type next to a name

- **Severity**: 👁 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/rules.ts:626-630, 662, 671; src/types.ts (`Violation.reason`)
- **Detail**: "zwolnienie lekarskie (L4)" appears in `reason` together with the employee's name. Today the page is planner-only and `no-store`, so nothing leaks. S-08 freezes `reason` as text in the approval record, and S-11 will show approved schedules to employees: another employee could then learn that a colleague is on sick leave (health data).
- **Fix A ⭐ Recommended**: Record the constraint in the S-08 plan now (the frozen violations stay planner-only, or the type is redacted to "nieobecność" in what an employee reads).
  - Strength: No change to S-07 code or texts; the decision is taken where the data is frozen.
  - Tradeoff: The constraint must be remembered and tested in S-08 and S-11.
  - Confidence: HIGH — the S-08 plan is open and in a worktree.
  - Blind spot: Whether S-11 shows violations to employees at all.
- **Fix B**: Redact the type in the reasons of S-07 now ("przypada na nieobecność ...").
  - Strength: Safe by construction for every later consumer.
  - Tradeoff: Changes the reason texts, the key tests and many smoke assertions, and the planner loses the type in the list.
  - Confidence: MEDIUM — the planner may want the type in the reason.
  - Blind spot: Planner preference.
- **Decision**: FIXED (0ef6d4d), Fix A (zapis w planie S-08): ograniczenie zapisane w planie S-08 (zamrożone wskazania tylko dla planisty albo redakcja typu); bez zmian w kodzie S-07 (punkt 4)

### F5 — Marker and reason can name different absences for a night shift; the docs overclaim

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/absence.ts:207-256; src/lib/services/absence.test.ts:1084-1132; CLAUDE.md:57
- **Detail**: The marker of a cell names the strongest absence covering that day; the reason names the strongest absence overlapping the shift interval. For a night shift they can differ (a requested absence on day D and an approved one from D+1: cell D shows "(niezatwierdzona)", the critical reason names the approved one; with only an absence on D+1, cell D has "Krytyczne: 1" and no marker). The drift test uses morning shifts only, and CLAUDE.md says the marker is "the one the reason names".
- **Fix**: Add a night-shift case to the drift test that pins this behaviour and soften the sentence in CLAUDE.md to "for a shift within one day".
- **Decision**: FIXED (0ef6d4d): test nocny przypinający zachowanie i złagodzone zdanie w CLAUDE.md (punkt 5)

### F6 — Every status other than `approved` is treated as `requested`

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/rules.ts:657-675; src/lib/services/absence.ts:211-218, 268-270
- **Detail**: Only `rejected` is skipped and `approved` is critical; anything else becomes a warning and "(niezatwierdzona)". A status added by S-14 or S-15 (for example `cancelled`) would compile and silently produce warnings and markers.
- **Fix**: Map the status through an exhaustive `Record<AbsenceStatus, ...>` (or a `switch` with a `never` check), as `RULE_RANK` does for rules.
- **Decision**: FIXED (0ef6d4d): wyczerpujące mapowanie statusu (Record lub switch z never) w regułach i znacznikach (punkt 6)

### F7 — `other` lowers the norm like an excused absence, and a typo in a year is not flagged

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/absence.ts:29-33, 73-108; context/foundation/work-time-rules.md (D7)
- **Detail**: D7 lowers the norm for every approved absence, while art. 130 § 3 speaks of an excused absence, so an unexcused absence entered as `other` makes the `weekly_norm` warning fire less often than the law would. Also the only length limit is the 2020-2099 range: 2026-11-02 to 2062-11-06 is accepted, zeroes the norm and raises criticals for that person in every schedule in between (the list shows the range).
- **Fix**: Add a hint under the type select ("Inna nieobecność: usprawiedliwiona, obniża normę") and show the number of days in the list or the form so an absurd length is visible; no database constraint.
- **Decision**: FIXED (0ef6d4d): podpowiedź pod polem rodzaju i liczba dni na liście (punkt 7)

### F8 — Forward-looking gaps of the edit page and the `PUT` contract

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/absences/[id].ts:29-34; src/pages/absences/[id].astro:41-50; supabase/migrations/20261126204500_absences.sql:21
- **Detail**: (a) The edit page does not show `status`, and the update policy has no status condition, so once `requested` or `rejected` rows exist (S-14, S-15) a planner could edit or delete a request without seeing its status. (b) `PUT` requires a valid `employeeId` and then ignores it, unlike the shift `PUT` that stores every validated field (documented in a comment). (c) `employee_id` cascades, so a future employee delete or archive feature would drop the absence history including L4 records (today only the service role can delete employees).
- **Fix**: Show the status read-only on the edit page now; leave (b) and (c) as notes for S-14 (decide there whether non-approved rows are editable, and prefer soft deletion over a cascade).
- **Decision**: FIXED (0ef6d4d): status tylko do odczytu na stronie edycji; (b) i (c) jako notatki do S-14 (punkt 8)

### F9 — Small CPU costs on the Worker path, and the p99 is still unmeasured

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/absence.ts:184-205; src/lib/services/rules.ts:580-582; src/lib/services/workload.ts:66-68
- **Detail**: `excusedWeekdays` runs twice per person with absences (rules and workload) and each call rebuilds `dayColumns(startDate)` and `weekdayOf(startDate)`; `listAbsencesOverlapping` loads the absences of all employees for the window and the roster filter runs in code, with only `employee_id` indexed. Fine at today's scale; the median is 5.41 ms but p99 and the cold isolate were never measured.
- **Fix**: Hoist `dayColumns` and `weekday` out of the per-person calls when S-08 next touches these files, and measure p99 of the assignment page before S-08 adds server-side evaluation.
- **Decision**: SKIPPED: p99 strony obsadzania zmierzyć przed S-08 (zapisane w F2); wynoszenie obliczeń dni tygodnia przy najbliższej zmianie w tych plikach

### F10 — Duplicated helpers, a domain filter in the data module, and stale documentation lines

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/absences.ts:6, 112-125; src/lib/services/rules.ts:633 and src/lib/services/absence.ts:259; AGENTS.md:23; CLAUDE.md:50
- **Detail**: `lowerFirst` is byte-identical in `rules.ts` and `absence.ts` and `dayAndMonth` is duplicated; `absencesOfRoster` (a domain filter) sits in the data module whose header says it holds no business rule, while the convention puts pure functions in `services/`. AGENTS.md:23 puts `excusedWeekdays` under `work-hours.ts` (it is in `absence.ts`; only `weeklyNormExcused` is in `work-hours.ts`), and the S-05-era paragraphs (CLAUDE.md:50, AGENTS.md:19, README.md:201) still describe the norm as FTE minus holidays only, which the later paragraphs correct.
- **Fix**: Export `lowerFirst` and a shared day-and-month formatter from `absence.ts`, move `absencesOfRoster` to `services/absence.ts`, correct AGENTS.md:23 and add "(and, since S-07, approved absences, see below)" to the three S-05-era norm sentences.
- **Decision**: FIXED (0ef6d4d): wspólne pomocniki, absencesOfRoster do services, poprawki dokumentacji (punkt 9)
