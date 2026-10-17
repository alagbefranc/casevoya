-- Inbound mail is attributed to a client only when the sending domain was authenticated.
--
-- Before this, app.match_inbound_sender matched the From header alone. A forged From could
-- attach files and text to a client's matter as if the client sent them. The From header is
-- now only a hint: without a verified sender the message keeps its address-derived matter
-- (the secret plus-tag) and waits for staff to assign a person in the unsorted queue.
--
-- The worker decides verification and signs the payload; the app passes the flag through
-- public.begin_verified_inbound_message, which is service_role only. The original
-- public.begin_inbound_message stays callable by service_role and now never attributes,
-- because the transaction setting below is unset.

alter table public.inbound_emails
  add column sender_verified boolean not null default false;
comment on column public.inbound_emails.sender_verified is
  'True only when the worker confirmed an aligned DMARC pass for the From domain. False messages are not matched to a person.';

create or replace function app.match_inbound_sender(p_org uuid, p_matter uuid, p_from text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  normalized text := lower(btrim(coalesce(p_from, '')));
  found uuid;
  people integer;
  matters integer;
begin
  -- Set only by public.begin_verified_inbound_message for the current transaction.
  if coalesce(current_setting('app.inbound_sender_verified', true), '') is distinct from 'true' then
    return null;
  end if;
  if normalized !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return null;
  end if;
  if p_matter is not null then
    select count(*)::integer, min(person.id::text)::uuid
      into people, found
    from public.persons person
    join public.matter_participants party
      on party.person_id = person.id
     and party.matter_id = p_matter
     and party.organization_id = p_org
    where person.organization_id = p_org
      and person.email = normalized;
    if people = 1 then
      return found;
    end if;
    return null;
  end if;
  select count(distinct person.id)::integer,
         count(distinct party.matter_id)::integer,
         min(person.id::text)::uuid
    into people, matters, found
  from public.persons person
  join public.matter_participants party
    on party.person_id = person.id
   and party.organization_id = p_org
  where person.organization_id = p_org
    and person.email = normalized;
  if people = 1 and matters = 1 then
    return found;
  end if;
  return null;
end;
$$;
revoke all on function app.match_inbound_sender(uuid, uuid, text) from public;

create function public.begin_verified_inbound_message(
  p_to text,
  p_from text,
  p_message_id text,
  p_subject text,
  p_text text,
  p_html text,
  p_domain text,
  p_sender_verified boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') is distinct from 'service_role' then
    raise exception 'worker role required' using errcode = '42501';
  end if;
  perform set_config('app.inbound_sender_verified', case when p_sender_verified then 'true' else 'false' end, true);
  result := public.begin_inbound_message(p_to, p_from, p_message_id, p_subject, p_text, p_html, p_domain);
  perform set_config('app.inbound_sender_verified', 'false', true);
  if result ->> 'status' = 'accepted' and p_sender_verified then
    update public.inbound_emails
    set sender_verified = true
    where id = (result ->> 'inbound_email_id')::uuid;
  end if;
  return result || jsonb_build_object('sender_verified', coalesce(p_sender_verified, false));
end;
$$;
revoke all on function public.begin_verified_inbound_message(text, text, text, text, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.begin_verified_inbound_message(text, text, text, text, text, text, text, boolean) to service_role;
