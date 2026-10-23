-- Consultation agreements by email and from the booking page.
--
-- * When a booking's consultation agreement is sent, its attendee gets EM08 ("An agreement is
--   ready to sign", booking variant) with the booking's private signing link,
--   /consultation/<ref>/agreement. Wording approved by the owner (2026-10-23).
-- * A booking type can carry an approved consultation agreement
--   (booking_event_types.agreement_template_id, set by the firm owner with
--   public.set_booking_type_agreement). A booking from the booking page then gets it at once; the
--   confirmation page links to it and the email carries the link. booking_agreements.sent_by is
--   null when the booking page sent it.
-- * app.issue_booking_agreement: the shared send (checks, snapshot, mail, audit).
--
-- Additive only. Redefined, each copied from its latest definition with only the marked
-- agreement-mail lines added:
--   public.send_booking_agreement   (from 20261023170000_booking_agreements.sql) now calls
--                                   app.issue_booking_agreement, which also queues the
--                                   booking_agreement.sent outbox event
--   public.booking_public_hold      (from 20261019190000_booking_practice_pages.sql) sends the
--                                   booking type's agreement after confirming
--   public.claim_mail_events        (from 20261020170200_support_access_mail.sql) the event type
--                                   joins the mail list
--   public.prepare_email_delivery   (from 20261020170200_support_access_mail.sql) maps it to the
--                                   agreement template with signing_ref, to the primary attendee,
--                                   while the agreement is unsigned and the consultation ahead
-- Same signatures, same grants.

alter table public.booking_event_types add column agreement_template_id uuid references public.agreement_templates (id);
comment on column public.booking_event_types.agreement_template_id is
  'The approved consultation agreement sent with each booking from the booking page; null for none.';
create index booking_event_types_agreement_template_fk_idx on public.booking_event_types (agreement_template_id);

-- The booking page sends it, not a person.
alter table public.booking_agreements alter column sent_by drop not null;

-- booking type agreement: lock an approved consultation template to an upcoming booking, queue
-- EM08 to its attendee, audit it. Staff (p_strict) get an error for every refusal; the public
-- booking page (not strict) skips quietly when the type's template is no longer approved or the
-- booking already has one, so a booking never fails over its agreement. sent_by is null when the
-- booking page sent it.
create function app.issue_booking_agreement(p_booking_id uuid, p_template_id uuid, p_sent_by uuid, p_strict boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  booking public.bookings%rowtype;
  tpl public.agreement_templates%rowtype;
  new_id uuid;
begin
  select * into booking from public.bookings where id = p_booking_id for update;
  if booking.id is null then
    raise exception 'booking denied' using errcode = '42501';
  end if;
  if booking.status not in ('held', 'pending_payment', 'confirmed') then
    if not p_strict then return null; end if;
    raise exception 'only an upcoming consultation can get an agreement' using errcode = '22023';
  end if;
  select * into tpl from public.agreement_templates
  where id = p_template_id and organization_id = booking.organization_id;
  if tpl.id is null or tpl.kind is distinct from 'consultation' or tpl.status is distinct from 'approved' then
    if not p_strict then return null; end if;
    raise exception 'choose an approved consultation agreement template' using errcode = '22023';
  end if;
  if exists (select 1 from public.booking_agreements where booking_id = booking.id and status in ('sent', 'signed')) then
    if not p_strict then return null; end if;
    raise exception 'this consultation already has an agreement' using errcode = '22023';
  end if;
  insert into public.booking_agreements (
    organization_id, booking_id, template_id, template_version, title, body, content_sha256, sent_by, is_sample
  ) values (
    booking.organization_id, booking.id, tpl.id, tpl.version, tpl.name, tpl.body,
    app.portal_statement_hash(tpl.body), p_sent_by, booking.is_sample
  )
  returning id into new_id;
  -- agreement mail: EM08 to the booking's attendee, with the private signing link.
  perform app.booking_outbox(
    booking.organization_id, booking.id, 'booking_agreement.sent',
    jsonb_build_object('booking_id', booking.id, 'booking_agreement_id', new_id),
    'booking-agreement-email:' || new_id::text
  );
  perform app.record_audit_event(
    booking.organization_id, 'booking_agreement.sent', 'public.bookings', booking.id, 'success',
    jsonb_build_object('booking_agreement_id', new_id, 'template_id', tpl.id, 'template_version', tpl.version,
      'by', case when p_sent_by is null then 'booking_page' else 'staff' end)
  );
  return new_id;
end;
$$;
revoke all on function app.issue_booking_agreement(uuid, uuid, uuid, boolean) from public;

create or replace function public.send_booking_agreement(p_booking_id uuid, p_template_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  booking public.bookings%rowtype;
begin
  select * into booking from public.bookings where id = p_booking_id for update;
  if booking.id is null then
    raise exception 'booking denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(booking.organization_id, app.scheduling_staff_roles(), false);
  if booking.organization_id is distinct from app.current_organization_id() then
    raise exception 'booking denied' using errcode = '42501';
  end if;
  -- booking type agreement: the checks, the snapshot, the mail and the audit row are shared with
  -- the public booking page (app.issue_booking_agreement).
  return app.issue_booking_agreement(booking.id, p_template_id, (select auth.uid()), true);
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
  -- booking type agreement: the type's approved consultation agreement is sent with the booking,
  -- for the booker to sign from the confirmation page or the email.
  if et.agreement_template_id is not null then
    perform app.issue_booking_agreement(bid, et.agreement_template_id, null, false);
  end if;
  return app.booking_summary(bid);
end;
$$;

-- booking type agreement: the firm owner (with a recent step-up) chooses the approved
-- consultation agreement a booking type sends with each booking from the booking page, or none.
create function public.set_booking_type_agreement(p_event_type_id uuid, p_template_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  et public.booking_event_types%rowtype;
begin
  select * into et from public.booking_event_types where id = p_event_type_id;
  if et.id is null then
    raise exception 'booking type denied' using errcode = '42501';
  end if;
  perform app.require_firm_owner_step_up(et.organization_id);
  if p_template_id is not null and not exists (
    select 1 from public.agreement_templates tpl
    where tpl.id = p_template_id and tpl.organization_id = et.organization_id
      and tpl.kind = 'consultation' and tpl.status = 'approved'
  ) then
    raise exception 'choose an approved consultation agreement template' using errcode = '22023';
  end if;
  if et.agreement_template_id is not distinct from p_template_id then
    return;
  end if;
  update public.booking_event_types set agreement_template_id = p_template_id where id = et.id;
  perform app.record_audit_event(
    et.organization_id, 'booking_event_type.agreement_set', 'public.booking_event_types', et.id, 'success',
    jsonb_build_object('template_id', p_template_id)
  );
end;
$$;
comment on function public.set_booking_type_agreement(uuid, uuid) is
  'The approved consultation agreement a booking type sends with each booking from the booking page (null: none). Firm owner with step-up.';
revoke all on function public.set_booking_type_agreement(uuid, uuid) from public, anon;
grant execute on function public.set_booking_type_agreement(uuid, uuid) to authenticated, service_role;

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
      'booking_agreement.sent'
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

revoke all on function public.claim_mail_events(text, integer) from public, anon, authenticated;
revoke all on function public.prepare_email_delivery(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.claim_mail_events(text, integer) to service_role;
grant execute on function public.prepare_email_delivery(uuid, text, text, text) to service_role;
