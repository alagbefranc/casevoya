-- T010 outbound mail. Rows are queued from the transactional outbox and sent by the
-- Next.js server through Cloudflare Email Sending. Payloads stay ids and labels.
-- The raw invitation token is never copied into the outbox. Additive only.

create type public.email_delivery_status as enum (
  'pending',
  'sending',
  'sent',
  'queued',
  'bounced',
  'suppressed',
  'skipped',
  'failed'
);

create type public.email_template as enum (
  'invite',
  'reminder',
  'agreement',
  'signature',
  'document_request',
  'document_receipt'
);

insert into public.product_settings (key, value, description, pending_confirmation) values
  (
    'email.from_address',
    '{"address":"notices@casevoya.ca"}'::jsonb,
    'Confirmed platform From address for firm notices. The visible sender name is the firm display name. Still configurable.',
    false
  );

create table public.email_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  outbox_event_id uuid not null references public.outbox_events (id),
  recipient_email text not null check (
    recipient_email = lower(recipient_email)
    and length(recipient_email) between 3 and 320
  ),
  template public.email_template not null,
  status public.email_delivery_status not null default 'pending',
  provider_message_id text check (provider_message_id is null or length(provider_message_id) <= 200),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error text check (last_error is null or length(last_error) <= 500),
  matter_id uuid,
  critical boolean not null default false,
  context jsonb not null default '{}'::jsonb check (
    jsonb_typeof(context) = 'object' and pg_column_size(context) <= 2000
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (organization_id, outbox_event_id, recipient_email),
  unique (id, organization_id),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id)
);
comment on table public.email_deliveries is
  'One row is one recipient of one outbox event. A second prepare does not send a row that already reached a terminal status.';

create index email_deliveries_org_fk_idx on public.email_deliveries (organization_id);
create index email_deliveries_outbox_fk_idx on public.email_deliveries (outbox_event_id);
create index email_deliveries_matter_org_fk_idx on public.email_deliveries (matter_id, organization_id);
create index email_deliveries_created_by_idx on public.email_deliveries (created_by);

create trigger email_deliveries_touch before update on public.email_deliveries
  for each row execute function app.touch_row();
create trigger email_deliveries_stamp before insert on public.email_deliveries
  for each row execute function app.stamp_created_by();

create table public.email_suppressions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  recipient_email text not null check (
    recipient_email = lower(recipient_email)
    and length(recipient_email) between 3 and 320
  ),
  reason text not null check (reason in ('hard_bounce', 'complaint', 'manual', 'policy', 'soft_bounce')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (organization_id, recipient_email)
);
comment on table public.email_suppressions is
  'Local suppression. Checked before any provider call. A hard bounce inserts hard_bounce.';

create index email_suppressions_org_fk_idx on public.email_suppressions (organization_id);
create index email_suppressions_created_by_idx on public.email_suppressions (created_by);

create trigger email_suppressions_touch before update on public.email_suppressions
  for each row execute function app.touch_row();
create trigger email_suppressions_stamp before insert on public.email_suppressions
  for each row execute function app.stamp_created_by();

create unique index tasks_email_delivery_failure_open_uidx
  on public.tasks (organization_id)
  where task_key = 'email_delivery_failure' and status in ('open', 'blocked');

alter table public.email_deliveries enable row level security;
alter table public.email_deliveries force row level security;
alter table public.email_suppressions enable row level security;
alter table public.email_suppressions force row level security;

create policy email_deliveries_select on public.email_deliveries
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.staff_mfa_satisfied())
    and (select app.has_org_role(
      organization_id,
      array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[]
    ))
  );

create policy email_suppressions_select on public.email_suppressions
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.staff_mfa_satisfied())
    and (select app.has_org_role(
      organization_id,
      array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[]
    ))
  );

