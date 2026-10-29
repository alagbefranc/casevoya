-- PREP-01, PREP-03 and PREP-04.
--
-- PREP-01. A form template is a firm's record of one official form: jurisdiction, program (optional),
-- the form identifier and version as printed on the official page, mapping version, effective date
-- only when the page states one, official URL, and an output format. Nothing is seeded. Staff
-- propose a template; a licensed member approves it (fresh step-up). The server stores a snapshot
-- hash when it can fetch the page; otherwise approval needs the reviewer's attestation that they
-- opened the page, the same rule as submission requirements. Output formats are field_review (which
-- approved facts fill which fields; Casevoya does not produce a filled government PDF) and
-- manual_completion (the form is finished by hand and uploaded). A matter pins an approved template.
-- A pin is stale when that template is no longer the approved one, its effective date is still in
-- the future, or the official page is past source.recheck_interval.form. Stale pins are flagged
-- and block package release.
--
-- PREP-03. Staff choose documents already stored on the matter, in order. The app builds one PDF:
-- a cover page, an index with page numbers, then the PDF and image pages. The file name and the
-- maximum size come from the firm's channel template, or from Casevoya's product default when the
-- firm has not set one (25 MiB, raisable to 100 MiB). That default is not an IRCC limit.
--
-- PREP-04. Releasing a package still pins each file. It also pins the form templates in use and a
-- snapshot of the matter's approved facts. The manifest hash gains those lines only when there is
-- something to add, so a release with no forms and no approved facts still hashes the files alone.
-- While the handoff is authorized, a change to the pinned files, the form pins, or the approved
-- facts turns the package gate red.
--
-- No form field list, form version, fee, or processing time is inserted by this migration.

-- ---------------------------------------------------------------------------
-- Form templates (empty until a firm records one)
-- ---------------------------------------------------------------------------
create table public.form_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  jurisdiction text not null check (jurisdiction ~ '^[A-Z]{2}$'),
  program_key text check (program_key is null or program_key ~ '^[a-z0-9_]{1,80}$'),
  official_form_id text not null check (official_form_id ~ '^[A-Za-z0-9][A-Za-z0-9 .()/-]{1,39}$'),
  official_url text not null check (length(official_url) between 12 and 500),
  source_section text check (source_section is null or length(btrim(source_section)) between 1 and 200),
  form_version text not null check (length(btrim(form_version)) between 1 and 80 and form_version !~ '[\n\r]'),
  mapping_version integer not null check (mapping_version >= 1),
  effective_on date,
  checked_on date not null,
  retrieved_at timestamptz not null,
  output_format text not null check (output_format in ('field_review', 'manual_completion')),
  source_id uuid not null,
  snapshot_id uuid,
  snapshot_sha256 text check (snapshot_sha256 is null or snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending_review' check (status in ('pending_review', 'approved', 'rejected', 'superseded', 'retired')),
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
  check (status not in ('approved', 'rejected', 'superseded', 'retired') or (reviewed_by_membership_id is not null and reviewed_at is not null)),
  check (status <> 'approved' or snapshot_sha256 is not null or page_attested_on is not null),
  check ((page_attested_on is null) = (page_attested_by_membership_id is null) and (page_attested_on is null) = (page_attested_at is null)),
  check ((status = 'retired') = (retired_at is not null)),
  foreign key (reviewed_by_membership_id, organization_id) references public.memberships (id, organization_id),
  foreign key (page_attested_by_membership_id, organization_id) references public.memberships (id, organization_id),
  foreign key (source_id, organization_id) references public.official_sources (id, organization_id),
  foreign key (snapshot_id, organization_id) references public.source_snapshots (id, organization_id)
);
comment on table public.form_templates is
  'PREP-01: a firm''s record of one official form, transcribed from an official page (URL, form identifier, version printed on the page, mapping version, optional effective date, output format). Empty until a licensed member approves one. Never seeded. Casevoya does not fill a government PDF from it.';
comment on column public.form_templates.effective_on is
  'Only when the official page states an effective date. Null means the page did not state one, not that a date was assumed.';
comment on column public.form_templates.output_format is
  'field_review: show which approved facts fill which transcribed fields. manual_completion: the form is finished by hand and uploaded. Neither format is a filled government PDF.';
comment on column public.form_templates.checked_on is
  'The date staff say they checked the official page (firm date). Not an effective date.';

create unique index form_templates_one_approved_uidx
  on public.form_templates (organization_id, jurisdiction, lower(official_form_id))
  where status = 'approved';
