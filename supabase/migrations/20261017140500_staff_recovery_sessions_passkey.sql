-- T006 remainder: recovery codes, session revocation, owner MFA reset, passkey step-up.
-- Supabase Auth raises aal2 for totp, mfa/webauthn, and mfa/recovery_code.
-- Discoverable passkey sign-in stays aal1 and records amr method "passkey".
-- A fresh passkey amr entry therefore satisfies staff assurance and step-up here.
-- Application recovery codes are hashed, single-use, and bound to the JWT session
-- so a passkey-only user can still pass step-up. Native mfa/recovery_code is also accepted.
-- Login rate limits are still open.

create table public.session_revocations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id),
  session_id uuid not null,
  revoked_by uuid not null references auth.users (id),
  organization_id uuid references public.organizations (id),
  reason text check (reason is null or length(reason) <= 500),
  created_at timestamptz not null default now(),
  unique (user_id, session_id)
);
comment on table public.session_revocations is
  'A revoked JWT session id stops reading and writing tenant data. The Auth row is deleted when auth.sessions exists.';

create index session_revocations_user_idx on public.session_revocations (user_id);

create table public.auth_session_cutoffs (
  user_id uuid primary key references auth.users (id),
  sessions_valid_after timestamptz not null,
  updated_at timestamptz not null default now()
);
comment on table public.auth_session_cutoffs is
  'Tokens whose iat is earlier than this instant are refused. Set by an owner MFA reset.';

create table public.mfa_recovery_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id),
  code_hash text not null,
  batch_id uuid not null,
  used_at timestamptz,
  retired_at timestamptz,
  created_at timestamptz not null default now()
);
comment on table public.mfa_recovery_codes is
  'sha256 of a single-use recovery code. Plaintext is returned once and is never stored.';

create index mfa_recovery_codes_user_idx on public.mfa_recovery_codes (user_id, created_at desc);

create table public.mfa_recovery_attempts (
  user_id uuid primary key references auth.users (id),
  failures integer not null default 0 check (failures >= 0),
  locked_until timestamptz
);

create table public.mfa_assurance_proofs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id),
  session_id uuid not null,
  method text not null check (method = 'recovery_code'),
  created_at timestamptz not null default now()
);
comment on table public.mfa_assurance_proofs is
  'Session-bound proof that a recovery code was consumed. Step-up lasts 15 minutes; staff assurance lasts for the session.';

create index mfa_assurance_proofs_session_idx
  on public.mfa_assurance_proofs (user_id, session_id, created_at desc);

create trigger mfa_recovery_codes_audit after insert or update or delete on public.mfa_recovery_codes
  for each row execute function app.audit_row_change('code_hash');
create trigger session_revocations_audit after insert or update or delete on public.session_revocations
  for each row execute function app.audit_row_change();

revoke all on table public.session_revocations from anon, authenticated, service_role;
revoke all on table public.auth_session_cutoffs from anon, authenticated, service_role;
revoke all on table public.mfa_recovery_codes from anon, authenticated, service_role;
revoke all on table public.mfa_recovery_attempts from anon, authenticated, service_role;
revoke all on table public.mfa_assurance_proofs from anon, authenticated, service_role;

alter table public.session_revocations enable row level security;
alter table public.session_revocations force row level security;
alter table public.auth_session_cutoffs enable row level security;
alter table public.auth_session_cutoffs force row level security;
alter table public.mfa_recovery_codes enable row level security;
alter table public.mfa_recovery_codes force row level security;
alter table public.mfa_recovery_attempts enable row level security;
alter table public.mfa_recovery_attempts force row level security;
alter table public.mfa_assurance_proofs enable row level security;
alter table public.mfa_assurance_proofs force row level security;

create function app.current_session_id()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  raw text := auth.jwt() ->> 'session_id';
begin
  if raw is null or btrim(raw) = '' then
    return null;
  end if;
  return raw::uuid;
exception when others then
  return null;
end;
$$;

create function app.jwt_iat()
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  raw text := auth.jwt() ->> 'iat';
  ts numeric;
