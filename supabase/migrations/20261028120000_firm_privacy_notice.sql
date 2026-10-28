-- #263-A: a privacy notice for each firm, required before its public booking and enquiry pages.
--
-- The notice is the firm's existing privacy notice (public.portal_policy_documents, kind
-- 'privacy_notice', published through public.publish_portal_policy, shown at /privacy/<firm> by
-- public.public_privacy_notice). No second store: this migration adds unpublishing, the rule that
-- public pages need a published notice, and a warning period for firms whose booking pages are
-- already live without one.
--
--   organizations.privacy_notice_withdrawn_at  set by unpublish_privacy_notice: versions published
--                                              at or before it are no longer current (published
--                                              text itself never changes); publishing a new
--                                              version makes that one current again.
--   organizations.privacy_notice_due_at        the end of the warning period. Until then a firm's
--                                              live booking pages stay open without a notice; after
--                                              it they show "not available" until the firm
--                                              publishes one. Set below for existing firms with
--                                              live booking pages and no notice (30 days from when
--                                              this migration is applied); null for everyone else.
--                                              Change it per firm with an update to move the date.
--   app.firm_privacy_notice_published(org)     whether the firm has a current privacy notice.
--   app.firm_booking_pages_open(org)           a notice, or still inside the warning period.
--   app.current_portal_policy                  redefined: skips withdrawn privacy notices.
--   unpublish_privacy_notice(org)              firm owner + step-up; refused while the enquiry page
--                                              or a live booking page is on; audited
--                                              'privacy_notice.unpublished'.
--   set_enquiry_page_enabled                   redefined: turning it on needs a published notice.
--   save_booking_event_type                    redefined: publishing a booking type that is not
--                                              already live needs a published notice (practice
--                                              types in sample mode are not public and are exempt).
--   enquiry_public_firm                        redefined: a withdrawn notice counts as none.
--   booking_public_event, booking_public_event_types, booking_public_busy, booking_public_hold
--                                              redefined: a live firm's pages need
--                                              app.firm_booking_pages_open; booking_public_event
--                                              adds privacy_notice (the page links it) and
--                                              booking_public_event_types adds held (live pages
--                                              closed for want of a notice).

alter table public.organizations add column privacy_notice_withdrawn_at timestamptz;
comment on column public.organizations.privacy_notice_withdrawn_at is
  '#263-A: when the firm owner last unpublished its privacy notice (unpublish_privacy_notice). Privacy notice versions published at or before it are not current.';

alter table public.organizations add column privacy_notice_due_at timestamptz;
comment on column public.organizations.privacy_notice_due_at is
  '#263-A: end of the warning period for a firm whose booking pages were live before a privacy notice was required. Until then they stay open without one; after it they are closed until a notice is published. Null: no warning period.';

-- The warning period: firms whose booking pages are live today and have no privacy notice.
update public.organizations org
   set privacy_notice_due_at = now() + interval '30 days'
 where not exists (
         select 1 from public.portal_policy_documents doc
         where doc.organization_id = org.id and doc.kind = 'privacy_notice'
       )
   and exists (
         select 1 from public.booking_event_types et
         where et.organization_id = org.id and et.is_published and et.archived_at is null and not et.is_sample
       );

-- app.current_portal_policy(uuid, text), last defined in 20261017140800_portal_invitations.sql:
-- + a privacy notice published at or before the firm's withdrawal is not current.
create or replace function app.current_portal_policy(p_org uuid, p_kind text)
returns public.portal_policy_documents
language sql
stable
security definer
set search_path = ''
as $$
  select doc.*
  from public.portal_policy_documents doc
  where doc.organization_id = p_org
    and doc.kind = p_kind
    and (
      p_kind <> 'privacy_notice'
      or doc.published_at > coalesce(
        (select o.privacy_notice_withdrawn_at from public.organizations o where o.id = p_org),
        '-infinity'::timestamptz
      )
    )
  order by doc.published_at desc, doc.id desc
  limit 1;
$$;
revoke all on function app.current_portal_policy(uuid, text) from public;

