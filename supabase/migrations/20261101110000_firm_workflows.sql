-- Firm workflows (2026-10-30, Francis): how a firm builds its own workflow.
--
-- Casevoya publishes shared program templates (ADM-03, read only for firms). A firm owner or a
-- licensed consultant can start a new workflow, or make the firm's own copy of a published
-- shared template, and then edit that copy: its name, program, stages, the steps and the
-- documents to request in each stage, and their order. A copy never changes the shared
-- template; a later shared release does not change the copy. Additive only.
--
-- New tables (RLS forced; staff of the firm read; writes only through the functions below):
--   public.firm_workflows        one firm workflow: name, optional program key, description,
--                                where it was copied from (shared template version), active or
--                                archived, row version for optimistic saves.
--   public.firm_workflow_stages  the ordered stages of a workflow.
--   public.firm_workflow_items   the ordered steps and document requests of a stage: title,
--                                optional detail, who does it (firm or client), optional days.
-- New functions (security definer, firm owner or licensed consultant, aal2):
--   public.save_firm_workflow(uuid, integer, text, text, text, jsonb)  create, or replace the
--                                content of one active workflow (expected row version). Audited.
--   public.copy_shared_template_to_workflow(uuid)  the firm's editable copy of a published
--                                shared template version. Audited.
--   public.set_firm_workflow_archived(uuid, integer, boolean)  archive or restore. Audited.

create table public.firm_workflows (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  name text not null check (length(btrim(name)) between 1 and 160),
  program_key text check (program_key is null or program_key ~ '^[a-z0-9_]{1,80}$'),
  description text check (description is null or length(description) <= 2000),
  status text not null default 'active' check (status in ('active', 'archived')),
  source_template_id uuid references public.shared_templates (id),
  source_version_id uuid references public.shared_template_versions (id),
  archived_at timestamptz,
  created_by uuid references auth.users (id),
  updated_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id),
  check ((status = 'archived') = (archived_at is not null)),
  check ((source_template_id is null) = (source_version_id is null))
);
comment on table public.firm_workflows is
  'A firm''s own workflow (2026-10-30): stages with steps and document requests, new or copied from a published shared template. Written only by save_firm_workflow, copy_shared_template_to_workflow and set_firm_workflow_archived.';

create index firm_workflows_org_idx on public.firm_workflows (organization_id, status, updated_at desc);
create index firm_workflows_source_template_idx on public.firm_workflows (source_template_id);
create index firm_workflows_source_version_idx on public.firm_workflows (source_version_id);
create index firm_workflows_created_by_idx on public.firm_workflows (created_by);
create index firm_workflows_updated_by_idx on public.firm_workflows (updated_by);

create table public.firm_workflow_stages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  workflow_id uuid not null,
  position integer not null check (position >= 0),
  name text not null check (length(btrim(name)) between 1 and 120),
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (workflow_id, position),
  foreign key (workflow_id, organization_id) references public.firm_workflows (id, organization_id)
);
comment on table public.firm_workflow_stages is 'One stage of a firm workflow, in order.';

create index firm_workflow_stages_wf_org_fk_idx on public.firm_workflow_stages (workflow_id, organization_id);
create index firm_workflow_stages_org_idx on public.firm_workflow_stages (organization_id);

create table public.firm_workflow_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  workflow_id uuid not null,
  stage_id uuid not null,
  position integer not null check (position >= 0),
  kind text not null check (kind in ('step', 'document')),
  title text not null check (length(btrim(title)) between 1 and 200),
  detail text check (detail is null or length(detail) <= 2000),
  owner text not null default 'staff' check (owner in ('staff', 'client')),
  due_offset_days integer check (due_offset_days is null or due_offset_days between 0 and 365),
  created_at timestamptz not null default now(),
  unique (stage_id, position),
  foreign key (stage_id, organization_id) references public.firm_workflow_stages (id, organization_id),
  foreign key (workflow_id, organization_id) references public.firm_workflows (id, organization_id)
);
comment on table public.firm_workflow_items is 'One step or document request in a stage of a firm workflow, in order.';

create index firm_workflow_items_stage_org_fk_idx on public.firm_workflow_items (stage_id, organization_id);
create index firm_workflow_items_wf_org_fk_idx on public.firm_workflow_items (workflow_id, organization_id);
create index firm_workflow_items_org_idx on public.firm_workflow_items (organization_id);

