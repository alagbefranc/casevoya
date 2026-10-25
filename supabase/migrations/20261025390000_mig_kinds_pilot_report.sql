-- MIG-01 with MIG-02 (gap #187): the new import kinds (relationships, notes, tasks, key dates,
-- documents, opening balances) get MIG-02's pilot end and run report. Additive only.
--
-- Order: this runs after 20261025380000_mig_pilot_signoff_report.sql because it reads and writes
-- the pilot and report columns that migration adds to migration_batches (pilot_size,
-- pilot_completed_at, pilot_counts, full_run_started_at, commit_verified_at, run_report) and
-- migration_rows.in_pilot, by name. MIG-01's own migrations (20261025385000 to 20261025385200)
-- don't need them and apply before it.
--
-- Redefines (each copied from its latest definition, 20261025385200_mig_import_kinds_commit.sql):
--   app.migration_kind_after_chunk  the pilot of a non-client batch ends here, counted in records
--                                   (it no longer hands that to app.migration_after_chunk, which
--                                   counts matters and people and would set the clients' reference
--                                   baseline, so a pilot of key dates or tasks couldn't be rolled
--                                   back); the reference baseline is the kind's own at every chunk;
--                                   at the end of the full run the run report is written (source
--                                   counts and checksums, record totals by kind, rows, the pilot
--                                   and its sign-off), as MIG-02 writes it for clients and matters.
--                                   The totals check, exceptions and result_counts are unchanged.
--   public.record_migration_document a file is tied to its row only as a pilot's file during the
--                                   pilot, and not at all between the pilot's end and the full
--                                   run (the same gate as app.migration_next_groups).
-- MIG-02's public.begin_migration_commit, app.migration_next_groups and app.migration_after_chunk
-- are not redefined: the new kinds go through them as they are.

