-- Intake delivery (branch intake-delivery). PRD INT-01, INT-03, INT-04, INT-05, INT-06; T020, T023.
--
-- A firm sends a published intake form to a person on a matter, the client answers it in the
-- portal (autosaved, submitted with a declaration), staff review the answers on the matter's
-- Intake tab, and the client can ask for a correction after submitting. Additive only.
--
-- New tables (forced RLS, no direct writes, append only):
--   * intake_requests: one row per response sent to a person (who sent it, when, the optional due
--     date and message, and the client task it opened). Read by whoever can read the response.
--   * intake_answer_reviews: a staff review of one answer version (INT-04 review state). A newer
--     version of the same answer has no review until someone reviews it. Read by whoever can read
--     the answer.
--   * intake_corrections: a client's correction request after submitting (INT-06), with the answer
--     version it replaced and the new version it made (or none, for "something else"). A firm-wide
--     number gives the client a reference (CR-0001). Read by whoever can read the response.
--
-- New functions:
--   * public.send_intake_request(matter, person, template, due_on, message): firm owner, licensed
--     consultant or case manager who can open the matter, at aal2. Opens the response (the same
--     checks as app.open_intake_response: published, in effect in the firm's timezone, sample and
--     real never linked, sample mode blocks real matters), opens a client task "Complete <form>"
--     for that person, and records the request. Idempotent while the response is an open draft:
--     sending again returns the same request. No email: there is no approved intake-request email
--     design, so the client sees it in the portal (Tasks and Background questions). Audited
--     intake.request_sent.
--   * public.intake_response_forms(response ids): the form (title, version, schema) of each
--     response the caller may read. A client reads their own form even after a newer version of
--     it is published (the intake_templates policy shows clients only the published version).
--   * public.request_intake_correction(response, field, presence, value, reason, description, proof): the
--     response's own person, after submitting. A named answer gets a new version (the old one stays
--     on record, the submitted snapshot is never changed, and this works on a frozen snapshot too:
--     freezing fixes the snapshot, not the live answers). "Something else" records the description
--     only. Optional proof is one of the person's own documents (uploaded through the portal's
--     ordinary upload flow). Staff see it in Sheet > Notifications and on the matter's Intake tab. Sample-mode firms
--     refuse corrections on real matters. Audited intake.correction_requested.
--   * public.review_intake_answer(answer): firm owner, licensed consultant or case manager who can
--     open the matter and read the answer, at aal2, on a submitted response, for the latest version
--     of that answer only. Idempotent. Audited intake.answer_reviewed.
--   * app.save_intake_answer_core: the body of the latest app.save_intake_answer
--     (20261019204200_intake_builder.sql), unchanged, with one parameter p_correction: when true the
--     frozen-snapshot refusal is skipped (only request_intake_correction passes true).
-- Redefined:
--   * app.save_intake_answer (latest 20261019204200_intake_builder.sql): now calls
--     app.save_intake_answer_core(..., false). Same signature, same behaviour.
-- New trigger:
--   * intake_responses_zz_complete_request: when a response becomes submitted, the client task its
--     request opened is marked done (task history records it), and the task's pending reminders are
--     cancelled, as app.set_task_status does.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.intake_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  response_id uuid not null,
  matter_id uuid not null,
  person_id uuid not null,
  template_id uuid not null,
  task_id uuid,
  due_on date,
  message text check (message is null or length(btrim(message)) between 1 and 2000),
  is_sample boolean not null default false,
  sent_by_membership_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  unique (response_id),
  unique (id, organization_id),
  foreign key (response_id, organization_id) references public.intake_responses (id, organization_id),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id),
  foreign key (person_id, organization_id) references public.persons (id, organization_id),
  foreign key (template_id, organization_id) references public.intake_templates (id, organization_id),
  foreign key (task_id, organization_id) references public.tasks (id, organization_id),
  foreign key (sent_by_membership_id, organization_id) references public.memberships (id, organization_id)
);
comment on table public.intake_requests is
  'An intake form sent to a person on a matter: who sent it, the due date and message, and the client task it opened. Append only.';

