-- T026 tasks, dependencies, and deadlines (PRD §12 OPS-01 to OPS-03, OPS-08).
-- Legal and correspondence dates stay tentative until a consultant confirms an
-- allowlisted source (with a retrieval date) or a published rule version.
-- Reminder offsets are a proposed product setting, not a statutory deadline.
-- There is no holiday calendar here. A date-only deadline ends at the next
-- local midnight in its timezone. On hold does not cancel legal alerts.
-- Additive only.

create type public.task_status as enum ('open', 'blocked', 'done', 'cancelled');
create type public.task_priority as enum ('low', 'normal', 'high', 'critical');
create type public.task_audience as enum ('internal', 'client');
create type public.deadline_kind as enum ('legal', 'correspondence', 'internal');
create type public.deadline_verification as enum ('tentative', 'confirmed');
create type public.reminder_status as enum ('pending', 'sent', 'cancelled');

insert into public.product_settings (key, value, description, pending_confirmation) values (
  'reminders.proposed_offsets',
  '{"days":[14,7,3,1]}'::jsonb,
  'Proposed administrative reminder offsets in days. Not a statutory deadline. A firm may replace them. Pending confirmation.',
  true
);

alter table public.organizations
  add column quiet_hours_start time,
  add column quiet_hours_end time;
comment on column public.organizations.quiet_hours_start is
  'Local start of quiet hours for routine client reminders. Null means no quiet hours. Critical and legal alerts are not shifted.';

alter table public.person_contact_preferences
  add column quiet_hours_start time,
  add column quiet_hours_end time;

create table public.firm_reminder_offsets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  offset_days integer not null check (offset_days between 1 and 365),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  unique (organization_id, offset_days)
);
comment on table public.firm_reminder_offsets is
  'Firm replacement for reminders.proposed_offsets. Empty means the product proposal is used.';

create index firm_reminder_offsets_org_fk_idx on public.firm_reminder_offsets (organization_id);
create index firm_reminder_offsets_created_by_idx on public.firm_reminder_offsets (created_by);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  matter_id uuid,
  person_id uuid,
  audience public.task_audience not null,
  title text not null check (length(btrim(title)) between 1 and 200),
  priority public.task_priority not null default 'normal',
  status public.task_status not null default 'open',
  blocker_note text,
  owner_membership_id uuid,
  owner_person_id uuid,
  due_on date,
  due_at timestamptz,
  due_timezone text not null default 'America/Toronto',
  estimated_minutes integer check (estimated_minutes is null or estimated_minutes between 0 and 100000),
  checklist jsonb not null default '[]'::jsonb,
  intake_field_key text,
  intake_stale boolean not null default false,
  task_key text,
  escalated_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id),
  check (
    (audience = 'internal' and owner_membership_id is not null and owner_person_id is null)
    or (audience = 'client' and owner_person_id is not null and owner_membership_id is null)
  ),
  check (matter_id is not null or task_key = 'majority_review'),
  check (status <> 'blocked' or blocker_note is not null),
  check (blocker_note is null or length(btrim(blocker_note)) between 1 and 500),
  check (intake_field_key is null or intake_field_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id),
  foreign key (person_id, organization_id) references public.persons (id, organization_id),
  foreign key (owner_membership_id, organization_id) references public.memberships (id, organization_id),
  foreign key (owner_person_id, organization_id) references public.persons (id, organization_id)
);
comment on table public.tasks is
  'Internal and client tasks are separate. Completion history stays. intake_stale flags a changed answer and does not delete the task.';

create index tasks_org_status_due_idx on public.tasks (organization_id, status, due_on);
create index tasks_matter_idx on public.tasks (matter_id);
create index tasks_org_fk_idx on public.tasks (organization_id);
create index tasks_matter_org_fk_idx on public.tasks (matter_id, organization_id);
create index tasks_person_org_fk_idx on public.tasks (person_id, organization_id);
create index tasks_owner_membership_org_fk_idx on public.tasks (owner_membership_id, organization_id);
create index tasks_owner_person_org_fk_idx on public.tasks (owner_person_id, organization_id);
create index tasks_created_by_idx on public.tasks (created_by);
create unique index tasks_majority_open_uidx
  on public.tasks (organization_id, person_id)
  where task_key = 'majority_review' and status in ('open', 'blocked');

create table public.task_watchers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  task_id uuid not null,
  membership_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  unique (task_id, membership_id),
  unique (id, organization_id),
  foreign key (task_id, organization_id) references public.tasks (id, organization_id),
  foreign key (membership_id, organization_id) references public.memberships (id, organization_id)
);
comment on table public.task_watchers is 'Staff watchers. Reassignment does not remove them.';

create index task_watchers_org_fk_idx on public.task_watchers (organization_id);
create index task_watchers_task_org_fk_idx on public.task_watchers (task_id, organization_id);
create index task_watchers_membership_org_fk_idx on public.task_watchers (membership_id, organization_id);
create index task_watchers_created_by_idx on public.task_watchers (created_by);

create table public.task_dependencies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  task_id uuid not null,
  depends_on_task_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  unique (task_id, depends_on_task_id),
  unique (id, organization_id),
  check (task_id <> depends_on_task_id),
  foreign key (task_id, organization_id) references public.tasks (id, organization_id),
  foreign key (depends_on_task_id, organization_id) references public.tasks (id, organization_id)
);
comment on table public.task_dependencies is 'The task cannot be completed while a dependency is still open or blocked.';

