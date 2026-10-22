-- "End for everyone" really ends the call (follow-up to 20261022100000_video_calls.sql). Additive.
--
-- Before: public.video_end marked the session ended, but the next client join inside the window
-- issued a token and the app re-created the room, so a client could carry on alone after the host
-- ended it. Now video_end stamps video_sessions.ended_by_host_at; while it is set a client is
-- answered state 'unavailable', reason 'ended', and gets no token. A host joining again inside the
-- window clears it (the host may restart the call), and the client can then join as before.
--
-- A room that closes on its own (everyone left; LiveKit's room_finished) is not an end by the
-- host: ended_by_host_at stays null and anyone may rejoin inside the window.
--
-- public.video_join and public.video_end are redefined with the same signatures and grants; the
-- only changes are the ended_by_host_at checks and stamps.

alter table public.video_sessions add column ended_by_host_at timestamptz;
comment on column public.video_sessions.ended_by_host_at is
  'Set by a host''s End for everyone; while set, clients get no token. Cleared when a host joins again.';

create or replace function public.video_join(p_org uuid, p_ref text, p_issue boolean default false)
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
  -- The host ended the call for everyone: a client waits for the host to start it again.
  if who = 'client' and exists (
    select 1 from public.video_sessions s where s.booking_id = b.id and s.ended_by_host_at is not null
  ) then
    return base || jsonb_build_object('state', 'unavailable', 'reason', 'ended');
  end if;
  if not coalesce(p_issue, false) then
    return base || jsonb_build_object('state', 'open');
  end if;

  insert into public.video_sessions (organization_id, booking_id, room_name, is_sample)
  values (b.organization_id, b.id, app.video_room_name(b.id), b.is_sample)
  on conflict (booking_id) do nothing;
  select * into session from public.video_sessions where booking_id = b.id for update;
  if session.status = 'cancelled' then
    return base || jsonb_build_object('state', 'unavailable', 'reason', 'cancelled');
  end if;
  if who = 'client' and session.ended_by_host_at is not null then
    return base || jsonb_build_object('state', 'unavailable', 'reason', 'ended');
  end if;
  -- A host joining again restarts a call they ended.
  if who = 'host' and session.ended_by_host_at is not null then
    update public.video_sessions set ended_by_host_at = null where id = session.id returning * into session;
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

create or replace function public.video_end(p_org uuid, p_ref text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.bookings%rowtype;
begin
  select * into b from public.bookings where organization_id = p_org and public_ref = p_ref;
  if b.id is null or app.video_caller_role(b) is distinct from 'host' then
    raise exception 'only the host can end the call' using errcode = '42501';
  end if;
  -- The LiveKit room is deleted next. Clients get no token until a host joins again.
  update public.video_sessions
     set status = case when status in ('scheduled', 'live') then 'ended' else status end,
         ended_at = coalesce(ended_at, now()),
         ended_by_host_at = now(),
         room_created_at = null
   where booking_id = b.id and status <> 'cancelled';
  perform app.booking_audit(b.organization_id, 'video.ended', b.id, 'success', '{}'::jsonb);
  return jsonb_build_object('room_name', app.video_room_name(b.id));
end;
$$;
revoke all on function public.video_end(uuid, text) from public, anon;
grant execute on function public.video_end(uuid, text) to authenticated;
