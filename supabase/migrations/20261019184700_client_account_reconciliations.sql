-- Client-account reconciliation (FIN-12): manual matching of the firm's client (trust) account bank
-- statement against Casevoya's client-funds ledger, with a signed review. Casevoya holds no money and
-- reads no bank feed: the statement balance is typed in from the firm's own statement.
--
-- What the CICC Code says (SOR/2022-128, quoted in docs/legal/client-account-sources.md): s. 32(a)
-- the funds are held in trust in a client account; s. 32(d) "maintain separate records of deposits and
-- withdrawals for each client". The Code text quoted there sets no reconciliation frequency, form or
-- sign-off; none is encoded. Monthly three-way reconciliation with a signed review is the PRD's product
-- requirement (FIN-12), and the second-person sign-off is a product control using the rule Francis
-- decided for client-fund transfers (docs/DECISIONS.md, 2026-10-18).
--
-- A reconciliation, per client account, as of the statement date:
--   statement_balance_cents     typed from the bank statement (closing balance on statement_date)
--   ledger_balance_cents        the control ledger: money Casevoya's records say is in the account on
--                               that date = verified deposits received on or before it - approved
--                               transfers whose bank transfer was recorded on or before it - refunds
--                               to clients +/- corrections (by entry date)
--   client_ledgers_total_cents  the total of the per-client sub-ledgers on that date (what is owed to
--                               clients): verified deposits - approved transfers (approved on or before
--                               it) - refunds +/- corrections, summed over each client's sub-ledger
--   difference_cents            statement - control ledger
--   items                       outstanding items, copied when prepared: deposits still pending
--                               verification (the bank may show them, the ledger doesn't count them
--                               yet) and approved transfers whose bank transfer isn't recorded (earned,
--                               still in the account). Card advances are not a concept here (advances are
--                               never taken by card, FIN-03), so there is no such item.
-- Prepared by the firm owner or any finance user (the client account is firm-wide). Signed by a
-- different person as 'reconciled' (only when the difference is zero) or 'exceptions' (notes required);
-- the firm owner may sign their own preparation after a step-up taken after it was prepared
-- (owner_self_signed, audited as client_funds.reconciliation_signed_owner_self). Signing always needs
-- a recent step-up, and the figures are recomputed: if the ledger changed since preparation the
-- signature is refused and the reconciliation must be prepared again (discard, then prepare). Signed
-- and discarded reconciliations are final (append-only). One reconciliation waiting for review per
-- client account; a new one must be dated after the last signed one.
--
-- Reading: the firm owner and finance users (the same people who see the client accounts). Items carry
-- entry ids, numbers, amounts and dates only, no client names. Nothing here changes a matter's stage
-- or a government status. Additive only.

