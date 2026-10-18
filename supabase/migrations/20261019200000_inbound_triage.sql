-- Sheet Inbox, "Email to triage" (OPS-06, T034). Staff file an inbound email to a matter and a
-- person, or dismiss it as not case mail. Filing never gives the sender portal access.
--
-- Consultant scope: before this, every staff role in the firm could read every inbound email,
-- inbox file and reply address, whatever the matter. Mail linked to a matter is now visible
-- only to staff who can read that matter (app.can_read_matter: the firm owner, staff assigned
-- to it, or its creator). Mail with no matter yet stays visible to the firm's staff, because
-- someone has to triage it. Delivery rows (email_deliveries) about a matter get the same scope.
--
-- Redefined: public.assign_unsorted_email_file (latest definition in
-- 20261017200200_inbound_email.sql). Added: the inbox file's email must be readable by the
-- caller and not dismissed, and once the email is filed the file can only go to that email's
-- matter and person; a copy that never finished may be retried; the assignment is audited.
-- Everything else is unchanged.
-- Additive only.

alter table public.inbound_emails
  add column triage_state text not null default 'open'
    check (triage_state in ('open', 'filed', 'dismissed')),
  add column triaged_at timestamptz,
  add column triaged_by uuid references auth.users (id),
  add column triage_note text check (triage_note is null or length(btrim(triage_note)) between 1 and 300);
comment on column public.inbound_emails.triage_state is
  'open: waits in Email to triage. filed: staff (or a verified sender match) linked it to a matter and person. dismissed: not case mail.';

create index inbound_emails_triaged_by_idx on public.inbound_emails (triaged_by);
create index inbound_emails_org_triage_idx on public.inbound_emails (organization_id, triage_state, created_at);

-- Mail the worker already matched to a verified sender is filed.
update public.inbound_emails
set triage_state = 'filed'
where person_id is not null
  and triage_state = 'open';

create function app.inbound_email_triage_default()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.person_id is not null then
    new.triage_state := 'filed';
  end if;
  return new;
end;
$$;
revoke all on function app.inbound_email_triage_default() from public;

create trigger inbound_emails_triage_default before insert on public.inbound_emails
  for each row execute function app.inbound_email_triage_default();

-- True when the signed-in staff member may read this inbound email.
create function app.can_read_inbound_email(p_email_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.inbound_emails email
    where email.id = p_email_id
      and email.organization_id = (select app.current_organization_id())
      and app.staff_mfa_satisfied()
      and app.has_org_role(
        email.organization_id,
        array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[]
      )
      and (email.matter_id is null or app.can_read_matter(email.matter_id))
  );
$$;
revoke all on function app.can_read_inbound_email(uuid) from public;
grant execute on function app.can_read_inbound_email(uuid) to authenticated, service_role;

alter policy inbound_emails_select on public.inbound_emails
  using (
    organization_id = (select app.current_organization_id())
    and (select app.can_read_inbound_email(id))
  );

alter policy inbound_inbox_items_select on public.inbound_inbox_items
  using (
    organization_id = (select app.current_organization_id())
    and (select app.can_read_inbound_email(inbound_email_id))
    and (matter_id is null or (select app.can_read_matter(matter_id)))
  );

alter policy inbound_attachment_files_select on public.inbound_attachment_files
  using (
    organization_id = (select app.current_organization_id())
    and (select app.can_read_inbound_email(inbound_email_id))
  );

alter policy matter_reply_addresses_select on public.matter_reply_addresses
  using (
    organization_id = (select app.current_organization_id())
    and (select app.staff_mfa_satisfied())
    and (select app.has_org_role(
      organization_id,
      array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[]
    ))
    and (select app.can_read_matter(matter_id))
  );

-- Delivery problems (Inbox tab): a notice about a matter is visible only to staff who can read it.
alter policy email_deliveries_select on public.email_deliveries
  using (
    organization_id = (select app.current_organization_id())
    and (select app.staff_mfa_satisfied())
    and (select app.has_org_role(
      organization_id,
      array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[]
    ))
    and (matter_id is null or (select app.can_read_matter(matter_id)))
  );

