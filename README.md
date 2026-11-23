# 10x Astro Starter

![](./public/template.png)

A modern, opinionated starter template for building fast, accessible web applications.

## Tech Stack

- [Astro](https://astro.build/) v7 - Modern web framework with server-first rendering
- [React](https://react.dev/) v19 - UI library for interactive components
- [TypeScript](https://www.typescriptlang.org/) v6 - Type-safe JavaScript
- [Tailwind CSS](https://tailwindcss.com/) v4 - Utility-first CSS framework
- [Supabase](https://supabase.com/) - Authentication and backend-as-a-service
- [Cloudflare Workers](https://workers.cloudflare.com/) - Edge deployment runtime

## Prerequisites

- Node.js v22.14.0 (as specified in `.nvmrc`)
- npm (comes with Node.js)

## Getting Started

1. Clone the repository:

```bash
git clone https://github.com/przeprogramowani/10x-astro-starter.git
cd 10x-astro-starter
```

2. Install dependencies:

```bash
npm install
```

3. Set up Supabase and configure environment variables — see [Supabase Configuration](#supabase-configuration) below.

4. Create a `.dev.vars` file for local Cloudflare dev secrets:

```bash
cp .env.example .dev.vars
```

5. Run the development server:

```bash
npm run dev
```

## Available Scripts

- `npm run dev` - Start development server (Cloudflare workerd runtime)
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run lint` - Run ESLint with type-checked rules
- `npm run lint:fix` - Auto-fix ESLint issues
- `npm run format` - Run Prettier
- `npm run smoke` - Smoke test the auth flow and role access against a running server (`BASE_URL`, defaults to `http://localhost:4321`); creates accounts in a local Supabase, see [Smoke test](#smoke-test)

## Project Structure

```md
.
├── src/
│ ├── layouts/ # Astro layouts
│ ├── pages/ # Astro pages
│ │ └── api/ # API endpoints
│ ├── components/ # UI components (Astro & React)
│ └── assets/ # Static assets
├── public/ # Public assets
├── wrangler.jsonc # Cloudflare Workers config
```

## Supabase Configuration

This project uses [Supabase](https://supabase.com/) for authentication. Environment variables are declared via Astro's `astro:env` schema and are treated as **server-only secrets** — they are never exposed to the client.

### First-time setup (local, no cloud project needed)

Requires [Docker](https://www.docker.com/) and ~7 GB RAM.

1. Create your `.env` file:

```bash
cp .env.example .env
```

2. Initialize the local Supabase project (creates a `supabase/` config folder):

```bash
npx supabase init
```

3. Start the local stack (downloads Docker images on first run):

```bash
npx supabase start
```

4. Copy the credentials printed by the CLI into your `.env` and `.dev.vars`:

```
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_KEY=<anon key from CLI output>
```

5. To stop the stack when done:

```bash
npx supabase stop
```

The local Studio UI is available at `http://localhost:54323`.

Besides Supabase Auth's built-in `auth.users` table, the app has two tables of its own, `public.employees` and `public.shifts`. Five migrations in `supabase/migrations/` define the schema: `*_role_helpers.sql` adds the role helper functions `public.current_app_role()` and `public.is_planner()`, `*_employees.sql` creates the `employees` table and `*_shifts.sql` creates the `shifts` table (the shift dictionary: name, start and end time), both with row-level security that opens them to planners only, and `*_employee_accounts.sql` adds the columns `employees.user_id` (the Auth account of the employee) and `employees.invited_at`, a policy that lets an employee read their own row, and column grants so that no session writes those two columns, and `*_employee_account_activation.sql` adds `employees.activated_at` (when the employee first set a password) and the function `public.mark_account_active()` that records it. A fresh local stack applies them on `npx supabase start`, `npx supabase db reset` applies them to an existing one, and `npx supabase db push` applies them to a hosted project.

### Using a cloud Supabase project instead

If you prefer to use a hosted Supabase project, add these variables to your `.env` and `.dev.vars` files:

| Variable       | Description                                                |
| -------------- | ---------------------------------------------------------- |
| `SUPABASE_URL` | Project URL from Supabase dashboard → Settings → API       |
| `SUPABASE_KEY` | `anon` public key from Supabase dashboard → Settings → API |

```
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_KEY=<anon-key>
```

### Accounts and email confirmation

Public registration is closed. The app has no sign-up page or endpoint, and `supabase/config.toml` sets `[auth] enable_signup = false`, so Supabase also rejects a direct sign-up call made with the public anon key. Accounts are created through the Supabase Admin API with `email_confirm: true`, which needs no confirmation e-mail: the account can sign in right away. `scripts/smoke.mjs` creates its test accounts this way and `scripts/create-planner.mjs` creates the first planner (see [First planner](#first-planner)). Employee accounts are created by the invitation route (see [Employee invitations](#employee-invitations)).

On a hosted project also switch the sign-up option off in the dashboard (**Authentication → Sign In / Providers → User Signups → Allow new users to sign up**). Leave the **Email** provider itself enabled, otherwise nobody can sign in with e-mail and password.

### First planner

`scripts/create-planner.mjs` is a dependency-free Node script that creates the first planner, or promotes an existing account to planner by setting its `app_metadata.role`. It is meant to run against a hosted project too:

```bash
SUPABASE_URL=https://<project-ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<service-role key> PLANNER_PASSWORD=<password> \
  node scripts/create-planner.mjs planner@example.com
```

- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are always required. `PLANNER_PASSWORD` is required only for a new account (at least 8 characters, with an upper-case letter, a digit and a special character); an existing account keeps its password and is only promoted. Without `PLANNER_PASSWORD` the script only promotes and fails when no account matches the address.
- It prints the target host before the first request, never prints the password or the key, and checks the input before sending anything. Exit code `0` means done (running it again for the same address changes nothing), `1` an API error or no matching account, `2` invalid input.
- The service-role key bypasses every access policy. For this script pass it in the environment of this one command. The app itself keeps the key only for the invitation route (see [Employee invitations](#employee-invitations)). For the local stack use `http://127.0.0.1:54321` as `SUPABASE_URL` and `SERVICE_ROLE_KEY` from `npx supabase status -o env`.
- An account without a role has no access to the app. Use the script to promote accounts that were created before registration was closed.

### Employee invitations

A planner invites an employee from the employee list (`/employees`) or the edit page with **Zaproś** (**Wyślij ponownie** once the employee has an account, **Resetuj hasło** once the employee has set a password; the list shows "Zaproszony dd.mm.rrrr" until then and "Zarejestrowany dd.mm.rrrr" after). The employee needs an e-mail address: without one the button is disabled. The route `POST /api/employees/<id>/invite` then does one of three things: it creates an account with the `employee` role for an employee who has none, it sends a new link to an account that never set a password (the earlier link stops working), or it sends a password-reset link to an active account (there is no self-service reset). An address that already belongs to an account outside Shiftly is refused with 409. The mail links to `/auth/set-password`, where the employee sets a password (at least 8 characters, an upper-case letter, a digit and a special character) and is signed in. The link works once and for 7 days (`otp_expiry = 604800` in `supabase/config.toml`). Once an account is linked, the e-mail of the employee is locked.

- **Service-role key.** The route needs `SUPABASE_SERVICE_ROLE_KEY`: a Worker secret in production (`npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY`) and, locally, an entry in `.dev.vars` with the `SERVICE_ROLE_KEY` of the local stack (`npx supabase status -o env`). The key bypasses every access policy, so only `src/lib/supabase-admin.ts` reads it and only the invitation route may import that module (ESLint enforces it). Never put the key of a hosted project in `.dev.vars`. Without the key the route answers 503 and the rest of the app works.
- **Activation.** Once `POST /api/auth/set-password` has saved the password it calls the SQL function `public.mark_account_active()` with the employee's own session. The function (security definer, executable by signed-in callers only) sets `employees.activated_at` on the caller's own row, only for the `employee` role and only while the column is empty, so a later password reset keeps the first date. A failure of that call is logged and does not fail the request; no session writes the column directly.
- **Mail locally.** The local stack catches every mail in Mailpit at `http://127.0.0.1:54324`. The mail templates are `supabase/templates/invite.html` and `supabase/templates/recovery.html`.
- **Mail in production.** Set up your own SMTP sender in the hosted Supabase project before the invitations go live: the default sender mails only members of the Supabase organization, at 2 mails per hour. The checklist, in order, is in `context/deployment/deploy-plan.md`.

### Routes

| Route                        | Description                                                                                              |
| ---------------------------- | -------------------------------------------------------------------------------------------------------- |
| `/auth/signin`               | Email/password sign-in form                                                                              |
| `/dashboard`                 | Example protected page for any role; others see "Brak dostępu" (401 anonymous, 403 no role), no redirect |
| `/planner`                   | Planner panel with tiles linking to the employee list and the shift list (planner only)                  |
| `/employees`                 | Employee list with each person's FTE, account state and invite button (planner only)                     |
| `/employees/new`             | Form for adding an employee (planner only)                                                               |
| `/employees/[id]`            | Form for editing an employee; an unknown id or one that is not a UUID gets 404 (planner only)            |
| `/api/employees`             | `POST` creates an employee from JSON: 201, 409 for a taken e-mail, 422 for invalid fields (planner only) |
| `/api/employees/[id]`        | `PUT` replaces an employee from JSON: 200, 404, 409, 422 (planner only)                                  |
| `/api/employees/[id]/invite` | `POST` without a body invites, re-invites or resets the password: 200, 404, 409, 422, 502 (planner only) |
| `/auth/set-password`         | Password form opened by the link in an invitation or reset mail; opening it spends nothing (public)      |
| `/api/auth/set-password`     | `POST` JSON `{ tokenHash, type, password }` sets the password and signs in: 200, 400, 422, 500 (public)  |
| `/shifts`                    | Shift list with each shift's hours and duration (planner only)                                           |
| `/shifts/new`                | Form for adding a shift (planner only)                                                                   |
| `/shifts/[id]`               | Form for editing a shift; an unknown id or one that is not a UUID gets 404 (planner only)                |
| `/api/shifts`                | `POST` creates a shift from JSON: 201, 422 for invalid fields (planner only)                             |
| `/api/shifts/[id]`           | `PUT` replaces a shift from JSON: 200, 404, 422 (planner only)                                           |

The invite route answers 200 with `invited`, `reinvited` or `password_reset`, 404 for an unknown employee, 409 `account_exists` for a foreign account, 422 `no_email`, 502 `mail_failed` and 503 `not_configured`. `/api/auth/set-password` answers 400 `invalid_link` for a spent, expired or malformed link, 422 with `errors.password` for a password that breaks the rule (the token is not spent) and 500 `password_not_saved` when the password could not be saved after the link was spent.

Planner-only routes answer anyone else with "Brak dostępu" (401 anonymous, 403 other roles) or, under `/api/`, with JSON of the same status. Employees and shifts are stored in the `employees` and `shifts` tables, which row-level security opens to planners only.

Route protection is handled in `src/middleware.ts` through `decideAccess` in `src/lib/services/access.ts`. Access is denied by default: a path missing from the table in `access.ts` is planner-only, so a new route stays closed until you add it on purpose. Roles (`planner`, `employee`) are read from the user's `app_metadata.role`.

## Deployment

This project deploys to [Cloudflare Workers](https://workers.cloudflare.com/).

1. Build the project:

```bash
npm run build
```

2. Deploy with Wrangler:

```bash
npx wrangler deploy
```

Set `SUPABASE_URL` and `SUPABASE_KEY` as secrets in your Cloudflare dashboard or via `npx wrangler secret put`. The employee invitations also need the secret `SUPABASE_SERVICE_ROLE_KEY` and, in production, your own SMTP sender in Supabase; follow the checklist in `context/deployment/deploy-plan.md` before you deploy that code.

## Smoke test

`scripts/smoke.mjs` is a dependency-free Node script that creates real accounts (planner, employee and an account without a role) through the admin API of a local Supabase and walks the auth flow and the access matrix over HTTP (401 for anonymous, 403 for the wrong role, sign-in, sign-out). It also checks that registration stays closed: an anonymous `POST` to the removed sign-up endpoint gets 401, and a direct sign-up call to Supabase with the anon key is rejected. It also calls the database role helpers (`rpc/is_planner`, `rpc/current_app_role`) with each account's own token and checks that a role forged through `user_metadata` grants nothing. The employee data is covered end to end: the `employees` table through PostgREST, the `/api/employees` routes and the `/employees` pages, each as planner, employee and anonymous (the planner's steps create a test employee, and the last step deletes every row whose e-mail starts with `smoke-`). The shift data is covered the same way: the `shifts` table through PostgREST, the `/api/shifts` routes and the `/shifts` pages (the planner's steps create test shifts, and the last step deletes every shift whose name starts with `Smoke-`). The invitation flow is covered too: the `user_id`, `invited_at` and `activated_at` columns and the own-row policy through PostgREST, the `mark_account_active` function (own row only, the first activation stays), the mail templates, the invite route (invite, invite again, password reset, a foreign account, a missing e-mail), the set-password page and route with tokens from the admin API (the smoke test never reads mails), the new employee's session, the activation time that the first password set records, the locked e-mail, and what the planner's pages render (account column, invite button, locked e-mail field, password form). Its accounts and rows start with `smoke-` / `Smoke-` and are removed by the last steps. So the local stack needs the migrations applied (`npx supabase db reset` after pulling a new one). Run it against the dev server or the production preview after dependency upgrades:

```bash
npm run dev            # or: npm run build && npm run preview
# values from `npx supabase status -o env`: API_URL, ANON_KEY, SERVICE_ROLE_KEY
BASE_URL=http://localhost:4321 SUPABASE_URL=<API_URL> SUPABASE_KEY=<ANON_KEY> SUPABASE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY> npm run smoke
```

It needs a local Supabase stack (`npx supabase start`) that the app under test also uses (`.env` / `.dev.vars` with the same `SUPABASE_URL` and `SUPABASE_KEY`, and `.dev.vars` also with the same `SUPABASE_SERVICE_ROLE_KEY`, which the invitation route reads). The script exits before the first request unless the `SUPABASE_URL` host is `127.0.0.1` or `localhost`: never run it against a hosted project or the production Worker, and never put the key of a hosted project in `.dev.vars`.

> **Note:** this script exists primarily to guard the development of the starter itself — it is a fast sanity check that dependency upgrades did not break the build, the Cloudflare adapter or the Supabase auth flow. It is **not** a substitute for a real test suite. Once you build your own product on top of this starter, add proper tests (unit, integration, end-to-end) suited to your application.

## CI

GitHub Actions runs two jobs on every push and PR to `master`:

- **ci** — lint, `astro check` and build. Configure `SUPABASE_URL` and `SUPABASE_KEY` as repository secrets for the build step.
- **smoke** — starts a local Supabase via the Supabase CLI (its Mailpit container stays up, because Auth needs a mail server to hand an invitation to), builds, serves the production preview on the Cloudflare runtime and runs `npm run smoke` against it. No secrets required: the service-role key it uses is the one of the throwaway local stack.

## License

MIT
