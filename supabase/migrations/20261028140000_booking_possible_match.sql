-- #263 item C: a public booking made with the email of one of the firm's existing people is never
-- linked to that person automatically (anyone can type any email). The match is recorded as a
-- "possible match" for staff, who link the booking to the person with one confirmed click, or say
-- "Not this person". Both are audited. Until it is linked, the booking is not the person's: it is
-- not in their portal (bookings_select follows bookings.person_id), and its emails are the
-- no-portal kind with the Manage link (prepare_email_delivery's `portal` follows the primary
-- attendee's person_id).
--   booking_person_matches            one row per (booking, person) whose email matched (RLS forced).
--   app.record_booking_person_matches trigger after a public booking's primary attendee is added
--                                     without a person: records every same-firm person with that
--                                     email (sample bookings match sample people only).
--   public.link_booking_to_person     scheduling staff, booking version checked: sets the booking's
--                                     and its primary attendee's person; audit booking.linked_to_client.
--   public.dismiss_booking_match      scheduling staff, booking version checked: "Not this person";
--                                     audit booking.match_dismissed.
-- booking_public_hold and app.place_booking are not redefined.

create table public.booking_person_matches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  booking_id uuid not null,
  person_id uuid not null,
  status text not null default 'open' check (status in ('open', 'linked', 'dismissed')),
  decided_at timestamptz,
  decided_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  unique (booking_id, person_id),
  check ((status = 'open') = (decided_at is null)),
  foreign key (booking_id, organization_id) references public.bookings (id, organization_id),
  foreign key (person_id, organization_id) references public.persons (id, organization_id)
);
comment on table public.booking_person_matches is
  '#263-C: a public booking whose email matched an existing person of the firm. Never a link by itself: staff link it (link_booking_to_person) or dismiss it.';
create index booking_person_matches_booking_org_fk_idx on public.booking_person_matches (booking_id, organization_id);
create index booking_person_matches_person_org_fk_idx on public.booking_person_matches (person_id, organization_id);
create index booking_person_matches_org_idx on public.booking_person_matches (organization_id);
create index booking_person_matches_decided_by_idx on public.booking_person_matches (decided_by);

alter table public.booking_person_matches enable row level security;
alter table public.booking_person_matches force row level security;
-- Scheduling staff of the firm, and only for people they can already see (no names leak).
create policy booking_person_matches_select on public.booking_person_matches
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.can_read_scheduling(organization_id))
    and app.can_read_person(person_id)
  );
revoke all on table public.booking_person_matches from public, anon, authenticated, service_role;
grant select on table public.booking_person_matches to authenticated, service_role;

create trigger booking_person_matches_audit after insert or update or delete on public.booking_person_matches
  for each row execute function app.audit_row_change();
create trigger booking_person_matches_no_delete before delete on public.booking_person_matches
  for each row execute function app.reject_governed_delete();

-- Detection: after a booking-page booking's primary attendee row is written without a person.
create function app.record_booking_person_matches()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  added integer;
begin
  if new.role <> 'primary' or new.person_id is not null then
    return new;
  end if;
  insert into public.booking_person_matches (organization_id, booking_id, person_id)
  select booking.organization_id, booking.id, person.id
  from public.bookings booking
  join public.persons person
    on person.organization_id = booking.organization_id
   and person.email = new.email
   and person.is_sample = booking.is_sample
  where booking.id = new.booking_id
    and booking.organization_id = new.organization_id
    and booking.source = 'public'
    and booking.person_id is null
  on conflict (booking_id, person_id) do nothing;
  get diagnostics added = row_count;
  if added > 0 then
    -- No email or name in the audit row: the count only.
    perform app.booking_audit(new.organization_id, 'booking.possible_match_recorded', new.booking_id, 'success',
      jsonb_build_object('matches', added));
  end if;
  return new;
end;
$$;
revoke all on function app.record_booking_person_matches() from public;

create trigger booking_attendees_possible_match after insert on public.booking_attendees
  for each row execute function app.record_booking_person_matches();

