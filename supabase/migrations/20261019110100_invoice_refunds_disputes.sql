-- Card refunds and disputes on invoice payments (FIN-13). TEST MODE ONLY.
--
--   invoice_refunds          one row per Stripe refund (re_...) of a card payment on the firm's
--                            connected account. Recorded as pending when the firm asks Stripe for it;
--                            only verified webhook events move it to succeeded, failed or canceled.
--   invoice_disputes         one row per Stripe dispute (du_...) on a card payment, with Stripe's
--                            status, amount, reason and evidence deadline. Responding with evidence
--                            is not built: the row is a record, not a workflow.
--   invoice_reversal_events  append-only record of every refund, charge.refunded and dispute event
--                            applied (or refused). Unique (provider, connected account, event id).
--
-- Money rules, enforced here and not only in the page:
--   * A payment is refunded at most what Stripe received for it, counting refunds still pending.
--   * A succeeded refund never moves back; failed and canceled refunds are final too.
--   * invoices.refunded_cents and invoice_payments.refunded_cents count succeeded refunds only.
--     When every cent received on an invoice is refunded, the invoice becomes 'refunded'; a partial
--     refund leaves it paid (or partially paid) and shows the refunded amount.
--   * A refund or a dispute never changes the matter stage or a government status.
--
-- Refunds need the firm owner or the matter's finance user (billing access, aal2) and a recent
-- step-up, like other money movement. Events are applied only by service_role through
-- app.apply_stripe_reversal_event, deduped through public.webhook_inbox. Who reads what mirrors
-- invoice_payments: billing staff, and the client who is a party on the invoice's matter.
-- Additive only.

create type public.invoice_refund_status as enum (
  'pending',
  'requires_action',
  'succeeded',
  'failed',
  'canceled'
);

-- Stripe's dispute statuses (https://docs.stripe.com/api/disputes/object#dispute_object-status).
create type public.invoice_dispute_status as enum (
  'warning_needs_response',
  'warning_under_review',
  'warning_closed',
  'needs_response',
  'under_review',
  'won',
  'lost',
  'prevented'
);

alter table public.invoices add column refunded_cents bigint not null default 0;
alter table public.invoices add constraint invoices_refunded_within_paid
  check (refunded_cents >= 0 and refunded_cents <= paid_cents);
alter table public.invoices add constraint invoices_refunded_status
  check (status <> 'refunded' or (paid_cents > 0 and refunded_cents >= paid_cents));
comment on column public.invoices.refunded_cents is
  'Succeeded card refunds on this invoice, minor units. Never more than paid_cents.';

alter table public.invoice_payments add column refunded_cents bigint not null default 0;
alter table public.invoice_payments add constraint invoice_payments_refunded_within_received
  check (refunded_cents >= 0 and refunded_cents <= amount_received_cents);
comment on column public.invoice_payments.refunded_cents is
  'Succeeded refunds of this payment, minor units. Never more than amount_received_cents.';

create table public.invoice_refunds (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  invoice_id uuid not null,
  payment_id uuid not null,
  number text not null check (number ~ '^RF-[0-9]{4,9}$'),
  provider text not null default 'stripe' check (provider = 'stripe'),
  refund_id text not null unique check (refund_id ~ '^(re|pyr)_[A-Za-z0-9]{6,250}$'),
  connected_account_id text not null check (connected_account_id ~ '^acct_[A-Za-z0-9]{6,250}$'),
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 99999999999),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  reason text check (reason is null or reason in ('duplicate', 'fraudulent', 'requested_by_customer')),
  status public.invoice_refund_status not null default 'pending',
  failure_reason text check (failure_reason is null or length(failure_reason) <= 120),
  livemode boolean not null default false check (livemode is false),
  idempotency_key text check (idempotency_key is null or length(idempotency_key) between 8 and 180),
  requested_by uuid references auth.users (id),
  last_event_id text,
  succeeded_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id),
  unique (organization_id, number),
  unique (organization_id, idempotency_key),
  foreign key (invoice_id, organization_id) references public.invoices (id, organization_id),
  foreign key (payment_id, organization_id) references public.invoice_payments (id, organization_id)
);
comment on table public.invoice_refunds is
  'One Stripe refund of a card payment (test mode). Pending until a verified webhook event says otherwise; never more than the payment received (FIN-13).';

