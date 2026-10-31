-- Auth attempt limits, round 2 (security review: auth limits).
--
-- 1. Recovery codes: a 'recovery' kind in app.auth_attempts. app.consume_recovery_code (latest
--    from 20261017140500) now runs under a per-user transaction lock and refuses once the user has
--    5 rejected codes in 15 minutes, counted from app.auth_attempts (key sha256('recovery:' ||
--    user id)), so parallel or direct RPC calls are bound too. The existing
--    public.mfa_recovery_attempts lockout is unchanged and still applies.
-- 2. public.auth_attempt_reserve (latest from 20261031100000): for password and otp the per-email
--    limit no longer refuses by itself. Past it (50 / 20 in 15 minutes), each (email, address)
--    allows fewer attempts (password 3, otp 2) instead of 10 / 5, so a correct sign-in from an
--    address that has not been failing still goes through. totp and email_send are unchanged.
-- 3. public.hook_mfa_verification_attempt(event): a Supabase Auth "MFA verification attempt" hook,
--    counting failed second-factor verifications per user ('mfa_verify', 5 in 15 minutes) and
--    rejecting further verifications (also correct ones) until the window passes. Executable only
--    by supabase_auth_admin. Not active until enabled in the Supabase dashboard (docs/DEPLOY.md).
--
-- Additive: the kind check is widened, three functions are replaced or added.

alter table app.auth_attempts drop constraint if exists auth_attempts_kind_check;
alter table app.auth_attempts
  add constraint auth_attempts_kind_check
  check (kind in ('password', 'otp', 'totp', 'email_send', 'recovery', 'mfa_verify'));

comment on table app.auth_attempts is
  'Sign-in, email-code, authenticator and recovery-code attempts and auth email sends, keyed by SHA-256 hashes of the subject (key_hash) and of the subject plus client address (scope_hash). failed null means pending, true means counted; successes are deleted. Written and read only by public.auth_attempt_reserve / auth_attempt_resolve (service role), app.consume_recovery_code (recovery) and public.hook_mfa_verification_attempt (mfa_verify).';

