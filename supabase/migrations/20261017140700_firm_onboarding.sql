-- T018 firm onboarding, consultant licence records, sample mode, and trial.
-- Additive only. This migration does not fetch or scrape the CICC register.
-- A check stores what a firm owner or platform reviewer entered after looking
-- at register.college-ic.ca, plus the proof file they cite.
--
-- Public register entry pages retrieved 2026-10-17. The stored hashes are the
-- HTML shells of those responses, not the register database. RCICs and RISIAs
-- are listed separately. No RISIA search URL is invented.
--   https://register.college-ic.ca/Public-Register-EN
--   https://register.college-ic.ca/Public-Register-EN/RCIC_Search.aspx
-- A profile shows Licence Status (Active/Inactive), licence history,
-- Entitlement to Practise, and discipline history. Revoked, suspended, and
-- inactive lock consultant-only actions. A restriction flag is stored and
-- does not lock. Entitlement = No is not verified and does not lock.
-- register.college-ic.ca passes the allowlist because college-ic.ca is a
-- suffix host. Evidence URLs must still be that register host.
--
-- Trial length, re-check interval, and the manual-check target are rows in
-- product_settings. The functions read those rows. They do not contain the
-- designer placeholder numbers.

create type public.firm_setup_step as enum (
  'firm_profile',
  'offices',
  'jurisdictions',
  'privacy_and_terms',
  'branding',
  'retention',
  'continuity',
  'licence'
);
comment on type public.firm_setup_step is
  'Eight setup steps for site/app-v2/auth/setup. Keys follow the screen fields named in the 2026-10-17 gap check (offices, privacy contact, branding, retention) and PRD §6 / ORG-01–06. Confirm the labels with the designer HTML.';

create type public.sample_proof_step as enum (
  'intake',
  'agreement',
  'upload',
  'reminder',
  'invoice',
  'export'
);
comment on type public.sample_proof_step is
  'PRD §6 firm activation: the sample case proves these six paths before real client invitations. Later tasks own the modules. This slice records that a flagged sample matter was used.';

create type public.licence_type as enum ('RCIC', 'RISIA');
comment on type public.licence_type is
  'CICC lists RCICs and RISIAs on separate register searches. No other class is stored.';

create type public.register_licence_status as enum ('active', 'inactive');
comment on type public.register_licence_status is
  'Licence Status as printed on a CICC public-register profile.';

create type public.credential_status as enum (
  'declared',
  'verified',
  'not_entitled',
  'inactive',
  'suspended',
  'revoked'
);
comment on type public.credential_status is
  'verified means a manual register check recorded Active, Entitlement to Practise, and neither suspension nor revocation. inactive, suspended, and revoked lock regulated consultant actions. not_entitled is not verified and does not lock. A restriction flag is not a status.';

create type public.licence_check_result as enum (
  'verified',
  'not_entitled',
  'inactive',
  'suspended',
  'revoked'
);
comment on type public.licence_check_result is
  'Derived inside app.record_licence_check from the fields the reviewer entered. The caller cannot send a contradictory result.';

create type public.subscription_status as enum (
  'trial',
  'trial_ended',
  'active',
  'cancelled'
);

-- ---------------------------------------------------------------------------
-- Platform product settings. Proposed defaults are seeded and marked pending.
-- ---------------------------------------------------------------------------
create table public.product_settings (
  key text primary key check (key ~ '^[a-z][a-z0-9_.]{1,80}$'),
  value jsonb not null check (jsonb_typeof(value) = 'object' and pg_column_size(value) <= 2000),
  description text not null check (length(description) between 1 and 500),
  pending_confirmation boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1)
);
comment on table public.product_settings is
  'Platform configuration. Enforcement reads these rows. pending_confirmation means Francis has not accepted the seeded value.';

create index product_settings_created_by_idx on public.product_settings (created_by);

create trigger product_settings_touch before update on public.product_settings
  for each row execute function app.touch_row();
create trigger product_settings_stamp before insert on public.product_settings
  for each row execute function app.stamp_created_by();
create trigger product_settings_audit after insert or update or delete on public.product_settings
  for each row execute function app.audit_row_change();

insert into public.product_settings (key, value, description, pending_confirmation) values
  (
    'trial.duration',
    '{"unit":"days","count":14}'::jsonb,
    'Proposed trial length from PRD §3 and the designer sample-mode status. Not a confirmed business rule. Trial end does not delete records.',
    true
  ),
  (
    'licence.recheck_interval',
    '{"unit":"months","count":1}'::jsonb,
    'Proposed product control for the next public-register re-check (ORG-04). Not a statutory interval.',
    true
  ),
  (
    'licence.manual_check_target',
    '{"unit":"business_days","count":1}'::jsonb,
    'Designer copy for how soon a manual register check is usually recorded. Not an SLA and not used to mark a licence verified.',
    true
  );

create function app.product_setting_interval(p_key text)
returns interval
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  setting jsonb;
  unit text;
  count integer;
begin
  select value into setting from public.product_settings where key = p_key;
  if setting is null then
    return null;
  end if;
  unit := setting ->> 'unit';
  begin
    count := (setting ->> 'count')::integer;
  exception when others then
    return null;
  end;
  if count is null or count < 1 or count > 3650 then
    return null;
  end if;
  if unit = 'days' then
    return make_interval(days => count);
  elsif unit = 'months' then
    return make_interval(months => count);
  end if;
  return null;
end;
$$;
comment on function app.product_setting_interval(text) is
  'Turns a days or months product setting into an interval. business_days is not converted; there is no jurisdiction calendar here.';
revoke all on function app.product_setting_interval(text) from public;
grant execute on function app.product_setting_interval(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Firm profile (ORG-01, ORG-06) and trial row.
-- ---------------------------------------------------------------------------
alter table public.organizations
  add column billing_contact_name text,
  add column billing_contact_email text,
  add column privacy_contact_name text,
  add column privacy_contact_email text,
  add column continuity_contact_name text,
  add column continuity_contact_email text,
  add column succession_note text,
  add column branding jsonb not null default '{}'::jsonb,
  add column retention_policy jsonb,
  add column dpa_accepted_at timestamptz,
  add column dpa_version text,
  add column subscription_terms_accepted_at timestamptz,
  add column subscription_terms_version text,
  add column sample_mode boolean not null default true;

alter table public.organizations
  add constraint organizations_billing_email_ck check (
    billing_contact_email is null
    or (billing_contact_email = lower(billing_contact_email) and length(billing_contact_email) <= 320)
  ),
  add constraint organizations_privacy_email_ck check (
    privacy_contact_email is null
    or (privacy_contact_email = lower(privacy_contact_email) and length(privacy_contact_email) <= 320)
  ),
  add constraint organizations_continuity_email_ck check (
    continuity_contact_email is null
    or (continuity_contact_email = lower(continuity_contact_email) and length(continuity_contact_email) <= 320)
  ),
  add constraint organizations_branding_ck check (jsonb_typeof(branding) = 'object' and pg_column_size(branding) <= 4000),
  add constraint organizations_retention_ck check (
    retention_policy is null
    or (
      jsonb_typeof(retention_policy) = 'object'
      and retention_policy ->> 'unit' = 'years'
      and (retention_policy ->> 'count') ~ '^[0-9]+$'
      and (retention_policy ->> 'count')::integer between 1 and 100
    )
  ),
  add constraint organizations_succession_ck check (
    succession_note is null or length(succession_note) <= 2000
  );

comment on column public.organizations.sample_mode is
  'When true, application roles may insert only rows flagged is_sample. Turning it off does not convert existing sample rows.';
comment on column public.organizations.retention_policy is
  'The firm''s chosen retention setting. Not a statutory retention period and not seeded from a statute.';
comment on column public.organizations.verification_status is
  'verified means a manual public-register check was recorded for a consultant in good standing. It is not a live CICC synchronization.';

create table public.organization_offices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  label text not null check (length(btrim(label)) between 1 and 120),
  address_line text not null check (length(btrim(address_line)) between 1 and 300),
  locality text not null check (length(btrim(locality)) between 1 and 120),
  region text check (region is null or length(btrim(region)) between 1 and 80),
  postal_code text check (postal_code is null or length(btrim(postal_code)) between 1 and 20),
  country_code text not null default 'CA' check (country_code ~ '^[A-Z]{2}$'),
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id)
);
comment on table public.organization_offices is
  'Firm office address. Not a client address and not an immigration fact.';

create index organization_offices_org_idx on public.organization_offices (organization_id);
create index organization_offices_created_by_idx on public.organization_offices (created_by);
create unique index organization_offices_one_primary_idx
  on public.organization_offices (organization_id)
  where is_primary;

create trigger organization_offices_touch before update on public.organization_offices
  for each row execute function app.touch_row();
create trigger organization_offices_immutable before update on public.organization_offices
  for each row execute function app.guard_tenant_keys();
create trigger organization_offices_stamp before insert on public.organization_offices
  for each row execute function app.stamp_created_by();
