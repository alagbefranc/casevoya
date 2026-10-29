-- MIG-03: finance review of imported opening balances.
-- Additive. The import still creates pending rows and posts nothing to an invoice or a client
-- account. This adds the source-file snapshot, a correction with a reason, a lock once the row
-- is approved or rejected, and a review payload the Finance screen reads.
--
-- Access is the firm owner and finance users of the firm (staff MFA). A case manager, assistant
-- or consultant does not read or review them. The person who imported a balance still cannot
-- approve their own unless they are the firm owner and the step-up is after the import.

-- ---------------------------------------------------------------------------
-- Source-file snapshot. The staging rows are purged after commit, so the file's
-- amount, kind, currency, date, name, checksum and row count are kept on the balance.
-- ---------------------------------------------------------------------------
alter table public.opening_balances
  add column source_amount_cents bigint,
  add column source_kind text,
  add column source_currency text,
  add column source_as_of date,
  add column file_name text,
  add column file_sha256 text,
  add column file_row_count integer;

-- The touch and audit triggers must not treat this backfill as a later edit of the balance.
alter table public.opening_balances disable trigger opening_balances_touch;
alter table public.opening_balances disable trigger opening_balances_audit;

update public.opening_balances ob
set source_amount_cents = ob.amount_cents,
    source_kind = ob.kind,
    source_currency = ob.currency,
    source_as_of = ob.as_of,
    file_name = b.file_name,
    file_sha256 = b.source_sha256,
    file_row_count = b.source_row_count
from public.migration_batches b
where b.id = ob.batch_id
  and b.organization_id = ob.organization_id
  and ob.source_amount_cents is null;

alter table public.opening_balances enable trigger opening_balances_touch;
alter table public.opening_balances enable trigger opening_balances_audit;

alter table public.opening_balances
  alter column source_amount_cents set not null,
  alter column source_kind set not null,
  alter column source_currency set not null,
  alter column source_as_of set not null,
  alter column file_name set not null,
  alter column file_sha256 set not null,
  alter column file_row_count set not null;

alter table public.opening_balances
  add constraint opening_balances_source_amount_chk check (source_amount_cents between 1 and 100000000000),
  add constraint opening_balances_source_kind_chk check (source_kind in ('receivable', 'advance')),
  add constraint opening_balances_source_currency_chk check (source_currency ~ '^[A-Z]{3}$'),
  add constraint opening_balances_file_sha_chk check (file_sha256 ~ '^[0-9a-f]{64}$'),
  add constraint opening_balances_file_rows_chk check (file_row_count between 1 and 5000),
  add constraint opening_balances_file_name_chk check (length(btrim(file_name)) between 1 and 200);

comment on column public.opening_balances.source_amount_cents is
  'MIG-03: the amount in the source file, in cents. Never changed. The current amount_cents may be corrected before approval.';

-- A correction while the balance is still pending. Append-only. The reason stays here.
create table public.opening_balance_corrections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  balance_id uuid not null,
  reason text not null check (length(btrim(reason)) between 3 and 500),
  before_kind text not null check (before_kind in ('receivable', 'advance')),
  after_kind text not null check (after_kind in ('receivable', 'advance')),
  before_amount_cents bigint not null check (before_amount_cents between 1 and 100000000000),
  after_amount_cents bigint not null check (after_amount_cents between 1 and 100000000000),
  before_currency text not null check (before_currency ~ '^[A-Z]{3}$'),
  after_currency text not null check (after_currency ~ '^[A-Z]{3}$'),
  before_as_of date not null,
  after_as_of date not null,
  corrected_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  foreign key (balance_id, organization_id) references public.opening_balances (id, organization_id)
);
comment on table public.opening_balance_corrections is
  'MIG-03: a finance correction of a pending opening balance, with the reason and the values before and after. The source-file snapshot on the balance does not change.';

create index opening_balance_corrections_balance_fk_idx on public.opening_balance_corrections (balance_id, organization_id);
create index opening_balance_corrections_org_idx on public.opening_balance_corrections (organization_id);
create index opening_balance_corrections_corrected_by_idx on public.opening_balance_corrections (corrected_by);

create trigger opening_balance_corrections_audit after insert or update or delete on public.opening_balance_corrections
  for each row execute function app.audit_row_change('reason');
