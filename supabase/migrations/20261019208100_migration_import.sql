-- Migration import (T044, PRD §25 MIG-01, MIG-02): a firm moving to Casevoya brings clients and
-- matters from a spreadsheet. Additive only.
--
-- Flow, all for the firm owner:
--   1. Upload. The app parses the CSV on the server (5 MB, 5,000 rows) and stages the batch:
--      file name, SHA-256 of the file, byte size, header row and the declared row count
--      (stage_migration_batch), then the parsed rows in chunks (append_migration_rows). Nothing
--      else of the file is kept. seal_migration_batch recomputes a digest over the staged rows and
--      compares it, and the row count, with what the parser saw (MIG-02 counts and checksums).
--   2. Map columns (save_migration_mapping): which column is which Casevoya field, the date order,
--      and which configured value each source value of program, stage, consultant, case manager
--      and role stands for. A value with no mapping is never guessed: its row is "needs review".
--   3. Dry run (run_migration_dry_run): app.migration_evaluate plans every row (create, link,
--      confirm, review, error, skip) with row-level problems, and stores counts and a plan hash.
--   4. Duplicate review (decide_migration_duplicate): a possible match is the same name plus a date
--      of birth, email or phone in common, or a date of birth and phone in common (the leads rule;
--      a shared email alone never matches). A person decides same person or different people;
--      nothing is merged, and the import waits until every possible match is decided.
--   5. Sign off (begin_migration_commit, firm owner + step-up): the plan is evaluated again and must
--      hash to the dry run's; then commit_migration_chunk creates matters in chunks through the
--      existing public.create_client_matter (or public.create_engaged_matter for sample firms and
--      for an applicant who is an existing client), so every business rule of New matter applies.
--      The last chunk verifies record totals against the plan, writes the exception report, and
--      purges the staging rows.
--   6. Roll back (rollback_migration_batch, firm owner + step-up): only records this batch created,
--      and only when none was changed since and nothing new points at them; otherwise it refuses
--      and lists why. All or nothing.
--
-- Staging rows (migration_rows) hold the parsed cells: forced RLS, firm owner only, purged on
-- commit, rollback or discard, and after the firm's staging period (migration_settings, default 30
-- days, 1 to 90) by app.purge_expired_migration_staging (daily where pg_cron exists). Every write is
-- a security definer function with an audit event that names ids and counts, never cell values.
-- Imported matters start at the stage New matter gives them; a mapped stage is kept on the import
-- record only (no stage is set without the stage rules). Sample firms import sample records.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.migration_settings (
  organization_id uuid primary key references public.organizations (id),
  staging_days integer not null default 30 check (staging_days between 1 and 90),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1)
);
comment on table public.migration_settings is
  'How long a firm''s migration staging rows are kept before they are purged (default 30 days).';
create index migration_settings_created_by_idx on public.migration_settings (created_by);

create table public.migration_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  file_name text not null check (length(btrim(file_name)) between 1 and 200),
  source_system text not null default 'spreadsheet' check (length(btrim(source_system)) between 1 and 120),
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  byte_size integer not null check (byte_size between 1 and 5242880),
  source_row_count integer not null check (source_row_count between 1 and 5000),
  parsed_digest text not null check (parsed_digest ~ '^[0-9a-f]{64}$'),
  staged_digest text check (staged_digest is null or staged_digest ~ '^[0-9a-f]{64}$'),
  staged_row_count integer not null default 0 check (staged_row_count >= 0),
  verified_at timestamptz,
  headers text[] not null check (cardinality(headers) between 1 and 100),
  mapping jsonb not null default '{}'::jsonb check (jsonb_typeof(mapping) = 'object'),
  status public.migration_batch_status not null default 'staged',
  is_sample boolean not null default false,
  plan_hash text check (plan_hash is null or plan_hash ~ '^[0-9a-f]{64}$'),
  plan_counts jsonb,
  checked_at timestamptz,
  commit_started_at timestamptz,
  committed_at timestamptz,
  committed_by uuid references auth.users (id),
  result_counts jsonb,
  exceptions jsonb not null default '[]'::jsonb check (jsonb_typeof(exceptions) = 'array'),
  references_at_import jsonb not null default '{}'::jsonb,
  rolled_back_at timestamptz,
  rolled_back_by uuid references auth.users (id),
  discarded_at timestamptz,
  purge_after timestamptz not null,
  staging_purged_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id)
);
comment on table public.migration_batches is
  'One uploaded migration file (T044): its checksum and counts, the column and value mapping, the dry-run plan, and what the commit created. Never the raw file.';
create index migration_batches_organization_idx on public.migration_batches (organization_id, created_at desc);
create unique index migration_batches_one_open_idx on public.migration_batches (organization_id)
  where status in ('staged', 'checked', 'committing');
create index migration_batches_committed_by_idx on public.migration_batches (committed_by);
create index migration_batches_rolled_back_by_idx on public.migration_batches (rolled_back_by);
create index migration_batches_created_by_idx on public.migration_batches (created_by);
create index migration_batches_purge_idx on public.migration_batches (purge_after) where staging_purged_at is null;

create table public.migration_rows (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  batch_id uuid not null,
  row_number integer not null check (row_number between 2 and 5001),
  cells text[] not null check (cardinality(cells) <= 100),
  row_sha256 text not null check (row_sha256 ~ '^[0-9a-f]{64}$'),
  normalized jsonb,
  problems jsonb not null default '[]'::jsonb check (jsonb_typeof(problems) = 'array'),
  plan public.migration_row_plan,
  group_key text,
  group_first integer,
  is_applicant boolean not null default false,
  match_person_id uuid,
  match_row_number integer,
  match_detail text[],
  decision text check (decision is null or decision in ('same', 'different')),
  decision_target text,
  decided_by uuid references auth.users (id),
  decided_at timestamptz,
  person_id uuid,
  matter_id uuid,
  committed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (batch_id, row_number),
  foreign key (batch_id, organization_id) references public.migration_batches (id, organization_id)
);
comment on table public.migration_rows is
  'Parsed staging rows of a migration batch (firm owner only). Purged on commit, rollback, discard, or after the firm''s staging period.';
create index migration_rows_batch_fk_idx on public.migration_rows (batch_id, organization_id);
create index migration_rows_organization_idx on public.migration_rows (organization_id);
create index migration_rows_decided_by_idx on public.migration_rows (decided_by);
create index migration_rows_group_idx on public.migration_rows (batch_id, group_first, row_number);
create index migration_rows_group_key_idx on public.migration_rows (batch_id, group_key);

create table public.migration_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  batch_id uuid not null,
  record_table text not null check (record_table in ('matters', 'persons')),
  record_id uuid not null,
  created boolean not null,
  row_number integer not null check (row_number between 2 and 5001),
  source_reference text check (source_reference is null or length(source_reference) <= 100),
  imported_stage public.matter_stage,
  version_at_import integer not null,
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (batch_id, organization_id) references public.migration_batches (id, organization_id)
);
comment on table public.migration_records is
  'Records a migration batch created (created = true) or linked to an existing client (created = false), with the version each had at import, the source reference and the source stage. Rollback removes only created, unchanged records.';
create unique index migration_records_created_idx on public.migration_records (record_table, record_id) where created;
create index migration_records_batch_fk_idx on public.migration_records (batch_id, organization_id);
create index migration_records_organization_idx on public.migration_records (organization_id);
create index migration_records_record_idx on public.migration_records (record_id);

create trigger migration_settings_touch before update on public.migration_settings
  for each row execute function app.touch_row();
create trigger migration_settings_stamp before insert on public.migration_settings
  for each row execute function app.stamp_created_by();
create trigger migration_batches_touch before update on public.migration_batches
  for each row execute function app.touch_row();
create trigger migration_batches_stamp before insert on public.migration_batches
  for each row execute function app.stamp_created_by();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- The firm owner of p_org, signed in with MFA (and a fresh step-up when p_step_up).
