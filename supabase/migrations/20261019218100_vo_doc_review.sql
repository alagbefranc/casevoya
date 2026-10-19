-- Vo document reading (PRD AI-01..AI-06, SRC-06, SRC-09; RULES.md). Additive only.
--
-- A staff member presses "Read with Vo" on one clean document version. The Vo agent service
-- (services/vo-agent) downloads the file AS THAT PERSON (public.authorize_document_download with
-- their own token: the same role, scope, step-up and audit as "Open file"; no service key), sends
-- it to the model and saves what it read as PROPOSALS ONLY:
--   classification  a suggested purpose and category (and a more protective sensitivity)
--   field           a printed name, date (normalised to YYYY-MM-DD) or number; identity numbers
--                   are stored redacted ("[number removed]")
--   missing_field   something the document would normally show that Vo couldn't find
--   inconsistency   two things that don't match; never a fraud finding
--   deadline        a date printed on the document (an expiry date, a "valid until"); it must be
--                   one of the dates Vo read from the page, never calculated from a rule
--   needs_rule      where a step or date would need an immigration rule: "[needs a sourced rule]"
-- Nothing changes until a person accepts a proposal. Accepting a classification updates the
-- document (purpose; sensitivity only ever made more protective); accepting a deadline calls the
-- existing app.record_deadline (internal, tentative until confirmed); accepting a field or a flag
-- records that a person checked it. Every acceptance and rejection is audited.
--
-- Changes
--   vo_settings       four capability switches (document classification, OCR normalisation,
--                     missing-field detection, inconsistency flags). On by default once the owner
--                     turns Vo on; the per-category read switches (all off by default, medical and
--                     criminal included) still decide which documents Vo may read at all.
--   vo_runs           version_id (the document version a document_review run read: its source);
--                     the thread/kind check now allows document_review without a conversation;
--                     two more failures: refused (a switch is off) and unsupported_file.
--   vo_doc_drafts     one Vo reading of one version (kind document_review), its summary and
--                     source, and its review status (draft, reviewed, discarded).
--   vo_doc_proposals  the proposals, each accepted (possibly edited), rejected or still proposed.
--
-- Functions (security definer, search_path = '')
--   app.vo_document_category       the document kind for the per-category switches, from the
--                                   sensitivity, then the stated purpose (as the service does).
--   public.set_vo_settings         REDEFINED from 20261019207100: the same, plus the four new keys.
--   public.begin_vo_document_review staff with MFA and a fresh second factor who can read the
--                                   version and its matter; Vo on, a document capability on, the
--                                   document's category switched on, sample mode, rate limits
--                                   (shared with every Vo run). Audited vo.run_started.
--   public.finish_vo_document_review the same person within 10 minutes: drafted (proposals that
--                                   respect the switches; deadlines grounded in a printed date),
--                                   abstained or failed. Audited vo.run_finished.
--   public.accept_vo_doc_proposal  a person accepts one proposal, optionally edited. Audited.
--   public.reject_vo_doc_proposal  Audited vo.proposal_rejected.
--   public.discard_vo_doc_draft    rejects the whole reading. Audited vo.draft_discarded.

-- ---------------------------------------------------------------------------
-- vo_settings: the document capabilities
-- ---------------------------------------------------------------------------

alter table public.vo_settings
  add column doc_classification boolean not null default true,
  add column ocr_normalisation boolean not null default true,
  add column missing_fields boolean not null default true,
  add column inconsistency_flags boolean not null default true;
comment on column public.vo_settings.doc_classification is 'Vo may suggest a document''s purpose and category (AI-01).';
comment on column public.vo_settings.ocr_normalisation is 'Vo may read names, dates and numbers from a document and propose deadlines from printed dates (AI-01).';
comment on column public.vo_settings.missing_fields is 'Vo may flag what a document would normally show but doesn''t (AI-01).';
comment on column public.vo_settings.inconsistency_flags is 'Vo may flag things that don''t match. Never a fraud finding (AI-01).';

-- ---------------------------------------------------------------------------
-- vo_runs: the document version a reading used, and its checks
-- ---------------------------------------------------------------------------

alter table public.vo_runs add column version_id uuid;
comment on column public.vo_runs.version_id is 'document_review runs: the document version Vo read (the run''s source, AI-02).';
alter table public.vo_runs
  add constraint vo_runs_version_fk foreign key (version_id, organization_id) references public.document_versions (id, organization_id);
create index vo_runs_version_org_idx on public.vo_runs (version_id, organization_id);

-- The two checks below were unnamed in 20261019207100; they are replaced by named ones that also
-- allow a document reading (no conversation) and its two new failures.
do $constraints$
declare
  c record;
