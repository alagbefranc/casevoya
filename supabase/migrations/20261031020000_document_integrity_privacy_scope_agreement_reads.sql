-- Documents review fixes (DOC-1, DOC-2, DOC-3, DOC-4, DOC-6, DOC-9). Additive only; each function is
-- copied from its latest definition (named above it) and only the marked parts change.
--
-- DOC-1 app.create_upload_intent: the document's own person (not staff with step-up, not the email
--   ingest) adds a new version only of a document they created themselves as a non-staff upload
--   (never a sealed agreement or certificate, scan_result 'in_house_seal', and never a version filed
--   as government correspondence), or of a document named by an open request for them on this
--   matter. Marked "Firm-issued".
-- DOC-9 app.create_upload_intent: the translation source must be readable by the caller
--   (app.can_read_document) and its document linked to the same matter. Marked "Translation".
-- DOC-2 document_versions.intent_matter_id records the matter an upload intent was opened for.
--   app.attach_upload_to_request requires the request to be on that matter (older versions without
--   it: the document must be linked to the request's matter). When the document already has other
--   versions, the request does not lower its audience or sensitivity unless the caller passes the
--   app.set_document_classification checks (owner, licensed consultant or case manager, staff MFA,
--   step-up); otherwise the stricter existing value is kept. Marked "Matter" and "Classification".
-- DOC-3 app.privacy_scope_search: a document that is not the requester's (unless matter-visible and
--   ordinary) and any staff-only document are listed as withheld, with an open line on the
--   redaction worklist, so a reviewer decides before the redaction step can close. The requester's
--   own documents and matter-visible ordinary documents stay included. Marked "Documents".
-- DOC-4 app.can_read_document: the client branches of a document holding a sealed agreement or
--   certificate version also need app.can_read_agreement for that envelope's agreement.
-- DOC-6 app.can_read_agreement: the staff-signer branch needs staff MFA.

-- ---------------------------------------------------------------------------
-- DOC-2 The matter an upload intent was opened for
-- ---------------------------------------------------------------------------

alter table public.document_versions add column if not exists intent_matter_id uuid;
comment on column public.document_versions.intent_matter_id is
  'The matter the upload intent was opened for (set by app.create_upload_intent). A request attach must be on this matter.';
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'document_versions_intent_matter_org_fkey'
      and conrelid = 'public.document_versions'::regclass
  ) then
    alter table public.document_versions
      add constraint document_versions_intent_matter_org_fkey
      foreign key (intent_matter_id, organization_id) references public.matters (id, organization_id);
  end if;
end;
$$;
create index if not exists document_versions_intent_matter_org_fk_idx
  on public.document_versions (intent_matter_id, organization_id);

-- ---------------------------------------------------------------------------
-- DOC-1 / DOC-9 / DOC-2 Upload intent
-- ---------------------------------------------------------------------------

