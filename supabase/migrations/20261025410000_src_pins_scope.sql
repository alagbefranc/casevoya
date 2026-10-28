-- SRC-05 (pin and migrate matter rule versions) and SRC-12 (honest scope). PRD SRC-05, SRC-12.
--
-- Reuses the source governance model (20261017113157_source_governance.sql): rule_pack_versions,
-- rule_pack_items, rule_evidence, source_snapshots and matter_rule_bindings. No rule, fee, form,
-- program name or date is seeded. Nothing here approves content: a pack counts only when it is
-- already published (or review due) through the existing publication gate.
--
-- 1. Form versions on the pin. A pack's form_mappings (frozen once the pack is published) lists the
--    IRCC forms it uses as [{"form_number": "...", "snapshot_id": "<source_snapshots.id>"}]. When a
--    matter pins the pack, matter_rule_bindings.form_versions keeps each form number with the
--    "date modified" the official page states (source_snapshots.modified_on), the page URL,
--    retrieval time and SHA-256, but only from a snapshot that a rule version in the pack cites as
--    evidence. Anything else stays Unknown (null). The column never changes after the pin.
-- 2. Packages record the versions used. matter_exports and submission_handoffs get the binding, pack
--    and form versions in force when the export is requested or the package is released. They never
--    change afterwards, so an earlier export or package keeps the versions it was made with.
-- 3. Upgrades. app.matter_rule_state shows the pinned pack, a newer approved version of the same
--    program and jurisdiction, and an impact preview (checklist items, fields, deadlines, forms and
--    other rules that change, and the matter's own checklist items and deadlines they touch).
--    public.decide_matter_rule_upgrade records an audited accept or decline
--    (matter_rule_upgrade_decisions); accept moves the pin through the existing
--    app.select_matter_program (new binding, old one superseded, step-up required).
-- 4. Support catalogue. support_catalogue_entries is the platform's scope configuration:
--    jurisdictions and case types (seeded below; no program is seeded), and programs a platform admin
--    adds with the snapshot of their official canada.ca page. public.support_catalogue reports each
--    as supported only when an approved (published or review due), sourced rule pack exists. An
--    official program name is shown only with its snapshot, and as reviewed only once that snapshot
--    is verified in the governance workflow.
-- 5. Unsupported programs inherit nothing. public.create_client_matter_for_program opens a matter
--    for a catalogued program: with the program's current approved pack, or with no pack at all when
--    the program is not supported (matter_program_scopes records which). A matter opened for an
--    unsupported program cannot be pinned to another program's pack, and no matter can take a
--    rule-derived checklist item or deadline from outside the pack pinned on it.
--
-- New functions only; no existing function is redefined (app.select_matter_program,
-- app.pack_is_selectable and public.create_client_matter are called as they are). Forced RLS on
-- every new table; writes only through SECURITY DEFINER functions with search_path ''. Additive only.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- An official deep link: allowlisted host and a page path, never a site root or landing page.
create function app.src_deep_official_url(p_url text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_host text := app.official_url_host(p_url);
  v_rest text;
  v_path text;
begin
  if v_host is null or app.host_is_allowlisted(v_host) is distinct from true then
    return false;
  end if;
  v_rest := substring(btrim(p_url) from 9);
  if position('/' in v_rest) = 0 then
    return false;
  end if;
  v_path := lower(split_part(split_part(substring(v_rest from position('/' in v_rest)), '?', 1), '#', 1));
  if v_path in (
    '', '/', '/en', '/fr', '/en/', '/fr/', '/eng', '/fra', '/eng/', '/fra/', '/en.html', '/fr.html',
    '/english', '/english/', '/francais', '/francais/', '/english/index.asp', '/francais/index.asp',
    '/en/immigration-refugees-citizenship.html', '/fr/immigration-refugies-citoyennete.html',
    '/en/services.html', '/fr/services.html', '/en/government.html', '/fr/gouvernement.html'
  ) or v_path ~ '^/(index|default|home)\.[a-z]+$' or v_path ~ '^/(en|fr|eng|fra)/(index|default|home)\.[a-z]+$' then
    return false;
  end if;
  return true;
end;
$$;
revoke all on function app.src_deep_official_url(text) from public, anon;
grant execute on function app.src_deep_official_url(text) to authenticated, service_role;

-- A pack is sourced when it has items and every rule version in it cites official evidence.
create function app.pack_is_sourced(p_pack uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.rule_pack_items i where i.pack_id = p_pack)
     and not exists (
       select 1
       from public.rule_pack_items i
       where i.pack_id = p_pack
         and not exists (select 1 from public.rule_evidence e where e.rule_version_id = i.rule_version_id)
     );
$$;
revoke all on function app.pack_is_sourced(uuid) from public, anon;

-- The current approved, sourced pack for a program. With a firm: one that firm may select (its own
-- or the platform's, for a jurisdiction it practises). Without: the platform's own packs only.
create function app.current_program_pack(p_org uuid, p_program_key text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select pack.id
  from public.rule_pack_versions pack
  where pack.program_key = p_program_key
    and pack.status in ('published', 'review_due')
    and (
      (p_org is null and pack.organization_id is null)
      or (p_org is not null and app.pack_is_selectable(pack.id, p_org))
    )
    and app.pack_is_sourced(pack.id)
  order by pack.pack_version desc, pack.organization_id nulls last, pack.created_at desc
  limit 1;
$$;
revoke all on function app.current_program_pack(uuid, text) from public, anon;

-- The IRCC form versions a pack uses, from its form_mappings, each resolved against the official
-- page snapshot. A date is given only when a rule version in the pack cites that snapshot as
-- evidence; otherwise it is null (Unknown). Malformed entries are skipped, never guessed.
create function app.pack_form_pins(p_pack uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_map jsonb;
  v_entry jsonb;
  v_number text;
  v_snapshot uuid;
  v_snap public.source_snapshots%rowtype;
  v_cited boolean;
  v_out jsonb := '[]'::jsonb;
begin
  select pack.form_mappings into v_map from public.rule_pack_versions pack where pack.id = p_pack;
  if v_map is null or jsonb_typeof(v_map) <> 'array' then
    return v_out;
  end if;
  for v_entry in select value from jsonb_array_elements(v_map) loop
    continue when jsonb_typeof(v_entry) <> 'object';
    v_number := upper(regexp_replace(btrim(coalesce(v_entry ->> 'form_number', '')), '\s+', ' ', 'g'));
    continue when v_number !~ '^[A-Z]{2,6}[ -]?[0-9]{1,6}[A-Z]{0,3}( [A-Z]{1,3})?$';
    v_snapshot := null;
    if coalesce(v_entry ->> 'snapshot_id', '') ~ '^[0-9a-fA-F-]{36}$' then
      v_snapshot := (v_entry ->> 'snapshot_id')::uuid;
    end if;
    v_snap := null;
    v_cited := false;
    if v_snapshot is not null then
      select * into v_snap from public.source_snapshots s where s.id = v_snapshot;
      v_cited := v_snap.id is not null and exists (
        select 1
        from public.rule_pack_items i
        join public.rule_evidence e on e.rule_version_id = i.rule_version_id
        where i.pack_id = p_pack
          and e.snapshot_id = v_snap.id
      );
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'form_number', v_number,
      'date_modified', case when v_cited then v_snap.modified_on end,
      'source_url', case when v_cited then v_snap.final_url end,
      'retrieved_at', case when v_cited then v_snap.retrieved_at end,
      'content_hash', case when v_cited then v_snap.content_hash end,
      'snapshot_id', case when v_cited then v_snap.id end
    ));
  end loop;
  return v_out;
end;
$$;
revoke all on function app.pack_form_pins(uuid) from public, anon;

-- ---------------------------------------------------------------------------
-- 1. Form versions on the pin
-- ---------------------------------------------------------------------------
alter table public.matter_rule_bindings
  add column form_versions jsonb check (form_versions is null or jsonb_typeof(form_versions) = 'array');
comment on column public.matter_rule_bindings.form_versions is
  'SRC-05: the IRCC form numbers the pinned pack uses, each with the "date modified" its official page states (null when unknown), URL, retrieval time and SHA-256, taken when the pin was made. Never changes.';

-- ---------------------------------------------------------------------------
-- 5. Program scope recorded at matter creation
-- ---------------------------------------------------------------------------
create table public.matter_program_scopes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  matter_id uuid not null,
  program_key text not null check (program_key ~ '^[a-z0-9_]{1,80}$'),
  supported boolean not null,
  rule_pack_version_id uuid references public.rule_pack_versions (id),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  unique (matter_id),
  unique (id, organization_id),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id),
  check (supported = (rule_pack_version_id is not null))
);
comment on table public.matter_program_scopes is
  'SRC-12: the program a matter was opened for and whether Casevoya supported it then (an approved, sourced rule pack). An unsupported program inherits no other pack. Append-only.';

create index matter_program_scopes_org_idx on public.matter_program_scopes (organization_id);
create index matter_program_scopes_matter_org_idx on public.matter_program_scopes (matter_id, organization_id);
create index matter_program_scopes_pack_idx on public.matter_program_scopes (rule_pack_version_id);
create index matter_program_scopes_created_by_idx on public.matter_program_scopes (created_by);

create trigger matter_program_scopes_no_change before update or delete on public.matter_program_scopes
  for each row execute function app.gov_reject_mutation();
create trigger matter_program_scopes_no_truncate before truncate on public.matter_program_scopes
  for each statement execute function app.reject_governed_delete();

-- The binding guard added by SRC (runs after app.guard_matter_rule_binding: triggers fire by name).
-- Insert: takes the form versions from the pack, and refuses a pack of another program for a matter
-- opened for an unsupported program. Update: the form versions never change.
create function app.src_pin_binding()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scope public.matter_program_scopes%rowtype;
  v_program text;
begin
  if tg_op = 'INSERT' then
    select * into v_scope from public.matter_program_scopes s where s.matter_id = new.matter_id;
    if v_scope.id is not null and v_scope.supported is false then
      select pack.program_key into v_program from public.rule_pack_versions pack where pack.id = new.rule_pack_version_id;
      if v_program is distinct from v_scope.program_key then
        raise exception 'unsupported program: a matter opened for an unsupported program cannot inherit another program''s rule pack'
          using errcode = '42501';
      end if;
    end if;
    new.form_versions := app.pack_form_pins(new.rule_pack_version_id);
    return new;
  end if;
  if new.form_versions is distinct from old.form_versions then
    raise exception 'the pinned form versions are kept as they were' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.src_pin_binding() from public, anon;

create trigger matter_rule_bindings_pin_forms before insert or update on public.matter_rule_bindings
  for each row execute function app.src_pin_binding();

-- A rule-derived checklist item or deadline comes only from the pack pinned on its matter.
create function app.src_rule_from_pinned_pack()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.rule_version_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.rule_version_id is not distinct from old.rule_version_id then
    return new;
  end if;
  if not exists (
    select 1
    from public.matter_rule_bindings b
    join public.rule_pack_items i on i.pack_id = b.rule_pack_version_id
    where b.matter_id = new.matter_id
      and b.superseded_at is null
      and i.rule_version_id = new.rule_version_id
  ) then
    raise exception 'rules and checklist items come only from the rule pack pinned on this matter'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.src_rule_from_pinned_pack() from public, anon;

create trigger document_requests_src_pinned_rule before insert or update on public.document_requests
  for each row execute function app.src_rule_from_pinned_pack();
create trigger deadlines_src_pinned_rule before insert or update on public.deadlines
  for each row execute function app.src_rule_from_pinned_pack();

-- ---------------------------------------------------------------------------
-- 2. Packages record the versions used
-- ---------------------------------------------------------------------------
alter table public.matter_exports
  add column rule_binding_id uuid,
  add column rule_pack_version_id uuid references public.rule_pack_versions (id),
  add column form_versions jsonb check (form_versions is null or jsonb_typeof(form_versions) = 'array');
alter table public.matter_exports
  add constraint matter_exports_rule_binding_fk
    foreign key (rule_binding_id, organization_id) references public.matter_rule_bindings (id, organization_id);
create index matter_exports_rule_binding_idx on public.matter_exports (rule_binding_id, organization_id);
create index matter_exports_rule_pack_idx on public.matter_exports (rule_pack_version_id);
comment on column public.matter_exports.rule_pack_version_id is
  'SRC-05: the rule pack pinned on the matter when the export was requested (null: none). Never changes.';

alter table public.submission_handoffs
  add column rule_binding_id uuid,
  add column rule_pack_version_id uuid references public.rule_pack_versions (id),
  add column form_versions jsonb check (form_versions is null or jsonb_typeof(form_versions) = 'array');
alter table public.submission_handoffs
  add constraint submission_handoffs_rule_binding_fk
    foreign key (rule_binding_id, organization_id) references public.matter_rule_bindings (id, organization_id);
create index submission_handoffs_rule_binding_idx on public.submission_handoffs (rule_binding_id, organization_id);
create index submission_handoffs_rule_pack_idx on public.submission_handoffs (rule_pack_version_id);
comment on column public.submission_handoffs.rule_pack_version_id is
  'SRC-05: the rule pack pinned on the matter when the package was prepared, taken again when the consultant releases it (manifest pinned). Never changes after release.';

create function app.src_stamp_package_pin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT'
     or (
       tg_table_name = 'submission_handoffs'
       and to_jsonb(old) ->> 'manifest_pinned_at' is null
       and to_jsonb(new) ->> 'manifest_pinned_at' is not null
     ) then
    new.rule_binding_id := null;
    new.rule_pack_version_id := null;
    new.form_versions := null;
    select b.id, b.rule_pack_version_id, coalesce(b.form_versions, '[]'::jsonb)
      into new.rule_binding_id, new.rule_pack_version_id, new.form_versions
    from public.matter_rule_bindings b
    where b.matter_id = new.matter_id
      and b.superseded_at is null;
    return new;
  end if;
  if (new.rule_binding_id, new.rule_pack_version_id, new.form_versions)
     is distinct from (old.rule_binding_id, old.rule_pack_version_id, old.form_versions) then
    raise exception 'the rule pack and form versions a package used are kept' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.src_stamp_package_pin() from public, anon;

create trigger matter_exports_rule_pin before insert or update on public.matter_exports
  for each row execute function app.src_stamp_package_pin();
create trigger submission_handoffs_rule_pin before insert or update on public.submission_handoffs
  for each row execute function app.src_stamp_package_pin();

-- ---------------------------------------------------------------------------
-- 3. Upgrade preview and the audited decision
-- ---------------------------------------------------------------------------
create table public.matter_rule_upgrade_decisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  matter_id uuid not null,
  from_binding_id uuid not null,
  from_pack_id uuid not null references public.rule_pack_versions (id),
  to_pack_id uuid not null references public.rule_pack_versions (id),
  decision text not null check (decision in ('accepted', 'declined')),
  reason text not null check (length(btrim(reason)) between 3 and 500),
  impact jsonb not null check (jsonb_typeof(impact) = 'object'),
  new_binding_id uuid,
  decided_by uuid not null references auth.users (id),
  decided_membership_id uuid not null,
  decided_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id),
  foreign key (from_binding_id, organization_id) references public.matter_rule_bindings (id, organization_id),
  foreign key (new_binding_id, organization_id) references public.matter_rule_bindings (id, organization_id),
  foreign key (decided_membership_id, organization_id) references public.memberships (id, organization_id),
  check ((decision = 'accepted') = (new_binding_id is not null))
);
comment on table public.matter_rule_upgrade_decisions is
  'SRC-05: a licensed consultant''s or firm owner''s accept or decline of a newer approved rule pack for a matter, with the impact preview they saw. Append-only and audited.';

