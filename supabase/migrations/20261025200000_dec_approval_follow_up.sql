-- DEC-02 approval follow-up (PRD §14 DEC-02): the follow-up checklist an approval adds to the
-- matter, the conditions summary a licensed consultant approves before the client sees it, and the
-- record of which decision documents went to the client, how, when, and the acknowledgement.
--
-- Built on T038/T039 (20261019202100_government_handoff_decisions.sql): decision_records,
-- decision_follow_ups (the closure tasks confirm_decision opens on an approval), and the gov_*
-- helpers (write nonce, append-only guard, licensed check, staff scope).
--
-- 1. Official follow-up steps (public.approval_follow_up_steps). A step done after an approval for a
--    program, as a firm read it on an official IRCC / Government of Canada page. It follows GOV-01's
--    public.submission_requirements (20261025170000_gov_submission_checklist.sql) field for field:
--    source URL with its section anchor, form number and "date modified", the date staff checked
--    the page, the page's "current to" date, the source identity and page snapshot in the existing
--    source governance tables (official_sources, source_snapshots), pending until a licensed member
--    approves it with a fresh step-up, and approved only with its page snapshot hash. A timing is
--    stored only as the page words it (timing_text); nothing computes a date from it. Nothing is
--    seeded. It is its own table because submission_requirements is keyed by submission channel
--    and its functions belong to GOV; this one adds no second review model, only the same one.
-- 2. The follow-up checklist. Once an approval is recorded on a matter the Decisions tab shows the
--    checklist: the closure tasks the confirmation opened (ordinary tasks, ticked through
--    app.set_task_status) and the approved official steps for the matter's program. Ticking an
--    official step is an append-only event (public.approval_follow_up_events) with who and when;
--    the latest event per step is its state. Ticks open once a licensed consultant confirms the
--    approval.
-- 3. Conditions summary (public.conditions_summaries). Staff draft it; a licensed consultant (fresh
--    step-up, no licence block) approves it. Each approval is a numbered version; the approved text
--    and its SHA-256 never change; a newer approval supersedes the older one. Only the current
--    approved version reaches the client, through public.portal_decision_follow_up, labelled as
--    the firm's summary. Approving it completes the "Send consultant-approved conditions summary"
--    follow-up task when that task is open.
-- 4. Delivery record (public.decision_deliveries). Which stored decision document went to the
--    client, how (portal, email, in person, mail) and when. The client acknowledges it in the
--    portal, or staff record the acknowledgement with evidence (a file on the matter or a written
--    note of what shows it). Recording a delivery completes the "Record document delivery" task
--    when that task is open.
--
-- Nothing here sends email (no approved design for it) or moves money. Dates are the firm's
-- (app.firm_today). Forced RLS on every new table; writes only through the SECURITY DEFINER
-- functions here. No function owned by another builder is redefined. Additive only.

-- ---------------------------------------------------------------------------
-- 1. Official follow-up steps, entered from an official page, approved before use
-- ---------------------------------------------------------------------------
create table public.approval_follow_up_steps (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  program_key text not null check (program_key ~ '^[a-z0-9_]{1,80}$'),
  label text not null check (length(btrim(label)) between 3 and 300),
  timing_text text check (timing_text is null or length(btrim(timing_text)) between 3 and 300),
  source_id uuid not null,
  snapshot_id uuid,
  source_url text not null check (length(source_url) between 12 and 500),
  source_section text check (source_section is null or length(btrim(source_section)) between 1 and 200),
  form_number text check (form_number is null or length(btrim(form_number)) between 2 and 40),
  form_modified_on date,
  checked_on date not null,
  current_to date,
  snapshot_sha256 text check (snapshot_sha256 is null or snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending_review' check (status in ('pending_review', 'approved', 'rejected', 'retired')),
  reviewed_by_membership_id uuid,
  reviewed_at timestamptz,
  review_note text check (review_note is null or length(btrim(review_note)) between 3 and 500),
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id),
  check (form_modified_on is null or form_number is not null),
  check ((snapshot_id is null) = (snapshot_sha256 is null)),
  check (status not in ('approved', 'rejected', 'retired') or (reviewed_by_membership_id is not null and reviewed_at is not null)),
  check (status <> 'approved' or snapshot_sha256 is not null),
  check ((status = 'retired') = (retired_at is not null)),
  foreign key (reviewed_by_membership_id, organization_id) references public.memberships (id, organization_id),
  foreign key (source_id, organization_id) references public.official_sources (id, organization_id),
  foreign key (snapshot_id, organization_id) references public.source_snapshots (id, organization_id)
);
comment on table public.approval_follow_up_steps is
  'A step after an approval for a program, as a firm read it on an official IRCC / Government of Canada page (DEC-02). Source URL with anchor, form number and date modified, date checked, current-to date and snapshot hash stored with it; any timing only as the page words it. Pending until a licensed member approves it. Never seeded.';
comment on column public.approval_follow_up_steps.timing_text is
  'The timing exactly as the official page states it, when it states one. Never a default; no date is computed from it.';
comment on column public.approval_follow_up_steps.checked_on is
  'The date staff checked the official page (firm date). Not an effective date.';

create index approval_follow_up_steps_org_status_idx on public.approval_follow_up_steps (organization_id, status, program_key);
create index approval_follow_up_steps_reviewer_org_fk_idx on public.approval_follow_up_steps (reviewed_by_membership_id, organization_id);
create index approval_follow_up_steps_source_org_fk_idx on public.approval_follow_up_steps (source_id, organization_id);
create index approval_follow_up_steps_snapshot_org_fk_idx on public.approval_follow_up_steps (snapshot_id, organization_id);
create index approval_follow_up_steps_created_by_idx on public.approval_follow_up_steps (created_by);

create trigger approval_follow_up_steps_url before insert or update on public.approval_follow_up_steps
  for each row execute function app.enforce_allowlisted_urls('source_url');
create trigger approval_follow_up_steps_touch before update on public.approval_follow_up_steps
  for each row execute function app.touch_row();
create trigger approval_follow_up_steps_keys before update on public.approval_follow_up_steps
  for each row execute function app.guard_tenant_keys();
create trigger approval_follow_up_steps_stamp before insert on public.approval_follow_up_steps
  for each row execute function app.stamp_created_by();
create trigger approval_follow_up_steps_guard before update or delete on public.approval_follow_up_steps
  for each row execute function app.gov_guard_update();
create trigger approval_follow_up_steps_audit after insert or update or delete on public.approval_follow_up_steps
  for each row execute function app.audit_row_change();

