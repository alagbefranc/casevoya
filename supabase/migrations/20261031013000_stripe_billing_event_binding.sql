-- Stripe and billing hardening (security review).
--
-- B-1/B-2/B-3  public.apply_stripe_subscription_event (latest 20261029200000_stripe_live_mode.sql),
--              same signature. Changes are marked "Billing":
--   * each firm's subscription row keeps the Stripe `created` of the last event that changed it
--     (organization_subscriptions.last_stripe_event_created); an older event changes nothing;
--   * subscription events apply only to the stored subscription id. A different id takes over
--     only when the stored one has ended (deleted or incomplete_expired), or when a paid Checkout
--     completion names it. An ended subscription id is final: its later events change nothing;
--   * Checkout completion activates only when payment_status is paid or no_payment_required;
--     checkout.session.async_payment_succeeded activates the same way and
--     checkout.session.async_payment_failed marks the payment failed;
--   * incomplete grants nothing (plan unchanged); incomplete_expired ends a firm that is active
--     on that subscription;
--   * invoice.paid restores a past due or restricted firm only for a paid amount above zero on
--     the stored subscription, with no other open or uncollectible invoice of that subscription
--     recorded. subscription_invoices gains stripe_subscription_id.
-- P-1/P-2      app.apply_stripe_payment_event (latest 20261029200000_stripe_live_mode.sql), same
--              signature. Changes are marked "Payment":
--   * a payment recovered from PaymentIntent metadata needs the invoice open (issued or
--     partially paid) and the amount equal to the balance due; otherwise nothing is recorded
--     against the invoice, the event is kept as failed and the firm owner gets a task;
--   * invoice_payments.last_event_created: an older non-success event changes nothing, and
--     `processing` after `failed` applies only when it is newer.
-- R-1          Releasing or linking a refund reservation is server only (service role), bound to the
--              user who made the reservation: public.service_release_invoice_refund_reservation and
--              public.service_link_invoice_refund_reservation. The signed-in wrappers are revoked.
-- D-1          Dispute evidence is recorded by the server only (public.service_record_dispute_evidence),
--              after Stripe accepted it; the signed-in record_dispute_evidence is revoked.
-- Additive only.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------
alter table public.organization_subscriptions
  add column if not exists last_stripe_event_created bigint;
comment on column public.organization_subscriptions.last_stripe_event_created is
  'Stripe `created` (unix seconds) of the last billing event that changed this row. Older events change nothing.';

alter table public.subscription_invoices
  add column if not exists stripe_subscription_id text
    check (stripe_subscription_id is null or stripe_subscription_id ~ '^sub_[A-Za-z0-9]{6,250}$');
comment on column public.subscription_invoices.stripe_subscription_id is
  'The Stripe subscription the invoice belongs to, when Stripe names one.';
create index if not exists subscription_invoices_org_subscription_idx
  on public.subscription_invoices (organization_id, stripe_subscription_id) where stripe_subscription_id is not null;

alter table public.invoice_payments
  add column if not exists last_event_created bigint;
comment on column public.invoice_payments.last_event_created is
  'Stripe `created` (unix seconds) of the last event applied to this payment.';

