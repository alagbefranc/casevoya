-- Source conflicts on platform-wide claims are scoped to the firm that opened them (security review).
--
-- Until now a conflict a firm's licensed member opened on an official (organization_id is null)
-- claim blocked that claim for every firm and opened review tasks in every affected firm.
--
--  * source_conflicts.status gains 'firm_open': open, but it blocks the claim only for
--    opened_organization_id. 'open' blocks it for every firm and has no opening firm (the re-check,
--    a platform owner/operator, or a maintenance session). Existing open rows a firm opened become
--    'firm_open'. One open review per claim per firm (source_conflicts_one_firm_open_uidx); the
--    platform-wide one stays unique (source_conflicts_one_open_uidx).
--  * app.claim_conflict_open_for(definition, org): the claim is blocked for that firm.
--    app.claim_conflict_open(definition) now means "blocked for the session's firm" (no firm:
--    platform-wide conflicts only).
--  * public.record_source_conflict: a firm opens a 'firm_open' review and gets review tasks in its
--    own firm only (app.open_source_impact_tasks_for_org). A platform owner/operator at a fresh
--    step-up, signed in without a firm, opens a platform-wide one.
--  * Readers redefined with the same signatures (changes marked "Scope"):
--    public.resolve_source_conflict (from 20261030170000), app.block_conflicted_rule_request,
--    app.rule_pack_is_live, public.source_conflict_for, public.portal_claim_sources and
--    app.vo_conflict_official_items (from 20261029180000_src_recheck_conflicts_packs.sql).
--    app.guard_rule_pack, public.program_pack_editor and public.publish_reviewed_program_pack run in
--    the publishing firm's session and use app.claim_conflict_open unchanged.
--  * Row visibility: a firm sees platform-wide conflicts and its own; a platform owner/operator
--    sees all of them.

-- ---------------------------------------------------------------------------
-- Status and scope
-- ---------------------------------------------------------------------------

alter table public.source_conflicts
  drop constraint if exists source_conflicts_status_check,
  add constraint source_conflicts_status_check check (status in ('open', 'firm_open', 'resolved'));

update public.source_conflicts
set status = 'firm_open'
where status = 'open' and opened_organization_id is not null;

alter table public.source_conflicts
  drop constraint if exists source_conflicts_scope_check,
  add constraint source_conflicts_scope_check check (
    (status <> 'firm_open' or opened_organization_id is not null)
    and (status <> 'open' or opened_organization_id is null)
  );

create unique index if not exists source_conflicts_one_firm_open_uidx
  on public.source_conflicts (definition_id, opened_organization_id) where status = 'firm_open';

comment on column public.source_conflicts.opened_organization_id is
  'The firm whose licensed member opened this review; the review affects only that firm (status firm_open). Null for a platform-wide review (re-check or platform owner/operator, status open). Only that firm or a platform owner/operator resolves it.';
comment on column public.source_conflicts.status is
  'open: blocks the claim for every firm. firm_open: blocks it only for opened_organization_id. resolved: closed.';

-- ---------------------------------------------------------------------------
-- Conflict block
-- ---------------------------------------------------------------------------

create or replace function app.claim_conflict_open_for(p_definition uuid, p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.source_conflicts conflict
    where conflict.definition_id = p_definition
      and (
        conflict.status = 'open'
        or (conflict.status = 'firm_open' and p_org is not null and conflict.opened_organization_id = p_org)
      )
  );
$$;
revoke all on function app.claim_conflict_open_for(uuid, uuid) from public, anon, authenticated, service_role;
comment on function app.claim_conflict_open_for(uuid, uuid) is
  'True while this claim is blocked for p_org: a platform-wide conflict, or one p_org opened.';

create or replace function app.claim_conflict_open(p_definition uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.claim_conflict_open_for(p_definition, app.current_organization_id());
$$;
revoke all on function app.claim_conflict_open(uuid) from public, anon;
grant execute on function app.claim_conflict_open(uuid) to authenticated, service_role;
comment on function app.claim_conflict_open(uuid) is
  'True while two stored official pages disagree on this claim for the session''s firm (platform-wide conflicts, and the firm''s own). The claim text stays; it is not cited or newly applied.';

-- Redefined (from 20261029180000): the request's firm decides. Scope.
create or replace function app.block_conflicted_rule_request()
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
  if app.claim_conflict_open_for(definition, new.organization_id) then
    raise exception 'this claim is blocked: two official sources disagree and a review is open'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.block_conflicted_rule_request() from public;

-- Redefined (from 20261029180000): the pack's firm decides (a shared pack: the session's firm). Scope.
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
      join public.rule_pack_versions pack on pack.id = i.pack_id
      where i.pack_id = p_pack
        and app.claim_conflict_open_for(v.definition_id, coalesce(pack.organization_id, app.current_organization_id()))
    );
