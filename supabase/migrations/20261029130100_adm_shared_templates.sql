-- ADM-03: versioned shared templates.
--
-- The platform administration app is a separate codebase. It calls the service-role functions
-- here to draft a version (author, test evidence, effective date, changelog). It cannot publish.
-- A licensed reviewer approves with a fresh step-up, as themselves (their user session, not the
-- service role): they are a platform admin and hold an active licence. This migration inserts
-- no platform_admins row.
--
-- Publishing freezes the version, records the review, audits it, and notifies every firm.
-- Firms adopt a published version. Matters pin the adopted version; a later publication does
-- not move a pin. A firm's own wording is a separate override, not a change to the central text.
-- Official claims and the firm Source review workbench are unchanged.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.shared_templates (
  id uuid primary key default gen_random_uuid(),
  stable_key text not null check (stable_key ~ '^[a-z][a-z0-9_]{1,60}$'),
  title text not null check (length(btrim(title)) between 1 and 160),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (stable_key)
);
comment on table public.shared_templates is
  'ADM-03: a platform-wide template (no organization). Firms adopt a published version; they do not edit this row.';

create index shared_templates_created_at_idx on public.shared_templates (created_at);

create table public.shared_template_versions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.shared_templates (id),
  version_number integer not null check (version_number >= 1),
  status text not null check (status in ('draft', 'published', 'superseded', 'rejected', 'rolled_back')),
  body jsonb not null check (jsonb_typeof(body) = 'object'),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  author_name text not null check (length(btrim(author_name)) between 1 and 120),
  author_user_id uuid references auth.users (id),
  test_evidence text not null check (length(btrim(test_evidence)) between 8 and 2000),
  effective_on date not null,
  changelog text not null check (length(btrim(changelog)) between 3 and 2000),
  supersedes_version_id uuid references public.shared_template_versions (id),
  reviewer_user_id uuid references auth.users (id),
  reviewer_label text check (reviewer_label is null or length(reviewer_label) between 1 and 160),
  reviewed_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1),
  unique (template_id, version_number),
  check ((status in ('published', 'superseded', 'rolled_back')) = (published_at is not null)),
  check ((status in ('published', 'superseded', 'rolled_back', 'rejected')) = (reviewed_at is not null)),
  check (effective_on between date '1990-01-01' and date '2100-01-01')
);
comment on table public.shared_template_versions is
  'ADM-03: one version of a shared template. Drafts are written by the admin portal (service role). Published only after a licensed platform reviewer approves with a step-up. Content is frozen once it leaves draft.';

create unique index shared_template_versions_one_draft_uidx
  on public.shared_template_versions (template_id) where status = 'draft';
create unique index shared_template_versions_one_published_uidx
  on public.shared_template_versions (template_id) where status = 'published';
create index shared_template_versions_template_idx on public.shared_template_versions (template_id, version_number desc);
create index shared_template_versions_author_idx on public.shared_template_versions (author_user_id);
create index shared_template_versions_reviewer_idx on public.shared_template_versions (reviewer_user_id);
create index shared_template_versions_supersedes_idx on public.shared_template_versions (supersedes_version_id);

create table public.shared_template_reviews (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.shared_template_versions (id),
  decision text not null check (decision in ('approved', 'rejected', 'rolled_back')),
  reviewer_user_id uuid not null references auth.users (id),
  reviewer_label text not null check (length(reviewer_label) between 1 and 160),
  licence_snapshot jsonb not null check (jsonb_typeof(licence_snapshot) = 'object'),
  reason text check (reason is null or length(btrim(reason)) between 3 and 500),
  decided_at timestamptz not null default now(),
  check (decision = 'approved' or reason is not null)
);
comment on table public.shared_template_reviews is
  'ADM-03: each approve, reject or rollback of a shared template version. Append-only. The licence snapshot is the reviewer''s licence type and number, not a client record.';

create index shared_template_reviews_version_idx on public.shared_template_reviews (version_id, decided_at);
create index shared_template_reviews_reviewer_idx on public.shared_template_reviews (reviewer_user_id);

create table public.shared_template_notices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  version_id uuid not null references public.shared_template_versions (id),
  kind text not null check (kind in ('published', 'rolled_back')),
  created_at timestamptz not null default now(),
  unique (organization_id, version_id, kind)
);
comment on table public.shared_template_notices is
  'ADM-03: a firm is told when a shared template version is published or rolled back. Firms created later see the catalogue without this notice.';

create index shared_template_notices_org_idx on public.shared_template_notices (organization_id, created_at desc);
create index shared_template_notices_version_idx on public.shared_template_notices (version_id);

create table public.shared_template_notice_dismissals (
  notice_id uuid not null references public.shared_template_notices (id),
  user_id uuid not null references auth.users (id),
  dismissed_at timestamptz not null default now(),
  primary key (notice_id, user_id)
);
comment on table public.shared_template_notice_dismissals is
  'ADM-03: one staff member hid a shared-template notice. The version stays in the catalogue.';

create index shared_template_notice_dismissals_user_idx on public.shared_template_notice_dismissals (user_id);

create table public.firm_shared_template_adoptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  template_id uuid not null references public.shared_templates (id),
  version_id uuid not null references public.shared_template_versions (id),
  adopted_by uuid not null references auth.users (id),
  adopted_at timestamptz not null default now()
);
comment on table public.firm_shared_template_adoptions is
  'ADM-03: a firm adopted a published shared template version. The latest row for a firm and template is current. Adopting does not move matter pins.';

create index firm_shared_template_adoptions_org_idx on public.firm_shared_template_adoptions (organization_id, template_id, adopted_at desc);
create index firm_shared_template_adoptions_version_idx on public.firm_shared_template_adoptions (version_id);
create index firm_shared_template_adoptions_adopted_by_idx on public.firm_shared_template_adoptions (adopted_by);

