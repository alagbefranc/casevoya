-- Work area audit fixes (matters, matter page, clients, tasks, government, lead conversion).
--
-- 1. Sample mode (decision 2026-10-19, Francis): in a sample-mode firm, New matter, Add a client and
--    Convert lead create SAMPLE records (is_sample = true) instead of being refused. A converted
--    sample lead makes a sample matter even after the firm goes live. The body of
--    public.create_client_matter moves into app.create_client_matter_as(p_is_sample, ...), unchanged
--    except that the sample flag is passed in; public.create_client_matter passes the firm's sample
--    mode, public.convert_lead_to_matter passes "the lead is a sample, or the firm is in sample mode".
--    app.lead_conversion_input now also returns the lead's is_sample.
-- 2. Reminder dates: app.schedule_deadline_reminders counted "N days before" from the first instant
--    after a date-only deadline (local midnight of the next day), so every proposed reminder landed
--    one day late (a 20 Nov deadline put "14 days before" on 7 Nov). A date-only deadline now counts
--    from the start of its own due day (local midnight of due_on), so 14 days before 20 Nov is 6 Nov.
--    A deadline with a due time (due_at) is unchanged. Pending routine reminders of date-only
--    deadlines are moved to the corrected day once, below (sent and cancelled rows are history and
--    are left as they are).
-- 3. Government letters: app.attach_correspondence_evidence attaches the evidence (a stored file on
--    the matter, or where it is kept) to a letter recorded without it, so it can then be verified.
--    app.verify_government_correspondence already refused "attach it first" with no way to attach.
--    app.gov_correspondence_immutable allows exactly that one addition (evidence on a letter with
--    none, before verification); every received fact, and evidence already on file, stays fixed.
-- 4. Tasks: app.update_task edits an open task's title, due date and priority (staff on the matter),
--    through the task write guard, audited. Reassigning and completing keep their own functions.
-- Everything else (RLS, MFA, step-up, licence locks, audit) is unchanged. Each redefined function is
-- copied from its latest definition (named above it) with only the change described.

-- ---------------------------------------------------------------------------
-- 1. Sample mode creates sample records
-- ---------------------------------------------------------------------------

