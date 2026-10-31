-- Redacted copies are made only through the server path (#300, #301). Additive only; each
-- function is copied from its latest definition (named above it) and only the marked parts change.
--
-- 1. document_versions.transformation of kind 'redaction' can't be set, changed or cleared by an
--    update (trigger), a document holding a redaction version takes no other kind of version
--    (insert trigger), and app.record_camera_assembly refuses an upload that already has a
--    transformation.
-- 2. public.begin_redacted_copy runs every check of the signed-in staff member (staff MFA, step-up,
--    role, can read the source, may add to the matter, source checked and on the matter) before
--    the server reads the source, and records a short-lived, single-use ticket for that member.
-- 3. public.service_create_redacted_copy_intent (server only) takes the ticket and the member
--    (p_actor_user_id), re-checks the membership and the source, and opens the copy as that member.
--    public.create_redacted_copy_intent is no longer executable by authenticated.
-- 4. public.finish_verified_document_upload refuses a redaction version; only
--    public.service_finish_redacted_copy (server only) finishes one, and only one.

-- ---------------------------------------------------------------------------
-- 1. Redaction transformation is fixed at creation
-- ---------------------------------------------------------------------------

create or replace function app.guard_redaction_transformation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(old.transformation ->> 'kind', '') = 'redaction'
     and new.transformation is distinct from old.transformation then
    raise exception 'a redacted copy keeps its redaction record' using errcode = '42501';
  end if;
  if coalesce(new.transformation ->> 'kind', '') = 'redaction'
     and coalesce(old.transformation ->> 'kind', '') is distinct from 'redaction' then
    raise exception 'a redacted copy keeps its redaction record' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.guard_redaction_transformation() from public, anon, authenticated, service_role;

do $trigger$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'document_versions_redaction_fixed'
      and tgrelid = 'public.document_versions'::regclass
  ) then
    create trigger document_versions_redaction_fixed
      before update of transformation on public.document_versions
      for each row execute function app.guard_redaction_transformation();
  end if;
end
$trigger$;

-- A document that holds a redacted copy takes no other kind of version.
create or replace function app.guard_redacted_document_versions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(new.transformation ->> 'kind', '') <> 'redaction'
     and exists (
       select 1
       from public.document_versions earlier
       where earlier.document_id = new.document_id
         and coalesce(earlier.transformation ->> 'kind', '') = 'redaction'
     ) then
    raise exception 'a redacted copy takes no new version' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.guard_redacted_document_versions() from public, anon, authenticated, service_role;

do $trigger$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'document_versions_redacted_document_only'
      and tgrelid = 'public.document_versions'::regclass
  ) then
    create trigger document_versions_redacted_document_only
      before insert on public.document_versions
      for each row execute function app.guard_redacted_document_versions();
  end if;
end
$trigger$;

