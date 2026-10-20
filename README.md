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

No database tables are required — this project uses Supabase Auth's built-in `auth.users` table only. The one migration, `supabase/migrations/*_role_helpers.sql`, adds the role helper functions `public.current_app_role()` and `public.is_planner()` for future RLS policies. A fresh local stack applies it on `npx supabase start`, `npx supabase db reset` applies it to an existing one, and `npx supabase db push` applies it to a hosted project.

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

Public registration is closed. The app has no sign-up page or endpoint, and `supabase/config.toml` sets `[auth] enable_signup = false`, so Supabase also rejects a direct sign-up call made with the public anon key. Accounts are created through the Supabase Admin API with `email_confirm: true`, which needs no confirmation e-mail: the account can sign in right away. `scripts/smoke.mjs` creates its test accounts this way and `scripts/create-planner.mjs` creates the first planner (see [First planner](#first-planner)).

On a hosted project also switch the sign-up option off in the dashboard (**Authentication → Sign In / Providers → User Signups → Allow new users to sign up**). Leave the **Email** provider itself enabled, otherwise nobody can sign in with e-mail and password.

### First planner

`scripts/create-planner.mjs` is a dependency-free Node script that creates the first planner, or promotes an existing account to planner by setting its `app_metadata.role`. It is meant to run against a hosted project too:

```bash
SUPABASE_URL=https://<project-ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<service-role key> PLANNER_PASSWORD=<password> \
  node scripts/create-planner.mjs planner@example.com
```

- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are always required. `PLANNER_PASSWORD` is required only for a new account (at least 8 characters, with an upper-case letter, a digit and a special character); an existing account keeps its password and is only promoted. Without `PLANNER_PASSWORD` the script only promotes and fails when no account matches the address.
- It prints the target host before the first request, never prints the password or the key, and checks the input before sending anything. Exit code `0` means done (running it again for the same address changes nothing), `1` an API error or no matching account, `2` invalid input.
- The service-role key bypasses every access policy. Pass it in the environment of this one command and never store it in `.env`, `.dev.vars` or the Worker secrets. For the local stack use `http://127.0.0.1:54321` as `SUPABASE_URL` and `SERVICE_ROLE_KEY` from `npx supabase status -o env`.
- An account without a role has no access to the app. Use the script to promote accounts that were created before registration was closed.

### Auth routes

| Route          | Description                                                                                              |
| -------------- | -------------------------------------------------------------------------------------------------------- |
| `/auth/signin` | Email/password sign-in form                                                                              |
| `/dashboard`   | Example protected page for any role; others see "Brak dostępu" (401 anonymous, 403 no role), no redirect |

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

Set `SUPABASE_URL` and `SUPABASE_KEY` as secrets in your Cloudflare dashboard or via `npx wrangler secret put`.

## Smoke test

`scripts/smoke.mjs` is a dependency-free Node script that creates real accounts (planner, employee and an account without a role) through the admin API of a local Supabase and walks the auth flow and the access matrix over HTTP (401 for anonymous, 403 for the wrong role, sign-in, sign-out). It also checks that registration stays closed: an anonymous `POST` to the removed sign-up endpoint gets 401, and a direct sign-up call to Supabase with the anon key is rejected. It also calls the database role helpers (`rpc/is_planner`, `rpc/current_app_role`) with each account's own token and checks that a role forged through `user_metadata` grants nothing, so the local stack needs the migrations applied (`npx supabase db reset` after pulling a new one). Run it against the dev server or the production preview after dependency upgrades:

```bash
npm run dev            # or: npm run build && npm run preview
# values from `npx supabase status -o env`: API_URL, ANON_KEY, SERVICE_ROLE_KEY
BASE_URL=http://localhost:4321 SUPABASE_URL=<API_URL> SUPABASE_KEY=<ANON_KEY> SUPABASE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY> npm run smoke
```

It needs a local Supabase stack (`npx supabase start`) that the app under test also uses (`.env` / `.dev.vars` with the same `SUPABASE_URL` and `SUPABASE_KEY`). The script exits before the first request unless the `SUPABASE_URL` host is `127.0.0.1` or `localhost`: never run it against a hosted project, and never put the service-role key in `.env` or `.dev.vars`.

> **Note:** this script exists primarily to guard the development of the starter itself — it is a fast sanity check that dependency upgrades did not break the build, the Cloudflare adapter or the Supabase auth flow. It is **not** a substitute for a real test suite. Once you build your own product on top of this starter, add proper tests (unit, integration, end-to-end) suited to your application.

## CI

GitHub Actions runs two jobs on every push and PR to `master`:

- **ci** — lint, `astro check` and build. Configure `SUPABASE_URL` and `SUPABASE_KEY` as repository secrets for the build step.
- **smoke** — starts a local Supabase via the Supabase CLI, builds, serves the production preview on the Cloudflare runtime and runs `npm run smoke` against it. No secrets required.

## License

MIT
