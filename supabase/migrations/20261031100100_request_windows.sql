-- Rate limiting, exact backstop for the Workers limits (security review: request windows).
--
-- The Workers Rate Limiting bindings are per location and approximate. src/lib/security/rate-limit.ts
-- also counts each allowed request here, in a fixed window per (bucket, key hash):
--   bucket        the binding name (RL_AUTH, RL_AUTH_EMAIL, RL_VERIFY, RL_PUBLIC, RL_PAYMENT)
--   key_hash      sha256(binding name:limit key), computed by the app server; no address or id is stored
--   window_start  the start of the fixed window the request falls in
--
-- app.request_windows (no API role reads or writes it) and one service-role function:
--   public.request_window_hit(p_bucket, p_key_hash, p_limit, p_window_seconds)
--     -> {allowed, retry_after_seconds}
--     Atomically adds one hit to the current window; allowed while hits <= p_limit;
--     retry_after_seconds is the time left in the window (at least 1). Occasionally removes up
--     to 500 windows older than a day.
--
-- Additive: one new table, one new function.

create table if not exists app.request_windows (
  bucket text not null check (bucket ~ '^[A-Z_]{1,32}$'),
  key_hash text not null check (key_hash ~ '^[0-9a-f]{64}$'),
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (bucket, key_hash, window_start)
);
comment on table app.request_windows is
  'Fixed-window request counters per bucket (Workers rate-limit binding name) and server-computed SHA-256 key hash. Written and read only by public.request_window_hit (service role).';

create index if not exists request_windows_window_start_idx
  on app.request_windows (window_start);

alter table app.request_windows enable row level security;
alter table app.request_windows force row level security;
revoke all on table app.request_windows from public, anon, authenticated, service_role;

create or replace function public.request_window_hit(p_bucket text, p_key_hash text, p_limit integer, p_window_seconds integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  win_start timestamptz;
  hit_count integer;
  wait_seconds integer;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_bucket is null or p_bucket !~ '^[A-Z_]{1,32}$' then
    raise exception 'bucket is 1 to 32 capital letters or underscores' using errcode = '22023';
  end if;
  if p_key_hash is null or p_key_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'key hash is sha-256 hex' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 10000 then
    raise exception 'limit is between 1 and 10000' using errcode = '22023';
  end if;
  if p_window_seconds is null or p_window_seconds not in (10, 60, 600, 3600) then
    raise exception 'window is 10, 60, 600 or 3600 seconds' using errcode = '22023';
  end if;

  win_start := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  insert into app.request_windows as w (bucket, key_hash, window_start, hits)
  values (p_bucket, p_key_hash, win_start, 1)
  on conflict (bucket, key_hash, window_start)
  do update set hits = w.hits + 1
  returning w.hits into hit_count;

  -- Keep the table small: windows older than a day never count.
  if random() < 0.02 then
    delete from app.request_windows old_row
    where old_row.ctid in (
      select o.ctid from app.request_windows o
      where o.window_start < now() - interval '1 day'
      limit 500
      for update skip locked
    );
  end if;

  wait_seconds := greatest(1, ceil(extract(epoch from (win_start + make_interval(secs => p_window_seconds) - now())))::integer);
  return jsonb_build_object('allowed', hit_count <= p_limit, 'retry_after_seconds', wait_seconds);
end;
$$;
comment on function public.request_window_hit(text, text, integer, integer) is
  'Request limits (service role): adds one hit for a bucket and SHA-256 key hash in the current fixed window (10, 60, 600 or 3600 seconds). Returns allowed (hits <= limit) and retry_after_seconds (time left in the window, at least 1); occasionally prunes windows older than a day.';
revoke all on function public.request_window_hit(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.request_window_hit(text, text, integer, integer) to service_role;
