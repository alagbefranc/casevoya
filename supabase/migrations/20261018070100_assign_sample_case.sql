-- Assign the caller to the sample case.
--
-- Staff read a person only through a matter they are assigned to (app.can_read_person), so the
-- sample people created by ensure_sample_case were invisible to the owner who created them and
-- the sample screens fell back to the matter title. ensure_sample_case now adds the caller as a
-- staff participant (consultant for an owner or licensed consultant, case manager otherwise),
-- both when it creates the case and when it returns an existing one, so firms that already have
-- a sample case are fixed on their next visit.

create function app.assign_sample_case(p_matter_id uuid, p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  member public.memberships%rowtype;
  party public.matter_party_role;
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
end;
$$;
revoke all on function app.assign_sample_case(uuid, uuid) from public;

create or replace function app.ensure_sample_case()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid := app.current_organization_id();
  matter_id uuid;
  applicant_id uuid := gen_random_uuid();
  sponsor_id uuid := gen_random_uuid();
begin
  if org is null
     or app.staff_mfa_satisfied() is distinct from true
     or app.has_org_role(org, array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[]) is distinct from true then
    raise exception 'sample case denied' using errcode = '42501';
  end if;
  -- One sample case per firm, even when two tabs ask at once.
  perform pg_advisory_xact_lock(hashtextextended('sample-case:' || org::text, 0));
  select matter.id into matter_id
  from public.matters matter
  where matter.organization_id = org
    and matter.is_sample
    and matter.title = 'Spousal sponsorship (sample)'
  order by matter.created_at
  limit 1;
  if matter_id is not null then
    perform app.assign_sample_case(matter_id, org);
    return matter_id;
  end if;

  matter_id := gen_random_uuid();
  insert into public.persons (id, organization_id, display_name, is_sample, created_by)
  values
    (applicant_id, org, 'Priya Sharma', true, (select auth.uid())),
    (sponsor_id, org, 'Rafael Sharma', true, (select auth.uid()));
  insert into public.matters (id, organization_id, title, is_sample, created_by)
  values (matter_id, org, 'Spousal sponsorship (sample)', true, (select auth.uid()));
  insert into public.matter_participants (organization_id, matter_id, person_id, role)
  values
    (org, matter_id, applicant_id, 'applicant'),
    (org, matter_id, sponsor_id, 'sponsor');
  perform app.assign_sample_case(matter_id, org);

  perform app.record_audit_event(
    org,
    'firm.sample_case_created',
    'public.matters',
    matter_id,
    'success',
    jsonb_build_object('sample', true)
  );
  return matter_id;
end;
$$;