create index form_templates_org_status_idx on public.form_templates (organization_id, status);
create index form_templates_reviewer_org_fk_idx on public.form_templates (reviewed_by_membership_id, organization_id);
create index form_templates_attester_org_fk_idx on public.form_templates (page_attested_by_membership_id, organization_id);
create index form_templates_source_org_fk_idx on public.form_templates (source_id, organization_id);
create index form_templates_snapshot_org_fk_idx on public.form_templates (snapshot_id, organization_id);
create index form_templates_created_by_idx on public.form_templates (created_by);

create table public.form_template_fields (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  template_id uuid not null,
  position integer not null check (position between 1 and 200),
  field_key text not null check (field_key ~ '^[a-z][a-z0-9_]{0,79}$'),
  label text not null check (length(btrim(label)) between 1 and 200),
  required boolean not null,
  fact_field_key text check (fact_field_key is null or fact_field_key ~ '^[a-z][a-z0-9_]{0,79}$'),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  unique (id, organization_id),
  unique (template_id, position),
  unique (template_id, field_key),
  foreign key (template_id, organization_id) references public.form_templates (id, organization_id)
);
comment on table public.form_template_fields is
  'Fields a reviewer transcribed from the official form. fact_field_key is the intake answer key the value is taken from; null means the field is completed by hand. Append-only. Never seeded.';
comment on column public.form_template_fields.fact_field_key is
  'The matter''s approved-fact field key this form field reads. Null: no automatic value (manual completion).';

create index form_template_fields_org_fk_idx on public.form_template_fields (organization_id);
create index form_template_fields_template_org_fk_idx on public.form_template_fields (template_id, organization_id);
create index form_template_fields_created_by_idx on public.form_template_fields (created_by);

create table public.matter_form_pins (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  matter_id uuid not null,
  template_id uuid not null,
  pinned_at timestamptz not null default statement_timestamp(),
  pinned_by_membership_id uuid not null,
  superseded_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  unique (id, organization_id),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id),
  foreign key (template_id, organization_id) references public.form_templates (id, organization_id),
  foreign key (pinned_by_membership_id, organization_id) references public.memberships (id, organization_id)
);
comment on table public.matter_form_pins is
  'PREP-01: the form template a matter is using. The current pin for one official form is the row with superseded_at null. Replacing it does not change a package already released.';

create index matter_form_pins_org_fk_idx on public.matter_form_pins (organization_id);
create index matter_form_pins_matter_org_fk_idx on public.matter_form_pins (matter_id, organization_id);
create index matter_form_pins_template_org_fk_idx on public.matter_form_pins (template_id, organization_id);
create index matter_form_pins_member_org_fk_idx on public.matter_form_pins (pinned_by_membership_id, organization_id);
create index matter_form_pins_created_by_idx on public.matter_form_pins (created_by);
create index matter_form_pins_current_idx on public.matter_form_pins (matter_id) where superseded_at is null;

-- ---------------------------------------------------------------------------
-- Evidence bundle selection and channel export rules (PREP-03)
-- ---------------------------------------------------------------------------
create table public.submission_channel_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  channel public.submission_channel not null,
  name_pattern text not null check (length(name_pattern) between 5 and 120),
  max_bytes bigint not null check (max_bytes between 1048576 and 104857600),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id),
  unique (organization_id, channel)
);
comment on table public.submission_channel_templates is
  'PREP-03: a firm''s file-name pattern and maximum byte size for an evidence bundle on one submission channel. Product settings, not an IRCC rule. Absent: Casevoya uses {reference}-evidence-bundle.pdf and 25 MiB.';
comment on column public.submission_channel_templates.max_bytes is
  'Casevoya export cap for this channel, from 1 MiB to 100 MiB. Not a government file-size rule.';

create index submission_channel_templates_org_fk_idx on public.submission_channel_templates (organization_id);
create index submission_channel_templates_created_by_idx on public.submission_channel_templates (created_by);

create table public.matter_bundle_selections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  matter_id uuid not null,
  channel public.submission_channel not null,
  selection_number integer not null check (selection_number >= 1),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  unique (id, organization_id),
  unique (matter_id, selection_number),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id)
);
comment on table public.matter_bundle_selections is
  'PREP-03: one saved ordering of documents for an evidence bundle. The highest selection_number is current. Append-only.';

create index matter_bundle_selections_org_fk_idx on public.matter_bundle_selections (organization_id);
create index matter_bundle_selections_matter_org_fk_idx on public.matter_bundle_selections (matter_id, organization_id);
create index matter_bundle_selections_created_by_idx on public.matter_bundle_selections (created_by);

