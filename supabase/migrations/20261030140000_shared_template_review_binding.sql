-- ADM-03: bind a shared template approval to the content that was reviewed.
--
-- * A draft can be submitted for review (public.submit_shared_template_version). While it is in
--   review its content (body, test evidence, effective date, changelog, author, sources) is frozen
--   by triggers; editing needs public.withdraw_shared_template_version first. Content of a version
--   that has left draft is frozen as well.
-- * Approval records a review hash (body, evidence, effective date, changelog and sources). A
--   submitted version is published only if that hash still matches the submitted one. The new
--   overload approve_shared_template_version(uuid, text) also refuses when the hash differs from
--   the one the reviewer's screen showed (public.shared_template_review_hash). The one-argument
--   form keeps working for drafts that are not in review.
-- * Opening a draft no longer changes the live template title. The title follows the published
--   version (set on approval, restored on rollback).
--
-- Redefines public.draft_shared_template_version, public.approve_shared_template_version(uuid),
-- public.rollback_shared_template_version (latest 20261029130100_adm_shared_templates.sql) and
-- app.shared_template_sources_delete_guard (latest 20261029210000_adm_platform_admin_backend.sql).

-- ---------------------------------------------------------------------------
-- Submission columns
-- ---------------------------------------------------------------------------
alter table public.shared_template_versions
  add column if not exists submitted_at timestamptz,
  add column if not exists submitted_by uuid references auth.users (id),
  add column if not exists submitted_review_hash text check (submitted_review_hash is null or submitted_review_hash ~ '^[0-9a-f]{64}$');

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'shared_template_versions_submission_chk'
      and conrelid = 'public.shared_template_versions'::regclass
  ) then
    alter table public.shared_template_versions
      add constraint shared_template_versions_submission_chk check (
        (submitted_at is null) = (submitted_by is null)
        and (submitted_at is null) = (submitted_review_hash is null)
      );
  end if;
end;
$$;

create index if not exists shared_template_versions_submitted_by_idx on public.shared_template_versions (submitted_by);

comment on column public.shared_template_versions.submitted_at is
  'ADM-03: when the draft was submitted for review. While set on a draft, its content and sources cannot change.';
comment on column public.shared_template_versions.submitted_review_hash is
  'ADM-03: app.shared_template_review_hash at submission. Approval publishes only when the content still matches.';

