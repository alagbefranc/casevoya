-- Optional per-staff mail and calendar connections through Composio (owner's choice, 2026-10-18;
-- docs/integrations/composio.md), and the calendar busy-time writer. Additive only; no existing
-- function is redefined.
--
-- Casevoya's own mail (Email Routing -> inbound_emails) and calendar (availability + bookings) stay
-- the default. A staff member may also connect their own Gmail / Outlook / Google Calendar /
-- Outlook calendar through a Composio Connect Link, but only after the firm owner turns Composio on
-- for the firm and accepts the disclosure that client mail goes to Composio (United States) and to
-- the AI vendor. OAuth tokens never come here: Composio keeps them. We keep only the Composio
-- connected-account id and a status, per membership.
--
--   vo_settings.composio_enabled / composio_accepted_by / composio_accepted_at
--   staff_connections        one row per membership and toolkit; readable by the member and the
--                            firm owner; written by the member (save) or member/owner (disconnect)
--   public.set_composio_enabled          firm owner + MFA; turning on records the acceptance
--   public.save_staff_connection         the member, MFA, firm has Composio on
--   public.disconnect_staff_connection   the member or the owner
--   public.replace_external_busy_blocks  the member: replaces their busy times from one source
--                                        (times only, no titles) so the existing slot engine
--                                        offers fewer times; never writes the external calendar

alter table public.vo_settings
  add column composio_enabled boolean not null default false,
  add column composio_accepted_by uuid references auth.users (id),
  add column composio_accepted_at timestamptz;
alter table public.vo_settings
  add constraint vo_settings_composio_accepted check (not composio_enabled or (composio_accepted_by is not null and composio_accepted_at is not null));
create index vo_settings_composio_accepted_by_idx on public.vo_settings (composio_accepted_by);

create table public.staff_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  membership_id uuid not null,
  toolkit text not null check (toolkit in ('gmail', 'outlook', 'googlecalendar', 'outlook_calendar')),
  connected_account_id text check (connected_account_id is null or connected_account_id ~ '^[A-Za-z0-9_-]{3,120}$'),
  status text not null check (status in ('pending', 'active', 'disconnected')),
  mail_label text not null default 'Casevoya' check (length(btrim(mail_label)) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id),
  unique (membership_id, toolkit),
  check (status <> 'active' or connected_account_id is not null),
  foreign key (membership_id, organization_id) references public.memberships (id, organization_id)
);
comment on table public.staff_connections is
  'A staff member''s own Composio connection (Composio user id = membership id). Only the connected-account id and status; never tokens. Mail is read only from mail_label.';
create index staff_connections_org_idx on public.staff_connections (organization_id);
create index staff_connections_membership_org_idx on public.staff_connections (membership_id, organization_id);
create index staff_connections_updated_by_idx on public.staff_connections (updated_by);

alter table public.staff_connections enable row level security;
alter table public.staff_connections force row level security;
revoke all on public.staff_connections from public, anon, authenticated;
grant select on public.staff_connections to authenticated;
grant select, insert, update on public.staff_connections to service_role;