alter table public.firm_workflows enable row level security;
alter table public.firm_workflows force row level security;
alter table public.firm_workflow_stages enable row level security;
alter table public.firm_workflow_stages force row level security;
alter table public.firm_workflow_items enable row level security;
alter table public.firm_workflow_items force row level security;

revoke all on table public.firm_workflows from anon, authenticated;
revoke all on table public.firm_workflow_stages from anon, authenticated;
revoke all on table public.firm_workflow_items from anon, authenticated;
grant select on table public.firm_workflows to authenticated;
grant select on table public.firm_workflow_stages to authenticated;
grant select on table public.firm_workflow_items to authenticated;
grant select, insert, update on table public.firm_workflows to service_role;
grant select, insert, update on table public.firm_workflow_stages to service_role;
grant select, insert, update on table public.firm_workflow_items to service_role;

-- Staff of the firm read its workflows. Clients never see them.
create policy firm_workflows_select on public.firm_workflows
  for select to authenticated
  using ((select app.staff_mfa_satisfied()) and (select app.is_org_staff(organization_id)));
create policy firm_workflow_stages_select on public.firm_workflow_stages
  for select to authenticated
  using ((select app.staff_mfa_satisfied()) and (select app.is_org_staff(organization_id)));
create policy firm_workflow_items_select on public.firm_workflow_items
  for select to authenticated
  using ((select app.staff_mfa_satisfied()) and (select app.is_org_staff(organization_id)));

create trigger firm_workflows_touch before update on public.firm_workflows
  for each row execute function app.touch_row();
create trigger firm_workflows_audit after insert or update on public.firm_workflows
  for each row execute function app.audit_row_change();
create trigger firm_workflows_no_delete before delete on public.firm_workflows
  for each row execute function app.reject_governed_delete();
create trigger firm_workflows_no_truncate before truncate on public.firm_workflows
  for each statement execute function app.reject_governed_delete();

-- Who may write a firm workflow: an active firm owner or licensed consultant of the current firm.
create function app.firm_workflow_editor()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid := app.current_organization_id();
begin
  if org is null then
    raise exception 'workflow denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(org, array['firm_owner', 'licensed_consultant']::public.org_role[], false);
  return org;
end;
$$;
revoke all on function app.firm_workflow_editor() from public;