create or replace function app.migration_kind_after_chunk(p_org uuid, p_batch uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.migration_batches%rowtype;
  remaining integer;
  created_n integer;
  linked_n integer;
  held_n integer := 0;
  report jsonb;
  held jsonb := '[]'::jsonb;
  n integer;
  kinds jsonb;
  row_counts jsonb;
  run jsonb;
begin
  select * into b from public.migration_batches where id = p_batch and organization_id = p_org for update;
  if b.id is null or b.status <> 'committing' then
    raise exception 'this import is not being committed' using errcode = '22023';
  end if;
  update public.migration_batches set references_at_import = app.migration_kind_reference_counts(p_batch) where id = p_batch;

  -- MIG-02's pilot: done when its records exist; then the batch waits for the firm owner's
  -- sign-off (app.migration_next_groups refuses every further row until the full run starts).
  if b.pilot_size is not null and b.full_run_started_at is null then
    select count(*) into remaining from public.migration_rows
    where batch_id = p_batch and in_pilot and is_applicant and plan in ('create', 'link') and matter_id is null;
    if remaining > 0 then
      return jsonb_build_object('remaining', remaining, 'status', 'committing', 'phase', 'pilot');
    end if;
    if b.pilot_completed_at is null then
      select count(*) into created_n from public.migration_records where batch_id = p_batch and created;
      select count(*) into linked_n from public.migration_rows where batch_id = p_batch and plan = 'link' and committed_at is not null;
      update public.migration_batches set
        pilot_completed_at = now(),
        pilot_counts = jsonb_build_object('kind', b.kind, 'matters', created_n + linked_n, 'records_created', created_n, 'records_linked', linked_n)
      where id = p_batch;
      perform app.record_audit_event(p_org, 'migration.pilot_completed', 'public.migration_batches', p_batch, 'success',
        jsonb_build_object('kind', b.kind, 'records_created', created_n, 'records_linked', linked_n, 'pilot_size', b.pilot_size));
    end if;
    return jsonb_build_object('remaining', 0, 'status', 'pilot_done', 'phase', 'pilot');
  end if;

  select count(*) into remaining from public.migration_rows
  where batch_id = p_batch and is_applicant and plan in ('create', 'link') and matter_id is null;
  if remaining > 0 then
    return jsonb_build_object('remaining', remaining, 'status', 'committing');
  end if;

  select count(*) into created_n from public.migration_records where batch_id = p_batch and created;
  select count(*) into linked_n from public.migration_rows where batch_id = p_batch and plan = 'link' and committed_at is not null;
  if created_n is distinct from (b.plan_counts ->> 'create')::integer or linked_n is distinct from (b.plan_counts ->> 'link')::integer then
    raise exception 'record totals don''t match the dry run (% created, % linked)', created_n, linked_n using errcode = 'P0001';
  end if;
  -- A file that didn't pass the upload checks is kept (documents are never deleted) and listed.
  if b.kind = 'documents' then
    select count(*), coalesce(jsonb_agg(jsonb_build_object(
      'row', rec.row_number, 'column', 'File',
      'problem', 'The file didn’t pass the upload checks (' || ver.upload_state::text || '), so it is held',
      'fix', 'Review it under the person’s documents'
    ) order by rec.row_number), '[]'::jsonb)
    into held_n, held
    from public.migration_records rec
    join public.documents doc on doc.id = rec.record_id
    join public.document_versions ver on ver.id = doc.current_version_id
    where rec.batch_id = p_batch and rec.record_table = 'documents' and rec.created
      and ver.upload_state not in ('clean', 'scanning');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'row', mr.row_number, 'column', p ->> 'column',
    'problem', regexp_replace(p ->> 'problem', '“[^”]*”', '(value)', 'g'), 'fix', p ->> 'fix'
  ) order by mr.row_number), '[]'::jsonb)
  into report
  from public.migration_rows mr
  cross join lateral jsonb_array_elements(mr.problems) p
  where mr.batch_id = p_batch and mr.plan in ('review', 'error', 'skip');

  -- The run report (MIG-02's shape, counted in records): counts and checksums only, never cell values.
  select coalesce(jsonb_object_agg(k.record_table, jsonb_build_object('created', k.created, 'linked', k.linked)), '{}'::jsonb)
  into kinds
  from (
    select record_table, count(*) filter (where created) as created, count(*) filter (where not created) as linked
    from public.migration_records where batch_id = p_batch
    group by record_table
  ) k;
  -- A linked row of a duplicate in this file writes no record of its own; it counts as linked.
  select jsonb_build_object(
    'rows', count(*),
    'imported', count(*) filter (where plan in ('create', 'link')),
    'created', count(*) filter (where plan = 'create'),
    'linked', count(*) filter (where plan = 'link'),
    'duplicates_found', count(*) filter (where match_record_id is not null or match_row_number is not null),
    'duplicates_same', count(*) filter (where decision = 'same'),
    'duplicates_different', count(*) filter (where decision = 'different'),
    'review', count(*) filter (where plan = 'review'),
    'error', count(*) filter (where plan = 'error'),
    'skipped', count(*) filter (where plan = 'skip'),
    'exception_lines', jsonb_array_length(report || held)
  )
  into row_counts
  from public.migration_rows where batch_id = p_batch;
  run := jsonb_build_object(
    'generated_at', now(),
    'kind', b.kind,
    'source', jsonb_build_object(
      'file_name', b.file_name, 'source_system', b.source_system, 'bytes', b.byte_size,
      'rows_in_file', b.source_row_count, 'rows_staged', b.staged_row_count,
      'sha256', b.source_sha256, 'staged_digest', b.staged_digest,
      'verified_at_upload', b.verified_at, 'verified_at_commit', b.commit_verified_at,
      'checksum_matches', true,
      'attachment_name', b.attachment_name, 'attachment_sha256', b.attachment_sha256, 'attachment_files', b.attachment_files
    ),
    'plan', b.plan_counts,
    'records', kinds,
    'totals', jsonb_build_object('records_created', created_n, 'records_linked', linked_n, 'files_held', held_n),
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
    result_counts = jsonb_build_object('kind', b.kind, 'records_created', created_n, 'records_linked', linked_n,
                                       'files_held', held_n, 'not_imported', (b.plan_counts ->> 'problem_rows')::integer,
                                       'rows', b.source_row_count),
    exceptions = report || held,
    run_report = run
  where id = p_batch;
  n := app.migration_purge_staging(p_batch);
  perform app.record_audit_event(p_org, 'migration.committed', 'public.migration_batches', p_batch, 'success',
    jsonb_build_object('kind', b.kind, 'records_created', created_n, 'records_linked', linked_n, 'files_held', held_n,
                       'not_imported', (b.plan_counts ->> 'problem_rows')::integer, 'sha256', b.source_sha256,
                       'staging_rows_purged', n, 'pilot_size', b.pilot_size));
  return jsonb_build_object('remaining', 0, 'status', 'committed');
end;
$$;
revoke all on function app.migration_kind_after_chunk(uuid, uuid) from public, anon, authenticated;

-- Latest definition: 20261025385200_mig_import_kinds_commit.sql. Changed: MIG-02's pilot gate
-- (only a pilot's file during the pilot; nothing between the pilot's end and the full run).
create or replace function public.record_migration_document(p_org uuid, p_batch uuid, p_row integer, p_version uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.migration_batches%rowtype;
  r public.migration_rows%rowtype;
  ver public.document_versions%rowtype;
  doc public.documents%rowtype;
begin
  perform app.migration_owner(p_org, true);
  select * into b from public.migration_batches where id = p_batch and organization_id = p_org for update;
  if b.id is null or b.status <> 'committing' or b.kind <> 'documents' then
    raise exception 'this import is not being committed' using errcode = '22023';
  end if;
  select * into r from public.migration_rows
  where batch_id = p_batch and row_number = p_row and plan = 'create' and committed_at is null
  for update;
  if r.id is null then
    raise exception 'this file is not waiting to be imported' using errcode = '22023';
  end if;
  if b.pilot_size is not null and b.full_run_started_at is null and (b.pilot_completed_at is not null or not r.in_pilot) then
    raise exception 'the pilot needs the firm owner''s sign-off before the full import' using errcode = '22023';
  end if;
  select * into ver from public.document_versions where id = p_version and organization_id = p_org;
  select * into doc from public.documents where id = ver.document_id and organization_id = p_org;
  if ver.id is null or doc.id is null
     or ver.created_by is distinct from (select auth.uid())
     or ver.version_number <> 1
     or doc.person_id is distinct from (r.normalized ->> 'person_id')::uuid
     or not exists (
       select 1 from public.document_matter_refs ref
       where ref.document_id = doc.id and ref.matter_id = (r.normalized ->> 'matter_id')::uuid and ref.removed_at is null
     )
     or exists (select 1 from public.migration_records rec where rec.record_table = 'documents' and rec.record_id = doc.id) then
    raise exception 'the file was not stored for this import' using errcode = '42501';
  end if;
  if ver.upload_state = 'uploading' then
    raise exception 'the file hasn''t been checked yet' using errcode = '22023';
  end if;
  if ver.checksum_sha256 is distinct from r.normalized ->> 'file_sha256' then
    raise exception 'the stored file doesn''t match the ZIP' using errcode = '22023';
  end if;
  update public.migration_rows set record_id = doc.id, matter_id = doc.id, committed_at = now() where id = r.id;
  insert into public.migration_records (organization_id, batch_id, record_table, record_id, created, row_number, version_at_import, original_at)
  values (p_org, p_batch, 'documents', doc.id, true, r.row_number, doc.version, app.migration_firm_midnight(p_org, (r.normalized ->> 'original_on')::date));
  return jsonb_build_object('document_id', doc.id, 'upload_state', ver.upload_state);
end;
$$;
revoke all on function public.record_migration_document(uuid, uuid, integer, uuid) from public, anon;
grant execute on function public.record_migration_document(uuid, uuid, integer, uuid) to authenticated;
