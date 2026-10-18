-- Issued invoices are immutable; they are corrected by a void or a credit note (FIN-06, FIN-07).
--
--   * Void: only an issued invoice with nothing allocated to it (no card payment processing or
--     received, no client-account transfer asked for or approved, no payment receipt, no credit
--     note), with a reason. Status 'voided'; who, when and why are stored on the invoice and
--     audited as invoice.voided. Firm owner or the matter's finance user, with a recent step-up.
--   * Credit note (invoice_credit_notes, CN-0001 per firm): a credit against an issued invoice,
--     in full or in part, never more than the invoice amount not already credited (counting other
--     drafts), with a reason. Drafted by billing staff; issued only by a second person, with the
--     same rule Francis decided for client-fund transfers (docs/DECISIONS.md, 2026-10-18): the
--     approver is someone other than the requester, except the firm owner, who may issue their own
--     draft after a step-up taken after the draft was made (stored as owner_self_approved, audited
--     as invoice.credit_note_issued_owner_self). Issuing always needs a recent step-up.
--     An issued credit note reduces the amount due (invoices.credited_cents). It never moves
--     money: when the invoice was already paid, the part over what was still owed is a credit
--     balance (credit_balance_cents) that the firm refunds separately (card: the Payments tab's
--     refund; client funds: returned outside Casevoya's card flow) - the page says so and links them.
--
-- Status follows allocations (FIN-07), now counting credits: credited in full -> 'credited';
-- paid plus credited covers the amount -> 'paid'; something paid -> 'partially_paid'.
-- app.invoice_settled_status is that rule. The functions that read "amount due" now subtract
-- credited_cents; each is copied from its latest definition with only that change:
--   app.invoice_payment_context, app.record_invoice_payment_intent,
--   app.apply_stripe_payment_event                 (20261019100100_stripe_connect_invoices.sql)
--   app.check_client_transfer, app.approve_client_transfer (20261019120100_client_funds_ledger.sql)
--   public.list_client_fund_withdrawals            (20261019130000_client_funds_controls.sql)
-- apply_stripe_payment_event also leaves a voided invoice voided if a payment Stripe had already
-- started succeeds after the void (the money shows as a credit balance to refund).
--
-- The check "status <> 'paid' or paid_cents >= amount_cents" (unnamed, on public.invoices) is
-- replaced by invoices_paid_settled, which counts credits. A guard trigger now refuses changes to
-- an issued invoice's number, matter, description, category, amount, currency and dates, and keeps
-- a voided invoice voided.
--
-- The client reads the issued credit notes on invoices they can read (a party on the matter), and
-- downloads the PDF; billing staff read all. No email is sent (no approved design for it).
-- Nothing here changes a matter's stage or a government status. Additive only.

-- ---------------------------------------------------------------------------
-- Invoices: credits and voids
-- ---------------------------------------------------------------------------

alter table public.invoices add column credited_cents bigint not null default 0;
alter table public.invoices add constraint invoices_credited_within_amount
  check (credited_cents >= 0 and credited_cents <= amount_cents);
comment on column public.invoices.credited_cents is
  'Issued credit notes on this invoice, minor units. Reduces the amount due; never more than amount_cents.';

alter table public.invoices add column voided_at timestamptz;
alter table public.invoices add column voided_by uuid references auth.users (id);
alter table public.invoices add column void_reason text
  check (void_reason is null or length(btrim(void_reason)) between 3 and 500);
alter table public.invoices add constraint invoices_voided_shape
  check (status <> 'voided' or (voided_at is not null and voided_by is not null and void_reason is not null));
create index invoices_voided_by_idx on public.invoices (voided_by);

-- The old "paid means paid in full" check does not count credits. Found by its definition (it was
-- created unnamed) and replaced by a named one that does.
do $replace_paid_check$
declare
  constraint_name text;
begin
  for constraint_name in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.invoices'::regclass
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) like '%paid_cents >= amount_cents%'
      and pg_get_constraintdef(con.oid) not like '%credited_cents%'
  loop
    execute format('alter table public.invoices drop constraint %I', constraint_name);
  end loop;
end
$replace_paid_check$;
alter table public.invoices add constraint invoices_paid_settled
  check (status <> 'paid' or paid_cents + credited_cents >= amount_cents);

-- Invoice status from what is allocated (FIN-07). Draft and voided stay as they are.
create function app.invoice_settled_status(
  p_status public.invoice_status,
  p_amount bigint,
  p_paid bigint,
  p_credited bigint,
  p_refunded bigint
)
returns public.invoice_status
language sql
immutable
set search_path = ''
as $$
  select case
    when p_status in ('draft', 'voided') then p_status
    when p_credited >= p_amount then 'credited'::public.invoice_status
    when p_status = 'refunded' and p_paid > 0 and p_refunded >= p_paid then 'refunded'::public.invoice_status
    when p_paid + p_credited >= p_amount then 'paid'::public.invoice_status
    when p_paid > 0 then 'partially_paid'::public.invoice_status
    else 'issued'::public.invoice_status
  end;
$$;
revoke all on function app.invoice_settled_status(public.invoice_status, bigint, bigint, bigint, bigint) from public, anon;
grant execute on function app.invoice_settled_status(public.invoice_status, bigint, bigint, bigint, bigint) to authenticated, service_role;

