-- ADM-04 (gap #186): service notices. Additive only.
--
-- Casevoya platform staff (public.platform_admins) post a maintenance, incident or information
-- notice to every firm or to listed firms. Staff of a reached firm read it (banner on every Sheet
-- page while it is current, and a history page); staff of other firms, client (portal) users and
-- anonymous callers read nothing. Each staff member can dismiss the banner for themselves; the
-- notice stays in the history.
--
-- Writes only through security definer functions: a signed-in platform admin at aal2 with a
-- recent step-up (like app.set_product_setting), or the service role naming the platform admin who
-- acts (scripts/ops/service-notice.mjs, like scripts/ops/import-cicc-list.mjs). Every write is
-- audited (app.record_audit_event). No notice is seeded.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.service_notices (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('maintenance', 'incident', 'info')),
  severity text not null default 'minor' check (severity in ('info', 'minor', 'major')),
  title text not null check (length(btrim(title)) between 3 and 120),
  -- Plain text, shown as text (never as HTML).
  body text not null check (length(btrim(body)) between 1 and 1000),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  status text not null default 'draft' check (status in ('draft', 'published', 'resolved')),
  audience text not null check (audience in ('all_firms', 'listed_firms')),
  published_at timestamptz,
  resolved_at timestamptz,
  resolved_by uuid references auth.users (id),
  resolution_note text check (resolution_note is null or length(btrim(resolution_note)) between 3 and 1000),
  created_by uuid not null references auth.users (id),
  updated_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1),
  constraint service_notices_window check (ends_at is null or ends_at > starts_at),
  constraint service_notices_maintenance_end check (kind <> 'maintenance' or ends_at is not null),
  constraint service_notices_published check (status = 'draft' or published_at is not null),
  constraint service_notices_resolved check (
    (status = 'resolved') = (resolved_at is not null)
    and (status <> 'resolved' or (resolution_note is not null and resolved_by is not null))
  )
);
comment on table public.service_notices is
  'ADM-04: maintenance / incident / information notices posted by Casevoya platform admins to all firms or listed firms. Staff of a reached firm read published and resolved notices; nothing else reads them.';

create index service_notices_status_idx on public.service_notices (status, starts_at desc);
create index service_notices_created_by_idx on public.service_notices (created_by);
create index service_notices_updated_by_idx on public.service_notices (updated_by);
create index service_notices_resolved_by_idx on public.service_notices (resolved_by);

create trigger service_notices_touch before update on public.service_notices
  for each row execute function app.touch_row();
create trigger service_notices_no_delete before delete on public.service_notices
  for each row execute function app.reject_governed_delete();
create trigger service_notices_no_truncate before truncate on public.service_notices
  for each statement execute function app.reject_governed_delete();

-- The firms a listed_firms notice reaches. An all_firms notice has no rows here.
create table public.service_notice_targets (
  notice_id uuid not null references public.service_notices (id),
  organization_id uuid not null references public.organizations (id),
  created_at timestamptz not null default now(),
  primary key (notice_id, organization_id)
);
comment on table public.service_notice_targets is
  'ADM-04: the firms a listed_firms service notice reaches. Staff of a firm read only their own firm''s rows.';
create index service_notice_targets_org_idx on public.service_notice_targets (organization_id);

create trigger service_notice_targets_no_delete before delete on public.service_notice_targets
  for each row execute function app.reject_governed_delete();
create trigger service_notice_targets_no_truncate before truncate on public.service_notice_targets
  for each statement execute function app.reject_governed_delete();

-- One staff member's "Dismiss" on the banner, in one firm. The notice stays in the history.
create table public.service_notice_dismissals (
  notice_id uuid not null references public.service_notices (id),
  organization_id uuid not null references public.organizations (id),
  user_id uuid not null references auth.users (id),
  dismissed_at timestamptz not null default now(),
  primary key (notice_id, organization_id, user_id)
);
comment on table public.service_notice_dismissals is
  'ADM-04: a staff member hid a service notice''s banner for themselves in one firm. History is unaffected.';
