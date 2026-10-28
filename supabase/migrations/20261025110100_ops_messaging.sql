-- OPS-04 (#179): messaging. Firm message templates with merge fields, announcements to many
-- clients, and external participants (employer, sponsor) in a thread only with portal access.
-- Additive only.
--
-- Tables (RLS forced; staff read, writes only through the functions below)
--   message_templates          the firm's own message and announcement templates. Draft until a
--                              firm owner or licensed consultant approves; an edit makes it a
--                              draft again. Merge fields: {client_first_name}, {matter_reference},
--                              {firm_name}, {consultant_name} (a message); {firm_name} only (an
--                              announcement, which goes to many people at once).
--   announcements              one announcement as sent: the approved template's text with the
--                              firm name merged, its audience, and the counts. Append-only.
--   announcement_deliveries    one row per client it went to: emailed or not, seen and dismissed
--                              in the portal. Clients read their own only through
--                              portal_notices_for_me (no client policy).
--
-- Functions
--   save_message_template / approve_message_template / archive_message_template
--   announcement_audiences       staff: how many clients each audience reaches, before sending.
--   send_announcement            firm owner or licensed consultant: sends an approved
--                                announcement template to all active clients or one program's.
--                                Clients = people with a portal account on the firm's open
--                                matters (sample matters only while the firm is in sample mode).
--                                One send per firm per 10 minutes (refusal audited). Audited.
--                                Queues announcement.sent (EX19) unless no one is emailed; a
--                                sample-mode firm emails no one.
--   mark_portal_announcements_seen   the signed-in client: their announcements were shown.
--   portal_notices_for_me / dismiss_portal_notice   redefined (from 20261024120100): announcements
--                                are portal notices too (kind 'announcement').
--   claim_mail_events / prepare_email_delivery      redefined (from 20261024150100): + EX19.
--
-- External participants: a trigger on message_thread_people refuses to add an employer or sponsor
-- (someone on the matter only in those roles) without a portal account to a conversation started
-- by a signed-in user. send_matter_message is unchanged.

-- ---------------------------------------------------------------------------
-- Message templates
-- ---------------------------------------------------------------------------

create table public.message_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  use_for text not null check (use_for in ('message', 'announcement')),
  name text not null check (length(btrim(name)) between 1 and 120),
  title text check (title is null or length(btrim(title)) between 1 and 120),
  body text not null check (length(btrim(body)) between 1 and 4000),
  status text not null default 'draft' check (status in ('draft', 'approved', 'archived')),
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id),
  approved_by_membership_id uuid,
  approved_at timestamptz,
  unique (id, organization_id),
  check ((use_for = 'announcement') = (title is not null)),
  check (status <> 'approved' or (approved_at is not null and approved_by_membership_id is not null)),
  foreign key (approved_by_membership_id, organization_id) references public.memberships (id, organization_id)
);
comment on table public.message_templates is
  'OPS-04: the firm''s message and announcement templates. Written only through save/approve/archive_message_template.';

create index message_templates_org_idx on public.message_templates (organization_id, status, use_for);
create index message_templates_created_by_idx on public.message_templates (created_by);
create index message_templates_updated_by_idx on public.message_templates (updated_by);
create index message_templates_approved_by_idx on public.message_templates (approved_by_membership_id, organization_id);

alter table public.message_templates enable row level security;
alter table public.message_templates force row level security;
revoke all on public.message_templates from public, anon, authenticated;
grant select on public.message_templates to authenticated;
grant select on public.message_templates to service_role;

create policy message_templates_select on public.message_templates
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.is_org_staff(organization_id))
    and (select app.staff_mfa_satisfied())
  );

-- Every {field} in a template is one Casevoya can fill. An announcement goes to many people at
-- once, so only the firm's name.
create function app.message_template_fields_ok(p_body text, p_announcement boolean)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select not exists (
    select 1
    from regexp_matches(coalesce(p_body, ''), '\{([^{}]*)\}', 'g') as found
    where found[1] <> all (
      case when p_announcement then array['firm_name']
      else array['client_first_name', 'matter_reference', 'firm_name', 'consultant_name'] end
    )
  );
$$;
revoke all on function app.message_template_fields_ok(text, boolean) from public;
grant execute on function app.message_template_fields_ok(text, boolean) to authenticated, service_role;

