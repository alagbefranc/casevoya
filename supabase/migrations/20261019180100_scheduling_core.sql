-- Scheduling core: booking types, availability, bookings (PRD CRM-03; BUILD-SPEC §1, slices 1-3,
-- free consultations only).
--
--   availability_schedules   one working-hours schedule per staff member, in an IANA zone.
--   availability_rules       weekly ranges in local time (ISO weekday, Monday = 1). Overnight is two rows.
--   availability_overrides   date ranges that replace that date's weekly rules; both times null
--                            blocks the date.
--   booking_event_types      what clients can book: duration, step, buffers, notice, booking
--                            window, daily capacity, location, hosts, published or not.
--   booking_event_type_hosts which staff members take bookings of a type (v1: first free host).
--   bookings                 one row per meeting. An EXCLUSION constraint makes it impossible for
--                            one host to hold two live bookings (held, pending_payment, confirmed)
--                            whose blocked ranges (meeting plus buffers) overlap, so concurrent
--                            requests can never take the same capacity twice (PRD CRM-03).
--   booking_attendees        who the meeting is with (name, email, zone). Linked to a person only
--                            when staff book for a person, or when a signed-in portal client books
--                            for themselves; never by matching an email (PRD CRM-02).
--   booking_events           append-only history.
--   external_busy_blocks     busy time from connected calendars (BUILD-SPEC §5); no writer yet.
--   booking_hold_attempts    rate-limit counter for the public booking endpoint; no API read.
--
-- Paid consultations: price fields exist, but a paid type can never be published (a booking fee
-- is an advance under PRD §9/§13 and the owner's flow is not built). Sample mode: a sample-mode
-- firm's booking types are sample rows and cannot be published; staff can book sample people.
--
-- Writes happen only in SECURITY DEFINER functions with search_path = ''. API roles read through
-- forced RLS. Anonymous visitors call four public functions that return published types and
-- busy ranges with no names, emails or ids of other clients. Additive only.

create extension if not exists btree_gist with schema extensions;

-- ---------------------------------------------------------------------------
-- Small helpers
-- ---------------------------------------------------------------------------

create function app.is_time_zone(p_zone text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_zone is not null
     and length(p_zone) between 1 and 64
     and p_zone ~ '^[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z0-9_+-]+)*$'
     and exists (select 1 from pg_catalog.pg_timezone_names zone where zone.name = p_zone);
$$;
revoke all on function app.is_time_zone(text) from public;

-- 26 characters of base32 (a-z, 2-7) from 16 random bytes. Not a secret: a reference.
create function app.booking_public_ref()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  bytes bytea := extensions.gen_random_bytes(16);
  alphabet text := 'abcdefghijklmnopqrstuvwxyz234567';
  bits bigint := 0;
  nbits integer := 0;
  ref text := '';
  i integer;
begin
  for i in 0..15 loop
    bits := (bits << 8) | get_byte(bytes, i);
    nbits := nbits + 8;
    while nbits >= 5 loop
      ref := ref || substr(alphabet, ((bits >> (nbits - 5)) & 31)::integer + 1, 1);
      nbits := nbits - 5;
    end loop;
    bits := bits & ((1::bigint << nbits) - 1);
  end loop;
  if nbits > 0 then
    ref := ref || substr(alphabet, ((bits << (5 - nbits)) & 31)::integer + 1, 1);
  end if;
  return ref;
end;
$$;
revoke all on function app.booking_public_ref() from public;

-- A local wall time on a date as an instant. A skipped time moves forward; a repeated time takes
-- the earlier occurrence (the TypeScript slot library resolves the same way).
create function app.local_instant(p_day date, p_time time, p_zone text)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select least(
    ((p_day + p_time) at time zone p_zone),
    (((p_day + p_time) - interval '1 hour') at time zone p_zone) + interval '1 hour'
  );
$$;
revoke all on function app.local_instant(date, time, text) from public;

create function app.scheduling_staff_roles()
returns public.org_role[]
language sql
immutable
set search_path = ''
as $$
  select array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[];
$$;
revoke all on function app.scheduling_staff_roles() from public;

-- Explicit audit and outbox rows written directly, so a signed-in visitor of another firm who
-- books on this firm's public page is recorded too (record_audit_event refuses non-members).
create function app.booking_audit(p_org uuid, p_action text, p_booking uuid, p_result text, p_context jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_log (organization_id, actor_user_id, actor_type, action, object_table, object_id, result, request_id, context)
  values (p_org, (select auth.uid()), app.current_actor_type(), p_action, 'public.bookings', p_booking, p_result,
          app.current_request_id(), coalesce(p_context, '{}'::jsonb));
$$;
revoke all on function app.booking_audit(uuid, text, uuid, text, jsonb) from public;

create function app.booking_outbox(p_org uuid, p_booking uuid, p_type text, p_payload jsonb, p_key text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.outbox_events (organization_id, aggregate_type, aggregate_id, event_type, payload, idempotency_key, created_by, request_id)
  values (p_org, 'booking', p_booking, p_type, coalesce(p_payload, '{}'::jsonb), p_key, (select auth.uid()), app.current_request_id())
  on conflict (organization_id, idempotency_key) do nothing;
$$;
revoke all on function app.booking_outbox(uuid, uuid, text, jsonb, text) from public;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.availability_schedules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  membership_id uuid not null,
  name text not null default 'Working hours' check (length(btrim(name)) between 1 and 120),
  time_zone text not null check (time_zone ~ '^[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z0-9_+-]+)*$' and length(time_zone) <= 64),
  is_default boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id),
  foreign key (membership_id, organization_id) references public.memberships (id, organization_id)
);
comment on table public.availability_schedules is
  'A staff member''s working hours in an IANA zone. One default schedule per membership.';
create unique index availability_schedules_default_uidx on public.availability_schedules (membership_id) where is_default;
create index availability_schedules_membership_org_fk_idx on public.availability_schedules (membership_id, organization_id);
create index availability_schedules_org_idx on public.availability_schedules (organization_id);
create index availability_schedules_created_by_idx on public.availability_schedules (created_by);

create table public.availability_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  schedule_id uuid not null,
  weekday smallint not null check (weekday between 1 and 7),
  start_local time not null,
  end_local time not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  check (end_local > start_local),
  foreign key (schedule_id, organization_id) references public.availability_schedules (id, organization_id)
);
comment on table public.availability_rules is
  'Weekly local-time range (ISO weekday, Monday = 1). end_local may be 24:00. Overnight availability is two rows.';
create index availability_rules_schedule_org_fk_idx on public.availability_rules (schedule_id, organization_id);
create index availability_rules_org_idx on public.availability_rules (organization_id);
create index availability_rules_created_by_idx on public.availability_rules (created_by);

create table public.availability_overrides (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  schedule_id uuid not null,
  on_date date not null,
  start_local time,
  end_local time,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  check ((start_local is null and end_local is null) or (start_local is not null and end_local is not null and end_local > start_local)),
  foreign key (schedule_id, organization_id) references public.availability_schedules (id, organization_id)
);
comment on table public.availability_overrides is
  'Date ranges that replace the weekly rules for that date. Both times null blocks the whole date.';
create index availability_overrides_schedule_org_fk_idx on public.availability_overrides (schedule_id, organization_id, on_date);
create index availability_overrides_org_idx on public.availability_overrides (organization_id);
create index availability_overrides_created_by_idx on public.availability_overrides (created_by);

create table public.booking_event_types (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  slug text not null check (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$'),
  title text not null check (length(btrim(title)) between 1 and 120),
  description text check (description is null or length(description) <= 1000),
  duration_min integer not null check (duration_min between 5 and 480),
  slot_step_min integer check (slot_step_min is null or slot_step_min between 5 and 240),
  buffer_before_min integer not null default 0 check (buffer_before_min between 0 and 240),
  buffer_after_min integer not null default 0 check (buffer_after_min between 0 and 240),
  min_notice_min integer not null default 1440 check (min_notice_min between 0 and 525600),
  max_advance_days integer not null default 60 check (max_advance_days between 1 and 365),
  daily_capacity integer check (daily_capacity is null or daily_capacity between 1 and 48),
  location_kind public.booking_location_kind not null default 'video',
  location_detail text check (location_detail is null or length(location_detail) <= 300),
  price_cents bigint not null default 0 check (price_cents between 0 and 99999999),
  currency text not null default 'CAD' check (currency = 'CAD'),
  refund_policy text not null default 'none' check (refund_policy in ('none', 'full_before_cutoff', 'full_always')),
  refund_cutoff_hours integer not null default 48 check (refund_cutoff_hours between 0 and 720),
  is_published boolean not null default false,
  is_sample boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (organization_id, slug),
  unique (id, organization_id),
  -- A consultation fee paid before the meeting is an advance (PRD §9, FIN-03). Until that flow is
  -- built a paid type can be stored but never published.
  constraint booking_event_types_paid_not_published check (not is_published or price_cents = 0),
  constraint booking_event_types_sample_not_published check (not (is_published and is_sample)),
  check (not (is_published and archived_at is not null)),
  check (location_kind <> 'meeting_link' or coalesce(location_detail, '') ~ '^https://[^\s]+$')
);
comment on table public.booking_event_types is
  'Bookable consultation types. Paid and sample types cannot be published.';
create index booking_event_types_org_idx on public.booking_event_types (organization_id, is_published);
create index booking_event_types_created_by_idx on public.booking_event_types (created_by);

create table public.booking_event_type_hosts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  event_type_id uuid not null,
  membership_id uuid not null,
  position smallint not null default 1 check (position between 1 and 50),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  unique (event_type_id, membership_id),
  foreign key (event_type_id, organization_id) references public.booking_event_types (id, organization_id),
  foreign key (membership_id, organization_id) references public.memberships (id, organization_id)
);
create index booking_event_type_hosts_type_org_fk_idx on public.booking_event_type_hosts (event_type_id, organization_id);
create index booking_event_type_hosts_membership_org_fk_idx on public.booking_event_type_hosts (membership_id, organization_id);
create index booking_event_type_hosts_created_by_idx on public.booking_event_type_hosts (created_by);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  public_ref text not null unique check (public_ref ~ '^[a-z2-7]{26}$'),
  event_type_id uuid not null,
  host_membership_id uuid not null,
  host_user_id uuid not null references auth.users (id),
  host_name text check (host_name is null or length(host_name) <= 200),
  title text not null check (length(btrim(title)) between 1 and 120),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  blocked_from timestamptz not null,
  blocked_until timestamptz not null,
  host_time_zone text not null,
  attendee_time_zone text not null,
  location_kind public.booking_location_kind not null,
  location_detail text check (location_detail is null or length(location_detail) <= 300),
  status public.booking_status not null default 'held',
  hold_expires_at timestamptz,
  price_cents bigint not null default 0 check (price_cents >= 0),
  currency text not null default 'CAD' check (currency = 'CAD'),
  person_id uuid,
  matter_id uuid,
  source text not null check (source in ('public', 'staff')),
  ics_sequence integer not null default 0 check (ics_sequence >= 0),
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by public.booking_actor,
  cancel_reason text check (cancel_reason is null or length(cancel_reason) <= 500),
  outcome_at timestamptz,
  idempotency_key text not null check (length(idempotency_key) between 8 and 180),
  is_sample boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id),
  unique (organization_id, idempotency_key),
  check (ends_at > starts_at),
  check (blocked_from <= starts_at and blocked_until >= ends_at),
  check (status not in ('held', 'pending_payment') or hold_expires_at is not null),
  check (status <> 'cancelled' or (cancelled_at is not null and cancelled_by is not null)),
  check (status <> 'confirmed' or confirmed_at is not null),
  foreign key (event_type_id, organization_id) references public.booking_event_types (id, organization_id),
  foreign key (host_membership_id, organization_id) references public.memberships (id, organization_id),
  foreign key (person_id, organization_id) references public.persons (id, organization_id),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id),
  -- PRD CRM-03: one host's live bookings (with their buffers) never overlap, whoever books.
  constraint bookings_no_double_booking exclude using gist (
    organization_id with =,
    host_user_id with =,
    tstzrange(blocked_from, blocked_until, '[)') with &&
  ) where (status in ('held', 'pending_payment', 'confirmed'))
);
comment on table public.bookings is
  'One consultation. Live bookings of a host cannot overlap (exclusion constraint). A reschedule keeps the row and bumps ics_sequence.';
