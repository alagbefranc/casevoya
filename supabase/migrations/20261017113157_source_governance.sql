-- Official-source governance (T011, RULES §§1–7, PRD SRC-01 and SRC-02, ARCHITECTURE §6).
-- Platform catalog (organization_id null): official domains, public sources, snapshots,
-- and published rule packs. Tenants can read that catalog and cannot write it.
-- Firm rows (organization_id set): private interpretations, reviews, matter pins, impacts.
-- A host on the allowlist is an entry gate, not a reviewed program pack.
-- No immigration claims, fees, forms, or deadlines are seeded.
-- Additive only.

create type public.domain_match_kind as enum ('exact', 'suffix');

create type public.source_content_kind as enum (
  'legislation',
  'regulation',
  'program_guidance',
  'ministerial_instruction',
  'public_policy',
  'form_instruction',
  'checklist',
  'fee_schedule',
  'processing_time_tool',
  'professional_rule',
  'privacy_guidance',
  'other_official'
);

create type public.source_discovery_status as enum ('candidate', 'active', 'archived', 'suspended');

create type public.source_review_status as enum (
  'unverified',
  'evidence_captured',
  'in_review',
  'verified',
  'review_due',
  'suspended'
);

create type public.source_change_state as enum ('unknown', 'unchanged', 'change_detected');

create type public.source_observation as enum (
  'success',
  'unchanged',
  'changed',
  'partial',
  'failed',
  'blocked'
);

create type public.snapshot_review_status as enum (
  'draft',
  'evidence_captured',
  'verified',
  'rejected',
  'superseded'
);

create type public.rule_category as enum (
  'immigration_requirement',
  'professional_obligation',
  'privacy_requirement',
  'product_control'
);

create type public.rule_publication_status as enum (
  'draft',
  'evidence_captured',
  'professional_review',
  'approved',
  'published',
  'review_due',
  'suspended',
  'superseded',
  'rejected'
);

create type public.review_decision as enum (
  'approved',
  'rejected',
  'changes_requested',
  'abstained'
);

create type public.rule_impact_disposition as enum (
  'open',
  'acknowledged',
  'reassessed',
  'dismissed'
);

-- ---------------------------------------------------------------------------
-- Allowlist. Lookup table plus trigger, so a new official host is an insert.
-- ---------------------------------------------------------------------------
create table public.official_source_domains (
  id uuid primary key default gen_random_uuid(),
  host text not null unique check (
    host = lower(host)
    and host ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
  ),
  match_kind public.domain_match_kind not null,
  authority text not null check (length(btrim(authority)) between 1 and 200),
  jurisdiction_code text not null check (jurisdiction_code ~ '^[A-Z]{2}(-[A-Z0-9]{1,6})?$'),
  notes text check (notes is null or length(notes) <= 300),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1)
);
comment on table public.official_source_domains is
  'Official-host allowlist. A match does not approve a page, program, fee, or form.';

create index official_source_domains_created_by_idx on public.official_source_domains (created_by);

create trigger official_source_domains_touch before update on public.official_source_domains
  for each row execute function app.touch_row();
create trigger official_source_domains_immutable before update on public.official_source_domains
  for each row execute function app.guard_immutable_keys();

-- Hosts named in RULES §§3–4 and the provincial government sites Francis required.
-- This is infrastructure, not a program pack. O01–O15 URLs are not inserted.
insert into public.official_source_domains (host, match_kind, authority, jurisdiction_code, notes)
values
  ('canada.ca', 'suffix', 'Government of Canada', 'CA', 'Allowlist entry only. IRCC publishes on canada.ca, including www.canada.ca and ircc.canada.ca.'),
  ('cic.gc.ca', 'suffix', 'Immigration, Refugees and Citizenship Canada', 'CA', 'Allowlist entry only. Includes cic.gc.ca and subdomains such as www.cic.gc.ca.'),
  ('justice.gc.ca', 'suffix', 'Justice Laws', 'CA', 'Allowlist entry only. Consolidated Acts and regulations.'),
  ('college-ic.ca', 'suffix', 'College of Immigration and Citizenship Consultants', 'CA', 'Allowlist entry only. Not a reviewed professional rule.'),
  ('priv.gc.ca', 'suffix', 'Office of the Privacy Commissioner of Canada', 'CA', 'Allowlist entry only.'),
  ('irb-cisr.gc.ca', 'suffix', 'Immigration and Refugee Board of Canada', 'CA', 'Allowlist entry only. IRB support still needs its own reviewed pack.'),
  ('cai.gouv.qc.ca', 'suffix', 'Commission d acces a l information du Quebec', 'CA-QC', 'Allowlist entry only.'),
  ('gouv.qc.ca', 'suffix', 'Gouvernement du Quebec', 'CA-QC', 'Allowlist entry only.'),
  ('quebec.ca', 'suffix', 'Gouvernement du Quebec', 'CA-QC', 'Allowlist entry only.'),
  ('ontario.ca', 'suffix', 'Government of Ontario', 'CA-ON', 'Allowlist entry only.'),
  ('gov.bc.ca', 'suffix', 'Government of British Columbia', 'CA-BC', 'Allowlist entry only.'),
  ('alberta.ca', 'suffix', 'Government of Alberta', 'CA-AB', 'Allowlist entry only.'),
  ('gov.mb.ca', 'suffix', 'Government of Manitoba', 'CA-MB', 'Allowlist entry only.'),
  ('saskatchewan.ca', 'suffix', 'Government of Saskatchewan', 'CA-SK', 'Allowlist entry only.'),
  ('gov.sk.ca', 'suffix', 'Government of Saskatchewan', 'CA-SK', 'Allowlist entry only.'),
  ('gnb.ca', 'suffix', 'Government of New Brunswick', 'CA-NB', 'Allowlist entry only.'),
  ('novascotia.ca', 'suffix', 'Government of Nova Scotia', 'CA-NS', 'Allowlist entry only.'),
  ('gov.pe.ca', 'suffix', 'Government of Prince Edward Island', 'CA-PE', 'Allowlist entry only.'),
  ('gov.nl.ca', 'suffix', 'Government of Newfoundland and Labrador', 'CA-NL', 'Allowlist entry only.'),
  ('gov.nt.ca', 'suffix', 'Government of the Northwest Territories', 'CA-NT', 'Allowlist entry only.'),
  ('gov.nu.ca', 'suffix', 'Government of Nunavut', 'CA-NU', 'Allowlist entry only.'),
  ('yukon.ca', 'suffix', 'Government of Yukon', 'CA-YT', 'Allowlist entry only.');

