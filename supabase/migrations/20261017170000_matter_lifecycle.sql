-- T023 matter lifecycle (PRD §6, §7, §18).
-- Reference numbers, a responsible consultant, a program pin taken from a
-- published rule pack, on-hold, and audited stage overrides.
-- Stage changes still go through app.transition_matter_stage. The licence
-- lock and the allowed-edge table are unchanged. No program, fee, or form
-- is seeded here. A pack is selectable only when it is already published.
-- Additive only.

create type public.engagement_status as enum ('pending', 'engaged', 'exception', 'ended');
create type public.government_status as enum (
  'not_recorded',
  'receipt_on_file',
  'processing_reported',
  'additional_request_open',
  'decision_evidence_on_file'
);
create type public.matter_outcome as enum (
  'approved',
  'refused',
  'withdrawn',
  'returned_or_incomplete',
  'abandoned',
  'other_verified'
);

comment on type public.matter_outcome is
  'Consultant-confirmed outcome. Pending is not a value. Payment and stage do not set this.';
comment on type public.government_status is
  'Firm record of externally reported processing. Independent of matter stage and outcome.';

alter table public.matters
  add column reference text,
  add column reference_year integer,
  add column reference_seq integer,
  add column responsible_consultant_membership_id uuid,
  add column program_pack_id uuid references public.rule_pack_versions (id),
  add column engagement_status public.engagement_status not null default 'pending',
  add column government_status public.government_status not null default 'not_recorded',
  add column outcome public.matter_outcome,
  add column on_hold_reason text,
  add column on_hold_owner_membership_id uuid,
  add column on_hold_review_on date,
  add column predecessor_matter_id uuid,
  add column retention_on date,
  add constraint matters_reference_year_ck check (reference_year is null or reference_year between 2000 and 2200),
  add constraint matters_reference_seq_ck check (reference_seq is null or reference_seq >= 1),
  add constraint matters_on_hold_ck check (
    (
      on_hold is false
      and on_hold_reason is null
      and on_hold_owner_membership_id is null
      and on_hold_review_on is null
    )
    or (
      on_hold is true
      and on_hold_reason is not null
      and length(btrim(on_hold_reason)) between 3 and 500
      and on_hold_owner_membership_id is not null
      and on_hold_review_on is not null
    )
  ),
  add constraint matters_predecessor_ck check (predecessor_matter_id is null or predecessor_matter_id <> id);

alter table public.matters
  add constraint matters_reference_key unique (organization_id, reference);

alter table public.matters
  add constraint matters_consultant_org_fk
    foreign key (responsible_consultant_membership_id, organization_id)
    references public.memberships (id, organization_id);

alter table public.matters
  add constraint matters_hold_owner_org_fk
    foreign key (on_hold_owner_membership_id, organization_id)
    references public.memberships (id, organization_id);

alter table public.matters
  add constraint matters_predecessor_org_fk
    foreign key (predecessor_matter_id, organization_id)
    references public.matters (id, organization_id);

comment on column public.matters.reference is
  'Per-firm sequence. Prefix is the firm''s first jurisdiction code (organizations.jurisdiction_codes[1]), then the year in the firm timezone, then the sequence. Not a government file number.';
comment on column public.matters.program_pack_id is
  'The published rule pack selected for this matter. The binding row is the pin. Nothing here is copied from model memory.';
comment on column public.matters.on_hold is
  'Separate from stage. Does not stop government-deadline alerts.';
comment on column public.matters.retention_on is
  'Calendar date recorded by staff. Reopening does not clear it. Not calculated from a statute in this migration.';
comment on column public.matters.outcome is
  'Null until a consultant records one. There is no pending outcome.';

create index matters_org_stage_consultant_idx
  on public.matters (organization_id, stage, responsible_consultant_membership_id);
create index matters_consultant_org_fk_idx
  on public.matters (responsible_consultant_membership_id, organization_id);
create index matters_hold_owner_org_fk_idx
  on public.matters (on_hold_owner_membership_id, organization_id);
create index matters_program_pack_idx on public.matters (program_pack_id);
create index matters_predecessor_org_fk_idx
  on public.matters (predecessor_matter_id, organization_id);

create table app.matter_reference_counters (
  organization_id uuid not null references public.organizations (id),
  reference_year integer not null,
  last_value integer not null check (last_value >= 0),
  primary key (organization_id, reference_year)
);
revoke all on table app.matter_reference_counters from public, anon, authenticated, service_role;

create table app.matter_column_nonce (
  matter_id uuid primary key,
  txid bigint not null,
  column_set text not null
);
revoke all on table app.matter_column_nonce from public, anon, authenticated, service_role;

create function app.assign_matter_reference()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  org_tz text;
  codes text[];
  prefix text;
  yr integer;
  seq integer;
begin
  if new.reference is not null or new.reference_year is not null or new.reference_seq is not null then
    raise exception 'matter reference is assigned by the database' using errcode = '42501';
  end if;
  select org.timezone, org.jurisdiction_codes into org_tz, codes
  from public.organizations org
  where org.id = new.organization_id;
  prefix := upper(coalesce(codes[1], 'CV'));
  if prefix !~ '^[A-Z]{2}$' then
    prefix := 'CV';
  end if;
  begin
    yr := extract(year from (statement_timestamp() at time zone org_tz))::integer;
  exception when others then
    raise exception 'firm timezone is not usable' using errcode = '22023';
  end;
  insert into app.matter_reference_counters (organization_id, reference_year, last_value)
  values (new.organization_id, yr, 1)
  on conflict (organization_id, reference_year)
  do update set last_value = app.matter_reference_counters.last_value + 1
  returning last_value into seq;
  new.reference_year := yr;
  new.reference_seq := seq;
  new.reference := prefix || '-' || yr::text || '-' || case
    when seq < 10000 then lpad(seq::text, 4, '0')
    else seq::text
  end;
  return new;
end;
$$;
revoke all on function app.assign_matter_reference() from public;

create trigger matters_a_assign_reference before insert on public.matters
  for each row execute function app.assign_matter_reference();

create function app.validate_new_matter()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cred public.credential_status;
  pack public.rule_pack_versions%rowtype;
  codes text[];
