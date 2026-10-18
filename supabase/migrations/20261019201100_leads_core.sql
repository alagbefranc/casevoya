-- Leads: the firm's pipeline of prospects before engagement (PRD §7 lead lifecycle, CRM-01, CRM-02,
-- with links to CRM-03 bookings and the matter a lead converts into).
--
--   lead_stages              the firm's pipeline columns. Names and order are configurable rows;
--                            `kind` (open, converted, lost, archived) is what the database acts on.
--                            Every firm gets the PRD §7 lifecycle as its starting stages.
--   leads                    one prospect enquiry. Contact, source, service interest, country,
--                            language, owner, proposed fee, tags, conflict-screen outcome, lost reason
--                            (stored separately, PRD §7), the matter and person it converted into.
--                            Multiple leads may point at one person (`same_person_lead_id`) without
--                            creating or merging people (PRD §7, CRM-02).
--   lead_events              append-only history: stage moves, assignment, conflict screen,
--                            conversion, close, reopen, booking links, duplicate decisions.
--   lead_notes               append-only notes.
--   lead_follow_ups          follow-up tasks on a lead (owner, due date, done).
--   lead_consents            append-only consent evidence per purpose. A reply consent
--                            (`enquiry_reply`, transactional) and a marketing consent are separate
--                            rows; the latest row per purpose is the current answer (CASL, OPS-05).
--   lead_booking_links       a booking (CRM-03) that belongs to a lead. One lead per booking.
--   lead_duplicate_decisions a staff member's answer to a duplicate suggestion (same person or
--                            different people), so a dismissed suggestion does not come back.
--   lead_enquiry_attempts    rate-limit counter for the public enquiry function. No API read.
--
-- Operational staff (owner, consultant, case manager, assistant; not finance) of the active firm,
-- with staff MFA, read leads through forced RLS. Every write goes through a SECURITY DEFINER
-- function (20261019201200) with search_path = ''. No table has a write grant. Additive only.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create function app.lead_staff_roles()
returns public.org_role[]
language sql
immutable
set search_path = ''
as $$
  select array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[];
$$;
revoke all on function app.lead_staff_roles() from public;

