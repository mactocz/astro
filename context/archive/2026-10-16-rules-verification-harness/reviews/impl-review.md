<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Rules verification harness Implementation Plan

- **Plan**: context/changes/rules-verification-harness/plan.md
- **Scope**: Full plan (Phase 1, 2 and 3 of 3)
- **Reviewed phases**: 1, 2, 3
- **Date**: 2026-10-20
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | WARNING |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — expectDeterministic can pass without comparing anything

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/testing/determinism.ts:45
- **Detail**: Two ways the helper passes while checking nothing, both reproduced with throwaway probes. (a) An async `fn`: the repeated results are two distinct Promises, deep equality has no Promise branch and Promises have no own keys, so `expectDeterministic(async () => Math.random(), 1)` passes. (b) `runs: 1` with no `variants`, or `variants: []`, makes zero comparisons and passes, although `runs < 1` is deliberately rejected "instead of silently checking nothing". Rule functions in S-05/S-09 may become async once they touch Supabase, and a generated variants list that ends up empty is a realistic accident.
- **Fix**: Make "nothing was compared" an error: throw a TypeError when the baseline is thenable (`typeof (baseline as { then?: unknown } | null)?.then === "function"`) and a RangeError when `runs === 1 && variants.length === 0`; add one test for each.
  - Strength: Closes both holes in the one function where they arise, in the same style as the existing `runs` guard.
  - Tradeoff: A caller who wants a single-run smoke check must now supply a variant; thenable detection is runtime-only and will not catch an `any`-typed async function.
  - Confidence: HIGH — both holes were reproduced with probes.
  - Blind spot: Whether S-05's rules stay synchronous; if they go async the helper needs an awaiting variant, not just a guard.
- **Decision**: FIXED (Fix now, 2026-10-20) — added `isThenable` guard (TypeError) and a nothing-to-compare guard (RangeError) in determinism.ts, plus 2 tests. Verified: 10/10 tests, lint, astro check, prettier; break-check red per guard.

### F2 — "tests next to the code" can pull vitest into the Worker bundle

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: AGENTS.md:24, CLAUDE.md:12 (include pattern at vitest.config.ts:17)
- **Detail**: The docs say tests are `src/**/*.test.ts` "next to the code", and the include pattern also matches `src/pages/`. Astro treats any `.ts`/`.js` file under `src/pages/` as an endpoint and ignores only names starting with `_` (node_modules/astro/dist/core/routing/create-manifest.js:81,92), so a test colocated with an API route (e.g. `src/pages/api/auth/signin.test.ts`) would become a route and drag `vitest` into the SSR/Worker build. The docs also do not say why `astro:*` imports are banned from tested code: vitest.config.ts has no Astro plugin, so modules importing `astro:env/server` (e.g. src/lib/supabase.ts) cannot resolve under this harness. Optional hardening: an ESLint `no-restricted-imports` rule for `vitest` outside `*.test.ts` and `src/lib/testing/**`.
- **Fix**: Add one sentence to both docs: never put `*.test.ts` under `src/pages/` (test logic from `src/lib/`, or prefix the file with `_`), and `astro:*` modules do not resolve in the test environment.
- **Decision**: FIXED (Fix now, 2026-10-20) — added the `src/pages/` warning and the `astro:*` note to AGENTS.md:24 and CLAUDE.md:12. Prettier-clean on the edited lines. Optional ESLint `no-restricted-imports` rule not added.

### F3 — Tests would stay green if key helper behaviours broke

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/testing/determinism.test.ts:20, 27, 37-52
- **Detail**: Verified by replacing `seededShuffle` with a seed-ignoring `reverse()`: all 6 tests stay green, although different seeds giving different orders is what makes caller-built `variants` useful. The bare `.toThrow()` at lines 20 and 27 would also pass if the helper threw for an unrelated reason. The documented rule that a result must be in canonical order (not echo the input order) has no test, although the helper does flag it (probe verified).
- **Fix**: Add assertions that different seeds yield more than one distinct order, a golden vector for `seededShuffle(shifts, 42)`, message matchers (`/variant 0/`, `/run 2/`), and an echo-order case `(xs) => [...xs]` with a reversed variant.
- **Decision**: FIXED (Fix now, 2026-10-20) — determinism.test.ts: message matchers, echo-order case, golden vector `[3, 5, 7, 2, 9, 1]` for seed 42, different-seeds assertion. Verified: 12/12 tests, lint, astro check, prettier; break-check: seed-ignoring shuffle now turns 2 tests red, renamed error texts turn the matching tests red.