$$;
revoke all on function app.rule_pack_is_live(uuid) from public, anon;
grant execute on function app.rule_pack_is_live(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Impact tasks for one firm
-- ---------------------------------------------------------------------------

-- As app.open_source_impact_tasks (20261029180000), limited to p_org's matters and templates.
create or replace function app.open_source_impact_tasks_for_org(p_org uuid, p_definition uuid, p_source uuid, p_snapshot uuid, p_title text, p_reason text)
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
  if p_org is null then
    return 0;
  end if;
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
    where affected.organization_id = p_org
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
      and item.organization_id = p_org
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
revoke all on function app.open_source_impact_tasks_for_org(uuid, uuid, uuid, uuid, text, text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Open and resolve
-- ---------------------------------------------------------------------------

-- Redefined (from 20261030170000). Scope: a firm's review affects only that firm; a platform
-- owner/operator at a fresh step-up, signed in without a firm, opens a platform-wide review.
create or replace function public.record_source_conflict(p_definition_id uuid, p_left_evidence uuid, p_right_evidence uuid, p_reason text)
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
  operator boolean;
begin
  -- Scope: platform-wide only for a platform owner/operator outside a firm session.
  operator := v_org is null and app.platform_admin_has_role(array['owner', 'operator']) is true;
  if operator then
    if app.mfa_step_up_satisfied() is distinct from true then
      raise exception 'step-up is required' using errcode = '42501';
    end if;
  else
    perform app.require_licensed_staff(v_org, true);
  end if;
  if reason is null or length(reason) < 3 then
    raise exception 'say why these two pages disagree' using errcode = '22023';
  end if;
  select * into definition from public.rule_definitions d where d.id = p_definition_id and d.organization_id is null and d.source_category is not null;
  if definition.id is null then
    raise exception 'that claim is not an official capture' using errcode = '22023';
  end if;
  -- Scope: a firm is refused when the claim is already blocked for it; an operator when a
  -- platform-wide review is open.
  if (operator and app.claim_conflict_open_for(definition.id, null))
     or (not operator and app.claim_conflict_open_for(definition.id, v_org)) then
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
  if not operator then
    perform app.use_rule_step_up(v_org, 'source_conflict', definition.id);
  end if;
  insert into public.source_conflicts (
    definition_id, left_snapshot_id, right_snapshot_id, left_url, right_url, left_excerpt, right_excerpt,
    opened_reason, created_by, opened_organization_id, status
  ) values (
    definition.id, left_snap.id, right_snap.id, left_snap.final_url, right_snap.final_url,
    left_row.evidence_excerpt, right_row.evidence_excerpt, left(reason, 500), (select auth.uid()),
    case when operator then null else v_org end,
    case when operator then 'open' else 'firm_open' end
  )
  returning id into new_id;
  -- Scope: review tasks in every affected firm only for a platform-wide review.
  if operator then
    perform app.open_source_impact_tasks(definition.id, left_snap.source_id, left_snap.id, 'Two official sources disagree', 'source_conflict');
  else
    perform app.open_source_impact_tasks_for_org(v_org, definition.id, left_snap.source_id, left_snap.id, 'Two official sources disagree', 'source_conflict');
  end if;
  perform app.record_audit_event(
    case when operator then null else v_org end, 'source.conflict_opened', 'public.source_conflicts', new_id, 'success',
    jsonb_build_object('definition_id', definition.id, 'stable_key', definition.stable_key, 'left_url', left_snap.final_url, 'right_url', right_snap.final_url,
      'platform_operator', operator)
  );
  return new_id;
end;
$$;
revoke all on function public.record_source_conflict(uuid, uuid, uuid, text) from public, anon, service_role;
grant execute on function public.record_source_conflict(uuid, uuid, uuid, text) to authenticated;

-- Redefined (from 20261030170000). Scope: a firm_open review is open too.
create or replace function public.resolve_source_conflict(p_conflict_id uuid, p_note text)
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
  operator boolean;
begin
  -- Owner: a platform admin with the owner or operator role (aal2), or else a licensed member.
  operator := app.is_platform_admin() is true
    and exists (
      select 1 from public.platform_admins pa
      where pa.user_id = (select auth.uid()) and pa.role in ('owner', 'operator')
    );
  if operator then
    if app.mfa_step_up_satisfied() is distinct from true then
      raise exception 'step-up is required' using errcode = '42501';
    end if;
  else
    perform app.require_licensed_staff(v_org, true);
  end if;
  if note is null or length(note) < 3 then
    raise exception 'say how this was resolved' using errcode = '22023';
  end if;
  select * into row from public.source_conflicts conflict where conflict.id = p_conflict_id for update;
  if row.id is null then
    raise exception 'that review is not open' using errcode = '22023';
  end if;
  -- Owner: a firm resolves only a review its own licensed member opened.
  if not operator and row.opened_organization_id is distinct from v_org then
    raise exception 'only the firm that opened this review, or a Casevoya operator, can resolve it' using errcode = '42501';
  end if;
  if row.status not in ('open', 'firm_open') then
    raise exception 'that review is not open' using errcode = '22023';
  end if;
  if not operator then
    actor := app.gov_actor_membership(v_org);
    perform app.use_rule_step_up(v_org, 'source_conflict_resolve', row.id);
  end if;
  update public.source_conflicts
  set status = 'resolved', resolution = left(note, 1000), resolved_by_membership_id = actor, resolved_at = statement_timestamp()
  where id = row.id;
  perform app.record_audit_event(
    case when operator then null else v_org end, 'source.conflict_resolved', 'public.source_conflicts', row.id, 'success',
    jsonb_build_object('definition_id', row.definition_id, 'note_length', length(note), 'platform_operator', operator)
  );
  return row.id;
end;
$$;
revoke all on function public.resolve_source_conflict(uuid, text) from public, anon, service_role;
grant execute on function public.resolve_source_conflict(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Readers
-- ---------------------------------------------------------------------------

-- Redefined (from 20261029180000). Scope: platform-wide reviews, the session firm's own, or all
-- for a platform owner/operator; an open review is shown before a resolved one.
create or replace function public.source_conflict_for(p_definition_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', conflict.id,
    'status', case when conflict.status = 'firm_open' then 'open' else conflict.status end,
    'firm_only', conflict.opened_organization_id is not null,
    'left_url', conflict.left_url,
    'right_url', conflict.right_url,
    'left_excerpt', conflict.left_excerpt,
    'right_excerpt', conflict.right_excerpt,
    'opened_reason', conflict.opened_reason,
    'resolution', conflict.resolution
  )
  from public.source_conflicts conflict
  where conflict.definition_id = p_definition_id
    and (
      conflict.opened_organization_id is null
      or conflict.opened_organization_id = app.current_organization_id()
      or app.platform_admin_has_role(array['owner', 'operator'])
    )
  order by (conflict.status <> 'resolved') desc, conflict.created_at desc
  limit 1;
$$;
revoke all on function public.source_conflict_for(uuid) from public, anon;
grant execute on function public.source_conflict_for(uuid) to authenticated, service_role;

-- Redefined (from 20261029180000). Scope: the request's firm decides.
create or replace function public.portal_claim_sources()
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
    where conflict.definition_id = ver.definition_id
      and (
        conflict.status = 'open'
        or (conflict.status = 'firm_open' and conflict.opened_organization_id = request.organization_id)
      )
    order by (conflict.status = 'open') desc
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

-- Redefined (from 20261029180000). Scope: blocked for p_org.
create or replace function app.vo_conflict_official_items(p_org uuid, p_matter_id uuid)
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
    and app.claim_conflict_open_for(definition.id, p_org)
    and (definition.program_key is null or definition.program_key = program.key or definition.stable_key like 'CA.FEES.%')
    and app.vo_citable_official_url(link.source_url);
$$;
revoke all on function app.vo_conflict_official_items(uuid, uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Row visibility
-- ---------------------------------------------------------------------------

do $policies$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'source_conflicts' and policyname = 'source_conflicts_select_scope'
  ) then
    execute $policy$
      create policy source_conflicts_select_scope on public.source_conflicts
        as restrictive for select to authenticated
        using (
          opened_organization_id is null
          or opened_organization_id = (select app.current_organization_id())
          or (select app.platform_admin_has_role(array['owner', 'operator']))
        )
    $policy$;
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'source_conflicts' and policyname = 'source_conflicts_select_platform'
  ) then
    execute $policy$
      create policy source_conflicts_select_platform on public.source_conflicts
        for select to authenticated
        using ((select app.platform_admin_has_role(array['owner', 'operator'])))
    $policy$;
  end if;
end
$policies$;