create index invoice_refunds_invoice_org_fk_idx on public.invoice_refunds (invoice_id, organization_id);
create index invoice_refunds_payment_org_fk_idx on public.invoice_refunds (payment_id, organization_id);
create index invoice_refunds_org_created_idx on public.invoice_refunds (organization_id, created_at desc);
create index invoice_refunds_requested_by_idx on public.invoice_refunds (requested_by);
create index invoice_refunds_created_by_idx on public.invoice_refunds (created_by);

create table public.invoice_disputes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  invoice_id uuid not null,
  payment_id uuid not null,
  number text not null check (number ~ '^DP-[0-9]{4,9}$'),
  provider text not null default 'stripe' check (provider = 'stripe'),
  dispute_id text not null unique check (dispute_id ~ '^(du|dp)_[A-Za-z0-9]{6,250}$'),
  charge_id text check (charge_id is null or charge_id ~ '^(ch|py)_[A-Za-z0-9]{6,250}$'),
  connected_account_id text not null check (connected_account_id ~ '^acct_[A-Za-z0-9]{6,250}$'),
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 99999999999),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  reason text check (reason is null or reason ~ '^[a-z_]{1,60}$'),
  status public.invoice_dispute_status not null,
  evidence_due_by timestamptz,
  closed_at timestamptz,
  livemode boolean not null default false check (livemode is false),
  last_event_id text,
  last_event_created bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id),
  unique (organization_id, number),
  foreign key (invoice_id, organization_id) references public.invoices (id, organization_id),
  foreign key (payment_id, organization_id) references public.invoice_payments (id, organization_id)
);
comment on table public.invoice_disputes is
  'A card dispute (chargeback or inquiry) Stripe reported on a payment, test mode. A record only: evidence is not submitted from Casevoya.';

create index invoice_disputes_invoice_org_fk_idx on public.invoice_disputes (invoice_id, organization_id);
create index invoice_disputes_payment_org_fk_idx on public.invoice_disputes (payment_id, organization_id);
create index invoice_disputes_org_created_idx on public.invoice_disputes (organization_id, created_at desc);
create index invoice_disputes_created_by_idx on public.invoice_disputes (created_by);

create table public.invoice_reversal_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  invoice_id uuid not null,
  payment_id uuid not null,
  refund_id uuid,
  dispute_id uuid,
  webhook_inbox_id uuid not null references public.webhook_inbox (id),
  provider text not null default 'stripe' check (provider = 'stripe'),
  connected_account_id text not null,
  event_id text not null check (length(event_id) between 1 and 200),
  event_type text not null check (length(event_type) between 1 and 120),
  object_id text check (object_id is null or length(object_id) <= 255),
  amount_cents bigint,
  currency text,
  outcome text not null check (outcome in ('applied', 'unchanged', 'rejected')),
  detail text check (detail is null or length(detail) <= 300),
  refund_status public.invoice_refund_status,
  dispute_status public.invoice_dispute_status,
  invoice_status public.invoice_status not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (provider, connected_account_id, event_id),
  check (num_nonnulls(refund_id, dispute_id) <= 1),
  foreign key (invoice_id, organization_id) references public.invoices (id, organization_id),
  foreign key (payment_id, organization_id) references public.invoice_payments (id, organization_id),
  foreign key (refund_id, organization_id) references public.invoice_refunds (id, organization_id),
  foreign key (dispute_id, organization_id) references public.invoice_disputes (id, organization_id)
);
comment on table public.invoice_reversal_events is
  'Append-only. Every refund and dispute event applied to a payment, with the resulting states. Unique (provider, connected account, event id) (FIN-08).';

create index invoice_reversal_events_org_idx on public.invoice_reversal_events (organization_id, created_at desc);
create index invoice_reversal_events_invoice_org_fk_idx on public.invoice_reversal_events (invoice_id, organization_id);
create index invoice_reversal_events_payment_org_fk_idx on public.invoice_reversal_events (payment_id, organization_id);
create index invoice_reversal_events_refund_org_fk_idx on public.invoice_reversal_events (refund_id, organization_id);
create index invoice_reversal_events_dispute_org_fk_idx on public.invoice_reversal_events (dispute_id, organization_id);
create index invoice_reversal_events_inbox_fk_idx on public.invoice_reversal_events (webhook_inbox_id);