-- Writes the stages and items of one workflow from a JSON list (replacing what was there).
-- [{ "name": text, "items": [{ "kind": "step"|"document", "title": text, "detail": text?,
--    "owner": "staff"|"client", "due_offset_days": int? }] }]
create function app.write_firm_workflow_stages(p_org uuid, p_workflow_id uuid, p_stages jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  stage jsonb;
  item jsonb;
  stage_row uuid;
  s integer := 0;
  i integer;
  total integer := 0;
  v_kind text;
  v_owner text;
  v_title text;
  v_detail text;
  v_days text;
begin
  if p_stages is null or jsonb_typeof(p_stages) is distinct from 'array' or jsonb_array_length(p_stages) not between 1 and 30 then
    raise exception 'a workflow needs 1 to 30 stages' using errcode = '22023';
  end if;
  delete from public.firm_workflow_items where workflow_id = p_workflow_id and organization_id = p_org;
  delete from public.firm_workflow_stages where workflow_id = p_workflow_id and organization_id = p_org;
  for stage in select value from jsonb_array_elements(p_stages) loop
    if jsonb_typeof(stage) is distinct from 'object' or length(btrim(coalesce(stage ->> 'name', ''))) not between 1 and 120 then
      raise exception 'stage % needs a name of up to 120 characters', s + 1 using errcode = '22023';
    end if;
    if stage ? 'items' and jsonb_typeof(stage -> 'items') is distinct from 'array' then
      raise exception 'the steps of stage % are a list', s + 1 using errcode = '22023';
    end if;
    insert into public.firm_workflow_stages (organization_id, workflow_id, position, name)
    values (p_org, p_workflow_id, s, btrim(stage ->> 'name'))
    returning id into stage_row;
    i := 0;
    for item in select value from jsonb_array_elements(coalesce(stage -> 'items', '[]'::jsonb)) loop
      if jsonb_typeof(item) is distinct from 'object' then
        raise exception 'stage %, item % is not usable', s + 1, i + 1 using errcode = '22023';
      end if;
      v_kind := coalesce(nullif(item ->> 'kind', ''), 'step');
      v_owner := coalesce(nullif(item ->> 'owner', ''), 'staff');
      v_title := btrim(coalesce(item ->> 'title', ''));
      v_detail := nullif(btrim(coalesce(item ->> 'detail', '')), '');
      v_days := nullif(btrim(coalesce(item ->> 'due_offset_days', '')), '');
      if v_kind not in ('step', 'document') then
        raise exception 'stage %, item %: choose a step or a document', s + 1, i + 1 using errcode = '22023';
      end if;
      if v_owner not in ('staff', 'client') then
        raise exception 'stage %, item %: done by the firm or the client', s + 1, i + 1 using errcode = '22023';
      end if;
      if length(v_title) not between 1 and 200 then
        raise exception 'stage %, item % needs a title of up to 200 characters', s + 1, i + 1 using errcode = '22023';
      end if;
      if v_detail is not null and length(v_detail) > 2000 then
        raise exception 'stage %, item %: the detail is longer than 2000 characters', s + 1, i + 1 using errcode = '22023';
      end if;
      if v_days is not null and (v_days !~ '^\d{1,3}$' or v_days::integer > 365) then
        raise exception 'stage %, item %: days are 0 to 365', s + 1, i + 1 using errcode = '22023';
      end if;
      insert into public.firm_workflow_items (organization_id, workflow_id, stage_id, position, kind, title, detail, owner, due_offset_days)
      values (p_org, p_workflow_id, stage_row, i, v_kind, v_title, v_detail, v_owner, v_days::integer);
      i := i + 1;
      total := total + 1;
      if i > 80 then
        raise exception 'stage % has more than 80 items', s + 1 using errcode = '22023';
      end if;
    end loop;
    s := s + 1;
  end loop;
  if total > 400 then
    raise exception 'a workflow has at most 400 items' using errcode = '22023';
  end if;
  return jsonb_build_object('stages', s, 'items', total);
end;
$$;
revoke all on function app.write_firm_workflow_stages(uuid, uuid, jsonb) from public;

create function public.save_firm_workflow(
  p_workflow_id uuid,
  p_expected_version integer,
  p_name text,
  p_program_key text,
  p_description text,
  p_stages jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid := app.firm_workflow_editor();
  wf public.firm_workflows%rowtype;
  v_name text := btrim(coalesce(p_name, ''));
  v_program text := nullif(btrim(coalesce(p_program_key, '')), '');
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
  counts jsonb;
  created boolean := p_workflow_id is null;
begin
  if length(v_name) not between 1 and 160 then
    raise exception 'give the workflow a name of up to 160 characters' using errcode = '22023';
  end if;
  if v_program is not null and v_program !~ '^[a-z0-9_]{1,80}$' then
    raise exception 'that program is not usable' using errcode = '22023';
  end if;
  if v_description is not null and length(v_description) > 2000 then
    raise exception 'the description is longer than 2000 characters' using errcode = '22023';
  end if;
  if created then
    insert into public.firm_workflows (organization_id, name, program_key, description, created_by, updated_by)
    values (org, v_name, v_program, v_description, (select auth.uid()), (select auth.uid()))
    returning * into wf;
  else
    select * into wf from public.firm_workflows where id = p_workflow_id for update;
    if wf.id is null or wf.organization_id is distinct from org then
      raise exception 'workflow denied' using errcode = '42501';
    end if;
    if wf.status = 'archived' then
      raise exception 'restore the workflow before editing it' using errcode = '22023';
    end if;
    if p_expected_version is null or wf.version is distinct from p_expected_version then
      raise exception 'someone else changed this workflow; reload to see their version' using errcode = '40001';
    end if;
    update public.firm_workflows
    set name = v_name, program_key = v_program, description = v_description, updated_by = (select auth.uid())
    where id = wf.id
    returning * into wf;
  end if;
  counts := app.write_firm_workflow_stages(org, wf.id, p_stages);
  perform app.record_audit_event(org, case when created then 'workflow.created' else 'workflow.saved' end, 'public.firm_workflows', wf.id, 'success',
    jsonb_build_object('name', wf.name, 'program_key', wf.program_key, 'version', wf.version) || counts);
  return jsonb_build_object('id', wf.id, 'version', wf.version);
end;
$$;
comment on function public.save_firm_workflow(uuid, integer, text, text, text, jsonb) is
  'Firm workflows: a firm owner or licensed consultant creates a workflow (id null) or replaces the name, program, description, stages and items of an active one at the expected row version. Audited.';
revoke all on function public.save_firm_workflow(uuid, integer, text, text, text, jsonb) from public, anon;
grant execute on function public.save_firm_workflow(uuid, integer, text, text, text, jsonb) to authenticated;

create function public.copy_shared_template_to_workflow(p_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid := app.firm_workflow_editor();
  src public.shared_template_versions%rowtype;
  tpl public.shared_templates%rowtype;
  wf public.firm_workflows%rowtype;
  steps jsonb := '[]'::jsonb;
  line text;
  counts jsonb;
begin
  select * into src from public.shared_template_versions where id = p_version_id;
  -- Firms see published versions (and earlier published ones); drafts and rejections are not theirs.
  if src.id is null or src.status not in ('published', 'superseded') then
    raise exception 'that shared template version is not published' using errcode = '42501';
  end if;
  select * into tpl from public.shared_templates where id = src.template_id;
  for line in select value from jsonb_array_elements_text(coalesce(src.body -> 'items', '[]'::jsonb)) loop
    if length(btrim(line)) between 1 and 200 then
      steps := steps || jsonb_build_array(jsonb_build_object('kind', 'step', 'title', btrim(line), 'owner', 'staff'));
    end if;
  end loop;
  insert into public.firm_workflows (organization_id, name, description, source_template_id, source_version_id, created_by, updated_by)
  values (
    org,
    left(coalesce(nullif(btrim(src.body ->> 'title'), ''), tpl.title), 160),
    nullif(left(btrim(coalesce(src.body ->> 'summary', '')), 2000), ''),
    src.template_id,
    src.id,
    (select auth.uid()),
    (select auth.uid())
  )
  returning * into wf;
  -- The shared template's items become the steps of one stage; the firm renames, splits and
  -- reorders them in its copy.
  counts := app.write_firm_workflow_stages(org, wf.id, jsonb_build_array(jsonb_build_object('name', 'Steps', 'items', steps)));
  perform app.record_audit_event(org, 'workflow.copied', 'public.firm_workflows', wf.id, 'success',
    jsonb_build_object('name', wf.name, 'shared_template_id', src.template_id, 'shared_version_id', src.id, 'shared_version_number', src.version_number) || counts);
  return jsonb_build_object('id', wf.id, 'version', wf.version);
end;
$$;
comment on function public.copy_shared_template_to_workflow(uuid) is
  'Firm workflows: a firm owner or licensed consultant makes the firm''s own editable copy of a published shared template version. The shared template is not changed. Audited.';
revoke all on function public.copy_shared_template_to_workflow(uuid) from public, anon;
grant execute on function public.copy_shared_template_to_workflow(uuid) to authenticated;

create function public.set_firm_workflow_archived(p_workflow_id uuid, p_expected_version integer, p_archived boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid := app.firm_workflow_editor();
  wf public.firm_workflows%rowtype;
begin
  select * into wf from public.firm_workflows where id = p_workflow_id for update;
  if wf.id is null or wf.organization_id is distinct from org then
    raise exception 'workflow denied' using errcode = '42501';
  end if;
  if p_expected_version is null or wf.version is distinct from p_expected_version then
    raise exception 'someone else changed this workflow; reload to see their version' using errcode = '40001';
  end if;
  if (wf.status = 'archived') = coalesce(p_archived, false) then
    return jsonb_build_object('id', wf.id, 'version', wf.version);
  end if;
  update public.firm_workflows
  set status = case when p_archived then 'archived' else 'active' end,
      archived_at = case when p_archived then statement_timestamp() else null end,
      updated_by = (select auth.uid())
  where id = wf.id
  returning * into wf;
  perform app.record_audit_event(org, case when p_archived then 'workflow.archived' else 'workflow.restored' end, 'public.firm_workflows', wf.id, 'success',
    jsonb_build_object('name', wf.name, 'version', wf.version));
  return jsonb_build_object('id', wf.id, 'version', wf.version);
end;
$$;
comment on function public.set_firm_workflow_archived(uuid, integer, boolean) is
  'Firm workflows: a firm owner or licensed consultant archives or restores a workflow at the expected row version. Nothing is deleted. Audited.';
revoke all on function public.set_firm_workflow_archived(uuid, integer, boolean) from public, anon;
grant execute on function public.set_firm_workflow_archived(uuid, integer, boolean) to authenticated;
