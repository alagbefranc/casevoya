-- OPS-01 (gap #179): the task detail (watchers, depends on, checklist, estimate, blocker,
-- due time and timezone), recurring tasks, and escalation of every overdue open task.
-- Additive only.
--
-- New columns: tasks.recurrence ('weekly' or 'monthly', null when it does not repeat) and
-- tasks.recurrence_parent_id (the occurrence this one was created from when it was completed).
--
-- New functions (security definer, search_path ''; public wrappers are security invoker):
--   app/public.update_task_details    estimate, due time, due timezone, recurrence
--   app/public.set_task_checklist     the whole checklist, as {text, done} items
--   app/public.remove_task_watcher    the counterpart of add_task_watcher
--   app/public.remove_task_dependency the counterpart of add_task_dependency
--
-- Redefined, each copied from its latest definition:
--   app.set_task_status (20261023090000_version_conflicts_not_retried.sql): only change, completing
--     a recurring task creates its next occurrence (title, owner, priority, estimate, unticked
--     checklist, timezone, repeat and watchers carried over), due a week or a month after the
--     completed one's due date (the firm's today, app.firm_today, when it had none), stepped
--     until it is not before the firm's today. Once per completed task.
--   app.escalate_overdue_work (20261017170200_tasks_deadlines.sql): only change, every overdue
--     open task is escalated, not only critical ones (OPS-01 "overdue -> notify owner's lead";
--     decision 2026-10-24, pending Francis). The in-app notification to the matter's responsible
--     consultant is the 'task' branch of app.staff_notification_items (20261025100100).

alter table public.tasks
  add column recurrence text,
  add column recurrence_parent_id uuid;
alter table public.tasks
  add constraint tasks_recurrence_check check (recurrence is null or recurrence in ('weekly', 'monthly')),
  add constraint tasks_recurrence_parent_fk
    foreign key (recurrence_parent_id, organization_id) references public.tasks (id, organization_id);
comment on column public.tasks.recurrence is
  'weekly or monthly: completing the task creates its next occurrence, stepped on the firm''s calendar. Null: does not repeat.';
comment on column public.tasks.recurrence_parent_id is 'The completed occurrence this task was created from.';
create index tasks_recurrence_parent_org_fk_idx on public.tasks (recurrence_parent_id, organization_id);

