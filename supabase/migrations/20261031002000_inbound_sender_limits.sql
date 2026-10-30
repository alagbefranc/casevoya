-- Inbound mail: per-sender and per-sender-domain limits so one outside sender cannot use up a
-- firm's inbound allowance.
--
-- Rules enforced in public.begin_inbound_message (the only place the quota is checked; the
-- service-role wrapper public.begin_verified_inbound_message calls it):
--   * Sender classes. A message is from a "known sender" only when the worker verified the From
--     domain (aligned DMARC pass, transaction setting app.inbound_sender_verified = 'true') AND
--     the normalised From address equals public.persons.email of that firm, or the auth email of
--     an active staff membership of that firm. Everything else (unverified mail, or verified mail
--     from an address the firm does not know) is "other". The From header alone never makes a
--     sender known, because it can be forged.
--   * Other senders: at most per_sender messages per normalised sender address (lower case, a
--     "+tag" in the local part ignored) and per_domain messages per sender domain, per firm, in a
--     rolling hour (5-minute buckets). Then the per-firm hourly cap (email.inbound_hourly_limit)
--     applies as before.
--   * Known senders are exempt from the sender and domain limits. They count toward the same
--     per-firm hourly counter, but are refused only once it reaches known_messages (default 300,
--     never lower than the firm cap). Strangers filling the firm cap therefore cannot block mail
--     from the firm's clients or staff; the higher cap stays as a backstop.
--   * A refused message is not stored. The counters keep a "rejected" count and the audit log
--     gets one compact row (reason, sender domain, no address or content) for the first refusal
--     per counter window.
--   * Counters for other senders key the address by its SHA-256, so stranger addresses are not
--     kept in plain text; the domain is kept for staff review.
-- Body copied from the latest definition (20261017200200_inbound_email.sql); changes are marked
-- "Sender limits:".

insert into public.product_settings (key, value, description, pending_confirmation) values
  (
    'email.inbound_sender_limits',
    '{"per_sender":20,"per_domain":100,"known_messages":300}'::jsonb,
    'Inbound mail per firm in a rolling hour: per_sender per sender address, per_domain per sender domain (senders the firm does not know). known_messages is the firm hourly backstop for verified clients and staff.',
    true
  )
on conflict (key) do nothing;

alter table public.email_inbound_windows
  add column if not exists rejected integer not null default 0 check (rejected >= 0);
comment on column public.email_inbound_windows.rejected is
  'Inbound messages refused by the firm hourly cap in this hour. Refused messages are not stored.';

create table if not exists public.email_inbound_sender_windows (
  organization_id uuid not null references public.organizations (id),
  scope text not null check (scope in ('sender', 'domain')),
  sender_key text not null check (length(sender_key) between 1 and 320),
  window_start timestamptz not null,
  hits integer not null default 0 check (hits >= 0),
  rejected integer not null default 0 check (rejected >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  primary key (organization_id, scope, sender_key, window_start)
);
comment on table public.email_inbound_sender_windows is
  'Inbound messages per firm per outside sender (scope sender: SHA-256 of the normalised address) and per sender domain, in 5-minute buckets. Counts only; no message content.';

create index if not exists email_inbound_sender_windows_created_by_idx
  on public.email_inbound_sender_windows (created_by);
create index if not exists email_inbound_sender_windows_org_window_idx
  on public.email_inbound_sender_windows (organization_id, window_start);

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'email_inbound_sender_windows_touch'
      and tgrelid = 'public.email_inbound_sender_windows'::regclass
  ) then
    create trigger email_inbound_sender_windows_touch before update on public.email_inbound_sender_windows
      for each row execute function app.touch_row();
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgname = 'email_inbound_sender_windows_stamp'
      and tgrelid = 'public.email_inbound_sender_windows'::regclass
  ) then
    create trigger email_inbound_sender_windows_stamp before insert on public.email_inbound_sender_windows
      for each row execute function app.stamp_created_by();
  end if;
end;
$$;

