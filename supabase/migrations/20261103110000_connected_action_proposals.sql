-- Vo and connected apps (Composio). QuickBooks joins the per-staff connections, and Vo's writes to a
-- connected app become proposals that only the staff member's own click runs.
--   staff_connections.toolkit      adds 'quickbooks'
--   connected_action_proposals     one proposed write (create an event, a meeting link, a folder,
--                                  a mail draft, a booking link) by Vo for one staff member. Readable
--                                  by that member only; written only through the functions below.
--   propose_connected_action       Vo (as the staff member) proposes; needs the firm's switch on and
--                                  the member's connection to that toolkit active.
--   claim_connected_action         the member's confirm: pending and unexpired -> running, once.
--   settle_connected_action        running -> done / failed with a short result; or pending -> dismissed.
-- The list of actions allowed is in src/modules/integrations/vo-connected-tools.ts and checked again
-- by the app before Composio is called.

alter table public.staff_connections drop constraint if exists staff_connections_toolkit_check;
alter table public.staff_connections
  add constraint staff_connections_toolkit_check check (toolkit in (
    'gmail', 'outlook', 'googlecalendar', 'outlook_calendar',
    'zoom', 'googlemeet', 'microsoft_teams', 'dropbox', 'calendly', 'quickbooks'
  ));

create table public.connected_action_proposals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  membership_id uuid not null,
  toolkit text not null check (toolkit in (
    'gmail', 'outlook', 'googlecalendar', 'outlook_calendar',
    'zoom', 'googlemeet', 'microsoft_teams', 'dropbox', 'calendly', 'quickbooks'
  )),
  action text not null check (action ~ '^[A-Z][A-Z0-9_]{2,100}$'),
  arguments jsonb not null default '{}'::jsonb check (jsonb_typeof(arguments) = 'object' and length(arguments::text) <= 20000),
  summary text not null check (length(btrim(summary)) between 1 and 600),
  status text not null default 'pending' check (status in ('pending', 'running', 'done', 'failed', 'dismissed')),
  result text check (result is null or length(result) <= 2000),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours',
  settled_at timestamptz,
  created_by uuid not null default auth.uid() references auth.users (id),
  foreign key (membership_id, organization_id) references public.memberships (id, organization_id)
);
comment on table public.connected_action_proposals is
  'A write Vo proposed in a staff member''s connected app (Composio). Nothing runs until that member confirms it; it expires after 24 hours.';
create index connected_action_proposals_member_idx on public.connected_action_proposals (membership_id, organization_id, status);
create index connected_action_proposals_org_idx on public.connected_action_proposals (organization_id);
create index connected_action_proposals_created_by_idx on public.connected_action_proposals (created_by);

alter table public.connected_action_proposals enable row level security;
alter table public.connected_action_proposals force row level security;
revoke all on public.connected_action_proposals from public, anon, authenticated;
grant select on public.connected_action_proposals to authenticated;
grant select, insert, update on public.connected_action_proposals to service_role;

create policy connected_action_proposals_own on public.connected_action_proposals
  for select to authenticated
  using (
    app.staff_mfa_satisfied()
    and exists (
      select 1 from public.memberships m
      where m.id = membership_id and m.organization_id = connected_action_proposals.organization_id
        and m.user_id = (select auth.uid()) and m.status = 'active'
    )
  );

create or replace function public.propose_connected_action(
  p_organization_id uuid, p_toolkit text, p_action text, p_arguments jsonb, p_summary text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  member uuid;
  new_id uuid;
begin
  -- The firm's switch and this person's connection to the toolkit (raises otherwise).
  perform public.composio_connection_ready(p_organization_id, p_toolkit);
  select m.id into member from public.memberships m
   where m.organization_id = p_organization_id and m.user_id = (select auth.uid()) and m.status = 'active'
   order by m.created_at limit 1;
  if member is null then
    raise exception 'only firm staff can do this' using errcode = '42501';
  end if;
  if (select count(*) from public.connected_action_proposals p
       where p.membership_id = member and p.status = 'pending' and p.expires_at > now()) >= 20 then
    raise exception 'too many actions are waiting for you to confirm' using errcode = '54000';
  end if;
  insert into public.connected_action_proposals (organization_id, membership_id, toolkit, action, arguments, summary)
  values (p_organization_id, member, p_toolkit, upper(p_action), coalesce(p_arguments, '{}'::jsonb), btrim(p_summary))
  returning id into new_id;
  perform app.record_audit_event(
    p_organization_id, 'integrations.connected_action_proposed', 'connected_action_proposals', new_id, 'success',
    jsonb_build_object('toolkit', p_toolkit, 'action', upper(p_action))
  );
  return new_id;
end;
$$;
revoke all on function public.propose_connected_action(uuid, text, text, jsonb, text) from public, anon;
grant execute on function public.propose_connected_action(uuid, text, text, jsonb, text) to authenticated;

create or replace function public.claim_connected_action(p_proposal_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_ public.connected_action_proposals;
begin
  select p.* into row_ from public.connected_action_proposals p
    join public.memberships m on m.id = p.membership_id and m.organization_id = p.organization_id
   where p.id = p_proposal_id and m.user_id = (select auth.uid()) and m.status = 'active'
   for update of p;
  if row_.id is null then
    raise exception 'that action isn''t yours' using errcode = '42501';
  end if;
  if not app.staff_mfa_satisfied() then
    raise exception 'sign in with two-step verification first' using errcode = '42501';
  end if;
  if row_.status <> 'pending' or row_.expires_at <= now() then
    raise exception 'that action has already been handled or has expired' using errcode = '22023';
  end if;
  perform public.composio_connection_ready(row_.organization_id, row_.toolkit);
  update public.connected_action_proposals set status = 'running' where id = row_.id;
  perform app.record_audit_event(
    row_.organization_id, 'integrations.connected_action_confirmed', 'connected_action_proposals', row_.id, 'success',
    jsonb_build_object('toolkit', row_.toolkit, 'action', row_.action)
  );
  return jsonb_build_object('organization_id', row_.organization_id, 'membership_id', row_.membership_id, 'toolkit', row_.toolkit, 'action', row_.action, 'arguments', row_.arguments);
end;
$$;
revoke all on function public.claim_connected_action(uuid) from public, anon;
grant execute on function public.claim_connected_action(uuid) to authenticated;

create or replace function public.settle_connected_action(p_proposal_id uuid, p_status text, p_result text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_ public.connected_action_proposals;
begin
  select p.* into row_ from public.connected_action_proposals p
    join public.memberships m on m.id = p.membership_id and m.organization_id = p.organization_id
   where p.id = p_proposal_id and m.user_id = (select auth.uid()) and m.status = 'active'
   for update of p;
  if row_.id is null then
    raise exception 'that action isn''t yours' using errcode = '42501';
  end if;
  if not ((row_.status = 'running' and p_status in ('done', 'failed')) or (row_.status = 'pending' and p_status = 'dismissed')) then
    raise exception 'that action can''t change that way' using errcode = '22023';
  end if;
  update public.connected_action_proposals
     set status = p_status, result = left(p_result, 2000), settled_at = now()
   where id = row_.id;
end;
$$;
revoke all on function public.settle_connected_action(uuid, text, text) from public, anon;
grant execute on function public.settle_connected_action(uuid, text, text) to authenticated;
