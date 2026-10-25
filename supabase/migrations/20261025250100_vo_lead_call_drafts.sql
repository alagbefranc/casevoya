-- Vo lead follow-up drafts and call-notes summaries (PRD AI-01, AI-06; gap AI-01 criteria 2 to 4).
-- Additive only; no existing function is redefined.
--
-- Both go through Vo's existing path: a run in public.vo_runs (who, model, prompt version, how many
-- records it read, latency, tools, tokens, cost, result), the same firm switch (app.vo_enabled),
-- capability switches, sample-mode rule and rate limits (shared with every Vo run), the Vo agent
-- service working with the staff member's own token, the same output guard, and a DRAFT that only
-- a person can act on. Nothing is sent, saved to a record or shown to anyone else by Vo.
--
--   Lead follow-up (Lead page)  Vo drafts a follow-up from the lead's own enquiry and history.
--     It needs the lead's current consent to be contacted (the latest enquiry_reply answer is
--     "yes"); without it there is no run and the page says why. Without marketing consent the
--     draft is kept to the enquiry (no promotional content); the consent Vo drafted under is
--     stored on the draft. Casevoya has no message to a lead (no approved email design), so
--     staff copy the reviewed text (or save it to their own connected mailbox) and send it
--     themselves; "Mark as sent" records the text they sent as a lead note. Governed by the
--     owner's "Administrative reply drafts" and "Client messages" switches.
--   Call summary (Consultations > Consultation record)  after a Casevoya video call (the call took
--     place in Casevoya, or the consultation was marked attended), staff paste or upload their own
--     notes and Vo drafts a summary. The pasted notes go to the Vo service in the signed request
--     and are not stored. Casevoya doesn't record calls. The reviewed summary is saved as a staff
--     note on the consultation's lead, or on its matter when it has no lead, only when a person
--     presses Save. Governed by the owner's "Matter summaries for staff" switch; notes that mention
--     medical or criminal-history details are refused unless the owner lets Vo read those
--     categories (checked by the app and again by the service, which reads the switches itself).
--
-- Changes
--   vo_runs        matter_id may be null for these two kinds; lead_id and booking_id (the run's
--                  target); the thread check is restated so only message drafts carry a
--                  conversation (named as before, vo_runs_thread_kind_check); the read rule also
--                  lets lead staff read a lead run.
--   vo_crm_drafts  the draft, its sources, model, prompt version, the consent it was drafted under,
--                  how many notes were left out for a switched-off category, and its review: sent
--                  (lead follow-up, with the lead note that records it), reviewed (call summary,
--                  with the note it became) or discarded.
--
-- Functions (security definer, search_path = '')
--   app.vo_lead_consent           the lead's current answer for one consent purpose.
--   app.vo_rate_limited           the shared Vo limits (20 an hour, 100 a day per person, 300 a
--                                 day per firm), serialized per firm. Same numbers as begin_vo_run.
--   app.vo_crm_target_readable    lead staff for a lead; staff who read the matter for a matter.
--   public.begin_vo_lead_follow_up  Audited vo.run_started.
--   public.begin_vo_call_summary    Audited vo.run_started.
--   public.finish_vo_crm_run        the same person within 10 minutes. Audited vo.run_finished.
--   public.mark_vo_lead_follow_up_sent  Audited vo.draft_sent (and lead.note_added).
--   public.save_vo_call_summary         Audited vo.draft_saved (and the note's own event).
--   public.discard_vo_crm_draft         Audited vo.draft_discarded.

-- ---------------------------------------------------------------------------
-- vo_runs: a lead or a consultation as the run's target
-- ---------------------------------------------------------------------------

alter table public.vo_runs alter column matter_id drop not null;
alter table public.vo_runs
  add column lead_id uuid,
  add column booking_id uuid;
comment on column public.vo_runs.lead_id is 'lead_follow_up runs, and call_summary runs saved to a lead: the lead.';
comment on column public.vo_runs.booking_id is 'call_summary runs: the consultation (video call) the notes are about.';
alter table public.vo_runs
  add constraint vo_runs_lead_fk foreign key (lead_id, organization_id) references public.leads (id, organization_id),
  add constraint vo_runs_booking_fk foreign key (booking_id, organization_id) references public.bookings (id, organization_id);
create index vo_runs_lead_org_idx on public.vo_runs (lead_id, organization_id);
create index vo_runs_booking_org_idx on public.vo_runs (booking_id, organization_id);

-- Only message drafts carry a conversation (was: ask and document_review carry none).
alter table public.vo_runs drop constraint vo_runs_thread_kind_check;
alter table public.vo_runs
  add constraint vo_runs_thread_kind_check check ((thread_id is not null) = (kind in ('message_reply', 'document_request'))),
  -- Every run has a target: a matter, or (these two kinds) a lead.
  add constraint vo_runs_target_check check (matter_id is not null or (kind in ('lead_follow_up', 'call_summary') and lead_id is not null)),
  add constraint vo_runs_lead_kind_check check (lead_id is null or kind in ('lead_follow_up', 'call_summary')),
  add constraint vo_runs_lead_follow_up_check check (kind <> 'lead_follow_up' or (lead_id is not null and matter_id is null)),
  add constraint vo_runs_booking_kind_check check ((kind = 'call_summary') = (booking_id is not null)),
  add constraint vo_runs_call_target_check check (kind <> 'call_summary' or ((lead_id is null) <> (matter_id is null)));

alter policy vo_runs_select on public.vo_runs
  using (
    organization_id = (select app.current_organization_id())
    and (
      (matter_id is not null and app.message_staff_reads_matter(matter_id, organization_id))
      or (matter_id is null and lead_id is not null and app.can_read_leads(organization_id))
    )
  );

-- ---------------------------------------------------------------------------
-- vo_crm_drafts
-- ---------------------------------------------------------------------------

create table public.vo_crm_drafts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  run_id uuid not null unique,
  kind public.vo_draft_kind not null check (kind in ('lead_follow_up', 'call_summary')),
  lead_id uuid,
  matter_id uuid,
  booking_id uuid,
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
  -- lead_follow_up: the lead's marketing consent when Vo drafted (false: kept to the enquiry).
  marketing_consent boolean,
  -- Notes Vo was not given because they mention a category the firm keeps from Vo.
  left_out smallint not null default 0 check (left_out between 0 and 60),
  status public.vo_draft_status not null default 'draft' check (status in ('draft', 'sent', 'reviewed', 'discarded')),
  edited boolean,
  lead_note_id uuid references public.lead_notes (id),
  matter_note_id uuid,
  reviewed_by uuid references auth.users (id),
  reviewed_at timestamptz,
  is_sample boolean not null default false,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  check ((status = 'draft') = (reviewed_at is null)),
  check ((status = 'draft') = (reviewed_by is null)),
  check ((status in ('sent', 'reviewed')) = (edited is not null)),
  check ((status in ('sent', 'reviewed')) = (lead_note_id is not null or matter_note_id is not null)),
  check (status <> 'sent' or kind = 'lead_follow_up'),
  check (status <> 'reviewed' or kind = 'call_summary'),
  check (kind <> 'lead_follow_up' or (lead_id is not null and matter_id is null and booking_id is null and marketing_consent is not null)),
  check (kind <> 'call_summary' or (booking_id is not null and (lead_id is null) <> (matter_id is null) and marketing_consent is null)),
  check (matter_note_id is null or matter_id is not null),
  check (lead_note_id is null or lead_id is not null),
  foreign key (run_id, organization_id) references public.vo_runs (id, organization_id),
  foreign key (lead_id, organization_id) references public.leads (id, organization_id),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id),
  foreign key (booking_id, organization_id) references public.bookings (id, organization_id),
  foreign key (matter_note_id, organization_id) references public.matter_staff_notes (id, organization_id)
);
comment on table public.vo_crm_drafts is
  'A Vo lead follow-up draft or call-notes summary waiting for a person, and its review. Vo never sends or saves it. sources: the records it was grounded in ([{kind, id, label}]). Read by lead staff (lead) or staff who read the matter (matter).';
