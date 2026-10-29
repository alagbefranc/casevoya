-- DOC-03 camera assembly metadata, and DOC-07 redacted copies.
--
-- A multi-page capture is one PDF. While the upload is still open, the person who started it
-- records how each page was turned and whether it came from the camera. The image bytes stay
-- inside that PDF; they are not recompressed into a second file.
--
-- A redacted copy is a new document. Its version's parent is the original version, which is not
-- updated. The copy's audience is staff, so the client and a sponsor do not receive it. Each
-- marked area is a row in document_redactions and an audit event. The bytes are written by the
-- service role: a staff browser cannot upload a different file under the redaction label
-- (app.can_upload_storage_object refuses kind "redaction"). The copy then takes the same type
-- check, virus-scan hold and retention path as any other upload, because it is a document on the
-- matter (document_matter_refs is what the deletion planner reads).
--
-- pdf-lib cannot remove text or image samples. The Worker rewrites the content stream and the
-- image samples (see src/modules/documents/redact.ts). MuPDF's WASM build is about 14 MB and is
-- not added to the Worker. The virus-scan container is not used to make the copy.

create table public.document_redactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  source_version_id uuid not null,
  copy_version_id uuid not null,
  page_index integer not null check (page_index >= 0 and page_index <= 2000),
  x double precision not null,
  y double precision not null,
  width double precision not null,
  height double precision not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  unique (id, organization_id),
  check (x >= 0 and y >= 0 and x <= 1 and y <= 1),
  check (width > 0 and height > 0 and x + width <= 1.000001 and y + height <= 1.000001),
  foreign key (source_version_id, organization_id) references public.document_versions (id, organization_id),
  foreign key (copy_version_id, organization_id) references public.document_versions (id, organization_id)
);
comment on table public.document_redactions is
  'DOC-07: one marked area on a redacted copy. The original version is source_version_id and is not changed. Append-only. Coordinates are the upright page, top-left, 0 to 1. No extracted text.';

create index document_redactions_org_fk_idx on public.document_redactions (organization_id);
create index document_redactions_source_org_fk_idx on public.document_redactions (source_version_id, organization_id);
create index document_redactions_copy_org_fk_idx on public.document_redactions (copy_version_id, organization_id);
create index document_redactions_created_by_idx on public.document_redactions (created_by);

create function app.reject_document_redaction_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'redaction records are kept' using errcode = '42501';
end;
$$;
revoke all on function app.reject_document_redaction_change() from public;

create trigger document_redactions_no_change
  before update or delete on public.document_redactions
  for each row execute function app.reject_document_redaction_change();

alter table public.document_redactions enable row level security;
alter table public.document_redactions force row level security;
revoke all on table public.document_redactions from public, anon;
revoke insert, update, delete on table public.document_redactions from authenticated;
grant select on table public.document_redactions to authenticated;

create policy document_redactions_select on public.document_redactions
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.staff_mfa_satisfied())
    and (select app.has_org_role(
      organization_id,
      array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[]
    ))
    and (select app.can_read_document_version(source_version_id))
  );

-- A redaction intent is filled by the service role after the Worker has removed the bytes.
-- The uploader cannot substitute a different object.
create or replace function app.can_upload_storage_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.document_versions version
    where version.storage_key = p_name
      and version.storage_bucket = 'documents'
      and version.upload_state = 'uploading'
      and version.created_by = (select auth.uid())
      and version.intent_expires_at > statement_timestamp()
      and (select app.is_org_member(version.organization_id))
      and coalesce(version.transformation ->> 'kind', '') is distinct from 'redaction'
  );
$$;

create function app.record_camera_assembly(p_version_id uuid, p_pages jsonb)
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
     or (select app.is_org_member(version.organization_id)) is distinct from true then
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
revoke all on function app.record_camera_assembly(uuid, jsonb) from public;
grant execute on function app.record_camera_assembly(uuid, jsonb) to authenticated, service_role;

create function public.record_camera_assembly(p_version_id uuid, p_pages jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app.record_camera_assembly(p_version_id, p_pages);
$$;
revoke all on function public.record_camera_assembly(uuid, jsonb) from public, anon;
grant execute on function public.record_camera_assembly(uuid, jsonb) to authenticated, service_role;
comment on function public.record_camera_assembly(uuid, jsonb) is
  'DOC-03: the uploader records page order, clockwise quarter turns and camera or library, while the upload is still open.';

create function app.create_redacted_copy_intent(
  p_source_version_id uuid,
  p_matter_id uuid,
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
  if (select app.staff_mfa_satisfied()) is distinct from true then
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

  insert into public.documents (
    organization_id, person_id, purpose, sensitivity, audience, created_by
  ) values (
    matter.organization_id, doc.person_id, purpose, doc.sensitivity, 'staff', (select auth.uid())
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
    (select auth.uid())
  );

  insert into public.document_matter_refs (organization_id, document_id, matter_id, created_by)
  values (matter.organization_id, doc_id, matter.id, (select auth.uid()));

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
      (select auth.uid())
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
        'height', (region ->> 'height')::double precision
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
      'region_count', region_count
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
revoke all on function app.create_redacted_copy_intent(uuid, uuid, text, bigint, jsonb) from public;
grant execute on function app.create_redacted_copy_intent(uuid, uuid, text, bigint, jsonb) to authenticated, service_role;

create function public.create_redacted_copy_intent(
  p_source_version_id uuid,
  p_matter_id uuid,
  p_filename text,
  p_declared_byte_size bigint,
  p_regions jsonb
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app.create_redacted_copy_intent(
    p_source_version_id, p_matter_id, p_filename, p_declared_byte_size, p_regions
  );
$$;
revoke all on function public.create_redacted_copy_intent(uuid, uuid, text, bigint, jsonb) from public, anon;
grant execute on function public.create_redacted_copy_intent(uuid, uuid, text, bigint, jsonb) to authenticated, service_role;
comment on function public.create_redacted_copy_intent(uuid, uuid, text, bigint, jsonb) is
  'DOC-07: staff with a fresh step-up open a redacted copy. The original is not changed. The service role stores the rewritten bytes; the browser cannot.';
