-- PREP-01, PREP-03, PREP-04 functions. Tables are in 20261029120000.
-- Redefines app.gov_pin_manifest, app.submission_gates_for, app.sign_off_submission_handoff
-- and app.record_submission from 20261025170000_gov_submission_checklist.sql.

-- ---------------------------------------------------------------------------
-- Propose, review, pin
-- ---------------------------------------------------------------------------
create function app.propose_form_template(
  p_org uuid,
  p_jurisdiction text,
  p_program_key text,
  p_official_form_id text,
  p_official_url text,
  p_source_section text,
  p_form_version text,
  p_mapping_version integer,
  p_effective_on date,
  p_output_format text,
  p_fields jsonb,
  p_checked_on date,
  p_snapshot jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  url text := btrim(coalesce(p_official_url, ''));
  canonical text;
  v_host text;
  publisher_name text;
  today date;
  form_id text := btrim(coalesce(p_official_form_id, ''));
  v_form_version text := btrim(coalesce(p_form_version, ''));
  v_jurisdiction text := upper(btrim(coalesce(p_jurisdiction, '')));
  src uuid;
  snap uuid;
  snap_hash text;
  snap_url text;
  snap_at timestamptz;
  new_id uuid;
  next_mapping integer;
  field jsonb;
  pos integer := 0;
  seen text[] := '{}';
  fact_key text;
begin
  if p_org is distinct from app.current_organization_id() then
    raise exception 'form template denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(p_org, array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[], false);
  today := app.firm_today(p_org);
  if v_jurisdiction !~ '^[A-Z]{2}$' then
    raise exception 'enter the jurisdiction as two letters, as the official page states it' using errcode = '22023';
  end if;
  if p_program_key is not null and p_program_key !~ '^[a-z0-9_]{1,80}$' then
    raise exception 'unknown program' using errcode = '22023';
  end if;
  if form_id !~ '^[A-Za-z0-9][A-Za-z0-9 .()/-]{1,39}$' then
    raise exception 'enter the form identifier as the official page prints it' using errcode = '22023';
  end if;
  if v_form_version is null or length(v_form_version) not between 1 and 80 or v_form_version ~ '[\n\r]' then
    raise exception 'enter the form version as the official page prints it' using errcode = '22023';
  end if;
  if p_output_format is null or p_output_format not in ('field_review', 'manual_completion') then
    raise exception 'choose field review or manual completion' using errcode = '22023';
  end if;
  v_host := app.federal_official_url(url);
  if v_host is null then
    raise exception 'the source must be an official Government of Canada page (canada.ca or gc.ca)' using errcode = '22023';
  end if;
  if position('#' in url) = 0 and nullif(btrim(coalesce(p_source_section, '')), '') is null then
    raise exception 'name the section of the page, or give its link with the section anchor' using errcode = '22023';
  end if;
  if p_checked_on is null or p_checked_on > today or p_checked_on < today - 366 then
    raise exception 'the date checked is required, within the last year and not in the future' using errcode = '22023';
  end if;
  if p_effective_on is not null and (p_effective_on > today + 366 or p_effective_on < date '1990-01-01') then
    raise exception 'an effective date must be the date the official page states' using errcode = '22023';
  end if;
  if p_fields is null or jsonb_typeof(p_fields) <> 'array' then
    raise exception 'list the fields transcribed from the form' using errcode = '22023';
  end if;
  if p_output_format = 'field_review' and jsonb_array_length(p_fields) < 1 then
    raise exception 'a field review needs at least one field transcribed from the form' using errcode = '22023';
  end if;
  if p_output_format = 'manual_completion' and jsonb_array_length(p_fields) > 0 then
    raise exception 'manual completion has no mapped fields; leave the field list empty' using errcode = '22023';
  end if;
  if jsonb_array_length(p_fields) > 200 then
    raise exception 'a form template holds at most 200 fields' using errcode = '22023';
  end if;
  if p_snapshot is not null then
    snap_hash := lower(btrim(coalesce(p_snapshot ->> 'sha256', '')));
    snap_url := btrim(coalesce(p_snapshot ->> 'final_url', url));
    snap_at := (p_snapshot ->> 'retrieved_at')::timestamptz;
    if snap_hash !~ '^[0-9a-f]{64}$' then
      raise exception 'the page hash is invalid' using errcode = '22023';
    end if;
    if snap_at is null or snap_at > statement_timestamp() + interval '5 minutes' or snap_at < statement_timestamp() - interval '1 day' then
      raise exception 'the retrieval time must be now' using errcode = '22023';
    end if;
    if app.federal_official_url(snap_url) is null then
      raise exception 'the source must be an official Government of Canada page (canada.ca or gc.ca)' using errcode = '22023';
    end if;
  end if;

  select coalesce(max(existing.mapping_version), 0) + 1 into next_mapping
  from public.form_templates existing
  where existing.organization_id = p_org
    and existing.jurisdiction = v_jurisdiction
    and lower(existing.official_form_id) = lower(form_id)
    and existing.form_version = v_form_version
    and existing.status <> 'rejected';
  if p_mapping_version is null then
    p_mapping_version := next_mapping;
  elsif p_mapping_version < 1 or p_mapping_version > next_mapping then
    raise exception 'the mapping version must follow the last one for this form version' using errcode = '22023';
  elsif exists (
    select 1 from public.form_templates existing
    where existing.organization_id = p_org
      and existing.jurisdiction = v_jurisdiction
      and lower(existing.official_form_id) = lower(form_id)
      and existing.form_version = v_form_version
      and existing.mapping_version = p_mapping_version
      and existing.status <> 'rejected'
  ) then
    raise exception 'that mapping version already exists for this form version' using errcode = '22023';
  end if;

  canonical := split_part(url, '#', 1);
  select domain.authority into publisher_name
  from public.official_source_domains domain
  where domain.active and (v_host = domain.host or right(v_host, length(domain.host) + 1) = '.' || domain.host)
  order by length(domain.host) desc
  limit 1;
  select source.id into src
  from public.official_sources source
  where source.organization_id = p_org and source.canonical_url = canonical;
  if src is null then
    insert into public.official_sources (organization_id, publisher, canonical_url, allowed_host, jurisdiction, content_kind, title, source_language)
    values (p_org, coalesce(publisher_name, 'Government of Canada'), canonical, v_host, v_jurisdiction, 'form_instruction',
            left(form_id || ' ' || v_form_version, 300), 'en')
    returning id into src;
  end if;
  if snap_hash is not null then
    insert into public.source_snapshots (
      organization_id, source_id, snapshot_number, final_url, publisher, retrieved_at, content_hash,
      retrieval_result, http_status, review_status
    ) values (
      p_org, src, 1, snap_url, coalesce(publisher_name, 'Government of Canada'), snap_at, snap_hash,
      'success', nullif(p_snapshot ->> 'http_status', '')::integer, 'evidence_captured'
    )
    returning id into snap;
  end if;

  insert into public.form_templates (
    organization_id, jurisdiction, program_key, official_form_id, official_url, source_section, form_version,
    mapping_version, effective_on, checked_on, retrieved_at, output_format, source_id, snapshot_id, snapshot_sha256
  ) values (
    p_org, v_jurisdiction, p_program_key, form_id, url, nullif(btrim(coalesce(p_source_section, '')), ''), v_form_version,
    p_mapping_version, p_effective_on, p_checked_on, coalesce(snap_at, statement_timestamp()), p_output_format, src, snap, snap_hash
  )
  returning id into new_id;

  for field in select value from jsonb_array_elements(p_fields) loop
    pos := pos + 1;
    if jsonb_typeof(field) <> 'object' then
      raise exception 'each field needs a key and the label printed on the form' using errcode = '22023';
    end if;
    if coalesce(field ->> 'field_key', '') !~ '^[a-z][a-z0-9_]{0,79}$' then
      raise exception 'a field key uses lowercase letters, digits and underscores' using errcode = '22023';
    end if;
    if field ->> 'field_key' = any (seen) then
      raise exception 'each field key is used once' using errcode = '22023';
    end if;
    seen := seen || (field ->> 'field_key');
    if length(btrim(coalesce(field ->> 'label', ''))) not between 1 and 200 then
      raise exception 'enter each field label as the form prints it' using errcode = '22023';
    end if;
    if jsonb_typeof(field -> 'required') <> 'boolean' then
      raise exception 'say whether each field is required on the form' using errcode = '22023';
    end if;
    fact_key := nullif(btrim(coalesce(field ->> 'fact_field_key', '')), '');
    if fact_key is not null and fact_key !~ '^[a-z][a-z0-9_]{0,79}$' then
      raise exception 'a fact key uses lowercase letters, digits and underscores' using errcode = '22023';
    end if;
    insert into public.form_template_fields (organization_id, template_id, position, field_key, label, required, fact_field_key)
    values (p_org, new_id, pos, field ->> 'field_key', btrim(field ->> 'label'), (field ->> 'required')::boolean, fact_key);
  end loop;

  perform app.record_audit_event(
    p_org, 'prep.form_template_entered', 'public.form_templates', new_id, 'success',
    jsonb_build_object(
      'official_form_id', form_id, 'form_version', v_form_version, 'mapping_version', p_mapping_version,
      'output_format', p_output_format, 'source_url', url, 'snapshot_sha256', snap_hash, 'fields', pos
    )
  );
  return new_id;
end;
$$;
revoke all on function app.propose_form_template(uuid, text, text, text, text, text, text, integer, date, text, jsonb, date, jsonb) from public, anon;

create function app.review_form_template(
  p_template_id uuid, p_expected_version integer, p_decision text, p_note text, p_page_opened_on date
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  template public.form_templates%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  reviewer uuid;
  earlier record;
  new_version integer;
  opened date;
  self_approval boolean := false;
begin
  select * into template from public.form_templates where id = p_template_id for update;
  if template.id is null or template.organization_id is distinct from app.current_organization_id() then
    raise exception 'form template review denied' using errcode = '42501';
  end if;
  perform app.require_licensed_staff(template.organization_id, true);
  if template.version is distinct from p_expected_version then
    raise exception 'form template version conflict' using errcode = 'PT409';
  end if;
  if template.status <> 'pending_review' then
    raise exception 'nothing is waiting for review' using errcode = '22023';
  end if;
  if p_decision is null or p_decision not in ('approved', 'rejected') then
    raise exception 'unknown decision' using errcode = '22023';
  end if;
  if p_decision = 'rejected' and (v_note is null or length(v_note) < 3) then
    raise exception 'say why it''s rejected' using errcode = '22023';
  end if;
  if p_decision = 'approved' then
    opened := app.gov_check_page_attestation(template.organization_id, template.snapshot_sha256 is not null, p_page_opened_on, template.created_at);
    self_approval := app.gov_check_self_approval(template.organization_id, template.created_by, template.created_at);
    for earlier in
      select other.id from public.form_templates other
      where other.organization_id = template.organization_id
        and other.status = 'approved'
        and other.jurisdiction = template.jurisdiction
        and lower(other.official_form_id) = lower(template.official_form_id)
    loop
      perform app.gov_open_write(earlier.id);
      update public.form_templates
      set status = 'superseded', review_note = coalesce(review_note, 'Replaced by a newer approved template')
      where id = earlier.id;
      perform app.gov_close_write(earlier.id);
    end loop;
  end if;
  reviewer := app.gov_actor_membership(template.organization_id);
  perform app.gov_open_write(template.id);
  update public.form_templates
  set status = p_decision,
      reviewed_by_membership_id = reviewer,
      reviewed_at = statement_timestamp(),
      review_note = left(v_note, 500),
      page_attested_by_membership_id = case when opened is null then null else reviewer end,
      page_attested_on = opened,
      page_attested_at = case when opened is null then null else statement_timestamp() end
  where id = template.id
  returning version into new_version;
  perform app.gov_close_write(template.id);
  perform app.record_audit_event(
    template.organization_id,
    'prep.form_template_' || p_decision || case when self_approval then '_self' else '' end,
    'public.form_templates', template.id, 'success',
    jsonb_build_object(
      'official_form_id', template.official_form_id, 'form_version', template.form_version,
      'mapping_version', template.mapping_version, 'source_url', template.official_url,
      'snapshot_sha256', template.snapshot_sha256, 'page_attested_on', opened, 'self_approved', self_approval
    )
  );
  return new_version;
end;
$$;
revoke all on function app.review_form_template(uuid, integer, text, text, date) from public, anon;

create function app.retire_form_template(p_template_id uuid, p_expected_version integer, p_reason text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  template public.form_templates%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  new_version integer;
begin
  if v_reason is null or length(v_reason) not between 3 and 500 then
    raise exception 'say why it''s retired' using errcode = '22023';
  end if;
  select * into template from public.form_templates where id = p_template_id for update;
  if template.id is null or template.organization_id is distinct from app.current_organization_id() then
    raise exception 'form template review denied' using errcode = '42501';
  end if;
  perform app.require_licensed_staff(template.organization_id, true);
  if template.version is distinct from p_expected_version then
    raise exception 'form template version conflict' using errcode = 'PT409';
  end if;
  if template.status <> 'approved' then
    raise exception 'only an approved form template is retired' using errcode = '22023';
  end if;
  perform app.gov_open_write(template.id);
  update public.form_templates
  set status = 'retired', retired_at = statement_timestamp(), review_note = v_reason
  where id = template.id
  returning version into new_version;
  perform app.gov_close_write(template.id);
  perform app.record_audit_event(
    template.organization_id, 'prep.form_template_retired', 'public.form_templates', template.id, 'success',
    jsonb_build_object('reason', v_reason, 'official_form_id', template.official_form_id, 'form_version', template.form_version)
  );
  return new_version;
end;
$$;
revoke all on function app.retire_form_template(uuid, integer, text) from public, anon;

create function app.pin_form_template(p_matter_id uuid, p_template_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  matter public.matters%rowtype;
  template public.form_templates%rowtype;
  reason text;
  program text;
  old_pin record;
  new_id uuid;
begin
  select * into matter from public.matters where id = p_matter_id;
  if matter.id is null or app.can_read_matter(matter.id) is distinct from true then
    raise exception 'form pin denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(matter.organization_id, array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[], false);
  select * into template from public.form_templates where id = p_template_id;
  if template.id is null or template.organization_id is distinct from matter.organization_id then
    raise exception 'that form template is not in this firm' using errcode = '42501';
  end if;
  reason := app.form_template_stale_reason(template.id);
  if reason = 'not_current' then
    raise exception 'only the current approved form template can be pinned' using errcode = '42501';
  end if;
  if reason = 'not_yet_effective' then
    raise exception 'this form template is not yet effective' using errcode = '42501';
  end if;
  if reason = 'recheck_due' then
    raise exception 'this form version is stale; re-check the official page and approve a new template before pinning it' using errcode = '42501';
  end if;
  program := app.matter_program_key(matter.id);
  if template.program_key is not null and program is not null and template.program_key is distinct from program then
    raise exception 'this form template is for a different program' using errcode = '42501';
  end if;
  for old_pin in
    select pin.id
    from public.matter_form_pins pin
    join public.form_templates old_template on old_template.id = pin.template_id
    where pin.matter_id = matter.id
      and pin.superseded_at is null
      and old_template.jurisdiction = template.jurisdiction
      and lower(old_template.official_form_id) = lower(template.official_form_id)
  loop
    perform app.gov_open_write(old_pin.id);
    update public.matter_form_pins set superseded_at = statement_timestamp() where id = old_pin.id;
    perform app.gov_close_write(old_pin.id);
  end loop;
  insert into public.matter_form_pins (organization_id, matter_id, template_id, pinned_by_membership_id)
  values (matter.organization_id, matter.id, template.id, app.gov_actor_membership(matter.organization_id))
  returning id into new_id;
  perform app.record_audit_event(
    matter.organization_id, 'prep.form_pinned', 'public.matter_form_pins', new_id, 'success',
    jsonb_build_object(
      'matter_id', matter.id, 'template_id', template.id, 'official_form_id', template.official_form_id,
      'form_version', template.form_version, 'mapping_version', template.mapping_version
    )
  );
  return new_id;
end;
$$;
revoke all on function app.pin_form_template(uuid, uuid) from public, anon;

create function app.form_mapping_review(p_matter_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  matter public.matters%rowtype;
  program text;
begin
  select * into matter from public.matters where id = p_matter_id;
  if matter.id is null or app.gov_staff_can_read(matter.id, matter.organization_id) is distinct from true then
    raise exception 'form mapping denied' using errcode = '42501';
  end if;
  program := app.matter_program_key(matter.id);
  return jsonb_build_object(
    'program_key', program,
    'pins', coalesce((
      select jsonb_agg(jsonb_build_object(
        'pin_id', pin.id,
        'template_id', template.id,
        'official_form_id', template.official_form_id,
        'form_version', template.form_version,
        'mapping_version', template.mapping_version,
        'official_url', template.official_url,
        'source_section', template.source_section,
        'output_format', template.output_format,
        'effective_on', template.effective_on,
        'retrieved_at', template.retrieved_at,
        'checked_on', template.checked_on,
        'snapshot_sha256', template.snapshot_sha256,
        'page_attested_on', template.page_attested_on,
        'stale_reason', app.form_template_stale_reason(template.id),
        'fields', case
          when template.output_format = 'manual_completion' then '[]'::jsonb
          else app.form_field_fills(matter.id, template.id)
        end
      ) order by template.official_form_id, pin.pinned_at)
      from public.matter_form_pins pin
      join public.form_templates template on template.id = pin.template_id
      where pin.matter_id = matter.id and pin.superseded_at is null
    ), '[]'::jsonb),
    'approved', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', template.id,
        'official_form_id', template.official_form_id,
        'form_version', template.form_version,
        'mapping_version', template.mapping_version,
        'official_url', template.official_url,
        'program_key', template.program_key,
        'jurisdiction', template.jurisdiction,
        'output_format', template.output_format,
        'version', template.version,
        'stale_reason', app.form_template_stale_reason(template.id)
      ) order by template.official_form_id, template.mapping_version)
      from public.form_templates template
      where template.organization_id = matter.organization_id and template.status = 'approved'
    ), '[]'::jsonb),
    'pending', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', template.id,
        'official_form_id', template.official_form_id,
        'form_version', template.form_version,
        'mapping_version', template.mapping_version,
        'official_url', template.official_url,
        'output_format', template.output_format,
        'version', template.version,
        'snapshot', template.snapshot_sha256 is not null,
        'field_count', (select count(*) from public.form_template_fields field where field.template_id = template.id),
        'checked_on', template.checked_on
      ) order by template.created_at)
      from public.form_templates template
      where template.organization_id = matter.organization_id and template.status = 'pending_review'
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function app.form_mapping_review(uuid) from public, anon;

