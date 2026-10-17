-- T024 private document storage (PRD §11 DOC-02, DOC-06, DOC-07, ARCH §9).
-- Upload state and review state are separate. A clean file is not accepted evidence.
-- Objects stay in the private "documents" bucket. Quarantine is a state, not a second bucket.
-- No malware scanner is connected. documents.accept_structural_inspection records that
-- a type, size, and extension check is not a virus scan.
-- Additive only.

create type public.document_upload_state as enum (
  'uploading',
  'scanning',
  'quarantined',
  'clean',
  'failed'
);

create type public.document_review_state as enum (
  'pending',
  'accepted',
  'rejected'
);

create type public.document_sensitivity as enum (
  'ordinary',
  'narrative',
  'medical',
  'criminal'
);

create type public.document_audience as enum (
  'subject',
  'matter',
  'staff'
);

alter table public.organizations
  add column document_max_bytes integer
    check (document_max_bytes is null or document_max_bytes between 1 and 104857600);
comment on column public.organizations.document_max_bytes is
  'Firm upload ceiling in bytes. Null uses the 25 MB product default. Above 25 MB requires documents.large_uploads_enabled. Never above 100 MB.';

insert into public.product_settings (key, value, description, pending_confirmation) values
  (
    'documents.max_upload_bytes',
    '{"bytes":26214400,"ceiling_bytes":104857600}'::jsonb,
    'DOC-02 default is 25 MB per file. The ceiling is 100 MB. Not a statutory limit.',
    false
  ),
  (
    'documents.large_uploads_enabled',
    '{"enabled":false}'::jsonb,
    'Keep false until storage, scanning, and backups are validated for files above 25 MB.',
    true
  ),
  (
    'documents.accept_structural_inspection',
    '{"enabled":true}'::jsonb,
    'No virus scanner is connected. A matching type, size, and extension marks the file clean. This is not a malware scan.',
    true
  ),
  (
    'documents.signed_url_seconds',
    '{"seconds":120}'::jsonb,
    'Chosen lifetime for a retrieval URL after a fresh authorization check. The PRD requires short-lived links and sets no number.',
    true
  ),
  (
    'documents.upload_intent_seconds',
    '{"seconds":900}'::jsonb,
    'Chosen lifetime for an upload authorization. Aligned with the 15-minute step-up window.',
    true
  );

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  person_id uuid not null,
  purpose text not null check (length(btrim(purpose)) between 1 and 200),
  sensitivity public.document_sensitivity not null default 'ordinary',
  audience public.document_audience not null default 'subject',
  current_version_id uuid,
  translates_document_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id),
  foreign key (person_id, organization_id) references public.persons (id, organization_id),
  foreign key (translates_document_id, organization_id) references public.documents (id, organization_id)
);
comment on table public.documents is
  'One evidence item for one person. Matter links are separate and can be removed without deleting the file.';

create index documents_org_fk_idx on public.documents (organization_id);
create index documents_person_org_fk_idx on public.documents (person_id, organization_id);
create index documents_translates_org_fk_idx on public.documents (translates_document_id, organization_id);
create index documents_created_by_idx on public.documents (created_by);
create index documents_org_sensitivity_idx on public.documents (organization_id, sensitivity);

