-- Intake delivery (branch intake-delivery): staff in-app notifications when a client submits an
-- intake form or asks for a correction (PRD INT-06 "alerts affected matters").
--
-- Redefined: app.staff_notification_items, copied from its latest definition in
-- 20261020170100_support_access.sql (which added the 'support' branch). Only change: two new
-- branches, 'intake_submitted' (from intake_snapshots, a client's own submit) and
-- 'intake_correction' (from intake_corrections), for staff who can open the matter
-- (app.message_staff_reads_matter). Same signature, same grants. No email: neither has an approved
-- design.

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
    -- portal appointments: a client cancelled their consultation from the portal, for its host
    -- and the firm owner, at the cancelled time in the firm's zone.
    select event.id, 'booking_cancelled', event.occurred_at, booking.matter_id,
           coalesce(person.display_name, attendee.display_name), booking.title,
           to_char(coalesce((event.payload ->> 'starts_at')::timestamptz, booking.starts_at)
                   at time zone coalesce(firm_zone, booking.host_time_zone), 'YYYY-MM-DD"T"HH24:MI'),
           '/sheet/consultations',
           false
    from public.outbox_events event
    join public.bookings booking
      on booking.id::text = event.payload ->> 'booking_id'
     and booking.organization_id = event.organization_id
    left join public.persons person
      on person.id = booking.person_id
     and person.organization_id = booking.organization_id
    left join public.booking_attendees attendee
      on attendee.booking_id = booking.id
     and attendee.organization_id = booking.organization_id
     and attendee.role = 'primary'
    where event.organization_id = p_org
      and event.event_type = 'booking.cancelled_by_client'
      and event.occurred_at > since
      and app.can_read_scheduling(p_org)
      and (booking.host_user_id = actor or app.has_org_role(p_org, array['firm_owner']::public.org_role[]))

    union all
    -- portal appointments: a client moved their consultation from the portal, for its host and
    -- the firm owner, at the new time in the firm's zone.
    select event.id, 'booking_rescheduled', event.occurred_at, booking.matter_id,
           coalesce(person.display_name, attendee.display_name), booking.title,
           to_char(coalesce((event.payload ->> 'starts_at')::timestamptz, booking.starts_at)
                   at time zone coalesce(firm_zone, booking.host_time_zone), 'YYYY-MM-DD"T"HH24:MI'),
           '/sheet/consultations',
           false
    from public.outbox_events event
    join public.bookings booking
      on booking.id::text = event.payload ->> 'booking_id'
     and booking.organization_id = event.organization_id
    left join public.persons person
      on person.id = booking.person_id
     and person.organization_id = booking.organization_id
    left join public.booking_attendees attendee
      on attendee.booking_id = booking.id
     and attendee.organization_id = booking.organization_id
     and attendee.role = 'primary'
    where event.organization_id = p_org
      and event.event_type = 'booking.rescheduled_by_client'
      and event.occurred_at > since
      and app.can_read_scheduling(p_org)
      and (booking.host_user_id = actor or app.has_org_role(p_org, array['firm_owner']::public.org_role[]))

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

    union all
    -- Casevoya support asked for access (SEC-09): the firm's owners. Read once it is decided.
    select req.id, 'support', req.created_at, req.matter_id, req.requested_by_name,
           case req.scope
             when 'firm_settings' then 'firm settings'
             when 'records_set' then 'a set of records'
             else coalesce(matter.reference, matter.title)
           end,
           req.requested_minutes::text,
           '/sheet/grants?tab=support',
           req.status <> 'pending'
    from public.support_access_requests req
    left join public.matters matter
      on matter.id = req.matter_id
     and matter.organization_id = req.organization_id
    where req.organization_id = p_org
      and req.created_at > since
      and app.has_org_role(p_org, array['firm_owner']::public.org_role[])

    union all
    -- intake delivery: a client sent their answers (one row per submitted snapshot), for staff
    -- who can open the matter. Staff submitting on a client's behalf raise no row.
    select snap.id, 'intake_submitted', snap.created_at, response.matter_id,
           coalesce(
             (select p.display_name from public.persons p
              where p.user_id = snap.created_by and p.organization_id = snap.organization_id
              order by p.created_at limit 1),
             subject_person.display_name
           ),
           template.title, null::text,
           '/sheet/matters/' || response.matter_id::text || '?tab=intake',
           false
    from public.intake_snapshots snap
    join public.intake_responses response
      on response.id = snap.response_id
     and response.organization_id = snap.organization_id
    join public.intake_templates template
      on template.id = response.template_id
     and template.organization_id = response.organization_id
    join public.persons subject_person
      on subject_person.id = response.person_id
     and subject_person.organization_id = response.organization_id
    where snap.organization_id = p_org
      and snap.created_at > since
      and not exists (
        select 1 from public.memberships m
        where m.organization_id = snap.organization_id
          and m.user_id = snap.created_by
          and m.role = any (app.staff_roles())
      )
      and app.message_staff_reads_matter(response.matter_id, response.organization_id)

    union all
    -- intake delivery: a client asked for a correction after submitting (INT-06).
    select correction.id, 'intake_correction', correction.created_at, response.matter_id,
           subject_person.display_name, template.title,
           'CR-' || lpad(correction.correction_number::text, 4, '0'),
           '/sheet/matters/' || response.matter_id::text || '?tab=intake',
           false
    from public.intake_corrections correction
    join public.intake_responses response
      on response.id = correction.response_id
     and response.organization_id = correction.organization_id
    join public.intake_templates template
      on template.id = response.template_id
     and template.organization_id = response.organization_id
    join public.persons subject_person
      on subject_person.id = response.person_id
     and subject_person.organization_id = response.organization_id
    where correction.organization_id = p_org
      and correction.created_at > since
      and app.message_staff_reads_matter(response.matter_id, response.organization_id)
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