alter table public.email_inbound_sender_windows enable row level security;
alter table public.email_inbound_sender_windows force row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'email_inbound_sender_windows'
      and policyname = 'email_inbound_sender_windows_select'
  ) then
    create policy email_inbound_sender_windows_select on public.email_inbound_sender_windows
      for select to authenticated
      using (
        organization_id = (select app.current_organization_id())
        and (select app.staff_mfa_satisfied())
        and (select app.has_org_role(
          organization_id,
          array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[]
        ))
      );
  end if;
end;
$$;

revoke all on table public.email_inbound_sender_windows from public, anon, authenticated;
grant select on table public.email_inbound_sender_windows to authenticated;

-- ---------------------------------------------------------------------------
-- Helpers (private)
-- ---------------------------------------------------------------------------

-- Lower-case bare address from a From value ("Name <a@b.c>" or "a@b.c"), or null when malformed.
create or replace function app.inbound_sender_address(p_from text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  raw text := lower(btrim(coalesce(p_from, '')));
  inner_address text;
begin
  inner_address := substring(raw from '<([^<>]+)>');
  if inner_address is not null then
    raw := btrim(inner_address);
  end if;
  if length(raw) > 320 or raw !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return null;
  end if;
  return raw;
end;
$$;
revoke all on function app.inbound_sender_address(text) from public, anon, authenticated;

-- Counter key for an address: the "+tag" of the local part is ignored.
create or replace function app.inbound_sender_key(p_address text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  local_part text;
begin
  if p_address is null then
    return '(invalid)';
  end if;
  local_part := split_part(split_part(p_address, '@', 1), '+', 1);
  if local_part = '' then
    local_part := split_part(p_address, '@', 1);
  end if;
  return local_part || '@' || split_part(p_address, '@', 2);
end;
$$;
revoke all on function app.inbound_sender_key(text) from public, anon, authenticated;

-- Verified sender whose address is a person of the firm or active staff of the firm.
create or replace function app.inbound_known_sender(p_org uuid, p_address text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(current_setting('app.inbound_sender_verified', true), '') = 'true'
    and p_org is not null
    and p_address is not null
    and (
      exists (
        select 1 from public.persons person
        where person.organization_id = p_org
          and person.email = p_address
      )
      or exists (
        select 1
        from public.memberships membership
        join auth.users account on account.id = membership.user_id
        where membership.organization_id = p_org
          and membership.status = 'active'
          and membership.role = any (app.staff_roles())
          and lower(account.email) = p_address
      )
    );
$$;
revoke all on function app.inbound_known_sender(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- public.begin_inbound_message
-- ---------------------------------------------------------------------------

create or replace function public.begin_inbound_message(
  p_to text,
  p_from text,
  p_message_id text,
  p_subject text,
  p_text text,
  p_html text,
  p_domain text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolved jsonb;
  org uuid;
  matter uuid;
  person uuid;
  existing public.inbound_emails%rowtype;
  limit_hits integer;
  bucket timestamptz := date_trunc('hour', statement_timestamp());
  current_hits integer;
  body_text text;
  stored_in_messages boolean := false;
  new_id uuid;
  cols text;
  vals text;
  -- Sender limits:
  limits jsonb;
  per_sender integer;
  per_domain integer;
  known_limit integer;
  sender_address text;
  sender_domain text;
  sender_hash text;
  known boolean;
  small_bucket timestamptz := date_bin('5 minutes', statement_timestamp(), timestamptz '2000-01-01 00:00:00+00');
  window_floor timestamptz := statement_timestamp() - interval '1 hour';
  sender_hits integer;
  domain_hits integer;
  refused_scope text;
  refused_count integer;
  firm_threshold integer;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') is distinct from 'service_role' then
    raise exception 'worker role required' using errcode = '42501';
  end if;
  if p_message_id is null or length(btrim(p_message_id)) < 1 then
    raise exception 'message id is required' using errcode = '22023';
  end if;
  resolved := app.resolve_inbound_address(p_to, p_domain);
  if resolved ->> 'status' is distinct from 'ok' then
    return resolved;
  end if;
  org := (resolved ->> 'organization_id')::uuid;
  if coalesce(resolved ->> 'matter_id', '') ~* '^[0-9a-f-]{36}$' then
    matter := (resolved ->> 'matter_id')::uuid;
  end if;
  person := app.match_inbound_sender(org, matter, p_from);
  if matter is null and person is not null then
    select party.matter_id into matter
    from public.matter_participants party
    where party.person_id = person
      and party.organization_id = org
    limit 1;
  end if;

  select * into existing
  from public.inbound_emails email
  where email.organization_id = org
    and email.message_id = left(btrim(p_message_id), 500);
  if existing.id is not null then
    return jsonb_build_object(
      'status', case when existing.attachments_done then 'duplicate' else 'resume' end,
      'inbound_email_id', existing.id,
      'organization_id', existing.organization_id,
      'matter_id', existing.matter_id,
      'person_id', existing.person_id,
      'attachments_done', existing.attachments_done
    );
  end if;

  -- Sender limits: one firm's counters are read and written by one transaction at a time.
  perform pg_advisory_xact_lock(hashtextextended('inbound_email_limits:' || org::text, 0));
  sender_address := app.inbound_sender_address(p_from);
  sender_domain := coalesce(nullif(split_part(sender_address, '@', 2), ''), '(invalid)');
  sender_hash := encode(sha256(convert_to(app.inbound_sender_key(sender_address), 'UTF8')), 'hex');
  known := coalesce(app.inbound_known_sender(org, sender_address), false);
  select value into limits from public.product_settings where key = 'email.inbound_sender_limits';
  per_sender := least(greatest(coalesce((limits ->> 'per_sender')::integer, 20), 1), 1000);
  per_domain := least(greatest(coalesce((limits ->> 'per_domain')::integer, 100), 1), 10000);
  known_limit := least(greatest(coalesce((limits ->> 'known_messages')::integer, 300), 1), 10000);

  select coalesce((value ->> 'messages')::integer, 30)
    into limit_hits
  from public.product_settings
  where key = 'email.inbound_hourly_limit';
  limit_hits := least(greatest(coalesce(limit_hits, 30), 1), 1000);
  select hits into current_hits
  from public.email_inbound_windows hour_row
  where hour_row.organization_id = org
    and hour_row.hour_bucket = bucket
  for update;

  -- Sender limits: outside senders are limited per address and per domain first.
  if not known then
    select coalesce(sum(w.hits), 0)::integer into sender_hits
    from public.email_inbound_sender_windows w
    where w.organization_id = org and w.scope = 'sender' and w.sender_key = sender_hash
      and w.window_start > window_floor;
    select coalesce(sum(w.hits), 0)::integer into domain_hits
    from public.email_inbound_sender_windows w
    where w.organization_id = org and w.scope = 'domain' and w.sender_key = left(sender_domain, 320)
      and w.window_start > window_floor;
    if sender_hits >= per_sender then
      refused_scope := 'sender';
    elsif domain_hits >= per_domain then
      refused_scope := 'domain';
    end if;
    if refused_scope is not null then
      insert into public.email_inbound_sender_windows (organization_id, scope, sender_key, window_start, hits, rejected)
      values (
        org, refused_scope,
        case when refused_scope = 'sender' then sender_hash else left(sender_domain, 320) end,
        small_bucket, 0, 1
      )
      on conflict (organization_id, scope, sender_key, window_start) do update
        set rejected = public.email_inbound_sender_windows.rejected + 1
      returning rejected into refused_count;
      if refused_count = 1 then
        perform app.record_audit_event(
          org, 'email.rejected', 'public.inbound_emails', null::uuid, 'denied',
          jsonb_build_object('reason', refused_scope || '_rate_limit', 'sender_domain', left(sender_domain, 253))
        );
      end if;
      return jsonb_build_object('status', 'rate_limited', 'organization_id', org, 'reason', refused_scope || '_rate_limit');
    end if;
  end if;

  -- Sender limits: known senders are refused only at the higher backstop.
  firm_threshold := limit_hits;
  if known then
    firm_threshold := greatest(limit_hits, known_limit);
  end if;
  if coalesce(current_hits, 0) >= firm_threshold then
    insert into public.email_inbound_windows (organization_id, hour_bucket, hits, rejected)
    values (org, bucket, 0, 1)
    on conflict (organization_id, hour_bucket) do update
      set rejected = public.email_inbound_windows.rejected + 1
    returning rejected into refused_count;
    if refused_count = 1 then
      perform app.record_audit_event(
        org, 'email.rejected', 'public.inbound_emails', null::uuid, 'denied',
        jsonb_build_object('reason', 'rate_limit', 'sender_class', case when known then 'known' else 'other' end)
      );
    end if;
    return jsonb_build_object('status', 'rate_limited', 'organization_id', org, 'reason', 'rate_limit');
  end if;
  insert into public.email_inbound_windows (organization_id, hour_bucket, hits)
  values (org, bucket, 1)
  on conflict (organization_id, hour_bucket) do update
    set hits = public.email_inbound_windows.hits + 1;

  -- Sender limits: count accepted mail from outside senders.
  if not known then
    insert into public.email_inbound_sender_windows (organization_id, scope, sender_key, window_start, hits)
    values (org, 'sender', sender_hash, small_bucket, 1), (org, 'domain', left(sender_domain, 320), small_bucket, 1)
    on conflict (organization_id, scope, sender_key, window_start) do update
      set hits = public.email_inbound_sender_windows.hits + 1;
    delete from public.email_inbound_sender_windows old_row
    where old_row.organization_id = org
      and old_row.window_start < statement_timestamp() - interval '1 day';
  end if;

  body_text := left(coalesce(nullif(btrim(p_text), ''), ''), 100000);
  if matter is not null
     and to_regclass('public.messages') is not null
     and exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'messages' and column_name = 'organization_id'
     )
     and exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'messages' and column_name = 'matter_id'
     )
     and exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'messages' and column_name = 'body'
     ) then
    cols := 'organization_id, matter_id, body';
    vals := '$1, $2, $3';
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'messages' and column_name = 'internal_note'
    ) then
      cols := cols || ', internal_note';
      vals := vals || ', false';
    end if;
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'messages' and column_name = 'audience'
    ) then
      cols := cols || ', audience';
      vals := vals || ', ''external''';
    end if;
    begin
      execute format('insert into public.messages (%s) values (%s)', cols, vals)
        using org, matter, coalesce(nullif(body_text, ''), '(no text)');
      stored_in_messages := true;
    exception
      when not_null_violation or check_violation or datatype_mismatch or invalid_text_representation then
        stored_in_messages := false;
    end;
  end if;

  insert into public.inbound_emails (
    organization_id, message_id, from_email, to_email, subject,
    text_body, html_body, body_location, matter_id, person_id
  ) values (
    org,
    left(btrim(p_message_id), 500),
    left(lower(btrim(coalesce(p_from, 'unknown@example.test'))), 320),
    left(lower(btrim(p_to)), 320),
    left(nullif(btrim(coalesce(p_subject, '')), ''), 300),
    case when stored_in_messages then null else nullif(body_text, '') end,
    case when stored_in_messages then null else left(nullif(btrim(coalesce(p_html, '')), ''), 200000) end,
    case when stored_in_messages then 'messages' else 'inbound_emails' end,
    matter,
    person
  )
  returning id into new_id;

  perform app.record_audit_event(
    org, 'email.received', 'public.inbound_emails', new_id, 'success',
    jsonb_build_object('message_id', left(btrim(p_message_id), 200), 'body_location',
      case when stored_in_messages then 'messages' else 'inbound_emails' end)
  );
  return jsonb_build_object(
    'status', 'accepted',
    'inbound_email_id', new_id,
    'organization_id', org,
    'matter_id', matter,
    'person_id', person,
    'attachments_done', false
  );
end;
$$;

revoke all on function public.begin_inbound_message(text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.begin_inbound_message(text, text, text, text, text, text, text) to service_role;
