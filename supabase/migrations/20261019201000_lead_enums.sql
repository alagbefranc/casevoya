-- Lead pipeline enums (PRD §7 lead lifecycle, CRM-01, CRM-02). Own migration: enum values are
-- created before any table or function uses them.
--
--   lead_stage_kind       what a firm's configurable stage means. Stage names and order are rows in
--                         public.lead_stages; the kind is what the database acts on (open work,
--                         converted, lost, archived).
--   lead_source           where a lead came from (source attribution, CRM-01).
--   lead_consent_purpose  replies about the enquiry (transactional) and marketing are recorded
--                         separately (PRD OPS-05, SEC-05; CASL: a reply consent is never marketing).
--   lead_conflict_result  the outcome a staff member records for the conflict screen.

create type public.lead_stage_kind as enum ('open', 'converted', 'lost', 'archived');

create type public.lead_source as enum (
  'web_form',
  'hosted_page',
  'booking_page',
  'phone',
  'email',
  'referral',
  'event',
  'walk_in',
  'csv_import',
  'other'
);

create type public.lead_consent_purpose as enum ('enquiry_reply', 'marketing');

create type public.lead_conflict_result as enum ('not_checked', 'clear', 'possible_conflict', 'conflict');
