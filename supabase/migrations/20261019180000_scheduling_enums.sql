-- Scheduling (PRD CRM-03, CRM-04; docs/calendar/BUILD-SPEC.md §1). Types and enum values only,
-- in their own migration: Postgres cannot use a value added by ALTER TYPE ... ADD VALUE in the
-- transaction that adds it, and the next migrations use them.
--
--   booking_status         held -> confirmed -> completed / no_show, or cancelled; a hold that is
--                          never confirmed becomes expired. pending_payment is reserved for paid
--                          consultations (not built: a booking fee is an advance, PRD §9/§13).
--                          A reschedule keeps the same booking (same reference, same calendar UID,
--                          SEQUENCE + 1), so there is no "rescheduled" status; the history row says so.
--   booking_actor          who changed a booking.
--   booking_location_kind  where the meeting happens. 'video' is a placeholder until in-app video
--                          (BUILD-SPEC §7) is built; 'meeting_link' is a link the firm supplies.
--   email_template         EM16a / EM16b / EM16c (docs/EMAIL-TEMPLATES.md).
-- Additive only.

create type public.booking_status as enum (
  'held',
  'pending_payment',
  'confirmed',
  'cancelled',
  'expired',
  'no_show',
  'completed'
);

create type public.booking_actor as enum ('client', 'staff', 'system');

create type public.booking_location_kind as enum ('video', 'phone', 'in_person', 'meeting_link');

alter type public.email_template add value if not exists 'consultation_booked';
alter type public.email_template add value if not exists 'consultation_rescheduled';
alter type public.email_template add value if not exists 'consultation_cancelled';