create index service_notice_dismissals_org_idx on public.service_notice_dismissals (organization_id);
create index service_notice_dismissals_user_idx on public.service_notice_dismissals (user_id);

alter table public.service_notices enable row level security;
alter table public.service_notices force row level security;
alter table public.service_notice_targets enable row level security;
alter table public.service_notice_targets force row level security;
alter table public.service_notice_dismissals enable row level security;
alter table public.service_notice_dismissals force row level security;

revoke all on table public.service_notices from public, anon, authenticated, service_role;
revoke all on table public.service_notice_targets from public, anon, authenticated, service_role;
revoke all on table public.service_notice_dismissals from public, anon, authenticated, service_role;
grant select on table public.service_notices to authenticated, service_role;
grant select on table public.service_notice_targets to authenticated, service_role;
grant select on table public.service_notice_dismissals to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Who a notice reaches
-- ---------------------------------------------------------------------------
create function app.service_notice_reaches(p_notice_id uuid, p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_org is not null
     and exists (
       select 1
       from public.service_notices n
       where n.id = p_notice_id
         and (
           n.audience = 'all_firms'
           or exists (
             select 1 from public.service_notice_targets t
             where t.notice_id = n.id and t.organization_id = p_org
           )
         )
     );
$$;
comment on function app.service_notice_reaches(uuid, uuid) is
  'True when the notice is for all firms or lists this firm. Says nothing about status or who is asking.';
revoke all on function app.service_notice_reaches(uuid, uuid) from public, anon;
grant execute on function app.service_notice_reaches(uuid, uuid) to authenticated, service_role;

-- Staff (aal2) of the workspace in use, for a notice that reaches it. Never client users.
create function app.can_read_service_notice(p_notice_id uuid, p_status text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_status in ('published', 'resolved')
     and app.current_organization_id() is not null
     and app.is_org_staff(app.current_organization_id())
     and app.staff_mfa_satisfied()
     and app.service_notice_reaches(p_notice_id, app.current_organization_id());
$$;
revoke all on function app.can_read_service_notice(uuid, text) from public, anon;
grant execute on function app.can_read_service_notice(uuid, text) to authenticated, service_role;

create policy service_notices_select on public.service_notices
  for select to authenticated
  using ((select app.is_platform_admin()) or app.can_read_service_notice(id, status));

create policy service_notice_targets_select on public.service_notice_targets
  for select to authenticated
  using (
    (select app.is_platform_admin())
    or (
      organization_id = (select app.current_organization_id())
      and (select app.is_org_staff(organization_id))
    )
  );

create policy service_notice_dismissals_select on public.service_notice_dismissals
  for select to authenticated
  using (
    user_id = (select auth.uid())
    and organization_id = (select app.current_organization_id())
  );

-- The service role reads for the ops script's list (it bypasses RLS on hosted Supabase; this
-- keeps the same answer where it does not).
create policy service_notices_service_select on public.service_notices
  for select to service_role using (true);
create policy service_notice_targets_service_select on public.service_notice_targets
  for select to service_role using (true);

-- ---------------------------------------------------------------------------
-- Platform admin writes
-- ---------------------------------------------------------------------------
-- A signed-in platform admin at aal2 with a recent step-up, or the service role naming the
-- platform admin who acts. Firm staff never.
create function app.service_notice_actor(p_acting_admin uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null then
    if app.is_platform_admin() is distinct from true
       or app.mfa_step_up_satisfied() is distinct from true then
      raise exception 'service notices require a platform admin step-up' using errcode = '42501';
    end if;
    return (select auth.uid());
  end if;
  if app.current_actor_type() is distinct from 'service' then
    raise exception 'service notices require a platform admin' using errcode = '42501';
  end if;
  if p_acting_admin is null
     or not exists (select 1 from public.platform_admins pa where pa.user_id = p_acting_admin) then
    raise exception 'name the platform admin who posts the notice' using errcode = '22023';
  end if;
  return p_acting_admin;
end;
$$;
revoke all on function app.service_notice_actor(uuid) from public, anon;

create function app.post_service_notice(
  p_kind text,
  p_severity text,
  p_title text,
  p_body text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_organization_ids uuid[],
  p_publish boolean,
  p_acting_admin uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := app.service_notice_actor(p_acting_admin);
  posted_id uuid;
  firms uuid[];
  reach text;
  begins timestamptz := coalesce(p_starts_at, now());
begin
  if p_kind is null or p_kind not in ('maintenance', 'incident', 'info') then
    raise exception 'kind must be maintenance, incident or info' using errcode = '22023';
  end if;
  if coalesce(p_severity, 'minor') not in ('info', 'minor', 'major') then
    raise exception 'severity must be info, minor or major' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_title, ''))) not between 3 and 120 then
    raise exception 'the title is 3 to 120 characters' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_body, ''))) not between 1 and 1000 then
    raise exception 'the notice text is 1 to 1000 characters' using errcode = '22023';
  end if;
  if p_kind = 'maintenance' and p_ends_at is null then
    raise exception 'maintenance needs an end time' using errcode = '22023';
  end if;
  if p_ends_at is not null and p_ends_at <= begins then
    raise exception 'the end time is after the start time' using errcode = '22023';
  end if;
  if p_organization_ids is null then
    reach := 'all_firms';
  else
    select array_agg(distinct f) into firms from unnest(p_organization_ids) f where f is not null;
    if firms is null or cardinality(firms) = 0 then
      raise exception 'list at least one firm, or post to all firms' using errcode = '22023';
    end if;
    if cardinality(firms) > 1000 then
      raise exception 'list at most 1000 firms' using errcode = '22023';
    end if;
    if exists (select 1 from unnest(firms) f where not exists (select 1 from public.organizations o where o.id = f)) then
      raise exception 'a listed firm does not exist' using errcode = '22023';
    end if;
    reach := 'listed_firms';
  end if;

  insert into public.service_notices (
    kind, severity, title, body, starts_at, ends_at, status, audience, published_at, created_by, updated_by
  )
  values (
    p_kind,
    coalesce(p_severity, 'minor'),
    btrim(p_title),
    btrim(p_body),
    begins,
    p_ends_at,
    case when coalesce(p_publish, false) then 'published' else 'draft' end,
    reach,
    case when coalesce(p_publish, false) then now() else null end,
    actor,
    actor
  )
  returning id into posted_id;

  if reach = 'listed_firms' then
    insert into public.service_notice_targets (notice_id, organization_id)
    select posted_id, f from unnest(firms) f;
  end if;

  perform app.record_audit_event(
    null,
    case when coalesce(p_publish, false) then 'service_notice.published' else 'service_notice.drafted' end,
    'public.service_notices',
    posted_id,
    'success',
    jsonb_build_object(
      'acting_admin', actor,
      'kind', p_kind,
      'severity', coalesce(p_severity, 'minor'),
      'audience', reach,
      'firms', coalesce(to_jsonb(firms), '[]'::jsonb),
      'starts_at', begins,
      'ends_at', p_ends_at
    )
  );
  return posted_id;