begin
  for c in
    select con.conname
    from pg_catalog.pg_constraint con
    where con.conrelid = 'public.vo_runs'::regclass
      and con.contype = 'c'
      and (
        pg_catalog.pg_get_constraintdef(con.oid) like '%thread_id IS NULL%'
        or pg_catalog.pg_get_constraintdef(con.oid) like '%nothing_to_draft%'
      )
  loop
    execute format('alter table public.vo_runs drop constraint %I', c.conname);
  end loop;
end
$constraints$;

alter table public.vo_runs
  add constraint vo_runs_thread_kind_check check ((kind in ('ask', 'document_review')) = (thread_id is null)),
  add constraint vo_runs_version_kind_check check ((kind = 'document_review') = (version_id is not null)),
  add constraint vo_runs_failure_check check (
    failure is null or failure in ('unavailable', 'failed', 'empty', 'nothing_to_draft', 'expired', 'refused', 'unsupported_file')
  );

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.vo_doc_drafts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  run_id uuid not null unique,
  kind public.vo_draft_kind not null default 'document_review' check (kind = 'document_review'),
  matter_id uuid not null,
  document_id uuid not null,
  version_id uuid not null,
  title text not null check (length(btrim(title)) between 1 and 200),
  body text not null check (length(btrim(body)) between 1 and 2000),
  sources jsonb not null check (
    jsonb_typeof(sources) = 'array'
    and jsonb_array_length(sources) between 1 and 5
    and pg_column_size(sources) <= 4000
  ),
  model text not null check (model ~ '^[a-z0-9@][a-z0-9@._/-]{2,119}$'),
  prompt_version text not null check (prompt_version ~ '^[a-z0-9._-]{1,40}$'),
  needs_rule boolean not null default false,
  status public.vo_draft_status not null default 'draft' check (status in ('draft', 'reviewed', 'discarded')),
  reviewed_by uuid references auth.users (id),
  reviewed_at timestamptz,
  is_sample boolean not null default false,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  check ((status = 'draft') = (reviewed_at is null)),
  check ((status = 'draft') = (reviewed_by is null)),
  foreign key (run_id, organization_id) references public.vo_runs (id, organization_id),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id),
  foreign key (document_id, organization_id) references public.documents (id, organization_id),
  foreign key (version_id, organization_id) references public.document_versions (id, organization_id)
);
comment on table public.vo_doc_drafts is
  'Vo''s reading of one document version (draft kind document_review): a summary, its source (the version) and its review. Proposals are in vo_doc_proposals. Protected like the document and the matter.';
create index vo_doc_drafts_org_status_idx on public.vo_doc_drafts (organization_id, status, created_at desc);
create index vo_doc_drafts_run_org_idx on public.vo_doc_drafts (run_id, organization_id);
create index vo_doc_drafts_matter_org_idx on public.vo_doc_drafts (matter_id, organization_id);
create index vo_doc_drafts_document_org_idx on public.vo_doc_drafts (document_id, organization_id);
create index vo_doc_drafts_version_org_idx on public.vo_doc_drafts (version_id, organization_id);
create index vo_doc_drafts_reviewed_by_idx on public.vo_doc_drafts (reviewed_by);
create index vo_doc_drafts_created_by_idx on public.vo_doc_drafts (created_by);

create table public.vo_doc_proposals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  draft_id uuid not null,
  position smallint not null check (position between 0 and 59),
  kind public.vo_proposal_kind not null,
  label text not null check (length(btrim(label)) between 1 and 120),
  value text check (value is null or length(value) <= 300),
  detail text check (detail is null or length(detail) <= 500),
  page smallint check (page is null or page between 1 and 2000),
  confidence smallint check (confidence is null or confidence between 0 and 100),
  category text check (category is null or category in ('identity', 'relationship', 'financial', 'medical', 'criminal', 'narrative', 'other')),
  sensitivity public.document_sensitivity,
  due_on date,
  status public.vo_proposal_status not null default 'proposed',
  accepted_value text check (accepted_value is null or length(accepted_value) <= 300),
  accepted_due_on date,
  edited boolean,
  deadline_id uuid,
  reviewed_by uuid references auth.users (id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (draft_id, position),
  check ((status = 'proposed') = (reviewed_at is null)),
  check ((status = 'proposed') = (reviewed_by is null)),
  check ((status = 'accepted') = (edited is not null)),
  check (kind <> 'deadline' or due_on is not null),
  check (kind <> 'classification' or category is not null),
  check (deadline_id is null or (kind = 'deadline' and status = 'accepted')),
  foreign key (draft_id, organization_id) references public.vo_doc_drafts (id, organization_id),
  foreign key (deadline_id, organization_id) references public.deadlines (id, organization_id)
);
comment on table public.vo_doc_proposals is
  'One thing Vo read or noticed on a document. Changes nothing until a person accepts it (AI-03). Identity numbers are stored redacted.';