create index task_dependencies_org_fk_idx on public.task_dependencies (organization_id);
create index task_dependencies_task_org_fk_idx on public.task_dependencies (task_id, organization_id);
create index task_dependencies_depends_org_fk_idx
  on public.task_dependencies (depends_on_task_id, organization_id);
create index task_dependencies_created_by_idx on public.task_dependencies (created_by);

create table public.task_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  task_id uuid not null,
  event_kind text not null check (event_kind in ('created', 'reassigned', 'status', 'escalated', 'intake_flagged')),
  from_status public.task_status,
  to_status public.task_status,
  from_membership_id uuid,
  to_membership_id uuid,
  actor_user_id uuid,
  created_at timestamptz not null default now(),
  foreign key (task_id, organization_id) references public.tasks (id, organization_id)
);
comment on table public.task_events is 'Append-only task history. Reassignment and escalation do not rewrite the task title.';

create index task_events_task_idx on public.task_events (task_id, created_at);
create index task_events_org_fk_idx on public.task_events (organization_id);
create index task_events_task_org_fk_idx on public.task_events (task_id, organization_id);

create table public.deadlines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  matter_id uuid not null,
  task_id uuid,
  kind public.deadline_kind not null,
  label text not null check (length(btrim(label)) between 1 and 200),
  event_on date,
  receipt_on date,
  due_on date,
  due_at timestamptz,
  timezone text not null,
  source_url text,
  source_retrieved_on date,
  rule_version_id uuid references public.rule_versions (id),
  calculation_note text,
  verifying_membership_id uuid,
  verification public.deadline_verification not null default 'tentative',
  evidence_locator text,
  escalated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id),
  check (due_on is not null or due_at is not null),
  check (source_url is null or source_retrieved_on is not null),
  check (rule_version_id is null or (calculation_note is not null and length(btrim(calculation_note)) between 3 and 2000)),
  check (verification <> 'confirmed' or verifying_membership_id is not null),
  check (calculation_note is null or length(calculation_note) <= 2000),
  check (evidence_locator is null or length(evidence_locator) <= 300),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id),
  foreign key (task_id, organization_id) references public.tasks (id, organization_id),
  foreign key (verifying_membership_id, organization_id) references public.memberships (id, organization_id)
);
comment on table public.deadlines is
  'Legal and correspondence dates are distinct from internal targets. Confirmation does not invent an appeal period or a business-day shift.';

create index deadlines_org_kind_due_idx on public.deadlines (organization_id, kind, due_on);
create index deadlines_matter_idx on public.deadlines (matter_id);
create index deadlines_org_fk_idx on public.deadlines (organization_id);
create index deadlines_matter_org_fk_idx on public.deadlines (matter_id, organization_id);
create index deadlines_task_org_fk_idx on public.deadlines (task_id, organization_id);
create index deadlines_rule_idx on public.deadlines (rule_version_id);
create index deadlines_verifier_org_fk_idx on public.deadlines (verifying_membership_id, organization_id);
create index deadlines_created_by_idx on public.deadlines (created_by);

create table public.reminder_schedules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  deadline_id uuid,
  task_id uuid,
  offset_days integer,
  reminder_kind text not null check (reminder_kind in ('routine', 'immediate')),
  status public.reminder_status not null default 'pending',
  scheduled_for timestamptz not null,
  idempotency_key text not null check (length(idempotency_key) between 1 and 200),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, idempotency_key),
  check (deadline_id is not null or task_id is not null),
  foreign key (deadline_id, organization_id) references public.deadlines (id, organization_id),
  foreign key (task_id, organization_id) references public.tasks (id, organization_id)
);
comment on table public.reminder_schedules is
  'One row is one logical reminder. A retry claims a sent row and does not insert another. Quiet hours move routine rows only.';

create index reminder_schedules_due_idx on public.reminder_schedules (status, scheduled_for);
create index reminder_schedules_org_fk_idx on public.reminder_schedules (organization_id);
create index reminder_schedules_deadline_org_fk_idx on public.reminder_schedules (deadline_id, organization_id);
create index reminder_schedules_task_org_fk_idx on public.reminder_schedules (task_id, organization_id);

create table app.task_write_nonce (
  task_id uuid primary key,
  txid bigint not null
);
revoke all on table app.task_write_nonce from public, anon, authenticated, service_role;

create function app.reject_task_event_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'task events are append-only' using errcode = '42501';
end;
$$;
revoke all on function app.reject_task_event_mutation() from public;

create trigger task_events_no_update before update or delete on public.task_events
  for each row execute function app.reject_task_event_mutation();
create trigger task_events_audit after insert or update or delete on public.task_events
  for each row execute function app.audit_row_change();

create trigger tasks_touch before update on public.tasks
  for each row execute function app.touch_row();
create trigger tasks_immutable before update on public.tasks
  for each row execute function app.guard_tenant_keys();
create trigger tasks_stamp before insert on public.tasks
  for each row execute function app.stamp_created_by();
create trigger tasks_audit after insert or update or delete on public.tasks
  for each row execute function app.audit_row_change();

create trigger task_watchers_stamp before insert on public.task_watchers
  for each row execute function app.stamp_created_by();
create trigger task_watchers_audit after insert or update or delete on public.task_watchers
  for each row execute function app.audit_row_change();
create trigger task_dependencies_stamp before insert on public.task_dependencies
  for each row execute function app.stamp_created_by();
create trigger task_dependencies_audit after insert or update or delete on public.task_dependencies
  for each row execute function app.audit_row_change();

create trigger deadlines_touch before update on public.deadlines
  for each row execute function app.touch_row();
create trigger deadlines_immutable before update on public.deadlines
  for each row execute function app.guard_tenant_keys();