create table public.matter_bundle_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  selection_id uuid not null,
  position integer not null check (position between 1 and 100),
  document_id uuid not null,
  document_version_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  unique (id, organization_id),
  unique (selection_id, position),
  unique (selection_id, document_version_id),
  foreign key (selection_id, organization_id) references public.matter_bundle_selections (id, organization_id),
  foreign key (document_id, organization_id) references public.documents (id, organization_id),
  foreign key (document_version_id, organization_id) references public.document_versions (id, organization_id)
);
comment on table public.matter_bundle_items is
  'PREP-03: a document version in a bundle selection, in the order staff chose. Append-only.';

create index matter_bundle_items_org_fk_idx on public.matter_bundle_items (organization_id);
create index matter_bundle_items_selection_org_fk_idx on public.matter_bundle_items (selection_id, organization_id);
create index matter_bundle_items_document_org_fk_idx on public.matter_bundle_items (document_id, organization_id);
create index matter_bundle_items_version_org_fk_idx on public.matter_bundle_items (document_version_id, organization_id);
create index matter_bundle_items_created_by_idx on public.matter_bundle_items (created_by);

-- ---------------------------------------------------------------------------
-- Package manifest: form versions and approved facts (PREP-04)
-- ---------------------------------------------------------------------------
create table public.submission_manifest_forms (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  handoff_id uuid not null,
  position integer not null check (position between 1 and 50),
  template_id uuid not null,
  official_form_id text not null,
  form_version text not null,
  mapping_version integer not null check (mapping_version >= 1),
  official_url text not null,
  output_format text not null check (output_format in ('field_review', 'manual_completion')),
  snapshot_sha256 text check (snapshot_sha256 is null or snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  page_attested_on date,
  effective_on date,
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  unique (id, organization_id),
  unique (handoff_id, position),
  unique (handoff_id, template_id),
  foreign key (handoff_id, organization_id) references public.submission_handoffs (id, organization_id),
  foreign key (template_id, organization_id) references public.form_templates (id, organization_id)
);
comment on table public.submission_manifest_forms is
  'PREP-04: the form template versions in use when a package was released. Append-only. A later template does not rewrite this row.';

create index submission_manifest_forms_org_fk_idx on public.submission_manifest_forms (organization_id);
create index submission_manifest_forms_handoff_org_fk_idx on public.submission_manifest_forms (handoff_id, organization_id);
create index submission_manifest_forms_template_org_fk_idx on public.submission_manifest_forms (template_id, organization_id);
create index submission_manifest_forms_created_by_idx on public.submission_manifest_forms (created_by);

create table public.submission_manifest_facts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  handoff_id uuid not null,
  position integer not null check (position between 1 and 500),
  answer_id uuid not null,
  person_id uuid,
  field_key text not null,
  label text not null,
  value_text text not null,
  value_sha256 text not null check (value_sha256 ~ '^[0-9a-f]{64}$'),
  reviewed_at timestamptz not null,
  reviewer_membership_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  unique (id, organization_id),
  unique (handoff_id, position),
  unique (handoff_id, answer_id),
  foreign key (handoff_id, organization_id) references public.submission_handoffs (id, organization_id),
  foreign key (reviewer_membership_id, organization_id) references public.memberships (id, organization_id)
);
comment on table public.submission_manifest_facts is
  'PREP-04: the approved facts at package release, copied so the package can be read after the live answers change. Append-only. value_text is redacted in the audit diff.';

create index submission_manifest_facts_org_fk_idx on public.submission_manifest_facts (organization_id);
create index submission_manifest_facts_handoff_org_fk_idx on public.submission_manifest_facts (handoff_id, organization_id);
create index submission_manifest_facts_reviewer_org_fk_idx on public.submission_manifest_facts (reviewer_membership_id, organization_id);
create index submission_manifest_facts_created_by_idx on public.submission_manifest_facts (created_by);

comment on column public.submission_handoffs.manifest_sha256 is
  'SHA-256 over the pinned file lines, then one line per pinned form version and approved fact when those exist (PREP-04). A release with neither still hashes the file list alone.';

-- ---------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------
create trigger form_templates_url before insert or update on public.form_templates
  for each row execute function app.enforce_allowlisted_urls('official_url');
create trigger form_templates_touch before update on public.form_templates
  for each row execute function app.touch_row();
create trigger form_templates_keys before update on public.form_templates
  for each row execute function app.guard_tenant_keys();
create trigger form_templates_stamp before insert on public.form_templates
  for each row execute function app.stamp_created_by();
create trigger form_templates_guard before update or delete on public.form_templates
  for each row execute function app.gov_guard_update();
create trigger form_templates_audit after insert or update or delete on public.form_templates
  for each row execute function app.audit_row_change();

