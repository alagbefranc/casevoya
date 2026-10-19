-- Sheet > Notifications: a public booking's time in the firm's own time zone (Settings > Language
-- and time), the zone every other Sheet date uses, not the host's. A booking notice read 10:00 in
-- America/Winnipeg while the Sheet says "Times in America/Toronto". Additive only:
-- app.staff_notification_items is copied from its latest definition
-- (20261019203200_staff_notifications.sql) and only the booking row's time zone changes (the
-- host's zone stays the fallback when the firm has none). Same signature, same grants; nothing is
-- emitted or stored.

-- The caller's notification items, newest first. Staff at staff assurance only.
create or replace function app.staff_notification_items(p_org uuid, p_limit integer)
returns table (
  source_id uuid,
  kind text,
  occurred_at timestamptz,
  matter_id uuid,
  actor_name text,
  subject text,
  detail text,
  href text,
  is_read boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  since timestamptz := clock_timestamp() - interval '30 days';
  firm_zone text;
begin
  if actor is null
     or app.in_active_org(p_org) is distinct from true
     or app.staff_mfa_satisfied() is distinct from true
     or app.is_org_staff(p_org) is distinct from true then
    raise exception 'staff access denied' using errcode = '42501';
  end if;

  select nullif(btrim(coalesce(org.timezone, '')), '') into firm_zone
  from public.organizations org
  where org.id = p_org;

  return query
  with items as (
    -- A client's message.
    select message.id as source_id, 'message'::text as kind, message.created_at as occurred_at,
           message.matter_id, person.display_name as actor_name, null::text as subject, null::text as detail,
           '/sheet/matters/' || message.matter_id::text || '?tab=messages&thread=' || message.thread_id::text as href,
           exists (
             select 1 from public.matter_message_receipts receipt
             where receipt.message_id = message.id and receipt.user_id = actor
           ) as seen
    from public.matter_messages message
    join public.persons person
      on person.id = message.author_person_id
     and person.organization_id = message.organization_id
    where message.organization_id = p_org
      and message.author_kind = 'client'
      and message.created_at > since
      and app.message_staff_reads_matter(message.matter_id, message.organization_id)

    union all
    -- A client's upload that passed the file check.
    select event.id, 'document', event.occurred_at, matter.id,
           coalesce(uploader.display_name, subject_person.display_name), doc.purpose,
           'v' || coalesce(version.version_number, 1)::text,
           '/sheet/matters/' || matter.id::text || '?tab=documents',
           false
    from public.outbox_events event
    join public.documents doc
      on doc.id::text = event.payload ->> 'document_id'
     and doc.organization_id = event.organization_id
    join public.persons subject_person
      on subject_person.id = doc.person_id
     and subject_person.organization_id = doc.organization_id
    left join public.document_versions version
      on version.id::text = event.payload ->> 'version_id'
     and version.organization_id = event.organization_id
    join public.matters matter
      on matter.id::text = event.payload ->> 'matter_id'
     and matter.organization_id = event.organization_id
    left join public.persons uploader
      on uploader.user_id = event.created_by
     and uploader.organization_id = event.organization_id
    where event.organization_id = p_org
      and event.event_type = 'document.uploaded'
      and event.occurred_at > since
      and not exists (
        select 1 from public.memberships m
        where m.organization_id = event.organization_id
          and m.user_id = event.created_by
          and m.role = any (app.staff_roles())
      )
      and app.message_staff_reads_matter(matter.id, matter.organization_id)

    union all
    -- A card payment succeeded.
    select audit.id, 'payment', audit.occurred_at, invoice.matter_id, null, invoice.number, null,
           '/sheet/finance?tab=payments',
           false
    from public.audit_log audit
    join public.invoices invoice
      on invoice.id = audit.object_id
     and invoice.organization_id = audit.organization_id
    where audit.organization_id = p_org
      and audit.action = 'invoice.payment_succeeded'
      and audit.occurred_at > since
      and app.can_read_matter_billing(invoice.matter_id)

    union all
    -- A consultation booked by a client or a visitor, at its time in the firm's zone.
    select event.id, 'booking', event.occurred_at, booking.matter_id, attendee.display_name, booking.title,
           to_char(booking.starts_at at time zone coalesce(firm_zone, booking.host_time_zone), 'YYYY-MM-DD"T"HH24:MI'),
           '/sheet/consultations',
           false
    from public.outbox_events event
    join public.bookings booking
      on booking.id::text = event.payload ->> 'booking_id'
     and booking.organization_id = event.organization_id
    left join public.booking_attendees attendee
      on attendee.booking_id = booking.id
     and attendee.organization_id = booking.organization_id
     and attendee.role = 'primary'
    where event.organization_id = p_org
      and event.event_type = 'booking.confirmed'
      and event.occurred_at > since
      and booking.source = 'public'
      and app.can_read_scheduling(p_org)

    union all
    -- A deadline reminder came due.
    select event.id, 'deadline', event.occurred_at, deadline.matter_id, null, deadline.label,
           coalesce(to_char(deadline.due_on, 'YYYY-MM-DD'), ''),
           '/sheet/matters/' || deadline.matter_id::text || '?tab=tasks',
           false
    from public.outbox_events event
    join public.deadlines deadline
      on deadline.id::text = event.payload ->> 'deadline_id'
     and deadline.organization_id = event.organization_id
    where event.organization_id = p_org
      and event.event_type = 'reminder.due'
      and event.occurred_at > since
      and app.message_staff_reads_matter(deadline.matter_id, deadline.organization_id)
  )
  select items.source_id, items.kind, items.occurred_at, items.matter_id, items.actor_name, items.subject,
         items.detail, items.href,
         items.seen or exists (
           select 1 from public.staff_notification_reads r
           where r.organization_id = p_org and r.user_id = actor and r.source_id = items.source_id
         )
  from items
  order by items.occurred_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;
revoke all on function app.staff_notification_items(uuid, integer) from public;
grant execute on function app.staff_notification_items(uuid, integer) to authenticated;