create table public.document_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  document_id uuid not null,
  version_number integer not null check (version_number >= 1),
  storage_bucket text not null default 'documents' check (storage_bucket = 'documents'),
  storage_key text not null check (length(storage_key) between 16 and 500),
  original_filename text not null check (
    length(btrim(original_filename)) between 1 and 300
    and position('/' in original_filename) = 0
    and position(chr(92) in original_filename) = 0
  ),
  declared_media_type text not null,
  declared_byte_size bigint not null check (declared_byte_size > 0),
  detected_media_type text,
  byte_size bigint check (byte_size is null or byte_size > 0),
  checksum_sha256 text check (checksum_sha256 is null or checksum_sha256 ~ '^[0-9a-f]{64}$'),
  upload_state public.document_upload_state not null default 'uploading',
  scan_result text check (scan_result is null or length(scan_result) <= 80),
  scan_engine text check (scan_engine is null or scan_engine in ('structural_only', 'worker')),
  quarantine_reason text check (quarantine_reason is null or length(quarantine_reason) <= 200),
  parent_version_id uuid,
  transformation jsonb check (transformation is null or pg_column_size(transformation) <= 2000),
  review_state public.document_review_state not null default 'pending',
  expires_on date,
  translation_of_version_id uuid,
  language_tag text check (language_tag is null or language_tag ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  superseded_at timestamptz,
  intent_expires_at timestamptz not null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (document_id, version_number),
  unique (storage_bucket, storage_key),
  unique (id, organization_id),
  check (translation_of_version_id is null or language_tag is not null),
  check (translation_of_version_id is distinct from id),
  foreign key (document_id, organization_id) references public.documents (id, organization_id),
  foreign key (parent_version_id, organization_id) references public.document_versions (id, organization_id),
  foreign key (translation_of_version_id, organization_id) references public.document_versions (id, organization_id)
);
comment on table public.document_versions is
  'Immutable file identity once stored. Scan and review state move only through document functions. Originals are not replaced by a preview.';
comment on column public.document_versions.scan_engine is
  'structural_only means type, size, and extension were checked. It does not mean a virus scanner ran.';

create index document_versions_org_review_idx
  on public.document_versions (organization_id, review_state);
create index document_versions_org_upload_idx
  on public.document_versions (organization_id, upload_state);
create index document_versions_org_fk_idx on public.document_versions (organization_id);
create index document_versions_document_org_fk_idx
  on public.document_versions (document_id, organization_id);
create index document_versions_parent_org_fk_idx
  on public.document_versions (parent_version_id, organization_id);
create index document_versions_translation_org_fk_idx
  on public.document_versions (translation_of_version_id, organization_id);
create index document_versions_created_by_idx on public.document_versions (created_by);

alter table public.documents
  add constraint documents_current_version_fkey
  foreign key (current_version_id, organization_id)
  references public.document_versions (id, organization_id);
create index documents_current_version_org_fk_idx
  on public.documents (current_version_id, organization_id);

create table public.document_matter_refs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  document_id uuid not null,
  matter_id uuid not null,
  removed_at timestamptz,
  removal_reason text check (removal_reason is null or length(btrim(removal_reason)) between 3 and 500),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  unique (id, organization_id),
  check (removed_at is null or removal_reason is not null),
  foreign key (document_id, organization_id) references public.documents (id, organization_id),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id)
);
comment on table public.document_matter_refs is
  'A document may be linked to more than one matter. Removing a link does not delete the file.';

create unique index document_matter_refs_active_uidx
  on public.document_matter_refs (document_id, matter_id)
  where removed_at is null;
create index document_matter_refs_org_fk_idx on public.document_matter_refs (organization_id);
create index document_matter_refs_document_org_fk_idx
  on public.document_matter_refs (document_id, organization_id);
create index document_matter_refs_matter_org_fk_idx
  on public.document_matter_refs (matter_id, organization_id);
create index document_matter_refs_created_by_idx on public.document_matter_refs (created_by);

create table public.document_custody_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  version_id uuid not null,
  received_on date,
  location text check (location is null or length(btrim(location)) between 1 and 200),
  purpose text not null check (length(btrim(purpose)) between 3 and 300),
  recipient text check (recipient is null or length(btrim(recipient)) between 1 and 200),
  return_on date,
  acknowledged_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  foreign key (version_id, organization_id) references public.document_versions (id, organization_id)
);
comment on table public.document_custody_events is
  'Append-only custody of an original: received, location, purpose, recipient, return, acknowledgement.';

create index document_custody_events_version_idx
  on public.document_custody_events (version_id, created_at);
create index document_custody_events_org_fk_idx on public.document_custody_events (organization_id);
create index document_custody_events_version_org_fk_idx
  on public.document_custody_events (version_id, organization_id);
create index document_custody_events_created_by_idx on public.document_custody_events (created_by);

create table app.document_write_nonce (
  object_id uuid primary key,
  txid bigint not null
);
revoke all on table app.document_write_nonce from public, anon, authenticated, service_role;