create index bookings_org_starts_idx on public.bookings (organization_id, starts_at);
create index bookings_host_starts_idx on public.bookings (host_user_id, starts_at);
create index bookings_event_type_org_fk_idx on public.bookings (event_type_id, organization_id);
create index bookings_host_membership_org_fk_idx on public.bookings (host_membership_id, organization_id);
create index bookings_person_org_fk_idx on public.bookings (person_id, organization_id);
create index bookings_matter_org_fk_idx on public.bookings (matter_id, organization_id);
create index bookings_created_by_idx on public.bookings (created_by);
create index bookings_hold_idx on public.bookings (hold_expires_at) where status in ('held', 'pending_payment');

create table public.booking_attendees (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  booking_id uuid not null,
  person_id uuid,
  role text not null default 'primary' check (role in ('primary', 'guest')),
  display_name text not null check (length(btrim(display_name)) between 1 and 200),
  email text not null check (email = lower(email) and length(email) between 3 and 320 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone text check (phone is null or (length(phone) <= 40 and phone ~ '^[0-9+() .-]{3,40}$')),
  time_zone text not null,
  locale text not null default 'en-CA' check (locale in ('en-CA', 'fr-CA')),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  foreign key (booking_id, organization_id) references public.bookings (id, organization_id),
  foreign key (person_id, organization_id) references public.persons (id, organization_id)
);
create unique index booking_attendees_primary_uidx on public.booking_attendees (booking_id) where role = 'primary';
create index booking_attendees_booking_org_fk_idx on public.booking_attendees (booking_id, organization_id);
create index booking_attendees_person_org_fk_idx on public.booking_attendees (person_id, organization_id);
create index booking_attendees_created_by_idx on public.booking_attendees (created_by);

create table public.booking_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  booking_id uuid not null,
  kind text not null check (kind in ('held', 'confirmed', 'rescheduled', 'cancelled', 'expired', 'no_show', 'completed')),
  actor public.booking_actor not null,
  actor_user_id uuid references auth.users (id),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 2000),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (booking_id, organization_id) references public.bookings (id, organization_id)
);
comment on table public.booking_events is 'Append-only booking history.';
create index booking_events_booking_org_fk_idx on public.booking_events (booking_id, organization_id, created_at);
create index booking_events_actor_idx on public.booking_events (actor_user_id);

