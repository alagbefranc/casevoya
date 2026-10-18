-- T036 to T039 enums (PRD §14 GOV-01 to GOV-05, DEC-01 to DEC-03, §7).
-- Enum values in their own migration, as the project requires. Labels are product
-- workflow words, not immigration rules: no program, fee, deadline, or remedy is implied.
-- Additive only.

-- How the authorized representative says the package was submitted. Casevoya does not submit.
create type public.submission_channel as enum (
  'online_portal',
  'paper',
  'email',
  'in_person',
  'other'
);

-- A manual submission handoff. "submission_unverified" is the honest state when the
-- representative recorded a submission without receipt evidence (GOV-03).
create type public.submission_handoff_status as enum (
  'awaiting_signoff',
  'authorized',
  'submission_unverified',
  'submission_verified',
  'cancelled'
);

-- What a piece of government correspondence is, as the firm read it (GOV-04).
create type public.correspondence_kind as enum (
  'acknowledgement',
  'application_number',
  'request',
  'biometrics_instruction',
  'procedural_fairness',
  'status_update',
  'decision',
  'other'
);

create type public.correspondence_channel as enum (
  'portal_message',
  'email',
  'mail',
  'courier',
  'in_person',
  'other'
);

-- A recorded decision stays unconfirmed until a licensed consultant confirms it (DEC-01).
create type public.decision_record_state as enum (
  'awaiting_confirmation',
  'confirmed'
);

-- Milestones are kept apart instead of one universal "Approved" (DEC-01). Which ones apply
-- to a program is for the consultant and the program pack, not this list.
create type public.decision_milestone as enum (
  'approval_in_principle',
  'final_approval',
  'documents_issued',
  'arrival_confirmed',
  'status_expiry_recorded',
  'other'
);

-- Follow-up tasks after a decision (DEC-02, DEC-03). Every one is an ordinary task row.
create type public.decision_follow_up_kind as enum (
  'refusal_review',
  'client_explanation',
  'next_steps_meeting',
  'conditions_summary',
  'document_delivery',
  'expiry_reminder',
  'account_reconciliation',
  'closure_checklist'
);

-- Withdrawal playbook steps (PRD §6 Refusal or withdrawal). Recording a step changes no money.
create type public.decision_step as enum (
  'withdrawal_instructions',
  'consultant_review',
  'withdrawal_request_sent',
  'acknowledgement_received',
  'financial_reconciliation'
);
