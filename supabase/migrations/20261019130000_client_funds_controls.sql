-- Client funds controls: receipts for advances, the 30-day withdrawal date, the recorded bank
-- transfer after an approved earned-fee transfer, and a second person to verify deposits.
--
-- Rules quoted from the Code of Professional Conduct for College of Immigration and Citizenship
-- Consultants Licensees, SOR/2022-128 (https://laws-lois.justice.gc.ca/eng/regulations/sor-2022-128/FullText.html,
-- retrieved 2026-10-18, "current to 2026-09-30"). See docs/legal/client-account-sources.md.
--
--   s. 32(b) "on receipt of an advance payment, provide the client with a receipt that clearly
--            indicates the amount of the advance payment and deposit the funds into the client
--            account"
--            -> client_fund_receipts: one receipt per verified deposit, numbered RC-0001 per firm,
--               issued when the deposit is verified against the bank statement. Append-only. The
--               firm, client, matter, licence and account are copied onto the row when it is issued
--               so a later rename never changes a receipt. The PDF is rendered by the app server.
--   s. 32(g) "not later than 30 days after the day on which the client is invoiced under
--            paragraph (f), withdraw the invoiced amount from the client account"
--            -> app.client_funds_withdraw_by(issued_on) = issued_on + 30 days. Shown, not enforced:
--               nothing is blocked after that day. public.list_client_fund_withdrawals() lists what
--               is still to be withdrawn: transfers waiting for approval, approved transfers whose
--               bank transfer is not recorded, and issued invoices on a matter where the firm holds
--               client money and no transfer has been asked for.
--   s. 32(f) "before withdrawing funds from the client account, invoice the client"
--            -> a recorded bank transfer can't be dated before the invoice's issue date.
--
-- Bank transfer step: an approved transfer stays "approved" in client_fund_entries (the invoice is
-- marked paid at approval, as before). client_fund_bank_transfers records, once, that the money
-- actually left the client account: the date, the bank's reference and an optional note. Firm
-- owner or the matter's finance user, with a recent step-up, as for approvals.
--
-- Second person: whoever recorded a deposit may not verify it, except the firm owner, who may
-- verify their own (decided by Francis, the same exception as approving their own transfer). That
-- is stored as client_fund_entries.verified_by_owner_self and audited as
-- client_funds.deposit_verified_owner_self. Enforced in app.verify_client_deposit and by a check
-- constraint (NOT VALID, so rows written before this migration are not re-checked).
--
-- Nothing here changes a matter's stage or a government status. Additive only.

-- ---------------------------------------------------------------------------
-- Second person to verify a deposit
-- ---------------------------------------------------------------------------

alter table public.client_fund_entries add column verified_by_owner_self boolean not null default false;
comment on column public.client_fund_entries.verified_by_owner_self is
  'The firm owner verified a deposit they recorded themselves (the only person who may).';

alter table public.client_fund_entries add constraint client_fund_entries_owner_self_verify_shape
  check (not verified_by_owner_self or (kind = 'deposit' and status = 'verified' and verified_by = requested_by));
alter table public.client_fund_entries add constraint client_fund_entries_second_person_verify
  check (kind <> 'deposit' or verified_by is null or verified_by <> requested_by or verified_by_owner_self) not valid;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.client_fund_receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  entry_id uuid not null unique,
  ledger_id uuid not null,
  matter_id uuid not null,
  person_id uuid not null,
  number text not null check (number ~ '^RC-[0-9]{4,9}$'),
  issued_at timestamptz not null default now(),
  issued_by uuid references auth.users (id),
  received_on date not null,
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 99999999999),
  currency text not null check (currency = 'CAD'),
  method public.client_fund_method not null,
  external_reference text check (external_reference is null or length(btrim(external_reference)) between 1 and 80),
  client_name text not null check (length(btrim(client_name)) between 1 and 300),
  matter_label text not null check (length(btrim(matter_label)) between 1 and 300),
  firm_legal_name text not null check (length(btrim(firm_legal_name)) between 1 and 300),
  firm_display_name text not null check (length(btrim(firm_display_name)) between 1 and 200),
  firm_timezone text not null,
  consultant_name text check (consultant_name is null or length(consultant_name) <= 200),
  consultant_licence text check (consultant_licence is null or length(consultant_licence) <= 80),
  account_label text not null check (length(btrim(account_label)) between 1 and 80),
  account_institution text not null check (length(btrim(account_institution)) between 1 and 120),
  account_last4 text not null check (account_last4 ~ '^[0-9]{4}$'),
  is_sample boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  unique (id, organization_id),
  unique (organization_id, number),
  foreign key (entry_id, organization_id) references public.client_fund_entries (id, organization_id),
  foreign key (ledger_id, organization_id) references public.client_fund_ledgers (id, organization_id),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id),
  foreign key (person_id, organization_id) references public.persons (id, organization_id)
);
comment on table public.client_fund_receipts is
  'Receipts for advance payments (CICC Code s. 32(b)), one per verified deposit, RC-0001 per firm. Append-only; names are copied when issued.';

