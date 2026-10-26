-- CRM-03 (#176): a booker without a portal joins their video call with the Manage your booking
-- token (/call/<ref>?t=<token>, from the Manage page). The same rules as a portal client: only a
-- confirmed video booking, inside the join window (15 minutes before to 30 minutes after), into
-- the lobby until the host lets them in, nothing after the host ends the call. They confirm their
-- name in the lobby. Their identity is client:<booking id>, so the host's Let in works unchanged.
--   video_participants.user_id    may be empty now: a guest has no Casevoya account.
--   video_join_guest              the call view, or (p_issue) the grant for a LiveKit token.
--   video_room_created_guest      records the room's creation, as video_room_created does.

alter table public.video_participants alter column user_id drop not null;
comment on column public.video_participants.user_id is
  'The signed-in person. Empty for a booker who joined with their Manage your booking link (CRM-03).';

-- The booking a token opens for its call: the token may be used until the join window closes.
create function app.booking_by_call_token(p_ref text, p_sha256 text)
returns public.bookings
language sql
stable
security definer
set search_path = ''
as $$
  select booking.*
  from public.bookings booking
  join public.booking_manage_tokens token on token.booking_id = booking.id
  where p_ref ~ '^[a-z2-7]{26}$'
    and p_sha256 ~ '^[0-9a-f]{64}$'
    and booking.public_ref = p_ref
    and token.token_sha256 = p_sha256
    and token.expires_at + interval '30 minutes' > now();
$$;
revoke all on function app.booking_by_call_token(text, text) from public;

create function public.video_join_guest(p_ref text, p_sha256 text, p_issue boolean default false, p_name text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.bookings%rowtype := app.booking_by_call_token(p_ref, p_sha256);
  opens timestamptz;
  closes timestamptz;
  firm text;
  base jsonb;
  session public.video_sessions%rowtype;
  part public.video_participants%rowtype;
  ident text;
  name text;
  booked_name text;
  recent integer;
begin
  if b.id is null then
    raise exception 'call access denied' using errcode = '42501';
  end if;
  select display_name into firm from public.organizations where id = b.organization_id;
  select attendee.display_name into booked_name from public.booking_attendees attendee
   where attendee.booking_id = b.id and attendee.organization_id = b.organization_id and attendee.role = 'primary';
  opens := b.starts_at - interval '15 minutes';
  closes := b.ends_at + interval '30 minutes';
  base := jsonb_build_object(
    'booking_id', b.id, 'title', b.title, 'starts_at', b.starts_at, 'ends_at', b.ends_at,
    'opens_at', opens, 'closes_at', closes, 'host_name', b.host_name, 'firm_name', firm,
    'role', 'client', 'is_sample', b.is_sample, 'organization_id', b.organization_id,
    'booked_name', booked_name);

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
  if exists (select 1 from public.video_sessions s where s.booking_id = b.id and s.ended_by_host_at is not null) then
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
  if session.ended_by_host_at is not null then
    return base || jsonb_build_object('state', 'unavailable', 'reason', 'ended');
  end if;

  ident := 'client:' || b.id::text;
  -- The lobby's name check: the name they confirm or type, else the name on the booking.
  name := coalesce(nullif(left(btrim(regexp_replace(coalesce(p_name, ''), '[[:cntrl:]]', ' ', 'g')), 200), ''), booked_name, 'Guest');

  select count(*) into recent from public.video_token_issues
   where session_id = session.id and identity = ident and created_at > clock_timestamp() - interval '1 minute';
  if recent >= 10 then
    raise exception 'too many join attempts; wait a minute' using errcode = '54000';
  end if;
  insert into public.video_token_issues (organization_id, session_id, identity) values (b.organization_id, session.id, ident);

  insert into public.video_participants (organization_id, session_id, identity, role, user_id, display_name)
  values (b.organization_id, session.id, ident, 'client', null, name)
  on conflict (session_id, identity) do update
     set display_name = excluded.display_name,
         admitted_at = case when public.video_participants.removed_at is not null then null else public.video_participants.admitted_at end,
         removed_at = null,
         removed_by = null
  returning * into part;

  perform app.booking_audit(b.organization_id, 'video.join_issued', b.id, 'success',
    jsonb_build_object('role', 'client', 'via', 'manage_link', 'admitted', part.admitted_at is not null));

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
comment on function public.video_join_guest(text, text, boolean, text) is
  'CRM-03: a booker without a portal, with their Manage your booking token: the call view, or (p_issue) the grant for a lobby token. No token is stored.';
revoke all on function public.video_join_guest(text, text, boolean, text) from public;
grant execute on function public.video_join_guest(text, text, boolean, text) to anon, authenticated;

create function public.video_room_created_guest(p_ref text, p_sha256 text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.bookings%rowtype := app.booking_by_call_token(p_ref, p_sha256);
begin
  if b.id is null then
    raise exception 'call access denied' using errcode = '42501';
  end if;
  update public.video_sessions set room_created_at = coalesce(room_created_at, now())
   where booking_id = b.id and room_created_at is null;
end;
$$;
revoke all on function public.video_room_created_guest(text, text) from public;
grant execute on function public.video_room_created_guest(text, text) to anon, authenticated;
