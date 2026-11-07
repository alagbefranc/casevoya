-- Public consultant introductions for find.casevoya.ca.
--
-- A person asks Casevoya to introduce them to one licensed Canadian RCIC. This table is
-- platform-level: it is not a firm lead, not a directory, and it records no fee. The public
-- page writes only through public.submit_consultant_connect (service role), and every accepted
-- row is status New.
--
-- Still for SWE, in alagbefranc/casevoya-admin (admin.casevoya.ca):
--   1. Apply this migration on the shared Supabase project.
--   2. Add consultant_connect_requests to READABLE in scripts/check-boundaries.mjs and list
--      status New on the platform-admin Referrals screen. service_role may SELECT. There is
--      no UPDATE grant and no policy, so the screen cannot change a row by writing the table.
--   3. Add a named function for the human Send: one opted-in firm, then a lead or matter in
--      that firm only. Nothing in this migration emails a firm or creates that lead.
--   4. Point find.casevoya.ca at this app (see next.config.ts). Do not replace app.casevoya.ca.
--
-- A later status needs a new migration: the check below allows only New.

create table public.consultant_connect_requests (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'New' check (status = 'New'),
  goal text not null check (goal in (
    'Study in Canada',
    'Work in Canada',
    'Bring family together',
    'Visit Canada',
    'Permanent residence',
    'Not sure yet'
  )),
  country text not null check (char_length(country) between 1 and 80),
  code text not null check (code ~ '^[A-Z]{2}$'),
  zone text not null check (char_length(zone) between 1 and 64 and app.is_known_timezone(zone)),
  language text not null check (char_length(language) between 1 and 80 and language <> 'Another language'),
  name text not null check (char_length(name) between 1 and 80),
  email text not null check (
    char_length(email) between 3 and 254
    and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$'
  ),
  consent boolean not null check (consent),
  consent_statement text not null check (char_length(consent_statement) between 1 and 500),
  consent_version text not null check (consent_version = 'find-consent-2026-11-07'),
  ip_hash text not null check (char_length(ip_hash) = 64),
  user_agent text check (user_agent is null or char_length(user_agent) <= 500),
  submitted_at timestamptz not null default now()
);

comment on table public.consultant_connect_requests is
  'find.casevoya.ca introduction requests. Status New until a Casevoya human sends one request to one opted-in firm. Not a firm lead. No fee.';

comment on column public.consultant_connect_requests.status is
  'New on insert. No update is granted. A later migration has to widen this check before any other status can be stored.';

comment on column public.consultant_connect_requests.ip_hash is
  'sha256 of the visitor address (IPv6 as its /64), salted in the app. Not the address.';

create index consultant_connect_requests_new on public.consultant_connect_requests (submitted_at desc);
create index consultant_connect_requests_ip_recent on public.consultant_connect_requests (ip_hash, submitted_at desc);

alter table public.consultant_connect_requests enable row level security;
alter table public.consultant_connect_requests force row level security;

revoke all on table public.consultant_connect_requests from public, anon, authenticated;
grant select, insert on table public.consultant_connect_requests to service_role;

-- Inserts one New request unless this address hash already sent 5 in the last 10 minutes.
-- Returns the new id, or null when rate limited. Refuses consent that is not true.
create function public.submit_consultant_connect(
  p_goal text,
  p_country text,
  p_code text,
  p_zone text,
  p_language text,
  p_name text,
  p_email text,
  p_consent boolean,
  p_statement text,
  p_consent_version text,
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
  if p_consent is not true then
    raise exception 'consent_required' using errcode = '22023';
  end if;
  if p_statement is distinct from
    'I agree that Casevoya may read my request and share it with one licensed consultant who can help. Nothing is sent until I press Send.'
    or p_consent_version is distinct from 'find-consent-2026-11-07' then
    raise exception 'consent_wording' using errcode = '22023';
  end if;
  if not app.is_known_timezone(p_zone) then
    raise exception 'unknown_zone' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('consultant_connect:' || p_ip_hash));
  if (
    select count(*) from public.consultant_connect_requests
    where ip_hash = p_ip_hash and submitted_at > now() - interval '10 minutes'
  ) >= 5 then
    return null;
  end if;

  insert into public.consultant_connect_requests (
    status, goal, country, code, zone, language, name, email, consent,
    consent_statement, consent_version, ip_hash, user_agent
  ) values (
    'New',
    btrim(p_goal),
    btrim(p_country),
    upper(btrim(p_code)),
    btrim(p_zone),
    btrim(p_language),
    btrim(p_name),
    btrim(p_email),
    true,
    p_statement,
    p_consent_version,
    p_ip_hash,
    left(p_user_agent, 500)
  )
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.submit_consultant_connect(text, text, text, text, text, text, text, boolean, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.submit_consultant_connect(text, text, text, text, text, text, text, boolean, text, text, text, text)
  to service_role;
