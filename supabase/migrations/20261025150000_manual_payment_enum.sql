-- Manual invoice payments (FIN-09). Type only, in its own migration so the table and functions that
-- use it can be created in the next one. Additive only.
--
-- pending_verification  recorded by billing staff from the firm's bank; not counted as paid
-- verified              a reviewer checked it against the bank; counted in invoices.paid_cents
-- rejected              recorded by mistake / not found on the statement; never counted
-- reversed              was verified, then the bank reversed it (recalled e-transfer, wire recall)
-- failed                didn't clear (a cheque returned NSF), before or after verification
create type public.manual_payment_status as enum (
  'pending_verification',
  'verified',
  'rejected',
  'reversed',
  'failed'
);
