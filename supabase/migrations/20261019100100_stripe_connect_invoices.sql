-- Earned-fee invoices paid by card through the firm's Stripe connected account
-- (FIN-02, FIN-05, FIN-07, FIN-08). TEST MODE ONLY.
--
-- Money state lives here; Stripe is the processor.
--   firm_payment_accounts  one Stripe connected account per firm (Accounts v2, acct_...).
--                          livemode is constrained to false: a live account cannot be stored.
--   invoices               firm-unique number, matter, amount in integer minor units, ISO
--                          currency (CAD only for now), due date. Status is derived from
--                          payments, never typed (FIN-07).
--   invoice_payments       one row per PaymentIntent (a direct charge on the connected account).
--   invoice_payment_events append-only record of every webhook event applied (or refused)
--                          for a payment. Unique (provider, connected account, event id).
--
-- Writers are SECURITY DEFINER functions. No API role has insert/update/delete on these tables.
-- Staff with billing access (firm owner, assigned finance user) read invoices; a client reads the
-- invoices on matters where they are a party. Webhook events are applied only by service_role
-- through app.apply_stripe_payment_event, which dedupes through public.webhook_inbox.
-- Advance payments (client account money, FIN-03) are not card-collectable and are not here.
-- Additive only.

create table public.firm_payment_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations (id),
  provider text not null default 'stripe' check (provider = 'stripe'),
  account_id text not null unique check (account_id ~ '^acct_[A-Za-z0-9]{6,250}$'),
  livemode boolean not null default false check (livemode is false),
  card_payments_status text not null default 'pending'
    check (card_payments_status in ('pending', 'active', 'restricted', 'unsupported')),
  payouts_status text not null default 'pending'
    check (payouts_status in ('pending', 'active', 'restricted', 'unsupported')),
  requirements_due integer not null default 0 check (requirements_due >= 0),
  status_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1)
);
comment on table public.firm_payment_accounts is
  'The firm''s Stripe connected account (test mode only; livemode must be false). Statuses are a cached copy of Stripe''s.';

create index firm_payment_accounts_created_by_idx on public.firm_payment_accounts (created_by);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  matter_id uuid not null,
  number text not null check (number ~ '^INV-[0-9]{4,9}$'),
  description text not null check (length(btrim(description)) between 1 and 500),
  fee_category text not null default 'professional_fee'
    check (fee_category in ('professional_fee', 'disbursement', 'consultation_fee')),
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 99999999999),
  currency text not null default 'CAD' check (currency ~ '^[A-Z]{3}$'),
  paid_cents bigint not null default 0 check (paid_cents >= 0),
  status public.invoice_status not null default 'issued',
  issued_on date,
  due_on date not null,
  is_sample boolean not null default false,
  idempotency_key text not null check (length(idempotency_key) between 8 and 180),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id),
  unique (organization_id, number),
  unique (organization_id, idempotency_key),
  check (status = 'draft' or issued_on is not null),
  check (issued_on is null or due_on >= issued_on),
  check (status <> 'paid' or paid_cents >= amount_cents),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id)
);
comment on table public.invoices is
  'Earned-fee invoices. Integer minor units and an ISO currency. Status comes from payments (FIN-07); Overdue is derived from due_on.';

create index invoices_matter_org_fk_idx on public.invoices (matter_id, organization_id);
create index invoices_org_created_idx on public.invoices (organization_id, created_at desc);
create index invoices_created_by_idx on public.invoices (created_by);

create table public.invoice_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  invoice_id uuid not null,
  provider text not null default 'stripe' check (provider = 'stripe'),
  payment_intent_id text not null unique check (payment_intent_id ~ '^pi_[A-Za-z0-9]{6,250}$'),
  connected_account_id text not null check (connected_account_id ~ '^acct_[A-Za-z0-9]{6,250}$'),
  amount_cents bigint not null check (amount_cents > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  application_fee_cents bigint not null default 0 check (application_fee_cents >= 0),
  amount_received_cents bigint not null default 0 check (amount_received_cents >= 0),
  status public.invoice_payment_status not null default 'requires_payment',
  livemode boolean not null default false check (livemode is false),
  last_event_id text,
  succeeded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id),
  check (application_fee_cents <= amount_cents),
  check (amount_received_cents <= amount_cents),
  foreign key (invoice_id, organization_id) references public.invoices (id, organization_id)
);
comment on table public.invoice_payments is
  'One Stripe PaymentIntent (direct charge on the firm''s connected account) per row. Status moves only from verified webhook events.';

