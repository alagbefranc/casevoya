-- Admin portal Config editing (casevoya-admin Config page: Settings, Switches, Feature flags).
-- Owner-only, step-up-checked SECURITY DEFINER functions that validate each editable product setting by
-- its rule (boolean, number range, enum, duration, text), record every change in platform_config_changes
-- (with a one-step revert) and in audit_log. Adds global feature flags with per-firm overrides.
-- Settings that are not listed in product_setting_rules stay migration-only.

-- 1. Per-setting edit rules. A setting with no rule is read-only in the portal.
create table public.product_setting_rules (
  key text primary key references public.product_settings (key) on delete cascade,
  kind text not null check (kind in ('boolean', 'number', 'enum', 'duration', 'text')),
  field text check (field is null or field ~ '^[a-z_]{1,40}$'),
  min_value numeric,
  max_value numeric,
  choices text[],
  units text[],
  max_length integer check (max_length is null or max_length between 1 and 2000),
  pattern text,
  danger text not null default 'none' check (danger in ('none', 'caution', 'critical')),
  danger_note text,
  check ((kind = 'duration') = (field is null)),
  check (kind <> 'number' or (min_value is not null and max_value is not null and min_value <= max_value)),
  check (kind <> 'enum' or coalesce(array_length(choices, 1), 0) > 0),
  check (kind <> 'duration' or coalesce(array_length(units, 1), 0) > 0),
  check (kind <> 'text' or max_length is not null)
);
alter table public.product_setting_rules enable row level security;
alter table public.product_setting_rules force row level security;
revoke all on public.product_setting_rules from public, anon, authenticated;
grant select on public.product_setting_rules to authenticated, service_role;
create policy product_setting_rules_select on public.product_setting_rules
  for select to authenticated using ((select app.is_platform_admin()));

-- 2. Global feature flags and per-firm overrides.
create table public.feature_flags (
  key text primary key check (key ~ '^[a-z][a-z0-9_.]{1,80}$'),
  description text not null check (length(description) between 3 and 500),
  enabled boolean not null default false,
  danger text not null default 'none' check (danger in ('none', 'caution', 'critical')),
  danger_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  updated_by uuid references auth.users (id) on delete set null,
  version integer not null default 1
);
alter table public.feature_flags enable row level security;
alter table public.feature_flags force row level security;
revoke all on public.feature_flags from public, anon, authenticated;
grant select on public.feature_flags to authenticated, service_role;
create policy feature_flags_select on public.feature_flags for select to authenticated using (true);

create table public.feature_flag_overrides (
  flag_key text not null references public.feature_flags (key) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  enabled boolean not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  updated_by uuid references auth.users (id) on delete set null,
  primary key (flag_key, organization_id)
);
create index feature_flag_overrides_org_idx on public.feature_flag_overrides (organization_id);
alter table public.feature_flag_overrides enable row level security;
alter table public.feature_flag_overrides force row level security;
revoke all on public.feature_flag_overrides from public, anon, authenticated;
grant select on public.feature_flag_overrides to authenticated, service_role;
create policy feature_flag_overrides_select on public.feature_flag_overrides for select to authenticated
  using ((select app.is_platform_admin()) or (select app.is_org_member(organization_id)));

-- 3. Change history: what changed, from what, to what, by whom, why. Written only by the functions below.
create table public.platform_config_changes (
  id uuid primary key default gen_random_uuid(),
  target text not null check (target in ('setting', 'flag', 'flag_override')),
  config_key text not null,
  organization_id uuid references public.organizations (id) on delete cascade,
  old_value jsonb,
  new_value jsonb,
  reason text not null check (length(reason) between 3 and 500),
  actor_user_id uuid references auth.users (id) on delete set null,
  reverts_change_id uuid references public.platform_config_changes (id) on delete set null,
  created_at timestamptz not null default clock_timestamp()
);
create index platform_config_changes_key_idx on public.platform_config_changes (target, config_key, organization_id, created_at desc);
alter table public.platform_config_changes enable row level security;
alter table public.platform_config_changes force row level security;
revoke all on public.platform_config_changes from public, anon, authenticated;
grant select on public.platform_config_changes to authenticated, service_role;
create policy platform_config_changes_select on public.platform_config_changes for select to authenticated
  using ((select app.is_platform_admin()));

