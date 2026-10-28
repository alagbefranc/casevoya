-- AI-01 (#183): letters on a matter, and Vo's first drafts of them from approved facts, with
-- citations. Additive only.
--
-- A staff member writes a letter on a matter (a submission cover letter, a letter of explanation)
-- by hand, or asks Vo for a first draft. Either way it is a DRAFT: it can't be released (downloaded
-- as the final text) until a licensed member of the firm approves the exact version, with a fresh
-- step-up, and the approval is audited. Every edit is a new version; nothing is overwritten.
--
-- What Vo may use (PRD AI-01, AI-05, SRC-09; RULES.md):
--   * Approved facts only: an intake answer on this matter's submitted forms that is the latest
--     answer to its question and that staff reviewed (public.intake_answer_reviews). Each fact the
--     letter uses is cited in the text as [F1], [F2]... and stored with the version: the person,
--     form, question, value, and who approved it and when. Facts in a sensitive category the firm
--     hasn't switched on for Vo (identity, relationship, financial, medical, criminal, narratives)
--     are never shown to Vo and can't be cited (app.vo_fact_category, app.vo_category_allowed).
--   * Official content only from what a licensed member of the firm already approved: IRCC fees
--     (public.government_fee_references), submission steps and channel names
--     (public.submission_requirements), renewal timings (public.renewal_timings), follow-up steps
--     after an approval (public.approval_follow_up_steps) and published rule versions with their
--     source snapshot (source governance). Each one the letter mentions is cited as [S1], [S2]...
--     and stored with its official URL and section, form number and date modified, the date it
--     was checked, the current-to date and the page's snapshot hash (or the reviewer's
--     attestation). A fee, date or program requirement with no approved source is left out, and
--     the draft lists what was left out. Nothing is seeded here.
--
-- Changes
--   vo_settings.letter_drafts   the owner's switch "First drafts of letters from approved facts".
--   vo_runs                     a letter_draft run has no conversation (the thread check widened).
--   matter_letters              one letter: type, title, origin (vo or staff), its Vo run, status
--                               (draft, approved, discarded), the approved version and approver.
--   matter_letter_versions      append-only versions: text, cited facts, cited official sources,
--                               what was left out, and who wrote it.
--
-- Functions (security definer, search_path = '')
--   app.vo_fact_category(section, label)       the Vo category of a fact ('general' or a sensitive one).
--   app.matter_approved_facts(matter)           the approved facts of a matter (internal).
--   app.vo_letter_official_items(org, matter)   the firm's approved official content (internal).
--   public.set_vo_settings                      REDEFINED from 20261019218100_vo_doc_review.sql: the
--                                               same, plus the letter_drafts key.
--   public.begin_vo_letter_draft                staff with MFA who can read the matter; Vo on, the
--                                               letter switch on, sample mode, at least one approved
--                                               fact Vo may use, the shared Vo rate limits. Audited.
--   public.vo_letter_facts(run)                 the run's person, while it runs: the facts Vo may use.
--   public.vo_letter_official_content(run)      the same: the approved official content.
--   public.save_vo_letter_draft                 the run's person, within 10 minutes: the draft, its
--                                               citations rebuilt from the database (every [F#] an
--                                               approved fact Vo may use, every [S#] approved official
--                                               content, every marker cited and every citation used).
--                                               Audited vo.run_finished. Failures and abstentions
--                                               still end through public.finish_vo_run.
--   public.create_matter_letter                 a letter written by hand (works with Vo off). Audited.
--   public.revise_matter_letter                 a new version of a draft. Audited.
--   public.approve_matter_letter                a licensed member with a fresh step-up approves the
--                                               current version (no "[needs ...]" placeholder; their
--                                               own last edit only under the GOV self-approval rule).
--                                               Audited letter.approved.
--   public.discard_matter_letter                Audited letter.discarded.
--   public.release_matter_letter                the approved version's final text (citation markers
--                                               removed). Refused for a draft. Audited letter.released.

-- ---------------------------------------------------------------------------
-- vo_settings: the letter capability
-- ---------------------------------------------------------------------------

alter table public.vo_settings add column letter_drafts boolean not null default true;
comment on column public.vo_settings.letter_drafts is
  'Vo may write first drafts of letters on a matter from its approved facts (AI-01). On by default once the owner turns Vo on, like the other capabilities; the sensitive-category switches still decide which facts Vo may use.';

-- ---------------------------------------------------------------------------
-- vo_runs: a letter draft has no conversation
-- ---------------------------------------------------------------------------

alter table public.vo_runs drop constraint vo_runs_thread_kind_check;
alter table public.vo_runs
  add constraint vo_runs_thread_kind_check check ((kind in ('ask', 'document_review', 'letter_draft')) = (thread_id is null));

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.matter_letters (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  matter_id uuid not null,
  letter_type text not null check (letter_type in ('cover_letter', 'explanation', 'other')),
  title text not null check (length(btrim(title)) between 1 and 200),
  origin text not null check (origin in ('vo', 'staff')),
  run_id uuid unique,
  status text not null default 'draft' check (status in ('draft', 'approved', 'discarded')),
  current_version integer not null default 1 check (current_version >= 1),
  approved_version integer check (approved_version is null or approved_version >= 1),
  approved_by_membership_id uuid,
  approved_at timestamptz,
  approved_self boolean,
  discarded_by uuid references auth.users (id),
  discarded_at timestamptz,
  is_sample boolean not null default false,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id),
  check ((origin = 'vo') = (run_id is not null)),
  check ((status = 'approved') = (approved_at is not null)),
  check ((approved_at is null) = (approved_by_membership_id is null)),
  check ((approved_at is null) = (approved_version is null)),
  check ((approved_at is null) = (approved_self is null)),
  check ((status = 'discarded') = (discarded_at is not null)),
  check ((discarded_at is null) = (discarded_by is null)),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id),
  foreign key (run_id, organization_id) references public.vo_runs (id, organization_id),
  foreign key (approved_by_membership_id, organization_id) references public.memberships (id, organization_id)
);
comment on table public.matter_letters is
  'A letter on a matter (AI-01), written by hand or drafted by Vo from approved facts. A draft until a licensed member approves one exact version with a step-up; only then can it be released. Versions are in matter_letter_versions.';