create function app.can_read_leads(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.in_active_org(p_org)
     and app.staff_mfa_satisfied()
     and app.has_org_role(p_org, app.lead_staff_roles());
$$;
revoke all on function app.can_read_leads(uuid) from public;
grant execute on function app.can_read_leads(uuid) to authenticated, service_role;

-- A name for matching: lower case, accents and punctuation ignored, spaces collapsed.
create function app.lead_match_name(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(btrim(regexp_replace(lower(translate(coalesce(p_name, ''),
    'ÀÁÂÃÄÅàáâãäåÇçÈÉÊËèéêëÌÍÎÏìíîïÑñÒÓÔÕÖØòóôõöøÙÚÛÜùúûüÝýÿ',
    'AAAAAAaaaaaaCcEEEEeeeeIIIIiiiiNnOOOOOOooooooUUUUuuuuYyy')), '[^a-z0-9]+', ' ', 'g')), '');
$$;
revoke all on function app.lead_match_name(text) from public;

-- Digits only, the last ten, for matching phone numbers written differently.
create function app.lead_match_phone(p_phone text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(right(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), 10), '');
$$;
revoke all on function app.lead_match_phone(text) from public;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.lead_stages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  label text not null check (length(btrim(label)) between 1 and 60),
  kind public.lead_stage_kind not null,
  position smallint not null check (position between 1 and 50),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (organization_id, key),
  unique (id, organization_id),
  check (kind = 'open' or archived_at is null)
);
comment on table public.lead_stages is
  'A firm''s pipeline stages. Labels and order are the firm''s; kind is what the database acts on. Exactly one live converted, lost and archived stage per firm.';
create unique index lead_stages_one_terminal_uidx on public.lead_stages (organization_id, kind) where kind <> 'open';
create index lead_stages_created_by_idx on public.lead_stages (created_by);

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  display_name text not null check (length(btrim(display_name)) between 1 and 200),
  email text check (email is null or (email = lower(email) and length(email) between 3 and 320 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  phone text check (phone is null or (length(phone) <= 40 and phone ~ '^[0-9+() .-]{3,40}$')),
  preferred_contact text check (preferred_contact is null or preferred_contact in ('email', 'phone')),
  service_interest text check (service_interest is null or length(btrim(service_interest)) between 1 and 120),
  country_now text check (country_now is null or length(btrim(country_now)) between 1 and 100),
  language text check (language is null or length(btrim(language)) between 1 and 100),
  date_of_birth date check (date_of_birth is null or date_of_birth >= date '1900-01-01'),
  source public.lead_source not null,
  source_detail text check (source_detail is null or length(btrim(source_detail)) between 1 and 200),
  stage_id uuid not null,
  owner_membership_id uuid,
  proposed_fee_cents bigint check (proposed_fee_cents is null or proposed_fee_cents between 0 and 99999999),
  currency text not null default 'CAD' check (currency = 'CAD'),
  tags text[] not null default '{}'::text[] check (cardinality(tags) <= 12),
  conflict_result public.lead_conflict_result not null default 'not_checked',
  conflict_note text check (conflict_note is null or length(conflict_note) <= 1000),
  conflict_checked_at timestamptz,
  conflict_checked_by uuid references auth.users (id),
  lost_reason text check (lost_reason is null or length(btrim(lost_reason)) between 1 and 500),
  lost_at timestamptz,
  converted_matter_id uuid,
  converted_person_id uuid,
  converted_at timestamptz,
  same_person_lead_id uuid,
  submission_key text check (submission_key is null or length(submission_key) between 8 and 180),
  is_sample boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id),
  check (email is not null or phone is not null or source in ('phone', 'walk_in', 'referral', 'event', 'other', 'csv_import')),
  check ((lost_at is null) = (lost_reason is null)),
  check ((converted_at is null) = (converted_matter_id is null)),
  check (conflict_result = 'not_checked' or conflict_checked_at is not null),
  check (same_person_lead_id is distinct from id),
  foreign key (stage_id, organization_id) references public.lead_stages (id, organization_id),
  foreign key (owner_membership_id, organization_id) references public.memberships (id, organization_id),
  foreign key (converted_matter_id, organization_id) references public.matters (id, organization_id),
  foreign key (converted_person_id, organization_id) references public.persons (id, organization_id),
  foreign key (same_person_lead_id, organization_id) references public.leads (id, organization_id)
);
comment on table public.leads is
  'A prospect before engagement. Minimal enquiry data only; passports and detailed histories wait for intake (CRM-01). Converting creates a matter through create_client_matter and never merges people.';
create index leads_org_stage_idx on public.leads (organization_id, stage_id);
create index leads_stage_org_fk_idx on public.leads (stage_id, organization_id);
create index leads_owner_org_fk_idx on public.leads (owner_membership_id, organization_id);
create index leads_matter_org_fk_idx on public.leads (converted_matter_id, organization_id);
create index leads_person_org_fk_idx on public.leads (converted_person_id, organization_id);
create index leads_same_person_org_fk_idx on public.leads (same_person_lead_id, organization_id);
create index leads_conflict_checked_by_idx on public.leads (conflict_checked_by);
create index leads_created_by_idx on public.leads (created_by);
create index leads_org_email_idx on public.leads (organization_id, email);
-- One lead per matter it converted into; one lead per public submission (a retried enquiry).
create unique index leads_converted_matter_uidx on public.leads (converted_matter_id) where converted_matter_id is not null;
create unique index leads_submission_key_uidx on public.leads (organization_id, submission_key) where submission_key is not null;

create table public.lead_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  lead_id uuid not null,
  kind text not null check (kind in (
    'created', 'stage_changed', 'updated', 'assigned', 'conflict_checked', 'converted', 'lost', 'reopened',
    'booking_linked', 'duplicate_same', 'duplicate_different', 'consent_recorded', 'follow_up_added', 'follow_up_done'
  )),
  from_stage_id uuid,
  to_stage_id uuid,
  reason text check (reason is null or length(reason) <= 500),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 2000),
  actor_user_id uuid references auth.users (id),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (lead_id, organization_id) references public.leads (id, organization_id),
  foreign key (from_stage_id, organization_id) references public.lead_stages (id, organization_id),
  foreign key (to_stage_id, organization_id) references public.lead_stages (id, organization_id)
);
comment on table public.lead_events is 'Append-only lead history (stage history, assignment, conflict screen, conversion, close).';
create index lead_events_lead_org_fk_idx on public.lead_events (lead_id, organization_id, created_at);
create index lead_events_from_stage_org_fk_idx on public.lead_events (from_stage_id, organization_id);
create index lead_events_to_stage_org_fk_idx on public.lead_events (to_stage_id, organization_id);
create index lead_events_actor_idx on public.lead_events (actor_user_id);

