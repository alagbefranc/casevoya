-- SEC-01 client two-step, part 4, and a client upload-intent limit.
--
-- 1. app.session_assurance_ok() (20261030200000_client_two_step_enforced_in_db.sql) is added to
--    the remaining client / self branches. A portal person with a verified second factor reaches
--    these only from a session that completed it; a client without a factor is unchanged.
--      app.can_read_intake_response, app.can_read_intake_answer   intake responses and answers,
--                         and the tables and functions gated by them (intake requests,
--                         corrections, answer reviews, fact reuses, intake_response_forms).
--      app.intake_caller_can_write   save_intake_answer_core, submit_intake_response and the other
--                         intake writers that call it.
--      app.can_read_person_section, app.can_read_grant, and the policies consent_records_select,
--                         section_shares_select, person_contact_preferences_select.
--      public.privacy_requests_for_me, public.mark_privacy_notices_seen,
--      app.portal_renewal_reminders, public.set_my_consent.
--    Staff branches are unchanged. Each function is copied from its latest definition (named
--    above it) with only the client condition changed; create or replace keeps grants. Policies
--    are changed with alter policy, as 20261030223000 did.
--
-- 2. app.create_upload_intent (copied from 20261030235000): a caller who is not firm staff and not
--    the email ingest may open at most 60 upload intents per hour. Everything else is unchanged;
--    the change is marked "Limit".


-- ---------------------------------------------------------------------------
-- 1. Client two-step
-- ---------------------------------------------------------------------------

-- From 20261017170100_intake_responses.sql (its only definition).
create or replace function app.can_read_intake_response(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.intake_responses response
    join public.persons subject
      on subject.id = response.person_id
     and subject.organization_id = response.organization_id
    where response.id = p_id
      and app.in_active_org(response.organization_id)
      and (
        (
          subject.user_id = (select auth.uid())
          and (select app.session_assurance_ok())
        )
        or (
          app.staff_mfa_satisfied()
          and app.can_read_matter(response.matter_id)
          and app.is_org_staff(response.organization_id)
        )
      )
  );
$$;


-- From 20261019219000_owner_full_access.sql.
create or replace function app.can_read_intake_answer(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.intake_answer_versions answer
    join public.intake_responses response
      on response.id = answer.response_id
     and response.organization_id = answer.organization_id
    join public.persons subject
      on subject.id = response.person_id
     and subject.organization_id = response.organization_id
    where answer.id = p_id
      and app.in_active_org(answer.organization_id)
      and (
        (
          subject.user_id = (select auth.uid())
          and (select app.session_assurance_ok())
        )
        or (
          app.staff_mfa_satisfied()
          and (
            app.actor_staff_assigned_to_matter(response.matter_id, response.organization_id)
            or (
              answer.created_by = (select auth.uid())
              and app.has_org_role(
                response.organization_id,
                array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[]
              )
            )
            or app.break_glass_person_open(subject.id)
          )
        )
        -- Only answers explicitly marked as a shared family record reach other
        -- participants. A section-less answer is private to the subject and staff.
        or (
          answer.section_key = 'shared_family_record'
          and exists (
            select 1
            from public.matter_participants party
            join public.persons viewer
              on viewer.id = party.person_id
             and viewer.organization_id = party.organization_id
            where party.matter_id = response.matter_id
              and party.organization_id = response.organization_id
              and viewer.user_id = (select auth.uid())
          )
          and (select app.session_assurance_ok())
        )
        or (
          exists (
            select 1
            from public.section_shares share
            join public.persons grantee
              on grantee.id = share.grantee_person_id
             and grantee.organization_id = share.organization_id
            where answer.section_key is not null
              and share.organization_id = answer.organization_id
              and share.subject_person_id = response.person_id
              and share.matter_id = response.matter_id
              and share.section_key = answer.section_key
              and share.revoked_at is null
              and grantee.user_id = (select auth.uid())
          )
          and (select app.session_assurance_ok())
        )
        or (
          exists (
            select 1
            from public.access_grants grant_row
            join public.persons grantee
              on grantee.id = grant_row.grantee_person_id
             and grantee.organization_id = grant_row.organization_id
            where grant_row.organization_id = response.organization_id
              and grant_row.subject_person_id = subject.id
              and grant_row.kind = 'guardian'
              and grant_row.revoked_at is null
              and (grant_row.expires_at is null or grant_row.expires_at > statement_timestamp())
              and (grant_row.matter_id is null or grant_row.matter_id = response.matter_id)
              and grantee.user_id = (select auth.uid())
              and app.person_is_minor(subject.id)
          )
          and (select app.session_assurance_ok())
        )
      )
  );
