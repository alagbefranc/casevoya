-- DOC-01 (#178): firm checklist templates (draft, then approved by a licensed consultant) and
-- Apply checklist on a matter, which turns a template and the people's intake answers into
-- document requests. Re-applying after answers change proposes additions and removals for staff
-- to confirm; nothing is added or removed without that confirmation.
--
-- New tables:
--   public.checklist_templates        one version of a firm checklist: its stable key, title,
--                                     version number and state (draft -> approved -> retired).
--   public.checklist_template_items   the items of one version: type, explanation, who provides
--                                     it (client or staff), due offset, formats, review criteria,
--                                     whether it has an expiry to record, which people it is for
--                                     (a matter role), and an optional condition on an intake answer.
-- Changed table:
--   public.document_requests          + checklist_item_id: the template item a request came from.
-- New functions:
--   public.save_checklist_template(uuid, text, text, jsonb)   owner, licensed consultant or case
--                                     manager (aal2): creates or replaces a draft. Saving under the
--                                     key of an approved template starts its next version.
--   public.approve_checklist_template(uuid, integer)          a licensed consultant, with a
--                                     step-up: approves a draft; its previous approved version is
--                                     retired. Only approved templates can be applied.
--   public.checklist_apply_preview(uuid, uuid)                staff on the matter: what applying
--                                     would add, what it would remove, and what waits for an answer.
--   public.apply_checklist(uuid, uuid, jsonb, uuid[])         owner, licensed consultant or case
--                                     manager on the matter, with a step-up: creates the confirmed
--                                     additions (through app.create_document_request) and cancels
--                                     the confirmed removals. Only proposals the preview makes now
--                                     are accepted. Audited.

create type public.checklist_template_status as enum ('draft', 'approved', 'retired');

create table public.checklist_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  stable_key text not null check (stable_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  title text not null check (length(btrim(title)) between 1 and 200),
  version_number integer not null check (version_number >= 1),
  status public.checklist_template_status not null default 'draft',
  approved_by_membership_id uuid,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (organization_id, stable_key, version_number),
  unique (id, organization_id),
  check ((status = 'draft') = (approved_at is null)),
  check ((approved_at is null) = (approved_by_membership_id is null)),
  foreign key (approved_by_membership_id, organization_id) references public.memberships (id, organization_id)
);
comment on table public.checklist_templates is
  'A firm checklist template version (DOC-01). Approved by a licensed consultant before it can be applied; an approved version never changes.';

create unique index checklist_templates_one_draft_uidx on public.checklist_templates (organization_id, stable_key) where status = 'draft';
create index checklist_templates_org_fk_idx on public.checklist_templates (organization_id);
create index checklist_templates_approver_org_fk_idx on public.checklist_templates (approved_by_membership_id, organization_id);
create index checklist_templates_created_by_idx on public.checklist_templates (created_by);

create table public.checklist_template_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  template_id uuid not null,
  position integer not null check (position >= 0),
  item_key text not null check (item_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  purpose text not null check (length(btrim(purpose)) between 1 and 200),
  explanation text not null check (length(btrim(explanation)) between 3 and 2000),
  owner text not null default 'client' check (owner in ('client', 'staff')),
  due_offset_days integer check (due_offset_days is null or due_offset_days between 0 and 365),
  acceptable_formats text[] not null check (
    cardinality(acceptable_formats) between 1 and 5
    and acceptable_formats <@ array['pdf', 'jpeg', 'png', 'heic', 'docx']::text[]
  ),
  review_criteria text check (review_criteria is null or length(btrim(review_criteria)) between 3 and 2000),
  records_expiry boolean not null default false,
  party_role public.matter_party_role check (party_role is null or party_role in ('applicant', 'dependant', 'sponsor', 'employer', 'guardian')),
  condition_field text check (condition_field is null or condition_field ~ '^[a-z][a-z0-9_]{0,63}$'),
  condition_equals text check (condition_equals is null or length(btrim(condition_equals)) between 1 and 200),
  created_at timestamptz not null default now(),
  unique (template_id, item_key),
  unique (id, organization_id),
  check ((condition_field is null) = (condition_equals is null)),
  foreign key (template_id, organization_id) references public.checklist_templates (id, organization_id)
);
comment on table public.checklist_template_items is
  'One item of a checklist template version (DOC-01): what is asked for, of whom, and the intake answer it depends on.';

create index checklist_template_items_template_idx on public.checklist_template_items (template_id, position);
create index checklist_template_items_org_fk_idx on public.checklist_template_items (organization_id);
create index checklist_template_items_template_org_fk_idx on public.checklist_template_items (template_id, organization_id);

alter table public.document_requests add column checklist_item_id uuid;
alter table public.document_requests
  add constraint document_requests_checklist_item_fk foreign key (checklist_item_id, organization_id)
  references public.checklist_template_items (id, organization_id);
create index document_requests_checklist_item_org_fk_idx on public.document_requests (checklist_item_id, organization_id);
comment on column public.document_requests.checklist_item_id is
  'DOC-01: the checklist template item this request was generated from (its template version shows with it).';

alter table public.checklist_templates enable row level security;
alter table public.checklist_templates force row level security;
alter table public.checklist_template_items enable row level security;
alter table public.checklist_template_items force row level security;
revoke all on table public.checklist_templates from anon, authenticated;
revoke all on table public.checklist_template_items from anon, authenticated;
grant select on table public.checklist_templates to authenticated;
grant select on table public.checklist_template_items to authenticated;
grant select, insert, update on table public.checklist_templates to service_role;
grant select, insert, update on table public.checklist_template_items to service_role;

-- Staff of the firm read its templates. A client sees the requests made from them, not the templates.
create policy checklist_templates_select on public.checklist_templates
  for select to authenticated
  using ((select app.staff_mfa_satisfied()) and (select app.is_org_staff(organization_id)));
create policy checklist_template_items_select on public.checklist_template_items
  for select to authenticated
  using ((select app.staff_mfa_satisfied()) and (select app.is_org_staff(organization_id)));

create function public.save_checklist_template(p_template_id uuid, p_stable_key text, p_title text, p_items jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid := app.current_organization_id();
  template public.checklist_templates%rowtype;
  skey text := nullif(btrim(p_stable_key), '');
  next_number integer;
  item jsonb;
  n integer := 0;
  formats text[];
  role_text text;
begin
  if org is null then
    raise exception 'checklist denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(org, array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[], false);
  if p_title is null or length(btrim(p_title)) not between 1 and 200 then
    raise exception 'give the checklist a title' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 60 then
    raise exception 'a checklist needs 1 to 60 items' using errcode = '22023';
  end if;

  if p_template_id is not null then
    select * into template from public.checklist_templates where id = p_template_id for update;
    if template.id is null or template.organization_id is distinct from org then
      raise exception 'checklist denied' using errcode = '42501';
    end if;
    if template.status is distinct from 'draft' then
      raise exception 'an approved checklist doesn''t change; save a new version' using errcode = '22023';
    end if;
    update public.checklist_templates set title = btrim(p_title) where id = template.id;
    delete from public.checklist_template_items where template_id = template.id;
  else
    if skey is null or skey !~ '^[a-z][a-z0-9_]{0,63}$' then
      raise exception 'that checklist key is not usable' using errcode = '22023';
    end if;
    select draft.* into template from public.checklist_templates draft
    where draft.organization_id = org and draft.stable_key = skey and draft.status = 'draft'
    for update;
    if template.id is not null then
      update public.checklist_templates set title = btrim(p_title) where id = template.id;
      delete from public.checklist_template_items where template_id = template.id;
    else
      select coalesce(max(existing.version_number), 0) + 1 into next_number
      from public.checklist_templates existing
      where existing.organization_id = org and existing.stable_key = skey;
      insert into public.checklist_templates (organization_id, stable_key, title, version_number, created_by)
      values (org, skey, btrim(p_title), next_number, (select auth.uid()))
      returning * into template;
    end if;
  end if;

  for item in select value from jsonb_array_elements(p_items) loop
    formats := array(select jsonb_array_elements_text(coalesce(item -> 'acceptable_formats', '[]'::jsonb)));
    role_text := nullif(item ->> 'party_role', '');
    if coalesce(item ->> 'owner', 'client') not in ('client', 'staff') then
      raise exception 'an item is provided by the client or the firm' using errcode = '22023';
    end if;
    if role_text is not null and role_text not in ('applicant', 'dependant', 'sponsor', 'employer', 'guardian') then
      raise exception 'choose who on the matter an item is for' using errcode = '22023';
    end if;
    if (nullif(item ->> 'condition_field', '') is null) <> (nullif(btrim(item ->> 'condition_equals'), '') is null) then
      raise exception 'a condition needs both the question and the answer' using errcode = '22023';
    end if;
    begin
      insert into public.checklist_template_items (
        organization_id, template_id, position, item_key, purpose, explanation, owner, due_offset_days,
        acceptable_formats, review_criteria, records_expiry, party_role, condition_field, condition_equals
      ) values (
        org,
        template.id,
        n,
        coalesce(nullif(item ->> 'item_key', ''), 'item_' || (n + 1)),
        btrim(item ->> 'purpose'),
        btrim(item ->> 'explanation'),
        coalesce(item ->> 'owner', 'client'),
        nullif(item ->> 'due_offset_days', '')::integer,
        formats,
        nullif(btrim(item ->> 'review_criteria'), ''),
        coalesce((item ->> 'records_expiry')::boolean, false),
        role_text::public.matter_party_role,
        nullif(item ->> 'condition_field', ''),
        nullif(btrim(item ->> 'condition_equals'), '')
      );
    exception
      when check_violation or not_null_violation or invalid_text_representation then
        raise exception 'item % needs a type, an explanation of at least 3 characters and an accepted format', n + 1 using errcode = '22023';
      when unique_violation then
        raise exception 'two items have the same key' using errcode = '22023';
    end;
    n := n + 1;
  end loop;

  perform app.record_audit_event(org, 'checklist.saved', 'public.checklist_templates', template.id, 'success',
    jsonb_build_object('stable_key', template.stable_key, 'version_number', template.version_number, 'items', n));
  return template.id;
end;
$$;
revoke all on function public.save_checklist_template(uuid, text, text, jsonb) from public;
grant execute on function public.save_checklist_template(uuid, text, text, jsonb) to authenticated;

create function public.approve_checklist_template(p_template_id uuid, p_expected_version integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  template public.checklist_templates%rowtype;
  approver uuid;
  new_version integer;
begin
  select * into template from public.checklist_templates where id = p_template_id for update;
  if template.id is null or template.organization_id is distinct from app.current_organization_id() then
    raise exception 'checklist denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(template.organization_id, array['licensed_consultant']::public.org_role[], true);
  if template.version is distinct from p_expected_version then
    raise exception 'checklist version conflict' using errcode = 'PT409';
  end if;
  if template.status is distinct from 'draft' then
    raise exception 'only a draft is approved' using errcode = '22023';
  end if;
  if not exists (select 1 from public.checklist_template_items item where item.template_id = template.id) then
    raise exception 'a checklist needs 1 to 60 items' using errcode = '22023';
  end if;
  select mem.id into approver
  from public.memberships mem
  where mem.organization_id = template.organization_id
    and mem.user_id = (select auth.uid())
    and mem.status = 'active'
    and mem.role = 'licensed_consultant'
  limit 1;
  update public.checklist_templates
  set status = 'retired'
  where organization_id = template.organization_id and stable_key = template.stable_key and status = 'approved';
  update public.checklist_templates
  set status = 'approved', approved_at = statement_timestamp(), approved_by_membership_id = approver
  where id = template.id
  returning version into new_version;
  perform app.record_audit_event(template.organization_id, 'checklist.approved', 'public.checklist_templates', template.id, 'success',
    jsonb_build_object('stable_key', template.stable_key, 'version_number', template.version_number));
  return new_version;
end;
$$;
revoke all on function public.approve_checklist_template(uuid, integer) from public;
grant execute on function public.approve_checklist_template(uuid, integer) to authenticated;

create trigger checklist_templates_touch before update on public.checklist_templates
  for each row execute function app.touch_row();

-- The proposals for one approved template on one matter, computed now.
create function app.checklist_proposals(p_matter_id uuid, p_template_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  matter public.matters%rowtype;
  template public.checklist_templates%rowtype;
  adds jsonb := '[]'::jsonb;
  removes jsonb := '[]'::jsonb;
  waiting jsonb := '[]'::jsonb;
  item public.checklist_template_items%rowtype;
  party record;
  answer text;
  answered boolean;
  applies boolean;
  existing record;
begin
  select * into matter from public.matters where id = p_matter_id;
  if matter.id is null or app.can_read_matter(matter.id) is distinct from true then
    raise exception 'checklist denied' using errcode = '42501';
  end if;
  select * into template from public.checklist_templates where id = p_template_id;
  if template.id is null or template.organization_id is distinct from matter.organization_id then
    raise exception 'checklist denied' using errcode = '42501';
  end if;
  if template.status is distinct from 'approved' then
    raise exception 'only an approved checklist is applied' using errcode = '22023';
  end if;

  for item in select * from public.checklist_template_items where template_id = template.id order by position loop
    for party in
      select distinct on (person.id) person.id as person_id, person.display_name, participant.role
      from public.matter_participants participant
      join public.persons person on person.id = participant.person_id and person.organization_id = participant.organization_id
      where participant.matter_id = matter.id
        and participant.role in ('applicant', 'dependant', 'sponsor', 'employer', 'guardian')
        and person.is_sample is not distinct from matter.is_sample
      order by person.id, participant.role
    loop
      if item.party_role is not null and party.role is distinct from item.party_role then
        applies := false;
        answered := true;
      elsif item.condition_field is null then
        applies := true;
        answered := true;
      else
        select coalesce(version.normalized_value ->> 'text', version.normalized_value ->> 'declaration') into answer
        from public.intake_answer_versions version
        join public.intake_responses response on response.id = version.response_id
        where response.matter_id = matter.id
          and response.person_id = party.person_id
          and version.field_key = item.condition_field
          and version.presence = 'provided'
        order by version.created_at desc, version.id desc
        limit 1;
        answered := answer is not null;
        applies := answered and lower(btrim(answer)) = lower(btrim(item.condition_equals));
      end if;

      -- A request from this item (any version of the template, by its item key) for this person.
      select request.id, request.status into existing
      from public.document_requests request
      join public.checklist_template_items made on made.id = request.checklist_item_id
      join public.checklist_templates made_from on made_from.id = made.template_id
      where request.matter_id = matter.id
        and request.person_id = party.person_id
        and request.status <> 'cancelled'
        and made_from.organization_id = template.organization_id
        and made_from.stable_key = template.stable_key
        and made.item_key = item.item_key
      order by request.created_at desc
      limit 1;

      if not answered and existing.id is null then
        waiting := waiting || jsonb_build_object('item_id', item.id, 'purpose', item.purpose, 'person_id', party.person_id, 'person', party.display_name, 'field', item.condition_field);
      elsif applies and existing.id is null then
        adds := adds || jsonb_build_object('item_id', item.id, 'purpose', item.purpose, 'person_id', party.person_id, 'person', party.display_name);
      elsif not applies and answered and existing.id is not null and existing.status = 'open' then
        removes := removes || jsonb_build_object('request_id', existing.id, 'purpose', item.purpose, 'person_id', party.person_id, 'person', party.display_name,
          'reason', case when item.party_role is not null and party.role is distinct from item.party_role then 'not for this person''s role' else 'the intake answer changed' end);
      end if;
      answer := null;
    end loop;
  end loop;
  return jsonb_build_object('add', adds, 'remove', removes, 'waiting', waiting,
    'template', jsonb_build_object('id', template.id, 'title', template.title, 'version_number', template.version_number));
end;
$$;
revoke all on function app.checklist_proposals(uuid, uuid) from public;

create function public.checklist_apply_preview(p_matter_id uuid, p_template_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  org uuid;
begin
  select matter.organization_id into org from public.matters matter where matter.id = p_matter_id;
  if org is null then
    raise exception 'checklist denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(org, array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[], false);
  return app.checklist_proposals(p_matter_id, p_template_id);
end;
$$;
revoke all on function public.checklist_apply_preview(uuid, uuid) from public;
grant execute on function public.checklist_apply_preview(uuid, uuid) to authenticated;

create function public.apply_checklist(p_matter_id uuid, p_template_id uuid, p_add jsonb, p_remove uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  matter public.matters%rowtype;
  proposals jsonb;
  pick jsonb;
  item public.checklist_template_items%rowtype;
  request_id uuid;
  created integer := 0;
  cancelled integer := 0;
  today date;
begin
  select * into matter from public.matters where id = p_matter_id;
  if matter.id is null then
    raise exception 'checklist denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(matter.organization_id, array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[], true);
  proposals := app.checklist_proposals(p_matter_id, p_template_id);
  today := app.firm_today(matter.organization_id);

  for pick in select value from jsonb_array_elements(coalesce(p_add, '[]'::jsonb)) loop
    if not exists (
      select 1 from jsonb_array_elements(proposals -> 'add') proposed
      where proposed ->> 'item_id' = pick ->> 'item_id' and proposed ->> 'person_id' = pick ->> 'person_id'
    ) then
      raise exception 'the checklist changed; look at the proposals again' using errcode = 'PT409';
    end if;
    select * into item from public.checklist_template_items where id = (pick ->> 'item_id')::uuid;
    request_id := app.create_document_request(
      matter.id,
      (pick ->> 'person_id')::uuid,
      item.purpose,
      item.explanation,
      case when item.due_offset_days is null then null else today + item.due_offset_days end,
      item.acceptable_formats,
      concat_ws(' ', item.review_criteria, case when item.records_expiry then 'Record the expiry date printed on it.' end),
      null,
      case when item.owner = 'staff' then 'staff'::public.document_audience else 'subject'::public.document_audience end,
      'ordinary'::public.document_sensitivity,
      null,
      null
    );
    perform app.open_document_write(request_id);
    update public.document_requests set checklist_item_id = item.id where id = request_id;
    perform app.close_document_write(request_id);
    created := created + 1;
  end loop;

  if p_remove is not null then
    for request_id in select unnest(p_remove) loop
      if not exists (select 1 from jsonb_array_elements(proposals -> 'remove') proposed where proposed ->> 'request_id' = request_id::text) then
        raise exception 'the checklist changed; look at the proposals again' using errcode = 'PT409';
      end if;
      perform app.open_document_write(request_id);
      update public.document_requests set status = 'cancelled' where id = request_id and status = 'open';
      perform app.close_document_write(request_id);
      perform app.record_audit_event(matter.organization_id, 'document.request_cancelled', 'document_requests', request_id, 'success',
        jsonb_build_object('matter_id', matter.id, 'reason', 'checklist re-applied'));
      cancelled := cancelled + 1;
    end loop;
  end if;

  perform app.record_audit_event(matter.organization_id, 'checklist.applied', 'public.checklist_templates', p_template_id, 'success',
    jsonb_build_object('matter_id', matter.id, 'created', created, 'cancelled', cancelled));
  return jsonb_build_object('created', created, 'cancelled', cancelled);
end;
$$;
revoke all on function public.apply_checklist(uuid, uuid, jsonb, uuid[]) from public;
grant execute on function public.apply_checklist(uuid, uuid, jsonb, uuid[]) to authenticated;
