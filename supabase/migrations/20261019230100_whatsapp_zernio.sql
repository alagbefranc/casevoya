-- WhatsApp through Zernio (zernio.com, a messaging API over Meta's WhatsApp Cloud API).
-- Decided by Francis 2026-10-19: "WhatsApp via Zernio; per-firm profile and own number; consent
-- required; no sensitive content in WhatsApp". Additive only.
--
-- Model
--   firm_whatsapp_accounts     one row per firm: its Zernio profile (externalId = organization id)
--                              and the WhatsApp account it connected with Embedded Signup. Only the
--                              firm owner, with a recent step-up, connects or disconnects it.
--   person_whatsapp_contacts   a person's WhatsApp number (E.164), their notice channel (email,
--                              whatsapp, both) and their consent: when, from where (portal or
--                              staff) and who recorded it. No live consent means no WhatsApp.
--   whatsapp_consent_events    append-only history of every consent given, changed or withdrawn.
--   whatsapp_deliveries        one outbound send per outbox event and person, with Zernio's
--                              message id and the delivered / read status from its webhooks.
--   whatsapp_inbound_messages  every WhatsApp message the firm's number received (deduped on
--                              Zernio's event id). A match is filed into the matter's client
--                              conversation (matter_messages, channel 'whatsapp'); anything else
--                              stays open here for staff to triage.
--
-- Outbound (mirrors the mail outbox)
--   When the mail worker queues a client notice (an email_deliveries row for a reminder, document
--   request, invoice, payment problem, booking, agreement or new staff message), a trigger also
--   queues outbox 'whatsapp.notice_requested' for each opted-in person with that address. A staff
--   message to someone whose 24-hour WhatsApp window is open queues 'whatsapp.reply_requested'
--   instead, which sends the staff member's text as the reply. POST /api/whatsapp/dispatch claims
--   both (claim_whatsapp_events), prepares each (prepare_whatsapp_delivery: consent and the
--   firm's number are checked again at send time) and records the outcome
--   (finish_whatsapp_delivery: retries with the outbox's backoff, dead-letters after 8 tries).
--   Notices use approved UTILITY templates whose only variable is the firm's display name: never
--   case facts, document names, UCI or amounts.
--
-- Inbound
--   POST /api/zernio/webhook verifies Zernio's signature, then calls receive_whatsapp_message
--   (message.received) or record_whatsapp_status (message.delivered / read / failed). Both are
--   service role only and idempotent.
--
-- matter_messages gains channel ('portal' default, 'whatsapp'). author_user_id may now be null
-- only for a WhatsApp message from a client without a portal login; every other row still has it.

-- ---------------------------------------------------------------------------
-- Phone numbers
-- ---------------------------------------------------------------------------

-- A phone number in E.164 (+ and 8 to 15 digits), or null. Spaces, dashes, dots and brackets are
-- dropped; 00 becomes +; a 10-digit or 1-prefixed 11-digit North American number gets +1.
-- src/modules/whatsapp/phone.ts mirrors this exactly.
create function app.normalize_phone_e164(p_raw text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  d text := regexp_replace(coalesce(p_raw, ''), '[[:space:]().-]', '', 'g');
begin
  if d ~ '^00' then
    d := '+' || substr(d, 3);
  end if;
  if d ~ '^\+[1-9][0-9]{7,14}$' then
    return d;
  end if;
  if d ~ '^1[2-9][0-9]{9}$' then
    return '+' || d;
  end if;
  if d ~ '^[2-9][0-9]{9}$' then
    return '+1' || d;
  end if;
  return null;
end;
$$;
revoke all on function app.normalize_phone_e164(text) from public;
grant execute on function app.normalize_phone_e164(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.firm_whatsapp_accounts (
  organization_id uuid primary key references public.organizations (id),
  zernio_profile_id text check (zernio_profile_id is null or zernio_profile_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  zernio_account_id text check (zernio_account_id is null or zernio_account_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  display_phone text check (display_phone is null or length(display_phone) <= 40),
  status public.whatsapp_account_status not null default 'pending',
  -- Zernio's shared sandbox number, linked for testing by the operator script only.
  is_sandbox boolean not null default false,
  connected_at timestamptz,
  connected_by uuid references auth.users (id),
  disconnected_at timestamptz,
  disconnected_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1),
  check (status <> 'connected' or zernio_account_id is not null),
  check (is_sandbox or zernio_profile_id is not null or status <> 'connected')
);
comment on table public.firm_whatsapp_accounts is
  'The firm''s Zernio profile and connected WhatsApp number. Ids only, never a token. Written by the owner (step-up) through functions.';

-- One firm per connected number: inbound webhooks are routed by this id.
create unique index firm_whatsapp_accounts_account_uidx
  on public.firm_whatsapp_accounts (zernio_account_id) where status = 'connected';
create index firm_whatsapp_accounts_connected_by_idx on public.firm_whatsapp_accounts (connected_by);
create index firm_whatsapp_accounts_disconnected_by_idx on public.firm_whatsapp_accounts (disconnected_by);

create table public.person_whatsapp_contacts (
  person_id uuid primary key,
  organization_id uuid not null references public.organizations (id),
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  channel public.whatsapp_notice_channel not null default 'email',
  consent_at timestamptz,
  consent_source public.whatsapp_consent_source,
  consent_recorded_by uuid references auth.users (id),
  withdrawn_at timestamptz,
  withdrawn_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1),
  unique (person_id, organization_id),
  foreign key (person_id, organization_id) references public.persons (id, organization_id),
  check ((consent_at is null) = (consent_source is null)),
  check ((consent_at is null) = (consent_recorded_by is null)),
  -- WhatsApp is chosen only with live consent.
  check (channel = 'email' or (consent_at is not null and withdrawn_at is null))
);
comment on table public.person_whatsapp_contacts is
  'A person''s WhatsApp number, notice channel and consent (when, source, who recorded it). Without live consent nothing is sent on WhatsApp.';

create index person_whatsapp_contacts_org_idx on public.person_whatsapp_contacts (organization_id);
create index person_whatsapp_contacts_phone_idx on public.person_whatsapp_contacts (organization_id, phone_e164);
create index person_whatsapp_contacts_recorded_by_idx on public.person_whatsapp_contacts (consent_recorded_by);
create index person_whatsapp_contacts_withdrawn_by_idx on public.person_whatsapp_contacts (withdrawn_by);

create table public.whatsapp_consent_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  person_id uuid not null,
  action text not null check (action in ('given', 'changed', 'withdrawn')),
  channel public.whatsapp_notice_channel not null,
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  source public.whatsapp_consent_source not null,
  recorded_by uuid not null references auth.users (id),
  recorded_at timestamptz not null default clock_timestamp(),
  foreign key (person_id, organization_id) references public.persons (id, organization_id)
);
comment on table public.whatsapp_consent_events is 'Append-only history of WhatsApp consent: given, changed, withdrawn.';

create index whatsapp_consent_events_org_idx on public.whatsapp_consent_events (organization_id);
create index whatsapp_consent_events_person_org_idx on public.whatsapp_consent_events (person_id, organization_id);
create index whatsapp_consent_events_recorded_by_idx on public.whatsapp_consent_events (recorded_by);

create trigger whatsapp_consent_events_append_only before update or delete on public.whatsapp_consent_events
  for each row execute function app.reject_message_change();

create table public.whatsapp_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  outbox_event_id uuid not null references public.outbox_events (id),
  person_id uuid not null,
  matter_id uuid,
  email_delivery_id uuid,
  matter_message_id uuid,
  phone_e164 text check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  kind text not null check (kind in ('template', 'text')),
  template_name text check (template_name is null or template_name ~ '^[a-z][a-z0-9_]{0,99}$'),
  status public.whatsapp_delivery_status not null default 'sending',
  provider_message_id text check (provider_message_id is null or length(provider_message_id) <= 200),
  conversation_id text check (conversation_id is null or length(conversation_id) <= 200),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error text check (last_error is null or length(last_error) <= 500),
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (organization_id, outbox_event_id, person_id),
  foreign key (person_id, organization_id) references public.persons (id, organization_id),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id),
  foreign key (email_delivery_id, organization_id) references public.email_deliveries (id, organization_id),
  foreign key (matter_message_id, organization_id) references public.matter_messages (id, organization_id),
  check (kind <> 'template' or template_name is not null)
);
comment on table public.whatsapp_deliveries is
  'One WhatsApp send per outbox event and person. Never the notice text: templates carry the firm name only. A reply''s text stays in matter_messages.';

create index whatsapp_deliveries_org_idx on public.whatsapp_deliveries (organization_id, created_at desc);
create index whatsapp_deliveries_outbox_idx on public.whatsapp_deliveries (outbox_event_id);
create index whatsapp_deliveries_person_org_idx on public.whatsapp_deliveries (person_id, organization_id, created_at desc);
create index whatsapp_deliveries_matter_org_idx on public.whatsapp_deliveries (matter_id, organization_id);
create index whatsapp_deliveries_email_org_idx on public.whatsapp_deliveries (email_delivery_id, organization_id);
create index whatsapp_deliveries_message_org_idx on public.whatsapp_deliveries (matter_message_id, organization_id);
create index whatsapp_deliveries_created_by_idx on public.whatsapp_deliveries (created_by);
create index whatsapp_deliveries_provider_idx on public.whatsapp_deliveries (provider_message_id) where provider_message_id is not null;

create trigger whatsapp_deliveries_touch before update on public.whatsapp_deliveries
  for each row execute function app.touch_row();

alter table public.matter_messages add column channel public.message_channel not null default 'portal';
alter table public.matter_messages alter column author_user_id drop not null;
alter table public.matter_messages add constraint matter_messages_author_user_or_whatsapp
  check (author_user_id is not null or (channel = 'whatsapp' and author_kind = 'client'));

create table public.whatsapp_inbound_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  zernio_event_id text not null check (length(zernio_event_id) between 1 and 200),
  platform_message_id text not null check (length(platform_message_id) between 1 and 200),
  conversation_id text check (conversation_id is null or length(conversation_id) <= 200),
  sender_phone_e164 text check (sender_phone_e164 is null or sender_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  sender_bsuid text check (sender_bsuid is null or length(sender_bsuid) <= 200),
  sender_name text check (sender_name is null or length(sender_name) <= 200),
  -- Only an unmatched message keeps its text here (for triage); a filed one lives in matter_messages.
  body text check (body is null or length(body) <= 4000),
  has_attachments boolean not null default false,
  person_id uuid,
  matter_id uuid,
  matter_message_id uuid,
  triage_state text not null check (triage_state in ('filed', 'open', 'dismissed')),
  reason text check (reason is null or reason in ('no_match', 'several_people', 'no_open_matter', 'several_matters', 'sample')),
  sent_at timestamptz,
  received_at timestamptz not null default clock_timestamp(),
  unique (zernio_event_id),
  unique (organization_id, platform_message_id),
  foreign key (person_id, organization_id) references public.persons (id, organization_id),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id),
  foreign key (matter_message_id, organization_id) references public.matter_messages (id, organization_id),
  check ((triage_state = 'filed') = (matter_message_id is not null)),
  check (triage_state <> 'filed' or body is null)
);
comment on table public.whatsapp_inbound_messages is
  'WhatsApp messages the firm''s number received. Filed ones point at their matter message; open ones wait for staff to triage.';