-- ---------------------------------------------------------------------------
-- URL gate
-- ---------------------------------------------------------------------------
create function app.official_url_host(p_url text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  raw text := btrim(p_url);
  rest text;
  hostport text;
  host text;
begin
  if raw is null or raw !~ '^https://' then
    return null;
  end if;
  if position('@' in raw) > 0
     or position(chr(92) in raw) > 0
     or raw ~ '[[:space:]]' then
    return null;
  end if;
  rest := substring(raw from 9);
  hostport := split_part(split_part(split_part(rest, '/', 1), '?', 1), '#', 1);
  if hostport = '' or position(':' in hostport) > 0 then
    return null;
  end if;
  host := lower(hostport);
  if right(host, 1) = '.' then
    host := left(host, length(host) - 1);
  end if;
  if host in ('localhost', 'metadata.google.internal')
     or host ~ '^[0-9.]+$'
     or host !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$' then
    return null;
  end if;
  return host;
end;
$$;
revoke all on function app.official_url_host(text) from public;
grant execute on function app.official_url_host(text) to authenticated, service_role;

create function app.host_is_allowlisted(p_host text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.official_source_domains d
    where d.active
      and p_host is not null
      and (
        (d.match_kind = 'exact' and d.host = p_host)
        or (
          d.match_kind = 'suffix'
          and (p_host = d.host or right(p_host, length(d.host) + 1) = '.' || d.host)
        )
      )
  );
$$;
revoke all on function app.host_is_allowlisted(text) from public;
grant execute on function app.host_is_allowlisted(text) to authenticated, service_role;

create function app.enforce_allowlisted_urls()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  col text;
  val text;
  host text;
begin
  foreach col in array tg_argv loop
    val := to_jsonb(new) ->> col;
    if val is null then
      continue;
    end if;
    host := app.official_url_host(val);
    if host is null or not app.host_is_allowlisted(host) then
      raise exception 'official source URL is not on the allowlist (%)', col
        using errcode = '23514';
    end if;
  end loop;
  if tg_table_name = 'official_sources' then
    new.allowed_host := app.official_url_host(new.canonical_url);
  end if;
  return new;
end;
$$;
revoke all on function app.enforce_allowlisted_urls() from public;

-- ---------------------------------------------------------------------------
-- Catalog
-- ---------------------------------------------------------------------------
create table public.official_sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id),
  publisher text not null check (length(btrim(publisher)) between 1 and 200),
  canonical_url text not null,
  allowed_host text not null,
  jurisdiction text not null check (jurisdiction ~ '^[A-Z]{2}(-[A-Z0-9]{1,6})?$'),
  content_kind public.source_content_kind not null,
  discovery_status public.source_discovery_status not null default 'candidate',
  title text check (title is null or length(btrim(title)) between 1 and 300),
  source_language text check (source_language is null or source_language in ('en', 'fr')),
  -- Freshness is written only by snapshot and check triggers. Inserts cannot pretend a page was checked.
  review_status public.source_review_status not null default 'unverified',
  change_state public.source_change_state not null default 'unknown',
  last_checked_at timestamptz,
  last_attempt_at timestamptz,
  last_attempt_result public.source_observation,
  last_attempt_error text check (last_attempt_error is null or length(last_attempt_error) <= 80),
  next_review_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id),
  unique (organization_id, canonical_url)
);
comment on table public.official_sources is
  'Identity of an official page. organization_id null is the platform catalog. A firm row is that firm''s record of an allowlisted URL, not a global source.';
comment on column public.official_sources.last_checked_at is
  'Last successful retrieval. A failed check must not move this value.';
comment on column public.official_sources.next_review_at is
  'Stewardship deadline chosen by a person. Never defaulted from a monitoring interval.';
comment on column public.official_sources.change_state is
  'change_detected after a content-hash change. A later identical hash or a failed check does not clear it.';

create unique index official_sources_global_url_uidx
  on public.official_sources (canonical_url)
  where organization_id is null;
create index official_sources_org_idx on public.official_sources (organization_id);
create index official_sources_review_idx on public.official_sources (change_state, next_review_at);
create index official_sources_created_by_idx on public.official_sources (created_by);

create table public.source_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid,
  source_id uuid not null references public.official_sources (id),
  snapshot_number integer not null check (snapshot_number >= 1),
  final_url text not null,
  publisher text not null check (length(btrim(publisher)) between 1 and 200),
  -- Observation time of this capture. No default: the caller supplies the real retrieval time.
  retrieved_at timestamptz not null,
  -- Authority dates. Null means unknown. Do not copy retrieved_at into these.
  published_at timestamptz,
  published_on date,
  modified_at timestamptz,
  modified_on date,
  current_to date,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  evidence_storage_ref text check (evidence_storage_ref is null or length(evidence_storage_ref) <= 500),
  retrieval_result public.source_observation not null check (
    retrieval_result in ('success', 'unchanged', 'changed', 'partial')
  ),
  http_status integer check (http_status is null or http_status between 100 and 599),
  review_status public.snapshot_review_status not null default 'draft',
  supersedes_snapshot_id uuid references public.source_snapshots (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (source_id, snapshot_number),
  unique (id, organization_id)
);
comment on table public.source_snapshots is
  'Immutable capture of an official URL. Later snapshots do not rewrite this row. Null authority dates stay unknown.';
comment on column public.source_snapshots.published_on is
  'Date-only precision when the page prints a date and no time. Leave published_at null rather than inventing a clock time.';
comment on column public.source_snapshots.content_hash is
  'sha256 hex of the captured bytes. This migration does not fetch or verify the bytes.';

create index source_snapshots_source_idx on public.source_snapshots (source_id, snapshot_number desc);
create index source_snapshots_org_idx on public.source_snapshots (organization_id);
create index source_snapshots_supersedes_idx on public.source_snapshots (supersedes_snapshot_id);
create index source_snapshots_created_by_idx on public.source_snapshots (created_by);

create table public.source_dependencies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid,
  parent_snapshot_id uuid not null references public.source_snapshots (id),
  linked_url text not null,
  purpose text not null check (length(btrim(purpose)) between 1 and 120),
  expected_type text check (expected_type is null or length(expected_type) <= 80),
  observed_version text check (observed_version is null or length(observed_version) <= 80),
  linked_snapshot_id uuid references public.source_snapshots (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1)
);
comment on table public.source_dependencies is
  'Linked form or page. An unchanged parent hash does not prove a dependency is unchanged.';

create index source_dependencies_parent_idx on public.source_dependencies (parent_snapshot_id);
create index source_dependencies_linked_idx on public.source_dependencies (linked_snapshot_id);
create index source_dependencies_org_idx on public.source_dependencies (organization_id);
create index source_dependencies_created_by_idx on public.source_dependencies (created_by);

create table public.source_check_attempts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid,
  source_id uuid not null references public.official_sources (id),
  attempted_at timestamptz not null,
  result public.source_observation not null,
  http_status integer check (http_status is null or http_status between 100 and 599),
  change_signal boolean not null default false,
  error_code text check (error_code is null or length(error_code) <= 80),
  error_detail text check (error_detail is null or length(error_detail) <= 300),
  next_retry_at timestamptz,
  snapshot_id uuid references public.source_snapshots (id),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id)
);
comment on table public.source_check_attempts is
  'One monitoring attempt. Failure is recorded here and does not move official_sources.last_checked_at.';

create index source_check_attempts_source_idx on public.source_check_attempts (source_id, attempted_at desc);
create index source_check_attempts_snapshot_idx on public.source_check_attempts (snapshot_id);
create index source_check_attempts_org_idx on public.source_check_attempts (organization_id);
create index source_check_attempts_created_by_idx on public.source_check_attempts (created_by);

-- ---------------------------------------------------------------------------
-- Rules, evidence, review, packs, pins, impacts
-- ---------------------------------------------------------------------------
create table public.rule_definitions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id),
  stable_key text not null check (stable_key ~ '^[A-Z][A-Z0-9]*(\.[A-Z][A-Z0-9_]*)+$'),
  category public.rule_category not null,
  jurisdiction text not null check (jurisdiction ~ '^[A-Z]{2}(-[A-Z0-9]{1,6})?$'),
  program_key text check (program_key is null or program_key ~ '^[a-z0-9_]{1,80}$'),
  applicant_context text check (applicant_context is null or length(applicant_context) <= 200),
  owner_label text check (owner_label is null or length(owner_label) <= 200),
  required_facts text[] not null default '{}',
  has_published_version boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id)
);
comment on table public.rule_definitions is
  'Stable rule identity. organization_id null is the platform catalog. Firm rows are private to that firm.';
comment on column public.rule_definitions.has_published_version is
  'Maintained when a version is published. Not a licence approval.';

create unique index rule_definitions_global_key_uidx
  on public.rule_definitions (stable_key)
  where organization_id is null;
create unique index rule_definitions_org_key_uidx
  on public.rule_definitions (organization_id, stable_key)
  where organization_id is not null;
create index rule_definitions_org_idx on public.rule_definitions (organization_id);
create index rule_definitions_created_by_idx on public.rule_definitions (created_by);