comment on column public.matter_letters.approved_self is
  'The approver wrote the approved version themselves (allowed only under the GOV self-approval rule: no other licensed member, and a step-up after the edit).';

create index matter_letters_org_matter_idx on public.matter_letters (organization_id, matter_id, created_at desc);
create index matter_letters_matter_org_fk_idx on public.matter_letters (matter_id, organization_id);
create index matter_letters_run_org_fk_idx on public.matter_letters (run_id, organization_id);
create index matter_letters_approver_org_fk_idx on public.matter_letters (approved_by_membership_id, organization_id);
create index matter_letters_discarded_by_idx on public.matter_letters (discarded_by);
create index matter_letters_created_by_idx on public.matter_letters (created_by);

create table public.matter_letter_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  letter_id uuid not null,
  matter_id uuid not null,
  version_number integer not null check (version_number >= 1),
  title text not null check (length(btrim(title)) between 1 and 200),
  body text not null check (length(btrim(body)) between 1 and 12000),
  facts jsonb not null default '[]'::jsonb check (
    jsonb_typeof(facts) = 'array' and jsonb_array_length(facts) <= 60 and pg_column_size(facts) <= 64000
  ),
  official jsonb not null default '[]'::jsonb check (
    jsonb_typeof(official) = 'array' and jsonb_array_length(official) <= 30 and pg_column_size(official) <= 64000
  ),
  left_out jsonb not null default '[]'::jsonb check (
    jsonb_typeof(left_out) = 'array' and jsonb_array_length(left_out) <= 20 and pg_column_size(left_out) <= 8000
  ),
  origin text not null check (origin in ('vo', 'staff')),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  unique (letter_id, version_number),
  unique (id, organization_id),
  foreign key (letter_id, organization_id) references public.matter_letters (id, organization_id),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id)
);
comment on table public.matter_letter_versions is
  'Append-only versions of a matter letter. facts: the approved facts cited as [F#] (person, form, question, value, approver). official: the approved official content cited as [S#] (URL and section, form number and date modified, date checked, current-to date, snapshot hash or attestation). left_out: what Vo left out for want of an approved source.';

create index matter_letter_versions_letter_org_fk_idx on public.matter_letter_versions (letter_id, organization_id, version_number desc);
create index matter_letter_versions_matter_org_fk_idx on public.matter_letter_versions (matter_id, organization_id);
create index matter_letter_versions_created_by_idx on public.matter_letter_versions (created_by);

create function app.reject_letter_version_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'letter versions are kept as written' using errcode = '42501';
end;
$$;
revoke all on function app.reject_letter_version_change() from public;

create trigger matter_letter_versions_append_only before update or delete on public.matter_letter_versions
  for each row execute function app.reject_letter_version_change();

alter table public.matter_letters enable row level security;
alter table public.matter_letters force row level security;
alter table public.matter_letter_versions enable row level security;
alter table public.matter_letter_versions force row level security;

revoke all on public.matter_letters from public, anon, authenticated;
revoke all on public.matter_letter_versions from public, anon, authenticated;
grant select on public.matter_letters to authenticated;
grant select on public.matter_letter_versions to authenticated;
grant select, insert, update on public.matter_letters to service_role;
grant select, insert on public.matter_letter_versions to service_role;

-- The staff who may read the matter's messages and Vo drafts (not finance users, at staff
-- assurance, on a matter they can read). Portal roles never read letters here.
create policy matter_letters_select on public.matter_letters
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and app.message_staff_reads_matter(matter_id, organization_id)
  );
