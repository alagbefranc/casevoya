-- Version conflicts answer at once instead of being retried by the API.
--
-- Stale saves (a row changed since the screen read it) raised SQLSTATE 40001, which is
-- serialization_failure. PostgREST treats 40001 as a transient conflict and retries the whole
-- request; a deterministic version conflict fails the same way every time, so a stale save sat
-- for about two minutes before the API gave up, and the screen never showed its conflict
-- message (Supabase troubleshooting: "SQLSTATE 40001 in an RPC function causes infinite
-- retries"). See also the Documents stale-review report on PR #150.
--
-- Each function that still raised 40001 is redefined from its latest definition with one change:
-- errcode 'PT409', PostgREST's custom code for HTTP 409 Conflict. The message text is the same,
-- so the app's error mapping ("version conflict", "stale ...") is unchanged.
--
-- No table, type, policy or RLS change; grants and comments stay with the redefined functions.

-- app.transition_matter_stage(uuid,public.matter_stage,integer,text), last defined in 20261018100000_owner_licence_gates.sql
create or replace function app.transition_matter_stage(
  p_matter_id uuid,
  p_to_stage public.matter_stage,
  p_expected_version integer,
  p_reason text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  matter public.matters%rowtype;
  evidence uuid;
  override_id uuid;
  new_version integer;
begin
  if (select auth.uid()) is null then
    raise exception 'sign in is required' using errcode = '42501';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'a stage change needs a reason' using errcode = '22023';
  end if;

  select * into matter
  from public.matters
  where id = p_matter_id
  for update;

  if matter.id is null
     or app.in_active_org(matter.organization_id) is distinct from true
     or app.staff_mfa_satisfied() is distinct from true
     or app.can_read_matter(matter.id) is distinct from true
     or app.has_org_role(
       matter.organization_id,
       array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[]
     ) is distinct from true then
    raise exception 'matter stage change denied' using errcode = '42501';
  end if;
  if matter.version is distinct from p_expected_version then
    raise exception 'matter version conflict' using errcode = 'PT409';
  end if;
  if app.matter_stage_is_regulated(matter.stage, p_to_stage)
     and app.actor_is_licensed(matter.organization_id) is distinct from true then
    raise exception 'submitted and later stages require a licensed consultant' using errcode = '42501';
  end if;
  if app.matter_stage_is_regulated(matter.stage, p_to_stage)
     and app.actor_licence_blocks_regulated_action(matter.organization_id) then
    raise exception 'not entitled, revoked, suspended, or inactive licence blocks this consultant action'
      using errcode = '42501';
  end if;
  if app.matter_stage_transition_allowed(matter.stage, p_to_stage) is distinct from true then
    raise exception 'that stage transition is not allowed' using errcode = '42501';
  end if;

  evidence := app.stage_entry_evidence_id(matter.id, p_to_stage);
  if evidence is null then
    select nonce.override_id into override_id
    from app.matter_stage_override_nonce nonce
    where nonce.matter_id = matter.id
      and nonce.txid = txid_current();
    if override_id is null then
      raise exception 'stage entry evidence is missing' using errcode = '42501';
    end if;
  else
    select nonce.override_id into override_id
    from app.matter_stage_override_nonce nonce
    where nonce.matter_id = matter.id
      and nonce.txid = txid_current();
  end if;

  insert into app.matter_stage_transition_nonce (matter_id, txid)
  values (matter.id, txid_current())
  on conflict (matter_id) do update set txid = excluded.txid;

  update public.matters
  set stage = p_to_stage
  where id = matter.id
  returning version into new_version;

  delete from app.matter_stage_transition_nonce where matter_id = matter.id;
  delete from app.matter_stage_override_nonce where matter_id = matter.id;

  insert into public.matter_stage_transitions (
    organization_id, matter_id, from_stage, to_stage, reason, evidence_id, override_id, actor_user_id, from_version
  ) values (
    matter.organization_id,
    matter.id,
    matter.stage,
    p_to_stage,
    btrim(p_reason),
    evidence,
    override_id,
    (select auth.uid()),
    matter.version
  );

  perform app.record_audit_event(
    matter.organization_id,
    case
      when matter.stage = 'closed' and p_to_stage = 'engagement_pending' then 'matter.reopened'
      when override_id is not null then 'matter.stage_override'
      else 'matter.stage_transition'
    end,
    'public.matters',
    matter.id,
    'success',
    jsonb_build_object(
      'from_stage', matter.stage,
      'to_stage', p_to_stage,
      'evidence_id', evidence,
      'override_id', override_id
    )
  );

  if p_to_stage = 'closed' then
    perform app.enqueue_event(
      matter.organization_id,
      'matter',
      matter.id,
      'matter.closed',
      jsonb_build_object('matter_id', matter.id),
      new_version,
      'matter.closed:' || matter.id::text || ':' || matter.version::text
    );
  end if;
  return new_version;
end;
$$;

-- app.assign_responsible_consultant(uuid,uuid,integer), last defined in 20261018100000_owner_licence_gates.sql
create or replace function app.assign_responsible_consultant(
  p_matter_id uuid,
  p_membership_id uuid,
  p_expected_version integer
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  matter public.matters%rowtype;
  cred public.credential_status;
  new_version integer;
  changing boolean;
begin
  select * into matter from public.matters where id = p_matter_id for update;
  if matter.id is null or app.can_read_matter(matter.id) is distinct from true then
    raise exception 'consultant assignment denied' using errcode = '42501';
  end if;
  changing := matter.responsible_consultant_membership_id is not null
    and matter.responsible_consultant_membership_id is distinct from p_membership_id;
  perform app.require_active_staff(
    matter.organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[],
    changing
  );
  if app.sample_mode_blocks_real(matter.organization_id, matter.is_sample) then
    raise exception 'this firm is in sample mode; only sample matters accept new work' using errcode = '42501';
  end if;
  if matter.version is distinct from p_expected_version then
    raise exception 'matter version conflict' using errcode = 'PT409';
  end if;
  if not exists (
    select 1 from public.memberships mem
    where mem.id = p_membership_id
      and mem.organization_id = matter.organization_id
      and app.membership_is_licensed(mem.id)
      and mem.status = 'active'
  ) then
    raise exception 'the responsible consultant must be an active licensed consultant' using errcode = '42501';
  end if;
  select credential.status into cred
  from public.consultant_credentials credential
  where credential.membership_id = p_membership_id
    and credential.organization_id = matter.organization_id;
  if cred is not null and app.licence_status_blocks(cred) then
    raise exception 'not entitled, revoked, suspended, or inactive licence blocks this consultant action'
      using errcode = '42501';
  end if;

  perform app.open_matter_column(matter.id, 'consultant');
  update public.matters
  set responsible_consultant_membership_id = p_membership_id
  where id = matter.id
  returning version into new_version;
  perform app.close_matter_column(matter.id);

  insert into public.matter_participants (organization_id, matter_id, membership_id, role)
  values (matter.organization_id, matter.id, p_membership_id, 'consultant')
  on conflict (matter_id, membership_id, role) do nothing;

  perform app.record_audit_event(
    matter.organization_id,
    'matter.consultant_assigned',
    'public.matters',
    matter.id,
    'success',
    jsonb_build_object('membership_id', p_membership_id, 'replaced', changing)
  );
  return new_version;
end;
$$;

-- app.select_matter_program(uuid,uuid,integer,text), last defined in 20261017170000_matter_lifecycle.sql
create or replace function app.select_matter_program(
  p_matter_id uuid,
  p_rule_pack_version_id uuid,
  p_expected_version integer,
  p_reason text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  matter public.matters%rowtype;
  new_version integer;
  permitted public.org_role;
  changing boolean;
begin
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'program selection needs a reason' using errcode = '22023';
  end if;
  select * into matter from public.matters where id = p_matter_id for update;
  if matter.id is null or app.can_read_matter(matter.id) is distinct from true then
    raise exception 'program selection denied' using errcode = '42501';
  end if;
  changing := matter.program_pack_id is not null and matter.program_pack_id is distinct from p_rule_pack_version_id;
  perform app.require_active_staff(
    matter.organization_id,
    array['firm_owner', 'licensed_consultant']::public.org_role[],
    changing
  );
  if app.sample_mode_blocks_real(matter.organization_id, matter.is_sample) then
    raise exception 'this firm is in sample mode; only sample matters accept new work' using errcode = '42501';
  end if;
  if matter.version is distinct from p_expected_version then
    raise exception 'matter version conflict' using errcode = 'PT409';
  end if;
  if matter.program_pack_id is not distinct from p_rule_pack_version_id then
    raise exception 'that pack is already selected' using errcode = '22023';
  end if;
  if app.pack_is_selectable(p_rule_pack_version_id, matter.organization_id) is distinct from true then
    raise exception 'program selection must be a published pack for a jurisdiction this firm practises'
      using errcode = '42501';
  end if;
  if app.has_org_role(matter.organization_id, array['licensed_consultant']::public.org_role[]) then
    permitted := 'licensed_consultant';
  else
    permitted := 'firm_owner';
  end if;

  if changing or matter.program_pack_id is not null then
    update public.matter_rule_bindings
    set superseded_at = statement_timestamp()
    where matter_id = matter.id
      and superseded_at is null;
  end if;
  insert into public.matter_rule_bindings (organization_id, matter_id, rule_pack_version_id, rationale)
  values (matter.organization_id, matter.id, p_rule_pack_version_id, btrim(p_reason));

  perform app.open_matter_column(matter.id, 'program');
  update public.matters
  set program_pack_id = p_rule_pack_version_id
  where id = matter.id
  returning version into new_version;
  perform app.close_matter_column(matter.id);

  insert into public.matter_program_changes (
    organization_id, matter_id, from_pack_id, to_pack_id, reason, permitted_role, actor_user_id
  ) values (
    matter.organization_id,
    matter.id,
    matter.program_pack_id,
    p_rule_pack_version_id,
    btrim(p_reason),
    permitted,
    (select auth.uid())
  );
  perform app.record_audit_event(
    matter.organization_id,
    'matter.program_selected',
    'public.matters',
    matter.id,
    'success',
    jsonb_build_object('pack_id', p_rule_pack_version_id, 'permitted_role', permitted)
  );
  return new_version;
end;
$$;

-- app.set_matter_on_hold(uuid,integer,text,uuid,date), last defined in 20261017170000_matter_lifecycle.sql
create or replace function app.set_matter_on_hold(
  p_matter_id uuid,
  p_expected_version integer,
  p_reason text,
  p_owner_membership_id uuid,
  p_review_on date
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  matter public.matters%rowtype;
  new_version integer;
begin
  if p_reason is null or length(btrim(p_reason)) not between 3 and 500 or p_review_on is null then
    raise exception 'on hold needs a reason, an owner, and a review date' using errcode = '22023';
  end if;
  select * into matter from public.matters where id = p_matter_id for update;
  if matter.id is null or app.can_read_matter(matter.id) is distinct from true then
    raise exception 'on hold denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    matter.organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[],
    true
  );
  if matter.version is distinct from p_expected_version then
    raise exception 'matter version conflict' using errcode = 'PT409';
  end if;
  if not exists (
    select 1 from public.memberships mem
    where mem.id = p_owner_membership_id
      and mem.organization_id = matter.organization_id
      and mem.status = 'active'
      and mem.role = any (app.staff_roles())
  ) then
    raise exception 'the hold owner must be active staff' using errcode = '42501';
  end if;
  perform app.open_matter_column(matter.id, 'on_hold');
  update public.matters
  set on_hold = true,
      on_hold_reason = btrim(p_reason),
      on_hold_owner_membership_id = p_owner_membership_id,
      on_hold_review_on = p_review_on
  where id = matter.id
  returning version into new_version;
  perform app.close_matter_column(matter.id);
  perform app.record_audit_event(
    matter.organization_id,
    'matter.on_hold_set',
    'public.matters',
    matter.id,
    'success',
    jsonb_build_object('owner_membership_id', p_owner_membership_id, 'review_on', p_review_on)
  );
  return new_version;
end;
$$;

-- app.clear_matter_on_hold(uuid,integer,text), last defined in 20261017170000_matter_lifecycle.sql
create or replace function app.clear_matter_on_hold(
  p_matter_id uuid,
  p_expected_version integer,
  p_reason text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  matter public.matters%rowtype;
  new_version integer;
begin
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'clearing a hold needs a reason' using errcode = '22023';
  end if;
  select * into matter from public.matters where id = p_matter_id for update;
  if matter.id is null or app.can_read_matter(matter.id) is distinct from true then
    raise exception 'on hold denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    matter.organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[],
    true
  );
  if matter.version is distinct from p_expected_version then
    raise exception 'matter version conflict' using errcode = 'PT409';
  end if;
  perform app.open_matter_column(matter.id, 'on_hold');
  update public.matters
  set on_hold = false,
      on_hold_reason = null,
      on_hold_owner_membership_id = null,
      on_hold_review_on = null
  where id = matter.id
  returning version into new_version;
  perform app.close_matter_column(matter.id);
  perform app.record_audit_event(
    matter.organization_id,
    'matter.on_hold_cleared',
    'public.matters',
    matter.id,
    'success',
    jsonb_build_object('reason_length', length(btrim(p_reason)))
  );
  return new_version;
end;
$$;

-- app.record_government_status(uuid,public.government_status,integer,text), last defined in 20261017170000_matter_lifecycle.sql
create or replace function app.record_government_status(
  p_matter_id uuid,
  p_status public.government_status,
  p_expected_version integer,
  p_note text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  matter public.matters%rowtype;
  new_version integer;
begin
  if p_note is null or length(btrim(p_note)) < 3 then
    raise exception 'a government status needs a note' using errcode = '22023';
  end if;
  select * into matter from public.matters where id = p_matter_id for update;
  if matter.id is null or app.can_read_matter(matter.id) is distinct from true then
    raise exception 'government status denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    matter.organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[],
    true
  );
  if matter.version is distinct from p_expected_version then
    raise exception 'matter version conflict' using errcode = 'PT409';
  end if;
  perform app.open_matter_column(matter.id, 'government');
  update public.matters set government_status = p_status where id = matter.id returning version into new_version;
  perform app.close_matter_column(matter.id);
  perform app.record_audit_event(
    matter.organization_id,
    'matter.government_status_recorded',
    'public.matters',
    matter.id,
    'success',
    jsonb_build_object('government_status', p_status, 'stage', matter.stage)
  );
  return new_version;
end;
$$;

-- app.record_matter_outcome(uuid,public.matter_outcome,integer,text), last defined in 20261018100000_owner_licence_gates.sql
create or replace function app.record_matter_outcome(
  p_matter_id uuid,
  p_outcome public.matter_outcome,
  p_expected_version integer,
  p_note text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  matter public.matters%rowtype;
  new_version integer;
begin
  if p_note is null or length(btrim(p_note)) < 3 then
    raise exception 'an outcome needs a note' using errcode = '22023';
  end if;
  select * into matter from public.matters where id = p_matter_id for update;
  if matter.id is null or app.can_read_matter(matter.id) is distinct from true then
    raise exception 'outcome denied' using errcode = '42501';
  end if;
  perform app.require_licensed_staff(matter.organization_id, true);
  if app.actor_licence_blocks_regulated_action(matter.organization_id) then
    raise exception 'not entitled, revoked, suspended, or inactive licence blocks this consultant action'
      using errcode = '42501';
  end if;
  if matter.version is distinct from p_expected_version then
    raise exception 'matter version conflict' using errcode = 'PT409';
  end if;
  if app.stage_entry_evidence_id(matter.id, 'decision_review') is null then
    raise exception 'an outcome needs official decision evidence' using errcode = '42501';
  end if;
  perform app.open_matter_column(matter.id, 'outcome');
  update public.matters set outcome = p_outcome where id = matter.id returning version into new_version;
  perform app.close_matter_column(matter.id);
  perform app.record_audit_event(
    matter.organization_id,
    'matter.outcome_recorded',
    'public.matters',
    matter.id,
    'success',
    jsonb_build_object('outcome', p_outcome, 'stage', matter.stage, 'government_status', matter.government_status)
  );
  return new_version;
end;
$$;

-- app.record_matter_retention(uuid,integer,date,text), last defined in 20261017170000_matter_lifecycle.sql
create or replace function app.record_matter_retention(
  p_matter_id uuid,
  p_expected_version integer,
  p_retention_on date,
  p_reason text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  matter public.matters%rowtype;
  new_version integer;
begin
  if p_retention_on is null or p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'a retention date needs a reason' using errcode = '22023';
  end if;
  select * into matter from public.matters where id = p_matter_id for update;
  if matter.id is null or app.can_read_matter(matter.id) is distinct from true then
    raise exception 'retention denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    matter.organization_id,
    array['firm_owner', 'licensed_consultant']::public.org_role[],
    true
  );
  if matter.version is distinct from p_expected_version then
    raise exception 'matter version conflict' using errcode = 'PT409';
  end if;
  perform app.open_matter_column(matter.id, 'retention');
  update public.matters set retention_on = p_retention_on where id = matter.id returning version into new_version;
  perform app.close_matter_column(matter.id);
  perform app.record_audit_event(
    matter.organization_id,
    'matter.retention_recorded',
    'public.matters',
    matter.id,
    'success',
    jsonb_build_object('retention_on', p_retention_on)
  );
  return new_version;
end;
$$;

-- app.submit_intake_response(uuid,integer), last defined in 20261017170100_intake_responses.sql
create or replace function app.submit_intake_response(p_response_id uuid, p_expected_version integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  response public.intake_responses%rowtype;
  template public.intake_templates%rowtype;
  field jsonb;
  latest public.intake_answer_versions%rowtype;
  snap uuid;
  snap_number integer;
  new_version integer;
  matter_sample boolean;
begin
  select * into response from public.intake_responses where id = p_response_id for update;
  if response.id is null or app.intake_caller_can_write(response) is distinct from true then
    raise exception 'intake submit denied' using errcode = '42501';
  end if;
  if response.status is distinct from 'draft' or response.frozen_at is not null then
    raise exception 'that intake response is already submitted' using errcode = '42501';
  end if;
  if response.version is distinct from p_expected_version then
    raise exception 'intake version conflict' using errcode = 'PT409';
  end if;
  select matter.is_sample into matter_sample from public.matters matter where matter.id = response.matter_id;
  if app.sample_mode_blocks_real(response.organization_id, matter_sample) then
    raise exception 'this firm is in sample mode; only sample matters accept new work' using errcode = '42501';
  end if;
  select * into template from public.intake_templates where id = response.template_id;

  for field in select value from jsonb_array_elements(template.schema -> 'fields')
  loop
    if coalesce(field ->> 'required', 'false') = 'true'
       and app.intake_field_visible(field, response.id) then
      select * into latest
      from public.intake_answer_versions answer
      where answer.response_id = response.id
        and answer.field_key = field ->> 'key'
      order by answer.created_at desc
      limit 1;
      if latest.id is null then
        raise exception 'a required intake answer is missing' using errcode = '22023';
      end if;
    end if;
  end loop;

  select coalesce(max(snapshot_number), 0) + 1 into snap_number
  from public.intake_snapshots
  where response_id = response.id;
  insert into public.intake_snapshots (organization_id, response_id, snapshot_number)
  values (response.organization_id, response.id, snap_number)
  returning id into snap;

  insert into public.intake_snapshot_answers (
    organization_id, snapshot_id, field_key, section_key, presence, normalized_value,
    date_kind, calendar_date, year_value, month_value, source_answer_id
  )
  select distinct on (answer.field_key)
    response.organization_id,
    snap,
    answer.field_key,
    answer.section_key,
    answer.presence,
    answer.normalized_value,
    answer.date_kind,
    answer.calendar_date,
    answer.year_value,
    answer.month_value,
    answer.id
  from public.intake_answer_versions answer
  where answer.response_id = response.id
  order by answer.field_key, answer.created_at desc;

  update public.intake_responses
  set status = 'submitted',
      submitted_at = statement_timestamp()
  where id = response.id
  returning version into new_version;

  perform app.enqueue_event(
    response.organization_id,
    'intake_response',
    response.id,
    'intake.submitted',
    jsonb_build_object(
      'response_id', response.id,
      'matter_id', response.matter_id,
      'template_id', response.template_id,
      'snapshot_id', snap
    ),
    new_version,
    'intake.submitted:' || response.id::text || ':' || snap_number::text
  );
  return new_version;
end;
$$;

-- app.set_task_status(uuid,integer,public.task_status,text), last defined in 20261017170200_tasks_deadlines.sql
create or replace function app.set_task_status(
  p_task_id uuid,
  p_expected_version integer,
  p_status public.task_status,
  p_blocker_note text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  task public.tasks%rowtype;
  new_version integer;
begin
  select * into task from public.tasks where id = p_task_id for update;
  if task.id is null or app.can_read_task(task.id) is distinct from true then
    raise exception 'task update denied' using errcode = '42501';
  end if;
  if task.audience = 'client' and exists (
    select 1 from public.persons person
    where person.id = task.owner_person_id and person.user_id = (select auth.uid())
  ) then
    if p_status not in ('done', 'open') then
      raise exception 'a client can complete their own task' using errcode = '42501';
    end if;
  else
    perform app.require_active_staff(
      task.organization_id,
      array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[],
      false
    );
  end if;
  if task.version is distinct from p_expected_version then
    raise exception 'task version conflict' using errcode = 'PT409';
  end if;
  if p_status = 'done' and exists (
    select 1
    from public.task_dependencies dep
    join public.tasks earlier on earlier.id = dep.depends_on_task_id
    where dep.task_id = task.id
      and earlier.status in ('open', 'blocked')
  ) then
    raise exception 'a task with an open dependency cannot be completed' using errcode = '42501';
  end if;
  if p_status = 'blocked' and (p_blocker_note is null or length(btrim(p_blocker_note)) < 1) then
    raise exception 'a blocked task needs a blocker note' using errcode = '22023';
  end if;

  perform app.open_task_write(task.id);
  update public.tasks
  set status = p_status,
      blocker_note = case when p_status = 'blocked' then btrim(p_blocker_note) else null end,
      completed_at = case when p_status = 'done' then statement_timestamp() else null end
  where id = task.id
  returning version into new_version;
  perform app.close_task_write(task.id);

  if p_status in ('done', 'cancelled') then
    update public.reminder_schedules
    set status = 'cancelled'
    where status = 'pending'
      and (
        task_id = task.id
        or deadline_id in (select deadline.id from public.deadlines deadline where deadline.task_id = task.id)
      );
  end if;

  insert into public.task_events (
    organization_id, task_id, event_kind, from_status, to_status, actor_user_id
  ) values (
    task.organization_id, task.id, 'status', task.status, p_status, (select auth.uid())
  );
  return new_version;
end;
$$;

-- app.reassign_task(uuid,integer,uuid,uuid), last defined in 20261017170200_tasks_deadlines.sql
create or replace function app.reassign_task(
  p_task_id uuid,
  p_expected_version integer,
  p_owner_membership_id uuid,
  p_owner_person_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  task public.tasks%rowtype;
  new_version integer;
begin
  select * into task from public.tasks where id = p_task_id for update;
  if task.id is null or app.can_read_task(task.id) is distinct from true then
    raise exception 'task reassignment denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    task.organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[],
    true
  );
  if task.version is distinct from p_expected_version then
    raise exception 'task version conflict' using errcode = 'PT409';
  end if;
  if task.audience = 'internal' and not exists (
    select 1 from public.memberships mem
    where mem.id = p_owner_membership_id
      and mem.organization_id = task.organization_id
      and mem.status = 'active'
      and mem.role = any (app.staff_roles())
  ) then
    raise exception 'an internal task needs an active staff owner' using errcode = '42501';
  end if;
  if task.audience = 'client' and not exists (
    select 1 from public.persons person
    where person.id = p_owner_person_id and person.organization_id = task.organization_id
  ) then
    raise exception 'a client task needs a person on this matter' using errcode = '42501';
  end if;

  perform app.open_task_write(task.id);
  update public.tasks
  set owner_membership_id = case when task.audience = 'internal' then p_owner_membership_id else null end,
      owner_person_id = case when task.audience = 'client' then p_owner_person_id else null end
  where id = task.id
  returning version into new_version;
  perform app.close_task_write(task.id);

  insert into public.task_events (
    organization_id, task_id, event_kind, from_membership_id, to_membership_id, actor_user_id
  ) values (
    task.organization_id,
    task.id,
    'reassigned',
    task.owner_membership_id,
    case when task.audience = 'internal' then p_owner_membership_id else null end,
    (select auth.uid())
  );
  perform app.enqueue_event(
    task.organization_id,
    'task',
    task.id,
    'task.reassigned',
    jsonb_build_object('task_id', task.id, 'matter_id', task.matter_id),
    new_version,
    'task.reassigned:' || task.id::text || ':' || new_version::text
  );
  return new_version;
end;
$$;

-- app.confirm_deadline(uuid,integer), last defined in 20261018100000_owner_licence_gates.sql
create or replace function app.confirm_deadline(p_deadline_id uuid, p_expected_version integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  deadline public.deadlines%rowtype;
  verifier uuid;
  new_version integer;
begin
  select * into deadline from public.deadlines where id = p_deadline_id for update;
  if deadline.id is null or app.can_read_matter(deadline.matter_id) is distinct from true then
    raise exception 'deadline confirmation denied' using errcode = '42501';
  end if;
  if deadline.version is distinct from p_expected_version then
    raise exception 'deadline version conflict' using errcode = 'PT409';
  end if;
  if deadline.kind in ('legal', 'correspondence') then
    perform app.require_licensed_staff(deadline.organization_id, true);
    if app.actor_licence_blocks_regulated_action(deadline.organization_id) then
      raise exception 'not entitled, revoked, suspended, or inactive licence blocks this consultant action'
        using errcode = '42501';
    end if;
    if deadline.source_url is null and deadline.rule_version_id is null then
      raise exception 'a legal or correspondence date stays tentative without an official source or published rule'
        using errcode = '42501';
    end if;
    perform app.assert_deadline_source(deadline.source_url, deadline.source_retrieved_on, deadline.rule_version_id);
  else
    perform app.require_active_staff(
      deadline.organization_id,
      array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[],
      true
    );
  end if;
  select mem.id into verifier
  from public.memberships mem
  where mem.organization_id = deadline.organization_id
    and mem.user_id = (select auth.uid())
    and mem.status = 'active'
    and mem.role = any (app.staff_roles())
  limit 1;
  update public.deadlines
  set verification = 'confirmed',
      verifying_membership_id = verifier
  where id = deadline.id
  returning version into new_version;
  perform app.record_audit_event(
    deadline.organization_id,
    'deadline.confirmed',
    'public.deadlines',
    deadline.id,
    'success',
    jsonb_build_object('kind', deadline.kind, 'rule_version_id', deadline.rule_version_id)
  );
  return new_version;
end;
$$;

-- app.revise_deadline_due(uuid,integer,date,timestamptz,text), last defined in 20261017170200_tasks_deadlines.sql
create or replace function app.revise_deadline_due(
  p_deadline_id uuid,
  p_expected_version integer,
  p_due_on date,
  p_due_at timestamptz,
  p_timezone text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  deadline public.deadlines%rowtype;
  new_version integer;
begin
  if p_due_on is null and p_due_at is null then
    raise exception 'a deadline needs a date or an instant' using errcode = '22023';
  end if;
  select * into deadline from public.deadlines where id = p_deadline_id for update;
  if deadline.id is null or app.can_read_matter(deadline.matter_id) is distinct from true then
    raise exception 'deadline revision denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    deadline.organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[],
    true
  );
  if deadline.version is distinct from p_expected_version then
    raise exception 'deadline version conflict' using errcode = 'PT409';
  end if;
  update public.deadlines
  set due_on = p_due_on,
      due_at = p_due_at,
      timezone = app.usable_timezone(p_timezone),
      verification = 'tentative',
      verifying_membership_id = null
  where id = deadline.id
  returning version into new_version;
  perform app.schedule_deadline_reminders(deadline.id, statement_timestamp());
  return new_version;
end;
$$;

-- app.review_document_version(uuid,integer,public.document_review_decision,text,text), last defined in 20261017180100_document_requests.sql
create or replace function app.review_document_version(
  p_version_id uuid,
  p_expected_version integer,
  p_decision public.document_review_decision,
  p_reason text,
  p_annotations text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  version public.document_versions%rowtype;
  older record;
  new_version integer;
begin
  select * into version from public.document_versions where id = p_version_id for update;
  if version.id is null or app.can_read_document_version(version.id) is distinct from true then
    raise exception 'document review denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    version.organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[],
    true
  );
  if version.version is distinct from p_expected_version then
    raise exception 'document version conflict' using errcode = 'PT409';
  end if;
  if version.upload_state is distinct from 'clean' then
    raise exception 'quarantined or unfinished uploads cannot be accepted evidence' using errcode = '42501';
  end if;
  if p_reason is null or length(btrim(p_reason)) not between 3 and 2000 then
    raise exception 'a review reason is required' using errcode = '22023';
  end if;

  perform app.open_document_write(version.id);
  update public.document_versions
  set review_state = case
        when p_decision = 'accepted' then 'accepted'::public.document_review_state
        else 'rejected'::public.document_review_state
      end
  where id = version.id
  returning public.document_versions.version into new_version;
  perform app.close_document_write(version.id);

  if p_decision = 'accepted' and version.translation_of_version_id is null then
    for older in
      select older_version.id
      from public.document_versions older_version
      where older_version.document_id = version.document_id
        and older_version.id <> version.id
        and older_version.review_state = 'accepted'
        and older_version.superseded_at is null
        and older_version.translation_of_version_id is null
    loop
      perform app.open_document_write(older.id);
      update public.document_versions
      set superseded_at = statement_timestamp()
      where id = older.id;
      perform app.close_document_write(older.id);
    end loop;
  end if;

  insert into public.document_reviews (
    organization_id, version_id, decision, reason, annotations, created_by
  ) values (
    version.organization_id,
    version.id,
    p_decision,
    btrim(p_reason),
    nullif(btrim(p_annotations), ''),
    (select auth.uid())
  );

  if p_decision = 'accepted' and version.request_id is not null and app.request_version_satisfies(version.id) then
    perform app.open_document_write(version.request_id);
    update public.document_requests
    set status = 'fulfilled'
    where id = version.request_id
      and status = 'open';
    perform app.close_document_write(version.request_id);
  end if;

  perform app.enqueue_event(
    version.organization_id, 'document', version.document_id, 'document.reviewed',
    jsonb_build_object(
      'document_id', version.document_id,
      'version_id', version.id,
      'decision', p_decision
    ),
    new_version,
    'document.reviewed:' || version.id::text || ':' || new_version::text,
    null
  );
  perform app.record_audit_event(
    version.organization_id, 'document.reviewed', 'document_versions', version.id, 'success',
    jsonb_build_object('decision', p_decision)
  );
  return new_version;
end;
$$;

-- app.waive_document_request(uuid,integer,text), last defined in 20261017180100_document_requests.sql
create or replace function app.waive_document_request(
  p_request_id uuid,
  p_expected_version integer,
  p_reason text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  request public.document_requests%rowtype;
  new_version integer;
begin
  select * into request from public.document_requests where id = p_request_id for update;
  if request.id is null or app.can_read_matter(request.matter_id) is distinct from true then
    raise exception 'document request denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    request.organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[],
    true
  );
  if request.version is distinct from p_expected_version then
    raise exception 'document version conflict' using errcode = 'PT409';
  end if;
  if p_reason is null or length(btrim(p_reason)) not between 3 and 2000 then
    raise exception 'a waiver reason is required' using errcode = '22023';
  end if;
  perform app.open_document_write(request.id);
  update public.document_requests
  set status = 'waived',
      waiver_reason = btrim(p_reason)
  where id = request.id
  returning public.document_requests.version into new_version;
  perform app.close_document_write(request.id);
  perform app.record_audit_event(
    request.organization_id, 'document.request_waived', 'document_requests', request.id, 'success',
    '{}'::jsonb
  );
  return new_version;
end;
$$;

-- app.set_document_expiry(uuid,integer,date), last defined in 20261017180100_document_requests.sql
create or replace function app.set_document_expiry(
  p_version_id uuid,
  p_expected_version integer,
  p_expires_on date
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  version public.document_versions%rowtype;
  new_version integer;
begin
  select * into version from public.document_versions where id = p_version_id for update;
  if version.id is null or app.can_read_document_version(version.id) is distinct from true then
    raise exception 'document review denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    version.organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[],
    true
  );
  if version.version is distinct from p_expected_version then
    raise exception 'document version conflict' using errcode = 'PT409';
  end if;
  perform app.open_document_write(version.id);
  update public.document_versions
  set expires_on = p_expires_on
  where id = version.id
  returning public.document_versions.version into new_version;
  perform app.close_document_write(version.id);
  if version.request_id is not null then
    perform app.open_document_write(version.request_id);
    update public.document_requests
    set expires_on = p_expires_on,
        status = case
          when status = 'fulfilled' and not app.request_version_satisfies(version.id) then 'open'::public.document_request_status
          else status
        end
    where id = version.request_id;
    perform app.close_document_write(version.request_id);
  end if;
  return new_version;
end;
$$;

-- public.save_booking_event_type(uuid,uuid,integer,text,text,text,integer,integer,integer,integer,integer,integer,integer,public.booking_location_kind,text,uuid[],boolean), last defined in 20261019190000_booking_practice_pages.sql
create or replace function public.save_booking_event_type(
  p_org uuid,
  p_event_type_id uuid,
  p_expected_version integer,
  p_title text,
  p_slug text,
  p_description text,
  p_duration_min integer,
  p_slot_step_min integer,
  p_buffer_before_min integer,
  p_buffer_after_min integer,
  p_min_notice_min integer,
  p_max_advance_days integer,
  p_daily_capacity integer,
  p_location_kind public.booking_location_kind,
  p_location_detail text,
  p_host_membership_ids uuid[],
  p_publish boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  sample boolean;
  et public.booking_event_types%rowtype;
  hosts uuid[] := coalesce(p_host_membership_ids, array[]::uuid[]);
  v_slug text := lower(btrim(coalesce(p_slug, '')));
  rid uuid;
  i integer;
begin
  perform app.require_firm_owner_step_up(p_org);
  if array_length(hosts, 1) is not null and (
       array_length(hosts, 1) > 20
       or (select count(distinct x) from unnest(hosts) x) <> array_length(hosts, 1)
       or exists (
         select 1 from unnest(hosts) x
         where not exists (
           select 1 from public.memberships m
           where m.id = x and m.organization_id = p_org and m.status = 'active'
             and m.role = any (app.scheduling_staff_roles())
         )
       )) then
    raise exception 'choose active staff as hosts' using errcode = '22023';
  end if;
  if coalesce(p_publish, false) and array_length(hosts, 1) is null then
    raise exception 'a published booking type needs a host' using errcode = '22023';
  end if;
  select org.sample_mode into sample from public.organizations org where org.id = p_org;
  if p_location_kind = 'meeting_link' and coalesce(btrim(p_location_detail), '') !~ '^https://[^\s]+$' then
    raise exception 'a meeting link must start with https://' using errcode = '22023';
  end if;

  if p_event_type_id is null then
    insert into public.booking_event_types (
      organization_id, slug, title, description, duration_min, slot_step_min, buffer_before_min, buffer_after_min,
      min_notice_min, max_advance_days, daily_capacity, location_kind, location_detail, is_published, is_sample
    ) values (
      p_org, v_slug, btrim(coalesce(p_title, '')), nullif(btrim(coalesce(p_description, '')), ''), p_duration_min, p_slot_step_min,
      coalesce(p_buffer_before_min, 0), coalesce(p_buffer_after_min, 0), coalesce(p_min_notice_min, 1440),
      coalesce(p_max_advance_days, 60), p_daily_capacity, coalesce(p_location_kind, 'video'),
      nullif(btrim(coalesce(p_location_detail, '')), ''), coalesce(p_publish, false), coalesce(sample, false)
    )
    returning id into rid;
  else
    select * into et from public.booking_event_types where id = p_event_type_id and organization_id = p_org for update;
    if et.id is null then
      raise exception 'booking type not found' using errcode = 'P0002';
    end if;
    if p_expected_version is not null and et.version <> p_expected_version then
      raise exception 'this booking type was changed by someone else; reload' using errcode = 'PT409';
    end if;
    update public.booking_event_types
       set slug = v_slug,
           title = btrim(coalesce(p_title, '')),
           description = nullif(btrim(coalesce(p_description, '')), ''),
           duration_min = p_duration_min,
           slot_step_min = p_slot_step_min,
           buffer_before_min = coalesce(p_buffer_before_min, 0),
           buffer_after_min = coalesce(p_buffer_after_min, 0),
           min_notice_min = coalesce(p_min_notice_min, 1440),
           max_advance_days = coalesce(p_max_advance_days, 60),
           daily_capacity = p_daily_capacity,
           location_kind = coalesce(p_location_kind, 'video'),
           location_detail = nullif(btrim(coalesce(p_location_detail, '')), ''),
           is_published = coalesce(p_publish, false)
     where id = et.id;
    rid := et.id;
  end if;

  delete from public.booking_event_type_hosts host
   where host.event_type_id = rid and not (host.membership_id = any (hosts));
  for i in 1 .. coalesce(array_length(hosts, 1), 0) loop
    insert into public.booking_event_type_hosts (organization_id, event_type_id, membership_id, position)
    values (p_org, rid, hosts[i], i)
    on conflict (event_type_id, membership_id) do update set position = excluded.position;
  end loop;

  -- practice booking pages: the audit row says whether the published page is a practice page.
  perform app.record_audit_event(p_org, 'booking_type.saved', 'public.booking_event_types', rid, 'success',
    jsonb_build_object('published', coalesce(p_publish, false), 'hosts', coalesce(array_length(hosts, 1), 0),
                       'practice', (select t.is_sample from public.booking_event_types t where t.id = rid)));
  return rid;
end;
$$;

-- public.staff_cancel_booking(uuid,uuid,text,integer), last defined in 20261019180100_scheduling_core.sql
create or replace function public.staff_cancel_booking(p_org uuid, p_booking_id uuid, p_reason text, p_expected_version integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.bookings%rowtype;
begin
  perform app.require_active_staff(p_org, app.scheduling_staff_roles(), false);
  select * into b from public.bookings where id = p_booking_id and organization_id = p_org for update;
  if b.id is null then
    raise exception 'booking not found' using errcode = 'P0002';
  end if;
  if p_expected_version is not null and b.version <> p_expected_version then
    raise exception 'this booking was changed by someone else; reload' using errcode = 'PT409';
  end if;
  if b.status not in ('held', 'pending_payment', 'confirmed') then
    raise exception 'this booking cannot be cancelled' using errcode = '22023';
  end if;
  update public.bookings
     set status = 'cancelled', cancelled_at = now(), cancelled_by = 'staff',
         cancel_reason = nullif(left(btrim(coalesce(p_reason, '')), 500), ''), hold_expires_at = null
   where id = b.id;
  insert into public.booking_events (organization_id, booking_id, kind, actor, actor_user_id, payload)
  values (b.organization_id, b.id, 'cancelled', 'staff', (select auth.uid()), '{}'::jsonb);
  if b.status = 'confirmed' and b.starts_at > now() then
    perform app.booking_outbox(b.organization_id, b.id, 'booking.cancelled',
      jsonb_build_object('booking_id', b.id, 'starts_at', b.starts_at), 'booking-cancelled-email:' || b.id::text);
  end if;
  perform app.booking_audit(b.organization_id, 'booking.cancelled', b.id, 'success', jsonb_build_object('by', 'staff'));
end;
$$;

-- app.lead_for_update(uuid,uuid,integer), last defined in 20261019201200_lead_functions.sql
create or replace function app.lead_for_update(p_org uuid, p_lead uuid, p_expected_version integer)
returns public.leads
language plpgsql
security definer
set search_path = ''
as $$
declare
  lead public.leads%rowtype;
begin
  perform app.require_active_staff(p_org, app.lead_staff_roles(), false);
  select * into lead from public.leads where id = p_lead and organization_id = p_org for update;
  if lead.id is null then
    raise exception 'lead not found' using errcode = 'P0002';
  end if;
  if p_expected_version is not null and lead.version <> p_expected_version then
    raise exception 'lead changed by someone else' using errcode = 'PT409';
  end if;
  return lead;
end;
$$;

-- app.sign_off_submission_handoff(uuid,integer), last defined in 20261019216100_firm_today_rules.sql
create or replace function app.sign_off_submission_handoff(p_handoff_id uuid, p_expected_version integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  handoff public.submission_handoffs%rowtype;
  reviewer uuid;
  new_version integer;
begin
  select * into handoff from public.submission_handoffs where id = p_handoff_id for update;
  if handoff.id is null or app.can_read_matter(handoff.matter_id) is distinct from true then
    raise exception 'sign-off denied' using errcode = '42501';
  end if;
  perform app.gov_require_licensed(handoff.organization_id);
  if handoff.version is distinct from p_expected_version then
    raise exception 'submission handoff version conflict' using errcode = 'PT409';
  end if;
  if handoff.status is distinct from 'awaiting_signoff' then
    raise exception 'this handoff is not waiting for sign-off' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.representation_authorities authority
    where authority.matter_id = handoff.matter_id
      and authority.organization_id = handoff.organization_id
      and authority.revoked_at is null
      and authority.effective_on <= app.firm_today(handoff.organization_id)
  ) then
    raise exception 'representation authority must be on file before sign-off' using errcode = '42501';
  end if;
  reviewer := app.gov_actor_membership(handoff.organization_id);
  perform app.gov_open_write(handoff.id);
  update public.submission_handoffs
  set status = 'authorized', signoff_membership_id = reviewer, signed_off_at = statement_timestamp()
  where id = handoff.id
  returning version into new_version;
  perform app.gov_close_write(handoff.id);
  perform app.record_audit_event(
    handoff.organization_id, 'submission.signed_off', 'public.submission_handoffs', handoff.id, 'success',
    jsonb_build_object('matter_id', handoff.matter_id, 'package_label', handoff.package_label, 'package_sha256', handoff.package_sha256)
  );
  return new_version;
end;
$$;

-- app.record_submission(uuid,integer,text,timestamptz,uuid,uuid,text,date), last defined in 20261019202100_government_handoff_decisions.sql
create or replace function app.record_submission(
  p_handoff_id uuid,
  p_expected_version integer,
  p_external_reference text,
  p_submitted_at timestamptz,
  p_submitted_by_membership_id uuid,
  p_receipt_version_id uuid,
  p_receipt_locator text,
  p_acknowledged_on date
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  handoff public.submission_handoffs%rowtype;
  new_version integer;
begin
  select * into handoff from public.submission_handoffs where id = p_handoff_id for update;
  if handoff.id is null or app.can_read_matter(handoff.matter_id) is distinct from true then
    raise exception 'submission record denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    handoff.organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[],
    true
  );
  if handoff.version is distinct from p_expected_version then
    raise exception 'submission handoff version conflict' using errcode = 'PT409';
  end if;
  if handoff.status is distinct from 'authorized' then
    raise exception 'a submission is recorded only after consultant sign-off' using errcode = '42501';
  end if;
  if p_external_reference is null or length(btrim(p_external_reference)) not between 1 and 200 then
    raise exception 'the submission reference is required' using errcode = '22023';
  end if;
  if p_submitted_at is null or p_submitted_at > statement_timestamp() + interval '5 minutes' then
    raise exception 'the submission time is required and cannot be in the future' using errcode = '22023';
  end if;
  if p_submitted_at < handoff.signed_off_at - interval '1 day' then
    raise exception 'the submission time is before the consultant sign-off' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.memberships mem
    where mem.id = p_submitted_by_membership_id
      and mem.organization_id = handoff.organization_id
      and app.membership_is_licensed(mem.id)
  ) then
    raise exception 'the submitting representative must be a licensed member of this firm' using errcode = '42501';
  end if;
  perform app.gov_open_write(handoff.id);
  update public.submission_handoffs
  set status = 'submission_unverified',
      external_reference = btrim(p_external_reference),
      submitted_at = p_submitted_at,
      submitted_by_membership_id = p_submitted_by_membership_id
  where id = handoff.id
  returning version into new_version;
  perform app.gov_close_write(handoff.id);
  perform app.record_audit_event(
    handoff.organization_id, 'submission.recorded', 'public.submission_handoffs', handoff.id, 'success',
    jsonb_build_object('matter_id', handoff.matter_id, 'submitted_by', p_submitted_by_membership_id)
  );
  if p_receipt_version_id is not null or nullif(btrim(coalesce(p_receipt_locator, '')), '') is not null then
    new_version := app.gov_finish_verification(handoff.id, p_receipt_version_id, p_receipt_locator, p_acknowledged_on);
  elsif p_acknowledged_on is not null then
    raise exception 'an acknowledgement date needs the receipt' using errcode = '22023';
  end if;
  return new_version;
end;
$$;

-- app.verify_submission_receipt(uuid,integer,uuid,text,date), last defined in 20261019202100_government_handoff_decisions.sql
create or replace function app.verify_submission_receipt(
  p_handoff_id uuid,
  p_expected_version integer,
  p_receipt_version_id uuid,
  p_receipt_locator text,
  p_acknowledged_on date
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  handoff public.submission_handoffs%rowtype;
begin
  select * into handoff from public.submission_handoffs where id = p_handoff_id for update;
  if handoff.id is null or app.can_read_matter(handoff.matter_id) is distinct from true then
    raise exception 'submission verification denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    handoff.organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[],
    true
  );
  if handoff.version is distinct from p_expected_version then
    raise exception 'submission handoff version conflict' using errcode = 'PT409';
  end if;
  if handoff.status is distinct from 'submission_unverified' then
    raise exception 'only an unverified submission takes a receipt' using errcode = '42501';
  end if;
  return app.gov_finish_verification(handoff.id, p_receipt_version_id, p_receipt_locator, p_acknowledged_on);
end;
$$;

-- app.cancel_submission_handoff(uuid,integer,text), last defined in 20261019202100_government_handoff_decisions.sql
create or replace function app.cancel_submission_handoff(p_handoff_id uuid, p_expected_version integer, p_reason text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  handoff public.submission_handoffs%rowtype;
  new_version integer;
begin
  if p_reason is null or length(btrim(p_reason)) not between 3 and 500 then
    raise exception 'cancelling a handoff needs a reason' using errcode = '22023';
  end if;
  select * into handoff from public.submission_handoffs where id = p_handoff_id for update;
  if handoff.id is null or app.can_read_matter(handoff.matter_id) is distinct from true then
    raise exception 'submission handoff denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    handoff.organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[],
    false
  );
  if handoff.version is distinct from p_expected_version then
    raise exception 'submission handoff version conflict' using errcode = 'PT409';
  end if;
  if handoff.status not in ('awaiting_signoff', 'authorized') then
    raise exception 'a recorded submission is not cancelled; record what happened instead' using errcode = '42501';
  end if;
  perform app.gov_open_write(handoff.id);
  update public.submission_handoffs
  set status = 'cancelled', cancelled_at = statement_timestamp(), cancel_reason = btrim(p_reason)
  where id = handoff.id
  returning version into new_version;
  perform app.gov_close_write(handoff.id);
  perform app.record_audit_event(
    handoff.organization_id, 'submission.handoff_cancelled', 'public.submission_handoffs', handoff.id, 'success',
    jsonb_build_object('matter_id', handoff.matter_id)
  );
  return new_version;
end;
$$;

-- app.verify_government_correspondence(uuid,integer), last defined in 20261019202100_government_handoff_decisions.sql
create or replace function app.verify_government_correspondence(p_correspondence_id uuid, p_expected_version integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  letter public.government_correspondence%rowtype;
  new_version integer;
begin
  select * into letter from public.government_correspondence where id = p_correspondence_id for update;
  if letter.id is null or app.can_read_matter(letter.matter_id) is distinct from true then
    raise exception 'verification denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    letter.organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[],
    true
  );
  if letter.version is distinct from p_expected_version then
    raise exception 'correspondence version conflict' using errcode = 'PT409';
  end if;
  if letter.verified_at is not null then
    raise exception 'this letter is already verified' using errcode = '42501';
  end if;
  if letter.evidence_version_id is null and letter.evidence_locator is null then
    raise exception 'a letter is verified against its evidence; attach it first' using errcode = '42501';
  end if;
  perform app.gov_open_write(letter.id);
  update public.government_correspondence
  set verified_by_membership_id = app.gov_actor_membership(letter.organization_id),
      verified_at = statement_timestamp()
  where id = letter.id
  returning version into new_version;
  perform app.gov_close_write(letter.id);
  if letter.kind = 'acknowledgement' then
    if (select government_status from public.matters where id = letter.matter_id) = 'not_recorded' then
      perform app.gov_set_matter_status(letter.matter_id, 'receipt_on_file');
    end if;
  elsif letter.kind in ('request', 'procedural_fairness') then
    perform app.gov_set_matter_status(letter.matter_id, 'additional_request_open');
  elsif letter.kind in ('application_number', 'biometrics_instruction', 'status_update') then
    if (select government_status from public.matters where id = letter.matter_id) in ('not_recorded', 'receipt_on_file') then
      perform app.gov_set_matter_status(letter.matter_id, 'processing_reported');
    end if;
  elsif letter.kind = 'decision' then
    perform app.gov_set_matter_status(letter.matter_id, 'decision_evidence_on_file');
    insert into public.matter_stage_evidence (organization_id, matter_id, kind, summary)
    values (
      letter.organization_id, letter.matter_id, 'official_decision',
      'Verified decision letter received ' || to_char(letter.received_on, 'YYYY-MM-DD')
    );
  end if;
  perform app.record_audit_event(
    letter.organization_id, 'government.correspondence_verified', 'public.government_correspondence', letter.id, 'success',
    jsonb_build_object('matter_id', letter.matter_id, 'kind', letter.kind)
  );
  return new_version;
end;
$$;

-- app.confirm_decision(uuid,integer,text,text), last defined in 20261019202100_government_handoff_decisions.sql
create or replace function app.confirm_decision(
  p_decision_id uuid,
  p_expected_version integer,
  p_consultant_interpretation text,
  p_next_steps text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  decision public.decision_records%rowtype;
  matter public.matters%rowtype;
  evidence uuid;
  owner uuid;
  new_version integer;
begin
  if p_next_steps is null or length(btrim(p_next_steps)) not between 3 and 4000 then
    raise exception 'write the reviewed next steps' using errcode = '22023';
  end if;
  select * into decision from public.decision_records where id = p_decision_id for update;
  if decision.id is null or app.can_read_matter(decision.matter_id) is distinct from true then
    raise exception 'decision confirmation denied' using errcode = '42501';
  end if;
  perform app.gov_require_licensed(decision.organization_id);
  if decision.version is distinct from p_expected_version then
    raise exception 'decision version conflict' using errcode = 'PT409';
  end if;
  if decision.state is distinct from 'awaiting_confirmation' then
    raise exception 'this decision is already confirmed' using errcode = '42501';
  end if;
  select * into matter from public.matters where id = decision.matter_id for update;
  insert into public.matter_stage_evidence (organization_id, matter_id, kind, summary)
  values (
    decision.organization_id, decision.matter_id, 'outcome_and_follow_up',
    left('Consultant-confirmed ' || decision.outcome::text || '. Next steps: ' || btrim(p_next_steps), 500)
  )
  returning id into evidence;
  perform app.gov_open_write(decision.id);
  update public.decision_records
  set state = 'confirmed',
      consultant_interpretation = nullif(btrim(coalesce(p_consultant_interpretation, '')), ''),
      next_steps = btrim(p_next_steps),
      confirmed_by_membership_id = app.gov_actor_membership(decision.organization_id),
      confirmed_at = statement_timestamp(),
      stage_evidence_id = evidence
  where id = decision.id
  returning * into decision;
  perform app.gov_close_write(decision.id);
  new_version := decision.version;

  perform app.open_matter_column(matter.id, 'outcome');
  update public.matters set outcome = decision.outcome where id = matter.id;
  perform app.close_matter_column(matter.id);

  owner := coalesce(matter.responsible_consultant_membership_id, app.gov_actor_membership(matter.organization_id));
  if decision.outcome = 'approved' and not exists (
    select 1 from public.decision_follow_ups follow
    join public.decision_records other on other.id = follow.decision_id
    where other.matter_id = matter.id and follow.kind = 'conditions_summary'
  ) then
    perform app.gov_follow_up(decision, 'conditions_summary', 'Send consultant-approved conditions summary to the client', owner, 'normal', null, null);
    perform app.gov_follow_up(decision, 'document_delivery', 'Record document delivery', owner, 'normal', null, null);
    perform app.gov_follow_up(decision, 'closure_checklist', 'Closure checklist', owner, 'normal', null, null);
  elsif decision.outcome = 'refused' then
    perform app.gov_follow_up(decision, 'client_explanation', 'Explain the decision to the client', owner, 'high', null, null);
    perform app.gov_follow_up(decision, 'next_steps_meeting', 'Decide next steps with the client (new linked matter if any)', owner, 'high', null, null);
    perform app.gov_follow_up(decision, 'account_reconciliation', 'Reconcile the client account', owner, 'normal', null, null);
  elsif decision.outcome <> 'approved' then
    perform app.gov_follow_up(decision, 'client_explanation', 'Explain the outcome to the client', owner, 'high', null, null);
    perform app.gov_follow_up(decision, 'account_reconciliation', 'Reconcile the client account', owner, 'normal', null, null);
    perform app.gov_follow_up(decision, 'closure_checklist', 'Closure checklist', owner, 'normal', null, null);
  end if;

  perform app.record_audit_event(
    decision.organization_id, 'decision.confirmed', 'public.decision_records', decision.id, 'success',
    jsonb_build_object('matter_id', matter.id, 'outcome', decision.outcome, 'milestone', decision.milestone, 'stage_evidence_id', evidence)
  );
  return new_version;
end;
$$;

-- app.save_intake_draft(text,text,jsonb,uuid,integer), last defined in 20261019204200_intake_builder.sql
create or replace function app.save_intake_draft(
  p_stable_key text,
  p_title text,
  p_schema jsonb,
  p_template_id uuid,
  p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid := app.current_organization_id();
  draft public.intake_templates%rowtype;
  latest public.intake_templates%rowtype;
  next_number integer;
  new_id uuid;
  new_version integer;
begin
  if org is null then
    raise exception 'intake template denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    org,
    array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[],
    false
  );
  if p_stable_key is null or p_stable_key !~ '^[a-z][a-z0-9_]{1,80}$' then
    raise exception 'intake template key is not usable' using errcode = '22023';
  end if;
  if p_title is null or length(btrim(p_title)) not between 1 and 200 then
    raise exception 'intake template title is required' using errcode = '22023';
  end if;
  if app.intake_schema_ok(p_schema) is distinct from true then
    raise exception 'intake schema is not usable' using errcode = '22023';
  end if;

  if p_template_id is not null then
    select * into draft
    from public.intake_templates t
    where t.id = p_template_id and t.organization_id = org
    for update;
    if draft.id is null or draft.stable_key is distinct from p_stable_key then
      raise exception 'intake template denied' using errcode = '42501';
    end if;
    if draft.status is distinct from 'draft' then
      raise exception 'a published intake form is never changed; edit it as a new draft' using errcode = '42501';
    end if;
    if draft.version is distinct from p_expected_version then
      raise exception 'intake version conflict' using errcode = 'PT409';
    end if;
    update public.intake_templates
       set schema = p_schema, title = btrim(p_title)
     where id = draft.id
    returning id, version into new_id, new_version;
  else
    if exists (
      select 1 from public.intake_templates t
      where t.organization_id = org and t.stable_key = p_stable_key and t.status = 'draft'
    ) then
      raise exception 'intake version conflict' using errcode = 'PT409';
    end if;
    select * into latest
    from public.intake_templates t
    where t.organization_id = org and t.stable_key = p_stable_key
    order by t.version_number desc
    limit 1;
    select coalesce(max(t.version_number), 0) + 1 into next_number
    from public.intake_templates t
    where t.organization_id = org and t.stable_key = p_stable_key;
    insert into public.intake_templates (
      organization_id, stable_key, version_number, status, locale, title, workflow_category,
      schema, rule_pack_version_id
    ) values (
      org,
      p_stable_key,
      next_number,
      'draft',
      coalesce(latest.locale, 'en-CA'),
      btrim(p_title),
      coalesce(latest.workflow_category, 'unspecified'),
      p_schema,
      latest.rule_pack_version_id
    )
    returning id, version into new_id, new_version;
  end if;

  perform app.record_audit_event(
    org,
    'intake_template.draft_saved',
    'public.intake_templates',
    new_id,
    'success',
    jsonb_build_object('stable_key', p_stable_key, 'fields', jsonb_array_length(p_schema -> 'fields'))
  );
  return jsonb_build_object('id', new_id, 'version', new_version);
end;
$$;

-- app.publish_intake_draft(uuid,integer), last defined in 20261019204200_intake_builder.sql
create or replace function app.publish_intake_draft(p_template_id uuid, p_expected_version integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid := app.current_organization_id();
  draft public.intake_templates%rowtype;
  reviewer uuid;
  zone text;
begin
  if org is null then
    raise exception 'intake template denied' using errcode = '42501';
  end if;
  perform app.require_licensed_staff(org, true);
  select * into draft
  from public.intake_templates t
  where t.id = p_template_id and t.organization_id = org
  for update;
  if draft.id is null then
    raise exception 'intake template denied' using errcode = '42501';
  end if;
  if draft.status is distinct from 'draft' then
    raise exception 'only a draft can be published' using errcode = '22023';
  end if;
  if draft.version is distinct from p_expected_version then
    raise exception 'intake version conflict' using errcode = 'PT409';
  end if;
  select mem.id into reviewer
  from public.memberships mem
  where mem.organization_id = org
    and mem.user_id = (select auth.uid())
    and mem.status = 'active'
    and app.membership_is_licensed(mem.id)
  limit 1;
  if reviewer is null then
    raise exception 'publishing an intake template requires a licensed consultant' using errcode = '42501';
  end if;
  select coalesce(o.timezone, 'America/Toronto') into zone from public.organizations o where o.id = org;

  update public.intake_templates
     set status = 'superseded'
   where organization_id = org
     and stable_key = draft.stable_key
     and status = 'published';

  update public.intake_templates
     set status = 'published',
         effective_on = (statement_timestamp() at time zone zone)::date,
         reviewer_membership_id = reviewer,
         published_at = statement_timestamp()
   where id = draft.id;

  perform app.record_audit_event(
    org,
    'intake_template.published',
    'public.intake_templates',
    draft.id,
    'success',
    jsonb_build_object('stable_key', draft.stable_key, 'version_number', draft.version_number)
  );
  return draft.id;
end;
$$;

-- public.close_matter(uuid,integer,text,text), last defined in 20261019205100_matter_records_exports_closure.sql
create or replace function public.close_matter(
  p_matter_id uuid,
  p_expected_version integer,
  p_reason text,
  p_override_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  matter public.matters%rowtype;
  org public.organizations%rowtype;
  blockers jsonb;
  override text := nullif(btrim(coalesce(p_override_reason, '')), '');
  keep_years integer;
  closed_on date;
  custodian uuid;
  evidence uuid;
  closure_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'sign in is required' using errcode = '42501';
  end if;
  select * into matter from public.matters where id = p_matter_id for update;
  if matter.id is null
     or matter.organization_id is distinct from (select app.current_organization_id())
     or app.in_active_org(matter.organization_id) is distinct from true
     or app.staff_mfa_satisfied() is distinct from true
     or app.can_read_matter(matter.id) is distinct from true
     or app.has_org_role(matter.organization_id, array['firm_owner', 'licensed_consultant']::public.org_role[]) is distinct from true then
    raise exception 'matter closure denied' using errcode = '42501';
  end if;
  if p_reason is null or length(btrim(p_reason)) not between 3 and 500 then
    raise exception 'a closure needs a reason' using errcode = '22023';
  end if;
  if matter.version is distinct from p_expected_version then
    raise exception 'matter version conflict' using errcode = 'PT409';
  end if;
  if matter.stage <> 'post_decision' then
    raise exception 'a matter closes from the post-decision stage' using errcode = '22023';
  end if;
  select * into org from public.organizations where id = matter.organization_id;
  if org.sample_mode and not matter.is_sample then
    raise exception 'this firm is in sample mode; only sample matters accept new work' using errcode = '42501';
  end if;
  if org.retention_policy is null or (org.retention_policy ->> 'unit') is distinct from 'years' then
    raise exception 'set the firm retention period before closing a matter' using errcode = '22023';
  end if;
  keep_years := (org.retention_policy ->> 'count')::integer;

  blockers := app.matter_closure_blockers(matter.id);
  if app.closure_blocked(blockers) then
    if override is null then
      raise exception 'closure blocked: client funds are held or pending, or an issued invoice is unpaid' using errcode = '22023';
    end if;
    if length(override) < 10 then
      raise exception 'a reviewed reason needs at least 10 characters' using errcode = '22023';
    end if;
    if app.has_org_role(matter.organization_id, array['firm_owner']::public.org_role[]) is distinct from true then
      raise exception 'only the firm owner can close a matter with money still open' using errcode = '42501';
    end if;
    if app.mfa_step_up_satisfied() is distinct from true then
      raise exception 'step-up is required' using errcode = '42501';
    end if;
  elsif override is not null then
    raise exception 'there is nothing open to override' using errcode = '22023';
  end if;

  closed_on := app.firm_local_date(matter.organization_id, now());
  select coalesce(matter.responsible_consultant_membership_id, (
    select mem.id from public.memberships mem
    where mem.organization_id = matter.organization_id and mem.user_id = (select auth.uid()) and mem.status = 'active'
    limit 1
  )) into custodian;

  insert into public.matter_stage_evidence (organization_id, matter_id, kind, summary)
  values (matter.organization_id, matter.id, 'closure', left('Closure recorded: ' || btrim(p_reason), 500))
  returning id into evidence;

  insert into public.matter_closures (
    organization_id, matter_id, closed_on, closed_by, reason, blockers, override_reason,
    retention_policy, retention_years, retention_on, retention_review_required, custodian_membership_id,
    legal_hold_active, evidence_id
  ) values (
    matter.organization_id, matter.id, closed_on, (select auth.uid()), btrim(p_reason), blockers, override,
    org.retention_policy, keep_years, (closed_on + make_interval(years => keep_years))::date, true, custodian,
    app.matter_on_legal_hold(matter.id), evidence
  )
  returning id into closure_id;

  perform app.transition_matter_stage(matter.id, 'closed', p_expected_version, btrim(p_reason));

  perform app.open_matter_column(matter.id, 'retention');
  update public.matters set retention_on = (closed_on + make_interval(years => keep_years))::date where id = matter.id;

  perform app.record_audit_event(matter.organization_id, 'matter.closure_recorded', 'public.matter_closures', closure_id, 'success',
    jsonb_build_object('matter_id', matter.id, 'retention_years', keep_years, 'overridden', override is not null,
      'retention_review_required', true));
  return closure_id;
end;
$$;

-- public.review_document_version_fr(uuid,integer,public.document_review_decision,text,text,text,boolean,text), last defined in 20261019210000_french_drafts.sql
create or replace function public.review_document_version_fr(
  p_version_id uuid,
  p_expected_version integer,
  p_decision public.document_review_decision,
  p_reason text,
  p_annotations text,
  p_reason_fr text,
  p_machine_drafted boolean,
  p_model text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  new_version integer;
  review public.document_reviews%rowtype;
begin
  if p_reason_fr is null or length(btrim(p_reason_fr)) not between 3 and 2000 then
    raise exception 'a French reason is required' using errcode = '22023';
  end if;
  if p_machine_drafted is null or (p_machine_drafted and (p_model is null or p_model !~ '^@cf/[a-z0-9._/-]{3,120}$')) then
    raise exception 'say whether the French was machine-drafted, and by which model' using errcode = '22023';
  end if;
  -- Same checks as an English-only review (staff role, staff MFA, step-up, version, clean file).
  new_version := app.review_document_version(p_version_id, p_expected_version, p_decision, p_reason, p_annotations);

  select * into review
  from public.document_reviews r
  where r.version_id = p_version_id
    and r.created_by = actor
    and r.created_at = now()
  order by r.id
  limit 1;
  if review.id is null then
    raise exception 'the review was not recorded' using errcode = 'PT409';
  end if;

  insert into public.document_review_translations (
    organization_id, review_id, version_id, language, reason, machine_drafted, model, created_by
  ) values (
    review.organization_id, review.id, review.version_id, 'fr-CA', btrim(p_reason_fr),
    p_machine_drafted, case when p_machine_drafted then p_model end, actor
  );

  perform app.record_audit_event(
    review.organization_id, 'document.review_translated', 'document_reviews', review.id, 'success',
    jsonb_build_object(
      'languages', jsonb_build_array('en-CA', 'fr-CA'),
      'machine_drafted', p_machine_drafted,
      'model', case when p_machine_drafted then p_model end,
      'reviewed_by', actor
    )
  );
  return new_version;
end;
$$;

-- public.set_firm_retention_policy(uuid,integer,integer), last defined in 20261019213000_firm_retention_policy_versions.sql
create or replace function public.set_firm_retention_policy(
  p_organization_id uuid,
  p_years integer,
  p_expected_version integer
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  org public.organizations%rowtype;
  actor uuid := (select auth.uid());
  latest integer;
  current_version integer;
  setup_by uuid;
  setup_at timestamptz;
  previous integer;
  next_version integer;
begin
  if actor is null then
    raise exception 'sign in is required' using errcode = '42501';
  end if;
  if p_organization_id is null or p_organization_id is distinct from (select app.current_organization_id()) then
    raise exception 'firm owner step-up is required' using errcode = '42501';
  end if;
  perform app.require_firm_owner_step_up(p_organization_id);
  if p_years is null or p_years not between 1 and 100 then
    raise exception 'retention is a firm-chosen number of years from 1 to 100' using errcode = '22023';
  end if;

  select * into org from public.organizations where id = p_organization_id for update;
  select coalesce(max(v.version), 0) into latest
    from public.retention_policy_versions v
   where v.organization_id = p_organization_id;

  -- A period saved in firm setup (no version on it yet) becomes its own version first.
  if org.retention_policy is not null and (org.retention_policy ->> 'version') is null then
    select step.completed_by, step.completed_at into setup_by, setup_at
      from public.organization_setup_steps step
     where step.organization_id = p_organization_id
       and step.step = 'records_and_retention';
    current_version := latest + 1;
  else
    current_version := latest;
  end if;

  if p_expected_version is distinct from current_version then
    raise exception 'retention policy version conflict' using errcode = 'PT409';
  end if;

  previous := case when org.retention_policy is null then null else (org.retention_policy ->> 'count')::integer end;
  if previous is not distinct from p_years then
    raise exception 'that is already the firm retention period' using errcode = '22023';
  end if;

  if current_version > latest then
    insert into public.retention_policy_versions (organization_id, version, unit, period_count, source, approved_by, approved_at)
    values (p_organization_id, current_version, 'years', previous, 'firm_setup', coalesce(setup_by, actor), coalesce(setup_at, org.updated_at));
  end if;

  next_version := current_version + 1;
  insert into public.retention_policy_versions (organization_id, version, unit, period_count, source, approved_by, approved_at)
  values (p_organization_id, next_version, 'years', p_years, 'settings', actor, statement_timestamp());

  update public.organizations
     set retention_policy = jsonb_build_object('unit', 'years', 'count', p_years, 'version', next_version)
   where id = p_organization_id;

  perform app.record_audit_event(
    p_organization_id,
    'firm.retention_policy_changed',
    'public.retention_policy_versions',
    null,
    'success',
    jsonb_build_object('from_years', previous, 'to_years', p_years, 'version', next_version)
  );
  return next_version;
end;
$$;

-- public.archive_booking_event_type(uuid,uuid,integer), last defined in 20261019235000_leads_calendar_fixes.sql
create or replace function public.archive_booking_event_type(p_org uuid, p_event_type_id uuid, p_expected_version integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  et public.booking_event_types%rowtype;
  upcoming integer;
begin
  perform app.require_firm_owner_step_up(p_org);
  select * into et from public.booking_event_types where id = p_event_type_id and organization_id = p_org for update;
  if et.id is null then
    raise exception 'booking type not found' using errcode = 'P0002';
  end if;
  if p_expected_version is not null and et.version <> p_expected_version then
    raise exception 'this booking type was changed by someone else; reload' using errcode = 'PT409';
  end if;
  if et.archived_at is not null then
    raise exception 'this booking type is already archived' using errcode = '22023';
  end if;
  select count(*) into upcoming from public.bookings b
  where b.event_type_id = et.id and b.status in ('held', 'pending_payment', 'confirmed') and b.starts_at > now();
  update public.booking_event_types set is_published = false, archived_at = now() where id = et.id;
  perform app.record_audit_event(p_org, 'booking_type.archived', 'public.booking_event_types', et.id, 'success',
    jsonb_build_object('was_published', et.is_published, 'upcoming_bookings', upcoming));
end;
$$;

-- app.attach_correspondence_evidence(uuid,integer,uuid,text), last defined in 20261020130000_work_pages_fixes.sql
create or replace function app.attach_correspondence_evidence(
  p_correspondence_id uuid,
  p_expected_version integer,
  p_evidence_version_id uuid,
  p_evidence_locator text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  letter public.government_correspondence%rowtype;
  locator text := nullif(btrim(coalesce(p_evidence_locator, '')), '');
  new_version integer;
begin
  select * into letter from public.government_correspondence where id = p_correspondence_id for update;
  if letter.id is null or app.can_read_matter(letter.matter_id) is distinct from true then
    raise exception 'correspondence denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(letter.organization_id, app.gov_staff_roles(), false);
  if letter.version is distinct from p_expected_version then
    raise exception 'correspondence version conflict' using errcode = 'PT409';
  end if;
  if letter.verified_at is not null then
    raise exception 'this letter is already verified' using errcode = '42501';
  end if;
  if letter.evidence_version_id is not null or letter.evidence_locator is not null then
    raise exception 'this letter already has its evidence' using errcode = '42501';
  end if;
  if p_evidence_version_id is null and locator is null then
    raise exception 'attach the letter file or say where it is kept' using errcode = '22023';
  end if;
  if locator is not null and length(locator) > 300 then
    raise exception 'say where it is kept in up to 300 characters' using errcode = '22023';
  end if;
  if p_evidence_version_id is not null
     and app.gov_evidence_on_matter(p_evidence_version_id, letter.matter_id, letter.organization_id) is distinct from true then
    raise exception 'the letter must be a stored file on this matter' using errcode = '42501';
  end if;
  perform app.gov_open_write(letter.id);
  update public.government_correspondence
  set evidence_version_id = p_evidence_version_id,
      evidence_locator = locator
  where id = letter.id
  returning version into new_version;
  perform app.gov_close_write(letter.id);
  perform app.record_audit_event(
    letter.organization_id, 'government.correspondence_evidence_attached', 'public.government_correspondence', letter.id, 'success',
    jsonb_build_object('matter_id', letter.matter_id, 'kind', letter.kind, 'file', p_evidence_version_id is not null)
  );
  return new_version;
end;
$$;

-- app.update_task(uuid,integer,text,date,public.task_priority), last defined in 20261020130000_work_pages_fixes.sql
create or replace function app.update_task(
  p_task_id uuid,
  p_expected_version integer,
  p_title text,
  p_due_on date,
  p_priority public.task_priority
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  task public.tasks%rowtype;
  new_version integer;
begin
  if p_title is null or length(btrim(p_title)) not between 1 and 200 then
    raise exception 'a task title is required' using errcode = '22023';
  end if;
  select * into task from public.tasks where id = p_task_id for update;
  if task.id is null or app.can_read_task(task.id) is distinct from true then
    raise exception 'task update denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    task.organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[],
    false
  );
  if task.version is distinct from p_expected_version then
    raise exception 'task version conflict' using errcode = 'PT409';
  end if;
  if task.status not in ('open', 'blocked') then
    raise exception 'only an open task can be edited' using errcode = '42501';
  end if;
  if p_due_on is not null and p_due_on is distinct from task.due_on
     and p_due_on < app.firm_today(task.organization_id) then
    raise exception 'a due date cannot be in the past' using errcode = '22023';
  end if;
  if btrim(p_title) = task.title and p_due_on is not distinct from task.due_on
     and coalesce(p_priority, task.priority) = task.priority then
    return task.version;
  end if;
  perform app.open_task_write(task.id);
  update public.tasks
  set title = btrim(p_title),
      due_on = p_due_on,
      due_at = case when p_due_on is distinct from task.due_on then null else due_at end,
      priority = coalesce(p_priority, task.priority)
  where id = task.id
  returning version into new_version;
  perform app.close_task_write(task.id);
  perform app.record_audit_event(
    task.organization_id, 'task.updated', 'public.tasks', task.id, 'success',
    jsonb_build_object('matter_id', task.matter_id, 'due_on', p_due_on, 'priority', coalesce(p_priority, task.priority))
  );
  return new_version;
end;
$$;

-- app.reschedule_booking(uuid,uuid,timestamptz,integer,public.booking_actor,boolean), last defined in 20261020150000_portal_appointment_actions.sql
create or replace function app.reschedule_booking(
  p_org uuid,
  p_booking_id uuid,
  p_start timestamptz,
  p_expected_version integer,
  p_actor public.booking_actor,
  p_enforce_notice boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.bookings%rowtype;
  et public.booking_event_types%rowtype;
  schedule uuid;
  local_start timestamp;
  ends timestamptz;
  day_count integer;
begin
  select * into b from public.bookings where id = p_booking_id and organization_id = p_org for update;
  if b.id is null then
    raise exception 'booking not found' using errcode = 'P0002';
  end if;
  if p_expected_version is not null and b.version <> p_expected_version then
    raise exception 'this booking was changed by someone else; reload' using errcode = 'PT409';
  end if;
  if b.status <> 'confirmed' or b.starts_at <= now() then
    raise exception 'only an upcoming confirmed booking can be moved' using errcode = '22023';
  end if;
  select * into et from public.booking_event_types where id = b.event_type_id;
  if p_start is null or p_start <= now() or date_trunc('minute', p_start) <> p_start or p_start = b.starts_at then
    raise exception 'slot_unavailable' using errcode = 'P0001';
  end if;
  -- portal appointments: a client may not move a booking to inside the type's minimum notice.
  if p_enforce_notice and p_start < now() + make_interval(mins => et.min_notice_min) then
    raise exception 'slot_unavailable' using errcode = 'P0001';
  end if;
  ends := p_start + (b.ends_at - b.starts_at);
  schedule := app.host_schedule(b.host_membership_id);
  local_start := p_start at time zone b.host_time_zone;
  if schedule is null
     or (extract(hour from local_start) * 60 + extract(minute from local_start))::integer % coalesce(et.slot_step_min, et.duration_min) <> 0
     or local_start::date > (now() at time zone b.host_time_zone)::date + et.max_advance_days
     or not app.schedule_covers(schedule, p_start, ends)
     or exists (
       select 1 from public.external_busy_blocks x
       where x.membership_id = b.host_membership_id
         and tstzrange(x.starts_at, x.ends_at, '[)')
             && tstzrange(p_start - make_interval(mins => et.buffer_before_min), ends + make_interval(mins => et.buffer_after_min), '[)')
     ) then
    raise exception 'slot_unavailable' using errcode = 'P0001';
  end if;
  if et.daily_capacity is not null then
    perform pg_advisory_xact_lock(hashtextextended(
      'casevoya.booking_day:' || et.id::text || ':' || b.host_user_id::text || ':' || (local_start::date)::text, 0));
    select count(*) into day_count from public.bookings x
    where x.event_type_id = et.id and x.host_user_id = b.host_user_id and x.id <> b.id
      and x.status in ('held', 'pending_payment', 'confirmed', 'completed', 'no_show')
      and (x.starts_at at time zone b.host_time_zone)::date = local_start::date;
    if day_count >= et.daily_capacity then
      raise exception 'slot_unavailable' using errcode = 'P0001';
    end if;
  end if;
  begin
    update public.bookings
       set starts_at = p_start,
           ends_at = ends,
           blocked_from = p_start - make_interval(mins => et.buffer_before_min),
           blocked_until = ends + make_interval(mins => et.buffer_after_min),
           ics_sequence = b.ics_sequence + 1
     where id = b.id;
  exception when exclusion_violation then
    raise exception 'slot_unavailable' using errcode = 'P0001';
  end;
  insert into public.booking_events (organization_id, booking_id, kind, actor, actor_user_id, payload)
  values (b.organization_id, b.id, 'rescheduled', p_actor, (select auth.uid()),
          jsonb_build_object('from', b.starts_at, 'to', p_start, 'sequence', b.ics_sequence + 1));
  -- portal appointments: a sample booking moved by its client sends no email.
  if not (b.is_sample and p_actor = 'client') then
    perform app.booking_outbox(b.organization_id, b.id, 'booking.rescheduled',
      jsonb_build_object('booking_id', b.id, 'starts_at', p_start, 'sequence', b.ics_sequence + 1),
      'booking-rescheduled-email:' || b.id::text || ':' || (b.ics_sequence + 1)::text);
  end if;
  perform app.booking_audit(b.organization_id, 'booking.rescheduled', b.id, 'success',
    jsonb_build_object('from', b.starts_at, 'to', p_start, 'by', p_actor::text));
end;
$$;

-- public.portal_cancel_booking(uuid,uuid,integer,text), last defined in 20261020150000_portal_appointment_actions.sql
create or replace function public.portal_cancel_booking(
  p_org uuid,
  p_booking_id uuid,
  p_expected_version integer,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.bookings%rowtype;
  notice integer;
  late boolean;
begin
  select * into b from public.bookings where id = p_booking_id and organization_id = p_org for update;
  if b.id is null or not app.portal_booking_caller_ok(p_org, b.person_id) then
    raise exception 'booking access denied' using errcode = '42501';
  end if;
  if p_expected_version is not null and b.version <> p_expected_version then
    raise exception 'this booking was changed by someone else; reload' using errcode = 'PT409';
  end if;
  if b.status <> 'confirmed' or b.starts_at <= now() then
    raise exception 'only an upcoming confirmed booking can be cancelled' using errcode = '22023';
  end if;
  select coalesce(et.min_notice_min, 1440) into notice from public.booking_event_types et where et.id = b.event_type_id;
  notice := coalesce(notice, 1440);
  late := b.starts_at < now() + make_interval(mins => notice);
  update public.bookings
     set status = 'cancelled', cancelled_at = now(), cancelled_by = 'client',
         cancel_reason = nullif(left(btrim(coalesce(p_reason, '')), 500), ''), hold_expires_at = null
   where id = b.id;
  insert into public.booking_events (organization_id, booking_id, kind, actor, actor_user_id, payload)
  values (b.organization_id, b.id, 'cancelled', 'client', (select auth.uid()),
          jsonb_build_object('late', late, 'notice_min', notice));
  -- EM16c to the attendee (same key as a staff cancellation, so it goes once); not for a sample booking.
  if not b.is_sample then
    perform app.booking_outbox(b.organization_id, b.id, 'booking.cancelled',
      jsonb_build_object('booking_id', b.id, 'starts_at', b.starts_at, 'cancelled_by', 'client', 'late', late),
      'booking-cancelled-email:' || b.id::text);
  end if;
  -- The host's and the owner's in-app notice.
  perform app.booking_outbox(b.organization_id, b.id, 'booking.cancelled_by_client',
    jsonb_build_object('booking_id', b.id, 'starts_at', b.starts_at, 'late', late),
    'booking-cancelled-by-client:' || b.id::text);
  perform app.booking_audit(b.organization_id, 'booking.cancelled', b.id, 'success',
    jsonb_build_object('by', 'client', 'late', late, 'notice_min', notice));
  return jsonb_build_object('late', late);
end;
$$;

-- app.save_intake_answer_core(uuid,integer,text,public.answer_presence,jsonb,boolean), last defined in 20261020180000_intake_delivery.sql
create or replace function app.save_intake_answer_core(
  p_response_id uuid,
  p_expected_version integer,
  p_field_key text,
  p_presence public.answer_presence,
  p_value jsonb,
  p_correction boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  response public.intake_responses%rowtype;
  template public.intake_templates%rowtype;
  field jsonb;
  field_type text;
  section_key public.person_section_key;
  date_kind public.answer_date_kind;
  calendar_date date;
  year_value integer;
  month_value integer;
  note text;
  normalized jsonb;
  new_id uuid;
  new_version integer;
begin
  if p_presence is null or p_value is null or jsonb_typeof(p_value) is distinct from 'object' then
    raise exception 'that answer is not usable' using errcode = '22023';
  end if;
  select * into response from public.intake_responses where id = p_response_id for update;
  if response.id is null or app.intake_caller_can_write(response) is distinct from true then
    raise exception 'intake answer denied' using errcode = '42501';
  end if;
  if response.frozen_at is not null and coalesce(p_correction, false) is false then
    raise exception 'that intake snapshot is frozen' using errcode = '42501';
  end if;
  if response.version is distinct from p_expected_version then
    raise exception 'intake version conflict' using errcode = 'PT409';
  end if;
  select * into template from public.intake_templates where id = response.template_id;
  select value into field
  from jsonb_array_elements(template.schema -> 'fields')
  where value ->> 'key' = p_field_key;
  if field is null then
    raise exception 'that field is not on this intake template' using errcode = '22023';
  end if;
  field_type := field ->> 'type';
  if field ? 'section_key' then
    section_key := (field ->> 'section_key')::public.person_section_key;
  end if;

  if p_presence = 'unknown' and field ? 'allow_unknown' and (field ->> 'allow_unknown') = 'false' then
    raise exception 'this question needs an answer; unknown is not allowed' using errcode = '22023';
  end if;
  if p_presence = 'not_applicable' and field ? 'allow_not_applicable' and (field ->> 'allow_not_applicable') = 'false' then
    raise exception 'this question needs an answer; not applicable is not allowed' using errcode = '22023';
  end if;

  if p_presence in ('unknown', 'not_applicable') then
    normalized := '{}'::jsonb;
  elsif p_presence = 'approximate' then
    if field_type is distinct from 'date' then
      raise exception 'only a date can be approximate' using errcode = '22023';
    end if;
    note := nullif(btrim(p_value ->> 'approximate_note'), '');
    if note is null then
      raise exception 'an approximate date needs a note and is not stored as a full date' using errcode = '22023';
    end if;
    if p_value ? 'year' and (p_value ->> 'year') is not null then
      year_value := (p_value ->> 'year')::integer;
    end if;
    if p_value ? 'month' and (p_value ->> 'month') is not null then
      month_value := (p_value ->> 'month')::integer;
    end if;
    normalized := jsonb_strip_nulls(jsonb_build_object('year', year_value, 'month', month_value, 'approximate_note', note));
  else
    if field_type = 'date' then
      date_kind := (p_value ->> 'date_kind')::public.answer_date_kind;
      if date_kind = 'exact' then
        calendar_date := (p_value ->> 'calendar_date')::date;
        if calendar_date is null then
          raise exception 'an exact date needs a calendar day' using errcode = '22023';
        end if;
        normalized := jsonb_build_object('calendar_date', calendar_date);
      elsif date_kind = 'year_month' then
        year_value := (p_value ->> 'year')::integer;
        month_value := (p_value ->> 'month')::integer;
        if year_value is null or month_value is null then
          raise exception 'a year and month are not a full date' using errcode = '22023';
        end if;
        normalized := jsonb_build_object('year', year_value, 'month', month_value);
      elsif date_kind = 'year' then
        year_value := (p_value ->> 'year')::integer;
        if year_value is null then
          raise exception 'a year is not a full date' using errcode = '22023';
        end if;
        normalized := jsonb_build_object('year', year_value);
      else
        raise exception 'that date precision is not usable' using errcode = '22023';
      end if;
    elsif field_type = 'declaration' then
      if jsonb_typeof(p_value -> 'declaration') is distinct from 'boolean' then
        raise exception 'a declaration needs a yes or no' using errcode = '22023';
      end if;
      normalized := jsonb_build_object('declaration', p_value -> 'declaration');
    elsif field_type in ('repeatable', 'relationship') then
      if jsonb_typeof(p_value -> 'entries') is distinct from 'array' then
        raise exception 'that history needs a list' using errcode = '22023';
      end if;
      normalized := jsonb_build_object('entries', p_value -> 'entries');
    elsif field_type = 'country' then
      if coalesce(p_value ->> 'text', '') !~ '^[A-Z]{2}$' then
        raise exception 'a country is a two-letter code' using errcode = '22023';
      end if;
      normalized := jsonb_build_object('text', p_value ->> 'text');
    elsif field_type = 'choice' then
      if not exists (
        select 1
        from jsonb_array_elements_text(field -> 'options') option
        where option = p_value ->> 'text'
      ) then
        raise exception 'that choice is not on the template' using errcode = '22023';
      end if;
      normalized := jsonb_build_object('text', p_value ->> 'text');
    else
      if nullif(btrim(p_value ->> 'text'), '') is null then
        raise exception 'that answer needs text' using errcode = '22023';
      end if;
      normalized := jsonb_build_object('text', btrim(p_value ->> 'text'));
    end if;
  end if;

  insert into public.intake_answer_versions (
    organization_id, response_id, field_key, section_key, presence, raw_value, normalized_value,
    date_kind, calendar_date, year_value, month_value, approximate_note
  ) values (
    response.organization_id,
    response.id,
    p_field_key,
    section_key,
    p_presence,
    p_value,
    coalesce(normalized, '{}'::jsonb),
    date_kind,
    calendar_date,
    year_value,
    month_value,
    note
  )
  returning id into new_id;

  update public.intake_responses
  set updated_at = statement_timestamp()
  where id = response.id
    and version = p_expected_version
  returning version into new_version;
  if new_version is null then
    raise exception 'intake version conflict' using errcode = 'PT409';
  end if;

  if response.status = 'submitted' then
    perform app.enqueue_event(
      response.organization_id,
      'intake_response',
      response.id,
      'intake.answer_corrected',
      jsonb_build_object(
        'response_id', response.id,
        'matter_id', response.matter_id,
        'field_key', p_field_key
      ),
      new_version,
      'intake.answer_corrected:' || new_id::text
    );
  end if;
  return new_id;
end;
$$;

-- public.review_intake_answer(uuid), last defined in 20261020180000_intake_delivery.sql
create or replace function public.review_intake_answer(p_answer_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  answer public.intake_answer_versions%rowtype;
  response public.intake_responses%rowtype;
  matter_sample boolean;
  reviewer uuid;
  existing uuid;
  latest uuid;
  new_id uuid;
begin
  select * into answer from public.intake_answer_versions where id = p_answer_id;
  if answer.id is null then
    raise exception 'intake review denied' using errcode = '42501';
  end if;
  select * into response from public.intake_responses where id = answer.response_id for update;
  perform app.require_active_staff(
    response.organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[],
    false
  );
  if app.can_read_matter(response.matter_id) is distinct from true
     or app.can_read_intake_answer(answer.id) is distinct from true then
    raise exception 'intake review denied' using errcode = '42501';
  end if;
  if response.status is distinct from 'submitted' then
    raise exception 'review answers once the client sends them' using errcode = '42501';
  end if;
  select matter.is_sample into matter_sample from public.matters matter where matter.id = response.matter_id;
  if app.sample_mode_blocks_real(response.organization_id, matter_sample) then
    raise exception 'this firm is in sample mode; only sample matters accept new work' using errcode = '42501';
  end if;
  select latest_answer.id into latest
  from public.intake_answer_versions latest_answer
  where latest_answer.response_id = answer.response_id
    and latest_answer.field_key = answer.field_key
  order by latest_answer.created_at desc, latest_answer.id desc
  limit 1;
  if latest is distinct from answer.id then
    raise exception 'a newer answer replaced this one; review the newer version' using errcode = 'PT409';
  end if;
  select review.id into existing from public.intake_answer_reviews review where review.answer_id = answer.id;
  if existing is not null then
    return existing;
  end if;
  select mem.id into reviewer
  from public.memberships mem
  where mem.organization_id = response.organization_id
    and mem.user_id = (select auth.uid())
    and mem.status = 'active'
    and mem.role in ('firm_owner', 'licensed_consultant', 'case_manager')
  order by mem.created_at
  limit 1;
  insert into public.intake_answer_reviews (organization_id, answer_id, response_id, reviewer_membership_id)
  values (response.organization_id, answer.id, response.id, reviewer)
  returning id into new_id;
  perform app.record_audit_event(
    response.organization_id,
    'intake.answer_reviewed',
    'public.intake_answer_reviews',
    new_id,
    'success',
    jsonb_build_object('response_id', response.id, 'matter_id', response.matter_id, 'field_key', answer.field_key, 'answer_id', answer.id)
  );
  return new_id;
end;
$$;

