-- Security review (round 3): invitation rate limits, internal-only signing and fund totals,
-- and the actor recorded for public booking holds.
--
-- A) Invitation limits, enforced on insert into public.invitations (staff; written by
--    app.create_staff_invitation, which also handles resends) and public.portal_invitations
--    (portal; written by app.issue_portal_invitation for create and resend). Staff and portal
--    invitations count together:
--      * per firm: 50 in the last hour;
--      * per firm and target email: 5 in the last 24 hours (resends included);
--      * per inviting user: 30 in the last hour (all firms).
--    A refusal raises 'invitation limit reached: ...' with errcode 54000 (as other rate limits).
--    The existing portal limits (app.portal_invite_limited, 5 per person/matter/role a day) stay.
--
-- B) Internal-only functions:
--      * app.client_fund_ledger_totals(uuid) had no access check. Every caller is a security
--        definer function (app.check_client_fund_balance trigger, app.check_client_transfer,
--        app.record_client_refund, app.record_client_fund_correction, the client funds queue),
--        so it is no longer granted to authenticated.
--      * public.sign_agreement(uuid, boolean, text, uuid) / public.decline_agreement(uuid, text,
--        uuid) (20261030234000) become security definer, so the signer no longer needs execute on
--        app.sign_agreement / app.decline_agreement (inet forms), which are revoked from
--        authenticated. Bodies unchanged; auth.uid() and every signer check in the app functions
--        still apply (they read the caller's JWT claims).
--
-- C) Public booking holds run as the service role (20261030231500), so audit, booking history
--    and outbox rows recorded actor type 'service' with no user. public.booking_public_hold now
--    sets the transaction-local app.public_actor to the server-named viewer (when a real user)
--    or 'public'. A before-insert trigger on public.audit_log, public.booking_events and
--    public.outbox_events applies it only to rows written by the service role with no user:
--    the viewer becomes the actor (actor type 'user'), otherwise actor type 'public'.
--    audit_log.actor_type allows 'public'. booking_public_hold body: latest from
--    20261030231500_public_client_hash_server_only.sql with only the marked "Actor:" change.

-- ---------------------------------------------------------------------------
-- A) Invitation limits
-- ---------------------------------------------------------------------------

create index if not exists invitations_org_created_idx on public.invitations (organization_id, created_at);
create index if not exists portal_invitations_org_created_idx on public.portal_invitations (organization_id, created_at);

create or replace function app.enforce_invitation_limits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid := new.organization_id;
  target text := lower(btrim(coalesce(new.email, '')));
  actor uuid := coalesce(new.created_by, (select auth.uid()));
  hour_ago timestamptz := statement_timestamp() - interval '1 hour';
  day_ago timestamptz := statement_timestamp() - interval '24 hours';
  n bigint;
begin
  -- One firm's invitations are counted one at a time.
  perform pg_advisory_xact_lock(hashtextextended('casevoya.invitation_limit:' || org::text, 0));

  select (select count(*) from public.invitations i where i.organization_id = org and i.created_at > hour_ago)
       + (select count(*) from public.portal_invitations p where p.organization_id = org and p.created_at > hour_ago)
    into n;
  if n >= 50 then
    raise exception 'invitation limit reached: this firm sent 50 invitations in the last hour; try again later'
      using errcode = '54000';
  end if;

  select (select count(*) from public.invitations i
           where i.organization_id = org and i.email = target and i.created_at > day_ago)
       + (select count(*) from public.portal_invitations p
           where p.organization_id = org and p.email = target and p.created_at > day_ago)
    into n;
  if n >= 5 then
    raise exception 'invitation limit reached: this address was sent 5 invitations in the last 24 hours; try again tomorrow'
      using errcode = '54000';
  end if;

  if actor is not null then
    select (select count(*) from public.invitations i where i.created_by = actor and i.created_at > hour_ago)
         + (select count(*) from public.portal_invitations p where p.created_by = actor and p.created_at > hour_ago)
      into n;
    if n >= 30 then
      raise exception 'invitation limit reached: you sent 30 invitations in the last hour; try again later'
        using errcode = '54000';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function app.enforce_invitation_limits() from public, anon, authenticated, service_role;

do $trigger$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'invitations_rate_limit' and tgrelid = 'public.invitations'::regclass
  ) then
    create trigger invitations_rate_limit before insert on public.invitations
      for each row execute function app.enforce_invitation_limits();
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgname = 'portal_invitations_rate_limit' and tgrelid = 'public.portal_invitations'::regclass
  ) then
    create trigger portal_invitations_rate_limit before insert on public.portal_invitations
      for each row execute function app.enforce_invitation_limits();
  end if;
end
$trigger$;

-- ---------------------------------------------------------------------------
-- B) Internal-only: client fund totals and the inet signing forms
-- ---------------------------------------------------------------------------