create policy matter_letter_versions_select on public.matter_letter_versions
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and app.message_staff_reads_matter(matter_id, organization_id)
  );

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- The Vo category of an approved fact, for the per-category switches (AI-06): the answer's
-- section first, then words in the question. 'general' facts (a name, a date of arrival, a city)
-- need only the letter switch; the others need their category switched on as well.
create function app.vo_fact_category(p_section public.person_section_key, p_label text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_section = 'passport_bio' then 'identity'
    when p_section = 'police_certificate' then 'criminal'
    when p_section = 'shared_family_record' then 'relationship'
    when p_section = 'private_record' then 'narrative'
    when lower(coalesce(p_label, '')) ~ '(medical|health|illness|diagnos|disabilit)' then 'medical'
    when lower(coalesce(p_label, '')) ~ '(police|criminal|court|convict|arrest|offen[cs]e|charge)' then 'criminal'
    when lower(coalesce(p_label, '')) ~ '(passport|national id|identity (card|number|document)|travel document|document number|uci|client id)' then 'identity'
    when lower(coalesce(p_label, '')) ~ '(bank|income|salary|wage|tax|funds|savings|financial|net worth|asset)' then 'financial'
    when lower(coalesce(p_label, '')) ~ '(marri|spouse|partner|relationship|common-law|common law|wedding|divorc)' then 'relationship'
    when lower(coalesce(p_label, '')) ~ '(statement|narrative|explain|explanation|story|reason for)' then 'narrative'
    else 'general'
  end;
$$;
revoke all on function app.vo_fact_category(public.person_section_key, text) from public;
grant execute on function app.vo_fact_category(public.person_section_key, text) to authenticated, service_role;

-- The approved facts of one matter: on each submitted form of the matter, the latest answer to
-- each question when staff reviewed that answer, for the question types a letter can quote
-- (text, date, country, choice). Unknown, not applicable, repeating rows, addresses, uploads and
-- declarations are not facts a letter quotes. Internal: callers check access first.
create function app.matter_approved_facts(p_matter_id uuid)
returns table (
  answer_id uuid,
  response_id uuid,
  person_id uuid,
  person_name text,
  form_title text,
  field_key text,
  field_type text,
  label text,
  value_text text,
  reviewer_membership_id uuid,
  reviewed_at timestamptz,
  category text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    latest.id,
    response.id,
    response.person_id,
    person.display_name,
    template.title,
    latest.field_key,
    field.value ->> 'type',
    left(coalesce(nullif(btrim(field.value -> 'labels' ->> 'en-CA'), ''), nullif(btrim(field.value -> 'labels' ->> 'fr-CA'), ''), latest.field_key), 200),
    left(
      coalesce(
        case
          when latest.calendar_date is not null then to_char(latest.calendar_date, 'YYYY-MM-DD')
          when latest.year_value is not null and latest.month_value is not null then latest.year_value::text || '-' || lpad(latest.month_value::text, 2, '0')
          when latest.year_value is not null then latest.year_value::text
          else nullif(btrim(latest.normalized_value ->> 'text'), '')
        end,
        ''
      ) || case when latest.presence = 'approximate' then ' (approximate)' else '' end,
      300
    ),
    review.reviewer_membership_id,
    review.created_at,
    app.vo_fact_category(
      latest.section_key,
      coalesce(field.value -> 'labels' ->> 'en-CA', field.value -> 'labels' ->> 'fr-CA', latest.field_key)
    )
  from public.intake_responses response
  join public.intake_templates template on template.id = response.template_id
  join public.persons person on person.id = response.person_id
  cross join lateral (
    select distinct on (answer.field_key) answer.*
    from public.intake_answer_versions answer
    where answer.response_id = response.id
    order by answer.field_key, answer.created_at desc, answer.id desc
  ) latest
  join public.intake_answer_reviews review on review.answer_id = latest.id
  cross join lateral (
    select candidate.value
    from jsonb_array_elements(coalesce(template.schema -> 'fields', '[]'::jsonb)) candidate
    where candidate.value ->> 'key' = latest.field_key
    limit 1
  ) field
  where response.matter_id = p_matter_id
    and response.status = 'submitted'
    and latest.presence in ('provided', 'approximate')
    and field.value ->> 'type' in ('text', 'date', 'country', 'choice')
    and (
      latest.calendar_date is not null
      or latest.year_value is not null
      or nullif(btrim(latest.normalized_value ->> 'text'), '') is not null
    );
$$;
revoke all on function app.matter_approved_facts(uuid) from public;

-- The firm's approved official content a letter on this matter may cite: what a licensed member
-- approved in the GOV, DEC and FIN registers (for the matter's program or every program), and
-- published, current rule versions with their source evidence. Each row carries its source.
-- Internal: callers check access first.
create function app.vo_letter_official_items(p_org uuid, p_matter_id uuid)
returns table (
  kind text,
  id uuid,
  label text,
  content text,
  source_url text,
  source_section text,
  form_number text,
  form_modified_on date,
  checked_on date,
  current_to date,
  snapshot_sha256 text,
  attested_on date,
  reviewed_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with program as (select app.matter_program_key(p_matter_id) as key)
  select 'fee', fee.id, left(fee.name, 300),
         left(fee.name || ': CAD ' || to_char(fee.amount_cents / 100.0, 'FM999999990.00'), 600),
         fee.source_url, fee.section, null::text, null::date,
         app.firm_local_date(p_org, fee.retrieved_at), null::date, fee.snapshot_sha256, null::date, fee.reviewed_at
  from public.government_fee_references fee
  where fee.organization_id = p_org and fee.status = 'approved'
  union all
  select 'submission_requirement', req.id,
         case when req.kind = 'channel_name' then 'IRCC channel name' else 'Step outside Casevoya' end,
         left(req.label, 600),
         req.source_url, req.source_section, req.form_number, req.form_modified_on,
         req.checked_on, req.current_to, req.snapshot_sha256, req.page_attested_on, req.reviewed_at
  from public.submission_requirements req, program
  where req.organization_id = p_org and req.status = 'approved'
    and (req.program_key is null or req.program_key = program.key)
  union all
  select 'renewal_timing', timing.id, left(timing.applies_to, 300),
         left(timing.applies_to || ': ' || timing.timing_text, 600),
         timing.source_url, timing.source_section, timing.form_number, timing.form_modified_on,
         timing.checked_on, timing.current_to, timing.snapshot_sha256, timing.page_attested_on, timing.reviewed_at
  from public.renewal_timings timing, program
  where timing.organization_id = p_org and timing.status = 'approved'
    and (timing.program_key is null or timing.program_key = program.key)
  union all
  select 'follow_up_step', step.id, left(step.label, 300),
         left(step.label || coalesce(': ' || step.timing_text, ''), 600),
         step.source_url, step.source_section, step.form_number, step.form_modified_on,
         step.checked_on, step.current_to, step.snapshot_sha256, step.page_attested_on, step.reviewed_at
  from public.approval_follow_up_steps step, program
  where step.organization_id = p_org and step.status = 'approved' and step.retired_at is null
    and step.program_key = program.key
  union all
  select 'rule_version', rule.id, left(definition.stable_key, 300), left(rule.claim, 600),
         evidence.final_url, evidence.source_section, null::text, evidence.modified_on,
         app.firm_local_date(p_org, evidence.retrieved_at), evidence.current_to, evidence.content_hash, null::date, null::timestamptz
  from public.rule_versions rule
  join public.rule_definitions definition on definition.id = rule.definition_id
  cross join program
  cross join lateral (
    select snapshot.final_url, link.source_section, snapshot.modified_on, snapshot.retrieved_at, snapshot.current_to, snapshot.content_hash
    from public.rule_evidence link
    join public.source_snapshots snapshot on snapshot.id = link.snapshot_id
    where link.rule_version_id = rule.id
    order by snapshot.retrieved_at desc
    limit 1
  ) evidence
  where rule.status = 'published'
    and rule.claim is not null
    and (definition.organization_id is null or definition.organization_id = p_org)
    and (rule.organization_id is null or rule.organization_id = p_org)
    and (definition.program_key is null or definition.program_key = program.key)
    and (rule.effective_to is null or rule.effective_to > statement_timestamp())
    and (rule.effective_from is null or rule.effective_from <= statement_timestamp());
$$;
revoke all on function app.vo_letter_official_items(uuid, uuid) from public;

-- A letter run, checked: the caller is its person, it is a letter run still running, and the
-- caller can still read its matter.
create function app.vo_letter_run(p_run_id uuid)
returns public.vo_runs
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  run public.vo_runs%rowtype;
begin
  select * into run from public.vo_runs where id = p_run_id;
  if run.id is null or (select auth.uid()) is null or run.user_id is distinct from (select auth.uid())
     or run.kind <> 'letter_draft' or run.result <> 'running'
     or app.message_staff_reads_matter(run.matter_id, run.organization_id) is distinct from true then
    raise exception 'vo denied' using errcode = '42501';
  end if;
  return run;
end;
$$;
revoke all on function app.vo_letter_run(uuid) from public;

-- ---------------------------------------------------------------------------
-- set_vo_settings (redefined from 20261019218100_vo_doc_review.sql: the letter_drafts key added;
-- nothing else changed)
-- ---------------------------------------------------------------------------

create or replace function public.set_vo_settings(p_organization_id uuid, p_changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  before_enabled boolean;
  current_row public.vo_settings%rowtype;
  key text;
  allowed text[] := array[
    'enabled', 'reply_drafts', 'staff_answers', 'read_client_messages', 'read_identity', 'read_relationship',
    'read_financial', 'read_medical', 'read_criminal', 'read_narratives',
    'doc_classification', 'ocr_normalisation', 'missing_fields', 'inconsistency_flags',
    -- AI-01 letter drafts
    'letter_drafts'
  ];
begin
  perform app.require_active_staff(p_organization_id, array['firm_owner']::public.org_role[], false);
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'::jsonb then
    raise exception 'choose a Vo switch' using errcode = '22023';
  end if;
  for key in select jsonb_object_keys(p_changes)
  loop
    if not (key = any (allowed)) or jsonb_typeof(p_changes -> key) <> 'boolean' then
      raise exception 'unknown Vo switch' using errcode = '22023';
    end if;
  end loop;
  before_enabled := app.vo_enabled(p_organization_id);
  select * into current_row from public.vo_settings where organization_id = p_organization_id for update;
  if current_row.organization_id is null then
    insert into public.vo_settings (organization_id, enabled, updated_by)
    values (p_organization_id, before_enabled, actor)
    returning * into current_row;
  end if;
  update public.vo_settings
    set enabled = coalesce((p_changes ->> 'enabled')::boolean, current_row.enabled),
        reply_drafts = coalesce((p_changes ->> 'reply_drafts')::boolean, current_row.reply_drafts),
        staff_answers = coalesce((p_changes ->> 'staff_answers')::boolean, current_row.staff_answers),
        read_client_messages = coalesce((p_changes ->> 'read_client_messages')::boolean, current_row.read_client_messages),
        read_identity = coalesce((p_changes ->> 'read_identity')::boolean, current_row.read_identity),
        read_relationship = coalesce((p_changes ->> 'read_relationship')::boolean, current_row.read_relationship),
        read_financial = coalesce((p_changes ->> 'read_financial')::boolean, current_row.read_financial),
        read_medical = coalesce((p_changes ->> 'read_medical')::boolean, current_row.read_medical),
        read_criminal = coalesce((p_changes ->> 'read_criminal')::boolean, current_row.read_criminal),
        read_narratives = coalesce((p_changes ->> 'read_narratives')::boolean, current_row.read_narratives),
        doc_classification = coalesce((p_changes ->> 'doc_classification')::boolean, current_row.doc_classification),
        ocr_normalisation = coalesce((p_changes ->> 'ocr_normalisation')::boolean, current_row.ocr_normalisation),
        missing_fields = coalesce((p_changes ->> 'missing_fields')::boolean, current_row.missing_fields),
        inconsistency_flags = coalesce((p_changes ->> 'inconsistency_flags')::boolean, current_row.inconsistency_flags),
        letter_drafts = coalesce((p_changes ->> 'letter_drafts')::boolean, current_row.letter_drafts),
        updated_at = now(),
        updated_by = actor
    where organization_id = p_organization_id
    returning * into current_row;
  perform app.record_audit_event(
    p_organization_id, 'vo.settings_changed', 'vo_settings', null, 'success',
    jsonb_build_object('changes', p_changes, 'was_enabled', before_enabled, 'enabled', current_row.enabled)
  );
  return to_jsonb(current_row) - 'updated_by';
end;
$$;

-- ---------------------------------------------------------------------------
-- Vo: begin a letter draft
-- ---------------------------------------------------------------------------

create function public.begin_vo_letter_draft(p_organization_id uuid, p_matter_id uuid, p_letter_type text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  matter public.matters%rowtype;
  settings public.vo_settings%rowtype;
  usable integer;
  last_hour integer;
  last_day integer;
  firm_day integer;
  rid uuid;
begin
  perform app.require_active_staff(
    p_organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[],
    false
  );
  if p_letter_type is null or p_letter_type not in ('cover_letter', 'explanation', 'other') then
    raise exception 'choose a letter type' using errcode = '22023';
  end if;
  select * into matter from public.matters where id = p_matter_id and organization_id = p_organization_id;
  -- Vo reads only what the requesting person can read.
  if matter.id is null or app.message_staff_reads_matter(matter.id, matter.organization_id) is distinct from true then
    raise exception 'vo denied' using errcode = '42501';
  end if;
  if app.vo_enabled(p_organization_id) is distinct from true then
    return jsonb_build_object('ok', false, 'error', 'off');
  end if;
  select * into settings from public.vo_settings where organization_id = p_organization_id;
  if settings.organization_id is not null and settings.letter_drafts is not true then
    return jsonb_build_object('ok', false, 'error', 'capability_off');
  end if;
  -- In sample mode Vo works on sample records only.
  if app.sample_mode_blocks_real(p_organization_id, matter.is_sample) then
    return jsonb_build_object('ok', false, 'error', 'sample_only');
  end if;
  -- Without an approved fact Vo may use there is nothing to draft from: say so without a run.
  select count(*) into usable
  from app.matter_approved_facts(matter.id) fact
  where fact.category = 'general' or app.vo_category_allowed(p_organization_id, fact.category);
  if usable = 0 then
    return jsonb_build_object('ok', false, 'error', 'no_facts');
  end if;

  -- The same limits as every Vo run, serialized per firm (20261019207100_vo_drafts.sql).
  perform pg_advisory_xact_lock(hashtextextended('vo_run:' || p_organization_id::text, 0));
  select count(*) filter (where user_id = actor and created_at > statement_timestamp() - interval '1 hour'),
         count(*) filter (where user_id = actor),
         count(*)
  into last_hour, last_day, firm_day
  from public.vo_runs
  where organization_id = p_organization_id
    and created_at > statement_timestamp() - interval '1 day';
  if last_hour >= 20 or last_day >= 100 then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;
  if firm_day >= 300 then
    return jsonb_build_object('ok', false, 'error', 'firm_rate_limited');
  end if;

  insert into public.vo_runs (organization_id, user_id, kind, matter_id, thread_id, is_sample)
  values (p_organization_id, actor, 'letter_draft', matter.id, null, matter.is_sample)
  returning id into rid;
  perform app.record_audit_event(
    p_organization_id, 'vo.run_started', 'vo_runs', rid, 'success',
    jsonb_build_object('kind', 'letter_draft', 'letter_type', p_letter_type)
  );
  return jsonb_build_object('ok', true, 'run_id', rid, 'matter_id', matter.id);
end;
$$;
revoke all on function public.begin_vo_letter_draft(uuid, uuid, text) from public, anon;
grant execute on function public.begin_vo_letter_draft(uuid, uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Vo's reads during a letter run (as the run's person)
-- ---------------------------------------------------------------------------

-- The approved facts Vo may use, and how many the firm's category switches hide.
create function public.vo_letter_facts(p_run_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  run public.vo_runs;
  facts jsonb;
  hidden integer;
begin
  run := app.vo_letter_run(p_run_id);
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'answer_id', fact.answer_id,
      'person', fact.person_name,
      'form', fact.form_title,
      'field_type', fact.field_type,
      'label', fact.label,
      'value', fact.value_text
    ) order by fact.person_name, fact.form_title, fact.label) filter (
      where fact.category = 'general' or app.vo_category_allowed(run.organization_id, fact.category)
    ), '[]'::jsonb),
    count(*) filter (where fact.category <> 'general' and not app.vo_category_allowed(run.organization_id, fact.category))
  into facts, hidden
  from app.matter_approved_facts(run.matter_id) fact;
  return jsonb_build_object('facts', facts, 'hidden', hidden);
end;
$$;
revoke all on function public.vo_letter_facts(uuid) from public, anon;
grant execute on function public.vo_letter_facts(uuid) to authenticated, service_role;

-- The approved official content Vo may cite (text and source; no page body).
create function public.vo_letter_official_content(p_run_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  run public.vo_runs;
begin
  run := app.vo_letter_run(p_run_id);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'kind', item.kind,
      'id', item.id,
      'label', item.label,
      'content', item.content,
      'source_url', item.source_url,
      'checked_on', item.checked_on
    ) order by item.kind, item.label)
    from (select * from app.vo_letter_official_items(run.organization_id, run.matter_id) limit 400) item
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.vo_letter_official_content(uuid) from public, anon;
grant execute on function public.vo_letter_official_content(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Vo: save the draft (the run ends as drafted)
-- ---------------------------------------------------------------------------

create function public.save_vo_letter_draft(
  p_run_id uuid,
  p_letter_type text,
  p_title text,
  p_body text,
  p_facts jsonb,
  p_official jsonb,
  p_left_out jsonb,
  p_model text,
  p_prompt_version text,
  p_latency_ms integer default null,
  p_tools text[] default null,
  p_input_tokens integer default null,
  p_output_tokens integer default null,
  p_cost_usd numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  run public.vo_runs%rowtype;
  item jsonb;
  ref text;
  refs text[] := array[]::text[];
  markers text[];
  fact record;
  official record;
  facts_out jsonb := '[]'::jsonb;
  official_out jsonb := '[]'::jsonb;
  notes jsonb := '[]'::jsonb;
  note text;
  body_text text := btrim(coalesce(p_body, ''));
  title_text text := btrim(coalesce(p_title, ''));
  lid uuid;
begin
  select * into run from public.vo_runs where id = p_run_id for update;
  if run.id is null or actor is null or run.user_id is distinct from actor
     or app.in_active_org(run.organization_id) is distinct from true
     or app.staff_mfa_satisfied() is distinct from true
     or run.kind <> 'letter_draft' then
    raise exception 'vo denied' using errcode = '42501';
  end if;
  if run.result <> 'running' then
    raise exception 'this Vo run is already finished' using errcode = '22023';
  end if;
  -- A run left open too long ends as failed; nothing is saved from it.
  if run.created_at < statement_timestamp() - interval '10 minutes' then
    update public.vo_runs set result = 'failed', failure = 'expired', finished_at = clock_timestamp() where id = run.id;
    return null;
  end if;
  if app.message_staff_reads_matter(run.matter_id, run.organization_id) is distinct from true then
    raise exception 'vo denied' using errcode = '42501';
  end if;
  if p_letter_type is null or p_letter_type not in ('cover_letter', 'explanation', 'other') then
    raise exception 'choose a letter type' using errcode = '22023';
  end if;
  if length(title_text) not between 1 and 200 or length(body_text) not between 1 and 12000 then
    raise exception 'a letter needs a title and 1 to 12000 characters' using errcode = '22023';
  end if;
  if p_model is null or p_model !~ '^[a-z0-9@][a-z0-9@._/-]{2,119}$' or p_prompt_version is null or p_prompt_version !~ '^[a-z0-9._-]{1,40}$' then
    raise exception 'a draft records its model and prompt version' using errcode = '22023';
  end if;
  if p_latency_ms is not null and p_latency_ms not between 0 and 600000 then
    raise exception 'latency out of range' using errcode = '22023';
  end if;
  if p_tools is not null and (cardinality(p_tools) > 60 or exists (select 1 from unnest(p_tools) t where t !~ '^[A-Za-z0-9_]{1,80}$')) then
    raise exception 'tool names out of range' using errcode = '22023';
  end if;
  if coalesce(p_input_tokens, 0) < 0 or coalesce(p_output_tokens, 0) < 0 or coalesce(p_cost_usd, 0) < 0 or coalesce(p_cost_usd, 0) > 1000 then
    raise exception 'usage out of range' using errcode = '22023';
  end if;
  if p_facts is null or jsonb_typeof(p_facts) <> 'array' or jsonb_array_length(p_facts) not between 1 and 60 then
    raise exception 'a letter cites 1 to 60 approved facts' using errcode = '22023';
  end if;
  if p_official is null or jsonb_typeof(p_official) <> 'array' or jsonb_array_length(p_official) > 30 then
    raise exception 'a letter cites up to 30 official sources' using errcode = '22023';
  end if;
  if p_left_out is null or jsonb_typeof(p_left_out) <> 'array' or jsonb_array_length(p_left_out) > 20 then
    raise exception 'list up to 20 things left out' using errcode = '22023';
  end if;

  -- Every cited fact is an approved fact of this matter that the firm lets Vo use. The citation
  -- is rebuilt here from the database; nothing the service says about a fact is kept.
  for item in select value from jsonb_array_elements(p_facts)
  loop
    ref := item ->> 'ref';
    if jsonb_typeof(item) <> 'object' or ref is null or ref !~ '^F[0-9]{1,3}$' or ref = any (refs)
       or coalesce(item ->> 'answer_id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'a cited fact needs a reference and an answer' using errcode = '22023';
    end if;
    select * into fact from app.matter_approved_facts(run.matter_id) approved where approved.answer_id = (item ->> 'answer_id')::uuid;
    if not found then
      raise exception 'a cited fact is not an approved fact on this matter' using errcode = '42501';
    end if;
    if fact.category <> 'general' and app.vo_category_allowed(run.organization_id, fact.category) is distinct from true then
      raise exception 'the firm hasn''t let Vo use this kind of fact' using errcode = '42501';
    end if;
    refs := refs || ref;
    facts_out := facts_out || jsonb_build_array(jsonb_build_object(
      'ref', ref,
      'answer_id', fact.answer_id,
      'response_id', fact.response_id,
      'person_id', fact.person_id,
      'person', fact.person_name,
      'form', fact.form_title,
      'field_key', fact.field_key,
      'field_type', fact.field_type,
      'label', fact.label,
      'value', fact.value_text,
      'reviewer_membership_id', fact.reviewer_membership_id,
      'reviewed_at', fact.reviewed_at
    ));
  end loop;

  -- Every cited official item is content a licensed member of this firm approved, with its source.
  for item in select value from jsonb_array_elements(p_official)
  loop
    ref := item ->> 'ref';
    if jsonb_typeof(item) <> 'object' or ref is null or ref !~ '^S[0-9]{1,3}$' or ref = any (refs)
       or coalesce(item ->> 'id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'a cited source needs a reference and an id' using errcode = '22023';
    end if;
    select * into official
    from app.vo_letter_official_items(run.organization_id, run.matter_id) approved
    where approved.kind = item ->> 'kind' and approved.id = (item ->> 'id')::uuid;
    if not found then
      raise exception 'a cited source is not approved official content of this firm' using errcode = '42501';
    end if;
    refs := refs || ref;
    official_out := official_out || jsonb_build_array(jsonb_build_object(
      'ref', ref,
      'kind', official.kind,
      'id', official.id,
      'label', official.label,
      'content', official.content,
      'source_url', official.source_url,
      'source_section', official.source_section,
      'form_number', official.form_number,
      'form_modified_on', official.form_modified_on,
      'checked_on', official.checked_on,
      'current_to', official.current_to,
      'snapshot_sha256', official.snapshot_sha256,
      'attested_on', official.attested_on,
      'reviewed_at', official.reviewed_at
    ));
  end loop;

  -- The text cites exactly what was given: every marker is a citation and every citation is used.
  select coalesce(array_agg(distinct hit[1]), array[]::text[]) into markers
  from regexp_matches(body_text, '\[([FS][0-9]{1,3})\]', 'g') hit;
  if exists (select 1 from unnest(markers) m where not (m = any (refs)))
     or exists (select 1 from unnest(refs) r where not (r = any (markers))) then
    raise exception 'every citation in the letter must match a cited record' using errcode = '22023';
  end if;
  -- A money amount needs an approved official source in the letter (the service's guard checks
  -- each sentence; this is the database's own floor).
  if body_text ~* '(\$|cad|c\$)\s?[0-9]' and jsonb_array_length(official_out) = 0 then
    raise exception 'a fee needs an approved official source' using errcode = '22023';
  end if;
  -- What Vo left out, one plain line each.
  for item in select value from jsonb_array_elements(p_left_out)
  loop
    note := btrim(coalesce(item #>> '{}', ''));
    if jsonb_typeof(item) <> 'string' or length(note) not between 1 and 300 then
      raise exception 'each thing left out is one line' using errcode = '22023';
    end if;
    notes := notes || to_jsonb(note);
  end loop;

  insert into public.matter_letters (organization_id, matter_id, letter_type, title, origin, run_id, is_sample, created_by)
  values (run.organization_id, run.matter_id, p_letter_type, title_text, 'vo', run.id, run.is_sample, actor)
  returning id into lid;
  insert into public.matter_letter_versions (
    organization_id, letter_id, matter_id, version_number, title, body, facts, official, left_out, origin, created_by
  ) values (
    run.organization_id, lid, run.matter_id, 1, title_text, body_text, facts_out, official_out, notes, 'vo', actor
  );

  update public.vo_runs
    set result = 'drafted',
        model = p_model,
        prompt_version = p_prompt_version,
        source_count = jsonb_array_length(facts_out) + jsonb_array_length(official_out),
        latency_ms = p_latency_ms,
        tools_called = coalesce(p_tools, '{}'::text[]),
        input_tokens = p_input_tokens,
        output_tokens = p_output_tokens,
        cost_usd = p_cost_usd,
        failure = null,
        finished_at = clock_timestamp()
    where id = run.id;

  perform app.record_audit_event(
    run.organization_id, 'vo.run_finished', 'vo_runs', run.id, 'success',
    jsonb_build_object(
      'kind', run.kind,
      'result', 'drafted',
      'model', p_model,
      'prompt_version', p_prompt_version,
      'letter_id', lid,
      'facts', jsonb_array_length(facts_out),
      'official_sources', jsonb_array_length(official_out),
      'left_out', jsonb_array_length(notes),
      'tools', coalesce(p_tools, '{}'::text[])
    )
  );
  return lid;
end;
$$;
revoke all on function public.save_vo_letter_draft(uuid, text, text, text, jsonb, jsonb, jsonb, text, text, integer, text[], integer, integer, numeric) from public, anon;
grant execute on function public.save_vo_letter_draft(uuid, text, text, text, jsonb, jsonb, jsonb, text, text, integer, text[], integer, integer, numeric)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Letters by hand, revisions, review and release
-- ---------------------------------------------------------------------------

-- A letter written by hand: the non-AI path, available whatever the Vo switches say.
create function public.create_matter_letter(
  p_organization_id uuid,
  p_matter_id uuid,
  p_letter_type text,
  p_title text,
  p_body text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  matter public.matters%rowtype;
  title_text text := btrim(coalesce(p_title, ''));
  body_text text := btrim(coalesce(p_body, ''));
  lid uuid;
begin
  perform app.require_active_staff(
    p_organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[],
    false
  );
  select * into matter from public.matters where id = p_matter_id and organization_id = p_organization_id;
  if matter.id is null or app.message_staff_reads_matter(matter.id, matter.organization_id) is distinct from true then
    raise exception 'letter denied' using errcode = '42501';
  end if;
  if app.sample_mode_blocks_real(p_organization_id, matter.is_sample) then
    raise exception 'this firm is in sample mode; only sample matters accept new work' using errcode = '42501';
  end if;
  if p_letter_type is null or p_letter_type not in ('cover_letter', 'explanation', 'other') then
    raise exception 'choose a letter type' using errcode = '22023';
  end if;
  if length(title_text) not between 1 and 200 or length(body_text) not between 1 and 12000 then
    raise exception 'a letter needs a title and 1 to 12000 characters' using errcode = '22023';
  end if;
  insert into public.matter_letters (organization_id, matter_id, letter_type, title, origin, is_sample, created_by)
  values (p_organization_id, matter.id, p_letter_type, title_text, 'staff', matter.is_sample, actor)
  returning id into lid;
  insert into public.matter_letter_versions (organization_id, letter_id, matter_id, version_number, title, body, origin, created_by)
  values (p_organization_id, lid, matter.id, 1, title_text, body_text, 'staff', actor);
  perform app.record_audit_event(
    p_organization_id, 'letter.created', 'matter_letters', lid, 'success',
    jsonb_build_object('matter_id', matter.id, 'letter_type', p_letter_type, 'origin', 'staff')
  );
  return lid;
end;
$$;
revoke all on function public.create_matter_letter(uuid, uuid, text, text, text) from public, anon;
grant execute on function public.create_matter_letter(uuid, uuid, text, text, text) to authenticated, service_role;

-- A new version of a draft, written by a person. Citations whose marker is still in the text are
-- kept; the others are dropped. Anything the person adds is theirs and is reviewed before release.
create function public.revise_matter_letter(p_letter_id uuid, p_expected_version integer, p_title text, p_body text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  letter public.matter_letters%rowtype;
  previous public.matter_letter_versions%rowtype;
  title_text text := btrim(coalesce(p_title, ''));
  body_text text := btrim(coalesce(p_body, ''));
  next_number integer;
begin
  select * into letter from public.matter_letters where id = p_letter_id for update;
  if letter.id is null then
    raise exception 'letter denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    letter.organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[],
    false
  );
  if app.message_staff_reads_matter(letter.matter_id, letter.organization_id) is distinct from true then
    raise exception 'letter denied' using errcode = '42501';
  end if;
  if letter.status <> 'draft' then
    raise exception 'only a draft letter can be changed' using errcode = '22023';
  end if;
  if p_expected_version is distinct from letter.version then
    raise exception 'this letter changed since you opened it' using errcode = '40001';
  end if;
  if length(title_text) not between 1 and 200 or length(body_text) not between 1 and 12000 then
    raise exception 'a letter needs a title and 1 to 12000 characters' using errcode = '22023';
  end if;
  select * into previous from public.matter_letter_versions
  where letter_id = letter.id and version_number = letter.current_version;
  if previous.body = body_text and previous.title = title_text then
    raise exception 'nothing changed' using errcode = '22023';
  end if;
  next_number := letter.current_version + 1;
  insert into public.matter_letter_versions (
    organization_id, letter_id, matter_id, version_number, title, body, facts, official, left_out, origin, created_by
  ) values (
    letter.organization_id, letter.id, letter.matter_id, next_number, title_text, body_text,
    coalesce((select jsonb_agg(cited) from jsonb_array_elements(previous.facts) cited where position('[' || (cited ->> 'ref') || ']' in body_text) > 0), '[]'::jsonb),
    coalesce((select jsonb_agg(cited) from jsonb_array_elements(previous.official) cited where position('[' || (cited ->> 'ref') || ']' in body_text) > 0), '[]'::jsonb),
    previous.left_out,
    'staff',
    actor
  );
  update public.matter_letters
    set title = title_text, current_version = next_number, version = version + 1, updated_at = clock_timestamp()
    where id = letter.id;
  perform app.record_audit_event(
    letter.organization_id, 'letter.revised', 'matter_letters', letter.id, 'success',
    jsonb_build_object('matter_id', letter.matter_id, 'version_number', next_number)
  );
  return next_number;
end;
$$;
revoke all on function public.revise_matter_letter(uuid, integer, text, text) from public, anon;
grant execute on function public.revise_matter_letter(uuid, integer, text, text) to authenticated, service_role;

-- A licensed member approves the current version, with a fresh step-up. Their own last edit only
-- under the GOV self-approval rule (no other licensed member; a step-up after the edit).
create function public.approve_matter_letter(p_letter_id uuid, p_expected_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  letter public.matter_letters%rowtype;
  current_text public.matter_letter_versions%rowtype;
  approver uuid;
  self_approval boolean;
begin
  select * into letter from public.matter_letters where id = p_letter_id for update;
  if letter.id is null then
    raise exception 'letter denied' using errcode = '42501';
  end if;
  perform app.require_licensed_staff(letter.organization_id, true);
  if app.message_staff_reads_matter(letter.matter_id, letter.organization_id) is distinct from true then
    raise exception 'letter denied' using errcode = '42501';
  end if;
  if letter.status <> 'draft' then
    raise exception 'only a draft letter can be approved' using errcode = '22023';
  end if;
  if p_expected_version is distinct from letter.version then
    raise exception 'this letter changed since you opened it' using errcode = '40001';
  end if;
  select * into current_text from public.matter_letter_versions
  where letter_id = letter.id and version_number = letter.current_version;
  if position('[needs a sourced rule]' in lower(current_text.body)) > 0 or position('[needs a consultant]' in lower(current_text.body)) > 0 then
    raise exception 'replace the [needs a sourced rule] placeholder before approving' using errcode = '22023';
  end if;
  self_approval := app.gov_check_self_approval(letter.organization_id, current_text.created_by, current_text.created_at);
  select mem.id into approver
  from public.memberships mem
  where mem.organization_id = letter.organization_id and mem.user_id = (select auth.uid()) and mem.status = 'active'
    and app.membership_is_licensed(mem.id)
  order by mem.created_at
  limit 1;
  update public.matter_letters
    set status = 'approved',
        approved_version = letter.current_version,
        approved_by_membership_id = approver,
        approved_at = clock_timestamp(),
        approved_self = self_approval,
        version = version + 1,
        updated_at = clock_timestamp()
    where id = letter.id;
  perform app.record_audit_event(
    letter.organization_id, case when self_approval then 'letter.approved_self' else 'letter.approved' end, 'matter_letters', letter.id, 'success',
    jsonb_build_object(
      'matter_id', letter.matter_id,
      'version_number', letter.current_version,
      'origin', letter.origin,
      'facts', jsonb_array_length(current_text.facts),
      'official_sources', jsonb_array_length(current_text.official)
    )
  );
  return jsonb_build_object('letter_id', letter.id, 'approved_version', letter.current_version, 'self', self_approval);
end;
$$;
revoke all on function public.approve_matter_letter(uuid, integer) from public, anon;
grant execute on function public.approve_matter_letter(uuid, integer) to authenticated, service_role;

create function public.discard_matter_letter(p_letter_id uuid, p_expected_version integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  letter public.matter_letters%rowtype;
begin
  select * into letter from public.matter_letters where id = p_letter_id for update;
  if letter.id is null then
    raise exception 'letter denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    letter.organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[],
    false
  );
  if app.message_staff_reads_matter(letter.matter_id, letter.organization_id) is distinct from true then
    raise exception 'letter denied' using errcode = '42501';
  end if;
  if letter.status <> 'draft' then
    raise exception 'only a draft letter can be discarded' using errcode = '22023';
  end if;
  if p_expected_version is distinct from letter.version then
    raise exception 'this letter changed since you opened it' using errcode = '40001';
  end if;
  update public.matter_letters
    set status = 'discarded', discarded_by = (select auth.uid()), discarded_at = clock_timestamp(),
        version = version + 1, updated_at = clock_timestamp()
    where id = letter.id;
  perform app.record_audit_event(
    letter.organization_id, 'letter.discarded', 'matter_letters', letter.id, 'success',
    jsonb_build_object('matter_id', letter.matter_id, 'origin', letter.origin, 'version_number', letter.current_version)
  );
end;
$$;
revoke all on function public.discard_matter_letter(uuid, integer) from public, anon;
grant execute on function public.discard_matter_letter(uuid, integer) to authenticated, service_role;

-- The approved letter's final text: the approved version with its citation markers removed (the
-- citations stay on the record). Refused for anything not approved. Audited.
create function public.release_matter_letter(p_letter_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  letter public.matter_letters%rowtype;
  approved_text public.matter_letter_versions%rowtype;
  final_text text;
begin
  select * into letter from public.matter_letters where id = p_letter_id;
  if letter.id is null then
    raise exception 'letter denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    letter.organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[],
    false
  );
  if app.message_staff_reads_matter(letter.matter_id, letter.organization_id) is distinct from true then
    raise exception 'letter denied' using errcode = '42501';
  end if;
  if letter.status <> 'approved' then
    raise exception 'a licensed member must approve this letter before it is released' using errcode = '42501';
  end if;
  select * into approved_text from public.matter_letter_versions
  where letter_id = letter.id and version_number = letter.approved_version;
  final_text := btrim(regexp_replace(regexp_replace(approved_text.body, '[ \t]?\[[FS][0-9]{1,3}\]', '', 'g'), '[ \t]+\n', E'\n', 'g'));
  perform app.record_audit_event(
    letter.organization_id, 'letter.released', 'matter_letters', letter.id, 'success',
    jsonb_build_object('matter_id', letter.matter_id, 'version_number', letter.approved_version)
  );
  return jsonb_build_object('title', approved_text.title, 'body', final_text, 'version_number', letter.approved_version, 'approved_at', letter.approved_at);
end;
$$;
revoke all on function public.release_matter_letter(uuid) from public, anon;
grant execute on function public.release_matter_letter(uuid) to authenticated, service_role;