create table public.client_account_reconciliations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  client_account_id uuid not null,
  period_start date not null,
  statement_date date not null,
  statement_balance_cents bigint not null check (statement_balance_cents between -99999999999 and 99999999999),
  currency text not null default 'CAD' check (currency = 'CAD'),
  ledger_balance_cents bigint not null,
  client_ledgers_total_cents bigint not null,
  difference_cents bigint not null,
  client_count integer not null check (client_count >= 0),
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  item_count integer not null check (item_count >= 0),
  preparer_note text check (preparer_note is null or length(btrim(preparer_note)) between 1 and 2000),
  status public.client_reconciliation_status not null default 'pending_review',
  is_sample boolean not null default false,
  idempotency_key text not null check (length(idempotency_key) between 8 and 180),
  prepared_by uuid not null references auth.users (id),
  prepared_at timestamptz not null default now(),
  signed_by uuid references auth.users (id),
  signed_at timestamptz,
  owner_self_signed boolean not null default false,
  review_notes text check (review_notes is null or length(btrim(review_notes)) between 3 and 2000),
  discarded_by uuid references auth.users (id),
  discarded_at timestamptz,
  discard_reason text check (discard_reason is null or length(btrim(discard_reason)) between 3 and 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id),
  unique (organization_id, idempotency_key),
  check (difference_cents = statement_balance_cents - ledger_balance_cents),
  check (period_start <= statement_date),
  check (item_count = jsonb_array_length(items)),
  check (status not in ('reconciled', 'exceptions') or (signed_by is not null and signed_at is not null)),
  check (status in ('reconciled', 'exceptions') or (signed_by is null and signed_at is null and not owner_self_signed)),
  check (status <> 'reconciled' or difference_cents = 0),
  check (status <> 'exceptions' or review_notes is not null),
  check (status <> 'discarded' or (discarded_by is not null and discarded_at is not null and discard_reason is not null)),
  -- Maker-checker: only the firm owner signing their own preparation may name the preparer.
  check (signed_by is null or signed_by <> prepared_by or owner_self_signed),
  check (not owner_self_signed or signed_by = prepared_by),
  foreign key (client_account_id, organization_id) references public.client_accounts (id, organization_id)
);
comment on table public.client_account_reconciliations is
  'Client-account bank reconciliations (FIN-12): statement balance vs control ledger vs client sub-ledgers as of a date, outstanding items, second-person sign-off. Append-only once signed or discarded.';

create index client_account_reconciliations_account_org_fk_idx on public.client_account_reconciliations (client_account_id, organization_id);
create index client_account_reconciliations_org_date_idx on public.client_account_reconciliations (organization_id, statement_date desc);
create index client_account_reconciliations_prepared_by_idx on public.client_account_reconciliations (prepared_by);
create index client_account_reconciliations_signed_by_idx on public.client_account_reconciliations (signed_by);
create index client_account_reconciliations_discarded_by_idx on public.client_account_reconciliations (discarded_by);
create index client_account_reconciliations_created_by_idx on public.client_account_reconciliations (created_by);
create unique index client_account_reconciliations_one_open_idx
  on public.client_account_reconciliations (client_account_id)
  where status = 'pending_review';

create function app.guard_client_reconciliation_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'reconciliations are append-only' using errcode = '42501';
  end if;
  if (new.organization_id, new.client_account_id, new.period_start, new.statement_date, new.statement_balance_cents,
      new.currency, new.ledger_balance_cents, new.client_ledgers_total_cents, new.difference_cents, new.client_count,
      new.items, new.item_count, new.preparer_note, new.is_sample, new.idempotency_key, new.prepared_by, new.prepared_at)
     is distinct from
     (old.organization_id, old.client_account_id, old.period_start, old.statement_date, old.statement_balance_cents,
      old.currency, old.ledger_balance_cents, old.client_ledgers_total_cents, old.difference_cents, old.client_count,
      old.items, old.item_count, old.preparer_note, old.is_sample, old.idempotency_key, old.prepared_by, old.prepared_at) then
    raise exception 'reconciliations are append-only' using errcode = '42501';
  end if;
  if not (old.status = 'pending_review' and new.status in ('reconciled', 'exceptions', 'discarded')) then
    raise exception 'reconciliations are append-only' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.guard_client_reconciliation_change() from public, anon, authenticated;

create trigger client_account_reconciliations_guard before update or delete on public.client_account_reconciliations
  for each row execute function app.guard_client_reconciliation_change();
create trigger client_account_reconciliations_touch before update on public.client_account_reconciliations
  for each row execute function app.touch_row();
create trigger client_account_reconciliations_stamp before insert on public.client_account_reconciliations
  for each row execute function app.stamp_created_by();
create trigger client_account_reconciliations_audit after insert or update or delete on public.client_account_reconciliations
  for each row execute function app.audit_row_change();

-- ---------------------------------------------------------------------------
-- The ledger's position on a date
-- ---------------------------------------------------------------------------

