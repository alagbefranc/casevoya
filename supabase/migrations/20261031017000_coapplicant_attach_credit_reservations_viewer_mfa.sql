-- Second-pass review fixes (R2-01, R2-04, R2-05, R2-06). Additive only; each function is copied
-- from its latest definition (named above it) and only the marked lines change.
--
-- R2-01 app.attach_upload_to_request (only definition 20261017180100_document_requests.sql): on the
--   co-applicant path (not the person, not staff with step-up, not the email ingest) the target
--   request itself must be matter-visible, ordinary and in the caller's firm, have the purpose of
--   the version's document, and pass app.actor_may_fulfil_request_upload (20261030235000) for its
--   own document. Marked "Request".
--
-- R2-04 Client credits and card refund reservations (20261030230000):
--   * invoice_refund_reservations.client_credit_id: the credit a card refund is taken from.
--   * app.invoice_pending_card_refunds_cents (20261025130000) also counts active reservations of
--     the invoice, so app.client_credit_available_cents, app.apply_client_credit,
--     app.record_client_credit_bank_refund ("still pending at Stripe") and the refund context
--     count an in-flight card refund. Those functions lock the credit, then the source invoice;
--     reservations lock the invoice first, so the checks are serialised.
--   * app.reserve_client_credit_refund (new): locks the credit, checks the amount against the
--     credit available (less every active reservation of the invoice), then reserves through
--     app.reserve_invoice_refund and ties the reservation to the credit.
--   * app.link_client_credit_refund (20261025130000): the refund must be live; a refund with a
--     reservation naming a credit must have been reserved from this credit; one without a
--     reservation, or with a reservation naming no credit (reserved by the previous app), must fit
--     the invoice's overpayment together with the other in-flight refunds, and such a
--     reservation is then tied to this credit.
--
-- R2-05 A linked reservation is active for 7 days (expires_at is moved forward when it is linked),
--   then stops counting. app.payment_reservable_cents and app.link_invoice_refund_reservation
--   (20261030230000) are redefined; linking needs the staff member who reserved, refuses a released
--   reservation and a refund id already held by another reservation. Existing linked rows get
--   7 days from their last change. app.release_invoice_refund_reservation is unchanged.
--
-- R2-06 Practice pages (sample mode) on the service-role hold and enquiry (20261030231500) again
--   need staff MFA in the database: the server passes the visitor's assurance from their own
--   verified session ('aal2', or 'mfa' when public.session_mfa_satisfied() holds on that session:
--   passkey or recovery code). app.public_viewer_is_staff takes it. The booking link to a portal
--   client's person accepts the same assurance as app.session_assurance_ok. submit_enquiry gains
--   an 18-argument form with p_viewer_aal; the 17-argument form calls it with no assurance, which
--   uses the 2-argument app.public_viewer_is_staff (membership only, kept for the previous app
--   during the deploy window; 20261031090000 makes it always false).

-- ---------------------------------------------------------------------------
-- R2-01 Co-applicant attach bound to the target request
-- ---------------------------------------------------------------------------

