-- Casevoya SaaS subscription billing (T042; PRD §3 pricing, ADM-02, SEC-10, FIN-01).
--
-- Decision (Francis, 2026-10-19): PRD prices, Stripe TEST mode. Monthly: Solo CAD 129 (2 staff
-- seats, 100 active matters), Practice CAD 299 (6, 500), Firm CAD 599 (15, 1,500); extra seat
-- CAD 25/month; 14-day trial; annual = 10 × monthly; Enterprise = "Contact Casevoya".
-- Prices live in product_settings (subscription.plans), never in code. storage_gb is a PROPOSED
-- allowance pending costing (docs/DECISIONS.md).
--
-- What this migration adds, all additive:
--   * product_settings rows subscription.plans and subscription.grace.
--   * organization_subscriptions: the chosen plan, interval, extra seats, Stripe ids, period and
--     state dates, the latest Casevoya invoice.
--   * subscription_events (every billing event applied or requested, redacted payload) and
--     subscription_invoices (Casevoya's invoices to the firm, from Stripe). Forced RLS: the firm
--     owner and finance read their own firm's rows; only functions write.
--   * public.subscription_plan_catalog() (any signed-in user), app/public.subscription_entitlements
--     (seats, matters, storage for the firm's state), public.firm_subscription (owner/finance: the
--     whole Subscription page in one call), public.subscription_checkout_allowed and
--     public.record_subscription_customer and public.subscription_portal_allowed (owner step-up;
--     Stripe itself is called from the server action), public.apply_stripe_subscription_event
--     (service role only: the billing webhook, deduped through webhook_inbox as provider
--     stripe_billing).
--   * Entitlements enforced where work is created: app.create_staff_invitation (seat allowance),
--     public.create_engaged_matter (active-matter allowance, real matters only; sample matters never
--     count), app.real_client_invite_blockers (subscription_restricted). Reads and exports are never
--     blocked. Each redefined function is copied from its latest definition (named above it) with
--     only the change described.

-- ---------------------------------------------------------------------------
-- Configuration
-- ---------------------------------------------------------------------------
insert into public.product_settings (key, value, description, pending_confirmation) values
  (
    'subscription.plans',
    '{"currency":"CAD","annual_months":10,"extra_seat_monthly_cents":2500,"solo":{"monthly_cents":12900,"seats":2,"matters":100,"storage_gb":25},"practice":{"monthly_cents":29900,"seats":6,"matters":500,"storage_gb":100},"firm":{"monthly_cents":59900,"seats":15,"matters":1500,"storage_gb":250}}'::jsonb,
    'Plan prices in CAD cents per month (annual = annual_months × monthly), staff seats and active-matter allowances, confirmed by Francis 2026-10-19. storage_gb is a proposed allowance pending costing. Enterprise has no price: contact Casevoya. A trial gets Solo allowances.',
    true
  ),
  (
    'subscription.grace',
    '{"past_due_days":7,"export_window_days":90}'::jsonb,
    'ADM-02: days a failed renewal stays past due before the firm is restricted. SEC-10: days after cancellation that exports stay open before the state is marked archived. Nothing is ever deleted by these.',
    false
  ),
  (
    'subscription.stripe_prices',
    '{"test":{},"live":{}}'::jsonb,
    'Cache of Stripe Price ids per mode, keyed by lookup key (casevoya_solo_month, casevoya_seat_year…). The Prices exist in the Casevoya Stripe account already; the app resolves them by lookup key and never creates one. Refreshed by the server when a key is missing.',
    false
  )
on conflict (key) do nothing;

-- The server (service role) caches resolved Stripe Price ids. Merges into the mode's map; ids only.
create function public.cache_subscription_stripe_prices(p_mode text, p_prices jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  pair record;
  cleaned jsonb := '{}'::jsonb;
begin
  if p_mode not in ('test', 'live') then
    raise exception 'mode must be test or live' using errcode = '22023';
  end if;
  if p_prices is null or jsonb_typeof(p_prices) <> 'object' then
    raise exception 'prices must be an object of lookup key to price id' using errcode = '22023';
  end if;
  for pair in select key, value from jsonb_each_text(p_prices) loop
    if pair.key !~ '^casevoya_(solo|practice|firm|seat)_(month|year)$' or pair.value !~ '^price_[A-Za-z0-9]{6,250}$' then
      raise exception 'unknown lookup key or price id' using errcode = '22023';
    end if;
    cleaned := cleaned || jsonb_build_object(pair.key, pair.value);
  end loop;
  update public.product_settings
     set value = jsonb_set(coalesce(value, '{}'::jsonb), array[p_mode], coalesce(value -> p_mode, '{}'::jsonb) || cleaned, true)
   where key = 'subscription.stripe_prices';
end;
$$;
revoke all on function public.cache_subscription_stripe_prices(text, jsonb) from public, anon, authenticated;
grant execute on function public.cache_subscription_stripe_prices(text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- organization_subscriptions: the plan and its Stripe state
-- ---------------------------------------------------------------------------
alter table public.organization_subscriptions
  add column plan public.subscription_plan,
  add column billing_interval public.billing_interval,
  add column extra_seats integer not null default 0 check (extra_seats between 0 and 500),
  add column stripe_customer_id text check (stripe_customer_id is null or stripe_customer_id ~ '^cus_[A-Za-z0-9]{6,250}$'),
  add column stripe_subscription_id text check (stripe_subscription_id is null or stripe_subscription_id ~ '^sub_[A-Za-z0-9]{6,250}$'),
  add column current_period_end timestamptz,
  add column cancel_at timestamptz,
  add column cancelled_at timestamptz,
  add column past_due_since timestamptz,
  add column restricted_at timestamptz,
  add column archived_at timestamptz,
  add column latest_invoice_status text check (latest_invoice_status is null or latest_invoice_status ~ '^[a-z_]{1,40}$'),
  add column latest_invoice_url text check (latest_invoice_url is null or (length(latest_invoice_url) <= 2000 and latest_invoice_url ~ '^https://')),
  add column last_webhook_event_id text check (last_webhook_event_id is null or length(last_webhook_event_id) <= 200);
comment on column public.organization_subscriptions.plan is
  'The chosen plan once Stripe confirms it. Null during a trial. Prices are read from product_settings subscription.plans, never stored here.';
comment on column public.organization_subscriptions.billing_interval is
  'month or year (annual = annual_months × monthly). Named billing_interval because interval is a type name.';
comment on column public.organization_subscriptions.cancel_at is
  'Set while the subscription is still active but cancels at the period end. cancelled_at is set when it actually ends.';

create unique index organization_subscriptions_stripe_customer_uidx
  on public.organization_subscriptions (stripe_customer_id) where stripe_customer_id is not null;
create unique index organization_subscriptions_stripe_subscription_uidx
  on public.organization_subscriptions (stripe_subscription_id) where stripe_subscription_id is not null;

-- ---------------------------------------------------------------------------
-- subscription_events: what happened to the firm's subscription (requests and Stripe events)
-- ---------------------------------------------------------------------------
create table public.subscription_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  kind text not null check (kind ~ '^[a-z][a-z0-9_.]{1,80}$'),
  stripe_event_id text unique check (stripe_event_id is null or stripe_event_id ~ '^evt_[A-Za-z0-9]{6,250}$'),
  payload jsonb not null default '{}'::jsonb check (pg_column_size(payload) <= 16384),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1)
);
comment on table public.subscription_events is
  'Casevoya subscription history: checkout requests and applied Stripe billing events. Payloads are redacted summaries (ids, status, amounts): never a card, address or full customer object.';

create index subscription_events_org_idx on public.subscription_events (organization_id, occurred_at desc);
create index subscription_events_created_by_idx on public.subscription_events (created_by);

create trigger subscription_events_touch before update on public.subscription_events
  for each row execute function app.touch_row();
create trigger subscription_events_stamp before insert on public.subscription_events
  for each row execute function app.stamp_created_by();
create trigger subscription_events_audit after insert or update or delete on public.subscription_events
  for each row execute function app.audit_row_change('payload');

revoke all on table public.subscription_events from anon, authenticated, service_role;
grant select on table public.subscription_events to authenticated, service_role;

alter table public.subscription_events enable row level security;
alter table public.subscription_events force row level security;

create policy subscription_events_select_owner_finance on public.subscription_events
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.staff_mfa_satisfied())
    and (select app.has_org_role(organization_id, array['firm_owner', 'finance_user']::public.org_role[]))
  );

