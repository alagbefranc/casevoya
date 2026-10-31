-- Rate limiting, database layer for authentication (security review: auth limits).
--
-- Auth calls run on the app server, so Supabase Auth's per-address limits see Cloudflare's
-- addresses. The app's Workers limits are per location and approximate; this table is the hard
-- per-account layer. The app server passes a SHA-256 hex key it computes from the kind and the
-- normalized email (or the user id for totp); no email is stored.
--
-- app.auth_attempts (no API role reads or writes it) and two service-role functions:
--   public.auth_attempt_check(p_kind, p_key_hash) -> {allowed, retry_after_seconds}
--     password    10 failures in 15 minutes: refused until 15 minutes after the latest failure
--     otp, totp    5 failures in 15 minutes: the same
--     email_send   3 sends in an hour: refused until the oldest of the last 3 is an hour old
--   public.auth_attempt_record(p_kind, p_key_hash, p_failed)
--     records a failed password/otp/totp attempt (successes are not stored) or an email send, and
--     removes up to 500 rows older than a day.
--
-- Additive: one new table, two new functions.

create table if not exists app.auth_attempts (
  id bigserial primary key,
  kind text not null check (kind in ('password', 'otp', 'totp', 'email_send')),
  key_hash text not null,
  created_at timestamptz not null default now(),
  failed boolean not null default false
);
comment on table app.auth_attempts is
  'Failed sign-in, email-code and authenticator attempts and auth email sends, keyed by a server-computed SHA-256 hash. Written and read only by public.auth_attempt_check / auth_attempt_record (service role).';

create index if not exists auth_attempts_kind_key_created_idx
  on app.auth_attempts (kind, key_hash, created_at);
create index if not exists auth_attempts_created_idx
  on app.auth_attempts (created_at);

alter table app.auth_attempts enable row level security;
alter table app.auth_attempts force row level security;
revoke all on table app.auth_attempts from public, anon, authenticated, service_role;
revoke all on sequence app.auth_attempts_id_seq from public, anon, authenticated, service_role;

create or replace function public.auth_attempt_check(p_kind text, p_key_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  max_failures integer;
  hits integer;
  anchor timestamptz;
  wait_seconds integer;
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

  if p_kind = 'email_send' then
    select count(*)::integer into hits
    from app.auth_attempts a
    where a.kind = p_kind
      and a.key_hash = p_key_hash
      and a.created_at > now() - interval '1 hour';
    if hits >= 3 then
      -- Allowed again when the window holds 2: the 3rd most recent send leaves it.
      select a.created_at into anchor
      from app.auth_attempts a
      where a.kind = p_kind
        and a.key_hash = p_key_hash
        and a.created_at > now() - interval '1 hour'
      order by a.created_at desc, a.id desc
      offset 2
      limit 1;
      wait_seconds := greatest(1, ceil(extract(epoch from (anchor + interval '1 hour' - now())))::integer);
      return jsonb_build_object('allowed', false, 'retry_after_seconds', wait_seconds);
    end if;
    return jsonb_build_object('allowed', true, 'retry_after_seconds', 0);
  end if;

  max_failures := case p_kind when 'password' then 10 else 5 end;
  select count(*)::integer, max(a.created_at) into hits, anchor
  from app.auth_attempts a
  where a.kind = p_kind
    and a.key_hash = p_key_hash
    and a.failed
    and a.created_at > now() - interval '15 minutes';
  if hits >= max_failures then
    -- Refused attempts are not recorded, so the lock ends 15 minutes after the latest failure.
    wait_seconds := greatest(1, ceil(extract(epoch from (anchor + interval '15 minutes' - now())))::integer);
    return jsonb_build_object('allowed', false, 'retry_after_seconds', wait_seconds);
  end if;
  return jsonb_build_object('allowed', true, 'retry_after_seconds', 0);
end;
$$;
comment on function public.auth_attempt_check(text, text) is
  'Auth limits (service role): whether another attempt of a kind is allowed for a key hash. password 10 failures / otp and totp 5 failures in 15 minutes lock for 15 minutes after the latest failure; email_send allows 3 per hour. Returns allowed and retry_after_seconds.';
revoke all on function public.auth_attempt_check(text, text) from public, anon, authenticated;
grant execute on function public.auth_attempt_check(text, text) to service_role;

create or replace function public.auth_attempt_record(p_kind text, p_key_hash text, p_failed boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
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

  -- Keep the table small: rows older than a day never count.
  delete from app.auth_attempts old_row
  where old_row.ctid in (
    select o.ctid from app.auth_attempts o
    where o.created_at < now() - interval '1 day'
    limit 500
  );

  -- Successful password, code and authenticator attempts are not counted, so not stored.
  if p_kind <> 'email_send' and not coalesce(p_failed, false) then
    return;
  end if;
  insert into app.auth_attempts (kind, key_hash, failed)
  values (p_kind, p_key_hash, coalesce(p_failed, false));
end;
$$;
comment on function public.auth_attempt_record(text, text, boolean) is
  'Auth limits (service role): records a failed password/otp/totp attempt or an email send for a key hash (successes are not stored) and prunes rows older than a day.';
revoke all on function public.auth_attempt_record(text, text, boolean) from public, anon, authenticated;
grant execute on function public.auth_attempt_record(text, text, boolean) to service_role;
