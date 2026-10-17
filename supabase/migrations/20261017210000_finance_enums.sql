-- Finance enum additions (T030–T033).
-- New enum values live in this file only. The next migration creates the tables
-- that use them. subscription_status already exists; PRD §17 states that were
-- missing are added and the existing trial / trial_ended values stay.

alter type public.subscription_status add value if not exists 'past_due';
alter type public.subscription_status add value if not exists 'restricted';
alter type public.subscription_status add value if not exists 'archive';

create type public.billing_document_kind as enum (
  'quote',
  'advance_request',
  'professional_services'
);

create type public.invoice_status as enum (
  'draft',
  'issued',
  'partially_paid',
  'paid',
  'overdue',
  'voided',
  'credited'
);

create type public.fee_category as enum (
  'professional_fee',
  'advance',
  'expense',
  'disbursement'
);

create type public.payment_state as enum (
  'pending',
  'processing',
  'succeeded',
  'failed',
  'reversed',
  'disputed'
);

create type public.payment_method_kind as enum (
  'card',
  'bank_transfer',
  'manual'
);

create type public.allocation_kind as enum (
  'invoice',
  'client_funds'
);

create type public.ledger_account_kind as enum (
  'client_funds',
  'earned_fees',
  'processor_clearing'
);

create type public.journal_side as enum (
  'debit',
  'credit'
);

create type public.refund_status as enum (
  'requested',
  'approved',
  'pending',
  'succeeded',
  'failed'
);

create type public.dispute_status as enum (
  'opened',
  'won',
  'lost'
);

create type public.installment_status as enum (
  'scheduled',
  'due',
  'paid',
  'cancelled'
);

create type public.credit_note_status as enum (
  'issued',
  'applied',
  'voided'
);

create type public.connect_account_status as enum (
  'not_started',
  'pending',
  'enabled',
  'restricted'
);

create type public.reconciliation_status as enum (
  'open',
  'exceptions',
  'approved'
);

create type public.transfer_status as enum (
  'proposed',
  'approved',
  'posted',
  'rejected'
);
