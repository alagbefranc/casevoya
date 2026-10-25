-- MIG-01 (gap #187): the staged import takes more kinds of record, and the mapping step classifies
-- sensitive columns. Schema only; the functions are in 20261025385100 and 20261025385200.
-- Additive: new columns, two new tables, and one widened check.
--
-- Kinds (migration_batches.kind). One file holds one kind. Every kind goes through the same pipeline
-- as clients and matters: stage, map, dry run with row-level problems, duplicate decisions, sign-off
-- (begin_migration_commit, firm owner + step-up), commit, rollback.
--   clients_matters   the original import (one row per person, rows sharing a reference are a matter)
--   relationships     links between people already in Casevoya (public.person_relationships and its
--                     own relationship_type values)
--   notes             staff notes on a matter (public.matter_staff_notes), with the original author's
--                     name as text and the original date
--   tasks             internal tasks on a matter (public.tasks), the assignee found by staff email
--   key_dates         dates on a matter (public.deadlines), always tentative until someone confirms
--   documents         a CSV manifest plus a ZIP of the files; each file goes through the document
--                     upload path (public.create_upload_intent, storage, the server's byte checks,
--                     public.finish_verified_document_upload)
--   opening_balances  receivables and advances held for a reviewer (public.opening_balances); never
--                     posted to an invoice or a client-account (trust) ledger, never auto-approved
--
-- Sensitivity (migration_batches.sensitivity): the owner's classification of the file's columns on
-- Map columns, by zero-based column index: identity (identity numbers), narrative (immigration
-- narrative), health, or financial. The page hides those columns' values in samples, previews and
-- row problems; audit events name counts only.
--
-- Provenance: every record an import creates or links has a migration_records row (record_table is
-- the record's own table) with the import time (created_at), the batch's source system and the
-- original date from the file (original_at, the firm's midnight of that day). Imported history is
-- not written as a native event: an imported task has no task_events row, an imported note keeps
-- its original author and date apart from its own author (the importer) and created_at.

alter table public.migration_batches
  add column kind text not null default 'clients_matters'
    check (kind in ('clients_matters', 'relationships', 'notes', 'tasks', 'key_dates', 'documents', 'opening_balances')),
  add column sensitivity jsonb not null default '{}'::jsonb check (jsonb_typeof(sensitivity) = 'object'),
  add column attachment_name text check (attachment_name is null or length(btrim(attachment_name)) between 1 and 200),
  add column attachment_sha256 text check (attachment_sha256 is null or attachment_sha256 ~ '^[0-9a-f]{64}$'),
  add column attachment_bytes bigint check (attachment_bytes is null or attachment_bytes between 1 and 26214400),
  add column attachment_files integer check (attachment_files is null or attachment_files between 0 and 1000);
comment on column public.migration_batches.kind is
  'What the file holds (MIG-01): clients_matters, relationships, notes, tasks, key_dates, documents or opening_balances.';
comment on column public.migration_batches.sensitivity is
  'The owner''s classification of sensitive columns, by zero-based column index: identity, narrative, health or financial.';
comment on column public.migration_batches.attachment_sha256 is
  'Documents import: SHA-256 of the ZIP read at upload. The ZIP is not kept; sign-off sends it again and must match.';

alter table public.migration_rows
  add column match_record_id uuid,
  add column match_record_table text check (
    match_record_table is null
    or match_record_table in ('person_relationships', 'matter_staff_notes', 'tasks', 'deadlines', 'documents', 'opening_balances')
  ),
  add column record_id uuid;
comment on column public.migration_rows.match_record_id is
  'A possible duplicate among existing records of the batch''s kind (a task, note, date, relationship, document or opening balance).';

alter table public.migration_records drop constraint migration_records_record_table_check;
alter table public.migration_records
  add constraint migration_records_record_table_check check (
    record_table in ('matters', 'persons', 'person_relationships', 'matter_staff_notes', 'tasks', 'deadlines', 'documents', 'opening_balances')
  );
-- The same column MIG-02 (20261025380000) adds, with the same type: either migration may run first.
alter table public.migration_records
  add column if not exists original_at timestamptz;
comment on column public.migration_records.original_at is
  'The item''s original date in the source system, when the file gave one. created_at is when it was imported.';

alter table public.matter_staff_notes
  add column original_author_name text check (original_author_name is null or length(btrim(original_author_name)) between 1 and 200),
  add column original_written_on date;
comment on column public.matter_staff_notes.original_author_name is
  'Imported notes only: the author named in the source system, kept as text (not a Casevoya user).';

-- ---------------------------------------------------------------------------
-- Files of a documents import (the ZIP's entries): what the server read, never the bytes.
-- ---------------------------------------------------------------------------

create table public.migration_files (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  batch_id uuid not null,
  path text not null check (length(path) between 1 and 300),
  base_name text not null check (length(base_name) between 1 and 300),
  byte_size bigint not null check (byte_size >= 0),
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  media_type text check (
    media_type is null or media_type in (
      'application/pdf', 'image/jpeg', 'image/png', 'image/heic',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )
  ),
  problem text check (problem is null or length(problem) <= 200),
  created_at timestamptz not null default now(),
  unique (batch_id, path),
  foreign key (batch_id, organization_id) references public.migration_batches (id, organization_id)
);
comment on table public.migration_files is
  'The entries of a documents import''s ZIP as the server read them (path, size, SHA-256, detected type). Never the bytes. Purged with the staging rows.';
create index migration_files_batch_fk_idx on public.migration_files (batch_id, organization_id);
create index migration_files_organization_idx on public.migration_files (organization_id);
create index migration_files_base_idx on public.migration_files (batch_id, lower(base_name));

-- ---------------------------------------------------------------------------
-- Opening balances held for review
-- ---------------------------------------------------------------------------

create table public.opening_balances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  matter_id uuid not null,
  kind text not null check (kind in ('receivable', 'advance')),
  amount_cents bigint not null check (amount_cents between 1 and 100000000000),
  currency text not null default 'CAD' check (currency ~ '^[A-Z]{3}$'),
  as_of date not null,
  description text check (description is null or length(btrim(description)) between 1 and 200),
  status text not null default 'pending_review' check (status in ('pending_review', 'approved', 'rejected')),
  source_system text not null check (length(btrim(source_system)) between 1 and 120),
  batch_id uuid not null,
  imported_by uuid not null references auth.users (id),
  reviewed_by uuid references auth.users (id),
  reviewed_at timestamptz,
  review_note text check (review_note is null or length(btrim(review_note)) between 3 and 500),
  is_sample boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id),
  check ((status = 'pending_review') = (reviewed_at is null)),
  check ((status = 'pending_review') = (reviewed_by is null)),
  check (status <> 'rejected' or review_note is not null),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id),
  foreign key (batch_id, organization_id) references public.migration_batches (id, organization_id)
);
comment on table public.opening_balances is
  'MIG-01: a receivable (owed by the client) or an advance (held for the client) carried over from another system, as of a date. Pending until billing staff review it with a step-up. Approval records the decision only: nothing is posted to an invoice or to a client-account (trust) ledger.';
create index opening_balances_org_idx on public.opening_balances (organization_id, status);
create index opening_balances_matter_fk_idx on public.opening_balances (matter_id, organization_id);
create index opening_balances_batch_fk_idx on public.opening_balances (batch_id, organization_id);
create index opening_balances_imported_by_idx on public.opening_balances (imported_by);
create index opening_balances_reviewed_by_idx on public.opening_balances (reviewed_by);
create index opening_balances_created_by_idx on public.opening_balances (created_by);

create trigger opening_balances_touch before update on public.opening_balances
  for each row execute function app.touch_row();
create trigger opening_balances_stamp before insert on public.opening_balances
  for each row execute function app.stamp_created_by();
create trigger opening_balances_audit after insert or update or delete on public.opening_balances
  for each row execute function app.audit_row_change();

revoke all on table public.migration_files from anon, authenticated, service_role;
revoke all on table public.opening_balances from anon, authenticated, service_role;
grant select on table public.migration_files to authenticated;
grant select on table public.opening_balances to authenticated;

alter table public.migration_files enable row level security;
alter table public.migration_files force row level security;
alter table public.opening_balances enable row level security;
alter table public.opening_balances force row level security;

-- Like the staging rows: the firm owner only.
create policy migration_files_select on public.migration_files
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.has_org_role(organization_id, array['firm_owner']::public.org_role[]))
    and (select app.staff_mfa_satisfied())
  );

-- Billing staff of the matter (the firm owner, or its assigned finance user), as for invoices.
create policy opening_balances_select on public.opening_balances
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.can_read_matter_billing(matter_id))
  );