end;
$$;
revoke all on function app.post_service_notice(text, text, text, text, timestamptz, timestamptz, uuid[], boolean, uuid) from public, anon;

-- Change a draft or published notice's wording, severity or times, or publish a draft. Null
-- leaves a field as it is. The audience is fixed once posted: post a new notice instead.
create function app.update_service_notice(
  p_notice_id uuid,
  p_severity text,
  p_title text,
  p_body text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_publish boolean,
  p_acting_admin uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := app.service_notice_actor(p_acting_admin);
  cur public.service_notices%rowtype;
  next_severity text;
  next_title text;
  next_body text;
  next_starts timestamptz;
  next_ends timestamptz;
  publishing boolean;
  changed text[] := '{}';
begin
  select * into cur from public.service_notices where id = p_notice_id for update;
  if cur.id is null then
    raise exception 'service notice not found' using errcode = 'P0002';
  end if;
  if cur.status = 'resolved' then
    raise exception 'a resolved notice cannot change; post a new one' using errcode = '22023';
  end if;
  next_severity := coalesce(p_severity, cur.severity);
  next_title := coalesce(nullif(btrim(coalesce(p_title, '')), ''), cur.title);
  next_body := coalesce(nullif(btrim(coalesce(p_body, '')), ''), cur.body);
  next_starts := coalesce(p_starts_at, cur.starts_at);
  next_ends := coalesce(p_ends_at, cur.ends_at);
  publishing := cur.status = 'draft' and coalesce(p_publish, false);
  if next_severity not in ('info', 'minor', 'major') then
    raise exception 'severity must be info, minor or major' using errcode = '22023';
  end if;
  if length(next_title) not between 3 and 120 then
    raise exception 'the title is 3 to 120 characters' using errcode = '22023';
  end if;
  if length(next_body) > 1000 then
    raise exception 'the notice text is 1 to 1000 characters' using errcode = '22023';
  end if;
  if next_ends is not null and next_ends <= next_starts then
    raise exception 'the end time is after the start time' using errcode = '22023';
  end if;
  if next_severity is distinct from cur.severity then changed := array_append(changed, 'severity'); end if;
  if next_title is distinct from cur.title then changed := array_append(changed, 'title'); end if;
  if next_body is distinct from cur.body then changed := array_append(changed, 'body'); end if;
  if next_starts is distinct from cur.starts_at then changed := array_append(changed, 'starts_at'); end if;
  if next_ends is distinct from cur.ends_at then changed := array_append(changed, 'ends_at'); end if;
  if publishing then changed := array_append(changed, 'status'); end if;
  if cardinality(changed) = 0 then
    return cur.id;
  end if;
  update public.service_notices
     set severity = next_severity,
         title = next_title,
         body = next_body,
         starts_at = next_starts,
         ends_at = next_ends,
         status = case when publishing then 'published' else status end,
         published_at = case when publishing then now() else published_at end,
         updated_by = actor
   where id = cur.id;
  perform app.record_audit_event(
    null,
    case when publishing then 'service_notice.published' else 'service_notice.updated' end,
    'public.service_notices',
    cur.id,
    'success',
    jsonb_build_object('acting_admin', actor, 'changed', to_jsonb(changed))
  );
  return cur.id;
end;
$$;
revoke all on function app.update_service_notice(uuid, text, text, text, timestamptz, timestamptz, boolean, uuid) from public, anon;

-- Resolve a published notice with a note firms read in the history. The banner goes away.
create function app.resolve_service_notice(p_notice_id uuid, p_resolution_note text, p_acting_admin uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := app.service_notice_actor(p_acting_admin);
  cur public.service_notices%rowtype;
begin
  select * into cur from public.service_notices where id = p_notice_id for update;
  if cur.id is null then
    raise exception 'service notice not found' using errcode = 'P0002';
  end if;
  if cur.status = 'resolved' then
    return cur.id;
  end if;
  if cur.status <> 'published' then
    raise exception 'only a published notice is resolved' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_resolution_note, ''))) not between 3 and 1000 then
    raise exception 'say how it was resolved (3 to 1000 characters)' using errcode = '22023';
  end if;
  update public.service_notices
     set status = 'resolved',
         resolved_at = now(),
         resolved_by = actor,
         resolution_note = btrim(p_resolution_note),
         updated_by = actor
   where id = cur.id;
  perform app.record_audit_event(
    null, 'service_notice.resolved', 'public.service_notices', cur.id, 'success',
    jsonb_build_object('acting_admin', actor)
  );
  return cur.id;
