-- SRC-05 / SRC-12 on top of the SRC-03 publication gate (20261025400000_src_claims_review.sql).
--
-- 1. One definition of "live". SRC-03 defines a live rule version as app.rule_version_is_live:
--    status published and today within its stated effective dates; review_due, suspended,
--    superseded, rejected, expired (effective_to passed) and unapproved versions never count. A rule
--    pack now counts as live (supported, pinnable as current, offered as an upgrade) only when the
--    pack itself is published and every rule version in it is live (app.rule_pack_is_live). Before,
--    a pack counted when it was published or review due, whatever its rule versions' status.
--    Matters already pinned keep their pin; nothing moves a pin automatically.
-- 2. One homepage rule. app.src_deep_official_url delegates to app.official_claim_url (SRC-01) for
--    federal pages (canada.ca, gc.ca), and applies the same rule (at least two path segments
--    besides language folders and index pages) to the other allowlisted official hosts
--    (provincial program pages), which official_claim_url does not accept.
--
-- Redefined (copied from their latest definitions in 20261025410000_src_pins_scope.sql; changes
-- marked "SRC-03 live" or "SRC-01 homepage"):
--   app.src_deep_official_url(text)       homepage rule matches app.official_claim_url
--   app.current_program_pack(uuid, text)   live packs only
--   app.newer_rule_pack(uuid)              live packs only
--   app.matter_rule_state(uuid)            adds binding.pack_live
--   app.decide_matter_rule_upgrade(...)    the newer pack must be live
--   app.support_catalogue(uuid)            programs listed from live packs only
-- New: app.rule_pack_is_live(uuid). The claims functions (app.rule_version_is_live,
-- app.official_claim_url) are called as they are, never redefined. Additive; seeds nothing.

-- ---------------------------------------------------------------------------
-- Live pack (SRC-03 live)
-- ---------------------------------------------------------------------------

-- A rule pack is live when it is published and has rule versions, each live by
-- app.rule_version_is_live (the single definition of a live rule version).
create function app.rule_pack_is_live(p_pack uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
      select 1 from public.rule_pack_versions pack
      where pack.id = p_pack
        and pack.status = 'published'
    )
    and exists (select 1 from public.rule_pack_items i where i.pack_id = p_pack)
    and not exists (
      select 1
      from public.rule_pack_items i
      where i.pack_id = p_pack
        and app.rule_version_is_live(i.rule_version_id) is distinct from true
    );
$$;
revoke all on function app.rule_pack_is_live(uuid) from public, anon;
comment on function app.rule_pack_is_live(uuid) is
  'SRC-05/SRC-12: a pack is live when it is published and every rule version in it is live (app.rule_version_is_live).';

-- ---------------------------------------------------------------------------
-- Redefined: app.src_deep_official_url (from 20261025410000_src_pins_scope.sql)
-- SRC-01 homepage: one rule with app.official_claim_url.
-- ---------------------------------------------------------------------------

