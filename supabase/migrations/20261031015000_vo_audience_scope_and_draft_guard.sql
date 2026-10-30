-- Vo security review (VO-1, VO-2, VO-5, VO-6). Additive only.
--
-- VO-1  A reply or document-request draft cites only records its conversation's audience may see:
--       a document request addressed to someone in the audience, never staff-only, and either the
--       audience is only that person or the request is matter-shared and ordinary (the attachment
--       rule of send_matter_message); a client task owned by someone in the audience (never an
--       internal task); a legal or correspondence deadline (never an internal target).
-- VO-2  A cited document request with a medical, criminal or narrative sensitivity needs the
--       firm's matching Vo switch (app.vo_category_allowed).
-- VO-5  A draft body is checked again against the output guard's key rules (no link except the
--       portal and the firm's own booking pages, no email address, no money amount or duration),
--       and needs_rule is derived from the body. Model, token counts, cost and tool names are
--       reported by the Vo service on the staff member's session (recorded as such below).
--
-- public.finish_vo_run is copied from its latest definition (20261025600100_src_live_claims.sql);
-- only the marked parts change.

-- ---------------------------------------------------------------------------
-- VO-1: what a conversation's audience may see.
-- ---------------------------------------------------------------------------
create or replace function app.vo_thread_audience_allows(p_thread_id uuid, p_org uuid, p_kind text, p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with audience as (
    select tp.person_id
    from public.message_thread_people tp
    where tp.thread_id = p_thread_id and tp.organization_id = p_org
  )
  select case p_kind
    when 'document_request' then exists (
      select 1 from public.document_requests request
      where request.id = p_id
        and request.organization_id = p_org
        and request.audience <> 'staff'
        and request.person_id in (select person_id from audience)
        and (
          not exists (select 1 from audience other where other.person_id <> request.person_id)
          or (request.audience = 'matter' and request.sensitivity = 'ordinary')
        )
    )
    when 'task' then exists (
      select 1 from public.tasks task
      where task.id = p_id
        and task.organization_id = p_org
        and task.audience = 'client'
        and task.owner_person_id in (select person_id from audience)
        and (task.person_id is null or task.person_id in (select person_id from audience))
    )
    when 'deadline' then exists (
      select 1 from public.deadlines deadline
      where deadline.id = p_id
        and deadline.organization_id = p_org
        and deadline.kind in ('legal', 'correspondence')
    )
    else true
  end;
$$;
revoke all on function app.vo_thread_audience_allows(uuid, uuid, text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- VO-5 / VO-6: the output guard's key rules for a stored draft body (src/modules/vo/guard.ts).
-- Returns what is wrong, or null.
-- ---------------------------------------------------------------------------
create or replace function app.vo_draft_body_problem(p_body text, p_firm_slug text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  link text;
  parts text[];
  base text;
begin
  if p_body is null then
    return null;
  end if;
  -- Same matching as guard.ts: a link starts at a word boundary (ASCII word characters, as in
  -- JavaScript) and ends at JavaScript whitespace or < > " ' ) ].
  for link in select (regexp_matches(
    p_body,
    '(?<![a-z0-9_])(?:https?://|www\.)[^\s\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff<>"'')\]]+',
    'gi'
  ))[1]
  loop
    link := regexp_replace(link, '[.,;:!?]+$', '');
    parts := regexp_match(link, '^([A-Za-z]+://[^/?#]*)(.*)$');
    if parts is null then
      return 'link';
    end if;
    -- No credentials in the authority ('@' is allowed in the path, as guard.ts allows it).
    if parts[1] ~ '@' then
      return 'link';
    end if;
    link := regexp_replace(lower(parts[1]), ':443$', '') || parts[2];
    if link ~ '(\.\.|%2[eE]|\\)' then
      return 'link';
    end if;
    base := 'https://app.casevoya.ca/portal';
    if link = base or (left(link, length(base)) = base and substr(link, length(base) + 1, 1) in ('/', '?', '#')) then
      continue;
    end if;
    if p_firm_slug is not null and p_firm_slug ~ '^[a-z0-9][a-z0-9-]{0,62}$' then
      base := 'https://app.casevoya.ca/book/' || p_firm_slug;
      if link = base or (left(link, length(base)) = base and substr(link, length(base) + 1, 1) in ('/', '?', '#')) then
        continue;
      end if;
    end if;
    return 'link';
  end loop;
  -- Word boundaries before and after, as guard.ts's \b...\b (ASCII word characters).
  if p_body ~* '(?:(?<![a-z0-9_])(?=[a-z0-9_])|(?<=[a-z0-9_])(?![a-z0-9_]))[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}(?![a-z0-9_])' then
    return 'email';
  end if;
  if p_body ~* '(\$|CAD|USD|EUR|€|£)\s?[0-9]' then
    return 'amount';
  end if;
  if p_body ~* '\m[0-9]+\s*(days?|weeks?|months?|years?)\M' then
    return 'duration';
  end if;
  return null;
end;
$$;
revoke all on function app.vo_draft_body_problem(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Redefined: public.finish_vo_run (from 20261025600100_src_live_claims.sql)
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
  request_sensitivity text;
  official record;
  attestation jsonb;
  entry jsonb;
  cites jsonb := '[]'::jsonb;
  draft_sources jsonb := '[]'::jsonb;
  cites_official boolean := false;
  review_required boolean := false;
  needs_rule boolean := false;
  did uuid;
  count_sources integer := 0;
  thread_scoped boolean := false;
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

  -- VO-1: replies and document-request drafts are limited to their conversation's audience.
  thread_scoped := run.thread_id is not null and run.kind::text in ('message_reply', 'document_request');

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
    -- VO-5 / VO-6: the stored body passes the output guard's key rules again.
    if p_result = 'drafted' and app.vo_draft_body_problem(
      p_body, (select organization.slug from public.organizations organization where organization.id = run.organization_id)
    ) is not null then
      raise exception 'a draft must pass the output guard' using errcode = '22023';
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
        select request.sensitivity::text into request_sensitivity
        from public.document_requests request
        where request.id = src_id::uuid
          and request.organization_id = run.organization_id
          and request.matter_id = run.matter_id;
        if not found then
          raise exception 'a source is outside this matter' using errcode = '42501';
        end if;
        -- VO-2: the firm's category switches.
        if request_sensitivity in ('medical', 'criminal', 'narrative')
           and app.vo_category_allowed(run.organization_id, request_sensitivity) is distinct from true then
          raise exception 'the firm hasn''t let Vo use this kind of record' using errcode = '42501';
        end if;
        if thread_scoped and app.vo_thread_audience_allows(run.thread_id, run.organization_id, src_kind, src_id::uuid) is distinct from true then
          raise exception 'a source is outside this conversation''s audience' using errcode = '42501';
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
        if thread_scoped and app.vo_thread_audience_allows(run.thread_id, run.organization_id, src_kind, src_id::uuid) is distinct from true then
          raise exception 'a source is outside this conversation''s audience' using errcode = '42501';
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
        if thread_scoped and app.vo_thread_audience_allows(run.thread_id, run.organization_id, src_kind, src_id::uuid) is distinct from true then
          raise exception 'a source is outside this conversation''s audience' using errcode = '42501';
        end if;
      elsif src_kind in ('document_version', 'fact') and thread_scoped then
        -- VO-1: a reply or document-request draft doesn't read documents or intake facts.
        raise exception 'a source is outside this conversation''s audience' using errcode = '42501';
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
        -- Live claims: and the firm's edit stamp next to an edited official claim.
        || case when (entry ->> 'edited')::boolean is true
             then jsonb_build_object('edited', true, 'edited_by', entry ->> 'edited_by', 'edited_licence', entry ->> 'edited_licence', 'edited_on', entry ->> 'edited_on')
             else '{}'::jsonb end
      );
      count_sources := count_sources + 1;
    end loop;
  end if;

  if p_result = 'drafted' then
    review_required := cites_official or app.vo_advice_like(p_body);
    -- VO-5: derived from the body (the guard's placeholder), not taken from the caller.
    needs_rule := position('[needs a sourced rule]' in p_body) > 0;
    insert into public.vo_drafts (
      organization_id, run_id, kind, matter_id, thread_id, title, body, sources, model, prompt_version,
      needs_rule, is_sample, created_by, licensed_review_required
    ) values (
      run.organization_id, run.id, run.kind::text::public.vo_draft_kind, run.matter_id, run.thread_id, btrim(p_title), btrim(p_body), draft_sources,
      p_model, p_prompt_version, needs_rule, run.is_sample, actor, review_required
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
      'needs_rule', case when p_result = 'drafted' then needs_rule else null end,
      'licensed_review_required', case when p_result = 'drafted' then review_required else null end,
      'draft_id', did,
      'tools', coalesce(p_tools, '{}'::text[]),
      'usage_self_reported', true
    )
  );
  return did;
end;
$$;
revoke all on function public.finish_vo_run(uuid, public.vo_run_result, text, text, jsonb, text, text, boolean, integer, text, text[], integer, integer, numeric) from public, anon;
grant execute on function public.finish_vo_run(uuid, public.vo_run_result, text, text, jsonb, text, text, boolean, integer, text, text[], integer, integer, numeric)
  to authenticated, service_role;

-- VO-5: what the run log can't vouch for.
comment on column public.vo_runs.model is 'Reported by the Vo service through finish_vo_run on the staff member''s session; not independently verified.';
comment on column public.vo_runs.input_tokens is 'Reported by the Vo service on the staff member''s session; not independently verified.';
comment on column public.vo_runs.output_tokens is 'Reported by the Vo service on the staff member''s session; not independently verified.';
comment on column public.vo_runs.cost_usd is 'Reported by the Vo service on the staff member''s session; not independently verified.';
comment on column public.vo_runs.tools_called is 'Reported by the Vo service on the staff member''s session; not independently verified.';
