-- Practice booking pages in sample mode, and plainer booking mail (docs/DECISIONS.md, 2026-10-18).
--
-- 1. Practice pages. A firm in sample mode could not publish a booking type, and no firm leaves
--    sample mode before it is verified and its licence is checked (app.real_client_invite_blockers),
--    so no trial firm could try its own booking page. As with invoices in sample mode (sample rows
--    only), a firm owner in sample mode may now publish a booking type. The type is a sample row
--    (is_sample, as before), and its page is a practice page:
--      * the public functions serve a sample type only to a signed-in, active staff member of that
--        firm with staff MFA (app.booking_practice_viewer); everyone else (anonymous visitors,
--        other firms, the firm's portal clients) gets exactly what an unpublished page gives:
--        nothing, or "booking type not found";
--      * a booking made on a practice page is a sample booking (bookings.is_sample). Its attendee
--        and history rows belong to it through booking_id, as invoice lines and payments belong to
--        a sample invoice; they have no is_sample column of their own;
--      * every check is the same: slots, notice, window, step, daily limit, the exclusion
--        constraint, the per-address and per-firm limits, idempotency (the honeypot and form timer
--        are in the route);
--      * a paid type still cannot be published (booking_event_types_paid_not_published stays).
--    A sample type stays a practice page after the firm leaves sample mode (sample rows are kept,
--    not converted); the firm publishes a new booking type for its real page.
--    Mail for a sample booking follows the rule for every other sample record: there is no sample
--    filter in the outbox or prepare_email_delivery (a sample invoice's EM10 is sent the same way),
--    so EM16a/b/c go to the address typed on the practice page, which only the firm's staff can open.
--
-- 2. Booking mail context (prepare_email_delivery, booking branch only):
--      portal         true when the attendee is linked to a person who has a portal login
--                     (persons.user_id set, the Sheet's "Portal active"); only they get the
--                     portal button.
--      location_kind  how they meet (phone, video, in_person, meeting_link), for the EM16a line.
--      address        the booked in-person address (the booking type's location detail, as
--                     snapshotted on the booking); never a meeting link.
--      booking_page   the firm's slug, on a cancellation to an attendee without a portal, when the
--                     firm has a published free booking page they can use (a real one; for a
--                     sample booking a practice one counts too). The email builds /book/<slug>.
--
-- Functions copied from their latest definition and changed only as noted:
--   app.booking_summary, public.booking_public_event, public.booking_public_event_types,
--   public.booking_public_busy, public.booking_public_hold, public.save_booking_event_type
--   (20261019180100_scheduling_core.sql); public.prepare_email_delivery
--   (20261019180200_scheduling_mail.sql). New: app.booking_practice_viewer. Dropped: the check
--   constraint booking_event_types_sample_not_published (no data changes). Additive only.

-- ---------------------------------------------------------------------------
-- Who may open a practice page
-- ---------------------------------------------------------------------------

-- The signed-in user is active staff of the firm (any staff role) with staff MFA. Uses auth.uid(),
-- not the workspace header: the public page carries no workspace.
create function app.booking_practice_viewer(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_org is not null
     and (select auth.uid()) is not null
     and app.is_org_staff(p_org)
     and app.staff_mfa_satisfied();
$$;
revoke all on function app.booking_practice_viewer(uuid) from public;

alter table public.booking_event_types drop constraint booking_event_types_sample_not_published;
comment on table public.booking_event_types is
  'Bookable consultation types. Paid types cannot be published. A published sample type is a practice page: only the firm''s staff can open it.';

-- ---------------------------------------------------------------------------
-- Summary: says whether the booking is a practice (sample) booking
-- ---------------------------------------------------------------------------

-- What a booker (or the portal) may see about their own booking.
-- practice booking pages: adds 'practice' (the booking is a sample record).
create or replace function app.booking_summary(p_booking_id uuid)
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
    'ics_sequence', b.ics_sequence,
    'practice', b.is_sample
  )
  from public.bookings b
  join public.organizations org on org.id = b.organization_id
  join public.booking_event_types et on et.id = b.event_type_id
  where b.id = p_booking_id;
$$;
revoke all on function app.booking_summary(uuid) from public;

-- ---------------------------------------------------------------------------
-- Public booking page (anonymous or signed in)
-- ---------------------------------------------------------------------------

-- practice booking pages: a sample type is returned only to the firm's staff, with practice: true.
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
    'practice', et.is_sample
  )
  from public.booking_event_types et
  join public.organizations org on org.id = et.organization_id
  where org.slug = lower(btrim(coalesce(p_firm_slug, '')))
    and et.slug = lower(btrim(coalesce(p_event_slug, '')))
    and et.is_published
    and (not et.is_sample or app.booking_practice_viewer(et.organization_id))
    and et.archived_at is null
    and et.price_cents = 0;
$$;

-- practice booking pages: sample types are listed only for the firm's staff, marked practice.
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
    ), '[]'::jsonb)
  )
  from public.organizations org
  where org.slug = lower(btrim(coalesce(p_firm_slug, '')));
