-- Security review: governance table writes, and co-applicant uploads bound to their request.
--
-- A. Source governance tables (20261017113157_source_governance.sql granted authenticated INSERT /
--    UPDATE, with write policies that only required app.can_insert_practice_row: any owner,
--    licensed consultant or case manager, no licence check and no step-up). Firm rows of these
--    tables are written by SECURITY DEFINER functions (add_rule_claim, review_rule_version,
--    suspend/unsuspend_rule_version, select_matter_program, decide_matter_rule_upgrade,
--    publish_reviewed_program_pack, record_source_conflict, the re-check and capture services, and
--    their triggers), which check the licence and step-up themselves and run as the table owner.
--    No app code writes them directly. Now:
--    * source_snapshots, source_dependencies, rule_evidence, professional_reviews, rule_impacts:
--      INSERT and UPDATE are revoked from authenticated (no platform-admin path exists on them).
--      The firm write policies are set to false in case of a future re-grant.
--    * official_sources, rule_definitions, rule_versions, rule_pack_versions, rule_pack_items:
--      the firm write policies (*_insert / *_update) are set to false. Grants stay only for the
--      global-catalogue policies (*_platform_*, organization_id null, platform owner/operator at
--      aal2; 20261030130000). A firm row can no longer be written through the API.
--    * matter_rule_bindings: UPDATE is revoked (superseding a pin and the recheck flag are written
--      only by definer functions). INSERT stays for public.create_engaged_matter (security invoker,
--      called by create_client_matter, create_client_matter_for_program and the import), but only
--      the first pin of a matter the caller is creating in this same transaction, and only to the
--      pack already validated on that matter (matters.program_pack_id). Re-pinning goes through
--      app.select_matter_program / app.decide_matter_rule_upgrade.
--    service_role grants are unchanged. source_snapshots.server_captured (20261030170000) is still
--    set by its trigger; service-role inserts are unaffected.
--
-- B. app.create_upload_intent (latest 20261030180000_upload_intent_existing_document_scope.sql):
--    on the co-applicant path (the caller is not the person, not staff, not the email ingest), the
--    upload must answer an open request for that person on that matter which the caller can fulfil
--    (the same conditions as app.actor_may_fulfil_request_for), with the request's purpose, and for
--    the request's document (none yet, or the document the request already holds). New helper
--    app.actor_may_fulfil_request_upload. The rest of the body, the signature and the grants are
--    unchanged; the change is marked "Request".

-- ---------------------------------------------------------------------------
-- A. Governance tables
-- ---------------------------------------------------------------------------

revoke insert, update on table public.source_snapshots from anon, authenticated;
revoke insert, update on table public.source_dependencies from anon, authenticated;
revoke insert, update on table public.rule_evidence from anon, authenticated;
revoke insert, update on table public.professional_reviews from anon, authenticated;
revoke insert, update on table public.rule_impacts from anon, authenticated;
revoke update on table public.matter_rule_bindings from anon, authenticated;

alter policy source_snapshots_insert on public.source_snapshots with check (false);
alter policy source_snapshots_update on public.source_snapshots using (false) with check (false);
alter policy source_dependencies_insert on public.source_dependencies with check (false);
alter policy source_dependencies_update on public.source_dependencies using (false) with check (false);
alter policy rule_evidence_insert on public.rule_evidence with check (false);
alter policy rule_evidence_update on public.rule_evidence using (false) with check (false);
alter policy professional_reviews_insert on public.professional_reviews with check (false);
alter policy professional_reviews_update on public.professional_reviews using (false) with check (false);
alter policy rule_impacts_insert on public.rule_impacts with check (false);
alter policy rule_impacts_update on public.rule_impacts using (false) with check (false);