create trigger deadlines_stamp before insert on public.deadlines
  for each row execute function app.stamp_created_by();
create trigger deadlines_audit after insert or update or delete on public.deadlines
  for each row execute function app.audit_row_change('calculation_note', 'source_url', 'evidence_locator');

create trigger reminder_schedules_audit after insert or update or delete on public.reminder_schedules
  for each row execute function app.audit_row_change();
create trigger firm_reminder_offsets_stamp before insert on public.firm_reminder_offsets
  for each row execute function app.stamp_created_by();
create trigger firm_reminder_offsets_audit after insert or update or delete on public.firm_reminder_offsets
  for each row execute function app.audit_row_change();

create function public.deadline_local_end(p_due_on date, p_timezone text)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_due_on is null or p_timezone is null or btrim(p_timezone) = '' then
    return null;
  end if;
  return ((p_due_on + 1)::timestamp) at time zone p_timezone;
exception when others then
  raise exception 'deadline timezone is not usable' using errcode = '22023';
end;
$$;
comment on function public.deadline_local_end(date, text) is
  'First instant of the next local calendar day. A date-only deadline is not overdue before that instant. Weekends are not skipped.';
revoke all on function public.deadline_local_end(date, text) from public, anon;
grant execute on function public.deadline_local_end(date, text) to authenticated, service_role;

create function app.deadline_due_instant(p_due_on date, p_due_at timestamptz, p_timezone text)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select coalesce(p_due_at, public.deadline_local_end(p_due_on, p_timezone));
$$;
revoke all on function app.deadline_due_instant(date, timestamptz, text) from public;

create function app.shift_quiet_hours(
  p_at timestamptz,
  p_timezone text,
  p_start time,
  p_end time
)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  local_ts timestamp;
  local_time time;
begin
  if p_at is null or p_start is null or p_end is null or p_start = p_end then
    return p_at;
  end if;
  local_ts := p_at at time zone p_timezone;
  local_time := local_ts::time;
  if p_start < p_end then
    if local_time >= p_start and local_time < p_end then
      return (date_trunc('day', local_ts) + p_end) at time zone p_timezone;
    end if;
    return p_at;
  end if;
  if local_time >= p_start then
    return ((date_trunc('day', local_ts) + interval '1 day') + p_end) at time zone p_timezone;
  end if;
  if local_time < p_end then
    return (date_trunc('day', local_ts) + p_end) at time zone p_timezone;
  end if;
  return p_at;
end;
$$;
revoke all on function app.shift_quiet_hours(timestamptz, text, time, time) from public;

create function app.reminder_offset_days(p_org uuid)
returns integer[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select array_agg(offset_days order by offset_days desc)
      from public.firm_reminder_offsets
      where organization_id = p_org
    ),
    (
      select array_agg(day_value::integer order by day_value::integer desc)
      from public.product_settings setting
      cross join lateral jsonb_array_elements_text(setting.value -> 'days') day_value
      where setting.key = 'reminders.proposed_offsets'
    ),
    array[]::integer[]
  );
$$;
revoke all on function app.reminder_offset_days(uuid) from public;

create function app.can_read_task(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tasks task
    where task.id = p_id
      and app.in_active_org(task.organization_id)
      and (
        (
          task.audience = 'internal'
          and (select app.staff_mfa_satisfied())
          and (select app.is_org_staff(task.organization_id))
          and (
            task.matter_id is null
            or (select app.can_read_matter(task.matter_id))
          )
        )
        or (
          task.audience = 'client'
          and (
            (
              (select app.staff_mfa_satisfied())
              and (select app.can_read_matter(task.matter_id))
              and (select app.is_org_staff(task.organization_id))
            )
            or exists (
              select 1
              from public.persons owner
              where owner.id = task.owner_person_id
                and owner.user_id = (select auth.uid())
            )
          )
        )
      )
  );
$$;
revoke all on function app.can_read_task(uuid) from public;
grant execute on function app.can_read_task(uuid) to authenticated, service_role;