begin
  if raw is null or btrim(raw) = '' then
    return null;
  end if;
  ts := raw::numeric;
  if ts > 100000000000 then
    ts := ts / 1000.0;
  end if;
  return to_timestamp(ts);
exception when others then
  return null;
end;
$$;

create function app.session_is_revoked()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  sid uuid := app.current_session_id();
  issued timestamptz := app.jwt_iat();
  cutoff timestamptz;
begin
  if uid is null then
    return false;
  end if;
  if sid is not null and exists (
    select 1
    from public.session_revocations revoked
    where revoked.user_id = uid
      and revoked.session_id = sid
  ) then
    return true;
  end if;
  select c.sessions_valid_after into cutoff
  from public.auth_session_cutoffs c
  where c.user_id = uid;
  if cutoff is null then
    return false;
  end if;
  if issued is null then
    return true;
  end if;
  return issued < cutoff;
end;
$$;

create function app.amr_method_fresh(p_method text, p_max_age interval)
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
  if claims is null or jsonb_typeof(claims -> 'amr') is distinct from 'array' then
    return false;
  end if;
  for entry in select value from jsonb_array_elements(claims -> 'amr') as t(value)
  loop
    if jsonb_typeof(entry) is distinct from 'object' or entry ->> 'method' is distinct from p_method then
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
    if ts > 100000000000 then
      ts := ts / 1000.0;
    end if;
    if to_timestamp(ts) > statement_timestamp() + interval '60 seconds' then
      continue;
    end if;
    if p_max_age is null or to_timestamp(ts) >= statement_timestamp() - p_max_age then
      return true;
    end if;
  end loop;
  return false;
end;
$$;

create function app.passkey_session_active()
returns boolean
language sql
stable
set search_path = ''
as $$
  select app.amr_method_fresh('passkey', null);
$$;

create function app.recovery_assurance_active(p_max_age interval)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.mfa_assurance_proofs proof
    where proof.user_id = (select auth.uid())
      and proof.session_id = app.current_session_id()
      and proof.method = 'recovery_code'
      and (p_max_age is null or proof.created_at >= statement_timestamp() - p_max_age)
  );
$$;

create or replace function app.staff_mfa_satisfied()
returns boolean
language sql
stable
set search_path = ''
as $$
  select not app.session_is_revoked()
     and (
       app.current_aal() = 'aal2'
       or app.passkey_session_active()
       or app.recovery_assurance_active(null)
     );
$$;

create or replace function app.mfa_step_up_satisfied(p_max_age interval default interval '15 minutes')
returns boolean
language plpgsql
stable
set search_path = ''
as $$
begin
  if app.session_is_revoked() then
    return false;
  end if;
  if app.amr_method_fresh('passkey', p_max_age) then
    return true;
  end if;
  if app.current_aal() = 'aal2' and (
    app.amr_method_fresh('totp', p_max_age)
    or app.amr_method_fresh('mfa/webauthn', p_max_age)
    or app.amr_method_fresh('mfa/recovery_code', p_max_age)
  ) then
    return true;
  end if;
  return app.recovery_assurance_active(p_max_age);
end;
$$;

create function app.purge_auth_user_factors(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'auth' and table_name = 'mfa_challenges' and column_name = 'factor_id'
  ) and to_regclass('auth.mfa_factors') is not null then
    execute 'delete from auth.mfa_challenges where factor_id in (select id from auth.mfa_factors where user_id = $1)'
      using p_user_id;
  end if;
  if to_regclass('auth.mfa_amr_claims') is not null and to_regclass('auth.sessions') is not null then
    execute 'delete from auth.mfa_amr_claims where session_id in (select id from auth.sessions where user_id = $1)'
      using p_user_id;
  end if;
  if to_regclass('auth.sessions') is not null then
    execute 'delete from auth.sessions where user_id = $1' using p_user_id;
  end if;
  if to_regclass('auth.mfa_factors') is not null then
    execute 'delete from auth.mfa_factors where user_id = $1' using p_user_id;
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'auth' and table_name = 'webauthn_credentials' and column_name = 'user_id'
  ) then
    execute 'delete from auth.webauthn_credentials where user_id = $1' using p_user_id;
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'auth' and table_name = 'webauthn_challenges' and column_name = 'user_id'
  ) then
    execute 'delete from auth.webauthn_challenges where user_id = $1' using p_user_id;
  end if;
