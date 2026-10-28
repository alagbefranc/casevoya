-- #263-B virus scanning for uploads (Francis approved 2026-10-28).
--
-- The switch is the existing product setting documents.accept_structural_inspection
-- (20261017180000). While it is true (today, and the default after this migration) nothing
-- changes: a file whose type, size and extension check out is 'clean' with scan_engine
-- 'structural_only' ("Type checked, not virus-scanned"). Set it to false once the scanner
-- (services/av-scanner, ClamAV in a Cloudflare Container) is deployed and bound to the app
-- Worker as AV_SCANNER. From then on finish_verified_document_upload (unchanged) leaves every
-- new upload in 'scanning', and only the scanner path below can move it on:
--
--   public.service_claim_document_scans(limit, version, backfill)   service_role
--     claims due versions (FOR UPDATE SKIP LOCKED), counts the attempt, and leases them for
--     lease_seconds so two runners never scan the same file at once.
--   public.service_record_document_scan(version, outcome, signature, engine)   service_role
--     clean    -> 'clean', scan_engine 'worker'; document.uploaded is enqueued now (the client's
--                 receipt, staff notifications and the rest wait for a clean file);
--                 audit document.scan_clean.
--     infected -> 'quarantined', scan_result 'infected', scan_signature; document.quarantined
--                 enqueued; audit document.scan_infected (denied) with the signature; staff
--                 notified (staff_notification_items 'document_blocked').
--     error    -> stays 'scanning', next attempt after base_seconds * 2^(attempt-1); after
--                 max_attempts -> 'scan_failed' (audit document.scan_failed, staff notified),
--                 retried every failed_retry_seconds. Never 'clean' without a scan.
--   app.kick_document_scans()   pg_cron every minute, only while a scan is due: POSTs
--     /api/documents/scan/run with the dispatch bearer, like the scheduled reports runner.
--
-- Nobody can open a version that isn't 'clean': authorize_document_download (download, preview,
-- Vo), the storage read policy and the exports already require upload_state = 'clean', so
-- 'scanning', 'quarantined' and 'scan_failed' are all refused. Only the content is held; the
-- version row (its name and state) stays readable so people see "Checking for viruses…".
--
-- Files stored before the switch keep 'clean' / 'structural_only' and are labelled "Not
-- virus-scanned (uploaded before scanning)". scripts/rescan-legacy-documents.mjs (not run)
-- calls the runner with backfill=true: a legacy file stays open while it is rescanned; clean
-- marks it scanned, infected quarantines it, an error leaves it as it was (retried up to
-- max_attempts). Sealed agreements (scan_result 'in_house_seal', made by Casevoya) are skipped.
--
-- Redefined (each copied from its latest definition; only the noted change):
--   app.apply_document_scan (20261017180000): delegates to service_record_document_scan, so the
--     older worker entry point can no longer turn a quarantined or failed file clean.
--   public.finish_unsorted_email_file (20261017200200): an unsorted email attachment that passes
--     the type check is 'clean' (ready to file) even when virus scanning is on. It is never
--     opened as it is; filing copies it into a document version, which the scanner checks.
--   public.complete_unsorted_assignment (20261017200200): the copied version may still be
--     'scanning'.
--   app.staff_notification_items (20261025320100): a 'document_blocked' branch.
-- Additive only.

-- ---------------------------------------------------------------------------
-- Columns and settings
-- ---------------------------------------------------------------------------

alter table public.document_versions
  add column scan_signature text
    check (scan_signature is null or length(scan_signature) between 1 and 200),
  add column scan_engine_version text
    check (scan_engine_version is null or length(scan_engine_version) between 1 and 120),
  add column scan_attempts integer not null default 0 check (scan_attempts >= 0),
  add column scan_next_attempt_at timestamptz,
  add column scanned_at timestamptz;

comment on column public.document_versions.scan_signature is
  '#263-B: the virus scanner''s signature name when it found a virus (scan_result infected).';
comment on column public.document_versions.scan_engine_version is
  '#263-B: the scanner and signature database that checked the file, as the scanner reports it.';
comment on column public.document_versions.scan_attempts is
  '#263-B: how many times the virus scanner path claimed this version.';
comment on column public.document_versions.scan_next_attempt_at is
  '#263-B: when the scan runner may claim it next (a lease while one runs, then the backoff).';