$$;


-- From 20261017170100_intake_responses.sql (its only definition).
create or replace function app.intake_caller_can_write(p_response public.intake_responses)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (
    exists (
      select 1
      from public.persons subject
      where subject.id = p_response.person_id
        and subject.organization_id = p_response.organization_id
        and subject.user_id = (select auth.uid())
    )
    and (select app.session_assurance_ok())
  )
  or (
    app.staff_mfa_satisfied()
    and app.can_read_matter(p_response.matter_id)
    and app.has_org_role(
      p_response.organization_id,
      array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[]
    )
  );
$$;


-- From 20261019219000_owner_full_access.sql.
create or replace function app.can_read_person_section(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.person_section_records rec
    join public.persons subject
      on subject.id = rec.person_id
     and subject.organization_id = rec.organization_id
    where rec.id = p_id
      and app.in_active_org(rec.organization_id)
      and (
        (
          subject.user_id = (select auth.uid())
          and (select app.session_assurance_ok())
        )
        or app.actor_staff_assigned_to_matter(rec.matter_id, rec.organization_id)
        or (
          rec.created_by = (select auth.uid())
          and app.staff_mfa_satisfied()
          and app.has_org_role(
            rec.organization_id,
            array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[]
          )
        )
        or (
          app.staff_mfa_satisfied()
          and app.break_glass_person_open(subject.id)
        )
        or (
          exists (
            select 1
            from public.access_grants grant_row
            join public.persons grantee
              on grantee.id = grant_row.grantee_person_id
             and grantee.organization_id = grant_row.organization_id
            where grant_row.organization_id = rec.organization_id
              and grant_row.subject_person_id = subject.id
              and grant_row.kind = 'guardian'
              and grant_row.revoked_at is null
              and (grant_row.expires_at is null or grant_row.expires_at > statement_timestamp())
              and (grant_row.matter_id is null or grant_row.matter_id = rec.matter_id)
              and grantee.user_id = (select auth.uid())
              and app.person_is_minor(subject.id)
          )
          and (select app.session_assurance_ok())
        )
        or (
          exists (
            select 1
            from public.section_shares share
            join public.persons grantee
              on grantee.id = share.grantee_person_id
             and grantee.organization_id = share.organization_id
            where share.organization_id = rec.organization_id
              and share.subject_person_id = rec.person_id
              and share.matter_id = rec.matter_id
              and share.section_key = rec.section_key
              and share.revoked_at is null
              and grantee.user_id = (select auth.uid())
          )
          and (select app.session_assurance_ok())
        )
        or (
          rec.restricted is false
          and exists (
            select 1
            from public.matter_participants party
            join public.persons viewer
              on viewer.id = party.person_id
             and viewer.organization_id = party.organization_id
            where party.matter_id = rec.matter_id
              and party.organization_id = rec.organization_id
              and viewer.user_id = (select auth.uid())
          )
          and (select app.session_assurance_ok())
        )
      )
  );
$$;


-- From 20261017052636_persons_matters_grants.sql (its only definition).
create or replace function app.can_read_grant(p_grant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.access_grants g
    where g.id = p_grant_id
      and app.in_active_org(g.organization_id)
      and (
        app.actor_is_firm_owner(g.organization_id)
        or (
          exists (
            select 1
            from public.persons person
            where person.organization_id = g.organization_id
              and person.user_id = (select auth.uid())
              and (person.id = g.grantee_person_id or person.id = g.subject_person_id)
          )
          and (select app.session_assurance_ok())
        )
      )
  );
$$;


