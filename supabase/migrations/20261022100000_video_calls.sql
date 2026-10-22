-- In-app video calls on LiveKit (PRD CRM-03; docs/calendar/BUILD-SPEC.md §7, slice 7; decided by
-- Francis 2026-10-22: LiveKit, not Daily, Zoom or Telnyx). Additive only.
--
--   video_sessions      one room per video booking (location_kind 'video'), created the first time
--                       someone is let in. The room name is opaque ('cv-' + the booking id without
--                       dashes): no names, no reference, nothing a guess can use without a token.
--   video_participants  who was let in to a room: the host side (the booking's host or a firm
--                       owner) and the client (the booking's own person, signed in to the portal).
--                       Clients wait in a lobby until a host admits them (BUILD-SPEC §7.4).
--   video_token_issues  rate-limit counter for join tokens (10 a minute per person and room).
--
-- The join window is computed from the booking every time (15 minutes before the start to 30
-- minutes after the end), so a reschedule moves it with nothing to update, and a cancelled
-- booking stops issuing tokens at once. The token itself is minted by the app server with the
-- LiveKit API secret (a Worker secret) and is never stored or logged here.
--
-- Who may join: the booking's host (staff with scheduling access), any active firm owner, and the
-- booking's own person through their portal login. Other staff, other clients and other firms
-- are refused. A booker without a portal login cannot join yet (the one-time code of BUILD-SPEC
-- slice 5 is not built).
--
-- LiveKit webhooks (room_started, room_finished, participant_joined, participant_left) are
-- applied by public.apply_livekit_event (service role), deduped through the webhook inbox.
-- Recording (slice 8) is not built: no egress, no recording columns.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.video_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  booking_id uuid not null,
  room_name text not null unique check (room_name ~ '^cv-[0-9a-f]{32}$'),
  status text not null default 'scheduled' check (status in ('scheduled', 'live', 'ended', 'cancelled')),
  room_created_at timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  is_sample boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id),
  unique (booking_id),
  foreign key (booking_id, organization_id) references public.bookings (id, organization_id)
);
comment on table public.video_sessions is
  'One LiveKit room per video booking. Tokens are minted by the app server and never stored.';
create index video_sessions_booking_org_fk_idx on public.video_sessions (booking_id, organization_id);
create index video_sessions_org_idx on public.video_sessions (organization_id, created_at);
create index video_sessions_created_by_idx on public.video_sessions (created_by);

create table public.video_participants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  session_id uuid not null,
  identity text not null check (identity ~ '^(staff|client):[0-9a-f-]{36}$'),
  role text not null check (role in ('host', 'client')),
  user_id uuid not null references auth.users (id),
  display_name text not null check (length(btrim(display_name)) between 1 and 200),
  admitted_at timestamptz,
  admitted_by uuid references auth.users (id),
  removed_at timestamptz,
  removed_by uuid references auth.users (id),
  first_joined_at timestamptz,
  last_joined_at timestamptz,
  last_left_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (session_id, identity),
  check (role <> 'host' or admitted_at is not null),
  foreign key (session_id, organization_id) references public.video_sessions (id, organization_id)
);
comment on table public.video_participants is
  'People let in to a video room. Clients wait in the lobby until a host admits them.';
create index video_participants_session_org_fk_idx on public.video_participants (session_id, organization_id);
create index video_participants_org_idx on public.video_participants (organization_id);
create index video_participants_user_idx on public.video_participants (user_id);
create index video_participants_admitted_by_idx on public.video_participants (admitted_by);
create index video_participants_removed_by_idx on public.video_participants (removed_by);
create index video_participants_created_by_idx on public.video_participants (created_by);

create table public.video_token_issues (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  session_id uuid not null,
  identity text not null,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (session_id, organization_id) references public.video_sessions (id, organization_id)
);
comment on table public.video_token_issues is
  'Rate-limit counter for join tokens. Holds no token. No API read.';