create function app.form_template_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.jurisdiction, new.program_key, new.official_form_id, new.official_url, new.source_section, new.form_version,
      new.mapping_version, new.effective_on, new.checked_on, new.retrieved_at, new.output_format, new.source_id,
      new.snapshot_id, new.snapshot_sha256)
     is distinct from
     (old.jurisdiction, old.program_key, old.official_form_id, old.official_url, old.source_section, old.form_version,
      old.mapping_version, old.effective_on, old.checked_on, old.retrieved_at, old.output_format, old.source_id,
      old.snapshot_id, old.snapshot_sha256) then
    raise exception 'a form template is not edited; enter a new mapping version' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.form_template_immutable() from public, anon;
create trigger form_templates_immutable before update on public.form_templates
  for each row execute function app.form_template_immutable();

create trigger form_template_fields_stamp before insert on public.form_template_fields
  for each row execute function app.stamp_created_by();
create trigger form_template_fields_append_only before update or delete on public.form_template_fields
  for each row execute function app.gov_reject_mutation();
create trigger form_template_fields_audit after insert on public.form_template_fields
  for each row execute function app.audit_row_change();

create function app.matter_form_pin_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'a form pin is not deleted' using errcode = '42501';
  end if;
  if not exists (
    select 1 from app.gov_write_nonce nonce where nonce.row_id = new.id and nonce.txid = txid_current()
  ) then
    raise exception 'a form pin changes only through its function' using errcode = '42501';
  end if;
  if (new.organization_id, new.matter_id, new.template_id, new.pinned_at, new.pinned_by_membership_id, new.created_by, new.created_at)
     is distinct from
     (old.organization_id, old.matter_id, old.template_id, old.pinned_at, old.pinned_by_membership_id, old.created_by, old.created_at) then
    raise exception 'only whether a form pin is current can change' using errcode = '42501';
  end if;
  if old.superseded_at is not null and new.superseded_at is distinct from old.superseded_at then
    raise exception 'a replaced form pin stays replaced' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.matter_form_pin_guard() from public, anon;
create trigger matter_form_pins_stamp before insert on public.matter_form_pins
  for each row execute function app.stamp_created_by();
create trigger matter_form_pins_guard before update or delete on public.matter_form_pins
  for each row execute function app.matter_form_pin_guard();
create trigger matter_form_pins_audit after insert or update on public.matter_form_pins
  for each row execute function app.audit_row_change();

create trigger submission_channel_templates_touch before update on public.submission_channel_templates
  for each row execute function app.touch_row();
create trigger submission_channel_templates_keys before update on public.submission_channel_templates
  for each row execute function app.guard_tenant_keys();
create trigger submission_channel_templates_stamp before insert on public.submission_channel_templates
  for each row execute function app.stamp_created_by();
create trigger submission_channel_templates_guard before update or delete on public.submission_channel_templates
  for each row execute function app.gov_guard_update();
create trigger submission_channel_templates_audit after insert or update or delete on public.submission_channel_templates
  for each row execute function app.audit_row_change();

create trigger matter_bundle_selections_stamp before insert on public.matter_bundle_selections
  for each row execute function app.stamp_created_by();
create trigger matter_bundle_selections_append_only before update or delete on public.matter_bundle_selections
  for each row execute function app.gov_reject_mutation();
create trigger matter_bundle_selections_audit after insert on public.matter_bundle_selections
  for each row execute function app.audit_row_change();

create trigger matter_bundle_items_stamp before insert on public.matter_bundle_items
  for each row execute function app.stamp_created_by();
create trigger matter_bundle_items_append_only before update or delete on public.matter_bundle_items
  for each row execute function app.gov_reject_mutation();
create trigger matter_bundle_items_audit after insert on public.matter_bundle_items
  for each row execute function app.audit_row_change();

create trigger submission_manifest_forms_stamp before insert on public.submission_manifest_forms
  for each row execute function app.stamp_created_by();
create trigger submission_manifest_forms_append_only before update or delete on public.submission_manifest_forms
  for each row execute function app.gov_reject_mutation();
create trigger submission_manifest_forms_audit after insert on public.submission_manifest_forms
  for each row execute function app.audit_row_change();

create trigger submission_manifest_facts_stamp before insert on public.submission_manifest_facts
  for each row execute function app.stamp_created_by();
create trigger submission_manifest_facts_append_only before update or delete on public.submission_manifest_facts
  for each row execute function app.gov_reject_mutation();
create trigger submission_manifest_facts_audit after insert on public.submission_manifest_facts
  for each row execute function app.audit_row_change('value_text');

