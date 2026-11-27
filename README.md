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

Besides Supabase Auth's built-in `auth.users` table, the app has tables of its own: `public.employees`, `public.shifts`, the three that make up a weekly schedule draft, `public.schedules`, `public.schedule_staffing` and `public.schedule_employees`, and `public.schedule_assignments`, which puts an employee on a shift on a day of a schedule. The migrations in `supabase/migrations/` define the schema: `*_role_helpers.sql` adds the role helper functions `public.current_app_role()` and `public.is_planner()`, `*_employees.sql` creates the `employees` table, `*_shifts.sql` creates the `shifts` table (the shift dictionary: name, start and end time), `*_schedules.sql` creates the schedule tables (the schedule with its start date and label, the required headcount per shift and day, and the employees it covers) and the function `public.save_schedule`, which saves a whole schedule in one transaction when it is called through the app (the invariants of a schedule, such as at least one cell and one employee, at most 350 cells and the confirmation before assigned cells or people are removed, are kept by the app and `save_schedule`, not by the table grants: a planner's token that bypasses the app can still delete rows of the child tables through PostgREST), all with row-level security that opens them to planners only (nobody deletes a schedule), `*_employee_accounts.sql` adds the columns `employees.user_id` (the Auth account of the employee) and `employees.invited_at`, a policy that lets an employee read their own row, and column grants so that no session writes those two columns, `*_employee_account_activation.sql` adds `employees.activated_at` (when the employee first set a password) and the function `public.mark_account_active()` that records it, and `*_schedule_assignments.sql` creates `schedule_assignments` (an assignment hangs on a staffing cell and a roster entry of its schedule, so the database refuses one in a cell without staffing or for a person outside the schedule; its `source` is `manual` or `generated`) and replaces `public.save_schedule` with a version that saves only the difference, keeps the assignments of what stays and needs a confirmation to drop a cell or person that has them. A fresh local stack applies them on `npx supabase start`, `npx supabase db reset` applies them to an existing one, and `npx supabase db push` applies them to a hosted project. The `*_schedule_assignments.sql` migration drops the old signature of `save_schedule`, so the matching code had to be deployed right after its `db push`. `*_schedule_summaries.sql` adds the read-only view `public.schedule_summaries` (`security_invoker`, `select` for signed-in users only, so the planner-only row-level security of its three tables decides): one row per schedule with the number of people and the total required headcount, which the list at `/schedules` reads, newest first and at most 100 rows, with a note on the page when more exist. Run `npx supabase db push` before deploying the code that reads it, because until then the list page fails.

