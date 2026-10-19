-- The firm's date today, in the firm's timezone (decision 2026-10-19, "Some date rules count today in UTC").
--
-- Date rules ("not in the future", "today or later", "still valid today") count the day in the
-- firm's timezone, America/Toronto when unset or invalid, the way client deposits, access grants,
-- invoices and complaints already do (app.client_funds_today, app.compliance_today). The rules
-- that used the server date (current_date, UTC) are redefined in 20261019216100 to call this.
--
-- It is app.firm_local_date at statement_timestamp(), so a test can check the zone arithmetic
-- against a fixed moment through app.firm_local_date.

create function app.firm_today(p_org uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select app.firm_local_date(p_org, statement_timestamp());
$$;
revoke all on function app.firm_today(uuid) from public, anon;
-- public.create_client_matter is security invoker and calls it as the signed-in staff member.
grant execute on function app.firm_today(uuid) to authenticated, service_role;
comment on function app.firm_today(uuid) is
  'The firm''s date today in its timezone (organizations.timezone, America/Toronto when unset or invalid). Use it for every "today" in a firm''s date rules instead of current_date.';