create function app.reject_document_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'document evidence cannot be deleted' using errcode = '42501';
end;
$$;
revoke all on function app.reject_document_delete() from public;

create trigger documents_no_delete before delete on public.documents
  for each row execute function app.reject_document_delete();
create trigger document_versions_no_delete before delete on public.document_versions
  for each row execute function app.reject_document_delete();
create trigger document_custody_events_no_update
  before update or delete on public.document_custody_events
  for each row execute function app.reject_document_delete();

create function app.open_document_write(p_object_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into app.document_write_nonce (object_id, txid)
  values (p_object_id, txid_current())
  on conflict (object_id) do update set txid = excluded.txid;
end;
$$;
revoke all on function app.open_document_write(uuid) from public;

create function app.close_document_write(p_object_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from app.document_write_nonce where object_id = p_object_id;
end;
$$;
revoke all on function app.close_document_write(uuid) from public;

create function app.guard_document_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from app.document_write_nonce nonce
    where nonce.object_id = new.id
      and nonce.txid = txid_current()
  ) then
    raise exception 'document changes go through a document function' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.guard_document_write() from public;

create trigger documents_write_guard before update on public.documents
  for each row execute function app.guard_document_write();
create trigger document_versions_write_guard before update on public.document_versions
  for each row execute function app.guard_document_write();
create trigger document_matter_refs_write_guard before update on public.document_matter_refs
  for each row execute function app.guard_document_write();

create trigger documents_touch before update on public.documents
  for each row execute function app.touch_row();
create trigger document_versions_touch before update on public.document_versions
  for each row execute function app.touch_row();

create function app.detect_media_type(p_header bytea)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  brand text;
begin
  if p_header is null or octet_length(p_header) < 8 then
    return null;
  end if;
  if substring(p_header from 1 for 4) = '\x25504446'::bytea then
    return 'application/pdf';
  end if;
  if substring(p_header from 1 for 3) = '\xFFD8FF'::bytea then
    return 'image/jpeg';
  end if;
  if substring(p_header from 1 for 8) = '\x89504E470D0A1A0A'::bytea then
    return 'image/png';
  end if;
  if substring(p_header from 1 for 4) = '\x504B0304'::bytea then
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  end if;
  if octet_length(p_header) >= 12 and substring(p_header from 5 for 4) = convert_to('ftyp', 'UTF8') then
    brand := convert_from(substring(p_header from 9 for 4), 'UTF8');
    if brand in ('heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1', 'heif') then
      return 'image/heic';
    end if;
  end if;
  return null;
end;
$$;
revoke all on function app.detect_media_type(bytea) from public;

create function app.media_type_for_filename(p_name text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  ext text;
begin
  ext := lower(regexp_replace(btrim(coalesce(p_name, '')), '^.*\.', ''));
  case ext
    when 'pdf' then return 'application/pdf';
    when 'jpg' then return 'image/jpeg';
    when 'jpeg' then return 'image/jpeg';
    when 'png' then return 'image/png';
    when 'heic' then return 'image/heic';
    when 'heif' then return 'image/heic';
    when 'docx' then return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    else return null;
  end case;
end;
$$;
revoke all on function app.media_type_for_filename(text) from public;

create function app.document_max_bytes(p_org uuid)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  firm_limit integer;
  large_ok boolean;
begin
  select document_max_bytes into firm_limit
  from public.organizations
  where id = p_org;
  select coalesce((value ->> 'enabled')::boolean, false) into large_ok
  from public.product_settings
  where key = 'documents.large_uploads_enabled';
  if firm_limit is null or firm_limit > 26214400 and large_ok is distinct from true then
    return 26214400;
  end if;
  if firm_limit > 104857600 then
    return 104857600;
  end if;
  return firm_limit;
end;
$$;
revoke all on function app.document_max_bytes(uuid) from public;

create function app.product_setting_enabled(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((value ->> 'enabled')::boolean, false)
  from public.product_settings
  where key = p_key;
$$;
revoke all on function app.product_setting_enabled(text) from public;

create function app.signed_url_seconds()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((value ->> 'seconds')::integer, 120)
  from public.product_settings
  where key = 'documents.signed_url_seconds';
$$;
revoke all on function app.signed_url_seconds() from public;

create function app.upload_intent_seconds()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((value ->> 'seconds')::integer, 900)
  from public.product_settings
  where key = 'documents.upload_intent_seconds';
$$;
revoke all on function app.upload_intent_seconds() from public;

create function app.can_read_document(p_id uuid)
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
          doc.audience <> 'staff'
          and exists (
            select 1
            from public.persons person
            where person.id = doc.person_id
              and person.organization_id = doc.organization_id
              and person.user_id = (select auth.uid())
          )
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
  );
$$;
revoke all on function app.can_read_document(uuid) from public;
grant execute on function app.can_read_document(uuid) to authenticated, service_role;

create function app.can_read_document_version(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.document_versions version
    where version.id = p_id
      and version.organization_id = (select app.current_organization_id())
      and (
        (select app.can_read_document(version.document_id))
        or (
          version.upload_state = 'uploading'
          and version.created_by = (select auth.uid())
          and version.intent_expires_at > statement_timestamp()
        )
      )
  );
$$;
revoke all on function app.can_read_document_version(uuid) from public;
grant execute on function app.can_read_document_version(uuid) to authenticated, service_role;

create function app.can_upload_storage_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- Storage API sessions may not carry the workspace header. The unguessable key
  -- and created_by check are the authorization. Table reads still require the workspace.
  select exists (
    select 1
    from public.document_versions version
    where version.storage_key = p_name
      and version.storage_bucket = 'documents'
      and version.upload_state = 'uploading'
      and version.created_by = (select auth.uid())
      and version.intent_expires_at > statement_timestamp()
      and (select app.is_org_member(version.organization_id))
  );
$$;
revoke all on function app.can_upload_storage_object(text) from public;
grant execute on function app.can_upload_storage_object(text) to authenticated, service_role;

create function app.can_read_storage_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.document_versions version
    join public.documents doc
      on doc.id = version.document_id
     and doc.organization_id = version.organization_id
    where version.storage_key = p_name
      and version.storage_bucket = 'documents'
      and (select app.is_org_member(version.organization_id))
      and (
        (
          version.upload_state = 'uploading'
          and version.created_by = (select auth.uid())
          and version.intent_expires_at > statement_timestamp()
        )
        or (
          version.upload_state = 'clean'
          and (
            (
              doc.audience <> 'staff'
              and exists (
                select 1
                from public.persons person
                where person.id = doc.person_id
                  and person.user_id = (select auth.uid())
              )
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
            )
            or (
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
                  join public.matter_participants party
                    on party.matter_id = ref.matter_id
                   and party.organization_id = ref.organization_id
                  join public.memberships membership
                    on membership.id = party.membership_id
                   and membership.organization_id = party.organization_id
                  where ref.document_id = doc.id
                    and ref.removed_at is null
                    and membership.user_id = (select auth.uid())
                    and membership.status = 'active'
                    and membership.role = any (
                      array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[]
                    )
                )
              )
            )
          )
        )
      )
  );
