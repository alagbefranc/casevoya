-- app.create_upload_intent (latest 20261029100000_portal_co_applicant_uploads.sql): a new version of
-- an existing document (p_document_id given) now requires, for every caller,
--   * that the document is already linked to p_matter_id (document_matter_refs, not removed), so a
--     new version stays within its matter and never adds a matter link; and
--   * app.can_read_document(p_document_id), except on the email-ingest org path (unchanged; its
--     callers never pass a document id).
-- Before, the person and staff paths only checked the organization and person. Signature, grants and
-- the rest of the body are unchanged.

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
       or (p_document_id is not null and app.can_read_document(p_document_id) is distinct from true) then
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
