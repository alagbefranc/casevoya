-- MIG-02 (gap #187): pilot run with the firm owner's sign-off before the full run, the run report,
-- and where imported records came from. Additive only.
--
-- Flow (extends the T044 import in 20261019208100_migration_import.sql; no second importer):
--   1. Dry run and duplicate decisions as before (status 'checked').
--   2. Pilot (public.begin_migration_pilot, firm owner + step-up): the staged rows are checked
--      again against the checksum taken at upload, the plan is evaluated again and must hash to the
--      dry run's, then the first N matters in file order (default 10; at most the firm's pilot
--      maximum, default 25, 1 to 50) are marked as the pilot. commit_migration_chunk creates only
--      those. When the last one exists the batch waits: pilot_completed_at is set and every further
--      chunk is refused until the firm owner signs the pilot off.
--   3. Pilot sign-off (public.sign_off_migration_pilot, firm owner + step-up, a note of 3 to 1,000
--      characters): stored on the batch and audited. The pilot's records can instead be rolled back
--      with the existing public.rollback_migration_batch (it ends the batch, as before).
--   4. Full run (public.begin_migration_commit, redefined): refused for a batch that has not had a
--      signed-off pilot; checks the staged rows against the upload checksum once more, then the
--      chunks create the rest. The plan is not evaluated again after the pilot: the pilot's own
--      people would now read as possible duplicates of their rows. The last chunk verifies record
--      totals against the dry run (unchanged) and writes the run report (run_report).
--
-- Imported provenance: public.imported_record_provenance gives staff of the firm the source system,
-- import date and (when the importer recorded one) the original date of imported records, so pages
-- can say "Imported from <system> on <date>". Imported history is never written to audit_log as if
-- it happened in Casevoya; the import's own steps stay audited (migration.*).
--
-- Redefines (each copied from its latest definition, 20261019208100_migration_import.sql):
--   public.begin_migration_commit  the full run only, after a signed-off pilot
--   app.migration_next_groups      only the pilot's matters during the pilot; refuses after it
--                                   until sign-off
--   app.migration_after_chunk      the pilot's end; the run report at the end of the full run

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

alter table public.migration_settings
  add column pilot_max integer not null default 25 check (pilot_max between 1 and 50);
comment on column public.migration_settings.pilot_max is
  'The largest pilot (in matters) the firm owner may run before a full import (default 25, 1 to 50).';

alter table public.migration_batches
  add column pilot_size integer check (pilot_size is null or pilot_size between 1 and 50),
  add column pilot_started_at timestamptz,
  add column pilot_started_by uuid references auth.users (id),
  add column pilot_completed_at timestamptz,
  add column pilot_counts jsonb,
  add column pilot_signed_off_at timestamptz,
  add column pilot_signed_off_by uuid references auth.users (id),
  add column pilot_signoff_note text check (pilot_signoff_note is null or length(btrim(pilot_signoff_note)) between 3 and 1000),
  add column full_run_started_at timestamptz,
  add column full_run_started_by uuid references auth.users (id),
  add column commit_verified_at timestamptz,
  add column run_report jsonb check (run_report is null or jsonb_typeof(run_report) = 'object'),
  add constraint migration_batches_pilot_signoff_check
    check (pilot_signed_off_at is null or pilot_completed_at is not null),
  add constraint migration_batches_full_run_check
    check (full_run_started_at is null or pilot_size is null or pilot_signed_off_at is not null);
comment on column public.migration_batches.pilot_size is
  'MIG-02: how many matters (in file order) the pilot created before the full run. Null for an import begun before pilots existed.';
comment on column public.migration_batches.pilot_signoff_note is
  'The firm owner''s note when signing the pilot off (step-up). The full run is refused until then.';
comment on column public.migration_batches.commit_verified_at is
  'When the staged rows were last checked against the checksum taken at upload (at the pilot and at the full run).';