create table public.rule_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid,
  definition_id uuid not null references public.rule_definitions (id),
  version_number integer not null check (version_number >= 1),
  claim text check (claim is null or length(btrim(claim)) between 1 and 2000),
  structured_condition jsonb,
  output_value jsonb,
  exceptions jsonb,
  applicability jsonb,
  applicability_note text check (applicability_note is null or length(applicability_note) <= 2000),
  applicability_established boolean not null default false,
  effective_from timestamptz,
  effective_to timestamptz,
  status public.rule_publication_status not null default 'draft',
  content_revision integer not null default 1 check (content_revision >= 1),
  content_frozen boolean not null default false,
  supersedes_version_id uuid references public.rule_versions (id),
  next_review_at timestamptz,
  test_case_ids text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (definition_id, version_number),
  unique (id, organization_id),
  check (effective_to is null or effective_from is null or effective_to > effective_from),
  check (not applicability_established or (applicability_note is not null and length(btrim(applicability_note)) > 0))
);
comment on table public.rule_versions is
  'One immutable publication of a rule once status becomes published. Null dates stay null. retrieved_at is not an effective date.';
comment on column public.rule_versions.effective_from is
  'Legal or reviewed applicability start. Never defaulted from a retrieval timestamp.';
comment on column public.rule_versions.content_revision is
  'Bumps only when claim, condition, output, dates, or tests change. Reviews pin this value.';

create index rule_versions_definition_idx on public.rule_versions (definition_id, version_number desc);
create index rule_versions_org_status_idx on public.rule_versions (organization_id, status);
create index rule_versions_supersedes_idx on public.rule_versions (supersedes_version_id);
create index rule_versions_created_by_idx on public.rule_versions (created_by);

create table public.rule_evidence (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid,
  rule_version_id uuid not null references public.rule_versions (id),
  snapshot_id uuid not null references public.source_snapshots (id),
  source_section text check (
    source_section is null
    or (
      length(btrim(source_section)) between 1 and 300
      and lower(btrim(source_section)) not in ('/', 'home', 'homepage', 'index')
    )
  ),
  evidence_excerpt text check (evidence_excerpt is null or length(evidence_excerpt) <= 600),
  locator text check (locator is null or length(locator) <= 300),
  interpretation_notes text check (interpretation_notes is null or length(interpretation_notes) <= 2000),
  source_language text check (source_language is null or source_language in ('en', 'fr')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (rule_version_id, snapshot_id, source_section)
);
comment on table public.rule_evidence is
  'Claim-to-snapshot link. A homepage section is rejected. Excerpt is limited; the page body is not stored here.';

create index rule_evidence_version_idx on public.rule_evidence (rule_version_id);
create index rule_evidence_snapshot_idx on public.rule_evidence (snapshot_id);
create index rule_evidence_org_idx on public.rule_evidence (organization_id);
create index rule_evidence_created_by_idx on public.rule_evidence (created_by);

create table public.professional_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  rule_version_id uuid not null references public.rule_versions (id),
  reviewer_membership_id uuid not null,
  reviewer_credential_snapshot jsonb,
  decision public.review_decision not null,
  decided_at timestamptz not null,
  rationale text check (rationale is null or length(rationale) <= 2000),
  rule_content_revision integer not null check (rule_content_revision >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id),
  foreign key (reviewer_membership_id, organization_id)
    references public.memberships (id, organization_id)
);
comment on table public.professional_reviews is
  'Review of an exact content revision. Credential snapshot stays null until a licence record exists; do not invent one.';
comment on column public.professional_reviews.decided_at is
  'When the reviewer recorded the decision. No default, so an unknown review time cannot be published.';

create index professional_reviews_version_idx on public.professional_reviews (rule_version_id, rule_content_revision);
create index professional_reviews_reviewer_idx
  on public.professional_reviews (reviewer_membership_id, organization_id);
create index professional_reviews_org_idx on public.professional_reviews (organization_id);
create index professional_reviews_created_by_idx on public.professional_reviews (created_by);

create table public.rule_pack_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id),
  jurisdiction text not null check (jurisdiction ~ '^[A-Z]{2}(-[A-Z0-9]{1,6})?$'),
  program_key text not null check (program_key ~ '^[a-z0-9_]{1,80}$'),
  pack_version integer not null check (pack_version >= 1),
  status public.rule_publication_status not null default 'draft',
  content_frozen boolean not null default false,
  next_review_at timestamptz,
  form_mappings jsonb,
  signature_policy text check (signature_policy is null or length(signature_policy) <= 500),
  release_notes text check (release_notes is null or length(release_notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id)
);
comment on table public.rule_pack_versions is
  'Versioned set of rule versions a matter can pin. Publishing does not move matters already pinned to an older pack.';

create unique index rule_pack_versions_global_uidx
  on public.rule_pack_versions (jurisdiction, program_key, pack_version)
  where organization_id is null;
create unique index rule_pack_versions_org_uidx
  on public.rule_pack_versions (organization_id, jurisdiction, program_key, pack_version)
  where organization_id is not null;
create index rule_pack_versions_org_idx on public.rule_pack_versions (organization_id);
create index rule_pack_versions_created_by_idx on public.rule_pack_versions (created_by);

create table public.rule_pack_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid,
  pack_id uuid not null references public.rule_pack_versions (id),
  rule_version_id uuid not null references public.rule_versions (id),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  unique (pack_id, rule_version_id)
);
comment on table public.rule_pack_items is
  'Membership of a pack. Frozen once the pack is published or a matter pins it.';

create index rule_pack_items_pack_idx on public.rule_pack_items (pack_id);
create index rule_pack_items_version_idx on public.rule_pack_items (rule_version_id);
create index rule_pack_items_org_idx on public.rule_pack_items (organization_id);
create index rule_pack_items_created_by_idx on public.rule_pack_items (created_by);

create table public.matter_rule_bindings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  matter_id uuid not null,
  rule_pack_version_id uuid not null references public.rule_pack_versions (id),
  chosen_context jsonb,
  reviewed_by uuid,
  checked_at timestamptz,
  recheck_required boolean not null default false,
  rationale text check (rationale is null or length(rationale) <= 500),
  superseded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id),
  foreign key (reviewed_by, organization_id) references public.memberships (id, organization_id)
);
comment on table public.matter_rule_bindings is
  'The pack version a matter used. rule_pack_version_id never moves; a newer pack is a new binding.';
comment on column public.matter_rule_bindings.recheck_required is
  'Set when a cited source hash changes. A tenant cannot clear it.';

create unique index matter_rule_bindings_active_uidx
  on public.matter_rule_bindings (matter_id)
  where superseded_at is null;
create index matter_rule_bindings_pack_idx on public.matter_rule_bindings (rule_pack_version_id);
create index matter_rule_bindings_org_idx on public.matter_rule_bindings (organization_id);
create index matter_rule_bindings_reviewed_by_idx
  on public.matter_rule_bindings (reviewed_by, organization_id);
create index matter_rule_bindings_created_by_idx on public.matter_rule_bindings (created_by);

create table public.rule_impacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  matter_id uuid,
  source_id uuid references public.official_sources (id),
  snapshot_id uuid references public.source_snapshots (id),
  rule_version_id uuid references public.rule_versions (id),
  reason text not null check (length(btrim(reason)) between 1 and 200),
  owner_membership_id uuid,
  disposition public.rule_impact_disposition not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  check (source_id is not null or snapshot_id is not null or rule_version_id is not null),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id),
  foreign key (owner_membership_id, organization_id) references public.memberships (id, organization_id)
);
comment on table public.rule_impacts is
  'Open work caused by a source or pack change. It does not rewrite the pinned pack or the old snapshot.';

create unique index rule_impacts_open_snapshot_uidx
  on public.rule_impacts (organization_id, matter_id, snapshot_id, rule_version_id)
  where disposition = 'open' and snapshot_id is not null and matter_id is not null and rule_version_id is not null;
create index rule_impacts_matter_idx on public.rule_impacts (matter_id, organization_id);
create index rule_impacts_source_idx on public.rule_impacts (source_id);
create index rule_impacts_snapshot_idx on public.rule_impacts (snapshot_id);
create index rule_impacts_version_idx on public.rule_impacts (rule_version_id);
create index rule_impacts_owner_idx on public.rule_impacts (owner_membership_id, organization_id);
create index rule_impacts_org_idx on public.rule_impacts (organization_id);
create index rule_impacts_created_by_idx on public.rule_impacts (created_by);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
create function app.reject_governed_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% rows are retained', tg_table_name using errcode = '42501';
end;
$$;
revoke all on function app.reject_governed_delete() from public;

