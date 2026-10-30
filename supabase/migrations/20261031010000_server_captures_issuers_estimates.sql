-- Server-held page captures for government issuers and IRCC processing estimates (security review).
--
-- Follows 20261030170000_source_conflict_owner_server_captures.sql and
-- 20261030233000_server_captures_decisions_renewals_privacy_prep.sql. A page counts as captured
-- only when the server stored it (public.service_store_page_capture, service role;
-- source_snapshots.server_captured).
--
-- 1. New signatures that take p_snapshot {"snapshot_id": <uuid>} naming this firm's server capture
--    of the same page; the hash, retrieval time and "Date modified" come from that row:
--      app/public.propose_government_issuer(org, name, url, checked_on, p_snapshot jsonb)
--      app/public.record_processing_estimate(matter, url, application_type, estimate, checked_on, p_snapshot jsonb)
--    Any other payload is not a capture: the entry is kept without one and its approval needs the
--    reviewer's page attestation. Changes from the latest definitions
--    (20261025180000_gov_correspondence_issuers_tasks.sql, 20261025190000_gov_status_provenance.sql)
--    are marked "Capture".
-- 2. The earlier signatures (hash and time sent by the caller) are redefined to call the new ones
--    without a capture; a hash, time, date or name check sent by the caller is not stored.
-- 3. name_on_page is no longer taken from the caller. public.service_record_issuer_name_on_page
--    (service role only) records it once, for a just-proposed pending issuer whose page the server
--    captured, from the page bytes the server read.