-- The source identity and snapshot of a step never change after it is entered.
create function app.approval_follow_up_step_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.program_key, new.label, new.timing_text, new.source_id, new.snapshot_id, new.source_url, new.source_section,
      new.form_number, new.form_modified_on, new.checked_on, new.current_to, new.snapshot_sha256)
     is distinct from
     (old.program_key, old.label, old.timing_text, old.source_id, old.snapshot_id, old.source_url, old.source_section,
      old.form_number, old.form_modified_on, old.checked_on, old.current_to, old.snapshot_sha256) then
    raise exception 'an official step is not edited; enter a new one and retire this one' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.approval_follow_up_step_immutable() from public;
create trigger approval_follow_up_steps_immutable before update on public.approval_follow_up_steps
  for each row execute function app.approval_follow_up_step_immutable();

-- ---------------------------------------------------------------------------
-- 2. Checklist ticks on official steps (closure tasks keep their own task history)
-- ---------------------------------------------------------------------------
create table public.approval_follow_up_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  matter_id uuid not null,
  decision_id uuid not null,
  step_id uuid not null,
  ticked boolean not null,
  membership_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid references auth.users (id),
  unique (id, organization_id),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id),
  foreign key (decision_id, organization_id) references public.decision_records (id, organization_id),
  foreign key (step_id, organization_id) references public.approval_follow_up_steps (id, organization_id),
  foreign key (membership_id, organization_id) references public.memberships (id, organization_id)
);
comment on table public.approval_follow_up_events is
  'An official follow-up step ticked or unticked on a matter after its approval (DEC-02), with who and when. Append-only; the latest event per step and matter is its state.';

create index approval_follow_up_events_item_idx on public.approval_follow_up_events (matter_id, step_id, created_at desc);
create index approval_follow_up_events_org_fk_idx on public.approval_follow_up_events (organization_id);
create index approval_follow_up_events_matter_org_fk_idx on public.approval_follow_up_events (matter_id, organization_id);
create index approval_follow_up_events_decision_org_fk_idx on public.approval_follow_up_events (decision_id, organization_id);
create index approval_follow_up_events_step_org_fk_idx on public.approval_follow_up_events (step_id, organization_id);
create index approval_follow_up_events_member_org_fk_idx on public.approval_follow_up_events (membership_id, organization_id);
create index approval_follow_up_events_created_by_idx on public.approval_follow_up_events (created_by);

create trigger approval_follow_up_events_stamp before insert on public.approval_follow_up_events
  for each row execute function app.stamp_created_by();
create trigger approval_follow_up_events_append_only before update or delete on public.approval_follow_up_events
  for each row execute function app.gov_reject_mutation();
create trigger approval_follow_up_events_audit after insert on public.approval_follow_up_events
  for each row execute function app.audit_row_change();

-- ---------------------------------------------------------------------------
-- 3. Conditions summary: drafted by staff, approved by a licensed consultant, versioned
-- ---------------------------------------------------------------------------
create table public.conditions_summaries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  matter_id uuid not null,
  decision_id uuid not null,
  number integer check (number is null or number >= 1),
  body text not null check (length(btrim(body)) between 20 and 8000),
  status text not null default 'draft' check (status in ('draft', 'approved', 'superseded')),
  drafted_by_membership_id uuid not null,
  approved_by_membership_id uuid,
  approved_at timestamptz,
  body_sha256 text check (body_sha256 is null or body_sha256 ~ '^[0-9a-f]{64}$'),
  superseded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id),
  unique (matter_id, number),
  check (
    status = 'draft'
    or (number is not null and approved_by_membership_id is not null and approved_at is not null and body_sha256 is not null)
  ),
  check (status = 'draft' or number is not null),
  check ((status = 'superseded') = (superseded_at is not null)),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id),
  foreign key (decision_id, organization_id) references public.decision_records (id, organization_id),
  foreign key (drafted_by_membership_id, organization_id) references public.memberships (id, organization_id),
  foreign key (approved_by_membership_id, organization_id) references public.memberships (id, organization_id)
);
comment on table public.conditions_summaries is
  'The firm''s plain-language summary of an approval''s conditions (DEC-02). Staff draft it; a licensed consultant approves it after a fresh step-up. Approved versions are numbered, their text and SHA-256 never change, and a newer approval supersedes the older. Only the current approved version reaches the client, as the firm''s summary.';

create unique index conditions_summaries_one_draft_uidx on public.conditions_summaries (matter_id) where status = 'draft';
create unique index conditions_summaries_one_current_uidx on public.conditions_summaries (matter_id) where status = 'approved';
create index conditions_summaries_matter_idx on public.conditions_summaries (matter_id, created_at desc);
create index conditions_summaries_org_fk_idx on public.conditions_summaries (organization_id);
create index conditions_summaries_matter_org_fk_idx on public.conditions_summaries (matter_id, organization_id);
create index conditions_summaries_decision_org_fk_idx on public.conditions_summaries (decision_id, organization_id);
create index conditions_summaries_drafter_org_fk_idx on public.conditions_summaries (drafted_by_membership_id, organization_id);
create index conditions_summaries_approver_org_fk_idx on public.conditions_summaries (approved_by_membership_id, organization_id);
create index conditions_summaries_created_by_idx on public.conditions_summaries (created_by);

create trigger conditions_summaries_touch before update on public.conditions_summaries
  for each row execute function app.touch_row();
create trigger conditions_summaries_keys before update on public.conditions_summaries
  for each row execute function app.guard_tenant_keys();
create trigger conditions_summaries_stamp before insert on public.conditions_summaries
  for each row execute function app.stamp_created_by();
create trigger conditions_summaries_guard before update or delete on public.conditions_summaries
  for each row execute function app.gov_guard_update();
create trigger conditions_summaries_audit after insert or update or delete on public.conditions_summaries
  for each row execute function app.audit_row_change();

-- An approved version's text, number and approval never change; it can only be superseded.
create function app.conditions_summary_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status <> 'draft' and (
    (new.body, new.number, new.approved_by_membership_id, new.approved_at, new.body_sha256, new.decision_id)
    is distinct from
    (old.body, old.number, old.approved_by_membership_id, old.approved_at, old.body_sha256, old.decision_id)
  ) then
    raise exception 'an approved summary is not edited; draft a new version' using errcode = '42501';
  end if;
  if old.status = 'superseded' and new.status is distinct from 'superseded' then
    raise exception 'a superseded summary stays superseded' using errcode = '42501';
  end if;
  if old.status = 'approved' and new.status not in ('approved', 'superseded') then
    raise exception 'an approved summary is only superseded' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.conditions_summary_immutable() from public;