create table public.matter_shared_template_pins (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  matter_id uuid not null,
  template_id uuid not null references public.shared_templates (id),
  version_id uuid not null references public.shared_template_versions (id),
  pinned_by uuid not null references auth.users (id),
  pinned_at timestamptz not null default now(),
  unique (matter_id, template_id),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id)
);
comment on table public.matter_shared_template_pins is
  'ADM-03: a matter''s pinned shared template version. Insert only. A newer publication does not change it.';

create index matter_shared_template_pins_org_idx on public.matter_shared_template_pins (organization_id, template_id);
create index matter_shared_template_pins_matter_fk_idx on public.matter_shared_template_pins (matter_id, organization_id);
create index matter_shared_template_pins_version_idx on public.matter_shared_template_pins (version_id);
create index matter_shared_template_pins_pinned_by_idx on public.matter_shared_template_pins (pinned_by);

create table public.firm_shared_template_overrides (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  template_id uuid not null references public.shared_templates (id),
  based_on_version_id uuid not null references public.shared_template_versions (id),
  kind text not null check (kind in ('edit', 'clear')),
  body jsonb check (body is null or jsonb_typeof(body) = 'object'),
  reason text not null check (length(btrim(reason)) between 3 and 500),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  check ((kind = 'edit') = (body is not null))
);
comment on table public.firm_shared_template_overrides is
  'ADM-03: a firm''s own wording of a shared template, kept apart from the centrally reviewed body. The latest row is current. Append-only.';

create index firm_shared_template_overrides_org_idx on public.firm_shared_template_overrides (organization_id, template_id, created_at desc);
create index firm_shared_template_overrides_version_idx on public.firm_shared_template_overrides (based_on_version_id);
create index firm_shared_template_overrides_created_by_idx on public.firm_shared_template_overrides (created_by);

-- ---------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------
create function app.shared_template_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('app.shared_template_write', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    raise exception 'shared templates are written by the review functions' using errcode = '42501';
  end if;
  raise exception 'a shared template version changes only through the review functions' using errcode = '42501';
end;
$$;
revoke all on function app.shared_template_guard() from public;

create trigger shared_templates_guard before insert or update on public.shared_templates
  for each row execute function app.shared_template_guard();
create trigger shared_templates_no_delete before delete on public.shared_templates
  for each row execute function app.reject_governed_delete();
create trigger shared_templates_no_truncate before truncate on public.shared_templates
  for each statement execute function app.reject_governed_delete();

create trigger shared_template_versions_guard before insert or update on public.shared_template_versions
  for each row execute function app.shared_template_guard();
create trigger shared_template_versions_audit after insert or update or delete on public.shared_template_versions
  for each row execute function app.audit_row_change();
create trigger shared_template_versions_no_delete before delete on public.shared_template_versions
  for each row execute function app.reject_governed_delete();
create trigger shared_template_versions_no_truncate before truncate on public.shared_template_versions
  for each statement execute function app.reject_governed_delete();

create trigger shared_template_reviews_guard before insert or update on public.shared_template_reviews
  for each row execute function app.shared_template_guard();
create trigger shared_template_reviews_no_delete before delete on public.shared_template_reviews
  for each row execute function app.reject_governed_delete();
create trigger shared_template_reviews_no_update before update on public.shared_template_reviews
  for each row execute function app.reject_governed_delete();
create trigger shared_template_reviews_no_truncate before truncate on public.shared_template_reviews
  for each statement execute function app.reject_governed_delete();

create trigger shared_template_notices_guard before insert or update on public.shared_template_notices
  for each row execute function app.shared_template_guard();
create trigger shared_template_notices_no_delete before delete on public.shared_template_notices
  for each row execute function app.reject_governed_delete();
create trigger shared_template_notices_no_truncate before truncate on public.shared_template_notices
  for each statement execute function app.reject_governed_delete();

create trigger firm_shared_template_adoptions_guard before insert or update on public.firm_shared_template_adoptions
  for each row execute function app.shared_template_guard();
create trigger firm_shared_template_adoptions_no_delete before delete on public.firm_shared_template_adoptions
  for each row execute function app.reject_governed_delete();
create trigger firm_shared_template_adoptions_no_truncate before truncate on public.firm_shared_template_adoptions
  for each statement execute function app.reject_governed_delete();

create trigger matter_shared_template_pins_guard before insert or update on public.matter_shared_template_pins
  for each row execute function app.shared_template_guard();
create trigger matter_shared_template_pins_no_delete before delete on public.matter_shared_template_pins
  for each row execute function app.reject_governed_delete();
create trigger matter_shared_template_pins_no_update before update on public.matter_shared_template_pins
  for each row execute function app.reject_governed_delete();
create trigger matter_shared_template_pins_no_truncate before truncate on public.matter_shared_template_pins
  for each statement execute function app.reject_governed_delete();

create trigger firm_shared_template_overrides_guard before insert or update on public.firm_shared_template_overrides
  for each row execute function app.shared_template_guard();
create trigger firm_shared_template_overrides_no_delete before delete on public.firm_shared_template_overrides
  for each row execute function app.reject_governed_delete();
create trigger firm_shared_template_overrides_no_update before update on public.firm_shared_template_overrides
  for each row execute function app.reject_governed_delete();
create trigger firm_shared_template_overrides_no_truncate before truncate on public.firm_shared_template_overrides
  for each statement execute function app.reject_governed_delete();

-- Dismissals are per user and are not the template text. Staff insert them through the function.
create trigger shared_template_notice_dismissals_guard before insert or update on public.shared_template_notice_dismissals
  for each row execute function app.shared_template_guard();
create trigger shared_template_notice_dismissals_no_delete before delete on public.shared_template_notice_dismissals
  for each row execute function app.reject_governed_delete();
create trigger shared_template_notice_dismissals_no_truncate before truncate on public.shared_template_notice_dismissals
  for each statement execute function app.reject_governed_delete();

-- ---------------------------------------------------------------------------
-- Privileges and RLS
-- ---------------------------------------------------------------------------
alter table public.shared_templates enable row level security;
alter table public.shared_templates force row level security;
alter table public.shared_template_versions enable row level security;
alter table public.shared_template_versions force row level security;
alter table public.shared_template_reviews enable row level security;
alter table public.shared_template_reviews force row level security;
alter table public.shared_template_notices enable row level security;
alter table public.shared_template_notices force row level security;
alter table public.shared_template_notice_dismissals enable row level security;
alter table public.shared_template_notice_dismissals force row level security;
alter table public.firm_shared_template_adoptions enable row level security;
alter table public.firm_shared_template_adoptions force row level security;
alter table public.matter_shared_template_pins enable row level security;
alter table public.matter_shared_template_pins force row level security;
alter table public.firm_shared_template_overrides enable row level security;
alter table public.firm_shared_template_overrides force row level security;

revoke all on table public.shared_templates from public, anon, authenticated, service_role;
revoke all on table public.shared_template_versions from public, anon, authenticated, service_role;
revoke all on table public.shared_template_reviews from public, anon, authenticated, service_role;
revoke all on table public.shared_template_notices from public, anon, authenticated, service_role;
revoke all on table public.shared_template_notice_dismissals from public, anon, authenticated, service_role;
revoke all on table public.firm_shared_template_adoptions from public, anon, authenticated, service_role;
revoke all on table public.matter_shared_template_pins from public, anon, authenticated, service_role;
revoke all on table public.firm_shared_template_overrides from public, anon, authenticated, service_role;

grant select on table public.shared_templates to authenticated, service_role;
grant select on table public.shared_template_versions to authenticated, service_role;
grant select on table public.shared_template_reviews to authenticated, service_role;
grant select on table public.shared_template_notices to authenticated;
grant select on table public.shared_template_notice_dismissals to authenticated;
grant select on table public.firm_shared_template_adoptions to authenticated;
grant select on table public.matter_shared_template_pins to authenticated;
grant select on table public.firm_shared_template_overrides to authenticated;

-- Staff of a firm read the catalogue that has left draft. Drafts are for a platform admin.
-- service_role bypasses RLS and is how the admin portal reads drafts.
create policy shared_templates_staff on public.shared_templates
  for select to authenticated
  using (
    (select app.staff_mfa_satisfied())
    and (select app.is_org_staff((select app.current_organization_id())))
    and (
      (select app.is_platform_admin())
      or exists (
        select 1 from public.shared_template_versions v
        where v.template_id = shared_templates.id
          and v.status in ('published', 'superseded', 'rolled_back')
      )
    )
  );

create policy shared_template_versions_staff on public.shared_template_versions
  for select to authenticated
  using (
    (select app.staff_mfa_satisfied())
    and (
      ((select app.is_platform_admin()) and status in ('draft', 'published', 'superseded', 'rejected', 'rolled_back'))
      or (
        (select app.is_org_staff((select app.current_organization_id())))
        and status in ('published', 'superseded', 'rolled_back')
      )
    )
  );

create policy shared_template_reviews_staff on public.shared_template_reviews
  for select to authenticated
  using (
    (select app.staff_mfa_satisfied())
    and (
      (select app.is_platform_admin())
      or exists (
        select 1 from public.shared_template_versions v
        where v.id = shared_template_reviews.version_id
          and v.status in ('published', 'superseded', 'rolled_back')
          and (select app.is_org_staff((select app.current_organization_id())))
      )
    )
  );

create policy shared_template_notices_staff on public.shared_template_notices
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.staff_mfa_satisfied())
    and (select app.is_org_staff(organization_id))
  );

