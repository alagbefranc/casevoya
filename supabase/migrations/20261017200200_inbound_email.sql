-- T034 inbound mail. Firm addresses are <slug>@docs.casevoya.ca. Matter replies use
-- <slug>+<token>@ the same domain. INBOUND_EMAIL_DOMAIN overrides the product setting.
-- Reserved slugs cannot be claimed. Unknown firms are rejected. Message-id dedupes.
-- A crash after the row is stored and before attachments finish returns status resume.
-- A provider accept that never reaches finish_email_delivery stays sending and can be
-- claimed again after the outbox lease: delivery is at-least-once, one row per recipient.
-- Additive only. storage.objects is not altered.

insert into public.product_settings (key, value, description, pending_confirmation) values
  (
    'email.inbound_domain',
    '{"domain":"docs.casevoya.ca"}'::jsonb,
    'Confirmed inbound domain. Firm addresses are <slug>@ this domain. Matter replies use the same domain. Override with INBOUND_EMAIL_DOMAIN.',
    false
  ),
  (
    'email.inbound_hourly_limit',
    '{"messages":30}'::jsonb,
    'Proposed cap on accepted inbound messages per firm per hour. Pending confirmation. Duplicate message ids do not count.',
    true
  );

-- Keep this list identical to RESERVED_FIRM_SLUGS in src/lib/auth/slug.ts.
create function app.reserved_firm_slugs()
returns text[]
language sql
immutable
as $$
  select array[
    'support', 'billing', 'admin', 'hello', 'noreply', 'postmaster',
    'abuse', 'security', 'help', 'info', 'team'
  ]::text[];
$$;
revoke all on function app.reserved_firm_slugs() from public;
grant execute on function app.reserved_firm_slugs() to authenticated, service_role;

create function app.guard_reserved_firm_slug()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.slug = any (app.reserved_firm_slugs())
     and (tg_op = 'INSERT' or new.slug is distinct from old.slug) then
    raise exception 'that firm address is reserved' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function app.guard_reserved_firm_slug() from public;

create trigger organizations_reserved_slug
  before insert or update on public.organizations
  for each row execute function app.guard_reserved_firm_slug();

do $$
begin
  if not exists (
    select 1
    from public.organizations
    where slug = any (app.reserved_firm_slugs())
  ) then
    alter table public.organizations
      add constraint organizations_slug_not_reserved
      check (slug <> all (app.reserved_firm_slugs()));
  end if;
end;
$$;

create table public.matter_reply_addresses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  matter_id uuid not null,
  token text not null check (token ~ '^[a-f0-9]{32}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (organization_id, matter_id),
  unique (token),
  unique (id, organization_id),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id)
);
comment on table public.matter_reply_addresses is
  'Plus-tag for a matter reply address on the firm inbound domain. The token is not a login secret.';

create index matter_reply_addresses_org_fk_idx on public.matter_reply_addresses (organization_id);
create index matter_reply_addresses_matter_org_fk_idx
  on public.matter_reply_addresses (matter_id, organization_id);
create index matter_reply_addresses_created_by_idx on public.matter_reply_addresses (created_by);

create trigger matter_reply_addresses_touch before update on public.matter_reply_addresses
  for each row execute function app.touch_row();
create trigger matter_reply_addresses_stamp before insert on public.matter_reply_addresses
  for each row execute function app.stamp_created_by();

create table public.inbound_emails (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  message_id text not null check (length(btrim(message_id)) between 1 and 500),
  from_email text not null check (length(from_email) between 3 and 320),
  to_email text not null check (length(to_email) between 3 and 320),
  subject text check (subject is null or length(subject) <= 300),
  text_body text check (text_body is null or length(text_body) <= 100000),
  html_body text check (html_body is null or length(html_body) <= 200000),
  body_location text not null check (body_location in ('inbound_emails', 'messages')),
  matter_id uuid,
  person_id uuid,
  attachments_done boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (organization_id, message_id),
  unique (id, organization_id),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id),
  foreign key (person_id, organization_id) references public.persons (id, organization_id)
);
comment on table public.inbound_emails is
  'Inbound message metadata. Bodies live here only when public.messages cannot take them. Duplicate message ids are not inserted again.';

create index inbound_emails_org_fk_idx on public.inbound_emails (organization_id);
create index inbound_emails_matter_org_fk_idx on public.inbound_emails (matter_id, organization_id);
create index inbound_emails_person_org_fk_idx on public.inbound_emails (person_id, organization_id);
create index inbound_emails_created_by_idx on public.inbound_emails (created_by);

create trigger inbound_emails_touch before update on public.inbound_emails
  for each row execute function app.touch_row();
create trigger inbound_emails_stamp before insert on public.inbound_emails
  for each row execute function app.stamp_created_by();

create table public.inbound_inbox_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  inbound_email_id uuid not null,
  filename text not null check (
    length(btrim(filename)) between 1 and 300
    and position('/' in filename) = 0
  ),
  media_type text,
  byte_size bigint check (byte_size is null or byte_size > 0),
  storage_key text not null check (length(storage_key) between 16 and 500),
  upload_state text not null check (upload_state in ('uploading', 'clean', 'quarantined', 'failed', 'assigned')),
  scan_result text check (scan_result is null or length(scan_result) <= 80),
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  matter_id uuid,
  assigned_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (storage_key),
  unique (id, organization_id),
  foreign key (inbound_email_id, organization_id) references public.inbound_emails (id, organization_id),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id)
);
comment on table public.inbound_inbox_items is
  'Unsorted firm inbox. Same type, size, and structural checks as document intake. No person until staff assign the file.';

create index inbound_inbox_items_org_fk_idx on public.inbound_inbox_items (organization_id);
create index inbound_inbox_items_email_org_fk_idx
  on public.inbound_inbox_items (inbound_email_id, organization_id);
create index inbound_inbox_items_matter_org_fk_idx
  on public.inbound_inbox_items (matter_id, organization_id);