create function app.prepare_official_source()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.change_state := 'unknown';
    new.last_checked_at := null;
    new.last_attempt_at := null;
    new.last_attempt_result := null;
    new.last_attempt_error := null;
    new.review_status := 'unverified';
    return new;
  end if;

  if new.canonical_url is distinct from old.canonical_url
     or new.publisher is distinct from old.publisher
     or new.allowed_host is distinct from old.allowed_host
     or new.jurisdiction is distinct from old.jurisdiction
     or new.organization_id is distinct from old.organization_id
     or new.id is distinct from old.id then
    raise exception 'official source identity columns are immutable' using errcode = '42501';
  end if;

  if new.change_state is distinct from old.change_state
     or new.last_checked_at is distinct from old.last_checked_at
     or new.last_attempt_at is distinct from old.last_attempt_at
     or new.last_attempt_result is distinct from old.last_attempt_result
     or new.last_attempt_error is distinct from old.last_attempt_error then
    if coalesce(current_setting('app.source_state_write', true), '') is distinct from 'on' then
      raise exception 'source freshness fields are maintained by snapshot and check records'
        using errcode = '42501';
    end if;
  end if;

  if new.review_status is distinct from old.review_status
     and new.review_status in ('verified', 'review_due', 'suspended')
     and coalesce(current_setting('app.source_state_write', true), '') is distinct from 'on' then
    raise exception 'source verification status requires a recorded review' using errcode = '42501';
  end if;

  return new;
end;
$$;
revoke all on function app.prepare_official_source() from public;

create trigger official_sources_prepare before insert or update on public.official_sources
  for each row execute function app.prepare_official_source();
create trigger official_sources_url before insert or update on public.official_sources
  for each row execute function app.enforce_allowlisted_urls('canonical_url');
create trigger official_sources_touch before update on public.official_sources
  for each row execute function app.touch_row();
create trigger official_sources_stamp before insert on public.official_sources
  for each row execute function app.stamp_created_by();
create trigger official_sources_audit after insert or update or delete on public.official_sources
  for each row execute function app.audit_row_change();
create trigger official_sources_no_delete before delete on public.official_sources
  for each row execute function app.reject_governed_delete();
create trigger official_sources_no_truncate before truncate on public.official_sources
  for each statement execute function app.reject_governed_delete();

create function app.prepare_source_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  src_org uuid;
begin
  if tg_op = 'DELETE' then
    raise exception 'source snapshots are retained' using errcode = '42501';
  end if;

  select s.organization_id into src_org
  from public.official_sources s
  where s.id = new.source_id;
  if not found then
    raise exception 'official source does not exist' using errcode = '23503';
  end if;
  if new.organization_id is not null and new.organization_id is distinct from src_org then
    raise exception 'snapshot organization_id must match the source' using errcode = '42501';
  end if;
  new.organization_id := src_org;

  if new.retrieved_at > statement_timestamp() + interval '5 minutes' then
    raise exception 'retrieved_at cannot be in the future' using errcode = '22023';
  end if;

  if tg_op = 'INSERT' then
    select coalesce(max(s.snapshot_number), 0) + 1 into new.snapshot_number
    from public.source_snapshots s
    where s.source_id = new.source_id;
    if new.review_status = 'verified' then
      raise exception 'snapshot verification requires an approved review' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.source_id is distinct from old.source_id
     or new.organization_id is distinct from old.organization_id
     or new.snapshot_number is distinct from old.snapshot_number
     or new.final_url is distinct from old.final_url
     or new.retrieved_at is distinct from old.retrieved_at
     or new.published_at is distinct from old.published_at
     or new.published_on is distinct from old.published_on
     or new.modified_at is distinct from old.modified_at
     or new.modified_on is distinct from old.modified_on
     or new.current_to is distinct from old.current_to
     or new.content_hash is distinct from old.content_hash
     or new.publisher is distinct from old.publisher
     or new.evidence_storage_ref is distinct from old.evidence_storage_ref
     or new.retrieval_result is distinct from old.retrieval_result
     or new.http_status is distinct from old.http_status then
    raise exception 'source snapshot provenance is immutable' using errcode = '42501';
  end if;

  if new.review_status = 'verified' and old.review_status is distinct from 'verified' then
    if not exists (
      select 1
      from public.professional_reviews r
      join public.rule_evidence e on e.rule_version_id = r.rule_version_id
      where e.snapshot_id = new.id
        and r.decision = 'approved'
        and r.decided_at is not null
    ) then
      raise exception 'snapshot verification requires an approved review' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;
revoke all on function app.prepare_source_snapshot() from public;

create function app.apply_source_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  prev_hash text;
  changed boolean;
begin
  select s.content_hash into prev_hash
  from public.source_snapshots s
  where s.source_id = new.source_id
    and s.id <> new.id
  order by s.snapshot_number desc
  limit 1;

  changed := prev_hash is not null and (prev_hash is distinct from new.content_hash);

  perform set_config('app.source_state_write', 'on', true);
  update public.official_sources src
  set last_checked_at = case
        when new.retrieval_result in ('success', 'unchanged', 'changed') then new.retrieved_at
        else src.last_checked_at
      end,
      last_attempt_at = new.retrieved_at,
      last_attempt_result = new.retrieval_result,
      last_attempt_error = null,
      change_state = case
        when changed then 'change_detected'::public.source_change_state
        when prev_hash is null then 'unchanged'::public.source_change_state
        else src.change_state
      end,
      review_status = case
        when changed and src.review_status = 'verified' then 'review_due'::public.source_review_status
        else src.review_status
      end
  where src.id = new.source_id;
  perform set_config('app.source_state_write', '', true);

  if changed then
    perform set_config('app.binding_recheck_write', 'on', true);
    update public.matter_rule_bindings b
    set recheck_required = true
    where b.superseded_at is null
      and exists (
        select 1
        from public.rule_pack_items i
        join public.rule_evidence e on e.rule_version_id = i.rule_version_id
        join public.source_snapshots snap on snap.id = e.snapshot_id
        where i.pack_id = b.rule_pack_version_id
          and snap.source_id = new.source_id
      );
    perform set_config('app.binding_recheck_write', '', true);

    insert into public.rule_impacts (
      organization_id, matter_id, source_id, snapshot_id, rule_version_id, reason
    )
    select distinct b.organization_id, b.matter_id, new.source_id, new.id, e.rule_version_id,
      'source_content_hash_changed'
    from public.matter_rule_bindings b
    join public.rule_pack_items i on i.pack_id = b.rule_pack_version_id
    join public.rule_evidence e on e.rule_version_id = i.rule_version_id
    join public.source_snapshots snap on snap.id = e.snapshot_id
    where b.superseded_at is null
      and snap.source_id = new.source_id
      and not exists (
        select 1
        from public.rule_impacts existing
        where existing.organization_id = b.organization_id
          and existing.matter_id = b.matter_id
          and existing.snapshot_id = new.id
          and existing.rule_version_id = e.rule_version_id
          and existing.disposition = 'open'
      );
  end if;

  return null;
end;
$$;
revoke all on function app.apply_source_snapshot() from public;

create trigger source_snapshots_prepare before insert or update on public.source_snapshots
  for each row execute function app.prepare_source_snapshot();
create trigger source_snapshots_url before insert or update on public.source_snapshots
  for each row execute function app.enforce_allowlisted_urls('final_url');
create trigger source_snapshots_touch before update on public.source_snapshots
  for each row execute function app.touch_row();
create trigger source_snapshots_stamp before insert on public.source_snapshots
  for each row execute function app.stamp_created_by();
create trigger source_snapshots_apply after insert on public.source_snapshots
  for each row execute function app.apply_source_snapshot();
create trigger source_snapshots_audit after insert or update or delete on public.source_snapshots
  for each row execute function app.audit_row_change('evidence_storage_ref');
