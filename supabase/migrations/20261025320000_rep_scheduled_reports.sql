-- REP-03 (gap #185): scheduled reports.
--
-- A staff member who can see a report tab (Operations, Money, Processing and outcomes) schedules
-- it weekly or monthly, at a day and time in the firm's timezone, for staff of this firm who can
-- also see that tab. At send time the runner checks every recipient again: still an active staff
-- member of the firm, and still in a role that sees that tab (the same rule as canSeeTab in
-- src/modules/sheet/reports-load.ts: Money for firm_owner and finance_user; Operations and
-- Processing and outcomes for firm_owner, licensed_consultant and case_manager). Anyone who fails
-- is skipped and the skip is logged with its reason.
--
-- What a recipient gets is a link only: /sheet/reports?tab=<tab>&view=<range>, which needs them to
-- sign in and shows what their role and RLS allow at that moment. No report figures, no file and
-- no attachment are stored with a run, a delivery, a notification or the audit trail. Delivery is
-- in-app (a 'report' row in app.staff_notification_items, 20261025320100): no approved email
-- design exists for "your scheduled report is ready", so no email is sent (DECISIONS 2026-10-25).
--
-- Tables (forced RLS, no policies; read through public.scheduled_reports_overview):
--   scheduled_reports             one schedule (soft-deleted with deleted_at, never removed)
--   scheduled_report_recipients   who it goes to (staff of this firm)
--   scheduled_report_runs         each run, scheduled or "Run now (test)" (append-only)
--   scheduled_report_deliveries   each recipient of a run: delivered (with its link) or skipped
--                                 (with the reason) (append-only)
-- Functions:
--   app.report_tab_roles(tab)                         the roles that see a report tab
--   app.user_sees_report_tab(org, user, tab)          active membership in one of those roles
--   app.report_schedule_zone(org)                     the firm's timezone (America/Toronto fallback)
--   app.report_schedule_next_run(...)                 the next send time after a moment
--   app.deliver_scheduled_report(run)                 recipient recheck and delivery rows
--   public.scheduled_reports_overview(org)            staff: schedules of the tabs they can see
--   public.save_scheduled_report(...)                 create or edit (creator or firm owner)
--   public.set_scheduled_report_paused(id, paused)    pause or resume
--   public.delete_scheduled_report(id)                soft delete
--   public.run_scheduled_report_now(id)               "Run now (test)": deliver now, schedule unchanged
--   public.service_run_scheduled_reports(limit)       service role: send what is due, once per due time
--   app.kick_scheduled_reports()                      pg_cron every 5 minutes when one is due
-- Every action is audited (report.schedule_*), with the tab, range, frequency and counts only.
-- Additive only. Redefines no existing function.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create function app.report_tab_roles(p_tab text)
returns public.org_role[]
language sql
immutable
set search_path = ''
as $$
  select case p_tab
    when 'money' then array['firm_owner', 'finance_user']::public.org_role[]
    when 'ops' then array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[]
    when 'outcomes' then array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[]
    else array[]::public.org_role[]
  end;
$$;
revoke all on function app.report_tab_roles(text) from public;
grant execute on function app.report_tab_roles(text) to authenticated, service_role;
comment on function app.report_tab_roles(text) is
  'REP-03: the roles that see a report tab. Mirrors MONEY_ROLES and OPS_ROLES in src/modules/sheet/reports-present.ts (a test keeps them equal).';

create function app.user_sees_report_tab(p_org uuid, p_user uuid, p_tab text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.organization_id = p_org
      and m.user_id = p_user
      and m.status = 'active'
      and m.role = any (app.report_tab_roles(p_tab))
  );
$$;
revoke all on function app.user_sees_report_tab(uuid, uuid, text) from public, anon, authenticated;
grant execute on function app.user_sees_report_tab(uuid, uuid, text) to service_role;

create function app.report_schedule_zone(p_org uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  zone text;
begin
  select nullif(btrim(coalesce(org.timezone, '')), '') into zone from public.organizations org where org.id = p_org;
  if zone is null then
    return 'America/Toronto';
  end if;
  begin
    perform statement_timestamp() at time zone zone;
    return zone;
  exception when others then
    return 'America/Toronto';
  end;
end;
$$;
revoke all on function app.report_schedule_zone(uuid) from public, anon, authenticated;
grant execute on function app.report_schedule_zone(uuid) to service_role;

-- The first send time strictly after p_after: the weekday (ISO, 1 = Monday) or the day of the month
-- (1 to 28, so every month has it), at p_send_time on the firm's local clock.
create function app.report_schedule_next_run(
  p_org uuid,
  p_frequency text,
  p_weekday smallint,
  p_month_day smallint,
  p_send_time time,
  p_after timestamptz
)
returns timestamptz
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  zone text := app.report_schedule_zone(p_org);
  first_day date := (p_after at time zone zone)::date;
  candidate_day date;
  candidate timestamptz;
begin
  for step in 0..62 loop
    candidate_day := first_day + step;
    if (p_frequency = 'weekly' and extract(isodow from candidate_day) = p_weekday)
       or (p_frequency = 'monthly' and extract(day from candidate_day) = p_month_day) then
      candidate := (candidate_day + p_send_time) at time zone zone;
      if candidate > p_after then
        return candidate;
      end if;
    end if;
  end loop;
  return null;
end;
$$;
revoke all on function app.report_schedule_next_run(uuid, text, smallint, smallint, time, timestamptz) from public, anon, authenticated;
grant execute on function app.report_schedule_next_run(uuid, text, smallint, smallint, time, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.scheduled_reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  title text not null check (length(btrim(title)) between 2 and 120),
  tab text not null check (tab in ('ops', 'money', 'outcomes')),
  range_key text not null default '90d' check (range_key in ('90d', 'month', 'year')),
  frequency text not null check (frequency in ('weekly', 'monthly')),
  weekday smallint check (weekday is null or weekday between 1 and 7),
  month_day smallint check (month_day is null or month_day between 1 and 28),
  send_time time not null,
  paused boolean not null default false,
  next_run_at timestamptz,
  last_run_at timestamptz,
  deleted_at timestamptz,
  deleted_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references auth.users (id),
  updated_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id),
  check ((frequency = 'weekly') = (weekday is not null)),
  check ((frequency = 'monthly') = (month_day is not null)),
  check ((deleted_at is null) = (deleted_by is null))
);
comment on table public.scheduled_reports is
  'REP-03: a report tab sent on a schedule (weekly or monthly, at a time in the firm''s timezone) to staff of the firm, as a link only. Soft-deleted, never removed.';
comment on column public.scheduled_reports.send_time is 'The local time of day in the firm''s timezone (organizations.timezone).';
comment on column public.scheduled_reports.next_run_at is 'When the runner next sends it; null while paused or deleted.';

create index scheduled_reports_org_idx on public.scheduled_reports (organization_id, created_at desc);
create index scheduled_reports_due_idx on public.scheduled_reports (next_run_at) where deleted_at is null and not paused;
create index scheduled_reports_created_by_idx on public.scheduled_reports (created_by);
create index scheduled_reports_updated_by_idx on public.scheduled_reports (updated_by);
create index scheduled_reports_deleted_by_idx on public.scheduled_reports (deleted_by);

create table public.scheduled_report_recipients (
  schedule_id uuid not null,
  organization_id uuid not null references public.organizations (id),
  user_id uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  primary key (schedule_id, user_id),
  foreign key (schedule_id, organization_id) references public.scheduled_reports (id, organization_id)
);
comment on table public.scheduled_report_recipients is
  'REP-03: who a scheduled report goes to. Checked again at every send (active staff of the firm, in a role that sees the tab).';

create index scheduled_report_recipients_schedule_org_fk_idx on public.scheduled_report_recipients (schedule_id, organization_id);
create index scheduled_report_recipients_user_idx on public.scheduled_report_recipients (user_id);
create index scheduled_report_recipients_org_idx on public.scheduled_report_recipients (organization_id);

create table public.scheduled_report_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  schedule_id uuid not null,
  kind text not null check (kind in ('scheduled', 'test')),
  due_at timestamptz not null,
  run_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (schedule_id, organization_id) references public.scheduled_reports (id, organization_id),
  check ((kind = 'test') = (run_by is not null))
);
comment on table public.scheduled_report_runs is
  'REP-03: one send of a scheduled report, by the runner (scheduled, once per due time) or by a person (test). Holds no report content. Append-only.';

