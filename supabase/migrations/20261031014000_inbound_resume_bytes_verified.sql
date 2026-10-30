-- Inbound mail: Message-ID resume binding, attachment close-out, per-firm attachment byte cap,
-- and server-verified completion for email attachments filed to a matter.
--
-- Rules:
--   * public.inbound_emails.content_digest: SHA-256 (hex) of the subject, text body and the list
--     of attachment SHA-256s, computed by the app server (src/modules/email/inbound.ts) and passed
--     through public.begin_inbound_message_with_digest (service_role only). Stored at first insert
--     together with sender_verified.
--   * public.begin_inbound_message: a message whose Message-ID already exists for the firm is only
--     treated as the same message (resume / duplicate with the stored ids) when the normalised
--     from_email, the sender_verified value and the content digest all match the stored row.
--     Otherwise it is a 'duplicate' with no inbound id, person or matter; when the stored row was
--     still open an audit row (reason only, no content) is written. A row stored without a digest
--     (written before this migration or by the previous app) resumes when from_email and
--     sender_verified match; the digest of the resuming call is then stored on that row.
--   * public.abandon_inbound_attachments (service_role only): closes a row whose attachment step
--     failed (attachments_done = true) and audits the reason, so it cannot be resumed later.
--   * Per-firm hourly byte cap for stored inbound attachments (product setting
--     email.inbound_attachment_bytes, default 500 MB per hour), counted in
--     public.email_inbound_windows.attachment_bytes when an email upload intent or inbox file is
--     created. Over the cap the intent is refused.
--   * public.complete_verified_email_upload (service_role only): completes an email attachment
--     with the SHA-256, size and media type measured by the app server (DOCX package inspected),
--     like public.finish_verified_document_upload. public.complete_email_upload (header bytes only)
--     is no longer executable by service_role.
-- begin_inbound_message is copied from 20261031002000_inbound_sender_limits.sql; changes are
-- marked "Resume binding:". create_email_upload_intent and open_unsorted_email_file are copied
-- from 20261017200200_inbound_email.sql; changes are marked "Byte cap:".
-- Additive only.

-- ---------------------------------------------------------------------------
-- Columns and settings
-- ---------------------------------------------------------------------------

alter table public.inbound_emails
  add column if not exists content_digest text
    check (content_digest is null or content_digest ~ '^[0-9a-f]{64}$');
comment on column public.inbound_emails.content_digest is
  'SHA-256 of subject, text body and attachment SHA-256s, computed by the app server at first receipt. A repeated Message-ID resumes this row only when it matches.';

alter table public.email_inbound_windows
  add column if not exists attachment_bytes bigint not null default 0 check (attachment_bytes >= 0);
comment on column public.email_inbound_windows.attachment_bytes is
  'Bytes of inbound email attachments authorised for storage in this hour (matter files and inbox files).';

insert into public.product_settings (key, value, description, pending_confirmation) values
  (
    'email.inbound_attachment_bytes',
    '{"bytes_per_hour":524288000}'::jsonb,
    'Inbound mail per firm in an hour: total bytes of email attachments that may be stored. Further attachments are refused until the next hour.',
    true
  )
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Byte cap helper (private)
-- ---------------------------------------------------------------------------

