-- Security M4: a firm owner could INSERT a membership for any auth user and then
-- UPDATE it to active (skipping accept_invitation's email match and aal2 checks), or
-- change a client's role to firm_owner in place.
--
-- The application never writes memberships directly (src/ only selects). Every
-- writer is a SECURITY DEFINER function: create_organization, accept_invitation,
-- accept_portal_invitation, and the invitation/offboarding helpers. Those run as the
-- function owner, so the table INSERT/UPDATE grants are removed from the API roles.
-- The last-owner trigger (app.guard_last_firm_owner) and the staff MFA trigger are
-- unchanged and still run for definer writes.
--
-- Defence in depth: a BEFORE INSERT/UPDATE trigger refuses any membership write
-- whose session role is an API role, so a future re-grant cannot reopen the hole.
-- Behaviour change: a firm owner can no longer suspend, revoke, or re-role a member
-- through a plain table write. That needs a dedicated audited function (none exists
-- yet and no UI calls one).
-- Additive only.

revoke insert, update, delete on table public.memberships from anon, authenticated;

create function app.guard_membership_api_writes()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Invoker on purpose: definer functions run as their owner and pass.
  if current_user in ('authenticated', 'anon') then
    raise exception 'membership changes go through invitation and membership functions'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
-- Trigger functions are not checked for EXECUTE when they fire, so no role needs a grant.
revoke all on function app.guard_membership_api_writes() from public;

create trigger memberships_api_writes before insert or update on public.memberships
  for each row execute function app.guard_membership_api_writes();

comment on function app.guard_membership_api_writes() is
  'Refuses direct API-role inserts and updates on memberships. Role and status change only inside definer functions.';