create trigger source_snapshots_no_delete before delete on public.source_snapshots
  for each row execute function app.reject_governed_delete();
create trigger source_snapshots_no_truncate before truncate on public.source_snapshots
  for each statement execute function app.reject_governed_delete();

create function app.prepare_source_dependency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent_org uuid;
begin
  if tg_op = 'UPDATE' and new.parent_snapshot_id is distinct from old.parent_snapshot_id then
    raise exception 'source dependency parent is immutable' using errcode = '42501';
  end if;
  select s.organization_id into parent_org
  from public.source_snapshots s
  where s.id = new.parent_snapshot_id;
  if not found then
    raise exception 'parent snapshot does not exist' using errcode = '23503';
  end if;
  new.organization_id := parent_org;
  return new;
end;
$$;
revoke all on function app.prepare_source_dependency() from public;

create trigger source_dependencies_prepare before insert or update on public.source_dependencies
  for each row execute function app.prepare_source_dependency();
create trigger source_dependencies_url before insert or update on public.source_dependencies
  for each row execute function app.enforce_allowlisted_urls('linked_url');
create trigger source_dependencies_touch before update on public.source_dependencies
  for each row execute function app.touch_row();
create trigger source_dependencies_stamp before insert on public.source_dependencies
  for each row execute function app.stamp_created_by();
create trigger source_dependencies_immutable before update on public.source_dependencies
  for each row execute function app.guard_tenant_keys();
create trigger source_dependencies_audit after insert or update or delete on public.source_dependencies
  for each row execute function app.audit_row_change();

create function app.prepare_source_check_attempt()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  src_org uuid;
begin
  if new.attempted_at > statement_timestamp() + interval '5 minutes' then
    raise exception 'attempted_at cannot be in the future' using errcode = '22023';
  end if;
  if new.result in ('success', 'unchanged', 'changed') and new.snapshot_id is null then
    raise exception 'a successful source check must reference a snapshot' using errcode = '23514';
  end if;
  select s.organization_id into src_org from public.official_sources s where s.id = new.source_id;
  if not found then
    raise exception 'official source does not exist' using errcode = '23503';
  end if;
  new.organization_id := src_org;
  if new.snapshot_id is not null then
    if not exists (
      select 1 from public.source_snapshots snap
      where snap.id = new.snapshot_id and snap.source_id = new.source_id
    ) then
      raise exception 'check snapshot must belong to the same source' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function app.prepare_source_check_attempt() from public;

create function app.apply_source_check_attempt()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('app.source_state_write', 'on', true);
  update public.official_sources src
  set last_attempt_at = new.attempted_at,
      last_attempt_result = new.result,
      last_attempt_error = case
        when new.result in ('failed', 'blocked') then left(coalesce(new.error_code, 'failed'), 80)
        else null
      end,
      last_checked_at = case
        when new.result in ('success', 'unchanged', 'changed') then (
          select case
            when src.last_checked_at is null or snap.retrieved_at > src.last_checked_at then snap.retrieved_at
            else src.last_checked_at
          end
          from public.source_snapshots snap
          where snap.id = new.snapshot_id
        )
        else src.last_checked_at
      end,
      change_state = case
        when new.result = 'changed' then 'change_detected'::public.source_change_state
        else src.change_state
      end
  where src.id = new.source_id;
  perform set_config('app.source_state_write', '', true);
  return null;
end;
$$;
revoke all on function app.apply_source_check_attempt() from public;

create trigger source_check_attempts_prepare before insert on public.source_check_attempts
  for each row execute function app.prepare_source_check_attempt();
create trigger source_check_attempts_stamp before insert on public.source_check_attempts
  for each row execute function app.stamp_created_by();
create trigger source_check_attempts_apply after insert on public.source_check_attempts
  for each row execute function app.apply_source_check_attempt();
create trigger source_check_attempts_audit after insert or update or delete on public.source_check_attempts
  for each row execute function app.audit_row_change('error_detail');
create trigger source_check_attempts_no_delete before delete on public.source_check_attempts
  for each row execute function app.reject_governed_delete();
create trigger source_check_attempts_no_truncate before truncate on public.source_check_attempts
  for each statement execute function app.reject_governed_delete();

create function app.prepare_rule_definition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.has_published_version := false;
    return new;
  end if;
  if new.id is distinct from old.id
     or new.organization_id is distinct from old.organization_id
     or new.stable_key is distinct from old.stable_key
     or new.category is distinct from old.category
     or new.jurisdiction is distinct from old.jurisdiction
     or new.program_key is distinct from old.program_key then
    raise exception 'rule definition identity columns are immutable' using errcode = '42501';
  end if;
  if old.has_published_version and new.required_facts is distinct from old.required_facts then
    raise exception 'required facts are frozen once a version is published' using errcode = '42501';
  end if;
  if new.has_published_version is distinct from old.has_published_version
     and coalesce(current_setting('app.rule_visibility_write', true), '') is distinct from 'on' then
    raise exception 'has_published_version is maintained from rule version status' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.prepare_rule_definition() from public;

create trigger rule_definitions_prepare before insert or update on public.rule_definitions
  for each row execute function app.prepare_rule_definition();
create trigger rule_definitions_touch before update on public.rule_definitions
  for each row execute function app.touch_row();
create trigger rule_definitions_stamp before insert on public.rule_definitions
  for each row execute function app.stamp_created_by();
create trigger rule_definitions_audit after insert or update or delete on public.rule_definitions
  for each row execute function app.audit_row_change();

create function app.align_rule_version_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  def_org uuid;
begin
  select d.organization_id into def_org
  from public.rule_definitions d
  where d.id = new.definition_id;
  if not found then
    raise exception 'rule definition does not exist' using errcode = '23503';
  end if;
  new.organization_id := def_org;
  return new;
end;
$$;
revoke all on function app.align_rule_version_org() from public;

create function app.rule_publication_blockers(p_id uuid, p_content_revision integer)
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
  if coalesce(cardinality(rv.test_case_ids), 0) = 0 then
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
    join public.source_snapshots s on s.id = e.snapshot_id
    join public.official_sources src on src.id = s.source_id
    where e.rule_version_id = p_id
      and e.source_section is not null
      and length(btrim(e.source_section)) > 0
      and s.content_hash ~ '^[0-9a-f]{64}$'
      and s.retrieved_at is not null
      and length(btrim(s.publisher)) > 0
      and length(btrim(src.publisher)) > 0
      and app.host_is_allowlisted(app.official_url_host(s.final_url));
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

create function app.guard_rule_version()
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
  end if;

  if new.status = 'published' then
    new.content_frozen := true;
  end if;
  return new;
end;
$$;
revoke all on function app.guard_rule_version() from public;

create function app.sync_rule_definition_visibility()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('app.rule_visibility_write', 'on', true);
  update public.rule_definitions d
  set has_published_version = exists (
    select 1
    from public.rule_versions v
    where v.definition_id = d.id
      and v.status in ('published', 'review_due', 'suspended', 'superseded')
  )
  where d.id = new.definition_id;
  perform set_config('app.rule_visibility_write', '', true);
  return null;
end;
$$;
revoke all on function app.sync_rule_definition_visibility() from public;

create trigger rule_versions_align before insert or update on public.rule_versions
  for each row execute function app.align_rule_version_org();
create trigger rule_versions_guard before insert or update on public.rule_versions
  for each row execute function app.guard_rule_version();
create trigger rule_versions_touch before update on public.rule_versions
  for each row execute function app.touch_row();
create trigger rule_versions_stamp before insert on public.rule_versions
  for each row execute function app.stamp_created_by();
create trigger rule_versions_visibility after insert or update on public.rule_versions
  for each row execute function app.sync_rule_definition_visibility();
create trigger rule_versions_audit after insert or update or delete on public.rule_versions
  for each row execute function app.audit_row_change();
create trigger rule_versions_no_delete before delete on public.rule_versions
  for each row execute function app.reject_governed_delete();