$$;

-- practice booking pages: a sample type's busy ranges only for the firm's staff.
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
-- practice booking pages: a sample type books only for the firm's staff, and the booking is a
-- sample booking (is_sample); everything else is unchanged.
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
    and (not et2.is_sample or app.booking_practice_viewer(et2.organization_id));
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
  return app.booking_summary(bid);
end;
$$;

-- ---------------------------------------------------------------------------
-- Staff: settings
-- ---------------------------------------------------------------------------

-- Firm owner with a recent step-up: create or update a booking type and its hosts. No price in
-- this release; publishing needs a host and stays free.
-- practice booking pages: a firm in sample mode may publish; its types are sample rows, so the
-- published page is a practice page that only the firm's staff can open.
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

  -- practice booking pages: the audit row says whether the published page is a practice page.
  perform app.record_audit_event(p_org, 'booking_type.saved', 'public.booking_event_types', rid, 'success',
    jsonb_build_object('published', coalesce(p_publish, false), 'hosts', coalesce(array_length(hosts, 1), 0),
                       'practice', (select t.is_sample from public.booking_event_types t where t.id = rid)));
  return rid;
end;
$$;

-- ---------------------------------------------------------------------------
-- Mail: booking context (portal, how they meet, booking page)
-- ---------------------------------------------------------------------------

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
      send_ok := rec.email_notices and case event.event_type
        when 'booking.cancelled' then rec.status = 'cancelled'
        else rec.status = 'confirmed' and rec.starts_at = (event.payload ->> 'starts_at')::timestamptz
      end;
      perform app.queue_email_delivery(
        event.id, event.organization_id, rec.email, template, null, false, ctx, send_ok
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
  )), '[]'::jsonb)
  into messages
  from public.email_deliveries delivery
  where delivery.outbox_event_id = event.id
    and delivery.status = 'sending';

  return jsonb_build_object('action', 'send', 'event_id', event.id, 'messages', messages);
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges (replacing keeps them; restated so this file reads on its own)
-- ---------------------------------------------------------------------------

revoke all on function public.booking_public_event(text, text) from public;
revoke all on function public.booking_public_event_types(text) from public;
revoke all on function public.booking_public_busy(uuid, timestamptz, timestamptz) from public;
revoke all on function public.booking_public_hold(text, text, timestamptz, text, text, text, text, text, text) from public;
revoke all on function public.save_booking_event_type(uuid, uuid, integer, text, text, text, integer, integer, integer, integer, integer, integer, integer, public.booking_location_kind, text, uuid[], boolean) from public, anon;
revoke all on function public.prepare_email_delivery(uuid, text, text, text) from public, anon, authenticated;

grant execute on function public.booking_public_event(text, text) to anon, authenticated, service_role;
grant execute on function public.booking_public_event_types(text) to anon, authenticated, service_role;
grant execute on function public.booking_public_busy(uuid, timestamptz, timestamptz) to anon, authenticated, service_role;
grant execute on function public.booking_public_hold(text, text, timestamptz, text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.save_booking_event_type(uuid, uuid, integer, text, text, text, integer, integer, integer, integer, integer, integer, integer, public.booking_location_kind, text, uuid[], boolean) to authenticated;
grant execute on function public.prepare_email_delivery(uuid, text, text, text) to service_role;
