-- Billing hardening (security review, issues #304-#307). Additive only; every function below is
-- copied from its latest definition (named above it) with the changes marked "Billing PR".
--
--   * #305 A card trial that ends before it converts (trial_ended after a Stripe trial) pauses new
--     work like a cancelled subscription: app.subscription_entitlements answers new_work_blocked
--     and checkout_required, so real matters and staff invitations wait for Checkout. The webhook
--     sets card_required again; existing rows are backfilled. A trial_ended firm that never had a
--     Stripe trial (the database clock ended it) keeps the 2026-10-19 rule.
--   * #306 A paid Checkout naming a second subscription while a live one is stored no longer
--     overwrites it: the event is ignored (duplicate_subscription), audited, and the answer carries
--     cancel_subscription so the billing webhook route cancels the extra subscription at Stripe.
--     A retried delivery repeats the instruction until Stripe reports that subscription ended.
--   * #304 The Stripe customer is recorded or replaced by the server only (service role, with the
--     firm owner who passed the step-up check), after the server created the customer at Stripe
--     with the firm's metadata. A customer id another firm holds is refused. The signed-in
--     record_subscription_customer / replace_subscription_customer are revoked.
--   * #307 customer.subscription.* events are ordered by their own watermark
--     (last_stripe_subscription_event_created); checkout and invoice events no longer move it. A
--     paid trial Checkout records the licence claim (and the card claim when the server supplies
--     the card hash) and ends a repeat trial, as the subscription events do.

-- ---------------------------------------------------------------------------
-- Columns and backfills
-- ---------------------------------------------------------------------------
alter table public.organization_subscriptions
  add column if not exists last_stripe_subscription_event_created bigint;
comment on column public.organization_subscriptions.last_stripe_subscription_event_created is
  'Stripe `created` (unix seconds) of the last customer.subscription.* event applied. Only those events move it, and an older one changes nothing.';

update public.organization_subscriptions
   set last_stripe_subscription_event_created = last_stripe_event_created
 where last_stripe_subscription_event_created is null
   and last_stripe_event_created is not null;

-- A Stripe trial that ended before it converted needs a card again.
update public.organization_subscriptions
   set card_required = true
 where status = 'trial_ended'
   and trial_used_at is not null
   and card_required is false;

-- ---------------------------------------------------------------------------
-- #305 Entitlements (latest: 20261101100100_card_required_trial.sql)
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
  -- Billing PR: a Stripe (card) trial that ended without converting.
  card_trial_ended boolean;