-- 4. Seeds. Harmless probes for testing that a portal change reaches the app, then rules for the
-- settings that are safe to edit. Everything else (legal text, addresses and domains, plans and Stripe
-- prices, multi-field limits, reminder lists) stays migration-only.
insert into public.product_settings (key, value, description, pending_confirmation)
values ('platform.config_probe', '{"enabled": false}'::jsonb,
  'No effect anywhere. Used to check that a change made in the admin portal reaches the app.', false)
on conflict (key) do nothing;

insert into public.feature_flags (key, description, enabled)
values ('platform.config_probe', 'No effect anywhere. Used to check that a flag change made in the admin portal reaches the app.', false)
on conflict (key) do nothing;

insert into public.product_setting_rules (key, kind, field, min_value, max_value, units, danger, danger_note)
select r.key, r.kind, r.field, r.min_value, r.max_value, r.units, r.danger, r.danger_note
from (values
  ('platform.config_probe', 'boolean', 'enabled', null::numeric, null::numeric, null::text[], 'none', null::text),
  ('documents.accept_structural_inspection', 'boolean', 'enabled', null, null, null, 'critical',
    'On means uploads are marked clean after a type and size check only, with no malware scan.'),
  ('documents.large_uploads_enabled', 'boolean', 'enabled', null, null, null, 'critical',
    'On lets firms upload files above 25 MB before storage, scanning and backups are validated for them.'),
  ('agreements.envelope_days', 'number', 'days', 1, 365, null, 'none', null),
  ('agreements.quote_days', 'number', 'days', 1, 365, null, 'none', null),
  ('documents.max_upload_bytes', 'number', 'bytes', 1048576, 104857600, null, 'caution',
    'Larger files take longer to scan. The ceiling is 100 MB.'),
  ('documents.signed_url_seconds', 'number', 'seconds', 30, 900, null, 'caution',
    'Download links stay usable for this long after an authorization check.'),
  ('documents.upload_intent_seconds', 'number', 'seconds', 60, 3600, null, 'none', null),
  ('email.inbound_hourly_limit', 'number', 'messages', 1, 1000, null, 'none', null),
  ('email.inbound_attachment_bytes', 'number', 'bytes_per_hour', 1048576, 5368709120, null, 'none', null),
  ('trial.duration', 'duration', null, null, null, array['days', 'months'], 'caution',
    'New trials use this length. Existing trials keep their end date.'),
  ('licence.recheck_interval', 'duration', null, null, null, array['days', 'months'], 'none', null),
  ('licence.manual_check_target', 'duration', null, null, null, array['business_days'], 'none', null),
  ('source.recheck_interval.checklist', 'duration', null, null, null, array['days', 'months'], 'none', null),
  ('source.recheck_interval.fee', 'duration', null, null, null, array['days', 'months'], 'none', null),
  ('source.recheck_interval.form', 'duration', null, null, null, array['days', 'months'], 'none', null),
  ('source.recheck_interval.law', 'duration', null, null, null, array['days', 'months'], 'none', null),
  ('source.recheck_interval.program', 'duration', null, null, null, array['days', 'months'], 'none', null)
) as r(key, kind, field, min_value, max_value, units, danger, danger_note)
join public.product_settings s on s.key = r.key
on conflict (key) do nothing;

-- 5. Helpers.
create or replace function app.platform_config_owner()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if app.is_platform_admin() is distinct from true or app.mfa_step_up_satisfied() is distinct from true then
    raise exception 'config changes require a platform admin step-up' using errcode = '42501';
  end if;
  if app.platform_admin_has_role(array['owner']) is distinct from true then
    raise exception 'only platform owners can change config' using errcode = '42501';
  end if;
  return (select auth.uid());
end;
$$;

