-- Card brand and last four digits on card payments and their receipts (decided by Francis,
-- 2026-10-18): a card receipt reads "Visa ••••4242" instead of "Card".
--
-- Only the card brand (Stripe's payment_method_details.card.brand, for example 'visa') and its
-- last four digits are stored. No expiry, fingerprint, name, country, wallet or any other card
-- data. Both or neither.
--
-- Where they come from: the Stripe webhook (src/modules/finance/webhook.ts). For a verified
-- payment_intent.succeeded event from a connected account it reads the card from the event when
-- present, otherwise retrieves the PaymentIntent with latest_charge expanded on the firm's
-- connected account (direct charge, `stripeAccount`). It then calls
-- public.record_invoice_payment_card BEFORE public.apply_stripe_payment_event, so the AFTER
-- trigger that issues the receipt (app.issue_invoice_payment_receipt, migration
-- 20261019150000_invoice_payment_receipts.sql) copies them onto the receipt. A failed lookup or
-- record never blocks the payment: the event is still applied and the card stays null ("Card").
--
-- Receipts stay append-only snapshots. One documented exception: a receipt issued before its
-- payment's card was known (PR- receipts issued before this migration, or a payment whose row the
-- webhook recovered from the PaymentIntent metadata, which has no row to record the card on until
-- the event is applied) may have card_brand / card_last4 filled ONCE, only while both are null and
-- only those two columns, by app.fill_invoice_payment_receipt_card (service_role only, audited as
-- invoice.payment_receipt_card_filled). Nothing else on a receipt can change.
-- scripts/ops/backfill-receipt-card-details.mjs uses that path for existing succeeded payments.
--
-- Replaced here (each copied from its latest definition):
--   app.reject_client_fund_record_change   20261019130000_client_funds_controls.sql
--   app.issue_invoice_payment_receipt      20261019150000_invoice_payment_receipts.sql
--   public.invoice_payment_receipt         20261019150000_invoice_payment_receipts.sql
-- app.apply_stripe_payment_event is not replaced. Additive only; RLS unchanged.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

alter table public.invoice_payments
  add column card_brand text check (card_brand is null or card_brand ~ '^[a-z0-9_]{1,40}$'),
  add column card_last4 text check (card_last4 is null or card_last4 ~ '^[0-9]{4}$');
alter table public.invoice_payments
  add constraint invoice_payments_card_both_or_neither check ((card_brand is null) = (card_last4 is null));
comment on column public.invoice_payments.card_brand is
  'Stripe card brand of the payment (e.g. visa), from the verified webhook. Brand and last 4 only; no other card data.';
comment on column public.invoice_payments.card_last4 is
  'Last four digits of the card, from the verified webhook. Brand and last 4 only; no other card data.';

alter table public.invoice_payment_receipts
  add column card_brand text check (card_brand is null or card_brand ~ '^[a-z0-9_]{1,40}$'),
  add column card_last4 text check (card_last4 is null or card_last4 ~ '^[0-9]{4}$');
alter table public.invoice_payment_receipts
  add constraint invoice_payment_receipts_card_both_or_neither check ((card_brand is null) = (card_last4 is null)),
  add constraint invoice_payment_receipts_card_only_for_card check (source = 'card' or card_brand is null);
comment on column public.invoice_payment_receipts.card_brand is
  'Card brand copied from the payment when the receipt was issued (or filled once by app.fill_invoice_payment_receipt_card while null).';
comment on column public.invoice_payment_receipts.card_last4 is
  'Last four digits of the card, copied like card_brand.';

-- ---------------------------------------------------------------------------
-- Append-only guard: one narrow exception for the one-time card fill
-- (copied from 20261019130000_client_funds_controls.sql)
-- ---------------------------------------------------------------------------

