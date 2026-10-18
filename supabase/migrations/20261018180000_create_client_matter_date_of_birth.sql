-- Optional dates of birth on the Sheet's New matter dialog.
--
-- public.create_portal_invitation refuses anyone without persons.date_of_birth (adulthood is
-- decided from it, 20261017140400 / 20261017140800), and nothing in the app could record one,
-- so no real client could be invited. create_client_matter now takes the applicant's and the
-- sponsor's date of birth, both optional.
--
-- The body is copied from the latest definition of public.create_client_matter
-- (20261018170000_create_client_matter_owner_participant.sql). Changes: two new trailing
-- parameters p_applicant_date_of_birth and p_sponsor_date_of_birth (date, default null, so
-- every existing 7-argument call still resolves), a plausibility check, and the two person
-- inserts write date_of_birth with day precision. Same security invoker, same search_path.
--
-- A different argument list is a new overload in Postgres, and two candidates would make a
-- 7-argument call ambiguous. Migrations here are additive only (scripts/check-migrations.mjs
-- forbids DROP FUNCTION), so the 7-argument signature is retired instead of dropped: it is
-- moved out of the API schema into app under a retired name and loses every grant. Nothing
-- calls it. Grants, revokes and the comment are re-applied to the new signature.

alter function public.create_client_matter(text, text, text, text, uuid, uuid, text)
  rename to create_client_matter_retired_20261018;
alter function public.create_client_matter_retired_20261018(text, text, text, text, uuid, uuid, text)
  set schema app;
revoke all on function app.create_client_matter_retired_20261018(text, text, text, text, uuid, uuid, text)
  from public, anon, authenticated, service_role;
comment on function app.create_client_matter_retired_20261018(text, text, text, text, uuid, uuid, text) is
  'Retired 7-argument create_client_matter (20261018170000). Replaced by public.create_client_matter with optional dates of birth. Not executable.';

create function public.create_client_matter(
  p_applicant_name text,
  p_applicant_email text,
  p_sponsor_name text,
  p_sponsor_email text,
  p_consultant_membership_id uuid,
  p_rule_pack_version_id uuid default null,
  p_title text default null,
  p_applicant_date_of_birth date default null,
  p_sponsor_date_of_birth date default null
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
  -- An optional date of birth: day precision, not in the future, and a plausible age.
  -- app.sync_person_birth mirrors it into birth_date and is_minor and rejects a future date too.
  if (p_applicant_date_of_birth is not null
        and (p_applicant_date_of_birth > current_date or p_applicant_date_of_birth < date '1900-01-01'))
     or (p_sponsor_date_of_birth is not null
        and (p_sponsor_date_of_birth > current_date or p_sponsor_date_of_birth < date '1900-01-01')) then
    raise exception 'date of birth is not plausible' using errcode = '22023';
  end if;
  if sponsor_name is null and p_sponsor_date_of_birth is not null then
    raise exception 'the sponsor name is required with a sponsor date of birth' using errcode = '22023';
  end if;

  created := public.create_engaged_matter(title, false, p_consultant_membership_id, p_rule_pack_version_id, null);
  if (created ->> 'ok')::boolean is distinct from true then
    return created;
  end if;
  matter_id := (created ->> 'id')::uuid;

  insert into public.persons (id, organization_id, display_name, email, is_sample, date_of_birth, birth_date_precision)
  values (
    applicant_id, org, applicant_name, applicant_email, false, p_applicant_date_of_birth,
    case when p_applicant_date_of_birth is null then null else 'day'::public.date_precision end
  );
  insert into public.matter_participants (organization_id, matter_id, person_id, role)
  values (org, matter_id, applicant_id, 'applicant');

  if sponsor_name is not null then
    insert into public.persons (id, organization_id, display_name, email, is_sample, date_of_birth, birth_date_precision)
    values (
      sponsor_id, org, sponsor_name, sponsor_email, false, p_sponsor_date_of_birth,
      case when p_sponsor_date_of_birth is null then null else 'day'::public.date_precision end
    );
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
  -- A firm owner is assigned like any other creator: owner person access is assignment-based.
  if creator.id is not null
     and creator.id is distinct from p_consultant_membership_id
     and creator.role in ('licensed_consultant', 'case_manager', 'firm_owner') then
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
revoke all on function public.create_client_matter(text, text, text, text, uuid, uuid, text, date, date) from public, anon;
grant execute on function public.create_client_matter(text, text, text, text, uuid, uuid, text, date, date)
  to authenticated, service_role;

comment on function public.create_client_matter(text, text, text, text, uuid, uuid, text, date, date) is
  'New real client matter at engagement pending: create_engaged_matter plus an applicant, an optional sponsor (each with an optional day-precision date of birth), and the creator (consultant, case manager or firm owner) as a case_manager participant. Invoker; sample mode still rejects it.';
