-- Firm automations (2026-10-30, Francis): a firm builds its own automations on the Automations page.
--
-- Until now the page showed one built-in rule, "Deadline reminders", as a fixed step list: the
-- firm owner could change its reminder days and quiet hours, nothing else. This adds the firm's own
-- automations, limited to what the reminder job really runs (OPS-07: no free-form scripting):
--   trigger    a deadline with a due date is saved on a matter (app.schedule_deadline_reminders);
--   condition  the deadline's kind (legal, correspondence, internal);
--   action     the approved 'reminder' email to the matter's clients who opted into deadline
--              reminders, and the staff in-app notice (the reminder.due mail event, unchanged);
--   timing     whole days before the due date (1 to 365, at most 12); quiet hours and the
--              due-within-a-day exception apply as for the built-in rule;
--   status     active or paused (paused adds nothing).
-- The built-in rule stays as it is (locked); a firm can copy it into an automation and edit the copy.
-- A deadline now gets reminders on the built-in days plus the days of every active firm automation
-- whose kinds include it; a day in both is still one reminder (same idempotency key). Changes
-- apply to deadlines saved afterwards, as with Reminder settings. Additive only.
--
-- New: public.firm_automations (RLS forced; staff of the firm read; written only by the functions),
-- public.save_firm_automation, public.set_firm_automation_paused (firm owner or licensed consultant,
-- recent step-up, audited), app.deadline_reminder_days. Redefined: app.schedule_deadline_reminders
-- (latest definition 20261020130000_work_pages_fixes.sql; only change: the reminder days).

create table public.firm_automations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  name text not null check (length(btrim(name)) between 1 and 120),
  status text not null default 'active' check (status in ('active', 'paused')),
  trigger_kind text not null default 'deadline_saved' check (trigger_kind = 'deadline_saved'),
  deadline_kinds public.deadline_kind[] not null check (cardinality(deadline_kinds) between 1 and 3),
  action_kind text not null default 'client_reminder_email' check (action_kind = 'client_reminder_email'),
  offset_days integer[] not null check (cardinality(offset_days) between 1 and 12),
  copied_from text check (copied_from is null or copied_from = 'builtin_deadline_reminders'),
  paused_at timestamptz,
  created_by uuid references auth.users (id),
  updated_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id),
  check ((status = 'paused') = (paused_at is not null))
);
comment on table public.firm_automations is
  'A firm''s own automation (2026-10-30): when a deadline of the chosen kinds is saved, email the approved client reminder the chosen days before. Written only by save_firm_automation and set_firm_automation_paused.';

create index firm_automations_org_idx on public.firm_automations (organization_id, status);
create index firm_automations_created_by_idx on public.firm_automations (created_by);
create index firm_automations_updated_by_idx on public.firm_automations (updated_by);

alter table public.firm_automations enable row level security;
alter table public.firm_automations force row level security;
revoke all on table public.firm_automations from anon, authenticated;
grant select on table public.firm_automations to authenticated;
grant select, insert, update on table public.firm_automations to service_role;

create policy firm_automations_select on public.firm_automations
  for select to authenticated
  using ((select app.staff_mfa_satisfied()) and (select app.is_org_staff(organization_id)));

create trigger firm_automations_touch before update on public.firm_automations
  for each row execute function app.touch_row();
create trigger firm_automations_audit after insert or update on public.firm_automations
  for each row execute function app.audit_row_change();
create trigger firm_automations_no_delete before delete on public.firm_automations
  for each row execute function app.reject_governed_delete();
create trigger firm_automations_no_truncate before truncate on public.firm_automations
  for each statement execute function app.reject_governed_delete();

-- Who may write: an active firm owner or licensed consultant of the current firm, recent step-up
-- (the same bar as Reminder settings: these send client email).
create function app.firm_automation_editor()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid := app.current_organization_id();
begin
  if org is null then
    raise exception 'automation denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(org, array['firm_owner', 'licensed_consultant']::public.org_role[], true);
  return org;
end;
$$;
revoke all on function app.firm_automation_editor() from public;

