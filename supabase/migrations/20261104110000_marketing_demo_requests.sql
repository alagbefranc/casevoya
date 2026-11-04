-- Marketing-site demo and contact requests (casevoya.ca /demo/ and /contact/).
--
-- Platform-level: not tied to any firm, holds no client data. Written only by the casevoya-site
-- Pages Function (/api/demo) with a server secret key, through public.submit_marketing_request,
-- which also applies a per-IP rate limit. No one else can read or write: RLS is enabled and
-- forced with no policies, and anon/authenticated have no grants.
create table public.marketing_demo_requests (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('demo', 'contact')),
  name text not null check (char_length(name) between 1 and 200),
  email text not null check (char_length(email) between 3 and 320 and email like '%_@_%._%'),
  firm text check (firm is null or char_length(firm) <= 200),
  team_size text check (team_size is null or team_size in ('Just me', '2 to 5', '6 to 15', '16 or more')),
  topic text check (topic is null or topic in ('sales', 'trial', 'migration', 'support', 'privacy', 'accessibility', 'other')),
  message text check (message is null or char_length(message) <= 5000),
  ip_hash text not null check (char_length(ip_hash) = 64),
  user_agent text check (user_agent is null or char_length(user_agent) <= 500),
  notified_at timestamptz,
  notify_error text,
  created_at timestamptz not null default now(),
  check (kind <> 'demo' or (firm is not null and team_size is not null)),
  check (kind <> 'contact' or (topic is not null and message is not null))
);

comment on table public.marketing_demo_requests is
  'casevoya.ca demo/contact form submissions. Server-only (RLS forced, no policies); written via submit_marketing_request.';

create index marketing_demo_requests_ip_recent on public.marketing_demo_requests (ip_hash, created_at desc);
create index marketing_demo_requests_created on public.marketing_demo_requests (created_at desc);

alter table public.marketing_demo_requests enable row level security;
alter table public.marketing_demo_requests force row level security;
revoke all on table public.marketing_demo_requests from public, anon, authenticated;
grant select, insert, update on table public.marketing_demo_requests to service_role;

-- Inserts one request unless this IP hash already sent 5 in the last 10 minutes.
-- Returns the new id, or null when rate limited.
create or replace function public.submit_marketing_request(
  p_kind text,
  p_name text,
  p_email text,
  p_firm text,
  p_team_size text,
  p_topic text,
  p_message text,
  p_ip_hash text,
  p_user_agent text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('marketing_demo_requests:' || p_ip_hash));
  if (
    select count(*) from public.marketing_demo_requests
    where ip_hash = p_ip_hash and created_at > now() - interval '10 minutes'
  ) >= 5 then
    return null;
  end if;
  insert into public.marketing_demo_requests
    (kind, name, email, firm, team_size, topic, message, ip_hash, user_agent)
  values
    (p_kind, p_name, p_email, nullif(p_firm, ''), nullif(p_team_size, ''), nullif(p_topic, ''),
     nullif(p_message, ''), p_ip_hash, left(p_user_agent, 500))
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.submit_marketing_request(text, text, text, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.submit_marketing_request(text, text, text, text, text, text, text, text, text)
  to service_role;
