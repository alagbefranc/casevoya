-- Vo cites attested claims (#188, Francis's decision 2026-10-25): "Let Vo cite claims approved by
-- attestation without a page capture, but only with the attestation shown clearly next to the
-- citation." Additive; seeds nothing.
--
-- Until now Vo's official content took a program rule (a live rule version) only when its evidence
-- had a page capture (public.source_snapshots). A claim a licensed reviewer approved by attesting
-- they opened the official page themselves (SRC-01/03, 20261025400000_src_claims_review.sql:
-- rule_evidence with snapshot_id null and page_attested_by_membership_id / page_attested_on set)
-- was published but never citable. Now it is, when all of this holds:
--   - the version is live (app.rule_version_is_live);
--   - the evidence has no capture and carries the attestation: the attesting reviewer and the date
--     they opened the page, and that reviewer recorded the approval (public.professional_reviews);
--   - its source URL passes app.official_claim_url (no homepage) and Vo's federal-only
--     app.vo_citable_official_url.
-- A captured page is still preferred when a version has both kinds of evidence.
--
-- Every citation of an attested item carries the attestation, rebuilt from the database (never from
-- the Vo service): attested true, attested_by (the reviewer's name) and attested_on (the date they
-- opened the page). The page shows "Page not captured by Casevoya, checked by <reviewer> on <date>"
-- next to the citation (Ask Vo sources, Vo drafts' source lists, letters). The same holds for the
-- registers Vo already cited with an attestation (submission steps, renewal timings, steps after
-- approval): their citations now carry it too.
--
-- New
--   app.vo_official_attestation(org, kind, id, sha256, attested_on)  the attestation of one official
--                                       item that has no capture, with the reviewer's name; null otherwise.
-- Redefined (copied from their latest definitions; changes marked "Attested"):
--   app.vo_letter_official_items(uuid, uuid)    from 20261025420100_vo_grounded_live_rule.sql: live rule
--                                       versions with attested evidence, attested_on filled.
--   public.vo_run_official_content(uuid)        from 20261025420000_vo_grounded_outputs.sql: each item
--                                       says attested, attested_by, attested_on (Ask Vo's tool output).
--   public.finish_vo_run(...)                   from 20261025420000_vo_grounded_outputs.sql: an official
--                                       citation records attested (and attested_by, attested_on) on the
--                                       run's citations and the draft's sources.
--   public.vo_letter_official_content(uuid)     from 20261025240100_vo_letter_drafts.sql: the same for the
--                                       letter tool's output.
--   public.save_vo_letter_draft(...)            from 20261025240100_vo_letter_drafts.sql: a letter's cited
--                                       official item records attested and attested_by.

-- ---------------------------------------------------------------------------
-- The attestation of one official item (new)
-- ---------------------------------------------------------------------------

-- {attested: true, attested_by, attested_on} for an approved official item Casevoya didn't capture
-- (no page fingerprint) that a licensed reviewer attested; null for a captured page or an item with
-- no attestation. The name is the reviewer's display name, or "a licensed member" when the profile
-- has none. Callers pass what app.vo_letter_official_items returned for the item.
create function app.vo_official_attestation(p_org uuid, p_kind text, p_id uuid, p_sha256 text, p_attested_on date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  attester uuid;
  reviewer_name text;
begin
  if p_sha256 is not null or p_attested_on is null or p_id is null then
    return null;
  end if;
  if p_kind = 'rule_version' then
    select link.page_attested_by_membership_id into attester
    from public.rule_evidence link
    where link.rule_version_id = p_id
      and link.organization_id = p_org
      and link.snapshot_id is null
      and link.page_attested_on = p_attested_on
    order by link.page_attested_at desc
    limit 1;
  elsif p_kind = 'submission_requirement' then
    select req.page_attested_by_membership_id into attester
    from public.submission_requirements req
    where req.id = p_id and req.organization_id = p_org and req.page_attested_on = p_attested_on;
  elsif p_kind = 'renewal_timing' then
    select timing.page_attested_by_membership_id into attester
    from public.renewal_timings timing
    where timing.id = p_id and timing.organization_id = p_org and timing.page_attested_on = p_attested_on;
  elsif p_kind = 'follow_up_step' then
    select step.page_attested_by_membership_id into attester
    from public.approval_follow_up_steps step
    where step.id = p_id and step.organization_id = p_org and step.page_attested_on = p_attested_on;
  end if;
  if attester is null then
    return null;
  end if;
  select nullif(btrim(profile.display_name), '') into reviewer_name
  from public.memberships mem
  join public.profiles profile on profile.id = mem.user_id
  where mem.id = attester and mem.organization_id = p_org;
  return jsonb_build_object(
    'attested', true,
    'attested_by', left(coalesce(reviewer_name, 'a licensed member'), 120),
    'attested_on', p_attested_on
  );
end;
$$;
revoke all on function app.vo_official_attestation(uuid, text, uuid, text, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- app.vo_letter_official_items (redefined from 20261025420100_vo_grounded_live_rule.sql)
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
           evidence.checked_on, evidence.current_to, evidence.content_hash, evidence.attested_on, null::timestamptz
    from public.rule_versions rule
    join public.rule_definitions definition on definition.id = rule.definition_id
    cross join program
    cross join lateral (
      -- Attested: a captured page as before; otherwise evidence Casevoya couldn't capture that the
      -- approving reviewer attested (who and the date they opened the page), on a deep federal page.
      select coalesce(snapshot.final_url, link.source_url) as final_url,
             link.source_section,
             case when snapshot.id is null then link.modified_on else snapshot.modified_on end as modified_on,
             case when snapshot.id is null then link.checked_on else app.firm_local_date(p_org, snapshot.retrieved_at) end as checked_on,
             case when snapshot.id is null then link.current_to else snapshot.current_to end as current_to,
             snapshot.content_hash,
             case when snapshot.id is null then link.page_attested_on end as attested_on
      from public.rule_evidence link
      left join public.source_snapshots snapshot on snapshot.id = link.snapshot_id
      where link.rule_version_id = rule.id
        and (
          snapshot.id is not null
          or (
            link.snapshot_id is null
            and link.page_attested_on is not null
            and link.page_attested_by_membership_id is not null
            and app.official_claim_url(link.source_url) is not null
            and app.vo_citable_official_url(link.source_url)
            and exists (
              select 1 from public.professional_reviews review
              where review.rule_version_id = rule.id
                and review.decision = 'approved'
                and review.reviewer_membership_id = link.page_attested_by_membership_id
            )
          )
        )
      order by (snapshot.id is null), snapshot.retrieved_at desc nulls last, link.page_attested_at desc
      limit 1
    ) evidence
    where app.rule_version_is_live(rule.id)
      and rule.claim is not null
      and (definition.organization_id is null or definition.organization_id = p_org)
      and (rule.organization_id is null or rule.organization_id = p_org)
      and (definition.program_key is null or definition.program_key = program.key)
  ) as items (
    kind, id, label, content, source_url, source_section, form_number, form_modified_on,
    checked_on, current_to, snapshot_sha256, attested_on, reviewed_at
  )
  where app.vo_citable_official_url(items.source_url)
    -- Attested: a page Casevoya didn't capture is citable only with a reviewer's attestation.
    and (items.snapshot_sha256 is not null or items.attested_on is not null);
$$;
revoke all on function app.vo_letter_official_items(uuid, uuid) from public;

-- ---------------------------------------------------------------------------
-- public.vo_run_official_content (redefined from 20261025420000_vo_grounded_outputs.sql)
-- ---------------------------------------------------------------------------

-- The approved official content Vo may cite, with its source (no page body).
create or replace function public.vo_run_official_content(p_run_id uuid)
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
    -- Attested: the reviewer's attestation when Casevoya didn't capture the page.
    ) || coalesce(
      app.vo_official_attestation(run.organization_id, item.kind, item.id, item.snapshot_sha256, item.attested_on),
      jsonb_build_object('attested', false)
    ) order by item.kind, item.label)
    from (select * from app.vo_letter_official_items(run.organization_id, run.matter_id) limit 400) item
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.vo_run_official_content(uuid) from public, anon;
grant execute on function public.vo_run_official_content(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- public.finish_vo_run (redefined from 20261025420000_vo_grounded_outputs.sql)
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
  attestation jsonb;
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
        -- Attested: a page Casevoya didn't capture is cited only with the reviewer's attestation
        -- (who, and the date they opened it), taken from the database, never from the service.
        attestation := app.vo_official_attestation(run.organization_id, official.kind, official.id, official.snapshot_sha256, official.attested_on);
        if official.snapshot_sha256 is null and attestation is null then
          raise exception 'a cited source is not approved official content of this firm' using errcode = '42501';
        end if;
        entry := entry || coalesce(attestation, jsonb_build_object('attested', false));
      else
        raise exception 'unknown source kind' using errcode = '22023';
      end if;
      cites := cites || jsonb_build_array(entry);
      -- The draft keeps the short form (its column holds up to 16 kB); the run keeps the full one.
      draft_sources := draft_sources || jsonb_build_array(
        jsonb_build_object('kind', src_kind, 'id', src_id, 'label', btrim(src_label))
        || jsonb_strip_nulls(jsonb_build_object('source_kind', entry ->> 'source_kind', 'url', entry ->> 'url'))
        -- Attested: the draft's source list shows the attestation next to the citation.
        || case when (entry ->> 'attested')::boolean is true
             then jsonb_build_object('attested', true, 'attested_by', entry ->> 'attested_by', 'attested_on', entry ->> 'attested_on')
             else '{}'::jsonb end
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
-- public.vo_letter_official_content (redefined from 20261025240100_vo_letter_drafts.sql)
-- ---------------------------------------------------------------------------

-- The approved official content Vo may cite (text and source; no page body).
create or replace function public.vo_letter_official_content(p_run_id uuid)
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
    -- Attested: the reviewer's attestation when Casevoya didn't capture the page.
    ) || coalesce(
      app.vo_official_attestation(run.organization_id, item.kind, item.id, item.snapshot_sha256, item.attested_on),
      jsonb_build_object('attested', false)
    ) order by item.kind, item.label)
    from (select * from app.vo_letter_official_items(run.organization_id, run.matter_id) limit 400) item
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.vo_letter_official_content(uuid) from public, anon;
grant execute on function public.vo_letter_official_content(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- public.save_vo_letter_draft (redefined from 20261025240100_vo_letter_drafts.sql)
-- ---------------------------------------------------------------------------

create or replace function public.save_vo_letter_draft(
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
    -- Attested: the letter keeps the reviewer's attestation (attested, attested_by) with the source.
    ) || coalesce(
      app.vo_official_attestation(run.organization_id, official.kind, official.id, official.snapshot_sha256, official.attested_on) - 'attested_on',
      jsonb_build_object('attested', false)
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
