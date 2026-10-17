-- Finance billing access (PRD §5, FIN-05–FIN-11, T007/T030 boundary).
-- finance_user reads a billing projection of assigned matters (id, title, stage,
-- applicant display name) and may issue invoices or approve earned-fee transfers.
-- They do not gain person-row access. Agreement and ledger tables are still T030;
-- these actions are the authorization and audit point those tables will call.
-- Firm owners bill across the active workspace. Assistants do not.
-- Additive only.

create function app.actor_finance_assigned_to_matter(p_matter_id uuid, p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.matter_participants mp
    join public.memberships mem
      on mem.id = mp.membership_id
     and mem.organization_id = mp.organization_id
    where mp.matter_id = p_matter_id
      and mp.organization_id = p_org
      and mem.user_id = (select auth.uid())
      and mem.status = 'active'
      and mem.role = 'finance_user'
  );
$$;

create function app.can_read_matter_billing(p_matter_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.matters matter
    where matter.id = p_matter_id
      and app.in_active_org(matter.organization_id)
      and app.staff_mfa_satisfied()
      and (
        app.has_org_role(matter.organization_id, array['firm_owner']::public.org_role[])
        or (
          app.has_org_role(matter.organization_id, array['finance_user']::public.org_role[])
          and app.actor_finance_assigned_to_matter(matter.id, matter.organization_id)
        )
      )
  );
$$;

-- True when this caller may perform p_action on the matter.
-- issue_invoice: finance assigned, or firm owner, at aal2.
-- approve_earned_fee_transfer: the same, plus a recent step-up (money movement).
create function app.can_perform_billing(p_matter_id uuid, p_action text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.can_read_matter_billing(p_matter_id)
     and p_action in ('issue_invoice', 'approve_earned_fee_transfer')
     and (
       p_action = 'issue_invoice'
       or app.mfa_step_up_satisfied()
     );
$$;

create function app.perform_billing_action(p_matter_id uuid, p_action text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid;
  audit_id uuid;
begin
  if p_action not in ('issue_invoice', 'approve_earned_fee_transfer') then
    raise exception 'unknown billing action' using errcode = '22023';
  end if;
  if (select auth.uid()) is null or app.can_perform_billing(p_matter_id, p_action) is distinct from true then
    raise exception 'billing access denied' using errcode = '42501';
  end if;
  select matter.organization_id into org
  from public.matters matter
  where matter.id = p_matter_id;
  audit_id := app.record_audit_event(
    org,
    'billing.' || p_action,
    'public.matters',
    p_matter_id,
    'success',
    jsonb_build_object('action', p_action)
  );
  return audit_id;
end;
$$;

create function public.list_matter_billing()
returns table (
  matter_id uuid,
  organization_id uuid,
  title text,
  stage public.matter_stage,
  client_display_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    matter.id,
    matter.organization_id,
    matter.title,
    matter.stage,
    (
      select string_agg(person.display_name, ', ' order by person.display_name)
      from public.matter_participants mp
      join public.persons person
        on person.id = mp.person_id
       and person.organization_id = mp.organization_id
      where mp.matter_id = matter.id
        and mp.organization_id = matter.organization_id
        and mp.role = 'applicant'
    ) as client_display_name
  from public.matters matter
  where app.can_read_matter_billing(matter.id);
$$;
comment on function public.list_matter_billing() is
  'Billing projection: matter id, title, stage, and applicant display names. No person row, email, or narrative.';

create function public.perform_billing_action(p_matter_id uuid, p_action text)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select app.perform_billing_action(p_matter_id, p_action);
$$;

revoke all on function app.actor_finance_assigned_to_matter(uuid, uuid) from public;
revoke all on function app.can_read_matter_billing(uuid) from public;
revoke all on function app.can_perform_billing(uuid, text) from public;
revoke all on function app.perform_billing_action(uuid, text) from public;
revoke all on function public.list_matter_billing() from public, anon;
revoke all on function public.perform_billing_action(uuid, text) from public, anon;

grant execute on function app.actor_finance_assigned_to_matter(uuid, uuid) to authenticated, service_role;
grant execute on function app.can_read_matter_billing(uuid) to authenticated, service_role;
grant execute on function app.can_perform_billing(uuid, text) to authenticated, service_role;
grant execute on function app.perform_billing_action(uuid, text) to authenticated, service_role;
grant execute on function public.list_matter_billing() to authenticated, service_role;
grant execute on function public.perform_billing_action(uuid, text) to authenticated, service_role;