create index vo_crm_drafts_org_status_idx on public.vo_crm_drafts (organization_id, status, created_at desc);
create index vo_crm_drafts_run_org_idx on public.vo_crm_drafts (run_id, organization_id);
create index vo_crm_drafts_lead_org_idx on public.vo_crm_drafts (lead_id, organization_id);
create index vo_crm_drafts_matter_org_idx on public.vo_crm_drafts (matter_id, organization_id);
create index vo_crm_drafts_booking_org_idx on public.vo_crm_drafts (booking_id, organization_id);
create index vo_crm_drafts_lead_note_idx on public.vo_crm_drafts (lead_note_id);
create index vo_crm_drafts_matter_note_org_idx on public.vo_crm_drafts (matter_note_id, organization_id);
create index vo_crm_drafts_reviewed_by_idx on public.vo_crm_drafts (reviewed_by);
create index vo_crm_drafts_created_by_idx on public.vo_crm_drafts (created_by);
-- One draft waiting per lead follow-up and per consultation.
create unique index vo_crm_drafts_lead_waiting_uidx on public.vo_crm_drafts (lead_id) where status = 'draft' and kind = 'lead_follow_up';
create unique index vo_crm_drafts_booking_waiting_uidx on public.vo_crm_drafts (booking_id) where status = 'draft' and kind = 'call_summary';

