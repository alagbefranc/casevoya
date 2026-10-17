-- Matter stage changes go through app.transition_matter_stage (PRD §7, T023 minimal).
-- Direct stage updates are rejected. Entry evidence and the allowed edges are checked.
-- Submitted and every later stage, in either direction, require a licensed consultant.
-- History is append-only. On-hold, reference numbers, and task rows stay later tasks.

create type public.matter_stage_evidence_kind as enum (
  'engagement_prerequisites',
  'service_agreement',
  'service_agreement_exception',
  'questionnaire_assigned',
  'facts_reviewed',
  'draft_package',
  'client_review_package',
  'submission_approvals',
  'submission_confirmation',
  'verified_submission',
  'official_decision',
  'outcome_and_follow_up',
  'closure'
);

create table public.matter_stage_evidence (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  matter_id uuid not null,
  kind public.matter_stage_evidence_kind not null,
  summary text not null check (length(btrim(summary)) between 1 and 500),
  external_reference text,
  submission_at timestamptz,
  receipt_locator text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id),
  constraint matter_stage_evidence_submission_ck check (
    kind <> 'submission_confirmation'
    or (
      external_reference is not null
      and length(btrim(external_reference)) between 1 and 200
      and submission_at is not null
      and receipt_locator is not null
      and length(btrim(receipt_locator)) between 1 and 500
    )
  )
);
comment on table public.matter_stage_evidence is
  'Evidence required to enter a matter stage. Submission confirmation stores reference, time, and receipt locator.';

create index matter_stage_evidence_matter_idx
  on public.matter_stage_evidence (matter_id, kind);
create index matter_stage_evidence_created_by_idx on public.matter_stage_evidence (created_by);

create trigger matter_stage_evidence_touch before update on public.matter_stage_evidence
  for each row execute function app.touch_row();
create trigger matter_stage_evidence_immutable before update on public.matter_stage_evidence
  for each row execute function app.guard_tenant_keys();
create trigger matter_stage_evidence_stamp before insert on public.matter_stage_evidence
  for each row execute function app.stamp_created_by();
create trigger matter_stage_evidence_audit after insert or update or delete on public.matter_stage_evidence
  for each row execute function app.audit_row_change();

create table public.matter_stage_transitions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  matter_id uuid not null,
  from_stage public.matter_stage not null,
  to_stage public.matter_stage not null,
  reason text not null check (length(btrim(reason)) between 3 and 500),
  evidence_id uuid,
  actor_user_id uuid,
  from_version integer not null check (from_version >= 1),
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id),
  foreign key (evidence_id, organization_id) references public.matter_stage_evidence (id, organization_id)
);
comment on table public.matter_stage_transitions is
  'Append-only stage history. A reverse transition is a new row; the prior row stays.';

create index matter_stage_transitions_matter_idx
  on public.matter_stage_transitions (matter_id, created_at);
create index matter_stage_transitions_actor_idx on public.matter_stage_transitions (actor_user_id);

create trigger matter_stage_transitions_audit after insert or update or delete on public.matter_stage_transitions
  for each row execute function app.audit_row_change();

-- Nonce the transition function writes. Authenticated has no privilege on it,
-- so a direct UPDATE cannot satisfy the stage guard.
create table app.matter_stage_transition_nonce (
  matter_id uuid primary key,
  txid bigint not null
);
revoke all on table app.matter_stage_transition_nonce from public, anon, authenticated, service_role;

