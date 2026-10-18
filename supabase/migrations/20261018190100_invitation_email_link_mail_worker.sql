-- The mail worker side of sealed invitation links (20261018190000).
-- public.claim_mail_events: an invitation email waits until its sealed link is attached,
--   or until it is 10 minutes old, after which the linkless email still goes out.
--   Copied from 20261017200100_outbound_email.sql (its only definition); one condition added.
-- public.prepare_email_delivery: passes sealed_link and invitation_id to the worker in the
--   delivery context, and scrubs the link when no delivery will be sent.
-- public.finish_email_delivery: scrubs the sealed link once a delivery is final
--   (sent, queued, bounced, suppressed, terminal failure, or dead-lettered after retries).
--   Both copied from 20261017200200_inbound_email.sql (their only definitions).
-- Every change is marked "sealed invitation link". Additive only.

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
      'document.request_created',
      'document.uploaded',
      'document.reviewed'
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
    when 'document.request_created' then 'document_request'::public.email_template
    when 'document.uploaded' then 'document_receipt'::public.email_template
    when 'document.reviewed' then 'document_receipt'::public.email_template
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
    perform app.queue_email_delivery(
      event.id, event.organization_id, event.payload ->> 'recipient_email',
      template, matter, true, ctx, true
    );
  elsif event.event_type = 'staff_invitation.email_requested' then
    ctx := ctx || jsonb_build_object('kind', 'staff', 'role', event.payload ->> 'role');
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
      select lower(coalesce(person.email, users.email)) as email
      from public.envelope_signers signer
      left join public.persons person on person.id = signer.person_id
      left join public.memberships membership on membership.id = signer.membership_id
      left join auth.users users on users.id = membership.user_id
      where signer.envelope_id::text = event.payload ->> 'envelope_id'
        and signer.organization_id = event.organization_id
    loop
      perform app.queue_email_delivery(
        event.id, event.organization_id, rec.email, template, matter, true, ctx, true
      );
    end loop;
  elsif event.event_type = 'document.request_created' then
    ctx := ctx || jsonb_build_object(
      'purpose', left(coalesce(event.payload ->> 'purpose', ''), 200),
      'due_on', event.payload ->> 'due_on'
    );
    perform app.queue_email_delivery(
      event.id, event.organization_id,
      (select person.email from public.persons person where person.id::text = event.payload ->> 'person_id'),
      template, matter, true, ctx, true
    );
  elsif event.event_type in ('document.uploaded', 'document.reviewed') then
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

