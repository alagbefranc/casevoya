-- Casevoya foundation: tenancy core
-- organizations (tenant boundary), profiles (1:1 auth.users), memberships (user <-> org + role),
-- tenant-context helpers, row versioning, RLS (ENABLE + FORCE) with membership policies.
-- Additive only. No destructive statements.

create extension if not exists pgcrypto with schema extensions;

-- Private schema for helpers. Not exposed through the Data API.
create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
-- Firm-side roles (PRD section 5). Portal roles are listed so a portal user can hold an
-- org membership, but what they can see is decided by person/matter grants (later tasks).
-- Platform admin is deliberately NOT an org role.
create type public.org_role as enum (
  'firm_owner',
  'licensed_consultant',
  'case_manager',
  'assistant',
  'finance_user',
  'client',
  'adult_dependant',
  'sponsor',
  'employer_contact',
  'guardian',
  'external_collaborator'
);

create type public.membership_status as enum ('invited', 'active', 'suspended', 'revoked');

-- An unverified firm only gets a sandbox (PRD ORG / commercial rules).
create type public.org_verification_status as enum ('unverified', 'pending_review', 'verified', 'restricted');

-- ---------------------------------------------------------------------------
-- Generic row helpers
-- ---------------------------------------------------------------------------
-- Bumps updated_at and version on every UPDATE (optimistic locking: callers filter on
-- the version they read; a stale write matches 0 rows and the server returns 409).
create function app.touch_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.version := old.version + 1;
  new.created_at := old.created_at;
  new.created_by := old.created_by;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null check (length(btrim(legal_name)) between 1 and 300),
  display_name text not null check (length(btrim(display_name)) between 1 and 200),
  slug text not null unique check (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$'),
  default_locale text not null default 'en-CA' check (default_locale in ('en-CA', 'fr-CA')),
  timezone text not null default 'America/Toronto',
  jurisdiction_codes text[] not null default array['CA']::text[],
  verification_status public.org_verification_status not null default 'unverified',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1)
);
comment on table public.organizations is 'Tenant boundary. organizations.id is the organization_id carried by every tenant row.';

create table public.profiles (
  id uuid primary key references auth.users (id),
  display_name text check (display_name is null or length(display_name) <= 200),
  preferred_locale text not null default 'en-CA' check (preferred_locale in ('en-CA', 'fr-CA')),
  timezone text not null default 'America/Toronto',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1)
);
comment on table public.profiles is 'Global per-login profile (1:1 with auth.users). Not a client Person record; Persons are tenant-local.';

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  user_id uuid not null references auth.users (id),
  role public.org_role not null,
  status public.membership_status not null default 'invited',
  invited_by uuid references auth.users (id),
  invited_at timestamptz,
  accepted_at timestamptz,
  suspended_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  -- one row per role: a firm owner is not automatically a licensed consultant
  unique (organization_id, user_id, role),
  -- lets later tables use composite (id, organization_id) foreign keys
  unique (id, organization_id),
  check (status <> 'revoked' or revoked_at is not null)
);
comment on table public.memberships is 'Binds a global auth user to an organization with one role per row.';

create index memberships_user_status_idx on public.memberships (user_id, status);
create index memberships_org_role_idx on public.memberships (organization_id, role, status);
create index memberships_invited_by_idx on public.memberships (invited_by);
create index memberships_created_by_idx on public.memberships (created_by);
create index organizations_created_by_idx on public.organizations (created_by);
create index profiles_created_by_idx on public.profiles (created_by);

create trigger organizations_touch before update on public.organizations
  for each row execute function app.touch_row();
create trigger profiles_touch before update on public.profiles
  for each row execute function app.touch_row();
create trigger memberships_touch before update on public.memberships
  for each row execute function app.touch_row();

-- Tenant and identity keys never move.
create function app.guard_immutable_keys()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_table_name = 'memberships' then
    if new.organization_id is distinct from old.organization_id
       or new.user_id is distinct from old.user_id
       or new.id is distinct from old.id then
      raise exception 'membership organization_id, user_id and id are immutable' using errcode = '42501';
    end if;
  elsif new.id is distinct from old.id then
    raise exception '% id is immutable', tg_table_name using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger organizations_immutable_keys before update on public.organizations
  for each row execute function app.guard_immutable_keys();
create trigger profiles_immutable_keys before update on public.profiles
  for each row execute function app.guard_immutable_keys();
create trigger memberships_immutable_keys before update on public.memberships
  for each row execute function app.guard_immutable_keys();

-- ---------------------------------------------------------------------------
-- Tenant context helpers (SECURITY DEFINER, private schema, fixed search_path)
-- ---------------------------------------------------------------------------
create function app.staff_roles()
returns public.org_role[]
language sql
immutable
set search_path = ''
as $$
  select array['firm_owner','licensed_consultant','case_manager','assistant','finance_user']::public.org_role[];
$$;

-- True when the current auth user holds an active membership in org (any of roles, if given).
create function app.has_org_role(org uuid, roles public.org_role[] default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    where m.organization_id = org
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and (roles is null or m.role = any (roles))
  );
$$;