comment on column public.migration_batches.run_report is
  'MIG-02 run report: source counts and checksums, record totals by kind, skipped, duplicate and error counts, the pilot and its sign-off. Never cell values.';
create index migration_batches_pilot_started_by_idx on public.migration_batches (pilot_started_by);
create index migration_batches_pilot_signed_off_by_idx on public.migration_batches (pilot_signed_off_by);
create index migration_batches_full_run_started_by_idx on public.migration_batches (full_run_started_by);

alter table public.migration_rows
  add column in_pilot boolean not null default false;
comment on column public.migration_rows.in_pilot is
  'MIG-02: the row belongs to one of the first matters the pilot creates.';

-- The original date of an imported historical item (a note, task or key date from the old system),
-- when the importer has one. Shown beside "Imported from <system> on <date>"; never an audit time.
alter table public.migration_records
  add column if not exists original_at timestamptz;
comment on column public.migration_records.original_at is
  'MIG-02: the item''s original date in the source system, when the file gave one. created_at is when it was imported.';

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- The staged rows still are exactly what the upload verified: each row's checksum matches its
-- cells, and the digest over the rows and their count match the upload's.
create function app.migration_staged_intact(p_batch uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  b public.migration_batches%rowtype;
  v_count integer;
  v_digest text;
  v_bad integer;
begin
  select * into b from public.migration_batches where id = p_batch;
  if b.id is null or b.verified_at is null or b.staging_purged_at is not null then
    return false;
  end if;
  select count(*),
         count(*) filter (where row_sha256 is distinct from encode(sha256(convert_to(array_to_string(cells, chr(31)), 'UTF8')), 'hex')),
         encode(sha256(convert_to(coalesce(string_agg(row_sha256, '' order by row_number), ''), 'UTF8')), 'hex')
  into v_count, v_bad, v_digest
  from public.migration_rows where batch_id = p_batch;
  return v_bad = 0 and v_count = b.source_row_count and v_digest = b.parsed_digest
     and v_digest is not distinct from b.staged_digest;
end;
$$;
revoke all on function app.migration_staged_intact(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Pilot (firm owner + step-up)
-- ---------------------------------------------------------------------------

create function public.begin_migration_pilot(
  p_org uuid,
  p_batch uuid,
  p_plan_hash text,
  p_size integer default 10,
  p_source_system text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.migration_batches%rowtype;
  result jsonb;
  v_sample boolean;
  v_max integer;
  v_system text := nullif(regexp_replace(btrim(coalesce(p_source_system, '')), '\s+', ' ', 'g'), '');
  v_pilot integer;
begin
  perform app.migration_owner(p_org, true);
  select * into b from public.migration_batches where id = p_batch and organization_id = p_org for update;
  if b.id is null then
    raise exception 'migration batch not found' using errcode = 'P0002';
  end if;
  if b.status <> 'checked' or b.plan_hash is null then
    raise exception 'run the dry run before signing off' using errcode = '22023';
  end if;
  if b.verified_at is null then
    raise exception 'the row count and checksum are not verified' using errcode = '22023';
  end if;
  select coalesce((select s.pilot_max from public.migration_settings s where s.organization_id = p_org), 25) into v_max;
  if p_size is null or p_size < 1 or p_size > v_max then
    raise exception 'a pilot is 1 to % matters', v_max using errcode = '22023';
  end if;
  if v_system is not null and length(v_system) > 120 then
    raise exception 'name the source system in 120 characters or fewer' using errcode = '22023';
  end if;
  select org.sample_mode into v_sample from public.organizations org where org.id = p_org;
  if coalesce(v_sample, false) is distinct from b.is_sample then
    raise exception 'sample mode changed since the upload; upload the file again' using errcode = '22023';
  end if;
  if not app.migration_staged_intact(p_batch) then
    perform app.record_audit_event(p_org, 'migration.commit_refused', 'public.migration_batches', p_batch, 'denied', jsonb_build_object('reason', 'staged rows changed'));
    return jsonb_build_object('ok', false, 'reason', 'checksum_changed');
  end if;
  result := app.migration_evaluate(p_batch);
  if result ->> 'plan_hash' is distinct from b.plan_hash or p_plan_hash is distinct from b.plan_hash then
    update public.migration_batches set plan_hash = result ->> 'plan_hash', plan_counts = result - 'plan_hash', checked_at = now() where id = p_batch;
    perform app.record_audit_event(p_org, 'migration.commit_refused', 'public.migration_batches', p_batch, 'denied', jsonb_build_object('reason', 'plan changed'));
    return jsonb_build_object('ok', false, 'reason', 'plan_changed');
  end if;
  if (result ->> 'confirm')::integer > 0 then
    raise exception 'decide every possible match first' using errcode = '22023';
  end if;
  if (result ->> 'matters')::integer = 0 then
    raise exception 'no row is ready to import' using errcode = '22023';
  end if;

  -- The pilot: the first p_size matters ready to import, in file order, with everyone on them.
  update public.migration_rows mr set in_pilot = true
  where mr.batch_id = p_batch and mr.group_first in (
    select a.group_first from public.migration_rows a
    where a.batch_id = p_batch and a.is_applicant and a.plan in ('create', 'link')
    order by a.group_first
    limit p_size
  );
  select count(*) into v_pilot from public.migration_rows
  where batch_id = p_batch and in_pilot and is_applicant and plan in ('create', 'link');

  update public.migration_batches set
    status = 'committing',
    commit_started_at = now(),
    committed_by = (select auth.uid()),
    pilot_size = p_size,
    pilot_started_at = now(),
    pilot_started_by = (select auth.uid()),
    commit_verified_at = now(),
    source_system = coalesce(v_system, source_system)
  where id = p_batch;
  perform app.record_audit_event(p_org, 'migration.pilot_started', 'public.migration_batches', p_batch, 'success',
    (result - 'plan_hash') || jsonb_build_object('pilot_size', p_size, 'pilot_matters', v_pilot, 'checksum_verified', true));
  return jsonb_build_object('ok', true, 'matters', v_pilot);
end;
$$;

-- The firm owner's sign-off of a finished pilot, with a note. The full run is refused until then.
create function public.sign_off_migration_pilot(p_org uuid, p_batch uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.migration_batches%rowtype;
  v_note text := btrim(coalesce(p_note, ''));
begin
  perform app.migration_owner(p_org, true);
  select * into b from public.migration_batches where id = p_batch and organization_id = p_org for update;
  if b.id is null then
    raise exception 'migration batch not found' using errcode = 'P0002';
  end if;
  if b.status <> 'committing' or b.pilot_size is null then
    raise exception 'this import has no pilot to sign off' using errcode = '22023';
  end if;
  if b.pilot_completed_at is null then
    raise exception 'the pilot is not finished yet' using errcode = '22023';
  end if;
  if b.pilot_signed_off_at is not null then
    raise exception 'the pilot is already signed off' using errcode = '22023';
  end if;
  if length(v_note) not between 3 and 1000 then
    raise exception 'add a note of 3 to 1,000 characters' using errcode = '22023';
  end if;
  update public.migration_batches set
    pilot_signed_off_at = now(),
    pilot_signed_off_by = (select auth.uid()),
    pilot_signoff_note = v_note
  where id = p_batch;
  perform app.record_audit_event(p_org, 'migration.pilot_signed_off', 'public.migration_batches', p_batch, 'success',
    coalesce(b.pilot_counts, '{}'::jsonb) || jsonb_build_object('pilot_size', b.pilot_size, 'note_chars', length(v_note)));
  return jsonb_build_object('ok', true);
end;
$$;

-- The largest pilot the firm owner may run (1 to 50 matters).
create function public.set_migration_pilot_max(p_org uuid, p_max integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.migration_owner(p_org, true);
  if p_max is null or p_max not between 1 and 50 then
    raise exception 'a pilot is 1 to 50 matters' using errcode = '22023';
  end if;
  insert into public.migration_settings (organization_id, pilot_max) values (p_org, p_max)
  on conflict (organization_id) do update set pilot_max = excluded.pilot_max, version = public.migration_settings.version + 1;
  perform app.record_audit_event(p_org, 'migration.settings_changed', 'public.migration_settings', null, 'success', jsonb_build_object('pilot_max', p_max));
end;
$$;

-- ---------------------------------------------------------------------------
-- Full run (redefined: only after a signed-off pilot)
-- ---------------------------------------------------------------------------

-- Latest definition: 20261019208100_migration_import.sql. Changed: a 'checked' batch is refused
-- (the pilot starts the import now); a batch whose pilot is not signed off is refused; the staged
-- rows are checked against the upload checksum; the plan is not evaluated again (the pilot's own
-- records would read as duplicates), but the dry run's hash must still be the one the page shows.
-- A batch begun before pilots existed (no pilot_size) continues as it did.
create or replace function public.begin_migration_commit(p_org uuid, p_batch uuid, p_plan_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.migration_batches%rowtype;
  v_sample boolean;
  remaining integer;
begin
  perform app.migration_owner(p_org, true);
  select * into b from public.migration_batches where id = p_batch and organization_id = p_org for update;
  if b.id is null then
    raise exception 'migration batch not found' using errcode = 'P0002';
  end if;
  if b.status in ('staged', 'checked') then
    raise exception 'run a pilot first: the full import waits for the firm owner''s sign-off of the pilot' using errcode = '22023';
  end if;
  if b.status <> 'committing' then
    raise exception 'this import is not being committed' using errcode = '22023';
  end if;
  if b.pilot_size is not null and b.pilot_signed_off_at is null then
    raise exception 'the pilot needs the firm owner''s sign-off before the full import' using errcode = '22023';
  end if;
  if p_plan_hash is distinct from b.plan_hash then
    perform app.record_audit_event(p_org, 'migration.commit_refused', 'public.migration_batches', p_batch, 'denied', jsonb_build_object('reason', 'plan changed'));
    return jsonb_build_object('ok', false, 'reason', 'plan_changed');
  end if;
  select org.sample_mode into v_sample from public.organizations org where org.id = p_org;
  if coalesce(v_sample, false) is distinct from b.is_sample then
    raise exception 'sample mode changed since the upload; upload the file again' using errcode = '22023';
  end if;
  if not app.migration_staged_intact(p_batch) then
    perform app.record_audit_event(p_org, 'migration.commit_refused', 'public.migration_batches', p_batch, 'denied', jsonb_build_object('reason', 'staged rows changed'));
    return jsonb_build_object('ok', false, 'reason', 'checksum_changed');
  end if;
  select count(*) into remaining from public.migration_rows
  where batch_id = p_batch and is_applicant and plan in ('create', 'link') and matter_id is null;
  if b.full_run_started_at is null then
    update public.migration_batches set
      full_run_started_at = now(),
      full_run_started_by = (select auth.uid()),
      commit_verified_at = now()
    where id = p_batch;
    perform app.record_audit_event(p_org, 'migration.commit_started', 'public.migration_batches', p_batch, 'success',
      coalesce(b.plan_counts, '{}'::jsonb) || jsonb_build_object('remaining_matters', remaining, 'checksum_verified', true, 'pilot_size', b.pilot_size));
  end if;
  return jsonb_build_object('ok', true, 'matters', remaining);
end;
$$;

-- Latest definition: 20261019208100_migration_import.sql. Changed: during a pilot only the pilot's
-- matters are returned, and once the pilot is done nothing more is created until its sign-off and
-- the full run's start.
create or replace function app.migration_next_groups(p_org uuid, p_batch uuid, p_limit integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.migration_batches%rowtype;
  result jsonb;
  pilot_only boolean;
begin
  perform app.migration_owner(p_org, true);
  select * into b from public.migration_batches where id = p_batch and organization_id = p_org for update;
  if b.id is null or b.status <> 'committing' then
    raise exception 'this import is not being committed' using errcode = '22023';
  end if;
  pilot_only := b.pilot_size is not null and b.full_run_started_at is null;
  if pilot_only and b.pilot_completed_at is not null then
    raise exception 'the pilot needs the firm owner''s sign-off before the full import' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'first', a.group_first, 'row', a.row_number, 'plan', a.plan, 'sample', b.is_sample,
    'name', a.normalized ->> 'name', 'email', a.normalized ->> 'email',
    'date_of_birth', a.normalized ->> 'date_of_birth', 'title', coalesce(a.normalized ->> 'title', a.normalized ->> 'name'),
    'consultant', a.normalized ->> 'consultant', 'program_pack_id', a.normalized ->> 'program_pack_id'
  ) order by a.group_first), '[]'::jsonb)
  into result
  from (
    select * from public.migration_rows
    where batch_id = p_batch and is_applicant and plan in ('create', 'link') and matter_id is null
      and (not pilot_only or in_pilot)
    order by group_first
    limit greatest(1, least(coalesce(p_limit, 25), 100))
  ) a;
  return result;
end;
$$;

-- Latest definition: 20261019208100_migration_import.sql. Changed: a pilot ends when its matters
-- exist (pilot_completed_at, pilot_counts, audited) and the batch waits for sign-off; at the end of
-- the full run the run report is written before the staging rows are purged. The totals check and
-- the exception report are unchanged.
create or replace function app.migration_after_chunk(p_org uuid, p_batch uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.migration_batches%rowtype;
  remaining integer;
  created_matters integer;
  created_persons integer;
  linked_persons integer;
  report jsonb;
  n integer;
  kinds jsonb;
  row_counts jsonb;
  run jsonb;
begin
  perform app.migration_owner(p_org, true);
  select * into b from public.migration_batches where id = p_batch and organization_id = p_org for update;
  if b.id is null or b.status <> 'committing' then
    raise exception 'this import is not being committed' using errcode = '22023';
  end if;
  update public.migration_batches set references_at_import = app.migration_reference_counts(p_batch) where id = p_batch;

  -- The pilot: done when its matters exist; then the batch waits for the firm owner's sign-off.
  if b.pilot_size is not null and b.full_run_started_at is null then
    select count(*) into remaining from public.migration_rows
    where batch_id = p_batch and in_pilot and is_applicant and plan in ('create', 'link') and matter_id is null;
    if remaining > 0 then
      return jsonb_build_object('remaining', remaining, 'status', 'committing', 'phase', 'pilot');
    end if;
    if b.pilot_completed_at is null then
      select count(*) filter (where record_table = 'matters' and created),
             count(*) filter (where record_table = 'persons' and created),
             count(*) filter (where record_table = 'persons' and not created)
      into created_matters, created_persons, linked_persons
      from public.migration_records where batch_id = p_batch;
      update public.migration_batches set
        pilot_completed_at = now(),
        pilot_counts = jsonb_build_object('matters', created_matters, 'people_created', created_persons, 'people_linked', linked_persons)
      where id = p_batch;
      perform app.record_audit_event(p_org, 'migration.pilot_completed', 'public.migration_batches', p_batch, 'success',
        jsonb_build_object('matters', created_matters, 'people_created', created_persons, 'people_linked', linked_persons, 'pilot_size', b.pilot_size));
    end if;
    return jsonb_build_object('remaining', 0, 'status', 'pilot_done', 'phase', 'pilot');
  end if;

  select count(*) into remaining from public.migration_rows
  where batch_id = p_batch and is_applicant and plan in ('create', 'link') and matter_id is null;
  if remaining > 0 then
    return jsonb_build_object('remaining', remaining, 'status', 'committing');
  end if;

  select count(*) filter (where record_table = 'matters' and created),
         count(*) filter (where record_table = 'persons' and created),
         count(*) filter (where record_table = 'persons' and not created)
  into created_matters, created_persons, linked_persons
  from public.migration_records where batch_id = p_batch;
  if created_matters is distinct from (b.plan_counts ->> 'matters')::integer
     or created_persons is distinct from (b.plan_counts ->> 'create')::integer then
    raise exception 'record totals don''t match the dry run (% matters, % people created)', created_matters, created_persons using errcode = 'P0001';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'row', mr.row_number, 'column', p ->> 'column',
    'problem', regexp_replace(p ->> 'problem', '“[^”]*”', '(value)', 'g'), 'fix', p ->> 'fix'
  ) order by mr.row_number), '[]'::jsonb)
  into report
  from public.migration_rows mr
  cross join lateral jsonb_array_elements(mr.problems) p
  where mr.batch_id = p_batch and mr.plan in ('review', 'error', 'skip');

  -- The run report (MIG-02): counts and checksums only, never cell values.
  select coalesce(jsonb_object_agg(k.record_table, jsonb_build_object('created', k.created, 'linked', k.linked)), '{}'::jsonb)
  into kinds
  from (
    select record_table, count(*) filter (where created) as created, count(*) filter (where not created) as linked
    from public.migration_records where batch_id = p_batch
    group by record_table
  ) k;
  select jsonb_build_object(
    'rows', count(*),
    'imported', count(*) filter (where plan in ('create', 'link')),
    'created', count(*) filter (where plan = 'create'),
    'linked', count(*) filter (where plan = 'link'),
    'duplicates_found', count(*) filter (where match_person_id is not null or match_row_number is not null),
    'duplicates_same', count(*) filter (where decision = 'same'),
    'duplicates_different', count(*) filter (where decision = 'different'),
    'review', count(*) filter (where plan = 'review'),
    'error', count(*) filter (where plan = 'error'),
    'skipped', count(*) filter (where plan = 'skip'),
    'exception_lines', jsonb_array_length(report)
  )
  into row_counts
  from public.migration_rows where batch_id = p_batch;
  run := jsonb_build_object(
    'generated_at', now(),
    'source', jsonb_build_object(
      'file_name', b.file_name, 'source_system', b.source_system, 'bytes', b.byte_size,
      'rows_in_file', b.source_row_count, 'rows_staged', b.staged_row_count,
      'sha256', b.source_sha256, 'staged_digest', b.staged_digest,
      'verified_at_upload', b.verified_at, 'verified_at_commit', b.commit_verified_at,
      'checksum_matches', true
    ),
    'plan', b.plan_counts,
    'records', kinds,
    'totals', jsonb_build_object('matters', created_matters, 'people_created', created_persons, 'people_linked', linked_persons),
    'rows', row_counts,
    'pilot', case when b.pilot_size is null then null else jsonb_build_object(
      'size', b.pilot_size, 'counts', b.pilot_counts, 'completed_at', b.pilot_completed_at,
      'signed_off_at', b.pilot_signed_off_at, 'signed_off_by', b.pilot_signed_off_by, 'note', b.pilot_signoff_note
    ) end,
    'full_run_started_at', b.full_run_started_at
  );

  update public.migration_batches set
    status = 'committed',
    committed_at = now(),
    result_counts = jsonb_build_object('matters', created_matters, 'people_created', created_persons, 'people_linked', linked_persons,
                                       'not_imported', (b.plan_counts ->> 'problem_rows')::integer, 'rows', b.source_row_count),
    exceptions = report,
    run_report = run
  where id = p_batch;
  n := app.migration_purge_staging(p_batch);
  perform app.record_audit_event(p_org, 'migration.committed', 'public.migration_batches', p_batch, 'success',
    jsonb_build_object('matters', created_matters, 'people_created', created_persons, 'people_linked', linked_persons,
                       'not_imported', (b.plan_counts ->> 'problem_rows')::integer, 'sha256', b.source_sha256, 'staging_rows_purged', n,
                       'pilot_size', b.pilot_size));
  return jsonb_build_object('remaining', 0, 'status', 'committed');
end;
$$;

-- The firm owner downloads a finished import's run report (CSV or PDF): audited before the file is
-- drawn; a refusal means no file.
create function public.record_migration_report_download(p_org uuid, p_batch uuid, p_format text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.migration_owner(p_org, false);
  if p_format is null or p_format not in ('csv', 'pdf') then
    raise exception 'choose csv or pdf' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.migration_batches
    where id = p_batch and organization_id = p_org and status = 'committed' and run_report is not null
  ) then
    raise exception 'migration batch not found' using errcode = 'P0002';
  end if;
  perform app.record_audit_event(p_org, 'migration.report_downloaded', 'public.migration_batches', p_batch, 'success',
    jsonb_build_object('format', p_format));
end;
$$;

-- ---------------------------------------------------------------------------
-- Imported provenance, for every staff page that shows imported records
-- ---------------------------------------------------------------------------

-- Where these records came from, for staff of the firm (MFA): the source system, when they were
-- imported, the original date the file gave (if any) and the old reference. Only records an import
-- of this firm created or linked and that are still there (not rolled back). No cell values.
create function public.imported_record_provenance(p_org uuid, p_table text, p_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if p_org is null or p_org is distinct from app.current_organization_id()
     or not app.is_org_staff(p_org) or not app.staff_mfa_satisfied() then
    raise exception 'staff access denied' using errcode = '42501';
  end if;
  if p_table is null or p_table !~ '^[a-z_]{1,63}$' or p_ids is null or cardinality(p_ids) > 500 then
    raise exception 'ask for up to 500 records of one table' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', x.record_id, 'system', x.source_system, 'imported_at', x.imported_at,
    'original_at', x.original_at, 'reference', x.source_reference, 'created', x.created,
    'version_at_import', x.version_at_import
  ) order by x.record_id), '[]'::jsonb)
  into result
  from (
    select distinct on (r.record_id) r.record_id, b.source_system, r.created_at as imported_at, r.original_at,
           r.source_reference, r.created, r.version_at_import
    from public.migration_records r
    join public.migration_batches b on b.id = r.batch_id
    where r.organization_id = p_org and b.organization_id = p_org
      and r.record_table = p_table and r.record_id = any(p_ids)
      and r.removed_at is null and b.status in ('committing', 'committed')
    order by r.record_id, r.created desc, r.created_at
  ) x;
  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke all on function public.begin_migration_pilot(uuid, uuid, text, integer, text) from public, anon;
