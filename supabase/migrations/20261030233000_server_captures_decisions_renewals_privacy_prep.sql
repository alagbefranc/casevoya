-- Server-held page captures for DEC, renewal, privacy and PREP entries (security review).
--
-- Follows 20261030170000_source_conflict_owner_server_captures.sql. A page snapshot counts as
-- captured only when the server stored it (public.service_store_page_capture, service role;
-- source_snapshots.server_captured). These functions are redefined with the same signatures:
--   app.propose_approval_follow_up_step  (latest: 20261025200000_dec_approval_follow_up.sql)
--   app.propose_renewal_timing           (latest: 20261025210000_dec_renewal.sql)
--   app.propose_privacy_time_limit       (latest: 20261025280000_sec_privacy_responses.sql)
--   app.propose_form_template            (latest: 20261029120100_prep_forms_bundles_functions.sql)
-- p_snapshot is {"snapshot_id": <uuid>} naming this firm's server capture of the same page; the
-- hash and retrieval time come from that row. Any other payload (for example a hash sent by the
-- caller) is not a capture: the entry is kept without one and its approval needs the reviewer's
-- page attestation, as before when the page couldn't be fetched. Changes are marked "Capture".

-- ---------------------------------------------------------------------------
-- app.propose_approval_follow_up_step
-- ---------------------------------------------------------------------------
create or replace function app.propose_approval_follow_up_step(
  p_org uuid,
  p_program_key text,
  p_label text,
  p_timing_text text,
  p_source_url text,
  p_source_section text,
  p_form_number text,
  p_form_modified_on date,
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
  url text := btrim(coalesce(p_source_url, ''));
  v_timing text := nullif(btrim(coalesce(p_timing_text, '')), '');
  canonical text;
  v_host text;
  publisher_name text;
  today date;
  src uuid;
  snap uuid;
  snap_ref uuid;
  snap_hash text;
  new_id uuid;
begin
  if p_org is null or p_org is distinct from app.current_organization_id() then
    raise exception 'approval follow-up denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(p_org, array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[], false);
  today := app.firm_today(p_org);
  if p_program_key is null or p_program_key !~ '^[a-z0-9_]{1,80}$' then
    raise exception 'choose the program the step applies to' using errcode = '22023';
  end if;
  if p_label is null or length(btrim(p_label)) not between 3 and 300 then
    raise exception 'write the step as the official page gives it' using errcode = '22023';
  end if;
  if v_timing is not null and length(v_timing) not between 3 and 300 then
    raise exception 'write the timing as the official page gives it, or leave it empty' using errcode = '22023';
  end if;
  v_host := app.federal_official_url(url);
  if v_host is null then
    raise exception 'the source must be an official Government of Canada page (canada.ca or gc.ca)' using errcode = '22023';
  end if;
  if position('#' in url) = 0 and nullif(btrim(coalesce(p_source_section, '')), '') is null then
    raise exception 'name the section of the page, or give its link with the section anchor' using errcode = '22023';
  end if;
  if p_checked_on is null or p_checked_on > today or p_checked_on < today - 366 then
    raise exception 'the date checked is required, within the last year and not in the future' using errcode = '22023';
  end if;
  if p_form_modified_on is not null and (p_form_number is null or p_form_modified_on > today) then
    raise exception 'a form''s date modified needs its form number and cannot be in the future' using errcode = '22023';
  end if;
  if p_current_to is not null and p_current_to > today then
    raise exception 'a current-to date cannot be in the future' using errcode = '22023';
  end if;
  -- Capture: only a snapshot the server stored counts. Any other payload is not a capture.
  if p_snapshot is not null and jsonb_typeof(p_snapshot) = 'object'
     and coalesce(p_snapshot ->> 'snapshot_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    snap_ref := (p_snapshot ->> 'snapshot_id')::uuid;
  end if;

  canonical := split_part(url, '#', 1);
  select domain.authority into publisher_name
  from public.official_source_domains domain
  where domain.active and (v_host = domain.host or right(v_host, length(domain.host) + 1) = '.' || domain.host)
  order by length(domain.host) desc
  limit 1;

  select source.id into src
  from public.official_sources source
  where source.organization_id = p_org and source.canonical_url = canonical;
  if src is null then
    insert into public.official_sources (organization_id, publisher, canonical_url, allowed_host, jurisdiction, content_kind, title, source_language)
    values (p_org, coalesce(publisher_name, 'Government of Canada'), canonical, v_host, 'CA', 'program_guidance',
            left(nullif(btrim(coalesce(p_source_section, '')), ''), 300), 'en')
    returning id into src;
  end if;
  -- Capture: the named snapshot must be this firm's server capture of this page; its hash is used.
  if snap_ref is not null then
    select existing.id, existing.content_hash into snap, snap_hash
    from public.source_snapshots existing
    where existing.id = snap_ref and existing.source_id = src and existing.organization_id = p_org and existing.server_captured;
    if snap is null then
      raise exception 'that page capture was not stored by Casevoya for this page' using errcode = '22023';
    end if;
  end if;

  insert into public.approval_follow_up_steps (
    organization_id, program_key, label, timing_text, source_id, snapshot_id, source_url, source_section,
    form_number, form_modified_on, checked_on, current_to, snapshot_sha256
  ) values (
    p_org, p_program_key, btrim(p_label), v_timing, src, snap, url, nullif(btrim(coalesce(p_source_section, '')), ''),
    nullif(upper(btrim(coalesce(p_form_number, ''))), ''), p_form_modified_on, p_checked_on, p_current_to, snap_hash
  )
  returning id into new_id;
  perform app.record_audit_event(
    p_org, 'decision.follow_up_step_entered', 'public.approval_follow_up_steps', new_id, 'success',
    jsonb_build_object('program_key', p_program_key, 'source_url', url, 'snapshot_sha256', snap_hash,
      'unverified_capture', (p_snapshot is not null and snap is null))
  );
  return new_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- app.propose_renewal_timing
-- ---------------------------------------------------------------------------
create or replace function app.propose_renewal_timing(
  p_org uuid,
  p_program_key text,
  p_applies_to text,
  p_timing_text text,
  p_lead_days integer,
  p_source_url text,
  p_source_section text,
  p_form_number text,
  p_form_modified_on date,
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
  url text := btrim(coalesce(p_source_url, ''));
  canonical text;
  v_host text;
  publisher_name text;
  today date;
  src uuid;
  snap uuid;
  snap_ref uuid;
  snap_hash text;
  new_id uuid;
begin
  perform app.require_active_staff(p_org, array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[], false);
  today := app.firm_today(p_org);
  if p_applies_to is null or length(btrim(p_applies_to)) not between 2 and 200 then
    raise exception 'name the document or status as the official page does' using errcode = '22023';
  end if;
  if p_timing_text is null or length(btrim(p_timing_text)) not between 3 and 500 then
    raise exception 'write the timing word for word, as the official page gives it' using errcode = '22023';
  end if;
  if p_lead_days is not null and p_lead_days not between 1 and 1095 then
    raise exception 'the days before expiry must be between 1 and 1095, and only when the page states a number' using errcode = '22023';
  end if;
  if p_program_key is not null and p_program_key !~ '^[a-z0-9_]{1,80}$' then
    raise exception 'unknown program' using errcode = '22023';
  end if;
  v_host := app.federal_official_url(url);
  if v_host is null then
    raise exception 'the source must be an official Government of Canada page (canada.ca or gc.ca)' using errcode = '22023';
  end if;
  if position('#' in url) = 0 and nullif(btrim(coalesce(p_source_section, '')), '') is null then
    raise exception 'name the section of the page, or give its link with the section anchor' using errcode = '22023';
  end if;
  if p_checked_on is null or p_checked_on > today or p_checked_on < today - 366 then
    raise exception 'the date checked is required, within the last year and not in the future' using errcode = '22023';
  end if;
  if p_form_modified_on is not null and (nullif(btrim(coalesce(p_form_number, '')), '') is null or p_form_modified_on > today) then
    raise exception 'a form''s date modified needs its form number and cannot be in the future' using errcode = '22023';
  end if;
  if p_current_to is not null and p_current_to > today then
    raise exception 'a current-to date cannot be in the future' using errcode = '22023';
  end if;
  -- Capture: only a snapshot the server stored counts. Any other payload is not a capture.
  if p_snapshot is not null and jsonb_typeof(p_snapshot) = 'object'
     and coalesce(p_snapshot ->> 'snapshot_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    snap_ref := (p_snapshot ->> 'snapshot_id')::uuid;
  end if;

  canonical := split_part(url, '#', 1);
  select domain.authority into publisher_name
  from public.official_source_domains domain
  where domain.active and (v_host = domain.host or right(v_host, length(domain.host) + 1) = '.' || domain.host)
  order by length(domain.host) desc
  limit 1;

  select source.id into src
  from public.official_sources source
  where source.organization_id = p_org and source.canonical_url = canonical;
  if src is null then
    insert into public.official_sources (organization_id, publisher, canonical_url, allowed_host, jurisdiction, content_kind, title, source_language)
    values (p_org, coalesce(publisher_name, 'Government of Canada'), canonical, v_host, 'CA', 'program_guidance',
            left(nullif(btrim(coalesce(p_source_section, '')), ''), 300), 'en')
    returning id into src;
  end if;
  -- Capture: the named snapshot must be this firm's server capture of this page; its hash is used.
  -- (The capture service reuses a firm's earlier capture of the same page bytes.)
  if snap_ref is not null then
    select existing.id, existing.content_hash into snap, snap_hash
    from public.source_snapshots existing
    where existing.id = snap_ref and existing.source_id = src and existing.organization_id = p_org and existing.server_captured;
    if snap is null then
      raise exception 'that page capture was not stored by Casevoya for this page' using errcode = '22023';
    end if;
  end if;

  insert into public.renewal_timings (
    organization_id, program_key, applies_to, timing_text, lead_days, source_id, snapshot_id, source_url, source_section,
    form_number, form_modified_on, checked_on, current_to, snapshot_sha256
  ) values (
    p_org, p_program_key, btrim(p_applies_to), btrim(p_timing_text), p_lead_days, src, snap, url,
    nullif(btrim(coalesce(p_source_section, '')), ''),
    nullif(upper(btrim(coalesce(p_form_number, ''))), ''), p_form_modified_on, p_checked_on, p_current_to, snap_hash
  )
  returning id into new_id;
  perform app.record_audit_event(
    p_org, 'decision.renewal_timing_entered', 'public.renewal_timings', new_id, 'success',
    jsonb_build_object('program_key', p_program_key, 'source_url', url, 'lead_days', p_lead_days, 'snapshot_sha256', snap_hash,
      'unverified_capture', (p_snapshot is not null and snap is null))
  );
  return new_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- app.propose_privacy_time_limit
-- ---------------------------------------------------------------------------
create or replace function app.propose_privacy_time_limit(
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
  v_snap_ref uuid;
  v_hash text;
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
  -- Capture: only a snapshot the server stored counts. Any other payload is not a capture.
  if p_snapshot is not null and jsonb_typeof(p_snapshot) = 'object'
     and coalesce(p_snapshot ->> 'snapshot_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_snap_ref := (p_snapshot ->> 'snapshot_id')::uuid;
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
  -- Capture: the named snapshot must be this firm's server capture of this page; its hash is used.
  if v_snap_ref is not null then
    select existing.id, existing.content_hash into v_snap, v_hash
    from public.source_snapshots existing
    where existing.id = v_snap_ref and existing.source_id = v_src and existing.organization_id = p_org and existing.server_captured;
    if v_snap is null then
      raise exception 'that page capture was not stored by Casevoya for this page' using errcode = '22023';
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
                       'current_to', p_current_to, 'snapshot_sha256', v_hash,
                       'unverified_capture', (p_snapshot is not null and v_snap is null))
  );
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- app.propose_form_template
-- ---------------------------------------------------------------------------
create or replace function app.propose_form_template(
  p_org uuid,
  p_jurisdiction text,
  p_program_key text,
  p_official_form_id text,
  p_official_url text,
  p_source_section text,
  p_form_version text,
  p_mapping_version integer,
  p_effective_on date,
  p_output_format text,
  p_fields jsonb,
  p_checked_on date,
  p_snapshot jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  url text := btrim(coalesce(p_official_url, ''));
  canonical text;
  v_host text;
  publisher_name text;
  today date;
  form_id text := btrim(coalesce(p_official_form_id, ''));
  v_form_version text := btrim(coalesce(p_form_version, ''));
  v_jurisdiction text := upper(btrim(coalesce(p_jurisdiction, '')));
  src uuid;
  snap uuid;
  snap_ref uuid;
  snap_hash text;
  snap_at timestamptz;
  new_id uuid;
  next_mapping integer;
  field jsonb;
  pos integer := 0;
  seen text[] := '{}';
  fact_key text;
begin
  if p_org is distinct from app.current_organization_id() then
    raise exception 'form template denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(p_org, array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[], false);
  today := app.firm_today(p_org);
  if v_jurisdiction !~ '^[A-Z]{2}$' then
    raise exception 'enter the jurisdiction as two letters, as the official page states it' using errcode = '22023';
  end if;
  if p_program_key is not null and p_program_key !~ '^[a-z0-9_]{1,80}$' then
    raise exception 'unknown program' using errcode = '22023';
  end if;
  if form_id !~ '^[A-Za-z0-9][A-Za-z0-9 .()/-]{1,39}$' then
    raise exception 'enter the form identifier as the official page prints it' using errcode = '22023';
  end if;
  if v_form_version is null or length(v_form_version) not between 1 and 80 or v_form_version ~ '[\n\r]' then
    raise exception 'enter the form version as the official page prints it' using errcode = '22023';
  end if;
  if p_output_format is null or p_output_format not in ('field_review', 'manual_completion') then
    raise exception 'choose field review or manual completion' using errcode = '22023';
  end if;
  v_host := app.federal_official_url(url);
  if v_host is null then
    raise exception 'the source must be an official Government of Canada page (canada.ca or gc.ca)' using errcode = '22023';
  end if;
  if position('#' in url) = 0 and nullif(btrim(coalesce(p_source_section, '')), '') is null then
    raise exception 'name the section of the page, or give its link with the section anchor' using errcode = '22023';
  end if;
  if p_checked_on is null or p_checked_on > today or p_checked_on < today - 366 then
    raise exception 'the date checked is required, within the last year and not in the future' using errcode = '22023';
  end if;
  if p_effective_on is not null and (p_effective_on > today + 366 or p_effective_on < date '1990-01-01') then
    raise exception 'an effective date must be the date the official page states' using errcode = '22023';
  end if;
  if p_fields is null or jsonb_typeof(p_fields) <> 'array' then
    raise exception 'list the fields transcribed from the form' using errcode = '22023';
  end if;
  if p_output_format = 'field_review' and jsonb_array_length(p_fields) < 1 then
    raise exception 'a field review needs at least one field transcribed from the form' using errcode = '22023';
  end if;
  if p_output_format = 'manual_completion' and jsonb_array_length(p_fields) > 0 then
    raise exception 'manual completion has no mapped fields; leave the field list empty' using errcode = '22023';
  end if;
  if jsonb_array_length(p_fields) > 200 then
    raise exception 'a form template holds at most 200 fields' using errcode = '22023';
  end if;
  -- Capture: only a snapshot the server stored counts. Any other payload is not a capture.
  if p_snapshot is not null and jsonb_typeof(p_snapshot) = 'object'
     and coalesce(p_snapshot ->> 'snapshot_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    snap_ref := (p_snapshot ->> 'snapshot_id')::uuid;
  end if;

  select coalesce(max(existing.mapping_version), 0) + 1 into next_mapping
  from public.form_templates existing
  where existing.organization_id = p_org
    and existing.jurisdiction = v_jurisdiction
    and lower(existing.official_form_id) = lower(form_id)
    and existing.form_version = v_form_version
    and existing.status <> 'rejected';
  if p_mapping_version is null then
    p_mapping_version := next_mapping;
  elsif p_mapping_version < 1 or p_mapping_version > next_mapping then
    raise exception 'the mapping version must follow the last one for this form version' using errcode = '22023';
  elsif exists (
    select 1 from public.form_templates existing
    where existing.organization_id = p_org
      and existing.jurisdiction = v_jurisdiction
      and lower(existing.official_form_id) = lower(form_id)
      and existing.form_version = v_form_version
      and existing.mapping_version = p_mapping_version
      and existing.status <> 'rejected'
  ) then
    raise exception 'that mapping version already exists for this form version' using errcode = '22023';
  end if;

  canonical := split_part(url, '#', 1);
  select domain.authority into publisher_name
  from public.official_source_domains domain
  where domain.active and (v_host = domain.host or right(v_host, length(domain.host) + 1) = '.' || domain.host)
  order by length(domain.host) desc
  limit 1;
  select source.id into src
  from public.official_sources source
  where source.organization_id = p_org and source.canonical_url = canonical;
  if src is null then
    insert into public.official_sources (organization_id, publisher, canonical_url, allowed_host, jurisdiction, content_kind, title, source_language)
    values (p_org, coalesce(publisher_name, 'Government of Canada'), canonical, v_host, v_jurisdiction, 'form_instruction',
            left(form_id || ' ' || v_form_version, 300), 'en')
    returning id into src;
  end if;
  -- Capture: the named snapshot must be this firm's server capture of this page; its hash and
  -- retrieval time are used.
  if snap_ref is not null then
    select existing.id, existing.content_hash, existing.retrieved_at into snap, snap_hash, snap_at
    from public.source_snapshots existing
    where existing.id = snap_ref and existing.source_id = src and existing.organization_id = p_org and existing.server_captured;
    if snap is null then
      raise exception 'that page capture was not stored by Casevoya for this page' using errcode = '22023';
    end if;
  end if;

  insert into public.form_templates (
    organization_id, jurisdiction, program_key, official_form_id, official_url, source_section, form_version,
    mapping_version, effective_on, checked_on, retrieved_at, output_format, source_id, snapshot_id, snapshot_sha256
  ) values (
    p_org, v_jurisdiction, p_program_key, form_id, url, nullif(btrim(coalesce(p_source_section, '')), ''), v_form_version,
    p_mapping_version, p_effective_on, p_checked_on, coalesce(snap_at, statement_timestamp()), p_output_format, src, snap, snap_hash
  )
  returning id into new_id;

  for field in select value from jsonb_array_elements(p_fields) loop
    pos := pos + 1;
    if jsonb_typeof(field) <> 'object' then
      raise exception 'each field needs a key and the label printed on the form' using errcode = '22023';
    end if;
    if coalesce(field ->> 'field_key', '') !~ '^[a-z][a-z0-9_]{0,79}$' then
      raise exception 'a field key uses lowercase letters, digits and underscores' using errcode = '22023';
    end if;
    if field ->> 'field_key' = any (seen) then
      raise exception 'each field key is used once' using errcode = '22023';
    end if;
    seen := seen || (field ->> 'field_key');
    if length(btrim(coalesce(field ->> 'label', ''))) not between 1 and 200 then
      raise exception 'enter each field label as the form prints it' using errcode = '22023';
    end if;
    if jsonb_typeof(field -> 'required') <> 'boolean' then
      raise exception 'say whether each field is required on the form' using errcode = '22023';
    end if;
    fact_key := nullif(btrim(coalesce(field ->> 'fact_field_key', '')), '');
    if fact_key is not null and fact_key !~ '^[a-z][a-z0-9_]{0,79}$' then
      raise exception 'a fact key uses lowercase letters, digits and underscores' using errcode = '22023';
    end if;
    insert into public.form_template_fields (organization_id, template_id, position, field_key, label, required, fact_field_key)
    values (p_org, new_id, pos, field ->> 'field_key', btrim(field ->> 'label'), (field ->> 'required')::boolean, fact_key);
  end loop;

  perform app.record_audit_event(
    p_org, 'prep.form_template_entered', 'public.form_templates', new_id, 'success',
    jsonb_build_object(
      'official_form_id', form_id, 'form_version', v_form_version, 'mapping_version', p_mapping_version,
      'output_format', p_output_format, 'source_url', url, 'snapshot_sha256', snap_hash, 'fields', pos,
      'unverified_capture', (p_snapshot is not null and snap is null)
    )
  );
  return new_id;
end;
$$;