create trigger invoice_refunds_touch before update on public.invoice_refunds
  for each row execute function app.touch_row();
create trigger invoice_refunds_stamp before insert on public.invoice_refunds
  for each row execute function app.stamp_created_by();
create trigger invoice_refunds_audit after insert or update or delete on public.invoice_refunds
  for each row execute function app.audit_row_change();
create trigger invoice_refunds_no_delete before delete on public.invoice_refunds
  for each row execute function app.reject_governed_delete();

create trigger invoice_disputes_touch before update on public.invoice_disputes
  for each row execute function app.touch_row();
create trigger invoice_disputes_stamp before insert on public.invoice_disputes
  for each row execute function app.stamp_created_by();
create trigger invoice_disputes_audit after insert or update or delete on public.invoice_disputes
  for each row execute function app.audit_row_change();
create trigger invoice_disputes_no_delete before delete on public.invoice_disputes
  for each row execute function app.reject_governed_delete();

create trigger invoice_reversal_events_no_change before update or delete on public.invoice_reversal_events
  for each row execute function app.reject_payment_event_change();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- What a payment can still be refunded: received, less refunds that are pending, need action
-- or succeeded. Failed and canceled refunds give the amount back.
create function app.payment_refundable_cents(p_payment_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(
    payment.amount_received_cents - coalesce((
      select sum(refund.amount_cents)
      from public.invoice_refunds refund
      where refund.payment_id = payment.id
        and refund.status in ('pending', 'requires_action', 'succeeded')
    ), 0),
    0
  )::bigint
  from public.invoice_payments payment
  where payment.id = p_payment_id;
$$;
revoke all on function app.payment_refundable_cents(uuid) from public;

-- Refunding needs billing access to the invoice's matter (firm owner, or the assigned finance
-- user, at aal2) and a recent step-up. Raises; returns the payment row when allowed.
create function app.require_refund_access(p_payment_id uuid)
returns public.invoice_payments
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  payment public.invoice_payments%rowtype;
  invoice public.invoices%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'sign in is required' using errcode = '42501';
  end if;
  select * into payment from public.invoice_payments where id = p_payment_id;
  if payment.id is not null then
    select * into invoice from public.invoices where id = payment.invoice_id;
  end if;
  if payment.id is null or invoice.id is null
     or app.can_read_matter_billing(invoice.matter_id) is distinct from true then
    raise exception 'billing access denied' using errcode = '42501';
  end if;
  if app.mfa_step_up_satisfied() is distinct from true then
    raise exception 'step-up is required' using errcode = '42501';
  end if;
  return payment;
end;
$$;
revoke all on function app.require_refund_access(uuid) from public;

create function app.dispute_status_rank(p_status public.invoice_dispute_status)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_status
    when 'warning_needs_response' then 1
    when 'needs_response' then 1
    when 'warning_under_review' then 2
    when 'under_review' then 2
    else 3
  end;
$$;
revoke all on function app.dispute_status_rank(public.invoice_dispute_status) from public;

-- ---------------------------------------------------------------------------
-- Refunding a payment (billing staff with a recent step-up)
-- ---------------------------------------------------------------------------

-- What the server needs to ask Stripe for a refund: the PaymentIntent, the firm's account and the
-- refundable remainder. Refuses anyone without billing access and step-up.
create function app.invoice_refund_context(p_payment_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  payment public.invoice_payments%rowtype;
  invoice public.invoices%rowtype;
  firm_account text;
begin
  payment := app.require_refund_access(p_payment_id);
  select * into invoice from public.invoices where id = payment.invoice_id;
  if payment.status <> 'succeeded' or payment.amount_received_cents <= 0 then
    raise exception 'only a received card payment can be refunded' using errcode = '22023';
  end if;
  select fpa.account_id into firm_account from public.firm_payment_accounts fpa where fpa.organization_id = payment.organization_id;
  if firm_account is distinct from payment.connected_account_id then
    raise exception 'payment account does not match the firm' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'payment_id', payment.id,
    'invoice_id', invoice.id,
    'organization_id', payment.organization_id,
    'number', invoice.number,
    'payment_intent_id', payment.payment_intent_id,
    'account_id', payment.connected_account_id,
    'currency', payment.currency,
    'received', payment.amount_received_cents,
    'refundable', app.payment_refundable_cents(payment.id)
  );
