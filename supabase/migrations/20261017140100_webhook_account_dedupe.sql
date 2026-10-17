-- FIN-08 dedupe key: (provider, connected account, event id).
-- A missing account is stored as null. NULLS NOT DISTINCT makes two missing
-- accounts the same key, while two different accounts stay two rows.
-- The previous unique (provider, event_id) constraint is replaced. No rows are deleted.
-- First payload for a triple still wins.

alter table public.webhook_inbox
  add column connected_account_id text;

comment on column public.webhook_inbox.connected_account_id is
  'Processor connected account. Null means the event had no account. Part of the FIN-08 dedupe key.';

create function app.sync_webhook_connected_account()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.connected_account_id := nullif(btrim(coalesce(new.provider_account_id, '')), '');
  return new;
end;
$$;
revoke all on function app.sync_webhook_connected_account() from public;

create trigger webhook_inbox_connected_account
  before insert or update of provider_account_id on public.webhook_inbox
  for each row execute function app.sync_webhook_connected_account();

update public.webhook_inbox
set provider_account_id = provider_account_id
where connected_account_id is null;

alter table public.webhook_inbox drop constraint webhook_inbox_provider_event_id_key;

create unique index webhook_inbox_provider_account_event_uidx
  on public.webhook_inbox (provider, connected_account_id, event_id) nulls not distinct;

comment on table public.webhook_inbox is
  'Transactional inbox. Unique (provider, connected_account_id, event_id); a missing account dedupes with another missing account.';

create or replace function app.ingest_webhook_event(
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
  account text := left(btrim(coalesce(p_provider_account_id, '')), 200);
  connected text := nullif(account, '');
begin
  insert into public.webhook_inbox (
    organization_id, provider, provider_account_id, connected_account_id, event_id, event_type,
    payload, signature_verified, created_by
  ) values (
    p_organization_id,
    p_provider,
    account,
    connected,
    btrim(p_event_id),
    p_event_type,
    coalesce(p_payload, '{}'::jsonb),
    coalesce(p_signature_verified, false),
    (select auth.uid())
  )
  on conflict (provider, connected_account_id, event_id) do nothing
  returning id into eid;

  if eid is not null then
    return eid;
  end if;

  select w.id into eid
  from public.webhook_inbox w
  where w.provider = p_provider
    and w.event_id = btrim(p_event_id)
    and w.connected_account_id is not distinct from connected;

  if eid is null then
    raise exception 'webhook event could not be recorded' using errcode = '23505';
  end if;
  return eid;
end;
$$;