create index client_fund_receipts_entry_org_fk_idx on public.client_fund_receipts (entry_id, organization_id);
create index client_fund_receipts_ledger_org_fk_idx on public.client_fund_receipts (ledger_id, organization_id);
create index client_fund_receipts_matter_org_fk_idx on public.client_fund_receipts (matter_id, organization_id);
create index client_fund_receipts_person_org_fk_idx on public.client_fund_receipts (person_id, organization_id);
create index client_fund_receipts_issued_by_idx on public.client_fund_receipts (issued_by);
create index client_fund_receipts_created_by_idx on public.client_fund_receipts (created_by);

create table public.client_fund_bank_transfers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  entry_id uuid not null unique,
  ledger_id uuid not null,
  matter_id uuid not null,
  invoice_id uuid not null,
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 99999999999),
  transferred_on date not null,
  bank_reference text not null check (length(btrim(bank_reference)) between 1 and 80),
  note text check (note is null or length(note) <= 500),
  -- The s. 32(g) date when it was recorded: invoice issue date + 30 days.
  withdraw_by date not null,
  recorded_by uuid not null references auth.users (id),
  is_sample boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  unique (id, organization_id),
  foreign key (entry_id, organization_id) references public.client_fund_entries (id, organization_id),
  foreign key (ledger_id, organization_id) references public.client_fund_ledgers (id, organization_id),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id),
  foreign key (invoice_id, organization_id) references public.invoices (id, organization_id)
);
comment on table public.client_fund_bank_transfers is
  'The bank transfer out of the client account for an approved earned-fee transfer, recorded once by billing staff. Append-only.';

create index client_fund_bank_transfers_entry_org_fk_idx on public.client_fund_bank_transfers (entry_id, organization_id);
create index client_fund_bank_transfers_ledger_org_fk_idx on public.client_fund_bank_transfers (ledger_id, organization_id);
create index client_fund_bank_transfers_matter_org_fk_idx on public.client_fund_bank_transfers (matter_id, organization_id);
create index client_fund_bank_transfers_invoice_org_fk_idx on public.client_fund_bank_transfers (invoice_id, organization_id);
create index client_fund_bank_transfers_recorded_by_idx on public.client_fund_bank_transfers (recorded_by);
create index client_fund_bank_transfers_created_by_idx on public.client_fund_bank_transfers (created_by);

create function app.reject_client_fund_record_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% rows are append-only', tg_table_name using errcode = '42501';
end;
$$;
revoke all on function app.reject_client_fund_record_change() from public;

create trigger client_fund_receipts_stamp before insert on public.client_fund_receipts
  for each row execute function app.stamp_created_by();
create trigger client_fund_receipts_audit after insert or update or delete on public.client_fund_receipts
  for each row execute function app.audit_row_change();
create trigger client_fund_receipts_append_only before update or delete on public.client_fund_receipts
  for each row execute function app.reject_client_fund_record_change();

create trigger client_fund_bank_transfers_stamp before insert on public.client_fund_bank_transfers
  for each row execute function app.stamp_created_by();
create trigger client_fund_bank_transfers_audit after insert or update or delete on public.client_fund_bank_transfers
  for each row execute function app.audit_row_change();
create trigger client_fund_bank_transfers_append_only before update or delete on public.client_fund_bank_transfers
  for each row execute function app.reject_client_fund_record_change();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- s. 32(g): "not later than 30 days after the day on which the client is invoiced". The day the