-- 2. Per-email limits are soft for password and otp.
create or replace function public.auth_attempt_reserve(p_kind text, p_key_hash text, p_scope_hash text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  win interval;
  scope_max integer;
  subject_max integer;
  scope_hits integer := 0;
  subject_hits integer := 0;
  anchor timestamptz;
  wait_seconds integer := 0;
  refused boolean := false;
  soft_subject boolean;
  rid uuid;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('password', 'otp', 'totp', 'email_send') then
    raise exception 'kind is password, otp, totp or email_send' using errcode = '22023';
  end if;
  if p_key_hash is null or p_key_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'key hash is sha-256 hex' using errcode = '22023';
  end if;
  if p_kind = 'totp' then
    if p_scope_hash is not null then
      raise exception 'totp is limited per user and takes no scope hash' using errcode = '22023';
    end if;
  elsif p_scope_hash is null or p_scope_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'scope hash is sha-256 hex' using errcode = '22023';
  end if;

  win := case when p_kind = 'email_send' then interval '1 hour' else interval '15 minutes' end;
  scope_max := case p_kind when 'password' then 10 when 'otp' then 5 when 'email_send' then 3 else null end;
  subject_max := case p_kind when 'password' then 50 when 'otp' then 20 when 'totp' then 5 else 10 end;
  -- password and otp: past the per-email limit only the (email, address) scope refuses.
  soft_subject := p_kind in ('password', 'otp');

  -- One reservation at a time per kind and subject (the scope is part of the subject).
  perform pg_advisory_xact_lock(hashtextextended('auth_attempts:' || p_kind || ':' || p_key_hash, 0));

  -- Keep the table small: rows older than a day never count.
  delete from app.auth_attempts old_row
  where old_row.id in (
    select o.id from app.auth_attempts o
    where o.created_at < now() - interval '1 day'
    limit 500
    for update skip locked
  );

  -- Counted: failures and sends (failed true) and unresolved reservations (failed null).
  select count(*)::integer into subject_hits
  from app.auth_attempts a
  where a.kind = p_kind
    and a.key_hash = p_key_hash
    and a.created_at > now() - win
    and coalesce(a.failed, true);
  if subject_hits >= subject_max then
    if soft_subject then
      -- Fewer attempts per address while the email is under sustained failures.
      scope_max := case p_kind when 'password' then 3 else 2 end;
    else
      refused := true;
      -- Back under the limit when this row leaves the window.
      select a.created_at into anchor
      from app.auth_attempts a
      where a.kind = p_kind
        and a.key_hash = p_key_hash
        and a.created_at > now() - win
        and coalesce(a.failed, true)
      order by a.created_at, a.id
      offset subject_hits - subject_max
      limit 1;
      wait_seconds := greatest(wait_seconds, ceil(extract(epoch from (anchor + win - now())))::integer);
    end if;
  end if;

  if scope_max is not null then
    select count(*)::integer into scope_hits
    from app.auth_attempts a
    where a.kind = p_kind
      and a.key_hash = p_key_hash
      and a.scope_hash = p_scope_hash
      and a.created_at > now() - win
      and coalesce(a.failed, true);
    if scope_hits >= scope_max then
      refused := true;
      select a.created_at into anchor
      from app.auth_attempts a
      where a.kind = p_kind
        and a.key_hash = p_key_hash
        and a.scope_hash = p_scope_hash
        and a.created_at > now() - win
        and coalesce(a.failed, true)
      order by a.created_at, a.id
      offset scope_hits - scope_max
      limit 1;
      wait_seconds := greatest(wait_seconds, ceil(extract(epoch from (anchor + win - now())))::integer);
    end if;
  end if;

  if refused then
    return jsonb_build_object('allowed', false, 'attempt_id', null, 'retry_after_seconds', greatest(1, wait_seconds));
  end if;

  insert into app.auth_attempts (kind, key_hash, scope_hash)
  values (p_kind, p_key_hash, case when p_kind = 'totp' then null else p_scope_hash end)
  returning id into rid;
  return jsonb_build_object('allowed', true, 'attempt_id', rid, 'retry_after_seconds', 0);
end;
$$;
comment on function public.auth_attempt_reserve(text, text, text) is
  'Auth limits (service role): reserves an attempt of a kind for a subject key hash and a subject+address scope hash, or refuses at the limit. password 10 per scope and otp 5 per scope in 15 minutes; past 50 / 20 per subject the scope limit drops to 3 / 2 (the subject limit alone never refuses). totp 5 per user in 15 minutes; email_send 3 per scope / 10 per recipient an hour. Failures, sends and unresolved reservations count. Returns allowed, attempt_id and retry_after_seconds; prunes rows older than a day.';
revoke all on function public.auth_attempt_reserve(text, text, text) from public, anon, authenticated;
grant execute on function public.auth_attempt_reserve(text, text, text) to service_role;

-- 1. Recovery codes: a per-user window limit in app.auth_attempts on top of the existing lockout.
-- Returns false, rather than raising, when the code is wrong, locked, retired, or
-- the session is missing. A raise would roll the failure counter back with the
-- transaction, so the lockout would never stick.
create or replace function app.consume_recovery_code(p_code text)
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
  attempt_key text;
  recent_failures integer;
begin
  if uid is null or sid is null or app.session_is_revoked() then
    return false;
  end if;

  -- One redemption at a time per user; 5 rejected codes in 15 minutes refuse further codes.
  attempt_key := encode(extensions.digest(convert_to('recovery:' || uid::text, 'utf8'), 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended('auth_attempts:recovery:' || attempt_key, 0));
  select count(*)::integer into recent_failures
  from app.auth_attempts a
  where a.kind = 'recovery'
    and a.key_hash = attempt_key
    and a.created_at > now() - interval '15 minutes'
    and coalesce(a.failed, true);
  if recent_failures >= 5 then
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
    insert into app.auth_attempts (kind, key_hash, scope_hash, failed)
    values ('recovery', attempt_key, null, true);
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
      jsonb_build_object('locked', failures >= 5 or recent_failures + 1 >= 5)
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
revoke all on function app.consume_recovery_code(text) from public;
grant execute on function app.consume_recovery_code(text) to authenticated, service_role;

-- 3. Supabase Auth MFA verification attempt hook (enable in the dashboard; see docs/DEPLOY.md).
create or replace function public.hook_mfa_verification_attempt(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  subject text := lower(coalesce(event ->> 'user_id', ''));
  is_valid boolean := coalesce(event -> 'valid' = 'true'::jsonb, false);
  attempt_key text;
  recent_failures integer;
begin
  if subject !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return jsonb_build_object('decision', 'continue');
  end if;
  attempt_key := encode(extensions.digest(convert_to('mfa_verify:' || subject, 'utf8'), 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended('auth_attempts:mfa_verify:' || attempt_key, 0));
  select count(*)::integer into recent_failures
  from app.auth_attempts a
  where a.kind = 'mfa_verify'
    and a.key_hash = attempt_key
    and a.created_at > now() - interval '15 minutes'
    and coalesce(a.failed, true);
  if recent_failures >= 5 then
    return jsonb_build_object(
      'decision', 'reject',
      'message', 'Too many attempts. Please wait 15 minutes and try again.'
    );
  end if;
  if not is_valid then
    insert into app.auth_attempts (kind, key_hash, scope_hash, failed)
    values ('mfa_verify', attempt_key, null, true);
  end if;
  return jsonb_build_object('decision', 'continue');
end;
$$;
comment on function public.hook_mfa_verification_attempt(jsonb) is
  'Supabase Auth MFA verification attempt hook: counts failed second-factor verifications per user in app.auth_attempts (mfa_verify) and rejects verifications while the user has 5 failures in the last 15 minutes. Executable only by supabase_auth_admin; active only once enabled under Auth > Hooks.';
revoke all on function public.hook_mfa_verification_attempt(jsonb) from public, anon, authenticated, service_role;

do $grant$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    execute 'grant execute on function public.hook_mfa_verification_attempt(jsonb) to supabase_auth_admin';
  end if;
end
$grant$;
