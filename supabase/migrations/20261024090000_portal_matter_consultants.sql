-- Client portal Home (docs/specs/client-portal-fidelity.md, #167): "Who is working on it?"
--
-- A client can't read the firm's memberships or staff profiles, so the portal had no way to name
-- the consultant working on their matter.
--
-- New:
--   * public.portal_matter_consultants(org): for each matter the signed-in person is a party to,
--     the responsible consultant's display name (or null when none is set or the membership isn't
--     active). Nothing else about staff is returned.

create function public.portal_matter_consultants(p_org uuid)
returns table (matter_id uuid, consultant_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, nullif(btrim(p.display_name), '')
  from public.matters m
  left join public.memberships ms
    on ms.id = m.responsible_consultant_membership_id
   and ms.organization_id = m.organization_id
   and ms.status = 'active'
  left join public.profiles p on p.id = ms.user_id
  where m.organization_id = p_org
    and app.is_matter_party(m.id);
$$;
comment on function public.portal_matter_consultants(uuid) is
  'The signed-in client''s matters and the display name of each one''s responsible consultant. No other staff details.';
revoke all on function public.portal_matter_consultants(uuid) from public, anon;
grant execute on function public.portal_matter_consultants(uuid) to authenticated, service_role;