-- Staff invites now request mail. The payload has no token.
create or replace function app.create_staff_invitation(
  p_organization_id uuid,
  p_email text,
  p_role public.org_role
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  normalized_email text := lower(btrim(coalesce(p_email, '')));
  token text;
  inv public.invitations;
begin
  if actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if app.has_org_role(p_organization_id, array['firm_owner']::public.org_role[]) is distinct from true then
    raise exception 'only a firm owner can invite staff' using errcode = '42501';
  end if;
  if app.staff_mfa_satisfied() is distinct from true
     or app.mfa_step_up_satisfied() is distinct from true then
    raise exception 'staff invitations require a recent TOTP step-up' using errcode = '42501';
  end if;
  if p_role is null or p_role <> all (app.staff_roles()) then
    raise exception 'this invitation path is for staff roles only' using errcode = '42501';
  end if;
  if normalized_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(normalized_email) > 320 then
    raise exception 'email is invalid' using errcode = '22023';
  end if;

  update public.invitations as prior
     set revoked_at = statement_timestamp()
   where prior.organization_id = p_organization_id
     and prior.email = normalized_email
     and prior.role = p_role
     and prior.consumed_at is null
     and prior.revoked_at is null;

  token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.invitations (organization_id, email, role, token_hash, expires_at, created_by)
  values (
    p_organization_id,
    normalized_email,
    p_role,
    app.hash_invitation_token(token),
    statement_timestamp() + interval '7 days',
    actor
  )
  returning * into inv;

  perform app.record_audit_event(
    p_organization_id,
    'invitation.created',
    'public.invitations',
    inv.id,
    'success',
    jsonb_build_object('role', p_role)
  );
  perform app.enqueue_event(
    p_organization_id,
    'invitation',
    inv.id,
    'staff_invitation.email_requested',
    jsonb_build_object(
      'invitation_id', inv.id,
      'role', p_role,
      'recipient_email', normalized_email
    ),
    null,
    'staff-invite-email:' || inv.id::text,
    null
  );
  return token;
end;
$$;

create or replace function app.create_document_request(
  p_matter_id uuid,
  p_person_id uuid,
  p_purpose text,
  p_explanation text,
  p_due_on date,
  p_acceptable_formats text[],
  p_review_criteria text,
  p_expires_on date,
  p_audience public.document_audience,
  p_sensitivity public.document_sensitivity,
  p_rule_version_id uuid,
  p_rule_item_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  matter public.matters%rowtype;
  rule public.rule_versions%rowtype;
  new_id uuid;
  source public.document_request_source;
begin
  select * into matter from public.matters where id = p_matter_id;
  if matter.id is null or app.can_read_matter(matter.id) is distinct from true then
    raise exception 'document request denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    matter.organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[],
    true
  );
  if app.sample_mode_blocks_real(matter.organization_id, matter.is_sample) then
    raise exception 'this firm is in sample mode; only sample matters accept new work' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.persons person
    join public.matter_participants party
      on party.person_id = person.id
     and party.matter_id = matter.id
    where person.id = p_person_id
      and person.organization_id = matter.organization_id
      and person.is_sample is not distinct from matter.is_sample
  ) then
    raise exception 'the request needs a person on this matter' using errcode = '42501';
  end if;
  if p_purpose is null or length(btrim(p_purpose)) not between 1 and 200 then
    raise exception 'document purpose is required' using errcode = '22023';
  end if;
  if p_explanation is null or length(btrim(p_explanation)) not between 3 and 2000 then
    raise exception 'document explanation is required' using errcode = '22023';
  end if;
  if p_acceptable_formats is null or cardinality(p_acceptable_formats) < 1 then
    raise exception 'name at least one acceptable format' using errcode = '22023';
  end if;

  if p_rule_version_id is null then
    if p_rule_item_key is not null then
      raise exception 'a staff request has no rule item' using errcode = '22023';
    end if;
    source := 'staff';
  else
    if p_rule_item_key is null or p_rule_item_key !~ '^[a-z][a-z0-9_]{0,63}$' then
      raise exception 'a rule-derived request needs an item key' using errcode = '22023';
    end if;
    select * into rule from public.rule_versions where id = p_rule_version_id;
    if rule.id is null or rule.status is distinct from 'published' then
      raise exception 'only a published rule version can derive a document request' using errcode = '42501';
    end if;
    if rule.organization_id is not null and rule.organization_id is distinct from matter.organization_id then
      raise exception 'document request denied' using errcode = '42501';
    end if;
    source := 'rule';
  end if;

  insert into public.document_requests (
    organization_id, matter_id, person_id, purpose, explanation, due_on, acceptable_formats,
    review_criteria, expires_on, audience, sensitivity, source, rule_version_id, rule_item_key, created_by
  ) values (
    matter.organization_id,
    matter.id,
    p_person_id,
    btrim(p_purpose),
    btrim(p_explanation),
    p_due_on,
    p_acceptable_formats,
    nullif(btrim(p_review_criteria), ''),
    p_expires_on,
    coalesce(p_audience, 'subject'),
    coalesce(p_sensitivity, 'ordinary'),
    source,
    p_rule_version_id,
    p_rule_item_key,
    (select auth.uid())
  )
  returning id into new_id;

  perform app.record_audit_event(
    matter.organization_id, 'document.request_created', 'document_requests', new_id, 'success',
    jsonb_build_object('source', source, 'matter_id', matter.id)
  );
  perform app.enqueue_event(
    matter.organization_id,
    'document_request',
    new_id,
    'document.request_created',
    jsonb_build_object(
      'request_id', new_id,
      'matter_id', matter.id,
      'person_id', p_person_id,
      'purpose', btrim(p_purpose),
      'due_on', p_due_on
    ),
    null,
    'document-request-email:' || new_id::text,
    null
  );
  return new_id;
