-- Client billing, client-account ledger, firm payouts, and platform plan prices (T030–T033).
-- Amounts are integer minor units. Launch currency is CAD; a payment must match the
-- invoice currency. Government fees are a note and are never a line amount.
-- Plan prices are read from product_settings billing.plans. They are not written
-- into function bodies. A processor balance is stored on a reconciliation and is
-- not treated as the client account. Additive only. Does not alter storage.

alter table public.organization_subscriptions
  add column plan_code text,
  add column billing_interval text,
  add column price_snapshot jsonb,
  add column stripe_customer_id text,
  add column stripe_subscription_id text,
  add column current_period_ends_at timestamptz;

alter table public.organization_subscriptions
  add constraint organization_subscriptions_plan_code_ck
    check (plan_code is null or plan_code in ('solo', 'practice', 'firm', 'enterprise')),
  add constraint organization_subscriptions_interval_ck
    check (billing_interval is null or billing_interval in ('month', 'year')),
  add constraint organization_subscriptions_stripe_customer_ck
    check (stripe_customer_id is null or length(stripe_customer_id) between 3 and 80),
  add constraint organization_subscriptions_stripe_subscription_ck
    check (stripe_subscription_id is null or length(stripe_subscription_id) between 3 and 80);

comment on column public.organization_subscriptions.price_snapshot is
  'Copy of the billing.plans computation at the moment the firm chose a plan. Later catalog edits do not rewrite it.';

insert into public.product_settings (key, value, description, pending_confirmation) values (
  'billing.plans',
  jsonb_build_object(
    'currency', 'cad',
    'extra_seat_monthly_cents', 2500,
    'annual_discount_bps', 1500,
    'refund_self_approval_limit_cents', 100000,
    'withdrawal_follow_up_days', 30,
    'plans', jsonb_build_object(
      'solo', jsonb_build_object('monthly_cents', 12900, 'seats', 2, 'active_matters', 100),
      'practice', jsonb_build_object('monthly_cents', 29900, 'seats', 6, 'active_matters', 500),
      'firm', jsonb_build_object('monthly_cents', 59900, 'seats', 15, 'active_matters', 1500),
      'enterprise', jsonb_build_object('quoted', true)
    )
  ),
  'Proposed Casevoya subscription prices from PRD section 3. Not an IRCC fee and not a client professional fee. Pending buyer validation. Enforcement reads this row.',
  true
);

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.tax_rates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  code text not null check (code ~ '^[A-Z0-9][A-Z0-9_-]{0,20}$'),
  label text not null check (length(btrim(label)) between 1 and 80),
  rate_bps integer not null check (rate_bps between 0 and 10000),
  effective_from date not null,
  effective_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id),
  unique (organization_id, code, effective_from),
  check (effective_to is null or effective_to >= effective_from)
);
comment on table public.tax_rates is
  'Firm tax rates in basis points. Effective-dated. Not a government immigration fee.';

create table public.invoice_counters (
  organization_id uuid not null references public.organizations (id),
  year integer not null check (year between 2000 and 2200),
  last_value integer not null check (last_value >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  primary key (organization_id, year)
);
comment on table public.invoice_counters is
  'Per-firm invoice number sequence. Not a government file number.';

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  matter_id uuid not null,
  billing_person_id uuid not null,
  number text not null check (length(number) between 4 and 40),
  kind public.billing_document_kind not null,
  status public.invoice_status not null default 'draft',
  currency text not null check (currency ~ '^[a-z]{3}$'),
  service_note text,
  government_fee_note text,
  subtotal_cents bigint not null default 0 check (subtotal_cents >= 0),
  tax_cents bigint not null default 0 check (tax_cents >= 0),
  total_cents bigint not null default 0 check (total_cents >= 0),
  balance_cents bigint not null default 0 check (balance_cents >= 0),
  due_on date,
  issued_at timestamptz,
  pdf bytea,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id),
  unique (organization_id, number),
  check (balance_cents <= total_cents),
  check (pdf is null or substring(pdf from 1 for 4) = '\x25504446'::bytea),
  check (service_note is null or length(btrim(service_note)) between 8 and 2000),
  check (government_fee_note is null or length(btrim(government_fee_note)) between 1 and 500),
  check (status <> 'issued' or issued_at is not null),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id),
  foreign key (billing_person_id, organization_id) references public.persons (id, organization_id)
);
comment on table public.invoices is
  'Quotes, advance requests, and professional invoices. Issued money columns are immutable. Government fees are government_fee_note only.';
comment on column public.invoices.government_fee_note is
  'Reminder that government fees are paid to the authority. The text is not an amount and is not added to total_cents.';

create table public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  invoice_id uuid not null,
  description text not null check (length(btrim(description)) between 1 and 200),
  quantity integer not null check (quantity between 1 and 10000),
  unit_amount_cents bigint not null check (unit_amount_cents > 0),
  fee_category public.fee_category not null,
  tax_rate_id uuid,
  net_cents bigint not null check (net_cents > 0),
  tax_cents bigint not null check (tax_cents >= 0),
  sort_order integer not null check (sort_order between 0 and 40),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id),
  foreign key (invoice_id, organization_id) references public.invoices (id, organization_id),
  foreign key (tax_rate_id, organization_id) references public.tax_rates (id, organization_id)
);
comment on table public.invoice_lines is
  'Invoice lines. Quantity times unit amount is integer cents. No government-fee category.';

create table public.time_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  matter_id uuid not null,
  membership_id uuid not null,
  minutes integer not null check (minutes between 1 and 100000),
  rate_cents bigint not null check (rate_cents >= 0),
  memo text not null check (length(btrim(memo)) between 1 and 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id),
  foreign key (membership_id, organization_id) references public.memberships (id, organization_id)
);
comment on table public.time_entries is
  'Staff time. A time entry is not an invoice until someone puts it on a draft line.';

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  invoice_id uuid,
  amount_cents bigint not null check (amount_cents > 0),
  currency text not null check (currency ~ '^[a-z]{3}$'),
  state public.payment_state not null default 'pending',
  method public.payment_method_kind not null,
  provider text not null default 'manual' check (provider ~ '^[a-z][a-z0-9_]{1,40}$'),
  provider_payment_intent_id text,
  provider_event_id text,
  connected_account_id text,
  external_reference text,
  destination text,
  evidence text,
  received_on date,
  verified_at timestamptz,
  refunded_cents bigint not null default 0 check (refunded_cents >= 0),
  disputed_cents bigint not null default 0 check (disputed_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id),
  check (refunded_cents + disputed_cents <= amount_cents),
  check (provider_payment_intent_id is null or length(provider_payment_intent_id) between 3 and 80),
  check (external_reference is null or length(btrim(external_reference)) between 1 and 120),
  check (evidence is null or length(btrim(evidence)) between 1 and 500),
  check (destination is null or length(btrim(destination)) between 1 and 200),
  foreign key (invoice_id, organization_id) references public.invoices (id, organization_id)
);
comment on table public.payments is
  'A payment stays pending until a signed webhook or a staff verification posts it. A browser return does not set succeeded.';

create unique index payments_provider_event_uidx
  on public.payments (provider, connected_account_id, provider_event_id) nulls not distinct
  where provider_event_id is not null;
create unique index payments_intent_uidx
  on public.payments (provider, provider_payment_intent_id)
  where provider_payment_intent_id is not null;
create unique index payments_reference_uidx
  on public.payments (organization_id, external_reference)
  where external_reference is not null;

create table public.ledger_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  matter_id uuid,
  person_id uuid,
  kind public.ledger_account_kind not null,
  currency text not null check (currency ~ '^[a-z]{3}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id),
  check (
    (kind = 'processor_clearing' and matter_id is null and person_id is null)
    or (kind in ('client_funds', 'earned_fees') and matter_id is not null and person_id is not null)
  ),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id),
  foreign key (person_id, organization_id) references public.persons (id, organization_id)
);
comment on table public.ledger_accounts is
  'Client-funds is a liability. Earned fees are revenue. Processor clearing is not a client account.';

create unique index ledger_accounts_slot_uidx
  on public.ledger_accounts (organization_id, matter_id, person_id, kind, currency) nulls not distinct;

create table public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  posting_key text not null check (length(posting_key) between 1 and 200),
  source_type text not null check (source_type ~ '^[a-z][a-z0-9_]{0,40}$'),
  source_id uuid not null,
  currency text not null check (currency ~ '^[a-z]{3}$'),
  memo text not null check (length(memo) between 1 and 200),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  unique (id, organization_id),
  unique (organization_id, posting_key)
);
comment on table public.journal_entries is
  'Posted journals are immutable. A repeat of the same posting key is the original entry.';

create table public.journal_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  entry_id uuid not null,
  account_id uuid not null,
  side public.journal_side not null,
  amount_cents bigint not null check (amount_cents > 0),
  currency text not null check (currency ~ '^[a-z]{3}$'),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  foreign key (entry_id, organization_id) references public.journal_entries (id, organization_id),
  foreign key (account_id, organization_id) references public.ledger_accounts (id, organization_id)
);
comment on table public.journal_lines is
  'Posted lines cannot be updated or deleted. Reversals are new entries.';

create table public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  payment_id uuid,
  transfer_id uuid,
  invoice_id uuid,
  kind public.allocation_kind not null,
  amount_cents bigint not null check (amount_cents > 0),
  currency text not null check (currency ~ '^[a-z]{3}$'),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  check (
    (kind = 'invoice' and invoice_id is not null)
    or (kind = 'client_funds' and invoice_id is null)
  ),
  check (payment_id is not null or transfer_id is not null),
  foreign key (payment_id, organization_id) references public.payments (id, organization_id),
  foreign key (invoice_id, organization_id) references public.invoices (id, organization_id)
);
comment on table public.payment_allocations is
  'Links a payment or an earned-fee transfer to an invoice or to client funds. Status is derived from these rows.';

create table public.receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  payment_id uuid,
  transfer_id uuid,
  invoice_id uuid,
  number text not null check (length(number) between 4 and 40),
  amount_cents bigint not null check (amount_cents > 0),
  currency text not null check (currency ~ '^[a-z]{3}$'),
  pdf bytea,
  issued_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  unique (organization_id, number),
  check (payment_id is not null or transfer_id is not null),
  check (pdf is null or substring(pdf from 1 for 4) = '\x25504446'::bytea),
  foreign key (payment_id, organization_id) references public.payments (id, organization_id),
  foreign key (invoice_id, organization_id) references public.invoices (id, organization_id)
);
comment on table public.receipts is
  'In-app receipt. The PDF is generated here. There is no hosted invoice page.';

create table public.credit_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  invoice_id uuid not null,
  amount_cents bigint not null check (amount_cents > 0),
  currency text not null check (currency ~ '^[a-z]{3}$'),
  reason text not null check (length(btrim(reason)) between 1 and 500),
  status public.credit_note_status not null default 'applied',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  foreign key (invoice_id, organization_id) references public.invoices (id, organization_id)
);
comment on table public.credit_notes is
  'A credit note reduces an invoice balance. It is not a refund of a payment.';

create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  payment_id uuid not null,
  amount_cents bigint not null check (amount_cents > 0),
  currency text not null check (currency ~ '^[a-z]{3}$'),
  reason text not null check (length(btrim(reason)) between 1 and 500),
  status public.refund_status not null default 'requested',
  provider text not null default 'manual' check (provider ~ '^[a-z][a-z0-9_]{1,40}$'),
  provider_refund_id text,
  requested_by uuid references auth.users (id),
  approved_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  check (provider_refund_id is null or length(provider_refund_id) between 3 and 80),
  foreign key (payment_id, organization_id) references public.payments (id, organization_id)
);
comment on table public.refunds is
  'Refunds move funds only when settled, and a repeated provider refund id posts once.';

create unique index refunds_provider_uidx
  on public.refunds (provider, provider_refund_id)
  where provider_refund_id is not null;

create table public.payment_disputes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  payment_id uuid not null,
  amount_cents bigint not null check (amount_cents > 0),
  currency text not null check (currency ~ '^[a-z]{3}$'),
  status public.dispute_status not null default 'opened',
  provider text not null default 'stripe' check (provider ~ '^[a-z][a-z0-9_]{1,40}$'),
  provider_dispute_id text,
  task_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  check (provider_dispute_id is null or length(provider_dispute_id) between 3 and 80),
  foreign key (payment_id, organization_id) references public.payments (id, organization_id),
  foreign key (task_id, organization_id) references public.tasks (id, organization_id)
);
comment on table public.payment_disputes is
  'A dispute reopens the balance and creates a task. It does not delete records or change matter stage.';

create unique index payment_disputes_provider_uidx
  on public.payment_disputes (provider, provider_dispute_id)
  where provider_dispute_id is not null;

create table public.installment_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  invoice_id uuid not null,
  status public.installment_status not null default 'scheduled',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id),
  foreign key (invoice_id, organization_id) references public.invoices (id, organization_id)
);

create table public.installments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  plan_id uuid not null,
  invoice_id uuid not null,
  sequence_no integer not null check (sequence_no between 1 and 36),
  amount_cents bigint not null check (amount_cents > 0),
  due_on date not null,
  status public.installment_status not null default 'scheduled',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (plan_id, sequence_no),
  foreign key (plan_id, organization_id) references public.installment_plans (id, organization_id),
  foreign key (invoice_id, organization_id) references public.invoices (id, organization_id)
);

