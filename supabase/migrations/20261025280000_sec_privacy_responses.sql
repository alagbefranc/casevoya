-- SEC-06 privacy requests: extension, response package and portal delivery (gap PR #184, Builder B).
--
-- 1. Legal time limits (public.privacy_time_limits). What a firm read on an official law page about
--    how long it has to answer a privacy request, or to extend that time: the law's name, the
--    section, the provision word for word, and the number of days only when the provision states
--    one. Each row stores the source URL (a federal official host on public.official_source_domains,
--    for example laws-lois.justice.gc.ca), the date staff checked the page, the page's "current to"
--    date, and the source identity and snapshot in the source governance tables
--    (public.official_sources, public.source_snapshots), exactly as public.renewal_timings does
--    (20261025210000_dec_renewal.sql). Pending until a licensed member approves it with a fresh
--    step-up, under the GOV review rules (app.gov_check_page_attestation, app.gov_check_self_approval,
--    20261025220000). Nothing is seeded: without an approved row, dates are the firm's own and the
--    page says "set by the firm".
-- 2. Extension (public.privacy_requests, new columns). Staff extend an open access or correction
--    request once, with a reason. On an approved official extension the new date may not pass the
--    official limit (received date + the approved response days of the same law + the extension
--    days); otherwise the firm sets the date and it is labelled so. The person is told in the
--    portal when they have a portal login (seen time recorded); otherwise staff record how they told
--    them. Nothing is emailed (no approved email design).
-- 3. Scope search and third-party redaction (public.privacy_request_items). One search lists the
--    person's records in this firm (their client record, matters, documents, message threads,
--    intake forms, invoices, consents, consultations, leads and the audit trail of their record).
--    Staff mark an item, or some of its fields, withheld with a reason; each mark is also a line of
--    the existing redaction worklist (public.privacy_request_redactions.item_id), so the existing
--    redaction step still closes it.
-- 4. Response package (public.privacy_request_responses). After the redaction step, staff (fresh
--    step-up) build a ZIP with a SHA-256 manifest and a PDF summary, reusing the client-file export
--    code (src/modules/exports/) and its private bucket (matter-exports, key under <org>/privacy/).
--    Built on request by the app with the service role; only the service role completes or fails it.
-- 5. Delivery (public.privacy_request_deliveries, public.privacy_response_downloads). After the
--    review, staff (fresh step-up) deliver the ready package through the portal: the request closes
--    as fulfilled or partly fulfilled with the package hash as evidence. The person downloads it
--    from the portal (60-second signed link, 30 days); every download is recorded (who, when, hash)
--    and audited. That record is the delivery proof shown to staff.
--
-- Requests stay per firm (RLS through app.can_read_privacy_request). Nothing here deletes anything;
-- a revoked login keeps every record. No existing function is redefined. Additive only.

-- ---------------------------------------------------------------------------
-- 1. Legal time limits, reviewed before use
-- ---------------------------------------------------------------------------

create table public.privacy_time_limits (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  kind text not null check (kind in ('response', 'extension')),
  law_name text not null check (length(btrim(law_name)) between 3 and 200),
  provision_text text not null check (length(btrim(provision_text)) between 3 and 1500),
  days integer check (days is null or days between 1 and 365),
  source_id uuid not null,
  snapshot_id uuid,
  source_url text not null check (length(source_url) between 12 and 500),
  source_section text not null check (length(btrim(source_section)) between 1 and 200),
  checked_on date not null,
  current_to date,
  snapshot_sha256 text check (snapshot_sha256 is null or snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending_review' check (status in ('pending_review', 'approved', 'rejected', 'retired')),
  reviewed_by_membership_id uuid,
  reviewed_at timestamptz,
  review_note text check (review_note is null or length(btrim(review_note)) between 3 and 500),
  page_attested_by_membership_id uuid,
  page_attested_on date,
  page_attested_at timestamptz,
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id),
  check ((snapshot_id is null) = (snapshot_sha256 is null)),
  check (status not in ('approved', 'rejected', 'retired') or (reviewed_by_membership_id is not null and reviewed_at is not null)),
  check (status not in ('approved', 'retired') or snapshot_sha256 is not null or page_attested_on is not null),
  check ((status = 'retired') = (retired_at is not null)),
  check ((page_attested_by_membership_id is null) = (page_attested_on is null)),
  check ((page_attested_on is null) = (page_attested_at is null)),
  check (page_attested_on is null or snapshot_sha256 is null),
  foreign key (reviewed_by_membership_id, organization_id) references public.memberships (id, organization_id),
  foreign key (page_attested_by_membership_id, organization_id) references public.memberships (id, organization_id),
  foreign key (source_id, organization_id) references public.official_sources (id, organization_id),
  foreign key (snapshot_id, organization_id) references public.source_snapshots (id, organization_id)
);
comment on table public.privacy_time_limits is
  'How long a firm has to answer a privacy request, or to extend that time, as the firm read it on an official law page (SEC-06): law, section, provision word for word, days only when the provision states a number, source URL, date checked, current-to date and snapshot hash. Pending until a licensed member approves it. Never seeded; without an approved row the firm sets its own dates.';
comment on column public.privacy_time_limits.days is
  'Days only when the provision states a number. Null: the provision gives no number (for example "the period that is necessary"), so the firm sets the date.';

create index privacy_time_limits_org_status_idx on public.privacy_time_limits (organization_id, status, kind);
create index privacy_time_limits_reviewer_org_fk_idx on public.privacy_time_limits (reviewed_by_membership_id, organization_id);
create index privacy_time_limits_attester_org_fk_idx on public.privacy_time_limits (page_attested_by_membership_id, organization_id);
create index privacy_time_limits_source_org_fk_idx on public.privacy_time_limits (source_id, organization_id);
create index privacy_time_limits_snapshot_org_fk_idx on public.privacy_time_limits (snapshot_id, organization_id);
create index privacy_time_limits_created_by_idx on public.privacy_time_limits (created_by);

create trigger privacy_time_limits_url before insert or update on public.privacy_time_limits
  for each row execute function app.enforce_allowlisted_urls('source_url');
create trigger privacy_time_limits_touch before update on public.privacy_time_limits
  for each row execute function app.touch_row();
create trigger privacy_time_limits_keys before update on public.privacy_time_limits
  for each row execute function app.guard_tenant_keys();
create trigger privacy_time_limits_stamp before insert on public.privacy_time_limits
  for each row execute function app.stamp_created_by();
create trigger privacy_time_limits_guard before update or delete on public.privacy_time_limits
  for each row execute function app.gov_guard_update();
create trigger privacy_time_limits_audit after insert or update or delete on public.privacy_time_limits
  for each row execute function app.audit_row_change();

-- What was read from the page never changes after it is entered; only the review is added.
create function app.privacy_time_limit_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.kind, new.law_name, new.provision_text, new.days, new.source_id, new.snapshot_id, new.source_url,
      new.source_section, new.checked_on, new.current_to, new.snapshot_sha256)
     is distinct from
     (old.kind, old.law_name, old.provision_text, old.days, old.source_id, old.snapshot_id, old.source_url,
      old.source_section, old.checked_on, old.current_to, old.snapshot_sha256) then
    raise exception 'a legal time limit is not edited; enter a new one and retire this one' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.privacy_time_limit_immutable() from public;
create trigger privacy_time_limits_immutable before update on public.privacy_time_limits
  for each row execute function app.privacy_time_limit_immutable();

-- ---------------------------------------------------------------------------
-- 2. Extension columns on the request
-- ---------------------------------------------------------------------------

