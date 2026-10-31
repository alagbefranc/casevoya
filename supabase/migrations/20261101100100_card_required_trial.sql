-- Card-required 14-day trial, new prices and the founding offer (2026-11-01; approved by Francis
-- 2026-10-30). Additive only; every function below is the latest definition with the changes
-- marked "Card trial".
--
--   * Prices (CAD, before tax): Solo 99/month (990/year, 2 seats), Practice 249/month (2,490/year,
--     6 seats), Firm 549/month (5,490/year, 15 seats); extra seat 25/month (250/year). Annual is
--     ten months. Allowances (matters, storage) are unchanged. The Stripe price-id cache is cleared
--     so Checkout lists the new Prices by lookup key and checks their amounts.
--   * New firms add a card in Stripe Checkout before the trial starts (Stripe runs the 14 days:
--     trial_period_days, payment_method_collection always, missing payment method cancels). Until
--     then sample mode works, and real client invitations and real matters wait (blocker
--     card_required). Firms that started before keep their trial and its end date; if they choose
--     a plan with more than two days left, Stripe's trial ends on that same date.
--   * Stripe's trialing is the 'trial' state (not active), with Stripe's trial dates;
--     cancel_at_period_end is stored; a failed first charge after the trial starts the usual
--     7-day past-due grace, then restricted (new work paused, reads and exports open).
--   * One trial per firm, per owner licence and per card (subscription_trial_claims: SHA-256 of
--     the licence number and of Stripe's card fingerprint; never the number or card itself).
--   * customer.subscription.trial_will_end: one reminder email (EM18c) to the firm owners;
--     invoice.payment_failed / payment_action_required: the billing email (EM18a).
--   * Founding offer: 25% off the first 12 months for the first 50 firms, as a Stripe coupon
--     (max_redemptions 50) Checkout applies automatically.
--   * public.public_pricing(): the catalog, trial and founding offer for the public /pricing page.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------
alter table public.organization_subscriptions
  add column if not exists card_required boolean not null default false,
  add column if not exists trial_used_at timestamptz,
  add column if not exists trial_reminder_at timestamptz,
  add column if not exists cancel_at_period_end boolean not null default false;
comment on column public.organization_subscriptions.card_required is
  'Card trial: the firm has not added a card in Stripe Checkout yet. Real client invitations and real matters wait; sample mode works.';
comment on column public.organization_subscriptions.trial_used_at is
  'Card trial: when this firm''s one Stripe trial started. A firm has one trial.';
comment on column public.organization_subscriptions.trial_reminder_at is
  'Card trial: when Stripe''s trial_will_end notice arrived (one reminder email per trial).';
comment on column public.organization_subscriptions.cancel_at_period_end is
  'Stripe cancel_at_period_end: the subscription ends at the current period end.';

-- ---------------------------------------------------------------------------
-- One trial per licence and per card
-- ---------------------------------------------------------------------------
create table if not exists public.subscription_trial_claims (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  kind text not null check (kind in ('licence', 'card')),
  value_hash text not null check (value_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (kind, value_hash)
);
comment on table public.subscription_trial_claims is
  'Card trial: the licence numbers and cards (SHA-256 only) that already had a Casevoya trial, and the firm that had it. Read and written only by security definer functions.';
create index if not exists subscription_trial_claims_org_idx on public.subscription_trial_claims (organization_id);
alter table public.subscription_trial_claims enable row level security;
alter table public.subscription_trial_claims force row level security;
revoke all on table public.subscription_trial_claims from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Settings: prices, trial, founding offer; clear the price-id cache
-- ---------------------------------------------------------------------------
update public.product_settings
   set value = jsonb_build_object(
         'currency', 'CAD',
         'annual_months', 10,
         'extra_seat_monthly_cents', 2500,
         'solo', coalesce(value -> 'solo', '{}'::jsonb) || jsonb_build_object('monthly_cents', 9900, 'seats', 2),
         'practice', coalesce(value -> 'practice', '{}'::jsonb) || jsonb_build_object('monthly_cents', 24900, 'seats', 6),
         'firm', coalesce(value -> 'firm', '{}'::jsonb) || jsonb_build_object('monthly_cents', 54900, 'seats', 15)
       ),
       pending_confirmation = false,
       description = 'Casevoya plans (CAD, before tax; annual = 10 months). Approved by Francis 2026-10-30.'
 where key = 'subscription.plans';

insert into public.product_settings (key, value, description, pending_confirmation) values
  ('subscription.trial', '{"card_required": true}'::jsonb,
   'Card trial: new firms add a card in Stripe Checkout to start the trial (trial.duration days).', false),
  ('subscription.founding_offer',
   '{"active": true, "percent_off": 25, "months": 12, "max_firms": 50, "coupon_id": "casevoya_founding_25"}'::jsonb,
   'Founding offer: 25% off the first 12 months for the first 50 firms (Stripe coupon casevoya_founding_25, max_redemptions 50), applied by Checkout.', false)
on conflict (key) do nothing;

update public.product_settings
   set value = '{"live": {}, "test": {}}'::jsonb
 where key = 'subscription.stripe_prices';

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function app.trial_card_required()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select (value ->> 'card_required')::boolean from public.product_settings where key = 'subscription.trial'), false);
$$;
revoke all on function app.trial_card_required() from public, anon, authenticated;

-- The trial length in whole days, from trial.duration (0 when it is not set in days).
create or replace function app.trial_days()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case when value ->> 'unit' = 'days' and (value ->> 'count') ~ '^[0-9]{1,3}$' then (value ->> 'count')::integer end
    from public.product_settings where key = 'trial.duration'
  ), 0);
$$;
revoke all on function app.trial_days() from public, anon, authenticated;

-- SHA-256 of each active firm owner's licence (regulator and number, spaces removed, upper case).
create or replace function app.owner_licence_hashes(p_org uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct encode(sha256(convert_to(
           upper(btrim(credential.regulator)) || ':' || upper(regexp_replace(credential.college_id, '\s', '', 'g')), 'UTF8')), 'hex')), array[]::text[])
  from public.consultant_credentials credential
  join public.memberships mem
    on mem.id = credential.membership_id
   and mem.organization_id = credential.organization_id
  where credential.organization_id = p_org
    and mem.role = 'firm_owner'
    and mem.status = 'active'
    and length(btrim(coalesce(credential.college_id, ''))) > 0;
$$;
revoke all on function app.owner_licence_hashes(uuid) from public, anon, authenticated;

-- A plan's catalog price for one billing period, with extra seats (cents, before tax).
create or replace function app.subscription_amount_cents(p_plan text, p_interval text, p_extra_seats integer)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  with c as (select coalesce(app.subscription_plan_catalog(), '{}'::jsonb) as v)
  select case
    when (c.v -> p_plan ->> 'monthly_cents') is null or p_interval not in ('month', 'year') then null
    else ((c.v -> p_plan ->> 'monthly_cents')::bigint
          + greatest(coalesce(p_extra_seats, 0), 0) * coalesce((c.v ->> 'extra_seat_monthly_cents')::bigint, 0))
         * case when p_interval = 'year' then coalesce((c.v ->> 'annual_months')::integer, 12) else 1 end
  end
  from c;
$$;
revoke all on function app.subscription_amount_cents(text, text, integer) from public, anon, authenticated;

-- The public price list (casevoya.ca/pricing and app /pricing): anyone may read it.
create or replace function public.public_pricing()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'catalog', coalesce(app.subscription_plan_catalog(), '{}'::jsonb),
    'trial_days', app.trial_days(),
    'card_required', app.trial_card_required(),
    'founding_offer', (
      select jsonb_build_object('active', coalesce((value ->> 'active')::boolean, false), 'percent_off', value -> 'percent_off',
                                'months', value -> 'months', 'max_firms', value -> 'max_firms')
      from public.product_settings where key = 'subscription.founding_offer'
    )
  );
$$;
revoke all on function public.public_pricing() from public;
grant execute on function public.public_pricing() to anon, authenticated, service_role;


-- ---------------------------------------------------------------------------
-- New firms: status trial, card required, no end date until Stripe starts the trial.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.start_organization_trial()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  duration interval := app.product_setting_interval('trial.duration');
  snapshot jsonb;
  -- Card trial: new firms add a card in Stripe Checkout before the trial clock starts.
  card boolean := app.trial_card_required();