create or replace function public.finish_email_delivery(
  p_delivery_id uuid,
  p_worker text,
  p_outcome text,
  p_provider_message_id text default null,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  delivery public.email_deliveries%rowtype;
  event public.outbox_events%rowtype;
  owner uuid;
  next_status public.email_delivery_status;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') is distinct from 'service_role' then
    raise exception 'worker role required' using errcode = '42501';
  end if;
  if p_outcome is null or p_outcome not in ('sent', 'queued', 'bounced', 'suppressed', 'retry', 'terminal_failure') then
    raise exception 'delivery outcome is invalid' using errcode = '22023';
  end if;
  select * into delivery from public.email_deliveries where id = p_delivery_id for update;
  if delivery.id is null then
    raise exception 'delivery was not found' using errcode = '42501';
  end if;
  select * into event from public.outbox_events where id = delivery.outbox_event_id;
  if event.status = 'published' or delivery.status in ('sent', 'queued', 'bounced', 'suppressed', 'skipped') then
    return;
  end if;
  if event.locked_by is distinct from left(btrim(coalesce(p_worker, '')), 200) then
    raise exception 'mail event is not claimed' using errcode = '42501';
  end if;

  if p_outcome = 'retry' then
    update public.email_deliveries
       set status = 'failed', last_error = left(coalesce(p_error, 'retry'), 500)
     where id = delivery.id;
    perform app.mark_outbox_failed(event.id, p_worker, coalesce(p_error, 'retry'), 8);
    -- sealed invitation link: a dead-lettered event will not be retried on its own.
    if exists (
      select 1 from public.outbox_events dead
      where dead.id = event.id and dead.status = 'dead_lettered'
    ) then
      perform app.scrub_invitation_link(event.id);
    end if;
    perform app.record_audit_event(
      delivery.organization_id, 'email.failed', 'public.email_deliveries', delivery.id, 'failure',
      jsonb_build_object('template', delivery.template, 'retry', true)
    );
    return;
  end if;
  if p_outcome = 'terminal_failure' then
    update public.email_deliveries
       set status = 'failed', last_error = left(coalesce(p_error, 'rejected'), 500)
     where id = delivery.id;
    perform app.mark_outbox_failed(event.id, p_worker, coalesce(p_error, 'rejected'), 1);
    -- sealed invitation link: a terminal failure is final.
    perform app.scrub_invitation_link(event.id);
    perform app.record_audit_event(
      delivery.organization_id, 'email.failed', 'public.email_deliveries', delivery.id, 'failure',
      jsonb_build_object('template', delivery.template, 'retry', false)
    );
    return;
  end if;

  next_status := p_outcome::public.email_delivery_status;
  update public.email_deliveries
     set status = next_status,
         provider_message_id = left(nullif(btrim(coalesce(p_provider_message_id, '')), ''), 200),
         last_error = case when p_outcome = 'bounced' then left(coalesce(p_error, 'bounced'), 500) else null end
   where id = delivery.id;
  -- sealed invitation link: sent, queued, bounced and suppressed are final.
  perform app.scrub_invitation_link(event.id);

  if p_outcome = 'bounced' then
    insert into public.email_suppressions (organization_id, recipient_email, reason)
    values (delivery.organization_id, delivery.recipient_email, 'hard_bounce')
    on conflict (organization_id, recipient_email) do nothing;
    if delivery.critical and delivery.matter_id is not null then
      select membership.id into owner
      from public.memberships membership
      where membership.organization_id = delivery.organization_id
        and membership.role = 'firm_owner'
        and membership.status = 'active'
      order by membership.created_at
      limit 1;
      if owner is not null then
        with opened as (
          insert into public.tasks (
            organization_id, matter_id, audience, title, priority, status,
            owner_membership_id, task_key, due_timezone, checklist
          ) values (
            delivery.organization_id, delivery.matter_id, 'internal',
            'Email was not delivered', 'critical', 'open',
            owner, 'email_delivery_failure', 'America/Toronto', '[]'::jsonb
          )
          on conflict (organization_id) where task_key = 'email_delivery_failure' and status in ('open', 'blocked')
          do nothing
          returning id, organization_id
        )
        insert into public.task_events (organization_id, task_id, event_kind, to_status)
        select opened.organization_id, opened.id, 'created', 'open'::public.task_status
        from opened;
      end if;
    end if;
  end if;

  perform app.record_audit_event(
    delivery.organization_id,
    case p_outcome
      when 'sent' then 'email.sent'
      when 'queued' then 'email.sent'
      when 'bounced' then 'email.bounced'
      else 'email.suppressed'
    end,
    'public.email_deliveries',
    delivery.id,
    case when p_outcome in ('sent', 'queued') then 'success' when p_outcome = 'bounced' then 'failure' else 'denied' end,
    jsonb_build_object(
      'template', delivery.template,
      'recipient_email', delivery.recipient_email,
      'provider_message_id', left(coalesce(p_provider_message_id, ''), 200)
    )
  );

  if not exists (
    select 1
    from public.email_deliveries pending
    where pending.outbox_event_id = event.id
      and pending.status in ('pending', 'sending', 'failed')
  ) then
    perform app.mark_outbox_published(event.id, p_worker);
  end if;
end;
$$;

-- Replacing keeps privileges; restated so this file reads on its own.
revoke all on function public.claim_mail_events(text, integer) from public, anon, authenticated;
grant execute on function public.claim_mail_events(text, integer) to service_role;
revoke all on function public.prepare_email_delivery(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.prepare_email_delivery(uuid, text, text, text) to service_role;
revoke all on function public.finish_email_delivery(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.finish_email_delivery(uuid, text, text, text, text) to service_role;