-- An issued invoice can't be edited (FIN-07): only its allocations and status move, and a voided
-- invoice stays voided. Draft invoices (none are created today) stay editable.
create function app.guard_issued_invoice_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'draft' and (
    new.organization_id, new.matter_id, new.number, new.description, new.fee_category, new.amount_cents,
    new.currency, new.issued_on, new.due_on, new.is_sample, new.idempotency_key
  ) is distinct from (
    old.organization_id, old.matter_id, old.number, old.description, old.fee_category, old.amount_cents,
    old.currency, old.issued_on, old.due_on, old.is_sample, old.idempotency_key
  ) then
    raise exception 'an issued invoice can''t be edited; correct it with a credit note or void it' using errcode = '42501';
  end if;
  -- A voided invoice stays voided. A card payment Stripe had already started can still succeed or be
  -- refunded after the void (app.apply_stripe_payment_event, app.apply_stripe_reversal_event); its
  -- amounts are recorded, the status is kept.
  if old.status = 'voided' then
    new.status := 'voided';
  end if;
  if (old.voided_at, old.voided_by, old.void_reason) is distinct from (new.voided_at, new.voided_by, new.void_reason)
     and old.voided_at is not null then
    raise exception 'a void is recorded once' using errcode = '42501';
  end if;
  if new.credited_cents < old.credited_cents then
    raise exception 'issued credit notes are never taken back' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.guard_issued_invoice_change() from public, anon, authenticated;

create trigger invoices_issued_immutable before update on public.invoices
  for each row execute function app.guard_issued_invoice_change();

-- ---------------------------------------------------------------------------
-- Credit notes
-- ---------------------------------------------------------------------------

create table public.invoice_credit_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  invoice_id uuid not null,
  matter_id uuid not null,
  number text not null check (number ~ '^CN-[0-9]{4,9}$'),
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 99999999999),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  reason text not null check (length(btrim(reason)) between 3 and 500),
  status public.credit_note_status not null default 'draft',
  is_sample boolean not null default false,
  idempotency_key text not null check (length(idempotency_key) between 8 and 180),
  requested_by uuid not null references auth.users (id),
  issued_by uuid references auth.users (id),
  issued_at timestamptz,
  owner_self_approved boolean not null default false,
  declined_by uuid references auth.users (id),
  declined_at timestamptz,
  decline_reason text check (decline_reason is null or length(btrim(decline_reason)) between 3 and 500),
  -- When issued: the part that reduced what was still owed, and the part over it (a credit balance
  -- the firm refunds separately; a credit note never moves money).
  applied_cents bigint check (applied_cents is null or applied_cents >= 0),
  credit_balance_cents bigint check (credit_balance_cents is null or credit_balance_cents >= 0),
  -- Copied when issued, so a later rename never changes an issued credit note.
  invoice_number text check (invoice_number is null or invoice_number ~ '^INV-[0-9]{4,9}$'),
  invoice_description text check (invoice_description is null or length(btrim(invoice_description)) between 1 and 500),
  invoice_issued_on date,
  invoice_amount_cents bigint check (invoice_amount_cents is null or invoice_amount_cents > 0),
  client_name text check (client_name is null or length(btrim(client_name)) between 1 and 300),
  matter_label text check (matter_label is null or length(btrim(matter_label)) between 1 and 300),
  firm_legal_name text check (firm_legal_name is null or length(btrim(firm_legal_name)) between 1 and 300),
  firm_display_name text check (firm_display_name is null or length(btrim(firm_display_name)) between 1 and 200),
  firm_timezone text,
  consultant_name text check (consultant_name is null or length(consultant_name) <= 200),
  consultant_licence text check (consultant_licence is null or length(consultant_licence) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id),
  unique (organization_id, number),
  unique (organization_id, idempotency_key),
  check (
    status <> 'issued' or (
      issued_by is not null and issued_at is not null
      and applied_cents is not null and credit_balance_cents is not null
      and applied_cents + credit_balance_cents = amount_cents
      and invoice_number is not null and invoice_description is not null and invoice_amount_cents is not null
      and client_name is not null and matter_label is not null
      and firm_legal_name is not null and firm_display_name is not null and firm_timezone is not null
    )
  ),
  check (status <> 'declined' or (declined_by is not null and declined_at is not null and decline_reason is not null)),
  check (status = 'issued' or (issued_by is null and issued_at is null and applied_cents is null and credit_balance_cents is null)),
  -- Maker-checker: only the firm owner's issue of their own draft may name the requester.
  check (issued_by is null or issued_by <> requested_by or owner_self_approved),
  check (not owner_self_approved or (status = 'issued' and issued_by = requested_by)),
  foreign key (invoice_id, organization_id) references public.invoices (id, organization_id),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id)
);
comment on table public.invoice_credit_notes is
  'Credit notes against issued invoices (CN-0001 per firm). Drafted, then issued by a second person (the firm owner may issue their own after a fresh step-up). Reduce the amount due; never move money. Append-only.';

create index invoice_credit_notes_invoice_org_fk_idx on public.invoice_credit_notes (invoice_id, organization_id);
create index invoice_credit_notes_matter_org_fk_idx on public.invoice_credit_notes (matter_id, organization_id);
create index invoice_credit_notes_org_created_idx on public.invoice_credit_notes (organization_id, created_at desc);
create index invoice_credit_notes_requested_by_idx on public.invoice_credit_notes (requested_by);
create index invoice_credit_notes_issued_by_idx on public.invoice_credit_notes (issued_by);
create index invoice_credit_notes_declined_by_idx on public.invoice_credit_notes (declined_by);
create index invoice_credit_notes_created_by_idx on public.invoice_credit_notes (created_by);

-- Append-only: nothing is deleted; a draft moves once, to issued or declined.
create function app.guard_credit_note_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'credit notes are append-only' using errcode = '42501';
  end if;
  if (new.organization_id, new.invoice_id, new.matter_id, new.number, new.amount_cents, new.currency,
      new.reason, new.is_sample, new.idempotency_key, new.requested_by)
     is distinct from
     (old.organization_id, old.invoice_id, old.matter_id, old.number, old.amount_cents, old.currency,
      old.reason, old.is_sample, old.idempotency_key, old.requested_by) then
    raise exception 'credit notes are append-only' using errcode = '42501';
  end if;
  if not (old.status = 'draft' and new.status in ('issued', 'declined')) then
    raise exception 'credit notes are append-only' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.guard_credit_note_change() from public, anon, authenticated;

create trigger invoice_credit_notes_guard before update or delete on public.invoice_credit_notes
  for each row execute function app.guard_credit_note_change();
create trigger invoice_credit_notes_touch before update on public.invoice_credit_notes
  for each row execute function app.touch_row();
