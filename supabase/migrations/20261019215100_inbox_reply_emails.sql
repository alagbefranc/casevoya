-- Inbox replies and compose (PRD OPS-04, OPS-05, OPS-06; TASKS T034). Owner-approved 2026-10-19:
-- staff reply to a client's email, or write a new one, from the Sheet Inbox, and Casevoya sends it
-- through its own mail (Cloudflare Email Sending) instead of only through the portal chat.
-- Additive only.
--
-- Model
--   matter_outbound_emails   one email a staff member wrote to one person on one matter. Append-only.
--                            The text is kept (the firm's record of what it sent) and is readable
--                            only by staff who can read the matter (owner, assigned, creator) at
--                            staff assurance, never by a portal role or a finance user.
--
-- Who may send: public.send_matter_email (security definer, search_path = '')
--   * firm owner, licensed consultant, case manager or assistant, at staff assurance (aal2), who
--     can read the matter (app.message_staff_reads_matter, as for matter messages);
--   * to a person who is on that matter and has an email address. The address is the person's
--     own stored address, copied when sent: the caller never types an address;
--   * a reply must name a filed inbound email on that matter, filed to that same person, that the
--     caller can read; the reply gets "Re: <its subject>" and threading headers;
--   * sample rules: a sample-mode firm writes only on sample matters (app.sample_mode_blocks_real);
--     the person must be as sample as the matter. Email about a sample matter is recorded and
--     queued like any other, and prepare_email_delivery records its delivery as skipped: no real
--     email is ever sent for a sample matter (stricter than the other notices: there is no sample
--     filter in the outbox for them, see 20261019190000_booking_practice_pages.sql);
--   * refused up front when the address is on the firm's do-not-send list (email_suppressions) or
--     the person turned "Email notices" off (person_contact_preferences.email_notices = false),
--     so staff see why at once instead of a silent skip;
--   * plain text, 1 to 5000 characters; no attachments (documents stay in the portal);
--   * 30 emails per sender per 10 minutes; a retried send with the same client key returns the
--     email it already made;
--   * audited (email.staff_sent) with ids and sizes, never the text.
--
-- Mail: the email queues outbox 'matter_email.sent' (ids only). prepare_email_delivery maps it to
-- template 'staff_message' (design EX15 "Message from staff", engineering-built at the owner's
-- request, copy pending Francis) to the stored address. From is the platform sender used by every
-- notice (product setting email.from_address, notices@casevoya.ca) with the firm's display name;
-- Reply-To is the matter reply address (app.firm_reply_address; the firm address when the
-- matter's would be too long), so the client's answer comes back into the Inbox on that matter.
-- The text, the subject and the threading headers (In-Reply-To / References = the inbound email's
-- Message-ID, when it is a well-formed <id>) are returned in the message, never in the delivery
-- context (which stays under its 2000-byte cap and holds names and flags only).
--
-- Functions copied from their latest definitions (20261019203100_matter_messaging.sql) and changed
-- only as marked "inbox replies": public.claim_mail_events (claims 'matter_email.sent'),
-- public.prepare_email_delivery (the 'matter_email.sent' branch and the message's body, subject
-- and headers). New: public.send_matter_email.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table public.matter_outbound_emails (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  matter_id uuid not null,
  person_id uuid not null,
  recipient_email text not null check (
    recipient_email = lower(recipient_email)
    and length(recipient_email) between 3 and 320
  ),
  reply_to_inbound_id uuid,
  subject text check (subject is null or length(btrim(subject)) between 1 and 300),
  body text not null check (length(btrim(body)) between 1 and 5000),
  author_user_id uuid not null references auth.users (id),
  author_membership_id uuid not null,
  -- The sender's name as the email shows it, copied when sent.
  author_name text not null check (length(btrim(author_name)) between 1 and 200),
  is_sample boolean not null default false,
  outbox_event_id uuid not null references public.outbox_events (id),
  client_key text check (client_key is null or client_key ~ '^[A-Za-z0-9_-]{8,80}$'),
  created_at timestamptz not null default clock_timestamp(),
  unique (id, organization_id),
  unique (organization_id, author_user_id, client_key),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id),
  foreign key (person_id, organization_id) references public.persons (id, organization_id),
  foreign key (reply_to_inbound_id, organization_id) references public.inbound_emails (id, organization_id),
  foreign key (author_membership_id, organization_id) references public.memberships (id, organization_id)
);
comment on table public.matter_outbound_emails is
  'Email a staff member wrote to one person on a matter from the Sheet Inbox. Append-only. Staff on the matter read it; delivery status is in email_deliveries (by outbox_event_id).';

create index matter_outbound_emails_org_idx on public.matter_outbound_emails (organization_id);
create index matter_outbound_emails_org_created_idx on public.matter_outbound_emails (organization_id, created_at desc);
create index matter_outbound_emails_matter_org_idx on public.matter_outbound_emails (matter_id, organization_id);
create index matter_outbound_emails_person_org_idx on public.matter_outbound_emails (person_id, organization_id);
create index matter_outbound_emails_reply_org_idx on public.matter_outbound_emails (reply_to_inbound_id, organization_id);
create index matter_outbound_emails_author_user_idx on public.matter_outbound_emails (author_user_id, created_at desc);
create index matter_outbound_emails_author_membership_org_idx on public.matter_outbound_emails (author_membership_id, organization_id);
create index matter_outbound_emails_outbox_idx on public.matter_outbound_emails (outbox_event_id);

create trigger matter_outbound_emails_append_only before update or delete on public.matter_outbound_emails
  for each row execute function app.reject_message_change();

alter table public.matter_outbound_emails enable row level security;
alter table public.matter_outbound_emails force row level security;
revoke all on public.matter_outbound_emails from public, anon, authenticated;
grant select on public.matter_outbound_emails to authenticated;
grant select on public.matter_outbound_emails to service_role;

create policy matter_outbound_emails_select on public.matter_outbound_emails
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and app.message_staff_reads_matter(matter_id, organization_id)
  );
