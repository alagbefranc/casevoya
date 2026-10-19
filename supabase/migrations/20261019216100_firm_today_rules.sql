-- Date rules count today in the firm's timezone (decision 2026-10-19, "Some date rules count today in UTC").
--
-- Each function below is its latest definition copied verbatim; the only change is the date of
-- today: current_date (the server's UTC date), or the explicit UTC date in app.accept_quote, becomes
-- app.firm_today(<the firm>) from 20261019216000. Grants, revokes and comments are repeated as they
-- were. Between 8 pm and midnight in Toronto the UTC date is already tomorrow, so these rules
-- accepted a date one day ahead of the firm's calendar (or refused one a day early).

-- app.person_is_minor: latest definition from 20261017140400_person_date_of_birth.sql; only the date of today changes.
create or replace function app.person_is_minor(p_person_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select app.derive_is_minor(
        person.date_of_birth,
        person.birth_date_precision,
        org.age_of_majority_years,
        app.firm_today(person.organization_id)
      )
      from public.persons person
      join public.organizations org on org.id = person.organization_id
      where person.id = p_person_id
    ),
    false
  );
$$;
revoke all on function app.person_is_minor(uuid) from public;
grant execute on function app.person_is_minor(uuid) to authenticated, service_role;

-- app.sync_person_birth: latest definition from 20261017140400_person_date_of_birth.sql; only the date of today changes.
create or replace function app.sync_person_birth()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  majority integer;
  was_minor boolean := case when tg_op = 'UPDATE' then old.is_minor else false end;
begin
  if new.date_of_birth is null and new.birth_date is not null then
    new.date_of_birth := new.birth_date;
    new.birth_date_precision := coalesce(new.birth_date_precision, 'day');
  end if;
  if new.date_of_birth is not null and new.birth_date_precision is null then
    new.birth_date_precision := 'day';
  end if;
  if new.date_of_birth is null then
    new.birth_date_precision := null;
    new.birth_date := null;
    new.is_minor := false;
    return new;
  end if;
  if new.date_of_birth > app.firm_today(new.organization_id) then
    raise exception 'date of birth cannot be in the future' using errcode = '22023';
  end if;
  new.birth_date := new.date_of_birth;

  select org.age_of_majority_years into majority
  from public.organizations org
  where org.id = new.organization_id;
  new.is_minor := app.derive_is_minor(
    new.date_of_birth,
    new.birth_date_precision,
    majority,
    app.firm_today(new.organization_id)
  );

  if tg_op = 'UPDATE' and was_minor and new.is_minor is distinct from true then
    perform app.enqueue_event(
      new.organization_id,
      'person',
      new.id,
      'person.majority_review_due',
      jsonb_build_object('person_id', new.id, 'date_of_birth', new.date_of_birth),
      new.version,
      'majority:' || new.id::text || ':' || new.date_of_birth::text
    );
  end if;
  return new;
end;
$$;
revoke all on function app.sync_person_birth() from public;

-- app.open_intake_response: latest definition from 20261017170100_intake_responses.sql; only the date of today changes.
create or replace function app.open_intake_response(
  p_template_id uuid,
  p_matter_id uuid,
  p_person_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  template public.intake_templates%rowtype;
  matter public.matters%rowtype;
  person public.persons%rowtype;
  new_id uuid;
begin
  select * into template from public.intake_templates where id = p_template_id;
  select * into matter from public.matters where id = p_matter_id;
  select * into person from public.persons where id = p_person_id;
  if template.id is null or matter.id is null or person.id is null
     or template.organization_id is distinct from matter.organization_id
     or person.organization_id is distinct from matter.organization_id then
    raise exception 'intake assignment denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    matter.organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[],
    false
  );
  if app.can_read_matter(matter.id) is distinct from true or app.can_read_person(person.id) is distinct from true then
    raise exception 'intake assignment denied' using errcode = '42501';
  end if;
  if template.status is distinct from 'published' or template.effective_on > app.firm_today(matter.organization_id) then
    raise exception 'that intake template is not in effect' using errcode = '42501';
  end if;
  if matter.is_sample is distinct from person.is_sample then
    raise exception 'sample and real records cannot be linked' using errcode = '42501';
  end if;
  if app.sample_mode_blocks_real(matter.organization_id, matter.is_sample) then
    raise exception 'this firm is in sample mode; only sample matters accept new work' using errcode = '42501';
  end if;

  insert into public.intake_responses (organization_id, template_id, matter_id, person_id)
  values (matter.organization_id, template.id, matter.id, person.id)
  returning id into new_id;

  if not exists (
    select 1
    from public.matter_stage_evidence evidence
    where evidence.matter_id = matter.id
      and evidence.kind = 'questionnaire_assigned'
  ) then
    insert into public.matter_stage_evidence (organization_id, matter_id, kind, summary)
    values (matter.organization_id, matter.id, 'questionnaire_assigned', 'Intake response assigned');
  end if;
  return new_id;
end;
$$;
revoke all on function app.open_intake_response(uuid, uuid, uuid) from public;
grant execute on function app.open_intake_response(uuid, uuid, uuid) to authenticated, service_role;

-- app.request_version_satisfies: latest definition from 20261017180100_document_requests.sql; only the date of today changes.
create or replace function app.request_version_satisfies(p_version_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.document_versions version
    where version.id = p_version_id
      and version.upload_state = 'clean'
      and version.review_state = 'accepted'
      and version.superseded_at is null
      and (version.expires_on is null or version.expires_on >= app.firm_today(version.organization_id))
  );
$$;
revoke all on function app.request_version_satisfies(uuid) from public;

