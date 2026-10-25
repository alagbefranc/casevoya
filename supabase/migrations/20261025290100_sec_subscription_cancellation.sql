-- SEC-10 (gap #184): subscription cancellation, the export window, custodial archive or transfer.
--
-- Built on the subscription billing of 20261020160100 (Stripe TEST mode only). What it adds:
--   * Cancel subscription (firm owner + step-up): public.subscription_cancel_allowed checks and
--     records the request; the server action asks Stripe (test mode) to cancel at the period end
--     and records Stripe's answer through public.service_record_subscription_cancel (service role,
--     so the date shown is Stripe's, not the browser's). Nothing else changes until that date.
--   * The contract-period clock: app.sync_subscription_state (redefined) moves an active, past-due
--     or restricted subscription whose cancel_at has passed to cancelled, even before Stripe's
--     customer.subscription.deleted arrives. Cancelled already stops new work (new real matters,
--     staff and client invitations: app.subscription_entitlements new_work_blocked,
--     app.real_client_invite_blockers); reads and exports never stop.
--   * The export window: at least 90 days (app.subscription_grace_days, redefined, never returns
--     fewer than 90 for export_window_days), counted from the later of the cancellation and the end
--     of the contracted period (Stripe's canceled_at for a cancel at period end is the time it was
--     requested, so the period end is used when it is later). app.subscription_export_window_end.
--   * After the window: custodial archive (the default: Casevoya keeps the records read-only, under
--     each matter's retention, never deleted by the archive) or a verified transfer (an ORG-06
--     firm transfer the owner marked completed after reviewing every client's authority). The
--     owner chooses with public.choose_subscription_end_arrangement (step-up). At the window end the
--     clock records status archived with end_arrangement: 'transfer' only if the chosen transfer is
--     completed by then, otherwise 'custodial_archive'. Nothing is deleted by any of this.
--   * public.subscription_continuity(org): any staff member (MFA) reads the phase for the banner
--     across the app (ending, export window, archived) and moves the clock.
--   * public.firm_subscription (redefined) adds 'continuity': the phase, dates, the arrangement and
--     the full firm export coverage (matters with a ready client-file export since cancelling).
--   * public.firm_export_index(org) (firm owner + step-up): the full firm export's index: every
--     real matter with its newest ready client-file export (id, date, SHA-256 of the package and its
--     manifest). Audited. The packages themselves are the existing per-matter exports.
-- Each redefined function is copied from its latest definition (20261020160100_subscription_billing.sql)
-- with only the change described above it.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------
alter table public.organization_subscriptions
  add column cancel_requested_at timestamptz,
  add column cancel_requested_by uuid references auth.users (id),
  add column end_arrangement text check (end_arrangement is null or end_arrangement in ('custodial_archive', 'transfer')),
  add column end_transfer_id uuid,
  add column end_arrangement_chosen_by uuid references auth.users (id),
  add column end_arrangement_chosen_at timestamptz,
  add constraint organization_subscriptions_end_transfer_fkey
    foreign key (end_transfer_id, organization_id) references public.firm_transfers (id, organization_id),
  add constraint organization_subscriptions_end_transfer_check
    check ((end_arrangement = 'transfer') = (end_transfer_id is not null) or (end_arrangement is null and end_transfer_id is null));
comment on column public.organization_subscriptions.end_arrangement is
  'SEC-10: what happens after the export window: custodial_archive (records kept read-only by Casevoya under their retention) or transfer (a completed ORG-06 firm transfer). Never deletion.';
comment on column public.organization_subscriptions.cancel_requested_at is
  'When the firm owner cancelled in Casevoya (Stripe cancels at the period end, cancel_at).';

create index organization_subscriptions_cancel_requested_by_idx on public.organization_subscriptions (cancel_requested_by);
create index organization_subscriptions_end_chosen_by_idx on public.organization_subscriptions (end_arrangement_chosen_by);
create index organization_subscriptions_end_transfer_idx on public.organization_subscriptions (end_transfer_id, organization_id);

-- ---------------------------------------------------------------------------
-- app.subscription_grace_days: latest definition from 20261020160100_subscription_billing.sql.
-- Changed: export_window_days is never fewer than 90 (SEC-10: at least 90 days).
-- ---------------------------------------------------------------------------
create or replace function app.subscription_grace_days(p_key text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_key = 'export_window_days'
    then greatest(90, coalesce((value ->> p_key)::integer, 90))
    else greatest(0, coalesce((value ->> p_key)::integer, case p_key when 'past_due_days' then 7 else 0 end))
  end
  from public.product_settings where key = 'subscription.grace';
$$;

-- The last day exports are guaranteed open: the later of the cancellation and the end of the
-- contracted period, plus the export window. Null before a cancellation takes effect.
create function app.subscription_export_window_end(p_org uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select case when sub.cancelled_at is null then null
    else greatest(sub.cancelled_at, coalesce(sub.current_period_end, sub.cancelled_at))
      + make_interval(days => coalesce(app.subscription_grace_days('export_window_days'), 90))
  end
  from public.organization_subscriptions sub
  where sub.organization_id = p_org;
$$;
revoke all on function app.subscription_export_window_end(uuid) from public, anon;
grant execute on function app.subscription_export_window_end(uuid) to authenticated, service_role;

-- A verified transfer: the owner marked it completed, which needs every matter's client authority
-- reviewed (public.close_firm_transfer).
create function app.firm_transfer_verified(p_transfer_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select t.status = 'completed' from public.firm_transfers t where t.id = p_transfer_id), false);
$$;
revoke all on function app.firm_transfer_verified(uuid) from public, anon;
grant execute on function app.firm_transfer_verified(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- app.sync_subscription_state: latest definition from 20261020160100_subscription_billing.sql.
-- Added: (1) a subscription set to cancel at the period end becomes cancelled once cancel_at has
-- passed (cancelled_at = cancel_at), audited 'subscription.contract_period_ended'; (2) cancelled
-- becomes archived at app.subscription_export_window_end (not cancelled_at + window), recording the
-- end arrangement: 'transfer' when the chosen firm transfer is completed, else 'custodial_archive'.
-- Still state only: no records are deleted, reads and exports stay open.
-- ---------------------------------------------------------------------------
create or replace function app.sync_subscription_state(p_org uuid)
returns public.subscription_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  sub public.organization_subscriptions%rowtype;
  now_at timestamptz := statement_timestamp();
  window_end timestamptz;
  arrangement text;
begin
  select * into sub from public.organization_subscriptions where organization_id = p_org;
  if sub.organization_id is null then
    return null;
  end if;
  if sub.status = 'trial' then
    return app.sync_trial_status(p_org);
  end if;
  if sub.status in ('active', 'past_due', 'restricted') and sub.cancel_at is not null and sub.cancel_at <= now_at then
    update public.organization_subscriptions
       set status = 'cancelled', cancelled_at = sub.cancel_at, cancel_at = null,
           current_period_end = coalesce(current_period_end, sub.cancel_at)
     where organization_id = p_org and status = sub.status;
    perform app.record_audit_event(
      p_org, 'subscription.contract_period_ended', 'public.organization_subscriptions', p_org, 'success',
      jsonb_build_object('cancel_at', sub.cancel_at, 'export_window_days', app.subscription_grace_days('export_window_days'), 'records_deleted', false)
    );
    select * into sub from public.organization_subscriptions where organization_id = p_org;
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
  if sub.status = 'cancelled' and sub.cancelled_at is not null then
    window_end := app.subscription_export_window_end(p_org);
    if window_end <= now_at then
      arrangement := case
        when sub.end_arrangement = 'transfer' and app.firm_transfer_verified(sub.end_transfer_id) then 'transfer'
        else 'custodial_archive'
      end;
      update public.organization_subscriptions
         set status = 'archived', archived_at = now_at,
             end_arrangement = arrangement,
             end_transfer_id = case when arrangement = 'transfer' then end_transfer_id else null end
       where organization_id = p_org and status = 'cancelled';
      perform app.record_audit_event(
        p_org, 'subscription.archived', 'public.organization_subscriptions', p_org, 'success',
        jsonb_build_object('cancelled_at', sub.cancelled_at, 'export_window_ended', window_end,
          'export_window_days', app.subscription_grace_days('export_window_days'),
          'end_arrangement', arrangement, 'records_deleted', false)
      );
      return 'archived';
    end if;
  end if;
  return sub.status;
end;
$$;
comment on function app.sync_subscription_state(uuid) is
  'Moves an elapsed trial to trial_ended, a cancel-at-period-end past its date to cancelled, past_due past its grace to restricted, and cancelled past the export window (at least 90 days after the later of cancellation and period end) to archived with its end arrangement. State only: no records are deleted, reads and exports stay open.';

-- ---------------------------------------------------------------------------
-- Continuity: the phase, dates, arrangement (and, for the owner and finance, export coverage)
-- ---------------------------------------------------------------------------
create function app.subscription_continuity_json(p_org uuid, p_with_coverage boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  sub public.organization_subscriptions%rowtype;
  transfer public.firm_transfers%rowtype;
  phase text := 'none';
  since timestamptz;
  window_end timestamptz;
  total_matters integer;
  covered integer;
  next_matter uuid;
  next_reference text;
begin
  select * into sub from public.organization_subscriptions where organization_id = p_org;
  if sub.organization_id is null then
    return jsonb_build_object('phase', 'none');
  end if;
  if sub.status in ('active', 'past_due', 'restricted') and sub.cancel_at is not null then
    phase := 'ending';
    window_end := sub.cancel_at + make_interval(days => app.subscription_grace_days('export_window_days'));
  elsif sub.status = 'cancelled' then
    phase := 'window';
    window_end := app.subscription_export_window_end(p_org);
  elsif sub.status = 'archived' then
    phase := 'archived';
    window_end := app.subscription_export_window_end(p_org);
  end if;
  if sub.end_transfer_id is not null then
    select * into transfer from public.firm_transfers where id = sub.end_transfer_id;
  end if;
  since := coalesce(sub.cancel_requested_at, sub.cancelled_at, sub.cancel_at);
  if p_with_coverage and phase <> 'none' then
    select count(*) into total_matters from public.matters m
     where m.organization_id = p_org and not m.is_sample
       and not exists (select 1 from public.deletion_tombstones t where t.matter_id = m.id);
    select count(*) into covered from public.matters m
     where m.organization_id = p_org and not m.is_sample
       and not exists (select 1 from public.deletion_tombstones t where t.matter_id = m.id)
       and exists (
         select 1 from public.matter_exports ex
         where ex.matter_id = m.id and ex.status = 'ready' and (since is null or ex.ready_at >= since)
       );
    select m.id, m.reference into next_matter, next_reference from public.matters m
     where m.organization_id = p_org and not m.is_sample
       and not exists (select 1 from public.deletion_tombstones t where t.matter_id = m.id)
       and not exists (
         select 1 from public.matter_exports ex
         where ex.matter_id = m.id and ex.status = 'ready' and (since is null or ex.ready_at >= since)
       )
     order by m.created_at, m.id
     limit 1;
  end if;
  return jsonb_build_object(
    'phase', phase,
    'status', sub.status,
    'period_end', coalesce(sub.cancel_at, sub.current_period_end),
    'cancel_at', sub.cancel_at,
    'cancelled_at', sub.cancelled_at,
    'cancel_requested_at', sub.cancel_requested_at,
    'archived_at', sub.archived_at,
    'window_days', app.subscription_grace_days('export_window_days'),
    'window_ends_at', window_end,
    'arrangement', sub.end_arrangement,
    'arrangement_chosen_at', sub.end_arrangement_chosen_at,
    'transfer', case when transfer.id is null then null else jsonb_build_object(
      'id', transfer.id, 'receiving_firm', transfer.receiving_firm, 'status', transfer.status,
      'verified', transfer.status = 'completed'
    ) end,
    'coverage', case when p_with_coverage and phase <> 'none' then jsonb_build_object(
      'since', since, 'matters', total_matters, 'covered', covered, 'next_matter_id', next_matter, 'next_reference', next_reference
    ) else null end
  );
end;
$$;
revoke all on function app.subscription_continuity_json(uuid, boolean) from public, anon, authenticated;

-- Any staff member of the firm (MFA): the banner's data. Moves the clock first.
create function public.subscription_continuity(p_organization_id uuid)
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
    raise exception 'subscription continuity denied' using errcode = '42501';
  end if;
  perform app.sync_subscription_state(p_organization_id);
  return app.subscription_continuity_json(p_organization_id, false);
end;
$$;
comment on function public.subscription_continuity(uuid) is
  'Any staff member (MFA): whether the subscription is ending, in its export window or archived, with the dates, for the banner across the app. Moves the subscription clock.';
revoke all on function public.subscription_continuity(uuid) from public, anon;
grant execute on function public.subscription_continuity(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- public.firm_subscription: latest definition from 20261020160100_subscription_billing.sql.
-- Added: 'continuity' (app.subscription_continuity_json with export coverage) and, in
-- 'subscription', cancel_requested_at and end_arrangement.
-- ---------------------------------------------------------------------------
create or replace function public.firm_subscription(p_organization_id uuid)
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
      'has_stripe_subscription', sub.stripe_subscription_id is not null,
      'cancel_requested_at', sub.cancel_requested_at,
      'end_arrangement', sub.end_arrangement
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
    ), '[]'::jsonb),
    'continuity', app.subscription_continuity_json(p_organization_id, true)
  );
end;
$$;
comment on function public.firm_subscription(uuid) is
  'Firm owner or finance: the subscription state (synced), entitlements, usage, the plan catalog, the last 24 Casevoya invoices and the cancellation continuity (phase, export window, end arrangement, full firm export coverage) for Settings > Subscription. Never a card or a Stripe id.';

-- ---------------------------------------------------------------------------
-- Cancel subscription (firm owner + step-up)
-- ---------------------------------------------------------------------------
create function public.subscription_cancel_allowed(p_organization_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  sub public.organization_subscriptions%rowtype;
  request_key uuid := gen_random_uuid();
begin
  if p_organization_id is null or p_organization_id is distinct from (select app.current_organization_id()) then
    raise exception 'firm owner step-up is required' using errcode = '42501';
  end if;
  perform app.require_firm_owner_step_up(p_organization_id);
  perform app.sync_subscription_state(p_organization_id);
  select * into sub from public.organization_subscriptions where organization_id = p_organization_id for update;
  if sub.organization_id is null or sub.stripe_subscription_id is null or sub.status not in ('active', 'past_due', 'restricted') then
    raise exception 'there is no paid subscription to cancel' using errcode = '22023';
  end if;
  if sub.cancel_at is not null then
    raise exception 'this subscription already ends at the period end' using errcode = '22023';
  end if;
  insert into public.subscription_events (organization_id, kind, payload)
  values (p_organization_id, 'cancel.requested', jsonb_build_object('idempotency_key', request_key));
  perform app.record_audit_event(
    p_organization_id, 'subscription.cancel_requested', 'public.organization_subscriptions', p_organization_id, 'success',
    jsonb_build_object('idempotency_key', request_key, 'current_period_end', sub.current_period_end)
  );
  return jsonb_build_object(
    'ok', true,
    'idempotency_key', request_key,
    'stripe_subscription_id', sub.stripe_subscription_id,
    'current_period_end', sub.current_period_end
  );
end;
$$;
comment on function public.subscription_cancel_allowed(uuid) is
  'Firm owner with a recent step-up: checks there is a paid subscription not already ending, records the cancel request and returns what the server action needs to ask Stripe (test mode) to cancel at the period end.';
revoke all on function public.subscription_cancel_allowed(uuid) from public, anon;
grant execute on function public.subscription_cancel_allowed(uuid) to authenticated;

-- The server records Stripe's answer: the subscription ends at p_cancel_at (the contracted period
-- end). Service role only, so the date comes from Stripe. p_actor must be the firm's active owner.
create function public.service_record_subscription_cancel(
  p_organization_id uuid,
  p_actor uuid,
  p_cancel_at timestamptz,
  p_period_end timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  sub public.organization_subscriptions%rowtype;
begin
  if p_cancel_at is null or p_cancel_at < statement_timestamp() - interval '1 day' or p_cancel_at > statement_timestamp() + interval '400 days' then
    raise exception 'the cancellation date is not plausible' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.memberships mem
    where mem.organization_id = p_organization_id and mem.user_id = p_actor and mem.role = 'firm_owner' and mem.status = 'active'
  ) then
    raise exception 'only the firm owner can cancel' using errcode = '42501';
  end if;
  select * into sub from public.organization_subscriptions where organization_id = p_organization_id for update;
  if sub.organization_id is null or sub.status not in ('active', 'past_due', 'restricted') then
    raise exception 'there is no paid subscription to cancel' using errcode = '22023';
  end if;
  update public.organization_subscriptions
     set cancel_at = p_cancel_at,
         current_period_end = coalesce(p_period_end, current_period_end),
         cancel_requested_at = case when sub.cancel_at is null then statement_timestamp() else coalesce(cancel_requested_at, statement_timestamp()) end,
         cancel_requested_by = case when sub.cancel_at is null then p_actor else coalesce(cancel_requested_by, p_actor) end,
         -- A new cancellation starts without the arrangement chosen for an earlier one.
         end_arrangement = case when sub.cancel_at is null then null else end_arrangement end,
         end_transfer_id = case when sub.cancel_at is null then null else end_transfer_id end,
         end_arrangement_chosen_by = case when sub.cancel_at is null then null else end_arrangement_chosen_by end,
         end_arrangement_chosen_at = case when sub.cancel_at is null then null else end_arrangement_chosen_at end
   where organization_id = p_organization_id;
  perform app.record_audit_event(
    p_organization_id, 'subscription.cancel_scheduled', 'public.organization_subscriptions', p_organization_id, 'success',
    jsonb_build_object('cancel_at', p_cancel_at, 'requested_by', p_actor, 'records_deleted', false)
  );
end;
$$;
revoke all on function public.service_record_subscription_cancel(uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.service_record_subscription_cancel(uuid, uuid, timestamptz, timestamptz) to service_role;

-- After the export window: custodial archive, or a transfer (ORG-06) that must be completed by the
-- window's end. Firm owner + step-up, once the subscription is ending or cancelled.
create function public.choose_subscription_end_arrangement(p_organization_id uuid, p_arrangement text, p_transfer_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  sub public.organization_subscriptions%rowtype;
  transfer public.firm_transfers%rowtype;
begin
  if p_organization_id is null or p_organization_id is distinct from (select app.current_organization_id()) then
    raise exception 'firm owner step-up is required' using errcode = '42501';
  end if;
  perform app.require_firm_owner_step_up(p_organization_id);
  perform app.sync_subscription_state(p_organization_id);
  select * into sub from public.organization_subscriptions where organization_id = p_organization_id for update;
  if sub.organization_id is null
     or not (sub.status = 'cancelled' or (sub.status in ('active', 'past_due', 'restricted') and sub.cancel_at is not null)) then
    raise exception 'choose what happens after the export window once the subscription is cancelled' using errcode = '22023';
  end if;
  if p_arrangement not in ('custodial_archive', 'transfer') then
    raise exception 'choose custodial archive or a transfer' using errcode = '22023';
  end if;
  if p_arrangement = 'transfer' then
    select * into transfer from public.firm_transfers
     where id = p_transfer_id and organization_id = p_organization_id;
    if transfer.id is null or transfer.status = 'cancelled' then
      raise exception 'choose an open or completed firm transfer' using errcode = '22023';
    end if;
  elsif p_transfer_id is not null then
    raise exception 'a custodial archive has no transfer' using errcode = '22023';
  end if;
  update public.organization_subscriptions
     set end_arrangement = p_arrangement,
         end_transfer_id = case when p_arrangement = 'transfer' then p_transfer_id else null end,
         end_arrangement_chosen_by = (select auth.uid()),
         end_arrangement_chosen_at = statement_timestamp()
   where organization_id = p_organization_id;
  perform app.record_audit_event(
    p_organization_id, 'subscription.end_arrangement_chosen', 'public.organization_subscriptions', p_organization_id, 'success',
    jsonb_build_object('arrangement', p_arrangement, 'transfer_id', p_transfer_id)
  );
end;
$$;
comment on function public.choose_subscription_end_arrangement(uuid, text, uuid) is
  'Firm owner + step-up: after the export window, custodial archive or a firm transfer (ORG-06; it counts only if completed by the window''s end). Never deletion.';
revoke all on function public.choose_subscription_end_arrangement(uuid, text, uuid) from public, anon;
grant execute on function public.choose_subscription_end_arrangement(uuid, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Full firm export index (firm owner + step-up)
-- ---------------------------------------------------------------------------
create function public.firm_export_index(p_organization_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  rows_json jsonb;
  continuity jsonb;
  missing integer;
begin
  if p_organization_id is null or p_organization_id is distinct from (select app.current_organization_id()) then
    raise exception 'firm owner step-up is required' using errcode = '42501';
  end if;
  perform app.require_firm_owner_step_up(p_organization_id);
  continuity := app.subscription_continuity_json(p_organization_id, true);
  select coalesce(jsonb_agg(jsonb_build_object(
      'matter_id', m.id,
      'reference', m.reference,
      'stage', m.stage,
      'export_id', ex.id,
      'ready_at', ex.ready_at,
      'sha256', ex.sha256,
      'manifest_sha256', ex.manifest_sha256,
      'files', ex.file_count,
      'bytes', ex.byte_size,
      'files_deleted_under_retention', exists (select 1 from public.deletion_tombstones t where t.matter_id = m.id)
    ) order by m.created_at, m.id), '[]'::jsonb),
    count(*) filter (where ex.id is null and not exists (select 1 from public.deletion_tombstones t where t.matter_id = m.id))
    into rows_json, missing
  from public.matters m
  left join lateral (
    select x.* from public.matter_exports x
    where x.matter_id = m.id and x.status = 'ready'
    order by x.ready_at desc
    limit 1
  ) ex on true
  where m.organization_id = p_organization_id and not m.is_sample;
  perform app.record_audit_event(
    p_organization_id, 'firm_export.index_downloaded', 'public.organizations', p_organization_id, 'success',
    jsonb_build_object('matters', jsonb_array_length(rows_json), 'without_export', missing)
  );
  return jsonb_build_object(
    'generated_at', statement_timestamp(),
    'organization_id', p_organization_id,
    'coverage_since', continuity -> 'coverage' -> 'since',
    'window_ends_at', continuity -> 'window_ends_at',
    'matters', rows_json,
    'without_export', missing
  );
end;
$$;
comment on function public.firm_export_index(uuid) is
  'Firm owner + step-up: the full firm export''s index, every real matter with its newest ready client-file export (id, date, package and manifest SHA-256). The packages are the per-matter exports. Audited.';
revoke all on function public.firm_export_index(uuid) from public, anon;
grant execute on function public.firm_export_index(uuid) to authenticated;