begin
  if new.responsible_consultant_membership_id is not null then
    if not exists (
      select 1
      from public.memberships mem
      where mem.id = new.responsible_consultant_membership_id
        and mem.organization_id = new.organization_id
        and mem.role = 'licensed_consultant'
        and mem.status = 'active'
    ) then
      raise exception 'the responsible consultant must be an active licensed consultant' using errcode = '42501';
    end if;
    select credential.status into cred
    from public.consultant_credentials credential
    where credential.membership_id = new.responsible_consultant_membership_id
      and credential.organization_id = new.organization_id;
    if cred is not null and app.licence_status_blocks(cred) then
      raise exception 'not entitled, revoked, suspended, or inactive licence blocks this consultant action'
        using errcode = '42501';
    end if;
  end if;

  if new.program_pack_id is not null then
    select * into pack from public.rule_pack_versions where id = new.program_pack_id;
    select org.jurisdiction_codes into codes
    from public.organizations org
    where org.id = new.organization_id;
    if pack.id is null
       or pack.status not in ('published', 'review_due')
       or (pack.organization_id is not null and pack.organization_id is distinct from new.organization_id)
       or not exists (
         select 1
         from unnest(coalesce(codes, array[]::text[])) firm_code
         where pack.jurisdiction = firm_code
            or pack.jurisdiction like firm_code || '-%'
       ) then
      raise exception 'program selection must be a published pack for a jurisdiction this firm practises'
        using errcode = '42501';
    end if;
  end if;

  if new.on_hold
     or new.engagement_status is distinct from 'pending'
     or new.government_status is distinct from 'not_recorded'
     or new.outcome is not null
     or new.predecessor_matter_id is not null
     or new.retention_on is not null then
    raise exception 'those matter fields are set by a lifecycle function' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.validate_new_matter() from public;

create trigger matters_b_validate_new before insert on public.matters
  for each row execute function app.validate_new_matter();

create function app.guard_matter_lifecycle_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  opened text;
begin
  if new.reference is distinct from old.reference
     or new.reference_year is distinct from old.reference_year
     or new.reference_seq is distinct from old.reference_seq then
    raise exception 'matter reference is assigned by the database' using errcode = '42501';
  end if;

  select nonce.column_set into opened
  from app.matter_column_nonce nonce
  where nonce.matter_id = new.id
    and nonce.txid = txid_current();

  if new.responsible_consultant_membership_id is distinct from old.responsible_consultant_membership_id
     and opened is distinct from 'consultant' then
    raise exception 'consultant assignment goes through assign_responsible_consultant' using errcode = '42501';
  end if;
  if new.program_pack_id is distinct from old.program_pack_id and opened is distinct from 'program' then
    raise exception 'program selection goes through select_matter_program' using errcode = '42501';
  end if;
  if (
    new.on_hold is distinct from old.on_hold
    or new.on_hold_reason is distinct from old.on_hold_reason
    or new.on_hold_owner_membership_id is distinct from old.on_hold_owner_membership_id
    or new.on_hold_review_on is distinct from old.on_hold_review_on
  ) and opened is distinct from 'on_hold' then
    raise exception 'on hold changes go through set_matter_on_hold' using errcode = '42501';
  end if;
  if new.engagement_status is distinct from old.engagement_status and opened is distinct from 'engagement' then
    raise exception 'engagement status goes through record_matter_engagement' using errcode = '42501';
  end if;
  if new.government_status is distinct from old.government_status and opened is distinct from 'government' then
    raise exception 'government status goes through record_government_status' using errcode = '42501';
  end if;
  if new.outcome is distinct from old.outcome and opened is distinct from 'outcome' then
    raise exception 'outcome goes through record_matter_outcome' using errcode = '42501';
  end if;
  if new.predecessor_matter_id is distinct from old.predecessor_matter_id and opened is distinct from 'predecessor' then
    raise exception 'linked matters go through link_successor_matter' using errcode = '42501';
  end if;
  if new.retention_on is distinct from old.retention_on and opened is distinct from 'retention' then
    raise exception 'retention date goes through record_matter_retention' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.guard_matter_lifecycle_columns() from public;

create trigger matters_lifecycle_columns before update on public.matters
  for each row execute function app.guard_matter_lifecycle_columns();

create function app.open_matter_column(p_matter_id uuid, p_column_set text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into app.matter_column_nonce (matter_id, txid, column_set)
  values (p_matter_id, txid_current(), p_column_set)
  on conflict (matter_id) do update
    set txid = excluded.txid, column_set = excluded.column_set;
end;
$$;
revoke all on function app.open_matter_column(uuid, text) from public;

create function app.close_matter_column(p_matter_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from app.matter_column_nonce where matter_id = p_matter_id;
end;
$$;
revoke all on function app.close_matter_column(uuid) from public;

-- check:migrations allows delete inside a function body. This nonce is not a business row.

create function app.require_active_staff(
  p_org uuid,
  p_roles public.org_role[],
  p_step_up boolean
)
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
     or app.staff_mfa_satisfied() is distinct from true
     or app.has_org_role(p_org, p_roles) is distinct from true then
    raise exception 'staff access denied' using errcode = '42501';
  end if;
  if p_step_up and app.mfa_step_up_satisfied() is distinct from true then
    raise exception 'step-up is required' using errcode = '42501';
  end if;
end;
$$;
revoke all on function app.require_active_staff(uuid, public.org_role[], boolean) from public;

create function app.sample_mode_blocks_real(p_org uuid, p_is_sample boolean)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_is_sample is distinct from true
     and exists (
       select 1
       from public.organizations org
       where org.id = p_org
         and org.sample_mode is true
     );
$$;
revoke all on function app.sample_mode_blocks_real(uuid, boolean) from public;

-- ---------------------------------------------------------------------------
-- Engagement, program changes, overrides
-- ---------------------------------------------------------------------------
create table public.matter_engagements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  matter_id uuid not null,
  scope_summary text not null check (length(btrim(scope_summary)) between 3 and 2000),
  status public.engagement_status not null,
  use_exception boolean not null,
  exception_reason text,
  agreement_locator text,
  permitted_role public.org_role,
  consultant_membership_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id),
  check (
    (
      status = 'pending'
      and use_exception is false
      and exception_reason is null
      and agreement_locator is null
      and permitted_role is null
    )
    or (
      status = 'engaged'
      and use_exception is false
      and exception_reason is null
      and agreement_locator is not null
      and length(btrim(agreement_locator)) between 1 and 300
      and permitted_role is null
    )
    or (
      status = 'exception'
      and use_exception is true
      and agreement_locator is null
      and exception_reason is not null
      and length(btrim(exception_reason)) between 3 and 500
      and permitted_role in ('firm_owner', 'licensed_consultant')
    )
  ),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id),
  foreign key (consultant_membership_id, organization_id)
    references public.memberships (id, organization_id)
);
comment on table public.matter_engagements is
  'Proposed scope plus either an agreement locator or a documented exception. The agreement document itself is T022. A locator is not a signed agreement.';

