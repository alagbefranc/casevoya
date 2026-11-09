-- Service privileges follow the database role, not a JWT claim the caller can set.
--
-- app.current_actor_type, app.support_service_role, app.require_service_role and
-- app.request_is_server_capture treated request.jwt.claims.role = service_role as the service
-- role. That setting is a custom GUC. In one statement an authenticated firm owner (not a member
-- of service_role) can clear request.jwt.claim.sub and set request.jwt.claims to
-- {"role":"service_role"}, and public.service_level_report then returns another firm's report.
-- The same claim opened every other branch that asked current_actor_type() for 'service', and
-- the same claim made support_service_role() and require_service_role() true.
--
-- PostgREST's switch is SET LOCAL ROLE. current_setting('role') still names that role inside a
-- security definer function; current_user there is the function owner, so it cannot be used.
-- Rewriting request.jwt.claims does not change it. Replacing these four functions leaves their
-- existing grants in place (create or replace keeps them; the revokes below repeat the revokes
-- already applied). No rows change.

create or replace function app.current_actor_type()
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when (select auth.uid()) is not null then 'user'
    when pg_catalog.current_setting('role', true) = 'service_role' then 'service'
    else 'system'
  end;
$$;
comment on function app.current_actor_type() is
  'user when the request has a subject; service when the database role is service_role; otherwise system. The JWT role claim is not consulted.';
revoke all on function app.current_actor_type() from public;

create or replace function app.support_service_role()
returns boolean
language sql
stable
set search_path = ''
as $$
  select pg_catalog.current_setting('role', true) = 'service_role';
$$;
comment on function app.support_service_role() is
  'True only when the database role is service_role. A signed-in platform admin is not the service role, and a JWT role claim cannot make this true.';
revoke all on function app.support_service_role() from public;

create or replace function app.require_service_role()
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if pg_catalog.current_setting('role', true) is distinct from 'service_role' then
    raise exception 'service role only' using errcode = '42501';
  end if;
end;
$$;
comment on function app.require_service_role() is
  'Refuses the call unless the database role is service_role. A JWT role claim is not enough.';
revoke all on function app.require_service_role() from public;

create or replace function app.request_is_server_capture()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.current_setting('role', true) = 'service_role'
    or (
      coalesce(pg_catalog.current_setting('request.jwt.claims', true), '') = ''
      and coalesce(pg_catalog.current_setting('request.jwt.claim.sub', true), '') = ''
      and coalesce(pg_catalog.current_setting('role', true), 'none') not in ('authenticated', 'anon', 'service_role')
    );
$$;
comment on function app.request_is_server_capture() is
  'True for a service_role request or a database maintenance session (no request claims and not an API role). Never true for a signed-in user who only rewrites JWT claims.';
revoke all on function app.request_is_server_capture() from public, anon, authenticated, service_role;
