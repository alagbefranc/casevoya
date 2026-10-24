-- INT-05 (#177): a person's other names, passports and addresses, kept as history, and review
-- flags resolved with a note. A flag asks someone to look; it is never a finding of fraud.
--
-- New tables (append only: no update or delete):
--   public.person_identity_entries   one row per name, passport or address as recorded. A change is
--                                    a new row that names the row it replaces (replaces_id); a
--                                    removal is a new row with retired = true. The current entries
--                                    are the rows no later row replaces, and that are not retired.
--   public.person_flag_resolutions   a review flag on a person (its stable key and the evidence
--                                    shown) resolved by staff with a note.
-- New functions:
--   public.record_person_identity(uuid, text, jsonb, uuid, boolean)
--                                    staff who can write the person (owner, licensed consultant,
--                                    case manager, assistant on one of their matters, aal2): adds,
--                                    changes or removes one entry. Checks each kind's fields. Audited.
--   public.resolve_person_flag(uuid, text, text, text)
--                                    owner, licensed consultant or case manager who can write the
--                                    person: resolves one flag with a note. Audited.
-- Read: staff who can write the person (app.can_write_person). Not the portal: a passport number
-- stays with the firm.

create type public.person_identity_kind as enum ('name', 'passport', 'address');

create table public.person_identity_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  person_id uuid not null,
  kind public.person_identity_kind not null,
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  replaces_id uuid,
  retired boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  unique (id, organization_id),
  check (retired is false or replaces_id is not null),
  foreign key (person_id, organization_id) references public.persons (id, organization_id),
  foreign key (replaces_id, organization_id) references public.person_identity_entries (id, organization_id)
);
comment on table public.person_identity_entries is
  'A person''s other names, passports and addresses (INT-05). Append only: a change or removal is a new row naming the row it replaces.';

create unique index person_identity_entries_replaces_uidx on public.person_identity_entries (replaces_id) where replaces_id is not null;
create index person_identity_entries_person_idx on public.person_identity_entries (person_id, kind, created_at);
create index person_identity_entries_org_fk_idx on public.person_identity_entries (organization_id);
create index person_identity_entries_person_org_fk_idx on public.person_identity_entries (person_id, organization_id);
create index person_identity_entries_replaces_org_fk_idx on public.person_identity_entries (replaces_id, organization_id);
create index person_identity_entries_created_by_idx on public.person_identity_entries (created_by);

create table public.person_flag_resolutions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  person_id uuid not null,
  flag_key text not null check (length(flag_key) between 1 and 300),
  detail text not null check (length(btrim(detail)) between 1 and 1000),
  note text not null check (length(btrim(note)) between 1 and 1000),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  unique (person_id, flag_key),
  unique (id, organization_id),
  foreign key (person_id, organization_id) references public.persons (id, organization_id)
);
comment on table public.person_flag_resolutions is
  'A review flag on a person resolved by staff with a note (INT-05): the flag''s key, the evidence it showed, and why it is fine. Append only.';

create index person_flag_resolutions_org_fk_idx on public.person_flag_resolutions (organization_id);
create index person_flag_resolutions_person_org_fk_idx on public.person_flag_resolutions (person_id, organization_id);
create index person_flag_resolutions_created_by_idx on public.person_flag_resolutions (created_by);

create function app.person_history_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append only', tg_table_name using errcode = '42501';
end;
$$;
revoke all on function app.person_history_append_only() from public;

create trigger person_identity_entries_append_only before update or delete on public.person_identity_entries
  for each row execute function app.person_history_append_only();
create trigger person_flag_resolutions_append_only before update or delete on public.person_flag_resolutions
  for each row execute function app.person_history_append_only();

alter table public.person_identity_entries enable row level security;
alter table public.person_identity_entries force row level security;
alter table public.person_flag_resolutions enable row level security;
alter table public.person_flag_resolutions force row level security;
revoke all on table public.person_identity_entries from anon, authenticated;
revoke all on table public.person_flag_resolutions from anon, authenticated;
grant select on table public.person_identity_entries to authenticated;
grant select on table public.person_flag_resolutions to authenticated;
grant select, insert on table public.person_identity_entries to service_role;
grant select, insert on table public.person_flag_resolutions to service_role;