$$;
revoke all on function app.can_read_storage_object(text) from public;
grant execute on function app.can_read_storage_object(text) to authenticated, service_role;

create function app.actor_can_upload_for(p_matter_id uuid, p_person_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  matter public.matters%rowtype;
begin
  select * into matter from public.matters where id = p_matter_id;
  if matter.id is null or matter.organization_id is distinct from (select app.current_organization_id()) then
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
  if exists (
    select 1
    from public.persons person
    where person.id = p_person_id
      and person.user_id = (select auth.uid())
  ) then
    return true;
  end if;
  return app.staff_mfa_satisfied()
     and app.mfa_step_up_satisfied()
     and app.has_org_role(
       matter.organization_id,
       array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[]
     )
     and app.can_read_matter(matter.id);
end;
$$;
revoke all on function app.actor_can_upload_for(uuid, uuid) from public;

create function app.create_upload_intent(
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

create function public.create_upload_intent(
  p_matter_id uuid,
  p_person_id uuid,
  p_filename text,
  p_declared_byte_size bigint,
  p_purpose text,
  p_sensitivity public.document_sensitivity,
  p_audience public.document_audience,
  p_document_id uuid default null,
  p_translation_of_version_id uuid default null,
  p_language_tag text default null
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app.create_upload_intent(
    p_matter_id, p_person_id, p_filename, p_declared_byte_size, p_purpose,
    p_sensitivity, p_audience, p_document_id, p_translation_of_version_id, p_language_tag
  );
$$;
revoke all on function public.create_upload_intent(uuid, uuid, text, bigint, text, public.document_sensitivity, public.document_audience, uuid, uuid, text) from public, anon;
grant execute on function public.create_upload_intent(uuid, uuid, text, bigint, text, public.document_sensitivity, public.document_audience, uuid, uuid, text)
  to authenticated, service_role;

create function app.complete_document_upload(
  p_version_id uuid,
  p_sha256 text,
  p_header_hex text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  version public.document_versions%rowtype;
  header bytea;
  detected text;
  stored_size bigint;
  next_state public.document_upload_state;
  next_engine text;
  next_result text;
  next_reason text;
begin
  select * into version from public.document_versions where id = p_version_id for update;
  if version.id is null
     or version.organization_id is distinct from (select app.current_organization_id())
     or app.can_read_document_version(version.id) is distinct from true then
    raise exception 'document upload denied' using errcode = '42501';
  end if;
  if version.created_by is distinct from (select auth.uid()) then
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
  elsif p_header_hex is null or p_header_hex !~ '^[0-9a-f]+$' or length(p_header_hex) < 16 or length(p_header_hex) > 64 then
    raise exception 'file header is missing' using errcode = '22023';
  else
    header := decode(p_header_hex, 'hex');
    detected := app.detect_media_type(header);
    select (metadata ->> 'size')::bigint into stored_size
    from storage.objects
    where bucket_id = 'documents'
      and name = version.storage_key;
    if stored_size is null then
      raise exception 'stored object was not found' using errcode = '22023';
    end if;
    if stored_size <> version.declared_byte_size or stored_size > app.document_max_bytes(version.organization_id) then
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
      byte_size = coalesce(stored_size, byte_size),
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
    jsonb_build_object('upload_state', next_state, 'scan_result', next_result)
  );

  return jsonb_build_object(
    'version_id', version.id,
    'upload_state', next_state,
    'scan_result', next_result,
    'detected_media_type', detected
  );
end;
$$;
revoke all on function app.complete_document_upload(uuid, text, text) from public;

create function public.complete_document_upload(
  p_version_id uuid,
  p_sha256 text,
  p_header_hex text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app.complete_document_upload(p_version_id, p_sha256, p_header_hex);
$$;
revoke all on function public.complete_document_upload(uuid, text, text) from public, anon;
grant execute on function public.complete_document_upload(uuid, text, text) to authenticated, service_role;

create function app.apply_document_scan(
  p_version_id uuid,
  p_result text
)
returns public.document_upload_state
language plpgsql
security definer
set search_path = ''
as $$
declare
  version public.document_versions%rowtype;
  next_state public.document_upload_state;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') is distinct from 'service_role' then
    raise exception 'worker role required' using errcode = '42501';
  end if;
  if p_result not in ('clean', 'suspicious', 'failed') then
    raise exception 'scan result must be clean, suspicious, or failed' using errcode = '22023';
  end if;
  select * into version from public.document_versions where id = p_version_id for update;
  if version.id is null then
    raise exception 'document version was not found' using errcode = '22023';
  end if;
  next_state := case p_result
    when 'clean' then 'clean'::public.document_upload_state
    when 'suspicious' then 'quarantined'::public.document_upload_state
    else 'failed'::public.document_upload_state
  end;
  perform app.open_document_write(version.id);
  update public.document_versions
  set upload_state = next_state,
      scan_engine = 'worker',
      scan_result = p_result,
      quarantine_reason = case
        when p_result = 'clean' then null
        when p_result = 'suspicious' then 'scanner quarantined the file'
        else 'scanner could not accept the file'
      end
  where id = version.id;
  perform app.close_document_write(version.id);
  if next_state = 'quarantined' then
    perform app.enqueue_event(
      version.organization_id, 'document', version.document_id, 'document.quarantined',
      jsonb_build_object('document_id', version.document_id, 'version_id', version.id, 'scan_result', p_result),
      version.version_number,
      'document.worker_quarantine:' || version.id::text,
      null
    );
  end if;
  return next_state;
end;
$$;
revoke all on function app.apply_document_scan(uuid, text) from public;

create function public.apply_document_scan(p_version_id uuid, p_result text)
returns public.document_upload_state
language sql
security invoker
set search_path = ''
as $$
  select app.apply_document_scan(p_version_id, p_result);
$$;
revoke all on function public.apply_document_scan(uuid, text) from public, anon, authenticated;
grant execute on function public.apply_document_scan(uuid, text) to service_role;

create function app.authorize_document_download(p_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  version public.document_versions%rowtype;
  seconds integer;
begin
  select * into version from public.document_versions where id = p_version_id;
  if version.id is null
     or app.can_read_document_version(version.id) is distinct from true
     or version.upload_state is distinct from 'clean' then
    raise exception 'document download denied' using errcode = '42501';
  end if;
  if (select app.has_org_role(version.organization_id, (select app.staff_roles())))
     and app.mfa_step_up_satisfied() is distinct from true then
    raise exception 'step-up is required' using errcode = '42501';
  end if;
  seconds := app.signed_url_seconds();
  perform app.record_audit_event(
    version.organization_id,
    'document.download',
    'document_versions',
    version.id,
    'success',
    jsonb_build_object('seconds', seconds)
  );
  return jsonb_build_object(
    'bucket', version.storage_bucket,
    'storage_key', version.storage_key,
    'seconds', seconds
  );
end;
$$;
revoke all on function app.authorize_document_download(uuid) from public;

create function public.authorize_document_download(p_version_id uuid)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app.authorize_document_download(p_version_id);
$$;
revoke all on function public.authorize_document_download(uuid) from public, anon;
grant execute on function public.authorize_document_download(uuid) to authenticated, service_role;

create function app.record_document_custody(
  p_version_id uuid,
  p_received_on date,
  p_location text,
  p_purpose text,
  p_recipient text,
  p_return_on date,
  p_acknowledged boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  version public.document_versions%rowtype;
  new_id uuid;
begin
  select * into version from public.document_versions where id = p_version_id;
  if version.id is null or app.can_read_document_version(version.id) is distinct from true then
    raise exception 'document custody denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    version.organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[],
    true
  );
  if p_purpose is null or length(btrim(p_purpose)) not between 3 and 300 then
    raise exception 'custody purpose is required' using errcode = '22023';
  end if;
  insert into public.document_custody_events (
    organization_id, version_id, received_on, location, purpose, recipient, return_on, acknowledged_at, created_by
  ) values (
    version.organization_id,
    version.id,
    p_received_on,
    nullif(btrim(p_location), ''),
    btrim(p_purpose),
    nullif(btrim(p_recipient), ''),
    p_return_on,
    case when p_acknowledged is true then statement_timestamp() else null end,
    (select auth.uid())
  )
  returning id into new_id;
  perform app.record_audit_event(
    version.organization_id, 'document.custody_recorded', 'document_custody_events', new_id, 'success',
    jsonb_build_object('version_id', version.id)
  );
  return new_id;
end;
$$;
revoke all on function app.record_document_custody(uuid, date, text, text, text, date, boolean) from public;

create function public.record_document_custody(
  p_version_id uuid,
  p_received_on date,
  p_location text,
  p_purpose text,
  p_recipient text,
  p_return_on date,
  p_acknowledged boolean
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select app.record_document_custody(
    p_version_id, p_received_on, p_location, p_purpose, p_recipient, p_return_on, p_acknowledged
  );
$$;
revoke all on function public.record_document_custody(uuid, date, text, text, text, date, boolean) from public, anon;
grant execute on function public.record_document_custody(uuid, date, text, text, text, date, boolean)
  to authenticated, service_role;

create function app.set_document_upload_limit(p_bytes integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid := app.current_organization_id();
begin
  if org is null then
    raise exception 'staff access denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(org, array['firm_owner']::public.org_role[], true);
  if p_bytes is null or p_bytes < 1 or p_bytes > 104857600 then
    raise exception 'upload limit must be between 1 byte and 100 MB' using errcode = '22023';
  end if;
  if p_bytes > 26214400 and app.product_setting_enabled('documents.large_uploads_enabled') is distinct from true then
    raise exception 'uploads above 25 MB stay off until storage is validated' using errcode = '42501';
  end if;
  update public.organizations set document_max_bytes = p_bytes where id = org;
  return p_bytes;
end;
$$;
revoke all on function app.set_document_upload_limit(integer) from public;

create function public.set_document_upload_limit(p_bytes integer)
returns integer
language sql
security invoker
set search_path = ''
as $$
  select app.set_document_upload_limit(p_bytes);
$$;
revoke all on function public.set_document_upload_limit(integer) from public, anon;
grant execute on function public.set_document_upload_limit(integer) to authenticated, service_role;

revoke all on table public.documents from anon, authenticated;
revoke all on table public.document_versions from anon, authenticated;
revoke all on table public.document_matter_refs from anon, authenticated;
revoke all on table public.document_custody_events from anon, authenticated;
grant select on table public.documents to authenticated;
grant select on table public.document_versions to authenticated;
grant select on table public.document_matter_refs to authenticated;
grant select on table public.document_custody_events to authenticated;

alter table public.documents enable row level security;
alter table public.documents force row level security;
alter table public.document_versions enable row level security;
alter table public.document_versions force row level security;
alter table public.document_matter_refs enable row level security;
alter table public.document_matter_refs force row level security;
alter table public.document_custody_events enable row level security;
alter table public.document_custody_events force row level security;

create policy documents_select on public.documents
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.can_read_document(id))
  );
create policy document_versions_select on public.document_versions
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.can_read_document_version(id))
  );
create policy document_matter_refs_select on public.document_matter_refs
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.can_read_document(document_id))
  );
create policy document_custody_events_select on public.document_custody_events
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.can_read_document_version(version_id))
    and (select app.staff_mfa_satisfied())
  );