create table public.external_busy_blocks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  membership_id uuid not null,
  source text not null check (source in ('google', 'microsoft', 'ics', 'manual')),
  external_ref text check (external_ref is null or length(external_ref) <= 300),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  synced_at timestamptz not null default now(),
  check (ends_at > starts_at),
  foreign key (membership_id, organization_id) references public.memberships (id, organization_id)
);
comment on table public.external_busy_blocks is
  'Busy times read from a staff member''s connected calendar (times only, no titles). No sync worker writes here yet.';
create index external_busy_blocks_membership_org_fk_idx on public.external_busy_blocks (membership_id, organization_id, starts_at);
create index external_busy_blocks_org_idx on public.external_busy_blocks (organization_id);

create table public.booking_hold_attempts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  client_hash text check (client_hash is null or client_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);
comment on table public.booking_hold_attempts is
  'Rate-limit counter for public booking requests. Stores a hash of the client address, never the address. No API read.';
create index booking_hold_attempts_org_idx on public.booking_hold_attempts (organization_id, created_at);
create index booking_hold_attempts_client_idx on public.booking_hold_attempts (client_hash, created_at);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

create function app.reject_booking_event_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'booking history is append-only' using errcode = '42501';
end;
$$;
revoke all on function app.reject_booking_event_change() from public;

create trigger availability_schedules_touch before update on public.availability_schedules
  for each row execute function app.touch_row();
create trigger availability_schedules_stamp before insert on public.availability_schedules
  for each row execute function app.stamp_created_by();
create trigger availability_schedules_keys before update on public.availability_schedules
  for each row execute function app.guard_tenant_keys();
create trigger availability_schedules_audit after insert or update or delete on public.availability_schedules
  for each row execute function app.audit_row_change();
create trigger availability_rules_stamp before insert on public.availability_rules
  for each row execute function app.stamp_created_by();
create trigger availability_rules_audit after insert or update or delete on public.availability_rules
  for each row execute function app.audit_row_change();
create trigger availability_overrides_stamp before insert on public.availability_overrides
  for each row execute function app.stamp_created_by();
create trigger availability_overrides_audit after insert or update or delete on public.availability_overrides
  for each row execute function app.audit_row_change();

create trigger booking_event_types_touch before update on public.booking_event_types
  for each row execute function app.touch_row();
create trigger booking_event_types_stamp before insert on public.booking_event_types
  for each row execute function app.stamp_created_by();
create trigger booking_event_types_keys before update on public.booking_event_types
  for each row execute function app.guard_tenant_keys();
create trigger booking_event_types_audit after insert or update or delete on public.booking_event_types
  for each row execute function app.audit_row_change();
create trigger booking_event_types_no_delete before delete on public.booking_event_types
  for each row execute function app.reject_governed_delete();
create trigger booking_event_type_hosts_stamp before insert on public.booking_event_type_hosts
  for each row execute function app.stamp_created_by();
create trigger booking_event_type_hosts_audit after insert or update or delete on public.booking_event_type_hosts
  for each row execute function app.audit_row_change();

create trigger bookings_touch before update on public.bookings
  for each row execute function app.touch_row();
create trigger bookings_stamp before insert on public.bookings
  for each row execute function app.stamp_created_by();
create trigger bookings_keys before update on public.bookings
  for each row execute function app.guard_tenant_keys();
create trigger bookings_audit after insert or update or delete on public.bookings
  for each row execute function app.audit_row_change();
create trigger bookings_no_delete before delete on public.bookings
  for each row execute function app.reject_governed_delete();

create trigger booking_attendees_stamp before insert on public.booking_attendees
  for each row execute function app.stamp_created_by();
create trigger booking_attendees_audit after insert or update or delete on public.booking_attendees
  for each row execute function app.audit_row_change('display_name', 'email', 'phone');
create trigger booking_attendees_no_delete before delete on public.booking_attendees
  for each row execute function app.reject_governed_delete();

create trigger booking_events_no_change before update or delete on public.booking_events
  for each row execute function app.reject_booking_event_change();

create trigger booking_hold_attempts_no_delete before delete on public.booking_hold_attempts
  for each row execute function app.reject_governed_delete();

-- ---------------------------------------------------------------------------
-- Read helpers
-- ---------------------------------------------------------------------------

