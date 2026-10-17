-- Casevoya foundation: append-only audit log (SEC-04, T008)
-- Every material mutation on tenancy tables is recorded with actor, tenant, object, action,
-- time, result, request id and a redacted diff. Rows can never be updated, deleted or truncated
-- by any API role, and triggers reject those operations even for privileged roles.
-- Additive only.

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id),
  occurred_at timestamptz not null default clock_timestamp(),
  actor_user_id uuid references auth.users (id),
  actor_type text not null check (actor_type in ('user', 'system', 'service')),
  db_role text not null default current_user,
  action text not null check (action ~ '^[a-z][a-z0-9_.]{1,80}$'),
  object_table text,
  object_id uuid,
  result text not null default 'success' check (result in ('success', 'denied', 'failure')),
  request_id text check (request_id is null or length(request_id) <= 200),
  diff jsonb not null default '{}'::jsonb,
  context jsonb not null default '{}'::jsonb
);
comment on table public.audit_log is 'Append-only audit trail. diff values for sensitive columns are redacted. Never updated or deleted.';

create index audit_log_org_time_idx on public.audit_log (organization_id, occurred_at desc);
create index audit_log_object_idx on public.audit_log (object_table, object_id, occurred_at desc);
create index audit_log_actor_idx on public.audit_log (actor_user_id, occurred_at desc);

-- ---------------------------------------------------------------------------
-- Append-only enforcement
-- ---------------------------------------------------------------------------
create function app.reject_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_log is append-only (% rejected)', tg_op using errcode = '42501';
end;
$$;
revoke all on function app.reject_audit_mutation() from public;

create trigger audit_log_no_update_delete before update or delete on public.audit_log
  for each row execute function app.reject_audit_mutation();
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function app.reject_audit_mutation();

-- ---------------------------------------------------------------------------
-- Request correlation id: transaction-local app.request_id, else x-request-id header.
-- ---------------------------------------------------------------------------
create function app.current_request_id()
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  rid text;
begin
  rid := nullif(current_setting('app.request_id', true), '');
  if rid is null then
    begin
      rid := nullif((nullif(current_setting('request.headers', true), '')::json ->> 'x-request-id'), '');
    exception when others then
      rid := null;
    end;
  end if;
  return left(rid, 200);
end;
$$;
revoke all on function app.current_request_id() from public;
grant execute on function app.current_request_id() to authenticated, service_role;

create function app.current_actor_type()
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when (select auth.uid()) is not null then 'user'
    when nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role' = 'service_role' then 'service'
    else 'system'
  end;
$$;
revoke all on function app.current_actor_type() from public;

-- ---------------------------------------------------------------------------
-- Row-change audit trigger.
-- TG_ARGV: column names whose values must be redacted in the diff.
-- INSERT/DELETE store the row; UPDATE stores only changed columns as {old,new}.
-- ---------------------------------------------------------------------------
create function app.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_row jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end;
  new_row jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end;
  ref_row jsonb := coalesce(new_row, old_row);
  redacted text[] := coalesce(tg_argv::text[], array[]::text[]);
  ignored text[] := array['updated_at', 'version'];
  d jsonb := '{}'::jsonb;
  k text;
  org uuid;
begin
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(new_row) loop
      if k = any (ignored) then
        continue;
      end if;
      if (old_row -> k) is distinct from (new_row -> k) then
        if k = any (redacted) then
          d := d || jsonb_build_object(k, jsonb_build_object('old', '[redacted]', 'new', '[redacted]'));
        else
          d := d || jsonb_build_object(k, jsonb_build_object('old', old_row -> k, 'new', new_row -> k));
        end if;
      end if;
    end loop;
    if d = '{}'::jsonb then
      return null; -- no material change
    end if;
  else
    d := ref_row;
    foreach k in array redacted loop
      if d ? k then
        d := jsonb_set(d, array[k], '"[redacted]"'::jsonb);
      end if;
    end loop;
  end if;

  if tg_table_name = 'organizations' then
    org := (ref_row ->> 'id')::uuid;
  elsif ref_row ? 'organization_id' then
    org := (ref_row ->> 'organization_id')::uuid;
  end if;

  insert into public.audit_log (organization_id, actor_user_id, actor_type, action, object_table, object_id, request_id, diff)
  values (
    org,
    (select auth.uid()),
    app.current_actor_type(),
    tg_table_name || '.' || lower(tg_op),
    tg_table_schema || '.' || tg_table_name,
    case when ref_row ? 'id' then (ref_row ->> 'id')::uuid end,
    app.current_request_id(),
    d
  );
  return null;
end;
$$;
revoke all on function app.audit_row_change() from public;

create trigger organizations_audit after insert or update or delete on public.organizations
  for each row execute function app.audit_row_change();
create trigger memberships_audit after insert or update or delete on public.memberships
  for each row execute function app.audit_row_change();
create trigger profiles_audit after insert or update or delete on public.profiles
  for each row execute function app.audit_row_change('display_name');

-- ---------------------------------------------------------------------------
-- Explicit domain audit events (sensitive reads, downloads, denied access, exports...).
-- The actor is always the authenticated caller; it cannot be supplied.
-- ---------------------------------------------------------------------------
create function app.record_audit_event(
  p_organization_id uuid,
  p_action text,
  p_object_table text default null,
  p_object_id uuid default null,
  p_result text default 'success',
  p_context jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  rid uuid;
begin
  if (select auth.uid()) is not null
     and p_organization_id is not null
     and not app.is_org_member(p_organization_id) then
    raise exception 'not a member of organization' using errcode = '42501';
  end if;
  insert into public.audit_log (organization_id, actor_user_id, actor_type, action, object_table, object_id, result, request_id, context)
  values (
    p_organization_id,
    (select auth.uid()),
    app.current_actor_type(),
    p_action,
    p_object_table,
    p_object_id,
    p_result,
    app.current_request_id(),
    coalesce(p_context, '{}'::jsonb)
  )
  returning id into rid;
  return rid;
end;
$$;
revoke all on function app.record_audit_event(uuid, text, text, uuid, text, jsonb) from public;
grant execute on function app.record_audit_event(uuid, text, text, uuid, text, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Privileges and RLS: firm owners can read their firm's audit trail. Nobody writes directly.
-- ---------------------------------------------------------------------------
revoke all on table public.audit_log from anon, authenticated, service_role;
grant select on table public.audit_log to authenticated, service_role;

alter table public.audit_log enable row level security;
alter table public.audit_log force row level security;

create policy audit_log_select_owner on public.audit_log
  for select to authenticated
  using (
    organization_id is not null
    and (select app.has_org_role(organization_id, array['firm_owner']::public.org_role[]))
  );
