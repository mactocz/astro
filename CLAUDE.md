# Rules for AI

This file provides guidance to AI Agent when working with code in this repository.

## Commands

- `npm run dev` — start dev server (Cloudflare workerd runtime)
- `npm run build` — production build (SSR via `@astrojs/cloudflare`)
- `npm run preview` — preview production build
- `npm run lint` — ESLint with type-checked rules
- `npm run lint:fix` — auto-fix lint issues
- `npm test` — Vitest in the Cloudflare workerd runtime (`@cloudflare/vitest-plugin`, config in `vitest.config.ts`); tests are `src/**/*.test.ts` next to the code but never under `src/pages/` (Astro would turn them into routes), `npm run test:watch` for watch mode. Keep business rules as pure functions in `src/lib/services/` (no `astro:*`, which does not resolve in tests, or `cloudflare:workers` imports) and use `expectDeterministic` from `src/lib/testing/determinism.ts` for repeatable results independent of input order.
- `npm run format` — Prettier (includes prettier-plugin-astro + prettier-plugin-tailwindcss)
- `npm run smoke` — dependency-free smoke test (`scripts/smoke.mjs`) against a running server, `BASE_URL` env (default `http://localhost:4321`). It covers the auth flow, the role matrix, closed registration and the employee and shift data: the `employees` and `shifts` tables through PostgREST (RLS), the `/api/employees` and `/api/shifts` routes and the planner's `/employees` and `/shifts` pages. It also covers the invitation flow: the `user_id` / `invited_at` / `activated_at` columns, the own-row policy and the `mark_account_active` function, the mail templates, `POST /api/employees/<id>/invite` (invite, invite again, password reset, a foreign account), the `/auth/set-password` page and route with tokens taken from the admin API (`generate_link`; it never reads mails), and what the planner's pages show (account column, invite button, locked e-mail field). It creates planner, employee and role-less accounts through the admin API of a local Supabase, so it needs `SUPABASE_URL`, `SUPABASE_KEY` and `SUPABASE_SERVICE_ROLE_KEY` (values from `supabase status -o env`; the app under test must read the same stack, with the same service-role key in its `.dev.vars`, because the invitation route reads it there), exits before any request unless the `SUPABASE_URL` host is `127.0.0.1` or `localhost`, and must never be run against a hosted project or the production Worker. Run after dependency upgrades; CI runs it against the production preview with a local Supabase (its Mailpit container stays up, because Auth needs a mail server to hand an invitation to).

Pre-commit hooks: husky + lint-staged runs `eslint --fix` on `*.{ts,tsx,astro}` and `prettier --write` on `*.{json,css,md}`.

## Architecture

**Astro 7 SSR app** with React 19 islands, Tailwind 4, Supabase auth, and shadcn/ui components. Deployed to Cloudflare Workers.

### Rendering mode

Full server-side rendering (`output: "server"` in astro.config.mjs). All pages are server-rendered by default. API routes must export `const prerender = false`.

### Auth flow

