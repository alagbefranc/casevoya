-- Source governance hardening (security review).
--
-- 1. Source conflicts on official (platform-wide) claims. A conflict blocks the claim for every
--    firm (app.claim_conflict_open), so closing one is limited to the firm that opened it
--    (licensed member, fresh step-up) or a platform admin with the owner/operator role at a fresh
--    step-up. source_conflicts gains opened_organization_id (null for conflicts the re-check opened;
--    backfilled from the audit log for conflicts a firm opened). public.record_source_conflict and
--    public.resolve_source_conflict are redefined from 20261029180000_src_recheck_conflicts_packs.sql
--    with the same signatures; changes are marked "Owner".
--
-- 2. Page captures. A snapshot counts as "captured by Casevoya" only when the server stored it:
--    source_snapshots.server_captured is set by a trigger, true only for service-role or maintenance
--    inserts and never changed afterwards. public.service_store_page_capture (service role only)
--    stores the page the app server fetched and returns its id. app.add_rule_claim
--    (20261025400000_src_claims_review.sql) and app.propose_submission_requirement
--    (20261025220100_gov_requirement_snapshot_number.sql) are redefined with the same signatures:
--    p_snapshot is {"snapshot_id": <uuid>} naming such a capture of the same page for the same firm,
--    and the hash comes from that row. Any other payload is not a capture; the entry is kept without
--    one and its approval needs the reviewer's page attestation. Changes are marked "Capture".
--    Rows stored before this migration keep server_captured = false.

-- ---------------------------------------------------------------------------
-- 1. Conflicts: who opened it
-- ---------------------------------------------------------------------------

alter table public.source_conflicts
  add column if not exists opened_organization_id uuid references public.organizations (id);
create index if not exists source_conflicts_opened_org_idx on public.source_conflicts (opened_organization_id);
comment on column public.source_conflicts.opened_organization_id is
  'The firm whose licensed member opened this review. Null when the re-check opened it. Only that firm or a platform owner/operator resolves it.';

update public.source_conflicts conflict
set opened_organization_id = audit.organization_id
from public.audit_log audit
where conflict.opened_organization_id is null
  and audit.action = 'source.conflict_opened'
  and audit.object_table = 'public.source_conflicts'
  and audit.object_id = conflict.id
  and audit.organization_id is not null;