create trigger conditions_summaries_immutable before update on public.conditions_summaries
  for each row execute function app.conditions_summary_immutable();

-- ---------------------------------------------------------------------------
-- 4. Delivery record of decision documents, with acknowledgement
-- ---------------------------------------------------------------------------
create table public.decision_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  matter_id uuid not null,
  decision_id uuid not null,
  document_version_id uuid not null,
  document_label text not null check (length(btrim(document_label)) between 1 and 300),
  method text not null check (method in ('portal', 'email', 'in_person', 'mail')),
  delivered_at timestamptz not null,
  note text check (note is null or length(btrim(note)) between 3 and 500),
  delivered_by_membership_id uuid not null,
  acknowledgement text check (acknowledgement is null or acknowledgement in ('client_portal', 'staff_recorded')),
  acknowledged_at timestamptz,
  acknowledged_on date,
  acknowledged_by_user_id uuid references auth.users (id),
  ack_recorded_by_membership_id uuid,
  ack_evidence_version_id uuid,
  ack_evidence_note text check (ack_evidence_note is null or length(btrim(ack_evidence_note)) between 10 and 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id),
  check ((acknowledgement is null) = (acknowledged_at is null)),
  check ((acknowledgement is null) = (acknowledged_on is null)),
  check (acknowledgement is distinct from 'client_portal' or acknowledged_by_user_id is not null),
  check (
    acknowledgement is distinct from 'staff_recorded'
    or (ack_recorded_by_membership_id is not null and (ack_evidence_version_id is not null or ack_evidence_note is not null))
  ),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id),
  foreign key (decision_id, organization_id) references public.decision_records (id, organization_id),
  foreign key (document_version_id, organization_id) references public.document_versions (id, organization_id),
  foreign key (delivered_by_membership_id, organization_id) references public.memberships (id, organization_id),
  foreign key (ack_recorded_by_membership_id, organization_id) references public.memberships (id, organization_id),
  foreign key (ack_evidence_version_id, organization_id) references public.document_versions (id, organization_id)
);
comment on table public.decision_deliveries is
  'Which decision document (a stored file on the matter) went to the client, how and when (DEC-02), and its acknowledgement: by the client in the portal, or recorded by staff with evidence. The delivery facts never change; the acknowledgement is added once.';

create index decision_deliveries_matter_idx on public.decision_deliveries (matter_id, delivered_at desc);
create index decision_deliveries_org_fk_idx on public.decision_deliveries (organization_id);
create index decision_deliveries_matter_org_fk_idx on public.decision_deliveries (matter_id, organization_id);
create index decision_deliveries_decision_org_fk_idx on public.decision_deliveries (decision_id, organization_id);
create index decision_deliveries_version_org_fk_idx on public.decision_deliveries (document_version_id, organization_id);
create index decision_deliveries_deliverer_org_fk_idx on public.decision_deliveries (delivered_by_membership_id, organization_id);
create index decision_deliveries_ack_member_org_fk_idx on public.decision_deliveries (ack_recorded_by_membership_id, organization_id);
create index decision_deliveries_ack_version_org_fk_idx on public.decision_deliveries (ack_evidence_version_id, organization_id);
create index decision_deliveries_ack_user_idx on public.decision_deliveries (acknowledged_by_user_id);
create index decision_deliveries_created_by_idx on public.decision_deliveries (created_by);

create trigger decision_deliveries_touch before update on public.decision_deliveries
  for each row execute function app.touch_row();
create trigger decision_deliveries_keys before update on public.decision_deliveries
  for each row execute function app.guard_tenant_keys();
create trigger decision_deliveries_stamp before insert on public.decision_deliveries
  for each row execute function app.stamp_created_by();
create trigger decision_deliveries_guard before update or delete on public.decision_deliveries
  for each row execute function app.gov_guard_update();
create trigger decision_deliveries_audit after insert or update or delete on public.decision_deliveries
  for each row execute function app.audit_row_change();

create function app.decision_delivery_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.matter_id, new.decision_id, new.document_version_id, new.document_label, new.method, new.delivered_at, new.note, new.delivered_by_membership_id)
     is distinct from
     (old.matter_id, old.decision_id, old.document_version_id, old.document_label, old.method, old.delivered_at, old.note, old.delivered_by_membership_id) then
    raise exception 'a recorded delivery is not edited' using errcode = '42501';
  end if;
  if old.acknowledgement is not null and (
    (new.acknowledgement, new.acknowledged_at, new.acknowledged_on, new.acknowledged_by_user_id, new.ack_recorded_by_membership_id, new.ack_evidence_version_id, new.ack_evidence_note)
    is distinct from
    (old.acknowledgement, old.acknowledged_at, old.acknowledged_on, old.acknowledged_by_user_id, old.ack_recorded_by_membership_id, old.ack_evidence_version_id, old.ack_evidence_note)
  ) then
    raise exception 'this delivery is already acknowledged' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.decision_delivery_immutable() from public;
create trigger decision_deliveries_immutable before update on public.decision_deliveries
  for each row execute function app.decision_delivery_immutable();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- The matter's latest approval, recorded or confirmed, or null.
create function app.dec_latest_approval(p_matter_id uuid)
returns public.decision_records
language sql
stable
security definer
set search_path = ''
as $$
  select decision.*
  from public.decision_records decision
  where decision.matter_id = p_matter_id and decision.outcome = 'approved'
  order by (decision.state = 'confirmed') desc, decision.confirmed_at desc nulls last, decision.created_at desc
  limit 1;
$$;
revoke all on function app.dec_latest_approval(uuid) from public;

-- A matter this member works on, locked, with its confirmed approval. Raises otherwise.
create function app.dec_open_approved_matter(p_matter_id uuid, p_roles public.org_role[], p_licensed boolean)
returns public.decision_records
language plpgsql
security definer
set search_path = ''
as $$
declare
  matter public.matters%rowtype;
  decision public.decision_records%rowtype;
begin
  select * into matter from public.matters where id = p_matter_id for update;
  if matter.id is null or app.can_read_matter(matter.id) is distinct from true then
    raise exception 'approval follow-up denied' using errcode = '42501';
  end if;
  if p_licensed then
    perform app.gov_require_licensed(matter.organization_id);
  else
    perform app.require_active_staff(matter.organization_id, p_roles, false);
  end if;
  decision := app.dec_latest_approval(matter.id);
  if decision.id is null then
    raise exception 'record the approval from its decision letter first' using errcode = '42501';
  end if;
  if decision.state is distinct from 'confirmed' then
    raise exception 'follow-ups start after the consultant confirms the approval' using errcode = '42501';
  end if;
  return decision;