end;
$$;
revoke all on function app.invoice_refund_context(uuid) from public;

-- Records the refund Stripe just created, as pending. Idempotent on the Stripe refund id and on the
-- caller's idempotency key. Refuses more than the payment's refundable remainder.
create function app.record_invoice_refund(
  p_payment_id uuid,
  p_refund_id text,
  p_amount_cents bigint,
  p_currency text,
  p_reason text,
  p_livemode boolean,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  payment public.invoice_payments%rowtype;
  existing public.invoice_refunds%rowtype;
  refund_key text := btrim(coalesce(p_refund_id, ''));
  key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  refund_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  next_number integer;
  rid uuid;
begin
  payment := app.require_refund_access(p_payment_id);
  -- One refund decision at a time per payment, so two requests cannot both pass the limit.
  select * into payment from public.invoice_payments where id = payment.id for update;
  if p_livemode is distinct from false then
    raise exception 'only test-mode refunds are accepted' using errcode = '22023';
  end if;
  if refund_key !~ '^(re|pyr)_[A-Za-z0-9]{6,250}$' then
    raise exception 'stripe refund id is invalid' using errcode = '22023';
  end if;
  if key is not null and length(key) not between 8 and 180 then
    raise exception 'idempotency key is invalid' using errcode = '22023';
  end if;
  if refund_reason is not null and refund_reason not in ('duplicate', 'fraudulent', 'requested_by_customer') then
    raise exception 'refund reason is not one Stripe accepts' using errcode = '22023';
  end if;

  select * into existing from public.invoice_refunds where refund_id = refund_key;
  if existing.id is not null then
    if existing.payment_id <> payment.id then
      raise exception 'refund belongs to another payment' using errcode = '42501';
    end if;
    -- The webhook may have recorded it first; keep who asked and why.
    if existing.requested_by is null then
      update public.invoice_refunds
      set requested_by = (select auth.uid()),
          reason = coalesce(existing.reason, refund_reason),
          idempotency_key = coalesce(existing.idempotency_key, key)
      where id = existing.id;
    end if;
    return existing.id;
  end if;
  if key is not null then
    select * into existing from public.invoice_refunds where organization_id = payment.organization_id and idempotency_key = key;
    if existing.id is not null then
      raise exception 'idempotency key was used for another refund' using errcode = '23505';
    end if;
  end if;

  if payment.status <> 'succeeded' or payment.amount_received_cents <= 0 then
    raise exception 'only a received card payment can be refunded' using errcode = '22023';
  end if;
  if upper(btrim(coalesce(p_currency, ''))) <> payment.currency then
    raise exception 'refund currency does not match the payment' using errcode = '22023';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'refund amount must be positive' using errcode = '22023';
  end if;
  if p_amount_cents > app.payment_refundable_cents(payment.id) then
    raise exception 'refund exceeds the amount received' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('casevoya.refund_number:' || payment.organization_id::text, 0));
  select coalesce(max(substring(refund.number from 4)::integer), 0) + 1 into next_number
  from public.invoice_refunds refund
  where refund.organization_id = payment.organization_id;

  insert into public.invoice_refunds (
    organization_id, invoice_id, payment_id, number, refund_id, connected_account_id,
    amount_cents, currency, reason, status, livemode, idempotency_key, requested_by
  ) values (
    payment.organization_id, payment.invoice_id, payment.id, 'RF-' || lpad(next_number::text, 4, '0'), refund_key,
    payment.connected_account_id, p_amount_cents, payment.currency, refund_reason, 'pending', false, key, (select auth.uid())
  )
  returning id into rid;
  perform app.record_audit_event(
    payment.organization_id, 'invoice.refund_requested', 'public.invoice_refunds', rid, 'success',
    jsonb_build_object('invoice_id', payment.invoice_id, 'payment_id', payment.id, 'amount_cents', p_amount_cents, 'currency', payment.currency)
  );
  return rid;
end;
$$;
revoke all on function app.record_invoice_refund(uuid, text, bigint, text, text, boolean, text) from public;

-- ---------------------------------------------------------------------------
-- Webhook events (service_role only)
-- ---------------------------------------------------------------------------