create or replace function public.record_source_conflict(p_definition_id uuid, p_left_evidence uuid, p_right_evidence uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := app.current_organization_id();
  reason text := nullif(btrim(coalesce(p_reason, '')), '');
  left_row public.rule_evidence%rowtype;
  right_row public.rule_evidence%rowtype;
  left_snap public.source_snapshots%rowtype;
  right_snap public.source_snapshots%rowtype;
  definition public.rule_definitions%rowtype;
  new_id uuid;
begin
  perform app.require_licensed_staff(v_org, true);
  if reason is null or length(reason) < 3 then
    raise exception 'say why these two pages disagree' using errcode = '22023';
  end if;
  select * into definition from public.rule_definitions d where d.id = p_definition_id and d.organization_id is null and d.source_category is not null;
  if definition.id is null then
    raise exception 'that claim is not an official capture' using errcode = '22023';
  end if;
  if app.claim_conflict_open(definition.id) then
    raise exception 'a review of this disagreement is already open' using errcode = '23505';
  end if;
  select * into left_row from public.rule_evidence e where e.id = p_left_evidence;
  select * into right_row from public.rule_evidence e where e.id = p_right_evidence;
  select * into left_snap from public.source_snapshots s where s.id = left_row.snapshot_id;
  select * into right_snap from public.source_snapshots s where s.id = right_row.snapshot_id;
  if left_snap.id is null or right_snap.id is null or left_snap.id = right_snap.id then
    raise exception 'name two stored captures' using errcode = '22023';
  end if;
  if left_snap.content_hash = right_snap.content_hash then
    raise exception 'the two captures are the same page hash' using errcode = '22023';
  end if;
  if split_part(left_snap.final_url, '#', 1) = split_part(right_snap.final_url, '#', 1) then
    raise exception 'a change on one page is a re-check, not a conflict' using errcode = '22023';
  end if;
  if left_row.evidence_excerpt is null or right_row.evidence_excerpt is null then
    raise exception 'both captures need the excerpt that was stored with them' using errcode = '22023';
  end if;
  if btrim(left_row.evidence_excerpt) = btrim(right_row.evidence_excerpt)
     or position(btrim(left_row.evidence_excerpt) in btrim(right_row.evidence_excerpt)) > 0
     or position(btrim(right_row.evidence_excerpt) in btrim(left_row.evidence_excerpt)) > 0 then
    raise exception 'the stored excerpts do not disagree' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.rule_versions ver
    where ver.id = left_row.rule_version_id and ver.definition_id = definition.id
  ) then
    raise exception 'the first capture is not this claim' using errcode = '22023';
  end if;
  perform app.use_rule_step_up(v_org, 'source_conflict', definition.id);
  -- Owner: the opening firm is recorded; only it (or a platform owner/operator) resolves it.
  insert into public.source_conflicts (
    definition_id, left_snapshot_id, right_snapshot_id, left_url, right_url, left_excerpt, right_excerpt,
    opened_reason, created_by, opened_organization_id
  ) values (
    definition.id, left_snap.id, right_snap.id, left_snap.final_url, right_snap.final_url,
    left_row.evidence_excerpt, right_row.evidence_excerpt, left(reason, 500), (select auth.uid()), v_org
  )
  returning id into new_id;
  perform app.open_source_impact_tasks(definition.id, left_snap.source_id, left_snap.id, 'Two official sources disagree', 'source_conflict');
  perform app.record_audit_event(
    v_org, 'source.conflict_opened', 'public.source_conflicts', new_id, 'success',
    jsonb_build_object('definition_id', definition.id, 'stable_key', definition.stable_key, 'left_url', left_snap.final_url, 'right_url', right_snap.final_url)
  );
  return new_id;
end;
$$;
revoke all on function public.record_source_conflict(uuid, uuid, uuid, text) from public, anon, service_role;
grant execute on function public.record_source_conflict(uuid, uuid, uuid, text) to authenticated;

