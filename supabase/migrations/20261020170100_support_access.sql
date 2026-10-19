-- Support access grants (PRD SEC-04, SEC-09, ADM-04; TASKS T043). Branch support-access-grants.
-- Decision (Francis, 2026-10-19): requests come from the separate platform admin portal, which
-- writes to this database with the service role. Casevoya shows the firm owner the request and
-- lets them approve, decline, end or extend it; every record support opens is logged; grants end
-- on their own. There is no "log in as this firm" path anywhere.
--
-- Additive only. New tables (forced RLS, no direct writes):
--   support_access_requests  one request: who asked, scope, matter, reason, minutes, outcome
--   support_access_uses      append-only log of what support opened under a grant
-- Service-role functions (the admin portal): create_support_access_request,
--   cancel_support_access_request. Firm-owner functions: approve (step-up), decline,
--   end_support_access, extend_support_access (step-up; 240 minutes in all).
-- Reads by support go ONLY through support_read_matter / support_read_firm_settings (security
-- definer, logged in support_access_uses and the audit trail). No RLS policy on matters,
-- documents, document_versions, matter_participants or organizations is added for platform admins:
-- app.support_access_active(org, matter, scope) exists for a future policy, and is not used by one.
-- Redefined: app.staff_notification_items (latest from 20261020101500) gains the 'support' kind, a
-- pending request shown to the firm's owners. Auto-revoke: app.expire_support_access() every five
-- minutes where pg_cron exists; every check is lazy on ends_at regardless.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.support_access_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  -- The platform admin who asked, when the admin portal names one (a platform_admins row).
  requested_by_user_id uuid references auth.users (id),
  requested_by_name text not null check (length(btrim(requested_by_name)) between 1 and 120),
  requested_by_email text check (
    requested_by_email is null
    or (requested_by_email = lower(requested_by_email) and length(requested_by_email) between 3 and 320)
  ),
  ticket_ref text check (ticket_ref is null or length(btrim(ticket_ref)) between 1 and 60),
  scope public.support_access_scope not null,
  matter_id uuid,
  not_included text check (not_included is null or length(not_included) <= 500),
  reason text not null check (length(btrim(reason)) between 8 and 1000),
  requested_minutes integer not null default 60 check (requested_minutes between 15 and 240),
  status public.support_access_status not null default 'pending',
  approved_by_membership_id uuid,
  approved_at timestamptz,
  starts_at timestamptz,
  ends_at timestamptz,
  ended_at timestamptz,
  ended_by_user_id uuid references auth.users (id),
  -- Why it was declined (the owner's words) or cancelled (the admin portal's words).
  decline_reason text check (decline_reason is null or length(decline_reason) <= 500),
  extension_count integer not null default 0 check (extension_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id),
  foreign key (approved_by_membership_id, organization_id) references public.memberships (id, organization_id),
  check (
    (scope in ('matter_documents', 'matter_records', 'matter_all') and matter_id is not null)
    or (scope = 'firm_settings' and matter_id is null)
    or scope = 'records_set'
  ),
  check (status <> 'approved' or (approved_at is not null and starts_at is not null and ends_at is not null)),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);
comment on table public.support_access_requests is
  'A Casevoya support request to open part of one firm''s records (SEC-09). Written by the admin portal (service role) and the firm owner''s approve/decline/end/extend functions only.';

create index support_access_requests_org_status_idx
  on public.support_access_requests (organization_id, status, created_at desc);
create index support_access_requests_matter_idx on public.support_access_requests (matter_id, organization_id);
create index support_access_requests_approved_by_idx on public.support_access_requests (approved_by_membership_id, organization_id);
create index support_access_requests_requester_idx on public.support_access_requests (requested_by_user_id);
create index support_access_requests_ended_by_idx on public.support_access_requests (ended_by_user_id);
create index support_access_requests_created_by_idx on public.support_access_requests (created_by);
create index support_access_requests_active_idx
  on public.support_access_requests (organization_id, ends_at)
  where status = 'approved' and ended_at is null;

create trigger support_access_requests_touch before update on public.support_access_requests
  for each row execute function app.touch_row();
create trigger support_access_requests_immutable before update on public.support_access_requests
  for each row execute function app.guard_tenant_keys();
create trigger support_access_requests_stamp before insert on public.support_access_requests
  for each row execute function app.stamp_created_by();
-- The row-change audit keeps the words of the reason and the decline out of the audit stream (SEC-04).
create trigger support_access_requests_audit after insert or update or delete on public.support_access_requests
  for each row execute function app.audit_row_change('reason', 'decline_reason');
create trigger support_access_requests_no_delete before delete on public.support_access_requests
  for each row execute function app.reject_governed_delete();
create trigger support_access_requests_no_truncate before truncate on public.support_access_requests
  for each statement execute function app.reject_governed_delete();

create table public.support_access_uses (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  organization_id uuid not null references public.organizations (id),
  actor_user_id uuid references auth.users (id),
  object_table text not null check (length(object_table) between 1 and 80),
  object_id uuid,
  action text not null check (length(action) between 1 and 80),
  occurred_at timestamptz not null default clock_timestamp(),
  foreign key (request_id, organization_id) references public.support_access_requests (id, organization_id)
);
comment on table public.support_access_uses is
  'What Casevoya support opened under an approved grant. Append only; written by app.support_access_touch.';

create index support_access_uses_request_idx on public.support_access_uses (request_id, organization_id);
create index support_access_uses_org_idx on public.support_access_uses (organization_id, occurred_at desc);
create index support_access_uses_actor_idx on public.support_access_uses (actor_user_id);