-- The control ledger, the client sub-ledgers' total and the outstanding items for one client account
-- as of p_as_of (see the header). Read-only; callers check access.
create function app.client_account_position(p_account_id uuid, p_as_of date)
returns table (ledger_balance bigint, client_total bigint, client_count integer, items jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  with entries as (
    select entry.*,
           case when entry.kind = 'transfer' and entry.approved_at is not null
             then app.firm_local_date(entry.organization_id, entry.approved_at) end as approved_on,
           bank.transferred_on
    from public.client_fund_entries entry
    left join public.client_fund_bank_transfers bank on bank.entry_id = entry.id
    where entry.client_account_id = p_account_id
  ),
  per_ledger as (
    select entry.ledger_id,
      coalesce(sum(case
        when entry.kind = 'deposit' and entry.status = 'verified' and entry.occurred_on <= p_as_of then entry.amount_cents
        when entry.kind = 'transfer' and entry.status = 'approved' and entry.approved_on <= p_as_of then -entry.amount_cents
        when entry.kind = 'refund' and entry.occurred_on <= p_as_of then -entry.amount_cents
        when entry.kind = 'correction' and entry.occurred_on <= p_as_of then
          case entry.direction when 'in' then entry.amount_cents else -entry.amount_cents end
        else 0
      end), 0)::bigint as owed,
      coalesce(sum(case
        when entry.kind = 'deposit' and entry.status = 'verified' and entry.occurred_on <= p_as_of then entry.amount_cents
        when entry.kind = 'transfer' and entry.status = 'approved' and entry.transferred_on <= p_as_of then -entry.amount_cents
        when entry.kind = 'refund' and entry.occurred_on <= p_as_of then -entry.amount_cents
        when entry.kind = 'correction' and entry.occurred_on <= p_as_of then
          case entry.direction when 'in' then entry.amount_cents else -entry.amount_cents end
        else 0
      end), 0)::bigint as cash
    from entries entry
    group by entry.ledger_id
  ),
  outstanding as (
    select jsonb_build_object(
             'kind', 'deposit_pending_verification',
             'entry_id', entry.id, 'number', entry.number, 'ledger_id', entry.ledger_id,
             'matter_id', entry.matter_id, 'amount_cents', entry.amount_cents, 'date', entry.occurred_on
           ) as item, entry.occurred_on as on_date, entry.number
    from entries entry
    where entry.kind = 'deposit' and entry.status = 'pending_verification' and entry.occurred_on <= p_as_of
    union all
    select jsonb_build_object(
             'kind', 'transfer_not_sent',
             'entry_id', entry.id, 'number', entry.number, 'ledger_id', entry.ledger_id,
             'matter_id', entry.matter_id, 'amount_cents', entry.amount_cents, 'date', entry.approved_on
           ), entry.approved_on, entry.number
    from entries entry
    where entry.kind = 'transfer' and entry.status = 'approved' and entry.approved_on <= p_as_of
      and (entry.transferred_on is null or entry.transferred_on > p_as_of)
  )
  select
    coalesce((select sum(per_ledger.cash) from per_ledger), 0)::bigint,
    coalesce((select sum(per_ledger.owed) from per_ledger), 0)::bigint,
    (select count(*) from per_ledger where per_ledger.owed > 0)::integer,
    coalesce((select jsonb_agg(outstanding.item order by outstanding.on_date, outstanding.number) from outstanding), '[]'::jsonb);
$$;
revoke all on function app.client_account_position(uuid, date) from public, anon, authenticated;
grant execute on function app.client_account_position(uuid, date) to service_role;

-- Reconciliation work: the firm owner or a finance user of the firm at aal2 (the client account is
-- firm-wide), plus a recent step-up when p_step_up (signing).
create function app.require_reconciliation_access(p_org uuid, p_step_up boolean)
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
  if p_org is null or app.can_read_firm_payment_account(p_org) is distinct from true then
    raise exception 'reconciliation access denied' using errcode = '42501';
  end if;
  if p_step_up and app.mfa_step_up_satisfied() is distinct from true then
    raise exception 'step-up is required' using errcode = '42501';
  end if;
end;
$$;
revoke all on function app.require_reconciliation_access(uuid, boolean) from public, anon;

-- ---------------------------------------------------------------------------
-- Prepare, sign, discard
-- ---------------------------------------------------------------------------

create function app.prepare_client_reconciliation(
  p_client_account_id uuid,
  p_statement_date date,
  p_statement_balance_cents bigint,
  p_note text,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  account public.client_accounts%rowtype;
  existing public.client_account_reconciliations%rowtype;
  key text := btrim(coalesce(p_idempotency_key, ''));
  note text := nullif(btrim(coalesce(p_note, '')), '');
  last_signed date;
  pos record;
  sample boolean;
  rid uuid;
begin
  select * into account from public.client_accounts where id = p_client_account_id;
  perform app.require_reconciliation_access(account.organization_id, false);
  if account.organization_id is distinct from (select app.current_organization_id()) then
    raise exception 'reconciliation access denied' using errcode = '42501';
  end if;
  if length(key) not between 8 and 180 then
    raise exception 'idempotency key is required' using errcode = '22023';
  end if;
  select * into existing from public.client_account_reconciliations
  where organization_id = account.organization_id and idempotency_key = key;
  if existing.id is not null then
    if existing.client_account_id <> account.id then
      raise exception 'idempotency key was used for another reconciliation' using errcode = '23505';
    end if;
    return existing.id;
  end if;
  if p_statement_date is null or p_statement_date > app.client_funds_today(account.organization_id) then
    raise exception 'statement date can''t be in the future' using errcode = '22023';
  end if;
  if p_statement_balance_cents is null or p_statement_balance_cents not between -99999999999 and 99999999999 then
    raise exception 'statement balance is required' using errcode = '22023';
  end if;
  if note is not null and length(note) > 2000 then
    raise exception 'note is too long' using errcode = '22023';
  end if;
  -- One preparation at a time per account.
  perform 1 from public.client_accounts where id = account.id for update;
  if exists (
    select 1 from public.client_account_reconciliations rec
    where rec.client_account_id = account.id and rec.status = 'pending_review'
  ) then
    raise exception 'a reconciliation for this account is waiting for review' using errcode = '22023';
  end if;
  select max(rec.statement_date) into last_signed
  from public.client_account_reconciliations rec
  where rec.client_account_id = account.id and rec.status in ('reconciled', 'exceptions');
  if last_signed is not null and p_statement_date <= last_signed then
    raise exception 'the statement date must be after the last signed reconciliation' using errcode = '22023';
  end if;
  select * into pos from app.client_account_position(account.id, p_statement_date);
  select org.sample_mode into sample from public.organizations org where org.id = account.organization_id;

  insert into public.client_account_reconciliations (
    organization_id, client_account_id, period_start, statement_date, statement_balance_cents, currency,
    ledger_balance_cents, client_ledgers_total_cents, difference_cents, client_count, items, item_count,
    preparer_note, status, is_sample, idempotency_key, prepared_by, prepared_at
  ) values (
    account.organization_id, account.id,
    coalesce(last_signed + 1, date_trunc('month', p_statement_date)::date),
    p_statement_date, p_statement_balance_cents, 'CAD',
    pos.ledger_balance, pos.client_total, p_statement_balance_cents - pos.ledger_balance,
    pos.client_count, pos.items, jsonb_array_length(pos.items),
    note, 'pending_review', coalesce(sample, false), key, (select auth.uid()), clock_timestamp()
  )
  returning id into rid;
  perform app.record_audit_event(
    account.organization_id, 'client_funds.reconciliation_prepared', 'public.client_account_reconciliations', rid, 'success',
    jsonb_build_object(
      'client_account_id', account.id, 'statement_date', p_statement_date,
      'statement_balance_cents', p_statement_balance_cents, 'ledger_balance_cents', pos.ledger_balance,
      'difference_cents', p_statement_balance_cents - pos.ledger_balance
    )
  );
  return rid;
end;
$$;
revoke all on function app.prepare_client_reconciliation(uuid, date, bigint, text, text) from public, anon;

-- Signs a prepared reconciliation as 'reconciled' (difference zero) or 'exceptions' (notes). The
-- signer is someone other than the preparer, except the firm owner, who may sign their own after a
-- step-up taken after it was prepared. The figures are recomputed and must not have changed.
create function app.sign_client_reconciliation(p_reconciliation_id uuid, p_outcome text, p_notes text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec public.client_account_reconciliations%rowtype;
  actor uuid := (select auth.uid());
  outcome text := btrim(coalesce(p_outcome, ''));
  notes text := nullif(btrim(coalesce(p_notes, '')), '');
  self_signed boolean := false;
  pos record;
begin
  select * into rec from public.client_account_reconciliations where id = p_reconciliation_id;
  perform app.require_reconciliation_access(rec.organization_id, true);
  if rec.organization_id is distinct from (select app.current_organization_id()) then
    raise exception 'reconciliation access denied' using errcode = '42501';
  end if;
  select * into rec from public.client_account_reconciliations where id = rec.id for update;
  if rec.status <> 'pending_review' then
    raise exception 'only a reconciliation waiting for review can be signed' using errcode = '22023';
  end if;
  if outcome not in ('reconciled', 'exceptions') then
    raise exception 'choose reconciled or exceptions' using errcode = '22023';
  end if;
  if rec.prepared_by = actor then
    if app.has_org_role(rec.organization_id, array['firm_owner']::public.org_role[]) is distinct from true then
      raise exception 'the preparer cannot sign their own reconciliation' using errcode = '42501';
    end if;
    if app.mfa_step_up_satisfied(least(interval '15 minutes', statement_timestamp() - date_trunc('second', rec.prepared_at)))
       is distinct from true then
      raise exception 'step-up is required: signing your own reconciliation needs a step-up after it was prepared' using errcode = '42501';
    end if;
    self_signed := true;
  end if;
  if outcome = 'reconciled' and rec.difference_cents <> 0 then
    raise exception 'the difference must be zero to sign as reconciled; record exceptions instead' using errcode = '22023';
  end if;
  if outcome = 'exceptions' and (notes is null or length(notes) < 3) then
    raise exception 'exceptions need notes' using errcode = '22023';
  end if;
  if notes is not null and length(notes) > 2000 then
    raise exception 'notes are too long' using errcode = '22023';
  end if;
  -- The ledger must still say what it said when this was prepared.
  perform 1 from public.client_accounts where id = rec.client_account_id for update;
  select * into pos from app.client_account_position(rec.client_account_id, rec.statement_date);
  if pos.ledger_balance <> rec.ledger_balance_cents
     or pos.client_total <> rec.client_ledgers_total_cents
     or pos.items <> rec.items then
    raise exception 'the ledger changed since this reconciliation was prepared; discard it and prepare it again' using errcode = '22023';
  end if;

  update public.client_account_reconciliations
  set status = outcome::public.client_reconciliation_status,
      signed_by = actor,
      signed_at = clock_timestamp(),
      owner_self_signed = self_signed,
      review_notes = notes
  where id = rec.id
  returning * into rec;
  perform app.record_audit_event(
    rec.organization_id,
    case when self_signed then 'client_funds.reconciliation_signed_owner_self' else 'client_funds.reconciliation_signed' end,
    'public.client_account_reconciliations', rec.id, 'success',
    jsonb_build_object(
      'outcome', outcome, 'statement_date', rec.statement_date, 'difference_cents', rec.difference_cents,
      'prepared_by', rec.prepared_by, 'owner_self_signed', self_signed
    )
  );
  return jsonb_build_object('status', rec.status, 'owner_self_signed', self_signed);
end;
$$;
revoke all on function app.sign_client_reconciliation(uuid, text, text) from public, anon;

create function app.discard_client_reconciliation(p_reconciliation_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec public.client_account_reconciliations%rowtype;
  reason text := btrim(coalesce(p_reason, ''));
begin
  select * into rec from public.client_account_reconciliations where id = p_reconciliation_id;
  perform app.require_reconciliation_access(rec.organization_id, false);
  if rec.organization_id is distinct from (select app.current_organization_id()) then
    raise exception 'reconciliation access denied' using errcode = '42501';
  end if;
  select * into rec from public.client_account_reconciliations where id = rec.id for update;
  if rec.status <> 'pending_review' then
    raise exception 'only a reconciliation waiting for review can be discarded' using errcode = '22023';
  end if;
  if length(reason) not between 3 and 500 then
    raise exception 'a reason is required' using errcode = '22023';
  end if;
  update public.client_account_reconciliations
  set status = 'discarded', discarded_by = (select auth.uid()), discarded_at = clock_timestamp(), discard_reason = reason
  where id = rec.id;
  perform app.record_audit_event(
    rec.organization_id, 'client_funds.reconciliation_discarded', 'public.client_account_reconciliations', rec.id, 'success',
    jsonb_build_object('statement_date', rec.statement_date)
  );
  return rec.id;
end;
$$;
revoke all on function app.discard_client_reconciliation(uuid, text) from public, anon;

-- ---------------------------------------------------------------------------
-- Public wrappers. The database checks the caller; these stay security invoker.
-- ---------------------------------------------------------------------------

create function public.prepare_client_reconciliation(
  p_client_account_id uuid, p_statement_date date, p_statement_balance_cents bigint, p_note text, p_idempotency_key text
) returns uuid language sql security invoker set search_path = ''
as $$ select app.prepare_client_reconciliation(p_client_account_id, p_statement_date, p_statement_balance_cents, p_note, p_idempotency_key); $$;

create function public.sign_client_reconciliation(p_reconciliation_id uuid, p_outcome text, p_notes text)
returns jsonb language sql security invoker set search_path = ''
as $$ select app.sign_client_reconciliation(p_reconciliation_id, p_outcome, p_notes); $$;

create function public.discard_client_reconciliation(p_reconciliation_id uuid, p_reason text)
returns uuid language sql security invoker set search_path = ''
as $$ select app.discard_client_reconciliation(p_reconciliation_id, p_reason); $$;

revoke all on function public.prepare_client_reconciliation(uuid, date, bigint, text, text) from public, anon;
revoke all on function public.sign_client_reconciliation(uuid, text, text) from public, anon;
revoke all on function public.discard_client_reconciliation(uuid, text) from public, anon;

grant execute on function public.prepare_client_reconciliation(uuid, date, bigint, text, text) to authenticated;
grant execute on function public.sign_client_reconciliation(uuid, text, text) to authenticated;
grant execute on function public.discard_client_reconciliation(uuid, text) to authenticated;

grant execute on function app.require_reconciliation_access(uuid, boolean) to authenticated;
grant execute on function app.prepare_client_reconciliation(uuid, date, bigint, text, text) to authenticated;
grant execute on function app.sign_client_reconciliation(uuid, text, text) to authenticated;
grant execute on function app.discard_client_reconciliation(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Table privileges and row-level security
-- ---------------------------------------------------------------------------

revoke all on table public.client_account_reconciliations from anon, authenticated, service_role;
grant select on table public.client_account_reconciliations to authenticated, service_role;

alter table public.client_account_reconciliations enable row level security;
alter table public.client_account_reconciliations force row level security;

-- The firm's billing staff (owner, any finance user), as for the client accounts themselves.
create policy client_account_reconciliations_select on public.client_account_reconciliations
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.can_read_firm_payment_account(organization_id))
  );