create function public.save_firm_automation(
  p_automation_id uuid,
  p_expected_version integer,
  p_name text,
  p_deadline_kinds text[],
  p_offset_days integer[],
  p_copied_from text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid := app.firm_automation_editor();
  rule public.firm_automations%rowtype;
  v_name text := btrim(coalesce(p_name, ''));
  v_kinds public.deadline_kind[];
  v_days integer[];
  v_kind text;
  day_value integer;
  created boolean := p_automation_id is null;
begin
  if length(v_name) not between 1 and 120 then
    raise exception 'give the automation a name of up to 120 characters' using errcode = '22023';
  end if;
  if p_deadline_kinds is null or cardinality(p_deadline_kinds) < 1 then
    raise exception 'choose at least one kind of deadline' using errcode = '22023';
  end if;
  foreach v_kind in array p_deadline_kinds loop
    if v_kind is null or v_kind not in ('legal', 'correspondence', 'internal') then
      raise exception 'that kind of deadline is not usable' using errcode = '22023';
    end if;
  end loop;
  select array_agg(distinct k::public.deadline_kind order by k::public.deadline_kind) into v_kinds from unnest(p_deadline_kinds) k;
  if p_offset_days is null or cardinality(p_offset_days) < 1 then
    raise exception 'choose between 1 and 12 reminder days' using errcode = '22023';
  end if;
  foreach day_value in array p_offset_days loop
    if day_value is null or day_value < 1 or day_value > 365 then
      raise exception 'a reminder day is between 1 and 365 days before' using errcode = '22023';
    end if;
  end loop;
  select array_agg(distinct d order by d desc) into v_days from unnest(p_offset_days) d;
  if cardinality(v_days) > 12 then
    raise exception 'choose between 1 and 12 reminder days' using errcode = '22023';
  end if;
  if p_copied_from is not null and p_copied_from <> 'builtin_deadline_reminders' then
    raise exception 'that automation cannot be copied' using errcode = '22023';
  end if;
  if created then
    insert into public.firm_automations (organization_id, name, deadline_kinds, offset_days, copied_from, created_by, updated_by)
    values (org, v_name, v_kinds, v_days, p_copied_from, (select auth.uid()), (select auth.uid()))
    returning * into rule;
  else
    select * into rule from public.firm_automations where id = p_automation_id for update;
    if rule.id is null or rule.organization_id is distinct from org then
      raise exception 'automation denied' using errcode = '42501';
    end if;
    if p_expected_version is null or rule.version is distinct from p_expected_version then
      raise exception 'someone else changed this automation; reload to see their version' using errcode = '40001';
    end if;
    update public.firm_automations
    set name = v_name, deadline_kinds = v_kinds, offset_days = v_days, updated_by = (select auth.uid())
    where id = rule.id
    returning * into rule;
  end if;
  perform app.record_audit_event(org, case when created then 'automation.created' else 'automation.saved' end, 'public.firm_automations', rule.id, 'success',
    jsonb_build_object('name', rule.name, 'deadline_kinds', to_jsonb(rule.deadline_kinds), 'offset_days', to_jsonb(rule.offset_days),
      'copied_from', rule.copied_from, 'version', rule.version));
  return jsonb_build_object('id', rule.id, 'version', rule.version);
end;
$$;
comment on function public.save_firm_automation(uuid, integer, text, text[], integer[], text) is
  'Firm automations: a firm owner or licensed consultant (recent step-up) creates an automation (id null; optionally a copy of the built-in rule) or changes one at the expected row version. Audited.';
revoke all on function public.save_firm_automation(uuid, integer, text, text[], integer[], text) from public, anon;
grant execute on function public.save_firm_automation(uuid, integer, text, text[], integer[], text) to authenticated;

create function public.set_firm_automation_paused(p_automation_id uuid, p_expected_version integer, p_paused boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid := app.firm_automation_editor();
  rule public.firm_automations%rowtype;
begin
  select * into rule from public.firm_automations where id = p_automation_id for update;
  if rule.id is null or rule.organization_id is distinct from org then
    raise exception 'automation denied' using errcode = '42501';
  end if;
  if p_expected_version is null or rule.version is distinct from p_expected_version then
    raise exception 'someone else changed this automation; reload to see their version' using errcode = '40001';
  end if;
  if coalesce(p_paused, false) = (rule.status = 'paused') then
    return jsonb_build_object('id', rule.id, 'version', rule.version);
  end if;
  update public.firm_automations
  set status = case when p_paused then 'paused' else 'active' end,
      paused_at = case when p_paused then statement_timestamp() else null end,
      updated_by = (select auth.uid())
  where id = rule.id
  returning * into rule;
  perform app.record_audit_event(org, case when p_paused then 'automation.paused' else 'automation.resumed' end, 'public.firm_automations', rule.id, 'success',
    jsonb_build_object('name', rule.name, 'version', rule.version));
  return jsonb_build_object('id', rule.id, 'version', rule.version);
end;
$$;
comment on function public.set_firm_automation_paused(uuid, integer, boolean) is
  'Firm automations: pause or resume one automation at the expected row version (firm owner or licensed consultant, recent step-up). Audited.';
revoke all on function public.set_firm_automation_paused(uuid, integer, boolean) from public, anon;
grant execute on function public.set_firm_automation_paused(uuid, integer, boolean) to authenticated;

-- The reminder days for one deadline: the built-in rule's days (app.reminder_offset_days) plus the
-- days of every active firm automation that covers the deadline's kind. Largest first, no repeats.
create function app.deadline_reminder_days(p_org uuid, p_kind public.deadline_kind)
returns integer[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct day_value order by day_value desc), array[]::integer[])
  from (
    select unnest(app.reminder_offset_days(p_org)) as day_value
    union
    select unnest(rule.offset_days)
    from public.firm_automations rule
    where rule.organization_id = p_org
      and rule.status = 'active'
      and p_kind = any (rule.deadline_kinds)
  ) days;
$$;
revoke all on function app.deadline_reminder_days(uuid, public.deadline_kind) from public;

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

  foreach offset_day in array app.deadline_reminder_days(deadline.organization_id, deadline.kind)
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