-- File an email to a matter and one of its people. Its clean inbox files then become
-- documents through public.assign_unsorted_email_file. Staff with step-up only.
create function public.file_inbound_email(
  p_email_id uuid,
  p_matter_id uuid,
  p_person_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  email public.inbound_emails%rowtype;
  matter public.matters%rowtype;
  items jsonb;
begin
  select * into email from public.inbound_emails where id = p_email_id for update;
  if email.id is null or app.can_read_inbound_email(email.id) is distinct from true then
    raise exception 'inbound email denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    email.organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[],
    true
  );
  if email.triage_state is distinct from 'open' then
    raise exception 'this email was already triaged' using errcode = '22023';
  end if;
  if email.attachments_done is distinct from true then
    raise exception 'this email is still arriving' using errcode = '22023';
  end if;
  select * into matter from public.matters where id = p_matter_id;
  if matter.id is null
     or matter.organization_id is distinct from email.organization_id
     or app.can_read_matter(matter.id) is distinct from true then
    raise exception 'inbound email denied' using errcode = '42501';
  end if;
  if app.sample_mode_blocks_real(matter.organization_id, matter.is_sample) then
    raise exception 'inbound email denied' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.matter_participants party
    join public.persons person
      on person.id = party.person_id
     and person.organization_id = party.organization_id
    where party.matter_id = matter.id
      and party.organization_id = matter.organization_id
      and person.id = p_person_id
      and person.is_sample is not distinct from matter.is_sample
  ) then
    raise exception 'that person is not on this matter' using errcode = '42501';
  end if;

  update public.inbound_emails
  set matter_id = matter.id,
      person_id = p_person_id,
      triage_state = 'filed',
      triaged_at = statement_timestamp(),
      triaged_by = (select auth.uid())
  where id = email.id;

  update public.inbound_inbox_items
  set matter_id = matter.id
  where inbound_email_id = email.id
    and assigned_version_id is null;

  select coalesce(jsonb_agg(item.id order by item.created_at), '[]'::jsonb) into items
  from public.inbound_inbox_items item
  where item.inbound_email_id = email.id
    and item.upload_state = 'clean'
    and item.assigned_version_id is null;

  perform app.record_audit_event(
    email.organization_id, 'email.filed', 'public.inbound_emails', email.id, 'success',
    jsonb_build_object('matter_id', matter.id, 'person_id', p_person_id, 'sender_verified', email.sender_verified)
  );
  return jsonb_build_object('inbound_email_id', email.id, 'matter_id', matter.id, 'person_id', p_person_id, 'items', items);
end;
$$;
revoke all on function public.file_inbound_email(uuid, uuid, uuid) from public, anon;
grant execute on function public.file_inbound_email(uuid, uuid, uuid) to authenticated, service_role;

-- "Not case mail": the email leaves triage. Its files stay unassigned and are never opened.
create function public.dismiss_inbound_email(p_email_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  email public.inbound_emails%rowtype;
begin
  select * into email from public.inbound_emails where id = p_email_id for update;
  if email.id is null or app.can_read_inbound_email(email.id) is distinct from true then
    raise exception 'inbound email denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    email.organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[],
    false
  );
  if email.triage_state is distinct from 'open' then
    raise exception 'this email was already triaged' using errcode = '22023';
  end if;
  update public.inbound_emails
  set triage_state = 'dismissed',
      triaged_at = statement_timestamp(),
      triaged_by = (select auth.uid()),
      triage_note = left(nullif(btrim(coalesce(p_note, '')), ''), 300)
  where id = email.id;
  perform app.record_audit_event(
    email.organization_id, 'email.dismissed', 'public.inbound_emails', email.id, 'success', '{}'::jsonb
  );
end;
$$;
revoke all on function public.dismiss_inbound_email(uuid, text) from public, anon;
grant execute on function public.dismiss_inbound_email(uuid, text) to authenticated, service_role;