- `src/lib/supabase.ts` — creates a Supabase SSR client using `@supabase/ssr` with cookie-based sessions. Uses `astro:env/server` for `SUPABASE_URL` and `SUPABASE_KEY` (server-only secrets declared in astro.config.mjs `env.schema`).
- `src/middleware.ts` — runs on every request, resolves the current user and role (`app_metadata.role`, never `user_metadata`), attaches them to `context.locals.user` / `context.locals.role`, and gates the request with `decideAccess` from `src/lib/services/access.ts`. Default deny: a path missing from the table in `access.ts` is planner-only. A denial is 401 (anonymous) or 403 (wrong role): JSON under `/api/`, otherwise the `/access-denied` page via `next("/access-denied")` (not `context.rewrite()`).
- API endpoints: `src/pages/api/auth/{signin,signout,set-password}.ts`
- Auth pages: `src/pages/auth/signin.astro` and `src/pages/auth/set-password.astro` (public: the link in an invitation or password-reset mail opens it, and the token in the link is the credential)
- Protected page example: `src/pages/dashboard.astro`
- Public registration is closed (no sign-up page or endpoint, `[auth] enable_signup = false` in `supabase/config.toml`); accounts are created through the Supabase admin API: employee accounts by the invitation route (below), the first planner by a script. `node scripts/create-planner.mjs <email>` creates the first planner or promotes an existing account (sets `app_metadata.role` to `planner`). It needs `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, plus `PLANNER_PASSWORD` only for a new account, and works against hosted projects. For this script the service-role key goes into the environment of that one command.
- **Service-role key** (`SUPABASE_SERVICE_ROLE_KEY`, bypasses RLS): a Worker secret in production (`npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY`) and, for local dev and the production preview, an entry in the gitignored `.dev.vars` that holds the key of the local stack only (never a hosted project's key). `astro.config.mjs` declares it as an optional server secret and only `src/lib/supabase-admin.ts` reads it. Only the invitation route `src/pages/api/employees/[id]/invite.ts` may import that module (ESLint `no-restricted-imports` enforces it): do not use the key anywhere else, scripts under `scripts/` excepted, and do not read data with it. The route reads the employee with the planner's session (RLS), and the admin client only talks to Auth and writes `employees.user_id` and `invited_at`.
- **Invitation flow**: `POST /api/employees/[id]/invite` (planner-only, no body) invites a new employee (`inviteUserByEmail`, then `app_metadata.role = "employee"`, then `user_id` and `invited_at`; a failure after the mail removes the account again), sends a new link to an account that never confirmed, and sends a password-reset link to an active one; an address that has a foreign confirmed account gets 409 `account_exists`. The decision is the pure `decideInviteAction` in `src/lib/services/invitation.ts`. The mails are the templates `supabase/templates/{invite,recovery}.html`, configured in `supabase/config.toml` together with `otp_expiry = 604800` (a link works for 7 days, once) and `minimum_password_length = 8`; their links open `/auth/set-password?token_hash=...&type=invite|recovery`. Opening the page spends nothing (mail scanners open links): `POST /api/auth/set-password` (JSON `{ tokenHash, type, password }`) checks the password with `validatePassword` (`src/lib/services/password.ts`, the rule of the PRD: at least 8 characters, an upper-case letter, a digit and a special character) before it spends the token with `verifyOtp` and sets the password with `updateUser`, which also signs the employee in. The form is the `src/components/auth/SetPasswordForm.tsx` island with the `useSetPasswordForm` hook. The password rule is enforced in the app only, not by Supabase. Once the password is saved, the same route calls `supabase.rpc("mark_account_active")` with the employee's own session, also for `recovery` links; a failure of that call is only logged, the answer stays 200.

### Data access

- Read and write data through `Astro.locals.supabase` (the user's session, set per request by the middleware), so RLS decides what a user sees and may change. Query functions live in `src/lib/` (`src/lib/employees.ts`, `src/lib/shifts.ts`), never in pages or routes.
- Validate input with one function shared by the form and the API route, so both give the same answer (`validateEmployeeInput` in `src/lib/services/employee.ts`, built on zod; `validateShiftInput` in `src/lib/services/shift.ts`, plain checks); the server validates again whatever the form sent.
- Employee pages are planner-only: `src/pages/employees/` inside `src/layouts/PlannerLayout.astro`, with the `src/components/employees/EmployeeForm.tsx` island and its `useEmployeeForm` hook (`src/components/hooks/`), saving through `/api/employees` and `/api/employees/[id]`.
- Employee accounts: `employees.user_id` (unique, links the row to its Auth account) and `employees.invited_at` are written only with the service-role key by the invitation route; the column grants let a session write the five roster columns and nothing else. `employees.activated_at` (when the employee first set a password) is written only by the SQL function `public.mark_account_active()` (`security definer`, `set search_path = ''`, execute for signed-in callers only), which `POST /api/auth/set-password` calls with the employee's session: it sets the column on the caller's own row, only for the `employee` role and only while it is null, so the first activation wins and a password reset keeps it. This is the one `security definer` function of the project (a deliberate departure from the first plan of S-10, approved by the author on 2026-11-23); the admin client does not write the column. An employee reads only their own row (policy `employee can select own employee row`). Once `user_id` is set the e-mail cannot change (`emailChangeBlocked` and `EMAIL_LOCKED_MESSAGE` in `src/lib/services/invitation.ts`; the API answers 422 and the form field is read-only). The employee list and the edit page show the account state (`inviteStatus`, `formatInviteLabel`: "Bez konta", "Zaproszony ...", or "Zarejestrowany dd.mm.rrrr" once `activated_at` is set) and the `src/components/employees/InviteButton.tsx` island with its `useInviteEmployee` hook, which calls the invitation route (the button reads "Zaproś", "Wyślij ponownie" or, for an active account, "Resetuj hasło").
- Shift pages (the shift dictionary: name, start and end time) follow the same pattern and are planner-only too: `src/pages/shifts/` inside `PlannerLayout`, with the `src/components/shifts/ShiftForm.tsx` island and its `useShiftForm` hook (`src/components/hooks/`), saving through `/api/shifts` and `/api/shifts/[id]`. The shared PostgREST helpers (`isUuid`, `logDatabaseError`) live in `src/lib/postgrest.ts`.

### Key conventions

- **Path alias**: `@/*` maps to `./src/*` (tsconfig paths).
- **Astro components** for static content/layout; **React components** only when interactivity is needed.
- **Tailwind class merging**: use the `cn()` helper from `@/lib/utils` (clsx + tailwind-merge) for conditional/merged class names. Do not concatenate class strings manually.
- **shadcn/ui**: components live in `src/components/ui/`, "new-york" style variant. Install new ones with `npx shadcn@latest add [name]`.
- **API routes**: use uppercase `GET`, `POST` exports; validate input with zod.
- **Supabase migrations**: `supabase/migrations/` using naming format `YYYYMMDDHHmmss_short_description.sql`. Always enable RLS on new tables with granular per-operation, per-role policies. The role helpers `public.current_app_role()` / `public.is_planner()` (they read `app_metadata.role` from the JWT, `null` / `false` for anything unknown) live in the first migration (`supabase/migrations/*_role_helpers.sql`), whose trailing comment holds the RLS policy pattern to copy.
- **React**: no Next.js directives ("use client" etc.). Extract hooks to `src/components/hooks/`.
- **Services/helpers** go in `src/lib/` (or `src/lib/services/` for extracted business logic).
- **Shared types** (entities, DTOs) go in `src/types.ts`.

### Environment

- Node.js v22.14.0 (see `.nvmrc`)
- Env vars: `SUPABASE_URL`, `SUPABASE_KEY` (copy `.env.example` to `.env` for Node, or `.dev.vars` for Cloudflare local dev); optional `SUPABASE_SERVICE_ROLE_KEY` for the invitation route (see Auth flow)
- Local Supabase: `npx supabase start` (requires Docker)
- Cloudflare local dev: secrets go in `.dev.vars` (gitignored)
- Deploy: `npx wrangler deploy` (requires Cloudflare account + `wrangler` auth)

## CI

GitHub Actions workflow (`.github/workflows/ci.yml`) runs lint + tests + build on every push and PR to master. Requires `SUPABASE_URL` and `SUPABASE_KEY` repository secrets for the build step.
<!-- BEGIN @przeprogramowani/10x-cli -->

## 10xDevs AI Toolkit — Module 1, Lesson 1

Bootstrap a greenfield project end-to-end with the **shaping chain**:

```
/10x-init  →  /10x-shape  →  /10x-prd  →  (10x-tech-stack-selector)  →  (bootstrapper)
```

The first three skills ship in this lesson; the last two are the next links in the chain.

### Task Router — Where to start

| Skill | Use it when |
| --- | --- |
| **Project setup** | |
| `/10x-init` | The project directory is fresh. Scaffolds `context/foundation/lessons.md` and `docs/reference/contract-surfaces.md` so the rest of the workflow has somewhere to write. Run this once per project. |
| **Discovery** | |
| `/10x-shape` | You have an idea and need to turn it into structured shape-notes BEFORE writing a PRD. Greenfield only. Walks vision → persona/access → MVP → FRs (with Socratic challenge) → business logic & data → stack-openness sketch. Surfaces empty-CRUD and MVP-too-big anti-patterns by name. Output: `context/foundation/shape-notes.md` with a resumable `checkpoint:` block. |
| **Document generation** | |
| `/10x-prd` | You have shape-notes (or raw notes) and want a schema-conformant `context/foundation/prd.md`. Generates against the locked schema, routes every gap verbatim into `## Open Questions`, and refuses to invent domain decisions. On collision, prompts overwrite vs. versioned save (`prd-vN.md`). |

### How the chain hands off

- `/10x-init` produces the workflow v2 scaffold (`context/foundation/`, `lessons.md`, `contract-surfaces.md`). `/10x-shape` requires this and will offer to delegate to `/10x-init` if it's missing.
- `/10x-shape` writes `context/foundation/shape-notes.md` with frontmatter `checkpoint:` (current_phase, phases_completed, frs_drafted, quality_check_status). On re-entry, it resumes from the next unfinished phase.
- `/10x-prd` reads `shape-notes.md` (default) or any path you pass, scores the input on a 4-signal heuristic, warns on thin input, and writes `context/foundation/prd.md` against the schema at `skills/10x-shape/references/prd-schema.md` (frontmatter aligned 1:1 with 10x-tech-stack-selector's Q1–Q7).

### What the PRD captures (and what it does NOT)

- **Captured**: vision, persona, success criteria, user stories (Given/When/Then), FRs (FR-NNN), NFRs, business logic (one-sentence rule first), data model, access control, durable implementation decisions, testing strategy, deployment & CI/CD strategy, non-goals, open questions.
- **NOT captured (deliberate)**: framework choices, database choices, file paths, deployment platform. Stack openness is binding — only `product_type` and `tech_preferences.language_family` capture stack-shaped intent. Frameworks are 10x-tech-stack-selector's job.

### Anti-patterns surfaced during shaping

- **Empty-CRUD**: business logic that reduces to "users add and remove records" with no domain rule. `/10x-shape` names it explicitly and prompts for a real rule shape (recommendation, prioritization, classification, validation, scoring, workflow, calculation).
- **MVP-too-big**: first-flow estimate exceeds ~1 week of after-hours work, or > 4 distinct user actions before user-visible value, or requires multiple integrations before payoff. Skill names the expensive pieces and offers concrete scope-down moves.

Both are **soft gates**: they warn but allow override. Overrides are recorded in the checkpoint and surfaced in the PRD's `## Open Questions`.

### Foundation paths used by this lesson

- `context/foundation/shape-notes.md` — `/10x-shape` output
- `context/foundation/prd.md` (or `prd-vN.md`) — `/10x-prd` output
- `context/foundation/lessons.md` — recurring rules & pitfalls (scaffolded by `/10x-init`)
- `docs/reference/contract-surfaces.md` — load-bearing names registry (scaffolded by `/10x-init`)

### Universal language

The shipped skills carry no 10xDevs / cohort / certification references. The mechanics (Socratic challenge, gray-area discovery, recommended-answer fatigue mitigation, soft quality gate) are universal indicators of a well-scoped greenfield project.

Skills must not write to `context/archive/`. Archived changes are immutable; if a resolved target path starts with `context/archive/`, abort with: "This change is archived. Open a new change with `/10x-new` instead."

<!-- END @przeprogramowani/10x-cli -->