create trigger organization_offices_audit after insert or update or delete on public.organization_offices
  for each row execute function app.audit_row_change();

create table public.organization_setup_steps (
  organization_id uuid not null references public.organizations (id),
  step public.firm_setup_step not null,
  completed_at timestamptz not null default now(),
  completed_by uuid not null references auth.users (id),
  primary key (organization_id, step)
);
comment on table public.organization_setup_steps is
  'Which of the eight firm-setup steps the owner has saved. Completion is not licence verification.';

create index organization_setup_steps_completed_by_idx
  on public.organization_setup_steps (completed_by);

create trigger organization_setup_steps_audit after insert or update or delete on public.organization_setup_steps
  for each row execute function app.audit_row_change();

create table public.organization_subscriptions (
  organization_id uuid primary key references public.organizations (id),
  status public.subscription_status not null default 'trial',
  trial_started_at timestamptz not null default now(),
  trial_ends_at timestamptz,
  duration_snapshot jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1)
);
comment on table public.organization_subscriptions is
  'Platform trial clock for the firm. Separate from client immigration fees. Ending a trial does not delete records. No plan price is stored.';
comment on column public.organization_subscriptions.duration_snapshot is
  'The product_settings trial.duration value copied when the trial started. Later setting edits do not rewrite it.';

create index organization_subscriptions_created_by_idx on public.organization_subscriptions (created_by);

create trigger organization_subscriptions_touch before update on public.organization_subscriptions
  for each row execute function app.touch_row();
create trigger organization_subscriptions_stamp before insert on public.organization_subscriptions
  for each row execute function app.stamp_created_by();
create trigger organization_subscriptions_audit after insert or update or delete on public.organization_subscriptions
  for each row execute function app.audit_row_change();

create function app.start_organization_trial()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  duration interval := app.product_setting_interval('trial.duration');
  snapshot jsonb;
begin
  select value into snapshot from public.product_settings where key = 'trial.duration';
  insert into public.organization_subscriptions (
    organization_id, status, trial_started_at, trial_ends_at, duration_snapshot
  ) values (
    new.id,
    'trial',
    statement_timestamp(),
    case when duration is null then null else statement_timestamp() + duration end,
    snapshot
  );
  return new;
end;
$$;
revoke all on function app.start_organization_trial() from public;

-- Deferred so the owner membership exists before the subscription audit runs.
-- record_audit_event rejects a signed-in caller who is not yet a member.
create constraint trigger organizations_start_trial
  after insert on public.organizations
  deferrable initially deferred
  for each row execute function app.start_organization_trial();

insert into public.organization_subscriptions (
  organization_id, status, trial_started_at, trial_ends_at, duration_snapshot
)
select
  org.id,
  'trial',
  org.created_at,
  case
    when app.product_setting_interval('trial.duration') is null then null
    else org.created_at + app.product_setting_interval('trial.duration')
  end,
  (select value from public.product_settings where key = 'trial.duration')
from public.organizations org
where not exists (
  select 1 from public.organization_subscriptions sub where sub.organization_id = org.id
);

-- ---------------------------------------------------------------------------
-- Sample flag. Immutable. Sample rows cannot be linked to real rows.
-- ---------------------------------------------------------------------------
alter table public.persons
  add column is_sample boolean not null default false,
  add column sample_label text;
alter table public.matters
  add column is_sample boolean not null default false,
  add column sample_label text;

alter table public.persons
  add constraint persons_sample_label_ck check (
    (is_sample and sample_label = 'Fictional sample. Not a client record.')
    or (not is_sample and sample_label is null)
  );
alter table public.matters
  add constraint matters_sample_label_ck check (
    (is_sample and sample_label = 'Fictional sample. Not a client record.')
    or (not is_sample and sample_label is null)
  );

comment on column public.persons.is_sample is
  'Fictional sandbox row. Excluded from billing and export. Cannot be changed to a real person.';
comment on column public.matters.is_sample is
  'Fictional sandbox matter. Excluded from billing and export. Cannot be changed to a real matter.';

create index persons_sample_idx on public.persons (organization_id, is_sample);
create index matters_sample_idx on public.matters (organization_id, is_sample);

create function app.guard_sample_row()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  sample_mode boolean;
begin
  if tg_op = 'UPDATE' and new.is_sample is distinct from old.is_sample then
    raise exception 'sample flag is immutable' using errcode = '42501';
  end if;
  select org.sample_mode into sample_mode
  from public.organizations org
  where org.id = new.organization_id;
  if tg_op = 'INSERT'
     and new.is_sample is not true
     and sample_mode is true
     and current_user in ('authenticated', 'service_role') then
    raise exception 'this firm is in sample mode; new people and matters must be flagged as sample'
      using errcode = '42501';
  end if;
  if new.is_sample then
    new.sample_label := 'Fictional sample. Not a client record.';
  else
    new.sample_label := null;
  end if;
  return new;
end;
$$;
revoke all on function app.guard_sample_row() from public;

create trigger persons_sample_guard before insert or update on public.persons
  for each row execute function app.guard_sample_row();
create trigger matters_sample_guard before insert or update on public.matters
  for each row execute function app.guard_sample_row();

create function app.guard_sample_participant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  matter_sample boolean;
  person_sample boolean;
begin
  if new.person_id is null then
    return new;
  end if;
  select matter.is_sample into matter_sample
  from public.matters matter
  where matter.id = new.matter_id
    and matter.organization_id = new.organization_id;
  select person.is_sample into person_sample
  from public.persons person
  where person.id = new.person_id
    and person.organization_id = new.organization_id;
  if matter_sample is null or person_sample is null or matter_sample is distinct from person_sample then
    raise exception 'sample and real records cannot be linked' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.guard_sample_participant() from public;

create trigger matter_participants_sample_guard before insert or update on public.matter_participants
  for each row execute function app.guard_sample_participant();

-- ---------------------------------------------------------------------------
-- Consultant credentials. Separate from login (ORG-03).
-- licence_type is RCIC or RISIA. college_id is a storage limit, not a
-- published CICC format. No sample licence number is seeded.
-- ---------------------------------------------------------------------------
create table public.consultant_credentials (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  membership_id uuid not null,
  regulator text not null default 'CICC' check (regulator = 'CICC'),
  licence_type public.licence_type not null,
  college_id text not null check (college_id ~ '^[A-Z0-9-]{1,40}$'),
  scope_note text check (scope_note is null or length(scope_note) <= 1000),
  status public.credential_status not null default 'declared',
  proof_locator text check (proof_locator is null or length(btrim(proof_locator)) between 1 and 500),
  source_url text,
  register_status public.register_licence_status,
  entitlement_to_practise boolean,
  discipline_suspended boolean not null default false,
  discipline_revoked boolean not null default false,
  discipline_restricted boolean not null default false,
  verification_method text check (
    verification_method is null or verification_method = 'manual_public_register'
  ),
  declared_at timestamptz not null default now(),
  checked_at timestamptz,
  next_review_at timestamptz,
  reviewer_user_id uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id),
  unique (membership_id),
  unique (organization_id, licence_type, college_id),
  foreign key (membership_id, organization_id) references public.memberships (id, organization_id)
);
comment on table public.consultant_credentials is
  'Declared CICC licence for one licensed_consultant membership. Status verified means a person recorded a manual public-register check, not that a register API responded.';
comment on column public.consultant_credentials.college_id is
  'Uppercased storage limit of 40 letters, digits, or hyphens. Not a published CICC number format, and no sample number is seeded.';
comment on column public.consultant_credentials.discipline_restricted is
  'Copied from the register discipline history when a reviewer records a restriction. Stored, and not a lock.';
comment on column public.consultant_credentials.entitlement_to_practise is
  'Entitlement to Practise as entered from the register profile. False is not verified. It does not by itself lock stage changes.';

create index consultant_credentials_org_idx on public.consultant_credentials (organization_id, status);
create index consultant_credentials_membership_org_fk_idx
  on public.consultant_credentials (membership_id, organization_id);
create index consultant_credentials_reviewer_idx on public.consultant_credentials (reviewer_user_id);
create index consultant_credentials_created_by_idx on public.consultant_credentials (created_by);

create trigger consultant_credentials_touch before update on public.consultant_credentials
  for each row execute function app.touch_row();
create trigger consultant_credentials_immutable before update on public.consultant_credentials
  for each row execute function app.guard_tenant_keys();
create trigger consultant_credentials_stamp before insert on public.consultant_credentials
  for each row execute function app.stamp_created_by();
create trigger consultant_credentials_audit after insert or update or delete on public.consultant_credentials
  for each row execute function app.audit_row_change('college_id', 'proof_locator');
create trigger consultant_credentials_no_delete before delete on public.consultant_credentials
  for each row execute function app.reject_governed_delete();
create trigger consultant_credentials_no_truncate before truncate on public.consultant_credentials
  for each statement execute function app.reject_governed_delete();