`*_absences.sql` creates `public.absences` (an employee away on whole days: a kind of `vacation`, `sick_leave` or `other`, a first and a last day, both included, and a `status` of `requested`, `approved` or `rejected`) with row-level security that opens it to planners only (no employee reads it yet), constraints on the kind, the status and the days, a cascade from the employee, and column grants: a session writes the employee, the kind and the two days and changes the kind and the two days, but never the `status`, which defaults to `approved` (the planner's own entries are approved by themselves; the leave requests and their decisions come with later changes and write the other statuses). Both days are limited to 2020-01-01 to 2099-12-31, like the start date of a schedule, because the date helpers of the rules reject any other date and the live check would be switched off. There is no text column on purpose: an L4 is health data. Run `npx supabase db push` before deploying the code that reads it, because until then `/absences` and the assignment page fail.

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

A planner invites an employee from the employee list (`/employees`) or the edit page with **Zaproś** (**Wyślij ponownie** once the employee has an account, **Resetuj hasło** once the employee has set a password; the list shows "Zaproszony dd.mm.rrrr" until then and "Zarejestrowany dd.mm.rrrr" after). The employee needs an e-mail address: without one the button is disabled. The route `POST /api/employees/<id>/invite` then does one of three things: it creates an account with the `employee` role for an employee who has none, it sends a new link to an account that never set a password (the earlier link stops working), or it sends a password-reset link to an active account (there is no self-service reset). An address that already belongs to an account outside Shiftly is refused with 409. The mail links to `/auth/set-password`, where the employee sets a password (at least 8 characters, an upper-case letter, a digit and a special character) and is signed in. The link works once and for 24 hours (`otp_expiry = 86400` in `supabase/config.toml`). Once an account is linked, the e-mail of the employee is locked.

- **Service-role key.** The route needs `SUPABASE_SERVICE_ROLE_KEY`: a Worker secret in production (`npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY`) and, locally, an entry in `.dev.vars` with the `SERVICE_ROLE_KEY` of the local stack (`npx supabase status -o env`). The key bypasses every access policy, so only `src/lib/supabase-admin.ts` reads it and only the invitation route may import that module (ESLint enforces it). Never put the key of a hosted project in `.dev.vars`. Without the key the route answers 503 and the rest of the app works.
- **Activation.** Once `POST /api/auth/set-password` has saved the password it calls the SQL function `public.mark_account_active()` with the employee's own session. The function (security definer, executable by signed-in callers only) sets `employees.activated_at` on the caller's own row, only for the `employee` role and only while the column is empty, so a later password reset keeps the first date. A failure of that call is logged and does not fail the request; no session writes the column directly.
- **Mail locally.** The local stack catches every mail in Mailpit at `http://127.0.0.1:54324`. The mail templates are `supabase/templates/invite.html` and `supabase/templates/recovery.html`.
- **Mail in production.** Set up your own SMTP sender in the hosted Supabase project before the invitations go live: the default sender mails only members of the Supabase organization, at 2 mails per hour. The checklist, in order, is in `context/deployment/deploy-plan.md`.

### Routes

| Route                             | Description                                                                                                                                                           |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/auth/signin`                    | Email/password sign-in form                                                                                                                                           |
| `/dashboard`                      | Example protected page for any role; others see "Brak dostępu" (401 anonymous, 403 no role), no redirect                                                              |
| `/planner`                        | Planner panel with tiles linking to the employee, shift, schedule and absence lists (planner only)                                                                    |
| `/employees`                      | Employee list with each person's FTE, account state and invite button (planner only)                                                                                  |
| `/employees/new`                  | Form for adding an employee (planner only)                                                                                                                            |
| `/employees/[id]`                 | Form for editing an employee; an unknown id or one that is not a UUID gets 404 (planner only)                                                                         |
| `/api/employees`                  | `POST` creates an employee from JSON: 201, 409 for a taken e-mail, 422 for invalid fields (planner only)                                                              |
| `/api/employees/[id]`             | `PUT` replaces an employee from JSON: 200, 404, 409, 422 (planner only)                                                                                               |
| `/api/employees/[id]/invite`      | `POST` without a body invites, re-invites or resets the password: 200, 404, 409, 422, 502 (planner only)                                                              |
| `/auth/set-password`              | Password form opened by the link in an invitation or reset mail; opening it spends nothing (public)                                                                   |
| `/api/auth/set-password`          | `POST` JSON `{ tokenHash, type, password }` sets the password and signs in: 200, 400, 422, 500 (public)                                                               |
| `/shifts`                         | Shift list with each shift's hours and duration (planner only)                                                                                                        |
| `/shifts/new`                     | Form for adding a shift (planner only)                                                                                                                                |
| `/shifts/[id]`                    | Form for editing a shift; an unknown id or one that is not a UUID gets 404 (planner only)                                                                             |
| `/api/shifts`                     | `POST` creates a shift from JSON: 201, 422 for invalid fields (planner only)                                                                                          |
| `/api/shifts/[id]`                | `PUT` replaces a shift from JSON: 200, 404, 422 (planner only)                                                                                                        |
| `/schedules`                      | List of weekly schedules, latest period first, with the D6 notice, the status and links to edit and assign, or to view an approved one (planner only)                 |
| `/schedules/new`                  | Form for a new schedule: start date, label, staffing grid and employees (planner only)                                                                                |
| `/schedules/[id]`                 | Form for editing a schedule, a message for an approved one; an unknown or non-UUID id gets 404 (planner only)                                                         |
| `/schedules/[id]/assign`          | Assignment view: shift buttons per person and day with the coverage, read only once approved; an unknown or non-UUID id gets 404 (planner only)                       |
| `/api/schedules`                  | `POST` creates a schedule from JSON: 201, 422 for invalid fields or unknown references (planner only)                                                                 |
| `/api/schedules/[id]`             | `PUT` saves a whole schedule from JSON: 200, 404, 409 when it would drop assignments or the schedule is approved, 422 (planner only)                                  |
| `/api/schedules/[id]/assignments` | `POST` adds and `DELETE` takes off one assignment from JSON, both idempotent: 200, 404, 409 when approved, 422 (planner only)                                         |
| `/absences`                       | Absence list with each person, kind, days with their number and status, latest start first: the last 12 months by default, every absence with `?all=1` (planner only) |
| `/absences/new`                   | Form for adding an absence: person, kind (with a hint on "Inna nieobecność"), first and last day (planner only)                                                       |
| `/absences/[id]`                  | Form for editing an absence, with its status as read-only text and its removal; an unknown id or one that is not a UUID gets 404 (planner only)                       |
| `/api/schedules/[id]/approve`     | `POST` JSON `{ confirmedKeys, basis, assignments }` approves a draft: 200, 404, 409, 422, 503 (planner only)                                                          |
| `/api/absences`                   | `POST` creates an absence from JSON: 201, 422 for invalid fields or an unknown employee (planner only)                                                                |
| `/api/absences/[id]`              | `PUT` changes the kind and the days from JSON: 200, 404, 422; `DELETE` removes one, idempotent: 200 (planner only)                                                    |

The invite route answers 200 with `invited`, `reinvited` or `password_reset`, 404 for an unknown employee, 409 `account_exists` for a foreign account, 422 `no_email`, 409 `account_mismatch` when the linked account has another address, 429 `rate_limited`, 500 `sent_not_recorded` (the mail went out), 502 `mail_failed` and 503 `not_configured`. `/api/auth/set-password` answers 400 `invalid_link` for a spent, expired or malformed link, 422 with `errors.password` for a password that breaks the rule (the token is not spent) and 500 `password_not_saved` when the password could not be saved after the link was spent.

Planner-only routes answer anyone else with "Brak dostępu" (401 anonymous, 403 other roles) or, under `/api/`, with JSON of the same status. Employees, shifts, schedules and assignments are stored in the `employees`, `shifts`, `schedules`, `schedule_staffing`, `schedule_employees` and `schedule_assignments` tables, which row-level security opens to planners only. The schedule pages, the assignment view included, show a notice (decision D6) that a weekly draft does not replace the formal work-time schedule of art. 129 § 3 of the Labour Code.

The assignment routes take the JSON `{ shiftId, dayOffset, employeeId }` and answer 200 `{ ok: true }` for an add and for a removal alike (repeating either changes nothing), 404 for a schedule id that is not a UUID, 422 with `errors` for a body that breaks the rules and 422 `unknown_reference` for a cell without staffing or a person outside the schedule. `PUT /api/schedules/<id>` answers 409 `assignments_would_be_removed` with `removed`, the number of assignments, when the save would drop an assigned cell or person, until the body has `confirmRemoval: true`.

The assignment view also checks the work-time rules while the planner assigns. Under the people's table it shows a counter ("Wskazania: 1 krytyczne, 2 ostrzeżenia" or "Brak wskazań") and a list of violations, critical first, each with its weight in words and a reason that names the person, the day and the numbers; a mark in the day cell ("Krytyczne: 2") and a column "Wskazania" per person show where they sit. The list is counted again in the browser after every click (nothing is requested or stored). The critical ones are less than 11 h of rest between two shifts, more than 8 h in the 24 hours counted from the start of a shift (a shift longer than 8 h is critical, with the note that the equivalent working-time system, art. 135, is not supported), more than 48 h in the seven days of the schedule and no weekly rest of 35 h (24 h when the shifts before and after the break start at different times of the day). The warnings are a week above the norm of the employee's FTE (40 h times the FTE, less 8 h times the FTE for each holiday on a day other than Sunday and, since absences were added, less the approved absences of the person, see the paragraph on absences below; a warning because the norm of the law is monthly) and a staffing cell with fewer people than it needs; an excess is no violation. Only this schedule is judged: the rest at its edges (the previous and the next week) is not checked, the free time at the end and at the start of the schedule counts as one break, and the page says that Shiftly warns and does not guarantee compliance with the law. The rules are pure functions in `src/lib/services/rules.ts` (with `work-hours.ts`, `calendar.ts` and `fte.ts`); the assignment page and the schedule form pages (`/schedules/new` and `/schedules/<id>`) share one mapping, so their islands all receive each employee's FTE (never the e-mail address) and the start and end of each shift in minutes (these pages are planner-only and sent with `Cache-Control: no-store`).

The assignment view also shows the hours of each person against the weekly norm. The last column of the people's table, "Godziny" (after "Wskazania"), has two lines in each person's row: the hours of the schedule with the norm of the person's FTE ("32 h z 40 h") and the difference in words ("mniej o 8 h", "więcej o 2 h 30 min" or "równo z normą"; a person with no shift reads "0 min z 40 h"). It is counted in the browser after every click, from the same list as the violations (nothing is requested or stored), and a paragraph under the table says what it is made of. The hours are the full durations of the shifts that start in this schedule (a night shift on the last day counts in full). The weekly norm is 40 h times the FTE, less 8 h times the FTE for each holiday on a day other than Sunday among the seven days of the schedule (and, since absences were added, less the approved absences of the person, see the paragraph on absences below), so a full-time employee has 32 h in a week with one holiday and no absence. The norm is rounded to the minute to be shown and the difference is taken from the rounded value, while the warning about the norm in the list compares exactly: with 3/7 of an FTE in a week without a holiday the norm is 1028.57 minutes, shown as 17 h 9 min, so 17 h 9 min of work reads "równo z normą" although the warning is raised for it. The column has no threshold, no status and no colour that carries a meaning: exceeding the norm is the warning in the list. Approved absences lower the norm, as the paragraph on absences below says. The logic is in `src/lib/services/workload.ts` and the hook `src/components/hooks/useWorkload.ts`.

Absences change three things in the assignment view. The planner enters them at `/absences` (leave, sick leave (L4) or another absence, for whole days). A shift on a day of an approved absence of its person is a critical item of the list, with a reason that names the person, the shift, the day and the absence; a shift that falls only on a requested absence is a warning, and a rejected absence is ignored. One item is listed for each assignment, with the weight of the strongest absence it falls on. The absence takes whole days on the timeline of the rules, so a night shift that starts the evening before it and runs into its first day is a collision, and a shift that ends exactly at midnight when the absence starts is not. Next, an approved absence lowers the weekly norm by 8 h times the FTE for each day from Monday to Friday that it covers and that is not a holiday (never below 0, and a day that a holiday has already lowered is not lowered twice), in the warning about the norm and in the column "Godziny" alike, from the same data (decision D7 in `context/foundation/work-time-rules.md`, an interpretation of art. 130 of the Labour Code; Shiftly warns and does not guarantee compliance), and the paragraph under the table says so. Last, the day cell of the person shows "Nieobecność: urlop" as text, with "(niezatwierdzona)" after the kind for a requested absence and no note for a rejected one. The page reads the absences of the people of the schedule for its seven days and the day after them (a night shift on the last day runs into the next one), and the check is counted in the browser as before: nothing is requested or stored for it. The coverage is unchanged: a person on leave still counts as assigned. The logic is in `src/lib/services/absence.ts` and `src/lib/services/rules.ts`, the data module is `src/lib/absences.ts`, and the routes are in the table above (`PUT` writes only the kind and the days, `DELETE` is idempotent). The list at `/absences` is read newest first and cut by the database at 500 rows (with a note when more exist); by default it shows the absences that ended in the last twelve months or still go on, a link leads to the full list (`?all=1`) and back, and each row writes the number of its days after the range ("3 dni"), so that an absurd length is visible. What the rules need to be complete (the absences of a schedule) is read with an exact count, and an answer shorter than the count is refused rather than judged. For a shift within one day the cell of the grid and the reason of a violation name the same absence; for a night shift that runs into the next day they can differ (the cell names the strongest absence of its own day, the reason the strongest one the shift overlaps).

The planner approves a schedule at the bottom of its assignment view. A critical violation blocks the approval, and the warnings are listed in a confirmation that is always shown. Approval is final: the schedule is locked in the database against every write, and it is shown read only, with the findings and hours stored at that moment and a copy of the shifts and people, so a later edit of the dictionary or the roster does not change it. The server counts the rules again from the database before it approves; `POST /api/schedules/<id>/approve` answers 409 with `critical_violations`, `confirmation_required`, `schedule_changed` or `schedule_approved`, and the save and assignment routes answer 409 `schedule_approved` for an approved schedule. The confirmation compares the keys of the warnings, so a warning that changed its numbers under the same key in the meantime counts as confirmed; the stored record holds the findings as counted by the server. A new version of an approved schedule is not available yet.

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

`scripts/smoke.mjs` is a dependency-free Node script that creates real accounts (planner, employee and an account without a role) through the admin API of a local Supabase and walks the auth flow and the access matrix over HTTP (401 for anonymous, 403 for the wrong role, sign-in, sign-out). It also checks that registration stays closed: an anonymous `POST` to the removed sign-up endpoint gets 401, and a direct sign-up call to Supabase with the anon key is rejected. It also calls the database role helpers (`rpc/is_planner`, `rpc/current_app_role`) with each account's own token and checks that a role forged through `user_metadata` grants nothing. The employee data is covered end to end: the `employees` table through PostgREST, the `/api/employees` routes and the `/employees` pages, each as planner, employee and anonymous (the planner's steps create a test employee whose e-mail starts with `smoke-`). The shift data is covered the same way: the `shifts` table through PostgREST, the `/api/shifts` routes and the `/shifts` pages (the planner's steps create test shifts whose name starts with `Smoke-`). The schedule data is covered the same way, with more depth: the `schedules`, `schedule_staffing` and `schedule_employees` tables and the `save_schedule` function through PostgREST (constraints, foreign keys, atomic save, no delete), the `/api/schedules` routes, and the `/schedules` pages, whose HTML is checked against the data they must show (the list row of a schedule, the cells and ticked employees of its form); the planner's steps create test schedules whose label starts with `Smoke-`. The assignments are covered the same way: the `schedule_assignments` table through PostgREST (the composite foreign keys, the `source` constraint, no update, planner only), the differential `save_schedule` (it keeps the assignments of what stays and refuses with `PT409` to drop an assigned cell or person until the caller confirms, and its old five-argument signature is gone), the `/api/schedules/<id>/assignments` routes (idempotent add and removal) with the 409 of the schedule `PUT`, and the assignment view, whose HTML is checked down to which shift button of which person is on and the coverage counters. The invitation flow is covered too: the `user_id`, `invited_at` and `activated_at` columns and the own-row policy through PostgREST, the `mark_account_active` function (own row only, the first activation stays), the mail templates, the invite route (invite, invite again, password reset, a foreign account, a missing e-mail), the set-password page and route with tokens from the admin API (the smoke test never reads mails), the new employee's session, the activation time that the first password set records, the locked e-mail, and what the planner's pages render (account column, invite button, locked e-mail field, password form). The accounts and rows of all these steps start with `smoke-` / `Smoke-` and are removed by the last steps: the schedules first (a schedule keeps its shifts and employees from being deleted, and its assignments go with it), then the test accounts, then the test employees and shifts. So the local stack needs the migrations applied (`npx supabase db reset` after pulling a new one). Run it against the dev server or the production preview after dependency upgrades:

```bash
npm run dev            # or: npm run build && npm run preview
# values from `npx supabase status -o env`: API_URL, ANON_KEY, SERVICE_ROLE_KEY
BASE_URL=http://localhost:4321 SUPABASE_URL=<API_URL> SUPABASE_KEY=<ANON_KEY> SUPABASE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY> npm run smoke
```

It needs a local Supabase stack (`npx supabase start`) that the app under test also uses (`.env` / `.dev.vars` with the same `SUPABASE_URL` and `SUPABASE_KEY`, and `.dev.vars` also with the same `SUPABASE_SERVICE_ROLE_KEY`, which the invitation route reads). The script exits before the first request unless the `SUPABASE_URL` host is `127.0.0.1` or `localhost`: never run it against a hosted project or the production Worker, and never put the key of a hosted project in `.dev.vars`.

The assignment page is also checked against the live rules on real data. The steps create a schedule of its own (`Smoke-<runId>-rules`, the week 02.11 to 08.11.2026), four employees with a full FTE, one for each scenario, and a 01:00-09:00 shift, put the people on the cells through the assignment route and read the HTML of `/schedules/<id>/assign`: the counter, the exact ordered list of violations (the weight and the whole reason, built from the data of the step, so a wrong person, day or number fails), the column "Wskazania" of each person and the marks of the day cells. The scenarios are a shift of 9 h alone (more than 8 h in the day, with the sentence about the equivalent working-time system), a break of 8 h between two shifts of a day, a break of exactly 11 h (allowed, so no daily-rest item), seven days in a row (56 h in the week, no weekly rest of 35 h, over the norm) and the shortages (a warning for each cell with fewer people than it needs). The neighbour steps then take one assignment off through `DELETE` at a time and read the page again: only what that assignment caused goes, and the other person on the same shift and day and the same person on another day keep their items.

The column "Godziny" of the assignment page is checked on real data as well. The steps create a schedule of its own (`Smoke-<runId>-hours`) that starts on Tuesday 10.11.2026, so that Wednesday 11.11 is a holiday and the norm of a full-time employee is 32 h and that of a half-time one 16 h, with seven employees (one on 1/2 FTE), put them on the cells through the assignment route and read the HTML of `/schedules/<id>/assign`. They assert the exact text of the column of each person: one shift of 8 h ("8 h z 32 h mniej o 24 h"), two shifts on different days (17 h), a night shift on the last day counted in full (9 h), nobody ("0 min z 32 h mniej o 32 h"), a half-time employee ("8 h z 16 h mniej o 8 h"), exactly the norm ("32 h z 32 h równo z normą") and above it ("40 h z 32 h więcej o 8 h"). They also assert the header, the paragraph under the table and that the column has no `role`, no `aria-live`, no icon and no colour class of a status. The neighbour steps take one assignment off through `DELETE` at a time and read the page again: only the text of the person it belongs to changes. The column of the other schedules of the smoke test (the API, route and rules schedules) is asserted in the page steps that already read their rows.

The absences are checked on real data too. The steps cover the `absences` table through PostgREST (the constraints by name, the column grants that keep `status` and the person out of a session's reach, access for the planner only, tried as an employee, a role-less account and an anonymous caller, and the cascade from the employee), the `/api/absences` routes (the exact 422 fields, the idempotent `DELETE`), the `/absences` pages (the list rows with the number of days, the default and the full view of the list with their notes and links, tried with an absence of 2021, the forms with the hint on the kind, the status on the edit page, a missing id, the card in `/planner`, no e-mail address) and the assignment page on two schedules of their own (`Smoke-<runId>-absences`, the week 02.11 to 08.11.2026, and `Smoke-<runId>-absences-holiday`, the week from Tuesday 10.11.2026 with the holiday on Wednesday 11.11) with people of their own. Approved absences are written through `POST /api/absences`, requested and rejected ones with the service-role key, because no session may write a status. The page steps assert the counter, the exact ordered list of reasons, the column "Wskazania", the notes in the day cells and the column "Godziny" for a collision with an approved absence (critical), with a requested one (a warning) and with a rejected one (nothing), a night that runs into the first day of an absence, a shift that ends exactly at the midnight an absence starts at, two overlapping absences (one item, the strongest) and the corrected norm (16 h after three weekdays of absence, and nothing more for a weekend or a holiday that the week already deducts). The neighbour steps then remove one absence at a time through `DELETE /api/absences/<id>` and read the page again: only what that absence caused goes.

The approval is checked too: the lock of an approved schedule and the function `approve_schedule` through PostgREST (as planner, employee, account without a role and anonymous caller, every refusal by its code), the approve route with its 409 answers, and the pages of a draft and of the approved schedule, also after its shift and person have been edited.

> **Note:** this script exists primarily to guard the development of the starter itself — it is a fast sanity check that dependency upgrades did not break the build, the Cloudflare adapter or the Supabase auth flow. It is **not** a substitute for a real test suite. Once you build your own product on top of this starter, add proper tests (unit, integration, end-to-end) suited to your application.

## CI

GitHub Actions runs two jobs on every push and PR to `master`:

- **ci** — lint, `astro check` and build. Configure `SUPABASE_URL` and `SUPABASE_KEY` as repository secrets for the build step.
- **smoke** — starts a local Supabase via the Supabase CLI (its Mailpit container stays up, because Auth needs a mail server to hand an invitation to), builds, serves the production preview on the Cloudflare runtime and runs `npm run smoke` against it. No secrets required: the service-role key it uses is the one of the throwaway local stack.

## License

MIT