create index document_versions_scan_due_idx
  on public.document_versions (scan_next_attempt_at)
  where upload_state in ('scanning', 'scan_failed');

insert into public.product_settings (key, value, description, pending_confirmation) values
  (
    'documents.virus_scan_retry',
    '{"max_attempts":6,"base_seconds":60,"lease_seconds":300,"failed_retry_seconds":21600}'::jsonb,
    '#263-B: virus scan retries. A file is tried up to max_attempts times, waiting base_seconds * 2^(attempt-1) after each failure (about 31 minutes in all), then marked scan_failed and tried again every failed_retry_seconds. Chosen, not required.',
    true
  )
on conflict (key) do nothing;

update public.product_settings
set description = 'true: a matching type, size, and extension marks the file clean (structural_only). This is not a malware scan. false (#263-B): every new upload waits in scanning until the virus scanner (services/av-scanner, bound as AV_SCANNER) finds it clean. Turn off only after the scanner is deployed.'
where key = 'documents.accept_structural_inspection';

create function app.document_scan_setting(p_field text, p_default integer)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select (setting.value ->> p_field)::integer
     from public.product_settings setting
     where setting.key = 'documents.virus_scan_retry'),
    p_default
  );
$$;
revoke all on function app.document_scan_setting(text, integer) from public, anon, authenticated;