-- The member themselves, or the firm owner.
create function app.own_or_owner_membership(p_membership_id uuid, p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.in_active_org(p_org)
     and app.staff_mfa_satisfied()
     and (
       exists (
         select 1 from public.memberships m
         where m.id = p_membership_id and m.organization_id = p_org and m.user_id = (select auth.uid()) and m.status = 'active'
       )
       or app.has_org_role(p_org, array['firm_owner']::public.org_role[])
     );
$$;
revoke all on function app.own_or_owner_membership(uuid, uuid) from public;
grant execute on function app.own_or_owner_membership(uuid, uuid) to authenticated, service_role;

create policy staff_connections_select on public.staff_connections
  for select to authenticated
  using (organization_id = (select app.current_organization_id()) and app.own_or_owner_membership(membership_id, organization_id));

-- The caller's own active staff membership in the firm.
create function app.my_staff_membership(p_org uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.id from public.memberships m
  where m.organization_id = p_org and m.user_id = (select auth.uid()) and m.status = 'active'
    and m.role = any (array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[])
  order by m.created_at
  limit 1;
$$;
revoke all on function app.my_staff_membership(uuid) from public;
grant execute on function app.my_staff_membership(uuid) to authenticated, service_role;

create function public.set_composio_enabled(p_organization_id uuid, p_enabled boolean, p_accept_disclosure boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
begin
  perform app.require_active_staff(p_organization_id, array['firm_owner']::public.org_role[], false);
  if p_enabled and p_accept_disclosure is not true then
    raise exception 'accept the Composio disclosure first' using errcode = '22023';
  end if;
  insert into public.vo_settings (organization_id, enabled, updated_by)
  values (p_organization_id, app.vo_enabled(p_organization_id), actor)
  on conflict (organization_id) do nothing;
  update public.vo_settings
    set composio_enabled = p_enabled,
        composio_accepted_by = case when p_enabled then actor else composio_accepted_by end,
        composio_accepted_at = case when p_enabled then now() else composio_accepted_at end,
        updated_at = now(),
        updated_by = actor
    where organization_id = p_organization_id;
  perform app.record_audit_event(
    p_organization_id, 'integrations.composio_changed', 'vo_settings', null, 'success',
    jsonb_build_object('enabled', p_enabled, 'disclosure_accepted', p_enabled)
  );
end;
$$;
revoke all on function public.set_composio_enabled(uuid, boolean, boolean) from public, anon;
grant execute on function public.set_composio_enabled(uuid, boolean, boolean) to authenticated, service_role;

create function public.save_staff_connection(
  p_organization_id uuid,
  p_toolkit text,
  p_status text,
  p_connected_account_id text default null,
  p_mail_label text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  member uuid;
  rid uuid;
begin
  perform app.require_active_staff(
    p_organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[],
    false
  );
  member := app.my_staff_membership(p_organization_id);
  if member is null then
    raise exception 'connection denied' using errcode = '42501';
  end if;
  if not exists (select 1 from public.vo_settings s where s.organization_id = p_organization_id and s.composio_enabled) then
    raise exception 'the firm owner has not turned on connected accounts' using errcode = '42501';
  end if;
  if p_status not in ('pending', 'active') then
    raise exception 'unknown connection status' using errcode = '22023';
  end if;
  insert into public.staff_connections (organization_id, membership_id, toolkit, connected_account_id, status, mail_label, updated_by)
  values (p_organization_id, member, p_toolkit, p_connected_account_id, p_status, coalesce(nullif(btrim(p_mail_label), ''), 'Casevoya'), actor)
  on conflict (membership_id, toolkit) do update
    set connected_account_id = coalesce(excluded.connected_account_id, public.staff_connections.connected_account_id),
        status = excluded.status,
        mail_label = coalesce(nullif(btrim(p_mail_label), ''), public.staff_connections.mail_label),
        updated_at = now(),
        updated_by = actor
  returning id into rid;
  perform app.record_audit_event(
    p_organization_id, 'integrations.connection_saved', 'staff_connections', rid, 'success',
    jsonb_build_object('toolkit', p_toolkit, 'status', p_status)
  );
  return rid;
end;
$$;
revoke all on function public.save_staff_connection(uuid, text, text, text, text) from public, anon;
grant execute on function public.save_staff_connection(uuid, text, text, text, text) to authenticated, service_role;

create function public.disconnect_staff_connection(p_connection_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_ public.staff_connections%rowtype;
begin
  select * into row_ from public.staff_connections where id = p_connection_id for update;
  if row_.id is null or app.own_or_owner_membership(row_.membership_id, row_.organization_id) is distinct from true then
    raise exception 'connection denied' using errcode = '42501';
  end if;
  update public.staff_connections
    set status = 'disconnected', updated_at = now(), updated_by = (select auth.uid())
    where id = row_.id;
  -- Busy times read from that calendar go with it.
  if row_.toolkit in ('googlecalendar', 'outlook_calendar') then
    delete from public.external_busy_blocks x
    where x.membership_id = row_.membership_id
      and x.organization_id = row_.organization_id
      and x.source = case when row_.toolkit = 'googlecalendar' then 'google' else 'microsoft' end;
  end if;
  perform app.record_audit_event(
    row_.organization_id, 'integrations.connection_removed', 'staff_connections', row_.id, 'success',
    jsonb_build_object('toolkit', row_.toolkit)
  );
end;
$$;
revoke all on function public.disconnect_staff_connection(uuid) from public, anon;
grant execute on function public.disconnect_staff_connection(uuid) to authenticated, service_role;

-- Replaces the caller's busy times from one connected calendar for a window (times only).
create function public.replace_external_busy_blocks(
  p_organization_id uuid,
  p_source text,
  p_from timestamptz,
  p_to timestamptz,
  p_blocks jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  member uuid;
  block jsonb;
  added integer := 0;
  starts timestamptz;
  ends timestamptz;
begin
  perform app.require_active_staff(
    p_organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[],
    false
  );
  member := app.my_staff_membership(p_organization_id);
  if member is null then
    raise exception 'calendar denied' using errcode = '42501';
  end if;
  if p_source not in ('google', 'microsoft') then
    raise exception 'unknown calendar source' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.staff_connections c
    where c.membership_id = member and c.status = 'active'
      and c.toolkit = case when p_source = 'google' then 'googlecalendar' else 'outlook_calendar' end
  ) then
    raise exception 'connect that calendar first' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '62 days' then
    raise exception 'choose a range of up to 62 days' using errcode = '22023';
  end if;
  if p_blocks is null or jsonb_typeof(p_blocks) <> 'array' or jsonb_array_length(p_blocks) > 500 then
    raise exception 'up to 500 busy times' using errcode = '22023';
  end if;
  delete from public.external_busy_blocks x
  where x.membership_id = member and x.organization_id = p_organization_id and x.source = p_source
    and x.ends_at > p_from and x.starts_at < p_to;
  for block in select value from jsonb_array_elements(p_blocks)
  loop
    starts := (block ->> 'start')::timestamptz;
    ends := (block ->> 'end')::timestamptz;
    continue when starts is null or ends is null or ends <= starts or ends - starts > interval '14 days'
      or ends <= p_from or starts >= p_to;
    insert into public.external_busy_blocks (organization_id, membership_id, source, starts_at, ends_at)
    values (p_organization_id, member, p_source, greatest(starts, p_from), least(ends, p_to));
    added := added + 1;
  end loop;
  perform app.record_audit_event(
    p_organization_id, 'integrations.busy_synced', 'external_busy_blocks', null, 'success',
    jsonb_build_object('source', p_source, 'blocks', added)
  );
  return added;
end;
$$;
revoke all on function public.replace_external_busy_blocks(uuid, text, timestamptz, timestamptz, jsonb) from public, anon;
grant execute on function public.replace_external_busy_blocks(uuid, text, timestamptz, timestamptz, jsonb) to authenticated, service_role;
