-- Client, family, sponsor, employer, and guardian invitations (T021, PRD §5 and §9).
-- Staff invitations stay on public.invitations and still accept staff roles only.
-- The raw token is returned once to the inviter. Only sha256(token) is stored.
-- The outbox email has no token; the mailer is T010.
-- A minor cannot hold a portal login. Guardian authority is an access grant for
-- named minors and stops working when app.person_is_minor becomes false.
-- Real (not sample) invites call the T018 lock: verified firm, good-standing
-- licence, subscription not trial_ended, and the six sample proofs.
-- Additive only.

grant usage on schema app to anon;

create type public.person_section_key as enum (
  'passport_bio',
  'school_transcript',
  'police_certificate',
  'shared_family_record',
  'private_record'
);
comment on type public.person_section_key is
  'Product section labels for who-sees-what. Not an immigration evidence checklist.';

create type public.consent_purpose as enum (
  'portal_terms',
  'privacy_notice',
  'processing',
  'contact_email',
  'contact_sms',
  'deadline_reminder',
  'share_section',
  'ai_drafting',
  'participation_declined'
);

alter table public.persons
  add column contact_phone text;
alter table public.persons
  add constraint persons_contact_phone_ck check (
    contact_phone is null or contact_phone ~ '^\+[1-9][0-9]{7,14}$'
  );
comment on column public.persons.contact_phone is
  'Optional E.164 number for text reminders. Not an immigration fact. Shown on that person''s own invitation.';

-- ---------------------------------------------------------------------------
-- Portal invitations. Separate from staff invitations.
-- ---------------------------------------------------------------------------
create table public.portal_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  matter_id uuid not null,
  person_id uuid not null,
  role public.org_role not null check (
    role in ('client', 'adult_dependant', 'sponsor', 'employer_contact', 'guardian')
  ),
  email text not null check (
    email = lower(email)
    and length(email) between 3 and 320
    and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
  ),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  guardian_subject_ids uuid[] not null default '{}',
  expires_at timestamptz not null,
  opened_at timestamptz,
  consumed_at timestamptz,
  consumed_by uuid references auth.users (id),
  revoked_at timestamptz,
  declined_at timestamptz,
  membership_id uuid,
  draft jsonb not null default '{}'::jsonb check (
    jsonb_typeof(draft) = 'object' and pg_column_size(draft) <= 4000
  ),
  email_enqueued_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id),
  check (expires_at > created_at),
  check (consumed_at is null or consumed_by is not null),
  check (num_nonnulls(consumed_at, revoked_at, declined_at) <= 1),
  check (
    (role = 'guardian' and cardinality(guardian_subject_ids) >= 1)
    or (role <> 'guardian' and cardinality(guardian_subject_ids) = 0)
  ),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id),
  foreign key (person_id, organization_id) references public.persons (id, organization_id),
  foreign key (membership_id, organization_id) references public.memberships (id, organization_id)
);
comment on table public.portal_invitations is
  'Expiring single-use portal invite. Stores sha256(token) only. Bound to one person, one matter, and one portal role.';
comment on column public.portal_invitations.token_hash is
  'Hex sha256 of the raw token. The raw token is never stored.';
comment on column public.portal_invitations.draft is
  'Unconfirmed wizard answers. Not consent. Consent is written only on accept or decline.';

create index portal_invitations_org_email_idx on public.portal_invitations (organization_id, email);
create index portal_invitations_matter_org_fk_idx on public.portal_invitations (matter_id, organization_id);
create index portal_invitations_person_org_fk_idx on public.portal_invitations (person_id, organization_id);
create index portal_invitations_membership_org_fk_idx on public.portal_invitations (membership_id, organization_id);
create index portal_invitations_consumed_by_fk_idx on public.portal_invitations (consumed_by);
create index portal_invitations_created_by_fk_idx on public.portal_invitations (created_by);

create table public.portal_policy_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  kind text not null check (kind in ('portal_terms', 'privacy_notice')),
  version_label text not null check (version_label ~ '^[A-Za-z0-9._-]{1,40}$'),
  title text not null check (length(btrim(title)) between 1 and 200),
  body text not null check (length(body) between 1 and 8000),
  body_sha256 text not null check (body_sha256 ~ '^[0-9a-f]{64}$'),
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (organization_id, kind, version_label)
);
comment on table public.portal_policy_documents is
  'Firm portal terms and privacy notice. Published text is immutable. A new version is a new row.';

create index portal_policy_documents_org_idx
  on public.portal_policy_documents (organization_id, kind, published_at desc);
create index portal_policy_documents_created_by_fk_idx on public.portal_policy_documents (created_by);

create table public.consent_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  person_id uuid not null,
  matter_id uuid,
  invitation_id uuid,
  purpose public.consent_purpose not null,
  policy_document_id uuid references public.portal_policy_documents (id),
  policy_version text,
  scope text check (scope is null or length(scope) <= 80),
  statement_text text not null check (length(statement_text) between 1 and 500),
  statement_sha256 text not null check (statement_sha256 ~ '^[0-9a-f]{64}$'),
  granted boolean not null,
  withdrawn_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id),
  foreign key (person_id, organization_id) references public.persons (id, organization_id),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id),
  foreign key (invitation_id, organization_id) references public.portal_invitations (id, organization_id)
);
comment on table public.consent_records is
  'Append-only consent evidence. Withdrawal sets withdrawn_at and does not rewrite the statement.';

create index consent_records_person_org_fk_idx on public.consent_records (person_id, organization_id);
create index consent_records_matter_org_fk_idx on public.consent_records (matter_id, organization_id);
create index consent_records_invitation_org_fk_idx on public.consent_records (invitation_id, organization_id);
create index consent_records_policy_fk_idx on public.consent_records (policy_document_id);
create index consent_records_created_by_fk_idx on public.consent_records (created_by);

create table public.person_section_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  person_id uuid not null,
  matter_id uuid not null,
  section_key public.person_section_key not null,
  restricted boolean not null,
  summary text not null check (length(btrim(summary)) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (matter_id, person_id, section_key),
  unique (id, organization_id),
  check (
    (section_key = 'shared_family_record' and restricted is false)
    or (section_key <> 'shared_family_record' and restricted is true)
  ),
  foreign key (person_id, organization_id) references public.persons (id, organization_id),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id)
);
comment on table public.person_section_records is
  'Matter-scoped section. Restricted sections stay private unless that person shares them. A shared family record is visible to other people on the matter. Household membership and invoice payment are not a grant.';

create index person_section_records_person_org_fk_idx
  on public.person_section_records (person_id, organization_id);
create index person_section_records_matter_org_fk_idx
  on public.person_section_records (matter_id, organization_id);
create index person_section_records_created_by_fk_idx on public.person_section_records (created_by);

create table public.section_shares (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  subject_person_id uuid not null,
  grantee_person_id uuid not null,
  matter_id uuid not null,
  section_key public.person_section_key not null check (section_key <> 'shared_family_record'),
  consent_record_id uuid not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id),
  check (subject_person_id <> grantee_person_id),
  foreign key (subject_person_id, organization_id) references public.persons (id, organization_id),
  foreign key (grantee_person_id, organization_id) references public.persons (id, organization_id),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id),
  foreign key (consent_record_id, organization_id) references public.consent_records (id, organization_id)
);
comment on table public.section_shares is
  'One restricted section shared with one person on one matter. Revocable by the subject. Not implied by a sponsor, payer, or household link.';

create unique index section_shares_open_uidx
  on public.section_shares (matter_id, subject_person_id, grantee_person_id, section_key)
  where revoked_at is null;
create index section_shares_subject_org_fk_idx on public.section_shares (subject_person_id, organization_id);
create index section_shares_grantee_org_fk_idx on public.section_shares (grantee_person_id, organization_id);
create index section_shares_matter_org_fk_idx on public.section_shares (matter_id, organization_id);
create index section_shares_consent_org_fk_idx on public.section_shares (consent_record_id, organization_id);
create index section_shares_created_by_fk_idx on public.section_shares (created_by);

create table public.person_contact_preferences (
  person_id uuid primary key,
  organization_id uuid not null,
  email_notices boolean not null default false,
  sms_notices boolean not null default false,
  deadline_reminders boolean not null default false,
  locale text not null default 'en-CA' check (locale in ('en-CA', 'fr-CA')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (person_id, organization_id),
  foreign key (person_id, organization_id) references public.persons (id, organization_id)
);
comment on table public.person_contact_preferences is
  'Contact choices. deadline_reminders opts into the firm reminder rule. It does not store a day offset.';

create index person_contact_preferences_org_fk_idx
  on public.person_contact_preferences (organization_id);
create index person_contact_preferences_created_by_fk_idx
  on public.person_contact_preferences (created_by);

create table public.portal_invite_attempts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id),
  actor_user_id uuid references auth.users (id),
  token_hash text check (token_hash is null or token_hash ~ '^[0-9a-f]{64}$'),
  action text not null check (action in ('present', 'create', 'resend')),
  created_at timestamptz not null default now()
);
comment on table public.portal_invite_attempts is
  'Rate-limit counter. Stores the token hash, never the raw token. No API read.';

