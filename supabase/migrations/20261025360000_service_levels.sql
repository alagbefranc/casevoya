-- ADM-04 (gap #186), service-level report. Branch feat/adm-service-levels.
--
-- What Casevoya can honestly report per firm and month:
--   * Support response time: from support_response_records, one row per support request a firm
--     sent Casevoya (its ticket reference in the support desk, when it reached support, and when
--     support first replied). Platform admins record them (signed in at aal2, or the service role
--     naming the platform admin, as the CICC list import does); nobody else writes. Metadata only:
--     no subject, message, narrative or attachment is stored.
--   * Uptime: Casevoya records no uptime monitoring today, so the report says it is not measured
--     ("uptime": {"measured": false}) and never computes a figure. Hook: when a monitoring source
--     exists (for example service windows from resolved incident/maintenance notices), it fills
--     that field here; see docs/integrations/support-access.md "Service-level report".
--
-- Additive only. New table (forced RLS, no direct writes): support_response_records.
-- New functions: app.platform_ops_actor, public.record_support_response (platform admin / service
-- role), public.service_level_report (the firm's owner, a platform admin, or the service role).
-- No existing function is redefined.

create table public.support_response_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  -- The support desk's reference for the request, e.g. the ticket number. Not a narrative.
  ticket_ref text not null check (length(btrim(ticket_ref)) between 1 and 60),
  -- When the firm's request reached Casevoya support.
  received_at timestamptz not null,
  -- When support first replied; null while it waits for a first reply.
  first_response_at timestamptz,
  -- The platform admin who recorded it (a platform_admins row).
  recorded_by_user_id uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (organization_id, ticket_ref),
  check (first_response_at is null or first_response_at >= received_at)
);
comment on table public.support_response_records is
  'ADM-04: one support request a firm sent Casevoya, with when it reached support and when support first replied. Metadata only. Written by public.record_support_response; read by the firm''s owners and platform admins.';

create index support_response_records_org_received_idx
  on public.support_response_records (organization_id, received_at desc);
create index support_response_records_recorded_by_idx on public.support_response_records (recorded_by_user_id);
create index support_response_records_created_by_idx on public.support_response_records (created_by);

create trigger support_response_records_touch before update on public.support_response_records
  for each row execute function app.touch_row();
create trigger support_response_records_immutable before update on public.support_response_records
  for each row execute function app.guard_tenant_keys();
create trigger support_response_records_stamp before insert on public.support_response_records
  for each row execute function app.stamp_created_by();
create trigger support_response_records_audit after insert or update or delete on public.support_response_records
  for each row execute function app.audit_row_change();
create trigger support_response_records_no_delete before delete on public.support_response_records
  for each row execute function app.reject_governed_delete();
create trigger support_response_records_no_truncate before truncate on public.support_response_records
  for each statement execute function app.reject_governed_delete();

revoke all on table public.support_response_records from public, anon, authenticated, service_role;
grant select on table public.support_response_records to authenticated, service_role;

alter table public.support_response_records enable row level security;
alter table public.support_response_records force row level security;

-- The firm's owners (aal2) read their firm's rows; a platform admin (aal2) reads any firm's.
create policy support_response_records_select on public.support_response_records
  for select to authenticated
  using (
    (select app.actor_is_firm_owner(organization_id))
    or (select app.is_platform_admin())
  );

-- ---------------------------------------------------------------------------
-- Who acts for Casevoya: a signed-in platform admin at aal2 (returns their id), or the service
-- role naming a platform admin (ops scripts; returns that id). Firm staff never.
-- ---------------------------------------------------------------------------
create function app.platform_ops_actor(p_named uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null then
    if app.is_platform_admin() is distinct from true then
      raise exception 'platform admin access denied' using errcode = '42501';
    end if;
    return (select auth.uid());
  end if;
  if app.current_actor_type() is distinct from 'service' then
    raise exception 'platform admin access denied' using errcode = '42501';
  end if;
  if p_named is null
     or not exists (select 1 from public.platform_admins pa where pa.user_id = p_named) then
    raise exception 'name the platform admin who records this' using errcode = '22023';
  end if;
  return p_named;
end;
$$;
comment on function app.platform_ops_actor(uuid) is
  'A signed-in platform admin at aal2 (their id), or the service role naming a platform_admins user (that id). Anyone else is refused.';
revoke all on function app.platform_ops_actor(uuid) from public;

-- ---------------------------------------------------------------------------
-- Record (or correct) one support request's times. Keyed by firm and ticket reference.
-- ---------------------------------------------------------------------------
create function public.record_support_response(
  p_organization_id uuid,
  p_ticket_ref text,
  p_received_at timestamptz,
  p_first_response_at timestamptz,
  p_recorded_by uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  recorder uuid;
  ref_text text := btrim(coalesce(p_ticket_ref, ''));
  latest_allowed timestamptz := statement_timestamp() + interval '5 minutes';
  existing public.support_response_records%rowtype;
  record_id uuid;
begin
  recorder := app.platform_ops_actor(p_recorded_by);
  if p_organization_id is null
     or not exists (select 1 from public.organizations org where org.id = p_organization_id) then
    raise exception 'that firm does not exist' using errcode = '22023';
  end if;
  if length(ref_text) not between 1 and 60 then
    raise exception 'give the support ticket reference (1 to 60 characters)' using errcode = '22023';
  end if;
  if p_received_at is null or p_received_at > latest_allowed then
    raise exception 'give when the request reached support (not in the future)' using errcode = '22023';
  end if;
  if p_first_response_at is not null and (p_first_response_at < p_received_at or p_first_response_at > latest_allowed) then
    raise exception 'the first reply must be after the request and not in the future' using errcode = '22023';
  end if;

  select * into existing
  from public.support_response_records rec
  where rec.organization_id = p_organization_id and rec.ticket_ref = ref_text
  for update;

  if existing.id is null then
    insert into public.support_response_records (organization_id, ticket_ref, received_at, first_response_at, recorded_by_user_id)
    values (p_organization_id, ref_text, p_received_at, p_first_response_at, recorder)
    returning id into record_id;
    perform app.record_audit_event(
      p_organization_id, 'service_level.support_response_recorded', 'public.support_response_records', record_id, 'success',
      jsonb_build_object('ticket_ref', ref_text, 'received_at', p_received_at, 'first_response_at', p_first_response_at, 'recorded_by', recorder)
    );
    return record_id;
  end if;

  if existing.received_at = p_received_at and existing.first_response_at is not distinct from p_first_response_at then
    return existing.id;
  end if;
  update public.support_response_records
     set received_at = p_received_at,
         first_response_at = p_first_response_at,
         recorded_by_user_id = recorder
   where id = existing.id;
  perform app.record_audit_event(
    p_organization_id, 'service_level.support_response_updated', 'public.support_response_records', existing.id, 'success',
    jsonb_build_object(
      'ticket_ref', ref_text,
      'received_at', p_received_at, 'first_response_at', p_first_response_at,
      'previous_received_at', existing.received_at, 'previous_first_response_at', existing.first_response_at,
      'recorded_by', recorder
    )
  );
  return existing.id;
end;
$$;
comment on function public.record_support_response(uuid, text, timestamptz, timestamptz, uuid) is
  'ADM-04: a platform admin (aal2), or the service role naming one, records when a firm''s support request reached Casevoya and when support first replied (null while waiting). Same firm and ticket again corrects it. Audited.';
revoke all on function public.record_support_response(uuid, text, timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.record_support_response(uuid, text, timestamptz, timestamptz, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The monthly service-level report for one firm, months in the firm's timezone, newest first.
-- ---------------------------------------------------------------------------
create function public.service_level_report(p_organization_id uuid, p_months integer default 6)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  span integer := least(greatest(coalesce(p_months, 6), 1), 24);
  firm_zone text;
  reader text;
  this_month date;
  result_months jsonb;
begin
  if (select auth.uid()) is not null then
    if app.actor_is_firm_owner(p_organization_id) is true and app.in_active_org(p_organization_id) is true then
      reader := 'firm_owner';
    elsif app.is_platform_admin() is true then
      reader := 'platform_admin';
    else
      raise exception 'service level report denied' using errcode = '42501';
    end if;
  elsif app.current_actor_type() = 'service' then
    reader := 'service';
  else
    raise exception 'service level report denied' using errcode = '42501';
  end if;

  select coalesce(nullif(btrim(org.timezone), ''), 'America/Toronto') into firm_zone
  from public.organizations org
  where org.id = p_organization_id;
  if firm_zone is null then
    raise exception 'that firm does not exist' using errcode = '22023';
  end if;

  -- Casevoya reading a firm's report is recorded on the firm's audit trail.
  if reader <> 'firm_owner' then
    perform app.record_audit_event(
      p_organization_id, 'service_level.report_read', 'public.organizations', p_organization_id, 'success',
      jsonb_build_object('by', reader, 'months', span)
    );
  end if;

  this_month := date_trunc('month', statement_timestamp() at time zone firm_zone)::date;

  select coalesce(jsonb_agg(jsonb_build_object(
           'month', to_char(m.month_start, 'YYYY-MM'),
           'support', jsonb_build_object(
             'received', coalesce(s.received, 0),
             'answered', coalesce(s.answered, 0),
             'waiting', coalesce(s.received, 0) - coalesce(s.answered, 0),
             'median_seconds', s.median_seconds,
             'longest_seconds', s.longest_seconds
           )
         ) order by m.month_start desc), '[]'::jsonb)
    into result_months
  from (
    select (this_month - make_interval(months => g))::date as month_start
    from generate_series(0, span - 1) as g
  ) m
  left join lateral (
    select count(*)::integer as received,
           count(rec.first_response_at)::integer as answered,
           round(percentile_cont(0.5) within group (order by extract(epoch from (rec.first_response_at - rec.received_at))::double precision)
                   filter (where rec.first_response_at is not null))::integer as median_seconds,
           round(max(extract(epoch from (rec.first_response_at - rec.received_at))))::integer as longest_seconds
    from public.support_response_records rec
    where rec.organization_id = p_organization_id
      and rec.received_at >= (m.month_start::timestamp at time zone firm_zone)
      and rec.received_at < ((m.month_start + interval '1 month')::timestamp at time zone firm_zone)
  ) s on true;

  return jsonb_build_object(
    'organization_id', p_organization_id,
    'timezone', firm_zone,
    'generated_at', statement_timestamp(),
    -- Not measured: Casevoya records no uptime monitoring yet. Never computed from anything else.
    'uptime', jsonb_build_object('measured', false),
    'months', result_months
  );
end;
$$;
comment on function public.service_level_report(uuid, integer) is
  'ADM-04: per month (firm timezone, newest first, 1 to 24 months) the support requests the firm sent, how many got a first reply, and the median and longest time to it in seconds. Uptime is {"measured": false}: no monitoring source is recorded. The firm''s owner (aal2), a platform admin (aal2, audited) or the service role (audited).';
revoke all on function public.service_level_report(uuid, integer) from public, anon;
grant execute on function public.service_level_report(uuid, integer) to authenticated, service_role;