-- Every row of the tables it guards is append-only, except that app.fill_invoice_payment_receipt_card
-- may set card_brand and card_last4 on an invoice payment receipt whose card fields are both null,
-- changing nothing else. The function marks the one receipt it fills with a transaction-local
-- setting; no role but the table owner can update these tables anyway (no UPDATE grant or policy).
create or replace function app.reject_client_fund_record_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  before_row jsonb;
  after_row jsonb;
begin
  if tg_op = 'UPDATE' and tg_table_name = 'invoice_payment_receipts' then
    before_row := to_jsonb(old);
    after_row := to_jsonb(new);
    if coalesce(current_setting('casevoya.receipt_card_fill', true), '') = before_row ->> 'id'
       and before_row ->> 'card_brand' is null
       and before_row ->> 'card_last4' is null
       and after_row ->> 'card_brand' is not null
       and after_row ->> 'card_last4' is not null
       and (before_row - 'card_brand' - 'card_last4') = (after_row - 'card_brand' - 'card_last4') then
      return new;
    end if;
  end if;
  raise exception '% rows are append-only', tg_table_name using errcode = '42501';
end;
$$;
revoke all on function app.reject_client_fund_record_change() from public;

-- ---------------------------------------------------------------------------
-- Recording the card (service_role only)
-- ---------------------------------------------------------------------------