create policy shared_template_notice_dismissals_staff on public.shared_template_notice_dismissals
  for select to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.shared_template_notices n
      where n.id = notice_id
        and n.organization_id = (select app.current_organization_id())
        and (select app.is_org_staff(n.organization_id))
    )
  );

create policy firm_shared_template_adoptions_staff on public.firm_shared_template_adoptions
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.staff_mfa_satisfied())
    and (select app.is_org_staff(organization_id))
  );

create policy matter_shared_template_pins_staff on public.matter_shared_template_pins
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.can_read_matter(matter_id))
  );

create policy firm_shared_template_overrides_staff on public.firm_shared_template_overrides
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.staff_mfa_satisfied())
    and (select app.is_org_staff(organization_id))
  );

-- ---------------------------------------------------------------------------
-- Body, reviewer, notify
-- ---------------------------------------------------------------------------
create function app.shared_template_body(p_title text, p_summary text, p_items jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_title text := nullif(btrim(coalesce(p_title, '')), '');
  v_summary text := btrim(coalesce(p_summary, ''));
  v_items jsonb := '[]'::jsonb;
  element jsonb;
  item text;
begin
  if v_title is null or length(v_title) > 160 then
    raise exception 'the title is 1 to 160 characters' using errcode = '22023';
  end if;
  if length(v_summary) > 2000 then
    raise exception 'the summary is at most 2000 characters' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'items are a list' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 80 then
    raise exception 'a template has at most 80 items' using errcode = '22023';
  end if;
  for element in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(element) <> 'string' then
      raise exception 'each item is text' using errcode = '22023';
    end if;
    item := nullif(btrim(element #>> '{}'), '');
    if item is null or length(item) > 200 then
      raise exception 'each item is 1 to 200 characters' using errcode = '22023';
    end if;
    v_items := v_items || jsonb_build_array(item);
  end loop;
  return jsonb_build_object('title', v_title, 'summary', v_summary, 'items', v_items);
end;
$$;
revoke all on function app.shared_template_body(text, text, jsonb) from public;

create function app.shared_template_hash(p_body jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(extensions.digest(convert_to(p_body::text, 'utf8'), 'sha256'), 'hex');
$$;
revoke all on function app.shared_template_hash(jsonb) from public;

-- Platform admin, fresh step-up, and an active licence on file. Service role is not a reviewer.
create function app.platform_template_reviewer()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  snap jsonb;
  label text;
begin
  if app.support_service_role() then
    raise exception 'the service role cannot publish a template' using errcode = '42501';
  end if;
  if app.is_platform_admin() is distinct from true then
    raise exception 'template review denied' using errcode = '42501';
  end if;
  if app.mfa_step_up_satisfied() is distinct from true then
    raise exception 'step-up is required' using errcode = '42501';
  end if;
  select jsonb_build_object('licence_type', c.licence_type, 'college_id', c.college_id, 'status', c.status),
         c.licence_type::text || ' ' || c.college_id
    into snap, label
  from public.consultant_credentials c
  join public.memberships mem
    on mem.id = c.membership_id and mem.organization_id = c.organization_id
  where mem.user_id = (select auth.uid())
    and mem.status = 'active'
    and mem.role in ('firm_owner', 'licensed_consultant')
    and c.register_status = 'active'
    and c.entitlement_to_practise is distinct from false
    and c.discipline_revoked is not true
    and c.discipline_suspended is not true
    and app.licence_status_blocks(c.status) is not true
  order by c.checked_at desc nulls last
  limit 1;
  if snap is null then
    raise exception 'a licensed reviewer is required' using errcode = '42501';
  end if;
  return snap || jsonb_build_object('label', label);
end;
$$;
revoke all on function app.platform_template_reviewer() from public;

create function app.notify_shared_template(p_version uuid, p_kind text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('app.shared_template_write', 'on', true);
  insert into public.shared_template_notices (organization_id, version_id, kind)
  select org.id, p_version, p_kind
  from public.organizations org
  on conflict (organization_id, version_id, kind) do nothing;
end;
$$;
revoke all on function app.notify_shared_template(uuid, text) from public;

create function app.shared_template_changes(p_before jsonb, p_after jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  changes jsonb := '[]'::jsonb;
  field text;
  before_text text;
  after_text text;
begin
  if p_after is null then
    return changes;
  end if;
  foreach field in array array['title', 'summary', 'items'] loop
    if field = 'items' then
      before_text := coalesce((
        select string_agg(value, E'\n' order by ordinality)
        from jsonb_array_elements_text(coalesce(p_before -> 'items', '[]'::jsonb)) with ordinality
      ), '');
      after_text := coalesce((
        select string_agg(value, E'\n' order by ordinality)
        from jsonb_array_elements_text(coalesce(p_after -> 'items', '[]'::jsonb)) with ordinality
      ), '');
    else
      before_text := coalesce(p_before ->> field, '');
      after_text := coalesce(p_after ->> field, '');
    end if;
    if p_before is null then
      changes := changes || jsonb_build_array(jsonb_build_object('field', field, 'before', '', 'after', after_text));
    elsif before_text is distinct from after_text then
      changes := changes || jsonb_build_array(jsonb_build_object('field', field, 'before', before_text, 'after', after_text));
    end if;
  end loop;
  return changes;
end;
$$;
revoke all on function app.shared_template_changes(jsonb, jsonb) from public;

-- ---------------------------------------------------------------------------
-- Draft (admin portal, service role only)
-- ---------------------------------------------------------------------------
create function public.draft_shared_template_version(
  p_stable_key text,
  p_title text,
  p_summary text,
  p_items jsonb,
  p_author_name text,
  p_author_user_id uuid,
  p_test_evidence text,
  p_effective_on date,
  p_changelog text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := nullif(btrim(coalesce(p_stable_key, '')), '');
  v_author text := nullif(btrim(coalesce(p_author_name, '')), '');
  v_evidence text := nullif(btrim(coalesce(p_test_evidence, '')), '');
  v_changelog text := nullif(btrim(coalesce(p_changelog, '')), '');
  v_body jsonb;
  v_template uuid;
  v_number integer;
  v_id uuid;
  v_published uuid;
  v_title text;
begin
  if app.support_service_role() is distinct from true then
    raise exception 'template draft denied' using errcode = '42501';
  end if;
  if v_key is null or v_key !~ '^[a-z][a-z0-9_]{1,60}$' then
    raise exception 'the template key is lowercase words' using errcode = '22023';
  end if;
  if v_author is null or length(v_author) > 120 then
    raise exception 'name the author (1 to 120 characters)' using errcode = '22023';
  end if;
  if p_author_user_id is null or not exists (select 1 from public.platform_admins admin where admin.user_id = p_author_user_id) then
    raise exception 'the author is not a platform admin' using errcode = '22023';
  end if;
  if v_evidence is null or length(v_evidence) not between 8 and 2000 then
    raise exception 'test evidence is 8 to 2000 characters' using errcode = '22023';
  end if;
  if v_changelog is null or length(v_changelog) not between 3 and 2000 then
    raise exception 'the changelog is 3 to 2000 characters' using errcode = '22023';
  end if;
  if p_effective_on is null or p_effective_on < date '1990-01-01' or p_effective_on > date '2100-01-01' then
    raise exception 'the effective date is required' using errcode = '22023';
  end if;
  v_body := app.shared_template_body(p_title, p_summary, p_items);
  v_title := v_body ->> 'title';
  perform set_config('app.shared_template_write', 'on', true);
  insert into public.shared_templates (stable_key, title)
  values (v_key, v_title)
  on conflict (stable_key) do update set title = excluded.title, updated_at = now()
  returning id into v_template;
  if exists (select 1 from public.shared_template_versions v where v.template_id = v_template and v.status = 'draft') then
    raise exception 'a draft of this template is already open' using errcode = '23505';
  end if;
  select coalesce(max(version_number), 0) + 1 into v_number
  from public.shared_template_versions where template_id = v_template;
  select id into v_published from public.shared_template_versions
  where template_id = v_template and status = 'published';
  insert into public.shared_template_versions (
    template_id, version_number, status, body, content_hash, author_name, author_user_id,
    test_evidence, effective_on, changelog, supersedes_version_id
  ) values (
    v_template, v_number, 'draft', v_body, app.shared_template_hash(v_body), v_author, p_author_user_id,
    v_evidence, p_effective_on, v_changelog, v_published
  ) returning id into v_id;
  perform app.record_audit_event(null, 'template.drafted', 'public.shared_template_versions', v_id, 'success',
    jsonb_build_object('stable_key', v_key, 'version_number', v_number, 'author_user_id', p_author_user_id));
  return v_id;
end;
$$;
comment on function public.draft_shared_template_version(text, text, text, jsonb, text, uuid, text, date, text) is
  'ADM-03: the admin portal (service role) opens a draft shared template version. It does not publish. The author must already be a platform admin. No platform_admins row is created here.';

revoke all on function public.draft_shared_template_version(text, text, text, jsonb, text, uuid, text, date, text) from public, anon, authenticated;
grant execute on function public.draft_shared_template_version(text, text, text, jsonb, text, uuid, text, date, text) to service_role;

create function public.revise_shared_template_draft(
  p_version_id uuid,
  p_title text,
  p_summary text,
  p_items jsonb,
  p_test_evidence text,
  p_effective_on date,
  p_changelog text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.shared_template_versions%rowtype;
  v_body jsonb;
  v_evidence text := nullif(btrim(coalesce(p_test_evidence, '')), '');
  v_changelog text := nullif(btrim(coalesce(p_changelog, '')), '');
begin
  if app.support_service_role() is distinct from true then
    raise exception 'template draft denied' using errcode = '42501';
  end if;
  select * into v from public.shared_template_versions where id = p_version_id for update;
  if v.id is null or v.status <> 'draft' then
    raise exception 'that draft is not open' using errcode = '22023';
  end if;
  if v_evidence is null or length(v_evidence) not between 8 and 2000 then
    raise exception 'test evidence is 8 to 2000 characters' using errcode = '22023';
  end if;
  if v_changelog is null or length(v_changelog) not between 3 and 2000 then
    raise exception 'the changelog is 3 to 2000 characters' using errcode = '22023';
  end if;
  if p_effective_on is null or p_effective_on < date '1990-01-01' or p_effective_on > date '2100-01-01' then
    raise exception 'the effective date is required' using errcode = '22023';
  end if;
  v_body := app.shared_template_body(p_title, p_summary, p_items);
  perform set_config('app.shared_template_write', 'on', true);
  update public.shared_template_versions set
    body = v_body,
    content_hash = app.shared_template_hash(v_body),
    test_evidence = v_evidence,
    effective_on = p_effective_on,
    changelog = v_changelog
  where id = v.id;
  perform app.record_audit_event(null, 'template.draft_revised', 'public.shared_template_versions', v.id, 'success',
    jsonb_build_object('version_number', v.version_number));
  return v.id;
end;
$$;
comment on function public.revise_shared_template_draft(uuid, text, text, jsonb, text, date, text) is
  'ADM-03: the admin portal (service role) edits an open draft. A published version is refused.';

revoke all on function public.revise_shared_template_draft(uuid, text, text, jsonb, text, date, text) from public, anon, authenticated;
grant execute on function public.revise_shared_template_draft(uuid, text, text, jsonb, text, date, text) to service_role;

-- ---------------------------------------------------------------------------
-- Review (licensed platform admin, step-up). Not the service role.
-- ---------------------------------------------------------------------------
create function public.approve_shared_template_version(p_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.shared_template_versions%rowtype;
  earlier public.shared_template_versions%rowtype;
  reviewer jsonb;
  actor uuid := (select auth.uid());
begin
  reviewer := app.platform_template_reviewer();
  select * into v from public.shared_template_versions where id = p_version_id for update;
  if v.id is null or v.status <> 'draft' then
    raise exception 'nothing is waiting for review' using errcode = '22023';
  end if;
  if v.author_user_id = actor then
    raise exception 'the author cannot approve their own version' using errcode = '42501';
  end if;
  select * into earlier from public.shared_template_versions
  where template_id = v.template_id and status = 'published'
  for update;
  perform set_config('app.shared_template_write', 'on', true);
  if earlier.id is not null then
    update public.shared_template_versions
    set status = 'superseded'
    where id = earlier.id;
  end if;
  update public.shared_template_versions set
    status = 'published',
    supersedes_version_id = earlier.id,
    reviewer_user_id = actor,
    reviewer_label = reviewer ->> 'label',
    reviewed_at = statement_timestamp(),
    published_at = statement_timestamp()
  where id = v.id;
  insert into public.shared_template_reviews (version_id, decision, reviewer_user_id, reviewer_label, licence_snapshot)
  values (v.id, 'approved', actor, reviewer ->> 'label', reviewer - 'label');
  perform app.notify_shared_template(v.id, 'published');
  perform app.record_audit_event(null, 'template.version_published', 'public.shared_template_versions', v.id, 'success',
    jsonb_build_object('version_number', v.version_number, 'reviewer', reviewer ->> 'label', 'supersedes', earlier.id));
  return jsonb_build_object('id', v.id, 'status', 'published', 'version_number', v.version_number);
end;
$$;
comment on function public.approve_shared_template_version(uuid) is
  'ADM-03: a licensed platform admin approves a draft with a fresh step-up and publishes it. The service role cannot call this. Firms are notified. Existing matter pins are not moved.';

revoke all on function public.approve_shared_template_version(uuid) from public, anon, service_role;
grant execute on function public.approve_shared_template_version(uuid) to authenticated;

create function public.reject_shared_template_version(p_version_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.shared_template_versions%rowtype;
  reviewer jsonb;
  actor uuid := (select auth.uid());
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  reviewer := app.platform_template_reviewer();
  if v_reason is null or length(v_reason) not between 3 and 500 then
    raise exception 'a reason is required' using errcode = '22023';
  end if;
  select * into v from public.shared_template_versions where id = p_version_id for update;
  if v.id is null or v.status <> 'draft' then
    raise exception 'nothing is waiting for review' using errcode = '22023';
  end if;
  perform set_config('app.shared_template_write', 'on', true);
  update public.shared_template_versions set
    status = 'rejected',
    reviewer_user_id = actor,
    reviewer_label = reviewer ->> 'label',
    reviewed_at = statement_timestamp()
  where id = v.id;
  insert into public.shared_template_reviews (version_id, decision, reviewer_user_id, reviewer_label, licence_snapshot, reason)
  values (v.id, 'rejected', actor, reviewer ->> 'label', reviewer - 'label', v_reason);
  perform app.record_audit_event(null, 'template.version_rejected', 'public.shared_template_versions', v.id, 'success',
    jsonb_build_object('version_number', v.version_number, 'reason_length', length(v_reason)));
  return jsonb_build_object('id', v.id, 'status', 'rejected');
end;
$$;
comment on function public.reject_shared_template_version(uuid, text) is
  'ADM-03: a licensed platform admin rejects a draft with a step-up and a reason. Nothing is published and firms are not notified.';

revoke all on function public.reject_shared_template_version(uuid, text) from public, anon, service_role;
grant execute on function public.reject_shared_template_version(uuid, text) to authenticated;

create function public.rollback_shared_template_version(p_version_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.shared_template_versions%rowtype;
  earlier public.shared_template_versions%rowtype;
  reviewer jsonb;
  actor uuid := (select auth.uid());
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  reviewer := app.platform_template_reviewer();
  if v_reason is null or length(v_reason) not between 3 and 500 then
    raise exception 'a reason is required' using errcode = '22023';
  end if;
  select * into v from public.shared_template_versions where id = p_version_id for update;
  if v.id is null or v.status <> 'published' then
    raise exception 'only the published version can be rolled back' using errcode = '22023';
  end if;
  if v.supersedes_version_id is not null then
    select * into earlier from public.shared_template_versions
    where id = v.supersedes_version_id and template_id = v.template_id and status = 'superseded'
    for update;
  end if;
  perform set_config('app.shared_template_write', 'on', true);
  update public.shared_template_versions set status = 'rolled_back' where id = v.id;
  if earlier.id is not null then
    update public.shared_template_versions set status = 'published' where id = earlier.id;
  end if;
  insert into public.shared_template_reviews (version_id, decision, reviewer_user_id, reviewer_label, licence_snapshot, reason)
  values (v.id, 'rolled_back', actor, reviewer ->> 'label', reviewer - 'label', v_reason);
  perform app.notify_shared_template(v.id, 'rolled_back');
  perform app.record_audit_event(null, 'template.version_rolled_back', 'public.shared_template_versions', v.id, 'success',
    jsonb_build_object('version_number', v.version_number, 'restored', earlier.id, 'reason_length', length(v_reason)));
  return jsonb_build_object('id', v.id, 'status', 'rolled_back', 'restored', earlier.id);
end;
$$;
comment on function public.rollback_shared_template_version(uuid, text) is
  'ADM-03: a licensed platform admin rolls back the published version with a step-up. The version it replaced is published again when it is still superseded. Matter pins stay. Firms are notified.';

revoke all on function public.rollback_shared_template_version(uuid, text) from public, anon, service_role;
grant execute on function public.rollback_shared_template_version(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Diff and history (admin portal and firms)
-- ---------------------------------------------------------------------------
create function public.shared_template_diff(p_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.shared_template_versions%rowtype;
  earlier public.shared_template_versions%rowtype;
begin
  select * into v from public.shared_template_versions where id = p_version_id;
  if v.id is null then
    raise exception 'template review denied' using errcode = '42501';
  end if;
  if v.status = 'draft' or v.status = 'rejected' then
    if app.support_service_role() is distinct from true and app.is_platform_admin() is distinct from true then
      raise exception 'template review denied' using errcode = '42501';
    end if;
  elsif app.support_service_role() is distinct from true
        and app.is_platform_admin() is distinct from true
        and app.is_org_staff((select app.current_organization_id())) is distinct from true then
    raise exception 'staff access denied' using errcode = '42501';
  end if;
  if v.supersedes_version_id is not null then
    select * into earlier from public.shared_template_versions where id = v.supersedes_version_id;
  end if;
  return jsonb_build_object(
    'version_id', v.id,
    'version_number', v.version_number,
    'status', v.status,
    'before', earlier.body,
    'after', v.body,
    'changes', app.shared_template_changes(earlier.body, v.body)
  );
end;
$$;
comment on function public.shared_template_diff(uuid) is
  'ADM-03: the difference between a version and the one it replaced (title, summary, items). Drafts are visible to the admin portal and a platform admin.';

revoke all on function public.shared_template_diff(uuid) from public, anon;
grant execute on function public.shared_template_diff(uuid) to authenticated, service_role;

create function public.shared_template_history(p_stable_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := nullif(btrim(coalesce(p_stable_key, '')), '');
  v_template uuid;
  include_private boolean;
  result jsonb;
begin
  if v_key is null then
    raise exception 'name the template' using errcode = '22023';
  end if;
  select id into v_template from public.shared_templates where stable_key = v_key;
  if v_template is null then
    raise exception 'template review denied' using errcode = '42501';
  end if;
  include_private := app.support_service_role() or app.is_platform_admin();
  if include_private is distinct from true
     and app.is_org_staff((select app.current_organization_id())) is distinct from true then
    raise exception 'staff access denied' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', v.id,
    'version_number', v.version_number,
    'status', v.status,
    'author_name', v.author_name,
    'reviewer_label', v.reviewer_label,
    'effective_on', v.effective_on,
    'changelog', v.changelog,
    'reviewed_at', v.reviewed_at,
    'published_at', v.published_at,
    'test_evidence', v.test_evidence,
    'body', v.body
  ) order by v.version_number), '[]'::jsonb)
  into result
  from public.shared_template_versions v
  where v.template_id = v_template
    and (include_private or v.status in ('published', 'superseded', 'rolled_back'));
  return jsonb_build_object('stable_key', v_key, 'versions', result);
end;
$$;
comment on function public.shared_template_history(text) is
  'ADM-03: versions of a shared template. Firms see published, superseded and rolled-back versions. Drafts and rejections are for the admin portal and a platform admin.';

revoke all on function public.shared_template_history(text) from public, anon;
grant execute on function public.shared_template_history(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Firm catalogue, adopt, override, pin
-- ---------------------------------------------------------------------------
create function app.shared_template_staff()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid := (select app.current_organization_id());
begin
  if (select auth.uid()) is null
     or org is null
     or app.in_active_org(org) is distinct from true
     or app.staff_mfa_satisfied() is distinct from true
     or app.is_org_staff(org) is distinct from true then
    raise exception 'staff access denied' using errcode = '42501';
  end if;
  return org;
end;
$$;
revoke all on function app.shared_template_staff() from public;

create function public.firm_shared_templates()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid := app.shared_template_staff();
  actor uuid := (select auth.uid());
  can_adopt boolean;
  can_override boolean;
  can_pin boolean;
begin
  can_adopt := app.has_org_role(org, array['firm_owner', 'licensed_consultant']::public.org_role[])
    and app.actor_is_licensed(org)
    and app.actor_licence_blocks_regulated_action(org) is distinct from true;
  can_override := can_adopt;
  can_pin := app.has_org_role(org, array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[]);
  return jsonb_build_object(
    'can_adopt', can_adopt,
    'can_override', can_override,
    'can_pin', can_pin,
    'notices', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', n.id, 'kind', n.kind, 'version_id', v.id, 'version_number', v.version_number,
        'title', t.title, 'stable_key', t.stable_key, 'changelog', v.changelog
      ) order by n.created_at desc)
      from public.shared_template_notices n
      join public.shared_template_versions v on v.id = n.version_id
      join public.shared_templates t on t.id = v.template_id
      where n.organization_id = org
        and not exists (
          select 1 from public.shared_template_notice_dismissals d
          where d.notice_id = n.id and d.user_id = actor
        )
        and not (
          n.kind = 'published' and exists (
            select 1 from public.firm_shared_template_adoptions a
            where a.organization_id = org and a.template_id = t.id and a.version_id = v.id
              and a.adopted_at = (
                select max(a2.adopted_at) from public.firm_shared_template_adoptions a2
                where a2.organization_id = org and a2.template_id = t.id
              )
          )
        )
    ), '[]'::jsonb),
    'versions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', v.id, 'template_id', v.template_id, 'stable_key', t.stable_key, 'template_title', t.title,
        'version_number', v.version_number, 'status', v.status, 'body', v.body,
        'author_name', v.author_name, 'reviewer_label', v.reviewer_label,
        'effective_on', v.effective_on, 'changelog', v.changelog,
        'test_evidence', v.test_evidence, 'reviewed_at', v.reviewed_at, 'published_at', v.published_at,
        'supersedes_version_id', v.supersedes_version_id
      ) order by t.stable_key, v.version_number)
      from public.shared_template_versions v
      join public.shared_templates t on t.id = v.template_id
      where v.status in ('published', 'superseded', 'rolled_back')
    ), '[]'::jsonb),
    'adoptions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'template_id', a.template_id, 'version_id', a.version_id, 'adopted_at', a.adopted_at
      ))
      from public.firm_shared_template_adoptions a
      where a.organization_id = org
        and a.adopted_at = (
          select max(a2.adopted_at) from public.firm_shared_template_adoptions a2
          where a2.organization_id = org and a2.template_id = a.template_id
        )
    ), '[]'::jsonb),
    'overrides', coalesce((
      select jsonb_agg(jsonb_build_object(
        'template_id', o.template_id, 'kind', o.kind, 'body', o.body, 'reason', o.reason,
        'based_on_version_id', o.based_on_version_id, 'created_at', o.created_at
      ))
      from public.firm_shared_template_overrides o
      where o.organization_id = org
        and o.created_at = (
          select max(o2.created_at) from public.firm_shared_template_overrides o2
          where o2.organization_id = org and o2.template_id = o.template_id
        )
    ), '[]'::jsonb),
    'pins', coalesce((
      select jsonb_agg(jsonb_build_object('template_id', p.template_id, 'count', p.n))
      from (
        select template_id, count(*)::integer as n
        from public.matter_shared_template_pins
        where organization_id = org
        group by template_id
      ) p
    ), '[]'::jsonb),
    'matters', case when can_pin then coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'title', m.title) order by m.title)
      from (
        select matter.id, matter.title
        from public.matters matter
        where matter.organization_id = org and app.can_read_matter(matter.id)
        order by matter.title
        limit 40
      ) m
    ), '[]'::jsonb) else '[]'::jsonb end
  );