create function app.firm_privacy_notice_published(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (app.current_portal_policy(p_org, 'privacy_notice')).id is not null;
$$;
comment on function app.firm_privacy_notice_published(uuid) is
  '#263-A: the firm has a current (published, not withdrawn) privacy notice.';
revoke all on function app.firm_privacy_notice_published(uuid) from public;

create function app.firm_booking_pages_open(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.firm_privacy_notice_published(p_org)
      or coalesce((select o.privacy_notice_due_at > now() from public.organizations o where o.id = p_org), false);
$$;
comment on function app.firm_booking_pages_open(uuid) is
  '#263-A: a live firm''s public booking pages take bookings: it has a privacy notice, or its warning period (organizations.privacy_notice_due_at) has not ended.';
revoke all on function app.firm_booking_pages_open(uuid) from public;

create function public.unpublish_privacy_notice(p_organization_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  doc public.portal_policy_documents;
  org public.organizations%rowtype;
begin
  perform app.require_firm_owner_step_up(p_organization_id);
  select * into org from public.organizations o where o.id = p_organization_id for update;
  doc := app.current_portal_policy(p_organization_id, 'privacy_notice');
  if doc.id is null then
    raise exception 'no privacy notice is published' using errcode = 'P0002';
  end if;
  if org.enquiry_page_enabled is true or exists (
       select 1 from public.booking_event_types et
       where et.organization_id = p_organization_id and et.is_published and et.archived_at is null and not et.is_sample
     ) then
    raise exception 'turn off the enquiry page and booking pages before you unpublish the privacy notice' using errcode = '55000';
  end if;
  update public.organizations set privacy_notice_withdrawn_at = now() where id = p_organization_id;
  perform app.record_audit_event(p_organization_id, 'privacy_notice.unpublished', 'public.portal_policy_documents', doc.id, 'success',
    jsonb_build_object('version_label', doc.version_label));
end;
$$;
comment on function public.unpublish_privacy_notice(uuid) is
  '#263-A: firm owner + step-up. Takes the firm''s privacy notice down (public page and portal acceptance) while its enquiry page and live booking pages are off. Published versions stay on record. Audited.';
revoke all on function public.unpublish_privacy_notice(uuid) from public, anon;
grant execute on function public.unpublish_privacy_notice(uuid) to authenticated;

-- public.set_enquiry_page_enabled(uuid, boolean), last defined in 20261024140000_enquiry_page_controls.sql:
-- + turning the page on needs a published privacy notice.
create or replace function public.set_enquiry_page_enabled(p_organization_id uuid, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_firm_owner_step_up(p_organization_id);
  if p_enabled is null then
    raise exception 'choose on or off' using errcode = '22023';
  end if;
  -- #263-A: the enquiry page links the firm's privacy notice, so it can't be turned on without one.
  if p_enabled and not app.firm_privacy_notice_published(p_organization_id) then
    raise exception 'publish a privacy notice before you turn on the enquiry page' using errcode = '55000';
  end if;
  update public.organizations set enquiry_page_enabled = p_enabled where id = p_organization_id and enquiry_page_enabled is distinct from p_enabled;
  if found then
    perform app.record_audit_event(p_organization_id, 'firm.enquiry_page_changed', 'public.organizations', p_organization_id, 'success',
      jsonb_build_object('enabled', p_enabled));
  end if;
end;
$$;

-- public.enquiry_public_firm(text), last defined in 20261024140000_enquiry_page_controls.sql:
-- + the privacy notice must be current (not withdrawn).
create or replace function public.enquiry_public_firm(p_firm_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'firm_name', org.display_name,
    'firm_slug', org.slug,
    'practice', org.sample_mode,
    'staff', app.booking_practice_viewer(org.id),
    'open', org.enquiry_page_enabled
  )
  from public.organizations org
  where org.slug = lower(btrim(coalesce(p_firm_slug, '')))
    and app.firm_privacy_notice_published(org.id)
    and app.lead_stage_of_kind(org.id, 'open') is not null
    and (org.sample_mode is not true or app.booking_practice_viewer(org.id));
$$;

-- public.save_booking_event_type(...17 arguments), last defined in 20261023090000_version_conflicts_not_retried.sql:
-- + a booking type that isn't live yet can't be published without a privacy notice (practice
-- types in sample mode are exempt: only the firm's staff can open them).
create or replace function public.save_booking_event_type(
  p_org uuid,
  p_event_type_id uuid,
  p_expected_version integer,
  p_title text,
  p_slug text,
  p_description text,
  p_duration_min integer,
  p_slot_step_min integer,
  p_buffer_before_min integer,
  p_buffer_after_min integer,
  p_min_notice_min integer,
  p_max_advance_days integer,
  p_daily_capacity integer,
  p_location_kind public.booking_location_kind,
  p_location_detail text,
  p_host_membership_ids uuid[],
  p_publish boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  sample boolean;
  et public.booking_event_types%rowtype;
  hosts uuid[] := coalesce(p_host_membership_ids, array[]::uuid[]);
  v_slug text := lower(btrim(coalesce(p_slug, '')));
  rid uuid;
  i integer;
begin
  perform app.require_firm_owner_step_up(p_org);
  if array_length(hosts, 1) is not null and (
       array_length(hosts, 1) > 20
       or (select count(distinct x) from unnest(hosts) x) <> array_length(hosts, 1)
       or exists (
         select 1 from unnest(hosts) x
         where not exists (
           select 1 from public.memberships m
           where m.id = x and m.organization_id = p_org and m.status = 'active'
             and m.role = any (app.scheduling_staff_roles())
         )
       )) then
    raise exception 'choose active staff as hosts' using errcode = '22023';
  end if;
  if coalesce(p_publish, false) and array_length(hosts, 1) is null then
    raise exception 'a published booking type needs a host' using errcode = '22023';
  end if;
  select org.sample_mode into sample from public.organizations org where org.id = p_org;
  if p_location_kind = 'meeting_link' and coalesce(btrim(p_location_detail), '') !~ '^https://[^\s]+$' then
    raise exception 'a meeting link must start with https://' using errcode = '22023';
  end if;

  if p_event_type_id is null then
    -- #263-A: a new public booking page needs the firm's privacy notice.
    if coalesce(p_publish, false) and not coalesce(sample, false) and not app.firm_privacy_notice_published(p_org) then
      raise exception 'publish a privacy notice before you publish a booking page' using errcode = '55000';
    end if;
    insert into public.booking_event_types (
      organization_id, slug, title, description, duration_min, slot_step_min, buffer_before_min, buffer_after_min,
      min_notice_min, max_advance_days, daily_capacity, location_kind, location_detail, is_published, is_sample
    ) values (
      p_org, v_slug, btrim(coalesce(p_title, '')), nullif(btrim(coalesce(p_description, '')), ''), p_duration_min, p_slot_step_min,
      coalesce(p_buffer_before_min, 0), coalesce(p_buffer_after_min, 0), coalesce(p_min_notice_min, 1440),
      coalesce(p_max_advance_days, 60), p_daily_capacity, coalesce(p_location_kind, 'video'),
      nullif(btrim(coalesce(p_location_detail, '')), ''), coalesce(p_publish, false), coalesce(sample, false)
    )
    returning id into rid;
  else
    select * into et from public.booking_event_types where id = p_event_type_id and organization_id = p_org for update;
    if et.id is null then
      raise exception 'booking type not found' using errcode = 'P0002';
    end if;
    if p_expected_version is not null and et.version <> p_expected_version then
      raise exception 'this booking type was changed by someone else; reload' using errcode = 'PT409';
    end if;
    -- #263-A: turning a booking page on needs the privacy notice; a page already live (warning
    -- period) can still be edited.
    if coalesce(p_publish, false) and not et.is_published and not et.is_sample and not app.firm_privacy_notice_published(p_org) then
      raise exception 'publish a privacy notice before you publish a booking page' using errcode = '55000';
    end if;
    update public.booking_event_types
       set slug = v_slug,
           title = btrim(coalesce(p_title, '')),
           description = nullif(btrim(coalesce(p_description, '')), ''),
           duration_min = p_duration_min,
           slot_step_min = p_slot_step_min,
           buffer_before_min = coalesce(p_buffer_before_min, 0),
           buffer_after_min = coalesce(p_buffer_after_min, 0),
           min_notice_min = coalesce(p_min_notice_min, 1440),
           max_advance_days = coalesce(p_max_advance_days, 60),
           daily_capacity = p_daily_capacity,
           location_kind = coalesce(p_location_kind, 'video'),
           location_detail = nullif(btrim(coalesce(p_location_detail, '')), ''),
           is_published = coalesce(p_publish, false)
     where id = et.id;
    rid := et.id;
  end if;

  delete from public.booking_event_type_hosts host
   where host.event_type_id = rid and not (host.membership_id = any (hosts));
  for i in 1 .. coalesce(array_length(hosts, 1), 0) loop
    insert into public.booking_event_type_hosts (organization_id, event_type_id, membership_id, position)
    values (p_org, rid, hosts[i], i)
    on conflict (event_type_id, membership_id) do update set position = excluded.position;
  end loop;

  -- practice booking pages: the audit row says whether the published page is a practice page.
  perform app.record_audit_event(p_org, 'booking_type.saved', 'public.booking_event_types', rid, 'success',
    jsonb_build_object('published', coalesce(p_publish, false), 'hosts', coalesce(array_length(hosts, 1), 0),
                       'practice', (select t.is_sample from public.booking_event_types t where t.id = rid)));
  return rid;
end;
$$;

-- public.booking_public_event(text, text), last defined in 20261019190000_booking_practice_pages.sql:
-- + a live firm's page needs app.firm_booking_pages_open; + privacy_notice for the page's link.
create or replace function public.booking_public_event(p_firm_slug text, p_event_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'event_type_id', et.id,
    'firm_name', org.display_name,
    'firm_slug', org.slug,
    'firm_time_zone', org.timezone,
    'slug', et.slug,
    'title', et.title,
    'description', et.description,
    'duration_min', et.duration_min,
    'location_kind', et.location_kind,
    'location_detail', case when et.location_kind = 'in_person' then et.location_detail end,
    'price_cents', et.price_cents,
    'currency', et.currency,
    'min_notice_min', et.min_notice_min,
    'max_advance_days', et.max_advance_days,
    'practice', et.is_sample,
    'privacy_notice', app.firm_privacy_notice_published(org.id)
  )
  from public.booking_event_types et
  join public.organizations org on org.id = et.organization_id
  where org.slug = lower(btrim(coalesce(p_firm_slug, '')))
    and et.slug = lower(btrim(coalesce(p_event_slug, '')))
    and et.is_published
    and (not et.is_sample or app.booking_practice_viewer(et.organization_id))
    and (et.is_sample or app.firm_booking_pages_open(et.organization_id))
    and et.archived_at is null
    and et.price_cents = 0;
$$;

-- public.booking_public_event_types(text), last defined in 20261019190000_booking_practice_pages.sql:
-- + a live firm's types are listed only while app.firm_booking_pages_open; held says some are
-- closed for want of a privacy notice.
create or replace function public.booking_public_event_types(p_firm_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'firm_name', org.display_name,
    'firm_slug', org.slug,
    'types', coalesce((
      select jsonb_agg(jsonb_build_object('slug', et.slug, 'title', et.title, 'description', et.description,
                                          'duration_min', et.duration_min, 'location_kind', et.location_kind,
                                          'practice', et.is_sample)
                       order by et.title)
      from public.booking_event_types et
      where et.organization_id = org.id and et.is_published and et.archived_at is null and et.price_cents = 0
        and (not et.is_sample or app.booking_practice_viewer(org.id))
        and (et.is_sample or open_state.open)
    ), '[]'::jsonb),
    'held', not open_state.open and exists (
      select 1 from public.booking_event_types et
      where et.organization_id = org.id and et.is_published and et.archived_at is null and et.price_cents = 0 and not et.is_sample
    )
  )
  from public.organizations org
  cross join lateral (select app.firm_booking_pages_open(org.id) as open) open_state
  where org.slug = lower(btrim(coalesce(p_firm_slug, '')));
$$;

-- public.booking_public_busy(uuid, timestamptz, timestamptz), last defined in 20261019190000_booking_practice_pages.sql:
-- + a live firm's page needs app.firm_booking_pages_open.
create or replace function public.booking_public_busy(p_event_type_id uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.booking_event_types et
    where et.id = p_event_type_id and et.is_published and et.archived_at is null and et.price_cents = 0
      and (not et.is_sample or app.booking_practice_viewer(et.organization_id))
      and (et.is_sample or app.firm_booking_pages_open(et.organization_id))
  ) then
    raise exception 'booking type not found' using errcode = 'P0002';
  end if;
  return app.booking_availability(p_event_type_id, p_from, p_to, null, false);
end;
$$;

-- public.booking_public_hold(...9 arguments), last defined in 20261023190000_booking_agreement_mail.sql:
-- + a live firm's page needs app.firm_booking_pages_open.
create or replace function public.booking_public_hold(
  p_firm_slug text,
  p_event_slug text,
  p_start timestamptz,
  p_name text,
  p_email text,
  p_phone text,
  p_time_zone text,
  p_idempotency_key text,
  p_client_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  et public.booking_event_types%rowtype;
  key text := btrim(coalesce(p_idempotency_key, ''));
  v_email text := lower(btrim(coalesce(p_email, '')));
  zone text := btrim(coalesce(p_time_zone, ''));
  hash text := nullif(lower(btrim(coalesce(p_client_hash, ''))), '');
  existing public.bookings%rowtype;
  me uuid;
  bid uuid;
begin
  select et2.* into et
  from public.booking_event_types et2
  join public.organizations org on org.id = et2.organization_id
  where org.slug = lower(btrim(coalesce(p_firm_slug, '')))
    and et2.slug = lower(btrim(coalesce(p_event_slug, '')))
    and et2.is_published and et2.archived_at is null
    and (not et2.is_sample or app.booking_practice_viewer(et2.organization_id))
    and (et2.is_sample or app.firm_booking_pages_open(et2.organization_id));
  if et.id is null then
    raise exception 'booking type not found' using errcode = 'P0002';
  end if;
  if et.price_cents > 0 then
    raise exception 'paid consultations are not available yet' using errcode = '22023';
  end if;
  if length(key) not between 8 and 180 then
    raise exception 'idempotency key is required' using errcode = '22023';
  end if;
  if hash is not null and hash !~ '^[0-9a-f]{64}$' then
    hash := null;
  end if;

  select * into existing from public.bookings b where b.organization_id = et.organization_id and b.idempotency_key = key;
  if existing.id is not null then
    if existing.starts_at <> p_start or not exists (
      select 1 from public.booking_attendees a where a.booking_id = existing.id and a.role = 'primary' and a.email = v_email
    ) then
      raise exception 'idempotency key reused for a different booking' using errcode = '22023';
    end if;
    return app.booking_summary(existing.id);
  end if;

  -- Basic abuse limits: 8 requests per client address and 60 per firm in 10 minutes. From here on
  -- a refusal is returned, not raised, so the attempt row (and the audit row) are kept and count.
  insert into public.booking_hold_attempts (organization_id, client_hash) values (et.organization_id, hash);
  if (hash is not null and (
        select count(*) from public.booking_hold_attempts a
        where a.client_hash = hash and a.created_at > now() - interval '10 minutes') > 8)
     or (select count(*) from public.booking_hold_attempts a
         where a.organization_id = et.organization_id and a.created_at > now() - interval '10 minutes') > 60 then
    return jsonb_build_object('error', 'booking_rate_limited');
  end if;

  if p_name is null or length(btrim(p_name)) not between 1 and 200 then
    return jsonb_build_object('error', 'name_required');
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 320 then
    return jsonb_build_object('error', 'email_invalid');
  end if;
  if p_phone is not null and btrim(p_phone) <> '' and btrim(p_phone) !~ '^[0-9+() .-]{3,40}$' then
    return jsonb_build_object('error', 'phone_invalid');
  end if;
  if not app.is_time_zone(zone) then
    return jsonb_build_object('error', 'time_zone_invalid');
  end if;

  -- A signed-in portal client of this firm booking for themselves is linked to their own person.
  if (select auth.uid()) is not null then
    select person.id into me
    from public.persons person
    where person.organization_id = et.organization_id and person.user_id = (select auth.uid());
  end if;

  -- practice booking pages: a booking on a practice page is a sample booking.
  bid := app.place_booking(et.id, p_start, p_name, v_email, p_phone, zone, me, 'public', 'client', key, et.is_sample, true);
  if bid is null then
    perform app.booking_audit(et.organization_id, 'booking.slot_unavailable', null, 'denied',
      jsonb_build_object('event_type_id', et.id, 'starts_at', p_start));
    return jsonb_build_object('error', 'slot_unavailable');
  end if;
  perform app.confirm_booking(bid, 'client');
  -- booking type agreement: the type's approved consultation agreement is sent with the booking,
  -- for the booker to sign from the confirmation page or the email.
  if et.agreement_template_id is not null then
    perform app.issue_booking_agreement(bid, et.agreement_template_id, null, false);
  end if;
  return app.booking_summary(bid);
end;
$$;