create index matter_rule_upgrade_decisions_org_idx on public.matter_rule_upgrade_decisions (organization_id);
create index matter_rule_upgrade_decisions_matter_idx on public.matter_rule_upgrade_decisions (matter_id, organization_id, decided_at desc);
create index matter_rule_upgrade_decisions_from_binding_idx on public.matter_rule_upgrade_decisions (from_binding_id, organization_id);
create index matter_rule_upgrade_decisions_new_binding_idx on public.matter_rule_upgrade_decisions (new_binding_id, organization_id);
create index matter_rule_upgrade_decisions_from_pack_idx on public.matter_rule_upgrade_decisions (from_pack_id);
create index matter_rule_upgrade_decisions_to_pack_idx on public.matter_rule_upgrade_decisions (to_pack_id);
create index matter_rule_upgrade_decisions_by_idx on public.matter_rule_upgrade_decisions (decided_by);
create index matter_rule_upgrade_decisions_member_idx on public.matter_rule_upgrade_decisions (decided_membership_id, organization_id);

create trigger matter_rule_upgrade_decisions_no_change before update or delete on public.matter_rule_upgrade_decisions
  for each row execute function app.gov_reject_mutation();
create trigger matter_rule_upgrade_decisions_no_truncate before truncate on public.matter_rule_upgrade_decisions
  for each statement execute function app.reject_governed_delete();