create function app.update_task_details(
  p_task_id uuid,
  p_expected_version integer,
  p_estimated_minutes integer,
  p_due_time time,
  p_due_timezone text,
  p_recurrence text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  task public.tasks%rowtype;
  zone text;
  repeat_kind text := nullif(btrim(coalesce(p_recurrence, '')), '');
  next_due_at timestamptz;
  new_version integer;
begin
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
  if p_estimated_minutes is not null and p_estimated_minutes not between 0 and 100000 then
    raise exception 'a task estimate is 0 to 100000 minutes' using errcode = '22023';
  end if;
  if repeat_kind is not null and repeat_kind not in ('weekly', 'monthly') then
    raise exception 'a task repeats weekly or monthly' using errcode = '22023';
  end if;
  zone := app.usable_timezone(coalesce(nullif(btrim(coalesce(p_due_timezone, '')), ''), task.due_timezone));
  if p_due_time is not null then
    if task.due_on is null then
      raise exception 'a due time needs a due date' using errcode = '22023';
    end if;
    next_due_at := (task.due_on + p_due_time) at time zone zone;
  elsif task.due_on is null then
    -- A due instant without a date (create_task allows it) is kept: there is no date to put a time on.
    next_due_at := task.due_at;
  end if;
  if task.estimated_minutes is not distinct from p_estimated_minutes
     and task.due_at is not distinct from next_due_at
     and task.due_timezone = zone
     and task.recurrence is not distinct from repeat_kind then
    return task.version;
  end if;

  perform app.open_task_write(task.id);
  update public.tasks
  set estimated_minutes = p_estimated_minutes,
      due_at = next_due_at,
      due_timezone = zone,
      recurrence = repeat_kind
  where id = task.id
  returning version into new_version;
  perform app.close_task_write(task.id);
  perform app.record_audit_event(
    task.organization_id, 'task.details_updated', 'public.tasks', task.id, 'success',
    jsonb_build_object(
      'matter_id', task.matter_id,
      'estimated_minutes', p_estimated_minutes,
      'due_timezone', zone,
      'due_time', p_due_time,
      'recurrence', repeat_kind
    )
  );
  return new_version;
end;
$$;
revoke all on function app.update_task_details(uuid, integer, integer, time, text, text) from public, anon;
grant execute on function app.update_task_details(uuid, integer, integer, time, text, text) to authenticated, service_role;

create function public.update_task_details(
  p_task_id uuid,
  p_expected_version integer,
  p_estimated_minutes integer,
  p_due_time time,
  p_due_timezone text,
  p_recurrence text
)
returns integer
language sql
security invoker
set search_path = ''
as $$
  select app.update_task_details(p_task_id, p_expected_version, p_estimated_minutes, p_due_time, p_due_timezone, p_recurrence);
$$;
revoke all on function public.update_task_details(uuid, integer, integer, time, text, text) from public, anon;
grant execute on function public.update_task_details(uuid, integer, integer, time, text, text) to authenticated, service_role;

create function app.set_task_checklist(p_task_id uuid, p_expected_version integer, p_checklist jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  task public.tasks%rowtype;
  cleaned jsonb := '[]'::jsonb;
  item jsonb;
  new_version integer;
begin
  if p_checklist is null or jsonb_typeof(p_checklist) is distinct from 'array' then
    raise exception 'a task checklist must be a list' using errcode = '22023';
  end if;
  if jsonb_array_length(p_checklist) > 50 then
    raise exception 'a task checklist holds up to 50 items' using errcode = '22023';
  end if;
  for item in select elem from jsonb_array_elements(p_checklist) elem loop
    if jsonb_typeof(item) is distinct from 'object'
       or jsonb_typeof(item -> 'text') is distinct from 'string'
       or length(btrim(item ->> 'text')) not between 1 and 200
       or (item ? 'done' and jsonb_typeof(item -> 'done') is distinct from 'boolean') then
      raise exception 'a checklist item needs text of 1 to 200 characters' using errcode = '22023';
    end if;
    cleaned := cleaned || jsonb_build_array(
      jsonb_build_object('text', btrim(item ->> 'text'), 'done', coalesce((item ->> 'done')::boolean, false))
    );
  end loop;

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
  if cleaned = task.checklist then
    return task.version;
  end if;

  perform app.open_task_write(task.id);
  update public.tasks set checklist = cleaned where id = task.id returning version into new_version;
  perform app.close_task_write(task.id);
  perform app.record_audit_event(
    task.organization_id, 'task.checklist_updated', 'public.tasks', task.id, 'success',
    jsonb_build_object(
      'matter_id', task.matter_id,
      'items', jsonb_array_length(cleaned),
      'done', (select count(*) from jsonb_array_elements(cleaned) elem where (elem ->> 'done')::boolean)
    )
  );
  return new_version;
end;
$$;
revoke all on function app.set_task_checklist(uuid, integer, jsonb) from public, anon;
grant execute on function app.set_task_checklist(uuid, integer, jsonb) to authenticated, service_role;

create function public.set_task_checklist(p_task_id uuid, p_expected_version integer, p_checklist jsonb)
returns integer
language sql
security invoker
set search_path = ''
as $$
  select app.set_task_checklist(p_task_id, p_expected_version, p_checklist);
$$;
revoke all on function public.set_task_checklist(uuid, integer, jsonb) from public, anon;
grant execute on function public.set_task_checklist(uuid, integer, jsonb) to authenticated, service_role;

create function app.remove_task_watcher(p_task_id uuid, p_membership_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  task public.tasks%rowtype;
  removed integer;
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
  delete from public.task_watchers
  where task_id = task.id
    and organization_id = task.organization_id
    and membership_id = p_membership_id;
  get diagnostics removed = row_count;
  return removed > 0;
end;
$$;
revoke all on function app.remove_task_watcher(uuid, uuid) from public, anon;
grant execute on function app.remove_task_watcher(uuid, uuid) to authenticated, service_role;

create function public.remove_task_watcher(p_task_id uuid, p_membership_id uuid)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  select app.remove_task_watcher(p_task_id, p_membership_id);
$$;
revoke all on function public.remove_task_watcher(uuid, uuid) from public, anon;
grant execute on function public.remove_task_watcher(uuid, uuid) to authenticated, service_role;

create function app.remove_task_dependency(p_task_id uuid, p_depends_on_task_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  task public.tasks%rowtype;
  removed integer;
begin
  select * into task from public.tasks where id = p_task_id;
  if task.id is null or app.can_read_task(task.id) is distinct from true then
    raise exception 'task dependency denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    task.organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[],
    false
  );
  delete from public.task_dependencies
  where task_id = task.id
    and organization_id = task.organization_id
    and depends_on_task_id = p_depends_on_task_id;
  get diagnostics removed = row_count;
  return removed > 0;
end;
$$;
revoke all on function app.remove_task_dependency(uuid, uuid) from public, anon;
grant execute on function app.remove_task_dependency(uuid, uuid) to authenticated, service_role;

create function public.remove_task_dependency(p_task_id uuid, p_depends_on_task_id uuid)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  select app.remove_task_dependency(p_task_id, p_depends_on_task_id);
$$;
revoke all on function public.remove_task_dependency(uuid, uuid) from public, anon;
grant execute on function public.remove_task_dependency(uuid, uuid) to authenticated, service_role;

-- app.set_task_status(uuid,integer,public.task_status,text), last defined in 20261023090000_version_conflicts_not_retried.sql
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
  firm_day date;
  base_day date;
  next_day date;
  step_n integer;
  next_at timestamptz;
  next_id uuid;
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

  -- OPS-01: a recurring task's next occurrence, once, stepped on the firm's calendar.
  if p_status = 'done'
     and task.status is distinct from 'done'
     and task.recurrence in ('weekly', 'monthly')
     and not exists (select 1 from public.tasks later where later.recurrence_parent_id = task.id) then
    firm_day := app.firm_today(task.organization_id);
    base_day := coalesce(task.due_on, firm_day);
    step_n := 1;
    loop
      next_day := (base_day + case
        when task.recurrence = 'weekly' then make_interval(days => 7 * step_n)
        else make_interval(months => step_n)
      end)::date;
      exit when next_day >= firm_day or step_n >= 1000;
      step_n := step_n + 1;
    end loop;
    if task.due_at is not null then
      next_at := (next_day + (task.due_at at time zone task.due_timezone)::time) at time zone task.due_timezone;
    end if;
    insert into public.tasks (
      organization_id, matter_id, person_id, audience, title, priority, owner_membership_id, owner_person_id,
      due_on, due_at, due_timezone, estimated_minutes, checklist, recurrence, recurrence_parent_id
    ) values (
      task.organization_id,
      task.matter_id,
      task.person_id,
      task.audience,
      task.title,
      task.priority,
      task.owner_membership_id,
      task.owner_person_id,
      next_day,
      next_at,
      task.due_timezone,
      task.estimated_minutes,
      coalesce((
        select jsonb_agg(jsonb_build_object('text', elem ->> 'text', 'done', false) order by ord)
        from jsonb_array_elements(task.checklist) with ordinality as list(elem, ord)
        where jsonb_typeof(elem) = 'object' and jsonb_typeof(elem -> 'text') = 'string'
      ), '[]'::jsonb),
      task.recurrence,
      task.id
    )
    returning id into next_id;
    insert into public.task_events (organization_id, task_id, event_kind, to_status, actor_user_id)
    values (task.organization_id, next_id, 'created', 'open', (select auth.uid()));
    insert into public.task_watchers (organization_id, task_id, membership_id)
    select task.organization_id, next_id, watcher.membership_id
    from public.task_watchers watcher
    where watcher.task_id = task.id
      and watcher.organization_id = task.organization_id;
    perform app.record_audit_event(
      task.organization_id, 'task.recurred', 'public.tasks', next_id, 'success',
      jsonb_build_object('matter_id', task.matter_id, 'from_task_id', task.id, 'recurrence', task.recurrence, 'due_on', next_day)
    );
  end if;
  return new_version;
end;
$$;

-- app.escalate_overdue_work(timestamptz), last defined in 20261017170200_tasks_deadlines.sql
create or replace function app.escalate_overdue_work(p_as_of timestamptz)
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
  'Every overdue open task (OPS-01, 2026-10-24) and legal or correspondence deadlines. A matter on hold does not skip the deadline branch. The matter''s responsible consultant sees an escalated task in app.staff_notification_items.';
