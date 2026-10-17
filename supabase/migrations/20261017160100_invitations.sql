-- Staff invitation acceptance (ORG-02, T006).
-- The raw token is returned once to the firm owner and never stored.
-- Only sha256(token) is persisted. The invitation is bound to a normalized email,
-- one organization and one staff role. It expires (7 days) and is single-use.
-- Acceptance moves membership status from invited to active and writes an audit event.
-- The last active firm_owner cannot be removed or demoted.
-- Client and guardian invitations are a later task (T021); this path is staff-only.
-- Additive only.

create function app.hash_invitation_token(p_token text)
returns text
language sql
stable
set search_path = ''
as $$
  select encode(extensions.digest(convert_to(p_token, 'utf8'), 'sha256'), 'hex');
$$;
revoke all on function app.hash_invitation_token(text) from public;

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  email text not null check (
    email = lower(email)
    and length(email) between 3 and 320
    and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
  ),
  role public.org_role not null check (
    role in ('firm_owner', 'licensed_consultant', 'case_manager', 'assistant', 'finance_user')
  ),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  consumed_by uuid references auth.users (id),
  revoked_at timestamptz,
  membership_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id),
  check (expires_at > created_at),
  check (consumed_at is null or consumed_by is not null),
  check (consumed_at is null or revoked_at is null),
  foreign key (membership_id, organization_id)
    references public.memberships (id, organization_id)
);
comment on table public.invitations is
  'Expiring single-use staff invite. Stores sha256(token) only, bound to email and organization.';
comment on column public.invitations.token_hash is
  'Hex sha256 of the raw token. The raw token is never stored.';

create index invitations_org_email_idx on public.invitations (organization_id, email);
create index invitations_consumed_by_idx on public.invitations (consumed_by);
create index invitations_membership_idx on public.invitations (membership_id);
create index invitations_created_by_idx on public.invitations (created_by);

create trigger invitations_touch before update on public.invitations
  for each row execute function app.touch_row();

create function app.guard_invitation_keys()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.organization_id is distinct from old.organization_id
     or new.email is distinct from old.email
     or new.role is distinct from old.role
     or new.token_hash is distinct from old.token_hash
     or new.created_by is distinct from old.created_by then
    raise exception 'invitation identity columns are immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.guard_invitation_keys() from public;

create trigger invitations_immutable_keys before update on public.invitations
  for each row execute function app.guard_invitation_keys();

create trigger invitations_audit after insert or update or delete on public.invitations
  for each row execute function app.audit_row_change('token_hash');

-- ---------------------------------------------------------------------------
-- Last firm owner
-- ---------------------------------------------------------------------------
create function app.guard_last_firm_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.role = 'firm_owner' and old.status = 'active' then
    if new.role is distinct from 'firm_owner'::public.org_role
       or new.status is distinct from 'active'::public.membership_status then
      if not exists (
        select 1
        from public.memberships m
        where m.organization_id = old.organization_id
          and m.role = 'firm_owner'
          and m.status = 'active'
          and m.id <> old.id
      ) then
        raise exception 'cannot remove or demote the last firm owner' using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function app.guard_last_firm_owner() from public;

create trigger memberships_last_firm_owner before update on public.memberships
  for each row execute function app.guard_last_firm_owner();