create function public.save_message_template(
  p_organization_id uuid,
  p_template_id uuid,
  p_use_for text,
  p_name text,
  p_title text,
  p_body text,
  p_expected_version integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  current_row public.message_templates%rowtype;
  tid uuid;
  next_version integer;
  clean_name text := btrim(coalesce(p_name, ''));
  clean_title text := nullif(btrim(coalesce(p_title, '')), '');
  clean_body text := btrim(coalesce(p_body, ''));
begin
  perform app.require_active_staff(p_organization_id, array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[], false);
  if p_use_for is null or p_use_for not in ('message', 'announcement') then
    raise exception 'choose what the template is for' using errcode = '22023';
  end if;
  if length(clean_name) < 1 or length(clean_name) > 120 then
    raise exception 'template name must be 1 to 120 characters' using errcode = '22023';
  end if;
  if length(clean_body) < 1 or length(clean_body) > 4000 then
    raise exception 'template text must be 1 to 4000 characters' using errcode = '22023';
  end if;
  if p_use_for = 'announcement' and (clean_title is null or length(clean_title) > 120) then
    raise exception 'an announcement needs a title of 1 to 120 characters' using errcode = '22023';
  end if;
  if p_use_for = 'message' then
    clean_title := null;
  end if;
  if not app.message_template_fields_ok(clean_body, p_use_for = 'announcement')
     or not app.message_template_fields_ok(coalesce(clean_title, ''), true) then
    raise exception 'unknown merge field' using errcode = '22023';
  end if;

  if p_template_id is null then
    insert into public.message_templates (organization_id, use_for, name, title, body, created_by, updated_by)
    values (p_organization_id, p_use_for, clean_name, clean_title, clean_body, actor, actor)
    returning id, version into tid, next_version;
  else
    select * into current_row from public.message_templates
    where id = p_template_id and organization_id = p_organization_id
    for update;
    if current_row.id is null or current_row.status = 'archived' then
      raise exception 'template not found' using errcode = '42501';
    end if;
    if p_expected_version is not null and p_expected_version <> current_row.version then
      raise exception 'template changed since you opened it' using errcode = '40001';
    end if;
    update public.message_templates
       set use_for = p_use_for, name = clean_name, title = clean_title, body = clean_body,
           status = 'draft', approved_at = null, approved_by_membership_id = null,
           version = current_row.version + 1, updated_at = now(), updated_by = actor
     where id = current_row.id
    returning id, version into tid, next_version;
  end if;
  perform app.record_audit_event(p_organization_id, 'message_template.saved', 'public.message_templates', tid, 'success',
    jsonb_build_object('use_for', p_use_for, 'version', next_version));
  return jsonb_build_object('id', tid, 'version', next_version, 'status', 'draft');
end;
$$;
comment on function public.save_message_template(uuid, uuid, text, text, text, text, integer) is
  'OPS-04: firm owner, licensed consultant or case manager creates or edits a message template. Always a draft after saving. Audited without the text.';
revoke all on function public.save_message_template(uuid, uuid, text, text, text, text, integer) from public, anon;
grant execute on function public.save_message_template(uuid, uuid, text, text, text, text, integer) to authenticated;

create function public.approve_message_template(p_organization_id uuid, p_template_id uuid, p_expected_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_row public.message_templates%rowtype;
  approver uuid;
begin
  perform app.require_active_staff(p_organization_id, array['firm_owner', 'licensed_consultant']::public.org_role[], false);
  select * into current_row from public.message_templates
  where id = p_template_id and organization_id = p_organization_id
  for update;
  if current_row.id is null or current_row.status <> 'draft' then
    raise exception 'template not found' using errcode = '42501';
  end if;
  if p_expected_version is distinct from current_row.version then
    raise exception 'template changed since you opened it' using errcode = '40001';
  end if;
  if not app.message_template_fields_ok(current_row.body, current_row.use_for = 'announcement') then
    raise exception 'unknown merge field' using errcode = '22023';
  end if;
  select m.id into approver from public.memberships m
  where m.organization_id = p_organization_id and m.user_id = (select auth.uid()) and m.status = 'active'
    and m.role = any (array['firm_owner', 'licensed_consultant']::public.org_role[])
  order by m.created_at limit 1;
  update public.message_templates
     set status = 'approved', approved_at = now(), approved_by_membership_id = approver,
         updated_at = now(), updated_by = (select auth.uid())
   where id = current_row.id;
  perform app.record_audit_event(p_organization_id, 'message_template.approved', 'public.message_templates', current_row.id, 'success',
    jsonb_build_object('use_for', current_row.use_for, 'version', current_row.version));
  return jsonb_build_object('id', current_row.id, 'version', current_row.version, 'status', 'approved');
end;
$$;
comment on function public.approve_message_template(uuid, uuid, integer) is
  'OPS-04: a firm owner or licensed consultant approves the draft they read (by version). Audited.';
revoke all on function public.approve_message_template(uuid, uuid, integer) from public, anon;
grant execute on function public.approve_message_template(uuid, uuid, integer) to authenticated;

create function public.archive_message_template(p_organization_id uuid, p_template_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_active_staff(p_organization_id, array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[], false);
  update public.message_templates
     set status = 'archived', updated_at = now(), updated_by = (select auth.uid())
   where id = p_template_id and organization_id = p_organization_id and status <> 'archived';
  if not found then
    raise exception 'template not found' using errcode = '42501';
  end if;
  perform app.record_audit_event(p_organization_id, 'message_template.archived', 'public.message_templates', p_template_id, 'success', '{}'::jsonb);
end;
$$;
revoke all on function public.archive_message_template(uuid, uuid) from public, anon;
grant execute on function public.archive_message_template(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Announcements
-- ---------------------------------------------------------------------------

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  template_id uuid not null,
  template_version integer not null,
  title text not null check (length(btrim(title)) between 1 and 200),
  body text not null check (length(btrim(body)) between 1 and 4200),
  audience_kind text not null check (audience_kind in ('all', 'program')),
  program_key text check (program_key is null or length(program_key) between 1 and 200),
  is_sample boolean not null default false,
  recipient_count integer not null check (recipient_count >= 1),
  emailed_count integer not null check (emailed_count >= 0),
  sent_by uuid not null references auth.users (id),
  sent_by_membership_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (id, organization_id),
  check ((audience_kind = 'program') = (program_key is not null)),
  foreign key (template_id, organization_id) references public.message_templates (id, organization_id),
  foreign key (sent_by_membership_id, organization_id) references public.memberships (id, organization_id)
);
comment on table public.announcements is
  'OPS-04: an announcement as sent (approved template text, audience, counts). Append-only; written only by send_announcement.';

create index announcements_org_created_idx on public.announcements (organization_id, created_at desc);
create index announcements_template_idx on public.announcements (template_id, organization_id);
create index announcements_sent_by_idx on public.announcements (sent_by);
create index announcements_sent_by_membership_idx on public.announcements (sent_by_membership_id, organization_id);

create table public.announcement_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  announcement_id uuid not null,
  person_id uuid not null,
  emailed boolean not null default false,
  seen_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  unique (announcement_id, person_id),
  foreign key (announcement_id, organization_id) references public.announcements (id, organization_id),
  foreign key (person_id, organization_id) references public.persons (id, organization_id)
);
comment on table public.announcement_deliveries is
  'OPS-04: who an announcement went to, and when they saw or dismissed it in the portal. Clients read their own only through portal_notices_for_me.';

create index announcement_deliveries_org_idx on public.announcement_deliveries (organization_id);
create index announcement_deliveries_announcement_idx on public.announcement_deliveries (announcement_id, organization_id);
create index announcement_deliveries_person_idx on public.announcement_deliveries (person_id, organization_id, created_at desc);

create trigger announcements_append_only before update or delete on public.announcements
  for each row execute function app.reject_message_change();

alter table public.announcements enable row level security;
alter table public.announcements force row level security;
alter table public.announcement_deliveries enable row level security;
alter table public.announcement_deliveries force row level security;
revoke all on public.announcements from public, anon, authenticated;
revoke all on public.announcement_deliveries from public, anon, authenticated;
grant select on public.announcements to authenticated;
grant select on public.announcement_deliveries to authenticated;
grant select on public.announcements to service_role;
grant select on public.announcement_deliveries to service_role;

-- Staff on the case side read the firm's announcements and who they went to (finance users and
-- clients do not; clients see their own through portal_notices_for_me).
create policy announcements_select on public.announcements
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.staff_mfa_satisfied())
    and (select app.has_org_role(organization_id, array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[]))
  );
create policy announcement_deliveries_select on public.announcement_deliveries
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.staff_mfa_satisfied())
    and (select app.has_org_role(organization_id, array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[]))
  );