-- Whether new uploads wait for the virus scanner (the loaders' honest labels).
create function public.document_virus_scan_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.product_setting_enabled('documents.accept_structural_inspection') is distinct from true;
$$;
revoke all on function public.document_virus_scan_enabled() from public, anon;
grant execute on function public.document_virus_scan_enabled() to authenticated, service_role;

-- The matter a version's document is used on (its newest link), for audit context and notices.
create function app.document_version_matter(p_document_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select ref.matter_id
  from public.document_matter_refs ref
  where ref.document_id = p_document_id
    and ref.removed_at is null
  order by ref.created_at desc
  limit 1;
$$;
revoke all on function app.document_version_matter(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Giving up: the scanner couldn't check the file after every retry
-- ---------------------------------------------------------------------------

create function app.document_scan_give_up(p_version_id uuid)
returns public.document_upload_state
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.document_versions%rowtype;
begin
  select * into target from public.document_versions where id = p_version_id;
  if target.id is null or target.upload_state is distinct from 'scanning' then
    return target.upload_state;
  end if;
  perform app.open_document_write(target.id);
  update public.document_versions
  set upload_state = 'scan_failed',
      scan_result = 'scanner_unavailable',
      quarantine_reason = 'the virus check could not run',
      scan_next_attempt_at = statement_timestamp()
        + make_interval(secs => app.document_scan_setting('failed_retry_seconds', 21600))
  where id = target.id;
  perform app.close_document_write(target.id);
  perform app.record_audit_event(
    target.organization_id,
    'document.scan_failed',
    'document_versions',
    target.id,
    'denied',
    jsonb_build_object(
      'document_id', target.document_id,
      'matter_id', app.document_version_matter(target.document_id),
      'attempts', target.scan_attempts
    )
  );
  return 'scan_failed'::public.document_upload_state;
end;
$$;
revoke all on function app.document_scan_give_up(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Claim: the versions the runner scans now
-- ---------------------------------------------------------------------------

create function app.service_claim_document_scans(
  p_limit integer,
  p_version_id uuid,
  p_backfill boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  max_attempts integer := app.document_scan_setting('max_attempts', 6);
  lease integer := app.document_scan_setting('lease_seconds', 300);
  backfill boolean := coalesce(p_backfill, false);
  due public.document_versions%rowtype;
  claimed jsonb := '[]'::jsonb;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') is distinct from 'service_role' then
    raise exception 'worker role required' using errcode = '42501';
  end if;
  for due in
    select v.*
    from public.document_versions v
    where (p_version_id is null or v.id = p_version_id)
      and coalesce(v.scan_next_attempt_at, '-infinity'::timestamptz) <= statement_timestamp()
      and (
        (not backfill and v.upload_state in ('scanning', 'scan_failed'))
        or (
          backfill
          and v.upload_state = 'clean'
          and v.scan_engine = 'structural_only'
          and v.scan_result is distinct from 'in_house_seal'
          and v.scan_attempts < max_attempts
        )
      )
    order by coalesce(v.completed_at, v.created_at)
    limit least(greatest(coalesce(p_limit, 5), 1), 50)
    for update skip locked
  loop
    -- A runner that stopped mid-scan on the last try: the file couldn't be checked.
    if due.upload_state = 'scanning' and due.scan_attempts >= max_attempts then
      perform app.document_scan_give_up(due.id);
      continue;
    end if;
    perform app.open_document_write(due.id);
    update public.document_versions
    set scan_attempts = scan_attempts + 1,
        scan_next_attempt_at = statement_timestamp() + make_interval(secs => lease)
    where id = due.id;
    perform app.close_document_write(due.id);
    claimed := claimed || jsonb_build_array(jsonb_build_object(
      'version_id', due.id,
      'organization_id', due.organization_id,
      'storage_bucket', due.storage_bucket,
      'storage_key', due.storage_key,
      'byte_size', coalesce(due.byte_size, due.declared_byte_size),
      'attempt', due.scan_attempts + 1,
      'backfill', due.upload_state = 'clean'
    ));
  end loop;
  return claimed;
end;
$$;
revoke all on function app.service_claim_document_scans(integer, uuid, boolean) from public, anon, authenticated;
grant execute on function app.service_claim_document_scans(integer, uuid, boolean) to service_role;

create function public.service_claim_document_scans(
  p_limit integer default 5,
  p_version_id uuid default null,
  p_backfill boolean default false
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app.service_claim_document_scans(p_limit, p_version_id, p_backfill);
$$;
revoke all on function public.service_claim_document_scans(integer, uuid, boolean) from public, anon, authenticated;
grant execute on function public.service_claim_document_scans(integer, uuid, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- Record: the scanner's answer, the only way out of 'scanning'
-- ---------------------------------------------------------------------------

create function app.service_record_document_scan(
  p_version_id uuid,
  p_outcome text,
  p_signature text,
  p_engine text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.document_versions%rowtype;
  legacy boolean;
  signature_name text := nullif(left(btrim(regexp_replace(coalesce(p_signature, ''), '[^A-Za-z0-9._:/+ -]', '', 'g')), 200), '');
  engine_name text := nullif(left(btrim(coalesce(p_engine, '')), 120), '');
  matter uuid;
  wait_seconds integer;
  next_state public.document_upload_state;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') is distinct from 'service_role' then
    raise exception 'worker role required' using errcode = '42501';
  end if;
  if p_outcome is null or p_outcome not in ('clean', 'infected', 'error') then
    raise exception 'scan outcome must be clean, infected, or error' using errcode = '22023';
  end if;
  if p_outcome = 'infected' and signature_name is null then
    raise exception 'an infected result needs the signature name' using errcode = '22023';
  end if;
  select * into target from public.document_versions where id = p_version_id for update;
  if target.id is null then
    raise exception 'document version was not found' using errcode = '22023';
  end if;
  legacy := target.upload_state = 'clean'
    and target.scan_engine = 'structural_only'
    and target.scan_result is distinct from 'in_house_seal';
  -- Anything else already has its answer (clean by the scanner, quarantined, failed): unchanged.
  if target.upload_state not in ('scanning', 'scan_failed') and not legacy then
    return jsonb_build_object('version_id', target.id, 'upload_state', target.upload_state, 'changed', false);
  end if;
  matter := app.document_version_matter(target.document_id);

  if p_outcome = 'error' then
    if legacy then
      wait_seconds := app.document_scan_setting('base_seconds', 60) * power(2, least(greatest(target.scan_attempts - 1, 0), 10))::integer;
    elsif target.upload_state = 'scan_failed' then
      wait_seconds := app.document_scan_setting('failed_retry_seconds', 21600);
    elsif target.scan_attempts >= app.document_scan_setting('max_attempts', 6) then
      next_state := app.document_scan_give_up(target.id);
      return jsonb_build_object('version_id', target.id, 'upload_state', next_state, 'changed', true);
    else
      wait_seconds := app.document_scan_setting('base_seconds', 60) * power(2, least(greatest(target.scan_attempts - 1, 0), 10))::integer;
    end if;
    perform app.open_document_write(target.id);
    update public.document_versions
    set scan_next_attempt_at = statement_timestamp() + make_interval(secs => wait_seconds)
    where id = target.id;
    perform app.close_document_write(target.id);
    return jsonb_build_object(
      'version_id', target.id,
      'upload_state', target.upload_state,
      'changed', false,
      'retry_in_seconds', wait_seconds
    );
  end if;

  if p_outcome = 'clean' then
    perform app.open_document_write(target.id);
    update public.document_versions
    set upload_state = 'clean',
        scan_engine = 'worker',
        scan_result = 'clean',
        scan_signature = null,
        scan_engine_version = engine_name,
        scanned_at = statement_timestamp(),
        scan_next_attempt_at = null,
        quarantine_reason = null
    where id = target.id;
    perform app.close_document_write(target.id);
    if not legacy then
      -- What finish_verified_document_upload enqueues for a clean file, now that it is one.
      perform app.enqueue_event(
        target.organization_id, 'document', target.document_id, 'document.uploaded',
        jsonb_build_object('document_id', target.document_id, 'version_id', target.id, 'matter_id', matter),
        target.version_number,
        'document.uploaded:' || target.id::text,
        null
      );
    end if;
    perform app.record_audit_event(
      target.organization_id,
      'document.scan_clean',
      'document_versions',
      target.id,
      'success',
      jsonb_build_object(
        'document_id', target.document_id,
        'matter_id', matter,
        'engine', engine_name,
        'attempts', target.scan_attempts,
        'backfill', legacy
      )
    );
    return jsonb_build_object('version_id', target.id, 'upload_state', 'clean', 'changed', true);
  end if;

  -- infected
  perform app.open_document_write(target.id);
  update public.document_versions
  set upload_state = 'quarantined',
      scan_engine = 'worker',
      scan_result = 'infected',
      scan_signature = signature_name,
      scan_engine_version = engine_name,
      scanned_at = statement_timestamp(),
      scan_next_attempt_at = null,
      quarantine_reason = left('a virus was found: ' || signature_name, 200)
  where id = target.id;
  perform app.close_document_write(target.id);
  perform app.enqueue_event(
    target.organization_id, 'document', target.document_id, 'document.quarantined',
    jsonb_build_object('document_id', target.document_id, 'version_id', target.id, 'scan_result', 'infected'),
    target.version_number,
    'document.scan_infected:' || target.id::text,
    null
  );
  perform app.record_audit_event(
    target.organization_id,
    'document.scan_infected',
    'document_versions',
    target.id,
    'denied',
    jsonb_build_object(
      'document_id', target.document_id,
      'matter_id', matter,
      'signature', signature_name,
      'engine', engine_name,
      'backfill', legacy
    )
  );
  return jsonb_build_object('version_id', target.id, 'upload_state', 'quarantined', 'changed', true);
end;
$$;
revoke all on function app.service_record_document_scan(uuid, text, text, text) from public, anon, authenticated;
grant execute on function app.service_record_document_scan(uuid, text, text, text) to service_role;

create function public.service_record_document_scan(
  p_version_id uuid,
  p_outcome text,
  p_signature text default null,
  p_engine text default null
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app.service_record_document_scan(p_version_id, p_outcome, p_signature, p_engine);
$$;
revoke all on function public.service_record_document_scan(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.service_record_document_scan(uuid, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- app.apply_document_scan (20261017180000): now the same scanner path
-- ---------------------------------------------------------------------------

create or replace function app.apply_document_scan(
  p_version_id uuid,
  p_result text
)
returns public.document_upload_state
language plpgsql
security definer
set search_path = ''
as $$
declare
  recorded jsonb;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') is distinct from 'service_role' then
    raise exception 'worker role required' using errcode = '42501';
  end if;
  if p_result not in ('clean', 'suspicious', 'failed') then
    raise exception 'scan result must be clean, suspicious, or failed' using errcode = '22023';
  end if;
  -- #263-B: one way to record a scan. 'failed' is a scanner error (retried), not a clean file.
  recorded := app.service_record_document_scan(
    p_version_id,
    case p_result when 'clean' then 'clean' when 'suspicious' then 'infected' else 'error' end,
    case when p_result = 'suspicious' then 'Unnamed.Suspicious' else null end,
    null
  );
  return (recorded ->> 'upload_state')::public.document_upload_state;
end;
$$;
revoke all on function app.apply_document_scan(uuid, text) from public;
grant execute on function app.apply_document_scan(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- Unsorted email attachments (20261017200200)
-- ---------------------------------------------------------------------------

create or replace function public.finish_unsorted_email_file(
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
  else
    -- #263-B: ready to file, with or without virus scanning. Nobody opens an inbox file as it is;
    -- filing copies it into a document version, which waits for the virus scanner when it is on.
    next_state := 'clean';
    next_result := 'structural_only';
  end if;
  update public.inbound_inbox_items
     set upload_state = next_state, scan_result = next_result, sha256 = p_sha256
   where id = item.id;
  return jsonb_build_object('inbox_item_id', item.id, 'upload_state', next_state, 'scan_result', next_result);
end;
$$;
revoke all on function public.finish_unsorted_email_file(uuid, integer, text, text) from public, anon, authenticated;
grant execute on function public.finish_unsorted_email_file(uuid, integer, text, text) to service_role;

create or replace function public.complete_unsorted_assignment(p_item_id uuid)
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
  -- #263-B: a copy waiting for the virus scanner is filed; nobody can open it until it is clean.
  if version.upload_state is distinct from 'clean' and version.upload_state is distinct from 'scanning' then
    raise exception 'assigned upload is not clean' using errcode = '42501';
  end if;
  update public.inbound_inbox_items
     set upload_state = 'assigned'
   where id = item.id;
end;
$$;
revoke all on function public.complete_unsorted_assignment(uuid) from public, anon;
grant execute on function public.complete_unsorted_assignment(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Staff notifications (20261025320100): a 'document_blocked' branch
-- ---------------------------------------------------------------------------

create or replace function app.staff_notification_items(p_org uuid, p_limit integer)
returns table (
  source_id uuid,
  kind text,
  occurred_at timestamptz,
  matter_id uuid,
  actor_name text,
  subject text,
  detail text,
  href text,
  is_read boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  since timestamptz := clock_timestamp() - interval '30 days';
  firm_zone text;
  me uuid;
begin
  if actor is null
     or app.in_active_org(p_org) is distinct from true
     or app.staff_mfa_satisfied() is distinct from true
     or app.is_org_staff(p_org) is distinct from true then
    raise exception 'staff access denied' using errcode = '42501';
  end if;

  select nullif(btrim(coalesce(org.timezone, '')), '') into firm_zone
  from public.organizations org
  where org.id = p_org;

  -- OPS-01: the caller's own membership, to match task owners, watchers and matter leads.
  select mem.id into me
  from public.memberships mem
  where mem.organization_id = p_org
    and mem.user_id = actor
    and mem.status = 'active'
  order by mem.created_at
  limit 1;

  return query
  with items as (
    -- A client's message.
    select message.id as source_id, 'message'::text as kind, message.created_at as occurred_at,
           message.matter_id, person.display_name as actor_name, null::text as subject, null::text as detail,
           '/sheet/matters/' || message.matter_id::text || '?tab=messages&thread=' || message.thread_id::text as href,
           exists (
             select 1 from public.matter_message_receipts receipt
             where receipt.message_id = message.id and receipt.user_id = actor
           ) as seen
    from public.matter_messages message
    join public.persons person
      on person.id = message.author_person_id
     and person.organization_id = message.organization_id
    where message.organization_id = p_org
      and message.author_kind = 'client'
      and message.created_at > since
      and app.message_staff_reads_matter(message.matter_id, message.organization_id)

    union all
    -- A client's upload that passed the file check.
    select event.id, 'document', event.occurred_at, matter.id,
           coalesce(uploader.display_name, subject_person.display_name), doc.purpose,
           'v' || coalesce(version.version_number, 1)::text,
           '/sheet/matters/' || matter.id::text || '?tab=documents',
           false
    from public.outbox_events event
    join public.documents doc
      on doc.id::text = event.payload ->> 'document_id'
     and doc.organization_id = event.organization_id
    join public.persons subject_person
      on subject_person.id = doc.person_id
     and subject_person.organization_id = doc.organization_id
    left join public.document_versions version
      on version.id::text = event.payload ->> 'version_id'
     and version.organization_id = event.organization_id
    join public.matters matter
      on matter.id::text = event.payload ->> 'matter_id'
     and matter.organization_id = event.organization_id
    left join public.persons uploader
      on uploader.user_id = event.created_by
     and uploader.organization_id = event.organization_id
    where event.organization_id = p_org
      and event.event_type = 'document.uploaded'
      and event.occurred_at > since
      and not exists (
        select 1 from public.memberships m
        where m.organization_id = event.organization_id
          and m.user_id = event.created_by
          and m.role = any (app.staff_roles())
      )
      and app.message_staff_reads_matter(matter.id, matter.organization_id)

    union all
    -- #263-B: the virus scanner blocked a file (a virus was found), or couldn't check it after
    -- every retry. For staff who can open the matter. subject: the document; detail: which.
    select audit.id, 'document_blocked', audit.occurred_at, matter.id, null::text, doc.purpose,
           case audit.action when 'document.scan_infected' then 'infected' else 'scan_failed' end,
           '/sheet/matters/' || matter.id::text || '?tab=documents',
           false
    from public.audit_log audit
    join public.document_versions version
      on version.id = audit.object_id
     and version.organization_id = audit.organization_id
    join public.documents doc
      on doc.id = version.document_id
     and doc.organization_id = version.organization_id
    join public.matters matter
      on matter.id::text = audit.context ->> 'matter_id'
     and matter.organization_id = audit.organization_id
    where audit.organization_id = p_org
      and audit.action in ('document.scan_infected', 'document.scan_failed')
      and audit.occurred_at > since
      and app.message_staff_reads_matter(matter.id, matter.organization_id)

    union all
    -- A card payment succeeded.
    select audit.id, 'payment', audit.occurred_at, invoice.matter_id, null, invoice.number, null,
           '/sheet/finance?tab=payments',
           false
    from public.audit_log audit
    join public.invoices invoice
      on invoice.id = audit.object_id
     and invoice.organization_id = audit.organization_id
    where audit.organization_id = p_org
      and audit.action = 'invoice.payment_succeeded'
      and audit.occurred_at > since
      and app.can_read_matter_billing(invoice.matter_id)

    union all
    -- A consultation booked by a client or a visitor, at its time in the firm's zone.
    select event.id, 'booking', event.occurred_at, booking.matter_id, attendee.display_name, booking.title,
           to_char(booking.starts_at at time zone coalesce(firm_zone, booking.host_time_zone), 'YYYY-MM-DD"T"HH24:MI'),
           '/sheet/consultations',
           false
    from public.outbox_events event
    join public.bookings booking
      on booking.id::text = event.payload ->> 'booking_id'
     and booking.organization_id = event.organization_id
    left join public.booking_attendees attendee
      on attendee.booking_id = booking.id
     and attendee.organization_id = booking.organization_id
     and attendee.role = 'primary'
    where event.organization_id = p_org
      and event.event_type = 'booking.confirmed'
      and event.occurred_at > since
      and booking.source = 'public'
      and app.can_read_scheduling(p_org)

    union all
    -- portal appointments: a client cancelled their consultation from the portal, for its host
    -- and the firm owner, at the cancelled time in the firm's zone.
    select event.id, 'booking_cancelled', event.occurred_at, booking.matter_id,
           coalesce(person.display_name, attendee.display_name), booking.title,
           to_char(coalesce((event.payload ->> 'starts_at')::timestamptz, booking.starts_at)
                   at time zone coalesce(firm_zone, booking.host_time_zone), 'YYYY-MM-DD"T"HH24:MI'),
           '/sheet/consultations',
           false
    from public.outbox_events event
    join public.bookings booking
      on booking.id::text = event.payload ->> 'booking_id'
     and booking.organization_id = event.organization_id
    left join public.persons person
      on person.id = booking.person_id
     and person.organization_id = booking.organization_id
    left join public.booking_attendees attendee
      on attendee.booking_id = booking.id
     and attendee.organization_id = booking.organization_id
     and attendee.role = 'primary'
    where event.organization_id = p_org
      and event.event_type = 'booking.cancelled_by_client'
      and event.occurred_at > since
      and app.can_read_scheduling(p_org)
      and (booking.host_user_id = actor or app.has_org_role(p_org, array['firm_owner']::public.org_role[]))

    union all
    -- portal appointments: a client moved their consultation from the portal, for its host and
    -- the firm owner, at the new time in the firm's zone.
    select event.id, 'booking_rescheduled', event.occurred_at, booking.matter_id,
           coalesce(person.display_name, attendee.display_name), booking.title,
           to_char(coalesce((event.payload ->> 'starts_at')::timestamptz, booking.starts_at)
                   at time zone coalesce(firm_zone, booking.host_time_zone), 'YYYY-MM-DD"T"HH24:MI'),
           '/sheet/consultations',
           false
    from public.outbox_events event
    join public.bookings booking
      on booking.id::text = event.payload ->> 'booking_id'
     and booking.organization_id = event.organization_id
    left join public.persons person
      on person.id = booking.person_id
     and person.organization_id = booking.organization_id
    left join public.booking_attendees attendee
      on attendee.booking_id = booking.id
     and attendee.organization_id = booking.organization_id
     and attendee.role = 'primary'
    where event.organization_id = p_org
      and event.event_type = 'booking.rescheduled_by_client'
      and event.occurred_at > since
      and app.can_read_scheduling(p_org)
      and (booking.host_user_id = actor or app.has_org_role(p_org, array['firm_owner']::public.org_role[]))

    union all
    -- A deadline reminder came due.
    select event.id, 'deadline', event.occurred_at, deadline.matter_id, null, deadline.label,
           coalesce(to_char(deadline.due_on, 'YYYY-MM-DD'), ''),
           '/sheet/matters/' || deadline.matter_id::text || '?tab=tasks',
           false
    from public.outbox_events event
    join public.deadlines deadline
      on deadline.id::text = event.payload ->> 'deadline_id'
     and deadline.organization_id = event.organization_id
    where event.organization_id = p_org
      and event.event_type = 'reminder.due'
      and event.occurred_at > since
      and app.message_staff_reads_matter(deadline.matter_id, deadline.organization_id)

    union all
    -- Casevoya support asked for access (SEC-09): the firm's owners. Read once it is decided.
    select req.id, 'support', req.created_at, req.matter_id, req.requested_by_name,
           case req.scope
             when 'firm_settings' then 'firm settings'
             when 'records_set' then 'a set of records'
             else coalesce(matter.reference, matter.title)
           end,
           req.requested_minutes::text,
           '/sheet/grants?tab=support',
           req.status <> 'pending'
    from public.support_access_requests req
    left join public.matters matter
      on matter.id = req.matter_id
     and matter.organization_id = req.organization_id
    where req.organization_id = p_org
      and req.created_at > since
      and app.has_org_role(p_org, array['firm_owner']::public.org_role[])

    union all
    -- intake delivery: a client sent their answers (one row per submitted snapshot), for staff
    -- who can open the matter. Staff submitting on a client's behalf raise no row.
    select snap.id, 'intake_submitted', snap.created_at, response.matter_id,
           coalesce(
             (select p.display_name from public.persons p
              where p.user_id = snap.created_by and p.organization_id = snap.organization_id
              order by p.created_at limit 1),
             subject_person.display_name
           ),
           template.title, null::text,
           '/sheet/matters/' || response.matter_id::text || '?tab=intake',
           false
    from public.intake_snapshots snap
    join public.intake_responses response
      on response.id = snap.response_id
     and response.organization_id = snap.organization_id
    join public.intake_templates template
      on template.id = response.template_id
     and template.organization_id = response.organization_id
    join public.persons subject_person
      on subject_person.id = response.person_id
     and subject_person.organization_id = response.organization_id
    where snap.organization_id = p_org
      and snap.created_at > since
      and not exists (
        select 1 from public.memberships m
        where m.organization_id = snap.organization_id
          and m.user_id = snap.created_by
          and m.role = any (app.staff_roles())
      )
      and app.message_staff_reads_matter(response.matter_id, response.organization_id)

    union all
    -- intake delivery: a client asked for a correction after submitting (INT-06).
    select correction.id, 'intake_correction', correction.created_at, response.matter_id,
           subject_person.display_name, template.title,
           'CR-' || lpad(correction.correction_number::text, 4, '0'),
           '/sheet/matters/' || response.matter_id::text || '?tab=intake',
           false
    from public.intake_corrections correction
    join public.intake_responses response
      on response.id = correction.response_id
     and response.organization_id = correction.organization_id
    join public.intake_templates template
      on template.id = response.template_id
     and template.organization_id = response.organization_id
    join public.persons subject_person
      on subject_person.id = response.person_id
     and subject_person.organization_id = response.organization_id
    where correction.organization_id = p_org
      and correction.created_at > since
      and app.message_staff_reads_matter(response.matter_id, response.organization_id)

    union all
    -- OPS-01: a task's status changed, it was reassigned, or it was escalated as overdue. For its
    -- owner and watchers (status), the new owner and watchers (reassigned), and also the matter's
    -- responsible consultant (escalated). Never for the person who made the change.
    select event.id, 'task', event.created_at, task.matter_id,
           (select prof.display_name from public.profiles prof where prof.id = event.actor_user_id),
           task.title,
           case event.event_kind
             when 'status' then event.to_status::text
             when 'reassigned' then case when event.to_membership_id = me then 'reassigned_you' else 'reassigned' end
             else 'escalated'
           end,
           case when task.matter_id is null then '/sheet/tasks'
                else '/sheet/matters/' || task.matter_id::text || '?tab=tasks' end,
           false
    from public.task_events event
    join public.tasks task
      on task.id = event.task_id
     and task.organization_id = event.organization_id
    left join public.matters matter
      on matter.id = task.matter_id
     and matter.organization_id = task.organization_id
    where event.organization_id = p_org
      and event.created_at > since
      and event.event_kind in ('status', 'reassigned', 'escalated')
      and me is not null
      and event.actor_user_id is distinct from actor
      and (
        exists (
          select 1 from public.task_watchers watcher
          where watcher.task_id = task.id
            and watcher.organization_id = task.organization_id
            and watcher.membership_id = me
        )
        -- The owner when it happened: the one a later reassignment moved it from, else today's owner.
        or (
          event.event_kind in ('status', 'escalated')
          and coalesce(
            (
              select later.from_membership_id
              from public.task_events later
              where later.task_id = task.id
                and later.organization_id = task.organization_id
                and later.event_kind = 'reassigned'
                and later.created_at > event.created_at
              order by later.created_at
              limit 1
            ),
            task.owner_membership_id
          ) = me
        )
        or (event.event_kind = 'reassigned' and event.to_membership_id = me)
        or (event.event_kind = 'escalated' and matter.responsible_consultant_membership_id = me)
      )
      and app.can_read_task(task.id)

    union all
    -- REP-03: a scheduled report (or its test run) was sent to you as a link. Only while your role
    -- still sees that tab; the page checks again when it opens.
    select delivery.id, 'report', delivery.created_at, null::uuid, null::text, sched.title, run.kind,
           delivery.link,
           false
    from public.scheduled_report_deliveries delivery
    join public.scheduled_reports sched
      on sched.id = delivery.schedule_id
     and sched.organization_id = delivery.organization_id
    join public.scheduled_report_runs run
      on run.id = delivery.run_id
     and run.organization_id = delivery.organization_id
    where delivery.organization_id = p_org
      and delivery.user_id = actor
      and delivery.status = 'delivered'
      and delivery.created_at > since
      and app.has_org_role(p_org, app.report_tab_roles(sched.tab))
  )
  select items.source_id, items.kind, items.occurred_at, items.matter_id, items.actor_name, items.subject,
         items.detail, items.href,
         items.seen or exists (
           select 1 from public.staff_notification_reads r
           where r.organization_id = p_org and r.user_id = actor and r.source_id = items.source_id
         )
  from items
  order by items.occurred_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;
revoke all on function app.staff_notification_items(uuid, integer) from public;
grant execute on function app.staff_notification_items(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- The scheduler: kick the runner while a scan is due
-- ---------------------------------------------------------------------------

create function app.kick_document_scans()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  url text;
  secret text;
begin
  if not exists (
    select 1 from public.document_versions v
    where v.upload_state in ('scanning', 'scan_failed')
      and coalesce(v.scan_next_attempt_at, '-infinity'::timestamptz) <= now()
  ) then
    return;
  end if;
  select decrypted_secret into url from vault.decrypted_secrets where name = 'email_dispatch_url';
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'email_dispatch_secret';
  if url is null or secret is null or url !~ '^https://[^/]+/api/email/dispatch$' then
    return;
  end if;
  perform net.http_post(
    url := regexp_replace(url, '/api/email/dispatch$', '/api/documents/scan/run'),
    headers := jsonb_build_object('Authorization', 'Bearer ' || secret, 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
end;
$$;
revoke all on function app.kick_document_scans() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
    create extension if not exists pg_cron;
    perform cron.schedule('casevoya-document-scans', '* * * * *', 'select app.kick_document_scans()');
  end if;
end;
$$;