-- The shared checks of Link and Not this person: the booking (locked), the open match, the caller.
create function app.open_booking_match(p_booking_id uuid, p_person_id uuid, p_expected_version integer)
returns public.booking_person_matches
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.bookings%rowtype;
  m public.booking_person_matches%rowtype;
begin
  select * into b from public.bookings where id = p_booking_id for update;
  if b.id is null then
    raise exception 'booking not found' using errcode = 'P0002';
  end if;
  perform app.require_active_staff(b.organization_id, app.scheduling_staff_roles(), false);
  if b.organization_id is distinct from app.current_organization_id() then
    raise exception 'booking not found' using errcode = 'P0002';
  end if;
  if p_expected_version is null or b.version <> p_expected_version then
    raise exception 'this booking was changed by someone else; reload' using errcode = 'PT409';
  end if;
  select * into m from public.booking_person_matches
  where booking_id = b.id and person_id = p_person_id and organization_id = b.organization_id
  for update;
  -- A person this staff member can't see is answered like no match at all.
  if m.id is null or not app.can_read_person(m.person_id) then
    raise exception 'no possible match for this person' using errcode = 'P0002';
  end if;
  if b.person_id is not null then
    raise exception 'this booking is already linked to a client' using errcode = '22023';
  end if;
  if m.status <> 'open' then
    raise exception 'this possible match was already decided' using errcode = '22023';
  end if;
  return m;
end;
$$;
revoke all on function app.open_booking_match(uuid, uuid, integer) from public;

create function public.link_booking_to_person(p_booking_id uuid, p_person_id uuid, p_expected_version integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.booking_person_matches%rowtype;
  person public.persons%rowtype;
  v_email text;
  v_version integer;
begin
  m := app.open_booking_match(p_booking_id, p_person_id, p_expected_version);
  select * into person from public.persons where id = m.person_id and organization_id = m.organization_id;
  select a.email into v_email from public.booking_attendees a where a.booking_id = m.booking_id and a.role = 'primary';
  -- The person's email changed since the booking: it is no longer a match.
  if person.email is distinct from v_email then
    raise exception 'this person''s email no longer matches the booking' using errcode = '22023';
  end if;
  update public.bookings set person_id = person.id where id = m.booking_id returning version into v_version;
  update public.booking_attendees set person_id = person.id where booking_id = m.booking_id and role = 'primary';
  update public.booking_person_matches
     set status = 'linked', decided_at = now(), decided_by = (select auth.uid())
   where id = m.id;
  perform app.booking_audit(m.organization_id, 'booking.linked_to_client', m.booking_id, 'success',
    jsonb_build_object('person_id', person.id, 'portal', person.user_id is not null));
  return v_version;
end;
$$;
comment on function public.link_booking_to_person(uuid, uuid, integer) is
  '#263-C: scheduling staff link a public booking to a person whose email matched it. Booking version checked (PT409). Audited booking.linked_to_client.';
revoke all on function public.link_booking_to_person(uuid, uuid, integer) from public, anon;
grant execute on function public.link_booking_to_person(uuid, uuid, integer) to authenticated, service_role;

create function public.dismiss_booking_match(p_booking_id uuid, p_person_id uuid, p_expected_version integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.booking_person_matches%rowtype;
begin
  m := app.open_booking_match(p_booking_id, p_person_id, p_expected_version);
  update public.booking_person_matches
     set status = 'dismissed', decided_at = now(), decided_by = (select auth.uid())
   where id = m.id;
  perform app.booking_audit(m.organization_id, 'booking.match_dismissed', m.booking_id, 'success',
    jsonb_build_object('person_id', m.person_id));
end;
$$;
comment on function public.dismiss_booking_match(uuid, uuid, integer) is
  '#263-C: "Not this person". Scheduling staff, booking version checked (PT409). Audited booking.match_dismissed.';
revoke all on function public.dismiss_booking_match(uuid, uuid, integer) from public, anon;
grant execute on function public.dismiss_booking_match(uuid, uuid, integer) to authenticated, service_role;
