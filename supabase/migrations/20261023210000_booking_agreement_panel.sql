-- Consultation agreements: the record's Agreement and fee panel (design review on #161).
--
-- * booking_agreements.opened_at: when the booker first opened the private link
--   (public.note_booking_agreement_opened, anon, only while it is unsigned).
-- * booking_agreements.reminded_at / reminder_count, and public.remind_booking_agreement(booking):
--   scheduling staff email the signing link again (EM08, the same booking_agreement.sent mail),
--   at most once an hour counting from the send. Audited booking_agreement.reminded.
-- * public.booking_agreement_for_signing (from 20261023170000_booking_agreements.sql) answers
--   state 'withdrawn' (with the firm's name only) when the booking's agreement was voided and no
--   new one was sent, so the old link says so instead of "not available".
-- Additive only.

alter table public.booking_agreements
  add column opened_at timestamptz,
  add column reminded_at timestamptz,
  add column reminder_count integer not null default 0 check (reminder_count >= 0);

create or replace function public.booking_agreement_for_signing(p_ref text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  booking public.bookings%rowtype;
  agreement public.booking_agreements%rowtype;
  firm_name text;
  attendee text;
  consent jsonb := app.esign_consent();
begin
  if p_ref is null or p_ref !~ '^[a-z2-7]{26}$' then
    return jsonb_build_object('state', 'unavailable');
  end if;
  select * into booking from public.bookings where public_ref = p_ref;
  if booking.id is null then
    return jsonb_build_object('state', 'unavailable');
  end if;
  select * into agreement from public.booking_agreements
  where booking_id = booking.id and status in ('sent', 'signed')
  order by sent_at desc limit 1;
  select coalesce(nullif(btrim(org.display_name), ''), org.legal_name) into firm_name from public.organizations org where org.id = booking.organization_id;
  -- agreement panel: a voided agreement's old link says it was withdrawn (firm name only).
  if agreement.id is null then
    if exists (select 1 from public.booking_agreements v where v.booking_id = booking.id and v.status = 'voided') then
      return jsonb_build_object('state', 'withdrawn', 'firm', firm_name);
    end if;
    return jsonb_build_object('state', 'unavailable');
  end if;
  select a.display_name into attendee from public.booking_attendees a where a.booking_id = booking.id and a.role = 'primary' limit 1;
  return jsonb_build_object(
    'state', case when agreement.status = 'signed' then 'signed'
                  when booking.status in ('cancelled', 'expired') then 'closed'
                  else 'open' end,
    'firm', firm_name,
    'attendee', attendee,
    'meeting', booking.title,
    'starts_at', booking.starts_at,
    'time_zone', booking.attendee_time_zone,
    'title', agreement.title,
    'version', agreement.template_version,
    'body', agreement.body,
    'sha256', agreement.content_sha256,
    'consent_version', consent ->> 'version',
    'consent_text', consent ->> 'text',
    'signed_name', agreement.signed_name,
    'signed_at', agreement.signed_at,
    'sample', booking.is_sample
  );
end;
$$;

create function public.note_booking_agreement_opened(p_ref text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_ref is null or p_ref !~ '^[a-z2-7]{26}$' then
    return;
  end if;
  update public.booking_agreements agreement
  set opened_at = statement_timestamp()
  from public.bookings booking
  where booking.public_ref = p_ref
    and agreement.booking_id = booking.id
    and agreement.organization_id = booking.organization_id
    and agreement.status = 'sent'
    and agreement.opened_at is null;
end;
$$;
comment on function public.note_booking_agreement_opened(text) is
  'Marks a booking''s unsigned consultation agreement as opened the first time its private link is viewed.';
revoke all on function public.note_booking_agreement_opened(text) from public;
grant execute on function public.note_booking_agreement_opened(text) to anon, authenticated, service_role;

create function public.remind_booking_agreement(p_booking_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  agreement public.booking_agreements%rowtype;
  booking public.bookings%rowtype;
begin
  select * into agreement from public.booking_agreements where booking_id = p_booking_id and status = 'sent' for update;
  if agreement.id is null then
    raise exception 'there is no unsigned agreement to remind about' using errcode = '22023';
  end if;
  perform app.require_active_staff(agreement.organization_id, app.scheduling_staff_roles(), false);
  if agreement.organization_id is distinct from app.current_organization_id() then
    raise exception 'booking denied' using errcode = '42501';
  end if;
  select * into booking from public.bookings where id = agreement.booking_id;
  if booking.status not in ('held', 'pending_payment', 'confirmed') or booking.ends_at <= statement_timestamp() then
    raise exception 'only an upcoming consultation can get a reminder' using errcode = '22023';
  end if;
  if coalesce(agreement.reminded_at, agreement.sent_at) > statement_timestamp() - interval '1 hour' then
    raise exception 'a reminder can go once an hour' using errcode = '22023';
  end if;
  -- The mail worker would skip it: say so rather than claim it was sent.
  if exists (
    select 1
    from public.booking_attendees attendee
    join public.person_contact_preferences pref on pref.person_id = attendee.person_id
    where attendee.booking_id = booking.id and attendee.organization_id = booking.organization_id
      and attendee.role = 'primary' and pref.email_notices is false
  ) then
    raise exception 'email notices are off for this client' using errcode = '22023';
  end if;
  update public.booking_agreements
  set reminded_at = statement_timestamp(), reminder_count = agreement.reminder_count + 1
  where id = agreement.id;
  perform app.booking_outbox(
    agreement.organization_id, booking.id, 'booking_agreement.sent',
    jsonb_build_object('booking_id', booking.id, 'booking_agreement_id', agreement.id, 'reminder', true),
    'booking-agreement-remind:' || agreement.id::text || ':' || to_char(statement_timestamp() at time zone 'UTC', 'YYYYMMDD"T"HH24MISS"Z"')
  );
  perform app.record_audit_event(
    agreement.organization_id, 'booking_agreement.reminded', 'public.bookings', booking.id, 'success',
    jsonb_build_object('booking_agreement_id', agreement.id, 'reminder', agreement.reminder_count + 1)
  );
  return agreement.reminder_count + 1;
end;
$$;
comment on function public.remind_booking_agreement(uuid) is
  'Emails the booker the signing link of an unsigned consultation agreement again, at most once an hour. Scheduling staff.';
revoke all on function public.remind_booking_agreement(uuid) from public, anon;
grant execute on function public.remind_booking_agreement(uuid) to authenticated, service_role;
