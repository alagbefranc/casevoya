-- ADM-01..05: backend for the platform administration portal (casevoya-admin).
--
-- Additive. This migration inserts no platform_admins row and does not run the bootstrap.
--
--   * platform_admins gains role (owner / operator / viewer) and template_reviewer.
--   * Removing an admin is owner-only with a fresh step-up. The row is archived in
--     platform_admin_removals and then deleted under a transaction-local switch; every other
--     delete is still refused. Every existing "is this a platform admin" check keeps working.
--   * Invites: an owner invites an email; that person signs in (aal2) and accepts.
--   * bootstrap_first_platform_admin: service role only, refuses once any admin exists.
--   * platform_admin_record_audit: the portal records who did what (the service role alone
--     would leave actor_user_id empty).
--   * Read functions for the portal (service role): overview, firms, subscription exceptions,
--     licence queue, outbox health and dead letters (never the payload), audit log, complaints
--     and support SLA aggregates (counts only), support requests, admin list.
--   * platform_replay_outbox_event: a platform admin (operator or owner) with a fresh step-up.
--   * Shared template sources: a draft lists its sources; publishing requires at least one
--     official https source. Reviewers must hold the template_reviewer flag.

-- ---------------------------------------------------------------------------
-- platform_admins: role and reviewer flag
-- ---------------------------------------------------------------------------
alter table public.platform_admins
  add column if not exists role text not null default 'operator',
  add column if not exists template_reviewer boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'platform_admins_role_check'
                 and conrelid = 'public.platform_admins'::regclass) then
    alter table public.platform_admins
      add constraint platform_admins_role_check check (role in ('owner', 'operator', 'viewer'));
  end if;
end
$$;

comment on column public.platform_admins.role is
  'owner: everything, including admin management. operator: day-to-day actions. viewer: read only (enforced by the portal; DB functions that change admins require owner).';
comment on column public.platform_admins.template_reviewer is
  'ADM-03: may approve, reject or roll back shared templates (still needs an active licence and a fresh step-up).';

-- ---------------------------------------------------------------------------
-- Removal archive and the delete guard
-- ---------------------------------------------------------------------------
create table if not exists public.platform_admin_removals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id),
  role text not null,
  template_reviewer boolean not null,
  note text,
  added_at timestamptz not null,
  added_by uuid references auth.users (id),
  removed_at timestamptz not null default now(),
  removed_by uuid not null references auth.users (id),
  reason text not null check (length(btrim(reason)) between 3 and 500)
);
comment on table public.platform_admin_removals is
  'ADM: a platform admin who was removed. Append-only; the history of who held platform access.';
create index if not exists platform_admin_removals_user_idx on public.platform_admin_removals (user_id, removed_at desc);
create index if not exists platform_admin_removals_removed_by_idx on public.platform_admin_removals (removed_by);
create index if not exists platform_admin_removals_added_by_idx on public.platform_admin_removals (added_by);

create or replace function app.platform_admins_delete_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('app.platform_admin_removal', true), '') = old.user_id::text then
    return old;
  end if;
  raise exception 'platform admins are removed only through platform_admin_remove' using errcode = '42501';
end;
$$;
revoke all on function app.platform_admins_delete_guard() from public;

alter table public.platform_admins disable trigger platform_admins_no_delete;
create trigger platform_admins_removal_only before delete on public.platform_admins
  for each row execute function app.platform_admins_delete_guard();

create trigger platform_admin_removals_no_update before update on public.platform_admin_removals
  for each row execute function app.reject_governed_delete();
create trigger platform_admin_removals_no_delete before delete on public.platform_admin_removals
  for each row execute function app.reject_governed_delete();
create trigger platform_admin_removals_no_truncate before truncate on public.platform_admin_removals
  for each statement execute function app.reject_governed_delete();

alter table public.platform_admin_removals enable row level security;
alter table public.platform_admin_removals force row level security;
revoke all on table public.platform_admin_removals from public, anon, authenticated, service_role;
grant select on table public.platform_admin_removals to service_role, authenticated;
create policy platform_admin_removals_select_admin on public.platform_admin_removals
  for select to authenticated using ((select app.is_platform_admin()));

-- ---------------------------------------------------------------------------
-- Invites
-- ---------------------------------------------------------------------------
create table if not exists public.platform_admin_invites (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(btrim(email)) and length(email) between 3 and 320 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role text not null check (role in ('owner', 'operator', 'viewer')),
  template_reviewer boolean not null default false,
  note text check (note is null or length(note) <= 200),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'cancelled')),
  invited_by uuid not null references auth.users (id),
  invited_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_user_id uuid references auth.users (id),
  accepted_at timestamptz,
  cancelled_by uuid references auth.users (id),
  cancelled_at timestamptz,
  cancel_reason text check (cancel_reason is null or length(cancel_reason) <= 500),
  check (expires_at > invited_at),
  check ((status = 'accepted') = (accepted_at is not null and accepted_user_id is not null)),
  check ((status = 'cancelled') = (cancelled_at is not null))
);
comment on table public.platform_admin_invites is
  'ADM: an owner invited an email to become a platform admin. Accepting needs that person''s own aal2 session. Expired = pending past expires_at. No email is sent by the database.';
create unique index if not exists platform_admin_invites_one_pending_uidx
  on public.platform_admin_invites (email) where status = 'pending';
create index if not exists platform_admin_invites_invited_by_idx on public.platform_admin_invites (invited_by);
create index if not exists platform_admin_invites_accepted_user_idx on public.platform_admin_invites (accepted_user_id);
create index if not exists platform_admin_invites_cancelled_by_idx on public.platform_admin_invites (cancelled_by);

create or replace function app.platform_admin_invite_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('app.platform_admin_write', true), '') = 'on' then
    return new;
  end if;
  raise exception 'platform admin invites change only through the invite functions' using errcode = '42501';
end;
$$;
revoke all on function app.platform_admin_invite_guard() from public;

create trigger platform_admin_invites_guard before insert or update on public.platform_admin_invites
  for each row execute function app.platform_admin_invite_guard();
create trigger platform_admin_invites_no_delete before delete on public.platform_admin_invites
  for each row execute function app.reject_governed_delete();
create trigger platform_admin_invites_no_truncate before truncate on public.platform_admin_invites
  for each statement execute function app.reject_governed_delete();
create trigger platform_admin_invites_audit after insert or update on public.platform_admin_invites
  for each row execute function app.audit_row_change();

alter table public.platform_admin_invites enable row level security;
alter table public.platform_admin_invites force row level security;
revoke all on table public.platform_admin_invites from public, anon, authenticated, service_role;
grant select on table public.platform_admin_invites to service_role, authenticated;
create policy platform_admin_invites_select_admin on public.platform_admin_invites
  for select to authenticated using ((select app.is_platform_admin()));