-- ---------------------------------------------------------------------------
-- subscription_invoices: Casevoya's invoices to the firm (from Stripe), separate from client money
-- ---------------------------------------------------------------------------
create table public.subscription_invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  stripe_invoice_id text not null unique check (stripe_invoice_id ~ '^in_[A-Za-z0-9]{6,250}$'),
  number text check (number is null or length(number) <= 60),
  status text not null check (status ~ '^[a-z_]{1,40}$'),
  amount_due_cents bigint not null check (amount_due_cents >= 0),
  amount_paid_cents bigint not null default 0 check (amount_paid_cents >= 0),
  currency text not null check (currency ~ '^[a-z]{3}$'),
  period_start timestamptz,
  period_end timestamptz,
  hosted_invoice_url text check (hosted_invoice_url is null or (length(hosted_invoice_url) <= 2000 and hosted_invoice_url ~ '^https://')),
  pdf_url text check (pdf_url is null or (length(pdf_url) <= 2000 and pdf_url ~ '^https://')),
  stripe_created_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1)
);
comment on table public.subscription_invoices is
  'What the firm pays Casevoya (FIN-01: separate from client immigration money). Mirrors Stripe invoices on the platform account; the hosted URL and PDF are Stripe''s.';

create index subscription_invoices_org_idx on public.subscription_invoices (organization_id, stripe_created_at desc);
create index subscription_invoices_created_by_idx on public.subscription_invoices (created_by);

create trigger subscription_invoices_touch before update on public.subscription_invoices
  for each row execute function app.touch_row();
create trigger subscription_invoices_stamp before insert on public.subscription_invoices
  for each row execute function app.stamp_created_by();
create trigger subscription_invoices_audit after insert or update or delete on public.subscription_invoices
  for each row execute function app.audit_row_change();

revoke all on table public.subscription_invoices from anon, authenticated, service_role;
grant select on table public.subscription_invoices to authenticated, service_role;

alter table public.subscription_invoices enable row level security;
alter table public.subscription_invoices force row level security;

create policy subscription_invoices_select_owner_finance on public.subscription_invoices
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.staff_mfa_satisfied())
    and (select app.has_org_role(organization_id, array['firm_owner', 'finance_user']::public.org_role[]))
  );

-- ---------------------------------------------------------------------------
-- Catalog
-- ---------------------------------------------------------------------------
create function app.subscription_plan_catalog()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select value from public.product_settings where key = 'subscription.plans';
$$;
revoke all on function app.subscription_plan_catalog() from public, anon;
grant execute on function app.subscription_plan_catalog() to authenticated, service_role;

-- Any signed-in user may read the plans and prices (they are public pricing).
create function public.subscription_plan_catalog()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'sign in is required' using errcode = '42501';
  end if;
  return coalesce(app.subscription_plan_catalog(), '{}'::jsonb);
