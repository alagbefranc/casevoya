-- Manual payments pending verification (FIN-09).
--
-- Casevoya never holds money. Billing staff record a payment a client made outside the card checkout
-- (Interac e-Transfer, cheque, wire / bank transfer, cash) from what the firm's own bank shows:
--
--   firm_operating_accounts    the firm's operating (general) bank account(s), as a record: a label,
--                              the institution and the last four digits, CAD. Earned-fee invoice
--                              payments go here, never to the client (trust) account. Added by the
--                              firm owner with a recent step-up, like client_accounts.
--   invoice_manual_payments    one manual payment of an issued invoice: method, external reference,
--                              received date, bank destination (an operating account), evidence (an
--                              uploaded staff-only document on the invoice's matter and/or a typed
--                              note), amount and the reviewer asked to verify it. It starts
--                              'pending_verification' and does not count as paid: invoices.paid_cents
--                              moves only when it is verified. MP-0001 per firm.
--   client_fund_deposit_reviews the same evidence document and reviewer for a client-funds advance
--                              (client_fund_entries kind 'deposit'), recorded with it by
--                              public.record_client_advance. One row per deposit, append-only.
--
-- Verification (invoice payments): someone other than the person who recorded it, unless no other
-- eligible staff member exists for the matter (eligible = an active firm owner, or an active finance
-- user assigned to the matter). Same rule as client-fund deposits and transfers (Francis,
-- docs/DECISIONS.md 2026-10-18): the firm owner may verify their own entry after a step-up taken after
-- it was recorded (self_verified, audited as invoice.manual_payment_verified_self). Only the named
-- reviewer or a firm owner verifies. Verifying needs a recent step-up and re-checks the amount due.
-- Verifying adds the amount to invoices.paid_cents and the new invoices.manual_paid_cents; the invoice
-- status follows app.invoice_settled_status.
--
-- Reversed or failed: a verified payment the bank reversed ('reversed' or 'failed'), or a pending one
-- that didn't clear ('failed'), with a reason and a step-up. A verified one reopens the invoice balance
-- (paid_cents and manual_paid_cents go down, status recomputed). Either way an internal task is
-- created for the matter's responsible consultant (the firm owner when the matter has none). The
-- matter's stage and government status are never changed.
--
-- A client who is a party on the invoice's matter reads a summary of its manual payments (number,
-- status, amount, date, method) through public.invoice_manual_payment_summary, so their portal shows
-- "Pending verification", not "Paid". They never read the evidence, reviewer or notes.
--
-- Client-funds advances keep their own verify / reject / correct flow; verify_client_deposit now also
-- honours the named reviewer (copied from 20261019140000_owner_self_verify_step_up.sql, one check
-- added). Additive only.

-- ---------------------------------------------------------------------------
-- Operating accounts
-- ---------------------------------------------------------------------------

create table public.firm_operating_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  label text not null check (length(btrim(label)) between 1 and 80),
  institution text not null check (length(btrim(institution)) between 1 and 120),
  account_last4 text not null check (account_last4 ~ '^[0-9]{4}$'),
  currency text not null default 'CAD' check (currency = 'CAD'),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id),
  unique (organization_id, label)
);
comment on table public.firm_operating_accounts is
  'The firm''s own operating bank account(s), as a record: label, institution, last four digits. Manual invoice payments name one as their bank destination. Casevoya holds no money.';

create index firm_operating_accounts_created_by_idx on public.firm_operating_accounts (created_by);

create trigger firm_operating_accounts_touch before update on public.firm_operating_accounts
  for each row execute function app.touch_row();
create trigger firm_operating_accounts_stamp before insert on public.firm_operating_accounts
  for each row execute function app.stamp_created_by();
create trigger firm_operating_accounts_audit after insert or update or delete on public.firm_operating_accounts
  for each row execute function app.audit_row_change();
create trigger firm_operating_accounts_no_delete before delete on public.firm_operating_accounts
  for each row execute function app.reject_governed_delete();

