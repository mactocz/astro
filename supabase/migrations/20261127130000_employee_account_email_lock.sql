-- The e-mail address of an employee with an account is the address of that account (S-10 review, F2). The app already
-- refuses to change it, but the column grant still let a planner's token change it through PostgREST, and an edit that
-- raced an invitation could slip past the check of the route. The database now refuses it.
-- The row stays free while it has no account, and a write that removes the link (the account deleted in the dashboard,
-- on delete set null, or the service-role key) may change the address in the same statement.
create function public.employees_keep_account_email()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'employees: the e-mail of an employee with an account cannot change'
    using errcode = 'PT409';
end;
$$;

create trigger employees_keep_account_email
  before update of email on public.employees
  for each row
  when (old.user_id is not null and new.user_id is not null and old.email is distinct from new.email)
  execute function public.employees_keep_account_email();