create trigger rule_versions_no_truncate before truncate on public.rule_versions
  for each statement execute function app.reject_governed_delete();

create function app.prepare_rule_evidence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  ver_org uuid;
  frozen boolean;
begin
  if tg_op = 'DELETE' then
    raise exception 'rule evidence is retained' using errcode = '42501';
  end if;
  select v.organization_id, v.content_frozen into ver_org, frozen
  from public.rule_versions v
  where v.id = new.rule_version_id;
  if not found then
    raise exception 'rule version does not exist' using errcode = '23503';
  end if;
  if frozen then
    raise exception 'evidence cannot change on a published rule version' using errcode = '42501';
  end if;
  new.organization_id := ver_org;
  return new;
end;
$$;
revoke all on function app.prepare_rule_evidence() from public;

create trigger rule_evidence_prepare before insert or update on public.rule_evidence
  for each row execute function app.prepare_rule_evidence();
create trigger rule_evidence_touch before update on public.rule_evidence
  for each row execute function app.touch_row();
create trigger rule_evidence_stamp before insert on public.rule_evidence
  for each row execute function app.stamp_created_by();
create trigger rule_evidence_audit after insert or update or delete on public.rule_evidence
  for each row execute function app.audit_row_change('evidence_excerpt', 'interpretation_notes');
create trigger rule_evidence_no_delete before delete on public.rule_evidence
  for each row execute function app.reject_governed_delete();
create trigger rule_evidence_no_truncate before truncate on public.rule_evidence
  for each statement execute function app.reject_governed_delete();

create function app.prepare_professional_review()
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
  if new.decision = 'approved' and mem_role is distinct from 'licensed_consultant' then
    raise exception 'approved review requires a licensed_consultant membership' using errcode = '42501';
  end if;
  if (select auth.uid()) is not null and mem_user is distinct from (select auth.uid()) then
    raise exception 'reviewer membership must belong to the signed-in user' using errcode = '42501';
  end if;

  -- Always pin the revision that exists now. A caller cannot approve an older revision.
  new.rule_content_revision := ver_revision;
  return new;
end;
$$;
revoke all on function app.prepare_professional_review() from public;

create trigger professional_reviews_prepare before insert or update on public.professional_reviews
  for each row execute function app.prepare_professional_review();
create trigger professional_reviews_touch before update on public.professional_reviews
  for each row execute function app.touch_row();
create trigger professional_reviews_stamp before insert on public.professional_reviews
  for each row execute function app.stamp_created_by();
create trigger professional_reviews_immutable before update on public.professional_reviews
  for each row execute function app.guard_tenant_keys();
create trigger professional_reviews_audit after insert or update or delete on public.professional_reviews
  for each row execute function app.audit_row_change('rationale', 'reviewer_credential_snapshot');
create trigger professional_reviews_no_delete before delete on public.professional_reviews
  for each row execute function app.reject_governed_delete();
create trigger professional_reviews_no_truncate before truncate on public.professional_reviews
  for each statement execute function app.reject_governed_delete();

create function app.guard_rule_pack()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.content_frozen := false;
    if new.status in ('approved', 'published', 'review_due', 'suspended', 'superseded') then
      raise exception 'publication blocked: status_requires_prior_review' using errcode = '23514';
    end if;
    return new;
  end if;

  if new.organization_id is distinct from old.organization_id
     or new.jurisdiction is distinct from old.jurisdiction
     or new.program_key is distinct from old.program_key
     or new.pack_version is distinct from old.pack_version
     or new.id is distinct from old.id then
    raise exception 'rule pack identity columns are immutable' using errcode = '42501';
  end if;
  if old.content_frozen and (
    new.form_mappings is distinct from old.form_mappings
    or new.signature_policy is distinct from old.signature_policy
    or new.release_notes is distinct from old.release_notes
    or new.content_frozen is distinct from true
  ) then
    raise exception 'published rule pack content is immutable' using errcode = '42501';
  end if;
  if old.content_frozen
     and new.status in ('draft', 'evidence_captured', 'professional_review', 'approved', 'rejected') then
    raise exception 'published rule pack cannot move to %', new.status using errcode = '42501';
  end if;
  if old.status in ('rejected', 'superseded') and new.status is distinct from old.status then
    raise exception 'rule pack status % is terminal', old.status using errcode = '42501';
  end if;

  if new.status in ('approved', 'published') and old.status is distinct from new.status then
    if new.next_review_at is null then
      raise exception 'publication blocked: missing_next_review_at' using errcode = '23514';
    end if;
    if not exists (select 1 from public.rule_pack_items i where i.pack_id = new.id) then
      raise exception 'publication blocked: missing_pack_items' using errcode = '23514';
    end if;
    if exists (
      select 1
      from public.rule_pack_items i
      join public.rule_versions v on v.id = i.rule_version_id
      where i.pack_id = new.id
        and v.status not in ('published', 'review_due', 'suspended')
    ) then
      raise exception 'publication blocked: pack_includes_unpublished_rule' using errcode = '23514';
    end if;
  end if;

  if new.status = 'published' then
    new.content_frozen := true;
  end if;
  return new;
end;
$$;
revoke all on function app.guard_rule_pack() from public;

create trigger rule_pack_versions_guard before insert or update on public.rule_pack_versions
  for each row execute function app.guard_rule_pack();
create trigger rule_pack_versions_touch before update on public.rule_pack_versions
  for each row execute function app.touch_row();
create trigger rule_pack_versions_stamp before insert on public.rule_pack_versions
  for each row execute function app.stamp_created_by();
create trigger rule_pack_versions_audit after insert or update or delete on public.rule_pack_versions
  for each row execute function app.audit_row_change();
create trigger rule_pack_versions_no_delete before delete on public.rule_pack_versions
  for each row execute function app.reject_governed_delete();
create trigger rule_pack_versions_no_truncate before truncate on public.rule_pack_versions
  for each statement execute function app.reject_governed_delete();

create function app.guard_pack_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  pack_org uuid;
  pack_status public.rule_publication_status;
  pack_frozen boolean;
  ver_org uuid;
  ver_status public.rule_publication_status;
begin
  if tg_op = 'DELETE' then
    raise exception 'rule pack items are retained' using errcode = '42501';
  end if;

  select p.organization_id, p.status, p.content_frozen
    into pack_org, pack_status, pack_frozen
  from public.rule_pack_versions p
  where p.id = new.pack_id;
  if not found then
    raise exception 'rule pack does not exist' using errcode = '23503';
  end if;
  new.organization_id := pack_org;

  if pack_frozen or pack_status in ('published', 'review_due', 'suspended', 'superseded') then
    raise exception 'published rule pack items are immutable' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.matter_rule_bindings b where b.rule_pack_version_id = new.pack_id
  ) then
    raise exception 'rule pack items are frozen once a matter pins the pack' using errcode = '42501';
  end if;

  select v.organization_id, v.status into ver_org, ver_status
  from public.rule_versions v
  where v.id = new.rule_version_id;
  if not found then
    raise exception 'rule version does not exist' using errcode = '23503';
  end if;
  if ver_org is not null and pack_org is null then
    raise exception 'a global pack cannot include a firm rule version' using errcode = '42501';
  end if;
  if ver_org is not null and ver_org is distinct from pack_org then
    raise exception 'cannot include another organization rule version' using errcode = '42501';
  end if;
  if ver_org is null and pack_org is not null
     and ver_status not in ('published', 'review_due', 'suspended', 'superseded') then
    raise exception 'only a published global rule version can be included' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.guard_pack_item() from public;

create trigger rule_pack_items_guard before insert or update or delete on public.rule_pack_items
  for each row execute function app.guard_pack_item();
create trigger rule_pack_items_stamp before insert on public.rule_pack_items
  for each row execute function app.stamp_created_by();
create trigger rule_pack_items_audit after insert or update or delete on public.rule_pack_items
  for each row execute function app.audit_row_change();
create trigger rule_pack_items_no_truncate before truncate on public.rule_pack_items
  for each statement execute function app.reject_governed_delete();

