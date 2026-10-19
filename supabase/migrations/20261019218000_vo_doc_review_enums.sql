-- Vo document reading (PRD AI-01..AI-06, SRC-06, SRC-09): enum values and types, in their own
-- migration so the next one can use them. Additive only.

-- A new Vo draft kind: Vo's reading of one uploaded document version, as proposals a person
-- accepts, edits or rejects one by one.
alter type public.vo_draft_kind add value if not exists 'document_review';

-- A new Vo run kind for the same task.
alter type public.vo_run_kind add value if not exists 'document_review';

-- A document reading is "reviewed" once a person has accepted or rejected every proposal in it.
-- (A message draft ends as sent or discarded; a document reading is never sent.)
alter type public.vo_draft_status add value if not exists 'reviewed';

-- What one proposal is. Nothing in a proposal changes a record until a person accepts it.
create type public.vo_proposal_kind as enum (
  'classification',  -- a suggested purpose and document category
  'field',           -- a name, date, number or other value printed on the document
  'missing_field',   -- something the document would normally show that Vo couldn't find
  'inconsistency',   -- two things that don't match (never a fraud finding)
  'deadline',        -- a date printed on the document that could become an internal deadline
  'needs_rule'       -- where a date or step would need an immigration rule Vo doesn't have
);

create type public.vo_proposal_status as enum (
  'proposed',
  'accepted',
  'rejected'
);
