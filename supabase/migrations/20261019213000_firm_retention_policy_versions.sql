-- Settings > Retention and Settings > Subscription (PRD §16 SEC-07, §17 ADM-02).
--
-- Retention: the firm's default retention period already lives on organizations.retention_policy
-- (chosen in firm setup; close_matter copies it onto each closure). This adds its version history
-- and the owner's way to change it outside setup:
--   retention_policy_versions  append-only: version, period, who approved it and when, and whether
--                              it came from firm setup or from Settings.
--   public.set_firm_retention_policy(org, years, expected_version)
--                              firm owner + step-up (app.require_firm_owner_step_up), 1 to 100 years,
--                              optimistic version check, audited 'firm.retention_policy_changed'.
--                              It writes {"unit":"years","count":n,"version":v} to
--                              organizations.retention_policy, so every later closure snapshots the
--                              policy version (SEC-07). A period chosen in setup that has no version
--                              row yet is recorded first as the setup version, with who saved the
--                              setup step and when. The period is the firm's own choice; Casevoya
--                              supplies no statutory period, and none is seeded.
--
-- Subscription: public.firm_subscription_usage(org) returns real counts for the Subscription tab
-- (firm owner and finance user, staff MFA): active and invited staff seats, matters not closed (and
-- how many are sample), bytes of stored document versions, Vo runs and emails sent this calendar
-- month in the firm's timezone. Read-only. There is no plan, price, seat limit, storage allowance
-- or AI quota in the schema, and none is added here (prices are the owner's decision).
--
-- Additive only. Redefines no existing function.

-- ---------------------------------------------------------------------------
-- Retention policy versions
-- ---------------------------------------------------------------------------

create table public.retention_policy_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  version integer not null check (version >= 1),
  unit text not null default 'years' check (unit = 'years'),
  period_count integer not null check (period_count between 1 and 100),
  source text not null check (source in ('firm_setup', 'settings')),
  approved_by uuid not null references auth.users (id),
  approved_at timestamptz not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  unique (organization_id, version),
  unique (id, organization_id)
);
comment on table public.retention_policy_versions is
  'Each version of the firm''s default retention period (SEC-07). Append-only. The period is the firm''s own choice, not a statutory period supplied by Casevoya. The current one is mirrored on organizations.retention_policy with its version number.';

create index retention_policy_versions_approved_by_idx on public.retention_policy_versions (approved_by);
create index retention_policy_versions_created_by_idx on public.retention_policy_versions (created_by);

create function app.guard_retention_policy_version_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'retention policy versions are kept on record' using errcode = '42501';
end;
$$;
revoke all on function app.guard_retention_policy_version_change() from public, anon, authenticated;

create trigger retention_policy_versions_guard before update or delete on public.retention_policy_versions
  for each row execute function app.guard_retention_policy_version_change();
create trigger retention_policy_versions_stamp before insert on public.retention_policy_versions
  for each row execute function app.stamp_created_by();
create trigger retention_policy_versions_audit after insert or update or delete on public.retention_policy_versions
  for each row execute function app.audit_row_change();

alter table public.retention_policy_versions enable row level security;
alter table public.retention_policy_versions force row level security;
revoke all on table public.retention_policy_versions from public, anon;
revoke insert, update, delete on table public.retention_policy_versions from authenticated;
grant select on table public.retention_policy_versions to authenticated;

create policy retention_policy_versions_select on public.retention_policy_versions
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.in_active_org(organization_id))
    and (select app.is_org_staff(organization_id))
    and (select app.staff_mfa_satisfied())
  );

-- The firm owner, after a step-up, sets the firm's default retention period. p_expected_version is
-- the version the owner saw: 0 when no period is set, the setup version (one more than the last
-- row) when the period came from setup and has no row yet, otherwise the last row's version.
create function public.set_firm_retention_policy(
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
    raise exception 'retention policy version conflict' using errcode = '40001';
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
comment on function public.set_firm_retention_policy(uuid, integer, integer) is
  'Firm owner + step-up: sets the firm''s default retention period (years, the firm''s own choice) as a new version. Matters already closed keep the period they closed under.';
revoke all on function public.set_firm_retention_policy(uuid, integer, integer) from public, anon;
grant execute on function public.set_firm_retention_policy(uuid, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Subscription usage (ADM-02): real counts, no prices or limits
-- ---------------------------------------------------------------------------

create function public.firm_subscription_usage(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  zone text;
  month_start timestamptz;
begin
  if (select auth.uid()) is null then
    raise exception 'sign in is required' using errcode = '42501';
  end if;
  if p_organization_id is null
     or p_organization_id is distinct from (select app.current_organization_id())
     or app.in_active_org(p_organization_id) is distinct from true
     or app.staff_mfa_satisfied() is distinct from true
     or app.has_org_role(p_organization_id, array['firm_owner', 'finance_user']::public.org_role[]) is distinct from true then
    raise exception 'subscription usage denied' using errcode = '42501';
  end if;
  select org.timezone into zone from public.organizations org where org.id = p_organization_id;
  month_start := (date_trunc('month', app.firm_local_date(p_organization_id, statement_timestamp()))::timestamp)
    at time zone coalesce(zone, 'America/Toronto');
  return jsonb_build_object(
    'seats_active', (
      select count(*) from public.memberships m
       where m.organization_id = p_organization_id and m.status = 'active' and m.role = any (app.staff_roles())
    ),
    'seats_invited', (
      select count(*) from public.memberships m
       where m.organization_id = p_organization_id and m.status = 'invited' and m.role = any (app.staff_roles())
    ),
    'active_matters', (
      select count(*) from public.matters matter
       where matter.organization_id = p_organization_id and matter.stage <> 'closed'
    ),
    'sample_matters', (
      select count(*) from public.matters matter
       where matter.organization_id = p_organization_id and matter.stage <> 'closed' and matter.is_sample
    ),
    'storage_bytes', (
      select coalesce(sum(version.byte_size), 0)::bigint from public.document_versions version
       where version.organization_id = p_organization_id and version.byte_size is not null
    ),
    'vo_runs_month', (
      select count(*) from public.vo_runs run
       where run.organization_id = p_organization_id and run.created_at >= month_start
    ),
    'emails_month', (
      select count(*) from public.email_deliveries delivery
       where delivery.organization_id = p_organization_id
         and delivery.status in ('sent', 'queued')
         and delivery.created_at >= month_start
    ),
    'month_start', (month_start at time zone coalesce(zone, 'America/Toronto'))::date
  );
end;
$$;
comment on function public.firm_subscription_usage(uuid) is
  'Firm owner or finance user: real usage counts for Settings > Subscription (seats, matters not closed, stored document bytes, Vo runs and emails this month in the firm timezone). No prices, limits or quotas exist yet.';
revoke all on function public.firm_subscription_usage(uuid) from public, anon;
grant execute on function public.firm_subscription_usage(uuid) to authenticated;