end;
$$;
revoke all on function app.dec_open_approved_matter(uuid, public.org_role[], boolean) from public;

-- Completes the matter's open decision follow-up tasks of one kind, unless a dependency is open.
create function app.dec_complete_follow_up(p_matter_id uuid, p_kind public.decision_follow_up_kind)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  item record;
  done integer := 0;
begin
  for item in
    select task.id, task.version
    from public.decision_follow_ups follow
    join public.decision_records decision on decision.id = follow.decision_id
    join public.tasks task on task.id = follow.task_id
    where decision.matter_id = p_matter_id
      and follow.kind = p_kind
      and task.status = 'open'
      and not exists (
        select 1 from public.task_dependencies dep
        join public.tasks earlier on earlier.id = dep.depends_on_task_id
        where dep.task_id = task.id and earlier.status in ('open', 'blocked')
      )
  loop
    perform app.set_task_status(item.id, item.version, 'done', null);
    done := done + 1;
  end loop;
  return done;
end;
$$;
revoke all on function app.dec_complete_follow_up(uuid, public.decision_follow_up_kind) from public;

-- ---------------------------------------------------------------------------
-- Official steps: propose, review (licensed, step-up), retire
-- ---------------------------------------------------------------------------
create function app.propose_approval_follow_up_step(
  p_org uuid,
  p_program_key text,
  p_label text,
  p_timing_text text,
  p_source_url text,
  p_source_section text,
  p_form_number text,
  p_form_modified_on date,
  p_checked_on date,
  p_current_to date,
  p_snapshot jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  url text := btrim(coalesce(p_source_url, ''));
  v_timing text := nullif(btrim(coalesce(p_timing_text, '')), '');
  canonical text;
  v_host text;
  publisher_name text;
  today date;
  src uuid;
  snap uuid;
  snap_hash text;
  snap_url text;
  snap_at timestamptz;
  new_id uuid;
begin
  if p_org is null or p_org is distinct from app.current_organization_id() then
    raise exception 'approval follow-up denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(p_org, array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[], false);
  today := app.firm_today(p_org);
  if p_program_key is null or p_program_key !~ '^[a-z0-9_]{1,80}$' then
    raise exception 'choose the program the step applies to' using errcode = '22023';
  end if;
  if p_label is null or length(btrim(p_label)) not between 3 and 300 then
    raise exception 'write the step as the official page gives it' using errcode = '22023';
  end if;
  if v_timing is not null and length(v_timing) not between 3 and 300 then
    raise exception 'write the timing as the official page gives it, or leave it empty' using errcode = '22023';
  end if;
  v_host := app.federal_official_url(url);
  if v_host is null then
    raise exception 'the source must be an official Government of Canada page (canada.ca or gc.ca)' using errcode = '22023';
  end if;
  if position('#' in url) = 0 and nullif(btrim(coalesce(p_source_section, '')), '') is null then
    raise exception 'name the section of the page, or give its link with the section anchor' using errcode = '22023';
  end if;
  if p_checked_on is null or p_checked_on > today or p_checked_on < today - 366 then
    raise exception 'the date checked is required, within the last year and not in the future' using errcode = '22023';
  end if;
  if p_form_modified_on is not null and (p_form_number is null or p_form_modified_on > today) then
    raise exception 'a form''s date modified needs its form number and cannot be in the future' using errcode = '22023';
  end if;
  if p_current_to is not null and p_current_to > today then
    raise exception 'a current-to date cannot be in the future' using errcode = '22023';
  end if;
  if p_snapshot is not null then
    snap_hash := lower(btrim(coalesce(p_snapshot ->> 'sha256', '')));
    snap_url := btrim(coalesce(p_snapshot ->> 'final_url', url));
    snap_at := (p_snapshot ->> 'retrieved_at')::timestamptz;
    if snap_hash !~ '^[0-9a-f]{64}$' then
      raise exception 'the page hash is invalid' using errcode = '22023';
    end if;
    if snap_at is null or snap_at > statement_timestamp() + interval '5 minutes' or snap_at < statement_timestamp() - interval '1 day' then
      raise exception 'the retrieval time must be now' using errcode = '22023';
    end if;
    if app.federal_official_url(snap_url) is null then
      raise exception 'the source must be an official Government of Canada page (canada.ca or gc.ca)' using errcode = '22023';
    end if;
  end if;

  canonical := split_part(url, '#', 1);
  select domain.authority into publisher_name
  from public.official_source_domains domain
  where domain.active and (v_host = domain.host or right(v_host, length(domain.host) + 1) = '.' || domain.host)
  order by length(domain.host) desc
  limit 1;

  select source.id into src
  from public.official_sources source
  where source.organization_id = p_org and source.canonical_url = canonical;
  if src is null then
    insert into public.official_sources (organization_id, publisher, canonical_url, allowed_host, jurisdiction, content_kind, title, source_language)
    values (p_org, coalesce(publisher_name, 'Government of Canada'), canonical, v_host, 'CA', 'program_guidance',
            left(nullif(btrim(coalesce(p_source_section, '')), ''), 300), 'en')
    returning id into src;
  end if;
  if snap_hash is not null then
    -- The snapshot number is assigned by app.prepare_source_snapshot.
    insert into public.source_snapshots (
      organization_id, source_id, snapshot_number, final_url, publisher, retrieved_at, current_to, content_hash,
      retrieval_result, http_status, review_status
    ) values (
      p_org, src, 1, snap_url, coalesce(publisher_name, 'Government of Canada'), snap_at, p_current_to, snap_hash,
      'success', nullif(p_snapshot ->> 'http_status', '')::integer, 'evidence_captured'
    )
    returning id into snap;
  end if;

  insert into public.approval_follow_up_steps (
    organization_id, program_key, label, timing_text, source_id, snapshot_id, source_url, source_section,
    form_number, form_modified_on, checked_on, current_to, snapshot_sha256
  ) values (
    p_org, p_program_key, btrim(p_label), v_timing, src, snap, url, nullif(btrim(coalesce(p_source_section, '')), ''),
    nullif(upper(btrim(coalesce(p_form_number, ''))), ''), p_form_modified_on, p_checked_on, p_current_to, snap_hash
  )
  returning id into new_id;
  perform app.record_audit_event(
    p_org, 'decision.follow_up_step_entered', 'public.approval_follow_up_steps', new_id, 'success',
    jsonb_build_object('program_key', p_program_key, 'source_url', url, 'snapshot_sha256', snap_hash)
  );
  return new_id;
end;
$$;
revoke all on function app.propose_approval_follow_up_step(uuid, text, text, text, text, text, text, date, date, date, jsonb) from public;

create function app.review_approval_follow_up_step(p_step_id uuid, p_expected_version integer, p_decision text, p_note text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  step public.approval_follow_up_steps%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  new_version integer;
begin
  select * into step from public.approval_follow_up_steps where id = p_step_id for update;
  if step.id is null or step.organization_id is distinct from app.current_organization_id() then
    raise exception 'step review denied' using errcode = '42501';
  end if;
  perform app.gov_require_licensed(step.organization_id);
  if step.version is distinct from p_expected_version then
    raise exception 'step version conflict' using errcode = 'PT409';
  end if;
  if step.status <> 'pending_review' then
    raise exception 'nothing is waiting for review' using errcode = '22023';
  end if;
  if p_decision is null or p_decision not in ('approved', 'rejected') then
    raise exception 'unknown decision' using errcode = '22023';
  end if;
  if p_decision = 'rejected' and (v_note is null or length(v_note) < 3) then
    raise exception 'say why it''s rejected' using errcode = '22023';
  end if;
  if p_decision = 'approved' and step.snapshot_sha256 is null then
    raise exception 'a step goes live only with a snapshot of its official page; enter it again when the page can be fetched' using errcode = '42501';
  end if;
  perform app.gov_open_write(step.id);
  update public.approval_follow_up_steps
  set status = p_decision, reviewed_by_membership_id = app.gov_actor_membership(step.organization_id),
      reviewed_at = statement_timestamp(), review_note = left(v_note, 500)
  where id = step.id
  returning version into new_version;
  perform app.gov_close_write(step.id);
  perform app.record_audit_event(
    step.organization_id, 'decision.follow_up_step_' || p_decision, 'public.approval_follow_up_steps', step.id, 'success',
    jsonb_build_object('program_key', step.program_key, 'source_url', step.source_url, 'snapshot_sha256', step.snapshot_sha256)
  );
  return new_version;
end;
$$;
revoke all on function app.review_approval_follow_up_step(uuid, integer, text, text) from public;

create function app.retire_approval_follow_up_step(p_step_id uuid, p_expected_version integer, p_reason text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  step public.approval_follow_up_steps%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  new_version integer;
begin
  if v_reason is null or length(v_reason) not between 3 and 500 then
    raise exception 'say why it''s retired' using errcode = '22023';
  end if;
  select * into step from public.approval_follow_up_steps where id = p_step_id for update;
  if step.id is null or step.organization_id is distinct from app.current_organization_id() then
    raise exception 'step review denied' using errcode = '42501';
  end if;
  perform app.gov_require_licensed(step.organization_id);
  if step.version is distinct from p_expected_version then
    raise exception 'step version conflict' using errcode = 'PT409';
  end if;
  if step.status <> 'approved' then
    raise exception 'only an approved step is retired' using errcode = '22023';
  end if;
  perform app.gov_open_write(step.id);
  update public.approval_follow_up_steps
  set status = 'retired', retired_at = statement_timestamp(), review_note = v_reason
  where id = step.id
  returning version into new_version;
  perform app.gov_close_write(step.id);
  perform app.record_audit_event(
    step.organization_id, 'decision.follow_up_step_retired', 'public.approval_follow_up_steps', step.id, 'success',
    jsonb_build_object('reason', v_reason)
  );
  return new_version;
end;
$$;
revoke all on function app.retire_approval_follow_up_step(uuid, integer, text) from public;

-- Tick or untick an approved official step on a matter whose approval is confirmed.
create function app.tick_approval_follow_up_step(p_matter_id uuid, p_step_id uuid, p_ticked boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  decision public.decision_records%rowtype;
  step public.approval_follow_up_steps%rowtype;
  current_state boolean;
  new_id uuid;
begin
  if p_ticked is null then
    raise exception 'say whether the step is done' using errcode = '22023';
  end if;
  decision := app.dec_open_approved_matter(p_matter_id, app.gov_staff_roles(), false);
  select * into step from public.approval_follow_up_steps where id = p_step_id;
  if step.id is null
     or step.organization_id is distinct from decision.organization_id
     or step.status <> 'approved'
     or step.program_key is distinct from app.matter_program_key(decision.matter_id) then
    raise exception 'that step does not apply to this matter' using errcode = '42501';
  end if;
  select event.ticked into current_state
  from public.approval_follow_up_events event
  where event.matter_id = decision.matter_id and event.step_id = step.id
  order by event.created_at desc
  limit 1;
  if coalesce(current_state, false) = p_ticked then
    raise exception 'that step is already marked so' using errcode = '22023';
  end if;
  insert into public.approval_follow_up_events (organization_id, matter_id, decision_id, step_id, ticked, membership_id)
  values (decision.organization_id, decision.matter_id, decision.id, step.id, p_ticked, app.gov_actor_membership(decision.organization_id))
  returning id into new_id;
  perform app.record_audit_event(
    decision.organization_id, case when p_ticked then 'decision.follow_up_step_done' else 'decision.follow_up_step_undone' end,
    'public.decision_records', decision.id, 'success',
    jsonb_build_object('matter_id', decision.matter_id, 'step_id', step.id, 'source_url', step.source_url)
  );
  return new_id;
end;
$$;
revoke all on function app.tick_approval_follow_up_step(uuid, uuid, boolean) from public;

-- ---------------------------------------------------------------------------
-- Conditions summary: draft, revise, approve
-- ---------------------------------------------------------------------------
create function app.draft_conditions_summary(p_matter_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  decision public.decision_records%rowtype;
  v_body text := btrim(coalesce(p_body, ''));
  new_id uuid;
begin
  if length(v_body) not between 20 and 8000 then
    raise exception 'write the summary (at least 20 characters)' using errcode = '22023';
  end if;
  decision := app.dec_open_approved_matter(p_matter_id, array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[], false);
  if exists (select 1 from public.conditions_summaries summary where summary.matter_id = decision.matter_id and summary.status = 'draft') then
    raise exception 'a draft is already open; edit it' using errcode = '22023';
  end if;
  insert into public.conditions_summaries (organization_id, matter_id, decision_id, body, drafted_by_membership_id)
  values (decision.organization_id, decision.matter_id, decision.id, v_body, app.gov_actor_membership(decision.organization_id))
  returning id into new_id;
  perform app.record_audit_event(
    decision.organization_id, 'decision.conditions_summary_drafted', 'public.conditions_summaries', new_id, 'success',
    jsonb_build_object('matter_id', decision.matter_id, 'decision_id', decision.id)
  );
  return new_id;
end;
$$;
revoke all on function app.draft_conditions_summary(uuid, text) from public;

create function app.revise_conditions_summary(p_summary_id uuid, p_expected_version integer, p_body text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  summary public.conditions_summaries%rowtype;
  v_body text := btrim(coalesce(p_body, ''));
  new_version integer;
begin
  if length(v_body) not between 20 and 8000 then
    raise exception 'write the summary (at least 20 characters)' using errcode = '22023';
  end if;
  select * into summary from public.conditions_summaries where id = p_summary_id for update;
  if summary.id is null or app.can_read_matter(summary.matter_id) is distinct from true then
    raise exception 'approval follow-up denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(summary.organization_id, array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[], false);
  if summary.version is distinct from p_expected_version then
    raise exception 'summary version conflict' using errcode = 'PT409';
  end if;
  if summary.status <> 'draft' then
    raise exception 'an approved summary is not edited; draft a new version' using errcode = '42501';
  end if;
  perform app.gov_open_write(summary.id);
  update public.conditions_summaries
  set body = v_body, drafted_by_membership_id = app.gov_actor_membership(summary.organization_id)
  where id = summary.id
  returning version into new_version;
  perform app.gov_close_write(summary.id);
  perform app.record_audit_event(
    summary.organization_id, 'decision.conditions_summary_revised', 'public.conditions_summaries', summary.id, 'success',
    jsonb_build_object('matter_id', summary.matter_id, 'version', new_version)
  );
  return new_version;
end;
$$;
revoke all on function app.revise_conditions_summary(uuid, integer, text) from public;

-- A licensed consultant approves the draft (fresh step-up, no licence block). It becomes the next
-- numbered version, its hash is kept, and it supersedes the version the client saw before.
create function app.approve_conditions_summary(p_summary_id uuid, p_expected_version integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  summary public.conditions_summaries%rowtype;
  decision public.decision_records%rowtype;
  earlier uuid;
  next_number integer;
  new_version integer;
begin
  select * into summary from public.conditions_summaries where id = p_summary_id;
  if summary.id is null or app.can_read_matter(summary.matter_id) is distinct from true then
    raise exception 'approval follow-up denied' using errcode = '42501';
  end if;
  decision := app.dec_open_approved_matter(summary.matter_id, null, true);
  select * into summary from public.conditions_summaries where id = p_summary_id for update;
  if summary.version is distinct from p_expected_version then
    raise exception 'summary version conflict' using errcode = 'PT409';
  end if;
  if summary.status <> 'draft' then
    raise exception 'only a draft is approved' using errcode = '22023';
  end if;
  select coalesce(max(other.number), 0) + 1 into next_number
  from public.conditions_summaries other where other.matter_id = summary.matter_id;
  select other.id into earlier
  from public.conditions_summaries other
  where other.matter_id = summary.matter_id and other.status = 'approved';
  if earlier is not null then
    perform app.gov_open_write(earlier);
    update public.conditions_summaries set status = 'superseded', superseded_at = statement_timestamp() where id = earlier;
    perform app.gov_close_write(earlier);
  end if;
  perform app.gov_open_write(summary.id);
  update public.conditions_summaries
  set status = 'approved',
      number = next_number,
      decision_id = decision.id,
      approved_by_membership_id = app.gov_actor_membership(summary.organization_id),
      approved_at = statement_timestamp(),
      body_sha256 = encode(sha256(convert_to(summary.body, 'UTF8')), 'hex')
  where id = summary.id
  returning version into new_version;
  perform app.gov_close_write(summary.id);
  perform app.dec_complete_follow_up(summary.matter_id, 'conditions_summary');
  perform app.record_audit_event(
    summary.organization_id, 'decision.conditions_summary_approved', 'public.conditions_summaries', summary.id, 'success',
    jsonb_build_object('matter_id', summary.matter_id, 'number', next_number, 'supersedes', earlier,
                       'body_sha256', encode(sha256(convert_to(summary.body, 'UTF8')), 'hex'))
  );
  return new_version;
end;
$$;
revoke all on function app.approve_conditions_summary(uuid, integer) from public;

-- ---------------------------------------------------------------------------
-- Delivery record and acknowledgement
-- ---------------------------------------------------------------------------
create function app.record_decision_delivery(
  p_matter_id uuid,
  p_document_version_id uuid,
  p_method text,
  p_delivered_at timestamptz,
  p_note text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  decision public.decision_records%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  label text;
  new_id uuid;
begin
  if p_method is null or p_method not in ('portal', 'email', 'in_person', 'mail') then
    raise exception 'choose how it was delivered' using errcode = '22023';
  end if;
  if p_delivered_at is null or p_delivered_at > statement_timestamp() + interval '5 minutes' then
    raise exception 'the delivery time is required and cannot be in the future' using errcode = '22023';
  end if;
  if v_note is not null and length(v_note) not between 3 and 500 then
    raise exception 'keep the note between 3 and 500 characters' using errcode = '22023';
  end if;
  decision := app.dec_open_approved_matter(p_matter_id, array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[], false);
  if app.gov_evidence_on_matter(p_document_version_id, decision.matter_id, decision.organization_id) is distinct from true then
    raise exception 'the document must be a stored file on this matter' using errcode = '42501';
  end if;
  if p_delivered_at < decision.created_at - interval '1 day' then
    raise exception 'the delivery cannot be before the decision was recorded' using errcode = '22023';
  end if;
  select left(coalesce(nullif(btrim(doc.purpose), ''), version.original_filename, 'Document'), 300) into label
  from public.document_versions version
  join public.documents doc on doc.id = version.document_id
  where version.id = p_document_version_id;
  insert into public.decision_deliveries (
    organization_id, matter_id, decision_id, document_version_id, document_label, method, delivered_at, note, delivered_by_membership_id
  ) values (
    decision.organization_id, decision.matter_id, decision.id, p_document_version_id, label, p_method, p_delivered_at, v_note,
    app.gov_actor_membership(decision.organization_id)
  )
  returning id into new_id;
  perform app.dec_complete_follow_up(decision.matter_id, 'document_delivery');
  perform app.record_audit_event(
    decision.organization_id, 'decision.document_delivered', 'public.decision_deliveries', new_id, 'success',
    jsonb_build_object('matter_id', decision.matter_id, 'document_version_id', p_document_version_id, 'method', p_method, 'delivered_at', p_delivered_at)
  );
  return new_id;
end;
$$;
revoke all on function app.record_decision_delivery(uuid, uuid, text, timestamptz, text) from public;

-- The client acknowledges a delivery on their own matter, in the portal.
create function app.acknowledge_decision_delivery(p_delivery_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  delivery public.decision_deliveries%rowtype;
begin
  select * into delivery from public.decision_deliveries where id = p_delivery_id for update;
  if delivery.id is null
     or delivery.organization_id is distinct from app.current_organization_id()
     or app.is_matter_party(delivery.matter_id) is distinct from true then
    raise exception 'acknowledgement denied' using errcode = '42501';
  end if;
  if delivery.acknowledgement is not null then
    raise exception 'this delivery is already acknowledged' using errcode = '22023';
  end if;
  perform app.gov_open_write(delivery.id);
  update public.decision_deliveries
  set acknowledgement = 'client_portal', acknowledged_at = statement_timestamp(),
      acknowledged_on = app.firm_today(delivery.organization_id), acknowledged_by_user_id = (select auth.uid())
  where id = delivery.id;
  perform app.gov_close_write(delivery.id);
  perform app.record_audit_event(
    delivery.organization_id, 'decision.delivery_acknowledged', 'public.decision_deliveries', delivery.id, 'success',
    jsonb_build_object('matter_id', delivery.matter_id, 'by', 'client_portal')
  );
end;
$$;
revoke all on function app.acknowledge_decision_delivery(uuid) from public;

-- Staff record the client's acknowledgement with evidence: a file on the matter, or a note of what shows it.
create function app.record_delivery_acknowledgement(
  p_delivery_id uuid,
  p_expected_version integer,
  p_acknowledged_on date,
  p_evidence_version_id uuid,
  p_evidence_note text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  delivery public.decision_deliveries%rowtype;
  v_note text := nullif(btrim(coalesce(p_evidence_note, '')), '');
  new_version integer;
begin
  select * into delivery from public.decision_deliveries where id = p_delivery_id for update;
  if delivery.id is null or app.can_read_matter(delivery.matter_id) is distinct from true then
    raise exception 'acknowledgement denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(delivery.organization_id, array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[], false);
  if delivery.version is distinct from p_expected_version then
    raise exception 'delivery version conflict' using errcode = 'PT409';
  end if;
  if delivery.acknowledgement is not null then
    raise exception 'this delivery is already acknowledged' using errcode = '22023';
  end if;
  if p_evidence_version_id is null and v_note is null then
    raise exception 'add the evidence: a file on the matter, or a note of what shows it' using errcode = '22023';
  end if;
  if v_note is not null and length(v_note) not between 10 and 500 then
    raise exception 'describe the evidence in at least 10 characters' using errcode = '22023';
  end if;
  if p_evidence_version_id is not null
     and app.gov_evidence_on_matter(p_evidence_version_id, delivery.matter_id, delivery.organization_id) is distinct from true then
    raise exception 'the evidence must be a stored file on this matter' using errcode = '42501';
  end if;
  if p_acknowledged_on is null or p_acknowledged_on > app.firm_today(delivery.organization_id)
     or p_acknowledged_on < app.firm_local_date(delivery.organization_id, delivery.delivered_at) then
    raise exception 'the acknowledgement date is required, on or after the delivery and not in the future' using errcode = '22023';
  end if;
  perform app.gov_open_write(delivery.id);
  update public.decision_deliveries
  set acknowledgement = 'staff_recorded', acknowledged_at = statement_timestamp(), acknowledged_on = p_acknowledged_on,
      ack_recorded_by_membership_id = app.gov_actor_membership(delivery.organization_id),
      ack_evidence_version_id = p_evidence_version_id, ack_evidence_note = v_note
  where id = delivery.id
  returning version into new_version;
  perform app.gov_close_write(delivery.id);
  perform app.record_audit_event(
    delivery.organization_id, 'decision.delivery_acknowledged', 'public.decision_deliveries', delivery.id, 'success',
    jsonb_build_object('matter_id', delivery.matter_id, 'by', 'staff_recorded', 'evidence_version_id', p_evidence_version_id, 'evidence_note', v_note)
  );
  return new_version;
end;
$$;
revoke all on function app.record_delivery_acknowledgement(uuid, integer, date, uuid, text) from public;

-- ---------------------------------------------------------------------------
-- The client's view: the current approved summary and the deliveries, on their own matters
-- ---------------------------------------------------------------------------
create function public.portal_decision_follow_up(p_org uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'summaries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'matter_id', summary.matter_id, 'number', summary.number, 'body', summary.body, 'approved_at', summary.approved_at
      ) order by summary.approved_at desc)
      from public.conditions_summaries summary
      where summary.organization_id = p_org
        and p_org = app.current_organization_id()
        and summary.status = 'approved'
        and app.is_matter_party(summary.matter_id)
    ), '[]'::jsonb),
    'deliveries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', delivery.id, 'matter_id', delivery.matter_id, 'label', delivery.document_label, 'method', delivery.method,
        'delivered_at', delivery.delivered_at, 'acknowledgement', delivery.acknowledgement, 'acknowledged_at', delivery.acknowledged_at
      ) order by delivery.delivered_at desc)
      from public.decision_deliveries delivery
      where delivery.organization_id = p_org
        and p_org = app.current_organization_id()
        and app.is_matter_party(delivery.matter_id)
    ), '[]'::jsonb)
  );
$$;
comment on function public.portal_decision_follow_up(uuid) is
  'The signed-in client''s current approved conditions summaries and decision-document deliveries, on matters they are a party to (DEC-02). No drafts, superseded versions or staff details.';

-- ---------------------------------------------------------------------------
-- Invoker wrappers (the definer bodies enforce role, scope, step-up, and licence)
-- ---------------------------------------------------------------------------
create function public.propose_approval_follow_up_step(
  p_org uuid, p_program_key text, p_label text, p_timing_text text, p_source_url text, p_source_section text,
  p_form_number text, p_form_modified_on date, p_checked_on date, p_current_to date, p_snapshot jsonb
)
returns uuid language sql security invoker set search_path = ''
as $$
  select app.propose_approval_follow_up_step(
    p_org, p_program_key, p_label, p_timing_text, p_source_url, p_source_section, p_form_number, p_form_modified_on,
    p_checked_on, p_current_to, p_snapshot
  );
$$;

create function public.review_approval_follow_up_step(p_step_id uuid, p_expected_version integer, p_decision text, p_note text)
returns integer language sql security invoker set search_path = ''
as $$ select app.review_approval_follow_up_step(p_step_id, p_expected_version, p_decision, p_note); $$;

create function public.retire_approval_follow_up_step(p_step_id uuid, p_expected_version integer, p_reason text)
returns integer language sql security invoker set search_path = ''
as $$ select app.retire_approval_follow_up_step(p_step_id, p_expected_version, p_reason); $$;

create function public.tick_approval_follow_up_step(p_matter_id uuid, p_step_id uuid, p_ticked boolean)
returns uuid language sql security invoker set search_path = ''
as $$ select app.tick_approval_follow_up_step(p_matter_id, p_step_id, p_ticked); $$;

create function public.draft_conditions_summary(p_matter_id uuid, p_body text)
returns uuid language sql security invoker set search_path = ''
as $$ select app.draft_conditions_summary(p_matter_id, p_body); $$;

create function public.revise_conditions_summary(p_summary_id uuid, p_expected_version integer, p_body text)
returns integer language sql security invoker set search_path = ''
as $$ select app.revise_conditions_summary(p_summary_id, p_expected_version, p_body); $$;

create function public.approve_conditions_summary(p_summary_id uuid, p_expected_version integer)
returns integer language sql security invoker set search_path = ''
as $$ select app.approve_conditions_summary(p_summary_id, p_expected_version); $$;

create function public.record_decision_delivery(p_matter_id uuid, p_document_version_id uuid, p_method text, p_delivered_at timestamptz, p_note text)
returns uuid language sql security invoker set search_path = ''
as $$ select app.record_decision_delivery(p_matter_id, p_document_version_id, p_method, p_delivered_at, p_note); $$;

create function public.acknowledge_decision_delivery(p_delivery_id uuid)
returns void language sql security invoker set search_path = ''
as $$ select app.acknowledge_decision_delivery(p_delivery_id); $$;

create function public.record_delivery_acknowledgement(
  p_delivery_id uuid, p_expected_version integer, p_acknowledged_on date, p_evidence_version_id uuid, p_evidence_note text
)
returns integer language sql security invoker set search_path = ''
as $$ select app.record_delivery_acknowledgement(p_delivery_id, p_expected_version, p_acknowledged_on, p_evidence_version_id, p_evidence_note); $$;

revoke all on function public.portal_decision_follow_up(uuid) from public, anon;
revoke all on function public.propose_approval_follow_up_step(uuid, text, text, text, text, text, text, date, date, date, jsonb) from public, anon;
revoke all on function public.review_approval_follow_up_step(uuid, integer, text, text) from public, anon;
revoke all on function public.retire_approval_follow_up_step(uuid, integer, text) from public, anon;
revoke all on function public.tick_approval_follow_up_step(uuid, uuid, boolean) from public, anon;
revoke all on function public.draft_conditions_summary(uuid, text) from public, anon;
revoke all on function public.revise_conditions_summary(uuid, integer, text) from public, anon;
revoke all on function public.approve_conditions_summary(uuid, integer) from public, anon;
revoke all on function public.record_decision_delivery(uuid, uuid, text, timestamptz, text) from public, anon;
revoke all on function public.acknowledge_decision_delivery(uuid) from public, anon;
revoke all on function public.record_delivery_acknowledgement(uuid, integer, date, uuid, text) from public, anon;

grant execute on function public.portal_decision_follow_up(uuid) to authenticated, service_role;
grant execute on function public.propose_approval_follow_up_step(uuid, text, text, text, text, text, text, date, date, date, jsonb) to authenticated, service_role;
grant execute on function public.review_approval_follow_up_step(uuid, integer, text, text) to authenticated, service_role;
grant execute on function public.retire_approval_follow_up_step(uuid, integer, text) to authenticated, service_role;
grant execute on function public.tick_approval_follow_up_step(uuid, uuid, boolean) to authenticated, service_role;
grant execute on function public.draft_conditions_summary(uuid, text) to authenticated, service_role;
grant execute on function public.revise_conditions_summary(uuid, integer, text) to authenticated, service_role;
grant execute on function public.approve_conditions_summary(uuid, integer) to authenticated, service_role;
grant execute on function public.record_decision_delivery(uuid, uuid, text, timestamptz, text) to authenticated, service_role;
grant execute on function public.acknowledge_decision_delivery(uuid) to authenticated, service_role;
grant execute on function public.record_delivery_acknowledgement(uuid, integer, date, uuid, text) to authenticated, service_role;

grant execute on function app.propose_approval_follow_up_step(uuid, text, text, text, text, text, text, date, date, date, jsonb) to authenticated, service_role;
grant execute on function app.review_approval_follow_up_step(uuid, integer, text, text) to authenticated, service_role;
grant execute on function app.retire_approval_follow_up_step(uuid, integer, text) to authenticated, service_role;
grant execute on function app.tick_approval_follow_up_step(uuid, uuid, boolean) to authenticated, service_role;
grant execute on function app.draft_conditions_summary(uuid, text) to authenticated, service_role;
grant execute on function app.revise_conditions_summary(uuid, integer, text) to authenticated, service_role;
grant execute on function app.approve_conditions_summary(uuid, integer) to authenticated, service_role;
grant execute on function app.record_decision_delivery(uuid, uuid, text, timestamptz, text) to authenticated, service_role;
grant execute on function app.acknowledge_decision_delivery(uuid) to authenticated, service_role;
grant execute on function app.record_delivery_acknowledgement(uuid, integer, date, uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Privileges and row-level security. Staff reads only; every write is a function above.
-- Clients read nothing here directly: public.portal_decision_follow_up returns their part.
-- ---------------------------------------------------------------------------
revoke all on table public.approval_follow_up_steps from public, anon, authenticated;
revoke all on table public.approval_follow_up_events from public, anon, authenticated;
revoke all on table public.conditions_summaries from public, anon, authenticated;
revoke all on table public.decision_deliveries from public, anon, authenticated;
grant select on table public.approval_follow_up_steps to authenticated;
grant select on table public.approval_follow_up_events to authenticated;
grant select on table public.conditions_summaries to authenticated;
grant select on table public.decision_deliveries to authenticated;

alter table public.approval_follow_up_steps enable row level security;
alter table public.approval_follow_up_steps force row level security;
alter table public.approval_follow_up_events enable row level security;
alter table public.approval_follow_up_events force row level security;
alter table public.conditions_summaries enable row level security;
alter table public.conditions_summaries force row level security;
alter table public.decision_deliveries enable row level security;
alter table public.decision_deliveries force row level security;

-- Firm content, not client data: the firm's staff (two-step) read it.
create policy approval_follow_up_steps_select on public.approval_follow_up_steps
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.is_org_staff(organization_id))
    and (select app.staff_mfa_satisfied())
  );

create policy approval_follow_up_events_select on public.approval_follow_up_events
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.gov_staff_can_read(matter_id, organization_id))
  );

create policy conditions_summaries_select on public.conditions_summaries
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.gov_staff_can_read(matter_id, organization_id))
  );

create policy decision_deliveries_select on public.decision_deliveries
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.gov_staff_can_read(matter_id, organization_id))
  );
