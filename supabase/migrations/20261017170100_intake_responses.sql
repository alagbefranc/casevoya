-- Versioned intake (PRD §9 INT-01 to INT-06, T020 surface used by T023).
-- Firm-authored templates only. Workflow categories are buckets, not a claim
-- that a government form or program is mapped. No pack, fee, or question is seeded.
-- Answers are append-only. A partial date never becomes a calendar date.
-- Additive only.

create type public.intake_workflow_category as enum (
  'temporary_residence',
  'study',
  'work',
  'permanent_residence',
  'sponsorship',
  'citizenship',
  'provincial',
  'unspecified'
);
comment on type public.intake_workflow_category is
  'INT-02 workflow bucket. Not a program catalogue and not a government form.';

create type public.intake_template_status as enum ('draft', 'published', 'superseded');
create type public.intake_response_status as enum ('draft', 'submitted');
create type public.intake_field_type as enum (
  'text',
  'date',
  'country',
  'address',
  'repeatable',
  'relationship',
  'declaration',
  'file_request',
  'choice'
);
create type public.answer_presence as enum ('provided', 'unknown', 'not_applicable', 'approximate');
create type public.answer_date_kind as enum ('exact', 'year_month', 'year');

create table public.intake_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  stable_key text not null check (stable_key ~ '^[a-z][a-z0-9_]{1,80}$'),
  version_number integer not null check (version_number >= 1),
  status public.intake_template_status not null default 'draft',
  locale text not null check (locale in ('en-CA', 'fr-CA')),
  title text not null check (length(btrim(title)) between 1 and 200),
  workflow_category public.intake_workflow_category not null default 'unspecified',
  schema jsonb not null,
  effective_on date,
  rule_pack_version_id uuid references public.rule_pack_versions (id),
  reviewer_membership_id uuid,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (organization_id, stable_key, version_number),
  unique (id, organization_id),
  check (status <> 'published' or (effective_on is not null and reviewer_membership_id is not null and published_at is not null)),
  foreign key (reviewer_membership_id, organization_id) references public.memberships (id, organization_id)
);
comment on table public.intake_templates is
  'Firm intake schema. Field keys are stable. Publishing pins the schema. An optional rule pack must already be published.';

create index intake_templates_org_status_idx on public.intake_templates (organization_id, status);
create index intake_templates_pack_idx on public.intake_templates (rule_pack_version_id);
create index intake_templates_reviewer_org_fk_idx
  on public.intake_templates (reviewer_membership_id, organization_id);
create index intake_templates_created_by_idx on public.intake_templates (created_by);

create table public.intake_responses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  template_id uuid not null,
  matter_id uuid not null,
  person_id uuid not null,
  status public.intake_response_status not null default 'draft',
  submitted_at timestamptz,
  frozen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id),
  check (status <> 'submitted' or submitted_at is not null),
  check (frozen_at is null or status = 'submitted'),
  foreign key (template_id, organization_id) references public.intake_templates (id, organization_id),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id),
  foreign key (person_id, organization_id) references public.persons (id, organization_id)
);
comment on table public.intake_responses is
  'One assignment of a template to a person on a matter. Submit freezes a snapshot; later answers are new versions.';

create unique index intake_responses_open_uidx
  on public.intake_responses (matter_id, person_id, template_id)
  where status = 'draft' and frozen_at is null;
create index intake_responses_org_fk_idx on public.intake_responses (organization_id);
create index intake_responses_template_org_fk_idx on public.intake_responses (template_id, organization_id);
create index intake_responses_matter_org_fk_idx on public.intake_responses (matter_id, organization_id);
create index intake_responses_person_org_fk_idx on public.intake_responses (person_id, organization_id);
create index intake_responses_created_by_idx on public.intake_responses (created_by);