-- ---------------------------------------------------------------------------
-- Channel export rule and bundle selection
-- ---------------------------------------------------------------------------
create function app.channel_export_rule_for(p_org uuid, p_channel public.submission_channel)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select jsonb_build_object('name_pattern', rule.name_pattern, 'max_bytes', rule.max_bytes, 'source', 'firm')
      from public.submission_channel_templates rule
      where rule.organization_id = p_org and rule.channel = p_channel
    ),
    jsonb_build_object('name_pattern', '{reference}-evidence-bundle.pdf', 'max_bytes', 26214400, 'source', 'product_default')
  );
$$;
revoke all on function app.channel_export_rule_for(uuid, public.submission_channel) from public, anon;
comment on function app.channel_export_rule_for(uuid, public.submission_channel) is
  'PREP-03. Product default is {reference}-evidence-bundle.pdf and 25 MiB (26214400 bytes), the same cap as the default upload. Not an IRCC limit. A firm row may set 1 MiB to 100 MiB.';

create function app.channel_export_rule(p_org uuid, p_channel public.submission_channel)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_org is distinct from app.current_organization_id() or app.is_org_staff(p_org) is distinct from true or app.staff_mfa_satisfied() is distinct from true then
    raise exception 'channel export rule denied' using errcode = '42501';
  end if;
  return app.channel_export_rule_for(p_org, p_channel);