-- ---------------------------------------------------------------------------
-- Actor helpers
-- ---------------------------------------------------------------------------
create or replace function app.platform_admin_role(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select pa.role from public.platform_admins pa where pa.user_id = p_user_id;
$$;
revoke all on function app.platform_admin_role(uuid) from public;

-- The caller's own session: a platform admin (aal2), fresh step-up, and one of the roles.
create or replace function app.platform_session_actor(p_roles text[])
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  r text;
begin
  if uid is null or app.is_platform_admin() is distinct from true then
    raise exception 'platform admin access denied' using errcode = '42501';
  end if;
  if app.mfa_step_up_satisfied() is distinct from true then
    raise exception 'step-up is required' using errcode = '42501';
  end if;
  r := app.platform_admin_role(uid);
  if r is null or not (r = any (p_roles)) then
    raise exception 'your platform role does not allow this' using errcode = '42501';
  end if;
  return uid;
end;
$$;
revoke all on function app.platform_session_actor(text[]) from public;

-- ---------------------------------------------------------------------------
-- Audit entry recorded by the portal for the acting admin
-- ---------------------------------------------------------------------------
create or replace function public.platform_admin_record_audit(
  p_actor uuid,
  p_action text,
  p_object_table text default null,
  p_object_id uuid default null,
  p_organization_id uuid default null,
  p_result text default 'success',
  p_context jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  rid uuid;
begin
  if app.current_actor_type() is distinct from 'service' then
    raise exception 'audit recording denied' using errcode = '42501';
  end if;
  if p_action is null or p_action !~ '^admin_portal\.[a-z0-9_.]{1,60}$' then
    raise exception 'portal audit actions start with admin_portal.' using errcode = '22023';
  end if;
  if p_result is null or p_result not in ('success', 'denied', 'failure') then
    raise exception 'result is success, denied or failure' using errcode = '22023';
  end if;
  if p_actor is not null and not exists (select 1 from auth.users u where u.id = p_actor) then
    raise exception 'unknown actor' using errcode = '22023';
  end if;
  if p_context is not null and (jsonb_typeof(p_context) <> 'object' or length(p_context::text) > 4000) then
    raise exception 'context is a small object' using errcode = '22023';
  end if;
  if p_organization_id is not null and not exists (select 1 from public.organizations o where o.id = p_organization_id) then
    raise exception 'unknown organization' using errcode = '22023';
  end if;
  insert into public.audit_log (organization_id, actor_user_id, actor_type, action, object_table, object_id, result, request_id, context)
  values (
    p_organization_id, p_actor, 'service', p_action, left(p_object_table, 120), p_object_id, p_result,
    left(coalesce(p_context ->> 'request_id', app.current_request_id()), 200),
    coalesce(p_context, '{}'::jsonb) || jsonb_build_object('via', 'admin_portal')
  )
  returning id into rid;
  return rid;
end;
$$;
comment on function public.platform_admin_record_audit(uuid, text, text, uuid, uuid, text, jsonb) is
  'ADM: the admin portal (service role) records an action with the acting admin as actor. Actions are admin_portal.*';
revoke all on function public.platform_admin_record_audit(uuid, text, text, uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.platform_admin_record_audit(uuid, text, text, uuid, uuid, text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- First admin bootstrap (service role only; never run by this migration)
-- ---------------------------------------------------------------------------
create or replace function public.bootstrap_first_platform_admin(p_user_id uuid, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  u auth.users%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if app.current_actor_type() is distinct from 'service' then
    raise exception 'bootstrap is service role only' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('casevoya.platform_admin_bootstrap'));
  if exists (select 1 from public.platform_admins) then
    raise exception 'a platform admin already exists; invite further admins from the portal' using errcode = '42501';
  end if;
  select * into u from auth.users where id = p_user_id;
  if u.id is null then
    raise exception 'no such user' using errcode = '22023';
  end if;
  if u.email_confirmed_at is null then
    raise exception 'the user has not confirmed their email' using errcode = '22023';
  end if;
  if not exists (select 1 from auth.mfa_factors f where f.user_id = u.id and f.status = 'verified') then
    raise exception 'the user has no verified MFA factor' using errcode = '22023';
  end if;
  if v_note is not null and length(v_note) > 200 then
    raise exception 'the note is at most 200 characters' using errcode = '22023';
  end if;
  insert into public.platform_admins (user_id, note, role, template_reviewer)
  values (u.id, coalesce(v_note, 'first platform admin'), 'owner', false);
  perform app.record_audit_event(null, 'platform_admin.bootstrapped', 'public.platform_admins', u.id, 'success',
    jsonb_build_object('role', 'owner'));
  return u.id;
end;
$$;
comment on function public.bootstrap_first_platform_admin(uuid, text) is
  'ADM: one-time creation of the first platform admin (owner). Service role only. Refuses once any platform admin exists. Requires a confirmed email and a verified MFA factor.';
revoke all on function public.bootstrap_first_platform_admin(uuid, text) from public, anon, authenticated;
grant execute on function public.bootstrap_first_platform_admin(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- Admin management (the owner's own session with a fresh step-up)
-- ---------------------------------------------------------------------------
create or replace function public.platform_admin_invite(
  p_email text, p_role text, p_template_reviewer boolean default false, p_note text default null, p_days integer default 7
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := app.platform_session_actor(array['owner']);
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_days integer := coalesce(p_days, 7);
  rid uuid;
begin
  if length(v_email) not between 3 and 320 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'the email is invalid' using errcode = '22023';
  end if;
  if p_role is null or p_role not in ('owner', 'operator', 'viewer') then
    raise exception 'role is owner, operator or viewer' using errcode = '22023';
  end if;
  if v_note is not null and length(v_note) > 200 then
    raise exception 'the note is at most 200 characters' using errcode = '22023';
  end if;
  if v_days not between 1 and 30 then
    raise exception 'an invite lasts 1 to 30 days' using errcode = '22023';
  end if;
  if exists (select 1 from public.platform_admins pa join auth.users u on u.id = pa.user_id where lower(u.email) = v_email) then
    raise exception 'that person is already a platform admin' using errcode = '23505';
  end if;
  perform set_config('app.platform_admin_write', 'on', true);
  -- An expired pending invite for the same email is closed first.
  update public.platform_admin_invites
     set status = 'cancelled', cancelled_at = now(), cancelled_by = actor, cancel_reason = 'expired; replaced'
   where email = v_email and status = 'pending' and expires_at <= now();
  if exists (select 1 from public.platform_admin_invites i where i.email = v_email and i.status = 'pending') then
    raise exception 'an invite for that email is already open' using errcode = '23505';
  end if;
  insert into public.platform_admin_invites (email, role, template_reviewer, note, invited_by, expires_at)
  values (v_email, p_role, coalesce(p_template_reviewer, false), v_note, actor, now() + make_interval(days => v_days))
  returning id into rid;
  perform app.record_audit_event(null, 'platform_admin.invited', 'public.platform_admin_invites', rid, 'success',
    jsonb_build_object('role', p_role, 'template_reviewer', coalesce(p_template_reviewer, false),
                       'email_domain', split_part(v_email, '@', 2), 'days', v_days));
  return rid;
end;
$$;
revoke all on function public.platform_admin_invite(text, text, boolean, text, integer) from public, anon, service_role;
grant execute on function public.platform_admin_invite(text, text, boolean, text, integer) to authenticated;

create or replace function public.platform_admin_cancel_invite(p_invite_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := app.platform_session_actor(array['owner']);
  inv public.platform_admin_invites%rowtype;
begin
  select * into inv from public.platform_admin_invites where id = p_invite_id for update;
  if inv.id is null then
    raise exception 'invite not found' using errcode = 'P0002';
  end if;
  if inv.status <> 'pending' then
    raise exception 'that invite is already closed' using errcode = '22023';
  end if;
  perform set_config('app.platform_admin_write', 'on', true);
  update public.platform_admin_invites
     set status = 'cancelled', cancelled_at = now(), cancelled_by = actor,
         cancel_reason = nullif(left(btrim(coalesce(p_reason, '')), 500), '')
   where id = inv.id;
  perform app.record_audit_event(null, 'platform_admin.invite_cancelled', 'public.platform_admin_invites', inv.id, 'success', '{}'::jsonb);
end;
$$;
revoke all on function public.platform_admin_cancel_invite(uuid, text) from public, anon, service_role;
grant execute on function public.platform_admin_cancel_invite(uuid, text) to authenticated;

-- The invited person, signed in with MFA (aal2), accepts. No platform_admins row exists for them yet.
create or replace function public.accept_platform_admin_invite()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  u auth.users%rowtype;
  inv public.platform_admin_invites%rowtype;
begin
  if uid is null or app.staff_mfa_satisfied() is distinct from true then
    raise exception 'sign in with MFA to accept' using errcode = '42501';
  end if;
  select * into u from auth.users where id = uid;
  if u.email is null or u.email_confirmed_at is null then
    raise exception 'confirm your email first' using errcode = '42501';
  end if;
  if exists (select 1 from public.platform_admins pa where pa.user_id = uid) then
    raise exception 'you are already a platform admin' using errcode = '23505';
  end if;
  select * into inv from public.platform_admin_invites
   where email = lower(u.email) and status = 'pending'
   for update;
  if inv.id is null or inv.expires_at <= now() then
    raise exception 'no open invite for your email' using errcode = 'P0002';
  end if;
  perform set_config('app.platform_admin_write', 'on', true);
  insert into public.platform_admins (user_id, note, role, template_reviewer)
  values (uid, inv.note, inv.role, inv.template_reviewer);
  update public.platform_admin_invites
     set status = 'accepted', accepted_at = now(), accepted_user_id = uid
   where id = inv.id;
  perform app.record_audit_event(null, 'platform_admin.invite_accepted', 'public.platform_admins', uid, 'success',
    jsonb_build_object('invite_id', inv.id, 'role', inv.role, 'invited_by', inv.invited_by));
  return jsonb_build_object('user_id', uid, 'role', inv.role, 'template_reviewer', inv.template_reviewer);
end;
$$;
revoke all on function public.accept_platform_admin_invite() from public, anon, service_role;
grant execute on function public.accept_platform_admin_invite() to authenticated;

create or replace function public.platform_admin_set_role(p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := app.platform_session_actor(array['owner']);
  cur text;
begin
  if p_role is null or p_role not in ('owner', 'operator', 'viewer') then
    raise exception 'role is owner, operator or viewer' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('casevoya.platform_admin_owners'));
  select role into cur from public.platform_admins where user_id = p_user_id for update;
  if cur is null then
    raise exception 'not a platform admin' using errcode = 'P0002';
  end if;
  if cur = p_role then
    return;
  end if;
  if cur = 'owner' and (select count(*) from public.platform_admins where role = 'owner') <= 1 then
    raise exception 'keep at least one owner' using errcode = '22023';
  end if;
  update public.platform_admins set role = p_role where user_id = p_user_id;
  perform app.record_audit_event(null, 'platform_admin.role_changed', 'public.platform_admins', p_user_id, 'success',
    jsonb_build_object('from', cur, 'to', p_role, 'self', p_user_id = actor));
end;
$$;
revoke all on function public.platform_admin_set_role(uuid, text) from public, anon, service_role;
grant execute on function public.platform_admin_set_role(uuid, text) to authenticated;

create or replace function public.platform_admin_set_reviewer(p_user_id uuid, p_template_reviewer boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := app.platform_session_actor(array['owner']);
  cur boolean;
begin
  if p_template_reviewer is null then
    raise exception 'say on or off' using errcode = '22023';
  end if;
  select template_reviewer into cur from public.platform_admins where user_id = p_user_id for update;
  if cur is null then
    raise exception 'not a platform admin' using errcode = 'P0002';
  end if;
  if cur = p_template_reviewer then
    return;
  end if;
  update public.platform_admins set template_reviewer = p_template_reviewer where user_id = p_user_id;
  perform app.record_audit_event(null, 'platform_admin.reviewer_changed', 'public.platform_admins', p_user_id, 'success',
    jsonb_build_object('template_reviewer', p_template_reviewer, 'self', p_user_id = actor));
end;
$$;
revoke all on function public.platform_admin_set_reviewer(uuid, boolean) from public, anon, service_role;
grant execute on function public.platform_admin_set_reviewer(uuid, boolean) to authenticated;

create or replace function public.platform_admin_remove(p_user_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := app.platform_session_actor(array['owner']);
  pa public.platform_admins%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_reason is null or length(v_reason) not between 3 and 500 then
    raise exception 'give a reason (3 to 500 characters)' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('casevoya.platform_admin_owners'));
  select * into pa from public.platform_admins where user_id = p_user_id for update;
  if pa.user_id is null then
    raise exception 'not a platform admin' using errcode = 'P0002';
  end if;
  if pa.role = 'owner' and (select count(*) from public.platform_admins where role = 'owner') <= 1 then
    raise exception 'keep at least one owner' using errcode = '22023';
  end if;
  insert into public.platform_admin_removals (user_id, role, template_reviewer, note, added_at, added_by, removed_by, reason)
  values (pa.user_id, pa.role, pa.template_reviewer, pa.note, pa.created_at, pa.created_by, actor, v_reason);
  perform set_config('app.platform_admin_removal', pa.user_id::text, true);
  delete from public.platform_admins where user_id = pa.user_id;
  perform set_config('app.platform_admin_removal', '', true);
  perform app.record_audit_event(null, 'platform_admin.removed', 'public.platform_admins', pa.user_id, 'success',
    jsonb_build_object('role', pa.role, 'self', pa.user_id = actor, 'reason_length', length(v_reason)));
end;
$$;
revoke all on function public.platform_admin_remove(uuid, text) from public, anon, service_role;
grant execute on function public.platform_admin_remove(uuid, text) to authenticated;

create or replace function app.platform_admin_licensed(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.consultant_credentials c
    join public.memberships m on m.id = c.membership_id and m.organization_id = c.organization_id
    where m.user_id = p_user_id and m.status = 'active' and m.role in ('firm_owner', 'licensed_consultant')
      and c.register_status = 'active' and c.entitlement_to_practise is distinct from false
      and c.discipline_revoked is not true and c.discipline_suspended is not true
      and app.licence_status_blocks(c.status) is not true);
$$;
revoke all on function app.platform_admin_licensed(uuid) from public;

create or replace function public.platform_admin_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if app.current_actor_type() is distinct from 'service' then
    raise exception 'platform admin list denied' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'admins', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', pa.user_id, 'email', u.email, 'role', pa.role, 'template_reviewer', pa.template_reviewer,
        'note', pa.note, 'created_at', pa.created_at, 'created_by_email', cb.email,
        'last_sign_in_at', u.last_sign_in_at,
        'verified_factors', (select count(*) from auth.mfa_factors f where f.user_id = pa.user_id and f.status = 'verified'),
        'licensed', app.platform_admin_licensed(pa.user_id)
      ) order by pa.created_at)
      from public.platform_admins pa
      join auth.users u on u.id = pa.user_id
      left join auth.users cb on cb.id = pa.created_by
    ), '[]'::jsonb),
    'invites', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'email', i.email, 'role', i.role, 'template_reviewer', i.template_reviewer, 'note', i.note,
        'status', case when i.status = 'pending' and i.expires_at <= now() then 'expired' else i.status end,
        'invited_by_email', ib.email, 'invited_at', i.invited_at, 'expires_at', i.expires_at,
        'accepted_at', i.accepted_at, 'cancelled_at', i.cancelled_at
      ) order by i.invited_at desc)
      from (select * from public.platform_admin_invites order by invited_at desc limit 100) i
      left join auth.users ib on ib.id = i.invited_by
    ), '[]'::jsonb),
    'removals', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'user_id', r.user_id, 'email', u.email, 'role', r.role, 'removed_at', r.removed_at,
        'removed_by_email', rb.email, 'reason', r.reason
      ) order by r.removed_at desc)
      from (select * from public.platform_admin_removals order by removed_at desc limit 100) r
      left join auth.users u on u.id = r.user_id
      left join auth.users rb on rb.id = r.removed_by
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.platform_admin_list() from public, anon, authenticated;
grant execute on function public.platform_admin_list() to service_role;

