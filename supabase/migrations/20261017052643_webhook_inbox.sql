-- Provider webhook inbox (FIN-08, ARCH §10, T010).
-- Dedupes on (provider, event_id). provider_account_id is stored, and a second
-- delivery of the same provider event id with a different account is rejected
-- rather than recorded twice. First payload wins.
-- Signature verification stays in the worker; this table only records the flag
-- the worker passes in. Workers call app.ingest_webhook_event (service_role).
-- Additive only.

create type public.webhook_inbox_status as enum (
  'received',
  'processing',
  'processed',
  'ignored',
  'failed'
);

create table public.webhook_inbox (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id),
  provider text not null check (provider ~ '^[a-z][a-z0-9_]{1,40}$'),
  provider_account_id text not null default '' check (length(provider_account_id) <= 200),
  event_id text not null check (length(event_id) between 1 and 200),
  event_type text check (event_type is null or length(event_type) <= 120),
  payload jsonb not null default '{}'::jsonb check (pg_column_size(payload) <= 65536),
  signature_verified boolean not null default false,
  status public.webhook_inbox_status not null default 'received',
  received_at timestamptz not null default clock_timestamp(),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (provider, event_id)
);
comment on table public.webhook_inbox is
  'Transactional inbox. Unique (provider, event_id) so a duplicate callback is one row.';

create index webhook_inbox_org_idx on public.webhook_inbox (organization_id, received_at desc);
create index webhook_inbox_status_idx on public.webhook_inbox (status, received_at)
  where status in ('received', 'processing', 'failed');
create index webhook_inbox_created_by_idx on public.webhook_inbox (created_by);

create trigger webhook_inbox_touch before update on public.webhook_inbox
  for each row execute function app.touch_row();
create trigger webhook_inbox_audit after insert or update or delete on public.webhook_inbox
  for each row execute function app.audit_row_change('payload');

create function app.ingest_webhook_event(
  p_provider text,
  p_event_id text,
  p_provider_account_id text default '',
  p_event_type text default null,
  p_payload jsonb default '{}'::jsonb,
  p_signature_verified boolean default false,
  p_organization_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  eid uuid;
  account text := left(coalesce(p_provider_account_id, ''), 200);
begin
  insert into public.webhook_inbox (
    organization_id, provider, provider_account_id, event_id, event_type,
    payload, signature_verified, created_by
  ) values (
    p_organization_id,
    p_provider,
    account,
    btrim(p_event_id),
    p_event_type,
    coalesce(p_payload, '{}'::jsonb),
    coalesce(p_signature_verified, false),
    (select auth.uid())
  )
  on conflict (provider, event_id) do nothing
  returning id into eid;

  if eid is not null then
    return eid;
  end if;

  select w.id into eid
  from public.webhook_inbox w
  where w.provider = p_provider
    and w.event_id = btrim(p_event_id)
    and w.provider_account_id = account;

  if eid is null then
    raise exception 'webhook event id reused for a different provider account' using errcode = '23505';
  end if;
  return eid;
end;
$$;
revoke all on function app.ingest_webhook_event(text, text, text, text, jsonb, boolean, uuid) from public, anon, authenticated;
grant execute on function app.ingest_webhook_event(text, text, text, text, jsonb, boolean, uuid) to service_role;

revoke all on table public.webhook_inbox from anon, authenticated, service_role;
grant select on table public.webhook_inbox to authenticated;
grant select, update on table public.webhook_inbox to service_role;

alter table public.webhook_inbox enable row level security;
alter table public.webhook_inbox force row level security;

-- Unscoped rows (organization_id null) stay invisible to tenants until a worker attaches them.
create policy webhook_inbox_select_staff on public.webhook_inbox
  for select
  to authenticated
  using (
    organization_id is not null
    and (select app.is_org_staff(organization_id))
    and (select app.staff_mfa_satisfied())
  );