create index inbound_inbox_items_created_by_idx on public.inbound_inbox_items (created_by);

create trigger inbound_inbox_items_touch before update on public.inbound_inbox_items
  for each row execute function app.touch_row();
create trigger inbound_inbox_items_stamp before insert on public.inbound_inbox_items
  for each row execute function app.stamp_created_by();

create table public.inbound_attachment_files (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  inbound_email_id uuid not null,
  ordinal integer not null check (ordinal between 0 and 19),
  filename text not null check (length(filename) between 1 and 300),
  byte_size bigint not null check (byte_size > 0),
  version_id uuid,
  inbox_item_id uuid,
  storage_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (inbound_email_id, ordinal),
  unique (id, organization_id),
  foreign key (inbound_email_id, organization_id) references public.inbound_emails (id, organization_id),
  foreign key (version_id, organization_id) references public.document_versions (id, organization_id),
  foreign key (inbox_item_id, organization_id) references public.inbound_inbox_items (id, organization_id)
);
comment on table public.inbound_attachment_files is
  'Idempotency for attachment intake. A resumed webhook reuses the same storage key.';

create index inbound_attachment_files_org_fk_idx on public.inbound_attachment_files (organization_id);
create index inbound_attachment_files_email_org_fk_idx
  on public.inbound_attachment_files (inbound_email_id, organization_id);
create index inbound_attachment_files_version_org_fk_idx
  on public.inbound_attachment_files (version_id, organization_id);
create index inbound_attachment_files_inbox_org_fk_idx
  on public.inbound_attachment_files (inbox_item_id, organization_id);
create index inbound_attachment_files_created_by_idx on public.inbound_attachment_files (created_by);

create trigger inbound_attachment_files_touch before update on public.inbound_attachment_files
  for each row execute function app.touch_row();
create trigger inbound_attachment_files_stamp before insert on public.inbound_attachment_files
  for each row execute function app.stamp_created_by();

create table public.email_inbound_windows (
  organization_id uuid not null references public.organizations (id),
  hour_bucket timestamptz not null,
  hits integer not null default 0 check (hits >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  primary key (organization_id, hour_bucket)
);
comment on table public.email_inbound_windows is
  'Accepted inbound messages per firm per hour. A duplicate message id does not increment hits.';

create index email_inbound_windows_created_by_idx on public.email_inbound_windows (created_by);

create trigger email_inbound_windows_touch before update on public.email_inbound_windows
  for each row execute function app.touch_row();
create trigger email_inbound_windows_stamp before insert on public.email_inbound_windows
  for each row execute function app.stamp_created_by();

alter table public.matter_reply_addresses enable row level security;
alter table public.matter_reply_addresses force row level security;
alter table public.inbound_emails enable row level security;
alter table public.inbound_emails force row level security;
alter table public.inbound_inbox_items enable row level security;
alter table public.inbound_inbox_items force row level security;
alter table public.inbound_attachment_files enable row level security;
alter table public.inbound_attachment_files force row level security;
alter table public.email_inbound_windows enable row level security;
alter table public.email_inbound_windows force row level security;

create policy matter_reply_addresses_select on public.matter_reply_addresses
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.staff_mfa_satisfied())
    and (select app.has_org_role(
      organization_id,
      array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[]
    ))
  );

create policy inbound_emails_select on public.inbound_emails
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.staff_mfa_satisfied())
    and (select app.has_org_role(
      organization_id,
      array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[]
    ))
  );

create policy inbound_inbox_items_select on public.inbound_inbox_items
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.staff_mfa_satisfied())
    and (select app.has_org_role(
      organization_id,
      array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[]
    ))
  );

create policy inbound_attachment_files_select on public.inbound_attachment_files
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.staff_mfa_satisfied())
    and (select app.has_org_role(
      organization_id,
      array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[]
    ))
  );

create policy email_inbound_windows_select on public.email_inbound_windows
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.staff_mfa_satisfied())
    and (select app.has_org_role(
      organization_id,
      array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[]
    ))
  );

-- Service-role email intake. An authenticated caller cannot set this by GUC alone:
-- the JWT role must be service_role, which only the service key carries.
create function app.email_ingest_org()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  raw text;
begin
  if coalesce(current_setting('app.email_ingest', true), '') is distinct from '1' then
    return null;
  end if;
  if coalesce((select auth.jwt() ->> 'role'), '') is distinct from 'service_role' then
    return null;
  end if;
  raw := nullif(current_setting('app.organization_id', true), '');
  if raw is null or raw !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return null;
  end if;
  return raw::uuid;
end;
$$;
revoke all on function app.email_ingest_org() from public;

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
  return app.staff_mfa_satisfied()
     and app.mfa_step_up_satisfied()
     and app.has_org_role(
       matter.organization_id,
       array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[]
     )
     and app.can_read_matter(matter.id);
end;
$$;