create or replace function app.attach_upload_to_request(p_version_id uuid, p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  version public.document_versions%rowtype;
  request public.document_requests%rowtype;
  ext text;
begin
  select * into version from public.document_versions where id = p_version_id for update;
  select * into request from public.document_requests where id = p_request_id for update;
  if version.id is null or request.id is null
     or version.organization_id is distinct from request.organization_id
     or version.created_by is distinct from (select auth.uid())
     or version.upload_state is distinct from 'uploading'
     or request.status is distinct from 'open' then
    raise exception 'document upload denied' using errcode = '42501';
  end if;
  if app.actor_can_upload_for(request.matter_id, request.person_id) is distinct from true then
    raise exception 'document upload denied' using errcode = '42501';
  end if;
  -- Request: someone else on the matter (not the person, not staff, not the email ingest) may
  -- attach only to this request when it is one they can fulfil, with the document's purpose.
  if request.organization_id is distinct from app.email_ingest_org()
     and not (
       exists (
         select 1
         from public.persons person
         where person.id = request.person_id
           and person.user_id = (select auth.uid())
       )
       and app.session_assurance_ok()
     )
     and not (
       app.staff_mfa_satisfied()
       and app.mfa_step_up_satisfied()
       and app.has_org_role(
         request.organization_id,
         array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[]
       )
       and app.can_read_matter(request.matter_id)
     ) then
    if request.audience is distinct from 'matter'
       or request.sensitivity is distinct from 'ordinary'
       or request.organization_id is distinct from (select app.current_organization_id())
       or not exists (
         select 1
         from public.documents doc
         where doc.id = version.document_id
           and btrim(doc.purpose) = btrim(request.purpose)
       )
       or app.actor_may_fulfil_request_upload(request.matter_id, request.person_id, request.purpose, request.document_id) is distinct from true then
      raise exception 'document upload denied' using errcode = '42501';
    end if;
  end if;
  if not exists (
    select 1
    from public.documents doc
    where doc.id = version.document_id
      and doc.person_id = request.person_id
      and doc.organization_id = request.organization_id
  ) then
    raise exception 'document upload denied' using errcode = '42501';
  end if;
  if request.document_id is not null and request.document_id is distinct from version.document_id then
    raise exception 'a replacement must be a new version of the same document' using errcode = '22023';
  end if;
  ext := lower(regexp_replace(version.original_filename, '^.*\.', ''));
  if ext = 'jpg' then
    ext := 'jpeg';
  elsif ext = 'heif' then
    ext := 'heic';
  end if;
  if not (ext = any (request.acceptable_formats)) then
    raise exception 'that format is not acceptable for this request' using errcode = '22023';
  end if;

  perform app.open_document_write(version.id);
  update public.document_versions
  set request_id = request.id
  where id = version.id;
  perform app.close_document_write(version.id);

  perform app.open_document_write(request.id);
  update public.document_requests
  set document_id = version.document_id,
      audience = request.audience,
      sensitivity = request.sensitivity
  where id = request.id;
  perform app.close_document_write(request.id);

  perform app.open_document_write(version.document_id);
  update public.documents
  set audience = request.audience,
      sensitivity = request.sensitivity,
      purpose = request.purpose
  where id = version.document_id;
  perform app.close_document_write(version.document_id);
end;
$$;
revoke all on function app.attach_upload_to_request(uuid, uuid) from public;
grant execute on function app.attach_upload_to_request(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- R2-05 / R2-04 Reservations: linked expiry, credit tie
-- ---------------------------------------------------------------------------

alter table public.invoice_refund_reservations add column if not exists client_credit_id uuid;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'invoice_refund_reservations_client_credit_fk'
      and conrelid = 'public.invoice_refund_reservations'::regclass
  ) then
    alter table public.invoice_refund_reservations
      add constraint invoice_refund_reservations_client_credit_fk
      foreign key (client_credit_id, organization_id) references public.client_credits (id, organization_id);
  end if;
end;
$$;
create index if not exists invoice_refund_reservations_credit_org_fk_idx
  on public.invoice_refund_reservations (client_credit_id, organization_id);
comment on column public.invoice_refund_reservations.client_credit_id is
  'The client credit this card refund is taken from (app.reserve_client_credit_refund); null for a payment refund.';

-- Linked rows made before this migration: 7 days from their last change.
update public.invoice_refund_reservations
set expires_at = greatest(expires_at, updated_at + interval '7 days')
where status = 'linked';

-- From 20261030230000. Changed: a linked reservation counts only until expires_at.
create or replace function app.payment_reservable_cents(p_payment_id uuid, p_exclude_reservation uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(
    least(
      payment.amount_received_cents - coalesce((
        select sum(refund.amount_cents)
        from public.invoice_refunds refund
        where refund.payment_id = payment.id
          and refund.status in ('pending', 'requires_action', 'succeeded')
      ), 0) - coalesce((
        select sum(held.amount_cents)
        from public.invoice_refund_reservations held
        where held.payment_id = payment.id
          and held.id is distinct from p_exclude_reservation
          and held.status in ('pending', 'linked') and held.expires_at > now()
      ), 0),
      invoice.paid_cents - invoice.refunded_cents - coalesce((
        select sum(refund.amount_cents)
        from public.invoice_refunds refund
        where refund.invoice_id = invoice.id
          and refund.status in ('pending', 'requires_action')
      ), 0) - coalesce((
        select sum(held.amount_cents)
        from public.invoice_refund_reservations held
        where held.invoice_id = invoice.id
          and held.id is distinct from p_exclude_reservation
          and held.status in ('pending', 'linked') and held.expires_at > now()
      ), 0)
    ),
    0
  )::bigint
  from public.invoice_payments payment
  join public.invoices invoice on invoice.id = payment.invoice_id
  where payment.id = p_payment_id;
$$;
revoke all on function app.payment_reservable_cents(uuid, uuid) from public, anon, authenticated;

-- From 20261030230000. Changed: marked "Link".
create or replace function app.link_invoice_refund_reservation(p_reservation_id uuid, p_refund_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  held public.invoice_refund_reservations%rowtype;
  recorded public.invoice_refunds%rowtype;
  refund_key text := btrim(coalesce(p_refund_id, ''));
begin
  select * into held from public.invoice_refund_reservations where id = p_reservation_id;
  if held.id is null then
    raise exception 'billing access denied' using errcode = '42501';
  end if;
  perform app.require_refund_access(held.payment_id);
  if refund_key !~ '^(re|pyr)_[A-Za-z0-9]{6,250}$' then
    raise exception 'stripe refund id is invalid' using errcode = '22023';
  end if;
  perform 1 from public.invoices where id = held.invoice_id for update;
  select * into held from public.invoice_refund_reservations where id = p_reservation_id for update;
  if held.refund_id is not null then
    if held.refund_id <> refund_key then
      raise exception 'refund belongs to another payment' using errcode = '42501';
    end if;
    return;
  end if;
  if held.status = 'consumed' then
    return;
  end if;
  -- Link: only the staff member who reserved it links it, and not after it was released.
  if held.requested_by is distinct from (select auth.uid()) then
    raise exception 'billing access denied' using errcode = '42501';
  end if;
  if held.status = 'released' then
    raise exception 'refund reservation was released' using errcode = '55000';
  end if;
  -- Link: a refund id names one reservation.
  if exists (
    select 1 from public.invoice_refund_reservations other
    where other.refund_id = refund_key and other.id <> held.id
  ) then
    raise exception 'refund belongs to another payment' using errcode = '42501';
  end if;
  select * into recorded from public.invoice_refunds where refund_id = refund_key;
  if recorded.id is not null then
    if recorded.payment_id <> held.payment_id then
      raise exception 'refund belongs to another payment' using errcode = '42501';
    end if;
    -- Stripe's event recorded it first: the refund row already counts it.
    update public.invoice_refund_reservations
    set status = 'consumed', refund_id = refund_key, invoice_refund_id = recorded.id, updated_at = now()
    where id = held.id;
    return;
  end if;
  -- Link: held until the refund row is recorded, for at most 7 days.
  update public.invoice_refund_reservations
  set status = 'linked', refund_id = refund_key, expires_at = now() + interval '7 days', updated_at = now()
  where id = held.id;
end;
$function$;
revoke all on function app.link_invoice_refund_reservation(uuid, text) from public, anon;
grant execute on function app.link_invoice_refund_reservation(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- R2-04 Client-credit paths count reservations
-- ---------------------------------------------------------------------------

-- From 20261025130000. Changed: active card refund reservations of the invoice count too.
create or replace function app.invoice_pending_card_refunds_cents(p_invoice_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select (
    coalesce((
      select sum(refund.amount_cents)
      from public.invoice_refunds refund
      where refund.invoice_id = p_invoice_id
        and refund.status in ('pending', 'requires_action')
    ), 0)
    + coalesce((
      select sum(held.amount_cents)
      from public.invoice_refund_reservations held
      where held.invoice_id = p_invoice_id
        and held.status in ('pending', 'linked')
        and held.expires_at > now()
    ), 0)
  )::bigint;
$$;
revoke all on function app.invoice_pending_card_refunds_cents(uuid) from public, anon;
grant execute on function app.invoice_pending_card_refunds_cents(uuid) to authenticated, service_role;

-- A card refund of a client credit: the credit is locked and the amount must fit what the credit
-- has left (less every active reservation of its invoice); the reservation names the credit.
create or replace function app.reserve_client_credit_refund(
  p_credit_id uuid,
  p_payment_id uuid,
  p_amount_cents bigint,
  p_currency text,
  p_livemode boolean,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  credit public.client_credits%rowtype;
  payment public.invoice_payments%rowtype;
  existing public.invoice_refund_reservations%rowtype;
  key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  rid uuid;
begin
  -- Lock order: credit, then invoice (then payment, in app.reserve_invoice_refund).
  credit := app.require_client_credit_access(p_credit_id);
  select * into payment from public.invoice_payments where id = p_payment_id;
  if payment.id is null or payment.invoice_id is distinct from credit.source_invoice_id
     or payment.organization_id is distinct from credit.organization_id then
    raise exception 'that payment is not on this credit''s invoice' using errcode = '22023';
  end if;
  if key is null or length(key) not between 8 and 180 then
    raise exception 'idempotency key is invalid' using errcode = '22023';
  end if;
  perform 1 from public.invoices where id = credit.source_invoice_id for update;
  select * into existing from public.invoice_refund_reservations
  where organization_id = credit.organization_id and idempotency_key = key
  for update;
  if existing.id is not null and existing.client_credit_id is distinct from credit.id then
    raise exception 'idempotency key was used for another refund' using errcode = '23505';
  end if;
  -- A new hold (or a released or expired one held again) must fit the credit. A pending hold
  -- of this key is refused, and an answered one returned, by app.reserve_invoice_refund.
  if (existing.id is null or existing.status = 'released'
      or (existing.status = 'pending' and existing.expires_at <= now()))
     and (p_amount_cents is null or p_amount_cents > app.client_credit_available_cents(credit.id)) then
    raise exception 'amount is more than the credit available' using errcode = '22023';
  end if;
  rid := app.reserve_invoice_refund(p_payment_id, p_amount_cents, p_currency, p_livemode, key);
  update public.invoice_refund_reservations
  set client_credit_id = credit.id, updated_at = now()
  where id = rid and client_credit_id is null;
  return rid;
end;
$function$;
revoke all on function app.reserve_client_credit_refund(uuid, uuid, bigint, text, boolean, text) from public, anon;
grant execute on function app.reserve_client_credit_refund(uuid, uuid, bigint, text, boolean, text) to authenticated;

create or replace function public.reserve_client_credit_refund(
  p_credit_id uuid,
  p_payment_id uuid,
  p_amount_cents bigint,
  p_currency text,
  p_livemode boolean,
  p_idempotency_key text
)
returns uuid language sql security invoker set search_path = ''
as $$ select app.reserve_client_credit_refund(p_credit_id, p_payment_id, p_amount_cents, p_currency, p_livemode, p_idempotency_key); $$;
revoke all on function public.reserve_client_credit_refund(uuid, uuid, bigint, text, boolean, text) from public, anon;
grant execute on function public.reserve_client_credit_refund(uuid, uuid, bigint, text, boolean, text) to authenticated;

-- From 20261025130000. Changed: marked "Credit".
create or replace function app.link_client_credit_refund(p_credit_id uuid, p_refund_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  credit public.client_credits%rowtype;
  refund public.invoice_refunds%rowtype;
  held public.invoice_refund_reservations%rowtype;
  existing uuid;
  rid uuid;
begin
  credit := app.require_client_credit_access(p_credit_id);
  select * into refund from public.invoice_refunds where id = p_refund_id;
  if refund.id is null or refund.invoice_id <> credit.source_invoice_id then
    raise exception 'that refund is not from this credit''s invoice' using errcode = '22023';
  end if;
  select allocation.id into existing from public.client_credit_allocations allocation where allocation.refund_id = refund.id;
  if existing is not null then
    return existing;
  end if;
  -- Credit: a live refund, reserved from this credit; a refund recorded without a reservation
  -- must fit the invoice's overpayment together with the other in-flight card refunds.
  perform 1 from public.invoices where id = credit.source_invoice_id for update;
  if refund.status not in ('pending', 'requires_action', 'succeeded') then
    raise exception 'that refund is not from this credit''s invoice' using errcode = '22023';
  end if;
  select * into held from public.invoice_refund_reservations
  where invoice_refund_id = refund.id or refund_id = refund.refund_id
  order by (invoice_refund_id = refund.id) desc nulls last
  limit 1;
  -- Credit: a reservation naming no credit (made through app.reserve_invoice_refund by the
  -- previous app) is checked like a refund without one, then tied to this credit.
  if held.id is not null and held.client_credit_id is not null then
    if held.client_credit_id is distinct from credit.id then
      raise exception 'that refund was not taken from this credit' using errcode = '22023';
    end if;
  else
    if app.invoice_overpaid_cents(credit.source_invoice_id) - app.invoice_pending_card_refunds_cents(credit.source_invoice_id) < 0 then
      raise exception 'amount is more than the credit available' using errcode = '22023';
    end if;
    if held.id is not null then
      update public.invoice_refund_reservations
      set client_credit_id = credit.id, updated_at = now()
      where id = held.id and client_credit_id is null;
    end if;
  end if;
  insert into public.client_credit_allocations (organization_id, credit_id, kind, refund_id, amount_cents, currency)
  values (credit.organization_id, credit.id, 'card_refund', refund.id, refund.amount_cents, refund.currency)
  returning id into rid;
  perform app.record_audit_event(
    credit.organization_id, 'invoice.client_credit_card_refund', 'public.client_credits', credit.id, 'success',
    jsonb_build_object('allocation_id', rid, 'refund_id', refund.id, 'amount_cents', refund.amount_cents, 'currency', refund.currency)
  );
  return rid;
end;
$$;
revoke all on function app.link_client_credit_refund(uuid, uuid) from public, anon;
grant execute on function app.link_client_credit_refund(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- R2-06 Practice pages need staff MFA, checked from the server-named assurance
-- ---------------------------------------------------------------------------

-- The assurance the server read from the visitor's own session: 'aal2', or 'mfa' when
-- public.session_mfa_satisfied() held on it (passkey or recovery code).
create or replace function app.public_viewer_assured(p_viewer_aal text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_viewer_aal in ('aal2', 'mfa'), false);
$$;
revoke all on function app.public_viewer_assured(text) from public, anon, authenticated;

-- Active staff of the firm (any staff role) with staff MFA on the session the server read.
create or replace function app.public_viewer_is_staff(p_org uuid, p_viewer uuid, p_viewer_aal text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_org is not null and p_viewer is not null
    and app.public_viewer_assured(p_viewer_aal)
    and exists (
      select 1 from public.memberships m
      where m.organization_id = p_org
        and m.user_id = p_viewer
        and m.status = 'active'
        and m.role = any (app.staff_roles())
    );
$$;
revoke all on function app.public_viewer_is_staff(uuid, uuid, text) from public, anon, authenticated;

-- From 20261030231500, unchanged here: the previous app's 17-argument submit_enquiry passes no
-- assurance and still uses this membership-only form until 20261031090000_post_deploy_revokes.sql
-- makes it always false (applied after the app that passes p_viewer_aal is deployed).
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

-- From 20261030231500. Changed: marked "Assurance".
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
    -- Assurance: a practice page is for the firm's staff with staff MFA, named by the server.
    and (not et2.is_sample or app.public_viewer_is_staff(et2.organization_id, p_viewer, p_viewer_aal))
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
  -- Assurance: aal2, passkey or recovery code ('mfa'), as app.session_assurance_ok accepts.
  if p_viewer is not null
     and (
       app.public_viewer_assured(p_viewer_aal)
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
  'Public booking hold, service role only: the app server passes the client-address hash it computed and the signed-in visitor (p_viewer, or null) with their session assurance (p_viewer_aal: aal1, aal2 or mfa).';
revoke all on function public.booking_public_hold(text, text, timestamptz, text, text, text, text, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.booking_public_hold(text, text, timestamptz, text, text, text, text, text, text, uuid, text) to service_role;

-- The 18-argument form: the 17-argument body of 20261030231500 plus p_viewer_aal ("Assurance").
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
  p_viewer uuid,
  p_viewer_aal text
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
     -- Assurance: a practice enquiry is for the firm's staff with staff MFA. With no assurance
     -- level (the 17-argument form) the 2-argument check applies; it is always false once
     -- 20261031090000 is applied. The app names an assurance whenever it names a viewer.
     or (org.sample_mode is true and not (
       case
         when p_viewer_aal is null then app.public_viewer_is_staff(org.id, v_viewer)
         else app.public_viewer_is_staff(org.id, v_viewer, p_viewer_aal)
       end
     ))
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
comment on function public.submit_enquiry(text, text, text, text, text, text, text, boolean, text, boolean, text, text, public.lead_source, text, text, jsonb, uuid, text) is
  'Public enquiry, service role only: the app server passes the client-address hash it computed and the signed-in visitor (p_viewer, or null) with their session assurance (p_viewer_aal: aal1, aal2 or mfa).';
revoke all on function public.submit_enquiry(text, text, text, text, text, text, text, boolean, text, boolean, text, text, public.lead_source, text, text, jsonb, uuid, text) from public, anon, authenticated;
grant execute on function public.submit_enquiry(text, text, text, text, text, text, text, boolean, text, boolean, text, text, public.lead_source, text, text, jsonb, uuid, text) to service_role;

-- The 17-argument form: service role only, the viewer without an assurance level.
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
language sql
security definer
set search_path = ''
as $$
  select public.submit_enquiry(p_firm_slug, p_name, p_contact, p_preferred_contact, p_service_interest, p_country_now, p_language,
    p_reply_consent, p_reply_statement, p_marketing_consent, p_marketing_statement, p_consent_version, p_source, p_idempotency_key,
    p_client_hash, p_attribution, p_viewer, null::text);
$$;
revoke all on function public.submit_enquiry(text, text, text, text, text, text, text, boolean, text, boolean, text, text, public.lead_source, text, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.submit_enquiry(text, text, text, text, text, text, text, boolean, text, boolean, text, text, public.lead_source, text, text, jsonb, uuid) to service_role;
