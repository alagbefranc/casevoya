-- T040 portable matter file export: the export job's states. In their own migration so later
-- migrations can use the values (an enum value can't be used in the transaction that adds it).
-- Additive only.

create type public.matter_export_status as enum ('building', 'ready', 'failed', 'cancelled');

comment on type public.matter_export_status is
  'A client-file export job: building (collecting and packaging), ready (stored privately, short-lived links), failed, or cancelled. Expiry of the download window is a time check, not a state.';
