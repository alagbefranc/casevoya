-- Vo drafts: AI-drafted matter messages that a person reviews, edits and sends (PRD AI-01..AI-06,
-- SRC-09, acceptance scenario 17 "AI injection"; TASKS T029). Additive only; no existing function
-- is redefined.
--
-- Principle: Vo produces DRAFTS ONLY. Nothing reaches a client until a staff member opens the
-- draft in the matter messaging composer, edits it if needed and presses Send. A draft that still
-- holds "[needs a sourced rule]" or "[needs a consultant]" cannot be sent. Vo has no tools: it can
-- not send, sign, submit, change records or read anything the requesting person cannot read.
--
-- Tables
--   vo_settings  one row per firm: Vo on or off (the owner's switch), administrative reply drafts,
--                and whether Vo may read client messages. With no row, Vo is ON only while the
--                firm is in sample mode (and then only for sample records); a real firm is OFF
--                until its owner turns Vo on (docs/DECISIONS.md, 2026-10-18).
--   vo_runs      one row per Vo request: who, which matter and conversation, model, prompt
--                version, how many records it was given, latency, result and the reviewer's
--                "useful?" vote. Never the prompt or the client text.
--   vo_drafts    the draft text, the records it cited (sources), model and prompt version, and
--                its review: draft, sent (with the message it became and whether it was edited)
--                or discarded, by whom and when.
--
-- Who reads: staff who may read the matter's messages (app.message_staff_reads_matter: firm owner,
-- licensed consultant, case manager, assistant at staff assurance, on a matter they can read).
-- Finance users and portal roles never read Vo rows.
--
-- Writes only through security definer functions (search_path = ''):
--   set_vo_settings      firm owner with staff MFA. Audited vo.settings_changed.
--   begin_vo_run         checks role, MFA, the matter, Vo on, capability, sample mode and the
--                        rate limits (20 an hour and 100 a day per person, 300 a day per firm),
--                        then records a running run. Audited vo.run_started (kind only).
--   finish_vo_run        the same person within 10 minutes: drafted (with sources that must belong
--                        to the run's own matter and conversation), abstained or failed. Audited
--                        vo.run_finished (ids, model, counts; never text).
--   send_vo_draft        sends the reviewed text through the unchanged public.send_matter_message
--                        (same checks, audience, rate limit and generic EX07 email) and marks the
--                        draft sent. Audited vo.draft_sent (edited yes/no; never text).
--   discard_vo_draft     audited vo.draft_discarded.
--   rate_vo_run          the reviewer's "useful?" vote.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.vo_settings (
  organization_id uuid primary key references public.organizations (id),
  enabled boolean not null,
  reply_drafts boolean not null default true,
  staff_answers boolean not null default true,
  read_client_messages boolean not null default true,
  -- Sensitive document kinds Vo may read (AI-06). No Vo feature reads document contents yet;
  -- the owner's choice is kept for when one does. Off until the owner turns one on.
  read_identity boolean not null default false,
  read_relationship boolean not null default false,
  read_financial boolean not null default false,
  read_medical boolean not null default false,
  read_criminal boolean not null default false,
  read_narratives boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid not null references auth.users (id)
);
comment on table public.vo_settings is
  'The firm''s Vo switches, set by the firm owner. No row: Vo is on only in sample mode (sample records only).';
create index vo_settings_updated_by_idx on public.vo_settings (updated_by);