-- The invite (if any) waiting for an email; used by the portal's accept screen.
create or replace function public.platform_admin_invite_for_email(p_email text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if app.current_actor_type() is distinct from 'service' then
    raise exception 'denied' using errcode = '42501';
  end if;
  return (
    select jsonb_build_object('id', i.id, 'role', i.role, 'template_reviewer', i.template_reviewer,
                              'expires_at', i.expires_at, 'invited_at', i.invited_at)
    from public.platform_admin_invites i
    where i.email = lower(btrim(coalesce(p_email, ''))) and i.status = 'pending' and i.expires_at > now()
  );
end;
$$;
revoke all on function public.platform_admin_invite_for_email(text) from public, anon, authenticated;
grant execute on function public.platform_admin_invite_for_email(text) to service_role;

-- ---------------------------------------------------------------------------
-- Read functions for the portal (service role)
-- ---------------------------------------------------------------------------
create or replace function app.platform_read_allowed()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if app.current_actor_type() = 'service' then
    return;
  end if;
  if (select auth.uid()) is not null and app.is_platform_admin() is true then
    return;
  end if;
  raise exception 'platform admin access denied' using errcode = '42501';
end;
$$;
revoke all on function app.platform_read_allowed() from public;

-- Outbox health. Degraded: the oldest due pending event has waited over 10 minutes, an event
-- failed in the last hour, or one has been processing for over 15 minutes. Unhealthy: any
-- dead-lettered event, or the oldest due pending event has waited over 60 minutes.
create or replace function public.platform_outbox_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  counts jsonb;
  oldest_pending timestamptz;
  stuck integer;
  failed_1h integer;
  dead integer;
  wait_s integer;
  level text;
begin
  perform app.platform_read_allowed();
  select coalesce(jsonb_object_agg(s::text, coalesce(c.n, 0)), '{}'::jsonb) into counts
  from unnest(enum_range(null::public.outbox_status)) s
  left join (select status, count(*) n from public.outbox_events group by status) c on c.status = s;
  select min(available_at) into oldest_pending from public.outbox_events where status = 'pending' and available_at <= now();
  select count(*) into stuck from public.outbox_events where status = 'processing' and locked_at < now() - interval '15 minutes';
  select count(*) into failed_1h from public.outbox_events where status = 'failed' and coalesce(locked_at, available_at, occurred_at) > now() - interval '1 hour';
  dead := coalesce((counts ->> 'dead_lettered')::integer, 0);
  wait_s := case when oldest_pending is null then 0 else greatest(0, extract(epoch from now() - oldest_pending))::integer end;
  level := case
    when dead > 0 or wait_s > 3600 then 'unhealthy'
    when wait_s > 600 or failed_1h > 0 or stuck > 0 then 'degraded'
    else 'healthy' end;
  return jsonb_build_object(
    'level', level,
    'counts', counts,
    'oldest_pending_at', oldest_pending,
    'oldest_pending_wait_seconds', wait_s,
    'processing_stuck', stuck,
    'failed_last_hour', failed_1h,
    'dead_letters_by_type', coalesce((
      select jsonb_agg(jsonb_build_object('event_type', event_type, 'count', n) order by n desc)
      from (select event_type, count(*) n from public.outbox_events where status = 'dead_lettered' group by event_type) d
    ), '[]'::jsonb),
    'thresholds', jsonb_build_object('degraded_wait_seconds', 600, 'unhealthy_wait_seconds', 3600, 'stuck_processing_minutes', 15),
    'checked_at', now()
  );
end;
$$;
revoke all on function public.platform_outbox_health() from public, anon, authenticated;
grant execute on function public.platform_outbox_health() to service_role;

create or replace function public.platform_dead_letters(p_event_type text default null, p_limit integer default 50, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  lim integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  off integer := greatest(coalesce(p_offset, 0), 0);
begin
  perform app.platform_read_allowed();
  return jsonb_build_object(
    'total', (select count(*) from public.outbox_events e where e.status = 'dead_lettered'
              and (p_event_type is null or e.event_type = p_event_type)),
    'limit', lim, 'offset', off,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'event_type', e.event_type, 'aggregate_type', e.aggregate_type,
        'organization_id', e.organization_id, 'firm_name', o.display_name,
        'attempts', e.attempts, 'occurred_at', e.occurred_at, 'available_at', e.available_at,
        'last_error', left(e.last_error, 300)
      ) order by e.occurred_at desc)
      from (select * from public.outbox_events e2 where e2.status = 'dead_lettered'
            and (p_event_type is null or e2.event_type = p_event_type)
            order by e2.occurred_at desc limit lim offset off) e
      left join public.organizations o on o.id = e.organization_id
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.platform_dead_letters(text, integer, integer) from public, anon, authenticated;
grant execute on function public.platform_dead_letters(text, integer, integer) to service_role;

-- One event, without its payload: only the top-level payload keys and its size.
create or replace function public.platform_outbox_event(p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  e public.outbox_events%rowtype;
begin
  perform app.platform_read_allowed();
  select * into e from public.outbox_events where id = p_event_id;
  if e.id is null then
    return null;
  end if;
  return jsonb_build_object(
    'id', e.id, 'status', e.status, 'event_type', e.event_type, 'schema_version', e.schema_version,
    'aggregate_type', e.aggregate_type, 'aggregate_id', e.aggregate_id,
    'organization_id', e.organization_id,
    'firm_name', (select o.display_name from public.organizations o where o.id = e.organization_id),
    'attempts', e.attempts, 'occurred_at', e.occurred_at, 'available_at', e.available_at,
    'locked_at', e.locked_at, 'published_at', e.published_at,
    'last_error', left(e.last_error, 1000),
    'payload_keys', coalesce((select jsonb_agg(k order by k) from jsonb_object_keys(
        case when jsonb_typeof(e.payload) = 'object' then e.payload else '{}'::jsonb end) k), '[]'::jsonb),
    'payload_bytes', length(e.payload::text),
    'replays', coalesce((
      select jsonb_agg(jsonb_build_object('at', a.occurred_at, 'actor_email', u.email, 'result', a.result, 'action', a.action) order by a.occurred_at desc)
      from public.audit_log a left join auth.users u on u.id = a.actor_user_id
      where a.object_id = e.id and a.action in ('outbox.replay', 'admin_portal.health.replay')
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.platform_outbox_event(uuid) from public, anon, authenticated;
grant execute on function public.platform_outbox_event(uuid) to service_role;

-- Replay a dead letter: the admin's own session, operator or owner, fresh step-up.
create or replace function public.platform_replay_outbox_event(p_event_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := app.platform_session_actor(array['owner', 'operator']);
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  st public.outbox_status;
begin
  if v_reason is null or length(v_reason) not between 8 and 500 then
    raise exception 'give a reason of 8 to 500 characters' using errcode = '22023';
  end if;
  select status into st from public.outbox_events where id = p_event_id for update;
  if st is null then
    raise exception 'event not found' using errcode = 'P0002';
  end if;
  if st <> 'dead_lettered' then
    raise exception 'only a dead-lettered event can be retried' using errcode = '22023';
  end if;
  perform app.replay_outbox_event(p_event_id, v_reason);
  return jsonb_build_object('id', p_event_id, 'status', 'pending', 'replayed_by', actor);
end;
$$;
revoke all on function public.platform_replay_outbox_event(uuid, text) from public, anon, service_role;
grant execute on function public.platform_replay_outbox_event(uuid, text) to authenticated;

-- Subscription exception reasons. Cancelled and archived are terminal, not exceptions.
create or replace function app.platform_subscription_reasons(s public.organization_subscriptions)
returns text[]
language sql
stable
set search_path = ''
as $$
  select case when s.organization_id is null then '{}'::text[] else array_remove(array[
    case when s.status = 'past_due' then 'past_due' end,
    case when s.status = 'restricted' then 'restricted' end,
    case when s.status = 'trial_ended' then 'trial_ended' end,
    case when s.status in ('active', 'trial', 'past_due') and s.cancel_at is not null then 'cancel_scheduled' end,
    case when s.status = 'trial' and s.trial_ends_at is not null and s.trial_ends_at <= now() + interval '3 days' then 'trial_ending' end,
    case when s.status not in ('cancelled', 'archived') and s.latest_invoice_status in ('open', 'uncollectible') then 'invoice_unpaid' end
  ], null) end;
$$;
revoke all on function app.platform_subscription_reasons(public.organization_subscriptions) from public;

create or replace function public.platform_subscription_exceptions(p_reason text default null, p_limit integer default 100, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  lim integer := least(greatest(coalesce(p_limit, 100), 1), 200);
  off integer := greatest(coalesce(p_offset, 0), 0);
begin
  perform app.platform_read_allowed();
  if p_reason is not null and p_reason not in ('past_due', 'restricted', 'trial_ended', 'cancel_scheduled', 'trial_ending', 'invoice_unpaid') then
    raise exception 'unknown exception reason' using errcode = '22023';
  end if;
  return (
    with ex as (
      select s.*, app.platform_subscription_reasons(s) reasons
      from public.organization_subscriptions s
    ), f as (
      select * from ex where cardinality(reasons) > 0 and (p_reason is null or p_reason = any (reasons))
    )
    select jsonb_build_object(
      'total', (select count(*) from f),
      'by_reason', coalesce((select jsonb_object_agg(r, n) from (select unnest(reasons) r, count(*) n from ex group by 1) x), '{}'::jsonb),
      'by_status', coalesce((select jsonb_object_agg(st, n) from (select status::text st, count(*) n from public.organization_subscriptions group by 1) y), '{}'::jsonb),
      'limit', lim, 'offset', off,
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'organization_id', p.organization_id, 'firm_name', o.display_name, 'sample_mode', o.sample_mode,
          'status', p.status, 'plan', p.plan, 'billing_interval', p.billing_interval, 'reasons', to_jsonb(p.reasons),
          'trial_ends_at', p.trial_ends_at, 'current_period_end', p.current_period_end, 'cancel_at', p.cancel_at,
          'past_due_since', p.past_due_since, 'restricted_at', p.restricted_at,
          'latest_invoice_status', p.latest_invoice_status, 'stripe_customer_id', p.stripe_customer_id,
          'updated_at', p.updated_at
        ) order by coalesce(p.past_due_since, p.restricted_at, p.trial_ends_at, p.updated_at), p.organization_id)
        from (select * from f order by coalesce(past_due_since, restricted_at, trial_ends_at, updated_at), organization_id limit lim offset off) p
        join public.organizations o on o.id = p.organization_id
      ), '[]'::jsonb)
    )
  );
end;
$$;
revoke all on function public.platform_subscription_exceptions(text, integer, integer) from public, anon, authenticated;
grant execute on function public.platform_subscription_exceptions(text, integer, integer) to service_role;

-- Licence queue buckets (first match wins): adverse (not_entitled, inactive, suspended, revoked);
-- needs_review (latest check result); never_checked; overdue (next review passed); due (next
-- review within 7 days); ok. Kind 'due' lists due and overdue.
create or replace function public.platform_licence_queue(p_kind text default 'due', p_limit integer default 50, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  lim integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  off integer := greatest(coalesce(p_offset, 0), 0);
  k text := coalesce(p_kind, 'due');
begin
  perform app.platform_read_allowed();
  if k not in ('due', 'overdue', 'never_checked', 'adverse', 'needs_review', 'all') then
    raise exception 'kind is due, overdue, never_checked, adverse, needs_review or all' using errcode = '22023';
  end if;
  return (
    with latest as (
      select distinct on (cc.credential_id) cc.credential_id, cc.result, cc.created_at
      from public.credential_checks cc order by cc.credential_id, cc.created_at desc
    ), q as (
      select c.*, l.result latest_result,
        case
          when c.status in ('not_entitled', 'inactive', 'suspended', 'revoked') then 'adverse'
          when l.result = 'needs_review' then 'needs_review'
          when c.checked_at is null then 'never_checked'
          when c.next_review_at is not null and c.next_review_at < now() then 'overdue'
          when c.next_review_at is not null and c.next_review_at <= now() + interval '7 days' then 'due'
          else 'ok' end bucket
      from public.consultant_credentials c
      left join latest l on l.credential_id = c.id
    ), f as (
      select * from q where case k
        when 'all' then true
        when 'due' then bucket in ('due', 'overdue')
        else bucket = k end
    )
    select jsonb_build_object(
      'kind', k,
      'counts', (select jsonb_build_object(
          'due', count(*) filter (where bucket in ('due', 'overdue')),
          'overdue', count(*) filter (where bucket = 'overdue'),
          'never_checked', count(*) filter (where bucket = 'never_checked'),
          'adverse', count(*) filter (where bucket = 'adverse'),
          'needs_review', count(*) filter (where bucket = 'needs_review'),
          'all', count(*)) from q),
      'total', (select count(*) from f),
      'limit', lim, 'offset', off,
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'credential_id', p.id, 'organization_id', p.organization_id, 'firm_name', o.display_name,
          'licence_type', p.licence_type, 'college_id', p.college_id, 'status', p.status,
          'register_status', p.register_status, 'bucket', p.bucket, 'latest_result', p.latest_result,
          'checked_at', p.checked_at, 'next_review_at', p.next_review_at, 'valid_until', p.valid_until,
          'verification_method', p.verification_method, 'member_role', m.role
        ) order by p.next_review_at nulls first, p.declared_at, p.id)
        from (select * from f order by next_review_at nulls first, declared_at, id limit lim offset off) p
        join public.organizations o on o.id = p.organization_id
        left join public.memberships m on m.id = p.membership_id
      ), '[]'::jsonb)
    )
  );
