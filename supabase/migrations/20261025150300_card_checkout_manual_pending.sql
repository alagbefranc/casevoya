-- FIN-09 x FIN-02: no card checkout while a manual payment on the invoice waits for verification.
--
-- A client who already sent an e-Transfer, cheque, wire or cash payment that the firm recorded could
-- otherwise pay the same balance again by card. The portal already hides the card form; this makes
-- the server refuse too, before Stripe is asked for anything.
--
-- Redefines app.invoice_card_checkout_check, copied from
-- 20261025130000_fin_stripe_connect_disputes_credits.sql. Added only: the
-- 'manual_payment_pending' answer. Additive only.

create or replace function app.invoice_card_checkout_check(p_invoice_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  invoice public.invoices%rowtype;
begin
  select * into invoice from public.invoices where id = p_invoice_id;
  if invoice.id is null or app.is_matter_party(invoice.matter_id) is distinct from true then
    raise exception 'invoice not found' using errcode = '42501';
  end if;
  if not app.is_card_payable_category(invoice.fee_category) then
    return jsonb_build_object('allowed', false, 'reason', 'not_earned_fee');
  end if;
  if exists (
    select 1 from public.invoice_manual_payments payment
    where payment.invoice_id = invoice.id and payment.status = 'pending_verification'
  ) then
    return jsonb_build_object('allowed', false, 'reason', 'manual_payment_pending');
  end if;
  return jsonb_build_object('allowed', true, 'reason', null);
end;
$$;
