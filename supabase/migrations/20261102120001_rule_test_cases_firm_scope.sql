-- Rule test cases stay with the firm that wrote them (#303). Additive only; each function is
-- copied from its latest definition (named above it) and only the marked parts change.
--
-- public.save_rule_test_case: a case is always stored with the caller's firm, also for a platform
--   rule, and a platform rule version's test_case_ids is never changed from a firm session. inputs
--   are capped at 4000 characters. Marked "Firm".
-- app.rule_test_case_trusted: a case counts for a firm when it is that firm's, or when it is a
--   platform case written by a platform owner or operator (or by a maintenance session).
--   It takes the case id, so it answers only for a case the caller names.
-- public.run_rule_tests, the 'no test cases' gate in app.guard_rule_pack and the
--   'missing_test_cases' blocker in app.rule_publication_blockers count only those cases.
--   Marked "Trusted".
-- rule_test_cases: a restrictive select policy hides platform (null-firm) cases not written by a
--   platform owner or operator.

-- Takes the case id (not an author id), so it answers only for a case the caller names.
create or replace function app.rule_test_case_trusted(p_org uuid, p_case_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select
      (p_org is not null and c.organization_id = p_org)
      or (
        c.organization_id is null
        and (
          c.created_by is null
          or exists (
            select 1 from public.platform_admins pa
            where pa.user_id = c.created_by and pa.role in ('owner', 'operator')
          )
        )
      )
    from public.rule_test_cases c
    where c.id = p_case_id
  ), false);
$$;
revoke all on function app.rule_test_case_trusted(uuid, uuid) from public, anon;
grant execute on function app.rule_test_case_trusted(uuid, uuid) to authenticated, service_role;

do $policy$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'rule_test_cases' and policyname = 'rule_test_cases_select_trusted'
  ) then
    create policy rule_test_cases_select_trusted on public.rule_test_cases
      as restrictive
      for select to authenticated
      using (
        organization_id is not null
        or app.rule_test_case_trusted(null::uuid, id)
      );
  end if;
end
$policy$;