create trigger opening_balance_corrections_no_delete before delete on public.opening_balance_corrections
  for each row execute function app.reject_governed_delete();
create trigger opening_balance_corrections_no_truncate before truncate on public.opening_balance_corrections
  for each statement execute function app.reject_governed_delete();
create trigger opening_balance_corrections_no_update before update on public.opening_balance_corrections
  for each row execute function app.reject_governed_delete();

alter table public.opening_balance_corrections enable row level security;
alter table public.opening_balance_corrections force row level security;
revoke all on table public.opening_balance_corrections from public, anon, authenticated, service_role;
grant select on table public.opening_balance_corrections to authenticated;

-- Owner and finance of the firm, not only a finance user assigned to the matter.
create policy opening_balances_finance_org on public.opening_balances
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.staff_mfa_satisfied())
    and (select app.has_org_role(organization_id, array['firm_owner', 'finance_user']::public.org_role[]))
  );

create policy opening_balance_corrections_select on public.opening_balance_corrections
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.staff_mfa_satisfied())
    and (select app.has_org_role(organization_id, array['firm_owner', 'finance_user']::public.org_role[]))
  );

-- ---------------------------------------------------------------------------
-- Snapshot on insert. Lock the snapshot always. Lock the balance once it leaves pending.
-- ---------------------------------------------------------------------------
create function app.opening_balance_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.migration_batches%rowtype;
begin
  if tg_op = 'INSERT' then
    select * into b from public.migration_batches batch
    where batch.id = new.batch_id and batch.organization_id = new.organization_id;
    if b.id is null then
      raise exception 'opening balance has no source file' using errcode = '23503';
    end if;
    new.source_amount_cents := new.amount_cents;
    new.source_kind := new.kind;
    new.source_currency := new.currency;
    new.source_as_of := new.as_of;
    new.file_name := b.file_name;
    new.file_sha256 := b.source_sha256;
    new.file_row_count := b.source_row_count;
    return new;
  end if;

  if new.source_amount_cents is distinct from old.source_amount_cents
     or new.source_kind is distinct from old.source_kind
     or new.source_currency is distinct from old.source_currency
     or new.source_as_of is distinct from old.source_as_of
     or new.file_name is distinct from old.file_name
     or new.file_sha256 is distinct from old.file_sha256
     or new.file_row_count is distinct from old.file_row_count
     or new.batch_id is distinct from old.batch_id
     or new.matter_id is distinct from old.matter_id
     or new.organization_id is distinct from old.organization_id
     or new.imported_by is distinct from old.imported_by
     or new.source_system is distinct from old.source_system then
    raise exception 'the source file snapshot is locked' using errcode = '42501';
  end if;

  if old.status <> 'pending_review' and (
       new.kind is distinct from old.kind
    or new.amount_cents is distinct from old.amount_cents
    or new.currency is distinct from old.currency
    or new.as_of is distinct from old.as_of
    or new.description is distinct from old.description
    or new.status is distinct from old.status
    or new.review_note is distinct from old.review_note
    or new.reviewed_by is distinct from old.reviewed_by
    or new.reviewed_at is distinct from old.reviewed_at
  ) then
    raise exception 'this opening balance is locked' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.opening_balance_guard() from public;

create trigger opening_balances_guard before insert or update on public.opening_balances
  for each row execute function app.opening_balance_guard();