-- What a rule version is, for the preview: its output_value (or condition) "kind" when the pack's
-- author set one (checklist_item, field, deadline, form), else a rule.
create function app.src_rule_kind(p_version uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case lower(coalesce(v.output_value ->> 'kind', v.structured_condition ->> 'kind', ''))
    when 'checklist_item' then 'checklist_item'
    when 'document' then 'checklist_item'
    when 'field' then 'field'
    when 'deadline' then 'deadline'
    when 'form' then 'form'
    else 'rule'
  end
  from public.rule_versions v
  where v.id = p_version;
$$;
revoke all on function app.src_rule_kind(uuid) from public, anon;

-- The impact of moving a matter from its pinned binding to another pack: rules added, removed or
-- changed (by rule definition), the matter's own checklist items and deadlines that came from a
-- changed or removed rule, and form versions added, removed or with a new "date modified".
create function app.rule_pack_impact(p_matter_id uuid, p_binding_id uuid, p_to_pack uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_binding public.matter_rule_bindings%rowtype;
  v_rules jsonb;
  v_checklist jsonb;
  v_deadlines jsonb;
  v_forms jsonb;
begin
  select * into v_binding from public.matter_rule_bindings b where b.id = p_binding_id and b.matter_id = p_matter_id;
  if v_binding.id is null then
    raise exception 'rule binding not found' using errcode = 'P0002';
  end if;

  with old_items as (
    select v.definition_id, v.id as version_id
    from public.rule_pack_items i
    join public.rule_versions v on v.id = i.rule_version_id
    where i.pack_id = v_binding.rule_pack_version_id
  ),
  new_items as (
    select v.definition_id, v.id as version_id
    from public.rule_pack_items i
    join public.rule_versions v on v.id = i.rule_version_id
    where i.pack_id = p_to_pack
  ),
  paired as (
    select coalesce(o.definition_id, n.definition_id) as definition_id, o.version_id as from_version, n.version_id as to_version
    from old_items o
    full join new_items n on n.definition_id = o.definition_id
  ),
  changed as (
    select p.*,
      case when p.from_version is null then 'added' when p.to_version is null then 'removed' else 'changed' end as change
    from paired p
    where p.from_version is distinct from p.to_version
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'stable_key', d.stable_key,
      'kind', app.src_rule_kind(coalesce(c.to_version, c.from_version)),
      'change', c.change,
      'from_version', fv.version_number,
      'to_version', tv.version_number,
      'claim', left(coalesce(tv.claim, fv.claim, ''), 300)
    ) order by d.stable_key), '[]'::jsonb)
  into v_rules
  from changed c
  join public.rule_definitions d on d.id = c.definition_id
  left join public.rule_versions fv on fv.id = c.from_version
  left join public.rule_versions tv on tv.id = c.to_version;

  -- The matter's checklist items and deadlines that came from a rule version the move changes or removes.
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'label', r.purpose, 'status', r.status) order by r.created_at), '[]'::jsonb)
  into v_checklist
  from public.document_requests r
  join public.rule_versions v on v.id = r.rule_version_id
  where r.matter_id = p_matter_id
    and r.rule_version_id is not null
    and not exists (
      select 1 from public.rule_pack_items i where i.pack_id = p_to_pack and i.rule_version_id = r.rule_version_id
    );

  select coalesce(jsonb_agg(jsonb_build_object('id', dl.id, 'label', dl.label, 'due_on', dl.due_on) order by dl.due_on nulls last), '[]'::jsonb)
  into v_deadlines
  from public.deadlines dl
  where dl.matter_id = p_matter_id
    and dl.rule_version_id is not null
    and not exists (
      select 1 from public.rule_pack_items i where i.pack_id = p_to_pack and i.rule_version_id = dl.rule_version_id
    );

  with old_forms as (
    select f ->> 'form_number' as form_number, f ->> 'date_modified' as date_modified
    from jsonb_array_elements(coalesce(v_binding.form_versions, '[]'::jsonb)) f
  ),
  new_forms as (
    select f ->> 'form_number' as form_number, f ->> 'date_modified' as date_modified
    from jsonb_array_elements(app.pack_form_pins(p_to_pack)) f
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'form_number', coalesce(n.form_number, o.form_number),
      'change', case when o.form_number is null then 'added' when n.form_number is null then 'removed' else 'changed' end,
      'from_modified', o.date_modified,
      'to_modified', n.date_modified
    ) order by coalesce(n.form_number, o.form_number)), '[]'::jsonb)
  into v_forms
  from old_forms o
  full join new_forms n on n.form_number = o.form_number
  where o.form_number is null or n.form_number is null or o.date_modified is distinct from n.date_modified;

  return jsonb_build_object(
    'rules', v_rules,
    'matter_checklist', v_checklist,
    'matter_deadlines', v_deadlines,
    'forms', v_forms
  );