create table public.earned_fee_transfers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  matter_id uuid not null,
  person_id uuid not null,
  invoice_id uuid not null,
  amount_cents bigint not null check (amount_cents > 0),
  currency text not null check (currency ~ '^[a-z]{3}$'),
  reason text not null check (length(btrim(reason)) between 8 and 500),
  status public.transfer_status not null default 'proposed',
  proposed_by uuid references auth.users (id),
  approved_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id),
  foreign key (person_id, organization_id) references public.persons (id, organization_id),
  foreign key (invoice_id, organization_id) references public.invoices (id, organization_id)
);
comment on table public.earned_fee_transfers is
  'Moves available client funds to earned fees. It cannot exceed the client balance or the invoice balance.';

alter table public.payment_allocations
  add constraint payment_allocations_transfer_fk
  foreign key (transfer_id, organization_id) references public.earned_fee_transfers (id, organization_id);

alter table public.receipts
  add constraint receipts_transfer_fk
  foreign key (transfer_id, organization_id) references public.earned_fee_transfers (id, organization_id);

create table public.processor_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations (id),
  provider text not null default 'stripe' check (provider = 'stripe'),
  stripe_account_id text not null check (length(stripe_account_id) between 3 and 80),
  status public.connect_account_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (provider, stripe_account_id)
);
comment on table public.processor_accounts is
  'The firm Stripe Connect account for payouts and direct charges. Enabled is not an approved client-account opinion.';

create table public.reconciliation_periods (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  period_start date not null,
  period_end date not null,
  currency text not null check (currency = 'cad'),
  statement_cents bigint not null,
  control_cents bigint not null,
  subledger_cents bigint not null,
  processor_balance_cents bigint,
  status public.reconciliation_status not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  check (period_end >= period_start),
  unique (id, organization_id),
  unique (organization_id, period_start, period_end, currency)
);
comment on table public.reconciliation_periods is
  'Compares a bank statement with the client-funds control total. processor_balance_cents is recorded and is not the client account.';

create table public.reconciliation_exceptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  period_id uuid not null,
  detail text not null check (length(detail) between 1 and 500),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  foreign key (period_id, organization_id) references public.reconciliation_periods (id, organization_id)
);

-- Covering indexes for every foreign key.
create index tax_rates_org_idx on public.tax_rates (organization_id);
create index tax_rates_created_by_idx on public.tax_rates (created_by);
create index invoice_counters_created_by_idx on public.invoice_counters (created_by);
create index invoices_org_status_due_idx on public.invoices (organization_id, status, due_on);
create index invoices_matter_org_idx on public.invoices (matter_id, organization_id);
create index invoices_person_org_idx on public.invoices (billing_person_id, organization_id);
create index invoices_created_by_idx on public.invoices (created_by);
create index invoice_lines_invoice_org_idx on public.invoice_lines (invoice_id, organization_id);
create index invoice_lines_org_idx on public.invoice_lines (organization_id);
create index invoice_lines_tax_org_idx on public.invoice_lines (tax_rate_id, organization_id);
create index invoice_lines_created_by_idx on public.invoice_lines (created_by);
create index time_entries_org_idx on public.time_entries (organization_id);
create index time_entries_matter_org_idx on public.time_entries (matter_id, organization_id);
create index time_entries_membership_org_idx on public.time_entries (membership_id, organization_id);
create index time_entries_created_by_idx on public.time_entries (created_by);
create index payments_org_idx on public.payments (organization_id);
create index payments_invoice_org_idx on public.payments (invoice_id, organization_id);
create index payments_created_by_idx on public.payments (created_by);
create index ledger_accounts_org_idx on public.ledger_accounts (organization_id);
create index ledger_accounts_matter_org_idx on public.ledger_accounts (matter_id, organization_id);
create index ledger_accounts_person_org_idx on public.ledger_accounts (person_id, organization_id);
create index ledger_accounts_created_by_idx on public.ledger_accounts (created_by);
create index journal_entries_org_idx on public.journal_entries (organization_id);
create index journal_entries_created_by_idx on public.journal_entries (created_by);
create index journal_lines_org_idx on public.journal_lines (organization_id);
create index journal_lines_entry_org_idx on public.journal_lines (entry_id, organization_id);
create index journal_lines_account_org_idx on public.journal_lines (account_id, organization_id);
create index journal_lines_created_by_idx on public.journal_lines (created_by);
create index payment_allocations_org_idx on public.payment_allocations (organization_id);
create index payment_allocations_payment_org_idx on public.payment_allocations (payment_id, organization_id);
create index payment_allocations_transfer_org_idx on public.payment_allocations (transfer_id, organization_id);
create index payment_allocations_invoice_org_idx on public.payment_allocations (invoice_id, organization_id);
create index payment_allocations_created_by_idx on public.payment_allocations (created_by);
create index receipts_org_idx on public.receipts (organization_id);
create index receipts_payment_org_idx on public.receipts (payment_id, organization_id);
create index receipts_transfer_org_idx on public.receipts (transfer_id, organization_id);
create index receipts_invoice_org_idx on public.receipts (invoice_id, organization_id);
create index receipts_created_by_idx on public.receipts (created_by);
create index credit_notes_org_idx on public.credit_notes (organization_id);
create index credit_notes_invoice_org_idx on public.credit_notes (invoice_id, organization_id);
create index credit_notes_created_by_idx on public.credit_notes (created_by);
create index refunds_org_idx on public.refunds (organization_id);
create index refunds_payment_org_idx on public.refunds (payment_id, organization_id);
create index refunds_requested_by_idx on public.refunds (requested_by);
create index refunds_approved_by_idx on public.refunds (approved_by);
create index refunds_created_by_idx on public.refunds (created_by);
create index payment_disputes_org_idx on public.payment_disputes (organization_id);
create index payment_disputes_payment_org_idx on public.payment_disputes (payment_id, organization_id);
create index payment_disputes_task_org_idx on public.payment_disputes (task_id, organization_id);
create index payment_disputes_created_by_idx on public.payment_disputes (created_by);
create index installment_plans_org_idx on public.installment_plans (organization_id);
create index installment_plans_invoice_org_idx on public.installment_plans (invoice_id, organization_id);
create index installment_plans_created_by_idx on public.installment_plans (created_by);
create index installments_org_idx on public.installments (organization_id);
create index installments_plan_org_idx on public.installments (plan_id, organization_id);
create index installments_invoice_org_idx on public.installments (invoice_id, organization_id);
create index installments_created_by_idx on public.installments (created_by);
create index earned_fee_transfers_org_idx on public.earned_fee_transfers (organization_id);
create index earned_fee_transfers_matter_org_idx on public.earned_fee_transfers (matter_id, organization_id);
create index earned_fee_transfers_person_org_idx on public.earned_fee_transfers (person_id, organization_id);
create index earned_fee_transfers_invoice_org_idx on public.earned_fee_transfers (invoice_id, organization_id);
create index earned_fee_transfers_proposed_by_idx on public.earned_fee_transfers (proposed_by);
create index earned_fee_transfers_approved_by_idx on public.earned_fee_transfers (approved_by);
create index earned_fee_transfers_created_by_idx on public.earned_fee_transfers (created_by);
create index processor_accounts_created_by_idx on public.processor_accounts (created_by);
create index reconciliation_periods_org_idx on public.reconciliation_periods (organization_id);
create index reconciliation_periods_created_by_idx on public.reconciliation_periods (created_by);
create index reconciliation_exceptions_org_idx on public.reconciliation_exceptions (organization_id);
create index reconciliation_exceptions_period_org_idx on public.reconciliation_exceptions (period_id, organization_id);
create index reconciliation_exceptions_created_by_idx on public.reconciliation_exceptions (created_by);

-- ---------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------

create function app.guard_issued_invoice()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'draft' then
    if new.kind is distinct from old.kind
       or new.currency is distinct from old.currency
       or new.subtotal_cents is distinct from old.subtotal_cents
       or new.tax_cents is distinct from old.tax_cents
       or new.total_cents is distinct from old.total_cents
       or new.matter_id is distinct from old.matter_id
       or new.billing_person_id is distinct from old.billing_person_id
       or new.government_fee_note is distinct from old.government_fee_note
       or new.service_note is distinct from old.service_note
       or new.number is distinct from old.number
       or new.organization_id is distinct from old.organization_id
       or new.pdf is distinct from old.pdf
    then
      raise exception 'issued invoice is immutable' using errcode = '55000';
    end if;
  end if;
  if new.balance_cents < 0 or new.balance_cents > new.total_cents then
    raise exception 'invoice balance is out of range' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function app.guard_issued_invoice() from public;

create function app.guard_invoice_line()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  st public.invoice_status;
  inv uuid := coalesce(new.invoice_id, old.invoice_id);
begin
  select status into st from public.invoices where id = inv;
  if st is distinct from 'draft' then
    raise exception 'issued invoice lines are immutable' using errcode = '55000';
  end if;
  return coalesce(new, old);
end;
$$;
revoke all on function app.guard_invoice_line() from public;

create function app.reject_posted_journal_edit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'posted journal lines cannot be edited' using errcode = '55000';
end;
$$;
revoke all on function app.reject_posted_journal_edit() from public;

create function app.reject_receipt_edit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'receipts cannot be edited' using errcode = '55000';
end;
$$;
revoke all on function app.reject_receipt_edit() from public;

-- ---------------------------------------------------------------------------
-- Ledger helpers
-- ---------------------------------------------------------------------------

create function app.billing_setting(p_path text[])
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select value #>> p_path from public.product_settings where key = 'billing.plans';
$$;
revoke all on function app.billing_setting(text[]) from public;

create function app.plan_amount_cents(p_code text, p_interval text)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  catalog jsonb;
  monthly bigint;
  bps integer;
  quoted text;