-- From 20261017140800_portal_invitations.sql (its only definition).
alter policy consent_records_select on public.consent_records
  using (
    (select app.in_active_org(organization_id))
    and (
      (
        exists (
          select 1
          from public.persons person
          where person.id = person_id
            and person.organization_id = organization_id
            and person.user_id = (select auth.uid())
        )
        and (select app.session_assurance_ok())
      )
      or (
        (select app.staff_mfa_satisfied())
        and (
          (select app.has_org_role(organization_id, array['firm_owner']::public.org_role[]))
          or (
            matter_id is not null
            and (select app.actor_staff_assigned_to_matter(matter_id, organization_id))
          )
        )
      )
    )
  );


-- From 20261017140800_portal_invitations.sql (its only definition).
alter policy section_shares_select on public.section_shares
  using (
    (select app.in_active_org(organization_id))
    and (
      (
        exists (
          select 1 from public.persons person
          where person.organization_id = section_shares.organization_id
            and person.user_id = (select auth.uid())
            and person.id in (section_shares.subject_person_id, section_shares.grantee_person_id)
        )
        and (select app.session_assurance_ok())
      )
      or (
        (select app.staff_mfa_satisfied())
        and (
          (select app.has_org_role(organization_id, array['firm_owner']::public.org_role[]))
          or (select app.actor_staff_assigned_to_matter(matter_id, organization_id))
        )
      )
    )
  );


-- From 20261017140800_portal_invitations.sql (its only definition).
alter policy person_contact_preferences_select on public.person_contact_preferences
  using (
    (select app.in_active_org(organization_id))
    and (
      (
        exists (
          select 1 from public.persons person
          where person.id = person_id
            and person.user_id = (select auth.uid())
        )
        and (select app.session_assurance_ok())
      )
      or (
        (select app.staff_mfa_satisfied())
        and (
          (select app.has_org_role(organization_id, array['firm_owner']::public.org_role[]))
          or exists (
            select 1
            from public.matter_participants party
            where party.person_id = person_contact_preferences.person_id
              and party.organization_id = person_contact_preferences.organization_id
              and (select app.actor_staff_assigned_to_matter(party.matter_id, party.organization_id))
          )
        )
      )
    )
  );


-- From 20261025280000_sec_privacy_responses.sql (its only definition).
create or replace function public.privacy_requests_for_me(p_org uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', req.id,
    'reference', req.reference,
    'kind', req.kind,
    'received_on', req.received_on,
    'closed_at', req.closed_at,
    'due_on', req.due_on,
    'extended_due_on', case when req.extension_notice_channel = 'portal' then req.extended_due_on end,
    'extension_reason', case when req.extension_notice_channel = 'portal' then req.extension_reason end,
    'extension_recourse', case when req.extension_notice_channel = 'portal' then req.extension_recourse end,
    'extension_basis', case when req.extension_notice_channel = 'portal' then req.extension_basis end,
    'law_name', lim.law_name,
    'source_section', lim.source_section,
    'source_url', lim.source_url,
    'current_to', lim.current_to,
    'delivery_id', delivery.id,
    'delivered_at', delivery.delivered_at,
    'expires_at', delivery.expires_at,
    'sha256', delivery.sha256,
    'byte_size', job.byte_size,
    'file_count', job.file_count,
    'download_count', delivery.download_count,
    'first_downloaded_at', delivery.first_downloaded_at
  ) order by req.received_on desc, req.number desc), '[]'::jsonb)
  from public.privacy_requests req
  join public.persons person on person.id = req.person_id and person.organization_id = req.organization_id
  left join public.privacy_time_limits lim
    on lim.id = req.extension_time_limit_id and lim.organization_id = req.organization_id and req.extension_notice_channel = 'portal'
  left join public.privacy_request_deliveries delivery on delivery.request_id = req.id and delivery.organization_id = req.organization_id
  left join public.privacy_request_responses job on job.id = delivery.response_id and job.organization_id = delivery.organization_id
  where req.organization_id = p_org
    and person.user_id = (select auth.uid())
    and (select app.session_assurance_ok())
    and app.privacy_person_has_portal(req.organization_id, req.person_id)
    and (req.extension_notice_channel = 'portal' or delivery.id is not null);