-- From 20261029140000_document_capture_redaction.sql. Marked "Transformation".
create or replace function app.record_camera_assembly(p_version_id uuid, p_pages jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  version public.document_versions%rowtype;
  page jsonb;
  count integer;
begin
  select * into version from public.document_versions where id = p_version_id for update;
  if version.id is null
     or version.created_by is distinct from (select auth.uid())
     or (select app.is_org_member(version.organization_id)) is distinct from true
     -- Transformation: only an upload with no transformation yet takes a page order.
     or version.transformation is not null then
    raise exception 'document assembly denied' using errcode = '42501';
  end if;
  if version.upload_state is distinct from 'uploading' or version.intent_expires_at <= statement_timestamp() then
    raise exception 'that upload is already finished' using errcode = '22023';
  end if;
  if jsonb_typeof(p_pages) is distinct from 'array' then
    raise exception 'add between 1 and 40 pages' using errcode = '22023';
  end if;
  count := jsonb_array_length(p_pages);
  if count < 1 or count > 40 then
    raise exception 'add between 1 and 40 pages' using errcode = '22023';
  end if;
  for page in select value from jsonb_array_elements(p_pages) loop
    if coalesce(page ->> 'rotation_degrees', '') not in ('0', '90', '180', '270')
       or coalesce(page ->> 'source', '') not in ('camera', 'library') then
      raise exception 'choose how each page is turned' using errcode = '22023';
    end if;
  end loop;

  perform app.open_document_write(version.id);
  update public.document_versions
  set transformation = jsonb_build_object('kind', 'camera_assembly', 'page_count', count, 'pages', p_pages)
  where id = version.id;
  perform app.close_document_write(version.id);

  perform app.record_audit_event(
    version.organization_id,
    'document.camera_assembled',
    'document_versions',
    version.id,
    'success',
    jsonb_build_object('page_count', count, 'pages', p_pages)
  );
  return jsonb_build_object('version_id', version.id, 'page_count', count);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Signed-in checks first, then a single-use ticket
-- ---------------------------------------------------------------------------

create table if not exists app.document_redaction_tickets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  user_id uuid not null references auth.users (id),
  source_version_id uuid not null,
  matter_id uuid not null,
  created_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null,
  used_at timestamptz
);
comment on table app.document_redaction_tickets is
  'One row per public.begin_redacted_copy call: the staff member passed the redaction checks for this source and matter. Used once by public.service_create_redacted_copy_intent before expires_at.';
create index if not exists document_redaction_tickets_org_fk_idx on app.document_redaction_tickets (organization_id);
create index if not exists document_redaction_tickets_user_idx on app.document_redaction_tickets (user_id, created_at);

-- Definer functions only. No API role reads or writes this table.
revoke all on table app.document_redaction_tickets from public, anon, authenticated, service_role;

create or replace function app.begin_redacted_copy(p_source_version_id uuid, p_matter_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  source public.document_versions%rowtype;
  doc public.documents%rowtype;
  matter public.matters%rowtype;
  ticket_id uuid;
begin
  if actor is null or (select app.staff_mfa_satisfied()) is distinct from true then
    raise exception 'aal2 required' using errcode = '42501';
  end if;
  if (select app.mfa_step_up_satisfied()) is distinct from true then
    raise exception 'step-up is required' using errcode = '42501';
  end if;
  select * into source from public.document_versions where id = p_source_version_id;
  select * into doc from public.documents where id = source.document_id;
  select * into matter from public.matters where id = p_matter_id;
  if source.id is null
     or doc.id is null
     or matter.id is null
     or source.organization_id is distinct from matter.organization_id
     or doc.organization_id is distinct from matter.organization_id
     or (select app.has_org_role(
       matter.organization_id,
       array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[]
     )) is distinct from true
     or (select app.can_read_document_version(source.id)) is distinct from true then
    raise exception 'document redaction denied' using errcode = '42501';
  end if;
  if (select app.actor_can_upload_for(matter.id, doc.person_id)) is distinct from true then
    raise exception 'document redaction denied' using errcode = '42501';
  end if;
  if source.upload_state is distinct from 'clean' then
    raise exception 'only a checked file can be redacted' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.document_matter_refs ref
    where ref.document_id = doc.id
      and ref.matter_id = matter.id
      and ref.removed_at is null
  ) then
    raise exception 'that document is not on this matter' using errcode = '22023';
  end if;
  -- At most 20 redaction starts a minute per member.
  if (
    select count(*) from app.document_redaction_tickets t
    where t.user_id = actor and t.created_at > statement_timestamp() - interval '1 minute'
  ) >= 20 then
    raise exception 'too many redaction requests' using errcode = '54000';
  end if;

  delete from app.document_redaction_tickets
  where user_id = actor
    and expires_at < statement_timestamp() - interval '1 day';

  insert into app.document_redaction_tickets (organization_id, user_id, source_version_id, matter_id, expires_at)
  values (matter.organization_id, actor, source.id, matter.id, statement_timestamp() + interval '10 minutes')
  returning id into ticket_id;

  return jsonb_build_object(
    'ticket_id', ticket_id,
    'storage_key', source.storage_key,
    'media_type', coalesce(source.detected_media_type, source.declared_media_type),
    'byte_size', source.byte_size
  );
