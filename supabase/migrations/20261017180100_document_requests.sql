-- T025 document requests and review (PRD §11 DOC-01, DOC-04, DOC-06).
-- A request is rule-derived only when a published rule version is named.
-- This migration does not invent a program checklist.
-- Accepted means the firm accepted the file for the stated purpose. It is not a government decision.
-- Client progress counts accepted requirements, not raw uploads.
-- Additive only.

create type public.document_request_status as enum (
  'open',
  'fulfilled',
  'waived',
  'cancelled'
);

create type public.document_request_source as enum (
  'rule',
  'staff'
);

create type public.document_review_decision as enum (
  'accepted',
  'changes_requested'
);

create table public.document_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  matter_id uuid not null,
  person_id uuid not null,
  document_id uuid,
  purpose text not null check (length(btrim(purpose)) between 1 and 200),
  explanation text not null check (length(btrim(explanation)) between 3 and 2000),
  due_on date,
  acceptable_formats text[] not null check (
    cardinality(acceptable_formats) between 1 and 5
    and acceptable_formats <@ array['pdf', 'jpeg', 'png', 'heic', 'docx']::text[]
  ),
  review_criteria text check (review_criteria is null or length(btrim(review_criteria)) between 3 and 2000),
  expires_on date,
  audience public.document_audience not null default 'subject',
  sensitivity public.document_sensitivity not null default 'ordinary',
  source public.document_request_source not null,
  rule_version_id uuid references public.rule_versions (id),
  rule_item_key text check (rule_item_key is null or rule_item_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  status public.document_request_status not null default 'open',
  waiver_reason text check (waiver_reason is null or length(btrim(waiver_reason)) between 3 and 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id),
  check (
    (source = 'rule' and rule_version_id is not null and rule_item_key is not null)
    or (source = 'staff' and rule_version_id is null and rule_item_key is null)
  ),
  check (status <> 'waived' or waiver_reason is not null),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id),
  foreign key (person_id, organization_id) references public.persons (id, organization_id),
  foreign key (document_id, organization_id) references public.documents (id, organization_id)
);
comment on table public.document_requests is
  'One checklist item. source=rule only when staff attach a published rule version. Accepted progress ignores uploads that are still pending, rejected, quarantined, or expired.';

create index document_requests_org_status_idx
  on public.document_requests (organization_id, status, due_on);
create index document_requests_matter_idx on public.document_requests (matter_id);
create index document_requests_org_fk_idx on public.document_requests (organization_id);
create index document_requests_matter_org_fk_idx on public.document_requests (matter_id, organization_id);
create index document_requests_person_org_fk_idx on public.document_requests (person_id, organization_id);
create index document_requests_document_org_fk_idx on public.document_requests (document_id, organization_id);
create index document_requests_rule_idx on public.document_requests (rule_version_id);
create index document_requests_created_by_idx on public.document_requests (created_by);

alter table public.document_versions
  add column request_id uuid;
alter table public.document_versions
  add constraint document_versions_request_org_fkey
  foreign key (request_id, organization_id)
  references public.document_requests (id, organization_id);
create index document_versions_request_org_fk_idx
  on public.document_versions (request_id, organization_id);

create table public.document_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  version_id uuid not null,
  decision public.document_review_decision not null,
  reason text not null check (length(btrim(reason)) between 3 and 2000),
  annotations text check (annotations is null or length(btrim(annotations)) between 1 and 2000),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  foreign key (version_id, organization_id) references public.document_versions (id, organization_id)
);
comment on table public.document_reviews is
  'Append-only firm review. Accepted is acceptance for the stated purpose, not a government validation.';

create index document_reviews_version_idx on public.document_reviews (version_id, created_at);
create index document_reviews_org_fk_idx on public.document_reviews (organization_id);
create index document_reviews_version_org_fk_idx on public.document_reviews (version_id, organization_id);
create index document_reviews_created_by_idx on public.document_reviews (created_by);

create trigger document_requests_no_delete before delete on public.document_requests
  for each row execute function app.reject_document_delete();
