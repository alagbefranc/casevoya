-- Support access (SEC-04, SEC-09, ADM-04), types only. Enum values live in their own migration so
-- the next file can use them. Additive only.
--
-- A request's life: pending → approved (then expired or ended), declined, or cancelled by the
-- admin portal. A scope says what support may open once the firm owner approves:
--   firm_settings     the firm's configuration (no matter)
--   matter_documents  one matter's document records (states, sizes, types; never file contents)
--   matter_records    one matter's participants, tasks and deadlines
--   matter_all        both of the above for one matter
--   records_set       a named set of records described in the request (not a matter)

create type public.support_access_status as enum (
  'pending',
  'approved',
  'declined',
  'expired',
  'ended',
  'cancelled'
);

create type public.support_access_scope as enum (
  'firm_settings',
  'matter_documents',
  'matter_records',
  'matter_all',
  'records_set'
);

-- EX11 "Support access requested" and EM17 "Support access granted", to the firm's owners.
alter type public.email_template add value if not exists 'support_requested';
alter type public.email_template add value if not exists 'support_granted';
