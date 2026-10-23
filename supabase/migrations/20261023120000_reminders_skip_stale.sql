-- Deadline reminders: a reminder whose deadline (or task) is already past is skipped, not sent.
--
-- Until now nothing called public.claim_due_reminders, so no reminder was ever sent: they stayed
-- 'pending' (the Automations page showed them as Scheduled). The mail dispatcher (pg_cron
-- casevoya-mail-dispatch, every minute) now claims due reminders before it sends mail. Turning
-- that on must not send a client a late notice for a date that has already gone by, so before
-- claiming, this redefinition cancels the due reminders that are stale:
--   * a deadline reminder whose deadline is past (its due_at, or the end of its due date in the
--     deadline's own timezone, app.deadline_due_instant);
--   * a task reminder whose task is done or cancelled, or whose due date has ended in the firm's
--     timezone.
-- Cancelled reminders show as Stopped on the Automations page. Everything else is as before
-- (latest definition: 20261017200100_outbound_email.sql): service role only, at most 100 at a
-- time, each claimed reminder marked sent and queued once as a 'reminder.due' mail event.
--
-- No table, type, policy or RLS change; same signature and grants.

create or replace function public.claim_due_reminders(p_limit integer, p_as_of timestamptz)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  ids uuid[];
  rec record;
  as_of timestamptz := coalesce(p_as_of, statement_timestamp());
begin
  if coalesce((select auth.jwt() ->> 'role'), '') is distinct from 'service_role' then
    raise exception 'worker role required' using errcode = '42501';
  end if;

  -- Stale: the date it reminds about has already gone by. Skipped, never sent late.
  update public.reminder_schedules schedule
  set status = 'cancelled'
  from public.deadlines deadline
  where schedule.deadline_id = deadline.id
    and schedule.status = 'pending'
    and schedule.scheduled_for <= as_of
    and app.deadline_due_instant(deadline.due_on, deadline.due_at, deadline.timezone) <= as_of;

  update public.reminder_schedules schedule
  set status = 'cancelled'
  from public.tasks task
  join public.organizations org on org.id = task.organization_id
  where schedule.task_id = task.id
    and schedule.deadline_id is null
    and schedule.status = 'pending'
    and schedule.scheduled_for <= as_of
    and (
      task.status in ('done', 'cancelled')
      or (task.due_on is not null and public.deadline_local_end(task.due_on, org.timezone) <= as_of)
    );

  with due as (
    select id
    from public.reminder_schedules
    where status = 'pending'
      and scheduled_for <= as_of
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

  for rec in
    select schedule.id,
           schedule.organization_id,
           schedule.reminder_kind,
           schedule.deadline_id,
           schedule.task_id,
           coalesce(deadline.matter_id, task.matter_id) as matter_id
    from public.reminder_schedules schedule
    left join public.deadlines deadline on deadline.id = schedule.deadline_id
    left join public.tasks task on task.id = schedule.task_id
    where schedule.id = any (ids)
  loop
    perform app.enqueue_event(
      rec.organization_id,
      'reminder',
      rec.id,
      'reminder.due',
      jsonb_build_object(
        'reminder_id', rec.id,
        'deadline_id', rec.deadline_id,
        'task_id', rec.task_id,
        'reminder_kind', rec.reminder_kind,
        'matter_id', rec.matter_id
      ),
      null,
      'reminder.due:' || rec.id::text,
      null
    );
  end loop;
  return ids;
end;
$$;