-- ---------------------------------------------------------------------------
-- Who may review: firm owner or finance user, in the firm, with staff MFA.
-- ---------------------------------------------------------------------------
create function app.opening_balance_reviewer(p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
     or p_org is null
     or p_org is distinct from (select app.current_organization_id())
     or app.staff_mfa_satisfied() is distinct from true
     or app.has_org_role(p_org, array['firm_owner', 'finance_user']::public.org_role[]) is distinct from true then
    raise exception 'billing access denied' using errcode = '42501';
  end if;
end;
$$;
revoke all on function app.opening_balance_reviewer(uuid) from public;

-- Replaces public.review_opening_balance (20261025385200): same arguments and effects, but any
-- finance user of the firm may review, not only one assigned to the matter.
create or replace function public.review_opening_balance(p_org uuid, p_id uuid, p_approve boolean, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ob public.opening_balances%rowtype;
  actor uuid := (select auth.uid());
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  perform app.opening_balance_reviewer(p_org);
  select * into ob from public.opening_balances where id = p_id and organization_id = p_org for update;
  if ob.id is null then
    raise exception 'billing access denied' using errcode = '42501';
  end if;
  if app.mfa_step_up_satisfied() is distinct from true then
    raise exception 'step-up is required' using errcode = '42501';
  end if;
  if p_approve is null then
    raise exception 'choose approve or reject' using errcode = '22023';
  end if;
  if ob.status <> 'pending_review' then
    raise exception 'this opening balance was already reviewed' using errcode = '22023';
  end if;
  if ob.imported_by = actor then
    if app.has_org_role(p_org, array['firm_owner']::public.org_role[]) is distinct from true then
      raise exception 'the importer cannot review their own opening balance' using errcode = '42501';
    end if;
    if app.mfa_step_up_satisfied(least(interval '15 minutes', statement_timestamp() - date_trunc('second', ob.created_at))) is distinct from true then
      raise exception 'step-up is required: reviewing a balance you imported needs a step-up after the import' using errcode = '42501';
    end if;
  end if;
  if not p_approve and (v_note is null or length(v_note) not between 3 and 500) then
    raise exception 'a reason is required' using errcode = '22023';
  end if;
  if v_note is not null and length(v_note) not between 3 and 500 then
    raise exception 'the note must be 3 to 500 characters' using errcode = '22023';
  end if;
  update public.opening_balances set
    status = case when p_approve then 'approved' else 'rejected' end,
    reviewed_by = actor,
    reviewed_at = now(),
    review_note = v_note
  where id = ob.id
  returning * into ob;
  perform app.record_audit_event(p_org, case when p_approve then 'opening_balance.approved' else 'opening_balance.rejected' end,
    'public.opening_balances', ob.id, 'success',
    jsonb_build_object('kind', ob.kind, 'amount_cents', ob.amount_cents, 'currency', ob.currency, 'matter_id', ob.matter_id,
                       'self_reviewed', ob.imported_by = actor));
  return jsonb_build_object('id', ob.id, 'status', ob.status);
end;
$$;

create function public.correct_opening_balance(
  p_org uuid,
  p_id uuid,
  p_expected_version integer,
  p_kind text,
  p_amount_cents bigint,
  p_currency text,
  p_as_of date,
  p_description text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ob public.opening_balances%rowtype;
  actor uuid := (select auth.uid());
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_kind text := nullif(btrim(coalesce(p_kind, '')), '');
  v_currency text := upper(nullif(btrim(coalesce(p_currency, '')), ''));
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
begin
  perform app.opening_balance_reviewer(p_org);
  if app.mfa_step_up_satisfied() is distinct from true then
    raise exception 'step-up is required' using errcode = '42501';
  end if;
  select * into ob from public.opening_balances where id = p_id and organization_id = p_org for update;
  if ob.id is null then
    raise exception 'billing access denied' using errcode = '42501';
  end if;
  if ob.status <> 'pending_review' then
    raise exception 'this opening balance is locked' using errcode = '42501';
  end if;
  if ob.version is distinct from p_expected_version then
    raise exception 'opening balance conflict' using errcode = 'PT409';
  end if;
  if v_reason is null or length(v_reason) not between 3 and 500 then
    raise exception 'a reason is required' using errcode = '22023';
  end if;
  if v_kind is null or v_kind not in ('receivable', 'advance') then
    raise exception 'choose receivable or advance' using errcode = '22023';
  end if;
  if v_currency is null or v_currency !~ '^[A-Z]{3}$' then
    raise exception 'the currency is a three-letter code' using errcode = '22023';
  end if;
  if p_amount_cents is null or p_amount_cents not between 1 and 100000000000 then
    raise exception 'the amount is in cents, from 1 to 100000000000' using errcode = '22023';
  end if;
  if p_as_of is null then
    raise exception 'the as-of date is required' using errcode = '22023';
  end if;
  if v_description is not null and length(v_description) > 200 then
    raise exception 'the description is at most 200 characters' using errcode = '22023';
  end if;
  if v_kind = ob.kind
     and p_amount_cents = ob.amount_cents
     and v_currency = ob.currency
     and p_as_of = ob.as_of
     and v_description is not distinct from ob.description then
    raise exception 'nothing is different from the balance' using errcode = '22023';
  end if;
  insert into public.opening_balance_corrections (
    organization_id, balance_id, reason,
    before_kind, after_kind, before_amount_cents, after_amount_cents,
    before_currency, after_currency, before_as_of, after_as_of, corrected_by
  ) values (
    p_org, ob.id, v_reason,
    ob.kind, v_kind, ob.amount_cents, p_amount_cents,
    ob.currency, v_currency, ob.as_of, p_as_of, actor
  );
  update public.opening_balances set
    kind = v_kind,
    amount_cents = p_amount_cents,
    currency = v_currency,
    as_of = p_as_of,
    description = v_description
  where id = ob.id
  returning * into ob;
  perform app.record_audit_event(p_org, 'opening_balance.corrected', 'public.opening_balances', ob.id, 'success',
    jsonb_build_object(
      'matter_id', ob.matter_id,
      'before_amount_cents', (select c.before_amount_cents from public.opening_balance_corrections c where c.balance_id = ob.id order by c.created_at desc limit 1),
      'after_amount_cents', ob.amount_cents,
      'before_kind', (select c.before_kind from public.opening_balance_corrections c where c.balance_id = ob.id order by c.created_at desc limit 1),
      'after_kind', ob.kind,
      'currency', ob.currency,
      'reason_length', length(v_reason)
    ));
  return jsonb_build_object('id', ob.id, 'status', ob.status, 'version', ob.version);
end;
$$;

comment on function public.correct_opening_balance(uuid, uuid, integer, text, bigint, text, date, text, text) is
  'MIG-03: a firm owner or finance user corrects a pending opening balance. A reason is required. A fresh step-up is required. The source-file amount is unchanged. An approved or rejected balance is refused.';

revoke all on function public.correct_opening_balance(uuid, uuid, integer, text, bigint, text, date, text, text) from public, anon, service_role;
grant execute on function public.correct_opening_balance(uuid, uuid, integer, text, bigint, text, date, text, text) to authenticated;

-- The Finance screen: one payload, grouped later in the app. Amounts are cents. No person email.
create function public.opening_balance_review(p_org uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  perform app.opening_balance_reviewer(p_org);
  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.client_name, x.matter_title, x.as_of, x.id), '[]'::jsonb)
  into result
  from (
    select ob.id,
           ob.matter_id,
           m.title as matter_title,
           coalesce((
             select string_agg(person.display_name, ', ' order by person.display_name)
             from public.matter_participants mp
             join public.persons person
               on person.id = mp.person_id and person.organization_id = mp.organization_id
             where mp.matter_id = ob.matter_id
               and mp.organization_id = ob.organization_id
               and mp.role = 'applicant'
           ), 'No applicant on the matter') as client_name,
           ob.kind,
           ob.amount_cents,
           ob.currency,
           ob.as_of,
           ob.description,
           ob.source_kind,
           ob.source_amount_cents,
           ob.source_currency,
           ob.source_as_of,
           ob.status,
           ob.review_note,
           ob.version,
           ob.batch_id,
           ob.file_name,
           ob.file_sha256,
           ob.file_row_count,
           ob.source_system,
           ob.created_at,
           ob.imported_by = (select auth.uid()) as imported_by_self,
           coalesce((
             select jsonb_agg(jsonb_build_object(
               'reason', c.reason,
               'before_amount_cents', c.before_amount_cents,
               'after_amount_cents', c.after_amount_cents,
               'before_kind', c.before_kind,
               'after_kind', c.after_kind,
               'before_currency', c.before_currency,
               'after_currency', c.after_currency,
               'created_at', c.created_at
             ) order by c.created_at)
             from public.opening_balance_corrections c
             where c.balance_id = ob.id
           ), '[]'::jsonb) as corrections
    from public.opening_balances ob
    join public.matters m on m.id = ob.matter_id and m.organization_id = ob.organization_id
    where ob.organization_id = p_org
      and ob.is_sample = (select o.sample_mode from public.organizations o where o.id = p_org)
  ) x;
  return jsonb_build_object('rows', result);
end;
$$;

comment on function public.opening_balance_review(uuid) is
  'MIG-03: opening balances the firm owner or a finance user may review, with the source-file snapshot and corrections. No email address.';

revoke all on function public.opening_balance_review(uuid) from public, anon, service_role;
grant execute on function public.opening_balance_review(uuid) to authenticated;