create function app.migration_owner(p_org uuid, p_step_up boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_org is null or p_org is distinct from app.current_organization_id() then
    raise exception 'staff access denied' using errcode = '42501';
  end if;
  if p_step_up then
    perform app.require_firm_owner_step_up(p_org);
  else
    perform app.require_active_staff(p_org, array['firm_owner']::public.org_role[], false);
  end if;
end;
$$;
revoke all on function app.migration_owner(uuid, boolean) from public, anon;

-- A source value as a mapping key: trimmed, spaces collapsed, lower case. Null when blank.
create function app.migration_key(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(lower(regexp_replace(btrim(coalesce(p_value, '')), '\s+', ' ', 'g')), '');
$$;
revoke all on function app.migration_key(text) from public, anon;
grant execute on function app.migration_key(text) to authenticated;

-- A name for duplicate matching: lower case letters and digits only, single spaces.
create function app.migration_name_key(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(btrim(regexp_replace(lower(coalesce(p_value, '')), '[^[:alnum:]]+', ' ', 'g')), '');
$$;
revoke all on function app.migration_name_key(text) from public, anon;

-- A phone number for duplicate matching: its last ten digits.
create function app.migration_phone_key(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(right(regexp_replace(coalesce(p_value, ''), '\D', '', 'g'), 10), '');
$$;
revoke all on function app.migration_phone_key(text) from public, anon;

-- A phone number in the international form persons.contact_phone takes (+ and 8 to 15 digits).
-- Only a number written with its country code (+, 00 or 011) or as 1 plus ten digits converts;
-- no country is assumed for a shorter number.
create function app.migration_phone(p_raw text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := btrim(coalesce(p_raw, ''));
  digits text := regexp_replace(coalesce(p_raw, ''), '\D', '', 'g');
  e164 text;
begin
  if v = '' or length(v) > 40 or v !~ '^[0-9+()./ -]+$' then
    return null;
  end if;
  if v like '+%' then
    e164 := '+' || digits;
  elsif digits like '011%' then
    e164 := '+' || substr(digits, 4);
  elsif digits like '00%' then
    e164 := '+' || substr(digits, 3);
  elsif length(digits) = 11 and digits like '1%' then
    e164 := '+' || digits;
  end if;
  if e164 is null or e164 !~ '^\+[1-9][0-9]{7,14}$' then
    return null;
  end if;
  return e164;
end;
$$;
revoke all on function app.migration_phone(text) from public, anon;

-- One cell by zero-based column index, trimmed with spaces collapsed. Null when blank or unmapped.
create function app.migration_cell(p_cells text[], p_index integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_index is null or p_index < 0 or p_index >= coalesce(cardinality(p_cells), 0) then null
    else nullif(regexp_replace(btrim(p_cells[p_index + 1]), '\s+', ' ', 'g'), '')
  end;
$$;
revoke all on function app.migration_cell(text[], integer) from public, anon;

-- A date of birth as written in the file. ISO (yyyy-mm-dd) always; otherwise day/month/year or
-- month/day/year as the owner chose. Null when it is not a real calendar date.
create function app.migration_date(p_raw text, p_order text)
returns date
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := btrim(coalesce(p_raw, ''));
  parts text[];
  y integer;
  m integer;
  d integer;
begin
  if v ~ '^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$' then
    parts := regexp_split_to_array(v, '[-/.]');
    y := parts[1]::integer;
    m := parts[2]::integer;
    d := parts[3]::integer;
  elsif v ~ '^\d{1,2}[-/.]\d{1,2}[-/.]\d{4}$' and p_order in ('dmy', 'mdy') then
    parts := regexp_split_to_array(v, '[-/.]');
    y := parts[3]::integer;
    if p_order = 'mdy' then
      m := parts[1]::integer;
      d := parts[2]::integer;
    else
      d := parts[1]::integer;
      m := parts[2]::integer;
    end if;
  else
    return null;
  end if;
  return make_date(y, m, d);
exception
  when others then
    return null;
end;
$$;
revoke all on function app.migration_date(text, text) from public, anon;
grant execute on function app.migration_date(text, text) to authenticated;

create function app.migration_problem(p_column text, p_problem text, p_fix text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object('column', p_column, 'problem', p_problem, 'fix', p_fix);
$$;
revoke all on function app.migration_problem(text, text, text) from public, anon;

-- How many rows in other tables point at this batch's created records, by table and column.
-- Taken at the end of every commit chunk; a rollback compares against it.
create function app.migration_reference_counts(p_batch uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  matter_ids uuid[];
  person_ids uuid[];
  fk record;
  n bigint;
  result jsonb := '{}'::jsonb;
begin
  select coalesce(array_agg(record_id) filter (where record_table = 'matters'), '{}'),
         coalesce(array_agg(record_id) filter (where record_table = 'persons'), '{}')
  into matter_ids, person_ids
  from public.migration_records
  where batch_id = p_batch and created and removed_at is null;
  for fk in
    select c.conrelid::regclass::text as tbl, a.attname::text as col, c.confrelid as ref
    from pg_catalog.pg_constraint c
    cross join lateral unnest(c.conkey, c.confkey) as k(conk, confk)
    join pg_catalog.pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.conk
    join pg_catalog.pg_attribute fa on fa.attrelid = c.confrelid and fa.attnum = k.confk
    where c.contype = 'f'
      and c.confrelid in ('public.matters'::regclass, 'public.persons'::regclass)
      and fa.attname = 'id'
    order by 1, 2
  loop
    if fk.ref = 'public.matters'::regclass then
      continue when cardinality(matter_ids) = 0;
      execute format('select count(*) from %s where %I = any($1)', fk.tbl, fk.col) into n using matter_ids;
    else
      continue when cardinality(person_ids) = 0;
      execute format('select count(*) from %s where %I = any($1)', fk.tbl, fk.col) into n using person_ids;
    end if;
    if n > 0 then
      result := result || jsonb_build_object(fk.tbl || '.' || fk.col, n);
    end if;
  end loop;
  return result;
end;
$$;
revoke all on function app.migration_reference_counts(uuid) from public, anon, authenticated;

-- Removes a batch's staging rows (the parsed cells).
create function app.migration_purge_staging(p_batch uuid)
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
  update public.migration_batches set staging_purged_at = now() where id = p_batch and staging_purged_at is null;
  return n;
end;
$$;
revoke all on function app.migration_purge_staging(uuid) from public, anon, authenticated;

-- Batches past their staging period: an unfinished one is discarded, and staging rows are purged.
-- A batch still committing is left alone (it can be rolled back). Runs daily, and on each upload.
create function app.purge_expired_migration_staging(p_org uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  b record;
  total integer := 0;
  n integer;
begin
  for b in
    select id, organization_id, status from public.migration_batches
    where staging_purged_at is null and purge_after <= now()
      and status <> 'committing'
      and (p_org is null or organization_id = p_org)
    for update
  loop
    if b.status in ('staged', 'checked') then
      update public.migration_batches set status = 'discarded', discarded_at = now() where id = b.id;
    end if;
    n := app.migration_purge_staging(b.id);
    total := total + n;
    insert into public.audit_log (organization_id, actor_user_id, actor_type, action, object_table, object_id, result, request_id, context)
    values (b.organization_id, (select auth.uid()), app.current_actor_type(), 'migration.staging_purged', 'public.migration_batches', b.id,
            'success', app.current_request_id(), jsonb_build_object('rows', n, 'reason', 'staging period ended'));
  end loop;
  return total;
end;
$$;
revoke all on function app.purge_expired_migration_staging(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Planning: one evaluation for the dry run and the commit
-- ---------------------------------------------------------------------------

-- Plans every staged row of a batch from its mapping and the firm's current records. Writes each
-- row's normalized values, problems and plan, and returns the counts and the plan hash. The dry
-- run stores the hash; the commit evaluates again and must get the same hash.
create function app.migration_evaluate(p_batch uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.migration_batches%rowtype;
  cols jsonb;
  vals jsonb;
  date_order text;
  default_consultant uuid;
  c_name integer;
  c_email integer;
  c_dob integer;
  c_phone integer;
  c_role integer;
  c_ref integer;
  c_title integer;
  c_program integer;
  c_stage integer;
  c_consultant integer;
  c_cm integer;
  r record;
  v_problems jsonb;
  v_matter_problems jsonb;
  has_error boolean;
  has_review boolean;
  v_name text;
  v_email text;
  v_dob_raw text;
  v_dob date;
  v_phone text;
  v_role_raw text;
  v_role text;
  v_ref text;
  v_title text;
  v_raw text;
  v_mapped text;
  v_pack uuid;
  v_stage text;
  v_consultant uuid;
  v_cm uuid;
  counts jsonb;
  hash text;
  roles constant text[] := array['applicant', 'dependant', 'sponsor', 'employer', 'guardian'];
  hdr text[];
  valid_consultants uuid[];
  valid_staff uuid[];
  valid_packs uuid[];
begin
  select * into b from public.migration_batches where id = p_batch for update;
  if b.id is null then
    raise exception 'migration batch not found' using errcode = 'P0002';
  end if;
  hdr := b.headers;
  cols := coalesce(b.mapping -> 'columns', '{}'::jsonb);
  vals := coalesce(b.mapping -> 'values', '{}'::jsonb);
  date_order := coalesce(b.mapping ->> 'date_order', 'dmy');
  default_consultant := nullif(b.mapping ->> 'default_consultant', '')::uuid;
  c_name := (cols ->> 'name')::integer;
  c_email := (cols ->> 'email')::integer;
  c_dob := (cols ->> 'date_of_birth')::integer;
  c_phone := (cols ->> 'phone')::integer;
  c_role := (cols ->> 'role')::integer;
  c_ref := (cols ->> 'reference')::integer;
  c_title := (cols ->> 'title')::integer;
  c_program := (cols ->> 'program')::integer;
  c_stage := (cols ->> 'stage')::integer;
  c_consultant := (cols ->> 'consultant')::integer;
  c_cm := (cols ->> 'case_manager')::integer;
  -- The firm's configured values, read once: active consultants and staff, published programs.
  select coalesce(array_agg(mem.id) filter (where mem.role in ('licensed_consultant', 'firm_owner')), '{}'),
         coalesce(array_agg(mem.id), '{}')
  into valid_consultants, valid_staff
  from public.memberships mem
  where mem.organization_id = b.organization_id and mem.status = 'active'
    and mem.role in ('licensed_consultant', 'case_manager', 'firm_owner');
  select coalesce(array_agg(pack.id), '{}') into valid_packs
  from public.rule_pack_versions pack
  where pack.status in ('published', 'review_due')
    and (pack.organization_id is null or pack.organization_id = b.organization_id);

  -- Pass 1: each row on its own.
  for r in select id, row_number, cells from public.migration_rows where batch_id = p_batch order by row_number loop
    v_problems := '[]'::jsonb;
    v_matter_problems := '[]'::jsonb;
    has_error := false;
    has_review := false;

    v_name := app.migration_cell(r.cells, c_name);
    if v_name is null then
      has_error := true;
      v_problems := v_problems || app.migration_problem(coalesce(hdr[c_name + 1], 'Name'), 'No name', 'Add the person’s name in your file');
    elsif length(v_name) > 200 then
      has_error := true;
      v_problems := v_problems || app.migration_problem(hdr[c_name + 1], 'The name is longer than 200 characters', 'Shorten it in your file');
    end if;

    v_email := lower(app.migration_cell(r.cells, c_email));
    if v_email is not null and (length(v_email) > 320 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then
      has_error := true;
      v_problems := v_problems || app.migration_problem(hdr[c_email + 1], format('“%s” isn’t an email address', left(v_email, 60)), 'Correct it or leave it blank');
      v_email := null;
    end if;

    v_dob_raw := app.migration_cell(r.cells, c_dob);
    v_dob := app.migration_date(v_dob_raw, date_order);
    if v_dob_raw is not null and v_dob is null then
      has_error := true;
      v_problems := v_problems || app.migration_problem(hdr[c_dob + 1], format('“%s” isn’t a real date', left(v_dob_raw, 40)), 'Correct the date or leave it unknown');
    elsif v_dob is not null and (v_dob > current_date or v_dob < date '1900-01-01') then
      has_error := true;
      v_problems := v_problems || app.migration_problem(hdr[c_dob + 1], 'The date of birth is in the future or before 1900', 'Correct the date or leave it unknown');
      v_dob := null;
    end if;

    v_raw := app.migration_cell(r.cells, c_phone);
    v_phone := app.migration_phone(v_raw);
    if v_raw is not null and v_phone is null then
      has_error := true;
      v_problems := v_problems || app.migration_problem(hdr[c_phone + 1], format('“%s” isn’t a phone number with a country code', left(v_raw, 40)), 'Write it like +1 416 555 0101, or leave it blank');
    end if;

    v_role := null;
    v_role_raw := app.migration_cell(r.cells, c_role);
    if v_role_raw is not null then
      v_mapped := vals -> 'role' ->> app.migration_key(v_role_raw);
      if v_mapped is null and app.migration_key(v_role_raw) = any(roles) then
        v_mapped := app.migration_key(v_role_raw);
      end if;
      if v_mapped is null or (v_mapped <> 'none' and not (v_mapped = any(roles))) then
        has_review := true;
        v_problems := v_problems || app.migration_problem(hdr[c_role + 1], format('Role “%s” isn’t mapped', left(v_role_raw, 60)), 'Choose its role on Map columns');
      elsif v_mapped <> 'none' then
        v_role := v_mapped;
      end if;
    end if;

    v_ref := app.migration_cell(r.cells, c_ref);
    if v_ref is not null and length(v_ref) > 100 then
      has_error := true;
      v_problems := v_problems || app.migration_problem(hdr[c_ref + 1], 'The reference is longer than 100 characters', 'Shorten it in your file');
      v_ref := left(v_ref, 100);
    end if;

    v_title := app.migration_cell(r.cells, c_title);
    if v_title is not null and length(v_title) > 200 then
      v_matter_problems := v_matter_problems || app.migration_problem(hdr[c_title + 1], 'The matter title is longer than 200 characters', 'Shorten it in your file');
    end if;

    -- Matter fields (they count only on the matter's applicant row; see pass 2).
    v_pack := null;
    v_raw := app.migration_cell(r.cells, c_program);
    if v_raw is not null then
      v_mapped := vals -> 'program' ->> app.migration_key(v_raw);
      if v_mapped is null then
        v_matter_problems := v_matter_problems || app.migration_problem(hdr[c_program + 1], format('Program “%s” isn’t one of your programs', left(v_raw, 60)), 'Map it to a published program, or choose not imported');
      elsif v_mapped <> 'none' then
        v_pack := case when v_mapped ~ '^[0-9a-f-]{36}$' and v_mapped::uuid = any(valid_packs) then v_mapped::uuid end;
        if v_pack is null then
          v_matter_problems := v_matter_problems || app.migration_problem(hdr[c_program + 1], format('Program “%s” is mapped to a program that isn’t published', left(v_raw, 60)), 'Map it to a published program, or choose not imported');
        end if;
      end if;
    end if;

    v_stage := null;
    v_raw := app.migration_cell(r.cells, c_stage);
    if v_raw is not null then
      v_mapped := vals -> 'stage' ->> app.migration_key(v_raw);
      if v_mapped is null or (v_mapped <> 'none' and not (v_mapped = any(enum_range(null::public.matter_stage)::text[]))) then
        v_matter_problems := v_matter_problems || app.migration_problem(hdr[c_stage + 1], format('Stage “%s” isn’t a Casevoya stage', left(v_raw, 60)), 'Map it to a stage, or choose not imported');
      elsif v_mapped <> 'none' then
        v_stage := v_mapped;
      end if;
    end if;

    v_consultant := null;
    v_raw := app.migration_cell(r.cells, c_consultant);
    if v_raw is not null then
      v_mapped := vals -> 'consultant' ->> app.migration_key(v_raw);
      if v_mapped is null or v_mapped !~ '^[0-9a-f-]{36}$' then
        v_matter_problems := v_matter_problems || app.migration_problem(hdr[c_consultant + 1], format('Consultant “%s” isn’t mapped to someone on your team', left(v_raw, 60)), 'Choose who is responsible on Map columns');
      else
        v_consultant := v_mapped::uuid;
      end if;
    else
      v_consultant := default_consultant;
      if v_consultant is null then
        v_matter_problems := v_matter_problems || app.migration_problem(coalesce(hdr[c_consultant + 1], 'Consultant'), 'No responsible consultant', 'Choose a default consultant on Map columns');
      end if;
    end if;
    if v_consultant is not null and not (v_consultant = any(valid_consultants)) then
      v_matter_problems := v_matter_problems || app.migration_problem(coalesce(hdr[c_consultant + 1], 'Consultant'), 'The chosen consultant isn’t an active licensed consultant', 'Choose an active licensed consultant on Map columns');
      v_consultant := null;
    end if;

    v_cm := null;
    v_raw := app.migration_cell(r.cells, c_cm);
    if v_raw is not null then
      v_mapped := vals -> 'case_manager' ->> app.migration_key(v_raw);
      if v_mapped = 'none' then
        v_cm := null;
      elsif v_mapped is null or v_mapped !~ '^[0-9a-f-]{36}$' or not (v_mapped::uuid = any(valid_staff)) then
        v_matter_problems := v_matter_problems || app.migration_problem(hdr[c_cm + 1], format('Case manager “%s” isn’t mapped to someone on your team', left(v_raw, 60)), 'Choose who manages it on Map columns, or choose not imported');
      else
        v_cm := v_mapped::uuid;
      end if;
    end if;

    update public.migration_rows set
      normalized = jsonb_build_object(
        'name', v_name, 'email', v_email, 'date_of_birth', v_dob, 'phone', v_phone, 'role', v_role,
        'role_given', v_role_raw is not null, 'reference', v_ref, 'title', left(v_title, 200),
        'program_pack_id', v_pack, 'stage', v_stage, 'consultant', v_consultant, 'case_manager', v_cm,
        'matter_problems', v_matter_problems,
        'name_key', app.migration_name_key(v_name), 'phone_key', app.migration_phone_key(v_phone)
      ),
      problems = v_problems,
      plan = case when has_error then 'error' when has_review then 'review' else 'create' end::public.migration_row_plan,
      group_key = case when v_ref is not null then 'ref:' || lower(v_ref) else 'row:' || r.row_number end,
      is_applicant = false,
      match_person_id = null,
      match_row_number = null,
      match_detail = null
    where id = r.id;
  end loop;

  -- Pass 2: matters. Rows sharing a reference are one matter; its applicant is the row whose role
  -- is applicant, or else the first row without a role. Matter fields count on that row only.
  update public.migration_rows mr set group_first = g.g_first
  from (
    select x.group_key, min(x.row_number) as g_first from public.migration_rows x where x.batch_id = p_batch group by x.group_key
  ) g
  where mr.batch_id = p_batch and mr.group_key = g.group_key;

  update public.migration_rows mr set is_applicant = true
  from (
    select distinct on (x.group_key) x.id
    from public.migration_rows x
    where x.batch_id = p_batch
      and (x.normalized ->> 'role' = 'applicant' or (x.normalized ->> 'role' is null and not (x.normalized ->> 'role_given')::boolean))
    order by x.group_key, coalesce(x.normalized ->> 'role' = 'applicant', false) desc, x.row_number
  ) a
  where mr.id = a.id;

  -- A matter with no row that can be its applicant: its first row stands for it, needing review.
  update public.migration_rows mr set
    is_applicant = true,
    plan = case when mr.plan = 'create' then 'review'::public.migration_row_plan else mr.plan end,
    problems = case when mr.plan = 'create'
      then mr.problems || app.migration_problem('Role', 'This matter has no applicant', 'Mark one person as the applicant')
      else mr.problems end
  from (
    select distinct on (x.group_key) x.id
    from public.migration_rows x
    where x.batch_id = p_batch
      and not exists (select 1 from public.migration_rows y where y.batch_id = p_batch and y.group_key = x.group_key and y.is_applicant)
    order by x.group_key, x.row_number
  ) f
  where mr.id = f.id;

  update public.migration_rows set
    plan = case when plan = 'error' then plan else 'review' end,
    problems = problems || (normalized -> 'matter_problems')
  where batch_id = p_batch and is_applicant and jsonb_array_length(normalized -> 'matter_problems') > 0;

  -- Other people on the matter: one applicant per matter, and a role for everyone else.
  update public.migration_rows set
    plan = 'error',
    problems = problems || app.migration_problem('Role', 'A second applicant for the same reference', 'Give each matter one applicant')
  where batch_id = p_batch and not is_applicant and normalized ->> 'role' = 'applicant';
  update public.migration_rows set
    plan = case when plan = 'error' then plan else 'review' end,
    problems = problems || app.migration_problem('Role', 'No role for an additional person on this matter', 'Map a Role column (sponsor, dependant…)')
  where batch_id = p_batch and not is_applicant
    and normalized ->> 'role' is null and not (normalized ->> 'role_given')::boolean;

  -- Pass 3: possible duplicates of rows still to create. An existing client record first (same
  -- name plus a date of birth, email or phone; or a date of birth and phone), else an earlier row
  -- of this file in an earlier matter. A decision counts only for the match it was made about.
  with staged as (
    select mr.id, mr.row_number, mr.group_first,
           mr.normalized ->> 'name_key' as nk, mr.normalized ->> 'email' as email,
           (mr.normalized ->> 'date_of_birth')::date as dob, mr.normalized ->> 'phone_key' as pk
    from public.migration_rows mr
    where mr.batch_id = p_batch and mr.plan = 'create'
      and not exists (
        select 1 from public.migration_rows a
        where a.batch_id = p_batch and a.group_key = mr.group_key and a.is_applicant and a.plan in ('error', 'review')
      )
  ),
  people as materialized (
    select p.id, p.created_at, app.migration_name_key(p.display_name) as nk, lower(p.email) as email,
           p.date_of_birth as dob, app.migration_phone_key(p.contact_phone) as pk
    from public.persons p
    where p.organization_id = b.organization_id and p.is_sample = b.is_sample
  ),
  person_candidates as (
    select s.id as row_id, p.id as person_id, p.created_at, p.nk = s.nk as same_name, p.dob = s.dob as same_dob,
           p.email = s.email as same_email, length(s.pk) >= 7 and p.pk = s.pk as same_phone
    from staged s join people p on p.nk = s.nk
    where p.dob = s.dob or p.email = s.email or (length(s.pk) >= 7 and p.pk = s.pk)
    union
    select s.id, p.id, p.created_at, p.nk = s.nk, true, p.email = s.email, true
    from staged s join people p on p.dob = s.dob and length(s.pk) >= 7 and p.pk = s.pk
  ),
  person_best as (
    select distinct on (row_id) row_id, person_id,
           array_remove(array[
             case when same_name then 'name' end, case when same_dob then 'date of birth' end,
             case when same_email then 'email' end, case when same_phone then 'phone' end
           ], null) as detail
    from person_candidates
    order by row_id, created_at, person_id
  ),
  row_best as (
    select distinct on (s.id) s.id as row_id, o.row_number as other_row,
           array_remove(array[
             'name', case when o.dob = s.dob then 'date of birth' end,
             case when o.email = s.email then 'email' end,
             case when length(s.pk) >= 7 and o.pk = s.pk then 'phone' end
           ], null) as detail
    from staged s join staged o on o.nk = s.nk and o.group_first < s.group_first
    where o.dob = s.dob or o.email = s.email or (length(s.pk) >= 7 and o.pk = s.pk)
    order by s.id, o.group_first, o.row_number
  )
  update public.migration_rows mr set
    match_person_id = pb.person_id,
    match_row_number = case when pb.person_id is null then rb.other_row end,
    match_detail = coalesce(pb.detail, rb.detail)
  from staged s
  left join person_best pb on pb.row_id = s.id
  left join row_best rb on rb.row_id = s.id
  where mr.id = s.id and (pb.person_id is not null or rb.other_row is not null);

  -- Decisions: kept only for the match they were made about; otherwise the row waits for one.
  update public.migration_rows mr set
    plan = case
      when mr.decision_target = t.target and mr.decision = 'same' then 'link'::public.migration_row_plan
      when mr.decision_target = t.target and mr.decision = 'different' then 'create'::public.migration_row_plan
      else 'confirm'::public.migration_row_plan
    end,
    decision = case when mr.decision_target = t.target then mr.decision end,
    decided_by = case when mr.decision_target = t.target then mr.decided_by end,
    decided_at = case when mr.decision_target = t.target then mr.decided_at end,
    decision_target = case when mr.decision_target = t.target then mr.decision_target end
  from (
    select x.id, case when x.match_person_id is not null then 'person:' || x.match_person_id else 'row:' || x.match_row_number end as target
    from public.migration_rows x
    where x.batch_id = p_batch and x.plan = 'create' and (x.match_person_id is not null or x.match_row_number is not null)
  ) t
  where mr.id = t.id;
  update public.migration_rows set decision = null, decision_target = null, decided_by = null, decided_at = null
  where batch_id = p_batch and plan = 'create' and decision is not null and match_person_id is null and match_row_number is null;

  -- The same person as an earlier row that isn't imported: needs review (in file order, so a
  -- chain of such rows resolves).
  for r in
    select mr.id, mr.match_row_number
    from public.migration_rows mr
    where mr.batch_id = p_batch and mr.plan = 'link' and mr.decision_target like 'row:%'
    order by mr.group_first, mr.row_number
  loop
    if (select plan from public.migration_rows where batch_id = p_batch and row_number = r.match_row_number) not in ('create', 'link') then
      update public.migration_rows set
        plan = 'review',
        problems = problems || app.migration_problem('—', format('Same person as row %s, which isn’t imported', r.match_row_number), format('Fix row %s', r.match_row_number))
      where id = r.id;
    end if;
  end loop;

  -- A matter whose applicant now waits for a decision or review: its other people wait too.
  update public.migration_rows other set
    plan = 'skip',
    problems = other.problems || app.migration_problem('—', format('Not imported: row %s, this matter’s applicant, has a problem', app_row.row_number), format('Fix row %s', app_row.row_number))
  from public.migration_rows app_row
  where other.batch_id = p_batch and app_row.batch_id = p_batch and app_row.is_applicant
    and app_row.group_key = other.group_key and other.id <> app_row.id
    and app_row.plan in ('review', 'error') and other.plan in ('create', 'link', 'confirm');

  select jsonb_build_object(
    'rows', count(*),
    'create', count(*) filter (where plan = 'create'),
    'link', count(*) filter (where plan = 'link'),
    'confirm', count(*) filter (where plan = 'confirm'),
    'review', count(*) filter (where plan = 'review'),
    'error', count(*) filter (where plan = 'error'),
    'skip', count(*) filter (where plan = 'skip'),
    'matters', count(*) filter (where is_applicant and plan in ('create', 'link')),
    'matters_waiting', count(*) filter (where is_applicant and plan = 'confirm'),
    'problem_rows', count(*) filter (where plan in ('review', 'error', 'skip'))
  ),
  encode(sha256(convert_to(
    b.mapping::text || '|' || b.is_sample::text || '|' ||
    coalesce(string_agg(x.row_number || ':' || x.plan::text || ':' || coalesce(x.decision_target, '') || ':' || coalesce(x.normalized::text, ''), '|' order by x.row_number), ''),
    'UTF8')), 'hex')
  into counts, hash
  from public.migration_rows x
  where x.batch_id = p_batch;

  return counts || jsonb_build_object('plan_hash', hash);
end;
$$;
revoke all on function app.migration_evaluate(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Upload, mapping, dry run, duplicates
-- ---------------------------------------------------------------------------

create function public.stage_migration_batch(
  p_org uuid,
  p_file_name text,
  p_source_sha256 text,
  p_byte_size integer,
  p_row_count integer,
  p_parsed_digest text,
  p_headers text[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_days integer;
  v_sample boolean;
  v_name text := btrim(coalesce(p_file_name, ''));
begin
  perform app.migration_owner(p_org, false);
  perform app.purge_expired_migration_staging(p_org);
  if length(v_name) not between 1 and 200 then
    raise exception 'the file name is required' using errcode = '22023';
  end if;
  if p_byte_size is null or p_byte_size not between 1 and 5242880 then
    raise exception 'the file is larger than 5 MB' using errcode = '22023';
  end if;
  if p_row_count is null or p_row_count not between 1 and 5000 then
    raise exception 'import up to 5,000 rows at a time' using errcode = '22023';
  end if;
  if coalesce(p_source_sha256, '') !~ '^[0-9a-f]{64}$' or coalesce(p_parsed_digest, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'the file checksum is missing' using errcode = '22023';
  end if;
  if p_headers is null or cardinality(p_headers) not between 1 and 100
     or exists (select 1 from unnest(p_headers) h where h is null or length(h) > 200) then
    raise exception 'the header row is not valid' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.migration_batches mb
    where mb.organization_id = p_org and mb.status in ('staged', 'checked', 'committing')
  ) then
    raise exception 'finish or discard the open import first' using errcode = '22023';
  end if;
  select coalesce((select s.staging_days from public.migration_settings s where s.organization_id = p_org), 30) into v_days;
  select org.sample_mode into v_sample from public.organizations org where org.id = p_org;
  insert into public.migration_batches (
    organization_id, file_name, source_sha256, byte_size, source_row_count, parsed_digest, headers, is_sample, purge_after
  ) values (
    p_org, v_name, p_source_sha256, p_byte_size, p_row_count, p_parsed_digest, p_headers, coalesce(v_sample, false),
    now() + make_interval(days => v_days)
  )
  returning id into v_id;
  perform app.record_audit_event(p_org, 'migration.staged', 'public.migration_batches', v_id, 'success',
    jsonb_build_object('rows', p_row_count, 'bytes', p_byte_size, 'sha256', p_source_sha256, 'sample', coalesce(v_sample, false)));
  return v_id;
end;
$$;

-- Appends parsed rows (a JSON array of arrays of strings), at most 1,000 per call, in order.
create function public.append_migration_rows(p_org uuid, p_batch uuid, p_first_row integer, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.migration_batches%rowtype;
  n integer;
begin
  perform app.migration_owner(p_org, false);
  select * into b from public.migration_batches where id = p_batch and organization_id = p_org for update;
  if b.id is null then
    raise exception 'migration batch not found' using errcode = 'P0002';
  end if;
  if b.status <> 'staged' or b.verified_at is not null then
    raise exception 'this import no longer takes rows' using errcode = '22023';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) not between 1 and 1000 then
    raise exception 'send 1 to 1,000 rows at a time' using errcode = '22023';
  end if;
  if p_first_row is distinct from b.staged_row_count + 2 then
    raise exception 'rows must arrive in order' using errcode = '22023';
  end if;
  if b.staged_row_count + jsonb_array_length(p_rows) > b.source_row_count then
    raise exception 'more rows than the file declared' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_rows) e
    where jsonb_typeof(e) <> 'array' or jsonb_array_length(e) > 100
       or exists (select 1 from jsonb_array_elements(e) c where jsonb_typeof(c) <> 'string' or length(c #>> '{}') > 4000)
  ) then
    raise exception 'a row is not valid' using errcode = '22023';
  end if;
  insert into public.migration_rows (organization_id, batch_id, row_number, cells, row_sha256)
  select p_org, p_batch, p_first_row + (e.ordinality - 1)::integer, cells.arr,
         encode(sha256(convert_to(array_to_string(cells.arr, chr(31)), 'UTF8')), 'hex')
  from jsonb_array_elements(p_rows) with ordinality e(value, ordinality)
  cross join lateral (
    select coalesce(array_agg(c.value order by c.ordinality), '{}'::text[]) as arr
    from jsonb_array_elements_text(e.value) with ordinality c(value, ordinality)
  ) cells;
  get diagnostics n = row_count;
  update public.migration_batches set staged_row_count = staged_row_count + n where id = p_batch;
  return n;
end;
$$;

-- Row count and checksum verification: the rows the database holds must be exactly the rows the
-- parser read. A mismatch discards the batch.
create function public.seal_migration_batch(p_org uuid, p_batch uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.migration_batches%rowtype;
  v_count integer;
  v_digest text;
  ok boolean;
begin
  perform app.migration_owner(p_org, false);
  select * into b from public.migration_batches where id = p_batch and organization_id = p_org for update;
  if b.id is null then
    raise exception 'migration batch not found' using errcode = 'P0002';
  end if;
  if b.status <> 'staged' or b.verified_at is not null then
    raise exception 'this import is already checked' using errcode = '22023';
  end if;
  select count(*), encode(sha256(convert_to(coalesce(string_agg(row_sha256, '' order by row_number), ''), 'UTF8')), 'hex')
  into v_count, v_digest
  from public.migration_rows where batch_id = p_batch;
  ok := v_count = b.source_row_count and v_digest = b.parsed_digest;
  if ok then
    update public.migration_batches set staged_digest = v_digest, verified_at = now() where id = p_batch;
  else
    update public.migration_batches set staged_digest = v_digest, status = 'discarded', discarded_at = now() where id = p_batch;
    perform app.migration_purge_staging(p_batch);
  end if;
  perform app.record_audit_event(p_org, 'migration.verified', 'public.migration_batches', p_batch, case when ok then 'success' else 'failure' end,
    jsonb_build_object('rows_declared', b.source_row_count, 'rows_staged', v_count, 'digest_matches', v_digest = b.parsed_digest));
  return jsonb_build_object('ok', ok, 'rows', v_count, 'digest', v_digest);
end;
$$;

-- The column and value mapping. Columns are zero-based indexes into the header row; values maps
-- a source value's key (app.migration_key) to a configured value, or 'none' for not imported.
create function public.save_migration_mapping(p_org uuid, p_batch uuid, p_mapping jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.migration_batches%rowtype;
  k text;
  v jsonb;
  used integer[] := '{}';
  idx integer;
  field text;
  entry record;
begin
  perform app.migration_owner(p_org, false);
  select * into b from public.migration_batches where id = p_batch and organization_id = p_org for update;
  if b.id is null then
    raise exception 'migration batch not found' using errcode = 'P0002';
  end if;
  if b.status not in ('staged', 'checked') or b.verified_at is null then
    raise exception 'this import can''t be mapped now' using errcode = '22023';
  end if;
  if p_mapping is null or jsonb_typeof(p_mapping) <> 'object'
     or exists (select 1 from jsonb_object_keys(p_mapping) key where key not in ('columns', 'values', 'date_order', 'default_consultant'))
     or jsonb_typeof(coalesce(p_mapping -> 'columns', '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_mapping -> 'values', '{}'::jsonb)) <> 'object' then
    raise exception 'the mapping is not valid' using errcode = '22023';
  end if;
  for k, v in select key, value from jsonb_each(coalesce(p_mapping -> 'columns', '{}'::jsonb)) loop
    if k not in ('name', 'email', 'date_of_birth', 'phone', 'role', 'reference', 'title', 'program', 'stage', 'consultant', 'case_manager') then
      raise exception 'the mapping is not valid' using errcode = '22023';
    end if;
    continue when jsonb_typeof(v) = 'null';
    if jsonb_typeof(v) <> 'number' then
      raise exception 'the mapping is not valid' using errcode = '22023';
    end if;
    idx := (v #>> '{}')::integer;
    if idx < 0 or idx >= cardinality(b.headers) or idx = any(used) then
      raise exception 'each column maps to one field' using errcode = '22023';
    end if;
    used := used || idx;
  end loop;
  if coalesce(p_mapping -> 'columns' ->> 'name', '') = '' then
    raise exception 'map a column to the person''s name' using errcode = '22023';
  end if;
  if coalesce(p_mapping ->> 'date_order', 'dmy') not in ('dmy', 'mdy', 'ymd') then
    raise exception 'the mapping is not valid' using errcode = '22023';
  end if;
  if p_mapping ? 'default_consultant' and jsonb_typeof(p_mapping -> 'default_consultant') <> 'null'
     and coalesce(p_mapping ->> 'default_consultant', '') !~ '^[0-9a-f-]{36}$' then
    raise exception 'the mapping is not valid' using errcode = '22023';
  end if;
  for field, v in select key, value from jsonb_each(coalesce(p_mapping -> 'values', '{}'::jsonb)) loop
    if field not in ('program', 'stage', 'consultant', 'case_manager', 'role') or jsonb_typeof(v) <> 'object' then
      raise exception 'the mapping is not valid' using errcode = '22023';
    end if;
    for entry in select key, value from jsonb_each(v) loop
      if jsonb_typeof(entry.value) <> 'string' or length(entry.key) > 200 or length(entry.value #>> '{}') > 60 then
        raise exception 'the mapping is not valid' using errcode = '22023';
      end if;
    end loop;
  end loop;
  update public.migration_batches set
    mapping = p_mapping,
    status = 'staged',
    plan_hash = null,
    plan_counts = null,
    checked_at = null
  where id = p_batch;
  perform app.record_audit_event(p_org, 'migration.mapped', 'public.migration_batches', p_batch, 'success',
    jsonb_build_object('columns', (select count(*) from jsonb_each(coalesce(p_mapping -> 'columns', '{}'::jsonb)) c where jsonb_typeof(c.value) = 'number')));
end;
$$;

-- The dry run: plans every row and stores the counts and plan hash. Creates nothing.
create function public.run_migration_dry_run(p_org uuid, p_batch uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.migration_batches%rowtype;
  result jsonb;
begin
  perform app.migration_owner(p_org, false);
  select * into b from public.migration_batches where id = p_batch and organization_id = p_org for update;
  if b.id is null then
    raise exception 'migration batch not found' using errcode = 'P0002';
  end if;
  if b.status not in ('staged', 'checked') or b.verified_at is null then
    raise exception 'this import can''t be checked now' using errcode = '22023';
  end if;
  if coalesce(b.mapping -> 'columns' ->> 'name', '') = '' then
    raise exception 'map a column to the person''s name' using errcode = '22023';
  end if;
  result := app.migration_evaluate(p_batch);
  update public.migration_batches set
    status = 'checked',
    plan_hash = result ->> 'plan_hash',
    plan_counts = result - 'plan_hash',
    checked_at = now()
  where id = p_batch;
  perform app.record_audit_event(p_org, 'migration.dry_run', 'public.migration_batches', p_batch, 'success', result - 'plan_hash');
  return result;
end;
$$;

-- A person's answer to a possible match on one row: the same person (the import links to that
-- client record, or to the person an earlier row creates) or different people (a new person).
-- Nothing is merged. The plan is evaluated again.
create function public.decide_migration_duplicate(p_org uuid, p_batch uuid, p_row integer, p_same boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.migration_batches%rowtype;
  r public.migration_rows%rowtype;
  v_target text;
  result jsonb;
begin
  perform app.migration_owner(p_org, false);
  select * into b from public.migration_batches where id = p_batch and organization_id = p_org for update;
  if b.id is null then
    raise exception 'migration batch not found' using errcode = 'P0002';
  end if;
  if b.status not in ('staged', 'checked') then
    raise exception 'this import can''t change now' using errcode = '22023';
  end if;
  if p_same is null then
    raise exception 'choose same person or different people' using errcode = '22023';
  end if;
  select * into r from public.migration_rows where batch_id = p_batch and row_number = p_row;
  if r.id is null or (r.match_person_id is null and r.match_row_number is null) then
    raise exception 'this row has no possible match' using errcode = '22023';
  end if;
  v_target := case when r.match_person_id is not null then 'person:' || r.match_person_id else 'row:' || r.match_row_number end;
  update public.migration_rows set
    decision = case when p_same then 'same' else 'different' end,
    decision_target = v_target,
    decided_by = (select auth.uid()),
    decided_at = now()
  where id = r.id;
  result := app.migration_evaluate(p_batch);
  update public.migration_batches set
    status = 'checked',
    plan_hash = result ->> 'plan_hash',
    plan_counts = result - 'plan_hash',
    checked_at = now()
  where id = p_batch;
  perform app.record_audit_event(p_org, 'migration.duplicate_decided', 'public.migration_batches', p_batch, 'success',
    jsonb_build_object('row', p_row, 'same_person', p_same, 'match', split_part(v_target, ':', 1),
                       'person_id', r.match_person_id));
  return result;
end;
$$;

-- Drops an import before sign-off. The staging rows are purged.
create function public.discard_migration_batch(p_org uuid, p_batch uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.migration_batches%rowtype;
  n integer;
begin
  perform app.migration_owner(p_org, false);
  select * into b from public.migration_batches where id = p_batch and organization_id = p_org for update;
  if b.id is null then
    raise exception 'migration batch not found' using errcode = 'P0002';
  end if;
  if b.status not in ('staged', 'checked') then
    raise exception 'only an import that isn''t signed off can be discarded' using errcode = '22023';
  end if;
  update public.migration_batches set status = 'discarded', discarded_at = now() where id = p_batch;
  n := app.migration_purge_staging(p_batch);
  perform app.record_audit_event(p_org, 'migration.discarded', 'public.migration_batches', p_batch, 'success', jsonb_build_object('rows', n));
end;
$$;

-- The distinct values of one column (top 40 by rows), keyed as the mapping keys them.
create function public.migration_column_values(p_org uuid, p_batch uuid, p_column integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  perform app.migration_owner(p_org, false);
  if not exists (select 1 from public.migration_batches where id = p_batch and organization_id = p_org) then
    raise exception 'migration batch not found' using errcode = 'P0002';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('key', key, 'value', sample, 'rows', n) order by n desc, key), '[]'::jsonb)
  into result
  from (
    select app.migration_key(app.migration_cell(cells, p_column)) as key,
           min(app.migration_cell(cells, p_column)) as sample, count(*) as n
    from public.migration_rows
    where batch_id = p_batch and app.migration_cell(cells, p_column) is not null
    group by 1
    order by 3 desc, 1
    limit 40
  ) v;
  return result;
end;
$$;

create function public.set_migration_staging_days(p_org uuid, p_days integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.migration_owner(p_org, true);
  if p_days is null or p_days not between 1 and 90 then
    raise exception 'keep staging rows for 1 to 90 days' using errcode = '22023';
  end if;
  insert into public.migration_settings (organization_id, staging_days) values (p_org, p_days)
  on conflict (organization_id) do update set staging_days = excluded.staging_days, version = public.migration_settings.version + 1;
  perform app.record_audit_event(p_org, 'migration.settings_changed', 'public.migration_settings', null, 'success', jsonb_build_object('staging_days', p_days));
end;
$$;

-- ---------------------------------------------------------------------------
-- Commit (firm owner + step-up)
-- ---------------------------------------------------------------------------

create function public.begin_migration_commit(p_org uuid, p_batch uuid, p_plan_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.migration_batches%rowtype;
  result jsonb;
  v_sample boolean;
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
  select org.sample_mode into v_sample from public.organizations org where org.id = p_org;
  if coalesce(v_sample, false) is distinct from b.is_sample then
    raise exception 'sample mode changed since the upload; upload the file again' using errcode = '22023';
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
  update public.migration_batches set status = 'committing', commit_started_at = now(), committed_by = (select auth.uid()) where id = p_batch;
  perform app.record_audit_event(p_org, 'migration.commit_started', 'public.migration_batches', p_batch, 'success', result - 'plan_hash');
  return jsonb_build_object('ok', true, 'matters', result -> 'matters');
end;
$$;

-- The next matters to create, applicant first, with everything the commit needs.
create function app.migration_next_groups(p_org uuid, p_batch uuid, p_limit integer)
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
  select * into b from public.migration_batches where id = p_batch and organization_id = p_org for update;
  if b.id is null or b.status <> 'committing' then
    raise exception 'this import is not being committed' using errcode = '22023';
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
    order by group_first
    limit greatest(1, least(coalesce(p_limit, 25), 100))
  ) a;
  return result;
end;
$$;
revoke all on function app.migration_next_groups(uuid, uuid, integer) from public, anon;
grant execute on function app.migration_next_groups(uuid, uuid, integer) to authenticated;

-- The person a row stands for at commit: a new person, an existing client record, or the person an
-- earlier row of this batch created.
create function app.migration_row_person(p_batch uuid, p_row public.migration_rows, p_org uuid, p_sample boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_person uuid;
begin
  if p_row.plan = 'link' then
    if p_row.decision_target like 'person:%' then
      select p.id into v_person from public.persons p
      where p.id = split_part(p_row.decision_target, ':', 2)::uuid and p.organization_id = p_org;
    else
      select other.person_id into v_person from public.migration_rows other
      where other.batch_id = p_batch and other.row_number = split_part(p_row.decision_target, ':', 2)::integer;
    end if;
    if v_person is null then
      raise exception 'migration row %: the matched person is no longer there', p_row.row_number using errcode = '22023';
    end if;
    return v_person;
  end if;
  v_person := gen_random_uuid();
  insert into public.persons (id, organization_id, display_name, email, contact_phone, is_sample, date_of_birth, birth_date_precision)
  values (
    v_person, p_org, p_row.normalized ->> 'name', p_row.normalized ->> 'email', p_row.normalized ->> 'phone', p_sample,
    (p_row.normalized ->> 'date_of_birth')::date,
    case when p_row.normalized ->> 'date_of_birth' is null then null else 'day'::public.date_precision end
  );
  return v_person;
end;
$$;
revoke all on function app.migration_row_person(uuid, public.migration_rows, uuid, boolean) from public, anon, authenticated;

-- After the matter exists: the applicant (when create_client_matter did not add one), everyone
-- else on the matter, the case manager, the creator (the engaged-matter path), and the import
-- records with each record's version at import.
create function app.migration_finish_group(
  p_org uuid,
  p_batch uuid,
  p_first integer,
  p_matter uuid,
  p_applicant uuid,
  p_path text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.migration_batches%rowtype;
  a public.migration_rows%rowtype;
  r public.migration_rows%rowtype;
  v_person uuid;
  creator public.memberships%rowtype;
  v_cm uuid;
  m public.matters%rowtype;
begin
  perform app.migration_owner(p_org, true);
  select * into b from public.migration_batches where id = p_batch and organization_id = p_org;
  if b.id is null or b.status <> 'committing' then
    raise exception 'this import is not being committed' using errcode = '22023';
  end if;
  select * into a from public.migration_rows
  where batch_id = p_batch and group_first = p_first and is_applicant and plan in ('create', 'link') and matter_id is null
  for update;
  if a.id is null then
    raise exception 'this matter is not waiting to be imported' using errcode = '22023';
  end if;
  select * into m from public.matters where id = p_matter and organization_id = p_org;
  if m.id is null or m.created_at <> now()
     or exists (select 1 from public.migration_records rec where rec.record_table = 'matters' and rec.record_id = p_matter) then
    raise exception 'the matter was not created for this import' using errcode = '42501';
  end if;

  if p_path = 'client' then
    if a.plan <> 'create' or not exists (
      select 1 from public.matter_participants mp
      where mp.matter_id = p_matter and mp.person_id = p_applicant and mp.role = 'applicant'
    ) then
      raise exception 'the matter was not created for this import' using errcode = '42501';
    end if;
    v_person := p_applicant;
    if a.normalized ->> 'phone' is not null then
      update public.persons set contact_phone = a.normalized ->> 'phone' where id = v_person;
    end if;
  else
    v_person := app.migration_row_person(p_batch, a, p_org, b.is_sample);
    insert into public.matter_participants (organization_id, matter_id, person_id, role)
    values (p_org, p_matter, v_person, 'applicant');
    -- As create_client_matter does: the creator is on the matter as case manager.
    select * into creator from public.memberships mem
    where mem.organization_id = p_org and mem.user_id = (select auth.uid()) and mem.status = 'active'
    order by mem.created_at limit 1;
    if creator.id is not null and creator.id is distinct from m.responsible_consultant_membership_id
       and creator.role in ('licensed_consultant', 'case_manager', 'firm_owner') then
      insert into public.matter_participants (organization_id, matter_id, membership_id, role)
      values (p_org, p_matter, creator.id, 'case_manager');
    end if;
  end if;
  update public.migration_rows set person_id = v_person, matter_id = p_matter, committed_at = now() where id = a.id;

  for r in
    select * from public.migration_rows
    where batch_id = p_batch and group_first = p_first and not is_applicant and plan in ('create', 'link')
    order by row_number
  loop
    v_person := app.migration_row_person(p_batch, r, p_org, b.is_sample);
    if not exists (select 1 from public.matter_participants mp where mp.matter_id = p_matter and mp.person_id = v_person) then
      insert into public.matter_participants (organization_id, matter_id, person_id, role)
      values (p_org, p_matter, v_person, (r.normalized ->> 'role')::public.matter_party_role);
    end if;
    update public.migration_rows set person_id = v_person, matter_id = p_matter, committed_at = now() where id = r.id;
  end loop;

  -- Permission mapping: the case manager from the file, assigned like any participant.
  v_cm := nullif(a.normalized ->> 'case_manager', '')::uuid;
  if v_cm is not null and v_cm is distinct from m.responsible_consultant_membership_id and not exists (
    select 1 from public.matter_participants mp where mp.matter_id = p_matter and mp.membership_id = v_cm and mp.role = 'case_manager'
  ) then
    insert into public.matter_participants (organization_id, matter_id, membership_id, role)
    values (p_org, p_matter, v_cm, 'case_manager');
  end if;

  select * into m from public.matters where id = p_matter;
  insert into public.migration_records (organization_id, batch_id, record_table, record_id, created, row_number, source_reference, imported_stage, version_at_import)
  values (p_org, p_batch, 'matters', p_matter, true, a.row_number, a.normalized ->> 'reference',
          (a.normalized ->> 'stage')::public.matter_stage, m.version);
  insert into public.migration_records (organization_id, batch_id, record_table, record_id, created, row_number, source_reference, version_at_import)
  select p_org, p_batch, 'persons', mr.person_id, mr.plan = 'create', mr.row_number, mr.normalized ->> 'reference', p.version
  from public.migration_rows mr
  join public.persons p on p.id = mr.person_id
  where mr.batch_id = p_batch and mr.group_first = p_first and mr.plan in ('create', 'link')
    -- an earlier row's person, reused: recorded once, by the row that created it
    and not (mr.plan = 'link' and mr.decision_target like 'row:%');
end;
$$;
revoke all on function app.migration_finish_group(uuid, uuid, integer, uuid, uuid, text) from public, anon;
grant execute on function app.migration_finish_group(uuid, uuid, integer, uuid, uuid, text) to authenticated;

-- After each chunk: the reference baseline; after the last: verification against the plan, the
-- exception report, the committed status, and the staging purge.
create function app.migration_after_chunk(p_org uuid, p_batch uuid)
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
begin
  perform app.migration_owner(p_org, true);
  select * into b from public.migration_batches where id = p_batch and organization_id = p_org for update;
  if b.id is null or b.status <> 'committing' then
    raise exception 'this import is not being committed' using errcode = '22023';
  end if;
  update public.migration_batches set references_at_import = app.migration_reference_counts(p_batch) where id = p_batch;
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
  update public.migration_batches set
    status = 'committed',
    committed_at = now(),
    result_counts = jsonb_build_object('matters', created_matters, 'people_created', created_persons, 'people_linked', linked_persons,
                                       'not_imported', (b.plan_counts ->> 'problem_rows')::integer, 'rows', b.source_row_count),
    exceptions = report
  where id = p_batch;
  n := app.migration_purge_staging(p_batch);
  perform app.record_audit_event(p_org, 'migration.committed', 'public.migration_batches', p_batch, 'success',
    jsonb_build_object('matters', created_matters, 'people_created', created_persons, 'people_linked', linked_persons,
                       'not_imported', (b.plan_counts ->> 'problem_rows')::integer, 'sha256', b.source_sha256, 'staging_rows_purged', n));
  return jsonb_build_object('remaining', 0, 'status', 'committed');
end;
$$;
revoke all on function app.migration_after_chunk(uuid, uuid) from public, anon;
grant execute on function app.migration_after_chunk(uuid, uuid) to authenticated;

-- Invoker: each matter is made by public.create_client_matter (or public.create_engaged_matter for a
-- sample firm or an applicant who is an existing client) as the signed-in firm owner, so RLS,
-- sample mode, licence blocks, published packs and MFA apply exactly as for New matter.
create function public.commit_migration_chunk(p_org uuid, p_batch uuid, p_limit integer default 25)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  groups jsonb;
  g jsonb;
  created jsonb;
  v_path text;
  done integer := 0;
  v_after jsonb;
begin
  if p_org is distinct from app.current_organization_id() then
    raise exception 'staff access denied' using errcode = '42501';
  end if;
  groups := app.migration_next_groups(p_org, p_batch, p_limit);
  for g in select value from jsonb_array_elements(groups) loop
    if (g ->> 'sample')::boolean is distinct from true and g ->> 'plan' = 'create' then
      v_path := 'client';
      created := public.create_client_matter(
        g ->> 'name', g ->> 'email', null, null, (g ->> 'consultant')::uuid,
        (g ->> 'program_pack_id')::uuid, g ->> 'title', (g ->> 'date_of_birth')::date, null
      );
    else
      v_path := 'engaged';
      created := public.create_engaged_matter(
        g ->> 'title', (g ->> 'sample')::boolean, (g ->> 'consultant')::uuid, (g ->> 'program_pack_id')::uuid, null
      );
    end if;
    if (created ->> 'ok')::boolean is distinct from true then
      raise exception 'migration row %: the matter was refused (%)', g ->> 'row', coalesce(created ->> 'blocked', 'refused')
        using errcode = '42501';
    end if;
    perform app.migration_finish_group(p_org, p_batch, (g ->> 'first')::integer, (created ->> 'id')::uuid,
      nullif(created ->> 'applicant_id', '')::uuid, v_path);
    done := done + 1;
  end loop;
  v_after := app.migration_after_chunk(p_org, p_batch);
  return v_after || jsonb_build_object('done', done);
end;
$$;

-- A commit that stopped (a refused matter, a timeout): recorded so the trail shows it. The batch
-- stays committing; what was created can be rolled back, or the owner signs off again to continue.
create function public.note_migration_commit_failure(p_org uuid, p_batch uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.migration_owner(p_org, false);
  if not exists (select 1 from public.migration_batches where id = p_batch and organization_id = p_org) then
    raise exception 'migration batch not found' using errcode = 'P0002';
  end if;
  perform app.record_audit_event(p_org, 'migration.commit_failed', 'public.migration_batches', p_batch, 'failure',
    jsonb_build_object('reason', left(regexp_replace(coalesce(p_reason, ''), '[^A-Za-z0-9 _.,:()-]', '', 'g'), 200)));
end;
$$;

-- ---------------------------------------------------------------------------
-- Rollback (firm owner + step-up)
-- ---------------------------------------------------------------------------

-- Why a batch's records can't be removed: one changed since the import, sits under a legal hold,
-- has a portal login, or something new points at them. Empty when the rollback can go ahead.
create function app.migration_rollback_blockers(p_batch uuid)
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

-- Read-only: what would stop a rollback now (the Sign off tab lists it).
create function public.migration_rollback_check(p_org uuid, p_batch uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.migration_owner(p_org, false);
  if not exists (select 1 from public.migration_batches where id = p_batch and organization_id = p_org) then
    raise exception 'migration batch not found' using errcode = 'P0002';
  end if;
  return app.migration_rollback_blockers(p_batch);
end;
$$;

-- True only inside rollback_migration_batch, for a matter that batch created.
create function app.migration_rollback_deletes(p_matter uuid)
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
    where r.batch_id = v::uuid and r.record_table = 'matters' and r.record_id = p_matter and r.created
      and r.removed_at is null and b.status in ('committed', 'committing')
  );
end;
$$;
revoke all on function app.migration_rollback_deletes(uuid) from public, anon, authenticated;

create function public.rollback_migration_batch(p_org uuid, p_batch uuid)
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
-- Privileges and row-level security
-- ---------------------------------------------------------------------------

revoke all on function public.stage_migration_batch(uuid, text, text, integer, integer, text, text[]) from public, anon;
revoke all on function public.append_migration_rows(uuid, uuid, integer, jsonb) from public, anon;
revoke all on function public.seal_migration_batch(uuid, uuid) from public, anon;
revoke all on function public.save_migration_mapping(uuid, uuid, jsonb) from public, anon;
revoke all on function public.run_migration_dry_run(uuid, uuid) from public, anon;
revoke all on function public.decide_migration_duplicate(uuid, uuid, integer, boolean) from public, anon;
revoke all on function public.discard_migration_batch(uuid, uuid) from public, anon;
revoke all on function public.migration_column_values(uuid, uuid, integer) from public, anon;
revoke all on function public.set_migration_staging_days(uuid, integer) from public, anon;
revoke all on function public.begin_migration_commit(uuid, uuid, text) from public, anon;
revoke all on function public.commit_migration_chunk(uuid, uuid, integer) from public, anon;
revoke all on function public.note_migration_commit_failure(uuid, uuid, text) from public, anon;
revoke all on function public.migration_rollback_check(uuid, uuid) from public, anon;
revoke all on function public.rollback_migration_batch(uuid, uuid) from public, anon;

grant execute on function public.stage_migration_batch(uuid, text, text, integer, integer, text, text[]) to authenticated;
grant execute on function public.append_migration_rows(uuid, uuid, integer, jsonb) to authenticated;
grant execute on function public.seal_migration_batch(uuid, uuid) to authenticated;
grant execute on function public.save_migration_mapping(uuid, uuid, jsonb) to authenticated;
grant execute on function public.run_migration_dry_run(uuid, uuid) to authenticated;
grant execute on function public.decide_migration_duplicate(uuid, uuid, integer, boolean) to authenticated;
grant execute on function public.discard_migration_batch(uuid, uuid) to authenticated;
grant execute on function public.migration_column_values(uuid, uuid, integer) to authenticated;
grant execute on function public.set_migration_staging_days(uuid, integer) to authenticated;
grant execute on function public.begin_migration_commit(uuid, uuid, text) to authenticated;
grant execute on function public.commit_migration_chunk(uuid, uuid, integer) to authenticated;
grant execute on function public.note_migration_commit_failure(uuid, uuid, text) to authenticated;
grant execute on function public.migration_rollback_check(uuid, uuid) to authenticated;
grant execute on function public.rollback_migration_batch(uuid, uuid) to authenticated;

revoke all on table public.migration_settings from anon, authenticated, service_role;
revoke all on table public.migration_batches from anon, authenticated, service_role;
revoke all on table public.migration_rows from anon, authenticated, service_role;
revoke all on table public.migration_records from anon, authenticated, service_role;
grant select on table public.migration_settings to authenticated;
grant select on table public.migration_batches to authenticated;
grant select on table public.migration_rows to authenticated;
grant select on table public.migration_records to authenticated;

alter table public.migration_settings enable row level security;
alter table public.migration_settings force row level security;
alter table public.migration_batches enable row level security;
alter table public.migration_batches force row level security;
alter table public.migration_rows enable row level security;
alter table public.migration_rows force row level security;
alter table public.migration_records enable row level security;
alter table public.migration_records force row level security;

create policy migration_settings_select on public.migration_settings
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.is_org_staff(organization_id))
  );

-- Imports hold client personal data from another system: the firm owner only.
create policy migration_batches_select on public.migration_batches
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.has_org_role(organization_id, array['firm_owner']::public.org_role[]))
    and (select app.staff_mfa_satisfied())
  );

create policy migration_rows_select on public.migration_rows
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.has_org_role(organization_id, array['firm_owner']::public.org_role[]))
    and (select app.staff_mfa_satisfied())
  );

create policy migration_records_select on public.migration_records
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.has_org_role(organization_id, array['firm_owner']::public.org_role[]))
    and (select app.staff_mfa_satisfied())
  );

-- Daily purge of expired staging rows where pg_cron exists (hosted Supabase); local test
-- databases get only the function.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('casevoya-migration-staging-purge', '17 3 * * *', 'select app.purge_expired_migration_staging()');
  end if;
end;
$$;