create table public.credential_checks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  credential_id uuid not null,
  source_url text not null check (length(source_url) between 12 and 2000),
  source_host text not null check (source_host = 'register.college-ic.ca'),
  retrieved_at timestamptz not null,
  result public.licence_check_result not null,
  proof_locator text not null check (length(btrim(proof_locator)) between 1 and 500),
  register_status public.register_licence_status not null,
  entitlement_to_practise boolean not null,
  discipline_suspended boolean not null,
  discipline_revoked boolean not null,
  discipline_restricted boolean not null,
  reviewer_user_id uuid not null references auth.users (id),
  method text not null default 'manual_public_register' check (method = 'manual_public_register'),
  notes text check (notes is null or length(notes) <= 500),
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (credential_id, organization_id) references public.consultant_credentials (id, organization_id)
);
comment on table public.credential_checks is
  'Append-only manual public-register check. source_url must be https on register.college-ic.ca. method is manual_public_register and is never a live sync. The result is derived from the register fields the reviewer entered.';

create index credential_checks_credential_org_fk_idx
  on public.credential_checks (credential_id, organization_id);
create index credential_checks_org_idx on public.credential_checks (organization_id, retrieved_at desc);
create index credential_checks_reviewer_idx on public.credential_checks (reviewer_user_id);

create trigger credential_checks_audit after insert or update or delete on public.credential_checks
  for each row execute function app.audit_row_change('proof_locator', 'notes');
create trigger credential_checks_no_delete before delete on public.credential_checks
  for each row execute function app.reject_governed_delete();
create trigger credential_checks_no_truncate before truncate on public.credential_checks
  for each statement execute function app.reject_governed_delete();
create trigger credential_checks_no_update before update on public.credential_checks
  for each row execute function app.reject_governed_delete();

create table public.sample_proof_steps (
  organization_id uuid not null references public.organizations (id),
  step public.sample_proof_step not null,
  sample_matter_id uuid not null,
  completed_at timestamptz not null default now(),
  completed_by uuid not null references auth.users (id),
  primary key (organization_id, step),
  foreign key (sample_matter_id, organization_id) references public.matters (id, organization_id)
);
comment on table public.sample_proof_steps is
  'The six sample-case proofs. The matter must be is_sample. Recording a step does not claim the later intake, agreement, upload, reminder, invoice, or export module ran.';

create index sample_proof_steps_matter_org_fk_idx
  on public.sample_proof_steps (sample_matter_id, organization_id);
create index sample_proof_steps_completed_by_idx on public.sample_proof_steps (completed_by);

create trigger sample_proof_steps_audit after insert or update or delete on public.sample_proof_steps
  for each row execute function app.audit_row_change();
create trigger sample_proof_steps_no_delete before delete on public.sample_proof_steps
  for each row execute function app.reject_governed_delete();

-- ---------------------------------------------------------------------------
-- Licence helpers.
-- ---------------------------------------------------------------------------
create function app.cicc_register_host(p_url text)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when host = 'register.college-ic.ca' and app.host_is_allowlisted(host) then host
    else null
  end
  from (select app.official_url_host(p_url) as host) parsed;
$$;
comment on function app.cicc_register_host(text) is
  'register.college-ic.ca when that host is still allowlisted, otherwise null. www.college-ic.ca and canada.ca are not a licence check.';
revoke all on function app.cicc_register_host(text) from public;
grant execute on function app.cicc_register_host(text) to authenticated, service_role;

create function app.licence_status_blocks(p_status public.credential_status)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_status in ('revoked', 'suspended', 'inactive');
$$;
comment on function app.licence_status_blocks(public.credential_status) is
  'Revoked, suspended, and inactive lock consultant-only actions. not_entitled and discipline_restricted do not.';
revoke all on function app.licence_status_blocks(public.credential_status) from public;

create function app.actor_licence_block_status(p_org uuid)
returns public.credential_status
language sql
stable
security definer
set search_path = ''
as $$
  select credential.status
  from public.consultant_credentials credential
  join public.memberships mem
    on mem.id = credential.membership_id
   and mem.organization_id = credential.organization_id
  where credential.organization_id = p_org
    and mem.user_id = (select auth.uid())
    and mem.role = 'licensed_consultant'
    and mem.status = 'active'
    and (
      app.licence_status_blocks(credential.status)
      or credential.discipline_revoked
      or credential.discipline_suspended
      or credential.register_status = 'inactive'
    )
  order by credential.checked_at desc nulls last
  limit 1;
$$;
revoke all on function app.actor_licence_block_status(uuid) from public;
grant execute on function app.actor_licence_block_status(uuid) to authenticated, service_role;