create index matter_engagements_matter_idx on public.matter_engagements (matter_id, created_at desc);
create index matter_engagements_org_fk_idx on public.matter_engagements (organization_id);
create index matter_engagements_matter_org_fk_idx on public.matter_engagements (matter_id, organization_id);
create index matter_engagements_consultant_org_fk_idx
  on public.matter_engagements (consultant_membership_id, organization_id);
create index matter_engagements_created_by_idx on public.matter_engagements (created_by);

create trigger matter_engagements_touch before update on public.matter_engagements
  for each row execute function app.touch_row();
create trigger matter_engagements_immutable before update on public.matter_engagements
  for each row execute function app.guard_tenant_keys();
create trigger matter_engagements_stamp before insert on public.matter_engagements
  for each row execute function app.stamp_created_by();
create trigger matter_engagements_audit after insert or update or delete on public.matter_engagements
  for each row execute function app.audit_row_change();

create table public.matter_program_changes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  matter_id uuid not null,
  from_pack_id uuid,
  to_pack_id uuid not null references public.rule_pack_versions (id),
  reason text not null check (length(btrim(reason)) between 3 and 500),
  permitted_role public.org_role not null,
  actor_user_id uuid,
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id)
);
comment on table public.matter_program_changes is
  'Append-only. A new pack is a new pin. The previous binding is superseded, not edited.';

create index matter_program_changes_matter_idx on public.matter_program_changes (matter_id, created_at);
create index matter_program_changes_org_fk_idx on public.matter_program_changes (organization_id);
create index matter_program_changes_matter_org_fk_idx on public.matter_program_changes (matter_id, organization_id);
create index matter_program_changes_to_pack_idx on public.matter_program_changes (to_pack_id);
create index matter_program_changes_from_pack_idx on public.matter_program_changes (from_pack_id);

create trigger matter_program_changes_audit after insert or update or delete on public.matter_program_changes
  for each row execute function app.audit_row_change();

create function app.reject_program_change_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'matter program changes are append-only' using errcode = '42501';
end;
$$;
revoke all on function app.reject_program_change_mutation() from public;

create trigger matter_program_changes_no_update before update or delete on public.matter_program_changes
  for each row execute function app.reject_program_change_mutation();

create table public.matter_stage_overrides (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  matter_id uuid not null,
  from_stage public.matter_stage not null,
  to_stage public.matter_stage not null,
  reason text not null check (length(btrim(reason)) between 3 and 500),
  permitted_role public.org_role not null,
  actor_user_id uuid,
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  check (permitted_role in ('firm_owner', 'licensed_consultant')),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id)
);
comment on table public.matter_stage_overrides is
  'Audited exception when entry evidence is missing. The permitted role is the role that authorized it. A licence lock still applies.';

create index matter_stage_overrides_matter_idx on public.matter_stage_overrides (matter_id, created_at);
create index matter_stage_overrides_org_fk_idx on public.matter_stage_overrides (organization_id);
create index matter_stage_overrides_matter_org_fk_idx
  on public.matter_stage_overrides (matter_id, organization_id);
create index matter_stage_overrides_actor_idx on public.matter_stage_overrides (actor_user_id);

create trigger matter_stage_overrides_audit after insert or update or delete on public.matter_stage_overrides
  for each row execute function app.audit_row_change();

create function app.reject_stage_override_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'matter stage overrides are append-only' using errcode = '42501';
end;
$$;
revoke all on function app.reject_stage_override_mutation() from public;

create trigger matter_stage_overrides_no_update before update or delete on public.matter_stage_overrides
  for each row execute function app.reject_stage_override_mutation();

alter table public.matter_stage_transitions
  add column override_id uuid;

alter table public.matter_stage_transitions
  add constraint matter_stage_transitions_override_fk
    foreign key (override_id, organization_id)
    references public.matter_stage_overrides (id, organization_id);

create index matter_stage_transitions_override_org_fk_idx
  on public.matter_stage_transitions (override_id, organization_id);

create table app.matter_stage_override_nonce (
  matter_id uuid primary key,
  txid bigint not null,
  override_id uuid not null
);
revoke all on table app.matter_stage_override_nonce from public, anon, authenticated, service_role;

create function app.reject_stage_transition_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'matter stage transitions are append-only' using errcode = '42501';
end;
$$;
revoke all on function app.reject_stage_transition_mutation() from public;

create trigger matter_stage_transitions_no_update before update or delete on public.matter_stage_transitions
  for each row execute function app.reject_stage_transition_mutation();

-- Same gates as 20261017140700, plus an override nonce when entry evidence is absent,
-- and a matter.closed outbox row that carries ids only.
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
  override_id uuid;
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
    raise exception 'not entitled, revoked, suspended, or inactive licence blocks this consultant action'
      using errcode = '42501';
  end if;
  if app.matter_stage_transition_allowed(matter.stage, p_to_stage) is distinct from true then
    raise exception 'that stage transition is not allowed' using errcode = '42501';
  end if;

  evidence := app.stage_entry_evidence_id(matter.id, p_to_stage);
  if evidence is null then
    select nonce.override_id into override_id
    from app.matter_stage_override_nonce nonce
    where nonce.matter_id = matter.id
      and nonce.txid = txid_current();
    if override_id is null then
      raise exception 'stage entry evidence is missing' using errcode = '42501';
    end if;
  else
    select nonce.override_id into override_id
    from app.matter_stage_override_nonce nonce
    where nonce.matter_id = matter.id
      and nonce.txid = txid_current();
  end if;

  insert into app.matter_stage_transition_nonce (matter_id, txid)
  values (matter.id, txid_current())
  on conflict (matter_id) do update set txid = excluded.txid;

  update public.matters
  set stage = p_to_stage
  where id = matter.id
  returning version into new_version;

  delete from app.matter_stage_transition_nonce where matter_id = matter.id;
  delete from app.matter_stage_override_nonce where matter_id = matter.id;

  insert into public.matter_stage_transitions (
    organization_id, matter_id, from_stage, to_stage, reason, evidence_id, override_id, actor_user_id, from_version
  ) values (
    matter.organization_id,
    matter.id,
    matter.stage,
    p_to_stage,
    btrim(p_reason),
    evidence,
    override_id,
    (select auth.uid()),
    matter.version
  );

  perform app.record_audit_event(
    matter.organization_id,
    case
      when matter.stage = 'closed' and p_to_stage = 'engagement_pending' then 'matter.reopened'
      when override_id is not null then 'matter.stage_override'
      else 'matter.stage_transition'
    end,
    'public.matters',
    matter.id,
    'success',
    jsonb_build_object(
      'from_stage', matter.stage,
      'to_stage', p_to_stage,
      'evidence_id', evidence,
      'override_id', override_id
    )
  );

  if p_to_stage = 'closed' then
    perform app.enqueue_event(
      matter.organization_id,
      'matter',
      matter.id,
      'matter.closed',
      jsonb_build_object('matter_id', matter.id),
      new_version,
      'matter.closed:' || matter.id::text || ':' || matter.version::text
    );
  end if;
  return new_version;