end;
$$;
revoke all on function public.platform_licence_queue(text, integer, integer) from public, anon, authenticated;
grant execute on function public.platform_licence_queue(text, integer, integer) to service_role;

create or replace function public.platform_credential_detail(p_credential_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.consultant_credentials%rowtype;
begin
  perform app.platform_read_allowed();
  select * into c from public.consultant_credentials where id = p_credential_id;
  if c.id is null then
    return null;
  end if;
  return jsonb_build_object(
    'credential', jsonb_build_object(
      'id', c.id, 'organization_id', c.organization_id,
      'firm_name', (select o.display_name from public.organizations o where o.id = c.organization_id),
      'licence_type', c.licence_type, 'college_id', c.college_id, 'status', c.status,
      'register_status', c.register_status, 'entitlement_to_practise', c.entitlement_to_practise,
      'discipline_suspended', c.discipline_suspended, 'discipline_revoked', c.discipline_revoked,
      'discipline_restricted', c.discipline_restricted, 'discipline_restriction_detail', c.discipline_restriction_detail,
      'verification_method', c.verification_method, 'source_url', c.source_url,
      'declared_at', c.declared_at, 'checked_at', c.checked_at, 'next_review_at', c.next_review_at, 'valid_until', c.valid_until
    ),
    'checks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', k.id, 'result', k.result, 'retrieved_at', k.retrieved_at, 'source_host', k.source_host,
        'method', k.method, 'register_status', k.register_status, 'reviewer_email', u.email,
        'proof_locator', k.proof_locator, 'created_at', k.created_at, 'cicc_import_id', k.cicc_import_id
      ) order by k.created_at desc)
      from (select * from public.credential_checks where credential_id = c.id order by created_at desc limit 50) k
      left join auth.users u on u.id = k.reviewer_user_id
    ), '[]'::jsonb),
    'change_reports', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'created_at', r.created_at) order by r.created_at desc)
      from public.credential_change_reports r where r.credential_id = c.id
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.platform_credential_detail(uuid) from public, anon, authenticated;
grant execute on function public.platform_credential_detail(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Template reviewers must hold the flag
-- ---------------------------------------------------------------------------
create or replace function app.platform_template_reviewer()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  snap jsonb;
  label text;
begin
  if app.support_service_role() then
    raise exception 'the service role cannot publish a template' using errcode = '42501';
  end if;
  if app.is_platform_admin() is distinct from true then
    raise exception 'template review denied' using errcode = '42501';
  end if;
  if not exists (select 1 from public.platform_admins pa where pa.user_id = (select auth.uid()) and pa.template_reviewer) then
    raise exception 'you are not a template reviewer' using errcode = '42501';
  end if;
  if app.mfa_step_up_satisfied() is distinct from true then
    raise exception 'step-up is required' using errcode = '42501';
  end if;
  select jsonb_build_object('licence_type', c.licence_type, 'college_id', c.college_id, 'status', c.status),
         c.licence_type::text || ' ' || c.college_id
    into snap, label
  from public.consultant_credentials c
  join public.memberships mem
    on mem.id = c.membership_id and mem.organization_id = c.organization_id
  where mem.user_id = (select auth.uid())
    and mem.status = 'active'
    and mem.role in ('firm_owner', 'licensed_consultant')
    and c.register_status = 'active'
    and c.entitlement_to_practise is distinct from false
    and c.discipline_revoked is not true
    and c.discipline_suspended is not true
    and app.licence_status_blocks(c.status) is not true
  order by c.checked_at desc nulls last
  limit 1;
  if snap is null then
    raise exception 'a licensed reviewer is required' using errcode = '42501';
  end if;
  return snap || jsonb_build_object('label', label);
end;
$$;
revoke all on function app.platform_template_reviewer() from public;

-- ---------------------------------------------------------------------------
-- Shared template sources
-- ---------------------------------------------------------------------------
create table if not exists public.shared_template_version_sources (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.shared_template_versions (id),
  position integer not null check (position between 1 and 20),
  url text not null check (length(url) between 9 and 2000),
  host text not null,
  official boolean not null,
  title text not null check (length(btrim(title)) between 1 and 200),
  retrieved_on date not null check (retrieved_on between date '1990-01-01' and date '2100-01-01'),
  note text check (note is null or length(note) <= 500),
  added_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  unique (version_id, position)
);
comment on table public.shared_template_version_sources is
  'ADM-03: the sources a shared template version relies on. Set while the version is a draft; frozen after. Publishing needs at least one official (federal government) https source.';
create index if not exists shared_template_version_sources_added_by_idx on public.shared_template_version_sources (added_by);

create trigger shared_template_version_sources_guard before insert on public.shared_template_version_sources
  for each row execute function app.shared_template_guard();
create trigger shared_template_version_sources_no_update before update on public.shared_template_version_sources
  for each row execute function app.reject_governed_delete();
create trigger shared_template_version_sources_no_truncate before truncate on public.shared_template_version_sources
  for each statement execute function app.reject_governed_delete();

create or replace function app.shared_template_sources_delete_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('app.shared_template_write', true), '') = 'on'
     and exists (select 1 from public.shared_template_versions v where v.id = old.version_id and v.status = 'draft') then
    return old;
  end if;
  raise exception 'sources are frozen once a version leaves draft' using errcode = '42501';