revoke all on function app.client_fund_ledger_totals(uuid) from public, anon, authenticated;
grant execute on function app.client_fund_ledger_totals(uuid) to service_role;

create or replace function public.sign_agreement(
  p_envelope_id uuid,
  p_consent boolean,
  p_idempotency_key text,
  p_evidence_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ip inet;
  v_user_agent text;
begin
  select ev.ip, ev.user_agent into v_ip, v_user_agent
  from app.take_signing_evidence(p_evidence_id, p_envelope_id) ev;
  return app.sign_agreement(p_envelope_id, p_consent, p_idempotency_key, v_ip, v_user_agent);
end;
$$;
revoke all on function public.sign_agreement(uuid, boolean, text, uuid) from public, anon;
grant execute on function public.sign_agreement(uuid, boolean, text, uuid) to authenticated, service_role;

create or replace function public.decline_agreement(
  p_envelope_id uuid,
  p_idempotency_key text,
  p_evidence_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ip inet;
  v_user_agent text;
begin
  select ev.ip, ev.user_agent into v_ip, v_user_agent
  from app.take_signing_evidence(p_evidence_id, p_envelope_id) ev;
  return app.decline_agreement(p_envelope_id, p_idempotency_key, v_ip, v_user_agent);
end;
$$;
revoke all on function public.decline_agreement(uuid, text, uuid) from public, anon;
grant execute on function public.decline_agreement(uuid, text, uuid) to authenticated, service_role;

-- Caller-supplied IP and user agent: definer and service-role paths only.
revoke all on function app.sign_agreement(uuid, boolean, text, inet, text) from public, anon, authenticated;
revoke all on function app.decline_agreement(uuid, text, inet, text) from public, anon, authenticated;
grant execute on function app.sign_agreement(uuid, boolean, text, inet, text) to service_role;
grant execute on function app.decline_agreement(uuid, text, inet, text) to service_role;

-- ---------------------------------------------------------------------------
-- C) Actor for public booking holds
-- ---------------------------------------------------------------------------

-- Added NOT VALID (no scan while adding), then validated in its own statement.
alter table public.audit_log drop constraint if exists audit_log_actor_type_check;
alter table public.audit_log
  add constraint audit_log_actor_type_check check (actor_type in ('user', 'system', 'service', 'public')) not valid;
alter table public.audit_log validate constraint audit_log_actor_type_check;

-- Rows written by the service role with no user, while app.public_actor is set for this
-- transaction, name the server-supplied viewer, or the public actor type.
create or replace function app.stamp_public_actor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  marker text := nullif(current_setting('app.public_actor', true), '');
  viewer uuid;
begin
  if marker is null or app.current_actor_type() is distinct from 'service' then
    return new;
  end if;
  if marker <> 'public' then
    begin
      viewer := marker::uuid;
    exception when others then
      return new;
    end;
    if not exists (select 1 from auth.users u where u.id = viewer) then
      return new;
    end if;
  end if;
  if tg_table_name = 'audit_log' then
    if new.actor_user_id is null and new.actor_type = 'service' then
      new.actor_user_id := viewer;
      new.actor_type := case when viewer is null then 'public' else 'user' end;
    end if;
  elsif tg_table_name = 'booking_events' then
    new.actor_user_id := coalesce(new.actor_user_id, viewer);
  elsif tg_table_name = 'outbox_events' then
    new.created_by := coalesce(new.created_by, viewer);
  end if;
  return new;
end;
$$;
revoke all on function app.stamp_public_actor() from public, anon, authenticated, service_role;

do $trigger$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'audit_log_public_actor' and tgrelid = 'public.audit_log'::regclass
  ) then
    create trigger audit_log_public_actor before insert on public.audit_log
      for each row execute function app.stamp_public_actor();
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgname = 'booking_events_public_actor' and tgrelid = 'public.booking_events'::regclass
  ) then
    create trigger booking_events_public_actor before insert on public.booking_events
      for each row execute function app.stamp_public_actor();
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgname = 'outbox_events_public_actor' and tgrelid = 'public.outbox_events'::regclass
  ) then
    create trigger outbox_events_public_actor before insert on public.outbox_events
      for each row execute function app.stamp_public_actor();
  end if;
end
$trigger$;