end;
$$;
revoke all on function app.rule_pack_impact(uuid, uuid, uuid) from public, anon;

-- The newer approved pack for a binding: same program and jurisdiction, a higher version, one the
-- firm may select, sourced. Null when there is none.
create function app.newer_rule_pack(p_binding_id uuid)
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
    and nxt.status in ('published', 'review_due')
    and app.pack_is_selectable(nxt.id, b.organization_id)
    and app.pack_is_sourced(nxt.id)
  order by nxt.pack_version desc, nxt.organization_id nulls last
  limit 1;
$$;
revoke all on function app.newer_rule_pack(uuid) from public, anon;

-- What the matter overview shows: the pin (pack, forms, recheck flag), a newer approved version with
-- its impact preview, the last decision on it, and the program scope the matter was opened with.
create function app.matter_rule_state(p_matter_id uuid)
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

create function app.decide_matter_rule_upgrade(
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
  if v_next.status not in ('published', 'review_due')
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
-- 4. Support catalogue (platform configuration)
-- ---------------------------------------------------------------------------
create table public.support_catalogue_entries (
  id uuid primary key default gen_random_uuid(),
  scope_kind text not null check (scope_kind in ('jurisdiction', 'program', 'case_type')),
  scope_key text not null,
  label text not null check (length(btrim(label)) between 1 and 200),
  jurisdiction text check (jurisdiction is null or jurisdiction ~ '^[A-Z]{2}(-[A-Z0-9]{1,6})?$'),
  case_type_key text check (case_type_key is null or case_type_key ~ '^[a-z0-9_]{1,80}$'),
  official_name text check (official_name is null or length(btrim(official_name)) between 1 and 300),
  snapshot_id uuid references public.source_snapshots (id),
  source_section text check (source_section is null or length(btrim(source_section)) between 1 and 300),
  note text check (note is null or length(note) <= 500),
  position integer not null default 100 check (position between 0 and 10000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  updated_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (scope_kind, scope_key),
  check (scope_kind <> 'jurisdiction' or scope_key ~ '^[A-Z]{2}(-[A-Z0-9]{1,6})?$'),
  check (scope_kind = 'jurisdiction' or scope_key ~ '^[a-z0-9_]{1,80}$'),
  check (scope_kind = 'program' or (official_name is null and snapshot_id is null and case_type_key is null and source_section is null)),
  check (scope_kind <> 'program' or jurisdiction is not null),
  check (official_name is null or snapshot_id is not null)
);
comment on table public.support_catalogue_entries is
  'SRC-12: what Casevoya covers, as configuration. Jurisdictions, case types and programs. Support is never stored here: public.support_catalogue derives it from approved, sourced rule packs. A program''s official name needs the snapshot of its official page.';

create index support_catalogue_entries_snapshot_idx on public.support_catalogue_entries (snapshot_id);
create index support_catalogue_entries_created_by_idx on public.support_catalogue_entries (created_by);
create index support_catalogue_entries_updated_by_idx on public.support_catalogue_entries (updated_by);

create trigger support_catalogue_entries_touch before update on public.support_catalogue_entries
  for each row execute function app.touch_row();
create trigger support_catalogue_entries_no_delete before delete on public.support_catalogue_entries
  for each row execute function app.reject_governed_delete();
create trigger support_catalogue_entries_no_truncate before truncate on public.support_catalogue_entries
  for each statement execute function app.reject_governed_delete();

-- Scope configuration, not immigration content: where Casevoya could hold a program pack, and the
-- kinds of case work. Each is "not supported" until an approved, sourced pack exists under it.
insert into public.support_catalogue_entries (scope_kind, scope_key, label, note, position) values
  ('jurisdiction', 'CA', 'Canada (federal immigration)', 'Programs run by Immigration, Refugees and Citizenship Canada.', 1),
  ('jurisdiction', 'CA-AB', 'Alberta', 'Provincial programs.', 10),
  ('jurisdiction', 'CA-BC', 'British Columbia', 'Provincial programs.', 11),
  ('jurisdiction', 'CA-MB', 'Manitoba', 'Provincial programs.', 12),
  ('jurisdiction', 'CA-NB', 'New Brunswick', 'Provincial programs.', 13),
  ('jurisdiction', 'CA-NL', 'Newfoundland and Labrador', 'Provincial programs.', 14),
  ('jurisdiction', 'CA-NS', 'Nova Scotia', 'Provincial programs.', 15),
  ('jurisdiction', 'CA-NT', 'Northwest Territories', 'Territorial programs.', 16),
  ('jurisdiction', 'CA-NU', 'Nunavut', 'Territorial programs.', 17),
  ('jurisdiction', 'CA-ON', 'Ontario', 'Provincial programs.', 18),
  ('jurisdiction', 'CA-PE', 'Prince Edward Island', 'Provincial programs.', 19),
  ('jurisdiction', 'CA-QC', 'Quebec', 'Provincial programs.', 20),
  ('jurisdiction', 'CA-SK', 'Saskatchewan', 'Provincial programs.', 21),
  ('jurisdiction', 'CA-YT', 'Yukon', 'Territorial programs.', 22),
  ('case_type', 'ircc_application', 'Applications to IRCC', 'Applications a firm prepares and the client or firm submits outside Casevoya.', 1),
  ('case_type', 'irb_proceeding', 'Immigration and Refugee Board proceedings', 'Hearings and appeals before the tribunal.', 2),
  ('case_type', 'federal_court', 'Federal Court judicial review', 'Applications for leave and judicial review.', 3);

create function app.save_support_catalogue_entry(
  p_scope_kind text,
  p_scope_key text,
  p_label text,
  p_jurisdiction text,
  p_case_type_key text,
  p_snapshot_id uuid,
  p_official_name text,
  p_source_section text,
  p_note text,
  p_position integer,
  p_active boolean,
  p_acting_admin uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- The platform operations actor (ADM-04): a signed-in platform admin, or the service role naming one.
  v_actor uuid := app.platform_ops_actor(p_acting_admin);
  v_snap public.source_snapshots%rowtype;
  v_id uuid;
  v_name text := nullif(btrim(coalesce(p_official_name, '')), '');
begin
  -- Signed in, the catalogue also needs a recent step-up.
  if (select auth.uid()) is not null and app.mfa_step_up_satisfied() is distinct from true then
    raise exception 'the support catalogue requires a platform admin step-up' using errcode = '42501';
  end if;
  if p_scope_kind is null or p_scope_kind not in ('jurisdiction', 'program', 'case_type') then
    raise exception 'scope kind is jurisdiction, program or case_type' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_label, ''))) not between 1 and 200 then
    raise exception 'the label is 1 to 200 characters' using errcode = '22023';
  end if;
  if p_snapshot_id is not null then
    if p_scope_kind <> 'program' then
      raise exception 'only a program links to an official page' using errcode = '22023';
    end if;
    select * into v_snap from public.source_snapshots s where s.id = p_snapshot_id;
    if v_snap.id is null or v_snap.organization_id is not null then
      raise exception 'the program page snapshot must be a platform snapshot' using errcode = '22023';
    end if;
    if app.src_deep_official_url(v_snap.final_url) is distinct from true then
      raise exception 'the program page must be an official deep link, not a homepage' using errcode = '23514';
    end if;
  end if;
  if v_name is not null and p_snapshot_id is null then
    raise exception 'an official program name needs the snapshot of its official page' using errcode = '22023';
  end if;

  insert into public.support_catalogue_entries as e (
    scope_kind, scope_key, label, jurisdiction, case_type_key, official_name, snapshot_id, source_section,
    note, position, active, created_by, updated_by
  ) values (
    p_scope_kind, btrim(coalesce(p_scope_key, '')), btrim(p_label), p_jurisdiction, p_case_type_key, v_name, p_snapshot_id,
    nullif(btrim(coalesce(p_source_section, '')), ''), nullif(btrim(coalesce(p_note, '')), ''), coalesce(p_position, 100),
    coalesce(p_active, true), v_actor, v_actor
  )
  on conflict (scope_kind, scope_key) do update set
    label = excluded.label,
    jurisdiction = excluded.jurisdiction,
    case_type_key = excluded.case_type_key,
    official_name = excluded.official_name,
    snapshot_id = excluded.snapshot_id,
    source_section = excluded.source_section,
    note = excluded.note,
    position = excluded.position,
    active = excluded.active,
    updated_by = excluded.updated_by
  returning e.id into v_id;

  perform app.record_audit_event(
    null,
    'support_catalogue.saved',
    'public.support_catalogue_entries',
    v_id,
    'success',
    jsonb_build_object(
      'acting_admin', v_actor,
      'scope_kind', p_scope_kind,
      'scope_key', p_scope_key,
      'snapshot_id', p_snapshot_id,
      'snapshot_sha256', v_snap.content_hash,
      'active', coalesce(p_active, true)
    )
  );
  return v_id;
