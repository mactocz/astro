# Repository Guidelines

Shiftly: a web app for planning shift schedules with labour-law checks (planner and employee roles), built on the 10x Astro Starter: Astro 7 SSR, React 19 islands, Tailwind 4, Supabase auth, deployed to Cloudflare Workers.

## Hard Rules

- Product scope and domain rules live in `@context/foundation/prd.md`; the stack hand-off is `@context/foundation/tech-stack.md`. Do not invent labour-law thresholds or scheduling rules; they are open questions in the PRD.
- `context/archive/` is read-only by convention (`@context/archive/README.md`).
- `SUPABASE_URL` and `SUPABASE_KEY` are server-only secrets (`@astro.config.mjs` env schema). Keep them in `.env` / `.dev.vars` (gitignored), never in code.
- Files use LF (`@.gitattributes`); Prettier reports every line of a CRLF file as an error.
- Packages with install scripts need approval (`npm install-scripts approve <pkg>`); approvals are pinned in `allowScripts` in `@package.json`.

## Project Structure

- `src/pages/` routes (auth API in `src/pages/api/auth/`), `src/components/` (`ui/` shadcn, `auth/` forms), `src/lib/` helpers, `src/middleware.ts` auth guard (`PROTECTED_ROUTES`).
- `supabase/` config, `scripts/smoke.mjs` smoke test, `context/` planning documents.
- Architecture and conventions: `@CLAUDE.md`.

## Commands

- `npm run dev` / `npm run build` / `npm run preview`: Cloudflare runtime; build needs both env vars.
- `npx astro sync`, `npm run lint`, `npx astro check`, `npm test`, `npm run build`: the CI gate, in this order.
- `npm run smoke`: auth-flow check against `BASE_URL` (default `http://localhost:4321`); needs a reachable Supabase.
- `npm test` (`npm run test:watch` to watch): Vitest 5 in workerd via `@cloudflare/vitest-plugin` (`@vitest.config.ts`), tests are `src/**/*.test.ts` next to the code, but never under `src/pages/` (Astro turns any `.ts` there into a route and would bundle vitest; test logic from `src/lib/`, or prefix the file with `_`). Labour-rule logic belongs in `src/lib/services/` as pure functions with no `astro:*` (does not resolve in tests) or `cloudflare:workers` imports; check "same input, same result" with `expectDeterministic` from `@src/lib/testing/determinism.ts`. Workerd in tests does not enforce the Workers Free 10 ms CPU limit.

## Coding Style

- ESLint type-checked (`@eslint.config.js`) and Prettier (`@.prettierrc.json`: width 120, double quotes); `no-console` warns outside `scripts/`.
- Use the `@/*` alias for `src/*` and `cn()` from `@/lib/utils` for class merging. No `"use client"` directives.
- Required by `@CLAUDE.md` for new code, not yet present: hooks in `src/components/hooks/`, shared types in `src/types.ts`, zod input validation in API routes (`zod` is not in `@package.json` yet), migrations in `supabase/migrations/` with RLS.

## Commit & Pull Request Guidelines

- Conventional Commits with a scope, as in history: `feat(redesign): ...`, `chore(deps): ...`, `docs(prd): ...`.
- Default branch is `master`; CI runs on pushes and PRs to it (`@.github/workflows/ci.yml`).
- `.husky/pre-commit` runs lint-staged but is inactive until `npx husky` is run (there is no `prepare` script).