create or replace function public.booking_public_hold(
  p_firm_slug text,
  p_event_slug text,
  p_start timestamptz,
  p_name text,
  p_email text,
  p_phone text,
  p_time_zone text,
  p_idempotency_key text,
  p_client_hash text,
  p_viewer uuid,
  p_viewer_aal text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  et public.booking_event_types%rowtype;
  key text := btrim(coalesce(p_idempotency_key, ''));
  v_email text := lower(btrim(coalesce(p_email, '')));
  zone text := btrim(coalesce(p_time_zone, ''));
  -- Hash: always a bucket; a missing or malformed hash shares one.
  hash text := app.public_client_bucket(p_client_hash);
  existing public.bookings%rowtype;
  me uuid;
  bid uuid;
begin
  -- Service: only the app server calls this (it computes the hash).
  perform app.require_service_role();
  -- Actor: rows written by this hold name the server-supplied viewer, or the public actor type.
  perform set_config(
    'app.public_actor',
    coalesce((select u.id::text from auth.users u where u.id = p_viewer), 'public'),
    true
  );
  select et2.* into et
  from public.booking_event_types et2
  join public.organizations org on org.id = et2.organization_id
  where org.slug = lower(btrim(coalesce(p_firm_slug, '')))
    and et2.slug = lower(btrim(coalesce(p_event_slug, '')))
    and et2.is_published and et2.archived_at is null
    -- Viewer: a practice page is for the firm's staff named by the server.
    and (not et2.is_sample or app.public_viewer_is_staff(et2.organization_id, p_viewer))
    and (et2.is_sample or app.firm_booking_pages_open(et2.organization_id));
  if et.id is null then
    raise exception 'booking type not found' using errcode = 'P0002';
  end if;
  if et.price_cents > 0 then
    raise exception 'paid consultations are not available yet' using errcode = '22023';
  end if;
  if length(key) not between 8 and 180 then
    raise exception 'idempotency key is required' using errcode = '22023';
  end if;

  select * into existing from public.bookings b where b.organization_id = et.organization_id and b.idempotency_key = key;
  if existing.id is not null then
    if existing.starts_at <> p_start or not exists (
      select 1 from public.booking_attendees a where a.booking_id = existing.id and a.role = 'primary' and a.email = v_email
    ) then
      raise exception 'idempotency key reused for a different booking' using errcode = '22023';
    end if;
    return app.booking_summary(existing.id);
  end if;

  -- Basic abuse limits: 8 requests per client address and 60 per firm in 10 minutes. From here on
  -- a refusal is returned, not raised, so the attempt row (and the audit row) are kept and count.
  -- Hash: the per-address limit is the primary control; an address adds at most its own 8 to the
  -- firm count, so the firm cap (a backstop sized for a busy page) needs many addresses to reach.
  insert into public.booking_hold_attempts (organization_id, client_hash) values (et.organization_id, hash);
  if (select count(*) from public.booking_hold_attempts a
      where a.client_hash = hash and a.created_at > now() - interval '10 minutes') > 8
     or (select coalesce(sum(least(per_address.n, 8)), 0) from (
           select count(*) as n from public.booking_hold_attempts a
           where a.organization_id = et.organization_id and a.created_at > now() - interval '10 minutes'
           group by a.client_hash
         ) per_address) > 60 then
    return jsonb_build_object('error', 'booking_rate_limited');
  end if;

  if p_name is null or length(btrim(p_name)) not between 1 and 200 then
    return jsonb_build_object('error', 'name_required');
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 320 then
    return jsonb_build_object('error', 'email_invalid');
  end if;
  if p_phone is not null and btrim(p_phone) <> '' and btrim(p_phone) !~ '^[0-9+() .-]{3,40}$' then
    return jsonb_build_object('error', 'phone_invalid');
  end if;
  if not app.is_time_zone(zone) then
    return jsonb_build_object('error', 'time_zone_invalid');
  end if;

  -- A signed-in portal client of this firm booking for themselves is linked to their own person,
  -- when the session has their second step (if they have one) (20261030223000).
  -- Viewer: the signed-in visitor and their session's assurance level are named by the server
  -- from the verified session token.
  if p_viewer is not null
     and (
       p_viewer_aal = 'aal2'
       or not exists (
         select 1 from auth.mfa_factors factor
         where factor.user_id = p_viewer and factor.status::text = 'verified'
       )
     ) then
    select person.id into me
    from public.persons person
    where person.organization_id = et.organization_id and person.user_id = p_viewer;
  end if;

  -- practice booking pages: a booking on a practice page is a sample booking.
  bid := app.place_booking(et.id, p_start, p_name, v_email, p_phone, zone, me, 'public', 'client', key, et.is_sample, true);
  if bid is null then
    perform app.booking_audit(et.organization_id, 'booking.slot_unavailable', null, 'denied',
      jsonb_build_object('event_type_id', et.id, 'starts_at', p_start));
    return jsonb_build_object('error', 'slot_unavailable');
  end if;
  perform app.confirm_booking(bid, 'client');
  -- booking type agreement: the type's approved consultation agreement is sent with the booking,
  -- for the booker to sign from the confirmation page or the email.
  if et.agreement_template_id is not null then
    perform app.issue_booking_agreement(bid, et.agreement_template_id, null, false);
  end if;
  return app.booking_summary(bid);
end;
$$;
revoke all on function public.booking_public_hold(text, text, timestamptz, text, text, text, text, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.booking_public_hold(text, text, timestamptz, text, text, text, text, text, text, uuid, text) to service_role;