create or replace function public.resolve_source_conflict(p_conflict_id uuid, p_note text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := app.current_organization_id();
  note text := nullif(btrim(coalesce(p_note, '')), '');
  row public.source_conflicts%rowtype;
  actor uuid;
  operator boolean;
begin
  -- Owner: a platform admin with the owner or operator role (aal2), or else a licensed member.
  operator := app.is_platform_admin() is true
    and exists (
      select 1 from public.platform_admins pa
      where pa.user_id = (select auth.uid()) and pa.role in ('owner', 'operator')
    );
  if operator then
    if app.mfa_step_up_satisfied() is distinct from true then
      raise exception 'step-up is required' using errcode = '42501';
    end if;
  else
    perform app.require_licensed_staff(v_org, true);
  end if;
  if note is null or length(note) < 3 then
    raise exception 'say how this was resolved' using errcode = '22023';
  end if;
  select * into row from public.source_conflicts conflict where conflict.id = p_conflict_id for update;
  if row.id is null then
    raise exception 'that review is not open' using errcode = '22023';
  end if;
  -- Owner: a firm resolves only a review its own licensed member opened.
  if not operator and row.opened_organization_id is distinct from v_org then
    raise exception 'only the firm that opened this review, or a Casevoya operator, can resolve it' using errcode = '42501';
  end if;
  if row.status <> 'open' then
    raise exception 'that review is not open' using errcode = '22023';
  end if;
  if not operator then
    actor := app.gov_actor_membership(v_org);
    perform app.use_rule_step_up(v_org, 'source_conflict_resolve', row.id);
  end if;
  update public.source_conflicts
  set status = 'resolved', resolution = left(note, 1000), resolved_by_membership_id = actor, resolved_at = statement_timestamp()
  where id = row.id;
  perform app.record_audit_event(
    case when operator then null else v_org end, 'source.conflict_resolved', 'public.source_conflicts', row.id, 'success',
    jsonb_build_object('definition_id', row.definition_id, 'note_length', length(note), 'platform_operator', operator)
  );
  return row.id;
end;
$$;
revoke all on function public.resolve_source_conflict(uuid, text) from public, anon, service_role;
grant execute on function public.resolve_source_conflict(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Server captures
-- ---------------------------------------------------------------------------

alter table public.source_snapshots
  add column if not exists server_captured boolean not null default false;
comment on column public.source_snapshots.server_captured is
  'True only when the row was stored by the service role (capture worker, app server capture, re-check) or a maintenance session. Set by trigger; never changed. Rows stored before 20261030170000 are false.';

-- True for a service-role request or a database maintenance session (no request claims and not an
-- API role). Never true for a signed-in user's request.
create or replace function app.request_is_server_capture()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb ->> 'role') is not distinct from 'service_role'
    or (
      coalesce(current_setting('request.jwt.claims', true), '') = ''
      and coalesce(current_setting('request.jwt.claim.sub', true), '') = ''
      and coalesce(current_setting('role', true), 'none') not in ('authenticated', 'anon', 'service_role')
    );
$$;
revoke all on function app.request_is_server_capture() from public, anon, authenticated, service_role;

create or replace function app.stamp_snapshot_server_captured()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.server_captured := coalesce(app.request_is_server_capture(), false);
  else
    new.server_captured := old.server_captured;
  end if;
  return new;
end;
$$;
revoke all on function app.stamp_snapshot_server_captured() from public, anon, authenticated, service_role;

do $trigger$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'source_snapshots_server_captured' and tgrelid = 'public.source_snapshots'::regclass
  ) then
    create trigger source_snapshots_server_captured before insert or update on public.source_snapshots
      for each row execute function app.stamp_snapshot_server_captured();
  end if;
end
$trigger$;