create index portal_invite_attempts_token_idx
  on public.portal_invite_attempts (token_hash, created_at);
create index portal_invite_attempts_actor_fk_idx
  on public.portal_invite_attempts (actor_user_id, created_at);
create index portal_invite_attempts_org_fk_idx
  on public.portal_invite_attempts (organization_id, created_at);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
create function app.guard_portal_invitation_keys()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.organization_id is distinct from old.organization_id
     or new.matter_id is distinct from old.matter_id
     or new.person_id is distinct from old.person_id
     or new.role is distinct from old.role
     or new.email is distinct from old.email
     or new.token_hash is distinct from old.token_hash
     or new.guardian_subject_ids is distinct from old.guardian_subject_ids
     or new.created_by is distinct from old.created_by then
    raise exception 'portal invitation identity columns are immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.guard_portal_invitation_keys() from public;

create trigger portal_invitations_touch before update on public.portal_invitations
  for each row execute function app.touch_row();
create trigger portal_invitations_immutable before update on public.portal_invitations
  for each row execute function app.guard_portal_invitation_keys();
create trigger portal_invitations_stamp before insert on public.portal_invitations
  for each row execute function app.stamp_created_by();
create trigger portal_invitations_audit after insert or update or delete on public.portal_invitations
  for each row execute function app.audit_row_change('token_hash');
create trigger portal_invitations_no_delete before delete on public.portal_invitations
  for each row execute function app.reject_governed_delete();

create function app.reject_portal_policy_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'portal policy text is immutable' using errcode = '42501';
end;
$$;
revoke all on function app.reject_portal_policy_update() from public;

create trigger portal_policy_documents_stamp before insert on public.portal_policy_documents
  for each row execute function app.stamp_created_by();
create trigger portal_policy_documents_no_update before update on public.portal_policy_documents
  for each row execute function app.reject_portal_policy_update();
create trigger portal_policy_documents_audit after insert or delete on public.portal_policy_documents
  for each row execute function app.audit_row_change('body');
create trigger portal_policy_documents_no_delete before delete on public.portal_policy_documents
  for each row execute function app.reject_governed_delete();

create function app.guard_consent_record()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.organization_id is distinct from old.organization_id
     or new.person_id is distinct from old.person_id
     or new.matter_id is distinct from old.matter_id
     or new.invitation_id is distinct from old.invitation_id
     or new.purpose is distinct from old.purpose
     or new.policy_document_id is distinct from old.policy_document_id
     or new.policy_version is distinct from old.policy_version
     or new.scope is distinct from old.scope
     or new.statement_text is distinct from old.statement_text
     or new.statement_sha256 is distinct from old.statement_sha256
     or new.granted is distinct from old.granted
     or new.created_by is distinct from old.created_by then
    raise exception 'consent evidence is immutable' using errcode = '42501';
  end if;
  if old.withdrawn_at is not null and new.withdrawn_at is distinct from old.withdrawn_at then
    raise exception 'consent withdrawal is immutable' using errcode = '42501';
  end if;
  if new.withdrawn_at is not null and old.granted is not true then
    raise exception 'only a granted consent can be withdrawn' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.guard_consent_record() from public;

create trigger consent_records_touch before update on public.consent_records
  for each row execute function app.touch_row();
create trigger consent_records_immutable before update on public.consent_records
  for each row execute function app.guard_consent_record();
create trigger consent_records_stamp before insert on public.consent_records
  for each row execute function app.stamp_created_by();
create trigger consent_records_audit after insert or update or delete on public.consent_records
  for each row execute function app.audit_row_change('statement_text');
create trigger consent_records_no_delete before delete on public.consent_records
  for each row execute function app.reject_governed_delete();

create trigger person_section_records_touch before update on public.person_section_records
  for each row execute function app.touch_row();
create trigger person_section_records_immutable before update on public.person_section_records
  for each row execute function app.guard_tenant_keys();
create trigger person_section_records_stamp before insert on public.person_section_records
  for each row execute function app.stamp_created_by();
create trigger person_section_records_audit after insert or update or delete on public.person_section_records
  for each row execute function app.audit_row_change('summary');
create trigger person_section_records_no_delete before delete on public.person_section_records
  for each row execute function app.reject_governed_delete();

create trigger section_shares_touch before update on public.section_shares
  for each row execute function app.touch_row();
create trigger section_shares_immutable before update on public.section_shares
  for each row execute function app.guard_tenant_keys();
create trigger section_shares_stamp before insert on public.section_shares
  for each row execute function app.stamp_created_by();
create trigger section_shares_audit after insert or update or delete on public.section_shares
  for each row execute function app.audit_row_change();
create trigger section_shares_no_delete before delete on public.section_shares
  for each row execute function app.reject_governed_delete();

create trigger person_contact_preferences_touch before update on public.person_contact_preferences
  for each row execute function app.touch_row();
create trigger person_contact_preferences_stamp before insert on public.person_contact_preferences
  for each row execute function app.stamp_created_by();
create trigger person_contact_preferences_audit after insert or update or delete on public.person_contact_preferences
  for each row execute function app.audit_row_change();