create function app.support_access_uses_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'support access uses are append only' using errcode = '42501';
end;
$$;
revoke all on function app.support_access_uses_immutable() from public;

create trigger support_access_uses_no_update before update on public.support_access_uses
  for each row execute function app.support_access_uses_immutable();
create trigger support_access_uses_no_delete before delete on public.support_access_uses
  for each row execute function app.reject_governed_delete();
create trigger support_access_uses_no_truncate before truncate on public.support_access_uses
  for each statement execute function app.reject_governed_delete();

-- ---------------------------------------------------------------------------
-- Privileges and RLS. The firm owner (aal2) reads their firm's rows; a platform admin reads the
-- requests they made. Nobody writes directly.
-- ---------------------------------------------------------------------------
revoke all on table public.support_access_requests from public, anon, authenticated, service_role;
revoke all on table public.support_access_uses from public, anon, authenticated, service_role;
grant select on table public.support_access_requests to authenticated, service_role;
grant select on table public.support_access_uses to authenticated, service_role;

alter table public.support_access_requests enable row level security;
alter table public.support_access_requests force row level security;
alter table public.support_access_uses enable row level security;
alter table public.support_access_uses force row level security;

create policy support_access_requests_select on public.support_access_requests
  for select to authenticated
  using (
    (select app.actor_is_firm_owner(organization_id))
    or (
      requested_by_user_id = (select auth.uid())
      and (select app.is_platform_admin())
    )
  );

create policy support_access_uses_select on public.support_access_uses
  for select to authenticated
  using (
    (select app.actor_is_firm_owner(organization_id))
    or (
      (select app.is_platform_admin())
      and exists (
        select 1 from public.support_access_requests req
        where req.id = request_id
          and req.organization_id = support_access_uses.organization_id
          and req.requested_by_user_id = (select auth.uid())
      )
    )
  );

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
-- The admin portal's role. A signed-in platform admin is not the service role.
create function app.support_service_role()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((select auth.jwt() ->> 'role'), '') = 'service_role';
$$;
revoke all on function app.support_service_role() from public;

-- An approved grant still running: lazy on ends_at, whatever the cron job has done.
create function app.support_access_open(req public.support_access_requests)
returns boolean
language sql
stable
set search_path = ''
as $$
  select req.status = 'approved'
     and req.ended_at is null
     and req.ends_at is not null
     and req.ends_at > statement_timestamp();
$$;
revoke all on function app.support_access_open(public.support_access_requests) from public;