create or replace function app.platform_config_reason(p_reason text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  r text := btrim(coalesce(p_reason, ''));
begin
  if length(r) < 3 or length(r) > 500 then
    raise exception 'give a reason of 3 to 500 characters' using errcode = '22023';
  end if;
  return r;
end;
$$;

-- Validates p_input against the rule and returns the whole new value (other fields kept).
create or replace function app.product_setting_next_value(p_rule public.product_setting_rules, p_current jsonb, p_input jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  unit text;
  n numeric;
  t text;
begin
  if p_rule.kind = 'duration' then
    if p_input is null or jsonb_typeof(p_input) <> 'object' or (select count(*) from jsonb_object_keys(p_input)) <> 2
       or jsonb_typeof(p_input -> 'unit') is distinct from 'string' or jsonb_typeof(p_input -> 'count') is distinct from 'number' then
      raise exception 'a duration is {unit, count}' using errcode = '22023';
    end if;
    unit := p_input ->> 'unit';
    n := (p_input ->> 'count')::numeric;
    if not (unit = any (p_rule.units)) then
      raise exception '% uses %', p_rule.key, array_to_string(p_rule.units, ' or ') using errcode = '22023';
    end if;
    if n <> trunc(n) or n < 1 or n > 3650 then
      raise exception 'the count is a whole number from 1 to 3650' using errcode = '22023';
    end if;
    return jsonb_build_object('unit', unit, 'count', n::integer);
  end if;

  if p_rule.kind = 'boolean' then
    if jsonb_typeof(p_input) is distinct from 'boolean' then
      raise exception 'the value is true or false' using errcode = '22023';
    end if;
    return coalesce(p_current, '{}'::jsonb) || jsonb_build_object(p_rule.field, p_input);
  elsif p_rule.kind = 'number' then
    if jsonb_typeof(p_input) is distinct from 'number' then
      raise exception 'the value is a number' using errcode = '22023';
    end if;
    n := (p_input #>> '{}')::numeric;
    if n <> trunc(n) or n < p_rule.min_value or n > p_rule.max_value then
      raise exception 'the value is a whole number from % to %', p_rule.min_value, p_rule.max_value using errcode = '22023';
    end if;
    return coalesce(p_current, '{}'::jsonb) || jsonb_build_object(p_rule.field, n::bigint);
  elsif p_rule.kind = 'enum' then
    if jsonb_typeof(p_input) is distinct from 'string' or not ((p_input #>> '{}') = any (p_rule.choices)) then
      raise exception 'the value is one of %', array_to_string(p_rule.choices, ', ') using errcode = '22023';
    end if;
    return coalesce(p_current, '{}'::jsonb) || jsonb_build_object(p_rule.field, p_input #>> '{}');
  elsif p_rule.kind = 'text' then
    if jsonb_typeof(p_input) is distinct from 'string' then
      raise exception 'the value is text' using errcode = '22023';
    end if;
    t := btrim(p_input #>> '{}');
    if length(t) < 1 or length(t) > p_rule.max_length then
      raise exception 'the text is 1 to % characters', p_rule.max_length using errcode = '22023';
    end if;
    if p_rule.pattern is not null and t !~ p_rule.pattern then
      raise exception 'the text is not in the expected format' using errcode = '22023';
    end if;
    return coalesce(p_current, '{}'::jsonb) || jsonb_build_object(p_rule.field, t);
  end if;
  raise exception 'unknown setting kind' using errcode = '22023';
end;
$$;

-- 6. Change a product setting (Settings and Switches tabs).
create or replace function public.admin_config_set_setting(
  p_key text, p_value jsonb, p_expected_version integer, p_reason text, p_confirm text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := app.platform_config_owner();
  why text := app.platform_config_reason(p_reason);
  rule public.product_setting_rules;
  cur public.product_settings;
  next_value jsonb;
  change_id uuid;
  new_version integer;
begin
  select * into cur from public.product_settings where key = p_key for update;
  if not found then
    raise exception 'unknown product setting' using errcode = 'P0002';
  end if;
  select * into rule from public.product_setting_rules where key = p_key;
  if not found then
    raise exception 'this setting changes only through a reviewed migration' using errcode = '55000';
  end if;
  if p_expected_version is distinct from cur.version then
    raise exception 'stale version' using errcode = 'PT409';
  end if;
  next_value := app.product_setting_next_value(rule, cur.value, p_value);
  if next_value = cur.value then
    raise exception 'that is already the value' using errcode = '22023';
  end if;
  if rule.danger = 'critical' and p_confirm is distinct from p_key then
    raise exception 'type the setting key to confirm this change' using errcode = '22023';
  end if;
  update public.product_settings set value = next_value where key = p_key returning version into new_version;
  insert into public.platform_config_changes (target, config_key, old_value, new_value, reason, actor_user_id)
  values ('setting', p_key, cur.value, next_value, why, actor)
  returning id into change_id;
  perform app.record_audit_event(null, 'product.setting_changed', 'public.product_settings', change_id, 'success',
    jsonb_build_object('key', p_key, 'before', cur.value, 'after', next_value, 'reason', why, 'danger', rule.danger));
  return jsonb_build_object('change_id', change_id, 'key', p_key, 'before', cur.value, 'after', next_value, 'version', new_version);
end;
$$;

-- 7. Change a feature flag's global default.
create or replace function public.admin_config_set_flag(
  p_key text, p_enabled boolean, p_expected_version integer, p_reason text, p_confirm text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := app.platform_config_owner();
  why text := app.platform_config_reason(p_reason);
  cur public.feature_flags;
  change_id uuid;
  new_version integer;
begin
  if p_enabled is null then
    raise exception 'the value is true or false' using errcode = '22023';
  end if;
  select * into cur from public.feature_flags where key = p_key for update;
  if not found then
    raise exception 'unknown feature flag' using errcode = 'P0002';
  end if;
  if p_expected_version is distinct from cur.version then
    raise exception 'stale version' using errcode = 'PT409';
  end if;
  if p_enabled = cur.enabled then
    raise exception 'that is already the value' using errcode = '22023';
  end if;
  if cur.danger = 'critical' and p_confirm is distinct from p_key then
    raise exception 'type the flag key to confirm this change' using errcode = '22023';
  end if;
  update public.feature_flags
     set enabled = p_enabled, updated_at = now(), updated_by = actor, version = version + 1
   where key = p_key
  returning version into new_version;
  insert into public.platform_config_changes (target, config_key, old_value, new_value, reason, actor_user_id)
  values ('flag', p_key, to_jsonb(cur.enabled), to_jsonb(p_enabled), why, actor)
  returning id into change_id;
  perform app.record_audit_event(null, 'product.flag_changed', 'public.feature_flags', change_id, 'success',
    jsonb_build_object('key', p_key, 'before', cur.enabled, 'after', p_enabled, 'reason', why));
  return jsonb_build_object('change_id', change_id, 'key', p_key, 'before', cur.enabled, 'after', p_enabled, 'version', new_version);
end;
$$;

-- 8. Set or clear (p_enabled null) one firm's override of a flag.
create or replace function public.admin_config_set_flag_override(
  p_key text, p_organization_id uuid, p_enabled boolean, p_reason text, p_confirm text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := app.platform_config_owner();
  why text := app.platform_config_reason(p_reason);
  flag public.feature_flags;
  before_value boolean;
  change_id uuid;
begin
  select * into flag from public.feature_flags where key = p_key for update;
  if not found then
    raise exception 'unknown feature flag' using errcode = 'P0002';
  end if;
  if p_organization_id is null or not exists (select 1 from public.organizations o where o.id = p_organization_id) then
    raise exception 'unknown firm' using errcode = '22023';
  end if;
  select enabled into before_value from public.feature_flag_overrides where flag_key = p_key and organization_id = p_organization_id;
  if before_value is not distinct from p_enabled then
    raise exception 'that is already the value' using errcode = '22023';
  end if;
  if flag.danger = 'critical' and p_confirm is distinct from p_key then
    raise exception 'type the flag key to confirm this change' using errcode = '22023';
  end if;
  if p_enabled is null then
    delete from public.feature_flag_overrides where flag_key = p_key and organization_id = p_organization_id;
  else
    insert into public.feature_flag_overrides (flag_key, organization_id, enabled, updated_by)
    values (p_key, p_organization_id, p_enabled, actor)
    on conflict (flag_key, organization_id) do update set enabled = excluded.enabled, updated_at = now(), updated_by = actor;
  end if;
  insert into public.platform_config_changes (target, config_key, organization_id, old_value, new_value, reason, actor_user_id)
  values ('flag_override', p_key, p_organization_id, to_jsonb(before_value), to_jsonb(p_enabled), why, actor)
  returning id into change_id;
  perform app.record_audit_event(p_organization_id, 'product.flag_override_changed', 'public.feature_flag_overrides', change_id, 'success',
    jsonb_build_object('key', p_key, 'before', before_value, 'after', p_enabled, 'reason', why));
  return jsonb_build_object('change_id', change_id, 'key', p_key, 'organization_id', p_organization_id, 'before', before_value, 'after', p_enabled);
end;
$$;

-- 9. One-step revert: puts back the value a change replaced, if nothing changed since. No typed
-- confirmation, so a dangerous switch can always be turned back at once.
create or replace function public.admin_config_revert(p_change_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := app.platform_config_owner();
  why text := app.platform_config_reason(p_reason);
  ch public.platform_config_changes;
  latest uuid;
  cur jsonb;
  change_id uuid;
begin
  select * into ch from public.platform_config_changes where id = p_change_id;
  if not found then
    raise exception 'unknown change' using errcode = 'P0002';
  end if;
  select id into latest from public.platform_config_changes
   where target = ch.target and config_key = ch.config_key and organization_id is not distinct from ch.organization_id
   order by created_at desc, id desc limit 1;
  if latest is distinct from ch.id then
    raise exception 'only the latest change can be reverted' using errcode = '55000';
  end if;

  if ch.target = 'setting' then
    select value into cur from public.product_settings where key = ch.config_key for update;
    if cur is distinct from ch.new_value then
      raise exception 'the value changed since; reload' using errcode = 'PT409';
    end if;
    if not exists (select 1 from public.product_setting_rules where key = ch.config_key) then
      raise exception 'this setting changes only through a reviewed migration' using errcode = '55000';
    end if;
    update public.product_settings set value = ch.old_value where key = ch.config_key;
  elsif ch.target = 'flag' then
    select to_jsonb(enabled) into cur from public.feature_flags where key = ch.config_key for update;
    if cur is distinct from ch.new_value then
      raise exception 'the value changed since; reload' using errcode = 'PT409';
    end if;
    update public.feature_flags
       set enabled = (ch.old_value #>> '{}')::boolean, updated_at = now(), updated_by = actor, version = version + 1
     where key = ch.config_key;
  else
    select to_jsonb(enabled) into cur from public.feature_flag_overrides
     where flag_key = ch.config_key and organization_id = ch.organization_id for update;
    if coalesce(cur, 'null'::jsonb) is distinct from coalesce(ch.new_value, 'null'::jsonb) then
      raise exception 'the value changed since; reload' using errcode = 'PT409';
    end if;
    if ch.old_value is null or ch.old_value = 'null'::jsonb then
      delete from public.feature_flag_overrides where flag_key = ch.config_key and organization_id = ch.organization_id;
    else
      insert into public.feature_flag_overrides (flag_key, organization_id, enabled, updated_by)
      values (ch.config_key, ch.organization_id, (ch.old_value #>> '{}')::boolean, actor)
      on conflict (flag_key, organization_id) do update set enabled = excluded.enabled, updated_at = now(), updated_by = actor;
    end if;
  end if;

  insert into public.platform_config_changes (target, config_key, organization_id, old_value, new_value, reason, actor_user_id, reverts_change_id)
  values (ch.target, ch.config_key, ch.organization_id, ch.new_value, ch.old_value, why, actor, ch.id)
  returning id into change_id;
  perform app.record_audit_event(ch.organization_id, 'product.config_reverted', 'public.platform_config_changes', change_id, 'success',
    jsonb_build_object('key', ch.config_key, 'target', ch.target, 'before', ch.new_value, 'after', ch.old_value, 'reverts', ch.id, 'reason', why));
  return jsonb_build_object('change_id', change_id, 'key', ch.config_key, 'target', ch.target, 'before', ch.new_value, 'after', ch.old_value);
end;
$$;

-- 10. How the app reads a flag: the caller's firm override, else the global default, else false.
create or replace function app.feature_flag_enabled(p_key text, p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select o.enabled from public.feature_flag_overrides o where o.flag_key = p_key and o.organization_id = p_organization_id),
    (select f.enabled from public.feature_flags f where f.key = p_key),
    false
  );
$$;

create or replace function public.feature_flag_enabled(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.feature_flag_enabled(p_key, app.current_organization_id());
$$;

revoke all on function app.platform_config_owner() from public, anon, authenticated;
revoke all on function app.platform_config_reason(text) from public, anon, authenticated;
revoke all on function app.product_setting_next_value(public.product_setting_rules, jsonb, jsonb) from public, anon, authenticated;
revoke all on function app.feature_flag_enabled(text, uuid) from public, anon, authenticated;
grant execute on function app.feature_flag_enabled(text, uuid) to service_role;
revoke all on function public.admin_config_set_setting(text, jsonb, integer, text, text) from public, anon;
revoke all on function public.admin_config_set_flag(text, boolean, integer, text, text) from public, anon;
revoke all on function public.admin_config_set_flag_override(text, uuid, boolean, text, text) from public, anon;
revoke all on function public.admin_config_revert(uuid, text) from public, anon;
revoke all on function public.feature_flag_enabled(text) from public, anon;
grant execute on function public.admin_config_set_setting(text, jsonb, integer, text, text) to authenticated;
grant execute on function public.admin_config_set_flag(text, boolean, integer, text, text) to authenticated;
grant execute on function public.admin_config_set_flag_override(text, uuid, boolean, text, text) to authenticated;
grant execute on function public.admin_config_revert(uuid, text) to authenticated;
grant execute on function public.feature_flag_enabled(text) to authenticated, service_role;
