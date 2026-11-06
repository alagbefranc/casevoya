-- Google Meet and Microsoft Teams as booking locations.
-- In its own migration: Postgres cannot use an enum value added by ALTER TYPE ... ADD VALUE
-- in the transaction that adds it. The next migration uses these values.
--
-- Rollback: Postgres cannot drop an enum value. If nothing stores these kinds, leave them
-- unused. Do not drop the type.

alter type public.booking_location_kind add value if not exists 'google_meet';
alter type public.booking_location_kind add value if not exists 'microsoft_teams';
