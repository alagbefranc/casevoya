-- SRC-09 (#188): grounded Vo outputs. Additive only.
--
-- Vo drafts from the matter's own records and from approved official content, cites what it used,
-- or abstains. This migration makes the database the judge of what a Vo output may cite, keeps the
-- citations with every run, and requires a licensed member's review before an advice-like Vo
-- draft is sent to a client.
--
-- What a Vo output may cite (the run's "allowed set"), each checked here, never taken on trust:
--   matter, task, deadline, document_request, message  the run's own matter and conversation (as before);
--   document_version   a version of a document linked (and not removed) on the run's matter;
--   fact               an approved fact of the run's matter (app.matter_approved_facts: the latest,
--                      staff-reviewed intake answer), in a category the firm lets Vo use;
--   official           approved official content of the firm (app.vo_letter_official_items: IRCC
--                      fees, submission steps, renewal timings, follow-up steps a licensed member
--                      approved, and published rule versions with their source evidence) whose
--                      source is a deep page on a federal official host (canada.ca, *.canada.ca or
--                      *.gc.ca, including laws-lois.justice.gc.ca) on public.official_source_domains.
--                      A homepage or landing page is never valid evidence. Nothing else is official.
-- A citation outside that set refuses the whole save (the service drops them before it calls).
--
-- Changes
--   vo_runs.citations                   the run's checked citations, rebuilt here (kind, id, label;
--                                       for official content its URL, section, form number and
--                                       date modified, date checked, current-to date, page hash).
--                                       Ask Vo answers stay unstored; their citations are kept.
--   vo_drafts.licensed_review_required  an advice-like draft (it cites official content, or its
--                                       text reads as advice: fees, eligibility, admissibility,
--                                       requirements, processing times, the Act or Regulations,
--                                       a recommendation) needs a licensed member to send it.
--
-- Functions (security definer, search_path = '')
--   app.vo_citable_official_url(url)    a deep page on a federal official host.
--   app.vo_advice_like(text)            the advice-like test (mirrored in src/modules/vo/grounding.ts).
--   app.vo_letter_official_items        REDEFINED from 20261025240100_vo_letter_drafts.sql: the same
--                                       rows, limited to app.vo_citable_official_url sources (letters
--                                       and Ask Vo cite the same set).
--   app.vo_ask_run(run)                 the caller's own running Ask Vo run on a matter they can read.
--   public.vo_run_facts(run)            Ask Vo: the approved facts Vo may cite, and how many are hidden.
--   public.vo_run_official_content(run) Ask Vo: the approved official content Vo may cite, with its source.
--   public.finish_vo_run                REDEFINED from 20261019207100_vo_drafts.sql: also accepts
--                                       document_version, fact and official citations (checked as
--                                       above), stores the rebuilt citations on the run and draft,
--                                       and flags an advice-like draft for licensed review.
--   public.send_vo_draft                REDEFINED from 20261019207100_vo_drafts.sql: an advice-like
--                                       draft (as flagged, or as edited) is sent only by a licensed
--                                       member with a fresh step-up. Audited vo.draft_sent with
--                                       licensed_review.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

alter table public.vo_runs
  add column citations jsonb not null default '[]'::jsonb check (
    jsonb_typeof(citations) = 'array'
    and jsonb_array_length(citations) <= 40
    and pg_column_size(citations) <= 64000
  );
comment on column public.vo_runs.citations is
  'SRC-09: what the output cited, rebuilt by finish_vo_run from the database ([{kind, id, label, ...source}]). Never the answer text.';

alter table public.vo_drafts
  add column licensed_review_required boolean not null default false;
