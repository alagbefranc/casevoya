-- Monthly three-way reconciliation workspace (FIN-12), on top of client_account_reconciliations
-- (20261019184700_client_account_reconciliations.sql).
--
--   client_reconciliation_adjustments  the bank side's outstanding items, typed in while a
--                                      reconciliation waits for review: deposits in transit (on the
--                                      ledger, not yet on the statement: added) and outstanding cheques
--                                      (written from the client account, not yet cleared: subtracted).
--                                      The adjusted bank balance = statement closing balance + deposits
--                                      in transit - outstanding cheques. A removed item stays on record
--                                      (removed_at); nothing is deleted.
--   adjusted_balance_cents             stored on the reconciliation when it is signed. Signing as
--                                      'reconciled' now needs the adjusted bank balance to equal the
--                                      control ledger (it needed the raw statement to). The unnamed
--                                      check "status <> 'reconciled' or difference_cents = 0" is
--                                      replaced by client_account_reconciliations_reconciled_balanced;
--                                      every row signed before this keeps meeting it (adjusted is null,
--                                      the statement is used).
--   app.sign_client_reconciliation     copied from 20261019184700, the adjusted balance added.
--   locked months                      once a month is signed for a client account, no ledger entry or
--                                      bank transfer can be recorded on or before its statement date for
--                                      that account (app.guard_reconciled_period). Signed and discarded
--                                      reconciliations were already final.
--   public.record_reconciliation_export audits the PDF report's download.
--
-- Who: the firm owner and finance users at aal2 (app.require_reconciliation_access), as before.
-- Nothing here changes a matter's stage or a government status. Additive only.

alter table public.client_account_reconciliations add column adjusted_balance_cents bigint
  check (adjusted_balance_cents is null or adjusted_balance_cents between -199999999999 and 199999999999);
comment on column public.client_account_reconciliations.adjusted_balance_cents is
  'Adjusted bank balance when signed: statement + deposits in transit - outstanding cheques. Null while waiting for review and for rows signed before FIN-12''s workspace.';
alter table public.client_account_reconciliations add constraint client_account_reconciliations_adjusted_when_signed
  check (adjusted_balance_cents is null or status in ('reconciled', 'exceptions'));

do $replace_reconciled_check$
declare
  constraint_name text;
begin
  for constraint_name in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.client_account_reconciliations'::regclass
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) like '%reconciled%'
      and pg_get_constraintdef(con.oid) like '%difference_cents = 0%'
  loop
    execute format('alter table public.client_account_reconciliations drop constraint %I', constraint_name);
  end loop;
end
$replace_reconciled_check$;
alter table public.client_account_reconciliations add constraint client_account_reconciliations_reconciled_balanced
  check (status <> 'reconciled' or coalesce(adjusted_balance_cents, statement_balance_cents) = ledger_balance_cents);

-- ---------------------------------------------------------------------------
-- Outstanding deposits and cheques
-- ---------------------------------------------------------------------------

create table public.client_reconciliation_adjustments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  reconciliation_id uuid not null,
  kind text not null check (kind in ('deposit_in_transit', 'outstanding_cheque')),
  description text not null check (length(btrim(description)) between 3 and 200),
  reference text check (reference is null or length(btrim(reference)) between 1 and 80),
  item_date date not null,
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 99999999999),
  removed_at timestamptz,
  removed_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id),
  check ((removed_at is null) = (removed_by is null)),
  foreign key (reconciliation_id, organization_id) references public.client_account_reconciliations (id, organization_id)
);
comment on table public.client_reconciliation_adjustments is
  'Outstanding bank-side items of a reconciliation waiting for review (FIN-12): deposits in transit and outstanding cheques. Locked with the reconciliation once it is signed or discarded.';

create index client_reconciliation_adjustments_rec_org_fk_idx on public.client_reconciliation_adjustments (reconciliation_id, organization_id);
create index client_reconciliation_adjustments_removed_by_idx on public.client_reconciliation_adjustments (removed_by);
create index client_reconciliation_adjustments_created_by_idx on public.client_reconciliation_adjustments (created_by);

-- Items change only while their reconciliation waits for review, and only by being removed once.
create function app.guard_reconciliation_adjustment_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent_status public.client_reconciliation_status;
begin
  if tg_op = 'DELETE' then
    raise exception 'reconciliation items are append-only' using errcode = '42501';
  end if;
  select rec.status into parent_status from public.client_account_reconciliations rec where rec.id = new.reconciliation_id;
  if parent_status is distinct from 'pending_review' then
    raise exception 'this reconciliation is signed or discarded; its items are locked' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    if (new.organization_id, new.reconciliation_id, new.kind, new.description, new.reference, new.item_date, new.amount_cents, new.created_at)
       is distinct from
       (old.organization_id, old.reconciliation_id, old.kind, old.description, old.reference, old.item_date, old.amount_cents, old.created_at)
       or old.removed_at is not null then
      raise exception 'reconciliation items are append-only' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function app.guard_reconciliation_adjustment_change() from public, anon, authenticated;