end;
$$;

create function app.hash_recovery_code(p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(
    extensions.digest(convert_to(upper(regexp_replace(coalesce(p_code, ''), '[[:space:]-]', '', 'g')), 'utf8'), 'sha256'),
    'hex'
  );
$$;

create function app.generate_recovery_codes()
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  batch uuid := gen_random_uuid();
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  codes text[] := array[]::text[];
  raw text;
  grouped text;
  i integer;
  n integer;
  byte integer;
  org uuid;
begin
  if uid is null or app.mfa_step_up_satisfied() is distinct from true then
    raise exception 'recovery codes require a recent step-up' using errcode = '42501';
  end if;
  update public.mfa_recovery_codes
  set retired_at = statement_timestamp()
  where user_id = uid
    and retired_at is null
    and used_at is null;

  for i in 1..10 loop
    raw := '';
    for n in 1..20 loop
      byte := get_byte(extensions.gen_random_bytes(1), 0);
      raw := raw || substr(alphabet, 1 + (byte % 32), 1);
    end loop;
    grouped := substr(raw, 1, 4) || '-' || substr(raw, 5, 4) || '-' || substr(raw, 9, 4)
      || '-' || substr(raw, 13, 4) || '-' || substr(raw, 17, 4);
    insert into public.mfa_recovery_codes (user_id, code_hash, batch_id)
    values (uid, app.hash_recovery_code(raw), batch);
    codes := codes || grouped;
  end loop;

  org := app.current_organization_id();
  perform app.record_audit_event(
    org,
    'mfa.recovery_codes_generated',
    'public.mfa_recovery_codes',
    batch,
    'success',
    jsonb_build_object('count', 10)
  );
  return codes;
end;
$$;

-- Returns false, rather than raising, when the code is wrong, locked, retired, or
-- the session is missing. A raise would roll the failure counter back with the
-- transaction, so the lockout would never stick.
create function app.consume_recovery_code(p_code text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  sid uuid := app.current_session_id();
  hashed text := app.hash_recovery_code(p_code);
  code_id uuid;
  locked timestamptz;
  failures integer;
  org uuid;
begin
  if uid is null or sid is null or app.session_is_revoked() then
    return false;
  end if;

  select attempts.locked_until, attempts.failures
    into locked, failures
  from public.mfa_recovery_attempts attempts
  where attempts.user_id = uid
  for update;

  if locked is not null and locked > statement_timestamp() then
    return false;
  end if;

  select codes.id into code_id
  from public.mfa_recovery_codes codes
  where codes.user_id = uid
    and codes.code_hash = hashed
    and codes.used_at is null
    and codes.retired_at is null
  for update;

  org := app.current_organization_id();
  if code_id is null then
    failures := coalesce(failures, 0) + 1;
    insert into public.mfa_recovery_attempts (user_id, failures, locked_until)
    values (
      uid,
      failures,
      case when failures >= 5 then statement_timestamp() + interval '15 minutes' else null end
    )
    on conflict (user_id) do update
      set failures = excluded.failures,
          locked_until = excluded.locked_until;
    perform app.record_audit_event(
      org, 'mfa.recovery_code_rejected', 'public.mfa_recovery_codes', null, 'failure',
      jsonb_build_object('locked', failures >= 5)
    );
    return false;
  end if;

  update public.mfa_recovery_codes
  set used_at = statement_timestamp()
  where id = code_id;

  insert into public.mfa_recovery_attempts (user_id, failures, locked_until)
  values (uid, 0, null)
  on conflict (user_id) do update
    set failures = 0,
        locked_until = null;

  insert into public.mfa_assurance_proofs (user_id, session_id, method)
  values (uid, sid, 'recovery_code');

  perform app.record_audit_event(
    org, 'mfa.recovery_code_consumed', 'public.mfa_recovery_codes', code_id, 'success', '{}'::jsonb
  );
  return true;
end;
$$;

create function app.revoke_my_session(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  other uuid;
begin
  if uid is null or p_session_id is null then
    raise exception 'session revocation denied' using errcode = '42501';
  end if;
  if to_regclass('auth.sessions') is not null then
    execute 'select user_id from auth.sessions where id = $1'
      into other
      using p_session_id;
    if other is not null and other is distinct from uid then
      raise exception 'session revocation denied' using errcode = '42501';
    end if;
    execute 'delete from auth.sessions where id = $1 and user_id = $2'
      using p_session_id, uid;
  end if;
  insert into public.session_revocations (user_id, session_id, revoked_by, organization_id, reason)
  values (uid, p_session_id, uid, app.current_organization_id(), 'self')
  on conflict (user_id, session_id) do nothing;
  perform app.record_audit_event(
    app.current_organization_id(),
    'mfa.session_revoked',
    'auth.sessions',
    p_session_id,
    'success',
    jsonb_build_object('scope', 'self')
  );
end;
$$;

create function app.revoke_other_sessions()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  current_sid uuid := app.current_session_id();
  removed integer := 0;
begin
  if uid is null then
    raise exception 'session revocation denied' using errcode = '42501';
  end if;
  if to_regclass('auth.sessions') is null then
    raise exception 'session inventory is unavailable' using errcode = '42501';
  end if;
  execute $sql$
    with doomed as (
      select id from auth.sessions
      where user_id = $1
        and id is distinct from $2
    ),
    marked as (
      insert into public.session_revocations (user_id, session_id, revoked_by, organization_id, reason)
      select $1, doomed.id, $1, app.current_organization_id(), 'others'
      from doomed
      on conflict (user_id, session_id) do nothing
      returning session_id
    )
    delete from auth.sessions s
    using doomed
    where s.id = doomed.id
    returning s.id
  $sql$
  using uid, current_sid;
  get diagnostics removed = row_count;
  perform app.record_audit_event(
    app.current_organization_id(),
    'mfa.sessions_revoked',
    'auth.sessions',
    uid,
    'success',
    jsonb_build_object('scope', 'others', 'count', removed)
  );
  return removed;
end;
$$;

create function app.list_my_sessions()
returns table (
  session_id uuid,
  created_at timestamptz,
  refreshed_at timestamptz,
  user_agent text,
  aal text,
  revoked boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null or to_regclass('auth.sessions') is null then
    return;
  end if;
  return query execute $sql$
    select s.id, s.created_at, s.refreshed_at, s.user_agent, s.aal::text,
           exists (
             select 1 from public.session_revocations r
             where r.user_id = s.user_id and r.session_id = s.id
           ) as revoked
    from auth.sessions s
    where s.user_id = $1
    order by s.created_at desc
  $sql$
  using uid;
end;
$$;

create function app.reset_staff_mfa(p_organization_id uuid, p_target_user_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'mfa reset denied' using errcode = '42501';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 8 then
    raise exception 'mfa reset needs a reason' using errcode = '22023';
  end if;
  if p_target_user_id is not distinct from (select auth.uid()) then
    raise exception 'use your own authenticator or a recovery code' using errcode = '42501';
  end if;
  if app.in_active_org(p_organization_id) is distinct from true
     or app.actor_is_firm_owner(p_organization_id) is distinct from true
     or app.mfa_step_up_satisfied() is distinct from true then
    raise exception 'mfa reset requires a firm owner and a recent step-up' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.memberships mem
    where mem.organization_id = p_organization_id
      and mem.user_id = p_target_user_id
      and mem.status in ('invited', 'active', 'suspended')
      and mem.role = any (app.staff_roles())
  ) then
    raise exception 'mfa reset denied' using errcode = '42501';
  end if;

  update public.mfa_recovery_codes
  set retired_at = statement_timestamp()
  where user_id = p_target_user_id
    and retired_at is null;

  insert into public.auth_session_cutoffs (user_id, sessions_valid_after)
  values (p_target_user_id, clock_timestamp())
  on conflict (user_id) do update
    set sessions_valid_after = excluded.sessions_valid_after,
        updated_at = statement_timestamp();

  if to_regclass('auth.sessions') is not null then
    execute $sql$
      insert into public.session_revocations (user_id, session_id, revoked_by, organization_id, reason)
      select s.user_id, s.id, $2, $3, 'owner_reset'
      from auth.sessions s
      where s.user_id = $1
      on conflict (user_id, session_id) do nothing
    $sql$
    using p_target_user_id, (select auth.uid()), p_organization_id;
  end if;

  perform app.purge_auth_user_factors(p_target_user_id);

  perform app.record_audit_event(
    p_organization_id,
    'mfa.staff_reset',
    'auth.users',
    p_target_user_id,
    'success',
    jsonb_build_object('reason_length', length(btrim(p_reason)))
  );
end;
$$;

create function public.session_mfa_satisfied()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select app.staff_mfa_satisfied();
$$;

create function public.generate_recovery_codes()
returns text[]
language sql
security invoker
set search_path = ''
as $$
  select app.generate_recovery_codes();
$$;

create function public.consume_recovery_code(p_code text)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  select app.consume_recovery_code(p_code);
$$;

create function public.revoke_my_session(p_session_id uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
  select app.revoke_my_session(p_session_id);
$$;

create function public.revoke_other_sessions()
returns integer
language sql
security invoker
set search_path = ''
as $$
  select app.revoke_other_sessions();
$$;

create function public.list_my_sessions()
returns table (
  session_id uuid,
  created_at timestamptz,
  refreshed_at timestamptz,
  user_agent text,
  aal text,
  revoked boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from app.list_my_sessions();
$$;

create function public.reset_staff_mfa(p_organization_id uuid, p_target_user_id uuid, p_reason text)
returns void
language sql
security invoker
set search_path = ''
as $$
  select app.reset_staff_mfa(p_organization_id, p_target_user_id, p_reason);
$$;

revoke all on function app.current_session_id() from public;
revoke all on function app.jwt_iat() from public;
revoke all on function app.session_is_revoked() from public;
revoke all on function app.amr_method_fresh(text, interval) from public;
revoke all on function app.passkey_session_active() from public;
revoke all on function app.recovery_assurance_active(interval) from public;
revoke all on function app.purge_auth_user_factors(uuid) from public;
revoke all on function app.hash_recovery_code(text) from public;
revoke all on function app.generate_recovery_codes() from public;
revoke all on function app.consume_recovery_code(text) from public;
revoke all on function app.revoke_my_session(uuid) from public;
revoke all on function app.revoke_other_sessions() from public;
revoke all on function app.list_my_sessions() from public;
revoke all on function app.reset_staff_mfa(uuid, uuid, text) from public;

revoke all on function public.session_mfa_satisfied() from public, anon;
revoke all on function public.generate_recovery_codes() from public, anon;
revoke all on function public.consume_recovery_code(text) from public, anon;
revoke all on function public.revoke_my_session(uuid) from public, anon;
revoke all on function public.revoke_other_sessions() from public, anon;
revoke all on function public.list_my_sessions() from public, anon;
revoke all on function public.reset_staff_mfa(uuid, uuid, text) from public, anon;

grant execute on function app.current_session_id() to authenticated, service_role;
grant execute on function app.jwt_iat() to authenticated, service_role;
grant execute on function app.session_is_revoked() to authenticated, service_role;
grant execute on function app.amr_method_fresh(text, interval) to authenticated, service_role;
grant execute on function app.passkey_session_active() to authenticated, service_role;
grant execute on function app.recovery_assurance_active(interval) to authenticated, service_role;
grant execute on function app.generate_recovery_codes() to authenticated, service_role;
grant execute on function app.consume_recovery_code(text) to authenticated, service_role;
grant execute on function app.revoke_my_session(uuid) to authenticated, service_role;
grant execute on function app.revoke_other_sessions() to authenticated, service_role;
grant execute on function app.list_my_sessions() to authenticated, service_role;
grant execute on function app.reset_staff_mfa(uuid, uuid, text) to authenticated, service_role;

grant execute on function public.session_mfa_satisfied() to authenticated, service_role;
grant execute on function public.generate_recovery_codes() to authenticated, service_role;
grant execute on function public.consume_recovery_code(text) to authenticated, service_role;
grant execute on function public.revoke_my_session(uuid) to authenticated, service_role;
grant execute on function public.revoke_other_sessions() to authenticated, service_role;
grant execute on function public.list_my_sessions() to authenticated, service_role;
grant execute on function public.reset_staff_mfa(uuid, uuid, text) to authenticated, service_role;

-- Revoked sessions cannot use tenant tables, including portal reads that do not check staff MFA.
create policy organizations_session_not_revoked on public.organizations
  as restrictive for all to authenticated
  using (not (select app.session_is_revoked()))
  with check (not (select app.session_is_revoked()));
create policy profiles_session_not_revoked on public.profiles
  as restrictive for all to authenticated
  using (not (select app.session_is_revoked()))
  with check (not (select app.session_is_revoked()));
create policy memberships_session_not_revoked on public.memberships
  as restrictive for all to authenticated
  using (not (select app.session_is_revoked()))
  with check (not (select app.session_is_revoked()));
create policy audit_log_session_not_revoked on public.audit_log
  as restrictive for all to authenticated
  using (not (select app.session_is_revoked()))
  with check (not (select app.session_is_revoked()));
create policy outbox_events_session_not_revoked on public.outbox_events
  as restrictive for all to authenticated
  using (not (select app.session_is_revoked()))
  with check (not (select app.session_is_revoked()));
create policy invitations_session_not_revoked on public.invitations
  as restrictive for all to authenticated
  using (not (select app.session_is_revoked()))
  with check (not (select app.session_is_revoked()));
create policy persons_session_not_revoked on public.persons
  as restrictive for all to authenticated
  using (not (select app.session_is_revoked()))
  with check (not (select app.session_is_revoked()));
create policy matters_session_not_revoked on public.matters
  as restrictive for all to authenticated
  using (not (select app.session_is_revoked()))
  with check (not (select app.session_is_revoked()));
create policy matter_participants_session_not_revoked on public.matter_participants
  as restrictive for all to authenticated
  using (not (select app.session_is_revoked()))
  with check (not (select app.session_is_revoked()));
create policy households_session_not_revoked on public.households
  as restrictive for all to authenticated
  using (not (select app.session_is_revoked()))
  with check (not (select app.session_is_revoked()));
create policy household_members_session_not_revoked on public.household_members
  as restrictive for all to authenticated
  using (not (select app.session_is_revoked()))
  with check (not (select app.session_is_revoked()));
create policy person_relationships_session_not_revoked on public.person_relationships
  as restrictive for all to authenticated
  using (not (select app.session_is_revoked()))
  with check (not (select app.session_is_revoked()));
create policy access_grants_session_not_revoked on public.access_grants
  as restrictive for all to authenticated
  using (not (select app.session_is_revoked()))
  with check (not (select app.session_is_revoked()));
create policy webhook_inbox_session_not_revoked on public.webhook_inbox
  as restrictive for all to authenticated
  using (not (select app.session_is_revoked()))
  with check (not (select app.session_is_revoked()));
create policy person_break_glass_session_not_revoked on public.person_break_glass
  as restrictive for all to authenticated
  using (not (select app.session_is_revoked()))
  with check (not (select app.session_is_revoked()));
create policy matter_stage_evidence_session_not_revoked on public.matter_stage_evidence
  as restrictive for all to authenticated
  using (not (select app.session_is_revoked()))
  with check (not (select app.session_is_revoked()));
create policy matter_stage_transitions_session_not_revoked on public.matter_stage_transitions
  as restrictive for all to authenticated
  using (not (select app.session_is_revoked()))
  with check (not (select app.session_is_revoked()));