create index whatsapp_inbound_org_idx on public.whatsapp_inbound_messages (organization_id, received_at desc);
create index whatsapp_inbound_open_idx on public.whatsapp_inbound_messages (organization_id) where triage_state = 'open';
create index whatsapp_inbound_person_org_idx on public.whatsapp_inbound_messages (person_id, organization_id, received_at desc);
create index whatsapp_inbound_matter_org_idx on public.whatsapp_inbound_messages (matter_id, organization_id);
create index whatsapp_inbound_message_org_idx on public.whatsapp_inbound_messages (matter_message_id, organization_id);

-- ---------------------------------------------------------------------------
-- Privileges and RLS. Reads only; every write goes through the functions below.
-- ---------------------------------------------------------------------------

revoke all on table public.firm_whatsapp_accounts from anon, authenticated;
revoke all on table public.person_whatsapp_contacts from anon, authenticated;
revoke all on table public.whatsapp_consent_events from anon, authenticated;
revoke all on table public.whatsapp_deliveries from anon, authenticated;
revoke all on table public.whatsapp_inbound_messages from anon, authenticated;
grant select on table public.firm_whatsapp_accounts to authenticated;
grant select on table public.person_whatsapp_contacts to authenticated;
grant select on table public.whatsapp_consent_events to authenticated;
grant select on table public.whatsapp_deliveries to authenticated;
grant select on table public.whatsapp_inbound_messages to authenticated;

alter table public.firm_whatsapp_accounts enable row level security;
alter table public.firm_whatsapp_accounts force row level security;
alter table public.person_whatsapp_contacts enable row level security;
alter table public.person_whatsapp_contacts force row level security;
alter table public.whatsapp_consent_events enable row level security;
alter table public.whatsapp_consent_events force row level security;
alter table public.whatsapp_deliveries enable row level security;
alter table public.whatsapp_deliveries force row level security;
alter table public.whatsapp_inbound_messages enable row level security;
alter table public.whatsapp_inbound_messages force row level security;

