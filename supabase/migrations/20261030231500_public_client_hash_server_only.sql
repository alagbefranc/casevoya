-- Public booking holds and enquiries: the client-address hash comes from the app server only.
--
-- The per-address rate limit of public.booking_public_hold and public.submit_enquiry keys on
-- p_client_hash, which the route handlers compute from the request address
-- (src/app/api/book/[firm]/[event]/hold/route.ts, src/app/api/enquiry/[firm]/route.ts). The
-- functions are now service role only, so the hash cannot be chosen by the caller:
--   * public.booking_public_hold(... 9 arguments) and public.submit_enquiry (15 and 16 arguments)
--     lose their anon / authenticated grants and are granted to service_role. They keep working
--     for the service role (no viewer).
--   * New overloads take p_viewer: the signed-in visitor's user id, which the server reads from
--     the visitor's verified session (null when signed out). It replaces auth.uid() inside the
--     functions: a practice page (sample mode) is served when p_viewer is active staff of the
--     firm, a portal client booking for themselves is linked to their person, and the enquiry's
--     audit row names them. Staff MFA for a practice page is checked by the database on the
--     visitor's own session first (booking_public_event / enquiry_public_firm answer a practice
--     page only to app.booking_practice_viewer); the server calls the service role after that.
--   * A missing or malformed hash goes to one shared "unknown address" bucket with the same
--     limit as one address, instead of skipping the per-address limit.
--   * The per-firm cap stays (60 holds / 100 enquiries per 10 minutes) as a backstop; the
--     per-address limit is the primary control. Each address now counts toward the firm cap with
--     at most its own allowance (8 / 5), so one address that keeps retrying cannot fill it.
-- Bodies are copied from their latest definitions (booking_public_hold:
-- 20261028120000_firm_privacy_notice.sql; submit_enquiry: 20261024140000_enquiry_page_controls.sql)
-- with only the marked changes ("Hash:", "Viewer:", "Service:").

-- ---------------------------------------------------------------------------
-- Helpers (private)
-- ---------------------------------------------------------------------------