-- Operational staff (not finance) of the active workspace, with staff MFA.
create function app.can_read_scheduling(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.in_active_org(p_org)
     and app.staff_mfa_satisfied()
     and app.has_org_role(p_org, app.scheduling_staff_roles());
$$;
revoke all on function app.can_read_scheduling(uuid) from public;
grant execute on function app.can_read_scheduling(uuid) to authenticated, service_role;

-- The signed-in user is the person a booking is for (their own portal login).
create function app.booking_person_is_me(p_person_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_person_id is not null
     and (select auth.uid()) is not null
     and exists (
       select 1 from public.persons person
       where person.id = p_person_id and person.user_id = (select auth.uid())
     );
$$;
revoke all on function app.booking_person_is_me(uuid) from public;
grant execute on function app.booking_person_is_me(uuid) to authenticated, service_role;

-- The schedule a host uses: their default schedule.
create function app.host_schedule(p_membership_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select schedule.id
  from public.availability_schedules schedule
  where schedule.membership_id = p_membership_id and schedule.is_default
  limit 1;
$$;
revoke all on function app.host_schedule(uuid) from public;

-- True when [p_start, p_end) lies inside the schedule's availability (the dates either side are
-- included so overnight rows and a meeting across midnight are honoured).
create function app.schedule_covers(p_schedule_id uuid, p_start timestamptz, p_end timestamptz)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  zone text;
  first_day date;
  day date;
  windows tstzmultirange := '{}'::tstzmultirange;
  r record;
  ranged boolean;
  w_start timestamptz;
  w_end timestamptz;
begin
  select schedule.time_zone into zone from public.availability_schedules schedule where schedule.id = p_schedule_id;
  if zone is null or p_end <= p_start then
    return false;
  end if;
  first_day := (p_start at time zone zone)::date - 1;
  for day in select (first_day + offs) from generate_series(0, 2 + ((p_end - p_start) > interval '1 day')::integer) offs loop
    ranged := exists (select 1 from public.availability_overrides o where o.schedule_id = p_schedule_id and o.on_date = day);
    if ranged then
      if exists (select 1 from public.availability_overrides o where o.schedule_id = p_schedule_id and o.on_date = day and o.start_local is null) then
        continue;
      end if;
      for r in select o.start_local, o.end_local from public.availability_overrides o where o.schedule_id = p_schedule_id and o.on_date = day loop
        w_start := app.local_instant(day, r.start_local, zone);
        w_end := app.local_instant(day, r.end_local, zone);
        if w_end > w_start then
          windows := windows + tstzmultirange(tstzrange(w_start, w_end, '[)'));
        end if;
      end loop;
    else
      for r in select rule.start_local, rule.end_local from public.availability_rules rule
               where rule.schedule_id = p_schedule_id and rule.weekday = extract(isodow from day)::smallint loop
        w_start := app.local_instant(day, r.start_local, zone);
        w_end := app.local_instant(day, r.end_local, zone);
        if w_end > w_start then
          windows := windows + tstzmultirange(tstzrange(w_start, w_end, '[)'));
        end if;
      end loop;
    end if;
  end loop;
  return windows @> tstzrange(p_start, p_end, '[)');
end;
$$;
revoke all on function app.schedule_covers(uuid, timestamptz, timestamptz) from public;

-- Busy ranges and schedules for each host of a type, for the slot library. Never names, emails,
-- titles or booking ids. Host membership ids are included only for staff callers.
create function app.booking_availability(
  p_event_type_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_exclude_booking uuid,
  p_with_ids boolean
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  et public.booking_event_types%rowtype;
  hosts jsonb := '[]'::jsonb;
  h record;
  schedule uuid;
  zone text;
  host_user uuid;
begin
  select * into et from public.booking_event_types where id = p_event_type_id;
  if et.id is null then
    raise exception 'booking type not found' using errcode = 'P0002';
  end if;
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '62 days' then
    raise exception 'choose a range of up to 62 days' using errcode = '22023';
  end if;
  for h in
    select host.membership_id, host.position, member.user_id
    from public.booking_event_type_hosts host
    join public.memberships member on member.id = host.membership_id and member.organization_id = host.organization_id
    where host.event_type_id = et.id and member.status = 'active'
    order by host.position, host.created_at
  loop
    schedule := app.host_schedule(h.membership_id);
    host_user := h.user_id;
    continue when schedule is null;
    select s.time_zone into zone from public.availability_schedules s where s.id = schedule;
    hosts := hosts || jsonb_build_array(
      jsonb_build_object(
        'position', h.position,
        'time_zone', zone,
        'rules', coalesce((
          select jsonb_agg(jsonb_build_object('weekday', rule.weekday, 'start', to_char(rule.start_local, 'HH24:MI'), 'end', to_char(rule.end_local, 'HH24:MI')) order by rule.weekday, rule.start_local)
          from public.availability_rules rule where rule.schedule_id = schedule
        ), '[]'::jsonb),
        'overrides', coalesce((
          select jsonb_agg(jsonb_build_object('date', to_char(o.on_date, 'YYYY-MM-DD'), 'start', to_char(o.start_local, 'HH24:MI'), 'end', to_char(o.end_local, 'HH24:MI')) order by o.on_date, o.start_local)
          from public.availability_overrides o
          where o.schedule_id = schedule
            and o.on_date between (p_from at time zone zone)::date - 1 and (p_to at time zone zone)::date + 1
        ), '[]'::jsonb),
        'busy', coalesce((
          select jsonb_agg(jsonb_build_object('start', busy.s, 'end', busy.e) order by busy.s)
          from (
            select b.blocked_from as s, b.blocked_until as e
            from public.bookings b
            where b.organization_id = et.organization_id
              and b.host_user_id = host_user
              and b.id is distinct from p_exclude_booking
              and (b.status = 'confirmed' or (b.status in ('held', 'pending_payment') and b.hold_expires_at > now()))
              and b.blocked_until > p_from - interval '1 day'
              and b.blocked_from < p_to + interval '1 day'
            union all
            select x.starts_at, x.ends_at
            from public.external_busy_blocks x
            where x.membership_id = h.membership_id
              and x.ends_at > p_from - interval '1 day'
              and x.starts_at < p_to + interval '1 day'
          ) busy
        ), '[]'::jsonb),
        'day_counts', case when et.daily_capacity is null then '{}'::jsonb else coalesce((
          select jsonb_object_agg(counted.day, counted.n)
          from (
            select to_char((b.starts_at at time zone zone)::date, 'YYYY-MM-DD') as day, count(*) as n
            from public.bookings b
            where b.event_type_id = et.id
              and b.host_user_id = host_user
              and b.id is distinct from p_exclude_booking
              and b.status in ('held', 'pending_payment', 'confirmed', 'completed', 'no_show')
              and b.starts_at > p_from - interval '2 days'
              and b.starts_at < p_to + interval '2 days'
            group by 1
          ) counted
        ), '{}'::jsonb) end
      ) || case when p_with_ids then jsonb_build_object('membership_id', h.membership_id) else '{}'::jsonb end
    );
  end loop;
  return jsonb_build_object(
    'event', jsonb_build_object(
      'duration_min', et.duration_min,
      'slot_step_min', et.slot_step_min,
      'buffer_before_min', et.buffer_before_min,
      'buffer_after_min', et.buffer_after_min,
      'min_notice_min', et.min_notice_min,
      'max_advance_days', et.max_advance_days,
      'daily_capacity', et.daily_capacity
    ),
    'now', now(),
    'hosts', hosts
  );
end;
$$;
revoke all on function app.booking_availability(uuid, timestamptz, timestamptz, uuid, boolean) from public;

-- What a booker (or the portal) may see about their own booking.
create function app.booking_summary(p_booking_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'public_ref', b.public_ref,
    'status', b.status,
    'starts_at', b.starts_at,
    'ends_at', b.ends_at,
    'duration_min', (extract(epoch from (b.ends_at - b.starts_at)) / 60)::integer,
    'title', b.title,
    'host_name', b.host_name,
    'firm_name', org.display_name,
    'firm_slug', org.slug,
    'event_slug', et.slug,
    'time_zone', b.attendee_time_zone,
    'host_time_zone', b.host_time_zone,
    'location_kind', b.location_kind,
    'location_detail', case when b.status = 'confirmed' then b.location_detail end,
    'ics_sequence', b.ics_sequence
  )
  from public.bookings b
  join public.organizations org on org.id = b.organization_id
  join public.booking_event_types et on et.id = b.event_type_id
  where b.id = p_booking_id;
$$;
revoke all on function app.booking_summary(uuid) from public;

-- ---------------------------------------------------------------------------
-- Placing a booking (shared by the public page and staff)
-- ---------------------------------------------------------------------------

-- Checks the start against a host's availability, notice, window and step, then inserts the
-- booking as held. The exclusion constraint is the final word: an overlapping live booking makes
-- this host fail and the next host is tried. Returns the booking id, or null when no host is free.
create function app.place_booking(
  p_event_type_id uuid,
  p_start timestamptz,
  p_attendee_name text,
  p_attendee_email text,
  p_attendee_phone text,
  p_attendee_zone text,
  p_person_id uuid,
  p_source text,
  p_actor public.booking_actor,
  p_idempotency_key text,
  p_is_sample boolean,
  p_enforce_notice boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  et public.booking_event_types%rowtype;
  h record;
  schedule uuid;
  zone text;
  local_start timestamp;
  ends timestamptz;
  bid uuid;
  day_count integer;
  step integer;
  host_label text;
begin
  select * into et from public.booking_event_types where id = p_event_type_id for share;
  if et.id is null or et.archived_at is not null then
    raise exception 'booking type not found' using errcode = 'P0002';
  end if;
  if et.price_cents > 0 then
    raise exception 'paid consultations are not available yet' using errcode = '22023';
  end if;
  if p_start is null or date_trunc('minute', p_start) <> p_start then
    raise exception 'slot_unavailable' using errcode = 'P0001';
  end if;
  ends := p_start + make_interval(mins => et.duration_min);
  step := coalesce(et.slot_step_min, et.duration_min);
  if p_start <= now() or (p_enforce_notice and p_start < now() + make_interval(mins => et.min_notice_min)) then
    raise exception 'slot_unavailable' using errcode = 'P0001';
  end if;

  for h in
    select host.membership_id, member.user_id
    from public.booking_event_type_hosts host
    join public.memberships member on member.id = host.membership_id and member.organization_id = host.organization_id
    where host.event_type_id = et.id
      and member.status = 'active'
      and member.role = any (app.scheduling_staff_roles())
    order by host.position, host.created_at
  loop
    schedule := app.host_schedule(h.membership_id);
    continue when schedule is null;
    select s.time_zone into zone from public.availability_schedules s where s.id = schedule;
    local_start := p_start at time zone zone;
    continue when (extract(hour from local_start) * 60 + extract(minute from local_start))::integer % step <> 0;
    continue when local_start::date > (now() at time zone zone)::date + et.max_advance_days;
    continue when not app.schedule_covers(schedule, p_start, ends);
    continue when exists (
      select 1 from public.external_busy_blocks x
      where x.membership_id = h.membership_id
        and tstzrange(x.starts_at, x.ends_at, '[)')
            && tstzrange(p_start - make_interval(mins => et.buffer_before_min), ends + make_interval(mins => et.buffer_after_min), '[)')
    );
    -- A hold that ran out still occupies its range until it is marked expired.
    update public.bookings b
       set status = 'expired'
     where b.organization_id = et.organization_id
       and b.host_user_id = h.user_id
       and b.status in ('held', 'pending_payment')
       and b.hold_expires_at <= now();
    if et.daily_capacity is not null then
      perform pg_advisory_xact_lock(hashtextextended(
        'casevoya.booking_day:' || et.id::text || ':' || h.user_id::text || ':' || (local_start::date)::text, 0));
      select count(*) into day_count
      from public.bookings b
      where b.event_type_id = et.id
        and b.host_user_id = h.user_id
        and b.status in ('held', 'pending_payment', 'confirmed', 'completed', 'no_show')
        and (b.starts_at at time zone zone)::date = local_start::date;
      continue when day_count >= et.daily_capacity;
    end if;
    select left(nullif(btrim(profile.display_name), ''), 200) into host_label
    from public.profiles profile where profile.id = h.user_id;
    begin
      insert into public.bookings (
        organization_id, public_ref, event_type_id, host_membership_id, host_user_id, host_name, title,
        starts_at, ends_at, blocked_from, blocked_until, host_time_zone, attendee_time_zone,
        location_kind, location_detail, status, hold_expires_at, price_cents, currency,
        person_id, source, idempotency_key, is_sample
      ) values (
        et.organization_id, app.booking_public_ref(), et.id, h.membership_id, h.user_id, host_label, et.title,
        p_start, ends,
        p_start - make_interval(mins => et.buffer_before_min),
        ends + make_interval(mins => et.buffer_after_min),
        zone, p_attendee_zone,
        et.location_kind, et.location_detail, 'held', now() + interval '15 minutes', et.price_cents, et.currency,
        p_person_id, p_source, p_idempotency_key, coalesce(p_is_sample, false)
      )
      returning id into bid;
    exception when exclusion_violation then
      bid := null;
    end;
    if bid is not null then
      insert into public.booking_attendees (organization_id, booking_id, person_id, role, display_name, email, phone, time_zone)
      values (et.organization_id, bid, p_person_id, 'primary', btrim(p_attendee_name), lower(btrim(p_attendee_email)),
              nullif(btrim(coalesce(p_attendee_phone, '')), ''), p_attendee_zone);
      insert into public.booking_events (organization_id, booking_id, kind, actor, actor_user_id, payload)
      values (et.organization_id, bid, 'held', p_actor, (select auth.uid()), jsonb_build_object('source', p_source));
      return bid;
    end if;
  end loop;
  return null;
end;
$$;
revoke all on function app.place_booking(uuid, timestamptz, text, text, text, text, uuid, text, public.booking_actor, text, boolean, boolean) from public;

-- Held (or, later, paid) -> confirmed, with the confirmation email in the same transaction.
create function app.confirm_booking(p_booking_id uuid, p_actor public.booking_actor)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.bookings%rowtype;
begin
  select * into b from public.bookings where id = p_booking_id for update;
  if b.id is null then
    raise exception 'booking not found' using errcode = 'P0002';
  end if;
  if b.status = 'confirmed' then
    return;
  end if;
  if b.status not in ('held', 'pending_payment') or b.hold_expires_at <= now() then
    raise exception 'this hold has expired' using errcode = '22023';
  end if;
  update public.bookings set status = 'confirmed', confirmed_at = now(), hold_expires_at = null where id = b.id;
  insert into public.booking_events (organization_id, booking_id, kind, actor, actor_user_id, payload)
  values (b.organization_id, b.id, 'confirmed', p_actor, (select auth.uid()), '{}'::jsonb);
  perform app.booking_outbox(
    b.organization_id, b.id, 'booking.confirmed',
    jsonb_build_object('booking_id', b.id, 'starts_at', b.starts_at),
    'booking-confirmed-email:' || b.id::text
  );
  perform app.booking_audit(b.organization_id, 'booking.confirmed', b.id, 'success',
    jsonb_build_object('source', b.source, 'starts_at', b.starts_at, 'event_type_id', b.event_type_id));
end;
$$;
revoke all on function app.confirm_booking(uuid, public.booking_actor) from public;

-- ---------------------------------------------------------------------------
-- Public booking page (anonymous or signed in)
-- ---------------------------------------------------------------------------

create function public.booking_public_event(p_firm_slug text, p_event_slug text)
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
    'max_advance_days', et.max_advance_days
  )
  from public.booking_event_types et
  join public.organizations org on org.id = et.organization_id
  where org.slug = lower(btrim(coalesce(p_firm_slug, '')))
    and et.slug = lower(btrim(coalesce(p_event_slug, '')))
    and et.is_published
    and not et.is_sample
    and et.archived_at is null
    and et.price_cents = 0;
$$;

create function public.booking_public_event_types(p_firm_slug text)
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
                                          'duration_min', et.duration_min, 'location_kind', et.location_kind)
                       order by et.title)
      from public.booking_event_types et
      where et.organization_id = org.id and et.is_published and not et.is_sample and et.archived_at is null and et.price_cents = 0
    ), '[]'::jsonb)
  )
  from public.organizations org
  where org.slug = lower(btrim(coalesce(p_firm_slug, '')));
