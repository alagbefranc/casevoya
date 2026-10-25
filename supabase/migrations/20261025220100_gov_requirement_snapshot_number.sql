-- GOV follow-up (#181): a second capture of the same official page no longer fails.
--
-- app.propose_submission_requirement (latest definition in 20261025170000_gov_submission_checklist.sql,
-- copied below) always inserted source_snapshots.snapshot_number = 1, so a second requirement entered
-- from the same URL with a server capture hit unique (source_id, snapshot_number). Changed (marked
-- "Snapshot fix"): under a transaction advisory lock per source, a capture whose SHA-256 matches an
-- existing snapshot of that source reuses it; a capture with different content gets
-- max(snapshot_number) + 1. Nothing else changed.
--
-- Checked: app.propose_government_issuer (20261025180000) and app.record_processing_estimate
-- (20261025190000) store their page hash on their own rows and never write source_snapshots, so they
-- don't have this problem and are not redefined. Additive only.

create or replace function app.propose_submission_requirement(
  p_org uuid,
  p_program_key text,
  p_channel public.submission_channel,
  p_kind text,
  p_label text,
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
  snap_hash text;
  snap_url text;
  snap_at timestamptz;
  next_number integer;
  new_id uuid;
begin
  perform app.require_active_staff(p_org, array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[], false);
  today := app.firm_today(p_org);
  if p_kind is null or p_kind not in ('outside_step', 'channel_name') then
    raise exception 'choose a step or a channel name' using errcode = '22023';
  end if;
  if p_label is null or length(btrim(p_label)) not between 3 and 300 then
    raise exception 'write the step or name as the official page gives it' using errcode = '22023';
  end if;
  if p_program_key is not null and p_program_key !~ '^[a-z0-9_]{1,80}$' then
    raise exception 'unknown program' using errcode = '22023';
  end if;
  v_host := app.federal_official_url(url);
  if v_host is null or position('#' in url) = 0 and nullif(btrim(coalesce(p_source_section, '')), '') is null then
    if v_host is null then
      raise exception 'the source must be an official Government of Canada page (canada.ca or gc.ca)' using errcode = '22023';
    end if;
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
  if p_snapshot is not null then
    snap_hash := lower(btrim(coalesce(p_snapshot ->> 'sha256', '')));
    snap_url := btrim(coalesce(p_snapshot ->> 'final_url', url));
    snap_at := (p_snapshot ->> 'retrieved_at')::timestamptz;
    if snap_hash !~ '^[0-9a-f]{64}$' then
      raise exception 'the page hash is invalid' using errcode = '22023';
    end if;
    if snap_at is null or snap_at > statement_timestamp() + interval '5 minutes' or snap_at < statement_timestamp() - interval '1 day' then
      raise exception 'the retrieval time must be now' using errcode = '22023';
    end if;
    if app.federal_official_url(snap_url) is null then
      raise exception 'the source must be an official Government of Canada page (canada.ca or gc.ca)' using errcode = '22023';
    end if;
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
  if snap_hash is not null then
    -- Snapshot fix: one capture per page content. Serialise captures of this source, reuse a
    -- snapshot whose bytes hash the same, otherwise take the next snapshot number.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('public.source_snapshots:' || src::text, 0));
    select existing.id into snap
    from public.source_snapshots existing
    where existing.source_id = src and existing.organization_id = p_org and existing.content_hash = snap_hash
    order by existing.snapshot_number desc
    limit 1;
  end if;
  if snap_hash is not null and snap is null then
    select coalesce(max(existing.snapshot_number), 0) + 1 into next_number
    from public.source_snapshots existing
    where existing.source_id = src;
    insert into public.source_snapshots (
      organization_id, source_id, snapshot_number, final_url, publisher, retrieved_at, current_to, content_hash,
      retrieval_result, http_status, review_status
    ) values (
      p_org, src, next_number, snap_url, coalesce(publisher_name, 'Government of Canada'), snap_at, p_current_to, snap_hash,
      'success', nullif(p_snapshot ->> 'http_status', '')::integer, 'evidence_captured'
    )
    returning id into snap;
  end if;

  insert into public.submission_requirements (
    organization_id, program_key, channel, kind, label, source_id, snapshot_id, source_url, source_section,
    form_number, form_modified_on, checked_on, current_to, snapshot_sha256
  ) values (
    p_org, p_program_key, p_channel, p_kind, btrim(p_label), src, snap, url, nullif(btrim(coalesce(p_source_section, '')), ''),
    nullif(upper(btrim(coalesce(p_form_number, ''))), ''), p_form_modified_on, p_checked_on, p_current_to, snap_hash
  )
  returning id into new_id;
  perform app.record_audit_event(
    p_org, 'submission.requirement_entered', 'public.submission_requirements', new_id, 'success',
    jsonb_build_object('kind', p_kind, 'channel', p_channel, 'program_key', p_program_key, 'source_url', url, 'snapshot_sha256', snap_hash)
  );
  return new_id;
end;
$$;

