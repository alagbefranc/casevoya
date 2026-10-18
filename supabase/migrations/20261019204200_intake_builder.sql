-- Sheet: Intake form builder (branch sheet-firm-admin). PRD INT-01, INT-03.
--
-- A firm builds an intake form as a draft, edits it in place while it is a draft, and publishes
-- it as a new version. A published version is never changed: the next edit starts a new draft
-- version, and publishing supersedes the previous published version.
--
-- Redefined (each copied from its latest definition, 20261017170100_intake_responses.sql):
--   * app.guard_intake_template: a draft row may now change its schema, title, locale, workflow
--     category and program pin while it stays a draft, and may become published (with an
--     effective date). Published rows are unchanged except published -> superseded, as before.
--     Stable key and version number never change.
--   * app.save_intake_answer: when a field's schema says "allow_unknown": false or
--     "allow_not_applicable": false, an answer of that presence is refused. Fields without those
--     keys behave exactly as before (backward compatible).
-- New:
--   * public.save_intake_draft: create the next draft version of a form (copying the latest
--     version's locale, category and program), or update an existing draft with its expected
--     row version (stale saves conflict, 40001). Firm owner, licensed consultant or case manager
--     at aal2. Audited intake_template.draft_saved.
--   * public.publish_intake_draft: a licensed consultant or licensed owner with a recent step-up
--     publishes a draft, effective today in the firm's timezone; the previous published version of
--     that form is superseded in the same transaction. Audited intake_template.published.
--   * public.intake_template_usage: how many matters each form (stable key) is used by. Staff at
--     aal2. Read only.
-- No table, policy or RLS setting changes.

create or replace function app.guard_intake_template()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.stable_key is distinct from old.stable_key
       or new.version_number is distinct from old.version_number then
      raise exception 'a published intake schema is versioned by inserting a new row' using errcode = '42501';
    end if;
    if old.status = 'draft' and new.status = 'draft' then
      -- A draft is edited in place until it is published.
      null;
    elsif old.status = 'draft' and new.status = 'published' then
      if new.schema is distinct from old.schema
         or new.locale is distinct from old.locale
         or new.workflow_category is distinct from old.workflow_category
         or new.rule_pack_version_id is distinct from old.rule_pack_version_id then
        raise exception 'a draft is published as saved' using errcode = '42501';
      end if;
    elsif old.status = 'published' and new.status = 'superseded' then
      if new.schema is distinct from old.schema
         or new.locale is distinct from old.locale
         or new.workflow_category is distinct from old.workflow_category
         or new.rule_pack_version_id is distinct from old.rule_pack_version_id
         or new.effective_on is distinct from old.effective_on then
        raise exception 'a published intake schema is versioned by inserting a new row' using errcode = '42501';
      end if;
    else
      raise exception 'intake template status changes only when a newer version is published' using errcode = '42501';
    end if;
  end if;
  if app.intake_schema_ok(new.schema) is distinct from true then
    raise exception 'intake schema is not usable' using errcode = '22023';
  end if;
  return new;
end;
$$;

create function app.save_intake_draft(
  p_stable_key text,
  p_title text,
  p_schema jsonb,
  p_template_id uuid,
  p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid := app.current_organization_id();
  draft public.intake_templates%rowtype;
  latest public.intake_templates%rowtype;
  next_number integer;
  new_id uuid;
  new_version integer;
begin
  if org is null then
    raise exception 'intake template denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    org,
    array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[],
    false
  );
  if p_stable_key is null or p_stable_key !~ '^[a-z][a-z0-9_]{1,80}$' then
    raise exception 'intake template key is not usable' using errcode = '22023';
  end if;
  if p_title is null or length(btrim(p_title)) not between 1 and 200 then
    raise exception 'intake template title is required' using errcode = '22023';
  end if;
  if app.intake_schema_ok(p_schema) is distinct from true then
    raise exception 'intake schema is not usable' using errcode = '22023';
  end if;

  if p_template_id is not null then
    select * into draft
    from public.intake_templates t
    where t.id = p_template_id and t.organization_id = org
    for update;
    if draft.id is null or draft.stable_key is distinct from p_stable_key then
      raise exception 'intake template denied' using errcode = '42501';
    end if;
    if draft.status is distinct from 'draft' then
      raise exception 'a published intake form is never changed; edit it as a new draft' using errcode = '42501';
    end if;
    if draft.version is distinct from p_expected_version then
      raise exception 'intake version conflict' using errcode = '40001';
    end if;
    update public.intake_templates
       set schema = p_schema, title = btrim(p_title)
     where id = draft.id
    returning id, version into new_id, new_version;
  else
    if exists (
      select 1 from public.intake_templates t
      where t.organization_id = org and t.stable_key = p_stable_key and t.status = 'draft'
    ) then
      raise exception 'intake version conflict' using errcode = '40001';
    end if;
    select * into latest
    from public.intake_templates t
    where t.organization_id = org and t.stable_key = p_stable_key
    order by t.version_number desc
    limit 1;
    select coalesce(max(t.version_number), 0) + 1 into next_number
    from public.intake_templates t
    where t.organization_id = org and t.stable_key = p_stable_key;
    insert into public.intake_templates (
      organization_id, stable_key, version_number, status, locale, title, workflow_category,
      schema, rule_pack_version_id
    ) values (
      org,
      p_stable_key,
      next_number,
      'draft',
      coalesce(latest.locale, 'en-CA'),
      btrim(p_title),
      coalesce(latest.workflow_category, 'unspecified'),
      p_schema,
      latest.rule_pack_version_id
    )
    returning id, version into new_id, new_version;
  end if;

  perform app.record_audit_event(
    org,
    'intake_template.draft_saved',
    'public.intake_templates',
    new_id,
    'success',
    jsonb_build_object('stable_key', p_stable_key, 'fields', jsonb_array_length(p_schema -> 'fields'))
  );
  return jsonb_build_object('id', new_id, 'version', new_version);
end;
$$;
revoke all on function app.save_intake_draft(text, text, jsonb, uuid, integer) from public;

create function public.save_intake_draft(
  p_stable_key text,
  p_title text,
  p_schema jsonb,
  p_template_id uuid,
  p_expected_version integer
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app.save_intake_draft(p_stable_key, p_title, p_schema, p_template_id, p_expected_version);
$$;
revoke all on function public.save_intake_draft(text, text, jsonb, uuid, integer) from public, anon;
grant execute on function app.save_intake_draft(text, text, jsonb, uuid, integer) to authenticated, service_role;
grant execute on function public.save_intake_draft(text, text, jsonb, uuid, integer) to authenticated, service_role;

create function app.publish_intake_draft(p_template_id uuid, p_expected_version integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid := app.current_organization_id();
  draft public.intake_templates%rowtype;
  reviewer uuid;
  zone text;
begin
  if org is null then
    raise exception 'intake template denied' using errcode = '42501';
  end if;
  perform app.require_licensed_staff(org, true);
  select * into draft
  from public.intake_templates t
  where t.id = p_template_id and t.organization_id = org
  for update;
  if draft.id is null then
    raise exception 'intake template denied' using errcode = '42501';
  end if;
  if draft.status is distinct from 'draft' then
    raise exception 'only a draft can be published' using errcode = '22023';
  end if;
  if draft.version is distinct from p_expected_version then
    raise exception 'intake version conflict' using errcode = '40001';
  end if;
  select mem.id into reviewer
  from public.memberships mem
  where mem.organization_id = org
    and mem.user_id = (select auth.uid())
    and mem.status = 'active'
    and app.membership_is_licensed(mem.id)
  limit 1;
  if reviewer is null then
    raise exception 'publishing an intake template requires a licensed consultant' using errcode = '42501';
  end if;
  select coalesce(o.timezone, 'America/Toronto') into zone from public.organizations o where o.id = org;

  update public.intake_templates
     set status = 'superseded'
   where organization_id = org
     and stable_key = draft.stable_key
     and status = 'published';

  update public.intake_templates
     set status = 'published',
         effective_on = (statement_timestamp() at time zone zone)::date,
         reviewer_membership_id = reviewer,
         published_at = statement_timestamp()
   where id = draft.id;

  perform app.record_audit_event(
    org,
    'intake_template.published',
    'public.intake_templates',
    draft.id,
    'success',
    jsonb_build_object('stable_key', draft.stable_key, 'version_number', draft.version_number)
  );
  return draft.id;
end;
$$;
revoke all on function app.publish_intake_draft(uuid, integer) from public;

create function public.publish_intake_draft(p_template_id uuid, p_expected_version integer)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select app.publish_intake_draft(p_template_id, p_expected_version);
$$;
revoke all on function public.publish_intake_draft(uuid, integer) from public, anon;
grant execute on function app.publish_intake_draft(uuid, integer) to authenticated, service_role;
grant execute on function public.publish_intake_draft(uuid, integer) to authenticated, service_role;

create function public.intake_template_usage(p_organization_id uuid)
returns table (stable_key text, matters integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.require_active_staff(p_organization_id, app.staff_roles(), false);
  return query
    select t.stable_key, count(distinct r.matter_id)::integer
    from public.intake_templates t
    join public.intake_responses r on r.template_id = t.id and r.organization_id = t.organization_id
    where t.organization_id = p_organization_id
    group by t.stable_key;
end;
$$;
comment on function public.intake_template_usage(uuid) is
  'How many matters use each intake form (any version). Staff at aal2. Counts only.';
revoke all on function public.intake_template_usage(uuid) from public, anon;
grant execute on function public.intake_template_usage(uuid) to authenticated;

-- From 20261017170100_intake_responses.sql. Only change: the presence check against the field's
-- allow_unknown / allow_not_applicable flags, when the schema sets them.
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
