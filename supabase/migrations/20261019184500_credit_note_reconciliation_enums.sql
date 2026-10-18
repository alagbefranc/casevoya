-- Credit notes (FIN-06, FIN-07) and client-account reconciliations (FIN-12). Types only, in their
-- own migration so the tables and functions that use them can be created in the next ones.
-- Additive only.

-- A credit note is drafted by billing staff (draft), then reviewed by a second person (maker-checker)
-- who issues it (issued) or declines it (declined). Issued and declined are final.
create type public.credit_note_status as enum (
  'draft',
  'issued',
  'declined'
);

-- A reconciliation is prepared (pending_review), then signed by a second person as reconciled
-- (the difference is zero) or with exceptions (notes required), or discarded before sign-off.
-- Reconciled, exceptions and discarded are final.
create type public.client_reconciliation_status as enum (
  'pending_review',
  'reconciled',
  'exceptions',
  'discarded'
);
