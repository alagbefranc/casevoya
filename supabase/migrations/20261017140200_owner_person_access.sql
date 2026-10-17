-- Firm-owner person access is assignment-based (PRD §5, DEC-006).
-- Directory-wide person reads are removed. The owner still administers the firm.
-- Break-glass is the audited emergency path: one person, 60 minutes, step-up,
-- read only. SEC-09's 60 minutes is the product duration used here.
-- Additive only. can_read_person and can_write_person are replaced in place.

create table public.person_break_glass (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  person_id uuid not null,
  actor_user_id uuid not null references auth.users (id),
  reason text not null check (length(btrim(reason)) between 8 and 500),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id),
  foreign key (person_id, organization_id) references public.persons (id, organization_id),
  check (expires_at > created_at)
);
comment on table public.person_break_glass is
  'Time-limited owner read of one person. Audited. Does not grant writes or directory access.';

create index person_break_glass_actor_idx
  on public.person_break_glass (actor_user_id, person_id)
  where revoked_at is null;
create index person_break_glass_created_by_idx on public.person_break_glass (created_by);

create trigger person_break_glass_touch before update on public.person_break_glass
  for each row execute function app.touch_row();
create trigger person_break_glass_immutable before update on public.person_break_glass
  for each row execute function app.guard_tenant_keys();
create trigger person_break_glass_stamp before insert on public.person_break_glass
  for each row execute function app.stamp_created_by();
create trigger person_break_glass_audit after insert or update or delete on public.person_break_glass
  for each row execute function app.audit_row_change();

create function app.break_glass_person_open(p_person_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.person_break_glass opened
    where opened.person_id = p_person_id
      and opened.actor_user_id = (select auth.uid())
      and opened.revoked_at is null
      and opened.expires_at > statement_timestamp()
  );
$$;

create or replace function app.can_read_person(p_person_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.persons p
    where p.id = p_person_id
      and app.in_active_org(p.organization_id)
      and (
        exists (
          select 1
          from public.matter_participants mp
          where mp.person_id = p.id
            and mp.organization_id = p.organization_id
            and app.actor_staff_assigned_to_matter(mp.matter_id, p.organization_id)
        )
        or (
          p.created_by = (select auth.uid())
          and app.staff_mfa_satisfied()
          and app.has_org_role(
            p.organization_id,
            array['licensed_consultant', 'case_manager']::public.org_role[]
          )
        )
        or p.user_id = (select auth.uid())
        or app.grant_allows(p.id, p.organization_id, null)
        or (
          app.staff_mfa_satisfied()
          and app.break_glass_person_open(p.id)
        )
      )
  );
$$;

create or replace function app.can_write_person(p_person_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.persons p
    where p.id = p_person_id
      and app.in_active_org(p.organization_id)
      and app.staff_mfa_satisfied()
      and (
        exists (
          select 1
          from public.matter_participants mp
          where mp.person_id = p.id
            and mp.organization_id = p.organization_id
            and app.actor_staff_assigned_to_matter(mp.matter_id, p.organization_id)
        )
        or (
          p.created_by = (select auth.uid())
          and app.has_org_role(
            p.organization_id,
            array['licensed_consultant', 'case_manager']::public.org_role[]
          )
        )
      )
  );
$$;

create function app.open_person_break_glass(p_person_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid;
  opened_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'sign in is required' using errcode = '42501';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 8 then
    raise exception 'break-glass access needs a reason' using errcode = '22023';
  end if;
  select p.organization_id into org
  from public.persons p
  where p.id = p_person_id;
  if org is null or app.in_active_org(org) is distinct from true then
    raise exception 'break-glass access denied' using errcode = '42501';
  end if;
  if app.actor_is_firm_owner(org) is distinct from true
     or app.mfa_step_up_satisfied() is distinct from true then
    raise exception 'break-glass access requires a firm owner and a recent step-up' using errcode = '42501';
  end if;

  insert into public.person_break_glass (
    organization_id, person_id, actor_user_id, reason, expires_at
  ) values (
    org,
    p_person_id,
    (select auth.uid()),
    btrim(p_reason),
    statement_timestamp() + interval '60 minutes'
  )
  returning id into opened_id;

  perform app.record_audit_event(
    org,
    'person.break_glass_opened',
    'public.persons',
    p_person_id,
    'success',
    jsonb_build_object('break_glass_id', opened_id, 'minutes', 60)
  );
  return opened_id;
end;
$$;

create function app.close_person_break_glass(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  row public.person_break_glass%rowtype;
begin
  select * into row from public.person_break_glass where id = p_id;
  if row.id is null then
    raise exception 'break-glass access denied' using errcode = '42501';
  end if;
  if row.actor_user_id is distinct from (select auth.uid())
     and (
       app.actor_is_firm_owner(row.organization_id) is distinct from true
       or app.mfa_step_up_satisfied() is distinct from true
     ) then
    raise exception 'break-glass access denied' using errcode = '42501';
  end if;
  if row.actor_user_id is distinct from (select auth.uid())
     and app.in_active_org(row.organization_id) is distinct from true then
    raise exception 'break-glass access denied' using errcode = '42501';
  end if;
  update public.person_break_glass
  set revoked_at = statement_timestamp()
  where id = p_id
    and revoked_at is null;
  perform app.record_audit_event(
    row.organization_id,
    'person.break_glass_closed',
    'public.person_break_glass',
    p_id,
    'success',
    '{}'::jsonb
  );
end;
$$;

create function public.open_person_break_glass(p_person_id uuid, p_reason text)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select app.open_person_break_glass(p_person_id, p_reason);
$$;

create function public.close_person_break_glass(p_id uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
  select app.close_person_break_glass(p_id);
$$;

revoke all on function app.break_glass_person_open(uuid) from public;
revoke all on function app.open_person_break_glass(uuid, text) from public;
revoke all on function app.close_person_break_glass(uuid) from public;
revoke all on function public.open_person_break_glass(uuid, text) from public, anon;
revoke all on function public.close_person_break_glass(uuid) from public, anon;
grant execute on function app.break_glass_person_open(uuid) to authenticated, service_role;
grant execute on function app.open_person_break_glass(uuid, text) to authenticated, service_role;
grant execute on function app.close_person_break_glass(uuid) to authenticated, service_role;
grant execute on function public.open_person_break_glass(uuid, text) to authenticated, service_role;
grant execute on function public.close_person_break_glass(uuid) to authenticated, service_role;

revoke all on table public.person_break_glass from anon, authenticated;
grant select on table public.person_break_glass to authenticated;

alter table public.person_break_glass enable row level security;
alter table public.person_break_glass force row level security;

create policy person_break_glass_select on public.person_break_glass
  for select to authenticated
  using (
    actor_user_id = (select auth.uid())
    or (select app.actor_is_firm_owner(organization_id))
  );