begin
  select value into catalog from public.product_settings where key = 'billing.plans';
  if catalog is null then
    raise exception 'billing settings are not configured' using errcode = '22023';
  end if;
  quoted := catalog #>> array['plans', p_code, 'quoted'];
  monthly := (catalog #>> array['plans', p_code, 'monthly_cents'])::bigint;
  if monthly is null then
    if quoted = 'true' then
      raise exception 'plan is quoted' using errcode = '22023';
    end if;
    raise exception 'unknown plan' using errcode = '22023';
  end if;
  if p_interval = 'month' then
    return monthly;
  end if;
  if p_interval = 'year' then
    bps := (catalog->>'annual_discount_bps')::integer;
    if bps is null or bps < 0 or bps > 10000 then
      raise exception 'billing settings are not configured' using errcode = '22023';
    end if;
    return (monthly * 12 * (10000 - bps)) / 10000;
  end if;
  raise exception 'unknown billing interval' using errcode = '22023';
end;
$$;
revoke all on function app.plan_amount_cents(text, text) from public;

create function app.billing_staff_count(p_org uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.memberships mem
  where mem.organization_id = p_org
    and mem.status = 'active'
    and mem.role in ('firm_owner', 'finance_user');
$$;
revoke all on function app.billing_staff_count(uuid) from public;

create function app.next_billing_number(p_org uuid, p_prefix text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  tz text;
  yr integer;
  n integer;
begin
  select org.timezone into tz from public.organizations org where org.id = p_org;
  yr := extract(year from timezone(coalesce(tz, 'UTC'), clock_timestamp()))::integer;
  insert into public.invoice_counters as counter (organization_id, year, last_value)
  values (p_org, yr, 1)
  on conflict (organization_id, year)
  do update set last_value = counter.last_value + 1, updated_at = clock_timestamp(), version = counter.version + 1
  returning last_value into n;
  return p_prefix || '-' || yr::text || '-' || lpad(n::text, 4, '0');
end;
$$;
revoke all on function app.next_billing_number(uuid, text) from public;

create function app.ensure_ledger_account(
  p_org uuid,
  p_matter uuid,
  p_person uuid,
  p_kind public.ledger_account_kind,
  p_currency text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  aid uuid;
begin
  select id into aid
  from public.ledger_accounts
  where organization_id = p_org
    and matter_id is not distinct from p_matter
    and person_id is not distinct from p_person
    and kind = p_kind
    and currency = p_currency;
  if aid is not null then
    return aid;
  end if;
  insert into public.ledger_accounts (organization_id, matter_id, person_id, kind, currency)
  values (p_org, p_matter, p_person, p_kind, p_currency)
  returning id into aid;
  return aid;
end;
$$;
revoke all on function app.ensure_ledger_account(uuid, uuid, uuid, public.ledger_account_kind, text) from public;

create function app.account_balance(p_account uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(case when side = 'credit' then amount_cents else -amount_cents end), 0)::bigint
  from public.journal_lines
  where account_id = p_account;
$$;
revoke all on function app.account_balance(uuid) from public;

create function app.post_journal(
  p_org uuid,
  p_posting_key text,
  p_source_type text,
  p_source_id uuid,
  p_currency text,
  p_lines jsonb,
  p_memo text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  eid uuid;
  debit_sum bigint := 0;
  credit_sum bigint := 0;
  i integer;
  line jsonb;
  side public.journal_side;
  amount bigint;
begin
  select id into eid
  from public.journal_entries
  where organization_id = p_org and posting_key = p_posting_key;
  if eid is not null then
    return eid;
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 2 then
    raise exception 'a journal needs balanced lines' using errcode = '22023';
  end if;
  for i in 0 .. jsonb_array_length(p_lines) - 1 loop
    line := p_lines -> i;
    side := (line->>'side')::public.journal_side;
    amount := (line->>'amount_cents')::bigint;
    if amount is null or amount <= 0 then
      raise exception 'journal amounts are positive cents' using errcode = '22023';
    end if;
    if side = 'debit' then
      debit_sum := debit_sum + amount;
    else
      credit_sum := credit_sum + amount;
    end if;
  end loop;
  if debit_sum <> credit_sum then
    raise exception 'journal does not balance' using errcode = '22023';
  end if;
  insert into public.journal_entries (organization_id, posting_key, source_type, source_id, currency, memo)
  values (p_org, p_posting_key, p_source_type, p_source_id, p_currency, left(p_memo, 200))
  returning id into eid;
  for i in 0 .. jsonb_array_length(p_lines) - 1 loop
    line := p_lines -> i;
    insert into public.journal_lines (organization_id, entry_id, account_id, side, amount_cents, currency)
    values (
      p_org,
      eid,
      (line->>'account_id')::uuid,
      (line->>'side')::public.journal_side,
      (line->>'amount_cents')::bigint,
      p_currency
    );
  end loop;
  return eid;
end;
$$;
revoke all on function app.post_journal(uuid, text, text, uuid, text, jsonb, text) from public;

create function app.sync_invoice_balance(p_invoice uuid, p_delta bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv public.invoices%rowtype;
  tz text;
  today date;
  next_balance bigint;
  credited bigint;
begin
  select * into inv from public.invoices where id = p_invoice for update;
  if inv.id is null then
    raise exception 'invoice not found' using errcode = '22023';
  end if;
  next_balance := inv.balance_cents + p_delta;
  if next_balance < 0 or next_balance > inv.total_cents then
    raise exception 'invoice balance is out of range' using errcode = '23514';
  end if;
  select coalesce(sum(amount_cents), 0) into credited
  from public.credit_notes
  where invoice_id = inv.id and status = 'applied';
  select org.timezone into tz from public.organizations org where org.id = inv.organization_id;
  today := (timezone(coalesce(tz, 'UTC'), clock_timestamp()))::date;
  update public.invoices
  set balance_cents = next_balance,
      status = case
        when inv.status = 'voided' then 'voided'::public.invoice_status
        when next_balance = 0 and credited >= inv.total_cents then 'credited'::public.invoice_status
        when next_balance = 0 then 'paid'::public.invoice_status
        when next_balance < inv.total_cents then 'partially_paid'::public.invoice_status
        when inv.due_on is not null and inv.due_on < today then 'overdue'::public.invoice_status
        else 'issued'::public.invoice_status
      end
  where id = inv.id;
end;
$$;
revoke all on function app.sync_invoice_balance(uuid, bigint) from public;

create function app.client_funds_cents(p_org uuid, p_matter uuid, p_person uuid, p_currency text)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  aid uuid;
begin
  select id into aid
  from public.ledger_accounts
  where organization_id = p_org
    and matter_id = p_matter
    and person_id = p_person
    and kind = 'client_funds'
    and currency = p_currency;
  if aid is null then
    return 0;
  end if;
  return app.account_balance(aid);
end;
$$;
revoke all on function app.client_funds_cents(uuid, uuid, uuid, text) from public;

create function app.earned_fee_cents(p_org uuid, p_matter uuid, p_person uuid, p_currency text)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  aid uuid;
begin
  select id into aid
  from public.ledger_accounts
  where organization_id = p_org
    and matter_id = p_matter
    and person_id = p_person
    and kind = 'earned_fees'
    and currency = p_currency;
  if aid is null then
    return 0;
  end if;
  return app.account_balance(aid);
end;
$$;
revoke all on function app.earned_fee_cents(uuid, uuid, uuid, text) from public;

create function app.billing_task(p_org uuid, p_matter uuid, p_title text, p_days integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_mem uuid;
  tz text;
  tid uuid;
begin
  select mem.id into owner_mem
  from public.memberships mem
  where mem.organization_id = p_org
    and mem.user_id = (select auth.uid())
    and mem.status = 'active'
  limit 1;
  if owner_mem is null then
    select mem.id into owner_mem
    from public.memberships mem
    where mem.organization_id = p_org
      and mem.role = 'firm_owner'
      and mem.status = 'active'
    limit 1;
  end if;
  if owner_mem is null then
    return null;
  end if;
  select org.timezone into tz from public.organizations org where org.id = p_org;
  insert into public.tasks (
    organization_id, matter_id, audience, title, priority, status,
    owner_membership_id, due_on, due_timezone
  ) values (
    p_org,
    p_matter,
    'internal',
    left(p_title, 200),
    'high',
    'open',
    owner_mem,
    (timezone(coalesce(tz, 'UTC'), clock_timestamp()))::date + p_days,
    coalesce(tz, 'UTC')
  )
  returning id into tid;
  return tid;
end;
$$;
revoke all on function app.billing_task(uuid, uuid, text, integer) from public;

create function app.write_receipt(
  p_org uuid,
  p_payment uuid,
  p_transfer uuid,
  p_invoice uuid,
  p_amount bigint,
  p_currency text,
  p_lines text[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  rid uuid;
  num text;
begin
  select id into rid
  from public.receipts
  where organization_id = p_org
    and payment_id is not distinct from p_payment
    and transfer_id is not distinct from p_transfer;
  if rid is not null then
    return rid;
  end if;
  num := app.next_billing_number(p_org, 'R');
  insert into public.receipts (organization_id, payment_id, transfer_id, invoice_id, number, amount_cents, currency, pdf)
  values (p_org, p_payment, p_transfer, p_invoice, num, p_amount, p_currency, app.build_text_pdf(p_lines))
  returning id into rid;
  return rid;
end;
$$;
revoke all on function app.write_receipt(uuid, uuid, uuid, uuid, bigint, text, text[]) from public;

create function app.mark_installments_paid(p_invoice uuid, p_amount bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  row record;
  left_cents bigint := p_amount;
begin
  for row in
    select id, amount_cents
    from public.installments
    where invoice_id = p_invoice and status in ('scheduled', 'due')
    order by sequence_no
  loop
    exit when left_cents <= 0;
    if left_cents >= row.amount_cents then
      update public.installments set status = 'paid' where id = row.id;
      left_cents := left_cents - row.amount_cents;
    else
      exit;
    end if;
  end loop;
end;
$$;
revoke all on function app.mark_installments_paid(uuid, bigint) from public;

-- Posts a verified payment once. Extra cents above the invoice become client funds.
-- Advance requests credit client funds, not earned fees.
create function app.allocate_succeeded_payment(p_payment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  pay public.payments%rowtype;
  inv public.invoices%rowtype;
  to_invoice bigint;
  overpay bigint;
  funds uuid;
  earned uuid;
  clearing uuid;
  lines jsonb := '[]'::jsonb;
  client_credit bigint := 0;
  earned_credit bigint := 0;
begin
  select * into pay from public.payments where id = p_payment_id for update;
  if pay.id is null then
    raise exception 'payment not found' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.journal_entries entry
    where entry.organization_id = pay.organization_id
      and entry.posting_key = 'payment:' || pay.id::text
  ) then
    return;
  end if;
  if pay.state not in ('pending', 'processing', 'failed') then
    return;
  end if;
  if pay.invoice_id is null then
    raise exception 'payment is not linked to an invoice' using errcode = '22023';
  end if;
  select * into inv from public.invoices where id = pay.invoice_id for update;
  if inv.kind = 'quote' then
    raise exception 'a quote is not payable' using errcode = '22023';
  end if;
  if inv.status not in ('issued', 'partially_paid', 'overdue') then
    raise exception 'invoice is not payable' using errcode = '22023';
  end if;
  if pay.currency is distinct from inv.currency then
    raise exception 'payment currency does not match the invoice' using errcode = '22023';
  end if;
  to_invoice := least(pay.amount_cents, inv.balance_cents);
  overpay := pay.amount_cents - to_invoice;
  clearing := app.ensure_ledger_account(inv.organization_id, null, null, 'processor_clearing', inv.currency);
  funds := app.ensure_ledger_account(inv.organization_id, inv.matter_id, inv.billing_person_id, 'client_funds', inv.currency);
  earned := app.ensure_ledger_account(inv.organization_id, inv.matter_id, inv.billing_person_id, 'earned_fees', inv.currency);
  if inv.kind = 'advance_request' then
    client_credit := pay.amount_cents;
  else
    earned_credit := to_invoice;
    client_credit := overpay;
  end if;
  lines := jsonb_build_array(jsonb_build_object('account_id', clearing, 'side', 'debit', 'amount_cents', pay.amount_cents));
  if client_credit > 0 then
    lines := lines || jsonb_build_array(jsonb_build_object('account_id', funds, 'side', 'credit', 'amount_cents', client_credit));
  end if;
  if earned_credit > 0 then
    lines := lines || jsonb_build_array(jsonb_build_object('account_id', earned, 'side', 'credit', 'amount_cents', earned_credit));
  end if;
  perform app.post_journal(
    inv.organization_id,
    'payment:' || pay.id::text,
    'payment',
    pay.id,
    inv.currency,
    lines,
    'Payment ' || pay.id::text
  );
  if to_invoice > 0 then
    insert into public.payment_allocations (organization_id, payment_id, invoice_id, kind, amount_cents, currency)
    values (inv.organization_id, pay.id, inv.id, 'invoice', to_invoice, inv.currency);
    perform app.sync_invoice_balance(inv.id, -to_invoice);
    perform app.mark_installments_paid(inv.id, to_invoice);
  end if;
  if overpay > 0 or (inv.kind = 'advance_request' and client_credit > to_invoice) then
    insert into public.payment_allocations (organization_id, payment_id, invoice_id, kind, amount_cents, currency)
    values (
      inv.organization_id,
      pay.id,
      null,
      'client_funds',
      case when inv.kind = 'advance_request' then client_credit else overpay end,
      inv.currency
    );
  elsif inv.kind = 'advance_request' and client_credit > 0 then
    insert into public.payment_allocations (organization_id, payment_id, invoice_id, kind, amount_cents, currency)
    values (inv.organization_id, pay.id, null, 'client_funds', client_credit, inv.currency);
  end if;
  update public.payments
  set state = 'succeeded', verified_at = clock_timestamp()
  where id = pay.id;
  perform app.write_receipt(
    inv.organization_id, pay.id, null, inv.id, pay.amount_cents, inv.currency,
    array[
      'Casevoya receipt',
      'Amount ' || pay.currency || ' ' || pay.amount_cents::text || ' cents',
      'Invoice ' || inv.number,
      'Government fees are not included'
    ]
  );
  perform app.record_audit_event(
    inv.organization_id, 'billing.payment_posted', 'public.payments', pay.id, 'success',
    jsonb_build_object('amount_cents', pay.amount_cents, 'currency', inv.currency, 'invoice_id', inv.id)
  );
  perform app.enqueue_event(
    inv.organization_id, 'payment', pay.id, 'payment.posted',
    jsonb_build_object('payment_id', pay.id, 'invoice_id', inv.id, 'amount_cents', pay.amount_cents),
    null, 'payment-posted:' || pay.id::text, null
  );
end;
$$;
revoke all on function app.allocate_succeeded_payment(uuid) from public;

create function app.reverse_payment_amount(
  p_payment_id uuid,
  p_amount bigint,
  p_posting_key text,
  p_memo text,
  p_source_type text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  pay public.payments%rowtype;
  inv public.invoices%rowtype;
  funds uuid;
  earned uuid;
  clearing uuid;
  from_invoice bigint;
  from_funds bigint;
  lines jsonb;
begin
  if exists (
    select 1 from public.journal_entries entry
    where entry.posting_key = p_posting_key
  ) then
    return;
  end if;
  select * into pay from public.payments where id = p_payment_id for update;
  if pay.state <> 'succeeded' and pay.state <> 'disputed' then
    return;
  end if;
  if p_amount <= 0 or pay.refunded_cents + pay.disputed_cents + p_amount > pay.amount_cents then
    raise exception 'reversal exceeds the payment' using errcode = '22023';
  end if;
  select * into inv from public.invoices where id = pay.invoice_id for update;
  clearing := app.ensure_ledger_account(pay.organization_id, null, null, 'processor_clearing', pay.currency);
  funds := app.ensure_ledger_account(inv.organization_id, inv.matter_id, inv.billing_person_id, 'client_funds', pay.currency);
  earned := app.ensure_ledger_account(inv.organization_id, inv.matter_id, inv.billing_person_id, 'earned_fees', pay.currency);
  from_funds := least(p_amount, greatest(app.account_balance(funds), 0));
  from_invoice := p_amount - from_funds;
  if inv.kind = 'advance_request' then
    from_funds := p_amount;
    from_invoice := least(p_amount, inv.total_cents - inv.balance_cents);
  elsif inv.kind = 'professional_services' then
    from_invoice := least(p_amount, inv.total_cents - inv.balance_cents);
    from_funds := p_amount - from_invoice;
  end if;
  lines := jsonb_build_array(jsonb_build_object('account_id', clearing, 'side', 'credit', 'amount_cents', p_amount));
  if from_funds > 0 then
    lines := lines || jsonb_build_array(jsonb_build_object('account_id', funds, 'side', 'debit', 'amount_cents', from_funds));
  end if;
  if p_amount - from_funds > 0 then
    lines := lines || jsonb_build_array(jsonb_build_object('account_id', earned, 'side', 'debit', 'amount_cents', p_amount - from_funds));
  end if;
  perform app.post_journal(pay.organization_id, p_posting_key, p_source_type, pay.id, pay.currency, lines, p_memo);
  if from_invoice > 0 then
    perform app.sync_invoice_balance(inv.id, from_invoice);
  end if;
end;
$$;
revoke all on function app.reverse_payment_amount(uuid, bigint, text, text, text) from public;

create function app.open_payment_dispute(p_payment_id uuid, p_provider_dispute_id text, p_amount bigint)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  pay public.payments%rowtype;
  did uuid;
  days integer;
  tid uuid;
  stage_before public.matter_stage;
  stage_after public.matter_stage;
begin
  if p_provider_dispute_id is not null then
    select id into did
    from public.payment_disputes
    where provider = 'stripe' and provider_dispute_id = p_provider_dispute_id;
    if did is not null then
      return did;
    end if;
  end if;
  select * into pay from public.payments where id = p_payment_id for update;
  if pay.id is null then
    raise exception 'payment not found' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > pay.amount_cents then
    raise exception 'dispute amount is out of range' using errcode = '22023';
  end if;
  select matter.stage into stage_before
  from public.matters matter
  join public.invoices inv on inv.matter_id = matter.id
  where inv.id = pay.invoice_id;
  insert into public.payment_disputes (
    organization_id, payment_id, amount_cents, currency, provider, provider_dispute_id
  ) values (
    pay.organization_id, pay.id, p_amount, pay.currency, 'stripe', nullif(btrim(coalesce(p_provider_dispute_id, '')), '')
  )
  returning id into did;
  if pay.state in ('succeeded', 'disputed') then
    perform app.reverse_payment_amount(
      pay.id, p_amount, 'dispute:' || did::text, 'Dispute ' || did::text, 'dispute'
    );
    update public.payments
    set state = 'disputed', disputed_cents = disputed_cents + p_amount
    where id = pay.id;
  end if;
  days := coalesce((app.billing_setting(array['withdrawal_follow_up_days']))::integer, null);
  if days is null then
    raise exception 'billing settings are not configured' using errcode = '22023';
  end if;
  tid := app.billing_task(
    pay.organization_id,
    (select matter_id from public.invoices where id = pay.invoice_id),
    'Review a disputed payment',
    days
  );
  update public.payment_disputes set task_id = tid where id = did;
  select matter.stage into stage_after
  from public.matters matter
  join public.invoices inv on inv.matter_id = matter.id
  where inv.id = pay.invoice_id;
  if stage_after is distinct from stage_before then
    raise exception 'a dispute must not change matter stage' using errcode = '55000';
  end if;
  perform app.record_audit_event(
    pay.organization_id, 'billing.dispute_opened', 'public.payment_disputes', did, 'success',
    jsonb_build_object('payment_id', pay.id, 'amount_cents', p_amount)
  );
  perform app.enqueue_event(
    pay.organization_id, 'payment_dispute', did, 'payment.dispute_opened',
    jsonb_build_object('payment_id', pay.id, 'dispute_id', did, 'amount_cents', p_amount),
    null, 'dispute:' || coalesce(p_provider_dispute_id, did::text), null
  );
  return did;
end;
$$;
revoke all on function app.open_payment_dispute(uuid, text, bigint) from public;

create function app.settle_refund(p_refund_id uuid, p_provider_refund_id text, p_provider text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  row public.refunds%rowtype;
  existing uuid;
begin
  if p_provider_refund_id is not null and btrim(p_provider_refund_id) <> '' then
    select id into existing
    from public.refunds
    where provider = p_provider and provider_refund_id = btrim(p_provider_refund_id) and status = 'succeeded';
    if existing is not null then
      return existing;
    end if;
  end if;
  select * into row from public.refunds where id = p_refund_id for update;
  if row.id is null then
    raise exception 'refund not found' using errcode = '22023';
  end if;
  if row.status = 'succeeded' then
    return row.id;
  end if;
  if row.status not in ('approved', 'pending') then
    raise exception 'refund is not approved' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.journal_entries entry
    where entry.posting_key = 'payment:' || row.payment_id::text
  ) then
    update public.refunds
    set status = 'pending', provider = p_provider, provider_refund_id = nullif(btrim(coalesce(p_provider_refund_id, '')), '')
    where id = row.id;
    return row.id;
  end if;
  perform app.reverse_payment_amount(
    row.payment_id, row.amount_cents, 'refund:' || coalesce(nullif(btrim(coalesce(p_provider_refund_id, '')), ''), row.id::text),
    'Refund ' || row.id::text, 'refund'
  );
  update public.payments
  set refunded_cents = refunded_cents + row.amount_cents,
      state = case when refunded_cents + row.amount_cents >= amount_cents then 'reversed'::public.payment_state else state end
  where id = row.payment_id;
  update public.refunds
  set status = 'succeeded',
      provider = p_provider,
      provider_refund_id = nullif(btrim(coalesce(p_provider_refund_id, '')), '')
  where id = row.id;
  perform app.record_audit_event(
    row.organization_id, 'billing.refund_settled', 'public.refunds', row.id, 'success',
    jsonb_build_object('payment_id', row.payment_id, 'amount_cents', row.amount_cents)
  );
  perform app.enqueue_event(
    row.organization_id, 'refund', row.id, 'payment.refund_settled',
    jsonb_build_object('refund_id', row.id, 'payment_id', row.payment_id, 'amount_cents', row.amount_cents),
    null, 'refund:' || coalesce(nullif(btrim(coalesce(p_provider_refund_id, '')), ''), row.id::text), null
  );
  return row.id;
end;
$$;
revoke all on function app.settle_refund(uuid, text, text) from public;

-- ---------------------------------------------------------------------------
-- Staff billing actions
-- ---------------------------------------------------------------------------

create function app.create_billing_document(
  p_matter_id uuid,
  p_billing_person_id uuid,
  p_kind public.billing_document_kind,
  p_lines jsonb,
  p_government_fee_note text,
  p_due_on date,
  p_service_note text,
  p_currency text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid;
  matter public.matters%rowtype;
  inv uuid;
  i integer;
  entry jsonb;
  qty integer;
  unit bigint;
  net bigint;
  rate integer;
  tax bigint;
  tax_id uuid;
  category public.fee_category;
  subtotal bigint := 0;
  tax_total bigint := 0;
  note text := nullif(btrim(coalesce(p_government_fee_note, '')), '');
  service text := nullif(btrim(coalesce(p_service_note, '')), '');
  currency text := lower(coalesce(p_currency, 'cad'));
begin
  if app.can_perform_billing(p_matter_id, 'issue_invoice') is distinct from true then
    raise exception 'billing access denied' using errcode = '42501';
  end if;
  select * into matter from public.matters where id = p_matter_id;
  org := matter.organization_id;
  if org is null or org is distinct from (select app.current_organization_id()) then
    raise exception 'billing access denied' using errcode = '42501';
  end if;
  if matter.is_sample then
    raise exception 'sample matters are not billed' using errcode = '22023';
  end if;
  if currency !~ '^[a-z]{3}$' then
    raise exception 'currency must be an ISO code' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.persons person
    where person.id = p_billing_person_id
      and person.organization_id = org
      and person.is_sample is false
  ) then
    raise exception 'billing party is not a real person on this firm' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.matter_participants mp
    where mp.matter_id = p_matter_id
      and mp.organization_id = org
      and mp.person_id = p_billing_person_id
  ) then
    raise exception 'billing party is not on the matter' using errcode = '22023';
  end if;
  if note is not null and length(note) > 500 then
    raise exception 'government fee note is too long' using errcode = '22023';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 1 or jsonb_array_length(p_lines) > 40 then
    raise exception 'invoice lines are required' using errcode = '22023';
  end if;
  insert into public.invoices (
    organization_id, matter_id, billing_person_id, number, kind, status, currency,
    service_note, government_fee_note, due_on
  ) values (
    org, p_matter_id, p_billing_person_id, app.next_billing_number(org, 'CV'), p_kind, 'draft', currency,
    service, note, p_due_on
  )
  returning id into inv;
  for i in 0 .. jsonb_array_length(p_lines) - 1 loop
    entry := p_lines -> i;
    if coalesce((entry->>'government_fee_cents')::bigint, 0) <> 0 then
      raise exception 'government fees are a note only' using errcode = '22023';
    end if;
    qty := (entry->>'quantity')::integer;
    unit := (entry->>'unit_amount_cents')::bigint;
    category := (entry->>'fee_category')::public.fee_category;
    tax_id := nullif(entry->>'tax_rate_id', '')::uuid;
    if qty is null or unit is null or qty < 1 or unit <= 0 then
      raise exception 'line amounts are positive integer cents' using errcode = '22023';
    end if;
    if length(btrim(coalesce(entry->>'description', ''))) not between 1 and 200 then
      raise exception 'line description is required' using errcode = '22023';
    end if;
    rate := 0;
    if tax_id is not null then
      select tax.rate_bps into rate
      from public.tax_rates tax
      where tax.id = tax_id
        and tax.organization_id = org
        and tax.effective_from <= current_date
        and (tax.effective_to is null or tax.effective_to >= current_date);
      if rate is null then
        raise exception 'tax rate is not effective' using errcode = '22023';
      end if;
    end if;
    net := qty::bigint * unit;
    tax := (net * rate) / 10000;
    subtotal := subtotal + net;
    tax_total := tax_total + tax;
    insert into public.invoice_lines (
      organization_id, invoice_id, description, quantity, unit_amount_cents,
      fee_category, tax_rate_id, net_cents, tax_cents, sort_order
    ) values (
      org, inv, btrim(entry->>'description'), qty, unit,
      category, tax_id, net, tax, i
    );
  end loop;
  update public.invoices
  set subtotal_cents = subtotal,
      tax_cents = tax_total,
      total_cents = subtotal + tax_total,
      balance_cents = subtotal + tax_total
  where id = inv;
  return inv;
end;
$$;
revoke all on function app.create_billing_document(uuid, uuid, public.billing_document_kind, jsonb, text, date, text, text) from public;

create function app.issue_billing_document(p_id uuid, p_service_note text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv public.invoices%rowtype;
  service text;
  lines text[] := array[]::text[];
  row record;
begin
  select * into inv from public.invoices where id = p_id for update;
  if inv.id is null or app.can_perform_billing(inv.matter_id, 'issue_invoice') is distinct from true then
    raise exception 'billing access denied' using errcode = '42501';
  end if;
  if inv.status <> 'draft' then
    raise exception 'invoice is already issued' using errcode = '22023';
  end if;
  service := coalesce(nullif(btrim(coalesce(p_service_note, '')), ''), inv.service_note);
  if inv.kind = 'professional_services' and (service is null or length(service) < 8) then
    raise exception 'professional invoice needs a delivered-service note' using errcode = '22023';
  end if;
  if inv.total_cents <= 0 then
    raise exception 'invoice total is empty' using errcode = '22023';
  end if;
  lines := array[
    'Casevoya ' || inv.kind::text,
    inv.number,
    'Currency ' || inv.currency,
    'Total cents ' || inv.total_cents::text,
    coalesce(inv.government_fee_note, 'Government fees are not on this invoice')
  ];
  for row in
    select description, net_cents from public.invoice_lines where invoice_id = inv.id order by sort_order
  loop
    lines := lines || array[row.description || ' ' || row.net_cents::text];
  end loop;
  update public.invoices
  set status = 'issued',
      issued_at = clock_timestamp(),
      service_note = service,
      pdf = app.build_text_pdf(lines)
  where id = inv.id;
  perform app.perform_billing_action(inv.matter_id, 'issue_invoice');
  perform app.enqueue_event(
    inv.organization_id, 'invoice', inv.id, 'invoice.issued',
    jsonb_build_object('invoice_id', inv.id, 'kind', inv.kind, 'total_cents', inv.total_cents, 'currency', inv.currency),
    null, 'invoice-issued:' || inv.id::text, null
  );
  return inv.id;
end;
$$;
revoke all on function app.issue_billing_document(uuid, text) from public;

create function app.record_manual_payment(
  p_invoice_id uuid,
  p_amount_cents bigint,
  p_method public.payment_method_kind,
  p_external_reference text,
  p_received_on date,
  p_destination text,
  p_evidence text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv public.invoices%rowtype;
  existing uuid;
  pid uuid;
  reference text := nullif(btrim(coalesce(p_external_reference, '')), '');
begin
  select * into inv from public.invoices where id = p_invoice_id;
  if inv.id is null or app.can_perform_billing(inv.matter_id, 'issue_invoice') is distinct from true then
    raise exception 'billing access denied' using errcode = '42501';
  end if;
  if p_method = 'card' then
    raise exception 'card payments use a PaymentIntent' using errcode = '22023';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'amount is positive cents' using errcode = '22023';
  end if;
  if reference is null or p_received_on is null
     or length(btrim(coalesce(p_destination, ''))) < 1
     or length(btrim(coalesce(p_evidence, ''))) < 1 then
    raise exception 'manual payment needs a reference, date, destination, and evidence' using errcode = '22023';
  end if;
  select id into existing
  from public.payments
  where organization_id = inv.organization_id and external_reference = reference;
  if existing is not null then
    return existing;
  end if;
  insert into public.payments (
    organization_id, invoice_id, amount_cents, currency, state, method, provider,
    external_reference, destination, evidence, received_on
  ) values (
    inv.organization_id, inv.id, p_amount_cents, inv.currency, 'pending', p_method, 'manual',
    reference, btrim(p_destination), btrim(p_evidence), p_received_on
  )
  returning id into pid;
  perform app.record_audit_event(
    inv.organization_id, 'billing.manual_payment_recorded', 'public.payments', pid, 'success',
    jsonb_build_object('invoice_id', inv.id, 'amount_cents', p_amount_cents, 'state', 'pending')
  );
  return pid;
end;
$$;
revoke all on function app.record_manual_payment(uuid, bigint, public.payment_method_kind, text, date, text, text) from public;

create function app.verify_manual_payment(p_payment_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  pay public.payments%rowtype;
begin
  select * into pay from public.payments where id = p_payment_id;
  if pay.id is null or pay.invoice_id is null then
    raise exception 'payment not found' using errcode = '22023';
  end if;
  if app.can_perform_billing(
    (select matter_id from public.invoices where id = pay.invoice_id),
    'approve_earned_fee_transfer'
  ) is distinct from true then
    raise exception 'billing access denied' using errcode = '42501';
  end if;
  if pay.state = 'succeeded' then
    return pay.id;
  end if;
  if pay.state <> 'pending' or pay.method = 'card' then
    raise exception 'payment is not awaiting verification' using errcode = '22023';
  end if;
  perform app.allocate_succeeded_payment(pay.id);
  return pay.id;
end;
$$;
revoke all on function app.verify_manual_payment(uuid) from public;

create function app.reserve_card_payment(p_invoice_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv public.invoices%rowtype;
  account public.processor_accounts%rowtype;
  existing uuid;
  pid uuid;
begin
  select * into inv from public.invoices where id = p_invoice_id for update;
  if inv.id is null then
    raise exception 'invoice not found' using errcode = '22023';
  end if;
  if inv.organization_id is distinct from (select app.current_organization_id()) then
    raise exception 'billing access denied' using errcode = '42501';
  end if;
  if inv.kind <> 'professional_services' or inv.status not in ('issued', 'partially_paid', 'overdue') or inv.balance_cents <= 0 then
    raise exception 'this invoice cannot be charged on a card' using errcode = '22023';
  end if;
  if inv.kind = 'professional_services' and not exists (
    select 1 from public.persons person
    where person.id = inv.billing_person_id and person.user_id = (select auth.uid())
  ) and app.can_perform_billing(inv.matter_id, 'issue_invoice') is distinct from true then
    raise exception 'billing access denied' using errcode = '42501';
  end if;
  select * into account from public.processor_accounts where organization_id = inv.organization_id;
  if account.id is null or account.status <> 'enabled' then
    raise exception 'connect account is not enabled' using errcode = '22023';
  end if;
  select id into existing
  from public.payments
  where invoice_id = inv.id and method = 'card' and state = 'processing'
  limit 1;
  if existing is not null then
    return existing;
  end if;
  insert into public.payments (
    organization_id, invoice_id, amount_cents, currency, state, method, provider, connected_account_id
  ) values (
    inv.organization_id, inv.id, inv.balance_cents, inv.currency, 'processing', 'card', 'stripe', account.stripe_account_id
  )
  returning id into pid;
  return pid;
end;
$$;
revoke all on function app.reserve_card_payment(uuid) from public;

create function app.attach_payment_intent(p_payment_id uuid, p_intent_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.payments
  set provider_payment_intent_id = p_intent_id
  where id = p_payment_id
    and organization_id = (select app.current_organization_id())
    and provider_payment_intent_id is null
    and state = 'processing';
end;
$$;
revoke all on function app.attach_payment_intent(uuid, text) from public;

create function app.propose_earned_transfer(p_invoice_id uuid, p_amount_cents bigint, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv public.invoices%rowtype;
  tid uuid;
  reason text := btrim(coalesce(p_reason, ''));
begin
  select * into inv from public.invoices where id = p_invoice_id;
  if inv.id is null or app.can_perform_billing(inv.matter_id, 'issue_invoice') is distinct from true then
    raise exception 'billing access denied' using errcode = '42501';
  end if;
  if inv.kind <> 'professional_services' or inv.status not in ('issued', 'partially_paid', 'overdue') then
    raise exception 'earned fees move against an issued professional invoice' using errcode = '22023';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 or p_amount_cents > inv.balance_cents then
    raise exception 'transfer exceeds the invoice balance' using errcode = '22023';
  end if;
  if length(reason) < 8 then
    raise exception 'a transfer needs a reason' using errcode = '22023';
  end if;
  if p_amount_cents > app.client_funds_cents(inv.organization_id, inv.matter_id, inv.billing_person_id, inv.currency) then
    raise exception 'transfer exceeds available client funds' using errcode = '22023';
  end if;
  insert into public.earned_fee_transfers (
    organization_id, matter_id, person_id, invoice_id, amount_cents, currency, reason, proposed_by
  ) values (
    inv.organization_id, inv.matter_id, inv.billing_person_id, inv.id, p_amount_cents, inv.currency, reason, (select auth.uid())
  )
  returning id into tid;
  return tid;
end;
$$;
revoke all on function app.propose_earned_transfer(uuid, bigint, text) from public;

create function app.approve_earned_transfer(p_transfer_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  row public.earned_fee_transfers%rowtype;
  funds uuid;
  earned uuid;
  available bigint;
  days integer;
  reason text := btrim(coalesce(p_reason, ''));
begin
  select * into row from public.earned_fee_transfers where id = p_transfer_id for update;
  if row.id is null or app.can_perform_billing(row.matter_id, 'approve_earned_fee_transfer') is distinct from true then
    raise exception 'billing access denied' using errcode = '42501';
  end if;
  if row.status = 'posted' then
    return row.id;
  end if;
  if row.status <> 'proposed' then
    raise exception 'transfer is not proposed' using errcode = '22023';
  end if;
  if app.billing_staff_count(row.organization_id) >= 2 and row.proposed_by = (select auth.uid()) then
    raise exception 'a second person approves this transfer' using errcode = '42501';
  end if;
  if app.billing_staff_count(row.organization_id) < 2 and length(reason) < 8 then
    raise exception 'solo approval needs a reason' using errcode = '22023';
  end if;
  available := app.client_funds_cents(row.organization_id, row.matter_id, row.person_id, row.currency);
  if row.amount_cents > available then
    raise exception 'transfer exceeds available client funds' using errcode = '22023';
  end if;
  if row.amount_cents > (select balance_cents from public.invoices where id = row.invoice_id) then
    raise exception 'transfer exceeds the invoice balance' using errcode = '22023';
  end if;
  funds := app.ensure_ledger_account(row.organization_id, row.matter_id, row.person_id, 'client_funds', row.currency);
  earned := app.ensure_ledger_account(row.organization_id, row.matter_id, row.person_id, 'earned_fees', row.currency);
  perform app.post_journal(
    row.organization_id,
    'transfer:' || row.id::text,
    'earned_fee_transfer',
    row.id,
    row.currency,
    jsonb_build_array(
      jsonb_build_object('account_id', funds, 'side', 'debit', 'amount_cents', row.amount_cents),
      jsonb_build_object('account_id', earned, 'side', 'credit', 'amount_cents', row.amount_cents)
    ),
    'Earned fee transfer'
  );
  insert into public.payment_allocations (organization_id, transfer_id, invoice_id, kind, amount_cents, currency)
  values (row.organization_id, row.id, row.invoice_id, 'invoice', row.amount_cents, row.currency);
  perform app.sync_invoice_balance(row.invoice_id, -row.amount_cents);
  perform app.perform_billing_action(row.matter_id, 'approve_earned_fee_transfer');
  days := (app.billing_setting(array['withdrawal_follow_up_days']))::integer;
  if days is null then
    raise exception 'billing settings are not configured' using errcode = '22023';
  end if;
  perform app.billing_task(row.organization_id, row.matter_id, 'Follow up on client-account withdrawal', days);
  perform app.write_receipt(
    row.organization_id, null, row.id, row.invoice_id, row.amount_cents, row.currency,
    array['Casevoya earned-fee receipt', row.currency || ' ' || row.amount_cents::text || ' cents']
  );
  update public.earned_fee_transfers
  set status = 'posted', approved_by = (select auth.uid())
  where id = row.id;
  perform app.enqueue_event(
    row.organization_id, 'earned_fee_transfer', row.id, 'billing.earned_fee_posted',
    jsonb_build_object('transfer_id', row.id, 'invoice_id', row.invoice_id, 'amount_cents', row.amount_cents),
    null, 'transfer-posted:' || row.id::text, null
  );
  return row.id;
end;
$$;
revoke all on function app.approve_earned_transfer(uuid, text) from public;

create function app.request_refund(p_payment_id uuid, p_amount_cents bigint, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  pay public.payments%rowtype;
  matter uuid;
  rid uuid;
begin
  select * into pay from public.payments where id = p_payment_id;
  select matter_id into matter from public.invoices where id = pay.invoice_id;
  if pay.id is null or app.can_perform_billing(matter, 'issue_invoice') is distinct from true then
    raise exception 'billing access denied' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 1 then
    raise exception 'a refund needs a reason' using errcode = '22023';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 or pay.refunded_cents + pay.disputed_cents + p_amount_cents > pay.amount_cents then
    raise exception 'refund exceeds the payment' using errcode = '22023';
  end if;
  insert into public.refunds (organization_id, payment_id, amount_cents, currency, reason, requested_by, provider)
  values (pay.organization_id, pay.id, p_amount_cents, pay.currency, btrim(p_reason), (select auth.uid()), pay.provider)
  returning id into rid;
  return rid;
end;
$$;
revoke all on function app.request_refund(uuid, bigint, text) from public;

create function app.approve_refund(p_refund_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  row public.refunds%rowtype;
  matter uuid;
  limit_cents bigint;
begin
  select * into row from public.refunds where id = p_refund_id for update;
  select inv.matter_id into matter
  from public.payments pay
  join public.invoices inv on inv.id = pay.invoice_id
  where pay.id = row.payment_id;
  if row.id is null or app.can_perform_billing(matter, 'approve_earned_fee_transfer') is distinct from true then
    raise exception 'billing access denied' using errcode = '42501';
  end if;
  if row.status = 'approved' or row.status = 'succeeded' then
    return row.id;
  end if;
  limit_cents := (app.billing_setting(array['refund_self_approval_limit_cents']))::bigint;
  if limit_cents is null then
    raise exception 'billing settings are not configured' using errcode = '22023';
  end if;
  if row.amount_cents > limit_cents
     and app.billing_staff_count(row.organization_id) >= 2
     and row.requested_by = (select auth.uid()) then
    raise exception 'a second person approves this refund' using errcode = '42501';
  end if;
  update public.refunds set status = 'approved', approved_by = (select auth.uid()) where id = row.id;
  perform app.record_audit_event(
    row.organization_id, 'billing.refund_approved', 'public.refunds', row.id, 'success',
    jsonb_build_object('amount_cents', row.amount_cents)
  );
  return row.id;
end;
$$;
revoke all on function app.approve_refund(uuid) from public;

create function app.issue_credit_note(p_invoice_id uuid, p_amount_cents bigint, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv public.invoices%rowtype;
  nid uuid;
begin
  select * into inv from public.invoices where id = p_invoice_id for update;
  if inv.id is null or app.can_perform_billing(inv.matter_id, 'issue_invoice') is distinct from true then
    raise exception 'billing access denied' using errcode = '42501';
  end if;
  if inv.status not in ('issued', 'partially_paid', 'overdue') then
    raise exception 'invoice cannot be credited' using errcode = '22023';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 or p_amount_cents > inv.balance_cents then
    raise exception 'credit exceeds the balance' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 1 then
    raise exception 'a credit note needs a reason' using errcode = '22023';
  end if;
  insert into public.credit_notes (organization_id, invoice_id, amount_cents, currency, reason)
  values (inv.organization_id, inv.id, p_amount_cents, inv.currency, btrim(p_reason))
  returning id into nid;
  perform app.sync_invoice_balance(inv.id, -p_amount_cents);
  perform app.record_audit_event(
    inv.organization_id, 'billing.credit_note_issued', 'public.credit_notes', nid, 'success',
    jsonb_build_object('invoice_id', inv.id, 'amount_cents', p_amount_cents)
  );
  return nid;
end;
$$;
revoke all on function app.issue_credit_note(uuid, bigint, text) from public;

create function app.create_installment_plan(p_invoice_id uuid, p_count integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv public.invoices%rowtype;
  pid uuid;
  i integer;
  base bigint;
  amount bigint;
  due date;
begin
  select * into inv from public.invoices where id = p_invoice_id;
  if inv.id is null or app.can_perform_billing(inv.matter_id, 'issue_invoice') is distinct from true then
    raise exception 'billing access denied' using errcode = '42501';
  end if;
  if inv.status not in ('issued', 'partially_paid', 'overdue') or inv.balance_cents <= 0 then
    raise exception 'invoice has no balance to schedule' using errcode = '22023';
  end if;
  if p_count is null or p_count < 2 or p_count > 24 then
    raise exception 'installment count is out of range' using errcode = '22023';
  end if;
  insert into public.installment_plans (organization_id, invoice_id)
  values (inv.organization_id, inv.id)
  returning id into pid;
  base := inv.balance_cents / p_count;
  due := coalesce(inv.due_on, current_date);
  for i in 1 .. p_count loop
    amount := base;
    if i = p_count then
      amount := inv.balance_cents - base * (p_count - 1);
    end if;
    insert into public.installments (organization_id, plan_id, invoice_id, sequence_no, amount_cents, due_on)
    values (inv.organization_id, pid, inv.id, i, amount, due + ((i - 1) * 30));
  end loop;
  return pid;
end;
$$;
revoke all on function app.create_installment_plan(uuid, integer) from public;

create function app.cancel_installment_plan(p_plan_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  plan public.installment_plans%rowtype;
  matter uuid;
begin
  select * into plan from public.installment_plans where id = p_plan_id;
  select matter_id into matter from public.invoices where id = plan.invoice_id;
  if plan.id is null or app.can_perform_billing(matter, 'issue_invoice') is distinct from true then
    raise exception 'billing access denied' using errcode = '42501';
  end if;
  update public.installment_plans set status = 'cancelled' where id = plan.id and status <> 'paid';
  update public.installments set status = 'cancelled' where plan_id = plan.id and status in ('scheduled', 'due');
end;
$$;
revoke all on function app.cancel_installment_plan(uuid) from public;

create function app.set_tax_rate(p_code text, p_label text, p_rate_bps integer, p_effective_from date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid := app.current_organization_id();
  rid uuid;
begin
  if org is null
     or app.staff_mfa_satisfied() is distinct from true
     or app.has_org_role(org, array['firm_owner', 'finance_user']::public.org_role[]) is distinct from true then
    raise exception 'billing access denied' using errcode = '42501';
  end if;
  if p_rate_bps is null or p_rate_bps < 0 or p_rate_bps > 10000 or p_effective_from is null then
    raise exception 'tax rate is invalid' using errcode = '22023';
  end if;
  update public.tax_rates
  set effective_to = p_effective_from - 1
  where organization_id = org
    and code = upper(btrim(p_code))
    and effective_to is null
    and effective_from < p_effective_from;
  insert into public.tax_rates (organization_id, code, label, rate_bps, effective_from)
  values (org, upper(btrim(p_code)), btrim(p_label), p_rate_bps, p_effective_from)
  returning id into rid;
  return rid;
end;
$$;
revoke all on function app.set_tax_rate(text, text, integer, date) from public;

create function app.record_time_entry(p_matter_id uuid, p_minutes integer, p_rate_cents bigint, p_memo text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid := app.current_organization_id();
  mem uuid;
  tid uuid;
begin
  if org is null or app.can_perform_billing(p_matter_id, 'issue_invoice') is distinct from true then
    raise exception 'billing access denied' using errcode = '42501';
  end if;
  select id into mem
  from public.memberships
  where organization_id = org and user_id = (select auth.uid()) and status = 'active'
  limit 1;
  insert into public.time_entries (organization_id, matter_id, membership_id, minutes, rate_cents, memo)
  values (org, p_matter_id, mem, p_minutes, p_rate_cents, btrim(p_memo))
  returning id into tid;
  return tid;
end;
$$;
revoke all on function app.record_time_entry(uuid, integer, bigint, text) from public;

create function app.upsert_processor_account(p_stripe_account_id text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid := app.current_organization_id();
  aid uuid;
begin
  if org is null
     or app.mfa_step_up_satisfied() is distinct from true
     or app.has_org_role(org, array['firm_owner']::public.org_role[]) is distinct from true then
    raise exception 'billing access denied' using errcode = '42501';
  end if;
  insert into public.processor_accounts (organization_id, stripe_account_id, status)
  values (org, btrim(p_stripe_account_id), 'pending')
  on conflict (organization_id) do update
    set stripe_account_id = excluded.stripe_account_id
  returning id into aid;
  perform app.record_audit_event(
    org, 'billing.connect_account_saved', 'public.processor_accounts', aid, 'success',
    jsonb_build_object('status', 'pending')
  );
  return aid;
end;
$$;
revoke all on function app.upsert_processor_account(text) from public;

create function app.select_firm_plan(p_plan_code text, p_interval text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid := app.current_organization_id();
  amount bigint;
  catalog jsonb;
  seats integer;
  matters integer;
  snapshot jsonb;
begin
  if org is null
     or app.mfa_step_up_satisfied() is distinct from true
     or app.has_org_role(org, array['firm_owner']::public.org_role[]) is distinct from true then
    raise exception 'billing access denied' using errcode = '42501';
  end if;
  amount := app.plan_amount_cents(p_plan_code, p_interval);
  select value into catalog from public.product_settings where key = 'billing.plans';
  seats := (catalog #>> array['plans', p_plan_code, 'seats'])::integer;
  matters := (catalog #>> array['plans', p_plan_code, 'active_matters'])::integer;
  snapshot := jsonb_build_object(
    'plan_code', p_plan_code,
    'interval', p_interval,
    'amount_cents', amount,
    'currency', catalog->>'currency',
    'seats', seats,
    'active_matters', matters
  );
  update public.organization_subscriptions
  set plan_code = p_plan_code,
      billing_interval = p_interval,
      price_snapshot = snapshot
  where organization_id = org;
  perform app.record_audit_event(
    org, 'billing.plan_selected', 'public.organization_subscriptions', org, 'success', snapshot
  );
  return snapshot;
end;
$$;
revoke all on function app.select_firm_plan(text, text) from public;

create function app.record_reconciliation(
  p_period_start date,
  p_period_end date,
  p_statement_cents bigint,
  p_processor_balance_cents bigint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid := app.current_organization_id();
  control bigint;
  rid uuid;
begin
  if org is null
     or app.staff_mfa_satisfied() is distinct from true
     or app.has_org_role(org, array['firm_owner', 'finance_user']::public.org_role[]) is distinct from true then
    raise exception 'billing access denied' using errcode = '42501';
  end if;
  select coalesce(sum(app.account_balance(account.id)), 0) into control
  from public.ledger_accounts account
  where account.organization_id = org
    and account.kind = 'client_funds'
    and account.currency = 'cad';
  insert into public.reconciliation_periods (
    organization_id, period_start, period_end, currency, statement_cents, control_cents,
    subledger_cents, processor_balance_cents,
    status
  ) values (
    org, p_period_start, p_period_end, 'cad', p_statement_cents, control, control, p_processor_balance_cents,
    (case when p_statement_cents = control then 'open' else 'exceptions' end)::public.reconciliation_status
  )
  returning id into rid;
  if p_statement_cents is distinct from control then
    insert into public.reconciliation_exceptions (organization_id, period_id, detail)
    values (org, rid, 'Bank statement does not match the client-funds control total.');
  end if;
  if p_processor_balance_cents is not null and p_processor_balance_cents is distinct from control then
    insert into public.reconciliation_exceptions (organization_id, period_id, detail)
    values (org, rid, 'Processor balance is not the client account and was not used as the control total.');
  end if;
  return rid;
end;
$$;
revoke all on function app.record_reconciliation(date, date, bigint, bigint) from public;

create function app.can_read_invoice(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.invoices inv
    where inv.id = p_id
      and inv.organization_id = (select app.current_organization_id())
      and (
        (select app.can_read_matter_billing(inv.matter_id))
        or exists (
          select 1 from public.persons person
          where person.id = inv.billing_person_id
            and person.organization_id = inv.organization_id
            and person.user_id = (select auth.uid())
        )
      )
  );
$$;
revoke all on function app.can_read_invoice(uuid) from public;

create function app.finance_snapshot(p_matter_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  org uuid := app.current_organization_id();
  catalog jsonb;
begin
  if org is null or app.staff_mfa_satisfied() is distinct from true then
    return '{}'::jsonb;
  end if;
  if app.has_org_role(org, array['firm_owner', 'finance_user']::public.org_role[]) is distinct from true then
    return '{}'::jsonb;
  end if;
  select value into catalog from public.product_settings where key = 'billing.plans';
  return jsonb_build_object(
    'plans', catalog,
    'subscription', (
      select jsonb_build_object(
        'status', sub.status,
        'plan_code', sub.plan_code,
        'billing_interval', sub.billing_interval,
        'amount_cents', sub.price_snapshot->>'amount_cents',
        'currency', sub.price_snapshot->>'currency',
        'current_period_ends_at', sub.current_period_ends_at
      )
      from public.organization_subscriptions sub
      where sub.organization_id = org
    ),
    'connect', (
      select jsonb_build_object('account_id', acct.stripe_account_id, 'status', acct.status)
      from public.processor_accounts acct
      where acct.organization_id = org
    ),
    'invoices', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', inv.id,
        'number', inv.number,
        'kind', inv.kind,
        'status', case
          when inv.status in ('issued', 'partially_paid')
           and inv.due_on is not null
           and inv.due_on < current_date
           and inv.balance_cents > 0 then 'overdue'
          else inv.status::text
        end,
        'currency', inv.currency,
        'total_cents', inv.total_cents,
        'balance_cents', inv.balance_cents,
        'government_fee_note', inv.government_fee_note,
        'matter_id', inv.matter_id,
        'matter_title', matter.title,
        'billing_name', person.display_name,
        'due_on', inv.due_on
      ) order by inv.created_at desc)
      from public.invoices inv
      join public.matters matter on matter.id = inv.matter_id
      join public.persons person on person.id = inv.billing_person_id
      where inv.organization_id = org
        and (p_matter_id is null or inv.matter_id = p_matter_id)
        and app.can_read_matter_billing(inv.matter_id)
    ), '[]'::jsonb),
    'client_funds', coalesce((
      select jsonb_agg(jsonb_build_object(
        'matter_id', account.matter_id,
        'person_id', account.person_id,
        'cents', app.account_balance(account.id),
        'currency', account.currency
      ))
      from public.ledger_accounts account
      where account.organization_id = org
        and account.kind = 'client_funds'
        and (p_matter_id is null or account.matter_id = p_matter_id)
        and app.can_read_matter_billing(account.matter_id)
    ), '[]'::jsonb),
    'exceptions', coalesce((
      select jsonb_agg(jsonb_build_object('id', ex.id, 'detail', ex.detail, 'period_id', ex.period_id))
      from public.reconciliation_exceptions ex
      where ex.organization_id = org
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function app.finance_snapshot(uuid) from public;

create function app.portal_finance_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  org uuid := app.current_organization_id();
begin
  if org is null or (select auth.uid()) is null then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object(
    'invoices', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', inv.id,
        'number', inv.number,
        'kind', inv.kind,
        'status', inv.status,
        'currency', inv.currency,
        'total_cents', inv.total_cents,
        'balance_cents', inv.balance_cents,
        'government_fee_note', inv.government_fee_note,
        'matter_title', matter.title,
        'due_on', inv.due_on,
        'payable', inv.kind = 'professional_services' and inv.balance_cents > 0 and inv.status in ('issued', 'partially_paid', 'overdue')
      ) order by inv.created_at desc)
      from public.invoices inv
      join public.matters matter on matter.id = inv.matter_id
      join public.persons person on person.id = inv.billing_person_id
      where inv.organization_id = org
        and person.user_id = (select auth.uid())
        and inv.status <> 'draft'
    ), '[]'::jsonb),
    'receipts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', receipt.id,
        'number', receipt.number,
        'amount_cents', receipt.amount_cents,
        'currency', receipt.currency,
        'invoice_id', receipt.invoice_id
      ))
      from public.receipts receipt
      join public.invoices inv on inv.id = receipt.invoice_id
      join public.persons person on person.id = inv.billing_person_id
      where receipt.organization_id = org
        and person.user_id = (select auth.uid())
    ), '[]'::jsonb),
    'connect_enabled', exists (
      select 1 from public.processor_accounts acct
      where acct.organization_id = org and acct.status = 'enabled'
    )
  );
end;
$$;
revoke all on function app.portal_finance_snapshot() from public;

create function app.billing_document_pdf(p_id uuid)
returns bytea
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  body bytea;
begin
  if app.can_read_invoice(p_id) is distinct from true then
    raise exception 'billing access denied' using errcode = '42501';
  end if;
  select pdf into body from public.invoices where id = p_id;
  return body;
end;
$$;
revoke all on function app.billing_document_pdf(uuid) from public;

create function app.receipt_pdf(p_id uuid)
returns bytea
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  body bytea;
  invoice uuid;
begin
  select pdf, invoice_id into body, invoice from public.receipts where id = p_id;
  if invoice is null or app.can_read_invoice(invoice) is distinct from true then
    raise exception 'billing access denied' using errcode = '42501';
  end if;
  return body;
end;
$$;
revoke all on function app.receipt_pdf(uuid) from public;

-- Signed Stripe events. The HTTP route verifies the signature before calling this.
-- The inbox insert, money movement, outbox row, and audit row commit together.
create function app.record_stripe_event(
  p_event_id text,
  p_account_id text,
  p_event_type text,
  p_payload jsonb,
  p_organization_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  inbox uuid;
  existing_status public.webhook_inbox_status;
  flow text;
  payment uuid;
  amount bigint;
  event_currency text;
  account text;
  connect_status text;
  plan_interval text;
  snapshot_amount bigint;
begin
  if coalesce((select auth.jwt()) ->> 'role', '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  inbox := app.ingest_webhook_event(
    'stripe',
    p_event_id,
    coalesce(p_account_id, ''),
    p_event_type,
    coalesce(p_payload, '{}'::jsonb),
    true,
    p_organization_id
  );
  select status into existing_status from public.webhook_inbox where id = inbox for update;
  if existing_status = 'processed' then
    return 'duplicate';
  end if;
  if existing_status = 'ignored' then
    return 'ignored';
  end if;
  flow := p_payload->>'flow';
  payment := nullif(p_payload->>'payment_id', '')::uuid;
  amount := nullif(p_payload->>'amount_cents', '')::bigint;
  event_currency := nullif(p_payload->>'currency', '');
  account := nullif(btrim(coalesce(p_account_id, '')), '');

  if p_event_type = 'payment_intent.succeeded' and flow = 'client_fee' then
    if payment is null or not exists (
      select 1 from public.payments pay
      where pay.id = payment
        and pay.organization_id = p_organization_id
        and pay.amount_cents = amount
        and pay.currency = event_currency
        and pay.connected_account_id is not distinct from account
    ) then
      update public.webhook_inbox set status = 'failed', processed_at = clock_timestamp() where id = inbox;
      return 'payment_mismatch';
    end if;
    if not exists (
      select 1 from public.processor_accounts acct
      where acct.organization_id = p_organization_id
        and acct.stripe_account_id = account
        and acct.status = 'enabled'
    ) then
      update public.webhook_inbox set status = 'failed', processed_at = clock_timestamp() where id = inbox;
      return 'account_mismatch';
    end if;
    update public.payments
    set provider_event_id = p_event_id
    where id = payment and provider_event_id is null;
    perform app.allocate_succeeded_payment(payment);
  elsif p_event_type = 'payment_intent.payment_failed' and flow = 'client_fee' then
    update public.payments
    set state = 'failed'
    where id = payment and state in ('pending', 'processing');
    perform app.record_audit_event(
      p_organization_id, 'billing.payment_failed', 'public.payments', payment, 'failure',
      jsonb_build_object('event_id', p_event_id)
    );
  elsif p_event_type = 'refund.succeeded' then
    perform app.settle_refund(
      nullif(p_payload->>'refund_id', '')::uuid,
      p_payload->>'provider_refund_id',
      'stripe'
    );
  elsif p_event_type = 'dispute.opened' then
    perform app.open_payment_dispute(payment, p_payload->>'provider_dispute_id', amount);
  elsif p_event_type = 'connect.updated' then
    connect_status := p_payload->>'connect_status';
    if connect_status in ('pending', 'enabled', 'restricted') then
      update public.processor_accounts
      set status = connect_status::public.connect_account_status
      where organization_id = p_organization_id
        and stripe_account_id = account;
    end if;
  elsif p_event_type = 'platform_subscription.activated' then
    select price_snapshot->>'amount_cents', billing_interval
      into snapshot_amount, plan_interval
    from public.organization_subscriptions
    where organization_id = p_organization_id;
    if snapshot_amount is null or snapshot_amount is distinct from amount or event_currency is distinct from 'cad' then
      update public.webhook_inbox set status = 'failed', processed_at = clock_timestamp() where id = inbox;
      return 'plan_mismatch';
    end if;
    update public.organization_subscriptions
    set status = 'active',
        stripe_customer_id = nullif(p_payload->>'customer_id', ''),
        stripe_subscription_id = nullif(p_payload->>'subscription_id', ''),
        current_period_ends_at = clock_timestamp() + case when plan_interval = 'year' then interval '1 year' else interval '1 month' end
    where organization_id = p_organization_id;
  elsif p_event_type = 'platform_subscription.past_due' then
    update public.organization_subscriptions set status = 'past_due' where organization_id = p_organization_id;
  elsif p_event_type = 'platform_subscription.cancelled' then
    update public.organization_subscriptions set status = 'cancelled' where organization_id = p_organization_id;
  else
    update public.webhook_inbox set status = 'ignored', processed_at = clock_timestamp() where id = inbox;
    return 'ignored';
  end if;

  update public.webhook_inbox set status = 'processed', processed_at = clock_timestamp() where id = inbox;
  perform app.enqueue_event(
    p_organization_id,
    'webhook',
    inbox,
    'webhook.processed',
    jsonb_build_object('provider', 'stripe', 'event_id', p_event_id, 'event_type', p_event_type),
    null,
    'stripe-event:' || coalesce(account, '') || ':' || p_event_id,
    null
  );
  perform app.record_audit_event(
    p_organization_id, 'billing.webhook_processed', 'public.webhook_inbox', inbox, 'success',
    jsonb_build_object('event_id', p_event_id, 'event_type', p_event_type)
  );
  return 'processed';
end;
$$;
revoke all on function app.record_stripe_event(text, text, text, jsonb, uuid) from public;

-- ---------------------------------------------------------------------------
-- Public wrappers
-- ---------------------------------------------------------------------------

create function public.create_billing_document(p_matter_id uuid, p_billing_person_id uuid, p_kind public.billing_document_kind, p_lines jsonb, p_government_fee_note text, p_due_on date, p_service_note text, p_currency text)
returns uuid language sql security invoker set search_path = '' as $$
  select app.create_billing_document(p_matter_id, p_billing_person_id, p_kind, p_lines, p_government_fee_note, p_due_on, p_service_note, p_currency);
$$;
create function public.issue_billing_document(p_id uuid, p_service_note text)
returns uuid language sql security invoker set search_path = '' as $$
  select app.issue_billing_document(p_id, p_service_note);
$$;
create function public.record_manual_payment(p_invoice_id uuid, p_amount_cents bigint, p_method public.payment_method_kind, p_external_reference text, p_received_on date, p_destination text, p_evidence text)
returns uuid language sql security invoker set search_path = '' as $$
  select app.record_manual_payment(p_invoice_id, p_amount_cents, p_method, p_external_reference, p_received_on, p_destination, p_evidence);
$$;
create function public.verify_manual_payment(p_payment_id uuid)
returns uuid language sql security invoker set search_path = '' as $$
  select app.verify_manual_payment(p_payment_id);
$$;
create function public.reserve_card_payment(p_invoice_id uuid)
returns uuid language sql security invoker set search_path = '' as $$
  select app.reserve_card_payment(p_invoice_id);
$$;
create function public.attach_payment_intent(p_payment_id uuid, p_intent_id text)
returns void language sql security invoker set search_path = '' as $$
  select app.attach_payment_intent(p_payment_id, p_intent_id);
$$;
create function public.propose_earned_transfer(p_invoice_id uuid, p_amount_cents bigint, p_reason text)
returns uuid language sql security invoker set search_path = '' as $$
  select app.propose_earned_transfer(p_invoice_id, p_amount_cents, p_reason);
$$;
create function public.approve_earned_transfer(p_transfer_id uuid, p_reason text)
returns uuid language sql security invoker set search_path = '' as $$
  select app.approve_earned_transfer(p_transfer_id, p_reason);
$$;
create function public.client_funds_cents(p_matter_id uuid, p_person_id uuid, p_currency text)
returns bigint language sql security invoker set search_path = '' as $$
  select app.client_funds_cents((select app.current_organization_id()), p_matter_id, p_person_id, p_currency);
$$;
create function public.earned_fee_cents(p_matter_id uuid, p_person_id uuid, p_currency text)
returns bigint language sql security invoker set search_path = '' as $$
  select app.earned_fee_cents((select app.current_organization_id()), p_matter_id, p_person_id, p_currency);
$$;
create function public.request_refund(p_payment_id uuid, p_amount_cents bigint, p_reason text)
returns uuid language sql security invoker set search_path = '' as $$
  select app.request_refund(p_payment_id, p_amount_cents, p_reason);
$$;
create function public.approve_refund(p_refund_id uuid)
returns uuid language sql security invoker set search_path = '' as $$
  select app.approve_refund(p_refund_id);
$$;
create function public.settle_refund(p_refund_id uuid, p_provider_refund_id text, p_provider text)
returns uuid language sql security invoker set search_path = '' as $$
  select app.settle_refund(p_refund_id, p_provider_refund_id, p_provider);
$$;
create function public.open_payment_dispute(p_payment_id uuid, p_provider_dispute_id text, p_amount bigint)
returns uuid language sql security invoker set search_path = '' as $$
  select app.open_payment_dispute(p_payment_id, p_provider_dispute_id, p_amount);
$$;
create function public.issue_credit_note(p_invoice_id uuid, p_amount_cents bigint, p_reason text)
returns uuid language sql security invoker set search_path = '' as $$
  select app.issue_credit_note(p_invoice_id, p_amount_cents, p_reason);
$$;
create function public.create_installment_plan(p_invoice_id uuid, p_count integer)
returns uuid language sql security invoker set search_path = '' as $$
  select app.create_installment_plan(p_invoice_id, p_count);
$$;
create function public.cancel_installment_plan(p_plan_id uuid)
returns void language sql security invoker set search_path = '' as $$
  select app.cancel_installment_plan(p_plan_id);
$$;
create function public.set_tax_rate(p_code text, p_label text, p_rate_bps integer, p_effective_from date)
returns uuid language sql security invoker set search_path = '' as $$
  select app.set_tax_rate(p_code, p_label, p_rate_bps, p_effective_from);
$$;
create function public.record_time_entry(p_matter_id uuid, p_minutes integer, p_rate_cents bigint, p_memo text)
returns uuid language sql security invoker set search_path = '' as $$
  select app.record_time_entry(p_matter_id, p_minutes, p_rate_cents, p_memo);
$$;
create function public.upsert_processor_account(p_stripe_account_id text)
returns uuid language sql security invoker set search_path = '' as $$
  select app.upsert_processor_account(p_stripe_account_id);
$$;
create function public.select_firm_plan(p_plan_code text, p_interval text)
returns jsonb language sql security invoker set search_path = '' as $$
  select app.select_firm_plan(p_plan_code, p_interval);
$$;
create function public.billing_plan_amount(p_code text, p_interval text)
returns bigint language sql security invoker set search_path = '' as $$
  select app.plan_amount_cents(p_code, p_interval);
$$;
create function public.billing_plan_catalog()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select case
    when app.current_organization_id() is null then null
    else (select value from public.product_settings where key = 'billing.plans')
  end;
$$;
create function public.record_reconciliation(p_period_start date, p_period_end date, p_statement_cents bigint, p_processor_balance_cents bigint)
returns uuid language sql security invoker set search_path = '' as $$
  select app.record_reconciliation(p_period_start, p_period_end, p_statement_cents, p_processor_balance_cents);
$$;
create function public.finance_snapshot(p_matter_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select app.finance_snapshot(p_matter_id);
$$;
create function public.portal_finance_snapshot()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select app.portal_finance_snapshot();
$$;
create function public.billing_document_pdf(p_id uuid)
returns bytea language sql stable security invoker set search_path = '' as $$
  select app.billing_document_pdf(p_id);
$$;
create function public.receipt_pdf(p_id uuid)
returns bytea language sql stable security invoker set search_path = '' as $$
  select app.receipt_pdf(p_id);
$$;
create function public.record_stripe_event(p_event_id text, p_account_id text, p_event_type text, p_payload jsonb, p_organization_id uuid)
returns text language sql security invoker set search_path = '' as $$
  select app.record_stripe_event(p_event_id, p_account_id, p_event_type, p_payload, p_organization_id);
$$;

-- Triggers
create trigger tax_rates_touch before update on public.tax_rates
  for each row execute function app.touch_row();
create trigger tax_rates_stamp before insert on public.tax_rates
  for each row execute function app.stamp_created_by();
create trigger tax_rates_audit after insert or update or delete on public.tax_rates
  for each row execute function app.audit_row_change();
create trigger invoice_counters_touch before update on public.invoice_counters
  for each row execute function app.touch_row();
create trigger invoice_counters_stamp before insert on public.invoice_counters
  for each row execute function app.stamp_created_by();
create trigger invoice_counters_audit after insert or update or delete on public.invoice_counters
  for each row execute function app.audit_row_change();
create trigger invoices_touch before update on public.invoices
  for each row execute function app.touch_row();
create trigger invoices_stamp before insert on public.invoices
  for each row execute function app.stamp_created_by();
create trigger invoices_guard before update on public.invoices
  for each row execute function app.guard_issued_invoice();
create trigger invoices_audit after insert or update or delete on public.invoices
  for each row execute function app.audit_row_change('pdf');
create trigger invoice_lines_touch before update on public.invoice_lines
  for each row execute function app.touch_row();
create trigger invoice_lines_stamp before insert on public.invoice_lines
  for each row execute function app.stamp_created_by();
create trigger invoice_lines_guard before update or delete on public.invoice_lines
  for each row execute function app.guard_invoice_line();
create trigger invoice_lines_audit after insert or update or delete on public.invoice_lines
  for each row execute function app.audit_row_change();
create trigger time_entries_touch before update on public.time_entries
  for each row execute function app.touch_row();
create trigger time_entries_stamp before insert on public.time_entries
  for each row execute function app.stamp_created_by();
create trigger time_entries_audit after insert or update or delete on public.time_entries
  for each row execute function app.audit_row_change();
create trigger payments_touch before update on public.payments
  for each row execute function app.touch_row();
create trigger payments_stamp before insert on public.payments
  for each row execute function app.stamp_created_by();
create trigger payments_audit after insert or update or delete on public.payments
  for each row execute function app.audit_row_change();
create trigger ledger_accounts_touch before update on public.ledger_accounts
  for each row execute function app.touch_row();
create trigger ledger_accounts_stamp before insert on public.ledger_accounts
  for each row execute function app.stamp_created_by();
create trigger ledger_accounts_audit after insert or update or delete on public.ledger_accounts
  for each row execute function app.audit_row_change();
create trigger journal_entries_stamp before insert on public.journal_entries
  for each row execute function app.stamp_created_by();
create trigger journal_entries_guard before update or delete on public.journal_entries
  for each row execute function app.reject_posted_journal_edit();
create trigger journal_entries_audit after insert or delete on public.journal_entries
  for each row execute function app.audit_row_change();
create trigger journal_lines_stamp before insert on public.journal_lines
  for each row execute function app.stamp_created_by();
create trigger journal_lines_guard before update or delete on public.journal_lines
  for each row execute function app.reject_posted_journal_edit();
create trigger journal_lines_audit after insert or delete on public.journal_lines
  for each row execute function app.audit_row_change();
create trigger payment_allocations_stamp before insert on public.payment_allocations
  for each row execute function app.stamp_created_by();
create trigger payment_allocations_audit after insert or delete on public.payment_allocations
  for each row execute function app.audit_row_change();
create trigger receipts_stamp before insert on public.receipts
  for each row execute function app.stamp_created_by();
create trigger receipts_guard before update or delete on public.receipts
  for each row execute function app.reject_receipt_edit();
create trigger receipts_audit after insert on public.receipts
  for each row execute function app.audit_row_change('pdf');
create trigger credit_notes_touch before update on public.credit_notes
  for each row execute function app.touch_row();
create trigger credit_notes_stamp before insert on public.credit_notes
  for each row execute function app.stamp_created_by();
create trigger credit_notes_audit after insert or update or delete on public.credit_notes
  for each row execute function app.audit_row_change();
create trigger refunds_touch before update on public.refunds
  for each row execute function app.touch_row();
create trigger refunds_stamp before insert on public.refunds
  for each row execute function app.stamp_created_by();
create trigger refunds_audit after insert or update or delete on public.refunds
  for each row execute function app.audit_row_change();
create trigger payment_disputes_touch before update on public.payment_disputes
  for each row execute function app.touch_row();
create trigger payment_disputes_stamp before insert on public.payment_disputes
  for each row execute function app.stamp_created_by();
create trigger payment_disputes_audit after insert or update or delete on public.payment_disputes
  for each row execute function app.audit_row_change();
create trigger installment_plans_touch before update on public.installment_plans
  for each row execute function app.touch_row();
create trigger installment_plans_stamp before insert on public.installment_plans
  for each row execute function app.stamp_created_by();
create trigger installment_plans_audit after insert or update or delete on public.installment_plans
  for each row execute function app.audit_row_change();
create trigger installments_touch before update on public.installments
  for each row execute function app.touch_row();
create trigger installments_stamp before insert on public.installments
  for each row execute function app.stamp_created_by();
create trigger installments_audit after insert or update or delete on public.installments
  for each row execute function app.audit_row_change();
create trigger earned_fee_transfers_touch before update on public.earned_fee_transfers
  for each row execute function app.touch_row();
create trigger earned_fee_transfers_stamp before insert on public.earned_fee_transfers
  for each row execute function app.stamp_created_by();
create trigger earned_fee_transfers_audit after insert or update or delete on public.earned_fee_transfers
  for each row execute function app.audit_row_change();
create trigger processor_accounts_touch before update on public.processor_accounts
  for each row execute function app.touch_row();
create trigger processor_accounts_stamp before insert on public.processor_accounts
  for each row execute function app.stamp_created_by();
create trigger processor_accounts_audit after insert or update or delete on public.processor_accounts
  for each row execute function app.audit_row_change();
create trigger reconciliation_periods_touch before update on public.reconciliation_periods
  for each row execute function app.touch_row();
create trigger reconciliation_periods_stamp before insert on public.reconciliation_periods
  for each row execute function app.stamp_created_by();
create trigger reconciliation_periods_audit after insert or update or delete on public.reconciliation_periods
  for each row execute function app.audit_row_change();
create trigger reconciliation_exceptions_stamp before insert on public.reconciliation_exceptions
  for each row execute function app.stamp_created_by();
create trigger reconciliation_exceptions_audit after insert or delete on public.reconciliation_exceptions
  for each row execute function app.audit_row_change();

-- Grants
revoke all on table public.tax_rates from anon, authenticated, service_role;
revoke all on table public.invoice_counters from anon, authenticated, service_role;
revoke all on table public.invoices from anon, authenticated, service_role;
revoke all on table public.invoice_lines from anon, authenticated, service_role;
revoke all on table public.time_entries from anon, authenticated, service_role;
revoke all on table public.payments from anon, authenticated, service_role;
revoke all on table public.ledger_accounts from anon, authenticated, service_role;
revoke all on table public.journal_entries from anon, authenticated, service_role;
revoke all on table public.journal_lines from anon, authenticated, service_role;
revoke all on table public.payment_allocations from anon, authenticated, service_role;
revoke all on table public.receipts from anon, authenticated, service_role;
revoke all on table public.credit_notes from anon, authenticated, service_role;
revoke all on table public.refunds from anon, authenticated, service_role;
revoke all on table public.payment_disputes from anon, authenticated, service_role;
revoke all on table public.installment_plans from anon, authenticated, service_role;
revoke all on table public.installments from anon, authenticated, service_role;
revoke all on table public.earned_fee_transfers from anon, authenticated, service_role;
revoke all on table public.processor_accounts from anon, authenticated, service_role;
revoke all on table public.reconciliation_periods from anon, authenticated, service_role;
revoke all on table public.reconciliation_exceptions from anon, authenticated, service_role;
grant select on table public.tax_rates to authenticated;
grant select on table public.invoice_counters to authenticated;
grant select on table public.invoices to authenticated;
grant select on table public.invoice_lines to authenticated;
grant select on table public.time_entries to authenticated;
grant select on table public.payments to authenticated;
grant select on table public.ledger_accounts to authenticated;
grant select on table public.journal_entries to authenticated;
grant select on table public.journal_lines to authenticated;
grant select on table public.payment_allocations to authenticated;
grant select on table public.receipts to authenticated;
grant select on table public.credit_notes to authenticated;
grant select on table public.refunds to authenticated;
grant select on table public.payment_disputes to authenticated;
grant select on table public.installment_plans to authenticated;
grant select on table public.installments to authenticated;
grant select on table public.earned_fee_transfers to authenticated;
grant select on table public.processor_accounts to authenticated;
grant select on table public.reconciliation_periods to authenticated;
grant select on table public.reconciliation_exceptions to authenticated;

do $grant$
declare
  fn text;
begin
  foreach fn in array array[
    'public.create_billing_document(uuid, uuid, public.billing_document_kind, jsonb, text, date, text, text)',
    'public.issue_billing_document(uuid, text)',
    'public.record_manual_payment(uuid, bigint, public.payment_method_kind, text, date, text, text)',
    'public.verify_manual_payment(uuid)',
    'public.reserve_card_payment(uuid)',
    'public.attach_payment_intent(uuid, text)',
    'public.propose_earned_transfer(uuid, bigint, text)',
    'public.approve_earned_transfer(uuid, text)',
    'public.client_funds_cents(uuid, uuid, text)',
    'public.earned_fee_cents(uuid, uuid, text)',
    'public.request_refund(uuid, bigint, text)',
    'public.approve_refund(uuid)',
    'public.open_payment_dispute(uuid, text, bigint)',
    'public.issue_credit_note(uuid, bigint, text)',
    'public.create_installment_plan(uuid, integer)',
    'public.cancel_installment_plan(uuid)',
    'public.set_tax_rate(text, text, integer, date)',
    'public.record_time_entry(uuid, integer, bigint, text)',
    'public.upsert_processor_account(text)',
    'public.select_firm_plan(text, text)',
    'public.billing_plan_amount(text, text)',
    'public.billing_plan_catalog()',
    'public.record_reconciliation(date, date, bigint, bigint)',
    'public.finance_snapshot(uuid)',
    'public.portal_finance_snapshot()',
    'public.billing_document_pdf(uuid)',
    'public.receipt_pdf(uuid)'
  ]
  loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated, service_role', fn);
  end loop;
  -- Wrappers are invoker, so the caller also needs execute on the app function.
  foreach fn in array array[
    'app.create_billing_document(uuid, uuid, public.billing_document_kind, jsonb, text, date, text, text)',
    'app.issue_billing_document(uuid, text)',
    'app.record_manual_payment(uuid, bigint, public.payment_method_kind, text, date, text, text)',
    'app.verify_manual_payment(uuid)',
    'app.reserve_card_payment(uuid)',
    'app.attach_payment_intent(uuid, text)',
    'app.propose_earned_transfer(uuid, bigint, text)',
    'app.approve_earned_transfer(uuid, text)',
    'app.client_funds_cents(uuid, uuid, uuid, text)',
    'app.earned_fee_cents(uuid, uuid, uuid, text)',
    'app.request_refund(uuid, bigint, text)',
    'app.approve_refund(uuid)',
    'app.open_payment_dispute(uuid, text, bigint)',
    'app.issue_credit_note(uuid, bigint, text)',
    'app.create_installment_plan(uuid, integer)',
    'app.cancel_installment_plan(uuid)',
    'app.set_tax_rate(text, text, integer, date)',
    'app.record_time_entry(uuid, integer, bigint, text)',
    'app.upsert_processor_account(text)',
    'app.select_firm_plan(text, text)',
    'app.plan_amount_cents(text, text)',
    'app.record_reconciliation(date, date, bigint, bigint)',
    'app.finance_snapshot(uuid)',
    'app.portal_finance_snapshot()',
    'app.billing_document_pdf(uuid)',
    'app.receipt_pdf(uuid)',
    'app.can_read_invoice(uuid)'
  ]
  loop
    execute format('grant execute on function %s to authenticated, service_role', fn);
  end loop;
  execute 'revoke all on function public.settle_refund(uuid, text, text) from public, anon, authenticated';
  execute 'grant execute on function public.settle_refund(uuid, text, text) to service_role';
  execute 'grant execute on function app.settle_refund(uuid, text, text) to service_role';
  execute 'revoke all on function public.record_stripe_event(text, text, text, jsonb, uuid) from public, anon, authenticated';
  execute 'grant execute on function public.record_stripe_event(text, text, text, jsonb, uuid) to service_role';
  execute 'grant execute on function app.record_stripe_event(text, text, text, jsonb, uuid) to service_role';
end
$grant$;

-- RLS. Every policy is scoped with app.current_organization_id().
alter table public.tax_rates enable row level security;
alter table public.tax_rates force row level security;
alter table public.invoice_counters enable row level security;
alter table public.invoice_counters force row level security;
alter table public.invoices enable row level security;
alter table public.invoices force row level security;
alter table public.invoice_lines enable row level security;
alter table public.invoice_lines force row level security;
alter table public.time_entries enable row level security;
alter table public.time_entries force row level security;
alter table public.payments enable row level security;
alter table public.payments force row level security;
alter table public.ledger_accounts enable row level security;
alter table public.ledger_accounts force row level security;
alter table public.journal_entries enable row level security;
alter table public.journal_entries force row level security;
alter table public.journal_lines enable row level security;
alter table public.journal_lines force row level security;
alter table public.payment_allocations enable row level security;
alter table public.payment_allocations force row level security;
alter table public.receipts enable row level security;
alter table public.receipts force row level security;
alter table public.credit_notes enable row level security;
alter table public.credit_notes force row level security;
alter table public.refunds enable row level security;
alter table public.refunds force row level security;
alter table public.payment_disputes enable row level security;
alter table public.payment_disputes force row level security;
alter table public.installment_plans enable row level security;
alter table public.installment_plans force row level security;
alter table public.installments enable row level security;
alter table public.installments force row level security;
alter table public.earned_fee_transfers enable row level security;
alter table public.earned_fee_transfers force row level security;
alter table public.processor_accounts enable row level security;
alter table public.processor_accounts force row level security;
alter table public.reconciliation_periods enable row level security;
alter table public.reconciliation_periods force row level security;
alter table public.reconciliation_exceptions enable row level security;
alter table public.reconciliation_exceptions force row level security;

create policy tax_rates_select on public.tax_rates
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.staff_mfa_satisfied())
    and (select app.has_org_role(organization_id, array['firm_owner', 'finance_user']::public.org_role[]))
  );
create policy invoice_counters_select on public.invoice_counters
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.staff_mfa_satisfied())
    and (select app.has_org_role(organization_id, array['firm_owner', 'finance_user']::public.org_role[]))
  );
create policy invoices_select on public.invoices
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.can_read_invoice(id))
  );
create policy invoice_lines_select on public.invoice_lines
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.can_read_invoice(invoice_id))
  );
create policy time_entries_select on public.time_entries
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.can_read_matter_billing(matter_id))
  );
create policy payments_select on public.payments
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (
      (invoice_id is not null and (select app.can_read_invoice(invoice_id)))
      or (select app.has_org_role(organization_id, array['firm_owner', 'finance_user']::public.org_role[]))
    )
  );
create policy ledger_accounts_select on public.ledger_accounts
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.staff_mfa_satisfied())
    and (
      (matter_id is not null and (select app.can_read_matter_billing(matter_id)))
      or (select app.has_org_role(organization_id, array['firm_owner', 'finance_user']::public.org_role[]))
    )
  );
create policy journal_entries_select on public.journal_entries
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.staff_mfa_satisfied())
    and (select app.has_org_role(organization_id, array['firm_owner', 'finance_user']::public.org_role[]))
  );
create policy journal_lines_select on public.journal_lines
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.staff_mfa_satisfied())
    and (select app.has_org_role(organization_id, array['firm_owner', 'finance_user']::public.org_role[]))
  );
create policy payment_allocations_select on public.payment_allocations
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (
      (invoice_id is not null and (select app.can_read_invoice(invoice_id)))
      or (select app.has_org_role(organization_id, array['firm_owner', 'finance_user']::public.org_role[]))
    )
  );
create policy receipts_select on public.receipts
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and invoice_id is not null
    and (select app.can_read_invoice(invoice_id))
  );
create policy credit_notes_select on public.credit_notes
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.can_read_invoice(invoice_id))
  );
create policy refunds_select on public.refunds
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.staff_mfa_satisfied())
    and (select app.has_org_role(organization_id, array['firm_owner', 'finance_user']::public.org_role[]))
  );
create policy payment_disputes_select on public.payment_disputes
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.staff_mfa_satisfied())
    and (select app.has_org_role(organization_id, array['firm_owner', 'finance_user']::public.org_role[]))
  );
create policy installment_plans_select on public.installment_plans
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.can_read_invoice(invoice_id))
  );
create policy installments_select on public.installments
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.can_read_invoice(invoice_id))
  );
create policy earned_fee_transfers_select on public.earned_fee_transfers
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.can_read_matter_billing(matter_id))
  );
create policy processor_accounts_select on public.processor_accounts
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.staff_mfa_satisfied())
    and (select app.has_org_role(organization_id, array['firm_owner', 'finance_user']::public.org_role[]))
  );
create policy reconciliation_periods_select on public.reconciliation_periods
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.staff_mfa_satisfied())
    and (select app.has_org_role(organization_id, array['firm_owner', 'finance_user']::public.org_role[]))
  );
create policy reconciliation_exceptions_select on public.reconciliation_exceptions
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.staff_mfa_satisfied())
    and (select app.has_org_role(organization_id, array['firm_owner', 'finance_user']::public.org_role[]))
  );
