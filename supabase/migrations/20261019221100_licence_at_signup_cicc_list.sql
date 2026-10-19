-- Only licensed consultants sign up (decision 2026-10-19, approved by Francis: "For someone to
-- sign up means they have a full licence").
--
--   1. Licence at sign-up. public.create_firm_with_licence creates the firm, the owner's
--      membership and the owner's declared CICC credential in one transaction. Proof stays
--      optional (public.set_credential_proof attaches one later). The firm starts live
--      (sample_mode false). public.create_organization is unchanged (tests and ops use it); a firm
--      made that way has no licence on file, so app.real_client_invite_blockers keeps its real
--      client invitations locked (owner_licence_missing).
--   2. Firms start live. app.real_client_invite_blockers no longer lists the six practice steps or
--      waits for a register check (firm_unverified, licence_not_verified). A declared licence on an
--      active firm owner that is not revoked, suspended, inactive or not entitled (on the credential
--      or its discipline flags) is enough. trial_ended stays. A firm moved to restricted stays
--      blocked. The sample case and its practice steps stay as an optional tour
--      (app.ensure_sample_case, app.complete_sample_proof and app.set_sample_mode are unchanged).
--      Existing sample-mode firms are not changed here: their owner switches to live once the new
--      blockers are clear.
--   3. CICC register list. Platform admins import the list the College publishes
--      (public.cicc_register_imports / public.cicc_register_entries; platform admins only, no firm
--      access). app.cicc_list_check matches a credential against the latest complete import:
--      normalized number, then the name loosely (last name plus first initial, case and accent
--      insensitive), then the list status. It records a public.credential_checks row with method
--      cicc_list and the import as evidence:
--        * match, status active: the credential is verified (verification_method cicc_list) and the
--          firm becomes verified through app.sync_firm_verification;
--        * match, status inactive / suspended / revoked, or active but not entitled: that status,
--          which locks the consultant as a manual check would;
--        * no match (number not on the list, name differs, status not recognised): result
--          needs_review; the credential's status is not changed and nothing is locked.
--      A list result never lifts an adverse status recorded by a manual register check.
--      The check runs when a credential is inserted (any path) if an import exists, and for every
--      credential when an import finishes. app.firm_has_verified_licence accepts cicc_list.
--      public.cicc_needs_review_credentials lists the credentials whose latest check is a
--      needs_review list check (platform admins). public.record_licence_check (manual check) is
--      unchanged and already open to platform admins with a step-up.
--
-- Nothing here contacts the CICC register. Redefined functions are copied from their latest
-- definition (named above each) with only the change described.

-- ---------------------------------------------------------------------------
-- The imported list
-- ---------------------------------------------------------------------------
create table public.cicc_register_imports (
  id uuid primary key default gen_random_uuid(),
  imported_at timestamptz not null default now(),
  imported_by uuid not null references auth.users (id),
  source_note text not null check (length(btrim(source_note)) between 1 and 500),
  row_count integer not null default 0 check (row_count >= 0),
  file_locator text check (file_locator is null or length(btrim(file_locator)) between 1 and 500),
  file_sha256 text check (file_sha256 is null or file_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'loading' check (status in ('loading', 'complete')),
  completed_at timestamptz,
  constraint cicc_register_imports_file_ck check (file_locator is not null or file_sha256 is not null),
  constraint cicc_register_imports_complete_ck check ((status = 'complete') = (completed_at is not null))
);
comment on table public.cicc_register_imports is
  'One import of the CICC register list that the College publishes and a platform admin downloaded. Platform admins only. The file itself is kept outside the database; file_locator and/or file_sha256 identify it.';

create index cicc_register_imports_imported_by_idx on public.cicc_register_imports (imported_by);
create index cicc_register_imports_latest_idx on public.cicc_register_imports (status, completed_at desc);

create table public.cicc_register_entries (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.cicc_register_imports (id),
  licence_number text not null check (licence_number ~ '^[A-Z0-9]{1,40}$'),
  licence_number_raw text not null check (length(btrim(licence_number_raw)) between 1 and 80),
  full_name text not null check (length(btrim(full_name)) between 1 and 300),
  first_name text check (first_name is null or length(first_name) <= 200),
  last_name text check (last_name is null or length(last_name) <= 200),
  licence_class text check (licence_class is null or length(licence_class) <= 200),
  status text not null check (length(btrim(status)) between 1 and 200),
  entitlement text check (entitlement is null or length(entitlement) <= 200),
  college_fields jsonb not null default '{}'::jsonb
    check (jsonb_typeof(college_fields) = 'object' and pg_column_size(college_fields) <= 8000),
  created_at timestamptz not null default now()
);
comment on table public.cicc_register_entries is
  'One row of an imported CICC register list. licence_number is normalized (uppercase letters and digits only); every other value is the text the College reported. college_fields keeps the remaining columns as text. Platform admins only.';

create index cicc_register_entries_import_number_idx on public.cicc_register_entries (import_id, licence_number);

revoke all on table public.cicc_register_imports from anon, authenticated, service_role;
revoke all on table public.cicc_register_entries from anon, authenticated, service_role;
grant select on table public.cicc_register_imports to authenticated, service_role;
grant select on table public.cicc_register_entries to authenticated, service_role;

alter table public.cicc_register_imports enable row level security;
alter table public.cicc_register_imports force row level security;
alter table public.cicc_register_entries enable row level security;
alter table public.cicc_register_entries force row level security;

create policy cicc_register_imports_select on public.cicc_register_imports
  for select to authenticated
  using ((select app.is_platform_admin()));
create policy cicc_register_entries_select on public.cicc_register_entries
  for select to authenticated
  using ((select app.is_platform_admin()));

-- ---------------------------------------------------------------------------
-- A list check is a licence check: method cicc_list with the import as evidence. A list row
-- carries no register URL, proof file or discipline detail, so those columns are required only
-- for a manual register check. The not-null relaxations keep every existing row valid.
-- ---------------------------------------------------------------------------
alter table public.credential_checks
  alter column source_url drop not null,
  alter column source_host drop not null,
  alter column proof_locator drop not null,
  alter column register_status drop not null,
  alter column entitlement_to_practise drop not null,
  alter column discipline_suspended drop not null,
  alter column discipline_revoked drop not null,
  alter column discipline_restricted drop not null;

alter table public.credential_checks drop constraint credential_checks_method_check;

alter table public.credential_checks
  add column cicc_import_id uuid references public.cicc_register_imports (id),
  add column cicc_entry_id uuid references public.cicc_register_entries (id);

alter table public.credential_checks
  add constraint credential_checks_method_check check (method in ('manual_public_register', 'cicc_list')),
  add constraint credential_checks_method_evidence_ck check (
    (
      method = 'manual_public_register'
      and cicc_import_id is null
      and cicc_entry_id is null
      and source_url is not null
      and source_host is not null
      and proof_locator is not null
      and register_status is not null
      and entitlement_to_practise is not null
      and discipline_suspended is not null
      and discipline_revoked is not null
      and discipline_restricted is not null
    )
    or (method = 'cicc_list' and cicc_import_id is not null)
  );

create index credential_checks_cicc_import_idx on public.credential_checks (cicc_import_id);
create index credential_checks_cicc_entry_idx on public.credential_checks (cicc_entry_id);

comment on column public.credential_checks.cicc_import_id is
  'The CICC register list import a cicc_list check matched against. Null for a manual register check.';
comment on column public.credential_checks.cicc_entry_id is
  'The list row the number matched, when there was one.';

alter table public.consultant_credentials drop constraint consultant_credentials_verification_method_check;
alter table public.consultant_credentials
  add constraint consultant_credentials_verification_method_check check (
    verification_method is null or verification_method in ('manual_public_register', 'cicc_list')
  );

-- ---------------------------------------------------------------------------
-- Matching helpers
-- ---------------------------------------------------------------------------
create function app.normalize_licence_number(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(upper(regexp_replace(coalesce(p_value, ''), '[^A-Za-z0-9]', '', 'g')), '');
$$;
comment on function app.normalize_licence_number(text) is
  'Uppercase letters and digits only: "r 512-345" and "R512345" compare equal. Not a published CICC number format.';
revoke all on function app.normalize_licence_number(text) from public;

create function app.cicc_fold(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(
    lower(translate(
      coalesce(p_value, ''),
      'ÀÁÂÃÄÅàáâãäåÈÉÊËèéêëÌÍÎÏìíîïÒÓÔÕÖØòóôõöøÙÚÛÜùúûüÝýÿÑñÇç',
      'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOOooooooUUUUuuuuYyyNnCc'
    )),
    '[^a-z]', '', 'g'
  );
$$;
comment on function app.cicc_fold(text) is
  'Letters only, lower case, common Latin accents removed: "Lévesque-Côté" and "LEVESQUE COTE" fold to the same text.';
revoke all on function app.cicc_fold(text) from public;

-- {first initial, last-name candidate, ...}: from separate first/last names, "Last, First" or
-- "First Middle Last". Candidates are the last word and every word after the first, folded.
create function app.cicc_name_key(p_first text, p_last text, p_full text)
returns text[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  first_name text := btrim(coalesce(p_first, ''));
  last_name text := btrim(coalesce(p_last, ''));
  full_name text := btrim(coalesce(p_full, ''));
  words text[];
  candidates text[] := array[]::text[];
  initial text;
begin
  if last_name = '' and full_name <> '' then
    if position(',' in full_name) > 0 then
      last_name := btrim(split_part(full_name, ',', 1));
      if first_name = '' then
        first_name := btrim(split_part(full_name, ',', 2));
      end if;
    else
      words := regexp_split_to_array(full_name, '\s+');
      if first_name = '' then
        first_name := words[1];
      end if;
      if cardinality(words) >= 2 then
        last_name := array_to_string(words[2:cardinality(words)], ' ');
      end if;
    end if;
  elsif first_name = '' and full_name <> '' then
    first_name := case
      when position(',' in full_name) > 0 then btrim(split_part(full_name, ',', 2))
      else (regexp_split_to_array(full_name, '\s+'))[1]
    end;
  end if;
  initial := left(app.cicc_fold(first_name), 1);
  if initial = '' or last_name = '' then
    return null;
  end if;
  words := regexp_split_to_array(last_name, '\s+');
  candidates := array_append(candidates, app.cicc_fold(last_name));
  candidates := array_append(candidates, app.cicc_fold(words[cardinality(words)]));
  return array_prepend(initial, array(select distinct c from unnest(candidates) c where c <> ''));
end;
$$;
revoke all on function app.cicc_name_key(text, text, text) from public;

create function app.cicc_name_matches(p_holder text, p_first text, p_last text, p_full text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  holder text[] := app.cicc_name_key(null, null, p_holder);
  entry text[] := app.cicc_name_key(p_first, p_last, p_full);
begin
  if holder is null or entry is null or holder[1] is distinct from entry[1] then
    return false;
  end if;
  return holder[2:cardinality(holder)] && entry[2:cardinality(entry)];
end;
$$;
comment on function app.cicc_name_matches(text, text, text, text) is
  'Loose name match for the CICC list: same first initial and the same last name (or last word of it), case and accent insensitive.';
revoke all on function app.cicc_name_matches(text, text, text, text) from public;

create function app.cicc_yes_no(p_value text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case lower(btrim(coalesce(p_value, '')))
    when 'yes' then true when 'y' then true when 'true' then true when '1' then true
    when 'no' then false when 'n' then false when 'false' then false when '0' then false
    else null
  end;
$$;
revoke all on function app.cicc_yes_no(text) from public;

-- The list's status words this check understands. Anything else is needs_review.
create function app.cicc_status_result(p_status text, p_entitlement text)
returns public.licence_check_result
language sql
immutable
set search_path = ''
as $$
  select case lower(btrim(coalesce(p_status, '')))
    when 'active' then
      case when app.cicc_yes_no(p_entitlement) is false
        then 'not_entitled'::public.licence_check_result
        else 'verified'::public.licence_check_result
      end
    when 'inactive' then 'inactive'::public.licence_check_result
    when 'suspended' then 'suspended'::public.licence_check_result
    when 'revoked' then 'revoked'::public.licence_check_result
    else null
  end;
$$;
comment on function app.cicc_status_result(text, text) is
  'Active (entitled unless the list says no), Inactive, Suspended, Revoked; case-insensitive. The import script maps other spellings to these words first.';
revoke all on function app.cicc_status_result(text, text) from public;

-- ---------------------------------------------------------------------------
-- The matcher. Internal: runs as the definer from the trigger, the import and the RPC below.
-- ---------------------------------------------------------------------------
create function app.cicc_list_check(p_credential_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  credential public.consultant_credentials%rowtype;
  latest public.cicc_register_imports%rowtype;
  entry public.cicc_register_entries%rowtype;
  holder text;
  lic_number text;
  result public.licence_check_result;
  matched boolean := false;
  applied boolean := false;
  reason text;
  register public.register_licence_status;
  entitled boolean;
  check_id uuid;
begin
  select * into credential from public.consultant_credentials where id = p_credential_id;
  if credential.id is null then
    return null;
  end if;
  select * into latest
  from public.cicc_register_imports imp
  where imp.status = 'complete'
  order by imp.completed_at desc, imp.imported_at desc
  limit 1;
  if latest.id is null then
    return null;
  end if;

  lic_number := app.normalize_licence_number(credential.college_id);
  select nullif(btrim(coalesce(prof.display_name, '')), '') into holder
  from public.memberships mem
  left join public.profiles prof on prof.id = mem.user_id
  where mem.id = credential.membership_id
    and mem.organization_id = credential.organization_id;

  select e.* into entry
  from public.cicc_register_entries e
  where e.import_id = latest.id
    and e.licence_number = lic_number
  order by app.cicc_name_matches(holder, e.first_name, e.last_name, e.full_name) desc, e.created_at, e.id
  limit 1;

  if entry.id is null then
    result := 'needs_review';
    reason := 'Licence number is not on the CICC list';
  elsif not app.cicc_name_matches(holder, entry.first_name, entry.last_name, entry.full_name) then
    result := 'needs_review';
    reason := 'Name does not match the CICC list';
  else
    result := app.cicc_status_result(entry.status, entry.entitlement);
    if result is null then
      result := 'needs_review';
      reason := left('CICC list status not recognised: ' || btrim(entry.status), 500);
    else
      matched := true;
      reason := 'Matched on the CICC list';
    end if;
  end if;

  if matched then
    register := case
      when result = 'inactive' then 'inactive'::public.register_licence_status
      when result in ('verified', 'not_entitled') then 'active'::public.register_licence_status
      else null
    end;
    entitled := case when result = 'not_entitled' then false else app.cicc_yes_no(entry.entitlement) end;
    -- A list result never lifts an adverse status a reviewer recorded from the register by hand.
    applied := not (
      result = 'verified'
      and app.licence_status_blocks(credential.status)
      and credential.verification_method = 'manual_public_register'
    );
    if not applied then
      reason := reason || '; the adverse manual register check is kept';
    end if;
  end if;

  insert into public.credential_checks (
    organization_id, credential_id, method, cicc_import_id, cicc_entry_id, retrieved_at, result,
    register_status, entitlement_to_practise, discipline_suspended, discipline_revoked,
    reviewer_user_id, notes, created_at
  ) values (
    credential.organization_id,
    credential.id,
    'cicc_list',
    latest.id,
    entry.id,
    latest.imported_at,
    result,
    register,
    entitled,
    case when matched then result = 'suspended' else null end,
    case when matched then result = 'revoked' else null end,
    latest.imported_by,
    reason,
    clock_timestamp()
  )
  returning id into check_id;

  if matched and applied then
    update public.consultant_credentials
       set status = result::text::public.credential_status,
           verification_method = 'cicc_list',
           source_url = null,
           register_status = register,
           entitlement_to_practise = entitled,
           discipline_suspended = (result = 'suspended'),
           discipline_revoked = (result = 'revoked'),
           checked_at = latest.imported_at,
           reviewer_user_id = latest.imported_by
     where id = credential.id;

    if result in ('revoked', 'suspended', 'inactive', 'not_entitled') then
      perform app.enqueue_licence_event(
        credential.organization_id,
        credential.id,
        'licence.adverse_status',
        jsonb_build_object('credential_id', credential.id, 'check_id', check_id, 'status', result, 'result', result, 'method', 'cicc_list'),
        'licence.adverse_status:' || check_id::text,
        statement_timestamp()
      );
    end if;
  end if;

  perform app.sync_firm_verification(credential.organization_id);

  perform app.record_audit_event(
    credential.organization_id,
    'licence.check_recorded',
    'public.credential_checks',
    check_id,
    'success',
    jsonb_build_object(
      'result', result,
      'method', 'cicc_list',
      'import_id', latest.id,
      'matched', matched,
      'applied', matched and applied
    )
  );
  return check_id;
end;
$$;
comment on function app.cicc_list_check(uuid) is
  'Matches one credential against the latest complete CICC list import and records a cicc_list licence check. Null when no import exists. Internal: no API role may call it directly.';
revoke all on function app.cicc_list_check(uuid) from public;

-- Run the check when a licence is declared (every path inserts a credential), once a list exists.
create function app.cicc_check_new_credential()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.cicc_register_imports imp where imp.status = 'complete') then
    perform app.cicc_list_check(new.id);
  end if;
  return null;
end;
$$;
revoke all on function app.cicc_check_new_credential() from public;

create trigger consultant_credentials_cicc_check after insert on public.consultant_credentials
  for each row execute function app.cicc_check_new_credential();

-- ---------------------------------------------------------------------------
-- Import (platform admins, or the service role naming the platform admin who imports)
-- ---------------------------------------------------------------------------
create function app.cicc_admin_caller()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when (select auth.uid()) is not null then app.is_platform_admin() is true
    else app.current_actor_type() = 'service'
  end;
$$;
comment on function app.cicc_admin_caller() is
  'A signed-in platform admin at aal2, or the service role (ops scripts). Firm staff never.';
revoke all on function app.cicc_admin_caller() from public;

create function app.cicc_importer(p_imported_by uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null then
    if app.is_platform_admin() is distinct from true then
      raise exception 'CICC list import denied' using errcode = '42501';
    end if;
    return (select auth.uid());
  end if;
  if app.current_actor_type() is distinct from 'service' then
    raise exception 'CICC list import denied' using errcode = '42501';
  end if;
  if p_imported_by is null
     or not exists (select 1 from public.platform_admins pa where pa.user_id = p_imported_by) then
    raise exception 'name the platform admin who imports the list' using errcode = '22023';
  end if;
  return p_imported_by;
end;
$$;
revoke all on function app.cicc_importer(uuid) from public;

create function app.start_cicc_register_import(
  p_source_note text,
  p_file_locator text,
  p_file_sha256 text,
  p_imported_by uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  importer uuid := app.cicc_importer(p_imported_by);
  import_id uuid;
begin
  if length(btrim(coalesce(p_source_note, ''))) not between 1 and 500 then
    raise exception 'describe where the list came from' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_file_locator, '')), '') is null and nullif(btrim(coalesce(p_file_sha256, '')), '') is null then
    raise exception 'give the list file''s storage locator or its sha256' using errcode = '22023';
  end if;
  insert into public.cicc_register_imports (imported_by, source_note, file_locator, file_sha256)
  values (
    importer,
    btrim(p_source_note),
    nullif(btrim(coalesce(p_file_locator, '')), ''),
    lower(nullif(btrim(coalesce(p_file_sha256, '')), ''))
  )
  returning id into import_id;
  perform app.record_audit_event(
    null, 'cicc_register.import_started', 'public.cicc_register_imports', import_id, 'success',
    jsonb_build_object('imported_by', importer)
  );
  return import_id;
end;
$$;
revoke all on function app.start_cicc_register_import(text, text, text, uuid) from public;

create function app.import_cicc_register(p_import_id uuid, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  imp public.cicc_register_imports%rowtype;
  row_value jsonb;
  row_no integer := 0;
  lic_number text;
  full_name text;
  first_name text;
  last_name text;
  fields jsonb;
begin
  if not app.cicc_admin_caller() then
    raise exception 'CICC list import denied' using errcode = '42501';
  end if;
  select * into imp from public.cicc_register_imports where id = p_import_id for update;
  if imp.id is null or imp.status <> 'loading' then
    raise exception 'that CICC list import is not open' using errcode = '22023';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) not between 1 and 5000 then
    raise exception 'send 1 to 5000 list rows at a time' using errcode = '22023';
  end if;
  for row_value in select value from jsonb_array_elements(p_rows) loop
    row_no := row_no + 1;
    if jsonb_typeof(row_value) <> 'object' then
      raise exception 'list row % is not an object', row_no using errcode = '22023';
    end if;
    lic_number := app.normalize_licence_number(row_value ->> 'licence_number');
    first_name := nullif(btrim(coalesce(row_value ->> 'first_name', '')), '');
    last_name := nullif(btrim(coalesce(row_value ->> 'last_name', '')), '');
    full_name := coalesce(
      nullif(btrim(coalesce(row_value ->> 'full_name', '')), ''),
      nullif(btrim(concat_ws(' ', first_name, last_name)), '')
    );
    fields := coalesce(row_value -> 'fields', '{}'::jsonb);
    if lic_number is null or length(lic_number) > 40 then
      raise exception 'list row % has no usable licence number', row_no using errcode = '22023';
    end if;
    if full_name is null then
      raise exception 'list row % has no name', row_no using errcode = '22023';
    end if;
    if nullif(btrim(coalesce(row_value ->> 'status', '')), '') is null then
      raise exception 'list row % has no status', row_no using errcode = '22023';
    end if;
    if jsonb_typeof(fields) <> 'object'
       or exists (select 1 from jsonb_each(fields) f where jsonb_typeof(f.value) not in ('string', 'null')) then
      raise exception 'list row % fields must be text', row_no using errcode = '22023';
    end if;
    insert into public.cicc_register_entries (
      import_id, licence_number, licence_number_raw, full_name, first_name, last_name,
      licence_class, status, entitlement, college_fields
    ) values (
      imp.id,
      lic_number,
      left(btrim(row_value ->> 'licence_number'), 80),
      left(full_name, 300),
      left(first_name, 200),
      left(last_name, 200),
      left(nullif(btrim(coalesce(row_value ->> 'licence_class', '')), ''), 200),
      left(btrim(row_value ->> 'status'), 200),
      left(nullif(btrim(coalesce(row_value ->> 'entitlement', '')), ''), 200),
      fields
    );
  end loop;
  return row_no;
end;
$$;
comment on function app.import_cicc_register(uuid, jsonb) is
  'Adds up to 5000 rows to an open CICC list import. Each row: licence_number, full_name (or first_name and last_name), status, and optionally licence_class, entitlement and fields (an object of text).';
revoke all on function app.import_cicc_register(uuid, jsonb) from public;

create function app.finish_cicc_register_import(p_import_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  imp public.cicc_register_imports%rowtype;
  total integer;
  credential_id uuid;
  check_id uuid;
  checked integer := 0;
  verified integer := 0;
  needs_review integer := 0;
  adverse integer := 0;
  outcome public.licence_check_result;
begin
  if not app.cicc_admin_caller() then
    raise exception 'CICC list import denied' using errcode = '42501';
  end if;
  select * into imp from public.cicc_register_imports where id = p_import_id for update;
  if imp.id is null or imp.status <> 'loading' then
    raise exception 'that CICC list import is not open' using errcode = '22023';
  end if;
  select count(*) into total from public.cicc_register_entries where import_id = imp.id;
  if total = 0 then
    raise exception 'the CICC list import has no rows' using errcode = '22023';
  end if;
  update public.cicc_register_imports
     set status = 'complete', completed_at = clock_timestamp(), row_count = total
   where id = imp.id;

  -- Re-check every credential against the new list.
  for credential_id in select c.id from public.consultant_credentials c order by c.organization_id, c.id loop
    check_id := app.cicc_list_check(credential_id);
    if check_id is not null then
      checked := checked + 1;
      select chk.result into outcome from public.credential_checks chk where chk.id = check_id;
      if outcome = 'verified' then
        verified := verified + 1;
      elsif outcome = 'needs_review' then
        needs_review := needs_review + 1;
      else
        adverse := adverse + 1;
      end if;
    end if;
  end loop;

  perform app.record_audit_event(
    null, 'cicc_register.imported', 'public.cicc_register_imports', imp.id, 'success',
    jsonb_build_object('row_count', total, 'checked', checked, 'verified', verified, 'needs_review', needs_review, 'adverse', adverse)
  );
  return jsonb_build_object(
    'import_id', imp.id, 'row_count', total, 'checked', checked,
    'verified', verified, 'needs_review', needs_review, 'adverse', adverse
  );
end;
$$;
revoke all on function app.finish_cicc_register_import(uuid) from public;

-- A platform admin (or the service role) re-runs the list check for one credential.
create function app.check_licence_against_cicc_list(p_credential_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  check_id uuid;
begin
  if not app.cicc_admin_caller() then
    raise exception 'licence check denied' using errcode = '42501';
  end if;
  if not exists (select 1 from public.consultant_credentials where id = p_credential_id) then
    raise exception 'licence check denied' using errcode = '42501';
  end if;
  check_id := app.cicc_list_check(p_credential_id);
  if check_id is null then
    raise exception 'no CICC list has been imported yet' using errcode = '22023';
  end if;
  return check_id;
end;
$$;
revoke all on function app.check_licence_against_cicc_list(uuid) from public;

-- ---------------------------------------------------------------------------
-- From 20261018050000_owner_licence_and_proofs.sql. A verified cicc_list check counts too; the
-- list may not say whether the holder is entitled to practise, so for cicc_list an unknown
-- entitlement counts and only an explicit "no" (status not_entitled) does not.
-- ---------------------------------------------------------------------------
create or replace function app.firm_has_verified_licence(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.consultant_credentials credential
    join public.memberships mem
      on mem.id = credential.membership_id
     and mem.organization_id = credential.organization_id
    where credential.organization_id = p_org
      and mem.role in ('licensed_consultant', 'firm_owner')
      and mem.status = 'active'
      and credential.status = 'verified'
      and credential.verification_method in ('manual_public_register', 'cicc_list')
      and credential.register_status = 'active'
      and (
        credential.entitlement_to_practise is true
        or (credential.verification_method = 'cicc_list' and credential.entitlement_to_practise is null)
      )
      and credential.discipline_suspended is false
      and credential.discipline_revoked is false
      and not app.licence_status_blocks(credential.status)
  );
$$;

-- ---------------------------------------------------------------------------
-- From 20261017140700_firm_onboarding.sql. Firms start live: no practice steps and no wait for a
-- register check. A declared licence on an active firm owner that is not blocked is enough.
-- Order: firm_not_found alone; otherwise firm_restricted, owner_licence_missing or
-- owner_licence_blocked, trial_ended. src/modules/sheet/setup-present.ts mirrors this.
-- ---------------------------------------------------------------------------
create or replace function app.real_client_invite_blockers(p_org uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  blockers text[] := array[]::text[];
  status public.org_verification_status;
begin
  select verification_status into status from public.organizations where id = p_org;
  if status is null then
    return array['firm_not_found']::text[];
  end if;
  if status = 'restricted' then
    blockers := array_append(blockers, 'firm_restricted');
  end if;
  if not exists (
    select 1
    from public.consultant_credentials credential
    join public.memberships mem
      on mem.id = credential.membership_id
     and mem.organization_id = credential.organization_id
    where credential.organization_id = p_org
      and mem.role = 'firm_owner'
      and mem.status = 'active'
  ) then
    blockers := array_append(blockers, 'owner_licence_missing');
  elsif exists (
    select 1
    from public.consultant_credentials credential
    join public.memberships mem
      on mem.id = credential.membership_id
     and mem.organization_id = credential.organization_id
    where credential.organization_id = p_org
      and mem.role = 'firm_owner'
      and mem.status = 'active'
      and (
        app.licence_status_blocks(credential.status)
        or credential.discipline_revoked
        or credential.discipline_suspended
        or credential.register_status = 'inactive'
        or credential.entitlement_to_practise is false
      )
  ) then
    blockers := array_append(blockers, 'owner_licence_blocked');
  end if;
  if exists (
    select 1 from public.organization_subscriptions sub
    where sub.organization_id = p_org
      and sub.status = 'trial_ended'
  ) then
    blockers := array_append(blockers, 'trial_ended');
  end if;
  return blockers;
end;
$$;

-- ---------------------------------------------------------------------------
-- Sign-up: the firm, the owner and the owner's licence in one step. Starts live.
-- The organization and membership inserts are those of app.create_organization
-- (20261017040614_foundation_core.sql); the credential insert is that of
-- app.add_consultant_licence (20261019204000_licence_admin.sql).
-- ---------------------------------------------------------------------------
create function app.create_firm_with_licence(
  p_legal_name text,
  p_display_name text,
  p_slug text,
  p_licence_type public.licence_type,
  p_college_id text,
  p_licence_class text
)
returns public.organizations
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  org public.organizations;
  owner_membership uuid;
  credential_id uuid;
  college_id text := upper(btrim(coalesce(p_college_id, '')));
  licence_class text := nullif(btrim(coalesce(p_licence_class, '')), '');
  scope text;
begin
  if uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if app.staff_mfa_satisfied() is distinct from true then
    raise exception 'creating a firm requires two-step sign-in (aal2)' using errcode = '42501';
  end if;
  if p_licence_type is null then
    raise exception 'licence type is required' using errcode = '22023';
  end if;
  if college_id !~ '^[A-Z0-9-]{1,40}$' then
    raise exception 'college id is not usable' using errcode = '22023';
  end if;
  if licence_class is null or licence_class = p_licence_type::text then
    scope := null;
  elsif licence_class = 'RCIC-IRB' and p_licence_type = 'RCIC' then
    scope := 'RCIC-IRB';
  else
    raise exception 'licence class does not match the licence type' using errcode = '22023';
  end if;

  insert into public.organizations (legal_name, display_name, slug, created_by, sample_mode)
  values (btrim(p_legal_name), btrim(p_display_name), lower(btrim(p_slug)), uid, false)
  returning * into org;

  insert into public.memberships (organization_id, user_id, role, status, accepted_at, created_by)
  values (org.id, uid, 'firm_owner', 'active', now(), uid)
  returning id into owner_membership;

  insert into public.consultant_credentials (
    organization_id, membership_id, licence_type, college_id, scope_note, status
  ) values (
    org.id, owner_membership, p_licence_type, college_id, scope, 'declared'
  )
  returning id into credential_id;

  update public.organizations
     set verification_status = 'pending_review'
   where id = org.id
     and verification_status = 'unverified';

  perform app.record_audit_event(
    org.id,
    'licence.declared',
    'public.consultant_credentials',
    credential_id,
    'success',
    jsonb_build_object('regulator', 'CICC', 'licence_type', p_licence_type, 'membership_id', owner_membership, 'proof', false, 'at_sign_up', true)
  );
  perform app.record_audit_event(
    org.id,
    'firm.created',
    'public.organizations',
    org.id,
    'success',
    jsonb_build_object('sample_mode', false, 'owner_licence_declared', true)
  );

  select * into org from public.organizations where id = org.id;
  return org;
end;
$$;
comment on function app.create_firm_with_licence(text, text, text, public.licence_type, text, text) is
  'Sign-up: creates the firm (live, sample_mode false), the caller''s firm_owner membership and their declared CICC licence together. Needs two-step sign-in. Proof is optional (set_credential_proof).';
revoke all on function app.create_firm_with_licence(text, text, text, public.licence_type, text, text) from public;

-- Attach (or replace) the licence proof file on a credential: the holder or a firm owner, with a
-- recent step-up. The server checks the file is in the private licence-proofs bucket first.
create function app.set_credential_proof(p_credential_id uuid, p_proof_locator text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  credential public.consultant_credentials%rowtype;
  holder public.memberships%rowtype;
  locator text := btrim(coalesce(p_proof_locator, ''));
begin
  if actor is null or app.staff_mfa_satisfied() is distinct from true
     or app.mfa_step_up_satisfied() is distinct from true then
    raise exception 'adding licence proof requires a recent step-up' using errcode = '42501';
  end if;
  select * into credential from public.consultant_credentials where id = p_credential_id;
  if credential.id is null or app.in_active_org(credential.organization_id) is distinct from true then
    raise exception 'licence proof denied' using errcode = '42501';
  end if;
  select * into holder
  from public.memberships
  where id = credential.membership_id and organization_id = credential.organization_id;
  if not (
    (holder.user_id = actor and holder.status = 'active')
    or app.has_org_role(credential.organization_id, array['firm_owner']::public.org_role[]) is true
  ) then
    raise exception 'licence proof denied' using errcode = '42501';
  end if;
  if length(locator) not between 1 and 500 then
    raise exception 'a proof file reference is required' using errcode = '22023';
  end if;
  update public.consultant_credentials set proof_locator = locator where id = credential.id;
  perform app.record_audit_event(
    credential.organization_id,
    'licence.proof_added',
    'public.consultant_credentials',
    credential.id,
    'success',
    jsonb_build_object('membership_id', credential.membership_id, 'replaced', credential.proof_locator is not null)
  );
  return credential.id;
end;
$$;
revoke all on function app.set_credential_proof(uuid, text) from public;

-- ---------------------------------------------------------------------------
-- Platform admins: credentials whose latest check is a needs_review list check.
-- ---------------------------------------------------------------------------
create function public.cicc_needs_review_credentials()
returns table (
  credential_id uuid,
  organization_id uuid,
  firm_name text,
  holder_name text,
  licence_type public.licence_type,
  college_id text,
  credential_status public.credential_status,
  check_id uuid,
  checked_at timestamptz,
  reason text,
  import_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.cicc_admin_caller() then
    raise exception 'needs-review list denied' using errcode = '42501';
  end if;
  return query
    with latest as (
      select distinct on (chk.credential_id) chk.*
      from public.credential_checks chk
      order by chk.credential_id, chk.created_at desc, chk.retrieved_at desc
    )
    select c.id, c.organization_id, o.display_name, nullif(btrim(coalesce(prof.display_name, '')), ''),
           c.licence_type, c.college_id, c.status, latest.id, latest.created_at, latest.notes, latest.cicc_import_id
    from latest
    join public.consultant_credentials c on c.id = latest.credential_id
    join public.organizations o on o.id = c.organization_id
    left join public.memberships mem on mem.id = c.membership_id and mem.organization_id = c.organization_id
    left join public.profiles prof on prof.id = mem.user_id
    where latest.method = 'cicc_list'
      and latest.result = 'needs_review'
    order by latest.created_at desc;
end;
$$;
comment on function public.cicc_needs_review_credentials() is
  'Platform admins (or the service role): every credential whose latest licence check is a CICC list check that needs review. A manual check (public.record_licence_check) clears it.';
revoke all on function public.cicc_needs_review_credentials() from public, anon;
grant execute on function public.cicc_needs_review_credentials() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Public wrappers (security invoker) and grants.
-- ---------------------------------------------------------------------------
create function public.create_firm_with_licence(
  legal_name text,
  display_name text,
  slug text,
  licence_type public.licence_type,
  college_id text,
  licence_class text
)
returns public.organizations
language sql
security invoker
set search_path = ''
as $$
  select * from app.create_firm_with_licence(legal_name, display_name, slug, licence_type, college_id, licence_class);
$$;

create function public.set_credential_proof(p_credential_id uuid, p_proof_locator text)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select app.set_credential_proof(p_credential_id, p_proof_locator);
$$;

create function public.start_cicc_register_import(
  p_source_note text,
  p_file_locator text,
  p_file_sha256 text,
  p_imported_by uuid default null
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select app.start_cicc_register_import(p_source_note, p_file_locator, p_file_sha256, p_imported_by);
$$;

create function public.import_cicc_register(p_import_id uuid, p_rows jsonb)
returns integer
language sql
security invoker
set search_path = ''
as $$
  select app.import_cicc_register(p_import_id, p_rows);
$$;

create function public.finish_cicc_register_import(p_import_id uuid)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app.finish_cicc_register_import(p_import_id);
$$;

create function public.check_licence_against_cicc_list(p_credential_id uuid)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select app.check_licence_against_cicc_list(p_credential_id);
$$;

revoke all on function public.create_firm_with_licence(text, text, text, public.licence_type, text, text) from public, anon;
revoke all on function public.set_credential_proof(uuid, text) from public, anon;
revoke all on function public.start_cicc_register_import(text, text, text, uuid) from public, anon;
revoke all on function public.import_cicc_register(uuid, jsonb) from public, anon;
revoke all on function public.finish_cicc_register_import(uuid) from public, anon;
revoke all on function public.check_licence_against_cicc_list(uuid) from public, anon;

grant execute on function app.create_firm_with_licence(text, text, text, public.licence_type, text, text) to authenticated;
grant execute on function app.set_credential_proof(uuid, text) to authenticated, service_role;
grant execute on function app.start_cicc_register_import(text, text, text, uuid) to authenticated, service_role;
grant execute on function app.import_cicc_register(uuid, jsonb) to authenticated, service_role;
grant execute on function app.finish_cicc_register_import(uuid) to authenticated, service_role;
grant execute on function app.check_licence_against_cicc_list(uuid) to authenticated, service_role;

grant execute on function public.create_firm_with_licence(text, text, text, public.licence_type, text, text) to authenticated;
grant execute on function public.set_credential_proof(uuid, text) to authenticated, service_role;
grant execute on function public.start_cicc_register_import(text, text, text, uuid) to authenticated, service_role;
grant execute on function public.import_cicc_register(uuid, jsonb) to authenticated, service_role;
grant execute on function public.finish_cicc_register_import(uuid) to authenticated, service_role;
grant execute on function public.check_licence_against_cicc_list(uuid) to authenticated, service_role;
