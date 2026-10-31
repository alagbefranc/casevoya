-- Go live (Francis, 2026-10-30: "after sign up there is no way to switch to live, there's no
-- visible UI"). A firm is in test mode until its owner switches it to live; the app shell shows a
-- Test mode badge linking to Settings > Go live, which lists what is still needed, each with the
-- page that fixes it.
--
-- Test mode changes nothing a firm can do (sample mode, the older practice flag, still keeps a
-- sample-mode firm to sample records). It records that the owner checked the firm is ready:
--   * licence: the owner's CICC licence is on file and not blocked (app.real_client_invite_blockers);
--   * subscription: a Stripe subscription with a card on file, in its trial or active, and not
--     restricted, ended or past its grace;
--   * policies: the client portal terms of use and privacy notice are published;
--   * card_payments: a live Stripe account (not test mode) with card payments active.
-- Switching to live re-checks all four on the server (a refusal is answered with what is missing
-- and audited as denied), turns sample mode off, stamps live_at and
-- writes firm.went_live to the audit log. The owner may switch back to test mode (with a confirm);
-- that only clears live_at and writes firm.returned_to_test_mode: no record, client or payment
-- changes either way. Both need the firm owner with a recent step-up.
-- Additive: two nullable columns and new functions; the guard trigger gains the two columns.

alter table public.organizations
  add column if not exists live_at timestamptz,
  add column if not exists live_by uuid references auth.users (id) on delete set null;

comment on column public.organizations.live_at is
  'When the firm owner switched the firm to live (public.switch_firm_to_live). Null: test mode.';
comment on column public.organizations.live_by is
  'The firm owner who switched the firm to live.';

CREATE OR REPLACE FUNCTION app.guard_organization_protected_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  -- Invoker on purpose: inside a SECURITY DEFINER function current_user is the
  -- function owner, so gated functions keep working. Direct API sessions are refused.
  if current_user in ('authenticated', 'anon')
     and (
       new.verification_status is distinct from old.verification_status
       or new.sample_mode is distinct from old.sample_mode
       or new.dpa_accepted_at is distinct from old.dpa_accepted_at
       or new.dpa_version is distinct from old.dpa_version
       or new.subscription_terms_accepted_at is distinct from old.subscription_terms_accepted_at
       or new.subscription_terms_version is distinct from old.subscription_terms_version
       or new.document_max_bytes is distinct from old.document_max_bytes
       or new.live_at is distinct from old.live_at
       or new.live_by is distinct from old.live_by
     ) then
    raise exception 'organization status, acceptance, and limits go through the firm setup functions'
      using errcode = '42501';
  end if;
  return new;
end;
$function$;

-- What going live needs, in order, each with done true or false.
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

-- The firm's mode and checklist, for any staff member of the current firm.
create or replace function public.firm_go_live_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  org uuid := app.current_organization_id();
  firm public.organizations%rowtype;
  items jsonb;
begin
  if (select auth.uid()) is null or org is null
     or app.has_org_role(org, app.staff_roles()) is distinct from true then
    raise exception 'firm staff only' using errcode = '42501';
  end if;
  select * into firm from public.organizations where id = org;
  items := app.go_live_checklist(org);
  return jsonb_build_object(
    'live', firm.live_at is not null,
    'live_at', firm.live_at,
    'sample_mode', firm.sample_mode,
    'items', items,
    'ready', not exists (select 1 from jsonb_array_elements(items) item where (item ->> 'done')::boolean is not true),
    'owner', app.has_org_role(org, array['firm_owner']::public.org_role[]) is true
  );
end;
$$;

create or replace function public.switch_firm_to_live()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid := app.current_organization_id();
  firm public.organizations%rowtype;
  items jsonb;
  missing text[];
  at timestamptz := statement_timestamp();
begin
  perform app.require_firm_owner_step_up(org);
  select * into firm from public.organizations where id = org for update;
  if firm.live_at is not null then
    return jsonb_build_object('live', true, 'live_at', firm.live_at, 'missing', '[]'::jsonb);
  end if;
  items := app.go_live_checklist(org);
  select coalesce(array_agg(item ->> 'key' order by ordinality), array[]::text[]) into missing
  from jsonb_array_elements(items) with ordinality as list(item, ordinality)
  where (item ->> 'done')::boolean is not true;
  if cardinality(missing) > 0 then
    perform app.record_audit_event(
      org, 'firm.went_live', 'public.organizations', org, 'denied',
      jsonb_build_object('missing', to_jsonb(missing))
    );
    -- Answered, not raised, so the refusal's audit row is kept.
    return jsonb_build_object('live', false, 'live_at', null, 'missing', to_jsonb(missing));
  end if;
  update public.organizations
  set live_at = at, live_by = (select auth.uid()), sample_mode = false
  where id = org;
  perform app.record_audit_event(
    org, 'firm.went_live', 'public.organizations', org, 'success',
    jsonb_build_object('items', items, 'sample_mode_was', firm.sample_mode)
  );
  return jsonb_build_object('live', true, 'live_at', at, 'missing', '[]'::jsonb);
end;
$$;

create or replace function public.switch_firm_to_test(p_confirm text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid := app.current_organization_id();
  firm public.organizations%rowtype;
begin
  perform app.require_firm_owner_step_up(org);
  if p_confirm is distinct from 'switch to test mode' then
    raise exception 'confirm switching back to test mode' using errcode = '22023';
  end if;
  select * into firm from public.organizations where id = org for update;
  if firm.live_at is null then
    return;
  end if;
  update public.organizations set live_at = null, live_by = null where id = org;
  perform app.record_audit_event(
    org, 'firm.returned_to_test_mode', 'public.organizations', org, 'success',
    jsonb_build_object('live_since', firm.live_at)
  );
end;
$$;

revoke all on function public.firm_go_live_status() from public, anon;
revoke all on function public.switch_firm_to_live() from public, anon;
revoke all on function public.switch_firm_to_test(text) from public, anon;
grant execute on function public.firm_go_live_status() to authenticated, service_role;
grant execute on function public.switch_firm_to_live() to authenticated, service_role;
grant execute on function public.switch_firm_to_test(text) to authenticated, service_role;

comment on function public.switch_firm_to_live() is
  'Firm owner with a recent step-up: re-checks app.go_live_checklist (answers {live:false, missing} and audits a denied attempt while anything is missing), turns sample mode off, stamps organizations.live_at and audits firm.went_live (denied attempts too).';
comment on function public.switch_firm_to_test(text) is
  'Firm owner with a recent step-up and the confirm words: clears organizations.live_at and audits firm.returned_to_test_mode. No record changes.';