end;
$$;

create or replace function public.claim_due_reminders(p_limit integer, p_as_of timestamptz)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  ids uuid[];
  rec record;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') is distinct from 'service_role' then
    raise exception 'worker role required' using errcode = '42501';
  end if;
  with due as (
    select id
    from public.reminder_schedules
    where status = 'pending'
      and scheduled_for <= coalesce(p_as_of, statement_timestamp())
    order by scheduled_for
    for update skip locked
    limit least(greatest(coalesce(p_limit, 20), 1), 100)
  ),
  marked as (
    update public.reminder_schedules schedule
    set status = 'sent',
        sent_at = statement_timestamp()
    from due
    where schedule.id = due.id
    returning schedule.id
  )
  select coalesce(array_agg(id), array[]::uuid[]) into ids from marked;

  for rec in
    select schedule.id,
           schedule.organization_id,
           schedule.reminder_kind,
           schedule.deadline_id,
           schedule.task_id,
           coalesce(deadline.matter_id, task.matter_id) as matter_id
    from public.reminder_schedules schedule
    left join public.deadlines deadline on deadline.id = schedule.deadline_id
    left join public.tasks task on task.id = schedule.task_id
    where schedule.id = any (ids)
  loop
    perform app.enqueue_event(
      rec.organization_id,
      'reminder',
      rec.id,
      'reminder.due',
      jsonb_build_object(
        'reminder_id', rec.id,
        'deadline_id', rec.deadline_id,
        'task_id', rec.task_id,
        'reminder_kind', rec.reminder_kind,
        'matter_id', rec.matter_id
      ),
      null,
      'reminder.due:' || rec.id::text,
      null
    );
  end loop;
  return ids;
end;
$$;

-- Claims only mail events so a mail worker cannot take unrelated outbox rows.
create function public.claim_mail_events(p_worker text, p_limit integer default 20)
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

revoke all on function public.claim_mail_events(text, integer) from public, anon, authenticated;
grant execute on function public.claim_mail_events(text, integer) to service_role;

grant select on table public.email_deliveries to authenticated;
grant select on table public.email_suppressions to authenticated;