create trigger document_reviews_no_update
  before update or delete on public.document_reviews
  for each row execute function app.reject_document_delete();
create trigger document_requests_write_guard before update on public.document_requests
  for each row execute function app.guard_document_write();
create trigger document_requests_touch before update on public.document_requests
  for each row execute function app.touch_row();

create function app.request_version_satisfies(p_version_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.document_versions version
    where version.id = p_version_id
      and version.upload_state = 'clean'
      and version.review_state = 'accepted'
      and version.superseded_at is null
      and (version.expires_on is null or version.expires_on >= current_date)
  );
$$;
revoke all on function app.request_version_satisfies(uuid) from public;

create function app.create_document_request(
  p_matter_id uuid,
  p_person_id uuid,
  p_purpose text,
  p_explanation text,
  p_due_on date,
  p_acceptable_formats text[],
  p_review_criteria text,
  p_expires_on date,
  p_audience public.document_audience,
  p_sensitivity public.document_sensitivity,
  p_rule_version_id uuid,
  p_rule_item_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  matter public.matters%rowtype;
  rule public.rule_versions%rowtype;
  new_id uuid;
  source public.document_request_source;
begin
  select * into matter from public.matters where id = p_matter_id;
  if matter.id is null or app.can_read_matter(matter.id) is distinct from true then
    raise exception 'document request denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    matter.organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[],
    true
  );
  if app.sample_mode_blocks_real(matter.organization_id, matter.is_sample) then
    raise exception 'this firm is in sample mode; only sample matters accept new work' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.persons person
    join public.matter_participants party
      on party.person_id = person.id
     and party.matter_id = matter.id
    where person.id = p_person_id
      and person.organization_id = matter.organization_id
      and person.is_sample is not distinct from matter.is_sample
  ) then
    raise exception 'the request needs a person on this matter' using errcode = '42501';
  end if;
  if p_purpose is null or length(btrim(p_purpose)) not between 1 and 200 then
    raise exception 'document purpose is required' using errcode = '22023';
  end if;
  if p_explanation is null or length(btrim(p_explanation)) not between 3 and 2000 then
    raise exception 'document explanation is required' using errcode = '22023';
  end if;
  if p_acceptable_formats is null or cardinality(p_acceptable_formats) < 1 then
    raise exception 'name at least one acceptable format' using errcode = '22023';
  end if;

  if p_rule_version_id is null then
    if p_rule_item_key is not null then
      raise exception 'a staff request has no rule item' using errcode = '22023';
    end if;
    source := 'staff';
  else
    if p_rule_item_key is null or p_rule_item_key !~ '^[a-z][a-z0-9_]{0,63}$' then
      raise exception 'a rule-derived request needs an item key' using errcode = '22023';
    end if;
    select * into rule from public.rule_versions where id = p_rule_version_id;
    if rule.id is null or rule.status is distinct from 'published' then
      raise exception 'only a published rule version can derive a document request' using errcode = '42501';
    end if;
    if rule.organization_id is not null and rule.organization_id is distinct from matter.organization_id then
      raise exception 'document request denied' using errcode = '42501';
    end if;
    source := 'rule';
  end if;

  insert into public.document_requests (
    organization_id, matter_id, person_id, purpose, explanation, due_on, acceptable_formats,
    review_criteria, expires_on, audience, sensitivity, source, rule_version_id, rule_item_key, created_by
  ) values (
    matter.organization_id,
    matter.id,
    p_person_id,
    btrim(p_purpose),
    btrim(p_explanation),
    p_due_on,
    p_acceptable_formats,
    nullif(btrim(p_review_criteria), ''),
    p_expires_on,
    coalesce(p_audience, 'subject'),
    coalesce(p_sensitivity, 'ordinary'),
    source,
    p_rule_version_id,
    p_rule_item_key,
    (select auth.uid())
  )
  returning id into new_id;

  perform app.record_audit_event(
    matter.organization_id, 'document.request_created', 'document_requests', new_id, 'success',
    jsonb_build_object('source', source, 'matter_id', matter.id)
  );
  return new_id;