create or replace function public.assign_unsorted_email_file(
  p_item_id uuid,
  p_matter_id uuid,
  p_person_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  item public.inbound_inbox_items%rowtype;
  email public.inbound_emails%rowtype;
  intent jsonb;
begin
  select * into item from public.inbound_inbox_items where id = p_item_id;
  if item.id is null or app.can_read_inbound_email(item.inbound_email_id) is distinct from true then
    raise exception 'inbox file was not found' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    item.organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[],
    true
  );
  select * into email from public.inbound_emails where id = item.inbound_email_id;
  if email.triage_state = 'dismissed' then
    raise exception 'inbox file was dismissed' using errcode = '42501';
  end if;
  if email.triage_state = 'filed'
     and (email.matter_id is distinct from p_matter_id or email.person_id is distinct from p_person_id) then
    raise exception 'inbox file belongs to its filed matter' using errcode = '42501';
  end if;
  if item.upload_state is distinct from 'clean' then
    raise exception 'only a clean inbox file can be assigned' using errcode = '42501';
  end if;
  -- A copy that never finished (its upload authorization expired, or the check failed) may be retried.
  if item.assigned_version_id is not null and not exists (
    select 1
    from public.document_versions version
    where version.id = item.assigned_version_id
      and (
        version.upload_state = 'failed'
        or (version.upload_state = 'uploading' and version.intent_expires_at <= statement_timestamp())
      )
  ) then
    raise exception 'inbox file is already assigned' using errcode = '42501';
  end if;
  intent := app.create_upload_intent(
    p_matter_id, p_person_id, item.filename, item.byte_size, 'Email attachment',
    'ordinary'::public.document_sensitivity, 'subject'::public.document_audience,
    null, null, null
  );
  update public.inbound_inbox_items
     set assigned_version_id = (intent ->> 'version_id')::uuid
   where id = item.id;
  perform app.record_audit_event(
    item.organization_id, 'email.attachment_assigned', 'public.inbound_inbox_items', item.id, 'success',
    jsonb_build_object('version_id', intent ->> 'version_id', 'matter_id', p_matter_id)
  );
  return intent || jsonb_build_object('source_storage_key', item.storage_key, 'inbox_item_id', item.id);
end;
$$;

-- Fix: app.resolve_inbound_address (only definition: 20261017200200_inbound_email.sql) named a
-- variable "token", the same as matter_reply_addresses.token, so every plus-addressed matter
-- reply failed with "column reference token is ambiguous". Only the variable is renamed.
create or replace function app.resolve_inbound_address(p_to text, p_domain text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  raw text := lower(btrim(coalesce(p_to, '')));
  domain text := app.inbound_domain(p_domain);
  local_part text;
  firm_slug text;
  plus_token text;
  org uuid;
  matter uuid;
begin
  if strpos(raw, '@') = 0 or split_part(raw, '@', 2) is distinct from domain or split_part(raw, '@', 3) <> '' then
    return jsonb_build_object('status', 'bad_address');
  end if;
  local_part := split_part(raw, '@', 1);
  if local_part ~ '^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])\+[a-f0-9]{32}$' then
    firm_slug := split_part(local_part, '+', 1);
    plus_token := split_part(local_part, '+', 2);
  elsif local_part ~ '^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$' then
    firm_slug := local_part;
    plus_token := null;
  else
    return jsonb_build_object('status', 'bad_address');
  end if;
  if firm_slug = any (app.reserved_firm_slugs()) then
    return jsonb_build_object('status', 'reserved', 'slug', firm_slug);
  end if;
  select id into org from public.organizations where organizations.slug = firm_slug;
  if org is null then
    return jsonb_build_object('status', 'unknown_firm', 'slug', firm_slug);
  end if;
  if plus_token is not null then
    select reply.matter_id into matter
    from public.matter_reply_addresses reply
    where reply.organization_id = org
      and reply.token = plus_token;
  end if;
  return jsonb_build_object(
    'status', 'ok',
    'organization_id', org,
    'matter_id', matter,
    'slug', firm_slug
  );
end;
$$;
revoke all on function app.resolve_inbound_address(text, text) from public;