end;
$$;
revoke all on function app.begin_redacted_copy(uuid, uuid) from public, anon;
grant execute on function app.begin_redacted_copy(uuid, uuid) to authenticated;

create or replace function public.begin_redacted_copy(p_source_version_id uuid, p_matter_id uuid)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app.begin_redacted_copy(p_source_version_id, p_matter_id);
$$;
revoke all on function public.begin_redacted_copy(uuid, uuid) from public, anon, service_role;
grant execute on function public.begin_redacted_copy(uuid, uuid) to authenticated;
comment on function public.begin_redacted_copy(uuid, uuid) is
  'DOC-07: the signed-in staff member (staff MFA, fresh step-up) may redact this checked source on this matter. Returns a single-use ticket for public.service_create_redacted_copy_intent. Writes nothing else.';

-- ---------------------------------------------------------------------------
-- 3. The copy is opened by the server for the ticket's member
-- ---------------------------------------------------------------------------

revoke execute on function public.create_redacted_copy_intent(uuid, uuid, text, bigint, jsonb) from authenticated;
revoke execute on function app.create_redacted_copy_intent(uuid, uuid, text, bigint, jsonb) from authenticated;

-- From app.create_redacted_copy_intent (20261029140000_document_capture_redaction.sql). Changed:
-- the session checks are replaced by the ticket and a membership re-check ("Ticket"), and the
-- actor is p_actor_user_id instead of auth.uid() ("Actor").
create or replace function public.service_create_redacted_copy_intent(
  p_ticket_id uuid,
  p_actor_user_id uuid,
  p_filename text,
  p_declared_byte_size bigint,
  p_regions jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ticket app.document_redaction_tickets%rowtype;
  source public.document_versions%rowtype;
  doc public.documents%rowtype;
  matter public.matters%rowtype;
  region jsonb;
  doc_id uuid;
  version_id uuid;
  media text;
  storage_key text;
  purpose text;
  limit_bytes bigint;
  region_count integer;
begin
  if app.request_is_server_capture() is distinct from true then
    raise exception 'only the server opens a redacted copy' using errcode = '42501';
  end if;
  -- Ticket
  select * into ticket from app.document_redaction_tickets where id = p_ticket_id for update;
  if ticket.id is null
     or p_actor_user_id is null
     or ticket.user_id is distinct from p_actor_user_id
     or ticket.used_at is not null
     or ticket.expires_at <= statement_timestamp() then
    raise exception 'document redaction denied' using errcode = '42501';
  end if;
  update app.document_redaction_tickets set used_at = statement_timestamp() where id = ticket.id;

  select * into source from public.document_versions where id = ticket.source_version_id;
  select * into doc from public.documents where id = source.document_id;
  select * into matter from public.matters where id = ticket.matter_id;
  if source.id is null
     or doc.id is null
     or matter.id is null
     or matter.organization_id is distinct from ticket.organization_id
     or source.organization_id is distinct from matter.organization_id
     or doc.organization_id is distinct from matter.organization_id
     or not exists (
       select 1
       from public.memberships membership
       where membership.organization_id = matter.organization_id
         and membership.user_id = p_actor_user_id
         and membership.status = 'active'
         and membership.role = any (
           array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[]
         )
     ) then
    raise exception 'document redaction denied' using errcode = '42501';
  end if;
  if source.upload_state is distinct from 'clean' then
    raise exception 'only a checked file can be redacted' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.document_matter_refs ref
    where ref.document_id = doc.id
      and ref.matter_id = matter.id
      and ref.removed_at is null
  ) then
    raise exception 'that document is not on this matter' using errcode = '22023';
  end if;
  media := app.media_type_for_filename(p_filename);
  if media is null or media not in ('application/pdf', 'image/jpeg', 'image/png') then
    raise exception 'use a PDF, JPEG, or PNG file name' using errcode = '22023';
  end if;
  limit_bytes := app.document_max_bytes(matter.organization_id);
  if p_declared_byte_size is null or p_declared_byte_size < 1 or p_declared_byte_size > limit_bytes then
    raise exception 'file is above the upload limit' using errcode = '22023';
  end if;
  if jsonb_typeof(p_regions) is distinct from 'array' then
    raise exception 'mark between 1 and 40 areas' using errcode = '22023';
  end if;
  region_count := jsonb_array_length(p_regions);
  if region_count < 1 or region_count > 40 then
    raise exception 'mark between 1 and 40 areas' using errcode = '22023';
  end if;
  for region in select value from jsonb_array_elements(p_regions) loop
    if jsonb_typeof(region -> 'page_index') is distinct from 'number'
       or jsonb_typeof(region -> 'x') is distinct from 'number'
       or jsonb_typeof(region -> 'y') is distinct from 'number'
       or jsonb_typeof(region -> 'width') is distinct from 'number'
       or jsonb_typeof(region -> 'height') is distinct from 'number'
       or (region ->> 'page_index')::integer < 0
       or (region ->> 'page_index')::integer > 2000
       or (region ->> 'x')::double precision < 0
       or (region ->> 'y')::double precision < 0
       or (region ->> 'x')::double precision > 1
       or (region ->> 'y')::double precision > 1
       or (region ->> 'width')::double precision <= 0
       or (region ->> 'height')::double precision <= 0
       or (region ->> 'x')::double precision + (region ->> 'width')::double precision > 1.000001
       or (region ->> 'y')::double precision + (region ->> 'height')::double precision > 1.000001 then
      raise exception 'mark an area on the page' using errcode = '22023';
    end if;
  end loop;

  purpose := 'Redacted copy of ' || btrim(doc.purpose);
  if length(purpose) > 200 then
    purpose := left(purpose, 200);
  end if;

  -- Actor
  insert into public.documents (
    organization_id, person_id, purpose, sensitivity, audience, created_by
  ) values (
    matter.organization_id, doc.person_id, purpose, doc.sensitivity, 'staff', p_actor_user_id
  )
  returning id into doc_id;

  version_id := gen_random_uuid();
  storage_key := matter.organization_id::text
    || '/quarantine/'
    || version_id::text
    || '/'
    || encode(extensions.gen_random_bytes(16), 'hex');

  insert into public.document_versions (
    id, organization_id, document_id, version_number, storage_key, original_filename,
    declared_media_type, declared_byte_size, parent_version_id, transformation,
    intent_expires_at, created_by
  ) values (
    version_id,
    matter.organization_id,
    doc_id,
    1,
    storage_key,
    btrim(p_filename),
    media,
    p_declared_byte_size,
    source.id,
    jsonb_build_object(
      'kind', 'redaction',
      'engine', 'content-stream',
      'source_version_id', source.id,
      'region_count', region_count
    ),
    statement_timestamp() + make_interval(secs => app.upload_intent_seconds()),
    p_actor_user_id
  );

  insert into public.document_matter_refs (organization_id, document_id, matter_id, created_by)
  values (matter.organization_id, doc_id, matter.id, p_actor_user_id);

  perform app.open_document_write(doc_id);
  update public.documents set current_version_id = version_id where id = doc_id;
  perform app.close_document_write(doc_id);

  for region in select value from jsonb_array_elements(p_regions) loop
    insert into public.document_redactions (
      organization_id, source_version_id, copy_version_id, page_index, x, y, width, height, created_by
    ) values (
      matter.organization_id,
      source.id,
      version_id,
      (region ->> 'page_index')::integer,
      (region ->> 'x')::double precision,
      (region ->> 'y')::double precision,
      (region ->> 'width')::double precision,
      (region ->> 'height')::double precision,
      p_actor_user_id
    );
    perform app.record_audit_event(
      matter.organization_id,
      'document.redacted',
      'document_redactions',
      version_id,
      'success',
      jsonb_build_object(
        'source_version_id', source.id,
        'copy_version_id', version_id,
        'page_index', (region ->> 'page_index')::integer,
        'x', (region ->> 'x')::double precision,
        'y', (region ->> 'y')::double precision,
        'width', (region ->> 'width')::double precision,
        'height', (region ->> 'height')::double precision,
        'actor_user_id', p_actor_user_id
      )
    );
  end loop;

  perform app.record_audit_event(
    matter.organization_id,
    'document.redaction_started',
    'document_versions',
    version_id,
    'success',
    jsonb_build_object(
      'source_version_id', source.id,
      'engine', 'content-stream',
      'region_count', region_count,
      'actor_user_id', p_actor_user_id
    )
  );

  return jsonb_build_object(
    'document_id', doc_id,
    'version_id', version_id,
    'storage_key', storage_key,
    'source_version_id', source.id,
    'declared_media_type', media
  );