$$;


-- From 20261025280000_sec_privacy_responses.sql (its only definition).
create or replace function public.mark_privacy_notices_seen(p_org uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_n integer := 0;
begin
  if not app.session_assurance_ok() then
    return 0;
  end if;
  for v_row in
    select req.id
    from public.privacy_requests req
    join public.persons person on person.id = req.person_id and person.organization_id = req.organization_id
    where req.organization_id = p_org
      and person.user_id = (select auth.uid())
      and app.privacy_person_has_portal(req.organization_id, req.person_id)
      and req.extension_notice_channel = 'portal'
      and req.extension_notice_seen_at is null
    for update of req
  loop
    update public.privacy_requests set extension_notice_seen_at = clock_timestamp() where id = v_row.id;
    perform app.record_audit_event(p_org, 'privacy.extension_notice_seen', 'public.privacy_requests', v_row.id, 'success', '{}'::jsonb);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;


-- From 20261025451000_des_portal_renewal_source_state.sql.
create or replace function app.portal_renewal_reminders(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_person uuid;
begin
  if (select auth.uid()) is null or p_org is null or p_org is distinct from app.current_organization_id()
     or not app.session_assurance_ok() then
    return '[]'::jsonb;
  end if;
  select person.id into v_person
  from public.persons person
  where person.organization_id = p_org and person.user_id = (select auth.uid())
  limit 1;
  if v_person is null or not exists (
    select 1 from public.person_contact_preferences pref where pref.person_id = v_person and pref.deadline_reminders
  ) then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', renewal.id,
      'matter_id', renewal.matter_id,
      'document_label', renewal.document_label,
      'expires_on', renewal.expires_on,
      'remind_on', renewal.remind_on,
      'service_scope', renewal.service_scope,
      'timing', case when timing.id is null then null else jsonb_build_object(
        'text', timing.timing_text, 'source_url', timing.source_url, 'checked_on', timing.checked_on,
        'current_to', timing.current_to, 'snapshot_sha256', timing.snapshot_sha256,
        'page_attested_on', timing.page_attested_on,
        'page_attested_by', case when timing.page_attested_on is null then null else coalesce(
          (select nullif(btrim(profile.display_name), '')
           from public.memberships mem join public.profiles profile on profile.id = mem.user_id
           where mem.id = timing.page_attested_by_membership_id),
          'your consultant') end,
        -- DES-04: whether the timing and its official page are still current.
        'status', timing.status,
        'source_review', source.review_status,
        'source_next_review', source.next_review_at,
        'source_change', source.change_state,
        'source_attempt', source.last_attempt_result,
        'source_attempt_at', source.last_attempt_at) end,
      'fee', app.renewal_current_fee(renewal.organization_id, renewal.fee_section, renewal.fee_group, renewal.fee_name)
    ) order by renewal.expires_on)
    from public.decision_renewals renewal
    left join public.renewal_timings timing on timing.id = renewal.timing_id
    left join public.official_sources source on source.id = timing.source_id
    where renewal.organization_id = p_org
      and renewal.client_person_id = v_person
      and renewal.reminder_set_at is not null
      and renewal.cancelled_at is null
  ), '[]'::jsonb);
end;
$$;