-- Staff of the firm (any staff role, staff assurance) see whether WhatsApp is connected.
create policy firm_whatsapp_accounts_select on public.firm_whatsapp_accounts
  for select to authenticated
  using (
    (select app.in_active_org(organization_id))
    and (select app.staff_mfa_satisfied())
    and (select app.is_org_staff(organization_id))
  );

-- The person themselves, the firm owner, and staff assigned to a matter the person is on.
create function app.can_read_person_contact(p_person_id uuid, p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.in_active_org(p_org)
     and (
       exists (
         select 1 from public.persons person
         where person.id = p_person_id
           and person.organization_id = p_org
           and person.user_id = (select auth.uid())
       )
       or (
         app.staff_mfa_satisfied()
         and (
           app.has_org_role(p_org, array['firm_owner']::public.org_role[])
           or exists (
             select 1
             from public.matter_participants party
             where party.person_id = p_person_id
               and party.organization_id = p_org
               and app.actor_staff_assigned_to_matter(party.matter_id, party.organization_id)
           )
         )
       )
     );
$$;
revoke all on function app.can_read_person_contact(uuid, uuid) from public;
grant execute on function app.can_read_person_contact(uuid, uuid) to authenticated, service_role;

create policy person_whatsapp_contacts_select on public.person_whatsapp_contacts
  for select to authenticated
  using ((select app.can_read_person_contact(person_id, organization_id)));

create policy whatsapp_consent_events_select on public.whatsapp_consent_events
  for select to authenticated
  using ((select app.can_read_person_contact(person_id, organization_id)));

-- Delivery status: staff who read the matter's messages (the owner for a delivery with no matter).
create policy whatsapp_deliveries_select on public.whatsapp_deliveries
  for select to authenticated
  using (
    (select app.in_active_org(organization_id))
    and (select app.staff_mfa_satisfied())
    and case
      when matter_id is null then (select app.has_org_role(organization_id, array['firm_owner']::public.org_role[]))
      else (select app.message_staff_reads_matter(matter_id, organization_id))
    end
  );

-- Filed messages: staff who read that matter. Open ones (to triage): the firm's case staff.
create policy whatsapp_inbound_messages_select on public.whatsapp_inbound_messages
  for select to authenticated
  using (
    (select app.in_active_org(organization_id))
    and (select app.staff_mfa_satisfied())
    and case
      when matter_id is not null then (select app.message_staff_reads_matter(matter_id, organization_id))
      else (select app.has_org_role(
        organization_id,
        array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[]
      ))
    end
  );

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- The firm's connected WhatsApp account id, or null.
create function app.firm_whatsapp_account(p_org uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select account.zernio_account_id
  from public.firm_whatsapp_accounts account
  where account.organization_id = p_org and account.status = 'connected';
$$;
revoke all on function app.firm_whatsapp_account(uuid) from public;

-- The person's WhatsApp number when they chose WhatsApp (or both) with live consent; else null.
create function app.whatsapp_opted_in_phone(p_person_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select contact.phone_e164
  from public.person_whatsapp_contacts contact
  join public.persons person
    on person.id = contact.person_id
   and person.organization_id = contact.organization_id
  where contact.person_id = p_person_id
    and contact.channel in ('whatsapp', 'both')
    and contact.consent_at is not null
    and contact.withdrawn_at is null
    and person.is_sample is false;
$$;
revoke all on function app.whatsapp_opted_in_phone(uuid) from public;

-- When the person's 24-hour customer-service window closes: 24 hours after the last WhatsApp
-- message they sent the firm. Null when they never wrote.
create function app.whatsapp_window_until(p_org uuid, p_person_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select max(coalesce(least(inbound.sent_at, inbound.received_at), inbound.received_at)) + interval '24 hours'
  from public.whatsapp_inbound_messages inbound
  where inbound.organization_id = p_org
    and inbound.person_id = p_person_id;
$$;
revoke all on function app.whatsapp_window_until(uuid, uuid) from public;
grant execute on function app.whatsapp_window_until(uuid, uuid) to service_role;

-- Records one consent change and keeps the history.
create function app.write_whatsapp_contact(
  p_org uuid,
  p_person_id uuid,
  p_phone text,
  p_channel public.whatsapp_notice_channel,
  p_source public.whatsapp_consent_source
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  v_cur public.person_whatsapp_contacts%rowtype;
  v_live boolean;
  v_action text;
  v_phone text := app.normalize_phone_e164(p_phone);
begin
  if actor is null then
    raise exception 'sign in is required' using errcode = '42501';
  end if;
  if p_channel is null then
    raise exception 'choose email, WhatsApp or both' using errcode = '22023';
  end if;
  select * into v_cur from public.person_whatsapp_contacts where person_id = p_person_id for update;
  v_live := v_cur.person_id is not null and v_cur.consent_at is not null and v_cur.withdrawn_at is null;

  if p_channel = 'email' then
    if v_cur.person_id is null then
      return jsonb_build_object('channel', 'email', 'consent', false);
    end if;
    update public.person_whatsapp_contacts
       set channel = 'email',
           phone_e164 = coalesce(v_phone, phone_e164),
           withdrawn_at = case when v_live then clock_timestamp() else withdrawn_at end,
           withdrawn_by = case when v_live then actor else withdrawn_by end,
           updated_at = now(),
           version = version + 1
     where person_id = p_person_id;
    if v_live then
      insert into public.whatsapp_consent_events (organization_id, person_id, action, channel, phone_e164, source, recorded_by)
      values (p_org, p_person_id, 'withdrawn', 'email', v_cur.phone_e164, p_source, actor);
      perform app.record_audit_event(p_org, 'whatsapp.consent_withdrawn', 'public.persons', p_person_id, 'success',
        jsonb_build_object('source', p_source));
    end if;
    return jsonb_build_object('channel', 'email', 'consent', false);
  end if;

  if v_phone is null then
    raise exception 'add a mobile number with the country code first' using errcode = '22023';
  end if;
  -- A new number, or consent that was withdrawn, is a new consent.
  if v_live and v_cur.phone_e164 = v_phone then
    v_action := case when v_cur.channel = p_channel then null else 'changed' end;
    update public.person_whatsapp_contacts
       set channel = p_channel, updated_at = now(), version = version + 1
     where person_id = p_person_id;
  else
    v_action := 'given';
    insert into public.person_whatsapp_contacts (
      person_id, organization_id, phone_e164, channel, consent_at, consent_source, consent_recorded_by
    ) values (
      p_person_id, p_org, v_phone, p_channel, clock_timestamp(), p_source, actor
    )
    on conflict (person_id) do update
      set phone_e164 = excluded.phone_e164,
          channel = excluded.channel,
          consent_at = excluded.consent_at,
          consent_source = excluded.consent_source,
          consent_recorded_by = excluded.consent_recorded_by,
          withdrawn_at = null,
          withdrawn_by = null,
          updated_at = now(),
          version = public.person_whatsapp_contacts.version + 1;
  end if;
  if v_action is not null then
    insert into public.whatsapp_consent_events (organization_id, person_id, action, channel, phone_e164, source, recorded_by)
    values (p_org, p_person_id, v_action, p_channel, v_phone, p_source, actor);
    perform app.record_audit_event(p_org,
      case when v_action = 'given' then 'whatsapp.consent_given' else 'whatsapp.consent_changed' end,
      'public.persons', p_person_id, 'success',
      jsonb_build_object('source', p_source, 'channel', p_channel));
  end if;
  return jsonb_build_object('channel', p_channel, 'consent', true);
end;
$$;
revoke all on function app.write_whatsapp_contact(uuid, uuid, text, public.whatsapp_notice_channel, public.whatsapp_consent_source) from public;

-- Keeps the client's "Email notices" switch in line with the channel: WhatsApp only turns routine
-- email notices off; email or both turns them on. Critical notices are always emailed.
create function app.sync_email_notices(p_org uuid, p_person_id uuid, p_channel public.whatsapp_notice_channel)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.person_contact_preferences (person_id, organization_id, email_notices)
  values (p_person_id, p_org, p_channel <> 'whatsapp')
  on conflict (person_id) do update
    set email_notices = excluded.email_notices,
        updated_at = now(),
        version = public.person_contact_preferences.version + 1
  where public.person_contact_preferences.email_notices is distinct from excluded.email_notices;
end;
$$;
revoke all on function app.sync_email_notices(uuid, uuid, public.whatsapp_notice_channel) from public;

-- ---------------------------------------------------------------------------
-- Firm connection (owner with a recent step-up)
-- ---------------------------------------------------------------------------

create function public.save_firm_zernio_profile(p_organization_id uuid, p_profile_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cur public.firm_whatsapp_accounts%rowtype;
begin
  perform app.require_firm_owner_step_up(p_organization_id);
  if p_profile_id is null or p_profile_id !~ '^[A-Za-z0-9_-]{1,64}$' then
    raise exception 'profile id is invalid' using errcode = '22023';
  end if;
  select * into v_cur from public.firm_whatsapp_accounts where organization_id = p_organization_id for update;
  if v_cur.organization_id is null then
    insert into public.firm_whatsapp_accounts (organization_id, zernio_profile_id, status)
    values (p_organization_id, p_profile_id, 'pending');
  elsif v_cur.zernio_profile_id is distinct from p_profile_id then
    if v_cur.status = 'connected' then
      raise exception 'disconnect WhatsApp before changing the profile' using errcode = '42501';
    end if;
    update public.firm_whatsapp_accounts
       set zernio_profile_id = p_profile_id, updated_at = now(), version = version + 1
     where organization_id = p_organization_id;
  else
    return;
  end if;
  perform app.record_audit_event(p_organization_id, 'whatsapp.profile_saved', 'public.firm_whatsapp_accounts', null, 'success', '{}'::jsonb);
end;
$$;
revoke all on function public.save_firm_zernio_profile(uuid, text) from public, anon;
grant execute on function public.save_firm_zernio_profile(uuid, text) to authenticated;

-- The owner records the account Embedded Signup returned (the server checked with Zernio that it
-- is a WhatsApp account on this firm's profile). The service role links Zernio's sandbox number
-- for testing (scripts/ops/zernio-whatsapp.mjs), never through the app.
create function public.connect_firm_whatsapp(
  p_organization_id uuid,
  p_account_id text,
  p_display_phone text default null,
  p_sandbox boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  service boolean := coalesce((select auth.jwt() ->> 'role'), '') = 'service_role';
  v_cur public.firm_whatsapp_accounts%rowtype;
begin
  if not service then
    perform app.require_firm_owner_step_up(p_organization_id);
    if coalesce(p_sandbox, false) then
      raise exception 'the sandbox number is linked by the operator only' using errcode = '42501';
    end if;
  end if;
  if p_account_id is null or p_account_id !~ '^[A-Za-z0-9_-]{1,64}$' then
    raise exception 'account id is invalid' using errcode = '22023';
  end if;
  select * into v_cur from public.firm_whatsapp_accounts where organization_id = p_organization_id for update;
  if not service and v_cur.zernio_profile_id is null then
    raise exception 'start the WhatsApp connection from Settings first' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.firm_whatsapp_accounts other
    where other.zernio_account_id = p_account_id
      and other.status = 'connected'
      and other.organization_id <> p_organization_id
  ) then
    raise exception 'that WhatsApp number is connected to another firm' using errcode = '23505';
  end if;
  insert into public.firm_whatsapp_accounts (
    organization_id, zernio_profile_id, zernio_account_id, display_phone, status, is_sandbox, connected_at, connected_by
  ) values (
    p_organization_id, v_cur.zernio_profile_id, p_account_id, left(nullif(btrim(coalesce(p_display_phone, '')), ''), 40), 'connected',
    coalesce(p_sandbox, false), clock_timestamp(), (select auth.uid())
  )
  on conflict (organization_id) do update
    set zernio_account_id = excluded.zernio_account_id,
        display_phone = excluded.display_phone,
        status = 'connected',
        is_sandbox = excluded.is_sandbox,
        connected_at = excluded.connected_at,
        connected_by = excluded.connected_by,
        disconnected_at = null,
        disconnected_by = null,
        updated_at = now(),
        version = public.firm_whatsapp_accounts.version + 1;
  perform app.record_audit_event(p_organization_id, 'whatsapp.connected', 'public.firm_whatsapp_accounts', null, 'success',
    jsonb_build_object('sandbox', coalesce(p_sandbox, false)));
end;
$$;
revoke all on function public.connect_firm_whatsapp(uuid, text, text, boolean) from public, anon;
grant execute on function public.connect_firm_whatsapp(uuid, text, text, boolean) to authenticated, service_role;

-- The owner disconnects. Returns the account id so the server can remove it from Zernio (never
-- the shared sandbox). Nothing more is sent on WhatsApp from this moment.
create function public.disconnect_firm_whatsapp(p_organization_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cur public.firm_whatsapp_accounts%rowtype;
begin
  perform app.require_firm_owner_step_up(p_organization_id);
  select * into v_cur from public.firm_whatsapp_accounts where organization_id = p_organization_id for update;
  if v_cur.organization_id is null or v_cur.status <> 'connected' then
    return jsonb_build_object('account_id', null, 'sandbox', false);
  end if;
  update public.firm_whatsapp_accounts
     set status = 'disconnected',
         disconnected_at = clock_timestamp(),
         disconnected_by = (select auth.uid()),
         updated_at = now(),
         version = version + 1
   where organization_id = p_organization_id;
  perform app.record_audit_event(p_organization_id, 'whatsapp.disconnected', 'public.firm_whatsapp_accounts', null, 'success',
    jsonb_build_object('sandbox', v_cur.is_sandbox));
  return jsonb_build_object('account_id', v_cur.zernio_account_id, 'sandbox', v_cur.is_sandbox);
end;
$$;
revoke all on function public.disconnect_firm_whatsapp(uuid) from public, anon;
grant execute on function public.disconnect_firm_whatsapp(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Consent (the client themselves, or staff recording what the client said)
-- ---------------------------------------------------------------------------

-- The signed-in client chooses for themselves, with the mobile number on their record (they
-- cannot point notices at another number from here).
create function public.set_my_whatsapp_notices(p_organization_id uuid, p_channel public.whatsapp_notice_channel)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  me public.persons%rowtype;
  result jsonb;
begin
  if actor is null or app.in_active_org(p_organization_id) is distinct from true then
    raise exception 'whatsapp preference denied' using errcode = '42501';
  end if;
  select * into me from public.persons
  where organization_id = p_organization_id and user_id = actor
  order by created_at
  limit 1;
  if me.id is null or me.is_sample then
    raise exception 'whatsapp preference denied' using errcode = '42501';
  end if;
  result := app.write_whatsapp_contact(p_organization_id, me.id, me.contact_phone, p_channel, 'portal');
  perform app.sync_email_notices(p_organization_id, me.id, p_channel);
  return result;
end;
$$;
revoke all on function public.set_my_whatsapp_notices(uuid, public.whatsapp_notice_channel) from public, anon;
grant execute on function public.set_my_whatsapp_notices(uuid, public.whatsapp_notice_channel) to authenticated;

-- Staff who can read one of the person's matters (or the owner) record the client's choice.
create function public.set_person_whatsapp(
  p_organization_id uuid,
  p_person_id uuid,
  p_phone text,
  p_channel public.whatsapp_notice_channel
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  person public.persons%rowtype;
  result jsonb;
begin
  perform app.require_active_staff(
    p_organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[],
    false
  );
  select * into person from public.persons where id = p_person_id and organization_id = p_organization_id;
  if person.id is null
     or person.is_sample
     or not (
       app.has_org_role(p_organization_id, array['firm_owner']::public.org_role[])
       or exists (
         select 1 from public.matter_participants party
         where party.person_id = person.id
           and party.organization_id = person.organization_id
           and app.can_read_matter(party.matter_id)
       )
     ) then
    raise exception 'whatsapp preference denied' using errcode = '42501';
  end if;
  result := app.write_whatsapp_contact(p_organization_id, person.id, coalesce(nullif(btrim(coalesce(p_phone, '')), ''), person.contact_phone), p_channel, 'staff');
  perform app.sync_email_notices(p_organization_id, person.id, p_channel);
  return result;
end;
$$;
revoke all on function public.set_person_whatsapp(uuid, uuid, text, public.whatsapp_notice_channel) from public, anon;
grant execute on function public.set_person_whatsapp(uuid, uuid, text, public.whatsapp_notice_channel) to authenticated;

-- ---------------------------------------------------------------------------
-- Outbound: queue
-- ---------------------------------------------------------------------------

-- A client notice email was queued: also queue a WhatsApp notice for each opted-in person with
-- that address. Only when the email itself is due, or was skipped by that person's own "Email
-- notices" choice; reminders honour "Deadline reminders" as the email does. A staff message to
-- someone whose 24-hour window is open goes as the reply (matter_messages trigger) instead.
create function app.email_delivery_whatsapp_notice()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec record;
begin
  if new.template::text not in (
    'reminder', 'document_request', 'invoice', 'payment_failed', 'message', 'agreement',
    'consultation_booked', 'consultation_rescheduled', 'consultation_cancelled'
  ) then
    return null;
  end if;
  if coalesce(new.context ->> 'audience', '') = 'staff' or app.firm_whatsapp_account(new.organization_id) is null then
    return null;
  end if;
  if new.matter_id is not null and exists (
    select 1 from public.matters matter where matter.id = new.matter_id and matter.is_sample
  ) then
    return null;
  end if;
  for rec in
    select person.id,
           pref.email_notices,
           pref.deadline_reminders
    from public.persons person
    left join public.person_contact_preferences pref on pref.person_id = person.id
    where person.organization_id = new.organization_id
      and lower(person.email) = new.recipient_email
      and app.whatsapp_opted_in_phone(person.id) is not null
      and (
        new.matter_id is null
        or exists (
          select 1 from public.matter_participants party
          where party.person_id = person.id
            and party.matter_id = new.matter_id
            and party.organization_id = new.organization_id
        )
      )
  loop
    if not (new.status = 'sending' or (new.status = 'skipped' and rec.email_notices is false and not new.critical)) then
      continue;
    end if;
    if new.template = 'reminder'
       and coalesce(new.context ->> 'reminder_kind', '') <> 'immediate'
       and rec.deadline_reminders is not true then
      continue;
    end if;
    if new.template = 'message'
       and coalesce(app.whatsapp_window_until(new.organization_id, rec.id), '-infinity'::timestamptz) > clock_timestamp() then
      continue;
    end if;
    perform app.enqueue_event(
      new.organization_id, 'whatsapp', new.id, 'whatsapp.notice_requested',
      jsonb_build_object('email_delivery_id', new.id, 'person_id', rec.id, 'matter_id', new.matter_id),
      null, 'whatsapp.notice:' || new.id::text || ':' || rec.id::text, null
    );
  end loop;
  return null;
end;
$$;
revoke all on function app.email_delivery_whatsapp_notice() from public;

create trigger email_deliveries_whatsapp_notice after insert on public.email_deliveries
  for each row execute function app.email_delivery_whatsapp_notice();

-- A staff message: each addressed person who chose WhatsApp and wrote within 24 hours gets the
-- staff member's text as a WhatsApp reply.
create function app.matter_message_whatsapp_reply()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec record;
begin
  if new.author_kind <> 'staff' or app.firm_whatsapp_account(new.organization_id) is null then
    return null;
  end if;
  if exists (select 1 from public.message_threads thread where thread.id = new.thread_id and thread.is_sample) then
    return null;
  end if;
  for rec in
    select tp.person_id
    from public.message_thread_people tp
    where tp.thread_id = new.thread_id
      and tp.organization_id = new.organization_id
      and app.whatsapp_opted_in_phone(tp.person_id) is not null
      and coalesce(app.whatsapp_window_until(new.organization_id, tp.person_id), '-infinity'::timestamptz) > clock_timestamp()
  loop
    perform app.enqueue_event(
      new.organization_id, 'whatsapp', new.id, 'whatsapp.reply_requested',
      jsonb_build_object('message_id', new.id, 'person_id', rec.person_id, 'matter_id', new.matter_id),
      null, 'whatsapp.reply:' || new.id::text || ':' || rec.person_id::text, null
    );
  end loop;
  return null;
end;
$$;
revoke all on function app.matter_message_whatsapp_reply() from public;

create trigger matter_messages_whatsapp_reply after insert on public.matter_messages
  for each row execute function app.matter_message_whatsapp_reply();

-- ---------------------------------------------------------------------------
-- Outbound: worker API (service role only), the same shape as the mail worker's
-- ---------------------------------------------------------------------------

create function public.claim_whatsapp_events(p_worker text, p_limit integer default 20)
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
    where c.event_type in ('whatsapp.notice_requested', 'whatsapp.reply_requested')
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
    returning event.id, event.organization_id, event.event_type, event.attempts
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', locked.id,
    'organization_id', locked.organization_id,
    'event_type', locked.event_type,
    'attempts', locked.attempts
  )), '[]'::jsonb)
  into claimed
  from locked;
  return claimed;
end;
$$;
revoke all on function public.claim_whatsapp_events(text, integer) from public, anon, authenticated;
grant execute on function public.claim_whatsapp_events(text, integer) to service_role;

-- Records a send that will not happen, and closes the event.
create function app.skip_whatsapp_event(
  p_event public.outbox_events,
  p_worker text,
  p_person uuid,
  p_matter uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_person is not null and exists (
    select 1 from public.persons person where person.id = p_person and person.organization_id = p_event.organization_id
  ) then
    insert into public.whatsapp_deliveries (organization_id, outbox_event_id, person_id, matter_id, kind, template_name, status, last_error)
    values (p_event.organization_id, p_event.id, p_person,
            case when exists (select 1 from public.matters m where m.id = p_matter and m.organization_id = p_event.organization_id) then p_matter end,
            'template', 'casevoya_portal_notice', 'skipped', left(p_reason, 500))
    on conflict (organization_id, outbox_event_id, person_id) do nothing;
  end if;
  perform app.mark_outbox_published(p_event.id, p_worker);
  perform app.record_audit_event(p_event.organization_id, 'whatsapp.skipped', 'public.outbox_events', p_event.id, 'success',
    jsonb_build_object('reason', p_reason));
  return jsonb_build_object('action', 'done', 'event_id', p_event.id, 'reason', p_reason);
end;
$$;
revoke all on function app.skip_whatsapp_event(public.outbox_events, text, uuid, uuid, text) from public;

-- What to send for one claimed event. Consent, the firm's number and the 24-hour window are all
-- checked again now, not when the event was queued. A template notice carries one variable, the
-- firm's display name; a reply carries the staff member's own message text.
create function public.prepare_whatsapp_delivery(p_event_id uuid, p_worker text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  event public.outbox_events%rowtype;
  v_person uuid;
  v_matter uuid;
  account public.firm_whatsapp_accounts%rowtype;
  phone text;
  firm_name text;
  source public.email_deliveries%rowtype;
  message public.matter_messages%rowtype;
  kind text := 'template';
  template text := 'casevoya_portal_notice';
  conversation text;
  delivery public.whatsapp_deliveries%rowtype;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') is distinct from 'service_role' then
    raise exception 'worker role required' using errcode = '42501';
  end if;
  select * into event from public.outbox_events where id = p_event_id;
  if event.id is null or event.event_type not in ('whatsapp.notice_requested', 'whatsapp.reply_requested') then
    raise exception 'whatsapp event was not found' using errcode = '42501';
  end if;
  if event.status = 'published' then
    return jsonb_build_object('action', 'done', 'event_id', event.id);
  end if;
  if event.status is distinct from 'processing'
     or event.locked_by is distinct from left(btrim(coalesce(p_worker, '')), 200) then
    raise exception 'whatsapp event is not claimed' using errcode = '42501';
  end if;

  if coalesce(event.payload ->> 'person_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_person := (event.payload ->> 'person_id')::uuid;
  end if;
  if coalesce(event.payload ->> 'matter_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_matter := (event.payload ->> 'matter_id')::uuid;
  end if;

  select * into account from public.firm_whatsapp_accounts
  where organization_id = event.organization_id and status = 'connected';
  if account.organization_id is null then
    return app.skip_whatsapp_event(event, p_worker, v_person, v_matter, 'not_connected');
  end if;
  phone := app.whatsapp_opted_in_phone(v_person);
  if phone is null or not exists (
    select 1 from public.persons person where person.id = v_person and person.organization_id = event.organization_id
  ) then
    return app.skip_whatsapp_event(event, p_worker, v_person, v_matter, 'no_consent');
  end if;
  select display_name into firm_name from public.organizations where id = event.organization_id;

  if event.event_type = 'whatsapp.reply_requested' then
    select * into message from public.matter_messages m
    where m.id::text = event.payload ->> 'message_id'
      and m.organization_id = event.organization_id
      and m.author_kind = 'staff';
    if message.id is null then
      return app.skip_whatsapp_event(event, p_worker, v_person, v_matter, 'no_message');
    end if;
    if coalesce(app.whatsapp_window_until(event.organization_id, v_person), '-infinity'::timestamptz) > clock_timestamp() then
      kind := 'text';
      template := null;
      select inbound.conversation_id into conversation
      from public.whatsapp_inbound_messages inbound
      where inbound.organization_id = event.organization_id
        and inbound.person_id = v_person
        and inbound.conversation_id is not null
      order by inbound.received_at desc
      limit 1;
      if conversation is null then
        kind := 'template';
        template := 'casevoya_portal_notice';
      end if;
    end if;
  else
    select * into source from public.email_deliveries d
    where d.id::text = event.payload ->> 'email_delivery_id'
      and d.organization_id = event.organization_id;
    if source.id is null then
      return app.skip_whatsapp_event(event, p_worker, v_person, v_matter, 'no_source');
    end if;
    template := case when source.template::text in ('reminder', 'consultation_booked', 'consultation_rescheduled', 'consultation_cancelled')
      then 'casevoya_portal_reminder' else 'casevoya_portal_notice' end;
  end if;
  -- Zernio's shared sandbox number sends only its own locked template (no variables).
  if account.is_sandbox and kind = 'template' then
    template := 'sandbox_start';
  end if;

  insert into public.whatsapp_deliveries (
    organization_id, outbox_event_id, person_id, matter_id, email_delivery_id, matter_message_id,
    phone_e164, kind, template_name, status, conversation_id, attempt_count
  ) values (
    event.organization_id, event.id, v_person,
    case when exists (select 1 from public.matters m where m.id = v_matter and m.organization_id = event.organization_id) then v_matter end,
    source.id, message.id, phone, kind, template, 'sending', conversation, 1
  )
  on conflict (organization_id, outbox_event_id, person_id) do update
    set attempt_count = public.whatsapp_deliveries.attempt_count + 1,
        phone_e164 = excluded.phone_e164,
        kind = excluded.kind,
        template_name = excluded.template_name,
        conversation_id = excluded.conversation_id
    where public.whatsapp_deliveries.status = 'sending'
  returning * into delivery;
  if delivery.id is null then
    -- Already final from an earlier attempt.
    perform app.mark_outbox_published(event.id, p_worker);
    return jsonb_build_object('action', 'done', 'event_id', event.id);
  end if;

  return jsonb_build_object(
    'action', 'send',
    'event_id', event.id,
    'delivery_id', delivery.id,
    'account_id', account.zernio_account_id,
    'to', regexp_replace(phone, '[^0-9]', '', 'g'),
    'kind', kind,
    'template_name', template,
    'template_language', 'en',
    'firm_name', left(coalesce(firm_name, 'Your firm'), 60),
    'body', case when kind = 'text' then message.body end,
    'conversation_id', conversation,
    'sandbox', account.is_sandbox
  );
end;
$$;
revoke all on function public.prepare_whatsapp_delivery(uuid, text) from public, anon, authenticated;
grant execute on function public.prepare_whatsapp_delivery(uuid, text) to service_role;

-- The worker's outcome: sent (Zernio accepted it), retry (the outbox backoff, dead-lettered after
-- 8 tries) or terminal_failure (no retry).
create function public.finish_whatsapp_delivery(
  p_delivery_id uuid,
  p_worker text,
  p_outcome text,
  p_provider_message_id text default null,
  p_conversation_id text default null,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  delivery public.whatsapp_deliveries%rowtype;
  event public.outbox_events%rowtype;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') is distinct from 'service_role' then
    raise exception 'worker role required' using errcode = '42501';
  end if;
  p_error := nullif(btrim(coalesce(p_error, '')), '');
  if p_outcome is null or p_outcome not in ('sent', 'retry', 'terminal_failure') then
    raise exception 'delivery outcome is invalid' using errcode = '22023';
  end if;
  select * into delivery from public.whatsapp_deliveries where id = p_delivery_id for update;
  if delivery.id is null then
    raise exception 'delivery was not found' using errcode = '42501';
  end if;
  select * into event from public.outbox_events where id = delivery.outbox_event_id;
  if event.status = 'published' or delivery.status <> 'sending' then
    return;
  end if;
  if event.locked_by is distinct from left(btrim(coalesce(p_worker, '')), 200) then
    raise exception 'whatsapp event is not claimed' using errcode = '42501';
  end if;

  if p_outcome = 'sent' then
    update public.whatsapp_deliveries
       set status = 'sent',
           sent_at = clock_timestamp(),
           provider_message_id = left(nullif(btrim(coalesce(p_provider_message_id, '')), ''), 200),
           conversation_id = coalesce(left(nullif(btrim(coalesce(p_conversation_id, '')), ''), 200), conversation_id),
           last_error = null
     where id = delivery.id;
    perform app.mark_outbox_published(event.id, p_worker);
  elsif p_outcome = 'retry' then
    update public.whatsapp_deliveries set last_error = left(coalesce(p_error, 'retry'), 500) where id = delivery.id;
    perform app.mark_outbox_failed(event.id, p_worker, left(coalesce(p_error, 'retry'), 2000));
    if (select status from public.outbox_events where id = event.id) = 'dead_lettered' then
      update public.whatsapp_deliveries set status = 'failed', failed_at = clock_timestamp() where id = delivery.id;
      perform app.record_audit_event(delivery.organization_id, 'whatsapp.failed', 'public.whatsapp_deliveries', delivery.id, 'failure',
        jsonb_build_object('reason', 'retries_exhausted'));
    end if;
  else
    update public.whatsapp_deliveries
       set status = 'failed', failed_at = clock_timestamp(), last_error = left(coalesce(p_error, 'failed'), 500)
     where id = delivery.id;
    perform app.mark_outbox_published(event.id, p_worker);
    perform app.record_audit_event(delivery.organization_id, 'whatsapp.failed', 'public.whatsapp_deliveries', delivery.id, 'failure',
      jsonb_build_object('reason', 'terminal'));
  end if;
end;
$$;
revoke all on function public.finish_whatsapp_delivery(uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.finish_whatsapp_delivery(uuid, text, text, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Inbound (service role, from the verified webhook)
-- ---------------------------------------------------------------------------

-- message.delivered / message.read / message.failed for a message this firm's number sent.
-- Status only moves forward (sent, delivered, read); a failure after delivery is ignored.
create function public.record_whatsapp_status(
  p_account_id text,
  p_provider_message_id text,
  p_status text,
  p_at timestamptz default null,
  p_error text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  delivery public.whatsapp_deliveries%rowtype;
  v_at timestamptz := coalesce(p_at, clock_timestamp());
begin
  if coalesce((select auth.jwt() ->> 'role'), '') is distinct from 'service_role' then
    raise exception 'worker role required' using errcode = '42501';
  end if;
  p_error := nullif(btrim(coalesce(p_error, '')), '');
  if p_status not in ('delivered', 'read', 'failed') then
    raise exception 'status is invalid' using errcode = '22023';
  end if;
  select d.* into delivery
  from public.whatsapp_deliveries d
  join public.firm_whatsapp_accounts account
    on account.organization_id = d.organization_id
   and account.zernio_account_id = p_account_id
  where d.provider_message_id = p_provider_message_id
  order by d.created_at desc
  limit 1
  for update of d;
  if delivery.id is null then
    return false;
  end if;
  if p_status = 'delivered' then
    update public.whatsapp_deliveries
       set delivered_at = coalesce(delivered_at, v_at),
           status = case when status in ('sending', 'sent') then 'delivered'::public.whatsapp_delivery_status else status end
     where id = delivery.id;
  elsif p_status = 'read' then
    update public.whatsapp_deliveries
       set delivered_at = coalesce(delivered_at, v_at),
           read_at = coalesce(read_at, v_at),
           status = case when status in ('sending', 'sent', 'delivered') then 'read'::public.whatsapp_delivery_status else status end
     where id = delivery.id;
  elsif delivery.status in ('sending', 'sent') then
    update public.whatsapp_deliveries
       set status = 'failed', failed_at = v_at, last_error = left(coalesce(p_error, 'failed'), 500)
     where id = delivery.id;
    perform app.record_audit_event(delivery.organization_id, 'whatsapp.failed', 'public.whatsapp_deliveries', delivery.id, 'failure',
      jsonb_build_object('reason', 'provider'));
  end if;
  return true;
end;
$$;
revoke all on function public.record_whatsapp_status(text, text, text, timestamptz, text) from public, anon, authenticated;
grant execute on function public.record_whatsapp_status(text, text, text, timestamptz, text) to service_role;

-- message.received on a firm's number. A sender who is exactly one opted-in person on exactly one
-- open matter (or, with several, the one they were last notified about) is filed into that
-- matter's conversation with only them; anything else waits in whatsapp_inbound_messages.
create function public.receive_whatsapp_message(
  p_account_id text,
  p_event_id text,
  p_platform_message_id text,
  p_conversation_id text,
  p_phone text,
  p_bsuid text,
  p_sender_name text,
  p_text text,
  p_has_attachments boolean,
  p_sent_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid;
  phone text := app.normalize_phone_e164(p_phone);
  v_body text := left(btrim(coalesce(p_text, '')), 4000);
  people uuid[];
  person public.persons%rowtype;
  matters uuid[];
  v_matter uuid;
  key text;
  thread public.message_threads%rowtype;
  mid uuid;
  why text;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') is distinct from 'service_role' then
    raise exception 'worker role required' using errcode = '42501';
  end if;
  -- Empty strings from the webhook mean "not given".
  p_conversation_id := nullif(btrim(coalesce(p_conversation_id, '')), '');
  p_bsuid := nullif(btrim(coalesce(p_bsuid, '')), '');
  if p_event_id is null or length(p_event_id) not between 1 and 200
     or p_platform_message_id is null or length(p_platform_message_id) not between 1 and 200 then
    raise exception 'event is invalid' using errcode = '22023';
  end if;
  select account.organization_id into org
  from public.firm_whatsapp_accounts account
  where account.zernio_account_id = p_account_id and account.status = 'connected';
  if org is null then
    return jsonb_build_object('action', 'ignored');
  end if;
  if exists (
    select 1 from public.whatsapp_inbound_messages inbound
    where inbound.zernio_event_id = p_event_id
       or (inbound.organization_id = org and inbound.platform_message_id = p_platform_message_id)
  ) then
    return jsonb_build_object('action', 'duplicate');
  end if;
  if v_body = '' then
    v_body := case when coalesce(p_has_attachments, false)
      then '[Sent an attachment on WhatsApp. It was not imported; ask them to upload it in the portal.]'
      else '[Empty WhatsApp message]' end;
  end if;

  if phone is not null then
    select array_agg(contact.person_id order by contact.person_id) into people
    from public.person_whatsapp_contacts contact
    where contact.organization_id = org
      and contact.phone_e164 = phone
      and app.whatsapp_opted_in_phone(contact.person_id) is not null;
  end if;

  if coalesce(array_length(people, 1), 0) = 0 then
    why := 'no_match';
  elsif array_length(people, 1) > 1 then
    why := 'several_people';
  else
    select * into person from public.persons where id = people[1];
    select array_agg(distinct matter.id) into matters
    from public.matter_participants party
    join public.matters matter
      on matter.id = party.matter_id
     and matter.organization_id = party.organization_id
    where party.person_id = person.id
      and party.organization_id = org
      and matter.stage <> 'closed'
      and matter.is_sample is false;
    if coalesce(array_length(matters, 1), 0) = 0 then
      why := 'no_open_matter';
    elsif array_length(matters, 1) = 1 then
      v_matter := matters[1];
    else
      select d.matter_id into v_matter
      from public.whatsapp_deliveries d
      where d.organization_id = org
        and d.person_id = person.id
        and d.matter_id = any (matters)
        and d.status <> 'skipped'
      order by d.created_at desc
      limit 1;
      if v_matter is null then
        why := 'several_matters';
      end if;
    end if;
  end if;

  if why is not null then
    insert into public.whatsapp_inbound_messages (
      organization_id, zernio_event_id, platform_message_id, conversation_id, sender_phone_e164,
      sender_bsuid, sender_name, body, has_attachments, person_id, triage_state, reason, sent_at
    ) values (
      org, p_event_id, p_platform_message_id, left(p_conversation_id, 200), phone,
      left(p_bsuid, 200), left(nullif(btrim(coalesce(p_sender_name, '')), ''), 200), v_body,
      coalesce(p_has_attachments, false), case when why = 'no_open_matter' then person.id end, 'open', why, p_sent_at
    );
    perform app.record_audit_event(org, 'whatsapp.received_to_triage', 'public.whatsapp_inbound_messages', null, 'success',
      jsonb_build_object('reason', why));
    return jsonb_build_object('action', 'triage', 'reason', why);
  end if;

  -- The person's own conversation with the firm on that matter (the same audience key a client's
  -- portal message uses), created when it does not exist yet.
  key := person.id::text;
  select * into thread from public.message_threads t where t.matter_id = v_matter and t.audience_key = key;
  if thread.id is null then
    insert into public.message_threads (organization_id, matter_id, audience_key, is_sample, created_by)
    values (org, v_matter, key, false, person.user_id)
    on conflict (matter_id, audience_key) do nothing
    returning * into thread;
    if thread.id is null then
      select * into thread from public.message_threads t where t.matter_id = v_matter and t.audience_key = key;
    else
      insert into public.message_thread_people (thread_id, organization_id, person_id) values (thread.id, org, person.id);
    end if;
  end if;

  insert into public.matter_messages (
    organization_id, thread_id, matter_id, author_user_id, author_kind, author_person_id,
    author_membership_id, author_name, body, requires_ack, client_key, channel
  ) values (
    org, thread.id, v_matter, person.user_id, 'client', person.id,
    null, left(person.display_name, 200), v_body, false, null, 'whatsapp'
  )
  returning id into mid;
  update public.message_threads set last_message_at = clock_timestamp() where id = thread.id;

  insert into public.whatsapp_inbound_messages (
    organization_id, zernio_event_id, platform_message_id, conversation_id, sender_phone_e164,
    sender_bsuid, sender_name, body, has_attachments, person_id, matter_id, matter_message_id, triage_state, sent_at
  ) values (
    org, p_event_id, p_platform_message_id, left(p_conversation_id, 200), phone,
    left(p_bsuid, 200), left(nullif(btrim(coalesce(p_sender_name, '')), ''), 200), null,
    coalesce(p_has_attachments, false), person.id, v_matter, mid, 'filed', p_sent_at
  );
  perform app.record_audit_event(org, 'message.received_whatsapp', 'public.matter_messages', mid, 'success',
    jsonb_build_object('thread_id', thread.id));
  return jsonb_build_object('action', 'filed', 'message_id', mid, 'matter_id', v_matter, 'thread_id', thread.id);
end;
$$;
revoke all on function public.receive_whatsapp_message(text, text, text, text, text, text, text, text, boolean, timestamptz) from public, anon, authenticated;
grant execute on function public.receive_whatsapp_message(text, text, text, text, text, text, text, text, boolean, timestamptz) to service_role;