create unique index scheduled_report_runs_once_idx on public.scheduled_report_runs (schedule_id, due_at) where kind = 'scheduled';
create index scheduled_report_runs_schedule_org_fk_idx on public.scheduled_report_runs (schedule_id, organization_id);
create index scheduled_report_runs_org_idx on public.scheduled_report_runs (organization_id, created_at desc);
create index scheduled_report_runs_run_by_idx on public.scheduled_report_runs (run_by);

create table public.scheduled_report_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  run_id uuid not null,
  schedule_id uuid not null,
  user_id uuid not null references auth.users (id),
  status text not null check (status in ('delivered', 'skipped')),
  skip_reason text check (skip_reason is null or skip_reason in ('not_active_staff', 'role_cannot_see_tab')),
  link text check (link is null or link ~ '^/sheet/reports\?tab=(ops|money|outcomes)&view=(90d|month|year)$'),
  created_at timestamptz not null default now(),
  unique (run_id, user_id),
  foreign key (run_id, organization_id) references public.scheduled_report_runs (id, organization_id),
  foreign key (schedule_id, organization_id) references public.scheduled_reports (id, organization_id),
  check ((status = 'skipped') = (skip_reason is not null)),
  check ((status = 'delivered') = (link is not null))
);
comment on table public.scheduled_report_deliveries is
  'REP-03: what one recipient got from a run: a sign-in link to the report tab (delivered), or nothing, with the reason (skipped). Never the report itself. Append-only.';

