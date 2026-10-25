-- Bug 8: a supported, audited way for the firm owner to disconnect (unlink) the firm's Stripe
-- connected account, so the firm can set up a new one. "Move" = disconnect + the existing setup.
-- TEST MODE ONLY. Casevoya never asks Stripe to delete or reject the account; it stops using it.
--
--   firm_payment_accounts          keeps holding the CURRENT link only (one per firm, an account
--                                  active for one firm at a time: its unique keys are unchanged).
--                                  Every existing lookup reads it, so none of them can see an ended
--                                  link.
--   firm_payment_account_history   append-only: each ended link, copied whole with when it was
--                                  linked, who ended it, when and why. Never updated or deleted.
--   app.unlink_stripe_account      firm owner with a fresh step-up, typed DISCONNECT and a reason.
--                                  Refuses (and lists them) while the account has card payments in
--                                  flight, refunds pending at Stripe or open disputes. Otherwise it
--                                  copies the link into the history, removes the current row and
--                                  records stripe.account_unlinked.
--
-- The current row's blanket no-delete trigger is replaced by one that lets a row go only once its
-- ended link is in the history (so only app.unlink_stripe_account can remove it).
-- app.record_firm_payment_account (latest: 20261019100100_stripe_connect_invoices.sql) also refuses
-- an account another firm used before. Additive only.

create table public.firm_payment_account_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  payment_account_id uuid not null unique,
  provider text not null default 'stripe' check (provider = 'stripe'),
  account_id text not null check (account_id ~ '^acct_[A-Za-z0-9]{6,250}$'),
  livemode boolean not null default false check (livemode is false),
  card_payments_status text not null,
  payouts_status text not null,
  linked_at timestamptz not null,
  linked_by uuid references auth.users (id),
  ended_at timestamptz not null default now(),
  ended_by uuid not null references auth.users (id),
  end_reason text not null check (length(btrim(end_reason)) between 3 and 500),
  created_at timestamptz not null default now()
);
comment on table public.firm_payment_account_history is
  'Append-only. Each Stripe connected account a firm stopped using (test mode): when it was linked, who disconnected it, when and why. The current link is firm_payment_accounts.';

create index firm_payment_account_history_org_idx on public.firm_payment_account_history (organization_id, ended_at desc);
create index firm_payment_account_history_account_idx on public.firm_payment_account_history (account_id);
create index firm_payment_account_history_linked_by_idx on public.firm_payment_account_history (linked_by);
create index firm_payment_account_history_ended_by_idx on public.firm_payment_account_history (ended_by);

create function app.reject_payment_account_history_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'payment account history is append-only' using errcode = '42501';
end;
$$;
revoke all on function app.reject_payment_account_history_change() from public;

create trigger firm_payment_account_history_no_change before update or delete on public.firm_payment_account_history
  for each row execute function app.reject_payment_account_history_change();
create trigger firm_payment_account_history_no_truncate before truncate on public.firm_payment_account_history
  for each statement execute function app.reject_governed_delete();

-- A current link may be removed only once its ended link is in the history.
create function app.guard_payment_account_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.firm_payment_account_history history
    where history.payment_account_id = old.id
      and history.organization_id = old.organization_id
      and history.account_id = old.account_id
  ) then
    raise exception '% rows are retained', tg_table_name using errcode = '42501';
  end if;
  return old;
end;
$$;
revoke all on function app.guard_payment_account_delete() from public;

alter table public.firm_payment_accounts disable trigger firm_payment_accounts_no_delete;
create trigger firm_payment_accounts_unlink_only before delete on public.firm_payment_accounts
  for each row execute function app.guard_payment_account_delete();
create trigger firm_payment_accounts_no_truncate before truncate on public.firm_payment_accounts
  for each statement execute function app.reject_governed_delete();

-- What keeps the account in use: card payments in flight (processing, or started in the last 24
-- hours and not finished), refunds still pending at Stripe, and open disputes. Most recent first.
create function app.stripe_account_unlink_blockers(p_org uuid, p_account_id text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(item order by item ->> 'created_at' desc), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'kind', 'payment', 'number', invoice.number, 'invoice_number', invoice.number,
      'amount_cents', payment.amount_cents, 'currency', payment.currency, 'status', payment.status::text,
      'created_at', payment.created_at
    ) as item
    from public.invoice_payments payment
    join public.invoices invoice on invoice.id = payment.invoice_id
    where payment.organization_id = p_org
      and payment.connected_account_id = p_account_id
      and (
        payment.status = 'processing'
        or (payment.status = 'requires_payment' and payment.created_at > now() - interval '24 hours')
      )
    union all
    select jsonb_build_object(
      'kind', 'refund', 'number', refund.number, 'invoice_number', invoice.number,
      'amount_cents', refund.amount_cents, 'currency', refund.currency, 'status', refund.status::text,
      'created_at', refund.created_at
    )
    from public.invoice_refunds refund
    join public.invoices invoice on invoice.id = refund.invoice_id
    where refund.organization_id = p_org
      and refund.connected_account_id = p_account_id
      and refund.status in ('pending', 'requires_action')
    union all
    select jsonb_build_object(
      'kind', 'dispute', 'number', dispute.number, 'invoice_number', invoice.number,
      'amount_cents', dispute.amount_cents, 'currency', dispute.currency, 'status', dispute.status::text,
      'created_at', dispute.created_at
    )
    from public.invoice_disputes dispute
    join public.invoices invoice on invoice.id = dispute.invoice_id
    where dispute.organization_id = p_org
      and dispute.connected_account_id = p_account_id
      and dispute.status in ('warning_needs_response', 'warning_under_review', 'needs_response', 'under_review')
  ) items;
