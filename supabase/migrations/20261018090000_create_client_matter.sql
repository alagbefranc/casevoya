-- New matter from the Designer Sheet: a real client matter with its people.
--
-- create_engaged_matter opens a matter at engagement pending with a named consultant, but it
-- has no people: staff read a person only through a matter they are assigned to
-- (app.can_read_person), and the Sheet names a matter after its applicant. create_client_matter
-- wraps it in one transaction:
--   * create_engaged_matter makes the matter (consultant participant, optional published pack);
--   * the applicant and an optional sponsor are new persons linked as applicant and sponsor;
--   * the creating staff member is added as a case_manager participant unless they are the
--     responsible consultant (already the consultant participant) or a firm owner (who reads
--     every matter and person already), so the creator can read the people they just entered.
-- It is security invoker: RLS, the sample-mode guard, the licence lock and the new-matter
-- validation all see the caller. Rows are always real (is_sample false); a firm still in sample
-- mode gets the sample-mode refusal from the existing trigger. Sample data comes from
-- ensure_sample_case. Ids are assigned here and nothing uses INSERT ... RETURNING, because
-- RETURNING would apply the select policies before the caller is a participant.

create function public.create_client_matter(
  p_applicant_name text,
  p_applicant_email text,
  p_sponsor_name text,
  p_sponsor_email text,
  p_consultant_membership_id uuid,
  p_rule_pack_version_id uuid default null,
  p_title text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  org uuid := app.current_organization_id();
  applicant_name text := btrim(coalesce(p_applicant_name, ''));
  applicant_email text := nullif(lower(btrim(coalesce(p_applicant_email, ''))), '');
  sponsor_name text := nullif(btrim(coalesce(p_sponsor_name, '')), '');
  sponsor_email text := nullif(lower(btrim(coalesce(p_sponsor_email, ''))), '');
  title text := nullif(btrim(coalesce(p_title, '')), '');
  created jsonb;
  matter_id uuid;
  applicant_id uuid := gen_random_uuid();
  sponsor_id uuid := gen_random_uuid();
  creator public.memberships%rowtype;
begin
  if org is null then
    raise exception 'matter create denied' using errcode = '42501';
  end if;
  if app.staff_mfa_satisfied() is distinct from true then
    raise exception 'aal2 is required to open a matter' using errcode = '42501';
  end if;
  if length(applicant_name) not between 1 and 200 then
    raise exception 'the applicant name is required' using errcode = '22023';
  end if;
  if sponsor_name is not null and length(sponsor_name) > 200 then
    raise exception 'the sponsor name is too long' using errcode = '22023';
  end if;
  if sponsor_name is null and sponsor_email is not null then
    raise exception 'the sponsor name is required with a sponsor email' using errcode = '22023';
  end if;
  if (applicant_email is not null and (length(applicant_email) > 320 or applicant_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'))
     or (sponsor_email is not null and (length(sponsor_email) > 320 or sponsor_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')) then
    raise exception 'email is invalid' using errcode = '22023';
  end if;
  if title is null then
    title := left(applicant_name, 200);
  end if;

  created := public.create_engaged_matter(title, false, p_consultant_membership_id, p_rule_pack_version_id, null);
  if (created ->> 'ok')::boolean is distinct from true then
    return created;
  end if;
  matter_id := (created ->> 'id')::uuid;

  insert into public.persons (id, organization_id, display_name, email, is_sample)
  values (applicant_id, org, applicant_name, applicant_email, false);
  insert into public.matter_participants (organization_id, matter_id, person_id, role)
  values (org, matter_id, applicant_id, 'applicant');

  if sponsor_name is not null then
    insert into public.persons (id, organization_id, display_name, email, is_sample)
    values (sponsor_id, org, sponsor_name, sponsor_email, false);
    insert into public.matter_participants (organization_id, matter_id, person_id, role)
    values (org, matter_id, sponsor_id, 'sponsor');
  end if;

  select * into creator
  from public.memberships mem
  where mem.organization_id = org
    and mem.user_id = (select auth.uid())
    and mem.status = 'active'
  order by mem.created_at
  limit 1;
  if creator.id is not null
     and creator.id is distinct from p_consultant_membership_id
     and creator.role in ('licensed_consultant', 'case_manager') then
    insert into public.matter_participants (organization_id, matter_id, membership_id, role)
    values (org, matter_id, creator.id, 'case_manager');
  end if;

  return jsonb_build_object(
    'ok', true,
    'id', matter_id,
    'reference', created ->> 'reference',
    'applicant_id', applicant_id,
    'sponsor_id', case when sponsor_name is null then null else sponsor_id end
  );
end;
$$;
revoke all on function public.create_client_matter(text, text, text, text, uuid, uuid, text) from public, anon;
grant execute on function public.create_client_matter(text, text, text, text, uuid, uuid, text)
  to authenticated, service_role;

comment on function public.create_client_matter(text, text, text, text, uuid, uuid, text) is
  'New real client matter at engagement pending: create_engaged_matter plus an applicant, an optional sponsor, and the creator as a case_manager participant. Invoker; sample mode still rejects it.';
