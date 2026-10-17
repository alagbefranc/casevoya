-- Firm onboarding progress (T018) and two thin reads the auth screens need.
-- organizations keeps the firm record. The eight setup steps, and the fields that
-- have no column yet (contacts, licence, branding, retention), live on firm_onboarding.
-- sample_mode is a flag only. This migration does not insert sample people or matters.
-- preview_invitation lets the person holding a raw invite token see its status
-- without a service-role key. request_mfa_reset records a lost-device request.
-- Additive only. Not applied to the live project by this change.

create table public.firm_onboarding (
  organization_id uuid primary key references public.organizations (id),
  sample_mode boolean not null default false,
  current_step text not null default 'firm_details' check (
    current_step in (
      'firm_details',
      'terms_and_privacy',
      'jurisdictions',
      'licence',
      'branding',
      'calendar_and_payments',
      'records_and_retention',
      'sample_case'
    )
  ),
  completed_steps text[] not null default '{}'::text[] check (
    completed_steps <@ array[
      'firm_details',
      'terms_and_privacy',
      'jurisdictions',
      'licence',
      'branding',
      'calendar_and_payments',
      'records_and_retention',
      'sample_case'
    ]::text[]
  ),
  details jsonb not null default '{}'::jsonb check (octet_length(details::text) < 16000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1)
);

comment on table public.firm_onboarding is
  'Firm setup progress. Sample mode is a flag; it does not seed demonstration rows.';

create function app.guard_firm_onboarding_keys()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.organization_id is distinct from old.organization_id
     or new.created_at is distinct from old.created_at
     or new.created_by is distinct from old.created_by then
    raise exception 'firm onboarding identity columns are immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function app.guard_firm_onboarding_keys() from public;

create trigger firm_onboarding_touch
  before update on public.firm_onboarding
  for each row execute function app.touch_row();

create trigger firm_onboarding_immutable_keys
  before update on public.firm_onboarding
  for each row execute function app.guard_firm_onboarding_keys();

create trigger firm_onboarding_audit
  after insert or update or delete on public.firm_onboarding
  for each row execute function app.audit_row_change();

create function app.seed_firm_onboarding()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.firm_onboarding (organization_id, created_by)
  values (new.id, new.created_by)
  on conflict (organization_id) do nothing;
  return new;
end;
$$;

revoke all on function app.seed_firm_onboarding() from public;

create trigger organizations_seed_onboarding
  after insert on public.organizations
  for each row execute function app.seed_firm_onboarding();

revoke all on table public.firm_onboarding from anon, authenticated;
grant select, insert, update on table public.firm_onboarding to authenticated;

alter table public.firm_onboarding enable row level security;
alter table public.firm_onboarding force row level security;

create policy firm_onboarding_select_owner on public.firm_onboarding
  for select to authenticated
  using (
    (select app.has_org_role(organization_id, array['firm_owner']::public.org_role[]))
    and (select app.staff_mfa_satisfied())
  );

create policy firm_onboarding_insert_owner on public.firm_onboarding
  for insert to authenticated
  with check (
    (select app.has_org_role(organization_id, array['firm_owner']::public.org_role[]))
    and (select app.staff_mfa_satisfied())
    and created_by = (select auth.uid())
  );

create policy firm_onboarding_update_owner on public.firm_onboarding
  for update to authenticated
  using (
    (select app.has_org_role(organization_id, array['firm_owner']::public.org_role[]))
    and (select app.staff_mfa_satisfied())
  )
  with check (
    (select app.has_org_role(organization_id, array['firm_owner']::public.org_role[]))
    and (select app.staff_mfa_satisfied())
  );

create policy firm_onboarding_session_not_revoked on public.firm_onboarding
  as restrictive
  for all
  to authenticated
  using (not (select app.session_is_revoked()))
  with check (not (select app.session_is_revoked()));

-- The invitee holds the raw token. Return status, email, role and firm name.
-- Do not return the token hash. Unknown tokens share one row shape.
create function public.preview_invitation(p_token text)
returns table (
  status text,
  email text,
  role text,
  organization_name text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec public.invitations%rowtype;
  org_name text;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return query select 'unknown'::text, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  select * into rec
  from public.invitations
  where token_hash = app.hash_invitation_token(p_token);

  if not found then
    return query select 'unknown'::text, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  select o.display_name into org_name
  from public.organizations o
  where o.id = rec.organization_id;

  if rec.consumed_at is not null then
    return query select 'used'::text, rec.email, rec.role::text, org_name, rec.expires_at;
    return;
  end if;

  if rec.revoked_at is not null or rec.expires_at <= now() then
    return query select 'expired'::text, rec.email, rec.role::text, org_name, rec.expires_at;
    return;
  end if;

  return query select 'valid'::text, rec.email, rec.role::text, org_name, rec.expires_at;
end;
$$;

revoke all on function public.preview_invitation(text) from public;
grant execute on function public.preview_invitation(text) to anon, authenticated, service_role;

-- A signed-in person can ask their firm owner to confirm a lost authenticator.
-- The reason text is not stored. Owner reset remains reset_staff_mfa.
create function public.request_mfa_reset(p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  org uuid;
begin
  if uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  if p_reason is not null and length(p_reason) > 2000 then
    raise exception 'reason is too long' using errcode = '22023';
  end if;

  select m.organization_id into org
  from public.memberships m
  where m.user_id = uid
    and m.status = 'active'
  order by m.created_at
  limit 1;

  return app.record_audit_event(
    org,
    'mfa.reset_requested',
    null,
    null,
    'success',
    jsonb_build_object('reason_length', coalesce(length(p_reason), 0))
  );
end;
$$;

revoke all on function public.request_mfa_reset(text) from public, anon;
grant execute on function public.request_mfa_reset(text) to authenticated, service_role;