create index scheduled_report_deliveries_run_org_fk_idx on public.scheduled_report_deliveries (run_id, organization_id);
create index scheduled_report_deliveries_schedule_org_fk_idx on public.scheduled_report_deliveries (schedule_id, organization_id);
create index scheduled_report_deliveries_user_idx on public.scheduled_report_deliveries (organization_id, user_id, created_at desc);
create index scheduled_report_deliveries_user_fk_idx on public.scheduled_report_deliveries (user_id);

-- Guards: schedules keep their firm and creator and are never removed; runs and deliveries are
-- the log, append-only.
create function app.guard_scheduled_report_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'scheduled reports are kept on record' using errcode = '42501';
  end if;
  if new.organization_id is distinct from old.organization_id
     or new.created_by is distinct from old.created_by
     or (old.deleted_at is not null and new.deleted_at is distinct from old.deleted_at) then
    raise exception 'scheduled reports are kept on record' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.guard_scheduled_report_change() from public, anon, authenticated;

create function app.reject_scheduled_report_log_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'the scheduled report log is append-only' using errcode = '42501';
end;
$$;
revoke all on function app.reject_scheduled_report_log_change() from public, anon, authenticated;

create trigger scheduled_reports_guard before update or delete on public.scheduled_reports
  for each row execute function app.guard_scheduled_report_change();
create trigger scheduled_reports_touch before update on public.scheduled_reports
  for each row execute function app.touch_row();
create trigger scheduled_report_runs_no_change before update or delete on public.scheduled_report_runs
  for each row execute function app.reject_scheduled_report_log_change();
create trigger scheduled_report_deliveries_no_change before update or delete on public.scheduled_report_deliveries
  for each row execute function app.reject_scheduled_report_log_change();

alter table public.scheduled_reports enable row level security;
alter table public.scheduled_reports force row level security;
alter table public.scheduled_report_recipients enable row level security;
alter table public.scheduled_report_recipients force row level security;
alter table public.scheduled_report_runs enable row level security;
alter table public.scheduled_report_runs force row level security;
alter table public.scheduled_report_deliveries enable row level security;
alter table public.scheduled_report_deliveries force row level security;
revoke all on table public.scheduled_reports from public, anon, authenticated;
revoke all on table public.scheduled_report_recipients from public, anon, authenticated;
revoke all on table public.scheduled_report_runs from public, anon, authenticated;
revoke all on table public.scheduled_report_deliveries from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Delivery (runner and "Run now (test)")
-- ---------------------------------------------------------------------------

