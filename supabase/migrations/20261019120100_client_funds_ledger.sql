-- Client funds: a manual ledger of the firm's own client account (FIN-03, FIN-09, FIN-10, FIN-11).
--
-- Casevoya never holds client money. These tables record what happens in the client (trust)
-- account the firm keeps at its own bank: advances received, earned-fee transfers to the firm's
-- operating account, refunds to the client, and corrections. Card payments through Stripe pay
-- issued invoices only and are unchanged.
--
--   client_accounts       the firm's client bank account(s): a label, the institution and the last
--                         four digits. Never a full account number.
--   client_fund_ledgers   one sub-ledger per client (person) per matter per client account.
--   client_fund_entries   append-only entries. Amounts, parties and references never change; only a
--                         pending entry moves forward once (deposit: pending_verification ->
--                         verified | rejected; transfer: pending_approval -> approved | declined).
--                         Mistakes are fixed with a correction (a reversing entry), never an edit.
--
-- Money rules, enforced here and not only in the page:
--   * Balance = verified deposits - approved transfers - refunds +/- corrections. A sub-ledger's
--     balance never goes below zero (checked under the sub-ledger's row lock, and again by a
--     deferred constraint trigger). Available = balance - transfers still pending approval.
--   * A transfer pays an issued (earned) invoice on the same matter, for no more than the invoice's
--     amount due (less other pending transfers) and no more than the client's available balance.
--     Approving it marks the invoice paid or partially paid and counts it in
--     invoices.client_funds_paid_cents, so card and client-account payments stay distinguishable.
--   * Maker-checker: the approver is a different person from the requester. Decided by Francis:
--     the firm owner may always approve, including their own request. An owner's approval of their
--     own request is marked owner_self_approved, needs a step-up taken after the request was made,
--     and is audited as client_funds.transfer_approved_owner_self. A finance user never approves
--     their own transfer.
--   * Nothing here changes a matter's stage or a government status.
--
-- Who: the firm owner, or the finance user assigned to the matter (app.can_read_matter_billing,
-- aal2). Transfers, approvals, refunds and corrections also need a recent step-up (the same check
-- as app.can_perform_billing(..., 'approve_earned_fee_transfer')). Adding a client account needs the
-- firm owner with a step-up. A client reads their own sub-ledger's verified and applied entries.
-- In sample mode only sample matters take entries (rows carry is_sample, like invoices).
-- Additive only.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.client_accounts (
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
comment on table public.client_accounts is
  'The firm''s own client (trust) bank account, as a record: label, institution, last four digits. Casevoya holds no money.';

create index client_accounts_created_by_idx on public.client_accounts (created_by);

create table public.client_fund_ledgers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  client_account_id uuid not null,
  matter_id uuid not null,
  person_id uuid not null,
  is_sample boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id),
  unique (client_account_id, matter_id, person_id),
  foreign key (client_account_id, organization_id) references public.client_accounts (id, organization_id),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id),
  foreign key (person_id, organization_id) references public.persons (id, organization_id)
);
comment on table public.client_fund_ledgers is
  'One client sub-ledger: a client (person) on a matter, in one client account. Balances are derived from its entries.';

create index client_fund_ledgers_account_org_fk_idx on public.client_fund_ledgers (client_account_id, organization_id);
create index client_fund_ledgers_matter_org_fk_idx on public.client_fund_ledgers (matter_id, organization_id);
create index client_fund_ledgers_person_org_fk_idx on public.client_fund_ledgers (person_id, organization_id);
create index client_fund_ledgers_created_by_idx on public.client_fund_ledgers (created_by);

create table public.client_fund_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  ledger_id uuid not null,
  client_account_id uuid not null,
  matter_id uuid not null,
  person_id uuid not null,
  number text not null check (number ~ '^CF-[0-9]{4,9}$'),
  kind public.client_fund_entry_kind not null,
  status public.client_fund_entry_status not null,
  direction text not null check (direction in ('in', 'out')),
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 99999999999),
  currency text not null default 'CAD' check (currency = 'CAD'),
  method public.client_fund_method,
  external_reference text check (external_reference is null or length(btrim(external_reference)) between 1 and 80),
  occurred_on date not null,
  evidence_note text check (evidence_note is null or length(evidence_note) <= 500),
  note text check (note is null or length(note) <= 500),
  invoice_id uuid,
  reverses_entry_id uuid unique,
  is_sample boolean not null default false,
  idempotency_key text not null check (length(idempotency_key) between 8 and 180),
  requested_by uuid not null references auth.users (id),
  verified_by uuid references auth.users (id),
  verified_at timestamptz,
  rejected_by uuid references auth.users (id),
  rejected_at timestamptz,
  rejection_reason text check (rejection_reason is null or length(rejection_reason) between 3 and 500),
  approved_by uuid references auth.users (id),
  approved_at timestamptz,
  owner_self_approved boolean not null default false,
  declined_by uuid references auth.users (id),
  declined_at timestamptz,
  decline_reason text check (decline_reason is null or length(decline_reason) between 3 and 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id),
  unique (organization_id, number),
  unique (organization_id, idempotency_key),
  check (
    (kind = 'deposit' and direction = 'in' and method is not null and invoice_id is null and reverses_entry_id is null
      and status in ('pending_verification', 'verified', 'rejected'))
    or (kind = 'transfer' and direction = 'out' and invoice_id is not null and reverses_entry_id is null
      and status in ('pending_approval', 'approved', 'declined'))
    or (kind = 'refund' and direction = 'out' and method is not null and invoice_id is null and reverses_entry_id is null
      and status = 'recorded')
    or (kind = 'correction' and reverses_entry_id is not null and invoice_id is null and status = 'recorded')
  ),
  check (status <> 'verified' or (verified_by is not null and verified_at is not null)),
  check (status <> 'rejected' or (rejected_by is not null and rejected_at is not null and rejection_reason is not null)),
  check (status <> 'approved' or (approved_by is not null and approved_at is not null)),
  check (status <> 'declined' or (declined_by is not null and declined_at is not null and decline_reason is not null)),
  -- Maker-checker: only an owner's approval of their own request may name the requester.
  check (approved_by is null or approved_by <> requested_by or owner_self_approved),
  check (not owner_self_approved or (status = 'approved' and approved_by = requested_by)),
  foreign key (ledger_id, organization_id) references public.client_fund_ledgers (id, organization_id),
  foreign key (client_account_id, organization_id) references public.client_accounts (id, organization_id),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id),
  foreign key (person_id, organization_id) references public.persons (id, organization_id),
  foreign key (invoice_id, organization_id) references public.invoices (id, organization_id),
  foreign key (reverses_entry_id, organization_id) references public.client_fund_entries (id, organization_id)
);
comment on table public.client_fund_entries is
  'Append-only client-account ledger entries. Amounts never change; a pending deposit or transfer moves forward once; mistakes are corrected with a reversing entry.';