-- The firm's clients an announcement can reach: people on its open matters (as applicant,
-- dependant, sponsor, employer or guardian), one row per person and program. Sample matters only
-- while the firm is in sample mode, real ones only once it is live. `portal`: they can sign in to
-- the portal (only they are sent an announcement). `emailed`: they would be emailed (an address,
-- "Email notices" on, and never for a sample-mode firm).
create function app.announcement_candidates(p_org uuid)
returns table (person_id uuid, program_key text, portal boolean, emailed boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct
    person.id,
    pack.program_key,
    person.user_id is not null,
    person.email is not null
      and not coalesce(org.sample_mode, true)
      and coalesce((
        select pref.email_notices is distinct from false
        from public.person_contact_preferences pref
        where pref.person_id = person.id
        limit 1
      ), true)
  from public.matter_participants party
  join public.matters matter
    on matter.id = party.matter_id
   and matter.organization_id = party.organization_id
  join public.persons person
    on person.id = party.person_id
   and person.organization_id = party.organization_id
  join public.organizations org on org.id = party.organization_id
  left join public.rule_pack_versions pack on pack.id = matter.program_pack_id
  where party.organization_id = p_org
    and party.role in ('applicant', 'dependant', 'sponsor', 'employer', 'guardian')
    and matter.stage <> 'closed'
    and matter.is_sample = coalesce(org.sample_mode, true);
$$;
revoke all on function app.announcement_candidates(uuid) from public;

create function public.announcement_audiences(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  everyone jsonb;
  programs jsonb;
begin
  perform app.require_active_staff(p_organization_id, array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[], false);
  select jsonb_build_object(
           'recipients', count(*) filter (where people.portal),
           'emailed', count(*) filter (where people.portal and people.emailed),
           'without_portal', count(*) filter (where not people.portal)
         )
    into everyone
  from (
    select c.person_id, bool_or(c.portal) as portal, bool_or(c.emailed) as emailed
    from app.announcement_candidates(p_organization_id) c
    group by c.person_id
  ) people;
  select coalesce(jsonb_agg(jsonb_build_object(
           'program_key', grouped.program_key,
           'recipients', grouped.recipients,
           'emailed', grouped.emailed,
           'without_portal', grouped.without_portal
         ) order by grouped.program_key), '[]'::jsonb)
    into programs
  from (
    select people.program_key,
           count(*) filter (where people.portal) as recipients,
           count(*) filter (where people.portal and people.emailed) as emailed,
           count(*) filter (where not people.portal) as without_portal
    from (
      select c.program_key, c.person_id, bool_or(c.portal) as portal, bool_or(c.emailed) as emailed
      from app.announcement_candidates(p_organization_id) c
      where c.program_key is not null
      group by c.program_key, c.person_id
    ) people
    group by people.program_key
  ) grouped;
  return jsonb_build_object('all', everyone, 'programs', programs);
end;
$$;
comment on function public.announcement_audiences(uuid) is
  'OPS-04: case staff see how many clients each announcement audience reaches (portal; emailed; left out for having no portal account). Read only.';
revoke all on function public.announcement_audiences(uuid) from public, anon;
grant execute on function public.announcement_audiences(uuid) to authenticated;

create function public.send_announcement(
  p_organization_id uuid,
  p_template_id uuid,
  p_template_version integer,
  p_program_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  tpl public.message_templates%rowtype;
  org public.organizations%rowtype;
  sender uuid;
  last_sent timestamptz;
  aid uuid;
  recipients integer;
  emailed_n integer;
  program text := nullif(btrim(coalesce(p_program_key, '')), '');
begin
  perform app.require_active_staff(p_organization_id, array['firm_owner', 'licensed_consultant']::public.org_role[], false);
  select * into org from public.organizations where id = p_organization_id;
  select * into tpl from public.message_templates
  where id = p_template_id and organization_id = p_organization_id;
  if tpl.id is null or tpl.use_for <> 'announcement' or tpl.status <> 'approved' then
    raise exception 'choose an approved announcement template' using errcode = '22023';
  end if;
  if p_template_version is distinct from tpl.version then
    raise exception 'template changed since you opened it' using errcode = '40001';
  end if;

  -- One announcement per firm every 10 minutes. The refusal is returned (not raised) so its
  -- audit row stays.
  perform pg_advisory_xact_lock(hashtextextended('announcement:' || p_organization_id::text, 0));
  select max(a.created_at) into last_sent from public.announcements a where a.organization_id = p_organization_id;
  if last_sent is not null and last_sent > clock_timestamp() - interval '10 minutes' then
    perform app.record_audit_event(p_organization_id, 'announcement.rate_limited', 'public.message_templates', tpl.id, 'denied',
      jsonb_build_object('last_sent_at', last_sent));
    return jsonb_build_object('rate_limited', true, 'retry_at', last_sent + interval '10 minutes');
  end if;

  select count(*), count(*) filter (where people.emailed)
    into recipients, emailed_n
  from (
    select c.person_id, bool_or(c.emailed) as emailed
    from app.announcement_candidates(p_organization_id) c
    where c.portal and (program is null or c.program_key = program)
    group by c.person_id
  ) people;
  if recipients = 0 then
    raise exception 'no client in this audience has a portal account' using errcode = '22023';
  end if;

  select m.id into sender from public.memberships m
  where m.organization_id = p_organization_id and m.user_id = actor and m.status = 'active'
    and m.role = any (array['firm_owner', 'licensed_consultant']::public.org_role[])
  order by m.created_at limit 1;

  insert into public.announcements (
    organization_id, template_id, template_version, title, body, audience_kind, program_key,
    is_sample, recipient_count, emailed_count, sent_by, sent_by_membership_id
  ) values (
    p_organization_id, tpl.id, tpl.version,
    replace(tpl.title, '{firm_name}', org.display_name),
    replace(tpl.body, '{firm_name}', org.display_name),
    case when program is null then 'all' else 'program' end, program,
    coalesce(org.sample_mode, true), recipients, emailed_n, actor, sender
  )
  returning id into aid;

  insert into public.announcement_deliveries (organization_id, announcement_id, person_id, emailed)
  select p_organization_id, aid, people.person_id, people.emailed
  from (
    select c.person_id, bool_or(c.emailed) as emailed
    from app.announcement_candidates(p_organization_id) c
    where c.portal and (program is null or c.program_key = program)
    group by c.person_id
  ) people;

  if emailed_n > 0 then
    perform app.enqueue_event(
      p_organization_id, 'announcement', aid, 'announcement.sent',
      jsonb_build_object('announcement_id', aid), null,
      'announcement.sent:' || aid::text
    );
  end if;
  perform app.record_audit_event(p_organization_id, 'announcement.sent', 'public.announcements', aid, 'success',
    jsonb_build_object(
      'template_id', tpl.id, 'template_version', tpl.version,
      'audience', case when program is null then 'all' else 'program' end, 'program_key', program,
      'recipients', recipients, 'emailed', emailed_n, 'sample', coalesce(org.sample_mode, true)
    ));
  return jsonb_build_object('announcement_id', aid, 'recipients', recipients, 'emailed', emailed_n);
end;
$$;
comment on function public.send_announcement(uuid, uuid, integer, text) is
  'OPS-04: a firm owner or licensed consultant sends an approved announcement template to all active clients or one program''s (portal; EX19 email). One per firm every 10 minutes. Audited.';
revoke all on function public.send_announcement(uuid, uuid, integer, text) from public, anon;
grant execute on function public.send_announcement(uuid, uuid, integer, text) to authenticated;

create function public.mark_portal_announcements_seen(p_org uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  if (select auth.uid()) is null then
    raise exception 'sign in is required' using errcode = '42501';
  end if;
  update public.announcement_deliveries delivery
     set seen_at = clock_timestamp()
    from public.persons person
   where delivery.organization_id = p_org
     and person.id = delivery.person_id
     and person.organization_id = delivery.organization_id
     and person.user_id = (select auth.uid())
     and delivery.seen_at is null;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.mark_portal_announcements_seen(uuid) from public, anon;
grant execute on function public.mark_portal_announcements_seen(uuid) to authenticated;

-- public.portal_notices_for_me(uuid), last defined in 20261024120100_consultant_change_notice.sql:
-- + the person's announcements (kind 'announcement', title and body) from the last 60 days.
create or replace function public.portal_notices_for_me(p_org uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(item.notice order by item.created_at desc), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'id', notice.id, 'kind', notice.kind, 'matter_id', notice.matter_id,
      'matter_title', matter.title, 'consultant_name', notice.consultant_name, 'created_at', notice.created_at
    ) as notice, notice.created_at
    from public.portal_notices notice
    join public.persons person on person.id = notice.person_id and person.organization_id = notice.organization_id
    join public.matters matter on matter.id = notice.matter_id and matter.organization_id = notice.organization_id
    where notice.organization_id = p_org
      and person.user_id = (select auth.uid())
      and notice.dismissed_at is null
      and notice.created_at > now() - interval '60 days'
    union all
    -- OPS-04: announcements.
    select jsonb_build_object(
      'id', delivery.id, 'kind', 'announcement', 'title', announcement.title,
      'body', announcement.body, 'created_at', announcement.created_at
    ), announcement.created_at
    from public.announcement_deliveries delivery
    join public.announcements announcement
      on announcement.id = delivery.announcement_id
     and announcement.organization_id = delivery.organization_id
    join public.persons person on person.id = delivery.person_id and person.organization_id = delivery.organization_id
    where delivery.organization_id = p_org
      and person.user_id = (select auth.uid())
      and delivery.dismissed_at is null
      and announcement.created_at > now() - interval '60 days'
  ) item;
$$;

-- public.dismiss_portal_notice(uuid), last defined in 20261024120100_consultant_change_notice.sql:
-- + an announcement delivery of the signed-in person ("Got it" also marks it seen).
create or replace function public.dismiss_portal_notice(p_notice_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.portal_notices notice
     set dismissed_at = coalesce(notice.dismissed_at, now())
    from public.persons person
   where notice.id = p_notice_id
     and person.id = notice.person_id
     and person.organization_id = notice.organization_id
     and person.user_id = (select auth.uid());
  if not found then
    -- OPS-04: an announcement.
    update public.announcement_deliveries delivery
       set dismissed_at = coalesce(delivery.dismissed_at, now()),
           seen_at = coalesce(delivery.seen_at, now())
      from public.persons person
     where delivery.id = p_notice_id
       and person.id = delivery.person_id
       and person.organization_id = delivery.organization_id
       and person.user_id = (select auth.uid());
  end if;
  if not found then
    raise exception 'notice not found' using errcode = '42501';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- External participants need portal access to be in a conversation
-- ---------------------------------------------------------------------------

-- An employer or sponsor (on the matter only in those roles) can read a conversation only through
-- the portal, so one without a portal account can't be added to one. Conversations started by a
-- signed-in user only (staff in the Sheet); service work such as an inbound WhatsApp message is
-- not changed.
create function app.guard_thread_external_person()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null and exists (
    select 1
    from public.message_threads thread
    join public.persons person
      on person.id = new.person_id
     and person.organization_id = thread.organization_id
    where thread.id = new.thread_id
      and person.user_id is null
      and exists (
        select 1 from public.matter_participants party
        where party.matter_id = thread.matter_id and party.organization_id = thread.organization_id
          and party.person_id = person.id and party.role in ('sponsor', 'employer')
      )
      and not exists (
        select 1 from public.matter_participants party
        where party.matter_id = thread.matter_id and party.organization_id = thread.organization_id
          and party.person_id = person.id and party.role in ('applicant', 'dependant', 'guardian')
      )
  ) then
    raise exception 'an employer or sponsor needs portal access to this matter to be in a conversation' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function app.guard_thread_external_person() from public;

create trigger message_thread_people_external_portal before insert on public.message_thread_people
  for each row execute function app.guard_thread_external_person();

-- ---------------------------------------------------------------------------
-- Mail: EX19, the minimal announcement notice
-- ---------------------------------------------------------------------------

-- public.claim_mail_events(text,integer), last defined in 20261024150100_enquiry_staff_email.sql
create or replace function public.claim_mail_events(p_worker text, p_limit integer default 20)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed jsonb;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') is distinct from 'service_role' then
    raise exception 'worker role required' using errcode = '42501';
  end if;
  if p_worker is null or length(btrim(p_worker)) < 1 then
    raise exception 'worker name is required' using errcode = '22023';
  end if;

  with due as (
    select c.id
    from public.outbox_events c
    where c.event_type = any (array[
      'portal_invitation.email_requested',
      'staff_invitation.email_requested',
      'reminder.due',
      'agreement.sent',
      'agreement.executed',
      -- firm countersign: a staff signer's turn.
      'agreement.signer_turn',
      'document.request_created',
      'document.uploaded',
      'document.reviewed',
      -- email designs: invoice, payment and refund mail.
      'invoice.issued',
      'invoice.payment_failed',
      'invoice.refund_started',
      'invoice.refund_succeeded',
      -- scheduling: consultation booked, moved, cancelled.
      'booking.confirmed',
      'booking.rescheduled',
      'booking.cancelled',
      -- matter messaging: EX07 generic notice of a staff message.
      'message.sent',
      -- inbox replies: EX15, an email a staff member wrote.
      'matter_email.sent',
      -- support access: EX11 asked, EM17 approved.
      'support_access.requested',
      'support_access.approved',
      -- consultation agreements: EM08 with the booking's private signing link.
      'booking_agreement.sent',
      -- signing flow: EX16, the sealed six-digit signing code.
      'booking_agreement.code',
      -- ORG-06: EX17, the matter's consultant changed.
      'matter.consultant_changed',
      -- CRM-01: EX18, a new web enquiry, to the firm's owners.
      'lead.enquiry_received',
      -- OPS-04: EX19, an announcement to many clients.
      'announcement.sent'
    ])
      and (
        (c.status in ('pending', 'failed') and c.available_at <= clock_timestamp())
        or (c.status = 'processing' and c.locked_at < clock_timestamp() - interval '5 minutes')
      )
      -- sealed invitation link: wait for it, or send the linkless email after 10 minutes.
      and (
        c.event_type not in ('portal_invitation.email_requested', 'staff_invitation.email_requested')
        or c.payload ? 'sealed_link'
        or c.occurred_at < clock_timestamp() - interval '10 minutes'
      )
    order by c.available_at, c.occurred_at
    limit least(greatest(coalesce(p_limit, 20), 1), 50)
    for update skip locked
  ),
  locked as (
    update public.outbox_events event
       set status = 'processing',
           locked_at = clock_timestamp(),
           locked_by = left(btrim(p_worker), 200),
           attempts = event.attempts + 1
     where event.id in (select due.id from due)
    returning event.id, event.organization_id, event.event_type, event.payload, event.attempts
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', locked.id,
    'organization_id', locked.organization_id,
    'event_type', locked.event_type,
    'payload', locked.payload,
    'attempts', locked.attempts
  )), '[]'::jsonb)
  into claimed
  from locked;
  return claimed;
end;
$$;

-- public.prepare_email_delivery(uuid,text,text,text), last defined in 20261024150100_enquiry_staff_email.sql
create or replace function public.prepare_email_delivery(
  p_event_id uuid,
  p_worker text,
  p_inbound_domain text default null,
  p_from_address text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  event public.outbox_events%rowtype;
  firm_name text;
  firm_slug text;
  domain text;
  from_addr text;
  matter uuid;
  template public.email_template;
  critical boolean;
  reply text;
  messages jsonb;
  rec record;
  send_ok boolean;
  ctx jsonb;
  inviter text;
  payer uuid;
  payer_known boolean;
  -- inbox replies: the staff email, and what its message carries besides the context.
  outbound public.matter_outbound_emails%rowtype;
  in_reply_to text;
  extra jsonb := '{}'::jsonb;
  -- support access: the request the event is about.
  support_req public.support_access_requests%rowtype;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') is distinct from 'service_role' then
    raise exception 'worker role required' using errcode = '42501';
  end if;
  select * into event from public.outbox_events where id = p_event_id;
  if event.id is null then
    raise exception 'mail event was not found' using errcode = '42501';
  end if;
  if event.status = 'published' then
    return jsonb_build_object('action', 'done', 'event_id', event.id, 'messages', '[]'::jsonb);
  end if;
  if event.status is distinct from 'processing'
     or event.locked_by is distinct from left(btrim(coalesce(p_worker, '')), 200) then
    raise exception 'mail event is not claimed' using errcode = '42501';
  end if;

  domain := app.inbound_domain(p_inbound_domain);
  from_addr := lower(btrim(coalesce(
    nullif(p_from_address, ''),
    (select value ->> 'address' from public.product_settings where key = 'email.from_address'),
    'notices@casevoya.ca'
  )));
  if from_addr !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    from_addr := 'notices@casevoya.ca';
  end if;
  select display_name, slug into firm_name, firm_slug
  from public.organizations
  where id = event.organization_id;

  matter := null;
  if coalesce(event.payload ->> 'matter_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    matter := (event.payload ->> 'matter_id')::uuid;
  end if;

  if event.event_type = 'document.reviewed'
     and coalesce(event.payload ->> 'decision', '') is distinct from 'accepted' then
    perform app.mark_outbox_published(event.id, p_worker);
    perform app.record_audit_event(
      event.organization_id, 'email.skipped', 'public.outbox_events', event.id, 'success',
      jsonb_build_object('reason', 'review_not_accepted')
    );
    return jsonb_build_object('action', 'done', 'event_id', event.id, 'messages', '[]'::jsonb);
  end if;

  template := case event.event_type
    when 'portal_invitation.email_requested' then 'invite'::public.email_template
    when 'staff_invitation.email_requested' then 'invite'::public.email_template
    when 'reminder.due' then 'reminder'::public.email_template
    when 'agreement.sent' then 'agreement'::public.email_template
    when 'agreement.executed' then 'signature'::public.email_template
    -- firm countersign: the staff signer's turn uses the agreement template, staff copy.
    when 'agreement.signer_turn' then 'agreement'::public.email_template
    when 'document.request_created' then 'document_request'::public.email_template
    when 'document.uploaded' then 'document_receipt'::public.email_template
    when 'document.reviewed' then 'document_receipt'::public.email_template
    -- email designs: invoice, payment and refund mail.
    when 'invoice.issued' then 'invoice'::public.email_template
    when 'invoice.payment_failed' then 'payment_failed'::public.email_template
    when 'invoice.refund_started' then 'refund_started'::public.email_template
    when 'invoice.refund_succeeded' then 'refund_complete'::public.email_template
    -- scheduling: EM16a / EM16b / EM16c.
    when 'booking.confirmed' then 'consultation_booked'::public.email_template
    when 'booking.rescheduled' then 'consultation_rescheduled'::public.email_template
    when 'booking.cancelled' then 'consultation_cancelled'::public.email_template
    -- matter messaging: EX07, the generic "New message" notice.
    when 'message.sent' then 'message'::public.email_template
    -- inbox replies: EX15, the staff member's own words.
    when 'matter_email.sent' then 'staff_message'::public.email_template
    -- support access: EX11 asked, EM17 approved.
    when 'support_access.requested' then 'support_requested'::public.email_template
    when 'support_access.approved' then 'support_granted'::public.email_template
    -- consultation agreements: the agreement template (EM08), booking variant.
    when 'booking_agreement.sent' then 'agreement'::public.email_template
    -- signing flow: EX16, the signing code.
    when 'booking_agreement.code' then 'signing_code'::public.email_template
    -- ORG-06: EX17, the matter's consultant changed.
    when 'matter.consultant_changed' then 'consultant_changed'::public.email_template
    -- CRM-01: EX18, a new web enquiry.
    when 'lead.enquiry_received' then 'enquiry_received'::public.email_template
    -- OPS-04: EX19, a new notice (announcement).
    when 'announcement.sent' then 'announcement'::public.email_template
    else null
  end;
  if template is null then
    raise exception 'event is not a mail event' using errcode = '22023';
  end if;

  critical := template in ('invite', 'agreement', 'signature', 'document_request', 'document_receipt');
  ctx := jsonb_build_object('firm', firm_name, 'template', template);

  -- sealed invitation link: the worker decrypts it; it stays well under the 2000-byte context cap.
  if event.event_type in ('portal_invitation.email_requested', 'staff_invitation.email_requested')
     and length(coalesce(event.payload ->> 'sealed_link', '')) between 1 and 1024 then
    ctx := ctx || jsonb_build_object(
      'sealed_link', event.payload ->> 'sealed_link',
      'invitation_id', event.payload ->> 'invitation_id'
    );
  end if;

  if event.event_type = 'portal_invitation.email_requested' then
    ctx := ctx || jsonb_build_object('kind', 'portal', 'role', event.payload ->> 'role');
    -- email designs: who invited them, for the heading.
    select left(nullif(btrim(profile.display_name), ''), 120) into inviter
    from public.portal_invitations inv
    join public.profiles profile on profile.id = inv.created_by
    where inv.id::text = event.payload ->> 'invitation_id'
      and inv.organization_id = event.organization_id;
    if inviter is not null then
      ctx := ctx || jsonb_build_object('inviter', inviter);
    end if;
    perform app.queue_email_delivery(
      event.id, event.organization_id, event.payload ->> 'recipient_email',
      template, matter, true, ctx, true
    );
  elsif event.event_type = 'staff_invitation.email_requested' then
    ctx := ctx || jsonb_build_object('kind', 'staff', 'role', event.payload ->> 'role');
    -- email designs: who invited them, for the heading.
    select left(nullif(btrim(profile.display_name), ''), 120) into inviter
    from public.invitations inv
    join public.profiles profile on profile.id = inv.created_by
    where inv.id::text = event.payload ->> 'invitation_id'
      and inv.organization_id = event.organization_id;
    if inviter is not null then
      ctx := ctx || jsonb_build_object('inviter', inviter);
    end if;
    perform app.queue_email_delivery(
      event.id, event.organization_id, event.payload ->> 'recipient_email',
      template, null, true, ctx, true
    );
  elsif event.event_type = 'reminder.due' then
    critical := coalesce(event.payload ->> 'reminder_kind', '') = 'immediate'
      or exists (
        select 1
        from public.deadlines deadline
        where deadline.id::text = event.payload ->> 'deadline_id'
          and deadline.kind in ('legal', 'correspondence')
      );
    ctx := ctx || jsonb_build_object(
      'reminder_kind', coalesce(event.payload ->> 'reminder_kind', 'routine'),
      'due_on', (
        select to_char(deadline.due_on, 'YYYY-MM-DD')
        from public.deadlines deadline
        where deadline.id::text = event.payload ->> 'deadline_id'
      )
    );
    for rec in
      select person.email,
             coalesce(pref.deadline_reminders, false) as deadline_reminders,
             pref.email_notices as email_notices
      from public.persons person
      join public.matter_participants party
        on party.person_id = person.id
       and party.matter_id = matter
       and party.organization_id = event.organization_id
      left join public.person_contact_preferences pref
        on pref.person_id = person.id
      where person.organization_id = event.organization_id
        and person.email is not null
        and matter is not null
    loop
      send_ok := coalesce(event.payload ->> 'reminder_kind', '') = 'immediate'
        or (rec.deadline_reminders and rec.email_notices is distinct from false);
      perform app.queue_email_delivery(
        event.id, event.organization_id, rec.email, template, matter, critical, ctx, send_ok
      );
    end loop;
  elsif event.event_type in ('agreement.sent', 'agreement.executed') then
    ctx := ctx || jsonb_build_object('agreement_kind', (
      select agreement.kind
      from public.signature_envelopes envelope
      join public.agreements agreement on agreement.id = envelope.agreement_id
      where envelope.id::text = event.payload ->> 'envelope_id'
    ));
    for rec in
      select lower(coalesce(person.email, users.email)) as email,
             signer.person_id is null as staff
      from public.envelope_signers signer
      left join public.persons person on person.id = signer.person_id
      left join public.memberships membership on membership.id = signer.membership_id
      left join auth.users users on users.id = membership.user_id
      where signer.envelope_id::text = event.payload ->> 'envelope_id'
        and signer.organization_id = event.organization_id
        -- firm countersign: staff signers hear when it is their turn (agreement.signer_turn), not at send.
        and (event.event_type = 'agreement.executed' or signer.person_id is not null)
    loop
      -- email designs: a staff signer's executed copy links to the Sheet, not the portal.
      perform app.queue_email_delivery(
        event.id, event.organization_id, rec.email, template, matter, true,
        case when rec.staff then ctx || jsonb_build_object('audience', 'staff') else ctx end,
        true
      );
    end loop;
  -- firm countersign: the staff signer whose turn it is, while it still is, gets the Sheet link.
  elsif event.event_type = 'agreement.signer_turn' then
    ctx := ctx || jsonb_build_object(
      'audience', 'staff',
      'agreement_kind', (
        select agreement.kind
        from public.signature_envelopes envelope
        join public.agreements agreement on agreement.id = envelope.agreement_id
        where envelope.id::text = event.payload ->> 'envelope_id'
      )
    );
    for rec in
      select lower(users.email) as email
      from public.envelope_signers signer
      join public.signature_envelopes envelope
        on envelope.id = signer.envelope_id
       and envelope.organization_id = signer.organization_id
      join public.memberships membership
        on membership.id = signer.membership_id
       and membership.organization_id = signer.organization_id
       and membership.status = 'active'
      join auth.users users on users.id = membership.user_id
      where signer.id::text = event.payload ->> 'signer_id'
        and signer.envelope_id::text = event.payload ->> 'envelope_id'
        and signer.organization_id = event.organization_id
        and signer.status = 'current'
        and envelope.status in ('sent', 'partially_signed')
        and envelope.expires_at > statement_timestamp()
    loop
      perform app.queue_email_delivery(
        event.id, event.organization_id, rec.email, template, matter, true, ctx, true
      );
    end loop;
  elsif event.event_type = 'document.request_created' then
    -- email designs: the due date only; the request's purpose names the document and stays out of mail.
    ctx := ctx || jsonb_build_object('due_on', event.payload ->> 'due_on');
    perform app.queue_email_delivery(
      event.id, event.organization_id,
      (select person.email from public.persons person where person.id::text = event.payload ->> 'person_id'),
      template, matter, true, ctx, true
    );
  elsif event.event_type in ('document.uploaded', 'document.reviewed') then
    ctx := ctx || jsonb_build_object(
      'status', case when event.event_type = 'document.reviewed' then 'accepted' else 'received' end
    );
    perform app.queue_email_delivery(
      event.id, event.organization_id,
      (
        select person.email
        from public.documents doc
        join public.persons person on person.id = doc.person_id
        where doc.id::text = event.payload ->> 'document_id'
      ),
      template, matter, true, ctx, true
    );
  -- email designs: invoice, payment and refund mail to the payer, else the matter's applicants.
  elsif event.event_type in ('invoice.issued', 'invoice.payment_failed', 'invoice.refund_started', 'invoice.refund_succeeded') then
    ctx := ctx || coalesce((
      select jsonb_build_object(
        'invoice_id', invoice.id,
        'invoice_number', invoice.number,
        'due_on', to_char(invoice.due_on, 'YYYY-MM-DD')
      )
      from public.invoices invoice
      where invoice.id::text = event.payload ->> 'invoice_id'
        and invoice.organization_id = event.organization_id
    ), '{}'::jsonb);
    payer := null;
    if event.event_type <> 'invoice.issued' then
      select payment.created_by into payer
      from public.invoice_payments payment
      where payment.id::text = event.payload ->> 'payment_id'
        and payment.organization_id = event.organization_id;
    end if;
    payer_known := payer is not null and matter is not null and exists (
      select 1
      from public.persons person
      join public.matter_participants party
        on party.person_id = person.id
       and party.matter_id = matter
       and party.organization_id = event.organization_id
      where person.user_id = payer
        and person.organization_id = event.organization_id
        and person.email is not null
    );
    for rec in
      select lower(person.email) as email,
             bool_or(pref.email_notices is distinct from false) as email_notices
      from public.matter_participants party
      join public.persons person
        on person.id = party.person_id
       and person.organization_id = party.organization_id
      left join public.person_contact_preferences pref
        on pref.person_id = person.id
      where party.matter_id = matter
        and party.organization_id = event.organization_id
        and person.email is not null
        and matter is not null
        and case when payer_known then person.user_id = payer else party.role = 'applicant' end
      group by lower(person.email)
    loop
      perform app.queue_email_delivery(
        event.id, event.organization_id, rec.email, template, matter, false, ctx, rec.email_notices
      );
    end loop;
  -- scheduling: the booking's primary attendee, with the time in their own zone. A booking that
  -- moved again or was cancelled since this event was queued is not mailed with a stale time.
  elsif event.event_type in ('booking.confirmed', 'booking.rescheduled', 'booking.cancelled') then
    for rec in
      select attendee.email,
             attendee.time_zone,
             booking.host_name,
             booking.status,
             booking.starts_at,
             booking.location_kind,
             booking.location_detail,
             booking.is_sample,
             -- portal appointments: who cancelled (EM16c wording).
             booking.cancelled_by,
             -- booking mail: a portal button only for an attendee whose person can sign in.
             (person.id is not null and person.user_id is not null) as portal,
             pref.email_notices is distinct from false as email_notices
      from public.bookings booking
      join public.booking_attendees attendee
        on attendee.booking_id = booking.id
       and attendee.organization_id = booking.organization_id
       and attendee.role = 'primary'
      left join public.persons person
        on person.id = attendee.person_id
       and person.organization_id = attendee.organization_id
      left join public.person_contact_preferences pref
        on pref.person_id = attendee.person_id
      where booking.id::text = event.payload ->> 'booking_id'
        and booking.organization_id = event.organization_id
    loop
      ctx := ctx || jsonb_build_object(
        'starts_at', coalesce(event.payload ->> 'starts_at', to_char(rec.starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
        'time_zone', rec.time_zone,
        'portal', rec.portal
      );
      if event.event_type = 'booking.confirmed' and rec.host_name is not null then
        ctx := ctx || jsonb_build_object('consultant_name', rec.host_name);
      end if;
      -- booking mail: how they meet; the address only for an in-person meeting, never a link.
      if event.event_type = 'booking.confirmed' then
        ctx := ctx || jsonb_build_object('location_kind', rec.location_kind);
        if rec.location_kind = 'in_person' and nullif(btrim(coalesce(rec.location_detail, '')), '') is not null then
          ctx := ctx || jsonb_build_object('address', left(btrim(rec.location_detail), 300));
        end if;
      end if;
      -- booking mail: without a portal, a cancellation points to the firm's booking page when the
      -- firm has a published free one this attendee can use (a practice one for a sample booking).
      if event.event_type = 'booking.cancelled' and not rec.portal and firm_slug is not null and exists (
        select 1 from public.booking_event_types et
        where et.organization_id = event.organization_id
          and et.is_published and et.archived_at is null and et.price_cents = 0
          and (not et.is_sample or rec.is_sample)
      ) then
        ctx := ctx || jsonb_build_object('booking_page', firm_slug);
      end if;
      -- portal appointments: EM16c says who cancelled (the client from their portal, or the firm).
      if event.event_type = 'booking.cancelled' then
        ctx := ctx || jsonb_build_object('cancelled_by',
          case when coalesce(event.payload ->> 'cancelled_by', rec.cancelled_by::text) = 'client' then 'client' else 'staff' end);
      end if;
      send_ok := rec.email_notices and case event.event_type
        when 'booking.cancelled' then rec.status = 'cancelled'
        else rec.status = 'confirmed' and rec.starts_at = (event.payload ->> 'starts_at')::timestamptz
      end;
      perform app.queue_email_delivery(
        event.id, event.organization_id, rec.email, template, null, false, ctx, send_ok
      );
    end loop;
  -- matter messaging: each person the thread is addressed to, firm name only (never the text).
  -- A critical instruction (requires_ack) is a critical notice, so a bounce opens a staff task.
  elsif event.event_type = 'message.sent' then
    critical := coalesce((
      select message.requires_ack from public.matter_messages message
      where message.id::text = event.payload ->> 'message_id'
        and message.organization_id = event.organization_id
    ), false);
    for rec in
      select lower(person.email) as email,
             bool_or(pref.email_notices is distinct from false) as email_notices
      from public.matter_messages message
      join public.message_thread_people tp
        on tp.thread_id = message.thread_id
       and tp.organization_id = message.organization_id
      join public.persons person
        on person.id = tp.person_id
       and person.organization_id = tp.organization_id
      join public.matter_participants party
        on party.person_id = person.id
       and party.matter_id = message.matter_id
       and party.organization_id = message.organization_id
      left join public.person_contact_preferences pref
        on pref.person_id = person.id
      where message.id::text = event.payload ->> 'message_id'
        and message.organization_id = event.organization_id
        and person.email is not null
      group by lower(person.email)
    loop
      perform app.queue_email_delivery(
        event.id, event.organization_id, rec.email, template, matter, critical, ctx, rec.email_notices
      );
    end loop;
  -- inbox replies: the stored address of the person the staff member wrote to. A sample matter's
  -- email is recorded as skipped (never sent), as is one whose person left the matter, lost that
  -- address, or turned "Email notices" off since. The text, subject and threading headers go in
  -- the message, not the context.
  elsif event.event_type = 'matter_email.sent' then
    select * into outbound
    from public.matter_outbound_emails email
    where email.id::text = event.payload ->> 'email_id'
      and email.organization_id = event.organization_id
      and email.outbox_event_id = event.id;
    if outbound.id is not null then
      matter := outbound.matter_id;
      select * into rec
      from (
        select lower(person.email) as email,
               person.user_id is not null as portal,
               exists (
                 select 1 from public.matter_participants party
                 where party.person_id = person.id
                   and party.matter_id = outbound.matter_id
                   and party.organization_id = outbound.organization_id
               ) as on_matter,
               coalesce((
                 select pref.email_notices is distinct from false
                 from public.person_contact_preferences pref
                 where pref.person_id = person.id
               ), true) as email_notices
        from public.persons person
        where person.id = outbound.person_id
          and person.organization_id = outbound.organization_id
      ) found;
      ctx := ctx || jsonb_build_object(
        'sender', left(outbound.author_name, 120),
        'portal', coalesce(rec.portal, false)
      );
      send_ok := outbound.is_sample is false
        and coalesce(rec.on_matter, false)
        and coalesce(rec.email_notices, false)
        and rec.email is not distinct from outbound.recipient_email;
      perform app.queue_email_delivery(
        event.id, event.organization_id, outbound.recipient_email, template, matter, false, ctx, send_ok
      );
      select inbound.message_id into in_reply_to
      from public.inbound_emails inbound
      where inbound.id = outbound.reply_to_inbound_id
        and inbound.organization_id = outbound.organization_id;
      extra := jsonb_build_object('body', outbound.body, 'subject', outbound.subject);
      if btrim(coalesce(in_reply_to, '')) ~ '^<[^<>[:space:]]+>$' and length(btrim(in_reply_to)) <= 500 then
        extra := extra || jsonb_build_object(
          'headers', jsonb_build_object('In-Reply-To', btrim(in_reply_to), 'References', btrim(in_reply_to))
        );
      end if;
    end if;
  -- support access: EX11 when Casevoya support asks, EM17 when a firm owner approves, to every
  -- active firm owner at their sign-in address. Minutes only in the request mail; the approver's
  -- name, the minutes granted, the end time and the firm's zone in the approval mail. No matter
  -- (platform mail), never critical. Nothing about the matter or the reason goes in the email.
  elsif event.event_type in ('support_access.requested', 'support_access.approved') then
    select * into support_req
    from public.support_access_requests req
    where req.id::text = event.payload ->> 'request_id'
      and req.organization_id = event.organization_id;
    if support_req.id is not null then
      ctx := ctx || jsonb_build_object('minutes', support_req.requested_minutes);
      if event.event_type = 'support_access.approved' and support_req.starts_at is not null then
        ctx := ctx || jsonb_build_object(
          'approver', (
            select left(nullif(btrim(coalesce(prof.display_name, '')), ''), 120)
            from public.memberships member
            left join public.profiles prof on prof.id = member.user_id
            where member.id = support_req.approved_by_membership_id
              and member.organization_id = support_req.organization_id
          ),
          'minutes', round(extract(epoch from (support_req.ends_at - support_req.starts_at)) / 60)::integer,
          'ends_at', to_char(support_req.ends_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
          'time_zone', (select org.timezone from public.organizations org where org.id = event.organization_id)
        );
      end if;
      for rec in
        select lower(users.email) as email
        from public.memberships member
        join auth.users users on users.id = member.user_id
        where member.organization_id = event.organization_id
          and member.role = 'firm_owner'
          and member.status = 'active'
          and users.email is not null
        group by lower(users.email)
      loop
        perform app.queue_email_delivery(
          event.id, event.organization_id, rec.email, template, null, false, ctx, true
        );
      end loop;
    end if;
  -- consultation agreements: the booking's primary attendee gets EM08 with the booking's private
  -- signing link (the ref only; the worker builds the link). Sent only while that agreement is
  -- still unsigned and the consultation still ahead; never critical (no matter), and it honours
  -- "Email notices" like the other booking mail.
  elsif event.event_type = 'booking_agreement.sent' then
    critical := false;
    for rec in
      select attendee.email,
             booking.public_ref,
             agreement.status as agreement_status,
             booking.status as booking_status,
             booking.ends_at,
             pref.email_notices is distinct from false as email_notices
      from public.booking_agreements agreement
      join public.bookings booking
        on booking.id = agreement.booking_id
       and booking.organization_id = agreement.organization_id
      join public.booking_attendees attendee
        on attendee.booking_id = booking.id
       and attendee.organization_id = booking.organization_id
       and attendee.role = 'primary'
      left join public.person_contact_preferences pref
        on pref.person_id = attendee.person_id
      where agreement.id::text = event.payload ->> 'booking_agreement_id'
        and agreement.booking_id::text = event.payload ->> 'booking_id'
        and agreement.organization_id = event.organization_id
    loop
      ctx := ctx || jsonb_build_object('agreement_kind', 'consultation', 'signing_ref', rec.public_ref);
      send_ok := rec.email_notices
        and rec.agreement_status = 'sent'
        and rec.booking_status in ('held', 'pending_payment', 'confirmed')
        and rec.ends_at > statement_timestamp();
      perform app.queue_email_delivery(
        event.id, event.organization_id, rec.email, template, null, false, ctx, send_ok
      );
    end loop;
  -- signing flow: EX16 to the booking's primary attendee with the sealed code (the worker opens
  -- it; the database never holds the code). Sent only while that code is the newest, unexpired
  -- and unused, and the agreement unsigned; it honours "Email notices" like EM08.
  elsif event.event_type = 'booking_agreement.code' then
    critical := false;
    for rec in
      select attendee.email,
             code.id as code_id,
             code.expires_at,
             code.verified_at,
             agreement.status as agreement_status,
             not exists (
               select 1 from public.booking_agreement_codes newer
               where newer.booking_agreement_id = code.booking_agreement_id and newer.created_at > code.created_at
             ) as newest,
             pref.email_notices is distinct from false as email_notices
      from public.booking_agreement_codes code
      join public.booking_agreements agreement
        on agreement.id = code.booking_agreement_id
       and agreement.organization_id = code.organization_id
      join public.booking_attendees attendee
        on attendee.booking_id = agreement.booking_id
       and attendee.organization_id = agreement.organization_id
       and attendee.role = 'primary'
      left join public.person_contact_preferences pref
        on pref.person_id = attendee.person_id
      where code.id::text = event.payload ->> 'code_id'
        and code.booking_agreement_id::text = event.payload ->> 'booking_agreement_id'
        and code.organization_id = event.organization_id
    loop
      if length(coalesce(event.payload ->> 'sealed_code', '')) between 1 and 1024 then
        ctx := ctx || jsonb_build_object('sealed_code', event.payload ->> 'sealed_code', 'code_id', rec.code_id);
      end if;
      send_ok := rec.email_notices and rec.newest and rec.verified_at is null
        and rec.expires_at > statement_timestamp() and rec.agreement_status = 'sent';
      perform app.queue_email_delivery(
        event.id, event.organization_id, rec.email, template, null, false, ctx, send_ok
      );
    end loop;
  -- ORG-06: EX17 to each person on the matter with a portal account and an email, the same people
  -- the staff screen showed and who got the portal notice. No names, nothing about the matter:
  -- the portal says who. Honours "Email notices".
  elsif event.event_type = 'matter.consultant_changed' then
    for rec in
      select lower(person.email) as email,
             bool_or(pref.email_notices is distinct from false) as email_notices
      from public.matter_participants party
      join public.persons person
        on person.id = party.person_id
       and person.organization_id = party.organization_id
      left join public.person_contact_preferences pref
        on pref.person_id = person.id
      where party.matter_id = matter
        and party.organization_id = event.organization_id
        and person.user_id is not null
        and person.email is not null
      group by lower(person.email)
    loop
      perform app.queue_email_delivery(
        event.id, event.organization_id, rec.email, template, matter, false, ctx, rec.email_notices
      );
    end loop;
  -- CRM-01: EX18 to each active firm owner, and the lead's owner when it has one: the firm name
  -- and a link to the Pipeline only, never what the enquirer wrote. Staff mail (audience staff).
  elsif event.event_type = 'lead.enquiry_received' then
    ctx := ctx || jsonb_build_object('audience', 'staff');
    for rec in
      select distinct lower(users.email) as email
      from public.memberships member
      join auth.users users on users.id = member.user_id
      where member.organization_id = event.organization_id
        and member.status = 'active'
        and users.email is not null
        and (
          member.role = 'firm_owner'
          or member.id = (
            select lead.owner_membership_id from public.leads lead
            where lead.id::text = event.payload ->> 'lead_id' and lead.organization_id = event.organization_id
          )
        )
    loop
      perform app.queue_email_delivery(
        event.id, event.organization_id, rec.email, template, null, false, ctx, true
      );
    end loop;
  -- OPS-04: EX19 to each person the announcement went to who was to be emailed, firm name only
  -- (the announcement is in the portal). Never for a sample-mode firm's announcement; "Email
  -- notices" is checked again now.
  elsif event.event_type = 'announcement.sent' then
    for rec in
      select lower(person.email) as email,
             bool_and(not announcement.is_sample) and bool_or(coalesce((
               select pref.email_notices is distinct from false
               from public.person_contact_preferences pref
               where pref.person_id = person.id
               limit 1
             ), true)) as send_now
      from public.announcement_deliveries delivery
      join public.announcements announcement
        on announcement.id = delivery.announcement_id
       and announcement.organization_id = delivery.organization_id
      join public.persons person
        on person.id = delivery.person_id
       and person.organization_id = delivery.organization_id
      where announcement.id::text = event.payload ->> 'announcement_id'
        and announcement.organization_id = event.organization_id
        and delivery.emailed
        and person.email is not null
      group by lower(person.email)
    loop
      perform app.queue_email_delivery(
        event.id, event.organization_id, rec.email, template, null, false, ctx, rec.send_now
      );
    end loop;
  end if;

  if not exists (
    select 1 from public.email_deliveries delivery
    where delivery.outbox_event_id = event.id
      and delivery.status = 'sending'
  ) then
    perform app.mark_outbox_published(event.id, p_worker);
    -- sealed invitation link: nothing will be sent, so nothing needs it.
    perform app.scrub_invitation_link(event.id);
    perform app.record_audit_event(
      event.organization_id, 'email.skipped', 'public.outbox_events', event.id, 'success',
      jsonb_build_object('template', template, 'reason', 'no_recipient')
    );
    return jsonb_build_object('action', 'done', 'event_id', event.id, 'messages', '[]'::jsonb);
  end if;

  reply := app.firm_reply_address(event.organization_id, matter, domain);
  select coalesce(jsonb_agg(jsonb_build_object(
    'delivery_id', delivery.id,
    'to', delivery.recipient_email,
    'from_address', from_addr,
    'from_name', firm_name,
    'reply_to_address', reply,
    'reply_to_name', firm_name,
    'template', delivery.template,
    'context', delivery.context
  -- inbox replies: body, subject and headers of a staff email (empty for every other event).
  ) || extra), '[]'::jsonb)
  into messages
  from public.email_deliveries delivery
  where delivery.outbox_event_id = event.id
    and delivery.status = 'sending';

  return jsonb_build_object('action', 'send', 'event_id', event.id, 'messages', messages);
end;
$$;