create function app.open_task_write(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into app.task_write_nonce (task_id, txid)
  values (p_task_id, txid_current())
  on conflict (task_id) do update set txid = excluded.txid;
end;
$$;
revoke all on function app.open_task_write(uuid) from public;

create function app.close_task_write(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from app.task_write_nonce where task_id = p_task_id;
end;
$$;
revoke all on function app.close_task_write(uuid) from public;

create function app.guard_task_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from app.task_write_nonce nonce
    where nonce.task_id = new.id
      and nonce.txid = txid_current()
  ) then
    raise exception 'task changes go through a task function' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.guard_task_update() from public;

create trigger tasks_write_guard before update on public.tasks
  for each row execute function app.guard_task_update();

create function app.usable_timezone(p_timezone text)
returns text
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_timezone is null or btrim(p_timezone) = '' then
    raise exception 'deadline timezone is not usable' using errcode = '22023';
  end if;
  perform (statement_timestamp() at time zone p_timezone);
  return btrim(p_timezone);
exception when others then
  raise exception 'deadline timezone is not usable' using errcode = '22023';
end;
$$;
revoke all on function app.usable_timezone(text) from public;

create function app.create_task(
  p_matter_id uuid,
  p_audience public.task_audience,
  p_title text,
  p_owner_membership_id uuid,
  p_owner_person_id uuid,
  p_priority public.task_priority,
  p_due_on date,
  p_due_at timestamptz,
  p_due_timezone text,
  p_estimated_minutes integer,
  p_intake_field_key text,
  p_checklist jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  matter public.matters%rowtype;
  new_id uuid;
  zone text;
begin
  if p_title is null or length(btrim(p_title)) not between 1 and 200 then
    raise exception 'a task title is required' using errcode = '22023';
  end if;
  if p_checklist is null or jsonb_typeof(p_checklist) is distinct from 'array' then
    raise exception 'a task checklist must be a list' using errcode = '22023';
  end if;
  select * into matter from public.matters where id = p_matter_id;
  if matter.id is null or app.can_read_matter(matter.id) is distinct from true then
    raise exception 'task create denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    matter.organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[],
    false
  );
  if app.sample_mode_blocks_real(matter.organization_id, matter.is_sample) then
    raise exception 'this firm is in sample mode; only sample matters accept new work' using errcode = '42501';
  end if;
  zone := app.usable_timezone(coalesce(p_due_timezone, 'America/Toronto'));
  if p_audience = 'internal' then
    if not exists (
      select 1 from public.memberships mem
      where mem.id = p_owner_membership_id
        and mem.organization_id = matter.organization_id
        and mem.status = 'active'
        and mem.role = any (app.staff_roles())
    ) then
      raise exception 'an internal task needs an active staff owner' using errcode = '42501';
    end if;
  else
    if not exists (
      select 1
      from public.persons person
      join public.matter_participants party
        on party.person_id = person.id
       and party.matter_id = matter.id
      where person.id = p_owner_person_id
        and person.organization_id = matter.organization_id
        and person.is_sample is not distinct from matter.is_sample
    ) then
      raise exception 'a client task needs a person on this matter' using errcode = '42501';
    end if;
  end if;

  insert into public.tasks (
    organization_id, matter_id, audience, title, priority, owner_membership_id, owner_person_id,
    due_on, due_at, due_timezone, estimated_minutes, intake_field_key, checklist
  ) values (
    matter.organization_id,
    matter.id,
    p_audience,
    btrim(p_title),
    coalesce(p_priority, 'normal'),
    case when p_audience = 'internal' then p_owner_membership_id else null end,
    case when p_audience = 'client' then p_owner_person_id else null end,
    p_due_on,
    p_due_at,
    zone,
    p_estimated_minutes,
    p_intake_field_key,
    p_checklist
  )
  returning id into new_id;

  insert into public.task_events (organization_id, task_id, event_kind, to_status, actor_user_id)
  values (matter.organization_id, new_id, 'created', 'open', (select auth.uid()));
  return new_id;
end;
$$;
revoke all on function app.create_task(uuid, public.task_audience, text, uuid, uuid, public.task_priority, date, timestamptz, text, integer, text, jsonb) from public;

create function public.create_task(
  p_matter_id uuid,
  p_audience public.task_audience,
  p_title text,
  p_owner_membership_id uuid,
  p_owner_person_id uuid,
  p_priority public.task_priority,
  p_due_on date,
  p_due_at timestamptz,
  p_due_timezone text,
  p_estimated_minutes integer,
  p_intake_field_key text,
  p_checklist jsonb
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select app.create_task(
    p_matter_id, p_audience, p_title, p_owner_membership_id, p_owner_person_id, p_priority,
    p_due_on, p_due_at, p_due_timezone, p_estimated_minutes, p_intake_field_key, p_checklist
  );
$$;
revoke all on function public.create_task(uuid, public.task_audience, text, uuid, uuid, public.task_priority, date, timestamptz, text, integer, text, jsonb) from public, anon;
grant execute on function public.create_task(uuid, public.task_audience, text, uuid, uuid, public.task_priority, date, timestamptz, text, integer, text, jsonb)
  to authenticated, service_role;

create function app.set_task_status(
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
    raise exception 'task version conflict' using errcode = '40001';
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
revoke all on function app.set_task_status(uuid, integer, public.task_status, text) from public;

create function public.set_task_status(
  p_task_id uuid,
  p_expected_version integer,
  p_status public.task_status,
  p_blocker_note text
)
returns integer
language sql
security invoker
set search_path = ''
as $$
  select app.set_task_status(p_task_id, p_expected_version, p_status, p_blocker_note);
$$;
revoke all on function public.set_task_status(uuid, integer, public.task_status, text) from public, anon;
grant execute on function public.set_task_status(uuid, integer, public.task_status, text) to authenticated, service_role;

create function app.reassign_task(
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
    raise exception 'task version conflict' using errcode = '40001';
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
revoke all on function app.reassign_task(uuid, integer, uuid, uuid) from public;

create function public.reassign_task(
  p_task_id uuid,
  p_expected_version integer,
  p_owner_membership_id uuid,
  p_owner_person_id uuid
)
returns integer
language sql
security invoker
set search_path = ''
as $$
  select app.reassign_task(p_task_id, p_expected_version, p_owner_membership_id, p_owner_person_id);
$$;
revoke all on function public.reassign_task(uuid, integer, uuid, uuid) from public, anon;
grant execute on function public.reassign_task(uuid, integer, uuid, uuid) to authenticated, service_role;

create function app.add_task_dependency(p_task_id uuid, p_depends_on_task_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  task public.tasks%rowtype;
  earlier public.tasks%rowtype;
  new_id uuid;
begin
  select * into task from public.tasks where id = p_task_id;
  select * into earlier from public.tasks where id = p_depends_on_task_id;
  if task.id is null or earlier.id is null
     or task.organization_id is distinct from earlier.organization_id
     or task.matter_id is distinct from earlier.matter_id
     or app.can_read_task(task.id) is distinct from true then
    raise exception 'task dependency denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    task.organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[],
    false
  );
  if exists (
    with recursive chain as (
      select dep.depends_on_task_id as id
      from public.task_dependencies dep
      where dep.task_id = earlier.id
      union
      select dep.depends_on_task_id
      from public.task_dependencies dep
      join chain on dep.task_id = chain.id
    )
    select 1 from chain where id = task.id
  ) then
    raise exception 'task dependencies cannot cycle' using errcode = '22023';
  end if;
  insert into public.task_dependencies (organization_id, task_id, depends_on_task_id)
  values (task.organization_id, task.id, earlier.id)
  returning id into new_id;
  return new_id;
end;
$$;
revoke all on function app.add_task_dependency(uuid, uuid) from public;

create function public.add_task_dependency(p_task_id uuid, p_depends_on_task_id uuid)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select app.add_task_dependency(p_task_id, p_depends_on_task_id);
$$;
revoke all on function public.add_task_dependency(uuid, uuid) from public, anon;
grant execute on function public.add_task_dependency(uuid, uuid) to authenticated, service_role;

create function app.add_task_watcher(p_task_id uuid, p_membership_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  task public.tasks%rowtype;
  new_id uuid;
begin
  select * into task from public.tasks where id = p_task_id;
  if task.id is null or app.can_read_task(task.id) is distinct from true then
    raise exception 'task watcher denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    task.organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[],
    false
  );
  if not exists (
    select 1 from public.memberships mem
    where mem.id = p_membership_id
      and mem.organization_id = task.organization_id
      and mem.status = 'active'
      and mem.role = any (app.staff_roles())
  ) then
    raise exception 'a watcher must be active staff' using errcode = '42501';
  end if;
  insert into public.task_watchers (organization_id, task_id, membership_id)
  values (task.organization_id, task.id, p_membership_id)
  on conflict (task_id, membership_id) do nothing
  returning id into new_id;
  if new_id is null then
    select id into new_id from public.task_watchers where task_id = task.id and membership_id = p_membership_id;
  end if;
  return new_id;
end;
$$;
revoke all on function app.add_task_watcher(uuid, uuid) from public;

create function public.add_task_watcher(p_task_id uuid, p_membership_id uuid)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select app.add_task_watcher(p_task_id, p_membership_id);
$$;
revoke all on function public.add_task_watcher(uuid, uuid) from public, anon;
grant execute on function public.add_task_watcher(uuid, uuid) to authenticated, service_role;

create function app.assert_deadline_source(p_source_url text, p_retrieved_on date, p_rule_version_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  host text;
  rule_status public.rule_publication_status;
begin
  if p_source_url is not null then
    host := app.official_url_host(p_source_url);
    if app.host_is_allowlisted(host) is distinct from true or p_retrieved_on is null then
      raise exception 'a deadline source must be an allowlisted official URL with a retrieval date'
        using errcode = '42501';
    end if;
  end if;
  if p_rule_version_id is not null then
    select status into rule_status from public.rule_versions where id = p_rule_version_id;
    if rule_status is null or rule_status not in ('published', 'review_due') then
      raise exception 'a derived deadline must cite a published rule version' using errcode = '42501';
    end if;
  end if;
end;
$$;
revoke all on function app.assert_deadline_source(text, date, uuid) from public;

create function app.record_deadline(
  p_matter_id uuid,
  p_task_id uuid,
  p_kind public.deadline_kind,
  p_label text,
  p_event_on date,
  p_receipt_on date,
  p_due_on date,
  p_due_at timestamptz,
  p_timezone text,
  p_source_url text,
  p_source_retrieved_on date,
  p_rule_version_id uuid,
  p_calculation_note text,
  p_evidence_locator text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  matter public.matters%rowtype;
  new_id uuid;
  zone text;
begin
  select * into matter from public.matters where id = p_matter_id;
  if matter.id is null or app.can_read_matter(matter.id) is distinct from true then
    raise exception 'deadline denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    matter.organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[],
    false
  );
  if app.sample_mode_blocks_real(matter.organization_id, matter.is_sample) then
    raise exception 'this firm is in sample mode; only sample matters accept new work' using errcode = '42501';
  end if;
  if p_due_on is null and p_due_at is null then
    raise exception 'a deadline needs a date or an instant' using errcode = '22023';
  end if;
  if p_label is null or length(btrim(p_label)) not between 1 and 200 then
    raise exception 'a deadline label is required' using errcode = '22023';
  end if;
  zone := app.usable_timezone(p_timezone);
  perform app.assert_deadline_source(p_source_url, p_source_retrieved_on, p_rule_version_id);
  if p_task_id is not null and not exists (
    select 1 from public.tasks task
    where task.id = p_task_id and task.matter_id = matter.id
  ) then
    raise exception 'that task is not on this matter' using errcode = '42501';
  end if;
  insert into public.deadlines (
    organization_id, matter_id, task_id, kind, label, event_on, receipt_on, due_on, due_at, timezone,
    source_url, source_retrieved_on, rule_version_id, calculation_note, evidence_locator
  ) values (
    matter.organization_id, matter.id, p_task_id, p_kind, btrim(p_label), p_event_on, p_receipt_on,
    p_due_on, p_due_at, zone, p_source_url, p_source_retrieved_on, p_rule_version_id,
    p_calculation_note, p_evidence_locator
  )
  returning id into new_id;
  return new_id;
end;
$$;
revoke all on function app.record_deadline(uuid, uuid, public.deadline_kind, text, date, date, date, timestamptz, text, text, date, uuid, text, text) from public;

create function public.record_deadline(
  p_matter_id uuid,
  p_task_id uuid,
  p_kind public.deadline_kind,
  p_label text,
  p_event_on date,
  p_receipt_on date,
  p_due_on date,
  p_due_at timestamptz,
  p_timezone text,
  p_source_url text,
  p_source_retrieved_on date,
  p_rule_version_id uuid,
  p_calculation_note text,
  p_evidence_locator text
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select app.record_deadline(
    p_matter_id, p_task_id, p_kind, p_label, p_event_on, p_receipt_on, p_due_on, p_due_at,
    p_timezone, p_source_url, p_source_retrieved_on, p_rule_version_id, p_calculation_note, p_evidence_locator
  );
$$;
revoke all on function public.record_deadline(uuid, uuid, public.deadline_kind, text, date, date, date, timestamptz, text, text, date, uuid, text, text) from public, anon;
grant execute on function public.record_deadline(uuid, uuid, public.deadline_kind, text, date, date, date, timestamptz, text, text, date, uuid, text, text)
  to authenticated, service_role;

create function app.confirm_deadline(p_deadline_id uuid, p_expected_version integer)
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
    raise exception 'deadline version conflict' using errcode = '40001';
  end if;
  if deadline.kind in ('legal', 'correspondence') then
    perform app.require_active_staff(
      deadline.organization_id,
      array['licensed_consultant']::public.org_role[],
      true
    );
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
revoke all on function app.confirm_deadline(uuid, integer) from public;

create function public.confirm_deadline(p_deadline_id uuid, p_expected_version integer)
returns integer
language sql
security invoker
set search_path = ''
as $$
  select app.confirm_deadline(p_deadline_id, p_expected_version);
$$;
revoke all on function public.confirm_deadline(uuid, integer) from public, anon;
grant execute on function public.confirm_deadline(uuid, integer) to authenticated, service_role;

create function app.schedule_deadline_reminders(p_deadline_id uuid, p_as_of timestamptz)
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
    slot := due_instant - make_interval(days => offset_day);
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
revoke all on function app.schedule_deadline_reminders(uuid, timestamptz) from public;

create function public.schedule_deadline_reminders(p_deadline_id uuid, p_as_of timestamptz)
returns integer
language sql
security invoker
set search_path = ''
as $$
  select app.schedule_deadline_reminders(p_deadline_id, p_as_of);
$$;
revoke all on function public.schedule_deadline_reminders(uuid, timestamptz) from public, anon;
grant execute on function public.schedule_deadline_reminders(uuid, timestamptz) to authenticated, service_role;

create function app.revise_deadline_due(
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
    raise exception 'deadline version conflict' using errcode = '40001';
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
revoke all on function app.revise_deadline_due(uuid, integer, date, timestamptz, text) from public;

create function public.revise_deadline_due(
  p_deadline_id uuid,
  p_expected_version integer,
  p_due_on date,
  p_due_at timestamptz,
  p_timezone text
)
returns integer
language sql
security invoker
set search_path = ''
as $$
  select app.revise_deadline_due(p_deadline_id, p_expected_version, p_due_on, p_due_at, p_timezone);
$$;
revoke all on function public.revise_deadline_due(uuid, integer, date, timestamptz, text) from public, anon;
grant execute on function public.revise_deadline_due(uuid, integer, date, timestamptz, text)
  to authenticated, service_role;

create function public.claim_due_reminders(p_limit integer, p_as_of timestamptz)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  ids uuid[];
begin
  if coalesce((select auth.jwt() ->> 'role'), '') is distinct from 'service_role' then
    raise exception 'worker role required' using errcode = '42501';
  end if;
  with due as (
    select id
    from public.reminder_schedules
    where status = 'pending'
      and scheduled_for <= coalesce(p_as_of, statement_timestamp())
    order by scheduled_for
    for update skip locked
    limit least(greatest(coalesce(p_limit, 20), 1), 100)
  ),
  marked as (
    update public.reminder_schedules schedule
    set status = 'sent',
        sent_at = statement_timestamp()
    from due
    where schedule.id = due.id
    returning schedule.id
  )
  select coalesce(array_agg(id), array[]::uuid[]) into ids from marked;
  return ids;
end;
$$;
revoke all on function public.claim_due_reminders(integer, timestamptz) from public, anon, authenticated;
grant execute on function public.claim_due_reminders(integer, timestamptz) to service_role;

create function app.escalate_overdue_work(p_as_of timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid := app.current_organization_id();
  as_of timestamptz := coalesce(p_as_of, statement_timestamp());
  made integer := 0;
  rec record;
begin
  perform app.require_active_staff(
    org,
    array['firm_owner', 'licensed_consultant']::public.org_role[],
    false
  );
  for rec in
    select task.id, task.organization_id, task.matter_id, task.version
    from public.tasks task
    left join public.matters matter on matter.id = task.matter_id
    where task.organization_id = org
      and task.status = 'open'
      and task.priority = 'critical'
      and task.escalated_at is null
      and app.deadline_due_instant(task.due_on, task.due_at, task.due_timezone) <= as_of
  loop
    perform app.open_task_write(rec.id);
    update public.tasks set escalated_at = as_of where id = rec.id;
    perform app.close_task_write(rec.id);
    insert into public.task_events (organization_id, task_id, event_kind, actor_user_id)
    values (rec.organization_id, rec.id, 'escalated', (select auth.uid()));
    perform app.enqueue_event(
      rec.organization_id,
      'task',
      rec.id,
      'task.overdue',
      jsonb_build_object('task_id', rec.id, 'matter_id', rec.matter_id),
      rec.version,
      'task.overdue:' || rec.id::text
    );
    made := made + 1;
  end loop;

  for rec in
    select deadline.id, deadline.organization_id, deadline.matter_id, deadline.version, deadline.kind
    from public.deadlines deadline
    join public.matters matter on matter.id = deadline.matter_id
    where deadline.organization_id = org
      and deadline.escalated_at is null
      and deadline.kind in ('legal', 'correspondence')
      and app.deadline_due_instant(deadline.due_on, deadline.due_at, deadline.timezone) <= as_of
  loop
    update public.deadlines set escalated_at = as_of where id = rec.id;
    perform app.enqueue_event(
      rec.organization_id,
      'deadline',
      rec.id,
      'task.overdue',
      jsonb_build_object('deadline_id', rec.id, 'matter_id', rec.matter_id, 'kind', rec.kind),
      rec.version,
      'deadline.overdue:' || rec.id::text
    );
    made := made + 1;
  end loop;
  return made;
end;
$$;
comment on function app.escalate_overdue_work(timestamptz) is
  'Critical open tasks and legal or correspondence deadlines. A matter on hold does not skip the deadline branch.';
revoke all on function app.escalate_overdue_work(timestamptz) from public;

create function public.escalate_overdue_work(p_as_of timestamptz)
returns integer
language sql
security invoker
set search_path = ''
as $$
  select app.escalate_overdue_work(p_as_of);
$$;
revoke all on function public.escalate_overdue_work(timestamptz) from public, anon;
grant execute on function public.escalate_overdue_work(timestamptz) to authenticated, service_role;

create function app.set_quiet_hours(p_start time, p_end time)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid := app.current_organization_id();
begin
  perform app.require_active_staff(org, array['firm_owner']::public.org_role[], true);
  if (p_start is null) is distinct from (p_end is null) then
    raise exception 'quiet hours need both a start and an end' using errcode = '22023';
  end if;
  update public.organizations
  set quiet_hours_start = p_start,
      quiet_hours_end = p_end
  where id = org;
  perform app.record_audit_event(
    org,
    'firm.quiet_hours_set',
    'public.organizations',
    org,
    'success',
    jsonb_build_object('enabled', p_start is not null)
  );
end;
$$;
revoke all on function app.set_quiet_hours(time, time) from public;

create function public.set_quiet_hours(p_start time, p_end time)
returns void
language sql
security invoker
set search_path = ''
as $$
  select app.set_quiet_hours(p_start, p_end);
$$;
revoke all on function public.set_quiet_hours(time, time) from public, anon;
grant execute on function public.set_quiet_hours(time, time) to authenticated, service_role;

create function app.set_firm_reminder_offsets(p_days integer[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid := app.current_organization_id();
  day_value integer;
begin
  perform app.require_active_staff(org, array['firm_owner']::public.org_role[], true);
  if p_days is null or cardinality(p_days) < 1 or cardinality(p_days) > 12 then
    raise exception 'choose between 1 and 12 reminder offsets' using errcode = '22023';
  end if;
  delete from public.firm_reminder_offsets where organization_id = org;
  foreach day_value in array p_days
  loop
    if day_value is null or day_value < 1 or day_value > 365 then
      raise exception 'a reminder offset is between 1 and 365 days' using errcode = '22023';
    end if;
    insert into public.firm_reminder_offsets (organization_id, offset_days)
    values (org, day_value)
    on conflict (organization_id, offset_days) do nothing;
  end loop;
end;
$$;
revoke all on function app.set_firm_reminder_offsets(integer[]) from public;

create function public.set_firm_reminder_offsets(p_days integer[])
returns void
language sql
security invoker
set search_path = ''
as $$
  select app.set_firm_reminder_offsets(p_days);
$$;
revoke all on function public.set_firm_reminder_offsets(integer[]) from public, anon;
grant execute on function public.set_firm_reminder_offsets(integer[]) to authenticated, service_role;

create function app.ensure_majority_review_task(p_person_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  person public.persons%rowtype;
  org public.organizations%rowtype;
  owner uuid;
  existing uuid;
  new_id uuid;
begin
  select * into person from public.persons where id = p_person_id;
  if person.id is null then
    return null;
  end if;
  select id into existing
  from public.tasks
  where organization_id = person.organization_id
    and person_id = person.id
    and task_key = 'majority_review'
    and status in ('open', 'blocked');
  if existing is not null then
    return existing;
  end if;
  select * into org from public.organizations where id = person.organization_id;
  select mem.id into owner
  from public.memberships mem
  where mem.organization_id = person.organization_id
    and mem.role = 'firm_owner'
    and mem.status = 'active'
  order by mem.created_at
  limit 1;
  if owner is null then
    return null;
  end if;
  insert into public.tasks (
    organization_id, person_id, audience, title, priority, owner_membership_id,
    due_on, due_timezone, task_key
  ) values (
    person.organization_id,
    person.id,
    'internal',
    'Majority review',
    'critical',
    owner,
    (statement_timestamp() at time zone org.timezone)::date,
    org.timezone,
    'majority_review'
  )
  returning id into new_id;
  insert into public.task_events (organization_id, task_id, event_kind, to_status)
  values (person.organization_id, new_id, 'created', 'open');
  return new_id;
end;
$$;
comment on function app.ensure_majority_review_task(uuid) is
  'Opens one internal task when a person is no longer recorded as a minor. The birth date is not copied onto the task.';
revoke all on function app.ensure_majority_review_task(uuid) from public;

create function public.open_majority_review_task(p_person_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  person public.persons%rowtype;
begin
  select * into person from public.persons where id = p_person_id;
  if person.id is null or app.can_read_person(person.id) is distinct from true then
    raise exception 'majority review denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    person.organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[],
    false
  );
  return app.ensure_majority_review_task(p_person_id);
end;
$$;
revoke all on function public.open_majority_review_task(uuid) from public, anon;
grant execute on function public.open_majority_review_task(uuid) to authenticated, service_role;

create function app.open_majority_review_from_person()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and old.is_minor is true
     and new.is_minor is distinct from true
     and new.date_of_birth is not null then
    perform app.ensure_majority_review_task(new.id);
  end if;
  return new;
end;
$$;
revoke all on function app.open_majority_review_from_person() from public;

create trigger persons_zz_majority_task after update on public.persons
  for each row execute function app.open_majority_review_from_person();

create function app.flag_tasks_for_intake_answer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  response public.intake_responses%rowtype;
  task_id uuid;
begin
  if not exists (
    select 1 from public.intake_snapshots snap where snap.response_id = new.response_id
  ) then
    return new;
  end if;
  select * into response from public.intake_responses where id = new.response_id;
  for task_id in
    select task.id
    from public.tasks task
    where task.matter_id = response.matter_id
      and task.intake_field_key = new.field_key
      and task.intake_stale is false
  loop
    perform app.open_task_write(task_id);
    update public.tasks set intake_stale = true where id = task_id;
    perform app.close_task_write(task_id);
    insert into public.task_events (organization_id, task_id, event_kind, actor_user_id)
    values (response.organization_id, task_id, 'intake_flagged', (select auth.uid()));
  end loop;
  return new;
end;
$$;
revoke all on function app.flag_tasks_for_intake_answer() from public;

create trigger intake_answer_versions_flag_tasks after insert on public.intake_answer_versions
  for each row execute function app.flag_tasks_for_intake_answer();

revoke all on table public.firm_reminder_offsets from anon, authenticated;
revoke all on table public.tasks from anon, authenticated;
revoke all on table public.task_watchers from anon, authenticated;
revoke all on table public.task_dependencies from anon, authenticated;
revoke all on table public.task_events from anon, authenticated;
revoke all on table public.deadlines from anon, authenticated;
revoke all on table public.reminder_schedules from anon, authenticated;
grant select on table public.firm_reminder_offsets to authenticated;
grant select on table public.tasks to authenticated;
grant select on table public.task_watchers to authenticated;
grant select on table public.task_dependencies to authenticated;
grant select on table public.task_events to authenticated;
grant select on table public.deadlines to authenticated;
grant select on table public.reminder_schedules to authenticated;

alter table public.firm_reminder_offsets enable row level security;
alter table public.firm_reminder_offsets force row level security;
alter table public.tasks enable row level security;
alter table public.tasks force row level security;
alter table public.task_watchers enable row level security;
alter table public.task_watchers force row level security;
alter table public.task_dependencies enable row level security;
alter table public.task_dependencies force row level security;
alter table public.task_events enable row level security;
alter table public.task_events force row level security;
alter table public.deadlines enable row level security;
alter table public.deadlines force row level security;
alter table public.reminder_schedules enable row level security;
alter table public.reminder_schedules force row level security;

create policy firm_reminder_offsets_select on public.firm_reminder_offsets
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.staff_mfa_satisfied())
    and (select app.is_org_staff(organization_id))
  );
create policy tasks_select on public.tasks
  for select to authenticated
  using ((select app.can_read_task(id)));
create policy task_watchers_select on public.task_watchers
  for select to authenticated
  using ((select app.can_read_task(task_id)));
create policy task_dependencies_select on public.task_dependencies
  for select to authenticated
  using ((select app.can_read_task(task_id)));
create policy task_events_select on public.task_events
  for select to authenticated
  using ((select app.can_read_task(task_id)));
create policy deadlines_select on public.deadlines
  for select to authenticated
  using ((select app.can_read_matter(matter_id)));
create policy reminder_schedules_select on public.reminder_schedules
  for select to authenticated
  using (
    (select app.staff_mfa_satisfied())
    and (select app.is_org_staff(organization_id))
    and organization_id = (select app.current_organization_id())
    and (
      task_id is null
      or (select app.can_read_task(task_id))
    )
  );

grant execute on function app.create_task(uuid, public.task_audience, text, uuid, uuid, public.task_priority, date, timestamptz, text, integer, text, jsonb) to authenticated, service_role;
grant execute on function app.set_task_status(uuid, integer, public.task_status, text) to authenticated, service_role;
grant execute on function app.reassign_task(uuid, integer, uuid, uuid) to authenticated, service_role;
grant execute on function app.add_task_dependency(uuid, uuid) to authenticated, service_role;
grant execute on function app.add_task_watcher(uuid, uuid) to authenticated, service_role;
grant execute on function app.record_deadline(uuid, uuid, public.deadline_kind, text, date, date, date, timestamptz, text, text, date, uuid, text, text) to authenticated, service_role;
grant execute on function app.confirm_deadline(uuid, integer) to authenticated, service_role;
grant execute on function app.schedule_deadline_reminders(uuid, timestamptz) to authenticated, service_role;
grant execute on function app.revise_deadline_due(uuid, integer, date, timestamptz, text) to authenticated, service_role;
grant execute on function app.escalate_overdue_work(timestamptz) to authenticated, service_role;
grant execute on function app.set_quiet_hours(time, time) to authenticated, service_role;
grant execute on function app.set_firm_reminder_offsets(integer[]) to authenticated, service_role;
grant execute on function app.ensure_majority_review_task(uuid) to authenticated, service_role;