create index vo_doc_proposals_draft_org_idx on public.vo_doc_proposals (draft_id, organization_id);
create index vo_doc_proposals_org_idx on public.vo_doc_proposals (organization_id);
create index vo_doc_proposals_deadline_org_idx on public.vo_doc_proposals (deadline_id, organization_id);
create index vo_doc_proposals_reviewed_by_idx on public.vo_doc_proposals (reviewed_by);

-- ---------------------------------------------------------------------------
-- Privileges and read rules
-- ---------------------------------------------------------------------------

alter table public.vo_doc_drafts enable row level security;
alter table public.vo_doc_drafts force row level security;
alter table public.vo_doc_proposals enable row level security;
alter table public.vo_doc_proposals force row level security;

revoke all on public.vo_doc_drafts from public, anon, authenticated;
revoke all on public.vo_doc_proposals from public, anon, authenticated;
grant select on public.vo_doc_drafts to authenticated;
grant select on public.vo_doc_proposals to authenticated;
grant select, insert, update on public.vo_doc_drafts to service_role;
grant select, insert, update on public.vo_doc_proposals to service_role;

-- Staff who may read the matter's Vo work AND the document version itself.
create policy vo_doc_drafts_select on public.vo_doc_drafts
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and app.message_staff_reads_matter(matter_id, organization_id)
    and app.can_read_document_version(version_id)
  );
create policy vo_doc_proposals_select on public.vo_doc_proposals
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and exists (
      select 1 from public.vo_doc_drafts draft
      where draft.id = vo_doc_proposals.draft_id
        and draft.organization_id = vo_doc_proposals.organization_id
    )
  );

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- The document kind for the per-category Vo switches (AI-06). A protected sensitivity decides
-- first; otherwise the stated purpose, with the same words as services/vo-agent documentKind.
create function app.vo_document_category(p_purpose text, p_sensitivity public.document_sensitivity)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_sensitivity = 'medical' then 'medical'
    when p_sensitivity = 'criminal' then 'criminal'
    when p_sensitivity = 'narrative' then 'narrative'
    when lower(coalesce(p_purpose, '')) ~ '(medical|health|immigration medical|imm)' then 'medical'
    when lower(coalesce(p_purpose, '')) ~ '(police|criminal|court|conviction)' then 'criminal'
    when lower(coalesce(p_purpose, '')) ~ '(passport|birth|identity|id card|national id|travel document)' then 'identity'
    when lower(coalesce(p_purpose, '')) ~ '(bank|income|tax|pay ?stub|employment letter|funds|financial|noa|t4)' then 'financial'
    when lower(coalesce(p_purpose, '')) ~ '(marriage|relationship|photo|wedding|partner|spouse|common-law)' then 'relationship'
    when lower(coalesce(p_purpose, '')) ~ '(letter|statement|narrative|explanation|essay)' then 'narrative'
    else 'identity'
  end;
$$;
revoke all on function app.vo_document_category(text, public.document_sensitivity) from public;
grant execute on function app.vo_document_category(text, public.document_sensitivity) to authenticated, service_role;

-- Whether the firm lets Vo read a category (no settings row: every category is off).
create function app.vo_category_allowed(p_org uuid, p_category text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case p_category
      when 'identity' then s.read_identity
      when 'relationship' then s.read_relationship
      when 'financial' then s.read_financial
      when 'medical' then s.read_medical
      when 'criminal' then s.read_criminal
      when 'narrative' then s.read_narratives
      else false
    end
    from public.vo_settings s
    where s.organization_id = p_org
  ), false);