create trigger invoice_credit_notes_stamp before insert on public.invoice_credit_notes
  for each row execute function app.stamp_created_by();
create trigger invoice_credit_notes_audit after insert or update or delete on public.invoice_credit_notes
  for each row execute function app.audit_row_change();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Billing work on an invoice: the firm owner or the matter's finance user at aal2, plus a recent
-- step-up when p_step_up. Raises; returns the invoice row when allowed.
create function app.require_invoice_billing(p_invoice_id uuid, p_step_up boolean)
returns public.invoices
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  invoice public.invoices%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'sign in is required' using errcode = '42501';
  end if;
  select * into invoice from public.invoices where id = p_invoice_id;
  if invoice.id is null or app.can_read_matter_billing(invoice.matter_id) is distinct from true then
    raise exception 'billing access denied' using errcode = '42501';
  end if;
  if p_step_up and app.mfa_step_up_satisfied() is distinct from true then
    raise exception 'step-up is required' using errcode = '42501';
  end if;
  return invoice;
end;
$$;
revoke all on function app.require_invoice_billing(uuid, boolean) from public, anon;

create function app.next_credit_note_number(p_org uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_number integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('casevoya.credit_note_number:' || p_org::text, 0));
  select coalesce(max(substring(note.number from 4)::integer), 0) + 1 into next_number
  from public.invoice_credit_notes note
  where note.organization_id = p_org;
  return 'CN-' || lpad(next_number::text, 4, '0');
end;
$$;
revoke all on function app.next_credit_note_number(uuid) from public, anon, authenticated;

