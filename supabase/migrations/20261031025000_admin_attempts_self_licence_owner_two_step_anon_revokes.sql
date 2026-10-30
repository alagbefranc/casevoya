-- Security review follow-ups.
--
-- 1. Admin-portal sign-in attempt lockout. app.platform_admin_attempts (no API role reads it) and
--    two service-role RPCs:
--      public.platform_admin_reserve_attempt(p_user, p_kind)  under a per-user transaction lock,
--        counts that user's attempts (any kind) in the last 15 minutes that did not succeed
--        (pending rows count); at 5 or more it refuses without a row, otherwise it records a
--        pending attempt and returns its id.
--      public.platform_admin_resolve_attempt(p_attempt, p_succeeded)  sets the outcome of a
--        pending attempt; an attempt already resolved is unchanged.
-- 2. app.record_licence_check (latest 20261031016000): in the firm-owner branch, an owner may record
--    a check on a credential they hold only as its first manual check (no manual register check,
--    by the owner or a platform admin, recorded yet; automatic CICC list checks do not count), and
--    never one that lifts an adverse status (a CICC list result) to a less severe one
--    (app.licence_status_severity, new). Later checks on the owner's own licence come from the
--    CICC list or a platform admin. Everything else is unchanged; the change is marked "Own
--    licence". The credential row is locked so two first checks cannot race.
-- 3. Client two-step (app.session_assurance_ok(), 20261030200000) on the remaining client branches:
--    app.gov_client_on_matter (only definition 20261019202100), public.request_intake_correction
--    (latest 20261020200000), public.my_consents (only definition 20261025270100). Staff branches
--    are unchanged; create or replace keeps grants.
-- 4. Execute on these public functions is revoked from anon (authenticated keeps it):
--    document_upload_limit, the checklist template functions, record_custody_step,
--    record_person_identity, resolve_person_flag, link_document_matter, set_document_translation,
--    set_document_classification, reuse_approved_facts, confirm_reused_fact.
--
-- Additive: one new table, three new functions, function bodies replaced, grants revoked.


-- ---------------------------------------------------------------------------
-- 1. Admin-portal attempt lockout
-- ---------------------------------------------------------------------------
create table if not exists app.platform_admin_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  kind text not null check (kind in ('password', 'mfa')),
  created_at timestamptz not null default now(),
  succeeded boolean null
);
comment on table app.platform_admin_attempts is
  'Admin-portal sign-in attempts per user (password or mfa). succeeded null means pending; pending and failed attempts in the last 15 minutes count toward the lockout. Written only by the platform_admin_*_attempt service-role functions.';

create index if not exists platform_admin_attempts_user_created_idx
  on app.platform_admin_attempts (user_id, created_at);

alter table app.platform_admin_attempts enable row level security;
alter table app.platform_admin_attempts force row level security;
revoke all on table app.platform_admin_attempts from public, anon, authenticated, service_role;

create or replace function public.platform_admin_reserve_attempt(p_user uuid, p_kind text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  failures integer;
  oldest timestamptz;
  wait_seconds integer;
  rid uuid;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_user is null then
    raise exception 'a user is required' using errcode = '22023';
  end if;
  if p_kind is null or p_kind not in ('password', 'mfa') then
    raise exception 'kind is password or mfa' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('platform_admin_attempts:' || p_user::text, 0));

  select count(*)::integer into failures
  from app.platform_admin_attempts a
  where a.user_id = p_user
    and a.created_at > now() - interval '15 minutes'
    and a.succeeded is distinct from true;

  if failures >= 5 then
    -- The window drops below 5 when this row leaves it.
    select a.created_at into oldest
    from app.platform_admin_attempts a
    where a.user_id = p_user
      and a.created_at > now() - interval '15 minutes'
      and a.succeeded is distinct from true
    order by a.created_at, a.id
    offset failures - 5
    limit 1;
    wait_seconds := greatest(1, ceil(extract(epoch from (oldest + interval '15 minutes' - now())))::integer);
    return jsonb_build_object('allowed', false, 'attempt_id', null, 'retry_after_seconds', wait_seconds);
  end if;

  insert into app.platform_admin_attempts (user_id, kind)
  values (p_user, p_kind)
  returning id into rid;

  -- Keep the table small: this user's attempts older than 30 days are not needed.
  delete from app.platform_admin_attempts old_row
  where old_row.user_id = p_user
    and old_row.created_at < now() - interval '30 days';

  return jsonb_build_object('allowed', true, 'attempt_id', rid, 'retry_after_seconds', 0);
