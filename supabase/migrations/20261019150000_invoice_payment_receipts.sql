-- Receipts for payments of invoices (CICC Code s. 33(3)).
--
-- Rule quoted from the Code of Professional Conduct for College of Immigration and Citizenship
-- Consultants Licensees, SOR/2022-128 (https://laws-lois.justice.gc.ca/eng/regulations/sor-2022-128/FullText.html,
-- retrieved 2026-10-18, "Regulations are current to 2026-09-30"). See docs/legal/client-account-sources.md.
--
--   s. 33(3) "When a payment is received from a client, the licensee must provide the client with a
--            receipt that clearly indicates the invoice to which the payment relates."
--
-- What the Code requires is the invoice the payment relates to. Everything else on the receipt
-- (amount, date paid, method, firm, licensee and CICC licence, client, matter) is a product choice,
-- the same set the advance receipt (RC-, s. 32(b)) carries.
--
-- Two ways an invoice gets paid, and each issues one receipt (invoice_payment_receipts, PR-0001 per
-- firm, a series separate from the RC- advance receipts):
--   * a card payment that succeeded: invoice_payments.status becomes 'succeeded' (only
--     app.apply_stripe_payment_event, from a verified Stripe webhook event, does that);
--   * an earned-fee transfer from the client account that was approved and applied to the invoice:
--     client_fund_entries kind 'transfer' becomes 'approved' (app.approve_client_transfer).
-- Both are AFTER triggers on those rows, so neither app.apply_stripe_payment_event nor
-- app.approve_client_transfer nor app.verify_client_deposit is replaced here. A replayed webhook
-- event changes nothing (the payment is already succeeded, so the trigger's WHEN never matches),
-- and the issuing function returns the existing receipt if it is ever called twice.
--
-- The firm, licensee, client, matter and invoice are copied onto the receipt when it is issued, so
-- a later rename never changes it. Receipts are append-only: a later refund or dispute is its own
-- record (invoice_refunds, invoice_disputes) and the receipt stays as issued.
--
-- Card details: Casevoya stores no card data on invoice_payments (no brand, no last four), so the
-- method reads "Card". Nothing about the card is copied here.
--
-- Email: not sent. app.issue_invoice_payment_receipt is the one place a receipt is created; an
-- outbox event (for example invoice.payment_receipt_issued) can be enqueued there once the mail
-- template exists, without touching the triggers.
--
-- Read: the matter's billing staff (firm owner, the matter's finance user, aal2) and the client who
-- paid (the person on the matter signed in as the user who started the card payment, otherwise the
-- matter's applicant; for a transfer, the client whose client-account money it was). Each read
-- through public.invoice_payment_receipt is audited. In sample mode, receipts carry is_sample from
-- the invoice.
--
-- Nothing here changes a matter's stage or a government status. Additive only.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table public.invoice_payment_receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  number text not null check (number ~ '^PR-[0-9]{4,9}$'),
  source text not null check (source in ('card', 'client_funds')),
  payment_id uuid unique,
  entry_id uuid unique,
  invoice_id uuid not null,
  matter_id uuid not null,
  person_id uuid,
  issued_at timestamptz not null default now(),
  issued_by uuid references auth.users (id),
  paid_at timestamptz not null,
  paid_on date not null,
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 99999999999),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  method text not null check (method in ('card', 'client_account')),
  reference text check (reference is null or length(btrim(reference)) between 1 and 255),
  invoice_number text not null check (invoice_number ~ '^INV-[0-9]{4,9}$'),
  invoice_description text not null check (length(btrim(invoice_description)) between 1 and 500),
  invoice_issued_on date,
  invoice_amount_cents bigint not null check (invoice_amount_cents > 0),
  client_name text not null check (length(btrim(client_name)) between 1 and 300),
  matter_label text not null check (length(btrim(matter_label)) between 1 and 300),
  firm_legal_name text not null check (length(btrim(firm_legal_name)) between 1 and 300),
  firm_display_name text not null check (length(btrim(firm_display_name)) between 1 and 200),
  firm_timezone text not null,
  consultant_name text check (consultant_name is null or length(consultant_name) <= 200),
  consultant_licence text check (consultant_licence is null or length(consultant_licence) <= 80),
  account_label text check (account_label is null or length(btrim(account_label)) between 1 and 80),
  account_institution text check (account_institution is null or length(btrim(account_institution)) between 1 and 120),
  account_last4 text check (account_last4 is null or account_last4 ~ '^[0-9]{4}$'),
  is_sample boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  unique (id, organization_id),
  unique (organization_id, number),
  check (
    (source = 'card' and payment_id is not null and entry_id is null and method = 'card'
      and account_label is null and account_institution is null and account_last4 is null)
    or (source = 'client_funds' and entry_id is not null and payment_id is null and method = 'client_account'
      and account_label is not null and account_institution is not null and account_last4 is not null)
  ),
  foreign key (payment_id, organization_id) references public.invoice_payments (id, organization_id),
  foreign key (entry_id, organization_id) references public.client_fund_entries (id, organization_id),
  foreign key (invoice_id, organization_id) references public.invoices (id, organization_id),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id),
  foreign key (person_id, organization_id) references public.persons (id, organization_id)
);
comment on table public.invoice_payment_receipts is
  'Receipts for payments of invoices (CICC Code s. 33(3)): one per succeeded card payment or approved client-account transfer, PR-0001 per firm. Append-only; names are copied when issued.';