$$;
revoke all on function app.stripe_account_unlink_blockers(uuid, text) from public;

-- Ends the firm's current Stripe link. Returns {unlinked: true, history_id} or, when something
-- still runs on the account, {unlinked: false, blockers: [...]} with nothing changed.
create function app.unlink_stripe_account(p_org uuid, p_account_id text, p_confirmation text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_link public.firm_payment_accounts%rowtype;
  blockers jsonb;
  reason_text text := btrim(coalesce(p_reason, ''));
  hid uuid;
begin
  perform app.require_firm_owner_step_up(p_org);
  select * into current_link from public.firm_payment_accounts where organization_id = p_org for update;
  if current_link.id is null then
    raise exception 'this firm has no Stripe account to disconnect' using errcode = '22023';
  end if;
  if current_link.account_id is distinct from btrim(coalesce(p_account_id, '')) then
    raise exception 'the firm''s Stripe account changed; reload and try again' using errcode = '40001';
  end if;
  if btrim(coalesce(p_confirmation, '')) <> 'DISCONNECT' then
    raise exception 'type DISCONNECT to confirm' using errcode = '22023';
  end if;
  if length(reason_text) not between 3 and 500 then
    raise exception 'a reason of 3 to 500 characters is required' using errcode = '22023';
  end if;

  blockers := app.stripe_account_unlink_blockers(p_org, current_link.account_id);
  if jsonb_array_length(blockers) > 0 then
    perform app.record_audit_event(
      p_org, 'stripe.account_unlink_refused', 'public.firm_payment_accounts', current_link.id, 'denied',
      jsonb_build_object('provider', 'stripe', 'account_id', current_link.account_id, 'open_items', jsonb_array_length(blockers))
    );
    return jsonb_build_object('unlinked', false, 'blockers', blockers);
  end if;

  insert into public.firm_payment_account_history (
    organization_id, payment_account_id, account_id, livemode, card_payments_status, payouts_status,
    linked_at, linked_by, ended_by, end_reason
  ) values (
    p_org, current_link.id, current_link.account_id, current_link.livemode, current_link.card_payments_status,
    current_link.payouts_status, current_link.created_at, current_link.created_by, (select auth.uid()), reason_text
  )
  returning id into hid;
  delete from public.firm_payment_accounts where id = current_link.id;
  perform app.record_audit_event(
    p_org, 'stripe.account_unlinked', 'public.firm_payment_account_history', hid, 'success',
    jsonb_build_object('provider', 'stripe', 'account_id', current_link.account_id, 'payment_account_id', current_link.id, 'reason', reason_text)
  );
  return jsonb_build_object('unlinked', true, 'history_id', hid);
end;
$$;
revoke all on function app.unlink_stripe_account(uuid, text, text, text) from public;

-- From 20261019100100_stripe_connect_invoices.sql; also refuses an account another firm used before.
create or replace function app.record_firm_payment_account(p_org uuid, p_account_id text, p_livemode boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.firm_payment_accounts%rowtype;
  rid uuid;
  account text := btrim(coalesce(p_account_id, ''));
begin
  perform app.require_firm_owner_step_up(p_org);
  if p_livemode is distinct from false then
    raise exception 'only a test-mode Stripe account can be connected' using errcode = '22023';
  end if;
  if account !~ '^acct_[A-Za-z0-9]{6,250}$' then
    raise exception 'stripe account id is invalid' using errcode = '22023';
  end if;
  select * into existing from public.firm_payment_accounts where organization_id = p_org for update;
  if existing.id is not null then
    if existing.account_id <> account then
      raise exception 'this firm already has a Stripe account' using errcode = '23505';
    end if;
    return existing.id;
  end if;
  if exists (
    select 1 from public.firm_payment_account_history history
    where history.account_id = account and history.organization_id <> p_org
  ) then
    raise exception 'this Stripe account belongs to another firm' using errcode = '23505';
  end if;
  insert into public.firm_payment_accounts (organization_id, account_id, livemode)
  values (p_org, account, false)
  returning id into rid;
  perform app.record_audit_event(
    p_org, 'finance.payment_account_connected', 'public.firm_payment_accounts', rid, 'success',
    jsonb_build_object('provider', 'stripe', 'livemode', false)
  );
  return rid;
end;
$$;

create function public.unlink_stripe_account(p_org uuid, p_account_id text, p_confirmation text, p_reason text)
returns jsonb language sql security invoker set search_path = ''
as $$ select app.unlink_stripe_account(p_org, p_account_id, p_confirmation, p_reason); $$;

revoke all on function public.unlink_stripe_account(uuid, text, text, text) from public, anon;
grant execute on function public.unlink_stripe_account(uuid, text, text, text) to authenticated;
grant execute on function app.unlink_stripe_account(uuid, text, text, text) to authenticated;

revoke all on table public.firm_payment_account_history from anon, authenticated, service_role;
grant select on table public.firm_payment_account_history to authenticated, service_role;

alter table public.firm_payment_account_history enable row level security;
alter table public.firm_payment_account_history force row level security;

create policy firm_payment_account_history_select on public.firm_payment_account_history
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.can_read_firm_payment_account(organization_id))
  );