-- For each recipient: skipped when no longer active staff of the firm, or when no role of theirs
-- sees the tab; otherwise delivered with the link. A second call for the same run adds nothing.
create function app.deliver_scheduled_report(p_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  run_row public.scheduled_report_runs%rowtype;
  sched public.scheduled_reports%rowtype;
  recipient record;
  report_link text;
  delivered_count integer := 0;
  skipped_count integer := 0;
begin
  select * into run_row from public.scheduled_report_runs r where r.id = p_run_id;
  if run_row.id is null then
    raise exception 'run not found' using errcode = 'P0002';
  end if;
  select * into sched from public.scheduled_reports s where s.id = run_row.schedule_id;
  report_link := '/sheet/reports?tab=' || sched.tab || '&view=' || sched.range_key;
  for recipient in
    select rec.user_id from public.scheduled_report_recipients rec where rec.schedule_id = sched.id order by rec.created_at, rec.user_id
  loop
    if not exists (
      select 1 from public.memberships m
      where m.organization_id = sched.organization_id
        and m.user_id = recipient.user_id
        and m.status = 'active'
        and m.role = any (app.staff_roles())
    ) then
      insert into public.scheduled_report_deliveries (organization_id, run_id, schedule_id, user_id, status, skip_reason)
      values (sched.organization_id, run_row.id, sched.id, recipient.user_id, 'skipped', 'not_active_staff')
      on conflict (run_id, user_id) do nothing;
    elsif not app.user_sees_report_tab(sched.organization_id, recipient.user_id, sched.tab) then
      insert into public.scheduled_report_deliveries (organization_id, run_id, schedule_id, user_id, status, skip_reason)
      values (sched.organization_id, run_row.id, sched.id, recipient.user_id, 'skipped', 'role_cannot_see_tab')
      on conflict (run_id, user_id) do nothing;
    else
      insert into public.scheduled_report_deliveries (organization_id, run_id, schedule_id, user_id, status, link)
      values (sched.organization_id, run_row.id, sched.id, recipient.user_id, 'delivered', report_link)
      on conflict (run_id, user_id) do nothing;
    end if;
  end loop;
  select count(*) filter (where d.status = 'delivered'), count(*) filter (where d.status = 'skipped')
    into delivered_count, skipped_count
  from public.scheduled_report_deliveries d
  where d.run_id = run_row.id;
  return jsonb_build_object('run_id', run_row.id, 'delivered', delivered_count, 'skipped', skipped_count);
end;
$$;
revoke all on function app.deliver_scheduled_report(uuid) from public, anon, authenticated;
grant execute on function app.deliver_scheduled_report(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Staff functions
-- ---------------------------------------------------------------------------

create function app.require_report_staff(p_org uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
begin
  if actor is null then
    raise exception 'sign in is required' using errcode = '42501';
  end if;
  if p_org is null
     or p_org is distinct from (select app.current_organization_id())
     or app.in_active_org(p_org) is distinct from true
     or app.staff_mfa_satisfied() is distinct from true
     or app.is_org_staff(p_org) is distinct from true then
    raise exception 'scheduled reports denied' using errcode = '42501';
  end if;
  return actor;
end;
$$;
revoke all on function app.require_report_staff(uuid) from public, anon;
grant execute on function app.require_report_staff(uuid) to authenticated;

create function public.scheduled_reports_overview(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := app.require_report_staff(p_organization_id);
  tabs text[];
  is_owner boolean := app.has_org_role(p_organization_id, array['firm_owner']::public.org_role[]);
begin
  select coalesce(array_agg(t order by ord), array[]::text[]) into tabs
  from unnest(array['ops', 'money', 'outcomes']) with ordinality as x(t, ord)
  where app.has_org_role(p_organization_id, app.report_tab_roles(t));

  return jsonb_build_object(
    'timezone', app.report_schedule_zone(p_organization_id),
    'me', actor,
    'tabs', to_jsonb(tabs),
    -- Staff who could receive each tab today (active, in a role that sees it).
    'staff', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', people.user_id,
        'name', people.name,
        'tabs', to_jsonb(array(
          select t from unnest(array['ops', 'money', 'outcomes']) as t
          where people.roles && app.report_tab_roles(t)
        ))
      ) order by people.name, people.user_id)
      from (
        select m.user_id,
               coalesce(nullif(btrim(max(prof.display_name)), ''), 'Staff member') as name,
               array_agg(m.role) as roles
        from public.memberships m
        left join public.profiles prof on prof.id = m.user_id
        where m.organization_id = p_organization_id
          and m.status = 'active'
          and m.role = any (app.staff_roles())
        group by m.user_id
      ) people
    ), '[]'::jsonb),
    'schedules', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'title', s.title,
        'tab', s.tab,
        'range', s.range_key,
        'frequency', s.frequency,
        'weekday', s.weekday,
        'month_day', s.month_day,
        'send_time', to_char(s.send_time, 'HH24:MI'),
        'paused', s.paused,
        'next_run_at', s.next_run_at,
        'last_run_at', s.last_run_at,
        'version', s.version,
        'created_by_name', (select prof.display_name from public.profiles prof where prof.id = s.created_by),
        'can_edit', (s.created_by = actor or is_owner),
        'recipients', coalesce((
          select jsonb_agg(jsonb_build_object(
            'user_id', rec.user_id,
            'name', coalesce(nullif(btrim(prof.display_name), ''), 'Staff member'),
            'can_see', app.user_sees_report_tab(p_organization_id, rec.user_id, s.tab)
          ) order by prof.display_name, rec.user_id)
          from public.scheduled_report_recipients rec
          left join public.profiles prof on prof.id = rec.user_id
          where rec.schedule_id = s.id
        ), '[]'::jsonb),
        'last_run', (
          select jsonb_build_object(
            'at', r.created_at,
            'kind', r.kind,
            'delivered', (select count(*) from public.scheduled_report_deliveries d where d.run_id = r.id and d.status = 'delivered'),
            'skipped', (select count(*) from public.scheduled_report_deliveries d where d.run_id = r.id and d.status = 'skipped')
          )
          from public.scheduled_report_runs r
          where r.schedule_id = s.id
          order by r.created_at desc
          limit 1
        )
      ) order by s.created_at desc)
      from (
        select * from public.scheduled_reports x
        where x.organization_id = p_organization_id
          and x.deleted_at is null
          and x.tab = any (tabs)
        order by x.created_at desc
        limit 100
      ) s
    ), '[]'::jsonb)
  );