create or replace function app.complete_document_upload(
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
  ingest_org uuid;
begin
  select * into version from public.document_versions where id = p_version_id for update;
  ingest_org := app.email_ingest_org();
  if ingest_org is not null then
    if version.id is null
       or version.organization_id is distinct from ingest_org
       or version.created_by is not null then
      raise exception 'document upload denied' using errcode = '42501';
    end if;
  elsif version.id is null
     or version.organization_id is distinct from (select app.current_organization_id())
     or app.can_read_document_version(version.id) is distinct from true
     or version.created_by is distinct from (select auth.uid()) then
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

create function app.inbound_domain(p_override text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  domain text;
begin
  domain := lower(btrim(coalesce(
    nullif(p_override, ''),
    (select value ->> 'domain' from public.product_settings where key = 'email.inbound_domain'),
    'docs.casevoya.ca'
  )));
  if domain !~ '^[a-z0-9]([a-z0-9.-]{0,188}[a-z0-9])?$' then
    domain := 'docs.casevoya.ca';
  end if;
  return domain;
end;
$$;
revoke all on function app.inbound_domain(text) from public;

create function app.firm_reply_address(p_org uuid, p_matter uuid, p_domain text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  slug text;
  token text;
  domain text := app.inbound_domain(p_domain);
begin
  select organizations.slug into slug from public.organizations where id = p_org;
  if slug is null then
    raise exception 'firm was not found' using errcode = '42501';
  end if;
  if p_matter is null then
    return slug || '@' || domain;
  end if;
  insert into public.matter_reply_addresses (organization_id, matter_id, token)
  values (p_org, p_matter, encode(extensions.gen_random_bytes(16), 'hex'))
  on conflict (organization_id, matter_id) do nothing;
  select reply.token into token
  from public.matter_reply_addresses reply
  where reply.organization_id = p_org
    and reply.matter_id = p_matter;
  return slug || '+' || token || '@' || domain;
end;
$$;
revoke all on function app.firm_reply_address(uuid, uuid, text) from public;

create function app.resolve_inbound_address(p_to text, p_domain text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  raw text := lower(btrim(coalesce(p_to, '')));
  domain text := app.inbound_domain(p_domain);
  local_part text;
  firm_slug text;
  token text;
  org uuid;
  matter uuid;
begin
  if strpos(raw, '@') = 0 or split_part(raw, '@', 2) is distinct from domain or split_part(raw, '@', 3) <> '' then
    return jsonb_build_object('status', 'bad_address');
  end if;
  local_part := split_part(raw, '@', 1);
  if local_part ~ '^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])\+[a-f0-9]{32}$' then
    firm_slug := split_part(local_part, '+', 1);
    token := split_part(local_part, '+', 2);
  elsif local_part ~ '^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$' then
    firm_slug := local_part;
    token := null;
  else
    return jsonb_build_object('status', 'bad_address');
  end if;
  if firm_slug = any (app.reserved_firm_slugs()) then
    return jsonb_build_object('status', 'reserved', 'slug', firm_slug);
  end if;
  select id into org from public.organizations where organizations.slug = firm_slug;
  if org is null then
    return jsonb_build_object('status', 'unknown_firm', 'slug', firm_slug);
  end if;
  if token is not null then
    select reply.matter_id into matter
    from public.matter_reply_addresses reply
    where reply.organization_id = org
      and reply.token = token;
  end if;
  return jsonb_build_object(
    'status', 'ok',
    'organization_id', org,
    'matter_id', matter,
    'slug', firm_slug
  );
end;
$$;
revoke all on function app.resolve_inbound_address(text, text) from public;

create function app.match_inbound_sender(p_org uuid, p_matter uuid, p_from text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  normalized text := lower(btrim(coalesce(p_from, '')));
  found uuid;
  people integer;
  matters integer;
begin
  if normalized !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return null;
  end if;
  if p_matter is not null then
    select count(*)::integer, min(person.id::text)::uuid
      into people, found
    from public.persons person
    join public.matter_participants party
      on party.person_id = person.id
     and party.matter_id = p_matter
     and party.organization_id = p_org
    where person.organization_id = p_org
      and person.email = normalized;
    if people = 1 then
      return found;
    end if;
    return null;
  end if;
  select count(distinct person.id)::integer,
         count(distinct party.matter_id)::integer,
         min(person.id::text)::uuid
    into people, matters, found
  from public.persons person
  join public.matter_participants party
    on party.person_id = person.id
   and party.organization_id = p_org
  where person.organization_id = p_org
    and person.email = normalized;
  if people = 1 and matters = 1 then
    return found;
  end if;
  return null;
end;
$$;
revoke all on function app.match_inbound_sender(uuid, uuid, text) from public;

create function app.queue_email_delivery(
  p_event_id uuid,
  p_org uuid,
  p_email text,
  p_template public.email_template,
  p_matter uuid,
  p_critical boolean,
  p_context jsonb,
  p_send boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized text := lower(btrim(coalesce(p_email, '')));
  suppressed boolean;
  delivery_id uuid;
  next_status public.email_delivery_status;
  inserted boolean;
begin
  if normalized !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(normalized) > 320 then
    return null;
  end if;
  select exists (
    select 1
    from public.email_suppressions suppression
    where suppression.organization_id = p_org
      and suppression.recipient_email = normalized
  ) into suppressed;
  next_status := case
    when suppressed then 'suppressed'::public.email_delivery_status
    when p_send is distinct from true then 'skipped'::public.email_delivery_status
    else 'sending'::public.email_delivery_status
  end;

  insert into public.email_deliveries (
    organization_id, outbox_event_id, recipient_email, template, status,
    matter_id, critical, context, attempt_count
  ) values (
    p_org, p_event_id, normalized, p_template, next_status,
    p_matter, coalesce(p_critical, false), coalesce(p_context, '{}'::jsonb),
    case when next_status = 'sending' then 1 else 0 end
  )
  on conflict (organization_id, outbox_event_id, recipient_email) do update
    set status = case
          when public.email_deliveries.status in ('sent', 'queued', 'bounced', 'suppressed', 'skipped')
            then public.email_deliveries.status
          else excluded.status
        end,
        matter_id = excluded.matter_id,
        critical = excluded.critical,
        context = excluded.context,
        attempt_count = case
          when public.email_deliveries.status = 'sending' then public.email_deliveries.attempt_count
          when public.email_deliveries.status in ('sent', 'queued', 'bounced', 'suppressed', 'skipped')
            then public.email_deliveries.attempt_count
          when excluded.status = 'sending' then public.email_deliveries.attempt_count + 1
          else public.email_deliveries.attempt_count
        end
  returning id, status, (xmax = 0) into delivery_id, next_status, inserted;

  if inserted and next_status in ('suppressed', 'skipped') then
    perform app.record_audit_event(
      p_org,
      case when next_status = 'suppressed' then 'email.suppressed' else 'email.skipped' end,
      'public.email_deliveries',
      delivery_id,
      case when next_status = 'suppressed' then 'denied' else 'success' end,
      jsonb_build_object('template', p_template, 'recipient_email', normalized)
    );
  end if;
  if next_status = 'sending' then
    return delivery_id;
  end if;
  return null;
end;
$$;
revoke all on function app.queue_email_delivery(uuid, uuid, text, public.email_template, uuid, boolean, jsonb, boolean) from public;

create function public.prepare_email_delivery(
  p_event_id uuid,
  p_worker text,
  p_inbound_domain text default null,
  p_from_address text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  event public.outbox_events%rowtype;
  firm_name text;
  firm_slug text;
  domain text;
  from_addr text;
  matter uuid;
  template public.email_template;
  critical boolean;
  reply text;
  messages jsonb;
  rec record;
  send_ok boolean;
  ctx jsonb;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') is distinct from 'service_role' then
    raise exception 'worker role required' using errcode = '42501';
  end if;
  select * into event from public.outbox_events where id = p_event_id;
  if event.id is null then
    raise exception 'mail event was not found' using errcode = '42501';
  end if;
  if event.status = 'published' then
    return jsonb_build_object('action', 'done', 'event_id', event.id, 'messages', '[]'::jsonb);
  end if;
  if event.status is distinct from 'processing'
     or event.locked_by is distinct from left(btrim(coalesce(p_worker, '')), 200) then
    raise exception 'mail event is not claimed' using errcode = '42501';
  end if;

  domain := app.inbound_domain(p_inbound_domain);
  from_addr := lower(btrim(coalesce(
    nullif(p_from_address, ''),
    (select value ->> 'address' from public.product_settings where key = 'email.from_address'),
    'notices@casevoya.ca'
  )));
  if from_addr !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    from_addr := 'notices@casevoya.ca';
  end if;
  select display_name, slug into firm_name, firm_slug
  from public.organizations
  where id = event.organization_id;

  matter := null;
  if coalesce(event.payload ->> 'matter_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    matter := (event.payload ->> 'matter_id')::uuid;
  end if;

  if event.event_type = 'document.reviewed'
     and coalesce(event.payload ->> 'decision', '') is distinct from 'accepted' then
    perform app.mark_outbox_published(event.id, p_worker);
    perform app.record_audit_event(
      event.organization_id, 'email.skipped', 'public.outbox_events', event.id, 'success',
      jsonb_build_object('reason', 'review_not_accepted')
    );
    return jsonb_build_object('action', 'done', 'event_id', event.id, 'messages', '[]'::jsonb);
  end if;

  template := case event.event_type
    when 'portal_invitation.email_requested' then 'invite'::public.email_template
    when 'staff_invitation.email_requested' then 'invite'::public.email_template
    when 'reminder.due' then 'reminder'::public.email_template
    when 'agreement.sent' then 'agreement'::public.email_template
    when 'agreement.executed' then 'signature'::public.email_template
    when 'document.request_created' then 'document_request'::public.email_template
    when 'document.uploaded' then 'document_receipt'::public.email_template
    when 'document.reviewed' then 'document_receipt'::public.email_template
    else null
  end;
  if template is null then
    raise exception 'event is not a mail event' using errcode = '22023';
  end if;

  critical := template in ('invite', 'agreement', 'signature', 'document_request', 'document_receipt');
  ctx := jsonb_build_object('firm', firm_name, 'template', template);

  if event.event_type = 'portal_invitation.email_requested' then
    ctx := ctx || jsonb_build_object('kind', 'portal', 'role', event.payload ->> 'role');
    perform app.queue_email_delivery(
      event.id, event.organization_id, event.payload ->> 'recipient_email',
      template, matter, true, ctx, true
    );
  elsif event.event_type = 'staff_invitation.email_requested' then
    ctx := ctx || jsonb_build_object('kind', 'staff', 'role', event.payload ->> 'role');
    perform app.queue_email_delivery(
      event.id, event.organization_id, event.payload ->> 'recipient_email',
      template, null, true, ctx, true
    );
  elsif event.event_type = 'reminder.due' then
    critical := coalesce(event.payload ->> 'reminder_kind', '') = 'immediate'
      or exists (
        select 1
        from public.deadlines deadline
        where deadline.id::text = event.payload ->> 'deadline_id'
          and deadline.kind in ('legal', 'correspondence')
      );
    ctx := ctx || jsonb_build_object(
      'reminder_kind', coalesce(event.payload ->> 'reminder_kind', 'routine'),
      'due_on', (
        select to_char(deadline.due_on, 'YYYY-MM-DD')
        from public.deadlines deadline
        where deadline.id::text = event.payload ->> 'deadline_id'
      )
    );
    for rec in
      select person.email,
             coalesce(pref.deadline_reminders, false) as deadline_reminders,
             pref.email_notices as email_notices
      from public.persons person
      join public.matter_participants party
        on party.person_id = person.id
       and party.matter_id = matter
       and party.organization_id = event.organization_id
      left join public.person_contact_preferences pref
        on pref.person_id = person.id
      where person.organization_id = event.organization_id
        and person.email is not null
        and matter is not null
    loop
      send_ok := coalesce(event.payload ->> 'reminder_kind', '') = 'immediate'
        or (rec.deadline_reminders and rec.email_notices is distinct from false);
      perform app.queue_email_delivery(
        event.id, event.organization_id, rec.email, template, matter, critical, ctx, send_ok
      );
    end loop;
  elsif event.event_type in ('agreement.sent', 'agreement.executed') then
    ctx := ctx || jsonb_build_object('agreement_kind', (
      select agreement.kind
      from public.signature_envelopes envelope
      join public.agreements agreement on agreement.id = envelope.agreement_id
      where envelope.id::text = event.payload ->> 'envelope_id'
    ));
    for rec in
      select lower(coalesce(person.email, users.email)) as email
      from public.envelope_signers signer
      left join public.persons person on person.id = signer.person_id
      left join public.memberships membership on membership.id = signer.membership_id
      left join auth.users users on users.id = membership.user_id
      where signer.envelope_id::text = event.payload ->> 'envelope_id'
        and signer.organization_id = event.organization_id
    loop
      perform app.queue_email_delivery(
        event.id, event.organization_id, rec.email, template, matter, true, ctx, true
      );
    end loop;
  elsif event.event_type = 'document.request_created' then
    ctx := ctx || jsonb_build_object(
      'purpose', left(coalesce(event.payload ->> 'purpose', ''), 200),
      'due_on', event.payload ->> 'due_on'
    );
    perform app.queue_email_delivery(
      event.id, event.organization_id,
      (select person.email from public.persons person where person.id::text = event.payload ->> 'person_id'),
      template, matter, true, ctx, true
    );
  elsif event.event_type in ('document.uploaded', 'document.reviewed') then
    perform app.queue_email_delivery(
      event.id, event.organization_id,
      (
        select person.email
        from public.documents doc
        join public.persons person on person.id = doc.person_id
        where doc.id::text = event.payload ->> 'document_id'
      ),
      template, matter, true, ctx, true
    );
  end if;

  if not exists (
    select 1 from public.email_deliveries delivery
    where delivery.outbox_event_id = event.id
      and delivery.status = 'sending'
  ) then
    perform app.mark_outbox_published(event.id, p_worker);
    perform app.record_audit_event(
      event.organization_id, 'email.skipped', 'public.outbox_events', event.id, 'success',
      jsonb_build_object('template', template, 'reason', 'no_recipient')
    );
    return jsonb_build_object('action', 'done', 'event_id', event.id, 'messages', '[]'::jsonb);
  end if;

  reply := app.firm_reply_address(event.organization_id, matter, domain);
  select coalesce(jsonb_agg(jsonb_build_object(
    'delivery_id', delivery.id,
    'to', delivery.recipient_email,
    'from_address', from_addr,
    'from_name', firm_name,
    'reply_to_address', reply,
    'reply_to_name', firm_name,
    'template', delivery.template,
    'context', delivery.context
  )), '[]'::jsonb)
  into messages
  from public.email_deliveries delivery
  where delivery.outbox_event_id = event.id
    and delivery.status = 'sending';

  return jsonb_build_object('action', 'send', 'event_id', event.id, 'messages', messages);
end;
$$;

create function public.finish_email_delivery(
  p_delivery_id uuid,
  p_worker text,
  p_outcome text,
  p_provider_message_id text default null,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  delivery public.email_deliveries%rowtype;
  event public.outbox_events%rowtype;
  owner uuid;
  next_status public.email_delivery_status;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') is distinct from 'service_role' then
    raise exception 'worker role required' using errcode = '42501';
  end if;
  if p_outcome is null or p_outcome not in ('sent', 'queued', 'bounced', 'suppressed', 'retry', 'terminal_failure') then
    raise exception 'delivery outcome is invalid' using errcode = '22023';
  end if;
  select * into delivery from public.email_deliveries where id = p_delivery_id for update;
  if delivery.id is null then
    raise exception 'delivery was not found' using errcode = '42501';
  end if;
  select * into event from public.outbox_events where id = delivery.outbox_event_id;
  if event.status = 'published' or delivery.status in ('sent', 'queued', 'bounced', 'suppressed', 'skipped') then
    return;
  end if;
  if event.locked_by is distinct from left(btrim(coalesce(p_worker, '')), 200) then
    raise exception 'mail event is not claimed' using errcode = '42501';
  end if;

  if p_outcome = 'retry' then
    update public.email_deliveries
       set status = 'failed', last_error = left(coalesce(p_error, 'retry'), 500)
     where id = delivery.id;
    perform app.mark_outbox_failed(event.id, p_worker, coalesce(p_error, 'retry'), 8);
    perform app.record_audit_event(
      delivery.organization_id, 'email.failed', 'public.email_deliveries', delivery.id, 'failure',
      jsonb_build_object('template', delivery.template, 'retry', true)
    );
    return;
  end if;
  if p_outcome = 'terminal_failure' then
    update public.email_deliveries
       set status = 'failed', last_error = left(coalesce(p_error, 'rejected'), 500)
     where id = delivery.id;
    perform app.mark_outbox_failed(event.id, p_worker, coalesce(p_error, 'rejected'), 1);
    perform app.record_audit_event(
      delivery.organization_id, 'email.failed', 'public.email_deliveries', delivery.id, 'failure',
      jsonb_build_object('template', delivery.template, 'retry', false)
    );
    return;
  end if;

  next_status := p_outcome::public.email_delivery_status;
  update public.email_deliveries
     set status = next_status,
         provider_message_id = left(nullif(btrim(coalesce(p_provider_message_id, '')), ''), 200),
         last_error = case when p_outcome = 'bounced' then left(coalesce(p_error, 'bounced'), 500) else null end
   where id = delivery.id;

  if p_outcome = 'bounced' then
    insert into public.email_suppressions (organization_id, recipient_email, reason)
    values (delivery.organization_id, delivery.recipient_email, 'hard_bounce')
    on conflict (organization_id, recipient_email) do nothing;
    if delivery.critical and delivery.matter_id is not null then
      select membership.id into owner
      from public.memberships membership
      where membership.organization_id = delivery.organization_id
        and membership.role = 'firm_owner'
        and membership.status = 'active'
      order by membership.created_at
      limit 1;
      if owner is not null then
        with opened as (
          insert into public.tasks (
            organization_id, matter_id, audience, title, priority, status,
            owner_membership_id, task_key, due_timezone, checklist
          ) values (
            delivery.organization_id, delivery.matter_id, 'internal',
            'Email was not delivered', 'critical', 'open',
            owner, 'email_delivery_failure', 'America/Toronto', '[]'::jsonb
          )
          on conflict (organization_id) where task_key = 'email_delivery_failure' and status in ('open', 'blocked')
          do nothing
          returning id, organization_id
        )
        insert into public.task_events (organization_id, task_id, event_kind, to_status)
        select opened.organization_id, opened.id, 'created', 'open'::public.task_status
        from opened;
      end if;
    end if;
  end if;

  perform app.record_audit_event(
    delivery.organization_id,
    case p_outcome
      when 'sent' then 'email.sent'
      when 'queued' then 'email.sent'
      when 'bounced' then 'email.bounced'
      else 'email.suppressed'
    end,
    'public.email_deliveries',
    delivery.id,
    case when p_outcome in ('sent', 'queued') then 'success' when p_outcome = 'bounced' then 'failure' else 'denied' end,
    jsonb_build_object(
      'template', delivery.template,
      'recipient_email', delivery.recipient_email,
      'provider_message_id', left(coalesce(p_provider_message_id, ''), 200)
    )
  );

  if not exists (
    select 1
    from public.email_deliveries pending
    where pending.outbox_event_id = event.id
      and pending.status in ('pending', 'sending', 'failed')
  ) then
    perform app.mark_outbox_published(event.id, p_worker);
  end if;
end;
$$;

revoke all on function public.prepare_email_delivery(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.prepare_email_delivery(uuid, text, text, text) to service_role;
revoke all on function public.finish_email_delivery(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.finish_email_delivery(uuid, text, text, text, text) to service_role;

create function public.begin_inbound_message(
  p_to text,
  p_from text,
  p_message_id text,
  p_subject text,
  p_text text,
  p_html text,
  p_domain text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolved jsonb;
  org uuid;
  matter uuid;
  person uuid;
  existing public.inbound_emails%rowtype;
  limit_hits integer;
  bucket timestamptz := date_trunc('hour', statement_timestamp());
  current_hits integer;
  body_text text;
  stored_in_messages boolean := false;
  new_id uuid;
  cols text;
  vals text;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') is distinct from 'service_role' then
    raise exception 'worker role required' using errcode = '42501';
  end if;
  if p_message_id is null or length(btrim(p_message_id)) < 1 then
    raise exception 'message id is required' using errcode = '22023';
  end if;
  resolved := app.resolve_inbound_address(p_to, p_domain);
  if resolved ->> 'status' is distinct from 'ok' then
    return resolved;
  end if;
  org := (resolved ->> 'organization_id')::uuid;
  if coalesce(resolved ->> 'matter_id', '') ~* '^[0-9a-f-]{36}$' then
    matter := (resolved ->> 'matter_id')::uuid;
  end if;
  person := app.match_inbound_sender(org, matter, p_from);
  if matter is null and person is not null then
    select party.matter_id into matter
    from public.matter_participants party
    where party.person_id = person
      and party.organization_id = org
    limit 1;
  end if;

  select * into existing
  from public.inbound_emails email
  where email.organization_id = org
    and email.message_id = left(btrim(p_message_id), 500);
  if existing.id is not null then
    return jsonb_build_object(
      'status', case when existing.attachments_done then 'duplicate' else 'resume' end,
      'inbound_email_id', existing.id,
      'organization_id', existing.organization_id,
      'matter_id', existing.matter_id,
      'person_id', existing.person_id,
      'attachments_done', existing.attachments_done
    );
  end if;

  select coalesce((value ->> 'messages')::integer, 30)
    into limit_hits
  from public.product_settings
  where key = 'email.inbound_hourly_limit';
  limit_hits := least(greatest(coalesce(limit_hits, 30), 1), 1000);
  select hits into current_hits
  from public.email_inbound_windows hour_row
  where hour_row.organization_id = org
    and hour_row.hour_bucket = bucket
  for update;
  if coalesce(current_hits, 0) >= limit_hits then
    perform app.record_audit_event(
      org, 'email.rejected', 'public.inbound_emails', null::uuid, 'denied',
      jsonb_build_object('reason', 'rate_limit')
    );
    return jsonb_build_object('status', 'rate_limited', 'organization_id', org);
  end if;
  insert into public.email_inbound_windows (organization_id, hour_bucket, hits)
  values (org, bucket, 1)
  on conflict (organization_id, hour_bucket) do update
    set hits = public.email_inbound_windows.hits + 1;

  body_text := left(coalesce(nullif(btrim(p_text), ''), ''), 100000);
  if matter is not null
     and to_regclass('public.messages') is not null
     and exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'messages' and column_name = 'organization_id'
     )
     and exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'messages' and column_name = 'matter_id'
     )
     and exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'messages' and column_name = 'body'
     ) then
    cols := 'organization_id, matter_id, body';
    vals := '$1, $2, $3';
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'messages' and column_name = 'internal_note'
    ) then
      cols := cols || ', internal_note';
      vals := vals || ', false';
    end if;
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'messages' and column_name = 'audience'
    ) then
      cols := cols || ', audience';
      vals := vals || ', ''external''';
    end if;
    begin
      execute format('insert into public.messages (%s) values (%s)', cols, vals)
        using org, matter, coalesce(nullif(body_text, ''), '(no text)');
      stored_in_messages := true;
    exception
      when not_null_violation or check_violation or datatype_mismatch or invalid_text_representation then
        stored_in_messages := false;
    end;
  end if;

  insert into public.inbound_emails (
    organization_id, message_id, from_email, to_email, subject,
    text_body, html_body, body_location, matter_id, person_id
  ) values (
    org,
    left(btrim(p_message_id), 500),
    left(lower(btrim(coalesce(p_from, 'unknown@example.test'))), 320),
    left(lower(btrim(p_to)), 320),
    left(nullif(btrim(coalesce(p_subject, '')), ''), 300),
    case when stored_in_messages then null else nullif(body_text, '') end,
    case when stored_in_messages then null else left(nullif(btrim(coalesce(p_html, '')), ''), 200000) end,
    case when stored_in_messages then 'messages' else 'inbound_emails' end,
    matter,
    person
  )
  returning id into new_id;

  perform app.record_audit_event(
    org, 'email.received', 'public.inbound_emails', new_id, 'success',
    jsonb_build_object('message_id', left(btrim(p_message_id), 200), 'body_location',
      case when stored_in_messages then 'messages' else 'inbound_emails' end)
  );
  return jsonb_build_object(
    'status', 'accepted',
    'inbound_email_id', new_id,
    'organization_id', org,
    'matter_id', matter,
    'person_id', person,
    'attachments_done', false
  );
end;
$$;

create function public.create_email_upload_intent(
  p_inbound_id uuid,
  p_ordinal integer,
  p_filename text,
  p_byte_size bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  email public.inbound_emails%rowtype;
  link public.inbound_attachment_files%rowtype;
  version public.document_versions%rowtype;
  intent jsonb;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') is distinct from 'service_role' then
    raise exception 'worker role required' using errcode = '42501';
  end if;
  if p_ordinal is null or p_ordinal < 0 or p_ordinal > 19 then
    raise exception 'attachment ordinal is invalid' using errcode = '22023';
  end if;
  select * into email from public.inbound_emails where id = p_inbound_id;
  if email.id is null or email.person_id is null or email.matter_id is null then
    raise exception 'this message is not linked to a person' using errcode = '42501';
  end if;
  select * into link
  from public.inbound_attachment_files
  where inbound_email_id = email.id
    and ordinal = p_ordinal;
  if link.version_id is not null then
    select * into version from public.document_versions where id = link.version_id;
    return jsonb_build_object(
      'document_id', version.document_id,
      'version_id', version.id,
      'storage_bucket', 'documents',
      'storage_key', version.storage_key,
      'already_complete', version.upload_state is distinct from 'uploading'
    );
  end if;
  perform set_config('app.email_ingest', '1', true);
  perform set_config('app.organization_id', email.organization_id::text, true);
  intent := app.create_upload_intent(
    email.matter_id, email.person_id, btrim(p_filename), p_byte_size, 'Email attachment',
    'ordinary'::public.document_sensitivity, 'subject'::public.document_audience,
    null, null, null
  );
  insert into public.inbound_attachment_files (
    organization_id, inbound_email_id, ordinal, filename, byte_size, version_id, storage_key
  ) values (
    email.organization_id, email.id, p_ordinal, btrim(p_filename), p_byte_size,
    (intent ->> 'version_id')::uuid, intent ->> 'storage_key'
  );
  return intent || jsonb_build_object('already_complete', false);
end;
$$;

create function public.complete_email_upload(
  p_inbound_id uuid,
  p_ordinal integer,
  p_sha256 text,
  p_header_hex text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  email public.inbound_emails%rowtype;
  link public.inbound_attachment_files%rowtype;
  result jsonb;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') is distinct from 'service_role' then
    raise exception 'worker role required' using errcode = '42501';
  end if;
  select * into email from public.inbound_emails where id = p_inbound_id;
  select * into link
  from public.inbound_attachment_files
  where inbound_email_id = p_inbound_id
    and ordinal = p_ordinal;
  if email.id is null or link.version_id is null then
    raise exception 'attachment was not started' using errcode = '42501';
  end if;
  perform set_config('app.email_ingest', '1', true);
  perform set_config('app.organization_id', email.organization_id::text, true);
  result := app.complete_document_upload(link.version_id, p_sha256, p_header_hex);
  return result;
end;
$$;

create function public.open_unsorted_email_file(
  p_inbound_id uuid,
  p_ordinal integer,
  p_filename text,
  p_byte_size bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  email public.inbound_emails%rowtype;
  link public.inbound_attachment_files%rowtype;
  item public.inbound_inbox_items%rowtype;
  media text;
  item_id uuid;
  storage_key text;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') is distinct from 'service_role' then
    raise exception 'worker role required' using errcode = '42501';
  end if;
  if p_ordinal is null or p_ordinal < 0 or p_ordinal > 19 then
    raise exception 'attachment ordinal is invalid' using errcode = '22023';
  end if;
  select * into email from public.inbound_emails where id = p_inbound_id;
  if email.id is null then
    raise exception 'message was not found' using errcode = '42501';
  end if;
  if email.person_id is not null then
    raise exception 'this message is linked to a person' using errcode = '22023';
  end if;
  select * into link
  from public.inbound_attachment_files
  where inbound_email_id = email.id and ordinal = p_ordinal;
  if link.inbox_item_id is not null then
    select * into item from public.inbound_inbox_items where id = link.inbox_item_id;
    return jsonb_build_object(
      'inbox_item_id', item.id,
      'storage_bucket', 'documents',
      'storage_key', item.storage_key,
      'already_complete', item.upload_state is distinct from 'uploading'
    );
  end if;
  media := app.media_type_for_filename(p_filename);
  if media is null then
    raise exception 'use a PDF, JPEG, PNG, HEIC, or DOCX file' using errcode = '22023';
  end if;
  if p_byte_size is null or p_byte_size < 1 or p_byte_size > app.document_max_bytes(email.organization_id) then
    raise exception 'file is above the upload limit' using errcode = '22023';
  end if;
  item_id := gen_random_uuid();
  storage_key := email.organization_id::text || '/inbox/' || item_id::text || '/'
    || encode(extensions.gen_random_bytes(16), 'hex');
  insert into public.inbound_inbox_items (
    id, organization_id, inbound_email_id, filename, media_type, byte_size,
    storage_key, upload_state, matter_id
  ) values (
    item_id, email.organization_id, email.id, btrim(p_filename), media, p_byte_size,
    storage_key, 'uploading', email.matter_id
  );
  insert into public.inbound_attachment_files (
    organization_id, inbound_email_id, ordinal, filename, byte_size, inbox_item_id, storage_key
  ) values (
    email.organization_id, email.id, p_ordinal, btrim(p_filename), p_byte_size, item_id, storage_key
  );
  return jsonb_build_object(
    'inbox_item_id', item_id,
    'storage_bucket', 'documents',
    'storage_key', storage_key,
    'already_complete', false
  );
end;
$$;

create function public.finish_unsorted_email_file(
  p_inbound_id uuid,
  p_ordinal integer,
  p_sha256 text,
  p_header_hex text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  item public.inbound_inbox_items%rowtype;
  link public.inbound_attachment_files%rowtype;
  header bytea;
  detected text;
  stored_size bigint;
  next_state text;
  next_result text;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') is distinct from 'service_role' then
    raise exception 'worker role required' using errcode = '42501';
  end if;
  select * into link
  from public.inbound_attachment_files
  where inbound_email_id = p_inbound_id and ordinal = p_ordinal;
  if link.inbox_item_id is null then
    raise exception 'inbox file was not started' using errcode = '42501';
  end if;
  select * into item from public.inbound_inbox_items where id = link.inbox_item_id for update;
  if item.upload_state is distinct from 'uploading' then
    return jsonb_build_object('inbox_item_id', item.id, 'upload_state', item.upload_state, 'scan_result', item.scan_result);
  end if;
  if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'checksum must be a sha256 hex digest' using errcode = '22023';
  end if;
  if p_header_hex is null or p_header_hex !~ '^[0-9a-f]+$' or length(p_header_hex) < 16 or length(p_header_hex) > 64 then
    raise exception 'file header is missing' using errcode = '22023';
  end if;
  header := decode(p_header_hex, 'hex');
  detected := app.detect_media_type(header);
  select (metadata ->> 'size')::bigint into stored_size
  from storage.objects
  where bucket_id = 'documents' and name = item.storage_key;
  if stored_size is null then
    raise exception 'stored object was not found' using errcode = '22023';
  end if;
  if stored_size <> item.byte_size or stored_size > app.document_max_bytes(item.organization_id) then
    next_state := 'failed';
    next_result := 'size_mismatch';
  elsif detected is null then
    next_state := 'failed';
    next_result := 'unrecognized_type';
  elsif detected is distinct from item.media_type then
    next_state := 'quarantined';
    next_result := 'extension_mismatch';
  elsif app.product_setting_enabled('documents.accept_structural_inspection') then
    next_state := 'clean';
    next_result := 'structural_only';
  else
    next_state := 'uploading';
    next_result := 'awaiting_scanner';
  end if;
  update public.inbound_inbox_items
     set upload_state = next_state, scan_result = next_result, sha256 = p_sha256
   where id = item.id;
  return jsonb_build_object('inbox_item_id', item.id, 'upload_state', next_state, 'scan_result', next_result);
end;
$$;

create function public.finish_inbound_attachments(p_inbound_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce((select auth.jwt() ->> 'role'), '') is distinct from 'service_role' then
    raise exception 'worker role required' using errcode = '42501';
  end if;
  update public.inbound_emails
     set attachments_done = true
   where id = p_inbound_id;
end;
$$;

create function public.assign_unsorted_email_file(
  p_item_id uuid,
  p_matter_id uuid,
  p_person_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  item public.inbound_inbox_items%rowtype;
  intent jsonb;
begin
  select * into item from public.inbound_inbox_items where id = p_item_id;
  if item.id is null then
    raise exception 'inbox file was not found' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    item.organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[],
    true
  );
  if item.upload_state is distinct from 'clean' then
    raise exception 'only a clean inbox file can be assigned' using errcode = '42501';
  end if;
  if item.assigned_version_id is not null then
    raise exception 'inbox file is already assigned' using errcode = '42501';
  end if;
  intent := app.create_upload_intent(
    p_matter_id, p_person_id, item.filename, item.byte_size, 'Email attachment',
    'ordinary'::public.document_sensitivity, 'subject'::public.document_audience,
    null, null, null
  );
  update public.inbound_inbox_items
     set assigned_version_id = (intent ->> 'version_id')::uuid
   where id = item.id;
  return intent || jsonb_build_object('source_storage_key', item.storage_key, 'inbox_item_id', item.id);
end;
$$;

create function public.complete_unsorted_assignment(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  item public.inbound_inbox_items%rowtype;
  version public.document_versions%rowtype;
begin
  select * into item from public.inbound_inbox_items where id = p_item_id for update;
  if item.id is null or item.assigned_version_id is null then
    raise exception 'inbox file was not found' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    item.organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[],
    true
  );
  select * into version from public.document_versions where id = item.assigned_version_id;
  if version.upload_state is distinct from 'clean' then
    raise exception 'assigned upload is not clean' using errcode = '42501';
  end if;
  update public.inbound_inbox_items
     set upload_state = 'assigned'
   where id = item.id;
end;
$$;

revoke all on function public.begin_inbound_message(text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.begin_inbound_message(text, text, text, text, text, text, text) to service_role;
revoke all on function public.create_email_upload_intent(uuid, integer, text, bigint) from public, anon, authenticated;
grant execute on function public.create_email_upload_intent(uuid, integer, text, bigint) to service_role;
revoke all on function public.complete_email_upload(uuid, integer, text, text) from public, anon, authenticated;
grant execute on function public.complete_email_upload(uuid, integer, text, text) to service_role;
revoke all on function public.open_unsorted_email_file(uuid, integer, text, bigint) from public, anon, authenticated;
grant execute on function public.open_unsorted_email_file(uuid, integer, text, bigint) to service_role;
revoke all on function public.finish_unsorted_email_file(uuid, integer, text, text) from public, anon, authenticated;
grant execute on function public.finish_unsorted_email_file(uuid, integer, text, text) to service_role;
revoke all on function public.finish_inbound_attachments(uuid) from public, anon, authenticated;
grant execute on function public.finish_inbound_attachments(uuid) to service_role;
revoke all on function public.assign_unsorted_email_file(uuid, uuid, uuid) from public, anon;
grant execute on function public.assign_unsorted_email_file(uuid, uuid, uuid) to authenticated, service_role;
revoke all on function public.complete_unsorted_assignment(uuid) from public, anon;
grant execute on function public.complete_unsorted_assignment(uuid) to authenticated, service_role;

grant select on table public.matter_reply_addresses to authenticated;
grant select on table public.inbound_emails to authenticated;
grant select on table public.inbound_inbox_items to authenticated;
grant select on table public.inbound_attachment_files to authenticated;
grant select on table public.email_inbound_windows to authenticated;