alter table public.privacy_requests
  add column extended_due_on date,
  add column extension_basis text check (extension_basis is null or extension_basis in ('official', 'firm')),
  add column extension_time_limit_id uuid,
  add column extension_reason text check (extension_reason is null or length(btrim(extension_reason)) between 3 and 500),
  add column extension_recourse text check (extension_recourse is null or length(btrim(extension_recourse)) between 3 and 500),
  add column extended_at timestamptz,
  add column extended_by uuid references auth.users (id),
  add column extension_notice_channel text check (extension_notice_channel is null or extension_notice_channel in ('portal', 'other')),
  add column extension_notice_method text check (extension_notice_method is null or length(btrim(extension_notice_method)) between 3 and 200),
  add column extension_notice_late boolean,
  add column extension_notice_seen_at timestamptz,
  add constraint privacy_requests_extension_limit_fk
    foreign key (extension_time_limit_id, organization_id) references public.privacy_time_limits (id, organization_id),
  add constraint privacy_requests_extension_shape check (
    ((extended_at is null) = (extended_due_on is null))
    and ((extended_at is null) = (extended_by is null))
    and ((extended_at is null) = (extension_basis is null))
    and ((extended_at is null) = (extension_reason is null))
    and ((extended_at is null) = (extension_notice_channel is null))
    and ((extension_basis = 'official') = (extension_time_limit_id is not null))
    and (extension_notice_channel is distinct from 'other' or extension_notice_method is not null)
    and (extension_notice_seen_at is null or extension_notice_channel = 'portal')
    and (extended_due_on is null or extended_due_on > received_on)
  );
comment on column public.privacy_requests.extended_due_on is
  'The due date after an extension (SEC-06). Official basis: within the approved legal limit; firm basis: set by the firm and labelled so.';

create index privacy_requests_extension_limit_fk_idx on public.privacy_requests (extension_time_limit_id, organization_id);
create index privacy_requests_extended_by_idx on public.privacy_requests (extended_by);

-- ---------------------------------------------------------------------------
-- 3. Scope search results and their redaction decisions
-- ---------------------------------------------------------------------------

create table public.privacy_request_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  request_id uuid not null,
  source text not null check (source in (
    'person', 'matter', 'document', 'message_thread', 'intake_response', 'invoice', 'consent', 'booking', 'lead', 'audit'
  )),
  source_id uuid not null,
  matter_id uuid,
  label text not null check (length(btrim(label)) between 1 and 300),
  fields text[] not null default '{}',
  decision text not null default 'include' check (decision in ('include', 'withhold', 'redact')),
  withheld_fields text[] not null default '{}',
  third_party text check (third_party is null or length(btrim(third_party)) between 1 and 200),
  reason text check (reason is null or length(btrim(reason)) between 3 and 500),
  decided_by uuid references auth.users (id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id),
  unique (request_id, source, source_id),
  foreign key (request_id, organization_id) references public.privacy_requests (id, organization_id),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id),
  check ((decision = 'include') = (reason is null)),
  check ((decision = 'include') = (third_party is null)),
  check ((decision = 'redact') = (cardinality(withheld_fields) > 0)),
  check ((decided_at is null) = (decided_by is null))
);
comment on table public.privacy_request_items is
  'What the scope search of an access or correction request found in this firm (SEC-06), with the decision for each: include, withhold the whole record, or withhold some fields, with the reason shown to the person and the third party (staff only).';

create index privacy_request_items_request_fk_idx on public.privacy_request_items (request_id, organization_id);
create index privacy_request_items_matter_fk_idx on public.privacy_request_items (matter_id, organization_id);
create index privacy_request_items_decided_by_idx on public.privacy_request_items (decided_by);
create index privacy_request_items_created_by_idx on public.privacy_request_items (created_by);

create trigger privacy_request_items_touch before update on public.privacy_request_items
  for each row execute function app.touch_row();
create trigger privacy_request_items_keys before update on public.privacy_request_items
  for each row execute function app.guard_tenant_keys();
create trigger privacy_request_items_stamp before insert on public.privacy_request_items
  for each row execute function app.stamp_created_by();
create trigger privacy_request_items_no_delete before delete on public.privacy_request_items
  for each row execute function app.reject_governed_delete();

-- A withheld item is also a line of the request's redaction worklist.
alter table public.privacy_request_redactions
  add column item_id uuid,
  add constraint privacy_request_redactions_item_fk
    foreign key (item_id, organization_id) references public.privacy_request_items (id, organization_id);
create unique index privacy_request_redactions_item_uidx on public.privacy_request_redactions (item_id) where item_id is not null;
create index privacy_request_redactions_item_fk_idx on public.privacy_request_redactions (item_id, organization_id);

-- ---------------------------------------------------------------------------
-- 4. Response packages
-- ---------------------------------------------------------------------------

create table public.privacy_request_responses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  request_id uuid not null,
  status text not null default 'building' check (status in ('building', 'ready', 'failed', 'superseded')),
  storage_bucket text check (storage_bucket is null or storage_bucket = 'matter-exports'),
  storage_key text check (storage_key is null or length(storage_key) between 10 and 400),
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  manifest_sha256 text check (manifest_sha256 is null or manifest_sha256 ~ '^[0-9a-f]{64}$'),
  byte_size bigint check (byte_size is null or byte_size > 0),
  file_count integer check (file_count is null or file_count >= 0),
  record_count integer check (record_count is null or record_count >= 0),
  withheld_count integer check (withheld_count is null or withheld_count >= 0),
  contents jsonb,
  excluded jsonb check (excluded is null or jsonb_typeof(excluded) = 'array'),
  requested_by uuid not null references auth.users (id),
  requested_at timestamptz not null default now(),
  ready_at timestamptz,
  failed_reason text check (failed_reason is null or length(failed_reason) <= 300),
  idempotency_key text not null check (length(idempotency_key) between 8 and 180),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id),
  unique (organization_id, idempotency_key),
  foreign key (request_id, organization_id) references public.privacy_requests (id, organization_id),
  check (status not in ('ready', 'superseded') or (
    storage_bucket is not null and storage_key is not null and sha256 is not null and manifest_sha256 is not null
    and byte_size is not null and file_count is not null and ready_at is not null
  ))
);
comment on table public.privacy_request_responses is
  'Response packages of an access request (SEC-06): a ZIP of the person''s records with withheld items and fields removed, a SHA-256 manifest and a PDF summary, in the private matter-exports bucket. Written only by functions; never deleted.';

create unique index privacy_request_responses_one_building_idx on public.privacy_request_responses (request_id) where status = 'building';
create index privacy_request_responses_request_fk_idx on public.privacy_request_responses (request_id, organization_id);
create index privacy_request_responses_requested_by_idx on public.privacy_request_responses (requested_by);
create index privacy_request_responses_created_by_idx on public.privacy_request_responses (created_by);

-- A built package never changes; only a ready one is later superseded by a newer build.
create function app.guard_privacy_response_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status <> 'building'
     and (new.sha256, new.manifest_sha256, new.storage_key, new.byte_size, new.file_count)
         is distinct from (old.sha256, old.manifest_sha256, old.storage_key, old.byte_size, old.file_count) then
    raise exception 'a built response package does not change' using errcode = '42501';
  end if;
  if old.status is distinct from new.status and not (
    (old.status = 'building' and new.status in ('ready', 'failed'))
    or (old.status = 'ready' and new.status = 'superseded')
  ) then
    raise exception 'response package status change not allowed' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.guard_privacy_response_change() from public;

create trigger privacy_request_responses_guard before update on public.privacy_request_responses
  for each row execute function app.guard_privacy_response_change();
create trigger privacy_request_responses_touch before update on public.privacy_request_responses
  for each row execute function app.touch_row();
create trigger privacy_request_responses_keys before update on public.privacy_request_responses
  for each row execute function app.guard_tenant_keys();