create index video_token_issues_session_org_fk_idx on public.video_token_issues (session_id, organization_id, identity, created_at);
create index video_token_issues_org_idx on public.video_token_issues (organization_id);

create trigger video_sessions_touch before update on public.video_sessions
  for each row execute function app.touch_row();
create trigger video_sessions_stamp before insert on public.video_sessions
  for each row execute function app.stamp_created_by();
create trigger video_sessions_keys before update on public.video_sessions
  for each row execute function app.guard_tenant_keys();
create trigger video_sessions_audit after insert or update or delete on public.video_sessions
  for each row execute function app.audit_row_change();
create trigger video_sessions_no_delete before delete on public.video_sessions
  for each row execute function app.reject_governed_delete();

create trigger video_participants_touch before update on public.video_participants
  for each row execute function app.touch_row();
create trigger video_participants_stamp before insert on public.video_participants
  for each row execute function app.stamp_created_by();
create trigger video_participants_keys before update on public.video_participants
  for each row execute function app.guard_tenant_keys();
create trigger video_participants_audit after insert or update or delete on public.video_participants
  for each row execute function app.audit_row_change('display_name');
create trigger video_participants_no_delete before delete on public.video_participants
  for each row execute function app.reject_governed_delete();

create trigger video_token_issues_no_delete before delete on public.video_token_issues
  for each row execute function app.reject_governed_delete();

revoke all on table public.video_sessions from anon, authenticated, service_role;
revoke all on table public.video_participants from anon, authenticated, service_role;
revoke all on table public.video_token_issues from anon, authenticated, service_role;
grant select on table public.video_sessions to authenticated, service_role;
grant select on table public.video_participants to authenticated, service_role;

alter table public.video_sessions enable row level security;
alter table public.video_sessions force row level security;
alter table public.video_participants enable row level security;
alter table public.video_participants force row level security;
alter table public.video_token_issues enable row level security;
alter table public.video_token_issues force row level security;

-- Scheduling staff of the firm read rooms and who was in them (the consultation record). Clients
-- read nothing directly: the join function answers them.
create policy video_sessions_select on public.video_sessions
  for select to authenticated
  using (organization_id = (select app.current_organization_id()) and (select app.can_read_scheduling(organization_id)));
create policy video_participants_select on public.video_participants
  for select to authenticated
  using (organization_id = (select app.current_organization_id()) and (select app.can_read_scheduling(organization_id)));

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- The opaque room name of a booking.
create function app.video_room_name(p_booking_id uuid)
returns text
language sql
immutable
set search_path = ''
as $$
  select 'cv-' || replace(p_booking_id::text, '-', '');
$$;
revoke all on function app.video_room_name(uuid) from public;

-- How the caller may join a booking's call: 'host', 'client' or null. The host side is the
-- booking's own host or an active firm owner, signed in to the firm's Sheet with staff MFA; the
-- client is the booking's own person through their portal login.
create function app.video_caller_role(p_booking public.bookings)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when app.can_read_scheduling(p_booking.organization_id)
         and (p_booking.host_user_id = (select auth.uid())
              or app.has_org_role(p_booking.organization_id, array['firm_owner']::public.org_role[]))
      then 'host'
    when app.portal_booking_caller_ok(p_booking.organization_id, p_booking.person_id)
      then 'client'
    else null
  end;
$$;
revoke all on function app.video_caller_role(public.bookings) from public;

-- ---------------------------------------------------------------------------
-- Joining
-- ---------------------------------------------------------------------------