end;
$$;
revoke all on function app.save_support_catalogue_entry(text, text, text, text, text, uuid, text, text, text, integer, boolean, uuid) from public, anon;

-- The catalogue as anyone may read it (the public page), or as a firm's staff read it (their own
-- approved packs count too, and their firm's jurisdictions are listed). Support is derived, never stored.
create function app.support_catalogue(p_org uuid)
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
    where pack.status in ('published', 'review_due')
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

-- ---------------------------------------------------------------------------
-- 5. Opening a matter for a program
-- ---------------------------------------------------------------------------

-- The pack a new matter for this program pins: the program's current approved pack for the firm, or
-- null when the program is catalogued but not supported. An unknown program is refused.
create function app.program_pack_for_new_matter(p_program_key text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := app.current_organization_id();
  v_pack uuid;
begin
  if v_org is null or app.is_org_staff(v_org) is distinct from true then
    raise exception 'matter create denied' using errcode = '42501';
  end if;
  if p_program_key is null or p_program_key !~ '^[a-z0-9_]{1,80}$' then
    raise exception 'choose a program from the support catalogue' using errcode = '22023';
  end if;
  v_pack := app.current_program_pack(v_org, p_program_key);
  if v_pack is null and not exists (
    select 1 from public.support_catalogue_entries e
    where e.scope_kind = 'program' and e.scope_key = p_program_key and e.active
  ) then
    raise exception 'choose a program from the support catalogue' using errcode = '22023';
  end if;
  return v_pack;
end;
$$;
revoke all on function app.program_pack_for_new_matter(text) from public, anon;
grant execute on function app.program_pack_for_new_matter(text) to authenticated, service_role;

-- Records the program a matter was opened for. Only for a matter created in this same transaction
-- (public.create_client_matter_for_program), so it can't relabel an existing matter.
create function app.record_matter_program_scope(p_matter_id uuid, p_program_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_matter public.matters%rowtype;
  v_pack public.rule_pack_versions%rowtype;
  v_supported boolean;
begin
  select * into v_matter from public.matters m where m.id = p_matter_id;
  if v_matter.id is null
     or v_matter.organization_id is distinct from app.current_organization_id()
     or app.is_org_staff(v_matter.organization_id) is distinct from true
     or v_matter.created_at is distinct from now() then
    raise exception 'program scope is recorded only when the matter is opened' using errcode = '42501';
  end if;
  if p_program_key is null or p_program_key !~ '^[a-z0-9_]{1,80}$' then
    raise exception 'choose a program from the support catalogue' using errcode = '22023';
  end if;
  select pack.* into v_pack
  from public.matter_rule_bindings b
  join public.rule_pack_versions pack on pack.id = b.rule_pack_version_id
  where b.matter_id = v_matter.id and b.superseded_at is null;
  if v_pack.id is not null and v_pack.program_key is distinct from p_program_key then
    raise exception 'unsupported program: the pinned pack is for another program' using errcode = '42501';
  end if;
  v_supported := v_pack.id is not null;
  insert into public.matter_program_scopes (organization_id, matter_id, program_key, supported, rule_pack_version_id, created_by)
  values (v_matter.organization_id, v_matter.id, p_program_key, v_supported, v_pack.id, (select auth.uid()));
  perform app.record_audit_event(
    v_matter.organization_id,
    case when v_supported then 'matter.program_scope_supported' else 'matter.program_scope_unsupported' end,
    'public.matters',
    v_matter.id,
    'success',
    jsonb_build_object('matter_id', v_matter.id, 'program_key', p_program_key, 'rule_pack_version_id', v_pack.id)
  );
end;
$$;
revoke all on function app.record_matter_program_scope(uuid, text) from public, anon;
grant execute on function app.record_matter_program_scope(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Public wrappers
-- ---------------------------------------------------------------------------
create function public.create_client_matter_for_program(
  p_applicant_name text,
  p_applicant_email text,
  p_sponsor_name text,
  p_sponsor_email text,
  p_consultant_membership_id uuid,
  p_program_key text,
  p_applicant_date_of_birth date default null,
  p_sponsor_date_of_birth date default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_pack uuid;
  v_created jsonb;
begin
  if app.current_organization_id() is null then
    raise exception 'matter create denied' using errcode = '42501';
  end if;
  v_pack := app.program_pack_for_new_matter(p_program_key);
  v_created := public.create_client_matter(
    p_applicant_name, p_applicant_email, p_sponsor_name, p_sponsor_email,
    p_consultant_membership_id, v_pack, null, p_applicant_date_of_birth, p_sponsor_date_of_birth
  );
  if (v_created ->> 'ok')::boolean is distinct from true then
    return v_created;
  end if;
  perform app.record_matter_program_scope((v_created ->> 'id')::uuid, p_program_key);
  return v_created || jsonb_build_object('program_key', p_program_key, 'supported', v_pack is not null, 'rule_pack_version_id', v_pack);
end;
$$;
comment on function public.create_client_matter_for_program(text, text, text, text, uuid, text, date, date) is
  'SRC-12: public.create_client_matter for a program from the support catalogue. Pins the program''s current approved, sourced rule pack; when there is none the matter opens with no pack, no checklist and no rules, and is recorded as an unsupported program. Invoker.';

create function public.matter_rule_state(p_matter_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select app.matter_rule_state(p_matter_id);
$$;

create function public.decide_matter_rule_upgrade(
  p_matter_id uuid,
  p_to_pack_id uuid,
  p_expected_version integer,
  p_decision text,
  p_reason text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app.decide_matter_rule_upgrade(p_matter_id, p_to_pack_id, p_expected_version, p_decision, p_reason);
$$;

-- Security definer: the public page reads it signed out (anon has no use of schema app).
create function public.support_catalogue(p_org uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select app.support_catalogue(p_org);
$$;

create function public.save_support_catalogue_entry(
  p_scope_kind text,
  p_scope_key text,
  p_label text,
  p_jurisdiction text default null,
  p_case_type_key text default null,
  p_snapshot_id uuid default null,
  p_official_name text default null,
  p_source_section text default null,
  p_note text default null,
  p_position integer default null,
  p_active boolean default true,
  p_acting_admin uuid default null
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select app.save_support_catalogue_entry(
    p_scope_kind, p_scope_key, p_label, p_jurisdiction, p_case_type_key, p_snapshot_id, p_official_name,
    p_source_section, p_note, p_position, p_active, p_acting_admin
  );
$$;

grant execute on function app.matter_rule_state(uuid) to authenticated, service_role;
grant execute on function app.decide_matter_rule_upgrade(uuid, uuid, integer, text, text) to authenticated, service_role;
grant execute on function app.support_catalogue(uuid) to anon, authenticated, service_role;
grant execute on function app.save_support_catalogue_entry(text, text, text, text, text, uuid, text, text, text, integer, boolean, uuid)
  to authenticated, service_role;

revoke all on function public.create_client_matter_for_program(text, text, text, text, uuid, text, date, date) from public, anon;
grant execute on function public.create_client_matter_for_program(text, text, text, text, uuid, text, date, date) to authenticated, service_role;
revoke all on function public.matter_rule_state(uuid) from public, anon;
grant execute on function public.matter_rule_state(uuid) to authenticated, service_role;
revoke all on function public.decide_matter_rule_upgrade(uuid, uuid, integer, text, text) from public, anon;
grant execute on function public.decide_matter_rule_upgrade(uuid, uuid, integer, text, text) to authenticated, service_role;
revoke all on function public.support_catalogue(uuid) from public;
grant execute on function public.support_catalogue(uuid) to anon, authenticated, service_role;
revoke all on function public.save_support_catalogue_entry(text, text, text, text, text, uuid, text, text, text, integer, boolean, uuid) from public, anon;
grant execute on function public.save_support_catalogue_entry(text, text, text, text, text, uuid, text, text, text, integer, boolean, uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Privileges and row-level security
-- ---------------------------------------------------------------------------
revoke all on table public.matter_program_scopes from public, anon, authenticated, service_role;
revoke all on table public.matter_rule_upgrade_decisions from public, anon, authenticated, service_role;
revoke all on table public.support_catalogue_entries from public, anon, authenticated, service_role;
grant select on table public.matter_program_scopes to authenticated, service_role;
grant select on table public.matter_rule_upgrade_decisions to authenticated, service_role;
grant select on table public.support_catalogue_entries to authenticated, service_role;

alter table public.matter_program_scopes enable row level security;
alter table public.matter_program_scopes force row level security;
alter table public.matter_rule_upgrade_decisions enable row level security;
alter table public.matter_rule_upgrade_decisions force row level security;
alter table public.support_catalogue_entries enable row level security;
alter table public.support_catalogue_entries force row level security;

create policy matter_program_scopes_select on public.matter_program_scopes
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.is_org_staff(organization_id))
    and (select app.staff_mfa_satisfied())
    and app.can_read_matter(matter_id)
  );
create policy matter_program_scopes_service on public.matter_program_scopes
  for select to service_role using (true);

create policy matter_rule_upgrade_decisions_select on public.matter_rule_upgrade_decisions
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.is_org_staff(organization_id))
    and (select app.staff_mfa_satisfied())
    and app.can_read_matter(matter_id)
  );
create policy matter_rule_upgrade_decisions_service on public.matter_rule_upgrade_decisions
  for select to service_role using (true);

-- Platform admins read the configuration rows directly; everyone else reads public.support_catalogue.
create policy support_catalogue_entries_admin on public.support_catalogue_entries
  for select to authenticated
  using ((select app.is_platform_admin()));
create policy support_catalogue_entries_service on public.support_catalogue_entries
  for select to service_role using (true);
