-- Go live: the 'subscription' item counts only a subscription that is not paused for billing.
-- A trial or active row with a Stripe subscription id also needs no pending card (card_required
-- is false) and, when active, no cancellation date already reached (app.sync_subscription_state
-- turns it cancelled). This matches app.subscription_entitlements answering neither
-- new_work_blocked nor checkout_required. Copied from 20261101100200_firm_go_live.sql; only the
-- subscription condition changes.

create or replace function app.go_live_checklist(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  blockers text[] := app.real_client_invite_blockers(p_org);
  licence boolean;
  subscription boolean;
  policies boolean;
  card_payments boolean;
begin
  licence := not (blockers && array['firm_not_found', 'firm_restricted', 'owner_licence_missing', 'owner_licence_blocked']::text[]);
  subscription := not (blockers && array['trial_ended', 'subscription_restricted']::text[])
    and exists (
      select 1 from public.organization_subscriptions sub
      where sub.organization_id = p_org
        and sub.status in ('trial', 'active')
        and sub.stripe_subscription_id is not null
        and sub.card_required is false
        and not (sub.status = 'active' and sub.cancel_at is not null and sub.cancel_at <= statement_timestamp())
    );
  policies := exists (
      select 1 from public.portal_policy_documents doc
      where doc.organization_id = p_org and doc.kind = 'portal_terms'
    )
    and exists (
      select 1 from public.portal_policy_documents doc
      where doc.organization_id = p_org and doc.kind = 'privacy_notice'
    )
    and exists (
      select 1 from public.organizations org
      where org.id = p_org and org.privacy_notice_withdrawn_at is null
    );
  card_payments := exists (
    select 1 from public.firm_payment_accounts account
    where account.organization_id = p_org
      and account.livemode is true
      and account.card_payments_status = 'active'
  );
  return jsonb_build_array(
    jsonb_build_object('key', 'licence', 'done', licence),
    jsonb_build_object('key', 'subscription', 'done', subscription),
    jsonb_build_object('key', 'policies', 'done', policies),
    jsonb_build_object('key', 'card_payments', 'done', card_payments)
  );
end;
$$;
revoke all on function app.go_live_checklist(uuid) from public, anon, authenticated;
