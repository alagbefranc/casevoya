-- MIG-01 (gap #187): planning for the new import kinds, and the sensitivity classification.
-- Additive. New functions, and these redefinitions (each copied from its latest definition):
--
-- * app.migration_evaluate (latest: 20261020011000_practice_settings_fixes.sql): now a dispatcher.
--   Its body is copied unchanged into the new app.migration_evaluate_clients, which the dispatcher
--   calls for a clients_matters batch (adding 'kind' and 'ready' = matters to the counts); any other
--   kind is planned by the new app.migration_evaluate_kind. The plan hash, the counts' existing keys
--   and every clients rule are unchanged. For a non-client kind the counts' 'matters' key holds the
--   number of records ready to import (create + link), so public.begin_migration_commit's existing
--   "no row is ready to import" check applies to every kind without redefining it.
-- * public.save_migration_mapping (latest: 20261020011000_practice_settings_fixes.sql): the column,
--   value and setting keys allowed depend on the batch's kind; the required columns per kind; the
--   new optional keys default_owner (tasks), default_date_kind (key dates) and sensitivity (every
--   kind; stored on migration_batches.sensitivity too). The clients rules and messages are unchanged.
-- * public.run_migration_dry_run (latest: 20261019208100_migration_import.sql): the "map a column to
--   the person's name" check applies to clients_matters only; another kind needs a saved mapping, and
--   a documents batch its ZIP's entries (public.stage_migration_files).
-- * public.decide_migration_duplicate (latest: 20261019208100_migration_import.sql): a row whose
--   possible duplicate is an existing record of its kind (migration_rows.match_record_id) is decided
--   against 'record:<id>'. Nothing is merged: same means the existing record is kept and nothing new
--   is created for that row; different means the row creates its own record.
--
-- Duplicates per kind (never merged; staff decide on Preview):
--   relationships     the same two people and type already linked (either direction)
--   notes             a note on the same matter with the same text
--   tasks             a task on the same matter with the same title and due date
--   key_dates         a date on the same matter with the same label and day
--   documents         a file of the same person with the same SHA-256
--   opening_balances  a balance on the same matter, kind, amount and as-of date not rejected
-- and, within the file, an earlier row with the same values.

-- app.migration_evaluate_clients: the body of app.migration_evaluate as last defined in
-- 20261020011000_practice_settings_fixes.sql, copied unchanged under a new name.
create function app.migration_evaluate_clients(p_batch uuid)
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
  c_name_extra integer;
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
  c_name_extra := (cols ->> 'name_extra')::integer;
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

    -- A second name column (for example last name after first name) is joined with a space.
    v_name := nullif(btrim(concat_ws(' ', app.migration_cell(r.cells, c_name), app.migration_cell(r.cells, c_name_extra))), '');
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
    elsif v_dob is not null and (v_dob > app.firm_today(b.organization_id) or v_dob < date '1900-01-01') then
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

  -- An exact copy of an earlier row (every cell the same) is the same record twice, not another
  -- person on the matter: it isn't imported, and the row errors say which row it repeats.
  update public.migration_rows d set
    plan = 'skip',
    is_applicant = false,
    problems = jsonb_build_array(app.migration_problem('—', format('An exact copy of row %s', dup.first_row), 'Not imported twice. Remove it from your file if it was a mistake'))
  from (
    select x.id, min(y.row_number) as first_row
    from public.migration_rows x
    join public.migration_rows y on y.batch_id = x.batch_id and y.row_number < x.row_number and y.cells = x.cells
    where x.batch_id = p_batch
    group by x.id
  ) dup
  where d.id = dup.id;

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

revoke all on function app.migration_evaluate_clients(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Helpers for the new kinds
-- ---------------------------------------------------------------------------

-- A cell as written (trimmed, line breaks kept): note text. Null when blank or unmapped.
create function app.migration_raw_cell(p_cells text[], p_index integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_index is null or p_index < 0 or p_index >= coalesce(cardinality(p_cells), 0) then null
    else nullif(btrim(p_cells[p_index + 1], E' \t\r\n'), '')
  end;
$$;
revoke all on function app.migration_raw_cell(text[], integer) from public, anon;

-- One problem as a result: {problem, level}. Level error (not imported) or review (needs a choice).
create function app.migration_issue(p_column text, p_problem text, p_fix text, p_level text default 'error')
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object('problem', app.migration_problem(p_column, p_problem, p_fix), 'level', p_level);
$$;
revoke all on function app.migration_issue(text, text, text, text) from public, anon;

-- Adds a result's problem to the row's accumulator {problems, error, review}.
create function app.migration_take(p_acc jsonb, p_result jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case
    when p_result is null or not (p_result ? 'problem') then p_acc
    else jsonb_build_object(
      'problems', (p_acc -> 'problems') || jsonb_build_array(p_result -> 'problem'),
      'error', (p_acc ->> 'error')::boolean or coalesce(p_result ->> 'level', 'error') = 'error',
      'review', (p_acc ->> 'review')::boolean or p_result ->> 'level' = 'review'
    )
  end;
$$;
revoke all on function app.migration_take(jsonb, jsonb) from public, anon;

-- A date cell. Optional or required; p_past refuses a date after the firm's today (an original
-- date: a note's date, a balance's as-of date). Result {value} or {problem, level}.
create function app.migration_read_date(p_raw text, p_order text, p_column text, p_required boolean, p_past boolean, p_today date, p_what text)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  d date;
begin
  if p_raw is null then
    if p_required then
      return app.migration_issue(p_column, format('No %s', p_what), 'Add it in your file');
    end if;
    return jsonb_build_object('value', null);
  end if;
  d := app.migration_date(p_raw, p_order);
  if d is null then
    return app.migration_issue(p_column, format('“%s” isn’t a real date', left(p_raw, 40)), 'Correct the date, or check the date order on Map columns');
  end if;
  if d < date '1900-01-01' or d > date '2200-12-31' or (p_past and d > p_today) then
    return app.migration_issue(p_column, case when p_past then format('The %s is in the future', p_what) else format('The %s is out of range', p_what) end, 'Correct the date in your file');
  end if;
  return jsonb_build_object('value', d);
end;
$$;
revoke all on function app.migration_read_date(text, text, text, boolean, boolean, date, text) from public, anon;

-- A source value mapped to one of the allowed values (or 'none' when p_none). Exact words map on
-- their own; anything else needs a choice on Map columns (review). Blank gives p_blank.
create function app.migration_read_value(p_vals jsonb, p_field text, p_raw text, p_allowed text[], p_none boolean, p_column text, p_blank text)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  k text := app.migration_key(p_raw);
  mapped text;
begin
  if k is null then
    return jsonb_build_object('value', p_blank);
  end if;
  mapped := p_vals -> p_field ->> k;
  if mapped is null and replace(k, ' ', '_') = any(p_allowed) then
    mapped := replace(k, ' ', '_');
  end if;
  if mapped is null or not (mapped = any(p_allowed) or (p_none and mapped = 'none')) then
    return app.migration_issue(p_column, format('“%s” isn’t mapped', left(p_raw, 60)), 'Choose its value on Map columns', 'review');
  end if;
  return jsonb_build_object('value', mapped);
end;
$$;
revoke all on function app.migration_read_value(jsonb, text, text, text[], boolean, text, text) from public, anon;

-- A matter by reference: its Casevoya reference, or the old reference an earlier import kept.
create function app.migration_read_matter(p_org uuid, p_sample boolean, p_raw text, p_column text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  n integer;
  found_id uuid;
begin
  if p_raw is null then
    return app.migration_issue(p_column, 'No matter reference', 'Add the matter’s reference in your file');
  end if;
  select count(*), min(m.id::text)::uuid into n, found_id
  from public.matters m
  where m.organization_id = p_org and m.is_sample = p_sample
    and (
      lower(m.reference) = lower(p_raw)
      or exists (
        select 1 from public.migration_records rec
        where rec.organization_id = p_org and rec.record_table = 'matters' and rec.record_id = m.id
          and rec.removed_at is null and lower(rec.source_reference) = lower(p_raw)
      )
    );
  if n = 0 then
    return app.migration_issue(p_column, format('No matter has the reference “%s”', left(p_raw, 60)), 'Use the Casevoya reference, or the old reference from your client import');
  elsif n > 1 then
    return app.migration_issue(p_column, format('More than one matter has the reference “%s”', left(p_raw, 60)), 'Use the Casevoya reference instead', 'review');
  end if;
  return jsonb_build_object('value', found_id);
end;
$$;
revoke all on function app.migration_read_matter(uuid, boolean, text, text) from public, anon, authenticated;

-- A person already in Casevoya: by email when the cell is an email address, else by name (and the
-- date of birth when the file gives one). Never created here; more than one match needs review.
create function app.migration_read_person(p_org uuid, p_sample boolean, p_raw text, p_dob date, p_column text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  n integer;
  found_id uuid;
begin
  if p_raw is null then
    return app.migration_issue(p_column, 'No person', 'Add the person’s name or email in your file');
  end if;
  if position('@' in p_raw) > 0 then
    select count(*), min(p.id::text)::uuid into n, found_id
    from public.persons p
    where p.organization_id = p_org and p.is_sample = p_sample and p.email = lower(p_raw)
      and (p_dob is null or p.date_of_birth = p_dob);
  else
    select count(*), min(p.id::text)::uuid into n, found_id
    from public.persons p
    where p.organization_id = p_org and p.is_sample = p_sample
      and app.migration_name_key(p.display_name) = app.migration_name_key(p_raw)
      and (p_dob is null or p.date_of_birth = p_dob);
  end if;
  if n = 0 then
    return app.migration_issue(p_column, format('No client record matches “%s”', left(p_raw, 60)), 'Import the person with your clients first, or correct the name or email');
  elsif n > 1 then
    return app.migration_issue(p_column, format('More than one client record matches “%s”', left(p_raw, 60)), 'Use their email, or map a date of birth column', 'review');
  end if;
  return jsonb_build_object('value', found_id);
end;
$$;
revoke all on function app.migration_read_person(uuid, boolean, text, date, text) from public, anon, authenticated;

-- An active staff member of the firm by their sign-in email.
create function app.migration_staff_by_email(p_org uuid, p_email text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select mem.id
  from public.memberships mem
  join auth.users u on u.id = mem.user_id
  where mem.organization_id = p_org and mem.status = 'active' and mem.role = any (app.staff_roles())
    and lower(u.email) = lower(btrim(p_email))
  order by mem.created_at
  limit 1;
$$;
revoke all on function app.migration_staff_by_email(uuid, text) from public, anon, authenticated;

-- An amount as written ("1,250.00", "$1250", "1250.5") in cents. Null when it isn't one.
create function app.migration_amount_cents(p_raw text)
returns bigint
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := regexp_replace(btrim(coalesce(p_raw, '')), '^(CA)?\$\s*|\s*(CAD|\$)$', '', 'gi');
  negative boolean := false;
begin
  if v like '-%' then
    negative := true;
    v := btrim(substr(v, 2));
    v := regexp_replace(v, '^(CA)?\$\s*', '', 'i');
  end if;
  if v ~ '^[0-9]{1,3}(,[0-9]{3})+(\.[0-9]{1,2})?$' then
    v := replace(v, ',', '');
  end if;
  if v !~ '^[0-9]{1,12}(\.[0-9]{1,2})?$' then
    return null;
  end if;
  return (case when negative then -1 else 1 end) * round(v::numeric * 100)::bigint;
end;
$$;
revoke all on function app.migration_amount_cents(text) from public, anon;

-- The column keys each kind maps, with the ones it requires.
create function app.migration_kind_columns(p_kind text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_kind
    when 'relationships' then array['person', 'person_birth', 'related', 'related_birth', 'relationship', 'recorded_on']
    when 'notes' then array['reference', 'person', 'person_birth', 'body', 'author', 'written_on']
    when 'tasks' then array['reference', 'title', 'due_on', 'assignee', 'status', 'priority', 'created_on']
    when 'key_dates' then array['reference', 'label', 'date', 'date_kind', 'recorded_on']
    when 'documents' then array['file', 'person', 'person_birth', 'reference', 'document_type', 'dated_on']
    when 'opening_balances' then array['reference', 'balance_kind', 'amount', 'currency', 'as_of', 'description']
    else array['name', 'name_extra', 'email', 'date_of_birth', 'phone', 'role', 'reference', 'title', 'program', 'stage', 'consultant', 'case_manager']
  end;
$$;
revoke all on function app.migration_kind_columns(text) from public, anon;

create function app.migration_kind_required(p_kind text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_kind
    when 'relationships' then array['person', 'related', 'relationship']
    when 'notes' then array['body']
    when 'tasks' then array['reference', 'title']
    when 'key_dates' then array['reference', 'label', 'date']
    when 'documents' then array['file', 'person', 'reference', 'document_type']
    when 'opening_balances' then array['reference', 'balance_kind', 'amount', 'as_of']
    else array['name']
  end;
$$;
revoke all on function app.migration_kind_required(text) from public, anon;

create function app.migration_kind_values(p_kind text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_kind
    when 'relationships' then array['relationship']
    when 'tasks' then array['status', 'priority']
    when 'key_dates' then array['date_kind']
    when 'opening_balances' then array['balance_kind']
    when 'clients_matters' then array['program', 'stage', 'consultant', 'case_manager', 'role']
    else array[]::text[]
  end;
$$;
revoke all on function app.migration_kind_values(text) from public, anon;

-- ---------------------------------------------------------------------------
-- Planning the new kinds
-- ---------------------------------------------------------------------------

create function app.migration_evaluate_kind(p_batch uuid)
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
  hdr text[];
  today date;
  default_owner uuid;
  default_kind text;
  r record;
  acc jsonb;
  res jsonb;
  norm jsonb;
  v_skip text;
  v_dup text;
  v_match uuid;
  v_exact boolean;
  v_matter uuid;
  v_person uuid;
  v_related uuid;
  v_dob date;
  v_text text;
  v_text2 text;
  v_raw text;
  v_date date;
  v_original date;
  v_value text;
  v_value2 text;
  v_owner uuid;
  v_cents bigint;
  v_currency text;
  v_n integer;
  f public.migration_files%rowtype;
  limit_bytes bigint;
  counts jsonb;
  hash text;
  c_reference integer;
  c_person integer;
  c_person_birth integer;
  c_related integer;
  c_related_birth integer;
  c_relationship integer;
  c_recorded_on integer;
  c_body integer;
  c_author integer;
  c_written_on integer;
  c_title integer;
  c_due_on integer;
  c_assignee integer;
  c_status integer;
  c_priority integer;
  c_created_on integer;
  c_label integer;
  c_date integer;
  c_date_kind integer;
  c_file integer;
  c_document_type integer;
  c_dated_on integer;
  c_balance_kind integer;
  c_amount integer;
  c_currency integer;
  c_as_of integer;
  c_description integer;
  rel_types constant text[] := array['spouse', 'parent', 'child', 'payer', 'sponsor', 'household', 'other'];
begin
  select * into b from public.migration_batches where id = p_batch for update;
  if b.id is null then
    raise exception 'migration batch not found' using errcode = 'P0002';
  end if;
  hdr := b.headers;
  cols := coalesce(b.mapping -> 'columns', '{}'::jsonb);
  vals := coalesce(b.mapping -> 'values', '{}'::jsonb);
  date_order := coalesce(b.mapping ->> 'date_order', 'dmy');
  today := app.firm_today(b.organization_id);
  default_owner := nullif(b.mapping ->> 'default_owner', '')::uuid;
  default_kind := nullif(b.mapping ->> 'default_date_kind', '');
  limit_bytes := app.document_max_bytes(b.organization_id);
  c_reference := (cols ->> 'reference')::integer;
  c_person := (cols ->> 'person')::integer;
  c_person_birth := (cols ->> 'person_birth')::integer;
  c_related := (cols ->> 'related')::integer;
  c_related_birth := (cols ->> 'related_birth')::integer;
  c_relationship := (cols ->> 'relationship')::integer;
  c_recorded_on := (cols ->> 'recorded_on')::integer;
  c_body := (cols ->> 'body')::integer;
  c_author := (cols ->> 'author')::integer;
  c_written_on := (cols ->> 'written_on')::integer;
  c_title := (cols ->> 'title')::integer;
  c_due_on := (cols ->> 'due_on')::integer;
  c_assignee := (cols ->> 'assignee')::integer;
  c_status := (cols ->> 'status')::integer;
  c_priority := (cols ->> 'priority')::integer;
  c_created_on := (cols ->> 'created_on')::integer;
  c_label := (cols ->> 'label')::integer;
  c_date := (cols ->> 'date')::integer;
  c_date_kind := (cols ->> 'date_kind')::integer;
  c_file := (cols ->> 'file')::integer;
  c_document_type := (cols ->> 'document_type')::integer;
  c_dated_on := (cols ->> 'dated_on')::integer;
  c_balance_kind := (cols ->> 'balance_kind')::integer;
  c_amount := (cols ->> 'amount')::integer;
  c_currency := (cols ->> 'currency')::integer;
  c_as_of := (cols ->> 'as_of')::integer;
  c_description := (cols ->> 'description')::integer;
  -- A default assignee must be someone active on the team.
  if default_owner is not null and not exists (
    select 1 from public.memberships mem
    where mem.id = default_owner and mem.organization_id = b.organization_id and mem.status = 'active'
      and mem.role = any (app.staff_roles())
  ) then
    default_owner := null;
  end if;

  -- Pass 1: each row on its own.
  for r in select id, row_number, cells from public.migration_rows where batch_id = p_batch order by row_number loop
    acc := jsonb_build_object('problems', '[]'::jsonb, 'error', false, 'review', false);
    norm := '{}'::jsonb;
    v_skip := null;
    v_dup := null;
    v_match := null;
    v_exact := false;
    v_original := null;

    if b.kind = 'tasks' then
      res := app.migration_read_matter(b.organization_id, b.is_sample, app.migration_cell(r.cells, c_reference), coalesce(hdr[c_reference + 1], 'Matter'));
      acc := app.migration_take(acc, res);
      v_matter := (res ->> 'value')::uuid;
      v_text := app.migration_cell(r.cells, c_title);
      if v_text is null then
        acc := app.migration_take(acc, app.migration_issue(coalesce(hdr[c_title + 1], 'Title'), 'No task title', 'Add a title in your file'));
      elsif length(v_text) > 200 then
        acc := app.migration_take(acc, app.migration_issue(hdr[c_title + 1], 'The title is longer than 200 characters', 'Shorten it in your file'));
      end if;
      res := app.migration_read_date(app.migration_cell(r.cells, c_due_on), date_order, coalesce(hdr[c_due_on + 1], 'Due'), false, false, today, 'due date');
      acc := app.migration_take(acc, res);
      v_date := (res ->> 'value')::date;
      v_raw := app.migration_cell(r.cells, c_assignee);
      if v_raw is null then
        v_owner := default_owner;
        if v_owner is null then
          acc := app.migration_take(acc, app.migration_issue(coalesce(hdr[c_assignee + 1], 'Assignee'), 'No assignee', 'Map an assignee column, or choose who gets unassigned tasks on Map columns'));
        end if;
      else
        v_owner := app.migration_staff_by_email(b.organization_id, v_raw);
        if v_owner is null then
          acc := app.migration_take(acc, app.migration_issue(hdr[c_assignee + 1], format('“%s” isn’t the email of someone active on your team', left(v_raw, 60)), 'Use their Casevoya sign-in email'));
        end if;
      end if;
      res := app.migration_read_value(vals, 'status', app.migration_cell(r.cells, c_status), array['open', 'done', 'cancelled'], false, coalesce(hdr[c_status + 1], 'Status'), 'open');
      acc := app.migration_take(acc, res);
      v_value := res ->> 'value';
      res := app.migration_read_value(vals, 'priority', app.migration_cell(r.cells, c_priority), array['low', 'normal', 'high', 'critical'], false, coalesce(hdr[c_priority + 1], 'Priority'), 'normal');
      acc := app.migration_take(acc, res);
      v_value2 := res ->> 'value';
      res := app.migration_read_date(app.migration_cell(r.cells, c_created_on), date_order, coalesce(hdr[c_created_on + 1], 'Created'), false, true, today, 'creation date');
      acc := app.migration_take(acc, res);
      v_original := (res ->> 'value')::date;
      norm := jsonb_build_object('matter_id', v_matter, 'title', left(v_text, 200), 'due_on', v_date, 'owner', v_owner,
                                 'status', v_value, 'priority', v_value2, 'original_on', v_original);
      if v_matter is not null and v_text is not null then
        v_dup := v_matter::text || '|' || lower(v_text) || '|' || coalesce(v_date::text, '');
        select t.id into v_match from public.tasks t
        where t.matter_id = v_matter and lower(btrim(t.title)) = lower(v_text) and t.due_on is not distinct from v_date
        order by t.created_at, t.id limit 1;
      end if;

    elsif b.kind = 'notes' then
      v_raw := app.migration_cell(r.cells, c_reference);
      v_text2 := app.migration_cell(r.cells, c_person);
      v_matter := null;
      if v_raw is not null then
        res := app.migration_read_matter(b.organization_id, b.is_sample, v_raw, coalesce(hdr[c_reference + 1], 'Matter'));
        acc := app.migration_take(acc, res);
        v_matter := (res ->> 'value')::uuid;
      elsif v_text2 is not null then
        v_dob := app.migration_date(app.migration_cell(r.cells, c_person_birth), date_order);
        res := app.migration_read_person(b.organization_id, b.is_sample, v_text2, v_dob, coalesce(hdr[c_person + 1], 'Person'));
        acc := app.migration_take(acc, res);
        v_person := (res ->> 'value')::uuid;
        if v_person is not null then
          select count(distinct mp.matter_id), min(mp.matter_id::text)::uuid into v_n, v_matter
          from public.matter_participants mp
          join public.matters m on m.id = mp.matter_id
          where mp.person_id = v_person and m.organization_id = b.organization_id;
          if v_n = 0 then
            v_matter := null;
            acc := app.migration_take(acc, app.migration_issue(hdr[c_person + 1], 'This person has no matter to keep the note on', 'Casevoya keeps staff notes on matters: add a matter reference column'));
          elsif v_n > 1 then
            v_matter := null;
            acc := app.migration_take(acc, app.migration_issue(hdr[c_person + 1], 'This person has more than one matter', 'Add a matter reference column', 'review'));
          end if;
        end if;
      else
        acc := app.migration_take(acc, app.migration_issue('Matter', 'No matter reference or person', 'Add the matter’s reference in your file'));
      end if;
      v_text := app.migration_raw_cell(r.cells, c_body);
      if v_text is null then
        acc := app.migration_take(acc, app.migration_issue(coalesce(hdr[c_body + 1], 'Note'), 'No note text', 'Add the note in your file, or remove the row'));
      elsif length(v_text) > 4000 then
        acc := app.migration_take(acc, app.migration_issue(hdr[c_body + 1], 'The note is longer than 4,000 characters', 'Split it into two rows'));
      end if;
      v_value := app.migration_cell(r.cells, c_author);
      if v_value is not null and length(v_value) > 200 then
        acc := app.migration_take(acc, app.migration_issue(hdr[c_author + 1], 'The author’s name is longer than 200 characters', 'Shorten it in your file'));
        v_value := left(v_value, 200);
      end if;
      res := app.migration_read_date(app.migration_cell(r.cells, c_written_on), date_order, coalesce(hdr[c_written_on + 1], 'Date'), false, true, today, 'note date');
      acc := app.migration_take(acc, res);
      v_original := (res ->> 'value')::date;
      norm := jsonb_build_object('matter_id', v_matter, 'body', left(v_text, 4000), 'author', v_value, 'original_on', v_original);
      if v_matter is not null and v_text is not null then
        v_dup := v_matter::text || '|' || md5(lower(v_text));
        select n.id into v_match from public.matter_staff_notes n
        where n.matter_id = v_matter and lower(btrim(n.body)) = lower(v_text)
        order by n.created_at, n.id limit 1;
      end if;

    elsif b.kind = 'key_dates' then
      res := app.migration_read_matter(b.organization_id, b.is_sample, app.migration_cell(r.cells, c_reference), coalesce(hdr[c_reference + 1], 'Matter'));
      acc := app.migration_take(acc, res);
      v_matter := (res ->> 'value')::uuid;
      v_text := app.migration_cell(r.cells, c_label);
      if v_text is null then
        acc := app.migration_take(acc, app.migration_issue(coalesce(hdr[c_label + 1], 'Label'), 'No label for the date', 'Say what the date is in your file'));
      elsif length(v_text) > 200 then
        acc := app.migration_take(acc, app.migration_issue(hdr[c_label + 1], 'The label is longer than 200 characters', 'Shorten it in your file'));
      end if;
      res := app.migration_read_date(app.migration_cell(r.cells, c_date), date_order, coalesce(hdr[c_date + 1], 'Date'), true, false, today, 'date');
      acc := app.migration_take(acc, res);
      v_date := (res ->> 'value')::date;
      if c_date_kind is not null then
        res := app.migration_read_value(vals, 'date_kind', app.migration_cell(r.cells, c_date_kind), array['legal', 'correspondence', 'internal'], false, hdr[c_date_kind + 1], default_kind);
        acc := app.migration_take(acc, res);
        v_value := res ->> 'value';
      else
        v_value := default_kind;
      end if;
      if v_value is null and not (res ? 'problem' and c_date_kind is not null) then
        acc := app.migration_take(acc, app.migration_issue(coalesce(hdr[c_date_kind + 1], 'Kind'), 'No kind of date', 'Choose what kind of dates these are on Map columns', 'review'));
      end if;
      res := app.migration_read_date(app.migration_cell(r.cells, c_recorded_on), date_order, coalesce(hdr[c_recorded_on + 1], 'Recorded'), false, true, today, 'date recorded');
      acc := app.migration_take(acc, res);
      v_original := (res ->> 'value')::date;
      norm := jsonb_build_object('matter_id', v_matter, 'label', left(v_text, 200), 'due_on', v_date, 'date_kind', v_value, 'original_on', v_original);
      if v_matter is not null and v_text is not null and v_date is not null then
        v_dup := v_matter::text || '|' || lower(v_text) || '|' || v_date::text;
        select d.id into v_match from public.deadlines d
        where d.matter_id = v_matter and lower(btrim(d.label)) = lower(v_text) and d.due_on = v_date
        order by d.created_at, d.id limit 1;
      end if;

    elsif b.kind = 'relationships' then
      v_dob := app.migration_date(app.migration_cell(r.cells, c_person_birth), date_order);
      res := app.migration_read_person(b.organization_id, b.is_sample, app.migration_cell(r.cells, c_person), v_dob, coalesce(hdr[c_person + 1], 'Person'));
      acc := app.migration_take(acc, res);
      v_person := (res ->> 'value')::uuid;
      v_dob := app.migration_date(app.migration_cell(r.cells, c_related_birth), date_order);
      res := app.migration_read_person(b.organization_id, b.is_sample, app.migration_cell(r.cells, c_related), v_dob, coalesce(hdr[c_related + 1], 'Related person'));
      acc := app.migration_take(acc, res);
      v_related := (res ->> 'value')::uuid;
      if v_person is not null and v_person = v_related then
        acc := app.migration_take(acc, app.migration_issue(hdr[c_related + 1], 'Both columns name the same person', 'Correct one of them in your file'));
      end if;
      res := app.migration_read_value(vals, 'relationship', app.migration_cell(r.cells, c_relationship), rel_types, true, coalesce(hdr[c_relationship + 1], 'Relationship'), null);
      acc := app.migration_take(acc, res);
      v_value := res ->> 'value';
      if v_value is null and not (res ? 'problem') then
        acc := app.migration_take(acc, app.migration_issue(coalesce(hdr[c_relationship + 1], 'Relationship'), 'No relationship', 'Add how the two people are related'));
      elsif v_value = 'none' then
        v_skip := hdr[c_relationship + 1];
      end if;
      res := app.migration_read_date(app.migration_cell(r.cells, c_recorded_on), date_order, coalesce(hdr[c_recorded_on + 1], 'Recorded'), false, true, today, 'date recorded');
      acc := app.migration_take(acc, res);
      v_original := (res ->> 'value')::date;
      if v_person is not null and v_related is not null and v_value is not null and v_value <> 'none' then
        v_dup := v_person::text || '|' || v_related::text || '|' || v_value;
        select rel.id, (rel.from_person_id = v_person) into v_match, v_exact
        from public.person_relationships rel
        where rel.organization_id = b.organization_id and rel.relationship_type = v_value::public.person_relationship_type
          and ((rel.from_person_id = v_person and rel.to_person_id = v_related) or (rel.from_person_id = v_related and rel.to_person_id = v_person))
        order by (rel.from_person_id = v_person) desc, rel.created_at
        limit 1;
      end if;
      norm := jsonb_build_object('person_id', v_person, 'related_id', v_related, 'relationship', v_value,
                                 'exact_exists', coalesce(v_exact, false), 'original_on', v_original);

    elsif b.kind = 'opening_balances' then
      res := app.migration_read_matter(b.organization_id, b.is_sample, app.migration_cell(r.cells, c_reference), coalesce(hdr[c_reference + 1], 'Matter'));
      acc := app.migration_take(acc, res);
      v_matter := (res ->> 'value')::uuid;
      res := app.migration_read_value(vals, 'balance_kind', app.migration_cell(r.cells, c_balance_kind), array['receivable', 'advance'], true, coalesce(hdr[c_balance_kind + 1], 'Kind'), null);
      acc := app.migration_take(acc, res);
      v_value := res ->> 'value';
      if v_value is null and not (res ? 'problem') then
        acc := app.migration_take(acc, app.migration_issue(coalesce(hdr[c_balance_kind + 1], 'Kind'), 'No kind of balance', 'Say whether it is owed by the client (receivable) or held for them (advance)'));
      elsif v_value = 'none' then
        v_skip := hdr[c_balance_kind + 1];
      end if;
      v_raw := app.migration_cell(r.cells, c_amount);
      v_cents := app.migration_amount_cents(v_raw);
      if v_raw is null then
        acc := app.migration_take(acc, app.migration_issue(coalesce(hdr[c_amount + 1], 'Amount'), 'No amount', 'Add the balance in your file'));
      elsif v_cents is null then
        acc := app.migration_take(acc, app.migration_issue(hdr[c_amount + 1], format('“%s” isn’t an amount', left(v_raw, 40)), 'Write it like 1250.00'));
      elsif v_cents <= 0 then
        acc := app.migration_take(acc, app.migration_issue(hdr[c_amount + 1], 'The amount is zero or negative', 'Use a positive amount; the kind says which way it goes'));
        v_cents := null;
      elsif v_cents > 100000000000 then
        acc := app.migration_take(acc, app.migration_issue(hdr[c_amount + 1], 'The amount is too large', 'Check the amount in your file'));
        v_cents := null;
      end if;
      v_currency := upper(coalesce(app.migration_cell(r.cells, c_currency), 'CAD'));
      if v_currency !~ '^[A-Z]{3}$' then
        acc := app.migration_take(acc, app.migration_issue(hdr[c_currency + 1], format('“%s” isn’t a currency code', left(v_currency, 20)), 'Use a three-letter code like CAD'));
        v_currency := null;
      end if;
      res := app.migration_read_date(app.migration_cell(r.cells, c_as_of), date_order, coalesce(hdr[c_as_of + 1], 'As of'), true, true, today, 'as-of date');
      acc := app.migration_take(acc, res);
      v_original := (res ->> 'value')::date;
      v_text := app.migration_cell(r.cells, c_description);
      if v_text is not null and length(v_text) > 200 then
        acc := app.migration_take(acc, app.migration_issue(hdr[c_description + 1], 'The description is longer than 200 characters', 'Shorten it in your file'));
      end if;
      norm := jsonb_build_object('matter_id', v_matter, 'balance_kind', v_value, 'amount_cents', v_cents, 'currency', v_currency,
                                 'as_of', v_original, 'description', left(v_text, 200), 'original_on', v_original);
      if v_matter is not null and v_value in ('receivable', 'advance') and v_cents is not null and v_original is not null then
        v_dup := v_matter::text || '|' || v_value || '|' || v_cents::text || '|' || v_original::text;
        select ob.id into v_match from public.opening_balances ob
        where ob.matter_id = v_matter and ob.kind = v_value and ob.amount_cents = v_cents and ob.as_of = v_original
          and ob.status <> 'rejected'
        order by ob.created_at, ob.id limit 1;
      end if;

    elsif b.kind = 'documents' then
      v_raw := app.migration_cell(r.cells, c_file);
      f := null;
      if v_raw is null then
        acc := app.migration_take(acc, app.migration_issue(coalesce(hdr[c_file + 1], 'File'), 'No file name', 'Add the file’s name in the ZIP'));
      else
        select * into f from public.migration_files mf where mf.batch_id = p_batch and mf.path = v_raw;
        if f.id is null then
          select count(*) into v_n from public.migration_files mf where mf.batch_id = p_batch and lower(mf.base_name) = lower(v_raw);
          if v_n = 1 then
            select * into f from public.migration_files mf where mf.batch_id = p_batch and lower(mf.base_name) = lower(v_raw);
          elsif v_n > 1 then
            acc := app.migration_take(acc, app.migration_issue(hdr[c_file + 1], format('More than one file in the ZIP is named “%s”', left(v_raw, 60)), 'Write its folder path as well', 'review'));
          else
            acc := app.migration_take(acc, app.migration_issue(hdr[c_file + 1], format('No file named “%s” in the ZIP', left(v_raw, 60)), 'Add the file to the ZIP, or correct its name'));
          end if;
        end if;
        if f.id is not null then
          if f.problem is not null then
            acc := app.migration_take(acc, app.migration_issue(hdr[c_file + 1], f.problem, 'Replace the file in the ZIP'));
          elsif f.media_type is null then
            acc := app.migration_take(acc, app.migration_issue(hdr[c_file + 1], 'The file isn’t a PDF, JPEG, PNG, HEIC or DOCX', 'Convert it, or leave it out'));
          elsif app.media_type_for_filename(f.base_name) is distinct from f.media_type then
            acc := app.migration_take(acc, app.migration_issue(hdr[c_file + 1], 'The file’s contents don’t match its name', 'Check the file and its extension'));
          elsif f.byte_size < 1 or f.byte_size > limit_bytes then
            acc := app.migration_take(acc, app.migration_issue(hdr[c_file + 1], 'The file is empty or above your firm’s upload limit', 'Replace it, or raise the limit in Settings'));
          end if;
        end if;
      end if;
      v_dob := app.migration_date(app.migration_cell(r.cells, c_person_birth), date_order);
      res := app.migration_read_person(b.organization_id, b.is_sample, app.migration_cell(r.cells, c_person), v_dob, coalesce(hdr[c_person + 1], 'Person'));
      acc := app.migration_take(acc, res);
      v_person := (res ->> 'value')::uuid;
      res := app.migration_read_matter(b.organization_id, b.is_sample, app.migration_cell(r.cells, c_reference), coalesce(hdr[c_reference + 1], 'Matter'));
      acc := app.migration_take(acc, res);
      v_matter := (res ->> 'value')::uuid;
      if v_person is not null and v_matter is not null and not exists (
        select 1 from public.matter_participants mp where mp.matter_id = v_matter and mp.person_id = v_person
      ) then
        acc := app.migration_take(acc, app.migration_issue(coalesce(hdr[c_person + 1], 'Person'), 'This person isn’t on that matter', 'Correct the person or the matter reference'));
      end if;
      v_text := app.migration_cell(r.cells, c_document_type);
      if v_text is null then
        acc := app.migration_take(acc, app.migration_issue(coalesce(hdr[c_document_type + 1], 'Document type'), 'No document type', 'Say what the document is'));
      elsif length(v_text) > 200 then
        acc := app.migration_take(acc, app.migration_issue(hdr[c_document_type + 1], 'The document type is longer than 200 characters', 'Shorten it in your file'));
      end if;
      res := app.migration_read_date(app.migration_cell(r.cells, c_dated_on), date_order, coalesce(hdr[c_dated_on + 1], 'Date'), false, true, today, 'document date');
      acc := app.migration_take(acc, res);
      v_original := (res ->> 'value')::date;
      norm := jsonb_build_object('person_id', v_person, 'matter_id', v_matter, 'purpose', left(v_text, 200), 'original_on', v_original,
                                 'file_path', f.path, 'file_name', f.base_name, 'file_sha256', f.sha256, 'file_bytes', f.byte_size,
                                 'media_type', f.media_type);
      if v_person is not null and f.sha256 is not null then
        v_dup := v_person::text || '|' || f.sha256;
        select doc.id into v_match
        from public.documents doc
        join public.document_versions ver on ver.document_id = doc.id
        where doc.person_id = v_person and ver.checksum_sha256 = f.sha256
        order by doc.created_at, doc.id limit 1;
      end if;
    end if;

    update public.migration_rows set
      normalized = norm || jsonb_build_object('dup', v_dup),
      problems = case when v_skip is not null and not (acc ->> 'error')::boolean and not (acc ->> 'review')::boolean
        then (acc -> 'problems') || app.migration_problem(coalesce(v_skip, '—'), 'Mapped to not imported', 'Map its value on Map columns to import it')
        else acc -> 'problems' end,
      plan = case
        when (acc ->> 'error')::boolean then 'error'
        when (acc ->> 'review')::boolean then 'review'
        when v_skip is not null then 'skip'
        else 'create'
      end::public.migration_row_plan,
      group_key = 'row:' || r.row_number,
      -- Each row is its own group and stands for it, so the commit takes it through
      -- app.migration_next_groups like a matter (and a pilot can take the first rows).
      group_first = r.row_number,
      is_applicant = true,
      match_person_id = null,
      match_row_number = null,
      match_detail = null,
      match_record_id = case when (acc ->> 'error')::boolean or (acc ->> 'review')::boolean or v_skip is not null then null else v_match end,
      match_record_table = case when (acc ->> 'error')::boolean or (acc ->> 'review')::boolean or v_skip is not null or v_match is null then null
        else case b.kind
          when 'relationships' then 'person_relationships' when 'notes' then 'matter_staff_notes' when 'tasks' then 'tasks'
          when 'key_dates' then 'deadlines' when 'documents' then 'documents' else 'opening_balances' end
        end
    where id = r.id;
  end loop;

  -- Pass 2: an earlier row of this file with the same values (only when no existing record matches).
  update public.migration_rows mr set match_row_number = e.first_row
  from (
    select x.id, (
      select min(y.row_number) from public.migration_rows y
      where y.batch_id = p_batch and y.plan = 'create' and y.row_number < x.row_number
        and y.normalized ->> 'dup' = x.normalized ->> 'dup'
    ) as first_row
    from public.migration_rows x
    where x.batch_id = p_batch and x.plan = 'create' and x.match_record_id is null and x.normalized ->> 'dup' is not null
  ) e
  where mr.id = e.id and e.first_row is not null;
  update public.migration_rows set match_detail = case
      when match_record_id is not null then array['an existing record']
      else array['row ' || match_row_number]
    end
  where batch_id = p_batch and plan = 'create' and (match_record_id is not null or match_row_number is not null);

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
    select x.id, case when x.match_record_id is not null then 'record:' || x.match_record_id else 'row:' || x.match_row_number end as target
    from public.migration_rows x
    where x.batch_id = p_batch and x.plan = 'create' and (x.match_record_id is not null or x.match_row_number is not null)
  ) t
  where mr.id = t.id;
  update public.migration_rows set decision = null, decision_target = null, decided_by = null, decided_at = null
  where batch_id = p_batch and plan = 'create' and decision is not null and match_record_id is null and match_row_number is null;

  -- A relationship can't be created twice in the same direction: "different" is refused for it.
  update public.migration_rows set
    plan = 'error',
    problems = problems || app.migration_problem('—', 'This exact link already exists', 'Choose Same record, or remove the row')
  where batch_id = p_batch and b.kind = 'relationships' and plan = 'create' and decision = 'different'
    and (decision_target like 'row:%' or (normalized ->> 'exact_exists')::boolean);

  -- The same record as an earlier row that isn't imported: needs review (in file order).
  for r in
    select mr.id, mr.match_row_number
    from public.migration_rows mr
    where mr.batch_id = p_batch and mr.plan = 'link' and mr.decision_target like 'row:%'
    order by mr.row_number
  loop
    if (select plan from public.migration_rows where batch_id = p_batch and row_number = r.match_row_number) not in ('create', 'link') then
      update public.migration_rows set
        plan = 'review',
        problems = problems || app.migration_problem('—', format('Same record as row %s, which isn’t imported', r.match_row_number), format('Fix row %s', r.match_row_number))
      where id = r.id;
    end if;
  end loop;

  select jsonb_build_object(
    'kind', b.kind,
    'rows', count(*),
    'create', count(*) filter (where plan = 'create'),
    'link', count(*) filter (where plan = 'link'),
    'confirm', count(*) filter (where plan = 'confirm'),
    'review', count(*) filter (where plan = 'review'),
    'error', count(*) filter (where plan = 'error'),
    'skip', count(*) filter (where plan = 'skip'),
    'ready', count(*) filter (where plan in ('create', 'link')),
    'matters', count(*) filter (where plan in ('create', 'link')),
    'matters_waiting', count(*) filter (where plan = 'confirm'),
    'problem_rows', count(*) filter (where plan in ('review', 'error', 'skip'))
  ),
  encode(sha256(convert_to(
    b.kind || '|' || b.mapping::text || '|' || b.is_sample::text || '|' || coalesce(b.attachment_sha256, '') || '|' ||
    coalesce(string_agg(x.row_number || ':' || x.plan::text || ':' || coalesce(x.decision_target, '') || ':' || coalesce(x.normalized::text, ''), '|' order by x.row_number), ''),
    'UTF8')), 'hex')
  into counts, hash
  from public.migration_rows x
  where x.batch_id = p_batch;

  return counts || jsonb_build_object('plan_hash', hash);
end;
$$;
revoke all on function app.migration_evaluate_kind(uuid) from public, anon, authenticated;

-- The plan for any batch: clients and matters as before, every other kind by migration_evaluate_kind.
create or replace function app.migration_evaluate(p_batch uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text;
  result jsonb;
begin
  select kind into v_kind from public.migration_batches where id = p_batch;
  if v_kind is null then
    raise exception 'migration batch not found' using errcode = 'P0002';
  end if;
  if v_kind = 'clients_matters' then
    result := app.migration_evaluate_clients(p_batch);
    return result || jsonb_build_object('kind', v_kind, 'ready', result -> 'matters');
  end if;
  return app.migration_evaluate_kind(p_batch);
end;
$$;
revoke all on function app.migration_evaluate(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Kind, files, mapping, dry run, duplicates
-- ---------------------------------------------------------------------------

-- What the file holds. Chosen at upload, before any mapping; the default is clients and matters.
create function public.set_migration_kind(p_org uuid, p_batch uuid, p_kind text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.migration_batches%rowtype;
begin
  perform app.migration_owner(p_org, false);
  select * into b from public.migration_batches where id = p_batch and organization_id = p_org for update;
  if b.id is null then
    raise exception 'migration batch not found' using errcode = 'P0002';
  end if;
  if b.status <> 'staged' or b.plan_hash is not null or b.mapping <> '{}'::jsonb or b.attachment_sha256 is not null then
    raise exception 'this import''s kind can''t change now' using errcode = '22023';
  end if;
  if p_kind is null or p_kind not in ('clients_matters', 'relationships', 'notes', 'tasks', 'key_dates', 'documents', 'opening_balances') then
    raise exception 'choose what the file holds' using errcode = '22023';
  end if;
  update public.migration_batches set kind = p_kind where id = p_batch;
  perform app.record_audit_event(p_org, 'migration.kind_set', 'public.migration_batches', p_batch, 'success', jsonb_build_object('kind', p_kind));
end;
$$;

-- A documents import's ZIP, as the server read it: each entry's path, size, SHA-256, detected type
-- and any problem. The bytes are not kept; sign-off sends the ZIP again and it must hash the same.
create function public.stage_migration_files(p_org uuid, p_batch uuid, p_name text, p_sha256 text, p_bytes bigint, p_files jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.migration_batches%rowtype;
  n integer;
  v_name text := btrim(coalesce(p_name, ''));
begin
  perform app.migration_owner(p_org, false);
  select * into b from public.migration_batches where id = p_batch and organization_id = p_org for update;
  if b.id is null then
    raise exception 'migration batch not found' using errcode = 'P0002';
  end if;
  if b.kind <> 'documents' or b.status <> 'staged' or b.verified_at is null or b.attachment_sha256 is not null then
    raise exception 'this import doesn''t take a ZIP now' using errcode = '22023';
  end if;
  if length(v_name) not between 1 and 200 or coalesce(p_sha256, '') !~ '^[0-9a-f]{64}$'
     or p_bytes is null or p_bytes not between 1 and 26214400 then
    raise exception 'the ZIP is larger than 25 MB or not valid' using errcode = '22023';
  end if;
  if p_files is null or jsonb_typeof(p_files) <> 'array' or jsonb_array_length(p_files) > 1000
     or exists (
       select 1 from jsonb_array_elements(p_files) e
       where jsonb_typeof(e) <> 'object'
          or coalesce(length(e ->> 'path'), 0) not between 1 and 300
          or coalesce(length(e ->> 'base_name'), 0) not between 1 and 300
          or jsonb_typeof(e -> 'byte_size') <> 'number'
          or (e ->> 'sha256' is not null and e ->> 'sha256' !~ '^[0-9a-f]{64}$')
          or (e ->> 'problem' is not null and length(e ->> 'problem') > 200)
     ) then
    raise exception 'the ZIP''s file list is not valid' using errcode = '22023';
  end if;
  insert into public.migration_files (organization_id, batch_id, path, base_name, byte_size, sha256, media_type, problem)
  select p_org, p_batch, e ->> 'path', e ->> 'base_name', (e ->> 'byte_size')::bigint, e ->> 'sha256',
         case when e ->> 'media_type' in ('application/pdf', 'image/jpeg', 'image/png', 'image/heic',
                                           'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
              then e ->> 'media_type' end,
         e ->> 'problem'
  from jsonb_array_elements(p_files) e;
  get diagnostics n = row_count;
  update public.migration_batches set
    attachment_name = v_name, attachment_sha256 = p_sha256, attachment_bytes = p_bytes, attachment_files = n
  where id = p_batch;
  perform app.record_audit_event(p_org, 'migration.files_staged', 'public.migration_batches', p_batch, 'success',
    jsonb_build_object('files', n, 'bytes', p_bytes, 'sha256', p_sha256));
  return n;
end;
$$;

create or replace function public.save_migration_mapping(p_org uuid, p_batch uuid, p_mapping jsonb)
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
  allowed_columns text[];
  value_fields text[];
  required text;
begin
  perform app.migration_owner(p_org, false);
  select * into b from public.migration_batches where id = p_batch and organization_id = p_org for update;
  if b.id is null then
    raise exception 'migration batch not found' using errcode = 'P0002';
  end if;
  if b.status not in ('staged', 'checked') or b.verified_at is null then
    raise exception 'this import can''t be mapped now' using errcode = '22023';
  end if;
  allowed_columns := app.migration_kind_columns(b.kind);
  value_fields := app.migration_kind_values(b.kind);
  if p_mapping is null or jsonb_typeof(p_mapping) <> 'object'
     or exists (
       select 1 from jsonb_object_keys(p_mapping) key
       where key not in ('columns', 'values', 'date_order', 'default_consultant', 'default_owner', 'default_date_kind', 'sensitivity')
     )
     or jsonb_typeof(coalesce(p_mapping -> 'columns', '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_mapping -> 'values', '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_mapping -> 'sensitivity', '{}'::jsonb)) <> 'object' then
    raise exception 'the mapping is not valid' using errcode = '22023';
  end if;
  for k, v in select key, value from jsonb_each(coalesce(p_mapping -> 'columns', '{}'::jsonb)) loop
    if not (k = any(allowed_columns)) then
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
  if b.kind = 'clients_matters' then
    if coalesce(p_mapping -> 'columns' ->> 'name', '') = '' then
      raise exception 'map a column to the person''s name' using errcode = '22023';
    end if;
  else
    foreach required in array app.migration_kind_required(b.kind) loop
      if coalesce(p_mapping -> 'columns' ->> required, '') = '' then
        raise exception 'map a column to each required field (%)', required using errcode = '22023';
      end if;
    end loop;
    if b.kind = 'notes' and coalesce(p_mapping -> 'columns' ->> 'reference', '') = '' and coalesce(p_mapping -> 'columns' ->> 'person', '') = '' then
      raise exception 'map a column to each required field (reference)' using errcode = '22023';
    end if;
  end if;
  if coalesce(p_mapping ->> 'date_order', 'dmy') not in ('dmy', 'mdy', 'ymd') then
    raise exception 'the mapping is not valid' using errcode = '22023';
  end if;
  if p_mapping ? 'default_consultant' and jsonb_typeof(p_mapping -> 'default_consultant') <> 'null'
     and coalesce(p_mapping ->> 'default_consultant', '') !~ '^[0-9a-f-]{36}$' then
    raise exception 'the mapping is not valid' using errcode = '22023';
  end if;
  if p_mapping ? 'default_owner' and jsonb_typeof(p_mapping -> 'default_owner') <> 'null'
     and coalesce(p_mapping ->> 'default_owner', '') !~ '^[0-9a-f-]{36}$' then
    raise exception 'the mapping is not valid' using errcode = '22023';
  end if;
  if p_mapping ? 'default_date_kind' and jsonb_typeof(p_mapping -> 'default_date_kind') <> 'null'
     and coalesce(p_mapping ->> 'default_date_kind', '') not in ('legal', 'correspondence', 'internal') then
    raise exception 'the mapping is not valid' using errcode = '22023';
  end if;
  for field, v in select key, value from jsonb_each(coalesce(p_mapping -> 'values', '{}'::jsonb)) loop
    if not (field = any(value_fields)) or jsonb_typeof(v) <> 'object' then
      raise exception 'the mapping is not valid' using errcode = '22023';
    end if;
    for entry in select key, value from jsonb_each(v) loop
      if jsonb_typeof(entry.value) <> 'string' or length(entry.key) > 200 or length(entry.value #>> '{}') > 60 then
        raise exception 'the mapping is not valid' using errcode = '22023';
      end if;
    end loop;
  end loop;
  -- Sensitive columns: a zero-based column index and its class.
  for k, v in select key, value from jsonb_each(coalesce(p_mapping -> 'sensitivity', '{}'::jsonb)) loop
    if k !~ '^[0-9]{1,2}$' or k::integer >= cardinality(b.headers)
       or jsonb_typeof(v) <> 'string' or (v #>> '{}') not in ('identity', 'narrative', 'health', 'financial') then
      raise exception 'the mapping is not valid' using errcode = '22023';
    end if;
  end loop;
  update public.migration_batches set
    mapping = p_mapping,
    sensitivity = coalesce(p_mapping -> 'sensitivity', '{}'::jsonb),
    status = 'staged',
    plan_hash = null,
    plan_counts = null,
    checked_at = null
  where id = p_batch;
  perform app.record_audit_event(p_org, 'migration.mapped', 'public.migration_batches', p_batch, 'success',
    jsonb_build_object(
      'columns', (select count(*) from jsonb_each(coalesce(p_mapping -> 'columns', '{}'::jsonb)) c where jsonb_typeof(c.value) = 'number'),
      'sensitive_columns', (select count(*) from jsonb_object_keys(coalesce(p_mapping -> 'sensitivity', '{}'::jsonb))),
      'kind', b.kind
    ));
end;
$$;

create or replace function public.run_migration_dry_run(p_org uuid, p_batch uuid)
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
  if b.kind = 'clients_matters' then
    if coalesce(b.mapping -> 'columns' ->> 'name', '') = '' then
      raise exception 'map a column to the person''s name' using errcode = '22023';
    end if;
  elsif coalesce(b.mapping -> 'columns', '{}'::jsonb) = '{}'::jsonb then
    raise exception 'map a column to each required field' using errcode = '22023';
  end if;
  if b.kind = 'documents' and b.attachment_sha256 is null then
    raise exception 'add the ZIP of files first' using errcode = '22023';
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

create or replace function public.decide_migration_duplicate(p_org uuid, p_batch uuid, p_row integer, p_same boolean)
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
  if r.id is null or (r.match_person_id is null and r.match_row_number is null and r.match_record_id is null) then
    raise exception 'this row has no possible match' using errcode = '22023';
  end if;
  v_target := case
    when r.match_person_id is not null then 'person:' || r.match_person_id
    when r.match_record_id is not null then 'record:' || r.match_record_id
    else 'row:' || r.match_row_number
  end;
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
                       'person_id', r.match_person_id, 'record_id', r.match_record_id));
  return result;
end;
$$;

revoke all on function public.set_migration_kind(uuid, uuid, text) from public, anon;
revoke all on function public.stage_migration_files(uuid, uuid, text, text, bigint, jsonb) from public, anon;
grant execute on function public.set_migration_kind(uuid, uuid, text) to authenticated;
grant execute on function public.stage_migration_files(uuid, uuid, text, text, bigint, jsonb) to authenticated;