-- The app server stores the page it fetched for a signed-in staff member (p_actor) of p_org:
-- p_snapshot {sha256, retrieved_at, final_url, http_status, modified_on?, current_to?}. Reuses this
-- firm's earlier server capture of the same page with the same hash. Returns the snapshot id that
-- public.add_rule_claim / public.propose_submission_requirement accept. Service role only.
create or replace function public.service_store_page_capture(
  p_org uuid,
  p_actor uuid,
  p_source_url text,
  p_title text,
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
  anchor text;
  v_host text;
  v_title text := nullif(btrim(coalesce(p_title, '')), '');
  publisher_name text;
  src uuid;
  snap uuid;
  snap_hash text;
  snap_url text;
  snap_at timestamptz;
  snap_status integer;
  snap_modified date;
  snap_current date;
begin
  if app.request_is_server_capture() is distinct from true then
    raise exception 'only the capture service stores a page capture' using errcode = '42501';
  end if;
  if p_org is null or p_actor is null or not exists (
    select 1 from public.memberships m
    where m.organization_id = p_org and m.user_id = p_actor and m.status = 'active'
      and m.role in ('firm_owner', 'licensed_consultant', 'case_manager')
  ) then
    raise exception 'staff access denied' using errcode = '42501';
  end if;
  v_host := app.federal_official_url(url);
  if v_host is null then
    raise exception 'the source must be an official Government of Canada page (canada.ca or gc.ca)' using errcode = '22023';
  end if;
  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object' then
    raise exception 'the page capture is missing' using errcode = '22023';
  end if;
  snap_hash := lower(btrim(coalesce(p_snapshot ->> 'sha256', '')));
  snap_url := split_part(btrim(coalesce(p_snapshot ->> 'final_url', split_part(url, '#', 1))), '#', 1);
  if snap_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'the page hash is invalid' using errcode = '22023';
  end if;
  begin
    snap_at := (p_snapshot ->> 'retrieved_at')::timestamptz;
  exception when others then
    snap_at := null;
  end;
  if snap_at is null or snap_at > statement_timestamp() + interval '5 minutes' or snap_at < statement_timestamp() - interval '1 day' then
    raise exception 'the retrieval time must be now' using errcode = '22023';
  end if;
  if app.federal_official_url(snap_url) is null then
    raise exception 'the source must be an official Government of Canada page (canada.ca or gc.ca)' using errcode = '22023';
  end if;
  if coalesce(p_snapshot ->> 'http_status', '') ~ '^[1-5][0-9]{2}$' then
    snap_status := (p_snapshot ->> 'http_status')::integer;
  end if;
  begin
    snap_modified := case when coalesce(p_snapshot ->> 'modified_on', '') ~ '^\d{4}-\d{2}-\d{2}$' then (p_snapshot ->> 'modified_on')::date end;
  exception when others then
    snap_modified := null;
  end;
  begin
    snap_current := case when coalesce(p_snapshot ->> 'current_to', '') ~ '^\d{4}-\d{2}-\d{2}$' then (p_snapshot ->> 'current_to')::date end;
  exception when others then
    snap_current := null;
  end;
  -- A date the page states is never after the firm's today.
  if snap_modified > app.firm_today(p_org) then
    snap_modified := null;
  end if;
  if snap_current > app.firm_today(p_org) then
    snap_current := null;
  end if;

  canonical := split_part(url, '#', 1);
  anchor := nullif(split_part(url, '#', 2), '');
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
    values (
      p_org, coalesce(publisher_name, 'Government of Canada'), canonical, v_host, 'CA',
      case when v_host like '%justice.gc.ca' then 'regulation'::public.source_content_kind
           when canonical like '%/fees/%' then 'fee_schedule'::public.source_content_kind
           else 'program_guidance'::public.source_content_kind end,
      left(coalesce(v_title, anchor), 300), 'en'
    )
    returning id into src;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('public.source_snapshots:' || src::text, 0));
  select existing.id into snap
  from public.source_snapshots existing
  where existing.source_id = src and existing.organization_id = p_org and existing.content_hash = snap_hash
    and existing.server_captured
  order by existing.snapshot_number desc
  limit 1;
  if snap is null then
    insert into public.source_snapshots (
      organization_id, source_id, snapshot_number, final_url, publisher, retrieved_at, modified_on, current_to,
      content_hash, retrieval_result, http_status, review_status
    ) values (
      p_org, src, 1, snap_url, coalesce(publisher_name, 'Government of Canada'), snap_at, snap_modified, snap_current,
      snap_hash, 'success', snap_status, 'evidence_captured'
    )
    returning id into snap;
  end if;
  perform app.record_audit_event(
    p_org, 'source.page_captured', 'public.source_snapshots', snap, 'success',
    jsonb_build_object('actor_user_id', p_actor, 'source_url', canonical, 'snapshot_sha256', snap_hash)
  );
  return snap;
