-- Employee roster. The CHECK constraints repeat the boundaries of src/lib/services/employee.ts (names of 1-100
-- characters, e-mail in lower case of at most 254, FTE as a fraction 1 <= numerator <= denominator <= 100), so a client
-- that bypasses the app cannot store what the app would refuse. Lowest terms, collapsed inner whitespace and the ban on
-- control characters are normalisation done by the app only; the database does not enforce them.
create table public.employees (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null,
  -- Optional; the unique constraint allows any number of rows without an address.
  email text,
  fte_numerator smallint not null,
  fte_denominator smallint not null,
  created_at timestamptz not null default now(),
  constraint employees_first_name_valid check (
    first_name = btrim(first_name) and char_length(first_name) between 1 and 100
  ),
  constraint employees_last_name_valid check (
    last_name = btrim(last_name) and char_length(last_name) between 1 and 100
  ),
  constraint employees_email_valid check (
    email is null or (email = lower(btrim(email)) and char_length(email) between 1 and 254)
  ),
  constraint employees_email_key unique (email),
  constraint employees_fte_valid check (
    fte_denominator between 1 and 100 and fte_numerator between 1 and fte_denominator
  )
);

alter table public.employees enable row level security;

-- Planner only; the delete policy of the template is left out on purpose, so nobody removes a row through the API.
create policy "planner can select employees" on public.employees
  for select to authenticated using ((select public.is_planner()));
create policy "planner can insert employees" on public.employees
  for insert to authenticated with check ((select public.is_planner()));
create policy "planner can update employees" on public.employees
  for update to authenticated using ((select public.is_planner())) with check ((select public.is_planner()));

-- non-obvious: Supabase default privileges give anon and authenticated every right on a new public table
revoke all on table public.employees from anon, authenticated;
grant select, insert, update on table public.employees to authenticated;

-- The policy "employee sees their own row" arrives together with the user_id column in S-10 and S-11.