create function app.guard_matter_rule_binding()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  matter_org uuid;
  pack_org uuid;
  pack_status public.rule_publication_status;
begin
  if tg_op = 'DELETE' then
    raise exception 'matter rule bindings are retained' using errcode = '42501';
  end if;

  select m.organization_id into matter_org
  from public.matters m
  where m.id = new.matter_id;
  if not found or matter_org is distinct from new.organization_id then
    raise exception 'binding organization must match the matter' using errcode = '42501';
  end if;

  select p.organization_id, p.status into pack_org, pack_status
  from public.rule_pack_versions p
  where p.id = new.rule_pack_version_id;
  if not found then
    raise exception 'rule pack does not exist' using errcode = '23503';
  end if;
  if pack_org is not null and pack_org is distinct from new.organization_id then
    raise exception 'cannot pin another organization rule pack' using errcode = '42501';
  end if;
  if pack_status not in ('published', 'review_due', 'suspended', 'superseded') then
    raise exception 'a matter can only pin a published rule pack' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    new.recheck_required := false;
    return new;
  end if;

  if new.matter_id is distinct from old.matter_id
     or new.organization_id is distinct from old.organization_id
     or new.rule_pack_version_id is distinct from old.rule_pack_version_id
     or new.id is distinct from old.id then
    raise exception 'matter rule pack pin is immutable' using errcode = '42501';
  end if;
  if new.recheck_required is distinct from old.recheck_required
     and coalesce(current_setting('app.binding_recheck_write', true), '') is distinct from 'on' then
    raise exception 'recheck_required is maintained when source content changes' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.guard_matter_rule_binding() from public;

create trigger matter_rule_bindings_guard before insert or update or delete on public.matter_rule_bindings
  for each row execute function app.guard_matter_rule_binding();
create trigger matter_rule_bindings_touch before update on public.matter_rule_bindings
  for each row execute function app.touch_row();
create trigger matter_rule_bindings_stamp before insert on public.matter_rule_bindings
  for each row execute function app.stamp_created_by();
create trigger matter_rule_bindings_audit after insert or update or delete on public.matter_rule_bindings
  for each row execute function app.audit_row_change();
create trigger matter_rule_bindings_no_truncate before truncate on public.matter_rule_bindings
  for each statement execute function app.reject_governed_delete();

create function app.guard_rule_impact()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  snap_source uuid;
  matter_org uuid;
begin
  if new.snapshot_id is not null then
    select s.source_id into snap_source
    from public.source_snapshots s
    where s.id = new.snapshot_id;
    if not found then
      raise exception 'impact snapshot does not exist' using errcode = '23503';
    end if;
    if new.source_id is null then
      new.source_id := snap_source;
    elsif new.source_id is distinct from snap_source then
      raise exception 'impact source_id does not match the snapshot' using errcode = '23514';
    end if;
  end if;
  if new.matter_id is not null then
    select m.organization_id into matter_org
    from public.matters m
    where m.id = new.matter_id;
    if matter_org is distinct from new.organization_id then
      raise exception 'impact organization must match the matter' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function app.guard_rule_impact() from public;

create trigger rule_impacts_guard before insert or update on public.rule_impacts
  for each row execute function app.guard_rule_impact();
create trigger rule_impacts_touch before update on public.rule_impacts
  for each row execute function app.touch_row();
create trigger rule_impacts_stamp before insert on public.rule_impacts
  for each row execute function app.stamp_created_by();
create trigger rule_impacts_immutable before update on public.rule_impacts
  for each row execute function app.guard_tenant_keys();
create trigger rule_impacts_audit after insert or update or delete on public.rule_impacts
  for each row execute function app.audit_row_change();
create trigger rule_impacts_no_delete before delete on public.rule_impacts
  for each row execute function app.reject_governed_delete();
create trigger rule_impacts_no_truncate before truncate on public.rule_impacts
  for each statement execute function app.reject_governed_delete();

create trigger official_source_domains_stamp before insert on public.official_source_domains
  for each row execute function app.stamp_created_by();
create trigger official_source_domains_audit after insert or update or delete on public.official_source_domains
  for each row execute function app.audit_row_change();
create trigger official_source_domains_no_delete before delete on public.official_source_domains
  for each row execute function app.reject_governed_delete();
create trigger official_source_domains_no_truncate before truncate on public.official_source_domains
  for each statement execute function app.reject_governed_delete();

-- ---------------------------------------------------------------------------
-- Privileges and RLS. No DELETE grants. service_role writes the global catalog.
-- Authenticated writes reach only rows whose organization_id is the active firm.
-- ---------------------------------------------------------------------------
revoke all on table public.official_source_domains from public, anon, authenticated, service_role;
revoke all on table public.official_sources from public, anon, authenticated, service_role;
revoke all on table public.source_snapshots from public, anon, authenticated, service_role;
revoke all on table public.source_dependencies from public, anon, authenticated, service_role;
revoke all on table public.source_check_attempts from public, anon, authenticated, service_role;
revoke all on table public.rule_definitions from public, anon, authenticated, service_role;
revoke all on table public.rule_versions from public, anon, authenticated, service_role;
revoke all on table public.rule_evidence from public, anon, authenticated, service_role;
revoke all on table public.professional_reviews from public, anon, authenticated, service_role;
revoke all on table public.rule_pack_versions from public, anon, authenticated, service_role;
revoke all on table public.rule_pack_items from public, anon, authenticated, service_role;
revoke all on table public.matter_rule_bindings from public, anon, authenticated, service_role;
revoke all on table public.rule_impacts from public, anon, authenticated, service_role;

grant select on table public.official_source_domains to authenticated, service_role;
grant insert, update on table public.official_source_domains to service_role;

grant select, insert, update on table public.official_sources to authenticated, service_role;
grant select, insert, update on table public.source_snapshots to authenticated, service_role;
grant select, insert, update on table public.source_dependencies to authenticated, service_role;
grant select, insert on table public.source_check_attempts to authenticated, service_role;
grant select, insert, update on table public.rule_definitions to authenticated, service_role;
grant select, insert, update on table public.rule_versions to authenticated, service_role;
grant select, insert, update on table public.rule_evidence to authenticated, service_role;
grant select, insert, update on table public.professional_reviews to authenticated, service_role;
grant select, insert, update on table public.rule_pack_versions to authenticated, service_role;
grant select, insert on table public.rule_pack_items to authenticated, service_role;
grant select, insert, update on table public.matter_rule_bindings to authenticated, service_role;
grant select, insert, update on table public.rule_impacts to authenticated, service_role;

alter table public.official_source_domains enable row level security;
alter table public.official_source_domains force row level security;
alter table public.official_sources enable row level security;
alter table public.official_sources force row level security;
alter table public.source_snapshots enable row level security;
alter table public.source_snapshots force row level security;
alter table public.source_dependencies enable row level security;
alter table public.source_dependencies force row level security;
alter table public.source_check_attempts enable row level security;
alter table public.source_check_attempts force row level security;
alter table public.rule_definitions enable row level security;
alter table public.rule_definitions force row level security;
alter table public.rule_versions enable row level security;
alter table public.rule_versions force row level security;
alter table public.rule_evidence enable row level security;
alter table public.rule_evidence force row level security;
alter table public.professional_reviews enable row level security;
alter table public.professional_reviews force row level security;
alter table public.rule_pack_versions enable row level security;
alter table public.rule_pack_versions force row level security;
alter table public.rule_pack_items enable row level security;
alter table public.rule_pack_items force row level security;
alter table public.matter_rule_bindings enable row level security;
alter table public.matter_rule_bindings force row level security;
alter table public.rule_impacts enable row level security;
alter table public.rule_impacts force row level security;

create policy official_source_domains_select on public.official_source_domains
  for select to authenticated
  using ((select app.current_organization_id()) is not null);

-- Global catalog rows (organization_id null) are visible to any active member.
-- Firm rows are visible only to that firm's staff at aal2.
create policy official_sources_select on public.official_sources
  for select to authenticated
  using (
    (select app.current_organization_id()) is not null
    and (
      organization_id is null
      or (
        organization_id = (select app.current_organization_id())
        and (select app.is_org_staff(organization_id))
        and (select app.staff_mfa_satisfied())
      )
    )
  );