create function app.create_firm_operating_account(p_org uuid, p_label text, p_institution text, p_last4 text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_label text := btrim(coalesce(p_label, ''));
  v_institution text := btrim(coalesce(p_institution, ''));
  v_last4 text := btrim(coalesce(p_last4, ''));
  existing uuid;
  rid uuid;
begin
  perform app.require_firm_owner_step_up(p_org);
  if length(v_label) not between 1 and 80 then
    raise exception 'operating account label is required' using errcode = '22023';
  end if;
  if length(v_institution) not between 1 and 120 then
    raise exception 'operating account institution is required' using errcode = '22023';
  end if;
  if v_last4 !~ '^[0-9]{4}$' then
    raise exception 'operating account last four digits are invalid' using errcode = '22023';
  end if;
  select account.id into existing from public.firm_operating_accounts account
  where account.organization_id = p_org and account.label = v_label;
  if existing is not null then
    return existing;
  end if;
  insert into public.firm_operating_accounts (organization_id, label, institution, account_last4)
  values (p_org, v_label, v_institution, v_last4)
  returning id into rid;
  perform app.record_audit_event(
    p_org, 'finance.operating_account_added', 'public.firm_operating_accounts', rid, 'success',
    jsonb_build_object('last4', v_last4)
  );
  return rid;
end;
$$;
revoke all on function app.create_firm_operating_account(uuid, text, text, text) from public, anon;

-- ---------------------------------------------------------------------------
-- Reviewers
-- ---------------------------------------------------------------------------

-- Whether p_user_id may review a manual payment on this matter: an active firm owner of the matter's
-- firm, or an active finance user assigned to the matter (a participant, as for billing access).
create function app.payment_reviewer_eligible(p_matter_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null and exists (
    select 1
    from public.matters matter
    join public.memberships mem
      on mem.organization_id = matter.organization_id
     and mem.user_id = p_user_id
     and mem.status = 'active'
    where matter.id = p_matter_id
      and (
        mem.role = 'firm_owner'
        or (
          mem.role = 'finance_user'
          and exists (
            select 1 from public.matter_participants party
            where party.matter_id = matter.id
              and party.organization_id = matter.organization_id
              and party.membership_id = mem.id
          )
        )
      )
  );
$$;
revoke all on function app.payment_reviewer_eligible(uuid, uuid) from public, anon;

-- How many eligible reviewers the matter has other than p_except.
create function app.payment_reviewers_other_than(p_matter_id uuid, p_except uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(distinct mem.user_id)::integer
  from public.matters matter
  join public.memberships mem
    on mem.organization_id = matter.organization_id
   and mem.status = 'active'
   and mem.role in ('firm_owner', 'finance_user')
  where matter.id = p_matter_id
    and mem.user_id is distinct from p_except
    and app.payment_reviewer_eligible(matter.id, mem.user_id);
$$;
revoke all on function app.payment_reviewers_other_than(uuid, uuid) from public, anon;

-- The reviewer named on a new manual payment or advance: eligible for the matter, and not the person
-- recording it unless nobody else is.
create function app.check_payment_reviewer(p_matter_id uuid, p_reviewer uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if app.payment_reviewer_eligible(p_matter_id, p_reviewer) is distinct from true then
    raise exception 'choose a reviewer: the firm owner or a finance user on this matter' using errcode = '22023';
  end if;
  if p_reviewer = (select auth.uid()) and app.payment_reviewers_other_than(p_matter_id, p_reviewer) > 0 then
    raise exception 'choose a reviewer other than yourself' using errcode = '22023';
  end if;
end;
$$;
revoke all on function app.check_payment_reviewer(uuid, uuid) from public, anon;

-- An uploaded evidence file: a cleared version of a document filed on this matter.
create function app.check_payment_evidence(p_matter_id uuid, p_version_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_version_id is null then
    return;
  end if;
  if not exists (
    select 1
    from public.document_versions version
    join public.matters matter on matter.id = p_matter_id
    join public.document_matter_refs ref
      on ref.document_id = version.document_id
     and ref.matter_id = matter.id
     and ref.organization_id = matter.organization_id
     and ref.removed_at is null
    where version.id = p_version_id
      and version.organization_id = matter.organization_id
      and version.upload_state = 'clean'
  ) then
    raise exception 'the evidence file must be a cleared upload on this matter' using errcode = '22023';
  end if;
end;
$$;
revoke all on function app.check_payment_evidence(uuid, uuid) from public, anon;

-- ---------------------------------------------------------------------------
-- Manual invoice payments
-- ---------------------------------------------------------------------------

alter table public.invoices add column manual_paid_cents bigint not null default 0;
alter table public.invoices add constraint invoices_manual_paid_within_paid
  check (manual_paid_cents >= 0 and manual_paid_cents + client_funds_paid_cents <= paid_cents);
comment on column public.invoices.manual_paid_cents is
  'Paid by verified manual payments (e-transfer, cheque, wire, cash; invoice_manual_payments), minor units. Part of paid_cents.';

create table public.invoice_manual_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  invoice_id uuid not null,
  matter_id uuid not null,
  number text not null check (number ~ '^MP-[0-9]{4,9}$'),
  method public.client_fund_method not null,
  external_reference text not null check (length(btrim(external_reference)) between 1 and 80),
  received_on date not null,
  operating_account_id uuid not null,
  evidence_version_id uuid references public.document_versions (id),
  evidence_note text check (evidence_note is null or length(btrim(evidence_note)) between 1 and 500),
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 99999999999),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  status public.manual_payment_status not null default 'pending_verification',
  reviewer_user_id uuid not null references auth.users (id),
  recorded_by uuid not null references auth.users (id),
  verified_by uuid references auth.users (id),
  verified_at timestamptz,
  self_verified boolean not null default false,
  rejected_by uuid references auth.users (id),
  rejected_at timestamptz,
  rejection_reason text check (rejection_reason is null or length(btrim(rejection_reason)) between 3 and 500),
  reversed_by uuid references auth.users (id),
  reversed_at timestamptz,
  reversal_reason text check (reversal_reason is null or length(btrim(reversal_reason)) between 3 and 500),
  -- What the reversal took back off the invoice (the amount when it had been verified, else 0).
  reopened_cents bigint not null default 0 check (reopened_cents >= 0),
  reversal_task_id uuid,
  is_sample boolean not null default false,
  idempotency_key text not null check (length(idempotency_key) between 8 and 180),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id),
  unique (organization_id, number),
  unique (organization_id, idempotency_key),
  check (evidence_version_id is not null or evidence_note is not null),
  check (status <> 'verified' or (verified_by is not null and verified_at is not null)),
  check (status <> 'rejected' or (rejected_by is not null and rejected_at is not null and rejection_reason is not null)),
  check (status not in ('reversed', 'failed') or (reversed_by is not null and reversed_at is not null and reversal_reason is not null)),
  check (status <> 'reversed' or (verified_by is not null and reopened_cents = amount_cents)),
  check (reopened_cents = 0 or reopened_cents = amount_cents),
  -- Second person: only a self-verification (no one else eligible, or the firm owner's own) names the recorder.
  check (verified_by is null or verified_by <> recorded_by or self_verified),
  check (not self_verified or verified_by = recorded_by),
  foreign key (invoice_id, organization_id) references public.invoices (id, organization_id),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id),
  foreign key (operating_account_id, organization_id) references public.firm_operating_accounts (id, organization_id),
  foreign key (reversal_task_id, organization_id) references public.tasks (id, organization_id)
);
comment on table public.invoice_manual_payments is
  'Manual payments of issued invoices (FIN-09): pending verification until a reviewer verifies them; reversed or failed ones reopen the balance and create a task. Amounts and evidence never change.';

create index invoice_manual_payments_invoice_org_fk_idx on public.invoice_manual_payments (invoice_id, organization_id);
create index invoice_manual_payments_matter_org_fk_idx on public.invoice_manual_payments (matter_id, organization_id);
create index invoice_manual_payments_account_org_fk_idx on public.invoice_manual_payments (operating_account_id, organization_id);
create index invoice_manual_payments_task_org_fk_idx on public.invoice_manual_payments (reversal_task_id, organization_id);
create index invoice_manual_payments_evidence_idx on public.invoice_manual_payments (evidence_version_id);
create index invoice_manual_payments_reviewer_idx on public.invoice_manual_payments (reviewer_user_id);
create index invoice_manual_payments_recorded_by_idx on public.invoice_manual_payments (recorded_by);
create index invoice_manual_payments_verified_by_idx on public.invoice_manual_payments (verified_by);
create index invoice_manual_payments_rejected_by_idx on public.invoice_manual_payments (rejected_by);
create index invoice_manual_payments_reversed_by_idx on public.invoice_manual_payments (reversed_by);
create index invoice_manual_payments_created_by_idx on public.invoice_manual_payments (created_by);
create index invoice_manual_payments_org_status_idx on public.invoice_manual_payments (organization_id, status);

-- What was recorded never changes; a payment moves forward once or twice:
-- pending_verification -> verified | rejected | failed; verified -> reversed | failed.
create function app.guard_manual_payment_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'manual payments are append-only' using errcode = '42501';
  end if;
  if (new.organization_id, new.invoice_id, new.matter_id, new.number, new.method, new.external_reference,
      new.received_on, new.operating_account_id, new.evidence_version_id, new.evidence_note, new.amount_cents,
      new.currency, new.reviewer_user_id, new.recorded_by, new.is_sample, new.idempotency_key, new.created_at)
     is distinct from
     (old.organization_id, old.invoice_id, old.matter_id, old.number, old.method, old.external_reference,
      old.received_on, old.operating_account_id, old.evidence_version_id, old.evidence_note, old.amount_cents,
      old.currency, old.reviewer_user_id, old.recorded_by, old.is_sample, old.idempotency_key, old.created_at) then
    raise exception 'manual payments are append-only' using errcode = '42501';
  end if;
  if not (
    (old.status = 'pending_verification' and new.status in ('verified', 'rejected', 'failed'))
    or (old.status = 'verified' and new.status in ('reversed', 'failed'))
  ) then
    raise exception 'manual payments are append-only' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.guard_manual_payment_change() from public, anon, authenticated;

create trigger invoice_manual_payments_guard before update or delete on public.invoice_manual_payments
  for each row execute function app.guard_manual_payment_change();
create trigger invoice_manual_payments_touch before update on public.invoice_manual_payments
  for each row execute function app.touch_row();
create trigger invoice_manual_payments_stamp before insert on public.invoice_manual_payments
  for each row execute function app.stamp_created_by();
create trigger invoice_manual_payments_audit after insert or update or delete on public.invoice_manual_payments
  for each row execute function app.audit_row_change();

create function app.next_manual_payment_number(p_org uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_number integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('casevoya.manual_payment_number:' || p_org::text, 0));
  select coalesce(max(substring(payment.number from 4)::integer), 0) + 1 into next_number
  from public.invoice_manual_payments payment
  where payment.organization_id = p_org;
  return 'MP-' || lpad(next_number::text, 4, '0');
end;
$$;
revoke all on function app.next_manual_payment_number(uuid) from public, anon;

create function app.record_invoice_manual_payment(
  p_invoice_id uuid,
  p_amount_cents bigint,
  p_method text,
  p_reference text,
  p_received_on date,
  p_operating_account_id uuid,
  p_evidence_version_id uuid,
  p_evidence_note text,
  p_reviewer_user_id uuid,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  invoice public.invoices%rowtype;
  account public.firm_operating_accounts%rowtype;
  existing public.invoice_manual_payments%rowtype;
  key text;
  reference text := nullif(btrim(coalesce(p_reference, '')), '');
  evidence text := nullif(btrim(coalesce(p_evidence_note, '')), '');
  method public.client_fund_method;
  pending bigint;
  rid uuid;
begin
  select * into invoice from public.invoices where id = p_invoice_id;
  perform app.require_client_funds_access(invoice.matter_id, false);
  key := app.client_fund_key(p_idempotency_key);
  select * into existing from public.invoice_manual_payments
  where organization_id = invoice.organization_id and idempotency_key = key;
  if existing.id is not null then
    if existing.invoice_id <> invoice.id then
      raise exception 'idempotency key was used for another payment' using errcode = '23505';
    end if;
    return existing.id;
  end if;
  if app.sample_mode_blocks_real(invoice.organization_id, invoice.is_sample) then
    raise exception 'this firm is in sample mode; only sample invoices take payments' using errcode = '42501';
  end if;
  -- One payment decision at a time per invoice.
  select * into invoice from public.invoices where id = invoice.id for update;
  if invoice.status not in ('issued', 'partially_paid') then
    raise exception 'only an issued invoice with an amount due can take a manual payment' using errcode = '22023';
  end if;
  if exists (select 1 from public.invoice_payments payment where payment.invoice_id = invoice.id and payment.status = 'processing') then
    raise exception 'a card payment on this invoice is processing' using errcode = '22023';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 or p_amount_cents > 99999999999 then
    raise exception 'amount must be positive' using errcode = '22023';
  end if;
  select coalesce(sum(payment.amount_cents), 0) into pending
  from public.invoice_manual_payments payment
  where payment.invoice_id = invoice.id and payment.status = 'pending_verification';
  if p_amount_cents > invoice.amount_cents - invoice.paid_cents - invoice.credited_cents - pending then
    raise exception 'payment exceeds the amount due on the invoice' using errcode = '22023';
  end if;
  begin
    method := btrim(coalesce(p_method, ''))::public.client_fund_method;
  exception when others then
    raise exception 'payment method is invalid' using errcode = '22023';
  end;
  if reference is null then
    raise exception 'external reference is required' using errcode = '22023';
  end if;
  if length(reference) > 80 then
    raise exception 'reference is too long' using errcode = '22023';
  end if;
  if p_received_on is null or p_received_on > app.firm_today(invoice.organization_id) then
    raise exception 'received date can''t be in the future' using errcode = '22023';
  end if;
  if p_received_on < coalesce(invoice.issued_on, p_received_on) - 366 then
    raise exception 'received date is too long before the invoice' using errcode = '22023';
  end if;
  select * into account from public.firm_operating_accounts
  where id = p_operating_account_id and organization_id = invoice.organization_id and is_active;
  if account.id is null then
    raise exception 'choose the firm''s operating account' using errcode = '22023';
  end if;
  if evidence is not null and length(evidence) > 500 then
    raise exception 'evidence note is too long' using errcode = '22023';
  end if;
  if p_evidence_version_id is null and evidence is null then
    raise exception 'evidence is required: upload a file or describe it' using errcode = '22023';
  end if;
  perform app.check_payment_evidence(invoice.matter_id, p_evidence_version_id);
  perform app.check_payment_reviewer(invoice.matter_id, p_reviewer_user_id);

  insert into public.invoice_manual_payments (
    organization_id, invoice_id, matter_id, number, method, external_reference, received_on,
    operating_account_id, evidence_version_id, evidence_note, amount_cents, currency, status,
    reviewer_user_id, recorded_by, is_sample, idempotency_key
  ) values (
    invoice.organization_id, invoice.id, invoice.matter_id, app.next_manual_payment_number(invoice.organization_id),
    method, reference, p_received_on, account.id, p_evidence_version_id, evidence, p_amount_cents, invoice.currency,
    'pending_verification', p_reviewer_user_id, (select auth.uid()), invoice.is_sample, key
  )
  returning id into rid;
  perform app.record_audit_event(
    invoice.organization_id, 'invoice.manual_payment_recorded', 'public.invoice_manual_payments', rid, 'success',
    jsonb_build_object(
      'invoice_id', invoice.id, 'amount_cents', p_amount_cents, 'currency', invoice.currency, 'method', method,
      'reviewer_user_id', p_reviewer_user_id, 'has_evidence_file', p_evidence_version_id is not null
    )
  );
  return rid;
end;
$$;
revoke all on function app.record_invoice_manual_payment(uuid, bigint, text, text, date, uuid, uuid, text, uuid, text) from public, anon;

create function app.verify_invoice_manual_payment(p_payment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  payment public.invoice_manual_payments%rowtype;
  invoice public.invoices%rowtype;
  actor uuid := (select auth.uid());
  is_owner boolean;
  self_check boolean := false;
begin
  select * into payment from public.invoice_manual_payments where id = p_payment_id;
  perform app.require_client_funds_access(payment.matter_id, true);
  select * into invoice from public.invoices where id = payment.invoice_id for update;
  select * into payment from public.invoice_manual_payments where id = p_payment_id for update;
  if payment.status <> 'pending_verification' then
    raise exception 'only a payment pending verification can be verified' using errcode = '22023';
  end if;
  is_owner := app.has_org_role(payment.organization_id, array['firm_owner']::public.org_role[]) is true;
  if actor <> payment.reviewer_user_id and not is_owner then
    raise exception 'only the named reviewer or the firm owner can verify this payment' using errcode = '42501';
  end if;
  if actor = payment.recorded_by then
    if not is_owner and app.payment_reviewers_other_than(payment.matter_id, actor) > 0 then
      raise exception 'the person who recorded a payment cannot verify it' using errcode = '42501';
    end if;
    if app.mfa_step_up_satisfied(least(interval '15 minutes', statement_timestamp() - date_trunc('second', payment.created_at)))
       is distinct from true then
      raise exception 'step-up is required: verifying your own payment needs a step-up after it was recorded' using errcode = '42501';
    end if;
    self_check := true;
  end if;
  if invoice.status not in ('issued', 'partially_paid') then
    raise exception 'only an issued invoice with an amount due can take a manual payment; reject or mark it failed' using errcode = '22023';
  end if;
  if exists (select 1 from public.invoice_payments card where card.invoice_id = invoice.id and card.status = 'processing') then
    raise exception 'a card payment on this invoice is processing' using errcode = '22023';
  end if;
  if payment.amount_cents > invoice.amount_cents - invoice.paid_cents - invoice.credited_cents then
    raise exception 'payment exceeds the amount due on the invoice' using errcode = '22023';
  end if;

  update public.invoice_manual_payments
  set status = 'verified', verified_by = actor, verified_at = clock_timestamp(), self_verified = self_check
  where id = payment.id
  returning * into payment;
  update public.invoices
  set paid_cents = paid_cents + payment.amount_cents,
      manual_paid_cents = manual_paid_cents + payment.amount_cents,
      status = app.invoice_settled_status(status, amount_cents, paid_cents + payment.amount_cents, credited_cents, refunded_cents)
  where id = invoice.id
  returning * into invoice;
  perform app.record_audit_event(
    payment.organization_id,
    case when self_check then 'invoice.manual_payment_verified_self' else 'invoice.manual_payment_verified' end,
    'public.invoice_manual_payments', payment.id, 'success',
    jsonb_build_object('invoice_id', invoice.id, 'amount_cents', payment.amount_cents, 'recorded_by', payment.recorded_by, 'self_verified', self_check)
  );
  return jsonb_build_object('status', payment.status, 'self_verified', self_check, 'invoice_status', invoice.status);
end;
$$;
revoke all on function app.verify_invoice_manual_payment(uuid) from public, anon;

create function app.reject_invoice_manual_payment(p_payment_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  payment public.invoice_manual_payments%rowtype;
  reason text := btrim(coalesce(p_reason, ''));
begin
  select * into payment from public.invoice_manual_payments where id = p_payment_id;
  perform app.require_client_funds_access(payment.matter_id, false);
  select * into payment from public.invoice_manual_payments where id = p_payment_id for update;
  if payment.status <> 'pending_verification' then
    raise exception 'only a payment pending verification can be rejected' using errcode = '22023';
  end if;
  if length(reason) not between 3 and 500 then
    raise exception 'a reason is required' using errcode = '22023';
  end if;
  update public.invoice_manual_payments
  set status = 'rejected', rejected_by = (select auth.uid()), rejected_at = clock_timestamp(), rejection_reason = reason
  where id = payment.id;
  perform app.record_audit_event(
    payment.organization_id, 'invoice.manual_payment_rejected', 'public.invoice_manual_payments', payment.id, 'success',
    jsonb_build_object('invoice_id', payment.invoice_id, 'amount_cents', payment.amount_cents)
  );
  return payment.id;
end;
$$;
revoke all on function app.reject_invoice_manual_payment(uuid, text) from public, anon;

-- The internal follow-up task for a reversed or failed payment: the matter's responsible consultant,
-- else the firm's longest-standing active owner. Returns the task id.
create function app.create_payment_followup_task(p_matter_id uuid, p_title text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  matter public.matters%rowtype;
  owner_membership uuid;
  zone text;
  tid uuid;
begin
  select * into matter from public.matters where id = p_matter_id;
  select mem.id into owner_membership
  from public.memberships mem
  where mem.id = matter.responsible_consultant_membership_id
    and mem.organization_id = matter.organization_id
    and mem.status = 'active';
  if owner_membership is null then
    select mem.id into owner_membership
    from public.memberships mem
    where mem.organization_id = matter.organization_id and mem.role = 'firm_owner' and mem.status = 'active'
    order by mem.created_at, mem.id
    limit 1;
  end if;
  select coalesce(nullif(btrim(org.timezone), ''), 'America/Toronto') into zone from public.organizations org where org.id = matter.organization_id;
  insert into public.tasks (organization_id, matter_id, audience, title, priority, owner_membership_id, due_on, due_timezone, checklist)
  values (matter.organization_id, matter.id, 'internal', left(p_title, 200), 'high', owner_membership, app.firm_today(matter.organization_id), coalesce(zone, 'America/Toronto'), '[]'::jsonb)
  returning id into tid;
  insert into public.task_events (organization_id, task_id, event_kind, to_status, to_membership_id, actor_user_id)
  values (matter.organization_id, tid, 'created', 'open', owner_membership, (select auth.uid()));
  return tid;
end;
$$;
revoke all on function app.create_payment_followup_task(uuid, text) from public, anon;

-- Marks a manual payment reversed (a verified one the bank took back) or failed (it didn't clear).
-- A verified one reopens the invoice balance. Always creates a task; never changes the matter.
create function app.reverse_invoice_manual_payment(p_payment_id uuid, p_outcome text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  payment public.invoice_manual_payments%rowtype;
  invoice public.invoices%rowtype;
  outcome text := btrim(coalesce(p_outcome, ''));
  reason text := btrim(coalesce(p_reason, ''));
  reopened bigint := 0;
  task uuid;
begin
  select * into payment from public.invoice_manual_payments where id = p_payment_id;
  perform app.require_client_funds_access(payment.matter_id, true);
  select * into invoice from public.invoices where id = payment.invoice_id for update;
  select * into payment from public.invoice_manual_payments where id = p_payment_id for update;
  if outcome not in ('reversed', 'failed') then
    raise exception 'choose reversed or failed' using errcode = '22023';
  end if;
  if payment.status = 'pending_verification' and outcome = 'reversed' then
    raise exception 'only a verified payment can be reversed; mark a pending one failed' using errcode = '22023';
  end if;
  if payment.status not in ('pending_verification', 'verified') then
    raise exception 'only a pending or verified payment can be marked reversed or failed' using errcode = '22023';
  end if;
  if length(reason) not between 3 and 500 then
    raise exception 'a reason is required' using errcode = '22023';
  end if;
  if payment.status = 'verified' then
    reopened := payment.amount_cents;
    if invoice.paid_cents - reopened < invoice.refunded_cents or invoice.manual_paid_cents < reopened then
      raise exception 'refunds on this invoice exceed what would remain paid' using errcode = '22023';
    end if;
    update public.invoices
    set paid_cents = paid_cents - reopened,
        manual_paid_cents = manual_paid_cents - reopened,
        status = app.invoice_settled_status(
          case when status in ('paid', 'partially_paid') then 'issued'::public.invoice_status else status end,
          amount_cents, paid_cents - reopened, credited_cents, refunded_cents
        )
    where id = invoice.id
    returning * into invoice;
  end if;
  task := app.create_payment_followup_task(
    payment.matter_id,
    format('Payment %s %s: follow up with the client about invoice %s', payment.number,
      case outcome when 'reversed' then 'was reversed' else 'failed' end, invoice.number)
  );
  update public.invoice_manual_payments
  set status = outcome::public.manual_payment_status,
      reversed_by = (select auth.uid()),
      reversed_at = clock_timestamp(),
      reversal_reason = reason,
      reopened_cents = reopened,
      reversal_task_id = task
  where id = payment.id
  returning * into payment;
  perform app.record_audit_event(
    payment.organization_id, 'invoice.manual_payment_' || outcome, 'public.invoice_manual_payments', payment.id, 'success',
    jsonb_build_object('invoice_id', invoice.id, 'amount_cents', payment.amount_cents, 'reopened_cents', reopened, 'task_id', task)
  );
  return jsonb_build_object('status', payment.status, 'reopened_cents', reopened, 'task_id', task, 'invoice_status', invoice.status);
end;
$$;
revoke all on function app.reverse_invoice_manual_payment(uuid, text, text) from public, anon;

-- ---------------------------------------------------------------------------
-- Client-funds advances: evidence file and reviewer
-- ---------------------------------------------------------------------------

create table public.client_fund_deposit_reviews (
  entry_id uuid primary key,
  organization_id uuid not null references public.organizations (id),
  matter_id uuid not null,
  evidence_version_id uuid references public.document_versions (id),
  reviewer_user_id uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  unique (entry_id, organization_id),
  foreign key (entry_id, organization_id) references public.client_fund_entries (id, organization_id),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id)
);
comment on table public.client_fund_deposit_reviews is
  'The evidence file and the reviewer named when a client-funds advance was recorded (FIN-09). Append-only.';

create index client_fund_deposit_reviews_entry_org_fk_idx on public.client_fund_deposit_reviews (entry_id, organization_id);
create index client_fund_deposit_reviews_matter_org_fk_idx on public.client_fund_deposit_reviews (matter_id, organization_id);
create index client_fund_deposit_reviews_evidence_idx on public.client_fund_deposit_reviews (evidence_version_id);
create index client_fund_deposit_reviews_reviewer_idx on public.client_fund_deposit_reviews (reviewer_user_id);
create index client_fund_deposit_reviews_created_by_idx on public.client_fund_deposit_reviews (created_by);

create trigger client_fund_deposit_reviews_stamp before insert on public.client_fund_deposit_reviews
  for each row execute function app.stamp_created_by();
create trigger client_fund_deposit_reviews_audit after insert or update or delete on public.client_fund_deposit_reviews
  for each row execute function app.audit_row_change();
create trigger client_fund_deposit_reviews_no_change before update or delete on public.client_fund_deposit_reviews
  for each row execute function app.reject_client_fund_record_change();

-- Records an advance with the same fields as a manual invoice payment: method, reference, date, the
-- client account it went to, evidence (an uploaded file and/or a note), amount and reviewer. The
-- entry itself is app.record_client_deposit's (unchanged); the file and reviewer sit beside it.
create function app.record_client_advance(
  p_client_account_id uuid,
  p_matter_id uuid,
  p_person_id uuid,
  p_amount_cents bigint,
  p_method text,
  p_reference text,
  p_received_on date,
  p_evidence_version_id uuid,
  p_evidence_note text,
  p_reviewer_user_id uuid,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  matter public.matters%rowtype;
  entry public.client_fund_entries%rowtype;
  rid uuid;
begin
  select * into matter from public.matters where id = p_matter_id;
  perform app.require_client_funds_access(matter.id, false);
  if nullif(btrim(coalesce(p_reference, '')), '') is null then
    raise exception 'external reference is required' using errcode = '22023';
  end if;
  if p_evidence_version_id is null and nullif(btrim(coalesce(p_evidence_note, '')), '') is null then
    raise exception 'evidence is required: upload a file or describe it' using errcode = '22023';
  end if;
  perform app.check_payment_evidence(matter.id, p_evidence_version_id);
  perform app.check_payment_reviewer(matter.id, p_reviewer_user_id);
  rid := app.record_client_deposit(
    p_client_account_id, p_matter_id, p_person_id, p_amount_cents, 'CAD', p_method, p_reference, p_received_on,
    p_evidence_note, p_idempotency_key
  );
  select * into entry from public.client_fund_entries where id = rid;
  insert into public.client_fund_deposit_reviews (entry_id, organization_id, matter_id, evidence_version_id, reviewer_user_id)
  values (entry.id, entry.organization_id, entry.matter_id, p_evidence_version_id, p_reviewer_user_id)
  on conflict (entry_id) do nothing;
  return rid;
end;
$$;
revoke all on function app.record_client_advance(uuid, uuid, uuid, bigint, text, text, date, uuid, text, uuid, text) from public, anon;

-- From 20261019140000_owner_self_verify_step_up.sql. Added: when a reviewer was named for the
-- deposit, only that reviewer or a firm owner verifies it.
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
  named_reviewer uuid;
begin
  select * into entry from public.client_fund_entries where id = p_entry_id;
  perform app.require_client_funds_access(entry.matter_id, false);
  perform 1 from public.client_fund_ledgers where id = entry.ledger_id for update;
  select * into entry from public.client_fund_entries where id = p_entry_id for update;
  if entry.kind <> 'deposit' or entry.status <> 'pending_verification' then
    raise exception 'only a deposit pending verification can be verified' using errcode = '22023';
  end if;
  select review.reviewer_user_id into named_reviewer from public.client_fund_deposit_reviews review where review.entry_id = entry.id;
  if named_reviewer is not null and named_reviewer <> actor
     and app.has_org_role(entry.organization_id, array['firm_owner']::public.org_role[]) is distinct from true then
    raise exception 'only the named reviewer or the firm owner can verify this payment' using errcode = '42501';
  end if;
  if entry.requested_by = actor then
    if app.has_org_role(entry.organization_id, array['firm_owner']::public.org_role[]) is distinct from true then
      raise exception 'the person who recorded a deposit cannot verify it' using errcode = '42501';
    end if;
    -- Same rule as the owner approving their own transfer: a step-up taken after the deposit was
    -- recorded, and no older than 15 minutes.
    if app.mfa_step_up_satisfied(least(interval '15 minutes', statement_timestamp() - date_trunc('second', entry.created_at)))
       is distinct from true then
      raise exception 'step-up is required: verifying your own deposit needs a step-up after it was recorded' using errcode = '42501';
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

-- ---------------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------------

-- Who may be named as a reviewer, for the dialogs: the firm's active owners (every matter) and its
-- active finance users with the matters they're assigned to. Billing staff only.
create function public.list_payment_reviewers(p_org uuid)
returns table (user_id uuid, display_name text, role text, matter_ids uuid[])
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if app.can_read_firm_payment_account(p_org) is distinct from true then
    raise exception 'billing access denied' using errcode = '42501';
  end if;
  return query
    select mem.user_id,
           coalesce(nullif(btrim(coalesce(prof.display_name, '')), ''), 'Staff member'),
           mem.role::text,
           case when mem.role = 'firm_owner' then null else coalesce((
             select array_agg(distinct party.matter_id)
             from public.matter_participants party
             where party.organization_id = mem.organization_id and party.membership_id = mem.id
           ), '{}'::uuid[]) end
    from public.memberships mem
    left join public.profiles prof on prof.id = mem.user_id
    where mem.organization_id = p_org
      and mem.status = 'active'
      and mem.role in ('firm_owner', 'finance_user')
    order by mem.role, 2;
end;
$$;

-- An invoice's manual payments as its client may see them (FIN-09): number, state, amount, date and
-- method. Anyone who can read the invoice (its billing staff, or a party on its matter) in the active
-- workspace. Never the evidence, reviewer or notes.
create function public.invoice_manual_payment_summary(p_invoice_ids uuid[])
returns table (payment_id uuid, invoice_id uuid, number text, status text, amount_cents bigint, currency text, received_on date, method text)
language sql
stable
security definer
set search_path = ''
as $$
  select payment.id, payment.invoice_id, payment.number, payment.status::text, payment.amount_cents, payment.currency,
         payment.received_on, payment.method::text
  from public.invoice_manual_payments payment
  where payment.invoice_id = any (coalesce(p_invoice_ids, '{}'::uuid[]))
    and payment.organization_id = (select app.current_organization_id())
    and app.can_read_invoice(payment.invoice_id)
  order by payment.number;
$$;

-- ---------------------------------------------------------------------------
-- Public wrappers. The database checks the caller; these stay security invoker.
-- ---------------------------------------------------------------------------

create function public.create_firm_operating_account(p_org uuid, p_label text, p_institution text, p_last4 text)
returns uuid language sql security invoker set search_path = ''
as $$ select app.create_firm_operating_account(p_org, p_label, p_institution, p_last4); $$;

create function public.record_invoice_manual_payment(
  p_invoice_id uuid, p_amount_cents bigint, p_method text, p_reference text, p_received_on date,
  p_operating_account_id uuid, p_evidence_version_id uuid, p_evidence_note text, p_reviewer_user_id uuid, p_idempotency_key text
) returns uuid language sql security invoker set search_path = ''
as $$
  select app.record_invoice_manual_payment(
    p_invoice_id, p_amount_cents, p_method, p_reference, p_received_on,
    p_operating_account_id, p_evidence_version_id, p_evidence_note, p_reviewer_user_id, p_idempotency_key
  );
$$;

create function public.verify_invoice_manual_payment(p_payment_id uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select app.verify_invoice_manual_payment(p_payment_id); $$;

create function public.reject_invoice_manual_payment(p_payment_id uuid, p_reason text)
returns uuid language sql security invoker set search_path = ''
as $$ select app.reject_invoice_manual_payment(p_payment_id, p_reason); $$;

create function public.reverse_invoice_manual_payment(p_payment_id uuid, p_outcome text, p_reason text)
returns jsonb language sql security invoker set search_path = ''
as $$ select app.reverse_invoice_manual_payment(p_payment_id, p_outcome, p_reason); $$;

create function public.record_client_advance(
  p_client_account_id uuid, p_matter_id uuid, p_person_id uuid, p_amount_cents bigint, p_method text, p_reference text,
  p_received_on date, p_evidence_version_id uuid, p_evidence_note text, p_reviewer_user_id uuid, p_idempotency_key text
) returns uuid language sql security invoker set search_path = ''
as $$
  select app.record_client_advance(
    p_client_account_id, p_matter_id, p_person_id, p_amount_cents, p_method, p_reference,
    p_received_on, p_evidence_version_id, p_evidence_note, p_reviewer_user_id, p_idempotency_key
  );
$$;

revoke all on function public.create_firm_operating_account(uuid, text, text, text) from public, anon;
revoke all on function public.record_invoice_manual_payment(uuid, bigint, text, text, date, uuid, uuid, text, uuid, text) from public, anon;
revoke all on function public.verify_invoice_manual_payment(uuid) from public, anon;
revoke all on function public.reject_invoice_manual_payment(uuid, text) from public, anon;
revoke all on function public.reverse_invoice_manual_payment(uuid, text, text) from public, anon;
revoke all on function public.record_client_advance(uuid, uuid, uuid, bigint, text, text, date, uuid, text, uuid, text) from public, anon;
revoke all on function public.list_payment_reviewers(uuid) from public, anon;
revoke all on function public.invoice_manual_payment_summary(uuid[]) from public, anon;

grant execute on function public.create_firm_operating_account(uuid, text, text, text) to authenticated;
grant execute on function public.record_invoice_manual_payment(uuid, bigint, text, text, date, uuid, uuid, text, uuid, text) to authenticated;
grant execute on function public.verify_invoice_manual_payment(uuid) to authenticated;
grant execute on function public.reject_invoice_manual_payment(uuid, text) to authenticated;
grant execute on function public.reverse_invoice_manual_payment(uuid, text, text) to authenticated;
grant execute on function public.record_client_advance(uuid, uuid, uuid, bigint, text, text, date, uuid, text, uuid, text) to authenticated;
grant execute on function public.list_payment_reviewers(uuid) to authenticated;
grant execute on function public.invoice_manual_payment_summary(uuid[]) to authenticated;

grant execute on function app.create_firm_operating_account(uuid, text, text, text) to authenticated;
grant execute on function app.record_invoice_manual_payment(uuid, bigint, text, text, date, uuid, uuid, text, uuid, text) to authenticated;
grant execute on function app.verify_invoice_manual_payment(uuid) to authenticated;
grant execute on function app.reject_invoice_manual_payment(uuid, text) to authenticated;
grant execute on function app.reverse_invoice_manual_payment(uuid, text, text) to authenticated;
grant execute on function app.record_client_advance(uuid, uuid, uuid, bigint, text, text, date, uuid, text, uuid, text) to authenticated;
grant execute on function app.payment_reviewer_eligible(uuid, uuid) to authenticated;
grant execute on function app.payment_reviewers_other_than(uuid, uuid) to authenticated;
grant execute on function app.check_payment_reviewer(uuid, uuid) to authenticated;
grant execute on function app.check_payment_evidence(uuid, uuid) to authenticated;
grant execute on function app.next_manual_payment_number(uuid) to authenticated;
grant execute on function app.create_payment_followup_task(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Table privileges and row-level security
-- ---------------------------------------------------------------------------

revoke all on table public.firm_operating_accounts from anon, authenticated, service_role;
revoke all on table public.invoice_manual_payments from anon, authenticated, service_role;
revoke all on table public.client_fund_deposit_reviews from anon, authenticated, service_role;
grant select on table public.firm_operating_accounts to authenticated, service_role;
grant select on table public.invoice_manual_payments to authenticated, service_role;
grant select on table public.client_fund_deposit_reviews to authenticated, service_role;

alter table public.firm_operating_accounts enable row level security;
alter table public.firm_operating_accounts force row level security;
alter table public.invoice_manual_payments enable row level security;
alter table public.invoice_manual_payments force row level security;
alter table public.client_fund_deposit_reviews enable row level security;
alter table public.client_fund_deposit_reviews force row level security;

-- The firm's billing staff (owner, any finance user), as for the client accounts.
create policy firm_operating_accounts_select on public.firm_operating_accounts
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.can_read_firm_payment_account(organization_id))
  );

-- The matter's billing staff. Clients read the summary function, never these rows.
create policy invoice_manual_payments_select on public.invoice_manual_payments
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.can_read_matter_billing(matter_id))
  );

create policy client_fund_deposit_reviews_select on public.client_fund_deposit_reviews
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.can_read_matter_billing(matter_id))
  );