create index invoice_payment_receipts_payment_org_fk_idx on public.invoice_payment_receipts (payment_id, organization_id);
create index invoice_payment_receipts_entry_org_fk_idx on public.invoice_payment_receipts (entry_id, organization_id);
create index invoice_payment_receipts_invoice_org_fk_idx on public.invoice_payment_receipts (invoice_id, organization_id);
create index invoice_payment_receipts_matter_org_fk_idx on public.invoice_payment_receipts (matter_id, organization_id);
create index invoice_payment_receipts_person_org_fk_idx on public.invoice_payment_receipts (person_id, organization_id);
create index invoice_payment_receipts_issued_by_idx on public.invoice_payment_receipts (issued_by);
create index invoice_payment_receipts_created_by_idx on public.invoice_payment_receipts (created_by);

create trigger invoice_payment_receipts_stamp before insert on public.invoice_payment_receipts
  for each row execute function app.stamp_created_by();
create trigger invoice_payment_receipts_audit after insert or update or delete on public.invoice_payment_receipts
  for each row execute function app.audit_row_change();
create trigger invoice_payment_receipts_append_only before update or delete on public.invoice_payment_receipts
  for each row execute function app.reject_client_fund_record_change();

-- ---------------------------------------------------------------------------
-- Issuing
-- ---------------------------------------------------------------------------

create function app.next_invoice_payment_receipt_number(p_org uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_number integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('casevoya.invoice_payment_receipt:' || p_org::text, 0));
  select coalesce(max(substring(receipt.number from 4)::integer), 0) + 1 into next_number
  from public.invoice_payment_receipts receipt
  where receipt.organization_id = p_org;
  return 'PR-' || lpad(next_number::text, 4, '0');
end;
$$;
revoke all on function app.next_invoice_payment_receipt_number(uuid) from public, anon, authenticated;

-- The firm's local date of a moment, in its timezone (America/Toronto when unset or invalid).
create function app.firm_local_date(p_org uuid, p_at timestamptz)
returns date
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  zone text;
begin
  select org.timezone into zone from public.organizations org where org.id = p_org;
  begin
    return (p_at at time zone coalesce(nullif(btrim(zone), ''), 'America/Toronto'))::date;
  exception when others then
    return (p_at at time zone 'America/Toronto')::date;
  end;
end;
$$;
revoke all on function app.firm_local_date(uuid, timestamptz) from public, anon, authenticated;