### F4 — In-place mutation of the shared input is not detected

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/testing/determinism.ts:45-52
- **Detail**: The same `input` and `variants` object references are passed to `fn` on every call. A function that sorts or mutates its argument in place is not caught when its result is order-independent, and it silently mutates shared fixtures. Verified by probe: the shared array ended up sorted while the check passed.
- **Fix**: Pass a `structuredClone` (or a deep-frozen clone) of the input and each variant on every call, so in-place mutation fails loudly (note `structuredClone` throws on function-valued fields).
- **Decision**: SKIPPED (2026-10-20) — lowest-value finding; shared-fixture mutation by the function under test remains undetected by the helper.

### F5 — Unplanned dependency side effects

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: package-lock.json (zod), vitest.config.ts
- **Detail**: (1) Transitive `zod` moved from 4.6.2 to 4.6.5 because the plugin pins it exactly, while Astro also requires `zod ^4.3.6`; a patch bump in a test-tooling change that the plan did not mention. (2) Tests run on a different engine than dev and build: nested wrangler 4.151.1 / miniflare 5.20261012.1-beta / workerd 1.20261012.1 versus the root's 4.131.1 / 1.20260911.1. The plan acknowledges this (wrangler alignment is out of scope) and it needs two exact-version `allowScripts` entries. (3) `vite` and `@types/node` are used through hoisting and are not declared. Disclosed extras (the `runs` guard, 6 tests instead of 4, the exported `DeterminismOptions`, the CPU-limit sentence in AGENTS.md) were flagged to the author during implementation and accepted.
- **Fix**: No code change. (Corrected during triage: the original remedy, aligning the root `wrangler` with the plugin's copy, does not work. A dry-run showed `@cloudflare/vite-plugin@1.54.8`, used by `@astrojs/cloudflare`, pins `wrangler 4.131.1`, `miniflare 5.20260911.0-alpha` and `workerd 1.20260911.1` exactly. `npm install -D wrangler@^4.151.1` would resolve to 4.151.2 with a third `workerd` 1.20261019.1 needing another `allowScripts` approval, and would still keep the nested 4.131.1.) Dedupe becomes possible only when `@astrojs/cloudflare` bumps its `@cloudflare/vite-plugin` pin.
- **Decision**: ACCEPTED (2026-10-20) — risk accepted: tests run on a newer wrangler/miniflare/workerd than dev and build; transitive zod 4.6.2 → 4.6.5; two exact-version `allowScripts` entries. Revisit when `@astrojs/cloudflare` updates its vite-plugin pin. No dependency change was made.

## Verification evidence

- **Reviewers**: two independent read-only reviewers (plan drift; safety/quality/patterns). Drift review: every planned item MATCH, no MISSING or DRIFT, nothing violates "What We're NOT Doing". Safety review: no CRITICAL findings, no secrets, no injection, CI step has no secrets, all 56 added lockfile URLs on registry.npmjs.org, exactly one new install-script package (workerd 1.20261012.1, approved).
- **Automated criteria re-run (worktree at origin/master ffaec51, 2026-10-20)**: `npm ci` exit 0 with 0 install-scripts warnings; `npm test` 8/8 in workerd; `npm run lint` exit 0; `npx astro check` 0 errors, 0 warnings, 0 hints (33 files); `npx astro sync` and `npm run build` exit 0; ci.yml has `npm test` on line 22 between `astro check` (21) and `build` (23); AGENTS.md has no "No unit-test runner".
- **Manual items**: 1.5 is visible in the diff (package.json `allowScripts`). 2.4 is an author review and has no artifact. 3.4: GitHub Actions run for PR #1 head d52b645 is success (job `ci` incl. step `npm test` on Node 22, job `smoke`), and the push run on master ffaec51 is success. 3.5: author-confirmed, plus a clean clone of the pushed branch passed `npm ci` and `npm test`.
- **Probes (throwaway, removed, worktree clean afterwards)**: async function passes vacuously; `runs: 1` and `variants: []` check nothing; echoing input order is flagged; in-place sort of the shared input is not detected; seed-ignoring shuffle keeps all 6 tests green.
