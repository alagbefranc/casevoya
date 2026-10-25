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
--                                  records stripe.account_unlinked. It returns the payment requests
--                                  still open on the old account (started or failed card payments,
--                                  of any age) so the server action cancels them at Stripe.
--   app.record_stripe_unlink_cancellations
--                                  records what Stripe answered for each (canceled / already
--                                  finished / failed): canceled rows are marked canceled, the
--                                  results are audited, and a failure opens a task for the owner.
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
  open_requests jsonb;
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
  -- Payment requests a client could still complete on the old account: the server action cancels
  -- them at Stripe right after this commits, then records the results.
  select coalesce(jsonb_agg(jsonb_build_object(
           'payment_id', payment.id, 'payment_intent_id', payment.payment_intent_id,
           'invoice_number', invoice.number, 'amount_cents', payment.amount_cents, 'currency', payment.currency
         ) order by payment.created_at), '[]'::jsonb)
    into open_requests
  from public.invoice_payments payment
  join public.invoices invoice on invoice.id = payment.invoice_id
  where payment.organization_id = p_org
    and payment.connected_account_id = current_link.account_id
    and payment.status in ('requires_payment', 'failed');
  perform app.record_audit_event(
    p_org, 'stripe.account_unlinked', 'public.firm_payment_account_history', hid, 'success',
    jsonb_build_object('provider', 'stripe', 'account_id', current_link.account_id, 'payment_account_id', current_link.id, 'reason', reason_text, 'open_requests', jsonb_array_length(open_requests))
  );
  return jsonb_build_object('unlinked', true, 'history_id', hid, 'account_id', current_link.account_id, 'open_requests', open_requests);
end;
$$;
revoke all on function app.unlink_stripe_account(uuid, text, text, text) from public;

-- What Stripe answered when the server action canceled the old account's open payment requests,
-- once per disconnect, by the owner who disconnected it (fresh step-up). Each result names one of
-- the requests app.unlink_stripe_account returned: 'canceled' marks the row canceled, 'already_finished'
-- leaves it to Stripe's own event, 'failed' is listed in a task for the firm owner (on the first
-- failed request's matter). All results are audited as stripe.account_unlink_requests_closed.
create function app.record_stripe_unlink_cancellations(p_history_id uuid, p_results jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ended public.firm_payment_account_history%rowtype;
  entry jsonb;
  payment public.invoice_payments%rowtype;
  outcome_text text;
  recorded jsonb := '[]'::jsonb;
  failed_count integer := 0;
  canceled_count integer := 0;
  failed_matter uuid;
  new_task uuid;
begin
  select * into ended from public.firm_payment_account_history where id = p_history_id;
  if ended.id is null then
    raise exception 'disconnected account not found' using errcode = '42501';
  end if;
  perform app.require_firm_owner_step_up(ended.organization_id);
  if ended.ended_by is distinct from (select auth.uid()) then
    raise exception 'only the owner who disconnected the account records its requests' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.audit_log log
    where log.object_id = ended.id and log.action = 'stripe.account_unlink_requests_closed'
  ) then
    raise exception 'these requests are already recorded' using errcode = '23505';
  end if;
  if jsonb_typeof(coalesce(p_results, 'null'::jsonb)) <> 'array' or jsonb_array_length(p_results) > 500 then
    raise exception 'results must be a list' using errcode = '22023';
  end if;

  for entry in select value from jsonb_array_elements(p_results) loop
    outcome_text := entry ->> 'result';
    if outcome_text is null or outcome_text not in ('canceled', 'already_finished', 'failed') then
      raise exception 'unknown result' using errcode = '22023';
    end if;
    if coalesce(entry ->> 'payment_id', '') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
      raise exception 'payment request not on the disconnected account' using errcode = '42501';
    end if;
    select * into payment from public.invoice_payments
    where id = (entry ->> 'payment_id')::uuid
      and organization_id = ended.organization_id
      and connected_account_id = ended.account_id
    for update;
    if payment.id is null then
      raise exception 'payment request not on the disconnected account' using errcode = '42501';
    end if;
    if outcome_text = 'canceled' then
      update public.invoice_payments set status = 'canceled'
      where id = payment.id and status in ('requires_payment', 'failed');
      canceled_count := canceled_count + 1;
    elsif outcome_text = 'failed' then
      failed_count := failed_count + 1;
      if failed_matter is null then
        select invoice.matter_id into failed_matter from public.invoices invoice where invoice.id = payment.invoice_id;
      end if;
    end if;
    recorded := recorded || jsonb_build_array(jsonb_build_object(
      'payment_id', payment.id, 'payment_intent_id', payment.payment_intent_id, 'result', outcome_text
    ));
  end loop;

  if failed_count > 0 then
    new_task := app.create_finance_task(
      ended.organization_id, failed_matter,
      format('Cancel %s card payment request%s on the disconnected Stripe account at Stripe', failed_count, case when failed_count = 1 then '' else 's' end),
      'high', app.firm_today(ended.organization_id), 'stripe-unlink-' || ended.id::text
    );
  end if;
  perform app.record_audit_event(
    ended.organization_id, 'stripe.account_unlink_requests_closed', 'public.firm_payment_account_history', ended.id,
    case when failed_count > 0 then 'failure' else 'success' end,
    jsonb_build_object('account_id', ended.account_id, 'results', recorded, 'canceled', canceled_count, 'failed', failed_count, 'task_id', new_task)
  );
  return jsonb_build_object('canceled', canceled_count, 'failed', failed_count, 'task_id', new_task);
end;
$$;
revoke all on function app.record_stripe_unlink_cancellations(uuid, jsonb) from public;

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

create function public.record_stripe_unlink_cancellations(p_history_id uuid, p_results jsonb)
returns jsonb language sql security invoker set search_path = ''
as $$ select app.record_stripe_unlink_cancellations(p_history_id, p_results); $$;

revoke all on function public.record_stripe_unlink_cancellations(uuid, jsonb) from public, anon;
grant execute on function public.record_stripe_unlink_cancellations(uuid, jsonb) to authenticated;
grant execute on function app.record_stripe_unlink_cancellations(uuid, jsonb) to authenticated;
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
