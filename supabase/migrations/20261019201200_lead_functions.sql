-- Lead pipeline writes (PRD §7 lead lifecycle, CRM-01, CRM-02; links to CRM-03 bookings).
--
-- Every write is a SECURITY DEFINER function with search_path = '' that checks the caller is
-- operational staff of the active firm with staff MFA (app.require_active_staff with
-- app.lead_staff_roles()), checks the lead's expected version where a person edits what they saw
-- (a stale edit returns a conflict, PRD §11), writes lead_events history and an audit event.
--
-- Converting a lead is SECURITY INVOKER and calls public.create_client_matter (20261018180000)
-- unchanged, so the matter, its applicant and the creator's participant row are made exactly as
-- the Sheet's New matter makes them, under the same RLS, sample-mode and licence checks. It never
-- merges people.
--
-- The public enquiry function is the only anonymous entry. It accepts an enquiry only for a firm
-- that is out of sample mode and has published a privacy notice, records the reply consent and an
-- optional marketing consent as separate rows (CASL), and rate-limits by a hash of the client
-- address. No existing function is redefined.

-- ---------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------

create function app.lead_sha256(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(extensions.digest(convert_to(p_text, 'utf8'), 'sha256'), 'hex');
$$;
revoke all on function app.lead_sha256(text) from public;

-- The first problem with a lead's contact details, in words a person can act on, or null.
create function app.lead_contact_problem(p_name text, p_email text, p_phone text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_name is null or length(btrim(p_name)) not between 1 and 200 then 'add the person''s name (up to 200 characters)'
    when p_email is not null and (length(p_email) > 320 or p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then 'enter a valid email address'
    when p_phone is not null and p_phone !~ '^[0-9+() .-]{3,40}$' then 'enter a valid phone number'
    else null
  end;
$$;
revoke all on function app.lead_contact_problem(text, text, text) from public;

create function app.lead_text(p_value text, p_max integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when nullif(btrim(coalesce(p_value, '')), '') is null then null
              else left(regexp_replace(btrim(p_value), '\s+', ' ', 'g'), p_max) end;
$$;
revoke all on function app.lead_text(text, integer) from public;

create function app.lead_tags(p_tags text[])
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(distinct tag order by tag), '{}'::text[])
  from (
    select left(lower(regexp_replace(btrim(raw), '\s+', ' ', 'g')), 40) as tag
    from unnest(coalesce(p_tags, '{}'::text[])) raw
    where nullif(btrim(raw), '') is not null
  ) cleaned;
$$;
revoke all on function app.lead_tags(text[]) from public;

-- The firm's live stage of a kind, or by key.
create function app.lead_stage_of_kind(p_org uuid, p_kind public.lead_stage_kind)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select stage.id
  from public.lead_stages stage
  where stage.organization_id = p_org and stage.kind = p_kind and stage.archived_at is null
  order by stage.position, stage.key
  limit 1;
$$;
revoke all on function app.lead_stage_of_kind(uuid, public.lead_stage_kind) from public;

create function app.lead_stage_by_key(p_org uuid, p_key text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select stage.id
  from public.lead_stages stage
  where stage.organization_id = p_org and stage.key = p_key and stage.archived_at is null;
$$;
revoke all on function app.lead_stage_by_key(uuid, text) from public;

-- An owner must be active operational staff of the firm.
create function app.lead_check_owner(p_org uuid, p_membership_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_membership_id is null then
    return;
  end if;
  if not exists (
    select 1 from public.memberships mem
    where mem.id = p_membership_id and mem.organization_id = p_org and mem.status = 'active'
      and mem.role = any (app.lead_staff_roles())
  ) then
    raise exception 'choose active staff as the owner' using errcode = '22023';
  end if;
end;
$$;
revoke all on function app.lead_check_owner(uuid, uuid) from public;

-- The caller's own active staff membership in the firm.
create function app.lead_my_membership(p_org uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select mem.id
  from public.memberships mem
  where mem.organization_id = p_org and mem.user_id = (select auth.uid()) and mem.status = 'active'
    and mem.role = any (app.lead_staff_roles())
  order by mem.created_at
  limit 1;
$$;
revoke all on function app.lead_my_membership(uuid) from public;

create function app.lead_event(
  p_org uuid,
  p_lead uuid,
  p_kind text,
  p_from uuid,
  p_to uuid,
  p_reason text,
  p_payload jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.lead_events (organization_id, lead_id, kind, from_stage_id, to_stage_id, reason, payload, actor_user_id)
  values (p_org, p_lead, p_kind, p_from, p_to, left(p_reason, 500), coalesce(p_payload, '{}'::jsonb), (select auth.uid()));
$$;
revoke all on function app.lead_event(uuid, uuid, text, uuid, uuid, text, jsonb) from public;

-- Staff check, then the lead locked for update at the version the person saw.
create function app.lead_for_update(p_org uuid, p_lead uuid, p_expected_version integer)
returns public.leads
language plpgsql
security definer
set search_path = ''
as $$
declare
  lead public.leads%rowtype;
begin
  perform app.require_active_staff(p_org, app.lead_staff_roles(), false);
  select * into lead from public.leads where id = p_lead and organization_id = p_org for update;
  if lead.id is null then
    raise exception 'lead not found' using errcode = 'P0002';
  end if;
  if p_expected_version is not null and lead.version <> p_expected_version then
    raise exception 'lead changed by someone else' using errcode = '40001';
  end if;
  return lead;
end;
$$;
revoke all on function app.lead_for_update(uuid, uuid, integer) from public;

create function app.lead_stage_kind_of(p_stage uuid)
returns public.lead_stage_kind
language sql
stable
security definer
set search_path = ''
as $$
  select stage.kind from public.lead_stages stage where stage.id = p_stage;
$$;
revoke all on function app.lead_stage_kind_of(uuid) from public;

-- ---------------------------------------------------------------------------
-- Create and edit (staff)
-- ---------------------------------------------------------------------------

-- A lead a staff member records (a call, a referral, an event, a walk-in). Website, hosted page,
-- booking page and CSV leads come through their own functions with their own source.
create function public.create_lead(
  p_org uuid,
  p_name text,
  p_email text,
  p_phone text,
  p_preferred_contact text,
  p_service_interest text,
  p_country_now text,
  p_language text,
  p_source public.lead_source,
  p_source_detail text,
  p_owner_membership_id uuid,
  p_proposed_fee_cents bigint,
  p_tags text[],
  p_note text,
  p_reply_consent boolean,
  p_marketing_consent boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := app.lead_text(p_name, 400);
  v_email text := lower(app.lead_text(p_email, 400));
  v_phone text := app.lead_text(p_phone, 60);
  v_owner uuid := coalesce(p_owner_membership_id, app.lead_my_membership(p_org));
  v_stage uuid;
  v_sample boolean;
  v_problem text;
  v_id uuid := gen_random_uuid();
  v_statement text;
begin
  perform app.require_active_staff(p_org, app.lead_staff_roles(), false);
  if p_source is null or p_source in ('web_form', 'hosted_page', 'booking_page', 'csv_import') then
    raise exception 'choose where this lead came from' using errcode = '22023';
  end if;
  v_problem := app.lead_contact_problem(v_name, v_email, v_phone);
  if v_problem is not null then
    raise exception '%', v_problem using errcode = '22023';
  end if;
  if p_preferred_contact is not null and p_preferred_contact not in ('email', 'phone') then
    raise exception 'choose email or phone as the preferred contact' using errcode = '22023';
  end if;
  if p_proposed_fee_cents is not null and p_proposed_fee_cents not between 0 and 99999999 then
    raise exception 'the proposed fee is out of range' using errcode = '22023';
  end if;
  perform app.lead_check_owner(p_org, v_owner);
  v_stage := app.lead_stage_of_kind(p_org, 'open');
  if v_stage is null then
    raise exception 'this firm has no open lead stage' using errcode = 'P0002';
  end if;
  select org.sample_mode into v_sample from public.organizations org where org.id = p_org;

  insert into public.leads (
    id, organization_id, display_name, email, phone, preferred_contact, service_interest, country_now, language,
    source, source_detail, stage_id, owner_membership_id, proposed_fee_cents, tags, is_sample
  ) values (
    v_id, p_org, v_name, v_email, v_phone, p_preferred_contact, app.lead_text(p_service_interest, 120),
    app.lead_text(p_country_now, 100), app.lead_text(p_language, 100), p_source, app.lead_text(p_source_detail, 200),
    v_stage, v_owner, p_proposed_fee_cents, app.lead_tags(p_tags), coalesce(v_sample, false)
  );
  if app.lead_text(p_note, 4000) is not null then
    insert into public.lead_notes (organization_id, lead_id, body) values (p_org, v_id, app.lead_text(p_note, 4000));
  end if;
  if p_reply_consent is true then
    v_statement := 'Agreed that the firm may use these details to reply to this enquiry. Recorded by staff.';
    insert into public.lead_consents (organization_id, lead_id, purpose, granted, statement_text, statement_sha256, captured_via)
    values (p_org, v_id, 'enquiry_reply', true, v_statement, app.lead_sha256(v_statement), 'staff');
  end if;
  if p_marketing_consent is true then
    v_statement := 'Gave express consent to receive the firm''s news. Recorded by staff.';
    insert into public.lead_consents (organization_id, lead_id, purpose, granted, statement_text, statement_sha256, captured_via)
    values (p_org, v_id, 'marketing', true, v_statement, app.lead_sha256(v_statement), 'staff');
  end if;
  perform app.lead_event(p_org, v_id, 'created', null, v_stage, null, jsonb_build_object('source', p_source));
  perform app.record_audit_event(p_org, 'lead.created', 'public.leads', v_id, 'success', jsonb_build_object('source', p_source));
  return v_id;
end;
$$;

create function public.update_lead(
  p_org uuid,
  p_lead uuid,
  p_expected_version integer,
  p_name text,
  p_email text,
  p_phone text,
  p_preferred_contact text,
  p_service_interest text,
  p_country_now text,
  p_language text,
  p_date_of_birth date,
  p_source_detail text,
  p_owner_membership_id uuid,
  p_proposed_fee_cents bigint,
  p_tags text[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  lead public.leads;
  v_name text := app.lead_text(p_name, 400);
  v_email text := lower(app.lead_text(p_email, 400));
  v_phone text := app.lead_text(p_phone, 60);
  v_problem text;
  v_version integer;
begin
  lead := app.lead_for_update(p_org, p_lead, p_expected_version);
  if lead.converted_at is not null then
    raise exception 'a converted lead is kept as it was; edit the client on the matter' using errcode = '22023';
  end if;
  v_problem := app.lead_contact_problem(v_name, v_email, v_phone);
  if v_problem is not null then
    raise exception '%', v_problem using errcode = '22023';
  end if;
  if v_email is null and v_phone is null and lead.source in ('web_form', 'hosted_page', 'booking_page', 'email') then
    raise exception 'keep an email address or a phone number' using errcode = '22023';
  end if;
  if p_preferred_contact is not null and p_preferred_contact not in ('email', 'phone') then
    raise exception 'choose email or phone as the preferred contact' using errcode = '22023';
  end if;
  if p_date_of_birth is not null and (p_date_of_birth > current_date or p_date_of_birth < date '1900-01-01') then
    raise exception 'date of birth is not plausible' using errcode = '22023';
  end if;
  if p_proposed_fee_cents is not null and p_proposed_fee_cents not between 0 and 99999999 then
    raise exception 'the proposed fee is out of range' using errcode = '22023';
  end if;
  perform app.lead_check_owner(p_org, p_owner_membership_id);

  update public.leads set
    display_name = v_name,
    email = v_email,
    phone = v_phone,
    preferred_contact = p_preferred_contact,
    service_interest = app.lead_text(p_service_interest, 120),
    country_now = app.lead_text(p_country_now, 100),
    language = app.lead_text(p_language, 100),
    date_of_birth = p_date_of_birth,
    source_detail = app.lead_text(p_source_detail, 200),
    owner_membership_id = p_owner_membership_id,
    proposed_fee_cents = p_proposed_fee_cents,
    tags = app.lead_tags(p_tags)
  where id = lead.id
  returning version into v_version;

  perform app.lead_event(p_org, lead.id, 'updated', null, null, null, '{}'::jsonb);
  if p_owner_membership_id is distinct from lead.owner_membership_id then
    perform app.lead_event(p_org, lead.id, 'assigned', null, null, null,
      jsonb_build_object('from', lead.owner_membership_id, 'to', p_owner_membership_id));
  end if;
  return v_version;
end;
$$;

-- ---------------------------------------------------------------------------
-- Stages
-- ---------------------------------------------------------------------------

-- Moves a lead to an open (or the archived) stage: the board's drag and arrow buttons. Converted
-- needs Convert to matter; Lost needs Close as lost with a reason. Moving a lost or archived lead
-- back to an open stage reopens it; its earlier lost reason stays in the history.
create function public.move_lead_stage(
  p_org uuid,
  p_lead uuid,
  p_to_stage uuid,
  p_expected_version integer,
  p_reason text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  lead public.leads;
  target public.lead_stages%rowtype;
  current_kind public.lead_stage_kind;
  v_version integer;
begin
  lead := app.lead_for_update(p_org, p_lead, p_expected_version);
  select * into target from public.lead_stages stage
  where stage.id = p_to_stage and stage.organization_id = p_org and stage.archived_at is null;
  if target.id is null then
    raise exception 'stage not found' using errcode = 'P0002';
  end if;
  if target.id = lead.stage_id then
    return lead.version;
  end if;
  current_kind := app.lead_stage_kind_of(lead.stage_id);
  if current_kind = 'converted' then
    raise exception 'a converted lead stays converted' using errcode = '22023';
  end if;
  if target.kind = 'converted' then
    raise exception 'use convert to matter to convert a lead' using errcode = '22023';
  end if;
  if target.kind = 'lost' then
    raise exception 'close a lead as lost from the lead, with a reason' using errcode = '22023';
  end if;

  update public.leads
  set stage_id = target.id, lost_at = null, lost_reason = null
  where id = lead.id
  returning version into v_version;

  if current_kind in ('lost', 'archived') and target.kind = 'open' then
    perform app.lead_event(p_org, lead.id, 'reopened', lead.stage_id, target.id, app.lead_text(p_reason, 500),
      jsonb_build_object('lost_reason', lead.lost_reason));
  else
    perform app.lead_event(p_org, lead.id, 'stage_changed', lead.stage_id, target.id, app.lead_text(p_reason, 500), '{}'::jsonb);
  end if;
  perform app.record_audit_event(p_org, 'lead.stage_changed', 'public.leads', lead.id, 'success',
    jsonb_build_object('from_stage_id', lead.stage_id, 'to_stage_id', target.id));
  return v_version;
end;
$$;

create function public.close_lead_lost(p_org uuid, p_lead uuid, p_expected_version integer, p_reason text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  lead public.leads;
  v_reason text := app.lead_text(p_reason, 600);
  v_lost uuid;
  v_version integer;
begin
  lead := app.lead_for_update(p_org, p_lead, p_expected_version);
  if v_reason is null or length(v_reason) not between 3 and 500 then
    raise exception 'give a reason the lead was lost (3 to 500 characters)' using errcode = '22023';
  end if;
  if lead.converted_at is not null then
    raise exception 'a converted lead stays converted' using errcode = '22023';
  end if;
  if lead.lost_at is not null then
    raise exception 'this lead is already closed as lost' using errcode = '22023';
  end if;
  v_lost := app.lead_stage_of_kind(p_org, 'lost');
  if v_lost is null then
    raise exception 'this firm has no lost stage' using errcode = 'P0002';
  end if;
  update public.leads
  set stage_id = v_lost, lost_reason = v_reason, lost_at = now()
  where id = lead.id
  returning version into v_version;
  perform app.lead_event(p_org, lead.id, 'lost', lead.stage_id, v_lost, v_reason, '{}'::jsonb);
  perform app.record_audit_event(p_org, 'lead.lost', 'public.leads', lead.id, 'success', '{}'::jsonb);
  return v_version;
end;
$$;

-- A firm owner renames, reorders or adds a stage. Kinds of existing stages never change; a new
-- stage is an open stage.
create function public.save_lead_stage(p_org uuid, p_stage_id uuid, p_label text, p_position integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_label text := app.lead_text(p_label, 120);
  v_id uuid;
  v_key text;
begin
  perform app.require_active_staff(p_org, array['firm_owner']::public.org_role[], false);
  if v_label is null or length(v_label) > 60 then
    raise exception 'give the stage a name (up to 60 characters)' using errcode = '22023';
  end if;
  if p_position is null or p_position not between 1 and 50 then
    raise exception 'choose a position from 1 to 50' using errcode = '22023';
  end if;
  if p_stage_id is null then
    v_key := left(coalesce(nullif(regexp_replace(app.lead_match_name(v_label), '[^a-z0-9]+', '_', 'g'), ''), 'stage'), 30)
             || '_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
    if v_key !~ '^[a-z]' then
      v_key := 's' || v_key;
    end if;
    insert into public.lead_stages (organization_id, key, label, kind, position)
    values (p_org, left(v_key, 40), v_label, 'open', p_position)
    returning id into v_id;
  else
    update public.lead_stages set label = v_label, position = p_position
    where id = p_stage_id and organization_id = p_org and archived_at is null
    returning id into v_id;
    if v_id is null then
      raise exception 'stage not found' using errcode = 'P0002';
    end if;
  end if;
  perform app.record_audit_event(p_org, 'lead_stage.saved', 'public.lead_stages', v_id, 'success', '{}'::jsonb);
  return v_id;
end;
$$;

create function public.archive_lead_stage(p_org uuid, p_stage_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  stage public.lead_stages%rowtype;
begin
  perform app.require_active_staff(p_org, array['firm_owner']::public.org_role[], false);
  select * into stage from public.lead_stages s where s.id = p_stage_id and s.organization_id = p_org and s.archived_at is null for update;
  if stage.id is null then
    raise exception 'stage not found' using errcode = 'P0002';
  end if;
  if stage.kind <> 'open' then
    raise exception 'converted, lost and archived stages are always kept' using errcode = '22023';
  end if;
  if exists (select 1 from public.leads l where l.stage_id = stage.id) then
    raise exception 'move the leads out of this stage first' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.lead_stages s
    where s.organization_id = p_org and s.kind = 'open' and s.archived_at is null and s.id <> stage.id
  ) then
    raise exception 'keep at least one open stage' using errcode = '22023';
  end if;
  update public.lead_stages set archived_at = now() where id = stage.id;
  perform app.record_audit_event(p_org, 'lead_stage.archived', 'public.lead_stages', stage.id, 'success', '{}'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Notes, follow-ups, consent
-- ---------------------------------------------------------------------------

create function public.add_lead_note(p_org uuid, p_lead uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_body text := btrim(coalesce(p_body, ''));
  v_id uuid;
begin
  perform app.require_active_staff(p_org, app.lead_staff_roles(), false);
  if length(v_body) not between 1 and 4000 then
    raise exception 'write a note (up to 4,000 characters)' using errcode = '22023';
  end if;
  if not exists (select 1 from public.leads l where l.id = p_lead and l.organization_id = p_org) then
    raise exception 'lead not found' using errcode = 'P0002';
  end if;
  insert into public.lead_notes (organization_id, lead_id, body) values (p_org, p_lead, v_body) returning id into v_id;
  perform app.record_audit_event(p_org, 'lead.note_added', 'public.lead_notes', v_id, 'success', jsonb_build_object('lead_id', p_lead));
  return v_id;
end;
$$;

create function public.add_lead_follow_up(p_org uuid, p_lead uuid, p_title text, p_owner_membership_id uuid, p_due_on date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text := app.lead_text(p_title, 400);
  v_owner uuid := coalesce(p_owner_membership_id, app.lead_my_membership(p_org));
  v_id uuid;
begin
  perform app.require_active_staff(p_org, app.lead_staff_roles(), false);
  if v_title is null or length(v_title) > 200 then
    raise exception 'name the follow-up (up to 200 characters)' using errcode = '22023';
  end if;
  if p_due_on is not null and (p_due_on < current_date - 1 or p_due_on > current_date + 730) then
    raise exception 'choose a due date from today to two years ahead' using errcode = '22023';
  end if;
  if not exists (select 1 from public.leads l where l.id = p_lead and l.organization_id = p_org) then
    raise exception 'lead not found' using errcode = 'P0002';
  end if;
  perform app.lead_check_owner(p_org, v_owner);
  insert into public.lead_follow_ups (organization_id, lead_id, title, owner_membership_id, due_on)
  values (p_org, p_lead, v_title, v_owner, p_due_on)
  returning id into v_id;
  perform app.lead_event(p_org, p_lead, 'follow_up_added', null, null, null, jsonb_build_object('follow_up_id', v_id));
  return v_id;
end;
$$;

create function public.complete_lead_follow_up(p_org uuid, p_follow_up uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  item public.lead_follow_ups%rowtype;
begin
  perform app.require_active_staff(p_org, app.lead_staff_roles(), false);
  select * into item from public.lead_follow_ups f where f.id = p_follow_up and f.organization_id = p_org for update;
  if item.id is null then
    raise exception 'follow-up not found' using errcode = 'P0002';
  end if;
  if item.completed_at is not null then
    return;
  end if;
  update public.lead_follow_ups set completed_at = now(), completed_by = (select auth.uid()) where id = item.id;
  perform app.lead_event(p_org, item.lead_id, 'follow_up_done', null, null, null, jsonb_build_object('follow_up_id', item.id));
end;
$$;

-- Staff record a consent answer the person gave them (for example an opt-out by phone). A new row
-- each time; the latest row per purpose is current. Replies and marketing stay separate.
create function public.record_lead_consent(p_org uuid, p_lead uuid, p_purpose public.lead_consent_purpose, p_granted boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_statement text;
  v_id uuid;
begin
  perform app.require_active_staff(p_org, app.lead_staff_roles(), false);
  if p_purpose is null or p_granted is null then
    raise exception 'choose the consent and the answer' using errcode = '22023';
  end if;
  if not exists (select 1 from public.leads l where l.id = p_lead and l.organization_id = p_org) then
    raise exception 'lead not found' using errcode = 'P0002';
  end if;
  v_statement := case
    when p_purpose = 'marketing' and p_granted then 'Gave express consent to receive the firm''s news. Recorded by staff.'
    when p_purpose = 'marketing' then 'Withdrew or refused consent to receive the firm''s news. Recorded by staff.'
    when p_granted then 'Agreed that the firm may use these details to reply to this enquiry. Recorded by staff.'
    else 'Asked the firm to stop using these details to reply to this enquiry. Recorded by staff.'
  end;
  insert into public.lead_consents (organization_id, lead_id, purpose, granted, statement_text, statement_sha256, captured_via)
  values (p_org, p_lead, p_purpose, p_granted, v_statement, app.lead_sha256(v_statement), 'staff')
  returning id into v_id;
  perform app.lead_event(p_org, p_lead, 'consent_recorded', null, null, null, jsonb_build_object('purpose', p_purpose, 'granted', p_granted));
  perform app.record_audit_event(p_org, 'lead.consent_recorded', 'public.lead_consents', v_id, 'success',
    jsonb_build_object('lead_id', p_lead, 'purpose', p_purpose, 'granted', p_granted));
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Conflict screen and duplicates
-- ---------------------------------------------------------------------------

-- Records that may conflict with a lead: other leads and client records in the firm that share the
-- name, the email or the phone number. A client's name is shown only to staff who can read that
-- person; otherwise only that a client record matches and on which matters. Not a decision.
create function public.lead_conflict_matches(p_org uuid, p_lead uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  lead public.leads%rowtype;
  v_name text;
  v_phone text;
  leads_found jsonb;
  clients_found jsonb;
begin
  perform app.require_active_staff(p_org, app.lead_staff_roles(), false);
  select * into lead from public.leads l where l.id = p_lead and l.organization_id = p_org;
  if lead.id is null then
    raise exception 'lead not found' using errcode = 'P0002';
  end if;
  v_name := app.lead_match_name(lead.display_name);
  v_phone := app.lead_match_phone(lead.phone);

  select coalesce(jsonb_agg(row_data order by created_at desc), '[]'::jsonb) into leads_found
  from (
    select other.created_at, jsonb_build_object(
      'kind', 'lead',
      'id', other.id,
      'name', other.display_name,
      'stage', stage.label,
      'created_at', other.created_at,
      'matched', to_jsonb(array_remove(array[
        case when app.lead_match_name(other.display_name) = v_name then 'name' end,
        case when other.email is not null and other.email = lead.email then 'email' end,
        case when v_phone is not null and app.lead_match_phone(other.phone) = v_phone then 'phone' end
      ], null))
    ) as row_data
    from public.leads other
    join public.lead_stages stage on stage.id = other.stage_id
    where other.organization_id = p_org
      and other.id <> lead.id
      and (app.lead_match_name(other.display_name) = v_name
           or (other.email is not null and other.email = lead.email)
           or (v_phone is not null and app.lead_match_phone(other.phone) = v_phone))
    order by other.created_at desc
    limit 20
  ) found;

  select coalesce(jsonb_agg(row_data), '[]'::jsonb) into clients_found
  from (
    select jsonb_build_object(
      'kind', 'client',
      'id', case when app.can_read_person(person.id) then person.id end,
      'name', case when app.can_read_person(person.id) then person.display_name end,
      'matched', to_jsonb(array_remove(array[
        case when app.lead_match_name(person.display_name) = v_name then 'name' end,
        case when person.email is not null and person.email = lead.email then 'email' end
      ], null)),
      'matters', coalesce((
        select jsonb_agg(jsonb_build_object('reference', matter.reference, 'role', participant.role) order by matter.created_at)
        from public.matter_participants participant
        join public.matters matter on matter.id = participant.matter_id
        where participant.person_id = person.id
      ), '[]'::jsonb)
    ) as row_data
    from public.persons person
    where person.organization_id = p_org
      and person.id is distinct from lead.converted_person_id
      and (app.lead_match_name(person.display_name) = v_name
           or (person.email is not null and person.email = lead.email))
    limit 20
  ) found;

  perform app.record_audit_event(p_org, 'lead.conflict_searched', 'public.leads', lead.id, 'success',
    jsonb_build_object('leads', jsonb_array_length(leads_found), 'clients', jsonb_array_length(clients_found)));
  return jsonb_build_object('leads', leads_found, 'clients', clients_found);
end;
$$;

create function public.record_lead_conflict_check(
  p_org uuid,
  p_lead uuid,
  p_expected_version integer,
  p_result public.lead_conflict_result,
  p_note text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  lead public.leads;
  v_note text := app.lead_text(p_note, 1200);
  v_version integer;
begin
  lead := app.lead_for_update(p_org, p_lead, p_expected_version);
  if p_result is null or p_result = 'not_checked' then
    raise exception 'choose the conflict check result' using errcode = '22023';
  end if;
  if p_result <> 'clear' and (v_note is null or length(v_note) < 3) then
    raise exception 'say what may conflict in a short note' using errcode = '22023';
  end if;
  if v_note is not null and length(v_note) > 1000 then
    raise exception 'keep the note under 1,000 characters' using errcode = '22023';
  end if;
  if lead.converted_at is not null then
    raise exception 'a converted lead stays converted' using errcode = '22023';
  end if;
  update public.leads
  set conflict_result = p_result, conflict_note = v_note, conflict_checked_at = now(), conflict_checked_by = (select auth.uid())
  where id = lead.id
  returning version into v_version;
  perform app.lead_event(p_org, lead.id, 'conflict_checked', null, null, null, jsonb_build_object('result', p_result));
  perform app.record_audit_event(p_org, 'lead.conflict_checked', 'public.leads', lead.id, 'success', jsonb_build_object('result', p_result));
  return v_version;
end;
$$;

-- A person's answer to "is this the same person?". Same person links this lead to the other
-- lead's person group; nothing is merged, deleted or copied. Different people stops the suggestion.
create function public.decide_lead_duplicate(p_org uuid, p_lead uuid, p_other uuid, p_same_person boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  lead public.leads%rowtype;
  other public.leads%rowtype;
  v_root uuid;
begin
  perform app.require_active_staff(p_org, app.lead_staff_roles(), false);
  if p_same_person is null or p_lead is null or p_other is null or p_lead = p_other then
    raise exception 'choose two leads and an answer' using errcode = '22023';
  end if;
  select * into lead from public.leads l where l.id = p_lead and l.organization_id = p_org for update;
  select * into other from public.leads l where l.id = p_other and l.organization_id = p_org;
  if lead.id is null or other.id is null then
    raise exception 'lead not found' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from public.lead_duplicate_decisions d
    where d.lead_id = least(p_lead, p_other) and d.other_lead_id = greatest(p_lead, p_other)
  ) then
    raise exception 'this pair was already answered' using errcode = '22023';
  end if;
  insert into public.lead_duplicate_decisions (organization_id, lead_id, other_lead_id, same_person)
  values (p_org, least(p_lead, p_other), greatest(p_lead, p_other), p_same_person);
  if p_same_person then
    v_root := coalesce(other.same_person_lead_id, other.id);
    if v_root <> lead.id then
      update public.leads set same_person_lead_id = v_root where id = lead.id;
    end if;
    perform app.lead_event(p_org, lead.id, 'duplicate_same', null, null, null, jsonb_build_object('other_lead_id', other.id));
  else
    perform app.lead_event(p_org, lead.id, 'duplicate_different', null, null, null, jsonb_build_object('other_lead_id', other.id));
  end if;
  perform app.record_audit_event(p_org, 'lead.duplicate_decided', 'public.leads', lead.id, 'success',
    jsonb_build_object('other_lead_id', other.id, 'same_person', p_same_person));
end;
$$;

-- ---------------------------------------------------------------------------
-- Convert to a matter
-- ---------------------------------------------------------------------------

-- Checks before conversion; returns what create_client_matter needs.
create function app.lead_conversion_input(p_org uuid, p_lead uuid, p_expected_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  lead public.leads;
begin
  lead := app.lead_for_update(p_org, p_lead, p_expected_version);
  if lead.converted_at is not null then
    raise exception 'this lead is already converted' using errcode = '22023';
  end if;
  if app.lead_stage_kind_of(lead.stage_id) <> 'open' then
    raise exception 'reopen the lead before converting it' using errcode = '22023';
  end if;
  if lead.conflict_result <> 'clear' then
    raise exception 'record a clear conflict check before converting' using errcode = '22023';
  end if;
  return jsonb_build_object('name', lead.display_name, 'email', lead.email, 'date_of_birth', lead.date_of_birth);
end;
$$;
revoke all on function app.lead_conversion_input(uuid, uuid, integer) from public;
grant execute on function app.lead_conversion_input(uuid, uuid, integer) to authenticated;

-- Marks the lead converted into a matter create_client_matter has just made: the person must be
-- that matter's applicant, and a matter carries at most one lead.
create function app.finish_lead_conversion(p_org uuid, p_lead uuid, p_expected_version integer, p_matter uuid, p_person uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  lead public.leads;
  v_converted uuid;
  v_version integer;
begin
  lead := app.lead_for_update(p_org, p_lead, p_expected_version);
  if lead.converted_at is not null then
    raise exception 'this lead is already converted' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.matter_participants participant
    join public.matters matter on matter.id = participant.matter_id
    where participant.matter_id = p_matter and participant.person_id = p_person and participant.role = 'applicant'
      and matter.organization_id = p_org
      -- made in this same transaction (create_client_matter, a moment ago in convert_lead_to_matter)
      and matter.created_at = now()
  ) then
    raise exception 'the matter was not created for this lead' using errcode = '42501';
  end if;
  v_converted := app.lead_stage_of_kind(p_org, 'converted');
  if v_converted is null then
    raise exception 'this firm has no converted stage' using errcode = 'P0002';
  end if;
  update public.leads
  set stage_id = v_converted, converted_matter_id = p_matter, converted_person_id = p_person, converted_at = now()
  where id = lead.id
  returning version into v_version;
  perform app.lead_event(p_org, lead.id, 'converted', lead.stage_id, v_converted, null, jsonb_build_object('matter_id', p_matter));
  perform app.record_audit_event(p_org, 'lead.converted', 'public.leads', lead.id, 'success', jsonb_build_object('matter_id', p_matter));
  return v_version;
end;
$$;
revoke all on function app.finish_lead_conversion(uuid, uuid, integer, uuid, uuid) from public;
grant execute on function app.finish_lead_conversion(uuid, uuid, integer, uuid, uuid) to authenticated;

-- Invoker: the matter is made by public.create_client_matter as the signed-in staff member.
create function public.convert_lead_to_matter(
  p_org uuid,
  p_lead uuid,
  p_expected_version integer,
  p_consultant_membership_id uuid,
  p_rule_pack_version_id uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  input jsonb;
  created jsonb;
  v_version integer;
begin
  if p_org is distinct from app.current_organization_id() then
    raise exception 'staff access denied' using errcode = '42501';
  end if;
  input := app.lead_conversion_input(p_org, p_lead, p_expected_version);
  created := public.create_client_matter(
    input ->> 'name',
    input ->> 'email',
    null,
    null,
    p_consultant_membership_id,
    p_rule_pack_version_id,
    null,
    (input ->> 'date_of_birth')::date,
    null
  );
  if (created ->> 'ok')::boolean is distinct from true then
    return created;
  end if;
  v_version := app.finish_lead_conversion(p_org, p_lead, p_expected_version,
    (created ->> 'id')::uuid, (created ->> 'applicant_id')::uuid);
  return created || jsonb_build_object('lead_version', v_version);
end;
$$;

-- ---------------------------------------------------------------------------
-- Bookings (CRM-03): a public booking becomes a lead, or is linked to one
-- ---------------------------------------------------------------------------

-- Moves an open lead forward to the consultation stage a booking implies, never backwards.
create function app.lead_advance_for_booking(p_org uuid, p_lead uuid, p_status public.booking_status)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  lead public.leads%rowtype;
  v_current public.lead_stages%rowtype;
  v_target public.lead_stages%rowtype;
begin
  select * into lead from public.leads l where l.id = p_lead and l.organization_id = p_org for update;
  select * into v_current from public.lead_stages s where s.id = lead.stage_id;
  select * into v_target from public.lead_stages s
  where s.organization_id = p_org and s.archived_at is null
    and s.key = case when p_status = 'completed' then 'consultation_completed'
                     when p_status in ('held', 'pending_payment', 'confirmed') then 'consultation_scheduled' end;
  if v_target.id is null or v_current.kind <> 'open' or v_current.position >= v_target.position then
    return;
  end if;
  update public.leads set stage_id = v_target.id where id = lead.id;
  perform app.lead_event(p_org, lead.id, 'stage_changed', v_current.id, v_target.id, 'Consultation booked', '{}'::jsonb);
end;
$$;
revoke all on function app.lead_advance_for_booking(uuid, uuid, public.booking_status) from public;

create function public.link_booking_to_lead(p_org uuid, p_booking uuid, p_lead uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  booking public.bookings%rowtype;
  lead public.leads%rowtype;
begin
  perform app.require_active_staff(p_org, app.lead_staff_roles(), false);
  select * into booking from public.bookings b where b.id = p_booking and b.organization_id = p_org;
  select * into lead from public.leads l where l.id = p_lead and l.organization_id = p_org;
  if booking.id is null then
    raise exception 'booking not found' using errcode = 'P0002';
  end if;
  if lead.id is null then
    raise exception 'lead not found' using errcode = 'P0002';
  end if;
  if lead.converted_at is not null then
    raise exception 'a converted lead stays converted' using errcode = '22023';
  end if;
  if exists (select 1 from public.lead_booking_links link where link.booking_id = booking.id) then
    raise exception 'this booking already belongs to a lead' using errcode = '22023';
  end if;
  insert into public.lead_booking_links (organization_id, lead_id, booking_id) values (p_org, lead.id, booking.id);
  perform app.lead_event(p_org, lead.id, 'booking_linked', null, null, null, jsonb_build_object('booking_id', booking.id));
  perform app.lead_advance_for_booking(p_org, lead.id, booking.status);
  perform app.record_audit_event(p_org, 'lead.booking_linked', 'public.leads', lead.id, 'success', jsonb_build_object('booking_id', booking.id));
end;
$$;

-- A booking from the public page (no client record) becomes a new lead with the attendee's name,
-- email and phone, linked to that booking. No consent row is invented: the booking page does not
-- ask for one, so marketing stays not given.
create function public.create_lead_from_booking(p_org uuid, p_booking uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  booking public.bookings%rowtype;
  attendee public.booking_attendees%rowtype;
  v_stage uuid;
  v_id uuid := gen_random_uuid();
begin
  perform app.require_active_staff(p_org, app.lead_staff_roles(), false);
  select * into booking from public.bookings b where b.id = p_booking and b.organization_id = p_org;
  if booking.id is null then
    raise exception 'booking not found' using errcode = 'P0002';
  end if;
  if booking.person_id is not null then
    raise exception 'this booking is for an existing client' using errcode = '22023';
  end if;
  if exists (select 1 from public.lead_booking_links link where link.booking_id = booking.id) then
    raise exception 'this booking already belongs to a lead' using errcode = '22023';
  end if;
  select * into attendee from public.booking_attendees a where a.booking_id = booking.id and a.role = 'primary';
  if attendee.id is null then
    raise exception 'booking not found' using errcode = 'P0002';
  end if;
  v_stage := app.lead_stage_of_kind(p_org, 'open');
  if v_stage is null then
    raise exception 'this firm has no open lead stage' using errcode = 'P0002';
  end if;
  insert into public.leads (id, organization_id, display_name, email, phone, preferred_contact, source, source_detail, stage_id,
                            owner_membership_id, is_sample)
  values (v_id, p_org, attendee.display_name, attendee.email, attendee.phone, 'email', 'booking_page', left(booking.title, 200), v_stage,
          booking.host_membership_id, booking.is_sample);
  insert into public.lead_booking_links (organization_id, lead_id, booking_id) values (p_org, v_id, booking.id);
  perform app.lead_event(p_org, v_id, 'created', null, v_stage, null, jsonb_build_object('source', 'booking_page'));
  perform app.lead_event(p_org, v_id, 'booking_linked', null, null, null, jsonb_build_object('booking_id', booking.id));
  perform app.lead_advance_for_booking(p_org, v_id, booking.status);
  perform app.record_audit_event(p_org, 'lead.created', 'public.leads', v_id, 'success',
    jsonb_build_object('source', 'booking_page', 'booking_id', booking.id));
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- CSV import (CRM-02)
-- ---------------------------------------------------------------------------

-- Up to 500 rows: name, email, phone, service_interest, source (free text), note. A row that
-- fails a check is skipped and reported; the rest are imported. No consent is recorded: a
-- spreadsheet is not evidence of consent, so marketing stays not given for every imported lead.
create function public.import_leads(p_org uuid, p_file_name text, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stage uuid;
  v_owner uuid := app.lead_my_membership(p_org);
  v_sample boolean;
  v_file text := app.lead_text(p_file_name, 120);
  v_row jsonb;
  v_index integer := 0;
  v_name text;
  v_email text;
  v_phone text;
  v_problem text;
  v_id uuid;
  v_note text;
  imported integer := 0;
  skipped jsonb := '[]'::jsonb;
begin
  perform app.require_active_staff(p_org, app.lead_staff_roles(), false);
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'the file has no rows to import' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 500 then
    raise exception 'import up to 500 rows at a time' using errcode = '22023';
  end if;
  v_stage := app.lead_stage_of_kind(p_org, 'open');
  if v_stage is null then
    raise exception 'this firm has no open lead stage' using errcode = 'P0002';
  end if;
  select org.sample_mode into v_sample from public.organizations org where org.id = p_org;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_index := v_index + 1;
    if jsonb_typeof(v_row) <> 'object' then
      skipped := skipped || jsonb_build_object('row', v_index, 'reason', 'not a row');
      continue;
    end if;
    v_name := app.lead_text(v_row ->> 'name', 400);
    v_email := lower(app.lead_text(v_row ->> 'email', 400));
    v_phone := app.lead_text(v_row ->> 'phone', 60);
    v_problem := app.lead_contact_problem(v_name, v_email, v_phone);
    if v_problem is null and v_email is null and v_phone is null then
      v_problem := 'add an email address or a phone number';
    end if;
    if v_problem is not null then
      skipped := skipped || jsonb_build_object('row', v_index, 'reason', v_problem);
      continue;
    end if;
    v_id := gen_random_uuid();
    insert into public.leads (id, organization_id, display_name, email, phone, preferred_contact, service_interest, source, source_detail,
                              stage_id, owner_membership_id, is_sample)
    values (v_id, p_org, v_name, v_email, v_phone, case when v_email is not null then 'email' else 'phone' end,
            app.lead_text(v_row ->> 'service_interest', 120), 'csv_import',
            coalesce(app.lead_text(v_row ->> 'source', 200), v_file), v_stage, v_owner, coalesce(v_sample, false));
    v_note := app.lead_text(v_row ->> 'note', 4000);
    if v_note is not null then
      insert into public.lead_notes (organization_id, lead_id, body) values (p_org, v_id, v_note);
    end if;
    perform app.lead_event(p_org, v_id, 'created', null, v_stage, null, jsonb_build_object('source', 'csv_import', 'row', v_index));
    imported := imported + 1;
  end loop;
  perform app.record_audit_event(p_org, 'lead.imported', 'public.leads', null, 'success',
    jsonb_build_object('imported', imported, 'skipped', jsonb_array_length(skipped), 'file', v_file));
  return jsonb_build_object('imported', imported, 'skipped', skipped);
end;
$$;

-- ---------------------------------------------------------------------------
-- Public enquiry (CRM-01, PRD §11 POST /leads)
-- ---------------------------------------------------------------------------

-- Minimal enquiry from the firm's hosted page or embedded form. Returns {"ok": true} or
-- {"error": code} for a refusal the visitor can act on (enquiry_rate_limited, name_required,
-- contact_required, email_invalid, phone_invalid, consent_required). Unknown firm, a firm in sample
-- mode, or a firm without a published privacy notice: {"error": "form_unavailable"}.
create function public.submit_enquiry(
  p_firm_slug text,
  p_name text,
  p_contact text,
  p_preferred_contact text,
  p_service_interest text,
  p_country_now text,
  p_language text,
  p_reply_consent boolean,
  p_reply_statement text,
  p_marketing_consent boolean,
  p_marketing_statement text,
  p_consent_version text,
  p_source public.lead_source,
  p_idempotency_key text,
  p_client_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  org public.organizations%rowtype;
  key text := btrim(coalesce(p_idempotency_key, ''));
  hash text := nullif(lower(btrim(coalesce(p_client_hash, ''))), '');
  v_name text := app.lead_text(p_name, 400);
  v_contact text := app.lead_text(p_contact, 400);
  v_email text;
  v_phone text;
  v_problem text;
  v_stage uuid;
  v_id uuid := gen_random_uuid();
  v_via text;
  v_version text := app.lead_text(p_consent_version, 40);
begin
  select * into org from public.organizations o where o.slug = lower(btrim(coalesce(p_firm_slug, '')));
  if org.id is null or org.sample_mode is true or not exists (
    select 1 from public.portal_policy_documents doc where doc.organization_id = org.id and doc.kind = 'privacy_notice'
  ) then
    return jsonb_build_object('error', 'form_unavailable');
  end if;
  if p_source is null or p_source not in ('web_form', 'hosted_page') then
    raise exception 'choose the form' using errcode = '22023';
  end if;
  if length(key) not between 8 and 180 then
    raise exception 'idempotency key is required' using errcode = '22023';
  end if;
  if hash is not null and hash !~ '^[0-9a-f]{64}$' then
    hash := null;
  end if;
  if v_version is not null and v_version !~ '^[A-Za-z0-9._-]{1,40}$' then
    v_version := null;
  end if;
  if exists (select 1 from public.leads l where l.organization_id = org.id and l.submission_key = key) then
    return jsonb_build_object('ok', true);
  end if;

  -- Abuse limits: 5 enquiries per client address and 100 per firm in 10 minutes.
  insert into public.lead_enquiry_attempts (organization_id, client_hash) values (org.id, hash);
  if (hash is not null and (
        select count(*) from public.lead_enquiry_attempts a
        where a.client_hash = hash and a.created_at > now() - interval '10 minutes') > 5)
     or (select count(*) from public.lead_enquiry_attempts a
         where a.organization_id = org.id and a.created_at > now() - interval '10 minutes') > 100 then
    return jsonb_build_object('error', 'enquiry_rate_limited');
  end if;

  if v_name is null or length(v_name) > 200 then
    return jsonb_build_object('error', 'name_required');
  end if;
  if v_contact is null then
    return jsonb_build_object('error', 'contact_required');
  end if;
  if position('@' in v_contact) > 0 then
    v_email := lower(v_contact);
  else
    v_phone := v_contact;
  end if;
  v_problem := app.lead_contact_problem(v_name, v_email, v_phone);
  if v_problem is not null then
    return jsonb_build_object('error', case when v_email is not null then 'email_invalid' else 'phone_invalid' end);
  end if;
  if p_reply_consent is distinct from true or app.lead_text(p_reply_statement, 600) is null then
    return jsonb_build_object('error', 'consent_required');
  end if;
  if length(p_reply_statement) > 500 or (p_marketing_consent is true and (p_marketing_statement is null or length(p_marketing_statement) not between 1 and 500)) then
    raise exception 'consent statement is invalid' using errcode = '22023';
  end if;
  v_stage := app.lead_stage_of_kind(org.id, 'open');
  if v_stage is null then
    return jsonb_build_object('error', 'form_unavailable');
  end if;
  v_via := p_source::text;

  insert into public.leads (id, organization_id, display_name, email, phone, preferred_contact, service_interest, country_now, language,
                            source, stage_id, submission_key, is_sample)
  values (v_id, org.id, v_name, v_email, v_phone,
          case when p_preferred_contact in ('email', 'phone') then p_preferred_contact end,
          app.lead_text(p_service_interest, 120), app.lead_text(p_country_now, 100), app.lead_text(p_language, 100),
          p_source, v_stage, key, false);
  insert into public.lead_consents (organization_id, lead_id, purpose, granted, statement_text, statement_sha256, policy_version, captured_via)
  values (org.id, v_id, 'enquiry_reply', true, p_reply_statement, app.lead_sha256(p_reply_statement), v_version, v_via);
  if p_marketing_consent is true then
    insert into public.lead_consents (organization_id, lead_id, purpose, granted, statement_text, statement_sha256, policy_version, captured_via)
    values (org.id, v_id, 'marketing', true, p_marketing_statement, app.lead_sha256(p_marketing_statement), v_version, v_via);
  end if;
  perform app.lead_event(org.id, v_id, 'created', null, v_stage, null, jsonb_build_object('source', p_source));
  insert into public.audit_log (organization_id, actor_user_id, actor_type, action, object_table, object_id, result, request_id, context)
  values (org.id, (select auth.uid()), app.current_actor_type(), 'lead.enquiry_received', 'public.leads', v_id, 'success',
          app.current_request_id(), jsonb_build_object('source', p_source, 'marketing', coalesce(p_marketing_consent, false)));
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke all on function public.create_lead(uuid, text, text, text, text, text, text, text, public.lead_source, text, uuid, bigint, text[], text, boolean, boolean) from public, anon;
revoke all on function public.update_lead(uuid, uuid, integer, text, text, text, text, text, text, text, date, text, uuid, bigint, text[]) from public, anon;
revoke all on function public.move_lead_stage(uuid, uuid, uuid, integer, text) from public, anon;
revoke all on function public.close_lead_lost(uuid, uuid, integer, text) from public, anon;
revoke all on function public.save_lead_stage(uuid, uuid, text, integer) from public, anon;
revoke all on function public.archive_lead_stage(uuid, uuid) from public, anon;
revoke all on function public.add_lead_note(uuid, uuid, text) from public, anon;
revoke all on function public.add_lead_follow_up(uuid, uuid, text, uuid, date) from public, anon;
revoke all on function public.complete_lead_follow_up(uuid, uuid) from public, anon;
revoke all on function public.record_lead_consent(uuid, uuid, public.lead_consent_purpose, boolean) from public, anon;
revoke all on function public.lead_conflict_matches(uuid, uuid) from public, anon;
revoke all on function public.record_lead_conflict_check(uuid, uuid, integer, public.lead_conflict_result, text) from public, anon;
revoke all on function public.decide_lead_duplicate(uuid, uuid, uuid, boolean) from public, anon;
revoke all on function public.convert_lead_to_matter(uuid, uuid, integer, uuid, uuid) from public, anon;
revoke all on function public.link_booking_to_lead(uuid, uuid, uuid) from public, anon;
revoke all on function public.create_lead_from_booking(uuid, uuid) from public, anon;
revoke all on function public.import_leads(uuid, text, jsonb) from public, anon;
revoke all on function public.submit_enquiry(text, text, text, text, text, text, text, boolean, text, boolean, text, text, public.lead_source, text, text) from public;

grant execute on function public.create_lead(uuid, text, text, text, text, text, text, text, public.lead_source, text, uuid, bigint, text[], text, boolean, boolean) to authenticated;
grant execute on function public.update_lead(uuid, uuid, integer, text, text, text, text, text, text, text, date, text, uuid, bigint, text[]) to authenticated;
grant execute on function public.move_lead_stage(uuid, uuid, uuid, integer, text) to authenticated;
grant execute on function public.close_lead_lost(uuid, uuid, integer, text) to authenticated;
grant execute on function public.save_lead_stage(uuid, uuid, text, integer) to authenticated;
grant execute on function public.archive_lead_stage(uuid, uuid) to authenticated;
grant execute on function public.add_lead_note(uuid, uuid, text) to authenticated;
grant execute on function public.add_lead_follow_up(uuid, uuid, text, uuid, date) to authenticated;
grant execute on function public.complete_lead_follow_up(uuid, uuid) to authenticated;
grant execute on function public.record_lead_consent(uuid, uuid, public.lead_consent_purpose, boolean) to authenticated;
grant execute on function public.lead_conflict_matches(uuid, uuid) to authenticated;
grant execute on function public.record_lead_conflict_check(uuid, uuid, integer, public.lead_conflict_result, text) to authenticated;
grant execute on function public.decide_lead_duplicate(uuid, uuid, uuid, boolean) to authenticated;
grant execute on function public.convert_lead_to_matter(uuid, uuid, integer, uuid, uuid) to authenticated;
grant execute on function public.link_booking_to_lead(uuid, uuid, uuid) to authenticated;
grant execute on function public.create_lead_from_booking(uuid, uuid) to authenticated;
grant execute on function public.import_leads(uuid, text, jsonb) to authenticated;
grant execute on function public.submit_enquiry(text, text, text, text, text, text, text, boolean, text, boolean, text, text, public.lead_source, text, text) to anon, authenticated;