create trigger privacy_request_responses_stamp before insert on public.privacy_request_responses
  for each row execute function app.stamp_created_by();
create trigger privacy_request_responses_no_delete before delete on public.privacy_request_responses
  for each row execute function app.reject_governed_delete();

-- ---------------------------------------------------------------------------
-- 5. Delivery through the portal, and every download
-- ---------------------------------------------------------------------------

create table public.privacy_request_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  request_id uuid not null,
  response_id uuid not null,
  person_id uuid not null,
  delivered_by uuid not null references auth.users (id),
  delivered_at timestamptz not null default now(),
  expires_at timestamptz not null,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  download_count integer not null default 0 check (download_count >= 0),
  first_downloaded_at timestamptz,
  last_downloaded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id),
  unique (request_id),
  foreign key (request_id, organization_id) references public.privacy_requests (id, organization_id),
  foreign key (response_id, organization_id) references public.privacy_request_responses (id, organization_id),
  foreign key (person_id, organization_id) references public.persons (id, organization_id),
  check (expires_at > delivered_at),
  check ((download_count = 0) = (first_downloaded_at is null)),
  check ((first_downloaded_at is null) = (last_downloaded_at is null))
);
comment on table public.privacy_request_deliveries is
  'An access request''s response package delivered through the portal (SEC-06): who delivered it, when, the package hash, and how often and when the person downloaded it. The delivery proof. Never deleted.';

create index privacy_request_deliveries_response_fk_idx on public.privacy_request_deliveries (response_id, organization_id);
create index privacy_request_deliveries_person_fk_idx on public.privacy_request_deliveries (person_id, organization_id);
create index privacy_request_deliveries_delivered_by_idx on public.privacy_request_deliveries (delivered_by);
create index privacy_request_deliveries_created_by_idx on public.privacy_request_deliveries (created_by);
create index privacy_request_deliveries_request_fk_idx on public.privacy_request_deliveries (request_id, organization_id);

create trigger privacy_request_deliveries_touch before update on public.privacy_request_deliveries
  for each row execute function app.touch_row();
create trigger privacy_request_deliveries_keys before update on public.privacy_request_deliveries
  for each row execute function app.guard_tenant_keys();
create trigger privacy_request_deliveries_stamp before insert on public.privacy_request_deliveries
  for each row execute function app.stamp_created_by();
create trigger privacy_request_deliveries_no_delete before delete on public.privacy_request_deliveries
  for each row execute function app.reject_governed_delete();

create table public.privacy_response_downloads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  delivery_id uuid not null,
  user_id uuid not null references auth.users (id),
  downloaded_at timestamptz not null default now(),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  foreign key (delivery_id, organization_id) references public.privacy_request_deliveries (id, organization_id)
);
comment on table public.privacy_response_downloads is
  'Each download of a delivered privacy response by the person (SEC-06): who, when, and the hash of the package served. Append-only.';

create index privacy_response_downloads_delivery_fk_idx on public.privacy_response_downloads (delivery_id, organization_id);
create index privacy_response_downloads_user_idx on public.privacy_response_downloads (user_id);

create trigger privacy_response_downloads_append_only before update or delete on public.privacy_response_downloads
  for each row execute function app.gov_reject_mutation();

-- ---------------------------------------------------------------------------
-- Functions: legal time limits
-- ---------------------------------------------------------------------------

-- Entered by privacy staff from an official law page. p_snapshot is the app's server-side capture
-- ({sha256, retrieved_at, final_url, http_status}) or null when the page couldn't be fetched (then a
-- reviewer approves only by attesting they opened the page). Same source handling as
-- app.propose_renewal_timing (20261025210000_dec_renewal.sql).
create function app.propose_privacy_time_limit(
  p_org uuid,
  p_kind text,
  p_law_name text,
  p_provision_text text,
  p_days integer,
  p_source_url text,
  p_source_section text,
  p_checked_on date,
  p_current_to date,
  p_snapshot jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text := btrim(coalesce(p_source_url, ''));
  v_canonical text;
  v_host text;
  v_publisher text;
  v_today date;
  v_src uuid;
  v_snap uuid;
  v_hash text;
  v_final text;
  v_retrieved timestamptz;
  v_no integer;
  v_id uuid;
begin
  perform app.require_active_staff(p_org, array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[], false);
  v_today := app.firm_today(p_org);
  if p_kind is null or p_kind not in ('response', 'extension') then
    raise exception 'choose whether this is the time to respond or the extension' using errcode = '22023';
  end if;
  if p_law_name is null or length(btrim(p_law_name)) not between 3 and 200 then
    raise exception 'name the law as the official page does' using errcode = '22023';
  end if;
  if p_provision_text is null or length(btrim(p_provision_text)) not between 3 and 1500 then
    raise exception 'copy the provision word for word, as the official page gives it' using errcode = '22023';
  end if;
  if p_days is not null and p_days not between 1 and 365 then
    raise exception 'the days must be between 1 and 365, and only when the provision states a number' using errcode = '22023';
  end if;
  v_host := app.federal_official_url(v_url);
  if v_host is null then
    raise exception 'the source must be an official Government of Canada page (canada.ca or gc.ca, such as Justice Laws)' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_source_section, '')), '') is null or length(btrim(p_source_section)) > 200 then
    raise exception 'name the section of the law' using errcode = '22023';
  end if;
  if p_checked_on is null or p_checked_on > v_today or p_checked_on < v_today - 366 then
    raise exception 'the date checked is required, within the last year and not in the future' using errcode = '22023';
  end if;
  if p_current_to is not null and p_current_to > v_today then
    raise exception 'a current-to date cannot be in the future' using errcode = '22023';
  end if;
  if p_snapshot is not null then
    v_hash := lower(btrim(coalesce(p_snapshot ->> 'sha256', '')));
    v_final := btrim(coalesce(p_snapshot ->> 'final_url', v_url));
    v_retrieved := (p_snapshot ->> 'retrieved_at')::timestamptz;
    if v_hash !~ '^[0-9a-f]{64}$' then
      raise exception 'the page hash is invalid' using errcode = '22023';
    end if;
    if v_retrieved is null or v_retrieved > statement_timestamp() + interval '5 minutes' or v_retrieved < statement_timestamp() - interval '1 day' then
      raise exception 'the retrieval time must be now' using errcode = '22023';
    end if;
    if app.federal_official_url(v_final) is null then
      raise exception 'the source must be an official Government of Canada page (canada.ca or gc.ca, such as Justice Laws)' using errcode = '22023';
    end if;
  end if;

  v_canonical := split_part(v_url, '#', 1);
  select domain.authority into v_publisher
  from public.official_source_domains domain
  where domain.active and (v_host = domain.host or right(v_host, length(domain.host) + 1) = '.' || domain.host)
  order by length(domain.host) desc
  limit 1;

  select source.id into v_src
  from public.official_sources source
  where source.organization_id = p_org and source.canonical_url = v_canonical;
  if v_src is null then
    insert into public.official_sources (organization_id, publisher, canonical_url, allowed_host, jurisdiction, content_kind, title, source_language)
    values (p_org, coalesce(v_publisher, 'Government of Canada'), v_canonical, v_host, 'CA', 'legislation',
            left(btrim(p_law_name), 300), 'en')
    returning id into v_src;
  end if;
  if v_hash is not null then
    select snapshot.id into v_snap
    from public.source_snapshots snapshot
    where snapshot.source_id = v_src and snapshot.content_hash = v_hash
    order by snapshot.snapshot_number desc
    limit 1;
    if v_snap is null then
      select coalesce(max(snapshot.snapshot_number), 0) + 1 into v_no
      from public.source_snapshots snapshot
      where snapshot.source_id = v_src;
      insert into public.source_snapshots (
        organization_id, source_id, snapshot_number, final_url, publisher, retrieved_at, current_to, content_hash,
        retrieval_result, http_status, review_status
      ) values (
        p_org, v_src, v_no, v_final, coalesce(v_publisher, 'Government of Canada'), v_retrieved, p_current_to, v_hash,
        'success', nullif(p_snapshot ->> 'http_status', '')::integer, 'evidence_captured'
      )
      returning id into v_snap;
    end if;
  end if;

  insert into public.privacy_time_limits (
    organization_id, kind, law_name, provision_text, days, source_id, snapshot_id, source_url, source_section,
    checked_on, current_to, snapshot_sha256
  ) values (
    p_org, p_kind, btrim(p_law_name), btrim(p_provision_text), p_days, v_src, v_snap, v_url, btrim(p_source_section),
    p_checked_on, p_current_to, v_hash
  )
  returning id into v_id;
  perform app.record_audit_event(
    p_org, 'privacy.time_limit_entered', 'public.privacy_time_limits', v_id, 'success',
    jsonb_build_object('kind', p_kind, 'source_url', v_url, 'source_section', btrim(p_source_section), 'days', p_days,
                       'current_to', p_current_to, 'snapshot_sha256', v_hash)
  );
  return v_id;
