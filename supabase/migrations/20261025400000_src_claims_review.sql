-- SRC-01, SRC-02, SRC-03 (#188): claim-level evidence, separate authority and observation dates,
-- the review workbench and a server-side publication gate. Builds on the source-governance model
-- (20261017113157_source_governance.sql); no second store.
--
-- A claim is a firm rule version (public.rule_versions: the claim and its value) with its evidence
-- (public.rule_evidence: the exact official URL with its section anchor, the section, a verbatim
-- excerpt and the dates the page states) linked to a capture of the page (public.source_snapshots:
-- SHA-256 and retrieval time). When Casevoya's server can't capture the page, the evidence keeps the
-- URL and the dates staff read off it and has no snapshot; a licensed reviewer then approves only by
-- attesting they opened the page themselves (GOV decision 2026-10-24, app.gov_check_page_attestation).
--
-- Dates (SRC-02). Each is stored on its own and null means Unknown; nothing copies one into another:
--   published_on, modified_on ("Date modified"), last_amended_on (Justice Laws "last amended on"),
--   current_to (Justice Laws "current to"), form_modified_on   -> public.rule_evidence, as the page shows
--   effective_from / effective_to                               -> public.rule_versions (only when stated)
--   retrieved                                                   -> public.source_snapshots.retrieved_at
--   reviewed                                                    -> public.professional_reviews.decided_at
--
-- Applicability (SRC-02): a licensed reviewer resolves it (applies / does_not_apply / partly, with a
-- note) before approval: rule_versions.applicability = {resolution, resolved_by_membership_id,
-- resolved_at}, applicability_note, applicability_established.
--
-- Workbench (SRC-03): approve = licensed reviewer (firm owner or licensed consultant whose licence
-- doesn't block) + step-up, with GOV's review rules (attestation when the page wasn't captured; no
-- self-approval while another licensed member exists, otherwise a step-up after the entry). Approval
-- records the professional review and publishes the version (immutable, live for its scope); an
-- earlier live version of the same claim becomes superseded. Reject and suspend need a reason.
--
-- Gate: a rule version moves to approved/published, and an approved professional review is
-- recorded, only inside app.review_rule_version (it opens app.gov_write_nonce for the version in the
-- current transaction), or from a database maintenance session (no request claims, not the
-- authenticated/anon/service_role role), which is where migrations and operators work. An import,
-- an API call, Vo, a job (service role) or direct SQL as an authenticated user is refused.
-- "Live" = app.rule_version_is_live(id): published and within its stated effective dates.
--
-- Redefined (copied from their latest definitions; changes marked "SRC-03"/"SRC-01"):
--   app.guard_rule_version()            from 20261017113157_source_governance.sql
--   app.rule_publication_blockers(...)  from 20261017113157_source_governance.sql
--   app.prepare_professional_review()   from 20261018100000_owner_licence_gates.sql
-- Additive: new nullable columns, one relaxed NOT NULL (rule_evidence.snapshot_id), new checks,
-- new functions and one new trigger. Seeds nothing.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

alter table public.rule_evidence alter column snapshot_id drop not null;

alter table public.rule_evidence
  add column source_url text check (source_url is null or length(source_url) <= 2000),
  add column form_number text check (form_number is null or form_number ~ '^[A-Z0-9][A-Z0-9 .()/-]{0,39}$'),
  add column form_modified_on date,
  add column published_on date,
  add column modified_on date,
  add column last_amended_on date,
  add column current_to date,
  add column checked_on date,
  add column page_attested_by_membership_id uuid,
  add column page_attested_on date,
  add column page_attested_at timestamptz,
  add constraint rule_evidence_source_present check (snapshot_id is not null or source_url is not null),
  add constraint rule_evidence_form_date check (form_modified_on is null or form_number is not null),
  add constraint rule_evidence_attestation_shape check (
    ((page_attested_by_membership_id is null) = (page_attested_on is null))
    and ((page_attested_on is null) = (page_attested_at is null))
    and (page_attested_on is null or snapshot_id is null)
  ),
  add constraint rule_evidence_attester_fk
    foreign key (page_attested_by_membership_id, organization_id) references public.memberships (id, organization_id);
create index rule_evidence_attester_org_fk_idx on public.rule_evidence (page_attested_by_membership_id, organization_id);

comment on column public.rule_evidence.source_url is
  'SRC-01: the exact official page the claim rests on, with its section anchor when the page has one. A homepage is refused.';
comment on column public.rule_evidence.modified_on is
  'The page''s own "Date modified", exactly as shown. Null is Unknown.';
comment on column public.rule_evidence.last_amended_on is
  'Justice Laws "last amended on" date, exactly as shown. Null is Unknown.';
comment on column public.rule_evidence.current_to is
  'Justice Laws "current to" (consolidation) date, exactly as shown. Separate from the retrieval time.';
comment on column public.rule_evidence.page_attested_on is
  'No capture: the date the approving licensed member says they opened the official page and the claim matches it.';

alter table public.rule_versions
  add column status_reason text check (status_reason is null or length(btrim(status_reason)) between 3 and 500),
  add column status_changed_at timestamptz,
  add column status_changed_by_membership_id uuid,
  add constraint rule_versions_status_changer_fk
    foreign key (status_changed_by_membership_id, organization_id) references public.memberships (id, organization_id);
create index rule_versions_status_changer_org_fk_idx on public.rule_versions (status_changed_by_membership_id, organization_id);
comment on column public.rule_versions.status_reason is
  'SRC-03: why a reviewer rejected or suspended this version. Shown in the review workbench.';

-- ---------------------------------------------------------------------------
-- URL rule: an official federal page, never a homepage or landing page
-- ---------------------------------------------------------------------------

-- The host when p_url is an official Government of Canada page (app.federal_official_url) that is
-- not a homepage: at least two path segments besides language folders and index pages
-- ("https://www.canada.ca", "/en.html", "/en/immigration-refugees-citizenship.html" and
-- "https://laws-lois.justice.gc.ca/eng/" are refused). Null otherwise.
create function app.official_claim_url(p_url text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_host text := app.federal_official_url(p_url);
  v_path text;
  part text;
  meaningful integer := 0;
begin
  if v_host is null then
    return null;
  end if;
  v_path := split_part(split_part(substring(btrim(p_url) from 9), '#', 1), '?', 1);
  v_path := substring(v_path from length(split_part(v_path, '/', 1)) + 1);
  foreach part in array string_to_array(lower(v_path), '/') loop
    part := regexp_replace(part, '\.(html?|aspx?|php)$', '');
    if part <> '' and part !~ '^(en|fr|eng|fra|english|francais|index|home|default|accueil|welcome)$' then
      meaningful := meaningful + 1;
    end if;
  end loop;
  if meaningful < 2 then
    return null;
  end if;
  return v_host;
end;
$$;
revoke all on function app.official_claim_url(text) from public;
grant execute on function app.official_claim_url(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Gate helpers
-- ---------------------------------------------------------------------------

-- True inside app.review_rule_version for this version (it opened app.gov_write_nonce in this
-- transaction), or in a database maintenance session (no request claims and not one of the API
-- roles). Never true for authenticated, anon or service_role requests.
create function app.rule_review_gate_open(p_version_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
      select 1 from app.gov_write_nonce nonce
      where nonce.row_id = p_version_id and nonce.txid = txid_current()
    )
    or (
      coalesce(current_setting('request.jwt.claims', true), '') = ''
      and coalesce(current_setting('request.jwt.claim.sub', true), '') = ''
      and coalesce(current_setting('role', true), 'none') not in ('authenticated', 'anon', 'service_role')
    );
$$;
revoke all on function app.rule_review_gate_open(uuid) from public, anon, authenticated, service_role;

-- Live for its scope: published, and today within the effective dates the version states.
-- Suspended, rejected, superseded, review_due, expired and unapproved versions are never live.
create function app.rule_version_is_live(p_version_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.rule_versions v
    where v.id = p_version_id
      and v.status = 'published'
      and (v.effective_from is null or v.effective_from <= statement_timestamp())
      and (v.effective_to is null or v.effective_to > statement_timestamp())
  );
$$;
revoke all on function app.rule_version_is_live(uuid) from public, anon;
grant execute on function app.rule_version_is_live(uuid) to authenticated, service_role;
comment on function app.rule_version_is_live(uuid) is
  'SRC-03: the only definition of a live rule version. Callers (Vo, packs, matters) read versions through this.';

-- ---------------------------------------------------------------------------
-- Redefined: app.guard_rule_version (from 20261017113157_source_governance.sql)
-- ---------------------------------------------------------------------------
create or replace function app.guard_rule_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  blockers text[];
  content_changed boolean := false;
begin
  if tg_op = 'INSERT' then
    new.content_frozen := false;
    new.content_revision := 1;
    if new.status in ('approved', 'published', 'review_due', 'suspended', 'superseded') then
      raise exception 'publication blocked: status_requires_prior_review' using errcode = '23514';
    end if;
    return new;
  end if;

  content_changed :=
    new.claim is distinct from old.claim
    or new.structured_condition is distinct from old.structured_condition
    or new.output_value is distinct from old.output_value
    or new.exceptions is distinct from old.exceptions
    or new.applicability is distinct from old.applicability
    or new.applicability_note is distinct from old.applicability_note
    or new.applicability_established is distinct from old.applicability_established
    or new.effective_from is distinct from old.effective_from
    or new.effective_to is distinct from old.effective_to
    or new.test_case_ids is distinct from old.test_case_ids
    or new.supersedes_version_id is distinct from old.supersedes_version_id
    or new.definition_id is distinct from old.definition_id;

  if old.content_frozen and content_changed then
    raise exception 'published rule content is immutable' using errcode = '42501';
  end if;
  if old.content_frozen and new.content_frozen is distinct from true then
    raise exception 'published rule content stays frozen' using errcode = '42501';
  end if;
  if old.status in ('rejected', 'superseded') and new.status is distinct from old.status then
    raise exception 'rule status % is terminal', old.status using errcode = '42501';
  end if;
  if old.content_frozen
     and new.status in ('draft', 'evidence_captured', 'professional_review', 'approved', 'rejected') then
    raise exception 'published rule version cannot move to %', new.status using errcode = '42501';
  end if;

  if content_changed then
    new.content_revision := old.content_revision + 1;
  end if;

  if new.status in ('approved', 'published') and old.status is distinct from new.status then
    if content_changed then
      raise exception 'publication blocked: content_changed_during_publish' using errcode = '23514';
    end if;
    blockers := app.rule_publication_blockers(old.id, old.content_revision);
    if blockers is not null and cardinality(blockers) > 0 then
      raise exception 'publication blocked: %', array_to_string(blockers, ', ') using errcode = '23514';
    end if;
    -- SRC-03: only the review workbench (licensed reviewer with step-up) publishes. An import, API,
    -- Vo, a job or direct SQL as a signed-in user cannot, even with an approved review on file.
    if app.rule_review_gate_open(old.id) is distinct from true then
      raise exception 'publication blocked: approval_required (a licensed reviewer approves it in Source review, with a step-up)'
        using errcode = '42501';
    end if;
  end if;

  if new.status = 'published' then
    new.content_frozen := true;
  end if;
  return new;
end;
$$;
revoke all on function app.guard_rule_version() from public;

-- ---------------------------------------------------------------------------
-- Redefined: app.rule_publication_blockers (from 20261017113157_source_governance.sql)
-- SRC-01: evidence without a capture counts once a licensed reviewer attested the page; test cases
-- are required for executable rules (a structured condition), not for a stated claim or value.
-- ---------------------------------------------------------------------------
create or replace function app.rule_publication_blockers(p_id uuid, p_content_revision integer)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  rv public.rule_versions%rowtype;
  blockers text[] := array[]::text[];
  evidence_count integer;
  usable integer;
  copied integer;
begin
  select * into rv from public.rule_versions where id = p_id;
  if not found then
    return array['missing_rule_version']::text[];
  end if;
  if rv.claim is null or length(btrim(rv.claim)) = 0 then
    blockers := array_append(blockers, 'missing_claim');
  end if;
  if rv.next_review_at is null then
    blockers := array_append(blockers, 'missing_next_review_at');
  end if;
  -- SRC-01: only an executable rule needs test cases.
  if rv.structured_condition is not null and coalesce(cardinality(rv.test_case_ids), 0) = 0 then
    blockers := array_append(blockers, 'missing_test_cases');
  end if;
  if rv.effective_from is null and rv.applicability_established is not true then
    blockers := array_append(blockers, 'missing_effective_applicability');
  end if;
  if rv.applicability_established is true
     and (rv.applicability_note is null or length(btrim(rv.applicability_note)) = 0) then
    blockers := array_append(blockers, 'missing_applicability_note');
  end if;

  select count(*) into evidence_count
  from public.rule_evidence e
  where e.rule_version_id = p_id;
  if evidence_count = 0 then
    blockers := array_append(blockers, 'missing_evidence');
  else
    select count(*) into usable
    from public.rule_evidence e
    left join public.source_snapshots s on s.id = e.snapshot_id
    left join public.official_sources src on src.id = s.source_id
    where e.rule_version_id = p_id
      and e.source_section is not null
      and length(btrim(e.source_section)) > 0
      and (
        (
          s.id is not null
          and s.content_hash ~ '^[0-9a-f]{64}$'
          and s.retrieved_at is not null
          and length(btrim(s.publisher)) > 0
          and length(btrim(src.publisher)) > 0
          and app.host_is_allowlisted(app.official_url_host(s.final_url))
        )
        -- SRC-01: no capture, but the approving reviewer attested the official page.
        or (
          e.snapshot_id is null
          and e.page_attested_on is not null
          and app.official_claim_url(e.source_url) is not null
        )
      );
    if usable = 0 then
      blockers := array_append(blockers, 'missing_source_section');
    end if;
    select count(*) into copied
    from public.rule_evidence e
    join public.source_snapshots s on s.id = e.snapshot_id
    where e.rule_version_id = p_id
      and rv.effective_from is not null
      and rv.effective_from = s.retrieved_at
      and s.published_at is null
      and s.published_on is null
      and s.current_to is null
      and rv.applicability_established is not true;
    if copied > 0 then
      blockers := array_append(blockers, 'effective_from_copies_retrieved_at');
    end if;
  end if;

  if not exists (
    select 1
    from public.professional_reviews r
    where r.rule_version_id = p_id
      and r.decision = 'approved'
      and r.decided_at is not null
      and r.rule_content_revision = p_content_revision
      and (rv.organization_id is null or r.organization_id = rv.organization_id)
  ) then
    blockers := array_append(blockers, 'missing_reviewer');
  end if;

  return blockers;
end;
$$;
revoke all on function app.rule_publication_blockers(uuid, integer) from public;

-- ---------------------------------------------------------------------------
-- Redefined: app.prepare_professional_review (from 20261018100000_owner_licence_gates.sql)
-- ---------------------------------------------------------------------------
create or replace function app.prepare_professional_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  ver_org uuid;
  ver_revision integer;
  mem_user uuid;
  mem_role public.org_role;
  mem_status public.membership_status;
  mem_org uuid;
begin
  select v.organization_id, v.content_revision into ver_org, ver_revision
  from public.rule_versions v
  where v.id = new.rule_version_id;
  if not found then
    raise exception 'rule version is not reviewable' using errcode = '42501';
  end if;
  if ver_org is not null and ver_org is distinct from new.organization_id then
    raise exception 'review organization must match the rule version' using errcode = '42501';
  end if;

  select m.user_id, m.role, m.status, m.organization_id
    into mem_user, mem_role, mem_status, mem_org
  from public.memberships m
  where m.id = new.reviewer_membership_id;
  if not found
     or mem_org is distinct from new.organization_id
     or mem_status is distinct from 'active' then
    raise exception 'reviewer membership is not an active membership of this organization'
      using errcode = '42501';
  end if;
  if new.decision = 'approved' and app.membership_is_licensed(new.reviewer_membership_id) is distinct from true then
    raise exception 'approved review requires a licensed_consultant membership' using errcode = '42501';
  end if;
  if (select auth.uid()) is not null and mem_user is distinct from (select auth.uid()) then
    raise exception 'reviewer membership must belong to the signed-in user' using errcode = '42501';
  end if;
  -- SRC-03: an approval is recorded only through the review workbench (step-up, attestation and
  -- self-approval rules), never by writing the row directly.
  if new.decision = 'approved'
     and (tg_op = 'INSERT' or old.decision is distinct from 'approved')
     and app.rule_review_gate_open(new.rule_version_id) is distinct from true then
    raise exception 'an approval is recorded only in Source review, by a licensed reviewer with a step-up'
      using errcode = '42501';
  end if;

  -- Always pin the revision that exists now. A caller cannot approve an older revision.
  new.rule_content_revision := ver_revision;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Evidence provenance (new trigger)
-- ---------------------------------------------------------------------------
create function app.guard_rule_evidence_source()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.source_url is not null and app.official_claim_url(new.source_url) is null then
      raise exception 'the source must be the exact official page (canada.ca or a gc.ca site), not a homepage' using errcode = '23514';
    end if;
    if new.page_attested_on is not null or new.page_attested_by_membership_id is not null or new.page_attested_at is not null then
      raise exception 'an attestation is recorded only when a licensed reviewer approves' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.source_url is distinct from old.source_url
     or new.snapshot_id is distinct from old.snapshot_id
     or new.rule_version_id is distinct from old.rule_version_id
     or new.form_number is distinct from old.form_number
     or new.form_modified_on is distinct from old.form_modified_on
     or new.published_on is distinct from old.published_on
     or new.modified_on is distinct from old.modified_on
     or new.last_amended_on is distinct from old.last_amended_on
     or new.current_to is distinct from old.current_to
     or new.checked_on is distinct from old.checked_on then
    raise exception 'claim evidence provenance is immutable; add a new version instead' using errcode = '42501';
  end if;
  if (new.page_attested_on is distinct from old.page_attested_on
      or new.page_attested_by_membership_id is distinct from old.page_attested_by_membership_id
      or new.page_attested_at is distinct from old.page_attested_at)
     and app.rule_review_gate_open(new.rule_version_id) is distinct from true then
    raise exception 'an attestation is recorded only when a licensed reviewer approves' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.guard_rule_evidence_source() from public;

create trigger rule_evidence_source_guard before insert or update on public.rule_evidence
  for each row execute function app.guard_rule_evidence_source();

-- ---------------------------------------------------------------------------
-- Add claim (SRC-01)
-- ---------------------------------------------------------------------------

-- Staff (firm owner, licensed consultant or case manager) enter a claim from an official page. With
-- p_snapshot ({sha256, retrieved_at, final_url, http_status}) Casevoya's capture of the page is
-- stored (reused when the same bytes were captured before); without it the evidence keeps the URL
-- and the dates staff read, and approval later needs the reviewer's attestation. Dates the page
-- doesn't state stay null. p_stable_key names an existing claim of the firm to add its next version;
-- null starts a new claim. Returns the new rule version id. Nothing is approved here.
create function app.add_rule_claim(
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
  snap_hash text;
  snap_url text;
  snap_at timestamptz;
  snap_number integer;
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
  if p_snapshot is not null then
    snap_hash := lower(btrim(coalesce(p_snapshot ->> 'sha256', '')));
    snap_url := btrim(coalesce(p_snapshot ->> 'final_url', split_part(url, '#', 1)));
    snap_at := (p_snapshot ->> 'retrieved_at')::timestamptz;
    if snap_hash !~ '^[0-9a-f]{64}$' then
      raise exception 'the page hash is invalid' using errcode = '22023';
    end if;
    if snap_at is null or snap_at > statement_timestamp() + interval '5 minutes' then
      raise exception 'the retrieval time is required and cannot be in the future' using errcode = '22023';
    end if;
    if app.federal_official_url(snap_url) is null then
      raise exception 'the source must be an official Government of Canada page (canada.ca or gc.ca)' using errcode = '22023';
    end if;
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

  -- The page and its capture (same pattern as app.propose_submission_requirement).
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
  if snap_hash is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('public.source_snapshots:' || src::text, 0));
    select existing.id into snap
    from public.source_snapshots existing
    where existing.source_id = src and existing.organization_id = p_org and existing.content_hash = snap_hash
    order by existing.snapshot_number desc
    limit 1;
    if snap is null then
      select coalesce(max(existing.snapshot_number), 0) + 1 into snap_number
      from public.source_snapshots existing
      where existing.source_id = src;
      insert into public.source_snapshots (
        organization_id, source_id, snapshot_number, final_url, publisher, retrieved_at, published_on, modified_on, current_to,
        content_hash, retrieval_result, http_status, review_status
      ) values (
        p_org, src, snap_number, snap_url, coalesce(publisher_name, 'Government of Canada'), snap_at, p_published_on,
        coalesce(p_modified_on, p_last_amended_on), p_current_to, snap_hash,
        'success', nullif(p_snapshot ->> 'http_status', '')::integer, 'evidence_captured'
      )
      returning id into snap;
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
    jsonb_build_object('stable_key', definition.stable_key, 'version_number', next_number, 'source_url', url, 'snapshot_sha256', snap_hash)
  );
  return new_id;
end;
$$;
revoke all on function app.add_rule_claim(uuid, text, text, text, text, text, text, text, text, text, text, date, date, date, date, date, date, date, date, jsonb) from public, anon;
grant execute on function app.add_rule_claim(uuid, text, text, text, text, text, text, text, text, text, text, date, date, date, date, date, date, date, date, jsonb) to authenticated, service_role;

create function public.add_rule_claim(
  p_org uuid, p_stable_key text, p_jurisdiction text, p_program_key text, p_claim text, p_value text,
  p_source_url text, p_source_section text, p_excerpt text, p_applicability_note text, p_form_number text,
  p_form_modified_on date, p_published_on date, p_modified_on date, p_last_amended_on date, p_current_to date,
  p_effective_from date, p_effective_to date, p_checked_on date, p_snapshot jsonb
)
returns uuid language sql security invoker set search_path = ''
as $$
  select app.add_rule_claim(p_org, p_stable_key, p_jurisdiction, p_program_key, p_claim, p_value, p_source_url, p_source_section,
    p_excerpt, p_applicability_note, p_form_number, p_form_modified_on, p_published_on, p_modified_on, p_last_amended_on,
    p_current_to, p_effective_from, p_effective_to, p_checked_on, p_snapshot);
$$;
revoke all on function public.add_rule_claim(uuid, text, text, text, text, text, text, text, text, text, text, date, date, date, date, date, date, date, date, jsonb) from public, anon;
grant execute on function public.add_rule_claim(uuid, text, text, text, text, text, text, text, text, text, text, date, date, date, date, date, date, date, date, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Applicability (SRC-02)
-- ---------------------------------------------------------------------------
create function app.resolve_rule_applicability(p_version_id uuid, p_expected_version integer, p_resolution text, p_note text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  rv public.rule_versions%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  resolver uuid;
  new_version integer;
begin
  select * into rv from public.rule_versions where id = p_version_id for update;
  if rv.id is null or rv.organization_id is null or rv.organization_id is distinct from (select app.current_organization_id()) then
    raise exception 'rule review denied' using errcode = '42501';
  end if;
  perform app.require_licensed_staff(rv.organization_id, false);
  if rv.version is distinct from p_expected_version then
    raise exception 'rule version conflict' using errcode = 'PT409';
  end if;
  if rv.status not in ('draft', 'evidence_captured', 'professional_review') then
    raise exception 'only a version waiting for review can be resolved' using errcode = '22023';
  end if;
  if p_resolution is null or p_resolution not in ('applies', 'does_not_apply', 'partly') then
    raise exception 'choose applies, doesn''t apply or partly' using errcode = '22023';
  end if;
  if v_note is null or length(v_note) < 3 then
    raise exception 'say who and what it applies to' using errcode = '22023';
  end if;
  resolver := app.gov_actor_membership(rv.organization_id);
  update public.rule_versions
  set applicability = jsonb_build_object('resolution', p_resolution, 'resolved_by_membership_id', resolver, 'resolved_at', statement_timestamp()),
      applicability_note = left(v_note, 2000),
      applicability_established = true,
      status = 'professional_review'
  where id = rv.id
  returning version into new_version;
  perform app.record_audit_event(
    rv.organization_id, 'rule.applicability_resolved', 'public.rule_versions', rv.id, 'success',
    jsonb_build_object('resolution', p_resolution)
  );
  return new_version;
end;
$$;
revoke all on function app.resolve_rule_applicability(uuid, integer, text, text) from public, anon;
grant execute on function app.resolve_rule_applicability(uuid, integer, text, text) to authenticated, service_role;

create function public.resolve_rule_applicability(p_version_id uuid, p_expected_version integer, p_resolution text, p_note text)
returns integer language sql security invoker set search_path = ''
as $$ select app.resolve_rule_applicability(p_version_id, p_expected_version, p_resolution, p_note); $$;
revoke all on function public.resolve_rule_applicability(uuid, integer, text, text) from public, anon;
grant execute on function public.resolve_rule_applicability(uuid, integer, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Review: approve (publish) or reject (SRC-03)
-- ---------------------------------------------------------------------------
create function app.review_rule_version(
  p_version_id uuid,
  p_expected_version integer,
  p_decision text,
  p_note text,
  p_next_review_on date,
  p_page_opened_on date
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  rv public.rule_versions%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  zone text;
  reviewer uuid;
  opened date;
  uncaptured integer;
  self_approval boolean := false;
  credential jsonb;
  earlier record;
  new_version integer;
begin
  select * into rv from public.rule_versions where id = p_version_id for update;
  if rv.id is null or rv.organization_id is null or rv.organization_id is distinct from (select app.current_organization_id()) then
    raise exception 'rule review denied' using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('approved', 'rejected') then
    raise exception 'unknown decision' using errcode = '22023';
  end if;
  -- Approval publishes, so it needs a step-up; rejecting publishes nothing.
  perform app.require_licensed_staff(rv.organization_id, p_decision = 'approved');
  if rv.version is distinct from p_expected_version then
    raise exception 'rule version conflict' using errcode = 'PT409';
  end if;
  if rv.status not in ('draft', 'evidence_captured', 'professional_review') then
    raise exception 'nothing is waiting for review' using errcode = '22023';
  end if;
  reviewer := app.gov_actor_membership(rv.organization_id);

  if p_decision = 'rejected' then
    if v_note is null or length(v_note) < 3 then
      raise exception 'say why it''s rejected' using errcode = '22023';
    end if;
    insert into public.professional_reviews (organization_id, rule_version_id, reviewer_membership_id, decision, decided_at, rationale, rule_content_revision)
    values (rv.organization_id, rv.id, reviewer, 'rejected', statement_timestamp(), left(v_note, 2000), rv.content_revision);
    update public.rule_versions
    set status = 'rejected', status_reason = left(v_note, 500), status_changed_at = statement_timestamp(), status_changed_by_membership_id = reviewer
    where id = rv.id
    returning version into new_version;
    perform app.record_audit_event(rv.organization_id, 'rule.version_rejected', 'public.rule_versions', rv.id, 'success', jsonb_build_object('reason', left(v_note, 500)));
    return new_version;
  end if;

  -- Approve.
  if coalesce(rv.applicability ->> 'resolution', '') not in ('applies', 'partly') or rv.applicability_established is not true then
    if rv.applicability ->> 'resolution' = 'does_not_apply' then
      raise exception 'a claim resolved as not applying can''t be published; reject it or resolve it again' using errcode = '22023';
    end if;
    raise exception 'resolve applicability before approving' using errcode = '22023';
  end if;
  if rv.effective_to is not null and rv.effective_to <= statement_timestamp() then
    raise exception 'this version has expired: its end date has passed' using errcode = '22023';
  end if;
  select coalesce(nullif(btrim(org.timezone), ''), 'America/Toronto') into zone from public.organizations org where org.id = rv.organization_id;
  if p_next_review_on is null or p_next_review_on <= app.firm_today(rv.organization_id) or p_next_review_on > app.firm_today(rv.organization_id) + 730 then
    raise exception 'choose the next review date, within two years' using errcode = '22023';
  end if;
  select count(*) into uncaptured from public.rule_evidence e where e.rule_version_id = rv.id and e.snapshot_id is null;
  -- GOV review rules (20261025220000): no capture needs the reviewer's attestation; approving your
  -- own entry only when no other licensed member can, after a step-up taken since the entry.
  opened := app.gov_check_page_attestation(rv.organization_id, uncaptured = 0, p_page_opened_on, rv.created_at);
  self_approval := app.gov_check_self_approval(rv.organization_id, rv.created_by, rv.created_at);

  select jsonb_build_object('licence_type', c.licence_type, 'college_id', c.college_id, 'status', c.status, 'register_status', c.register_status)
    into credential
  from public.consultant_credentials c
  where c.membership_id = reviewer and c.organization_id = rv.organization_id
  limit 1;

  perform app.gov_open_write(rv.id);
  if opened is not null then
    update public.rule_evidence
    set page_attested_by_membership_id = reviewer, page_attested_on = opened, page_attested_at = statement_timestamp()
    where rule_version_id = rv.id and snapshot_id is null;
  end if;
  update public.rule_versions set next_review_at = (p_next_review_on::timestamp at time zone zone) where id = rv.id;
  insert into public.professional_reviews (
    organization_id, rule_version_id, reviewer_membership_id, reviewer_credential_snapshot, decision, decided_at, rationale, rule_content_revision
  ) values (
    rv.organization_id, rv.id, reviewer, credential, 'approved', statement_timestamp(), left(v_note, 2000), rv.content_revision
  );
  update public.rule_versions
  set status = 'published', status_reason = null, status_changed_at = statement_timestamp(), status_changed_by_membership_id = reviewer
  where id = rv.id
  returning version into new_version;
  perform app.gov_close_write(rv.id);

  -- The earlier live version of the same claim is replaced.
  for earlier in
    select other.id from public.rule_versions other
    where other.definition_id = rv.definition_id and other.id <> rv.id and other.status in ('published', 'review_due', 'suspended')
  loop
    update public.rule_versions
    set status = 'superseded', status_changed_at = statement_timestamp(), status_changed_by_membership_id = reviewer
    where id = earlier.id;
  end loop;

  perform app.record_audit_event(
    rv.organization_id, 'rule.version_approved' || case when self_approval then '_self' else '' end,
    'public.rule_versions', rv.id, 'success',
    jsonb_build_object('content_revision', rv.content_revision, 'page_attested_on', opened, 'self_approved', self_approval, 'next_review_on', p_next_review_on)
  );
  return new_version;
end;
$$;
revoke all on function app.review_rule_version(uuid, integer, text, text, date, date) from public, anon;
grant execute on function app.review_rule_version(uuid, integer, text, text, date, date) to authenticated, service_role;

create function public.review_rule_version(
  p_version_id uuid, p_expected_version integer, p_decision text, p_note text, p_next_review_on date, p_page_opened_on date
)
returns integer language sql security invoker set search_path = ''
as $$ select app.review_rule_version(p_version_id, p_expected_version, p_decision, p_note, p_next_review_on, p_page_opened_on); $$;
revoke all on function public.review_rule_version(uuid, integer, text, text, date, date) from public, anon;
grant execute on function public.review_rule_version(uuid, integer, text, text, date, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Suspend a live version (SRC-03)
-- ---------------------------------------------------------------------------
create function app.suspend_rule_version(p_version_id uuid, p_expected_version integer, p_reason text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  rv public.rule_versions%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  actor uuid;
  new_version integer;
begin
  select * into rv from public.rule_versions where id = p_version_id for update;
  if rv.id is null or rv.organization_id is null or rv.organization_id is distinct from (select app.current_organization_id()) then
    raise exception 'rule review denied' using errcode = '42501';
  end if;
  perform app.require_licensed_staff(rv.organization_id, false);
  if rv.version is distinct from p_expected_version then
    raise exception 'rule version conflict' using errcode = 'PT409';
  end if;
  if rv.status not in ('published', 'review_due') then
    raise exception 'only a live version can be suspended' using errcode = '22023';
  end if;
  if v_reason is null or length(v_reason) < 3 then
    raise exception 'say why it''s suspended' using errcode = '22023';
  end if;
  actor := app.gov_actor_membership(rv.organization_id);
  update public.rule_versions
  set status = 'suspended', status_reason = left(v_reason, 500), status_changed_at = statement_timestamp(), status_changed_by_membership_id = actor
  where id = rv.id
  returning version into new_version;
  perform app.record_audit_event(rv.organization_id, 'rule.version_suspended', 'public.rule_versions', rv.id, 'success', jsonb_build_object('reason', left(v_reason, 500)));
  return new_version;
end;
$$;
revoke all on function app.suspend_rule_version(uuid, integer, text) from public, anon;
grant execute on function app.suspend_rule_version(uuid, integer, text) to authenticated, service_role;

create function public.suspend_rule_version(p_version_id uuid, p_expected_version integer, p_reason text)
returns integer language sql security invoker set search_path = ''
as $$ select app.suspend_rule_version(p_version_id, p_expected_version, p_reason); $$;
revoke all on function public.suspend_rule_version(uuid, integer, text) from public, anon;
grant execute on function public.suspend_rule_version(uuid, integer, text) to authenticated, service_role;