create index client_fund_entries_ledger_org_fk_idx on public.client_fund_entries (ledger_id, organization_id);
create index client_fund_entries_account_org_fk_idx on public.client_fund_entries (client_account_id, organization_id);
create index client_fund_entries_matter_org_fk_idx on public.client_fund_entries (matter_id, organization_id);
create index client_fund_entries_person_org_fk_idx on public.client_fund_entries (person_id, organization_id);
create index client_fund_entries_invoice_org_fk_idx on public.client_fund_entries (invoice_id, organization_id);
create index client_fund_entries_reverses_org_fk_idx on public.client_fund_entries (reverses_entry_id, organization_id);
create index client_fund_entries_org_created_idx on public.client_fund_entries (organization_id, created_at desc);
create index client_fund_entries_requested_by_idx on public.client_fund_entries (requested_by);
create index client_fund_entries_verified_by_idx on public.client_fund_entries (verified_by);
create index client_fund_entries_rejected_by_idx on public.client_fund_entries (rejected_by);
create index client_fund_entries_approved_by_idx on public.client_fund_entries (approved_by);
create index client_fund_entries_declined_by_idx on public.client_fund_entries (declined_by);
create index client_fund_entries_created_by_idx on public.client_fund_entries (created_by);

-- Invoices paid from client funds: the part of paid_cents that came from the client account.
-- paid_cents - client_funds_paid_cents is what was paid by card.
alter table public.invoices add column client_funds_paid_cents bigint not null default 0;
alter table public.invoices add constraint invoices_client_funds_within_paid
  check (client_funds_paid_cents >= 0 and client_funds_paid_cents <= paid_cents);
comment on column public.invoices.client_funds_paid_cents is
  'Paid from the client''s client-account balance by approved earned-fee transfers, minor units. The rest of paid_cents was paid by card.';

-- ---------------------------------------------------------------------------
-- Append-only guard and balance check
-- ---------------------------------------------------------------------------

create function app.guard_client_fund_entry_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'client fund entries are append-only' using errcode = '42501';
  end if;
  if (new.organization_id, new.ledger_id, new.client_account_id, new.matter_id, new.person_id, new.number,
      new.kind, new.direction, new.amount_cents, new.currency, new.method, new.external_reference,
      new.occurred_on, new.evidence_note, new.note, new.invoice_id, new.reverses_entry_id, new.is_sample,
      new.idempotency_key, new.requested_by)
     is distinct from
     (old.organization_id, old.ledger_id, old.client_account_id, old.matter_id, old.person_id, old.number,
      old.kind, old.direction, old.amount_cents, old.currency, old.method, old.external_reference,
      old.occurred_on, old.evidence_note, old.note, old.invoice_id, old.reverses_entry_id, old.is_sample,
      old.idempotency_key, old.requested_by) then
    raise exception 'client fund entries are append-only' using errcode = '42501';
  end if;
  if not (
    (old.status = 'pending_verification' and new.status in ('verified', 'rejected'))
    or (old.status = 'pending_approval' and new.status in ('approved', 'declined'))
  ) then
    raise exception 'client fund entries are append-only' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.guard_client_fund_entry_change() from public;

create function app.reject_client_fund_ledger_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'client fund ledgers are append-only' using errcode = '42501';
end;
$$;
revoke all on function app.reject_client_fund_ledger_delete() from public;

