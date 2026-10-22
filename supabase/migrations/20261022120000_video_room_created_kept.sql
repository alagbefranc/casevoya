-- video_sessions.room_created_at is kept once set (follow-up to 20261022100000_video_calls.sql and
-- 20261022110000_video_end_for_everyone.sql). Additive: two functions redefined with the same
-- signatures and grants, a column comment, and a backfill.
--
-- Before: room_created_at doubled as "the LiveKit room exists right now". room_started set it,
-- but room_finished and public.video_end set it back to null, so every call that ended showed
-- NULL afterwards (prod test 2026-10-22, video_session 6ff3fff3: room_started arrived and was
-- applied at 07:46:36 UTC, End for everyone cleared it at 07:59:05 UTC). The app used it to skip
-- CreateRoom on later joins; it now calls CreateRoom (idempotent) on every join instead, so a room
-- that closed on its own is always re-created with its limits, and nothing needs the flag.
--
-- Now: room_created_at is when the call's first LiveKit room was created (the app's CreateRoom,
-- or LiveKit's room_started, whichever is recorded first) and is never cleared. video_join's
-- 'room_created' answer keeps its name and now means "a room was created for this call".
--
-- Also for diagnosing calls: track_published / track_unpublished / track_muted events (still
-- recorded as ignored) keep the track's source, type, muted flag and size in the webhook inbox.

comment on column public.video_sessions.room_created_at is
  'When the first LiveKit room for this call was created (app CreateRoom or room_started). Never cleared.';

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
         ended_by_host_at = now()
   where booking_id = b.id and status <> 'cancelled';
  perform app.booking_audit(b.organization_id, 'video.ended', b.id, 'success', '{}'::jsonb);
  return jsonb_build_object('room_name', app.video_room_name(b.id));
end;
$$;
revoke all on function public.video_end(uuid, text) from public, anon;
grant execute on function public.video_end(uuid, text) to authenticated;

create or replace function public.apply_livekit_event(p_event jsonb)
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
  track jsonb := null;
  session public.video_sessions%rowtype;
  inbox_id uuid;
  inbox_status public.webhook_inbox_status;
begin
  if event_id is null or length(event_id) > 200 then
    raise exception 'event id is required' using errcode = '22023';
  end if;
  -- What a track event says about the track (no ids): enough to tell a camera that published
  -- muted or at 0x0 from one that never published.
  if kind like 'track\_%' and jsonb_typeof(p_event -> 'track') = 'object' then
    track := jsonb_strip_nulls(jsonb_build_object(
      'source', left(p_event #>> '{track,source}', 40),
      'type', left(p_event #>> '{track,type}', 40),
      'muted', case when jsonb_typeof(p_event #> '{track,muted}') = 'boolean' then (p_event #> '{track,muted}') end,
      'width', case when jsonb_typeof(p_event #> '{track,width}') = 'number' then (p_event #> '{track,width}') end,
      'height', case when jsonb_typeof(p_event #> '{track,height}') = 'number' then (p_event #> '{track,height}') end,
      'mime_type', left(p_event #>> '{track,mimeType}', 60)));
  end if;
  select * into session from public.video_sessions where room_name = room;
  inbox_id := app.ingest_webhook_event('livekit', event_id, '', left(kind, 120),
    jsonb_strip_nulls(jsonb_build_object('event', kind, 'room', room, 'identity', ident, 'at', at, 'track', track)),
    true, session.organization_id);
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
    -- room_created_at stays: it records when the call's room was first created.
    update public.video_sessions set status = case when status in ('scheduled', 'live') then 'ended' else status end,
           ended_at = coalesce(ended_at, at)
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

-- Calls that already ran: their first room_started from the webhook inbox, else when the call
-- started (a room existed by then).
update public.video_sessions s
   set room_created_at = coalesce(
         (select min((w.payload ->> 'at')::timestamptz) from public.webhook_inbox w
           where w.provider = 'livekit' and w.event_type = 'room_started' and w.payload ->> 'room' = s.room_name),
         s.started_at)
 where s.room_created_at is null and s.started_at is not null;