-- ---------------------------------------------------------------------------
-- 1a. app.propose_government_issuer (new signature)
-- ---------------------------------------------------------------------------
create or replace function app.propose_government_issuer(
  p_org uuid,
  p_name text,
  p_source_url text,
  p_checked_on date,
  p_snapshot jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  url text := btrim(coalesce(p_source_url, ''));
  snap_ref uuid;
  snap uuid;
  snap_hash text;
  snap_at timestamptz;
  snap_modified date;
  new_id uuid;
begin
  perform app.require_active_staff(p_org, app.gov_staff_roles(), false);
  if length(v_name) not between 2 and 200 then
    raise exception 'name the issuer as the official page writes it' using errcode = '22023';
  end if;
  if length(url) not between 12 and 500 or app.host_is_allowlisted(app.official_url_host(url)) is distinct from true then
    raise exception 'the issuer must come from an official Government of Canada page' using errcode = '22023';
  end if;
  if p_checked_on is null or p_checked_on > app.firm_today(p_org) or p_checked_on < app.firm_today(p_org) - 365 then
    raise exception 'the date checked is required, within the last year and not in the future' using errcode = '22023';
  end if;
  -- Capture: only a snapshot the server stored counts. Any other payload is not a capture.
  if p_snapshot is not null and jsonb_typeof(p_snapshot) = 'object'
     and coalesce(p_snapshot ->> 'snapshot_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    snap_ref := (p_snapshot ->> 'snapshot_id')::uuid;
  end if;
  if exists (
    select 1 from public.government_issuers issuer
    where issuer.organization_id = p_org
      and lower(btrim(issuer.name)) = lower(v_name)
      and issuer.status in ('pending_review', 'approved')
  ) then
    raise exception 'this issuer is already on the list' using errcode = '23505';
  end if;
  -- Capture: the named snapshot must be this firm's server capture of this page; its hash,
  -- retrieval time and date modified are used.
  if snap_ref is not null then
    select existing.id, existing.content_hash, existing.retrieved_at, existing.modified_on
      into snap, snap_hash, snap_at, snap_modified
    from public.source_snapshots existing
    join public.official_sources source on source.id = existing.source_id
    where existing.id = snap_ref
      and existing.organization_id = p_org
      and existing.server_captured
      and existing.content_hash is not null
      and existing.retrieved_at is not null
      and source.organization_id = p_org
      and source.canonical_url = split_part(url, '#', 1);
    if snap is null then
      raise exception 'that page capture was not stored by Casevoya for this page' using errcode = '22023';
    end if;
  end if;
  -- Capture: name_on_page is recorded by the capture service (public.service_record_issuer_name_on_page).
  insert into public.government_issuers (
    organization_id, name, source_url, checked_on, retrieved_at, snapshot_sha256, page_modified_on, name_on_page
  ) values (
    p_org, v_name, url, p_checked_on, snap_at, snap_hash, snap_modified, null
  )
  returning id into new_id;
  perform app.record_audit_event(
    p_org, 'government.issuer_proposed', 'public.government_issuers', new_id, 'success',
    jsonb_build_object('source_url', url, 'page_read', snap_hash is not null, 'snapshot_id', snap,
      'unverified_capture', (p_snapshot is not null and snap is null))
  );
  return new_id;
end;
$$;
revoke all on function app.propose_government_issuer(uuid, text, text, date, jsonb) from public, anon;
grant execute on function app.propose_government_issuer(uuid, text, text, date, jsonb) to authenticated, service_role;

create or replace function public.propose_government_issuer(
  p_org uuid, p_name text, p_source_url text, p_checked_on date, p_snapshot jsonb
)
returns uuid language sql security invoker set search_path = ''
as $$ select app.propose_government_issuer(p_org, p_name, p_source_url, p_checked_on, p_snapshot); $$;
revoke all on function public.propose_government_issuer(uuid, text, text, date, jsonb) from public, anon;
grant execute on function public.propose_government_issuer(uuid, text, text, date, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2a. app.propose_government_issuer (earlier signature): no caller-sent capture is stored
-- ---------------------------------------------------------------------------
create or replace function app.propose_government_issuer(
  p_org uuid,
  p_name text,
  p_source_url text,
  p_checked_on date,
  p_retrieved_at timestamptz,
  p_sha256 text,
  p_modified_on date,
  p_name_on_page boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Capture: a hash, time, date or name check sent by the caller is not a capture.
  return app.propose_government_issuer(
    p_org, p_name, p_source_url, p_checked_on,
    case when p_retrieved_at is not null or p_sha256 is not null or p_modified_on is not null or p_name_on_page is not null
      then '{}'::jsonb end
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 1b. app.record_processing_estimate (new signature)
-- ---------------------------------------------------------------------------
create or replace function app.record_processing_estimate(
  p_matter_id uuid,
  p_source_url text,
  p_application_type text,
  p_estimate text,
  p_checked_on date,
  p_snapshot jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  matter public.matters%rowtype;
  url text := btrim(coalesce(p_source_url, ''));
  host text;
  snap_ref uuid;
  snap uuid;
  snap_hash text;
  snap_at timestamptz;
  new_id uuid;
begin
  select * into matter from public.matters where id = p_matter_id;
  if matter.id is null or app.can_read_matter(matter.id) is distinct from true then
    raise exception 'estimate denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(matter.organization_id, app.gov_staff_roles(), false);
  if app.sample_mode_blocks_real(matter.organization_id, matter.is_sample) then
    raise exception 'this firm is in sample mode; only sample matters accept new work' using errcode = '42501';
  end if;
  host := app.official_url_host(url);
  if host is null or app.host_is_allowlisted(host) is distinct from true
     or not (host = 'canada.ca' or right(host, 10) = '.canada.ca') then
    raise exception 'the estimate must come from IRCC''s official processing-times page on canada.ca' using errcode = '22023';
  end if;
  if p_application_type is null or length(btrim(p_application_type)) not between 2 and 200 then
    raise exception 'name the application type as IRCC''s page does' using errcode = '22023';
  end if;
  if p_estimate is null or length(btrim(p_estimate)) not between 1 and 120 then
    raise exception 'write the estimate exactly as IRCC''s page shows it' using errcode = '22023';
  end if;
  if p_checked_on is null or p_checked_on > app.firm_today(matter.organization_id) then
    raise exception 'the date checked is required and cannot be in the future' using errcode = '22023';
  end if;
  -- Capture: only a snapshot the server stored counts. Any other payload is not a capture.
  if p_snapshot is not null and jsonb_typeof(p_snapshot) = 'object'
     and coalesce(p_snapshot ->> 'snapshot_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    snap_ref := (p_snapshot ->> 'snapshot_id')::uuid;
  end if;
  -- Capture: the named snapshot must be this firm's server capture of this page; its hash and
  -- retrieval time are used.
  if snap_ref is not null then
    select existing.id, existing.content_hash, existing.retrieved_at into snap, snap_hash, snap_at
    from public.source_snapshots existing
    join public.official_sources source on source.id = existing.source_id
    where existing.id = snap_ref
      and existing.organization_id = matter.organization_id
      and existing.server_captured
      and existing.content_hash is not null
      and existing.retrieved_at is not null
      and source.organization_id = matter.organization_id
      and source.canonical_url = split_part(url, '#', 1);
    if snap is null then
      raise exception 'that page capture was not stored by Casevoya for this page' using errcode = '22023';
    end if;
  end if;
  insert into public.government_processing_estimates (
    organization_id, matter_id, source_url, application_type, estimate_text, checked_on,
    page_retrieved_at, snapshot_sha256, entered_by_membership_id
  ) values (
    matter.organization_id, matter.id, url, btrim(p_application_type), btrim(p_estimate), p_checked_on,
    snap_at, snap_hash, app.gov_actor_membership(matter.organization_id)
  )
  returning id into new_id;
  perform app.record_audit_event(
    matter.organization_id, 'government.estimate_entered', 'public.government_processing_estimates', new_id, 'success',
    jsonb_build_object('matter_id', matter.id, 'source_url', url, 'captured', snap_hash is not null, 'snapshot_id', snap,
      'unverified_capture', (p_snapshot is not null and snap is null))
  );
  return new_id;
end;
$$;
revoke all on function app.record_processing_estimate(uuid, text, text, text, date, jsonb) from public, anon;
grant execute on function app.record_processing_estimate(uuid, text, text, text, date, jsonb) to authenticated, service_role;

create or replace function public.record_processing_estimate(
  p_matter_id uuid, p_source_url text, p_application_type text, p_estimate text, p_checked_on date, p_snapshot jsonb
)
returns uuid language sql security invoker set search_path = ''
as $$ select app.record_processing_estimate(p_matter_id, p_source_url, p_application_type, p_estimate, p_checked_on, p_snapshot); $$;
revoke all on function public.record_processing_estimate(uuid, text, text, text, date, jsonb) from public, anon;
grant execute on function public.record_processing_estimate(uuid, text, text, text, date, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2b. app.record_processing_estimate (earlier signature): no caller-sent capture is stored
-- ---------------------------------------------------------------------------
create or replace function app.record_processing_estimate(
  p_matter_id uuid,
  p_source_url text,
  p_application_type text,
  p_estimate text,
  p_checked_on date,
  p_retrieved_at timestamptz,
  p_sha256 text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Capture: a hash or time sent by the caller is not a capture.
  return app.record_processing_estimate(
    p_matter_id, p_source_url, p_application_type, p_estimate, p_checked_on,
    case when p_retrieved_at is not null or p_sha256 is not null then '{}'::jsonb end
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Whether the issuer's name is on the captured page (service role only)
-- ---------------------------------------------------------------------------
-- Recorded once by the app server from the page bytes it fetched, for an issuer p_actor proposed
-- in the last 15 minutes that is still pending and has a server capture. Returns the stored value.
create or replace function public.service_record_issuer_name_on_page(
  p_org uuid,
  p_actor uuid,
  p_issuer_id uuid,
  p_name_on_page boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  issuer public.government_issuers%rowtype;
begin
  if app.request_is_server_capture() is distinct from true then
    raise exception 'only the capture service records what the page shows' using errcode = '42501';
  end if;
  if p_name_on_page is null then
    raise exception 'say whether the name is on the page' using errcode = '22023';
  end if;
  select * into issuer from public.government_issuers where id = p_issuer_id for update;
  if issuer.id is null
     or issuer.organization_id is distinct from p_org
     or p_actor is null
     or issuer.created_by is distinct from p_actor
     or issuer.status <> 'pending_review'
     or issuer.snapshot_sha256 is null
     or issuer.name_on_page is not null
     or issuer.created_at < statement_timestamp() - interval '15 minutes' then
    raise exception 'the page check for this issuer is closed' using errcode = '42501';
  end if;
  update public.government_issuers set name_on_page = p_name_on_page where id = issuer.id;
  perform app.record_audit_event(
    issuer.organization_id, 'government.issuer_name_checked', 'public.government_issuers', issuer.id, 'success',
    jsonb_build_object('actor_user_id', p_actor, 'name_on_page', p_name_on_page)
  );
  return p_name_on_page;
end;
$$;
revoke all on function public.service_record_issuer_name_on_page(uuid, uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.service_record_issuer_name_on_page(uuid, uuid, uuid, boolean) to service_role;

comment on column public.government_issuers.name_on_page is
  'Whether the name appeared in the text of the page the server captured (public.service_record_issuer_name_on_page). Null when the page was not captured or not checked.';