create trigger portal_invite_attempts_no_delete before delete on public.portal_invite_attempts
  for each row execute function app.reject_governed_delete();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create function app.record_portal_audit(
  p_organization_id uuid,
  p_action text,
  p_object_table text,
  p_object_id uuid,
  p_result text,
  p_context jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  rid uuid;
begin
  insert into public.audit_log (
    organization_id, actor_user_id, actor_type, action, object_table, object_id, result, request_id, context
  ) values (
    p_organization_id,
    (select auth.uid()),
    app.current_actor_type(),
    p_action,
    p_object_table,
    p_object_id,
    coalesce(p_result, 'success'),
    app.current_request_id(),
    coalesce(p_context, '{}'::jsonb)
  )
  returning id into rid;
  return rid;
end;
$$;
comment on function app.record_portal_audit(uuid, text, text, uuid, text, jsonb) is
  'Audit for portal invites. The invitee is not a member yet, so this does not use the member check in app.record_audit_event.';
revoke all on function app.record_portal_audit(uuid, text, text, uuid, text, jsonb) from public;

create function app.enqueue_portal_notice(
  p_organization_id uuid,
  p_aggregate_id uuid,
  p_event_type text,
  p_payload jsonb,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  eid uuid;
begin
  insert into public.outbox_events (
    organization_id, aggregate_type, aggregate_id, aggregate_version, event_type,
    payload, idempotency_key, available_at, created_by, request_id
  ) values (
    p_organization_id,
    'portal_invitation',
    p_aggregate_id,
    1,
    p_event_type,
    coalesce(p_payload, '{}'::jsonb),
    p_idempotency_key,
    clock_timestamp(),
    (select auth.uid()),
    app.current_request_id()
  )
  on conflict (organization_id, idempotency_key) do nothing
  returning id into eid;

  if eid is null then
    select event.id into eid
    from public.outbox_events event
    where event.organization_id = p_organization_id
      and event.idempotency_key = p_idempotency_key
      and event.event_type = p_event_type
      and event.aggregate_id = p_aggregate_id;
    if eid is null then
      raise exception 'idempotency key reused with a different event' using errcode = '23505';
    end if;
  end if;
  return eid;
end;
$$;
comment on function app.enqueue_portal_notice(uuid, uuid, text, jsonb, text) is
  'Outbox row for a portal invite email. Payload must not contain the raw token.';
revoke all on function app.enqueue_portal_notice(uuid, uuid, text, jsonb, text) from public;

create function app.portal_role_party(p_role public.org_role)
returns public.matter_party_role
language sql
immutable
set search_path = ''
as $$
  select case p_role
    when 'client' then 'applicant'::public.matter_party_role
    when 'adult_dependant' then 'dependant'::public.matter_party_role
    when 'sponsor' then 'sponsor'::public.matter_party_role
    when 'employer_contact' then 'employer'::public.matter_party_role
    when 'guardian' then 'guardian'::public.matter_party_role
    else null
  end;
$$;
revoke all on function app.portal_role_party(public.org_role) from public;

create function app.person_section_label(p_key public.person_section_key)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_key
    when 'passport_bio' then 'Passport bio page'
    when 'school_transcript' then 'School transcript'
    when 'police_certificate' then 'Police certificate'
    when 'shared_family_record' then 'Shared family record'
    when 'private_record' then 'Private record'
  end;
$$;
revoke all on function app.person_section_label(public.person_section_key) from public;

create function app.portal_token_hash(p_token text)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when p_token ~ '^[0-9a-f]{64}$' then app.hash_invitation_token(p_token)
    else null
  end;
$$;
revoke all on function app.portal_token_hash(text) from public;

create function app.portal_statement_hash(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(extensions.digest(convert_to(p_text, 'utf8'), 'sha256'), 'hex');
$$;
revoke all on function app.portal_statement_hash(text) from public;

create function app.actor_can_invite_portal(p_org uuid, p_matter uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.in_active_org(p_org)
     and app.staff_mfa_satisfied()
     and app.mfa_step_up_satisfied()
     and (
       app.has_org_role(p_org, array['firm_owner']::public.org_role[])
       or (
         app.has_org_role(p_org, array['licensed_consultant', 'case_manager']::public.org_role[])
         and (
           app.actor_staff_assigned_to_matter(p_matter, p_org)
           or exists (
             select 1
             from public.matters matter
             where matter.id = p_matter
               and matter.organization_id = p_org
               and matter.created_by = (select auth.uid())
           )
         )
       )
     );
$$;
revoke all on function app.actor_can_invite_portal(uuid, uuid) from public;

-- 40 presentations of one token per hour. 30 per signed-in actor per 15 minutes.
-- 30 creates or resends per firm per hour, 10 per actor per hour.
-- These are abuse limits, not immigration rules.
create function app.portal_invite_limited(
  p_action text,
  p_token_hash text,
  p_organization_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  present_count integer;
  actor_count integer;
  org_count integer;
  actor uuid := (select auth.uid());
begin
  insert into public.portal_invite_attempts (organization_id, actor_user_id, token_hash, action)
  values (p_organization_id, actor, p_token_hash, p_action);

  if p_action = 'present' then
    select count(*) into present_count
    from public.portal_invite_attempts attempt
    where attempt.token_hash = p_token_hash
      and attempt.action = 'present'
      and attempt.created_at > statement_timestamp() - interval '1 hour';
    if present_count > 40 then
      return true;
    end if;
    if actor is not null then
      select count(*) into actor_count
      from public.portal_invite_attempts attempt
      where attempt.actor_user_id = actor
        and attempt.action = 'present'
        and attempt.created_at > statement_timestamp() - interval '15 minutes';
      if actor_count > 30 then
        return true;
      end if;
    end if;
    return false;
  end if;

  select count(*) into org_count
  from public.portal_invite_attempts attempt
  where attempt.organization_id = p_organization_id
    and attempt.action in ('create', 'resend')
    and attempt.created_at > statement_timestamp() - interval '1 hour';
  if org_count > 30 then
    return true;
  end if;
  if actor is not null then
    select count(*) into actor_count
    from public.portal_invite_attempts attempt
    where attempt.actor_user_id = actor
      and attempt.action in ('create', 'resend')
      and attempt.created_at > statement_timestamp() - interval '1 hour';
    if actor_count > 10 then
      return true;
    end if;
  end if;
  return false;
end;
$$;
revoke all on function app.portal_invite_limited(text, text, uuid) from public;

create function app.portal_invitation_status(p_inv public.portal_invitations)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when p_inv.consumed_at is not null then 'consumed'
    when p_inv.revoked_at is not null then 'revoked'
    when p_inv.declined_at is not null then 'declined'
    when p_inv.expires_at <= statement_timestamp() then 'expired'
    else 'open'
  end;
$$;
revoke all on function app.portal_invitation_status(public.portal_invitations) from public;

create function app.current_portal_policy(p_org uuid, p_kind text)
returns public.portal_policy_documents
language sql
stable
security definer
set search_path = ''
as $$
  select doc.*
  from public.portal_policy_documents doc
  where doc.organization_id = p_org
    and doc.kind = p_kind
  order by doc.published_at desc, doc.id desc
  limit 1;
$$;
revoke all on function app.current_portal_policy(uuid, text) from public;

create function app.portal_policy_json(p_org uuid, p_kind text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when (current_doc.doc).id is null then 'null'::jsonb
    else jsonb_build_object(
      'id', (current_doc.doc).id,
      'version_label', (current_doc.doc).version_label,
      'title', (current_doc.doc).title,
      'body', (current_doc.doc).body
    )
  end
  from (select app.current_portal_policy(p_org, p_kind) as doc) current_doc;
$$;
revoke all on function app.portal_policy_json(uuid, text) from public;

-- Restricted sections: the subject, assigned staff, an open break-glass read,
-- a live guardian grant while the subject is a minor, or a section share.
-- An explicit person grant does not open a restricted section.
-- Unrestricted sections are visible to other people on that matter.
-- A household, payer, or sponsor link is not consulted.
create function app.can_read_person_section(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.person_section_records rec
    join public.persons subject
      on subject.id = rec.person_id
     and subject.organization_id = rec.organization_id
    where rec.id = p_id
      and app.in_active_org(rec.organization_id)
      and (
        subject.user_id = (select auth.uid())
        or app.actor_staff_assigned_to_matter(rec.matter_id, rec.organization_id)
        or (
          rec.created_by = (select auth.uid())
          and app.staff_mfa_satisfied()
          and app.has_org_role(
            rec.organization_id,
            array['licensed_consultant', 'case_manager']::public.org_role[]
          )
        )
        or (
          app.staff_mfa_satisfied()
          and app.break_glass_person_open(subject.id)
        )
        or exists (
          select 1
          from public.access_grants grant_row
          join public.persons grantee
            on grantee.id = grant_row.grantee_person_id
           and grantee.organization_id = grant_row.organization_id
          where grant_row.organization_id = rec.organization_id
            and grant_row.subject_person_id = subject.id
            and grant_row.kind = 'guardian'
            and grant_row.revoked_at is null
            and (grant_row.expires_at is null or grant_row.expires_at > statement_timestamp())
            and (grant_row.matter_id is null or grant_row.matter_id = rec.matter_id)
            and grantee.user_id = (select auth.uid())
            and app.person_is_minor(subject.id)
        )
        or exists (
          select 1
          from public.section_shares share
          join public.persons grantee
            on grantee.id = share.grantee_person_id
           and grantee.organization_id = share.organization_id
          where share.organization_id = rec.organization_id
            and share.subject_person_id = rec.person_id
            and share.matter_id = rec.matter_id
            and share.section_key = rec.section_key
            and share.revoked_at is null
            and grantee.user_id = (select auth.uid())
        )
        or (
          rec.restricted is false
          and exists (
            select 1
            from public.matter_participants party
            join public.persons viewer
              on viewer.id = party.person_id
             and viewer.organization_id = party.organization_id
            where party.matter_id = rec.matter_id
              and party.organization_id = rec.organization_id
              and viewer.user_id = (select auth.uid())
          )
        )
      )
  );
$$;
revoke all on function app.can_read_person_section(uuid) from public;
grant execute on function app.can_read_person_section(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Issue (create or resend)
-- ---------------------------------------------------------------------------
create function app.issue_portal_invitation(
  p_person_id uuid,
  p_matter_id uuid,
  p_role public.org_role,
  p_email text,
  p_guardian_subject_ids uuid[],
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  org uuid;
  person public.persons;
  matter public.matters;
  normalized text;
  subjects uuid[] := coalesce(p_guardian_subject_ids, '{}'::uuid[]);
  subject uuid;
  blockers text[];
  token text;
  inv public.portal_invitations;
  recent_count integer;
begin
  if actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  select found.organization_id into org
  from public.matters found
  where found.id = p_matter_id;
  if org is null then
    raise exception 'portal invitation denied' using errcode = '42501';
  end if;
  if app.actor_can_invite_portal(org, p_matter_id) is distinct from true then
    raise exception 'portal invitations require a recent step-up' using errcode = '42501';
  end if;
  if p_action not in ('create', 'resend') then
    raise exception 'portal invitation denied' using errcode = '42501';
  end if;

  if app.portal_invite_limited(p_action, null, org) then
    perform app.record_portal_audit(
      org, 'portal_invitation.rate_limited', 'public.organizations', org, 'denied',
      jsonb_build_object('action', p_action)
    );
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;

  if app.portal_role_party(p_role) is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_role');
  end if;
  normalized := app.normalize_email(p_email);
  if normalized is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_email');
  end if;

  select * into person
  from public.persons
  where id = p_person_id and organization_id = org;
  select * into matter
  from public.matters
  where id = p_matter_id and organization_id = org;
  if person.id is null or matter.id is null then
    raise exception 'portal invitation denied' using errcode = '42501';
  end if;
  if person.is_sample is distinct from matter.is_sample then
    return jsonb_build_object('ok', false, 'error', 'sample_mismatch');
  end if;
  if person.email is not null and person.email is distinct from normalized then
    return jsonb_build_object('ok', false, 'error', 'email_does_not_match_person');
  end if;
  if not exists (
    select 1
    from public.matter_participants party
    where party.organization_id = org
      and party.matter_id = matter.id
      and party.person_id = person.id
      and party.role = app.portal_role_party(p_role)
  ) then
    return jsonb_build_object('ok', false, 'error', 'not_a_participant');
  end if;

  if person.date_of_birth is null or app.person_is_minor(person.id) then
    perform app.record_portal_audit(
      org, 'portal_invitation.minor_refused', 'public.persons', person.id, 'denied',
      jsonb_build_object(
        'reason', case when person.date_of_birth is null then 'date_of_birth_required' else 'is_minor' end,
        'role', p_role
      )
    );
    return jsonb_build_object(
      'ok', false,
      'error', case when person.date_of_birth is null then 'date_of_birth_required' else 'minor_cannot_hold_login' end
    );
  end if;

  if p_role = 'guardian' then
    if cardinality(subjects) < 1 or cardinality(subjects) > 10 then
      return jsonb_build_object('ok', false, 'error', 'guardian_subject_required');
    end if;
    foreach subject in array subjects loop
      if subject = person.id or not exists (
        select 1
        from public.matter_participants party
        join public.persons child
          on child.id = party.person_id
         and child.organization_id = party.organization_id
        where party.organization_id = org
          and party.matter_id = matter.id
          and party.person_id = subject
          and party.role in ('dependant', 'applicant')
          and app.person_is_minor(child.id)
      ) then
        return jsonb_build_object('ok', false, 'error', 'guardian_subject_not_minor');
      end if;
    end loop;
  elsif cardinality(subjects) > 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_role');
  end if;

  if person.is_sample is not true then
    blockers := app.real_client_invite_blockers(org);
    if cardinality(blockers) > 0 then
      perform app.record_portal_audit(
        org,
        'invitation.real_client_blocked',
        'public.organizations',
        org,
        'denied',
        jsonb_build_object('blockers', to_jsonb(blockers), 'role', p_role)
      );
      return jsonb_build_object(
        'ok', false,
        'error', 'real_client_invitations_locked',
        'blockers', to_jsonb(blockers)
      );
    end if;
  end if;

  select count(*) into recent_count
  from public.portal_invitations prior
  where prior.organization_id = org
    and prior.person_id = person.id
    and prior.matter_id = matter.id
    and prior.role = p_role
    and prior.created_at > statement_timestamp() - interval '24 hours';
  if recent_count >= 5 then
    perform app.record_portal_audit(
      org, 'portal_invitation.rate_limited', 'public.persons', person.id, 'denied',
      jsonb_build_object('action', p_action, 'window', '24 hours')
    );
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;

  update public.portal_invitations prior
     set revoked_at = statement_timestamp()
   where prior.organization_id = org
     and prior.person_id = person.id
     and prior.matter_id = matter.id
     and prior.role = p_role
     and prior.consumed_at is null
     and prior.revoked_at is null
     and prior.declined_at is null;

  token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.portal_invitations (
    organization_id, matter_id, person_id, role, email, token_hash,
    guardian_subject_ids, expires_at, created_by
  ) values (
    org,
    matter.id,
    person.id,
    p_role,
    normalized,
    app.hash_invitation_token(token),
    case when p_role = 'guardian' then subjects else '{}'::uuid[] end,
    statement_timestamp() + interval '7 days',
    actor
  )
  returning * into inv;

  perform app.enqueue_portal_notice(
    org,
    inv.id,
    'portal_invitation.email_requested',
    jsonb_build_object(
      'invitation_id', inv.id,
      'role', inv.role,
      'recipient_email', inv.email,
      'matter_id', inv.matter_id,
      'expires_at', inv.expires_at
    ),
    'portal-invite-email:' || inv.id::text
  );
  update public.portal_invitations
     set email_enqueued_at = statement_timestamp()
   where id = inv.id;

  perform app.record_portal_audit(
    org,
    case when p_action = 'resend' then 'portal_invitation.resent' else 'portal_invitation.created' end,
    'public.portal_invitations',
    inv.id,
    'success',
    jsonb_build_object('role', inv.role, 'sample', person.is_sample)
  );

  return jsonb_build_object(
    'ok', true,
    'token', token,
    'invitation_id', inv.id,
    'expires_at', inv.expires_at,
    'role', inv.role
  );
end;
$$;
revoke all on function app.issue_portal_invitation(uuid, uuid, public.org_role, text, uuid[], text) from public;

create function public.create_portal_invitation(
  p_person_id uuid,
  p_matter_id uuid,
  p_role public.org_role,
  p_email text,
  p_guardian_subject_ids uuid[] default '{}'::uuid[]
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app.issue_portal_invitation(
    p_person_id, p_matter_id, p_role, p_email, p_guardian_subject_ids, 'create'
  );
$$;
revoke all on function public.create_portal_invitation(uuid, uuid, public.org_role, text, uuid[]) from public, anon;
grant execute on function public.create_portal_invitation(uuid, uuid, public.org_role, text, uuid[]) to authenticated;

create function public.resend_portal_invitation(p_invitation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv public.portal_invitations;
begin
  select * into inv from public.portal_invitations where id = p_invitation_id;
  if inv.id is null then
    raise exception 'portal invitation denied' using errcode = '42501';
  end if;
  if inv.consumed_at is not null then
    return jsonb_build_object('ok', false, 'error', 'invitation_cannot_be_accepted');
  end if;
  return app.issue_portal_invitation(
    inv.person_id,
    inv.matter_id,
    inv.role,
    inv.email,
    inv.guardian_subject_ids,
    'resend'
  );
end;
$$;
revoke all on function public.resend_portal_invitation(uuid) from public, anon;
grant execute on function public.resend_portal_invitation(uuid) to authenticated;

create function public.revoke_portal_invitation(p_invitation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv public.portal_invitations;
begin
  select * into inv from public.portal_invitations where id = p_invitation_id for update;
  if inv.id is null or app.actor_can_invite_portal(inv.organization_id, inv.matter_id) is distinct from true then
    raise exception 'portal invitations require a recent step-up' using errcode = '42501';
  end if;
  if inv.consumed_at is not null or inv.revoked_at is not null or inv.declined_at is not null then
    return jsonb_build_object('ok', false, 'error', 'invitation_cannot_be_accepted');
  end if;
  update public.portal_invitations
     set revoked_at = statement_timestamp()
   where id = inv.id
     and consumed_at is null
     and revoked_at is null
     and declined_at is null;
  perform app.record_portal_audit(
    inv.organization_id,
    'portal_invitation.revoked',
    'public.portal_invitations',
    inv.id,
    'success',
    jsonb_build_object('role', inv.role)
  );
  return jsonb_build_object('ok', true, 'invitation_id', inv.id);
end;
$$;
revoke all on function public.revoke_portal_invitation(uuid) from public, anon;
grant execute on function public.revoke_portal_invitation(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Token presentation: preview, draft, mismatch, decline.
-- The token is the capability. anon may call these. They do not consume it,
-- except mismatch closes it and decline records a refusal.
-- ---------------------------------------------------------------------------
create function app.load_portal_invitation(p_token text)
returns public.portal_invitations
language plpgsql
security definer
set search_path = ''
as $$
declare
  hashed text := app.portal_token_hash(p_token);
  inv public.portal_invitations;
begin
  if hashed is null then
    return null;
  end if;
  select * into inv
  from public.portal_invitations
  where token_hash = hashed
  for update;
  return inv;
end;
$$;
revoke all on function app.load_portal_invitation(text) from public;

create function app.present_portal_invitation(p_token text)
returns public.portal_invitations
language plpgsql
security definer
set search_path = ''
as $$
declare
  hashed text := app.portal_token_hash(p_token);
  inv public.portal_invitations;
begin
  perform set_config('app.portal_rate_limited', '', true);
  if hashed is null then
    return null;
  end if;
  select * into inv from public.portal_invitations where token_hash = hashed;
  if app.portal_invite_limited('present', hashed, inv.organization_id) then
    perform set_config('app.portal_rate_limited', '1', true);
    return null;
  end if;
  select * into inv
  from public.portal_invitations
  where token_hash = hashed
  for update;
  return inv;
end;
$$;
revoke all on function app.present_portal_invitation(text) from public;

create function public.preview_portal_invitation(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv public.portal_invitations;
  status text;
  person public.persons;
  matter public.matters;
  firm public.organizations;
  inviter_name text;
  licence public.licence_type;
  applicant_name text;
  sponsor_name text;
  visibility jsonb := '[]'::jsonb;
  sections jsonb := '[]'::jsonb;
  subjects jsonb := '[]'::jsonb;
  summary jsonb;
begin
  inv := app.present_portal_invitation(p_token);
  if current_setting('app.portal_rate_limited', true) = '1' then
    return jsonb_build_object('status', 'rate_limited');
  end if;
  if inv.id is null then
    return jsonb_build_object('status', 'unknown');
  end if;

  status := app.portal_invitation_status(inv);
  select * into person from public.persons where id = inv.person_id;
  select * into matter from public.matters where id = inv.matter_id;
  select * into firm from public.organizations where id = inv.organization_id;

  if status <> 'open' then
    return jsonb_build_object(
      'status', status,
      'role', inv.role,
      'sample', person.is_sample,
      'expires_at', inv.expires_at,
      'invitee', jsonb_build_object('display_name', person.display_name),
      'organization', jsonb_build_object('display_name', firm.display_name)
    );
  end if;

  if inv.opened_at is null then
    update public.portal_invitations
       set opened_at = statement_timestamp()
     where id = inv.id
       and opened_at is null;
    perform app.record_portal_audit(
      inv.organization_id,
      'portal_invitation.opened',
      'public.portal_invitations',
      inv.id,
      'success',
      jsonb_build_object('role', inv.role)
    );
  end if;

  select profile.display_name into inviter_name
  from public.profiles profile
  where profile.id = inv.created_by;
  select credential.licence_type into licence
  from public.consultant_credentials credential
  join public.memberships mem
    on mem.id = credential.membership_id
   and mem.organization_id = credential.organization_id
  where mem.user_id = inv.created_by
    and mem.organization_id = inv.organization_id
    and mem.role = 'licensed_consultant'
    and credential.status = 'verified'
  order by credential.checked_at desc nulls last
  limit 1;

  select child.display_name into applicant_name
  from public.matter_participants party
  join public.persons child
    on child.id = party.person_id
   and child.organization_id = party.organization_id
  where party.matter_id = inv.matter_id
    and party.role = 'applicant'
  order by party.created_at
  limit 1;

  select child.display_name into sponsor_name
  from public.matter_participants party
  join public.persons child
    on child.id = party.person_id
   and child.organization_id = party.organization_id
  where party.matter_id = inv.matter_id
    and party.role = 'sponsor'
    and party.person_id is distinct from inv.person_id
  order by party.created_at
  limit 1;

  visibility := jsonb_build_array(
    jsonb_build_object('who', 'self', 'display_name', person.display_name, 'access', 'full'),
    jsonb_build_object('who', 'assigned_staff', 'display_name', null, 'access', 'full')
  );
  if applicant_name is not null and inv.role <> 'client' then
    visibility := visibility || jsonb_build_array(
      jsonb_build_object('who', 'applicant', 'display_name', applicant_name, 'access', 'shared_only')
    );
  end if;
  if inv.role = 'adult_dependant' and sponsor_name is not null then
    visibility := visibility || jsonb_build_array(
      jsonb_build_object('who', 'sponsor', 'display_name', sponsor_name, 'access', 'shared_only')
    );
  end if;
  if inv.role = 'guardian' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'who', 'minor_subject',
      'display_name', child.display_name,
      'access', 'full'
    )), '[]'::jsonb) into subjects
    from public.persons child
    where child.id = any (inv.guardian_subject_ids)
      and child.organization_id = inv.organization_id;
    visibility := visibility || subjects;
  end if;

  if inv.role = 'adult_dependant' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'key', section_key,
      'label', app.person_section_label(section_key),
      'recorded', exists (
        select 1
        from public.person_section_records rec
        where rec.person_id = inv.person_id
          and rec.matter_id = inv.matter_id
          and rec.section_key = keys.section_key
      )
    ) order by section_key), '[]'::jsonb) into sections
    from unnest(enum_range(null::public.person_section_key)) as keys(section_key)
    where section_key <> 'shared_family_record';
  end if;

  summary := case inv.role
    when 'sponsor' then jsonb_build_object(
      'will_see', jsonb_build_array(
        'Your own questions, documents and tasks',
        'Shared items on this file',
        'Invoices you agree to pay'
      ),
      'will_not_see', jsonb_build_array(
        'Another adult''s private records',
        'A dependant''s records unless they share them'
      )
    )
    when 'employer_contact' then jsonb_build_object(
      'will_see', jsonb_build_array('Your own questions, documents and tasks', 'Shared items on this file'),
      'will_not_see', jsonb_build_array('Another adult''s private records')
    )
    when 'adult_dependant' then jsonb_build_object(
      'will_see', jsonb_build_array('Everything you upload and answer', 'Staff assigned to this file'),
      'will_not_see', jsonb_build_array('Items you have not marked as shared')
    )
    else jsonb_build_object(
      'will_see', jsonb_build_array('Staff assigned to this file', 'People you choose to share with'),
      'will_not_see', jsonb_build_array(
        'Other clients of the firm',
        'Platform staff, unless the firm asks for support and you are told'
      )
    )
  end;

  return jsonb_build_object(
    'status', 'open',
    'role', inv.role,
    'single_use', true,
    'sample', person.is_sample,
    'sample_label', person.sample_label,
    'expires_at', inv.expires_at,
    'invitee', jsonb_build_object('display_name', person.display_name, 'email', inv.email),
    'organization', jsonb_build_object('display_name', firm.display_name, 'branding', firm.branding),
    'matter', jsonb_build_object('title', matter.title),
    'inviter', jsonb_build_object(
      'display_name', coalesce(inviter_name, 'Staff member'),
      'licence_type', licence
    ),
    'applicant', case when applicant_name is null then null else jsonb_build_object('display_name', applicant_name) end,
    'contact_phone', person.contact_phone,
    'policies', jsonb_build_object(
      'portal_terms', app.portal_policy_json(inv.organization_id, 'portal_terms'),
      'privacy_notice', app.portal_policy_json(inv.organization_id, 'privacy_notice')
    ),
    'accept_ready', (app.current_portal_policy(inv.organization_id, 'portal_terms')).id is not null
      and (app.current_portal_policy(inv.organization_id, 'privacy_notice')).id is not null,
    'visibility', visibility,
    'shareable_sections', sections,
    'access_summary', summary,
    'draft', inv.draft
  );
end;
$$;
revoke all on function public.preview_portal_invitation(text) from public;
grant execute on function public.preview_portal_invitation(text) to anon, authenticated;

create function public.save_portal_invitation_draft(p_token text, p_draft jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv public.portal_invitations;
  clean jsonb := '{}'::jsonb;
  key text;
  allowed text[] := array[
    'locale', 'email_notices', 'sms_notices', 'deadline_reminders',
    'processing_consent', 'shares', 'portal_terms_id', 'privacy_notice_id', 'ai_drafting'
  ];
begin
  inv := app.present_portal_invitation(p_token);
  if current_setting('app.portal_rate_limited', true) = '1' then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;
  if inv.id is null or app.portal_invitation_status(inv) <> 'open' then
    return jsonb_build_object('ok', false, 'error', 'invitation_cannot_be_accepted');
  end if;
  if jsonb_typeof(p_draft) is distinct from 'object' or pg_column_size(p_draft) > 4000 then
    return jsonb_build_object('ok', false, 'error', 'invalid_draft');
  end if;
  for key in select jsonb_object_keys(p_draft) loop
    if key = any (allowed) then
      clean := clean || jsonb_build_object(key, p_draft -> key);
    end if;
  end loop;
  update public.portal_invitations set draft = clean where id = inv.id;
  perform app.record_portal_audit(
    inv.organization_id,
    'portal_invitation.draft_saved',
    'public.portal_invitations',
    inv.id,
    'success',
    jsonb_build_object(
      'keys',
      coalesce((select jsonb_agg(draft_key) from jsonb_object_keys(clean) as draft_key), '[]'::jsonb)
    )
  );
  return jsonb_build_object('ok', true, 'draft', clean);
end;
$$;
revoke all on function public.save_portal_invitation_draft(text, jsonb) from public;
grant execute on function public.save_portal_invitation_draft(text, jsonb) to anon, authenticated;

create function public.report_portal_invitation_mismatch(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv public.portal_invitations;
begin
  inv := app.present_portal_invitation(p_token);
  if current_setting('app.portal_rate_limited', true) = '1' then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;
  if inv.id is null then
    return jsonb_build_object('ok', false, 'error', 'unknown');
  end if;
  if app.portal_invitation_status(inv) <> 'open' then
    return jsonb_build_object('ok', true, 'status', 'closed');
  end if;
  update public.portal_invitations
     set revoked_at = statement_timestamp()
   where id = inv.id
     and consumed_at is null
     and revoked_at is null
     and declined_at is null;
  perform app.record_portal_audit(
    inv.organization_id,
    'portal_invitation.reported_mismatch',
    'public.portal_invitations',
    inv.id,
    'success',
    jsonb_build_object('role', inv.role)
  );
  perform app.enqueue_portal_notice(
    inv.organization_id,
    inv.id,
    'portal_invitation.mismatch_reported',
    jsonb_build_object('invitation_id', inv.id, 'role', inv.role, 'recipient_email', inv.email),
    'portal-invite-mismatch:' || inv.id::text
  );
  return jsonb_build_object('ok', true, 'status', 'closed');
end;
$$;
revoke all on function public.report_portal_invitation_mismatch(text) from public;
grant execute on function public.report_portal_invitation_mismatch(text) to anon, authenticated;

create function public.decline_portal_invitation(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv public.portal_invitations;
  statement_text text := 'I do not want to take part.';
begin
  inv := app.present_portal_invitation(p_token);
  if current_setting('app.portal_rate_limited', true) = '1' then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;
  if inv.id is null or app.portal_invitation_status(inv) <> 'open' then
    return jsonb_build_object('ok', false, 'error', 'invitation_cannot_be_accepted');
  end if;
  update public.portal_invitations
     set declined_at = statement_timestamp()
   where id = inv.id
     and consumed_at is null
     and revoked_at is null
     and declined_at is null;
  insert into public.consent_records (
    organization_id, person_id, matter_id, invitation_id, purpose,
    statement_text, statement_sha256, granted
  ) values (
    inv.organization_id, inv.person_id, inv.matter_id, inv.id, 'participation_declined',
    statement_text, app.portal_statement_hash(statement_text), false
  );
  perform app.record_portal_audit(
    inv.organization_id,
    'portal_invitation.declined',
    'public.portal_invitations',
    inv.id,
    'success',
    jsonb_build_object('role', inv.role)
  );
  perform app.enqueue_portal_notice(
    inv.organization_id,
    inv.id,
    'portal_invitation.participation_declined',
    jsonb_build_object('invitation_id', inv.id, 'role', inv.role, 'recipient_email', inv.email),
    'portal-invite-declined:' || inv.id::text
  );
  return jsonb_build_object('ok', true, 'status', 'declined');
end;
$$;
revoke all on function public.decline_portal_invitation(text) from public;
grant execute on function public.decline_portal_invitation(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Accept. Confirmed email must match. Portal roles do not need aal2.
-- ---------------------------------------------------------------------------
create function app.jsonb_bool(p_payload jsonb, p_key text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_payload is null or not (p_payload ? p_key) then false
    when jsonb_typeof(p_payload -> p_key) = 'boolean' then (p_payload ->> p_key)::boolean
    else null
  end;
$$;
revoke all on function app.jsonb_bool(jsonb, text) from public;

create function public.accept_portal_invitation(p_token text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  actor_email text;
  confirmed timestamptz;
  inv public.portal_invitations;
  person public.persons;
  status text;
  terms public.portal_policy_documents;
  privacy public.portal_policy_documents;
  locale text;
  email_notices boolean;
  sms_notices boolean;
  deadline_reminders boolean;
  processing boolean;
  ai_flag boolean;
  mem_id uuid;
  mem_status public.membership_status;
  share_key text;
  applicant_id uuid;
  subject uuid;
  statement_text text;
  consent_id uuid;
  denial text;
begin
  if actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  inv := app.present_portal_invitation(p_token);
  if current_setting('app.portal_rate_limited', true) = '1' then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;
  if inv.id is null then
    return jsonb_build_object('ok', false, 'error', 'invitation_cannot_be_accepted');
  end if;

  select users.email, users.email_confirmed_at into actor_email, confirmed
  from auth.users users
  where users.id = actor;
  status := app.portal_invitation_status(inv);
  denial := case
    when confirmed is null then 'confirmed_email_required'
    when lower(btrim(actor_email)) is distinct from inv.email then 'invitation_cannot_be_accepted'
    when status <> 'open' then 'invitation_cannot_be_accepted'
    else null
  end;
  if denial is not null then
    perform app.record_portal_audit(
      inv.organization_id,
      'portal_invitation.accept_denied',
      'public.portal_invitations',
      inv.id,
      'denied',
      jsonb_build_object('reason', denial, 'status', status)
    );
    return jsonb_build_object('ok', false, 'error', denial);
  end if;

  select * into person
  from public.persons
  where id = inv.person_id and organization_id = inv.organization_id
  for update;
  if person.date_of_birth is null or app.person_is_minor(person.id) then
    perform app.record_portal_audit(
      inv.organization_id, 'portal_invitation.minor_refused', 'public.persons', person.id, 'denied',
      jsonb_build_object('at', 'accept')
    );
    return jsonb_build_object(
      'ok', false,
      'error', case when person.date_of_birth is null then 'date_of_birth_required' else 'minor_cannot_hold_login' end
    );
  end if;
  if person.user_id is not null and person.user_id is distinct from actor then
    perform app.record_portal_audit(
      inv.organization_id, 'portal_invitation.accept_denied', 'public.persons', person.id, 'denied',
      jsonb_build_object('reason', 'person_already_linked')
    );
    return jsonb_build_object('ok', false, 'error', 'invitation_cannot_be_accepted');
  end if;

  terms := app.current_portal_policy(inv.organization_id, 'portal_terms');
  privacy := app.current_portal_policy(inv.organization_id, 'privacy_notice');
  if terms.id is null
     or p_payload is null
     or (p_payload ->> 'portal_terms_id') is distinct from terms.id::text then
    return jsonb_build_object('ok', false, 'error', 'portal_terms_required');
  end if;
  if privacy.id is null
     or (p_payload ->> 'privacy_notice_id') is distinct from privacy.id::text then
    return jsonb_build_object('ok', false, 'error', 'privacy_notice_required');
  end if;

  locale := coalesce(p_payload ->> 'locale', 'en-CA');
  if locale not in ('en-CA', 'fr-CA') then
    return jsonb_build_object('ok', false, 'error', 'invalid_locale');
  end if;
  email_notices := app.jsonb_bool(p_payload, 'email_notices');
  sms_notices := app.jsonb_bool(p_payload, 'sms_notices');
  deadline_reminders := app.jsonb_bool(p_payload, 'deadline_reminders');
  processing := app.jsonb_bool(p_payload, 'processing_consent');
  if email_notices is null or sms_notices is null or deadline_reminders is null or processing is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_draft');
  end if;
  if inv.role = 'adult_dependant' and processing is not true then
    return jsonb_build_object('ok', false, 'error', 'processing_consent_required');
  end if;
  if sms_notices and person.contact_phone is null then
    return jsonb_build_object('ok', false, 'error', 'contact_phone_required');
  end if;
  if p_payload ? 'ai_drafting' and app.jsonb_bool(p_payload, 'ai_drafting') is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_draft');
  end if;

  if inv.role = 'guardian' then
    foreach subject in array inv.guardian_subject_ids loop
      if app.person_is_minor(subject) is distinct from true then
        return jsonb_build_object('ok', false, 'error', 'guardian_subject_not_minor');
      end if;
    end loop;
  end if;

  if inv.role = 'adult_dependant' and p_payload ? 'shares' then
    if jsonb_typeof(p_payload -> 'shares') is distinct from 'array' then
      return jsonb_build_object('ok', false, 'error', 'invalid_share');
    end if;
    select party.person_id into applicant_id
    from public.matter_participants party
    where party.matter_id = inv.matter_id
      and party.organization_id = inv.organization_id
      and party.role = 'applicant'
      and party.person_id is not null
      and party.person_id is distinct from inv.person_id
    order by party.created_at
    limit 1;
    for share_key in select jsonb_array_elements_text(p_payload -> 'shares') loop
      if share_key not in ('passport_bio', 'school_transcript', 'police_certificate', 'private_record') then
        return jsonb_build_object('ok', false, 'error', 'invalid_share');
      end if;
      if applicant_id is null then
        return jsonb_build_object('ok', false, 'error', 'applicant_required');
      end if;
    end loop;
  elsif p_payload ? 'shares' and jsonb_array_length(coalesce(p_payload -> 'shares', '[]'::jsonb)) > 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_share');
  end if;

  select mem.id, mem.status into mem_id, mem_status
  from public.memberships mem
  where mem.organization_id = inv.organization_id
    and mem.user_id = actor
    and mem.role = inv.role
  for update;
  if mem_id is null then
    insert into public.memberships (
      organization_id, user_id, role, status, invited_by, invited_at, created_by
    ) values (
      inv.organization_id, actor, inv.role, 'invited', inv.created_by, inv.created_at, inv.created_by
    )
    returning id into mem_id;
    mem_status := 'invited';
  end if;
  if mem_status = 'invited' then
    update public.memberships
       set status = 'active', accepted_at = statement_timestamp()
     where memberships.id = mem_id
       and memberships.status = 'invited';
  elsif mem_status is distinct from 'active' then
    return jsonb_build_object('ok', false, 'error', 'invitation_cannot_be_accepted');
  end if;

  update public.persons
     set user_id = actor,
         email = coalesce(email, inv.email)
   where id = person.id
     and organization_id = inv.organization_id
     and (user_id is null or user_id = actor);
  if not found then
    raise exception 'invitation cannot be accepted' using errcode = '42501';
  end if;

  insert into public.person_contact_preferences (
    person_id, organization_id, email_notices, sms_notices, deadline_reminders, locale
  ) values (
    person.id, inv.organization_id, email_notices, sms_notices, deadline_reminders, locale
  )
  on conflict (person_id) do update
    set email_notices = excluded.email_notices,
        sms_notices = excluded.sms_notices,
        deadline_reminders = excluded.deadline_reminders,
        locale = excluded.locale;

  statement_text := 'I accept the firm portal terms.';
  insert into public.consent_records (
    organization_id, person_id, matter_id, invitation_id, purpose, policy_document_id, policy_version,
    statement_text, statement_sha256, granted
  ) values (
    inv.organization_id, person.id, inv.matter_id, inv.id, 'portal_terms', terms.id, terms.version_label,
    statement_text, app.portal_statement_hash(statement_text), true
  );
  statement_text := 'I have been shown the privacy information.';
  insert into public.consent_records (
    organization_id, person_id, matter_id, invitation_id, purpose, policy_document_id, policy_version,
    statement_text, statement_sha256, granted
  ) values (
    inv.organization_id, person.id, inv.matter_id, inv.id, 'privacy_notice', privacy.id, privacy.version_label,
    statement_text, app.portal_statement_hash(statement_text), true
  );
  if inv.role = 'adult_dependant' then
    statement_text := 'I agree that the firm can use my information to prepare this application.';
    insert into public.consent_records (
      organization_id, person_id, matter_id, invitation_id, purpose,
      statement_text, statement_sha256, granted
    ) values (
      inv.organization_id, person.id, inv.matter_id, inv.id, 'processing',
      statement_text, app.portal_statement_hash(statement_text), true
    );
  end if;
  statement_text := 'Email me when something needs my attention.';
  insert into public.consent_records (
    organization_id, person_id, matter_id, invitation_id, purpose, scope,
    statement_text, statement_sha256, granted
  ) values (
    inv.organization_id, person.id, inv.matter_id, inv.id, 'contact_email', 'email',
    statement_text, app.portal_statement_hash(statement_text), email_notices
  );
  statement_text := 'Text me reminders.';
  insert into public.consent_records (
    organization_id, person_id, matter_id, invitation_id, purpose, scope,
    statement_text, statement_sha256, granted
  ) values (
    inv.organization_id, person.id, inv.matter_id, inv.id, 'contact_sms', 'sms',
    statement_text, app.portal_statement_hash(statement_text), sms_notices
  );
  statement_text := 'Remind me before a deadline.';
  insert into public.consent_records (
    organization_id, person_id, matter_id, invitation_id, purpose,
    statement_text, statement_sha256, granted
  ) values (
    inv.organization_id, person.id, inv.matter_id, inv.id, 'deadline_reminder',
    statement_text, app.portal_statement_hash(statement_text), deadline_reminders
  );
  if p_payload ? 'ai_drafting' then
    ai_flag := app.jsonb_bool(p_payload, 'ai_drafting');
    statement_text := 'The firm may use drafting help that a person at the firm reviews before it is used.';
    insert into public.consent_records (
      organization_id, person_id, matter_id, invitation_id, purpose,
      statement_text, statement_sha256, granted
    ) values (
      inv.organization_id, person.id, inv.matter_id, inv.id, 'ai_drafting',
      statement_text, app.portal_statement_hash(statement_text), ai_flag
    );
  end if;

  if inv.role = 'adult_dependant' and p_payload ? 'shares' then
    for share_key in select distinct jsonb_array_elements_text(p_payload -> 'shares') loop
      statement_text := 'Share the selected section with the applicant.';
      insert into public.consent_records (
        organization_id, person_id, matter_id, invitation_id, purpose, scope,
        statement_text, statement_sha256, granted
      ) values (
        inv.organization_id, person.id, inv.matter_id, inv.id, 'share_section', share_key,
        statement_text, app.portal_statement_hash(statement_text), true
      )
      returning id into consent_id;
      insert into public.section_shares (
        organization_id, subject_person_id, grantee_person_id, matter_id, section_key, consent_record_id
      )
      select inv.organization_id, person.id, applicant_id, inv.matter_id, share_key::public.person_section_key, consent_id
      where not exists (
        select 1
        from public.section_shares existing
        where existing.matter_id = inv.matter_id
          and existing.subject_person_id = person.id
          and existing.grantee_person_id = applicant_id
          and existing.section_key = share_key::public.person_section_key
          and existing.revoked_at is null
      );
    end loop;
  end if;

  if inv.role = 'guardian' then
    foreach subject in array inv.guardian_subject_ids loop
      insert into public.access_grants (
        organization_id, grantee_person_id, subject_person_id, matter_id, kind, purpose
      )
      select
        inv.organization_id, person.id, subject, inv.matter_id, 'guardian',
        'Guardian authority recorded when the guardian accepted the portal invitation.'
      where not exists (
        select 1
        from public.access_grants existing
        where existing.organization_id = inv.organization_id
          and existing.grantee_person_id = person.id
          and existing.subject_person_id = subject
          and existing.matter_id = inv.matter_id
          and existing.kind = 'guardian'
          and existing.revoked_at is null
      );
    end loop;
  end if;

  update public.profiles
     set preferred_locale = locale
   where id = actor;

  update public.portal_invitations
     set consumed_at = statement_timestamp(),
         consumed_by = actor,
         membership_id = mem_id
   where id = inv.id
     and consumed_at is null
     and revoked_at is null
     and declined_at is null
     and expires_at > statement_timestamp();
  if not found then
    raise exception 'invitation cannot be accepted' using errcode = '42501';
  end if;

  perform app.record_portal_audit(
    inv.organization_id,
    'portal_invitation.accepted',
    'public.memberships',
    mem_id,
    'success',
    jsonb_build_object('role', inv.role, 'invitation_id', inv.id, 'person_id', person.id)
  );
  perform app.enqueue_portal_notice(
    inv.organization_id,
    inv.id,
    'portal_invitation.accepted',
    jsonb_build_object('invitation_id', inv.id, 'role', inv.role, 'membership_id', mem_id),
    'portal-invite-accepted:' || inv.id::text
  );

  return jsonb_build_object(
    'ok', true,
    'membership_id', mem_id,
    'person_id', person.id,
    'matter_id', inv.matter_id,
    'organization_id', inv.organization_id,
    'role', inv.role
  );
end;
$$;
revoke all on function public.accept_portal_invitation(text, jsonb) from public, anon;
grant execute on function public.accept_portal_invitation(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Policies, sections, withdrawal, later contact choices.
-- ---------------------------------------------------------------------------
create function public.publish_portal_policy(
  p_kind text,
  p_version_label text,
  p_title text,
  p_body text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  org uuid := app.current_organization_id();
  policy_id uuid;
  body text := p_body;
begin
  if actor is null or org is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if app.staff_mfa_satisfied() is distinct from true
     or app.mfa_step_up_satisfied() is distinct from true
     or app.has_org_role(org, array['firm_owner', 'licensed_consultant']::public.org_role[]) is distinct from true then
    raise exception 'portal policy publishing requires a recent step-up' using errcode = '42501';
  end if;
  if p_kind not in ('portal_terms', 'privacy_notice')
     or p_version_label !~ '^[A-Za-z0-9._-]{1,40}$'
     or length(btrim(coalesce(p_title, ''))) not between 1 and 200
     or length(coalesce(body, '')) not between 1 and 8000 then
    raise exception 'portal policy is incomplete' using errcode = '22023';
  end if;
  insert into public.portal_policy_documents (
    organization_id, kind, version_label, title, body, body_sha256
  ) values (
    org,
    p_kind,
    p_version_label,
    btrim(p_title),
    body,
    app.portal_statement_hash(body)
  )
  returning id into policy_id;
  perform app.record_portal_audit(
    org, 'portal_policy.published', 'public.portal_policy_documents', policy_id, 'success',
    jsonb_build_object('kind', p_kind, 'version_label', p_version_label)
  );
  return policy_id;
end;
$$;
revoke all on function public.publish_portal_policy(text, text, text, text) from public, anon;
grant execute on function public.publish_portal_policy(text, text, text, text) to authenticated;

create function public.record_person_section(
  p_person_id uuid,
  p_matter_id uuid,
  p_section_key public.person_section_key,
  p_summary text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  org uuid;
  summary text := btrim(coalesce(p_summary, ''));
  section_id uuid;
begin
  select person.organization_id into org
  from public.persons person
  where person.id = p_person_id;
  if actor is null or org is null or app.in_active_org(org) is distinct from true then
    raise exception 'section record denied' using errcode = '42501';
  end if;
  if app.staff_mfa_satisfied() is distinct from true
     or (
       app.actor_staff_assigned_to_matter(p_matter_id, org) is distinct from true
       and not (
         app.has_org_role(org, array['licensed_consultant', 'case_manager']::public.org_role[])
         and exists (
           select 1 from public.persons person
           where person.id = p_person_id
             and person.created_by = actor
         )
       )
     ) then
    raise exception 'section record denied' using errcode = '42501';
  end if;
  if length(summary) not between 1 and 200 then
    raise exception 'section summary is required' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.matter_participants party
    where party.organization_id = org
      and party.matter_id = p_matter_id
      and party.person_id = p_person_id
  ) then
    raise exception 'section record denied' using errcode = '42501';
  end if;
  insert into public.person_section_records (
    organization_id, person_id, matter_id, section_key, restricted, summary
  ) values (
    org,
    p_person_id,
    p_matter_id,
    p_section_key,
    p_section_key is distinct from 'shared_family_record',
    summary
  )
  returning id into section_id;
  perform app.record_portal_audit(
    org, 'person_section.recorded', 'public.person_section_records', section_id, 'success',
    jsonb_build_object('section_key', p_section_key, 'person_id', p_person_id, 'matter_id', p_matter_id)
  );
  return section_id;
end;
$$;
revoke all on function public.record_person_section(uuid, uuid, public.person_section_key, text) from public, anon;
grant execute on function public.record_person_section(uuid, uuid, public.person_section_key, text) to authenticated;

create function public.withdraw_section_share(p_share_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  share public.section_shares;
begin
  select * into share from public.section_shares where id = p_share_id for update;
  if share.id is null or not exists (
    select 1
    from public.persons person
    where person.id = share.subject_person_id
      and person.organization_id = share.organization_id
      and person.user_id = actor
  ) or app.in_active_org(share.organization_id) is distinct from true then
    raise exception 'section share withdrawal denied' using errcode = '42501';
  end if;
  if share.revoked_at is not null then
    raise exception 'section share withdrawal denied' using errcode = '42501';
  end if;
  update public.section_shares
     set revoked_at = statement_timestamp()
   where id = share.id
     and revoked_at is null;
  update public.consent_records
     set withdrawn_at = statement_timestamp()
   where id = share.consent_record_id
     and granted is true
     and withdrawn_at is null;
  perform app.record_portal_audit(
    share.organization_id,
    'section_share.withdrawn',
    'public.section_shares',
    share.id,
    'success',
    jsonb_build_object('section_key', share.section_key, 'matter_id', share.matter_id)
  );
end;
$$;
revoke all on function public.withdraw_section_share(uuid) from public, anon;
grant execute on function public.withdraw_section_share(uuid) to authenticated;

create function public.save_my_contact_preferences(
  p_email_notices boolean,
  p_sms_notices boolean,
  p_deadline_reminders boolean,
  p_locale text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  org uuid := app.current_organization_id();
  person_id uuid;
  phone text;
  statement_text text;
begin
  if actor is null or org is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_locale not in ('en-CA', 'fr-CA') then
    raise exception 'locale is not usable' using errcode = '22023';
  end if;
  select person.id, person.contact_phone into person_id, phone
  from public.persons person
  where person.organization_id = org
    and person.user_id = actor;
  if person_id is null then
    raise exception 'contact preferences denied' using errcode = '42501';
  end if;
  if p_sms_notices is true and phone is null then
    raise exception 'contact phone is required for text reminders' using errcode = '22023';
  end if;
  insert into public.person_contact_preferences (
    person_id, organization_id, email_notices, sms_notices, deadline_reminders, locale
  ) values (
    person_id, org, coalesce(p_email_notices, false), coalesce(p_sms_notices, false),
    coalesce(p_deadline_reminders, false), p_locale
  )
  on conflict (person_id) do update
    set email_notices = excluded.email_notices,
        sms_notices = excluded.sms_notices,
        deadline_reminders = excluded.deadline_reminders,
        locale = excluded.locale;
  statement_text := 'Email me when something needs my attention.';
  insert into public.consent_records (
    organization_id, person_id, purpose, scope, statement_text, statement_sha256, granted
  ) values (
    org, person_id, 'contact_email', 'email', statement_text, app.portal_statement_hash(statement_text),
    coalesce(p_email_notices, false)
  );
  statement_text := 'Text me reminders.';
  insert into public.consent_records (
    organization_id, person_id, purpose, scope, statement_text, statement_sha256, granted
  ) values (
    org, person_id, 'contact_sms', 'sms', statement_text, app.portal_statement_hash(statement_text),
    coalesce(p_sms_notices, false)
  );
  statement_text := 'Remind me before a deadline.';
  insert into public.consent_records (
    organization_id, person_id, purpose, statement_text, statement_sha256, granted
  ) values (
    org, person_id, 'deadline_reminder', statement_text, app.portal_statement_hash(statement_text),
    coalesce(p_deadline_reminders, false)
  );
  update public.profiles set preferred_locale = p_locale where id = actor;
  perform app.record_portal_audit(
    org, 'contact_preferences.saved', 'public.persons', person_id, 'success',
    jsonb_build_object('locale', p_locale)
  );
end;
$$;
revoke all on function public.save_my_contact_preferences(boolean, boolean, boolean, text) from public, anon;
grant execute on function public.save_my_contact_preferences(boolean, boolean, boolean, text) to authenticated;

-- create/resend are invoker wrappers. The other public functions are security definer.
grant execute on function app.issue_portal_invitation(uuid, uuid, public.org_role, text, uuid[], text) to authenticated;

-- ---------------------------------------------------------------------------
-- Privileges and RLS
-- ---------------------------------------------------------------------------
revoke all on table public.portal_invitations from anon, authenticated;
grant select (
  id, organization_id, matter_id, person_id, role, email, guardian_subject_ids,
  expires_at, opened_at, consumed_at, consumed_by, revoked_at, declined_at,
  membership_id, draft, email_enqueued_at, created_at, updated_at, created_by, version
) on table public.portal_invitations to authenticated;

revoke all on table public.portal_policy_documents from anon, authenticated;
grant select on table public.portal_policy_documents to authenticated;

revoke all on table public.consent_records from anon, authenticated;
grant select on table public.consent_records to authenticated;

revoke all on table public.person_section_records from anon, authenticated;
grant select on table public.person_section_records to authenticated;

revoke all on table public.section_shares from anon, authenticated;
grant select on table public.section_shares to authenticated;

revoke all on table public.person_contact_preferences from anon, authenticated;
grant select on table public.person_contact_preferences to authenticated;

revoke all on table public.portal_invite_attempts from anon, authenticated;

alter table public.portal_invitations enable row level security;
alter table public.portal_invitations force row level security;
alter table public.portal_policy_documents enable row level security;
alter table public.portal_policy_documents force row level security;
alter table public.consent_records enable row level security;
alter table public.consent_records force row level security;
alter table public.person_section_records enable row level security;
alter table public.person_section_records force row level security;
alter table public.section_shares enable row level security;
alter table public.section_shares force row level security;
alter table public.person_contact_preferences enable row level security;
alter table public.person_contact_preferences force row level security;
alter table public.portal_invite_attempts enable row level security;
alter table public.portal_invite_attempts force row level security;

create policy portal_invitations_select on public.portal_invitations
  for select to authenticated
  using (
    (select app.in_active_org(organization_id))
    and (select app.staff_mfa_satisfied())
    and (
      (select app.has_org_role(organization_id, array['firm_owner']::public.org_role[]))
      or (
        (select app.has_org_role(organization_id, array['licensed_consultant', 'case_manager']::public.org_role[]))
        and (
          (select app.actor_staff_assigned_to_matter(matter_id, organization_id))
          or created_by = (select auth.uid())
        )
      )
    )
  );

create policy portal_policy_documents_select on public.portal_policy_documents
  for select to authenticated
  using (
    (select app.in_active_org(organization_id))
    and (select app.is_org_member(organization_id))
  );

create policy consent_records_select on public.consent_records
  for select to authenticated
  using (
    (select app.in_active_org(organization_id))
    and (
      exists (
        select 1
        from public.persons person
        where person.id = person_id
          and person.organization_id = organization_id
          and person.user_id = (select auth.uid())
      )
      or (
        (select app.staff_mfa_satisfied())
        and (
          (select app.has_org_role(organization_id, array['firm_owner']::public.org_role[]))
          or (
            matter_id is not null
            and (select app.actor_staff_assigned_to_matter(matter_id, organization_id))
          )
        )
      )
    )
  );

create policy person_section_records_select on public.person_section_records
  for select to authenticated
  using ((select app.can_read_person_section(id)));

create policy section_shares_select on public.section_shares
  for select to authenticated
  using (
    (select app.in_active_org(organization_id))
    and (
      exists (
        select 1 from public.persons person
        where person.organization_id = section_shares.organization_id
          and person.user_id = (select auth.uid())
          and person.id in (section_shares.subject_person_id, section_shares.grantee_person_id)
      )
      or (
        (select app.staff_mfa_satisfied())
        and (
          (select app.has_org_role(organization_id, array['firm_owner']::public.org_role[]))
          or (select app.actor_staff_assigned_to_matter(matter_id, organization_id))
        )
      )
    )
  );

create policy person_contact_preferences_select on public.person_contact_preferences
  for select to authenticated
  using (
    (select app.in_active_org(organization_id))
    and (
      exists (
        select 1 from public.persons person
        where person.id = person_id
          and person.user_id = (select auth.uid())
      )
      or (
        (select app.staff_mfa_satisfied())
        and (
          (select app.has_org_role(organization_id, array['firm_owner']::public.org_role[]))
          or exists (
            select 1
            from public.matter_participants party
            where party.person_id = person_contact_preferences.person_id
              and party.organization_id = person_contact_preferences.organization_id
              and (select app.actor_staff_assigned_to_matter(party.matter_id, party.organization_id))
          )
        )
      )
    )
  );
