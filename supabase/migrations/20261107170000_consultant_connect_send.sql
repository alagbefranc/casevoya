-- Human Send for find.casevoya.ca introductions.
--
-- 20261107160000 stores a consented request as New and grants no UPDATE. This migration
-- widens status to New or Sent and adds the platform function that creates exactly one
-- lead in one firm the firm owner has opted into. It does not email, text, or enqueue
-- an outbox event. It does not match or broadcast.
--
-- Apply after 20261107160000. Do not apply this file on its own.
--
-- Rollback, only while no row is Sent and no lead_consents.captured_via is 'find':
--   revoke and drop public.platform_send_consultant_connect(uuid, uuid, uuid);
--   revoke and drop public.platform_consultant_connect_requests(text, integer, integer);
--   revoke and drop public.platform_find_introduction_firms();
--   revoke and drop public.set_accept_find_introductions(boolean);
--   drop function app.find_introduction_block(uuid);
--   alter table public.consultant_connect_requests drop constraint consultant_connect_requests_sent_ck;
--   alter table public.consultant_connect_requests drop constraint consultant_connect_requests_status_check;
--   drop index if exists public.consultant_connect_requests_lead_uidx;
--   alter table public.consultant_connect_requests
--     drop column sent_by, drop column sent_at, drop column lead_id, drop column organization_id;
--   alter table public.consultant_connect_requests
--     add constraint consultant_connect_requests_status_check check (status = 'New');
--   alter table public.organizations drop column accept_find_introductions;
--   alter table public.lead_consents drop constraint lead_consents_captured_via_check;
--   alter table public.lead_consents add constraint lead_consents_captured_via_check
--     check (captured_via in ('web_form', 'hosted_page', 'staff', 'booking_page'));

alter table public.organizations
  add column accept_find_introductions boolean not null default false;

comment on column public.organizations.accept_find_introductions is
  'True only after the firm owner opts in to receive a Casevoya introduction. Default off. Checked again at Send. Not a directory listing.';

-- Firm owner, current firm, recent step-up. No mail.
create function public.set_accept_find_introductions(p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid := app.current_organization_id();
begin
  perform app.require_firm_owner_step_up(org);
  if p_enabled is null then
    raise exception 'Choose whether this firm accepts introductions.' using errcode = '22023';
  end if;
  update public.organizations set accept_find_introductions = p_enabled where id = org;
  perform app.record_audit_event(
    org,
    'firm.find_introductions_changed',
    'public.organizations',
    org,
    'success',
    jsonb_build_object('accept_find_introductions', p_enabled)
  );
end;
$$;

revoke all on function public.set_accept_find_introductions(boolean) from public, anon;
grant execute on function public.set_accept_find_introductions(boolean) to authenticated;

comment on function public.set_accept_find_introductions(boolean) is
  'Firm owner opts this firm in or out of Casevoya introductions. Does not create a lead and does not send mail.';

-- Why Send must refuse this firm right now. Null means the firm is eligible.
create function app.find_introduction_block(p_org uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  org public.organizations%rowtype;
begin
  select * into org from public.organizations where id = p_org;
  if org.id is null then
    return 'That firm was not found.';
  end if;
  if org.accept_find_introductions is not true then
    return 'This firm is not accepting introductions.';
  end if;
  if org.sample_mode is true then
    return 'Sample firms cannot receive an introduction.';
  end if;
  if app.lead_stage_of_kind(p_org, 'open') is null then
    return 'This firm has no open lead stage.';
  end if;
  if not exists (
    select 1
    from public.memberships m
    join public.consultant_credentials c
      on c.membership_id = m.id and c.organization_id = m.organization_id
    where m.organization_id = p_org
      and m.status = 'active'
      and m.role in ('firm_owner', 'licensed_consultant')
      and c.status = 'verified'
      and c.discipline_suspended is not true
      and c.discipline_revoked is not true
      and c.entitlement_to_practise is distinct from false
  ) then
    return 'This firm has no verified licence on file.';
  end if;
  return null;
end;
$$;

revoke all on function app.find_introduction_block(uuid) from public, anon, authenticated;

alter table public.lead_consents drop constraint lead_consents_captured_via_check;
alter table public.lead_consents add constraint lead_consents_captured_via_check
  check (captured_via in ('web_form', 'hosted_page', 'staff', 'booking_page', 'find'));

alter table public.consultant_connect_requests drop constraint consultant_connect_requests_status_check;

alter table public.consultant_connect_requests
  add column organization_id uuid references public.organizations (id),
  add column lead_id uuid references public.leads (id),
  add column sent_at timestamptz,
  add column sent_by uuid references auth.users (id);

alter table public.consultant_connect_requests
  add constraint consultant_connect_requests_status_check check (status in ('New', 'Sent'));

alter table public.consultant_connect_requests
  add constraint consultant_connect_requests_sent_ck check (
    (status = 'New' and organization_id is null and lead_id is null and sent_at is null and sent_by is null)
    or (status = 'Sent' and organization_id is not null and lead_id is not null and sent_at is not null and sent_by is not null)
  );

create unique index consultant_connect_requests_lead_uidx
  on public.consultant_connect_requests (lead_id) where lead_id is not null;

comment on table public.consultant_connect_requests is
  'find.casevoya.ca introduction requests. New until a platform operator sends one request to one opted-in firm, which creates one lead and sets Sent. Not a directory and not a fee.';

comment on column public.consultant_connect_requests.status is
  'New on insert. Sent only through public.platform_send_consultant_connect, which also stores the firm and the lead. There is still no UPDATE grant.';

-- Service role. Omits the address hash and user agent.
create function public.platform_consultant_connect_requests(
  p_state text default 'new',
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  items jsonb;
  counts jsonb;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_state is not null and p_state not in ('new', 'sent') then
    raise exception 'State is new or sent.' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(row_to_json(x) order by x.submitted_at desc), '[]'::jsonb) into items
  from (
    select r.id, r.status, r.goal, r.country, r.code, r.zone, r.language, r.name, r.email,
           r.submitted_at, r.organization_id, org.display_name as firm_name, r.lead_id, r.sent_at
    from public.consultant_connect_requests r
    left join public.organizations org on org.id = r.organization_id
    where p_state is null or (p_state = 'new') = (r.status = 'New')
    order by r.submitted_at desc
    limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0)
  ) x;
  select jsonb_build_object(
    'new', count(*) filter (where status = 'New'),
    'sent', count(*) filter (where status = 'Sent')
  ) into counts
  from public.consultant_connect_requests;
  return jsonb_build_object('items', items, 'counts', counts);
end;
$$;

revoke all on function public.platform_consultant_connect_requests(text, integer, integer) from public, anon, authenticated;
grant execute on function public.platform_consultant_connect_requests(text, integer, integer) to service_role;

-- Firms that would pass Send right now. Names only.
create function public.platform_find_introduction_firms()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  items jsonb;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(row_to_json(x) order by x.display_name), '[]'::jsonb) into items
  from (
    select org.id, org.display_name
    from public.organizations org
    where app.find_introduction_block(org.id) is null
    order by org.display_name
    limit 100
  ) x;
  return jsonb_build_object('items', items);