end;
$$;
comment on function public.platform_admin_reserve_attempt(uuid, text) is
  'Admin portal (service role): reserves a sign-in attempt for a user, or refuses when 5 or more attempts in the last 15 minutes did not succeed (pending ones count). Returns allowed, attempt_id and retry_after_seconds.';
revoke all on function public.platform_admin_reserve_attempt(uuid, text) from public, anon, authenticated;
grant execute on function public.platform_admin_reserve_attempt(uuid, text) to service_role;

create or replace function public.platform_admin_resolve_attempt(p_attempt uuid, p_succeeded boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce((select auth.jwt() ->> 'role'), '') is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_attempt is null or p_succeeded is null then
    raise exception 'an attempt and its outcome are required' using errcode = '22023';
  end if;
  update app.platform_admin_attempts
     set succeeded = p_succeeded
   where id = p_attempt
     and succeeded is null;
end;
$$;
comment on function public.platform_admin_resolve_attempt(uuid, boolean) is
  'Admin portal (service role): records whether a pending sign-in attempt succeeded. An attempt already resolved is unchanged.';
revoke all on function public.platform_admin_resolve_attempt(uuid, boolean) from public, anon, authenticated;
grant execute on function public.platform_admin_resolve_attempt(uuid, boolean) to service_role;


-- ---------------------------------------------------------------------------
-- 2. Manual licence check (from 20261031016000; the firm-owner branch limits the owner's own
--    licence to its first manual check)
-- ---------------------------------------------------------------------------

-- How severe a credential status is: verified and declared 0, then not entitled, inactive,
-- suspended, revoked (the precedence of record_licence_check).
create or replace function app.licence_status_severity(p_status public.credential_status)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_status
    when 'revoked' then 4
    when 'suspended' then 3
    when 'inactive' then 2
    when 'not_entitled' then 1
    else 0
  end;
$$;
revoke all on function app.licence_status_severity(public.credential_status) from public;

create or replace function app.record_licence_check(
  p_credential_id uuid,
  p_source_url text,
  p_retrieved_at timestamptz,
  p_register_status public.register_licence_status,
  p_entitlement_to_practise boolean,
  p_discipline_suspended boolean,
  p_discipline_revoked boolean,
  p_discipline_restricted boolean,
  p_discipline_restriction_detail text,
  p_proof_locator text,
  p_notes text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  credential public.consultant_credentials%rowtype;
  host text;
  check_id uuid;
  result public.licence_check_result;
  new_status public.credential_status;
  review_at timestamptz;
  interval_known interval;
  restriction_detail text;
  -- Own licence:
  own_licence boolean := false;
begin
  if actor is null or app.staff_mfa_satisfied() is distinct from true
     or app.mfa_step_up_satisfied() is distinct from true then
    raise exception 'a licence check requires a recent step-up' using errcode = '42501';
  end if;
  -- Own licence: the row is locked so the first-check rule below cannot race.
  select * into credential from public.consultant_credentials where id = p_credential_id for update;
  if credential.id is null then
    raise exception 'licence check denied' using errcode = '42501';
  end if;
  if (app.in_active_org(credential.organization_id)
      and app.has_org_role(credential.organization_id, array['firm_owner']::public.org_role[])) is true then
    -- Firm-owner branch. Own licence: only its first manual check (automatic CICC list checks
    -- do not count); an adverse status is never lifted by it (checked below).
    own_licence := app.credential_held_by(credential.id, actor) is true;
    if own_licence
       and exists (
         select 1 from public.credential_checks chk
         where chk.credential_id = credential.id
           and chk.method is distinct from 'cicc_list'
       ) then
      raise exception 'you cannot record a check on your own licence' using errcode = '42501';
    end if;
  elsif app.platform_admin_has_role(array['owner', 'operator']) is true then
    -- Platform branch: never the caller's own licence.
    if app.credential_held_by(credential.id, actor) then
      raise exception 'you cannot record a check on your own licence' using errcode = '42501';
    end if;
  else
    raise exception 'licence check denied' using errcode = '42501';
  end if;

  host := app.cicc_register_host(p_source_url);
  if host is null then
    raise exception 'licence evidence must cite register.college-ic.ca' using errcode = '22023';
  end if;
  if p_retrieved_at is null or p_retrieved_at > statement_timestamp() + interval '5 minutes' then
    raise exception 'retrieval time is missing or in the future' using errcode = '22023';
  end if;
  if p_proof_locator is null or length(btrim(p_proof_locator)) not between 1 and 500 then
    raise exception 'a proof file reference is required' using errcode = '22023';
  end if;
  if p_register_status is null or p_entitlement_to_practise is null
     or p_discipline_suspended is null or p_discipline_revoked is null
     or p_discipline_restricted is null then
    raise exception 'register status, entitlement, and discipline flags are required' using errcode = '22023';
  end if;
  restriction_detail := nullif(btrim(coalesce(p_discipline_restriction_detail, '')), '');
  if p_discipline_restricted and (restriction_detail is null or length(restriction_detail) > 1000) then
    raise exception 'a restriction needs the register detail' using errcode = '22023';
  end if;
  if not p_discipline_restricted and restriction_detail is not null then
    raise exception 'restriction detail requires the restriction flag' using errcode = '22023';
  end if;

  -- Precedence matches src/modules/firm-onboarding/licence.ts.
  -- Revoked, then suspended, then inactive, then not entitled, otherwise verified.
  -- discipline_restricted and its detail are stored and do not change this result.
  -- not_entitled locks, the same as revoked, suspended, and inactive.
  if p_discipline_revoked then
    result := 'revoked';
    new_status := 'revoked';
  elsif p_discipline_suspended then
    result := 'suspended';
    new_status := 'suspended';
  elsif p_register_status = 'inactive' then
    result := 'inactive';
    new_status := 'inactive';
  elsif p_entitlement_to_practise is distinct from true then
    result := 'not_entitled';
    new_status := 'not_entitled';
  else
    result := 'verified';
    new_status := 'verified';
  end if;

  -- Own licence: an adverse status (from the CICC list) may only be kept or made more severe.
  if own_licence
     and app.licence_status_blocks(credential.status)
     and app.licence_status_severity(new_status) < app.licence_status_severity(credential.status) then
    raise exception 'you cannot record a check on your own licence' using errcode = '42501';
  end if;

  interval_known := app.product_setting_interval('licence.recheck_interval');
  review_at := case
    when interval_known is null then null
    else p_retrieved_at + interval_known
  end;

  insert into public.credential_checks (
    organization_id, credential_id, source_url, source_host, retrieved_at, result,
    proof_locator, register_status, entitlement_to_practise,
    discipline_suspended, discipline_revoked, discipline_restricted,
    discipline_restriction_detail, reviewer_user_id, notes
  ) values (
    credential.organization_id,
    credential.id,
    p_source_url,
    host,
    p_retrieved_at,
    result,
    btrim(p_proof_locator),
    p_register_status,
    p_entitlement_to_practise,
    p_discipline_suspended,
    p_discipline_revoked,
    p_discipline_restricted,
    restriction_detail,
    actor,
    nullif(btrim(coalesce(p_notes, '')), '')
  )
  returning id into check_id;

  update public.consultant_credentials
     set status = new_status,
         source_url = p_source_url,
         register_status = p_register_status,
         entitlement_to_practise = p_entitlement_to_practise,
         discipline_suspended = p_discipline_suspended,
         discipline_revoked = p_discipline_revoked,
         discipline_restricted = p_discipline_restricted,
         discipline_restriction_detail = restriction_detail,
         verification_method = 'manual_public_register',
         proof_locator = btrim(p_proof_locator),
         checked_at = p_retrieved_at,
         next_review_at = review_at,
         reviewer_user_id = actor
   where id = credential.id;

  perform app.sync_firm_verification(credential.organization_id);

  perform app.enqueue_licence_event(
    credential.organization_id,
    credential.id,
    'licence.recheck_due',
    jsonb_build_object(
      'credential_id', credential.id,
      'check_id', check_id,
      'method', 'manual_public_register',
      'interval_configured', interval_known is not null
    ),
    'licence.recheck_due:' || check_id::text,
    coalesce(review_at, statement_timestamp())
  );

  if new_status in ('revoked', 'suspended', 'inactive', 'not_entitled') then
    perform app.enqueue_licence_event(
      credential.organization_id,
      credential.id,
      'licence.adverse_status',
      jsonb_build_object(
        'credential_id', credential.id,
        'check_id', check_id,
        'status', new_status,
        'result', result
      ),
      'licence.adverse_status:' || check_id::text,
      statement_timestamp()
    );
  end if;

  perform app.record_audit_event(
    credential.organization_id,
    'licence.check_recorded',
    'public.credential_checks',
    check_id,
    'success',
    jsonb_build_object(
      'result', result,
      'status', new_status,
      'method', 'manual_public_register',
      'source_host', host,
      'register_status', p_register_status,
      'entitlement_to_practise', p_entitlement_to_practise,
      'discipline_suspended', p_discipline_suspended,
      'discipline_revoked', p_discipline_revoked,
      'discipline_restricted', p_discipline_restricted,
      'restriction_detail_recorded', restriction_detail is not null
    )
  );
  return check_id;
end;
$$;
revoke all on function app.record_licence_check(uuid, text, timestamptz, public.register_licence_status, boolean, boolean, boolean, boolean, text, text, text) from public;


-- ---------------------------------------------------------------------------
-- 3. Client two-step
-- ---------------------------------------------------------------------------

-- From 20261019202100_government_handoff_decisions.sql (its only definition).
create or replace function app.gov_client_on_matter(p_matter_id uuid, p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.matter_participants party
    join public.persons person
      on person.id = party.person_id
     and person.organization_id = party.organization_id
    where party.matter_id = p_matter_id
      and party.organization_id = p_org
      and person.user_id = (select auth.uid())
  )
  and (select app.session_assurance_ok());
$$;


-- From 20261020200000_intake_correction_must_change.sql.
create or replace function public.request_intake_correction(
  p_response_id uuid,
  p_field_key text,
  p_presence public.answer_presence,
  p_value jsonb,
  p_reason text,
  p_description text,
  p_proof_document_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  response public.intake_responses%rowtype;
  matter_sample boolean;
  previous uuid;
  new_answer uuid;
  next_number integer;
  new_id uuid;
  why text := nullif(btrim(coalesce(p_reason, '')), '');
  what text := nullif(btrim(coalesce(p_description, '')), '');
begin
  select * into response from public.intake_responses where id = p_response_id for update;
  if response.id is null
     or app.in_active_org(response.organization_id) is distinct from true
     or not exists (
       select 1
       from public.persons subject
       where subject.id = response.person_id
         and subject.organization_id = response.organization_id
         and subject.user_id = (select auth.uid())
     )
     or not (select app.session_assurance_ok()) then
    raise exception 'intake correction denied' using errcode = '42501';
  end if;
  if response.status is distinct from 'submitted' then
    raise exception 'a correction is for answers you already sent; change this one in the form' using errcode = '42501';
  end if;
  select matter.is_sample into matter_sample from public.matters matter where matter.id = response.matter_id;
  if app.sample_mode_blocks_real(response.organization_id, matter_sample) then
    raise exception 'this firm is in sample mode; only sample matters accept new work' using errcode = '42501';
  end if;
  if why is not null and length(why) > 1000 then
    raise exception 'keep the reason under 1000 characters' using errcode = '22023';
  end if;
  if what is not null and length(what) > 2000 then
    raise exception 'keep the description under 2000 characters' using errcode = '22023';
  end if;
  -- Proof is the person's own upload (the portal's ordinary upload flow) on this firm.
  if p_proof_document_id is not null and not exists (
    select 1
    from public.documents doc
    where doc.id = p_proof_document_id
      and doc.organization_id = response.organization_id
      and doc.person_id = response.person_id
  ) then
    raise exception 'that proof is not one of your documents' using errcode = '42501';
  end if;

  if nullif(btrim(coalesce(p_field_key, '')), '') is null then
    if what is null then
      raise exception 'describe what needs fixing' using errcode = '22023';
    end if;
  else
    select answer.id into previous
    from public.intake_answer_versions answer
    where answer.response_id = response.id
      and answer.field_key = p_field_key
    order by answer.created_at desc, answer.id desc
    limit 1;
    if previous is null then
      raise exception 'that question has no answer to correct' using errcode = '22023';
    end if;
    -- A correction must change the answer: the same presence and value as the latest version is
    -- not a correction (jsonb equality ignores key order).
    if exists (
      select 1
      from public.intake_answer_versions answer
      where answer.id = previous
        and answer.presence = p_presence
        and answer.raw_value is not distinct from coalesce(p_value, '{}'::jsonb)
    ) then
      raise exception 'that is the same as the answer you sent; change it, or describe the problem instead' using errcode = '22023';
    end if;
    new_answer := app.save_intake_answer_core(response.id, response.version, p_field_key, p_presence, p_value, true);
  end if;

  perform pg_advisory_xact_lock(hashtextextended('intake_corrections:' || response.organization_id::text, 0));
  select coalesce(max(correction_number), 0) + 1 into next_number
  from public.intake_corrections
  where organization_id = response.organization_id;

  insert into public.intake_corrections (
    organization_id, response_id, correction_number, field_key, previous_answer_id, answer_id, reason, description, proof_document_id
  ) values (
    response.organization_id,
    response.id,
    next_number,
    case when new_answer is null then null else p_field_key end,
    previous,
    new_answer,
    why,
    what,
    p_proof_document_id
  )
  returning id into new_id;

  perform app.record_audit_event(
    response.organization_id,
    'intake.correction_requested',
    'public.intake_corrections',
    new_id,
    'success',
    jsonb_build_object(
      'response_id', response.id,
      'matter_id', response.matter_id,
      'field_key', case when new_answer is null then null else p_field_key end,
      'answer_id', new_answer,
      'proof_document_id', p_proof_document_id,
      'is_sample', matter_sample
    )
  );
  return jsonb_build_object(
    'correction_id', new_id,
    'reference', 'CR-' || lpad(next_number::text, 4, '0'),
    'answer_id', new_answer
  );
end;
$$;


-- From 20261025270100_sec_sessions_consent.sql (its only definition).
create or replace function public.my_consents()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  org uuid := app.current_organization_id();
  v_person_id uuid;
begin
  if (select auth.uid()) is null or org is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  v_person_id := app.my_person_id(org);
  if v_person_id is null then
    raise exception 'consent denied' using errcode = '42501';
  end if;
  if not app.session_assurance_ok() then
    raise exception 'two-step sign-in is required' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'ai_drafting', app.person_consent_state(org, v_person_id, 'ai_drafting'),
    'marketing', app.person_consent_state(org, v_person_id, 'marketing'),
    'processing', app.person_consent_state(org, v_person_id, 'processing'),
    'marketing_since', (
      select c.created_at from public.consent_records c
      where c.organization_id = org and c.person_id = v_person_id and c.purpose = 'marketing'
      order by c.created_at desc, c.id desc limit 1
    )
  );
end;
$$;


-- ---------------------------------------------------------------------------
-- 4. No anon execute on signed-in functions
-- ---------------------------------------------------------------------------
revoke execute on function public.document_upload_limit(uuid) from anon;
revoke execute on function public.save_checklist_template(uuid, text, text, jsonb) from anon;
revoke execute on function public.approve_checklist_template(uuid, integer) from anon;
revoke execute on function public.checklist_apply_preview(uuid, uuid) from anon;
revoke execute on function public.apply_checklist(uuid, uuid, jsonb, uuid[]) from anon;
revoke execute on function public.record_custody_step(uuid, text, date, text, text, text) from anon;
revoke execute on function public.record_person_identity(uuid, text, jsonb, uuid, boolean) from anon;
revoke execute on function public.resolve_person_flag(uuid, text, text, text) from anon;
revoke execute on function public.link_document_matter(uuid, uuid) from anon;
revoke execute on function public.set_document_translation(uuid, integer, uuid, text) from anon;
revoke execute on function public.set_document_classification(uuid, integer, text, public.document_sensitivity) from anon;
revoke execute on function public.reuse_approved_facts(uuid) from anon;
revoke execute on function public.confirm_reused_fact(uuid) from anon;
