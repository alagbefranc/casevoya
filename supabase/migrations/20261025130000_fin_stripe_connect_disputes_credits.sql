-- Stripe Connect status, earned-fee checkout guard, disputes, failed refunds and overpayment
-- credits (FIN-02, FIN-13). TEST MODE ONLY. Additive only.
--
-- FIN-02
--   firm_payment_accounts gains what Stripe reports about the account, cached when the firm owner
--   (or the page, for the owner) reads it from Stripe: the open requirements (description, how
--   soon, who must act) and the account's responsibilities (fees_collector, losses_collector), so
--   Settings shows Stripe's own values, never a guess. app.sync_firm_payment_account_status writes
--   them; the older app.sync_firm_payment_account (20261019100100) is left as it was.
--   Card checkout is for earned fees only: app.invoice_card_checkout_check answers before Stripe is
--   called, and a trigger on invoice_payments refuses a card payment on any other kind of invoice
--   (an advance belongs in the client (trust) account, FIN-03), whatever path inserts it.
--
-- FIN-13
--   invoice_disputes gains the task made for the firm owner and when evidence was submitted.
--   invoice_dispute_evidence records each file sent to Stripe as dispute evidence (the file itself
--   is Stripe's; Casevoya keeps its name, type, size and Stripe file id). Billing staff only.
--   invoice_refunds gains the task made when Stripe says a refund failed or was canceled.
--   app.apply_stripe_reversal_event is copied from 20261019110100_invoice_refunds_disputes.sql
--   (its only definition) with two changes: a new dispute makes an internal task for the firm
--   owner on the invoice's matter, due on the evidence deadline in the firm's timezone; a refund
--   that fails or is canceled makes a task due today (app.firm_today). Neither changes the matter.
--
--   client_credits: money the firm holds on an invoice beyond what it asks for (a payment above
--   the balance, a credit note on a paid invoice, a payment that arrived after a void). One row
--   per source invoice, opened and settled by a trigger on invoices, whatever moved the money.
--   What is left is always computed from the invoice (app.client_credit_available_cents), less
--   card refunds still pending at Stripe.
--   client_credit_allocations: the links. Staff choose, per credit:
--     * apply to another open invoice of the same client: the amount moves from the source
--       invoice's paid_cents to the target's (both statuses follow app.invoice_settled_status);
--     * refund to the card: a Stripe refund of the source invoice's card payment (recorded as
--       usual by app.record_invoice_refund), linked here;
--     * record a bank refund made outside Casevoya: refused while a card refund on that invoice is
--       still pending at Stripe, so the client is never refunded twice.
--   Billing access to the matters (firm owner or the matter's finance user, aal2) and a recent
--   step-up, like every money movement. Audited.

-- ---------------------------------------------------------------------------
-- FIN-02: what Stripe reports about the connected account
-- ---------------------------------------------------------------------------

alter table public.firm_payment_accounts add column requirements jsonb not null default '[]'::jsonb
  check (jsonb_typeof(requirements) = 'array' and jsonb_array_length(requirements) <= 50);
alter table public.firm_payment_accounts add column fees_collector text
  check (fees_collector is null or fees_collector in ('application', 'application_custom', 'application_express', 'stripe'));
alter table public.firm_payment_accounts add column losses_collector text
  check (losses_collector is null or losses_collector in ('application', 'stripe'));
comment on column public.firm_payment_accounts.requirements is
  'Stripe''s open requirements for the account as last read: [{description, due: currently_due|past_due|eventually_due, from: user|stripe}].';
comment on column public.firm_payment_accounts.fees_collector is
  'Stripe''s defaults.responsibilities.fees_collector for the account as last read; null before it was read.';
comment on column public.firm_payment_accounts.losses_collector is
  'Stripe''s defaults.responsibilities.losses_collector for the account as last read; null before it was read.';

-- The firm owner (aal2, no step-up: reading Stripe moves no money) stores what Stripe reported.
-- Only known keys and values are kept from each requirement.
create function app.sync_firm_payment_account_status(
  p_org uuid,
  p_account_id text,
  p_card_payments_status text,
  p_payouts_status text,
  p_requirements jsonb,
  p_fees_collector text default null,
  p_losses_collector text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  allowed text[] := array['pending', 'active', 'restricted', 'unsupported'];
  cleaned jsonb;
begin
  perform app.require_active_staff(p_org, array['firm_owner']::public.org_role[], false);
  if not (coalesce(p_card_payments_status, '') = any (allowed)) or not (coalesce(p_payouts_status, '') = any (allowed)) then
    raise exception 'unknown capability status' using errcode = '22023';
  end if;
  if p_requirements is not null and jsonb_typeof(p_requirements) <> 'array' then
    raise exception 'requirements must be a list' using errcode = '22023';
  end if;
  if p_fees_collector is not null and p_fees_collector not in ('application', 'application_custom', 'application_express', 'stripe') then
    raise exception 'unknown fees collector' using errcode = '22023';
  end if;
  if p_losses_collector is not null and p_losses_collector not in ('application', 'stripe') then
    raise exception 'unknown losses collector' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'description', left(btrim(entry ->> 'description'), 300),
           'due', case when entry ->> 'due' in ('currently_due', 'past_due', 'eventually_due') then entry ->> 'due' else 'currently_due' end,
           'from', case when entry ->> 'from' = 'stripe' then 'stripe' else 'user' end
         ) order by ordinality), '[]'::jsonb)
  into cleaned
  from jsonb_array_elements(coalesce(p_requirements, '[]'::jsonb)) with ordinality as item(entry, ordinality)
  where jsonb_typeof(entry) = 'object'
    and length(btrim(coalesce(entry ->> 'description', ''))) > 0
    and ordinality <= 50;
  update public.firm_payment_accounts
  set card_payments_status = p_card_payments_status,
      payouts_status = p_payouts_status,
      requirements = cleaned,
      requirements_due = jsonb_array_length(cleaned),
      fees_collector = coalesce(p_fees_collector, fees_collector),
      losses_collector = coalesce(p_losses_collector, losses_collector),
      status_checked_at = now()
  where organization_id = p_org
    and account_id = btrim(coalesce(p_account_id, ''));
end;
$$;
revoke all on function app.sync_firm_payment_account_status(uuid, text, text, text, jsonb, text, text) from public, anon;
grant execute on function app.sync_firm_payment_account_status(uuid, text, text, text, jsonb, text, text) to authenticated;

create function public.sync_firm_payment_account_status(
  p_org uuid, p_account_id text, p_card_payments_status text, p_payouts_status text,
  p_requirements jsonb, p_fees_collector text default null, p_losses_collector text default null
) returns void language sql security invoker set search_path = ''
as $$
  select app.sync_firm_payment_account_status(
    p_org, p_account_id, p_card_payments_status, p_payouts_status, p_requirements, p_fees_collector, p_losses_collector
  );
