-- DEC-02 (#182) follows the GOV review rules (#220, 20261025220000; Francis delegated to engineering
-- on 2026-10-24, docs/DECISIONS.md).
--
-- 1. Approval without a page snapshot, by attestation, for official follow-up steps after an
--    approval (public.approval_follow_up_steps, #222) and renewal timings (public.renewal_timings,
--    #221). Both refused approval without a snapshot; now the licensed reviewer may approve by
--    attesting they opened the official page themselves on a date (app.gov_check_page_attestation).
--    Stored on the row (who, date, when) and shown as "page not captured by Casevoya, checked by
--    <reviewer> on <date>". The client's renewal reminders (public.portal_renewal_reminders) carry the
--    attestation with the timing so the portal says the same. With a snapshot nothing changes.
-- 2. No self-approval while another active licensed member exists (app.gov_check_self_approval;
--    the sole licensed member needs a step-up after the entry; audited <event>_self) for both reviews
--    and for the conditions summary approval, where the "entry" is the draft as last written: its
--    drafter (drafted_by_membership_id, updated by every revision) and its last save (updated_at).
--
-- Redefined (copied from their latest definitions, changes marked "DEC review rules"):
--   app.review_approval_follow_up_step(uuid, integer, text, text)  from 20261025200000_dec_approval_follow_up.sql
--   app.approve_conditions_summary(uuid, integer)                  from 20261025200000_dec_approval_follow_up.sql
--   app.review_renewal_timing(uuid, integer, text, text)           from 20261025210000_dec_renewal.sql
--   app.portal_renewal_reminders(uuid)                             from 20261025210000_dec_renewal.sql
-- The two four-argument review functions now delegate to new five-argument versions
-- (…, p_page_opened_on date); their public wrappers stay, and new five-argument wrappers are added.
-- Additive: nullable columns, the "approved needs a snapshot" checks relaxed to "a snapshot or an
-- attestation", new functions.

-- ---------------------------------------------------------------------------
-- Attestation columns
-- ---------------------------------------------------------------------------

alter table public.approval_follow_up_steps
  add column page_attested_by_membership_id uuid,
  add column page_attested_on date,
  add column page_attested_at timestamptz,
  add constraint approval_follow_up_steps_attester_fk
    foreign key (page_attested_by_membership_id, organization_id) references public.memberships (id, organization_id),
  add constraint approval_follow_up_steps_attestation_shape check (
    ((page_attested_by_membership_id is null) = (page_attested_on is null))
    and ((page_attested_on is null) = (page_attested_at is null))
    and (page_attested_on is null or snapshot_sha256 is null)
  );
alter table public.approval_follow_up_steps drop constraint approval_follow_up_steps_check3;
alter table public.approval_follow_up_steps
  add constraint approval_follow_up_steps_approved_source check (status <> 'approved' or snapshot_sha256 is not null or page_attested_on is not null);
create index approval_follow_up_steps_attester_org_fk_idx on public.approval_follow_up_steps (page_attested_by_membership_id, organization_id);
comment on column public.approval_follow_up_steps.page_attested_on is
  'When the server had no snapshot of the page: the date the approving licensed member says they opened the official page themselves and found the step matches it. Null when a snapshot exists.';

alter table public.renewal_timings
  add column page_attested_by_membership_id uuid,
  add column page_attested_on date,
  add column page_attested_at timestamptz,
  add constraint renewal_timings_attester_fk
    foreign key (page_attested_by_membership_id, organization_id) references public.memberships (id, organization_id),
  add constraint renewal_timings_attestation_shape check (
    ((page_attested_by_membership_id is null) = (page_attested_on is null))
    and ((page_attested_on is null) = (page_attested_at is null))
    and (page_attested_on is null or snapshot_sha256 is null)
  );
alter table public.renewal_timings drop constraint renewal_timings_check3;
alter table public.renewal_timings
  add constraint renewal_timings_approved_source check (status <> 'approved' or snapshot_sha256 is not null or page_attested_on is not null);
create index renewal_timings_attester_org_fk_idx on public.renewal_timings (page_attested_by_membership_id, organization_id);
comment on column public.renewal_timings.page_attested_on is
  'When the server had no snapshot of the page: the date the approving licensed member says they opened the official page themselves and found the timing matches it. Null when a snapshot exists.';

-- ---------------------------------------------------------------------------
-- Official follow-up steps after an approval
-- ---------------------------------------------------------------------------

-- app.review_approval_follow_up_step, copied from 20261025200000_dec_approval_follow_up.sql.
-- DEC review rules: p_page_opened_on added; the "goes live only with a snapshot" refusal is replaced
-- by the attestation; self-approval checked.
create function app.review_approval_follow_up_step(
  p_step_id uuid, p_expected_version integer, p_decision text, p_note text, p_page_opened_on date
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  step public.approval_follow_up_steps%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  new_version integer;
  reviewer uuid;
  opened date;
  self_approval boolean := false;
begin
  select * into step from public.approval_follow_up_steps where id = p_step_id for update;
  if step.id is null or step.organization_id is distinct from app.current_organization_id() then
    raise exception 'step review denied' using errcode = '42501';
  end if;
  perform app.gov_require_licensed(step.organization_id);
  if step.version is distinct from p_expected_version then
    raise exception 'step version conflict' using errcode = 'PT409';
  end if;
  if step.status <> 'pending_review' then
    raise exception 'nothing is waiting for review' using errcode = '22023';
  end if;
  if p_decision is null or p_decision not in ('approved', 'rejected') then
    raise exception 'unknown decision' using errcode = '22023';
  end if;
  if p_decision = 'rejected' and (v_note is null or length(v_note) < 3) then
    raise exception 'say why it''s rejected' using errcode = '22023';
  end if;
  if p_decision = 'approved' then
    -- DEC review rules: no snapshot needs the reviewer's attestation; own entries only when no one else can review.
    opened := app.gov_check_page_attestation(step.organization_id, step.snapshot_sha256 is not null, p_page_opened_on, step.created_at);
    self_approval := app.gov_check_self_approval(step.organization_id, step.created_by, step.created_at);
  end if;
  reviewer := app.gov_actor_membership(step.organization_id);
  perform app.gov_open_write(step.id);
  update public.approval_follow_up_steps
  set status = p_decision, reviewed_by_membership_id = reviewer,
      reviewed_at = statement_timestamp(), review_note = left(v_note, 500),
      page_attested_by_membership_id = case when opened is null then null else reviewer end,
      page_attested_on = opened,
      page_attested_at = case when opened is null then null else statement_timestamp() end
  where id = step.id
  returning version into new_version;
  perform app.gov_close_write(step.id);
  perform app.record_audit_event(
    step.organization_id, 'decision.follow_up_step_' || p_decision || case when self_approval then '_self' else '' end,
    'public.approval_follow_up_steps', step.id, 'success',
    jsonb_build_object('program_key', step.program_key, 'source_url', step.source_url, 'snapshot_sha256', step.snapshot_sha256,
                       'page_attested_on', opened, 'self_approved', self_approval)
  );
  return new_version;
end;
$$;
revoke all on function app.review_approval_follow_up_step(uuid, integer, text, text, date) from public;
grant execute on function app.review_approval_follow_up_step(uuid, integer, text, text, date) to authenticated, service_role;

create or replace function app.review_approval_follow_up_step(p_step_id uuid, p_expected_version integer, p_decision text, p_note text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  return app.review_approval_follow_up_step(p_step_id, p_expected_version, p_decision, p_note, null::date);
end;
$$;

create function public.review_approval_follow_up_step(p_step_id uuid, p_expected_version integer, p_decision text, p_note text, p_page_opened_on date)
returns integer language sql security invoker set search_path = ''
as $$ select app.review_approval_follow_up_step(p_step_id, p_expected_version, p_decision, p_note, p_page_opened_on); $$;
revoke all on function public.review_approval_follow_up_step(uuid, integer, text, text, date) from public, anon;
grant execute on function public.review_approval_follow_up_step(uuid, integer, text, text, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Conditions summary
-- ---------------------------------------------------------------------------

-- app.approve_conditions_summary, copied from 20261025200000_dec_approval_follow_up.sql.
-- DEC review rules: the person who drafted or last revised the draft approves it only when no other
-- licensed member can (app.gov_check_self_approval on the drafter's user and the draft's last save).
create or replace function app.approve_conditions_summary(p_summary_id uuid, p_expected_version integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  summary public.conditions_summaries%rowtype;
  decision public.decision_records%rowtype;
  earlier uuid;
  next_number integer;
  new_version integer;
  drafter uuid;
  self_approval boolean;
begin
  select * into summary from public.conditions_summaries where id = p_summary_id;
  if summary.id is null or app.can_read_matter(summary.matter_id) is distinct from true then
    raise exception 'approval follow-up denied' using errcode = '42501';
  end if;
  decision := app.dec_open_approved_matter(summary.matter_id, null, true);
  select * into summary from public.conditions_summaries where id = p_summary_id for update;
  if summary.version is distinct from p_expected_version then
    raise exception 'summary version conflict' using errcode = 'PT409';
  end if;
  if summary.status <> 'draft' then
    raise exception 'only a draft is approved' using errcode = '22023';
  end if;
  -- DEC review rules: own draft only when no other licensed member can approve it.
  select mem.user_id into drafter from public.memberships mem where mem.id = summary.drafted_by_membership_id;
  self_approval := app.gov_check_self_approval(summary.organization_id, drafter, summary.updated_at);
  select coalesce(max(other.number), 0) + 1 into next_number
  from public.conditions_summaries other where other.matter_id = summary.matter_id;
  select other.id into earlier
  from public.conditions_summaries other
  where other.matter_id = summary.matter_id and other.status = 'approved';
  if earlier is not null then
    perform app.gov_open_write(earlier);
    update public.conditions_summaries set status = 'superseded', superseded_at = statement_timestamp() where id = earlier;
    perform app.gov_close_write(earlier);
  end if;
  perform app.gov_open_write(summary.id);
  update public.conditions_summaries
  set status = 'approved',
      number = next_number,
      decision_id = decision.id,
      approved_by_membership_id = app.gov_actor_membership(summary.organization_id),
      approved_at = statement_timestamp(),
      body_sha256 = encode(sha256(convert_to(summary.body, 'UTF8')), 'hex')
  where id = summary.id
  returning version into new_version;
  perform app.gov_close_write(summary.id);
  perform app.dec_complete_follow_up(summary.matter_id, 'conditions_summary');
  perform app.record_audit_event(
    summary.organization_id, 'decision.conditions_summary_approved' || case when self_approval then '_self' else '' end,
    'public.conditions_summaries', summary.id, 'success',
    jsonb_build_object('matter_id', summary.matter_id, 'number', next_number, 'supersedes', earlier,
                       'body_sha256', encode(sha256(convert_to(summary.body, 'UTF8')), 'hex'), 'self_approved', self_approval)
  );
  return new_version;
end;
$$;

-- ---------------------------------------------------------------------------
-- Renewal timings
-- ---------------------------------------------------------------------------

-- app.review_renewal_timing, copied from 20261025210000_dec_renewal.sql.
-- DEC review rules: p_page_opened_on added; the "goes live only with a snapshot" refusal is replaced
-- by the attestation; self-approval checked.
create function app.review_renewal_timing(
  p_timing_id uuid, p_expected_version integer, p_decision text, p_note text, p_page_opened_on date
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  timing public.renewal_timings%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  new_version integer;
  reviewer uuid;
  opened date;
  self_approval boolean := false;
begin
  select * into timing from public.renewal_timings where id = p_timing_id for update;
  if timing.id is null or timing.organization_id is distinct from app.current_organization_id() then
    raise exception 'timing review denied' using errcode = '42501';
  end if;
  perform app.require_licensed_staff(timing.organization_id, true);
  if timing.version is distinct from p_expected_version then
    raise exception 'timing version conflict' using errcode = 'PT409';
  end if;
  if timing.status <> 'pending_review' then
    raise exception 'nothing is waiting for review' using errcode = '22023';
  end if;
  if p_decision is null or p_decision not in ('approved', 'rejected') then
    raise exception 'unknown decision' using errcode = '22023';
  end if;
  if p_decision = 'rejected' and (v_note is null or length(v_note) < 3) then
    raise exception 'say why it''s rejected' using errcode = '22023';
  end if;
  if p_decision = 'approved' then
    -- DEC review rules: no snapshot needs the reviewer's attestation; own entries only when no one else can review.
    opened := app.gov_check_page_attestation(timing.organization_id, timing.snapshot_sha256 is not null, p_page_opened_on, timing.created_at);
    self_approval := app.gov_check_self_approval(timing.organization_id, timing.created_by, timing.created_at);
  end if;
  reviewer := app.gov_actor_membership(timing.organization_id);
  perform app.gov_open_write(timing.id);
  update public.renewal_timings
  set status = p_decision,
      reviewed_by_membership_id = reviewer,
      reviewed_at = statement_timestamp(),
      review_note = left(v_note, 500),
      page_attested_by_membership_id = case when opened is null then null else reviewer end,
      page_attested_on = opened,
      page_attested_at = case when opened is null then null else statement_timestamp() end
  where id = timing.id
  returning version into new_version;
  perform app.gov_close_write(timing.id);
  perform app.record_audit_event(
    timing.organization_id, 'decision.renewal_timing_' || p_decision || case when self_approval then '_self' else '' end,
    'public.renewal_timings', timing.id, 'success',
    jsonb_build_object('source_url', timing.source_url, 'snapshot_sha256', timing.snapshot_sha256, 'lead_days', timing.lead_days,
                       'page_attested_on', opened, 'self_approved', self_approval)
  );
  return new_version;
end;
$$;
revoke all on function app.review_renewal_timing(uuid, integer, text, text, date) from public;
grant execute on function app.review_renewal_timing(uuid, integer, text, text, date) to authenticated, service_role;

create or replace function app.review_renewal_timing(p_timing_id uuid, p_expected_version integer, p_decision text, p_note text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  return app.review_renewal_timing(p_timing_id, p_expected_version, p_decision, p_note, null::date);
end;
$$;

create function public.review_renewal_timing(p_timing_id uuid, p_expected_version integer, p_decision text, p_note text, p_page_opened_on date)
returns integer language sql security invoker set search_path = ''
as $$ select app.review_renewal_timing(p_timing_id, p_expected_version, p_decision, p_note, p_page_opened_on); $$;
revoke all on function public.review_renewal_timing(uuid, integer, text, text, date) from public, anon;
grant execute on function public.review_renewal_timing(uuid, integer, text, text, date) to authenticated, service_role;

-- app.portal_renewal_reminders, copied from 20261025210000_dec_renewal.sql.
-- DEC review rules: the timing carries its attestation ('page_attested_on' and the reviewer's name,
-- 'page_attested_by') so the client sees "page not captured by Casevoya, checked by … on …".
create or replace function app.portal_renewal_reminders(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_person uuid;
begin
  if (select auth.uid()) is null or p_org is null or p_org is distinct from app.current_organization_id() then
    return '[]'::jsonb;
  end if;
  select person.id into v_person
  from public.persons person
  where person.organization_id = p_org and person.user_id = (select auth.uid())
  limit 1;
  if v_person is null or not exists (
    select 1 from public.person_contact_preferences pref where pref.person_id = v_person and pref.deadline_reminders
  ) then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', renewal.id,
      'matter_id', renewal.matter_id,
      'document_label', renewal.document_label,
      'expires_on', renewal.expires_on,
      'remind_on', renewal.remind_on,
      'service_scope', renewal.service_scope,
      'timing', case when timing.id is null then null else jsonb_build_object(
        'text', timing.timing_text, 'source_url', timing.source_url, 'checked_on', timing.checked_on,
        'current_to', timing.current_to, 'snapshot_sha256', timing.snapshot_sha256,
        'page_attested_on', timing.page_attested_on,
        'page_attested_by', case when timing.page_attested_on is null then null else coalesce(
          (select nullif(btrim(profile.display_name), '')
           from public.memberships mem join public.profiles profile on profile.id = mem.user_id
           where mem.id = timing.page_attested_by_membership_id),
          'your consultant') end) end,
      'fee', app.renewal_current_fee(renewal.organization_id, renewal.fee_section, renewal.fee_group, renewal.fee_name)
    ) order by renewal.expires_on)
    from public.decision_renewals renewal
    left join public.renewal_timings timing on timing.id = renewal.timing_id
    where renewal.organization_id = p_org
      and renewal.client_person_id = v_person
      and renewal.reminder_set_at is not null
      and renewal.cancelled_at is null
  ), '[]'::jsonb);
end;
$$;
