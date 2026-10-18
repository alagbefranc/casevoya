-- Sample matters had no responsible consultant: ensure_sample_case never assigned one. The last
-- signature on a sample agreement then failed in app.advance_engagement_from_signature, because
-- matter_engagements.consultant_membership_id is not null ("That action could not be completed").
--
-- app.assign_sample_case is copied from 20261018070100_assign_sample_case.sql (its only
-- definition). The change: when the sample matter has no responsible consultant and the staff
-- member is licensed (app.membership_is_licensed), it assigns them through
-- app.assign_responsible_consultant, so the licence checks and audit event are the usual ones.
--
-- Backfill: existing sample matters without a consultant get the firm's earliest active licensed
-- member (owner first), through the same column-opening path assign_responsible_consultant uses.
-- Only is_sample rows are touched.

create or replace function app.assign_sample_case(p_matter_id uuid, p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  member public.memberships%rowtype;
  party public.matter_party_role;
  current_version integer;
begin
  select * into member
  from public.memberships
  where organization_id = p_org
    and user_id = (select auth.uid())
    and status = 'active'
    and role in ('firm_owner', 'licensed_consultant', 'case_manager')
  order by created_at
  limit 1;
  if member.id is null then
    return;
  end if;
  party := case when member.role = 'case_manager' then 'case_manager' else 'consultant' end;
  insert into public.matter_participants (organization_id, matter_id, membership_id, role)
  select p_org, p_matter_id, member.id, party
  where exists (select 1 from public.matters where id = p_matter_id and organization_id = p_org and is_sample)
  on conflict (matter_id, membership_id, role) do nothing;

  -- A sample matter needs a responsible consultant like a real one: when its last agreement
  -- signature lands, the engagement records the consultant. A licensed staff member who opens
  -- the sample case becomes it, through the usual assignment (licence checks included).
  select matter.version into current_version
  from public.matters matter
  where matter.id = p_matter_id
    and matter.organization_id = p_org
    and matter.is_sample
    and matter.responsible_consultant_membership_id is null;
  if current_version is not null and app.membership_is_licensed(member.id) then
    perform app.assign_responsible_consultant(p_matter_id, member.id, current_version);
  end if;
end;
$$;
revoke all on function app.assign_sample_case(uuid, uuid) from public;

do $$
declare
  rec record;
  pick uuid;
begin
  for rec in
    select matter.id, matter.organization_id
    from public.matters matter
    where matter.is_sample
      and matter.responsible_consultant_membership_id is null
  loop
    select mem.id into pick
    from public.memberships mem
    where mem.organization_id = rec.organization_id
      and mem.status = 'active'
      and mem.role in ('firm_owner', 'licensed_consultant')
      and app.membership_is_licensed(mem.id)
    order by (mem.role = 'firm_owner') desc, mem.created_at
    limit 1;
    if pick is null then
      continue;
    end if;
    perform app.open_matter_column(rec.id, 'consultant');
    update public.matters set responsible_consultant_membership_id = pick where id = rec.id;
    perform app.close_matter_column(rec.id);
    insert into public.matter_participants (organization_id, matter_id, membership_id, role)
    values (rec.organization_id, rec.id, pick, 'consultant')
    on conflict (matter_id, membership_id, role) do nothing;
  end loop;
end;
$$;
