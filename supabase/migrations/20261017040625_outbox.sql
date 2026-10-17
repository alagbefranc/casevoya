-- Casevoya foundation: transactional outbox (ARCH runtime, T010)
-- Domain code writes an outbox row in the SAME transaction as the state change.
-- Workers (Edge Functions / cron, service role) claim with SKIP LOCKED, publish at least once,
-- and consumers dedupe on event_id. Payloads carry ids and minimal metadata only.
-- Workers take tenant context from organization_id on the stored row, never from a request.
-- Additive only.

create type public.outbox_status as enum ('pending', 'processing', 'published', 'failed', 'dead_lettered');

create table public.outbox_events (
  id uuid primary key default gen_random_uuid(), -- event_id in the envelope
  organization_id uuid not null references public.organizations (id),
  aggregate_type text not null check (aggregate_type ~ '^[a-z][a-z0-9_]{1,60}$'),
  aggregate_id uuid not null,
  aggregate_version integer check (aggregate_version is null or aggregate_version >= 1),
  event_type text not null check (event_type ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  schema_version integer not null default 1 check (schema_version >= 1),
  payload jsonb not null default '{}'::jsonb check (pg_column_size(payload) <= 8192),
  idempotency_key text check (idempotency_key is null or length(idempotency_key) between 1 and 200),
  occurred_at timestamptz not null default clock_timestamp(),
  available_at timestamptz not null default clock_timestamp(),
  status public.outbox_status not null default 'pending',
  attempts integer not null default 0 check (attempts >= 0),
  last_error text check (last_error is null or length(last_error) <= 2000),
  locked_at timestamptz,
  locked_by text,
  published_at timestamptz,
  created_by uuid references auth.users (id),
  request_id text,
  unique (organization_id, idempotency_key)
);
comment on table public.outbox_events is 'Transactional outbox. Written with the domain change; drained by service-role workers.';

create index outbox_events_dispatch_idx on public.outbox_events (available_at, occurred_at)
  where status in ('pending', 'failed');
create index outbox_events_processing_idx on public.outbox_events (locked_at) where status = 'processing';
create index outbox_events_org_idx on public.outbox_events (organization_id, occurred_at desc);
create index outbox_events_aggregate_idx on public.outbox_events (aggregate_type, aggregate_id, aggregate_version);
create index outbox_events_created_by_idx on public.outbox_events (created_by);

-- ---------------------------------------------------------------------------
-- Enqueue (called from domain functions/triggers or server code inside its transaction).
-- A user caller must be an active member of the organization; the actor is recorded.
-- ---------------------------------------------------------------------------
create function app.enqueue_event(
  p_organization_id uuid,
  p_aggregate_type text,
  p_aggregate_id uuid,
  p_event_type text,
  p_payload jsonb default '{}'::jsonb,
  p_aggregate_version integer default null,
  p_idempotency_key text default null,
  p_available_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  eid uuid;
begin
  if (select auth.uid()) is not null and not app.is_org_member(p_organization_id) then
    raise exception 'not a member of organization' using errcode = '42501';
  end if;
  insert into public.outbox_events (
    organization_id, aggregate_type, aggregate_id, aggregate_version, event_type,
    payload, idempotency_key, available_at, created_by, request_id
  )
  values (
    p_organization_id, p_aggregate_type, p_aggregate_id, p_aggregate_version, p_event_type,
    coalesce(p_payload, '{}'::jsonb), p_idempotency_key, coalesce(p_available_at, clock_timestamp()),
    (select auth.uid()), app.current_request_id()
  )
  on conflict (organization_id, idempotency_key) do nothing
  returning id into eid;

  if eid is null then
    -- duplicate idempotency key: return the existing event (one effect)
    select o.id into eid
    from public.outbox_events o
    where o.organization_id = p_organization_id
      and o.idempotency_key = p_idempotency_key
      and o.event_type = p_event_type
      and o.aggregate_id = p_aggregate_id
      and o.payload = coalesce(p_payload, '{}'::jsonb);
    if eid is null then
      raise exception 'idempotency key reused with a different event' using errcode = '23505';
    end if;
  end if;
  return eid;
end;
$$;
revoke all on function app.enqueue_event(uuid, text, uuid, text, jsonb, integer, text, timestamptz) from public;
grant execute on function app.enqueue_event(uuid, text, uuid, text, jsonb, integer, text, timestamptz) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Worker API (service_role only).
-- ---------------------------------------------------------------------------
-- Claims up to p_limit due events. Rows stuck in processing longer than p_lease are reclaimed.
create function app.claim_outbox_events(p_worker text, p_limit integer default 50, p_lease interval default interval '5 minutes')
returns setof public.outbox_events
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  update public.outbox_events o
     set status = 'processing',
         locked_at = clock_timestamp(),
         locked_by = left(p_worker, 200),
         attempts = o.attempts + 1
   where o.id in (
     select c.id
     from public.outbox_events c
     where (c.status in ('pending', 'failed') and c.available_at <= clock_timestamp())
        or (c.status = 'processing' and c.locked_at < clock_timestamp() - p_lease)
     order by c.available_at, c.occurred_at
     limit greatest(1, least(p_limit, 500))
     for update skip locked
   )
  returning o.*;
end;
$$;

create function app.mark_outbox_published(p_event_id uuid, p_worker text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.outbox_events
     set status = 'published', published_at = clock_timestamp(), locked_at = null, last_error = null
   where id = p_event_id and status = 'processing' and locked_by = left(p_worker, 200);
$$;

-- Exponential backoff (1, 2, 4 ... capped at 60 minutes); dead-letters after p_max_attempts.
create function app.mark_outbox_failed(p_event_id uuid, p_worker text, p_error text, p_max_attempts integer default 8)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.outbox_events
     set status = case when attempts >= p_max_attempts then 'dead_lettered'::public.outbox_status else 'failed'::public.outbox_status end,
         last_error = left(p_error, 2000),
         locked_at = null,
         available_at = clock_timestamp() + least(interval '60 minutes', interval '1 minute' * power(2, greatest(attempts - 1, 0)))
   where id = p_event_id and status = 'processing' and locked_by = left(p_worker, 200);
$$;

-- Manual replay of a dead-lettered event (operator action, audited).
create function app.replay_outbox_event(p_event_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid;
begin
  update public.outbox_events
     set status = 'pending', attempts = 0, available_at = clock_timestamp(), locked_at = null, locked_by = null
   where id = p_event_id and status = 'dead_lettered'
  returning organization_id into org;
  if org is null then
    raise exception 'event not found or not dead-lettered';
  end if;
  perform app.record_audit_event(org, 'outbox.replay', 'public.outbox_events', p_event_id, 'success',
                                 jsonb_build_object('reason', left(p_reason, 500)));
end;
$$;

revoke all on function app.claim_outbox_events(text, integer, interval) from public;
revoke all on function app.mark_outbox_published(uuid, text) from public;
revoke all on function app.mark_outbox_failed(uuid, text, text, integer) from public;
revoke all on function app.replay_outbox_event(uuid, text) from public;
grant execute on function app.claim_outbox_events(text, integer, interval) to service_role;
grant execute on function app.mark_outbox_published(uuid, text) to service_role;
grant execute on function app.mark_outbox_failed(uuid, text, text, integer) to service_role;
grant execute on function app.replay_outbox_event(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- Privileges and RLS. Not readable or writable by API users; workers use the functions above.
-- ---------------------------------------------------------------------------
revoke all on table public.outbox_events from anon, authenticated;

alter table public.outbox_events enable row level security;
alter table public.outbox_events force row level security;

-- Staff may see their firm's event history metadata (for the visible job history requirement).
create policy outbox_events_select_staff on public.outbox_events
  for select to authenticated
  using ((select app.is_org_staff(organization_id)));
grant select on table public.outbox_events to authenticated;