create index invoice_payments_invoice_org_fk_idx on public.invoice_payments (invoice_id, organization_id);
create index invoice_payments_org_fk_idx on public.invoice_payments (organization_id);
create index invoice_payments_created_by_idx on public.invoice_payments (created_by);

create table public.invoice_payment_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  invoice_id uuid not null,
  payment_id uuid not null,
  webhook_inbox_id uuid not null references public.webhook_inbox (id),
  provider text not null default 'stripe' check (provider = 'stripe'),
  connected_account_id text not null,
  event_id text not null check (length(event_id) between 1 and 200),
  event_type text not null check (length(event_type) between 1 and 120),
  amount_cents bigint,
  currency text,
  outcome text not null check (outcome in ('applied', 'unchanged', 'rejected')),
  detail text check (detail is null or length(detail) <= 300),
  payment_status public.invoice_payment_status not null,
  invoice_status public.invoice_status not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (provider, connected_account_id, event_id),
  foreign key (invoice_id, organization_id) references public.invoices (id, organization_id),
  foreign key (payment_id, organization_id) references public.invoice_payments (id, organization_id)
);
comment on table public.invoice_payment_events is
  'Append-only. Every processor event applied to a payment, with the resulting states. Unique (provider, connected account, event id) (FIN-08).';

create index invoice_payment_events_org_fk_idx on public.invoice_payment_events (organization_id, created_at desc);
create index invoice_payment_events_invoice_org_fk_idx on public.invoice_payment_events (invoice_id, organization_id);
create index invoice_payment_events_payment_org_fk_idx on public.invoice_payment_events (payment_id, organization_id);
create index invoice_payment_events_inbox_fk_idx on public.invoice_payment_events (webhook_inbox_id);

create function app.reject_payment_event_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'payment events are append-only' using errcode = '42501';
end;
$$;
revoke all on function app.reject_payment_event_change() from public;

create trigger firm_payment_accounts_touch before update on public.firm_payment_accounts
  for each row execute function app.touch_row();
create trigger firm_payment_accounts_stamp before insert on public.firm_payment_accounts
  for each row execute function app.stamp_created_by();
create trigger firm_payment_accounts_audit after insert or update or delete on public.firm_payment_accounts
  for each row execute function app.audit_row_change();
create trigger firm_payment_accounts_no_delete before delete on public.firm_payment_accounts
  for each row execute function app.reject_governed_delete();

create trigger invoices_touch before update on public.invoices
  for each row execute function app.touch_row();
create trigger invoices_stamp before insert on public.invoices
  for each row execute function app.stamp_created_by();
create trigger invoices_audit after insert or update or delete on public.invoices
  for each row execute function app.audit_row_change();
create trigger invoices_no_delete before delete on public.invoices
  for each row execute function app.reject_governed_delete();

create trigger invoice_payments_touch before update on public.invoice_payments
  for each row execute function app.touch_row();
create trigger invoice_payments_stamp before insert on public.invoice_payments
  for each row execute function app.stamp_created_by();
create trigger invoice_payments_audit after insert or update or delete on public.invoice_payments
  for each row execute function app.audit_row_change();
create trigger invoice_payments_no_delete before delete on public.invoice_payments
  for each row execute function app.reject_governed_delete();

create trigger invoice_payment_events_no_change before update or delete on public.invoice_payment_events
  for each row execute function app.reject_payment_event_change();

-- ---------------------------------------------------------------------------
-- Read helpers
-- ---------------------------------------------------------------------------