revoke all on function public.sign_off_migration_pilot(uuid, uuid, text) from public, anon;
revoke all on function public.set_migration_pilot_max(uuid, integer) from public, anon;
revoke all on function public.imported_record_provenance(uuid, text, uuid[]) from public, anon;
revoke all on function public.record_migration_report_download(uuid, uuid, text) from public, anon;
revoke all on function public.begin_migration_commit(uuid, uuid, text) from public, anon;
revoke all on function app.migration_next_groups(uuid, uuid, integer) from public, anon;
revoke all on function app.migration_after_chunk(uuid, uuid) from public, anon;

grant execute on function public.begin_migration_pilot(uuid, uuid, text, integer, text) to authenticated;
grant execute on function public.sign_off_migration_pilot(uuid, uuid, text) to authenticated;
grant execute on function public.set_migration_pilot_max(uuid, integer) to authenticated;
grant execute on function public.imported_record_provenance(uuid, text, uuid[]) to authenticated;
grant execute on function public.record_migration_report_download(uuid, uuid, text) to authenticated;
grant execute on function public.begin_migration_commit(uuid, uuid, text) to authenticated;
grant execute on function app.migration_next_groups(uuid, uuid, integer) to authenticated;
grant execute on function app.migration_after_chunk(uuid, uuid) to authenticated;
