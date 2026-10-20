<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Role based access Implementation Plan

- **Plan**: context/changes/role-based-access/plan.md
- **Mode**: Deep
- **Date**: 2026-10-20
- **Verdict**: REVISE
- **Findings**: 1 critical, 1 warning, 5 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | FAIL |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding

Grounding: 19/19 existing paths ✓, 6/6 new targets absent ✓, line references spot-checked ✓, brief↔plan ✓ (one promise gap, F3), Progress↔Phase ✓ (1 `## Progress`, 25 rows mapping 1:1, no checkboxes outside Progress). Deep check: one sub-agent verified 12 risky claims against Astro 7.3.2, @astrojs/cloudflare 14.3.1 and Supabase CLI 2.117.0 sources; the two decisive results (middleware re-run on rewrite, `[auth.email] enable_signup` mapping) were re-verified by the reviewer in `node_modules`. Confirmed: status set by a rewritten page reaches the client; static assets bypass the Worker; `app_metadata` is admin-only and present in the JWT; `[auth] enable_signup = false` does not touch the admin API or password grant; `ANON_KEY`/`SERVICE_ROLE_KEY` are still printed by `supabase status -o env`; the revoke-from-`anon` pattern is correct and an anon RPC returns 401.

## Findings

### F1 — The 401/403 split is lost: `context.rewrite()` re-runs the middleware and wipes `locals.denial`

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: End-State Alignment
- **Location**: Phase 2 — changes 1 (Locals), 2 (Middleware), 3 (Strona odmowy)
- **Detail**: The plan sets `locals.denial = null` on every middleware run, sets it on denial and calls `context.rewrite("/access-denied")`, and the page derives 401 vs 403 from `locals.denial`. In Astro 7.3.2 `context.rewrite()` goes through `executeRewrite`, which ends in `handleMiddleware(state, handlePages)` (node_modules/astro/dist/core/rewrites/handler.js:61), so the user middleware runs a second time on `/access-denied` (public, allowed). `locals` is one object per request (fetch-state.js:152, 234) and is not invalidated by the rewrite, so the second run's reset to `null` erases the reason. Result: the page always answers 403, anonymous visitors never get the 401 the user chose, and the smoke assertions in 2.2 (anonymous → 401) fail. The second run also repeats `createClient` + `getUser()`, an extra Supabase round trip on every denied request.
- **Fix**: Derive the status in the page from state that survives the rewrite and avoid the second pass. In `access-denied.astro` set 403 when `Astro.locals.user` is set and 401 otherwise; drop `locals.denial` and its `Locals` field (and `AccessDenial` from `env.d.ts`); in the middleware return `next("/access-denied")` instead of `context.rewrite("/access-denied")`, which rewrites without re-entering the middleware (node_modules/astro/dist/core/middleware/astro-middleware.js:22-33).
  - Strength: The status no longer depends on a value that the second pass can overwrite, and there is a single `getUser()` per denied request; one fewer field in `Locals`.
  - Tradeoff: Relies on `next(payload)` rewrite semantics, which were read in the Astro source but not run; if they misbehave the derived status still holds with `context.rewrite`, at the cost of the second `getUser()`.
  - Confidence: HIGH for the re-run and shared `locals` (re-verified in handler.js and fetch-state.js); MED for `next(payload)` (code read only).
  - Blind spot: Cookie handling on the `next(payload)` path (`applyRewriteToState` without `mergeCookies`); Phase 2 smoke cookies and the browser check (2.6) cover it.
- **Decision**: PENDING

### F2 — Criterion 3.2 cannot pass because Phase 1 test (d) contains `/auth/signup`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 — Success Criteria 3.2 vs Phase 1 — change 3, case (d)
- **Detail**: 3.2 requires `Get-ChildItem src -Recurse -File | Select-String -Pattern 'auth/signup|confirm-email|SignUpForm'` to return no matches. Phase 1 test (d) ("usunięta trasa `/auth/signup` jest tylko dla planisty") puts the literal `/auth/signup` into `src/lib/services/access.test.ts`, so 3.2 matches that file and fails regardless of how well the routes were removed.
- **Fix**: Drop case (d) from the Phase 1 test contract; it is redundant with case (c), where the future path `/employees` already proves the default-deny tier.
- **Decision**: PENDING