create table public.lead_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  lead_id uuid not null,
  body text not null check (length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid references auth.users (id),
  foreign key (lead_id, organization_id) references public.leads (id, organization_id)
);
comment on table public.lead_notes is 'Append-only notes on a lead.';
create index lead_notes_lead_org_fk_idx on public.lead_notes (lead_id, organization_id, created_at);
create index lead_notes_created_by_idx on public.lead_notes (created_by);

create table public.lead_follow_ups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  lead_id uuid not null,
  title text not null check (length(btrim(title)) between 1 and 200),
  owner_membership_id uuid,
  due_on date,
  completed_at timestamptz,
  completed_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id),
  check ((completed_at is null) = (completed_by is null)),
  foreign key (lead_id, organization_id) references public.leads (id, organization_id),
  foreign key (owner_membership_id, organization_id) references public.memberships (id, organization_id)
);
comment on table public.lead_follow_ups is 'Follow-up tasks on a lead (CRM-02). Not on the Tasks page yet.';
create index lead_follow_ups_lead_org_fk_idx on public.lead_follow_ups (lead_id, organization_id);
create index lead_follow_ups_owner_org_fk_idx on public.lead_follow_ups (owner_membership_id, organization_id);
create index lead_follow_ups_completed_by_idx on public.lead_follow_ups (completed_by);
create index lead_follow_ups_created_by_idx on public.lead_follow_ups (created_by);

create table public.lead_consents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  lead_id uuid not null,
  purpose public.lead_consent_purpose not null,
  granted boolean not null,
  statement_text text not null check (length(statement_text) between 1 and 500),
  statement_sha256 text not null check (statement_sha256 ~ '^[0-9a-f]{64}$'),
  policy_version text check (policy_version is null or policy_version ~ '^[A-Za-z0-9._-]{1,40}$'),
  captured_via text not null check (captured_via in ('web_form', 'hosted_page', 'staff', 'booking_page')),
  recorded_at timestamptz not null default clock_timestamp(),
  created_by uuid references auth.users (id),
  foreign key (lead_id, organization_id) references public.leads (id, organization_id)
);
comment on table public.lead_consents is
  'Append-only consent evidence for a lead. Reply (transactional) and marketing consent are separate purposes; the latest row per purpose is current. A withdrawal is a new row with granted = false.';
create index lead_consents_lead_org_fk_idx on public.lead_consents (lead_id, organization_id, purpose, recorded_at);
create index lead_consents_created_by_idx on public.lead_consents (created_by);

create table public.lead_booking_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  lead_id uuid not null,
  booking_id uuid not null unique,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  foreign key (lead_id, organization_id) references public.leads (id, organization_id),
  foreign key (booking_id, organization_id) references public.bookings (id, organization_id)
);
comment on table public.lead_booking_links is 'A consultation booking (CRM-03) that belongs to a lead. Linked by staff, never by matching an email.';
create index lead_booking_links_lead_org_fk_idx on public.lead_booking_links (lead_id, organization_id);
create index lead_booking_links_booking_org_fk_idx on public.lead_booking_links (booking_id, organization_id);
create index lead_booking_links_created_by_idx on public.lead_booking_links (created_by);

create table public.lead_duplicate_decisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  lead_id uuid not null,
  other_lead_id uuid not null,
  same_person boolean not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  unique (lead_id, other_lead_id),
  check (lead_id < other_lead_id),
  foreign key (lead_id, organization_id) references public.leads (id, organization_id),
  foreign key (other_lead_id, organization_id) references public.leads (id, organization_id)
);
comment on table public.lead_duplicate_decisions is
  'A person''s answer to a duplicate suggestion. Same person links the leads under one person; nothing is merged or deleted.';
create index lead_duplicate_decisions_lead_org_fk_idx on public.lead_duplicate_decisions (lead_id, organization_id);
create index lead_duplicate_decisions_other_org_fk_idx on public.lead_duplicate_decisions (other_lead_id, organization_id);
create index lead_duplicate_decisions_created_by_idx on public.lead_duplicate_decisions (created_by);