-- Balance and money still waiting on a transfer approval, for one sub-ledger.
create function app.client_fund_ledger_totals(p_ledger_id uuid, out balance bigint, out pending_out bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(sum(case
      when entry.kind = 'deposit' and entry.status = 'verified' then entry.amount_cents
      when entry.kind = 'transfer' and entry.status = 'approved' then -entry.amount_cents
      when entry.kind = 'refund' then -entry.amount_cents
      when entry.kind = 'correction' then case entry.direction when 'in' then entry.amount_cents else -entry.amount_cents end
      else 0
    end), 0)::bigint,
    coalesce(sum(case when entry.kind = 'transfer' and entry.status = 'pending_approval' then entry.amount_cents else 0 end), 0)::bigint
  from public.client_fund_entries entry
  where entry.ledger_id = p_ledger_id;
$$;
revoke all on function app.client_fund_ledger_totals(uuid) from public;

-- Last line of defence, at commit: no sub-ledger ends a transaction below zero.
create function app.check_client_fund_balance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select totals.balance from app.client_fund_ledger_totals(new.ledger_id) totals) < 0 then
    raise exception 'client balance cannot go negative' using errcode = '23514';
  end if;
  return null;
end;
$$;
revoke all on function app.check_client_fund_balance() from public;

create trigger client_accounts_touch before update on public.client_accounts
  for each row execute function app.touch_row();
create trigger client_accounts_stamp before insert on public.client_accounts
  for each row execute function app.stamp_created_by();
create trigger client_accounts_audit after insert or update or delete on public.client_accounts
  for each row execute function app.audit_row_change();
create trigger client_accounts_no_delete before delete on public.client_accounts
  for each row execute function app.reject_governed_delete();

create trigger client_fund_ledgers_touch before update on public.client_fund_ledgers
  for each row execute function app.touch_row();
create trigger client_fund_ledgers_stamp before insert on public.client_fund_ledgers
  for each row execute function app.stamp_created_by();
create trigger client_fund_ledgers_audit after insert or update or delete on public.client_fund_ledgers
  for each row execute function app.audit_row_change();
create trigger client_fund_ledgers_no_delete before delete on public.client_fund_ledgers
  for each row execute function app.reject_client_fund_ledger_delete();

create trigger client_fund_entries_guard before update or delete on public.client_fund_entries
  for each row execute function app.guard_client_fund_entry_change();
create trigger client_fund_entries_touch before update on public.client_fund_entries
  for each row execute function app.touch_row();
create trigger client_fund_entries_stamp before insert on public.client_fund_entries
  for each row execute function app.stamp_created_by();
create trigger client_fund_entries_audit after insert or update or delete on public.client_fund_entries
  for each row execute function app.audit_row_change();
create constraint trigger client_fund_entries_balance after insert or update on public.client_fund_entries
  deferrable initially deferred
  for each row execute function app.check_client_fund_balance();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Client-funds work on a matter: the firm owner or the matter's finance user at aal2, plus a recent
-- step-up when p_step_up (transfers, approvals, refunds, corrections).
create function app.require_client_funds_access(p_matter_id uuid, p_step_up boolean)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'sign in is required' using errcode = '42501';
  end if;
  if app.can_read_matter_billing(p_matter_id) is distinct from true then
    raise exception 'billing access denied' using errcode = '42501';
  end if;
  if p_step_up and app.mfa_step_up_satisfied() is distinct from true then
    raise exception 'step-up is required' using errcode = '42501';
  end if;
end;
$$;
revoke all on function app.require_client_funds_access(uuid, boolean) from public;

-- The firm's date today, in its timezone.
create function app.client_funds_today(p_org uuid)
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
    return (statement_timestamp() at time zone coalesce(nullif(btrim(zone), ''), 'America/Toronto'))::date;
  exception when others then
    return (statement_timestamp() at time zone 'America/Toronto')::date;
  end;
end;
$$;
revoke all on function app.client_funds_today(uuid) from public;

create function app.next_client_fund_number(p_org uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_number integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('casevoya.client_fund_number:' || p_org::text, 0));
  select coalesce(max(substring(entry.number from 4)::integer), 0) + 1 into next_number
  from public.client_fund_entries entry
  where entry.organization_id = p_org;
  return 'CF-' || lpad(next_number::text, 4, '0');
end;
$$;
revoke all on function app.next_client_fund_number(uuid) from public;