-- ---------------------------------------------------------------------------
-- Billing: has this Stripe subscription ended (deleted, or incomplete_expired)?
-- ---------------------------------------------------------------------------
create or replace function app.stripe_subscription_ended(p_org uuid, p_subscription text, p_except_event text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_subscription is not null and exists (
    select 1 from public.subscription_events e
    where e.organization_id = p_org
      and e.stripe_event_id is not null
      and e.stripe_event_id is distinct from p_except_event
      and e.kind like 'customer.subscription.%'
      and e.payload -> 'subscription' ->> 'id' = p_subscription
      and (e.kind = 'customer.subscription.deleted' or e.payload -> 'subscription' ->> 'status' = 'incomplete_expired')
  );
$$;
revoke all on function app.stripe_subscription_ended(uuid, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Billing: public.apply_stripe_subscription_event
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_stripe_subscription_event(p_event jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  event_id text := btrim(coalesce(p_event ->> 'id', ''));
  event_type text := left(coalesce(p_event ->> 'type', ''), 120);
  livemode boolean := coalesce((p_event ->> 'livemode')::boolean, false);
  customer text := nullif(btrim(coalesce(p_event ->> 'customer', '')), '');
  s jsonb := p_event -> 'subscription';
  inv jsonb := p_event -> 'invoice';
  org uuid;
  sub public.organization_subscriptions%rowtype;
  inbox_id uuid;
  inbox_status public.webhook_inbox_status;
  outcome text := 'applied';
  detail text;
  before_status public.subscription_status;
  next_status public.subscription_status;
  stripe_status text;
  event_plan public.subscription_plan;
  event_interval public.billing_interval;
  now_at timestamptz := statement_timestamp();
  -- Billing
  event_created bigint;
  event_sub text;
  inv_sub text;
  paid boolean;
  stale boolean := false;
  stored_ended boolean := false;
  grants boolean := true;
  restore boolean := false;
  own_invoice boolean := false;
begin
  if event_id !~ '^evt_[A-Za-z0-9]{6,250}$' then
    raise exception 'event id is required' using errcode = '22023';
  end if;
  if (p_event ->> 'organization_id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    org := (p_event ->> 'organization_id')::uuid;
    if not exists (select 1 from public.organization_subscriptions where organization_id = org) then
      org := null;
    end if;
  end if;
  if org is null and customer is not null then
    select organization_id into org from public.organization_subscriptions where stripe_customer_id = customer;
  end if;

  inbox_id := app.ingest_webhook_event('stripe_billing', event_id, coalesce(customer, ''), event_type, p_event, true, org);
  select w.status into inbox_status from public.webhook_inbox w where w.id = inbox_id for update;
  if inbox_status in ('processed', 'ignored') then
    return jsonb_build_object('outcome', 'duplicate');
  end if;
  if org is null then
    update public.webhook_inbox set status = 'ignored', processed_at = clock_timestamp() where id = inbox_id;
    return jsonb_build_object('outcome', 'ignored', 'reason', 'unknown_firm');
  end if;

  select * into sub from public.organization_subscriptions where organization_id = org for update;
  before_status := sub.status;
  insert into public.subscription_events (organization_id, kind, stripe_event_id, payload, occurred_at)
  values (org, event_type, event_id, p_event, coalesce(to_timestamp((p_event ->> 'created')::bigint), now_at))
  on conflict (stripe_event_id) do nothing;

  if s ->> 'plan' in ('solo', 'practice', 'firm', 'enterprise') then
    event_plan := (s ->> 'plan')::public.subscription_plan;
  end if;
  if s ->> 'interval' in ('month', 'year') then
    event_interval := (s ->> 'interval')::public.billing_interval;
  end if;

  -- Billing: event time, subscription ids, ordering and the stored subscription's state.
  if coalesce(p_event ->> 'created', '') ~ '^[0-9]{1,12}$' then
    event_created := (p_event ->> 'created')::bigint;
  end if;
  if coalesce(s ->> 'id', '') ~ '^sub_[A-Za-z0-9]{6,250}$' then
    event_sub := s ->> 'id';
  end if;
  if coalesce(inv ->> 'subscription', '') ~ '^sub_[A-Za-z0-9]{6,250}$' then
    inv_sub := inv ->> 'subscription';
  end if;
  stale := event_created is not null and sub.last_stripe_event_created is not null
    and event_created < sub.last_stripe_event_created;
  stored_ended := app.stripe_subscription_ended(org, sub.stripe_subscription_id, event_id);

  if event_type in ('checkout.session.completed', 'checkout.session.async_payment_succeeded') then
    -- A summary without payment_status comes from the app version before this change (deploy
    -- window only); it is treated as before (paid). Current summaries always carry the field.
    paid := case when s ? 'payment_status'
                 then coalesce(s ->> 'payment_status', '') in ('paid', 'no_payment_required')
                 else true end;
    if stale then
      outcome := 'ignored';
      detail := 'stale_event';
    elsif app.stripe_subscription_ended(org, event_sub, event_id) then
      outcome := 'ignored';
      detail := 'subscription_ended';
    elsif not paid then
      -- Billing: no access until Stripe reports the payment. The subscription id is kept when no
      -- other live subscription is stored, so its later events apply.
      if sub.stripe_subscription_id is null or stored_ended or event_sub is not distinct from sub.stripe_subscription_id then
        update public.organization_subscriptions
           set stripe_customer_id = coalesce(stripe_customer_id, customer),
               stripe_subscription_id = coalesce(event_sub, stripe_subscription_id),
               last_stripe_event_created = greatest(last_stripe_event_created, event_created)
         where organization_id = org;
        detail := 'awaiting_payment';
      else
        outcome := 'ignored';
        detail := 'other_subscription';
      end if;
    else
      update public.organization_subscriptions
         set stripe_customer_id = coalesce(stripe_customer_id, customer),
             stripe_subscription_id = coalesce(event_sub, stripe_subscription_id),
             plan = coalesce(event_plan, plan),
             billing_interval = coalesce(event_interval, billing_interval),
             extra_seats = coalesce((s ->> 'extra_seats')::integer, extra_seats),
             status = case when status in ('active', 'past_due', 'restricted') then status else 'active' end,
             cancelled_at = null, cancel_at = null, archived_at = null,
             last_stripe_event_created = greatest(last_stripe_event_created, event_created)
       where organization_id = org;
    end if;
  elsif event_type = 'checkout.session.async_payment_failed' then
    if stale then
      outcome := 'ignored';
      detail := 'stale_event';
    elsif event_sub is distinct from sub.stripe_subscription_id then
      outcome := 'ignored';
      detail := 'other_subscription';
    else
      update public.organization_subscriptions
         set latest_invoice_status = 'payment_failed',
             status = case when status = 'active' then 'past_due' else status end,
             past_due_since = case when status = 'active' then coalesce(past_due_since, now_at) else past_due_since end,
             last_stripe_event_created = greatest(last_stripe_event_created, event_created)
       where organization_id = org;
    end if;
  elsif event_type in ('customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted') then
    if stale then
      outcome := 'ignored';
      detail := 'stale_event';
    elsif app.stripe_subscription_ended(org, event_sub, event_id) then
      outcome := 'ignored';
      detail := 'subscription_ended';
    elsif sub.stripe_subscription_id is not null
          and event_sub is distinct from sub.stripe_subscription_id
          and not (stored_ended and event_sub is not null) then
      outcome := 'ignored';
      detail := 'other_subscription';
    else
      stripe_status := case when event_type = 'customer.subscription.deleted' then 'canceled' else s ->> 'status' end;
      -- Billing: an incomplete subscription grants no plan.
      grants := coalesce(stripe_status, '') not in ('incomplete', 'incomplete_expired');
      next_status := case stripe_status
        when 'active' then 'active'
        when 'trialing' then 'active'
        when 'past_due' then 'past_due'
        when 'unpaid' then 'past_due'
        when 'canceled' then 'cancelled'
        when 'incomplete_expired' then case when sub.status in ('active', 'past_due', 'restricted') then 'cancelled'::public.subscription_status end
        else null
      end;
      if next_status = 'past_due' and sub.status = 'restricted' then
        next_status := 'restricted';
      end if;
      update public.organization_subscriptions
         set stripe_customer_id = coalesce(stripe_customer_id, customer),
             stripe_subscription_id = coalesce(event_sub, stripe_subscription_id),
             plan = case when grants then coalesce(event_plan, plan) else plan end,
             billing_interval = case when grants then coalesce(event_interval, billing_interval) else billing_interval end,
             extra_seats = case when grants then coalesce((s ->> 'extra_seats')::integer, extra_seats) else extra_seats end,
             current_period_end = case when grants then coalesce((s ->> 'current_period_end')::timestamptz, current_period_end) else current_period_end end,
             cancel_at = case when next_status = 'cancelled' then null when grants then (s ->> 'cancel_at')::timestamptz else cancel_at end,
             status = coalesce(next_status, status),
             cancelled_at = case when next_status = 'cancelled' then coalesce((s ->> 'canceled_at')::timestamptz, now_at) when next_status = 'active' then null else cancelled_at end,
             past_due_since = case when next_status = 'past_due' then coalesce(past_due_since, now_at) when next_status = 'active' then null else past_due_since end,
             restricted_at = case when next_status = 'active' then null else restricted_at end,
             archived_at = case when next_status = 'active' then null else archived_at end,
             last_stripe_event_created = greatest(last_stripe_event_created, event_created)
       where organization_id = org;
    end if;
  elsif event_type in ('invoice.paid', 'invoice.payment_failed') and (inv ->> 'id') ~ '^in_[A-Za-z0-9]{6,250}$' then
    insert into public.subscription_invoices (
      organization_id, stripe_invoice_id, number, status, amount_due_cents, amount_paid_cents, currency,
      period_start, period_end, hosted_invoice_url, pdf_url, stripe_created_at, stripe_subscription_id
    ) values (
      org, inv ->> 'id', left(inv ->> 'number', 60), coalesce(nullif(inv ->> 'status', ''), 'open'),
      greatest(0, coalesce((inv ->> 'amount_due')::bigint, 0)), greatest(0, coalesce((inv ->> 'amount_paid')::bigint, 0)),
      lower(coalesce(nullif(inv ->> 'currency', ''), 'cad')),
      (inv ->> 'period_start')::timestamptz, (inv ->> 'period_end')::timestamptz,
      nullif(inv ->> 'hosted_invoice_url', ''), nullif(inv ->> 'pdf_url', ''),
      coalesce((inv ->> 'created')::timestamptz, now_at), inv_sub
    )
    on conflict (stripe_invoice_id) do update
      set number = coalesce(excluded.number, public.subscription_invoices.number),
          status = excluded.status,
          amount_due_cents = excluded.amount_due_cents,
          amount_paid_cents = excluded.amount_paid_cents,
          period_start = coalesce(excluded.period_start, public.subscription_invoices.period_start),
          period_end = coalesce(excluded.period_end, public.subscription_invoices.period_end),
          hosted_invoice_url = coalesce(excluded.hosted_invoice_url, public.subscription_invoices.hosted_invoice_url),
          pdf_url = coalesce(excluded.pdf_url, public.subscription_invoices.pdf_url),
          stripe_subscription_id = coalesce(public.subscription_invoices.stripe_subscription_id, excluded.stripe_subscription_id);
    own_invoice := inv_sub is not null and inv_sub = sub.stripe_subscription_id;
    if stale then
      -- Billing: the invoice is recorded; an older event does not move the firm's state.
      detail := 'stale_event';
    elsif event_type = 'invoice.paid' then
      -- Billing: only a real payment on the stored subscription, with nothing of it left unpaid,
      -- lifts past due or restricted.
      restore := own_invoice
        and sub.status in ('past_due', 'restricted')
        and greatest(0, coalesce((inv ->> 'amount_paid')::bigint, 0)) > 0
        and coalesce((inv ->> 'amount_remaining')::bigint, 0) = 0
        and not exists (
          select 1 from public.subscription_invoices other
          where other.organization_id = org
            and other.stripe_subscription_id = inv_sub
            and other.stripe_invoice_id <> (inv ->> 'id')
            and other.status in ('open', 'uncollectible')
        );
      if sub.status in ('past_due', 'restricted') and not restore then
        detail := 'not_restored';
      end if;
      update public.organization_subscriptions
         set stripe_customer_id = coalesce(stripe_customer_id, customer),
             latest_invoice_status = case when restore or status not in ('past_due', 'restricted') then 'paid' else latest_invoice_status end,
             latest_invoice_url = case when inv_sub is null or own_invoice then coalesce(nullif(inv ->> 'hosted_invoice_url', ''), latest_invoice_url) else latest_invoice_url end,
             status = case when restore then 'active' else status end,
             past_due_since = case when restore then null else past_due_since end,
             restricted_at = case when restore then null else restricted_at end,
             current_period_end = case when own_invoice then coalesce((inv ->> 'period_end')::timestamptz, current_period_end) else current_period_end end,
             last_stripe_event_created = case when restore then greatest(last_stripe_event_created, event_created) else last_stripe_event_created end
       where organization_id = org;
    elsif inv_sub is not null and not own_invoice then
      detail := 'other_subscription';
    else
      update public.organization_subscriptions
         set stripe_customer_id = coalesce(stripe_customer_id, customer),
             latest_invoice_status = 'payment_failed',
             latest_invoice_url = coalesce(nullif(inv ->> 'hosted_invoice_url', ''), latest_invoice_url),
             status = case when status = 'active' then 'past_due' else status end,
             past_due_since = case when status = 'active' then now_at else past_due_since end,
             last_stripe_event_created = case when status = 'active' then greatest(last_stripe_event_created, event_created) else last_stripe_event_created end
       where organization_id = org;
    end if;
  else
    outcome := 'ignored';
  end if;

  update public.organization_subscriptions set last_webhook_event_id = event_id where organization_id = org;
  select * into sub from public.organization_subscriptions where organization_id = org;
  perform app.record_audit_event(
    org, 'subscription.webhook_applied', 'public.organization_subscriptions', org, 'success',
    jsonb_build_object('event_id', event_id, 'event_type', event_type, 'outcome', outcome, 'detail', detail, 'status_before', before_status, 'status_after', sub.status)
  );
  update public.webhook_inbox
     set status = case when outcome = 'ignored' then 'ignored'::public.webhook_inbox_status else 'processed'::public.webhook_inbox_status end,
         processed_at = clock_timestamp(),
         organization_id = org
   where id = inbox_id;
  return jsonb_build_object('outcome', outcome, 'status', sub.status)
    || case when outcome = 'ignored' and detail is not null then jsonb_build_object('reason', detail) else '{}'::jsonb end;
end;
$function$;
revoke all on function public.apply_stripe_subscription_event(jsonb) from public, anon, authenticated;
grant execute on function public.apply_stripe_subscription_event(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Payment: app.apply_stripe_payment_event
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.apply_stripe_payment_event(p_event_id text, p_account_id text, p_event_type text, p_payment_intent_id text, p_amount_cents bigint, p_amount_received_cents bigint, p_currency text, p_livemode boolean, p_invoice_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  event_key text := btrim(coalesce(p_event_id, ''));
  account_key text := btrim(coalesce(p_account_id, ''));
  currency text := upper(btrim(coalesce(p_currency, '')));
  payment public.invoice_payments%rowtype;
  invoice public.invoices%rowtype;
  firm_account text;
  inbox_id uuid;
  inbox_status public.webhook_inbox_status;
  next_status public.invoice_payment_status;
  outcome text := 'unchanged';
  detail text;
  received bigint;
  -- Payment
  event_created bigint;
  recovery_refused boolean := false;
begin
  if length(event_key) = 0 then
    raise exception 'event id is required' using errcode = '22023';
  end if;
  if coalesce(p_payload ->> 'created', '') ~ '^[0-9]{1,12}$' then
    event_created := (p_payload ->> 'created')::bigint;
  end if;

  select * into payment from public.invoice_payments where payment_intent_id = btrim(coalesce(p_payment_intent_id, ''));
  -- The PaymentIntent was created but its row was not recorded (the browser went away): the
  -- invoice id in the PaymentIntent metadata recovers it when the firm's account matches.
  if payment.id is null and p_invoice_id is not null and p_livemode is not null
     and p_event_type in ('payment_intent.processing', 'payment_intent.succeeded', 'payment_intent.payment_failed', 'payment_intent.canceled')
     and btrim(coalesce(p_payment_intent_id, '')) ~ '^pi_[A-Za-z0-9]{6,250}$'
     and coalesce(p_amount_cents, 0) > 0 then
    select * into invoice from public.invoices where id = p_invoice_id for update;
    select fpa.account_id into firm_account from public.firm_payment_accounts fpa where fpa.organization_id = invoice.organization_id and fpa.livemode = p_livemode;
    if invoice.id is not null and firm_account = account_key and currency = invoice.currency then
      -- Payment: the same checks as app.record_invoice_payment_intent (open invoice, balance due).
      if invoice.status in ('issued', 'partially_paid')
         and p_amount_cents = (invoice.amount_cents - invoice.paid_cents - invoice.credited_cents) then
        insert into public.invoice_payments (
          organization_id, invoice_id, payment_intent_id, connected_account_id, amount_cents, currency, livemode
        ) values (
          invoice.organization_id, invoice.id, btrim(p_payment_intent_id), account_key, p_amount_cents, currency, p_livemode
        )
        on conflict (payment_intent_id) do nothing;
        select * into payment from public.invoice_payments where payment_intent_id = btrim(p_payment_intent_id);
      else
        recovery_refused := true;
      end if;
    end if;
  end if;

  inbox_id := app.ingest_webhook_event(
    'stripe', event_key, account_key, left(coalesce(p_event_type, ''), 120),
    coalesce(p_payload, '{}'::jsonb), true, coalesce(payment.organization_id, case when recovery_refused then invoice.organization_id end)
  );
  select w.status into inbox_status from public.webhook_inbox w where w.id = inbox_id for update;
  if inbox_status in ('processed', 'ignored') then
    return jsonb_build_object('outcome', 'duplicate');
  end if;

  -- Payment: refused recovery. Nothing is booked; the firm owner follows it up once.
  if payment.id is null and recovery_refused then
    if inbox_status is distinct from 'failed' then
      perform app.record_audit_event(
        invoice.organization_id, 'invoice.payment_not_matched', 'public.invoices', invoice.id, 'failure',
        jsonb_build_object('event_type', left(coalesce(p_event_type, ''), 120), 'amount_cents', p_amount_cents, 'currency', currency, 'invoice_status', invoice.status)
      );
      if p_event_type = 'payment_intent.succeeded' then
        perform app.create_finance_task(
          invoice.organization_id, invoice.matter_id,
          'Card payment on ' || invoice.number || ' was not matched (invoice not open or amount differs): check it in Stripe',
          'high', app.firm_today(invoice.organization_id), 'payment_unmatched'
        );
      end if;
    end if;
    update public.webhook_inbox set status = 'failed', processed_at = clock_timestamp() where id = inbox_id;
    return jsonb_build_object('outcome', 'rejected', 'reason', 'invoice_not_payable');
  end if;

  if payment.id is null or payment.livemode is distinct from p_livemode then
    update public.webhook_inbox set status = 'ignored', processed_at = clock_timestamp() where id = inbox_id;
    return jsonb_build_object('outcome', 'ignored', 'reason', case when payment.id is null then 'unknown_payment' else 'livemode' end);
  end if;

  select * into invoice from public.invoices where id = payment.invoice_id for update;
  select * into payment from public.invoice_payments where id = payment.id for update;

  next_status := case p_event_type
    when 'payment_intent.succeeded' then 'succeeded'
    when 'payment_intent.processing' then 'processing'
    when 'payment_intent.payment_failed' then 'failed'
    when 'payment_intent.canceled' then 'canceled'
    else null
  end;

  if payment.connected_account_id <> account_key then
    outcome := 'rejected';
    detail := 'connected account does not match';
  elsif currency <> payment.currency then
    outcome := 'rejected';
    detail := 'currency does not match';
  elsif p_amount_cents is distinct from payment.amount_cents then
    outcome := 'rejected';
    detail := 'amount does not match';
  elsif next_status is null then
    outcome := 'unchanged';
    detail := 'event type not applied';
  elsif payment.status = 'succeeded' then
    outcome := 'unchanged';
    detail := 'payment already succeeded';
  elsif payment.status = 'canceled' and next_status <> 'succeeded' then
    outcome := 'unchanged';
    detail := 'payment already canceled';
  elsif next_status = payment.status then
    outcome := 'unchanged';
  elsif next_status <> 'succeeded' and event_created is not null and payment.last_event_created is not null
        and event_created < payment.last_event_created then
    -- Payment: an older event does not undo a newer one.
    outcome := 'unchanged';
    detail := 'older payment event';
  elsif next_status = 'processing' and payment.status = 'failed'
        and (event_created is null or payment.last_event_created is null or event_created <= payment.last_event_created) then
    -- Payment: processing after a failure applies only when it is known to be newer.
    outcome := 'unchanged';
    detail := 'older payment event';
  else
    outcome := 'applied';
    if next_status = 'succeeded' then
      received := coalesce(p_amount_received_cents, 0);
      if received <= 0 or received > payment.amount_cents then
        outcome := 'rejected';
        detail := 'amount received is invalid';
      else
        update public.invoice_payments
        set status = 'succeeded', amount_received_cents = received, succeeded_at = clock_timestamp(), last_event_id = event_key,
            last_event_created = greatest(last_event_created, event_created)
        where id = payment.id
        returning * into payment;
        update public.invoices
        set paid_cents = paid_cents + received,
            status = app.invoice_settled_status(status, amount_cents, paid_cents + received, credited_cents, refunded_cents)
        where id = invoice.id
        returning * into invoice;
        perform app.record_audit_event(
          invoice.organization_id, 'invoice.payment_succeeded', 'public.invoices', invoice.id, 'success',
          jsonb_build_object('payment_id', payment.id, 'amount_cents', received, 'currency', payment.currency)
        );
        if invoice.status = 'voided' then
          perform app.record_audit_event(
            invoice.organization_id, 'invoice.payment_after_void', 'public.invoices', invoice.id, 'success',
            jsonb_build_object('payment_id', payment.id, 'amount_cents', received, 'currency', payment.currency)
          );
        end if;
      end if;
    else
      update public.invoice_payments
      set status = next_status, last_event_id = event_key, last_event_created = greatest(last_event_created, event_created)
      where id = payment.id
      returning * into payment;
    end if;
  end if;

  insert into public.invoice_payment_events (
    organization_id, invoice_id, payment_id, webhook_inbox_id, connected_account_id, event_id, event_type,
    amount_cents, currency, outcome, detail, payment_status, invoice_status
  ) values (
    payment.organization_id, payment.invoice_id, payment.id, inbox_id, account_key, event_key,
    left(coalesce(p_event_type, ''), 120), p_amount_cents, nullif(currency, ''), outcome, detail,
    payment.status, invoice.status
  )
  on conflict (provider, connected_account_id, event_id) do nothing;

  update public.webhook_inbox
  set status = case when outcome = 'rejected' then 'failed'::public.webhook_inbox_status else 'processed'::public.webhook_inbox_status end,
      processed_at = clock_timestamp()
  where id = inbox_id;

  return jsonb_build_object(
    'outcome', outcome,
    'payment_status', payment.status,
    'invoice_status', invoice.status
  );
end;
$function$;
revoke all on function app.apply_stripe_payment_event(text, text, text, text, bigint, bigint, text, boolean, uuid, jsonb) from public, anon, authenticated;
grant execute on function app.apply_stripe_payment_event(text, text, text, text, bigint, bigint, text, boolean, uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Billing access of a given user to a matter (the rule of app.can_read_matter_billing, for a
-- server call that names the signed-in user it acts for).
-- ---------------------------------------------------------------------------
create or replace function app.actor_has_matter_billing(p_actor uuid, p_matter_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_actor is not null and exists (
    select 1
    from public.matters matter
    join public.memberships mem
      on mem.organization_id = matter.organization_id
     and mem.user_id = p_actor
     and mem.status = 'active'
    where matter.id = p_matter_id
      and (
        mem.role = 'firm_owner'
        or (
          mem.role = 'finance_user'
          and exists (
            select 1 from public.matter_participants mp
            where mp.matter_id = matter.id
              and mp.organization_id = matter.organization_id
              and mp.membership_id = mem.id
          )
        )
      )
  );
$$;
revoke all on function app.actor_has_matter_billing(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- R-1: refund reservations are released and linked by the server only
-- ---------------------------------------------------------------------------
-- (signed-in revoke: 20261031090000_post_deploy_revokes.sql, applied after the app deploy)
-- (signed-in revoke: 20261031090000_post_deploy_revokes.sql, applied after the app deploy)
-- (signed-in revoke: 20261031090000_post_deploy_revokes.sql, applied after the app deploy)
-- (signed-in revoke: 20261031090000_post_deploy_revokes.sql, applied after the app deploy)

-- After Stripe refused the refund: frees a pending reservation with no Stripe refund, made by p_actor.
create or replace function public.service_release_invoice_refund_reservation(p_reservation_id uuid, p_actor uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  held public.invoice_refund_reservations%rowtype;
begin
  if app.request_is_server_capture() is distinct from true then
    raise exception 'only the server releases a refund reservation' using errcode = '42501';
  end if;
  select * into held from public.invoice_refund_reservations where id = p_reservation_id;
  if held.id is null or p_actor is null or held.requested_by is distinct from p_actor then
    raise exception 'billing access denied' using errcode = '42501';
  end if;
  -- Same lock order as app.reserve_invoice_refund: invoice, then the reservation.
  perform 1 from public.invoices where id = held.invoice_id for update;
  update public.invoice_refund_reservations
  set status = 'released', updated_at = now()
  where id = held.id and status = 'pending' and refund_id is null and requested_by = p_actor;
  return found;
end;
$function$;
revoke all on function public.service_release_invoice_refund_reservation(uuid, uuid) from public, anon, authenticated;
grant execute on function public.service_release_invoice_refund_reservation(uuid, uuid) to service_role;

-- After Stripe made the refund: ties p_actor's reservation to the Stripe refund id.
-- Body from app.link_invoice_refund_reservation (20261030230000), with the caller bound to the reservation.
create or replace function public.service_link_invoice_refund_reservation(p_reservation_id uuid, p_actor uuid, p_refund_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  held public.invoice_refund_reservations%rowtype;
  recorded public.invoice_refunds%rowtype;
  refund_key text := btrim(coalesce(p_refund_id, ''));
begin
  if app.request_is_server_capture() is distinct from true then
    raise exception 'only the server links a refund reservation' using errcode = '42501';
  end if;
  select * into held from public.invoice_refund_reservations where id = p_reservation_id;
  if held.id is null or p_actor is null or held.requested_by is distinct from p_actor then
    raise exception 'billing access denied' using errcode = '42501';
  end if;
  if refund_key !~ '^(re|pyr)_[A-Za-z0-9]{6,250}$' then
    raise exception 'stripe refund id is invalid' using errcode = '22023';
  end if;
  perform 1 from public.invoices where id = held.invoice_id for update;
  select * into held from public.invoice_refund_reservations where id = p_reservation_id for update;
  if held.refund_id is not null then
    if held.refund_id <> refund_key then
      raise exception 'refund belongs to another payment' using errcode = '42501';
    end if;
    return;
  end if;
  if held.status = 'consumed' then
    return;
  end if;
  select * into recorded from public.invoice_refunds where refund_id = refund_key;
  if recorded.id is not null then
    if recorded.payment_id <> held.payment_id then
      raise exception 'refund belongs to another payment' using errcode = '42501';
    end if;
    update public.invoice_refund_reservations
    set status = 'consumed', refund_id = refund_key, invoice_refund_id = recorded.id, updated_at = now()
    where id = held.id;
    return;
  end if;
  update public.invoice_refund_reservations
  set status = 'linked', refund_id = refund_key, updated_at = now()
  where id = held.id;
end;
$function$;
revoke all on function public.service_link_invoice_refund_reservation(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.service_link_invoice_refund_reservation(uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- D-1: dispute evidence is recorded by the server only
-- ---------------------------------------------------------------------------
-- (signed-in revoke: 20261031090000_post_deploy_revokes.sql, applied after the app deploy)
-- (signed-in revoke: 20261031090000_post_deploy_revokes.sql, applied after the app deploy)

-- The server records a file it sent to Stripe for p_actor (who passed app.dispute_evidence_context),
-- and whether Stripe accepted the submission. Body from app.record_dispute_evidence (20261029200000).
create or replace function public.service_record_dispute_evidence(
  p_actor uuid,
  p_dispute_id uuid,
  p_stripe_file_id text,
  p_file_name text,
  p_content_type text,
  p_size_bytes integer,
  p_explanation text,
  p_submitted boolean,
  p_livemode boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  dispute public.invoice_disputes%rowtype;
  invoice_matter uuid;
  rid uuid;
begin
  if app.request_is_server_capture() is distinct from true then
    raise exception 'only the server records dispute evidence' using errcode = '42501';
  end if;
  select * into dispute from public.invoice_disputes where id = p_dispute_id for update;
  if dispute.id is null then
    raise exception 'billing access denied' using errcode = '42501';
  end if;
  select inv.matter_id into invoice_matter from public.invoices inv where inv.id = dispute.invoice_id;
  if app.actor_has_matter_billing(p_actor, invoice_matter) is distinct from true then
    raise exception 'billing access denied' using errcode = '42501';
  end if;
  if p_livemode is null or dispute.livemode is distinct from p_livemode then
    raise exception 'this dispute is in the other Stripe mode' using errcode = '22023';
  end if;
  if app.dispute_status_rank(dispute.status) = 3 then
    raise exception 'this dispute is closed' using errcode = '22023';
  end if;
  insert into public.invoice_dispute_evidence (
    organization_id, dispute_id, stripe_file_id, file_name, content_type, size_bytes, explanation, submitted, livemode, created_by
  ) values (
    dispute.organization_id, dispute.id, btrim(coalesce(p_stripe_file_id, '')), left(btrim(coalesce(p_file_name, '')), 200),
    p_content_type, p_size_bytes, nullif(btrim(coalesce(p_explanation, '')), ''), coalesce(p_submitted, false), p_livemode, p_actor
  )
  returning id into rid;
  if coalesce(p_submitted, false) then
    update public.invoice_disputes
    set evidence_submitted_at = clock_timestamp(), evidence_submitted_by = p_actor
    where id = dispute.id;
  end if;
  perform app.record_audit_event(
    dispute.organization_id,
    case when coalesce(p_submitted, false) then 'invoice.dispute_evidence_submitted' else 'invoice.dispute_evidence_added' end,
    'public.invoice_disputes', dispute.id, 'success',
    jsonb_build_object('invoice_id', dispute.invoice_id, 'evidence_id', rid, 'content_type', p_content_type, 'size_bytes', p_size_bytes, 'actor_user_id', p_actor)
  );
  return rid;
end;
$function$;
revoke all on function public.service_record_dispute_evidence(uuid, uuid, text, text, text, integer, text, boolean, boolean) from public, anon, authenticated;
grant execute on function public.service_record_dispute_evidence(uuid, uuid, text, text, text, integer, text, boolean, boolean) to service_role;