create table public.vo_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  user_id uuid not null references auth.users (id),
  kind public.vo_run_kind not null,
  matter_id uuid not null,
  thread_id uuid,
  result public.vo_run_result not null default 'running',
  model text check (model is null or model ~ '^[a-z0-9@][a-z0-9@._/-]{2,119}$'),
  prompt_version text check (prompt_version is null or prompt_version ~ '^[a-z0-9._-]{1,40}$'),
  source_count integer check (source_count is null or source_count between 0 and 60),
  latency_ms integer check (latency_ms is null or latency_ms between 0 and 600000),
  -- The agent's tool calls (names only), token use and the client-side cost estimate (AI-02).
  tools_called text[] not null default '{}'::text[] check (cardinality(tools_called) <= 60),
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  cost_usd numeric(10, 4) check (cost_usd is null or cost_usd >= 0),
  failure text check (failure is null or failure in ('unavailable', 'failed', 'empty', 'nothing_to_draft', 'expired')),
  useful boolean,
  is_sample boolean not null default false,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (id, organization_id),
  check ((result = 'running') = (finished_at is null)),
  check (failure is null or result = 'failed'),
  check ((kind = 'ask') = (thread_id is null)),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id),
  foreign key (thread_id, organization_id) references public.message_threads (id, organization_id)
);
comment on table public.vo_runs is
  'One Vo request (AI-02 run record): actor, matter, conversation, model, prompt version, source count, latency, result. No prompt and no client text.';
create index vo_runs_org_created_idx on public.vo_runs (organization_id, created_at desc);
create index vo_runs_user_org_created_idx on public.vo_runs (user_id, organization_id, created_at);
create index vo_runs_matter_org_idx on public.vo_runs (matter_id, organization_id);
create index vo_runs_thread_org_idx on public.vo_runs (thread_id, organization_id);

create table public.vo_drafts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  run_id uuid not null unique,
  kind public.vo_draft_kind not null,
  matter_id uuid not null,
  thread_id uuid not null,
  title text not null check (length(btrim(title)) between 1 and 200),
  body text not null check (length(btrim(body)) between 1 and 4000),
  sources jsonb not null check (
    jsonb_typeof(sources) = 'array'
    and jsonb_array_length(sources) between 1 and 40
    and pg_column_size(sources) <= 16000
  ),
  model text not null check (model ~ '^[a-z0-9@][a-z0-9@._/-]{2,119}$'),
  prompt_version text not null check (prompt_version ~ '^[a-z0-9._-]{1,40}$'),
  needs_rule boolean not null default false,
  status public.vo_draft_status not null default 'draft',
  edited boolean,
  sent_message_id uuid,
  reviewed_by uuid references auth.users (id),
  reviewed_at timestamptz,
  is_sample boolean not null default false,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  check ((status = 'draft') = (reviewed_at is null)),
  check ((status = 'draft') = (reviewed_by is null)),
  check ((status = 'sent') = (sent_message_id is not null)),
  check ((status = 'sent') = (edited is not null)),
  foreign key (run_id, organization_id) references public.vo_runs (id, organization_id),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id),
  foreign key (thread_id, organization_id) references public.message_threads (id, organization_id),
  foreign key (sent_message_id, organization_id) references public.matter_messages (id, organization_id)
);
comment on table public.vo_drafts is
  'A Vo draft waiting for a person, and its review. sources: the records the draft was grounded in ([{kind, id, label}]). Protected like the matter''s messages.';
comment on column public.vo_drafts.reviewed_by is 'The staff member who sent (after review) or discarded the draft.';
create index vo_drafts_org_status_idx on public.vo_drafts (organization_id, status, created_at desc);
create index vo_drafts_run_org_idx on public.vo_drafts (run_id, organization_id);
create index vo_drafts_matter_org_idx on public.vo_drafts (matter_id, organization_id);
create index vo_drafts_thread_org_idx on public.vo_drafts (thread_id, organization_id);
create index vo_drafts_sent_message_org_idx on public.vo_drafts (sent_message_id, organization_id);
create index vo_drafts_reviewed_by_idx on public.vo_drafts (reviewed_by);
create index vo_drafts_created_by_idx on public.vo_drafts (created_by);

-- ---------------------------------------------------------------------------
-- Privileges and read rules
-- ---------------------------------------------------------------------------

alter table public.vo_settings enable row level security;
alter table public.vo_settings force row level security;
alter table public.vo_runs enable row level security;
alter table public.vo_runs force row level security;
alter table public.vo_drafts enable row level security;
alter table public.vo_drafts force row level security;