create trigger client_reconciliation_adjustments_guard before insert or update or delete on public.client_reconciliation_adjustments
  for each row execute function app.guard_reconciliation_adjustment_change();
create trigger client_reconciliation_adjustments_touch before update on public.client_reconciliation_adjustments
  for each row execute function app.touch_row();
create trigger client_reconciliation_adjustments_stamp before insert on public.client_reconciliation_adjustments
  for each row execute function app.stamp_created_by();
create trigger client_reconciliation_adjustments_audit after insert or update or delete on public.client_reconciliation_adjustments
  for each row execute function app.audit_row_change();

-- Deposits in transit minus outstanding cheques, for one reconciliation (items not removed).
create function app.reconciliation_adjustment_total(p_reconciliation_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(case item.kind when 'deposit_in_transit' then item.amount_cents else -item.amount_cents end), 0)::bigint
  from public.client_reconciliation_adjustments item
  where item.reconciliation_id = p_reconciliation_id and item.removed_at is null;
$$;
revoke all on function app.reconciliation_adjustment_total(uuid) from public, anon;

create function app.add_reconciliation_adjustment(
  p_reconciliation_id uuid,
  p_kind text,
  p_description text,
  p_reference text,
  p_item_date date,
  p_amount_cents bigint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec public.client_account_reconciliations%rowtype;
  item_kind text := btrim(coalesce(p_kind, ''));
  description text := btrim(coalesce(p_description, ''));
  reference text := nullif(btrim(coalesce(p_reference, '')), '');
  rid uuid;
begin
  select * into rec from public.client_account_reconciliations where id = p_reconciliation_id;
  perform app.require_reconciliation_access(rec.organization_id, false);
  if rec.organization_id is distinct from (select app.current_organization_id()) then
    raise exception 'reconciliation access denied' using errcode = '42501';
  end if;
  select * into rec from public.client_account_reconciliations where id = rec.id for update;
  if rec.status <> 'pending_review' then
    raise exception 'only a reconciliation waiting for review takes outstanding items' using errcode = '22023';
  end if;
  if item_kind not in ('deposit_in_transit', 'outstanding_cheque') then
    raise exception 'choose a deposit in transit or an outstanding cheque' using errcode = '22023';
  end if;
  if length(description) not between 3 and 200 then
    raise exception 'describe the item' using errcode = '22023';
  end if;
  if reference is not null and length(reference) > 80 then
    raise exception 'reference is too long' using errcode = '22023';
  end if;
  if p_item_date is null or p_item_date > rec.statement_date then
    raise exception 'an outstanding item is dated on or before the statement date' using errcode = '22023';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 or p_amount_cents > 99999999999 then
    raise exception 'amount must be positive' using errcode = '22023';
  end if;
  insert into public.client_reconciliation_adjustments (organization_id, reconciliation_id, kind, description, reference, item_date, amount_cents)
  values (rec.organization_id, rec.id, item_kind, description, reference, p_item_date, p_amount_cents)
  returning id into rid;
  perform app.record_audit_event(
    rec.organization_id, 'client_funds.reconciliation_item_added', 'public.client_reconciliation_adjustments', rid, 'success',
    jsonb_build_object('reconciliation_id', rec.id, 'kind', item_kind, 'amount_cents', p_amount_cents)
  );
  return rid;
end;
$$;
revoke all on function app.add_reconciliation_adjustment(uuid, text, text, text, date, bigint) from public, anon;

create function app.remove_reconciliation_adjustment(p_adjustment_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  item public.client_reconciliation_adjustments%rowtype;
  rec public.client_account_reconciliations%rowtype;
begin
  select * into item from public.client_reconciliation_adjustments where id = p_adjustment_id;
  select * into rec from public.client_account_reconciliations where id = item.reconciliation_id;
  perform app.require_reconciliation_access(rec.organization_id, false);
  if rec.organization_id is distinct from (select app.current_organization_id()) then
    raise exception 'reconciliation access denied' using errcode = '42501';
  end if;
  select * into rec from public.client_account_reconciliations where id = rec.id for update;
  if rec.status <> 'pending_review' then
    raise exception 'this reconciliation is signed or discarded; its items are locked' using errcode = '22023';
  end if;
  select * into item from public.client_reconciliation_adjustments where id = item.id for update;
  if item.removed_at is not null then
    raise exception 'this item was already removed' using errcode = '22023';
  end if;
  update public.client_reconciliation_adjustments
  set removed_at = clock_timestamp(), removed_by = (select auth.uid())
  where id = item.id;
  perform app.record_audit_event(
    rec.organization_id, 'client_funds.reconciliation_item_removed', 'public.client_reconciliation_adjustments', item.id, 'success',
    jsonb_build_object('reconciliation_id', rec.id, 'kind', item.kind, 'amount_cents', item.amount_cents)
  );
  return item.id;
end;
$$;
revoke all on function app.remove_reconciliation_adjustment(uuid) from public, anon;

-- From 20261019184700_client_account_reconciliations.sql. Changed: the adjusted bank balance
-- (statement + deposits in transit - outstanding cheques) is computed, must equal the control ledger
-- to sign as 'reconciled', and is stored on the row.
create or replace function app.sign_client_reconciliation(p_reconciliation_id uuid, p_outcome text, p_notes text)
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
  adjusted bigint;
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
  adjusted := rec.statement_balance_cents + app.reconciliation_adjustment_total(rec.id);
  if outcome = 'reconciled' and adjusted <> rec.ledger_balance_cents then
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
      review_notes = notes,
      adjusted_balance_cents = adjusted
  where id = rec.id
  returning * into rec;
  perform app.record_audit_event(
    rec.organization_id,
    case when self_signed then 'client_funds.reconciliation_signed_owner_self' else 'client_funds.reconciliation_signed' end,
    'public.client_account_reconciliations', rec.id, 'success',
    jsonb_build_object(
      'outcome', outcome, 'statement_date', rec.statement_date, 'difference_cents', rec.difference_cents,
      'adjusted_balance_cents', adjusted, 'prepared_by', rec.prepared_by, 'owner_self_signed', self_signed
    )
  );
  return jsonb_build_object('status', rec.status, 'owner_self_signed', self_signed, 'adjusted_balance_cents', adjusted);
end;
$$;

-- ---------------------------------------------------------------------------
-- Signed months are locked
-- ---------------------------------------------------------------------------

-- Refuses a client-fund entry (by its date) or a bank transfer (by the day the bank sent it) dated on
-- or before a signed reconciliation of the same client account.
create function app.guard_reconciled_period()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  account uuid;
  on_date date;
begin
  if tg_table_name = 'client_fund_entries' then
    account := new.client_account_id;
    on_date := new.occurred_on;
  else
    select entry.client_account_id into account from public.client_fund_entries entry where entry.id = new.entry_id;
    on_date := new.transferred_on;
  end if;
  if exists (
    select 1 from public.client_account_reconciliations rec
    where rec.client_account_id = account
      and rec.status in ('reconciled', 'exceptions')
      and rec.statement_date >= on_date
  ) then
    raise exception 'that date is in a signed reconciliation period; record it with a later date' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function app.guard_reconciled_period() from public, anon, authenticated;

create trigger client_fund_entries_reconciled_period before insert on public.client_fund_entries
  for each row execute function app.guard_reconciled_period();
create trigger client_fund_bank_transfers_reconciled_period before insert on public.client_fund_bank_transfers
  for each row execute function app.guard_reconciled_period();

-- ---------------------------------------------------------------------------
-- Report export (audited)
-- ---------------------------------------------------------------------------

create function public.record_reconciliation_export(p_reconciliation_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec public.client_account_reconciliations%rowtype;
begin
  select * into rec from public.client_account_reconciliations where id = p_reconciliation_id;
  perform app.require_reconciliation_access(rec.organization_id, false);
  if rec.id is null or rec.organization_id is distinct from (select app.current_organization_id()) then
    raise exception 'reconciliation access denied' using errcode = '42501';
  end if;
  perform app.record_audit_event(
    rec.organization_id, 'client_funds.reconciliation_exported', 'public.client_account_reconciliations', rec.id, 'success',
    jsonb_build_object('statement_date', rec.statement_date, 'status', rec.status)
  );
  return rec.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Public wrappers
-- ---------------------------------------------------------------------------

create function public.add_reconciliation_adjustment(
  p_reconciliation_id uuid, p_kind text, p_description text, p_reference text, p_item_date date, p_amount_cents bigint
) returns uuid language sql security invoker set search_path = ''
as $$ select app.add_reconciliation_adjustment(p_reconciliation_id, p_kind, p_description, p_reference, p_item_date, p_amount_cents); $$;

create function public.remove_reconciliation_adjustment(p_adjustment_id uuid)
returns uuid language sql security invoker set search_path = ''
as $$ select app.remove_reconciliation_adjustment(p_adjustment_id); $$;

revoke all on function public.add_reconciliation_adjustment(uuid, text, text, text, date, bigint) from public, anon;
revoke all on function public.remove_reconciliation_adjustment(uuid) from public, anon;
revoke all on function public.record_reconciliation_export(uuid) from public, anon;
grant execute on function public.add_reconciliation_adjustment(uuid, text, text, text, date, bigint) to authenticated;
grant execute on function public.remove_reconciliation_adjustment(uuid) to authenticated;
grant execute on function public.record_reconciliation_export(uuid) to authenticated;
grant execute on function app.add_reconciliation_adjustment(uuid, text, text, text, date, bigint) to authenticated;
grant execute on function app.remove_reconciliation_adjustment(uuid) to authenticated;
grant execute on function app.reconciliation_adjustment_total(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Table privileges and row-level security
-- ---------------------------------------------------------------------------

revoke all on table public.client_reconciliation_adjustments from anon, authenticated, service_role;
grant select on table public.client_reconciliation_adjustments to authenticated, service_role;

alter table public.client_reconciliation_adjustments enable row level security;
alter table public.client_reconciliation_adjustments force row level security;

-- The firm's billing staff (owner, any finance user), as for the reconciliations themselves.
create policy client_reconciliation_adjustments_select on public.client_reconciliation_adjustments
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.can_read_firm_payment_account(organization_id))
  );