-- From 20261031012000_client_two_step_intake_consent_privacy.sql.
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
    -- Firm-issued: the person themselves (not staff with step-up) adds a version only of a document
    -- they uploaded as a non-staff user (not sealed, not filed as government correspondence), or
    -- of one an open request for them on this matter names.
    if matter.organization_id is distinct from app.email_ingest_org()
       and exists (
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
       )
       and not exists (
         select 1
         from public.document_requests request
         where request.document_id = p_document_id
           and request.person_id = p_person_id
           and request.matter_id = matter.id
           and request.organization_id = matter.organization_id
           and request.status = 'open'
       )
       and not (
         exists (
           select 1
           from public.documents doc
           where doc.id = p_document_id
             and doc.created_by = (select auth.uid())
         )
         and app.is_org_staff(matter.organization_id) is distinct from true
         and not exists (
           select 1
           from public.document_versions earlier
           where earlier.document_id = p_document_id
             and earlier.scan_result = 'in_house_seal'
         )
         and not exists (
           select 1
           from public.government_correspondence letter
           join public.document_versions earlier
             on earlier.id = letter.evidence_version_id
            and earlier.organization_id = letter.organization_id
           where earlier.document_id = p_document_id
         )
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
    -- Translation: the source is readable by the caller and on this matter.
    if matter.organization_id is distinct from app.email_ingest_org()
       and (
         app.can_read_document(source.document_id) is distinct from true
         or not exists (
           select 1
           from public.document_matter_refs ref
           where ref.document_id = source.document_id
             and ref.matter_id = matter.id
             and ref.organization_id = matter.organization_id
             and ref.removed_at is null
         )
       ) then
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
    language_tag, intent_expires_at, created_by, intent_matter_id
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
    (select auth.uid()),
    matter.id
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

-- ---------------------------------------------------------------------------
-- DOC-2 Request attach: same matter, no classification downgrade
-- ---------------------------------------------------------------------------

-- From 20261031017000_coapplicant_attach_credit_reservations_viewer_mfa.sql.
create or replace function app.attach_upload_to_request(p_version_id uuid, p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  version public.document_versions%rowtype;
  request public.document_requests%rowtype;
  target public.documents%rowtype;
  ext text;
  may_classify boolean;
  new_audience public.document_audience;
  new_sensitivity public.document_sensitivity;
begin
  select * into version from public.document_versions where id = p_version_id for update;
  select * into request from public.document_requests where id = p_request_id for update;
  if version.id is null or request.id is null
     or version.organization_id is distinct from request.organization_id
     or version.created_by is distinct from (select auth.uid())
     or version.upload_state is distinct from 'uploading'
     or request.status is distinct from 'open' then
    raise exception 'document upload denied' using errcode = '42501';
  end if;
  -- Matter: the request is on the matter the upload intent was opened for (older versions: the
  -- document is linked to the request's matter).
  if version.intent_matter_id is not null then
    if version.intent_matter_id is distinct from request.matter_id then
      raise exception 'document upload denied' using errcode = '42501';
    end if;
  elsif not exists (
    select 1
    from public.document_matter_refs ref
    where ref.document_id = version.document_id
      and ref.matter_id = request.matter_id
      and ref.organization_id = request.organization_id
      and ref.removed_at is null
  ) then
    raise exception 'document upload denied' using errcode = '42501';
  end if;
  if app.actor_can_upload_for(request.matter_id, request.person_id) is distinct from true then
    raise exception 'document upload denied' using errcode = '42501';
  end if;
  -- Request: someone else on the matter (not the person, not staff, not the email ingest) may
  -- attach only to this request when it is one they can fulfil, with the document's purpose.
  if request.organization_id is distinct from app.email_ingest_org()
     and not (
       exists (
         select 1
         from public.persons person
         where person.id = request.person_id
           and person.user_id = (select auth.uid())
       )
       and app.session_assurance_ok()
     )
     and not (
       app.staff_mfa_satisfied()
       and app.mfa_step_up_satisfied()
       and app.has_org_role(
         request.organization_id,
         array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[]
       )
       and app.can_read_matter(request.matter_id)
     ) then
    if request.audience is distinct from 'matter'
       or request.sensitivity is distinct from 'ordinary'
       or request.organization_id is distinct from (select app.current_organization_id())
       or not exists (
         select 1
         from public.documents doc
         where doc.id = version.document_id
           and btrim(doc.purpose) = btrim(request.purpose)
       )
       or app.actor_may_fulfil_request_upload(request.matter_id, request.person_id, request.purpose, request.document_id) is distinct from true then
      raise exception 'document upload denied' using errcode = '42501';
    end if;
  end if;
  if not exists (
    select 1
    from public.documents doc
    where doc.id = version.document_id
      and doc.person_id = request.person_id
      and doc.organization_id = request.organization_id
  ) then
    raise exception 'document upload denied' using errcode = '42501';
  end if;
  if request.document_id is not null and request.document_id is distinct from version.document_id then
    raise exception 'a replacement must be a new version of the same document' using errcode = '22023';
  end if;
  ext := lower(regexp_replace(version.original_filename, '^.*\.', ''));
  if ext = 'jpg' then
    ext := 'jpeg';
  elsif ext = 'heif' then
    ext := 'heic';
  end if;
  if not (ext = any (request.acceptable_formats)) then
    raise exception 'that format is not acceptable for this request' using errcode = '22023';
  end if;

  -- Classification: a document that already has other versions keeps its stricter audience and
  -- sensitivity unless the caller passes the set_document_classification checks.
  select * into target from public.documents where id = version.document_id for update;
  new_audience := request.audience;
  new_sensitivity := request.sensitivity;
  if exists (
    select 1
    from public.document_versions other
    where other.document_id = version.document_id
      and other.id <> version.id
  ) then
    may_classify := coalesce(
      (select auth.uid()) is not null
      and app.in_active_org(request.organization_id)
      and app.staff_mfa_satisfied()
      and app.mfa_step_up_satisfied()
      and app.has_org_role(
        request.organization_id,
        array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[]
      )
      and app.can_read_document(target.id),
      false
    );
    if not may_classify then
      if (case target.audience when 'matter' then 0 when 'subject' then 1 else 2 end)
         > (case request.audience when 'matter' then 0 when 'subject' then 1 else 2 end) then
        new_audience := target.audience;
      end if;
      if target.sensitivity is distinct from 'ordinary' then
        new_sensitivity := target.sensitivity;
      end if;
    end if;
  end if;

  perform app.open_document_write(version.id);
  update public.document_versions
  set request_id = request.id
  where id = version.id;
  perform app.close_document_write(version.id);

  perform app.open_document_write(request.id);
  update public.document_requests
  set document_id = version.document_id,
      audience = request.audience,
      sensitivity = request.sensitivity
  where id = request.id;
  perform app.close_document_write(request.id);

  perform app.open_document_write(version.document_id);
  update public.documents
  set audience = new_audience,
      sensitivity = new_sensitivity,
      purpose = request.purpose
  where id = version.document_id;
  perform app.close_document_write(version.document_id);
end;
$$;
revoke all on function app.attach_upload_to_request(uuid, uuid) from public;
grant execute on function app.attach_upload_to_request(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- DOC-6 Staff signer needs staff MFA
-- ---------------------------------------------------------------------------

-- From 20261030223000_client_two_step_esign_booking_documents.sql.
create or replace function app.can_read_agreement(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.agreements agreement
    where agreement.id = p_id
      and agreement.organization_id = (select app.current_organization_id())
      and (
        (
          (select app.staff_mfa_satisfied())
          and (select app.has_org_role(
            agreement.organization_id,
            array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[]
          ))
          and (select app.can_read_matter(agreement.matter_id))
        )
        or (select app.can_read_matter_billing(agreement.matter_id))
        or (
          agreement.kind = 'quote'
          and exists (
            select 1
            from public.matter_participants party
            join public.persons person
              on person.id = party.person_id
             and person.organization_id = party.organization_id
            where party.matter_id = agreement.matter_id
              and party.organization_id = agreement.organization_id
              and person.user_id = (select auth.uid())
          )
          and (select app.session_assurance_ok())
        )
        or exists (
          select 1
          from public.signature_envelopes envelope
          join public.envelope_signers signer
            on signer.envelope_id = envelope.id
           and signer.organization_id = envelope.organization_id
          left join public.persons person
            on person.id = signer.person_id
           and person.organization_id = signer.organization_id
          left join public.memberships mem
            on mem.id = signer.membership_id
           and mem.organization_id = signer.organization_id
          where envelope.agreement_id = agreement.id
            and (
              (
                person.user_id = (select auth.uid())
                and (select app.session_assurance_ok())
              )
              or (
                mem.user_id = (select auth.uid())
                and mem.status = 'active'
                and (select app.staff_mfa_satisfied())
              )
            )
        )
      )
  );
$$;

-- ---------------------------------------------------------------------------
-- DOC-4 Sealed agreement documents follow app.can_read_agreement for clients
-- ---------------------------------------------------------------------------

-- True unless the document holds a sealed agreement or certificate version of an envelope whose
-- agreement the caller cannot read.
create or replace function app.sealed_document_agreement_readable(p_document_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1
    from public.document_versions version
    join public.signature_envelopes envelope
      on envelope.organization_id = version.organization_id
     and envelope.sealed_document_version_id = version.id
    where version.document_id = p_document_id
      and version.scan_result = 'in_house_seal'
      and app.can_read_agreement(envelope.agreement_id) is distinct from true
  )
  and not exists (
    select 1
    from public.document_versions version
    join public.signature_envelopes envelope
      on envelope.organization_id = version.organization_id
     and envelope.certificate_document_version_id = version.id
    where version.document_id = p_document_id
      and version.scan_result = 'in_house_seal'
      and app.can_read_agreement(envelope.agreement_id) is distinct from true
  );
$$;
revoke all on function app.sealed_document_agreement_readable(uuid) from public, anon;
grant execute on function app.sealed_document_agreement_readable(uuid) to authenticated, service_role;

-- From 20261030223000_client_two_step_esign_booking_documents.sql.
create or replace function app.can_read_document(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.documents doc
    where doc.id = p_id
      and doc.organization_id = (select app.current_organization_id())
      and (
        (
          (select app.staff_mfa_satisfied())
          and (select app.has_org_role(
            doc.organization_id,
            array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[]
          ))
          and (
            (select app.actor_is_firm_owner(doc.organization_id))
            or exists (
              select 1
              from public.document_matter_refs ref
              where ref.document_id = doc.id
                and ref.removed_at is null
                and (select app.can_read_matter(ref.matter_id))
            )
            or (
              doc.created_by = (select auth.uid())
              and not exists (
                select 1
                from public.document_matter_refs ref
                where ref.document_id = doc.id
                  and ref.removed_at is null
              )
            )
          )
        )
        or (
          (
            (
              doc.audience <> 'staff'
              and exists (
                select 1
                from public.persons person
                where person.id = doc.person_id
                  and person.organization_id = doc.organization_id
                  and person.user_id = (select auth.uid())
              )
              and (select app.session_assurance_ok())
            )
            or (
              doc.audience = 'matter'
              and doc.sensitivity = 'ordinary'
              and exists (
                select 1
                from public.document_matter_refs ref
                join public.matter_participants party
                  on party.matter_id = ref.matter_id
                 and party.organization_id = ref.organization_id
                join public.persons person
                  on person.id = party.person_id
                 and person.organization_id = party.organization_id
                where ref.document_id = doc.id
                  and ref.removed_at is null
                  and person.user_id = (select auth.uid())
              )
              and (select app.session_assurance_ok())
            )
            or (
              doc.sensitivity = 'ordinary'
              and doc.audience <> 'staff'
              and exists (
                select 1
                from public.document_matter_refs ref
                where ref.document_id = doc.id
                  and ref.removed_at is null
                  and (select app.grant_allows(doc.person_id, doc.organization_id, ref.matter_id))
              )
            )
          )
          -- Sealed agreement and certificate documents: also app.can_read_agreement.
          and (select app.sealed_document_agreement_readable(doc.id))
        )
      )
  );
$$;

-- ---------------------------------------------------------------------------
-- DOC-3 Privacy scope search: other people's and staff-only documents start withheld
-- ---------------------------------------------------------------------------

-- From 20261025280000_sec_privacy_responses.sql (its only definition).
create or replace function app.privacy_scope_search(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req public.privacy_requests%rowtype;
  v_person public.persons%rowtype;
  v_org uuid;
  v_added integer;
  v_counts jsonb;
  v_total integer;
begin
  select * into v_req from public.privacy_requests where id = p_request_id;
  if v_req.id is null or app.can_work_privacy_request(v_req.organization_id, v_req.assignee_membership_id) is distinct from true then
    raise exception 'privacy request access denied' using errcode = '42501';
  end if;
  select * into v_req from public.privacy_requests where id = v_req.id for update;
  v_org := v_req.organization_id;
  if v_req.closed_at is not null then
    raise exception 'this request is closed' using errcode = '22023';
  end if;
  if v_req.kind not in ('access', 'correction') then
    raise exception 'only an access or correction request has a scope search' using errcode = '22023';
  end if;
  if v_req.identity_verified_at is null then
    raise exception 'verify identity first' using errcode = '22023';
  end if;
  if v_req.redaction_at is not null then
    raise exception 'the redaction worklist is closed' using errcode = '22023';
  end if;
  if v_req.person_id is null then
    raise exception 'link the request to a client record first' using errcode = '22023';
  end if;
  select * into v_person from public.persons where id = v_req.person_id and organization_id = v_org;

  insert into public.privacy_request_items (organization_id, request_id, source, source_id, matter_id, label, fields, decision, third_party, reason)
  select v_org, v_req.id, found.source, found.source_id, found.matter_id, left(found.label, 300), found.fields,
         case when held.reason is null then 'include' else 'withhold' end,
         held.third_party,
         held.reason
  from (
    select 'person'::text as source, v_person.id as source_id, null::uuid as matter_id,
           'Client record: ' || coalesce(nullif(btrim(v_person.display_name), ''), 'unnamed') as label,
           app.privacy_item_fields(to_jsonb(v_person)) as fields
    union all
    select 'matter', matter.id, matter.id, 'Matter ' || coalesce(matter.reference, matter.title), app.privacy_item_fields(to_jsonb(matter))
    from public.matters matter
    where matter.organization_id = v_org
      and exists (select 1 from public.matter_participants mp where mp.matter_id = matter.id and mp.organization_id = v_org and mp.person_id = v_person.id)
    union all
    select 'document', doc.id,
           (select ref.matter_id from public.document_matter_refs ref
             where ref.document_id = doc.id and ref.organization_id = v_org and ref.removed_at is null order by ref.created_at limit 1),
           'Document: ' || coalesce(doc.purpose::text, 'file') || coalesce(' (' || (
             select version.original_filename from public.document_versions version where version.id = doc.current_version_id
           ) || ')', ''),
           app.privacy_item_fields(to_jsonb(doc))
    from public.documents doc
    where doc.organization_id = v_org
      and (
        doc.person_id = v_person.id
        or exists (
          select 1 from public.document_matter_refs ref
          join public.matter_participants mp on mp.matter_id = ref.matter_id and mp.organization_id = ref.organization_id
          where ref.document_id = doc.id and ref.organization_id = v_org and ref.removed_at is null and mp.person_id = v_person.id
        )
      )
    union all
    select 'message_thread', thread.id, thread.matter_id,
           'Messages on ' || coalesce((select coalesce(matter.reference, matter.title) from public.matters matter where matter.id = thread.matter_id), 'a matter'),
           array['author_name', 'body']::text[]
    from public.message_threads thread
    where thread.organization_id = v_org
      and (
        exists (select 1 from public.message_thread_people tp where tp.thread_id = thread.id and tp.organization_id = v_org and tp.person_id = v_person.id)
        or exists (select 1 from public.matter_messages msg where msg.thread_id = thread.id and msg.organization_id = v_org and msg.author_person_id = v_person.id)
      )
    union all
    select 'intake_response', response.id, response.matter_id, 'Intake form, ' || coalesce(response.status::text, 'draft'),
           coalesce((select array_agg(distinct answer.field_key order by answer.field_key) from public.intake_answer_versions answer
                      where answer.response_id = response.id and answer.organization_id = v_org), '{}')
    from public.intake_responses response
    where response.organization_id = v_org and response.person_id = v_person.id
    union all
    select 'invoice', invoice.id, invoice.matter_id, 'Invoice ' || coalesce(invoice.number::text, 'draft'), app.privacy_item_fields(to_jsonb(invoice))
    from public.invoices invoice
    where invoice.organization_id = v_org
      and exists (select 1 from public.matter_participants mp where mp.matter_id = invoice.matter_id and mp.organization_id = v_org and mp.person_id = v_person.id)
    union all
    select 'consent', consent.id, consent.matter_id, 'Consent: ' || consent.purpose::text, app.privacy_item_fields(to_jsonb(consent))
    from public.consent_records consent
    where consent.organization_id = v_org and consent.person_id = v_person.id
    union all
    select 'booking', booking.id, booking.matter_id, 'Consultation: ' || coalesce(nullif(btrim(booking.title), ''), 'booking'), app.privacy_item_fields(to_jsonb(booking))
    from public.bookings booking
    where booking.organization_id = v_org and booking.person_id = v_person.id
    union all
    select 'lead', lead.id, lead.converted_matter_id, 'Enquiry: ' || coalesce(nullif(btrim(lead.display_name), ''), 'unnamed'), app.privacy_item_fields(to_jsonb(lead))
    from public.leads lead
    where lead.organization_id = v_org and lead.converted_person_id = v_person.id
    union all
    select 'audit', v_person.id, null::uuid, 'Activity log of their record', array['action', 'actor_type', 'object_table', 'occurred_at']::text[]
  ) found
  -- Documents: a staff-only document, or one that is another person's and not matter-visible and
  -- ordinary, starts withheld until a reviewer decides.
  left join lateral (
    select
      case
        when doc.person_id = v_person.id then 'Firm internal record'
        else left(coalesce(nullif(btrim(owner.display_name), ''), 'Another person'), 200)
      end as third_party,
      case
        when doc.audience = 'staff' then 'Internal firm record'
        else 'Information about another person'
      end as reason
    from public.documents doc
    left join public.persons owner
      on owner.id = doc.person_id
     and owner.organization_id = doc.organization_id
    where found.source = 'document'
      and doc.id = found.source_id
      and doc.organization_id = v_org
      and (
        doc.audience = 'staff'
        or (
          doc.person_id is distinct from v_person.id
          and not (doc.audience = 'matter' and doc.sensitivity = 'ordinary')
        )
      )
  ) held on true
  limit 1000
  on conflict (request_id, source, source_id) do nothing;
  get diagnostics v_added = row_count;

  -- Documents: each one listed as withheld and not yet decided has an open worklist line, so the
  -- redaction step closes only after a reviewer decides it.
  insert into public.privacy_request_redactions (organization_id, request_id, record_label, third_party, removed, item_id)
  select v_org, v_req.id, left(item.label, 200), item.third_party, 'Whole record withheld', item.id
  from public.privacy_request_items item
  where item.request_id = v_req.id
    and item.organization_id = v_org
    and item.source = 'document'
    and item.decision = 'withhold'
    and item.decided_at is null
    and not exists (select 1 from public.privacy_request_redactions line where line.item_id = item.id);

  select coalesce(jsonb_object_agg(item.source, item.n), '{}'::jsonb), coalesce(sum(item.n), 0)::integer
  into v_counts, v_total
  from (
    select source, count(*)::integer as n
    from public.privacy_request_items
    where request_id = v_req.id
    group by source
  ) item;

  if v_req.scope_at is null then
    update public.privacy_requests
    set scope_at = clock_timestamp(), scope_by = (select auth.uid()),
        scope_note = left(format('Searched this firm''s records in Casevoya: %s found.', v_total), 2000)
    where id = v_req.id;
  end if;
  perform app.record_audit_event(
    v_org, 'privacy.scope_searched', 'public.privacy_requests', v_req.id, 'success',
    jsonb_build_object('added', v_added, 'counts', v_counts)
  );
  return jsonb_build_object('added', v_added, 'total', v_total, 'counts', v_counts);
end;
$$;