-- ---------------------------------------------------------------------------
-- Freshness and field mapping
-- ---------------------------------------------------------------------------
create function app.channel_name_pattern_ok(p_pattern text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_pattern ~ '^[A-Za-z0-9._-]{0,40}(\{(reference|channel|date)\}[A-Za-z0-9._-]{0,40}){0,6}\.pdf$'
    and length(p_pattern) between 5 and 120
    and position('..' in p_pattern) = 0;
$$;
revoke all on function app.channel_name_pattern_ok(text) from public, anon;

-- Null when the template may be pinned. Otherwise not_current, not_yet_effective, or recheck_due.
create function app.form_template_stale_reason(p_template_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  template public.form_templates%rowtype;
  checked_at timestamptz;
  interval_known interval;
begin
  select * into template from public.form_templates where id = p_template_id;
  if template.id is null then
    return 'not_current';
  end if;
  if template.status is distinct from 'approved' then
    return 'not_current';
  end if;
  if template.effective_on is not null and template.effective_on > app.firm_today(template.organization_id) then
    return 'not_yet_effective';
  end if;
  interval_known := app.source_recheck_interval('form');
  checked_at := coalesce(
    case when template.snapshot_sha256 is not null then template.retrieved_at end,
    template.page_attested_on::timestamptz,
    template.created_at
  );
  if interval_known is not null and checked_at < statement_timestamp() - interval_known then
    return 'recheck_due';
  end if;
  return null;
end;
$$;
revoke all on function app.form_template_stale_reason(uuid) from public, anon;

create function app.form_template_is_stale(p_template_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.form_template_stale_reason(p_template_id) is not null;
$$;
revoke all on function app.form_template_is_stale(uuid) from public, anon;

-- Fields of one template, each filled or missing from the matter's approved facts.
create function app.form_field_fills(p_matter_id uuid, p_template_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'field_key', field.field_key,
    'label', field.label,
    'required', field.required,
    'fact_field_key', field.fact_field_key,
    'status', case
      when field.fact_field_key is null then 'manual'
      when exists (
        select 1 from app.matter_approved_facts(p_matter_id) fact
        where fact.field_key = field.fact_field_key
      ) then 'filled'
      else 'missing'
    end,
    'facts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'answer_id', fact.answer_id,
        'person_name', fact.person_name,
        'label', fact.label,
        'value_text', fact.value_text,
        'reviewed_at', fact.reviewed_at,
        'field_key', fact.field_key
      ) order by fact.person_name, fact.answer_id)
      from app.matter_approved_facts(p_matter_id) fact
      where field.fact_field_key is not null and fact.field_key = field.fact_field_key
    ), '[]'::jsonb)
  ) order by field.position), '[]'::jsonb)
  from public.form_template_fields field
  where field.template_id = p_template_id;
$$;
revoke all on function app.form_field_fills(uuid, uuid) from public, anon;

-- How many pinned form versions or approved facts differ from a released manifest.
create function app.manifest_scope_drift(p_handoff_id uuid, p_matter_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  form_drift integer := 0;
  stale_pins integer := 0;
  fact_drift integer := 0;
begin
  select count(*) into form_drift from (
    select pinned.template_id from public.submission_manifest_forms pinned where pinned.handoff_id = p_handoff_id
    except
    select pin.template_id from public.matter_form_pins pin where pin.matter_id = p_matter_id and pin.superseded_at is null
    union
    select pin.template_id from public.matter_form_pins pin where pin.matter_id = p_matter_id and pin.superseded_at is null
    except
    select pinned.template_id from public.submission_manifest_forms pinned where pinned.handoff_id = p_handoff_id
  ) diff;
  select count(*) into stale_pins
  from public.submission_manifest_forms pinned
  where pinned.handoff_id = p_handoff_id
    and app.form_template_is_stale(pinned.template_id);
  select count(*) into fact_drift from (
    select fact.answer_id, fact.value_sha256 from public.submission_manifest_facts fact where fact.handoff_id = p_handoff_id
    except
    select approved.answer_id, encode(sha256(convert_to(approved.value_text, 'UTF8')), 'hex')
    from app.matter_approved_facts(p_matter_id) approved
    union
    select approved.answer_id, encode(sha256(convert_to(approved.value_text, 'UTF8')), 'hex')
    from app.matter_approved_facts(p_matter_id) approved
    except
    select fact.answer_id, fact.value_sha256 from public.submission_manifest_facts fact where fact.handoff_id = p_handoff_id
  ) diff;
  return form_drift + stale_pins + fact_drift;
end;
$$;
revoke all on function app.manifest_scope_drift(uuid, uuid) from public, anon;