create or replace function app.reserve_inbound_attachment_bytes(p_org uuid, p_bytes bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cap bigint;
  bucket timestamptz := date_trunc('hour', statement_timestamp());
  used bigint;
begin
  if p_org is null or p_bytes is null or p_bytes < 1 then
    return;
  end if;
  select (value ->> 'bytes_per_hour')::bigint into cap
  from public.product_settings
  where key = 'email.inbound_attachment_bytes';
  cap := least(greatest(coalesce(cap, 524288000), 1048576), 107374182400);
  insert into public.email_inbound_windows (organization_id, hour_bucket, hits)
  values (p_org, bucket, 0)
  on conflict (organization_id, hour_bucket) do nothing;
  select hour_row.attachment_bytes into used
  from public.email_inbound_windows hour_row
  where hour_row.organization_id = p_org
    and hour_row.hour_bucket = bucket
  for update;
  if coalesce(used, 0) + p_bytes > cap then
    raise exception 'inbound attachment limit reached for this hour' using errcode = '54000';
  end if;
  update public.email_inbound_windows
     set attachment_bytes = attachment_bytes + p_bytes
   where organization_id = p_org
     and hour_bucket = bucket;
end;
$$;
revoke all on function app.reserve_inbound_attachment_bytes(uuid, bigint) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- public.begin_inbound_message
-- ---------------------------------------------------------------------------

create or replace function public.begin_inbound_message(
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
  -- Sender limits:
  limits jsonb;
  per_sender integer;
  per_domain integer;
  known_limit integer;
  sender_address text;
  sender_domain text;
  sender_hash text;
  known boolean;
  small_bucket timestamptz := date_bin('5 minutes', statement_timestamp(), timestamptz '2000-01-01 00:00:00+00');
  window_floor timestamptz := statement_timestamp() - interval '1 hour';
  sender_hits integer;
  domain_hits integer;
  refused_scope text;
  refused_count integer;
  firm_threshold integer;
  -- Resume binding:
  normalized_from text := left(lower(btrim(coalesce(p_from, 'unknown@example.test'))), 320);
  verified_now boolean := coalesce(current_setting('app.inbound_sender_verified', true), '') = 'true';
  digest_now text := nullif(current_setting('app.inbound_content_digest', true), '');
begin
  if coalesce((select auth.jwt() ->> 'role'), '') is distinct from 'service_role' then
    raise exception 'worker role required' using errcode = '42501';
  end if;
  if p_message_id is null or length(btrim(p_message_id)) < 1 then
    raise exception 'message id is required' using errcode = '22023';
  end if;
  -- Resume binding: only a well-formed digest counts.
  if digest_now is not null and digest_now !~ '^[0-9a-f]{64}$' then
    digest_now := null;
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
    -- Resume binding: the same Message-ID is the same message only for the same sender,
    -- verification result and content. A row stored without a digest is bound by sender and
    -- verification result only; the first digest seen is then stored on it.
    if existing.from_email is distinct from normalized_from
       or existing.sender_verified is distinct from verified_now
       or (existing.content_digest is not null
           and existing.content_digest is distinct from digest_now) then
      if not existing.attachments_done then
        perform app.record_audit_event(
          org, 'email.rejected', 'public.inbound_emails', existing.id, 'denied',
          jsonb_build_object('reason', 'message_id_conflict')
        );
      end if;
      return jsonb_build_object(
        'status', 'duplicate',
        'organization_id', org,
        'matter_id', null,
        'person_id', null,
        'attachments_done', true,
        'reason', 'message_id_conflict'
      );
    end if;
    if existing.content_digest is null and digest_now is not null then
      update public.inbound_emails
         set content_digest = digest_now
       where id = existing.id
         and content_digest is null;
      -- A concurrent call stored a different digest first: not the same message.
      if not found and exists (
        select 1 from public.inbound_emails email
        where email.id = existing.id and email.content_digest is distinct from digest_now
      ) then
        return jsonb_build_object(
          'status', 'duplicate',
          'organization_id', org,
          'matter_id', null,
          'person_id', null,
          'attachments_done', true,
          'reason', 'message_id_conflict'
        );
      end if;
    end if;
    return jsonb_build_object(
      'status', case when existing.attachments_done then 'duplicate' else 'resume' end,
      'inbound_email_id', existing.id,
      'organization_id', existing.organization_id,
      'matter_id', existing.matter_id,
      'person_id', existing.person_id,
      'attachments_done', existing.attachments_done
    );
  end if;

  -- Sender limits: one firm's counters are read and written by one transaction at a time.
  perform pg_advisory_xact_lock(hashtextextended('inbound_email_limits:' || org::text, 0));
  sender_address := app.inbound_sender_address(p_from);
  sender_domain := coalesce(nullif(split_part(sender_address, '@', 2), ''), '(invalid)');
  sender_hash := encode(sha256(convert_to(app.inbound_sender_key(sender_address), 'UTF8')), 'hex');
  known := coalesce(app.inbound_known_sender(org, sender_address), false);
  select value into limits from public.product_settings where key = 'email.inbound_sender_limits';
  per_sender := least(greatest(coalesce((limits ->> 'per_sender')::integer, 20), 1), 1000);
  per_domain := least(greatest(coalesce((limits ->> 'per_domain')::integer, 100), 1), 10000);
  known_limit := least(greatest(coalesce((limits ->> 'known_messages')::integer, 300), 1), 10000);

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

  -- Sender limits: outside senders are limited per address and per domain first.
  if not known then
    select coalesce(sum(w.hits), 0)::integer into sender_hits
    from public.email_inbound_sender_windows w
    where w.organization_id = org and w.scope = 'sender' and w.sender_key = sender_hash
      and w.window_start > window_floor;
    select coalesce(sum(w.hits), 0)::integer into domain_hits
    from public.email_inbound_sender_windows w
    where w.organization_id = org and w.scope = 'domain' and w.sender_key = left(sender_domain, 320)
      and w.window_start > window_floor;
    if sender_hits >= per_sender then
      refused_scope := 'sender';
    elsif domain_hits >= per_domain then
      refused_scope := 'domain';
    end if;
    if refused_scope is not null then
      insert into public.email_inbound_sender_windows (organization_id, scope, sender_key, window_start, hits, rejected)
      values (
        org, refused_scope,
        case when refused_scope = 'sender' then sender_hash else left(sender_domain, 320) end,
        small_bucket, 0, 1
      )
      on conflict (organization_id, scope, sender_key, window_start) do update
        set rejected = public.email_inbound_sender_windows.rejected + 1
      returning rejected into refused_count;
      if refused_count = 1 then
        perform app.record_audit_event(
          org, 'email.rejected', 'public.inbound_emails', null::uuid, 'denied',
          jsonb_build_object('reason', refused_scope || '_rate_limit', 'sender_domain', left(sender_domain, 253))
        );
      end if;
      return jsonb_build_object('status', 'rate_limited', 'organization_id', org, 'reason', refused_scope || '_rate_limit');
    end if;
  end if;

  -- Sender limits: known senders are refused only at the higher backstop.
  firm_threshold := limit_hits;
  if known then
    firm_threshold := greatest(limit_hits, known_limit);
  end if;
  if coalesce(current_hits, 0) >= firm_threshold then
    insert into public.email_inbound_windows (organization_id, hour_bucket, hits, rejected)
    values (org, bucket, 0, 1)
    on conflict (organization_id, hour_bucket) do update
      set rejected = public.email_inbound_windows.rejected + 1
    returning rejected into refused_count;
    if refused_count = 1 then
      perform app.record_audit_event(
        org, 'email.rejected', 'public.inbound_emails', null::uuid, 'denied',
        jsonb_build_object('reason', 'rate_limit', 'sender_class', case when known then 'known' else 'other' end)
      );
    end if;
    return jsonb_build_object('status', 'rate_limited', 'organization_id', org, 'reason', 'rate_limit');
  end if;
  insert into public.email_inbound_windows (organization_id, hour_bucket, hits)
  values (org, bucket, 1)
  on conflict (organization_id, hour_bucket) do update
    set hits = public.email_inbound_windows.hits + 1;

  -- Sender limits: count accepted mail from outside senders.
  if not known then
    insert into public.email_inbound_sender_windows (organization_id, scope, sender_key, window_start, hits)
    values (org, 'sender', sender_hash, small_bucket, 1), (org, 'domain', left(sender_domain, 320), small_bucket, 1)
    on conflict (organization_id, scope, sender_key, window_start) do update
      set hits = public.email_inbound_sender_windows.hits + 1;
    delete from public.email_inbound_sender_windows old_row
    where old_row.organization_id = org
      and old_row.window_start < statement_timestamp() - interval '1 day';
  end if;

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
    text_body, html_body, body_location, matter_id, person_id,
    sender_verified, content_digest
  ) values (
    org,
    left(btrim(p_message_id), 500),
    normalized_from,
    left(lower(btrim(p_to)), 320),
    left(nullif(btrim(coalesce(p_subject, '')), ''), 300),
    case when stored_in_messages then null else nullif(body_text, '') end,
    case when stored_in_messages then null else left(nullif(btrim(coalesce(p_html, '')), ''), 200000) end,
    case when stored_in_messages then 'messages' else 'inbound_emails' end,
    matter,
    person,
    -- Resume binding: recorded at first insert.
    verified_now,
    digest_now
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

revoke all on function public.begin_inbound_message(text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.begin_inbound_message(text, text, text, text, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- public.begin_inbound_message_with_digest (the app's entry point)
-- ---------------------------------------------------------------------------

create or replace function public.begin_inbound_message_with_digest(
  p_to text,
  p_from text,
  p_message_id text,
  p_subject text,
  p_text text,
  p_html text,
  p_domain text,
  p_sender_verified boolean,
  p_content_digest text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') is distinct from 'service_role' then
    raise exception 'worker role required' using errcode = '42501';
  end if;
  if p_content_digest is null or p_content_digest !~ '^[0-9a-f]{64}$' then
    raise exception 'content digest must be a sha256 hex digest' using errcode = '22023';
  end if;
  perform set_config('app.inbound_content_digest', p_content_digest, true);
  result := public.begin_verified_inbound_message(
    p_to, p_from, p_message_id, p_subject, p_text, p_html, p_domain, p_sender_verified
  );
  perform set_config('app.inbound_content_digest', '', true);
  return result;
end;
$$;
revoke all on function public.begin_inbound_message_with_digest(text, text, text, text, text, text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.begin_inbound_message_with_digest(text, text, text, text, text, text, text, boolean, text) to service_role;

-- ---------------------------------------------------------------------------
-- public.abandon_inbound_attachments
-- ---------------------------------------------------------------------------

create or replace function public.abandon_inbound_attachments(p_inbound_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  email public.inbound_emails%rowtype;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') is distinct from 'service_role' then
    raise exception 'worker role required' using errcode = '42501';
  end if;
  if p_reason is null or p_reason not in ('attachment_limit', 'attachment_error') then
    raise exception 'reason is invalid' using errcode = '22023';
  end if;
  select * into email from public.inbound_emails where id = p_inbound_id for update;
  if email.id is null then
    raise exception 'message was not found' using errcode = '42501';
  end if;
  if email.attachments_done then
    return;
  end if;
  update public.inbound_emails
     set attachments_done = true
   where id = email.id;
  perform app.record_audit_event(
    email.organization_id, 'email.attachments_abandoned', 'public.inbound_emails', email.id, 'denied',
    jsonb_build_object('reason', p_reason)
  );
end;
$$;
revoke all on function public.abandon_inbound_attachments(uuid, text) from public, anon, authenticated;
grant execute on function public.abandon_inbound_attachments(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- public.create_email_upload_intent / public.open_unsorted_email_file (byte cap)
-- ---------------------------------------------------------------------------

create or replace function public.create_email_upload_intent(
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
  -- Byte cap: a closed message takes no new attachments; new bytes count toward the firm hour.
  if email.attachments_done then
    raise exception 'this message is closed' using errcode = '42501';
  end if;
  perform app.reserve_inbound_attachment_bytes(email.organization_id, p_byte_size);
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
revoke all on function public.create_email_upload_intent(uuid, integer, text, bigint) from public, anon, authenticated;
grant execute on function public.create_email_upload_intent(uuid, integer, text, bigint) to service_role;

create or replace function public.open_unsorted_email_file(
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
  -- Byte cap: a closed message takes no new attachments; new bytes count toward the firm hour.
  if email.attachments_done then
    raise exception 'this message is closed' using errcode = '42501';
  end if;
  perform app.reserve_inbound_attachment_bytes(email.organization_id, p_byte_size);
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
revoke all on function public.open_unsorted_email_file(uuid, integer, text, bigint) from public, anon, authenticated;
grant execute on function public.open_unsorted_email_file(uuid, integer, text, bigint) to service_role;

-- ---------------------------------------------------------------------------
-- public.complete_verified_email_upload
-- ---------------------------------------------------------------------------

create or replace function public.complete_verified_email_upload(
  p_inbound_id uuid,
  p_ordinal integer,
  p_sha256 text,
  p_byte_size bigint,
  p_detected_media_type text
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
  select * into email from public.inbound_emails where id = p_inbound_id;
  select * into link
  from public.inbound_attachment_files
  where inbound_email_id = p_inbound_id
    and ordinal = p_ordinal;
  if email.id is null or link.version_id is null then
    raise exception 'attachment was not started' using errcode = '42501';
  end if;
  select * into version from public.document_versions where id = link.version_id for update;
  -- Email-ingest versions are created without a user (created_by is null) for the email's firm.
  if version.id is null
     or version.organization_id is distinct from email.organization_id
     or link.organization_id is distinct from email.organization_id
     or version.created_by is not null then
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
      'source', 'email',
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
revoke all on function public.complete_verified_email_upload(uuid, integer, text, bigint, text) from public, anon, authenticated;
grant execute on function public.complete_verified_email_upload(uuid, integer, text, bigint, text) to service_role;

-- The header-only completion stops being an entry point in 20261031090000 (applied after the app
-- that calls complete_verified_email_upload is deployed, so mail in flight keeps working).
