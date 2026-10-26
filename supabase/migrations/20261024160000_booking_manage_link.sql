-- CRM-03 (#176): "Manage your booking" for a booker without a portal. The booking confirmation and
-- reschedule emails (EM16a / EM16b) carry /booking/<ref>?t=<token>; the token is single-purpose,
-- made by the mail worker at send time, stored here only as its SHA-256, replaced by the next
-- email's, and it stops working when the appointment ends. With it the booker can see the booking,
-- move it within the booking type's rules, or cancel it with a reason. No portal login.
--   booking_manage_tokens           one live token hash per booking (RLS forced, no policies).
--   issue_booking_manage_token      worker role: for one EM16a / EM16b delivery to the primary
--                                   attendee without a portal login, stores the hash, returns the ref.
--   booking_manage_view / _availability / _reschedule / _cancel   anyone holding the token.
-- The moves reuse app.reschedule_booking (actor client, notice enforced) and the portal cancel's
-- rules; history and audit say it was the booker, through the manage link.

create table public.booking_manage_tokens (
  booking_id uuid primary key,
  organization_id uuid not null references public.organizations (id),
  token_sha256 text not null check (token_sha256 ~ '^[0-9a-f]{64}$'),
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  foreign key (booking_id, organization_id) references public.bookings (id, organization_id)
);
comment on table public.booking_manage_tokens is
  'CRM-03: the hash of the newest "Manage your booking" link for a booking. The token itself is only ever in the email.';
alter table public.booking_manage_tokens enable row level security;
alter table public.booking_manage_tokens force row level security;
create index booking_manage_tokens_org_idx on public.booking_manage_tokens (organization_id);
revoke all on public.booking_manage_tokens from public, anon, authenticated;

create function public.issue_booking_manage_token(p_delivery_id uuid, p_sha256 text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.bookings%rowtype;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') is distinct from 'service_role' then
    raise exception 'worker role required' using errcode = '42501';
  end if;
  if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'token hash is not usable' using errcode = '22023';
  end if;
  select booking.* into b
  from public.email_deliveries delivery
  join public.outbox_events event on event.id = delivery.outbox_event_id
  join public.bookings booking
    on booking.id::text = event.payload ->> 'booking_id'
   and booking.organization_id = delivery.organization_id
  join public.booking_attendees attendee
    on attendee.booking_id = booking.id and attendee.organization_id = booking.organization_id and attendee.role = 'primary'
  left join public.persons person on person.id = attendee.person_id and person.organization_id = attendee.organization_id
  where delivery.id = p_delivery_id
    and delivery.template in ('consultation_booked', 'consultation_rescheduled')
    and lower(attendee.email) = delivery.recipient_email
    and person.user_id is null
    and booking.status = 'confirmed'
    and booking.ends_at > now();
  if b.id is null then
    return null;
  end if;
  insert into public.booking_manage_tokens (booking_id, organization_id, token_sha256, issued_at, expires_at)
  values (b.id, b.organization_id, p_sha256, now(), b.ends_at)
  on conflict (booking_id) do update
    set token_sha256 = excluded.token_sha256, issued_at = excluded.issued_at, expires_at = excluded.expires_at;
  return b.public_ref;
end;
$$;
comment on function public.issue_booking_manage_token(uuid, text) is
  'Worker role (CRM-03): stores the hash of a new Manage your booking token for an EM16a / EM16b delivery to a primary attendee without a portal login, replacing the previous one; returns the booking reference, or null.';
revoke all on function public.issue_booking_manage_token(uuid, text) from public, anon, authenticated;
grant execute on function public.issue_booking_manage_token(uuid, text) to service_role;

-- The booking a token opens, locked when asked; null for a wrong, replaced or expired token.
create function app.booking_by_manage_token(p_ref text, p_sha256 text, p_lock boolean)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.bookings%rowtype;
begin
  if p_ref is null or p_ref !~ '^[a-z2-7]{26}$' or p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then
    return null;
  end if;
  if p_lock then
    select booking.* into b
    from public.bookings booking
    join public.booking_manage_tokens token on token.booking_id = booking.id
    where booking.public_ref = p_ref and token.token_sha256 = p_sha256 and token.expires_at > now()
    for update of booking;
  else
    select booking.* into b
    from public.bookings booking
    join public.booking_manage_tokens token on token.booking_id = booking.id
    where booking.public_ref = p_ref and token.token_sha256 = p_sha256 and token.expires_at > now();
  end if;
  return b;
end;
$$;
revoke all on function app.booking_by_manage_token(text, text, boolean) from public;

create function public.booking_manage_view(p_ref text, p_sha256 text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  b public.bookings%rowtype := app.booking_by_manage_token(p_ref, p_sha256, false);
  et public.booking_event_types%rowtype;
  firm public.organizations%rowtype;
  notice integer;
begin
  if b.id is null then
    return null;
  end if;
  select * into et from public.booking_event_types where id = b.event_type_id;
  select * into firm from public.organizations where id = b.organization_id;
  notice := coalesce(et.min_notice_min, 1440);
  return jsonb_build_object(
    'id', b.id,
    'ref', b.public_ref,
    'firm_name', firm.display_name,
    'firm_slug', firm.slug,
    'title', b.title,
    'host_name', b.host_name,
    'starts_at', b.starts_at,
    'ends_at', b.ends_at,
    'time_zone', b.attendee_time_zone,
    'location_kind', b.location_kind,
    'status', b.status,
    'cancelled_by', b.cancelled_by,
    'version', b.version,
    'upcoming', b.status = 'confirmed' and b.starts_at > now(),
    'min_notice_min', notice,
    'late', b.starts_at < now() + make_interval(mins => notice),
    'max_advance_days', et.max_advance_days
  );
end;
$$;
comment on function public.booking_manage_view(text, text) is
  'CRM-03: the booking a Manage your booking link opens (title, time, status, the type''s rules), or null.';
revoke all on function public.booking_manage_view(text, text) from public;
grant execute on function public.booking_manage_view(text, text) to anon, authenticated;

create function public.booking_manage_availability(p_ref text, p_sha256 text, p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  b public.bookings%rowtype := app.booking_by_manage_token(p_ref, p_sha256, false);
  result jsonb;
  hosts jsonb;
begin
  if b.id is null then
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
comment on function public.booking_manage_availability(text, text, timestamptz, timestamptz) is
  'CRM-03: free times for moving the booking a Manage link opens: its type and host only, the booking itself excluded (same shape as portal_booking_availability).';
revoke all on function public.booking_manage_availability(text, text, timestamptz, timestamptz) from public;
grant execute on function public.booking_manage_availability(text, text, timestamptz, timestamptz) to anon, authenticated;

create function public.booking_manage_reschedule(p_ref text, p_sha256 text, p_start timestamptz, p_time_zone text, p_expected_version integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.bookings%rowtype := app.booking_by_manage_token(p_ref, p_sha256, true);
  zone text := btrim(coalesce(p_time_zone, ''));
begin
  if b.id is null then
    raise exception 'booking access denied' using errcode = '42501';
  end if;
  if not app.is_time_zone(zone) then
    raise exception 'choose a time zone' using errcode = '22023';
  end if;
  perform app.reschedule_booking(b.organization_id, b.id, p_start, p_expected_version, 'client', true);
  update public.bookings set attendee_time_zone = zone where id = b.id and attendee_time_zone is distinct from zone;
  update public.booking_attendees set time_zone = zone
   where booking_id = b.id and organization_id = b.organization_id and role = 'primary' and time_zone is distinct from zone;
  -- How it was moved, for the staff record (booking_events is append-only; its row says client).
  perform app.booking_audit(b.organization_id, 'booking.manage_link_used', b.id, 'success',
    jsonb_build_object('action', 'rescheduled'));
  perform app.booking_outbox(b.organization_id, b.id, 'booking.rescheduled_by_client',
    jsonb_build_object('booking_id', b.id, 'from', b.starts_at, 'starts_at', p_start, 'sequence', b.ics_sequence + 1),
    'booking-rescheduled-by-client:' || b.id::text || ':' || (b.ics_sequence + 1)::text);
end;
$$;
comment on function public.booking_manage_reschedule(text, text, timestamptz, text, integer) is
  'CRM-03: the booker moves the booking a Manage link opens, within the type''s minimum notice, window and the host''s hours (app.reschedule_booking, actor client). EM16b goes to them with a new link.';
revoke all on function public.booking_manage_reschedule(text, text, timestamptz, text, integer) from public;
grant execute on function public.booking_manage_reschedule(text, text, timestamptz, text, integer) to anon, authenticated;

create function public.booking_manage_cancel(p_ref text, p_sha256 text, p_expected_version integer, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.bookings%rowtype := app.booking_by_manage_token(p_ref, p_sha256, true);
  notice integer;
  late boolean;
  reason text := nullif(left(btrim(coalesce(p_reason, '')), 500), '');
begin
  if b.id is null then
    raise exception 'booking access denied' using errcode = '42501';
  end if;
  if p_expected_version is not null and b.version <> p_expected_version then
    raise exception 'this booking was changed by someone else; reload' using errcode = 'PT409';
  end if;
  if b.status <> 'confirmed' or b.starts_at <= now() then
    raise exception 'only an upcoming confirmed booking can be cancelled' using errcode = '22023';
  end if;
  if reason is null or length(reason) < 3 then
    raise exception 'say why you are cancelling' using errcode = '22023';
  end if;
  select coalesce(et.min_notice_min, 1440) into notice from public.booking_event_types et where et.id = b.event_type_id;
  notice := coalesce(notice, 1440);
  late := b.starts_at < now() + make_interval(mins => notice);
  update public.bookings
     set status = 'cancelled', cancelled_at = now(), cancelled_by = 'client', cancel_reason = reason, hold_expires_at = null
   where id = b.id;
  insert into public.booking_events (organization_id, booking_id, kind, actor, actor_user_id, payload)
  values (b.organization_id, b.id, 'cancelled', 'client', (select auth.uid()),
          jsonb_build_object('late', late, 'notice_min', notice, 'via', 'manage_link'));
  if not b.is_sample then
    perform app.booking_outbox(b.organization_id, b.id, 'booking.cancelled',
      jsonb_build_object('booking_id', b.id, 'starts_at', b.starts_at, 'cancelled_by', 'client', 'late', late),
      'booking-cancelled-email:' || b.id::text);
  end if;
  perform app.booking_outbox(b.organization_id, b.id, 'booking.cancelled_by_client',
    jsonb_build_object('booking_id', b.id, 'starts_at', b.starts_at, 'late', late),
    'booking-cancelled-by-client:' || b.id::text);
  perform app.booking_audit(b.organization_id, 'booking.cancelled', b.id, 'success',
    jsonb_build_object('by', 'client', 'via', 'manage_link', 'late', late, 'notice_min', notice));
  perform app.booking_audit(b.organization_id, 'booking.manage_link_used', b.id, 'success',
    jsonb_build_object('action', 'cancelled'));
  -- The link has done its job.
  delete from public.booking_manage_tokens where booking_id = b.id;
  return jsonb_build_object('late', late);
end;
$$;
comment on function public.booking_manage_cancel(text, text, integer, text) is
  'CRM-03: the booker cancels the booking a Manage link opens, with a reason (late when inside the type''s minimum notice). EM16c and the host''s notice follow; the link stops working.';
revoke all on function public.booking_manage_cancel(text, text, integer, text) from public;
grant execute on function public.booking_manage_cancel(text, text, integer, text) to anon, authenticated;