-- Whether the signed-in member's firm is in sample mode. Null for anyone who is not a member.
create function app.firm_in_sample_mode(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case when app.is_org_member(p_org) then coalesce(org.sample_mode, false) else null end
  from public.organizations org
  where org.id = p_org;
$$;
revoke all on function app.firm_in_sample_mode(uuid) from public, anon;
grant execute on function app.firm_in_sample_mode(uuid) to authenticated, service_role;

-- Body of public.create_client_matter (latest: 20261019216100_firm_today_rules.sql), with the
-- matter's and people's is_sample taken from p_is_sample instead of always false.
create function app.create_client_matter_as(
  p_is_sample boolean,
  p_applicant_name text,
  p_applicant_email text,
  p_sponsor_name text,
  p_sponsor_email text,
  p_consultant_membership_id uuid,
  p_rule_pack_version_id uuid,
  p_title text,
  p_applicant_date_of_birth date,
  p_sponsor_date_of_birth date
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  org uuid := app.current_organization_id();
  sample boolean := coalesce(p_is_sample, false);
  applicant_name text := btrim(coalesce(p_applicant_name, ''));
  applicant_email text := nullif(lower(btrim(coalesce(p_applicant_email, ''))), '');
  sponsor_name text := nullif(btrim(coalesce(p_sponsor_name, '')), '');
  sponsor_email text := nullif(lower(btrim(coalesce(p_sponsor_email, ''))), '');
  title text := nullif(btrim(coalesce(p_title, '')), '');
  created jsonb;
  matter_id uuid;
  applicant_id uuid := gen_random_uuid();
  sponsor_id uuid := gen_random_uuid();
  creator public.memberships%rowtype;
begin
  if org is null then
    raise exception 'matter create denied' using errcode = '42501';
  end if;
  if app.staff_mfa_satisfied() is distinct from true then
    raise exception 'aal2 is required to open a matter' using errcode = '42501';
  end if;
  if length(applicant_name) not between 1 and 200 then
    raise exception 'the applicant name is required' using errcode = '22023';
  end if;
  if sponsor_name is not null and length(sponsor_name) > 200 then
    raise exception 'the sponsor name is too long' using errcode = '22023';
  end if;
  if sponsor_name is null and sponsor_email is not null then
    raise exception 'the sponsor name is required with a sponsor email' using errcode = '22023';
  end if;
  if (applicant_email is not null and (length(applicant_email) > 320 or applicant_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'))
     or (sponsor_email is not null and (length(sponsor_email) > 320 or sponsor_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')) then
    raise exception 'email is invalid' using errcode = '22023';
  end if;
  if title is null then
    title := left(applicant_name, 200);
  end if;
  -- An optional date of birth: day precision, not in the future, and a plausible age.
  -- app.sync_person_birth mirrors it into birth_date and is_minor and rejects a future date too.
  if (p_applicant_date_of_birth is not null
        and (p_applicant_date_of_birth > app.firm_today(org) or p_applicant_date_of_birth < date '1900-01-01'))
     or (p_sponsor_date_of_birth is not null
        and (p_sponsor_date_of_birth > app.firm_today(org) or p_sponsor_date_of_birth < date '1900-01-01')) then
    raise exception 'date of birth is not plausible' using errcode = '22023';
  end if;
  if sponsor_name is null and p_sponsor_date_of_birth is not null then
    raise exception 'the sponsor name is required with a sponsor date of birth' using errcode = '22023';
  end if;

  created := public.create_engaged_matter(title, sample, p_consultant_membership_id, p_rule_pack_version_id, null);
  if (created ->> 'ok')::boolean is distinct from true then
    return created;
  end if;
  matter_id := (created ->> 'id')::uuid;

  insert into public.persons (id, organization_id, display_name, email, is_sample, date_of_birth, birth_date_precision)
  values (
    applicant_id, org, applicant_name, applicant_email, sample, p_applicant_date_of_birth,
    case when p_applicant_date_of_birth is null then null else 'day'::public.date_precision end
  );
  insert into public.matter_participants (organization_id, matter_id, person_id, role)
  values (org, matter_id, applicant_id, 'applicant');

  if sponsor_name is not null then
    insert into public.persons (id, organization_id, display_name, email, is_sample, date_of_birth, birth_date_precision)
    values (
      sponsor_id, org, sponsor_name, sponsor_email, sample, p_sponsor_date_of_birth,
      case when p_sponsor_date_of_birth is null then null else 'day'::public.date_precision end
    );
    insert into public.matter_participants (organization_id, matter_id, person_id, role)
    values (org, matter_id, sponsor_id, 'sponsor');
  end if;

  select * into creator
  from public.memberships mem
  where mem.organization_id = org
    and mem.user_id = (select auth.uid())
    and mem.status = 'active'
  order by mem.created_at
  limit 1;
  -- A firm owner is assigned like any other creator: owner person access is assignment-based.
  if creator.id is not null
     and creator.id is distinct from p_consultant_membership_id
     and creator.role in ('licensed_consultant', 'case_manager', 'firm_owner') then
    insert into public.matter_participants (organization_id, matter_id, membership_id, role)
    values (org, matter_id, creator.id, 'case_manager');
  end if;

  return jsonb_build_object(
    'ok', true,
    'id', matter_id,
    'reference', created ->> 'reference',
    'applicant_id', applicant_id,
    'sponsor_id', case when sponsor_name is null then null else sponsor_id end,
    'is_sample', sample
  );
end;
$$;
revoke all on function app.create_client_matter_as(boolean, text, text, text, text, uuid, uuid, text, date, date) from public, anon;
grant execute on function app.create_client_matter_as(boolean, text, text, text, text, uuid, uuid, text, date, date)
  to authenticated, service_role;

-- public.create_client_matter: latest definition from 20261019216100_firm_today_rules.sql. Its body is
-- now app.create_client_matter_as; a sample-mode firm gets a sample matter instead of a refusal.
create or replace function public.create_client_matter(
  p_applicant_name text,
  p_applicant_email text,
  p_sponsor_name text,
  p_sponsor_email text,
  p_consultant_membership_id uuid,
  p_rule_pack_version_id uuid default null,
  p_title text default null,
  p_applicant_date_of_birth date default null,
  p_sponsor_date_of_birth date default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  org uuid := app.current_organization_id();
begin
  if org is null then
    raise exception 'matter create denied' using errcode = '42501';
  end if;
  return app.create_client_matter_as(
    coalesce(app.firm_in_sample_mode(org), false),
    p_applicant_name, p_applicant_email, p_sponsor_name, p_sponsor_email,
    p_consultant_membership_id, p_rule_pack_version_id, p_title,
    p_applicant_date_of_birth, p_sponsor_date_of_birth
  );
end;
$$;
comment on function public.create_client_matter(text, text, text, text, uuid, uuid, text, date, date) is
  'New client matter at engagement pending: create_engaged_matter plus an applicant, an optional sponsor (each with an optional day-precision date of birth), and the creator (consultant, case manager or firm owner) as a case_manager participant. Invoker. In a sample-mode firm the matter and its people are sample records (decision 2026-10-19).';

-- app.lead_conversion_input: latest definition from 20261019201200_lead_functions.sql; it also returns is_sample.
create or replace function app.lead_conversion_input(p_org uuid, p_lead uuid, p_expected_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  lead public.leads;
begin
  lead := app.lead_for_update(p_org, p_lead, p_expected_version);
  if lead.converted_at is not null then
    raise exception 'this lead is already converted' using errcode = '22023';
  end if;
  if app.lead_stage_kind_of(lead.stage_id) <> 'open' then
    raise exception 'reopen the lead before converting it' using errcode = '22023';
  end if;
  if lead.conflict_result <> 'clear' then
    raise exception 'record a clear conflict check before converting' using errcode = '22023';
  end if;
  return jsonb_build_object('name', lead.display_name, 'email', lead.email, 'date_of_birth', lead.date_of_birth, 'is_sample', lead.is_sample);
end;
$$;

-- public.convert_lead_to_matter: latest definition from 20261019201200_lead_functions.sql. A sample
-- lead, or any lead in a sample-mode firm, becomes a sample matter.
create or replace function public.convert_lead_to_matter(
  p_org uuid,
  p_lead uuid,
  p_expected_version integer,
  p_consultant_membership_id uuid,
  p_rule_pack_version_id uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  input jsonb;
  created jsonb;
  v_version integer;
begin
  if p_org is distinct from app.current_organization_id() then
    raise exception 'staff access denied' using errcode = '42501';
  end if;
  input := app.lead_conversion_input(p_org, p_lead, p_expected_version);
  created := app.create_client_matter_as(
    coalesce((input ->> 'is_sample')::boolean, false) or coalesce(app.firm_in_sample_mode(p_org), false),
    input ->> 'name',
    input ->> 'email',
    null,
    null,
    p_consultant_membership_id,
    p_rule_pack_version_id,
    null,
    (input ->> 'date_of_birth')::date,
    null
  );
  if (created ->> 'ok')::boolean is distinct from true then
    return created;
  end if;
  v_version := app.finish_lead_conversion(p_org, p_lead, p_expected_version,
    (created ->> 'id')::uuid, (created ->> 'applicant_id')::uuid);
  return created || jsonb_build_object('lead_version', v_version);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Reminder dates: "N days before" a date-only deadline is N days before its due day
-- ---------------------------------------------------------------------------

-- The instant a reminder N days before a deadline is proposed for: for a date-only deadline, the
-- start of the local day N days before the due day; for a timed deadline, N days before that instant.
create function app.reminder_slot(p_due_on date, p_due_at timestamptz, p_timezone text, p_offset_days integer)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select case
    when p_due_at is not null then p_due_at - make_interval(days => p_offset_days)
    when p_due_on is not null then ((p_due_on - p_offset_days)::timestamp) at time zone p_timezone
    else null
  end;
$$;
revoke all on function app.reminder_slot(date, timestamptz, text, integer) from public, anon;
grant execute on function app.reminder_slot(date, timestamptz, text, integer) to authenticated, service_role;

-- app.schedule_deadline_reminders: latest definition from 20261017170200_tasks_deadlines.sql; only
-- the routine slot changes (app.reminder_slot instead of due_instant minus N days).
create or replace function app.schedule_deadline_reminders(p_deadline_id uuid, p_as_of timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  deadline public.deadlines%rowtype;
  matter public.matters%rowtype;
  org public.organizations%rowtype;
  person_start time;
  person_end time;
  quiet_start time;
  quiet_end time;
  due_instant timestamptz;
  as_of timestamptz := coalesce(p_as_of, statement_timestamp());
  offset_day integer;
  slot timestamptz;
  made integer := 0;
  due_key text;
begin
  select * into deadline from public.deadlines where id = p_deadline_id;
  if deadline.id is null or app.can_read_matter(deadline.matter_id) is distinct from true then
    raise exception 'reminder schedule denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    deadline.organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[],
    false
  );
  select * into matter from public.matters where id = deadline.matter_id;
  select * into org from public.organizations where id = deadline.organization_id;
  due_instant := app.deadline_due_instant(deadline.due_on, deadline.due_at, deadline.timezone);
  due_key := coalesce(deadline.due_on::text, deadline.due_at::text);

  update public.reminder_schedules
  set status = 'cancelled'
  where deadline_id = deadline.id
    and status = 'pending';

  if due_instant is null then
    return 0;
  end if;

  select pref.quiet_hours_start, pref.quiet_hours_end into person_start, person_end
  from public.tasks task
  join public.person_contact_preferences pref on pref.person_id = task.owner_person_id
  where task.id = deadline.task_id
    and task.audience = 'client';
  quiet_start := coalesce(person_start, org.quiet_hours_start);
  quiet_end := coalesce(person_end, org.quiet_hours_end);

  if due_instant <= as_of + interval '1 day' then
    insert into public.reminder_schedules (
      organization_id, deadline_id, task_id, offset_days, reminder_kind, scheduled_for, idempotency_key
    ) values (
      deadline.organization_id,
      deadline.id,
      deadline.task_id,
      0,
      'immediate',
      as_of,
      'reminder:' || deadline.id::text || ':immediate:' || due_key
    )
    on conflict (organization_id, idempotency_key) do nothing;
    made := made + 1;
  end if;

  foreach offset_day in array app.reminder_offset_days(deadline.organization_id)
  loop
    slot := app.reminder_slot(deadline.due_on, deadline.due_at, deadline.timezone, offset_day);
    if slot > as_of then
      slot := app.shift_quiet_hours(slot, deadline.timezone, quiet_start, quiet_end);
      insert into public.reminder_schedules (
        organization_id, deadline_id, task_id, offset_days, reminder_kind, scheduled_for, idempotency_key
      ) values (
        deadline.organization_id,
        deadline.id,
        deadline.task_id,
        offset_day,
        'routine',
        slot,
        'reminder:' || deadline.id::text || ':' || offset_day::text || ':' || due_key
      )
      on conflict (organization_id, idempotency_key) do update
        set status = 'pending',
            scheduled_for = excluded.scheduled_for
        where public.reminder_schedules.status = 'cancelled';
      made := made + 1;
    end if;
  end loop;
  return made;
end;
$$;

-- One-time correction of pending routine reminders already proposed for date-only deadlines: each
-- moves one day earlier, to the corrected slot (quiet hours applied as when it was scheduled).
-- Reminders already sent or cancelled are history and stay as they are.
do $$
declare
  r record;
  slot timestamptz;
begin
  for r in
    select schedule.id, schedule.offset_days, schedule.scheduled_for, deadline.due_on, deadline.timezone,
           coalesce(pref.quiet_hours_start, org.quiet_hours_start) as quiet_start,
           coalesce(pref.quiet_hours_end, org.quiet_hours_end) as quiet_end
    from public.reminder_schedules schedule
    join public.deadlines deadline on deadline.id = schedule.deadline_id
    join public.organizations org on org.id = deadline.organization_id
    left join public.tasks task on task.id = deadline.task_id and task.audience = 'client'
    left join public.person_contact_preferences pref on pref.person_id = task.owner_person_id
    where schedule.status = 'pending'
      and schedule.reminder_kind = 'routine'
      and schedule.offset_days is not null
      and deadline.due_at is null
      and deadline.due_on is not null
  loop
    slot := app.shift_quiet_hours(
      app.reminder_slot(r.due_on, null, r.timezone, r.offset_days), r.timezone, r.quiet_start, r.quiet_end
    );
    if slot is distinct from r.scheduled_for then
      update public.reminder_schedules set scheduled_for = slot where id = r.id;
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Attach evidence to a government letter recorded without it
-- ---------------------------------------------------------------------------

-- app.gov_correspondence_immutable: latest definition from 20261019202100_government_handoff_decisions.sql.
-- The received facts still never change; the one addition allowed is evidence on a letter that was
-- recorded with none (both evidence columns empty), which app.attach_correspondence_evidence makes.
-- Evidence already on file is never replaced (a different copy is a correction, as before).
create or replace function app.gov_correspondence_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.kind, new.issuer, new.channel, new.document_date, new.received_on, new.action_requested,
      new.stated_deadline, new.reference_text, new.corrects_id)
     is distinct from
     (old.kind, old.issuer, old.channel, old.document_date, old.received_on, old.action_requested,
      old.stated_deadline, old.reference_text, old.corrects_id)
     or (
       (new.evidence_version_id, new.evidence_locator) is distinct from (old.evidence_version_id, old.evidence_locator)
       and not (old.evidence_version_id is null and old.evidence_locator is null and old.verified_at is null)
     ) then
    raise exception 'a recorded letter is not overwritten; record a correction' using errcode = '42501';
  end if;
  return new;
end;
$$;

create function app.attach_correspondence_evidence(
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
    raise exception 'correspondence version conflict' using errcode = '40001';
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
revoke all on function app.attach_correspondence_evidence(uuid, integer, uuid, text) from public, anon;
grant execute on function app.attach_correspondence_evidence(uuid, integer, uuid, text) to authenticated, service_role;

create function public.attach_correspondence_evidence(
  p_correspondence_id uuid,
  p_expected_version integer,
  p_evidence_version_id uuid,
  p_evidence_locator text
)
returns integer language sql security invoker set search_path = ''
as $$ select app.attach_correspondence_evidence(p_correspondence_id, p_expected_version, p_evidence_version_id, p_evidence_locator); $$;
revoke all on function public.attach_correspondence_evidence(uuid, integer, uuid, text) from public, anon;
grant execute on function public.attach_correspondence_evidence(uuid, integer, uuid, text) to authenticated, service_role;

comment on column public.government_correspondence.stated_deadline is
  'The deadline the letter states. The Sheet records it as a date (YYYY-MM-DD) since 2026-10-20; older rows hold the words as written. Not calculated; a dated deadline is a linked deadlines row.';

-- ---------------------------------------------------------------------------
-- 4. Edit a task's title, due date and priority
-- ---------------------------------------------------------------------------

create function app.update_task(
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
    raise exception 'task version conflict' using errcode = '40001';
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
revoke all on function app.update_task(uuid, integer, text, date, public.task_priority) from public, anon;
grant execute on function app.update_task(uuid, integer, text, date, public.task_priority) to authenticated, service_role;

create function public.update_task(
  p_task_id uuid,
  p_expected_version integer,
  p_title text,
  p_due_on date,
  p_priority public.task_priority
)
returns integer language sql security invoker set search_path = ''
as $$ select app.update_task(p_task_id, p_expected_version, p_title, p_due_on, p_priority); $$;
revoke all on function public.update_task(uuid, integer, text, date, public.task_priority) from public, anon;
grant execute on function public.update_task(uuid, integer, text, date, public.task_priority) to authenticated, service_role;