end;
$$;
comment on function public.subscription_plan_catalog() is
  'The plans, prices (CAD cents per month), allowances, extra seat price and annual multiplier from product_settings subscription.plans. Enterprise is not listed: contact Casevoya.';
revoke all on function public.subscription_plan_catalog() from public, anon;
grant execute on function public.subscription_plan_catalog() to authenticated, service_role;

create function app.subscription_grace_days(p_key text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(0, coalesce((value ->> p_key)::integer, case p_key when 'past_due_days' then 7 when 'export_window_days' then 90 else 0 end))
  from public.product_settings where key = 'subscription.grace';
$$;
revoke all on function app.subscription_grace_days(text) from public, anon;
grant execute on function app.subscription_grace_days(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- State clock: trial end, past due → restricted after the grace, cancelled → archived after the
-- export window. Marks state only; never deletes or hides records.
-- ---------------------------------------------------------------------------
create function app.sync_subscription_state(p_org uuid)
returns public.subscription_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  sub public.organization_subscriptions%rowtype;
  now_at timestamptz := statement_timestamp();
begin
  select * into sub from public.organization_subscriptions where organization_id = p_org;
  if sub.organization_id is null then
    return null;
  end if;
  if sub.status = 'trial' then
    return app.sync_trial_status(p_org);
  end if;
  if sub.status = 'past_due'
     and sub.past_due_since is not null
     and sub.past_due_since + make_interval(days => app.subscription_grace_days('past_due_days')) <= now_at then
    update public.organization_subscriptions
       set status = 'restricted', restricted_at = now_at
     where organization_id = p_org and status = 'past_due';
    perform app.record_audit_event(
      p_org, 'subscription.restricted', 'public.organization_subscriptions', p_org, 'success',
      jsonb_build_object('past_due_since', sub.past_due_since, 'grace_days', app.subscription_grace_days('past_due_days'))
    );
    return 'restricted';
  end if;
  if sub.status = 'cancelled'
     and sub.cancelled_at is not null
     and sub.cancelled_at + make_interval(days => app.subscription_grace_days('export_window_days')) <= now_at then
    update public.organization_subscriptions
       set status = 'archived', archived_at = now_at
     where organization_id = p_org and status = 'cancelled';
    perform app.record_audit_event(
      p_org, 'subscription.archived', 'public.organization_subscriptions', p_org, 'success',
      jsonb_build_object('cancelled_at', sub.cancelled_at, 'export_window_days', app.subscription_grace_days('export_window_days'), 'records_deleted', false)
    );
    return 'archived';
  end if;
  return sub.status;
end;
$$;
comment on function app.sync_subscription_state(uuid) is
  'Moves an elapsed trial to trial_ended, past_due past its grace to restricted, and cancelled past the export window to archived. State only: no records are deleted, reads and exports stay open.';
revoke all on function app.sync_subscription_state(uuid) from public, anon;
grant execute on function app.sync_subscription_state(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Entitlements (ADM-02): what the firm's state allows. Null = no limit (enterprise).
-- A trial, an ended trial and a firm with no plan get Solo allowances. new_work_blocked is true
-- in restricted, cancelled and archived: new staff invites, real matters and real client invites
-- wait for a plan; reads and exports never do.
-- ---------------------------------------------------------------------------
create function app.subscription_entitlements(p_org uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  sub public.organization_subscriptions%rowtype;
  status public.subscription_status;
  catalog jsonb := coalesce(app.subscription_plan_catalog(), '{}'::jsonb);
  basis text;
  plan_key text;
  seats integer;
  matters integer;
  storage integer;
begin
  status := app.sync_subscription_state(p_org);
  select * into sub from public.organization_subscriptions where organization_id = p_org;
  if sub.organization_id is null then
    return jsonb_build_object('status', null, 'plan', null, 'basis', 'none', 'seats', null, 'matters', null, 'storage_gb', null, 'extra_seats', 0, 'new_work_blocked', false);
  end if;
  if sub.plan is not null and status in ('active', 'past_due', 'restricted', 'cancelled', 'archived') then
    if sub.plan = 'enterprise' then
      return jsonb_build_object(
        'status', status, 'plan', 'enterprise', 'basis', 'enterprise', 'seats', null, 'matters', null, 'storage_gb', null,
        'extra_seats', sub.extra_seats, 'new_work_blocked', status in ('restricted', 'cancelled', 'archived')
      );
    end if;
    basis := 'plan';
    plan_key := sub.plan::text;
  else
    basis := 'trial';
    plan_key := 'solo';
  end if;
  seats := (catalog -> plan_key ->> 'seats')::integer;
  matters := (catalog -> plan_key ->> 'matters')::integer;
  storage := (catalog -> plan_key ->> 'storage_gb')::integer;
  return jsonb_build_object(
    'status', status,
    'plan', case when basis = 'plan' then sub.plan::text else null end,
    'basis', basis,
    'seats', case when seats is null then null else seats + case when basis = 'plan' then sub.extra_seats else 0 end end,
    'matters', matters,
    'storage_gb', storage,
    'extra_seats', case when basis = 'plan' then sub.extra_seats else 0 end,
    'new_work_blocked', status in ('restricted', 'cancelled', 'archived')
  );
end;
$$;
comment on function app.subscription_entitlements(uuid) is
  'Seats (plan seats + extra seats), active-matter and storage allowances for the firm''s current state; null means no limit. Trial and no plan: Solo allowances. new_work_blocked in restricted, cancelled, archived.';
revoke all on function app.subscription_entitlements(uuid) from public, anon;
grant execute on function app.subscription_entitlements(uuid) to authenticated, service_role;

-- The firm's staff (at staff MFA) may read their firm's allowances: Team and seats shows "N of M".
create function public.subscription_entitlements(p_organization_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'sign in is required' using errcode = '42501';
  end if;
  if p_organization_id is null
     or p_organization_id is distinct from (select app.current_organization_id())
     or app.in_active_org(p_organization_id) is distinct from true
     or app.is_org_staff(p_organization_id) is distinct from true
     or app.staff_mfa_satisfied() is distinct from true then
    raise exception 'subscription entitlements denied' using errcode = '42501';
  end if;
  return app.subscription_entitlements(p_organization_id);
end;
$$;
revoke all on function public.subscription_entitlements(uuid) from public, anon;
grant execute on function public.subscription_entitlements(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Settings > Subscription in one call (firm owner or finance)
-- ---------------------------------------------------------------------------
create function public.firm_subscription(p_organization_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  sub public.organization_subscriptions%rowtype;
  entitlements jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'sign in is required' using errcode = '42501';
  end if;
  if p_organization_id is null
     or p_organization_id is distinct from (select app.current_organization_id())
     or app.in_active_org(p_organization_id) is distinct from true
     or app.staff_mfa_satisfied() is distinct from true
     or app.has_org_role(p_organization_id, array['firm_owner', 'finance_user']::public.org_role[]) is distinct from true then
    raise exception 'subscription denied' using errcode = '42501';
  end if;
  entitlements := app.subscription_entitlements(p_organization_id);
  select * into sub from public.organization_subscriptions where organization_id = p_organization_id;
  return jsonb_build_object(
    'subscription', case when sub.organization_id is null then null else jsonb_build_object(
      'status', sub.status,
      'plan', sub.plan,
      'billing_interval', sub.billing_interval,
      'extra_seats', sub.extra_seats,
      'trial_started_at', sub.trial_started_at,
      'trial_ends_at', sub.trial_ends_at,
      'current_period_end', sub.current_period_end,
      'cancel_at', sub.cancel_at,
      'cancelled_at', sub.cancelled_at,
      'past_due_since', sub.past_due_since,
      'restricted_at', sub.restricted_at,
      'archived_at', sub.archived_at,
      'latest_invoice_status', sub.latest_invoice_status,
      'latest_invoice_url', sub.latest_invoice_url,
      'has_billing_account', sub.stripe_customer_id is not null,
      'has_stripe_subscription', sub.stripe_subscription_id is not null
    ) end,
    'entitlements', entitlements,
    'usage', public.firm_subscription_usage(p_organization_id),
    'catalog', coalesce(app.subscription_plan_catalog(), '{}'::jsonb),
    'grace', jsonb_build_object('past_due_days', app.subscription_grace_days('past_due_days'), 'export_window_days', app.subscription_grace_days('export_window_days')),
    'invoices', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', inv.id, 'number', inv.number, 'status', inv.status, 'amount_due_cents', inv.amount_due_cents,
        'amount_paid_cents', inv.amount_paid_cents, 'currency', inv.currency, 'period_start', inv.period_start,
        'period_end', inv.period_end, 'hosted_invoice_url', inv.hosted_invoice_url, 'pdf_url', inv.pdf_url,
        'created_at', coalesce(inv.stripe_created_at, inv.created_at)
      ) order by coalesce(inv.stripe_created_at, inv.created_at) desc)
      from (
        select * from public.subscription_invoices i
        where i.organization_id = p_organization_id
        order by coalesce(i.stripe_created_at, i.created_at) desc
        limit 24
      ) inv
    ), '[]'::jsonb)
  );
end;
$$;
comment on function public.firm_subscription(uuid) is
  'Firm owner or finance: the subscription state (synced), entitlements, usage, the plan catalog and the last 24 Casevoya invoices for Settings > Subscription. Never a card or a Stripe id.';
revoke all on function public.firm_subscription(uuid) from public, anon;
grant execute on function public.firm_subscription(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Checkout and portal: the database validates and records the intent; the server action calls Stripe.
-- ---------------------------------------------------------------------------
create function public.subscription_checkout_allowed(
  p_organization_id uuid,
  p_plan public.subscription_plan,
  p_interval public.billing_interval,
  p_extra_seats integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  sub public.organization_subscriptions%rowtype;
  org public.organizations%rowtype;
  catalog jsonb := coalesce(app.subscription_plan_catalog(), '{}'::jsonb);
  key uuid := gen_random_uuid();
  actor_email text;
begin
  perform app.require_firm_owner_step_up(p_organization_id);
  if p_plan is null or p_interval is null then
    raise exception 'choose a plan and a billing interval' using errcode = '22023';
  end if;
  if p_plan = 'enterprise' then
    raise exception 'enterprise plans are arranged with Casevoya' using errcode = '22023';
  end if;
  if p_extra_seats is null or p_extra_seats < 0 or p_extra_seats > 500 then
    raise exception 'extra seats must be 0 to 500' using errcode = '22023';
  end if;
  if (catalog -> p_plan::text ->> 'monthly_cents') is null then
    raise exception 'that plan has no price yet' using errcode = '22023';
  end if;
  perform app.sync_subscription_state(p_organization_id);
  select * into sub from public.organization_subscriptions where organization_id = p_organization_id;
  if sub.organization_id is null then
    raise exception 'this firm has no subscription record' using errcode = '22023';
  end if;
  if sub.stripe_subscription_id is not null and sub.status in ('active', 'past_due', 'restricted') then
    raise exception 'the current subscription is changed in the billing portal' using errcode = '22023';
  end if;
  select * into org from public.organizations where id = p_organization_id;
  select u.email into actor_email from auth.users u where u.id = (select auth.uid());

  insert into public.subscription_events (organization_id, kind, payload)
  values (
    p_organization_id,
    'checkout.requested',
    jsonb_build_object('plan', p_plan, 'interval', p_interval, 'extra_seats', p_extra_seats, 'idempotency_key', key)
  );
  perform app.record_audit_event(
    p_organization_id, 'subscription.checkout_requested', 'public.organization_subscriptions', p_organization_id, 'success',
    jsonb_build_object('plan', p_plan, 'interval', p_interval, 'extra_seats', p_extra_seats, 'idempotency_key', key)
  );
  return jsonb_build_object(
    'ok', true,
    'idempotency_key', key,
    'stripe_customer_id', sub.stripe_customer_id,
    'firm_name', coalesce(org.display_name, org.legal_name),
    'billing_email', coalesce(org.billing_contact_email, actor_email),
    'plan', p_plan,
    'interval', p_interval,
    'extra_seats', p_extra_seats,
    'catalog', catalog
  );
end;
$$;
comment on function public.subscription_checkout_allowed(uuid, public.subscription_plan, public.billing_interval, integer) is
  'Firm owner with a recent step-up: validates a Checkout request against the catalog and the current state, records the intent with an idempotency key, and returns what the server action needs to open Stripe Checkout (test mode). Enterprise has no checkout. An existing live subscription changes in the portal.';
revoke all on function public.subscription_checkout_allowed(uuid, public.subscription_plan, public.billing_interval, integer) from public, anon;
grant execute on function public.subscription_checkout_allowed(uuid, public.subscription_plan, public.billing_interval, integer) to authenticated;

create function public.record_subscription_customer(p_organization_id uuid, p_stripe_customer_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  sub public.organization_subscriptions%rowtype;
  customer text := btrim(coalesce(p_stripe_customer_id, ''));
begin
  perform app.require_firm_owner_step_up(p_organization_id);
  if customer !~ '^cus_[A-Za-z0-9]{6,250}$' then
    raise exception 'stripe customer id is invalid' using errcode = '22023';
  end if;
  select * into sub from public.organization_subscriptions where organization_id = p_organization_id for update;
  if sub.organization_id is null then
    raise exception 'this firm has no subscription record' using errcode = '22023';
  end if;
  if sub.stripe_customer_id = customer then
    return;
  end if;
  if sub.stripe_customer_id is not null then
    raise exception 'this firm already has a billing account' using errcode = '22023';
  end if;
  update public.organization_subscriptions set stripe_customer_id = customer where organization_id = p_organization_id;
  perform app.record_audit_event(
    p_organization_id, 'subscription.customer_recorded', 'public.organization_subscriptions', p_organization_id, 'success',
    jsonb_build_object('stripe_customer_id', customer)
  );
end;
$$;
revoke all on function public.record_subscription_customer(uuid, text) from public, anon;
grant execute on function public.record_subscription_customer(uuid, text) to authenticated;

create function public.subscription_portal_allowed(p_organization_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  sub public.organization_subscriptions%rowtype;
begin
  perform app.require_firm_owner_step_up(p_organization_id);
  select * into sub from public.organization_subscriptions where organization_id = p_organization_id;
  if sub.organization_id is null or sub.stripe_customer_id is null then
    raise exception 'this firm has no billing account yet; choose a plan first' using errcode = '22023';
  end if;
  perform app.record_audit_event(
    p_organization_id, 'subscription.portal_opened', 'public.organization_subscriptions', p_organization_id, 'success', '{}'::jsonb
  );
  return jsonb_build_object('ok', true, 'stripe_customer_id', sub.stripe_customer_id);
end;
$$;
revoke all on function public.subscription_portal_allowed(uuid) from public, anon;
grant execute on function public.subscription_portal_allowed(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Billing webhook (service role only). p_event is the redacted summary the route builds:
--   {id, type, created, livemode, organization_id?, customer?,
--    subscription?: {id, status, plan, interval, extra_seats, current_period_end, cancel_at, canceled_at},
--    invoice?: {id, number, status, amount_due, amount_paid, currency, period_start, period_end,
--               hosted_invoice_url, pdf_url, created}}
-- Dedupes through webhook_inbox as provider stripe_billing. States per ADM-02; audited.
-- ---------------------------------------------------------------------------
create function public.apply_stripe_subscription_event(p_event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_id text := btrim(coalesce(p_event ->> 'id', ''));
  event_type text := left(coalesce(p_event ->> 'type', ''), 120);
  livemode boolean := coalesce((p_event ->> 'livemode')::boolean, false);
  customer text := nullif(btrim(coalesce(p_event ->> 'customer', '')), '');
  s jsonb := p_event -> 'subscription';
  inv jsonb := p_event -> 'invoice';
  org uuid;
  sub public.organization_subscriptions%rowtype;
  inbox_id uuid;
  inbox_status public.webhook_inbox_status;
  outcome text := 'applied';
  before_status public.subscription_status;
  next_status public.subscription_status;
  stripe_status text;
  event_plan public.subscription_plan;
  event_interval public.billing_interval;
  now_at timestamptz := statement_timestamp();
begin
  if event_id !~ '^evt_[A-Za-z0-9]{6,250}$' then
    raise exception 'event id is required' using errcode = '22023';
  end if;
  if (p_event ->> 'organization_id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    org := (p_event ->> 'organization_id')::uuid;
    if not exists (select 1 from public.organization_subscriptions where organization_id = org) then
      org := null;
    end if;
  end if;
  if org is null and customer is not null then
    select organization_id into org from public.organization_subscriptions where stripe_customer_id = customer;
  end if;

  inbox_id := app.ingest_webhook_event('stripe_billing', event_id, coalesce(customer, ''), event_type, p_event, true, org);
  select w.status into inbox_status from public.webhook_inbox w where w.id = inbox_id for update;
  if inbox_status in ('processed', 'ignored') then
    return jsonb_build_object('outcome', 'duplicate');
  end if;
  if org is null or livemode then
    update public.webhook_inbox set status = 'ignored', processed_at = clock_timestamp() where id = inbox_id;
    return jsonb_build_object('outcome', 'ignored', 'reason', case when livemode then 'livemode' else 'unknown_firm' end);
  end if;

  select * into sub from public.organization_subscriptions where organization_id = org for update;
  before_status := sub.status;
  insert into public.subscription_events (organization_id, kind, stripe_event_id, payload, occurred_at)
  values (org, event_type, event_id, p_event, coalesce(to_timestamp((p_event ->> 'created')::bigint), now_at))
  on conflict (stripe_event_id) do nothing;

  if s ->> 'plan' in ('solo', 'practice', 'firm', 'enterprise') then
    event_plan := (s ->> 'plan')::public.subscription_plan;
  end if;
  if s ->> 'interval' in ('month', 'year') then
    event_interval := (s ->> 'interval')::public.billing_interval;
  end if;

  if event_type = 'checkout.session.completed' then
    update public.organization_subscriptions
       set stripe_customer_id = coalesce(stripe_customer_id, customer),
           stripe_subscription_id = coalesce(nullif(s ->> 'id', ''), stripe_subscription_id),
           plan = coalesce(event_plan, plan),
           billing_interval = coalesce(event_interval, billing_interval),
           extra_seats = coalesce((s ->> 'extra_seats')::integer, extra_seats),
           status = case when status in ('active', 'past_due', 'restricted') then status else 'active' end,
           cancelled_at = null, cancel_at = null, archived_at = null
     where organization_id = org;
  elsif event_type in ('customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted') then
    stripe_status := case when event_type = 'customer.subscription.deleted' then 'canceled' else s ->> 'status' end;
    next_status := case stripe_status
      when 'active' then 'active'
      when 'trialing' then 'active'
      when 'past_due' then 'past_due'
      when 'unpaid' then 'past_due'
      when 'canceled' then 'cancelled'
      else null
    end;
    if next_status = 'past_due' and sub.status = 'restricted' then
      next_status := 'restricted';
    end if;
    update public.organization_subscriptions
       set stripe_customer_id = coalesce(stripe_customer_id, customer),
           stripe_subscription_id = coalesce(nullif(s ->> 'id', ''), stripe_subscription_id),
           plan = coalesce(event_plan, plan),
           billing_interval = coalesce(event_interval, billing_interval),
           extra_seats = coalesce((s ->> 'extra_seats')::integer, extra_seats),
           current_period_end = coalesce((s ->> 'current_period_end')::timestamptz, current_period_end),
           cancel_at = case when next_status = 'cancelled' then null else (s ->> 'cancel_at')::timestamptz end,
           status = coalesce(next_status, status),
           cancelled_at = case when next_status = 'cancelled' then coalesce((s ->> 'canceled_at')::timestamptz, now_at) when next_status = 'active' then null else cancelled_at end,
           past_due_since = case when next_status = 'past_due' then coalesce(past_due_since, now_at) when next_status = 'active' then null else past_due_since end,
           restricted_at = case when next_status = 'active' then null else restricted_at end,
           archived_at = case when next_status = 'active' then null else archived_at end
     where organization_id = org;
  elsif event_type in ('invoice.paid', 'invoice.payment_failed') and (inv ->> 'id') ~ '^in_[A-Za-z0-9]{6,250}$' then
    insert into public.subscription_invoices (
      organization_id, stripe_invoice_id, number, status, amount_due_cents, amount_paid_cents, currency,
      period_start, period_end, hosted_invoice_url, pdf_url, stripe_created_at
    ) values (
      org, inv ->> 'id', left(inv ->> 'number', 60), coalesce(nullif(inv ->> 'status', ''), 'open'),
      greatest(0, coalesce((inv ->> 'amount_due')::bigint, 0)), greatest(0, coalesce((inv ->> 'amount_paid')::bigint, 0)),
      lower(coalesce(nullif(inv ->> 'currency', ''), 'cad')),
      (inv ->> 'period_start')::timestamptz, (inv ->> 'period_end')::timestamptz,
      nullif(inv ->> 'hosted_invoice_url', ''), nullif(inv ->> 'pdf_url', ''),
      coalesce((inv ->> 'created')::timestamptz, now_at)
    )
    on conflict (stripe_invoice_id) do update
      set number = coalesce(excluded.number, public.subscription_invoices.number),
          status = excluded.status,
          amount_due_cents = excluded.amount_due_cents,
          amount_paid_cents = excluded.amount_paid_cents,
          period_start = coalesce(excluded.period_start, public.subscription_invoices.period_start),
          period_end = coalesce(excluded.period_end, public.subscription_invoices.period_end),
          hosted_invoice_url = coalesce(excluded.hosted_invoice_url, public.subscription_invoices.hosted_invoice_url),
          pdf_url = coalesce(excluded.pdf_url, public.subscription_invoices.pdf_url);
    if event_type = 'invoice.paid' then
      update public.organization_subscriptions
         set stripe_customer_id = coalesce(stripe_customer_id, customer),
             latest_invoice_status = 'paid',
             latest_invoice_url = coalesce(nullif(inv ->> 'hosted_invoice_url', ''), latest_invoice_url),
             status = case when status in ('past_due', 'restricted') then 'active' else status end,
             past_due_since = case when status in ('past_due', 'restricted') then null else past_due_since end,
             restricted_at = case when status in ('past_due', 'restricted') then null else restricted_at end,
             current_period_end = coalesce((inv ->> 'period_end')::timestamptz, current_period_end)
       where organization_id = org;
    else
      update public.organization_subscriptions
         set stripe_customer_id = coalesce(stripe_customer_id, customer),
             latest_invoice_status = 'payment_failed',
             latest_invoice_url = coalesce(nullif(inv ->> 'hosted_invoice_url', ''), latest_invoice_url),
             status = case when status = 'active' then 'past_due' else status end,
             past_due_since = case when status = 'active' then now_at else past_due_since end
       where organization_id = org;
    end if;
  else
    outcome := 'ignored';
  end if;

  update public.organization_subscriptions set last_webhook_event_id = event_id where organization_id = org;
  select * into sub from public.organization_subscriptions where organization_id = org;
  perform app.record_audit_event(
    org, 'subscription.webhook_applied', 'public.organization_subscriptions', org, 'success',
    jsonb_build_object('event_id', event_id, 'event_type', event_type, 'outcome', outcome, 'status_before', before_status, 'status_after', sub.status)
  );
  update public.webhook_inbox
     set status = case when outcome = 'ignored' then 'ignored'::public.webhook_inbox_status else 'processed'::public.webhook_inbox_status end,
         processed_at = clock_timestamp(),
         organization_id = org
   where id = inbox_id;
  return jsonb_build_object('outcome', outcome, 'status', sub.status);
end;
$$;
comment on function public.apply_stripe_subscription_event(jsonb) is
  'Service role only (the billing webhook). Applies one verified Stripe platform event to the firm''s subscription: checkout.session.completed, customer.subscription.created/updated/deleted, invoice.paid, invoice.payment_failed. Deduped on the event id (webhook_inbox, provider stripe_billing). Never deletes anything.';
revoke all on function public.apply_stripe_subscription_event(jsonb) from public, anon, authenticated;
grant execute on function public.apply_stripe_subscription_event(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Enforcement 1: staff invitations against the seat allowance.
-- app.create_staff_invitation: latest definition from 20261017200100_outbound_email.sql. Added:
-- a subscription whose new work is paused refuses; the seat allowance (active staff plus open staff
-- invitations, not counting an earlier invitation to the same person) refuses with the limit named.
-- ---------------------------------------------------------------------------
create or replace function app.create_staff_invitation(
  p_organization_id uuid,
  p_email text,
  p_role public.org_role
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  normalized_email text := lower(btrim(coalesce(p_email, '')));
  token text;
  inv public.invitations;
  entitlements jsonb;
  seat_limit integer;
  seats_used integer;
begin
  if actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if app.has_org_role(p_organization_id, array['firm_owner']::public.org_role[]) is distinct from true then
    raise exception 'only a firm owner can invite staff' using errcode = '42501';
  end if;
  if app.staff_mfa_satisfied() is distinct from true
     or app.mfa_step_up_satisfied() is distinct from true then
    raise exception 'staff invitations require a recent TOTP step-up' using errcode = '42501';
  end if;
  if p_role is null or p_role <> all (app.staff_roles()) then
    raise exception 'this invitation path is for staff roles only' using errcode = '42501';
  end if;
  if normalized_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(normalized_email) > 320 then
    raise exception 'email is invalid' using errcode = '22023';
  end if;

  entitlements := app.subscription_entitlements(p_organization_id);
  if (entitlements ->> 'new_work_blocked')::boolean then
    raise exception 'subscription paused: choose a plan in Settings > Subscription before inviting staff' using errcode = '42501';
  end if;
  seat_limit := (entitlements ->> 'seats')::integer;
  if seat_limit is not null then
    select count(*) into seats_used from (
      select mem.id from public.memberships mem
       where mem.organization_id = p_organization_id and mem.status = 'active' and mem.role = any (app.staff_roles())
      union all
      select prior.id from public.invitations prior
       where prior.organization_id = p_organization_id
         and prior.role = any (app.staff_roles())
         and prior.consumed_at is null
         and prior.revoked_at is null
         and prior.expires_at > statement_timestamp()
         and prior.email <> normalized_email
    ) used;
    if seats_used >= seat_limit then
      raise exception 'seat allowance reached: % of % staff seats are in use; add a seat in Settings > Subscription', seats_used, seat_limit
        using errcode = '42501';
    end if;
  end if;

  update public.invitations as prior
     set revoked_at = statement_timestamp()
   where prior.organization_id = p_organization_id
     and prior.email = normalized_email
     and prior.role = p_role
     and prior.consumed_at is null
     and prior.revoked_at is null;

  token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.invitations (organization_id, email, role, token_hash, expires_at, created_by)
  values (
    p_organization_id,
    normalized_email,
    p_role,
    app.hash_invitation_token(token),
    statement_timestamp() + interval '7 days',
    actor
  )
  returning * into inv;

  perform app.record_audit_event(
    p_organization_id,
    'invitation.created',
    'public.invitations',
    inv.id,
    'success',
    jsonb_build_object('role', p_role)
  );
  perform app.enqueue_event(
    p_organization_id,
    'invitation',
    inv.id,
    'staff_invitation.email_requested',
    jsonb_build_object(
      'invitation_id', inv.id,
      'role', p_role,
      'recipient_email', normalized_email
    ),
    null,
    'staff-invite-email:' || inv.id::text,
    null
  );
  return token;
end;
$$;

-- ---------------------------------------------------------------------------
-- Enforcement 2: real matters against the active-matter allowance.
-- public.create_engaged_matter: latest definition from 20261017170000_matter_lifecycle.sql. Added,
-- for a real (non-sample) matter only: a paused subscription refuses; the active-matter allowance
-- (matters not closed, sample matters never counted) refuses with the limit named.
-- ---------------------------------------------------------------------------
create or replace function public.create_engaged_matter(
  p_title text,
  p_is_sample boolean,
  p_consultant_membership_id uuid,
  p_rule_pack_version_id uuid default null,
  p_scope text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  org uuid := app.current_organization_id();
  new_id uuid := gen_random_uuid();
  blocked public.credential_status;
  ref text;
  entitlements jsonb;
  matter_limit integer;
  matters_open integer;
begin
  if org is null or app.staff_mfa_satisfied() is distinct from true then
    raise exception 'matter create denied' using errcode = '42501';
  end if;
  if app.has_org_role(
    org,
    array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[]
  ) is distinct from true then
    raise exception 'matter create denied' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_title, ''))) not between 1 and 200 then
    raise exception 'matter title is required' using errcode = '22023';
  end if;
  if p_consultant_membership_id is null then
    raise exception 'a responsible consultant is required' using errcode = '22023';
  end if;
  if p_scope is not null and length(btrim(p_scope)) not between 3 and 2000 then
    raise exception 'proposed scope is too short' using errcode = '22023';
  end if;

  if coalesce(p_is_sample, false) is false then
    entitlements := app.subscription_entitlements(org);
    if (entitlements ->> 'new_work_blocked')::boolean then
      raise exception 'subscription paused: choose a plan in Settings > Subscription before opening a new matter' using errcode = '42501';
    end if;
    matter_limit := (entitlements ->> 'matters')::integer;
    if matter_limit is not null then
      select count(*) into matters_open from public.matters matter
       where matter.organization_id = org and matter.stage <> 'closed' and not matter.is_sample;
      if matters_open >= matter_limit then
        raise exception 'active-matter allowance reached: % of % active matters are open; close a matter or change plan in Settings > Subscription', matters_open, matter_limit
          using errcode = '42501';
      end if;
    end if;
  end if;

  insert into public.matters (
    id, organization_id, title, is_sample, responsible_consultant_membership_id, program_pack_id
  ) values (
    new_id, org, btrim(p_title), coalesce(p_is_sample, false), p_consultant_membership_id, p_rule_pack_version_id
  );

  insert into public.matter_participants (organization_id, matter_id, membership_id, role)
  values (org, new_id, p_consultant_membership_id, 'consultant');

  if p_rule_pack_version_id is not null then
    insert into public.matter_rule_bindings (
      organization_id, matter_id, rule_pack_version_id, rationale
    ) values (
      org,
      new_id,
      p_rule_pack_version_id,
      'Selected at matter creation from a published pack.'
    );
  end if;

  if p_scope is not null then
    perform app.note_proposed_scope(new_id, btrim(p_scope));
  end if;

  select matter.reference into ref from public.matters matter where matter.id = new_id;
  return jsonb_build_object('ok', true, 'id', new_id, 'reference', ref);
exception
  when insufficient_privilege then
    if sqlerrm ilike '%licence blocks%' then
      blocked := app.actor_licence_block_status(org);
      perform app.record_audit_event(
        org,
        'licence.regulated_action_blocked',
        'public.matters',
        null,
        'denied',
        jsonb_build_object('action', 'matter.create', 'credential_status', blocked)
      );
      return jsonb_build_object('ok', false, 'blocked', 'licence', 'credential_status', blocked);
    end if;
    raise;
end;
$$;

-- ---------------------------------------------------------------------------
-- Enforcement 3: a restricted, cancelled or archived subscription pauses new real client invites.
-- app.real_client_invite_blockers: latest definition from 20261019221100_licence_at_signup_cicc_list.sql.
-- Added, after trial_ended: subscription_restricted (restricted, cancelled or archived, or past due
-- beyond the grace even before the clock marks it). Order: firm_not_found alone; otherwise
-- firm_restricted, owner_licence_missing or owner_licence_blocked, trial_ended,
-- subscription_restricted. src/modules/sheet/setup-present.ts mirrors this.
-- ---------------------------------------------------------------------------
create or replace function app.real_client_invite_blockers(p_org uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  blockers text[] := array[]::text[];
  status public.org_verification_status;
begin
  select verification_status into status from public.organizations where id = p_org;
  if status is null then
    return array['firm_not_found']::text[];
  end if;
  if status = 'restricted' then
    blockers := array_append(blockers, 'firm_restricted');
  end if;
  if not exists (
    select 1
    from public.consultant_credentials credential
    join public.memberships mem
      on mem.id = credential.membership_id
     and mem.organization_id = credential.organization_id
    where credential.organization_id = p_org
      and mem.role = 'firm_owner'
      and mem.status = 'active'
  ) then
    blockers := array_append(blockers, 'owner_licence_missing');
  elsif exists (
    select 1
    from public.consultant_credentials credential
    join public.memberships mem
      on mem.id = credential.membership_id
     and mem.organization_id = credential.organization_id
    where credential.organization_id = p_org
      and mem.role = 'firm_owner'
      and mem.status = 'active'
      and (
        app.licence_status_blocks(credential.status)
        or credential.discipline_revoked
        or credential.discipline_suspended
        or credential.register_status = 'inactive'
        or credential.entitlement_to_practise is false
      )
  ) then
    blockers := array_append(blockers, 'owner_licence_blocked');
  end if;
  if exists (
    select 1 from public.organization_subscriptions sub
    where sub.organization_id = p_org
      and sub.status = 'trial_ended'
  ) then
    blockers := array_append(blockers, 'trial_ended');
  end if;
  if exists (
    select 1 from public.organization_subscriptions sub
    where sub.organization_id = p_org
      and (
        sub.status in ('restricted', 'cancelled', 'archived')
        or (sub.status = 'past_due' and sub.past_due_since is not null
            and sub.past_due_since + make_interval(days => app.subscription_grace_days('past_due_days')) <= statement_timestamp())
      )
  ) then
    blockers := array_append(blockers, 'subscription_restricted');
  end if;
  return blockers;
end;
$$;