create function app.is_org_member(org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.has_org_role(org, null);
$$;

create function app.is_org_staff(org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.has_org_role(org, app.staff_roles());
$$;

-- Active workspace for this request/transaction.
-- Sources, in order: transaction-local setting app.organization_id (server code and workers
-- set it with set_config(..., true)); then the x-casevoya-org request header (PostgREST).
-- The value is only returned when the current user is an active member, so a
-- request-supplied org id is never trusted on its own. Returns null otherwise.
create function app.current_organization_id()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  raw text;
  org uuid;
begin
  raw := nullif(current_setting('app.organization_id', true), '');
  if raw is null then
    begin
      raw := nullif((nullif(current_setting('request.headers', true), '')::json ->> 'x-casevoya-org'), '');
    exception when others then
      raw := null;
    end;
  end if;
  if raw is null or raw !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return null;
  end if;
  org := raw::uuid;
  if app.is_org_member(org) then
    return org;
  end if;
  return null;
end;
$$;

-- Row belongs to the active workspace and the user is an active member of it.
-- Future tenant tables use this in their policies.
create function app.in_active_org(org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select org is not null and org = app.current_organization_id();
$$;

-- Two users share an organization where the viewer is staff (lets staff see co-member profiles).
create function app.viewer_is_staff_with(target_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships viewer
    join public.memberships target on target.organization_id = viewer.organization_id
    where viewer.user_id = (select auth.uid())
      and viewer.status = 'active'
      and viewer.role = any (app.staff_roles())
      and target.user_id = target_user
      and target.status in ('invited', 'active', 'suspended')
  );
$$;

revoke all on function app.touch_row() from public;
revoke all on function app.guard_immutable_keys() from public;
revoke all on function app.staff_roles() from public;
revoke all on function app.has_org_role(uuid, public.org_role[]) from public;
revoke all on function app.is_org_member(uuid) from public;
revoke all on function app.is_org_staff(uuid) from public;
revoke all on function app.current_organization_id() from public;
revoke all on function app.in_active_org(uuid) from public;
revoke all on function app.viewer_is_staff_with(uuid) from public;
grant execute on function app.staff_roles() to authenticated, service_role;
grant execute on function app.has_org_role(uuid, public.org_role[]) to authenticated, service_role;
grant execute on function app.is_org_member(uuid) to authenticated, service_role;
grant execute on function app.is_org_staff(uuid) to authenticated, service_role;
grant execute on function app.current_organization_id() to authenticated, service_role;
grant execute on function app.in_active_org(uuid) to authenticated, service_role;
grant execute on function app.viewer_is_staff_with(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Profile provisioning on sign-up
-- ---------------------------------------------------------------------------
-- raw_user_meta_data is user-editable: it is only used for a display name, never for authz.
create function app.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, created_by)
  values (
    new.id,
    left(nullif(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', new.raw_user_meta_data ->> 'full_name', '')), ''), 200),
    new.id
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
revoke all on function app.handle_new_auth_user() from public;

create trigger on_auth_user_created_casevoya_profile
  after insert on auth.users
  for each row execute function app.handle_new_auth_user();

-- ---------------------------------------------------------------------------
-- Organization creation (atomic: org + firm_owner membership)
-- ---------------------------------------------------------------------------
create function app.create_organization(p_legal_name text, p_display_name text, p_slug text)
returns public.organizations
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  org public.organizations;
begin
  if uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  insert into public.organizations (legal_name, display_name, slug, created_by)
  values (btrim(p_legal_name), btrim(p_display_name), lower(btrim(p_slug)), uid)
  returning * into org;

  insert into public.memberships (organization_id, user_id, role, status, accepted_at, created_by)
  values (org.id, uid, 'firm_owner', 'active', now(), uid);

  return org;
end;
$$;
revoke all on function app.create_organization(text, text, text) from public;
grant execute on function app.create_organization(text, text, text) to authenticated;

-- Thin SECURITY INVOKER wrapper so the RPC is reachable through the Data API without a
-- SECURITY DEFINER function living in an exposed schema.
create function public.create_organization(legal_name text, display_name text, slug text)
returns public.organizations
language sql
security invoker
set search_path = ''
as $$
  select * from app.create_organization(legal_name, display_name, slug);
$$;
revoke all on function public.create_organization(text, text, text) from public, anon;
grant execute on function public.create_organization(text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Privileges: nothing for anon; authenticated gets only what policies allow.
-- ---------------------------------------------------------------------------
revoke all on table public.organizations from anon, authenticated;
revoke all on table public.profiles from anon, authenticated;
revoke all on table public.memberships from anon, authenticated;
grant select, update on table public.organizations to authenticated;
grant select, update on table public.profiles to authenticated;
grant select, insert, update on table public.memberships to authenticated;

-- ---------------------------------------------------------------------------
-- Row-level security (ENABLE + FORCE). No DELETE policies anywhere: deletion is a
-- retention workflow, not a client action.
-- ---------------------------------------------------------------------------
alter table public.organizations enable row level security;
alter table public.organizations force row level security;
alter table public.profiles enable row level security;
alter table public.profiles force row level security;
alter table public.memberships enable row level security;
alter table public.memberships force row level security;

-- organizations
create policy organizations_select_member on public.organizations
  for select to authenticated
  using ((select app.is_org_member(id)));

create policy organizations_update_owner on public.organizations
  for update to authenticated
  using ((select app.has_org_role(id, array['firm_owner']::public.org_role[])))
  with check ((select app.has_org_role(id, array['firm_owner']::public.org_role[])));

-- profiles
create policy profiles_select_self_or_staff on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select app.viewer_is_staff_with(id)));

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- memberships
create policy memberships_select_self_or_staff on public.memberships
  for select to authenticated
  using (user_id = (select auth.uid()) or (select app.is_org_staff(organization_id)));

create policy memberships_insert_owner on public.memberships
  for insert to authenticated
  with check (
    (select app.has_org_role(organization_id, array['firm_owner']::public.org_role[]))
    and created_by = (select auth.uid())
    and invited_by = (select auth.uid())
    and status = 'invited'
  );

create policy memberships_update_owner on public.memberships
  for update to authenticated
  using ((select app.has_org_role(organization_id, array['firm_owner']::public.org_role[])))
  with check ((select app.has_org_role(organization_id, array['firm_owner']::public.org_role[])));