create policy official_sources_insert on public.official_sources
  for insert to authenticated
  with check ((select app.can_insert_practice_row(organization_id)));
create policy official_sources_update on public.official_sources
  for update to authenticated
  using ((select app.can_insert_practice_row(organization_id)))
  with check ((select app.can_insert_practice_row(organization_id)));

create policy source_snapshots_select on public.source_snapshots
  for select to authenticated
  using (
    (select app.current_organization_id()) is not null
    and (
      organization_id is null
      or (
        organization_id = (select app.current_organization_id())
        and (select app.is_org_staff(organization_id))
        and (select app.staff_mfa_satisfied())
      )
    )
  );
create policy source_snapshots_insert on public.source_snapshots
  for insert to authenticated
  with check ((select app.can_insert_practice_row(organization_id)));
create policy source_snapshots_update on public.source_snapshots
  for update to authenticated
  using ((select app.can_insert_practice_row(organization_id)))
  with check ((select app.can_insert_practice_row(organization_id)));

create policy source_dependencies_select on public.source_dependencies
  for select to authenticated
  using (
    (select app.current_organization_id()) is not null
    and (
      organization_id is null
      or (
        organization_id = (select app.current_organization_id())
        and (select app.is_org_staff(organization_id))
        and (select app.staff_mfa_satisfied())
      )
    )
  );
create policy source_dependencies_insert on public.source_dependencies
  for insert to authenticated
  with check ((select app.can_insert_practice_row(organization_id)));
create policy source_dependencies_update on public.source_dependencies
  for update to authenticated
  using ((select app.can_insert_practice_row(organization_id)))
  with check ((select app.can_insert_practice_row(organization_id)));

create policy source_check_attempts_select on public.source_check_attempts
  for select to authenticated
  using (
    (select app.current_organization_id()) is not null
    and (select app.is_org_staff((select app.current_organization_id())))
    and (select app.staff_mfa_satisfied())
    and (
      organization_id is null
      or organization_id = (select app.current_organization_id())
    )
  );
create policy source_check_attempts_insert on public.source_check_attempts
  for insert to authenticated
  with check ((select app.can_insert_practice_row(organization_id)));

create policy rule_definitions_select on public.rule_definitions
  for select to authenticated
  using (
    (select app.current_organization_id()) is not null
    and (select app.is_org_staff((select app.current_organization_id())))
    and (select app.staff_mfa_satisfied())
    and (
      (organization_id is null and has_published_version)
      or organization_id = (select app.current_organization_id())
    )
  );
create policy rule_definitions_insert on public.rule_definitions
  for insert to authenticated
  with check ((select app.can_insert_practice_row(organization_id)));
create policy rule_definitions_update on public.rule_definitions
  for update to authenticated
  using ((select app.can_insert_practice_row(organization_id)))
  with check ((select app.can_insert_practice_row(organization_id)));

create policy rule_versions_select on public.rule_versions
  for select to authenticated
  using (
    (select app.current_organization_id()) is not null
    and (select app.is_org_staff((select app.current_organization_id())))
    and (select app.staff_mfa_satisfied())
    and (
      (
        organization_id is null
        and status in ('published', 'review_due', 'suspended', 'superseded')
      )
      or organization_id = (select app.current_organization_id())
    )
  );
create policy rule_versions_insert on public.rule_versions
  for insert to authenticated
  with check ((select app.can_insert_practice_row(organization_id)));
create policy rule_versions_update on public.rule_versions
  for update to authenticated
  using ((select app.can_insert_practice_row(organization_id)))
  with check ((select app.can_insert_practice_row(organization_id)));

create policy rule_evidence_select on public.rule_evidence
  for select to authenticated
  using (
    (select app.current_organization_id()) is not null
    and (select app.is_org_staff((select app.current_organization_id())))
    and (select app.staff_mfa_satisfied())
    and (
      (
        organization_id is null
        and exists (
          select 1
          from public.rule_versions v
          where v.id = rule_version_id
            and v.organization_id is null
            and v.status in ('published', 'review_due', 'suspended', 'superseded')
        )
      )
      or organization_id = (select app.current_organization_id())
    )
  );
create policy rule_evidence_insert on public.rule_evidence
  for insert to authenticated
  with check ((select app.can_insert_practice_row(organization_id)));
create policy rule_evidence_update on public.rule_evidence
  for update to authenticated
  using ((select app.can_insert_practice_row(organization_id)))
  with check ((select app.can_insert_practice_row(organization_id)));

create policy professional_reviews_select on public.professional_reviews
  for select to authenticated
  using (
    (select app.is_org_staff(organization_id))
    and (select app.staff_mfa_satisfied())
    and organization_id = (select app.current_organization_id())
  );
create policy professional_reviews_insert on public.professional_reviews
  for insert to authenticated
  with check ((select app.can_insert_practice_row(organization_id)));
create policy professional_reviews_update on public.professional_reviews
  for update to authenticated
  using ((select app.can_insert_practice_row(organization_id)))
  with check ((select app.can_insert_practice_row(organization_id)));

create policy rule_pack_versions_select on public.rule_pack_versions
  for select to authenticated
  using (
    (select app.current_organization_id()) is not null
    and (select app.is_org_staff((select app.current_organization_id())))
    and (select app.staff_mfa_satisfied())
    and (
      (
        organization_id is null
        and status in ('published', 'review_due', 'suspended', 'superseded')
      )
      or organization_id = (select app.current_organization_id())
    )
  );
create policy rule_pack_versions_insert on public.rule_pack_versions
  for insert to authenticated
  with check ((select app.can_insert_practice_row(organization_id)));
create policy rule_pack_versions_update on public.rule_pack_versions
  for update to authenticated
  using ((select app.can_insert_practice_row(organization_id)))
  with check ((select app.can_insert_practice_row(organization_id)));

create policy rule_pack_items_select on public.rule_pack_items
  for select to authenticated
  using (
    (select app.current_organization_id()) is not null
    and (select app.is_org_staff((select app.current_organization_id())))
    and (select app.staff_mfa_satisfied())
    and (
      (
        organization_id is null
        and exists (
          select 1
          from public.rule_pack_versions p
          where p.id = pack_id
            and p.organization_id is null
            and p.status in ('published', 'review_due', 'suspended', 'superseded')
        )
      )
      or organization_id = (select app.current_organization_id())
    )
  );
create policy rule_pack_items_insert on public.rule_pack_items
  for insert to authenticated
  with check ((select app.can_insert_practice_row(organization_id)));

create policy matter_rule_bindings_select on public.matter_rule_bindings
  for select to authenticated
  using (
    (select app.is_org_staff(organization_id))
    and (select app.staff_mfa_satisfied())
    and organization_id = (select app.current_organization_id())
  );
create policy matter_rule_bindings_insert on public.matter_rule_bindings
  for insert to authenticated
  with check (
    (select app.can_insert_practice_row(organization_id))
    and exists (
      select 1
      from public.matters m
      where m.id = matter_id
        and m.organization_id = matter_rule_bindings.organization_id
    )
  );
create policy matter_rule_bindings_update on public.matter_rule_bindings
  for update to authenticated
  using ((select app.can_insert_practice_row(organization_id)))
  with check ((select app.can_insert_practice_row(organization_id)));

create policy rule_impacts_select on public.rule_impacts
  for select to authenticated
  using (
    (select app.is_org_staff(organization_id))
    and (select app.staff_mfa_satisfied())
    and organization_id = (select app.current_organization_id())
  );
create policy rule_impacts_insert on public.rule_impacts
  for insert to authenticated
  with check ((select app.can_insert_practice_row(organization_id)));
create policy rule_impacts_update on public.rule_impacts
  for update to authenticated
  using ((select app.can_insert_practice_row(organization_id)))
  with check ((select app.can_insert_practice_row(organization_id)));
