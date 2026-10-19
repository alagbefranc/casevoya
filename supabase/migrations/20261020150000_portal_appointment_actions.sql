-- Client portal appointments: the signed-in client moves or cancels their own consultation, and
-- reads the free times for moving it (PRD CRM-03; docs/calendar/BUILD-SPEC.md slice 5, the portal
-- part; DECISIONS 2026-10-19). Additive only.
--
-- Who may act: the booking's own person (app.booking_person_is_me), signed in with the workspace
-- pointed at that firm (app.in_active_org) and an active membership there. Staff use the staff_*
-- functions; a client who is not the booking's person, staff, and other firms are refused.
--
-- Rules for a client (the staff functions are not held to them):
--   * only an upcoming confirmed booking;
--   * moving honours the type's minimum notice and booking window, the host's hours, buffers,
--     connected-calendar busy time and the daily limit, and the host stays the same;
--   * cancelling is always allowed, but inside the minimum notice (24 hours when the type has none)
--     the event is recorded late = true (the portal dialog warns it may count as a missed call);
--   * optimistic concurrency on bookings.version, as for staff.
--
-- Mail and notices: the attendee gets EM16b / EM16c through the same outbox events and keys as a
-- staff move or cancellation (booking.rescheduled, booking.cancelled; payload cancelled_by = client
-- so EM16c can say who cancelled). Two new in-app-only outbox events, booking.rescheduled_by_client
-- and booking.cancelled_by_client, feed Sheet > Notifications for the host and the firm owner
-- (20261020150100). A sample booking (is_sample) queues the staff notice but no email, as every
-- other sample record's client-facing side effect is skipped.
--
-- Shared body: the checks and the move itself are extracted from the latest
-- public.staff_reschedule_booking (20261019180100_scheduling_core.sql) into app.reschedule_booking
-- (actor, enforce notice). staff_reschedule_booking keeps its signature and grants and calls it
-- with actor staff and no notice check; only that changes.

-- ---------------------------------------------------------------------------
-- Who may act on a booking from the portal
-- ---------------------------------------------------------------------------

