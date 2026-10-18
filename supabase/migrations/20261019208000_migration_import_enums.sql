-- Migration import (T044, PRD §25 MIG-01, MIG-02): enum types only. Additive.
--
-- migration_batch_status: one uploaded file's life.
--   staged      parsed rows are held for mapping; nothing is planned yet (or the plan is stale)
--   checked     a dry run planned every row; the plan hash is stored for the commit to match
--   committing  the firm owner signed off; matters are being created in chunks
--   committed   every planned matter exists; staging rows are purged
--   rolled_back the batch's own untouched records were removed
--   discarded   dropped before import, or expired; staging rows are purged
--
-- migration_row_plan: what the dry run decided for one row.
--   create   a new person (and, for the matter's applicant row, a new matter)
--   link     the same person as an existing client record (or an earlier row), confirmed by a person
--   confirm  a possible match no one has decided yet; the import waits for a decision
--   review   a value that maps to nothing configured (program, stage, consultant, role)
--   error    the row fails a check and is not imported
--   skip     not imported because its matter's applicant row is not imported

create type public.migration_batch_status as enum ('staged', 'checked', 'committing', 'committed', 'rolled_back', 'discarded');
create type public.migration_row_plan as enum ('create', 'link', 'confirm', 'review', 'error', 'skip');