-- What can still be credited on an invoice: its amount, less issued credits and other drafts.
create function app.invoice_creditable_cents(p_invoice_id uuid, p_exclude uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(
    invoice.amount_cents - invoice.credited_cents - coalesce((
      select sum(note.amount_cents)
      from public.invoice_credit_notes note
      where note.invoice_id = invoice.id
        and note.status = 'draft'
        and note.id is distinct from p_exclude
    ), 0),
    0
  )::bigint
  from public.invoices invoice
  where invoice.id = p_invoice_id;
$$;
revoke all on function app.invoice_creditable_cents(uuid, uuid) from public, anon;
grant execute on function app.invoice_creditable_cents(uuid, uuid) to authenticated, service_role;

create function app.check_creditable_invoice(p_invoice public.invoices, p_amount bigint, p_exclude uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_invoice.status not in ('issued', 'partially_paid', 'paid', 'refunded') then
    raise exception 'only an issued invoice can be credited' using errcode = '22023';
  end if;
  if exists (select 1 from public.invoice_payments payment where payment.invoice_id = p_invoice.id and payment.status = 'processing') then
    raise exception 'a card payment on this invoice is processing' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'amount must be positive' using errcode = '22023';
  end if;
  if p_amount > app.invoice_creditable_cents(p_invoice.id, p_exclude) then
    raise exception 'credit exceeds the amount not already credited' using errcode = '22023';
  end if;
end;
$$;
revoke all on function app.check_creditable_invoice(public.invoices, bigint, uuid) from public, anon;

-- ---------------------------------------------------------------------------
-- Drafting, issuing and declining a credit note
-- ---------------------------------------------------------------------------

create function app.request_credit_note(p_invoice_id uuid, p_amount_cents bigint, p_reason text, p_idempotency_key text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  invoice public.invoices%rowtype;
  existing public.invoice_credit_notes%rowtype;
  key text := btrim(coalesce(p_idempotency_key, ''));
  v_reason text := btrim(coalesce(p_reason, ''));
  rid uuid;
begin
  invoice := app.require_invoice_billing(p_invoice_id, false);
  if length(key) not between 8 and 180 then
    raise exception 'idempotency key is required' using errcode = '22023';
  end if;
  select * into existing from public.invoice_credit_notes where organization_id = invoice.organization_id and idempotency_key = key;
  if existing.id is not null then
    if existing.invoice_id <> invoice.id then
      raise exception 'idempotency key was used for another credit note' using errcode = '23505';
    end if;
    return existing.id;
  end if;
  if app.sample_mode_blocks_real(invoice.organization_id, invoice.is_sample) then
    raise exception 'this firm is in sample mode; only sample invoices take credit notes' using errcode = '42501';
  end if;
  if length(v_reason) not between 3 and 500 then
    raise exception 'a reason is required' using errcode = '22023';
  end if;
  select * into invoice from public.invoices where id = invoice.id for update;
  perform app.check_creditable_invoice(invoice, p_amount_cents, null);

  insert into public.invoice_credit_notes (
    organization_id, invoice_id, matter_id, number, amount_cents, currency, reason, status,
    is_sample, idempotency_key, requested_by
  ) values (
    invoice.organization_id, invoice.id, invoice.matter_id, app.next_credit_note_number(invoice.organization_id),
    p_amount_cents, invoice.currency, v_reason, 'draft', invoice.is_sample, key, (select auth.uid())
  )
  returning id into rid;
  perform app.record_audit_event(
    invoice.organization_id, 'invoice.credit_note_drafted', 'public.invoice_credit_notes', rid, 'success',
    jsonb_build_object('invoice_id', invoice.id, 'amount_cents', p_amount_cents, 'currency', invoice.currency)
  );
  return rid;
end;
$$;
revoke all on function app.request_credit_note(uuid, bigint, text, text) from public, anon;

-- Issues a draft credit note and applies it to the invoice. The issuer must be someone other than
-- the requester, except the firm owner, who may issue their own draft with a step-up taken after
-- the draft was made (owner_self_approved). Everyone issuing needs a recent step-up.
create function app.issue_credit_note(p_credit_note_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  note public.invoice_credit_notes%rowtype;
  invoice public.invoices%rowtype;
  actor uuid := (select auth.uid());
  self_approved boolean := false;
  net_due bigint;
  applied bigint;
begin
  select * into note from public.invoice_credit_notes where id = p_credit_note_id;
  if note.id is null then
    raise exception 'billing access denied' using errcode = '42501';
  end if;
  perform app.require_invoice_billing(note.invoice_id, true);
  -- Lock order: invoice, then credit note.
  select * into invoice from public.invoices where id = note.invoice_id for update;
  select * into note from public.invoice_credit_notes where id = p_credit_note_id for update;
  if note.status <> 'draft' then
    raise exception 'only a draft credit note can be issued' using errcode = '22023';
  end if;
  if note.requested_by = actor then
    if app.has_org_role(note.organization_id, array['firm_owner']::public.org_role[]) is distinct from true then
      raise exception 'the requester cannot issue their own credit note' using errcode = '42501';
    end if;
    if app.mfa_step_up_satisfied(least(interval '15 minutes', statement_timestamp() - date_trunc('second', note.created_at)))
       is distinct from true then
      raise exception 'step-up is required: issuing your own credit note needs a step-up after the draft' using errcode = '42501';
    end if;
    self_approved := true;
  end if;
  perform app.check_creditable_invoice(invoice, note.amount_cents, note.id);

  -- What was still owed, net of refunds: the credit reduces that first; the rest is a credit
  -- balance owed back to the client, refunded separately.
  net_due := greatest(invoice.amount_cents - invoice.credited_cents - (invoice.paid_cents - invoice.refunded_cents), 0);
  applied := least(note.amount_cents, net_due);

  update public.invoice_credit_notes note_row
  set status = 'issued',
      issued_by = actor,
      issued_at = clock_timestamp(),
      owner_self_approved = self_approved,
      applied_cents = applied,
      credit_balance_cents = note.amount_cents - applied,
      invoice_number = invoice.number,
      invoice_description = invoice.description,
      invoice_issued_on = invoice.issued_on,
      invoice_amount_cents = invoice.amount_cents,
      client_name = left(coalesce((
        select string_agg(person.display_name, ', ' order by person.display_name)
        from public.matter_participants party
        join public.persons person on person.id = party.person_id and person.organization_id = party.organization_id
        where party.matter_id = invoice.matter_id and party.organization_id = invoice.organization_id and party.role = 'applicant'
      ), 'Client'), 300),
      matter_label = left(coalesce(nullif(concat_ws(' · ', nullif(btrim(coalesce(matter.reference, '')), ''), nullif(btrim(coalesce(matter.title, '')), '')), ''), 'Matter'), 300),
      firm_legal_name = org.legal_name,
      firm_display_name = org.display_name,
      firm_timezone = coalesce(nullif(btrim(coalesce(org.timezone, '')), ''), 'America/Toronto'),
      consultant_name = (
        select left(nullif(btrim(coalesce(prof.display_name, '')), ''), 200)
        from public.memberships mem
        left join public.profiles prof on prof.id = mem.user_id
        where mem.id = matter.responsible_consultant_membership_id
          and mem.organization_id = matter.organization_id
      ),
      consultant_licence = (
        select credential.licence_type::text || ' ' || credential.college_id
        from public.consultant_credentials credential
        where credential.membership_id = matter.responsible_consultant_membership_id
          and credential.organization_id = matter.organization_id
        order by credential.declared_at desc
        limit 1
      )
  from public.matters matter, public.organizations org
  where note_row.id = note.id
    and matter.id = invoice.matter_id and matter.organization_id = invoice.organization_id
    and org.id = invoice.organization_id
  returning note_row.* into note;

  update public.invoices
  set credited_cents = credited_cents + note.amount_cents,
      status = app.invoice_settled_status(status, amount_cents, paid_cents, credited_cents + note.amount_cents, refunded_cents)
  where id = invoice.id
  returning * into invoice;

  perform app.record_audit_event(
    note.organization_id,
    case when self_approved then 'invoice.credit_note_issued_owner_self' else 'invoice.credit_note_issued' end,
    'public.invoice_credit_notes', note.id, 'success',
    jsonb_build_object(
      'invoice_id', invoice.id, 'amount_cents', note.amount_cents, 'requested_by', note.requested_by,
      'owner_self_approved', self_approved, 'credit_balance_cents', note.credit_balance_cents
    )
  );
  return jsonb_build_object(
    'status', note.status,
    'number', note.number,
    'owner_self_approved', self_approved,
    'invoice_status', invoice.status,
    'credit_balance_cents', note.credit_balance_cents
  );
end;
$$;
revoke all on function app.issue_credit_note(uuid) from public, anon;

-- Declines (or, by its requester, withdraws) a draft credit note. Nothing changes on the invoice.
create function app.decline_credit_note(p_credit_note_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  note public.invoice_credit_notes%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  select * into note from public.invoice_credit_notes where id = p_credit_note_id;
  if note.id is null then
    raise exception 'billing access denied' using errcode = '42501';
  end if;
  perform app.require_invoice_billing(note.invoice_id, false);
  select * into note from public.invoice_credit_notes where id = p_credit_note_id for update;
  if note.status <> 'draft' then
    raise exception 'only a draft credit note can be declined' using errcode = '22023';
  end if;
  if length(v_reason) not between 3 and 500 then
    raise exception 'a reason is required' using errcode = '22023';
  end if;
  update public.invoice_credit_notes
  set status = 'declined', declined_by = (select auth.uid()), declined_at = clock_timestamp(), decline_reason = v_reason
  where id = note.id;
  perform app.record_audit_event(
    note.organization_id, 'invoice.credit_note_declined', 'public.invoice_credit_notes', note.id, 'success',
    jsonb_build_object('invoice_id', note.invoice_id, 'amount_cents', note.amount_cents)
  );
  return note.id;
end;
$$;
revoke all on function app.decline_credit_note(uuid, text) from public, anon;

-- ---------------------------------------------------------------------------
-- Voiding an invoice
-- ---------------------------------------------------------------------------

-- Voids an issued invoice that has nothing allocated to it. Returns the card payment attempts the
-- client had started (requires_payment or failed) so the server can cancel them in Stripe; a
-- payment that still succeeds afterwards is kept on the voided invoice as money to refund.
create function app.void_invoice(p_invoice_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  invoice public.invoices%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
  account text;
  open_intents jsonb;
begin
  invoice := app.require_invoice_billing(p_invoice_id, true);
  select * into invoice from public.invoices where id = invoice.id for update;
  if invoice.status = 'voided' then
    return jsonb_build_object('status', 'voided', 'cancel', '[]'::jsonb, 'account_id', null);
  end if;
  if app.sample_mode_blocks_real(invoice.organization_id, invoice.is_sample) then
    raise exception 'this firm is in sample mode; only sample invoices can be voided' using errcode = '42501';
  end if;
  if length(v_reason) not between 3 and 500 then
    raise exception 'a reason is required' using errcode = '22023';
  end if;
  if invoice.status <> 'issued' or invoice.paid_cents > 0 or invoice.credited_cents > 0 then
    raise exception 'only an issued invoice with nothing paid or credited can be voided' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.invoice_payments payment
    where payment.invoice_id = invoice.id and payment.status in ('processing', 'succeeded')
  ) then
    raise exception 'a card payment on this invoice was received or is processing; it can''t be voided' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.client_fund_entries entry
    where entry.invoice_id = invoice.id and entry.kind = 'transfer' and entry.status in ('pending_approval', 'approved')
  ) then
    raise exception 'a client-account transfer is allocated to this invoice; it can''t be voided' using errcode = '22023';
  end if;
  if exists (select 1 from public.invoice_payment_receipts receipt where receipt.invoice_id = invoice.id) then
    raise exception 'a payment receipt was issued for this invoice; it can''t be voided' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.invoice_credit_notes note
    where note.invoice_id = invoice.id and note.status in ('draft', 'issued')
  ) then
    raise exception 'this invoice has a credit note; it can''t be voided' using errcode = '22023';
  end if;

  update public.invoices
  set status = 'voided', voided_at = clock_timestamp(), voided_by = (select auth.uid()), void_reason = v_reason
  where id = invoice.id
  returning * into invoice;
  perform app.record_audit_event(
    invoice.organization_id, 'invoice.voided', 'public.invoices', invoice.id, 'success',
    jsonb_build_object('amount_cents', invoice.amount_cents, 'currency', invoice.currency)
  );
  select fpa.account_id into account from public.firm_payment_accounts fpa where fpa.organization_id = invoice.organization_id;
  select coalesce(jsonb_agg(payment.payment_intent_id order by payment.created_at), '[]'::jsonb) into open_intents
  from public.invoice_payments payment
  where payment.invoice_id = invoice.id
    and payment.status in ('requires_payment', 'failed')
    and payment.connected_account_id = account;
  return jsonb_build_object('status', invoice.status, 'cancel', open_intents, 'account_id', account);
end;
$$;
revoke all on function app.void_invoice(uuid, text) from public, anon;

-- ---------------------------------------------------------------------------
-- Amount due now counts credits (each copied from its latest definition)
-- ---------------------------------------------------------------------------

-- From 20261019100100_stripe_connect_invoices.sql; amount_due subtracts credited_cents.
create or replace function app.invoice_payment_context(p_invoice_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  invoice public.invoices%rowtype;
  account public.firm_payment_accounts%rowtype;
  open_payment public.invoice_payments%rowtype;
  attempts integer;
begin
  select * into invoice from public.invoices where id = p_invoice_id;
  if invoice.id is null or app.is_matter_party(invoice.matter_id) is distinct from true then
    raise exception 'invoice not found' using errcode = '42501';
  end if;
  if invoice.status not in ('issued', 'partially_paid') or invoice.amount_cents - invoice.paid_cents - invoice.credited_cents <= 0 then
    raise exception 'this invoice is not open for payment' using errcode = '22023';
  end if;
  select * into account from public.firm_payment_accounts where organization_id = invoice.organization_id;
  select count(*)::integer into attempts from public.invoice_payments where invoice_id = invoice.id;
  select * into open_payment
  from public.invoice_payments payment
  where payment.invoice_id = invoice.id
    and payment.status in ('requires_payment', 'failed')
    and payment.amount_cents = invoice.amount_cents - invoice.paid_cents - invoice.credited_cents
    and payment.connected_account_id = account.account_id
  order by payment.created_at desc
  limit 1;
  return jsonb_build_object(
    'invoice_id', invoice.id,
    'organization_id', invoice.organization_id,
    'number', invoice.number,
    'amount_due', invoice.amount_cents - invoice.paid_cents - invoice.credited_cents,
    'currency', invoice.currency,
    'account_id', account.account_id,
    'processing', exists (
      select 1 from public.invoice_payments payment
      where payment.invoice_id = invoice.id and payment.status = 'processing'
    ),
    'open_payment_intent_id', open_payment.payment_intent_id,
    'attempts', attempts
  );
end;
$$;

-- From 20261019100100_stripe_connect_invoices.sql; the balance due subtracts credited_cents.
create or replace function app.record_invoice_payment_intent(
  p_invoice_id uuid,
  p_payment_intent_id text,
  p_account_id text,
  p_amount_cents bigint,
  p_currency text,
  p_application_fee_cents bigint,
  p_livemode boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  invoice public.invoices%rowtype;
  account public.firm_payment_accounts%rowtype;
  existing public.invoice_payments%rowtype;
  intent text := btrim(coalesce(p_payment_intent_id, ''));
  rid uuid;
begin
  select * into invoice from public.invoices where id = p_invoice_id for update;
  if invoice.id is null or app.is_matter_party(invoice.matter_id) is distinct from true then
    raise exception 'invoice not found' using errcode = '42501';
  end if;
  if p_livemode is distinct from false then
    raise exception 'only test-mode payments are accepted' using errcode = '22023';
  end if;
  select * into existing from public.invoice_payments where payment_intent_id = intent;
  if existing.id is not null then
    if existing.invoice_id <> invoice.id then
      raise exception 'payment intent belongs to another invoice' using errcode = '42501';
    end if;
    return existing.id;
  end if;
  if invoice.status not in ('issued', 'partially_paid') then
    raise exception 'this invoice is not open for payment' using errcode = '22023';
  end if;
  select * into account from public.firm_payment_accounts where organization_id = invoice.organization_id;
  if account.id is null or account.account_id <> btrim(coalesce(p_account_id, '')) then
    raise exception 'payment account does not match the firm' using errcode = '42501';
  end if;
  if p_amount_cents is distinct from (invoice.amount_cents - invoice.paid_cents - invoice.credited_cents) then
    raise exception 'payment amount does not match the balance due' using errcode = '22023';
  end if;
  if upper(btrim(coalesce(p_currency, ''))) <> invoice.currency then
    raise exception 'payment currency does not match the invoice' using errcode = '22023';
  end if;
  if coalesce(p_application_fee_cents, 0) < 0 or coalesce(p_application_fee_cents, 0) > p_amount_cents then
    raise exception 'application fee is invalid' using errcode = '22023';
  end if;
  insert into public.invoice_payments (
    organization_id, invoice_id, payment_intent_id, connected_account_id,
    amount_cents, currency, application_fee_cents, livemode
  ) values (
    invoice.organization_id, invoice.id, intent, account.account_id,
    p_amount_cents, invoice.currency, coalesce(p_application_fee_cents, 0), false
  )
  returning id into rid;
  perform app.record_audit_event(
    invoice.organization_id, 'invoice.payment_started', 'public.invoice_payments', rid, 'success',
    jsonb_build_object('invoice_id', invoice.id, 'amount_cents', p_amount_cents, 'currency', invoice.currency)
  );
  return rid;
end;
$$;

-- From 20261019100100_stripe_connect_invoices.sql; the invoice status after a succeeded payment
-- comes from app.invoice_settled_status (credits count; a voided invoice stays voided).
create or replace function app.apply_stripe_payment_event(
  p_event_id text,
  p_account_id text,
  p_event_type text,
  p_payment_intent_id text,
  p_amount_cents bigint,
  p_amount_received_cents bigint,
  p_currency text,
  p_livemode boolean,
  p_invoice_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_key text := btrim(coalesce(p_event_id, ''));
  account_key text := btrim(coalesce(p_account_id, ''));
  currency text := upper(btrim(coalesce(p_currency, '')));
  payment public.invoice_payments%rowtype;
  invoice public.invoices%rowtype;
  firm_account text;
  inbox_id uuid;
  inbox_status public.webhook_inbox_status;
  next_status public.invoice_payment_status;
  outcome text := 'unchanged';
  detail text;
  received bigint;
begin
  if length(event_key) = 0 then
    raise exception 'event id is required' using errcode = '22023';
  end if;

  select * into payment from public.invoice_payments where payment_intent_id = btrim(coalesce(p_payment_intent_id, ''));
  -- The PaymentIntent was created but its row was not recorded (the browser went away): the
  -- invoice id in the PaymentIntent metadata recovers it when the firm's account matches.
  if payment.id is null and p_invoice_id is not null and p_livemode is false
     and p_event_type in ('payment_intent.processing', 'payment_intent.succeeded', 'payment_intent.payment_failed', 'payment_intent.canceled')
     and btrim(coalesce(p_payment_intent_id, '')) ~ '^pi_[A-Za-z0-9]{6,250}$'
     and coalesce(p_amount_cents, 0) > 0 then
    select * into invoice from public.invoices where id = p_invoice_id;
    select fpa.account_id into firm_account from public.firm_payment_accounts fpa where fpa.organization_id = invoice.organization_id;
    if invoice.id is not null and firm_account = account_key and currency = invoice.currency then
      insert into public.invoice_payments (
        organization_id, invoice_id, payment_intent_id, connected_account_id, amount_cents, currency, livemode
      ) values (
        invoice.organization_id, invoice.id, btrim(p_payment_intent_id), account_key, p_amount_cents, currency, false
      )
      on conflict (payment_intent_id) do nothing;
      select * into payment from public.invoice_payments where payment_intent_id = btrim(p_payment_intent_id);
    end if;
  end if;

  inbox_id := app.ingest_webhook_event(
    'stripe', event_key, account_key, left(coalesce(p_event_type, ''), 120),
    coalesce(p_payload, '{}'::jsonb), true, payment.organization_id
  );
  select w.status into inbox_status from public.webhook_inbox w where w.id = inbox_id for update;
  if inbox_status in ('processed', 'ignored') then
    return jsonb_build_object('outcome', 'duplicate');
  end if;

  if payment.id is null or p_livemode is not false then
    update public.webhook_inbox set status = 'ignored', processed_at = clock_timestamp() where id = inbox_id;
    return jsonb_build_object('outcome', 'ignored', 'reason', case when p_livemode is not false then 'livemode' else 'unknown_payment' end);
  end if;

  select * into invoice from public.invoices where id = payment.invoice_id for update;
  select * into payment from public.invoice_payments where id = payment.id for update;

  next_status := case p_event_type
    when 'payment_intent.succeeded' then 'succeeded'
    when 'payment_intent.processing' then 'processing'
    when 'payment_intent.payment_failed' then 'failed'
    when 'payment_intent.canceled' then 'canceled'
    else null
  end;

  if payment.connected_account_id <> account_key then
    outcome := 'rejected';
    detail := 'connected account does not match';
  elsif currency <> payment.currency then
    outcome := 'rejected';
    detail := 'currency does not match';
  elsif p_amount_cents is distinct from payment.amount_cents then
    outcome := 'rejected';
    detail := 'amount does not match';
  elsif next_status is null then
    outcome := 'unchanged';
    detail := 'event type not applied';
  elsif payment.status = 'succeeded' then
    outcome := 'unchanged';
    detail := 'payment already succeeded';
  elsif payment.status = 'canceled' and next_status <> 'succeeded' then
    outcome := 'unchanged';
    detail := 'payment already canceled';
  elsif next_status = payment.status then
    outcome := 'unchanged';
  else
    outcome := 'applied';
    if next_status = 'succeeded' then
      received := coalesce(p_amount_received_cents, 0);
      if received <= 0 or received > payment.amount_cents then
        outcome := 'rejected';
        detail := 'amount received is invalid';
      else
        update public.invoice_payments
        set status = 'succeeded', amount_received_cents = received, succeeded_at = clock_timestamp(), last_event_id = event_key
        where id = payment.id
        returning * into payment;
        update public.invoices
        set paid_cents = paid_cents + received,
            status = app.invoice_settled_status(status, amount_cents, paid_cents + received, credited_cents, refunded_cents)
        where id = invoice.id
        returning * into invoice;
        perform app.record_audit_event(
          invoice.organization_id, 'invoice.payment_succeeded', 'public.invoices', invoice.id, 'success',
          jsonb_build_object('payment_id', payment.id, 'amount_cents', received, 'currency', payment.currency)
        );
        if invoice.status = 'voided' then
          perform app.record_audit_event(
            invoice.organization_id, 'invoice.payment_after_void', 'public.invoices', invoice.id, 'success',
            jsonb_build_object('payment_id', payment.id, 'amount_cents', received, 'currency', payment.currency)
          );
        end if;
      end if;
    else
      update public.invoice_payments
      set status = next_status, last_event_id = event_key
      where id = payment.id
      returning * into payment;
    end if;
  end if;

  insert into public.invoice_payment_events (
    organization_id, invoice_id, payment_id, webhook_inbox_id, connected_account_id, event_id, event_type,
    amount_cents, currency, outcome, detail, payment_status, invoice_status
  ) values (
    payment.organization_id, payment.invoice_id, payment.id, inbox_id, account_key, event_key,
    left(coalesce(p_event_type, ''), 120), p_amount_cents, nullif(currency, ''), outcome, detail,
    payment.status, invoice.status
  )
  on conflict (provider, connected_account_id, event_id) do nothing;

  update public.webhook_inbox
  set status = case when outcome = 'rejected' then 'failed'::public.webhook_inbox_status else 'processed'::public.webhook_inbox_status end,
      processed_at = clock_timestamp()
  where id = inbox_id;

  return jsonb_build_object(
    'outcome', outcome,
    'payment_status', payment.status,
    'invoice_status', invoice.status
  );
end;
$$;

-- From 20261019120100_client_funds_ledger.sql; the amount due subtracts credited_cents.
create or replace function app.check_client_transfer(
  p_ledger public.client_fund_ledgers,
  p_invoice public.invoices,
  p_amount bigint,
  p_exclude uuid
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  totals record;
  invoice_pending bigint;
  own_pending bigint := 0;
begin
  if p_invoice.id is null or p_invoice.organization_id <> p_ledger.organization_id or p_invoice.matter_id <> p_ledger.matter_id then
    raise exception 'the invoice must be on the same matter' using errcode = '22023';
  end if;
  if p_invoice.status not in ('issued', 'partially_paid') then
    raise exception 'only an issued invoice with an amount due can be paid from client funds' using errcode = '22023';
  end if;
  if p_invoice.currency <> 'CAD' then
    raise exception 'only CAD client funds are supported' using errcode = '22023';
  end if;
  if exists (select 1 from public.invoice_payments payment where payment.invoice_id = p_invoice.id and payment.status = 'processing') then
    raise exception 'a card payment on this invoice is processing' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'amount must be positive' using errcode = '22023';
  end if;
  select coalesce(sum(entry.amount_cents), 0) into invoice_pending
  from public.client_fund_entries entry
  where entry.invoice_id = p_invoice.id and entry.kind = 'transfer' and entry.status = 'pending_approval'
    and entry.id is distinct from p_exclude;
  if p_amount > p_invoice.amount_cents - p_invoice.paid_cents - p_invoice.credited_cents - invoice_pending then
    raise exception 'transfer exceeds the amount due on the invoice' using errcode = '22023';
  end if;
  select * into totals from app.client_fund_ledger_totals(p_ledger.id);
  if p_exclude is not null then
    select entry.amount_cents into own_pending from public.client_fund_entries entry
    where entry.id = p_exclude and entry.status = 'pending_approval';
  end if;
  if p_amount > totals.balance - (totals.pending_out - coalesce(own_pending, 0)) then
    raise exception 'transfer exceeds the client''s available balance' using errcode = '22023';
  end if;
end;
$$;

-- From 20261019120100_client_funds_ledger.sql; the invoice status after the transfer comes from
-- app.invoice_settled_status (credits count).
create or replace function app.approve_client_transfer(p_entry_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  entry public.client_fund_entries%rowtype;
  ledger public.client_fund_ledgers%rowtype;
  invoice public.invoices%rowtype;
  actor uuid := (select auth.uid());
  self_approved boolean := false;
begin
  select * into entry from public.client_fund_entries where id = p_entry_id;
  perform app.require_client_funds_access(entry.matter_id, true);
  select * into ledger from public.client_fund_ledgers where id = entry.ledger_id for update;
  select * into invoice from public.invoices where id = entry.invoice_id for update;
  select * into entry from public.client_fund_entries where id = p_entry_id for update;
  if entry.kind <> 'transfer' or entry.status <> 'pending_approval' then
    raise exception 'only a transfer waiting for approval can be approved' using errcode = '22023';
  end if;
  if entry.requested_by = actor then
    if app.has_org_role(entry.organization_id, array['firm_owner']::public.org_role[]) is distinct from true then
      raise exception 'the requester cannot approve their own transfer' using errcode = '42501';
    end if;
    if app.mfa_step_up_satisfied(least(interval '15 minutes', statement_timestamp() - date_trunc('second', entry.created_at)))
       is distinct from true then
      raise exception 'step-up is required: approving your own request needs a step-up after the request' using errcode = '42501';
    end if;
    self_approved := true;
  end if;
  perform app.check_client_transfer(ledger, invoice, entry.amount_cents, entry.id);

  update public.client_fund_entries
  set status = 'approved', approved_by = actor, approved_at = clock_timestamp(), owner_self_approved = self_approved
  where id = entry.id
  returning * into entry;
  update public.invoices
  set paid_cents = paid_cents + entry.amount_cents,
      client_funds_paid_cents = client_funds_paid_cents + entry.amount_cents,
      status = app.invoice_settled_status(status, amount_cents, paid_cents + entry.amount_cents, credited_cents, refunded_cents)
  where id = invoice.id
  returning * into invoice;
  perform app.record_audit_event(
    entry.organization_id,
    case when self_approved then 'client_funds.transfer_approved_owner_self' else 'client_funds.transfer_approved' end,
    'public.client_fund_entries', entry.id, 'success',
    jsonb_build_object('invoice_id', invoice.id, 'amount_cents', entry.amount_cents, 'requested_by', entry.requested_by, 'owner_self_approved', self_approved)
  );
  return jsonb_build_object('status', entry.status, 'owner_self_approved', self_approved, 'invoice_status', invoice.status);
end;
$$;

-- From 20261019130000_client_funds_controls.sql; an invoice's amount still to withdraw subtracts
-- credited_cents.
create or replace function public.list_client_fund_withdrawals()
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
             invoice.amount_cents - invoice.paid_cents - invoice.credited_cents - coalesce((
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

-- ---------------------------------------------------------------------------
-- Read: an issued credit note, for the PDF. Billing staff of the matter, or a client who is a party
-- on the invoice's matter. Each read is audited as invoice.credit_note_read.
-- ---------------------------------------------------------------------------

create function public.invoice_credit_note(p_credit_note_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  note public.invoice_credit_notes%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'sign in is required' using errcode = '42501';
  end if;
  select * into note from public.invoice_credit_notes where id = p_credit_note_id;
  if note.id is null
     or note.status <> 'issued'
     or note.organization_id is distinct from (select app.current_organization_id())
     or not (app.can_read_matter_billing(note.matter_id) or app.is_matter_party(note.matter_id)) then
    raise exception 'credit note access denied' using errcode = '42501';
  end if;
  perform app.record_audit_event(
    note.organization_id, 'invoice.credit_note_read', 'public.invoice_credit_notes', note.id, 'success', '{}'::jsonb
  );
  return jsonb_build_object(
    'number', note.number,
    'issued_at', note.issued_at,
    'amount_cents', note.amount_cents,
    'currency', note.currency,
    'reason', note.reason,
    'applied_cents', note.applied_cents,
    'credit_balance_cents', note.credit_balance_cents,
    'invoice_number', note.invoice_number,
    'invoice_description', note.invoice_description,
    'invoice_issued_on', note.invoice_issued_on,
    'invoice_amount_cents', note.invoice_amount_cents,
    'client_name', note.client_name,
    'matter_label', note.matter_label,
    'firm_legal_name', note.firm_legal_name,
    'firm_display_name', note.firm_display_name,
    'firm_timezone', note.firm_timezone,
    'consultant_name', note.consultant_name,
    'consultant_licence', note.consultant_licence,
    'is_sample', note.is_sample
  );
end;
$$;
comment on function public.invoice_credit_note(uuid) is
  'An issued credit note for the PDF. Billing staff of the matter or a client party on it; audited.';

-- ---------------------------------------------------------------------------
-- Public wrappers. The database checks the caller; these stay security invoker.
-- ---------------------------------------------------------------------------

create function public.request_credit_note(p_invoice_id uuid, p_amount_cents bigint, p_reason text, p_idempotency_key text)
returns uuid language sql security invoker set search_path = ''
as $$ select app.request_credit_note(p_invoice_id, p_amount_cents, p_reason, p_idempotency_key); $$;

create function public.issue_credit_note(p_credit_note_id uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select app.issue_credit_note(p_credit_note_id); $$;

create function public.decline_credit_note(p_credit_note_id uuid, p_reason text)
returns uuid language sql security invoker set search_path = ''
as $$ select app.decline_credit_note(p_credit_note_id, p_reason); $$;

create function public.void_invoice(p_invoice_id uuid, p_reason text)
returns jsonb language sql security invoker set search_path = ''
as $$ select app.void_invoice(p_invoice_id, p_reason); $$;

revoke all on function public.request_credit_note(uuid, bigint, text, text) from public, anon;
revoke all on function public.issue_credit_note(uuid) from public, anon;
revoke all on function public.decline_credit_note(uuid, text) from public, anon;
revoke all on function public.void_invoice(uuid, text) from public, anon;
revoke all on function public.invoice_credit_note(uuid) from public, anon;

grant execute on function public.request_credit_note(uuid, bigint, text, text) to authenticated;
grant execute on function public.issue_credit_note(uuid) to authenticated;
grant execute on function public.decline_credit_note(uuid, text) to authenticated;
grant execute on function public.void_invoice(uuid, text) to authenticated;
grant execute on function public.invoice_credit_note(uuid) to authenticated;

grant execute on function app.require_invoice_billing(uuid, boolean) to authenticated;
grant execute on function app.check_creditable_invoice(public.invoices, bigint, uuid) to authenticated;
grant execute on function app.request_credit_note(uuid, bigint, text, text) to authenticated;
grant execute on function app.issue_credit_note(uuid) to authenticated;
grant execute on function app.decline_credit_note(uuid, text) to authenticated;
grant execute on function app.void_invoice(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Table privileges and row-level security
-- ---------------------------------------------------------------------------

revoke all on table public.invoice_credit_notes from anon, authenticated, service_role;
grant select on table public.invoice_credit_notes to authenticated, service_role;

alter table public.invoice_credit_notes enable row level security;
alter table public.invoice_credit_notes force row level security;

-- Billing staff of the matter see every credit note; a client who is a party on the matter sees
-- the issued ones (like the invoice itself).
create policy invoice_credit_notes_select on public.invoice_credit_notes
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (
      (select app.can_read_matter_billing(matter_id))
      or (status = 'issued' and (select app.is_matter_party(matter_id)))
    )
  );