-- ---------------------------------------------------------------------------
-- Review hash: everything a reviewer approves
-- ---------------------------------------------------------------------------
create or replace function app.shared_template_review_hash(p_version_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select encode(extensions.digest(convert_to(jsonb_build_object(
    'body', v.body,
    'test_evidence', v.test_evidence,
    'effective_on', v.effective_on,
    'changelog', v.changelog,
    'author_name', v.author_name,
    'author_user_id', v.author_user_id,
    'sources', coalesce((
      select jsonb_agg(jsonb_build_object(
        'position', s.position, 'url', s.url, 'official', s.official, 'title', s.title,
        'retrieved_on', s.retrieved_on, 'note', s.note
      ) order by s.position)
      from public.shared_template_version_sources s
      where s.version_id = v.id
    ), '[]'::jsonb)
  )::text, 'utf8'), 'sha256'), 'hex')
  from public.shared_template_versions v
  where v.id = p_version_id;
$$;
revoke all on function app.shared_template_review_hash(uuid) from public;

create or replace function public.shared_template_review_hash(p_version_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.platform_read_allowed();
  return app.shared_template_review_hash(p_version_id);
end;
$$;
comment on function public.shared_template_review_hash(uuid) is
  'ADM-03: the review hash of a shared template version (body, evidence, effective date, changelog, author, sources). Pass it to approve_shared_template_version(uuid, text) to bind the approval to what was reviewed.';
revoke all on function public.shared_template_review_hash(uuid) from public, anon;
grant execute on function public.shared_template_review_hash(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Freeze triggers
-- ---------------------------------------------------------------------------
create or replace function app.shared_template_version_review_freeze()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  content_changed boolean;
begin
  content_changed := new.body is distinct from old.body
    or new.content_hash is distinct from old.content_hash
    or new.test_evidence is distinct from old.test_evidence
    or new.effective_on is distinct from old.effective_on
    or new.changelog is distinct from old.changelog
    or new.author_name is distinct from old.author_name
    or new.author_user_id is distinct from old.author_user_id
    or new.template_id is distinct from old.template_id
    or new.version_number is distinct from old.version_number;
  if content_changed and old.status <> 'draft' then
    raise exception 'a version that has left draft cannot be edited' using errcode = '42501';
  end if;
  if content_changed and old.submitted_at is not null then
    raise exception 'this version is in review; withdraw it from review before editing' using errcode = '42501';
  end if;
  if old.status <> 'draft'
     and (new.submitted_at, new.submitted_by, new.submitted_review_hash)
         is distinct from (old.submitted_at, old.submitted_by, old.submitted_review_hash) then
    raise exception 'a version that has left draft cannot be edited' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.shared_template_version_review_freeze() from public;

create trigger shared_template_versions_review_freeze before update on public.shared_template_versions
  for each row execute function app.shared_template_version_review_freeze();

create or replace function app.shared_template_sources_review_freeze()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.shared_template_versions v
    where v.id = new.version_id and v.status = 'draft' and v.submitted_at is null
  ) then
    raise exception 'sources are frozen once a version is submitted for review or leaves draft' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.shared_template_sources_review_freeze() from public;

create trigger shared_template_version_sources_review_freeze before insert on public.shared_template_version_sources
  for each row execute function app.shared_template_sources_review_freeze();

-- Latest 20261029210000: also refuse while the draft is in review.
create or replace function app.shared_template_sources_delete_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('app.shared_template_write', true), '') = 'on'
     and exists (
       select 1 from public.shared_template_versions v
       where v.id = old.version_id and v.status = 'draft' and v.submitted_at is null
     ) then
    return old;
  end if;
  raise exception 'sources are frozen once a version is submitted for review or leaves draft' using errcode = '42501';
end;
$$;
revoke all on function app.shared_template_sources_delete_guard() from public;

-- ---------------------------------------------------------------------------
-- Submit / withdraw (admin portal, service role)
-- ---------------------------------------------------------------------------
create or replace function public.submit_shared_template_version(p_version_id uuid, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid;
  v public.shared_template_versions%rowtype;
  v_hash text;
begin
  if app.support_service_role() is distinct from true then
    raise exception 'template draft denied' using errcode = '42501';
  end if;
  actor := app.platform_ops_actor(p_actor);
  select * into v from public.shared_template_versions where id = p_version_id for update;
  if v.id is null or v.status <> 'draft' then
    raise exception 'that draft is not open' using errcode = '22023';
  end if;
  if v.submitted_at is not null then
    raise exception 'that draft is already in review' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.shared_template_version_sources s where s.version_id = v.id and s.official
  ) then
    raise exception 'list at least one official source before submitting' using errcode = '22023';
  end if;
  v_hash := app.shared_template_review_hash(v.id);
  perform set_config('app.shared_template_write', 'on', true);
  update public.shared_template_versions set
    submitted_at = statement_timestamp(),
    submitted_by = actor,
    submitted_review_hash = v_hash
  where id = v.id;
  perform app.record_audit_event(null, 'template.submitted_for_review', 'public.shared_template_versions', v.id, 'success',
    jsonb_build_object('version_number', v.version_number, 'by', actor, 'review_hash', v_hash));
  return jsonb_build_object('id', v.id, 'review_hash', v_hash, 'submitted_at', statement_timestamp());
end;
$$;
comment on function public.submit_shared_template_version(uuid, uuid) is
  'ADM-03: the admin portal (service role, naming a platform admin) submits a draft for review. Its content and sources are frozen until it is approved, rejected or withdrawn.';
revoke all on function public.submit_shared_template_version(uuid, uuid) from public, anon, authenticated;
grant execute on function public.submit_shared_template_version(uuid, uuid) to service_role;

create or replace function public.withdraw_shared_template_version(p_version_id uuid, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid;
  v public.shared_template_versions%rowtype;
begin
  if app.support_service_role() is distinct from true then
    raise exception 'template draft denied' using errcode = '42501';
  end if;
  actor := app.platform_ops_actor(p_actor);
  select * into v from public.shared_template_versions where id = p_version_id for update;
  if v.id is null or v.status <> 'draft' or v.submitted_at is null then
    raise exception 'that draft is not in review' using errcode = '22023';
  end if;
  perform set_config('app.shared_template_write', 'on', true);
  update public.shared_template_versions set
    submitted_at = null,
    submitted_by = null,
    submitted_review_hash = null
  where id = v.id;
  perform app.record_audit_event(null, 'template.review_withdrawn', 'public.shared_template_versions', v.id, 'success',
    jsonb_build_object('version_number', v.version_number, 'by', actor));
  return jsonb_build_object('id', v.id, 'status', 'draft');
end;
$$;
comment on function public.withdraw_shared_template_version(uuid, uuid) is
  'ADM-03: the admin portal (service role, naming a platform admin) takes a draft back out of review so it can be edited again.';
revoke all on function public.withdraw_shared_template_version(uuid, uuid) from public, anon, authenticated;
grant execute on function public.withdraw_shared_template_version(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Draft: the live title is not changed by opening a draft
-- ---------------------------------------------------------------------------
create or replace function public.draft_shared_template_version(
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
  on conflict (stable_key) do nothing
  returning id into v_template;
  if v_template is null then
    select id into v_template from public.shared_templates where stable_key = v_key for update;
    -- The title firms see follows the published version; a draft only names a template nothing has published yet.
    update public.shared_templates t set
      title = case
        when exists (
          select 1 from public.shared_template_versions lv
          where lv.template_id = t.id and lv.status in ('published', 'superseded', 'rolled_back')
        ) then t.title
        else v_title
      end,
      updated_at = now()
    where t.id = v_template;
  end if;
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
  'ADM-03: the admin portal (service role) opens a draft shared template version. It does not publish and does not change the live template title. The author must already be a platform admin. No platform_admins row is created here.';

revoke all on function public.draft_shared_template_version(text, text, text, jsonb, text, uuid, text, date, text) from public, anon, authenticated;
grant execute on function public.draft_shared_template_version(text, text, text, jsonb, text, uuid, text, date, text) to service_role;

-- ---------------------------------------------------------------------------
-- Approve
-- ---------------------------------------------------------------------------
create or replace function app.shared_template_approve(p_version_id uuid, p_expected_review_hash text)
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
  v_hash text;
begin
  reviewer := app.platform_template_reviewer();
  select * into v from public.shared_template_versions where id = p_version_id for update;
  if v.id is null or v.status <> 'draft' then
    raise exception 'nothing is waiting for review' using errcode = '22023';
  end if;
  if v.author_user_id = actor then
    raise exception 'the author cannot approve their own version' using errcode = '42501';
  end if;
  v_hash := app.shared_template_review_hash(v.id);
  if v.submitted_at is not null and v_hash is distinct from v.submitted_review_hash then
    raise exception 'the version changed after it was submitted for review' using errcode = 'PT409';
  end if;
  if p_expected_review_hash is not null and lower(btrim(p_expected_review_hash)) is distinct from v_hash then
    raise exception 'the version changed since it was reviewed; reload it' using errcode = 'PT409';
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
  update public.shared_templates set
    title = v.body ->> 'title',
    updated_at = now()
  where id = v.template_id;
  insert into public.shared_template_reviews (version_id, decision, reviewer_user_id, reviewer_label, licence_snapshot)
  values (v.id, 'approved', actor, reviewer ->> 'label', reviewer - 'label');
  perform app.notify_shared_template(v.id, 'published');
  perform app.record_audit_event(null, 'template.version_published', 'public.shared_template_versions', v.id, 'success',
    jsonb_build_object('version_number', v.version_number, 'reviewer', reviewer ->> 'label', 'supersedes', earlier.id,
      'review_hash', v_hash, 'submitted', v.submitted_at is not null, 'hash_bound', p_expected_review_hash is not null));
  return jsonb_build_object('id', v.id, 'status', 'published', 'version_number', v.version_number, 'review_hash', v_hash);
end;
$$;
revoke all on function app.shared_template_approve(uuid, text) from public;

create or replace function public.approve_shared_template_version(p_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return app.shared_template_approve(p_version_id, null);
end;
$$;
comment on function public.approve_shared_template_version(uuid) is
  'ADM-03: a licensed platform admin approves a draft with a fresh step-up and publishes it. A draft submitted for review is published only as submitted. The service role cannot call this. Firms are notified. Existing matter pins are not moved.';

revoke all on function public.approve_shared_template_version(uuid) from public, anon, service_role;
grant execute on function public.approve_shared_template_version(uuid) to authenticated;

create or replace function public.approve_shared_template_version(p_version_id uuid, p_expected_review_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_expected_review_hash is null or lower(btrim(p_expected_review_hash)) !~ '^[0-9a-f]{64}$' then
    raise exception 'the review hash is required' using errcode = '22023';
  end if;
  return app.shared_template_approve(p_version_id, p_expected_review_hash);
end;
$$;
comment on function public.approve_shared_template_version(uuid, text) is
  'ADM-03: as approve_shared_template_version(uuid), and refused unless the version still has the review hash the reviewer saw (public.shared_template_review_hash).';

revoke all on function public.approve_shared_template_version(uuid, text) from public, anon, service_role;
grant execute on function public.approve_shared_template_version(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Rollback: the live title follows the restored version
-- ---------------------------------------------------------------------------
create or replace function public.rollback_shared_template_version(p_version_id uuid, p_reason text)
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
    update public.shared_templates set
      title = earlier.body ->> 'title',
      updated_at = now()
    where id = v.template_id;
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
  'ADM-03: a licensed platform admin rolls back the published version with a step-up. The version it replaced is published again when it is still superseded, and the template title follows it. Matter pins stay. Firms are notified.';

revoke all on function public.rollback_shared_template_version(uuid, text) from public, anon, service_role;
grant execute on function public.rollback_shared_template_version(uuid, text) to authenticated;