create table public.intake_answer_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  response_id uuid not null,
  field_key text not null check (field_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  section_key public.person_section_key,
  presence public.answer_presence not null,
  raw_value jsonb not null,
  normalized_value jsonb not null,
  date_kind public.answer_date_kind,
  calendar_date date,
  year_value integer,
  month_value integer,
  approximate_note text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  check (calendar_date is null or date_kind = 'exact'),
  check (date_kind is distinct from 'exact' or calendar_date is not null),
  check (month_value is null or month_value between 1 and 12),
  check (year_value is null or year_value between 1800 and 2200),
  check (approximate_note is null or length(approximate_note) <= 500),
  check (presence <> 'approximate' or approximate_note is not null),
  check (
    presence not in ('unknown', 'not_applicable')
    or (
      date_kind is null
      and calendar_date is null
      and year_value is null
      and month_value is null
      and approximate_note is null
      and normalized_value = '{}'::jsonb
    )
  ),
  unique (id, organization_id),
  foreign key (response_id, organization_id) references public.intake_responses (id, organization_id)
);
comment on table public.intake_answer_versions is
  'Append-only answer history. calendar_date is set only for an exact day. Unknown stays unknown.';

create index intake_answer_versions_response_idx
  on public.intake_answer_versions (response_id, field_key, created_at desc);
create index intake_answer_versions_org_fk_idx on public.intake_answer_versions (organization_id);
create index intake_answer_versions_response_org_fk_idx
  on public.intake_answer_versions (response_id, organization_id);
create index intake_answer_versions_created_by_idx on public.intake_answer_versions (created_by);

create table public.intake_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  response_id uuid not null,
  snapshot_number integer not null check (snapshot_number >= 1),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  unique (response_id, snapshot_number),
  unique (id, organization_id),
  foreign key (response_id, organization_id) references public.intake_responses (id, organization_id)
);
comment on table public.intake_snapshots is
  'Immutable copy taken at submit. Later corrections do not rewrite it.';

create index intake_snapshots_org_fk_idx on public.intake_snapshots (organization_id);
create index intake_snapshots_response_org_fk_idx on public.intake_snapshots (response_id, organization_id);
create index intake_snapshots_created_by_idx on public.intake_snapshots (created_by);

create table public.intake_snapshot_answers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  snapshot_id uuid not null,
  field_key text not null,
  section_key public.person_section_key,
  presence public.answer_presence not null,
  normalized_value jsonb not null,
  date_kind public.answer_date_kind,
  calendar_date date,
  year_value integer,
  month_value integer,
  source_answer_id uuid not null,
  created_at timestamptz not null default now(),
  unique (snapshot_id, field_key),
  foreign key (snapshot_id, organization_id) references public.intake_snapshots (id, organization_id),
  foreign key (source_answer_id, organization_id) references public.intake_answer_versions (id, organization_id)
);
comment on table public.intake_snapshot_answers is
  'The answers inside one submitted snapshot. Not updated.';

create index intake_snapshot_answers_org_fk_idx on public.intake_snapshot_answers (organization_id);
create index intake_snapshot_answers_snapshot_org_fk_idx
  on public.intake_snapshot_answers (snapshot_id, organization_id);
create index intake_snapshot_answers_source_org_fk_idx
  on public.intake_snapshot_answers (source_answer_id, organization_id);

create function app.reject_intake_history_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'intake history is append-only' using errcode = '42501';
end;
$$;
revoke all on function app.reject_intake_history_mutation() from public;

create trigger intake_answer_versions_no_update before update or delete on public.intake_answer_versions
  for each row execute function app.reject_intake_history_mutation();
create trigger intake_snapshots_no_update before update or delete on public.intake_snapshots
  for each row execute function app.reject_intake_history_mutation();
create trigger intake_snapshot_answers_no_update before update or delete on public.intake_snapshot_answers
  for each row execute function app.reject_intake_history_mutation();

create trigger intake_templates_touch before update on public.intake_templates
  for each row execute function app.touch_row();
create trigger intake_templates_immutable before update on public.intake_templates
  for each row execute function app.guard_tenant_keys();
create trigger intake_templates_stamp before insert on public.intake_templates
  for each row execute function app.stamp_created_by();
create trigger intake_templates_audit after insert or update or delete on public.intake_templates
  for each row execute function app.audit_row_change('schema');

create trigger intake_responses_touch before update on public.intake_responses
  for each row execute function app.touch_row();
create trigger intake_responses_immutable before update on public.intake_responses
  for each row execute function app.guard_tenant_keys();
create trigger intake_responses_stamp before insert on public.intake_responses
  for each row execute function app.stamp_created_by();
create trigger intake_responses_audit after insert or update or delete on public.intake_responses
  for each row execute function app.audit_row_change();

create trigger intake_answer_versions_stamp before insert on public.intake_answer_versions
  for each row execute function app.stamp_created_by();