end;
$$;
revoke all on function public.service_store_page_capture(uuid, uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.service_store_page_capture(uuid, uuid, text, text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Redefined: app.add_rule_claim (from 20261025400000_src_claims_review.sql)
-- ---------------------------------------------------------------------------
create or replace function app.add_rule_claim(
  p_org uuid,
  p_stable_key text,
  p_jurisdiction text,
  p_program_key text,
  p_claim text,
  p_value text,
  p_source_url text,
  p_source_section text,
  p_excerpt text,
  p_applicability_note text,
  p_form_number text,
  p_form_modified_on date,
  p_published_on date,
  p_modified_on date,
  p_last_amended_on date,
  p_current_to date,
  p_effective_from date,
  p_effective_to date,
  p_checked_on date,
  p_snapshot jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  url text := btrim(coalesce(p_source_url, ''));
  anchor text;
  section text := nullif(btrim(coalesce(p_source_section, '')), '');
  canonical text;
  v_host text;
  zone text;
  today date;
  publisher_name text;
  v_key text := nullif(upper(btrim(coalesce(p_stable_key, ''))), '');
  v_jurisdiction text := upper(btrim(coalesce(p_jurisdiction, 'CA')));
  v_program text := nullif(lower(btrim(coalesce(p_program_key, ''))), '');
  definition public.rule_definitions%rowtype;
  live_version uuid;
  next_number integer;
  src uuid;
  snap uuid;
  snap_ref uuid;
  snap_hash text;
  new_id uuid;
begin
  perform app.require_active_staff(p_org, array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[], false);
  today := app.firm_today(p_org);
  select coalesce(nullif(btrim(org.timezone), ''), 'America/Toronto') into zone from public.organizations org where org.id = p_org;

  if p_claim is null or length(btrim(p_claim)) not between 3 and 2000 then
    raise exception 'write the claim as the official page states it' using errcode = '22023';
  end if;
  if p_value is not null and length(btrim(p_value)) > 200 then
    raise exception 'the value is too long' using errcode = '22023';
  end if;
  if p_excerpt is not null and length(btrim(p_excerpt)) > 600 then
    raise exception 'the excerpt is longer than 600 characters' using errcode = '22023';
  end if;
  if p_applicability_note is not null and length(btrim(p_applicability_note)) > 2000 then
    raise exception 'the applicability note is too long' using errcode = '22023';
  end if;
  if v_jurisdiction !~ '^[A-Z]{2}(-[A-Z0-9]{1,6})?$' then
    raise exception 'unknown jurisdiction' using errcode = '22023';
  end if;
  if v_program is not null and v_program !~ '^[a-z0-9_]{1,80}$' then
    raise exception 'unknown program' using errcode = '22023';
  end if;
  v_host := app.official_claim_url(url);
  if v_host is null then
    if app.federal_official_url(url) is null then
      raise exception 'the source must be an official Government of Canada page (canada.ca or gc.ca)' using errcode = '22023';
    end if;
    raise exception 'a homepage is not evidence: give the exact page the claim is on' using errcode = '22023';
  end if;
  anchor := nullif(split_part(url, '#', 2), '');
  if anchor is null and section is null then
    raise exception 'name the section of the page, or give its link with the section anchor' using errcode = '22023';
  end if;
  if p_checked_on is null or p_checked_on > today or p_checked_on < today - 366 then
    raise exception 'the date checked is required, within the last year and not in the future' using errcode = '22023';
  end if;
  if p_form_modified_on is not null and (nullif(btrim(coalesce(p_form_number, '')), '') is null or p_form_modified_on > today) then
    raise exception 'a form''s date modified needs its form number and cannot be in the future' using errcode = '22023';
  end if;
  if p_published_on > today or p_modified_on > today or p_last_amended_on > today or p_current_to > today then
    raise exception 'a date the page states cannot be in the future' using errcode = '22023';
  end if;
  if p_effective_to is not null and p_effective_from is not null and p_effective_to <= p_effective_from then
    raise exception 'the end date must be after the effective date' using errcode = '22023';
  end if;
  -- Capture: only a snapshot the server stored counts. Any other payload is not a capture.
  if p_snapshot is not null and jsonb_typeof(p_snapshot) = 'object'
     and coalesce(p_snapshot ->> 'snapshot_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    snap_ref := (p_snapshot ->> 'snapshot_id')::uuid;
  end if;

  -- The claim: a new firm definition, or the next version of one the firm already has.
  if v_key is not null then
    if v_key !~ '^[A-Z][A-Z0-9]*(\.[A-Z][A-Z0-9_]*)+$' then
      raise exception 'unknown claim key' using errcode = '22023';
    end if;
    select * into definition from public.rule_definitions d where d.organization_id = p_org and d.stable_key = v_key for update;
  end if;
  if definition.id is null then
    if v_key is null then
      v_key := replace(v_jurisdiction, '-', '') || '.CLAIM.' || upper(coalesce(v_program, 'general')) || '.C'
        || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
    end if;
    insert into public.rule_definitions (organization_id, stable_key, category, jurisdiction, program_key)
    values (p_org, v_key, 'immigration_requirement', v_jurisdiction, v_program)
    returning * into definition;
  else
    if exists (
      select 1 from public.rule_versions v
      where v.definition_id = definition.id and v.status in ('draft', 'evidence_captured', 'professional_review')
    ) then
      raise exception 'a version of this claim is already waiting for review' using errcode = '23505';
    end if;
  end if;
  select coalesce(max(v.version_number), 0) + 1 into next_number from public.rule_versions v where v.definition_id = definition.id;
  select v.id into live_version from public.rule_versions v
  where v.definition_id = definition.id and v.status = 'published'
  order by v.version_number desc limit 1;

  -- The page and its capture.
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
    values (
      p_org, coalesce(publisher_name, 'Government of Canada'), canonical, v_host, 'CA',
      case when v_host like '%justice.gc.ca' then 'regulation'::public.source_content_kind
           when canonical like '%/fees/%' then 'fee_schedule'::public.source_content_kind
           else 'program_guidance'::public.source_content_kind end,
      left(coalesce(section, anchor), 300), 'en'
    )
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

  insert into public.rule_versions (
    definition_id, version_number, claim, output_value, applicability_note, effective_from, effective_to,
    status, supersedes_version_id
  ) values (
    definition.id, next_number, btrim(p_claim),
    case when nullif(btrim(coalesce(p_value, '')), '') is null then null else jsonb_build_object('text', btrim(p_value)) end,
    nullif(btrim(coalesce(p_applicability_note, '')), ''),
    case when p_effective_from is null then null else (p_effective_from::timestamp at time zone zone) end,
    case when p_effective_to is null then null else (p_effective_to::timestamp at time zone zone) end,
    case when snap is null then 'draft'::public.rule_publication_status else 'evidence_captured'::public.rule_publication_status end,
    live_version
  )
  returning id into new_id;

  insert into public.rule_evidence (
    rule_version_id, snapshot_id, source_section, evidence_excerpt, locator, source_language, source_url,
    form_number, form_modified_on, published_on, modified_on, last_amended_on, current_to, checked_on
  ) values (
    new_id, snap, left(coalesce(section, '#' || anchor), 300), nullif(btrim(coalesce(p_excerpt, '')), ''),
    case when anchor is null then null else left('#' || anchor, 300) end, 'en', url,
    nullif(upper(btrim(coalesce(p_form_number, ''))), ''), p_form_modified_on, p_published_on, p_modified_on,
    p_last_amended_on, p_current_to, p_checked_on
  );

  perform app.record_audit_event(
    p_org, 'rule.claim_entered', 'public.rule_versions', new_id, 'success',
    jsonb_build_object('stable_key', definition.stable_key, 'version_number', next_number, 'source_url', url, 'snapshot_sha256', snap_hash,
      'unverified_capture', (p_snapshot is not null and snap is null))
  );
  return new_id;
end;
$$;
revoke all on function app.add_rule_claim(uuid, text, text, text, text, text, text, text, text, text, text, date, date, date, date, date, date, date, date, jsonb) from public, anon;
grant execute on function app.add_rule_claim(uuid, text, text, text, text, text, text, text, text, text, text, date, date, date, date, date, date, date, date, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Redefined: app.propose_submission_requirement (from 20261025220100_gov_requirement_snapshot_number.sql)
-- ---------------------------------------------------------------------------
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
  snap_ref uuid;
  snap_hash text;
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
    jsonb_build_object('kind', p_kind, 'channel', p_channel, 'program_key', p_program_key, 'source_url', url, 'snapshot_sha256', snap_hash,
      'unverified_capture', (p_snapshot is not null and snap is null))
  );
  return new_id;
end;
$$;
