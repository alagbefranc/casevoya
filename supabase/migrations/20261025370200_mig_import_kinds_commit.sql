-- MIG-01 (gap #187): committing and rolling back the new import kinds, and opening-balance review.
-- Additive. New functions, and these redefinitions (each
-- copied from its latest definition with only the change named):
--
-- * app.migration_purge_staging (latest: 20261019208100_migration_import.sql): also removes the
--   batch's migration_files rows (a documents import's ZIP entries).
-- * app.migration_rollback_blockers (latest: 20261019208100_migration_import.sql): a batch of
--   another kind is checked by the new app.migration_rollback_blockers_kind. Clients unchanged.
-- * public.rollback_migration_batch (latest: 20261019208100_migration_import.sql): a batch of
--   another kind is removed by the new app.migration_rollback_kind. Clients unchanged.
-- * app.reject_message_change (latest: 20261019203100_matter_messaging.sql): a DELETE of a
--   matter_staff_notes row is allowed only inside rollback_migration_batch, for a note that batch
--   created (app.migration_rollback_deletes_record). Every other change is still refused.
--
-- Sign-off is unchanged: public.begin_migration_commit (firm owner + step-up, the plan hash must
-- match) moves any batch to committing. Then a clients batch is committed by
-- public.commit_migration_chunk, and any other kind by public.commit_migration_kind_chunk here. A
-- documents batch's files are stored by the app through the existing upload path (one
-- public.create_upload_intent per file, the bytes put in storage, the server's checks and
-- public.finish_verified_document_upload), then public.record_migration_document ties each file to
-- its row; commit_migration_kind_chunk then finishes the batch. Rows are taken through
-- app.migration_next_groups, as matters are (each row of another kind is its own group, flagged
-- is_applicant), and a committed row's migration_rows.matter_id holds the record it became, so
-- MIG-02's pilot gates there apply to every kind; while a pilot runs, app.migration_kind_after_chunk
-- hands the pilot's end to app.migration_after_chunk. Each record's migration_records row has its
-- own table as record_table and original_at (the file's date, at the firm's midnight), which
-- MIG-02's public.imported_record_provenance reads for "Imported from <system> on <date>".
--
-- Opening balances: an import creates them pending review. public.review_opening_balance (billing
-- staff of the matter: the firm owner or its assigned finance user, with a fresh step-up) approves
-- or rejects one. The importer reviewing their own balance needs a step-up taken after the import
-- (as for a credit note). Approval records the decision: nothing is posted to an invoice or to a
-- client-account (trust) ledger, and nothing is reconciled automatically.