create table public.lead_enquiry_attempts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  client_hash text check (client_hash is null or client_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);
comment on table public.lead_enquiry_attempts is
  'Rate-limit counter for public enquiries. Stores a hash of the client address, never the address. No API read.';
create index lead_enquiry_attempts_org_idx on public.lead_enquiry_attempts (organization_id, created_at);
create index lead_enquiry_attempts_client_idx on public.lead_enquiry_attempts (client_hash, created_at);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

create function app.reject_lead_history_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'lead history is append-only' using errcode = '42501';
end;
$$;
revoke all on function app.reject_lead_history_change() from public;

create trigger lead_stages_touch before update on public.lead_stages
  for each row execute function app.touch_row();
create trigger lead_stages_stamp before insert on public.lead_stages
  for each row execute function app.stamp_created_by();
create trigger lead_stages_keys before update on public.lead_stages
  for each row execute function app.guard_tenant_keys();
create trigger lead_stages_audit after insert or update or delete on public.lead_stages
  for each row execute function app.audit_row_change();
create trigger lead_stages_no_delete before delete on public.lead_stages
  for each row execute function app.reject_governed_delete();

create trigger leads_touch before update on public.leads
  for each row execute function app.touch_row();
create trigger leads_stamp before insert on public.leads
  for each row execute function app.stamp_created_by();
create trigger leads_keys before update on public.leads
  for each row execute function app.guard_tenant_keys();
create trigger leads_audit after insert or update or delete on public.leads
  for each row execute function app.audit_row_change('display_name', 'email', 'phone', 'date_of_birth', 'conflict_note');
create trigger leads_no_delete before delete on public.leads
  for each row execute function app.reject_governed_delete();

create trigger lead_events_no_change before update or delete on public.lead_events
  for each row execute function app.reject_lead_history_change();
create trigger lead_notes_stamp before insert on public.lead_notes
  for each row execute function app.stamp_created_by();
create trigger lead_notes_no_change before update or delete on public.lead_notes
  for each row execute function app.reject_lead_history_change();
create trigger lead_consents_stamp before insert on public.lead_consents
  for each row execute function app.stamp_created_by();
create trigger lead_consents_no_change before update or delete on public.lead_consents
  for each row execute function app.reject_lead_history_change();

create trigger lead_follow_ups_touch before update on public.lead_follow_ups
  for each row execute function app.touch_row();
create trigger lead_follow_ups_stamp before insert on public.lead_follow_ups
  for each row execute function app.stamp_created_by();
create trigger lead_follow_ups_keys before update on public.lead_follow_ups
  for each row execute function app.guard_tenant_keys();
create trigger lead_follow_ups_audit after insert or update or delete on public.lead_follow_ups
  for each row execute function app.audit_row_change();
create trigger lead_follow_ups_no_delete before delete on public.lead_follow_ups
  for each row execute function app.reject_governed_delete();

create trigger lead_booking_links_stamp before insert on public.lead_booking_links
  for each row execute function app.stamp_created_by();
create trigger lead_booking_links_audit after insert or update or delete on public.lead_booking_links
  for each row execute function app.audit_row_change();
create trigger lead_booking_links_no_change before update or delete on public.lead_booking_links
  for each row execute function app.reject_lead_history_change();

create trigger lead_duplicate_decisions_stamp before insert on public.lead_duplicate_decisions
  for each row execute function app.stamp_created_by();
create trigger lead_duplicate_decisions_no_change before update or delete on public.lead_duplicate_decisions
  for each row execute function app.reject_lead_history_change();

create trigger lead_enquiry_attempts_no_delete before delete on public.lead_enquiry_attempts
  for each row execute function app.reject_governed_delete();

-- ---------------------------------------------------------------------------
-- Starting stages: the PRD §7 lead lifecycle, for every firm (existing and new).
-- ---------------------------------------------------------------------------

