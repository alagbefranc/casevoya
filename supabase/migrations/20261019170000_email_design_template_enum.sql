-- Approved email designs (docs/EMAIL-TEMPLATES.md). Enum values only, in their own migration:
-- Postgres cannot use a value added by ALTER TYPE ... ADD VALUE in the transaction that adds it,
-- and the next migration's mail functions queue deliveries with these templates.
--
--   invoice          EM10  invoice issued to the matter's applicants
--   payment_failed   EX08  a card payment on an invoice failed
--   refund_started   EX09  the firm started a card refund
--   refund_complete  EX10  Stripe confirmed the refund
--
-- The payment receipt (EM11) has a renderer but no value here: the receipts work adds its own
-- outbox event and template value. Additive only.

alter type public.email_template add value if not exists 'invoice';
alter type public.email_template add value if not exists 'payment_failed';
alter type public.email_template add value if not exists 'refund_started';
alter type public.email_template add value if not exists 'refund_complete';
