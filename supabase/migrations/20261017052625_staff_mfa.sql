-- Staff MFA (SEC-01, T006).
-- Supabase Auth sets the JWT `aal` claim to aal2 only after a second factor is verified.
-- Staff roles must present aal2. Portal roles are not forced.
-- Step-up for role and membership-status changes requires a recent TOTP method in `amr`
-- (product default: 15 minutes). Clients are not subject to that check.
-- Existing helpers are left in place (migrations cannot replace them). New checks are
-- restrictive policies plus BEFORE triggers, which AND with the policies already applied.
-- Additive only.

-- ---------------------------------------------------------------------------
-- Assurance helpers
-- ---------------------------------------------------------------------------
create function app.current_aal()
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when auth.jwt() ->> 'aal' = 'aal2' then 'aal2'
    else 'aal1'
  end;
$$;

create function app.staff_mfa_satisfied()
returns boolean
language sql
stable
set search_path = ''
as $$
  select app.current_aal() = 'aal2';
$$;

-- True when this session verified a TOTP factor within p_max_age.
-- String-only amr entries carry no timestamp, so they do not satisfy step-up.
create function app.mfa_step_up_satisfied(p_max_age interval default interval '15 minutes')
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  claims jsonb := auth.jwt();
  entry jsonb;
  ts numeric;
begin
  if claims is null or app.current_aal() is distinct from 'aal2' then
    return false;
  end if;
  if jsonb_typeof(claims -> 'amr') is distinct from 'array' then
    return false;
  end if;
  for entry in select value from jsonb_array_elements(claims -> 'amr') as t(value)
  loop
    if jsonb_typeof(entry) is distinct from 'object' or entry ->> 'method' is distinct from 'totp' then
      continue;
    end if;
    begin
      ts := nullif(entry ->> 'timestamp', '')::numeric;
    exception when others then
      ts := null;
    end;
    if ts is null then
      continue;
    end if;
    -- Accept seconds. A 13-digit value is milliseconds.
    if ts > 100000000000 then
      ts := ts / 1000.0;
    end if;
    if to_timestamp(ts) >= (statement_timestamp() - p_max_age)
       and to_timestamp(ts) <= statement_timestamp() + interval '60 seconds' then
      return true;
    end if;
  end loop;
  return false;
end;
$$;

revoke all on function app.current_aal() from public;
revoke all on function app.staff_mfa_satisfied() from public;
revoke all on function app.mfa_step_up_satisfied(interval) from public;
grant execute on function app.current_aal() to authenticated, service_role;
grant execute on function app.staff_mfa_satisfied() to authenticated, service_role;
grant execute on function app.mfa_step_up_satisfied(interval) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Staff membership writes
-- ---------------------------------------------------------------------------
-- Runs even for the table owner, so security-definer flows cannot skip it.
-- A session with no auth.uid() (migrations, service role) is not a user write.
create function app.guard_staff_membership_mfa()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  self_accept boolean := false;
begin
  if new.role <> all (app.staff_roles()) then
    return new;
  end if;
  if actor is null then
    return new;
  end if;
  if app.staff_mfa_satisfied() is distinct from true then
    raise exception 'staff membership changes require an authenticator assurance level of aal2'
      using errcode = '42501';
  end if;

  self_accept := tg_op = 'UPDATE'
    and old.status = 'invited'
    and new.status = 'active'
    and old.role is not distinct from new.role
    and old.user_id = actor
    and new.user_id = actor;

  if not self_accept
     and tg_op = 'UPDATE'
     and (old.role is distinct from new.role or old.status is distinct from new.status)
     and app.mfa_step_up_satisfied() is distinct from true then
    raise exception 'role and membership status changes require a recent TOTP step-up'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT'
     and new.user_id is distinct from actor
     and app.mfa_step_up_satisfied() is distinct from true then
    raise exception 'inviting a staff member requires a recent TOTP step-up'
      using errcode = '42501';
  end if;

  return new;
end;
$$;
revoke all on function app.guard_staff_membership_mfa() from public;

create trigger memberships_staff_mfa before insert or update on public.memberships
  for each row execute function app.guard_staff_membership_mfa();

-- ---------------------------------------------------------------------------
-- Restrictive policies (AND with the existing permissive policies).
-- A staff member at aal1 can still read their own membership and profile so they
-- can enroll. They cannot read colleagues, audit, or the outbox until aal2.
-- ---------------------------------------------------------------------------
create policy memberships_staff_reads_require_aal2 on public.memberships
  as restrictive
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or (select app.staff_mfa_satisfied())
  );

create policy memberships_insert_requires_step_up on public.memberships
  as restrictive
  for insert
  to authenticated
  with check (
    (select app.staff_mfa_satisfied())
    and (select app.mfa_step_up_satisfied())
  );

create policy memberships_update_requires_step_up on public.memberships
  as restrictive
  for update
  to authenticated
  using ((select app.mfa_step_up_satisfied()))
  with check ((select app.mfa_step_up_satisfied()));

create policy profiles_staff_reads_require_aal2 on public.profiles
  as restrictive
  for select
  to authenticated
  using (
    id = (select auth.uid())
    or (select app.staff_mfa_satisfied())
  );

create policy organizations_update_requires_aal2 on public.organizations
  as restrictive
  for update
  to authenticated
  using ((select app.staff_mfa_satisfied()))
  with check ((select app.staff_mfa_satisfied()));

create policy audit_log_select_requires_aal2 on public.audit_log
  as restrictive
  for select
  to authenticated
  using ((select app.staff_mfa_satisfied()));

create policy outbox_events_select_requires_aal2 on public.outbox_events
  as restrictive
  for select
  to authenticated
  using ((select app.staff_mfa_satisfied()));
