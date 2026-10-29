-- SRC-04, SRC-07, SRC-08, SRC-10, SRC-11 / INT-02 / AI-04.
-- Francis's rules of 2026-10-25, still in force:
--   official captures go live with no review label;
--   a firm's licensed edit is an override, a fresh step-up every time, stamped and kept;
--   a changed re-capture goes live and flags that override "Source changed since your edit";
--   Vo does not cite a fee or advice-like claim whose source is overdue;
--   templates and release approvals keep licensed review;
--   fee-list and law text are re-fetched and hashed before a new version goes live;
--   processing times are never seeded.
--
-- This migration adds the pieces that were still missing:
--   1. app.promote_official_claim_drafts: idempotent, maintenance-session only, publishes
--      official_capture versions that are still draft or evidence_captured and already have a
--      captured page. It does not insert claims. scripts/ops/promote-official-claim-drafts.mjs
--      runs it, then the existing loader. Nothing here loads the capture files.
--   2. Scheduled re-check. pg_cron hourly calls app.kick_source_rechecks, which POSTs
--      /api/sources/recheck/run (the same dispatch bearer as the other runners). The Worker
--      fetches, hashes and reads the section. app.record_official_recheck writes the result.
--      An unchanged page moves "last checked". A failed fetch does not. A changed page, with
--      the section read from that fetch, publishes a new official version (the loader's rule)
--      and opens an impact task for each affected matter and checklist template. A page whose
--      section cannot be read is recorded as partial: the claim text is not rewritten.
--   3. Source conflicts. Two stored official pages whose excerpts differ can be recorded by a
--      licensed member (fresh step-up) or by the re-check when a second stored page disagrees.
--      The claim stays on record and is blocked: Vo will not cite it, a new rule-derived
--      document request is refused, and a pack that contains it is not selectable. A review
--      task is opened. Resolving it needs another fresh step-up. A failed fetch is not a conflict.
--   4. Rule-test cases a reviewer adds. No immigration rule is seeded. An executable condition
--      the reviewer stored is evaluated; without one, supported / unsupported / missing-input
--      cases stay unresolved.
--   5. public.publish_reviewed_program_pack: a licensed member publishes a firm pack of live
--      claims, naming themselves as reviewer and a licensed colleague (or themselves) as source
--      owner, with an effective date and a change-response note, after a fresh step-up.
--   6. Client source context: public.portal_claim_sources returns the official link and the
--      date checked for the signed-in client's open requests that cite a claim.
--
-- No fees, forms, processing times or program rules are inserted.

-- ---------------------------------------------------------------------------
-- Step-up actions for pack publish, conflicts and test cases
-- ---------------------------------------------------------------------------

do $drop$
declare
  cname text;
begin
  select con.conname into cname
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public' and rel.relname = 'rule_step_up_uses' and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ilike '%claim_edit%';
  if cname is not null then
    execute format('alter table public.rule_step_up_uses drop constraint %I', cname);
  end if;
end
$drop$;

alter table public.rule_step_up_uses
  add constraint rule_step_up_uses_action_check check (
    action in (
      'claim_edit', 'claim_revert', 'unsuspend',
      'pack_publish', 'source_conflict', 'source_conflict_resolve', 'rule_test'
    )
  );

-- A firm-level source-review task has no matter (a checklist template is not a matter).
do $drop$
declare
  cname text;
begin
  select con.conname into cname
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public' and rel.relname = 'tasks' and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ilike '%majority_review%';
  if cname is not null then
    execute format('alter table public.tasks drop constraint %I', cname);
  end if;
end
$drop$;

alter table public.tasks
  add constraint tasks_matter_or_source_review check (
    matter_id is not null
    or task_key = 'majority_review'
    or (task_key like 'source_review:%' and audience = 'internal')
  );

create unique index tasks_source_review_matter_uidx
  on public.tasks (organization_id, matter_id, task_key)
  where matter_id is not null and task_key like 'source_review:%' and status in ('open', 'blocked');
create unique index tasks_source_review_firm_uidx
  on public.tasks (organization_id, task_key)
  where matter_id is null and task_key like 'source_review:%' and status in ('open', 'blocked');

-- ---------------------------------------------------------------------------
-- Checklist items may cite a live claim. Nothing is filled in here.
-- ---------------------------------------------------------------------------

alter table public.checklist_template_items
  add column cited_definition_id uuid references public.rule_definitions (id);
comment on column public.checklist_template_items.cited_definition_id is
  'Optional live claim this item relies on. Set by a staff member. Empty means the item does not cite a claim.';
create index checklist_template_items_cited_definition_idx
  on public.checklist_template_items (cited_definition_id);

-- ---------------------------------------------------------------------------
-- Pack stewardship (SRC-11). Null until a licensed reviewer publishes.
-- ---------------------------------------------------------------------------

alter table public.rule_pack_versions
  add column reviewer_membership_id uuid,
  add column reviewer_name text,
  add column reviewer_licence text,
  add column source_owner_membership_id uuid,
  add column source_owner_name text,
  add column source_owner_licence text,
  add column reviewed_at timestamptz,
  add column effective_from timestamptz,
  add column change_response text,
  add constraint rule_pack_versions_change_response_len check (
    change_response is null or length(btrim(change_response)) between 20 and 2000
  ),
  add constraint rule_pack_versions_reviewer_name_len check (
    reviewer_name is null or length(btrim(reviewer_name)) between 1 and 200
  ),
  add constraint rule_pack_versions_owner_name_len check (
    source_owner_name is null or length(btrim(source_owner_name)) between 1 and 200
  ),
  add constraint rule_pack_versions_licence_len check (
    (reviewer_licence is null or length(btrim(reviewer_licence)) between 1 and 40)
    and (source_owner_licence is null or length(btrim(source_owner_licence)) between 1 and 40)
  );
comment on column public.rule_pack_versions.change_response is
  'What the firm does when an official source behind this pack changes. Written by the reviewer at publish. Not a legal rule.';
create index rule_pack_versions_reviewer_idx on public.rule_pack_versions (reviewer_membership_id);
create index rule_pack_versions_source_owner_idx on public.rule_pack_versions (source_owner_membership_id);

-- ---------------------------------------------------------------------------
-- Conflicts and reviewer-authored test cases
-- ---------------------------------------------------------------------------

create table public.source_conflicts (
  id uuid primary key default gen_random_uuid(),
  definition_id uuid not null references public.rule_definitions (id),
  left_snapshot_id uuid not null references public.source_snapshots (id),
  right_snapshot_id uuid not null references public.source_snapshots (id),
  left_url text not null check (length(btrim(left_url)) between 12 and 2000),
  right_url text not null check (length(btrim(right_url)) between 12 and 2000),
  left_excerpt text check (left_excerpt is null or length(left_excerpt) <= 600),
  right_excerpt text check (right_excerpt is null or length(right_excerpt) <= 600),
  status text not null default 'open' check (status in ('open', 'resolved')),
  opened_reason text not null check (length(btrim(opened_reason)) between 3 and 500),
  resolution text check (resolution is null or length(btrim(resolution)) between 3 and 1000),
  resolved_by_membership_id uuid,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  check (left_snapshot_id <> right_snapshot_id),
  check (status <> 'resolved' or (resolution is not null and resolved_at is not null))
);
comment on table public.source_conflicts is
  'Two stored official pages that disagree on one claim. While open, the claim is not cited, not used for a new rule-derived request, and blocks a pack that contains it. A failed fetch is not a row here.';
create unique index source_conflicts_one_open_uidx on public.source_conflicts (definition_id) where status = 'open';
create index source_conflicts_definition_idx on public.source_conflicts (definition_id);
create index source_conflicts_left_snapshot_idx on public.source_conflicts (left_snapshot_id);
create index source_conflicts_right_snapshot_idx on public.source_conflicts (right_snapshot_id);
create index source_conflicts_resolved_by_idx on public.source_conflicts (resolved_by_membership_id);
create index source_conflicts_created_by_idx on public.source_conflicts (created_by);

alter table public.source_conflicts enable row level security;
alter table public.source_conflicts force row level security;
revoke all on table public.source_conflicts from public, anon, authenticated, service_role;
grant select on table public.source_conflicts to authenticated, service_role;

create policy source_conflicts_select on public.source_conflicts
  for select to authenticated
  using (
    (select app.current_organization_id()) is not null
    and (select app.is_org_staff((select app.current_organization_id())))
    and (select app.staff_mfa_satisfied())
  );

create trigger source_conflicts_no_delete before delete on public.source_conflicts
  for each row execute function app.reject_governed_delete();
create trigger source_conflicts_no_truncate before truncate on public.source_conflicts
  for each statement execute function app.reject_governed_delete();

create table public.rule_test_cases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id),
  definition_id uuid not null references public.rule_definitions (id),
  kind text not null check (kind in (
    'supported', 'unsupported', 'missing_input', 'jurisdiction_mismatch', 'stale_source', 'superseded_version'
  )),
  title text not null check (length(btrim(title)) between 3 and 200),
  inputs jsonb not null default '{}'::jsonb,
  expected text not null check (expected in (
    'applies', 'does_not_apply', 'missing_input', 'jurisdiction_mismatch', 'stale_blocked', 'superseded_blocked'
  )),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  check (jsonb_typeof(inputs) = 'object')
);
comment on table public.rule_test_cases is
  'Cases a reviewer added for a program rule. No immigration rule is stored by a migration. inputs are the facts the reviewer typed.';
create index rule_test_cases_definition_idx on public.rule_test_cases (definition_id, created_at);
create index rule_test_cases_org_idx on public.rule_test_cases (organization_id);
create index rule_test_cases_created_by_idx on public.rule_test_cases (created_by);

alter table public.rule_test_cases enable row level security;
alter table public.rule_test_cases force row level security;
revoke all on table public.rule_test_cases from public, anon, authenticated, service_role;
grant select on table public.rule_test_cases to authenticated, service_role;

create policy rule_test_cases_select on public.rule_test_cases
  for select to authenticated
  using (
    (select app.current_organization_id()) is not null
    and (select app.is_org_staff((select app.current_organization_id())))
    and (select app.staff_mfa_satisfied())
    and (organization_id is null or organization_id = (select app.current_organization_id()))
  );

create trigger rule_test_cases_no_delete before delete on public.rule_test_cases
  for each row execute function app.reject_governed_delete();
create trigger rule_test_cases_no_truncate before truncate on public.rule_test_cases
  for each statement execute function app.reject_governed_delete();

-- ---------------------------------------------------------------------------
-- Conflict block
-- ---------------------------------------------------------------------------

