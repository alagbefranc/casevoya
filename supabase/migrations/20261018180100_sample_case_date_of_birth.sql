-- Fictional dates of birth for the sample case.
--
-- public.create_portal_invitation refuses a person without a date of birth, so the sample
-- case's "invite to the portal" step could not be done: ensure_sample_case created Priya and
-- Rafael Sharma without one. They now get fictional adult dates (Priya 1984-03-09, as in the
-- Designer; Rafael 1982-07-21).
--
-- app.ensure_sample_case is copied from its latest definition
-- (20261018070100_assign_sample_case.sql; first defined in 20261018070000_ensure_sample_case.sql).
-- The only change is the persons insert, which now sets date_of_birth and birth_date_precision.
-- create or replace keeps its grants (20261018070000). Same security definer and empty search_path.
--
-- Existing sample people are backfilled: only rows with is_sample = true, those two names,
-- and no date of birth yet. Real people are never touched.

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
  -- Fictional adult dates of birth, so the sample "invite to the portal" step can be done.
  insert into public.persons (id, organization_id, display_name, is_sample, created_by, date_of_birth, birth_date_precision)
  values
    (applicant_id, org, 'Priya Sharma', true, (select auth.uid()), date '1984-03-09', 'day'),
    (sponsor_id, org, 'Rafael Sharma', true, (select auth.uid()), date '1982-07-21', 'day');
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

update public.persons
set date_of_birth = case display_name
      when 'Priya Sharma' then date '1984-03-09'
      when 'Rafael Sharma' then date '1982-07-21'
    end,
    birth_date_precision = 'day'
where is_sample
  and date_of_birth is null
  and display_name in ('Priya Sharma', 'Rafael Sharma');