$$;
revoke all on function app.vo_category_allowed(uuid, text) from public;
grant execute on function app.vo_category_allowed(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- set_vo_settings (redefined from 20261019207100: the four document capabilities added)
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
    'doc_classification', 'ocr_normalisation', 'missing_fields', 'inconsistency_flags'
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
-- begin_vo_document_review
-- ---------------------------------------------------------------------------

create function public.begin_vo_document_review(p_organization_id uuid, p_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  version public.document_versions%rowtype;
  doc public.documents%rowtype;
  matter public.matters%rowtype;
  settings public.vo_settings%rowtype;
  category text;
  waiting uuid;
  last_hour integer;
  last_day integer;
  firm_day integer;
  rid uuid;
begin
  -- Reading the file is a download: staff with MFA and a fresh second factor, as for Open file.
  perform app.require_active_staff(
    p_organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[],
    true
  );
  select * into version from public.document_versions where id = p_version_id and organization_id = p_organization_id;
  if version.id is null or app.can_read_document_version(version.id) is distinct from true then
    raise exception 'vo denied' using errcode = '42501';
  end if;
  select * into doc from public.documents where id = version.document_id and organization_id = p_organization_id;
  -- The matter the reading belongs to: one this document is linked to that the person may read.
  select m.* into matter
  from public.document_matter_refs ref
  join public.matters m on m.id = ref.matter_id and m.organization_id = ref.organization_id
  where ref.document_id = doc.id
    and ref.organization_id = p_organization_id
    and ref.removed_at is null
    and app.message_staff_reads_matter(m.id, m.organization_id)
  order by ref.created_at asc
  limit 1;
  if doc.id is null or matter.id is null then
    raise exception 'vo denied' using errcode = '42501';
  end if;
  if version.upload_state is distinct from 'clean' then
    return jsonb_build_object('ok', false, 'error', 'not_clean');
  end if;
  if app.vo_enabled(p_organization_id) is distinct from true then
    return jsonb_build_object('ok', false, 'error', 'off');
  end if;
  select * into settings from public.vo_settings where organization_id = p_organization_id;
  if settings.organization_id is not null
     and not (settings.doc_classification or settings.ocr_normalisation or settings.missing_fields or settings.inconsistency_flags) then
    return jsonb_build_object('ok', false, 'error', 'capability_off');
  end if;
  category := app.vo_document_category(doc.purpose, doc.sensitivity);
  if app.vo_category_allowed(p_organization_id, category) is distinct from true then
    return jsonb_build_object('ok', false, 'error', 'category_off', 'category', category);
  end if;
  if app.sample_mode_blocks_real(p_organization_id, matter.is_sample) then
    return jsonb_build_object('ok', false, 'error', 'sample_only');
  end if;
  select d.id into waiting from public.vo_doc_drafts d
  where d.version_id = version.id and d.organization_id = p_organization_id and d.status = 'draft'
  limit 1;
  if waiting is not null then
    return jsonb_build_object('ok', false, 'error', 'already_read', 'draft_id', waiting, 'matter_id', matter.id);
  end if;

  -- The same per-firm serialization and limits as every Vo run.
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

  insert into public.vo_runs (organization_id, user_id, kind, matter_id, thread_id, version_id, is_sample)
  values (p_organization_id, actor, 'document_review', matter.id, null, version.id, matter.is_sample)
  returning id into rid;
  perform app.record_audit_event(
    p_organization_id, 'vo.run_started', 'vo_runs', rid, 'success',
    jsonb_build_object('kind', 'document_review', 'version_id', version.id, 'category', category)
  );
  return jsonb_build_object('ok', true, 'run_id', rid, 'matter_id', matter.id, 'category', category);
end;
$$;
revoke all on function public.begin_vo_document_review(uuid, uuid) from public, anon;
grant execute on function public.begin_vo_document_review(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- finish_vo_document_review
-- ---------------------------------------------------------------------------

create function public.finish_vo_document_review(
  p_run_id uuid,
  p_result public.vo_run_result,
  p_title text default null,
  p_body text default null,
  p_proposals jsonb default null,
  p_model text default null,
  p_prompt_version text default null,
  p_needs_rule boolean default false,
  p_latency_ms integer default null,
  p_failure text default null,
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
  version public.document_versions%rowtype;
  doc public.documents%rowtype;
  settings public.vo_settings%rowtype;
  item jsonb;
  item_kind text;
  item_category text;
  item_sensitivity text;
  item_due date;
  item_page integer;
  item_confidence integer;
  pos integer := 0;
  dates text[] := '{}'::text[];
  blocked boolean := false;
  did uuid;
  label text;
begin
  select * into run from public.vo_runs where id = p_run_id for update;
  if run.id is null or actor is null or run.user_id is distinct from actor
     or run.kind is distinct from 'document_review'
     or app.in_active_org(run.organization_id) is distinct from true
     or app.staff_mfa_satisfied() is distinct from true then
    raise exception 'vo denied' using errcode = '42501';
  end if;
  if run.result <> 'running' then
    raise exception 'this Vo run is already finished' using errcode = '22023';
  end if;
  if p_result is null or p_result not in ('drafted', 'abstained', 'failed') then
    raise exception 'say how the run ended' using errcode = '22023';
  end if;
  if p_model is not null and p_model !~ '^[a-z0-9@][a-z0-9@._/-]{2,119}$' then
    raise exception 'unknown model' using errcode = '22023';
  end if;
  if p_prompt_version is not null and p_prompt_version !~ '^[a-z0-9._-]{1,40}$' then
    raise exception 'unknown prompt version' using errcode = '22023';
  end if;
  if p_latency_ms is not null and p_latency_ms not between 0 and 600000 then
    raise exception 'latency out of range' using errcode = '22023';
  end if;
  if p_tools is not null and (
    cardinality(p_tools) > 60
    or exists (select 1 from unnest(p_tools) t where t !~ '^[A-Za-z0-9_]{1,80}$')
  ) then
    raise exception 'tool names out of range' using errcode = '22023';
  end if;
  if coalesce(p_input_tokens, 0) < 0 or coalesce(p_output_tokens, 0) < 0 or coalesce(p_cost_usd, 0) < 0 or coalesce(p_cost_usd, 0) > 1000 then
    raise exception 'usage out of range' using errcode = '22023';
  end if;
  if p_failure is not null and (
    p_result <> 'failed'
    or p_failure not in ('unavailable', 'failed', 'empty', 'nothing_to_draft', 'refused', 'unsupported_file')
  ) then
    raise exception 'unknown failure' using errcode = '22023';
  end if;

  if run.created_at < statement_timestamp() - interval '10 minutes' then
    update public.vo_runs
      set result = 'failed', failure = 'expired', finished_at = clock_timestamp()
      where id = run.id;
    return null;
  end if;

  if p_result = 'drafted' then
    select * into version from public.document_versions where id = run.version_id and organization_id = run.organization_id;
    select * into doc from public.documents where id = version.document_id and organization_id = run.organization_id;
    if app.message_staff_reads_matter(run.matter_id, run.organization_id) is distinct from true
       or app.can_read_document_version(run.version_id) is distinct from true
       or doc.id is null then
      raise exception 'vo denied' using errcode = '42501';
    end if;
    if p_model is null or p_prompt_version is null then
      raise exception 'a draft records its model and prompt version' using errcode = '22023';
    end if;
    if p_title is null or length(btrim(p_title)) not between 1 and 200
       or p_body is null or length(btrim(p_body)) not between 1 and 2000 then
      raise exception 'a reading needs a title and a summary of 1 to 2000 characters' using errcode = '22023';
    end if;
    if p_proposals is null or jsonb_typeof(p_proposals) <> 'array' or jsonb_array_length(p_proposals) not between 1 and 60 then
      raise exception 'a reading has 1 to 60 proposals' using errcode = '22023';
    end if;
    -- The switches as they are now (they may have changed since the run began).
    select * into settings from public.vo_settings where organization_id = run.organization_id;
    if app.vo_category_allowed(run.organization_id, app.vo_document_category(doc.purpose, doc.sensitivity)) is distinct from true then
      raise exception 'the firm doesn''t let Vo read this kind of document' using errcode = '42501';
    end if;

    -- First pass: shapes, capabilities, and the dates printed on the document.
    for item in select value from jsonb_array_elements(p_proposals)
    loop
      if jsonb_typeof(item) <> 'object' then
        raise exception 'a proposal is an object' using errcode = '22023';
      end if;
      item_kind := item ->> 'kind';
      if item_kind is null or item_kind not in ('classification', 'field', 'missing_field', 'inconsistency', 'deadline', 'needs_rule') then
        raise exception 'unknown proposal kind' using errcode = '22023';
      end if;
      if (item_kind = 'classification' and settings.doc_classification is not true)
         or (item_kind in ('field', 'deadline') and settings.ocr_normalisation is not true)
         or (item_kind = 'missing_field' and settings.missing_fields is not true)
         or (item_kind = 'inconsistency' and settings.inconsistency_flags is not true) then
        raise exception 'a proposal is outside the firm''s Vo switches' using errcode = '42501';
      end if;
      item_category := item ->> 'category';
      if item_kind = 'classification' then
        if item_category is null or item_category not in ('identity', 'relationship', 'financial', 'medical', 'criminal', 'narrative', 'other') then
          raise exception 'a classification needs a category' using errcode = '22023';
        end if;
        -- Vo read a document that looks like a kind the firm keeps from Vo: only the suggestion stays.
        if item_category <> 'other' and app.vo_category_allowed(run.organization_id, item_category) is distinct from true then
          blocked := true;
        end if;
      end if;
      if item_kind = 'field' and item ? 'value' and coalesce(item ->> 'value', '') ~ '^\d{4}-\d{2}-\d{2}$' then
        dates := dates || (item ->> 'value');
      end if;
    end loop;

    for item in select value from jsonb_array_elements(p_proposals)
    loop
      item_kind := item ->> 'kind';
      if blocked and item_kind <> 'classification' then
        raise exception 'a proposal is outside the firm''s Vo switches' using errcode = '42501';
      end if;
      label := btrim(coalesce(item ->> 'label', ''));
      if length(label) not between 1 and 120
         or length(coalesce(item ->> 'value', '')) > 300
         or length(coalesce(item ->> 'detail', '')) > 500 then
        raise exception 'a proposal needs a short label' using errcode = '22023';
      end if;
      item_page := null;
      if item ? 'page' and jsonb_typeof(item -> 'page') = 'number' then
        item_page := (item ->> 'page')::numeric::integer;
        if item_page not between 1 and 2000 then
          raise exception 'page out of range' using errcode = '22023';
        end if;
      end if;
      item_confidence := null;
      if item ? 'confidence' and jsonb_typeof(item -> 'confidence') = 'number' then
        item_confidence := (item ->> 'confidence')::numeric::integer;
        if item_confidence not between 0 and 100 then
          raise exception 'confidence out of range' using errcode = '22023';
        end if;
      end if;
      item_sensitivity := item ->> 'sensitivity';
      if item_sensitivity is not null and item_sensitivity not in ('ordinary', 'narrative', 'medical', 'criminal') then
        raise exception 'unknown sensitivity' using errcode = '22023';
      end if;
      item_due := null;
      if item_kind = 'deadline' then
        if coalesce(item ->> 'due_on', '') !~ '^\d{4}-\d{2}-\d{2}$' then
          raise exception 'a deadline needs a date' using errcode = '22023';
        end if;
        item_due := (item ->> 'due_on')::date;
        -- Grounded: a deadline is a date Vo read on the page, never one it calculated.
        if not ((item ->> 'due_on') = any (dates)) or extract(year from item_due) not between 1900 and 2200 then
          raise exception 'a proposed deadline must be a date printed on the document' using errcode = '22023';
        end if;
      end if;
      pos := pos + 1;
    end loop;

    insert into public.vo_doc_drafts (
      organization_id, run_id, matter_id, document_id, version_id, title, body, sources, model, prompt_version,
      needs_rule, is_sample, created_by
    ) values (
      run.organization_id, run.id, run.matter_id, doc.id, version.id, btrim(p_title), btrim(p_body),
      jsonb_build_array(jsonb_build_object(
        'kind', 'document_version',
        'id', version.id,
        'label', left(btrim(doc.purpose), 100) || ', version ' || version.version_number
      )),
      p_model, p_prompt_version, coalesce(p_needs_rule, false), run.is_sample, actor
    )
    returning id into did;

    pos := 0;
    for item in select value from jsonb_array_elements(p_proposals)
    loop
      insert into public.vo_doc_proposals (
        organization_id, draft_id, position, kind, label, value, detail, page, confidence, category, sensitivity, due_on
      ) values (
        run.organization_id, did, pos, (item ->> 'kind')::public.vo_proposal_kind, btrim(item ->> 'label'),
        nullif(btrim(coalesce(item ->> 'value', '')), ''),
        nullif(btrim(coalesce(item ->> 'detail', '')), ''),
        case when jsonb_typeof(item -> 'page') = 'number' then (item ->> 'page')::numeric::integer end,
        case when jsonb_typeof(item -> 'confidence') = 'number' then (item ->> 'confidence')::numeric::integer end,
        case when item ->> 'kind' = 'classification' then item ->> 'category' end,
        (item ->> 'sensitivity')::public.document_sensitivity,
        case when item ->> 'kind' = 'deadline' then (item ->> 'due_on')::date end
      );
      pos := pos + 1;
    end loop;
  end if;

  update public.vo_runs
    set result = p_result,
        model = p_model,
        prompt_version = p_prompt_version,
        source_count = case when p_result = 'drafted' then 1 else null end,
        latency_ms = p_latency_ms,
        tools_called = coalesce(p_tools, '{}'::text[]),
        input_tokens = p_input_tokens,
        output_tokens = p_output_tokens,
        cost_usd = p_cost_usd,
        failure = case when p_result = 'failed' then coalesce(p_failure, 'failed') else null end,
        finished_at = clock_timestamp()
    where id = run.id;

  perform app.record_audit_event(
    run.organization_id, 'vo.run_finished', 'vo_runs', run.id, 'success',
    jsonb_build_object(
      'kind', run.kind,
      'result', p_result,
      'model', p_model,
      'prompt_version', p_prompt_version,
      'source_count', case when p_result = 'drafted' then 1 else null end,
      'version_id', run.version_id,
      'needs_rule', case when p_result = 'drafted' then coalesce(p_needs_rule, false) else null end,
      'draft_id', did,
      'proposal_count', case when p_result = 'drafted' then pos else null end,
      'tools', coalesce(p_tools, '{}'::text[])
    )
  );
  return did;
end;
$$;
revoke all on function public.finish_vo_document_review(uuid, public.vo_run_result, text, text, jsonb, text, text, boolean, integer, text, text[], integer, integer, numeric) from public, anon;
grant execute on function public.finish_vo_document_review(uuid, public.vo_run_result, text, text, jsonb, text, text, boolean, integer, text, text[], integer, integer, numeric)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Review: accept, reject, discard
-- ---------------------------------------------------------------------------

-- Locks a proposal and its reading for review by the signed-in staff member.
create function app.vo_doc_review_target(p_proposal_id uuid)
returns public.vo_doc_proposals
language plpgsql
security definer
set search_path = ''
as $$
declare
  prop public.vo_doc_proposals%rowtype;
  draft public.vo_doc_drafts%rowtype;
begin
  select * into prop from public.vo_doc_proposals where id = p_proposal_id for update;
  select * into draft from public.vo_doc_drafts where id = prop.draft_id and organization_id = prop.organization_id for update;
  if prop.id is null or draft.id is null or (select auth.uid()) is null
     or app.message_staff_reads_matter(draft.matter_id, draft.organization_id) is distinct from true
     or app.can_read_document_version(draft.version_id) is distinct from true then
    raise exception 'vo denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    draft.organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[],
    false
  );
  if draft.status <> 'draft' or prop.status <> 'proposed' then
    raise exception 'this proposal was already reviewed' using errcode = '22023';
  end if;
  return prop;
end;
$$;
revoke all on function app.vo_doc_review_target(uuid) from public;

-- When nothing is left to decide, the reading is reviewed.
create function app.vo_doc_close_if_done(p_draft_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  status_now text;
begin
  if not exists (select 1 from public.vo_doc_proposals p where p.draft_id = p_draft_id and p.status = 'proposed') then
    update public.vo_doc_drafts
      set status = 'reviewed', reviewed_by = (select auth.uid()), reviewed_at = clock_timestamp(), updated_at = clock_timestamp()
      where id = p_draft_id and status = 'draft';
  end if;
  select d.status::text into status_now from public.vo_doc_drafts d where d.id = p_draft_id;
  return status_now;
end;
$$;
revoke all on function app.vo_doc_close_if_done(uuid) from public;

create function public.accept_vo_doc_proposal(p_proposal_id uuid, p_value text default null, p_due_on date default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  prop public.vo_doc_proposals%rowtype;
  draft public.vo_doc_drafts%rowtype;
  doc public.documents%rowtype;
  version public.document_versions%rowtype;
  value_in text := nullif(btrim(coalesce(p_value, '')), '');
  final_value text;
  final_due date;
  was_edited boolean;
  new_sensitivity public.document_sensitivity;
  zone text;
  deadline uuid;
  draft_status text;
begin
  prop := app.vo_doc_review_target(p_proposal_id);
  select * into draft from public.vo_doc_drafts where id = prop.draft_id;
  select * into doc from public.documents where id = draft.document_id and organization_id = draft.organization_id;
  select * into version from public.document_versions where id = draft.version_id and organization_id = draft.organization_id;
  if value_in is not null and length(value_in) > 300 then
    raise exception 'keep the value under 300 characters' using errcode = '22023';
  end if;
  final_value := coalesce(value_in, case when prop.kind = 'deadline' then prop.label else prop.value end, prop.label);
  final_due := coalesce(p_due_on, prop.due_on);
  was_edited := (value_in is not null and value_in is distinct from coalesce(case when prop.kind = 'deadline' then prop.label else prop.value end, prop.label))
    or (p_due_on is not null and p_due_on is distinct from prop.due_on);
  if position('[needs a sourced rule]' in lower(final_value)) > 0 or position('[needs a consultant]' in lower(final_value)) > 0 then
    raise exception 'replace the [needs a sourced rule] placeholder before accepting' using errcode = '22023';
  end if;

  if prop.kind = 'classification' then
    -- Changing a document's purpose or protection is for the people who manage the file.
    perform app.require_active_staff(
      draft.organization_id,
      array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[],
      false
    );
    if length(final_value) not between 1 and 200 then
      raise exception 'say what this file is for' using errcode = '22023';
    end if;
    -- Sensitivity only ever becomes more protective; it is never lowered from here.
    new_sensitivity := case
      when doc.sensitivity = 'ordinary' and prop.sensitivity is not null and prop.sensitivity <> 'ordinary' then prop.sensitivity
      else doc.sensitivity
    end;
    perform app.open_document_write(doc.id);
    update public.documents
      set purpose = final_value,
          sensitivity = new_sensitivity
      where id = doc.id;
    perform app.close_document_write(doc.id);
    perform app.record_audit_event(
      draft.organization_id, 'document.reclassified', 'documents', doc.id, 'success',
      jsonb_build_object('via', 'vo_proposal', 'proposal_id', prop.id, 'sensitivity_before', doc.sensitivity, 'sensitivity_after', new_sensitivity)
    );
  elsif prop.kind = 'deadline' then
    if final_due is null or length(final_value) not between 1 and 200 then
      raise exception 'a deadline needs a label and a date' using errcode = '22023';
    end if;
    select coalesce(nullif(o.timezone, ''), 'America/Toronto') into zone from public.organizations o where o.id = draft.organization_id;
    -- The existing deadline function: its own checks (matter, role, sample mode) apply. An internal
    -- date, tentative until a licensed consultant confirms it; never a legal deadline from a rule.
    deadline := app.record_deadline(
      draft.matter_id, null, 'internal', final_value, null, null, final_due, null, zone, null, null, null,
      'A date printed on the document, read by Vo and accepted by a person. Not calculated from an immigration rule.',
      left(btrim(doc.purpose), 120) || ', version ' || version.version_number || coalesce(', page ' || prop.page, '')
    );
  end if;

  update public.vo_doc_proposals
    set status = 'accepted',
        accepted_value = case when prop.kind = 'deadline' then final_value else left(final_value, 300) end,
        accepted_due_on = case when prop.kind = 'deadline' then final_due end,
        edited = coalesce(was_edited, false),
        deadline_id = deadline,
        reviewed_by = (select auth.uid()),
        reviewed_at = clock_timestamp()
    where id = prop.id;
  draft_status := app.vo_doc_close_if_done(draft.id);
  perform app.record_audit_event(
    draft.organization_id, 'vo.proposal_accepted', 'vo_doc_proposals', prop.id, 'success',
    jsonb_build_object('kind', prop.kind, 'draft_id', draft.id, 'edited', coalesce(was_edited, false), 'deadline_id', deadline)
  );
  return jsonb_build_object('status', 'accepted', 'deadline_id', deadline, 'draft_status', draft_status);
end;
$$;
revoke all on function public.accept_vo_doc_proposal(uuid, text, date) from public, anon;
grant execute on function public.accept_vo_doc_proposal(uuid, text, date) to authenticated, service_role;

create function public.reject_vo_doc_proposal(p_proposal_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  prop public.vo_doc_proposals%rowtype;
  draft_status text;
begin
  prop := app.vo_doc_review_target(p_proposal_id);
  update public.vo_doc_proposals
    set status = 'rejected', reviewed_by = (select auth.uid()), reviewed_at = clock_timestamp()
    where id = prop.id;
  draft_status := app.vo_doc_close_if_done(prop.draft_id);
  perform app.record_audit_event(
    prop.organization_id, 'vo.proposal_rejected', 'vo_doc_proposals', prop.id, 'success',
    jsonb_build_object('kind', prop.kind, 'draft_id', prop.draft_id)
  );
  return jsonb_build_object('status', 'rejected', 'draft_status', draft_status);
end;
$$;
revoke all on function public.reject_vo_doc_proposal(uuid) from public, anon;
grant execute on function public.reject_vo_doc_proposal(uuid) to authenticated, service_role;

create function public.discard_vo_doc_draft(p_draft_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  draft public.vo_doc_drafts%rowtype;
begin
  select * into draft from public.vo_doc_drafts where id = p_draft_id for update;
  if draft.id is null or (select auth.uid()) is null
     or app.message_staff_reads_matter(draft.matter_id, draft.organization_id) is distinct from true
     or app.can_read_document_version(draft.version_id) is distinct from true then
    raise exception 'vo denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    draft.organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[],
    false
  );
  if draft.status <> 'draft' then
    raise exception 'this draft was already reviewed' using errcode = '22023';
  end if;
  update public.vo_doc_proposals
    set status = 'rejected', reviewed_by = (select auth.uid()), reviewed_at = clock_timestamp()
    where draft_id = draft.id and status = 'proposed';
  update public.vo_doc_drafts
    set status = 'discarded', reviewed_by = (select auth.uid()), reviewed_at = clock_timestamp(), updated_at = clock_timestamp()
    where id = draft.id;
  perform app.record_audit_event(
    draft.organization_id, 'vo.draft_discarded', 'vo_doc_drafts', draft.id, 'success',
    jsonb_build_object('kind', draft.kind, 'model', draft.model)
  );
end;
$$;
revoke all on function public.discard_vo_doc_draft(uuid) from public, anon;
grant execute on function public.discard_vo_doc_draft(uuid) to authenticated, service_role;