-- app.accept_quote: latest definition from 20261017190100_inhouse_esign.sql; only the date of today changes.
create or replace function app.accept_quote(p_agreement_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  agreement public.agreements%rowtype;
begin
  select * into agreement from public.agreements where id = p_agreement_id for update;
  if agreement.id is null or agreement.kind <> 'quote' or agreement.organization_id is distinct from (select app.current_organization_id()) then
    raise exception 'quote denied' using errcode = '42501';
  end if;
  if agreement.quote_expires_on is not null and agreement.quote_expires_on < app.firm_today(agreement.organization_id) then
    raise exception 'quote expired' using errcode = '42501';
  end if;
  if agreement.status = 'accepted' then
    return;
  end if;
  if agreement.status <> 'sent' then
    raise exception 'quote denied' using errcode = '42501';
  end if;
  if app.can_read_agreement(agreement.id) is distinct from true
     and not exists (
       select 1
       from public.matter_participants party
       join public.persons person on person.id = party.person_id
       where party.matter_id = agreement.matter_id
         and person.user_id = (select auth.uid())
     ) then
    raise exception 'quote denied' using errcode = '42501';
  end if;
  perform app.open_esign_write(agreement.id);
  update public.agreements set status = 'accepted' where id = agreement.id;
  perform app.close_esign_write(agreement.id);
  perform app.record_audit_event(
    agreement.organization_id, 'agreement.quote_accepted', 'public.agreements', agreement.id, 'success',
    jsonb_build_object('matter_id', agreement.matter_id)
  );
end;
$$;
revoke all on function app.accept_quote(uuid) from public;
grant execute on function app.accept_quote(uuid) to authenticated, service_role;

-- app.set_credential_valid_until: latest definition from 20261018080000_credential_valid_until.sql; only the date of today changes.
create or replace function app.set_credential_valid_until(
  p_credential_id uuid,
  p_valid_until date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  credential public.consultant_credentials%rowtype;
  mem public.memberships%rowtype;
begin
  if actor is null or app.staff_mfa_satisfied() is distinct from true then
    raise exception 'setting a licence expiry requires two-step sign-in' using errcode = '42501';
  end if;
  select * into credential from public.consultant_credentials where id = p_credential_id;
  if credential.id is null
     or app.in_active_org(credential.organization_id) is distinct from true then
    raise exception 'licence expiry update denied' using errcode = '42501';
  end if;
  select * into mem
  from public.memberships
  where id = credential.membership_id
    and organization_id = credential.organization_id;
  -- The holder (their own active membership) or a firm owner in the same firm.
  if not (
    (mem.id is not null and mem.user_id = actor and mem.status = 'active')
    or app.has_org_role(credential.organization_id, array['firm_owner']::public.org_role[]) is true
  ) then
    raise exception 'licence expiry update denied' using errcode = '42501';
  end if;
  if p_valid_until is not null and p_valid_until < app.firm_today(credential.organization_id) then
    raise exception 'licence expiry date is in the past' using errcode = '22023';
  end if;

  update public.consultant_credentials
     set valid_until = p_valid_until
   where id = credential.id;

  perform app.record_audit_event(
    credential.organization_id,
    'licence.valid_until_set',
    'public.consultant_credentials',
    credential.id,
    'success',
    jsonb_build_object(
      'membership_id', credential.membership_id,
      'valid_until', p_valid_until,
      'previous_valid_until', credential.valid_until
    )
  );
  return credential.id;
end;
$$;
revoke all on function app.set_credential_valid_until(uuid, date) from public, anon;
grant execute on function app.set_credential_valid_until(uuid, date) to authenticated, service_role;

-- public.create_client_matter: latest definition from 20261018180000_create_client_matter_date_of_birth.sql; only the date of today changes.
create or replace function public.create_client_matter(
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
        and (p_applicant_date_of_birth > app.firm_today(org) or p_applicant_date_of_birth < date '1900-01-01'))
     or (p_sponsor_date_of_birth is not null
        and (p_sponsor_date_of_birth > app.firm_today(org) or p_sponsor_date_of_birth < date '1900-01-01')) then
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

-- public.update_lead: latest definition from 20261019201200_lead_functions.sql; only the date of today changes.
create or replace function public.update_lead(
  p_org uuid,
  p_lead uuid,
  p_expected_version integer,
  p_name text,
  p_email text,
  p_phone text,
  p_preferred_contact text,
  p_service_interest text,
  p_country_now text,
  p_language text,
  p_date_of_birth date,
  p_source_detail text,
  p_owner_membership_id uuid,
  p_proposed_fee_cents bigint,
  p_tags text[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  lead public.leads;
  v_name text := app.lead_text(p_name, 400);
  v_email text := lower(app.lead_text(p_email, 400));
  v_phone text := app.lead_text(p_phone, 60);
  v_problem text;
  v_version integer;
begin
  lead := app.lead_for_update(p_org, p_lead, p_expected_version);
  if lead.converted_at is not null then
    raise exception 'a converted lead is kept as it was; edit the client on the matter' using errcode = '22023';
  end if;
  v_problem := app.lead_contact_problem(v_name, v_email, v_phone);
  if v_problem is not null then
    raise exception '%', v_problem using errcode = '22023';
  end if;
  if v_email is null and v_phone is null and lead.source in ('web_form', 'hosted_page', 'booking_page', 'email') then
    raise exception 'keep an email address or a phone number' using errcode = '22023';
  end if;
  if p_preferred_contact is not null and p_preferred_contact not in ('email', 'phone') then
    raise exception 'choose email or phone as the preferred contact' using errcode = '22023';
  end if;
  if p_date_of_birth is not null and (p_date_of_birth > app.firm_today(p_org) or p_date_of_birth < date '1900-01-01') then
    raise exception 'date of birth is not plausible' using errcode = '22023';
  end if;
  if p_proposed_fee_cents is not null and p_proposed_fee_cents not between 0 and 99999999 then
    raise exception 'the proposed fee is out of range' using errcode = '22023';
  end if;
  perform app.lead_check_owner(p_org, p_owner_membership_id);

  update public.leads set
    display_name = v_name,
    email = v_email,
    phone = v_phone,
    preferred_contact = p_preferred_contact,
    service_interest = app.lead_text(p_service_interest, 120),
    country_now = app.lead_text(p_country_now, 100),
    language = app.lead_text(p_language, 100),
    date_of_birth = p_date_of_birth,
    source_detail = app.lead_text(p_source_detail, 200),
    owner_membership_id = p_owner_membership_id,
    proposed_fee_cents = p_proposed_fee_cents,
    tags = app.lead_tags(p_tags)
  where id = lead.id
  returning version into v_version;

  perform app.lead_event(p_org, lead.id, 'updated', null, null, null, '{}'::jsonb);
  if p_owner_membership_id is distinct from lead.owner_membership_id then
    perform app.lead_event(p_org, lead.id, 'assigned', null, null, null,
      jsonb_build_object('from', lead.owner_membership_id, 'to', p_owner_membership_id));
  end if;
  return v_version;
end;
$$;
revoke all on function public.update_lead(uuid, uuid, integer, text, text, text, text, text, text, text, date, text, uuid, bigint, text[]) from public, anon;
grant execute on function public.update_lead(uuid, uuid, integer, text, text, text, text, text, text, text, date, text, uuid, bigint, text[]) to authenticated;

-- public.add_lead_follow_up: latest definition from 20261019201200_lead_functions.sql; only the date of today changes.
create or replace function public.add_lead_follow_up(p_org uuid, p_lead uuid, p_title text, p_owner_membership_id uuid, p_due_on date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text := app.lead_text(p_title, 400);
  v_owner uuid := coalesce(p_owner_membership_id, app.lead_my_membership(p_org));
  v_id uuid;
begin
  perform app.require_active_staff(p_org, app.lead_staff_roles(), false);
  if v_title is null or length(v_title) > 200 then
    raise exception 'name the follow-up (up to 200 characters)' using errcode = '22023';
  end if;
  if p_due_on is not null and (p_due_on < app.firm_today(p_org) - 1 or p_due_on > app.firm_today(p_org) + 730) then
    raise exception 'choose a due date from today to two years ahead' using errcode = '22023';
  end if;
  if not exists (select 1 from public.leads l where l.id = p_lead and l.organization_id = p_org) then
    raise exception 'lead not found' using errcode = 'P0002';
  end if;
  perform app.lead_check_owner(p_org, v_owner);
  insert into public.lead_follow_ups (organization_id, lead_id, title, owner_membership_id, due_on)
  values (p_org, p_lead, v_title, v_owner, p_due_on)
  returning id into v_id;
  perform app.lead_event(p_org, p_lead, 'follow_up_added', null, null, null, jsonb_build_object('follow_up_id', v_id));
  return v_id;
end;
$$;
revoke all on function public.add_lead_follow_up(uuid, uuid, text, uuid, date) from public, anon;
grant execute on function public.add_lead_follow_up(uuid, uuid, text, uuid, date) to authenticated;

-- app.sign_off_submission_handoff: latest definition from 20261019202100_government_handoff_decisions.sql; only the date of today changes.
-- Reviewer sign-off: a licensed consultant, step-up, and current representation authority on file (GOV-01).
create or replace function app.sign_off_submission_handoff(p_handoff_id uuid, p_expected_version integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  handoff public.submission_handoffs%rowtype;
  reviewer uuid;
  new_version integer;
begin
  select * into handoff from public.submission_handoffs where id = p_handoff_id for update;
  if handoff.id is null or app.can_read_matter(handoff.matter_id) is distinct from true then
    raise exception 'sign-off denied' using errcode = '42501';
  end if;
  perform app.gov_require_licensed(handoff.organization_id);
  if handoff.version is distinct from p_expected_version then
    raise exception 'submission handoff version conflict' using errcode = '40001';
  end if;
  if handoff.status is distinct from 'awaiting_signoff' then
    raise exception 'this handoff is not waiting for sign-off' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.representation_authorities authority
    where authority.matter_id = handoff.matter_id
      and authority.organization_id = handoff.organization_id
      and authority.revoked_at is null
      and authority.effective_on <= app.firm_today(handoff.organization_id)
  ) then
    raise exception 'representation authority must be on file before sign-off' using errcode = '42501';
  end if;
  reviewer := app.gov_actor_membership(handoff.organization_id);
  perform app.gov_open_write(handoff.id);
  update public.submission_handoffs
  set status = 'authorized', signoff_membership_id = reviewer, signed_off_at = statement_timestamp()
  where id = handoff.id
  returning version into new_version;
  perform app.gov_close_write(handoff.id);
  perform app.record_audit_event(
    handoff.organization_id, 'submission.signed_off', 'public.submission_handoffs', handoff.id, 'success',
    jsonb_build_object('matter_id', handoff.matter_id, 'package_label', handoff.package_label, 'package_sha256', handoff.package_sha256)
  );
  return new_version;
end;
$$;
revoke all on function app.sign_off_submission_handoff(uuid, integer) from public;
grant execute on function app.sign_off_submission_handoff(uuid, integer) to authenticated, service_role;

-- app.gov_finish_verification: latest definition from 20261019202100_government_handoff_decisions.sql; only the date of today changes.
create or replace function app.gov_finish_verification(
  p_handoff_id uuid,
  p_receipt_version_id uuid,
  p_receipt_locator text,
  p_acknowledged_on date
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  handoff public.submission_handoffs%rowtype;
  evidence uuid;
  new_version integer;
begin
  select * into handoff from public.submission_handoffs where id = p_handoff_id;
  if p_receipt_version_id is null and (p_receipt_locator is null or length(btrim(p_receipt_locator)) = 0) then
    raise exception 'receipt evidence is required to verify a submission' using errcode = '22023';
  end if;
  if p_receipt_version_id is not null
     and app.gov_evidence_on_matter(p_receipt_version_id, handoff.matter_id, handoff.organization_id) is distinct from true then
    raise exception 'the receipt must be a stored file on this matter' using errcode = '42501';
  end if;
  if p_acknowledged_on is not null and p_acknowledged_on > app.firm_today(handoff.organization_id) then
    raise exception 'an acknowledgement date cannot be in the future' using errcode = '22023';
  end if;
  handoff.receipt_version_id := p_receipt_version_id;
  handoff.receipt_locator := nullif(btrim(coalesce(p_receipt_locator, '')), '');
  evidence := app.gov_submission_evidence(
    handoff,
    coalesce(handoff.receipt_locator, 'document version ' || p_receipt_version_id::text)
  );
  perform app.gov_open_write(handoff.id);
  update public.submission_handoffs
  set status = 'submission_verified',
      receipt_version_id = p_receipt_version_id,
      receipt_locator = handoff.receipt_locator,
      acknowledged_on = coalesce(p_acknowledged_on, acknowledged_on),
      verified_by_membership_id = app.gov_actor_membership(handoff.organization_id),
      verified_at = statement_timestamp(),
      stage_evidence_id = evidence
  where id = handoff.id
  returning version into new_version;
  perform app.gov_close_write(handoff.id);
  if (select government_status from public.matters where id = handoff.matter_id) = 'not_recorded' then
    perform app.gov_set_matter_status(handoff.matter_id, 'receipt_on_file');
  end if;
  perform app.record_audit_event(
    handoff.organization_id, 'submission.verified', 'public.submission_handoffs', handoff.id, 'success',
    jsonb_build_object('matter_id', handoff.matter_id, 'stage_evidence_id', evidence, 'receipt_file', p_receipt_version_id is not null)
  );
  return new_version;
end;
$$;
revoke all on function app.gov_finish_verification(uuid, uuid, text, date) from public;

-- app.record_government_correspondence: latest definition from 20261019202100_government_handoff_decisions.sql; only the date of today changes.
create or replace function app.record_government_correspondence(
  p_matter_id uuid,
  p_kind public.correspondence_kind,
  p_issuer text,
  p_channel public.correspondence_channel,
  p_document_date date,
  p_received_on date,
  p_action_requested text,
  p_stated_deadline text,
  p_reference_text text,
  p_evidence_version_id uuid,
  p_evidence_locator text,
  p_corrects_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  matter public.matters%rowtype;
  new_id uuid;
begin
  select * into matter from public.matters where id = p_matter_id;
  if matter.id is null or app.can_read_matter(matter.id) is distinct from true then
    raise exception 'correspondence denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(matter.organization_id, app.gov_staff_roles(), false);
  if app.sample_mode_blocks_real(matter.organization_id, matter.is_sample) then
    raise exception 'this firm is in sample mode; only sample matters accept new work' using errcode = '42501';
  end if;
  if p_received_on is null or p_received_on > app.firm_today(matter.organization_id) then
    raise exception 'the received date is required and cannot be in the future' using errcode = '22023';
  end if;
  if p_document_date is not null and p_document_date > app.firm_today(matter.organization_id) then
    raise exception 'the date on the letter cannot be in the future' using errcode = '22023';
  end if;
  if p_evidence_version_id is not null
     and app.gov_evidence_on_matter(p_evidence_version_id, matter.id, matter.organization_id) is distinct from true then
    raise exception 'the letter must be a stored file on this matter' using errcode = '42501';
  end if;
  if p_corrects_id is not null and not exists (
    select 1 from public.government_correspondence earlier
    where earlier.id = p_corrects_id and earlier.matter_id = matter.id
  ) then
    raise exception 'a correction points at a letter on this matter' using errcode = '42501';
  end if;
  insert into public.government_correspondence (
    organization_id, matter_id, kind, issuer, channel, document_date, received_on, action_requested,
    stated_deadline, reference_text, evidence_version_id, evidence_locator, corrects_id
  ) values (
    matter.organization_id, matter.id, p_kind, nullif(btrim(coalesce(p_issuer, '')), ''), p_channel,
    p_document_date, p_received_on, nullif(btrim(coalesce(p_action_requested, '')), ''),
    nullif(btrim(coalesce(p_stated_deadline, '')), ''), nullif(btrim(coalesce(p_reference_text, '')), ''),
    p_evidence_version_id, nullif(btrim(coalesce(p_evidence_locator, '')), ''), p_corrects_id
  )
  returning id into new_id;
  if p_kind in ('request', 'procedural_fairness') then
    perform app.gov_review_task(matter, new_id, 'Consultant review: government request received ' || to_char(p_received_on, 'YYYY-MM-DD'), 'high');
  elsif p_kind = 'decision' then
    perform app.gov_review_task(matter, new_id, 'Consultant review: decision letter received ' || to_char(p_received_on, 'YYYY-MM-DD'), 'high');
  end if;
  perform app.record_audit_event(
    matter.organization_id, 'government.correspondence_recorded', 'public.government_correspondence', new_id, 'success',
    jsonb_build_object('matter_id', matter.id, 'kind', p_kind, 'corrects_id', p_corrects_id, 'evidence', p_evidence_version_id is not null)
  );
  return new_id;
end;
$$;
revoke all on function app.record_government_correspondence(uuid, public.correspondence_kind, text, public.correspondence_channel, date, date, text, text, text, uuid, text, uuid) from public;
grant execute on function app.record_government_correspondence(uuid, public.correspondence_kind, text, public.correspondence_channel, date, date, text, text, text, uuid, text, uuid) to authenticated, service_role;

-- app.record_decision: latest definition from 20261019202100_government_handoff_decisions.sql; only the date of today changes.
-- Staff record what the letter says. A refusal opens an urgent consultant review at once (PRD §6).
create or replace function app.record_decision(
  p_correspondence_id uuid,
  p_outcome public.matter_outcome,
  p_milestone public.decision_milestone,
  p_decided_on date,
  p_authority_reasons text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  letter public.government_correspondence%rowtype;
  matter public.matters%rowtype;
  decision public.decision_records%rowtype;
  owner uuid;
begin
  select * into letter from public.government_correspondence where id = p_correspondence_id;
  if letter.id is null or app.can_read_matter(letter.matter_id) is distinct from true then
    raise exception 'decision denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    letter.organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[],
    false
  );
  if letter.kind is distinct from 'decision' or letter.verified_at is null then
    raise exception 'a decision is recorded from a verified decision letter' using errcode = '42501';
  end if;
  if p_outcome is null then
    raise exception 'choose the outcome the letter states' using errcode = '22023';
  end if;
  if p_milestone is not null and p_outcome is distinct from 'approved' then
    raise exception 'approval milestones belong to an approval' using errcode = '22023';
  end if;
  if p_decided_on is not null and p_decided_on > app.firm_today(letter.organization_id) then
    raise exception 'the decision date cannot be in the future' using errcode = '22023';
  end if;
  select * into matter from public.matters where id = letter.matter_id;
  insert into public.decision_records (
    organization_id, matter_id, correspondence_id, outcome, milestone, decided_on, authority_reasons
  ) values (
    letter.organization_id, letter.matter_id, letter.id, p_outcome, p_milestone, p_decided_on,
    nullif(btrim(coalesce(p_authority_reasons, '')), '')
  )
  returning * into decision;
  if p_outcome = 'refused' then
    owner := coalesce(matter.responsible_consultant_membership_id, app.gov_actor_membership(matter.organization_id));
    perform app.gov_follow_up(decision, 'refusal_review', 'Urgent: consultant review of refusal', owner, 'critical', app.firm_today(letter.organization_id), null);
  end if;
  perform app.record_audit_event(
    letter.organization_id, 'decision.recorded', 'public.decision_records', decision.id, 'success',
    jsonb_build_object('matter_id', letter.matter_id, 'outcome', p_outcome, 'milestone', p_milestone)
  );
  return decision.id;
end;
$$;
revoke all on function app.record_decision(uuid, public.matter_outcome, public.decision_milestone, date, text) from public;
grant execute on function app.record_decision(uuid, public.matter_outcome, public.decision_milestone, date, text) to authenticated, service_role;

-- app.migration_evaluate: latest definition from 20261019208100_migration_import.sql; only the date of today changes.
-- Plans every staged row of a batch from its mapping and the firm's current records. Writes each
-- row's normalized values, problems and plan, and returns the counts and the plan hash. The dry
-- run stores the hash; the commit evaluates again and must get the same hash.
create or replace function app.migration_evaluate(p_batch uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.migration_batches%rowtype;
  cols jsonb;
  vals jsonb;
  date_order text;
  default_consultant uuid;
  c_name integer;
  c_email integer;
  c_dob integer;
  c_phone integer;
  c_role integer;
  c_ref integer;
  c_title integer;
  c_program integer;
  c_stage integer;
  c_consultant integer;
  c_cm integer;
  r record;
  v_problems jsonb;
  v_matter_problems jsonb;
  has_error boolean;
  has_review boolean;
  v_name text;
  v_email text;
  v_dob_raw text;
  v_dob date;
  v_phone text;
  v_role_raw text;
  v_role text;
  v_ref text;
  v_title text;
  v_raw text;
  v_mapped text;
  v_pack uuid;
  v_stage text;
  v_consultant uuid;
  v_cm uuid;
  counts jsonb;
  hash text;
  roles constant text[] := array['applicant', 'dependant', 'sponsor', 'employer', 'guardian'];
  hdr text[];
  valid_consultants uuid[];
  valid_staff uuid[];
  valid_packs uuid[];
begin
  select * into b from public.migration_batches where id = p_batch for update;
  if b.id is null then
    raise exception 'migration batch not found' using errcode = 'P0002';
  end if;
  hdr := b.headers;
  cols := coalesce(b.mapping -> 'columns', '{}'::jsonb);
  vals := coalesce(b.mapping -> 'values', '{}'::jsonb);
  date_order := coalesce(b.mapping ->> 'date_order', 'dmy');
  default_consultant := nullif(b.mapping ->> 'default_consultant', '')::uuid;
  c_name := (cols ->> 'name')::integer;
  c_email := (cols ->> 'email')::integer;
  c_dob := (cols ->> 'date_of_birth')::integer;
  c_phone := (cols ->> 'phone')::integer;
  c_role := (cols ->> 'role')::integer;
  c_ref := (cols ->> 'reference')::integer;
  c_title := (cols ->> 'title')::integer;
  c_program := (cols ->> 'program')::integer;
  c_stage := (cols ->> 'stage')::integer;
  c_consultant := (cols ->> 'consultant')::integer;
  c_cm := (cols ->> 'case_manager')::integer;
  -- The firm's configured values, read once: active consultants and staff, published programs.
  select coalesce(array_agg(mem.id) filter (where mem.role in ('licensed_consultant', 'firm_owner')), '{}'),
         coalesce(array_agg(mem.id), '{}')
  into valid_consultants, valid_staff
  from public.memberships mem
  where mem.organization_id = b.organization_id and mem.status = 'active'
    and mem.role in ('licensed_consultant', 'case_manager', 'firm_owner');
  select coalesce(array_agg(pack.id), '{}') into valid_packs
  from public.rule_pack_versions pack
  where pack.status in ('published', 'review_due')
    and (pack.organization_id is null or pack.organization_id = b.organization_id);

  -- Pass 1: each row on its own.
  for r in select id, row_number, cells from public.migration_rows where batch_id = p_batch order by row_number loop
    v_problems := '[]'::jsonb;
    v_matter_problems := '[]'::jsonb;
    has_error := false;
    has_review := false;

    v_name := app.migration_cell(r.cells, c_name);
    if v_name is null then
      has_error := true;
      v_problems := v_problems || app.migration_problem(coalesce(hdr[c_name + 1], 'Name'), 'No name', 'Add the person’s name in your file');
    elsif length(v_name) > 200 then
      has_error := true;
      v_problems := v_problems || app.migration_problem(hdr[c_name + 1], 'The name is longer than 200 characters', 'Shorten it in your file');
    end if;

    v_email := lower(app.migration_cell(r.cells, c_email));
    if v_email is not null and (length(v_email) > 320 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then
      has_error := true;
      v_problems := v_problems || app.migration_problem(hdr[c_email + 1], format('“%s” isn’t an email address', left(v_email, 60)), 'Correct it or leave it blank');
      v_email := null;
    end if;

    v_dob_raw := app.migration_cell(r.cells, c_dob);
    v_dob := app.migration_date(v_dob_raw, date_order);
    if v_dob_raw is not null and v_dob is null then
      has_error := true;
      v_problems := v_problems || app.migration_problem(hdr[c_dob + 1], format('“%s” isn’t a real date', left(v_dob_raw, 40)), 'Correct the date or leave it unknown');
    elsif v_dob is not null and (v_dob > app.firm_today(b.organization_id) or v_dob < date '1900-01-01') then
      has_error := true;
      v_problems := v_problems || app.migration_problem(hdr[c_dob + 1], 'The date of birth is in the future or before 1900', 'Correct the date or leave it unknown');
      v_dob := null;
    end if;

    v_raw := app.migration_cell(r.cells, c_phone);
    v_phone := app.migration_phone(v_raw);
    if v_raw is not null and v_phone is null then
      has_error := true;
      v_problems := v_problems || app.migration_problem(hdr[c_phone + 1], format('“%s” isn’t a phone number with a country code', left(v_raw, 40)), 'Write it like +1 416 555 0101, or leave it blank');
    end if;

    v_role := null;
    v_role_raw := app.migration_cell(r.cells, c_role);
    if v_role_raw is not null then
      v_mapped := vals -> 'role' ->> app.migration_key(v_role_raw);
      if v_mapped is null and app.migration_key(v_role_raw) = any(roles) then
        v_mapped := app.migration_key(v_role_raw);
      end if;
      if v_mapped is null or (v_mapped <> 'none' and not (v_mapped = any(roles))) then
        has_review := true;
        v_problems := v_problems || app.migration_problem(hdr[c_role + 1], format('Role “%s” isn’t mapped', left(v_role_raw, 60)), 'Choose its role on Map columns');
      elsif v_mapped <> 'none' then
        v_role := v_mapped;
      end if;
    end if;

    v_ref := app.migration_cell(r.cells, c_ref);
    if v_ref is not null and length(v_ref) > 100 then
      has_error := true;
      v_problems := v_problems || app.migration_problem(hdr[c_ref + 1], 'The reference is longer than 100 characters', 'Shorten it in your file');
      v_ref := left(v_ref, 100);
    end if;

    v_title := app.migration_cell(r.cells, c_title);
    if v_title is not null and length(v_title) > 200 then
      v_matter_problems := v_matter_problems || app.migration_problem(hdr[c_title + 1], 'The matter title is longer than 200 characters', 'Shorten it in your file');
    end if;

    -- Matter fields (they count only on the matter's applicant row; see pass 2).
    v_pack := null;
    v_raw := app.migration_cell(r.cells, c_program);
    if v_raw is not null then
      v_mapped := vals -> 'program' ->> app.migration_key(v_raw);
      if v_mapped is null then
        v_matter_problems := v_matter_problems || app.migration_problem(hdr[c_program + 1], format('Program “%s” isn’t one of your programs', left(v_raw, 60)), 'Map it to a published program, or choose not imported');
      elsif v_mapped <> 'none' then
        v_pack := case when v_mapped ~ '^[0-9a-f-]{36}$' and v_mapped::uuid = any(valid_packs) then v_mapped::uuid end;
        if v_pack is null then
          v_matter_problems := v_matter_problems || app.migration_problem(hdr[c_program + 1], format('Program “%s” is mapped to a program that isn’t published', left(v_raw, 60)), 'Map it to a published program, or choose not imported');
        end if;
      end if;
    end if;

    v_stage := null;
    v_raw := app.migration_cell(r.cells, c_stage);
    if v_raw is not null then
      v_mapped := vals -> 'stage' ->> app.migration_key(v_raw);
      if v_mapped is null or (v_mapped <> 'none' and not (v_mapped = any(enum_range(null::public.matter_stage)::text[]))) then
        v_matter_problems := v_matter_problems || app.migration_problem(hdr[c_stage + 1], format('Stage “%s” isn’t a Casevoya stage', left(v_raw, 60)), 'Map it to a stage, or choose not imported');
      elsif v_mapped <> 'none' then
        v_stage := v_mapped;
      end if;
    end if;

    v_consultant := null;
    v_raw := app.migration_cell(r.cells, c_consultant);
    if v_raw is not null then
      v_mapped := vals -> 'consultant' ->> app.migration_key(v_raw);
      if v_mapped is null or v_mapped !~ '^[0-9a-f-]{36}$' then
        v_matter_problems := v_matter_problems || app.migration_problem(hdr[c_consultant + 1], format('Consultant “%s” isn’t mapped to someone on your team', left(v_raw, 60)), 'Choose who is responsible on Map columns');
      else
        v_consultant := v_mapped::uuid;
      end if;
    else
      v_consultant := default_consultant;
      if v_consultant is null then
        v_matter_problems := v_matter_problems || app.migration_problem(coalesce(hdr[c_consultant + 1], 'Consultant'), 'No responsible consultant', 'Choose a default consultant on Map columns');
      end if;
    end if;
    if v_consultant is not null and not (v_consultant = any(valid_consultants)) then
      v_matter_problems := v_matter_problems || app.migration_problem(coalesce(hdr[c_consultant + 1], 'Consultant'), 'The chosen consultant isn’t an active licensed consultant', 'Choose an active licensed consultant on Map columns');
      v_consultant := null;
    end if;

    v_cm := null;
    v_raw := app.migration_cell(r.cells, c_cm);
    if v_raw is not null then
      v_mapped := vals -> 'case_manager' ->> app.migration_key(v_raw);
      if v_mapped = 'none' then
        v_cm := null;
      elsif v_mapped is null or v_mapped !~ '^[0-9a-f-]{36}$' or not (v_mapped::uuid = any(valid_staff)) then
        v_matter_problems := v_matter_problems || app.migration_problem(hdr[c_cm + 1], format('Case manager “%s” isn’t mapped to someone on your team', left(v_raw, 60)), 'Choose who manages it on Map columns, or choose not imported');
      else
        v_cm := v_mapped::uuid;
      end if;
    end if;

    update public.migration_rows set
      normalized = jsonb_build_object(
        'name', v_name, 'email', v_email, 'date_of_birth', v_dob, 'phone', v_phone, 'role', v_role,
        'role_given', v_role_raw is not null, 'reference', v_ref, 'title', left(v_title, 200),
        'program_pack_id', v_pack, 'stage', v_stage, 'consultant', v_consultant, 'case_manager', v_cm,
        'matter_problems', v_matter_problems,
        'name_key', app.migration_name_key(v_name), 'phone_key', app.migration_phone_key(v_phone)
      ),
      problems = v_problems,
      plan = case when has_error then 'error' when has_review then 'review' else 'create' end::public.migration_row_plan,
      group_key = case when v_ref is not null then 'ref:' || lower(v_ref) else 'row:' || r.row_number end,
      is_applicant = false,
      match_person_id = null,
      match_row_number = null,
      match_detail = null
    where id = r.id;
  end loop;

  -- Pass 2: matters. Rows sharing a reference are one matter; its applicant is the row whose role
  -- is applicant, or else the first row without a role. Matter fields count on that row only.
  update public.migration_rows mr set group_first = g.g_first
  from (
    select x.group_key, min(x.row_number) as g_first from public.migration_rows x where x.batch_id = p_batch group by x.group_key
  ) g
  where mr.batch_id = p_batch and mr.group_key = g.group_key;

  update public.migration_rows mr set is_applicant = true
  from (
    select distinct on (x.group_key) x.id
    from public.migration_rows x
    where x.batch_id = p_batch
      and (x.normalized ->> 'role' = 'applicant' or (x.normalized ->> 'role' is null and not (x.normalized ->> 'role_given')::boolean))
    order by x.group_key, coalesce(x.normalized ->> 'role' = 'applicant', false) desc, x.row_number
  ) a
  where mr.id = a.id;

  -- A matter with no row that can be its applicant: its first row stands for it, needing review.
  update public.migration_rows mr set
    is_applicant = true,
    plan = case when mr.plan = 'create' then 'review'::public.migration_row_plan else mr.plan end,
    problems = case when mr.plan = 'create'
      then mr.problems || app.migration_problem('Role', 'This matter has no applicant', 'Mark one person as the applicant')
      else mr.problems end
  from (
    select distinct on (x.group_key) x.id
    from public.migration_rows x
    where x.batch_id = p_batch
      and not exists (select 1 from public.migration_rows y where y.batch_id = p_batch and y.group_key = x.group_key and y.is_applicant)
    order by x.group_key, x.row_number
  ) f
  where mr.id = f.id;

  update public.migration_rows set
    plan = case when plan = 'error' then plan else 'review' end,
    problems = problems || (normalized -> 'matter_problems')
  where batch_id = p_batch and is_applicant and jsonb_array_length(normalized -> 'matter_problems') > 0;

  -- Other people on the matter: one applicant per matter, and a role for everyone else.
  update public.migration_rows set
    plan = 'error',
    problems = problems || app.migration_problem('Role', 'A second applicant for the same reference', 'Give each matter one applicant')
  where batch_id = p_batch and not is_applicant and normalized ->> 'role' = 'applicant';
  update public.migration_rows set
    plan = case when plan = 'error' then plan else 'review' end,
    problems = problems || app.migration_problem('Role', 'No role for an additional person on this matter', 'Map a Role column (sponsor, dependant…)')
  where batch_id = p_batch and not is_applicant
    and normalized ->> 'role' is null and not (normalized ->> 'role_given')::boolean;

  -- Pass 3: possible duplicates of rows still to create. An existing client record first (same
  -- name plus a date of birth, email or phone; or a date of birth and phone), else an earlier row
  -- of this file in an earlier matter. A decision counts only for the match it was made about.
  with staged as (
    select mr.id, mr.row_number, mr.group_first,
           mr.normalized ->> 'name_key' as nk, mr.normalized ->> 'email' as email,
           (mr.normalized ->> 'date_of_birth')::date as dob, mr.normalized ->> 'phone_key' as pk
    from public.migration_rows mr
    where mr.batch_id = p_batch and mr.plan = 'create'
      and not exists (
        select 1 from public.migration_rows a
        where a.batch_id = p_batch and a.group_key = mr.group_key and a.is_applicant and a.plan in ('error', 'review')
      )
  ),
  people as materialized (
    select p.id, p.created_at, app.migration_name_key(p.display_name) as nk, lower(p.email) as email,
           p.date_of_birth as dob, app.migration_phone_key(p.contact_phone) as pk
    from public.persons p
    where p.organization_id = b.organization_id and p.is_sample = b.is_sample
  ),
  person_candidates as (
    select s.id as row_id, p.id as person_id, p.created_at, p.nk = s.nk as same_name, p.dob = s.dob as same_dob,
           p.email = s.email as same_email, length(s.pk) >= 7 and p.pk = s.pk as same_phone
    from staged s join people p on p.nk = s.nk
    where p.dob = s.dob or p.email = s.email or (length(s.pk) >= 7 and p.pk = s.pk)
    union
    select s.id, p.id, p.created_at, p.nk = s.nk, true, p.email = s.email, true
    from staged s join people p on p.dob = s.dob and length(s.pk) >= 7 and p.pk = s.pk
  ),
  person_best as (
    select distinct on (row_id) row_id, person_id,
           array_remove(array[
             case when same_name then 'name' end, case when same_dob then 'date of birth' end,
             case when same_email then 'email' end, case when same_phone then 'phone' end
           ], null) as detail
    from person_candidates
    order by row_id, created_at, person_id
  ),
  row_best as (
    select distinct on (s.id) s.id as row_id, o.row_number as other_row,
           array_remove(array[
             'name', case when o.dob = s.dob then 'date of birth' end,
             case when o.email = s.email then 'email' end,
             case when length(s.pk) >= 7 and o.pk = s.pk then 'phone' end
           ], null) as detail
    from staged s join staged o on o.nk = s.nk and o.group_first < s.group_first
    where o.dob = s.dob or o.email = s.email or (length(s.pk) >= 7 and o.pk = s.pk)
    order by s.id, o.group_first, o.row_number
  )
  update public.migration_rows mr set
    match_person_id = pb.person_id,
    match_row_number = case when pb.person_id is null then rb.other_row end,
    match_detail = coalesce(pb.detail, rb.detail)
  from staged s
  left join person_best pb on pb.row_id = s.id
  left join row_best rb on rb.row_id = s.id
  where mr.id = s.id and (pb.person_id is not null or rb.other_row is not null);

  -- Decisions: kept only for the match they were made about; otherwise the row waits for one.
  update public.migration_rows mr set
    plan = case
      when mr.decision_target = t.target and mr.decision = 'same' then 'link'::public.migration_row_plan
      when mr.decision_target = t.target and mr.decision = 'different' then 'create'::public.migration_row_plan
      else 'confirm'::public.migration_row_plan
    end,
    decision = case when mr.decision_target = t.target then mr.decision end,
    decided_by = case when mr.decision_target = t.target then mr.decided_by end,
    decided_at = case when mr.decision_target = t.target then mr.decided_at end,
    decision_target = case when mr.decision_target = t.target then mr.decision_target end
  from (
    select x.id, case when x.match_person_id is not null then 'person:' || x.match_person_id else 'row:' || x.match_row_number end as target
    from public.migration_rows x
    where x.batch_id = p_batch and x.plan = 'create' and (x.match_person_id is not null or x.match_row_number is not null)
  ) t
  where mr.id = t.id;
  update public.migration_rows set decision = null, decision_target = null, decided_by = null, decided_at = null
  where batch_id = p_batch and plan = 'create' and decision is not null and match_person_id is null and match_row_number is null;

  -- The same person as an earlier row that isn't imported: needs review (in file order, so a
  -- chain of such rows resolves).
  for r in
    select mr.id, mr.match_row_number
    from public.migration_rows mr
    where mr.batch_id = p_batch and mr.plan = 'link' and mr.decision_target like 'row:%'
    order by mr.group_first, mr.row_number
  loop
    if (select plan from public.migration_rows where batch_id = p_batch and row_number = r.match_row_number) not in ('create', 'link') then
      update public.migration_rows set
        plan = 'review',
        problems = problems || app.migration_problem('—', format('Same person as row %s, which isn’t imported', r.match_row_number), format('Fix row %s', r.match_row_number))
      where id = r.id;
    end if;
  end loop;

  -- A matter whose applicant now waits for a decision or review: its other people wait too.
  update public.migration_rows other set
    plan = 'skip',
    problems = other.problems || app.migration_problem('—', format('Not imported: row %s, this matter’s applicant, has a problem', app_row.row_number), format('Fix row %s', app_row.row_number))
  from public.migration_rows app_row
  where other.batch_id = p_batch and app_row.batch_id = p_batch and app_row.is_applicant
    and app_row.group_key = other.group_key and other.id <> app_row.id
    and app_row.plan in ('review', 'error') and other.plan in ('create', 'link', 'confirm');

  select jsonb_build_object(
    'rows', count(*),
    'create', count(*) filter (where plan = 'create'),
    'link', count(*) filter (where plan = 'link'),
    'confirm', count(*) filter (where plan = 'confirm'),
    'review', count(*) filter (where plan = 'review'),
    'error', count(*) filter (where plan = 'error'),
    'skip', count(*) filter (where plan = 'skip'),
    'matters', count(*) filter (where is_applicant and plan in ('create', 'link')),
    'matters_waiting', count(*) filter (where is_applicant and plan = 'confirm'),
    'problem_rows', count(*) filter (where plan in ('review', 'error', 'skip'))
  ),
  encode(sha256(convert_to(
    b.mapping::text || '|' || b.is_sample::text || '|' ||
    coalesce(string_agg(x.row_number || ':' || x.plan::text || ':' || coalesce(x.decision_target, '') || ':' || coalesce(x.normalized::text, ''), '|' order by x.row_number), ''),
    'UTF8')), 'hex')
  into counts, hash
  from public.migration_rows x
  where x.batch_id = p_batch;

  return counts || jsonb_build_object('plan_hash', hash);
end;
$$;
revoke all on function app.migration_evaluate(uuid) from public, anon, authenticated;