end;
$$;
revoke all on function public.service_create_redacted_copy_intent(uuid, uuid, text, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.service_create_redacted_copy_intent(uuid, uuid, text, bigint, jsonb) to service_role;
comment on function public.service_create_redacted_copy_intent(uuid, uuid, text, bigint, jsonb) is
  'DOC-07, service role only: opens a redacted copy for the staff member of a public.begin_redacted_copy ticket. The server then stores the rewritten bytes and calls public.service_finish_redacted_copy.';

-- ---------------------------------------------------------------------------
-- 4. Upload completion: ordinary versions and redaction versions take separate paths
-- ---------------------------------------------------------------------------

-- From app.finish_verified_document_upload (20261018010500_verified_document_upload.sql), with
-- p_redaction: the version must be a redaction version exactly when p_redaction is true
-- (marked "Redaction"). Called only by the two definer wrappers below.
create or replace function app.finish_document_upload_checked(
  p_version_id uuid,
  p_actor_user_id uuid,
  p_sha256 text,
  p_byte_size bigint,
  p_detected_media_type text,
  p_redaction boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  version public.document_versions%rowtype;
  stored_size bigint;
  detected text;
  next_state public.document_upload_state;
  next_engine text;
  next_result text;
  next_reason text;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') is distinct from 'service_role' then
    raise exception 'worker role required' using errcode = '42501';
  end if;
  select * into version from public.document_versions where id = p_version_id for update;
  if version.id is null
     or p_actor_user_id is null
     or version.created_by is distinct from p_actor_user_id
     or not exists (
       select 1
       from public.memberships membership
       where membership.organization_id = version.organization_id
         and membership.user_id = p_actor_user_id
         and membership.status = 'active'
     )
     -- Redaction
     or (coalesce(version.transformation ->> 'kind', '') = 'redaction') is distinct from coalesce(p_redaction, false) then
    raise exception 'document upload denied' using errcode = '42501';
  end if;
  if version.upload_state <> 'uploading' then
    return jsonb_build_object(
      'version_id', version.id,
      'upload_state', version.upload_state,
      'scan_result', version.scan_result,
      'detected_media_type', version.detected_media_type
    );
  end if;

  if version.intent_expires_at <= statement_timestamp() then
    next_state := 'failed';
    next_result := 'intent_expired';
    next_reason := 'upload authorization expired';
  elsif p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'checksum must be a sha256 hex digest' using errcode = '22023';
  elsif p_byte_size is null or p_byte_size < 1 then
    raise exception 'measured size is required' using errcode = '22023';
  elsif p_detected_media_type is not null and p_detected_media_type not in (
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/heic',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) then
    raise exception 'detected media type is not allowed' using errcode = '22023';
  else
    detected := p_detected_media_type;
    select (metadata ->> 'size')::bigint into stored_size
    from storage.objects
    where bucket_id = 'documents'
      and name = version.storage_key;
    if stored_size is null then
      raise exception 'stored object was not found' using errcode = '22023';
    end if;
    if stored_size <> p_byte_size
       or p_byte_size <> version.declared_byte_size
       or p_byte_size > app.document_max_bytes(version.organization_id) then
      next_state := 'failed';
      next_result := 'size_mismatch';
      next_reason := 'stored size does not match the upload authorization';
    elsif detected is null then
      next_state := 'failed';
      next_result := 'unrecognized_type';
      next_reason := 'file contents are not PDF, JPEG, PNG, HEIC, or DOCX';
    elsif detected is distinct from version.declared_media_type then
      next_state := 'quarantined';
      next_result := 'extension_mismatch';
      next_reason := 'file contents do not match the filename';
    elsif app.product_setting_enabled('documents.accept_structural_inspection') then
      next_state := 'clean';
      next_engine := 'structural_only';
      next_result := 'structural_only';
    else
      next_state := 'scanning';
      next_result := 'awaiting_scanner';
    end if;
  end if;

  perform app.open_document_write(version.id);
  update public.document_versions
  set upload_state = next_state,
      detected_media_type = coalesce(detected, detected_media_type),
      byte_size = coalesce(p_byte_size, byte_size),
      checksum_sha256 = case when p_sha256 ~ '^[0-9a-f]{64}$' then p_sha256 else checksum_sha256 end,
      scan_result = next_result,
      scan_engine = next_engine,
      quarantine_reason = next_reason,
      completed_at = statement_timestamp()
  where id = version.id;
  perform app.close_document_write(version.id);

  if next_state = 'clean' then
    perform app.enqueue_event(
      version.organization_id, 'document', version.document_id, 'document.uploaded',
      jsonb_build_object('document_id', version.document_id, 'version_id', version.id, 'matter_id', (
        select ref.matter_id from public.document_matter_refs ref
        where ref.document_id = version.document_id and ref.removed_at is null
        order by ref.created_at desc
        limit 1
      )),
      version.version_number,
      'document.uploaded:' || version.id::text,
      null
    );
  elsif next_state = 'quarantined' then
    perform app.enqueue_event(
      version.organization_id, 'document', version.document_id, 'document.quarantined',
      jsonb_build_object('document_id', version.document_id, 'version_id', version.id, 'scan_result', next_result),
      version.version_number,
      'document.quarantined:' || version.id::text,
      null
    );
  end if;

  perform app.record_audit_event(
    version.organization_id,
    'document.upload_completed',
    'document_versions',
    version.id,
    case when next_state in ('clean', 'scanning') then 'success' else 'denied' end,
    jsonb_build_object(
      'upload_state', next_state,
      'scan_result', next_result,
      'actor_user_id', p_actor_user_id,
      'verified_by', 'server'
    )
  );

  return jsonb_build_object(
    'version_id', version.id,
    'upload_state', next_state,
    'scan_result', next_result,
    'detected_media_type', detected
  );
end;
$$;
revoke all on function app.finish_document_upload_checked(uuid, uuid, text, bigint, text, boolean) from public, anon, authenticated, service_role;

-- From 20261018010500_verified_document_upload.sql: now the ordinary path only (no redaction version).
create or replace function app.finish_verified_document_upload(
  p_version_id uuid,
  p_actor_user_id uuid,
  p_sha256 text,
  p_byte_size bigint,
  p_detected_media_type text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return app.finish_document_upload_checked(
    p_version_id, p_actor_user_id, p_sha256, p_byte_size, p_detected_media_type, false
  );
end;
$$;

create or replace function public.service_finish_redacted_copy(
  p_version_id uuid,
  p_actor_user_id uuid,
  p_sha256 text,
  p_byte_size bigint,
  p_detected_media_type text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return app.finish_document_upload_checked(
    p_version_id, p_actor_user_id, p_sha256, p_byte_size, p_detected_media_type, true
  );
end;
$$;
revoke all on function public.service_finish_redacted_copy(uuid, uuid, text, bigint, text) from public, anon, authenticated;
grant execute on function public.service_finish_redacted_copy(uuid, uuid, text, bigint, text) to service_role;
comment on function public.service_finish_redacted_copy(uuid, uuid, text, bigint, text) is
  'DOC-07, service role only: completes a redacted copy the server wrote, with SHA-256, size and type measured by the server. public.finish_verified_document_upload refuses redaction versions.';