-- ---------------------------------------------------------------------------
-- Create (firm owner + recent TOTP step-up). Returns the raw token once.
-- ---------------------------------------------------------------------------
create function app.create_staff_invitation(
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

  -- A newer invite replaces an unused one for the same person and role.
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
  return token;
end;
$$;
revoke all on function app.create_staff_invitation(uuid, text, public.org_role) from public;
grant execute on function app.create_staff_invitation(uuid, text, public.org_role) to authenticated;

create function public.create_staff_invitation(
  organization_id uuid,
  email text,
  role public.org_role
)
returns text
language sql
security invoker
set search_path = ''
as $$
  select app.create_staff_invitation(organization_id, email, role);
$$;
revoke all on function public.create_staff_invitation(uuid, text, public.org_role) from public, anon;
grant execute on function public.create_staff_invitation(uuid, text, public.org_role) to authenticated;

-- ---------------------------------------------------------------------------
-- Accept. Caller must be signed in with the invited, confirmed email.
-- Staff roles also need aal2. Status moves invited -> active in this transaction.
-- ---------------------------------------------------------------------------
create function app.accept_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  actor_email text;
  confirmed timestamptz;
  inv public.invitations;
  accepted_membership uuid;
begin
  if actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_token is null or length(p_token) < 32 or length(p_token) > 200 then
    raise exception 'invitation cannot be accepted' using errcode = '42501';
  end if;

  select u.email, u.email_confirmed_at
    into actor_email, confirmed
  from auth.users u
  where u.id = actor;

  if actor_email is null or confirmed is null then
    raise exception 'confirmed email is required to accept an invitation' using errcode = '42501';
  end if;

  select * into inv
  from public.invitations
  where token_hash = app.hash_invitation_token(p_token)
  for update;

  if not found then
    raise exception 'invitation cannot be accepted' using errcode = '42501';
  end if;
  if inv.revoked_at is not null
     or inv.consumed_at is not null
     or inv.expires_at <= statement_timestamp()
     or lower(btrim(actor_email)) is distinct from inv.email then
    raise exception 'invitation cannot be accepted' using errcode = '42501';
  end if;

  if inv.role = any (app.staff_roles()) and app.staff_mfa_satisfied() is distinct from true then
    raise exception 'staff invitation acceptance requires an authenticator assurance level of aal2'
      using errcode = '42501';
  end if;

  select m.id into accepted_membership
  from public.memberships m
  where m.organization_id = inv.organization_id
    and m.user_id = actor
    and m.role = inv.role
  for update;

  if accepted_membership is null then
    insert into public.memberships (
      organization_id, user_id, role, status, invited_by, invited_at, created_by
    ) values (
      inv.organization_id, actor, inv.role, 'invited', inv.created_by, inv.created_at, inv.created_by
    )
    returning id into accepted_membership;
  end if;

  update public.memberships
     set status = 'active',
         accepted_at = statement_timestamp()
   where id = accepted_membership
     and organization_id = inv.organization_id
     and user_id = actor
     and role = inv.role
     and status = 'invited';
  if not found then
    raise exception 'invitation cannot be accepted' using errcode = '42501';
  end if;

  update public.invitations
     set consumed_at = statement_timestamp(),
         consumed_by = actor,
         membership_id = accepted_membership
   where id = inv.id
     and consumed_at is null
     and revoked_at is null
     and expires_at > statement_timestamp();
  if not found then
    raise exception 'invitation cannot be accepted' using errcode = '42501';
  end if;

  perform app.record_audit_event(
    inv.organization_id,
    'invitation.accepted',
    'public.memberships',
    accepted_membership,
    'success',
    jsonb_build_object('role', inv.role, 'invitation_id', inv.id)
  );

  perform app.enqueue_event(
    inv.organization_id,
    'membership',
    accepted_membership,
    'membership.accepted',
    jsonb_build_object('role', inv.role),
    null,
    'invitation:' || inv.id::text
  );

  return accepted_membership;
end;
$$;
revoke all on function app.accept_invitation(text) from public;
grant execute on function app.accept_invitation(text) to authenticated;

create function public.accept_invitation(token text)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select app.accept_invitation(token);
$$;
revoke all on function public.accept_invitation(text) from public, anon;
grant execute on function public.accept_invitation(text) to authenticated;

create function app.revoke_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  inv public.invitations;
begin
  if actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  select * into inv from public.invitations where id = p_invitation_id for update;
  if not found then
    raise exception 'invitation cannot be revoked' using errcode = '42501';
  end if;
  if app.has_org_role(inv.organization_id, array['firm_owner']::public.org_role[]) is distinct from true then
    raise exception 'only a firm owner can revoke an invitation' using errcode = '42501';
  end if;
  if app.staff_mfa_satisfied() is distinct from true
     or app.mfa_step_up_satisfied() is distinct from true then
    raise exception 'revoking an invitation requires a recent TOTP step-up' using errcode = '42501';
  end if;
  if inv.consumed_at is not null or inv.revoked_at is not null then
    raise exception 'invitation cannot be revoked' using errcode = '42501';
  end if;

  update public.invitations
     set revoked_at = statement_timestamp()
   where id = inv.id
     and consumed_at is null
     and revoked_at is null;
  if not found then
    raise exception 'invitation cannot be revoked' using errcode = '42501';
  end if;

  perform app.record_audit_event(
    inv.organization_id,
    'invitation.revoked',
    'public.invitations',
    inv.id,
    'success',
    jsonb_build_object('role', inv.role)
  );
end;
$$;
revoke all on function app.revoke_invitation(uuid) from public;
grant execute on function app.revoke_invitation(uuid) to authenticated;

create function public.revoke_staff_invitation(invitation_id uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
  select app.revoke_invitation(invitation_id);
$$;
revoke all on function public.revoke_staff_invitation(uuid) from public, anon;
grant execute on function public.revoke_staff_invitation(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Privileges and RLS. No direct writes. token_hash is not granted to the API.
-- ---------------------------------------------------------------------------
revoke all on table public.invitations from anon, authenticated;
grant select (
  id,
  organization_id,
  email,
  role,
  expires_at,
  consumed_at,
  consumed_by,
  revoked_at,
  membership_id,
  created_at,
  updated_at,
  created_by,
  version
) on table public.invitations to authenticated;

alter table public.invitations enable row level security;
alter table public.invitations force row level security;

create policy invitations_select_owner on public.invitations
  for select
  to authenticated
  using (
    (select app.has_org_role(organization_id, array['firm_owner']::public.org_role[]))
    and (select app.staff_mfa_satisfied())
  );