begin
  select value into snapshot from public.product_settings where key = 'trial.duration';
  insert into public.organization_subscriptions (
    organization_id, status, trial_started_at, trial_ends_at, duration_snapshot, card_required
  ) values (
    new.id,
    'trial',
    statement_timestamp(),
    -- Card trial: Stripe sets the end once the card is on file (customer.subscription.created).
    case when card or duration is null then null else statement_timestamp() + duration end,
    snapshot,
    card
  );
  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- The database clock ends only trials Stripe does not run.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.sync_trial_status(p_org uuid)
 RETURNS public.subscription_status
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  sub public.organization_subscriptions%rowtype;
begin
  select * into sub from public.organization_subscriptions where organization_id = p_org;
  if sub.organization_id is null then
    return null;
  end if;
  -- Card trial: a trial with a Stripe subscription ends when Stripe says so (the subscription
  -- turns active, past due or is deleted), never on the database clock.
  if sub.status = 'trial' and sub.stripe_subscription_id is not null then
    return sub.status;
  end if;
  if sub.status = 'trial' and sub.trial_ends_at is not null and sub.trial_ends_at <= statement_timestamp() then
    update public.organization_subscriptions
       set status = 'trial_ended'
     where organization_id = p_org
       and status = 'trial';
    return 'trial_ended';
  end if;
  return sub.status;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Go-live blockers: card_required after trial_ended (src/modules/sheet/setup-present.ts mirrors it).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.real_client_invite_blockers(p_org uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  -- Card trial: real client invitations start once a card is on file (Stripe Checkout).
  if exists (
    select 1 from public.organization_subscriptions sub
    where sub.organization_id = p_org
      and sub.status = 'trial'
      and sub.card_required
  ) then
    blockers := array_append(blockers, 'card_required');
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
$function$;

-- ---------------------------------------------------------------------------
-- Entitlements: plan allowances during a Stripe trial; card_required for a firm with no card yet.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.subscription_entitlements(p_org uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  -- Card trial: a Stripe trial on a chosen plan has that plan's allowances.
  if sub.plan is not null and (status in ('active', 'past_due', 'restricted', 'cancelled', 'archived')
     or (status = 'trial' and sub.stripe_subscription_id is not null)) then
    if sub.plan = 'enterprise' then
      return jsonb_build_object(
        'status', status, 'plan', 'enterprise', 'basis', 'enterprise', 'seats', null, 'matters', null, 'storage_gb', null,
        'extra_seats', sub.extra_seats, 'new_work_blocked', status in ('restricted', 'cancelled', 'archived')
      );
    end if;
    basis := 'plan';
    plan_key := sub.plan::text;
  else
    -- No plan yet: nothing is limited until one is chosen.
    return jsonb_build_object(
      'status', status, 'plan', null, 'basis', 'trial', 'seats', null, 'matters', null, 'storage_gb', null,
      'extra_seats', 0, 'new_work_blocked', status in ('restricted', 'cancelled', 'archived'),
      'checkout_required', status = 'trial' and sub.card_required
    );
  end if;
  seats := (catalog -> plan_key ->> 'seats')::integer;
  matters := (catalog -> plan_key ->> 'matters')::integer;
  storage := (catalog -> plan_key ->> 'storage_gb')::integer;
  return jsonb_build_object(
    'status', status,
    'plan', sub.plan::text,
    'basis', basis,
    'seats', case when seats is null then null else seats + sub.extra_seats end,
    'matters', matters,
    'storage_gb', storage,
    'extra_seats', sub.extra_seats,
    'new_work_blocked', status in ('restricted', 'cancelled', 'archived')
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- Real matters wait for the card (sample matters do not).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_engaged_matter(p_title text, p_is_sample boolean, p_consultant_membership_id uuid, p_rule_pack_version_id uuid DEFAULT NULL::uuid, p_scope text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
    -- Card trial: real matters start once a card is on file; sample matters always work.
    if coalesce((entitlements ->> 'checkout_required')::boolean, false) then
      raise exception 'card required: add a card to start your trial in Settings > Subscription before opening a real matter' using errcode = '42501';
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
$function$;

-- ---------------------------------------------------------------------------
-- Checkout: the trial this firm may have and the founding coupon. A Stripe trial is changed in the portal.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.subscription_checkout_allowed(p_organization_id uuid, p_plan public.subscription_plan, p_interval public.billing_interval, p_extra_seats integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  sub public.organization_subscriptions%rowtype;
  org public.organizations%rowtype;
  catalog jsonb := coalesce(app.subscription_plan_catalog(), '{}'::jsonb);
  key uuid := gen_random_uuid();
  actor_email text;
  -- Card trial
  trial_days integer := 0;
  trial_end timestamptz;
  trial_reason text := 'none';
  founding jsonb := coalesce((select setting.value from public.product_settings setting where setting.key = 'subscription.founding_offer'), '{}'::jsonb);
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
  if sub.stripe_subscription_id is not null and sub.status in ('active', 'past_due', 'restricted', 'trial') then
    raise exception 'the current subscription is changed in the billing portal' using errcode = '22023';
  end if;
  select * into org from public.organizations where id = p_organization_id;

  -- Card trial: one trial per firm, per owner licence and (checked by the webhook) per card.
  if sub.status = 'trial' and sub.trial_used_at is null then
    if sub.card_required then
      if exists (
        select 1 from public.subscription_trial_claims claim
        where claim.kind = 'licence'
          and claim.organization_id <> p_organization_id
          and claim.value_hash = any (app.owner_licence_hashes(p_organization_id))
      ) then
        trial_reason := 'licence_used';
      else
        trial_days := app.trial_days();
        trial_reason := case when trial_days > 0 then 'new' else 'none' end;
      end if;
    elsif sub.trial_ends_at is not null and sub.trial_ends_at > statement_timestamp() + interval '2 days 1 hour' then
      -- A firm that started before cards were required keeps the days it has left.
      trial_end := sub.trial_ends_at;
      trial_reason := 'remaining';
    end if;
  elsif sub.trial_used_at is not null then
    trial_reason := 'firm_used';
  end if;
  select u.email into actor_email from auth.users u where u.id = (select auth.uid());

  insert into public.subscription_events (organization_id, kind, payload)
  values (
    p_organization_id,
    'checkout.requested',
    jsonb_build_object('plan', p_plan, 'interval', p_interval, 'extra_seats', p_extra_seats, 'idempotency_key', key)
  );
  perform app.record_audit_event(
    p_organization_id, 'subscription.checkout_requested', 'public.organization_subscriptions', p_organization_id, 'success',
    jsonb_build_object('plan', p_plan, 'interval', p_interval, 'extra_seats', p_extra_seats, 'idempotency_key', key, 'trial', trial_reason)
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
    'catalog', catalog,
    'trial_days', trial_days,
    'trial_end', trial_end,
    'trial_reason', trial_reason,
    'founding_coupon', case when coalesce((founding ->> 'active')::boolean, false) and coalesce(founding ->> 'coupon_id', '') ~ '^[A-Za-z0-9_-]{3,60}$' then founding ->> 'coupon_id' end,
    'founding_percent', case when coalesce(founding ->> 'percent_off', '') ~ '^[0-9]{1,2}$' then (founding ->> 'percent_off')::integer end,
    'founding_months', case when coalesce(founding ->> 'months', '') ~ '^[0-9]{1,2}$' then (founding ->> 'months')::integer end,
    'time_zone', org.timezone
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- Webhook: trialing is 'trial'; trial dates, cancel at period end, repeat trials, reminders and
-- failed-payment mail. Base: 20261031013000_stripe_billing_event_binding.sql (round 3).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_stripe_subscription_event(p_event jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  detail text;
  before_status public.subscription_status;
  next_status public.subscription_status;
  stripe_status text;
  event_plan public.subscription_plan;
  event_interval public.billing_interval;
  now_at timestamptz := statement_timestamp();
  -- Billing
  event_created bigint;
  event_sub text;
  inv_sub text;
  paid boolean;
  stale boolean := false;
  stored_ended boolean := false;
  grants boolean := true;
  restore boolean := false;
  own_invoice boolean := false;
  -- Card trial
  card_hash text;
  repeat_trial boolean := false;
  is_trial boolean;
  mail_payload jsonb;
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
  if org is null then
    update public.webhook_inbox set status = 'ignored', processed_at = clock_timestamp() where id = inbox_id;
    return jsonb_build_object('outcome', 'ignored', 'reason', 'unknown_firm');
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

  -- Billing: event time, subscription ids, ordering and the stored subscription's state.
  if coalesce(p_event ->> 'created', '') ~ '^[0-9]{1,12}$' then
    event_created := (p_event ->> 'created')::bigint;
  end if;
  if coalesce(s ->> 'id', '') ~ '^sub_[A-Za-z0-9]{6,250}$' then
    event_sub := s ->> 'id';
  end if;
  if coalesce(inv ->> 'subscription', '') ~ '^sub_[A-Za-z0-9]{6,250}$' then
    inv_sub := inv ->> 'subscription';
  end if;
  stale := event_created is not null and sub.last_stripe_event_created is not null
    and event_created < sub.last_stripe_event_created;
  stored_ended := app.stripe_subscription_ended(org, sub.stripe_subscription_id, event_id);

  if event_type in ('checkout.session.completed', 'checkout.session.async_payment_succeeded') then
    -- A summary without payment_status comes from the app version before this change (deploy
    -- window only); it is treated as before (paid). Current summaries always carry the field.
    paid := case when s ? 'payment_status'
                 then coalesce(s ->> 'payment_status', '') in ('paid', 'no_payment_required')
                 else true end;
    if stale then
      outcome := 'ignored';
      detail := 'stale_event';
    elsif app.stripe_subscription_ended(org, event_sub, event_id) then
      outcome := 'ignored';
      detail := 'subscription_ended';
    elsif not paid then
      -- Billing: no access until Stripe reports the payment. The subscription id is kept when no
      -- other live subscription is stored, so its later events apply.
      if sub.stripe_subscription_id is null or stored_ended or event_sub is not distinct from sub.stripe_subscription_id then
        update public.organization_subscriptions
           set stripe_customer_id = coalesce(stripe_customer_id, customer),
               stripe_subscription_id = coalesce(event_sub, stripe_subscription_id),
               last_stripe_event_created = greatest(last_stripe_event_created, event_created)
         where organization_id = org;
        detail := 'awaiting_payment';
      else
        outcome := 'ignored';
        detail := 'other_subscription';
      end if;
    else
      update public.organization_subscriptions
         set stripe_customer_id = coalesce(stripe_customer_id, customer),
             stripe_subscription_id = coalesce(event_sub, stripe_subscription_id),
             plan = coalesce(event_plan, plan),
             billing_interval = coalesce(event_interval, billing_interval),
             extra_seats = coalesce((s ->> 'extra_seats')::integer, extra_seats),
             status = case when status in ('active', 'past_due', 'restricted') then status
                           when coalesce((s ->> 'trial')::boolean, false) then 'trial'
                           else 'active' end,
             -- Card trial: Checkout collected the card.
             card_required = false,
             trial_used_at = case when coalesce((s ->> 'trial')::boolean, false) then coalesce(trial_used_at, now_at) else trial_used_at end,
             cancelled_at = null, cancel_at = null, archived_at = null,
             last_stripe_event_created = greatest(last_stripe_event_created, event_created)
       where organization_id = org;
    end if;
  elsif event_type = 'checkout.session.async_payment_failed' then
    if stale then
      outcome := 'ignored';
      detail := 'stale_event';
    elsif event_sub is distinct from sub.stripe_subscription_id then
      outcome := 'ignored';
      detail := 'other_subscription';
    else
      update public.organization_subscriptions
         set latest_invoice_status = 'payment_failed',
             status = case when status = 'active' then 'past_due' else status end,
             past_due_since = case when status = 'active' then coalesce(past_due_since, now_at) else past_due_since end,
             last_stripe_event_created = greatest(last_stripe_event_created, event_created)
       where organization_id = org;
    end if;
  elsif event_type in ('customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted') then
    if stale then
      outcome := 'ignored';
      detail := 'stale_event';
    elsif app.stripe_subscription_ended(org, event_sub, event_id) then
      outcome := 'ignored';
      detail := 'subscription_ended';
    elsif sub.stripe_subscription_id is not null
          and event_sub is distinct from sub.stripe_subscription_id
          and not (stored_ended and event_sub is not null) then
      outcome := 'ignored';
      detail := 'other_subscription';
    else
      stripe_status := case when event_type = 'customer.subscription.deleted' then 'canceled' else s ->> 'status' end;
      -- Billing: an incomplete subscription grants no plan.
      grants := coalesce(stripe_status, '') not in ('incomplete', 'incomplete_expired');
      next_status := case stripe_status
        when 'active' then 'active'
        -- Card trial: trialing is its own state (Stripe runs the clock).
        when 'trialing' then 'trial'
        when 'past_due' then 'past_due'
        when 'unpaid' then 'past_due'
        when 'canceled' then 'cancelled'
        when 'incomplete_expired' then case when sub.status in ('active', 'past_due', 'restricted') then 'cancelled'::public.subscription_status end
        else null
      end;
      if next_status = 'past_due' and sub.status = 'restricted' then
        next_status := 'restricted';
      end if;
      -- Card trial: a trial cancelled before it converted ends the trial (no export window starts).
      if next_status = 'cancelled' and sub.status in ('trial', 'trial_ended') then
        next_status := 'trial_ended';
      end if;
      -- Card trial: one trial per card. A card (Stripe fingerprint, hashed by the server) that
      -- already had a Casevoya trial at another firm ends this trial now; the server tells Stripe.
      if coalesce(s ->> 'card_hash', '') ~ '^[0-9a-f]{64}$' then
        card_hash := s ->> 'card_hash';
      end if;
      if next_status = 'trial' then
        repeat_trial := (card_hash is not null and exists (
            select 1 from public.subscription_trial_claims claim
            where claim.kind = 'card' and claim.value_hash = card_hash and claim.organization_id <> org))
          or exists (
            select 1 from public.subscription_trial_claims claim
            where claim.kind = 'licence' and claim.organization_id <> org
              and claim.value_hash = any (app.owner_licence_hashes(org)));
        if not repeat_trial then
          insert into public.subscription_trial_claims (organization_id, kind, value_hash)
          select org, 'licence', hash from unnest(app.owner_licence_hashes(org)) hash
          on conflict (kind, value_hash) do nothing;
          if card_hash is not null then
            insert into public.subscription_trial_claims (organization_id, kind, value_hash)
            values (org, 'card', card_hash)
            on conflict (kind, value_hash) do nothing;
          end if;
        else
          detail := 'repeat_trial';
        end if;
      end if;
      update public.organization_subscriptions
         set stripe_customer_id = coalesce(stripe_customer_id, customer),
             stripe_subscription_id = coalesce(event_sub, stripe_subscription_id),
             plan = case when grants then coalesce(event_plan, plan) else plan end,
             billing_interval = case when grants then coalesce(event_interval, billing_interval) else billing_interval end,
             extra_seats = case when grants then coalesce((s ->> 'extra_seats')::integer, extra_seats) else extra_seats end,
             current_period_end = case when grants then coalesce((s ->> 'current_period_end')::timestamptz, current_period_end) else current_period_end end,
             cancel_at = case when next_status = 'cancelled' then null when grants then (s ->> 'cancel_at')::timestamptz else cancel_at end,
             -- Card trial: Stripe's trial dates, the card on file and cancel at period end.
             trial_started_at = case when next_status = 'trial' then coalesce((s ->> 'trial_start')::timestamptz, trial_started_at) else trial_started_at end,
             trial_ends_at = case when next_status = 'trial' then coalesce((s ->> 'trial_end')::timestamptz, trial_ends_at)
                                  when next_status = 'trial_ended' then least(coalesce(trial_ends_at, now_at), now_at)
                                  else trial_ends_at end,
             trial_used_at = case when next_status = 'trial' then coalesce(trial_used_at, now_at) else trial_used_at end,
             card_required = case when next_status in ('trial', 'active', 'past_due') then false else card_required end,
             cancel_at_period_end = case when next_status in ('cancelled', 'trial_ended') then false when grants then coalesce((s ->> 'cancel_at_period_end')::boolean, false) else cancel_at_period_end end,
             status = coalesce(next_status, status),
             cancelled_at = case when next_status = 'cancelled' then coalesce((s ->> 'canceled_at')::timestamptz, now_at) when next_status in ('active', 'trial') then null else cancelled_at end,
             past_due_since = case when next_status = 'past_due' then coalesce(past_due_since, now_at) when next_status in ('active', 'trial') then null else past_due_since end,
             restricted_at = case when next_status in ('active', 'trial') then null else restricted_at end,
             archived_at = case when next_status in ('active', 'trial') then null else archived_at end,
             last_stripe_event_created = greatest(last_stripe_event_created, event_created)
       where organization_id = org;
    end if;
  elsif event_type = 'customer.subscription.trial_will_end' then
    -- Card trial: Stripe's notice (3 days before the trial ends). The in-app banner reads
    -- trial_ends_at; the firm owners get one reminder email (EM18c) per trial.
    if event_sub is null or event_sub is distinct from sub.stripe_subscription_id then
      outcome := 'ignored';
      detail := 'other_subscription';
    elsif sub.status <> 'trial' then
      outcome := 'ignored';
      detail := 'not_trialing';
    else
      update public.organization_subscriptions
         set trial_ends_at = coalesce((s ->> 'trial_end')::timestamptz, trial_ends_at),
             trial_reminder_at = coalesce(trial_reminder_at, now_at)
       where organization_id = org;
      if sub.trial_reminder_at is null then
        select * into sub from public.organization_subscriptions where organization_id = org;
        mail_payload := jsonb_build_object('trial_end', sub.trial_ends_at, 'plan', sub.plan, 'interval', sub.billing_interval, 'extra_seats', sub.extra_seats);
        perform app.enqueue_event(org, 'organization_subscription', org, 'subscription.trial_will_end', mail_payload, null, 'trial_will_end:' || event_sub, null);
      end if;
    end if;
  elsif event_type = 'invoice.payment_action_required' and (inv ->> 'id') ~ '^in_[A-Za-z0-9]{6,250}$' then
    -- Card trial: the bank asks the firm to confirm the payment (3-D Secure). No state change; the
    -- owners get the billing email once per invoice.
    if inv_sub is not null and inv_sub is distinct from sub.stripe_subscription_id then
      outcome := 'ignored';
      detail := 'other_subscription';
    else
      perform app.enqueue_event(org, 'organization_subscription', org, 'subscription.payment_failed',
        jsonb_build_object('invoice', inv ->> 'id'), null, 'billing_payment_failed:' || (inv ->> 'id'), null);
    end if;
  elsif event_type in ('invoice.paid', 'invoice.payment_failed') and (inv ->> 'id') ~ '^in_[A-Za-z0-9]{6,250}$' then
    insert into public.subscription_invoices (
      organization_id, stripe_invoice_id, number, status, amount_due_cents, amount_paid_cents, currency,
      period_start, period_end, hosted_invoice_url, pdf_url, stripe_created_at, stripe_subscription_id
    ) values (
      org, inv ->> 'id', left(inv ->> 'number', 60), coalesce(nullif(inv ->> 'status', ''), 'open'),
      greatest(0, coalesce((inv ->> 'amount_due')::bigint, 0)), greatest(0, coalesce((inv ->> 'amount_paid')::bigint, 0)),
      lower(coalesce(nullif(inv ->> 'currency', ''), 'cad')),
      (inv ->> 'period_start')::timestamptz, (inv ->> 'period_end')::timestamptz,
      nullif(inv ->> 'hosted_invoice_url', ''), nullif(inv ->> 'pdf_url', ''),
      coalesce((inv ->> 'created')::timestamptz, now_at), inv_sub
    )
    on conflict (stripe_invoice_id) do update
      set number = coalesce(excluded.number, public.subscription_invoices.number),
          status = excluded.status,
          amount_due_cents = excluded.amount_due_cents,
          amount_paid_cents = excluded.amount_paid_cents,
          period_start = coalesce(excluded.period_start, public.subscription_invoices.period_start),
          period_end = coalesce(excluded.period_end, public.subscription_invoices.period_end),
          hosted_invoice_url = coalesce(excluded.hosted_invoice_url, public.subscription_invoices.hosted_invoice_url),
          pdf_url = coalesce(excluded.pdf_url, public.subscription_invoices.pdf_url),
          stripe_subscription_id = coalesce(public.subscription_invoices.stripe_subscription_id, excluded.stripe_subscription_id);
    own_invoice := inv_sub is not null and inv_sub = sub.stripe_subscription_id;
    if stale then
      -- Billing: the invoice is recorded; an older event does not move the firm's state.
      detail := 'stale_event';
    elsif event_type = 'invoice.paid' then
      -- Billing: only a real payment on the stored subscription, with nothing of it left unpaid,
      -- lifts past due or restricted.
      restore := own_invoice
        and sub.status in ('past_due', 'restricted')
        and greatest(0, coalesce((inv ->> 'amount_paid')::bigint, 0)) > 0
        and coalesce((inv ->> 'amount_remaining')::bigint, 0) = 0
        and not exists (
          select 1 from public.subscription_invoices other
          where other.organization_id = org
            and other.stripe_subscription_id = inv_sub
            and other.stripe_invoice_id <> (inv ->> 'id')
            and other.status in ('open', 'uncollectible')
        );
      if sub.status in ('past_due', 'restricted') and not restore then
        detail := 'not_restored';
      end if;
      update public.organization_subscriptions
         set stripe_customer_id = coalesce(stripe_customer_id, customer),
             latest_invoice_status = case when restore or status not in ('past_due', 'restricted') then 'paid' else latest_invoice_status end,
             latest_invoice_url = case when inv_sub is null or own_invoice then coalesce(nullif(inv ->> 'hosted_invoice_url', ''), latest_invoice_url) else latest_invoice_url end,
             status = case when restore then 'active' else status end,
             past_due_since = case when restore then null else past_due_since end,
             restricted_at = case when restore then null else restricted_at end,
             current_period_end = case when own_invoice then coalesce((inv ->> 'period_end')::timestamptz, current_period_end) else current_period_end end,
             last_stripe_event_created = case when restore then greatest(last_stripe_event_created, event_created) else last_stripe_event_created end
       where organization_id = org;
    elsif inv_sub is not null and not own_invoice then
      detail := 'other_subscription';
    else
      update public.organization_subscriptions
         set stripe_customer_id = coalesce(stripe_customer_id, customer),
             latest_invoice_status = 'payment_failed',
             latest_invoice_url = coalesce(nullif(inv ->> 'hosted_invoice_url', ''), latest_invoice_url),
             -- Card trial: the first charge after a trial failing starts the same 7-day grace.
             status = case when status in ('active', 'trial') then 'past_due' else status end,
             past_due_since = case when status in ('active', 'trial') then now_at else past_due_since end,
             last_stripe_event_created = case when status in ('active', 'trial') then greatest(last_stripe_event_created, event_created) else last_stripe_event_created end
       where organization_id = org;
      -- Card trial: the firm owners get the billing email (EM18a) once per invoice.
      perform app.enqueue_event(org, 'organization_subscription', org, 'subscription.payment_failed',
        jsonb_build_object('invoice', inv ->> 'id'), null, 'billing_payment_failed:' || (inv ->> 'id'), null);
    end if;
  else
    outcome := 'ignored';
  end if;

  update public.organization_subscriptions set last_webhook_event_id = event_id where organization_id = org;
  select * into sub from public.organization_subscriptions where organization_id = org;
  perform app.record_audit_event(
    org, 'subscription.webhook_applied', 'public.organization_subscriptions', org, 'success',
    jsonb_build_object('event_id', event_id, 'event_type', event_type, 'outcome', outcome, 'detail', detail, 'status_before', before_status, 'status_after', sub.status)
  );
  update public.webhook_inbox
     set status = case when outcome = 'ignored' then 'ignored'::public.webhook_inbox_status else 'processed'::public.webhook_inbox_status end,
         processed_at = clock_timestamp(),
         organization_id = org
   where id = inbox_id;
  return jsonb_build_object('outcome', outcome, 'status', sub.status)
    -- Card trial: the server ends a repeat trial at Stripe (trial_end now).
    || case when repeat_trial and event_sub is not null then jsonb_build_object('end_trial', event_sub) else '{}'::jsonb end
    || case when outcome = 'ignored' and detail is not null then jsonb_build_object('reason', detail) else '{}'::jsonb end;
end;
$function$;
revoke all on function public.apply_stripe_subscription_event(jsonb) from public, anon, authenticated;
grant execute on function public.apply_stripe_subscription_event(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Mail worker: the two billing events.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_mail_events(p_worker text, p_limit integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  claimed jsonb;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') is distinct from 'service_role' then
    raise exception 'worker role required' using errcode = '42501';
  end if;
  if p_worker is null or length(btrim(p_worker)) < 1 then
    raise exception 'worker name is required' using errcode = '22023';
  end if;

  with due as (
    select c.id
    from public.outbox_events c
    where c.event_type = any (array[
      'portal_invitation.email_requested',
      'staff_invitation.email_requested',
      'reminder.due',
      'agreement.sent',
      'agreement.executed',
      -- firm countersign: a staff signer's turn.
      'agreement.signer_turn',
      'document.request_created',
      'document.uploaded',
      'document.reviewed',
      -- email designs: invoice, payment and refund mail.
      'invoice.issued',
      'invoice.payment_failed',
      'invoice.refund_started',
      'invoice.refund_succeeded',
      -- New (20261025530100): EX20, a refund the client was told about failed afterwards.
      'invoice.refund_failed',
      -- scheduling: consultation booked, moved, cancelled.
      'booking.confirmed',
      'booking.rescheduled',
      'booking.cancelled',
      -- matter messaging: EX07 generic notice of a staff message.
      'message.sent',
      -- inbox replies: EX15, an email a staff member wrote.
      'matter_email.sent',
      -- support access: EX11 asked, EM17 approved.
      'support_access.requested',
      'support_access.approved',
      -- consultation agreements: EM08 with the booking's private signing link.
      'booking_agreement.sent',
      -- signing flow: EX16, the sealed six-digit signing code.
      'booking_agreement.code',
      -- ORG-06: EX17, the matter's consultant changed.
      'matter.consultant_changed',
      -- CRM-01: EX18, a new web enquiry, to the firm's owners.
      'lead.enquiry_received',
      -- OPS-04: EX19, an announcement to many clients.
      'announcement.sent',
      -- Card trial: EM18c trial ending and EM18a billing payment failed, to the firm owners.
      'subscription.trial_will_end',
      'subscription.payment_failed'
    ])
      and (
        (c.status in ('pending', 'failed') and c.available_at <= clock_timestamp())
        or (c.status = 'processing' and c.locked_at < clock_timestamp() - interval '5 minutes')
      )
      -- sealed invitation link: wait for it, or send the linkless email after 10 minutes.
      and (
        c.event_type not in ('portal_invitation.email_requested', 'staff_invitation.email_requested')
        or c.payload ? 'sealed_link'
        or c.occurred_at < clock_timestamp() - interval '10 minutes'
      )
    order by c.available_at, c.occurred_at
    limit least(greatest(coalesce(p_limit, 20), 1), 50)
    for update skip locked
  ),
  locked as (
    update public.outbox_events event
       set status = 'processing',
           locked_at = clock_timestamp(),
           locked_by = left(btrim(p_worker), 200),
           attempts = event.attempts + 1
     where event.id in (select due.id from due)
    returning event.id, event.organization_id, event.event_type, event.payload, event.attempts
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', locked.id,
    'organization_id', locked.organization_id,
    'event_type', locked.event_type,
    'payload', locked.payload,
    'attempts', locked.attempts
  )), '[]'::jsonb)
  into claimed
  from locked;
  return claimed;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Mail: recipients and context of the two billing emails.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prepare_email_delivery(p_event_id uuid, p_worker text, p_inbound_domain text DEFAULT NULL::text, p_from_address text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  event public.outbox_events%rowtype;
  firm_name text;
  firm_slug text;
  domain text;
  from_addr text;
  matter uuid;
  template public.email_template;
  critical boolean;
  reply text;
  messages jsonb;
  rec record;
  send_ok boolean;
  ctx jsonb;
  inviter text;
  payer uuid;
  payer_known boolean;
  -- inbox replies: the staff email, and what its message carries besides the context.
  outbound public.matter_outbound_emails%rowtype;
  in_reply_to text;
  extra jsonb := '{}'::jsonb;
  -- support access: the request the event is about.
  support_req public.support_access_requests%rowtype;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') is distinct from 'service_role' then
    raise exception 'worker role required' using errcode = '42501';
  end if;
  select * into event from public.outbox_events where id = p_event_id;
  if event.id is null then
    raise exception 'mail event was not found' using errcode = '42501';
  end if;
  if event.status = 'published' then
    return jsonb_build_object('action', 'done', 'event_id', event.id, 'messages', '[]'::jsonb);
  end if;
  if event.status is distinct from 'processing'
     or event.locked_by is distinct from left(btrim(coalesce(p_worker, '')), 200) then
    raise exception 'mail event is not claimed' using errcode = '42501';
  end if;

  domain := app.inbound_domain(p_inbound_domain);
  from_addr := lower(btrim(coalesce(
    nullif(p_from_address, ''),
    (select value ->> 'address' from public.product_settings where key = 'email.from_address'),
    'notices@casevoya.ca'
  )));
  if from_addr !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    from_addr := 'notices@casevoya.ca';
  end if;
  select display_name, slug into firm_name, firm_slug
  from public.organizations
  where id = event.organization_id;

  matter := null;
  if coalesce(event.payload ->> 'matter_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    matter := (event.payload ->> 'matter_id')::uuid;
  end if;

  if event.event_type = 'document.reviewed'
     and coalesce(event.payload ->> 'decision', '') is distinct from 'accepted' then
    perform app.mark_outbox_published(event.id, p_worker);
    perform app.record_audit_event(
      event.organization_id, 'email.skipped', 'public.outbox_events', event.id, 'success',
      jsonb_build_object('reason', 'review_not_accepted')
    );
    return jsonb_build_object('action', 'done', 'event_id', event.id, 'messages', '[]'::jsonb);
  end if;

  -- New (20261025530100): "Your refund is complete" (EX10) is no longer sent. A card refund Stripe
  -- reports succeeded can still fail later (Stripe: up to 30 days), and Stripe sends no final
  -- signal. An event already queued before this change is skipped, not sent.
  if event.event_type = 'invoice.refund_succeeded' then
    perform app.mark_outbox_published(event.id, p_worker);
    perform app.record_audit_event(
      event.organization_id, 'email.skipped', 'public.outbox_events', event.id, 'success',
      jsonb_build_object('reason', 'refund_not_final')
    );
    return jsonb_build_object('action', 'done', 'event_id', event.id, 'messages', '[]'::jsonb);
  end if;

  template := case event.event_type
    when 'portal_invitation.email_requested' then 'invite'::public.email_template
    when 'staff_invitation.email_requested' then 'invite'::public.email_template
    when 'reminder.due' then 'reminder'::public.email_template
    when 'agreement.sent' then 'agreement'::public.email_template
    when 'agreement.executed' then 'signature'::public.email_template
    -- firm countersign: the staff signer's turn uses the agreement template, staff copy.
    when 'agreement.signer_turn' then 'agreement'::public.email_template
    when 'document.request_created' then 'document_request'::public.email_template
    when 'document.uploaded' then 'document_receipt'::public.email_template
    when 'document.reviewed' then 'document_receipt'::public.email_template
    -- email designs: invoice, payment and refund mail.
    when 'invoice.issued' then 'invoice'::public.email_template
    when 'invoice.payment_failed' then 'payment_failed'::public.email_template
    when 'invoice.refund_started' then 'refund_started'::public.email_template
    when 'invoice.refund_succeeded' then 'refund_complete'::public.email_template
    -- New (20261025530100): EX20, the refund correction.
    when 'invoice.refund_failed' then 'refund_failed'::public.email_template
    -- scheduling: EM16a / EM16b / EM16c.
    when 'booking.confirmed' then 'consultation_booked'::public.email_template
    when 'booking.rescheduled' then 'consultation_rescheduled'::public.email_template
    when 'booking.cancelled' then 'consultation_cancelled'::public.email_template
    -- matter messaging: EX07, the generic "New message" notice.
    when 'message.sent' then 'message'::public.email_template
    -- inbox replies: EX15, the staff member's own words.
    when 'matter_email.sent' then 'staff_message'::public.email_template
    -- support access: EX11 asked, EM17 approved.
    when 'support_access.requested' then 'support_requested'::public.email_template
    when 'support_access.approved' then 'support_granted'::public.email_template
    -- consultation agreements: the agreement template (EM08), booking variant.
    when 'booking_agreement.sent' then 'agreement'::public.email_template
    -- signing flow: EX16, the signing code.
    when 'booking_agreement.code' then 'signing_code'::public.email_template
    -- ORG-06: EX17, the matter's consultant changed.
    when 'matter.consultant_changed' then 'consultant_changed'::public.email_template
    -- CRM-01: EX18, a new web enquiry.
    when 'lead.enquiry_received' then 'enquiry_received'::public.email_template
    -- OPS-04: EX19, a new notice (announcement).
    when 'announcement.sent' then 'announcement'::public.email_template
    -- Card trial: EM18c and EM18a.
    when 'subscription.trial_will_end' then 'trial_ending'::public.email_template
    when 'subscription.payment_failed' then 'billing_payment_failed'::public.email_template
    else null
  end;
  if template is null then
    raise exception 'event is not a mail event' using errcode = '22023';
  end if;

  critical := template in ('invite', 'agreement', 'signature', 'document_request', 'document_receipt');
  ctx := jsonb_build_object('firm', firm_name, 'template', template);

  -- sealed invitation link: the worker decrypts it; it stays well under the 2000-byte context cap.
  if event.event_type in ('portal_invitation.email_requested', 'staff_invitation.email_requested')
     and length(coalesce(event.payload ->> 'sealed_link', '')) between 1 and 1024 then
    ctx := ctx || jsonb_build_object(
      'sealed_link', event.payload ->> 'sealed_link',
      'invitation_id', event.payload ->> 'invitation_id'
    );
  end if;

  if event.event_type = 'portal_invitation.email_requested' then
    ctx := ctx || jsonb_build_object('kind', 'portal', 'role', event.payload ->> 'role');
    -- email designs: who invited them, for the heading.
    select left(nullif(btrim(profile.display_name), ''), 120) into inviter
    from public.portal_invitations inv
    join public.profiles profile on profile.id = inv.created_by
    where inv.id::text = event.payload ->> 'invitation_id'
      and inv.organization_id = event.organization_id;
    if inviter is not null then
      ctx := ctx || jsonb_build_object('inviter', inviter);
    end if;
    perform app.queue_email_delivery(
      event.id, event.organization_id, event.payload ->> 'recipient_email',
      template, matter, true, ctx, true
    );
  elsif event.event_type = 'staff_invitation.email_requested' then
    ctx := ctx || jsonb_build_object('kind', 'staff', 'role', event.payload ->> 'role');
    -- email designs: who invited them, for the heading.
    select left(nullif(btrim(profile.display_name), ''), 120) into inviter
    from public.invitations inv
    join public.profiles profile on profile.id = inv.created_by
    where inv.id::text = event.payload ->> 'invitation_id'
      and inv.organization_id = event.organization_id;
    if inviter is not null then
      ctx := ctx || jsonb_build_object('inviter', inviter);
    end if;
    perform app.queue_email_delivery(
      event.id, event.organization_id, event.payload ->> 'recipient_email',
      template, null, true, ctx, true
    );
  elsif event.event_type = 'reminder.due' then
    critical := coalesce(event.payload ->> 'reminder_kind', '') = 'immediate'
      or exists (
        select 1
        from public.deadlines deadline
        where deadline.id::text = event.payload ->> 'deadline_id'
          and deadline.kind in ('legal', 'correspondence')
      );
    ctx := ctx || jsonb_build_object(
      'reminder_kind', coalesce(event.payload ->> 'reminder_kind', 'routine'),
      'due_on', (
        select to_char(deadline.due_on, 'YYYY-MM-DD')
        from public.deadlines deadline
        where deadline.id::text = event.payload ->> 'deadline_id'
      )
    );
    for rec in
      select person.email,
             coalesce(pref.deadline_reminders, false) as deadline_reminders,
             pref.email_notices as email_notices
      from public.persons person
      join public.matter_participants party
        on party.person_id = person.id
       and party.matter_id = matter
       and party.organization_id = event.organization_id
      left join public.person_contact_preferences pref
        on pref.person_id = person.id
      where person.organization_id = event.organization_id
        and person.email is not null
        and matter is not null
    loop
      send_ok := coalesce(event.payload ->> 'reminder_kind', '') = 'immediate'
        or (rec.deadline_reminders and rec.email_notices is distinct from false);
      perform app.queue_email_delivery(
        event.id, event.organization_id, rec.email, template, matter, critical, ctx, send_ok
      );
    end loop;
  elsif event.event_type in ('agreement.sent', 'agreement.executed') then
    ctx := ctx || jsonb_build_object('agreement_kind', (
      select agreement.kind
      from public.signature_envelopes envelope
      join public.agreements agreement on agreement.id = envelope.agreement_id
      where envelope.id::text = event.payload ->> 'envelope_id'
    ));
    for rec in
      select lower(coalesce(person.email, users.email)) as email,
             signer.person_id is null as staff
      from public.envelope_signers signer
      left join public.persons person on person.id = signer.person_id
      left join public.memberships membership on membership.id = signer.membership_id
      left join auth.users users on users.id = membership.user_id
      where signer.envelope_id::text = event.payload ->> 'envelope_id'
        and signer.organization_id = event.organization_id
        -- firm countersign: staff signers hear when it is their turn (agreement.signer_turn), not at send.
        and (event.event_type = 'agreement.executed' or signer.person_id is not null)
    loop
      -- email designs: a staff signer's executed copy links to the Sheet, not the portal.
      perform app.queue_email_delivery(
        event.id, event.organization_id, rec.email, template, matter, true,
        case when rec.staff then ctx || jsonb_build_object('audience', 'staff') else ctx end,
        true
      );
    end loop;
  -- firm countersign: the staff signer whose turn it is, while it still is, gets the Sheet link.
  elsif event.event_type = 'agreement.signer_turn' then
    ctx := ctx || jsonb_build_object(
      'audience', 'staff',
      'agreement_kind', (
        select agreement.kind
        from public.signature_envelopes envelope
        join public.agreements agreement on agreement.id = envelope.agreement_id
        where envelope.id::text = event.payload ->> 'envelope_id'
      )
    );
    for rec in
      select lower(users.email) as email
      from public.envelope_signers signer
      join public.signature_envelopes envelope
        on envelope.id = signer.envelope_id
       and envelope.organization_id = signer.organization_id
      join public.memberships membership
        on membership.id = signer.membership_id
       and membership.organization_id = signer.organization_id
       and membership.status = 'active'
      join auth.users users on users.id = membership.user_id
      where signer.id::text = event.payload ->> 'signer_id'
        and signer.envelope_id::text = event.payload ->> 'envelope_id'
        and signer.organization_id = event.organization_id
        and signer.status = 'current'
        and envelope.status in ('sent', 'partially_signed')
        and envelope.expires_at > statement_timestamp()
    loop
      perform app.queue_email_delivery(
        event.id, event.organization_id, rec.email, template, matter, true, ctx, true
      );
    end loop;
  elsif event.event_type = 'document.request_created' then
    -- email designs: the due date only; the request's purpose names the document and stays out of mail.
    ctx := ctx || jsonb_build_object('due_on', event.payload ->> 'due_on');
    perform app.queue_email_delivery(
      event.id, event.organization_id,
      (select person.email from public.persons person where person.id::text = event.payload ->> 'person_id'),
      template, matter, true, ctx, true
    );
  elsif event.event_type in ('document.uploaded', 'document.reviewed') then
    ctx := ctx || jsonb_build_object(
      'status', case when event.event_type = 'document.reviewed' then 'accepted' else 'received' end
    );
    perform app.queue_email_delivery(
      event.id, event.organization_id,
      (
        select person.email
        from public.documents doc
        join public.persons person on person.id = doc.person_id
        where doc.id::text = event.payload ->> 'document_id'
      ),
      template, matter, true, ctx, true
    );
  -- email designs: invoice, payment and refund mail to the payer, else the matter's applicants.
  elsif event.event_type in ('invoice.issued', 'invoice.payment_failed', 'invoice.refund_started', 'invoice.refund_succeeded', 'invoice.refund_failed') then
    -- New (20261025530100): the refund correction carries Stripe's failure reason code; the
    -- renderer turns only known codes into plain words and never prints the code.
    if event.event_type = 'invoice.refund_failed' then
      ctx := ctx || coalesce((
        select jsonb_build_object('refund_reason', refund.failure_reason)
        from public.invoice_refunds refund
        where refund.id::text = event.payload ->> 'refund_id'
          and refund.organization_id = event.organization_id
          and refund.failure_reason ~ '^[a-z_]{1,60}$'
      ), '{}'::jsonb);
    end if;
    ctx := ctx || coalesce((
      select jsonb_build_object(
        'invoice_id', invoice.id,
        'invoice_number', invoice.number,
        'due_on', to_char(invoice.due_on, 'YYYY-MM-DD')
      )
      from public.invoices invoice
      where invoice.id::text = event.payload ->> 'invoice_id'
        and invoice.organization_id = event.organization_id
    ), '{}'::jsonb);
    payer := null;
    if event.event_type <> 'invoice.issued' then
      select payment.created_by into payer
      from public.invoice_payments payment
      where payment.id::text = event.payload ->> 'payment_id'
        and payment.organization_id = event.organization_id;
    end if;
    payer_known := payer is not null and matter is not null and exists (
      select 1
      from public.persons person
      join public.matter_participants party
        on party.person_id = person.id
       and party.matter_id = matter
       and party.organization_id = event.organization_id
      where person.user_id = payer
        and person.organization_id = event.organization_id
        and person.email is not null
    );
    for rec in
      select lower(person.email) as email,
             bool_or(pref.email_notices is distinct from false) as email_notices
      from public.matter_participants party
      join public.persons person
        on person.id = party.person_id
       and person.organization_id = party.organization_id
      left join public.person_contact_preferences pref
        on pref.person_id = person.id
      where party.matter_id = matter
        and party.organization_id = event.organization_id
        and person.email is not null
        and matter is not null
        and case when payer_known then person.user_id = payer else party.role = 'applicant' end
      group by lower(person.email)
    loop
      -- New (20261025530100, Francis 2026-10-25): the refund correction is a money correction, not
      -- a routine notice, so it ignores the Email notices opt-out. Suppressed addresses (bounces,
      -- complaints) and invalid addresses are still not sent (queue_email_delivery).
      perform app.queue_email_delivery(
        event.id, event.organization_id, rec.email, template, matter, false, ctx,
        rec.email_notices or event.event_type = 'invoice.refund_failed'
      );
    end loop;
  -- scheduling: the booking's primary attendee, with the time in their own zone. A booking that
  -- moved again or was cancelled since this event was queued is not mailed with a stale time.
  elsif event.event_type in ('booking.confirmed', 'booking.rescheduled', 'booking.cancelled') then
    for rec in
      select attendee.email,
             attendee.time_zone,
             booking.host_name,
             booking.status,
             booking.starts_at,
             booking.location_kind,
             booking.location_detail,
             booking.is_sample,
             -- portal appointments: who cancelled (EM16c wording).
             booking.cancelled_by,
             -- booking mail: a portal button only for an attendee whose person can sign in.
             (person.id is not null and person.user_id is not null) as portal,
             pref.email_notices is distinct from false as email_notices
      from public.bookings booking
      join public.booking_attendees attendee
        on attendee.booking_id = booking.id
       and attendee.organization_id = booking.organization_id
       and attendee.role = 'primary'
      left join public.persons person
        on person.id = attendee.person_id
       and person.organization_id = attendee.organization_id
      left join public.person_contact_preferences pref
        on pref.person_id = attendee.person_id
      where booking.id::text = event.payload ->> 'booking_id'
        and booking.organization_id = event.organization_id
    loop
      ctx := ctx || jsonb_build_object(
        'starts_at', coalesce(event.payload ->> 'starts_at', to_char(rec.starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
        'time_zone', rec.time_zone,
        'portal', rec.portal
      );
      if event.event_type = 'booking.confirmed' and rec.host_name is not null then
        ctx := ctx || jsonb_build_object('consultant_name', rec.host_name);
      end if;
      -- booking mail: how they meet; the address only for an in-person meeting, never a link.
      if event.event_type = 'booking.confirmed' then
        ctx := ctx || jsonb_build_object('location_kind', rec.location_kind);
        if rec.location_kind = 'in_person' and nullif(btrim(coalesce(rec.location_detail, '')), '') is not null then
          ctx := ctx || jsonb_build_object('address', left(btrim(rec.location_detail), 300));
        end if;
      end if;
      -- booking mail: without a portal, a cancellation points to the firm's booking page when the
      -- firm has a published free one this attendee can use (a practice one for a sample booking).
      if event.event_type = 'booking.cancelled' and not rec.portal and firm_slug is not null and exists (
        select 1 from public.booking_event_types et
        where et.organization_id = event.organization_id
          and et.is_published and et.archived_at is null and et.price_cents = 0
          and (not et.is_sample or rec.is_sample)
      ) then
        ctx := ctx || jsonb_build_object('booking_page', firm_slug);
      end if;
      -- portal appointments: EM16c says who cancelled (the client from their portal, or the firm).
      if event.event_type = 'booking.cancelled' then
        ctx := ctx || jsonb_build_object('cancelled_by',
          case when coalesce(event.payload ->> 'cancelled_by', rec.cancelled_by::text) = 'client' then 'client' else 'staff' end);
      end if;
      send_ok := rec.email_notices and case event.event_type
        when 'booking.cancelled' then rec.status = 'cancelled'
        else rec.status = 'confirmed' and rec.starts_at = (event.payload ->> 'starts_at')::timestamptz
      end;
      perform app.queue_email_delivery(
        event.id, event.organization_id, rec.email, template, null, false, ctx, send_ok
      );
    end loop;
  -- matter messaging: each person the thread is addressed to, firm name only (never the text).
  -- A critical instruction (requires_ack) is a critical notice, so a bounce opens a staff task.
  elsif event.event_type = 'message.sent' then
    critical := coalesce((
      select message.requires_ack from public.matter_messages message
      where message.id::text = event.payload ->> 'message_id'
        and message.organization_id = event.organization_id
    ), false);
    for rec in
      select lower(person.email) as email,
             bool_or(pref.email_notices is distinct from false) as email_notices
      from public.matter_messages message
      join public.message_thread_people tp
        on tp.thread_id = message.thread_id
       and tp.organization_id = message.organization_id
      join public.persons person
        on person.id = tp.person_id
       and person.organization_id = tp.organization_id
      join public.matter_participants party
        on party.person_id = person.id
       and party.matter_id = message.matter_id
       and party.organization_id = message.organization_id
      left join public.person_contact_preferences pref
        on pref.person_id = person.id
      where message.id::text = event.payload ->> 'message_id'
        and message.organization_id = event.organization_id
        and person.email is not null
      group by lower(person.email)
    loop
      perform app.queue_email_delivery(
        event.id, event.organization_id, rec.email, template, matter, critical, ctx, rec.email_notices
      );
    end loop;
  -- inbox replies: the stored address of the person the staff member wrote to. A sample matter's
  -- email is recorded as skipped (never sent), as is one whose person left the matter, lost that
  -- address, or turned "Email notices" off since. The text, subject and threading headers go in
  -- the message, not the context.
  elsif event.event_type = 'matter_email.sent' then
    select * into outbound
    from public.matter_outbound_emails email
    where email.id::text = event.payload ->> 'email_id'
      and email.organization_id = event.organization_id
      and email.outbox_event_id = event.id;
    if outbound.id is not null then
      matter := outbound.matter_id;
      select * into rec
      from (
        select lower(person.email) as email,
               person.user_id is not null as portal,
               exists (
                 select 1 from public.matter_participants party
                 where party.person_id = person.id
                   and party.matter_id = outbound.matter_id
                   and party.organization_id = outbound.organization_id
               ) as on_matter,
               coalesce((
                 select pref.email_notices is distinct from false
                 from public.person_contact_preferences pref
                 where pref.person_id = person.id
               ), true) as email_notices
        from public.persons person
        where person.id = outbound.person_id
          and person.organization_id = outbound.organization_id
      ) found;
      ctx := ctx || jsonb_build_object(
        'sender', left(outbound.author_name, 120),
        'portal', coalesce(rec.portal, false)
      );
      send_ok := outbound.is_sample is false
        and coalesce(rec.on_matter, false)
        and coalesce(rec.email_notices, false)
        and rec.email is not distinct from outbound.recipient_email;
      perform app.queue_email_delivery(
        event.id, event.organization_id, outbound.recipient_email, template, matter, false, ctx, send_ok
      );
      select inbound.message_id into in_reply_to
      from public.inbound_emails inbound
      where inbound.id = outbound.reply_to_inbound_id
        and inbound.organization_id = outbound.organization_id;
      extra := jsonb_build_object('body', outbound.body, 'subject', outbound.subject);
      if btrim(coalesce(in_reply_to, '')) ~ '^<[^<>[:space:]]+>$' and length(btrim(in_reply_to)) <= 500 then
        extra := extra || jsonb_build_object(
          'headers', jsonb_build_object('In-Reply-To', btrim(in_reply_to), 'References', btrim(in_reply_to))
        );
      end if;
    end if;
  -- support access: EX11 when Casevoya support asks, EM17 when a firm owner approves, to every
  -- active firm owner at their sign-in address. Minutes only in the request mail; the approver's
  -- name, the minutes granted, the end time and the firm's zone in the approval mail. No matter
  -- (platform mail), never critical. Nothing about the matter or the reason goes in the email.
  elsif event.event_type in ('support_access.requested', 'support_access.approved') then
    select * into support_req
    from public.support_access_requests req
    where req.id::text = event.payload ->> 'request_id'
      and req.organization_id = event.organization_id;
    if support_req.id is not null then
      ctx := ctx || jsonb_build_object('minutes', support_req.requested_minutes);
      if event.event_type = 'support_access.approved' and support_req.starts_at is not null then
        ctx := ctx || jsonb_build_object(
          'approver', (
            select left(nullif(btrim(coalesce(prof.display_name, '')), ''), 120)
            from public.memberships member
            left join public.profiles prof on prof.id = member.user_id
            where member.id = support_req.approved_by_membership_id
              and member.organization_id = support_req.organization_id
          ),
          'minutes', round(extract(epoch from (support_req.ends_at - support_req.starts_at)) / 60)::integer,
          'ends_at', to_char(support_req.ends_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
          'time_zone', (select org.timezone from public.organizations org where org.id = event.organization_id)
        );
      end if;
      for rec in
        select lower(users.email) as email
        from public.memberships member
        join auth.users users on users.id = member.user_id
        where member.organization_id = event.organization_id
          and member.role = 'firm_owner'
          and member.status = 'active'
          and users.email is not null
        group by lower(users.email)
      loop
        perform app.queue_email_delivery(
          event.id, event.organization_id, rec.email, template, null, false, ctx, true
        );
      end loop;
    end if;
  -- consultation agreements: the booking's primary attendee gets EM08 with the booking's private
  -- signing link (the ref only; the worker builds the link). Sent only while that agreement is
  -- still unsigned and the consultation still ahead; never critical (no matter), and it honours
  -- "Email notices" like the other booking mail.
  elsif event.event_type = 'booking_agreement.sent' then
    critical := false;
    for rec in
      select attendee.email,
             booking.public_ref,
             agreement.status as agreement_status,
             booking.status as booking_status,
             booking.ends_at,
             pref.email_notices is distinct from false as email_notices
      from public.booking_agreements agreement
      join public.bookings booking
        on booking.id = agreement.booking_id
       and booking.organization_id = agreement.organization_id
      join public.booking_attendees attendee
        on attendee.booking_id = booking.id
       and attendee.organization_id = booking.organization_id
       and attendee.role = 'primary'
      left join public.person_contact_preferences pref
        on pref.person_id = attendee.person_id
      where agreement.id::text = event.payload ->> 'booking_agreement_id'
        and agreement.booking_id::text = event.payload ->> 'booking_id'
        and agreement.organization_id = event.organization_id
    loop
      ctx := ctx || jsonb_build_object('agreement_kind', 'consultation', 'signing_ref', rec.public_ref);
      send_ok := rec.email_notices
        and rec.agreement_status = 'sent'
        and rec.booking_status in ('held', 'pending_payment', 'confirmed')
        and rec.ends_at > statement_timestamp();
      perform app.queue_email_delivery(
        event.id, event.organization_id, rec.email, template, null, false, ctx, send_ok
      );
    end loop;
  -- signing flow: EX16 to the booking's primary attendee with the sealed code (the worker opens
  -- it; the database never holds the code). Sent only while that code is the newest, unexpired
  -- and unused, and the agreement unsigned; it honours "Email notices" like EM08.
  elsif event.event_type = 'booking_agreement.code' then
    critical := false;
    for rec in
      select attendee.email,
             code.id as code_id,
             code.expires_at,
             code.verified_at,
             agreement.status as agreement_status,
             not exists (
               select 1 from public.booking_agreement_codes newer
               where newer.booking_agreement_id = code.booking_agreement_id and newer.created_at > code.created_at
             ) as newest,
             pref.email_notices is distinct from false as email_notices
      from public.booking_agreement_codes code
      join public.booking_agreements agreement
        on agreement.id = code.booking_agreement_id
       and agreement.organization_id = code.organization_id
      join public.booking_attendees attendee
        on attendee.booking_id = agreement.booking_id
       and attendee.organization_id = agreement.organization_id
       and attendee.role = 'primary'
      left join public.person_contact_preferences pref
        on pref.person_id = attendee.person_id
      where code.id::text = event.payload ->> 'code_id'
        and code.booking_agreement_id::text = event.payload ->> 'booking_agreement_id'
        and code.organization_id = event.organization_id
    loop
      if length(coalesce(event.payload ->> 'sealed_code', '')) between 1 and 1024 then
        ctx := ctx || jsonb_build_object('sealed_code', event.payload ->> 'sealed_code', 'code_id', rec.code_id);
      end if;
      send_ok := rec.email_notices and rec.newest and rec.verified_at is null
        and rec.expires_at > statement_timestamp() and rec.agreement_status = 'sent';
      perform app.queue_email_delivery(
        event.id, event.organization_id, rec.email, template, null, false, ctx, send_ok
      );
    end loop;
  -- ORG-06: EX17 to each person on the matter with a portal account and an email, the same people
  -- the staff screen showed and who got the portal notice. No names, nothing about the matter:
  -- the portal says who. Honours "Email notices".
  elsif event.event_type = 'matter.consultant_changed' then
    for rec in
      select lower(person.email) as email,
             bool_or(pref.email_notices is distinct from false) as email_notices
      from public.matter_participants party
      join public.persons person
        on person.id = party.person_id
       and person.organization_id = party.organization_id
      left join public.person_contact_preferences pref
        on pref.person_id = person.id
      where party.matter_id = matter
        and party.organization_id = event.organization_id
        and person.user_id is not null
        and person.email is not null
      group by lower(person.email)
    loop
      perform app.queue_email_delivery(
        event.id, event.organization_id, rec.email, template, matter, false, ctx, rec.email_notices
      );
    end loop;
  -- CRM-01: EX18 to each active firm owner, and the lead's owner when it has one: the firm name
  -- and a link to the Pipeline only, never what the enquirer wrote. Staff mail (audience staff).
  elsif event.event_type = 'lead.enquiry_received' then
    ctx := ctx || jsonb_build_object('audience', 'staff');
    for rec in
      select distinct lower(users.email) as email
      from public.memberships member
      join auth.users users on users.id = member.user_id
      where member.organization_id = event.organization_id
        and member.status = 'active'
        and users.email is not null
        and (
          member.role = 'firm_owner'
          or member.id = (
            select lead.owner_membership_id from public.leads lead
            where lead.id::text = event.payload ->> 'lead_id' and lead.organization_id = event.organization_id
          )
        )
    loop
      perform app.queue_email_delivery(
        event.id, event.organization_id, rec.email, template, null, false, ctx, true
      );
    end loop;
  -- OPS-04: EX19 to each person the announcement went to who was to be emailed, firm name only
  -- (the announcement is in the portal). Never for a sample-mode firm's announcement; "Email
  -- notices" is checked again now.
  elsif event.event_type = 'announcement.sent' then
    for rec in
      select lower(person.email) as email,
             bool_and(not announcement.is_sample) and bool_or(coalesce((
               select pref.email_notices is distinct from false
               from public.person_contact_preferences pref
               where pref.person_id = person.id
               limit 1
             ), true)) as send_now
      from public.announcement_deliveries delivery
      join public.announcements announcement
        on announcement.id = delivery.announcement_id
       and announcement.organization_id = delivery.organization_id
      join public.persons person
        on person.id = delivery.person_id
       and person.organization_id = delivery.organization_id
      where announcement.id::text = event.payload ->> 'announcement_id'
        and announcement.organization_id = event.organization_id
        and delivery.emailed
        and person.email is not null
      group by lower(person.email)
    loop
      perform app.queue_email_delivery(
        event.id, event.organization_id, rec.email, template, null, false, ctx, rec.send_now
      );
    end loop;
  -- Card trial: EM18c (trial ends on <date>, what will be charged) and EM18a (a subscription
  -- payment failed or needs confirming) to each active firm owner. Casevoya's own mail (audience
  -- staff); the amount is the catalog price of the plan, before taxes.
  elsif event.event_type in ('subscription.trial_will_end', 'subscription.payment_failed') then
    ctx := ctx || jsonb_build_object('audience', 'staff');
    if event.event_type = 'subscription.trial_will_end' then
      ctx := ctx || jsonb_build_object(
        'trial_end', event.payload ->> 'trial_end',
        'plan', event.payload ->> 'plan',
        'interval', event.payload ->> 'interval',
        'amount_cents', app.subscription_amount_cents(event.payload ->> 'plan', event.payload ->> 'interval', coalesce((event.payload ->> 'extra_seats')::integer, 0)),
        'currency', coalesce(app.subscription_plan_catalog() ->> 'currency', 'CAD'),
        'time_zone', (select o.timezone from public.organizations o where o.id = event.organization_id)
      );
    else
      ctx := ctx || jsonb_build_object('grace_days', app.subscription_grace_days('past_due_days'));
    end if;
    for rec in
      select distinct lower(users.email) as email
      from public.memberships member
      join auth.users users on users.id = member.user_id
      where member.organization_id = event.organization_id
        and member.status = 'active'
        and member.role = 'firm_owner'
        and users.email is not null
    loop
      perform app.queue_email_delivery(
        event.id, event.organization_id, rec.email, template, null, false, ctx, true
      );
    end loop;
  end if;

  if not exists (
    select 1 from public.email_deliveries delivery
    where delivery.outbox_event_id = event.id
      and delivery.status = 'sending'
  ) then
    perform app.mark_outbox_published(event.id, p_worker);
    -- sealed invitation link: nothing will be sent, so nothing needs it.
    perform app.scrub_invitation_link(event.id);
    perform app.record_audit_event(
      event.organization_id, 'email.skipped', 'public.outbox_events', event.id, 'success',
      jsonb_build_object('template', template, 'reason', 'no_recipient')
    );
    return jsonb_build_object('action', 'done', 'event_id', event.id, 'messages', '[]'::jsonb);
  end if;

  reply := app.firm_reply_address(event.organization_id, matter, domain);
  select coalesce(jsonb_agg(jsonb_build_object(
    'delivery_id', delivery.id,
    'to', delivery.recipient_email,
    'from_address', from_addr,
    -- Card trial: Casevoya's billing mail comes from Casevoya, not the firm.
    'from_name', case when delivery.template in ('trial_ending', 'billing_payment_failed') then 'Casevoya' else firm_name end,
    'reply_to_address', case when delivery.template in ('trial_ending', 'billing_payment_failed') then from_addr else reply end,
    'reply_to_name', case when delivery.template in ('trial_ending', 'billing_payment_failed') then 'Casevoya' else firm_name end,
    'template', delivery.template,
    'context', delivery.context
  -- inbox replies: body, subject and headers of a staff email (empty for every other event).
  ) || extra), '[]'::jsonb)
  into messages
  from public.email_deliveries delivery
  where delivery.outbox_event_id = event.id
    and delivery.status = 'sending';

  return jsonb_build_object('action', 'send', 'event_id', event.id, 'messages', messages);
end;
$function$;

-- ---------------------------------------------------------------------------
-- Existing firms keep their trial as it is (card_required false). Nothing else is backfilled.
-- ---------------------------------------------------------------------------