begin
  status := app.sync_subscription_state(p_org);
  select * into sub from public.organization_subscriptions where organization_id = p_org;
  if sub.organization_id is null then
    return jsonb_build_object('status', null, 'plan', null, 'basis', 'none', 'seats', null, 'matters', null, 'storage_gb', null, 'extra_seats', 0, 'new_work_blocked', false);
  end if;
  card_trial_ended := status = 'trial_ended' and (sub.card_required or sub.trial_used_at is not null);
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
    -- No plan yet: nothing is limited until one is chosen. Billing PR: a card trial that ended
    -- without converting pauses new work until the firm checks out.
    return jsonb_build_object(
      'status', status, 'plan', null, 'basis', 'trial', 'seats', null, 'matters', null, 'storage_gb', null,
      'extra_seats', 0, 'new_work_blocked', status in ('restricted', 'cancelled', 'archived') or card_trial_ended,
      'checkout_required', (status = 'trial' and sub.card_required) or card_trial_ended
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
-- #304 Stripe customer: server only (latest: 20261020160100 record_subscription_customer,
-- 20261029200000 replace_subscription_customer).
-- ---------------------------------------------------------------------------
create or replace function public.service_record_subscription_customer(p_organization_id uuid, p_stripe_customer_id text, p_actor_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  sub public.organization_subscriptions%rowtype;
  customer text := btrim(coalesce(p_stripe_customer_id, ''));
begin
  perform app.require_service_role();
  perform app.require_active_firm_owner(p_organization_id, p_actor_user_id);
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
  if exists (
    select 1 from public.organization_subscriptions other
    where other.stripe_customer_id = customer and other.organization_id <> p_organization_id
  ) then
    raise exception 'that billing account belongs to another firm' using errcode = '23505';
  end if;
  update public.organization_subscriptions set stripe_customer_id = customer where organization_id = p_organization_id;
  perform app.record_audit_event(
    p_organization_id, 'subscription.customer_recorded', 'public.organization_subscriptions', p_organization_id, 'success',
    jsonb_build_object('stripe_customer_id', customer, 'actor_user_id', p_actor_user_id)
  );
end;
$$;
revoke all on function public.service_record_subscription_customer(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.service_record_subscription_customer(uuid, text, uuid) to service_role;

create or replace function public.service_replace_subscription_customer(p_organization_id uuid, p_previous_customer_id text, p_stripe_customer_id text, p_actor_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  sub public.organization_subscriptions%rowtype;
  customer text := btrim(coalesce(p_stripe_customer_id, ''));
  previous text := btrim(coalesce(p_previous_customer_id, ''));
begin
  perform app.require_service_role();
  perform app.require_active_firm_owner(p_organization_id, p_actor_user_id);
  if customer !~ '^cus_[A-Za-z0-9]{6,250}$' or previous !~ '^cus_[A-Za-z0-9]{6,250}$' then
    raise exception 'stripe customer id is invalid' using errcode = '22023';
  end if;
  select * into sub from public.organization_subscriptions where organization_id = p_organization_id for update;
  if sub.organization_id is null then
    raise exception 'this firm has no subscription record' using errcode = '22023';
  end if;
  if sub.stripe_customer_id = customer then
    return;
  end if;
  if sub.stripe_customer_id is distinct from previous then
    raise exception 'this firm already has a billing account' using errcode = '22023';
  end if;
  if sub.stripe_subscription_id is not null then
    raise exception 'this firm already has a subscription' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.organization_subscriptions other
    where other.stripe_customer_id = customer and other.organization_id <> p_organization_id
  ) then
    raise exception 'that billing account belongs to another firm' using errcode = '23505';
  end if;
  update public.organization_subscriptions set stripe_customer_id = customer where organization_id = p_organization_id;
  perform app.record_audit_event(
    p_organization_id, 'subscription.customer_replaced', 'public.organization_subscriptions', p_organization_id, 'success',
    jsonb_build_object('stripe_customer_id', customer, 'previous_customer_id', previous, 'actor_user_id', p_actor_user_id)
  );
end;
$$;
revoke all on function public.service_replace_subscription_customer(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.service_replace_subscription_customer(uuid, text, text, uuid) to service_role;

-- The signed-in versions are no longer callable (the server calls the service versions above).
revoke all on function public.record_subscription_customer(uuid, text) from public, anon, authenticated;
revoke all on function public.replace_subscription_customer(uuid, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- #306 / #307 / #305 Webhook (latest: 20261101100100_card_required_trial.sql)
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
  -- Billing PR
  sub_stale boolean := false;
  cancel_sub text;
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
    -- Billing PR: a retried delivery of a duplicate-subscription Checkout repeats the cancel
    -- instruction until Stripe reports that subscription ended.
    if org is not null then
      select audit.context ->> 'cancel_subscription' into cancel_sub
      from public.audit_log audit
      where audit.organization_id = org
        and audit.action = 'subscription.duplicate_subscription'
        and audit.context ->> 'event_id' = event_id
      order by audit.occurred_at desc
      limit 1;
      if cancel_sub ~ '^sub_[A-Za-z0-9]{6,250}$' and not app.stripe_subscription_ended(org, cancel_sub, null) then
        return jsonb_build_object('outcome', 'duplicate', 'cancel_subscription', cancel_sub);
      end if;
    end if;
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
  -- Billing PR: customer.subscription.* events are ordered among themselves only.
  sub_stale := event_created is not null and sub.last_stripe_subscription_event_created is not null
    and event_created < sub.last_stripe_subscription_event_created;
  stored_ended := app.stripe_subscription_ended(org, sub.stripe_subscription_id, event_id);
  -- Card trial: the card hash the server added (trial events only).
  if coalesce(s ->> 'card_hash', '') ~ '^[0-9a-f]{64}$' then
    card_hash := s ->> 'card_hash';
  end if;

  if event_type in ('checkout.session.completed', 'checkout.session.async_payment_succeeded') then
    -- A summary without payment_status comes from the app version before this change (deploy
    -- window only); it is treated as before (paid). Current summaries always carry the field.
    paid := case when s ? 'payment_status'
                 then coalesce(s ->> 'payment_status', '') in ('paid', 'no_payment_required')
                 else true end;
    -- Billing PR: order is ended -> duplicate (paid) -> stale -> not paid -> apply, so a duplicate
    -- subscription is answered with a cancel instruction even when its Checkout arrives late.
    if app.stripe_subscription_ended(org, event_sub, event_id) then
      outcome := 'ignored';
      detail := 'subscription_ended';
    elsif paid
          and sub.stripe_subscription_id is not null
          and event_sub is not null
          and event_sub is distinct from sub.stripe_subscription_id
          and not stored_ended
          and sub.status in ('active', 'past_due', 'restricted', 'trial') then
      -- Billing PR: a second paid subscription while a live one is stored. The stored one is kept;
      -- the server cancels the new one at Stripe.
      outcome := 'ignored';
      detail := 'duplicate_subscription';
      cancel_sub := event_sub;
      perform app.record_audit_event(
        org, 'subscription.duplicate_subscription', 'public.organization_subscriptions', org, 'failure',
        jsonb_build_object('event_id', event_id, 'cancel_subscription', event_sub, 'kept_subscription', sub.stripe_subscription_id)
      );
    elsif stale then
      outcome := 'ignored';
      detail := 'stale_event';
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
      -- Billing PR: a trial Checkout records the trial claims (one trial per licence and card).
      is_trial := coalesce((s ->> 'trial')::boolean, false) and sub.status not in ('active', 'past_due', 'restricted');
      if is_trial then
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
    -- Billing PR: ordered by the subscription watermark (checkout and invoice events do not move it).
    if sub_stale then
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
             -- Billing PR: a trial that ended without converting needs a card again.
             card_required = case when next_status in ('trial', 'active', 'past_due') then false
                                  when next_status = 'trial_ended' then true
                                  else card_required end,
             cancel_at_period_end = case when next_status in ('cancelled', 'trial_ended') then false when grants then coalesce((s ->> 'cancel_at_period_end')::boolean, false) else cancel_at_period_end end,
             status = coalesce(next_status, status),
             cancelled_at = case when next_status = 'cancelled' then coalesce((s ->> 'canceled_at')::timestamptz, now_at) when next_status in ('active', 'trial') then null else cancelled_at end,
             past_due_since = case when next_status = 'past_due' then coalesce(past_due_since, now_at) when next_status in ('active', 'trial') then null else past_due_since end,
             restricted_at = case when next_status in ('active', 'trial') then null else restricted_at end,
             archived_at = case when next_status in ('active', 'trial') then null else archived_at end,
             last_stripe_event_created = greatest(last_stripe_event_created, event_created),
             last_stripe_subscription_event_created = greatest(last_stripe_subscription_event_created, event_created)
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
    -- Billing PR: the server cancels a duplicate subscription at Stripe.
    || case when cancel_sub is not null then jsonb_build_object('cancel_subscription', cancel_sub) else '{}'::jsonb end
    || case when outcome = 'ignored' and detail is not null then jsonb_build_object('reason', detail) else '{}'::jsonb end;
end;
$function$;
revoke all on function public.apply_stripe_subscription_event(jsonb) from public, anon, authenticated;
grant execute on function public.apply_stripe_subscription_event(jsonb) to service_role;
