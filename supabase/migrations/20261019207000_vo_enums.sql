-- Vo drafts (PRD AI-01..AI-06, SRC-09): enum types, in their own migration. Additive only.

-- What Vo drafted. Both are matter messages a staff member reviews and sends from the composer.
create type public.vo_draft_kind as enum (
  'message_reply',
  'document_request'
);

-- A draft waits for a person; it is sent only by a person (through the matter messaging
-- composer) or discarded. There is no automatic send.
create type public.vo_draft_status as enum (
  'draft',
  'sent',
  'discarded'
);

-- What a Vo run was for: a draft (above), or "Ask Vo", a staff-only answer about one matter.
create type public.vo_run_kind as enum (
  'message_reply',
  'document_request',
  'ask'
);

-- One Vo run: started, then drafted (a draft for review), answered (Ask Vo, staff only),
-- abstained (the request needs a consultant) or failed.
create type public.vo_run_result as enum (
  'running',
  'drafted',
  'answered',
  'abstained',
  'failed'
);
