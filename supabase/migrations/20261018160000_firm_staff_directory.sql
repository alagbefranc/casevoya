-- Staff directory for the Designer Sheet's People and invitations page (Staff tab).
--
-- The Staff tab lists each person on the firm's team with their sign-in email and whether
-- two-step sign-in is on. Neither is readable through the API: the email lives in auth.users
-- and enrolled factors in auth.mfa_factors. firm_staff_directory(org) returns the firm's staff
-- memberships (active and suspended; revoked and portal roles are left out) with:
--   * display name and role, and whether the membership is licensed
--     (app.membership_is_licensed: a licensed consultant, or a firm owner holding a CICC licence);
--   * the sign-in email and whether a verified second factor is enrolled, for a firm owner only
--     (the people who manage users); every other caller gets null in those two columns;
--   * is_self, so the page can mark the signed-in person.
-- The caller must be active staff of that firm with aal2 (app.require_active_staff); anyone
-- else is refused. Nothing is written. New function only: no table, policy or RLS change.

create function public.firm_staff_directory(p_organization_id uuid)
returns table (
  membership_id uuid,
  display_name text,
  email text,
  role public.org_role,
  status public.membership_status,
  is_licensed boolean,
  two_step boolean,
  is_self boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  owner_view boolean;
begin
  perform app.require_active_staff(p_organization_id, app.staff_roles(), false);
  owner_view := app.has_org_role(p_organization_id, array['firm_owner']::public.org_role[]) is true;

  return query
    select
      mem.id,
      nullif(btrim(coalesce(prof.display_name, '')), ''),
      case when owner_view then lower(usr.email) end,
      mem.role,
      mem.status,
      app.membership_is_licensed(mem.id),
      case
        when owner_view then exists (
          select 1
          from auth.mfa_factors factor
          where factor.user_id = mem.user_id
            and factor.status::text = 'verified'
        )
      end,
      mem.user_id = actor
    from public.memberships mem
    left join public.profiles prof on prof.id = mem.user_id
    left join auth.users usr on usr.id = mem.user_id
    where mem.organization_id = p_organization_id
      and mem.role = any (app.staff_roles())
      and mem.status in ('active'::public.membership_status, 'suspended'::public.membership_status)
    order by (mem.role = 'firm_owner'::public.org_role) desc, mem.accepted_at nulls last, mem.created_at, mem.id;
end;
$$;
comment on function public.firm_staff_directory(uuid) is
  'The firm''s staff memberships for the Staff tab. Emails and two-step status are returned to a firm owner only.';
revoke all on function public.firm_staff_directory(uuid) from public, anon;
grant execute on function public.firm_staff_directory(uuid) to authenticated;
