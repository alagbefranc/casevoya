-- #272 item 1 (launch must-fix): a sponsor on the client portal can see the name of, and upload
-- for, another adult on their own matter (a co-applicant without a portal login) when the firm
-- asked that person for a document the sponsor can already see.
--
-- Before: the portal showed the sponsor an open request for the co-applicant (document_requests_select
-- lets every person on the matter read audience 'matter' + sensitivity 'ordinary' requests), but
--   * persons RLS (app.can_read_person) hides the co-applicant's row, so the request said
--     "P / Person" instead of their name and initials, and
--   * app.actor_can_upload_for allowed only the subject themselves or staff, so create_upload_intent
--     raised "document upload denied" and the portal said "The upload couldn't start".
--
-- Now (persons RLS unchanged, still forced):
--   app.actor_may_fulfil_request_for(matter, person)   new. True when the signed-in person is on the
--       matter and can read it, and an OPEN request for that person on that matter is one they can
--       see through the matter path (audience 'matter', sensitivity 'ordinary'), the exact branch of
--       document_requests_select. Nothing else: not 'subject', 'staff' or sensitive requests, not
--       people without such a request, not another firm.
--   app.actor_can_upload_for(matter, person)   redefined (latest 20261017200200_inbound_email.sql):
--       the subject and staff checks return true as before; otherwise it now falls back to
--       app.actor_may_fulfil_request_for. Its callers (create_upload_intent, attach_upload_to_request)
--       are unchanged apart from the next item.
--   app.create_upload_intent(...)   redefined (latest 20261017180000_document_storage.sql): when the
--       caller is neither the person nor staff (they upload only because of a co-applicant's request),
--       the file must be 'matter' + 'ordinary' (what attach_upload_to_request sets from the request
--       anyway), not a translation, and may only add a version to a document the caller can already
--       read. So a co-applicant upload never creates a private or sensitive document for someone else.
--   public.portal_request_person_names()   new, SECURITY DEFINER read: id and display name only, of
--       the people whose requests the caller can see through that same matter path (any status but
--       cancelled, so a fulfilled request keeps its name). No email, phone, birth date or other field.
--
-- finish_verified_document_upload, the virus-scan path (#271) and the storage policies are unchanged:
-- the version's creator finishes it, and the scan hold applies as to any other upload.

create function app.actor_may_fulfil_request_for(p_matter_id uuid, p_person_id uuid)
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
      and me.user_id = (select auth.uid())
      and (select app.can_read_matter(request.matter_id))
  );
$$;
revoke all on function app.actor_may_fulfil_request_for(uuid, uuid) from public, anon;
grant execute on function app.actor_may_fulfil_request_for(uuid, uuid) to authenticated, service_role;

-- From 20261017200200_inbound_email.sql. Only the end changes: staff as before, then the
-- co-applicant request path.
create or replace function app.actor_can_upload_for(p_matter_id uuid, p_person_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  matter public.matters%rowtype;
  ingest_org uuid;
begin
  select * into matter from public.matters where id = p_matter_id;
  ingest_org := app.email_ingest_org();
  if matter.id is null
     or matter.organization_id is distinct from coalesce((select app.current_organization_id()), ingest_org) then
    return false;
  end if;
  if app.sample_mode_blocks_real(matter.organization_id, matter.is_sample) then
    return false;
  end if;
  if not exists (
    select 1
    from public.persons person
    join public.matter_participants party
      on party.person_id = person.id
     and party.matter_id = matter.id
     and party.organization_id = matter.organization_id
    where person.id = p_person_id
      and person.organization_id = matter.organization_id
      and person.is_sample is not distinct from matter.is_sample
  ) then
    return false;
  end if;
  if ingest_org is not null and matter.organization_id = ingest_org then
    return true;
  end if;
  if exists (
    select 1
    from public.persons person
    where person.id = p_person_id
      and person.user_id = (select auth.uid())
  ) then
    return true;
  end if;
  if app.staff_mfa_satisfied()
     and app.mfa_step_up_satisfied()
     and app.has_org_role(
       matter.organization_id,
       array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[]
     )
     and app.can_read_matter(matter.id) then
    return true;
  end if;
  -- #272: someone else on the matter fulfilling a request for this person that they can see.
  return app.actor_may_fulfil_request_for(matter.id, p_person_id);
end;
$$;
revoke all on function app.actor_can_upload_for(uuid, uuid) from public;

-- From 20261017180000_document_storage.sql. Only the #272 block after the permission check is new.
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
    if not exists (
      select 1
      from public.documents doc
      where doc.id = p_document_id
        and doc.organization_id = matter.organization_id
        and doc.person_id = p_person_id
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

-- The names the portal shows on requests the caller can see for someone else on their matter
-- (the matter branch of document_requests_select). Name only: the portal's avatar and "For Elias".
create function public.portal_request_person_names()
returns table (person_id uuid, display_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct subject.id, subject.display_name
  from public.document_requests request
  join public.persons subject
    on subject.id = request.person_id
   and subject.organization_id = request.organization_id
  join public.matter_participants party
    on party.matter_id = request.matter_id
   and party.organization_id = request.organization_id
  join public.persons me
    on me.id = party.person_id
   and me.organization_id = party.organization_id
  where request.organization_id = (select app.current_organization_id())
    and request.status <> 'cancelled'
    and request.audience = 'matter'
    and request.sensitivity = 'ordinary'
    and me.user_id = (select auth.uid())
    and (select auth.uid()) is not null
    and (select app.can_read_matter(request.matter_id));
$$;
revoke all on function public.portal_request_person_names() from public, anon;
grant execute on function public.portal_request_person_names() to authenticated, service_role;