create function app.portal_booking_caller_ok(p_org uuid, p_person_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_org is not null
     and p_person_id is not null
     and (select auth.uid()) is not null
     and app.in_active_org(p_org)
     and app.is_org_member(p_org)
     and app.booking_person_is_me(p_person_id)
     and exists (
       select 1 from public.persons person
       where person.id = p_person_id and person.organization_id = p_org
     );
$$;
comment on function app.portal_booking_caller_ok(uuid, uuid) is
  'The caller is the booking''s own person, signed in to that firm''s portal with an active membership.';
revoke all on function app.portal_booking_caller_ok(uuid, uuid) from public;

-- ---------------------------------------------------------------------------
-- Moving a booking: the shared body
-- ---------------------------------------------------------------------------

-- Moves a confirmed booking to a new start with the same host. Same row, same reference, same
-- calendar UID; ics_sequence goes up so calendar apps update the event instead of adding one.
-- The caller has already checked who is acting; p_actor is recorded in the history and audit.
-- With p_enforce_notice the type's minimum notice applies (clients); staff are not held to it.
create function app.reschedule_booking(
  p_org uuid,
  p_booking_id uuid,
  p_start timestamptz,
  p_expected_version integer,
  p_actor public.booking_actor,
  p_enforce_notice boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.bookings%rowtype;
  et public.booking_event_types%rowtype;
  schedule uuid;
  local_start timestamp;
  ends timestamptz;
  day_count integer;
begin
  select * into b from public.bookings where id = p_booking_id and organization_id = p_org for update;
  if b.id is null then
    raise exception 'booking not found' using errcode = 'P0002';
  end if;
  if p_expected_version is not null and b.version <> p_expected_version then
    raise exception 'this booking was changed by someone else; reload' using errcode = '40001';
  end if;
  if b.status <> 'confirmed' or b.starts_at <= now() then
    raise exception 'only an upcoming confirmed booking can be moved' using errcode = '22023';
  end if;
  select * into et from public.booking_event_types where id = b.event_type_id;
  if p_start is null or p_start <= now() or date_trunc('minute', p_start) <> p_start or p_start = b.starts_at then
    raise exception 'slot_unavailable' using errcode = 'P0001';
  end if;
  -- portal appointments: a client may not move a booking to inside the type's minimum notice.
  if p_enforce_notice and p_start < now() + make_interval(mins => et.min_notice_min) then
    raise exception 'slot_unavailable' using errcode = 'P0001';
  end if;
  ends := p_start + (b.ends_at - b.starts_at);
  schedule := app.host_schedule(b.host_membership_id);
  local_start := p_start at time zone b.host_time_zone;
  if schedule is null
     or (extract(hour from local_start) * 60 + extract(minute from local_start))::integer % coalesce(et.slot_step_min, et.duration_min) <> 0
     or local_start::date > (now() at time zone b.host_time_zone)::date + et.max_advance_days
     or not app.schedule_covers(schedule, p_start, ends)
     or exists (
       select 1 from public.external_busy_blocks x
       where x.membership_id = b.host_membership_id
         and tstzrange(x.starts_at, x.ends_at, '[)')
             && tstzrange(p_start - make_interval(mins => et.buffer_before_min), ends + make_interval(mins => et.buffer_after_min), '[)')
     ) then
    raise exception 'slot_unavailable' using errcode = 'P0001';
  end if;
  if et.daily_capacity is not null then
    perform pg_advisory_xact_lock(hashtextextended(
      'casevoya.booking_day:' || et.id::text || ':' || b.host_user_id::text || ':' || (local_start::date)::text, 0));
    select count(*) into day_count from public.bookings x
    where x.event_type_id = et.id and x.host_user_id = b.host_user_id and x.id <> b.id
      and x.status in ('held', 'pending_payment', 'confirmed', 'completed', 'no_show')
      and (x.starts_at at time zone b.host_time_zone)::date = local_start::date;
    if day_count >= et.daily_capacity then
      raise exception 'slot_unavailable' using errcode = 'P0001';
    end if;
  end if;
  begin
    update public.bookings
       set starts_at = p_start,
           ends_at = ends,
           blocked_from = p_start - make_interval(mins => et.buffer_before_min),
           blocked_until = ends + make_interval(mins => et.buffer_after_min),
           ics_sequence = b.ics_sequence + 1
     where id = b.id;
  exception when exclusion_violation then
    raise exception 'slot_unavailable' using errcode = 'P0001';
  end;
  insert into public.booking_events (organization_id, booking_id, kind, actor, actor_user_id, payload)
  values (b.organization_id, b.id, 'rescheduled', p_actor, (select auth.uid()),
          jsonb_build_object('from', b.starts_at, 'to', p_start, 'sequence', b.ics_sequence + 1));
  -- portal appointments: a sample booking moved by its client sends no email.
  if not (b.is_sample and p_actor = 'client') then
    perform app.booking_outbox(b.organization_id, b.id, 'booking.rescheduled',
      jsonb_build_object('booking_id', b.id, 'starts_at', p_start, 'sequence', b.ics_sequence + 1),
      'booking-rescheduled-email:' || b.id::text || ':' || (b.ics_sequence + 1)::text);
  end if;
  perform app.booking_audit(b.organization_id, 'booking.rescheduled', b.id, 'success',
    jsonb_build_object('from', b.starts_at, 'to', p_start, 'by', p_actor::text));
end;
$$;
revoke all on function app.reschedule_booking(uuid, uuid, timestamptz, integer, public.booking_actor, boolean) from public;

-- Staff: the same signature and grants as before; the body is app.reschedule_booking with actor
-- staff and no minimum-notice check.
create or replace function public.staff_reschedule_booking(p_org uuid, p_booking_id uuid, p_start timestamptz, p_expected_version integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_active_staff(p_org, app.scheduling_staff_roles(), false);
  perform app.reschedule_booking(p_org, p_booking_id, p_start, p_expected_version, 'staff', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- Portal functions
-- ---------------------------------------------------------------------------

-- The client cancels their own upcoming confirmed booking. Returns {"late": bool}: true when the
-- start is inside the type's minimum notice (24 hours when none), recorded on the history row and
-- the outbox payloads; the booking is cancelled either way.
create function public.portal_cancel_booking(
  p_org uuid,
  p_booking_id uuid,
  p_expected_version integer,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.bookings%rowtype;
  notice integer;
  late boolean;
begin
  select * into b from public.bookings where id = p_booking_id and organization_id = p_org for update;
  if b.id is null or not app.portal_booking_caller_ok(p_org, b.person_id) then
    raise exception 'booking access denied' using errcode = '42501';
  end if;
  if p_expected_version is not null and b.version <> p_expected_version then
    raise exception 'this booking was changed by someone else; reload' using errcode = '40001';
  end if;
  if b.status <> 'confirmed' or b.starts_at <= now() then
    raise exception 'only an upcoming confirmed booking can be cancelled' using errcode = '22023';
  end if;
  select coalesce(et.min_notice_min, 1440) into notice from public.booking_event_types et where et.id = b.event_type_id;
  notice := coalesce(notice, 1440);
  late := b.starts_at < now() + make_interval(mins => notice);
  update public.bookings
     set status = 'cancelled', cancelled_at = now(), cancelled_by = 'client',
         cancel_reason = nullif(left(btrim(coalesce(p_reason, '')), 500), ''), hold_expires_at = null
   where id = b.id;
  insert into public.booking_events (organization_id, booking_id, kind, actor, actor_user_id, payload)
  values (b.organization_id, b.id, 'cancelled', 'client', (select auth.uid()),
          jsonb_build_object('late', late, 'notice_min', notice));
  -- EM16c to the attendee (same key as a staff cancellation, so it goes once); not for a sample booking.
  if not b.is_sample then
    perform app.booking_outbox(b.organization_id, b.id, 'booking.cancelled',
      jsonb_build_object('booking_id', b.id, 'starts_at', b.starts_at, 'cancelled_by', 'client', 'late', late),
      'booking-cancelled-email:' || b.id::text);
  end if;
  -- The host's and the owner's in-app notice.
  perform app.booking_outbox(b.organization_id, b.id, 'booking.cancelled_by_client',
    jsonb_build_object('booking_id', b.id, 'starts_at', b.starts_at, 'late', late),
    'booking-cancelled-by-client:' || b.id::text);
  perform app.booking_audit(b.organization_id, 'booking.cancelled', b.id, 'success',
    jsonb_build_object('by', 'client', 'late', late, 'notice_min', notice));
  return jsonb_build_object('late', late);
end;
$$;

-- The client moves their own upcoming confirmed booking (same host, minimum notice and booking
-- window enforced). p_time_zone is the zone they chose the time in: it becomes the booking's
-- attendee zone, so the EM16b email and the portal show the new time in that zone.
create function public.portal_reschedule_booking(
  p_org uuid,
  p_booking_id uuid,
  p_start timestamptz,
  p_time_zone text,
  p_expected_version integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.bookings%rowtype;
  zone text := btrim(coalesce(p_time_zone, ''));
begin
  select * into b from public.bookings where id = p_booking_id and organization_id = p_org for update;
  if b.id is null or not app.portal_booking_caller_ok(p_org, b.person_id) then
    raise exception 'booking access denied' using errcode = '42501';
  end if;
  if not app.is_time_zone(zone) then
    raise exception 'choose a time zone' using errcode = '22023';
  end if;
  perform app.reschedule_booking(p_org, b.id, p_start, p_expected_version, 'client', true);
  update public.bookings set attendee_time_zone = zone where id = b.id and attendee_time_zone is distinct from zone;
  update public.booking_attendees set time_zone = zone
   where booking_id = b.id and organization_id = b.organization_id and role = 'primary' and time_zone is distinct from zone;
  -- The host's and the owner's in-app notice.
  perform app.booking_outbox(b.organization_id, b.id, 'booking.rescheduled_by_client',
    jsonb_build_object('booking_id', b.id, 'from', b.starts_at, 'starts_at', p_start, 'sequence', b.ics_sequence + 1),
    'booking-rescheduled-by-client:' || b.id::text || ':' || (b.ics_sequence + 1)::text);
end;
$$;

-- Free times for moving the client's own booking: the booking's type and host only, the booking
-- itself excluded, in the same shape as staff_booking_availability (the slot library reads it).
-- Never host names, membership ids, other bookings' titles or ids.
create function public.portal_booking_availability(
  p_org uuid,
  p_booking_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  b public.bookings%rowtype;
  result jsonb;
  hosts jsonb;
begin
  select * into b from public.bookings where id = p_booking_id and organization_id = p_org;
  if b.id is null or not app.portal_booking_caller_ok(p_org, b.person_id) then
    raise exception 'booking access denied' using errcode = '42501';
  end if;
  if b.status <> 'confirmed' or b.starts_at <= now() then
    raise exception 'only an upcoming confirmed booking can be moved' using errcode = '22023';
  end if;
  result := app.booking_availability(b.event_type_id, p_from, p_to, b.id, true);
  select coalesce(jsonb_agg(host - 'membership_id'), '[]'::jsonb) into hosts
  from jsonb_array_elements(result -> 'hosts') host
  where host ->> 'membership_id' = b.host_membership_id::text;
  return result || jsonb_build_object('hosts', hosts);
end;
$$;

-- The rules the portal shows for the client's own upcoming confirmed bookings, keyed by booking
-- id: the type's minimum notice (minutes) and whether cancelling now would be late. Clients cannot
-- read booking types themselves. Empty for anyone else.
create function public.portal_booking_rules(p_org uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(b.id, jsonb_build_object(
    'min_notice_min', coalesce(et.min_notice_min, 1440),
    'late', b.starts_at < now() + make_interval(mins => coalesce(et.min_notice_min, 1440))
  )), '{}'::jsonb)
  from public.bookings b
  join public.booking_event_types et on et.id = b.event_type_id
  where b.organization_id = p_org
    and b.status = 'confirmed'
    and b.starts_at > now()
    and app.portal_booking_caller_ok(p_org, b.person_id);
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke all on function public.portal_cancel_booking(uuid, uuid, integer, text) from public, anon;
revoke all on function public.portal_reschedule_booking(uuid, uuid, timestamptz, text, integer) from public, anon;
revoke all on function public.portal_booking_availability(uuid, uuid, timestamptz, timestamptz) from public, anon;
revoke all on function public.portal_booking_rules(uuid) from public, anon;
grant execute on function public.portal_cancel_booking(uuid, uuid, integer, text) to authenticated;
grant execute on function public.portal_reschedule_booking(uuid, uuid, timestamptz, text, integer) to authenticated;
grant execute on function public.portal_booking_availability(uuid, uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.portal_booking_rules(uuid) to authenticated;
