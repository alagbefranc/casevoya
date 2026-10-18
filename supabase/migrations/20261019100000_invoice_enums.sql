-- Invoice and card-payment states (FIN-07). New types only, in their own migration so
-- the tables that use them can be created in the next one.
-- Overdue is not stored: it is an issued or partially paid invoice past its due date.
-- Additive only.

create type public.invoice_status as enum (
  'draft',
  'issued',
  'partially_paid',
  'paid',
  'voided',
  'credited'
);

create type public.invoice_payment_status as enum (
  'requires_payment',
  'processing',
  'succeeded',
  'failed',
  'canceled'
);