create function app.actor_licence_blocks_regulated_action(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.actor_licence_block_status(p_org) is not null;
$$;
revoke all on function app.actor_licence_blocks_regulated_action(uuid) from public;
grant execute on function app.actor_licence_blocks_regulated_action(uuid) to authenticated, service_role;

create function app.firm_has_verified_licence(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.consultant_credentials credential
    join public.memberships mem
      on mem.id = credential.membership_id
     and mem.organization_id = credential.organization_id
    where credential.organization_id = p_org
      and mem.role = 'licensed_consultant'
      and mem.status = 'active'
      and credential.status = 'verified'
      and credential.verification_method = 'manual_public_register'
      and credential.register_status = 'active'
      and credential.entitlement_to_practise is true
      and credential.discipline_suspended is false
      and credential.discipline_revoked is false
      and not app.licence_status_blocks(credential.status)
  );
$$;
revoke all on function app.firm_has_verified_licence(uuid) from public;

create function app.sync_firm_verification(p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if app.firm_has_verified_licence(p_org) then
    update public.organizations
       set verification_status = 'verified'
     where id = p_org
       and verification_status is distinct from 'verified';
  elsif exists (
    select 1
    from public.consultant_credentials credential
    where credential.organization_id = p_org
      and credential.status in ('revoked', 'suspended', 'inactive', 'not_entitled')
  ) then
    update public.organizations
       set verification_status = 'restricted'
     where id = p_org
       and verification_status = 'verified';
  end if;
end;
$$;
comment on function app.sync_firm_verification(uuid) is
  'verified means a manual good-standing check is on file. An adverse or not-entitled check moves a previously verified firm to restricted. It is not a CICC API response.';
revoke all on function app.sync_firm_verification(uuid) from public;

-- enqueue_event rejects a signed-in non-member. Platform admins use a direct insert.
create function app.enqueue_licence_event(
  p_org uuid,
  p_credential_id uuid,
  p_event_type text,
  p_payload jsonb,
  p_idempotency_key text,
  p_available_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  eid uuid;
begin
  if (select auth.uid()) is null or app.is_org_member(p_org) then
    return app.enqueue_event(
      p_org,
      'consultant_credential',
      p_credential_id,
      p_event_type,
      p_payload,
      null,
      p_idempotency_key,
      p_available_at
    );
  end if;
  insert into public.outbox_events (
    organization_id, aggregate_type, aggregate_id, event_type, payload,
    idempotency_key, available_at, created_by, request_id
  ) values (
    p_org,
    'consultant_credential',
    p_credential_id,
    p_event_type,
    coalesce(p_payload, '{}'::jsonb),
    p_idempotency_key,
    coalesce(p_available_at, clock_timestamp()),
    (select auth.uid()),
    app.current_request_id()
  )
  on conflict (organization_id, idempotency_key) do nothing
  returning id into eid;
  if eid is null then
    select event.id into eid
    from public.outbox_events event
    where event.organization_id = p_org
      and event.idempotency_key = p_idempotency_key;
  end if;
  return eid;
end;
$$;
revoke all on function app.enqueue_licence_event(uuid, uuid, text, jsonb, text, timestamptz) from public;

create function app.require_firm_owner_step_up(p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'sign in is required' using errcode = '42501';
  end if;
  if app.in_active_org(p_org) is distinct from true
     or app.has_org_role(p_org, array['firm_owner']::public.org_role[]) is distinct from true
     or app.staff_mfa_satisfied() is distinct from true
     or app.mfa_step_up_satisfied() is distinct from true then
    raise exception 'firm owner step-up is required' using errcode = '42501';
  end if;
end;
$$;
revoke all on function app.require_firm_owner_step_up(uuid) from public;

-- A platform reviewer is not a firm member. Their licence-check audit must still commit.
create or replace function app.record_audit_event(
  p_organization_id uuid,
  p_action text,
  p_object_table text default null,
  p_object_id uuid default null,
  p_result text default 'success',
  p_context jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  rid uuid;
begin
  if (select auth.uid()) is not null
     and p_organization_id is not null
     and not app.is_org_member(p_organization_id)
     and app.is_platform_admin() is distinct from true then
    raise exception 'not a member of organization' using errcode = '42501';
  end if;
  insert into public.audit_log (organization_id, actor_user_id, actor_type, action, object_table, object_id, result, request_id, context)
  values (
    p_organization_id,
    (select auth.uid()),
    app.current_actor_type(),
    p_action,
    p_object_table,
    p_object_id,
    p_result,
    app.current_request_id(),
    coalesce(p_context, '{}'::jsonb)
  )
  returning id into rid;
  return rid;
end;
$$;

create function app.declare_consultant_credential(
  p_membership_id uuid,
  p_licence_type public.licence_type,
  p_college_id text,
  p_scope_note text,
  p_proof_locator text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  mem public.memberships%rowtype;
  college_id text := upper(btrim(coalesce(p_college_id, '')));
  credential_id uuid;
begin
  if actor is null or app.staff_mfa_satisfied() is distinct from true
     or app.mfa_step_up_satisfied() is distinct from true then
    raise exception 'declaring a licence requires a recent step-up' using errcode = '42501';
  end if;
  select * into mem from public.memberships where id = p_membership_id;
  if mem.id is null
     or mem.role is distinct from 'licensed_consultant'
     or mem.status is distinct from 'active'
     or app.in_active_org(mem.organization_id) is distinct from true then
    raise exception 'licence declaration denied' using errcode = '42501';
  end if;
  if mem.user_id is distinct from actor
     and app.has_org_role(mem.organization_id, array['firm_owner']::public.org_role[]) is distinct from true then
    raise exception 'licence declaration denied' using errcode = '42501';
  end if;
  if p_licence_type is null then
    raise exception 'licence type is required' using errcode = '22023';
  end if;
  if college_id !~ '^[A-Z0-9-]{1,40}$' then
    raise exception 'college id is not usable' using errcode = '22023';
  end if;
  if p_proof_locator is null or length(btrim(p_proof_locator)) not between 1 and 500 then
    raise exception 'a proof file reference is required' using errcode = '22023';
  end if;

  insert into public.consultant_credentials (
    organization_id, membership_id, licence_type, college_id, scope_note,
    proof_locator, status
  ) values (
    mem.organization_id,
    mem.id,
    p_licence_type,
    college_id,
    nullif(btrim(coalesce(p_scope_note, '')), ''),
    btrim(p_proof_locator),
    'declared'
  )
  returning id into credential_id;

  update public.organizations
     set verification_status = 'pending_review'
   where id = mem.organization_id
     and verification_status = 'unverified';

  perform app.record_audit_event(
    mem.organization_id,
    'licence.declared',
    'public.consultant_credentials',
    credential_id,
    'success',
    jsonb_build_object('regulator', 'CICC', 'licence_type', p_licence_type, 'membership_id', mem.id)
  );
  return credential_id;
end;
$$;
revoke all on function app.declare_consultant_credential(uuid, public.licence_type, text, text, text) from public;

create function app.record_licence_check(
  p_credential_id uuid,
  p_source_url text,
  p_retrieved_at timestamptz,
  p_register_status public.register_licence_status,
  p_entitlement_to_practise boolean,
  p_discipline_suspended boolean,
  p_discipline_revoked boolean,
  p_discipline_restricted boolean,
  p_proof_locator text,
  p_notes text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  credential public.consultant_credentials%rowtype;
  host text;
  check_id uuid;
  result public.licence_check_result;
  new_status public.credential_status;
  review_at timestamptz;
  interval_known interval;
begin
  if actor is null or app.staff_mfa_satisfied() is distinct from true
     or app.mfa_step_up_satisfied() is distinct from true then
    raise exception 'a licence check requires a recent step-up' using errcode = '42501';
  end if;
  select * into credential from public.consultant_credentials where id = p_credential_id;
  if credential.id is null then
    raise exception 'licence check denied' using errcode = '42501';
  end if;
  if not (
    (app.in_active_org(credential.organization_id)
      and app.has_org_role(credential.organization_id, array['firm_owner']::public.org_role[]))
    or app.is_platform_admin()
  ) then
    raise exception 'licence check denied' using errcode = '42501';
  end if;

  host := app.cicc_register_host(p_source_url);
  if host is null then
    raise exception 'licence evidence must cite register.college-ic.ca' using errcode = '22023';
  end if;
  if p_retrieved_at is null or p_retrieved_at > statement_timestamp() + interval '5 minutes' then
    raise exception 'retrieval time is missing or in the future' using errcode = '22023';
  end if;
  if p_proof_locator is null or length(btrim(p_proof_locator)) not between 1 and 500 then
    raise exception 'a proof file reference is required' using errcode = '22023';
  end if;
  if p_register_status is null or p_entitlement_to_practise is null
     or p_discipline_suspended is null or p_discipline_revoked is null
     or p_discipline_restricted is null then
    raise exception 'register status, entitlement, and discipline flags are required' using errcode = '22023';
  end if;

  -- Precedence matches src/modules/firm-onboarding/licence.ts.
  -- Revoked, then suspended, then inactive, then not entitled, otherwise verified.
  -- discipline_restricted is stored and does not change this result.
  if p_discipline_revoked then
    result := 'revoked';
    new_status := 'revoked';
  elsif p_discipline_suspended then
    result := 'suspended';
    new_status := 'suspended';
  elsif p_register_status = 'inactive' then
    result := 'inactive';
    new_status := 'inactive';
  elsif p_entitlement_to_practise is distinct from true then
    result := 'not_entitled';
    new_status := 'not_entitled';
  else
    result := 'verified';
    new_status := 'verified';
  end if;

  interval_known := app.product_setting_interval('licence.recheck_interval');
  review_at := case
    when interval_known is null then null
    else p_retrieved_at + interval_known
  end;

  insert into public.credential_checks (
    organization_id, credential_id, source_url, source_host, retrieved_at, result,
    proof_locator, register_status, entitlement_to_practise,
    discipline_suspended, discipline_revoked, discipline_restricted,
    reviewer_user_id, notes
  ) values (
    credential.organization_id,
    credential.id,
    p_source_url,
    host,
    p_retrieved_at,
    result,
    btrim(p_proof_locator),
    p_register_status,
    p_entitlement_to_practise,
    p_discipline_suspended,
    p_discipline_revoked,
    p_discipline_restricted,
    actor,
    nullif(btrim(coalesce(p_notes, '')), '')
  )
  returning id into check_id;

  update public.consultant_credentials
     set status = new_status,
         source_url = p_source_url,
         register_status = p_register_status,
         entitlement_to_practise = p_entitlement_to_practise,
         discipline_suspended = p_discipline_suspended,
         discipline_revoked = p_discipline_revoked,
         discipline_restricted = p_discipline_restricted,
         verification_method = 'manual_public_register',
         proof_locator = btrim(p_proof_locator),
         checked_at = p_retrieved_at,
         next_review_at = review_at,
         reviewer_user_id = actor
   where id = credential.id;

  perform app.sync_firm_verification(credential.organization_id);

  perform app.enqueue_licence_event(
    credential.organization_id,
    credential.id,
    'licence.recheck_due',
    jsonb_build_object(
      'credential_id', credential.id,
      'check_id', check_id,
      'method', 'manual_public_register',
      'interval_configured', interval_known is not null
    ),
    'licence.recheck_due:' || check_id::text,
    coalesce(review_at, statement_timestamp())
  );

  if new_status in ('revoked', 'suspended', 'inactive') then
    perform app.enqueue_licence_event(
      credential.organization_id,
      credential.id,
      'licence.adverse_status',
      jsonb_build_object(
        'credential_id', credential.id,
        'check_id', check_id,
        'status', new_status,
        'result', result
      ),
      'licence.adverse_status:' || check_id::text,
      statement_timestamp()
    );
  end if;

  perform app.record_audit_event(
    credential.organization_id,
    'licence.check_recorded',
    'public.credential_checks',
    check_id,
    'success',
    jsonb_build_object(
      'result', result,
      'status', new_status,
      'method', 'manual_public_register',
      'source_host', host,
      'register_status', p_register_status,
      'entitlement_to_practise', p_entitlement_to_practise,
      'discipline_suspended', p_discipline_suspended,
      'discipline_revoked', p_discipline_revoked,
      'discipline_restricted', p_discipline_restricted
    )
  );
  return check_id;
end;
$$;
revoke all on function app.record_licence_check(uuid, text, timestamptz, public.register_licence_status, boolean, boolean, boolean, boolean, text, text) from public;

-- ---------------------------------------------------------------------------
-- Real client invitations stay locked until the firm is verified, a licence
-- check is in good standing, and the six sample proofs are recorded.
-- ---------------------------------------------------------------------------
create function app.real_client_invite_blockers(p_org uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  blockers text[] := array[]::text[];
  status public.org_verification_status;
  proof_step public.sample_proof_step;
begin
  select verification_status into status from public.organizations where id = p_org;
  if status is null then
    return array['firm_not_found']::text[];
  end if;
  if status is distinct from 'verified' then
    blockers := array_append(blockers, 'firm_unverified');
  end if;
  if app.firm_has_verified_licence(p_org) is distinct from true then
    blockers := array_append(blockers, 'licence_not_verified');
  end if;
  foreach proof_step in array enum_range(null::public.sample_proof_step) loop
    if not exists (
      select 1 from public.sample_proof_steps proof
      where proof.organization_id = p_org
        and proof.step = proof_step
    ) then
      blockers := array_append(blockers, 'sample_step_missing:' || proof_step::text);
    end if;
  end loop;
  return blockers;
end;
$$;
revoke all on function app.real_client_invite_blockers(uuid) from public;
grant execute on function app.real_client_invite_blockers(uuid) to authenticated, service_role;

create function app.assert_real_client_invite_allowed(p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  blockers text[];
begin
  if app.in_active_org(p_org) is distinct from true
     or app.has_org_role(p_org, array['firm_owner']::public.org_role[]) is distinct from true
     or app.staff_mfa_satisfied() is distinct from true then
    raise exception 'real client invitation check denied' using errcode = '42501';
  end if;
  blockers := app.real_client_invite_blockers(p_org);
  if cardinality(blockers) > 0 then
    perform app.record_audit_event(
      p_org,
      'invitation.real_client_blocked',
      'public.organizations',
      p_org,
      'denied',
      jsonb_build_object('blockers', to_jsonb(blockers))
    );
    raise exception 'real client invitations are locked' using errcode = '42501';
  end if;
end;
$$;
comment on function app.assert_real_client_invite_allowed(uuid) is
  'T021 calls this before a client invitation. Staff invitations are a different function and stay available during setup. The denial audit is written by public.evaluate_real_client_invites so it survives the error.';
revoke all on function app.assert_real_client_invite_allowed(uuid) from public;

-- The assert above raises, which would roll the audit back. The public
-- evaluator catches that and writes the denial audit in the handler.
create function public.evaluate_real_client_invites(p_organization_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  blockers text[];
begin
  if app.in_active_org(p_organization_id) is distinct from true
     or app.staff_mfa_satisfied() is distinct from true
     or app.has_org_role(p_organization_id, array['firm_owner']::public.org_role[]) is distinct from true then
    raise exception 'real client invitation check denied' using errcode = '42501';
  end if;
  blockers := app.real_client_invite_blockers(p_organization_id);
  if cardinality(blockers) > 0 then
    perform app.record_audit_event(
      p_organization_id,
      'invitation.real_client_blocked',
      'public.organizations',
      p_organization_id,
      'denied',
      jsonb_build_object('blockers', to_jsonb(blockers))
    );
    return jsonb_build_object('unlocked', false, 'blockers', to_jsonb(blockers));
  end if;
  return jsonb_build_object('unlocked', true, 'blockers', '[]'::jsonb);
end;
$$;
revoke all on function public.evaluate_real_client_invites(uuid) from public, anon;
grant execute on function public.evaluate_real_client_invites(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Setup wizard, offices, sample proofs, sample mode.
-- ---------------------------------------------------------------------------
create function app.normalize_email(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when lower(btrim(coalesce(p_email, ''))) ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
     and length(lower(btrim(p_email))) <= 320
    then lower(btrim(p_email))
    else null
  end;
$$;
revoke all on function app.normalize_email(text) from public;

create function app.save_firm_setup(p_step public.firm_setup_step, p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid := app.current_organization_id();
  email text;
  billing_email text;
  locale text;
  zone text;
  codes text[];
  code text;
  years integer;
begin
  perform app.require_firm_owner_step_up(org);
  if p_payload is null or jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception 'setup payload is required' using errcode = '22023';
  end if;

  if p_step = 'firm_profile' then
    locale := p_payload ->> 'locale';
    zone := btrim(coalesce(p_payload ->> 'timezone', ''));
    if locale not in ('en-CA', 'fr-CA') or zone !~ '^[A-Za-z_]+(/[A-Za-z_]+){1,2}$' then
      raise exception 'locale or timezone is not usable' using errcode = '22023';
    end if;
    if length(btrim(coalesce(p_payload ->> 'legal_name', ''))) not between 1 and 300
       or length(btrim(coalesce(p_payload ->> 'display_name', ''))) not between 1 and 200 then
      raise exception 'firm name is required' using errcode = '22023';
    end if;
    update public.organizations
       set legal_name = btrim(p_payload ->> 'legal_name'),
           display_name = btrim(p_payload ->> 'display_name'),
           default_locale = locale,
           timezone = zone
     where id = org;
  elsif p_step = 'offices' then
    if not exists (select 1 from public.organization_offices office where office.organization_id = org) then
      raise exception 'add an office before completing this step' using errcode = '22023';
    end if;
  elsif p_step = 'jurisdictions' then
    select coalesce(array_agg(value), array[]::text[]) into codes
    from jsonb_array_elements_text(coalesce(p_payload -> 'codes', '[]'::jsonb)) as t(value);
    if cardinality(codes) < 1 then
      raise exception 'choose at least one jurisdiction code' using errcode = '22023';
    end if;
    foreach code in array codes loop
      if code !~ '^[A-Z]{2}$' then
        raise exception 'jurisdiction codes are two letters' using errcode = '22023';
      end if;
    end loop;
    update public.organizations set jurisdiction_codes = codes where id = org;
  elsif p_step = 'privacy_and_terms' then
    if (p_payload ->> 'accepted') is distinct from 'true' then
      raise exception 'terms must be accepted' using errcode = '22023';
    end if;
    email := app.normalize_email(p_payload ->> 'privacy_contact_email');
    billing_email := app.normalize_email(p_payload ->> 'billing_contact_email');
    if email is null or billing_email is null
       or length(btrim(coalesce(p_payload ->> 'privacy_contact_name', ''))) not between 1 and 200
       or length(btrim(coalesce(p_payload ->> 'billing_contact_name', ''))) not between 1 and 200
       or length(btrim(coalesce(p_payload ->> 'dpa_version', ''))) not between 1 and 40
       or length(btrim(coalesce(p_payload ->> 'subscription_terms_version', ''))) not between 1 and 40 then
      raise exception 'privacy contact, billing contact, and terms versions are required' using errcode = '22023';
    end if;
    update public.organizations
       set privacy_contact_name = btrim(p_payload ->> 'privacy_contact_name'),
           privacy_contact_email = email,
           billing_contact_name = btrim(p_payload ->> 'billing_contact_name'),
           billing_contact_email = billing_email,
           dpa_version = btrim(p_payload ->> 'dpa_version'),
           dpa_accepted_at = statement_timestamp(),
           subscription_terms_version = btrim(p_payload ->> 'subscription_terms_version'),
           subscription_terms_accepted_at = statement_timestamp()
     where id = org;
  elsif p_step = 'branding' then
    if (p_payload ->> 'acknowledged') is distinct from 'true' then
      raise exception 'branding step must be acknowledged' using errcode = '22023';
    end if;
    if p_payload ? 'accent' and (p_payload ->> 'accent') !~ '^#[0-9A-Fa-f]{6}$' then
      raise exception 'accent must be a hex colour' using errcode = '22023';
    end if;
    update public.organizations
       set branding = jsonb_strip_nulls(jsonb_build_object(
         'logo_locator', nullif(btrim(coalesce(p_payload ->> 'logo_locator', '')), ''),
         'accent', nullif(p_payload ->> 'accent', '')
       ))
     where id = org;
  elsif p_step = 'retention' then
    begin
      years := (p_payload ->> 'count')::integer;
    exception when others then
      years := null;
    end;
    if (p_payload ->> 'unit') is distinct from 'years' or years is null or years not between 1 and 100 then
      raise exception 'retention is a firm-chosen number of years' using errcode = '22023';
    end if;
    update public.organizations
       set retention_policy = jsonb_build_object('unit', 'years', 'count', years)
     where id = org;
  elsif p_step = 'continuity' then
    email := app.normalize_email(p_payload ->> 'contact_email');
    if email is null
       or length(btrim(coalesce(p_payload ->> 'contact_name', ''))) not between 1 and 200
       or length(btrim(coalesce(p_payload ->> 'succession_note', ''))) not between 8 and 2000 then
      raise exception 'continuity contact and succession note are required' using errcode = '22023';
    end if;
    update public.organizations
       set continuity_contact_name = btrim(p_payload ->> 'contact_name'),
           continuity_contact_email = email,
           succession_note = btrim(p_payload ->> 'succession_note')
     where id = org;
  elsif p_step = 'licence' then
    if not exists (
      select 1 from public.consultant_credentials credential
      where credential.organization_id = org
    ) then
      raise exception 'declare a consultant licence before completing this step' using errcode = '22023';
    end if;
  end if;

  insert into public.organization_setup_steps (organization_id, step, completed_by)
  values (org, p_step, (select auth.uid()))
  on conflict (organization_id, step) do update
    set completed_at = statement_timestamp(),
        completed_by = excluded.completed_by;

  perform app.record_audit_event(
    org,
    'firm.setup_step_completed',
    'public.organization_setup_steps',
    org,
    'success',
    jsonb_build_object('step', p_step)
  );
end;
$$;
revoke all on function app.save_firm_setup(public.firm_setup_step, jsonb) from public;

create function app.save_organization_office(
  p_label text,
  p_address_line text,
  p_locality text,
  p_region text,
  p_postal_code text,
  p_country_code text,
  p_is_primary boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid := app.current_organization_id();
  office_id uuid;
  country text := upper(btrim(coalesce(p_country_code, 'CA')));
begin
  perform app.require_firm_owner_step_up(org);
  if length(btrim(coalesce(p_label, ''))) not between 1 and 120
     or length(btrim(coalesce(p_address_line, ''))) not between 1 and 300
     or length(btrim(coalesce(p_locality, ''))) not between 1 and 120
     or country !~ '^[A-Z]{2}$' then
    raise exception 'office address is incomplete' using errcode = '22023';
  end if;
  if coalesce(p_is_primary, false) then
    update public.organization_offices
       set is_primary = false
     where organization_id = org
       and is_primary;
  end if;
  insert into public.organization_offices (
    organization_id, label, address_line, locality, region, postal_code, country_code, is_primary
  ) values (
    org,
    btrim(p_label),
    btrim(p_address_line),
    btrim(p_locality),
    nullif(btrim(coalesce(p_region, '')), ''),
    nullif(btrim(coalesce(p_postal_code, '')), ''),
    country,
    coalesce(p_is_primary, false)
  )
  returning id into office_id;
  return office_id;
end;
$$;
revoke all on function app.save_organization_office(text, text, text, text, text, text, boolean) from public;

create function app.complete_sample_proof(p_step public.sample_proof_step, p_matter_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid := app.current_organization_id();
  sample boolean;
begin
  perform app.require_firm_owner_step_up(org);
  select matter.is_sample into sample
  from public.matters matter
  where matter.id = p_matter_id
    and matter.organization_id = org;
  if sample is distinct from true then
    raise exception 'sample proof must cite a sample matter' using errcode = '22023';
  end if;
  insert into public.sample_proof_steps (organization_id, step, sample_matter_id, completed_by)
  values (org, p_step, p_matter_id, (select auth.uid()))
  on conflict (organization_id, step) do nothing;
  perform app.record_audit_event(
    org,
    'firm.sample_proof_recorded',
    'public.sample_proof_steps',
    p_matter_id,
    'success',
    jsonb_build_object('step', p_step, 'sample', true)
  );
end;
$$;
revoke all on function app.complete_sample_proof(public.sample_proof_step, uuid) from public;

create function app.set_sample_mode(p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid := app.current_organization_id();
  blockers text[];
begin
  perform app.require_firm_owner_step_up(org);
  if p_enabled is false then
    blockers := app.real_client_invite_blockers(org);
    if cardinality(blockers) > 0 then
      raise exception 'sample mode stays on until real client invitations unlock' using errcode = '42501';
    end if;
  end if;
  update public.organizations set sample_mode = p_enabled where id = org;
  perform app.record_audit_event(
    org,
    'firm.sample_mode_changed',
    'public.organizations',
    org,
    'success',
    jsonb_build_object('sample_mode', p_enabled)
  );
end;
$$;
revoke all on function app.set_sample_mode(boolean) from public;

create function app.sync_trial_status(p_org uuid)
returns public.subscription_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  sub public.organization_subscriptions%rowtype;
begin
  select * into sub from public.organization_subscriptions where organization_id = p_org;
  if sub.organization_id is null then
    return null;
  end if;
  if sub.status = 'trial' and sub.trial_ends_at is not null and sub.trial_ends_at <= statement_timestamp() then
    update public.organization_subscriptions
       set status = 'trial_ended'
     where organization_id = p_org
       and status = 'trial';
    return 'trial_ended';
  end if;
  return sub.status;
end;
$$;
comment on function app.sync_trial_status(uuid) is
  'Marks an elapsed trial trial_ended. Does not delete people, matters, or audit rows, and does not by itself lock invitations.';
revoke all on function app.sync_trial_status(uuid) from public;

-- ---------------------------------------------------------------------------
-- Revoked, suspended, or inactive licence locks new matters and regulated stage changes.
-- Reads stay open. The audited entry points catch the error and keep the audit.
-- ---------------------------------------------------------------------------
create function app.guard_new_matter_licence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and app.actor_licence_blocks_regulated_action(new.organization_id) then
    raise exception 'revoked, suspended, or inactive licence blocks this consultant action' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.guard_new_matter_licence() from public;

create trigger matters_licence_lock before insert on public.matters
  for each row execute function app.guard_new_matter_licence();

create or replace function app.transition_matter_stage(
  p_matter_id uuid,
  p_to_stage public.matter_stage,
  p_expected_version integer,
  p_reason text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  matter public.matters%rowtype;
  evidence uuid;
  new_version integer;
begin
  if (select auth.uid()) is null then
    raise exception 'sign in is required' using errcode = '42501';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'a stage change needs a reason' using errcode = '22023';
  end if;

  select * into matter
  from public.matters
  where id = p_matter_id
  for update;

  if matter.id is null
     or app.in_active_org(matter.organization_id) is distinct from true
     or app.staff_mfa_satisfied() is distinct from true
     or app.can_read_matter(matter.id) is distinct from true
     or app.has_org_role(
       matter.organization_id,
       array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[]
     ) is distinct from true then
    raise exception 'matter stage change denied' using errcode = '42501';
  end if;
  if matter.version is distinct from p_expected_version then
    raise exception 'matter version conflict' using errcode = '40001';
  end if;
  if app.matter_stage_is_regulated(matter.stage, p_to_stage)
     and app.has_org_role(
       matter.organization_id,
       array['licensed_consultant']::public.org_role[]
     ) is distinct from true then
    raise exception 'submitted and later stages require a licensed consultant' using errcode = '42501';
  end if;
  if app.matter_stage_is_regulated(matter.stage, p_to_stage)
     and app.actor_licence_blocks_regulated_action(matter.organization_id) then
    raise exception 'revoked, suspended, or inactive licence blocks this consultant action' using errcode = '42501';
  end if;
  if app.matter_stage_transition_allowed(matter.stage, p_to_stage) is distinct from true then
    raise exception 'that stage transition is not allowed' using errcode = '42501';
  end if;

  evidence := app.stage_entry_evidence_id(matter.id, p_to_stage);
  if evidence is null then
    raise exception 'stage entry evidence is missing' using errcode = '42501';
  end if;

  insert into app.matter_stage_transition_nonce (matter_id, txid)
  values (matter.id, txid_current())
  on conflict (matter_id) do update set txid = excluded.txid;

  update public.matters
  set stage = p_to_stage
  where id = matter.id
  returning version into new_version;

  delete from app.matter_stage_transition_nonce where matter_id = matter.id;

  insert into public.matter_stage_transitions (
    organization_id, matter_id, from_stage, to_stage, reason, evidence_id, actor_user_id, from_version
  ) values (
    matter.organization_id,
    matter.id,
    matter.stage,
    p_to_stage,
    btrim(p_reason),
    evidence,
    (select auth.uid()),
    matter.version
  );

  perform app.record_audit_event(
    matter.organization_id,
    case when matter.stage = 'closed' and p_to_stage = 'engagement_pending'
      then 'matter.reopened'
      else 'matter.stage_transition'
    end,
    'public.matters',
    matter.id,
    'success',
    jsonb_build_object(
      'from_stage', matter.stage,
      'to_stage', p_to_stage,
      'evidence_id', evidence
    )
  );
  return new_version;
end;
$$;

create function public.attempt_matter_stage_transition(
  p_matter_id uuid,
  p_to_stage public.matter_stage,
  p_expected_version integer,
  p_reason text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  new_version integer;
  org uuid;
  blocked public.credential_status;
begin
  new_version := app.transition_matter_stage(p_matter_id, p_to_stage, p_expected_version, p_reason);
  return jsonb_build_object('ok', true, 'version', new_version);
exception
  when insufficient_privilege then
    if sqlerrm ilike '%licence blocks%' then
      select matter.organization_id into org from public.matters matter where matter.id = p_matter_id;
      blocked := app.actor_licence_block_status(org);
      perform app.record_audit_event(
        org,
        'licence.regulated_action_blocked',
        'public.matters',
        p_matter_id,
        'denied',
        jsonb_build_object('action', 'matter.stage_transition', 'to_stage', p_to_stage, 'credential_status', blocked)
      );
      return jsonb_build_object('ok', false, 'blocked', 'licence', 'credential_status', blocked);
    end if;
    raise;
end;
$$;
revoke all on function public.attempt_matter_stage_transition(uuid, public.matter_stage, integer, text) from public, anon;
grant execute on function public.attempt_matter_stage_transition(uuid, public.matter_stage, integer, text) to authenticated, service_role;

-- Invoker so the sample-mode guard sees the caller. The id is assigned here:
-- INSERT RETURNING would also apply matters_select, and can_read_matter reads the
-- new row before that insert is visible, so RETURNING fails closed for every role.
create function public.create_practice_matter(p_title text, p_is_sample boolean)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  org uuid := app.current_organization_id();
  new_id uuid := gen_random_uuid();
  blocked public.credential_status;
begin
  if org is null or app.staff_mfa_satisfied() is distinct from true then
    raise exception 'matter create denied' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_title, ''))) not between 1 and 200 then
    raise exception 'matter title is required' using errcode = '22023';
  end if;
  insert into public.matters (id, organization_id, title, is_sample)
  values (new_id, org, btrim(p_title), coalesce(p_is_sample, false));
  return jsonb_build_object('ok', true, 'id', new_id);
exception
  when insufficient_privilege then
    if sqlerrm ilike '%licence blocks%' then
      blocked := app.actor_licence_block_status(org);
      perform app.record_audit_event(
        org,
        'licence.regulated_action_blocked',
        'public.matters',
        null,
        'denied',
        jsonb_build_object('action', 'matter.create', 'credential_status', blocked)
      );
      return jsonb_build_object('ok', false, 'blocked', 'licence', 'credential_status', blocked);
    end if;
    raise;
end;
$$;
revoke all on function public.create_practice_matter(text, boolean) from public, anon;
grant execute on function public.create_practice_matter(text, boolean) to authenticated, service_role;

create function app.reassign_consultant_matters(
  p_from_membership uuid,
  p_to_membership uuid,
  p_reason text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid := app.current_organization_id();
  source public.memberships%rowtype;
  target public.memberships%rowtype;
  target_status public.credential_status;
  moved integer := 0;
  rec record;
begin
  perform app.require_firm_owner_step_up(org);
  if p_reason is null or length(btrim(p_reason)) < 8 then
    raise exception 'reassignment needs a reason' using errcode = '22023';
  end if;
  select * into source from public.memberships where id = p_from_membership and organization_id = org;
  select * into target from public.memberships where id = p_to_membership and organization_id = org;
  if source.id is null or target.id is null
     or source.role is distinct from 'licensed_consultant'
     or target.role is distinct from 'licensed_consultant'
     or source.status is distinct from 'active'
     or target.status is distinct from 'active'
     or source.id = target.id then
    raise exception 'reassignment denied' using errcode = '42501';
  end if;
  select credential.status into target_status
  from public.consultant_credentials credential
  where credential.membership_id = target.id;
  if target_status is distinct from 'verified' or app.licence_status_blocks(target_status) then
    raise exception 'the receiving consultant needs a verified licence' using errcode = '42501';
  end if;

  for rec in
    select participant.id, participant.matter_id
    from public.matter_participants participant
    where participant.organization_id = org
      and participant.membership_id = source.id
      and participant.role = 'consultant'
  loop
    if exists (
      select 1 from public.matter_participants existing
      where existing.matter_id = rec.matter_id
        and existing.membership_id = target.id
        and existing.role = 'consultant'
    ) then
      delete from public.matter_participants where id = rec.id;
    else
      update public.matter_participants
         set membership_id = target.id
       where id = rec.id;
    end if;
    moved := moved + 1;
  end loop;

  perform app.record_audit_event(
    org,
    'licence.matters_reassigned',
    'public.memberships',
    source.id,
    'success',
    jsonb_build_object('to_membership_id', target.id, 'count', moved)
  );
  return moved;
end;
$$;
revoke all on function app.reassign_consultant_matters(uuid, uuid, text) from public;

create function app.set_product_setting(p_key text, p_value jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  unit text;
  count integer;
begin
  if app.is_platform_admin() is distinct from true
     or app.mfa_step_up_satisfied() is distinct from true then
    raise exception 'product settings require a platform admin step-up' using errcode = '42501';
  end if;
  if not exists (select 1 from public.product_settings where key = p_key) then
    raise exception 'unknown product setting' using errcode = '22023';
  end if;
  unit := p_value ->> 'unit';
  begin
    count := (p_value ->> 'count')::integer;
  exception when others then
    count := null;
  end;
  if p_key = 'licence.manual_check_target' and unit is distinct from 'business_days' then
    raise exception 'manual check target uses business_days' using errcode = '22023';
  end if;
  if p_key = 'trial.duration' and unit not in ('days', 'months') then
    raise exception 'trial duration uses days or months' using errcode = '22023';
  end if;
  if p_key = 'licence.recheck_interval' and unit not in ('days', 'months') then
    raise exception 'recheck interval uses days or months' using errcode = '22023';
  end if;
  if count is null or count < 1 or count > 3650 then
    raise exception 'setting count is not usable' using errcode = '22023';
  end if;
  update public.product_settings
     set value = jsonb_build_object('unit', unit, 'count', count),
         pending_confirmation = true
   where key = p_key;
  perform app.record_audit_event(
    null,
    'product.setting_changed',
    'public.product_settings',
    null,
    'success',
    jsonb_build_object('key', p_key, 'unit', unit, 'count', count)
  );
end;
$$;
comment on function app.set_product_setting(text, jsonb) is
  'Changes a platform setting for later trials and re-checks. Does not rewrite an existing trial duration snapshot.';
revoke all on function app.set_product_setting(text, jsonb) from public;

-- Billing and export skip sample rows. Sample data is not client revenue.
create or replace function app.perform_billing_action(p_matter_id uuid, p_action text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid;
  sample boolean;
  audit_id uuid;
begin
  if p_action not in ('issue_invoice', 'approve_earned_fee_transfer') then
    raise exception 'unknown billing action' using errcode = '22023';
  end if;
  if (select auth.uid()) is null or app.can_perform_billing(p_matter_id, p_action) is distinct from true then
    raise exception 'billing access denied' using errcode = '42501';
  end if;
  select matter.organization_id, matter.is_sample into org, sample
  from public.matters matter
  where matter.id = p_matter_id;
  if sample is true then
    raise exception 'sample data is excluded from billing' using errcode = '42501';
  end if;
  audit_id := app.record_audit_event(
    org,
    'billing.' || p_action,
    'public.matters',
    p_matter_id,
    'success',
    jsonb_build_object('action', p_action)
  );
  return audit_id;
end;
$$;

create or replace function public.list_matter_billing()
returns table (
  matter_id uuid,
  organization_id uuid,
  title text,
  stage public.matter_stage,
  client_display_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    matter.id,
    matter.organization_id,
    matter.title,
    matter.stage,
    (
      select string_agg(person.display_name, ', ' order by person.display_name)
      from public.matter_participants mp
      join public.persons person
        on person.id = mp.person_id
       and person.organization_id = mp.organization_id
      where mp.matter_id = matter.id
        and mp.organization_id = matter.organization_id
        and mp.role = 'applicant'
        and person.is_sample is false
    ) as client_display_name
  from public.matters matter
  where matter.is_sample is false
    and app.can_read_matter_billing(matter.id);
$$;
comment on function public.list_matter_billing() is
  'Billing projection of real matters only. Sample rows are excluded. No person email or narrative.';

create function public.list_exportable_matter_ids()
returns table (matter_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select matter.id
  from public.matters matter
  where matter.is_sample is false
    and app.can_read_matter(matter.id);
$$;
comment on function public.list_exportable_matter_ids() is
  'Matter ids a later export may include. Sample matters are never returned.';
revoke all on function public.list_exportable_matter_ids() from public, anon;
grant execute on function public.list_exportable_matter_ids() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Public wrappers.
-- ---------------------------------------------------------------------------
create function public.declare_consultant_credential(
  p_membership_id uuid,
  p_licence_type public.licence_type,
  p_college_id text,
  p_scope_note text,
  p_proof_locator text
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select app.declare_consultant_credential(
    p_membership_id, p_licence_type, p_college_id, p_scope_note, p_proof_locator
  );
$$;

create function public.record_licence_check(
  p_credential_id uuid,
  p_source_url text,
  p_retrieved_at timestamptz,
  p_register_status public.register_licence_status,
  p_entitlement_to_practise boolean,
  p_discipline_suspended boolean,
  p_discipline_revoked boolean,
  p_discipline_restricted boolean,
  p_proof_locator text,
  p_notes text
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select app.record_licence_check(
    p_credential_id, p_source_url, p_retrieved_at, p_register_status,
    p_entitlement_to_practise, p_discipline_suspended, p_discipline_revoked,
    p_discipline_restricted, p_proof_locator, p_notes
  );
$$;

create function public.save_firm_setup(p_step public.firm_setup_step, p_payload jsonb)
returns void
language sql
security invoker
set search_path = ''
as $$
  select app.save_firm_setup(p_step, p_payload);
$$;

create function public.save_organization_office(
  p_label text,
  p_address_line text,
  p_locality text,
  p_region text,
  p_postal_code text,
  p_country_code text,
  p_is_primary boolean
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select app.save_organization_office(
    p_label, p_address_line, p_locality, p_region, p_postal_code, p_country_code, p_is_primary
  );
$$;

create function public.complete_sample_proof(p_step public.sample_proof_step, p_matter_id uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
  select app.complete_sample_proof(p_step, p_matter_id);
$$;

create function public.set_sample_mode(p_enabled boolean)
returns void
language sql
security invoker
set search_path = ''
as $$
  select app.set_sample_mode(p_enabled);
$$;

create function public.sync_trial_status()
returns public.subscription_status
language sql
security invoker
set search_path = ''
as $$
  select app.sync_trial_status(app.current_organization_id());
$$;

create function public.reassign_consultant_matters(
  p_from_membership uuid,
  p_to_membership uuid,
  p_reason text
)
returns integer
language sql
security invoker
set search_path = ''
as $$
  select app.reassign_consultant_matters(p_from_membership, p_to_membership, p_reason);
$$;

create function public.set_product_setting(p_key text, p_value jsonb)
returns void
language sql
security invoker
set search_path = ''
as $$
  select app.set_product_setting(p_key, p_value);
$$;

revoke all on function public.declare_consultant_credential(uuid, public.licence_type, text, text, text) from public, anon;
revoke all on function public.record_licence_check(uuid, text, timestamptz, public.register_licence_status, boolean, boolean, boolean, boolean, text, text) from public, anon;
revoke all on function public.save_firm_setup(public.firm_setup_step, jsonb) from public, anon;
revoke all on function public.save_organization_office(text, text, text, text, text, text, boolean) from public, anon;
revoke all on function public.complete_sample_proof(public.sample_proof_step, uuid) from public, anon;
revoke all on function public.set_sample_mode(boolean) from public, anon;
revoke all on function public.sync_trial_status() from public, anon;
revoke all on function public.reassign_consultant_matters(uuid, uuid, text) from public, anon;
revoke all on function public.set_product_setting(text, jsonb) from public, anon;

grant execute on function app.declare_consultant_credential(uuid, public.licence_type, text, text, text) to authenticated, service_role;
grant execute on function app.record_licence_check(uuid, text, timestamptz, public.register_licence_status, boolean, boolean, boolean, boolean, text, text) to authenticated, service_role;
grant execute on function app.save_firm_setup(public.firm_setup_step, jsonb) to authenticated, service_role;
grant execute on function app.save_organization_office(text, text, text, text, text, text, boolean) to authenticated, service_role;
grant execute on function app.complete_sample_proof(public.sample_proof_step, uuid) to authenticated, service_role;
grant execute on function app.set_sample_mode(boolean) to authenticated, service_role;
grant execute on function app.sync_trial_status(uuid) to authenticated, service_role;
grant execute on function app.reassign_consultant_matters(uuid, uuid, text) to authenticated, service_role;
grant execute on function app.set_product_setting(text, jsonb) to authenticated, service_role;
grant execute on function public.declare_consultant_credential(uuid, public.licence_type, text, text, text) to authenticated, service_role;
grant execute on function public.record_licence_check(uuid, text, timestamptz, public.register_licence_status, boolean, boolean, boolean, boolean, text, text) to authenticated, service_role;
grant execute on function public.save_firm_setup(public.firm_setup_step, jsonb) to authenticated, service_role;
grant execute on function public.save_organization_office(text, text, text, text, text, text, boolean) to authenticated, service_role;
grant execute on function public.complete_sample_proof(public.sample_proof_step, uuid) to authenticated, service_role;
grant execute on function public.set_sample_mode(boolean) to authenticated, service_role;
grant execute on function public.sync_trial_status() to authenticated, service_role;
grant execute on function public.reassign_consultant_matters(uuid, uuid, text) to authenticated, service_role;
grant execute on function public.set_product_setting(text, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Privileges and RLS.
-- ---------------------------------------------------------------------------
revoke all on table public.product_settings from anon, authenticated, service_role;
grant select on table public.product_settings to authenticated, service_role;
grant update on table public.product_settings to service_role;

revoke all on table public.organization_offices from anon, authenticated;
grant select on table public.organization_offices to authenticated;

revoke all on table public.organization_setup_steps from anon, authenticated;
grant select on table public.organization_setup_steps to authenticated;

revoke all on table public.organization_subscriptions from anon, authenticated;
grant select on table public.organization_subscriptions to authenticated;

revoke all on table public.consultant_credentials from anon, authenticated;
grant select on table public.consultant_credentials to authenticated;

revoke all on table public.credential_checks from anon, authenticated;
grant select on table public.credential_checks to authenticated;

revoke all on table public.sample_proof_steps from anon, authenticated;
grant select on table public.sample_proof_steps to authenticated;

alter table public.product_settings enable row level security;
alter table public.product_settings force row level security;
alter table public.organization_offices enable row level security;
alter table public.organization_offices force row level security;
alter table public.organization_setup_steps enable row level security;
alter table public.organization_setup_steps force row level security;
alter table public.organization_subscriptions enable row level security;
alter table public.organization_subscriptions force row level security;
alter table public.consultant_credentials enable row level security;
alter table public.consultant_credentials force row level security;
alter table public.credential_checks enable row level security;
alter table public.credential_checks force row level security;
alter table public.sample_proof_steps enable row level security;
alter table public.sample_proof_steps force row level security;

create policy product_settings_select on public.product_settings
  for select to authenticated
  using (true);
create policy product_settings_update on public.product_settings
  for update to authenticated
  using ((select app.is_platform_admin()))
  with check ((select app.is_platform_admin()));

create policy organization_offices_select on public.organization_offices
  for select to authenticated
  using (
    (select app.in_active_org(organization_id))
    and (select app.is_org_staff(organization_id))
    and (select app.staff_mfa_satisfied())
  );

create policy organization_setup_steps_select on public.organization_setup_steps
  for select to authenticated
  using (
    (select app.in_active_org(organization_id))
    and (select app.is_org_staff(organization_id))
    and (select app.staff_mfa_satisfied())
  );

create policy organization_subscriptions_select on public.organization_subscriptions
  for select to authenticated
  using (
    (select app.in_active_org(organization_id))
    and (select app.is_org_staff(organization_id))
    and (select app.staff_mfa_satisfied())
  );

create policy consultant_credentials_select on public.consultant_credentials
  for select to authenticated
  using (
    (select app.in_active_org(organization_id))
    and (select app.is_org_staff(organization_id))
    and (select app.staff_mfa_satisfied())
  );

create policy credential_checks_select on public.credential_checks
  for select to authenticated
  using (
    (select app.in_active_org(organization_id))
    and (select app.is_org_staff(organization_id))
    and (select app.staff_mfa_satisfied())
  );

create policy sample_proof_steps_select on public.sample_proof_steps
  for select to authenticated
  using (
    (select app.in_active_org(organization_id))
    and (select app.is_org_staff(organization_id))
    and (select app.staff_mfa_satisfied())
  );

-- ---------------------------------------------------------------------------
-- CICC public register catalog. Retrieved 2026-10-17. Not a scraper.
-- The hashes are sha256 of the HTML entry-page responses (dynamic ASP.NET
-- shells). They are not a hash of the register database. Authority dates
-- stay null. A later fetch can hash differently. No RISIA search URL is stored.
-- ---------------------------------------------------------------------------
update public.official_source_domains
   set notes = 'Suffix allowlist includes register.college-ic.ca. Public register entry pages identified 2026-10-17. Not a reviewed professional rule.'
 where host = 'college-ic.ca';

insert into public.official_sources (
  organization_id, publisher, canonical_url, allowed_host, jurisdiction,
  content_kind, discovery_status, title, source_language
) values
  (
    null,
    'College of Immigration and Citizenship Consultants',
    'https://register.college-ic.ca/Public-Register-EN',
    'register.college-ic.ca',
    'CA',
    'other_official',
    'active',
    'CICC Public Register (English)',
    'en'
  ),
  (
    null,
    'College of Immigration and Citizenship Consultants',
    'https://register.college-ic.ca/Public-Register-EN/RCIC_Search.aspx',
    'register.college-ic.ca',
    'CA',
    'other_official',
    'active',
    'CICC Public Register RCIC search',
    'en'
  );

insert into public.source_snapshots (
  source_id, final_url, publisher, retrieved_at, content_hash,
  retrieval_result, http_status, review_status
)
select
  source.id,
  source.canonical_url,
  source.publisher,
  case source.canonical_url
    when 'https://register.college-ic.ca/Public-Register-EN'
      then timestamptz '2026-10-17 12:40:09+00'
    else timestamptz '2026-10-17 12:40:10+00'
  end,
  case source.canonical_url
    when 'https://register.college-ic.ca/Public-Register-EN'
      then '6f67a66ec8943dc1b19a508f0ab64eff0b97958e9639850b005d11e29d4314b7'
    else 'ba9f947c589eefb8ba1baf9f50cc3e4640e79d8d0d4450b93c11920c5de2781c'
  end,
  'success'::public.source_observation,
  200,
  'draft'::public.snapshot_review_status
from public.official_sources source
where source.organization_id is null
  and source.canonical_url in (
    'https://register.college-ic.ca/Public-Register-EN',
    'https://register.college-ic.ca/Public-Register-EN/RCIC_Search.aspx'
  );