end;
$$;
revoke all on function app.propose_privacy_time_limit(uuid, text, text, text, integer, text, text, date, date, jsonb) from public, anon;
grant execute on function app.propose_privacy_time_limit(uuid, text, text, text, integer, text, text, date, date, jsonb) to authenticated;

-- A licensed member (fresh step-up) approves or rejects a pending time limit, under the GOV review
-- rules: no snapshot needs the reviewer's attestation; own entries only when no one else can review.
create function app.review_privacy_time_limit(
  p_limit_id uuid, p_expected_version integer, p_decision text, p_note text, p_page_opened_on date
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.privacy_time_limits%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_version integer;
  v_reviewer uuid;
  v_opened date;
  v_self boolean := false;
begin
  select * into v_row from public.privacy_time_limits where id = p_limit_id for update;
  if v_row.id is null or v_row.organization_id is distinct from app.current_organization_id() then
    raise exception 'time limit review denied' using errcode = '42501';
  end if;
  perform app.require_licensed_staff(v_row.organization_id, true);
  if v_row.version is distinct from p_expected_version then
    raise exception 'time limit version conflict' using errcode = 'PT409';
  end if;
  if v_row.status <> 'pending_review' then
    raise exception 'nothing is waiting for review' using errcode = '22023';
  end if;
  if p_decision is null or p_decision not in ('approved', 'rejected') then
    raise exception 'unknown decision' using errcode = '22023';
  end if;
  if p_decision = 'rejected' and (v_note is null or length(v_note) < 3) then
    raise exception 'say why it''s rejected' using errcode = '22023';
  end if;
  if p_decision = 'approved' then
    v_opened := app.gov_check_page_attestation(v_row.organization_id, v_row.snapshot_sha256 is not null, p_page_opened_on, v_row.created_at);
    v_self := app.gov_check_self_approval(v_row.organization_id, v_row.created_by, v_row.created_at);
  end if;
  v_reviewer := app.gov_actor_membership(v_row.organization_id);
  perform app.gov_open_write(v_row.id);
  update public.privacy_time_limits
  set status = p_decision,
      reviewed_by_membership_id = v_reviewer,
      reviewed_at = statement_timestamp(),
      review_note = left(v_note, 500),
      page_attested_by_membership_id = case when v_opened is null then null else v_reviewer end,
      page_attested_on = v_opened,
      page_attested_at = case when v_opened is null then null else statement_timestamp() end
  where id = v_row.id
  returning version into v_version;
  perform app.gov_close_write(v_row.id);
  perform app.record_audit_event(
    v_row.organization_id, 'privacy.time_limit_' || p_decision || case when v_self then '_self' else '' end,
    'public.privacy_time_limits', v_row.id, 'success',
    jsonb_build_object('kind', v_row.kind, 'source_url', v_row.source_url, 'snapshot_sha256', v_row.snapshot_sha256,
                       'days', v_row.days, 'page_attested_on', v_opened, 'self_approved', v_self)
  );
  return v_version;
end;
$$;
revoke all on function app.review_privacy_time_limit(uuid, integer, text, text, date) from public, anon;
grant execute on function app.review_privacy_time_limit(uuid, integer, text, text, date) to authenticated;

-- A licensed member (fresh step-up) retires an approved time limit that no longer matches the law.
create function app.retire_privacy_time_limit(p_limit_id uuid, p_expected_version integer, p_reason text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.privacy_time_limits%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_version integer;
begin
  if v_reason is null or length(v_reason) not between 3 and 500 then
    raise exception 'say why it''s retired' using errcode = '22023';
  end if;
  select * into v_row from public.privacy_time_limits where id = p_limit_id for update;
  if v_row.id is null or v_row.organization_id is distinct from app.current_organization_id() then
    raise exception 'time limit review denied' using errcode = '42501';
  end if;
  perform app.require_licensed_staff(v_row.organization_id, true);
  if v_row.version is distinct from p_expected_version then
    raise exception 'time limit version conflict' using errcode = 'PT409';
  end if;
  if v_row.status <> 'approved' then
    raise exception 'only an approved time limit is retired' using errcode = '22023';
  end if;
  perform app.gov_open_write(v_row.id);
  update public.privacy_time_limits
  set status = 'retired', retired_at = statement_timestamp(), review_note = v_reason
  where id = v_row.id
  returning version into v_version;
  perform app.gov_close_write(v_row.id);
  perform app.record_audit_event(
    v_row.organization_id, 'privacy.time_limit_retired', 'public.privacy_time_limits', v_row.id, 'success',
    jsonb_build_object('reason', v_reason)
  );
  return v_version;
end;
$$;
revoke all on function app.retire_privacy_time_limit(uuid, integer, text) from public, anon;
grant execute on function app.retire_privacy_time_limit(uuid, integer, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Functions: extension
-- ---------------------------------------------------------------------------

-- True when the person has a portal login in this firm (an active membership of their user).
create function app.privacy_person_has_portal(p_org uuid, p_person_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.persons person
    join public.memberships mem on mem.user_id = person.user_id and mem.organization_id = person.organization_id
    where person.id = p_person_id
      and person.organization_id = p_org
      and person.user_id is not null
      and mem.status = 'active'
  );
$$;
revoke all on function app.privacy_person_has_portal(uuid, uuid) from public, anon, authenticated;

create function app.extend_privacy_request(
  p_request_id uuid,
  p_new_due_on date,
  p_reason text,
  p_time_limit_id uuid,
  p_recourse text,
  p_notice_method text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req public.privacy_requests%rowtype;
  v_ext public.privacy_time_limits%rowtype;
  v_resp public.privacy_time_limits%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_recourse text := nullif(btrim(coalesce(p_recourse, '')), '');
  v_method text := nullif(btrim(coalesce(p_notice_method, '')), '');
  v_today date;
  v_base date;
  v_channel text;
  v_late boolean;
begin
  select * into v_req from public.privacy_requests where id = p_request_id;
  if v_req.id is null or app.can_work_privacy_request(v_req.organization_id, v_req.assignee_membership_id) is distinct from true then
    raise exception 'privacy request access denied' using errcode = '42501';
  end if;
  select * into v_req from public.privacy_requests where id = v_req.id for update;
  if v_req.closed_at is not null then
    raise exception 'this request is closed' using errcode = '22023';
  end if;
  if v_req.kind not in ('access', 'correction') then
    raise exception 'only an access or correction request is extended' using errcode = '22023';
  end if;
  if v_req.extended_at is not null then
    raise exception 'this request is already extended' using errcode = '22023';
  end if;
  if v_reason is null or length(v_reason) not between 3 and 500 then
    raise exception 'give the reason for the extension' using errcode = '22023';
  end if;
  if v_recourse is not null and length(v_recourse) not between 3 and 500 then
    raise exception 'write their recourse in 3 to 500 characters' using errcode = '22023';
  end if;
  v_today := app.firm_today(v_req.organization_id);
  if p_new_due_on is null or p_new_due_on <= v_today then
    raise exception 'the new due date must be after today' using errcode = '22023';
  end if;
  if v_req.due_on is not null and p_new_due_on <= v_req.due_on then
    raise exception 'the new due date must be after the current one' using errcode = '22023';
  end if;
  if p_new_due_on > v_req.received_on + 365 then
    raise exception 'the new due date is too far from the received date' using errcode = '22023';
  end if;

  if p_time_limit_id is not null then
    select * into v_ext from public.privacy_time_limits
    where id = p_time_limit_id and organization_id = v_req.organization_id and status = 'approved' and kind = 'extension';
    if v_ext.id is null then
      raise exception 'choose an approved official extension' using errcode = '22023';
    end if;
    select * into v_resp from public.privacy_time_limits
    where organization_id = v_req.organization_id and status = 'approved' and kind = 'response'
      and source_id = v_ext.source_id and days is not null
    order by reviewed_at desc
    limit 1;
    if v_resp.id is null then
      raise exception 'approve the official time to respond from the same law first' using errcode = '22023';
    end if;
    v_base := v_req.received_on + v_resp.days;
    if v_ext.days is not null and p_new_due_on > v_base + v_ext.days then
      raise exception 'that is later than the official extension allows' using errcode = '22023';
    end if;
    v_late := v_today > v_base;
  end if;

  if v_req.person_id is not null and app.privacy_person_has_portal(v_req.organization_id, v_req.person_id) then
    v_channel := 'portal';
  else
    if v_method is null or length(v_method) not between 3 and 200 then
      raise exception 'they have no portal login: say how you told them about the extension' using errcode = '22023';
    end if;
    v_channel := 'other';
  end if;

  update public.privacy_requests
  set extended_due_on = p_new_due_on,
      extension_basis = case when v_ext.id is null then 'firm' else 'official' end,
      extension_time_limit_id = v_ext.id,
      extension_reason = v_reason,
      extension_recourse = v_recourse,
      extended_at = clock_timestamp(),
      extended_by = (select auth.uid()),
      extension_notice_channel = v_channel,
      extension_notice_method = case when v_channel = 'other' then v_method else null end,
      extension_notice_late = v_late
  where id = v_req.id;
  perform app.record_audit_event(
    v_req.organization_id, 'privacy.request_extended', 'public.privacy_requests', v_req.id, 'success',
    jsonb_build_object('basis', case when v_ext.id is null then 'firm' else 'official' end, 'time_limit_id', v_ext.id,
                       'previous_due_on', v_req.due_on, 'new_due_on', p_new_due_on, 'notice_channel', v_channel,
                       'notice_late', v_late)
  );
end;
$$;
revoke all on function app.extend_privacy_request(uuid, date, text, uuid, text, text) from public, anon;
grant execute on function app.extend_privacy_request(uuid, date, text, uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Functions: scope search and redaction decisions
-- ---------------------------------------------------------------------------

-- The fields of a record a reviewer may withhold: every column except keys and bookkeeping.
create function app.privacy_item_fields(p_row jsonb)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(k order by k), '{}')
  from jsonb_object_keys(coalesce(p_row, '{}'::jsonb)) as k
  where k not in ('id', 'organization_id', 'created_at', 'updated_at', 'created_by', 'version', 'is_sample', 'sample_label', 'idempotency_key');
$$;
revoke all on function app.privacy_item_fields(jsonb) from public, anon, authenticated;

-- Lists the person's records in this firm on the request (re-runnable: only new records are added),
-- and records the scope step when it isn't yet. Returns how many records of each kind were found.
create function app.privacy_scope_search(p_request_id uuid)
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

  insert into public.privacy_request_items (organization_id, request_id, source, source_id, matter_id, label, fields)
  select v_org, v_req.id, found.source, found.source_id, found.matter_id, left(found.label, 300), found.fields
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
  limit 1000
  on conflict (request_id, source, source_id) do nothing;
  get diagnostics v_added = row_count;

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
revoke all on function app.privacy_scope_search(uuid) from public, anon;
grant execute on function app.privacy_scope_search(uuid) to authenticated;

-- Include an item, withhold it, or withhold some of its fields, with a reason (shown to the person)
-- and the third party (staff only). A withheld item is a "redacted" line of the worklist; an item
-- put back to include keeps its line, marked "kept, reviewed".
create function app.decide_privacy_item(
  p_item_id uuid,
  p_decision text,
  p_fields text[],
  p_third_party text,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.privacy_request_items%rowtype;
  v_req public.privacy_requests%rowtype;
  v_fields text[];
  v_party text := nullif(btrim(coalesce(p_third_party, '')), '');
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_removed text;
  v_line uuid;
  v_actor uuid := (select auth.uid());
begin
  select * into v_item from public.privacy_request_items where id = p_item_id;
  if v_item.id is null then
    raise exception 'privacy request access denied' using errcode = '42501';
  end if;
  select * into v_req from public.privacy_requests where id = v_item.request_id;
  if app.can_work_privacy_request(v_req.organization_id, v_req.assignee_membership_id) is distinct from true then
    raise exception 'privacy request access denied' using errcode = '42501';
  end if;
  select * into v_req from public.privacy_requests where id = v_req.id for update;
  if v_req.closed_at is not null or v_req.redaction_at is not null then
    raise exception 'the redaction worklist is closed' using errcode = '22023';
  end if;
  if p_decision is null or p_decision not in ('include', 'withhold', 'redact') then
    raise exception 'choose a decision' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct f order by f), '{}') into v_fields
  from unnest(coalesce(p_fields, '{}')) as f
  where f is not null;
  if p_decision = 'redact' and (cardinality(v_fields) = 0 or not (v_fields <@ v_item.fields)) then
    raise exception 'choose the fields to withhold' using errcode = '22023';
  end if;
  if p_decision <> 'include' then
    if v_party is null or length(v_party) > 200 then
      raise exception 'name whose information it is' using errcode = '22023';
    end if;
    if v_reason is null or length(v_reason) not between 3 and 500 then
      raise exception 'give the reason in 3 to 500 characters' using errcode = '22023';
    end if;
  end if;

  update public.privacy_request_items
  set decision = p_decision,
      withheld_fields = case when p_decision = 'redact' then v_fields else '{}' end,
      third_party = case when p_decision = 'include' then null else v_party end,
      reason = case when p_decision = 'include' then null else v_reason end,
      decided_by = v_actor,
      decided_at = clock_timestamp()
  where id = v_item.id;

  v_removed := case p_decision
    when 'withhold' then 'Whole record withheld'
    when 'redact' then left('Fields withheld: ' || array_to_string(v_fields, ', '), 500)
    else 'Nothing withheld'
  end;
  select id into v_line from public.privacy_request_redactions where item_id = v_item.id;
  if v_line is null then
    if p_decision <> 'include' then
      insert into public.privacy_request_redactions (organization_id, request_id, record_label, third_party, removed, state, done_by, done_at, item_id)
      values (v_req.organization_id, v_req.id, left(v_item.label, 200), v_party, v_removed, 'redacted', v_actor, clock_timestamp(), v_item.id);
    end if;
  else
    update public.privacy_request_redactions
    set record_label = left(v_item.label, 200),
        third_party = coalesce(v_party, third_party),
        removed = v_removed,
        state = case when p_decision = 'include' then 'kept' else 'redacted' end::public.privacy_redaction_state,
        done_by = v_actor,
        done_at = clock_timestamp()
    where id = v_line;
  end if;
  perform app.record_audit_event(
    v_req.organization_id, 'privacy.item_decided', 'public.privacy_request_items', v_item.id, 'success',
    jsonb_build_object('request_id', v_req.id, 'decision', p_decision, 'fields', to_jsonb(v_fields))
  );
end;
$$;
revoke all on function app.decide_privacy_item(uuid, text, text[], text, text) from public, anon;
grant execute on function app.decide_privacy_item(uuid, text, text[], text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Functions: response package
-- ---------------------------------------------------------------------------

create function app.start_privacy_response(p_request_id uuid, p_idempotency_key text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req public.privacy_requests%rowtype;
  v_key text := btrim(coalesce(p_idempotency_key, ''));
  v_existing uuid;
  v_id uuid;
begin
  select * into v_req from public.privacy_requests where id = p_request_id;
  if v_req.id is null or app.can_work_privacy_request(v_req.organization_id, v_req.assignee_membership_id) is distinct from true then
    raise exception 'privacy request access denied' using errcode = '42501';
  end if;
  if app.mfa_step_up_satisfied() is distinct from true then
    raise exception 'step-up is required' using errcode = '42501';
  end if;
  if length(v_key) not between 8 and 180 then
    raise exception 'idempotency key is required' using errcode = '22023';
  end if;
  select * into v_req from public.privacy_requests where id = v_req.id for update;
  select id into v_existing from public.privacy_request_responses where organization_id = v_req.organization_id and idempotency_key = v_key;
  if v_existing is not null then
    return v_existing;
  end if;
  if v_req.closed_at is not null then
    raise exception 'this request is closed' using errcode = '22023';
  end if;
  if v_req.kind <> 'access' then
    raise exception 'only an access request has a response package' using errcode = '22023';
  end if;
  if v_req.identity_verified_at is null then
    raise exception 'verify identity first' using errcode = '22023';
  end if;
  if not exists (select 1 from public.privacy_request_items where request_id = v_req.id) then
    raise exception 'run the scope search first' using errcode = '22023';
  end if;
  if v_req.redaction_at is null then
    raise exception 'finish the redaction step first' using errcode = '22023';
  end if;
  if exists (select 1 from public.privacy_request_responses where request_id = v_req.id and status = 'building') then
    raise exception 'a package is already being built' using errcode = '22023';
  end if;
  insert into public.privacy_request_responses (organization_id, request_id, requested_by, idempotency_key)
  values (v_req.organization_id, v_req.id, (select auth.uid()), v_key)
  returning id into v_id;
  perform app.record_audit_event(
    v_req.organization_id, 'privacy.response_started', 'public.privacy_request_responses', v_id, 'success',
    jsonb_build_object('request_id', v_req.id)
  );
  return v_id;
end;
$$;
revoke all on function app.start_privacy_response(uuid, text) from public, anon;
grant execute on function app.start_privacy_response(uuid, text) to authenticated;

-- Service role only: the app stored the ZIP; mark it ready and supersede older ready packages.
create function public.service_complete_privacy_response(
  p_response_id uuid,
  p_storage_key text,
  p_sha256 text,
  p_byte_size bigint,
  p_file_count integer,
  p_record_count integer,
  p_manifest_sha256 text,
  p_withheld_count integer,
  p_contents jsonb,
  p_excluded jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.privacy_request_responses%rowtype;
begin
  select * into v_job from public.privacy_request_responses where id = p_response_id for update;
  if v_job.id is null or v_job.status <> 'building' then
    return false;
  end if;
  update public.privacy_request_responses
  set status = 'superseded'
  where request_id = v_job.request_id and status = 'ready';
  update public.privacy_request_responses
  set status = 'ready', storage_bucket = 'matter-exports', storage_key = p_storage_key, sha256 = lower(p_sha256),
      manifest_sha256 = lower(p_manifest_sha256), byte_size = p_byte_size, file_count = p_file_count,
      record_count = p_record_count, withheld_count = p_withheld_count, contents = p_contents,
      excluded = coalesce(p_excluded, '[]'::jsonb), ready_at = clock_timestamp()
  where id = v_job.id;
  perform app.record_audit_event(
    v_job.organization_id, 'privacy.response_ready', 'public.privacy_request_responses', v_job.id, 'success',
    jsonb_build_object('request_id', v_job.request_id, 'sha256', lower(p_sha256), 'file_count', p_file_count,
                       'record_count', p_record_count, 'withheld_count', p_withheld_count)
  );
  return true;
end;
$$;
revoke all on function public.service_complete_privacy_response(uuid, text, text, bigint, integer, integer, text, integer, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.service_complete_privacy_response(uuid, text, text, bigint, integer, integer, text, integer, jsonb, jsonb) to service_role;

create function public.service_fail_privacy_response(p_response_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.privacy_request_responses%rowtype;
begin
  select * into v_job from public.privacy_request_responses where id = p_response_id for update;
  if v_job.id is null or v_job.status <> 'building' then
    return;
  end if;
  update public.privacy_request_responses
  set status = 'failed', failed_reason = left(coalesce(p_reason, 'The package could not be built.'), 300)
  where id = v_job.id;
  perform app.record_audit_event(
    v_job.organization_id, 'privacy.response_failed', 'public.privacy_request_responses', v_job.id, 'failure',
    jsonb_build_object('request_id', v_job.request_id)
  );
end;
$$;
revoke all on function public.service_fail_privacy_response(uuid, text) from public, anon, authenticated;
grant execute on function public.service_fail_privacy_response(uuid, text) to service_role;

-- Staff who work the request (fresh step-up) open the package themselves. Not delivery proof.
create function app.authorize_privacy_response_preview(p_response_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.privacy_request_responses%rowtype;
  v_req public.privacy_requests%rowtype;
begin
  select * into v_job from public.privacy_request_responses where id = p_response_id;
  if v_job.id is null then
    raise exception 'privacy request access denied' using errcode = '42501';
  end if;
  select * into v_req from public.privacy_requests where id = v_job.request_id;
  if app.can_work_privacy_request(v_req.organization_id, v_req.assignee_membership_id) is distinct from true then
    raise exception 'privacy request access denied' using errcode = '42501';
  end if;
  if app.mfa_step_up_satisfied() is distinct from true then
    raise exception 'step-up is required' using errcode = '42501';
  end if;
  if v_job.status not in ('ready', 'superseded') then
    raise exception 'that package is not ready' using errcode = '22023';
  end if;
  perform app.record_audit_event(
    v_job.organization_id, 'privacy.response_previewed', 'public.privacy_request_responses', v_job.id, 'success',
    jsonb_build_object('request_id', v_req.id, 'sha256', v_job.sha256)
  );
  return jsonb_build_object('bucket', v_job.storage_bucket, 'storage_key', v_job.storage_key, 'seconds', 60, 'sha256', v_job.sha256);
end;
$$;
revoke all on function app.authorize_privacy_response_preview(uuid) from public, anon;
grant execute on function app.authorize_privacy_response_preview(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Functions: delivery and download
-- ---------------------------------------------------------------------------

-- Staff who work the request (fresh step-up) deliver the latest ready package through the portal
-- after the review, and the request closes with the package hash as its evidence.
create function app.deliver_privacy_response(p_request_id uuid, p_response_id uuid, p_outcome text, p_note text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req public.privacy_requests%rowtype;
  v_job public.privacy_request_responses%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_id uuid;
  v_now timestamptz := clock_timestamp();
begin
  select * into v_req from public.privacy_requests where id = p_request_id;
  if v_req.id is null or app.can_work_privacy_request(v_req.organization_id, v_req.assignee_membership_id) is distinct from true then
    raise exception 'privacy request access denied' using errcode = '42501';
  end if;
  if app.mfa_step_up_satisfied() is distinct from true then
    raise exception 'step-up is required' using errcode = '42501';
  end if;
  select * into v_req from public.privacy_requests where id = v_req.id for update;
  if v_req.closed_at is not null then
    raise exception 'this request is closed' using errcode = '22023';
  end if;
  if v_req.kind <> 'access' then
    raise exception 'only an access request has a response package' using errcode = '22023';
  end if;
  if v_req.reviewed_at is null then
    raise exception 'record the review first' using errcode = '22023';
  end if;
  select * into v_job from public.privacy_request_responses
  where id = p_response_id and request_id = v_req.id and organization_id = v_req.organization_id;
  if v_job.id is null or v_job.status <> 'ready' then
    raise exception 'build the response package first' using errcode = '22023';
  end if;
  if v_req.person_id is null or not app.privacy_person_has_portal(v_req.organization_id, v_req.person_id) then
    raise exception 'they have no portal login to download it: deliver it another way and close the request' using errcode = '22023';
  end if;
  if p_outcome is null or p_outcome not in ('fulfilled', 'partly_fulfilled') then
    raise exception 'choose an outcome' using errcode = '22023';
  end if;
  if v_note is not null and length(v_note) not between 3 and 2000 then
    raise exception 'a note is too short or too long' using errcode = '22023';
  end if;

  insert into public.privacy_request_deliveries (organization_id, request_id, response_id, person_id, delivered_by, delivered_at, expires_at, sha256)
  values (v_req.organization_id, v_req.id, v_job.id, v_req.person_id, (select auth.uid()), v_now, v_now + interval '30 days', v_job.sha256)
  returning id into v_id;
  update public.privacy_requests
  set closed_at = v_now,
      closed_by = (select auth.uid()),
      outcome = p_outcome::public.privacy_request_outcome,
      outcome_note = v_note,
      delivery_method = 'Client portal download',
      evidence_note = left(format(
        'Response package delivered through the client portal: %s files, %s records, %s withheld, SHA-256 %s.',
        v_job.file_count, coalesce(v_job.record_count, 0), coalesce(v_job.withheld_count, 0), v_job.sha256
      ), 2000)
  where id = v_req.id;
  perform app.record_audit_event(
    v_req.organization_id, 'privacy.response_delivered', 'public.privacy_request_deliveries', v_id, 'success',
    jsonb_build_object('request_id', v_req.id, 'response_id', v_job.id, 'sha256', v_job.sha256, 'outcome', p_outcome)
  );
  return v_id;
end;
$$;
revoke all on function app.deliver_privacy_response(uuid, uuid, text, text) from public, anon;
grant execute on function app.deliver_privacy_response(uuid, uuid, text, text) to authenticated;

-- The person (their own portal login, active in this firm) downloads their delivered package. Each
-- download is recorded with the hash served, and audited: the delivery proof.
create function app.authorize_privacy_response_download(p_delivery_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delivery public.privacy_request_deliveries%rowtype;
  v_job public.privacy_request_responses%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  select delivery.* into v_delivery
  from public.privacy_request_deliveries delivery
  join public.persons person on person.id = delivery.person_id and person.organization_id = delivery.organization_id
  where delivery.id = p_delivery_id
    and person.user_id = (select auth.uid())
    and app.privacy_person_has_portal(delivery.organization_id, delivery.person_id)
  for update of delivery;
  if v_delivery.id is null then
    raise exception 'privacy response access denied' using errcode = '42501';
  end if;
  if v_delivery.expires_at < v_now then
    raise exception 'this download has expired: ask the firm for a new copy' using errcode = '22023';
  end if;
  select * into v_job from public.privacy_request_responses where id = v_delivery.response_id;
  if v_job.storage_key is null then
    raise exception 'privacy response access denied' using errcode = '42501';
  end if;
  insert into public.privacy_response_downloads (organization_id, delivery_id, user_id, downloaded_at, sha256)
  values (v_delivery.organization_id, v_delivery.id, (select auth.uid()), v_now, v_job.sha256);
  update public.privacy_request_deliveries
  set download_count = download_count + 1,
      first_downloaded_at = coalesce(first_downloaded_at, v_now),
      last_downloaded_at = v_now
  where id = v_delivery.id;
  perform app.record_audit_event(
    v_delivery.organization_id, 'privacy.response_downloaded', 'public.privacy_request_deliveries', v_delivery.id, 'success',
    jsonb_build_object('request_id', v_delivery.request_id, 'sha256', v_job.sha256)
  );
  return jsonb_build_object('bucket', v_job.storage_bucket, 'storage_key', v_job.storage_key, 'seconds', 60, 'sha256', v_job.sha256);
end;
$$;
revoke all on function app.authorize_privacy_response_download(uuid) from public, anon;
grant execute on function app.authorize_privacy_response_download(uuid) to authenticated;

-- The signed-in person's own privacy requests in a firm that have something for them: an extension
-- told through the portal, or a delivered response. With the official citation when the extension
-- rests on an approved legal time limit.
create function public.privacy_requests_for_me(p_org uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', req.id,
    'reference', req.reference,
    'kind', req.kind,
    'received_on', req.received_on,
    'closed_at', req.closed_at,
    'due_on', req.due_on,
    'extended_due_on', case when req.extension_notice_channel = 'portal' then req.extended_due_on end,
    'extension_reason', case when req.extension_notice_channel = 'portal' then req.extension_reason end,
    'extension_recourse', case when req.extension_notice_channel = 'portal' then req.extension_recourse end,
    'extension_basis', case when req.extension_notice_channel = 'portal' then req.extension_basis end,
    'law_name', lim.law_name,
    'source_section', lim.source_section,
    'source_url', lim.source_url,
    'current_to', lim.current_to,
    'delivery_id', delivery.id,
    'delivered_at', delivery.delivered_at,
    'expires_at', delivery.expires_at,
    'sha256', delivery.sha256,
    'byte_size', job.byte_size,
    'file_count', job.file_count,
    'download_count', delivery.download_count,
    'first_downloaded_at', delivery.first_downloaded_at
  ) order by req.received_on desc, req.number desc), '[]'::jsonb)
  from public.privacy_requests req
  join public.persons person on person.id = req.person_id and person.organization_id = req.organization_id
  left join public.privacy_time_limits lim
    on lim.id = req.extension_time_limit_id and lim.organization_id = req.organization_id and req.extension_notice_channel = 'portal'
  left join public.privacy_request_deliveries delivery on delivery.request_id = req.id and delivery.organization_id = req.organization_id
  left join public.privacy_request_responses job on job.id = delivery.response_id and job.organization_id = delivery.organization_id
  where req.organization_id = p_org
    and person.user_id = (select auth.uid())
    and app.privacy_person_has_portal(req.organization_id, req.person_id)
    and (req.extension_notice_channel = 'portal' or delivery.id is not null);
$$;
revoke all on function public.privacy_requests_for_me(uuid) from public, anon;
grant execute on function public.privacy_requests_for_me(uuid) to authenticated;

-- The portal showed the person their extension notices: record when they first saw each.
create function public.mark_privacy_notices_seen(p_org uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_n integer := 0;
begin
  for v_row in
    select req.id
    from public.privacy_requests req
    join public.persons person on person.id = req.person_id and person.organization_id = req.organization_id
    where req.organization_id = p_org
      and person.user_id = (select auth.uid())
      and app.privacy_person_has_portal(req.organization_id, req.person_id)
      and req.extension_notice_channel = 'portal'
      and req.extension_notice_seen_at is null
    for update of req
  loop
    update public.privacy_requests set extension_notice_seen_at = clock_timestamp() where id = v_row.id;
    perform app.record_audit_event(p_org, 'privacy.extension_notice_seen', 'public.privacy_requests', v_row.id, 'success', '{}'::jsonb);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke all on function public.mark_privacy_notices_seen(uuid) from public, anon;
grant execute on function public.mark_privacy_notices_seen(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Public wrappers. The database checks the caller; these stay security invoker.
-- ---------------------------------------------------------------------------

create function public.propose_privacy_time_limit(
  p_org uuid, p_kind text, p_law_name text, p_provision_text text, p_days integer, p_source_url text,
  p_source_section text, p_checked_on date, p_current_to date, p_snapshot jsonb
) returns uuid language sql security invoker set search_path = ''
as $$ select app.propose_privacy_time_limit(p_org, p_kind, p_law_name, p_provision_text, p_days, p_source_url, p_source_section, p_checked_on, p_current_to, p_snapshot); $$;

create function public.review_privacy_time_limit(p_limit_id uuid, p_expected_version integer, p_decision text, p_note text, p_page_opened_on date)
returns integer language sql security invoker set search_path = ''
as $$ select app.review_privacy_time_limit(p_limit_id, p_expected_version, p_decision, p_note, p_page_opened_on); $$;

create function public.retire_privacy_time_limit(p_limit_id uuid, p_expected_version integer, p_reason text)
returns integer language sql security invoker set search_path = ''
as $$ select app.retire_privacy_time_limit(p_limit_id, p_expected_version, p_reason); $$;

create function public.extend_privacy_request(
  p_request_id uuid, p_new_due_on date, p_reason text, p_time_limit_id uuid, p_recourse text, p_notice_method text
) returns void language sql security invoker set search_path = ''
as $$ select app.extend_privacy_request(p_request_id, p_new_due_on, p_reason, p_time_limit_id, p_recourse, p_notice_method); $$;

create function public.privacy_scope_search(p_request_id uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select app.privacy_scope_search(p_request_id); $$;

create function public.decide_privacy_item(p_item_id uuid, p_decision text, p_fields text[], p_third_party text, p_reason text)
returns void language sql security invoker set search_path = ''
as $$ select app.decide_privacy_item(p_item_id, p_decision, p_fields, p_third_party, p_reason); $$;

create function public.start_privacy_response(p_request_id uuid, p_idempotency_key text)
returns uuid language sql security invoker set search_path = ''
as $$ select app.start_privacy_response(p_request_id, p_idempotency_key); $$;

create function public.authorize_privacy_response_preview(p_response_id uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select app.authorize_privacy_response_preview(p_response_id); $$;

create function public.deliver_privacy_response(p_request_id uuid, p_response_id uuid, p_outcome text, p_note text)
returns uuid language sql security invoker set search_path = ''
as $$ select app.deliver_privacy_response(p_request_id, p_response_id, p_outcome, p_note); $$;

create function public.authorize_privacy_response_download(p_delivery_id uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select app.authorize_privacy_response_download(p_delivery_id); $$;

revoke all on function public.propose_privacy_time_limit(uuid, text, text, text, integer, text, text, date, date, jsonb) from public, anon;
revoke all on function public.review_privacy_time_limit(uuid, integer, text, text, date) from public, anon;
revoke all on function public.retire_privacy_time_limit(uuid, integer, text) from public, anon;
revoke all on function public.extend_privacy_request(uuid, date, text, uuid, text, text) from public, anon;
revoke all on function public.privacy_scope_search(uuid) from public, anon;
revoke all on function public.decide_privacy_item(uuid, text, text[], text, text) from public, anon;
revoke all on function public.start_privacy_response(uuid, text) from public, anon;
revoke all on function public.authorize_privacy_response_preview(uuid) from public, anon;
revoke all on function public.deliver_privacy_response(uuid, uuid, text, text) from public, anon;
revoke all on function public.authorize_privacy_response_download(uuid) from public, anon;

grant execute on function public.propose_privacy_time_limit(uuid, text, text, text, integer, text, text, date, date, jsonb) to authenticated;
grant execute on function public.review_privacy_time_limit(uuid, integer, text, text, date) to authenticated;
grant execute on function public.retire_privacy_time_limit(uuid, integer, text) to authenticated;
grant execute on function public.extend_privacy_request(uuid, date, text, uuid, text, text) to authenticated;
grant execute on function public.privacy_scope_search(uuid) to authenticated;
grant execute on function public.decide_privacy_item(uuid, text, text[], text, text) to authenticated;
grant execute on function public.start_privacy_response(uuid, text) to authenticated;
grant execute on function public.authorize_privacy_response_preview(uuid) to authenticated;
grant execute on function public.deliver_privacy_response(uuid, uuid, text, text) to authenticated;
grant execute on function public.authorize_privacy_response_download(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Table privileges and row-level security
-- ---------------------------------------------------------------------------

revoke all on table public.privacy_time_limits from anon, authenticated, service_role;
revoke all on table public.privacy_request_items from anon, authenticated, service_role;
revoke all on table public.privacy_request_responses from anon, authenticated, service_role;
revoke all on table public.privacy_request_deliveries from anon, authenticated, service_role;
revoke all on table public.privacy_response_downloads from anon, authenticated, service_role;
grant select on table public.privacy_time_limits to authenticated;
grant select on table public.privacy_request_items to authenticated;
grant select on table public.privacy_request_responses to authenticated;
grant select on table public.privacy_request_deliveries to authenticated;
grant select on table public.privacy_response_downloads to authenticated;

alter table public.privacy_time_limits enable row level security;
alter table public.privacy_time_limits force row level security;
alter table public.privacy_request_items enable row level security;
alter table public.privacy_request_items force row level security;
alter table public.privacy_request_responses enable row level security;
alter table public.privacy_request_responses force row level security;
alter table public.privacy_request_deliveries enable row level security;
alter table public.privacy_request_deliveries force row level security;
alter table public.privacy_response_downloads enable row level security;
alter table public.privacy_response_downloads force row level security;

-- The firm's legal time limits: any active staff member of the firm (as compliance_settings).
create policy privacy_time_limits_select on public.privacy_time_limits
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.is_org_staff(organization_id))
  );

-- Everything about a request: whoever can read the request (owner, assignee, consultant scope).
create policy privacy_request_items_select on public.privacy_request_items
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and exists (
      select 1 from public.privacy_requests req
      where req.id = privacy_request_items.request_id
        and req.organization_id = privacy_request_items.organization_id
        and app.can_read_privacy_request(req.organization_id, req.person_id, req.assignee_membership_id)
    )
  );

create policy privacy_request_responses_select on public.privacy_request_responses
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and exists (
      select 1 from public.privacy_requests req
      where req.id = privacy_request_responses.request_id
        and req.organization_id = privacy_request_responses.organization_id
        and app.can_read_privacy_request(req.organization_id, req.person_id, req.assignee_membership_id)
    )
  );

create policy privacy_request_deliveries_select on public.privacy_request_deliveries
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and exists (
      select 1 from public.privacy_requests req
      where req.id = privacy_request_deliveries.request_id
        and req.organization_id = privacy_request_deliveries.organization_id
        and app.can_read_privacy_request(req.organization_id, req.person_id, req.assignee_membership_id)
    )
  );

create policy privacy_response_downloads_select on public.privacy_response_downloads
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and exists (
      select 1
      from public.privacy_request_deliveries delivery
      join public.privacy_requests req on req.id = delivery.request_id and req.organization_id = delivery.organization_id
      where delivery.id = privacy_response_downloads.delivery_id
        and delivery.organization_id = privacy_response_downloads.organization_id
        and app.can_read_privacy_request(req.organization_id, req.person_id, req.assignee_membership_id)
    )
  );