create index intake_requests_org_fk_idx on public.intake_requests (organization_id);
create index intake_requests_response_org_fk_idx on public.intake_requests (response_id, organization_id);
create index intake_requests_matter_org_fk_idx on public.intake_requests (matter_id, organization_id);
create index intake_requests_person_org_fk_idx on public.intake_requests (person_id, organization_id);
create index intake_requests_template_org_fk_idx on public.intake_requests (template_id, organization_id);
create index intake_requests_task_org_fk_idx on public.intake_requests (task_id, organization_id);
create index intake_requests_sender_org_fk_idx on public.intake_requests (sent_by_membership_id, organization_id);
create index intake_requests_created_by_idx on public.intake_requests (created_by);

create table public.intake_answer_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  answer_id uuid not null,
  response_id uuid not null,
  reviewer_membership_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  unique (answer_id),
  unique (id, organization_id),
  foreign key (answer_id, organization_id) references public.intake_answer_versions (id, organization_id),
  foreign key (response_id, organization_id) references public.intake_responses (id, organization_id),
  foreign key (reviewer_membership_id, organization_id) references public.memberships (id, organization_id)
);
comment on table public.intake_answer_reviews is
  'Staff review of one intake answer version (INT-04). A newer version is unreviewed until reviewed. Append only.';

create index intake_answer_reviews_org_fk_idx on public.intake_answer_reviews (organization_id);
create index intake_answer_reviews_answer_org_fk_idx on public.intake_answer_reviews (answer_id, organization_id);
create index intake_answer_reviews_response_org_fk_idx on public.intake_answer_reviews (response_id, organization_id);
create index intake_answer_reviews_reviewer_org_fk_idx on public.intake_answer_reviews (reviewer_membership_id, organization_id);
create index intake_answer_reviews_created_by_idx on public.intake_answer_reviews (created_by);

create table public.intake_corrections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  response_id uuid not null,
  correction_number integer not null check (correction_number >= 1),
  field_key text check (field_key is null or field_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  previous_answer_id uuid,
  answer_id uuid,
  reason text check (reason is null or length(btrim(reason)) between 1 and 1000),
  description text check (description is null or length(btrim(description)) between 1 and 2000),
  proof_document_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  unique (organization_id, correction_number),
  unique (id, organization_id),
  check ((field_key is null and answer_id is null and previous_answer_id is null and description is not null) or (field_key is not null and answer_id is not null)),
  foreign key (response_id, organization_id) references public.intake_responses (id, organization_id),
  foreign key (previous_answer_id, organization_id) references public.intake_answer_versions (id, organization_id),
  foreign key (answer_id, organization_id) references public.intake_answer_versions (id, organization_id),
  foreign key (proof_document_id, organization_id) references public.documents (id, organization_id)
);
comment on table public.intake_corrections is
  'A client correction after submitting (INT-06): the new answer version it made, or a description for staff. Append only.';

create index intake_corrections_org_fk_idx on public.intake_corrections (organization_id);
create index intake_corrections_response_org_fk_idx on public.intake_corrections (response_id, organization_id);
create index intake_corrections_previous_org_fk_idx on public.intake_corrections (previous_answer_id, organization_id);
create index intake_corrections_answer_org_fk_idx on public.intake_corrections (answer_id, organization_id);
create index intake_corrections_proof_org_fk_idx on public.intake_corrections (proof_document_id, organization_id);
create index intake_corrections_created_by_idx on public.intake_corrections (created_by);

create trigger intake_requests_no_update before update or delete on public.intake_requests
  for each row execute function app.reject_intake_history_mutation();
create trigger intake_answer_reviews_no_update before update or delete on public.intake_answer_reviews
  for each row execute function app.reject_intake_history_mutation();