end;
$$;
revoke all on function app.create_document_request(uuid, uuid, text, text, date, text[], text, date, public.document_audience, public.document_sensitivity, uuid, text) from public;

create function public.create_document_request(
  p_matter_id uuid,
  p_person_id uuid,
  p_purpose text,
  p_explanation text,
  p_due_on date,
  p_acceptable_formats text[],
  p_review_criteria text,
  p_expires_on date,
  p_audience public.document_audience,
  p_sensitivity public.document_sensitivity,
  p_rule_version_id uuid default null,
  p_rule_item_key text default null
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select app.create_document_request(
    p_matter_id, p_person_id, p_purpose, p_explanation, p_due_on, p_acceptable_formats,
    p_review_criteria, p_expires_on, p_audience, p_sensitivity, p_rule_version_id, p_rule_item_key
  );
$$;
revoke all on function public.create_document_request(uuid, uuid, text, text, date, text[], text, date, public.document_audience, public.document_sensitivity, uuid, text) from public, anon;
grant execute on function public.create_document_request(uuid, uuid, text, text, date, text[], text, date, public.document_audience, public.document_sensitivity, uuid, text)
  to authenticated, service_role;

create function app.attach_upload_to_request(p_version_id uuid, p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  version public.document_versions%rowtype;
  request public.document_requests%rowtype;
  ext text;
begin
  select * into version from public.document_versions where id = p_version_id for update;
  select * into request from public.document_requests where id = p_request_id for update;
  if version.id is null or request.id is null
     or version.organization_id is distinct from request.organization_id
     or version.created_by is distinct from (select auth.uid())
     or version.upload_state is distinct from 'uploading'
     or request.status is distinct from 'open' then
    raise exception 'document upload denied' using errcode = '42501';
  end if;
  if app.actor_can_upload_for(request.matter_id, request.person_id) is distinct from true then
    raise exception 'document upload denied' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.documents doc
    where doc.id = version.document_id
      and doc.person_id = request.person_id
      and doc.organization_id = request.organization_id
  ) then
    raise exception 'document upload denied' using errcode = '42501';
  end if;
  if request.document_id is not null and request.document_id is distinct from version.document_id then
    raise exception 'a replacement must be a new version of the same document' using errcode = '22023';
  end if;
  ext := lower(regexp_replace(version.original_filename, '^.*\.', ''));
  if ext = 'jpg' then
    ext := 'jpeg';
  elsif ext = 'heif' then
    ext := 'heic';
  end if;
  if not (ext = any (request.acceptable_formats)) then
    raise exception 'that format is not acceptable for this request' using errcode = '22023';
  end if;

  perform app.open_document_write(version.id);
  update public.document_versions
  set request_id = request.id
  where id = version.id;
  perform app.close_document_write(version.id);

  perform app.open_document_write(request.id);
  update public.document_requests
  set document_id = version.document_id,
      audience = request.audience,
      sensitivity = request.sensitivity
  where id = request.id;
  perform app.close_document_write(request.id);

  perform app.open_document_write(version.document_id);
  update public.documents
  set audience = request.audience,
      sensitivity = request.sensitivity,
      purpose = request.purpose
  where id = version.document_id;
  perform app.close_document_write(version.document_id);
end;
$$;
revoke all on function app.attach_upload_to_request(uuid, uuid) from public;

create function public.attach_upload_to_request(p_version_id uuid, p_request_id uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
  select app.attach_upload_to_request(p_version_id, p_request_id);
$$;
revoke all on function public.attach_upload_to_request(uuid, uuid) from public, anon;
grant execute on function public.attach_upload_to_request(uuid, uuid) to authenticated, service_role;

create function app.review_document_version(
  p_version_id uuid,
  p_expected_version integer,
  p_decision public.document_review_decision,
  p_reason text,
  p_annotations text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  version public.document_versions%rowtype;
  older record;
  new_version integer;
begin
  select * into version from public.document_versions where id = p_version_id for update;
  if version.id is null or app.can_read_document_version(version.id) is distinct from true then
    raise exception 'document review denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    version.organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[],
    true
  );
  if version.version is distinct from p_expected_version then
    raise exception 'document version conflict' using errcode = '40001';
  end if;
  if version.upload_state is distinct from 'clean' then
    raise exception 'quarantined or unfinished uploads cannot be accepted evidence' using errcode = '42501';
  end if;
  if p_reason is null or length(btrim(p_reason)) not between 3 and 2000 then
    raise exception 'a review reason is required' using errcode = '22023';
  end if;

  perform app.open_document_write(version.id);
  update public.document_versions
  set review_state = case
        when p_decision = 'accepted' then 'accepted'::public.document_review_state
        else 'rejected'::public.document_review_state
      end
  where id = version.id
  returning public.document_versions.version into new_version;
  perform app.close_document_write(version.id);

  if p_decision = 'accepted' and version.translation_of_version_id is null then
    for older in
      select older_version.id
      from public.document_versions older_version
      where older_version.document_id = version.document_id
        and older_version.id <> version.id
        and older_version.review_state = 'accepted'
        and older_version.superseded_at is null
        and older_version.translation_of_version_id is null
    loop
      perform app.open_document_write(older.id);
      update public.document_versions
      set superseded_at = statement_timestamp()
      where id = older.id;
      perform app.close_document_write(older.id);
    end loop;
  end if;

  insert into public.document_reviews (
    organization_id, version_id, decision, reason, annotations, created_by
  ) values (
    version.organization_id,
    version.id,
    p_decision,
    btrim(p_reason),
    nullif(btrim(p_annotations), ''),
    (select auth.uid())
  );

  if p_decision = 'accepted' and version.request_id is not null and app.request_version_satisfies(version.id) then
    perform app.open_document_write(version.request_id);
    update public.document_requests
    set status = 'fulfilled'
    where id = version.request_id
      and status = 'open';
    perform app.close_document_write(version.request_id);
  end if;

  perform app.enqueue_event(
    version.organization_id, 'document', version.document_id, 'document.reviewed',
    jsonb_build_object(
      'document_id', version.document_id,
      'version_id', version.id,
      'decision', p_decision
    ),
    new_version,
    'document.reviewed:' || version.id::text || ':' || new_version::text,
    null
  );
  perform app.record_audit_event(
    version.organization_id, 'document.reviewed', 'document_versions', version.id, 'success',
    jsonb_build_object('decision', p_decision)
  );
  return new_version;
end;
$$;
revoke all on function app.review_document_version(uuid, integer, public.document_review_decision, text, text) from public;

create function public.review_document_version(
  p_version_id uuid,
  p_expected_version integer,
  p_decision public.document_review_decision,
  p_reason text,
  p_annotations text default null
)
returns integer
language sql
security invoker
set search_path = ''
as $$
  select app.review_document_version(
    p_version_id, p_expected_version, p_decision, p_reason, p_annotations
  );
$$;
revoke all on function public.review_document_version(uuid, integer, public.document_review_decision, text, text) from public, anon;
grant execute on function public.review_document_version(uuid, integer, public.document_review_decision, text, text)
  to authenticated, service_role;

create function app.waive_document_request(
  p_request_id uuid,
  p_expected_version integer,
  p_reason text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  request public.document_requests%rowtype;
  new_version integer;
begin
  select * into request from public.document_requests where id = p_request_id for update;
  if request.id is null or app.can_read_matter(request.matter_id) is distinct from true then
    raise exception 'document request denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    request.organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[],
    true
  );
  if request.version is distinct from p_expected_version then
    raise exception 'document version conflict' using errcode = '40001';
  end if;
  if p_reason is null or length(btrim(p_reason)) not between 3 and 2000 then
    raise exception 'a waiver reason is required' using errcode = '22023';
  end if;
  perform app.open_document_write(request.id);
  update public.document_requests
  set status = 'waived',
      waiver_reason = btrim(p_reason)
  where id = request.id
  returning public.document_requests.version into new_version;
  perform app.close_document_write(request.id);
  perform app.record_audit_event(
    request.organization_id, 'document.request_waived', 'document_requests', request.id, 'success',
    '{}'::jsonb
  );
  return new_version;
end;
$$;
revoke all on function app.waive_document_request(uuid, integer, text) from public;

create function public.waive_document_request(
  p_request_id uuid,
  p_expected_version integer,
  p_reason text
)
returns integer
language sql
security invoker
set search_path = ''
as $$
  select app.waive_document_request(p_request_id, p_expected_version, p_reason);
$$;
revoke all on function public.waive_document_request(uuid, integer, text) from public, anon;
grant execute on function public.waive_document_request(uuid, integer, text) to authenticated, service_role;

create function app.set_document_expiry(
  p_version_id uuid,
  p_expected_version integer,
  p_expires_on date
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  version public.document_versions%rowtype;
  new_version integer;
begin
  select * into version from public.document_versions where id = p_version_id for update;
  if version.id is null or app.can_read_document_version(version.id) is distinct from true then
    raise exception 'document review denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    version.organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[],
    true
  );
  if version.version is distinct from p_expected_version then
    raise exception 'document version conflict' using errcode = '40001';
  end if;
  perform app.open_document_write(version.id);
  update public.document_versions
  set expires_on = p_expires_on
  where id = version.id
  returning public.document_versions.version into new_version;
  perform app.close_document_write(version.id);
  if version.request_id is not null then
    perform app.open_document_write(version.request_id);
    update public.document_requests
    set expires_on = p_expires_on,
        status = case
          when status = 'fulfilled' and not app.request_version_satisfies(version.id) then 'open'::public.document_request_status
          else status
        end
    where id = version.request_id;
    perform app.close_document_write(version.request_id);
  end if;
  return new_version;
end;
$$;
revoke all on function app.set_document_expiry(uuid, integer, date) from public;

create function public.set_document_expiry(
  p_version_id uuid,
  p_expected_version integer,
  p_expires_on date
)
returns integer
language sql
security invoker
set search_path = ''
as $$
  select app.set_document_expiry(p_version_id, p_expected_version, p_expires_on);
$$;
revoke all on function public.set_document_expiry(uuid, integer, date) from public, anon;
grant execute on function public.set_document_expiry(uuid, integer, date) to authenticated, service_role;

create function app.document_request_progress(p_matter_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  matter public.matters%rowtype;
  request_count integer;
  accepted_count integer;
  outstanding_count integer;
  uploaded_unaccepted_count integer;
begin
  select * into matter from public.matters where id = p_matter_id;
  if matter.id is null or app.can_read_matter(matter.id) is distinct from true then
    raise exception 'document progress denied' using errcode = '42501';
  end if;
  select count(*)::integer into request_count
  from public.document_requests request
  where request.matter_id = matter.id
    and request.status <> 'cancelled';
  select count(*)::integer into accepted_count
  from public.document_requests request
  where request.matter_id = matter.id
    and request.status <> 'cancelled'
    and request.status <> 'waived'
    and exists (
      select 1
      from public.document_versions version
      where version.document_id = request.document_id
        and version.request_id = request.id
        and app.request_version_satisfies(version.id)
    );
  select count(*)::integer into outstanding_count
  from public.document_requests request
  where request.matter_id = matter.id
    and request.status <> 'cancelled'
    and request.status <> 'waived'
    and not exists (
      select 1
      from public.document_versions version
      where version.document_id = request.document_id
        and version.request_id = request.id
        and app.request_version_satisfies(version.id)
    );
  select count(*)::integer into uploaded_unaccepted_count
  from public.document_versions version
  join public.document_matter_refs ref
    on ref.document_id = version.document_id
   and ref.matter_id = matter.id
   and ref.removed_at is null
  where version.upload_state in ('uploading', 'scanning', 'clean')
    and not app.request_version_satisfies(version.id);
  return jsonb_build_object(
    'request_count', request_count,
    'accepted_count', accepted_count,
    'outstanding_count', outstanding_count,
    'uploaded_unaccepted_count', uploaded_unaccepted_count
  );
end;
$$;
revoke all on function app.document_request_progress(uuid) from public;

create function public.document_request_progress(p_matter_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select app.document_request_progress(p_matter_id);
$$;
revoke all on function public.document_request_progress(uuid) from public, anon;
grant execute on function public.document_request_progress(uuid) to authenticated, service_role;

create function app.unlink_document_matter(
  p_ref_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  ref public.document_matter_refs%rowtype;
begin
  select * into ref from public.document_matter_refs where id = p_ref_id for update;
  if ref.id is null or app.can_read_document(ref.document_id) is distinct from true then
    raise exception 'document link denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    ref.organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[],
    true
  );
  if p_reason is null or length(btrim(p_reason)) not between 3 and 500 then
    raise exception 'a removal reason is required' using errcode = '22023';
  end if;
  perform app.open_document_write(ref.id);
  update public.document_matter_refs
  set removed_at = statement_timestamp(),
      removal_reason = btrim(p_reason)
  where id = ref.id
    and removed_at is null;
  perform app.close_document_write(ref.id);
  perform app.record_audit_event(
    ref.organization_id, 'document.unlinked', 'document_matter_refs', ref.id, 'success',
    jsonb_build_object('document_id', ref.document_id, 'matter_id', ref.matter_id)
  );
end;
$$;
revoke all on function app.unlink_document_matter(uuid, text) from public;

create function public.unlink_document_matter(p_ref_id uuid, p_reason text)
returns void
language sql
security invoker
set search_path = ''
as $$
  select app.unlink_document_matter(p_ref_id, p_reason);
$$;
revoke all on function public.unlink_document_matter(uuid, text) from public, anon;
grant execute on function public.unlink_document_matter(uuid, text) to authenticated, service_role;

grant execute on function app.create_document_request(uuid, uuid, text, text, date, text[], text, date, public.document_audience, public.document_sensitivity, uuid, text) to authenticated, service_role;
grant execute on function app.attach_upload_to_request(uuid, uuid) to authenticated, service_role;
grant execute on function app.review_document_version(uuid, integer, public.document_review_decision, text, text) to authenticated, service_role;
grant execute on function app.waive_document_request(uuid, integer, text) to authenticated, service_role;
grant execute on function app.set_document_expiry(uuid, integer, date) to authenticated, service_role;
grant execute on function app.document_request_progress(uuid) to authenticated, service_role;
grant execute on function app.unlink_document_matter(uuid, text) to authenticated, service_role;

revoke all on table public.document_requests from anon, authenticated;
revoke all on table public.document_reviews from anon, authenticated;
grant select on table public.document_requests to authenticated;
grant select on table public.document_reviews to authenticated;

alter table public.document_requests enable row level security;
alter table public.document_requests force row level security;
alter table public.document_reviews enable row level security;
alter table public.document_reviews force row level security;

create policy document_requests_select on public.document_requests
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (
      (
        (select app.staff_mfa_satisfied())
        and (select app.has_org_role(
          organization_id,
          array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[]
        ))
        and (select app.can_read_matter(matter_id))
      )
      or (
        audience <> 'staff'
        and exists (
          select 1
          from public.persons person
          where person.id = document_requests.person_id
            and person.user_id = (select auth.uid())
        )
      )
      or (
        audience = 'matter'
        and sensitivity = 'ordinary'
        and (select app.can_read_matter(matter_id))
        and exists (
          select 1
          from public.matter_participants party
          join public.persons person
            on person.id = party.person_id
           and person.organization_id = party.organization_id
          where party.matter_id = document_requests.matter_id
            and party.organization_id = document_requests.organization_id
            and person.user_id = (select auth.uid())
        )
      )
    )
  );
create policy document_reviews_select on public.document_reviews
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.can_read_document_version(version_id))
  );
