-- Billing types, time, write-offs, tax rates, instalments and government fees (FIN-06).
--
-- 1. Tax rates (public.tax_rates). Effective-dated and chosen by the firm: name ("HST Ontario"),
--    rate in percent (up to four decimals, so 9.975 fits), effective from / to (inclusive), who
--    approved it (the firm or its accountant, typed by name) and an optional source note (a CRA
--    page, for instance). Nothing is seeded: Casevoya never picks a rate. Added by the firm owner
--    or a finance user with a recent step-up; a rate is never edited, only ended (effective_to),
--    and two rates with the same name never overlap. An invoice line keeps the rate it used.
-- 2. Invoice lines (public.invoice_lines). A draft invoice made here is built from lines:
--    professional fees (time, a quote line, an instalment), disbursements and government fees.
--    invoices.amount_cents is the sum of the lines plus their tax, recomputed by these functions
--    while the invoice is a draft. Issuing a draft (public.issue_invoice_draft) applies, for each
--    taxed line, the rate of that name in effect on the invoice date (the firm's today); with no
--    rate in effect it refuses. Lines change only while their invoice is a draft. Invoices made by
--    the existing public.create_invoice keep their single amount and have no lines.
--    A draft is discarded with a reason (new invoices.discarded_at, discarded_by, discard_reason;
--    it stays a draft, so it is never mailed or shown to the client): its time entries and
--    instalments become billable again; the number stays used, like a voided invoice's.
-- 3. Time entries (public.time_entries). Staff on a matter (the firm owner, or assigned
--    consultant, case manager or assistant) log time (date, minutes, rate in cents per hour,
--    description, billable) or start and stop a timer (one running timer per person; stopping
--    rounds to the nearest whole minute, at least 1, at most 24 hours). Unbilled billable time is
--    pulled into an earned-fee draft invoice by billing staff (public.create_time_invoice).
--    Rounding rule: a line's amount is minutes x rate / 60, rounded half away from zero to whole
--    cents (Postgres numeric round): 90 min at 15000 c/h = 22500 c; 7 min at 10000 c/h = 1167 c.
--    An entry is billed while a line on an invoice that is neither voided nor a discarded draft points to it.
-- 4. Write-offs (public.invoice_write_offs). Billing staff (firm owner or the matter's finance
--    user) with a recent step-up reduce an issued invoice's balance with a reason. Not a credit
--    note: no CN number, no document to the client, no second approver. The amount is added to
--    invoices.credited_cents (so every existing "amount due" rule, card checkout and client-funds
--    transfer, already leaves it out without redefining those functions) and to the new
--    invoices.written_off_cents, which says how much of credited_cents is written off.
--    Audited as invoice.written_off.
-- 5. Quotes and instalments, wired from the existing Quote builder (quote_lines,
--    quote_instalments). For an accepted quote, billing staff either make one draft invoice from
--    its professional fee and disbursement lines (public.create_quote_invoice; the quote's own tax
--    lines are replaced by the firm's effective-dated rate, and government fee lines are not
--    carried: they are added with their source), or set up an instalment plan
--    (public.instalment_plans, public.instalment_plan_items) with a due date per quote instalment.
--    Each instalment gets an internal reminder task due that day, owned by the person who set up
--    the plan (no email: there is no approved design). An instalment paid as an invoice after
--    delivery is invoiced as a draft (public.invoice_instalment); an advance instalment is a
--    request for client-account money (FIN-03) and is never invoiced. A plan can be cancelled
--    with a reason: its open reminder tasks are cancelled. A quote is invoiced one way only.
-- 6. Government fees (FIN-06, RULES). Never invented. A government fee line on a draft invoice
--    is a disbursement that stores its name, amount, official source URL (an allowlisted
--    Government of Canada host) and the date staff checked it. Staff may pick it from the firm's
--    fee reference catalogue (public.government_fee_references): the server fetches IRCC's fee
--    list (https://ircc.canada.ca/english/information/fees/fees.asp) and records each fee's name,
--    amount, URL with its section anchor, the retrieval time and the page's SHA-256; those rows are
--    pending review until a licensed member of the firm (step-up) approves that snapshot. Only
--    approved rows can be picked. Nothing is seeded.
--
-- No existing function is redefined. Forced RLS on every new table; reads follow
-- app.can_read_invoice / app.can_read_matter_billing / matter staff; writes only through the
-- SECURITY DEFINER functions here (no insert, update or delete grants). Dates are the firm's
-- (app.firm_today). Money is integer cents, CAD. Additive only.

-- ---------------------------------------------------------------------------
-- Tax rates
-- ---------------------------------------------------------------------------

create table public.tax_rates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  name text not null check (length(btrim(name)) between 1 and 80),
  rate_percent numeric(7, 4) not null check (rate_percent >= 0 and rate_percent <= 100),
  effective_from date not null,
  effective_to date,
  approved_by text not null check (length(btrim(approved_by)) between 2 and 200),
  source_note text check (source_note is null or length(btrim(source_note)) between 3 and 500),
  ended_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id),
  check (effective_to is null or effective_to >= effective_from)
);
comment on table public.tax_rates is
  'Tax rates the firm (or its accountant) chose, effective-dated. Never seeded. A rate is ended, never edited; same-name rates never overlap.';
create index tax_rates_org_name_idx on public.tax_rates (organization_id, name, effective_from);
create index tax_rates_created_by_idx on public.tax_rates (created_by);
create index tax_rates_ended_by_idx on public.tax_rates (ended_by);

-- ---------------------------------------------------------------------------
-- Government fee reference catalogue (per firm)
-- ---------------------------------------------------------------------------

create table public.government_fee_references (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  position integer not null check (position between 1 and 500),
  section text check (section is null or length(btrim(section)) between 1 and 200),
  fee_group text check (fee_group is null or length(btrim(fee_group)) between 1 and 300),
  name text not null check (length(btrim(name)) between 1 and 300),
  amount_cents bigint not null check (amount_cents between 0 and 100000000),
  currency text not null default 'CAD' check (currency = 'CAD'),
  source_url text not null check (length(source_url) between 12 and 500),
  retrieved_at timestamptz not null,
  snapshot_sha256 text not null check (snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending_review' check (status in ('pending_review', 'approved', 'rejected', 'superseded')),
  reviewed_by uuid references auth.users (id),
  reviewed_at timestamptz,
  review_note text check (review_note is null or length(btrim(review_note)) between 3 and 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id),
  unique (organization_id, snapshot_sha256, position),
  check (status not in ('approved', 'rejected') or (reviewed_by is not null and reviewed_at is not null))
);
comment on table public.government_fee_references is
  'Fees read from IRCC''s fee list by the server: name, amount, source URL, retrieval time and page SHA-256. Pending until a licensed member approves the snapshot. Never seeded.';
create index government_fee_references_org_status_idx on public.government_fee_references (organization_id, status);
create index government_fee_references_reviewed_by_idx on public.government_fee_references (reviewed_by);
create index government_fee_references_created_by_idx on public.government_fee_references (created_by);

-- ---------------------------------------------------------------------------
-- Time entries
-- ---------------------------------------------------------------------------

create table public.time_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  matter_id uuid not null,
  membership_id uuid not null,
  worked_on date not null,
  minutes integer check (minutes is null or minutes between 1 and 1440),
  started_at timestamptz,
  stopped_at timestamptz,
  rate_cents bigint not null check (rate_cents between 0 and 10000000),
  description text not null check (length(btrim(description)) between 1 and 500),
  billable boolean not null default true,
  discarded_at timestamptz,
  discarded_by uuid references auth.users (id),
  is_sample boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id),
  check (minutes is not null or (started_at is not null and stopped_at is null)),
  check (stopped_at is null or (started_at is not null and stopped_at >= started_at)),
  check ((discarded_at is null) = (discarded_by is null)),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id),
  foreign key (membership_id, organization_id) references public.memberships (id, organization_id)
);
comment on table public.time_entries is
  'Time logged on a matter, or a running timer (minutes null). Rate in cents per hour. Billed while an invoice line that is neither voided nor a discarded draft points to it.';
create index time_entries_matter_org_fk_idx on public.time_entries (matter_id, organization_id);
create index time_entries_membership_org_fk_idx on public.time_entries (membership_id, organization_id);
create index time_entries_org_fk_idx on public.time_entries (organization_id, worked_on desc);
create index time_entries_created_by_idx on public.time_entries (created_by);
create index time_entries_discarded_by_idx on public.time_entries (discarded_by);
create unique index time_entries_one_timer_idx on public.time_entries (membership_id)
  where minutes is null and discarded_at is null;

-- ---------------------------------------------------------------------------
-- Instalment plans
-- ---------------------------------------------------------------------------

create table public.instalment_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  matter_id uuid not null,
  agreement_id uuid not null,
  agreement_version_id uuid not null,
  status text not null default 'active' check (status in ('active', 'cancelled')),
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users (id),
  cancel_reason text check (cancel_reason is null or length(btrim(cancel_reason)) between 3 and 500),
  is_sample boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id),
  check (status <> 'cancelled' or (cancelled_at is not null and cancelled_by is not null and cancel_reason is not null)),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id),
  foreign key (agreement_id, organization_id) references public.agreements (id, organization_id),
  foreign key (agreement_version_id, organization_id) references public.agreement_versions (id, organization_id)
);
comment on table public.instalment_plans is
  'Dated instalments for an accepted quote (its quote_instalments). One active plan per quote.';
create index instalment_plans_matter_org_fk_idx on public.instalment_plans (matter_id, organization_id);
create index instalment_plans_agreement_org_fk_idx on public.instalment_plans (agreement_id, organization_id);
create index instalment_plans_version_org_fk_idx on public.instalment_plans (agreement_version_id, organization_id);
create index instalment_plans_org_fk_idx on public.instalment_plans (organization_id);
create index instalment_plans_cancelled_by_idx on public.instalment_plans (cancelled_by);
create index instalment_plans_created_by_idx on public.instalment_plans (created_by);
create unique index instalment_plans_one_active_idx on public.instalment_plans (agreement_id) where status = 'active';