$$;

create function public.booking_public_busy(p_event_type_id uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.booking_event_types et
    where et.id = p_event_type_id and et.is_published and not et.is_sample and et.archived_at is null and et.price_cents = 0
  ) then
    raise exception 'booking type not found' using errcode = 'P0002';
  end if;
  return app.booking_availability(p_event_type_id, p_from, p_to, null, false);
end;
$$;

-- Books a free consultation from the public page. The slot is re-checked here (availability,
-- notice, window, step, capacity) and the exclusion constraint settles any race. A retry with the
-- same idempotency key returns the same booking as it now stands, never a booking it did not make.
-- Returns the booking summary, or {"error": code} for a refusal the visitor can act on
-- (slot_unavailable, booking_rate_limited, name_required, email_invalid, phone_invalid, time_zone_invalid).
create function public.booking_public_hold(
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
    and et2.is_published and not et2.is_sample and et2.archived_at is null;
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

  bid := app.place_booking(et.id, p_start, p_name, v_email, p_phone, zone, me, 'public', 'client', key, false, true);
  if bid is null then
    perform app.booking_audit(et.organization_id, 'booking.slot_unavailable', null, 'denied',
      jsonb_build_object('event_type_id', et.id, 'starts_at', p_start));
    return jsonb_build_object('error', 'slot_unavailable');
  end if;
  perform app.confirm_booking(bid, 'client');
  return app.booking_summary(bid);
end;
$$;

-- service_role (a scheduled job): marks holds that ran out as expired, freeing their range.
create function public.expire_booking_holds(p_as_of timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') is distinct from 'service_role' then
    raise exception 'worker role required' using errcode = '42501';
  end if;
  with gone as (
    update public.bookings b
       set status = 'expired'
     where b.status in ('held', 'pending_payment')
       and b.hold_expires_at <= coalesce(p_as_of, now())
    returning b.id, b.organization_id
  ), logged as (
    insert into public.booking_events (organization_id, booking_id, kind, actor, payload)
    select gone.organization_id, gone.id, 'expired', 'system', '{}'::jsonb from gone
    returning 1
  )
  select count(*) into n from logged;
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Staff: settings
-- ---------------------------------------------------------------------------

-- Firm owner with a recent step-up: create or update a booking type and its hosts. No price in
-- this release; publishing needs a host, a firm out of sample mode, and stays free.
create function public.save_booking_event_type(
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
  if coalesce(p_publish, false) and sample then
    raise exception 'turn off sample mode before publishing a booking page' using errcode = '22023';
  end if;
  if p_location_kind = 'meeting_link' and coalesce(btrim(p_location_detail), '') !~ '^https://[^\s]+$' then
    raise exception 'a meeting link must start with https://' using errcode = '22023';
  end if;

  if p_event_type_id is null then
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
      raise exception 'this booking type was changed by someone else; reload' using errcode = '40001';
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

  perform app.record_audit_event(p_org, 'booking_type.saved', 'public.booking_event_types', rid, 'success',
    jsonb_build_object('published', coalesce(p_publish, false), 'hosts', coalesce(array_length(hosts, 1), 0)));
  return rid;
end;
$$;

-- A staff member sets their own working hours (aal2); the firm owner, with a recent step-up, can
-- set anyone's. Rules and overrides are replaced as a whole.
--   p_rules     [{"weekday":1,"start":"09:00","end":"17:00"}, ...]
--   p_overrides [{"date":"2026-12-24","start":null,"end":null}, ...]
create function public.save_availability(
  p_org uuid,
  p_membership_id uuid,
  p_time_zone text,
  p_rules jsonb,
  p_overrides jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  member public.memberships%rowtype;
  zone text := btrim(coalesce(p_time_zone, ''));
  sid uuid;
  item jsonb;
  s time;
  e time;
begin
  select * into member from public.memberships where id = p_membership_id and organization_id = p_org;
  if member.id is null or member.status <> 'active' or not (member.role = any (app.scheduling_staff_roles())) then
    raise exception 'choose an active staff member' using errcode = '22023';
  end if;
  if member.user_id = (select auth.uid()) then
    perform app.require_active_staff(p_org, app.scheduling_staff_roles(), false);
  else
    perform app.require_firm_owner_step_up(p_org);
  end if;
  if not app.is_time_zone(zone) then
    raise exception 'choose a time zone' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_rules, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_rules, '[]'::jsonb)) > 70
     or jsonb_typeof(coalesce(p_overrides, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_overrides, '[]'::jsonb)) > 400 then
    raise exception 'too many availability rows' using errcode = '22023';
  end if;

  select id into sid from public.availability_schedules where membership_id = member.id and is_default for update;
  if sid is null then
    insert into public.availability_schedules (organization_id, membership_id, time_zone, is_default)
    values (p_org, member.id, zone, true)
    returning id into sid;
  else
    update public.availability_schedules set time_zone = zone where id = sid and time_zone is distinct from zone;
  end if;

  delete from public.availability_rules rule where rule.schedule_id = sid;
  delete from public.availability_overrides o where o.schedule_id = sid;
  for item in select * from jsonb_array_elements(coalesce(p_rules, '[]'::jsonb)) loop
    begin
      s := (item ->> 'start')::time;
      e := (item ->> 'end')::time;
    exception when others then
      raise exception 'a time is not valid' using errcode = '22023';
    end;
    if coalesce((item ->> 'weekday')::integer, 0) not between 1 and 7 or e <= s then
      raise exception 'each range needs a weekday and an end after its start' using errcode = '22023';
    end if;
    insert into public.availability_rules (organization_id, schedule_id, weekday, start_local, end_local)
    values (p_org, sid, (item ->> 'weekday')::smallint, s, e);
  end loop;
  for item in select * from jsonb_array_elements(coalesce(p_overrides, '[]'::jsonb)) loop
    begin
      s := (item ->> 'start')::time;
      e := (item ->> 'end')::time;
      perform (item ->> 'date')::date;
    exception when others then
      raise exception 'a date or time is not valid' using errcode = '22023';
    end;
    if (item ->> 'date') is null or ((s is null) <> (e is null)) or (s is not null and e <= s) then
      raise exception 'each date needs both times or neither' using errcode = '22023';
    end if;
    insert into public.availability_overrides (organization_id, schedule_id, on_date, start_local, end_local)
    values (p_org, sid, (item ->> 'date')::date, s, e);
  end loop;
  perform app.record_audit_event(p_org, 'availability.saved', 'public.availability_schedules', sid, 'success',
    jsonb_build_object('membership_id', member.id, 'rules', jsonb_array_length(coalesce(p_rules, '[]'::jsonb)),
                       'overrides', jsonb_array_length(coalesce(p_overrides, '[]'::jsonb))));
  return sid;
end;
$$;

-- ---------------------------------------------------------------------------
-- Staff: bookings
-- ---------------------------------------------------------------------------

create function public.staff_booking_availability(
  p_org uuid,
  p_event_type_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_exclude_booking uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.require_active_staff(p_org, app.scheduling_staff_roles(), false);
  if not exists (select 1 from public.booking_event_types et where et.id = p_event_type_id and et.organization_id = p_org) then
    raise exception 'booking type not found' using errcode = 'P0002';
  end if;
  return app.booking_availability(p_event_type_id, p_from, p_to, p_exclude_booking, true);
end;
$$;

-- Staff book a consultation for a person they can read. Minimum notice does not apply to staff.
create function public.staff_book_consultation(
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
begin
  perform app.require_active_staff(p_org, app.scheduling_staff_roles(), false);
  if not exists (select 1 from public.booking_event_types et where et.id = p_event_type_id and et.organization_id = p_org and et.archived_at is null) then
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
  perform app.confirm_booking(bid, 'staff');
  return bid;
end;
$$;

create function public.staff_cancel_booking(p_org uuid, p_booking_id uuid, p_reason text, p_expected_version integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.bookings%rowtype;
begin
  perform app.require_active_staff(p_org, app.scheduling_staff_roles(), false);
  select * into b from public.bookings where id = p_booking_id and organization_id = p_org for update;
  if b.id is null then
    raise exception 'booking not found' using errcode = 'P0002';
  end if;
  if p_expected_version is not null and b.version <> p_expected_version then
    raise exception 'this booking was changed by someone else; reload' using errcode = '40001';
  end if;
  if b.status not in ('held', 'pending_payment', 'confirmed') then
    raise exception 'this booking cannot be cancelled' using errcode = '22023';
  end if;
  update public.bookings
     set status = 'cancelled', cancelled_at = now(), cancelled_by = 'staff',
         cancel_reason = nullif(left(btrim(coalesce(p_reason, '')), 500), ''), hold_expires_at = null
   where id = b.id;
  insert into public.booking_events (organization_id, booking_id, kind, actor, actor_user_id, payload)
  values (b.organization_id, b.id, 'cancelled', 'staff', (select auth.uid()), '{}'::jsonb);
  if b.status = 'confirmed' and b.starts_at > now() then
    perform app.booking_outbox(b.organization_id, b.id, 'booking.cancelled',
      jsonb_build_object('booking_id', b.id, 'starts_at', b.starts_at), 'booking-cancelled-email:' || b.id::text);
  end if;
  perform app.booking_audit(b.organization_id, 'booking.cancelled', b.id, 'success', jsonb_build_object('by', 'staff'));
end;
$$;

-- Moves a confirmed booking to a new start with the same host. Same row, same reference, same
-- calendar UID; ics_sequence goes up so calendar apps update the event instead of adding one.
create function public.staff_reschedule_booking(p_org uuid, p_booking_id uuid, p_start timestamptz, p_expected_version integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.bookings%rowtype;
  et public.booking_event_types%rowtype;
  schedule uuid;
  local_start timestamp;
  ends timestamptz;
  day_count integer;
begin
  perform app.require_active_staff(p_org, app.scheduling_staff_roles(), false);
  select * into b from public.bookings where id = p_booking_id and organization_id = p_org for update;
  if b.id is null then
    raise exception 'booking not found' using errcode = 'P0002';
  end if;
  if p_expected_version is not null and b.version <> p_expected_version then
    raise exception 'this booking was changed by someone else; reload' using errcode = '40001';
  end if;
  if b.status <> 'confirmed' or b.starts_at <= now() then
    raise exception 'only an upcoming confirmed booking can be moved' using errcode = '22023';
  end if;
  select * into et from public.booking_event_types where id = b.event_type_id;
  if p_start is null or p_start <= now() or date_trunc('minute', p_start) <> p_start or p_start = b.starts_at then
    raise exception 'slot_unavailable' using errcode = 'P0001';
  end if;
  ends := p_start + (b.ends_at - b.starts_at);
  schedule := app.host_schedule(b.host_membership_id);
  local_start := p_start at time zone b.host_time_zone;
  if schedule is null
     or (extract(hour from local_start) * 60 + extract(minute from local_start))::integer % coalesce(et.slot_step_min, et.duration_min) <> 0
     or local_start::date > (now() at time zone b.host_time_zone)::date + et.max_advance_days
     or not app.schedule_covers(schedule, p_start, ends)
     or exists (
       select 1 from public.external_busy_blocks x
       where x.membership_id = b.host_membership_id
         and tstzrange(x.starts_at, x.ends_at, '[)')
             && tstzrange(p_start - make_interval(mins => et.buffer_before_min), ends + make_interval(mins => et.buffer_after_min), '[)')
     ) then
    raise exception 'slot_unavailable' using errcode = 'P0001';
  end if;
  if et.daily_capacity is not null then
    perform pg_advisory_xact_lock(hashtextextended(
      'casevoya.booking_day:' || et.id::text || ':' || b.host_user_id::text || ':' || (local_start::date)::text, 0));
    select count(*) into day_count from public.bookings x
    where x.event_type_id = et.id and x.host_user_id = b.host_user_id and x.id <> b.id
      and x.status in ('held', 'pending_payment', 'confirmed', 'completed', 'no_show')
      and (x.starts_at at time zone b.host_time_zone)::date = local_start::date;
    if day_count >= et.daily_capacity then
      raise exception 'slot_unavailable' using errcode = 'P0001';
    end if;
  end if;
  begin
    update public.bookings
       set starts_at = p_start,
           ends_at = ends,
           blocked_from = p_start - make_interval(mins => et.buffer_before_min),
           blocked_until = ends + make_interval(mins => et.buffer_after_min),
           ics_sequence = b.ics_sequence + 1
     where id = b.id;
  exception when exclusion_violation then
    raise exception 'slot_unavailable' using errcode = 'P0001';
  end;
  insert into public.booking_events (organization_id, booking_id, kind, actor, actor_user_id, payload)
  values (b.organization_id, b.id, 'rescheduled', 'staff', (select auth.uid()),
          jsonb_build_object('from', b.starts_at, 'to', p_start, 'sequence', b.ics_sequence + 1));
  perform app.booking_outbox(b.organization_id, b.id, 'booking.rescheduled',
    jsonb_build_object('booking_id', b.id, 'starts_at', p_start, 'sequence', b.ics_sequence + 1),
    'booking-rescheduled-email:' || b.id::text || ':' || (b.ics_sequence + 1)::text);
  perform app.booking_audit(b.organization_id, 'booking.rescheduled', b.id, 'success',
    jsonb_build_object('from', b.starts_at, 'to', p_start));
end;
$$;

-- After the start time: attended (completed) or a no-show.
create function public.staff_record_booking_outcome(p_org uuid, p_booking_id uuid, p_outcome text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.bookings%rowtype;
begin
  perform app.require_active_staff(p_org, app.scheduling_staff_roles(), false);
  if p_outcome not in ('completed', 'no_show') then
    raise exception 'choose attended or no-show' using errcode = '22023';
  end if;
  select * into b from public.bookings where id = p_booking_id and organization_id = p_org for update;
  if b.id is null then
    raise exception 'booking not found' using errcode = 'P0002';
  end if;
  if b.status <> 'confirmed' or b.starts_at > now() then
    raise exception 'record the outcome after the meeting starts' using errcode = '22023';
  end if;
  update public.bookings set status = p_outcome::public.booking_status, outcome_at = now() where id = b.id;
  insert into public.booking_events (organization_id, booking_id, kind, actor, actor_user_id, payload)
  values (b.organization_id, b.id, p_outcome, 'staff', (select auth.uid()), '{}'::jsonb);
  perform app.booking_audit(b.organization_id, 'booking.' || p_outcome, b.id, 'success', '{}'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke all on function public.booking_public_event(text, text) from public;
revoke all on function public.booking_public_event_types(text) from public;
revoke all on function public.booking_public_busy(uuid, timestamptz, timestamptz) from public;
revoke all on function public.booking_public_hold(text, text, timestamptz, text, text, text, text, text, text) from public;
revoke all on function public.expire_booking_holds(timestamptz) from public, anon, authenticated;
revoke all on function public.save_booking_event_type(uuid, uuid, integer, text, text, text, integer, integer, integer, integer, integer, integer, integer, public.booking_location_kind, text, uuid[], boolean) from public, anon;
revoke all on function public.save_availability(uuid, uuid, text, jsonb, jsonb) from public, anon;
revoke all on function public.staff_booking_availability(uuid, uuid, timestamptz, timestamptz, uuid) from public, anon;
revoke all on function public.staff_book_consultation(uuid, uuid, uuid, timestamptz, text, text) from public, anon;
revoke all on function public.staff_cancel_booking(uuid, uuid, text, integer) from public, anon;
revoke all on function public.staff_reschedule_booking(uuid, uuid, timestamptz, integer) from public, anon;
revoke all on function public.staff_record_booking_outcome(uuid, uuid, text) from public, anon;

grant execute on function public.booking_public_event(text, text) to anon, authenticated, service_role;
grant execute on function public.booking_public_event_types(text) to anon, authenticated, service_role;
grant execute on function public.booking_public_busy(uuid, timestamptz, timestamptz) to anon, authenticated, service_role;
grant execute on function public.booking_public_hold(text, text, timestamptz, text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.expire_booking_holds(timestamptz) to service_role;
grant execute on function public.save_booking_event_type(uuid, uuid, integer, text, text, text, integer, integer, integer, integer, integer, integer, integer, public.booking_location_kind, text, uuid[], boolean) to authenticated;
grant execute on function public.save_availability(uuid, uuid, text, jsonb, jsonb) to authenticated;
grant execute on function public.staff_booking_availability(uuid, uuid, timestamptz, timestamptz, uuid) to authenticated;
grant execute on function public.staff_book_consultation(uuid, uuid, uuid, timestamptz, text, text) to authenticated;
grant execute on function public.staff_cancel_booking(uuid, uuid, text, integer) to authenticated;
grant execute on function public.staff_reschedule_booking(uuid, uuid, timestamptz, integer) to authenticated;
grant execute on function public.staff_record_booking_outcome(uuid, uuid, text) to authenticated;

revoke all on table public.availability_schedules from anon, authenticated, service_role;
revoke all on table public.availability_rules from anon, authenticated, service_role;
revoke all on table public.availability_overrides from anon, authenticated, service_role;
revoke all on table public.booking_event_types from anon, authenticated, service_role;
revoke all on table public.booking_event_type_hosts from anon, authenticated, service_role;
revoke all on table public.bookings from anon, authenticated, service_role;
revoke all on table public.booking_attendees from anon, authenticated, service_role;
revoke all on table public.booking_events from anon, authenticated, service_role;
revoke all on table public.external_busy_blocks from anon, authenticated, service_role;
revoke all on table public.booking_hold_attempts from anon, authenticated, service_role;
grant select on table public.availability_schedules to authenticated, service_role;
grant select on table public.availability_rules to authenticated, service_role;
grant select on table public.availability_overrides to authenticated, service_role;
grant select on table public.booking_event_types to authenticated, service_role;
grant select on table public.booking_event_type_hosts to authenticated, service_role;
grant select on table public.bookings to authenticated, service_role;
grant select on table public.booking_attendees to authenticated, service_role;
grant select on table public.booking_events to authenticated, service_role;
grant select on table public.external_busy_blocks to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.availability_schedules enable row level security;
alter table public.availability_schedules force row level security;
alter table public.availability_rules enable row level security;
alter table public.availability_rules force row level security;
alter table public.availability_overrides enable row level security;
alter table public.availability_overrides force row level security;
alter table public.booking_event_types enable row level security;
alter table public.booking_event_types force row level security;
alter table public.booking_event_type_hosts enable row level security;
alter table public.booking_event_type_hosts force row level security;
alter table public.bookings enable row level security;
alter table public.bookings force row level security;
alter table public.booking_attendees enable row level security;
alter table public.booking_attendees force row level security;
alter table public.booking_events enable row level security;
alter table public.booking_events force row level security;
alter table public.external_busy_blocks enable row level security;
alter table public.external_busy_blocks force row level security;
alter table public.booking_hold_attempts enable row level security;
alter table public.booking_hold_attempts force row level security;

create policy availability_schedules_select on public.availability_schedules
  for select to authenticated
  using (organization_id = (select app.current_organization_id()) and (select app.can_read_scheduling(organization_id)));
create policy availability_rules_select on public.availability_rules
  for select to authenticated
  using (organization_id = (select app.current_organization_id()) and (select app.can_read_scheduling(organization_id)));
create policy availability_overrides_select on public.availability_overrides
  for select to authenticated
  using (organization_id = (select app.current_organization_id()) and (select app.can_read_scheduling(organization_id)));
create policy booking_event_types_select on public.booking_event_types
  for select to authenticated
  using (organization_id = (select app.current_organization_id()) and (select app.can_read_scheduling(organization_id)));
create policy booking_event_type_hosts_select on public.booking_event_type_hosts
  for select to authenticated
  using (organization_id = (select app.current_organization_id()) and (select app.can_read_scheduling(organization_id)));
create policy external_busy_blocks_select on public.external_busy_blocks
  for select to authenticated
  using (organization_id = (select app.current_organization_id()) and (select app.can_read_scheduling(organization_id)));

-- Staff of the firm, or the client the booking is for (their own login), never anyone else.
create policy bookings_select on public.bookings
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and ((select app.can_read_scheduling(organization_id)) or app.booking_person_is_me(person_id))
  );
create policy booking_attendees_select on public.booking_attendees
  for select to authenticated
  using (organization_id = (select app.current_organization_id()) and (select app.can_read_scheduling(organization_id)));
create policy booking_events_select on public.booking_events
  for select to authenticated
  using (organization_id = (select app.current_organization_id()) and (select app.can_read_scheduling(organization_id)));