end;
$$;
revoke all on function app.shared_template_sources_delete_guard() from public;
create trigger shared_template_version_sources_no_delete before delete on public.shared_template_version_sources
  for each row execute function app.shared_template_sources_delete_guard();

alter table public.shared_template_version_sources enable row level security;
alter table public.shared_template_version_sources force row level security;
revoke all on table public.shared_template_version_sources from public, anon, authenticated, service_role;
grant select on table public.shared_template_version_sources to service_role, authenticated;
create policy shared_template_version_sources_select_admin on public.shared_template_version_sources
  for select to authenticated using ((select app.is_platform_admin()));

create or replace function public.set_shared_template_version_sources(p_version_id uuid, p_sources jsonb, p_actor uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := app.platform_ops_actor(p_actor);
  v public.shared_template_versions%rowtype;
  item jsonb;
  pos integer := 0;
  v_url text;
  v_host text;
  v_title text;
  v_on date;
  v_note text;
begin
  if p_sources is null or jsonb_typeof(p_sources) <> 'array' or jsonb_array_length(p_sources) not between 1 and 20 then
    raise exception 'list 1 to 20 sources' using errcode = '22023';
  end if;
  select * into v from public.shared_template_versions where id = p_version_id for update;
  if v.id is null or v.status <> 'draft' then
    raise exception 'sources change only while the version is a draft' using errcode = '22023';
  end if;
  perform set_config('app.shared_template_write', 'on', true);
  delete from public.shared_template_version_sources where version_id = v.id;
  for item in select value from jsonb_array_elements(p_sources) loop
    pos := pos + 1;
    if jsonb_typeof(item) <> 'object' then
      raise exception 'source % is not an object', pos using errcode = '22023';
    end if;
    v_url := btrim(coalesce(item ->> 'url', ''));
    v_host := app.official_url_host(v_url);
    if v_host is null or length(v_url) > 2000 then
      raise exception 'source % needs a public https link', pos using errcode = '22023';
    end if;
    v_title := btrim(coalesce(item ->> 'title', ''));
    if length(v_title) not between 1 and 200 then
      raise exception 'source % needs a title (1 to 200 characters)', pos using errcode = '22023';
    end if;
    begin
      v_on := (item ->> 'retrieved_on')::date;
    exception when others then
      v_on := null;
    end;
    if v_on is null or v_on > (now() at time zone 'America/Toronto')::date + 1 or v_on < date '1990-01-01' then
      raise exception 'source % needs the date it was read', pos using errcode = '22023';
    end if;
    v_note := nullif(btrim(coalesce(item ->> 'note', '')), '');
    if v_note is not null and length(v_note) > 500 then
      raise exception 'source % note is at most 500 characters', pos using errcode = '22023';
    end if;
    insert into public.shared_template_version_sources (version_id, position, url, host, official, title, retrieved_on, note, added_by)
    values (v.id, pos, v_url, v_host, app.federal_official_url(v_url) is not null, v_title, v_on, v_note, actor);
  end loop;
  perform app.record_audit_event(null, 'template.sources_set', 'public.shared_template_versions', v.id, 'success',
    jsonb_build_object('count', pos, 'by', actor));
  return pos;
end;
$$;
comment on function public.set_shared_template_version_sources(uuid, jsonb, uuid) is
  'ADM-03: replace the source list of a draft shared template version. [{url, title, retrieved_on, note?}]. Service role names the acting platform admin.';
revoke all on function public.set_shared_template_version_sources(uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.set_shared_template_version_sources(uuid, jsonb, uuid) to service_role;

create or replace function app.shared_template_publish_needs_source()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'published' and old.status = 'draft' and not exists (
    select 1 from public.shared_template_version_sources s where s.version_id = new.id and s.official
  ) then
    raise exception 'list at least one official source before publishing' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function app.shared_template_publish_needs_source() from public;
create trigger shared_template_versions_publish_source before update of status on public.shared_template_versions
  for each row execute function app.shared_template_publish_needs_source();

create or replace function public.platform_template_queue()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.platform_read_allowed();
  return jsonb_build_object(
    'templates', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'stable_key', t.stable_key, 'title', t.title, 'updated_at', t.updated_at,
        'published', (select jsonb_build_object('id', v.id, 'version_number', v.version_number, 'published_at', v.published_at,
                                                'reviewer_label', v.reviewer_label)
                      from public.shared_template_versions v where v.template_id = t.id and v.status = 'published'),
        'draft', (select jsonb_build_object('id', v.id, 'version_number', v.version_number, 'author_name', v.author_name,
                                            'author_user_id', v.author_user_id, 'created_at', v.created_at,
                                            'effective_on', v.effective_on,
                                            'sources', (select count(*) from public.shared_template_version_sources s where s.version_id = v.id),
                                            'official_sources', (select count(*) from public.shared_template_version_sources s where s.version_id = v.id and s.official))
                  from public.shared_template_versions v where v.template_id = t.id and v.status = 'draft'),
        'adopted_by_firms', (select count(distinct a.organization_id) from public.firm_shared_template_adoptions a where a.template_id = t.id)
      ) order by t.title)
      from public.shared_templates t
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.platform_template_version(p_version_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.shared_template_versions%rowtype;
begin
  perform app.platform_read_allowed();
  select * into v from public.shared_template_versions where id = p_version_id;
  if v.id is null then
    return null;
  end if;
  return jsonb_build_object(
    'version', jsonb_build_object(
      'id', v.id, 'template_id', v.template_id,
      'stable_key', (select t.stable_key from public.shared_templates t where t.id = v.template_id),
      'version_number', v.version_number, 'status', v.status, 'body', v.body, 'content_hash', v.content_hash,
      'author_name', v.author_name, 'author_user_id', v.author_user_id, 'test_evidence', v.test_evidence,
      'effective_on', v.effective_on, 'changelog', v.changelog, 'supersedes_version_id', v.supersedes_version_id,
      'reviewer_label', v.reviewer_label, 'reviewed_at', v.reviewed_at, 'published_at', v.published_at,
      'created_at', v.created_at, 'updated_at', v.updated_at),
    'sources', coalesce((
      select jsonb_agg(jsonb_build_object('position', s.position, 'url', s.url, 'host', s.host, 'official', s.official,
                                          'title', s.title, 'retrieved_on', s.retrieved_on, 'note', s.note) order by s.position)
      from public.shared_template_version_sources s where s.version_id = v.id
    ), '[]'::jsonb),
    'reviews', coalesce((
      select jsonb_agg(jsonb_build_object('decision', r.decision, 'reviewer_label', r.reviewer_label, 'reason', r.reason,
                                          'decided_at', r.decided_at) order by r.decided_at)
      from public.shared_template_reviews r where r.version_id = v.id
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.platform_template_queue() from public, anon, authenticated;
grant execute on function public.platform_template_queue() to service_role;
revoke all on function public.platform_template_version(uuid) from public, anon, authenticated;
grant execute on function public.platform_template_version(uuid) to service_role;

-- Firms: metadata only (no contact details, no client records).
create or replace function public.platform_firm_list(
  p_search text default null, p_verification text default null, p_subscription text default null,
  p_plan text default null, p_sample boolean default null, p_sort text default 'created_desc',
  p_limit integer default 50, p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  lim integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  off integer := greatest(coalesce(p_offset, 0), 0);
  s text := nullif(btrim(coalesce(p_search, '')), '');
  srt text := coalesce(p_sort, 'created_desc');
begin
  perform app.platform_read_allowed();
  if srt not in ('created_desc', 'created_asc', 'name_asc', 'name_desc') then
    raise exception 'sort is created_desc, created_asc, name_asc or name_desc' using errcode = '22023';
  end if;
  if s is not null and length(s) > 100 then
    raise exception 'search is at most 100 characters' using errcode = '22023';
  end if;
  return (
    with f as (
      select o.id, o.display_name, o.legal_name, o.slug, o.verification_status, o.sample_mode, o.created_at,
             sub.status sub_status, sub.plan, sub.billing_interval, sub.trial_ends_at, sub.current_period_end,
             app.platform_subscription_reasons(sub) reasons
      from public.organizations o
      left join public.organization_subscriptions sub on sub.organization_id = o.id
      where (s is null or o.display_name ilike '%' || s || '%' or o.legal_name ilike '%' || s || '%'
             or o.slug ilike '%' || s || '%' or o.id::text = s)
        and (p_verification is null or o.verification_status::text = p_verification)
        and (p_subscription is null or sub.status::text = p_subscription
             or (p_subscription = 'none' and sub.organization_id is null)
             or (p_subscription = 'exception' and cardinality(app.platform_subscription_reasons(sub)) > 0))
        and (p_plan is null or sub.plan::text = p_plan)
        and (p_sample is null or o.sample_mode = p_sample)
    ), ranked as (
      select f.*, row_number() over (order by
        case when srt = 'created_desc' then f.created_at end desc,
        case when srt = 'created_asc' then f.created_at end asc,
        case when srt = 'name_asc' then lower(f.display_name) end asc,
        case when srt = 'name_desc' then lower(f.display_name) end desc, f.id) rn
      from f
    )
    select jsonb_build_object(
      'total', (select count(*) from f),
      'limit', lim, 'offset', off,
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', p.id, 'display_name', p.display_name, 'legal_name', p.legal_name, 'slug', p.slug,
          'verification_status', p.verification_status, 'sample_mode', p.sample_mode, 'created_at', p.created_at,
          'subscription_status', p.sub_status, 'plan', p.plan, 'billing_interval', p.billing_interval,
          'trial_ends_at', p.trial_ends_at, 'current_period_end', p.current_period_end,
          'exception_reasons', to_jsonb(coalesce(p.reasons, '{}'::text[])),
          'active_members', (select count(*) from public.memberships m where m.organization_id = p.id and m.status = 'active')
        ) order by p.rn)
        from ranked p where p.rn > off and p.rn <= off + lim
      ), '[]'::jsonb)
    )
  );
end;
$$;
revoke all on function public.platform_firm_list(text, text, text, text, boolean, text, integer, integer) from public, anon, authenticated;
grant execute on function public.platform_firm_list(text, text, text, text, boolean, text, integer, integer) to service_role;

create or replace function public.platform_firm_detail(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  o public.organizations%rowtype;
  sub public.organization_subscriptions%rowtype;
begin
  perform app.platform_read_allowed();
  select * into o from public.organizations where id = p_organization_id;
  if o.id is null then
    return null;
  end if;
  select * into sub from public.organization_subscriptions where organization_id = o.id;
  return jsonb_build_object(
    'firm', jsonb_build_object(
      'id', o.id, 'display_name', o.display_name, 'legal_name', o.legal_name, 'slug', o.slug,
      'verification_status', o.verification_status, 'sample_mode', o.sample_mode, 'created_at', o.created_at,
      'timezone', o.timezone, 'default_locale', o.default_locale, 'jurisdiction_codes', to_jsonb(o.jurisdiction_codes),
      'dpa_accepted_at', o.dpa_accepted_at, 'dpa_version', o.dpa_version,
      'subscription_terms_accepted_at', o.subscription_terms_accepted_at, 'subscription_terms_version', o.subscription_terms_version
    ),
    'subscription', case when sub.organization_id is null then null else jsonb_build_object(
      'status', sub.status, 'plan', sub.plan, 'billing_interval', sub.billing_interval, 'extra_seats', sub.extra_seats,
      'trial_started_at', sub.trial_started_at, 'trial_ends_at', sub.trial_ends_at,
      'current_period_end', sub.current_period_end, 'cancel_at', sub.cancel_at, 'cancelled_at', sub.cancelled_at,
      'past_due_since', sub.past_due_since, 'restricted_at', sub.restricted_at, 'archived_at', sub.archived_at,
      'latest_invoice_status', sub.latest_invoice_status, 'stripe_customer_id', sub.stripe_customer_id,
      'stripe_subscription_id', sub.stripe_subscription_id, 'exception_reasons', to_jsonb(app.platform_subscription_reasons(sub)),
      'updated_at', sub.updated_at
    ) end,
    'subscription_events', coalesce((
      select jsonb_agg(jsonb_build_object('kind', e.kind, 'occurred_at', e.occurred_at, 'stripe_event_id', e.stripe_event_id) order by e.occurred_at desc)
      from (select * from public.subscription_events where organization_id = o.id order by occurred_at desc limit 20) e
    ), '[]'::jsonb),
    'invoices', coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'status', i.status, 'amount_due_cents', i.amount_due_cents,
                                          'amount_paid_cents', i.amount_paid_cents, 'currency', i.currency, 'created_at', i.created_at)
                       order by i.created_at desc)
      from (select * from public.subscription_invoices where organization_id = o.id order by created_at desc limit 12) i
    ), '[]'::jsonb),
    'members', (select jsonb_build_object(
        'active', count(*) filter (where m.status = 'active'),
        'invited', count(*) filter (where m.status = 'invited'),
        'suspended', count(*) filter (where m.status = 'suspended'),
        'by_role', coalesce((select jsonb_object_agg(rl, n) from (
            select m2.role::text rl, count(*) n from public.memberships m2
            where m2.organization_id = o.id and m2.status = 'active' group by 1) r), '{}'::jsonb))
      from public.memberships m where m.organization_id = o.id),
    'credentials', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'licence_type', c.licence_type, 'college_id', c.college_id, 'status', c.status,
        'register_status', c.register_status, 'checked_at', c.checked_at, 'next_review_at', c.next_review_at
      ) order by c.declared_at)
      from public.consultant_credentials c where c.organization_id = o.id
    ), '[]'::jsonb),
    'support_requests', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'status', r.status, 'scope', r.scope, 'ticket_ref', r.ticket_ref,
        'created_at', r.created_at, 'ends_at', r.ends_at, 'open', app.support_access_open(r)
      ) order by r.created_at desc)
      from (select * from public.support_access_requests where organization_id = o.id order by created_at desc limit 10) r
    ), '[]'::jsonb),
    'complaints', (select jsonb_build_object(
        'open', count(*) filter (where c.resolved_on is null),
        'ack_overdue', count(*) filter (where c.resolved_on is null and c.acknowledged_on is null and c.ack_due_on < app.firm_today(c.organization_id)),
        'response_overdue', count(*) filter (where c.resolved_on is null and c.response_sent_on is null and c.response_due_on < app.firm_today(c.organization_id)),
        'total', count(*))
      from public.complaints c where c.organization_id = o.id and c.is_sample is not true),
    'outbox', (select jsonb_build_object(
        'pending', count(*) filter (where e.status = 'pending'),
        'failed', count(*) filter (where e.status = 'failed'),
        'dead_lettered', count(*) filter (where e.status = 'dead_lettered'))
      from public.outbox_events e where e.organization_id = o.id)
  );
