-- #272 item 7c (#269): Link and Not this person answered "no possible match" (and "booking not
-- found") with SQLSTATE P0002, which PostgREST turns into HTTP 500. They now raise PT404, which
-- PostgREST answers as HTTP 404 (as PT409 already answers 409). Same messages, no data changes.
--
-- Redefined: app.open_booking_match (latest in 20261028140000_booking_possible_match.sql). Only
-- the three P0002 error codes change to PT404.

create or replace function app.open_booking_match(p_booking_id uuid, p_person_id uuid, p_expected_version integer)
returns public.booking_person_matches
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.bookings%rowtype;
  m public.booking_person_matches%rowtype;
begin
  select * into b from public.bookings where id = p_booking_id for update;
  if b.id is null then
    raise exception 'booking not found' using errcode = 'PT404';
  end if;
  perform app.require_active_staff(b.organization_id, app.scheduling_staff_roles(), false);
  if b.organization_id is distinct from app.current_organization_id() then
    raise exception 'booking not found' using errcode = 'PT404';
  end if;
  if p_expected_version is null or b.version <> p_expected_version then
    raise exception 'this booking was changed by someone else; reload' using errcode = 'PT409';
  end if;
  select * into m from public.booking_person_matches
  where booking_id = b.id and person_id = p_person_id and organization_id = b.organization_id
  for update;
  -- A person this staff member can't see is answered like no match at all.
  if m.id is null or not app.can_read_person(m.person_id) then
    raise exception 'no possible match for this person' using errcode = 'PT404';
  end if;
  if b.person_id is not null then
    raise exception 'this booking is already linked to a client' using errcode = '22023';
  end if;
  if m.status <> 'open' then
    raise exception 'this possible match was already decided' using errcode = '22023';
  end if;
  return m;
end;
$$;
revoke all on function app.open_booking_match(uuid, uuid, integer) from public;
