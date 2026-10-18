-- The sample case behind sample mode, as real rows marked is_sample.
--
-- Firm setup promised "one sample sponsorship case" but created nothing, and the sample-mode
-- page showed the Designer's captured demo instead. ensure_sample_case creates the Designer's
-- fictional sponsorship once per firm: two sample people (applicant and sponsor) and one sample
-- matter linking them, all is_sample (the existing trigger sets their sample label). The case is
-- found again by its sample flag and title, so calling this again returns the same matter. The six sample proofs stay in sample_proof_steps and are recorded only when
-- each step is actually done.

create function app.ensure_sample_case()
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
revoke all on function app.ensure_sample_case() from public;

create function public.ensure_sample_case()
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select app.ensure_sample_case();
$$;
revoke all on function public.ensure_sample_case() from public, anon;
grant execute on function public.ensure_sample_case() to authenticated;
grant execute on function app.ensure_sample_case() to authenticated;