do $documents_bucket$
begin
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    raise exception 'private document storage requires storage.buckets and storage.objects';
  end if;
  insert into storage.buckets (id, name, public)
  values ('documents', 'documents', false)
  on conflict (id) do update set public = false;
  execute 'grant select, insert on storage.objects to authenticated';
  -- storage.objects already has row level security. The migration role does not own that table.
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'documents_object_insert'
  ) then
    execute $policy$
      create policy documents_object_insert on storage.objects
        for insert to authenticated
        with check (
          bucket_id = 'documents'
          and (select app.can_upload_storage_object(name))
        )
    $policy$;
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'documents_object_select'
  ) then
    execute $policy$
      create policy documents_object_select on storage.objects
        for select to authenticated
        using (
          bucket_id = 'documents'
          and (select app.can_read_storage_object(name))
        )
    $policy$;
  end if;
end
$documents_bucket$;

-- Invoker wrappers and triggers run as the caller, so the caller needs execute.
-- open_document_write stays revoked so a caller cannot bypass the write guard.
grant execute on function app.reject_document_delete() to authenticated, service_role;
grant execute on function app.guard_document_write() to authenticated, service_role;
grant execute on function app.create_upload_intent(uuid, uuid, text, bigint, text, public.document_sensitivity, public.document_audience, uuid, uuid, text) to authenticated, service_role;
grant execute on function app.complete_document_upload(uuid, text, text) to authenticated, service_role;
grant execute on function app.apply_document_scan(uuid, text) to service_role;
grant execute on function app.authorize_document_download(uuid) to authenticated, service_role;
grant execute on function app.record_document_custody(uuid, date, text, text, text, date, boolean) to authenticated, service_role;
grant execute on function app.set_document_upload_limit(integer) to authenticated, service_role;