create policy person_identity_entries_select on public.person_identity_entries
  for select to authenticated
  using ((select app.can_write_person(person_id)));
create policy person_flag_resolutions_select on public.person_flag_resolutions
  for select to authenticated
  using ((select app.can_write_person(person_id)));

-- One entry's fields, checked and trimmed: the stored shape for its kind.
create function app.person_identity_data(p_kind public.person_identity_kind, p_data jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  name_kind text;
  name_text text;
  script text;
  country text;
  number text;
  issued date;
  expires date;
  birth date;
  address text;
  from_on date;
  to_on date;
begin
  if p_data is null or jsonb_typeof(p_data) is distinct from 'object' then
    raise exception 'that entry is not usable' using errcode = '22023';
  end if;
  if p_kind = 'name' then
    name_kind := p_data ->> 'name_kind';
    name_text := nullif(btrim(p_data ->> 'name'), '');
    script := nullif(btrim(p_data ->> 'script'), '');
    if name_kind is null or name_kind not in ('alias', 'maiden', 'previous', 'transliteration', 'other') then
      raise exception 'choose what kind of name this is' using errcode = '22023';
    end if;
    if name_text is null or length(name_text) > 200 then
      raise exception 'a name needs 1 to 200 characters' using errcode = '22023';
    end if;
    if name_kind = 'transliteration' and script is null then
      raise exception 'a transliteration needs its script' using errcode = '22023';
    end if;
    if script is not null and length(script) > 60 then
      raise exception 'keep the script under 60 characters' using errcode = '22023';
    end if;
    return jsonb_strip_nulls(jsonb_build_object('name_kind', name_kind, 'name', name_text, 'script', script));
  elsif p_kind = 'passport' then
    country := upper(btrim(coalesce(p_data ->> 'country', '')));
    number := upper(regexp_replace(coalesce(p_data ->> 'number', ''), '\s', '', 'g'));
    name_text := nullif(btrim(p_data ->> 'name'), '');
    if country !~ '^[A-Z]{2}$' then
      raise exception 'a passport country is a two-letter code' using errcode = '22023';
    end if;
    if number !~ '^[A-Z0-9]{4,20}$' then
      raise exception 'a passport number has 4 to 20 letters or digits' using errcode = '22023';
    end if;
    if name_text is not null and length(name_text) > 200 then
      raise exception 'a name needs 1 to 200 characters' using errcode = '22023';
    end if;
    issued := nullif(p_data ->> 'issued_on', '')::date;
    expires := nullif(p_data ->> 'expires_on', '')::date;
    birth := nullif(p_data ->> 'birth_date', '')::date;
    if expires is null then
      raise exception 'enter the expiry date printed on the passport' using errcode = '22023';
    end if;
    if issued is not null and expires < issued then
      raise exception 'the expiry date is before the issue date' using errcode = '22023';
    end if;
    return jsonb_strip_nulls(jsonb_build_object(
      'country', country, 'number', number, 'name', name_text, 'issued_on', issued, 'expires_on', expires,
      'birth_date', birth, 'current', coalesce((p_data ->> 'current')::boolean, false)
    ));
  else
    address := nullif(btrim(p_data ->> 'address'), '');
    country := nullif(upper(btrim(coalesce(p_data ->> 'country', ''))), '');
    if address is null or length(address) > 500 then
      raise exception 'an address needs 1 to 500 characters' using errcode = '22023';
    end if;
    if country is not null and country !~ '^[A-Z]{2}$' then
      raise exception 'a country is a two-letter code' using errcode = '22023';
    end if;
    from_on := nullif(p_data ->> 'from_on', '')::date;
    to_on := nullif(p_data ->> 'to_on', '')::date;
    if from_on is null then
      raise exception 'enter when they started living there' using errcode = '22023';
    end if;
    if to_on is not null and to_on < from_on then
      raise exception 'the end date is before the start date' using errcode = '22023';
    end if;
    return jsonb_strip_nulls(jsonb_build_object('address', address, 'country', country, 'from_on', from_on, 'to_on', to_on));
  end if;
exception
  when invalid_datetime_format or datetime_field_overflow or invalid_text_representation then
    raise exception 'enter dates as a full day' using errcode = '22023';
end;
$$;
revoke all on function app.person_identity_data(public.person_identity_kind, jsonb) from public;

create function public.record_person_identity(
  p_person_id uuid,
  p_kind text,
  p_data jsonb,
  p_replaces_id uuid default null,
  p_retire boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  subject public.persons%rowtype;
  kind public.person_identity_kind;
  previous public.person_identity_entries%rowtype;
  stored jsonb;
  new_id uuid;
begin
  select * into subject from public.persons where id = p_person_id;
  if subject.id is null then
    raise exception 'person history denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    subject.organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[],
    false
  );
  if app.can_write_person(subject.id) is distinct from true then
    raise exception 'person history denied' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('name', 'passport', 'address') then
    raise exception 'choose a name, passport or address' using errcode = '22023';
  end if;
  kind := p_kind::public.person_identity_kind;

  if p_replaces_id is not null then
    select * into previous from public.person_identity_entries where id = p_replaces_id for update;
    if previous.id is null or previous.person_id is distinct from subject.id or previous.kind is distinct from kind then
      raise exception 'that entry is not on this person' using errcode = '22023';
    end if;
    if previous.retired or exists (select 1 from public.person_identity_entries later where later.replaces_id = previous.id) then
      raise exception 'that entry was already changed; reload to see the latest' using errcode = 'PT409';
    end if;
  elsif coalesce(p_retire, false) then
    raise exception 'choose the entry to remove' using errcode = '22023';
  end if;

  stored := case when coalesce(p_retire, false) then previous.data else app.person_identity_data(kind, p_data) end;
  insert into public.person_identity_entries (organization_id, person_id, kind, data, replaces_id, retired, created_by)
  values (subject.organization_id, subject.id, kind, stored, p_replaces_id, coalesce(p_retire, false), (select auth.uid()))
  returning id into new_id;

  perform app.record_audit_event(
    subject.organization_id,
    case when coalesce(p_retire, false) then 'person.identity_removed' when p_replaces_id is not null then 'person.identity_changed' else 'person.identity_added' end,
    'public.person_identity_entries',
    new_id,
    'success',
    -- The audit names what changed, never the passport number.
    jsonb_build_object('person_id', subject.id, 'kind', p_kind, 'replaces_id', p_replaces_id)
  );
  return new_id;
end;
$$;
revoke all on function public.record_person_identity(uuid, text, jsonb, uuid, boolean) from public;
grant execute on function public.record_person_identity(uuid, text, jsonb, uuid, boolean) to authenticated;

create function public.resolve_person_flag(p_person_id uuid, p_flag_key text, p_detail text, p_note text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  subject public.persons%rowtype;
  new_id uuid;
begin
  select * into subject from public.persons where id = p_person_id;
  if subject.id is null then
    raise exception 'person history denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    subject.organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[],
    false
  );
  if app.can_write_person(subject.id) is distinct from true then
    raise exception 'person history denied' using errcode = '42501';
  end if;
  if nullif(btrim(p_note), '') is null or length(btrim(p_note)) > 1000 then
    raise exception 'say why this is fine, in up to 1,000 characters' using errcode = '22023';
  end if;
  if nullif(btrim(p_flag_key), '') is null or length(p_flag_key) > 300 or nullif(btrim(p_detail), '') is null or length(btrim(p_detail)) > 1000 then
    raise exception 'that flag is not usable' using errcode = '22023';
  end if;
  if exists (select 1 from public.person_flag_resolutions done where done.person_id = subject.id and done.flag_key = p_flag_key) then
    raise exception 'that flag was already resolved' using errcode = 'PT409';
  end if;
  insert into public.person_flag_resolutions (organization_id, person_id, flag_key, detail, note, created_by)
  values (subject.organization_id, subject.id, p_flag_key, btrim(p_detail), btrim(p_note), (select auth.uid()))
  returning id into new_id;
  perform app.record_audit_event(
    subject.organization_id,
    'person.flag_resolved',
    'public.person_flag_resolutions',
    new_id,
    'success',
    jsonb_build_object('person_id', subject.id, 'flag_key', p_flag_key)
  );
  return new_id;
end;
$$;
revoke all on function public.resolve_person_flag(uuid, text, text, text) from public;
grant execute on function public.resolve_person_flag(uuid, text, text, text) to authenticated;
