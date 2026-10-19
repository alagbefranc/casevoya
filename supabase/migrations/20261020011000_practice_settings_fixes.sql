-- Practice and settings audit fixes (branch fix-practice-settings). Additive: one new helper and
-- three redefined functions, each copied from its latest definition with only the change below.
--
-- * app.is_iso_country(text): true for an officially assigned ISO 3166-1 alpha-2 code (249).
--   Kept in step with src/lib/iso-country.ts.
-- * public.save_firm_office (latest: 20261019211000_firm_settings.sql): the country must be an
--   ISO 3166-1 alpha-2 code ("XX" is refused), and a new office with the same name, street and
--   city as one already saved is refused (a second save of the Add an office dialog made a
--   duplicate). Editing an office is unchanged.
-- * public.save_migration_mapping (latest: 20261019208100_migration_import.sql): accepts the
--   optional column key 'name_extra' (a second name column, e.g. last name).
-- * app.migration_evaluate (latest: 20261019216100_firm_today_rules.sql): the person's name is the
--   'name' column and, when mapped, the 'name_extra' column joined with a space; and a row whose
--   cells are exactly those of an earlier row is planned 'skip' with the problem "An exact copy of
--   row N" instead of becoming an additional person on the matter.
-- * app.migration_date (latest: 20261019208100_migration_import.sql): an ISO date followed by a
--   time ("1990-05-14 00:00:00", "1990-05-14T00:00Z") reads as that date.
-- No table, policy or grant changes.

create function app.is_iso_country(p_code text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_code = any (array['AD','AE','AF','AG','AI','AL','AM','AO','AQ','AR','AS','AT','AU','AW','AX','AZ','BA','BB','BD','BE','BF','BG','BH','BI','BJ','BL','BM','BN','BO','BQ','BR','BS','BT','BV','BW','BY','BZ','CA','CC','CD','CF','CG','CH','CI','CK','CL','CM','CN','CO','CR','CU','CV','CW','CX','CY','CZ','DE','DJ','DK','DM','DO','DZ','EC','EE','EG','EH','ER','ES','ET','FI','FJ','FK','FM','FO','FR','GA','GB','GD','GE','GF','GG','GH','GI','GL','GM','GN','GP','GQ','GR','GS','GT','GU','GW','GY','HK','HM','HN','HR','HT','HU','ID','IE','IL','IM','IN','IO','IQ','IR','IS','IT','JE','JM','JO','JP','KE','KG','KH','KI','KM','KN','KP','KR','KW','KY','KZ','LA','LB','LC','LI','LK','LR','LS','LT','LU','LV','LY','MA','MC','MD','ME','MF','MG','MH','MK','ML','MM','MN','MO','MP','MQ','MR','MS','MT','MU','MV','MW','MX','MY','MZ','NA','NC','NE','NF','NG','NI','NL','NO','NP','NR','NU','NZ','OM','PA','PE','PF','PG','PH','PK','PL','PM','PN','PR','PS','PT','PW','PY','QA','RE','RO','RS','RU','RW','SA','SB','SC','SD','SE','SG','SH','SI','SJ','SK','SL','SM','SN','SO','SR','SS','ST','SV','SX','SY','SZ','TC','TD','TF','TG','TH','TJ','TK','TL','TM','TN','TO','TR','TT','TV','TW','TZ','UA','UG','UM','US','UY','UZ','VA','VC','VE','VG','VI','VN','VU','WF','WS','YE','YT','ZA','ZM','ZW']::text[]), false);
$$;
comment on function app.is_iso_country(text) is
  'True for an officially assigned ISO 3166-1 alpha-2 country code (upper case). Kept in step with src/lib/iso-country.ts.';
revoke all on function app.is_iso_country(text) from public, anon;
grant execute on function app.is_iso_country(text) to authenticated, service_role;

