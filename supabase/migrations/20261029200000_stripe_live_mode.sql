-- Stripe live mode (DECISIONS: Stripe live). Until now every Stripe table and function took
-- test mode only: a `livemode is false` check on six tables and functions that refused
-- p_livemode true. The app now runs Stripe in the mode its keys say (live when STRIPE_SECRET_KEY
-- is set); each row keeps the mode it was made in, and an event or call of the other mode is
-- ignored or refused against the row's own mode instead of against "test".
-- Firm links made in test mode stay as they are (livemode false); the app shows them as
-- "reconnect" while the server runs live, and the owner disconnects and sets up live.

alter table public.firm_payment_accounts drop constraint if exists firm_payment_accounts_livemode_check;
alter table public.firm_payment_account_history drop constraint if exists firm_payment_account_history_livemode_check;
alter table public.invoice_payments drop constraint if exists invoice_payments_livemode_check;
alter table public.invoice_refunds drop constraint if exists invoice_refunds_livemode_check;
alter table public.invoice_disputes drop constraint if exists invoice_disputes_livemode_check;
alter table public.invoice_dispute_evidence drop constraint if exists invoice_dispute_evidence_livemode_check;

-- The firm's link records the mode of the account it names.
CREATE OR REPLACE FUNCTION app.record_firm_payment_account(p_org uuid, p_account_id text, p_livemode boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  existing public.firm_payment_accounts%rowtype;
  rid uuid;
  account text := btrim(coalesce(p_account_id, ''));
begin
  perform app.require_firm_owner_step_up(p_org);
  if p_livemode is null then
    raise exception 'stripe mode is required' using errcode = '22023';
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
  values (p_org, account, p_livemode)
  returning id into rid;
  perform app.record_audit_event(
    p_org, 'finance.payment_account_connected', 'public.firm_payment_accounts', rid, 'success',
    jsonb_build_object('provider', 'stripe', 'livemode', p_livemode)
  );
  return rid;
end;
$function$;

-- A payment is started only on the firm's link of the same mode, and keeps that mode.
CREATE OR REPLACE FUNCTION app.record_invoice_payment_intent(p_invoice_id uuid, p_payment_intent_id text, p_account_id text, p_amount_cents bigint, p_currency text, p_application_fee_cents bigint, p_livemode boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  invoice public.invoices%rowtype;
  account public.firm_payment_accounts%rowtype;
  existing public.invoice_payments%rowtype;
  intent text := btrim(coalesce(p_payment_intent_id, ''));
  rid uuid;
begin
  select * into invoice from public.invoices where id = p_invoice_id for update;
  if invoice.id is null or app.is_matter_party(invoice.matter_id) is distinct from true then
    raise exception 'invoice not found' using errcode = '42501';
  end if;
  if p_livemode is null then
    raise exception 'stripe mode is required' using errcode = '22023';
  end if;
  select * into existing from public.invoice_payments where payment_intent_id = intent;
  if existing.id is not null then
    if existing.invoice_id <> invoice.id then
      raise exception 'payment intent belongs to another invoice' using errcode = '42501';
    end if;
    return existing.id;
  end if;
  if invoice.status not in ('issued', 'partially_paid') then
    raise exception 'this invoice is not open for payment' using errcode = '22023';
  end if;
  select * into account from public.firm_payment_accounts where organization_id = invoice.organization_id;
  if account.id is null or account.account_id <> btrim(coalesce(p_account_id, '')) then
    raise exception 'payment account does not match the firm' using errcode = '42501';
  end if;
  if account.livemode is distinct from p_livemode then
    raise exception 'the firm''s Stripe account is in the other Stripe mode' using errcode = '22023';
  end if;
  if p_amount_cents is distinct from (invoice.amount_cents - invoice.paid_cents - invoice.credited_cents) then
    raise exception 'payment amount does not match the balance due' using errcode = '22023';
  end if;
  if upper(btrim(coalesce(p_currency, ''))) <> invoice.currency then
    raise exception 'payment currency does not match the invoice' using errcode = '22023';
  end if;
  if coalesce(p_application_fee_cents, 0) < 0 or coalesce(p_application_fee_cents, 0) > p_amount_cents then
    raise exception 'application fee is invalid' using errcode = '22023';
  end if;
  insert into public.invoice_payments (
    organization_id, invoice_id, payment_intent_id, connected_account_id,
    amount_cents, currency, application_fee_cents, livemode
  ) values (
    invoice.organization_id, invoice.id, intent, account.account_id,
    p_amount_cents, invoice.currency, coalesce(p_application_fee_cents, 0), p_livemode
  )
  returning id into rid;
  perform app.record_audit_event(
    invoice.organization_id, 'invoice.payment_started', 'public.invoice_payments', rid, 'success',
    jsonb_build_object('invoice_id', invoice.id, 'amount_cents', p_amount_cents, 'currency', invoice.currency)
  );
  return rid;
end;
$function$;

-- A payment event applies only to a payment of the same mode.
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
begin
  if length(event_key) = 0 then
    raise exception 'event id is required' using errcode = '22023';
  end if;

  select * into payment from public.invoice_payments where payment_intent_id = btrim(coalesce(p_payment_intent_id, ''));
  -- The PaymentIntent was created but its row was not recorded (the browser went away): the
  -- invoice id in the PaymentIntent metadata recovers it when the firm's account matches.
  if payment.id is null and p_invoice_id is not null and p_livemode is not null
     and p_event_type in ('payment_intent.processing', 'payment_intent.succeeded', 'payment_intent.payment_failed', 'payment_intent.canceled')
     and btrim(coalesce(p_payment_intent_id, '')) ~ '^pi_[A-Za-z0-9]{6,250}$'
     and coalesce(p_amount_cents, 0) > 0 then
    select * into invoice from public.invoices where id = p_invoice_id;
    select fpa.account_id into firm_account from public.firm_payment_accounts fpa where fpa.organization_id = invoice.organization_id and fpa.livemode = p_livemode;
    if invoice.id is not null and firm_account = account_key and currency = invoice.currency then
      insert into public.invoice_payments (
        organization_id, invoice_id, payment_intent_id, connected_account_id, amount_cents, currency, livemode
      ) values (
        invoice.organization_id, invoice.id, btrim(p_payment_intent_id), account_key, p_amount_cents, currency, p_livemode
      )
      on conflict (payment_intent_id) do nothing;
      select * into payment from public.invoice_payments where payment_intent_id = btrim(p_payment_intent_id);
    end if;
  end if;

  inbox_id := app.ingest_webhook_event(
    'stripe', event_key, account_key, left(coalesce(p_event_type, ''), 120),
    coalesce(p_payload, '{}'::jsonb), true, payment.organization_id
  );
  select w.status into inbox_status from public.webhook_inbox w where w.id = inbox_id for update;
  if inbox_status in ('processed', 'ignored') then
    return jsonb_build_object('outcome', 'duplicate');
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
  else
    outcome := 'applied';
    if next_status = 'succeeded' then
      received := coalesce(p_amount_received_cents, 0);
      if received <= 0 or received > payment.amount_cents then
        outcome := 'rejected';
        detail := 'amount received is invalid';
      else
        update public.invoice_payments
        set status = 'succeeded', amount_received_cents = received, succeeded_at = clock_timestamp(), last_event_id = event_key
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
      set status = next_status, last_event_id = event_key
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

-- A refund or dispute event applies only to a payment of the same mode; what it records keeps that mode.
CREATE OR REPLACE FUNCTION app.apply_stripe_reversal_event(p_event_id text, p_account_id text, p_event_type text, p_object_id text, p_payment_intent_id text, p_charge_id text, p_amount_cents bigint, p_currency text, p_status text, p_reason text, p_failure_reason text, p_evidence_due_by timestamp with time zone, p_amount_refunded_cents bigint, p_event_created bigint, p_livemode boolean, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  new_task uuid;
  not_yet boolean;
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

  -- 20261025160000: a refund or dispute event can arrive before the payment it belongs to is
  -- applied: Stripe sends charge.dispute.created in the same second as payment_intent.succeeded,
  -- which waits for the card lookup. While the event is recent (2 hours from Stripe's `created`; 20261028100100),
  -- it is refused as "not yet": the transaction rolls back (the inbox row with it), the webhook
  -- answers 500 and Stripe sends it again once the payment is applied. An older event, or one
  -- without `created`, is handled as before (ignored or rejected).
  not_yet := p_livemode is not null
    and (payment.id is null or payment.livemode = p_livemode)
    and p_event_created is not null
    and to_timestamp(p_event_created) > clock_timestamp() - interval '2 hours'
    and (payment.id is null or payment.status in ('requires_payment', 'processing', 'failed'));
  if not_yet then
    raise exception 'payment not applied yet; retry the event' using errcode = '55000';
  end if;

  if payment.id is null or payment.livemode is distinct from p_livemode then
    update public.webhook_inbox set status = 'ignored', processed_at = clock_timestamp() where id = inbox_id;
    return jsonb_build_object('outcome', 'ignored', 'reason', case when payment.id is null then 'unknown_payment' else 'livemode' end);
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
          'pending', payment.livemode
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
      elsif refund.status = 'succeeded' and next_refund in ('failed', 'canceled') then
        -- New (20261025160000): Stripe can fail a refund after reporting it succeeded (the card was
        -- closed). Undo exactly what succeeding added, so the client is shown as not refunded and
        -- the money can be refunded again; the credit, if any, reopens through its trigger.
        if refund.amount_cents > payment.refunded_cents or refund.amount_cents > invoice.refunded_cents then
          outcome := 'rejected';
          detail := 'refund reversal exceeds the amount refunded';
        else
          outcome := 'applied';
          detail := 'refund ' || next_refund::text || ' after it succeeded';
          update public.invoice_refunds
          set status = next_refund,
              last_event_id = event_key,
              failure_reason = left(nullif(btrim(coalesce(p_failure_reason, '')), ''), 120),
              failed_at = clock_timestamp()
          where id = refund.id
          returning * into refund;
          update public.invoice_payments
          set refunded_cents = refunded_cents - refund.amount_cents
          where id = payment.id
          returning * into payment;
          update public.invoices
          set refunded_cents = refunded_cents - refund.amount_cents,
              status = app.invoice_settled_status(status, amount_cents, paid_cents, credited_cents, refunded_cents - refund.amount_cents)
          where id = invoice.id
          returning * into invoice;
          perform app.record_audit_event(
            invoice.organization_id, 'invoice.refund_reversed', 'public.invoice_refunds', refund.id, 'failure',
            jsonb_build_object('invoice_id', invoice.id, 'status', next_refund, 'amount_cents', refund.amount_cents, 'currency', refund.currency)
          );
          if refund.task_id is null then
            new_task := app.create_finance_task(
              invoice.organization_id, invoice.matter_id,
              'Refund ' || refund.number || ' ' || case when next_refund = 'failed' then 'failed' else 'was canceled' end
                || ' (' || invoice.number || '): ' || coalesce(refund.failure_reason, 'Stripe gave no reason'),
              'high', app.firm_today(invoice.organization_id), 'refund_failed'
            );
            if new_task is not null then
              update public.invoice_refunds set task_id = new_task where id = refund.id returning * into refund;
            end if;
          end if;
        end if;
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
          -- New: the firm owner follows it up (FIN-13). Once per refund.
          if refund.task_id is null then
            new_task := app.create_finance_task(
              invoice.organization_id, invoice.matter_id,
              'Refund ' || refund.number || ' ' || case when next_refund = 'failed' then 'failed' else 'was canceled' end
                || ' (' || invoice.number || '): ' || coalesce(refund.failure_reason, 'Stripe gave no reason'),
              'high', app.firm_today(invoice.organization_id), 'refund_failed'
            );
            if new_task is not null then
              update public.invoice_refunds set task_id = new_task where id = refund.id returning * into refund;
            end if;
          end if;
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
          payment.livemode, event_key, p_event_created
        )
        returning * into dispute;
        outcome := 'applied';
        perform app.record_audit_event(
          invoice.organization_id, 'invoice.dispute_opened', 'public.invoice_disputes', dispute.id, 'success',
          jsonb_build_object('invoice_id', invoice.id, 'status', next_dispute, 'amount_cents', p_amount_cents)
        );
        -- New: the firm owner responds before Stripe's deadline (FIN-13), on the invoice's matter.
        if app.dispute_status_rank(next_dispute) < 3 then
          new_task := app.create_finance_task(
            invoice.organization_id, invoice.matter_id,
            'Respond to card dispute ' || dispute.number || ' on ' || invoice.number,
            'critical',
            case when p_evidence_due_by is not null then app.firm_local_date(invoice.organization_id, p_evidence_due_by) else app.firm_today(invoice.organization_id) end,
            'card_dispute'
          );
          if new_task is not null then
            update public.invoice_disputes set task_id = new_task where id = dispute.id returning * into dispute;
          end if;
        end if;
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
$function$;

-- A refund is recorded only in its payment's mode.
CREATE OR REPLACE FUNCTION app.record_invoice_refund(p_payment_id uuid, p_refund_id text, p_amount_cents bigint, p_currency text, p_reason text, p_livemode boolean, p_idempotency_key text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if p_livemode is null or payment.livemode is distinct from p_livemode then
    raise exception 'this payment was made in the other Stripe mode' using errcode = '22023';
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
    payment.connected_account_id, p_amount_cents, payment.currency, refund_reason, 'pending', p_livemode, key, (select auth.uid())
  )
  returning id into rid;
  perform app.record_audit_event(
    payment.organization_id, 'invoice.refund_requested', 'public.invoice_refunds', rid, 'success',
    jsonb_build_object('invoice_id', payment.invoice_id, 'payment_id', payment.id, 'amount_cents', p_amount_cents, 'currency', payment.currency)
  );
  return rid;
end;
$function$;

-- The card on a payment is recorded only from the payment's own mode.
CREATE OR REPLACE FUNCTION app.record_invoice_payment_card(p_account_id text, p_payment_intent_id text, p_card_brand text, p_card_last4 text, p_livemode boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  brand text := lower(btrim(coalesce(p_card_brand, '')));
  last4 text := btrim(coalesce(p_card_last4, ''));
  payment public.invoice_payments%rowtype;
  outcome text := 'unchanged';
  filled boolean := false;
begin
  if brand !~ '^[a-z0-9_]{1,40}$' or last4 !~ '^[0-9]{4}$' then
    raise exception 'card brand or last 4 is invalid' using errcode = '22023';
  end if;
  select * into payment
  from public.invoice_payments
  where payment_intent_id = btrim(coalesce(p_payment_intent_id, ''))
  for update;
  if payment.id is null then
    return jsonb_build_object('outcome', 'unknown_payment');
  end if;
  if payment.livemode is distinct from p_livemode then
    return jsonb_build_object('outcome', 'ignored', 'reason', 'livemode');
  end if;
  if payment.connected_account_id <> btrim(coalesce(p_account_id, '')) then
    return jsonb_build_object('outcome', 'rejected', 'reason', 'connected account does not match');
  end if;

  if (payment.card_brand is null or payment.status <> 'succeeded')
     and (payment.card_brand is distinct from brand or payment.card_last4 is distinct from last4) then
    update public.invoice_payments
    set card_brand = brand, card_last4 = last4
    where id = payment.id
    returning * into payment;
    outcome := 'recorded';
  end if;

  if payment.status = 'succeeded' then
    filled := app.fill_invoice_payment_receipt_card(payment.id);
  end if;

  return jsonb_build_object('outcome', outcome, 'receipt_filled', filled);
end;
$function$;

-- Evidence is recorded only in its dispute's mode.
CREATE OR REPLACE FUNCTION app.record_dispute_evidence(p_dispute_id uuid, p_stripe_file_id text, p_file_name text, p_content_type text, p_size_bytes integer, p_explanation text, p_submitted boolean, p_livemode boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  dispute public.invoice_disputes%rowtype;
  rid uuid;
begin
  select * into dispute from public.invoice_disputes where id = p_dispute_id for update;
  if dispute.id is null then
    raise exception 'billing access denied' using errcode = '42501';
  end if;
  perform app.require_refund_access(dispute.payment_id);
  if p_livemode is null or dispute.livemode is distinct from p_livemode then
    raise exception 'this dispute is in the other Stripe mode' using errcode = '22023';
  end if;
  if app.dispute_status_rank(dispute.status) = 3 then
    raise exception 'this dispute is closed' using errcode = '22023';
  end if;
  insert into public.invoice_dispute_evidence (
    organization_id, dispute_id, stripe_file_id, file_name, content_type, size_bytes, explanation, submitted, livemode
  ) values (
    dispute.organization_id, dispute.id, btrim(coalesce(p_stripe_file_id, '')), left(btrim(coalesce(p_file_name, '')), 200),
    p_content_type, p_size_bytes, nullif(btrim(coalesce(p_explanation, '')), ''), coalesce(p_submitted, false), p_livemode
  )
  returning id into rid;
  if coalesce(p_submitted, false) then
    update public.invoice_disputes
    set evidence_submitted_at = clock_timestamp(), evidence_submitted_by = (select auth.uid())
    where id = dispute.id;
  end if;
  perform app.record_audit_event(
    dispute.organization_id,
    case when coalesce(p_submitted, false) then 'invoice.dispute_evidence_submitted' else 'invoice.dispute_evidence_added' end,
    'public.invoice_disputes', dispute.id, 'success',
    jsonb_build_object('invoice_id', dispute.invoice_id, 'evidence_id', rid, 'content_type', p_content_type, 'size_bytes', p_size_bytes)
  );
  return rid;
end;
$function$;

-- Casevoya's own subscription events in live mode.
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
  before_status public.subscription_status;
  next_status public.subscription_status;
  stripe_status text;
  event_plan public.subscription_plan;
  event_interval public.billing_interval;
  now_at timestamptz := statement_timestamp();
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
  -- The billing webhook applies only events of the server's Stripe mode (src/modules/subscription/stripe.ts);
  -- live events are no longer refused here.
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

  if event_type = 'checkout.session.completed' then
    update public.organization_subscriptions
       set stripe_customer_id = coalesce(stripe_customer_id, customer),
           stripe_subscription_id = coalesce(nullif(s ->> 'id', ''), stripe_subscription_id),
           plan = coalesce(event_plan, plan),
           billing_interval = coalesce(event_interval, billing_interval),
           extra_seats = coalesce((s ->> 'extra_seats')::integer, extra_seats),
           status = case when status in ('active', 'past_due', 'restricted') then status else 'active' end,
           cancelled_at = null, cancel_at = null, archived_at = null
     where organization_id = org;
  elsif event_type in ('customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted') then
    stripe_status := case when event_type = 'customer.subscription.deleted' then 'canceled' else s ->> 'status' end;
    next_status := case stripe_status
      when 'active' then 'active'
      when 'trialing' then 'active'
      when 'past_due' then 'past_due'
      when 'unpaid' then 'past_due'
      when 'canceled' then 'cancelled'
      else null
    end;
    if next_status = 'past_due' and sub.status = 'restricted' then
      next_status := 'restricted';
    end if;
    update public.organization_subscriptions
       set stripe_customer_id = coalesce(stripe_customer_id, customer),
           stripe_subscription_id = coalesce(nullif(s ->> 'id', ''), stripe_subscription_id),
           plan = coalesce(event_plan, plan),
           billing_interval = coalesce(event_interval, billing_interval),
           extra_seats = coalesce((s ->> 'extra_seats')::integer, extra_seats),
           current_period_end = coalesce((s ->> 'current_period_end')::timestamptz, current_period_end),
           cancel_at = case when next_status = 'cancelled' then null else (s ->> 'cancel_at')::timestamptz end,
           status = coalesce(next_status, status),
           cancelled_at = case when next_status = 'cancelled' then coalesce((s ->> 'canceled_at')::timestamptz, now_at) when next_status = 'active' then null else cancelled_at end,
           past_due_since = case when next_status = 'past_due' then coalesce(past_due_since, now_at) when next_status = 'active' then null else past_due_since end,
           restricted_at = case when next_status = 'active' then null else restricted_at end,
           archived_at = case when next_status = 'active' then null else archived_at end
     where organization_id = org;
  elsif event_type in ('invoice.paid', 'invoice.payment_failed') and (inv ->> 'id') ~ '^in_[A-Za-z0-9]{6,250}$' then
    insert into public.subscription_invoices (
      organization_id, stripe_invoice_id, number, status, amount_due_cents, amount_paid_cents, currency,
      period_start, period_end, hosted_invoice_url, pdf_url, stripe_created_at
    ) values (
      org, inv ->> 'id', left(inv ->> 'number', 60), coalesce(nullif(inv ->> 'status', ''), 'open'),
      greatest(0, coalesce((inv ->> 'amount_due')::bigint, 0)), greatest(0, coalesce((inv ->> 'amount_paid')::bigint, 0)),
      lower(coalesce(nullif(inv ->> 'currency', ''), 'cad')),
      (inv ->> 'period_start')::timestamptz, (inv ->> 'period_end')::timestamptz,
      nullif(inv ->> 'hosted_invoice_url', ''), nullif(inv ->> 'pdf_url', ''),
      coalesce((inv ->> 'created')::timestamptz, now_at)
    )
    on conflict (stripe_invoice_id) do update
      set number = coalesce(excluded.number, public.subscription_invoices.number),
          status = excluded.status,
          amount_due_cents = excluded.amount_due_cents,
          amount_paid_cents = excluded.amount_paid_cents,
          period_start = coalesce(excluded.period_start, public.subscription_invoices.period_start),
          period_end = coalesce(excluded.period_end, public.subscription_invoices.period_end),
          hosted_invoice_url = coalesce(excluded.hosted_invoice_url, public.subscription_invoices.hosted_invoice_url),
          pdf_url = coalesce(excluded.pdf_url, public.subscription_invoices.pdf_url);
    if event_type = 'invoice.paid' then
      update public.organization_subscriptions
         set stripe_customer_id = coalesce(stripe_customer_id, customer),
             latest_invoice_status = 'paid',
             latest_invoice_url = coalesce(nullif(inv ->> 'hosted_invoice_url', ''), latest_invoice_url),
             status = case when status in ('past_due', 'restricted') then 'active' else status end,
             past_due_since = case when status in ('past_due', 'restricted') then null else past_due_since end,
             restricted_at = case when status in ('past_due', 'restricted') then null else restricted_at end,
             current_period_end = coalesce((inv ->> 'period_end')::timestamptz, current_period_end)
       where organization_id = org;
    else
      update public.organization_subscriptions
         set stripe_customer_id = coalesce(stripe_customer_id, customer),
             latest_invoice_status = 'payment_failed',
             latest_invoice_url = coalesce(nullif(inv ->> 'hosted_invoice_url', ''), latest_invoice_url),
             status = case when status = 'active' then 'past_due' else status end,
             past_due_since = case when status = 'active' then now_at else past_due_since end
       where organization_id = org;
    end if;
  else
    outcome := 'ignored';
  end if;

  update public.organization_subscriptions set last_webhook_event_id = event_id where organization_id = org;
  select * into sub from public.organization_subscriptions where organization_id = org;
  perform app.record_audit_event(
    org, 'subscription.webhook_applied', 'public.organization_subscriptions', org, 'success',
    jsonb_build_object('event_id', event_id, 'event_type', event_type, 'outcome', outcome, 'status_before', before_status, 'status_after', sub.status)
  );
  update public.webhook_inbox
     set status = case when outcome = 'ignored' then 'ignored'::public.webhook_inbox_status else 'processed'::public.webhook_inbox_status end,
         processed_at = clock_timestamp(),
         organization_id = org
   where id = inbox_id;
  return jsonb_build_object('outcome', outcome, 'status', sub.status);
end;
$function$;

-- A firm whose billing customer was made in test mode gets a new one in live mode, once, before
-- any subscription exists (the app checks at Stripe that the old customer is missing in this mode).
create function public.replace_subscription_customer(p_organization_id uuid, p_previous_customer_id text, p_stripe_customer_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  sub public.organization_subscriptions%rowtype;
  customer text := btrim(coalesce(p_stripe_customer_id, ''));
  previous text := btrim(coalesce(p_previous_customer_id, ''));
begin
  perform app.require_firm_owner_step_up(p_organization_id);
  if customer !~ '^cus_[A-Za-z0-9]{6,250}$' or previous !~ '^cus_[A-Za-z0-9]{6,250}$' then
    raise exception 'stripe customer id is invalid' using errcode = '22023';
  end if;
  select * into sub from public.organization_subscriptions where organization_id = p_organization_id for update;
  if sub.organization_id is null then
    raise exception 'this firm has no subscription record' using errcode = '22023';
  end if;
  if sub.stripe_customer_id = customer then
    return;
  end if;
  if sub.stripe_customer_id is distinct from previous then
    raise exception 'this firm already has a billing account' using errcode = '22023';
  end if;
  if sub.stripe_subscription_id is not null then
    raise exception 'this firm already has a subscription' using errcode = '22023';
  end if;
  update public.organization_subscriptions set stripe_customer_id = customer where organization_id = p_organization_id;
  perform app.record_audit_event(
    p_organization_id, 'subscription.customer_replaced', 'public.organization_subscriptions', p_organization_id, 'success',
    jsonb_build_object('stripe_customer_id', customer, 'previous_customer_id', previous)
  );
end;
$$;
revoke all on function public.replace_subscription_customer(uuid, text, text) from public, anon;
grant execute on function public.replace_subscription_customer(uuid, text, text) to authenticated;