-- True only inside rollback_migration_batch, for a record of that table the batch created.
create function app.migration_rollback_deletes_record(p_table text, p_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v text := coalesce(current_setting('app.migration_rollback', true), '');
begin
  if v !~ '^[0-9a-f-]{36}$' then
    return false;
  end if;
  return exists (
    select 1
    from public.migration_records r
    join public.migration_batches b on b.id = r.batch_id
    where r.batch_id = v::uuid and r.record_table = p_table and r.record_id = p_id and r.created
      and r.removed_at is null and b.status in ('committed', 'committing')
  );
end;
$$;
revoke all on function app.migration_rollback_deletes_record(text, uuid) from public, anon, authenticated;

-- An original date from the file as a time: the start of that day in the firm's timezone.
create function app.migration_firm_midnight(p_org uuid, p_day date)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_day is null then null else
    (p_day::timestamp) at time zone app.usable_timezone(coalesce((select o.timezone from public.organizations o where o.id = p_org), 'America/Toronto'))
  end;
$$;
revoke all on function app.migration_firm_midnight(uuid, date) from public, anon, authenticated;

create or replace function app.reject_message_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Only a rollback sets app.migration_rollback; nothing else reaches the check.
  if tg_op = 'DELETE' and tg_table_name = 'matter_staff_notes'
     and coalesce(current_setting('app.migration_rollback', true), '') <> '' then
    if app.migration_rollback_deletes_record('matter_staff_notes', old.id) then
      return old;
    end if;
  end if;
  raise exception '% is append-only (% rejected)', tg_table_name, tg_op using errcode = '42501';
end;
$$;
revoke all on function app.reject_message_change() from public;

create or replace function app.migration_purge_staging(p_batch uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  delete from public.migration_rows where batch_id = p_batch;
  get diagnostics n = row_count;
  delete from public.migration_files where batch_id = p_batch;
  update public.migration_batches set staging_purged_at = now() where id = p_batch and staging_purged_at is null;
  return n;
end;
$$;
revoke all on function app.migration_purge_staging(uuid) from public, anon, authenticated;

-- How many rows in other tables point at the records a non-client batch created, by table and
-- column. Taken after every commit chunk; a rollback refuses when any count grew.
create function app.migration_kind_reference_counts(p_batch uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t record;
  fk record;
  n bigint;
  result jsonb := '{}'::jsonb;
begin
  for t in
    select record_table, array_agg(record_id) as ids
    from public.migration_records
    where batch_id = p_batch and created and removed_at is null
      and record_table not in ('matters', 'persons')
    group by record_table
  loop
    for fk in
      select c.conrelid::regclass::text as tbl, a.attname::text as col
      from pg_catalog.pg_constraint c
      cross join lateral unnest(c.conkey, c.confkey) as k(conk, confk)
      join pg_catalog.pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.conk
      join pg_catalog.pg_attribute fa on fa.attrelid = c.confrelid and fa.attnum = k.confk
      where c.contype = 'f' and c.confrelid = ('public.' || t.record_table)::regclass and fa.attname = 'id'
      order by 1, 2
    loop
      execute format('select count(*) from %s where %I = any($1)', fk.tbl, fk.col) into n using t.ids;
      if n > 0 then
        result := result || jsonb_build_object(fk.tbl || '.' || fk.col, n);
      end if;
    end loop;
  end loop;
  return result;
end;
$$;
revoke all on function app.migration_kind_reference_counts(uuid) from public, anon, authenticated;

-- After each chunk of a non-client batch: the reference baseline; after the last: verification
-- against the plan, the exception report, the committed status, and the staging purge.
create function app.migration_kind_after_chunk(p_org uuid, p_batch uuid)
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
begin
  select * into b from public.migration_batches where id = p_batch and organization_id = p_org for update;
  if b.id is null or b.status <> 'committing' then
    raise exception 'this import is not being committed' using errcode = '22023';
  end if;
  -- MIG-02's pilot (its columns exist once 20261025380000 is applied; read by name so this works
  -- with or without them): while a pilot runs, its end and sign-off are app.migration_after_chunk's.
  if (to_jsonb(b) ->> 'pilot_size') is not null and (to_jsonb(b) ->> 'full_run_started_at') is null then
    return app.migration_after_chunk(p_org, p_batch);
  end if;
  update public.migration_batches set references_at_import = app.migration_kind_reference_counts(p_batch) where id = p_batch;
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
  update public.migration_batches set
    status = 'committed',
    committed_at = now(),
    result_counts = jsonb_build_object('kind', b.kind, 'records_created', created_n, 'records_linked', linked_n,
                                       'files_held', held_n, 'not_imported', (b.plan_counts ->> 'problem_rows')::integer,
                                       'rows', b.source_row_count),
    exceptions = report || held
  where id = p_batch;
  n := app.migration_purge_staging(p_batch);
  perform app.record_audit_event(p_org, 'migration.committed', 'public.migration_batches', p_batch, 'success',
    jsonb_build_object('kind', b.kind, 'records_created', created_n, 'records_linked', linked_n, 'files_held', held_n,
                       'not_imported', (b.plan_counts ->> 'problem_rows')::integer, 'sha256', b.source_sha256,
                       'staging_rows_purged', n));
  return jsonb_build_object('remaining', 0, 'status', 'committed');
end;
$$;
revoke all on function app.migration_kind_after_chunk(uuid, uuid) from public, anon, authenticated;

-- Commits the next rows of a non-client batch (after begin_migration_commit). A linked row creates
-- nothing; a created row is written with the same checks as the screens that create that record.
-- A documents batch's files are created by the app (see record_migration_document); here only its
-- linked rows are recorded, and the batch finishes once every file is recorded.
create function public.commit_migration_kind_chunk(p_org uuid, p_batch uuid, p_limit integer default 50)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.migration_batches%rowtype;
  r public.migration_rows%rowtype;
  m public.matters%rowtype;
  actor uuid := (select auth.uid());
  me uuid;
  zone text;
  v_id uuid;
  v_version integer;
  v_target uuid;
  v_table text;
  done integer := 0;
  g jsonb;
begin
  perform app.migration_owner(p_org, true);
  select * into b from public.migration_batches where id = p_batch and organization_id = p_org for update;
  if b.id is null then
    raise exception 'migration batch not found' using errcode = 'P0002';
  end if;
  if b.status <> 'committing' then
    raise exception 'this import is not being committed' using errcode = '22023';
  end if;
  if b.kind = 'clients_matters' then
    raise exception 'this import creates matters; commit it with commit_migration_chunk' using errcode = '22023';
  end if;
  select mem.id into me from public.memberships mem
  where mem.organization_id = p_org and mem.user_id = actor and mem.status = 'active'
  order by mem.created_at limit 1;
  select app.usable_timezone(coalesce(o.timezone, 'America/Toronto')) into zone from public.organizations o where o.id = p_org;
  v_table := case b.kind
    when 'relationships' then 'person_relationships' when 'notes' then 'matter_staff_notes' when 'tasks' then 'tasks'
    when 'key_dates' then 'deadlines' when 'documents' then 'documents' else 'opening_balances' end;

  -- The rows come from app.migration_next_groups, as matters do, so its gates (a pilot's rows only
  -- during a pilot, nothing more until the pilot is signed off) apply to every kind.
  for g in select value from jsonb_array_elements(app.migration_next_groups(p_org, p_batch, greatest(1, least(coalesce(p_limit, 50), 100)))) loop
    select * into r from public.migration_rows where batch_id = p_batch and row_number = (g ->> 'row')::integer;
    continue when r.id is null or r.committed_at is not null or (b.kind = 'documents' and r.plan = 'create');
    if r.plan = 'link' then
      if r.decision_target like 'record:%' then
        v_target := split_part(r.decision_target, ':', 2)::uuid;
        insert into public.migration_records (organization_id, batch_id, record_table, record_id, created, row_number, version_at_import, original_at)
        values (p_org, p_batch, v_table, v_target, false, r.row_number, 1, app.migration_firm_midnight(p_org, (r.normalized ->> 'original_on')::date));
      else
        select other.record_id into v_target from public.migration_rows other
        where other.batch_id = p_batch and other.row_number = split_part(r.decision_target, ':', 2)::integer;
      end if;
      if v_target is null then
        raise exception 'migration row %: the matched record is no longer there', r.row_number using errcode = '22023';
      end if;
      update public.migration_rows set record_id = v_target, matter_id = v_target, committed_at = now() where id = r.id;
      done := done + 1;
      continue;
    end if;

    v_id := null;
    v_version := 1;
    if b.kind in ('tasks', 'notes', 'key_dates', 'opening_balances') then
      select * into m from public.matters where id = (r.normalized ->> 'matter_id')::uuid and organization_id = p_org;
      if m.id is null or app.can_read_matter(m.id) is distinct from true then
        raise exception 'migration row %: the matter is no longer there', r.row_number using errcode = '22023';
      end if;
      if app.sample_mode_blocks_real(p_org, m.is_sample) then
        raise exception 'this firm is in sample mode; only sample matters accept new work' using errcode = '42501';
      end if;
    end if;

    if b.kind = 'tasks' then
      if not exists (
        select 1 from public.memberships mem
        where mem.id = (r.normalized ->> 'owner')::uuid and mem.organization_id = p_org and mem.status = 'active'
          and mem.role = any (app.staff_roles())
      ) then
        raise exception 'migration row %: an internal task needs an active staff owner', r.row_number using errcode = '42501';
      end if;
      -- No task_events row: the task's history before Casevoya is not invented here.
      insert into public.tasks (organization_id, matter_id, audience, title, priority, status, owner_membership_id,
                                due_on, due_timezone, completed_at)
      values (p_org, m.id, 'internal', r.normalized ->> 'title', (r.normalized ->> 'priority')::public.task_priority,
              (r.normalized ->> 'status')::public.task_status, (r.normalized ->> 'owner')::uuid,
              (r.normalized ->> 'due_on')::date, zone,
              case when r.normalized ->> 'status' = 'done' then statement_timestamp() end)
      returning id, version into v_id, v_version;
    elsif b.kind = 'notes' then
      if me is null then
        raise exception 'staff access denied' using errcode = '42501';
      end if;
      insert into public.matter_staff_notes (organization_id, matter_id, author_user_id, author_membership_id, body,
                                             original_author_name, original_written_on)
      values (p_org, m.id, actor, me, r.normalized ->> 'body', r.normalized ->> 'author', (r.normalized ->> 'original_on')::date)
      returning id into v_id;
    elsif b.kind = 'key_dates' then
      -- Through the deadline function, so its rules apply; imported dates stay tentative.
      v_id := app.record_deadline(m.id, null, (r.normalized ->> 'date_kind')::public.deadline_kind, r.normalized ->> 'label',
                                  null, null, (r.normalized ->> 'due_on')::date, null, zone, null, null, null, null, null);
      select d.version into v_version from public.deadlines d where d.id = v_id;
    elsif b.kind = 'relationships' then
      if not exists (select 1 from public.persons p where p.id = (r.normalized ->> 'person_id')::uuid and p.organization_id = p_org)
         or not exists (select 1 from public.persons p where p.id = (r.normalized ->> 'related_id')::uuid and p.organization_id = p_org) then
        raise exception 'migration row %: the person is no longer there', r.row_number using errcode = '22023';
      end if;
      insert into public.person_relationships (organization_id, from_person_id, to_person_id, relationship_type)
      values (p_org, (r.normalized ->> 'person_id')::uuid, (r.normalized ->> 'related_id')::uuid,
              (r.normalized ->> 'relationship')::public.person_relationship_type)
      returning id, version into v_id, v_version;
    elsif b.kind = 'opening_balances' then
      insert into public.opening_balances (organization_id, matter_id, kind, amount_cents, currency, as_of, description,
                                           source_system, batch_id, imported_by, is_sample)
      values (p_org, m.id, r.normalized ->> 'balance_kind', (r.normalized ->> 'amount_cents')::bigint, r.normalized ->> 'currency',
              (r.normalized ->> 'as_of')::date, r.normalized ->> 'description', b.source_system, p_batch, actor, m.is_sample)
      returning id, version into v_id, v_version;
    end if;

    update public.migration_rows set record_id = v_id, matter_id = v_id, committed_at = now() where id = r.id;
    insert into public.migration_records (organization_id, batch_id, record_table, record_id, created, row_number, version_at_import, original_at)
    values (p_org, p_batch, v_table, v_id, true, r.row_number, v_version, app.migration_firm_midnight(p_org, (r.normalized ->> 'original_on')::date));
    done := done + 1;
  end loop;
  return app.migration_kind_after_chunk(p_org, p_batch) || jsonb_build_object('done', done);
end;
$$;

-- The next files of a documents batch to store, with what the upload needs.
create function public.migration_document_rows(p_org uuid, p_batch uuid, p_limit integer default 10)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.migration_batches%rowtype;
  result jsonb;
begin
  perform app.migration_owner(p_org, true);
  select * into b from public.migration_batches where id = p_batch and organization_id = p_org;
  if b.id is null or b.status <> 'committing' or b.kind <> 'documents' then
    raise exception 'this import is not being committed' using errcode = '22023';
  end if;
  -- Through app.migration_next_groups, so a pilot's gates apply to files too.
  select coalesce(jsonb_agg(jsonb_build_object(
    'row', x.row_number, 'person_id', x.normalized ->> 'person_id', 'matter_id', x.normalized ->> 'matter_id',
    'purpose', x.normalized ->> 'purpose', 'file_path', x.normalized ->> 'file_path', 'file_name', x.normalized ->> 'file_name',
    'file_sha256', x.normalized ->> 'file_sha256', 'file_bytes', (x.normalized ->> 'file_bytes')::bigint
  ) order by x.row_number), '[]'::jsonb)
  into result
  from (
    select mr.* from public.migration_rows mr
    join jsonb_array_elements(app.migration_next_groups(p_org, p_batch, 100)) g on (g.value ->> 'row')::integer = mr.row_number
    where mr.batch_id = p_batch and mr.plan = 'create' and mr.committed_at is null
    order by mr.row_number
    limit greatest(1, least(coalesce(p_limit, 10), 50))
  ) x;
  return jsonb_build_object('zip_sha256', b.attachment_sha256, 'rows', result);
end;
$$;

-- Ties a stored file to its manifest row: the version must be the first of a new document this
-- owner uploaded for that row's person, linked to its matter, checked by the server, and hash to
-- the file the dry run read.
create function public.record_migration_document(p_org uuid, p_batch uuid, p_row integer, p_version uuid)
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

-- ---------------------------------------------------------------------------
-- Rollback of the new kinds
-- ---------------------------------------------------------------------------

create function app.migration_rollback_blockers_kind(p_batch uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.migration_batches%rowtype;
  reasons jsonb := '[]'::jsonb;
  rec record;
  now_counts jsonb;
  k text;
  v_before integer;
  v_after integer;
  what text;
begin
  select * into b from public.migration_batches where id = p_batch;
  if b.status not in ('committed', 'committing') then
    return jsonb_build_array('Only an imported batch can be rolled back.');
  end if;
  if b.kind = 'documents' then
    if exists (select 1 from public.migration_records where batch_id = p_batch and created and removed_at is null) then
      return jsonb_build_array('Imported documents are kept: Casevoya never deletes a document. Unlink a document from its matter instead.');
    end if;
  end if;
  what := case b.kind when 'tasks' then 'task' when 'notes' then 'note' when 'key_dates' then 'date'
    when 'relationships' then 'relationship' else 'opening balance' end;
  for rec in
    select r.row_number, r.record_id, r.version_at_import,
           coalesce(t.id, d.id, n.id, rel.id, ob.id) as found_id,
           coalesce(t.version, d.version, rel.version, ob.version, 1) as current_version,
           coalesce(t.matter_id, d.matter_id, n.matter_id, ob.matter_id) as matter_id,
           ob.status as balance_status
    from public.migration_records r
    left join public.tasks t on r.record_table = 'tasks' and t.id = r.record_id
    left join public.deadlines d on r.record_table = 'deadlines' and d.id = r.record_id
    left join public.matter_staff_notes n on r.record_table = 'matter_staff_notes' and n.id = r.record_id
    left join public.person_relationships rel on r.record_table = 'person_relationships' and rel.id = r.record_id
    left join public.opening_balances ob on r.record_table = 'opening_balances' and ob.id = r.record_id
    where r.batch_id = p_batch and r.created and r.removed_at is null
    order by r.row_number
  loop
    if rec.found_id is null then
      reasons := reasons || to_jsonb(format('The %s from row %s is no longer there.', what, rec.row_number));
    elsif rec.balance_status is not null and rec.balance_status <> 'pending_review' then
      reasons := reasons || to_jsonb(format('The opening balance from row %s was already reviewed.', rec.row_number));
    elsif rec.current_version <> rec.version_at_import then
      reasons := reasons || to_jsonb(format('The %s from row %s was changed after the import.', what, rec.row_number));
    elsif rec.matter_id is not null and app.matter_on_legal_hold(rec.matter_id) then
      reasons := reasons || to_jsonb(format('The %s from row %s is on a matter under a legal hold.', what, rec.row_number));
    end if;
  end loop;
  now_counts := app.migration_kind_reference_counts(p_batch);
  for k in select jsonb_object_keys(now_counts) loop
    v_before := coalesce((b.references_at_import ->> k)::integer, 0);
    v_after := (now_counts ->> k)::integer;
    if v_after > v_before then
      reasons := reasons || to_jsonb(format('%s new %s linked to imported records since the import.',
        v_after - v_before, replace(split_part(k, '.', 2), '_', ' ')));
    end if;
  end loop;
  return reasons;
end;
$$;
revoke all on function app.migration_rollback_blockers_kind(uuid) from public, anon, authenticated;

create function app.migration_rollback_kind(p_org uuid, p_batch uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ids uuid[];
  n integer := 0;
  total integer := 0;
  t text;
begin
  perform set_config('app.migration_rollback', p_batch::text, true);
  foreach t in array array['opening_balances', 'deadlines', 'tasks', 'person_relationships', 'matter_staff_notes'] loop
    select coalesce(array_agg(record_id), '{}') into ids
    from public.migration_records where batch_id = p_batch and created and removed_at is null and record_table = t;
    continue when cardinality(ids) = 0;
    execute format('delete from public.%I where id = any($1)', t) using ids;
    get diagnostics n = row_count;
    total := total + n;
  end loop;
  perform set_config('app.migration_rollback', '', true);
  return jsonb_build_object('records', total);
end;
$$;
revoke all on function app.migration_rollback_kind(uuid, uuid) from public, anon, authenticated;

create or replace function app.migration_rollback_blockers(p_batch uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.migration_batches%rowtype;
  reasons jsonb := '[]'::jsonb;
  rec record;
  now_counts jsonb;
  k text;
  v_before integer;
  v_after integer;
begin
  select * into b from public.migration_batches where id = p_batch;
  if b.kind is distinct from 'clients_matters' then
    return app.migration_rollback_blockers_kind(p_batch);
  end if;
  if b.status not in ('committed', 'committing') then
    return jsonb_build_array('Only an imported batch can be rolled back.');
  end if;
  for rec in
    select r.row_number, m.id, m.reference, m.version, r.version_at_import
    from public.migration_records r
    left join public.matters m on m.id = r.record_id
    where r.batch_id = p_batch and r.record_table = 'matters' and r.created and r.removed_at is null
    order by r.row_number
  loop
    if rec.id is null then
      reasons := reasons || to_jsonb(format('The matter from row %s is no longer there.', rec.row_number));
    else
      if rec.version <> rec.version_at_import then
        reasons := reasons || to_jsonb(format('Matter %s (row %s) was changed after the import.', coalesce(rec.reference, 'without a reference'), rec.row_number));
      end if;
      if app.matter_on_legal_hold(rec.id) then
        reasons := reasons || to_jsonb(format('Matter %s (row %s) is under a legal hold.', coalesce(rec.reference, 'without a reference'), rec.row_number));
      end if;
    end if;
  end loop;
  for rec in
    select r.row_number, p.id, p.version, p.user_id, r.version_at_import
    from public.migration_records r
    left join public.persons p on p.id = r.record_id
    where r.batch_id = p_batch and r.record_table = 'persons' and r.created and r.removed_at is null
    order by r.row_number
  loop
    if rec.id is null then
      reasons := reasons || to_jsonb(format('The person from row %s is no longer there.', rec.row_number));
    elsif rec.version <> rec.version_at_import then
      reasons := reasons || to_jsonb(format('The person from row %s was edited after the import.', rec.row_number));
    elsif rec.user_id is not null then
      reasons := reasons || to_jsonb(format('The person from row %s now has a portal login.', rec.row_number));
    end if;
  end loop;
  now_counts := app.migration_reference_counts(p_batch);
  for k in select jsonb_object_keys(now_counts) loop
    v_before := coalesce((b.references_at_import ->> k)::integer, 0);
    v_after := (now_counts ->> k)::integer;
    if v_after > v_before then
      reasons := reasons || to_jsonb(format('%s new %s linked to imported records since the import.',
        v_after - v_before, replace(split_part(k, '.', 2), '_', ' ')));
    end if;
  end loop;
  return reasons;
end;
$$;
revoke all on function app.migration_rollback_blockers(uuid) from public, anon, authenticated;

create or replace function public.rollback_migration_batch(p_org uuid, p_batch uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.migration_batches%rowtype;
  reasons jsonb;
  matter_ids uuid[];
  person_ids uuid[];
  k text;
  tbl text;
  col text;
  n_matters integer;
  n_persons integer;
  kind_result jsonb;
begin
  perform app.migration_owner(p_org, true);
  select * into b from public.migration_batches where id = p_batch and organization_id = p_org for update;
  if b.id is null then
    raise exception 'migration batch not found' using errcode = 'P0002';
  end if;
  reasons := app.migration_rollback_blockers(p_batch);
  if jsonb_array_length(reasons) > 0 then
    perform app.record_audit_event(p_org, 'migration.rollback_refused', 'public.migration_batches', p_batch, 'denied',
      jsonb_build_object('reasons', jsonb_array_length(reasons)));
    return jsonb_build_object('ok', false, 'reasons', reasons);
  end if;

  if b.kind <> 'clients_matters' then
    kind_result := app.migration_rollback_kind(p_org, p_batch);
    update public.migration_records set removed_at = now() where batch_id = p_batch and created and removed_at is null;
    update public.migration_batches set status = 'rolled_back', rolled_back_at = now(), rolled_back_by = (select auth.uid()) where id = p_batch;
    perform app.migration_purge_staging(p_batch);
    perform app.record_audit_event(p_org, 'migration.rolled_back', 'public.migration_batches', p_batch, 'success',
      jsonb_build_object('kind', b.kind, 'records_removed', kind_result -> 'records'));
    return jsonb_build_object('ok', true, 'records', kind_result -> 'records');
  end if;

  select coalesce(array_agg(record_id) filter (where record_table = 'matters'), '{}'),
         coalesce(array_agg(record_id) filter (where record_table = 'persons'), '{}')
  into matter_ids, person_ids
  from public.migration_records
  where batch_id = p_batch and created and removed_at is null;

  perform set_config('app.migration_rollback', p_batch::text, true);
  delete from public.matter_participants where matter_id = any(matter_ids) or person_id = any(person_ids);
  delete from public.matter_rule_bindings where matter_id = any(matter_ids);
  -- Anything else the creation itself wrote that points at the records (unchanged since import).
  for k in select jsonb_object_keys(b.references_at_import) loop
    tbl := split_part(k, '.', 1) || '.' || split_part(k, '.', 2);
    col := split_part(k, '.', 3);
    continue when tbl in ('public.matter_participants', 'public.matter_rule_bindings');
    execute format('delete from %s where %I = any($1) or %I = any($2)', tbl, col, col) using matter_ids, person_ids;
  end loop;
  delete from public.matters where id = any(matter_ids);
  get diagnostics n_matters = row_count;
  delete from public.persons where id = any(person_ids);
  get diagnostics n_persons = row_count;
  perform set_config('app.migration_rollback', '', true);

  update public.migration_records set removed_at = now() where batch_id = p_batch and created and removed_at is null;
  update public.migration_batches set status = 'rolled_back', rolled_back_at = now(), rolled_back_by = (select auth.uid()) where id = p_batch;
  perform app.migration_purge_staging(p_batch);
  perform app.record_audit_event(p_org, 'migration.rolled_back', 'public.migration_batches', p_batch, 'success',
    jsonb_build_object('matters_removed', n_matters, 'people_removed', n_persons));
  return jsonb_build_object('ok', true, 'matters', n_matters, 'people', n_persons);
end;
$$;

-- ---------------------------------------------------------------------------
-- Opening balance review (billing staff + step-up)
-- ---------------------------------------------------------------------------

create function public.review_opening_balance(p_org uuid, p_id uuid, p_approve boolean, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ob public.opening_balances%rowtype;
  actor uuid := (select auth.uid());
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if actor is null or p_org is null or p_org is distinct from app.current_organization_id() then
    raise exception 'billing access denied' using errcode = '42501';
  end if;
  select * into ob from public.opening_balances where id = p_id and organization_id = p_org for update;
  if ob.id is null or app.can_read_matter_billing(ob.matter_id) is distinct from true then
    raise exception 'billing access denied' using errcode = '42501';
  end if;
  if app.mfa_step_up_satisfied() is distinct from true then
    raise exception 'step-up is required' using errcode = '42501';
  end if;
  if p_approve is null then
    raise exception 'choose approve or reject' using errcode = '22023';
  end if;
  if ob.status <> 'pending_review' then
    raise exception 'this opening balance was already reviewed' using errcode = '22023';
  end if;
  if ob.imported_by = actor then
    if app.has_org_role(p_org, array['firm_owner']::public.org_role[]) is distinct from true then
      raise exception 'the importer cannot review their own opening balance' using errcode = '42501';
    end if;
    if app.mfa_step_up_satisfied(least(interval '15 minutes', statement_timestamp() - date_trunc('second', ob.created_at))) is distinct from true then
      raise exception 'step-up is required: reviewing a balance you imported needs a step-up after the import' using errcode = '42501';
    end if;
  end if;
  if not p_approve and (v_note is null or length(v_note) not between 3 and 500) then
    raise exception 'a reason is required' using errcode = '22023';
  end if;
  if v_note is not null and length(v_note) not between 3 and 500 then
    raise exception 'the note must be 3 to 500 characters' using errcode = '22023';
  end if;
  update public.opening_balances set
    status = case when p_approve then 'approved' else 'rejected' end,
    reviewed_by = actor,
    reviewed_at = now(),
    review_note = v_note
  where id = ob.id
  returning * into ob;
  perform app.record_audit_event(p_org, case when p_approve then 'opening_balance.approved' else 'opening_balance.rejected' end,
    'public.opening_balances', ob.id, 'success',
    jsonb_build_object('kind', ob.kind, 'amount_cents', ob.amount_cents, 'currency', ob.currency, 'matter_id', ob.matter_id,
                       'self_reviewed', ob.imported_by = actor));
  return jsonb_build_object('id', ob.id, 'status', ob.status);
end;
$$;

revoke all on function public.commit_migration_kind_chunk(uuid, uuid, integer) from public, anon;
revoke all on function public.migration_document_rows(uuid, uuid, integer) from public, anon;
revoke all on function public.record_migration_document(uuid, uuid, integer, uuid) from public, anon;
revoke all on function public.review_opening_balance(uuid, uuid, boolean, text) from public, anon;
grant execute on function public.commit_migration_kind_chunk(uuid, uuid, integer) to authenticated;
grant execute on function public.migration_document_rows(uuid, uuid, integer) to authenticated;
grant execute on function public.record_migration_document(uuid, uuid, integer, uuid) to authenticated;
grant execute on function public.review_opening_balance(uuid, uuid, boolean, text) to authenticated;