create trigger intake_corrections_no_update before update or delete on public.intake_corrections
  for each row execute function app.reject_intake_history_mutation();

create trigger intake_requests_stamp before insert on public.intake_requests
  for each row execute function app.stamp_created_by();
create trigger intake_answer_reviews_stamp before insert on public.intake_answer_reviews
  for each row execute function app.stamp_created_by();
create trigger intake_corrections_stamp before insert on public.intake_corrections
  for each row execute function app.stamp_created_by();

revoke all on table public.intake_requests from public, anon, authenticated;
revoke all on table public.intake_answer_reviews from public, anon, authenticated;
revoke all on table public.intake_corrections from public, anon, authenticated;
grant select on table public.intake_requests to authenticated;
grant select on table public.intake_answer_reviews to authenticated;
grant select on table public.intake_corrections to authenticated;

alter table public.intake_requests enable row level security;
alter table public.intake_requests force row level security;
alter table public.intake_answer_reviews enable row level security;
alter table public.intake_answer_reviews force row level security;
alter table public.intake_corrections enable row level security;
alter table public.intake_corrections force row level security;

create policy intake_requests_select on public.intake_requests
  for select to authenticated
  using ((select app.can_read_intake_response(response_id)));
create policy intake_answer_reviews_select on public.intake_answer_reviews
  for select to authenticated
  using ((select app.can_read_intake_answer(answer_id)));
create policy intake_corrections_select on public.intake_corrections
  for select to authenticated
  using ((select app.can_read_intake_response(response_id)));