end;
$$;

create function app.override_matter_stage(
  p_matter_id uuid,
  p_to_stage public.matter_stage,
  p_expected_version integer,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  matter public.matters%rowtype;
  permitted public.org_role;
  override_id uuid;
  new_version integer;
  blocked public.credential_status;
begin
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'a stage change needs a reason' using errcode = '22023';
  end if;
  select * into matter from public.matters where id = p_matter_id;
  if matter.id is null or app.can_read_matter(matter.id) is distinct from true then
    raise exception 'matter stage change denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    matter.organization_id,
    array['firm_owner', 'licensed_consultant']::public.org_role[],
    true
  );
  if app.matter_stage_is_regulated(matter.stage, p_to_stage) then
    perform app.require_active_staff(
      matter.organization_id,
      array['licensed_consultant']::public.org_role[],
      true
    );
    permitted := 'licensed_consultant';
  elsif app.has_org_role(matter.organization_id, array['licensed_consultant']::public.org_role[]) then
    permitted := 'licensed_consultant';
  else
    permitted := 'firm_owner';
  end if;

  insert into public.matter_stage_overrides (
    organization_id, matter_id, from_stage, to_stage, reason, permitted_role, actor_user_id
  ) values (
    matter.organization_id,
    matter.id,
    matter.stage,
    p_to_stage,
    btrim(p_reason),
    permitted,
    (select auth.uid())
  )
  returning id into override_id;

  insert into app.matter_stage_override_nonce (matter_id, txid, override_id)
  values (matter.id, txid_current(), override_id)
  on conflict (matter_id) do update
    set txid = excluded.txid, override_id = excluded.override_id;

  new_version := app.transition_matter_stage(p_matter_id, p_to_stage, p_expected_version, p_reason);
  return jsonb_build_object('ok', true, 'version', new_version, 'override_id', override_id, 'permitted_role', permitted);
exception
  when insufficient_privilege then
    if sqlerrm ilike '%licence blocks%' then
      blocked := app.actor_licence_block_status(matter.organization_id);
      perform app.record_audit_event(
        matter.organization_id,
        'licence.regulated_action_blocked',
        'public.matters',
        p_matter_id,
        'denied',
        jsonb_build_object('action', 'matter.stage_override', 'to_stage', p_to_stage, 'credential_status', blocked)
      );
      return jsonb_build_object('ok', false, 'blocked', 'licence', 'credential_status', blocked);
    end if;
    raise;
end;
$$;
revoke all on function app.override_matter_stage(uuid, public.matter_stage, integer, text) from public;

create function public.override_matter_stage(
  p_matter_id uuid,
  p_to_stage public.matter_stage,
  p_expected_version integer,
  p_reason text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app.override_matter_stage(p_matter_id, p_to_stage, p_expected_version, p_reason);
$$;
revoke all on function public.override_matter_stage(uuid, public.matter_stage, integer, text) from public, anon;
grant execute on function public.override_matter_stage(uuid, public.matter_stage, integer, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Create, assign, select, hold, outcome
-- ---------------------------------------------------------------------------
create function app.note_proposed_scope(p_matter_id uuid, p_scope text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  matter public.matters%rowtype;
  engagement_id uuid;
begin
  select * into matter from public.matters where id = p_matter_id;
  if matter.id is null
     or matter.responsible_consultant_membership_id is null
     or app.can_read_matter(matter.id) is distinct from true then
    raise exception 'proposed scope denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    matter.organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[],
    false
  );
  insert into public.matter_engagements (
    organization_id, matter_id, scope_summary, status, use_exception, consultant_membership_id
  ) values (
    matter.organization_id,
    matter.id,
    btrim(p_scope),
    'pending',
    false,
    matter.responsible_consultant_membership_id
  )
  returning id into engagement_id;
  return engagement_id;
end;
$$;
revoke all on function app.note_proposed_scope(uuid, text) from public;

create function public.create_engaged_matter(
  p_title text,
  p_is_sample boolean,
  p_consultant_membership_id uuid,
  p_rule_pack_version_id uuid default null,
  p_scope text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  org uuid := app.current_organization_id();
  new_id uuid := gen_random_uuid();
  blocked public.credential_status;
  ref text;
begin
  if org is null or app.staff_mfa_satisfied() is distinct from true then
    raise exception 'matter create denied' using errcode = '42501';
  end if;
  if app.has_org_role(
    org,
    array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[]
  ) is distinct from true then
    raise exception 'matter create denied' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_title, ''))) not between 1 and 200 then
    raise exception 'matter title is required' using errcode = '22023';
  end if;
  if p_consultant_membership_id is null then
    raise exception 'a responsible consultant is required' using errcode = '22023';
  end if;
  if p_scope is not null and length(btrim(p_scope)) not between 3 and 2000 then
    raise exception 'proposed scope is too short' using errcode = '22023';
  end if;

  insert into public.matters (
    id, organization_id, title, is_sample, responsible_consultant_membership_id, program_pack_id
  ) values (
    new_id, org, btrim(p_title), coalesce(p_is_sample, false), p_consultant_membership_id, p_rule_pack_version_id
  );

  insert into public.matter_participants (organization_id, matter_id, membership_id, role)
  values (org, new_id, p_consultant_membership_id, 'consultant');

  if p_rule_pack_version_id is not null then
    insert into public.matter_rule_bindings (
      organization_id, matter_id, rule_pack_version_id, rationale
    ) values (
      org,
      new_id,
      p_rule_pack_version_id,
      'Selected at matter creation from a published pack.'
    );
  end if;

  if p_scope is not null then
    perform app.note_proposed_scope(new_id, btrim(p_scope));
  end if;

  select matter.reference into ref from public.matters matter where matter.id = new_id;
  return jsonb_build_object('ok', true, 'id', new_id, 'reference', ref);
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
revoke all on function public.create_engaged_matter(text, boolean, uuid, uuid, text) from public, anon;
grant execute on function public.create_engaged_matter(text, boolean, uuid, uuid, text)
  to authenticated, service_role;