end;
$$;
comment on function public.scheduled_reports_overview(uuid) is
  'REP-03: the caller''s firm''s scheduled reports for the tabs the caller can see, who could receive each tab, and each schedule''s last run (counts only).';
revoke all on function public.scheduled_reports_overview(uuid) from public, anon;
grant execute on function public.scheduled_reports_overview(uuid) to authenticated;

create function public.save_scheduled_report(
  p_organization_id uuid,
  p_schedule_id uuid,
  p_title text,
  p_tab text,
  p_range text,
  p_frequency text,
  p_weekday smallint,
  p_month_day smallint,
  p_send_time time,
  p_recipients uuid[],
  p_expected_version integer default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := app.require_report_staff(p_organization_id);
  existing public.scheduled_reports%rowtype;
  saved_id uuid;
  clean_title text := btrim(coalesce(p_title, ''));
  people uuid[];
  person uuid;
  next_at timestamptz;
begin
  if p_tab is null or p_tab not in ('ops', 'money', 'outcomes') then
    raise exception 'choose a report' using errcode = '22023';
  end if;
  if p_range is null or p_range not in ('90d', 'month', 'year') then
    raise exception 'choose a period' using errcode = '22023';
  end if;
  if length(clean_title) < 2 or length(clean_title) > 120 then
    raise exception 'name the scheduled report' using errcode = '22023';
  end if;
  if p_frequency = 'weekly' then
    if p_weekday is null or p_weekday not between 1 and 7 or p_month_day is not null then
      raise exception 'choose a weekday' using errcode = '22023';
    end if;
  elsif p_frequency = 'monthly' then
    if p_month_day is null or p_month_day not between 1 and 28 or p_weekday is not null then
      raise exception 'choose a day of the month from 1 to 28' using errcode = '22023';
    end if;
  else
    raise exception 'choose weekly or monthly' using errcode = '22023';
  end if;
  if p_send_time is null then
    raise exception 'choose a time' using errcode = '22023';
  end if;
  if app.has_org_role(p_organization_id, app.report_tab_roles(p_tab)) is distinct from true then
    raise exception 'your role cannot see this report' using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct x), array[]::uuid[]) into people from unnest(coalesce(p_recipients, array[]::uuid[])) x where x is not null;
  if cardinality(people) < 1 or cardinality(people) > 20 then
    raise exception 'choose from 1 to 20 recipients' using errcode = '22023';
  end if;
  foreach person in array people loop
    if not app.user_sees_report_tab(p_organization_id, person, p_tab) then
      raise exception 'a recipient cannot see this report' using errcode = '22023';
    end if;
  end loop;

  if p_schedule_id is not null then
    select * into existing from public.scheduled_reports s
    where s.id = p_schedule_id and s.organization_id = p_organization_id and s.deleted_at is null
    for update;
    if existing.id is null then
      raise exception 'scheduled report not found' using errcode = 'P0002';
    end if;
    if existing.created_by is distinct from actor
       and app.has_org_role(p_organization_id, array['firm_owner']::public.org_role[]) is distinct from true then
      raise exception 'only who made it or the firm owner can change it' using errcode = '42501';
    end if;
    if app.has_org_role(p_organization_id, app.report_tab_roles(existing.tab)) is distinct from true then
      raise exception 'your role cannot see this report' using errcode = '42501';
    end if;
    if p_expected_version is not null and p_expected_version <> existing.version then
      raise exception 'version conflict: someone changed it first' using errcode = '40001';
    end if;
  end if;

  next_at := app.report_schedule_next_run(p_organization_id, p_frequency, p_weekday, p_month_day, p_send_time, statement_timestamp());

  if existing.id is null then
    insert into public.scheduled_reports (organization_id, title, tab, range_key, frequency, weekday, month_day, send_time, next_run_at, created_by)
    values (p_organization_id, clean_title, p_tab, p_range, p_frequency, p_weekday, p_month_day, p_send_time, next_at, actor)
    returning id into saved_id;
  else
    saved_id := existing.id;
    update public.scheduled_reports
       set title = clean_title, tab = p_tab, range_key = p_range, frequency = p_frequency, weekday = p_weekday,
           month_day = p_month_day, send_time = p_send_time, updated_by = actor,
           next_run_at = case when paused then null else next_at end
     where id = saved_id;
    delete from public.scheduled_report_recipients rec where rec.schedule_id = existing.id and rec.user_id <> all (people);
  end if;
  insert into public.scheduled_report_recipients (schedule_id, organization_id, user_id)
  select saved_id, p_organization_id, x from unnest(people) x
  on conflict on constraint scheduled_report_recipients_pkey do nothing;

  perform app.record_audit_event(
    p_organization_id,
    case when existing.id is null then 'report.schedule_created' else 'report.schedule_updated' end,
    'public.scheduled_reports', saved_id, 'success',
    jsonb_build_object('tab', p_tab, 'range', p_range, 'frequency', p_frequency, 'recipients', cardinality(people))
  );
  return saved_id;