create trigger intake_answer_versions_audit after insert or update or delete on public.intake_answer_versions
  for each row execute function app.audit_row_change('raw_value', 'normalized_value', 'approximate_note');

create trigger intake_snapshots_stamp before insert on public.intake_snapshots
  for each row execute function app.stamp_created_by();
create trigger intake_snapshots_audit after insert or update or delete on public.intake_snapshots
  for each row execute function app.audit_row_change();
create trigger intake_snapshot_answers_audit after insert or update or delete on public.intake_snapshot_answers
  for each row execute function app.audit_row_change('normalized_value');

create function app.intake_schema_ok(p_schema jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  field jsonb;
  seen text[] := array[]::text[];
  key text;
  field_type text;
  labels jsonb;
begin
  if jsonb_typeof(p_schema) is distinct from 'object' or jsonb_typeof(p_schema -> 'fields') is distinct from 'array' then
    return false;
  end if;
  if jsonb_array_length(p_schema -> 'fields') < 1 or jsonb_array_length(p_schema -> 'fields') > 200 then
    return false;
  end if;
  for field in select value from jsonb_array_elements(p_schema -> 'fields')
  loop
    key := field ->> 'key';
    field_type := field ->> 'type';
    labels := field -> 'labels';
    if key is null or key !~ '^[a-z][a-z0-9_]{0,63}$' or key = any (seen) then
      return false;
    end if;
    if field_type is null or field_type not in (
      'text', 'date', 'country', 'address', 'repeatable', 'relationship', 'declaration', 'file_request', 'choice'
    ) then
      return false;
    end if;
    if jsonb_typeof(labels) is distinct from 'object' then
      return false;
    end if;
    if coalesce(labels ->> 'en-CA', labels ->> 'fr-CA') is null then
      return false;
    end if;
    if field ? 'section_key'
       and (field ->> 'section_key') not in (
         'passport_bio', 'school_transcript', 'police_certificate', 'shared_family_record', 'private_record'
       ) then
      return false;
    end if;
    if field ? 'show_when' and (
      jsonb_typeof(field -> 'show_when') is distinct from 'object'
      or (field -> 'show_when' ->> 'field') is null
      or not (field -> 'show_when' ? 'equals')
    ) then
      return false;
    end if;
    if field_type = 'choice' and (
      jsonb_typeof(field -> 'options') is distinct from 'array'
      or jsonb_array_length(field -> 'options') < 1
    ) then
      return false;
    end if;
    seen := seen || key;
  end loop;
  return true;
end;
$$;
revoke all on function app.intake_schema_ok(jsonb) from public;

create function app.guard_intake_template()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.stable_key is distinct from old.stable_key
       or new.version_number is distinct from old.version_number
       or new.schema is distinct from old.schema
       or new.locale is distinct from old.locale
       or new.workflow_category is distinct from old.workflow_category
       or new.rule_pack_version_id is distinct from old.rule_pack_version_id
       or new.effective_on is distinct from old.effective_on then
      raise exception 'a published intake schema is versioned by inserting a new row' using errcode = '42501';
    end if;
    if not (old.status = 'published' and new.status = 'superseded') then
      raise exception 'intake template status changes only when a newer version is published' using errcode = '42501';
    end if;
  end if;
  if app.intake_schema_ok(new.schema) is distinct from true then
    raise exception 'intake schema is not usable' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function app.guard_intake_template() from public;

create trigger intake_templates_guard before insert or update on public.intake_templates
  for each row execute function app.guard_intake_template();

create function app.can_read_intake_response(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.intake_responses response
    join public.persons subject
      on subject.id = response.person_id
     and subject.organization_id = response.organization_id
    where response.id = p_id
      and app.in_active_org(response.organization_id)
      and (
        subject.user_id = (select auth.uid())
        or (
          app.staff_mfa_satisfied()
          and app.can_read_matter(response.matter_id)
          and app.is_org_staff(response.organization_id)
        )
      )
  );
$$;
revoke all on function app.can_read_intake_response(uuid) from public;
grant execute on function app.can_read_intake_response(uuid) to authenticated, service_role;

create function app.can_read_intake_answer(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.intake_answer_versions answer
    join public.intake_responses response
      on response.id = answer.response_id
     and response.organization_id = answer.organization_id
    join public.persons subject
      on subject.id = response.person_id
     and subject.organization_id = response.organization_id
    where answer.id = p_id
      and app.in_active_org(answer.organization_id)
      and (
        subject.user_id = (select auth.uid())
        or (
          app.staff_mfa_satisfied()
          and (
            app.actor_staff_assigned_to_matter(response.matter_id, response.organization_id)
            or (
              answer.created_by = (select auth.uid())
              and app.has_org_role(
                response.organization_id,
                array['licensed_consultant', 'case_manager']::public.org_role[]
              )
            )
            or app.break_glass_person_open(subject.id)
          )
        )
        or (
          (answer.section_key is null or answer.section_key = 'shared_family_record')
          and exists (
            select 1
            from public.matter_participants party
            join public.persons viewer
              on viewer.id = party.person_id
             and viewer.organization_id = party.organization_id
            where party.matter_id = response.matter_id
              and party.organization_id = response.organization_id
              and viewer.user_id = (select auth.uid())
          )
        )
        or exists (
          select 1
          from public.section_shares share
          join public.persons grantee
            on grantee.id = share.grantee_person_id
           and grantee.organization_id = share.organization_id
          where answer.section_key is not null
            and share.organization_id = answer.organization_id
            and share.subject_person_id = response.person_id
            and share.matter_id = response.matter_id
            and share.section_key = answer.section_key
            and share.revoked_at is null
            and grantee.user_id = (select auth.uid())
        )
        or exists (
          select 1
          from public.access_grants grant_row
          join public.persons grantee
            on grantee.id = grant_row.grantee_person_id
           and grantee.organization_id = grant_row.organization_id
          where grant_row.organization_id = response.organization_id
            and grant_row.subject_person_id = subject.id
            and grant_row.kind = 'guardian'
            and grant_row.revoked_at is null
            and (grant_row.expires_at is null or grant_row.expires_at > statement_timestamp())
            and (grant_row.matter_id is null or grant_row.matter_id = response.matter_id)
            and grantee.user_id = (select auth.uid())
            and app.person_is_minor(subject.id)
        )
      )
  );
$$;
revoke all on function app.can_read_intake_answer(uuid) from public;
grant execute on function app.can_read_intake_answer(uuid) to authenticated, service_role;

create function app.save_intake_template(
  p_stable_key text,
  p_title text,
  p_locale text,
  p_workflow_category public.intake_workflow_category,
  p_schema jsonb,
  p_publish boolean,
  p_effective_on date,
  p_rule_pack_version_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid := app.current_organization_id();
  reviewer uuid;
  next_number integer;
  new_id uuid;
begin
  if org is null then
    raise exception 'intake template denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    org,
    array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[],
    coalesce(p_publish, false)
  );
  if p_stable_key is null or p_stable_key !~ '^[a-z][a-z0-9_]{1,80}$' then
    raise exception 'intake template key is not usable' using errcode = '22023';
  end if;
  if p_title is null or length(btrim(p_title)) not between 1 and 200 then
    raise exception 'intake template title is required' using errcode = '22023';
  end if;
  if p_locale not in ('en-CA', 'fr-CA') then
    raise exception 'locale must be en-CA or fr-CA' using errcode = '22023';
  end if;
  if app.intake_schema_ok(p_schema) is distinct from true then
    raise exception 'intake schema is not usable' using errcode = '22023';
  end if;
  if p_rule_pack_version_id is not null
     and app.pack_is_selectable(p_rule_pack_version_id, org) is distinct from true then
    raise exception 'program selection must be a published pack for a jurisdiction this firm practises'
      using errcode = '42501';
  end if;

  if coalesce(p_publish, false) then
    perform app.require_active_staff(org, array['licensed_consultant']::public.org_role[], true);
    if p_effective_on is null then
      raise exception 'a published intake template needs an effective date' using errcode = '22023';
    end if;
    select mem.id into reviewer
    from public.memberships mem
    where mem.organization_id = org
      and mem.user_id = (select auth.uid())
      and mem.role = 'licensed_consultant'
      and mem.status = 'active'
    limit 1;
    if reviewer is null then
      raise exception 'publishing an intake template requires a licensed consultant' using errcode = '42501';
    end if;
    update public.intake_templates
    set status = 'superseded'
    where organization_id = org
      and stable_key = p_stable_key
      and status = 'published';
  end if;

  select coalesce(max(version_number), 0) + 1 into next_number
  from public.intake_templates
  where organization_id = org
    and stable_key = p_stable_key;

  insert into public.intake_templates (
    organization_id, stable_key, version_number, status, locale, title, workflow_category,
    schema, effective_on, rule_pack_version_id, reviewer_membership_id, published_at
  ) values (
    org,
    p_stable_key,
    next_number,
    case when coalesce(p_publish, false) then 'published' else 'draft' end::public.intake_template_status,
    p_locale,
    btrim(p_title),
    coalesce(p_workflow_category, 'unspecified'),
    p_schema,
    p_effective_on,
    p_rule_pack_version_id,
    case when coalesce(p_publish, false) then reviewer else null end,
    case when coalesce(p_publish, false) then statement_timestamp() else null end
  )
  returning id into new_id;
  return new_id;
end;
$$;
revoke all on function app.save_intake_template(text, text, text, public.intake_workflow_category, jsonb, boolean, date, uuid) from public;

create function public.save_intake_template(
  p_stable_key text,
  p_title text,
  p_locale text,
  p_workflow_category public.intake_workflow_category,
  p_schema jsonb,
  p_publish boolean,
  p_effective_on date,
  p_rule_pack_version_id uuid
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select app.save_intake_template(
    p_stable_key, p_title, p_locale, p_workflow_category, p_schema, p_publish, p_effective_on, p_rule_pack_version_id
  );
$$;
revoke all on function public.save_intake_template(text, text, text, public.intake_workflow_category, jsonb, boolean, date, uuid) from public, anon;
grant execute on function public.save_intake_template(text, text, text, public.intake_workflow_category, jsonb, boolean, date, uuid)
  to authenticated, service_role;

create function app.open_intake_response(
  p_template_id uuid,
  p_matter_id uuid,
  p_person_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  template public.intake_templates%rowtype;
  matter public.matters%rowtype;
  person public.persons%rowtype;
  new_id uuid;
begin
  select * into template from public.intake_templates where id = p_template_id;
  select * into matter from public.matters where id = p_matter_id;
  select * into person from public.persons where id = p_person_id;
  if template.id is null or matter.id is null or person.id is null
     or template.organization_id is distinct from matter.organization_id
     or person.organization_id is distinct from matter.organization_id then
    raise exception 'intake assignment denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    matter.organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[],
    false
  );
  if app.can_read_matter(matter.id) is distinct from true or app.can_read_person(person.id) is distinct from true then
    raise exception 'intake assignment denied' using errcode = '42501';
  end if;
  if template.status is distinct from 'published' or template.effective_on > current_date then
    raise exception 'that intake template is not in effect' using errcode = '42501';
  end if;
  if matter.is_sample is distinct from person.is_sample then
    raise exception 'sample and real records cannot be linked' using errcode = '42501';
  end if;
  if app.sample_mode_blocks_real(matter.organization_id, matter.is_sample) then
    raise exception 'this firm is in sample mode; only sample matters accept new work' using errcode = '42501';
  end if;

  insert into public.intake_responses (organization_id, template_id, matter_id, person_id)
  values (matter.organization_id, template.id, matter.id, person.id)
  returning id into new_id;

  if not exists (
    select 1
    from public.matter_stage_evidence evidence
    where evidence.matter_id = matter.id
      and evidence.kind = 'questionnaire_assigned'
  ) then
    insert into public.matter_stage_evidence (organization_id, matter_id, kind, summary)
    values (matter.organization_id, matter.id, 'questionnaire_assigned', 'Intake response assigned');
  end if;
  return new_id;
end;
$$;
revoke all on function app.open_intake_response(uuid, uuid, uuid) from public;

create function public.open_intake_response(p_template_id uuid, p_matter_id uuid, p_person_id uuid)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select app.open_intake_response(p_template_id, p_matter_id, p_person_id);
$$;
revoke all on function public.open_intake_response(uuid, uuid, uuid) from public, anon;
grant execute on function public.open_intake_response(uuid, uuid, uuid) to authenticated, service_role;

create function app.intake_caller_can_write(p_response public.intake_responses)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.persons subject
    where subject.id = p_response.person_id
      and subject.organization_id = p_response.organization_id
      and subject.user_id = (select auth.uid())
  )
  or (
    app.staff_mfa_satisfied()
    and app.can_read_matter(p_response.matter_id)
    and app.has_org_role(
      p_response.organization_id,
      array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[]
    )
  );
$$;
revoke all on function app.intake_caller_can_write(public.intake_responses) from public;

create function app.save_intake_answer(
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
  if response.frozen_at is not null then
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
revoke all on function app.save_intake_answer(uuid, integer, text, public.answer_presence, jsonb) from public;

create function public.save_intake_answer(
  p_response_id uuid,
  p_expected_version integer,
  p_field_key text,
  p_presence public.answer_presence,
  p_value jsonb
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select app.save_intake_answer(p_response_id, p_expected_version, p_field_key, p_presence, p_value);
$$;
revoke all on function public.save_intake_answer(uuid, integer, text, public.answer_presence, jsonb) from public, anon;
grant execute on function public.save_intake_answer(uuid, integer, text, public.answer_presence, jsonb)
  to authenticated, service_role;

create function app.intake_field_visible(p_field jsonb, p_response_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  depends text;
  expected jsonb;
  current jsonb;
begin
  if not (p_field ? 'show_when') then
    return true;
  end if;
  depends := p_field -> 'show_when' ->> 'field';
  expected := p_field -> 'show_when' -> 'equals';
  select answer.normalized_value into current
  from public.intake_answer_versions answer
  where answer.response_id = p_response_id
    and answer.field_key = depends
    and answer.presence = 'provided'
  order by answer.created_at desc
  limit 1;
  if current is null then
    return false;
  end if;
  return current -> 'declaration' = expected
      or to_jsonb(current ->> 'text') = expected
      or current = expected;
end;
$$;
revoke all on function app.intake_field_visible(jsonb, uuid) from public;

create function app.submit_intake_response(p_response_id uuid, p_expected_version integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  response public.intake_responses%rowtype;
  template public.intake_templates%rowtype;
  field jsonb;
  latest public.intake_answer_versions%rowtype;
  snap uuid;
  snap_number integer;
  new_version integer;
  matter_sample boolean;
begin
  select * into response from public.intake_responses where id = p_response_id for update;
  if response.id is null or app.intake_caller_can_write(response) is distinct from true then
    raise exception 'intake submit denied' using errcode = '42501';
  end if;
  if response.status is distinct from 'draft' or response.frozen_at is not null then
    raise exception 'that intake response is already submitted' using errcode = '42501';
  end if;
  if response.version is distinct from p_expected_version then
    raise exception 'intake version conflict' using errcode = '40001';
  end if;
  select matter.is_sample into matter_sample from public.matters matter where matter.id = response.matter_id;
  if app.sample_mode_blocks_real(response.organization_id, matter_sample) then
    raise exception 'this firm is in sample mode; only sample matters accept new work' using errcode = '42501';
  end if;
  select * into template from public.intake_templates where id = response.template_id;

  for field in select value from jsonb_array_elements(template.schema -> 'fields')
  loop
    if coalesce(field ->> 'required', 'false') = 'true'
       and app.intake_field_visible(field, response.id) then
      select * into latest
      from public.intake_answer_versions answer
      where answer.response_id = response.id
        and answer.field_key = field ->> 'key'
      order by answer.created_at desc
      limit 1;
      if latest.id is null then
        raise exception 'a required intake answer is missing' using errcode = '22023';
      end if;
    end if;
  end loop;

  select coalesce(max(snapshot_number), 0) + 1 into snap_number
  from public.intake_snapshots
  where response_id = response.id;
  insert into public.intake_snapshots (organization_id, response_id, snapshot_number)
  values (response.organization_id, response.id, snap_number)
  returning id into snap;

  insert into public.intake_snapshot_answers (
    organization_id, snapshot_id, field_key, section_key, presence, normalized_value,
    date_kind, calendar_date, year_value, month_value, source_answer_id
  )
  select distinct on (answer.field_key)
    response.organization_id,
    snap,
    answer.field_key,
    answer.section_key,
    answer.presence,
    answer.normalized_value,
    answer.date_kind,
    answer.calendar_date,
    answer.year_value,
    answer.month_value,
    answer.id
  from public.intake_answer_versions answer
  where answer.response_id = response.id
  order by answer.field_key, answer.created_at desc;

  update public.intake_responses
  set status = 'submitted',
      submitted_at = statement_timestamp()
  where id = response.id
  returning version into new_version;

  perform app.enqueue_event(
    response.organization_id,
    'intake_response',
    response.id,
    'intake.submitted',
    jsonb_build_object(
      'response_id', response.id,
      'matter_id', response.matter_id,
      'template_id', response.template_id,
      'snapshot_id', snap
    ),
    new_version,
    'intake.submitted:' || response.id::text || ':' || snap_number::text
  );
  return new_version;
end;
$$;
revoke all on function app.submit_intake_response(uuid, integer) from public;

create function public.submit_intake_response(p_response_id uuid, p_expected_version integer)
returns integer
language sql
security invoker
set search_path = ''
as $$
  select app.submit_intake_response(p_response_id, p_expected_version);
$$;
revoke all on function public.submit_intake_response(uuid, integer) from public, anon;
grant execute on function public.submit_intake_response(uuid, integer) to authenticated, service_role;

create function app.freeze_intake_response(p_response_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  response public.intake_responses%rowtype;
begin
  select * into response from public.intake_responses where id = p_response_id for update;
  if response.id is null or app.can_read_matter(response.matter_id) is distinct from true then
    raise exception 'intake freeze denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    response.organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[],
    true
  );
  if response.status is distinct from 'submitted' then
    raise exception 'freeze a submitted intake snapshot' using errcode = '42501';
  end if;
  update public.intake_responses set frozen_at = statement_timestamp() where id = response.id;
  perform app.record_audit_event(
    response.organization_id,
    'intake.frozen',
    'public.intake_responses',
    response.id,
    'success',
    jsonb_build_object('matter_id', response.matter_id)
  );
end;
$$;
revoke all on function app.freeze_intake_response(uuid) from public;

create function public.freeze_intake_response(p_response_id uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
  select app.freeze_intake_response(p_response_id);
$$;
revoke all on function public.freeze_intake_response(uuid) from public, anon;
grant execute on function public.freeze_intake_response(uuid) to authenticated, service_role;

revoke all on table public.intake_templates from anon, authenticated;
revoke all on table public.intake_responses from anon, authenticated;
revoke all on table public.intake_answer_versions from anon, authenticated;
revoke all on table public.intake_snapshots from anon, authenticated;
revoke all on table public.intake_snapshot_answers from anon, authenticated;
grant select on table public.intake_templates to authenticated;
grant select on table public.intake_responses to authenticated;
grant select on table public.intake_answer_versions to authenticated;
grant select on table public.intake_snapshots to authenticated;
grant select on table public.intake_snapshot_answers to authenticated;

alter table public.intake_templates enable row level security;
alter table public.intake_templates force row level security;
alter table public.intake_responses enable row level security;
alter table public.intake_responses force row level security;
alter table public.intake_answer_versions enable row level security;
alter table public.intake_answer_versions force row level security;
alter table public.intake_snapshots enable row level security;
alter table public.intake_snapshots force row level security;
alter table public.intake_snapshot_answers enable row level security;
alter table public.intake_snapshot_answers force row level security;

create policy intake_templates_select on public.intake_templates
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (
      status = 'published'
      or (
        (select app.staff_mfa_satisfied())
        and (select app.is_org_staff(organization_id))
      )
    )
  );
create policy intake_responses_select on public.intake_responses
  for select to authenticated
  using ((select app.can_read_intake_response(id)));
create policy intake_answer_versions_select on public.intake_answer_versions
  for select to authenticated
  using ((select app.can_read_intake_answer(id)));
create policy intake_snapshots_select on public.intake_snapshots
  for select to authenticated
  using ((select app.can_read_intake_response(response_id)));
create policy intake_snapshot_answers_select on public.intake_snapshot_answers
  for select to authenticated
  using (
    exists (
      select 1
      from public.intake_answer_versions source
      where source.id = source_answer_id
        and (select app.can_read_intake_answer(source.id))
    )
  );

grant execute on function app.save_intake_template(text, text, text, public.intake_workflow_category, jsonb, boolean, date, uuid) to authenticated, service_role;
grant execute on function app.open_intake_response(uuid, uuid, uuid) to authenticated, service_role;
grant execute on function app.save_intake_answer(uuid, integer, text, public.answer_presence, jsonb) to authenticated, service_role;
grant execute on function app.submit_intake_response(uuid, integer) to authenticated, service_role;
grant execute on function app.freeze_intake_response(uuid) to authenticated, service_role;
