-- Privacy requests (SEC-05, SEC-06) and the firm complaints register (ADM-05). Types only, in their
-- own migration so the tables and functions that use them can be created in the next one. Additive only.

-- What a person asked the firm to do with their personal information.
create type public.privacy_request_kind as enum (
  'access',
  'correction',
  'consent_withdrawal',
  'deletion'
);

-- How a closed privacy request ended. A deletion request can only be refused (with a reason) or
-- withdrawn: Casevoya has no record-destruction workflow yet (SEC-07), and never destroys held or
-- retained records.
create type public.privacy_request_outcome as enum (
  'fulfilled',
  'partly_fulfilled',
  'refused',
  'withdrawn'
);

-- One line of an access request's third-party redaction worklist.
create type public.privacy_redaction_state as enum (
  'to_do',
  'redacted',
  'excluded',
  'kept'
);

-- How a privacy request or a complaint reached the firm.
create type public.compliance_channel as enum (
  'email',
  'phone',
  'letter',
  'in_person',
  'portal',
  'other'
);

-- Product categories for the complaints register. Not a regulatory classification.
create type public.complaint_category as enum (
  'fees_billing',
  'communication',
  'service_quality',
  'conduct',
  'privacy',
  'other'
);
