-- Google Meet / Microsoft Teams links on a booking, and a Calendly import onto the firm calendar.
-- Outlook busy-time sync is not part of this migration.
--
-- A provider booking is left held (not confirmed) until the app has stored a real join link from
-- the host's connected account. Confirming without that link is refused. Reschedule keeps the
-- same link: the allowlisted Composio actions can create a Meet space or a Teams meeting, not
-- update or cancel one. Cancelling the Casevoya booking does not call the provider.
--
-- Calendly rows are scheduled-event copies for the firm calendar. They are not bookings, people,
-- matters, or Google busy times, and nothing is written back to Calendly.
--
-- Rollback (manual, not applied here):
--   drop function public.sheet_calendar_providers(uuid, timestamptz, timestamptz);
--   drop function public.replace_calendly_import(uuid, timestamptz, timestamptz, jsonb, boolean);
--   drop function public.release_provider_booking(uuid);
--   drop function public.confirm_provider_booking(uuid);
--   drop function public.store_booking_meeting(uuid, text);
--   drop function public.begin_booking_meeting(uuid);
--   drop function app.guard_provider_booking_type(uuid);
--   drop function app.booking_type_provider_guard();
--   drop function app.booking_type_host_provider_guard();
--   drop table public.booking_provider_meetings;
--   drop table public.calendly_sync_state;
--   drop table public.calendly_imported_events;
--   restore public.booking_public_hold and public.staff_book_consultation from
--   20261031017000_coapplicant_attach_credit_reservations_viewer_mfa.sql and
--   20261019180100_scheduling_core.sql.
--   The enum values from the previous migration cannot be removed.

-- Longer Teams join URLs do not fit the original 300-character check.
do $$
declare
  r record;
begin
  for r in
    select nsp.nspname as schema_name, rel.relname, con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname in ('bookings', 'booking_event_types')
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%location_detail%'
      and pg_get_constraintdef(con.oid) like '%300%'
  loop
    execute format('alter table %I.%I drop constraint %I', r.schema_name, r.relname, r.conname);
  end loop;
end $$;

alter table public.bookings
  add constraint bookings_location_detail_len check (location_detail is null or length(location_detail) <= 1000);
alter table public.booking_event_types
  add constraint booking_event_types_location_detail_len check (location_detail is null or length(location_detail) <= 1000);

alter table public.bookings
  add constraint bookings_provider_link check (
    status <> 'confirmed'
    or location_kind not in ('google_meet', 'microsoft_teams')
    or location_detail ~ '^https://[^[:space:]]+$'
  );

-- ---------------------------------------------------------------------------
-- One provider meeting per booking. The join URL is written only after the provider answers.
-- ---------------------------------------------------------------------------

create table public.booking_provider_meetings (
  booking_id uuid primary key,
  organization_id uuid not null,
  host_membership_id uuid not null,
  provider text not null check (provider in ('google_meet', 'microsoft_teams')),
  status text not null check (status in ('pending', 'ready', 'failed')),
  join_url text check (join_url is null or length(join_url) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (booking_id, organization_id) references public.bookings (id, organization_id),
  foreign key (host_membership_id, organization_id) references public.memberships (id, organization_id),
  check (
    (status = 'ready' and join_url is not null)
    or (status <> 'ready' and join_url is null)
  )
);
comment on table public.booking_provider_meetings is
  'The host''s Google Meet or Teams link for one booking. One row, so a retry cannot create a second meeting for that booking. No attendee list is stored.';
create index booking_provider_meetings_org_idx on public.booking_provider_meetings (organization_id);
create index booking_provider_meetings_host_org_idx on public.booking_provider_meetings (host_membership_id, organization_id);

alter table public.booking_provider_meetings enable row level security;
alter table public.booking_provider_meetings force row level security;
revoke all on public.booking_provider_meetings from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Calendly scheduled events copied onto the firm calendar. Not a booking and not busy time.
-- ---------------------------------------------------------------------------

create table public.calendly_imported_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  membership_id uuid not null,
  external_uri text not null check (external_uri ~ '^https://api\.calendly\.com/scheduled_events/[A-Za-z0-9_-]{1,80}$'),
  name text not null check (length(btrim(name)) between 1 and 200),
  status text not null check (status in ('active', 'canceled')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, external_uri),
  check (ends_at > starts_at),
  foreign key (membership_id, organization_id) references public.memberships (id, organization_id)
);
comment on table public.calendly_imported_events is
  'A copy of one staff member''s Calendly scheduled events (name and time only). Not written back to Calendly, and not a Casevoya client, matter, or booking.';