end;
$$;
comment on function public.save_scheduled_report(uuid, uuid, text, text, text, text, smallint, smallint, time, uuid[], integer) is
  'REP-03: create (p_schedule_id null) or change a scheduled report. The caller and every recipient must see the tab; only who made it or the firm owner changes it. Audited.';
revoke all on function public.save_scheduled_report(uuid, uuid, text, text, text, text, smallint, smallint, time, uuid[], integer) from public, anon;
grant execute on function public.save_scheduled_report(uuid, uuid, text, text, text, text, smallint, smallint, time, uuid[], integer) to authenticated;

-- The schedule the caller may manage: in the active firm, not deleted, made by them or they are
-- the firm owner, and their role sees its tab.
create function app.managed_scheduled_report(p_schedule_id uuid)
returns public.scheduled_reports
language plpgsql
security definer
set search_path = ''
as $$
declare
  sched public.scheduled_reports%rowtype;
  actor uuid;
begin
  select * into sched from public.scheduled_reports s where s.id = p_schedule_id for update;
  if sched.id is null or sched.deleted_at is not null then
    raise exception 'scheduled report not found' using errcode = 'P0002';
  end if;
  actor := app.require_report_staff(sched.organization_id);
  if sched.created_by is distinct from actor
     and app.has_org_role(sched.organization_id, array['firm_owner']::public.org_role[]) is distinct from true then
    raise exception 'only who made it or the firm owner can change it' using errcode = '42501';
  end if;
  if app.has_org_role(sched.organization_id, app.report_tab_roles(sched.tab)) is distinct from true then
    raise exception 'your role cannot see this report' using errcode = '42501';
  end if;
  return sched;