create table public.instalment_plan_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  plan_id uuid not null,
  position integer not null check (position between 1 and 12),
  label text not null check (length(btrim(label)) between 1 and 200),
  amount_cents bigint not null check (amount_cents between 0 and 100000000000),
  paid_as text not null check (paid_as in ('advance', 'invoice_after_delivery')),
  due_on date not null,
  quote_instalment_id uuid not null,
  task_id uuid,
  created_at timestamptz not null default now(),
  unique (plan_id, position),
  unique (id, organization_id),
  foreign key (plan_id, organization_id) references public.instalment_plans (id, organization_id),
  foreign key (quote_instalment_id, organization_id) references public.quote_instalments (id, organization_id),
  foreign key (task_id, organization_id) references public.tasks (id, organization_id)
);
comment on table public.instalment_plan_items is
  'One dated instalment, copied from the quote, with its reminder task. Invoiced while an invoice line that is neither voided nor a discarded draft points to it.';
create index instalment_plan_items_plan_org_fk_idx on public.instalment_plan_items (plan_id, organization_id);
create index instalment_plan_items_quote_org_fk_idx on public.instalment_plan_items (quote_instalment_id, organization_id);
create index instalment_plan_items_task_org_fk_idx on public.instalment_plan_items (task_id, organization_id);
create index instalment_plan_items_org_fk_idx on public.instalment_plan_items (organization_id, due_on);

-- ---------------------------------------------------------------------------
-- Invoice lines and write-offs
-- ---------------------------------------------------------------------------

alter table public.invoices add column written_off_cents bigint not null default 0;
alter table public.invoices add constraint invoices_written_off_within_credited
  check (written_off_cents >= 0 and written_off_cents <= credited_cents);
comment on column public.invoices.written_off_cents is
  'The part of credited_cents that was written off (public.invoice_write_offs), not credited by a credit note.';

-- A discarded draft stays a draft on record (never issued, never mailed, never shown to the client).
alter table public.invoices add column discarded_at timestamptz;
alter table public.invoices add column discarded_by uuid references auth.users (id);
alter table public.invoices add column discard_reason text
  check (discard_reason is null or length(btrim(discard_reason)) between 3 and 500);
alter table public.invoices add constraint invoices_discarded_shape
  check (discarded_at is null or (status = 'draft' and discarded_by is not null and discard_reason is not null));
create index invoices_discarded_by_idx on public.invoices (discarded_by);
comment on column public.invoices.discarded_at is
  'A draft discarded with a reason (public.discard_invoice_draft). It stays a draft on record; its time and instalments are billable again.';

create table public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  invoice_id uuid not null,
  position integer not null check (position between 1 and 200),
  category text not null check (category in ('professional_fee', 'disbursement', 'government_fee')),
  description text not null check (length(btrim(description)) between 1 and 300),
  minutes integer check (minutes is null or minutes between 1 and 1440),
  rate_cents bigint check (rate_cents is null or rate_cents between 0 and 10000000),
  amount_cents bigint not null check (amount_cents between 0 and 99999999999),
  tax_name text check (tax_name is null or length(btrim(tax_name)) between 1 and 80),
  tax_rate_id uuid,
  tax_rate_percent numeric(7, 4) check (tax_rate_percent is null or (tax_rate_percent >= 0 and tax_rate_percent <= 100)),
  tax_cents bigint not null default 0 check (tax_cents >= 0),
  time_entry_id uuid,
  quote_line_id uuid,
  instalment_item_id uuid,
  fee_reference_id uuid,
  source_url text check (source_url is null or length(source_url) between 12 and 500),
  source_checked_on date,
  source_retrieved_at timestamptz,
  source_sha256 text check (source_sha256 is null or source_sha256 ~ '^[0-9a-f]{64}$'),
  is_sample boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  unique (invoice_id, position),
  unique (id, organization_id),
  check (tax_name is not null or (tax_rate_id is null and tax_rate_percent is null and tax_cents = 0)),
  check (category <> 'government_fee' or (source_url is not null and source_checked_on is not null)),
  check ((minutes is null) = (rate_cents is null)),
  foreign key (invoice_id, organization_id) references public.invoices (id, organization_id),
  foreign key (tax_rate_id, organization_id) references public.tax_rates (id, organization_id),
  foreign key (time_entry_id, organization_id) references public.time_entries (id, organization_id),
  foreign key (quote_line_id, organization_id) references public.quote_lines (id, organization_id),
  foreign key (instalment_item_id, organization_id) references public.instalment_plan_items (id, organization_id),
  foreign key (fee_reference_id, organization_id) references public.government_fee_references (id, organization_id)
);
comment on table public.invoice_lines is
  'Lines of an invoice drafted from time, a quote, an instalment or a government fee. Change only while the invoice is a draft. Tax uses the firm''s rate in effect on the invoice date.';
create index invoice_lines_invoice_org_fk_idx on public.invoice_lines (invoice_id, organization_id);
create index invoice_lines_org_fk_idx on public.invoice_lines (organization_id);
create index invoice_lines_tax_rate_org_fk_idx on public.invoice_lines (tax_rate_id, organization_id);
create index invoice_lines_time_entry_org_fk_idx on public.invoice_lines (time_entry_id, organization_id);
create index invoice_lines_quote_line_org_fk_idx on public.invoice_lines (quote_line_id, organization_id);
create index invoice_lines_instalment_org_fk_idx on public.invoice_lines (instalment_item_id, organization_id);
create index invoice_lines_fee_reference_org_fk_idx on public.invoice_lines (fee_reference_id, organization_id);
create index invoice_lines_created_by_idx on public.invoice_lines (created_by);

create table public.invoice_write_offs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  invoice_id uuid not null,
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 99999999999),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  reason text not null check (length(btrim(reason)) between 3 and 500),
  written_off_by uuid not null references auth.users (id),
  idempotency_key text not null check (length(idempotency_key) between 8 and 180),
  is_sample boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  unique (id, organization_id),
  unique (organization_id, idempotency_key),
  foreign key (invoice_id, organization_id) references public.invoices (id, organization_id)
);
comment on table public.invoice_write_offs is
  'Append-only. A balance written off an issued invoice, with a reason. Not a credit note.';
create index invoice_write_offs_invoice_org_fk_idx on public.invoice_write_offs (invoice_id, organization_id);
create index invoice_write_offs_org_fk_idx on public.invoice_write_offs (organization_id, created_at desc);
create index invoice_write_offs_by_idx on public.invoice_write_offs (written_off_by);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

create function app.reject_write_off_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'write-offs are append-only' using errcode = '42501';
end;
$$;
revoke all on function app.reject_write_off_change() from public, anon, authenticated;

-- Lines change only while their invoice is a draft (the issued invoice is immutable, FIN-07).
-- A discarded draft's lines stay as they were (the functions refuse it).
create function app.guard_invoice_line_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  invoice_status public.invoice_status;
begin
  select invoice.status into invoice_status
  from public.invoices invoice
  where invoice.id = coalesce(new.invoice_id, old.invoice_id);
  if invoice_status is distinct from 'draft' then
    raise exception 'an issued invoice''s lines can''t be changed' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
revoke all on function app.guard_invoice_line_change() from public, anon, authenticated;

create trigger tax_rates_touch before update on public.tax_rates
  for each row execute function app.touch_row();
create trigger tax_rates_stamp before insert on public.tax_rates
  for each row execute function app.stamp_created_by();
create trigger tax_rates_audit after insert or update or delete on public.tax_rates
  for each row execute function app.audit_row_change();
create trigger tax_rates_no_delete before delete on public.tax_rates
  for each row execute function app.reject_governed_delete();

create trigger government_fee_references_touch before update on public.government_fee_references
  for each row execute function app.touch_row();
create trigger government_fee_references_stamp before insert on public.government_fee_references
  for each row execute function app.stamp_created_by();
create trigger government_fee_references_no_delete before delete on public.government_fee_references
  for each row execute function app.reject_governed_delete();

create trigger time_entries_touch before update on public.time_entries
  for each row execute function app.touch_row();
create trigger time_entries_stamp before insert on public.time_entries
  for each row execute function app.stamp_created_by();
create trigger time_entries_audit after insert or update or delete on public.time_entries
  for each row execute function app.audit_row_change();
create trigger time_entries_no_delete before delete on public.time_entries
  for each row execute function app.reject_governed_delete();

create trigger instalment_plans_touch before update on public.instalment_plans
  for each row execute function app.touch_row();
create trigger instalment_plans_stamp before insert on public.instalment_plans
  for each row execute function app.stamp_created_by();
create trigger instalment_plans_audit after insert or update or delete on public.instalment_plans
  for each row execute function app.audit_row_change();
create trigger instalment_plans_no_delete before delete on public.instalment_plans
  for each row execute function app.reject_governed_delete();
create trigger instalment_plan_items_no_delete before delete on public.instalment_plan_items
  for each row execute function app.reject_governed_delete();

create trigger invoice_lines_stamp before insert on public.invoice_lines
  for each row execute function app.stamp_created_by();
create trigger invoice_lines_audit after insert or update or delete on public.invoice_lines
  for each row execute function app.audit_row_change();
create trigger invoice_lines_draft_only before insert or update or delete on public.invoice_lines
  for each row execute function app.guard_invoice_line_change();

create trigger invoice_write_offs_no_change before update or delete on public.invoice_write_offs
  for each row execute function app.reject_write_off_change();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- A time line's amount: minutes x cents per hour / 60, rounded half away from zero to whole cents.
create function app.time_amount_cents(p_minutes integer, p_rate_cents bigint)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select round((p_minutes::numeric * p_rate_cents::numeric) / 60)::bigint;
$$;
revoke all on function app.time_amount_cents(integer, bigint) from public, anon;
grant execute on function app.time_amount_cents(integer, bigint) to authenticated, service_role;

-- Tax on a line: amount x percent / 100, rounded half away from zero to whole cents.
create function app.tax_amount_cents(p_amount_cents bigint, p_rate_percent numeric)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select round((p_amount_cents::numeric * p_rate_percent) / 100)::bigint;
$$;
revoke all on function app.tax_amount_cents(bigint, numeric) from public, anon;
grant execute on function app.tax_amount_cents(bigint, numeric) to authenticated, service_role;

-- The firm's rate of this name in effect on a date (null when none).
create function app.tax_rate_on(p_org uuid, p_name text, p_on date)
returns public.tax_rates
language sql
stable
security definer
set search_path = ''
as $$
  select rate.*
  from public.tax_rates rate
  where rate.organization_id = p_org
    and lower(rate.name) = lower(btrim(p_name))
    and rate.effective_from <= p_on
    and (rate.effective_to is null or rate.effective_to >= p_on)
  order by rate.effective_from desc
  limit 1;