$$;
revoke all on function public.sync_firm_payment_account_status(uuid, text, text, text, jsonb, text, text) from public, anon;
grant execute on function public.sync_firm_payment_account_status(uuid, text, text, text, jsonb, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- FIN-02: card checkout is for earned fees only
-- ---------------------------------------------------------------------------

-- The invoice kinds a client may pay by card: earned fees and incurred costs. Anything else (an
-- advance or a deposit for the client (trust) account) is refused.
create function app.is_card_payable_category(p_category text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_category in ('professional_fee', 'disbursement', 'consultation_fee'), false);
$$;
revoke all on function app.is_card_payable_category(text) from public, anon;
grant execute on function app.is_card_payable_category(text) to authenticated, service_role;

-- Whether the signed-in client may start a card payment of this invoice, and why not. Called
-- before Stripe is asked for anything.
create function app.invoice_card_checkout_check(p_invoice_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  invoice public.invoices%rowtype;
begin
  select * into invoice from public.invoices where id = p_invoice_id;
  if invoice.id is null or app.is_matter_party(invoice.matter_id) is distinct from true then
    raise exception 'invoice not found' using errcode = '42501';
  end if;
  if not app.is_card_payable_category(invoice.fee_category) then
    return jsonb_build_object('allowed', false, 'reason', 'not_earned_fee');
  end if;
  return jsonb_build_object('allowed', true, 'reason', null);
end;
$$;
revoke all on function app.invoice_card_checkout_check(uuid) from public, anon;
grant execute on function app.invoice_card_checkout_check(uuid) to authenticated;

create function public.invoice_card_checkout_check(p_invoice_id uuid)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select app.invoice_card_checkout_check(p_invoice_id); $$;
revoke all on function public.invoice_card_checkout_check(uuid) from public, anon;
grant execute on function public.invoice_card_checkout_check(uuid) to authenticated;

create function app.guard_card_payment_category()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  category text;
begin
  select invoice.fee_category into category from public.invoices invoice where invoice.id = new.invoice_id;
  if not app.is_card_payable_category(category) then
    raise exception 'card checkout is for earned fees only; an advance is paid into the client account' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function app.guard_card_payment_category() from public, anon, authenticated;

create trigger invoice_payments_earned_fee_only before insert on public.invoice_payments
  for each row execute function app.guard_card_payment_category();

-- ---------------------------------------------------------------------------
-- FIN-13: tasks for the firm owner
-- ---------------------------------------------------------------------------

-- An internal task for the firm's (first active) owner on a matter. Returns null when the firm
-- has no active owner. Used by the webhook path, which has no signed-in user.
create function app.create_finance_task(
  p_org uuid,
  p_matter_id uuid,
  p_title text,
  p_priority public.task_priority,
  p_due_on date,
  p_task_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid;
  zone text;
  new_task uuid;
begin
  if p_matter_id is null then
    return null;
  end if;
  select membership.id into owner_id
  from public.memberships membership
  where membership.organization_id = p_org
    and membership.role = 'firm_owner'
    and membership.status = 'active'
  order by membership.created_at
  limit 1;
  if owner_id is null then
    return null;
  end if;
  select coalesce(nullif(btrim(org.timezone), ''), 'America/Toronto') into zone from public.organizations org where org.id = p_org;
  insert into public.tasks (
    organization_id, matter_id, audience, title, priority, status, owner_membership_id, due_on, due_timezone, task_key, checklist
  ) values (
    p_org, p_matter_id, 'internal', left(p_title, 200), p_priority, 'open', owner_id, p_due_on, coalesce(zone, 'America/Toronto'), p_task_key, '[]'::jsonb
  )
  returning id into new_task;
  insert into public.task_events (organization_id, task_id, event_kind, to_status)
  values (p_org, new_task, 'created', 'open');
  return new_task;
end;
$$;
revoke all on function app.create_finance_task(uuid, uuid, text, public.task_priority, date, text) from public, anon, authenticated;

alter table public.invoice_disputes add column task_id uuid;
alter table public.invoice_disputes add column evidence_submitted_at timestamptz;
alter table public.invoice_disputes add column evidence_submitted_by uuid references auth.users (id);
alter table public.invoice_disputes add constraint invoice_disputes_task_fk
  foreign key (task_id, organization_id) references public.tasks (id, organization_id);
create index invoice_disputes_task_org_fk_idx on public.invoice_disputes (task_id, organization_id);
create index invoice_disputes_evidence_by_idx on public.invoice_disputes (evidence_submitted_by);
comment on column public.invoice_disputes.task_id is 'The task made for the firm owner when Stripe reported the dispute.';

alter table public.invoice_refunds add column task_id uuid;
alter table public.invoice_refunds add constraint invoice_refunds_task_fk
  foreign key (task_id, organization_id) references public.tasks (id, organization_id);
create index invoice_refunds_task_org_fk_idx on public.invoice_refunds (task_id, organization_id);
comment on column public.invoice_refunds.task_id is 'The task made for the firm owner when Stripe said the refund failed or was canceled.';

-- ---------------------------------------------------------------------------
-- FIN-13: dispute evidence (billing staff, recent step-up)
-- ---------------------------------------------------------------------------

create table public.invoice_dispute_evidence (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  dispute_id uuid not null,
  stripe_file_id text not null check (stripe_file_id ~ '^file_[A-Za-z0-9]{6,250}$'),
  file_name text not null check (length(btrim(file_name)) between 1 and 200),
  content_type text not null check (content_type in ('application/pdf', 'image/jpeg', 'image/png')),
  size_bytes integer not null check (size_bytes between 1 and 4718592),
  explanation text check (explanation is null or length(btrim(explanation)) between 1 and 5000),
  submitted boolean not null default false,
  livemode boolean not null default false check (livemode is false),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  unique (id, organization_id),
  foreign key (dispute_id, organization_id) references public.invoice_disputes (id, organization_id)
);
comment on table public.invoice_dispute_evidence is
  'Evidence files sent to Stripe for a card dispute (test mode). The file is Stripe''s; Casevoya keeps its name, type, size and Stripe file id (FIN-13).';

create index invoice_dispute_evidence_dispute_org_fk_idx on public.invoice_dispute_evidence (dispute_id, organization_id);
create index invoice_dispute_evidence_org_idx on public.invoice_dispute_evidence (organization_id, created_at desc);
create index invoice_dispute_evidence_created_by_idx on public.invoice_dispute_evidence (created_by);

create trigger invoice_dispute_evidence_stamp before insert on public.invoice_dispute_evidence
  for each row execute function app.stamp_created_by();
create trigger invoice_dispute_evidence_audit after insert or update or delete on public.invoice_dispute_evidence
  for each row execute function app.audit_row_change();
create trigger invoice_dispute_evidence_no_change before update or delete on public.invoice_dispute_evidence
  for each row execute function app.reject_payment_event_change();

-- Billing access to the dispute's payment and a recent step-up (app.require_refund_access), the
-- dispute still open to evidence, before its deadline, on the firm's own account.
create function app.dispute_evidence_context(p_dispute_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  dispute public.invoice_disputes%rowtype;
  firm_account text;
begin
  select * into dispute from public.invoice_disputes where id = p_dispute_id;
  if dispute.id is null then
    raise exception 'billing access denied' using errcode = '42501';
  end if;
  perform app.require_refund_access(dispute.payment_id);
  if dispute.status not in ('needs_response', 'warning_needs_response') then
    raise exception 'this dispute no longer takes evidence' using errcode = '22023';
  end if;
  if dispute.evidence_due_by is not null and dispute.evidence_due_by <= now() then
    raise exception 'the evidence deadline has passed' using errcode = '22023';
  end if;
  select fpa.account_id into firm_account from public.firm_payment_accounts fpa where fpa.organization_id = dispute.organization_id;
  if firm_account is distinct from dispute.connected_account_id then
    raise exception 'payment account does not match the firm' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'dispute_id', dispute.dispute_id,
    'account_id', dispute.connected_account_id,
    'number', dispute.number,
    'organization_id', dispute.organization_id
  );
end;
$$;
revoke all on function app.dispute_evidence_context(uuid) from public, anon;
grant execute on function app.dispute_evidence_context(uuid) to authenticated;

-- Records a file Stripe accepted as evidence, and that the evidence was submitted when it was.
create function app.record_dispute_evidence(
  p_dispute_id uuid,
  p_stripe_file_id text,
  p_file_name text,
  p_content_type text,
  p_size_bytes integer,
  p_explanation text,
  p_submitted boolean,
  p_livemode boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  dispute public.invoice_disputes%rowtype;
  rid uuid;
begin
  select * into dispute from public.invoice_disputes where id = p_dispute_id for update;
  if dispute.id is null then
    raise exception 'billing access denied' using errcode = '42501';
  end if;
  perform app.require_refund_access(dispute.payment_id);
  if p_livemode is distinct from false then
    raise exception 'only test-mode evidence is accepted' using errcode = '22023';
  end if;
  if app.dispute_status_rank(dispute.status) = 3 then
    raise exception 'this dispute is closed' using errcode = '22023';
  end if;
  insert into public.invoice_dispute_evidence (
    organization_id, dispute_id, stripe_file_id, file_name, content_type, size_bytes, explanation, submitted, livemode
  ) values (
    dispute.organization_id, dispute.id, btrim(coalesce(p_stripe_file_id, '')), left(btrim(coalesce(p_file_name, '')), 200),
    p_content_type, p_size_bytes, nullif(btrim(coalesce(p_explanation, '')), ''), coalesce(p_submitted, false), false
  )
  returning id into rid;
  if coalesce(p_submitted, false) then
    update public.invoice_disputes
    set evidence_submitted_at = clock_timestamp(), evidence_submitted_by = (select auth.uid())
    where id = dispute.id;
  end if;
  perform app.record_audit_event(
    dispute.organization_id,
    case when coalesce(p_submitted, false) then 'invoice.dispute_evidence_submitted' else 'invoice.dispute_evidence_added' end,
    'public.invoice_disputes', dispute.id, 'success',
    jsonb_build_object('invoice_id', dispute.invoice_id, 'evidence_id', rid, 'content_type', p_content_type, 'size_bytes', p_size_bytes)
  );
  return rid;
end;
$$;
revoke all on function app.record_dispute_evidence(uuid, text, text, text, integer, text, boolean, boolean) from public, anon;
grant execute on function app.record_dispute_evidence(uuid, text, text, text, integer, text, boolean, boolean) to authenticated;

create function public.dispute_evidence_context(p_dispute_id uuid)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select app.dispute_evidence_context(p_dispute_id); $$;

create function public.record_dispute_evidence(
  p_dispute_id uuid, p_stripe_file_id text, p_file_name text, p_content_type text, p_size_bytes integer,
  p_explanation text, p_submitted boolean, p_livemode boolean
) returns uuid language sql security invoker set search_path = ''
as $$
  select app.record_dispute_evidence(p_dispute_id, p_stripe_file_id, p_file_name, p_content_type, p_size_bytes, p_explanation, p_submitted, p_livemode);
$$;

revoke all on function public.dispute_evidence_context(uuid) from public, anon;
revoke all on function public.record_dispute_evidence(uuid, text, text, text, integer, text, boolean, boolean) from public, anon;
grant execute on function public.dispute_evidence_context(uuid) to authenticated;
grant execute on function public.record_dispute_evidence(uuid, text, text, text, integer, text, boolean, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- FIN-13: webhook events. Copied from 20261019110100_invoice_refunds_disputes.sql (its only
-- definition). Changed: a new dispute makes a task for the firm owner (invoice_disputes.task_id);
-- a refund that fails or is canceled makes one too (invoice_refunds.task_id). Nothing else.
-- ---------------------------------------------------------------------------

create or replace function app.apply_stripe_reversal_event(
  p_event_id text,
  p_account_id text,
  p_event_type text,
  p_object_id text,
  p_payment_intent_id text,
  p_charge_id text,
  p_amount_cents bigint,
  p_currency text,
  p_status text,
  p_reason text,
  p_failure_reason text,
  p_evidence_due_by timestamptz,
  p_amount_refunded_cents bigint,
  p_event_created bigint,
  p_livemode boolean,
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
  event_type text := left(btrim(coalesce(p_event_type, '')), 120);
  object_key text := btrim(coalesce(p_object_id, ''));
  currency text := upper(btrim(coalesce(p_currency, '')));
  payment public.invoice_payments%rowtype;
  invoice public.invoices%rowtype;
  refund public.invoice_refunds%rowtype;
  dispute public.invoice_disputes%rowtype;
  inbox_id uuid;
  inbox_status public.webhook_inbox_status;
  next_refund public.invoice_refund_status;
  next_dispute public.invoice_dispute_status;
  outcome text := 'unchanged';
  detail text;
  next_number integer;
  new_task uuid;
begin
  if length(event_key) = 0 then
    raise exception 'event id is required' using errcode = '22023';
  end if;

  select * into payment from public.invoice_payments where payment_intent_id = btrim(coalesce(p_payment_intent_id, ''));

  inbox_id := app.ingest_webhook_event(
    'stripe', event_key, account_key, event_type, coalesce(p_payload, '{}'::jsonb), true, payment.organization_id
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

  if payment.connected_account_id <> account_key then
    outcome := 'rejected';
    detail := 'connected account does not match';
  elsif currency <> payment.currency then
    outcome := 'rejected';
    detail := 'currency does not match';
  elsif event_type in ('refund.created', 'refund.updated', 'refund.failed') then
    next_refund := case
      when event_type = 'refund.failed' then 'failed'
      when p_status in ('pending', 'requires_action', 'succeeded', 'failed', 'canceled') then p_status::public.invoice_refund_status
      else null
    end;
    select * into refund from public.invoice_refunds where refund_id = object_key for update;
    if refund.id is null then
      -- Stripe made a refund Casevoya did not record: recover it when it fits.
      if object_key !~ '^(re|pyr)_[A-Za-z0-9]{6,250}$' or coalesce(p_amount_cents, 0) <= 0 then
        outcome := 'rejected';
        detail := 'refund is invalid';
      elsif payment.status <> 'succeeded' or p_amount_cents > app.payment_refundable_cents(payment.id) then
        outcome := 'rejected';
        detail := 'refund exceeds the amount received';
      else
        perform pg_advisory_xact_lock(hashtextextended('casevoya.refund_number:' || payment.organization_id::text, 0));
        select coalesce(max(substring(r.number from 4)::integer), 0) + 1 into next_number
        from public.invoice_refunds r
        where r.organization_id = payment.organization_id;
        insert into public.invoice_refunds (
          organization_id, invoice_id, payment_id, number, refund_id, connected_account_id,
          amount_cents, currency, reason, status, livemode
        ) values (
          payment.organization_id, payment.invoice_id, payment.id, 'RF-' || lpad(next_number::text, 4, '0'), object_key,
          payment.connected_account_id, p_amount_cents, payment.currency,
          case when p_reason in ('duplicate', 'fraudulent', 'requested_by_customer') then p_reason end,
          'pending', false
        )
        returning * into refund;
        outcome := 'applied';
        detail := 'refund recorded from Stripe';
      end if;
    end if;

    if refund.id is not null and outcome <> 'rejected' then
      if refund.payment_id <> payment.id then
        outcome := 'rejected';
        detail := 'refund belongs to another payment';
      elsif p_amount_cents is distinct from refund.amount_cents then
        outcome := 'rejected';
        detail := 'amount does not match';
      elsif next_refund is null then
        detail := coalesce(detail, 'refund status not applied');
      elsif refund.status in ('succeeded', 'failed', 'canceled') then
        outcome := 'unchanged';
        detail := 'refund already ' || refund.status::text;
      elsif next_refund = refund.status then
        null;
      elsif next_refund = 'succeeded' then
        if refund.amount_cents > payment.amount_received_cents - payment.refunded_cents
           or refund.amount_cents > invoice.paid_cents - invoice.refunded_cents then
          outcome := 'rejected';
          detail := 'refund exceeds the amount received';
        else
          outcome := 'applied';
          update public.invoice_refunds
          set status = 'succeeded', succeeded_at = clock_timestamp(), last_event_id = event_key
          where id = refund.id
          returning * into refund;
          update public.invoice_payments
          set refunded_cents = refunded_cents + refund.amount_cents
          where id = payment.id
          returning * into payment;
          update public.invoices
          set refunded_cents = refunded_cents + refund.amount_cents,
              status = case
                when refunded_cents + refund.amount_cents >= paid_cents then 'refunded'::public.invoice_status
                else status
              end
          where id = invoice.id
          returning * into invoice;
          perform app.record_audit_event(
            invoice.organization_id, 'invoice.refund_succeeded', 'public.invoice_refunds', refund.id, 'success',
            jsonb_build_object('invoice_id', invoice.id, 'amount_cents', refund.amount_cents, 'currency', refund.currency)
          );
        end if;
      else
        outcome := 'applied';
        update public.invoice_refunds
        set status = next_refund,
            last_event_id = event_key,
            failure_reason = case when next_refund in ('failed', 'canceled') then left(nullif(btrim(coalesce(p_failure_reason, '')), ''), 120) else failure_reason end,
            failed_at = case when next_refund in ('failed', 'canceled') then clock_timestamp() else failed_at end
        where id = refund.id
        returning * into refund;
        if next_refund in ('failed', 'canceled') then
          perform app.record_audit_event(
            invoice.organization_id, 'invoice.refund_failed', 'public.invoice_refunds', refund.id, 'failure',
            jsonb_build_object('invoice_id', invoice.id, 'status', next_refund, 'amount_cents', refund.amount_cents)
          );
          -- New: the firm owner follows it up (FIN-13). Once per refund.
          if refund.task_id is null then
            new_task := app.create_finance_task(
              invoice.organization_id, invoice.matter_id,
              'Refund ' || refund.number || ' ' || case when next_refund = 'failed' then 'failed' else 'was canceled' end
                || ' (' || invoice.number || '): ' || coalesce(refund.failure_reason, 'Stripe gave no reason'),
              'high', app.firm_today(invoice.organization_id), 'refund_failed'
            );
            if new_task is not null then
              update public.invoice_refunds set task_id = new_task where id = refund.id returning * into refund;
            end if;
          end if;
        end if;
      end if;
    end if;
  elsif event_type = 'charge.refunded' then
    -- The charge's running total includes pending refunds and names no refund, so it moves
    -- nothing; the refund.* events do. It is kept as a check.
    outcome := 'unchanged';
    detail := case
      when p_amount_refunded_cents is null then 'refund total not given'
      when p_amount_refunded_cents > payment.amount_received_cents then 'refund total exceeds the amount received'
      when p_amount_refunded_cents = payment.refunded_cents then 'refund total matches'
      else 'refund total awaits refund events'
    end;
  elsif event_type in ('charge.dispute.created', 'charge.dispute.updated', 'charge.dispute.closed') then
    next_dispute := case
      when p_status in ('warning_needs_response', 'warning_under_review', 'warning_closed', 'needs_response', 'under_review', 'won', 'lost', 'prevented')
        then p_status::public.invoice_dispute_status
      else null
    end;
    select * into dispute from public.invoice_disputes where dispute_id = object_key for update;
    if next_dispute is null then
      outcome := 'unchanged';
      detail := 'dispute status not applied';
    elsif coalesce(p_amount_cents, 0) <= 0 or p_amount_cents > payment.amount_received_cents then
      outcome := 'rejected';
      detail := 'dispute amount is invalid';
    elsif dispute.id is null then
      if object_key !~ '^(du|dp)_[A-Za-z0-9]{6,250}$' then
        outcome := 'rejected';
        detail := 'dispute is invalid';
      else
        perform pg_advisory_xact_lock(hashtextextended('casevoya.dispute_number:' || payment.organization_id::text, 0));
        select coalesce(max(substring(d.number from 4)::integer), 0) + 1 into next_number
        from public.invoice_disputes d
        where d.organization_id = payment.organization_id;
        insert into public.invoice_disputes (
          organization_id, invoice_id, payment_id, number, dispute_id, charge_id, connected_account_id,
          amount_cents, currency, reason, status, evidence_due_by, closed_at, livemode, last_event_id, last_event_created
        ) values (
          payment.organization_id, payment.invoice_id, payment.id, 'DP-' || lpad(next_number::text, 4, '0'), object_key,
          case when btrim(coalesce(p_charge_id, '')) ~ '^(ch|py)_[A-Za-z0-9]{6,250}$' then btrim(p_charge_id) end,
          payment.connected_account_id, p_amount_cents, payment.currency,
          case when coalesce(p_reason, '') ~ '^[a-z_]{1,60}$' then p_reason end,
          next_dispute, p_evidence_due_by,
          case when app.dispute_status_rank(next_dispute) = 3 then clock_timestamp() end,
          false, event_key, p_event_created
        )
        returning * into dispute;
        outcome := 'applied';
        perform app.record_audit_event(
          invoice.organization_id, 'invoice.dispute_opened', 'public.invoice_disputes', dispute.id, 'success',
          jsonb_build_object('invoice_id', invoice.id, 'status', next_dispute, 'amount_cents', p_amount_cents)
        );
        -- New: the firm owner responds before Stripe's deadline (FIN-13), on the invoice's matter.
        if app.dispute_status_rank(next_dispute) < 3 then
          new_task := app.create_finance_task(
            invoice.organization_id, invoice.matter_id,
            'Respond to card dispute ' || dispute.number || ' on ' || invoice.number,
            'critical',
            case when p_evidence_due_by is not null then app.firm_local_date(invoice.organization_id, p_evidence_due_by) else app.firm_today(invoice.organization_id) end,
            'card_dispute'
          );
          if new_task is not null then
            update public.invoice_disputes set task_id = new_task where id = dispute.id returning * into dispute;
          end if;
        end if;
      end if;
    elsif dispute.payment_id <> payment.id then
      outcome := 'rejected';
      detail := 'dispute belongs to another payment';
    elsif app.dispute_status_rank(dispute.status) = 3 then
      outcome := 'unchanged';
      detail := 'dispute already closed';
    elsif app.dispute_status_rank(next_dispute) < app.dispute_status_rank(dispute.status)
       or (p_event_created is not null and dispute.last_event_created is not null and p_event_created < dispute.last_event_created) then
      outcome := 'unchanged';
      detail := 'older dispute event';
    else
      outcome := 'applied';
      update public.invoice_disputes
      set status = next_dispute,
          amount_cents = p_amount_cents,
          reason = case when coalesce(p_reason, '') ~ '^[a-z_]{1,60}$' then p_reason else reason end,
          evidence_due_by = coalesce(p_evidence_due_by, evidence_due_by),
          closed_at = case when app.dispute_status_rank(next_dispute) = 3 then clock_timestamp() else closed_at end,
          last_event_id = event_key,
          last_event_created = coalesce(p_event_created, last_event_created)
      where id = dispute.id
      returning * into dispute;
      if app.dispute_status_rank(next_dispute) = 3 then
        perform app.record_audit_event(
          invoice.organization_id, 'invoice.dispute_closed', 'public.invoice_disputes', dispute.id, 'success',
          jsonb_build_object('invoice_id', invoice.id, 'status', next_dispute)
        );
      end if;
    end if;
  else
    outcome := 'unchanged';
    detail := 'event type not applied';
  end if;

  insert into public.invoice_reversal_events (
    organization_id, invoice_id, payment_id, refund_id, dispute_id, webhook_inbox_id, connected_account_id,
    event_id, event_type, object_id, amount_cents, currency, outcome, detail, refund_status, dispute_status, invoice_status
  ) values (
    payment.organization_id, payment.invoice_id, payment.id, refund.id, dispute.id, inbox_id, account_key,
    event_key, event_type, nullif(left(object_key, 255), ''), p_amount_cents, nullif(currency, ''), outcome, detail,
    refund.status, dispute.status, invoice.status
  )
  on conflict (provider, connected_account_id, event_id) do nothing;

  update public.webhook_inbox
  set status = case when outcome = 'rejected' then 'failed'::public.webhook_inbox_status else 'processed'::public.webhook_inbox_status end,
      processed_at = clock_timestamp()
  where id = inbox_id;

  return jsonb_build_object(
    'outcome', outcome,
    'detail', detail,
    'refund_status', refund.status,
    'dispute_status', dispute.status,
    'invoice_status', invoice.status
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- FIN-13: overpayments become a client credit; staff refund it or apply it
-- ---------------------------------------------------------------------------

create table public.client_credits (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  matter_id uuid not null,
  source_invoice_id uuid not null unique,
  number text not null check (number ~ '^CR-[0-9]{4,9}$'),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  opened_cents bigint not null check (opened_cents > 0 and opened_cents <= 99999999999),
  status text not null default 'open' check (status in ('open', 'settled')),
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id),
  unique (organization_id, number),
  check (status = 'open' or settled_at is not null),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id),
  foreign key (source_invoice_id, organization_id) references public.invoices (id, organization_id)
);
comment on table public.client_credits is
  'Money the firm holds on an invoice beyond what it asks for (overpayment, credit note on a paid invoice, payment after a void). One per source invoice; what is left is computed from the invoice (app.client_credit_available_cents) (FIN-13).';

create index client_credits_matter_org_fk_idx on public.client_credits (matter_id, organization_id);
create index client_credits_source_org_fk_idx on public.client_credits (source_invoice_id, organization_id);
create index client_credits_org_created_idx on public.client_credits (organization_id, created_at desc);
create index client_credits_created_by_idx on public.client_credits (created_by);

create table public.client_credit_allocations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  credit_id uuid not null,
  kind text not null check (kind in ('invoice', 'card_refund', 'bank_refund')),
  target_invoice_id uuid,
  refund_id uuid,
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 99999999999),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  bank_method text check (bank_method is null or bank_method in ('e_transfer', 'cheque', 'wire')),
  bank_reference text check (bank_reference is null or length(btrim(bank_reference)) between 1 and 120),
  refunded_on date,
  idempotency_key text check (idempotency_key is null or length(idempotency_key) between 8 and 180),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  unique (id, organization_id),
  unique (organization_id, idempotency_key),
  check (
    (kind = 'invoice' and target_invoice_id is not null and refund_id is null and bank_method is null and bank_reference is null and refunded_on is null)
    or (kind = 'card_refund' and refund_id is not null and target_invoice_id is null and bank_method is null and bank_reference is null and refunded_on is null)
    or (kind = 'bank_refund' and target_invoice_id is null and refund_id is null and bank_method is not null and bank_reference is not null and refunded_on is not null)
  ),
  foreign key (credit_id, organization_id) references public.client_credits (id, organization_id),
  foreign key (target_invoice_id, organization_id) references public.invoices (id, organization_id),
  foreign key (refund_id, organization_id) references public.invoice_refunds (id, organization_id)
);
comment on table public.client_credit_allocations is
  'Append-only links from a client credit to where its money went: another invoice of the same client, a card refund, or a bank refund made outside Casevoya (FIN-13).';

create unique index client_credit_allocations_refund_key on public.client_credit_allocations (refund_id) where refund_id is not null;
create index client_credit_allocations_credit_org_fk_idx on public.client_credit_allocations (credit_id, organization_id);
create index client_credit_allocations_target_org_fk_idx on public.client_credit_allocations (target_invoice_id, organization_id);
create index client_credit_allocations_refund_org_fk_idx on public.client_credit_allocations (refund_id, organization_id);
create index client_credit_allocations_created_by_idx on public.client_credit_allocations (created_by);

create trigger client_credits_touch before update on public.client_credits
  for each row execute function app.touch_row();
create trigger client_credits_stamp before insert on public.client_credits
  for each row execute function app.stamp_created_by();
create trigger client_credits_audit after insert or update or delete on public.client_credits
  for each row execute function app.audit_row_change();
create trigger client_credits_no_delete before delete on public.client_credits
  for each row execute function app.reject_governed_delete();

create trigger client_credit_allocations_stamp before insert on public.client_credit_allocations
  for each row execute function app.stamp_created_by();
create trigger client_credit_allocations_audit after insert or update or delete on public.client_credit_allocations
  for each row execute function app.audit_row_change();
create trigger client_credit_allocations_no_change before update or delete on public.client_credit_allocations
  for each row execute function app.reject_payment_event_change();

-- What an invoice holds beyond what it asks for: kept payments plus credits over the amount; all
-- of what was kept on a voided invoice. Never below zero; a draft holds nothing.
create function app.invoice_overpaid_cents(p_invoice_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when invoice.status = 'draft' then 0
    when invoice.status = 'voided' then greatest(invoice.paid_cents - invoice.refunded_cents, 0)
    else greatest(invoice.paid_cents - invoice.refunded_cents + invoice.credited_cents - invoice.amount_cents, 0)
  end::bigint
  from public.invoices invoice
  where invoice.id = p_invoice_id;
$$;
revoke all on function app.invoice_overpaid_cents(uuid) from public, anon;
grant execute on function app.invoice_overpaid_cents(uuid) to authenticated, service_role;

-- Card refunds of the invoice's payments still pending at Stripe.
create function app.invoice_pending_card_refunds_cents(p_invoice_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(refund.amount_cents), 0)::bigint
  from public.invoice_refunds refund
  where refund.invoice_id = p_invoice_id
    and refund.status in ('pending', 'requires_action');
$$;
revoke all on function app.invoice_pending_card_refunds_cents(uuid) from public, anon;
grant execute on function app.invoice_pending_card_refunds_cents(uuid) to authenticated, service_role;

-- What a credit can still be refunded or applied: the source invoice's overpayment less card
-- refunds still pending at Stripe.
create function app.client_credit_available_cents(p_credit_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(app.invoice_overpaid_cents(credit.source_invoice_id) - app.invoice_pending_card_refunds_cents(credit.source_invoice_id), 0)::bigint
  from public.client_credits credit
  where credit.id = p_credit_id;
$$;
revoke all on function app.client_credit_available_cents(uuid) from public, anon;
grant execute on function app.client_credit_available_cents(uuid) to authenticated, service_role;

-- Opens the invoice's credit when it first holds more than it asks for, reopens it if that
-- happens again, and settles it when nothing is left. Runs for every writer of invoices.
create function app.sync_client_credit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  excess bigint;
  credit public.client_credits%rowtype;
  next_number integer;
begin
  excess := app.invoice_overpaid_cents(new.id);
  select * into credit from public.client_credits where source_invoice_id = new.id for update;
  if coalesce(excess, 0) > 0 then
    if credit.id is null then
      perform pg_advisory_xact_lock(hashtextextended('casevoya.client_credit_number:' || new.organization_id::text, 0));
      select coalesce(max(substring(c.number from 4)::integer), 0) + 1 into next_number
      from public.client_credits c
      where c.organization_id = new.organization_id;
      insert into public.client_credits (organization_id, matter_id, source_invoice_id, number, currency, opened_cents)
      values (new.organization_id, new.matter_id, new.id, 'CR-' || lpad(next_number::text, 4, '0'), new.currency, excess)
      returning * into credit;
      perform app.record_audit_event(
        new.organization_id, 'invoice.client_credit_opened', 'public.client_credits', credit.id, 'success',
        jsonb_build_object('invoice_id', new.id, 'amount_cents', excess, 'currency', new.currency)
      );
    elsif credit.status = 'settled' then
      update public.client_credits set status = 'open', settled_at = null where id = credit.id;
    end if;
  elsif credit.id is not null and credit.status = 'open' then
    update public.client_credits set status = 'settled', settled_at = clock_timestamp() where id = credit.id;
  end if;
  return null;
end;
$$;
revoke all on function app.sync_client_credit() from public, anon, authenticated;

create trigger invoices_client_credit after insert or update of paid_cents, refunded_cents, credited_cents, status on public.invoices
  for each row execute function app.sync_client_credit();

-- Two invoices belong to the same client: the same matter, or matters sharing an applicant.
create function app.same_client_invoices(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.invoices a
    join public.invoices b on b.id = p_b and b.organization_id = a.organization_id
    where a.id = p_a
      and (
        a.matter_id = b.matter_id
        or exists (
          select 1
          from public.matter_participants pa
          join public.matter_participants pb
            on pb.person_id = pa.person_id
           and pb.organization_id = pa.organization_id
          where pa.matter_id = a.matter_id
            and pb.matter_id = b.matter_id
            and pa.role = 'applicant'
            and pb.role = 'applicant'
            and pa.person_id is not null
        )
      )
  );
$$;
revoke all on function app.same_client_invoices(uuid, uuid) from public, anon;
grant execute on function app.same_client_invoices(uuid, uuid) to authenticated, service_role;

-- Billing access to the credit's matter and a recent step-up. Returns the credit, locked.
create function app.require_client_credit_access(p_credit_id uuid)
returns public.client_credits
language plpgsql
security definer
set search_path = ''
as $$
declare
  credit public.client_credits%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'sign in is required' using errcode = '42501';
  end if;
  select * into credit from public.client_credits where id = p_credit_id for update;
  if credit.id is null or app.can_read_matter_billing(credit.matter_id) is distinct from true then
    raise exception 'billing access denied' using errcode = '42501';
  end if;
  if app.mfa_step_up_satisfied() is distinct from true then
    raise exception 'step-up is required' using errcode = '42501';
  end if;
  return credit;
end;
$$;
revoke all on function app.require_client_credit_access(uuid) from public, anon;
grant execute on function app.require_client_credit_access(uuid) to authenticated;

-- Applies part or all of a credit to another open invoice of the same client: the amount moves
-- from the source invoice to the target, and the link is kept. Idempotent on the caller's key.
create function app.apply_client_credit(p_credit_id uuid, p_target_invoice_id uuid, p_amount_cents bigint, p_idempotency_key text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  credit public.client_credits%rowtype;
  source public.invoices%rowtype;
  target public.invoices%rowtype;
  existing public.client_credit_allocations%rowtype;
  op_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  rid uuid;
begin
  credit := app.require_client_credit_access(p_credit_id);
  if op_key is null or length(op_key) not between 8 and 180 then
    raise exception 'idempotency key is invalid' using errcode = '22023';
  end if;
  select * into existing from public.client_credit_allocations where organization_id = credit.organization_id and idempotency_key = op_key;
  if existing.id is not null then
    if existing.credit_id <> credit.id or existing.kind <> 'invoice' or existing.target_invoice_id is distinct from p_target_invoice_id then
      raise exception 'idempotency key was used for another allocation' using errcode = '23505';
    end if;
    return existing.id;
  end if;
  if p_target_invoice_id = credit.source_invoice_id then
    raise exception 'choose another invoice' using errcode = '22023';
  end if;
  -- Both invoices locked in a fixed order.
  perform 1 from public.invoices where id in (credit.source_invoice_id, p_target_invoice_id) order by id for update;
  select * into source from public.invoices where id = credit.source_invoice_id;
  select * into target from public.invoices where id = p_target_invoice_id;
  if target.id is null or target.organization_id <> credit.organization_id
     or app.can_read_matter_billing(target.matter_id) is distinct from true then
    raise exception 'billing access denied' using errcode = '42501';
  end if;
  if not app.same_client_invoices(source.id, target.id) then
    raise exception 'a credit applies only to the same client''s invoices' using errcode = '22023';
  end if;
  if target.status not in ('issued', 'partially_paid') then
    raise exception 'that invoice is not open' using errcode = '22023';
  end if;
  if target.currency <> credit.currency then
    raise exception 'that invoice is in another currency' using errcode = '22023';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'amount must be positive' using errcode = '22023';
  end if;
  if p_amount_cents > app.client_credit_available_cents(credit.id) then
    raise exception 'amount is more than the credit available' using errcode = '22023';
  end if;
  if p_amount_cents > target.amount_cents - target.paid_cents - target.credited_cents then
    raise exception 'amount is more than that invoice still owes' using errcode = '22023';
  end if;

  update public.invoices
  set paid_cents = paid_cents - p_amount_cents,
      status = app.invoice_settled_status(status, amount_cents, paid_cents - p_amount_cents, credited_cents, refunded_cents)
  where id = source.id;
  update public.invoices
  set paid_cents = paid_cents + p_amount_cents,
      status = app.invoice_settled_status(status, amount_cents, paid_cents + p_amount_cents, credited_cents, refunded_cents)
  where id = target.id;

  insert into public.client_credit_allocations (organization_id, credit_id, kind, target_invoice_id, amount_cents, currency, idempotency_key)
  values (credit.organization_id, credit.id, 'invoice', target.id, p_amount_cents, credit.currency, op_key)
  returning id into rid;
  perform app.record_audit_event(
    credit.organization_id, 'invoice.client_credit_applied', 'public.client_credits', credit.id, 'success',
    jsonb_build_object('allocation_id', rid, 'source_invoice_id', source.id, 'target_invoice_id', target.id, 'amount_cents', p_amount_cents, 'currency', credit.currency)
  );
  return rid;
end;
$$;
revoke all on function app.apply_client_credit(uuid, uuid, bigint, text) from public, anon;
grant execute on function app.apply_client_credit(uuid, uuid, bigint, text) to authenticated;

-- The card payment a credit can be refunded to: the source invoice's received card payment with
-- the most left to refund, on the firm's own account. Null fields when there is none.
create function app.client_credit_refund_context(p_credit_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  credit public.client_credits%rowtype;
  firm_account text;
  best_id uuid;
  best_refundable bigint;
begin
  credit := app.require_client_credit_access(p_credit_id);
  select fpa.account_id into firm_account from public.firm_payment_accounts fpa where fpa.organization_id = credit.organization_id;
  select payment.id, app.payment_refundable_cents(payment.id) into best_id, best_refundable
  from public.invoice_payments payment
  where payment.invoice_id = credit.source_invoice_id
    and payment.status = 'succeeded'
    and payment.amount_received_cents > 0
    and payment.connected_account_id = firm_account
  order by app.payment_refundable_cents(payment.id) desc, payment.created_at
  limit 1;
  return jsonb_build_object(
    'credit_id', credit.id,
    'number', credit.number,
    'currency', credit.currency,
    'available', app.client_credit_available_cents(credit.id),
    'pending_card_refunds', app.invoice_pending_card_refunds_cents(credit.source_invoice_id),
    'payment_id', best_id,
    'refundable', coalesce(best_refundable, 0)
  );
end;
$$;
revoke all on function app.client_credit_refund_context(uuid) from public, anon;
grant execute on function app.client_credit_refund_context(uuid) to authenticated;

-- Links a card refund (already recorded by app.record_invoice_refund) to the credit it returns.
create function app.link_client_credit_refund(p_credit_id uuid, p_refund_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  credit public.client_credits%rowtype;
  refund public.invoice_refunds%rowtype;
  existing uuid;
  rid uuid;
begin
  credit := app.require_client_credit_access(p_credit_id);
  select * into refund from public.invoice_refunds where id = p_refund_id;
  if refund.id is null or refund.invoice_id <> credit.source_invoice_id then
    raise exception 'that refund is not from this credit''s invoice' using errcode = '22023';
  end if;
  select allocation.id into existing from public.client_credit_allocations allocation where allocation.refund_id = refund.id;
  if existing is not null then
    return existing;
  end if;
  insert into public.client_credit_allocations (organization_id, credit_id, kind, refund_id, amount_cents, currency)
  values (credit.organization_id, credit.id, 'card_refund', refund.id, refund.amount_cents, refund.currency)
  returning id into rid;
  perform app.record_audit_event(
    credit.organization_id, 'invoice.client_credit_card_refund', 'public.client_credits', credit.id, 'success',
    jsonb_build_object('allocation_id', rid, 'refund_id', refund.id, 'amount_cents', refund.amount_cents, 'currency', refund.currency)
  );
  return rid;
end;
$$;
revoke all on function app.link_client_credit_refund(uuid, uuid) from public, anon;
grant execute on function app.link_client_credit_refund(uuid, uuid) to authenticated;

-- Records a refund of the credit the firm made by bank, outside Casevoya. Refused while a card
-- refund of that invoice is still pending at Stripe: the client must not be refunded twice.
create function app.record_client_credit_bank_refund(
  p_credit_id uuid,
  p_amount_cents bigint,
  p_method text,
  p_reference text,
  p_refunded_on date,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  credit public.client_credits%rowtype;
  existing public.client_credit_allocations%rowtype;
  op_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  bank_ref text := nullif(btrim(coalesce(p_reference, '')), '');
  rid uuid;
begin
  credit := app.require_client_credit_access(p_credit_id);
  if op_key is null or length(op_key) not between 8 and 180 then
    raise exception 'idempotency key is invalid' using errcode = '22023';
  end if;
  select * into existing from public.client_credit_allocations where organization_id = credit.organization_id and idempotency_key = op_key;
  if existing.id is not null then
    if existing.credit_id <> credit.id or existing.kind <> 'bank_refund' then
      raise exception 'idempotency key was used for another allocation' using errcode = '23505';
    end if;
    return existing.id;
  end if;
  perform 1 from public.invoices where id = credit.source_invoice_id for update;
  if app.invoice_pending_card_refunds_cents(credit.source_invoice_id) > 0 then
    raise exception 'a card refund of this invoice is still pending at Stripe' using errcode = '22023';
  end if;
  if p_method is null or p_method not in ('e_transfer', 'cheque', 'wire') then
    raise exception 'choose how the money was returned' using errcode = '22023';
  end if;
  if bank_ref is null or length(bank_ref) > 120 then
    raise exception 'a bank reference is required' using errcode = '22023';
  end if;
  if p_refunded_on is null or p_refunded_on > app.firm_today(credit.organization_id) then
    raise exception 'the refund date can''t be in the future' using errcode = '22023';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'amount must be positive' using errcode = '22023';
  end if;
  if p_amount_cents > app.client_credit_available_cents(credit.id) then
    raise exception 'amount is more than the credit available' using errcode = '22023';
  end if;

  update public.invoices
  set paid_cents = paid_cents - p_amount_cents,
      status = app.invoice_settled_status(status, amount_cents, paid_cents - p_amount_cents, credited_cents, refunded_cents)
  where id = credit.source_invoice_id;

  insert into public.client_credit_allocations (
    organization_id, credit_id, kind, amount_cents, currency, bank_method, bank_reference, refunded_on, idempotency_key
  ) values (
    credit.organization_id, credit.id, 'bank_refund', p_amount_cents, credit.currency, p_method, bank_ref, p_refunded_on, op_key
  )
  returning id into rid;
  perform app.record_audit_event(
    credit.organization_id, 'invoice.client_credit_bank_refund', 'public.client_credits', credit.id, 'success',
    jsonb_build_object('allocation_id', rid, 'amount_cents', p_amount_cents, 'currency', credit.currency, 'method', p_method)
  );
  return rid;
end;
$$;
revoke all on function app.record_client_credit_bank_refund(uuid, bigint, text, text, date, text) from public, anon;
grant execute on function app.record_client_credit_bank_refund(uuid, bigint, text, text, date, text) to authenticated;

-- Public wrappers (security invoker; the app functions check the caller).
create function public.client_credit_available_cents(p_credit_id uuid)
returns bigint language sql stable security invoker set search_path = ''
as $$
  select app.client_credit_available_cents(credit.id)
  from public.client_credits credit
  where credit.id = p_credit_id;
$$;

create function public.apply_client_credit(p_credit_id uuid, p_target_invoice_id uuid, p_amount_cents bigint, p_idempotency_key text)
returns uuid language sql security invoker set search_path = ''
as $$ select app.apply_client_credit(p_credit_id, p_target_invoice_id, p_amount_cents, p_idempotency_key); $$;

create function public.client_credit_refund_context(p_credit_id uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select app.client_credit_refund_context(p_credit_id); $$;

create function public.link_client_credit_refund(p_credit_id uuid, p_refund_id uuid)
returns uuid language sql security invoker set search_path = ''
as $$ select app.link_client_credit_refund(p_credit_id, p_refund_id); $$;

create function public.record_client_credit_bank_refund(
  p_credit_id uuid, p_amount_cents bigint, p_method text, p_reference text, p_refunded_on date, p_idempotency_key text
) returns uuid language sql security invoker set search_path = ''
as $$ select app.record_client_credit_bank_refund(p_credit_id, p_amount_cents, p_method, p_reference, p_refunded_on, p_idempotency_key); $$;

revoke all on function public.client_credit_available_cents(uuid) from public, anon;
revoke all on function public.apply_client_credit(uuid, uuid, bigint, text) from public, anon;
revoke all on function public.client_credit_refund_context(uuid) from public, anon;
revoke all on function public.link_client_credit_refund(uuid, uuid) from public, anon;
revoke all on function public.record_client_credit_bank_refund(uuid, bigint, text, text, date, text) from public, anon;
grant execute on function public.client_credit_available_cents(uuid) to authenticated;
grant execute on function public.apply_client_credit(uuid, uuid, bigint, text) to authenticated;
grant execute on function public.client_credit_refund_context(uuid) to authenticated;
grant execute on function public.link_client_credit_refund(uuid, uuid) to authenticated;
grant execute on function public.record_client_credit_bank_refund(uuid, bigint, text, text, date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Table privileges and row-level security: billing staff only
-- ---------------------------------------------------------------------------

revoke all on table public.invoice_dispute_evidence from anon, authenticated, service_role;
revoke all on table public.client_credits from anon, authenticated, service_role;
revoke all on table public.client_credit_allocations from anon, authenticated, service_role;
grant select on table public.invoice_dispute_evidence to authenticated, service_role;
grant select on table public.client_credits to authenticated, service_role;
grant select on table public.client_credit_allocations to authenticated, service_role;

alter table public.invoice_dispute_evidence enable row level security;
alter table public.invoice_dispute_evidence force row level security;
alter table public.client_credits enable row level security;
alter table public.client_credits force row level security;
alter table public.client_credit_allocations enable row level security;
alter table public.client_credit_allocations force row level security;

create policy invoice_dispute_evidence_select on public.invoice_dispute_evidence
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and exists (
      select 1
      from public.invoice_disputes dispute
      join public.invoices invoice on invoice.id = dispute.invoice_id
      where dispute.id = invoice_dispute_evidence.dispute_id
        and (select app.can_read_matter_billing(invoice.matter_id))
    )
  );

create policy client_credits_select on public.client_credits
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.can_read_matter_billing(matter_id))
  );

create policy client_credit_allocations_select on public.client_credit_allocations
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and exists (
      select 1 from public.client_credits credit
      where credit.id = client_credit_allocations.credit_id
        and (select app.can_read_matter_billing(credit.matter_id))
    )
  );
