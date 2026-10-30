-- Card refund cap counts money already moved off the invoice (FIN-13).
--
-- app.payment_refundable_cents (20261019110100, its only definition) capped a refund at what the
-- payment received less its own pending/requires_action/succeeded refunds. A client credit applied
-- to another invoice (app.apply_client_credit) or refunded by bank (app.record_client_credit_bank_refund)
-- lowers invoices.paid_cents without touching the payment, so the payment cap stayed higher than
-- what the invoice still holds, and app.apply_stripe_reversal_event later refused the refund.
--
-- Now the refundable amount is also capped at the invoice's remainder:
--   invoices.paid_cents - invoices.refunded_cents (succeeded refunds only)
--   - card refunds on the invoice still pending/requires_action (not yet in refunded_cents).
-- Never below zero. For an invoice whose paid_cents was never lowered by a credit move, the
-- invoice remainder is at least the payment remainder, so the result is unchanged.
--
-- app.record_invoice_refund (latest: 20261029200000_stripe_live_mode.sql) is copied unchanged
-- except that it locks the invoice row before the payment row (the order
-- app.apply_stripe_reversal_event uses), so refunds of any payment on the same invoice, and the
-- client-credit card refund path that goes through it, are decided one at a time.
-- Additive only.

create or replace function app.payment_refundable_cents(p_payment_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(
    least(
      payment.amount_received_cents - coalesce((
        select sum(refund.amount_cents)
        from public.invoice_refunds refund
        where refund.payment_id = payment.id
          and refund.status in ('pending', 'requires_action', 'succeeded')
      ), 0),
      invoice.paid_cents - invoice.refunded_cents - coalesce((
        select sum(refund.amount_cents)
        from public.invoice_refunds refund
        where refund.invoice_id = invoice.id
          and refund.status in ('pending', 'requires_action')
      ), 0)
    ),
    0
  )::bigint
  from public.invoice_payments payment
  join public.invoices invoice on invoice.id = payment.invoice_id
  where payment.id = p_payment_id;
$$;
revoke all on function app.payment_refundable_cents(uuid) from public;
grant execute on function app.payment_refundable_cents(uuid) to authenticated, service_role;

create or replace function app.record_invoice_refund(p_payment_id uuid, p_refund_id text, p_amount_cents bigint, p_currency text, p_reason text, p_livemode boolean, p_idempotency_key text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
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
  -- One refund decision at a time per invoice (then payment), so two requests cannot both pass
  -- the limit, and a credit move on the invoice cannot interleave with the check.
  perform 1 from public.invoices where id = payment.invoice_id for update;
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
revoke all on function app.record_invoice_refund(uuid, text, bigint, text, text, boolean, text) from public;
grant execute on function app.record_invoice_refund(uuid, text, bigint, text, text, boolean, text) to authenticated;
