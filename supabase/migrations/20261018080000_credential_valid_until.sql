-- The licence's "Valid until" date from firm setup (decision 2026-10-18).
--
-- The Licence step asked for a "Valid until" date but consultant_credentials had nowhere to keep it,
-- so the value was dropped. This adds a nullable valid_until column and a narrow setter. The
-- declare_consultant_credential signature is unchanged (callers and tests pass five arguments);
-- the server declares first and then sets the date.
--
-- valid_until is what the licence holder declared. It is not a register check and does not change
-- the credential's status.

alter table public.consultant_credentials
  add column if not exists valid_until date;

comment on column public.consultant_credentials.valid_until is
  'Licence expiry date as declared by the holder or a firm owner. Not verified against the register and does not change status.';

create or replace function app.set_credential_valid_until(
  p_credential_id uuid,
  p_valid_until date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  credential public.consultant_credentials%rowtype;
  mem public.memberships%rowtype;
begin
  if actor is null or app.staff_mfa_satisfied() is distinct from true then
    raise exception 'setting a licence expiry requires two-step sign-in' using errcode = '42501';
  end if;
  select * into credential from public.consultant_credentials where id = p_credential_id;
  if credential.id is null
     or app.in_active_org(credential.organization_id) is distinct from true then
    raise exception 'licence expiry update denied' using errcode = '42501';
  end if;
  select * into mem
  from public.memberships
  where id = credential.membership_id
    and organization_id = credential.organization_id;
  -- The holder (their own active membership) or a firm owner in the same firm.
  if not (
    (mem.id is not null and mem.user_id = actor and mem.status = 'active')
    or app.has_org_role(credential.organization_id, array['firm_owner']::public.org_role[]) is true
  ) then
    raise exception 'licence expiry update denied' using errcode = '42501';
  end if;
  if p_valid_until is not null and p_valid_until < current_date then
    raise exception 'licence expiry date is in the past' using errcode = '22023';
  end if;

  update public.consultant_credentials
     set valid_until = p_valid_until
   where id = credential.id;

  perform app.record_audit_event(
    credential.organization_id,
    'licence.valid_until_set',
    'public.consultant_credentials',
    credential.id,
    'success',
    jsonb_build_object(
      'membership_id', credential.membership_id,
      'valid_until', p_valid_until,
      'previous_valid_until', credential.valid_until
    )
  );
  return credential.id;
end;
$$;

create or replace function public.set_credential_valid_until(
  p_credential_id uuid,
  p_valid_until date
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select app.set_credential_valid_until(p_credential_id, p_valid_until);
$$;

revoke all on function app.set_credential_valid_until(uuid, date) from public, anon;
revoke all on function public.set_credential_valid_until(uuid, date) from public, anon;
grant execute on function app.set_credential_valid_until(uuid, date) to authenticated, service_role;
grant execute on function public.set_credential_valid_until(uuid, date) to authenticated, service_role;