end;
$$;
revoke all on function app.resolve_service_notice(uuid, text, uuid) from public, anon;

-- ---------------------------------------------------------------------------
-- Staff: dismiss the banner for yourself, in the workspace in use
-- ---------------------------------------------------------------------------
create function app.dismiss_service_notice(p_notice_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  org uuid := app.current_organization_id();
  cur public.service_notices%rowtype;
begin
  if actor is null or org is null or app.is_org_staff(org) is distinct from true
     or app.staff_mfa_satisfied() is distinct from true then
    raise exception 'service notice dismissal denied' using errcode = '42501';
  end if;
  select * into cur from public.service_notices where id = p_notice_id;
  if cur.id is null or cur.status = 'draft' or app.service_notice_reaches(cur.id, org) is distinct from true then
    raise exception 'service notice not found' using errcode = 'P0002';
  end if;
  insert into public.service_notice_dismissals (notice_id, organization_id, user_id)
  values (cur.id, org, actor)
  on conflict do nothing;
  if found then
    perform app.record_audit_event(
      org, 'service_notice.dismissed', 'public.service_notices', cur.id, 'success', '{}'::jsonb
    );
  end if;
  return true;
end;
$$;
revoke all on function app.dismiss_service_notice(uuid) from public, anon;

-- ---------------------------------------------------------------------------
-- Public wrappers (security invoker) and grants.
-- ---------------------------------------------------------------------------
create function public.post_service_notice(
  p_kind text,
  p_severity text,
  p_title text,
  p_body text,
  p_starts_at timestamptz default null,
  p_ends_at timestamptz default null,
  p_organization_ids uuid[] default null,
  p_publish boolean default true,
  p_acting_admin uuid default null
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select app.post_service_notice(p_kind, p_severity, p_title, p_body, p_starts_at, p_ends_at, p_organization_ids, p_publish, p_acting_admin);
$$;

create function public.update_service_notice(
  p_notice_id uuid,
  p_severity text default null,
  p_title text default null,
  p_body text default null,
  p_starts_at timestamptz default null,
  p_ends_at timestamptz default null,
  p_publish boolean default false,
  p_acting_admin uuid default null
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select app.update_service_notice(p_notice_id, p_severity, p_title, p_body, p_starts_at, p_ends_at, p_publish, p_acting_admin);
$$;

create function public.resolve_service_notice(p_notice_id uuid, p_resolution_note text, p_acting_admin uuid default null)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select app.resolve_service_notice(p_notice_id, p_resolution_note, p_acting_admin);
$$;

create function public.dismiss_service_notice(p_notice_id uuid)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  select app.dismiss_service_notice(p_notice_id);
$$;

revoke all on function public.post_service_notice(text, text, text, text, timestamptz, timestamptz, uuid[], boolean, uuid) from public, anon;
revoke all on function public.update_service_notice(uuid, text, text, text, timestamptz, timestamptz, boolean, uuid) from public, anon;
revoke all on function public.resolve_service_notice(uuid, text, uuid) from public, anon;
revoke all on function public.dismiss_service_notice(uuid) from public, anon;

grant execute on function app.service_notice_actor(uuid) to authenticated, service_role;
grant execute on function app.post_service_notice(text, text, text, text, timestamptz, timestamptz, uuid[], boolean, uuid) to authenticated, service_role;
grant execute on function app.update_service_notice(uuid, text, text, text, timestamptz, timestamptz, boolean, uuid) to authenticated, service_role;
grant execute on function app.resolve_service_notice(uuid, text, uuid) to authenticated, service_role;
grant execute on function app.dismiss_service_notice(uuid) to authenticated;

grant execute on function public.post_service_notice(text, text, text, text, timestamptz, timestamptz, uuid[], boolean, uuid) to authenticated, service_role;
grant execute on function public.update_service_notice(uuid, text, text, text, timestamptz, timestamptz, boolean, uuid) to authenticated, service_role;
grant execute on function public.resolve_service_notice(uuid, text, uuid) to authenticated, service_role;
grant execute on function public.dismiss_service_notice(uuid) to authenticated;
