-- casevoya-site's Pages Function has no Supabase secret key. It holds its own random intake
-- secret (a Pages secret) instead, and calls public.submit_marketing_request_keyed with the
-- publishable key. The function accepts the call only when sha256(secret) matches a row in
-- public.marketing_intake_keys, which is set by hand and never committed. Without the secret the
-- anon role still cannot read or write marketing_demo_requests or call the unkeyed function.
create table public.marketing_intake_keys (
  key_hash text primary key check (key_hash ~ '^[0-9a-f]{64}$'),
  label text not null,
  created_at timestamptz not null default now()
);
alter table public.marketing_intake_keys enable row level security;
alter table public.marketing_intake_keys force row level security;
revoke all on table public.marketing_intake_keys from public, anon, authenticated;

create or replace function public.submit_marketing_request_keyed(
  p_secret text,
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
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_secret is null or char_length(p_secret) < 32 or not exists (
    select 1 from public.marketing_intake_keys
    where key_hash = encode(extensions.digest(convert_to(p_secret, 'UTF8'), 'sha256'), 'hex')
  ) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  v_id := public.submit_marketing_request(
    p_kind, p_name, p_email, p_firm, p_team_size, p_topic, p_message, p_ip_hash, p_user_agent);
  return jsonb_build_object('id', v_id, 'limited', v_id is null);
end;
$$;

-- Marks the alert result on a request, with the same secret.
create or replace function public.mark_marketing_request_notified(
  p_secret text, p_id uuid, p_error text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_secret is null or char_length(p_secret) < 32 or not exists (
    select 1 from public.marketing_intake_keys
    where key_hash = encode(extensions.digest(convert_to(p_secret, 'UTF8'), 'sha256'), 'hex')
  ) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.marketing_demo_requests
  set notified_at = case when p_error is null then now() else notified_at end,
      notify_error = left(p_error, 500)
  where id = p_id;
end;
$$;

revoke all on function public.submit_marketing_request_keyed(text, text, text, text, text, text, text, text, text, text)
  from public, authenticated;
grant execute on function public.submit_marketing_request_keyed(text, text, text, text, text, text, text, text, text, text)
  to anon, service_role;
revoke all on function public.mark_marketing_request_notified(text, uuid, text) from public, authenticated;
grant execute on function public.mark_marketing_request_notified(text, uuid, text) to anon, service_role;