create function app.client_fund_key(p_key text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  key text := btrim(coalesce(p_key, ''));
begin
  if length(key) not between 8 and 180 then
    raise exception 'idempotency key is required' using errcode = '22023';
  end if;
  return key;
end;
$$;
revoke all on function app.client_fund_key(text) from public;

-- The person reading is this person (the client's own portal login).
create function app.is_own_person(p_person_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
     and exists (
       select 1 from public.persons person
       where person.id = p_person_id
         and person.user_id = (select auth.uid())
     );
$$;
revoke all on function app.is_own_person(uuid) from public;

-- ---------------------------------------------------------------------------
-- Client accounts (firm owner with a recent step-up)
-- ---------------------------------------------------------------------------

create function app.create_client_account(p_org uuid, p_label text, p_institution text, p_last4 text)
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
    raise exception 'client account label is required' using errcode = '22023';
  end if;
  if length(v_institution) not between 1 and 120 then
    raise exception 'client account institution is required' using errcode = '22023';
  end if;
  if v_last4 !~ '^[0-9]{4}$' then
    raise exception 'client account last four digits are invalid' using errcode = '22023';
  end if;
  select account.id into existing from public.client_accounts account
  where account.organization_id = p_org and account.label = v_label;
  if existing is not null then
    return existing;
  end if;
  insert into public.client_accounts (organization_id, label, institution, account_last4)
  values (p_org, v_label, v_institution, v_last4)
  returning id into rid;
  perform app.record_audit_event(
    p_org, 'client_funds.account_added', 'public.client_accounts', rid, 'success',
    jsonb_build_object('last4', v_last4)
  );
  return rid;
end;
$$;
revoke all on function app.create_client_account(uuid, text, text, text) from public;

-- ---------------------------------------------------------------------------
-- Deposits
-- ---------------------------------------------------------------------------

create function app.record_client_deposit(
  p_client_account_id uuid,
  p_matter_id uuid,
  p_person_id uuid,
  p_amount_cents bigint,
  p_currency text,
  p_method text,
  p_reference text,
  p_received_on date,
  p_evidence text,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  matter public.matters%rowtype;
  account public.client_accounts%rowtype;
  ledger public.client_fund_ledgers%rowtype;
  existing public.client_fund_entries%rowtype;
  key text;
  reference text := nullif(btrim(coalesce(p_reference, '')), '');
  evidence text := nullif(btrim(coalesce(p_evidence, '')), '');
  method public.client_fund_method;
  rid uuid;
begin
  select * into matter from public.matters where id = p_matter_id;
  perform app.require_client_funds_access(matter.id, false);
  key := app.client_fund_key(p_idempotency_key);
  select * into existing from public.client_fund_entries where organization_id = matter.organization_id and idempotency_key = key;
  if existing.id is not null then
    if existing.kind <> 'deposit' or existing.matter_id <> matter.id then
      raise exception 'idempotency key was used for another entry' using errcode = '23505';
    end if;
    return existing.id;
  end if;
  if app.sample_mode_blocks_real(matter.organization_id, matter.is_sample) then
    raise exception 'this firm is in sample mode; only sample matters take client funds' using errcode = '42501';
  end if;
  select * into account from public.client_accounts
  where id = p_client_account_id and organization_id = matter.organization_id and is_active;
  if account.id is null then
    raise exception 'choose the firm''s client account' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.matter_participants party
    where party.matter_id = matter.id
      and party.organization_id = matter.organization_id
      and party.person_id = p_person_id
  ) then
    raise exception 'the client must be a party on the matter' using errcode = '22023';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 or p_amount_cents > 99999999999 then
    raise exception 'amount must be positive' using errcode = '22023';
  end if;
  if upper(btrim(coalesce(p_currency, ''))) <> account.currency then
    raise exception 'only CAD client funds are supported' using errcode = '22023';
  end if;
  begin
    method := btrim(coalesce(p_method, ''))::public.client_fund_method;
  exception when others then
    raise exception 'payment method is invalid' using errcode = '22023';
  end;
  if reference is not null and length(reference) > 80 then
    raise exception 'reference is too long' using errcode = '22023';
  end if;
  if evidence is not null and length(evidence) > 500 then
    raise exception 'evidence note is too long' using errcode = '22023';
  end if;
  if p_received_on is null or p_received_on > app.client_funds_today(matter.organization_id) then
    raise exception 'received date can''t be in the future' using errcode = '22023';
  end if;

  insert into public.client_fund_ledgers (organization_id, client_account_id, matter_id, person_id, is_sample)
  values (matter.organization_id, account.id, matter.id, p_person_id, matter.is_sample)
  on conflict (client_account_id, matter_id, person_id) do nothing;
  select * into ledger from public.client_fund_ledgers
  where client_account_id = account.id and matter_id = matter.id and person_id = p_person_id
  for update;

  insert into public.client_fund_entries (
    organization_id, ledger_id, client_account_id, matter_id, person_id, number, kind, status, direction,
    amount_cents, currency, method, external_reference, occurred_on, evidence_note, is_sample,
    idempotency_key, requested_by
  ) values (
    matter.organization_id, ledger.id, account.id, matter.id, p_person_id, app.next_client_fund_number(matter.organization_id),
    'deposit', 'pending_verification', 'in', p_amount_cents, account.currency, method, reference, p_received_on, evidence,
    ledger.is_sample, key, (select auth.uid())
  )
  returning id into rid;
  perform app.record_audit_event(
    matter.organization_id, 'client_funds.deposit_recorded', 'public.client_fund_entries', rid, 'success',
    jsonb_build_object('matter_id', matter.id, 'amount_cents', p_amount_cents, 'currency', account.currency, 'method', method)
  );
  return rid;
end;
$$;
revoke all on function app.record_client_deposit(uuid, uuid, uuid, bigint, text, text, text, date, text, text) from public;

-- Matched to the bank statement: the money now counts in the client's balance.
create function app.verify_client_deposit(p_entry_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  entry public.client_fund_entries%rowtype;
begin
  select * into entry from public.client_fund_entries where id = p_entry_id;
  perform app.require_client_funds_access(entry.matter_id, false);
  perform 1 from public.client_fund_ledgers where id = entry.ledger_id for update;
  select * into entry from public.client_fund_entries where id = p_entry_id for update;
  if entry.kind <> 'deposit' or entry.status <> 'pending_verification' then
    raise exception 'only a deposit pending verification can be verified' using errcode = '22023';
  end if;
  update public.client_fund_entries
  set status = 'verified', verified_by = (select auth.uid()), verified_at = clock_timestamp()
  where id = entry.id;
  perform app.record_audit_event(
    entry.organization_id, 'client_funds.deposit_verified', 'public.client_fund_entries', entry.id, 'success',
    jsonb_build_object('amount_cents', entry.amount_cents, 'recorded_by', entry.requested_by)
  );
  return entry.id;
end;
$$;
revoke all on function app.verify_client_deposit(uuid) from public;

-- Not found on the bank statement: the deposit never counts.
create function app.reject_client_deposit(p_entry_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  entry public.client_fund_entries%rowtype;
  reason text := btrim(coalesce(p_reason, ''));
begin
  select * into entry from public.client_fund_entries where id = p_entry_id;
  perform app.require_client_funds_access(entry.matter_id, false);
  select * into entry from public.client_fund_entries where id = p_entry_id for update;
  if entry.kind <> 'deposit' or entry.status <> 'pending_verification' then
    raise exception 'only a deposit pending verification can be rejected' using errcode = '22023';
  end if;
  if length(reason) not between 3 and 500 then
    raise exception 'a reason is required' using errcode = '22023';
  end if;
  update public.client_fund_entries
  set status = 'rejected', rejected_by = (select auth.uid()), rejected_at = clock_timestamp(), rejection_reason = reason
  where id = entry.id;
  perform app.record_audit_event(
    entry.organization_id, 'client_funds.deposit_rejected', 'public.client_fund_entries', entry.id, 'success',
    jsonb_build_object('amount_cents', entry.amount_cents)
  );
  return entry.id;
end;
$$;
revoke all on function app.reject_client_deposit(uuid, text) from public;

-- ---------------------------------------------------------------------------
-- Earned-fee transfers (maker-checker)
-- ---------------------------------------------------------------------------

-- Checks a transfer of p_amount from the sub-ledger to the invoice. Locks are taken by the caller.
-- p_exclude is the transfer being approved (its own pending amount is not "other").
create function app.check_client_transfer(
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
  if p_amount > p_invoice.amount_cents - p_invoice.paid_cents - invoice_pending then
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
revoke all on function app.check_client_transfer(public.client_fund_ledgers, public.invoices, bigint, uuid) from public;

create function app.request_client_transfer(
  p_ledger_id uuid,
  p_invoice_id uuid,
  p_amount_cents bigint,
  p_note text,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  ledger public.client_fund_ledgers%rowtype;
  invoice public.invoices%rowtype;
  existing public.client_fund_entries%rowtype;
  key text;
  note text := nullif(btrim(coalesce(p_note, '')), '');
  rid uuid;
begin
  select * into ledger from public.client_fund_ledgers where id = p_ledger_id;
  perform app.require_client_funds_access(ledger.matter_id, true);
  key := app.client_fund_key(p_idempotency_key);
  select * into existing from public.client_fund_entries where organization_id = ledger.organization_id and idempotency_key = key;
  if existing.id is not null then
    if existing.kind <> 'transfer' or existing.ledger_id <> ledger.id then
      raise exception 'idempotency key was used for another entry' using errcode = '23505';
    end if;
    return existing.id;
  end if;
  if app.sample_mode_blocks_real(ledger.organization_id, ledger.is_sample) then
    raise exception 'this firm is in sample mode; only sample matters take client funds' using errcode = '42501';
  end if;
  if note is not null and length(note) > 500 then
    raise exception 'note is too long' using errcode = '22023';
  end if;
  -- Lock order everywhere: sub-ledger, then invoice.
  select * into ledger from public.client_fund_ledgers where id = ledger.id for update;
  select * into invoice from public.invoices where id = p_invoice_id for update;
  perform app.check_client_transfer(ledger, invoice, p_amount_cents, null);

  insert into public.client_fund_entries (
    organization_id, ledger_id, client_account_id, matter_id, person_id, number, kind, status, direction,
    amount_cents, currency, occurred_on, note, invoice_id, is_sample, idempotency_key, requested_by
  ) values (
    ledger.organization_id, ledger.id, ledger.client_account_id, ledger.matter_id, ledger.person_id,
    app.next_client_fund_number(ledger.organization_id), 'transfer', 'pending_approval', 'out',
    p_amount_cents, invoice.currency, app.client_funds_today(ledger.organization_id), note, invoice.id,
    ledger.is_sample, key, (select auth.uid())
  )
  returning id into rid;
  perform app.record_audit_event(
    ledger.organization_id, 'client_funds.transfer_requested', 'public.client_fund_entries', rid, 'success',
    jsonb_build_object('invoice_id', invoice.id, 'amount_cents', p_amount_cents)
  );
  return rid;
end;
$$;
revoke all on function app.request_client_transfer(uuid, uuid, bigint, text, text) from public;

-- Approves a pending transfer and applies it to the invoice. The approver must be someone other
-- than the requester, except the firm owner, who may approve their own request with a step-up
-- taken after the request was made (recorded as owner_self_approved).
create function app.approve_client_transfer(p_entry_id uuid)
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
      status = case when paid_cents + entry.amount_cents >= amount_cents then 'paid'::public.invoice_status else 'partially_paid'::public.invoice_status end
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
revoke all on function app.approve_client_transfer(uuid) from public;

-- Declines (or, by its requester, withdraws) a pending transfer. The money stays in the client account.
create function app.decline_client_transfer(p_entry_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  entry public.client_fund_entries%rowtype;
  reason text := btrim(coalesce(p_reason, ''));
begin
  select * into entry from public.client_fund_entries where id = p_entry_id;
  perform app.require_client_funds_access(entry.matter_id, false);
  select * into entry from public.client_fund_entries where id = p_entry_id for update;
  if entry.kind <> 'transfer' or entry.status <> 'pending_approval' then
    raise exception 'only a transfer waiting for approval can be declined' using errcode = '22023';
  end if;
  if length(reason) not between 3 and 500 then
    raise exception 'a reason is required' using errcode = '22023';
  end if;
  update public.client_fund_entries
  set status = 'declined', declined_by = (select auth.uid()), declined_at = clock_timestamp(), decline_reason = reason
  where id = entry.id;
  perform app.record_audit_event(
    entry.organization_id, 'client_funds.transfer_declined', 'public.client_fund_entries', entry.id, 'success',
    jsonb_build_object('amount_cents', entry.amount_cents)
  );
  return entry.id;
end;
$$;
revoke all on function app.decline_client_transfer(uuid, text) from public;

-- ---------------------------------------------------------------------------
-- Refunds to the client and corrections
-- ---------------------------------------------------------------------------

create function app.record_client_refund(
  p_ledger_id uuid,
  p_amount_cents bigint,
  p_method text,
  p_reference text,
  p_paid_on date,
  p_reason text,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  ledger public.client_fund_ledgers%rowtype;
  existing public.client_fund_entries%rowtype;
  totals record;
  key text;
  reference text := nullif(btrim(coalesce(p_reference, '')), '');
  reason text := btrim(coalesce(p_reason, ''));
  method public.client_fund_method;
  rid uuid;
begin
  select * into ledger from public.client_fund_ledgers where id = p_ledger_id;
  perform app.require_client_funds_access(ledger.matter_id, true);
  key := app.client_fund_key(p_idempotency_key);
  select * into existing from public.client_fund_entries where organization_id = ledger.organization_id and idempotency_key = key;
  if existing.id is not null then
    if existing.kind <> 'refund' or existing.ledger_id <> ledger.id then
      raise exception 'idempotency key was used for another entry' using errcode = '23505';
    end if;
    return existing.id;
  end if;
  if app.sample_mode_blocks_real(ledger.organization_id, ledger.is_sample) then
    raise exception 'this firm is in sample mode; only sample matters take client funds' using errcode = '42501';
  end if;
  begin
    method := btrim(coalesce(p_method, ''))::public.client_fund_method;
  exception when others then
    raise exception 'payment method is invalid' using errcode = '22023';
  end;
  if reference is not null and length(reference) > 80 then
    raise exception 'reference is too long' using errcode = '22023';
  end if;
  if length(reason) not between 3 and 500 then
    raise exception 'a reason is required' using errcode = '22023';
  end if;
  if p_paid_on is null or p_paid_on > app.client_funds_today(ledger.organization_id) then
    raise exception 'refund date can''t be in the future' using errcode = '22023';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'amount must be positive' using errcode = '22023';
  end if;
  select * into ledger from public.client_fund_ledgers where id = ledger.id for update;
  select * into totals from app.client_fund_ledger_totals(ledger.id);
  if p_amount_cents > totals.balance - totals.pending_out then
    raise exception 'refund exceeds the client''s available balance' using errcode = '22023';
  end if;
  insert into public.client_fund_entries (
    organization_id, ledger_id, client_account_id, matter_id, person_id, number, kind, status, direction,
    amount_cents, currency, method, external_reference, occurred_on, note, is_sample, idempotency_key, requested_by
  ) values (
    ledger.organization_id, ledger.id, ledger.client_account_id, ledger.matter_id, ledger.person_id,
    app.next_client_fund_number(ledger.organization_id), 'refund', 'recorded', 'out',
    p_amount_cents, 'CAD', method, reference, p_paid_on, reason, ledger.is_sample, key, (select auth.uid())
  )
  returning id into rid;
  perform app.record_audit_event(
    ledger.organization_id, 'client_funds.refund_recorded', 'public.client_fund_entries', rid, 'success',
    jsonb_build_object('amount_cents', p_amount_cents, 'method', method)
  );
  return rid;
end;
$$;
revoke all on function app.record_client_refund(uuid, bigint, text, text, date, text, text) from public;

-- A reversing entry for a verified deposit or a refund recorded by mistake. Each entry can be
-- reversed once. Approved transfers are not reversed here (that would reopen an invoice).
create function app.record_client_fund_correction(p_entry_id uuid, p_reason text, p_idempotency_key text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.client_fund_entries%rowtype;
  existing public.client_fund_entries%rowtype;
  totals record;
  key text;
  reason text := btrim(coalesce(p_reason, ''));
  next_direction text;
  rid uuid;
begin
  select * into target from public.client_fund_entries where id = p_entry_id;
  perform app.require_client_funds_access(target.matter_id, true);
  key := app.client_fund_key(p_idempotency_key);
  select * into existing from public.client_fund_entries where organization_id = target.organization_id and idempotency_key = key;
  if existing.id is not null then
    if existing.kind <> 'correction' or existing.reverses_entry_id <> target.id then
      raise exception 'idempotency key was used for another entry' using errcode = '23505';
    end if;
    return existing.id;
  end if;
  if app.sample_mode_blocks_real(target.organization_id, target.is_sample) then
    raise exception 'this firm is in sample mode; only sample matters take client funds' using errcode = '42501';
  end if;
  if length(reason) not between 3 and 500 then
    raise exception 'a reason is required' using errcode = '22023';
  end if;
  perform 1 from public.client_fund_ledgers where id = target.ledger_id for update;
  select * into target from public.client_fund_entries where id = p_entry_id for update;
  if not ((target.kind = 'deposit' and target.status = 'verified') or target.kind = 'refund') then
    raise exception 'only a verified deposit or a refund can be corrected' using errcode = '22023';
  end if;
  if exists (select 1 from public.client_fund_entries entry where entry.reverses_entry_id = target.id) then
    raise exception 'this entry was already corrected' using errcode = '22023';
  end if;
  next_direction := case target.direction when 'in' then 'out' else 'in' end;
  if next_direction = 'out' then
    select * into totals from app.client_fund_ledger_totals(target.ledger_id);
    if target.amount_cents > totals.balance - totals.pending_out then
      raise exception 'correction would make the client balance negative' using errcode = '22023';
    end if;
  end if;
  insert into public.client_fund_entries (
    organization_id, ledger_id, client_account_id, matter_id, person_id, number, kind, status, direction,
    amount_cents, currency, occurred_on, note, reverses_entry_id, is_sample, idempotency_key, requested_by
  ) values (
    target.organization_id, target.ledger_id, target.client_account_id, target.matter_id, target.person_id,
    app.next_client_fund_number(target.organization_id), 'correction', 'recorded', next_direction,
    target.amount_cents, target.currency, app.client_funds_today(target.organization_id), reason, target.id,
    target.is_sample, key, (select auth.uid())
  )
  returning id into rid;
  perform app.record_audit_event(
    target.organization_id, 'client_funds.correction_recorded', 'public.client_fund_entries', rid, 'success',
    jsonb_build_object('reverses', target.id, 'amount_cents', target.amount_cents, 'direction', next_direction)
  );
  return rid;
end;
$$;
revoke all on function app.record_client_fund_correction(uuid, text, text) from public;

-- ---------------------------------------------------------------------------
-- Read projections for billing staff
-- ---------------------------------------------------------------------------

-- The people on matters the caller bills, for choosing whose money a deposit is. Display names
-- only (the billing projection; finance users do not read person rows).
create function public.list_client_fund_parties()
returns table (matter_id uuid, organization_id uuid, person_id uuid, display_name text, role text, is_sample boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select party.matter_id, party.organization_id, person.id, person.display_name, party.role::text, matter.is_sample
  from public.matter_participants party
  join public.matters matter on matter.id = party.matter_id and matter.organization_id = party.organization_id
  join public.persons person on person.id = party.person_id and person.organization_id = party.organization_id
  where party.person_id is not null
    and matter.stage <> 'closed'
    and app.can_read_matter_billing(matter.id);
$$;
comment on function public.list_client_fund_parties() is
  'Billing projection for client funds: matter, person id, display name and party role. No person row.';

-- Names of the firm's staff, to say who recorded, verified or approved an entry.
create function public.client_fund_staff_names(p_org uuid)
returns table (user_id uuid, display_name text)
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
    select mem.user_id, coalesce(nullif(btrim(coalesce(prof.display_name, '')), ''), 'Staff member')
    from public.memberships mem
    left join public.profiles prof on prof.id = mem.user_id
    where mem.organization_id = p_org
      and mem.role = any (app.staff_roles());
end;
$$;

-- ---------------------------------------------------------------------------
-- Public wrappers. The database checks the caller; these stay security invoker.
-- ---------------------------------------------------------------------------

create function public.create_client_account(p_org uuid, p_label text, p_institution text, p_last4 text)
returns uuid language sql security invoker set search_path = ''
as $$ select app.create_client_account(p_org, p_label, p_institution, p_last4); $$;

create function public.record_client_deposit(
  p_client_account_id uuid, p_matter_id uuid, p_person_id uuid, p_amount_cents bigint, p_currency text,
  p_method text, p_reference text, p_received_on date, p_evidence text, p_idempotency_key text
) returns uuid language sql security invoker set search_path = ''
as $$
  select app.record_client_deposit(
    p_client_account_id, p_matter_id, p_person_id, p_amount_cents, p_currency,
    p_method, p_reference, p_received_on, p_evidence, p_idempotency_key
  );
$$;

create function public.verify_client_deposit(p_entry_id uuid)
returns uuid language sql security invoker set search_path = ''
as $$ select app.verify_client_deposit(p_entry_id); $$;

create function public.reject_client_deposit(p_entry_id uuid, p_reason text)
returns uuid language sql security invoker set search_path = ''
as $$ select app.reject_client_deposit(p_entry_id, p_reason); $$;

create function public.request_client_transfer(p_ledger_id uuid, p_invoice_id uuid, p_amount_cents bigint, p_note text, p_idempotency_key text)
returns uuid language sql security invoker set search_path = ''
as $$ select app.request_client_transfer(p_ledger_id, p_invoice_id, p_amount_cents, p_note, p_idempotency_key); $$;

create function public.approve_client_transfer(p_entry_id uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select app.approve_client_transfer(p_entry_id); $$;

create function public.decline_client_transfer(p_entry_id uuid, p_reason text)
returns uuid language sql security invoker set search_path = ''
as $$ select app.decline_client_transfer(p_entry_id, p_reason); $$;

create function public.record_client_refund(
  p_ledger_id uuid, p_amount_cents bigint, p_method text, p_reference text, p_paid_on date, p_reason text, p_idempotency_key text
) returns uuid language sql security invoker set search_path = ''
as $$ select app.record_client_refund(p_ledger_id, p_amount_cents, p_method, p_reference, p_paid_on, p_reason, p_idempotency_key); $$;

create function public.record_client_fund_correction(p_entry_id uuid, p_reason text, p_idempotency_key text)
returns uuid language sql security invoker set search_path = ''
as $$ select app.record_client_fund_correction(p_entry_id, p_reason, p_idempotency_key); $$;

revoke all on function public.create_client_account(uuid, text, text, text) from public, anon;
revoke all on function public.record_client_deposit(uuid, uuid, uuid, bigint, text, text, text, date, text, text) from public, anon;
revoke all on function public.verify_client_deposit(uuid) from public, anon;
revoke all on function public.reject_client_deposit(uuid, text) from public, anon;
revoke all on function public.request_client_transfer(uuid, uuid, bigint, text, text) from public, anon;
revoke all on function public.approve_client_transfer(uuid) from public, anon;
revoke all on function public.decline_client_transfer(uuid, text) from public, anon;
revoke all on function public.record_client_refund(uuid, bigint, text, text, date, text, text) from public, anon;
revoke all on function public.record_client_fund_correction(uuid, text, text) from public, anon;
revoke all on function public.list_client_fund_parties() from public, anon;
revoke all on function public.client_fund_staff_names(uuid) from public, anon;

grant execute on function public.create_client_account(uuid, text, text, text) to authenticated;
grant execute on function public.record_client_deposit(uuid, uuid, uuid, bigint, text, text, text, date, text, text) to authenticated;
grant execute on function public.verify_client_deposit(uuid) to authenticated;
grant execute on function public.reject_client_deposit(uuid, text) to authenticated;
grant execute on function public.request_client_transfer(uuid, uuid, bigint, text, text) to authenticated;
grant execute on function public.approve_client_transfer(uuid) to authenticated;
grant execute on function public.decline_client_transfer(uuid, text) to authenticated;
grant execute on function public.record_client_refund(uuid, bigint, text, text, date, text, text) to authenticated;
grant execute on function public.record_client_fund_correction(uuid, text, text) to authenticated;
grant execute on function public.list_client_fund_parties() to authenticated, service_role;
grant execute on function public.client_fund_staff_names(uuid) to authenticated, service_role;

grant execute on function app.client_fund_ledger_totals(uuid) to authenticated, service_role;
grant execute on function app.require_client_funds_access(uuid, boolean) to authenticated;
grant execute on function app.client_funds_today(uuid) to authenticated, service_role;
grant execute on function app.next_client_fund_number(uuid) to authenticated;
grant execute on function app.client_fund_key(text) to authenticated;
grant execute on function app.is_own_person(uuid) to authenticated, service_role;
grant execute on function app.check_client_transfer(public.client_fund_ledgers, public.invoices, bigint, uuid) to authenticated;
grant execute on function app.create_client_account(uuid, text, text, text) to authenticated;
grant execute on function app.record_client_deposit(uuid, uuid, uuid, bigint, text, text, text, date, text, text) to authenticated;
grant execute on function app.verify_client_deposit(uuid) to authenticated;
grant execute on function app.reject_client_deposit(uuid, text) to authenticated;
grant execute on function app.request_client_transfer(uuid, uuid, bigint, text, text) to authenticated;
grant execute on function app.approve_client_transfer(uuid) to authenticated;
grant execute on function app.decline_client_transfer(uuid, text) to authenticated;
grant execute on function app.record_client_refund(uuid, bigint, text, text, date, text, text) to authenticated;
grant execute on function app.record_client_fund_correction(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Table privileges and row-level security
-- ---------------------------------------------------------------------------

revoke all on table public.client_accounts from anon, authenticated, service_role;
revoke all on table public.client_fund_ledgers from anon, authenticated, service_role;
revoke all on table public.client_fund_entries from anon, authenticated, service_role;
grant select on table public.client_accounts to authenticated, service_role;
grant select on table public.client_fund_ledgers to authenticated, service_role;
grant select on table public.client_fund_entries to authenticated, service_role;

alter table public.client_accounts enable row level security;
alter table public.client_accounts force row level security;
alter table public.client_fund_ledgers enable row level security;
alter table public.client_fund_ledgers force row level security;
alter table public.client_fund_entries enable row level security;
alter table public.client_fund_entries force row level security;

-- The firm's billing staff (owner, any finance user) see the firm's client accounts.
create policy client_accounts_select on public.client_accounts
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.can_read_firm_payment_account(organization_id))
  );

-- Billing staff of the matter, or the client whose sub-ledger it is.
create policy client_fund_ledgers_select on public.client_fund_ledgers
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (
      (select app.can_read_matter_billing(matter_id))
      or (select app.is_own_person(person_id))
    )
  );

-- Billing staff of the matter see every entry. The client sees their own sub-ledger's entries
-- that count: verified deposits, approved transfers, refunds and corrections.
create policy client_fund_entries_select on public.client_fund_entries
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (
      (select app.can_read_matter_billing(matter_id))
      or (
        status in ('verified', 'approved', 'recorded')
        and (select app.is_own_person(person_id))
      )
    )
  );