end;
$$;
revoke all on function public.platform_firm_detail(uuid) from public, anon, authenticated;
grant execute on function public.platform_firm_detail(uuid) to service_role;

-- Support requests with their effective state: pending; active (approved, not ended, before
-- ends_at); closed (everything else). An approved grant past ends_at shows effective_status
-- 'expired' until the 5-minute expiry job marks it.
create or replace function public.platform_support_requests(
  p_state text default null, p_organization_id uuid default null, p_limit integer default 50, p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  lim integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  off integer := greatest(coalesce(p_offset, 0), 0);
begin
  perform app.platform_read_allowed();
  if p_state is not null and p_state not in ('pending', 'active', 'closed') then
    raise exception 'state is pending, active or closed' using errcode = '22023';
  end if;
  return (
    with r as (
      select q.*,
        case when q.status = 'pending' then 'pending'
             when app.support_access_open(q) then 'active'
             else 'closed' end state,
        case when q.status = 'approved' and q.ended_at is null and q.ends_at is not null and q.ends_at <= now()
             then 'expired' else q.status::text end effective_status
      from public.support_access_requests q
      where p_organization_id is null or q.organization_id = p_organization_id
    ), f as (select * from r where p_state is null or state = p_state)
    select jsonb_build_object(
      'total', (select count(*) from f),
      'counts', (select jsonb_build_object('pending', count(*) filter (where state = 'pending'),
                                           'active', count(*) filter (where state = 'active'),
                                           'closed', count(*) filter (where state = 'closed')) from r),
      'limit', lim, 'offset', off,
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', p.id, 'organization_id', p.organization_id, 'firm_name', o.display_name,
          'status', p.status, 'effective_status', p.effective_status, 'state', p.state,
          'scope', p.scope, 'matter_id', p.matter_id, 'ticket_ref', p.ticket_ref,
          'requested_by_name', p.requested_by_name, 'requested_by_email', p.requested_by_email,
          'requested_by_user_id', p.requested_by_user_id,
          'reason', p.reason, 'not_included', p.not_included, 'requested_minutes', p.requested_minutes,
          'created_at', p.created_at, 'approved_at', p.approved_at, 'starts_at', p.starts_at, 'ends_at', p.ends_at,
          'ended_at', p.ended_at, 'decline_reason', p.decline_reason, 'extension_count', p.extension_count,
          'minutes_left', case when p.state = 'active' then greatest(0, ceil(extract(epoch from p.ends_at - now()) / 60))::integer end,
          'uses', (select count(*) from public.support_access_uses u where u.request_id = p.id)
        ) order by p.created_at desc, p.id)
        from (select * from f order by created_at desc, id limit lim offset off) p
        join public.organizations o on o.id = p.organization_id
      ), '[]'::jsonb)
    )
  );