create index calendly_imported_events_org_starts_idx on public.calendly_imported_events (organization_id, starts_at);
create index calendly_imported_events_member_org_idx on public.calendly_imported_events (membership_id, organization_id);

create table public.calendly_sync_state (
  membership_id uuid primary key,
  organization_id uuid not null,
  last_synced_at timestamptz,
  last_error text check (last_error is null or length(last_error) <= 200),
  imported_count integer not null default 0 check (imported_count >= 0),
  truncated boolean not null default false,
  foreign key (membership_id, organization_id) references public.memberships (id, organization_id)
);
comment on table public.calendly_sync_state is
  'When this member last imported Calendly, how many events were in that import, and whether the page was cut off.';
create index calendly_sync_state_org_idx on public.calendly_sync_state (organization_id);

alter table public.calendly_imported_events enable row level security;
alter table public.calendly_imported_events force row level security;
alter table public.calendly_sync_state enable row level security;
alter table public.calendly_sync_state force row level security;
revoke all on public.calendly_imported_events from public, anon, authenticated;
revoke all on public.calendly_sync_state from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Publishing a Meet or Teams type requires the firm switch and every host's connection.
-- ---------------------------------------------------------------------------

create function app.guard_provider_booking_type(p_event_type_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  et public.booking_event_types%rowtype;
  needed text;
begin
  select * into et from public.booking_event_types where id = p_event_type_id;
  if et.id is null or et.location_kind not in ('google_meet', 'microsoft_teams') or not et.is_published then
    return;
  end if;
  if not exists (
    select 1 from public.vo_settings s where s.organization_id = et.organization_id and s.composio_enabled
  ) then
    raise exception 'the firm owner has not turned on connected accounts' using errcode = '42501';
  end if;
  if not exists (select 1 from public.booking_event_type_hosts h where h.event_type_id = et.id) then
    raise exception 'a published booking type needs a host' using errcode = '22023';
  end if;
  needed := case et.location_kind when 'google_meet' then 'googlemeet' else 'microsoft_teams' end;
  if exists (
    select 1 from public.booking_event_type_hosts h
    where h.event_type_id = et.id
      and not exists (
        select 1 from public.staff_connections c
        where c.membership_id = h.membership_id
          and c.organization_id = et.organization_id
          and c.status = 'active'
          and c.toolkit = needed
      )
  ) then
    raise exception 'connect that meeting account for every host first' using errcode = '42501';
  end if;
end;
$$;
revoke all on function app.guard_provider_booking_type(uuid) from public;

create function app.booking_type_provider_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.location_kind in ('google_meet', 'microsoft_teams') and coalesce(btrim(new.location_detail), '') <> '' then
    raise exception 'the meeting link is created when someone books' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function app.booking_type_provider_guard() from public;

create trigger booking_event_types_provider
  after insert or update of location_kind, location_detail on public.booking_event_types
  for each row execute function app.booking_type_provider_guard();

-- Deferred so a save can replace hosts in the same transaction before the check runs.
create function app.booking_type_publish_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.guard_provider_booking_type(new.id);
  return new;
end;
$$;
revoke all on function app.booking_type_publish_guard() from public;

create constraint trigger booking_event_types_provider_hosts
  after insert or update of location_kind, is_published on public.booking_event_types
  deferrable initially deferred
  for each row execute function app.booking_type_publish_guard();

create function app.booking_type_host_provider_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.guard_provider_booking_type(coalesce(new.event_type_id, old.event_type_id));
  return coalesce(new, old);
end;
$$;
revoke all on function app.booking_type_host_provider_guard() from public;

create constraint trigger booking_event_type_hosts_provider
  after insert or update or delete on public.booking_event_type_hosts
  deferrable initially deferred
  for each row execute function app.booking_type_host_provider_guard();

-- ---------------------------------------------------------------------------
-- Leave a provider booking held until the link exists. Same signatures as before.
-- ---------------------------------------------------------------------------

create or replace function public.staff_book_consultation(
  p_org uuid,
  p_event_type_id uuid,
  p_person_id uuid,
  p_start timestamptz,
  p_time_zone text,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  person public.persons%rowtype;
  key text := btrim(coalesce(p_idempotency_key, ''));
  zone text := btrim(coalesce(p_time_zone, ''));
  existing uuid;
  bid uuid;
  kind public.booking_location_kind;
begin
  perform app.require_active_staff(p_org, app.scheduling_staff_roles(), false);
  select et.location_kind into kind
  from public.booking_event_types et
  where et.id = p_event_type_id and et.organization_id = p_org and et.archived_at is null;
  if kind is null then
    raise exception 'booking type not found' using errcode = 'P0002';
  end if;
  if length(key) not between 8 and 180 then
    raise exception 'idempotency key is required' using errcode = '22023';
  end if;
  select b.id into existing from public.bookings b where b.organization_id = p_org and b.idempotency_key = key;
  if existing is not null then
    return existing;
  end if;
  select * into person from public.persons where id = p_person_id and organization_id = p_org;
  if person.id is null or app.can_read_person(person.id) is distinct from true then
    raise exception 'choose a client you can see' using errcode = '42501';
  end if;
  if person.email is null then
    raise exception 'this client has no email address' using errcode = '22023';
  end if;
  if app.sample_mode_blocks_real(p_org, person.is_sample) then
    raise exception 'this firm is in sample mode; only sample people can be booked' using errcode = '42501';
  end if;
  if not app.is_time_zone(zone) then
    raise exception 'choose a time zone' using errcode = '22023';
  end if;
  bid := app.place_booking(p_event_type_id, p_start, person.display_name, person.email, null, zone, person.id,
                           'staff', 'staff', key, person.is_sample, false);
  if bid is null then
    raise exception 'slot_unavailable' using errcode = 'P0001';
  end if;
  -- Meet and Teams stay held until the app stores the host's join link and confirms.
  if kind not in ('google_meet', 'microsoft_teams') then
    perform app.confirm_booking(bid, 'staff');
  end if;
  return bid;
end;
$$;

create or replace function public.booking_public_hold(
  p_firm_slug text,
  p_event_slug text,
  p_start timestamptz,
  p_name text,
  p_email text,
  p_phone text,
  p_time_zone text,
  p_idempotency_key text,
  p_client_hash text,
  p_viewer uuid,
  p_viewer_aal text default null
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
  hash text := app.public_client_bucket(p_client_hash);
  existing public.bookings%rowtype;
  me uuid;
  bid uuid;
begin
  perform app.require_service_role();
  perform set_config(
    'app.public_actor',
    coalesce((select u.id::text from auth.users u where u.id = p_viewer), 'public'),
    true
  );
  select et2.* into et
  from public.booking_event_types et2
  join public.organizations org on org.id = et2.organization_id
  where org.slug = lower(btrim(coalesce(p_firm_slug, '')))
    and et2.slug = lower(btrim(coalesce(p_event_slug, '')))
    and et2.is_published and et2.archived_at is null
    and (not et2.is_sample or app.public_viewer_is_staff(et2.organization_id, p_viewer, p_viewer_aal))
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

  select * into existing from public.bookings b where b.organization_id = et.organization_id and b.idempotency_key = key;
  if existing.id is not null then
    if existing.starts_at <> p_start or not exists (
      select 1 from public.booking_attendees a where a.booking_id = existing.id and a.role = 'primary' and a.email = v_email
    ) then
      raise exception 'idempotency key reused for a different booking' using errcode = '22023';
    end if;
    return app.booking_summary(existing.id);
  end if;

  insert into public.booking_hold_attempts (organization_id, client_hash) values (et.organization_id, hash);
  if (select count(*) from public.booking_hold_attempts a
      where a.client_hash = hash and a.created_at > now() - interval '10 minutes') > 8
     or (select coalesce(sum(least(per_address.n, 8)), 0) from (
           select count(*) as n from public.booking_hold_attempts a
           where a.organization_id = et.organization_id and a.created_at > now() - interval '10 minutes'
           group by a.client_hash
         ) per_address) > 60 then
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

  if p_viewer is not null
     and (
       app.public_viewer_assured(p_viewer_aal)
       or not exists (
         select 1 from auth.mfa_factors factor
         where factor.user_id = p_viewer and factor.status::text = 'verified'
       )
     ) then
    select person.id into me
    from public.persons person
    where person.organization_id = et.organization_id and person.user_id = p_viewer;
  end if;

  bid := app.place_booking(et.id, p_start, p_name, v_email, p_phone, zone, me, 'public', 'client', key, et.is_sample, true);
  if bid is null then
    perform app.booking_audit(et.organization_id, 'booking.slot_unavailable', null, 'denied',
      jsonb_build_object('event_type_id', et.id, 'starts_at', p_start));
    return jsonb_build_object('error', 'slot_unavailable');
  end if;
  if et.location_kind not in ('google_meet', 'microsoft_teams') then
    perform app.confirm_booking(bid, 'client');
    if et.agreement_template_id is not null then
      perform app.issue_booking_agreement(bid, et.agreement_template_id, null, false);
    end if;
  end if;
  return app.booking_summary(bid);
end;
$$;

-- ---------------------------------------------------------------------------
-- Service-role meeting steps. The app calls the provider; these functions only record the result.
-- ---------------------------------------------------------------------------

create function public.begin_booking_meeting(p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.bookings%rowtype;
  row_ public.booking_provider_meetings%rowtype;
  needed text;
begin
  perform app.require_service_role();
  select * into b from public.bookings where id = p_booking_id for update;
  if b.id is null then
    raise exception 'booking not found' using errcode = 'P0002';
  end if;
  if b.location_kind not in ('google_meet', 'microsoft_teams') then
    return jsonb_build_object('action', 'skip');
  end if;
  needed := case b.location_kind when 'google_meet' then 'googlemeet' else 'microsoft_teams' end;
  select * into row_ from public.booking_provider_meetings where booking_id = b.id for update;
  if b.status = 'confirmed' and b.location_detail is not null then
    return jsonb_build_object('action', 'ready', 'join_url', b.location_detail);
  end if;
  if row_.status = 'ready' and row_.join_url is not null then
    return jsonb_build_object('action', 'ready', 'join_url', row_.join_url);
  end if;
  if row_.status = 'pending' and row_.created_at > now() - interval '2 minutes' then
    return jsonb_build_object('action', 'pending');
  end if;
  if b.status <> 'held' then
    return jsonb_build_object('action', 'unavailable', 'message', 'This booking is no longer waiting for a meeting link.');
  end if;
  if not exists (
    select 1 from public.vo_settings s where s.organization_id = b.organization_id and s.composio_enabled
  ) or not exists (
    select 1 from public.staff_connections c
    where c.membership_id = b.host_membership_id
      and c.organization_id = b.organization_id
      and c.status = 'active'
      and c.toolkit = needed
  ) then
    return jsonb_build_object('action', 'unavailable', 'message', 'The host’s meeting account is not connected.');
  end if;
  if row_.booking_id is null then
    begin
      insert into public.booking_provider_meetings (booking_id, organization_id, host_membership_id, provider, status)
      values (b.id, b.organization_id, b.host_membership_id, b.location_kind::text, 'pending');
    exception when unique_violation then
      return jsonb_build_object('action', 'pending');
    end;
  else
    update public.booking_provider_meetings
       set status = 'pending', join_url = null, updated_at = now()
     where booking_id = b.id and status = 'failed';
    if not found and row_.status = 'pending' then
      -- Stale pending: do not start a second provider call for this booking.
      return jsonb_build_object('action', 'stale');
    end if;
  end if;
  return jsonb_build_object(
    'action', 'create',
    'organization_id', b.organization_id,
    'host_membership_id', b.host_membership_id,
    'provider', b.location_kind,
    'title', b.title,
    'starts_at', b.starts_at,
    'ends_at', b.ends_at
  );
end;
$$;
revoke all on function public.begin_booking_meeting(uuid) from public, anon, authenticated;
grant execute on function public.begin_booking_meeting(uuid) to service_role;

create function public.store_booking_meeting(p_booking_id uuid, p_join_url text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.bookings%rowtype;
  url text := btrim(coalesce(p_join_url, ''));
  host text;
begin
  perform app.require_service_role();
  select * into b from public.bookings where id = p_booking_id for update;
  if b.id is null or b.status <> 'held' or b.location_kind not in ('google_meet', 'microsoft_teams') then
    raise exception 'meeting link refused' using errcode = '22023';
  end if;
  if url !~ '^https://[^[:space:]]+$' or length(url) > 1000 then
    raise exception 'meeting link refused' using errcode = '22023';
  end if;
  -- Host only: reject userinfo (https://user@host) and ignore a port.
  host := lower(substring(url from '^https://([^/:@]+)'));
  if b.location_kind = 'google_meet' and host <> 'meet.google.com' then
    raise exception 'meeting link refused' using errcode = '22023';
  end if;
  if b.location_kind = 'microsoft_teams' and host <> 'teams.microsoft.com' and host <> 'teams.live.com' and host not like '%.teams.microsoft.com' then
    raise exception 'meeting link refused' using errcode = '22023';
  end if;
  if b.location_detail is not null and b.location_detail is distinct from url then
    raise exception 'meeting link refused' using errcode = '22023';
  end if;
  update public.booking_provider_meetings
     set status = 'ready', join_url = url, updated_at = now()
   where booking_id = b.id and organization_id = b.organization_id and host_membership_id = b.host_membership_id and status = 'pending';
  if not found then
    raise exception 'meeting link refused' using errcode = '22023';
  end if;
  update public.bookings set location_detail = url where id = b.id and organization_id = b.organization_id;
end;
$$;
revoke all on function public.store_booking_meeting(uuid, text) from public, anon, authenticated;
grant execute on function public.store_booking_meeting(uuid, text) to service_role;

create function public.confirm_provider_booking(p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.bookings%rowtype;
  et public.booking_event_types%rowtype;
begin
  perform app.require_service_role();
  select * into b from public.bookings where id = p_booking_id for update;
  if b.id is null then
    raise exception 'booking not found' using errcode = 'P0002';
  end if;
  if b.status = 'confirmed' then
    return app.booking_summary(b.id);
  end if;
  if b.status <> 'held' or b.location_kind not in ('google_meet', 'microsoft_teams') or b.location_detail is null then
    raise exception 'meeting link refused' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.booking_provider_meetings m
    where m.booking_id = b.id and m.organization_id = b.organization_id and m.status = 'ready' and m.join_url = b.location_detail
  ) then
    raise exception 'meeting link refused' using errcode = '22023';
  end if;
  perform app.confirm_booking(b.id, case when b.source = 'staff' then 'staff'::public.booking_actor else 'client'::public.booking_actor end);
  select * into et from public.booking_event_types where id = b.event_type_id;
  if et.agreement_template_id is not null then
    begin
      perform app.issue_booking_agreement(b.id, et.agreement_template_id, null, false);
    exception when others then
      null;
    end;
  end if;
  return app.booking_summary(b.id);
end;
$$;
revoke all on function public.confirm_provider_booking(uuid) from public, anon, authenticated;
grant execute on function public.confirm_provider_booking(uuid) to service_role;

create function public.release_provider_booking(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.bookings%rowtype;
begin
  perform app.require_service_role();
  select * into b from public.bookings where id = p_booking_id for update;
  if b.id is null or b.location_kind not in ('google_meet', 'microsoft_teams') then
    return;
  end if;
  if b.status = 'confirmed' then
    return;
  end if;
  if b.status = 'held' then
    update public.bookings
       set status = 'cancelled',
           cancelled_at = now(),
           cancelled_by = 'system',
           cancel_reason = 'The meeting link was not created',
           hold_expires_at = null,
           idempotency_key = left(idempotency_key, 120) || ':x:' || substr(replace(id::text, '-', ''), 1, 12)
     where id = b.id;
    insert into public.booking_events (organization_id, booking_id, kind, actor, actor_user_id, payload)
    values (b.organization_id, b.id, 'cancelled', 'system', null, jsonb_build_object('reason', 'meeting_link'));
  end if;
  update public.booking_provider_meetings
     set status = 'failed', join_url = null, updated_at = now()
   where booking_id = b.id and status = 'pending';
end;
$$;
revoke all on function public.release_provider_booking(uuid) from public, anon, authenticated;
grant execute on function public.release_provider_booking(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Calendly import for the signed-in member's own connection. Repeat imports upsert.
-- ---------------------------------------------------------------------------

create function public.replace_calendly_import(
  p_organization_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_events jsonb,
  p_complete boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  member uuid;
  item jsonb;
  uri text;
  name text;
  state text;
  starts timestamptz;
  ends timestamptz;
  seen text[] := array[]::text[];
  n integer := 0;
  dropped integer := 0;
begin
  perform app.require_active_staff(
    p_organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[],
    false
  );
  member := app.my_staff_membership(p_organization_id);
  if member is null then
    raise exception 'connection denied' using errcode = '42501';
  end if;
  if not exists (select 1 from public.vo_settings s where s.organization_id = p_organization_id and s.composio_enabled) then
    raise exception 'the firm owner has not turned on connected accounts' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.staff_connections c
    where c.membership_id = member and c.organization_id = p_organization_id and c.toolkit = 'calendly' and c.status = 'active'
  ) then
    raise exception 'connect that account first' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to <= p_from or p_to > p_from + interval '120 days' then
    raise exception 'choose a shorter import window' using errcode = '22023';
  end if;
  if jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) > 100 then
    raise exception 'too many events in one import' using errcode = '22023';
  end if;
  for item in select value from jsonb_array_elements(p_events)
  loop
    uri := item->>'uri';
    name := left(btrim(coalesce(item->>'name', '')), 200);
    state := item->>'status';
    starts := nullif(item->>'starts_at', '')::timestamptz;
    ends := nullif(item->>'ends_at', '')::timestamptz;
    if uri !~ '^https://api\.calendly\.com/scheduled_events/[A-Za-z0-9_-]{1,80}$' or name = '' or state not in ('active', 'canceled') or starts is null or ends is null or ends <= starts then
      raise exception 'an imported event was not usable' using errcode = '22023';
    end if;
    if starts < p_from - interval '2 days' or starts > p_to + interval '2 days' then
      continue;
    end if;
    insert into public.calendly_imported_events (organization_id, membership_id, external_uri, name, status, starts_at, ends_at)
    values (p_organization_id, member, uri, name, state, starts, ends)
    on conflict (organization_id, external_uri) do update
      set name = excluded.name,
          status = excluded.status,
          starts_at = excluded.starts_at,
          ends_at = excluded.ends_at,
          updated_at = now()
      where public.calendly_imported_events.membership_id = member
        and public.calendly_imported_events.organization_id = p_organization_id;
    if not found then
      raise exception 'that Calendly event belongs to another person' using errcode = '42501';
    end if;
    seen := seen || uri;
    n := n + 1;
  end loop;
  if coalesce(p_complete, false) then
    update public.calendly_imported_events e
       set status = 'canceled', updated_at = now()
     where e.organization_id = p_organization_id
       and e.membership_id = member
       and e.status = 'active'
       and e.starts_at >= p_from
       and e.starts_at < p_to
       and not (e.external_uri = any (seen));
    get diagnostics dropped = row_count;
  end if;
  insert into public.calendly_sync_state (membership_id, organization_id, last_synced_at, last_error, imported_count, truncated)
  values (member, p_organization_id, now(), null, n, not coalesce(p_complete, false))
  on conflict (membership_id) do update
    set last_synced_at = now(), last_error = null, imported_count = excluded.imported_count, truncated = excluded.truncated;
  perform app.record_audit_event(
    p_organization_id, 'integrations.calendly_imported', 'calendly_imported_events', null, 'success',
    jsonb_build_object('imported', n, 'canceled', dropped, 'complete', coalesce(p_complete, false))
  );
  return jsonb_build_object('imported', n, 'canceled', dropped, 'truncated', not coalesce(p_complete, false));
end;
$$;
revoke all on function public.replace_calendly_import(uuid, timestamptz, timestamptz, jsonb, boolean) from public, anon;
grant execute on function public.replace_calendly_import(uuid, timestamptz, timestamptz, jsonb, boolean) to authenticated;

create function public.sheet_calendar_providers(p_organization_id uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  member uuid;
  owner boolean;
begin
  perform app.require_active_staff(
    p_organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[],
    false
  );
  member := app.my_staff_membership(p_organization_id);
  owner := app.has_org_role(p_organization_id, array['firm_owner']::public.org_role[]);
  return jsonb_build_object(
    'composio_enabled', exists (select 1 from public.vo_settings s where s.organization_id = p_organization_id and s.composio_enabled),
    'connections', coalesce((
      select jsonb_agg(jsonb_build_object('membership_id', c.membership_id, 'toolkit', c.toolkit))
      from public.staff_connections c
      where c.organization_id = p_organization_id
        and c.status = 'active'
        and c.toolkit in ('googlemeet', 'microsoft_teams', 'calendly')
        and (owner or c.membership_id = member)
    ), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', e.name,
        'starts_at', e.starts_at,
        'ends_at', e.ends_at,
        'host', left(coalesce(nullif(btrim(profile.display_name), ''), 'Staff'), 80)
      ) order by e.starts_at)
      from public.calendly_imported_events e
      join public.memberships m on m.id = e.membership_id and m.organization_id = e.organization_id
      left join public.profiles profile on profile.id = m.user_id
      where e.organization_id = p_organization_id
        and e.status = 'active'
        and e.starts_at < p_to
        and e.ends_at > p_from
        and (owner or e.membership_id = member)
    ), '[]'::jsonb),
    'sync', (
      select jsonb_build_object(
        'last_synced_at', s.last_synced_at,
        'last_error', s.last_error,
        'imported_count', s.imported_count,
        'truncated', s.truncated
      )
      from public.calendly_sync_state s
      where s.membership_id = member and s.organization_id = p_organization_id
    )
  );
end;
$$;
revoke all on function public.sheet_calendar_providers(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.sheet_calendar_providers(uuid, timestamptz, timestamptz) to authenticated;