-- Belt and braces, as for staff notes: no portal role, ever.
create policy matter_outbound_emails_staff_only on public.matter_outbound_emails
  as restrictive
  for select
  to authenticated
  using (
    (select app.is_org_staff(organization_id))
    and (select app.staff_mfa_satisfied())
  );

-- ---------------------------------------------------------------------------
-- Write
-- ---------------------------------------------------------------------------

create function public.send_matter_email(
  p_organization_id uuid,
  p_matter_id uuid,
  p_person_id uuid,
  p_body text,
  p_reply_to_email_id uuid default null,
  p_client_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  matter public.matters%rowtype;
  person public.persons%rowtype;
  inbound public.inbound_emails%rowtype;
  existing public.matter_outbound_emails%rowtype;
  membership uuid;
  sender text;
  recipient text;
  text_body text := btrim(coalesce(p_body, ''), E' \t\r\n');
  subject_line text;
  recent integer;
  new_id uuid := gen_random_uuid();
  eid uuid;
  sample boolean;
begin
  if actor is null
     or p_organization_id is null
     or app.message_staff_reads_matter(p_matter_id, p_organization_id) is distinct from true then
    raise exception 'email denied' using errcode = '42501';
  end if;
  select * into matter from public.matters where id = p_matter_id and organization_id = p_organization_id;
  if matter.id is null or app.sample_mode_blocks_real(matter.organization_id, matter.is_sample) then
    raise exception 'email denied' using errcode = '42501';
  end if;
  if length(text_body) < 1 or length(text_body) > 5000 then
    raise exception 'email text must be 1 to 5000 characters' using errcode = '22023';
  end if;
  if p_client_key is not null and p_client_key !~ '^[A-Za-z0-9_-]{8,80}$' then
    raise exception 'client key is invalid' using errcode = '22023';
  end if;

  -- A retried send returns the email it already made.
  if p_client_key is not null then
    select * into existing from public.matter_outbound_emails
    where organization_id = matter.organization_id and author_user_id = actor and client_key = p_client_key;
    if existing.id is not null then
      return jsonb_build_object('email_id', existing.id, 'sample', existing.is_sample, 'replayed', true);
    end if;
  end if;

  select count(*) into recent
  from public.matter_outbound_emails
  where author_user_id = actor
    and created_at > clock_timestamp() - interval '10 minutes';
  if recent >= 30 then
    perform app.record_audit_event(matter.organization_id, 'email.rate_limited', 'public.matters', matter.id, 'denied', '{}'::jsonb);
    raise exception 'email rate limit reached' using errcode = '54000';
  end if;

  -- The recipient: a person on this matter, as sample as the matter. Never a typed address.
  select p.* into person
  from public.persons p
  join public.matter_participants party
    on party.person_id = p.id
   and party.organization_id = p.organization_id
   and party.matter_id = matter.id
  where p.id = p_person_id
    and p.organization_id = matter.organization_id
    and p.is_sample is not distinct from matter.is_sample
  limit 1;
  if person.id is null then
    raise exception 'that person is not on this matter' using errcode = '42501';
  end if;
  recipient := lower(btrim(coalesce(person.email, '')));
  if recipient !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(recipient) > 320 then
    raise exception 'that person has no email address' using errcode = '22023';
  end if;

  -- A reply: a filed email on this matter, filed to this person, that the caller can read.
  if p_reply_to_email_id is not null then
    select * into inbound from public.inbound_emails
    where id = p_reply_to_email_id and organization_id = matter.organization_id;
    if inbound.id is null
       or app.can_read_inbound_email(inbound.id) is distinct from true
       or inbound.triage_state is distinct from 'filed'
       or inbound.matter_id is distinct from matter.id
       or inbound.person_id is distinct from person.id then
      raise exception 'that email is not on this person''s file' using errcode = '42501';
    end if;
    subject_line := nullif(btrim(regexp_replace(coalesce(inbound.subject, ''), '^\s*((re|fwd?|tr)\s*:\s*)+', '', 'i')), '');
    subject_line := left('Re: ' || coalesce(subject_line, 'your email'), 300);
  end if;

  if exists (
    select 1 from public.email_suppressions suppression
    where suppression.organization_id = matter.organization_id
      and suppression.recipient_email = recipient
  ) then
    raise exception 'this address is on the do-not-send list' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.person_contact_preferences pref
    where pref.person_id = person.id
      and pref.email_notices is false
  ) then
    raise exception 'this person turned off email from the firm' using errcode = '22023';
  end if;

  select m.id into membership
  from public.memberships m
  where m.organization_id = matter.organization_id and m.user_id = actor and m.status = 'active'
    and m.role = any (array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[])
  order by m.created_at
  limit 1;
  if membership is null then
    raise exception 'email denied' using errcode = '42501';
  end if;
  sender := left(coalesce(
    (select nullif(btrim(profile.display_name), '') from public.profiles profile where profile.id = actor),
    'Staff'
  ), 200);
  sample := matter.is_sample or person.is_sample;

  eid := app.enqueue_event(
    matter.organization_id, 'matter_email', new_id, 'matter_email.sent',
    jsonb_build_object('email_id', new_id, 'matter_id', matter.id),
    null, 'matter-email:' || new_id::text, null
  );

  insert into public.matter_outbound_emails (
    id, organization_id, matter_id, person_id, recipient_email, reply_to_inbound_id, subject, body,
    author_user_id, author_membership_id, author_name, is_sample, outbox_event_id, client_key
  ) values (
    new_id, matter.organization_id, matter.id, person.id, recipient, inbound.id, subject_line, text_body,
    actor, membership, sender, sample, eid, p_client_key
  );

  perform app.record_audit_event(matter.organization_id, 'email.staff_sent', 'public.matter_outbound_emails', new_id, 'success',
    jsonb_build_object(
      'matter_id', matter.id,
      'person_id', person.id,
      'reply', inbound.id is not null,
      'sample', sample,
      'characters', length(text_body)
    ));
  return jsonb_build_object('email_id', new_id, 'sample', sample, 'replayed', false);
end;
$$;

revoke all on function public.send_matter_email(uuid, uuid, uuid, text, uuid, text) from public, anon;
grant execute on function public.send_matter_email(uuid, uuid, uuid, text, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Mail: EX15 "Message from staff"
-- ---------------------------------------------------------------------------

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
      'matter_email.sent'
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