comment on function public.create_engaged_matter(text, boolean, uuid, uuid, text) is
  'Creates a matter at engagement pending with a named consultant. A pack id must already be published. Sample mode still rejects a real row. The agreement locator scope-only is not an executed agreement.';

create function app.assign_responsible_consultant(
  p_matter_id uuid,
  p_membership_id uuid,
  p_expected_version integer
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  matter public.matters%rowtype;
  cred public.credential_status;
  new_version integer;
  changing boolean;
begin
  select * into matter from public.matters where id = p_matter_id for update;
  if matter.id is null or app.can_read_matter(matter.id) is distinct from true then
    raise exception 'consultant assignment denied' using errcode = '42501';
  end if;
  changing := matter.responsible_consultant_membership_id is not null
    and matter.responsible_consultant_membership_id is distinct from p_membership_id;
  perform app.require_active_staff(
    matter.organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[],
    changing
  );
  if app.sample_mode_blocks_real(matter.organization_id, matter.is_sample) then
    raise exception 'this firm is in sample mode; only sample matters accept new work' using errcode = '42501';
  end if;
  if matter.version is distinct from p_expected_version then
    raise exception 'matter version conflict' using errcode = '40001';
  end if;
  if not exists (
    select 1 from public.memberships mem
    where mem.id = p_membership_id
      and mem.organization_id = matter.organization_id
      and mem.role = 'licensed_consultant'
      and mem.status = 'active'
  ) then
    raise exception 'the responsible consultant must be an active licensed consultant' using errcode = '42501';
  end if;
  select credential.status into cred
  from public.consultant_credentials credential
  where credential.membership_id = p_membership_id
    and credential.organization_id = matter.organization_id;
  if cred is not null and app.licence_status_blocks(cred) then
    raise exception 'not entitled, revoked, suspended, or inactive licence blocks this consultant action'
      using errcode = '42501';
  end if;

  perform app.open_matter_column(matter.id, 'consultant');
  update public.matters
  set responsible_consultant_membership_id = p_membership_id
  where id = matter.id
  returning version into new_version;
  perform app.close_matter_column(matter.id);

  insert into public.matter_participants (organization_id, matter_id, membership_id, role)
  values (matter.organization_id, matter.id, p_membership_id, 'consultant')
  on conflict (matter_id, membership_id, role) do nothing;

  perform app.record_audit_event(
    matter.organization_id,
    'matter.consultant_assigned',
    'public.matters',
    matter.id,
    'success',
    jsonb_build_object('membership_id', p_membership_id, 'replaced', changing)
  );
  return new_version;
end;
$$;
revoke all on function app.assign_responsible_consultant(uuid, uuid, integer) from public;

create function public.assign_responsible_consultant(
  p_matter_id uuid,
  p_membership_id uuid,
  p_expected_version integer
)
returns integer
language sql
security invoker
set search_path = ''
as $$
  select app.assign_responsible_consultant(p_matter_id, p_membership_id, p_expected_version);
$$;
revoke all on function public.assign_responsible_consultant(uuid, uuid, integer) from public, anon;
grant execute on function public.assign_responsible_consultant(uuid, uuid, integer) to authenticated, service_role;

create function app.pack_is_selectable(p_pack uuid, p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.rule_pack_versions pack
    join public.organizations org on org.id = p_org
    where pack.id = p_pack
      and pack.status in ('published', 'review_due')
      and (pack.organization_id is null or pack.organization_id = p_org)
      and exists (
        select 1
        from unnest(org.jurisdiction_codes) firm_code
        where pack.jurisdiction = firm_code
           or pack.jurisdiction like firm_code || '-%'
      )
  );
$$;
revoke all on function app.pack_is_selectable(uuid, uuid) from public;

create function app.select_matter_program(
  p_matter_id uuid,
  p_rule_pack_version_id uuid,
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
  new_version integer;
  permitted public.org_role;
  changing boolean;
begin
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'program selection needs a reason' using errcode = '22023';
  end if;
  select * into matter from public.matters where id = p_matter_id for update;
  if matter.id is null or app.can_read_matter(matter.id) is distinct from true then
    raise exception 'program selection denied' using errcode = '42501';
  end if;
  changing := matter.program_pack_id is not null and matter.program_pack_id is distinct from p_rule_pack_version_id;
  perform app.require_active_staff(
    matter.organization_id,
    array['firm_owner', 'licensed_consultant']::public.org_role[],
    changing
  );
  if app.sample_mode_blocks_real(matter.organization_id, matter.is_sample) then
    raise exception 'this firm is in sample mode; only sample matters accept new work' using errcode = '42501';
  end if;
  if matter.version is distinct from p_expected_version then
    raise exception 'matter version conflict' using errcode = '40001';
  end if;
  if matter.program_pack_id is not distinct from p_rule_pack_version_id then
    raise exception 'that pack is already selected' using errcode = '22023';
  end if;
  if app.pack_is_selectable(p_rule_pack_version_id, matter.organization_id) is distinct from true then
    raise exception 'program selection must be a published pack for a jurisdiction this firm practises'
      using errcode = '42501';
  end if;
  if app.has_org_role(matter.organization_id, array['licensed_consultant']::public.org_role[]) then
    permitted := 'licensed_consultant';
  else
    permitted := 'firm_owner';
  end if;

  if changing or matter.program_pack_id is not null then
    update public.matter_rule_bindings
    set superseded_at = statement_timestamp()
    where matter_id = matter.id
      and superseded_at is null;
  end if;
  insert into public.matter_rule_bindings (organization_id, matter_id, rule_pack_version_id, rationale)
  values (matter.organization_id, matter.id, p_rule_pack_version_id, btrim(p_reason));

  perform app.open_matter_column(matter.id, 'program');
  update public.matters
  set program_pack_id = p_rule_pack_version_id
  where id = matter.id
  returning version into new_version;
  perform app.close_matter_column(matter.id);

  insert into public.matter_program_changes (
    organization_id, matter_id, from_pack_id, to_pack_id, reason, permitted_role, actor_user_id
  ) values (
    matter.organization_id,
    matter.id,
    matter.program_pack_id,
    p_rule_pack_version_id,
    btrim(p_reason),
    permitted,
    (select auth.uid())
  );
  perform app.record_audit_event(
    matter.organization_id,
    'matter.program_selected',
    'public.matters',
    matter.id,
    'success',
    jsonb_build_object('pack_id', p_rule_pack_version_id, 'permitted_role', permitted)
  );
  return new_version;
end;
$$;
revoke all on function app.select_matter_program(uuid, uuid, integer, text) from public;

create function public.select_matter_program(
  p_matter_id uuid,
  p_rule_pack_version_id uuid,
  p_expected_version integer,
  p_reason text
)
returns integer
language sql
security invoker
set search_path = ''
as $$
  select app.select_matter_program(p_matter_id, p_rule_pack_version_id, p_expected_version, p_reason);
$$;
revoke all on function public.select_matter_program(uuid, uuid, integer, text) from public, anon;
grant execute on function public.select_matter_program(uuid, uuid, integer, text) to authenticated, service_role;

create function app.record_matter_engagement(
  p_matter_id uuid,
  p_scope text,
  p_use_exception boolean,
  p_exception_reason text,
  p_agreement_locator text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  matter public.matters%rowtype;
  permitted public.org_role;
  engagement_id uuid;
  evidence_kind public.matter_stage_evidence_kind;
  next_status public.engagement_status;
begin
  if p_scope is null or length(btrim(p_scope)) not between 3 and 2000 then
    raise exception 'proposed scope is required' using errcode = '22023';
  end if;
  select * into matter from public.matters where id = p_matter_id for update;
  if matter.id is null or app.can_read_matter(matter.id) is distinct from true then
    raise exception 'engagement denied' using errcode = '42501';
  end if;
  if matter.responsible_consultant_membership_id is null then
    raise exception 'a responsible consultant is required' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    matter.organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[],
    true
  );
  if app.sample_mode_blocks_real(matter.organization_id, matter.is_sample) then
    raise exception 'this firm is in sample mode; only sample matters accept new work' using errcode = '42501';
  end if;

  if coalesce(p_use_exception, false) then
    perform app.require_active_staff(
      matter.organization_id,
      array['firm_owner', 'licensed_consultant']::public.org_role[],
      true
    );
    if p_exception_reason is null or length(btrim(p_exception_reason)) < 3 then
      raise exception 'an exception needs a reason' using errcode = '22023';
    end if;
    if app.has_org_role(matter.organization_id, array['licensed_consultant']::public.org_role[]) then
      permitted := 'licensed_consultant';
    else
      permitted := 'firm_owner';
    end if;
    evidence_kind := 'service_agreement_exception';
    next_status := 'exception';
  else
    if p_agreement_locator is null or length(btrim(p_agreement_locator)) < 1 then
      raise exception 'an agreement locator is required until the agreement module records the executed copy'
        using errcode = '22023';
    end if;
    permitted := null;
    evidence_kind := 'service_agreement';
    next_status := 'engaged';
  end if;

  insert into public.matter_engagements (
    organization_id, matter_id, scope_summary, status, use_exception, exception_reason,
    agreement_locator, permitted_role, consultant_membership_id
  ) values (
    matter.organization_id,
    matter.id,
    btrim(p_scope),
    next_status,
    coalesce(p_use_exception, false),
    case when coalesce(p_use_exception, false) then btrim(p_exception_reason) else null end,
    case when coalesce(p_use_exception, false) then null else btrim(p_agreement_locator) end,
    permitted,
    matter.responsible_consultant_membership_id
  )
  returning id into engagement_id;

  insert into public.matter_stage_evidence (organization_id, matter_id, kind, summary)
  values (
    matter.organization_id,
    matter.id,
    evidence_kind,
    case
      when evidence_kind = 'service_agreement_exception' then 'Documented service-agreement exception'
      else 'Service agreement locator recorded'
    end
  );

  perform app.open_matter_column(matter.id, 'engagement');
  update public.matters set engagement_status = next_status where id = matter.id;
  perform app.close_matter_column(matter.id);

  perform app.record_audit_event(
    matter.organization_id,
    'matter.engagement_recorded',
    'public.matter_engagements',
    engagement_id,
    'success',
    jsonb_build_object('status', next_status, 'permitted_role', permitted, 'exception', coalesce(p_use_exception, false))
  );
  return engagement_id;
end;
$$;
revoke all on function app.record_matter_engagement(uuid, text, boolean, text, text) from public;

create function public.record_matter_engagement(
  p_matter_id uuid,
  p_scope text,
  p_use_exception boolean,
  p_exception_reason text,
  p_agreement_locator text
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select app.record_matter_engagement(
    p_matter_id, p_scope, p_use_exception, p_exception_reason, p_agreement_locator
  );
$$;
revoke all on function public.record_matter_engagement(uuid, text, boolean, text, text) from public, anon;
grant execute on function public.record_matter_engagement(uuid, text, boolean, text, text)
  to authenticated, service_role;

create function app.set_matter_on_hold(
  p_matter_id uuid,
  p_expected_version integer,
  p_reason text,
  p_owner_membership_id uuid,
  p_review_on date
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  matter public.matters%rowtype;
  new_version integer;
begin
  if p_reason is null or length(btrim(p_reason)) not between 3 and 500 or p_review_on is null then
    raise exception 'on hold needs a reason, an owner, and a review date' using errcode = '22023';
  end if;
  select * into matter from public.matters where id = p_matter_id for update;
  if matter.id is null or app.can_read_matter(matter.id) is distinct from true then
    raise exception 'on hold denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    matter.organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[],
    true
  );
  if matter.version is distinct from p_expected_version then
    raise exception 'matter version conflict' using errcode = '40001';
  end if;
  if not exists (
    select 1 from public.memberships mem
    where mem.id = p_owner_membership_id
      and mem.organization_id = matter.organization_id
      and mem.status = 'active'
      and mem.role = any (app.staff_roles())
  ) then
    raise exception 'the hold owner must be active staff' using errcode = '42501';
  end if;
  perform app.open_matter_column(matter.id, 'on_hold');
  update public.matters
  set on_hold = true,
      on_hold_reason = btrim(p_reason),
      on_hold_owner_membership_id = p_owner_membership_id,
      on_hold_review_on = p_review_on
  where id = matter.id
  returning version into new_version;
  perform app.close_matter_column(matter.id);
  perform app.record_audit_event(
    matter.organization_id,
    'matter.on_hold_set',
    'public.matters',
    matter.id,
    'success',
    jsonb_build_object('owner_membership_id', p_owner_membership_id, 'review_on', p_review_on)
  );
  return new_version;
end;
$$;
revoke all on function app.set_matter_on_hold(uuid, integer, text, uuid, date) from public;

create function public.set_matter_on_hold(
  p_matter_id uuid,
  p_expected_version integer,
  p_reason text,
  p_owner_membership_id uuid,
  p_review_on date
)
returns integer
language sql
security invoker
set search_path = ''
as $$
  select app.set_matter_on_hold(p_matter_id, p_expected_version, p_reason, p_owner_membership_id, p_review_on);
$$;
revoke all on function public.set_matter_on_hold(uuid, integer, text, uuid, date) from public, anon;
grant execute on function public.set_matter_on_hold(uuid, integer, text, uuid, date) to authenticated, service_role;

create function app.clear_matter_on_hold(
  p_matter_id uuid,
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
  new_version integer;
begin
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'clearing a hold needs a reason' using errcode = '22023';
  end if;
  select * into matter from public.matters where id = p_matter_id for update;
  if matter.id is null or app.can_read_matter(matter.id) is distinct from true then
    raise exception 'on hold denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    matter.organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[],
    true
  );
  if matter.version is distinct from p_expected_version then
    raise exception 'matter version conflict' using errcode = '40001';
  end if;
  perform app.open_matter_column(matter.id, 'on_hold');
  update public.matters
  set on_hold = false,
      on_hold_reason = null,
      on_hold_owner_membership_id = null,
      on_hold_review_on = null
  where id = matter.id
  returning version into new_version;
  perform app.close_matter_column(matter.id);
  perform app.record_audit_event(
    matter.organization_id,
    'matter.on_hold_cleared',
    'public.matters',
    matter.id,
    'success',
    jsonb_build_object('reason_length', length(btrim(p_reason)))
  );
  return new_version;
end;
$$;
revoke all on function app.clear_matter_on_hold(uuid, integer, text) from public;

create function public.clear_matter_on_hold(
  p_matter_id uuid,
  p_expected_version integer,
  p_reason text
)
returns integer
language sql
security invoker
set search_path = ''
as $$
  select app.clear_matter_on_hold(p_matter_id, p_expected_version, p_reason);
$$;
revoke all on function public.clear_matter_on_hold(uuid, integer, text) from public, anon;
grant execute on function public.clear_matter_on_hold(uuid, integer, text) to authenticated, service_role;

create function app.record_government_status(
  p_matter_id uuid,
  p_status public.government_status,
  p_expected_version integer,
  p_note text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  matter public.matters%rowtype;
  new_version integer;
begin
  if p_note is null or length(btrim(p_note)) < 3 then
    raise exception 'a government status needs a note' using errcode = '22023';
  end if;
  select * into matter from public.matters where id = p_matter_id for update;
  if matter.id is null or app.can_read_matter(matter.id) is distinct from true then
    raise exception 'government status denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    matter.organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[],
    true
  );
  if matter.version is distinct from p_expected_version then
    raise exception 'matter version conflict' using errcode = '40001';
  end if;
  perform app.open_matter_column(matter.id, 'government');
  update public.matters set government_status = p_status where id = matter.id returning version into new_version;
  perform app.close_matter_column(matter.id);
  perform app.record_audit_event(
    matter.organization_id,
    'matter.government_status_recorded',
    'public.matters',
    matter.id,
    'success',
    jsonb_build_object('government_status', p_status, 'stage', matter.stage)
  );
  return new_version;
end;
$$;
revoke all on function app.record_government_status(uuid, public.government_status, integer, text) from public;

create function public.record_government_status(
  p_matter_id uuid,
  p_status public.government_status,
  p_expected_version integer,
  p_note text
)
returns integer
language sql
security invoker
set search_path = ''
as $$
  select app.record_government_status(p_matter_id, p_status, p_expected_version, p_note);
$$;
revoke all on function public.record_government_status(uuid, public.government_status, integer, text) from public, anon;
grant execute on function public.record_government_status(uuid, public.government_status, integer, text)
  to authenticated, service_role;

create function app.record_matter_outcome(
  p_matter_id uuid,
  p_outcome public.matter_outcome,
  p_expected_version integer,
  p_note text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  matter public.matters%rowtype;
  new_version integer;
begin
  if p_note is null or length(btrim(p_note)) < 3 then
    raise exception 'an outcome needs a note' using errcode = '22023';
  end if;
  select * into matter from public.matters where id = p_matter_id for update;
  if matter.id is null or app.can_read_matter(matter.id) is distinct from true then
    raise exception 'outcome denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    matter.organization_id,
    array['licensed_consultant']::public.org_role[],
    true
  );
  if app.actor_licence_blocks_regulated_action(matter.organization_id) then
    raise exception 'not entitled, revoked, suspended, or inactive licence blocks this consultant action'
      using errcode = '42501';
  end if;
  if matter.version is distinct from p_expected_version then
    raise exception 'matter version conflict' using errcode = '40001';
  end if;
  if app.stage_entry_evidence_id(matter.id, 'decision_review') is null then
    raise exception 'an outcome needs official decision evidence' using errcode = '42501';
  end if;
  perform app.open_matter_column(matter.id, 'outcome');
  update public.matters set outcome = p_outcome where id = matter.id returning version into new_version;
  perform app.close_matter_column(matter.id);
  perform app.record_audit_event(
    matter.organization_id,
    'matter.outcome_recorded',
    'public.matters',
    matter.id,
    'success',
    jsonb_build_object('outcome', p_outcome, 'stage', matter.stage, 'government_status', matter.government_status)
  );
  return new_version;
end;
$$;
revoke all on function app.record_matter_outcome(uuid, public.matter_outcome, integer, text) from public;

create function public.record_matter_outcome(
  p_matter_id uuid,
  p_outcome public.matter_outcome,
  p_expected_version integer,
  p_note text
)
returns integer
language sql
security invoker
set search_path = ''
as $$
  select app.record_matter_outcome(p_matter_id, p_outcome, p_expected_version, p_note);
$$;
revoke all on function public.record_matter_outcome(uuid, public.matter_outcome, integer, text) from public, anon;
grant execute on function public.record_matter_outcome(uuid, public.matter_outcome, integer, text)
  to authenticated, service_role;

create function app.record_matter_retention(
  p_matter_id uuid,
  p_expected_version integer,
  p_retention_on date,
  p_reason text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  matter public.matters%rowtype;
  new_version integer;
begin
  if p_retention_on is null or p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'a retention date needs a reason' using errcode = '22023';
  end if;
  select * into matter from public.matters where id = p_matter_id for update;
  if matter.id is null or app.can_read_matter(matter.id) is distinct from true then
    raise exception 'retention denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    matter.organization_id,
    array['firm_owner', 'licensed_consultant']::public.org_role[],
    true
  );
  if matter.version is distinct from p_expected_version then
    raise exception 'matter version conflict' using errcode = '40001';
  end if;
  perform app.open_matter_column(matter.id, 'retention');
  update public.matters set retention_on = p_retention_on where id = matter.id returning version into new_version;
  perform app.close_matter_column(matter.id);
  perform app.record_audit_event(
    matter.organization_id,
    'matter.retention_recorded',
    'public.matters',
    matter.id,
    'success',
    jsonb_build_object('retention_on', p_retention_on)
  );
  return new_version;
end;
$$;
revoke all on function app.record_matter_retention(uuid, integer, date, text) from public;

create function public.record_matter_retention(
  p_matter_id uuid,
  p_expected_version integer,
  p_retention_on date,
  p_reason text
)
returns integer
language sql
security invoker
set search_path = ''
as $$
  select app.record_matter_retention(p_matter_id, p_expected_version, p_retention_on, p_reason);
$$;
revoke all on function public.record_matter_retention(uuid, integer, date, text) from public, anon;
grant execute on function public.record_matter_retention(uuid, integer, date, text) to authenticated, service_role;

create function app.link_successor_matter(
  p_predecessor_id uuid,
  p_successor_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  predecessor public.matters%rowtype;
  successor public.matters%rowtype;
begin
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'linking a matter needs a reason' using errcode = '22023';
  end if;
  if p_predecessor_id = p_successor_id then
    raise exception 'a matter cannot succeed itself' using errcode = '22023';
  end if;
  select * into predecessor from public.matters where id = p_predecessor_id;
  select * into successor from public.matters where id = p_successor_id for update;
  if predecessor.id is null or successor.id is null
     or predecessor.organization_id is distinct from successor.organization_id
     or app.can_read_matter(predecessor.id) is distinct from true
     or app.can_read_matter(successor.id) is distinct from true then
    raise exception 'link denied' using errcode = '42501';
  end if;
  if predecessor.is_sample is distinct from successor.is_sample then
    raise exception 'sample and real records cannot be linked' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    successor.organization_id,
    array['firm_owner', 'licensed_consultant']::public.org_role[],
    true
  );
  if successor.stage is distinct from 'engagement_pending' then
    raise exception 'a successor matter starts at engagement pending' using errcode = '42501';
  end if;
  perform app.open_matter_column(successor.id, 'predecessor');
  update public.matters set predecessor_matter_id = predecessor.id where id = successor.id;
  perform app.close_matter_column(successor.id);
  perform app.record_audit_event(
    successor.organization_id,
    'matter.linked',
    'public.matters',
    successor.id,
    'success',
    jsonb_build_object('predecessor_id', predecessor.id)
  );
  return successor.id;
end;
$$;
revoke all on function app.link_successor_matter(uuid, uuid, text) from public;

create function public.link_successor_matter(
  p_predecessor_id uuid,
  p_successor_id uuid,
  p_reason text
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select app.link_successor_matter(p_predecessor_id, p_successor_id, p_reason);
$$;
revoke all on function public.link_successor_matter(uuid, uuid, text) from public, anon;
grant execute on function public.link_successor_matter(uuid, uuid, text) to authenticated, service_role;

revoke all on table public.matter_engagements from anon, authenticated;
revoke all on table public.matter_program_changes from anon, authenticated;
revoke all on table public.matter_stage_overrides from anon, authenticated;
grant select on table public.matter_engagements to authenticated;
grant select on table public.matter_program_changes to authenticated;
grant select on table public.matter_stage_overrides to authenticated;

alter table public.matter_engagements enable row level security;
alter table public.matter_engagements force row level security;
alter table public.matter_program_changes enable row level security;
alter table public.matter_program_changes force row level security;
alter table public.matter_stage_overrides enable row level security;
alter table public.matter_stage_overrides force row level security;

create policy matter_engagements_select on public.matter_engagements
  for select to authenticated
  using ((select app.can_read_matter(matter_id)));
create policy matter_program_changes_select on public.matter_program_changes
  for select to authenticated
  using ((select app.can_read_matter(matter_id)));
create policy matter_stage_overrides_select on public.matter_stage_overrides
  for select to authenticated
  using ((select app.can_read_matter(matter_id)));

-- Invoker wrappers call these. The definer body still enforces role, step-up, and licence.
grant execute on function app.override_matter_stage(uuid, public.matter_stage, integer, text) to authenticated, service_role;
grant execute on function app.note_proposed_scope(uuid, text) to authenticated, service_role;
grant execute on function app.assign_responsible_consultant(uuid, uuid, integer) to authenticated, service_role;
grant execute on function app.select_matter_program(uuid, uuid, integer, text) to authenticated, service_role;
grant execute on function app.record_matter_engagement(uuid, text, boolean, text, text) to authenticated, service_role;
grant execute on function app.set_matter_on_hold(uuid, integer, text, uuid, date) to authenticated, service_role;
grant execute on function app.clear_matter_on_hold(uuid, integer, text) to authenticated, service_role;
grant execute on function app.record_government_status(uuid, public.government_status, integer, text) to authenticated, service_role;
grant execute on function app.record_matter_outcome(uuid, public.matter_outcome, integer, text) to authenticated, service_role;
grant execute on function app.record_matter_retention(uuid, integer, date, text) to authenticated, service_role;
grant execute on function app.link_successor_matter(uuid, uuid, text) to authenticated, service_role;