end;
$$;
revoke all on function app.managed_scheduled_report(uuid) from public, anon;
grant execute on function app.managed_scheduled_report(uuid) to authenticated;

create function public.set_scheduled_report_paused(p_schedule_id uuid, p_paused boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  sched public.scheduled_reports%rowtype := app.managed_scheduled_report(p_schedule_id);
begin
  if p_paused is null then
    raise exception 'choose pause or resume' using errcode = '22023';
  end if;
  if sched.paused = p_paused then
    return p_paused;
  end if;
  update public.scheduled_reports
     set paused = p_paused,
         updated_by = (select auth.uid()),
         next_run_at = case when p_paused then null
                            else app.report_schedule_next_run(sched.organization_id, sched.frequency, sched.weekday, sched.month_day, sched.send_time, statement_timestamp()) end
   where id = sched.id;
  perform app.record_audit_event(sched.organization_id, case when p_paused then 'report.schedule_paused' else 'report.schedule_resumed' end,
    'public.scheduled_reports', sched.id, 'success', jsonb_build_object('tab', sched.tab));
  return p_paused;
end;
$$;
revoke all on function public.set_scheduled_report_paused(uuid, boolean) from public, anon;
grant execute on function public.set_scheduled_report_paused(uuid, boolean) to authenticated;

create function public.delete_scheduled_report(p_schedule_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  sched public.scheduled_reports%rowtype := app.managed_scheduled_report(p_schedule_id);
begin
  update public.scheduled_reports
     set deleted_at = now(), deleted_by = (select auth.uid()), next_run_at = null, updated_by = (select auth.uid())
   where id = sched.id;
  perform app.record_audit_event(sched.organization_id, 'report.schedule_deleted', 'public.scheduled_reports', sched.id, 'success',
    jsonb_build_object('tab', sched.tab));
  return true;
end;
$$;
revoke all on function public.delete_scheduled_report(uuid) from public, anon;
grant execute on function public.delete_scheduled_report(uuid) to authenticated;

-- "Run now (test)": the same recipient recheck and the same link, now, without moving the
-- schedule's next send. One test a minute per schedule, so a double click sends once.
create function public.run_scheduled_report_now(p_schedule_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  sched public.scheduled_reports%rowtype := app.managed_scheduled_report(p_schedule_id);
  new_run uuid;
  result jsonb;
begin
  if exists (
    select 1 from public.scheduled_report_runs r
    where r.schedule_id = sched.id and r.kind = 'test' and r.created_at > statement_timestamp() - interval '1 minute'
  ) then
    raise exception 'a test was just sent; try again in a minute' using errcode = '55P03';
  end if;
  insert into public.scheduled_report_runs (organization_id, schedule_id, kind, due_at, run_by)
  values (sched.organization_id, sched.id, 'test', statement_timestamp(), (select auth.uid()))
  returning id into new_run;
  result := app.deliver_scheduled_report(new_run);
  perform app.record_audit_event(sched.organization_id, 'report.schedule_test_run', 'public.scheduled_reports', sched.id, 'success',
    jsonb_build_object('tab', sched.tab, 'run_id', new_run, 'delivered', result -> 'delivered', 'skipped', result -> 'skipped'));
  return result;
end;
$$;
revoke all on function public.run_scheduled_report_now(uuid) from public, anon;
grant execute on function public.run_scheduled_report_now(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Runner (service role)
-- ---------------------------------------------------------------------------

-- Sends every schedule that is due, once per due time (a repeated call for the same due time adds
-- nothing), then moves it to its next send after now (a missed slot is sent once, not repeated).
create function public.service_run_scheduled_reports(p_limit integer default 50)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  sched public.scheduled_reports%rowtype;
  new_run uuid;
  result jsonb;
  schedules_sent integer := 0;
  delivered_total integer := 0;
  skipped_total integer := 0;
begin
  for sched in
    select * from public.scheduled_reports s
    where s.deleted_at is null and not s.paused and s.next_run_at is not null and s.next_run_at <= statement_timestamp()
    order by s.next_run_at
    limit least(greatest(coalesce(p_limit, 50), 1), 500)
    for update skip locked
  loop
    new_run := null;
    insert into public.scheduled_report_runs (organization_id, schedule_id, kind, due_at)
    values (sched.organization_id, sched.id, 'scheduled', sched.next_run_at)
    on conflict (schedule_id, due_at) where kind = 'scheduled' do nothing
    returning id into new_run;
    if new_run is not null then
      result := app.deliver_scheduled_report(new_run);
      schedules_sent := schedules_sent + 1;
      delivered_total := delivered_total + (result ->> 'delivered')::integer;
      skipped_total := skipped_total + (result ->> 'skipped')::integer;
      perform app.record_audit_event(sched.organization_id, 'report.schedule_sent', 'public.scheduled_reports', sched.id, 'success',
        jsonb_build_object('tab', sched.tab, 'run_id', new_run, 'due_at', sched.next_run_at,
          'delivered', result -> 'delivered', 'skipped', result -> 'skipped'));
    end if;
    update public.scheduled_reports
       set next_run_at = app.report_schedule_next_run(sched.organization_id, sched.frequency, sched.weekday, sched.month_day, sched.send_time, statement_timestamp()),
           last_run_at = case when new_run is not null then statement_timestamp() else last_run_at end
     where id = sched.id;
  end loop;
  return jsonb_build_object('schedules', schedules_sent, 'delivered', delivered_total, 'skipped', skipped_total);
end;
$$;
revoke all on function public.service_run_scheduled_reports(integer) from public, anon, authenticated;
grant execute on function public.service_run_scheduled_reports(integer) to service_role;

-- pg_cron -> POST /api/reports/scheduled/run with the mail dispatch bearer, like the retention
-- runner, only when a schedule is due.
create function app.kick_scheduled_reports()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  url text;
  secret text;
begin
  if not exists (
    select 1 from public.scheduled_reports s
    where s.deleted_at is null and not s.paused and s.next_run_at is not null and s.next_run_at <= now()
  ) then
    return;
  end if;
  select decrypted_secret into url from vault.decrypted_secrets where name = 'email_dispatch_url';
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'email_dispatch_secret';
  if url is null or secret is null or url !~ '^https://[^/]+/api/email/dispatch$' then
    return;
  end if;
  perform net.http_post(
    url := regexp_replace(url, '/api/email/dispatch$', '/api/reports/scheduled/run'),
    headers := jsonb_build_object('Authorization', 'Bearer ' || secret, 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
end;
$$;
revoke all on function app.kick_scheduled_reports() from public;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
    create extension if not exists pg_cron;
    perform cron.schedule('casevoya-scheduled-reports', '*/5 * * * *', 'select app.kick_scheduled_reports()');
  end if;
end;
$$;