$$;
revoke all on function app.tax_rate_on(uuid, text, date) from public, anon;
grant execute on function app.tax_rate_on(uuid, text, date) to authenticated, service_role;

-- Firm staff who see the firm's tax rates and fee references.
create function app.can_read_billing_settings(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.in_active_org(p_org)
     and app.staff_mfa_satisfied()
     and app.is_org_staff(p_org);
$$;
revoke all on function app.can_read_billing_settings(uuid) from public, anon;
grant execute on function app.can_read_billing_settings(uuid) to authenticated, service_role;

-- Who logs time on a matter: the firm owner, or staff assigned to it (finance users read it).
create function app.can_log_matter_time(p_matter_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.matters matter
    where matter.id = p_matter_id
      and app.in_active_org(matter.organization_id)
      and app.staff_mfa_satisfied()
      and (
        app.actor_is_firm_owner(matter.organization_id)
        or app.actor_staff_assigned_to_matter(matter.id, matter.organization_id)
      )
  );
$$;
revoke all on function app.can_log_matter_time(uuid) from public, anon;
grant execute on function app.can_log_matter_time(uuid) to authenticated, service_role;

create function app.can_read_time_entry(p_matter_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.can_log_matter_time(p_matter_id) or app.can_read_matter_billing(p_matter_id);
$$;
revoke all on function app.can_read_time_entry(uuid) from public, anon;
grant execute on function app.can_read_time_entry(uuid) to authenticated, service_role;

-- The signed-in person's active staff membership in the firm.
create function app.actor_staff_membership(p_org uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select mem.id
  from public.memberships mem
  where mem.organization_id = p_org
    and mem.user_id = (select auth.uid())
    and mem.status = 'active'
    and mem.role = any (app.staff_roles())
  order by mem.created_at
  limit 1;
$$;
revoke all on function app.actor_staff_membership(uuid) from public, anon;
grant execute on function app.actor_staff_membership(uuid) to authenticated, service_role;

-- True while an invoice that is neither voided nor a discarded draft has a line for this time entry.
create function app.time_entry_billed(p_entry_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.invoice_lines line
    join public.invoices invoice on invoice.id = line.invoice_id
    where line.time_entry_id = p_entry_id
      and invoice.status <> 'voided' and invoice.discarded_at is null
  );
$$;
revoke all on function app.time_entry_billed(uuid) from public, anon;
grant execute on function app.time_entry_billed(uuid) to authenticated, service_role;

create function app.instalment_item_invoiced(p_item_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select invoice.id
  from public.invoice_lines line
  join public.invoices invoice on invoice.id = line.invoice_id
  where line.instalment_item_id = p_item_id
    and invoice.status <> 'voided' and invoice.discarded_at is null
  limit 1;
$$;
revoke all on function app.instalment_item_invoiced(uuid) from public, anon;
grant execute on function app.instalment_item_invoiced(uuid) to authenticated, service_role;

-- The firm's next invoice number (INV-0001), the way app.create_invoice numbers: one writer at a
-- time per firm, under the same advisory lock.
create function app.next_invoice_number(p_org uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_number integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('casevoya.invoice_number:' || p_org::text, 0));
  select coalesce(max(substring(invoice.number from 5)::integer), 0) + 1 into next_number
  from public.invoices invoice
  where invoice.organization_id = p_org;
  return 'INV-' || lpad(next_number::text, 4, '0');
end;
$$;
revoke all on function app.next_invoice_number(uuid) from public, anon, authenticated;

-- Billing staff check for a new draft on a matter; returns the matter.
create function app.require_draft_billing(p_matter_id uuid)
returns public.matters
language plpgsql
security definer
set search_path = ''
as $$
declare
  matter public.matters%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'sign in is required' using errcode = '42501';
  end if;
  select * into matter from public.matters where id = p_matter_id;
  if matter.id is null or app.can_perform_billing(matter.id, 'issue_invoice') is distinct from true then
    raise exception 'billing access denied' using errcode = '42501';
  end if;
  if app.sample_mode_blocks_real(matter.organization_id, matter.is_sample) then
    raise exception 'this firm is in sample mode; only sample matters take invoices' using errcode = '42501';
  end if;
  return matter;
end;
$$;
revoke all on function app.require_draft_billing(uuid) from public, anon, authenticated;

-- A new draft invoice shell (amount filled in by app.refresh_draft_amount once lines exist).
create function app.open_invoice_draft(
  p_matter public.matters,
  p_description text,
  p_due_on date,
  p_amount_cents bigint,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := app.firm_today(p_matter.organization_id);
  rid uuid;
begin
  if p_due_on is null or p_due_on < today then
    raise exception 'due date must be today or later' using errcode = '22023';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'there is nothing to invoice' using errcode = '22023';
  end if;
  insert into public.invoices (
    organization_id, matter_id, number, description, fee_category, amount_cents, currency,
    status, issued_on, due_on, is_sample, idempotency_key
  ) values (
    p_matter.organization_id, p_matter.id, app.next_invoice_number(p_matter.organization_id),
    left(btrim(p_description), 500), 'professional_fee', p_amount_cents, 'CAD',
    'draft', null, p_due_on, p_matter.is_sample, p_idempotency_key
  )
  returning id into rid;
  return rid;
end;
$$;
revoke all on function app.open_invoice_draft(public.matters, text, date, bigint, text) from public, anon, authenticated;

-- A draft's amount is its lines plus their tax.
create function app.refresh_draft_amount(p_invoice_id uuid)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  total bigint;
begin
  select coalesce(sum(line.amount_cents + line.tax_cents), 0) into total
  from public.invoice_lines line
  where line.invoice_id = p_invoice_id;
  if total <= 0 then
    raise exception 'an invoice needs an amount; discard the draft instead' using errcode = '22023';
  end if;
  update public.invoices set amount_cents = total where id = p_invoice_id and status = 'draft';
  return total;
end;
$$;
revoke all on function app.refresh_draft_amount(uuid) from public, anon, authenticated;

-- The rate for a tax name on the firm's today, or an error the page can show.
create function app.require_tax_rate(p_org uuid, p_name text, p_on date)
returns public.tax_rates
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  rate public.tax_rates%rowtype;
begin
  rate := app.tax_rate_on(p_org, p_name, p_on);
  if rate.id is null then
    raise exception 'no % tax rate is in effect on %', btrim(p_name), to_char(p_on, 'YYYY-MM-DD') using errcode = '22023';
  end if;
  return rate;
end;
$$;
revoke all on function app.require_tax_rate(uuid, text, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Tax rates (firm owner or finance user, recent step-up)
-- ---------------------------------------------------------------------------

create function app.add_tax_rate(
  p_org uuid,
  p_name text,
  p_rate_percent numeric,
  p_effective_from date,
  p_effective_to date,
  p_approved_by text,
  p_source_note text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_note text := nullif(btrim(coalesce(p_source_note, '')), '');
  rid uuid;
begin
  perform app.require_active_staff(p_org, array['firm_owner', 'finance_user']::public.org_role[], true);
  if length(v_name) not between 1 and 80 then
    raise exception 'a tax name is required' using errcode = '22023';
  end if;
  if p_rate_percent is null or p_rate_percent < 0 or p_rate_percent > 100 or p_rate_percent <> round(p_rate_percent, 4) then
    raise exception 'the rate must be a percent between 0 and 100, up to four decimals' using errcode = '22023';
  end if;
  if p_effective_from is null then
    raise exception 'an effective-from date is required' using errcode = '22023';
  end if;
  if p_effective_to is not null and p_effective_to < p_effective_from then
    raise exception 'the end date is before the start date' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_approved_by, ''))) not between 2 and 200 then
    raise exception 'say who approved this rate' using errcode = '22023';
  end if;
  if v_note is not null and length(v_note) not between 3 and 500 then
    raise exception 'the source note is too short or too long' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('casevoya.tax_rate:' || p_org::text || ':' || lower(v_name), 0));
  if exists (
    select 1 from public.tax_rates rate
    where rate.organization_id = p_org
      and lower(rate.name) = lower(v_name)
      and (rate.effective_to is null or rate.effective_to >= p_effective_from)
      and (p_effective_to is null or rate.effective_from <= p_effective_to)
  ) then
    raise exception 'a % rate already applies in that period; end it first', v_name using errcode = '23505';
  end if;
  insert into public.tax_rates (organization_id, name, rate_percent, effective_from, effective_to, approved_by, source_note)
  values (p_org, v_name, p_rate_percent, p_effective_from, p_effective_to, btrim(p_approved_by), v_note)
  returning id into rid;
  perform app.record_audit_event(
    p_org, 'finance.tax_rate_added', 'public.tax_rates', rid, 'success',
    jsonb_build_object('name', v_name, 'rate_percent', p_rate_percent, 'effective_from', p_effective_from, 'effective_to', p_effective_to)
  );
  return rid;
end;
$$;
revoke all on function app.add_tax_rate(uuid, text, numeric, date, date, text, text) from public, anon;

-- Ends a rate on a date (inclusive). It can be shortened, never before an issued invoice used it.
create function app.end_tax_rate(p_rate_id uuid, p_effective_to date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  rate public.tax_rates%rowtype;
  last_used date;
begin
  select * into rate from public.tax_rates where id = p_rate_id for update;
  if rate.id is null then
    raise exception 'tax rate not found' using errcode = '42501';
  end if;
  perform app.require_active_staff(rate.organization_id, array['firm_owner', 'finance_user']::public.org_role[], true);
  if p_effective_to is null or p_effective_to < rate.effective_from then
    raise exception 'the end date is before the start date' using errcode = '22023';
  end if;
  if rate.effective_to is not null and p_effective_to >= rate.effective_to then
    raise exception 'this rate already ends on or before that date' using errcode = '22023';
  end if;
  select max(invoice.issued_on) into last_used
  from public.invoice_lines line
  join public.invoices invoice on invoice.id = line.invoice_id
  where line.tax_rate_id = rate.id and invoice.status <> 'draft';
  if last_used is not null and p_effective_to < last_used then
    raise exception 'an invoice issued on % used this rate; end it on or after that date', to_char(last_used, 'YYYY-MM-DD') using errcode = '22023';
  end if;
  update public.tax_rates set effective_to = p_effective_to, ended_by = (select auth.uid()) where id = rate.id;
  perform app.record_audit_event(
    rate.organization_id, 'finance.tax_rate_ended', 'public.tax_rates', rate.id, 'success',
    jsonb_build_object('name', rate.name, 'effective_to', p_effective_to)
  );
end;
$$;
revoke all on function app.end_tax_rate(uuid, date) from public, anon;

-- ---------------------------------------------------------------------------
-- Government fee references (IRCC fee list snapshot, reviewed before use)
-- ---------------------------------------------------------------------------

-- Records what the server read from IRCC's fee list. p_rows: [{section, group, name,
-- amount_cents, anchor}]. The same page (same hash) twice records nothing new.
create function app.record_government_fee_snapshot(
  p_org uuid,
  p_source_url text,
  p_retrieved_at timestamptz,
  p_sha256 text,
  p_rows jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  url text := btrim(coalesce(p_source_url, ''));
  hash text := lower(btrim(coalesce(p_sha256, '')));
  item jsonb;
  pos integer := 0;
  anchor text;
begin
  perform app.require_active_staff(p_org, array['firm_owner', 'licensed_consultant', 'finance_user']::public.org_role[], false);
  if app.host_is_allowlisted(app.official_url_host(url)) is distinct from true then
    raise exception 'the fee list must come from an official Government of Canada page' using errcode = '22023';
  end if;
  if hash !~ '^[0-9a-f]{64}$' then
    raise exception 'the page hash is invalid' using errcode = '22023';
  end if;
  if p_retrieved_at is null or p_retrieved_at > statement_timestamp() + interval '5 minutes' or p_retrieved_at < statement_timestamp() - interval '1 day' then
    raise exception 'the retrieval time must be now' using errcode = '22023';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) not between 1 and 500 then
    raise exception 'no fees were read from the page' using errcode = '22023';
  end if;
  if exists (select 1 from public.government_fee_references ref where ref.organization_id = p_org and ref.snapshot_sha256 = hash) then
    return 0;
  end if;
  update public.government_fee_references
  set status = 'superseded'
  where organization_id = p_org and status = 'pending_review';
  for item in select value from jsonb_array_elements(p_rows) loop
    pos := pos + 1;
    anchor := nullif(regexp_replace(coalesce(item ->> 'anchor', ''), '[^A-Za-z0-9_-]', '', 'g'), '');
    insert into public.government_fee_references (
      organization_id, position, section, fee_group, name, amount_cents, source_url, retrieved_at, snapshot_sha256
    ) values (
      p_org,
      pos,
      nullif(left(btrim(coalesce(item ->> 'section', '')), 200), ''),
      nullif(left(btrim(coalesce(item ->> 'group', '')), 300), ''),
      left(btrim(item ->> 'name'), 300),
      (item ->> 'amount_cents')::bigint,
      split_part(url, '#', 1) || coalesce('#' || anchor, ''),
      p_retrieved_at,
      hash
    );
  end loop;
  perform app.record_audit_event(
    p_org, 'finance.government_fees_fetched', 'public.government_fee_references', null, 'success',
    jsonb_build_object('source_url', url, 'sha256', hash, 'rows', pos)
  );
  return pos;
end;
$$;
revoke all on function app.record_government_fee_snapshot(uuid, text, timestamptz, text, jsonb) from public, anon;

-- A licensed member of the firm (recent step-up) approves or rejects a pending snapshot. Approving
-- supersedes the snapshot approved before it.
create function app.review_government_fee_snapshot(p_org uuid, p_sha256 text, p_decision text, p_note text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  hash text := lower(btrim(coalesce(p_sha256, '')));
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  changed integer;
begin
  perform app.require_licensed_staff(p_org, true);
  if p_decision not in ('approved', 'rejected') then
    raise exception 'unknown decision' using errcode = '22023';
  end if;
  if p_decision = 'rejected' and (v_note is null or length(v_note) < 3) then
    raise exception 'say why it''s rejected' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.government_fee_references ref
    where ref.organization_id = p_org and ref.snapshot_sha256 = hash and ref.status = 'pending_review'
  ) then
    raise exception 'nothing is waiting for review' using errcode = '22023';
  end if;
  if p_decision = 'approved' then
    update public.government_fee_references
    set status = 'superseded'
    where organization_id = p_org and status = 'approved' and snapshot_sha256 <> hash;
  end if;
  update public.government_fee_references
  set status = p_decision, reviewed_by = (select auth.uid()), reviewed_at = clock_timestamp(), review_note = left(v_note, 500)
  where organization_id = p_org and snapshot_sha256 = hash and status = 'pending_review';
  get diagnostics changed = row_count;
  perform app.record_audit_event(
    p_org, 'finance.government_fees_' || p_decision, 'public.government_fee_references', null, 'success',
    jsonb_build_object('sha256', hash, 'rows', changed)
  );
  return changed;
end;
$$;
revoke all on function app.review_government_fee_snapshot(uuid, text, text, text) from public, anon;

-- ---------------------------------------------------------------------------
-- Time entries
-- ---------------------------------------------------------------------------

create function app.require_time_logger(p_matter_id uuid)
returns public.matters
language plpgsql
security definer
set search_path = ''
as $$
declare
  matter public.matters%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'sign in is required' using errcode = '42501';
  end if;
  select * into matter from public.matters where id = p_matter_id;
  if matter.id is null or app.can_log_matter_time(matter.id) is distinct from true then
    raise exception 'time access denied' using errcode = '42501';
  end if;
  if app.sample_mode_blocks_real(matter.organization_id, matter.is_sample) then
    raise exception 'this firm is in sample mode; only sample matters accept new work' using errcode = '42501';
  end if;
  if matter.stage = 'closed' then
    raise exception 'this matter is closed' using errcode = '22023';
  end if;
  return matter;
end;
$$;
revoke all on function app.require_time_logger(uuid) from public, anon, authenticated;

create function app.check_time_fields(p_rate_cents bigint, p_description text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_rate_cents is null or p_rate_cents < 0 or p_rate_cents > 10000000 then
    raise exception 'the hourly rate must be between 0 and 100,000.00' using errcode = '22023';
  end if;
  if p_description is null or length(btrim(p_description)) not between 1 and 500 then
    raise exception 'say what the time was for' using errcode = '22023';
  end if;
end;
$$;
revoke all on function app.check_time_fields(bigint, text) from public, anon, authenticated;

create function app.log_time_entry(
  p_matter_id uuid,
  p_worked_on date,
  p_minutes integer,
  p_rate_cents bigint,
  p_description text,
  p_billable boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  matter public.matters%rowtype;
  member uuid;
  rid uuid;
begin
  matter := app.require_time_logger(p_matter_id);
  member := app.actor_staff_membership(matter.organization_id);
  perform app.check_time_fields(p_rate_cents, p_description);
  if p_minutes is null or p_minutes not between 1 and 1440 then
    raise exception 'minutes must be between 1 and 1440' using errcode = '22023';
  end if;
  if p_worked_on is null or p_worked_on > app.firm_today(matter.organization_id) then
    raise exception 'the date can''t be in the future' using errcode = '22023';
  end if;
  insert into public.time_entries (organization_id, matter_id, membership_id, worked_on, minutes, rate_cents, description, billable, is_sample)
  values (matter.organization_id, matter.id, member, p_worked_on, p_minutes, p_rate_cents, btrim(p_description), coalesce(p_billable, true), matter.is_sample)
  returning id into rid;
  return rid;
end;
$$;
revoke all on function app.log_time_entry(uuid, date, integer, bigint, text, boolean) from public, anon;

create function app.start_timer(p_matter_id uuid, p_rate_cents bigint, p_description text, p_billable boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  matter public.matters%rowtype;
  member uuid;
  rid uuid;
begin
  matter := app.require_time_logger(p_matter_id);
  member := app.actor_staff_membership(matter.organization_id);
  perform app.check_time_fields(p_rate_cents, p_description);
  if exists (
    select 1 from public.time_entries entry
    where entry.membership_id = member and entry.minutes is null and entry.discarded_at is null
  ) then
    raise exception 'you already have a timer running; stop it first' using errcode = '23505';
  end if;
  insert into public.time_entries (organization_id, matter_id, membership_id, worked_on, started_at, rate_cents, description, billable, is_sample)
  values (matter.organization_id, matter.id, member, app.firm_today(matter.organization_id), clock_timestamp(), p_rate_cents, btrim(p_description), coalesce(p_billable, true), matter.is_sample)
  returning id into rid;
  return rid;
end;
$$;
revoke all on function app.start_timer(uuid, bigint, text, boolean) from public, anon;

-- Stops the caller's own running timer: the nearest whole minute, at least 1.
create function app.stop_timer(p_entry_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  entry public.time_entries%rowtype;
  stopped timestamptz := clock_timestamp();
  counted integer;
begin
  select * into entry from public.time_entries where id = p_entry_id for update;
  if entry.id is null or entry.membership_id is distinct from app.actor_staff_membership(entry.organization_id)
     or app.can_log_matter_time(entry.matter_id) is distinct from true then
    raise exception 'time access denied' using errcode = '42501';
  end if;
  if entry.minutes is not null or entry.discarded_at is not null then
    raise exception 'this timer isn''t running' using errcode = '22023';
  end if;
  counted := greatest(1, round(extract(epoch from (stopped - entry.started_at)) / 60)::integer);
  if counted > 1440 then
    raise exception 'this timer ran for more than 24 hours; discard it and log the time by hand' using errcode = '22023';
  end if;
  update public.time_entries set minutes = counted, stopped_at = stopped where id = entry.id;
  return counted;
end;
$$;
revoke all on function app.stop_timer(uuid) from public, anon;

-- An unbilled entry is discarded by the person who logged it or by billing staff. It stays on record.
create function app.discard_time_entry(p_entry_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  entry public.time_entries%rowtype;
begin
  select * into entry from public.time_entries where id = p_entry_id for update;
  if entry.id is null or not (
    (entry.membership_id = app.actor_staff_membership(entry.organization_id) and app.can_log_matter_time(entry.matter_id))
    or app.can_read_matter_billing(entry.matter_id)
  ) then
    raise exception 'time access denied' using errcode = '42501';
  end if;
  if entry.discarded_at is not null then
    return;
  end if;
  if app.time_entry_billed(entry.id) then
    raise exception 'this time is on an invoice; discard the draft or correct the invoice first' using errcode = '22023';
  end if;
  update public.time_entries set discarded_at = clock_timestamp(), discarded_by = (select auth.uid()) where id = entry.id;
end;
$$;
revoke all on function app.discard_time_entry(uuid) from public, anon;

-- ---------------------------------------------------------------------------
-- Draft invoices
-- ---------------------------------------------------------------------------

-- Unbilled billable time on a matter (all of it, or the entries given) into a draft invoice.
create function app.create_time_invoice(
  p_matter_id uuid,
  p_entry_ids uuid[],
  p_due_on date,
  p_tax_name text,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  matter public.matters%rowtype;
  key text := btrim(coalesce(p_idempotency_key, ''));
  existing uuid;
  today date;
  rate public.tax_rates%rowtype;
  tax_name text := nullif(btrim(coalesce(p_tax_name, '')), '');
  entry record;
  total bigint := 0;
  pos integer := 0;
  line_amount bigint;
  line_tax bigint;
  rid uuid;
  first_day date;
  last_day date;
begin
  matter := app.require_draft_billing(p_matter_id);
  if length(key) not between 8 and 180 then
    raise exception 'idempotency key is required' using errcode = '22023';
  end if;
  select invoice.id into existing from public.invoices invoice
  where invoice.organization_id = matter.organization_id and invoice.idempotency_key = key;
  if existing is not null then
    return existing;
  end if;
  today := app.firm_today(matter.organization_id);
  if tax_name is not null then
    rate := app.require_tax_rate(matter.organization_id, tax_name, today);
  end if;
  perform 1 from public.time_entries t where t.matter_id = matter.id for update;
  for entry in
    select t.* from public.time_entries t
    where t.matter_id = matter.id
      and t.organization_id = matter.organization_id
      and (p_entry_ids is null or cardinality(p_entry_ids) = 0 or t.id = any (p_entry_ids))
      and t.billable and t.discarded_at is null and t.minutes is not null
      and not app.time_entry_billed(t.id)
  loop
    total := total + app.time_amount_cents(entry.minutes, entry.rate_cents)
      + case when rate.id is null then 0 else app.tax_amount_cents(app.time_amount_cents(entry.minutes, entry.rate_cents), rate.rate_percent) end;
    first_day := least(coalesce(first_day, entry.worked_on), entry.worked_on);
    last_day := greatest(coalesce(last_day, entry.worked_on), entry.worked_on);
    pos := pos + 1;
  end loop;
  if pos = 0 then
    raise exception 'there is no unbilled billable time on this matter' using errcode = '22023';
  end if;
  if p_entry_ids is not null and cardinality(p_entry_ids) > 0 and pos <> cardinality(p_entry_ids) then
    raise exception 'some of that time is already billed, not billable, discarded or still running' using errcode = '22023';
  end if;
  if pos > 200 then
    raise exception 'an invoice takes up to 200 time lines' using errcode = '22023';
  end if;
  rid := app.open_invoice_draft(
    matter,
    'Professional services: time recorded ' || to_char(first_day, 'YYYY-MM-DD') || case when last_day <> first_day then ' to ' || to_char(last_day, 'YYYY-MM-DD') else '' end,
    p_due_on, total, key
  );
  pos := 0;
  for entry in
    select t.* from public.time_entries t
    where t.matter_id = matter.id
      and t.organization_id = matter.organization_id
      and (p_entry_ids is null or cardinality(p_entry_ids) = 0 or t.id = any (p_entry_ids))
      and t.billable and t.discarded_at is null and t.minutes is not null
      and not app.time_entry_billed(t.id)
    order by t.worked_on, t.created_at
  loop
    pos := pos + 1;
    line_amount := app.time_amount_cents(entry.minutes, entry.rate_cents);
    line_tax := case when rate.id is null then 0 else app.tax_amount_cents(line_amount, rate.rate_percent) end;
    insert into public.invoice_lines (
      organization_id, invoice_id, position, category, description, minutes, rate_cents, amount_cents,
      tax_name, tax_rate_id, tax_rate_percent, tax_cents, time_entry_id, is_sample
    ) values (
      matter.organization_id, rid, pos, 'professional_fee', left(to_char(entry.worked_on, 'YYYY-MM-DD') || ': ' || entry.description, 300),
      entry.minutes, entry.rate_cents, line_amount,
      case when rate.id is null then null else rate.name end, rate.id, rate.rate_percent, line_tax, entry.id, matter.is_sample
    );
  end loop;
  perform app.refresh_draft_amount(rid);
  perform app.record_audit_event(
    matter.organization_id, 'invoice.drafted', 'public.invoices', rid, 'success',
    jsonb_build_object('matter_id', matter.id, 'from', 'time', 'lines', pos)
  );
  return rid;
end;
$$;
revoke all on function app.create_time_invoice(uuid, uuid[], date, text, text) from public, anon;

-- The accepted quote of an agreement id, for billing staff: (agreement, its accepted version).
create function app.require_accepted_quote(p_agreement_id uuid)
returns public.agreements
language plpgsql
security definer
set search_path = ''
as $$
declare
  agreement public.agreements%rowtype;
begin
  select * into agreement from public.agreements where id = p_agreement_id;
  if agreement.id is null then
    raise exception 'billing access denied' using errcode = '42501';
  end if;
  perform app.require_draft_billing(agreement.matter_id);
  if agreement.kind <> 'quote' or agreement.status <> 'accepted' or agreement.current_version_id is null then
    raise exception 'only an accepted quote can be invoiced' using errcode = '22023';
  end if;
  return agreement;
end;
$$;
revoke all on function app.require_accepted_quote(uuid) from public, anon, authenticated;

create function app.quote_already_billed(p_agreement public.agreements)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (
      select 1 from public.instalment_plans plan
      where plan.agreement_id = p_agreement.id and plan.status = 'active'
    ) then 'this quote has an instalment plan; invoice its instalments instead'
    when exists (
      select 1
      from public.invoice_lines line
      join public.invoices invoice on invoice.id = line.invoice_id
      join public.quote_lines quote_line on quote_line.id = line.quote_line_id
      where quote_line.agreement_version_id = p_agreement.current_version_id
        and invoice.status <> 'voided' and invoice.discarded_at is null
    ) then 'this quote is already invoiced'
    else null
  end;
$$;
revoke all on function app.quote_already_billed(public.agreements) from public, anon, authenticated;

-- An accepted quote's professional fee and disbursement lines into one draft invoice. The chosen
-- tax rate applies to its professional fee lines.
create function app.create_quote_invoice(p_agreement_id uuid, p_due_on date, p_tax_name text, p_idempotency_key text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  agreement public.agreements%rowtype;
  matter public.matters%rowtype;
  key text := btrim(coalesce(p_idempotency_key, ''));
  existing uuid;
  blocked text;
  rate public.tax_rates%rowtype;
  tax_name text := nullif(btrim(coalesce(p_tax_name, '')), '');
  quote_line record;
  total bigint := 0;
  pos integer := 0;
  line_tax bigint;
  rid uuid;
begin
  agreement := app.require_accepted_quote(p_agreement_id);
  select * into matter from public.matters where id = agreement.matter_id;
  if length(key) not between 8 and 180 then
    raise exception 'idempotency key is required' using errcode = '22023';
  end if;
  select invoice.id into existing from public.invoices invoice
  where invoice.organization_id = matter.organization_id and invoice.idempotency_key = key;
  if existing is not null then
    return existing;
  end if;
  perform 1 from public.agreements a where a.id = agreement.id for update;
  blocked := app.quote_already_billed(agreement);
  if blocked is not null then
    raise exception '%', blocked using errcode = '22023';
  end if;
  if tax_name is not null then
    rate := app.require_tax_rate(matter.organization_id, tax_name, app.firm_today(matter.organization_id));
  end if;
  for quote_line in
    select ql.* from public.quote_lines ql
    where ql.agreement_version_id = agreement.current_version_id
      and ql.category in ('professional_fee', 'disbursement')
      and ql.amount_cents > 0
  loop
    total := total + quote_line.amount_cents
      + case when rate.id is not null and quote_line.category = 'professional_fee' then app.tax_amount_cents(quote_line.amount_cents, rate.rate_percent) else 0 end;
  end loop;
  if total <= 0 then
    raise exception 'this quote has no professional fee or disbursement to invoice' using errcode = '22023';
  end if;
  rid := app.open_invoice_draft(matter, 'Fees as quoted', p_due_on, total, key);
  for quote_line in
    select ql.* from public.quote_lines ql
    where ql.agreement_version_id = agreement.current_version_id
      and ql.category in ('professional_fee', 'disbursement')
      and ql.amount_cents > 0
    order by ql.position
  loop
    pos := pos + 1;
    line_tax := case when rate.id is not null and quote_line.category = 'professional_fee' then app.tax_amount_cents(quote_line.amount_cents, rate.rate_percent) else 0 end;
    insert into public.invoice_lines (
      organization_id, invoice_id, position, category, description, amount_cents,
      tax_name, tax_rate_id, tax_rate_percent, tax_cents, quote_line_id, is_sample
    ) values (
      matter.organization_id, rid, pos, quote_line.category::text, left(quote_line.description, 300), quote_line.amount_cents,
      case when rate.id is not null and quote_line.category = 'professional_fee' then rate.name end,
      case when rate.id is not null and quote_line.category = 'professional_fee' then rate.id end,
      case when rate.id is not null and quote_line.category = 'professional_fee' then rate.rate_percent end,
      line_tax, quote_line.id, matter.is_sample
    );
  end loop;
  perform app.refresh_draft_amount(rid);
  perform app.record_audit_event(
    matter.organization_id, 'invoice.drafted', 'public.invoices', rid, 'success',
    jsonb_build_object('matter_id', matter.id, 'from', 'quote', 'agreement_id', agreement.id, 'lines', pos)
  );
  return rid;
end;
$$;
revoke all on function app.create_quote_invoice(uuid, date, text, text) from public, anon;

-- A government fee as a disbursement line on a draft: from an approved reference, or typed with
-- its official source URL and the date it was checked. Never invented, never taxed here.
create function app.add_invoice_government_fee(
  p_invoice_id uuid,
  p_reference_id uuid,
  p_name text,
  p_amount_cents bigint,
  p_source_url text,
  p_checked_on date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  invoice public.invoices%rowtype;
  ref public.government_fee_references%rowtype;
  v_name text := btrim(coalesce(p_name, ''));
  url text := btrim(coalesce(p_source_url, ''));
  checked date := p_checked_on;
  pos integer;
  rid uuid;
begin
  invoice := app.require_invoice_billing(p_invoice_id, false);
  select * into invoice from public.invoices where id = invoice.id for update;
  if invoice.status <> 'draft' or invoice.discarded_at is not null then
    raise exception 'lines are added to a draft invoice only' using errcode = '22023';
  end if;
  if p_reference_id is not null then
    select * into ref from public.government_fee_references r
    where r.id = p_reference_id and r.organization_id = invoice.organization_id;
    if ref.id is null or ref.status <> 'approved' then
      raise exception 'that fee reference isn''t approved for use' using errcode = '22023';
    end if;
    v_name := ref.name;
    url := ref.source_url;
    checked := app.firm_local_date(invoice.organization_id, ref.retrieved_at);
    if p_amount_cents is not null and p_amount_cents <> ref.amount_cents then
      raise exception 'the amount must match the fee reference' using errcode = '22023';
    end if;
  else
    if length(v_name) not between 3 and 300 then
      raise exception 'name the government fee' using errcode = '22023';
    end if;
    if p_amount_cents is null or p_amount_cents <= 0 or p_amount_cents > 100000000 then
      raise exception 'the government fee amount must be positive' using errcode = '22023';
    end if;
    if app.host_is_allowlisted(app.official_url_host(url)) is distinct from true then
      raise exception 'the source must be an official Government of Canada page (https)' using errcode = '22023';
    end if;
    if checked is null or checked > app.firm_today(invoice.organization_id) then
      raise exception 'say when the source was checked (not in the future)' using errcode = '22023';
    end if;
  end if;
  select coalesce(max(line.position), 0) + 1 into pos from public.invoice_lines line where line.invoice_id = invoice.id;
  insert into public.invoice_lines (
    organization_id, invoice_id, position, category, description, amount_cents,
    fee_reference_id, source_url, source_checked_on, source_retrieved_at, source_sha256, is_sample
  ) values (
    invoice.organization_id, invoice.id, pos, 'government_fee', left(v_name, 300), coalesce(ref.amount_cents, p_amount_cents),
    ref.id, url, checked, ref.retrieved_at, ref.snapshot_sha256, invoice.is_sample
  )
  returning id into rid;
  perform app.refresh_draft_amount(invoice.id);
  perform app.record_audit_event(
    invoice.organization_id, 'invoice.government_fee_added', 'public.invoices', invoice.id, 'success',
    jsonb_build_object('line_id', rid, 'amount_cents', coalesce(ref.amount_cents, p_amount_cents), 'source_url', url, 'reference_id', ref.id)
  );
  return rid;
end;
$$;
revoke all on function app.add_invoice_government_fee(uuid, uuid, text, bigint, text, date) from public, anon;

create function app.remove_invoice_line(p_line_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  line public.invoice_lines%rowtype;
  invoice public.invoices%rowtype;
begin
  select * into line from public.invoice_lines where id = p_line_id;
  if line.id is null then
    raise exception 'billing access denied' using errcode = '42501';
  end if;
  invoice := app.require_invoice_billing(line.invoice_id, false);
  select * into invoice from public.invoices where id = invoice.id for update;
  if invoice.status <> 'draft' or invoice.discarded_at is not null then
    raise exception 'an issued invoice''s lines can''t be changed' using errcode = '42501';
  end if;
  delete from public.invoice_lines where id = line.id;
  perform app.refresh_draft_amount(invoice.id);
end;
$$;
revoke all on function app.remove_invoice_line(uuid) from public, anon;

-- Issues a draft: each taxed line takes its rate in effect on the invoice date (today).
create function app.issue_invoice_draft(p_invoice_id uuid, p_due_on date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  invoice public.invoices%rowtype;
  today date;
  due date;
  line record;
  rate public.tax_rates%rowtype;
  total bigint;
begin
  invoice := app.require_invoice_billing(p_invoice_id, false);
  if app.can_perform_billing(invoice.matter_id, 'issue_invoice') is distinct from true then
    raise exception 'billing access denied' using errcode = '42501';
  end if;
  select * into invoice from public.invoices where id = invoice.id for update;
  if invoice.status <> 'draft' or invoice.discarded_at is not null then
    raise exception 'this invoice isn''t a draft' using errcode = '22023';
  end if;
  if app.sample_mode_blocks_real(invoice.organization_id, invoice.is_sample) then
    raise exception 'this firm is in sample mode; only sample matters take invoices' using errcode = '42501';
  end if;
  if not exists (select 1 from public.invoice_lines l where l.invoice_id = invoice.id) then
    raise exception 'this draft has no lines' using errcode = '22023';
  end if;
  today := app.firm_today(invoice.organization_id);
  due := coalesce(p_due_on, invoice.due_on);
  if due < today then
    raise exception 'due date must be today or later' using errcode = '22023';
  end if;
  for line in select l.* from public.invoice_lines l where l.invoice_id = invoice.id and l.tax_name is not null loop
    rate := app.require_tax_rate(invoice.organization_id, line.tax_name, today);
    update public.invoice_lines
    set tax_rate_id = rate.id, tax_rate_percent = rate.rate_percent, tax_cents = app.tax_amount_cents(line.amount_cents, rate.rate_percent)
    where id = line.id;
  end loop;
  total := app.refresh_draft_amount(invoice.id);
  update public.invoices
  set status = 'issued', issued_on = today, due_on = due
  where id = invoice.id
  returning * into invoice;
  perform app.record_audit_event(
    invoice.organization_id, 'invoice.issued', 'public.invoices', invoice.id, 'success',
    jsonb_build_object('matter_id', invoice.matter_id, 'amount_cents', total, 'currency', invoice.currency, 'from_draft', true)
  );
  return jsonb_build_object('status', invoice.status, 'number', invoice.number, 'amount_cents', total);
end;
$$;
revoke all on function app.issue_invoice_draft(uuid, date) from public, anon;

-- Discards a draft with a reason. It stays on record as a discarded draft; its time and instalments are free again.
create function app.discard_invoice_draft(p_invoice_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  invoice public.invoices%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  invoice := app.require_invoice_billing(p_invoice_id, false);
  select * into invoice from public.invoices where id = invoice.id for update;
  if invoice.status <> 'draft' then
    raise exception 'only a draft can be discarded; void or credit an issued invoice' using errcode = '22023';
  end if;
  if invoice.discarded_at is not null then
    return;
  end if;
  if length(v_reason) not between 3 and 500 then
    raise exception 'a reason is required' using errcode = '22023';
  end if;
  update public.invoices
  set discarded_at = clock_timestamp(), discarded_by = (select auth.uid()), discard_reason = v_reason
  where id = invoice.id;
  perform app.record_audit_event(
    invoice.organization_id, 'invoice.draft_discarded', 'public.invoices', invoice.id, 'success',
    jsonb_build_object('amount_cents', invoice.amount_cents)
  );
end;
$$;
revoke all on function app.discard_invoice_draft(uuid, text) from public, anon;

-- ---------------------------------------------------------------------------
-- Write-offs
-- ---------------------------------------------------------------------------

create function app.write_off_invoice(p_invoice_id uuid, p_amount_cents bigint, p_reason text, p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  invoice public.invoices%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
  key text := btrim(coalesce(p_idempotency_key, ''));
  existing public.invoice_write_offs%rowtype;
  drafts bigint;
  open_cents bigint;
  rid uuid;
begin
  invoice := app.require_invoice_billing(p_invoice_id, true);
  if length(key) not between 8 and 180 then
    raise exception 'idempotency key is required' using errcode = '22023';
  end if;
  select * into existing from public.invoice_write_offs w where w.organization_id = invoice.organization_id and w.idempotency_key = key;
  if existing.id is not null then
    if existing.invoice_id <> invoice.id then
      raise exception 'idempotency key belongs to another write-off' using errcode = '42501';
    end if;
    select * into invoice from public.invoices where id = invoice.id;
    return jsonb_build_object('id', existing.id, 'status', invoice.status, 'written_off_cents', invoice.written_off_cents);
  end if;
  select * into invoice from public.invoices where id = invoice.id for update;
  if app.sample_mode_blocks_real(invoice.organization_id, invoice.is_sample) then
    raise exception 'this firm is in sample mode; only sample invoices can be written off' using errcode = '42501';
  end if;
  if invoice.status not in ('issued', 'partially_paid') then
    raise exception 'only an issued invoice with a balance can be written off' using errcode = '22023';
  end if;
  if length(v_reason) not between 3 and 500 then
    raise exception 'a reason is required' using errcode = '22023';
  end if;
  select coalesce(sum(note.amount_cents), 0) into drafts
  from public.invoice_credit_notes note
  where note.invoice_id = invoice.id and note.status = 'draft';
  open_cents := invoice.amount_cents - invoice.paid_cents - invoice.credited_cents - drafts;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'the write-off amount must be positive' using errcode = '22023';
  end if;
  if p_amount_cents > open_cents then
    raise exception 'that is more than the balance still owed' using errcode = '22023';
  end if;
  insert into public.invoice_write_offs (organization_id, invoice_id, amount_cents, currency, reason, written_off_by, idempotency_key, is_sample)
  values (invoice.organization_id, invoice.id, p_amount_cents, invoice.currency, v_reason, (select auth.uid()), key, invoice.is_sample)
  returning id into rid;
  update public.invoices
  set credited_cents = credited_cents + p_amount_cents,
      written_off_cents = written_off_cents + p_amount_cents,
      status = app.invoice_settled_status(status, amount_cents, paid_cents, credited_cents + p_amount_cents, refunded_cents)
  where id = invoice.id
  returning * into invoice;
  perform app.record_audit_event(
    invoice.organization_id, 'invoice.written_off', 'public.invoices', invoice.id, 'success',
    jsonb_build_object('write_off_id', rid, 'amount_cents', p_amount_cents, 'currency', invoice.currency, 'reason', v_reason)
  );
  return jsonb_build_object('id', rid, 'status', invoice.status, 'written_off_cents', invoice.written_off_cents);
end;
$$;
revoke all on function app.write_off_invoice(uuid, bigint, text, text) from public, anon;

-- ---------------------------------------------------------------------------
-- Instalment plans
-- ---------------------------------------------------------------------------

create function app.create_instalment_plan(p_agreement_id uuid, p_due_dates date[])
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  agreement public.agreements%rowtype;
  matter public.matters%rowtype;
  blocked text;
  owner_membership uuid;
  today date;
  zone text;
  instalment record;
  plan_id uuid;
  item_id uuid;
  task_id uuid;
  n integer;
begin
  agreement := app.require_accepted_quote(p_agreement_id);
  select * into matter from public.matters where id = agreement.matter_id;
  perform 1 from public.agreements a where a.id = agreement.id for update;
  blocked := app.quote_already_billed(agreement);
  if blocked is not null then
    raise exception '%', replace(blocked, 'invoice its instalments instead', 'cancel it first') using errcode = '22023';
  end if;
  select count(*)::integer into n from public.quote_instalments qi where qi.agreement_version_id = agreement.current_version_id;
  if n = 0 then
    raise exception 'this quote has no instalments' using errcode = '22023';
  end if;
  if p_due_dates is null or cardinality(p_due_dates) <> n or array_position(p_due_dates, null) is not null then
    raise exception 'give a due date for each of the % instalments', n using errcode = '22023';
  end if;
  today := app.firm_today(matter.organization_id);
  if exists (select 1 from unnest(p_due_dates) d where d < today) then
    raise exception 'due dates must be today or later' using errcode = '22023';
  end if;
  owner_membership := app.actor_staff_membership(matter.organization_id);
  if owner_membership is null then
    raise exception 'billing access denied' using errcode = '42501';
  end if;
  select coalesce(org.timezone, 'America/Toronto') into zone from public.organizations org where org.id = matter.organization_id;
  insert into public.instalment_plans (organization_id, matter_id, agreement_id, agreement_version_id, is_sample)
  values (matter.organization_id, matter.id, agreement.id, agreement.current_version_id, matter.is_sample)
  returning id into plan_id;
  for instalment in
    select qi.*, row_number() over (order by qi.position) as ord
    from public.quote_instalments qi
    where qi.agreement_version_id = agreement.current_version_id
    order by qi.position
  loop
    insert into public.tasks (organization_id, matter_id, audience, title, priority, owner_membership_id, due_on, due_timezone, checklist, task_key)
    values (
      matter.organization_id, matter.id, 'internal',
      left('Instalment due: ' || instalment.label || ' (' || instalment.paid_as::text || ')', 200),
      'normal', owner_membership, p_due_dates[instalment.ord], app.usable_timezone(zone), '[]'::jsonb, 'instalment'
    )
    returning id into task_id;
    insert into public.task_events (organization_id, task_id, event_kind, to_status, actor_user_id)
    values (matter.organization_id, task_id, 'created', 'open', (select auth.uid()));
    insert into public.instalment_plan_items (organization_id, plan_id, position, label, amount_cents, paid_as, due_on, quote_instalment_id, task_id)
    values (matter.organization_id, plan_id, instalment.ord, instalment.label, instalment.amount_cents, instalment.paid_as::text, p_due_dates[instalment.ord], instalment.id, task_id)
    returning id into item_id;
  end loop;
  perform app.record_audit_event(
    matter.organization_id, 'billing.instalment_plan_created', 'public.instalment_plans', plan_id, 'success',
    jsonb_build_object('agreement_id', agreement.id, 'instalments', n)
  );
  return plan_id;
end;
$$;
revoke all on function app.create_instalment_plan(uuid, date[]) from public, anon;

-- An instalment paid as an invoice after delivery, as a draft invoice.
create function app.invoice_instalment(p_item_id uuid, p_due_on date, p_tax_name text, p_idempotency_key text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  item public.instalment_plan_items%rowtype;
  plan public.instalment_plans%rowtype;
  matter public.matters%rowtype;
  key text := btrim(coalesce(p_idempotency_key, ''));
  existing uuid;
  rate public.tax_rates%rowtype;
  tax_name text := nullif(btrim(coalesce(p_tax_name, '')), '');
  line_tax bigint := 0;
  rid uuid;
begin
  select * into item from public.instalment_plan_items where id = p_item_id;
  if item.id is null then
    raise exception 'billing access denied' using errcode = '42501';
  end if;
  select * into plan from public.instalment_plans where id = item.plan_id for update;
  matter := app.require_draft_billing(plan.matter_id);
  if length(key) not between 8 and 180 then
    raise exception 'idempotency key is required' using errcode = '22023';
  end if;
  select invoice.id into existing from public.invoices invoice
  where invoice.organization_id = matter.organization_id and invoice.idempotency_key = key;
  if existing is not null then
    return existing;
  end if;
  if plan.status <> 'active' then
    raise exception 'this instalment plan is cancelled' using errcode = '22023';
  end if;
  if item.paid_as <> 'invoice_after_delivery' then
    raise exception 'an advance is requested into the client account, not invoiced' using errcode = '22023';
  end if;
  if item.amount_cents <= 0 then
    raise exception 'this instalment has no amount' using errcode = '22023';
  end if;
  if app.instalment_item_invoiced(item.id) is not null then
    raise exception 'this instalment is already invoiced' using errcode = '22023';
  end if;
  if tax_name is not null then
    rate := app.require_tax_rate(matter.organization_id, tax_name, app.firm_today(matter.organization_id));
    line_tax := app.tax_amount_cents(item.amount_cents, rate.rate_percent);
  end if;
  rid := app.open_invoice_draft(matter, left('Instalment ' || item.position || ': ' || item.label, 500), p_due_on, item.amount_cents + line_tax, key);
  insert into public.invoice_lines (
    organization_id, invoice_id, position, category, description, amount_cents,
    tax_name, tax_rate_id, tax_rate_percent, tax_cents, instalment_item_id, is_sample
  ) values (
    matter.organization_id, rid, 1, 'professional_fee', left('Instalment ' || item.position || ': ' || item.label, 300), item.amount_cents,
    rate.name, rate.id, rate.rate_percent, line_tax, item.id, matter.is_sample
  );
  perform app.refresh_draft_amount(rid);
  perform app.record_audit_event(
    matter.organization_id, 'invoice.drafted', 'public.invoices', rid, 'success',
    jsonb_build_object('matter_id', matter.id, 'from', 'instalment', 'instalment_item_id', item.id)
  );
  return rid;
end;
$$;
revoke all on function app.invoice_instalment(uuid, date, text, text) from public, anon;

create function app.cancel_instalment_plan(p_plan_id uuid, p_reason text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  plan public.instalment_plans%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
  item record;
  cancelled integer := 0;
begin
  select * into plan from public.instalment_plans where id = p_plan_id for update;
  if plan.id is null or app.can_perform_billing(plan.matter_id, 'issue_invoice') is distinct from true then
    raise exception 'billing access denied' using errcode = '42501';
  end if;
  if plan.status <> 'active' then
    raise exception 'this instalment plan is already cancelled' using errcode = '22023';
  end if;
  if length(v_reason) not between 3 and 500 then
    raise exception 'a reason is required' using errcode = '22023';
  end if;
  update public.instalment_plans
  set status = 'cancelled', cancelled_at = clock_timestamp(), cancelled_by = (select auth.uid()), cancel_reason = v_reason
  where id = plan.id;
  for item in
    select task.id, task.status
    from public.instalment_plan_items i
    join public.tasks task on task.id = i.task_id
    where i.plan_id = plan.id and task.status in ('open', 'blocked')
  loop
    perform app.open_task_write(item.id);
    update public.tasks set status = 'cancelled', blocker_note = null where id = item.id;
    perform app.close_task_write(item.id);
    insert into public.task_events (organization_id, task_id, event_kind, from_status, to_status, actor_user_id)
    values (plan.organization_id, item.id, 'status', item.status, 'cancelled', (select auth.uid()));
    cancelled := cancelled + 1;
  end loop;
  perform app.record_audit_event(
    plan.organization_id, 'billing.instalment_plan_cancelled', 'public.instalment_plans', plan.id, 'success',
    jsonb_build_object('reason', v_reason, 'tasks_cancelled', cancelled)
  );
  return cancelled;
end;
$$;
revoke all on function app.cancel_instalment_plan(uuid, text) from public, anon;

-- Which invoice each time entry on a matter is on, for whoever reads the matter's time (staff on
-- the matter who don't read invoices see the number and state, not the invoice).
create function public.matter_time_invoices(p_matter_id uuid)
returns table (time_entry_id uuid, invoice_number text, invoice_status text)
language sql
stable
security definer
set search_path = ''
as $$
  select line.time_entry_id, invoice.number, invoice.status::text
  from public.invoice_lines line
  join public.invoices invoice on invoice.id = line.invoice_id
  join public.time_entries entry on entry.id = line.time_entry_id
  where entry.matter_id = p_matter_id
    and invoice.status <> 'voided' and invoice.discarded_at is null
    and app.can_read_time_entry(p_matter_id);
$$;
revoke all on function public.matter_time_invoices(uuid) from public, anon;
grant execute on function public.matter_time_invoices(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Public wrappers (security invoker; the app functions check the caller)
-- ---------------------------------------------------------------------------

create function public.add_tax_rate(p_org uuid, p_name text, p_rate_percent numeric, p_effective_from date, p_effective_to date, p_approved_by text, p_source_note text)
returns uuid language sql security invoker set search_path = ''
as $$ select app.add_tax_rate(p_org, p_name, p_rate_percent, p_effective_from, p_effective_to, p_approved_by, p_source_note); $$;

create function public.end_tax_rate(p_rate_id uuid, p_effective_to date)
returns void language sql security invoker set search_path = ''
as $$ select app.end_tax_rate(p_rate_id, p_effective_to); $$;

create function public.record_government_fee_snapshot(p_org uuid, p_source_url text, p_retrieved_at timestamptz, p_sha256 text, p_rows jsonb)
returns integer language sql security invoker set search_path = ''
as $$ select app.record_government_fee_snapshot(p_org, p_source_url, p_retrieved_at, p_sha256, p_rows); $$;

create function public.review_government_fee_snapshot(p_org uuid, p_sha256 text, p_decision text, p_note text)
returns integer language sql security invoker set search_path = ''
as $$ select app.review_government_fee_snapshot(p_org, p_sha256, p_decision, p_note); $$;

create function public.log_time_entry(p_matter_id uuid, p_worked_on date, p_minutes integer, p_rate_cents bigint, p_description text, p_billable boolean)
returns uuid language sql security invoker set search_path = ''
as $$ select app.log_time_entry(p_matter_id, p_worked_on, p_minutes, p_rate_cents, p_description, p_billable); $$;

create function public.start_timer(p_matter_id uuid, p_rate_cents bigint, p_description text, p_billable boolean)
returns uuid language sql security invoker set search_path = ''
as $$ select app.start_timer(p_matter_id, p_rate_cents, p_description, p_billable); $$;

create function public.stop_timer(p_entry_id uuid)
returns integer language sql security invoker set search_path = ''
as $$ select app.stop_timer(p_entry_id); $$;

create function public.discard_time_entry(p_entry_id uuid)
returns void language sql security invoker set search_path = ''
as $$ select app.discard_time_entry(p_entry_id); $$;

create function public.create_time_invoice(p_matter_id uuid, p_entry_ids uuid[], p_due_on date, p_tax_name text, p_idempotency_key text)
returns uuid language sql security invoker set search_path = ''
as $$ select app.create_time_invoice(p_matter_id, p_entry_ids, p_due_on, p_tax_name, p_idempotency_key); $$;

create function public.create_quote_invoice(p_agreement_id uuid, p_due_on date, p_tax_name text, p_idempotency_key text)
returns uuid language sql security invoker set search_path = ''
as $$ select app.create_quote_invoice(p_agreement_id, p_due_on, p_tax_name, p_idempotency_key); $$;

create function public.add_invoice_government_fee(p_invoice_id uuid, p_reference_id uuid, p_name text, p_amount_cents bigint, p_source_url text, p_checked_on date)
returns uuid language sql security invoker set search_path = ''
as $$ select app.add_invoice_government_fee(p_invoice_id, p_reference_id, p_name, p_amount_cents, p_source_url, p_checked_on); $$;

create function public.remove_invoice_line(p_line_id uuid)
returns void language sql security invoker set search_path = ''
as $$ select app.remove_invoice_line(p_line_id); $$;

create function public.issue_invoice_draft(p_invoice_id uuid, p_due_on date)
returns jsonb language sql security invoker set search_path = ''
as $$ select app.issue_invoice_draft(p_invoice_id, p_due_on); $$;

create function public.discard_invoice_draft(p_invoice_id uuid, p_reason text)
returns void language sql security invoker set search_path = ''
as $$ select app.discard_invoice_draft(p_invoice_id, p_reason); $$;

create function public.write_off_invoice(p_invoice_id uuid, p_amount_cents bigint, p_reason text, p_idempotency_key text)
returns jsonb language sql security invoker set search_path = ''
as $$ select app.write_off_invoice(p_invoice_id, p_amount_cents, p_reason, p_idempotency_key); $$;

create function public.create_instalment_plan(p_agreement_id uuid, p_due_dates date[])
returns uuid language sql security invoker set search_path = ''
as $$ select app.create_instalment_plan(p_agreement_id, p_due_dates); $$;

create function public.invoice_instalment(p_item_id uuid, p_due_on date, p_tax_name text, p_idempotency_key text)
returns uuid language sql security invoker set search_path = ''
as $$ select app.invoice_instalment(p_item_id, p_due_on, p_tax_name, p_idempotency_key); $$;

create function public.cancel_instalment_plan(p_plan_id uuid, p_reason text)
returns integer language sql security invoker set search_path = ''
as $$ select app.cancel_instalment_plan(p_plan_id, p_reason); $$;

revoke all on function public.add_tax_rate(uuid, text, numeric, date, date, text, text) from public, anon;
revoke all on function public.end_tax_rate(uuid, date) from public, anon;
revoke all on function public.record_government_fee_snapshot(uuid, text, timestamptz, text, jsonb) from public, anon;
revoke all on function public.review_government_fee_snapshot(uuid, text, text, text) from public, anon;
revoke all on function public.log_time_entry(uuid, date, integer, bigint, text, boolean) from public, anon;
revoke all on function public.start_timer(uuid, bigint, text, boolean) from public, anon;
revoke all on function public.stop_timer(uuid) from public, anon;
revoke all on function public.discard_time_entry(uuid) from public, anon;
revoke all on function public.create_time_invoice(uuid, uuid[], date, text, text) from public, anon;
revoke all on function public.create_quote_invoice(uuid, date, text, text) from public, anon;
revoke all on function public.add_invoice_government_fee(uuid, uuid, text, bigint, text, date) from public, anon;
revoke all on function public.remove_invoice_line(uuid) from public, anon;
revoke all on function public.issue_invoice_draft(uuid, date) from public, anon;
revoke all on function public.discard_invoice_draft(uuid, text) from public, anon;
revoke all on function public.write_off_invoice(uuid, bigint, text, text) from public, anon;
revoke all on function public.create_instalment_plan(uuid, date[]) from public, anon;
revoke all on function public.invoice_instalment(uuid, date, text, text) from public, anon;
revoke all on function public.cancel_instalment_plan(uuid, text) from public, anon;

grant execute on function public.add_tax_rate(uuid, text, numeric, date, date, text, text) to authenticated;
grant execute on function public.end_tax_rate(uuid, date) to authenticated;
grant execute on function public.record_government_fee_snapshot(uuid, text, timestamptz, text, jsonb) to authenticated;
grant execute on function public.review_government_fee_snapshot(uuid, text, text, text) to authenticated;
grant execute on function public.log_time_entry(uuid, date, integer, bigint, text, boolean) to authenticated;
grant execute on function public.start_timer(uuid, bigint, text, boolean) to authenticated;
grant execute on function public.stop_timer(uuid) to authenticated;
grant execute on function public.discard_time_entry(uuid) to authenticated;
grant execute on function public.create_time_invoice(uuid, uuid[], date, text, text) to authenticated;
grant execute on function public.create_quote_invoice(uuid, date, text, text) to authenticated;
grant execute on function public.add_invoice_government_fee(uuid, uuid, text, bigint, text, date) to authenticated;
grant execute on function public.remove_invoice_line(uuid) to authenticated;
grant execute on function public.issue_invoice_draft(uuid, date) to authenticated;
grant execute on function public.discard_invoice_draft(uuid, text) to authenticated;
grant execute on function public.write_off_invoice(uuid, bigint, text, text) to authenticated;
grant execute on function public.create_instalment_plan(uuid, date[]) to authenticated;
grant execute on function public.invoice_instalment(uuid, date, text, text) to authenticated;
grant execute on function public.cancel_instalment_plan(uuid, text) to authenticated;

grant execute on function app.add_tax_rate(uuid, text, numeric, date, date, text, text) to authenticated;
grant execute on function app.end_tax_rate(uuid, date) to authenticated;
grant execute on function app.record_government_fee_snapshot(uuid, text, timestamptz, text, jsonb) to authenticated;
grant execute on function app.review_government_fee_snapshot(uuid, text, text, text) to authenticated;
grant execute on function app.log_time_entry(uuid, date, integer, bigint, text, boolean) to authenticated;
grant execute on function app.start_timer(uuid, bigint, text, boolean) to authenticated;
grant execute on function app.stop_timer(uuid) to authenticated;
grant execute on function app.discard_time_entry(uuid) to authenticated;
grant execute on function app.create_time_invoice(uuid, uuid[], date, text, text) to authenticated;
grant execute on function app.create_quote_invoice(uuid, date, text, text) to authenticated;
grant execute on function app.add_invoice_government_fee(uuid, uuid, text, bigint, text, date) to authenticated;
grant execute on function app.remove_invoice_line(uuid) to authenticated;
grant execute on function app.issue_invoice_draft(uuid, date) to authenticated;
grant execute on function app.discard_invoice_draft(uuid, text) to authenticated;
grant execute on function app.write_off_invoice(uuid, bigint, text, text) to authenticated;
grant execute on function app.create_instalment_plan(uuid, date[]) to authenticated;
grant execute on function app.invoice_instalment(uuid, date, text, text) to authenticated;
grant execute on function app.cancel_instalment_plan(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Table privileges and row-level security
-- ---------------------------------------------------------------------------

revoke all on table public.tax_rates from anon, authenticated, service_role;
revoke all on table public.government_fee_references from anon, authenticated, service_role;
revoke all on table public.time_entries from anon, authenticated, service_role;
revoke all on table public.instalment_plans from anon, authenticated, service_role;
revoke all on table public.instalment_plan_items from anon, authenticated, service_role;
revoke all on table public.invoice_lines from anon, authenticated, service_role;
revoke all on table public.invoice_write_offs from anon, authenticated, service_role;
grant select on table public.tax_rates to authenticated, service_role;
grant select on table public.government_fee_references to authenticated, service_role;
grant select on table public.time_entries to authenticated, service_role;
grant select on table public.instalment_plans to authenticated, service_role;
grant select on table public.instalment_plan_items to authenticated, service_role;
grant select on table public.invoice_lines to authenticated, service_role;
grant select on table public.invoice_write_offs to authenticated, service_role;

alter table public.tax_rates enable row level security;
alter table public.tax_rates force row level security;
alter table public.government_fee_references enable row level security;
alter table public.government_fee_references force row level security;
alter table public.time_entries enable row level security;
alter table public.time_entries force row level security;
alter table public.instalment_plans enable row level security;
alter table public.instalment_plans force row level security;
alter table public.instalment_plan_items enable row level security;
alter table public.instalment_plan_items force row level security;
alter table public.invoice_lines enable row level security;
alter table public.invoice_lines force row level security;
alter table public.invoice_write_offs enable row level security;
alter table public.invoice_write_offs force row level security;

create policy tax_rates_select on public.tax_rates
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.can_read_billing_settings(organization_id))
  );

create policy government_fee_references_select on public.government_fee_references
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.can_read_billing_settings(organization_id))
  );

create policy time_entries_select on public.time_entries
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.can_read_time_entry(matter_id))
  );

create policy instalment_plans_select on public.instalment_plans
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.can_read_matter_billing(matter_id))
  );

create policy instalment_plan_items_select on public.instalment_plan_items
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and exists (
      select 1 from public.instalment_plans plan
      where plan.id = instalment_plan_items.plan_id
        and (select app.can_read_matter_billing(plan.matter_id))
    )
  );

create policy invoice_lines_select on public.invoice_lines
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.can_read_invoice(invoice_id))
  );

create policy invoice_write_offs_select on public.invoice_write_offs
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and exists (
      select 1 from public.invoices invoice
      where invoice.id = invoice_write_offs.invoice_id
        and (select app.can_read_matter_billing(invoice.matter_id))
    )
  );