end;
$$;
revoke all on function public.platform_support_requests(text, uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.platform_support_requests(text, uuid, integer, integer) to service_role;

create or replace function public.platform_support_request_history(p_request_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.platform_read_allowed();
  return jsonb_build_object(
    'events', coalesce((
      select jsonb_agg(jsonb_build_object('at', a.occurred_at, 'action', a.action, 'result', a.result,
                                          'actor_type', a.actor_type, 'actor_email', u.email) order by a.occurred_at)
      from public.audit_log a left join auth.users u on u.id = a.actor_user_id
      where a.object_id = p_request_id
        and (a.action like 'support\_access.%' or a.action like 'admin\_portal.support.%')
    ), '[]'::jsonb),
    'uses', coalesce((
      select jsonb_agg(jsonb_build_object('at', s.occurred_at, 'action', s.action, 'object_table', s.object_table,
                                          'actor_email', u.email) order by s.occurred_at)
      from public.support_access_uses s left join auth.users u on u.id = s.actor_user_id
      where s.request_id = p_request_id
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.platform_support_request_history(uuid) from public, anon, authenticated;
grant execute on function public.platform_support_request_history(uuid) to service_role;

-- Complaints register aggregate (ADM-05): counts only, never complainant details or issue text.
-- Sample complaints are excluded.
create or replace function public.platform_complaints_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.platform_read_allowed();
  return jsonb_build_object(
    'totals', (select jsonb_build_object(
        'open', count(*) filter (where resolved_on is null),
        'ack_overdue', count(*) filter (where resolved_on is null and acknowledged_on is null and ack_due_on < app.firm_today(organization_id)),
        'response_overdue', count(*) filter (where resolved_on is null and response_sent_on is null and response_due_on < app.firm_today(organization_id)),
        'resolved_90d', count(*) filter (where resolved_on >= app.firm_today(organization_id) - 90),
        'received_30d', count(*) filter (where received_on >= app.firm_today(organization_id) - 30))
      from public.complaints where is_sample is not true),
    'by_category', coalesce((select jsonb_object_agg(cat, n) from (
        select category::text cat, count(*) n from public.complaints where is_sample is not true and resolved_on is null group by 1) x), '{}'::jsonb),
    'by_firm', coalesce((
      select jsonb_agg(jsonb_build_object('organization_id', x.organization_id, 'firm_name', o.display_name,
               'open', x.open_n, 'ack_overdue', x.ack_overdue, 'response_overdue', x.response_overdue)
               order by x.response_overdue desc, x.open_n desc)
      from (select organization_id,
                   count(*) filter (where resolved_on is null) open_n,
                   count(*) filter (where resolved_on is null and acknowledged_on is null and ack_due_on < app.firm_today(organization_id)) ack_overdue,
                   count(*) filter (where resolved_on is null and response_sent_on is null and response_due_on < app.firm_today(organization_id)) response_overdue
            from public.complaints where is_sample is not true group by organization_id) x
      join public.organizations o on o.id = x.organization_id
      where x.open_n > 0
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.platform_complaints_overview() from public, anon, authenticated;
grant execute on function public.platform_complaints_overview() to service_role;

-- Support SLA (ADM-04): first-response times from support_response_records.
create or replace function public.platform_support_sla(p_days integer default 30, p_target_minutes integer default 1440)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  d integer := least(greatest(coalesce(p_days, 30), 1), 365);
  t integer := least(greatest(coalesce(p_target_minutes, 1440), 5), 10080);
begin
  perform app.platform_read_allowed();
  return (
    with r as (
      select received_at, first_response_at,
             extract(epoch from first_response_at - received_at) / 60 mins
      from public.support_response_records where received_at >= now() - make_interval(days => d)
    )
    select jsonb_build_object(
      'days', d, 'target_minutes', t,
      'received', count(*),
      'responded', count(first_response_at),
      'awaiting_response', count(*) filter (where first_response_at is null),
      'awaiting_over_target', count(*) filter (where first_response_at is null and received_at < now() - make_interval(mins => t)),
      'within_target', count(*) filter (where mins <= t),
      'breached', count(*) filter (where mins > t),
      'median_minutes', round((percentile_cont(0.5) within group (order by mins))::numeric, 1),
      'p90_minutes', round((percentile_cont(0.9) within group (order by mins))::numeric, 1)
    ) from r
  );
end;
$$;
revoke all on function public.platform_support_sla(integer, integer) from public, anon, authenticated;
grant execute on function public.platform_support_sla(integer, integer) to service_role;

create or replace function public.platform_cicc_imports(p_limit integer default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.platform_read_allowed();
  return jsonb_build_object(
    'imports', coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'imported_at', i.imported_at, 'imported_by_email', u.email,
                                          'source_note', i.source_note, 'row_count', i.row_count, 'status', i.status,
                                          'completed_at', i.completed_at, 'file_sha256', i.file_sha256) order by i.imported_at desc)
      from (select * from public.cicc_register_imports order by imported_at desc limit least(greatest(coalesce(p_limit, 20), 1), 100)) i
      left join auth.users u on u.id = i.imported_by
    ), '[]'::jsonb),
    'needs_review', coalesce((
      select jsonb_agg(jsonb_build_object('credential_id', n.credential_id, 'organization_id', n.organization_id,
                                          'firm_name', n.firm_name, 'licence_type', n.licence_type, 'college_id', n.college_id,
                                          'credential_status', n.credential_status, 'checked_at', n.checked_at,
                                          'reason', n.reason, 'import_id', n.import_id))
      from public.cicc_needs_review_credentials() n
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.platform_cicc_imports(integer) from public, anon, authenticated;
grant execute on function public.platform_cicc_imports(integer) to service_role;

-- Overview cards. Incident status: major_incident (a published, current incident notice of
-- severity major), incident, maintenance, or operational.
create or replace function public.platform_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  health jsonb;
  lic jsonb;
  subs jsonb;
begin
  perform app.platform_read_allowed();
  health := public.platform_outbox_health();
  lic := public.platform_licence_queue('due', 1, 0) -> 'counts';
  subs := public.platform_subscription_exceptions(null, 1, 0);
  return jsonb_build_object(
    'firms', (select jsonb_build_object(
        'total', count(*),
        'live', count(*) filter (where not sample_mode),
        'sample', count(*) filter (where sample_mode),
        'new_30d', count(*) filter (where created_at >= now() - interval '30 days'),
        'by_verification', coalesce((select jsonb_object_agg(v, n) from (
            select verification_status::text v, count(*) n from public.organizations group by 1) x), '{}'::jsonb))
      from public.organizations),
    'subscriptions', jsonb_build_object('exceptions', subs -> 'total', 'by_reason', subs -> 'by_reason', 'by_status', subs -> 'by_status'),
    'queues', jsonb_build_object('level', health -> 'level', 'counts', health -> 'counts',
                                 'oldest_pending_wait_seconds', health -> 'oldest_pending_wait_seconds',
                                 'processing_stuck', health -> 'processing_stuck', 'failed_last_hour', health -> 'failed_last_hour'),
    'licences', lic,
    'verification_workload', jsonb_build_object(
      'firms_pending_review', (select count(*) from public.organizations where verification_status = 'pending_review'),
      'firms_unverified', (select count(*) from public.organizations where verification_status = 'unverified' and not sample_mode),
      'credentials_needing_review', coalesce((lic ->> 'needs_review')::integer, 0),
      'credentials_never_checked', coalesce((lic ->> 'never_checked')::integer, 0)),
    'incidents', (select jsonb_build_object(
        'active', count(*),
        'active_incidents', count(*) filter (where kind = 'incident'),
        'worst_severity', (array['info', 'minor', 'major'])[max(case severity when 'info' then 1 when 'minor' then 2 when 'major' then 3 end)],
        'status', case when count(*) filter (where kind = 'incident' and severity = 'major') > 0 then 'major_incident'
                       when count(*) filter (where kind = 'incident') > 0 then 'incident'
                       when count(*) filter (where kind = 'maintenance') > 0 then 'maintenance'
                       else 'operational' end)
      from public.service_notices
      where status = 'published' and starts_at <= now() and (ends_at is null or ends_at > now())),
    'support', (select jsonb_build_object(
        'pending', count(*) filter (where r.status = 'pending'),
        'active', count(*) filter (where app.support_access_open(r)))
      from public.support_access_requests r),
    'templates', jsonb_build_object(
      'awaiting_review', (select count(*) from public.shared_template_versions where status = 'draft'),
      'published', (select count(*) from public.shared_template_versions where status = 'published')),
    'complaints', (public.platform_complaints_overview() -> 'totals'),
    'generated_at', now()
  );
end;
$$;
revoke all on function public.platform_overview() from public, anon, authenticated;
grant execute on function public.platform_overview() to service_role;

-- Audit log viewer. Platform-scope action families only. Context is shown for platform
-- function families; row-change entries show only the keys that changed, never values.
create or replace function public.platform_audit_log(
  p_action_prefix text default null, p_actor_user_id uuid default null, p_organization_id uuid default null,
  p_result text default null, p_from timestamptz default null, p_to timestamptz default null,
  p_before_at timestamptz default null, p_before_id uuid default null, p_limit integer default 50,
  p_object_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  lim integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  families text[] := array['admin_portal', 'platform_admin', 'platform_admins', 'platform_admin_invites',
    'support_access', 'support_access_requests', 'service_notice', 'service_notices', 'template',
    'shared_template_versions', 'outbox', 'licence', 'credential_checks', 'consultant_credentials',
    'cicc', 'subscription', 'organization_subscriptions', 'product_settings', 'official_source_domains', 'security'];
  items jsonb;
begin
  perform app.platform_read_allowed();
  if p_action_prefix is not null and p_action_prefix !~ '^[a-z][a-z0-9_.]{0,80}$' then
    raise exception 'action prefix is lowercase letters, digits, dots and underscores' using errcode = '22023';
  end if;
  if p_result is not null and p_result not in ('success', 'denied', 'failure') then
    raise exception 'result is success, denied or failure' using errcode = '22023';
  end if;
  if (p_before_at is null) <> (p_before_id is null) then
    raise exception 'the cursor needs both before_at and before_id' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(x.j order by x.occurred_at desc, x.id desc), '[]'::jsonb) into items
  from (
    select a.occurred_at, a.id, jsonb_build_object(
      'id', a.id, 'occurred_at', a.occurred_at, 'action', a.action, 'result', a.result,
      'actor_type', a.actor_type, 'actor_user_id', a.actor_user_id, 'actor_email', u.email,
      'organization_id', a.organization_id, 'firm_name', o.display_name,
      'object_table', a.object_table, 'object_id', a.object_id, 'request_id', a.request_id,
      'context', case when split_part(a.action, '.', 1) in ('admin_portal', 'platform_admin', 'support_access', 'service_notice',
                                                             'template', 'outbox', 'licence', 'cicc') then a.context
                      else '{}'::jsonb end,
      'diff_keys', coalesce((select jsonb_agg(k) from jsonb_object_keys(
          case when jsonb_typeof(a.diff) = 'object' then a.diff else '{}'::jsonb end) k), '[]'::jsonb)
    ) j
    from public.audit_log a
    left join auth.users u on u.id = a.actor_user_id
    left join public.organizations o on o.id = a.organization_id
    where split_part(a.action, '.', 1) = any (families)
      and (p_action_prefix is null or left(a.action, length(p_action_prefix)) = p_action_prefix)
      and (p_actor_user_id is null or a.actor_user_id = p_actor_user_id)
      and (p_organization_id is null or a.organization_id = p_organization_id)
      and (p_result is null or a.result = p_result)
      and (p_from is null or a.occurred_at >= p_from)
      and (p_to is null or a.occurred_at < p_to)
      and (p_before_at is null or (a.occurred_at, a.id) < (p_before_at, p_before_id))
      and (p_object_id is null or a.object_id = p_object_id)
    order by a.occurred_at desc, a.id desc
    limit lim
  ) x;
  return jsonb_build_object(
    'items', items,
    'limit', lim,
    'next_cursor', case when jsonb_array_length(items) = lim then jsonb_build_object(
      'before_at', items -> (lim - 1) ->> 'occurred_at', 'before_id', items -> (lim - 1) ->> 'id') end
  );
end;
$$;
revoke all on function public.platform_audit_log(text, uuid, uuid, text, timestamptz, timestamptz, timestamptz, uuid, integer, uuid) from public, anon, authenticated;
grant execute on function public.platform_audit_log(text, uuid, uuid, text, timestamptz, timestamptz, timestamptz, uuid, integer, uuid) to service_role;