comment on column public.vo_drafts.licensed_review_required is
  'SRC-09: advice-like (cites official content or reads as advice). Only a licensed member with a fresh step-up can send it.';

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- A deep page on a federal official host on the allowlist. The site root and the IRCC, Justice
-- Laws and fee-list landing pages are not evidence of anything.
create function app.vo_citable_official_url(p_url text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_host text := app.federal_official_url(p_url);
  rest text;
  hostport text;
  page text;
begin
  if v_host is null then
    return false;
  end if;
  rest := substring(btrim(p_url) from 9);
  hostport := split_part(split_part(split_part(rest, '/', 1), '?', 1), '#', 1);
  page := substring(rest from length(hostport) + 1);
  page := lower(btrim(split_part(split_part(page, '#', 1), '?', 1), '/'));
  return page <> '' and page not in (
    'en', 'fr', 'eng', 'fra', 'english', 'francais',
    'index.html', 'index.htm', 'index.asp', 'default.asp',
    'en.html', 'fr.html', 'en/index.html', 'fr/index.html', 'eng/index.html', 'fra/index.html',
    'english/index.asp', 'francais/index.asp',
    'en/immigration-refugees-citizenship.html', 'fr/immigration-refugies-citoyennete.html',
    'eng/acts', 'fra/lois', 'eng/regulations', 'fra/reglements'
  );
end;
$$;
revoke all on function app.vo_citable_official_url(text) from public;
grant execute on function app.vo_citable_official_url(text) to authenticated, service_role;

-- Advice-like text: a money amount, a fee, eligibility or admissibility, a qualification, a
-- requirement, a processing time, the Act or Regulations, a recommendation, chances or a
-- guarantee (English and French). The same test is in src/modules/vo/grounding.ts for the page.
create function app.vo_advice_like(p_text text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_text, '') ~* (
    '((\$|\mcad\M|\musd\M)\s?[0-9]|[0-9]\s?(\$|\mcad\M|\mdollars?\M)'
    || '|\mfees?\M|\mfrais\M'
    || '|\m(in)?eligib|\m(in)?admissib|\méligib|\mqualif'
    || '|\mrequirements?\M|\mrequired\M|\mexigences?\M'
    || '|\mprocessing\s+times?\M|\mdélais?\s+de\s+traitement'
    || '|\mirpa\M|\mirpr\M|\mlipr\M|\mripr\M|\mregulations?\M|\mrèglements?\M'
    || '|\myou\s+should\M|\mwe\s+(recommend|advise)|\mi\s+(recommend|advise)|\mvous\s+devriez\M|\mnous\s+(recommandons|conseillons)'
    || '|\mchances?\M|\mguarantee|\mgarantie?s?\M)'
  );
$$;
revoke all on function app.vo_advice_like(text) from public;
grant execute on function app.vo_advice_like(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- app.vo_letter_official_items (redefined from 20261025240100_vo_letter_drafts.sql: the same
-- rows, kept only when the source is a deep page on a federal official host)
-- ---------------------------------------------------------------------------

create or replace function app.vo_letter_official_items(p_org uuid, p_matter_id uuid)
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
  select items.*
  from (
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
      and (rule.effective_from is null or rule.effective_from <= statement_timestamp())
  ) as items (
    kind, id, label, content, source_url, source_section, form_number, form_modified_on,
    checked_on, current_to, snapshot_sha256, attested_on, reviewed_at
  )
  where app.vo_citable_official_url(items.source_url);
$$;
revoke all on function app.vo_letter_official_items(uuid, uuid) from public;

-- ---------------------------------------------------------------------------
-- Ask Vo: what it may cite, read by the run's own person while it runs
-- ---------------------------------------------------------------------------

create function app.vo_ask_run(p_run_id uuid)
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
     or run.kind <> 'ask' or run.result <> 'running' or run.matter_id is null
     or app.in_active_org(run.organization_id) is distinct from true
     or app.staff_mfa_satisfied() is distinct from true
     or app.message_staff_reads_matter(run.matter_id, run.organization_id) is distinct from true then
    raise exception 'vo denied' using errcode = '42501';
  end if;
  return run;
end;
$$;
revoke all on function app.vo_ask_run(uuid) from public;

-- The approved facts of the run's matter that the firm lets Vo use, and how many are hidden.
create function public.vo_run_facts(p_run_id uuid)
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
  run := app.vo_ask_run(p_run_id);
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
revoke all on function public.vo_run_facts(uuid) from public, anon;
grant execute on function public.vo_run_facts(uuid) to authenticated, service_role;

-- The approved official content Vo may cite, with its source (no page body).
create function public.vo_run_official_content(p_run_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  run public.vo_runs;
begin
  run := app.vo_ask_run(p_run_id);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'kind', item.kind,
      'id', item.id,
      'label', item.label,
      'content', item.content,
      'source_url', item.source_url,
      'source_section', item.source_section,
      'form_number', item.form_number,
      'form_modified_on', item.form_modified_on,
      'checked_on', item.checked_on,
      'current_to', item.current_to,
      'snapshot_sha256', item.snapshot_sha256
    ) order by item.kind, item.label)
    from (select * from app.vo_letter_official_items(run.organization_id, run.matter_id) limit 400) item
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.vo_run_official_content(uuid) from public, anon;
grant execute on function public.vo_run_official_content(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- finish_vo_run (redefined from 20261019207100_vo_drafts.sql: document_version, fact and official
-- citations, the rebuilt citations kept on the run and the draft, the licensed-review flag)
-- ---------------------------------------------------------------------------

create or replace function public.finish_vo_run(
  p_run_id uuid,
  p_result public.vo_run_result,
  p_title text default null,
  p_body text default null,
  p_sources jsonb default null,
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
  src jsonb;
  src_kind text;
  src_id text;
  src_label text;
  src_source_kind text;
  fact_category text;
  official record;
  entry jsonb;
  cites jsonb := '[]'::jsonb;
  draft_sources jsonb := '[]'::jsonb;
  cites_official boolean := false;
  review_required boolean := false;
  did uuid;
  count_sources integer := 0;
begin
  select * into run from public.vo_runs where id = p_run_id for update;
  if run.id is null or actor is null or run.user_id is distinct from actor
     or app.in_active_org(run.organization_id) is distinct from true
     or app.staff_mfa_satisfied() is distinct from true then
    raise exception 'vo denied' using errcode = '42501';
  end if;
  if run.result <> 'running' then
    raise exception 'this Vo run is already finished' using errcode = '22023';
  end if;
  if p_result is null or p_result = 'running'
     or (p_result = 'drafted' and run.kind = 'ask')
     or (p_result = 'answered' and run.kind <> 'ask') then
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
  if p_failure is not null and (p_result <> 'failed' or p_failure not in ('unavailable', 'failed', 'empty', 'nothing_to_draft')) then
    raise exception 'unknown failure' using errcode = '22023';
  end if;

  -- A run left open too long ends as failed; nothing is saved from it.
  if run.created_at < statement_timestamp() - interval '10 minutes' then
    update public.vo_runs
      set result = 'failed', failure = 'expired', finished_at = clock_timestamp()
      where id = run.id;
    return null;
  end if;

  if p_result in ('drafted', 'answered') then
    if app.message_staff_reads_matter(run.matter_id, run.organization_id) is distinct from true then
      raise exception 'vo denied' using errcode = '42501';
    end if;
    if p_model is null or p_prompt_version is null then
      raise exception 'a draft records its model and prompt version' using errcode = '22023';
    end if;
    -- Ask Vo answers are shown to the asker and not kept (only the run and its citations).
    if p_result = 'drafted' and (
      p_title is null or length(btrim(p_title)) not between 1 and 200
      or p_body is null or length(btrim(p_body)) not between 1 and 4000
    ) then
      raise exception 'a draft needs a title and 1 to 4000 characters' using errcode = '22023';
    end if;
    if p_sources is null or jsonb_typeof(p_sources) <> 'array' or jsonb_array_length(p_sources) not between 1 and 40 then
      raise exception 'a draft cites 1 to 40 records' using errcode = '22023';
    end if;
    -- Every cited record is in the run's allowed set: its own matter and conversation, the
    -- matter's documents and approved facts, and approved official content from a deep federal
    -- official page. A draft can't claim a source from another matter, client or firm, or a page
    -- nobody approved.
    for src in select value from jsonb_array_elements(p_sources)
    loop
      src_kind := src ->> 'kind';
      src_id := src ->> 'id';
      src_label := src ->> 'label';
      if jsonb_typeof(src) <> 'object' or src_id is null
         or src_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         or src_label is null or length(btrim(src_label)) not between 1 and 120 then
        raise exception 'a source needs a kind, an id and a label' using errcode = '22023';
      end if;
      entry := jsonb_build_object('kind', src_kind, 'id', src_id, 'label', btrim(src_label));
      if src_kind = 'matter' then
        if src_id::uuid <> run.matter_id then
          raise exception 'a source is outside this matter' using errcode = '42501';
        end if;
      elsif src_kind = 'message' then
        if run.thread_id is null or not exists (
          select 1 from public.matter_messages message
          where message.id = src_id::uuid
            and message.organization_id = run.organization_id
            and message.thread_id = run.thread_id
        ) then
          raise exception 'a source is outside this conversation' using errcode = '42501';
        end if;
      elsif src_kind = 'document_request' then
        if not exists (
          select 1 from public.document_requests request
          where request.id = src_id::uuid
            and request.organization_id = run.organization_id
            and request.matter_id = run.matter_id
        ) then
          raise exception 'a source is outside this matter' using errcode = '42501';
        end if;
      elsif src_kind = 'task' then
        if not exists (
          select 1 from public.tasks task
          where task.id = src_id::uuid
            and task.organization_id = run.organization_id
            and task.matter_id = run.matter_id
        ) then
          raise exception 'a source is outside this matter' using errcode = '42501';
        end if;
      elsif src_kind = 'deadline' then
        if not exists (
          select 1 from public.deadlines deadline
          where deadline.id = src_id::uuid
            and deadline.organization_id = run.organization_id
            and deadline.matter_id = run.matter_id
        ) then
          raise exception 'a source is outside this matter' using errcode = '42501';
        end if;
      elsif src_kind = 'document_version' then
        if not exists (
          select 1
          from public.document_versions version
          join public.document_matter_refs link
            on link.document_id = version.document_id and link.organization_id = version.organization_id
          where version.id = src_id::uuid
            and version.organization_id = run.organization_id
            and link.matter_id = run.matter_id
            and link.removed_at is null
        ) then
          raise exception 'a source is outside this matter' using errcode = '42501';
        end if;
      elsif src_kind = 'fact' then
        select approved.category into fact_category
        from app.matter_approved_facts(run.matter_id) approved
        where approved.answer_id = src_id::uuid;
        if not found then
          raise exception 'a cited fact is not an approved fact on this matter' using errcode = '42501';
        end if;
        if fact_category <> 'general' and app.vo_category_allowed(run.organization_id, fact_category) is distinct from true then
          raise exception 'the firm hasn''t let Vo use this kind of fact' using errcode = '42501';
        end if;
      elsif src_kind = 'official' then
        src_source_kind := src ->> 'source_kind';
        select * into official
        from app.vo_letter_official_items(run.organization_id, run.matter_id) approved
        where approved.kind = src_source_kind and approved.id = src_id::uuid;
        if not found then
          raise exception 'a cited source is not approved official content of this firm' using errcode = '42501';
        end if;
        cites_official := true;
        entry := entry || jsonb_build_object(
          'source_kind', official.kind,
          'url', official.source_url,
          'section', official.source_section,
          'form_number', official.form_number,
          'form_modified_on', official.form_modified_on,
          'checked_on', official.checked_on,
          'current_to', official.current_to,
          'snapshot_sha256', official.snapshot_sha256
        );
      else
        raise exception 'unknown source kind' using errcode = '22023';
      end if;
      cites := cites || jsonb_build_array(entry);
      -- The draft keeps the short form (its column holds up to 16 kB); the run keeps the full one.
      draft_sources := draft_sources || jsonb_build_array(
        jsonb_build_object('kind', src_kind, 'id', src_id, 'label', btrim(src_label))
        || jsonb_strip_nulls(jsonb_build_object('source_kind', entry ->> 'source_kind', 'url', entry ->> 'url'))
      );
      count_sources := count_sources + 1;
    end loop;
  end if;

  if p_result = 'drafted' then
    review_required := cites_official or app.vo_advice_like(p_body);
    insert into public.vo_drafts (
      organization_id, run_id, kind, matter_id, thread_id, title, body, sources, model, prompt_version,
      needs_rule, is_sample, created_by, licensed_review_required
    ) values (
      run.organization_id, run.id, run.kind::text::public.vo_draft_kind, run.matter_id, run.thread_id, btrim(p_title), btrim(p_body), draft_sources,
      p_model, p_prompt_version, coalesce(p_needs_rule, false), run.is_sample, actor, review_required
    )
    returning id into did;
  end if;

  update public.vo_runs
    set result = p_result,
        model = p_model,
        prompt_version = p_prompt_version,
        source_count = case when p_result in ('drafted', 'answered') then count_sources else null end,
        citations = case when p_result in ('drafted', 'answered') then cites else '[]'::jsonb end,
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
      'source_count', case when p_result in ('drafted', 'answered') then count_sources else null end,
      'official_sources', case when p_result in ('drafted', 'answered') then (select count(*) from jsonb_array_elements(cites) c where c ->> 'kind' = 'official') else null end,
      'needs_rule', case when p_result = 'drafted' then coalesce(p_needs_rule, false) else null end,
      'licensed_review_required', case when p_result = 'drafted' then review_required else null end,
      'draft_id', did,
      'tools', coalesce(p_tools, '{}'::text[])
    )
  );
  return did;
end;
$$;
revoke all on function public.finish_vo_run(uuid, public.vo_run_result, text, text, jsonb, text, text, boolean, integer, text, text[], integer, integer, numeric) from public, anon;
grant execute on function public.finish_vo_run(uuid, public.vo_run_result, text, text, jsonb, text, text, boolean, integer, text, text[], integer, integer, numeric)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- send_vo_draft (redefined from 20261019207100_vo_drafts.sql: licensed review of an advice-like
-- draft before it is sent)
-- ---------------------------------------------------------------------------

create or replace function public.send_vo_draft(p_draft_id uuid, p_body text, p_client_key text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  draft public.vo_drafts%rowtype;
  sent jsonb;
  text_body text := btrim(coalesce(p_body, ''));
  licensed_review boolean := false;
begin
  select * into draft from public.vo_drafts where id = p_draft_id for update;
  if draft.id is null or actor is null
     or app.message_staff_reads_matter(draft.matter_id, draft.organization_id) is distinct from true then
    raise exception 'vo denied' using errcode = '42501';
  end if;
  -- A retried send returns the message it already became.
  if draft.status = 'sent' and draft.reviewed_by = actor then
    return jsonb_build_object('message_id', draft.sent_message_id, 'thread_id', draft.thread_id);
  end if;
  if draft.status <> 'draft' then
    raise exception 'this draft was already reviewed' using errcode = '22023';
  end if;
  if position('[needs a sourced rule]' in lower(text_body)) > 0 or position('[needs a consultant]' in lower(text_body)) > 0 then
    raise exception 'replace the [needs a sourced rule] placeholder before sending' using errcode = '22023';
  end if;
  -- SRC-09: advice-like material (as Vo drafted it, or as edited) goes out only after a licensed
  -- member of the firm reviewed it: they send it themselves, with a fresh step-up.
  if draft.licensed_review_required or app.vo_advice_like(text_body) then
    if app.actor_is_licensed(draft.organization_id) is distinct from true then
      raise exception 'this draft needs a licensed member''s review before it is sent' using errcode = '42501';
    end if;
    perform app.require_licensed_staff(draft.organization_id, true);
    licensed_review := true;
  end if;
  -- The same checks, audience, rate limit and generic email as any staff message.
  sent := public.send_matter_message(
    draft.organization_id, draft.matter_id, draft.thread_id, null, text_body, false, null, p_client_key
  );
  update public.vo_drafts
    set status = 'sent',
        edited = text_body is distinct from btrim(draft.body),
        sent_message_id = (sent ->> 'message_id')::uuid,
        reviewed_by = actor,
        reviewed_at = clock_timestamp(),
        updated_at = clock_timestamp()
    where id = draft.id;
  perform app.record_audit_event(
    draft.organization_id, 'vo.draft_sent', 'vo_drafts', draft.id, 'success',
    jsonb_build_object(
      'kind', draft.kind,
      'edited', text_body is distinct from btrim(draft.body),
      'message_id', sent ->> 'message_id',
      'model', draft.model,
      'licensed_review', licensed_review
    )
  );
  return sent;
end;
$$;
revoke all on function public.send_vo_draft(uuid, text, text) from public, anon;
grant execute on function public.send_vo_draft(uuid, text, text) to authenticated, service_role;