-- client is invoiced is invoices.issued_on (the firm's date). Day 30 after it is the last day.
create function app.client_funds_withdraw_by(p_invoiced_on date)
returns date
language sql
immutable
set search_path = ''
as $$
  select p_invoiced_on + 30;
$$;
revoke all on function app.client_funds_withdraw_by(date) from public;

create function app.next_client_fund_receipt_number(p_org uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_number integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('casevoya.client_fund_receipt:' || p_org::text, 0));
  select coalesce(max(substring(receipt.number from 4)::integer), 0) + 1 into next_number
  from public.client_fund_receipts receipt
  where receipt.organization_id = p_org;
  return 'RC-' || lpad(next_number::text, 4, '0');
end;
$$;
revoke all on function app.next_client_fund_receipt_number(uuid) from public;

-- Issues the receipt for a verified deposit, once. Returns the receipt id.
create function app.issue_client_fund_receipt(p_entry_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  entry public.client_fund_entries%rowtype;
  existing uuid;
  rid uuid;
begin
  select * into entry from public.client_fund_entries where id = p_entry_id;
  if entry.id is null or entry.kind <> 'deposit' or entry.status <> 'verified' then
    raise exception 'only a verified deposit gets a receipt' using errcode = '22023';
  end if;
  select receipt.id into existing from public.client_fund_receipts receipt where receipt.entry_id = entry.id;
  if existing is not null then
    return existing;
  end if;
  insert into public.client_fund_receipts (
    organization_id, entry_id, ledger_id, matter_id, person_id, number, issued_at, issued_by,
    received_on, amount_cents, currency, method, external_reference,
    client_name, matter_label, firm_legal_name, firm_display_name, firm_timezone,
    consultant_name, consultant_licence, account_label, account_institution, account_last4, is_sample
  )
  select
    entry.organization_id, entry.id, entry.ledger_id, entry.matter_id, entry.person_id,
    app.next_client_fund_receipt_number(entry.organization_id), coalesce(entry.verified_at, clock_timestamp()), entry.verified_by,
    entry.occurred_on, entry.amount_cents, entry.currency, entry.method, entry.external_reference,
    left(person.display_name, 300),
    left(coalesce(nullif(concat_ws(' · ', nullif(btrim(coalesce(matter.reference, '')), ''), nullif(btrim(coalesce(matter.title, '')), '')), ''), 'Matter'), 300),
    org.legal_name, org.display_name, coalesce(nullif(btrim(coalesce(org.timezone, '')), ''), 'America/Toronto'),
    (
      select left(nullif(btrim(coalesce(prof.display_name, '')), ''), 200)
      from public.memberships mem
      left join public.profiles prof on prof.id = mem.user_id
      where mem.id = matter.responsible_consultant_membership_id
        and mem.organization_id = matter.organization_id
    ),
    (
      select credential.licence_type::text || ' ' || credential.college_id
      from public.consultant_credentials credential
      where credential.membership_id = matter.responsible_consultant_membership_id
        and credential.organization_id = matter.organization_id
      order by credential.declared_at desc
      limit 1
    ),
    account.label, account.institution, account.account_last4, entry.is_sample
  from public.persons person
  join public.matters matter on matter.id = entry.matter_id and matter.organization_id = entry.organization_id
  join public.organizations org on org.id = entry.organization_id
  join public.client_accounts account on account.id = entry.client_account_id and account.organization_id = entry.organization_id
  where person.id = entry.person_id and person.organization_id = entry.organization_id
  returning id into rid;
  perform app.record_audit_event(
    entry.organization_id, 'client_funds.receipt_issued', 'public.client_fund_receipts', rid, 'success',
    jsonb_build_object('entry_id', entry.id, 'amount_cents', entry.amount_cents)
  );
  return rid;
end;
$$;
revoke all on function app.issue_client_fund_receipt(uuid) from public;

-- ---------------------------------------------------------------------------
-- Verify a deposit (replaces 20261019120100's definition; same behaviour plus the second-person
-- rule, the owner's own-entry exception, and the receipt).
-- ---------------------------------------------------------------------------

create or replace function app.verify_client_deposit(p_entry_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  entry public.client_fund_entries%rowtype;
  actor uuid := (select auth.uid());
  owner_self boolean := false;
begin
  select * into entry from public.client_fund_entries where id = p_entry_id;
  perform app.require_client_funds_access(entry.matter_id, false);
  perform 1 from public.client_fund_ledgers where id = entry.ledger_id for update;
  select * into entry from public.client_fund_entries where id = p_entry_id for update;
  if entry.kind <> 'deposit' or entry.status <> 'pending_verification' then
    raise exception 'only a deposit pending verification can be verified' using errcode = '22023';
  end if;
  if entry.requested_by = actor then
    if app.has_org_role(entry.organization_id, array['firm_owner']::public.org_role[]) is distinct from true then
      raise exception 'the person who recorded a deposit cannot verify it' using errcode = '42501';
    end if;
    owner_self := true;
  end if;
  update public.client_fund_entries
  set status = 'verified', verified_by = actor, verified_at = clock_timestamp(), verified_by_owner_self = owner_self
  where id = entry.id;
  perform app.record_audit_event(
    entry.organization_id,
    case when owner_self then 'client_funds.deposit_verified_owner_self' else 'client_funds.deposit_verified' end,
    'public.client_fund_entries', entry.id, 'success',
    jsonb_build_object('amount_cents', entry.amount_cents, 'recorded_by', entry.requested_by, 'verified_by_owner_self', owner_self)
  );
  perform app.issue_client_fund_receipt(entry.id);
  return entry.id;
end;
$$;
revoke all on function app.verify_client_deposit(uuid) from public;

-- ---------------------------------------------------------------------------
-- Record the bank transfer for an approved earned-fee transfer
-- ---------------------------------------------------------------------------

create function app.record_client_transfer_bank(p_entry_id uuid, p_transferred_on date, p_reference text, p_note text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  entry public.client_fund_entries%rowtype;
  invoice public.invoices%rowtype;
  existing public.client_fund_bank_transfers%rowtype;
  reference text := btrim(coalesce(p_reference, ''));
  note text := nullif(btrim(coalesce(p_note, '')), '');
  due date;
  rid uuid;
begin
  select * into entry from public.client_fund_entries where id = p_entry_id;
  perform app.require_client_funds_access(entry.matter_id, true);
  select * into entry from public.client_fund_entries where id = p_entry_id for update;
  select * into existing from public.client_fund_bank_transfers where entry_id = entry.id;
  if existing.id is not null then
    if existing.transferred_on = p_transferred_on and existing.bank_reference = reference then
      return existing.id;
    end if;
    raise exception 'the bank transfer was already recorded' using errcode = '22023';
  end if;
  if entry.kind <> 'transfer' or entry.status <> 'approved' then
    raise exception 'only an approved transfer has a bank transfer to record' using errcode = '22023';
  end if;
  if app.sample_mode_blocks_real(entry.organization_id, entry.is_sample) then
    raise exception 'this firm is in sample mode; only sample matters take client funds' using errcode = '42501';
  end if;
  if length(reference) not between 1 and 80 then
    raise exception 'the bank reference is required' using errcode = '22023';
  end if;
  if note is not null and length(note) > 500 then
    raise exception 'note is too long' using errcode = '22023';
  end if;
  select * into invoice from public.invoices where id = entry.invoice_id and organization_id = entry.organization_id;
  if p_transferred_on is null or p_transferred_on > app.client_funds_today(entry.organization_id) then
    raise exception 'transfer date can''t be in the future' using errcode = '22023';
  end if;
  if invoice.issued_on is not null and p_transferred_on < invoice.issued_on then
    raise exception 'the bank transfer can''t be dated before the invoice (CICC Code s. 32(f))' using errcode = '22023';
  end if;
  due := app.client_funds_withdraw_by(coalesce(invoice.issued_on, entry.occurred_on));
  insert into public.client_fund_bank_transfers (
    organization_id, entry_id, ledger_id, matter_id, invoice_id, amount_cents, transferred_on,
    bank_reference, note, withdraw_by, recorded_by, is_sample
  ) values (
    entry.organization_id, entry.id, entry.ledger_id, entry.matter_id, entry.invoice_id, entry.amount_cents, p_transferred_on,
    reference, note, due, (select auth.uid()), entry.is_sample
  )
  returning id into rid;
  perform app.record_audit_event(
    entry.organization_id, 'client_funds.bank_transfer_recorded', 'public.client_fund_bank_transfers', rid, 'success',
    jsonb_build_object(
      'entry_id', entry.id, 'invoice_id', entry.invoice_id, 'amount_cents', entry.amount_cents,
      'transferred_on', p_transferred_on, 'withdraw_by', due, 'after_withdraw_by', p_transferred_on > due
    )
  );
  return rid;
end;
$$;
revoke all on function app.record_client_transfer_bank(uuid, date, text, text) from public;

-- ---------------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------------

-- What is still to be withdrawn from the client account, with the s. 32(g) date, for matters the
-- caller bills (firm owner, the matter's finance user; aal2). Others get no rows.
--   awaiting_approval       a transfer asked for and not yet approved or declined
--   awaiting_bank_transfer  an approved transfer whose bank transfer isn't recorded
--   not_requested           an issued invoice with an amount due, on a matter where the firm holds
--                           client money that no transfer has been asked for; the amount is the
--                           smaller of what is due and what is held for that matter
create function public.list_client_fund_withdrawals()
returns table (
  organization_id uuid,
  matter_id uuid,
  ledger_id uuid,
  person_id uuid,
  invoice_id uuid,
  invoice_number text,
  entry_id uuid,
  entry_number text,
  state text,
  amount_cents bigint,
  invoiced_on date,
  withdraw_by date,
  days_left integer,
  overdue boolean,
  is_sample boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with transfers as (
    select entry.organization_id, entry.matter_id, entry.ledger_id, entry.person_id, invoice.id as invoice_id,
           invoice.number as invoice_number, entry.id as entry_id, entry.number as entry_number,
           case entry.status when 'pending_approval' then 'awaiting_approval' else 'awaiting_bank_transfer' end as state,
           entry.amount_cents, invoice.issued_on as invoiced_on, entry.is_sample
    from public.client_fund_entries entry
    join public.invoices invoice on invoice.id = entry.invoice_id and invoice.organization_id = entry.organization_id
    where entry.kind = 'transfer'
      and entry.organization_id = (select app.current_organization_id())
      and invoice.issued_on is not null
      and (
        entry.status = 'pending_approval'
        or (entry.status = 'approved' and not exists (
          select 1 from public.client_fund_bank_transfers bank where bank.entry_id = entry.id
        ))
      )
  ),
  held as (
    select ledger.matter_id, sum(greatest(totals.balance - totals.pending_out, 0))::bigint as available
    from public.client_fund_ledgers ledger
    cross join lateral app.client_fund_ledger_totals(ledger.id) totals
    where ledger.organization_id = (select app.current_organization_id())
    group by ledger.matter_id
  ),
  invoice_rows as (
    select invoice.organization_id, invoice.matter_id, null::uuid as ledger_id, null::uuid as person_id,
           invoice.id as invoice_id, invoice.number as invoice_number, null::uuid as entry_id, null::text as entry_number,
           'not_requested'::text as state,
           least(
             invoice.amount_cents - invoice.paid_cents - coalesce((
               select sum(entry.amount_cents) from public.client_fund_entries entry
               where entry.invoice_id = invoice.id and entry.kind = 'transfer' and entry.status = 'pending_approval'
             ), 0),
             held.available
           )::bigint as amount_cents,
           invoice.issued_on as invoiced_on, invoice.is_sample
    from public.invoices invoice
    join held on held.matter_id = invoice.matter_id
    where invoice.organization_id = (select app.current_organization_id())
      and invoice.status in ('issued', 'partially_paid')
      and invoice.issued_on is not null
      and invoice.currency = 'CAD'
  ),
  due_rows as (
    select * from transfers
    union all
    select * from invoice_rows where invoice_rows.amount_cents > 0
  )
  select item.organization_id, item.matter_id, item.ledger_id, item.person_id, item.invoice_id, item.invoice_number,
         item.entry_id, item.entry_number, item.state, item.amount_cents, item.invoiced_on,
         app.client_funds_withdraw_by(item.invoiced_on),
         (app.client_funds_withdraw_by(item.invoiced_on) - app.client_funds_today(item.organization_id))::integer,
         app.client_funds_today(item.organization_id) > app.client_funds_withdraw_by(item.invoiced_on),
         item.is_sample
  from due_rows item
  where app.can_read_matter_billing(item.matter_id)
  order by app.client_funds_withdraw_by(item.invoiced_on), item.invoice_number, item.entry_number nulls last;
$$;
comment on function public.list_client_fund_withdrawals() is
  'Client-account withdrawals still to make, with the CICC Code s. 32(g) date (invoice date + 30 days). Billing staff only.';

-- The receipt, for the PDF. Billing staff of the matter, or the client whose money it is. Each read
-- is audited as client_funds.receipt_read.
create function public.client_fund_receipt(p_entry_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  receipt public.client_fund_receipts%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'sign in is required' using errcode = '42501';
  end if;
  select * into receipt from public.client_fund_receipts where entry_id = p_entry_id;
  if receipt.id is null
     or receipt.organization_id is distinct from (select app.current_organization_id())
     or not (app.can_read_matter_billing(receipt.matter_id) or app.is_own_person(receipt.person_id)) then
    raise exception 'receipt access denied' using errcode = '42501';
  end if;
  perform app.record_audit_event(
    receipt.organization_id, 'client_funds.receipt_read', 'public.client_fund_receipts', receipt.id, 'success', '{}'::jsonb
  );
  return jsonb_build_object(
    'number', receipt.number,
    'issued_at', receipt.issued_at,
    'received_on', receipt.received_on,
    'amount_cents', receipt.amount_cents,
    'currency', receipt.currency,
    'method', receipt.method,
    'reference', receipt.external_reference,
    'client_name', receipt.client_name,
    'matter_label', receipt.matter_label,
    'firm_legal_name', receipt.firm_legal_name,
    'firm_display_name', receipt.firm_display_name,
    'firm_timezone', receipt.firm_timezone,
    'consultant_name', receipt.consultant_name,
    'consultant_licence', receipt.consultant_licence,
    'account_label', receipt.account_label,
    'account_institution', receipt.account_institution,
    'account_last4', receipt.account_last4,
    'is_sample', receipt.is_sample
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Receipts for deposits verified before this migration (none on the live project; kept so the
-- rule holds for every verified deposit). Numbered in the order they were verified.
-- ---------------------------------------------------------------------------

do $backfill$
declare
  entry_id uuid;
begin
  for entry_id in
    select entry.id from public.client_fund_entries entry
    where entry.kind = 'deposit' and entry.status = 'verified'
      and not exists (select 1 from public.client_fund_receipts receipt where receipt.entry_id = entry.id)
    order by entry.organization_id, entry.verified_at, entry.created_at
  loop
    perform app.issue_client_fund_receipt(entry_id);
  end loop;
end
$backfill$;

-- ---------------------------------------------------------------------------
-- Public wrappers and grants
-- ---------------------------------------------------------------------------

create function public.record_client_transfer_bank(p_entry_id uuid, p_transferred_on date, p_reference text, p_note text)
returns uuid language sql security invoker set search_path = ''
as $$ select app.record_client_transfer_bank(p_entry_id, p_transferred_on, p_reference, p_note); $$;

revoke all on function public.record_client_transfer_bank(uuid, date, text, text) from public, anon;
revoke all on function public.list_client_fund_withdrawals() from public, anon;
revoke all on function public.client_fund_receipt(uuid) from public, anon;

grant execute on function public.record_client_transfer_bank(uuid, date, text, text) to authenticated;
grant execute on function public.list_client_fund_withdrawals() to authenticated, service_role;
grant execute on function public.client_fund_receipt(uuid) to authenticated;

grant execute on function app.client_funds_withdraw_by(date) to authenticated, service_role;
grant execute on function app.next_client_fund_receipt_number(uuid) to authenticated;
grant execute on function app.issue_client_fund_receipt(uuid) to authenticated;
grant execute on function app.record_client_transfer_bank(uuid, date, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Table privileges and row-level security
-- ---------------------------------------------------------------------------

revoke all on table public.client_fund_receipts from anon, authenticated, service_role;
revoke all on table public.client_fund_bank_transfers from anon, authenticated, service_role;
grant select on table public.client_fund_receipts to authenticated, service_role;
grant select on table public.client_fund_bank_transfers to authenticated, service_role;

alter table public.client_fund_receipts enable row level security;
alter table public.client_fund_receipts force row level security;
alter table public.client_fund_bank_transfers enable row level security;
alter table public.client_fund_bank_transfers force row level security;

-- Billing staff of the matter, or the client whose deposit it is.
create policy client_fund_receipts_select on public.client_fund_receipts
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (
      (select app.can_read_matter_billing(matter_id))
      or (select app.is_own_person(person_id))
    )
  );

-- Billing staff of the matter only.
create policy client_fund_bank_transfers_select on public.client_fund_bank_transfers
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.can_read_matter_billing(matter_id))
  );
