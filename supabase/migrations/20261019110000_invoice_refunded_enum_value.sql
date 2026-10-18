-- Refunds (FIN-13). Enum values only, in their own migration: Postgres cannot use a value
-- added by ALTER TYPE ... ADD VALUE in the transaction that adds it, and the next migration's
-- checks and functions use it.
--
-- 'refunded': every cent received on the invoice was refunded (the card refunds succeeded).
-- A partly refunded invoice keeps its paid or partially paid status and shows invoices.refunded_cents.
-- Additive only.

alter type public.invoice_status add value if not exists 'refunded';