-- Fills a card receipt's brand and last 4 from its payment, once: only while both are null on the
-- receipt and known on the payment. Returns true when it filled them. Audited.
create function app.fill_invoice_payment_receipt_card(p_payment_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  payment public.invoice_payments%rowtype;
  receipt public.invoice_payment_receipts%rowtype;
begin
  select * into payment from public.invoice_payments where id = p_payment_id;
  if payment.id is null or payment.card_brand is null or payment.card_last4 is null then
    return false;
  end if;
  select * into receipt from public.invoice_payment_receipts where payment_id = payment.id for update;
  if receipt.id is null or receipt.source <> 'card' or receipt.card_brand is not null or receipt.card_last4 is not null then
    return false;
  end if;
  perform set_config('casevoya.receipt_card_fill', receipt.id::text, true);
  update public.invoice_payment_receipts
  set card_brand = payment.card_brand, card_last4 = payment.card_last4
  where id = receipt.id;
  perform set_config('casevoya.receipt_card_fill', '', true);
  perform app.record_audit_event(
    receipt.organization_id, 'invoice.payment_receipt_card_filled', 'public.invoice_payment_receipts', receipt.id, 'success',
    jsonb_build_object('payment_id', payment.id, 'card_brand', payment.card_brand)
  );
  return true;
end;
$$;
comment on function app.fill_invoice_payment_receipt_card(uuid) is
  'One-time fill of card_brand / card_last4 on a card receipt issued before the card was known (only while both are null). service_role only; the documented exception to receipts being append-only.';
revoke all on function app.fill_invoice_payment_receipt_card(uuid) from public, anon, authenticated;
grant execute on function app.fill_invoice_payment_receipt_card(uuid) to service_role;

-- Records the card brand and last 4 of one card payment, from a verified Stripe webhook event (or
-- the ops backfill, which reads the PaymentIntent from Stripe test mode). Matches the payment by
-- PaymentIntent id and the firm's connected account. Never raises for an unknown payment, a
-- mismatched account or live mode: it returns an outcome, and the caller carries on.
--   * While the payment has not succeeded, a newer card replaces the stored one (a retry with
--     another card). Once it has succeeded, the stored card is kept and only a missing one is set.
--   * When the payment already has a receipt without the card, the receipt is filled once
--     (app.fill_invoice_payment_receipt_card).
create function app.record_invoice_payment_card(
  p_account_id text,
  p_payment_intent_id text,
  p_card_brand text,
  p_card_last4 text,
  p_livemode boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  brand text := lower(btrim(coalesce(p_card_brand, '')));
  last4 text := btrim(coalesce(p_card_last4, ''));
  payment public.invoice_payments%rowtype;
  outcome text := 'unchanged';
  filled boolean := false;
begin
  if brand !~ '^[a-z0-9_]{1,40}$' or last4 !~ '^[0-9]{4}$' then
    raise exception 'card brand or last 4 is invalid' using errcode = '22023';
  end if;
  if p_livemode is distinct from false then
    return jsonb_build_object('outcome', 'ignored', 'reason', 'livemode');
  end if;
  select * into payment
  from public.invoice_payments
  where payment_intent_id = btrim(coalesce(p_payment_intent_id, ''))
  for update;
  if payment.id is null then
    return jsonb_build_object('outcome', 'unknown_payment');
  end if;
  if payment.connected_account_id <> btrim(coalesce(p_account_id, '')) then
    return jsonb_build_object('outcome', 'rejected', 'reason', 'connected account does not match');
  end if;

  if (payment.card_brand is null or payment.status <> 'succeeded')
     and (payment.card_brand is distinct from brand or payment.card_last4 is distinct from last4) then
    update public.invoice_payments
    set card_brand = brand, card_last4 = last4
    where id = payment.id
    returning * into payment;
    outcome := 'recorded';
  end if;

  if payment.status = 'succeeded' then
    filled := app.fill_invoice_payment_receipt_card(payment.id);
  end if;

  return jsonb_build_object('outcome', outcome, 'receipt_filled', filled);
end;
$$;
revoke all on function app.record_invoice_payment_card(text, text, text, text, boolean) from public, anon, authenticated;
grant execute on function app.record_invoice_payment_card(text, text, text, text, boolean) to service_role;

create function public.record_invoice_payment_card(
  p_account_id text, p_payment_intent_id text, p_card_brand text, p_card_last4 text, p_livemode boolean
) returns jsonb language sql security invoker set search_path = ''
as $$ select app.record_invoice_payment_card(p_account_id, p_payment_intent_id, p_card_brand, p_card_last4, p_livemode); $$;
comment on function public.record_invoice_payment_card(text, text, text, text, boolean) is
  'Card brand and last 4 of a card payment, from the verified Stripe webhook. service_role only.';
revoke all on function public.record_invoice_payment_card(text, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.record_invoice_payment_card(text, text, text, text, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- Issuing: the receipt copies the card brand and last 4
-- (copied from 20261019150000_invoice_payment_receipts.sql; the card columns are the only change)
-- ---------------------------------------------------------------------------

-- Issues the receipt for one payment of an invoice, once. Exactly one of p_payment_id (a succeeded
-- card payment) or p_entry_id (an approved client-account transfer) is given. Returns the receipt
-- id; a second call for the same payment returns the first receipt.
--
-- Email hook: when the receipt mail template exists, enqueue its outbox event here, after the
-- insert (the receipt row is the event's aggregate; the mail needs no card or bank data).
create or replace function app.issue_invoice_payment_receipt(p_payment_id uuid, p_entry_id uuid)
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
    consultant_name, consultant_licence, account_label, account_institution, account_last4,
    card_brand, card_last4, is_sample
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
    case when v_source = 'card' and payment.card_last4 is not null then payment.card_brand end,
    case when v_source = 'card' and payment.card_brand is not null then payment.card_last4 end,
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
-- Read: the receipt, for the PDF, now with the card brand and last 4
-- (copied from 20261019150000_invoice_payment_receipts.sql; card_brand / card_last4 added)
-- ---------------------------------------------------------------------------

create or replace function public.invoice_payment_receipt(p_receipt_id uuid)
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
    'card_brand', receipt.card_brand,
    'card_last4', receipt.card_last4,
    'is_sample', receipt.is_sample
  );
end;
$$;
comment on function public.invoice_payment_receipt(uuid) is
  'An invoice payment receipt (CICC Code s. 33(3)) for the PDF. Billing staff of the matter or the client who paid; audited.';
revoke all on function public.invoice_payment_receipt(uuid) from public, anon;
grant execute on function public.invoice_payment_receipt(uuid) to authenticated;