revoke all on public.vo_settings from public, anon, authenticated;
revoke all on public.vo_runs from public, anon, authenticated;
revoke all on public.vo_drafts from public, anon, authenticated;
grant select on public.vo_settings to authenticated;
grant select on public.vo_runs to authenticated;
grant select on public.vo_drafts to authenticated;
grant select, insert, update on public.vo_settings to service_role;
grant select, insert, update on public.vo_runs to service_role;
grant select, insert, update on public.vo_drafts to service_role;

create policy vo_settings_select on public.vo_settings
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.is_org_staff(organization_id))
    and (select app.staff_mfa_satisfied())
  );
create policy vo_runs_select on public.vo_runs
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and app.message_staff_reads_matter(matter_id, organization_id)
  );
create policy vo_drafts_select on public.vo_drafts
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and app.message_staff_reads_matter(matter_id, organization_id)
  );

-- Vo is on for the firm: the owner's switch, or with no switch yet, sample mode.
create function app.vo_enabled(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select s.enabled from public.vo_settings s where s.organization_id = p_org),
    (select o.sample_mode from public.organizations o where o.id = p_org),
    false
  );
$$;
revoke all on function app.vo_enabled(uuid) from public;
grant execute on function app.vo_enabled(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Writes
-- ---------------------------------------------------------------------------

-- The owner changes one or more switches; the others keep their saved value (or default).
create function public.set_vo_settings(p_organization_id uuid, p_changes jsonb)
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
    'read_financial', 'read_medical', 'read_criminal', 'read_narratives'
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
revoke all on function public.set_vo_settings(uuid, jsonb) from public, anon;
grant execute on function public.set_vo_settings(uuid, jsonb) to authenticated, service_role;

-- p_thread_id for a draft (message_reply, document_request); p_matter_id for Ask Vo.
create function public.begin_vo_run(
  p_organization_id uuid,
  p_kind public.vo_run_kind,
  p_thread_id uuid,
  p_matter_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  thread public.message_threads%rowtype;
  matter public.matters%rowtype;
  settings public.vo_settings%rowtype;
  sample boolean;
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
  if p_kind is null then
    raise exception 'choose what Vo drafts' using errcode = '22023';
  end if;
  if p_kind = 'ask' then
    select * into matter from public.matters where id = p_matter_id and organization_id = p_organization_id;
  else
    select * into thread from public.message_threads where id = p_thread_id and organization_id = p_organization_id;
    select * into matter from public.matters where id = thread.matter_id and organization_id = p_organization_id;
  end if;
  -- Vo reads only what the requesting person can read.
  if matter.id is null or (p_kind <> 'ask' and thread.id is null)
     or app.message_staff_reads_matter(matter.id, matter.organization_id) is distinct from true then
    raise exception 'vo denied' using errcode = '42501';
  end if;
  if app.vo_enabled(p_organization_id) is distinct from true then
    return jsonb_build_object('ok', false, 'error', 'off');
  end if;
  select * into settings from public.vo_settings where organization_id = p_organization_id;
  if settings.organization_id is not null and (
    (p_kind = 'ask' and settings.staff_answers is not true)
    or (p_kind <> 'ask' and (settings.reply_drafts is not true or settings.read_client_messages is not true))
  ) then
    return jsonb_build_object('ok', false, 'error', 'capability_off');
  end if;
  sample := case when p_kind = 'ask' then matter.is_sample else thread.is_sample end;
  -- In sample mode Vo works on sample records only.
  if app.sample_mode_blocks_real(p_organization_id, sample) then
    return jsonb_build_object('ok', false, 'error', 'sample_only');
  end if;

  -- Serialized per firm so two tabs cannot both pass the counts.
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
  values (p_organization_id, actor, p_kind, matter.id, case when p_kind = 'ask' then null else thread.id end, sample)
  returning id into rid;
  perform app.record_audit_event(
    p_organization_id, 'vo.run_started', 'vo_runs', rid, 'success',
    jsonb_build_object('kind', p_kind)
  );
  return jsonb_build_object('ok', true, 'run_id', rid, 'matter_id', matter.id);
end;
$$;
revoke all on function public.begin_vo_run(uuid, public.vo_run_kind, uuid, uuid) from public, anon;
grant execute on function public.begin_vo_run(uuid, public.vo_run_kind, uuid, uuid) to authenticated, service_role;

create function public.finish_vo_run(
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
    -- Ask Vo answers are shown to the asker and not kept (only the run and its sources' count).
    if p_result = 'drafted' and (
      p_title is null or length(btrim(p_title)) not between 1 and 200
      or p_body is null or length(btrim(p_body)) not between 1 and 4000
    ) then
      raise exception 'a draft needs a title and 1 to 4000 characters' using errcode = '22023';
    end if;
    if p_sources is null or jsonb_typeof(p_sources) <> 'array' or jsonb_array_length(p_sources) not between 1 and 40 then
      raise exception 'a draft cites 1 to 40 records' using errcode = '22023';
    end if;
    -- Every cited record belongs to this run's own matter and conversation: a draft can't claim
    -- a source from another matter, client or firm.
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
      else
        raise exception 'unknown source kind' using errcode = '22023';
      end if;
      count_sources := count_sources + 1;
    end loop;
  end if;

  if p_result = 'drafted' then
    insert into public.vo_drafts (
      organization_id, run_id, kind, matter_id, thread_id, title, body, sources, model, prompt_version,
      needs_rule, is_sample, created_by
    ) values (
      run.organization_id, run.id, run.kind::text::public.vo_draft_kind, run.matter_id, run.thread_id, btrim(p_title), btrim(p_body), p_sources,
      p_model, p_prompt_version, coalesce(p_needs_rule, false), run.is_sample, actor
    )
    returning id into did;
  end if;

  update public.vo_runs
    set result = p_result,
        model = p_model,
        prompt_version = p_prompt_version,
        source_count = case when p_result in ('drafted', 'answered') then count_sources else null end,
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
      'needs_rule', case when p_result = 'drafted' then coalesce(p_needs_rule, false) else null end,
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

create function public.send_vo_draft(p_draft_id uuid, p_body text, p_client_key text default null)
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
      'model', draft.model
    )
  );
  return sent;
end;
$$;
revoke all on function public.send_vo_draft(uuid, text, text) from public, anon;
grant execute on function public.send_vo_draft(uuid, text, text) to authenticated, service_role;

create function public.discard_vo_draft(p_draft_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  draft public.vo_drafts%rowtype;
begin
  select * into draft from public.vo_drafts where id = p_draft_id for update;
  if draft.id is null or actor is null
     or app.message_staff_reads_matter(draft.matter_id, draft.organization_id) is distinct from true then
    raise exception 'vo denied' using errcode = '42501';
  end if;
  if draft.status <> 'draft' then
    raise exception 'this draft was already reviewed' using errcode = '22023';
  end if;
  update public.vo_drafts
    set status = 'discarded', reviewed_by = actor, reviewed_at = clock_timestamp(), updated_at = clock_timestamp()
    where id = draft.id;
  perform app.record_audit_event(
    draft.organization_id, 'vo.draft_discarded', 'vo_drafts', draft.id, 'success',
    jsonb_build_object('kind', draft.kind, 'model', draft.model)
  );
end;
$$;
revoke all on function public.discard_vo_draft(uuid) from public, anon;
grant execute on function public.discard_vo_draft(uuid) to authenticated, service_role;

create function public.rate_vo_run(p_run_id uuid, p_useful boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  run public.vo_runs%rowtype;
begin
  select * into run from public.vo_runs where id = p_run_id for update;
  if run.id is null or (select auth.uid()) is null
     or app.message_staff_reads_matter(run.matter_id, run.organization_id) is distinct from true then
    raise exception 'vo denied' using errcode = '42501';
  end if;
  update public.vo_runs set useful = p_useful where id = run.id;
  perform app.record_audit_event(
    run.organization_id, 'vo.run_rated', 'vo_runs', run.id, 'success',
    jsonb_build_object('useful', p_useful)
  );
end;
$$;
revoke all on function public.rate_vo_run(uuid, boolean) from public, anon;
grant execute on function public.rate_vo_run(uuid, boolean) to authenticated, service_role;
