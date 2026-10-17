-- Invite preview for the person who holds the raw token, and a lost-authenticator
-- request. Firm setup lives in 20261017140700_firm_onboarding.sql (already applied).

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
