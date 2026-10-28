-- The Stripe webhook's "payment not applied yet" retry window is 2 hours, not 24 (issue #262 item 3,
-- from #214). TEST MODE ONLY. Additive.
--
-- Francis (2026-10-25, on #214): the race the window covers lasts seconds (charge.dispute.created
-- sent in the same second as payment_intent.succeeded); 2 hours still covers Stripe's early
-- retries, and events for payments Casevoya will never apply stop failing on the endpoint for a day.
--
-- app.apply_stripe_reversal_event is copied from 20261025160000_stripe_webhook_dispute_race_refund_failed.sql
-- (its latest definition) with one change: `interval '24 hours'` becomes `interval '2 hours'` (and
-- the comment that names it). The SQLSTATE 55000 path, the failed-refund task and reversal, the
-- inbox's 'failed' status for a rejected event and everything else are unchanged. It is the only
-- webhook retry window in the database (checked across all migrations). Grants are kept by create
-- or replace.

create or replace function app.apply_stripe_reversal_event(
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
  not_yet := p_livemode is false
    and p_event_created is not null
    and to_timestamp(p_event_created) > clock_timestamp() - interval '2 hours'
    and (payment.id is null or payment.status in ('requires_payment', 'processing', 'failed'));
  if not_yet then
    raise exception 'payment not applied yet; retry the event' using errcode = '55000';
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
          false, event_key, p_event_created
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
$$;
