-- Meeting lifecycle and a larger Calendly import.
-- Google Meet is a standing room: we store its space name and can end a live call, and Google's
-- connected actions do not delete the room. Teams is created with a stable external id, moved
-- when the organizer id was returned, and deleted on cancel when that id exists.
-- A Calendly import may now send up to 2000 events (20 pages). A short fetch still must not
-- cancel events that were not returned.
--
-- Rollback: drop the new functions and columns. The previous begin_booking_meeting and
-- replace_calendly_import bodies are in 20261106120100. Enum values stay.
--   alter table public.booking_provider_meetings drop column if exists provider_ref;
--   alter table public.booking_provider_meetings drop column if exists organizer_ref;
--   alter table public.booking_provider_meetings drop column if exists lifecycle_note;
--   drop function public.attach_booking_meeting(uuid, text, text, text);
--   drop function public.booking_provider_state(uuid, uuid, text, text);
--   drop function public.note_booking_meeting(uuid, text);

alter table public.booking_provider_meetings
  add column provider_ref text check (provider_ref is null or (length(provider_ref) between 3 and 400 and provider_ref !~ '[[:space:]]')),
  add column organizer_ref text check (organizer_ref is null or organizer_ref ~ '^[0-9a-fA-F-]{36}$'),
  add column lifecycle_note text check (lifecycle_note is null or length(lifecycle_note) <= 300);

comment on column public.booking_provider_meetings.provider_ref is
  'Google Meet space name (spaces/…) or the Teams online meeting id. Not a join URL.';
comment on column public.booking_provider_meetings.organizer_ref is
  'Microsoft Graph user id of the Teams organizer, when the create call returned one.';
comment on column public.booking_provider_meetings.lifecycle_note is
  'Shown to firm staff when the provider could not move or delete the meeting. Not a join URL.';

create or replace function public.begin_booking_meeting(p_booking_id uuid)
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
  if row_.status = 'pending' and b.status = 'held' then
    return jsonb_build_object(
      'action', 'stale',
      'provider', b.location_kind,
      'booking_id', b.id,
      'host_membership_id', b.host_membership_id,
      'title', b.title,
      'starts_at', b.starts_at,
      'ends_at', b.ends_at
    );
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
  end if;
  return jsonb_build_object(
    'action', 'create',
    'booking_id', b.id,
    'organization_id', b.organization_id,
    'host_membership_id', b.host_membership_id,
    'provider', b.location_kind,
    'title', b.title,
    'starts_at', b.starts_at,
    'ends_at', b.ends_at
  );
end;
$$;

create function public.attach_booking_meeting(p_booking_id uuid, p_join_url text, p_provider_ref text, p_organizer_ref text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.bookings%rowtype;
  url text := btrim(coalesce(p_join_url, ''));
  host text;
  ref text := nullif(btrim(coalesce(p_provider_ref, '')), '');
  organizer text := nullif(btrim(coalesce(p_organizer_ref, '')), '');
begin
  perform app.require_service_role();
  select * into b from public.bookings where id = p_booking_id for update;
  if b.id is null or b.status <> 'held' or b.location_kind not in ('google_meet', 'microsoft_teams') then
    raise exception 'meeting link refused' using errcode = '22023';
  end if;
  if url !~ '^https://[^[:space:]]+$' or length(url) > 1000 then
    raise exception 'meeting link refused' using errcode = '22023';
  end if;
  host := lower(substring(url from '^https://([^/:@]+)'));
  if b.location_kind = 'google_meet' and host <> 'meet.google.com' then
    raise exception 'meeting link refused' using errcode = '22023';
  end if;
  if b.location_kind = 'microsoft_teams' and host <> 'teams.microsoft.com' and host <> 'teams.live.com' and host not like '%.teams.microsoft.com' then
    raise exception 'meeting link refused' using errcode = '22023';
  end if;
  if ref is not null and (length(ref) < 3 or length(ref) > 400 or ref ~ '[[:space:]]') then
    raise exception 'meeting link refused' using errcode = '22023';
  end if;
  if organizer is not null and organizer !~ '^[0-9a-fA-F-]{36}$' then
    raise exception 'meeting link refused' using errcode = '22023';
  end if;
  if b.location_detail is not null and b.location_detail is distinct from url then
    raise exception 'meeting link refused' using errcode = '22023';
  end if;
  update public.booking_provider_meetings
     set status = 'ready', join_url = url, provider_ref = ref, organizer_ref = organizer, updated_at = now()
   where booking_id = b.id and organization_id = b.organization_id and host_membership_id = b.host_membership_id and status = 'pending';
  if not found then
    raise exception 'meeting link refused' using errcode = '22023';
  end if;
  update public.bookings set location_detail = url where id = b.id and organization_id = b.organization_id;
end;
$$;
revoke all on function public.attach_booking_meeting(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.attach_booking_meeting(uuid, text, text, text) to service_role;

create function public.note_booking_meeting(p_booking_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  note text := left(btrim(coalesce(p_note, '')), 300);
begin
  perform app.require_service_role();
  if note = '' then
    return;
  end if;
  update public.booking_provider_meetings set lifecycle_note = note, updated_at = now() where booking_id = p_booking_id;
end;
$$;
revoke all on function public.note_booking_meeting(uuid, text) from public, anon, authenticated;
grant execute on function public.note_booking_meeting(uuid, text) to service_role;

-- The signed-in staff member, the booking's own client, or a valid Manage link. No join URL.
create function public.booking_provider_state(p_booking_id uuid, p_organization_id uuid, p_ref text, p_sha256 text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  b public.bookings%rowtype;
  m public.booking_provider_meetings%rowtype;
begin
  if coalesce(btrim(p_sha256), '') <> '' then
    b := app.booking_by_manage_token(p_ref, p_sha256, false);
    if b.id is null then
      raise exception 'booking access denied' using errcode = '42501';
    end if;
  elsif p_booking_id is not null and p_organization_id is not null and app.in_active_org(p_organization_id) then
    select * into b from public.bookings where id = p_booking_id and organization_id = p_organization_id;
    if b.id is null then
      raise exception 'booking not found' using errcode = 'P0002';
    end if;
    if not (
      (app.staff_mfa_satisfied() and app.has_org_role(p_organization_id, app.scheduling_staff_roles()))
      or app.booking_person_is_me(b.person_id)
    ) then
      raise exception 'booking access denied' using errcode = '42501';
    end if;
  else
    raise exception 'booking access denied' using errcode = '42501';
  end if;
  if b.location_kind not in ('google_meet', 'microsoft_teams') then
    return jsonb_build_object('location_kind', b.location_kind);
  end if;
  select * into m from public.booking_provider_meetings where booking_id = b.id;
  return jsonb_build_object(
    'booking_id', b.id,
    'location_kind', b.location_kind,
    'provider_ref', m.provider_ref,
    'organizer_ref', m.organizer_ref,
    'host_membership_id', b.host_membership_id,
    'title', b.title,
    'starts_at', b.starts_at,
    'ends_at', b.ends_at,
    'lifecycle_note', m.lifecycle_note
  );
end;
$$;
revoke all on function public.booking_provider_state(uuid, uuid, text, text) from public;
grant execute on function public.booking_provider_state(uuid, uuid, text, text) to anon, authenticated;
create or replace function public.replace_calendly_import(
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
  if jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) > 2000 then
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
