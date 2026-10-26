-- MIG follow-ups (gap #187, Francis's MIG decision 2): one kind of record per file. A file whose
-- column headings match more than one import kind is refused at staging and at mapping, with a
-- message naming the kinds found. Additive only; nothing seeded.
--
-- New:
--   app.migration_kinds_in_headers(text[])  which import kinds a file's headings point to, by
--                                           headings distinctive to each kind (a heading shared
--                                           by several kinds, such as "Matter", "Date" or
--                                           "Client", points to none). Immutable, no data read.
--   app.migration_refuse_mixed(text[])      raises 22023 "this file holds more than one kind of
--                                           record: <kinds>" when two or more kinds are found.
-- Redefines (each copied from its latest definition, 20261025385100_mig_import_kinds_evaluate.sql;
-- no later migration redefines them), changing only the added check:
--   public.set_migration_kind        refuses a mixed file before its rows are taken (the upload
--                                    now calls it for every kind, clients and matters included,
--                                    and discards the staged batch when it refuses).
--   public.save_migration_mapping    refuses a mixed file (covers a batch staged before this).

-- Which import kinds these headings point to, in the upload picker's order, by the kind's label.
create or replace function app.migration_kinds_in_headers(p_headers text[])
returns text[]
language sql
immutable
set search_path = ''
as $$
  with h as (
    select lower(btrim(regexp_replace(coalesce(x, ''), '\s+', ' ', 'g'))) as v
    from unnest(coalesce(p_headers, '{}'::text[])) x
  ),
  found as (
    select 1 as ord, 'Clients and matters' as label
    where exists (select 1 from h where v ~ '^(first ?name|given ?names?|last ?name|family ?name|surname|legal name|full legal name|program|immigration program|application type|visa type|stream|matter title|case title|matter name|case name)$')
    union all
    select 2, 'People relationships'
    where exists (select 1 from h where v ~ '^(relationship|relation|relationship type)$')
      and exists (select 1 from h where v ~ '^(related|related person|related to|relative|family member|other person|linked person)$')
    union all
    select 3, 'Notes'
    where exists (select 1 from h where v ~ '^(note text|note body|note date|note author|date written|written on|written by)$')
       or (exists (select 1 from h where v ~ '^(note|notes)$')
           and exists (select 1 from h where v ~ '^(author|written|by)$'))
    union all
    select 4, 'Tasks'
    where exists (select 1 from h where v ~ '^(task|tasks|task title|task name|task description|to ?do|task due|task due date|task status|task assignee|assignee)$')
    union all
    select 5, 'Key dates'
    where exists (select 1 from h where v ~ '^(key date|key dates|key date label|date label|date type|date kind|kind of date|type of date|important date|expiry|expiry date|expires|expires on)$')
    union all
    select 6, 'Documents'
    where exists (select 1 from h where v ~ '^(file ?name|file path|path|path in zip|zip path|attachment|document file|document type|doc type|type of document)$')
    union all
    select 7, 'Financial opening balances'
    where exists (select 1 from h where v ~ '^(opening balance|balance type|balance kind|amount owing|amount owed|balance owing|balance owed)$')
       or (exists (select 1 from h where v ~ '^(amount|balance)$')
           and exists (select 1 from h where v ~ '^(as of|as-of|as at|balance date|statement date|currency)$'))
  )
  select coalesce(array_agg(label order by ord), '{}'::text[]) from found;
$$;

-- One kind per file: refuse headings that match more than one kind, naming them.
create or replace function app.migration_refuse_mixed(p_headers text[])
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  kinds text[] := app.migration_kinds_in_headers(p_headers);
begin
  if cardinality(kinds) > 1 then
    raise exception 'this file holds more than one kind of record: %', array_to_string(kinds, '; ') using errcode = '22023';
  end if;
end;
$$;

create or replace function public.set_migration_kind(p_org uuid, p_batch uuid, p_kind text)
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
  -- MIG decision 2: one kind per file. A file whose columns match more than one kind is refused.
  perform app.migration_refuse_mixed(b.headers);
  update public.migration_batches set kind = p_kind where id = p_batch;
  perform app.record_audit_event(p_org, 'migration.kind_set', 'public.migration_batches', p_batch, 'success', jsonb_build_object('kind', p_kind));
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
  -- MIG decision 2: one kind per file, checked again here for a file staged before the check.
  perform app.migration_refuse_mixed(b.headers);
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

revoke all on function app.migration_kinds_in_headers(text[]) from public, anon, authenticated;
revoke all on function app.migration_refuse_mixed(text[]) from public, anon, authenticated;
revoke all on function public.set_migration_kind(uuid, uuid, text) from public, anon;
revoke all on function public.save_migration_mapping(uuid, uuid, jsonb) from public, anon;
grant execute on function public.set_migration_kind(uuid, uuid, text) to authenticated;
grant execute on function public.save_migration_mapping(uuid, uuid, jsonb) to authenticated;