-- Whether a grant's scope covers what support wants to open. The mapping:
--   firm_settings     covers firm_settings only
--   matter_documents  covers matter_documents on that matter
--   matter_records    covers matter_records on that matter
--   matter_all        covers matter_documents, matter_records and matter_all on that matter
--   records_set       covers records_set (any matter when the request named none)
create function app.support_scope_covers(
  p_granted public.support_access_scope,
  p_granted_matter uuid,
  p_needed public.support_access_scope,
  p_matter uuid
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_needed
    when 'firm_settings' then p_granted = 'firm_settings'
    when 'records_set' then p_granted = 'records_set' and (p_granted_matter is null or p_granted_matter = p_matter)
    when 'matter_all' then p_granted = 'matter_all' and p_granted_matter = p_matter
    else p_granted in (p_needed, 'matter_all') and p_granted_matter = p_matter
  end;
$$;
revoke all on function app.support_scope_covers(public.support_access_scope, uuid, public.support_access_scope, uuid) from public;

-- True when an approved, unexpired grant covers that scope (and matter) for the firm. Usable by a
-- future platform-admin policy; no policy uses it today (reads go through support_read_*).
create function app.support_access_active(
  p_org uuid,
  p_matter_id uuid,
  p_scope_needed public.support_access_scope
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.support_access_requests req
    where req.organization_id = p_org
      and app.support_access_open(req)
      and app.support_scope_covers(req.scope, req.matter_id, p_scope_needed, p_matter_id)
  );
$$;
comment on function app.support_access_active(uuid, uuid, public.support_access_scope) is
  'An approved, unexpired support grant covers that scope for the firm. Lazy on ends_at. Not used by any policy yet.';
revoke all on function app.support_access_active(uuid, uuid, public.support_access_scope) from public;
grant execute on function app.support_access_active(uuid, uuid, public.support_access_scope) to authenticated, service_role;

-- Who may act as support on a request: the admin portal (service role), or the platform admin the
-- request names, at aal2.
create function app.support_access_caller_ok(req public.support_access_requests)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.support_service_role()
      or (
        app.is_platform_admin()
        and req.requested_by_user_id is not null
        and req.requested_by_user_id = (select auth.uid())
      );
$$;
revoke all on function app.support_access_caller_ok(public.support_access_requests) from public;

-- Logs one use of a grant (support opened something) in support_access_uses and the audit trail.
create function app.support_access_touch(
  p_request_id uuid,
  p_object_table text,
  p_object_id uuid,
  p_action text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  req public.support_access_requests%rowtype;
  use_id uuid;
begin
  select * into req from public.support_access_requests where id = p_request_id;
  if req.id is null or app.support_access_caller_ok(req) is distinct from true then
    raise exception 'support access denied' using errcode = '42501';
  end if;
  if app.support_access_open(req) is distinct from true then
    raise exception 'support access is not open' using errcode = '42501';
  end if;
  insert into public.support_access_uses (request_id, organization_id, actor_user_id, object_table, object_id, action)
  values (req.id, req.organization_id, (select auth.uid()), left(p_object_table, 80), p_object_id, left(p_action, 80))
  returning id into use_id;
  perform app.record_audit_event(
    req.organization_id,
    'support_access.used',
    p_object_table,
    p_object_id,
    'success',
    jsonb_build_object('request_id', req.id, 'use_id', use_id, 'action', left(p_action, 80), 'scope', req.scope)
  );
  return use_id;
end;
$$;
revoke all on function app.support_access_touch(uuid, text, uuid, text) from public;
grant execute on function app.support_access_touch(uuid, text, uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The admin portal (service role): ask, and withdraw.
-- ---------------------------------------------------------------------------
create function public.create_support_access_request(
  p_organization_id uuid,
  p_requester_name text,
  p_requester_email text,
  p_ticket_ref text,
  p_scope public.support_access_scope,
  p_matter_id uuid,
  p_not_included text,
  p_reason text,
  p_minutes integer default 60,
  p_requested_by_user_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  requester text := btrim(coalesce(p_requester_name, ''));
  requester_email text := lower(nullif(btrim(coalesce(p_requester_email, '')), ''));
  ticket text := nullif(btrim(coalesce(p_ticket_ref, '')), '');
  excluded text := nullif(btrim(coalesce(p_not_included, '')), '');
  reason text := btrim(coalesce(p_reason, ''));
  minutes integer := coalesce(p_minutes, 60);
  matter public.matters%rowtype;
  request_id uuid;
begin
  if app.support_service_role() is distinct from true then
    raise exception 'support access denied' using errcode = '42501';
  end if;
  if not exists (select 1 from public.organizations org where org.id = p_organization_id) then
    raise exception 'support access denied' using errcode = '42501';
  end if;
  if length(requester) not between 1 and 120 then
    raise exception 'name the person asking (1 to 120 characters)' using errcode = '22023';
  end if;
  if requester_email is not null and (length(requester_email) > 320 or requester_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    raise exception 'the requester email is invalid' using errcode = '22023';
  end if;
  if ticket is not null and length(ticket) > 60 then
    raise exception 'the ticket reference is too long' using errcode = '22023';
  end if;
  if excluded is not null and length(excluded) > 500 then
    raise exception 'not included is too long' using errcode = '22023';
  end if;
  if length(reason) not between 8 and 1000 then
    raise exception 'give a reason of 8 to 1000 characters' using errcode = '22023';
  end if;
  if minutes not between 15 and 240 then
    raise exception 'support access lasts 15 to 240 minutes' using errcode = '22023';
  end if;
  if p_scope in ('matter_documents', 'matter_records', 'matter_all') then
    select * into matter from public.matters m where m.id = p_matter_id and m.organization_id = p_organization_id;
    if matter.id is null then
      raise exception 'that matter is not in the firm' using errcode = '22023';
    end if;
  elsif p_scope = 'firm_settings' and p_matter_id is not null then
    raise exception 'firm settings access names no matter' using errcode = '22023';
  elsif p_matter_id is not null and not exists (
    select 1 from public.matters m where m.id = p_matter_id and m.organization_id = p_organization_id
  ) then
    raise exception 'that matter is not in the firm' using errcode = '22023';
  end if;
  if p_requested_by_user_id is not null and not exists (
    select 1 from public.platform_admins admin where admin.user_id = p_requested_by_user_id
  ) then
    raise exception 'the requester is not a platform admin' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.support_access_requests req
    where req.organization_id = p_organization_id and req.status = 'pending'
  ) then
    raise exception 'a support request is already waiting for this firm' using errcode = '23505';
  end if;

  insert into public.support_access_requests (
    organization_id, requested_by_user_id, requested_by_name, requested_by_email, ticket_ref,
    scope, matter_id, not_included, reason, requested_minutes
  ) values (
    p_organization_id, p_requested_by_user_id, requester, requester_email, ticket,
    p_scope, p_matter_id, excluded, reason, minutes
  )
  returning id into request_id;

  perform app.record_audit_event(
    p_organization_id,
    'support_access.requested',
    'public.support_access_requests',
    request_id,
    'success',
    jsonb_build_object('scope', p_scope, 'matter_id', p_matter_id, 'minutes', minutes, 'ticket_ref', ticket)
  );
  -- EX11 to the firm's owners (prepare_email_delivery resolves them).
  perform app.enqueue_event(
    p_organization_id,
    'support_access_request',
    request_id,
    'support_access.requested',
    jsonb_build_object('request_id', request_id, 'minutes', minutes),
    null,
    'support_access.requested:' || request_id::text
  );
  return request_id;
end;
$$;
comment on function public.create_support_access_request(uuid, text, text, text, public.support_access_scope, uuid, text, text, integer, uuid) is
  'The admin portal (service role) asks a firm for scoped, time-limited support access. One pending request per firm. Queues EX11 to the owners. Audited support_access.requested.';
revoke all on function public.create_support_access_request(uuid, text, text, text, public.support_access_scope, uuid, text, text, integer, uuid) from public, anon, authenticated;
grant execute on function public.create_support_access_request(uuid, text, text, text, public.support_access_scope, uuid, text, text, integer, uuid) to service_role;

create function public.cancel_support_access_request(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  req public.support_access_requests%rowtype;
  v_reason text := nullif(left(btrim(coalesce(p_reason, '')), 500), '');
begin
  if app.support_service_role() is distinct from true then
    raise exception 'support access denied' using errcode = '42501';
  end if;
  select * into req from public.support_access_requests where id = p_id for update;
  if req.id is null then
    raise exception 'support access denied' using errcode = '42501';
  end if;
  if req.status = 'pending' then
    update public.support_access_requests
       set status = 'cancelled', decline_reason = v_reason
     where id = req.id;
    perform app.record_audit_event(
      req.organization_id, 'support_access.cancelled', 'public.support_access_requests', req.id, 'success',
      jsonb_build_object('reason_length', length(coalesce(v_reason, '')))
    );
  elsif app.support_access_open(req) then
    -- Support gives the grant back early.
    update public.support_access_requests
       set status = 'ended', ended_at = statement_timestamp()
     where id = req.id;
    perform app.record_audit_event(
      req.organization_id, 'support_access.ended', 'public.support_access_requests', req.id, 'success',
      jsonb_build_object('by', 'support', 'reason_length', length(coalesce(v_reason, '')))
    );
  else
    raise exception 'that request is already closed' using errcode = '22023';
  end if;
end;
$$;
comment on function public.cancel_support_access_request(uuid, text) is
  'The admin portal (service role) withdraws a pending request, or gives an open grant back early. Audited.';
revoke all on function public.cancel_support_access_request(uuid, text) from public, anon, authenticated;
grant execute on function public.cancel_support_access_request(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- The firm owner: approve (step-up), decline, end now, extend (step-up).
-- ---------------------------------------------------------------------------
-- Marks an approved grant whose time ran out, so a late owner action reads it as expired.
create function app.support_access_lazy_expire(p_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.support_access_requests
     set status = 'expired'
   where id = p_id
     and status = 'approved'
     and ended_at is null
     and ends_at <= statement_timestamp();
$$;
revoke all on function app.support_access_lazy_expire(uuid) from public;

create function app.approve_support_access_request(p_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  req public.support_access_requests%rowtype;
  owner_membership uuid;
  now_at timestamptz := statement_timestamp();
  ends timestamptz;
begin
  select * into req from public.support_access_requests where id = p_id for update;
  if req.id is null then
    raise exception 'support access denied' using errcode = '42501';
  end if;
  perform app.require_firm_owner_step_up(req.organization_id);
  if req.status <> 'pending' then
    raise exception 'that request is no longer waiting' using errcode = '22023';
  end if;
  select m.id into owner_membership
  from public.memberships m
  where m.organization_id = req.organization_id
    and m.user_id = (select auth.uid())
    and m.role = 'firm_owner'
    and m.status = 'active'
  limit 1;
  ends := now_at + make_interval(mins => req.requested_minutes);
  update public.support_access_requests
     set status = 'approved',
         approved_by_membership_id = owner_membership,
         approved_at = now_at,
         starts_at = now_at,
         ends_at = ends
   where id = req.id;
  perform app.record_audit_event(
    req.organization_id, 'support_access.approved', 'public.support_access_requests', req.id, 'success',
    jsonb_build_object('scope', req.scope, 'matter_id', req.matter_id, 'minutes', req.requested_minutes, 'ends_at', ends)
  );
  -- EM17 to the firm's owners.
  perform app.enqueue_event(
    req.organization_id,
    'support_access_request',
    req.id,
    'support_access.approved',
    jsonb_build_object('request_id', req.id, 'minutes', req.requested_minutes),
    null,
    'support_access.approved:' || req.id::text
  );
  return ends;
end;
$$;
revoke all on function app.approve_support_access_request(uuid) from public;

create function public.approve_support_access_request(p_id uuid)
returns timestamptz
language sql
security invoker
set search_path = ''
as $$
  select app.approve_support_access_request(p_id);
$$;
comment on function public.approve_support_access_request(uuid) is
  'Firm owner with a recent step-up approves a waiting support request: starts now, ends after its requested minutes. Queues EM17. Audited support_access.approved.';
revoke all on function public.approve_support_access_request(uuid) from public, anon;
grant execute on function app.approve_support_access_request(uuid) to authenticated, service_role;
grant execute on function public.approve_support_access_request(uuid) to authenticated, service_role;

create function app.decline_support_access_request(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  req public.support_access_requests%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  select * into req from public.support_access_requests where id = p_id for update;
  if req.id is null then
    raise exception 'support access denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(req.organization_id, array['firm_owner']::public.org_role[], false);
  if req.status <> 'pending' then
    raise exception 'that request is no longer waiting' using errcode = '22023';
  end if;
  if length(v_reason) not between 3 and 500 then
    raise exception 'give a reason of 3 to 500 characters' using errcode = '22023';
  end if;
  update public.support_access_requests
     set status = 'declined', decline_reason = v_reason, ended_by_user_id = (select auth.uid())
   where id = req.id;
  perform app.record_audit_event(
    req.organization_id, 'support_access.declined', 'public.support_access_requests', req.id, 'success',
    jsonb_build_object('scope', req.scope, 'reason_length', length(v_reason))
  );
end;
$$;
revoke all on function app.decline_support_access_request(uuid, text) from public;

create function public.decline_support_access_request(p_id uuid, p_reason text)
returns void
language sql
security invoker
set search_path = ''
as $$
  select app.decline_support_access_request(p_id, p_reason);
$$;
comment on function public.decline_support_access_request(uuid, text) is
  'Firm owner at aal2 declines a waiting support request with a reason (kept on the row; its length in the audit trail).';
revoke all on function public.decline_support_access_request(uuid, text) from public, anon;
grant execute on function app.decline_support_access_request(uuid, text) to authenticated, service_role;
grant execute on function public.decline_support_access_request(uuid, text) to authenticated, service_role;

create function app.end_support_access(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  req public.support_access_requests%rowtype;
begin
  select * into req from public.support_access_requests where id = p_id for update;
  if req.id is null then
    raise exception 'support access denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(req.organization_id, array['firm_owner']::public.org_role[], false);
  if app.support_access_open(req) is distinct from true then
    perform app.support_access_lazy_expire(req.id);
    raise exception 'that support access already ended' using errcode = '22023';
  end if;
  update public.support_access_requests
     set status = 'ended', ended_at = statement_timestamp(), ended_by_user_id = (select auth.uid())
   where id = req.id;
  perform app.record_audit_event(
    req.organization_id, 'support_access.ended', 'public.support_access_requests', req.id, 'success',
    jsonb_build_object('by', 'firm', 'minutes_left', ceil(extract(epoch from (req.ends_at - statement_timestamp())) / 60))
  );
end;
$$;
revoke all on function app.end_support_access(uuid) from public;

create function public.end_support_access(p_id uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
  select app.end_support_access(p_id);
$$;
comment on function public.end_support_access(uuid) is
  'Firm owner at aal2 ends an open support grant now. Audited support_access.ended.';
revoke all on function public.end_support_access(uuid) from public, anon;
grant execute on function app.end_support_access(uuid) to authenticated, service_role;
grant execute on function public.end_support_access(uuid) to authenticated, service_role;

create function app.extend_support_access(p_id uuid, p_minutes integer default 30)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  req public.support_access_requests%rowtype;
  minutes integer := coalesce(p_minutes, 30);
  total integer;
  ends timestamptz;
begin
  select * into req from public.support_access_requests where id = p_id for update;
  if req.id is null then
    raise exception 'support access denied' using errcode = '42501';
  end if;
  perform app.require_firm_owner_step_up(req.organization_id);
  if app.support_access_open(req) is distinct from true then
    perform app.support_access_lazy_expire(req.id);
    raise exception 'that support access already ended' using errcode = '22023';
  end if;
  if minutes not between 5 and 240 then
    raise exception 'extend by 5 to 240 minutes' using errcode = '22023';
  end if;
  total := round(extract(epoch from (req.ends_at - req.starts_at)) / 60)::integer + minutes;
  if total > 240 then
    raise exception 'support access can last 240 minutes in all' using errcode = '22023';
  end if;
  ends := req.ends_at + make_interval(mins => minutes);
  update public.support_access_requests
     set ends_at = ends, extension_count = req.extension_count + 1
   where id = req.id;
  perform app.record_audit_event(
    req.organization_id, 'support_access.extended', 'public.support_access_requests', req.id, 'success',
    jsonb_build_object('minutes', minutes, 'total_minutes', total, 'ends_at', ends)
  );
  return ends;
end;
$$;
revoke all on function app.extend_support_access(uuid, integer) from public;

create function public.extend_support_access(p_id uuid, p_minutes integer default 30)
returns timestamptz
language sql
security invoker
set search_path = ''
as $$
  select app.extend_support_access(p_id, p_minutes);
$$;
comment on function public.extend_support_access(uuid, integer) is
  'Firm owner with a recent step-up extends an open support grant (default 30 minutes; 240 minutes in all). Audited support_access.extended.';
revoke all on function public.extend_support_access(uuid, integer) from public, anon;
grant execute on function app.extend_support_access(uuid, integer) to authenticated, service_role;
grant execute on function public.extend_support_access(uuid, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- What support may read, and only this way. Each call is logged as a use.
-- ---------------------------------------------------------------------------
create function app.support_request_for_read(p_request_id uuid)
returns public.support_access_requests
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  req public.support_access_requests%rowtype;
begin
  select * into req from public.support_access_requests where id = p_request_id;
  if req.id is null or app.support_access_caller_ok(req) is distinct from true then
    raise exception 'support access denied' using errcode = '42501';
  end if;
  if app.support_access_open(req) is distinct from true then
    raise exception 'support access is not open' using errcode = '42501';
  end if;
  return req;
end;
$$;
revoke all on function app.support_request_for_read(uuid) from public;

-- A summary of one matter for support: the matter's state, its parties, document records (states,
-- types and sizes, never contents or file names), tasks and deadlines, as the grant's scope allows.
create function public.support_read_matter(p_request_id uuid, p_matter_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  req public.support_access_requests;
  matter public.matters%rowtype;
  wants_documents boolean;
  wants_records boolean;
  result jsonb;
begin
  req := app.support_request_for_read(p_request_id);
  select * into matter from public.matters m where m.id = p_matter_id and m.organization_id = req.organization_id;
  if matter.id is null then
    raise exception 'support access denied' using errcode = '42501';
  end if;
  wants_documents := app.support_scope_covers(req.scope, req.matter_id, 'matter_documents', matter.id);
  wants_records := app.support_scope_covers(req.scope, req.matter_id, 'matter_records', matter.id);
  if not wants_documents and not wants_records then
    raise exception 'the grant does not cover that matter' using errcode = '42501';
  end if;

  result := jsonb_build_object(
    'request_id', req.id,
    'scope', req.scope,
    'ends_at', req.ends_at,
    'matter', jsonb_build_object(
      'id', matter.id,
      'reference', matter.reference,
      'title', matter.title,
      'stage', matter.stage,
      'on_hold', matter.on_hold,
      'engagement_status', matter.engagement_status,
      'government_status', matter.government_status,
      'is_sample', matter.is_sample,
      'created_at', matter.created_at,
      'updated_at', matter.updated_at
    )
  );
  if wants_documents then
    result := result || jsonb_build_object('documents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', doc.id,
        'purpose', doc.purpose,
        'sensitivity', doc.sensitivity,
        'audience', doc.audience,
        'versions', (select count(*) from public.document_versions v where v.document_id = doc.id and v.organization_id = doc.organization_id),
        'current', (
          select jsonb_build_object(
            'version_number', v.version_number,
            'upload_state', v.upload_state,
            'review_state', v.review_state,
            'declared_media_type', v.declared_media_type,
            'detected_media_type', v.detected_media_type,
            'declared_byte_size', v.declared_byte_size,
            'byte_size', v.byte_size,
            'scan_result', v.scan_result,
            'quarantine_reason', v.quarantine_reason,
            'completed_at', v.completed_at,
            'created_at', v.created_at
          )
          from public.document_versions v
          where v.id = doc.current_version_id and v.organization_id = doc.organization_id
        ),
        'failed_uploads', (
          select count(*) from public.document_versions v
          where v.document_id = doc.id and v.organization_id = doc.organization_id
            and v.upload_state in ('quarantined', 'failed')
        )
      ) order by doc.created_at)
      from public.document_matter_refs ref
      join public.documents doc on doc.id = ref.document_id and doc.organization_id = ref.organization_id
      where ref.matter_id = matter.id and ref.organization_id = matter.organization_id and ref.removed_at is null
    ), '[]'::jsonb));
  end if;
  if wants_records then
    result := result || jsonb_build_object(
      'participants', coalesce((
        select jsonb_agg(jsonb_build_object(
          'role', party.role,
          'kind', case when party.person_id is not null then 'person' else 'staff' end,
          'name', coalesce(person.display_name, prof.display_name)
        ) order by party.created_at)
        from public.matter_participants party
        left join public.persons person on person.id = party.person_id and person.organization_id = party.organization_id
        left join public.memberships member on member.id = party.membership_id and member.organization_id = party.organization_id
        left join public.profiles prof on prof.id = member.user_id
        where party.matter_id = matter.id and party.organization_id = matter.organization_id
      ), '[]'::jsonb),
      'tasks', coalesce((
        select jsonb_agg(jsonb_build_object('id', task.id, 'title', task.title, 'status', task.status, 'audience', task.audience, 'due_on', task.due_on) order by task.created_at)
        from public.tasks task
        where task.matter_id = matter.id and task.organization_id = matter.organization_id
      ), '[]'::jsonb),
      'deadlines', coalesce((
        select jsonb_agg(jsonb_build_object('id', deadline.id, 'label', deadline.label, 'kind', deadline.kind, 'due_on', deadline.due_on, 'due_at', deadline.due_at, 'verification', deadline.verification) order by deadline.created_at)
        from public.deadlines deadline
        where deadline.matter_id = matter.id and deadline.organization_id = matter.organization_id
      ), '[]'::jsonb)
    );
  end if;
  perform app.support_access_touch(req.id, 'public.matters', matter.id, 'support_read_matter');
  return result;
end;
$$;
comment on function public.support_read_matter(uuid, uuid) is
  'Support''s only read of a matter: a summary (state, parties, document records without contents, tasks, deadlines) under an open grant that covers it. Logged in support_access_uses and audited support_access.used.';
revoke all on function public.support_read_matter(uuid, uuid) from public, anon;
grant execute on function public.support_read_matter(uuid, uuid) to authenticated, service_role;

-- The firm's configuration for support: names, locale and zone, jurisdictions, seats by role.
create function public.support_read_firm_settings(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  req public.support_access_requests;
  org public.organizations%rowtype;
  result jsonb;
begin
  req := app.support_request_for_read(p_request_id);
  if app.support_scope_covers(req.scope, req.matter_id, 'firm_settings', null) is distinct from true then
    raise exception 'the grant does not cover firm settings' using errcode = '42501';
  end if;
  select * into org from public.organizations o where o.id = req.organization_id;
  result := jsonb_build_object(
    'request_id', req.id,
    'scope', req.scope,
    'ends_at', req.ends_at,
    'firm', jsonb_build_object(
      'id', org.id,
      'display_name', org.display_name,
      'legal_name', org.legal_name,
      'slug', org.slug,
      'default_locale', org.default_locale,
      'timezone', org.timezone,
      'jurisdiction_codes', to_jsonb(org.jurisdiction_codes),
      'verification_status', org.verification_status,
      'created_at', org.created_at
    ),
    'seats', coalesce((
      select jsonb_object_agg(counts.role, counts.n)
      from (
        select m.role::text as role, count(*) as n
        from public.memberships m
        where m.organization_id = org.id and m.status = 'active'
        group by m.role
      ) counts
    ), '{}'::jsonb)
  );
  perform app.support_access_touch(req.id, 'public.organizations', org.id, 'support_read_firm_settings');
  return result;
end;
$$;
comment on function public.support_read_firm_settings(uuid) is
  'Support''s only read of a firm''s settings, under an open firm_settings grant. Logged in support_access_uses and audited support_access.used.';
revoke all on function public.support_read_firm_settings(uuid) from public, anon;
grant execute on function public.support_read_firm_settings(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The Sheet: Access grants > Support access, for a firm owner.
-- ---------------------------------------------------------------------------
create function public.firm_support_access(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  now_at timestamptz := statement_timestamp();
begin
  perform app.require_active_staff(p_organization_id, array['firm_owner']::public.org_role[], false);
  return jsonb_build_object(
    'alert', (
      select jsonb_build_object(
        'id', req.id,
        'requester_name', req.requested_by_name,
        'ticket_ref', req.ticket_ref,
        'scope', req.scope,
        'matter_reference', matter.reference,
        'matter_title', matter.title,
        'reason', req.reason,
        'approved_by_name', nullif(btrim(coalesce(prof.display_name, '')), ''),
        'approved_at', req.approved_at,
        'starts_at', req.starts_at,
        'ends_at', req.ends_at,
        'extension_count', req.extension_count,
        'uses', (select count(*) from public.support_access_uses u where u.request_id = req.id)
      )
      from public.support_access_requests req
      left join public.matters matter on matter.id = req.matter_id and matter.organization_id = req.organization_id
      left join public.memberships member on member.id = req.approved_by_membership_id and member.organization_id = req.organization_id
      left join public.profiles prof on prof.id = member.user_id
      where req.organization_id = p_organization_id
        and req.status = 'approved' and req.ended_at is null and req.ends_at > now_at
      order by req.ends_at desc
      limit 1
    ),
    'request', (
      select jsonb_build_object(
        'id', req.id,
        'requester_name', req.requested_by_name,
        'requester_email', req.requested_by_email,
        'ticket_ref', req.ticket_ref,
        'scope', req.scope,
        'matter_reference', matter.reference,
        'matter_title', matter.title,
        'not_included', req.not_included,
        'reason', req.reason,
        'requested_minutes', req.requested_minutes,
        'created_at', req.created_at
      )
      from public.support_access_requests req
      left join public.matters matter on matter.id = req.matter_id and matter.organization_id = req.organization_id
      where req.organization_id = p_organization_id and req.status = 'pending'
      order by req.created_at desc
      limit 1
    ),
    'pending', (
      select count(*) from public.support_access_requests req
      where req.organization_id = p_organization_id and req.status = 'pending'
    ),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', row_.id,
        'status', row_.status,
        'requester_name', row_.requested_by_name,
        'scope', row_.scope,
        'matter_reference', row_.matter_reference,
        'approved_by_name', row_.approved_by_name,
        'created_at', row_.created_at,
        'starts_at', row_.starts_at,
        'ends_at', row_.ends_at,
        'ended_at', row_.ended_at,
        'decline_reason', row_.decline_reason,
        'uses', row_.uses
      ) order by coalesce(row_.starts_at, row_.created_at) desc)
      from (
        select req.id,
               case when req.status = 'approved' then 'expired'::public.support_access_status else req.status end as status,
               req.requested_by_name, req.scope, matter.reference as matter_reference,
               nullif(btrim(coalesce(prof.display_name, '')), '') as approved_by_name,
               req.created_at, req.starts_at, req.ends_at, req.ended_at, req.decline_reason,
               (select count(*) from public.support_access_uses u where u.request_id = req.id) as uses
        from public.support_access_requests req
        left join public.matters matter on matter.id = req.matter_id and matter.organization_id = req.organization_id
        left join public.memberships member on member.id = req.approved_by_membership_id and member.organization_id = req.organization_id
        left join public.profiles prof on prof.id = member.user_id
        where req.organization_id = p_organization_id
          and (
            req.status in ('declined', 'expired', 'ended', 'cancelled')
            or (req.status = 'approved' and (req.ended_at is not null or req.ends_at <= now_at))
          )
        order by coalesce(req.starts_at, req.created_at) desc
        limit 50
      ) row_
    ), '[]'::jsonb)
  );
end;
$$;
comment on function public.firm_support_access(uuid) is
  'The Support access tab: the open grant (alert), the waiting request, the pending count and the history with how many records support opened. Firm owner at aal2. Lazy on ends_at.';
revoke all on function public.firm_support_access(uuid) from public, anon;
grant execute on function public.firm_support_access(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Auto-revoke. The cron job marks approved grants past their end as expired and audits each one;
-- every read above is lazy on ends_at anyway, so the job is bookkeeping, not the lock.
-- ---------------------------------------------------------------------------
create function app.expire_support_access()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec record;
  n integer := 0;
begin
  for rec in
    update public.support_access_requests req
       set status = 'expired'
     where req.status = 'approved'
       and req.ended_at is null
       and req.ends_at <= statement_timestamp()
    returning req.id, req.organization_id, req.ends_at
  loop
    perform app.record_audit_event(
      rec.organization_id, 'support_access.expired', 'public.support_access_requests', rec.id, 'success',
      jsonb_build_object('ends_at', rec.ends_at)
    );
    n := n + 1;
  end loop;
  return n;
end;
$$;
comment on function app.expire_support_access() is
  'Marks approved support grants past ends_at as expired, one audit event each. Run by pg_cron every five minutes.';
revoke all on function app.expire_support_access() from public, anon, authenticated;
grant execute on function app.expire_support_access() to service_role;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('casevoya-support-access-expire', '*/5 * * * *', 'select app.expire_support_access()');
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Sheet > Notifications: a waiting support request, shown to the firm's owners.
-- app.staff_notification_items copied from 20261020101500_notifications_firm_timezone.sql; only
-- the 'support' branch is new. Same signature, same grants.
-- ---------------------------------------------------------------------------
create or replace function app.staff_notification_items(p_org uuid, p_limit integer)
returns table (
  source_id uuid,
  kind text,
  occurred_at timestamptz,
  matter_id uuid,
  actor_name text,
  subject text,
  detail text,
  href text,
  is_read boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  since timestamptz := clock_timestamp() - interval '30 days';
  firm_zone text;
begin
  if actor is null
     or app.in_active_org(p_org) is distinct from true
     or app.staff_mfa_satisfied() is distinct from true
     or app.is_org_staff(p_org) is distinct from true then
    raise exception 'staff access denied' using errcode = '42501';
  end if;

  select nullif(btrim(coalesce(org.timezone, '')), '') into firm_zone
  from public.organizations org
  where org.id = p_org;

  return query
  with items as (
    -- A client's message.
    select message.id as source_id, 'message'::text as kind, message.created_at as occurred_at,
           message.matter_id, person.display_name as actor_name, null::text as subject, null::text as detail,
           '/sheet/matters/' || message.matter_id::text || '?tab=messages&thread=' || message.thread_id::text as href,
           exists (
             select 1 from public.matter_message_receipts receipt
             where receipt.message_id = message.id and receipt.user_id = actor
           ) as seen
    from public.matter_messages message
    join public.persons person
      on person.id = message.author_person_id
     and person.organization_id = message.organization_id
    where message.organization_id = p_org
      and message.author_kind = 'client'
      and message.created_at > since
      and app.message_staff_reads_matter(message.matter_id, message.organization_id)

    union all
    -- A client's upload that passed the file check.
    select event.id, 'document', event.occurred_at, matter.id,
           coalesce(uploader.display_name, subject_person.display_name), doc.purpose,
           'v' || coalesce(version.version_number, 1)::text,
           '/sheet/matters/' || matter.id::text || '?tab=documents',
           false
    from public.outbox_events event
    join public.documents doc
      on doc.id::text = event.payload ->> 'document_id'
     and doc.organization_id = event.organization_id
    join public.persons subject_person
      on subject_person.id = doc.person_id
     and subject_person.organization_id = doc.organization_id
    left join public.document_versions version
      on version.id::text = event.payload ->> 'version_id'
     and version.organization_id = event.organization_id
    join public.matters matter
      on matter.id::text = event.payload ->> 'matter_id'
     and matter.organization_id = event.organization_id
    left join public.persons uploader
      on uploader.user_id = event.created_by
     and uploader.organization_id = event.organization_id
    where event.organization_id = p_org
      and event.event_type = 'document.uploaded'
      and event.occurred_at > since
      and not exists (
        select 1 from public.memberships m
        where m.organization_id = event.organization_id
          and m.user_id = event.created_by
          and m.role = any (app.staff_roles())
      )
      and app.message_staff_reads_matter(matter.id, matter.organization_id)

    union all
    -- A card payment succeeded.
    select audit.id, 'payment', audit.occurred_at, invoice.matter_id, null, invoice.number, null,
           '/sheet/finance?tab=payments',
           false
    from public.audit_log audit
    join public.invoices invoice
      on invoice.id = audit.object_id
     and invoice.organization_id = audit.organization_id
    where audit.organization_id = p_org
      and audit.action = 'invoice.payment_succeeded'
      and audit.occurred_at > since
      and app.can_read_matter_billing(invoice.matter_id)

    union all
    -- A consultation booked by a client or a visitor, at its time in the firm's zone.
    select event.id, 'booking', event.occurred_at, booking.matter_id, attendee.display_name, booking.title,
           to_char(booking.starts_at at time zone coalesce(firm_zone, booking.host_time_zone), 'YYYY-MM-DD"T"HH24:MI'),
           '/sheet/consultations',
           false
    from public.outbox_events event
    join public.bookings booking
      on booking.id::text = event.payload ->> 'booking_id'
     and booking.organization_id = event.organization_id
    left join public.booking_attendees attendee
      on attendee.booking_id = booking.id
     and attendee.organization_id = booking.organization_id
     and attendee.role = 'primary'
    where event.organization_id = p_org
      and event.event_type = 'booking.confirmed'
      and event.occurred_at > since
      and booking.source = 'public'
      and app.can_read_scheduling(p_org)

    union all
    -- A deadline reminder came due.
    select event.id, 'deadline', event.occurred_at, deadline.matter_id, null, deadline.label,
           coalesce(to_char(deadline.due_on, 'YYYY-MM-DD'), ''),
           '/sheet/matters/' || deadline.matter_id::text || '?tab=tasks',
           false
    from public.outbox_events event
    join public.deadlines deadline
      on deadline.id::text = event.payload ->> 'deadline_id'
     and deadline.organization_id = event.organization_id
    where event.organization_id = p_org
      and event.event_type = 'reminder.due'
      and event.occurred_at > since
      and app.message_staff_reads_matter(deadline.matter_id, deadline.organization_id)

    union all
    -- Casevoya support asked for access (SEC-09): the firm's owners. Read once it is decided.
    select req.id, 'support', req.created_at, req.matter_id, req.requested_by_name,
           case req.scope
             when 'firm_settings' then 'firm settings'
             when 'records_set' then 'a set of records'
             else coalesce(matter.reference, matter.title)
           end,
           req.requested_minutes::text,
           '/sheet/grants?tab=support',
           req.status <> 'pending'
    from public.support_access_requests req
    left join public.matters matter
      on matter.id = req.matter_id
     and matter.organization_id = req.organization_id
    where req.organization_id = p_org
      and req.created_at > since
      and app.has_org_role(p_org, array['firm_owner']::public.org_role[])
  )
  select items.source_id, items.kind, items.occurred_at, items.matter_id, items.actor_name, items.subject,
         items.detail, items.href,
         items.seen or exists (
           select 1 from public.staff_notification_reads r
           where r.organization_id = p_org and r.user_id = actor and r.source_id = items.source_id
         )
  from items
  order by items.occurred_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;
revoke all on function app.staff_notification_items(uuid, integer) from public;
grant execute on function app.staff_notification_items(uuid, integer) to authenticated;