create function app.seed_lead_stages(p_org uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.lead_stages (organization_id, key, label, kind, position)
  select p_org, stage.key, stage.label, stage.kind::public.lead_stage_kind, stage.position
  from (values
    ('new', 'New', 'open', 1),
    ('contacted', 'Contacted', 'open', 2),
    ('consultation_scheduled', 'Consultation scheduled', 'open', 3),
    ('consultation_completed', 'Consultation completed', 'open', 4),
    ('qualified', 'Qualified', 'open', 5),
    ('proposal_sent', 'Proposal sent', 'open', 6),
    ('converted', 'Converted', 'converted', 7),
    ('lost', 'Lost', 'lost', 8),
    ('archived', 'Archived', 'archived', 9)
  ) as stage (key, label, kind, position)
  on conflict (organization_id, key) do nothing;
$$;
revoke all on function app.seed_lead_stages(uuid) from public;

create function app.seed_lead_stages_on_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.seed_lead_stages(new.id);
  return new;
end;
$$;
revoke all on function app.seed_lead_stages_on_org() from public;

create trigger organizations_seed_lead_stages after insert on public.organizations
  for each row execute function app.seed_lead_stages_on_org();

select app.seed_lead_stages(org.id) from public.organizations org;

-- ---------------------------------------------------------------------------
-- Privileges and row-level security
-- ---------------------------------------------------------------------------

revoke all on table public.lead_stages from anon, authenticated, service_role;
revoke all on table public.leads from anon, authenticated, service_role;
revoke all on table public.lead_events from anon, authenticated, service_role;
revoke all on table public.lead_notes from anon, authenticated, service_role;
revoke all on table public.lead_follow_ups from anon, authenticated, service_role;
revoke all on table public.lead_consents from anon, authenticated, service_role;
revoke all on table public.lead_booking_links from anon, authenticated, service_role;
revoke all on table public.lead_duplicate_decisions from anon, authenticated, service_role;
revoke all on table public.lead_enquiry_attempts from anon, authenticated, service_role;
grant select on table public.lead_stages to authenticated, service_role;
grant select on table public.leads to authenticated, service_role;
grant select on table public.lead_events to authenticated, service_role;
grant select on table public.lead_notes to authenticated, service_role;
grant select on table public.lead_follow_ups to authenticated, service_role;
grant select on table public.lead_consents to authenticated, service_role;
grant select on table public.lead_booking_links to authenticated, service_role;
grant select on table public.lead_duplicate_decisions to authenticated, service_role;

alter table public.lead_stages enable row level security;
alter table public.lead_stages force row level security;
alter table public.leads enable row level security;
alter table public.leads force row level security;
alter table public.lead_events enable row level security;
alter table public.lead_events force row level security;
alter table public.lead_notes enable row level security;
alter table public.lead_notes force row level security;
alter table public.lead_follow_ups enable row level security;
alter table public.lead_follow_ups force row level security;
alter table public.lead_consents enable row level security;
alter table public.lead_consents force row level security;
alter table public.lead_booking_links enable row level security;
alter table public.lead_booking_links force row level security;
alter table public.lead_duplicate_decisions enable row level security;
alter table public.lead_duplicate_decisions force row level security;
alter table public.lead_enquiry_attempts enable row level security;
alter table public.lead_enquiry_attempts force row level security;

create policy lead_stages_select on public.lead_stages
  for select to authenticated
  using (organization_id = (select app.current_organization_id()) and (select app.can_read_leads(organization_id)));
create policy leads_select on public.leads
  for select to authenticated
  using (organization_id = (select app.current_organization_id()) and (select app.can_read_leads(organization_id)));
create policy lead_events_select on public.lead_events
  for select to authenticated
  using (organization_id = (select app.current_organization_id()) and (select app.can_read_leads(organization_id)));
create policy lead_notes_select on public.lead_notes
  for select to authenticated
  using (organization_id = (select app.current_organization_id()) and (select app.can_read_leads(organization_id)));
create policy lead_follow_ups_select on public.lead_follow_ups
  for select to authenticated
  using (organization_id = (select app.current_organization_id()) and (select app.can_read_leads(organization_id)));
create policy lead_consents_select on public.lead_consents
  for select to authenticated
  using (organization_id = (select app.current_organization_id()) and (select app.can_read_leads(organization_id)));
create policy lead_booking_links_select on public.lead_booking_links
  for select to authenticated
  using (organization_id = (select app.current_organization_id()) and (select app.can_read_leads(organization_id)));
create policy lead_duplicate_decisions_select on public.lead_duplicate_decisions
  for select to authenticated
  using (organization_id = (select app.current_organization_id()) and (select app.can_read_leads(organization_id)));