-- Issues the receipt for one payment of an invoice, once. Exactly one of p_payment_id (a succeeded
-- card payment) or p_entry_id (an approved client-account transfer) is given. Returns the receipt
-- id; a second call for the same payment returns the first receipt.
--
-- Email hook: when the receipt mail template exists, enqueue its outbox event here, after the
-- insert (the receipt row is the event's aggregate; the mail needs no card or bank data).
create function app.issue_invoice_payment_receipt(p_payment_id uuid, p_entry_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  payment public.invoice_payments%rowtype;
  entry public.client_fund_entries%rowtype;
  invoice public.invoices%rowtype;
  matter public.matters%rowtype;
  org public.organizations%rowtype;
  account public.client_accounts%rowtype;
  payer uuid;
  payer_name text;
  existing uuid;
  rid uuid;
  v_source text;
  v_paid_at timestamptz;
  v_amount bigint;
  v_currency text;
  v_reference text;
  v_issued_by uuid;
begin
  if (p_payment_id is null) = (p_entry_id is null) then
    raise exception 'name one payment' using errcode = '22023';
  end if;

  if p_payment_id is not null then
    select * into payment from public.invoice_payments where id = p_payment_id;
    if payment.id is null or payment.status <> 'succeeded' or payment.amount_received_cents <= 0 then
      raise exception 'only a succeeded card payment gets a receipt' using errcode = '22023';
    end if;
    select receipt.id into existing from public.invoice_payment_receipts receipt where receipt.payment_id = payment.id;
    if existing is not null then
      return existing;
    end if;
    select * into invoice from public.invoices where id = payment.invoice_id and organization_id = payment.organization_id;
    v_source := 'card';
    v_paid_at := coalesce(payment.succeeded_at, payment.updated_at, clock_timestamp());
    v_amount := payment.amount_received_cents;
    v_currency := payment.currency;
    v_reference := payment.payment_intent_id;
    v_issued_by := null;
    -- The client who paid: the person on the matter signed in as the user who started the payment;
    -- otherwise (for example a payment recovered from the webhook) the matter's applicant.
    select person.id into payer
    from public.matter_participants party
    join public.persons person on person.id = party.person_id and person.organization_id = party.organization_id
    where party.matter_id = invoice.matter_id
      and party.organization_id = invoice.organization_id
      and payment.created_by is not null
      and person.user_id = payment.created_by
    order by (party.role = 'applicant') desc, party.created_at
    limit 1;
    if payer is null then
      select party.person_id into payer
      from public.matter_participants party
      where party.matter_id = invoice.matter_id
        and party.organization_id = invoice.organization_id
        and party.person_id is not null
        and party.role = 'applicant'
      order by party.created_at, party.id
      limit 1;
    end if;
  else
    select * into entry from public.client_fund_entries where id = p_entry_id;
    if entry.id is null or entry.kind <> 'transfer' or entry.status <> 'approved' or entry.invoice_id is null then
      raise exception 'only an approved client-account transfer gets a receipt' using errcode = '22023';
    end if;
    select receipt.id into existing from public.invoice_payment_receipts receipt where receipt.entry_id = entry.id;
    if existing is not null then
      return existing;
    end if;
    select * into invoice from public.invoices where id = entry.invoice_id and organization_id = entry.organization_id;
    select * into account from public.client_accounts where id = entry.client_account_id and organization_id = entry.organization_id;
    v_source := 'client_funds';
    v_paid_at := coalesce(entry.approved_at, clock_timestamp());
    v_amount := entry.amount_cents;
    v_currency := entry.currency;
    v_reference := entry.number;
    v_issued_by := entry.approved_by;
    payer := entry.person_id;
  end if;

  if invoice.id is null then
    raise exception 'the payment''s invoice was not found' using errcode = '22023';
  end if;
  select * into matter from public.matters where id = invoice.matter_id and organization_id = invoice.organization_id;
  select * into org from public.organizations where id = invoice.organization_id;
  if payer is not null then
    select left(nullif(btrim(coalesce(person.display_name, '')), ''), 300) into payer_name
    from public.persons person where person.id = payer and person.organization_id = invoice.organization_id;
  end if;

  insert into public.invoice_payment_receipts (
    organization_id, number, source, payment_id, entry_id, invoice_id, matter_id, person_id,
    issued_at, issued_by, paid_at, paid_on, amount_cents, currency, method, reference,
    invoice_number, invoice_description, invoice_issued_on, invoice_amount_cents,
    client_name, matter_label, firm_legal_name, firm_display_name, firm_timezone,
    consultant_name, consultant_licence, account_label, account_institution, account_last4, is_sample
  ) values (
    invoice.organization_id,
    app.next_invoice_payment_receipt_number(invoice.organization_id),
    v_source,
    case when v_source = 'card' then payment.id end,
    case when v_source = 'client_funds' then entry.id end,
    invoice.id,
    invoice.matter_id,
    payer,
    clock_timestamp(),
    v_issued_by,
    v_paid_at,
    app.firm_local_date(invoice.organization_id, v_paid_at),
    v_amount,
    v_currency,
    case when v_source = 'card' then 'card' else 'client_account' end,
    v_reference,
    invoice.number,
    invoice.description,
    invoice.issued_on,
    invoice.amount_cents,
    coalesce(payer_name, 'Client'),
    left(coalesce(nullif(concat_ws(' · ', nullif(btrim(coalesce(matter.reference, '')), ''), nullif(btrim(coalesce(matter.title, '')), '')), ''), 'Matter'), 300),
    org.legal_name,
    org.display_name,
    coalesce(nullif(btrim(coalesce(org.timezone, '')), ''), 'America/Toronto'),
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
    case when v_source = 'client_funds' then account.label end,
    case when v_source = 'client_funds' then account.institution end,
    case when v_source = 'client_funds' then account.account_last4 end,
    invoice.is_sample
  )
  returning id into rid;

  perform app.record_audit_event(
    invoice.organization_id, 'invoice.payment_receipt_issued', 'public.invoice_payment_receipts', rid, 'success',
    jsonb_build_object('invoice_id', invoice.id, 'source', v_source, 'amount_cents', v_amount, 'currency', v_currency)
  );
  return rid;
end;
$$;
revoke all on function app.issue_invoice_payment_receipt(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Triggers: the payment paths stay as they are and the receipt follows them
-- ---------------------------------------------------------------------------

create function app.invoice_payment_receipt_on_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.issue_invoice_payment_receipt(new.id, null);
  return null;
end;
$$;
revoke all on function app.invoice_payment_receipt_on_payment() from public, anon, authenticated;

create function app.invoice_payment_receipt_on_transfer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.issue_invoice_payment_receipt(null, new.id);
  return null;
end;
$$;
revoke all on function app.invoice_payment_receipt_on_transfer() from public, anon, authenticated;

-- A card payment becomes succeeded (only app.apply_stripe_payment_event does this). A succeeded
-- payment never moves back, so this fires once per payment.
create trigger invoice_payments_receipt_on_success after update of status on public.invoice_payments
  for each row
  when (new.status = 'succeeded' and old.status is distinct from 'succeeded' and new.amount_received_cents > 0)
  execute function app.invoice_payment_receipt_on_payment();
create trigger invoice_payments_receipt_on_insert after insert on public.invoice_payments
  for each row
  when (new.status = 'succeeded' and new.amount_received_cents > 0)
  execute function app.invoice_payment_receipt_on_payment();

-- An earned-fee transfer is approved and applied to its invoice (app.approve_client_transfer).
create trigger client_fund_entries_receipt_on_approval after update of status on public.client_fund_entries
  for each row
  when (new.kind = 'transfer' and new.status = 'approved' and old.status is distinct from 'approved')
  execute function app.invoice_payment_receipt_on_transfer();
create trigger client_fund_entries_receipt_on_insert after insert on public.client_fund_entries
  for each row
  when (new.kind = 'transfer' and new.status = 'approved')
  execute function app.invoice_payment_receipt_on_transfer();

-- ---------------------------------------------------------------------------
-- Read: the receipt, for the PDF. Billing staff of the matter, or the client who paid. Each read
-- is audited as invoice.payment_receipt_read.
-- ---------------------------------------------------------------------------

create function public.invoice_payment_receipt(p_receipt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  receipt public.invoice_payment_receipts%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'sign in is required' using errcode = '42501';
  end if;
  select * into receipt from public.invoice_payment_receipts where id = p_receipt_id;
  if receipt.id is null
     or receipt.organization_id is distinct from (select app.current_organization_id())
     or not (
       app.can_read_matter_billing(receipt.matter_id)
       or (receipt.person_id is not null and app.is_own_person(receipt.person_id))
     ) then
    raise exception 'receipt access denied' using errcode = '42501';
  end if;
  perform app.record_audit_event(
    receipt.organization_id, 'invoice.payment_receipt_read', 'public.invoice_payment_receipts', receipt.id, 'success', '{}'::jsonb
  );
  return jsonb_build_object(
    'number', receipt.number,
    'source', receipt.source,
    'issued_at', receipt.issued_at,
    'paid_at', receipt.paid_at,
    'paid_on', receipt.paid_on,
    'amount_cents', receipt.amount_cents,
    'currency', receipt.currency,
    'method', receipt.method,
    'reference', receipt.reference,
    'invoice_number', receipt.invoice_number,
    'invoice_description', receipt.invoice_description,
    'invoice_issued_on', receipt.invoice_issued_on,
    'invoice_amount_cents', receipt.invoice_amount_cents,
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
comment on function public.invoice_payment_receipt(uuid) is
  'An invoice payment receipt (CICC Code s. 33(3)) for the PDF. Billing staff of the matter or the client who paid; audited.';
revoke all on function public.invoice_payment_receipt(uuid) from public, anon;
grant execute on function public.invoice_payment_receipt(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Backfill: receipts for card payments that already succeeded and transfers already approved,
-- per firm in the order they were paid. None exist on the live project (these tables are not
-- applied there yet); kept so the rule holds for every payment.
-- ---------------------------------------------------------------------------

do $backfill$
declare
  item record;
begin
  for item in
    select paid.payment_id, paid.entry_id
    from (
      select payment.organization_id, payment.id as payment_id, null::uuid as entry_id,
             coalesce(payment.succeeded_at, payment.updated_at) as paid_at, payment.created_at
      from public.invoice_payments payment
      where payment.status = 'succeeded' and payment.amount_received_cents > 0
        and not exists (select 1 from public.invoice_payment_receipts receipt where receipt.payment_id = payment.id)
      union all
      select entry.organization_id, null::uuid, entry.id, entry.approved_at, entry.created_at
      from public.client_fund_entries entry
      where entry.kind = 'transfer' and entry.status = 'approved'
        and not exists (select 1 from public.invoice_payment_receipts receipt where receipt.entry_id = entry.id)
    ) paid
    order by paid.organization_id, paid.paid_at, paid.created_at
  loop
    perform app.issue_invoice_payment_receipt(item.payment_id, item.entry_id);
  end loop;
end
$backfill$;

-- ---------------------------------------------------------------------------
-- Table privileges and row-level security
-- ---------------------------------------------------------------------------

revoke all on table public.invoice_payment_receipts from anon, authenticated, service_role;
grant select on table public.invoice_payment_receipts to authenticated, service_role;

alter table public.invoice_payment_receipts enable row level security;
alter table public.invoice_payment_receipts force row level security;

-- Billing staff of the matter, or the client who paid.
create policy invoice_payment_receipts_select on public.invoice_payment_receipts
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (
      (select app.can_read_matter_billing(matter_id))
      or (person_id is not null and (select app.is_own_person(person_id)))
    )
  );
