-- Rate limiting, database layer for authentication (security review: auth limits).
--
-- Auth calls run on the app server, so Supabase Auth's per-address limits see Cloudflare's
-- addresses. The app's Workers limits are per location and approximate; this table is the hard
-- layer. The app server passes SHA-256 hex keys it computes; no email or address is stored:
--   key_hash    sha256(kind:subject), the subject being the normalized email (or the user id for totp)
--   scope_hash  sha256(kind:subject:client address key), null for totp
--
-- app.auth_attempts (no API role reads or writes it) and two service-role functions:
--   public.auth_attempt_reserve(p_kind, p_key_hash, p_scope_hash) -> {allowed, attempt_id, retry_after_seconds}
--     Under a per-(kind, subject) transaction lock, counts the subject's rows in the window that
--     are failures/sends or still unresolved, overall and for the scope:
--       password    10 per (subject, address) and 50 per subject in 15 minutes
--       otp          5 per (subject, address) and 20 per subject in 15 minutes
--       totp         5 per user in 15 minutes
--       email_send   3 per (recipient, address) and 10 per recipient in an hour
--     At a limit it refuses without a row; retry_after_seconds is when the oldest counted row that
--     must leave the window to get back under that limit leaves it. Otherwise it inserts a pending
--     row (failed null) and returns its id. Also removes up to 500 rows older than a day.
--   public.auth_attempt_resolve(p_id, p_failed)
--     p_failed true: the row is kept as counted (a failed attempt, or an email that was sent).
--     p_failed false: the row is deleted (a success, or no email sent). Only a pending row younger
--     than 2 minutes can be deleted; an unresolved row older than that stays counted as a failure.
--
-- Additive: one new table, two new functions.

create table if not exists app.auth_attempts (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('password', 'otp', 'totp', 'email_send')),
  key_hash text not null check (key_hash ~ '^[0-9a-f]{64}$'),
  scope_hash text null check (scope_hash is null or scope_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  failed boolean null
);
comment on table app.auth_attempts is
  'Sign-in, email-code and authenticator attempts and auth email sends, keyed by server-computed SHA-256 hashes of the subject (key_hash) and of the subject plus client address (scope_hash). failed null means pending, true means counted; successes are deleted. Written and read only by public.auth_attempt_reserve / auth_attempt_resolve (service role).';

create index if not exists auth_attempts_kind_key_created_idx
  on app.auth_attempts (kind, key_hash, created_at);
create index if not exists auth_attempts_kind_scope_created_idx
  on app.auth_attempts (kind, scope_hash, created_at)
  where scope_hash is not null;
create index if not exists auth_attempts_created_idx
  on app.auth_attempts (created_at);

alter table app.auth_attempts enable row level security;
alter table app.auth_attempts force row level security;
revoke all on table app.auth_attempts from public, anon, authenticated, service_role;

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
  'Auth limits (service role): reserves an attempt of a kind for a subject key hash and a subject+address scope hash, or refuses at the limit (password 10 per scope / 50 per subject, otp 5 / 20, in 15 minutes; totp 5 per user in 15 minutes; email_send 3 / 10 per hour). Failures, sends and unresolved reservations count. Returns allowed, attempt_id and retry_after_seconds; prunes rows older than a day.';
revoke all on function public.auth_attempt_reserve(text, text, text) from public, anon, authenticated;
grant execute on function public.auth_attempt_reserve(text, text, text) to service_role;

create or replace function public.auth_attempt_resolve(p_id uuid, p_failed boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce((select auth.jwt() ->> 'role'), '') is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_id is null or p_failed is null then
    raise exception 'an attempt and its outcome are required' using errcode = '22023';
  end if;
  if p_failed then
    update app.auth_attempts
       set failed = true
     where id = p_id
       and failed is null;
  else
    -- A reservation left unresolved for 2 minutes stays counted.
    delete from app.auth_attempts
     where id = p_id
       and failed is null
       and created_at > now() - interval '2 minutes';
  end if;
end;
$$;
comment on function public.auth_attempt_resolve(uuid, boolean) is
  'Auth limits (service role): resolves a pending reservation. p_failed true keeps it counted (a failed attempt or an email sent); false deletes it (a success or no email sent) if it is pending and younger than 2 minutes. A resolved row is unchanged.';
revoke all on function public.auth_attempt_resolve(uuid, boolean) from public, anon, authenticated;
grant execute on function public.auth_attempt_resolve(uuid, boolean) to service_role;