create or replace function public.save_firm_office(
  p_organization_id uuid,
  p_office_id uuid,
  p_label text,
  p_address_line text,
  p_locality text,
  p_region text,
  p_postal_code text,
  p_country_code text,
  p_timezone text,
  p_is_primary boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  office_id uuid := p_office_id;
  country text := upper(btrim(coalesce(p_country_code, 'CA')));
  zone text := nullif(btrim(coalesce(p_timezone, '')), '');
  was_primary boolean;
begin
  perform app.require_firm_owner_step_up(p_organization_id);
  if length(btrim(coalesce(p_label, ''))) not between 1 and 120
     or length(btrim(coalesce(p_address_line, ''))) not between 1 and 300
     or length(btrim(coalesce(p_locality, ''))) not between 1 and 120
     or length(btrim(coalesce(p_region, ''))) > 80
     or length(btrim(coalesce(p_postal_code, ''))) > 20
     or country !~ '^[A-Z]{2}$' then
    raise exception 'office address is incomplete' using errcode = '22023';
  end if;
  if not app.is_iso_country(country) then
    raise exception 'country code is not an ISO 3166 alpha-2 code' using errcode = '22023';
  end if;
  if zone is not null and not app.is_known_timezone(zone) then
    raise exception 'timezone is not usable' using errcode = '22023';
  end if;

  if office_id is not null then
    select office.is_primary into was_primary
      from public.organization_offices office
     where office.id = office_id and office.organization_id = p_organization_id
     for update;
    if not found then
      raise exception 'office not found' using errcode = '42501';
    end if;
    if was_primary and not coalesce(p_is_primary, false) then
      raise exception 'choose another main office first' using errcode = '22023';
    end if;
  end if;

  if coalesce(p_is_primary, false) then
    update public.organization_offices
       set is_primary = false
     where organization_id = p_organization_id
       and is_primary
       and id is distinct from office_id;
  end if;

  -- The same new office saved twice (a second click, or a dialog that kept its values) adds nothing.
  if office_id is null and exists (
    select 1 from public.organization_offices same
     where same.organization_id = p_organization_id
       and lower(regexp_replace(btrim(same.label), '\s+', ' ', 'g')) = lower(regexp_replace(btrim(p_label), '\s+', ' ', 'g'))
       and lower(regexp_replace(btrim(same.address_line), '\s+', ' ', 'g')) = lower(regexp_replace(btrim(p_address_line), '\s+', ' ', 'g'))
       and lower(regexp_replace(btrim(same.locality), '\s+', ' ', 'g')) = lower(regexp_replace(btrim(p_locality), '\s+', ' ', 'g'))
  ) then
    raise exception 'that office is already saved' using errcode = '23505';
  end if;

  if office_id is null then
    insert into public.organization_offices (
      organization_id, label, address_line, locality, region, postal_code, country_code, timezone, is_primary
    ) values (
      p_organization_id,
      btrim(p_label),
      btrim(p_address_line),
      btrim(p_locality),
      nullif(btrim(coalesce(p_region, '')), ''),
      nullif(btrim(coalesce(p_postal_code, '')), ''),
      country,
      zone,
      coalesce(p_is_primary, false)
    )
    returning id into office_id;
  else
    update public.organization_offices
       set label = btrim(p_label),
           address_line = btrim(p_address_line),
           locality = btrim(p_locality),
           region = nullif(btrim(coalesce(p_region, '')), ''),
           postal_code = nullif(btrim(coalesce(p_postal_code, '')), ''),
           country_code = country,
           timezone = zone,
           is_primary = coalesce(p_is_primary, false)
     where id = office_id
       and organization_id = p_organization_id;
  end if;

  perform app.record_audit_event(
    p_organization_id,
    'firm.office_saved',
    'public.organization_offices',
    office_id,
    'success',
    jsonb_build_object('created', p_office_id is null, 'primary', coalesce(p_is_primary, false))
  );
  return office_id;
end;
$$;

create or replace function app.migration_date(p_raw text, p_order text)
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
  -- An ISO date with a time (as spreadsheets export it) is the same date: the time is dropped.
  if v ~ '^\d{4}-\d{1,2}-\d{1,2}[T ]\d{1,2}:\d{2}' then
    v := split_part(split_part(v, 'T', 1), ' ', 1);
  end if;
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
    if k not in ('name', 'name_extra', 'email', 'date_of_birth', 'phone', 'role', 'reference', 'title', 'program', 'stage', 'consultant', 'case_manager') then
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

create or replace function app.migration_evaluate(p_batch uuid)
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