end;
$$;
comment on function public.firm_shared_templates() is
  'ADM-03: shared templates a firm''s staff may read, with notices, the firm''s adoption and override, and matter pins. Drafts are not included.';

revoke all on function public.firm_shared_templates() from public, anon, service_role;
grant execute on function public.firm_shared_templates() to authenticated;

create function public.adopt_shared_template(p_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid;
  v public.shared_template_versions%rowtype;
  actor uuid := (select auth.uid());
begin
  org := app.shared_template_staff();
  perform app.require_licensed_staff(org, false);
  if app.actor_licence_blocks_regulated_action(org) then
    raise exception 'staff access denied' using errcode = '42501';
  end if;
  select * into v from public.shared_template_versions where id = p_version_id;
  if v.id is null or v.status <> 'published' then
    raise exception 'only a published version can be adopted' using errcode = '22023';
  end if;
  perform set_config('app.shared_template_write', 'on', true);
  insert into public.firm_shared_template_adoptions (organization_id, template_id, version_id, adopted_by)
  values (org, v.template_id, v.id, actor);
  perform app.record_audit_event(org, 'template.adopted', 'public.shared_template_versions', v.id, 'success',
    jsonb_build_object('version_number', v.version_number, 'template_id', v.template_id));
  return jsonb_build_object('version_id', v.id, 'version_number', v.version_number);
end;
$$;
comment on function public.adopt_shared_template(uuid) is
  'ADM-03: a licensed member adopts the published version for the firm. Matter pins are not moved.';

revoke all on function public.adopt_shared_template(uuid) from public, anon, service_role;
grant execute on function public.adopt_shared_template(uuid) to authenticated;

create function public.save_firm_template_override(
  p_template_id uuid, p_title text, p_summary text, p_items jsonb, p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid;
  published public.shared_template_versions%rowtype;
  v_body jsonb;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_id uuid;
begin
  org := app.shared_template_staff();
  perform app.require_licensed_staff(org, true);
  if app.actor_licence_blocks_regulated_action(org) then
    raise exception 'staff access denied' using errcode = '42501';
  end if;
  if v_reason is null or length(v_reason) not between 3 and 500 then
    raise exception 'a reason is required' using errcode = '22023';
  end if;
  select * into published from public.shared_template_versions
  where template_id = p_template_id and status = 'published';
  if published.id is null then
    raise exception 'there is no published version to override' using errcode = '22023';
  end if;
  v_body := app.shared_template_body(p_title, p_summary, p_items);
  if v_body = published.body then
    raise exception 'that wording matches the reviewed version' using errcode = '22023';
  end if;
  perform set_config('app.shared_template_write', 'on', true);
  insert into public.firm_shared_template_overrides (
    organization_id, template_id, based_on_version_id, kind, body, reason, created_by
  ) values (
    org, p_template_id, published.id, 'edit', v_body, v_reason, (select auth.uid())
  ) returning id into v_id;
  perform app.record_audit_event(org, 'template.override_saved', 'public.firm_shared_template_overrides', v_id, 'success',
    jsonb_build_object('template_id', p_template_id, 'based_on_version_id', published.id, 'reason_length', length(v_reason)));
  return jsonb_build_object('id', v_id, 'based_on_version_number', published.version_number);
end;
$$;
comment on function public.save_firm_template_override(uuid, text, text, jsonb, text) is
  'ADM-03: a licensed member saves the firm''s own wording with a step-up and a reason. The centrally reviewed body is not changed.';

revoke all on function public.save_firm_template_override(uuid, text, text, jsonb, text) from public, anon, service_role;
grant execute on function public.save_firm_template_override(uuid, text, text, jsonb, text) to authenticated;

create function public.clear_firm_template_override(p_template_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid;
  published public.shared_template_versions%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_id uuid;
begin
  org := app.shared_template_staff();
  perform app.require_licensed_staff(org, true);
  if app.actor_licence_blocks_regulated_action(org) then
    raise exception 'staff access denied' using errcode = '42501';
  end if;
  if v_reason is null or length(v_reason) not between 3 and 500 then
    raise exception 'a reason is required' using errcode = '22023';
  end if;
  select * into published from public.shared_template_versions
  where template_id = p_template_id and status = 'published';
  if published.id is null then
    raise exception 'there is no published version' using errcode = '22023';
  end if;
  perform set_config('app.shared_template_write', 'on', true);
  insert into public.firm_shared_template_overrides (
    organization_id, template_id, based_on_version_id, kind, reason, created_by
  ) values (
    org, p_template_id, published.id, 'clear', v_reason, (select auth.uid())
  ) returning id into v_id;
  perform app.record_audit_event(org, 'template.override_cleared', 'public.firm_shared_template_overrides', v_id, 'success',
    jsonb_build_object('template_id', p_template_id, 'reason_length', length(v_reason)));
  return jsonb_build_object('id', v_id);
end;
$$;

revoke all on function public.clear_firm_template_override(uuid, text) from public, anon, service_role;
grant execute on function public.clear_firm_template_override(uuid, text) to authenticated;

create function public.pin_matter_shared_template(p_matter_id uuid, p_template_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid;
  adopted public.firm_shared_template_adoptions%rowtype;
  existing public.matter_shared_template_pins%rowtype;
  v_number integer;
  v_id uuid;
begin
  org := app.shared_template_staff();
  if app.has_org_role(org, array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[]) is distinct from true then
    raise exception 'staff access denied' using errcode = '42501';
  end if;
  if app.can_read_matter(p_matter_id) is distinct from true then
    raise exception 'that matter is not open to you' using errcode = '42501';
  end if;
  select * into adopted
  from public.firm_shared_template_adoptions a
  where a.organization_id = org and a.template_id = p_template_id
  order by a.adopted_at desc
  limit 1;
  if adopted.id is null then
    raise exception 'adopt the shared template first' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.shared_template_versions v
    where v.id = adopted.version_id and v.status = 'published'
  ) then
    raise exception 'the adopted version is no longer the published one; adopt the published version first' using errcode = '22023';
  end if;
  select * into existing from public.matter_shared_template_pins
  where matter_id = p_matter_id and template_id = p_template_id;
  if existing.id is not null then
    select version_number into v_number from public.shared_template_versions where id = existing.version_id;
    raise exception 'this matter already uses version % of this template', v_number using errcode = '42501';
  end if;
  perform set_config('app.shared_template_write', 'on', true);
  insert into public.matter_shared_template_pins (organization_id, matter_id, template_id, version_id, pinned_by)
  values (org, p_matter_id, p_template_id, adopted.version_id, (select auth.uid()))
  returning id into v_id;
  perform app.record_audit_event(org, 'template.pinned', 'public.matter_shared_template_pins', v_id, 'success',
    jsonb_build_object('matter_id', p_matter_id, 'version_id', adopted.version_id));
  return jsonb_build_object('id', v_id, 'version_id', adopted.version_id);
end;
$$;
comment on function public.pin_matter_shared_template(uuid, uuid) is
  'ADM-03: pin the firm''s adopted published version on a matter that does not already have a pin. A later publication does not move it.';

revoke all on function public.pin_matter_shared_template(uuid, uuid) from public, anon, service_role;
grant execute on function public.pin_matter_shared_template(uuid, uuid) to authenticated;

create function public.dismiss_shared_template_notice(p_notice_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid := app.shared_template_staff();
  n public.shared_template_notices%rowtype;
begin
  select * into n from public.shared_template_notices where id = p_notice_id and organization_id = org;
  if n.id is null then
    raise exception 'staff access denied' using errcode = '42501';
  end if;
  perform set_config('app.shared_template_write', 'on', true);
  insert into public.shared_template_notice_dismissals (notice_id, user_id)
  values (n.id, (select auth.uid()))
  on conflict (notice_id, user_id) do nothing;
end;
$$;

revoke all on function public.dismiss_shared_template_notice(uuid) from public, anon, service_role;
grant execute on function public.dismiss_shared_template_notice(uuid) to authenticated;