end;
$$;

revoke all on function public.platform_find_introduction_firms() from public, anon, authenticated;
grant execute on function public.platform_find_introduction_firms() to service_role;

-- One request, one firm, one lead. A repeat for the same firm returns that lead.
-- A different firm is refused. No outbox row and no email.
create function public.platform_send_consultant_connect(
  p_request uuid,
  p_org uuid,
  p_admin_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  req public.consultant_connect_requests%rowtype;
  block text;
  v_stage uuid;
  v_lead uuid;
  v_email text;
  detail text := 'Casevoya introduction';
  role text;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_admin_user_id is null then
    raise exception 'Choose a platform operator.' using errcode = '42501';
  end if;
  select pa.role into role from public.platform_admins pa where pa.user_id = p_admin_user_id;
  if role is null or role not in ('owner', 'operator') then
    raise exception 'Choose a platform operator.' using errcode = '42501';
  end if;
  if p_request is null or p_org is null then
    raise exception 'Choose a request and one firm.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('consultant-connect-send:' || p_request::text));
  select * into req from public.consultant_connect_requests where id = p_request for update;
  if req.id is null then
    raise exception 'That request was not found.' using errcode = 'P0002';
  end if;
  if req.status = 'Sent' and req.organization_id = p_org then
    return jsonb_build_object(
      'id', req.id,
      'status', 'Sent',
      'organization_id', req.organization_id,
      'lead_id', req.lead_id,
      'replayed', true
    );
  end if;
  if req.status = 'Sent' then
    raise exception 'This request was already sent to another firm.' using errcode = '55000';
  end if;
  if req.status is distinct from 'New' then
    raise exception 'This request cannot be sent.' using errcode = '55000';
  end if;

  block := app.find_introduction_block(p_org);
  if block is not null then
    raise exception '%', block using errcode = '22023';
  end if;

  v_email := lower(btrim(req.email));
  v_stage := app.lead_stage_of_kind(p_org, 'open');
  v_lead := gen_random_uuid();

  insert into public.leads (
    id, organization_id, display_name, email, preferred_contact, service_interest, country_now, language,
    source, source_detail, stage_id, submission_key, is_sample
  ) values (
    v_lead, p_org, btrim(req.name), v_email, 'email', btrim(req.goal), btrim(req.country), btrim(req.language),
    'other', detail, v_stage, 'find:' || req.id::text, false
  );

  insert into public.lead_consents (
    organization_id, lead_id, purpose, granted, statement_text, statement_sha256, policy_version, captured_via
  ) values (
    p_org, v_lead, 'enquiry_reply', true, req.consent_statement, app.lead_sha256(req.consent_statement),
    req.consent_version, 'find'
  );

  perform app.lead_event(p_org, v_lead, 'created', null, v_stage, null, jsonb_build_object('source', 'other', 'via', 'find'));
  perform app.record_audit_event(
    p_org, 'lead.created', 'public.leads', v_lead, 'success',
    jsonb_build_object('source', 'other', 'via', 'find', 'request_id', req.id)
  );

  update public.consultant_connect_requests
     set status = 'Sent',
         organization_id = p_org,
         lead_id = v_lead,
         sent_at = clock_timestamp(),
         sent_by = p_admin_user_id
   where id = req.id and status = 'New';
  if not found then
    raise exception 'This request was already sent.' using errcode = '55000';
  end if;

  perform public.platform_admin_record_audit(
    p_admin_user_id,
    'admin_portal.find_introduction.sent',
    'public.consultant_connect_requests',
    req.id,
    p_org,
    'success',
    jsonb_build_object('lead_id', v_lead, 'replayed', false)
  );

  return jsonb_build_object(
    'id', req.id,
    'status', 'Sent',
    'organization_id', p_org,
    'lead_id', v_lead,
    'replayed', false
  );
end;
$$;

revoke all on function public.platform_send_consultant_connect(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.platform_send_consultant_connect(uuid, uuid, uuid) to service_role;

comment on function public.platform_send_consultant_connect(uuid, uuid, uuid) is
  'Platform operator sends one New introduction to one currently opted-in firm and creates one lead. A repeat for that firm returns the same lead. Does not email or enqueue outbox.';