alter table public.vo_crm_drafts enable row level security;
alter table public.vo_crm_drafts force row level security;
revoke all on public.vo_crm_drafts from public, anon, authenticated;
grant select on public.vo_crm_drafts to authenticated;
grant select, insert, update on public.vo_crm_drafts to service_role;

create policy vo_crm_drafts_select on public.vo_crm_drafts
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (
      (matter_id is not null and app.message_staff_reads_matter(matter_id, organization_id))
      or (matter_id is null and lead_id is not null and app.can_read_leads(organization_id))
    )
  );

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- The lead's current answer for one purpose: the latest row; no row is "no".
create function app.vo_lead_consent(p_org uuid, p_lead uuid, p_purpose public.lead_consent_purpose)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select c.granted
    from public.lead_consents c
    where c.organization_id = p_org and c.lead_id = p_lead and c.purpose = p_purpose
    order by c.recorded_at desc, c.id desc
    limit 1
  ), false);
$$;
revoke all on function app.vo_lead_consent(uuid, uuid, public.lead_consent_purpose) from public;

-- The limits every Vo run shares (as begin_vo_run): null when a run may start.
create function app.vo_rate_limited(p_org uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  last_hour integer;
  last_day integer;
  firm_day integer;
begin
  -- Serialized per firm so two tabs cannot both pass the counts.
  perform pg_advisory_xact_lock(hashtextextended('vo_run:' || p_org::text, 0));
  select count(*) filter (where r.user_id = actor and r.created_at > statement_timestamp() - interval '1 hour'),
         count(*) filter (where r.user_id = actor),
         count(*)
  into last_hour, last_day, firm_day
  from public.vo_runs r
  where r.organization_id = p_org
    and r.created_at > statement_timestamp() - interval '1 day';
  if last_hour >= 20 or last_day >= 100 then
    return 'rate_limited';
  end if;
  if firm_day >= 300 then
    return 'firm_rate_limited';
  end if;
  return null;
end;
$$;
revoke all on function app.vo_rate_limited(uuid) from public;

create function app.vo_crm_target_readable(p_org uuid, p_lead uuid, p_matter uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_matter is not null then coalesce(app.message_staff_reads_matter(p_matter, p_org), false)
    when p_lead is not null then coalesce(app.can_read_leads(p_org), false)
    else false
  end;
$$;
revoke all on function app.vo_crm_target_readable(uuid, uuid, uuid) from public;

-- ---------------------------------------------------------------------------
-- begin_vo_lead_follow_up
-- ---------------------------------------------------------------------------

create function public.begin_vo_lead_follow_up(p_organization_id uuid, p_lead_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  target public.leads%rowtype;
  settings public.vo_settings%rowtype;
  waiting uuid;
  limited text;
  rid uuid;
begin
  perform app.require_active_staff(p_organization_id, app.lead_staff_roles(), false);
  select * into target from public.leads where id = p_lead_id and organization_id = p_organization_id;
  -- Vo reads only what the requesting person can read.
  if target.id is null or app.can_read_leads(p_organization_id) is distinct from true then
    raise exception 'vo denied' using errcode = '42501';
  end if;
  if app.vo_enabled(p_organization_id) is distinct from true then
    return jsonb_build_object('ok', false, 'error', 'off');
  end if;
  select * into settings from public.vo_settings where organization_id = p_organization_id;
  if settings.organization_id is not null and (settings.reply_drafts is not true or settings.read_client_messages is not true) then
    return jsonb_build_object('ok', false, 'error', 'capability_off');
  end if;
  if target.converted_matter_id is not null then
    return jsonb_build_object('ok', false, 'error', 'converted', 'matter_id', target.converted_matter_id);
  end if;
  if target.email is null and target.phone is null then
    return jsonb_build_object('ok', false, 'error', 'no_contact');
  end if;
  -- No consent to be contacted: no draft at all.
  if app.vo_lead_consent(p_organization_id, target.id, 'enquiry_reply') is not true then
    return jsonb_build_object('ok', false, 'error', 'no_consent');
  end if;
  if app.sample_mode_blocks_real(p_organization_id, target.is_sample) then
    return jsonb_build_object('ok', false, 'error', 'sample_only');
  end if;
  select d.id into waiting from public.vo_crm_drafts d
  where d.lead_id = target.id and d.organization_id = p_organization_id and d.kind = 'lead_follow_up' and d.status = 'draft'
  limit 1;
  if waiting is not null then
    return jsonb_build_object('ok', false, 'error', 'already_drafted', 'draft_id', waiting);
  end if;
  limited := app.vo_rate_limited(p_organization_id);
  if limited is not null then
    return jsonb_build_object('ok', false, 'error', limited);
  end if;

  insert into public.vo_runs (organization_id, user_id, kind, matter_id, thread_id, lead_id, is_sample)
  values (p_organization_id, actor, 'lead_follow_up', null, null, target.id, target.is_sample)
  returning id into rid;
  perform app.record_audit_event(
    p_organization_id, 'vo.run_started', 'vo_runs', rid, 'success',
    jsonb_build_object('kind', 'lead_follow_up', 'lead_id', target.id)
  );
  return jsonb_build_object(
    'ok', true, 'run_id', rid, 'lead_id', target.id,
    'marketing', app.vo_lead_consent(p_organization_id, target.id, 'marketing')
  );
end;
$$;
revoke all on function public.begin_vo_lead_follow_up(uuid, uuid) from public, anon;
grant execute on function public.begin_vo_lead_follow_up(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- begin_vo_call_summary
-- ---------------------------------------------------------------------------

create function public.begin_vo_call_summary(p_organization_id uuid, p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  booking public.bookings%rowtype;
  settings public.vo_settings%rowtype;
  linked_lead uuid;
  target_matter uuid;
  waiting uuid;
  limited text;
  rid uuid;
begin
  perform app.require_active_staff(p_organization_id, app.lead_staff_roles(), false);
  select * into booking from public.bookings where id = p_booking_id and organization_id = p_organization_id;
  if booking.id is null or app.can_read_scheduling(p_organization_id) is distinct from true then
    raise exception 'vo denied' using errcode = '42501';
  end if;
  -- Where the summary would be kept: the consultation's lead, else its matter.
  select l.lead_id into linked_lead from public.lead_booking_links l
  where l.booking_id = booking.id and l.organization_id = p_organization_id;
  if linked_lead is null then
    target_matter := booking.matter_id;
  end if;
  if linked_lead is null and target_matter is null then
    return jsonb_build_object('ok', false, 'error', 'no_target');
  end if;
  if app.vo_crm_target_readable(p_organization_id, linked_lead, target_matter) is distinct from true then
    raise exception 'vo denied' using errcode = '42501';
  end if;
  if app.vo_enabled(p_organization_id) is distinct from true then
    return jsonb_build_object('ok', false, 'error', 'off');
  end if;
  select * into settings from public.vo_settings where organization_id = p_organization_id;
  if settings.organization_id is not null and settings.staff_answers is not true then
    return jsonb_build_object('ok', false, 'error', 'capability_off');
  end if;
  if booking.location_kind is distinct from 'video' then
    return jsonb_build_object('ok', false, 'error', 'not_video');
  end if;
  -- After the call: it took place in Casevoya, or the consultation was marked attended.
  if booking.status not in ('confirmed', 'completed')
     or (booking.status is distinct from 'completed' and not exists (
       select 1 from public.video_sessions s
       where s.booking_id = booking.id and s.organization_id = p_organization_id and s.started_at is not null
     )) then
    return jsonb_build_object('ok', false, 'error', 'no_call');
  end if;
  if app.sample_mode_blocks_real(p_organization_id, booking.is_sample) then
    return jsonb_build_object('ok', false, 'error', 'sample_only');
  end if;
  select d.id into waiting from public.vo_crm_drafts d
  where d.booking_id = booking.id and d.organization_id = p_organization_id and d.kind = 'call_summary' and d.status = 'draft'
  limit 1;
  if waiting is not null then
    return jsonb_build_object('ok', false, 'error', 'already_drafted', 'draft_id', waiting);
  end if;
  limited := app.vo_rate_limited(p_organization_id);
  if limited is not null then
    return jsonb_build_object('ok', false, 'error', limited);
  end if;

  insert into public.vo_runs (organization_id, user_id, kind, matter_id, thread_id, lead_id, booking_id, is_sample)
  values (p_organization_id, actor, 'call_summary', target_matter, null, linked_lead, booking.id, booking.is_sample)
  returning id into rid;
  perform app.record_audit_event(
    p_organization_id, 'vo.run_started', 'vo_runs', rid, 'success',
    jsonb_build_object('kind', 'call_summary', 'booking_id', booking.id)
  );
  return jsonb_build_object('ok', true, 'run_id', rid, 'booking_id', booking.id, 'lead_id', linked_lead, 'matter_id', target_matter);
end;
$$;
revoke all on function public.begin_vo_call_summary(uuid, uuid) from public, anon;
grant execute on function public.begin_vo_call_summary(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- finish_vo_crm_run
-- ---------------------------------------------------------------------------

create function public.finish_vo_crm_run(
  p_run_id uuid,
  p_result public.vo_run_result,
  p_title text default null,
  p_body text default null,
  p_sources jsonb default null,
  p_model text default null,
  p_prompt_version text default null,
  p_needs_rule boolean default false,
  p_left_out integer default 0,
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
  if run.kind not in ('lead_follow_up', 'call_summary') then
    raise exception 'this is not a lead follow-up or call summary run' using errcode = '22023';
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
  if coalesce(p_left_out, 0) not between 0 and 60 then
    raise exception 'left-out count out of range' using errcode = '22023';
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
  if p_failure is not null and (p_result <> 'failed' or p_failure not in ('unavailable', 'failed', 'empty', 'nothing_to_draft', 'refused')) then
    raise exception 'unknown failure' using errcode = '22023';
  end if;

  -- A run left open too long ends as failed; nothing is saved from it.
  if run.created_at < statement_timestamp() - interval '10 minutes' then
    update public.vo_runs
      set result = 'failed', failure = 'expired', finished_at = clock_timestamp()
      where id = run.id;
    return null;
  end if;

  if p_result = 'drafted' then
    if app.vo_crm_target_readable(run.organization_id, run.lead_id, run.matter_id) is distinct from true then
      raise exception 'vo denied' using errcode = '42501';
    end if;
    if run.kind = 'lead_follow_up' and app.vo_lead_consent(run.organization_id, run.lead_id, 'enquiry_reply') is not true then
      raise exception 'the lead has no consent to be contacted' using errcode = '42501';
    end if;
    if p_model is null or p_prompt_version is null then
      raise exception 'a draft records its model and prompt version' using errcode = '22023';
    end if;
    if p_title is null or length(btrim(p_title)) not between 1 and 200
       or p_body is null or length(btrim(p_body)) not between 1 and 4000 then
      raise exception 'a draft needs a title and 1 to 4000 characters' using errcode = '22023';
    end if;
    if p_sources is null or jsonb_typeof(p_sources) <> 'array' or jsonb_array_length(p_sources) not between 1 and 40 then
      raise exception 'a draft cites 1 to 40 records' using errcode = '22023';
    end if;
    -- Every cited record belongs to this run's own lead, consultation or matter.
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
      if src_kind = 'lead' then
        if run.lead_id is null or src_id::uuid <> run.lead_id then
          raise exception 'a source is outside this lead' using errcode = '42501';
        end if;
      elsif src_kind = 'lead_note' then
        if run.lead_id is null or not exists (
          select 1 from public.lead_notes n
          where n.id = src_id::uuid and n.organization_id = run.organization_id and n.lead_id = run.lead_id
        ) then
          raise exception 'a source is outside this lead' using errcode = '42501';
        end if;
      elsif src_kind = 'booking' then
        if not (
          (run.booking_id is not null and src_id::uuid = run.booking_id)
          or (run.kind = 'lead_follow_up' and exists (
            select 1 from public.lead_booking_links l
            where l.booking_id = src_id::uuid and l.organization_id = run.organization_id and l.lead_id = run.lead_id
          ))
        ) then
          raise exception 'a source is outside this lead' using errcode = '42501';
        end if;
      elsif src_kind = 'matter' then
        if run.matter_id is null or src_id::uuid <> run.matter_id then
          raise exception 'a source is outside this matter' using errcode = '42501';
        end if;
      else
        raise exception 'unknown source kind' using errcode = '22023';
      end if;
      count_sources := count_sources + 1;
    end loop;

    insert into public.vo_crm_drafts (
      organization_id, run_id, kind, lead_id, matter_id, booking_id, title, body, sources, model, prompt_version,
      needs_rule, marketing_consent, left_out, is_sample, created_by
    ) values (
      run.organization_id, run.id, run.kind::text::public.vo_draft_kind, run.lead_id, run.matter_id, run.booking_id,
      btrim(p_title), btrim(p_body), p_sources, p_model, p_prompt_version, coalesce(p_needs_rule, false),
      case when run.kind = 'lead_follow_up' then app.vo_lead_consent(run.organization_id, run.lead_id, 'marketing') end,
      coalesce(p_left_out, 0), run.is_sample, actor
    )
    returning id into did;
  end if;

  update public.vo_runs
    set result = p_result,
        model = p_model,
        prompt_version = p_prompt_version,
        source_count = case when p_result = 'drafted' then count_sources else null end,
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
      'source_count', case when p_result = 'drafted' then count_sources else null end,
      'needs_rule', case when p_result = 'drafted' then coalesce(p_needs_rule, false) else null end,
      'left_out', coalesce(p_left_out, 0),
      'draft_id', did,
      'tools', coalesce(p_tools, '{}'::text[])
    )
  );
  return did;
end;
$$;
revoke all on function public.finish_vo_crm_run(uuid, public.vo_run_result, text, text, jsonb, text, text, boolean, integer, integer, text, text[], integer, integer, numeric) from public, anon;
grant execute on function public.finish_vo_crm_run(uuid, public.vo_run_result, text, text, jsonb, text, text, boolean, integer, integer, text, text[], integer, integer, numeric)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Review: a person decides
-- ---------------------------------------------------------------------------

-- The person sent the reviewed follow-up themselves (by email or phone): the text they sent is
-- recorded as a lead note. Refused while a placeholder is left or once the lead has withdrawn its
-- consent to be contacted.
create function public.mark_vo_lead_follow_up_sent(p_draft_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  draft public.vo_crm_drafts%rowtype;
  text_body text := btrim(coalesce(p_body, ''));
  changed boolean;
  nid uuid;
begin
  select * into draft from public.vo_crm_drafts where id = p_draft_id for update;
  if draft.id is null or actor is null or draft.kind <> 'lead_follow_up' then
    raise exception 'vo denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(draft.organization_id, app.lead_staff_roles(), false);
  if app.vo_crm_target_readable(draft.organization_id, draft.lead_id, null) is distinct from true then
    raise exception 'vo denied' using errcode = '42501';
  end if;
  -- A retried click returns the note it already became.
  if draft.status = 'sent' and draft.reviewed_by = actor then
    return draft.lead_note_id;
  end if;
  if draft.status <> 'draft' then
    raise exception 'this draft was already reviewed' using errcode = '22023';
  end if;
  if length(text_body) not between 1 and 3900 then
    raise exception 'write the follow-up you sent (1 to 3900 characters)' using errcode = '22023';
  end if;
  if position('[needs a sourced rule]' in lower(text_body)) > 0 or position('[needs a consultant]' in lower(text_body)) > 0 then
    raise exception 'replace the [needs a sourced rule] placeholder before sending' using errcode = '22023';
  end if;
  if app.vo_lead_consent(draft.organization_id, draft.lead_id, 'enquiry_reply') is not true then
    raise exception 'the lead has no consent to be contacted' using errcode = '42501';
  end if;
  changed := text_body is distinct from btrim(draft.body);
  nid := public.add_lead_note(
    draft.organization_id, draft.lead_id,
    (case when changed then 'Follow-up sent (drafted with Vo, edited):' else 'Follow-up sent (drafted with Vo):' end) || E'\n' || text_body
  );
  update public.vo_crm_drafts
    set status = 'sent', edited = changed, lead_note_id = nid, reviewed_by = actor,
        reviewed_at = clock_timestamp(), updated_at = clock_timestamp()
    where id = draft.id;
  perform app.record_audit_event(
    draft.organization_id, 'vo.draft_sent', 'vo_crm_drafts', draft.id, 'success',
    jsonb_build_object('kind', draft.kind, 'edited', changed, 'lead_note_id', nid, 'model', draft.model)
  );
  return nid;
end;
$$;
revoke all on function public.mark_vo_lead_follow_up_sent(uuid, text) from public, anon;
grant execute on function public.mark_vo_lead_follow_up_sent(uuid, text) to authenticated, service_role;

-- The person keeps the reviewed summary: a staff note on the lead (or the matter).
create function public.save_vo_call_summary(p_draft_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  draft public.vo_crm_drafts%rowtype;
  text_body text := btrim(coalesce(p_body, ''));
  changed boolean;
  note_text text;
  nid uuid;
begin
  select * into draft from public.vo_crm_drafts where id = p_draft_id for update;
  if draft.id is null or actor is null or draft.kind <> 'call_summary' then
    raise exception 'vo denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(draft.organization_id, app.lead_staff_roles(), false);
  if app.vo_crm_target_readable(draft.organization_id, draft.lead_id, draft.matter_id) is distinct from true then
    raise exception 'vo denied' using errcode = '42501';
  end if;
  if draft.status = 'reviewed' and draft.reviewed_by = actor then
    return coalesce(draft.lead_note_id, draft.matter_note_id);
  end if;
  if draft.status <> 'draft' then
    raise exception 'this draft was already reviewed' using errcode = '22023';
  end if;
  if length(text_body) not between 1 and 3900 then
    raise exception 'write the summary (1 to 3900 characters)' using errcode = '22023';
  end if;
  if position('[needs a sourced rule]' in lower(text_body)) > 0 or position('[needs a consultant]' in lower(text_body)) > 0 then
    raise exception 'replace the [needs a sourced rule] placeholder before saving' using errcode = '22023';
  end if;
  changed := text_body is distinct from btrim(draft.body);
  note_text := (case when changed then 'Video call summary (drafted with Vo, edited):' else 'Video call summary (drafted with Vo):' end) || E'\n' || text_body;
  if draft.lead_id is not null then
    nid := public.add_lead_note(draft.organization_id, draft.lead_id, note_text);
  else
    nid := public.add_matter_staff_note(draft.organization_id, draft.matter_id, note_text);
  end if;
  update public.vo_crm_drafts
    set status = 'reviewed', edited = changed,
        lead_note_id = case when draft.lead_id is not null then nid end,
        matter_note_id = case when draft.lead_id is null then nid end,
        reviewed_by = actor, reviewed_at = clock_timestamp(), updated_at = clock_timestamp()
    where id = draft.id;
  perform app.record_audit_event(
    draft.organization_id, 'vo.draft_saved', 'vo_crm_drafts', draft.id, 'success',
    jsonb_build_object('kind', draft.kind, 'edited', changed, 'note_id', nid, 'on', case when draft.lead_id is not null then 'lead' else 'matter' end, 'model', draft.model)
  );
  return nid;
end;
$$;
revoke all on function public.save_vo_call_summary(uuid, text) from public, anon;
grant execute on function public.save_vo_call_summary(uuid, text) to authenticated, service_role;

create function public.discard_vo_crm_draft(p_draft_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  draft public.vo_crm_drafts%rowtype;
begin
  select * into draft from public.vo_crm_drafts where id = p_draft_id for update;
  if draft.id is null or actor is null then
    raise exception 'vo denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(draft.organization_id, app.lead_staff_roles(), false);
  if app.vo_crm_target_readable(draft.organization_id, draft.lead_id, draft.matter_id) is distinct from true then
    raise exception 'vo denied' using errcode = '42501';
  end if;
  if draft.status <> 'draft' then
    raise exception 'this draft was already reviewed' using errcode = '22023';
  end if;
  update public.vo_crm_drafts
    set status = 'discarded', reviewed_by = actor, reviewed_at = clock_timestamp(), updated_at = clock_timestamp()
    where id = draft.id;
  perform app.record_audit_event(
    draft.organization_id, 'vo.draft_discarded', 'vo_crm_drafts', draft.id, 'success',
    jsonb_build_object('kind', draft.kind, 'model', draft.model)
  );
end;
$$;
revoke all on function public.discard_vo_crm_draft(uuid) from public, anon;
grant execute on function public.discard_vo_crm_draft(uuid) to authenticated, service_role;