-- A well-formed client hash (64 lower-case hex), or the shared bucket for requests without one.
create or replace function app.public_client_bucket(p_client_hash text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when lower(btrim(coalesce(p_client_hash, ''))) ~ '^[0-9a-f]{64}$' then lower(btrim(p_client_hash))
    else repeat('0', 64)
  end;
$$;
revoke all on function app.public_client_bucket(text) from public, anon, authenticated;

-- The server-supplied viewer is active staff of the firm (any staff role).
create or replace function app.public_viewer_is_staff(p_org uuid, p_viewer uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_org is not null and p_viewer is not null and exists (
    select 1 from public.memberships m
    where m.organization_id = p_org
      and m.user_id = p_viewer
      and m.status = 'active'
      and m.role = any (app.staff_roles())
  );
$$;
revoke all on function app.public_viewer_is_staff(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- public.booking_public_hold
-- ---------------------------------------------------------------------------

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
comment on function public.booking_public_hold(text, text, timestamptz, text, text, text, text, text, text, uuid, text) is
  'Public booking hold, service role only: the app server passes the client-address hash it computed and the signed-in visitor (p_viewer, or null) with their session assurance level (p_viewer_aal).';
revoke all on function public.booking_public_hold(text, text, timestamptz, text, text, text, text, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.booking_public_hold(text, text, timestamptz, text, text, text, text, text, text, uuid, text) to service_role;

-- The 9-argument form: service role only, no viewer.
create or replace function public.booking_public_hold(
  p_firm_slug text,
  p_event_slug text,
  p_start timestamptz,
  p_name text,
  p_email text,
  p_phone text,
  p_time_zone text,
  p_idempotency_key text,
  p_client_hash text
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.booking_public_hold(p_firm_slug, p_event_slug, p_start, p_name, p_email, p_phone, p_time_zone,
    p_idempotency_key, p_client_hash, null::uuid, null::text);
$$;
revoke all on function public.booking_public_hold(text, text, timestamptz, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.booking_public_hold(text, text, timestamptz, text, text, text, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- public.submit_enquiry
-- ---------------------------------------------------------------------------

create or replace function public.submit_enquiry(
  p_firm_slug text,
  p_name text,
  p_contact text,
  p_preferred_contact text,
  p_service_interest text,
  p_country_now text,
  p_language text,
  p_reply_consent boolean,
  p_reply_statement text,
  p_marketing_consent boolean,
  p_marketing_statement text,
  p_consent_version text,
  p_source public.lead_source,
  p_idempotency_key text,
  p_client_hash text,
  p_attribution jsonb,
  p_viewer uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  org public.organizations%rowtype;
  key text := btrim(coalesce(p_idempotency_key, ''));
  -- Hash: always a bucket; a missing or malformed hash shares one.
  hash text := app.public_client_bucket(p_client_hash);
  v_name text := app.lead_text(p_name, 400);
  v_contact text := app.lead_text(p_contact, 400);
  v_email text;
  v_phone text;
  v_problem text;
  v_stage uuid;
  v_id uuid := gen_random_uuid();
  v_via text;
  v_version text := app.lead_text(p_consent_version, 40);
  v_sample boolean;
  v_attribution jsonb := app.enquiry_attribution(p_attribution);
  -- Viewer: the signed-in visitor named by the server, when it is a real user.
  v_viewer uuid := (select u.id from auth.users u where u.id = p_viewer);
begin
  -- Service: only the app server calls this (it computes the hash).
  perform app.require_service_role();
  select * into org from public.organizations o where o.slug = lower(btrim(coalesce(p_firm_slug, '')));
  if org.id is null
     or (org.sample_mode is true and not app.public_viewer_is_staff(org.id, v_viewer))
     or not exists (
       select 1 from public.portal_policy_documents doc where doc.organization_id = org.id and doc.kind = 'privacy_notice'
     ) then
    return jsonb_build_object('error', 'form_unavailable');
  end if;
  -- CRM-01: the firm turned its enquiry page off in Settings.
  if org.enquiry_page_enabled is not true then
    return jsonb_build_object('error', 'form_closed');
  end if;
  v_sample := coalesce(org.sample_mode, false);
  if p_source is null or p_source not in ('web_form', 'hosted_page') then
    raise exception 'choose the form' using errcode = '22023';
  end if;
  if length(key) not between 8 and 180 then
    raise exception 'idempotency key is required' using errcode = '22023';
  end if;
  if v_version is not null and v_version !~ '^[A-Za-z0-9._-]{1,40}$' then
    v_version := null;
  end if;
  if exists (select 1 from public.leads l where l.organization_id = org.id and l.submission_key = key) then
    return jsonb_build_object('ok', true);
  end if;

  -- Abuse limits: 5 enquiries per client address and 100 per firm in 10 minutes.
  -- Hash: the per-address limit is the primary control; an address adds at most its own 5 to the
  -- firm count, so the firm cap stays a backstop.
  insert into public.lead_enquiry_attempts (organization_id, client_hash) values (org.id, hash);
  if (select count(*) from public.lead_enquiry_attempts a
      where a.client_hash = hash and a.created_at > now() - interval '10 minutes') > 5
     or (select coalesce(sum(least(per_address.n, 5)), 0) from (
           select count(*) as n from public.lead_enquiry_attempts a
           where a.organization_id = org.id and a.created_at > now() - interval '10 minutes'
           group by a.client_hash
         ) per_address) > 100 then
    return jsonb_build_object('error', 'enquiry_rate_limited');
  end if;

  if v_name is null or length(v_name) > 200 then
    return jsonb_build_object('error', 'name_required');
  end if;
  if v_contact is null then
    return jsonb_build_object('error', 'contact_required');
  end if;
  if position('@' in v_contact) > 0 then
    v_email := lower(v_contact);
  else
    v_phone := v_contact;
  end if;
  v_problem := app.lead_contact_problem(v_name, v_email, v_phone);
  if v_problem is not null then
    return jsonb_build_object('error', case when v_email is not null then 'email_invalid' else 'phone_invalid' end);
  end if;
  if p_reply_consent is distinct from true or app.lead_text(p_reply_statement, 600) is null then
    return jsonb_build_object('error', 'consent_required');
  end if;
  if length(p_reply_statement) > 500 or (p_marketing_consent is true and (p_marketing_statement is null or length(p_marketing_statement) not between 1 and 500)) then
    raise exception 'consent statement is invalid' using errcode = '22023';
  end if;
  v_stage := app.lead_stage_of_kind(org.id, 'open');
  if v_stage is null then
    return jsonb_build_object('error', 'form_unavailable');
  end if;
  v_via := p_source::text;

  insert into public.leads (id, organization_id, display_name, email, phone, preferred_contact, service_interest, country_now, language,
                            source, source_detail, attribution, stage_id, submission_key, is_sample)
  values (v_id, org.id, v_name, v_email, v_phone,
          case when p_preferred_contact in ('email', 'phone') then p_preferred_contact end,
          app.lead_text(p_service_interest, 120), app.lead_text(p_country_now, 100), app.lead_text(p_language, 100),
          p_source, left(nullif(v_attribution ->> 'utm_source', ''), 200), v_attribution, v_stage, key, v_sample);
  insert into public.lead_consents (organization_id, lead_id, purpose, granted, statement_text, statement_sha256, policy_version, captured_via)
  values (org.id, v_id, 'enquiry_reply', true, p_reply_statement, app.lead_sha256(p_reply_statement), v_version, v_via);
  if p_marketing_consent is true then
    insert into public.lead_consents (organization_id, lead_id, purpose, granted, statement_text, statement_sha256, policy_version, captured_via)
    values (org.id, v_id, 'marketing', true, p_marketing_statement, app.lead_sha256(p_marketing_statement), v_version, v_via);
  end if;
  perform app.lead_event(org.id, v_id, 'created', null, v_stage, null, jsonb_build_object('source', p_source));
  -- Viewer: the audit row names the signed-in visitor (null when signed out).
  insert into public.audit_log (organization_id, actor_user_id, actor_type, action, object_table, object_id, result, request_id, context)
  values (org.id, v_viewer, app.current_actor_type(), 'lead.enquiry_received', 'public.leads', v_id, 'success',
          app.current_request_id(), jsonb_build_object('source', p_source, 'marketing', coalesce(p_marketing_consent, false), 'sample', v_sample,
            'attributed', v_attribution <> '{}'::jsonb));
  return jsonb_build_object('ok', true);
end;
$$;
comment on function public.submit_enquiry(text, text, text, text, text, text, text, boolean, text, boolean, text, text, public.lead_source, text, text, jsonb, uuid) is
  'Public enquiry, service role only: the app server passes the client-address hash it computed and the signed-in visitor (p_viewer, or null).';
revoke all on function public.submit_enquiry(text, text, text, text, text, text, text, boolean, text, boolean, text, text, public.lead_source, text, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.submit_enquiry(text, text, text, text, text, text, text, boolean, text, boolean, text, text, public.lead_source, text, text, jsonb, uuid) to service_role;

-- The 16-argument form: service role only, no viewer.
create or replace function public.submit_enquiry(
  p_firm_slug text,
  p_name text,
  p_contact text,
  p_preferred_contact text,
  p_service_interest text,
  p_country_now text,
  p_language text,
  p_reply_consent boolean,
  p_reply_statement text,
  p_marketing_consent boolean,
  p_marketing_statement text,
  p_consent_version text,
  p_source public.lead_source,
  p_idempotency_key text,
  p_client_hash text,
  p_attribution jsonb
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.submit_enquiry(p_firm_slug, p_name, p_contact, p_preferred_contact, p_service_interest, p_country_now, p_language,
    p_reply_consent, p_reply_statement, p_marketing_consent, p_marketing_statement, p_consent_version, p_source, p_idempotency_key,
    p_client_hash, p_attribution, null::uuid);
$$;
revoke all on function public.submit_enquiry(text, text, text, text, text, text, text, boolean, text, boolean, text, text, public.lead_source, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.submit_enquiry(text, text, text, text, text, text, text, boolean, text, boolean, text, text, public.lead_source, text, text, jsonb) to service_role;

-- The 15-argument form (20261024140000, calls the 16-argument form): service role only.
revoke all on function public.submit_enquiry(text, text, text, text, text, text, text, boolean, text, boolean, text, text, public.lead_source, text, text) from public, anon, authenticated;
grant execute on function public.submit_enquiry(text, text, text, text, text, text, text, boolean, text, boolean, text, text, public.lead_source, text, text) to service_role;