create function app.matter_stage_transition_allowed(
  p_from public.matter_stage,
  p_to public.matter_stage
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (p_from, p_to) in (
    ('engagement_pending', 'intake'),
    ('intake', 'engagement_pending'),
    ('intake', 'evidence_collection'),
    ('evidence_collection', 'intake'),
    ('evidence_collection', 'preparation'),
    ('preparation', 'evidence_collection'),
    ('preparation', 'consultant_review'),
    ('consultant_review', 'preparation'),
    ('consultant_review', 'client_confirmation'),
    ('client_confirmation', 'consultant_review'),
    ('client_confirmation', 'preparation'),
    ('client_confirmation', 'ready_to_submit'),
    ('ready_to_submit', 'client_confirmation'),
    ('ready_to_submit', 'submitted'),
    ('submitted', 'ready_to_submit'),
    ('submitted', 'government_processing'),
    ('government_processing', 'submitted'),
    ('government_processing', 'decision_review'),
    ('decision_review', 'government_processing'),
    ('decision_review', 'post_decision'),
    ('post_decision', 'decision_review'),
    ('post_decision', 'closed'),
    ('closed', 'post_decision'),
    ('closed', 'engagement_pending')
  );
$$;

create function app.matter_stage_is_regulated(
  p_from public.matter_stage,
  p_to public.matter_stage
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_from in (
      'submitted', 'government_processing', 'decision_review', 'post_decision', 'closed'
    )
    or p_to in (
      'submitted', 'government_processing', 'decision_review', 'post_decision', 'closed'
    );
$$;

create function app.stage_entry_evidence_id(
  p_matter_id uuid,
  p_stage public.matter_stage
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select evidence.id
  from public.matter_stage_evidence evidence
  where evidence.matter_id = p_matter_id
    and (
      (p_stage = 'engagement_pending' and evidence.kind = 'engagement_prerequisites')
      or (p_stage = 'intake' and evidence.kind in ('service_agreement', 'service_agreement_exception'))
      or (p_stage = 'evidence_collection' and evidence.kind = 'questionnaire_assigned')
      or (p_stage = 'preparation' and evidence.kind = 'facts_reviewed')
      or (p_stage = 'consultant_review' and evidence.kind = 'draft_package')
      or (p_stage = 'client_confirmation' and evidence.kind = 'client_review_package')
      or (p_stage = 'ready_to_submit' and evidence.kind = 'submission_approvals')
      or (p_stage = 'submitted' and evidence.kind = 'submission_confirmation')
      or (p_stage = 'government_processing' and evidence.kind = 'verified_submission')
      or (p_stage = 'decision_review' and evidence.kind = 'official_decision')
      or (p_stage = 'post_decision' and evidence.kind = 'outcome_and_follow_up')
      or (p_stage = 'closed' and evidence.kind = 'closure')
    )
  order by evidence.created_at desc
  limit 1;
$$;

create function app.can_record_stage_evidence(p_matter_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.matters matter
    where matter.id = p_matter_id
      and app.in_active_org(matter.organization_id)
      and app.staff_mfa_satisfied()
      and app.can_read_matter(matter.id)
      and app.has_org_role(
        matter.organization_id,
        array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[]
      )
  );
$$;

create function app.guard_matter_stage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and new.stage is distinct from 'engagement_pending' then
    raise exception 'new matters start at engagement pending' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.stage is distinct from old.stage then
    if not exists (
      select 1
      from app.matter_stage_transition_nonce nonce
      where nonce.matter_id = new.id
        and nonce.txid = txid_current()
    ) then
      raise exception 'matter stage changes go through app.transition_matter_stage'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function app.guard_matter_stage() from public;

create trigger matters_stage_guard before insert or update on public.matters
  for each row execute function app.guard_matter_stage();

create function app.transition_matter_stage(
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

create function public.transition_matter_stage(
  p_matter_id uuid,
  p_to_stage public.matter_stage,
  p_expected_version integer,
  p_reason text
)
returns integer
language sql
security invoker
set search_path = ''
as $$
  select app.transition_matter_stage(p_matter_id, p_to_stage, p_expected_version, p_reason);
$$;

revoke all on function app.matter_stage_transition_allowed(public.matter_stage, public.matter_stage) from public;
revoke all on function app.matter_stage_is_regulated(public.matter_stage, public.matter_stage) from public;
revoke all on function app.stage_entry_evidence_id(uuid, public.matter_stage) from public;
revoke all on function app.can_record_stage_evidence(uuid) from public;
revoke all on function app.transition_matter_stage(uuid, public.matter_stage, integer, text) from public;
revoke all on function public.transition_matter_stage(uuid, public.matter_stage, integer, text) from public, anon;

grant execute on function app.matter_stage_transition_allowed(public.matter_stage, public.matter_stage) to authenticated, service_role;
grant execute on function app.matter_stage_is_regulated(public.matter_stage, public.matter_stage) to authenticated, service_role;
grant execute on function app.stage_entry_evidence_id(uuid, public.matter_stage) to authenticated, service_role;
grant execute on function app.can_record_stage_evidence(uuid) to authenticated, service_role;
grant execute on function app.transition_matter_stage(uuid, public.matter_stage, integer, text) to authenticated, service_role;
grant execute on function public.transition_matter_stage(uuid, public.matter_stage, integer, text) to authenticated, service_role;

revoke all on table public.matter_stage_evidence from anon, authenticated;
revoke all on table public.matter_stage_transitions from anon, authenticated;
grant select, insert on table public.matter_stage_evidence to authenticated;
grant select on table public.matter_stage_transitions to authenticated;

alter table public.matter_stage_evidence enable row level security;
alter table public.matter_stage_evidence force row level security;
alter table public.matter_stage_transitions enable row level security;
alter table public.matter_stage_transitions force row level security;

create policy matter_stage_evidence_select on public.matter_stage_evidence
  for select to authenticated
  using ((select app.can_read_matter(matter_id)));
create policy matter_stage_evidence_insert on public.matter_stage_evidence
  for insert to authenticated
  with check ((select app.can_record_stage_evidence(matter_id)));

create policy matter_stage_transitions_select on public.matter_stage_transitions
  for select to authenticated
  using ((select app.can_read_matter(matter_id)));
