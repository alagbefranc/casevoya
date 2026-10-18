-- Client funds ledger (FIN-03, FIN-09, FIN-10, FIN-11). Types only, in their own migration so
-- the tables and functions that use them can be created in the next one.
-- Additive only.

-- deposit     money received into the firm's client account for a client (advance / retainer)
-- transfer    earned-fee transfer to the firm's operating account, paying an issued invoice
-- refund      money returned to the client from the client account
-- correction  a reversing entry for a verified deposit or a refund (entries are never edited)
create type public.client_fund_entry_kind as enum (
  'deposit',
  'transfer',
  'refund',
  'correction'
);

-- Deposits: pending_verification -> verified | rejected.
-- Transfers: pending_approval -> approved | declined.
-- Refunds and corrections are recorded once.
create type public.client_fund_entry_status as enum (
  'pending_verification',
  'verified',
  'rejected',
  'pending_approval',
  'approved',
  'declined',
  'recorded'
);

create type public.client_fund_method as enum (
  'bank_transfer',
  'interac_e_transfer',
  'cheque',
  'cash'
);