-- ---------------------------------------------------------------------------
-- Answers: the latest app.save_intake_answer body, with a correction path past a frozen snapshot.
-- ---------------------------------------------------------------------------
-- From 20261019204200_intake_builder.sql (app.save_intake_answer). Only change: p_correction, and
-- the frozen refusal applies when it is false.
create function app.save_intake_answer_core(
  p_response_id uuid,
  p_expected_version integer,
  p_field_key text,
  p_presence public.answer_presence,
  p_value jsonb,
  p_correction boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  response public.intake_responses%rowtype;
  template public.intake_templates%rowtype;
  field jsonb;
  field_type text;
  section_key public.person_section_key;
  date_kind public.answer_date_kind;
  calendar_date date;
  year_value integer;
  month_value integer;
  note text;
  normalized jsonb;
  new_id uuid;
  new_version integer;
begin
  if p_presence is null or p_value is null or jsonb_typeof(p_value) is distinct from 'object' then
    raise exception 'that answer is not usable' using errcode = '22023';
  end if;
  select * into response from public.intake_responses where id = p_response_id for update;
  if response.id is null or app.intake_caller_can_write(response) is distinct from true then
    raise exception 'intake answer denied' using errcode = '42501';
  end if;
  if response.frozen_at is not null and coalesce(p_correction, false) is false then
    raise exception 'that intake snapshot is frozen' using errcode = '42501';
  end if;
  if response.version is distinct from p_expected_version then
    raise exception 'intake version conflict' using errcode = '40001';
  end if;
  select * into template from public.intake_templates where id = response.template_id;
  select value into field
  from jsonb_array_elements(template.schema -> 'fields')
  where value ->> 'key' = p_field_key;
  if field is null then
    raise exception 'that field is not on this intake template' using errcode = '22023';
  end if;
  field_type := field ->> 'type';
  if field ? 'section_key' then
    section_key := (field ->> 'section_key')::public.person_section_key;
  end if;

  if p_presence = 'unknown' and field ? 'allow_unknown' and (field ->> 'allow_unknown') = 'false' then
    raise exception 'this question needs an answer; unknown is not allowed' using errcode = '22023';
  end if;
  if p_presence = 'not_applicable' and field ? 'allow_not_applicable' and (field ->> 'allow_not_applicable') = 'false' then
    raise exception 'this question needs an answer; not applicable is not allowed' using errcode = '22023';
  end if;

  if p_presence in ('unknown', 'not_applicable') then
    normalized := '{}'::jsonb;
  elsif p_presence = 'approximate' then
    if field_type is distinct from 'date' then
      raise exception 'only a date can be approximate' using errcode = '22023';
    end if;
    note := nullif(btrim(p_value ->> 'approximate_note'), '');
    if note is null then
      raise exception 'an approximate date needs a note and is not stored as a full date' using errcode = '22023';
    end if;
    if p_value ? 'year' and (p_value ->> 'year') is not null then
      year_value := (p_value ->> 'year')::integer;
    end if;
    if p_value ? 'month' and (p_value ->> 'month') is not null then
      month_value := (p_value ->> 'month')::integer;
    end if;
    normalized := jsonb_strip_nulls(jsonb_build_object('year', year_value, 'month', month_value, 'approximate_note', note));
  else
    if field_type = 'date' then
      date_kind := (p_value ->> 'date_kind')::public.answer_date_kind;
      if date_kind = 'exact' then
        calendar_date := (p_value ->> 'calendar_date')::date;
        if calendar_date is null then
          raise exception 'an exact date needs a calendar day' using errcode = '22023';
        end if;
        normalized := jsonb_build_object('calendar_date', calendar_date);
      elsif date_kind = 'year_month' then
        year_value := (p_value ->> 'year')::integer;
        month_value := (p_value ->> 'month')::integer;
        if year_value is null or month_value is null then
          raise exception 'a year and month are not a full date' using errcode = '22023';
        end if;
        normalized := jsonb_build_object('year', year_value, 'month', month_value);
      elsif date_kind = 'year' then
        year_value := (p_value ->> 'year')::integer;
        if year_value is null then
          raise exception 'a year is not a full date' using errcode = '22023';
        end if;
        normalized := jsonb_build_object('year', year_value);
      else
        raise exception 'that date precision is not usable' using errcode = '22023';
      end if;
    elsif field_type = 'declaration' then
      if jsonb_typeof(p_value -> 'declaration') is distinct from 'boolean' then
        raise exception 'a declaration needs a yes or no' using errcode = '22023';
      end if;
      normalized := jsonb_build_object('declaration', p_value -> 'declaration');
    elsif field_type in ('repeatable', 'relationship') then
      if jsonb_typeof(p_value -> 'entries') is distinct from 'array' then
        raise exception 'that history needs a list' using errcode = '22023';
      end if;
      normalized := jsonb_build_object('entries', p_value -> 'entries');
    elsif field_type = 'country' then
      if coalesce(p_value ->> 'text', '') !~ '^[A-Z]{2}$' then
        raise exception 'a country is a two-letter code' using errcode = '22023';
      end if;
      normalized := jsonb_build_object('text', p_value ->> 'text');
    elsif field_type = 'choice' then
      if not exists (
        select 1
        from jsonb_array_elements_text(field -> 'options') option
        where option = p_value ->> 'text'
      ) then
        raise exception 'that choice is not on the template' using errcode = '22023';
      end if;
      normalized := jsonb_build_object('text', p_value ->> 'text');
    else
      if nullif(btrim(p_value ->> 'text'), '') is null then
        raise exception 'that answer needs text' using errcode = '22023';
      end if;
      normalized := jsonb_build_object('text', btrim(p_value ->> 'text'));
    end if;
  end if;

  insert into public.intake_answer_versions (
    organization_id, response_id, field_key, section_key, presence, raw_value, normalized_value,
    date_kind, calendar_date, year_value, month_value, approximate_note
  ) values (
    response.organization_id,
    response.id,
    p_field_key,
    section_key,
    p_presence,
    p_value,
    coalesce(normalized, '{}'::jsonb),
    date_kind,
    calendar_date,
    year_value,
    month_value,
    note
  )
  returning id into new_id;

  update public.intake_responses
  set updated_at = statement_timestamp()
  where id = response.id
    and version = p_expected_version
  returning version into new_version;
  if new_version is null then
    raise exception 'intake version conflict' using errcode = '40001';
  end if;

  if response.status = 'submitted' then
    perform app.enqueue_event(
      response.organization_id,
      'intake_response',
      response.id,
      'intake.answer_corrected',
      jsonb_build_object(
        'response_id', response.id,
        'matter_id', response.matter_id,
        'field_key', p_field_key
      ),
      new_version,
      'intake.answer_corrected:' || new_id::text
    );
  end if;
  return new_id;
end;
$$;
revoke all on function app.save_intake_answer_core(uuid, integer, text, public.answer_presence, jsonb, boolean) from public;

-- From 20261019204200_intake_builder.sql. Only change: the body moved to app.save_intake_answer_core.
create or replace function app.save_intake_answer(
  p_response_id uuid,
  p_expected_version integer,
  p_field_key text,
  p_presence public.answer_presence,
  p_value jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  return app.save_intake_answer_core(p_response_id, p_expected_version, p_field_key, p_presence, p_value, false);
end;
$$;
revoke all on function app.save_intake_answer(uuid, integer, text, public.answer_presence, jsonb) from public;
grant execute on function app.save_intake_answer(uuid, integer, text, public.answer_presence, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Send an intake form to a person on a matter.
-- ---------------------------------------------------------------------------
create function public.send_intake_request(
  p_matter_id uuid,
  p_person_id uuid,
  p_template_id uuid,
  p_due_on date,
  p_message text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  matter public.matters%rowtype;
  template public.intake_templates%rowtype;
  person public.persons%rowtype;
  existing public.intake_requests%rowtype;
  sender uuid;
  response_id uuid;
  new_task uuid;
  new_id uuid;
  zone text;
  note text := nullif(btrim(coalesce(p_message, '')), '');
begin
  select * into matter from public.matters where id = p_matter_id;
  if matter.id is null then
    raise exception 'intake request denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    matter.organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[],
    false
  );
  if app.can_read_matter(matter.id) is distinct from true then
    raise exception 'intake request denied' using errcode = '42501';
  end if;
  select * into template
  from public.intake_templates
  where id = p_template_id
    and organization_id = matter.organization_id;
  if template.id is null or template.status is distinct from 'published' then
    raise exception 'choose a published intake form' using errcode = '22023';
  end if;
  if template.effective_on > app.firm_today(matter.organization_id) then
    raise exception 'that intake template is not in effect' using errcode = '42501';
  end if;
  select * into person
  from public.persons
  where id = p_person_id
    and organization_id = matter.organization_id;
  if person.id is null or not exists (
    select 1
    from public.matter_participants party
    where party.matter_id = matter.id
      and party.organization_id = matter.organization_id
      and party.person_id = person.id
  ) then
    raise exception 'an intake form goes to a person on this matter' using errcode = '42501';
  end if;
  if matter.is_sample is distinct from person.is_sample then
    raise exception 'sample and real records cannot be linked' using errcode = '42501';
  end if;
  if app.sample_mode_blocks_real(matter.organization_id, matter.is_sample) then
    raise exception 'this firm is in sample mode; only sample matters accept new work' using errcode = '42501';
  end if;
  if p_due_on is not null and p_due_on < app.firm_today(matter.organization_id) then
    raise exception 'a due date can’t be in the past' using errcode = '22023';
  end if;
  if note is not null and length(note) > 2000 then
    raise exception 'keep the message under 2000 characters' using errcode = '22023';
  end if;

  -- Sending again while the response is an open draft returns the same request.
  select request.* into existing
  from public.intake_requests request
  join public.intake_responses response
    on response.id = request.response_id
   and response.organization_id = request.organization_id
  where request.matter_id = matter.id
    and request.person_id = person.id
    and request.template_id = template.id
    and response.status = 'draft'
    and response.frozen_at is null
  limit 1;
  if existing.id is not null then
    return jsonb_build_object(
      'request_id', existing.id, 'response_id', existing.response_id, 'task_id', existing.task_id, 'created', false
    );
  end if;

  select mem.id into sender
  from public.memberships mem
  where mem.organization_id = matter.organization_id
    and mem.user_id = (select auth.uid())
    and mem.status = 'active'
    and mem.role in ('firm_owner', 'licensed_consultant', 'case_manager')
  order by mem.created_at
  limit 1;

  select response.id into response_id
  from public.intake_responses response
  where response.matter_id = matter.id
    and response.person_id = person.id
    and response.template_id = template.id
    and response.status = 'draft'
    and response.frozen_at is null
  limit 1;
  if response_id is null then
    response_id := app.open_intake_response(template.id, matter.id, person.id);
  end if;

  select coalesce(nullif(btrim(org.timezone), ''), 'America/Toronto') into zone
  from public.organizations org
  where org.id = matter.organization_id;
  new_task := app.create_task(
    matter.id,
    'client',
    left('Complete ' || template.title, 200),
    null,
    person.id,
    'normal',
    p_due_on,
    null,
    zone,
    null,
    null,
    '[]'::jsonb
  );

  insert into public.intake_requests (
    organization_id, response_id, matter_id, person_id, template_id, task_id, due_on, message, is_sample, sent_by_membership_id
  ) values (
    matter.organization_id, response_id, matter.id, person.id, template.id, new_task, p_due_on, note, matter.is_sample, sender
  )
  returning id into new_id;

  perform app.record_audit_event(
    matter.organization_id,
    'intake.request_sent',
    'public.intake_requests',
    new_id,
    'success',
    jsonb_build_object(
      'matter_id', matter.id,
      'person_id', person.id,
      'template_id', template.id,
      'response_id', response_id,
      'task_id', new_task,
      'is_sample', matter.is_sample
    )
  );
  return jsonb_build_object('request_id', new_id, 'response_id', response_id, 'task_id', new_task, 'created', true);
end;
$$;
comment on function public.send_intake_request(uuid, uuid, uuid, date, text) is
  'Sends a published intake form to a person on the matter: opens the response and a client task. Firm owner, licensed consultant or case manager on the matter at aal2. Idempotent while the response is an open draft. No email (no approved design).';
revoke all on function public.send_intake_request(uuid, uuid, uuid, date, text) from public, anon;
grant execute on function public.send_intake_request(uuid, uuid, uuid, date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The form behind each readable response (a client may hold a superseded version).
-- ---------------------------------------------------------------------------
create function public.intake_response_forms(p_response_ids uuid[])
returns table (response_id uuid, template_id uuid, title text, version_number integer, locale text, schema jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select response.id, template.id, template.title, template.version_number, template.locale, template.schema
  from public.intake_responses response
  join public.intake_templates template
    on template.id = response.template_id
   and template.organization_id = response.organization_id
  where response.id = any ((coalesce(p_response_ids, array[]::uuid[]))[1:200])
    and app.can_read_intake_response(response.id);
$$;
comment on function public.intake_response_forms(uuid[]) is
  'The form (title, version, schema) of each intake response the caller may read. Read only.';
revoke all on function public.intake_response_forms(uuid[]) from public, anon;
grant execute on function public.intake_response_forms(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- A client's correction after submitting (INT-06).
-- ---------------------------------------------------------------------------
create function public.request_intake_correction(
  p_response_id uuid,
  p_field_key text,
  p_presence public.answer_presence,
  p_value jsonb,
  p_reason text,
  p_description text,
  p_proof_document_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  response public.intake_responses%rowtype;
  matter_sample boolean;
  previous uuid;
  new_answer uuid;
  next_number integer;
  new_id uuid;
  why text := nullif(btrim(coalesce(p_reason, '')), '');
  what text := nullif(btrim(coalesce(p_description, '')), '');
begin
  select * into response from public.intake_responses where id = p_response_id for update;
  if response.id is null
     or app.in_active_org(response.organization_id) is distinct from true
     or not exists (
       select 1
       from public.persons subject
       where subject.id = response.person_id
         and subject.organization_id = response.organization_id
         and subject.user_id = (select auth.uid())
     ) then
    raise exception 'intake correction denied' using errcode = '42501';
  end if;
  if response.status is distinct from 'submitted' then
    raise exception 'a correction is for answers you already sent; change this one in the form' using errcode = '42501';
  end if;
  select matter.is_sample into matter_sample from public.matters matter where matter.id = response.matter_id;
  if app.sample_mode_blocks_real(response.organization_id, matter_sample) then
    raise exception 'this firm is in sample mode; only sample matters accept new work' using errcode = '42501';
  end if;
  if why is not null and length(why) > 1000 then
    raise exception 'keep the reason under 1000 characters' using errcode = '22023';
  end if;
  if what is not null and length(what) > 2000 then
    raise exception 'keep the description under 2000 characters' using errcode = '22023';
  end if;
  -- Proof is the person's own upload (the portal's ordinary upload flow) on this firm.
  if p_proof_document_id is not null and not exists (
    select 1
    from public.documents doc
    where doc.id = p_proof_document_id
      and doc.organization_id = response.organization_id
      and doc.person_id = response.person_id
  ) then
    raise exception 'that proof is not one of your documents' using errcode = '42501';
  end if;

  if nullif(btrim(coalesce(p_field_key, '')), '') is null then
    if what is null then
      raise exception 'describe what needs fixing' using errcode = '22023';
    end if;
  else
    select answer.id into previous
    from public.intake_answer_versions answer
    where answer.response_id = response.id
      and answer.field_key = p_field_key
    order by answer.created_at desc, answer.id desc
    limit 1;
    if previous is null then
      raise exception 'that question has no answer to correct' using errcode = '22023';
    end if;
    new_answer := app.save_intake_answer_core(response.id, response.version, p_field_key, p_presence, p_value, true);
  end if;

  perform pg_advisory_xact_lock(hashtextextended('intake_corrections:' || response.organization_id::text, 0));
  select coalesce(max(correction_number), 0) + 1 into next_number
  from public.intake_corrections
  where organization_id = response.organization_id;

  insert into public.intake_corrections (
    organization_id, response_id, correction_number, field_key, previous_answer_id, answer_id, reason, description, proof_document_id
  ) values (
    response.organization_id,
    response.id,
    next_number,
    case when new_answer is null then null else p_field_key end,
    previous,
    new_answer,
    why,
    what,
    p_proof_document_id
  )
  returning id into new_id;

  perform app.record_audit_event(
    response.organization_id,
    'intake.correction_requested',
    'public.intake_corrections',
    new_id,
    'success',
    jsonb_build_object(
      'response_id', response.id,
      'matter_id', response.matter_id,
      'field_key', case when new_answer is null then null else p_field_key end,
      'answer_id', new_answer,
      'proof_document_id', p_proof_document_id,
      'is_sample', matter_sample
    )
  );
  return jsonb_build_object(
    'correction_id', new_id,
    'reference', 'CR-' || lpad(next_number::text, 4, '0'),
    'answer_id', new_answer
  );
end;
$$;
comment on function public.request_intake_correction(uuid, text, public.answer_presence, jsonb, text, text, uuid) is
  'The response''s own person corrects a submitted answer (a new version; the snapshot is unchanged) or describes a problem. Staff are alerted in Notifications.';
revoke all on function public.request_intake_correction(uuid, text, public.answer_presence, jsonb, text, text, uuid) from public, anon;
grant execute on function public.request_intake_correction(uuid, text, public.answer_presence, jsonb, text, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Staff review of an answer version (INT-04 review state).
-- ---------------------------------------------------------------------------
create function public.review_intake_answer(p_answer_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  answer public.intake_answer_versions%rowtype;
  response public.intake_responses%rowtype;
  matter_sample boolean;
  reviewer uuid;
  existing uuid;
  latest uuid;
  new_id uuid;
begin
  select * into answer from public.intake_answer_versions where id = p_answer_id;
  if answer.id is null then
    raise exception 'intake review denied' using errcode = '42501';
  end if;
  select * into response from public.intake_responses where id = answer.response_id for update;
  perform app.require_active_staff(
    response.organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[],
    false
  );
  if app.can_read_matter(response.matter_id) is distinct from true
     or app.can_read_intake_answer(answer.id) is distinct from true then
    raise exception 'intake review denied' using errcode = '42501';
  end if;
  if response.status is distinct from 'submitted' then
    raise exception 'review answers once the client sends them' using errcode = '42501';
  end if;
  select matter.is_sample into matter_sample from public.matters matter where matter.id = response.matter_id;
  if app.sample_mode_blocks_real(response.organization_id, matter_sample) then
    raise exception 'this firm is in sample mode; only sample matters accept new work' using errcode = '42501';
  end if;
  select latest_answer.id into latest
  from public.intake_answer_versions latest_answer
  where latest_answer.response_id = answer.response_id
    and latest_answer.field_key = answer.field_key
  order by latest_answer.created_at desc, latest_answer.id desc
  limit 1;
  if latest is distinct from answer.id then
    raise exception 'a newer answer replaced this one; review the newer version' using errcode = '40001';
  end if;
  select review.id into existing from public.intake_answer_reviews review where review.answer_id = answer.id;
  if existing is not null then
    return existing;
  end if;
  select mem.id into reviewer
  from public.memberships mem
  where mem.organization_id = response.organization_id
    and mem.user_id = (select auth.uid())
    and mem.status = 'active'
    and mem.role in ('firm_owner', 'licensed_consultant', 'case_manager')
  order by mem.created_at
  limit 1;
  insert into public.intake_answer_reviews (organization_id, answer_id, response_id, reviewer_membership_id)
  values (response.organization_id, answer.id, response.id, reviewer)
  returning id into new_id;
  perform app.record_audit_event(
    response.organization_id,
    'intake.answer_reviewed',
    'public.intake_answer_reviews',
    new_id,
    'success',
    jsonb_build_object('response_id', response.id, 'matter_id', response.matter_id, 'field_key', answer.field_key, 'answer_id', answer.id)
  );
  return new_id;
end;
$$;
comment on function public.review_intake_answer(uuid) is
  'Marks the latest version of a submitted intake answer reviewed. Firm owner, licensed consultant or case manager on the matter at aal2. Idempotent.';
revoke all on function public.review_intake_answer(uuid) from public, anon;
grant execute on function public.review_intake_answer(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Submitting a response completes the client task its request opened.
-- ---------------------------------------------------------------------------
create function app.complete_intake_request_task()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  task public.tasks%rowtype;
begin
  if old.status is distinct from 'draft' or new.status is distinct from 'submitted' then
    return new;
  end if;
  for task in
    select t.*
    from public.intake_requests request
    join public.tasks t
      on t.id = request.task_id
     and t.organization_id = request.organization_id
    where request.response_id = new.id
      and t.status in ('open', 'blocked')
  loop
    perform app.open_task_write(task.id);
    update public.tasks
    set status = 'done',
        blocker_note = null,
        completed_at = statement_timestamp()
    where id = task.id;
    perform app.close_task_write(task.id);
    update public.reminder_schedules
    set status = 'cancelled'
    where status = 'pending'
      and task_id = task.id;
    insert into public.task_events (organization_id, task_id, event_kind, from_status, to_status, actor_user_id)
    values (task.organization_id, task.id, 'status', task.status, 'done', (select auth.uid()));
  end loop;
  return new;
end;
$$;
revoke all on function app.complete_intake_request_task() from public;

create trigger intake_responses_zz_complete_request after update on public.intake_responses
  for each row execute function app.complete_intake_request_task();