end;
$$;
revoke all on function app.channel_export_rule(uuid, public.submission_channel) from public, anon;

create function app.set_channel_export_rule(
  p_org uuid, p_channel public.submission_channel, p_name_pattern text, p_max_bytes bigint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  pattern text := btrim(coalesce(p_name_pattern, ''));
  existing public.submission_channel_templates%rowtype;
  new_id uuid;
begin
  if p_org is distinct from app.current_organization_id() then
    raise exception 'channel export rule denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(p_org, array['firm_owner']::public.org_role[], true);
  if app.channel_name_pattern_ok(pattern) is distinct from true then
    raise exception 'the file name may use {reference}, {channel} and {date}, and must end in .pdf' using errcode = '22023';
  end if;
  if p_max_bytes is null or p_max_bytes < 1048576 or p_max_bytes > 104857600 then
    raise exception 'the bundle size limit must be between 1 MiB and 100 MiB' using errcode = '22023';
  end if;
  select * into existing from public.submission_channel_templates rule where rule.organization_id = p_org and rule.channel = p_channel;
  if existing.id is null then
    insert into public.submission_channel_templates (organization_id, channel, name_pattern, max_bytes)
    values (p_org, p_channel, pattern, p_max_bytes)
    returning id into new_id;
  else
    perform app.gov_open_write(existing.id);
    update public.submission_channel_templates
    set name_pattern = pattern, max_bytes = p_max_bytes
    where id = existing.id
    returning id into new_id;
    perform app.gov_close_write(existing.id);
  end if;
  perform app.record_audit_event(
    p_org, 'prep.channel_export_rule_set', 'public.submission_channel_templates', new_id, 'success',
    jsonb_build_object('channel', p_channel, 'name_pattern', pattern, 'max_bytes', p_max_bytes)
  );
  return new_id;
end;
$$;
revoke all on function app.set_channel_export_rule(uuid, public.submission_channel, text, bigint) from public, anon;

create function app.save_bundle_selection(p_matter_id uuid, p_channel public.submission_channel, p_items jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  matter public.matters%rowtype;
  item jsonb;
  pos integer;
  seen int[] := '{}';
  version_id uuid;
  found record;
  selection_id uuid;
  number integer;
begin
  select * into matter from public.matters where id = p_matter_id;
  if matter.id is null or app.can_read_matter(matter.id) is distinct from true then
    raise exception 'bundle selection denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(matter.organization_id, array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[], false);
  if p_channel is null then
    raise exception 'choose the channel this bundle is for' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'choose the documents, in order' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 100 then
    raise exception 'a bundle holds at most 100 documents' using errcode = '22023';
  end if;
  select coalesce(max(saved.selection_number), 0) + 1 into number
  from public.matter_bundle_selections saved
  where saved.matter_id = matter.id;
  insert into public.matter_bundle_selections (organization_id, matter_id, channel, selection_number)
  values (matter.organization_id, matter.id, p_channel, number)
  returning id into selection_id;
  for item in select value from jsonb_array_elements(p_items) loop
    pos := nullif(item ->> 'position', '')::integer;
    version_id := nullif(item ->> 'document_version_id', '')::uuid;
    if pos is null or pos < 1 or pos > 100 or pos = any (seen) then
      raise exception 'each document needs its own place in the order' using errcode = '22023';
    end if;
    seen := seen || pos;
    select version.id as version_id, doc.id as document_id
    into found
    from public.document_versions version
    join public.documents doc on doc.id = version.document_id and doc.organization_id = version.organization_id
    join public.document_matter_refs ref on ref.document_id = doc.id and ref.organization_id = doc.organization_id
    where version.id = version_id
      and version.organization_id = matter.organization_id
      and ref.matter_id = matter.id
      and ref.removed_at is null
      and version.upload_state = 'clean'
      and version.superseded_at is null
      and version.review_state <> 'rejected';
    if found.version_id is null then
      raise exception 'that file is not a current document on this matter' using errcode = '42501';
    end if;
    insert into public.matter_bundle_items (organization_id, selection_id, position, document_id, document_version_id)
    values (matter.organization_id, selection_id, pos, found.document_id, found.version_id);
  end loop;
  perform app.record_audit_event(
    matter.organization_id, 'prep.bundle_selection_saved', 'public.matter_bundle_selections', selection_id, 'success',
    jsonb_build_object('matter_id', matter.id, 'channel', p_channel, 'documents', coalesce(array_length(seen, 1), 0))
  );
  return selection_id;
end;
$$;
revoke all on function app.save_bundle_selection(uuid, public.submission_channel, jsonb) from public, anon;

create function app.bundle_index(p_matter_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  matter public.matters%rowtype;
  selection public.matter_bundle_selections%rowtype;
begin
  select * into matter from public.matters where id = p_matter_id;
  if matter.id is null or app.gov_staff_can_read(matter.id, matter.organization_id) is distinct from true then
    raise exception 'bundle index denied' using errcode = '42501';
  end if;
  select * into selection
  from public.matter_bundle_selections saved
  where saved.matter_id = matter.id
  order by saved.selection_number desc
  limit 1;
  return jsonb_build_object(
    'reference', matter.reference,
    'channel', selection.channel,
    'rule', case
      when selection.id is null then null
      else app.channel_export_rule_for(matter.organization_id, selection.channel)
    end,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'position', item.position,
        'document_id', item.document_id,
        'document_version_id', item.document_version_id,
        'file_name', version.original_filename,
        'purpose', doc.purpose,
        'byte_size', coalesce(version.byte_size, version.declared_byte_size),
        'file_sha256', version.checksum_sha256,
        'media_type', coalesce(version.detected_media_type, version.declared_media_type)
      ) order by item.position)
      from public.matter_bundle_items item
      join public.document_versions version on version.id = item.document_version_id
      join public.documents doc on doc.id = item.document_id
      where item.selection_id = selection.id
    ), '[]'::jsonb),
    'candidates', coalesce((
      select jsonb_agg(jsonb_build_object(
        'document_id', candidate.document_id,
        'document_version_id', candidate.document_version_id,
        'file_name', candidate.file_name,
        'purpose', candidate.purpose,
        'byte_size', candidate.byte_size,
        'file_sha256', candidate.file_sha256,
        'media_type', candidate.media_type
      ) order by candidate.file_name, candidate.document_version_id)
      from (
        select distinct on (doc.id)
          doc.id as document_id,
          version.id as document_version_id,
          version.original_filename as file_name,
          doc.purpose,
          coalesce(version.byte_size, version.declared_byte_size) as byte_size,
          version.checksum_sha256 as file_sha256,
          coalesce(version.detected_media_type, version.declared_media_type) as media_type,
          doc.created_at
        from public.document_matter_refs ref
        join public.documents doc on doc.id = ref.document_id and doc.organization_id = ref.organization_id
        join public.document_versions version on version.document_id = doc.id and version.organization_id = doc.organization_id
        where ref.matter_id = matter.id
          and ref.organization_id = matter.organization_id
          and ref.removed_at is null
          and version.upload_state = 'clean'
          and version.superseded_at is null
          and version.review_state <> 'rejected'
        order by doc.id, version.version_number desc
      ) candidate
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function app.bundle_index(uuid) from public, anon;

create function app.record_bundle_export(p_matter_id uuid, p_file_name text, p_byte_size bigint, p_page_count integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  matter public.matters%rowtype;
begin
  select * into matter from public.matters where id = p_matter_id;
  if matter.id is null or app.gov_staff_can_read(matter.id, matter.organization_id) is distinct from true then
    raise exception 'bundle export denied' using errcode = '42501';
  end if;
  if p_file_name is null or length(btrim(p_file_name)) not between 5 and 180 or p_byte_size is null or p_byte_size < 1 or p_page_count is null or p_page_count < 1 then
    raise exception 'the bundle export needs a file name, a size and a page count' using errcode = '22023';
  end if;
  perform app.record_audit_event(
    matter.organization_id, 'prep.bundle_exported', 'public.matters', matter.id, 'success',
    jsonb_build_object('file_name', left(p_file_name, 180), 'byte_size', p_byte_size, 'page_count', p_page_count)
  );
  return matter.id;
end;
$$;
revoke all on function app.record_bundle_export(uuid, text, bigint, integer) from public, anon;

create function app.submission_manifest_snapshot(p_handoff_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  handoff public.submission_handoffs%rowtype;
begin
  select * into handoff from public.submission_handoffs where id = p_handoff_id;
  if handoff.id is null or app.gov_staff_can_read(handoff.matter_id, handoff.organization_id) is distinct from true then
    raise exception 'package manifest denied' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'forms', coalesce((
      select jsonb_agg(jsonb_build_object(
        'position', form.position,
        'official_form_id', form.official_form_id,
        'form_version', form.form_version,
        'mapping_version', form.mapping_version,
        'official_url', form.official_url,
        'output_format', form.output_format,
        'content_sha256', form.content_sha256
      ) order by form.position)
      from public.submission_manifest_forms form
      where form.handoff_id = handoff.id
    ), '[]'::jsonb),
    'facts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'position', fact.position,
        'field_key', fact.field_key,
        'label', fact.label,
        'value_sha256', fact.value_sha256,
        'reviewed_at', fact.reviewed_at
      ) order by fact.position)
      from public.submission_manifest_facts fact
      where fact.handoff_id = handoff.id
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function app.submission_manifest_snapshot(uuid) from public, anon;

-- ---------------------------------------------------------------------------
-- Package release now records form versions and the approved-facts snapshot
-- ---------------------------------------------------------------------------
create or replace function app.gov_pin_manifest(p_handoff public.submission_handoffs)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  pos integer := 0;
  form_pos integer := 0;
  fact_pos integer := 0;
  file record;
  form record;
  fact record;
  lines text[] := '{}';
  manifest text;
  form_hash text;
  value_hash text;
begin
  for file in select * from app.submission_package_candidates(p_handoff.matter_id, p_handoff.organization_id) loop
    pos := pos + 1;
    insert into public.submission_manifest_files (
      organization_id, handoff_id, position, document_id, document_version_id, file_name, purpose, byte_size, file_sha256, review_state
    ) values (
      p_handoff.organization_id, p_handoff.id, pos, file.document_id, file.document_version_id, file.file_name, file.purpose,
      file.byte_size, file.file_sha256, file.review_state
    );
    lines := lines || (file.document_version_id::text || ' ' || coalesce(file.file_sha256, '-') || ' ' || file.file_name);
  end loop;
  if pos = 0 then
    raise exception 'the package has no stored files to release' using errcode = '42501';
  end if;
  for form in
    select template.*
    from public.matter_form_pins pin
    join public.form_templates template on template.id = pin.template_id
    where pin.matter_id = p_handoff.matter_id and pin.organization_id = p_handoff.organization_id and pin.superseded_at is null
    order by template.official_form_id, template.id
  loop
    form_pos := form_pos + 1;
    form_hash := encode(sha256(convert_to(
      form.id::text || '|' || form.official_form_id || '|' || form.form_version || '|' || form.mapping_version::text
        || '|' || coalesce(form.snapshot_sha256, '-') || '|' || coalesce(form.page_attested_on::text, '-'),
      'UTF8')), 'hex');
    insert into public.submission_manifest_forms (
      organization_id, handoff_id, position, template_id, official_form_id, form_version, mapping_version,
      official_url, output_format, snapshot_sha256, page_attested_on, effective_on, content_sha256
    ) values (
      p_handoff.organization_id, p_handoff.id, form_pos, form.id, form.official_form_id, form.form_version, form.mapping_version,
      form.official_url, form.output_format, form.snapshot_sha256, form.page_attested_on, form.effective_on, form_hash
    );
    lines := lines || ('FORM ' || form_hash);
  end loop;
  for fact in
    select * from app.matter_approved_facts(p_handoff.matter_id)
    order by person_name, field_key, answer_id
  loop
    fact_pos := fact_pos + 1;
    value_hash := encode(sha256(convert_to(fact.value_text, 'UTF8')), 'hex');
    insert into public.submission_manifest_facts (
      organization_id, handoff_id, position, answer_id, person_id, field_key, label, value_text, value_sha256, reviewed_at, reviewer_membership_id
    ) values (
      p_handoff.organization_id, p_handoff.id, fact_pos, fact.answer_id, fact.person_id, fact.field_key, fact.label,
      fact.value_text, value_hash, fact.reviewed_at, fact.reviewer_membership_id
    );
    lines := lines || ('FACT ' || fact.answer_id::text || ' ' || value_hash);
  end loop;
  manifest := encode(sha256(convert_to(array_to_string(lines, E'\n'), 'UTF8')), 'hex');
  update public.submission_handoffs
  set manifest_sha256 = manifest, manifest_file_count = pos, manifest_pinned_at = statement_timestamp()
  where id = p_handoff.id;
  return jsonb_build_object('manifest_sha256', manifest, 'files', pos, 'forms', form_pos, 'facts', fact_pos);
end;
$$;

-- app.submission_gates_for, last defined in 20261025170000_gov_submission_checklist.sql.
-- Changed: while a package is authorized, a change to the pinned form versions or the approved
-- facts (app.manifest_scope_drift) blocks the package gate as well as a changed file.
create or replace function app.submission_gates_for(p_matter_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  matter public.matters%rowtype;
  handoff public.submission_handoffs%rowtype;
  today date;
  program text;
  rep_since date;
  changed_files integer := 0;
  scope_changed integer := 0;
  candidate_files integer := 0;
  tentative integer := 0;
  waiting integer := 0;
  signed boolean := false;
  fee_lines integer := 0;
  steps_total integer := 0;
  steps_done integer := 0;
  gates jsonb := '[]'::jsonb;
  gate jsonb;
  override_event public.submission_checklist_events%rowtype;
  out_gates jsonb := '[]'::jsonb;
begin
  select * into matter from public.matters where id = p_matter_id;
  if matter.id is null then
    return null;
  end if;
  today := app.firm_today(matter.organization_id);
  program := app.matter_program_key(matter.id);
  select * into handoff
  from public.submission_handoffs open_handoff
  where open_handoff.matter_id = matter.id and open_handoff.status in ('awaiting_signoff', 'authorized')
  order by open_handoff.created_at desc
  limit 1;

  select min(authority.effective_on) into rep_since
  from public.representation_authorities authority
  where authority.matter_id = matter.id
    and authority.organization_id = matter.organization_id
    and authority.revoked_at is null
    and authority.effective_on <= today;
  gates := gates || jsonb_build_object(
    'key', 'representation',
    'state', case when rep_since is null then 'blocked' else 'ok' end,
    'since', rep_since
  );

  select count(*) into candidate_files from app.submission_package_candidates(matter.id, matter.organization_id);
  if handoff.id is not null and handoff.status = 'authorized' and handoff.manifest_pinned_at is not null then
    select count(*) into changed_files
    from public.submission_manifest_files pinned
    where pinned.handoff_id = handoff.id
      and not exists (
        select 1 from app.submission_package_candidates(matter.id, matter.organization_id) now_file
        where now_file.document_version_id = pinned.document_version_id
      );
    scope_changed := app.manifest_scope_drift(handoff.id, matter.id);
  end if;
  gates := gates || jsonb_build_object(
    'key', 'package',
    'state', case
      when handoff.id is null or handoff.status <> 'authorized' then 'blocked'
      when handoff.manifest_pinned_at is null then 'blocked'
      when changed_files > 0 or scope_changed > 0 then 'blocked'
      else 'ok' end,
    'released', handoff.status = 'authorized',
    'pinned', handoff.manifest_pinned_at is not null,
    'label', handoff.package_label,
    'files', handoff.manifest_file_count,
    'changed', changed_files,
    'scope_changed', scope_changed,
    'candidates', candidate_files
  );

  select count(*) into tentative
  from public.deadlines deadline
  where deadline.matter_id = matter.id
    and deadline.organization_id = matter.organization_id
    and deadline.kind in ('legal', 'correspondence')
    and deadline.verification = 'tentative';
  gates := gates || jsonb_build_object('key', 'deadlines', 'state', case when tentative > 0 then 'blocked' else 'ok' end, 'tentative', tentative);

  select count(*) into waiting
  from public.agreements agreement
  where agreement.matter_id = matter.id and agreement.organization_id = matter.organization_id
    and agreement.status in ('sent', 'partially_signed');
  select exists (
    select 1 from public.agreements agreement
    where agreement.matter_id = matter.id and agreement.organization_id = matter.organization_id
      and agreement.kind = 'service' and agreement.status = 'completed'
  ) into signed;
  gates := gates || jsonb_build_object('key', 'signatures', 'state', case when waiting > 0 or not signed then 'blocked' else 'ok' end, 'waiting', waiting, 'signed', signed);

  select count(*) into fee_lines
  from public.invoice_lines line
  join public.invoices invoice on invoice.id = line.invoice_id and invoice.organization_id = line.organization_id
  where invoice.matter_id = matter.id and invoice.organization_id = matter.organization_id and line.category = 'government_fee';
  gates := gates || jsonb_build_object(
    'key', 'fees',
    'state', case when handoff.id is not null and app.submission_item_ticked(handoff.id, 'fee_confirmation', 'fees') then 'ok' else 'blocked' end,
    'fee_lines', fee_lines
  );

  if handoff.id is not null then
    select count(*), count(*) filter (where app.submission_item_ticked(handoff.id, 'outside_step', requirement.id::text))
    into steps_total, steps_done
    from public.submission_requirements requirement
    where requirement.organization_id = matter.organization_id
      and requirement.kind = 'outside_step'
      and requirement.status = 'approved'
      and requirement.channel = handoff.channel
      and (requirement.program_key is null or requirement.program_key is not distinct from program);
  end if;
  gates := gates || jsonb_build_object(
    'key', 'outside_steps',
    'state', case when handoff.id is null or steps_total = 0 then 'none' when steps_done < steps_total then 'blocked' else 'ok' end,
    'total', steps_total,
    'done', steps_done
  );

  for gate in select value from jsonb_array_elements(gates) loop
    if gate ->> 'state' = 'blocked' and gate ->> 'key' <> 'package' and handoff.id is not null then
      select * into override_event
      from public.submission_checklist_events event
      where event.handoff_id = handoff.id and event.kind = 'gate_override' and event.item_key = gate ->> 'key'
      order by event.created_at desc, event.id desc
      limit 1;
      if override_event.id is not null then
        gate := gate || jsonb_build_object(
          'state', 'overridden',
          'override_reason', override_event.note,
          'override_by', override_event.membership_id,
          'override_at', override_event.created_at
        );
      end if;
      override_event := null;
    end if;
    out_gates := out_gates || gate;
  end loop;

  return jsonb_build_object(
    'handoff_id', handoff.id,
    'channel', handoff.channel,
    'program_key', program,
    'gates', out_gates,
    'blocked', (select coalesce(jsonb_agg(item ->> 'key'), '[]'::jsonb) from jsonb_array_elements(out_gates) item where item ->> 'state' = 'blocked')
  );
end;
$$;

-- app.sign_off_submission_handoff, last defined in 20261025170000_gov_submission_checklist.sql.
-- Changed: refuses while a current form pin is stale, and the audit event counts pinned forms and facts.
create or replace function app.sign_off_submission_handoff(p_handoff_id uuid, p_expected_version integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  handoff public.submission_handoffs%rowtype;
  reviewer uuid;
  new_version integer;
  pinned jsonb;
  stale_reason text;
begin
  select * into handoff from public.submission_handoffs where id = p_handoff_id for update;
  if handoff.id is null or app.can_read_matter(handoff.matter_id) is distinct from true then
    raise exception 'sign-off denied' using errcode = '42501';
  end if;
  perform app.gov_require_licensed(handoff.organization_id);
  if handoff.version is distinct from p_expected_version then
    raise exception 'submission handoff version conflict' using errcode = 'PT409';
  end if;
  if handoff.status is distinct from 'awaiting_signoff' then
    raise exception 'this handoff is not waiting for sign-off' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.representation_authorities authority
    where authority.matter_id = handoff.matter_id
      and authority.organization_id = handoff.organization_id
      and authority.revoked_at is null
      and authority.effective_on <= app.firm_today(handoff.organization_id)
  ) then
    raise exception 'representation authority must be on file before sign-off' using errcode = '42501';
  end if;
  select app.form_template_stale_reason(pin.template_id) into stale_reason
  from public.matter_form_pins pin
  where pin.matter_id = handoff.matter_id and pin.superseded_at is null and app.form_template_is_stale(pin.template_id)
  limit 1;
  if stale_reason = 'recheck_due' then
    raise exception 'a pinned form version is stale; re-check the official page and pin the current template before releasing the package' using errcode = '42501';
  end if;
  if stale_reason = 'not_yet_effective' then
    raise exception 'a pinned form template is not yet effective' using errcode = '42501';
  end if;
  if stale_reason is not null then
    raise exception 'a pinned form version is no longer current; pin the approved template before releasing the package' using errcode = '42501';
  end if;
  reviewer := app.gov_actor_membership(handoff.organization_id);
  perform app.gov_open_write(handoff.id);
  update public.submission_handoffs
  set status = 'authorized', signoff_membership_id = reviewer, signed_off_at = statement_timestamp()
  where id = handoff.id;
  pinned := app.gov_pin_manifest(handoff);
  select version into new_version from public.submission_handoffs where id = handoff.id;
  perform app.gov_close_write(handoff.id);
  perform app.record_audit_event(
    handoff.organization_id, 'submission.signed_off', 'public.submission_handoffs', handoff.id, 'success',
    jsonb_build_object(
      'matter_id', handoff.matter_id, 'package_label', handoff.package_label, 'package_sha256', handoff.package_sha256,
      'manifest_sha256', pinned ->> 'manifest_sha256', 'manifest_files', (pinned ->> 'files')::integer,
      'manifest_forms', (pinned ->> 'forms')::integer, 'manifest_facts', (pinned ->> 'facts')::integer
    )
  );
  return new_version;
end;
$$;

-- app.record_submission, last defined in 20261025170000_gov_submission_checklist.sql.
-- Changed: the audit event also lists the pinned form versions and the approved-fact hashes.
create or replace function app.record_submission(
  p_handoff_id uuid,
  p_expected_version integer,
  p_external_reference text,
  p_submitted_at timestamptz,
  p_submitted_by_membership_id uuid,
  p_receipt_version_id uuid,
  p_receipt_locator text,
  p_acknowledged_on date
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  handoff public.submission_handoffs%rowtype;
  new_version integer;
  gate_state jsonb;
  blocked_list text;
  manifest jsonb;
  manifest_forms jsonb;
  manifest_facts jsonb;
begin
  select * into handoff from public.submission_handoffs where id = p_handoff_id for update;
  if handoff.id is null or app.can_read_matter(handoff.matter_id) is distinct from true then
    raise exception 'submission record denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    handoff.organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[],
    true
  );
  if handoff.version is distinct from p_expected_version then
    raise exception 'submission handoff version conflict' using errcode = 'PT409';
  end if;
  if handoff.status is distinct from 'authorized' then
    raise exception 'a submission is recorded only after consultant sign-off' using errcode = '42501';
  end if;
  gate_state := app.submission_gates_for(handoff.matter_id);
  select string_agg(item #>> '{}', ', ') into blocked_list from jsonb_array_elements(gate_state -> 'blocked') item;
  if blocked_list is not null then
    raise exception 'the submission checklist is not complete: %', blocked_list using errcode = '42501';
  end if;
  if p_external_reference is null or length(btrim(p_external_reference)) not between 1 and 200 then
    raise exception 'the submission reference is required' using errcode = '22023';
  end if;
  if p_submitted_at is null or p_submitted_at > statement_timestamp() + interval '5 minutes' then
    raise exception 'the submission time is required and cannot be in the future' using errcode = '22023';
  end if;
  if p_submitted_at < handoff.signed_off_at - interval '1 day' then
    raise exception 'the submission time is before the consultant sign-off' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.memberships mem
    where mem.id = p_submitted_by_membership_id
      and mem.organization_id = handoff.organization_id
      and app.membership_is_licensed(mem.id)
  ) then
    raise exception 'the submitting representative must be a licensed member of this firm' using errcode = '42501';
  end if;
  perform app.gov_open_write(handoff.id);
  update public.submission_handoffs
  set status = 'submission_unverified',
      external_reference = btrim(p_external_reference),
      submitted_at = p_submitted_at,
      submitted_by_membership_id = p_submitted_by_membership_id
  where id = handoff.id
  returning version into new_version;
  perform app.gov_close_write(handoff.id);
  select coalesce(jsonb_agg(jsonb_build_object('position', pinned.position, 'file', pinned.file_name, 'version_id', pinned.document_version_id, 'sha256', pinned.file_sha256) order by pinned.position), '[]'::jsonb)
  into manifest
  from public.submission_manifest_files pinned
  where pinned.handoff_id = handoff.id;
  select coalesce(jsonb_agg(jsonb_build_object('position', form.position, 'official_form_id', form.official_form_id, 'form_version', form.form_version, 'mapping_version', form.mapping_version, 'sha256', form.content_sha256) order by form.position), '[]'::jsonb)
  into manifest_forms
  from public.submission_manifest_forms form
  where form.handoff_id = handoff.id;
  select coalesce(jsonb_agg(jsonb_build_object('position', fact.position, 'answer_id', fact.answer_id, 'field_key', fact.field_key, 'sha256', fact.value_sha256) order by fact.position), '[]'::jsonb)
  into manifest_facts
  from public.submission_manifest_facts fact
  where fact.handoff_id = handoff.id;
  perform app.record_audit_event(
    handoff.organization_id, 'submission.recorded', 'public.submission_handoffs', handoff.id, 'success',
    jsonb_build_object(
      'matter_id', handoff.matter_id,
      'submitted_by', p_submitted_by_membership_id,
      'package_label', handoff.package_label,
      'manifest_sha256', handoff.manifest_sha256,
      'manifest', manifest,
      'manifest_forms', manifest_forms,
      'manifest_facts', manifest_facts,
      'overridden', (select coalesce(jsonb_agg(item ->> 'key'), '[]'::jsonb) from jsonb_array_elements(gate_state -> 'gates') item where item ->> 'state' = 'overridden')
    )
  );
  if p_receipt_version_id is not null or nullif(btrim(coalesce(p_receipt_locator, '')), '') is not null then
    new_version := app.gov_finish_verification(handoff.id, p_receipt_version_id, p_receipt_locator, p_acknowledged_on);
  elsif p_acknowledged_on is not null then
    raise exception 'an acknowledgement date needs the receipt' using errcode = '22023';
  end if;
  return new_version;
end;
$$;

-- ---------------------------------------------------------------------------
-- Invoker wrappers
-- ---------------------------------------------------------------------------
create function public.propose_form_template(
  p_org uuid, p_jurisdiction text, p_program_key text, p_official_form_id text, p_official_url text, p_source_section text,
  p_form_version text, p_mapping_version integer, p_effective_on date, p_output_format text, p_fields jsonb, p_checked_on date, p_snapshot jsonb
)
returns uuid language sql security invoker set search_path = ''
as $$
  select app.propose_form_template(
    p_org, p_jurisdiction, p_program_key, p_official_form_id, p_official_url, p_source_section,
    p_form_version, p_mapping_version, p_effective_on, p_output_format, p_fields, p_checked_on, p_snapshot
  );
$$;

create function public.review_form_template(p_template_id uuid, p_expected_version integer, p_decision text, p_note text, p_page_opened_on date)
returns integer language sql security invoker set search_path = ''
as $$ select app.review_form_template(p_template_id, p_expected_version, p_decision, p_note, p_page_opened_on); $$;

create function public.retire_form_template(p_template_id uuid, p_expected_version integer, p_reason text)
returns integer language sql security invoker set search_path = ''
as $$ select app.retire_form_template(p_template_id, p_expected_version, p_reason); $$;

create function public.pin_form_template(p_matter_id uuid, p_template_id uuid)
returns uuid language sql security invoker set search_path = ''
as $$ select app.pin_form_template(p_matter_id, p_template_id); $$;

create function public.form_mapping_review(p_matter_id uuid)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select app.form_mapping_review(p_matter_id); $$;

create function public.channel_export_rule(p_org uuid, p_channel public.submission_channel)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select app.channel_export_rule(p_org, p_channel); $$;

create function public.set_channel_export_rule(p_org uuid, p_channel public.submission_channel, p_name_pattern text, p_max_bytes bigint)
returns uuid language sql security invoker set search_path = ''
as $$ select app.set_channel_export_rule(p_org, p_channel, p_name_pattern, p_max_bytes); $$;

create function public.save_bundle_selection(p_matter_id uuid, p_channel public.submission_channel, p_items jsonb)
returns uuid language sql security invoker set search_path = ''
as $$ select app.save_bundle_selection(p_matter_id, p_channel, p_items); $$;

create function public.bundle_index(p_matter_id uuid)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select app.bundle_index(p_matter_id); $$;

create function public.record_bundle_export(p_matter_id uuid, p_file_name text, p_byte_size bigint, p_page_count integer)
returns uuid language sql security invoker set search_path = ''
as $$ select app.record_bundle_export(p_matter_id, p_file_name, p_byte_size, p_page_count); $$;

create function public.submission_manifest_snapshot(p_handoff_id uuid)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select app.submission_manifest_snapshot(p_handoff_id); $$;

revoke all on function public.propose_form_template(uuid, text, text, text, text, text, text, integer, date, text, jsonb, date, jsonb) from public, anon;
revoke all on function public.review_form_template(uuid, integer, text, text, date) from public, anon;
revoke all on function public.retire_form_template(uuid, integer, text) from public, anon;
revoke all on function public.pin_form_template(uuid, uuid) from public, anon;
revoke all on function public.form_mapping_review(uuid) from public, anon;
revoke all on function public.channel_export_rule(uuid, public.submission_channel) from public, anon;
revoke all on function public.set_channel_export_rule(uuid, public.submission_channel, text, bigint) from public, anon;
revoke all on function public.save_bundle_selection(uuid, public.submission_channel, jsonb) from public, anon;
revoke all on function public.bundle_index(uuid) from public, anon;
revoke all on function public.record_bundle_export(uuid, text, bigint, integer) from public, anon;
revoke all on function public.submission_manifest_snapshot(uuid) from public, anon;

grant execute on function public.propose_form_template(uuid, text, text, text, text, text, text, integer, date, text, jsonb, date, jsonb) to authenticated, service_role;
grant execute on function public.review_form_template(uuid, integer, text, text, date) to authenticated, service_role;
grant execute on function public.retire_form_template(uuid, integer, text) to authenticated, service_role;
grant execute on function public.pin_form_template(uuid, uuid) to authenticated, service_role;
grant execute on function public.form_mapping_review(uuid) to authenticated, service_role;
grant execute on function public.channel_export_rule(uuid, public.submission_channel) to authenticated, service_role;
grant execute on function public.set_channel_export_rule(uuid, public.submission_channel, text, bigint) to authenticated, service_role;
grant execute on function public.save_bundle_selection(uuid, public.submission_channel, jsonb) to authenticated, service_role;
grant execute on function public.bundle_index(uuid) to authenticated, service_role;
grant execute on function public.record_bundle_export(uuid, text, bigint, integer) to authenticated, service_role;
grant execute on function public.submission_manifest_snapshot(uuid) to authenticated, service_role;

grant execute on function app.propose_form_template(uuid, text, text, text, text, text, text, integer, date, text, jsonb, date, jsonb) to authenticated, service_role;
grant execute on function app.review_form_template(uuid, integer, text, text, date) to authenticated, service_role;
grant execute on function app.retire_form_template(uuid, integer, text) to authenticated, service_role;
grant execute on function app.pin_form_template(uuid, uuid) to authenticated, service_role;
grant execute on function app.form_mapping_review(uuid) to authenticated, service_role;
grant execute on function app.channel_export_rule(uuid, public.submission_channel) to authenticated, service_role;
grant execute on function app.set_channel_export_rule(uuid, public.submission_channel, text, bigint) to authenticated, service_role;
grant execute on function app.save_bundle_selection(uuid, public.submission_channel, jsonb) to authenticated, service_role;
grant execute on function app.bundle_index(uuid) to authenticated, service_role;
grant execute on function app.record_bundle_export(uuid, text, bigint, integer) to authenticated, service_role;
grant execute on function app.submission_manifest_snapshot(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Privileges and row-level security
-- ---------------------------------------------------------------------------
revoke all on table public.form_templates from public, anon, authenticated;
revoke all on table public.form_template_fields from public, anon, authenticated;
revoke all on table public.matter_form_pins from public, anon, authenticated;
revoke all on table public.submission_channel_templates from public, anon, authenticated;
revoke all on table public.matter_bundle_selections from public, anon, authenticated;
revoke all on table public.matter_bundle_items from public, anon, authenticated;
revoke all on table public.submission_manifest_forms from public, anon, authenticated;
revoke all on table public.submission_manifest_facts from public, anon, authenticated;

grant select on table public.form_templates to authenticated;
grant select on table public.form_template_fields to authenticated;
grant select on table public.matter_form_pins to authenticated;
grant select on table public.submission_channel_templates to authenticated;
grant select on table public.matter_bundle_selections to authenticated;
grant select on table public.matter_bundle_items to authenticated;
grant select on table public.submission_manifest_forms to authenticated;
grant select on table public.submission_manifest_facts to authenticated;

alter table public.form_templates enable row level security;
alter table public.form_templates force row level security;
alter table public.form_template_fields enable row level security;
alter table public.form_template_fields force row level security;
alter table public.matter_form_pins enable row level security;
alter table public.matter_form_pins force row level security;
alter table public.submission_channel_templates enable row level security;
alter table public.submission_channel_templates force row level security;
alter table public.matter_bundle_selections enable row level security;
alter table public.matter_bundle_selections force row level security;
alter table public.matter_bundle_items enable row level security;
alter table public.matter_bundle_items force row level security;
alter table public.submission_manifest_forms enable row level security;
alter table public.submission_manifest_forms force row level security;
alter table public.submission_manifest_facts enable row level security;
alter table public.submission_manifest_facts force row level security;

create policy form_templates_select on public.form_templates
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.is_org_staff(organization_id))
    and (select app.staff_mfa_satisfied())
  );

create policy form_template_fields_select on public.form_template_fields
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.is_org_staff(organization_id))
    and (select app.staff_mfa_satisfied())
  );

create policy matter_form_pins_select on public.matter_form_pins
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.gov_staff_can_read(matter_id, organization_id))
  );

create policy submission_channel_templates_select on public.submission_channel_templates
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.is_org_staff(organization_id))
    and (select app.staff_mfa_satisfied())
  );

create policy matter_bundle_selections_select on public.matter_bundle_selections
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.gov_staff_can_read(matter_id, organization_id))
  );

create policy matter_bundle_items_select on public.matter_bundle_items
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and exists (
      select 1 from public.matter_bundle_selections saved
      where saved.id = matter_bundle_items.selection_id
        and (select app.gov_staff_can_read(saved.matter_id, saved.organization_id))
    )
  );

create policy submission_manifest_forms_select on public.submission_manifest_forms
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and exists (
      select 1 from public.submission_handoffs handoff
      where handoff.id = submission_manifest_forms.handoff_id
        and (select app.gov_staff_can_read(handoff.matter_id, handoff.organization_id))
    )
  );

create policy submission_manifest_facts_select on public.submission_manifest_facts
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and exists (
      select 1 from public.submission_handoffs handoff
      where handoff.id = submission_manifest_facts.handoff_id
        and (select app.gov_staff_can_read(handoff.matter_id, handoff.organization_id))
    )
  );