create function app.claim_conflict_open(p_definition uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.source_conflicts conflict
    where conflict.definition_id = p_definition and conflict.status = 'open'
  );
$$;
revoke all on function app.claim_conflict_open(uuid) from public, anon;
grant execute on function app.claim_conflict_open(uuid) to authenticated, service_role;

comment on function app.claim_conflict_open(uuid) is
  'True while two stored official pages disagree on this claim. The claim text stays; it is not cited or newly applied.';

-- A new rule-derived document request cannot use a claim that is in conflict.
create function app.block_conflicted_rule_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  definition uuid;
begin
  if new.rule_version_id is null then
    return new;
  end if;
  select v.definition_id into definition from public.rule_versions v where v.id = new.rule_version_id;
  if app.claim_conflict_open(definition) then
    raise exception 'this claim is blocked: two official sources disagree and a review is open'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.block_conflicted_rule_request() from public;

create trigger document_requests_block_conflict
  before insert on public.document_requests
  for each row execute function app.block_conflicted_rule_request();

-- ---------------------------------------------------------------------------
-- Impact tasks (matters and checklist templates)
-- ---------------------------------------------------------------------------

create function app.open_source_review_task(
  p_org uuid,
  p_matter uuid,
  p_task_key text,
  p_title text,
  p_checklist jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner uuid;
  zone text;
  tid uuid;
begin
  if p_matter is null then
    if exists (
      select 1 from public.tasks task
      where task.organization_id = p_org and task.matter_id is null and task.task_key = p_task_key
        and task.status in ('open', 'blocked')
    ) then
      return null;
    end if;
  elsif exists (
    select 1 from public.tasks task
    where task.organization_id = p_org and task.matter_id = p_matter and task.task_key = p_task_key
      and task.status in ('open', 'blocked')
  ) then
    return null;
  end if;

  if p_matter is not null then
    select matter.responsible_consultant_membership_id into owner
    from public.matters matter
    where matter.id = p_matter and matter.organization_id = p_org;
  end if;
  if owner is null or not exists (
    select 1 from public.memberships mem
    where mem.id = owner and mem.organization_id = p_org and mem.status = 'active'
  ) then
    select mem.id into owner
    from public.memberships mem
    where mem.organization_id = p_org and mem.role = 'firm_owner' and mem.status = 'active'
    order by mem.created_at, mem.id
    limit 1;
  end if;
  if owner is null then
    return null;
  end if;
  select coalesce(nullif(btrim(org.timezone), ''), 'America/Toronto') into zone
  from public.organizations org where org.id = p_org;

  insert into public.tasks (
    organization_id, matter_id, audience, title, priority, status, owner_membership_id,
    due_on, due_timezone, checklist, task_key
  ) values (
    p_org, p_matter, 'internal', left(btrim(p_title), 200), 'high', 'open', owner,
    app.firm_today(p_org), coalesce(zone, 'America/Toronto'), coalesce(p_checklist, '[]'::jsonb), p_task_key
  )
  returning id into tid;
  insert into public.task_events (organization_id, task_id, event_kind, to_status, to_membership_id, actor_user_id)
  values (p_org, tid, 'created', 'open', owner, (select auth.uid()));
  return tid;
end;
$$;
revoke all on function app.open_source_review_task(uuid, uuid, text, text, jsonb) from public, anon, authenticated, service_role;

-- One review task per affected matter, and one per checklist template that cites the claim.
-- The checklist names the pack, form pins, open document requests, templates and released packages
-- that already exist. It does not add a requirement.
create function app.open_source_impact_tasks(p_definition uuid, p_source uuid, p_snapshot uuid, p_title text, p_reason text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  matter record;
  template record;
  lines jsonb;
  n integer := 0;
  key text := 'source_review:' || p_definition::text;
begin
  for matter in
    select distinct affected.organization_id, affected.matter_id
    from (
      select binding.organization_id, binding.matter_id
      from public.matter_rule_bindings binding
      join public.rule_pack_items item on item.pack_id = binding.rule_pack_version_id
      join public.rule_versions ver on ver.id = item.rule_version_id
      where binding.superseded_at is null and ver.definition_id = p_definition
      union
      select request.organization_id, request.matter_id
      from public.document_requests request
      join public.rule_versions ver on ver.id = request.rule_version_id
      where request.status = 'open' and ver.definition_id = p_definition
      union
      select export.organization_id, export.matter_id
      from public.matter_exports export
      join public.rule_pack_items item on item.pack_id = export.rule_pack_version_id
      join public.rule_versions ver on ver.id = item.rule_version_id
      where ver.definition_id = p_definition
    ) affected
  loop
    select coalesce(jsonb_agg(jsonb_build_object('text', line.txt, 'done', false)), '[]'::jsonb) into lines
    from (
      select distinct left(txt, 180) as txt
      from (
        select 'Program pack ' || pack.program_key || ' v' || pack.pack_version::text as txt
        from public.matter_rule_bindings binding
        join public.rule_pack_versions pack on pack.id = binding.rule_pack_version_id
        join public.rule_pack_items item on item.pack_id = pack.id
        join public.rule_versions ver on ver.id = item.rule_version_id
        where binding.matter_id = matter.matter_id and binding.superseded_at is null and ver.definition_id = p_definition
        union all
        select 'Form ' || (form_pin ->> 'form_number')
        from public.matter_rule_bindings binding
        join public.rule_pack_items item on item.pack_id = binding.rule_pack_version_id
        join public.rule_versions ver on ver.id = item.rule_version_id
        cross join lateral jsonb_array_elements(app.pack_form_pins(binding.rule_pack_version_id)) form_pin
        where binding.matter_id = matter.matter_id and binding.superseded_at is null and ver.definition_id = p_definition
          and coalesce(form_pin ->> 'form_number', '') <> ''
        union all
        select 'Document request: ' || request.purpose
        from public.document_requests request
        join public.rule_versions ver on ver.id = request.rule_version_id
        where request.matter_id = matter.matter_id and request.status = 'open' and ver.definition_id = p_definition
        union all
        select 'Released package ' || export.id::text
        from public.matter_exports export
        join public.rule_pack_items item on item.pack_id = export.rule_pack_version_id
        join public.rule_versions ver on ver.id = item.rule_version_id
        where export.matter_id = matter.matter_id and ver.definition_id = p_definition
      ) named
      where txt is not null
    ) line;

    if app.open_source_review_task(matter.organization_id, matter.matter_id, key, p_title, lines) is not null then
      n := n + 1;
    end if;

    insert into public.rule_impacts (organization_id, matter_id, source_id, snapshot_id, rule_version_id, reason)
    select matter.organization_id, matter.matter_id, p_source, p_snapshot, ver.id, left(p_reason, 200)
    from public.rule_versions ver
    where ver.definition_id = p_definition and app.rule_version_is_live(ver.id)
      and p_source is not null and p_snapshot is not null
      and not exists (
        select 1 from public.rule_impacts existing
        where existing.organization_id = matter.organization_id
          and existing.matter_id = matter.matter_id
          and existing.snapshot_id = p_snapshot
          and existing.rule_version_id = ver.id
          and existing.disposition = 'open'
      );
  end loop;

  for template in
    select item.organization_id, item.template_id, tpl.title
    from public.checklist_template_items item
    join public.checklist_templates tpl on tpl.id = item.template_id
    where item.cited_definition_id = p_definition and tpl.status <> 'retired'
    group by item.organization_id, item.template_id, tpl.title
  loop
    if app.open_source_review_task(
      template.organization_id,
      null,
      'source_review:template:' || template.template_id::text,
      p_title,
      jsonb_build_array(jsonb_build_object('text', left('Checklist template: ' || template.title, 180), 'done', false))
    ) is not null then
      n := n + 1;
    end if;
    insert into public.rule_impacts (organization_id, matter_id, source_id, snapshot_id, rule_version_id, reason)
    select template.organization_id, null, p_source, p_snapshot, ver.id, left('template: ' || p_reason, 200)
    from public.rule_versions ver
    where ver.definition_id = p_definition and app.rule_version_is_live(ver.id)
      and p_source is not null and p_snapshot is not null
      and not exists (
        select 1 from public.rule_impacts existing
        where existing.organization_id = template.organization_id
          and existing.matter_id is null
          and existing.snapshot_id = p_snapshot
          and existing.rule_version_id = ver.id
          and existing.disposition = 'open'
      );
  end loop;
  return n;
end;
$$;
revoke all on function app.open_source_impact_tasks(uuid, uuid, uuid, text, text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Promote official-capture drafts (maintenance session only). Does not insert claims.
-- ---------------------------------------------------------------------------

create function app.promote_official_claim_drafts()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  row public.rule_versions%rowtype;
  blockers text[];
  promoted integer := 0;
  skipped integer := 0;
  refused integer := 0;
begin
  if app.db_maintenance_session() is distinct from true then
    raise exception 'official claims are promoted only in a database maintenance session' using errcode = '42501';
  end if;
  for row in
    select ver.*
    from public.rule_versions ver
    where ver.origin = 'official_capture'
      and ver.organization_id is null
      and ver.status in ('draft', 'evidence_captured')
    order by ver.definition_id, ver.version_number
  loop
    blockers := app.rule_publication_blockers(row.id, row.content_revision);
    if blockers is not null and cardinality(blockers) > 0 then
      refused := refused + 1;
      continue;
    end if;
    if exists (
      select 1 from public.rule_versions live
      where live.definition_id = row.definition_id and live.id <> row.id and live.status in ('published', 'review_due')
    ) then
      skipped := skipped + 1;
      continue;
    end if;
    update public.rule_versions
    set status = 'published', status_changed_at = statement_timestamp()
    where id = row.id and status in ('draft', 'evidence_captured');
    promoted := promoted + 1;
  end loop;
  return jsonb_build_object('promoted', promoted, 'skipped', skipped, 'refused', refused);
end;
$$;
revoke all on function app.promote_official_claim_drafts() from public, anon, authenticated, service_role;
comment on function app.promote_official_claim_drafts() is
  'Publishes official_capture versions still sitting in draft or evidence_captured, when their captured page already satisfies the loader. Idempotent. Maintenance session only. Does not insert a claim.';

-- ---------------------------------------------------------------------------
-- Re-check gate on official versions (the scheduled recorder, not a general publish)
-- ---------------------------------------------------------------------------

create or replace function app.guard_rule_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  blockers text[];
  content_changed boolean := false;
  recapture boolean := coalesce(current_setting('app.official_recapture', true), '') = 'on'
    and new.definition_id::text = coalesce(current_setting('app.official_recapture_definition', true), '');
begin
  if tg_op = 'INSERT' then
    new.content_frozen := false;
    new.content_revision := 1;
    if new.status in ('approved', 'published', 'review_due', 'suspended', 'superseded') then
      raise exception 'publication blocked: status_requires_prior_review' using errcode = '23514';
    end if;
    -- Live claims: the loader (maintenance) or the scheduled re-check of an existing claim.
    if new.origin = 'official_capture' and app.db_maintenance_session() is distinct from true and recapture is distinct from true then
      raise exception 'official claims are loaded only in a database maintenance session' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.origin is distinct from old.origin then
    raise exception 'a rule version''s origin is immutable' using errcode = '42501';
  end if;

  content_changed :=
    new.claim is distinct from old.claim
    or new.structured_condition is distinct from old.structured_condition
    or new.output_value is distinct from old.output_value
    or new.exceptions is distinct from old.exceptions
    or new.applicability is distinct from old.applicability
    or new.applicability_note is distinct from old.applicability_note
    or new.applicability_established is distinct from old.applicability_established
    or new.effective_from is distinct from old.effective_from
    or new.effective_to is distinct from old.effective_to
    or new.test_case_ids is distinct from old.test_case_ids
    or new.supersedes_version_id is distinct from old.supersedes_version_id
    or new.definition_id is distinct from old.definition_id;

  if old.content_frozen and content_changed then
    raise exception 'published rule content is immutable' using errcode = '42501';
  end if;
  if old.content_frozen and new.content_frozen is distinct from true then
    raise exception 'published rule content stays frozen' using errcode = '42501';
  end if;
  if old.status in ('rejected', 'superseded') and new.status is distinct from old.status then
    raise exception 'rule status % is terminal', old.status using errcode = '42501';
  end if;
  if old.content_frozen
     and new.status in ('draft', 'evidence_captured', 'professional_review', 'approved', 'rejected') then
    raise exception 'published rule version cannot move to %', new.status using errcode = '42501';
  end if;
  if old.origin = 'official_capture' and new.status is distinct from old.status
     and app.db_maintenance_session() is distinct from true and recapture is distinct from true then
    raise exception 'official claims change only when the loader runs' using errcode = '42501';
  end if;

  if content_changed then
    new.content_revision := old.content_revision + 1;
  end if;

  if new.status in ('approved', 'published') and old.status is distinct from new.status then
    if content_changed then
      raise exception 'publication blocked: content_changed_during_publish' using errcode = '23514';
    end if;
    blockers := app.rule_publication_blockers(old.id, old.content_revision);
    if blockers is not null and cardinality(blockers) > 0 then
      raise exception 'publication blocked: %', array_to_string(blockers, ', ') using errcode = '23514';
    end if;
    if old.origin = 'official_capture' then
      if app.db_maintenance_session() is distinct from true and recapture is distinct from true then
        raise exception 'publication blocked: official claims go live only when the loader runs' using errcode = '42501';
      end if;
    elsif app.rule_review_gate_open(old.id) is distinct from true then
      raise exception 'publication blocked: approval_required (a licensed reviewer approves it in Source review, with a step-up)'
        using errcode = '42501';
    end if;
  end if;

  if new.status = 'published' then
    new.content_frozen := true;
  end if;
  return new;
end;
$$;
revoke all on function app.guard_rule_version() from public;

-- A pack that contains a claim in conflict is not selectable for a new matter.
create or replace function app.rule_pack_is_live(p_pack uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
      select 1 from public.rule_pack_versions pack
      where pack.id = p_pack and pack.status = 'published'
    )
    and exists (select 1 from public.rule_pack_items i where i.pack_id = p_pack)
    and not exists (
      select 1 from public.rule_pack_items i
      where i.pack_id = p_pack and app.rule_item_is_live(i.rule_version_id) is distinct from true
    )
    and not exists (
      select 1
      from public.rule_pack_items i
      join public.rule_versions v on v.id = i.rule_version_id
      where i.pack_id = p_pack and app.claim_conflict_open(v.definition_id)
    );
$$;
revoke all on function app.rule_pack_is_live(uuid) from public, anon;
grant execute on function app.rule_pack_is_live(uuid) to authenticated, service_role;

-- Authenticated publish goes through public.publish_reviewed_program_pack (the gate).
-- A maintenance session can still publish a pack the way the existing tests do.
create or replace function app.guard_rule_pack()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.content_frozen := false;
    if new.status in ('approved', 'published', 'review_due', 'suspended', 'superseded') then
      raise exception 'publication blocked: status_requires_prior_review' using errcode = '23514';
    end if;
    return new;
  end if;

  if new.organization_id is distinct from old.organization_id
     or new.jurisdiction is distinct from old.jurisdiction
     or new.program_key is distinct from old.program_key
     or new.pack_version is distinct from old.pack_version
     or new.id is distinct from old.id then
    raise exception 'rule pack identity columns are immutable' using errcode = '42501';
  end if;
  if old.content_frozen and (
    new.form_mappings is distinct from old.form_mappings
    or new.signature_policy is distinct from old.signature_policy
    or new.release_notes is distinct from old.release_notes
    or new.change_response is distinct from old.change_response
    or new.reviewer_membership_id is distinct from old.reviewer_membership_id
    or new.source_owner_membership_id is distinct from old.source_owner_membership_id
    or new.effective_from is distinct from old.effective_from
    or new.content_frozen is distinct from true
  ) then
    raise exception 'published rule pack content is immutable' using errcode = '42501';
  end if;
  if old.content_frozen
     and new.status in ('draft', 'evidence_captured', 'professional_review', 'approved', 'rejected') then
    raise exception 'published rule pack cannot move to %', new.status using errcode = '42501';
  end if;
  if old.status in ('rejected', 'superseded') and new.status is distinct from old.status then
    raise exception 'rule pack status % is terminal', old.status using errcode = '42501';
  end if;

  if new.status in ('approved', 'published') and old.status is distinct from new.status then
    if app.db_maintenance_session() is distinct from true then
      if coalesce(current_setting('app.pack_review_gate', true), '') is distinct from 'on' then
        raise exception 'publication blocked: a licensed reviewer publishes the pack, with a step-up' using errcode = '42501';
      end if;
      if new.reviewer_membership_id is null or new.source_owner_membership_id is null
         or new.reviewer_name is null or new.source_owner_name is null
         or new.change_response is null or new.reviewed_at is null or new.effective_from is null then
        raise exception 'publication blocked: name the reviewer, the source owner, the effective date and how a source change is handled'
          using errcode = '23514';
      end if;
    end if;
    if new.next_review_at is null then
      raise exception 'publication blocked: missing_next_review_at' using errcode = '23514';
    end if;
    if not exists (select 1 from public.rule_pack_items i where i.pack_id = new.id) then
      raise exception 'publication blocked: missing_pack_items' using errcode = '23514';
    end if;
    if exists (
      select 1
      from public.rule_pack_items i
      join public.rule_versions v on v.id = i.rule_version_id
      where i.pack_id = new.id
        and v.status not in ('published', 'review_due', 'suspended')
        and app.rule_item_is_live(i.rule_version_id) is distinct from true
    ) then
      raise exception 'publication blocked: pack_includes_unpublished_rule' using errcode = '23514';
    end if;
    if exists (
      select 1
      from public.rule_pack_items i
      join public.rule_versions v on v.id = i.rule_version_id
      where i.pack_id = new.id and app.claim_conflict_open(v.definition_id)
    ) then
      raise exception 'publication blocked: a claim in this pack has two official sources that disagree' using errcode = '23514';
    end if;
    if exists (
      select 1
      from public.rule_pack_items i
      join public.rule_versions v on v.id = i.rule_version_id
      where i.pack_id = new.id
        and v.structured_condition is not null
        and coalesce(cardinality(v.test_case_ids), 0) = 0
        and not exists (select 1 from public.rule_test_cases c where c.definition_id = v.definition_id)
    ) then
      raise exception 'publication blocked: an executable rule in this pack has no test cases' using errcode = '23514';
    end if;
  end if;

  if new.status = 'published' then
    new.content_frozen := true;
  end if;
  return new;
end;
$$;
revoke all on function app.guard_rule_pack() from public;

-- ---------------------------------------------------------------------------
-- Scheduled re-check recorder (service role only)
-- ---------------------------------------------------------------------------

create function app.record_official_recheck(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source uuid := nullif(p_payload ->> 'source_id', '')::uuid;
  v_result text := btrim(coalesce(p_payload ->> 'result', ''));
  v_hash text := lower(btrim(coalesce(p_payload ->> 'sha256', '')));
  v_at timestamptz;
  v_http integer;
  v_final text;
  v_modified date;
  v_amended date;
  v_current date;
  src public.official_sources%rowtype;
  latest_hash text;
  snap uuid;
  item jsonb;
  definition public.rule_definitions%rowtype;
  latest public.rule_versions%rowtype;
  new_id uuid;
  next_number integer;
  live_count integer;
  given_count integer;
  section text;
  excerpt text;
  claim_text text;
  claim_value text;
  other_excerpt text;
  other_url text;
  other_snap uuid;
  tasks integer := 0;
begin
  if v_result not in ('unchanged', 'changed', 'failed', 'partial', 'blocked') then
    raise exception 'unknown re-check result' using errcode = '22023';
  end if;
  select * into src from public.official_sources source where source.id = v_source and source.organization_id is null;
  if src.id is null then
    raise exception 'that official page is not on record' using errcode = '22023';
  end if;
  begin
    v_at := nullif(p_payload ->> 'retrieved_at', '')::timestamptz;
    v_http := nullif(p_payload ->> 'http_status', '')::integer;
    v_modified := nullif(p_payload ->> 'modified_on', '')::date;
    v_amended := nullif(p_payload ->> 'last_amended_on', '')::date;
    v_current := nullif(p_payload ->> 'current_to', '')::date;
  exception when others then
    raise exception 'a page date is not a date' using errcode = '22023';
  end;
  if v_at is null or v_at > statement_timestamp() + interval '5 minutes' or v_at < statement_timestamp() - interval '30 minutes' then
    raise exception 'the retrieval time has to be this run' using errcode = '22023';
  end if;
  v_final := split_part(btrim(coalesce(p_payload ->> 'final_url', src.canonical_url)), '#', 1);
  if app.federal_official_url(v_final) is null or app.host_is_allowlisted(app.official_url_host(v_final)) is distinct from true then
    raise exception 'not an official Government of Canada page' using errcode = '22023';
  end if;
  if split_part(src.canonical_url, '#', 1) is distinct from v_final
     and app.official_url_host(src.canonical_url) is distinct from app.official_url_host(v_final) then
    raise exception 'the page moved off its official host' using errcode = '22023';
  end if;

  select snapshot.content_hash into latest_hash
  from public.source_snapshots snapshot
  where snapshot.source_id = src.id
  order by snapshot.snapshot_number desc
  limit 1;

  if v_result in ('unchanged', 'changed', 'partial') and v_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'no SHA-256 of the page' using errcode = '22023';
  end if;
  if v_result = 'unchanged' and latest_hash is distinct from v_hash then
    raise exception 'the page hash changed; do not record it as unchanged' using errcode = '22023';
  end if;
  if v_result = 'changed' and latest_hash is not distinct from v_hash then
    v_result := 'unchanged';
  end if;

  -- A failure or a page we could not read does not move "last checked" and does not rewrite a claim.
  if v_result in ('failed', 'blocked') then
    insert into public.source_check_attempts (organization_id, source_id, attempted_at, result, http_status, error_code)
    values (null, src.id, v_at, v_result::public.source_observation, v_http, left(nullif(p_payload ->> 'error_code', ''), 80));
    return jsonb_build_object('result', v_result, 'published', 0);
  end if;

  if v_result = 'unchanged' then
    perform set_config('app.source_state_write', 'on', true);
    update public.official_sources source
    set last_checked_at = v_at, last_attempt_at = v_at, last_attempt_result = 'unchanged', last_attempt_error = null
    where source.id = src.id;
    perform set_config('app.source_state_write', '', true);
    select snapshot.id into snap
    from public.source_snapshots snapshot
    where snapshot.source_id = src.id and snapshot.content_hash = v_hash
    order by snapshot.snapshot_number desc
    limit 1;
    insert into public.source_check_attempts (organization_id, source_id, attempted_at, result, http_status, snapshot_id)
    values (null, src.id, v_at, 'unchanged', v_http, snap);
    return jsonb_build_object('result', 'unchanged', 'published', 0);
  end if;

  select count(*) into live_count
  from public.rule_versions ver
  join public.rule_evidence link on link.rule_version_id = ver.id
  join public.source_snapshots snapshot on snapshot.id = link.snapshot_id
  where ver.origin = 'official_capture' and app.rule_version_is_live(ver.id) and snapshot.source_id = src.id;

  if v_result = 'partial' then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('public.source_snapshots:' || src.id::text, 0));
    insert into public.source_snapshots (
      organization_id, source_id, snapshot_number, final_url, publisher, retrieved_at, modified_on, current_to,
      content_hash, retrieval_result, http_status, review_status
    ) values (
      null, src.id, 1, v_final, src.publisher, v_at, coalesce(v_modified, v_amended), v_current,
      v_hash, 'partial', v_http, 'evidence_captured'
    )
    returning id into snap;
    insert into public.source_check_attempts (organization_id, source_id, attempted_at, result, http_status, error_code, change_signal, snapshot_id)
    values (null, src.id, v_at, 'partial', v_http, left(coalesce(nullif(p_payload ->> 'error_code', ''), 'section_not_read'), 80), true, snap);
    -- The claim text is not rewritten. Tell the firms that already rely on it.
    tasks := 0;
    for definition in
      select distinct d.*
      from public.rule_definitions d
      join public.rule_versions ver on ver.definition_id = d.id
      join public.rule_evidence link on link.rule_version_id = ver.id
      join public.source_snapshots snapshot on snapshot.id = link.snapshot_id
      where ver.origin = 'official_capture' and app.rule_version_is_live(ver.id) and snapshot.source_id = src.id
    loop
      tasks := tasks + app.open_source_impact_tasks(
        definition.id, src.id, snap,
        'Official page changed; the section could not be read',
        'page_changed_section_not_read'
      );
    end loop;
    return jsonb_build_object('result', 'partial', 'published', 0, 'tasks', tasks);
  end if;

  -- changed: every live claim on this page has to be in the payload, with text read from the fetch.
  select count(*) into given_count from jsonb_array_elements(coalesce(p_payload -> 'claims', '[]'::jsonb));
  if live_count > 0 and given_count < live_count then
    raise exception 'a changed page has to include every live claim on it' using errcode = '22023';
  end if;
  if exists (
    select 1
    from public.rule_versions ver
    join public.rule_definitions d on d.id = ver.definition_id
    join public.rule_evidence link on link.rule_version_id = ver.id
    join public.source_snapshots snapshot on snapshot.id = link.snapshot_id
    where ver.origin = 'official_capture' and app.rule_version_is_live(ver.id) and snapshot.source_id = src.id
      and d.source_category in ('fee', 'law')
      and not exists (
        select 1 from jsonb_array_elements(p_payload -> 'claims') given
        where given ->> 'definition_id' = ver.definition_id::text
          and length(btrim(coalesce(given ->> 'claim', ''))) between 3 and 2000
      )
  ) then
    raise exception 'a fee or law page is re-fetched and hashed before a new version goes live' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('public.source_snapshots:' || src.id::text, 0));
  insert into public.source_snapshots (
    organization_id, source_id, snapshot_number, final_url, publisher, retrieved_at, modified_on, current_to,
    content_hash, retrieval_result, http_status, review_status
  ) values (
    null, src.id, 1, v_final, src.publisher, v_at, coalesce(v_modified, v_amended), v_current,
    v_hash, 'changed', v_http, 'evidence_captured'
  )
  returning id into snap;
  insert into public.source_check_attempts (organization_id, source_id, attempted_at, result, http_status, change_signal, snapshot_id)
  values (null, src.id, v_at, 'changed', v_http, true, snap);

  for item in select value from jsonb_array_elements(coalesce(p_payload -> 'claims', '[]'::jsonb))
  loop
    select * into definition from public.rule_definitions d where d.id = (item ->> 'definition_id')::uuid and d.organization_id is null;
    if definition.id is null or definition.source_category is null then
      raise exception 'that claim is not an official capture' using errcode = '22023';
    end if;
    select * into latest from public.rule_versions ver
    where ver.definition_id = definition.id and ver.origin = 'official_capture'
    order by ver.version_number desc limit 1;
    if latest.status = 'suspended' then
      continue;
    end if;
    if latest.id is null or app.rule_version_is_live(latest.id) is distinct from true then
      raise exception 'a re-check does not create a new claim' using errcode = '22023';
    end if;
    if not exists (
      select 1 from public.rule_evidence link
      join public.source_snapshots snapshot on snapshot.id = link.snapshot_id
      where link.rule_version_id = latest.id and snapshot.source_id = src.id
    ) then
      raise exception 'that claim is not read from this page' using errcode = '22023';
    end if;
    claim_text := btrim(coalesce(item ->> 'claim', ''));
    claim_value := nullif(btrim(coalesce(item ->> 'value', '')), '');
    section := nullif(btrim(coalesce(item ->> 'section', '')), '');
    excerpt := nullif(left(btrim(coalesce(item ->> 'excerpt', '')), 600), '');
    if length(claim_text) not between 3 and 2000 or claim_text ~* 'error loading fee' or coalesce(claim_value, '') ~* 'error loading fee' then
      raise exception 'the claim text was not read from the page' using errcode = '22023';
    end if;
    if section is null then
      raise exception 'the section was not read from the page' using errcode = '22023';
    end if;
    perform set_config('app.official_recapture', 'on', true);
    perform set_config('app.official_recapture_definition', definition.id::text, true);
    select coalesce(max(ver.version_number), 0) + 1 into next_number from public.rule_versions ver where ver.definition_id = definition.id;
    insert into public.rule_versions (definition_id, version_number, claim, output_value, status, origin, supersedes_version_id)
    values (
      definition.id, next_number, claim_text,
      case when claim_value is null then null else jsonb_build_object('text', claim_value) end,
      'evidence_captured', 'official_capture', latest.id
    )
    returning id into new_id;
    insert into public.rule_evidence (
      rule_version_id, snapshot_id, source_section, evidence_excerpt, source_language, source_url,
      modified_on, last_amended_on, current_to, checked_on
    ) values (
      new_id, snap, left(section, 300), excerpt, 'en', coalesce(nullif(item ->> 'source_url', ''), src.canonical_url),
      v_modified, v_amended, v_current, (v_at at time zone 'America/Toronto')::date
    );
    update public.rule_versions set status = 'published', status_changed_at = statement_timestamp() where id = new_id;
    update public.rule_versions set status = 'superseded', status_changed_at = statement_timestamp()
    where id = latest.id and status in ('published', 'review_due');
    perform set_config('app.official_recapture', '', true);
    perform set_config('app.official_recapture_definition', '', true);

    tasks := tasks + app.open_source_impact_tasks(definition.id, src.id, snap, 'Official source changed', 'source_content_changed');

    -- A second stored page whose excerpt is not the new text (and not a shorter cut of it) is a conflict.
    select link.evidence_excerpt, snapshot.final_url, snapshot.id
      into other_excerpt, other_url, other_snap
    from public.rule_evidence link
    join public.source_snapshots snapshot on snapshot.id = link.snapshot_id
    join public.rule_versions ver on ver.id = link.rule_version_id
    where ver.definition_id = definition.id
      and snapshot.source_id is distinct from src.id
      and link.evidence_excerpt is not null
      and length(btrim(link.evidence_excerpt)) >= 20
      and btrim(link.evidence_excerpt) is distinct from claim_text
      and position(btrim(link.evidence_excerpt) in claim_text) = 0
      and position(claim_text in btrim(link.evidence_excerpt)) = 0
    order by snapshot.retrieved_at desc
    limit 1;
    if other_snap is not null and not app.claim_conflict_open(definition.id) then
      insert into public.source_conflicts (
        definition_id, left_snapshot_id, right_snapshot_id, left_url, right_url, left_excerpt, right_excerpt, opened_reason
      ) values (
        definition.id, snap, other_snap, v_final, other_url, left(claim_text, 600), left(other_excerpt, 600),
        'A re-check read different text on two official pages'
      );
      perform app.open_source_impact_tasks(definition.id, src.id, snap, 'Two official sources disagree', 'source_conflict');
    end if;
  end loop;

  return jsonb_build_object('result', 'changed', 'published', given_count, 'tasks', tasks);
end;
$$;
revoke all on function app.record_official_recheck(jsonb) from public, anon, authenticated, service_role;

create function public.service_record_official_recheck(p_payload jsonb)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select app.record_official_recheck(p_payload);
$$;
revoke all on function public.service_record_official_recheck(jsonb) from public, anon, authenticated;
grant execute on function public.service_record_official_recheck(jsonb) to service_role;

-- Pages due for a re-check, with the live claims read from each one. Service role only.
create function public.service_sources_due(p_limit integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(page.row), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'source_id', src.id,
      'url', src.canonical_url,
      'content_hash', (
        select snapshot.content_hash from public.source_snapshots snapshot
        where snapshot.source_id = src.id
        order by snapshot.snapshot_number desc
        limit 1
      ),
      'claims', coalesce((
        select jsonb_agg(jsonb_build_object(
          'definition_id', d.id,
          'key', d.stable_key,
          'category', d.source_category,
          'claim', ver.claim,
          'value', ver.output_value ->> 'text',
          'section', link.source_section,
          'source_url', link.source_url,
          'excerpt', link.evidence_excerpt
        ))
        from public.rule_versions ver
        join public.rule_definitions d on d.id = ver.definition_id
        join public.rule_evidence link on link.rule_version_id = ver.id
        join public.source_snapshots snapshot on snapshot.id = link.snapshot_id
        where ver.origin = 'official_capture' and app.rule_version_is_live(ver.id) and snapshot.source_id = src.id
      ), '[]'::jsonb)
    ) as row
    from public.official_sources src
    where src.organization_id is null
      and exists (
        select 1
        from public.rule_versions ver
        join public.rule_definitions d on d.id = ver.definition_id
        join public.rule_evidence link on link.rule_version_id = ver.id
        join public.source_snapshots snapshot on snapshot.id = link.snapshot_id
        where ver.origin = 'official_capture' and app.rule_version_is_live(ver.id) and snapshot.source_id = src.id
          and (
            src.last_checked_at is null
            or src.last_checked_at < statement_timestamp() - app.source_recheck_interval(d.source_category)
          )
      )
      and (
        src.last_attempt_at is null
        or src.last_attempt_result not in ('failed', 'blocked', 'partial')
        or src.last_attempt_at < statement_timestamp() - interval '6 hours'
      )
    order by src.last_checked_at nulls first, src.id
    limit least(greatest(coalesce(p_limit, 5), 1), 20)
  ) page;
$$;
revoke all on function public.service_sources_due(integer) from public, anon, authenticated;
grant execute on function public.service_sources_due(integer) to service_role;

create function app.kick_source_rechecks()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  url text;
  secret text;
  due boolean;
begin
  select exists (select 1 from jsonb_array_elements(public.service_sources_due(1))) into due;
  if due is distinct from true then
    return;
  end if;
  select decrypted_secret into url from vault.decrypted_secrets where name = 'email_dispatch_url';
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'email_dispatch_secret';
  if url is null or secret is null or url !~ '^https://[^/]+/api/email/dispatch$' then
    return;
  end if;
  perform net.http_post(
    url := regexp_replace(url, '/api/email/dispatch$', '/api/sources/recheck/run'),
    headers := jsonb_build_object('Authorization', 'Bearer ' || secret, 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
end;
$$;
revoke all on function app.kick_source_rechecks() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
    create extension if not exists pg_cron;
    perform cron.schedule('casevoya-source-rechecks', '17 * * * *', 'select app.kick_source_rechecks()');
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Record and resolve a conflict (licensed member, fresh step-up)
-- ---------------------------------------------------------------------------

create function public.record_source_conflict(p_definition_id uuid, p_left_evidence uuid, p_right_evidence uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := app.current_organization_id();
  reason text := nullif(btrim(coalesce(p_reason, '')), '');
  left_row public.rule_evidence%rowtype;
  right_row public.rule_evidence%rowtype;
  left_snap public.source_snapshots%rowtype;
  right_snap public.source_snapshots%rowtype;
  definition public.rule_definitions%rowtype;
  new_id uuid;
begin
  perform app.require_licensed_staff(v_org, true);
  if reason is null or length(reason) < 3 then
    raise exception 'say why these two pages disagree' using errcode = '22023';
  end if;
  select * into definition from public.rule_definitions d where d.id = p_definition_id and d.organization_id is null and d.source_category is not null;
  if definition.id is null then
    raise exception 'that claim is not an official capture' using errcode = '22023';
  end if;
  if app.claim_conflict_open(definition.id) then
    raise exception 'a review of this disagreement is already open' using errcode = '23505';
  end if;
  select * into left_row from public.rule_evidence e where e.id = p_left_evidence;
  select * into right_row from public.rule_evidence e where e.id = p_right_evidence;
  select * into left_snap from public.source_snapshots s where s.id = left_row.snapshot_id;
  select * into right_snap from public.source_snapshots s where s.id = right_row.snapshot_id;
  if left_snap.id is null or right_snap.id is null or left_snap.id = right_snap.id then
    raise exception 'name two stored captures' using errcode = '22023';
  end if;
  if left_snap.content_hash = right_snap.content_hash then
    raise exception 'the two captures are the same page hash' using errcode = '22023';
  end if;
  if split_part(left_snap.final_url, '#', 1) = split_part(right_snap.final_url, '#', 1) then
    raise exception 'a change on one page is a re-check, not a conflict' using errcode = '22023';
  end if;
  if left_row.evidence_excerpt is null or right_row.evidence_excerpt is null then
    raise exception 'both captures need the excerpt that was stored with them' using errcode = '22023';
  end if;
  if btrim(left_row.evidence_excerpt) = btrim(right_row.evidence_excerpt)
     or position(btrim(left_row.evidence_excerpt) in btrim(right_row.evidence_excerpt)) > 0
     or position(btrim(right_row.evidence_excerpt) in btrim(left_row.evidence_excerpt)) > 0 then
    raise exception 'the stored excerpts do not disagree' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.rule_versions ver
    where ver.id = left_row.rule_version_id and ver.definition_id = definition.id
  ) then
    raise exception 'the first capture is not this claim' using errcode = '22023';
  end if;
  perform app.use_rule_step_up(v_org, 'source_conflict', definition.id);
  insert into public.source_conflicts (
    definition_id, left_snapshot_id, right_snapshot_id, left_url, right_url, left_excerpt, right_excerpt,
    opened_reason, created_by
  ) values (
    definition.id, left_snap.id, right_snap.id, left_snap.final_url, right_snap.final_url,
    left_row.evidence_excerpt, right_row.evidence_excerpt, left(reason, 500), (select auth.uid())
  )
  returning id into new_id;
  perform app.open_source_impact_tasks(definition.id, left_snap.source_id, left_snap.id, 'Two official sources disagree', 'source_conflict');
  perform app.record_audit_event(
    v_org, 'source.conflict_opened', 'public.source_conflicts', new_id, 'success',
    jsonb_build_object('definition_id', definition.id, 'stable_key', definition.stable_key, 'left_url', left_snap.final_url, 'right_url', right_snap.final_url)
  );
  return new_id;
end;
$$;
revoke all on function public.record_source_conflict(uuid, uuid, uuid, text) from public, anon, service_role;
grant execute on function public.record_source_conflict(uuid, uuid, uuid, text) to authenticated;

create function public.resolve_source_conflict(p_conflict_id uuid, p_note text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := app.current_organization_id();
  note text := nullif(btrim(coalesce(p_note, '')), '');
  row public.source_conflicts%rowtype;
  actor uuid;
begin
  perform app.require_licensed_staff(v_org, true);
  if note is null or length(note) < 3 then
    raise exception 'say how this was resolved' using errcode = '22023';
  end if;
  select * into row from public.source_conflicts conflict where conflict.id = p_conflict_id for update;
  if row.id is null or row.status <> 'open' then
    raise exception 'that review is not open' using errcode = '22023';
  end if;
  actor := app.gov_actor_membership(v_org);
  perform app.use_rule_step_up(v_org, 'source_conflict_resolve', row.id);
  update public.source_conflicts
  set status = 'resolved', resolution = left(note, 1000), resolved_by_membership_id = actor, resolved_at = statement_timestamp()
  where id = row.id;
  perform app.record_audit_event(
    v_org, 'source.conflict_resolved', 'public.source_conflicts', row.id, 'success',
    jsonb_build_object('definition_id', row.definition_id, 'note_length', length(note))
  );
  return row.id;
end;
$$;
revoke all on function public.resolve_source_conflict(uuid, text) from public, anon, service_role;
grant execute on function public.resolve_source_conflict(uuid, text) to authenticated;

create function public.source_conflict_for(p_definition_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', conflict.id,
    'status', conflict.status,
    'left_url', conflict.left_url,
    'right_url', conflict.right_url,
    'left_excerpt', conflict.left_excerpt,
    'right_excerpt', conflict.right_excerpt,
    'opened_reason', conflict.opened_reason,
    'resolution', conflict.resolution
  )
  from public.source_conflicts conflict
  where conflict.definition_id = p_definition_id
  order by conflict.created_at desc
  limit 1;
$$;
revoke all on function public.source_conflict_for(uuid) from public, anon;
grant execute on function public.source_conflict_for(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Rule-test harness. The reviewer supplies the case. No rule is seeded.
-- ---------------------------------------------------------------------------

create function app.evaluate_rule_test(p_version uuid, p_case uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  ver public.rule_versions%rowtype;
  definition public.rule_definitions%rowtype;
  tc public.rule_test_cases%rowtype;
  cond jsonb;
  group_name text;
  requirement jsonb;
  missing boolean := false;
  failed boolean := false;
  matched boolean := false;
  ready boolean := false;
  actual text := 'no_executable_condition';
  superseded public.rule_versions%rowtype;
begin
  select * into ver from public.rule_versions where id = p_version;
  select * into definition from public.rule_definitions where id = ver.definition_id;
  select * into tc from public.rule_test_cases where id = p_case and definition_id = ver.definition_id;
  if ver.id is null or tc.id is null then
    return jsonb_build_object('actual', 'missing_case', 'pass', false);
  end if;

  if tc.kind = 'jurisdiction_mismatch' then
    if nullif(tc.inputs ->> 'jurisdiction', '') is null then
      actual := 'missing_input';
    elsif upper(tc.inputs ->> 'jurisdiction') is distinct from definition.jurisdiction then
      actual := 'jurisdiction_mismatch';
    else
      actual := 'applies';
    end if;
  elsif tc.kind = 'stale_source' then
    actual := case
      when app.official_claim_stale(ver.id)
        and (definition.source_category = 'fee' or definition.stable_key like 'CA.FEES.%' or app.vo_advice_like(ver.claim))
      then 'stale_blocked' else 'not_stale' end;
  elsif tc.kind = 'superseded_version' then
    select * into superseded from public.rule_versions older
    where older.definition_id = definition.id and older.status = 'superseded'
    order by older.version_number desc limit 1;
    if ver.status = 'superseded' or superseded.id is not null then
      actual := case when app.rule_version_is_live(coalesce(superseded.id, ver.id)) then 'applies' else 'superseded_blocked' end;
    else
      actual := 'no_superseded_version';
    end if;
  else
    cond := ver.structured_condition;
    if cond is null or jsonb_typeof(cond) <> 'object' then
      actual := 'no_executable_condition';
    else
      group_name := case when cond ? 'all' then 'all' when cond ? 'any' then 'any' else null end;
      if group_name is null or jsonb_typeof(cond -> group_name) <> 'array' then
        actual := 'no_executable_condition';
      else
        ready := true;
        for requirement in select value from jsonb_array_elements(cond -> group_name) loop
          if jsonb_typeof(requirement) <> 'object' or nullif(requirement ->> 'fact', '') is null or not (requirement ? 'equals') then
            ready := false;
            exit;
          end if;
          if not (tc.inputs ? (requirement ->> 'fact')) then
            missing := true;
          elsif (tc.inputs -> (requirement ->> 'fact')) is distinct from (requirement -> 'equals') then
            failed := true;
          else
            matched := true;
          end if;
        end loop;
        if ready then
          if group_name = 'all' and missing then
            actual := 'missing_input';
          elsif group_name = 'all' and failed then
            actual := 'does_not_apply';
          elsif group_name = 'all' then
            actual := 'applies';
          elsif matched then
            actual := 'applies';
          elsif missing then
            actual := 'missing_input';
          else
            actual := 'does_not_apply';
          end if;
        end if;
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'id', tc.id,
    'kind', tc.kind,
    'title', tc.title,
    'expected', tc.expected,
    'actual', actual,
    'pass', actual = tc.expected
  );
end;
$$;
revoke all on function app.evaluate_rule_test(uuid, uuid) from public, anon, authenticated, service_role;

create function public.save_rule_test_case(
  p_definition_id uuid, p_kind text, p_title text, p_inputs jsonb, p_expected text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := app.current_organization_id();
  definition public.rule_definitions%rowtype;
  title text := nullif(btrim(coalesce(p_title, '')), '');
  inputs jsonb := coalesce(p_inputs, '{}'::jsonb);
  new_id uuid;
  draft uuid;
begin
  select * into definition from public.rule_definitions d where d.id = p_definition_id;
  if definition.id is null then
    raise exception 'that rule was not found' using errcode = '22023';
  end if;
  if definition.organization_id is null then
    perform app.require_licensed_staff(v_org, true);
  else
    if definition.organization_id is distinct from v_org then
      raise exception 'that rule belongs to another firm' using errcode = '42501';
    end if;
    perform app.require_active_staff(v_org, array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[], true);
  end if;
  if p_kind not in ('supported', 'unsupported', 'missing_input', 'jurisdiction_mismatch', 'stale_source', 'superseded_version') then
    raise exception 'choose a test kind' using errcode = '22023';
  end if;
  if p_expected not in ('applies', 'does_not_apply', 'missing_input', 'jurisdiction_mismatch', 'stale_blocked', 'superseded_blocked') then
    raise exception 'choose what the case should do' using errcode = '22023';
  end if;
  if title is null or length(title) < 3 then
    raise exception 'name the case' using errcode = '22023';
  end if;
  if jsonb_typeof(inputs) is distinct from 'object' then
    raise exception 'the inputs have to be a set of facts' using errcode = '22023';
  end if;
  perform app.use_rule_step_up(v_org, 'rule_test', definition.id);
  insert into public.rule_test_cases (organization_id, definition_id, kind, title, inputs, expected, created_by)
  values (
    case when definition.organization_id is null then null else v_org end,
    definition.id, p_kind, left(title, 200), inputs, p_expected, (select auth.uid())
  )
  returning id into new_id;

  select ver.id into draft
  from public.rule_versions ver
  where ver.definition_id = definition.id and ver.content_frozen is distinct from true
    and ver.status in ('draft', 'evidence_captured', 'professional_review')
  order by ver.version_number desc
  limit 1;
  if draft is not null then
    update public.rule_versions
    set test_case_ids = (select coalesce(array_agg(distinct item), '{}') from unnest(test_case_ids || array[new_id::text]) item)
    where id = draft;
  end if;

  perform app.record_audit_event(
    v_org, 'rule.test_case_added', 'public.rule_test_cases', new_id, 'success',
    jsonb_build_object('definition_id', definition.id, 'kind', p_kind, 'expected', p_expected)
  );
  return new_id;
end;
$$;
revoke all on function public.save_rule_test_case(uuid, text, text, jsonb, text) from public, anon, service_role;
grant execute on function public.save_rule_test_case(uuid, text, text, jsonb, text) to authenticated;

create function public.run_rule_tests(p_definition_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := app.current_organization_id();
  definition public.rule_definitions%rowtype;
  version uuid;
  results jsonb := '[]'::jsonb;
  tc record;
begin
  if v_org is null or app.is_org_staff(v_org) is distinct from true or app.staff_mfa_satisfied() is distinct from true then
    raise exception 'rule tests denied' using errcode = '42501';
  end if;
  select * into definition from public.rule_definitions d where d.id = p_definition_id;
  if definition.id is null or (definition.organization_id is not null and definition.organization_id is distinct from v_org) then
    raise exception 'that rule was not found' using errcode = '42501';
  end if;
  version := app.official_live_version(definition.id);
  if version is null then
    select ver.id into version from public.rule_versions ver
    where ver.definition_id = definition.id and ver.status in ('published', 'review_due', 'draft', 'evidence_captured', 'professional_review')
    order by ver.version_number desc limit 1;
  end if;
  if version is null then
    return jsonb_build_object('version_id', null, 'cases', '[]'::jsonb);
  end if;
  for tc in
    select c.id from public.rule_test_cases c
    where c.definition_id = definition.id
      and (c.organization_id is null or c.organization_id = v_org)
    order by c.created_at
  loop
    results := results || jsonb_build_array(app.evaluate_rule_test(version, tc.id));
  end loop;
  return jsonb_build_object('version_id', version, 'cases', results);
end;
$$;
revoke all on function public.run_rule_tests(uuid) from public, anon;
grant execute on function public.run_rule_tests(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Publish a reviewed firm program pack (INT-02, SRC-11)
-- ---------------------------------------------------------------------------

create function public.program_pack_editor()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := app.current_organization_id();
begin
  if v_org is null or app.is_org_staff(v_org) is distinct from true or app.staff_mfa_satisfied() is distinct from true then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object(
    'licensed', exists (
      select 1 from public.memberships mem
      where mem.organization_id = v_org and mem.user_id = (select auth.uid()) and mem.status = 'active'
        and mem.role in ('firm_owner', 'licensed_consultant')
        and app.actor_is_licensed(v_org)
    ),
    'claims', coalesce((
      select jsonb_agg(jsonb_build_object(
        'version_id', ver.id,
        'definition_id', d.id,
        'key', d.stable_key,
        'program_key', d.program_key,
        'claim', left(ver.claim, 240)
      ) order by d.stable_key)
      from public.rule_definitions d
      join public.rule_versions ver on ver.id = app.official_live_version(d.id)
      where d.organization_id is null and d.source_category is not null
        and app.claim_conflict_open(d.id) is distinct from true
    ), '[]'::jsonb),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'membership_id', mem.id,
        'name', coalesce(nullif(btrim(profile.display_name), ''), 'Licensed member'),
        'licence', credential.college_id,
        'role', mem.role
      ) order by profile.display_name)
      from public.memberships mem
      join public.consultant_credentials credential on credential.membership_id = mem.id and credential.organization_id = mem.organization_id
      left join public.profiles profile on profile.id = mem.user_id
      where mem.organization_id = v_org and mem.status = 'active'
        and mem.role in ('firm_owner', 'licensed_consultant')
        and credential.college_id is not null
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.program_pack_editor() from public, anon;
grant execute on function public.program_pack_editor() to authenticated;

create function public.publish_reviewed_program_pack(
  p_program_key text,
  p_jurisdiction text,
  p_version_ids uuid[],
  p_source_owner uuid,
  p_effective_from timestamptz,
  p_next_review_at timestamptz,
  p_change_response text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := app.current_organization_id();
  v_program text := nullif(lower(btrim(coalesce(p_program_key, ''))), '');
  v_jurisdiction text := upper(btrim(coalesce(p_jurisdiction, '')));
  v_response text := nullif(btrim(coalesce(p_change_response, '')), '');
  v_reviewer uuid;
  v_reviewer_name text;
  v_reviewer_licence text;
  v_owner_name text;
  v_owner_licence text;
  v_pack uuid;
  v_next integer;
  v_version_id uuid;
  ver public.rule_versions%rowtype;
  definition public.rule_definitions%rowtype;
begin
  perform app.require_licensed_staff(v_org, true);
  v_reviewer := app.gov_actor_membership(v_org);
  if v_program is null or v_program !~ '^[a-z0-9_]{1,80}$' then
    raise exception 'name the program' using errcode = '22023';
  end if;
  if v_jurisdiction !~ '^[A-Z]{2}(-[A-Z0-9]{1,6})?$' then
    raise exception 'name the jurisdiction' using errcode = '22023';
  end if;
  if p_version_ids is null or cardinality(p_version_ids) < 1 or cardinality(p_version_ids) > 80 then
    raise exception 'choose the live claims this pack uses' using errcode = '22023';
  end if;
  if v_response is null or length(v_response) < 20 then
    raise exception 'write how the firm handles a change to these sources' using errcode = '22023';
  end if;
  if p_effective_from is null or p_next_review_at is null or p_next_review_at <= p_effective_from then
    raise exception 'the effective date and the next review date are both required' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.organizations org
    where org.id = v_org
      and exists (
        select 1 from unnest(org.jurisdiction_codes) code
        where v_jurisdiction = code or v_jurisdiction like code || '-%'
      )
  ) then
    raise exception 'that jurisdiction is not one this firm practises' using errcode = '22023';
  end if;
  select left(coalesce(nullif(btrim(profile.display_name), ''), 'A licensed member'), 200), credential.college_id
    into v_reviewer_name, v_reviewer_licence
  from public.memberships mem
  left join public.profiles profile on profile.id = mem.user_id
  left join public.consultant_credentials credential on credential.membership_id = mem.id and credential.organization_id = mem.organization_id
  where mem.id = v_reviewer;
  if v_reviewer_licence is null then
    raise exception 'your licence isn''t recorded: add it in Settings before publishing a pack' using errcode = '42501';
  end if;
  select left(coalesce(nullif(btrim(profile.display_name), ''), 'A licensed member'), 200), credential.college_id
    into v_owner_name, v_owner_licence
  from public.memberships mem
  left join public.profiles profile on profile.id = mem.user_id
  join public.consultant_credentials credential on credential.membership_id = mem.id and credential.organization_id = mem.organization_id
  where mem.id = p_source_owner and mem.organization_id = v_org and mem.status = 'active'
    and mem.role in ('firm_owner', 'licensed_consultant');
  if v_owner_licence is null then
    raise exception 'the source owner needs a recorded licence at this firm' using errcode = '22023';
  end if;

  foreach v_version_id in array p_version_ids loop
    select * into ver from public.rule_versions where id = v_version_id;
    select * into definition from public.rule_definitions where id = ver.definition_id;
    if ver.id is null or app.rule_item_is_live(ver.id) is distinct from true then
      raise exception 'every claim in the pack has to be live' using errcode = '22023';
    end if;
    if not exists (select 1 from public.rule_evidence e where e.rule_version_id = ver.id) then
      raise exception 'every claim in the pack has to cite its page' using errcode = '22023';
    end if;
    if definition.organization_id is not null and definition.organization_id is distinct from v_org then
      raise exception 'a pack cannot include another firm''s claim' using errcode = '42501';
    end if;
    if definition.program_key is not null and definition.program_key is distinct from v_program then
      raise exception 'that claim is for a different program' using errcode = '22023';
    end if;
    if app.claim_conflict_open(definition.id) then
      raise exception 'a claim in this pack has two official sources that disagree' using errcode = '23514';
    end if;
  end loop;

  select coalesce(max(pack.pack_version), 0) + 1 into v_next
  from public.rule_pack_versions pack
  where pack.organization_id = v_org and pack.jurisdiction = v_jurisdiction and pack.program_key = v_program;

  insert into public.rule_pack_versions (
    organization_id, jurisdiction, program_key, pack_version, status, next_review_at, release_notes
  ) values (
    v_org, v_jurisdiction, v_program, v_next, 'draft', p_next_review_at, left(v_response, 2000)
  )
  returning id into v_pack;

  foreach v_version_id in array p_version_ids loop
    insert into public.rule_pack_items (pack_id, rule_version_id) values (v_pack, v_version_id);
  end loop;

  perform app.use_rule_step_up(v_org, 'pack_publish', v_pack);
  perform set_config('app.pack_review_gate', 'on', true);
  update public.rule_pack_versions pack
  set status = 'published',
      reviewer_membership_id = v_reviewer,
      reviewer_name = v_reviewer_name,
      reviewer_licence = v_reviewer_licence,
      source_owner_membership_id = p_source_owner,
      source_owner_name = v_owner_name,
      source_owner_licence = v_owner_licence,
      reviewed_at = statement_timestamp(),
      effective_from = p_effective_from,
      change_response = left(v_response, 2000)
  where pack.id = v_pack;
  perform set_config('app.pack_review_gate', '', true);

  perform app.record_audit_event(
    v_org, 'rule_pack.published', 'public.rule_pack_versions', v_pack, 'success',
    jsonb_build_object(
      'program_key', v_program,
      'pack_version', v_next,
      'reviewer_membership_id', v_reviewer,
      'reviewer_licence', v_reviewer_licence,
      'source_owner_membership_id', p_source_owner,
      'source_owner_licence', v_owner_licence,
      'effective_from', p_effective_from,
      'next_review_at', p_next_review_at
    )
  );
  return v_pack;
end;
$$;
revoke all on function public.publish_reviewed_program_pack(text, text, uuid[], uuid, timestamptz, timestamptz, text) from public, anon, service_role;
grant execute on function public.publish_reviewed_program_pack(text, text, uuid[], uuid, timestamptz, timestamptz, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Checklist citation, applied as a rule-derived request when the claim is live
-- ---------------------------------------------------------------------------

create function public.set_checklist_item_claim(p_item_id uuid, p_definition_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  item public.checklist_template_items%rowtype;
  template public.checklist_templates%rowtype;
begin
  select * into item from public.checklist_template_items where id = p_item_id;
  select * into template from public.checklist_templates where id = item.template_id;
  if item.id is null or template.organization_id is distinct from app.current_organization_id() then
    raise exception 'checklist denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(template.organization_id, array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[], false);
  if template.status <> 'draft' then
    raise exception 'cite a claim on a draft checklist' using errcode = '22023';
  end if;
  if p_definition_id is not null and app.official_live_version(p_definition_id) is null and not exists (
    select 1 from public.rule_versions ver
    where ver.definition_id = p_definition_id and ver.status = 'published'
      and (ver.organization_id is null or ver.organization_id = template.organization_id)
  ) then
    raise exception 'that claim is not live' using errcode = '22023';
  end if;
  update public.checklist_template_items set cited_definition_id = p_definition_id where id = item.id;
  perform app.record_audit_event(
    template.organization_id, 'checklist.claim_cited', 'public.checklist_template_items', item.id, 'success',
    jsonb_build_object('definition_id', p_definition_id)
  );
  return item.id;
end;
$$;
revoke all on function public.set_checklist_item_claim(uuid, uuid) from public, anon, service_role;
grant execute on function public.set_checklist_item_claim(uuid, uuid) to authenticated;

create or replace function public.apply_checklist(p_matter_id uuid, p_template_id uuid, p_add jsonb, p_remove uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  matter public.matters%rowtype;
  proposals jsonb;
  pick jsonb;
  item public.checklist_template_items%rowtype;
  request_id uuid;
  created integer := 0;
  cancelled integer := 0;
  today date;
  live_ver uuid;
begin
  select * into matter from public.matters where id = p_matter_id;
  if matter.id is null then
    raise exception 'checklist denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(matter.organization_id, array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[], true);
  proposals := app.checklist_proposals(p_matter_id, p_template_id);
  today := app.firm_today(matter.organization_id);

  for pick in select value from jsonb_array_elements(coalesce(p_add, '[]'::jsonb)) loop
    if not exists (
      select 1 from jsonb_array_elements(proposals -> 'add') proposed
      where proposed ->> 'item_id' = pick ->> 'item_id' and proposed ->> 'person_id' = pick ->> 'person_id'
    ) then
      raise exception 'the checklist changed; look at the proposals again' using errcode = 'PT409';
    end if;
    select * into item from public.checklist_template_items where id = (pick ->> 'item_id')::uuid;
    live_ver := null;
    if item.cited_definition_id is not null then
      live_ver := app.official_live_version(item.cited_definition_id);
      if live_ver is null then
        select ver.id into live_ver from public.rule_versions ver
        where ver.definition_id = item.cited_definition_id and ver.status = 'published'
          and (ver.organization_id is null or ver.organization_id = matter.organization_id)
        order by ver.version_number desc limit 1;
      end if;
      if live_ver is null then
        raise exception 'the checklist cites a claim that is not live' using errcode = '22023';
      end if;
    end if;
    request_id := app.create_document_request(
      matter.id,
      (pick ->> 'person_id')::uuid,
      item.purpose,
      item.explanation,
      case when item.due_offset_days is null then null else today + item.due_offset_days end,
      item.acceptable_formats,
      concat_ws(' ', item.review_criteria, case when item.records_expiry then 'Record the expiry date printed on it.' end),
      null,
      case when item.owner = 'staff' then 'staff'::public.document_audience else 'subject'::public.document_audience end,
      'ordinary'::public.document_sensitivity,
      live_ver,
      case when live_ver is null then null else item.item_key end
    );
    perform app.open_document_write(request_id);
    update public.document_requests set checklist_item_id = item.id where id = request_id;
    perform app.close_document_write(request_id);
    created := created + 1;
  end loop;

  if p_remove is not null then
    for request_id in select unnest(p_remove) loop
      if not exists (select 1 from jsonb_array_elements(proposals -> 'remove') proposed where proposed ->> 'request_id' = request_id::text) then
        raise exception 'the checklist changed; look at the proposals again' using errcode = 'PT409';
      end if;
      perform app.open_document_write(request_id);
      update public.document_requests set status = 'cancelled' where id = request_id and status = 'open';
      perform app.close_document_write(request_id);
      perform app.record_audit_event(matter.organization_id, 'document.request_cancelled', 'document_requests', request_id, 'success',
        jsonb_build_object('matter_id', matter.id, 'reason', 'checklist re-applied'));
      cancelled := cancelled + 1;
    end loop;
  end if;

  perform app.record_audit_event(matter.organization_id, 'checklist.applied', 'public.checklist_templates', p_template_id, 'success',
    jsonb_build_object('matter_id', matter.id, 'created', created, 'cancelled', cancelled));
  return jsonb_build_object('created', created, 'cancelled', cancelled);
end;
$$;
revoke all on function public.apply_checklist(uuid, uuid, jsonb, uuid[]) from public;
grant execute on function public.apply_checklist(uuid, uuid, jsonb, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- What the signed-in client may see: the official link and the date checked
-- ---------------------------------------------------------------------------

create function public.portal_claim_sources()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'request_id', request.id,
    'url', evidence.final_url,
    'checked_on', evidence.checked_on,
    'review_pending', conflict.is_open is true or app.rule_version_is_live(request.rule_version_id) is distinct from true,
    'conflict_urls', case when conflict.is_open is true then jsonb_build_array(conflict.left_url, conflict.right_url) else null end
  )), '[]'::jsonb)
  from public.document_requests request
  join public.rule_versions ver on ver.id = request.rule_version_id
  join public.persons person on person.id = request.person_id and person.user_id = (select auth.uid())
  left join lateral (
    select conflict.left_url, conflict.right_url, true as is_open
    from public.source_conflicts conflict
    where conflict.definition_id = ver.definition_id and conflict.status = 'open'
    limit 1
  ) conflict on true
  left join lateral (
    select coalesce(snapshot.final_url, link.source_url) as final_url,
           coalesce(
             case when src.last_checked_at is null then null else app.firm_local_date(request.organization_id, src.last_checked_at) end,
             link.checked_on
           ) as checked_on
    from public.rule_evidence link
    left join public.source_snapshots snapshot on snapshot.id = link.snapshot_id
    left join public.official_sources src on src.id = snapshot.source_id
    where link.rule_version_id = coalesce(app.official_live_version(ver.definition_id), request.rule_version_id)
      and app.host_is_allowlisted(app.official_url_host(coalesce(snapshot.final_url, link.source_url)))
    order by snapshot.retrieved_at desc nulls last
    limit 1
  ) evidence on true
  where request.organization_id = (select app.current_organization_id())
    and request.status = 'open'
    and request.audience <> 'staff'
    and person.organization_id = request.organization_id
    and evidence.final_url is not null;
$$;
revoke all on function public.portal_claim_sources() from public, anon;
grant execute on function public.portal_claim_sources() to authenticated;

comment on function public.portal_claim_sources() is
  'Official link and date checked for the signed-in client''s open document requests that cite a claim. No claim text. A conflict says review is pending and gives both public links.';

-- ---------------------------------------------------------------------------
-- Vo does not cite a claim while two official sources disagree (SRC-08)
-- ---------------------------------------------------------------------------

create function app.vo_conflict_official_items(p_org uuid, p_matter_id uuid)
returns table (id uuid, label text, source_url text, last_checked_on date)
language sql
stable
security definer
set search_path = ''
as $$
  with program as (select app.matter_program_key(p_matter_id) as key)
  select rule.id,
         left(definition.stable_key, 300),
         link.source_url,
         case when src.last_checked_at is null then null else app.firm_local_date(p_org, src.last_checked_at) end
  from public.rule_versions rule
  join public.rule_definitions definition on definition.id = rule.definition_id
  cross join program
  cross join lateral app.rule_version_source(rule.id) src
  cross join lateral (
    select e.source_url from public.rule_evidence e where e.rule_version_id = rule.id and e.snapshot_id is not null limit 1
  ) link
  where rule.origin = 'official_capture'
    and app.rule_version_is_live(rule.id)
    and app.claim_conflict_open(definition.id)
    and (definition.program_key is null or definition.program_key = program.key or definition.stable_key like 'CA.FEES.%')
    and app.vo_citable_official_url(link.source_url);
$$;
revoke all on function app.vo_conflict_official_items(uuid, uuid) from public, anon, authenticated, service_role;

create or replace function app.vo_letter_official_items(p_org uuid, p_matter_id uuid)
returns table (
  kind text,
  id uuid,
  label text,
  content text,
  source_url text,
  source_section text,
  form_number text,
  form_modified_on date,
  checked_on date,
  current_to date,
  snapshot_sha256 text,
  attested_on date,
  reviewed_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select items.*
  from (
    with program as (select app.matter_program_key(p_matter_id) as key)
    select 'fee', fee.id, left(fee.name, 300),
           left(fee.name || ': CAD ' || to_char(fee.amount_cents / 100.0, 'FM999999990.00'), 600),
           fee.source_url, fee.section, null::text, null::date,
           app.firm_local_date(p_org, fee.retrieved_at), null::date, fee.snapshot_sha256, null::date, fee.reviewed_at
    from public.government_fee_references fee
    where fee.organization_id = p_org and fee.status = 'approved'
    union all
    select 'submission_requirement', req.id,
           case when req.kind = 'channel_name' then 'IRCC channel name' else 'Step outside Casevoya' end,
           left(req.label, 600),
           req.source_url, req.source_section, req.form_number, req.form_modified_on,
           req.checked_on, req.current_to, req.snapshot_sha256, req.page_attested_on, req.reviewed_at
    from public.submission_requirements req, program
    where req.organization_id = p_org and req.status = 'approved'
      and (req.program_key is null or req.program_key = program.key)
    union all
    select 'renewal_timing', timing.id, left(timing.applies_to, 300),
           left(timing.applies_to || ': ' || timing.timing_text, 600),
           timing.source_url, timing.source_section, timing.form_number, timing.form_modified_on,
           timing.checked_on, timing.current_to, timing.snapshot_sha256, timing.page_attested_on, timing.reviewed_at
    from public.renewal_timings timing, program
    where timing.organization_id = p_org and timing.status = 'approved'
      and (timing.program_key is null or timing.program_key = program.key)
    union all
    select 'follow_up_step', step.id, left(step.label, 300),
           left(step.label || coalesce(': ' || step.timing_text, ''), 600),
           step.source_url, step.source_section, step.form_number, step.form_modified_on,
           step.checked_on, step.current_to, step.snapshot_sha256, step.page_attested_on, step.reviewed_at
    from public.approval_follow_up_steps step, program
    where step.organization_id = p_org and step.status = 'approved' and step.retired_at is null
      and step.program_key = program.key
    union all
    -- Live claims: a fee claim says which program it is for; the firm's wording when a licensed
    -- member edited the claim (cited with its stamp, app.vo_official_attestation).
    select 'rule_version', rule.id,
           left(definition.stable_key || case when definition.stable_key like 'CA.FEES.%' and definition.program_key is not null then ' (' || definition.program_key || ')' else '' end, 300),
           left(coalesce((firm.row_edit).claim_text, rule.claim)
             || case when (firm.row_edit).id is not null and (firm.row_edit).output_value ->> 'text' is not null
                       and position((firm.row_edit).output_value ->> 'text' in (firm.row_edit).claim_text) = 0
                     then ' (' || ((firm.row_edit).output_value ->> 'text') || ')' else '' end, 600),
           evidence.final_url, evidence.source_section, null::text, evidence.modified_on,
           evidence.checked_on, evidence.current_to, evidence.content_hash, evidence.attested_on, null::timestamptz
    from public.rule_versions rule
    join public.rule_definitions definition on definition.id = rule.definition_id
    cross join program
    cross join lateral (select app.rule_claim_edit(p_org, definition.id) as row_edit) firm
    cross join lateral (
      -- Attested: a captured page as before; otherwise evidence Casevoya couldn't capture that the
      -- approving reviewer attested (who and the date they opened the page), on a deep federal page.
      select coalesce(snapshot.final_url, link.source_url) as final_url,
             link.source_section,
             case when snapshot.id is null then link.modified_on else snapshot.modified_on end as modified_on,
             case when snapshot.id is null then link.checked_on else app.firm_local_date(p_org, snapshot.retrieved_at) end as checked_on,
             case when snapshot.id is null then link.current_to else snapshot.current_to end as current_to,
             snapshot.content_hash,
             case when snapshot.id is null then link.page_attested_on end as attested_on
      from public.rule_evidence link
      left join public.source_snapshots snapshot on snapshot.id = link.snapshot_id
      where link.rule_version_id = rule.id
        and (
          snapshot.id is not null
          or (
            link.snapshot_id is null
            and link.page_attested_on is not null
            and link.page_attested_by_membership_id is not null
            and app.official_claim_url(link.source_url) is not null
            and app.vo_citable_official_url(link.source_url)
            and exists (
              select 1 from public.professional_reviews review
              where review.rule_version_id = rule.id
                and review.decision = 'approved'
                and review.reviewer_membership_id = link.page_attested_by_membership_id
            )
          )
        )
      order by (snapshot.id is null), snapshot.retrieved_at desc nulls last, link.page_attested_at desc
      limit 1
    ) evidence
    where app.rule_version_is_live(rule.id)
      and rule.claim is not null
      and (definition.organization_id is null or definition.organization_id = p_org)
      and (rule.organization_id is null or rule.organization_id = p_org)
      and (
        definition.program_key is null or definition.program_key = program.key
        -- Live claims (bug 6): a fee claim reaches Vo whatever pack the matter has.
        or definition.stable_key like 'CA.FEES.%'
      )
      and app.claim_conflict_open(definition.id) is distinct from true
      -- Live claims (stale block): Vo doesn't cite a fee or advice-like official claim whose source
      -- is overdue for a re-check (public.vo_run_official_content says why).
      and not (
        app.official_claim_stale(rule.id)
        and (
          definition.source_category = 'fee'
          or definition.stable_key like 'CA.FEES.%'
          or app.vo_advice_like(coalesce((firm.row_edit).claim_text, rule.claim))
        )
      )
  ) as items (
    kind, id, label, content, source_url, source_section, form_number, form_modified_on,
    checked_on, current_to, snapshot_sha256, attested_on, reviewed_at
  )
  where app.vo_citable_official_url(items.source_url)
    -- Attested: a page Casevoya didn't capture is citable only with a reviewer's attestation.
    and (items.snapshot_sha256 is not null or items.attested_on is not null);
$$;
revoke all on function app.vo_letter_official_items(uuid, uuid) from public;

create or replace function public.vo_run_official_content(p_run_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  run public.vo_runs;
begin
  run := app.vo_ask_run(p_run_id);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'kind', item.kind,
      'id', item.id,
      'label', item.label,
      'content', item.content,
      'source_url', item.source_url,
      'source_section', item.source_section,
      'form_number', item.form_number,
      'form_modified_on', item.form_modified_on,
      'checked_on', item.checked_on,
      'current_to', item.current_to,
      'snapshot_sha256', item.snapshot_sha256
    -- Attested: the reviewer's attestation when Casevoya didn't capture the page.
    ) || coalesce(
      app.vo_official_attestation(run.organization_id, item.kind, item.id, item.snapshot_sha256, item.attested_on),
      jsonb_build_object('attested', false)
    ) order by item.kind, item.label)
    from (select * from app.vo_letter_official_items(run.organization_id, run.matter_id) limit 400) item
  ), '[]'::jsonb)
  -- Live claims (stale block): what Vo can't cite because its source is overdue, and why.
  || coalesce((
    select jsonb_agg(jsonb_build_object(
      'kind', 'rule_version',
      'id', stale.id,
      'label', stale.label,
      'content', stale.content,
      'source_url', stale.source_url,
      'checked_on', stale.last_checked_on,
      'attested', false,
      'stale', true,
      'citable', false,
      'stale_reason', 'The source for this was last checked '
        || coalesce(to_char(stale.last_checked_on, 'FMDD FMMonth YYYY'), 'never')
        || ' and is due for a re-check'
    ) order by stale.label)
    from (select * from app.vo_stale_official_items(run.organization_id, run.matter_id) limit 100) stale
  ), '[]'::jsonb)
  -- SRC-08: a claim whose official pages disagree is listed and not cited.
  || coalesce((
    select jsonb_agg(jsonb_build_object(
      'kind', 'rule_version',
      'id', blocked.id,
      'label', blocked.label,
      'source_url', blocked.source_url,
      'checked_on', blocked.last_checked_on,
      'attested', false,
      'conflict', true,
      'citable', false,
      'conflict_reason', 'Two official sources disagree, so this claim is not cited until a licensed member reviews it'
    ) order by blocked.label)
    from (select * from app.vo_conflict_official_items(run.organization_id, run.matter_id) limit 100) blocked
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.vo_run_official_content(uuid) from public, anon;
grant execute on function public.vo_run_official_content(uuid) to authenticated, service_role;