-- From 20261029180000_src_recheck_conflicts_packs.sql.
create or replace function public.save_rule_test_case(
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
  -- Firm: the case belongs to the caller's firm.
  if v_org is null then
    raise exception 'choose a firm' using errcode = '42501';
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
  -- Firm: inputs are capped.
  if length(inputs::text) > 4000 then
    raise exception 'the inputs are too long' using errcode = '22023';
  end if;
  perform app.use_rule_step_up(v_org, 'rule_test', definition.id);
  insert into public.rule_test_cases (organization_id, definition_id, kind, title, inputs, expected, created_by)
  values (
    v_org,
    definition.id, p_kind, left(title, 200), inputs, p_expected, (select auth.uid())
  )
  returning id into new_id;

  -- Firm: only the firm's own rule versions list the case.
  if definition.organization_id is not null then
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
  end if;

  perform app.record_audit_event(
    v_org, 'rule.test_case_added', 'public.rule_test_cases', new_id, 'success',
    jsonb_build_object('definition_id', definition.id, 'kind', p_kind, 'expected', p_expected)
  );
  return new_id;
end;
$$;

-- From 20261029180000_src_recheck_conflicts_packs.sql.
create or replace function public.run_rule_tests(p_definition_id uuid)
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
      -- Trusted
      and app.rule_test_case_trusted(v_org, c.id)
    order by c.created_at
  loop
    results := results || jsonb_build_array(app.evaluate_rule_test(version, tc.id));
  end loop;
  return jsonb_build_object('version_id', version, 'cases', results);
end;
$$;

-- From 20261029180000_src_recheck_conflicts_packs.sql.
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
    -- Trusted: only a case of the rule that is this pack's firm's or a trusted platform case
    -- counts (a listed id that is not such a case does not).
    if exists (
      select 1
      from public.rule_pack_items i
      join public.rule_versions v on v.id = i.rule_version_id
      where i.pack_id = new.id
        and v.structured_condition is not null
        and not exists (
          select 1 from public.rule_test_cases c
          where c.definition_id = v.definition_id
            and app.rule_test_case_trusted(new.organization_id, c.id)
        )
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

-- From 20261025600100_src_live_claims.sql. Only the 'missing_test_cases' check changes (marked
-- "Trusted"): a listed id counts only when it is a case of this rule that is the version's firm's
-- or a trusted platform case.
create or replace function app.rule_publication_blockers(p_id uuid, p_content_revision integer)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  rv public.rule_versions%rowtype;
  blockers text[] := array[]::text[];
  evidence_count integer;
  usable integer;
  copied integer;
begin
  select * into rv from public.rule_versions where id = p_id;
  if not found then
    return array['missing_rule_version']::text[];
  end if;
  if rv.claim is null or length(btrim(rv.claim)) = 0 then
    blockers := array_append(blockers, 'missing_claim');
  end if;

  -- Live claims: an official capture rests on its captured page alone.
  if rv.origin = 'official_capture' then
    if not exists (
      select 1
      from public.rule_evidence e
      join public.source_snapshots s on s.id = e.snapshot_id
      join public.official_sources src on src.id = s.source_id
      where e.rule_version_id = p_id
        and e.source_section is not null
        and length(btrim(e.source_section)) > 0
        and s.content_hash ~ '^[0-9a-f]{64}$'
        and s.retrieved_at is not null
        and src.organization_id is null
        and app.official_claim_url(e.source_url) is not null
        and app.host_is_allowlisted(app.official_url_host(s.final_url))
    ) then
      blockers := array_append(blockers, 'missing_captured_page');
    end if;
    return blockers;
  end if;

  if rv.next_review_at is null then
    blockers := array_append(blockers, 'missing_next_review_at');
  end if;
  -- SRC-01: only an executable rule needs test cases.
  -- Trusted
  if rv.structured_condition is not null and not exists (
    select 1
    from unnest(coalesce(rv.test_case_ids, '{}'::text[])) listed (item)
    join public.rule_test_cases c on c.id::text = listed.item
    where c.definition_id = rv.definition_id
      and app.rule_test_case_trusted(rv.organization_id, c.id)
  ) then
    blockers := array_append(blockers, 'missing_test_cases');
  end if;
  if rv.effective_from is null and rv.applicability_established is not true then
    blockers := array_append(blockers, 'missing_effective_applicability');
  end if;
  if rv.applicability_established is true
     and (rv.applicability_note is null or length(btrim(rv.applicability_note)) = 0) then
    blockers := array_append(blockers, 'missing_applicability_note');
  end if;

  select count(*) into evidence_count
  from public.rule_evidence e
  where e.rule_version_id = p_id;
  if evidence_count = 0 then
    blockers := array_append(blockers, 'missing_evidence');
  else
    select count(*) into usable
    from public.rule_evidence e
    left join public.source_snapshots s on s.id = e.snapshot_id
    left join public.official_sources src on src.id = s.source_id
    where e.rule_version_id = p_id
      and e.source_section is not null
      and length(btrim(e.source_section)) > 0
      and (
        (
          s.id is not null
          and s.content_hash ~ '^[0-9a-f]{64}$'
          and s.retrieved_at is not null
          and length(btrim(s.publisher)) > 0
          and length(btrim(src.publisher)) > 0
          and app.host_is_allowlisted(app.official_url_host(s.final_url))
        )
        -- SRC-01: no capture, but the approving reviewer attested the official page.
        or (
          e.snapshot_id is null
          and e.page_attested_on is not null
          and app.official_claim_url(e.source_url) is not null
        )
      );
    if usable = 0 then
      blockers := array_append(blockers, 'missing_source_section');
    end if;
    select count(*) into copied
    from public.rule_evidence e
    join public.source_snapshots s on s.id = e.snapshot_id
    where e.rule_version_id = p_id
      and rv.effective_from is not null
      and rv.effective_from = s.retrieved_at
      and s.published_at is null
      and s.published_on is null
      and s.current_to is null
      and rv.applicability_established is not true;
    if copied > 0 then
      blockers := array_append(blockers, 'effective_from_copies_retrieved_at');
    end if;
  end if;

  if not exists (
    select 1
    from public.professional_reviews r
    where r.rule_version_id = p_id
      and r.decision = 'approved'
      and r.decided_at is not null
      and r.rule_content_revision = p_content_revision
      and (rv.organization_id is null or r.organization_id = rv.organization_id)
  ) then
    blockers := array_append(blockers, 'missing_reviewer');
  end if;

  return blockers;
end;
$$;
revoke all on function app.rule_publication_blockers(uuid, integer) from public;