-- Firm rows: definer functions only. The *_platform_* policies (global catalogue) are unchanged.
alter policy official_sources_insert on public.official_sources with check (false);
alter policy official_sources_update on public.official_sources using (false) with check (false);
alter policy rule_definitions_insert on public.rule_definitions with check (false);
alter policy rule_definitions_update on public.rule_definitions using (false) with check (false);
alter policy rule_versions_insert on public.rule_versions with check (false);
alter policy rule_versions_update on public.rule_versions using (false) with check (false);
alter policy rule_pack_versions_insert on public.rule_pack_versions with check (false);
alter policy rule_pack_versions_update on public.rule_pack_versions using (false) with check (false);
alter policy rule_pack_items_insert on public.rule_pack_items with check (false);

-- The first pin of a matter the caller is creating in this transaction, to the pack validated on
-- the matter row (app.validate_new_matter). matters.created_at / created_by never move (app.touch_row).
create or replace function app.can_pin_new_matter_rule_pack(p_matter_id uuid, p_org uuid, p_pack uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    p_pack is not null
    and exists (
      select 1
      from public.matters matter
      where matter.id = p_matter_id
        and matter.organization_id = p_org
        and matter.created_by = (select auth.uid())
        and matter.created_at = now()
        and matter.program_pack_id = p_pack
    )
    and not exists (
      select 1
      from public.matter_rule_bindings binding
      where binding.matter_id = p_matter_id
    ),
    false
  );
$$;
comment on function app.can_pin_new_matter_rule_pack(uuid, uuid, uuid) is
  'Direct matter_rule_bindings insert: only the first pin of a matter the caller creates in this transaction, to that matter''s validated program pack. Later pins go through select_matter_program or decide_matter_rule_upgrade.';
revoke all on function app.can_pin_new_matter_rule_pack(uuid, uuid, uuid) from public, anon;
grant execute on function app.can_pin_new_matter_rule_pack(uuid, uuid, uuid) to authenticated, service_role;

alter policy matter_rule_bindings_insert on public.matter_rule_bindings
  with check (
    (select app.can_insert_practice_row(organization_id))
    and (select app.can_pin_new_matter_rule_pack(matter_id, organization_id, rule_pack_version_id))
  );
alter policy matter_rule_bindings_update on public.matter_rule_bindings using (false) with check (false);

-- ---------------------------------------------------------------------------
-- B. Co-applicant uploads bound to the request
-- ---------------------------------------------------------------------------

-- app.actor_may_fulfil_request_for (20261029100000) narrowed to one request: same purpose, and the
-- request's document (null for a first upload, or the document the request already holds).
create or replace function app.actor_may_fulfil_request_upload(
  p_matter_id uuid,
  p_person_id uuid,
  p_purpose text,
  p_document_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.document_requests request
    join public.matter_participants party
      on party.matter_id = request.matter_id
     and party.organization_id = request.organization_id
    join public.persons me
      on me.id = party.person_id
     and me.organization_id = party.organization_id
    where request.matter_id = p_matter_id
      and request.person_id = p_person_id
      and request.organization_id = (select app.current_organization_id())
      and request.status = 'open'
      and request.audience = 'matter'
      and request.sensitivity = 'ordinary'
      and btrim(request.purpose) = btrim(coalesce(p_purpose, ''))
      and request.document_id is not distinct from p_document_id
      and me.user_id = (select auth.uid())
      and (select app.can_read_matter(request.matter_id))
  );
$$;
comment on function app.actor_may_fulfil_request_upload(uuid, uuid, text, uuid) is
  'Co-applicant upload: the caller is on the matter and can see an open matter-visible, ordinary request for this person with this purpose and this document (or none yet).';
revoke all on function app.actor_may_fulfil_request_upload(uuid, uuid, text, uuid) from public, anon;
grant execute on function app.actor_may_fulfil_request_upload(uuid, uuid, text, uuid) to authenticated, service_role;

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
revoke all on function app.create_upload_intent(uuid, uuid, text, bigint, text, public.document_sensitivity, public.document_audience, uuid, uuid, text) from public;
grant execute on function app.create_upload_intent(uuid, uuid, text, bigint, text, public.document_sensitivity, public.document_audience, uuid, uuid, text) to authenticated, service_role;