-- From 20261025270100_sec_sessions_consent.sql (its only definition).
create or replace function public.set_my_consent(p_purpose text, p_granted boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid := app.current_organization_id();
  v_person_id uuid;
  v_purpose public.consent_purpose;
  current_state boolean;
  v_statement text;
  rid uuid;
  review uuid;
begin
  if (select auth.uid()) is null or org is null or p_granted is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  v_person_id := app.my_person_id(org);
  if v_person_id is null then
    raise exception 'consent denied' using errcode = '42501';
  end if;
  if not app.session_assurance_ok() then
    raise exception 'two-step sign-in is required' using errcode = '42501';
  end if;
  if p_purpose not in ('ai_drafting', 'marketing', 'processing') then
    raise exception 'that consent is not changed here' using errcode = '22023';
  end if;
  v_purpose := p_purpose::public.consent_purpose;
  current_state := app.person_consent_state(org, v_person_id, v_purpose);
  if current_state is not distinct from p_granted then
    return jsonb_build_object('granted', p_granted, 'changed', false, 'review_id', null);
  end if;
  -- The same statements the portal invitation shows, so the record says what was answered.
  v_statement := case p_purpose
    when 'ai_drafting' then 'The firm may use drafting help that a person at the firm reviews before it is used.'
    when 'processing' then 'I agree that the firm can use my information to prepare this application.'
    else 'Send me news and offers from the firm.'
  end;
  insert into public.consent_records (organization_id, person_id, purpose, statement_text, statement_sha256, granted, created_by)
  values (org, v_person_id, v_purpose, v_statement, app.portal_statement_hash(v_statement), p_granted, (select auth.uid()))
  returning id into rid;
  select r.id into review from public.consent_impact_reviews r where r.consent_record_id = rid and r.organization_id = org;
  perform app.record_portal_audit(
    org, case when p_granted then 'consent.given' else 'consent.withdrawn' end,
    'public.consent_records', rid, 'success',
    jsonb_build_object('purpose', p_purpose, 'review_id', review)
  );
  return jsonb_build_object('granted', p_granted, 'changed', true, 'review_id', review);
end;
$$;


-- ---------------------------------------------------------------------------
-- 2. Upload-intent limit for clients
-- ---------------------------------------------------------------------------

-- From 20261030235000_governance_writes_and_co_applicant_request_binding.sql.
create or replace function app.create_upload_intent(
  p_matter_id uuid,
  p_person_id uuid,
  p_filename text,
  p_declared_byte_size bigint,
  p_purpose text,
  p_sensitivity public.document_sensitivity,
  p_audience public.document_audience,
  p_document_id uuid,
  p_translation_of_version_id uuid,
  p_language_tag text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  matter public.matters%rowtype;
  source public.document_versions%rowtype;
  doc_id uuid;
  version_id uuid;
  next_number integer;
  media text;
  storage_key text;
  limit_bytes bigint;
begin
  if app.actor_can_upload_for(p_matter_id, p_person_id) is distinct from true then
    raise exception 'document upload denied' using errcode = '42501';
  end if;
  select * into matter from public.matters where id = p_matter_id;
  -- #272: allowed only through a co-applicant's request (not the person, not staff, not the email
  -- ingest): the file is what the request makes it, matter-visible and ordinary, never a
  -- translation, and a new version only of a document the caller can already read.
  if matter.organization_id is distinct from app.email_ingest_org()
     and not exists (
       select 1
       from public.persons person
       where person.id = p_person_id
         and person.user_id = (select auth.uid())
     )
     and not (
       app.staff_mfa_satisfied()
       and app.mfa_step_up_satisfied()
       and app.has_org_role(
         matter.organization_id,
         array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[]
       )
       and app.can_read_matter(matter.id)
     ) then
    if coalesce(p_audience, 'subject') is distinct from 'matter'
       or coalesce(p_sensitivity, 'ordinary') is distinct from 'ordinary'
       or p_translation_of_version_id is not null
       or (p_document_id is not null and app.can_read_document(p_document_id) is distinct from true)
       -- Request: an open request for this person, with its purpose and its document.
       or app.actor_may_fulfil_request_upload(matter.id, p_person_id, p_purpose, p_document_id) is distinct from true then
      raise exception 'document upload denied' using errcode = '42501';
    end if;
  end if;
  -- Limit: a caller who is not firm staff (and not the email ingest) opens at most 60 upload
  -- intents per hour.
  if (select auth.uid()) is not null
     and matter.organization_id is distinct from app.email_ingest_org()
     and app.is_org_staff(matter.organization_id) is distinct from true
     and (
       select count(*)
       from public.document_versions recent
       where recent.created_by = (select auth.uid())
         and recent.created_at > statement_timestamp() - interval '1 hour'
     ) >= 60 then
    raise exception 'upload rate limit reached' using errcode = '54000';
  end if;
  media := app.media_type_for_filename(p_filename);
  if media is null then
    raise exception 'use a PDF, JPEG, PNG, HEIC, or DOCX file' using errcode = '22023';
  end if;
  limit_bytes := app.document_max_bytes(matter.organization_id);
  if p_declared_byte_size is null or p_declared_byte_size < 1 or p_declared_byte_size > limit_bytes then
    raise exception 'file is above the upload limit' using errcode = '22023';
  end if;
  if p_purpose is null or length(btrim(p_purpose)) not between 1 and 200 then
    raise exception 'document purpose is required' using errcode = '22023';
  end if;
  if p_translation_of_version_id is not null and (
    p_language_tag is null or p_language_tag !~ '^[a-z]{2}(-[A-Z]{2})?$'
  ) then
    raise exception 'a translation needs a language tag' using errcode = '22023';
  end if;

  if p_document_id is null then
    insert into public.documents (
      organization_id, person_id, purpose, sensitivity, audience, translates_document_id, created_by
    ) values (
      matter.organization_id,
      p_person_id,
      btrim(p_purpose),
      coalesce(p_sensitivity, 'ordinary'),
      coalesce(p_audience, 'subject'),
      null,
      (select auth.uid())
    )
    returning id into doc_id;
    next_number := 1;
  else
    -- A new version: same firm and person, already on this matter, and readable by the caller
    -- (the email-ingest org path is exempt from the read check only).
    if not exists (
      select 1
      from public.documents doc
      where doc.id = p_document_id
        and doc.organization_id = matter.organization_id
        and doc.person_id = p_person_id
    )
    or not exists (
      select 1
      from public.document_matter_refs ref
      where ref.document_id = p_document_id
        and ref.matter_id = matter.id
        and ref.organization_id = matter.organization_id
        and ref.removed_at is null
    )
    or (
      matter.organization_id is distinct from app.email_ingest_org()
      and app.can_read_document(p_document_id) is distinct from true
    ) then
      raise exception 'document upload denied' using errcode = '42501';
    end if;
    doc_id := p_document_id;
    select coalesce(max(version_number), 0) + 1 into next_number
    from public.document_versions
    where document_id = doc_id;
  end if;

  if p_translation_of_version_id is not null then
    select * into source
    from public.document_versions
    where id = p_translation_of_version_id
      and organization_id = matter.organization_id;
    if source.id is null then
      raise exception 'translation source was not found' using errcode = '42501';
    end if;
  end if;

  version_id := gen_random_uuid();
  storage_key := matter.organization_id::text
    || '/quarantine/'
    || version_id::text
    || '/'
    || encode(extensions.gen_random_bytes(16), 'hex');

  insert into public.document_versions (
    id, organization_id, document_id, version_number, storage_key, original_filename,
    declared_media_type, declared_byte_size, parent_version_id, translation_of_version_id,
    language_tag, intent_expires_at, created_by
  ) values (
    version_id,
    matter.organization_id,
    doc_id,
    next_number,
    storage_key,
    btrim(p_filename),
    media,
    p_declared_byte_size,
    case when p_document_id is null then null else (
      select id from public.document_versions
      where document_id = doc_id and version_number = next_number - 1
    ) end,
    p_translation_of_version_id,
    p_language_tag,
    statement_timestamp() + make_interval(secs => app.upload_intent_seconds()),
    (select auth.uid())
  );

  insert into public.document_matter_refs (organization_id, document_id, matter_id, created_by)
  select matter.organization_id, doc_id, matter.id, (select auth.uid())
  where not exists (
    select 1
    from public.document_matter_refs ref
    where ref.document_id = doc_id
      and ref.matter_id = matter.id
      and ref.removed_at is null
  );

  perform app.open_document_write(doc_id);
  update public.documents
  set current_version_id = version_id
  where id = doc_id;
  perform app.close_document_write(doc_id);

  return jsonb_build_object(
    'document_id', doc_id,
    'version_id', version_id,
    'storage_bucket', 'documents',
    'storage_key', storage_key,
    'declared_media_type', media
  );
end;
$$;