### F3 — `/planner` is described as the planner's landing page after sign-in, but nothing sends the planner there

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: End-State Alignment
- **Location**: Phase 2 — change 4; plan-brief.md (Key Decisions row "Dowód bramki planisty", Desired End State)
- **Detail**: Phase 2 calls `/planner` the "punkt startowy planisty po logowaniu", and the brief repeats it as "punkt startowy planisty". Sign-in still redirects to `/` (src/pages/api/auth/signin.ts:19, asserted by smoke), `/` shows only the starter marketing page, and the only link to `/planner` is on `/dashboard`. The page is a gate target, not a landing page.
- **Fix**: Reword to "cel dla smoke i strona dostępna z `/dashboard` dla planisty" in Phase 2 change 4 and in the brief's decision table; keep the sign-in redirect unchanged.
- **Decision**: PENDING

### F4 — Default-deny also closes unknown paths and Astro's internal routes for anonymous visitors

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 — change 2 (policy table); Desired End State
- **Detail**: Requests that match no route fall to Astro's default `/404` route and pass through the middleware (core/routing/handler.js:80, fetch-state.js:744-749), so an anonymous `GET /robots.txt` or `/favicon.ico` becomes 401 instead of 404. Astro also injects `/_image` (server output) and `/_server-islands/[name]` (any adapter) through the Worker (core/routing/create-manifest.js:529-534); today `src/` uses neither, but a future public page with `<Image>` or `server:defer` would break for anonymous users with no obvious cause. Static assets are unaffected (served by the ASSETS binding first).
- **Fix**: Add one sentence to the Phase 1 policy contract: unknown paths and Astro internal routes (`/_image`, `/_server-islands/*`) are planner-only until a slice that needs them lists the concrete path in the table. No code change now.
- **Decision**: PENDING

### F5 — Smoke guard checks only smoke's own `SUPABASE_URL`, not the Supabase the app under test uses

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 — change 5 (smoke) and Success Criteria 2.2
- **Detail**: The guard (host must be 127.0.0.1/localhost) protects hosted projects from user creation, which is right. But 2.2 lists only `supabase start`, `build` and `preview` plus three smoke variables; the previewed app reads `.env`/`.dev.vars`, which do not exist in the worktree and, in the author's checkout, may point at the hosted project (as in the deploy, `deploy-plan.md:50-52`). CI writes them from the local stack (`ci.yml:44-48`). With a mismatch the sign-in step fails with an opaque "invalid credentials" and a first-time implementer will lose time.
- **Fix**: State in 2.2 and in the Phase 2 smoke contract that `.env`/`.dev.vars` must point at the local stack (values from `supabase status -o env`, as `ci.yml:44-48` does), and make the first sign-in step print "the app under test is not using SUPABASE_URL" when an admin-created user cannot sign in.
- **Decision**: PENDING

### F6 — `create-planner.mjs` does not say how it finds an existing account to promote

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 — change 3
- **Detail**: The contract says the script promotes an existing account "gdy adres już istnieje", but the Supabase admin API has no get-by-email endpoint; the implementer has to choose a lookup. Promoting existing production test accounts is the main use of this branch, so a wrong guess (e.g. case-sensitive compare, no pagination) would silently create or miss an account.
- **Fix**: Specify: on the `email_exists` response of `POST /auth/v1/admin/users`, page through `GET /auth/v1/admin/users?page=N&per_page=1000` until the lowercased email matches (GoTrue stores emails lowercased), then `PUT /auth/v1/admin/users/{id}` with `app_metadata: { role: "planner" }`; exit non-zero when no match is found.
- **Decision**: PENDING

### F7 — Between Phase 2 and Phase 3 the signup links are dead, and the Phase 3 smoke step does not prove deletion

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 — change 5 ("trasa jeszcze istnieje do Fazy 3"); Phase 3 — change 4
- **Detail**: After Phase 2 the default-deny gate already blocks `/auth/signup`, `/auth/confirm-email` and `POST /api/auth/signup` for anonymous users, so the "Sign up" links in Topbar.astro:27, Welcome.astro:36 and signin.astro:17 lead to the access-denied page until Phase 3 removes them. Phase 2's statement that the route "jeszcze istnieje" is true only in the file system. The Phase 3 smoke step `POST /api/auth/signup` → 401 already passes after Phase 2, so it proves the gate, not the deletion; deletion is proven by 3.2.
- **Fix**: Say so in the plan: Phases 2 and 3 ship in the same PR/deploy (do not deploy Phase 2 alone), reword Phase 2 change 5 to "trasa jest już zablokowana bramką, usuwana w Fazie 3", and label the Phase 3 smoke step as a gate check.
- **Decision**: PENDING