-- True when the signed-in person is a party (applicant, sponsor, dependant, ...) on the matter.
create function app.is_matter_party(p_matter_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
     and exists (
       select 1
       from public.matter_participants party
       join public.persons person
         on person.id = party.person_id
        and person.organization_id = party.organization_id
       where party.matter_id = p_matter_id
         and person.user_id = (select auth.uid())
     );
$$;
revoke all on function app.is_matter_party(uuid) from public;
grant execute on function app.is_matter_party(uuid) to authenticated, service_role;

create function app.can_read_invoice(p_invoice_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.invoices invoice
    where invoice.id = p_invoice_id
      and (
        app.can_read_matter_billing(invoice.matter_id)
        or (invoice.status <> 'draft' and app.is_matter_party(invoice.matter_id))
      )
  );
$$;
revoke all on function app.can_read_invoice(uuid) from public;
grant execute on function app.can_read_invoice(uuid) to authenticated, service_role;

-- Staff who see the firm's billing (owner, or any finance user) see the connected account row.
create function app.can_read_firm_payment_account(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.in_active_org(p_org)
     and app.staff_mfa_satisfied()
     and app.has_org_role(p_org, array['firm_owner', 'finance_user']::public.org_role[]);
$$;
revoke all on function app.can_read_firm_payment_account(uuid) from public;
grant execute on function app.can_read_firm_payment_account(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Connected account (firm owner with a recent step-up)
-- ---------------------------------------------------------------------------

-- Authorizes Stripe account work for the firm and returns its account id (null before one exists).
create function app.firm_payment_account_for_owner(p_org uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  account text;
begin
  perform app.require_firm_owner_step_up(p_org);
  select fpa.account_id into account
  from public.firm_payment_accounts fpa
  where fpa.organization_id = p_org;
  return account;
end;
$$;
revoke all on function app.firm_payment_account_for_owner(uuid) from public;

create function app.record_firm_payment_account(p_org uuid, p_account_id text, p_livemode boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.firm_payment_accounts%rowtype;
  rid uuid;
  account text := btrim(coalesce(p_account_id, ''));
begin
  perform app.require_firm_owner_step_up(p_org);
  if p_livemode is distinct from false then
    raise exception 'only a test-mode Stripe account can be connected' using errcode = '22023';
  end if;
  if account !~ '^acct_[A-Za-z0-9]{6,250}$' then
    raise exception 'stripe account id is invalid' using errcode = '22023';
  end if;
  select * into existing from public.firm_payment_accounts where organization_id = p_org for update;
  if existing.id is not null then
    if existing.account_id <> account then
      raise exception 'this firm already has a Stripe account' using errcode = '23505';
    end if;
    return existing.id;
  end if;
  insert into public.firm_payment_accounts (organization_id, account_id, livemode)
  values (p_org, account, false)
  returning id into rid;
  perform app.record_audit_event(
    p_org, 'finance.payment_account_connected', 'public.firm_payment_accounts', rid, 'success',
    jsonb_build_object('provider', 'stripe', 'livemode', false)
  );
  return rid;
end;
$$;
revoke all on function app.record_firm_payment_account(uuid, text, boolean) from public;

-- The owner (aal2, no step-up needed) refreshes the cached capability statuses read from Stripe.
create function app.sync_firm_payment_account(
  p_org uuid,
  p_account_id text,
  p_card_payments_status text,
  p_payouts_status text,
  p_requirements_due integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  allowed text[] := array['pending', 'active', 'restricted', 'unsupported'];
begin
  perform app.require_active_staff(p_org, array['firm_owner']::public.org_role[], false);
  if not (coalesce(p_card_payments_status, '') = any (allowed)) or not (coalesce(p_payouts_status, '') = any (allowed)) then
    raise exception 'unknown capability status' using errcode = '22023';
  end if;
  update public.firm_payment_accounts
  set card_payments_status = p_card_payments_status,
      payouts_status = p_payouts_status,
      requirements_due = greatest(coalesce(p_requirements_due, 0), 0),
      status_checked_at = now()
  where organization_id = p_org
    and account_id = btrim(coalesce(p_account_id, ''))
    and (
      card_payments_status is distinct from p_card_payments_status
      or payouts_status is distinct from p_payouts_status
      or requirements_due is distinct from greatest(coalesce(p_requirements_due, 0), 0)
      or status_checked_at is null
      or status_checked_at < now() - interval '1 hour'
    );
end;
$$;
revoke all on function app.sync_firm_payment_account(uuid, text, text, text, integer) from public;

-- ---------------------------------------------------------------------------
-- Invoices (billing staff)
-- ---------------------------------------------------------------------------

create function app.create_invoice(
  p_matter_id uuid,
  p_description text,
  p_amount_cents bigint,
  p_currency text,
  p_due_on date,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  matter public.matters%rowtype;
  key text := btrim(coalesce(p_idempotency_key, ''));
  currency text := upper(btrim(coalesce(p_currency, 'CAD')));
  existing uuid;
  next_number integer;
  today date;
  zone text;
  rid uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'sign in is required' using errcode = '42501';
  end if;
  select * into matter from public.matters where id = p_matter_id;
  if matter.id is null or app.can_perform_billing(matter.id, 'issue_invoice') is distinct from true then
    raise exception 'billing access denied' using errcode = '42501';
  end if;
  if length(key) not between 8 and 180 then
    raise exception 'idempotency key is required' using errcode = '22023';
  end if;
  select invoice.id into existing
  from public.invoices invoice
  where invoice.organization_id = matter.organization_id
    and invoice.idempotency_key = key;
  if existing is not null then
    return existing;
  end if;
  if app.sample_mode_blocks_real(matter.organization_id, matter.is_sample) then
    raise exception 'this firm is in sample mode; only sample matters take invoices' using errcode = '42501';
  end if;
  if p_description is null or length(btrim(p_description)) not between 1 and 500 then
    raise exception 'invoice description is required' using errcode = '22023';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 or p_amount_cents > 99999999999 then
    raise exception 'invoice amount must be positive' using errcode = '22023';
  end if;
  if currency <> 'CAD' then
    raise exception 'only CAD invoices are supported' using errcode = '22023';
  end if;
  select org.timezone into zone from public.organizations org where org.id = matter.organization_id;
  begin
    today := (statement_timestamp() at time zone coalesce(nullif(btrim(zone), ''), 'America/Toronto'))::date;
  exception when others then
    today := (statement_timestamp() at time zone 'America/Toronto')::date;
  end;
  if p_due_on is null or p_due_on < today then
    raise exception 'due date must be today or later' using errcode = '22023';
  end if;

  -- Firm-unique sequential numbers: one writer at a time per firm.
  perform pg_advisory_xact_lock(hashtextextended('casevoya.invoice_number:' || matter.organization_id::text, 0));
  select coalesce(max(substring(invoice.number from 5)::integer), 0) + 1 into next_number
  from public.invoices invoice
  where invoice.organization_id = matter.organization_id;

  insert into public.invoices (
    organization_id, matter_id, number, description, amount_cents, currency,
    status, issued_on, due_on, is_sample, idempotency_key
  ) values (
    matter.organization_id,
    matter.id,
    'INV-' || lpad(next_number::text, 4, '0'),
    btrim(p_description),
    p_amount_cents,
    currency,
    'issued',
    today,
    p_due_on,
    matter.is_sample,
    key
  )
  returning id into rid;
  perform app.record_audit_event(
    matter.organization_id, 'invoice.issued', 'public.invoices', rid, 'success',
    jsonb_build_object('matter_id', matter.id, 'amount_cents', p_amount_cents, 'currency', currency)
  );
  return rid;
end;
$$;
revoke all on function app.create_invoice(uuid, text, bigint, text, date, text) from public;

-- ---------------------------------------------------------------------------
-- Paying an invoice (the client, a party on the matter)
-- ---------------------------------------------------------------------------

-- What the server needs to create a PaymentIntent: the balance due, the currency, the firm's
-- connected account and the open attempt to reuse. Refuses anyone who is not a party.
create function app.invoice_payment_context(p_invoice_id uuid)
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
  if invoice.status not in ('issued', 'partially_paid') then
    raise exception 'this invoice is not open for payment' using errcode = '22023';
  end if;
  select * into account from public.firm_payment_accounts where organization_id = invoice.organization_id;
  select count(*)::integer into attempts from public.invoice_payments where invoice_id = invoice.id;
  select * into open_payment
  from public.invoice_payments payment
  where payment.invoice_id = invoice.id
    and payment.status in ('requires_payment', 'failed')
    and payment.amount_cents = invoice.amount_cents - invoice.paid_cents
    and payment.connected_account_id = account.account_id
  order by payment.created_at desc
  limit 1;
  return jsonb_build_object(
    'invoice_id', invoice.id,
    'organization_id', invoice.organization_id,
    'number', invoice.number,
    'amount_due', invoice.amount_cents - invoice.paid_cents,
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
revoke all on function app.invoice_payment_context(uuid) from public;

create function app.record_invoice_payment_intent(
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
  if p_amount_cents is distinct from (invoice.amount_cents - invoice.paid_cents) then
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
revoke all on function app.record_invoice_payment_intent(uuid, text, text, bigint, text, bigint, boolean) from public;

-- ---------------------------------------------------------------------------
-- Webhook events (service_role only)
-- ---------------------------------------------------------------------------

-- Applies one verified Stripe PaymentIntent event. Idempotent: the event is recorded once in
-- public.webhook_inbox (deduped on provider, connected account, event id); a redelivery, or an
-- event already processed, changes nothing and returns outcome 'duplicate'. The account, amount
-- and currency must match the recorded payment. A succeeded payment never moves backwards, so
-- late or out-of-order events are safe. A redirect is never proof of payment: only this moves money state.
create function app.apply_stripe_payment_event(
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
            status = case when paid_cents + received >= amount_cents then 'paid'::public.invoice_status else 'partially_paid'::public.invoice_status end
        where id = invoice.id
        returning * into invoice;
        perform app.record_audit_event(
          invoice.organization_id, 'invoice.payment_succeeded', 'public.invoices', invoice.id, 'success',
          jsonb_build_object('payment_id', payment.id, 'amount_cents', received, 'currency', payment.currency)
        );
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
revoke all on function app.apply_stripe_payment_event(text, text, text, text, bigint, bigint, text, boolean, uuid, jsonb) from public, anon, authenticated;
grant execute on function app.apply_stripe_payment_event(text, text, text, text, bigint, bigint, text, boolean, uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Public wrappers. The database checks the caller; these stay security invoker.
-- ---------------------------------------------------------------------------

create function public.firm_payment_account_for_owner(p_org uuid)
returns text language sql security invoker set search_path = ''
as $$ select app.firm_payment_account_for_owner(p_org); $$;

create function public.record_firm_payment_account(p_org uuid, p_account_id text, p_livemode boolean)
returns uuid language sql security invoker set search_path = ''
as $$ select app.record_firm_payment_account(p_org, p_account_id, p_livemode); $$;

create function public.sync_firm_payment_account(
  p_org uuid, p_account_id text, p_card_payments_status text, p_payouts_status text, p_requirements_due integer
) returns void language sql security invoker set search_path = ''
as $$ select app.sync_firm_payment_account(p_org, p_account_id, p_card_payments_status, p_payouts_status, p_requirements_due); $$;

create function public.create_invoice(
  p_matter_id uuid, p_description text, p_amount_cents bigint, p_currency text, p_due_on date, p_idempotency_key text
) returns uuid language sql security invoker set search_path = ''
as $$ select app.create_invoice(p_matter_id, p_description, p_amount_cents, p_currency, p_due_on, p_idempotency_key); $$;

create function public.invoice_payment_context(p_invoice_id uuid)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select app.invoice_payment_context(p_invoice_id); $$;

create function public.record_invoice_payment_intent(
  p_invoice_id uuid, p_payment_intent_id text, p_account_id text, p_amount_cents bigint,
  p_currency text, p_application_fee_cents bigint, p_livemode boolean
) returns uuid language sql security invoker set search_path = ''
as $$
  select app.record_invoice_payment_intent(
    p_invoice_id, p_payment_intent_id, p_account_id, p_amount_cents, p_currency, p_application_fee_cents, p_livemode
  );
$$;

create function public.apply_stripe_payment_event(
  p_event_id text, p_account_id text, p_event_type text, p_payment_intent_id text, p_amount_cents bigint,
  p_amount_received_cents bigint, p_currency text, p_livemode boolean, p_invoice_id uuid, p_payload jsonb
) returns jsonb language sql security invoker set search_path = ''
as $$
  select app.apply_stripe_payment_event(
    p_event_id, p_account_id, p_event_type, p_payment_intent_id, p_amount_cents,
    p_amount_received_cents, p_currency, p_livemode, p_invoice_id, p_payload
  );
$$;

revoke all on function public.firm_payment_account_for_owner(uuid) from public, anon;
revoke all on function public.record_firm_payment_account(uuid, text, boolean) from public, anon;
revoke all on function public.sync_firm_payment_account(uuid, text, text, text, integer) from public, anon;
revoke all on function public.create_invoice(uuid, text, bigint, text, date, text) from public, anon;
revoke all on function public.invoice_payment_context(uuid) from public, anon;
revoke all on function public.record_invoice_payment_intent(uuid, text, text, bigint, text, bigint, boolean) from public, anon;
revoke all on function public.apply_stripe_payment_event(text, text, text, text, bigint, bigint, text, boolean, uuid, jsonb) from public, anon, authenticated;

grant execute on function public.firm_payment_account_for_owner(uuid) to authenticated;
grant execute on function public.record_firm_payment_account(uuid, text, boolean) to authenticated;
grant execute on function public.sync_firm_payment_account(uuid, text, text, text, integer) to authenticated;
grant execute on function public.create_invoice(uuid, text, bigint, text, date, text) to authenticated;
grant execute on function public.invoice_payment_context(uuid) to authenticated;
grant execute on function public.record_invoice_payment_intent(uuid, text, text, bigint, text, bigint, boolean) to authenticated;
grant execute on function public.apply_stripe_payment_event(text, text, text, text, bigint, bigint, text, boolean, uuid, jsonb) to service_role;

grant execute on function app.firm_payment_account_for_owner(uuid) to authenticated;
grant execute on function app.record_firm_payment_account(uuid, text, boolean) to authenticated;
grant execute on function app.sync_firm_payment_account(uuid, text, text, text, integer) to authenticated;
grant execute on function app.create_invoice(uuid, text, bigint, text, date, text) to authenticated;
grant execute on function app.invoice_payment_context(uuid) to authenticated;
grant execute on function app.record_invoice_payment_intent(uuid, text, text, bigint, text, bigint, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Table privileges and row-level security
-- ---------------------------------------------------------------------------

revoke all on table public.firm_payment_accounts from anon, authenticated, service_role;
revoke all on table public.invoices from anon, authenticated, service_role;
revoke all on table public.invoice_payments from anon, authenticated, service_role;
revoke all on table public.invoice_payment_events from anon, authenticated, service_role;
grant select on table public.firm_payment_accounts to authenticated, service_role;
grant select on table public.invoices to authenticated, service_role;
grant select on table public.invoice_payments to authenticated, service_role;
grant select on table public.invoice_payment_events to authenticated, service_role;

alter table public.firm_payment_accounts enable row level security;
alter table public.firm_payment_accounts force row level security;
alter table public.invoices enable row level security;
alter table public.invoices force row level security;
alter table public.invoice_payments enable row level security;
alter table public.invoice_payments force row level security;
alter table public.invoice_payment_events enable row level security;
alter table public.invoice_payment_events force row level security;

create policy firm_payment_accounts_select on public.firm_payment_accounts
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.can_read_firm_payment_account(organization_id))
  );

create policy invoices_select on public.invoices
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.can_read_invoice(id))
  );

create policy invoice_payments_select on public.invoice_payments
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.can_read_invoice(invoice_id))
  );

create policy invoice_payment_events_select on public.invoice_payment_events
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and exists (
      select 1 from public.invoices invoice
      where invoice.id = invoice_payment_events.invoice_id
        and (select app.can_read_matter_billing(invoice.matter_id))
    )
  );