-- An official deep link: allowlisted host and a page path, never a site root or landing page. A
-- federal page passes exactly when app.official_claim_url accepts it; another allowlisted official
-- host (a province's) passes under the same rule: at least two path segments besides language
-- folders and index pages.
create or replace function app.src_deep_official_url(p_url text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_host text := app.official_url_host(p_url);
  v_path text;
  v_part text;
  v_meaningful integer := 0;
begin
  if v_host is null or app.host_is_allowlisted(v_host) is distinct from true then
    return false;
  end if;
  if app.federal_official_url(p_url) is not null then
    return app.official_claim_url(p_url) is not null;
  end if;
  -- The same path rule as app.official_claim_url, for allowlisted hosts outside canada.ca / gc.ca.
  v_path := split_part(split_part(substring(btrim(p_url) from 9), '#', 1), '?', 1);
  v_path := substring(v_path from length(split_part(v_path, '/', 1)) + 1);
  foreach v_part in array string_to_array(lower(v_path), '/') loop
    v_part := regexp_replace(v_part, '\.(html?|aspx?|php)$', '');
    if v_part <> '' and v_part !~ '^(en|fr|eng|fra|english|francais|index|home|default|accueil|welcome)$' then
      v_meaningful := v_meaningful + 1;
    end if;
  end loop;
  return v_meaningful >= 2;
end;
$$;
revoke all on function app.src_deep_official_url(text) from public, anon;
grant execute on function app.src_deep_official_url(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Redefined: app.current_program_pack (from 20261025410000_src_pins_scope.sql)
-- SRC-03 live: a pack counts only when app.rule_pack_is_live.
-- ---------------------------------------------------------------------------
-- The current live, sourced pack for a program. With a firm: one that firm may select (its own
-- or the platform's, for a jurisdiction it practises). Without: the platform's own packs only.
create or replace function app.current_program_pack(p_org uuid, p_program_key text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select pack.id
  from public.rule_pack_versions pack
  where pack.program_key = p_program_key
    and app.rule_pack_is_live(pack.id)
    and (
      (p_org is null and pack.organization_id is null)
      or (p_org is not null and app.pack_is_selectable(pack.id, p_org))
    )
    and app.pack_is_sourced(pack.id)
  order by pack.pack_version desc, pack.organization_id nulls last, pack.created_at desc
  limit 1;
$$;
revoke all on function app.current_program_pack(uuid, text) from public, anon;

-- ---------------------------------------------------------------------------
-- Redefined: app.newer_rule_pack (from 20261025410000_src_pins_scope.sql)
-- SRC-03 live: the newer pack must be live (app.rule_pack_is_live).
-- ---------------------------------------------------------------------------
-- The newer live pack for a binding: same program and jurisdiction, a higher version, one the
-- firm may select, sourced. Null when there is none.
create or replace function app.newer_rule_pack(p_binding_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select nxt.id
  from public.matter_rule_bindings b
  join public.rule_pack_versions cur on cur.id = b.rule_pack_version_id
  join public.rule_pack_versions nxt
    on nxt.program_key = cur.program_key
   and nxt.jurisdiction = cur.jurisdiction
   and nxt.pack_version > cur.pack_version
  where b.id = p_binding_id
    and app.rule_pack_is_live(nxt.id)
    and app.pack_is_selectable(nxt.id, b.organization_id)
    and app.pack_is_sourced(nxt.id)
  order by nxt.pack_version desc, nxt.organization_id nulls last
  limit 1;
$$;
revoke all on function app.newer_rule_pack(uuid) from public, anon;

-- ---------------------------------------------------------------------------
-- Redefined: app.matter_rule_state (from 20261025410000_src_pins_scope.sql)
-- SRC-03 live: binding.pack_live says whether the pinned pack is still live.
-- ---------------------------------------------------------------------------
-- What the matter overview shows: the pin (pack, forms, recheck flag), a newer approved version with
-- its impact preview, the last decision on it, and the program scope the matter was opened with.
create or replace function app.matter_rule_state(p_matter_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_matter public.matters%rowtype;
  v_binding public.matter_rule_bindings%rowtype;
  v_pack public.rule_pack_versions%rowtype;
  v_next public.rule_pack_versions%rowtype;
  v_scope public.matter_program_scopes%rowtype;
  v_decision public.matter_rule_upgrade_decisions%rowtype;
  v_next_id uuid;
begin
  select * into v_matter from public.matters m where m.id = p_matter_id;
  if v_matter.id is null
     or v_matter.organization_id is distinct from app.current_organization_id()
     or app.is_org_staff(v_matter.organization_id) is distinct from true
     or app.staff_mfa_satisfied() is distinct from true
     or app.can_read_matter(v_matter.id) is distinct from true then
    raise exception 'rule pin read denied' using errcode = '42501';
  end if;
  select * into v_scope from public.matter_program_scopes s where s.matter_id = v_matter.id;
  select * into v_binding from public.matter_rule_bindings b where b.matter_id = v_matter.id and b.superseded_at is null;
  if v_binding.id is null then
    return jsonb_build_object(
      'matter_version', v_matter.version,
      'binding', null,
      'scope', case when v_scope.id is null then null else jsonb_build_object('program_key', v_scope.program_key, 'supported', v_scope.supported) end
    );
  end if;
  select * into v_pack from public.rule_pack_versions p where p.id = v_binding.rule_pack_version_id;
  v_next_id := app.newer_rule_pack(v_binding.id);
  if v_next_id is not null then
    select * into v_next from public.rule_pack_versions p where p.id = v_next_id;
    select * into v_decision
    from public.matter_rule_upgrade_decisions d
    where d.from_binding_id = v_binding.id and d.to_pack_id = v_next_id
    order by d.decided_at desc
    limit 1;
  end if;
  return jsonb_build_object(
    'matter_version', v_matter.version,
    'scope', case when v_scope.id is null then null else jsonb_build_object('program_key', v_scope.program_key, 'supported', v_scope.supported) end,
    'binding', jsonb_build_object(
      'id', v_binding.id,
      'pinned_at', v_binding.created_at,
      'recheck_required', v_binding.recheck_required,
      'pack_id', v_pack.id,
      'program_key', v_pack.program_key,
      'jurisdiction', v_pack.jurisdiction,
      'pack_version', v_pack.pack_version,
      'pack_status', v_pack.status,
      'pack_live', app.rule_pack_is_live(v_pack.id),
      'platform', v_pack.organization_id is null,
      'forms', coalesce(v_binding.form_versions, '[]'::jsonb)
    ),
    'newer', case when v_next.id is null then null else jsonb_build_object(
      'pack_id', v_next.id,
      'pack_version', v_next.pack_version,
      'release_notes', v_next.release_notes,
      'platform', v_next.organization_id is null,
      'impact', app.rule_pack_impact(v_matter.id, v_binding.id, v_next.id),
      'decision', case when v_decision.id is null then null else jsonb_build_object(
        'decision', v_decision.decision,
        'reason', v_decision.reason,
        'decided_at', v_decision.decided_at,
        'decided_membership_id', v_decision.decided_membership_id
      ) end
    ) end
  );
end;
$$;
revoke all on function app.matter_rule_state(uuid) from public, anon;

-- ---------------------------------------------------------------------------
-- Redefined: app.decide_matter_rule_upgrade (from 20261025410000_src_pins_scope.sql)
-- SRC-03 live: the newer pack must be live (app.rule_pack_is_live).
-- ---------------------------------------------------------------------------
create or replace function app.decide_matter_rule_upgrade(
  p_matter_id uuid,
  p_to_pack_id uuid,
  p_expected_version integer,
  p_decision text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_matter public.matters%rowtype;
  v_binding public.matter_rule_bindings%rowtype;
  v_cur public.rule_pack_versions%rowtype;
  v_next public.rule_pack_versions%rowtype;
  v_impact jsonb;
  v_member uuid;
  v_new_binding uuid;
  v_new_version integer;
  v_decision_id uuid;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if p_decision is null or p_decision not in ('accepted', 'declined') then
    raise exception 'the decision is accepted or declined' using errcode = '22023';
  end if;
  if length(v_reason) not between 3 and 500 then
    raise exception 'say why, in 3 to 500 characters' using errcode = '22023';
  end if;
  select * into v_matter from public.matters m where m.id = p_matter_id for update;
  if v_matter.id is null or app.can_read_matter(v_matter.id) is distinct from true then
    raise exception 'upgrade decision denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    v_matter.organization_id,
    array['firm_owner', 'licensed_consultant']::public.org_role[],
    p_decision = 'accepted'
  );
  if v_matter.version is distinct from p_expected_version then
    raise exception 'matter version conflict' using errcode = '40001';
  end if;
  select * into v_binding from public.matter_rule_bindings b where b.matter_id = v_matter.id and b.superseded_at is null;
  if v_binding.id is null then
    raise exception 'this matter has no pinned rule pack' using errcode = '22023';
  end if;
  select * into v_cur from public.rule_pack_versions p where p.id = v_binding.rule_pack_version_id;
  select * into v_next from public.rule_pack_versions p where p.id = p_to_pack_id;
  if v_next.id is null
     or v_next.program_key is distinct from v_cur.program_key
     or v_next.jurisdiction is distinct from v_cur.jurisdiction
     or v_next.pack_version <= v_cur.pack_version then
    raise exception 'that is not a newer version of this matter''s rule pack' using errcode = '22023';
  end if;
  if app.rule_pack_is_live(v_next.id) is distinct from true
     or app.pack_is_selectable(v_next.id, v_matter.organization_id) is distinct from true
     or app.pack_is_sourced(v_next.id) is distinct from true then
    raise exception 'the newer rule pack is not approved for this firm' using errcode = '42501';
  end if;

  v_impact := app.rule_pack_impact(v_matter.id, v_binding.id, v_next.id);
  select mem.id into v_member
  from public.memberships mem
  where mem.organization_id = v_matter.organization_id
    and mem.user_id = (select auth.uid())
    and mem.status = 'active'
  order by mem.created_at
  limit 1;

  if p_decision = 'accepted' then
    -- The existing program selection moves the pin: old binding superseded, new binding, program
    -- change history and its audit event. It asks for a step-up and the matter version again.
    v_new_version := app.select_matter_program(
      v_matter.id, v_next.id, p_expected_version, left('Rule pack upgrade: ' || v_reason, 500)
    );
    select b.id into v_new_binding
    from public.matter_rule_bindings b
    where b.matter_id = v_matter.id and b.superseded_at is null;
  else
    v_new_version := v_matter.version;
  end if;

  insert into public.matter_rule_upgrade_decisions (
    organization_id, matter_id, from_binding_id, from_pack_id, to_pack_id, decision, reason, impact,
    new_binding_id, decided_by, decided_membership_id
  ) values (
    v_matter.organization_id, v_matter.id, v_binding.id, v_cur.id, v_next.id, p_decision, v_reason, v_impact,
    v_new_binding, (select auth.uid()), v_member
  )
  returning id into v_decision_id;

  perform app.record_audit_event(
    v_matter.organization_id,
    'matter.rule_upgrade_' || p_decision,
    'public.matters',
    v_matter.id,
    'success',
    jsonb_build_object(
      'decision_id', v_decision_id,
      'matter_id', v_matter.id,
      'from_pack_id', v_cur.id,
      'from_version', v_cur.pack_version,
      'to_pack_id', v_next.id,
      'to_version', v_next.pack_version,
      'rules_changed', jsonb_array_length(v_impact -> 'rules'),
      'forms_changed', jsonb_array_length(v_impact -> 'forms'),
      'new_binding_id', v_new_binding
    )
  );
  return jsonb_build_object('decision_id', v_decision_id, 'decision', p_decision, 'matter_version', v_new_version);
end;
$$;
revoke all on function app.decide_matter_rule_upgrade(uuid, uuid, integer, text, text) from public, anon;

-- ---------------------------------------------------------------------------
-- Redefined: app.support_catalogue (from 20261025410000_src_pins_scope.sql)
-- SRC-03 live: programs without a catalogue entry are listed from live packs only.
-- ---------------------------------------------------------------------------
-- The catalogue as anyone may read it (the public page), or as a firm's staff read it (their own
-- approved packs count too, and their firm's jurisdictions are listed). Support is derived, never stored.
create or replace function app.support_catalogue(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_programs jsonb;
  v_jurisdictions jsonb;
  v_case_types jsonb;
  v_firm text[];
begin
  if p_org is not null
     and (select auth.uid()) is not null
     and p_org = app.current_organization_id()
     and app.is_org_staff(p_org)
     and app.staff_mfa_satisfied() then
    v_org := p_org;
    select org.jurisdiction_codes into v_firm from public.organizations org where org.id = v_org;
  end if;

  with catalogued as (
    select e.scope_key as program_key, e.label, e.jurisdiction, e.case_type_key, e.official_name, e.snapshot_id,
      e.source_section, e.position, true as catalogued
    from public.support_catalogue_entries e
    where e.scope_kind = 'program' and e.active
  ),
  pack_only as (
    select distinct on (pack.program_key)
      pack.program_key, null::text as label, pack.jurisdiction, null::text as case_type_key, null::text as official_name,
      null::uuid as snapshot_id, null::text as source_section, 1000 as position, false as catalogued
    from public.rule_pack_versions pack
    where app.rule_pack_is_live(pack.id)
      and (pack.organization_id is null or pack.organization_id = v_org)
      and not exists (
        select 1 from public.support_catalogue_entries e where e.scope_kind = 'program' and e.scope_key = pack.program_key
      )
    order by pack.program_key, pack.pack_version desc
  ),
  programs as (
    select c.*, app.current_program_pack(v_org, c.program_key) as pack_id
    from (select * from catalogued union all select * from pack_only) c
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'key', p.program_key,
      'label', p.label,
      'jurisdiction', p.jurisdiction,
      'case_type', p.case_type_key,
      'catalogued', p.catalogued,
      'supported', p.pack_id is not null,
      'pack_version', pack.pack_version,
      'pack_scope', case when pack.id is null then null when pack.organization_id is null then 'platform' else 'firm' end,
      'official', case when snap.id is null then null else jsonb_build_object(
        'name', p.official_name,
        'url', snap.final_url,
        'section', p.source_section,
        'retrieved_at', snap.retrieved_at,
        'modified_on', snap.modified_on,
        'content_hash', snap.content_hash,
        'reviewed', snap.review_status = 'verified'
      ) end
    ) order by p.position, p.program_key), '[]'::jsonb)
  into v_programs
  from programs p
  left join public.rule_pack_versions pack on pack.id = p.pack_id
  left join public.source_snapshots snap on snap.id = p.snapshot_id;

  select coalesce(jsonb_agg(jsonb_build_object(
      'key', e.scope_key,
      'label', e.label,
      'note', e.note,
      'supported', exists (
        select 1 from jsonb_array_elements(v_programs) prog
        where (prog ->> 'supported')::boolean and prog ->> 'jurisdiction' = e.scope_key
      ),
      'firm_practises', v_firm is not null and e.scope_key = any(v_firm)
    ) order by e.position, e.scope_key), '[]'::jsonb)
  into v_jurisdictions
  from public.support_catalogue_entries e
  where e.scope_kind = 'jurisdiction' and e.active;

  select coalesce(jsonb_agg(jsonb_build_object(
      'key', e.scope_key,
      'label', e.label,
      'note', e.note,
      'supported', exists (
        select 1 from jsonb_array_elements(v_programs) prog
        where (prog ->> 'supported')::boolean and prog ->> 'case_type' = e.scope_key
      )
    ) order by e.position, e.scope_key), '[]'::jsonb)
  into v_case_types
  from public.support_catalogue_entries e
  where e.scope_kind = 'case_type' and e.active;

  return jsonb_build_object(
    'programs', v_programs,
    'jurisdictions', v_jurisdictions,
    'case_types', v_case_types,
    'firm_jurisdictions', case when v_org is null then null else to_jsonb(coalesce(v_firm, '{}'::text[])) end
  );
end;
$$;
revoke all on function app.support_catalogue(uuid) from public, anon;