-- What the caller sees for a booking's call (p_issue = false), or the grant the app server turns
-- into a LiveKit token (p_issue = true). States:
--   unavailable  cancelled, expired, not confirmed, or not a Casevoya video call (reason given)
--   early        before the window (opens_at given)
--   closed       after the window
--   open         inside the window; with p_issue the room and the participant row exist, the
--                issue is counted, and the answer carries what the token needs.
-- A caller who may not join gets the same error as a booking that does not exist.
create function public.video_join(p_org uuid, p_ref text, p_issue boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.bookings%rowtype;
  who text;
  me uuid := (select auth.uid());
  opens timestamptz;
  closes timestamptz;
  firm text;
  base jsonb;
  session public.video_sessions%rowtype;
  part public.video_participants%rowtype;
  ident text;
  name text;
  recent integer;
begin
  if me is null or p_org is null or p_ref is null or p_ref !~ '^[a-z2-7]{26}$' then
    raise exception 'call access denied' using errcode = '42501';
  end if;
  select * into b from public.bookings where organization_id = p_org and public_ref = p_ref;
  if b.id is null then
    raise exception 'call access denied' using errcode = '42501';
  end if;
  who := app.video_caller_role(b);
  if who is null then
    raise exception 'call access denied' using errcode = '42501';
  end if;
  select display_name into firm from public.organizations where id = b.organization_id;
  opens := b.starts_at - interval '15 minutes';
  closes := b.ends_at + interval '30 minutes';
  base := jsonb_build_object(
    'booking_id', b.id, 'title', b.title, 'starts_at', b.starts_at, 'ends_at', b.ends_at,
    'opens_at', opens, 'closes_at', closes, 'host_name', b.host_name, 'firm_name', firm,
    'role', who, 'is_sample', b.is_sample);

  if b.location_kind <> 'video' then
    return base || jsonb_build_object('state', 'unavailable', 'reason', 'not_video');
  end if;
  if b.status = 'cancelled' then
    return base || jsonb_build_object('state', 'unavailable', 'reason', 'cancelled');
  end if;
  if b.status not in ('confirmed', 'completed') then
    return base || jsonb_build_object('state', 'unavailable', 'reason', 'not_confirmed');
  end if;
  if now() < opens then
    return base || jsonb_build_object('state', 'early');
  end if;
  if now() >= closes then
    return base || jsonb_build_object('state', 'closed');
  end if;
  if not coalesce(p_issue, false) then
    return base || jsonb_build_object('state', 'open');
  end if;

  -- The room, once per booking.
  insert into public.video_sessions (organization_id, booking_id, room_name, is_sample)
  values (b.organization_id, b.id, app.video_room_name(b.id), b.is_sample)
  on conflict (booking_id) do nothing;
  select * into session from public.video_sessions where booking_id = b.id for update;
  if session.status = 'cancelled' then
    return base || jsonb_build_object('state', 'unavailable', 'reason', 'cancelled');
  end if;

  if who = 'host' then
    ident := 'staff:' || me::text;
    select coalesce(nullif(btrim(p.display_name), ''), 'Staff') into name from public.profiles p where p.id = me;
    name := coalesce(name, 'Staff');
  else
    ident := 'client:' || me::text;
    select coalesce(nullif(btrim(p.display_name), ''), 'Client') into name from public.persons p where p.id = b.person_id;
    name := coalesce(name, 'Client');
  end if;

  -- 10 tokens a minute per person and room.
  select count(*) into recent from public.video_token_issues
   where session_id = session.id and identity = ident and created_at > clock_timestamp() - interval '1 minute';
  if recent >= 10 then
    raise exception 'too many join attempts; wait a minute' using errcode = '54000';
  end if;
  insert into public.video_token_issues (organization_id, session_id, identity) values (b.organization_id, session.id, ident);

  insert into public.video_participants (organization_id, session_id, identity, role, user_id, display_name, admitted_at, admitted_by)
  values (b.organization_id, session.id, ident, who, me, left(name, 200),
          case when who = 'host' then now() end, case when who = 'host' then me end)
  on conflict (session_id, identity) do update
     set display_name = excluded.display_name,
         -- A host is always let in; a removed client asking again goes back to the lobby.
         admitted_at = case when excluded.role = 'host' then coalesce(public.video_participants.admitted_at, now())
                            when public.video_participants.removed_at is not null then null
                            else public.video_participants.admitted_at end,
         removed_at = null,
         removed_by = null
  returning * into part;

  perform app.booking_audit(b.organization_id, 'video.join_issued', b.id, 'success',
    jsonb_build_object('role', who, 'admitted', part.admitted_at is not null));

  return base || jsonb_build_object(
    'state', 'open',
    'room_name', session.room_name,
    'room_created', session.room_created_at is not null,
    'identity', ident,
    'name', part.display_name,
    'admitted', part.admitted_at is not null,
    'ttl_seconds', greatest(60, least(7200, floor(extract(epoch from (closes - now())))::integer)));
end;
$$;
comment on function public.video_join(uuid, text, boolean) is
  'The caller''s view of a booking''s video call, or (p_issue) the grant for a LiveKit token. No token is stored.';
revoke all on function public.video_join(uuid, text, boolean) from public, anon;
grant execute on function public.video_join(uuid, text, boolean) to authenticated;

-- The app server created the LiveKit room (CreateRoom is idempotent; this only stops repeats).
create function public.video_room_created(p_org uuid, p_ref text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.bookings%rowtype;
begin
  select * into b from public.bookings where organization_id = p_org and public_ref = p_ref;
  if b.id is null or app.video_caller_role(b) is null then
    raise exception 'call access denied' using errcode = '42501';
  end if;
  update public.video_sessions set room_created_at = coalesce(room_created_at, now())
   where booking_id = b.id and room_created_at is null;
end;
$$;
revoke all on function public.video_room_created(uuid, text) from public, anon;
grant execute on function public.video_room_created(uuid, text) to authenticated;

-- A host lets a waiting client in (p_admit) or sends them away. Answers the room name so the app
-- server can change the participant's permissions (or remove them) in LiveKit.
create function public.video_admit(p_org uuid, p_ref text, p_identity text, p_admit boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.bookings%rowtype;
  session public.video_sessions%rowtype;
  part public.video_participants%rowtype;
  me uuid := (select auth.uid());
begin
  select * into b from public.bookings where organization_id = p_org and public_ref = p_ref;
  if b.id is null or app.video_caller_role(b) is distinct from 'host' then
    raise exception 'only the host can let people in' using errcode = '42501';
  end if;
  select * into session from public.video_sessions where booking_id = b.id;
  if session.id is null or session.status = 'cancelled' then
    raise exception 'this call is not open' using errcode = '22023';
  end if;
  select * into part from public.video_participants
   where session_id = session.id and identity = p_identity and role = 'client' for update;
  if part.id is null then
    raise exception 'that person is not waiting for this call' using errcode = '22023';
  end if;
  if coalesce(p_admit, false) then
    update public.video_participants set admitted_at = coalesce(admitted_at, now()), admitted_by = coalesce(admitted_by, me), removed_at = null, removed_by = null
     where id = part.id;
  else
    update public.video_participants set admitted_at = null, admitted_by = null, removed_at = now(), removed_by = me
     where id = part.id;
  end if;
  perform app.booking_audit(b.organization_id, case when coalesce(p_admit, false) then 'video.admitted' else 'video.removed' end, b.id, 'success',
    jsonb_build_object('participant', part.id));
  return jsonb_build_object('room_name', session.room_name, 'identity', part.identity);
end;
$$;
revoke all on function public.video_admit(uuid, text, text, boolean) from public, anon;
grant execute on function public.video_admit(uuid, text, text, boolean) to authenticated;

-- A host ends the call for everyone. The app server then deletes the LiveKit room.
create function public.video_end(p_org uuid, p_ref text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.bookings%rowtype;
  session public.video_sessions%rowtype;
begin
  select * into b from public.bookings where organization_id = p_org and public_ref = p_ref;
  if b.id is null or app.video_caller_role(b) is distinct from 'host' then
    raise exception 'only the host can end the call' using errcode = '42501';
  end if;
  -- The LiveKit room is deleted next; a later join inside the window creates it again.
  update public.video_sessions set status = 'ended', ended_at = coalesce(ended_at, now()), room_created_at = null
   where booking_id = b.id and status in ('scheduled', 'live')
  returning * into session;
  perform app.booking_audit(b.organization_id, 'video.ended', b.id, 'success', '{}'::jsonb);
  return jsonb_build_object('room_name', app.video_room_name(b.id));
end;
$$;
revoke all on function public.video_end(uuid, text) from public, anon;
grant execute on function public.video_end(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Cancelling a booking closes its room
-- ---------------------------------------------------------------------------

-- Whichever path cancels (staff, client, hold expiry), the session is marked cancelled so no
-- token is issued again. The app server's cancel actions also delete the LiveKit room (best effort).
create function app.video_session_follow_booking()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    update public.video_sessions set status = 'cancelled', ended_at = coalesce(ended_at, now())
     where booking_id = new.id and status <> 'cancelled';
  end if;
  return new;
end;
$$;
revoke all on function app.video_session_follow_booking() from public;

create trigger bookings_video_session after update of status on public.bookings
  for each row execute function app.video_session_follow_booking();

-- ---------------------------------------------------------------------------
-- LiveKit webhooks
-- ---------------------------------------------------------------------------

-- Applies one verified LiveKit webhook event (the app route checks the signature first).
-- Deduped on LiveKit's event id through the webhook inbox; an unknown room is ignored.
create function public.apply_livekit_event(p_event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_id text := nullif(btrim(coalesce(p_event ->> 'id', '')), '');
  kind text := coalesce(p_event ->> 'event', '');
  room text := coalesce(p_event #>> '{room,name}', '');
  ident text := coalesce(p_event #>> '{participant,identity}', '');
  at timestamptz := coalesce(to_timestamp(nullif(p_event ->> 'createdAt', '')::double precision), now());
  session public.video_sessions%rowtype;
  inbox_id uuid;
  inbox_status public.webhook_inbox_status;
begin
  if event_id is null or length(event_id) > 200 then
    raise exception 'event id is required' using errcode = '22023';
  end if;
  select * into session from public.video_sessions where room_name = room;
  inbox_id := app.ingest_webhook_event('livekit', event_id, '', left(kind, 120),
    jsonb_build_object('event', kind, 'room', room, 'identity', ident, 'at', at), true, session.organization_id);
  select w.status into inbox_status from public.webhook_inbox w where w.id = inbox_id for update;
  if inbox_status in ('processed', 'ignored') then
    return jsonb_build_object('outcome', 'duplicate');
  end if;
  if session.id is null or kind not in ('room_started', 'room_finished', 'participant_joined', 'participant_left') then
    update public.webhook_inbox set status = 'ignored', processed_at = clock_timestamp() where id = inbox_id;
    return jsonb_build_object('outcome', 'ignored');
  end if;

  if kind = 'room_started' then
    update public.video_sessions set status = case when status in ('scheduled', 'ended') then 'live' else status end,
           started_at = coalesce(started_at, at), room_created_at = coalesce(room_created_at, at)
     where id = session.id;
  elsif kind = 'room_finished' then
    -- The room is gone (emptied or deleted); a later join inside the window creates it again.
    update public.video_sessions set status = case when status in ('scheduled', 'live') then 'ended' else status end,
           ended_at = coalesce(ended_at, at), room_created_at = null
     where id = session.id;
  elsif kind = 'participant_joined' then
    update public.video_participants
       set first_joined_at = coalesce(first_joined_at, at),
           last_joined_at = greatest(coalesce(last_joined_at, at), at)
     where session_id = session.id and identity = ident;
    update public.video_sessions set status = 'live', started_at = coalesce(started_at, at)
     where id = session.id and status = 'scheduled';
  else
    update public.video_participants set last_left_at = greatest(coalesce(last_left_at, at), at)
     where session_id = session.id and identity = ident;
  end if;
  update public.webhook_inbox set status = 'processed', processed_at = clock_timestamp() where id = inbox_id;
  return jsonb_build_object('outcome', 'applied');
end;
$$;
revoke all on function public.apply_livekit_event(jsonb) from public, anon, authenticated;
grant execute on function public.apply_livekit_event(jsonb) to service_role;