-- Applies one verified Stripe refund, charge.refunded or dispute event from a connected account.
-- Idempotent through public.webhook_inbox (provider, connected account, event id): a redelivery
-- returns 'duplicate' and changes nothing. The account and currency must match the payment, and a
-- refund's amount must match its row. A refund Stripe made that Casevoya did not record (the
-- browser went away) is recovered from the event when it fits the refundable remainder.
-- Succeeded, failed and canceled refunds are final; a closed dispute stays closed and an older
-- dispute state never overwrites a newer one. A refund or dispute never touches the matter.
create function app.apply_stripe_reversal_event(
  p_event_id text,
  p_account_id text,
  p_event_type text,
  p_object_id text,
  p_payment_intent_id text,
  p_charge_id text,
  p_amount_cents bigint,
  p_currency text,
  p_status text,
  p_reason text,
  p_failure_reason text,
  p_evidence_due_by timestamptz,
  p_amount_refunded_cents bigint,
  p_event_created bigint,
  p_livemode boolean,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_key text := btrim(coalesce(p_event_id, ''));
  account_key text := btrim(coalesce(p_account_id, ''));
  event_type text := left(btrim(coalesce(p_event_type, '')), 120);
  object_key text := btrim(coalesce(p_object_id, ''));
  currency text := upper(btrim(coalesce(p_currency, '')));
  payment public.invoice_payments%rowtype;
  invoice public.invoices%rowtype;
  refund public.invoice_refunds%rowtype;
  dispute public.invoice_disputes%rowtype;
  inbox_id uuid;
  inbox_status public.webhook_inbox_status;
  next_refund public.invoice_refund_status;
  next_dispute public.invoice_dispute_status;
  outcome text := 'unchanged';
  detail text;
  next_number integer;
begin
  if length(event_key) = 0 then
    raise exception 'event id is required' using errcode = '22023';
  end if;

  select * into payment from public.invoice_payments where payment_intent_id = btrim(coalesce(p_payment_intent_id, ''));

  inbox_id := app.ingest_webhook_event(
    'stripe', event_key, account_key, event_type, coalesce(p_payload, '{}'::jsonb), true, payment.organization_id
  );
  select w.status into inbox_status from public.webhook_inbox w where w.id = inbox_id for update;
  if inbox_status in ('processed', 'ignored') then
    return jsonb_build_object('outcome', 'duplicate');
  end if;

  if payment.id is null or p_livemode is not false then
    update public.webhook_inbox set status = 'ignored', processed_at = clock_timestamp() where id = inbox_id;
    return jsonb_build_object('outcome', 'ignored', 'reason', case when p_livemode is not false then 'livemode' else 'unknown_payment' end);
  end if;

  select * into invoice from public.invoices where id = payment.invoice_id for update;
  select * into payment from public.invoice_payments where id = payment.id for update;

  if payment.connected_account_id <> account_key then
    outcome := 'rejected';
    detail := 'connected account does not match';
  elsif currency <> payment.currency then
    outcome := 'rejected';
    detail := 'currency does not match';
  elsif event_type in ('refund.created', 'refund.updated', 'refund.failed') then
    next_refund := case
      when event_type = 'refund.failed' then 'failed'
      when p_status in ('pending', 'requires_action', 'succeeded', 'failed', 'canceled') then p_status::public.invoice_refund_status
      else null
    end;
    select * into refund from public.invoice_refunds where refund_id = object_key for update;
    if refund.id is null then
      -- Stripe made a refund Casevoya did not record: recover it when it fits.
      if object_key !~ '^(re|pyr)_[A-Za-z0-9]{6,250}$' or coalesce(p_amount_cents, 0) <= 0 then
        outcome := 'rejected';
        detail := 'refund is invalid';
      elsif payment.status <> 'succeeded' or p_amount_cents > app.payment_refundable_cents(payment.id) then
        outcome := 'rejected';
        detail := 'refund exceeds the amount received';
      else
        perform pg_advisory_xact_lock(hashtextextended('casevoya.refund_number:' || payment.organization_id::text, 0));
        select coalesce(max(substring(r.number from 4)::integer), 0) + 1 into next_number
        from public.invoice_refunds r
        where r.organization_id = payment.organization_id;
        insert into public.invoice_refunds (
          organization_id, invoice_id, payment_id, number, refund_id, connected_account_id,
          amount_cents, currency, reason, status, livemode
        ) values (
          payment.organization_id, payment.invoice_id, payment.id, 'RF-' || lpad(next_number::text, 4, '0'), object_key,
          payment.connected_account_id, p_amount_cents, payment.currency,
          case when p_reason in ('duplicate', 'fraudulent', 'requested_by_customer') then p_reason end,
          'pending', false
        )
        returning * into refund;
        outcome := 'applied';
        detail := 'refund recorded from Stripe';
      end if;
    end if;

    if refund.id is not null and outcome <> 'rejected' then
      if refund.payment_id <> payment.id then
        outcome := 'rejected';
        detail := 'refund belongs to another payment';
      elsif p_amount_cents is distinct from refund.amount_cents then
        outcome := 'rejected';
        detail := 'amount does not match';
      elsif next_refund is null then
        detail := coalesce(detail, 'refund status not applied');
      elsif refund.status in ('succeeded', 'failed', 'canceled') then
        outcome := 'unchanged';
        detail := 'refund already ' || refund.status::text;
      elsif next_refund = refund.status then
        null;
      elsif next_refund = 'succeeded' then
        if refund.amount_cents > payment.amount_received_cents - payment.refunded_cents
           or refund.amount_cents > invoice.paid_cents - invoice.refunded_cents then
          outcome := 'rejected';
          detail := 'refund exceeds the amount received';
        else
          outcome := 'applied';
          update public.invoice_refunds
          set status = 'succeeded', succeeded_at = clock_timestamp(), last_event_id = event_key
          where id = refund.id
          returning * into refund;
          update public.invoice_payments
          set refunded_cents = refunded_cents + refund.amount_cents
          where id = payment.id
          returning * into payment;
          update public.invoices
          set refunded_cents = refunded_cents + refund.amount_cents,
              status = case
                when refunded_cents + refund.amount_cents >= paid_cents then 'refunded'::public.invoice_status
                else status
              end
          where id = invoice.id
          returning * into invoice;
          perform app.record_audit_event(
            invoice.organization_id, 'invoice.refund_succeeded', 'public.invoice_refunds', refund.id, 'success',
            jsonb_build_object('invoice_id', invoice.id, 'amount_cents', refund.amount_cents, 'currency', refund.currency)
          );
        end if;
      else
        outcome := 'applied';
        update public.invoice_refunds
        set status = next_refund,
            last_event_id = event_key,
            failure_reason = case when next_refund in ('failed', 'canceled') then left(nullif(btrim(coalesce(p_failure_reason, '')), ''), 120) else failure_reason end,
            failed_at = case when next_refund in ('failed', 'canceled') then clock_timestamp() else failed_at end
        where id = refund.id
        returning * into refund;
        if next_refund in ('failed', 'canceled') then
          perform app.record_audit_event(
            invoice.organization_id, 'invoice.refund_failed', 'public.invoice_refunds', refund.id, 'failure',
            jsonb_build_object('invoice_id', invoice.id, 'status', next_refund, 'amount_cents', refund.amount_cents)
          );
        end if;
      end if;
    end if;
  elsif event_type = 'charge.refunded' then
    -- The charge's running total includes pending refunds and names no refund, so it moves
    -- nothing; the refund.* events do. It is kept as a check.
    outcome := 'unchanged';
    detail := case
      when p_amount_refunded_cents is null then 'refund total not given'
      when p_amount_refunded_cents > payment.amount_received_cents then 'refund total exceeds the amount received'
      when p_amount_refunded_cents = payment.refunded_cents then 'refund total matches'
      else 'refund total awaits refund events'
    end;
  elsif event_type in ('charge.dispute.created', 'charge.dispute.updated', 'charge.dispute.closed') then
    next_dispute := case
      when p_status in ('warning_needs_response', 'warning_under_review', 'warning_closed', 'needs_response', 'under_review', 'won', 'lost', 'prevented')
        then p_status::public.invoice_dispute_status
      else null
    end;
    select * into dispute from public.invoice_disputes where dispute_id = object_key for update;
    if next_dispute is null then
      outcome := 'unchanged';
      detail := 'dispute status not applied';
    elsif coalesce(p_amount_cents, 0) <= 0 or p_amount_cents > payment.amount_received_cents then
      outcome := 'rejected';
      detail := 'dispute amount is invalid';
    elsif dispute.id is null then
      if object_key !~ '^(du|dp)_[A-Za-z0-9]{6,250}$' then
        outcome := 'rejected';
        detail := 'dispute is invalid';
      else
        perform pg_advisory_xact_lock(hashtextextended('casevoya.dispute_number:' || payment.organization_id::text, 0));
        select coalesce(max(substring(d.number from 4)::integer), 0) + 1 into next_number
        from public.invoice_disputes d
        where d.organization_id = payment.organization_id;
        insert into public.invoice_disputes (
          organization_id, invoice_id, payment_id, number, dispute_id, charge_id, connected_account_id,
          amount_cents, currency, reason, status, evidence_due_by, closed_at, livemode, last_event_id, last_event_created
        ) values (
          payment.organization_id, payment.invoice_id, payment.id, 'DP-' || lpad(next_number::text, 4, '0'), object_key,
          case when btrim(coalesce(p_charge_id, '')) ~ '^(ch|py)_[A-Za-z0-9]{6,250}$' then btrim(p_charge_id) end,
          payment.connected_account_id, p_amount_cents, payment.currency,
          case when coalesce(p_reason, '') ~ '^[a-z_]{1,60}$' then p_reason end,
          next_dispute, p_evidence_due_by,
          case when app.dispute_status_rank(next_dispute) = 3 then clock_timestamp() end,
          false, event_key, p_event_created
        )
        returning * into dispute;
        outcome := 'applied';
        perform app.record_audit_event(
          invoice.organization_id, 'invoice.dispute_opened', 'public.invoice_disputes', dispute.id, 'success',
          jsonb_build_object('invoice_id', invoice.id, 'status', next_dispute, 'amount_cents', p_amount_cents)
        );
      end if;
    elsif dispute.payment_id <> payment.id then
      outcome := 'rejected';
      detail := 'dispute belongs to another payment';
    elsif app.dispute_status_rank(dispute.status) = 3 then
      outcome := 'unchanged';
      detail := 'dispute already closed';
    elsif app.dispute_status_rank(next_dispute) < app.dispute_status_rank(dispute.status)
       or (p_event_created is not null and dispute.last_event_created is not null and p_event_created < dispute.last_event_created) then
      outcome := 'unchanged';
      detail := 'older dispute event';
    else
      outcome := 'applied';
      update public.invoice_disputes
      set status = next_dispute,
          amount_cents = p_amount_cents,
          reason = case when coalesce(p_reason, '') ~ '^[a-z_]{1,60}$' then p_reason else reason end,
          evidence_due_by = coalesce(p_evidence_due_by, evidence_due_by),
          closed_at = case when app.dispute_status_rank(next_dispute) = 3 then clock_timestamp() else closed_at end,
          last_event_id = event_key,
          last_event_created = coalesce(p_event_created, last_event_created)
      where id = dispute.id
      returning * into dispute;
      if app.dispute_status_rank(next_dispute) = 3 then
        perform app.record_audit_event(
          invoice.organization_id, 'invoice.dispute_closed', 'public.invoice_disputes', dispute.id, 'success',
          jsonb_build_object('invoice_id', invoice.id, 'status', next_dispute)
        );
      end if;
    end if;
  else
    outcome := 'unchanged';
    detail := 'event type not applied';
  end if;

  insert into public.invoice_reversal_events (
    organization_id, invoice_id, payment_id, refund_id, dispute_id, webhook_inbox_id, connected_account_id,
    event_id, event_type, object_id, amount_cents, currency, outcome, detail, refund_status, dispute_status, invoice_status
  ) values (
    payment.organization_id, payment.invoice_id, payment.id, refund.id, dispute.id, inbox_id, account_key,
    event_key, event_type, nullif(left(object_key, 255), ''), p_amount_cents, nullif(currency, ''), outcome, detail,
    refund.status, dispute.status, invoice.status
  )
  on conflict (provider, connected_account_id, event_id) do nothing;

  update public.webhook_inbox
  set status = case when outcome = 'rejected' then 'failed'::public.webhook_inbox_status else 'processed'::public.webhook_inbox_status end,
      processed_at = clock_timestamp()
  where id = inbox_id;

  return jsonb_build_object(
    'outcome', outcome,
    'detail', detail,
    'refund_status', refund.status,
    'dispute_status', dispute.status,
    'invoice_status', invoice.status
  );
end;
$$;
revoke all on function app.apply_stripe_reversal_event(text, text, text, text, text, text, bigint, text, text, text, text, timestamptz, bigint, bigint, boolean, jsonb) from public, anon, authenticated;
grant execute on function app.apply_stripe_reversal_event(text, text, text, text, text, text, bigint, text, text, text, text, timestamptz, bigint, bigint, boolean, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Public wrappers. The database checks the caller; these stay security invoker.
-- ---------------------------------------------------------------------------

create function public.invoice_refund_context(p_payment_id uuid)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select app.invoice_refund_context(p_payment_id); $$;

create function public.record_invoice_refund(
  p_payment_id uuid, p_refund_id text, p_amount_cents bigint, p_currency text, p_reason text, p_livemode boolean, p_idempotency_key text
) returns uuid language sql security invoker set search_path = ''
as $$ select app.record_invoice_refund(p_payment_id, p_refund_id, p_amount_cents, p_currency, p_reason, p_livemode, p_idempotency_key); $$;

create function public.apply_stripe_reversal_event(
  p_event_id text, p_account_id text, p_event_type text, p_object_id text, p_payment_intent_id text, p_charge_id text,
  p_amount_cents bigint, p_currency text, p_status text, p_reason text, p_failure_reason text, p_evidence_due_by timestamptz,
  p_amount_refunded_cents bigint, p_event_created bigint, p_livemode boolean, p_payload jsonb
) returns jsonb language sql security invoker set search_path = ''
as $$
  select app.apply_stripe_reversal_event(
    p_event_id, p_account_id, p_event_type, p_object_id, p_payment_intent_id, p_charge_id,
    p_amount_cents, p_currency, p_status, p_reason, p_failure_reason, p_evidence_due_by,
    p_amount_refunded_cents, p_event_created, p_livemode, p_payload
  );
$$;

revoke all on function public.invoice_refund_context(uuid) from public, anon;
revoke all on function public.record_invoice_refund(uuid, text, bigint, text, text, boolean, text) from public, anon;
revoke all on function public.apply_stripe_reversal_event(text, text, text, text, text, text, bigint, text, text, text, text, timestamptz, bigint, bigint, boolean, jsonb) from public, anon, authenticated;

grant execute on function public.invoice_refund_context(uuid) to authenticated;
grant execute on function public.record_invoice_refund(uuid, text, bigint, text, text, boolean, text) to authenticated;
grant execute on function public.apply_stripe_reversal_event(text, text, text, text, text, text, bigint, text, text, text, text, timestamptz, bigint, bigint, boolean, jsonb) to service_role;

grant execute on function app.payment_refundable_cents(uuid) to authenticated, service_role;
grant execute on function app.require_refund_access(uuid) to authenticated;
grant execute on function app.dispute_status_rank(public.invoice_dispute_status) to authenticated, service_role;
grant execute on function app.invoice_refund_context(uuid) to authenticated;
grant execute on function app.record_invoice_refund(uuid, text, bigint, text, text, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Table privileges and row-level security (mirrors invoice_payments)
-- ---------------------------------------------------------------------------

revoke all on table public.invoice_refunds from anon, authenticated, service_role;
revoke all on table public.invoice_disputes from anon, authenticated, service_role;
revoke all on table public.invoice_reversal_events from anon, authenticated, service_role;
grant select on table public.invoice_refunds to authenticated, service_role;
grant select on table public.invoice_disputes to authenticated, service_role;
grant select on table public.invoice_reversal_events to authenticated, service_role;

alter table public.invoice_refunds enable row level security;
alter table public.invoice_refunds force row level security;
alter table public.invoice_disputes enable row level security;
alter table public.invoice_disputes force row level security;
alter table public.invoice_reversal_events enable row level security;
alter table public.invoice_reversal_events force row level security;

create policy invoice_refunds_select on public.invoice_refunds
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.can_read_invoice(invoice_id))
  );

create policy invoice_disputes_select on public.invoice_disputes
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.can_read_invoice(invoice_id))
  );

create policy invoice_reversal_events_select on public.invoice_reversal_events
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and exists (
      select 1 from public.invoices invoice
      where invoice.id = invoice_reversal_events.invoice_id
        and (select app.can_read_matter_billing(invoice.matter_id))
    )
  );
