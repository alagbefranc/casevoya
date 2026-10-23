-- Consultation agreement signing flow (spec: docs/specs/consultation-agreement-states.md, #166).
--
-- The booker's private link now runs the designed flow: landing, a six-digit code emailed to the
-- primary attendee, review, a typed / drawn / uploaded signature, confirm, done. Or decline.
--
-- * booking_agreement_codes: one row per code sent. Only the code's SHA-256 is stored, and the
--   SHA-256 of the session token handed out when it is verified. Forced RLS, no policies: only
--   the definer functions below read it. A code works for 10 minutes and three attempts; the
--   newest code is the only one that verifies (pending Francis: 10 minutes, three attempts).
-- * public.issue_booking_agreement_code(ref, code_id, code_sha256, sealed) (anon): the app server
--   makes the code and its id, seals the code to that id with the mail secret (AES-GCM, the
--   invitation-link scheme) and passes the sealed form and the hash; the database never sees the code. Queues booking_agreement.code
--   (EX16) to the primary attendee. One code per 30 seconds and ten an hour per agreement.
--   Answers 'notices_off' (the firm has email notices off for this person) instead of sending.
-- * public.verify_booking_agreement_code(ref, code_sha256, session_sha256) (anon): ok, wrong
--   (with tries left), locked, expired or none. On ok it stores the session token's hash.
-- * public.sign_booking_agreement(ref, name, consent, sha256, ip, user_agent, session_sha256,
--   signature_kind, signature_image base64) (anon): the existing checks plus a verified code
--   session from the last two hours, and a typed, drawn or uploaded signature. A drawn or uploaded
--   signature is a PNG or JPEG of at most 1.5 MB (engineering default, pending Francis), stored on
--   the agreement row (staff-readable, never a public URL). The six-argument version from
--   20261023170000 now refuses: signing needs the code check.
-- * Decline: status 'declined' with declined_at and decline_reason (the booker's words, 1 to 500
--   characters, which the firm sees). public.decline_booking_agreement(ref, reason) (anon).
--   A declined row is not live, so the firm can send a new one.
-- * public.note_booking_agreement_request(ref, kind) (anon): "Not you?", "Can't get the email?",
--   "Ask for a new link" and "Message the firm" are recorded on the agreement (last_request_kind,
--   last_request_at) for the staff record, and audited booking_agreement.<kind>.
-- * public.booking_agreement_for_signing (from 20261023210000_booking_agreement_panel.sql): adds
--   the firm slug (for its logo), the masked email, the stored signature for a signed agreement,
--   and the 'declined' state (firm, the booker's reason, when; never the text or the hash).
-- * app.scrub_invitation_link also drops sealed_code once mail is final; claim_mail_events and
--   prepare_email_delivery (from 20261023190000_booking_agreement_mail.sql) send EX16.
-- Additive only (one check constraint is replaced to allow 'declined').

alter table public.booking_agreements drop constraint booking_agreements_status_check;
alter table public.booking_agreements
  add constraint booking_agreements_status_check check (status in ('sent', 'signed', 'voided', 'declined'));
alter table public.booking_agreements
  add column declined_at timestamptz,
  add column decline_reason text check (decline_reason is null or length(btrim(decline_reason)) between 1 and 500),
  add column signature_kind text check (signature_kind is null or signature_kind in ('typed', 'drawn', 'uploaded')),
  add column signature_image bytea check (signature_image is null or octet_length(signature_image) <= 1572864),
  add column last_request_kind text check (last_request_kind is null or last_request_kind in ('wrong_recipient', 'code_help', 'link_requested', 'message')),
  add column last_request_at timestamptz,
  add constraint booking_agreements_declined_ck check (status <> 'declined' or (declined_at is not null and decline_reason is not null)),
  add constraint booking_agreements_signature_ck check (
    (signature_kind is null and signature_image is null)
    or (signature_kind = 'typed' and signature_image is null)
    or (signature_kind in ('drawn', 'uploaded') and signature_image is not null)
  );

create table public.booking_agreement_codes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  booking_agreement_id uuid not null references public.booking_agreements (id),
  code_sha256 text not null check (code_sha256 ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  attempts integer not null default 0 check (attempts between 0 and 3),
  verified_at timestamptz,
  session_sha256 text check (session_sha256 is null or session_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default statement_timestamp(),
  check ((verified_at is null) = (session_sha256 is null))
);
comment on table public.booking_agreement_codes is
  'Six-digit signing codes for a consultation agreement: hashes only. Read and written by definer functions; no client access.';
create index booking_agreement_codes_org_fk_idx on public.booking_agreement_codes (organization_id);
create index booking_agreement_codes_agreement_fk_idx on public.booking_agreement_codes (booking_agreement_id, created_at);
alter table public.booking_agreement_codes enable row level security;
alter table public.booking_agreement_codes force row level security;
revoke all on public.booking_agreement_codes from anon, authenticated;

-- "d.ok•••@example.com": a short prefix of the local part, the rest hidden, the domain kept.
create function app.mask_email(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_email is null or position('@' in p_email) < 2 then null
    else left(split_part(p_email, '@', 1), case when length(split_part(p_email, '@', 1)) <= 4 then 1 else 4 end)
      || '•••@' || split_part(p_email, '@', 2)
  end;
$$;
revoke all on function app.mask_email(text) from public;

-- The booking and its live (sent) agreement for a private link, locked; null ids when there is none.
create function app.signing_target(p_ref text, out booking_id uuid, out agreement_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_ref is null or p_ref !~ '^[a-z2-7]{26}$' then
    return;
  end if;
  select b.id into booking_id from public.bookings b where b.public_ref = p_ref;
  if booking_id is null then
    return;
  end if;
  select a.id into agreement_id from public.booking_agreements a
  where a.booking_id = signing_target.booking_id and a.status = 'sent'
  order by a.sent_at desc limit 1
  for update;
end;
$$;
revoke all on function app.signing_target(text) from public;

create or replace function public.booking_agreement_for_signing(p_ref text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  booking public.bookings%rowtype;
  agreement public.booking_agreements%rowtype;
  latest public.booking_agreements%rowtype;
  firm_name text;
  firm_slug text;
  attendee text;
  attendee_email text;
  consent jsonb := app.esign_consent();
begin
  if p_ref is null or p_ref !~ '^[a-z2-7]{26}$' then
    return jsonb_build_object('state', 'unavailable');
  end if;
  select * into booking from public.bookings where public_ref = p_ref;
  if booking.id is null then
    return jsonb_build_object('state', 'unavailable');
  end if;
  select coalesce(nullif(btrim(org.display_name), ''), org.legal_name), org.slug into firm_name, firm_slug
  from public.organizations org where org.id = booking.organization_id;
  select a.display_name, a.email into attendee, attendee_email
  from public.booking_attendees a where a.booking_id = booking.id and a.role = 'primary' limit 1;
  select * into agreement from public.booking_agreements
  where booking_id = booking.id and status in ('sent', 'signed')
  order by sent_at desc limit 1;
  if agreement.id is null then
    select * into latest from public.booking_agreements
    where booking_id = booking.id
    order by sent_at desc limit 1;
    -- Declined or withdrawn: the firm and what the booker needs, never the text or the hash.
    if latest.status = 'declined' then
      return jsonb_build_object(
        'state', 'declined', 'firm', firm_name, 'firm_slug', firm_slug, 'attendee', attendee,
        'decline_reason', latest.decline_reason, 'declined_at', latest.declined_at,
        'time_zone', booking.attendee_time_zone, 'sample', booking.is_sample
      );
    end if;
    if latest.status = 'voided' then
      return jsonb_build_object('state', 'withdrawn', 'firm', firm_name, 'firm_slug', firm_slug);
    end if;
    return jsonb_build_object('state', 'unavailable');
  end if;
  return jsonb_build_object(
    'state', case when agreement.status = 'signed' then 'signed'
                  when booking.status in ('cancelled', 'expired') then 'closed'
                  else 'open' end,
    'firm', firm_name,
    'firm_slug', firm_slug,
    'attendee', attendee,
    'email_mask', app.mask_email(attendee_email),
    'meeting', booking.title,
    'starts_at', booking.starts_at,
    'time_zone', booking.attendee_time_zone,
    'title', agreement.title,
    'version', agreement.template_version,
    'body', agreement.body,
    'sha256', agreement.content_sha256,
    'consent_version', consent ->> 'version',
    'consent_text', consent ->> 'text',
    'signed_name', agreement.signed_name,
    'signed_at', agreement.signed_at,
    'signature_kind', agreement.signature_kind,
    'signature_image', case when agreement.status = 'signed' and agreement.signature_image is not null
                            then encode(agreement.signature_image, 'base64') end,
    'sample', booking.is_sample
  );
end;
$$;

create function public.issue_booking_agreement_code(p_ref text, p_code_id uuid, p_code_sha256 text, p_sealed text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target record;
  agreement public.booking_agreements%rowtype;
  booking public.bookings%rowtype;
  attendee record;
  last_at timestamptz;
  code_id uuid;
begin
  if p_code_id is null or p_code_sha256 is null or p_code_sha256 !~ '^[0-9a-f]{64}$' or length(coalesce(p_sealed, '')) not between 1 and 1024 then
    raise exception 'signing code is malformed' using errcode = '22023';
  end if;
  select * into target from app.signing_target(p_ref);
  if target.agreement_id is null then
    return jsonb_build_object('state', 'unavailable');
  end if;
  select * into agreement from public.booking_agreements where id = target.agreement_id;
  select * into booking from public.bookings where id = target.booking_id;
  if booking.status not in ('held', 'pending_payment', 'confirmed') or booking.ends_at <= statement_timestamp() then
    return jsonb_build_object('state', 'closed');
  end if;
  select a.email, a.person_id,
         coalesce((select pref.email_notices from public.person_contact_preferences pref where pref.person_id = a.person_id), true) as notices
  into attendee
  from public.booking_attendees a
  where a.booking_id = booking.id and a.organization_id = booking.organization_id and a.role = 'primary';
  if attendee.email is null then
    return jsonb_build_object('state', 'unavailable');
  end if;
  if attendee.notices is false then
    return jsonb_build_object('state', 'notices_off');
  end if;
  select max(c.created_at) into last_at from public.booking_agreement_codes c where c.booking_agreement_id = agreement.id;
  if last_at > statement_timestamp() - interval '30 seconds' then
    return jsonb_build_object('state', 'wait', 'seconds', ceil(extract(epoch from (last_at + interval '30 seconds' - statement_timestamp())))::integer);
  end if;
  if (select count(*) from public.booking_agreement_codes c
      where c.booking_agreement_id = agreement.id and c.created_at > statement_timestamp() - interval '1 hour') >= 10 then
    return jsonb_build_object('state', 'limited');
  end if;
  -- The app chose the id: the sealed code is bound to it.
  insert into public.booking_agreement_codes (id, organization_id, booking_agreement_id, code_sha256, expires_at)
  values (p_code_id, agreement.organization_id, agreement.id, p_code_sha256, statement_timestamp() + interval '10 minutes')
  returning id into code_id;
  perform app.booking_outbox(
    agreement.organization_id, booking.id, 'booking_agreement.code',
    jsonb_build_object('booking_id', booking.id, 'booking_agreement_id', agreement.id, 'code_id', code_id, 'sealed_code', p_sealed),
    'booking-agreement-code:' || code_id::text
  );
  perform app.record_audit_event(
    agreement.organization_id, 'booking_agreement.code_sent', 'public.bookings', booking.id, 'success',
    jsonb_build_object('booking_agreement_id', agreement.id, 'code_id', code_id)
  );
  return jsonb_build_object('state', 'sent', 'email_mask', app.mask_email(attendee.email));
end;
$$;
comment on function public.issue_booking_agreement_code(text, uuid, text, text) is
  'Emails the booker a six-digit signing code (sealed by the app; only its hash is stored). Anyone holding the private link; throttled.';
revoke all on function public.issue_booking_agreement_code(text, uuid, text, text) from public;
grant execute on function public.issue_booking_agreement_code(text, uuid, text, text) to anon, authenticated, service_role;

create function public.verify_booking_agreement_code(p_ref text, p_code_sha256 text, p_session_sha256 text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target record;
  code public.booking_agreement_codes%rowtype;
begin
  if p_session_sha256 is null or p_session_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'signing session is malformed' using errcode = '22023';
  end if;
  select * into target from app.signing_target(p_ref);
  if target.agreement_id is null then
    return jsonb_build_object('state', 'unavailable');
  end if;
  select * into code from public.booking_agreement_codes
  where booking_agreement_id = target.agreement_id
  order by created_at desc limit 1
  for update;
  if code.id is null then
    return jsonb_build_object('state', 'none');
  end if;
  if code.verified_at is not null or code.expires_at <= statement_timestamp() then
    return jsonb_build_object('state', 'expired');
  end if;
  if code.attempts >= 3 then
    return jsonb_build_object('state', 'locked');
  end if;
  if p_code_sha256 is distinct from code.code_sha256 then
    update public.booking_agreement_codes set attempts = code.attempts + 1 where id = code.id;
    if code.attempts + 1 >= 3 then
      return jsonb_build_object('state', 'locked');
    end if;
    return jsonb_build_object('state', 'wrong', 'left', 3 - (code.attempts + 1));
  end if;
  update public.booking_agreement_codes
  set verified_at = statement_timestamp(), session_sha256 = p_session_sha256
  where id = code.id;
  perform app.record_audit_event(
    code.organization_id, 'booking_agreement.code_verified', 'public.bookings', target.booking_id, 'success',
    jsonb_build_object('booking_agreement_id', code.booking_agreement_id, 'code_id', code.id)
  );
  return jsonb_build_object('state', 'ok');
end;
$$;
comment on function public.verify_booking_agreement_code(text, text, text) is
  'Checks the newest signing code (10 minutes, three attempts). On a match, keeps the hash of the session token that may sign.';
revoke all on function public.verify_booking_agreement_code(text, text, text) from public;
grant execute on function public.verify_booking_agreement_code(text, text, text) to anon, authenticated, service_role;

-- The six-argument sign (20261023170000) no longer signs: the code check comes first.
create or replace function public.sign_booking_agreement(
  p_ref text,
  p_name text,
  p_consent boolean,
  p_sha256 text,
  p_ip inet,
  p_user_agent text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'confirm it''s you with the emailed code before signing' using errcode = '42501';
end;
$$;

create function public.sign_booking_agreement(
  p_ref text,
  p_name text,
  p_consent boolean,
  p_sha256 text,
  p_ip inet,
  p_user_agent text,
  p_session_sha256 text,
  p_signature_kind text,
  p_signature_image text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  booking public.bookings%rowtype;
  agreement public.booking_agreements%rowtype;
  consent jsonb := app.esign_consent();
  name_in text := btrim(coalesce(p_name, ''));
  image bytea;
begin
  if p_ref is null or p_ref !~ '^[a-z2-7]{26}$' then
    raise exception 'agreement not available' using errcode = '42501';
  end if;
  select * into booking from public.bookings where public_ref = p_ref;
  if booking.id is null then
    raise exception 'agreement not available' using errcode = '42501';
  end if;
  select * into agreement from public.booking_agreements
  where booking_id = booking.id and status in ('sent', 'signed')
  order by sent_at desc limit 1
  for update;
  if agreement.id is null then
    raise exception 'agreement not available' using errcode = '42501';
  end if;
  if agreement.status = 'signed' then
    return jsonb_build_object('ok', true, 'replayed', true, 'signed_at', agreement.signed_at);
  end if;
  if booking.status in ('cancelled', 'expired') then
    raise exception 'this consultation was cancelled' using errcode = '22023';
  end if;
  if p_session_sha256 is null or p_session_sha256 !~ '^[0-9a-f]{64}$' or not exists (
    select 1 from public.booking_agreement_codes c
    where c.booking_agreement_id = agreement.id
      and c.session_sha256 = p_session_sha256
      and c.verified_at > statement_timestamp() - interval '2 hours'
  ) then
    raise exception 'confirm it''s you with the emailed code before signing' using errcode = '42501';
  end if;
  if p_consent is distinct from true then
    raise exception 'electronic signature consent is required' using errcode = '22023';
  end if;
  if length(name_in) not between 2 and 200 then
    raise exception 'type your full name to sign' using errcode = '22023';
  end if;
  if p_signature_kind is null or p_signature_kind not in ('typed', 'drawn', 'uploaded') then
    raise exception 'choose how to sign' using errcode = '22023';
  end if;
  if p_signature_kind <> 'typed' then
    begin
      image := decode(coalesce(p_signature_image, ''), 'base64');
    exception when others then
      raise exception 'the signature image must be a PNG or JPEG' using errcode = '22023';
    end;
    if octet_length(image) = 0 or octet_length(image) > 1572864 then
      raise exception 'the signature image must be a PNG or JPEG of at most 1.5 MB' using errcode = '22023';
    end if;
    if substring(image from 1 for 8) <> '\x89504e470d0a1a0a'::bytea and substring(image from 1 for 3) <> '\xffd8ff'::bytea then
      raise exception 'the signature image must be a PNG or JPEG' using errcode = '22023';
    end if;
  end if;
  if p_sha256 is distinct from agreement.content_sha256 then
    raise exception 'the agreement changed; reload it before signing' using errcode = 'PT409';
  end if;
  if consent ->> 'text' is null then
    raise exception 'electronic signature consent text is not configured' using errcode = '22023';
  end if;
  update public.booking_agreements
  set status = 'signed',
      signed_name = name_in,
      signed_at = statement_timestamp(),
      signer_ip = p_ip,
      signer_user_agent = left(p_user_agent, 400),
      consent_version = consent ->> 'version',
      consent_text = consent ->> 'text',
      signature_kind = p_signature_kind,
      signature_image = image
  where id = agreement.id;
  perform app.record_audit_event(
    agreement.organization_id, 'booking_agreement.signed', 'public.bookings', booking.id, 'success',
    jsonb_build_object('booking_agreement_id', agreement.id, 'sha256', agreement.content_sha256, 'signature_kind', p_signature_kind)
  );
  return jsonb_build_object('ok', true, 'replayed', false, 'signed_at', statement_timestamp());
end;
$$;
comment on function public.sign_booking_agreement(text, text, boolean, text, inet, text, text, text, text) is
  'Signs a booking''s consultation agreement through its private link after the code check: name, consent, the hash shown, a typed / drawn / uploaded signature, IP and browser. Once.';
revoke all on function public.sign_booking_agreement(text, text, boolean, text, inet, text, text, text, text) from public;
grant execute on function public.sign_booking_agreement(text, text, boolean, text, inet, text, text, text, text) to anon, authenticated, service_role;

create function public.decline_booking_agreement(p_ref text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target record;
  reason text := btrim(coalesce(p_reason, ''));
begin
  if length(reason) not between 1 and 500 then
    raise exception 'say why you are declining' using errcode = '22023';
  end if;
  select * into target from app.signing_target(p_ref);
  if target.agreement_id is null then
    raise exception 'agreement not available' using errcode = '42501';
  end if;
  update public.booking_agreements
  set status = 'declined', declined_at = statement_timestamp(), decline_reason = reason
  where id = target.agreement_id;
  perform app.record_audit_event(
    (select organization_id from public.booking_agreements where id = target.agreement_id),
    'booking_agreement.declined', 'public.bookings', target.booking_id, 'success',
    jsonb_build_object('booking_agreement_id', target.agreement_id)
  );
  return jsonb_build_object('ok', true);
end;
$$;
comment on function public.decline_booking_agreement(text, text) is
  'The booker declines an unsigned consultation agreement with a reason the firm sees. It stays on record; the firm can send a new one.';
revoke all on function public.decline_booking_agreement(text, text) from public;
grant execute on function public.decline_booking_agreement(text, text) to anon, authenticated, service_role;

create function public.note_booking_agreement_request(p_ref text, p_kind text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  agreement public.booking_agreements%rowtype;
begin
  if p_kind is null or p_kind not in ('wrong_recipient', 'code_help', 'link_requested', 'message') then
    raise exception 'request is not recognised' using errcode = '22023';
  end if;
  if p_ref is null or p_ref !~ '^[a-z2-7]{26}$' then
    raise exception 'agreement not available' using errcode = '42501';
  end if;
  select a.* into agreement
  from public.booking_agreements a
  join public.bookings b on b.id = a.booking_id and b.organization_id = a.organization_id
  where b.public_ref = p_ref
  order by a.sent_at desc limit 1
  for update of a;
  if agreement.id is null then
    raise exception 'agreement not available' using errcode = '42501';
  end if;
  -- The same request again within ten minutes changes nothing.
  if agreement.last_request_kind = p_kind and agreement.last_request_at > statement_timestamp() - interval '10 minutes' then
    return jsonb_build_object('ok', true, 'repeated', true);
  end if;
  update public.booking_agreements
  set last_request_kind = p_kind, last_request_at = statement_timestamp()
  where id = agreement.id;
  perform app.record_audit_event(
    agreement.organization_id, 'booking_agreement.' || p_kind, 'public.bookings', agreement.booking_id, 'success',
    jsonb_build_object('booking_agreement_id', agreement.id)
  );
  return jsonb_build_object('ok', true, 'repeated', false);
end;
$$;
comment on function public.note_booking_agreement_request(text, text) is
  'Records a booker''s request on the agreement for the firm (wrong recipient, code help, a new link, a message). Audited.';
revoke all on function public.note_booking_agreement_request(text, text) from public;
grant execute on function public.note_booking_agreement_request(text, text) to anon, authenticated, service_role;

-- Sealed signing codes go the same way as sealed invitation links once mail is final.
create or replace function app.scrub_invitation_link(p_event_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.outbox_events
     set payload = payload - 'sealed_link' - 'sealed_code'
   where id = p_event_id
     and (payload ? 'sealed_link' or payload ? 'sealed_code');
  update public.email_deliveries
     set context = context - 'sealed_link' - 'sealed_code'
   where outbox_event_id = p_event_id
     and (context ? 'sealed_link' or context ? 'sealed_code');
$$;

create or replace function public.claim_mail_events(p_worker text, p_limit integer default 20)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed jsonb;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') is distinct from 'service_role' then
    raise exception 'worker role required' using errcode = '42501';
  end if;
  if p_worker is null or length(btrim(p_worker)) < 1 then
    raise exception 'worker name is required' using errcode = '22023';
  end if;

  with due as (
    select c.id
    from public.outbox_events c
    where c.event_type = any (array[
      'portal_invitation.email_requested',
      'staff_invitation.email_requested',
      'reminder.due',
      'agreement.sent',
      'agreement.executed',
      -- firm countersign: a staff signer's turn.
      'agreement.signer_turn',
      'document.request_created',
      'document.uploaded',
      'document.reviewed',
      -- email designs: invoice, payment and refund mail.
      'invoice.issued',
      'invoice.payment_failed',
      'invoice.refund_started',
      'invoice.refund_succeeded',
      -- scheduling: consultation booked, moved, cancelled.
      'booking.confirmed',
      'booking.rescheduled',
      'booking.cancelled',
      -- matter messaging: EX07 generic notice of a staff message.
      'message.sent',
      -- inbox replies: EX15, an email a staff member wrote.
      'matter_email.sent',
      -- support access: EX11 asked, EM17 approved.
      'support_access.requested',
      'support_access.approved',
      -- consultation agreements: EM08 with the booking's private signing link.
      'booking_agreement.sent',
      -- signing flow: EX16, the sealed six-digit signing code.
      'booking_agreement.code'
    ])
      and (
        (c.status in ('pending', 'failed') and c.available_at <= clock_timestamp())
        or (c.status = 'processing' and c.locked_at < clock_timestamp() - interval '5 minutes')
      )
      -- sealed invitation link: wait for it, or send the linkless email after 10 minutes.
      and (
        c.event_type not in ('portal_invitation.email_requested', 'staff_invitation.email_requested')
        or c.payload ? 'sealed_link'
        or c.occurred_at < clock_timestamp() - interval '10 minutes'
      )
    order by c.available_at, c.occurred_at
    limit least(greatest(coalesce(p_limit, 20), 1), 50)
    for update skip locked
  ),
  locked as (
    update public.outbox_events event
       set status = 'processing',
           locked_at = clock_timestamp(),
           locked_by = left(btrim(p_worker), 200),
           attempts = event.attempts + 1
     where event.id in (select due.id from due)
    returning event.id, event.organization_id, event.event_type, event.payload, event.attempts
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', locked.id,
    'organization_id', locked.organization_id,
    'event_type', locked.event_type,
    'payload', locked.payload,
    'attempts', locked.attempts
  )), '[]'::jsonb)
  into claimed
  from locked;
  return claimed;
end;
$$;

create or replace function public.prepare_email_delivery(
  p_event_id uuid,
  p_worker text,
  p_inbound_domain text default null,
  p_from_address text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  event public.outbox_events%rowtype;
  firm_name text;
  firm_slug text;
  domain text;
  from_addr text;
  matter uuid;
  template public.email_template;
  critical boolean;
  reply text;
  messages jsonb;
  rec record;
  send_ok boolean;
  ctx jsonb;
  inviter text;
  payer uuid;
  payer_known boolean;
  -- inbox replies: the staff email, and what its message carries besides the context.
  outbound public.matter_outbound_emails%rowtype;
  in_reply_to text;
  extra jsonb := '{}'::jsonb;
  -- support access: the request the event is about.
  support_req public.support_access_requests%rowtype;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') is distinct from 'service_role' then
    raise exception 'worker role required' using errcode = '42501';
  end if;
  select * into event from public.outbox_events where id = p_event_id;
  if event.id is null then
    raise exception 'mail event was not found' using errcode = '42501';
  end if;
  if event.status = 'published' then
    return jsonb_build_object('action', 'done', 'event_id', event.id, 'messages', '[]'::jsonb);
  end if;
  if event.status is distinct from 'processing'
     or event.locked_by is distinct from left(btrim(coalesce(p_worker, '')), 200) then
    raise exception 'mail event is not claimed' using errcode = '42501';
  end if;

  domain := app.inbound_domain(p_inbound_domain);
  from_addr := lower(btrim(coalesce(
    nullif(p_from_address, ''),
    (select value ->> 'address' from public.product_settings where key = 'email.from_address'),
    'notices@casevoya.ca'
  )));
  if from_addr !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    from_addr := 'notices@casevoya.ca';
  end if;
  select display_name, slug into firm_name, firm_slug
  from public.organizations
  where id = event.organization_id;

  matter := null;
  if coalesce(event.payload ->> 'matter_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    matter := (event.payload ->> 'matter_id')::uuid;
  end if;

  if event.event_type = 'document.reviewed'
     and coalesce(event.payload ->> 'decision', '') is distinct from 'accepted' then
    perform app.mark_outbox_published(event.id, p_worker);
    perform app.record_audit_event(
      event.organization_id, 'email.skipped', 'public.outbox_events', event.id, 'success',
      jsonb_build_object('reason', 'review_not_accepted')
    );
    return jsonb_build_object('action', 'done', 'event_id', event.id, 'messages', '[]'::jsonb);
  end if;

  template := case event.event_type
    when 'portal_invitation.email_requested' then 'invite'::public.email_template
    when 'staff_invitation.email_requested' then 'invite'::public.email_template
    when 'reminder.due' then 'reminder'::public.email_template
    when 'agreement.sent' then 'agreement'::public.email_template
    when 'agreement.executed' then 'signature'::public.email_template
    -- firm countersign: the staff signer's turn uses the agreement template, staff copy.
    when 'agreement.signer_turn' then 'agreement'::public.email_template
    when 'document.request_created' then 'document_request'::public.email_template
    when 'document.uploaded' then 'document_receipt'::public.email_template
    when 'document.reviewed' then 'document_receipt'::public.email_template
    -- email designs: invoice, payment and refund mail.
    when 'invoice.issued' then 'invoice'::public.email_template
    when 'invoice.payment_failed' then 'payment_failed'::public.email_template
    when 'invoice.refund_started' then 'refund_started'::public.email_template
    when 'invoice.refund_succeeded' then 'refund_complete'::public.email_template
    -- scheduling: EM16a / EM16b / EM16c.
    when 'booking.confirmed' then 'consultation_booked'::public.email_template
    when 'booking.rescheduled' then 'consultation_rescheduled'::public.email_template
    when 'booking.cancelled' then 'consultation_cancelled'::public.email_template
    -- matter messaging: EX07, the generic "New message" notice.
    when 'message.sent' then 'message'::public.email_template
    -- inbox replies: EX15, the staff member's own words.
    when 'matter_email.sent' then 'staff_message'::public.email_template
    -- support access: EX11 asked, EM17 approved.
    when 'support_access.requested' then 'support_requested'::public.email_template
    when 'support_access.approved' then 'support_granted'::public.email_template
    -- consultation agreements: the agreement template (EM08), booking variant.
    when 'booking_agreement.sent' then 'agreement'::public.email_template
    -- signing flow: EX16, the signing code.
    when 'booking_agreement.code' then 'signing_code'::public.email_template
    else null
  end;
  if template is null then
    raise exception 'event is not a mail event' using errcode = '22023';
  end if;

  critical := template in ('invite', 'agreement', 'signature', 'document_request', 'document_receipt');
  ctx := jsonb_build_object('firm', firm_name, 'template', template);

  -- sealed invitation link: the worker decrypts it; it stays well under the 2000-byte context cap.
  if event.event_type in ('portal_invitation.email_requested', 'staff_invitation.email_requested')
     and length(coalesce(event.payload ->> 'sealed_link', '')) between 1 and 1024 then
    ctx := ctx || jsonb_build_object(
      'sealed_link', event.payload ->> 'sealed_link',
      'invitation_id', event.payload ->> 'invitation_id'
    );
  end if;

  if event.event_type = 'portal_invitation.email_requested' then
    ctx := ctx || jsonb_build_object('kind', 'portal', 'role', event.payload ->> 'role');
    -- email designs: who invited them, for the heading.
    select left(nullif(btrim(profile.display_name), ''), 120) into inviter
    from public.portal_invitations inv
    join public.profiles profile on profile.id = inv.created_by
    where inv.id::text = event.payload ->> 'invitation_id'
      and inv.organization_id = event.organization_id;
    if inviter is not null then
      ctx := ctx || jsonb_build_object('inviter', inviter);
    end if;
    perform app.queue_email_delivery(
      event.id, event.organization_id, event.payload ->> 'recipient_email',
      template, matter, true, ctx, true
    );
  elsif event.event_type = 'staff_invitation.email_requested' then
    ctx := ctx || jsonb_build_object('kind', 'staff', 'role', event.payload ->> 'role');
    -- email designs: who invited them, for the heading.
    select left(nullif(btrim(profile.display_name), ''), 120) into inviter
    from public.invitations inv
    join public.profiles profile on profile.id = inv.created_by
    where inv.id::text = event.payload ->> 'invitation_id'
      and inv.organization_id = event.organization_id;
    if inviter is not null then
      ctx := ctx || jsonb_build_object('inviter', inviter);
    end if;
    perform app.queue_email_delivery(
      event.id, event.organization_id, event.payload ->> 'recipient_email',
      template, null, true, ctx, true
    );
  elsif event.event_type = 'reminder.due' then
    critical := coalesce(event.payload ->> 'reminder_kind', '') = 'immediate'
      or exists (
        select 1
        from public.deadlines deadline
        where deadline.id::text = event.payload ->> 'deadline_id'
          and deadline.kind in ('legal', 'correspondence')
      );
    ctx := ctx || jsonb_build_object(
      'reminder_kind', coalesce(event.payload ->> 'reminder_kind', 'routine'),
      'due_on', (
        select to_char(deadline.due_on, 'YYYY-MM-DD')
        from public.deadlines deadline
        where deadline.id::text = event.payload ->> 'deadline_id'
      )
    );
    for rec in
      select person.email,
             coalesce(pref.deadline_reminders, false) as deadline_reminders,
             pref.email_notices as email_notices
      from public.persons person
      join public.matter_participants party
        on party.person_id = person.id
       and party.matter_id = matter
       and party.organization_id = event.organization_id
      left join public.person_contact_preferences pref
        on pref.person_id = person.id
      where person.organization_id = event.organization_id
        and person.email is not null
        and matter is not null
    loop
      send_ok := coalesce(event.payload ->> 'reminder_kind', '') = 'immediate'
        or (rec.deadline_reminders and rec.email_notices is distinct from false);
      perform app.queue_email_delivery(
        event.id, event.organization_id, rec.email, template, matter, critical, ctx, send_ok
      );
    end loop;
  elsif event.event_type in ('agreement.sent', 'agreement.executed') then
    ctx := ctx || jsonb_build_object('agreement_kind', (
      select agreement.kind
      from public.signature_envelopes envelope
      join public.agreements agreement on agreement.id = envelope.agreement_id
      where envelope.id::text = event.payload ->> 'envelope_id'
    ));
    for rec in
      select lower(coalesce(person.email, users.email)) as email,
             signer.person_id is null as staff
      from public.envelope_signers signer
      left join public.persons person on person.id = signer.person_id
      left join public.memberships membership on membership.id = signer.membership_id
      left join auth.users users on users.id = membership.user_id
      where signer.envelope_id::text = event.payload ->> 'envelope_id'
        and signer.organization_id = event.organization_id
        -- firm countersign: staff signers hear when it is their turn (agreement.signer_turn), not at send.
        and (event.event_type = 'agreement.executed' or signer.person_id is not null)
    loop
      -- email designs: a staff signer's executed copy links to the Sheet, not the portal.
      perform app.queue_email_delivery(
        event.id, event.organization_id, rec.email, template, matter, true,
        case when rec.staff then ctx || jsonb_build_object('audience', 'staff') else ctx end,
        true
      );
    end loop;
  -- firm countersign: the staff signer whose turn it is, while it still is, gets the Sheet link.
  elsif event.event_type = 'agreement.signer_turn' then
    ctx := ctx || jsonb_build_object(
      'audience', 'staff',
      'agreement_kind', (
        select agreement.kind
        from public.signature_envelopes envelope
        join public.agreements agreement on agreement.id = envelope.agreement_id
        where envelope.id::text = event.payload ->> 'envelope_id'
      )
    );
    for rec in
      select lower(users.email) as email
      from public.envelope_signers signer
      join public.signature_envelopes envelope
        on envelope.id = signer.envelope_id
       and envelope.organization_id = signer.organization_id
      join public.memberships membership
        on membership.id = signer.membership_id
       and membership.organization_id = signer.organization_id
       and membership.status = 'active'
      join auth.users users on users.id = membership.user_id
      where signer.id::text = event.payload ->> 'signer_id'
        and signer.envelope_id::text = event.payload ->> 'envelope_id'
        and signer.organization_id = event.organization_id
        and signer.status = 'current'
        and envelope.status in ('sent', 'partially_signed')
        and envelope.expires_at > statement_timestamp()
    loop
      perform app.queue_email_delivery(
        event.id, event.organization_id, rec.email, template, matter, true, ctx, true
      );
    end loop;
  elsif event.event_type = 'document.request_created' then
    -- email designs: the due date only; the request's purpose names the document and stays out of mail.
    ctx := ctx || jsonb_build_object('due_on', event.payload ->> 'due_on');
    perform app.queue_email_delivery(
      event.id, event.organization_id,
      (select person.email from public.persons person where person.id::text = event.payload ->> 'person_id'),
      template, matter, true, ctx, true
    );
  elsif event.event_type in ('document.uploaded', 'document.reviewed') then
    ctx := ctx || jsonb_build_object(
      'status', case when event.event_type = 'document.reviewed' then 'accepted' else 'received' end
    );
    perform app.queue_email_delivery(
      event.id, event.organization_id,
      (
        select person.email
        from public.documents doc
        join public.persons person on person.id = doc.person_id
        where doc.id::text = event.payload ->> 'document_id'
      ),
      template, matter, true, ctx, true
    );
  -- email designs: invoice, payment and refund mail to the payer, else the matter's applicants.
  elsif event.event_type in ('invoice.issued', 'invoice.payment_failed', 'invoice.refund_started', 'invoice.refund_succeeded') then
    ctx := ctx || coalesce((
      select jsonb_build_object(
        'invoice_id', invoice.id,
        'invoice_number', invoice.number,
        'due_on', to_char(invoice.due_on, 'YYYY-MM-DD')
      )
      from public.invoices invoice
      where invoice.id::text = event.payload ->> 'invoice_id'
        and invoice.organization_id = event.organization_id
    ), '{}'::jsonb);
    payer := null;
    if event.event_type <> 'invoice.issued' then
      select payment.created_by into payer
      from public.invoice_payments payment
      where payment.id::text = event.payload ->> 'payment_id'
        and payment.organization_id = event.organization_id;
    end if;
    payer_known := payer is not null and matter is not null and exists (
      select 1
      from public.persons person
      join public.matter_participants party
        on party.person_id = person.id
       and party.matter_id = matter
       and party.organization_id = event.organization_id
      where person.user_id = payer
        and person.organization_id = event.organization_id
        and person.email is not null
    );
    for rec in
      select lower(person.email) as email,
             bool_or(pref.email_notices is distinct from false) as email_notices
      from public.matter_participants party
      join public.persons person
        on person.id = party.person_id
       and person.organization_id = party.organization_id
      left join public.person_contact_preferences pref
        on pref.person_id = person.id
      where party.matter_id = matter
        and party.organization_id = event.organization_id
        and person.email is not null
        and matter is not null
        and case when payer_known then person.user_id = payer else party.role = 'applicant' end
      group by lower(person.email)
    loop
      perform app.queue_email_delivery(
        event.id, event.organization_id, rec.email, template, matter, false, ctx, rec.email_notices
      );
    end loop;
  -- scheduling: the booking's primary attendee, with the time in their own zone. A booking that
  -- moved again or was cancelled since this event was queued is not mailed with a stale time.
  elsif event.event_type in ('booking.confirmed', 'booking.rescheduled', 'booking.cancelled') then
    for rec in
      select attendee.email,
             attendee.time_zone,
             booking.host_name,
             booking.status,
             booking.starts_at,
             booking.location_kind,
             booking.location_detail,
             booking.is_sample,
             -- portal appointments: who cancelled (EM16c wording).
             booking.cancelled_by,
             -- booking mail: a portal button only for an attendee whose person can sign in.
             (person.id is not null and person.user_id is not null) as portal,
             pref.email_notices is distinct from false as email_notices
      from public.bookings booking
      join public.booking_attendees attendee
        on attendee.booking_id = booking.id
       and attendee.organization_id = booking.organization_id
       and attendee.role = 'primary'
      left join public.persons person
        on person.id = attendee.person_id
       and person.organization_id = attendee.organization_id
      left join public.person_contact_preferences pref
        on pref.person_id = attendee.person_id
      where booking.id::text = event.payload ->> 'booking_id'
        and booking.organization_id = event.organization_id
    loop
      ctx := ctx || jsonb_build_object(
        'starts_at', coalesce(event.payload ->> 'starts_at', to_char(rec.starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
        'time_zone', rec.time_zone,
        'portal', rec.portal
      );
      if event.event_type = 'booking.confirmed' and rec.host_name is not null then
        ctx := ctx || jsonb_build_object('consultant_name', rec.host_name);
      end if;
      -- booking mail: how they meet; the address only for an in-person meeting, never a link.
      if event.event_type = 'booking.confirmed' then
        ctx := ctx || jsonb_build_object('location_kind', rec.location_kind);
        if rec.location_kind = 'in_person' and nullif(btrim(coalesce(rec.location_detail, '')), '') is not null then
          ctx := ctx || jsonb_build_object('address', left(btrim(rec.location_detail), 300));
        end if;
      end if;
      -- booking mail: without a portal, a cancellation points to the firm's booking page when the
      -- firm has a published free one this attendee can use (a practice one for a sample booking).
      if event.event_type = 'booking.cancelled' and not rec.portal and firm_slug is not null and exists (
        select 1 from public.booking_event_types et
        where et.organization_id = event.organization_id
          and et.is_published and et.archived_at is null and et.price_cents = 0
          and (not et.is_sample or rec.is_sample)
      ) then
        ctx := ctx || jsonb_build_object('booking_page', firm_slug);
      end if;
      -- portal appointments: EM16c says who cancelled (the client from their portal, or the firm).
      if event.event_type = 'booking.cancelled' then
        ctx := ctx || jsonb_build_object('cancelled_by',
          case when coalesce(event.payload ->> 'cancelled_by', rec.cancelled_by::text) = 'client' then 'client' else 'staff' end);
      end if;
      send_ok := rec.email_notices and case event.event_type
        when 'booking.cancelled' then rec.status = 'cancelled'
        else rec.status = 'confirmed' and rec.starts_at = (event.payload ->> 'starts_at')::timestamptz
      end;
      perform app.queue_email_delivery(
        event.id, event.organization_id, rec.email, template, null, false, ctx, send_ok
      );
    end loop;
  -- matter messaging: each person the thread is addressed to, firm name only (never the text).
  -- A critical instruction (requires_ack) is a critical notice, so a bounce opens a staff task.
  elsif event.event_type = 'message.sent' then
    critical := coalesce((
      select message.requires_ack from public.matter_messages message
      where message.id::text = event.payload ->> 'message_id'
        and message.organization_id = event.organization_id
    ), false);
    for rec in
      select lower(person.email) as email,
             bool_or(pref.email_notices is distinct from false) as email_notices
      from public.matter_messages message
      join public.message_thread_people tp
        on tp.thread_id = message.thread_id
       and tp.organization_id = message.organization_id
      join public.persons person
        on person.id = tp.person_id
       and person.organization_id = tp.organization_id
      join public.matter_participants party
        on party.person_id = person.id
       and party.matter_id = message.matter_id
       and party.organization_id = message.organization_id
      left join public.person_contact_preferences pref
        on pref.person_id = person.id
      where message.id::text = event.payload ->> 'message_id'
        and message.organization_id = event.organization_id
        and person.email is not null
      group by lower(person.email)
    loop
      perform app.queue_email_delivery(
        event.id, event.organization_id, rec.email, template, matter, critical, ctx, rec.email_notices
      );
    end loop;
  -- inbox replies: the stored address of the person the staff member wrote to. A sample matter's
  -- email is recorded as skipped (never sent), as is one whose person left the matter, lost that
  -- address, or turned "Email notices" off since. The text, subject and threading headers go in
  -- the message, not the context.
  elsif event.event_type = 'matter_email.sent' then
    select * into outbound
    from public.matter_outbound_emails email
    where email.id::text = event.payload ->> 'email_id'
      and email.organization_id = event.organization_id
      and email.outbox_event_id = event.id;
    if outbound.id is not null then
      matter := outbound.matter_id;
      select * into rec
      from (
        select lower(person.email) as email,
               person.user_id is not null as portal,
               exists (
                 select 1 from public.matter_participants party
                 where party.person_id = person.id
                   and party.matter_id = outbound.matter_id
                   and party.organization_id = outbound.organization_id
               ) as on_matter,
               coalesce((
                 select pref.email_notices is distinct from false
                 from public.person_contact_preferences pref
                 where pref.person_id = person.id
               ), true) as email_notices
        from public.persons person
        where person.id = outbound.person_id
          and person.organization_id = outbound.organization_id
      ) found;
      ctx := ctx || jsonb_build_object(
        'sender', left(outbound.author_name, 120),
        'portal', coalesce(rec.portal, false)
      );
      send_ok := outbound.is_sample is false
        and coalesce(rec.on_matter, false)
        and coalesce(rec.email_notices, false)
        and rec.email is not distinct from outbound.recipient_email;
      perform app.queue_email_delivery(
        event.id, event.organization_id, outbound.recipient_email, template, matter, false, ctx, send_ok
      );
      select inbound.message_id into in_reply_to
      from public.inbound_emails inbound
      where inbound.id = outbound.reply_to_inbound_id
        and inbound.organization_id = outbound.organization_id;
      extra := jsonb_build_object('body', outbound.body, 'subject', outbound.subject);
      if btrim(coalesce(in_reply_to, '')) ~ '^<[^<>[:space:]]+>$' and length(btrim(in_reply_to)) <= 500 then
        extra := extra || jsonb_build_object(
          'headers', jsonb_build_object('In-Reply-To', btrim(in_reply_to), 'References', btrim(in_reply_to))
        );
      end if;
    end if;
  -- support access: EX11 when Casevoya support asks, EM17 when a firm owner approves, to every
  -- active firm owner at their sign-in address. Minutes only in the request mail; the approver's
  -- name, the minutes granted, the end time and the firm's zone in the approval mail. No matter
  -- (platform mail), never critical. Nothing about the matter or the reason goes in the email.
  elsif event.event_type in ('support_access.requested', 'support_access.approved') then
    select * into support_req
    from public.support_access_requests req
    where req.id::text = event.payload ->> 'request_id'
      and req.organization_id = event.organization_id;
    if support_req.id is not null then
      ctx := ctx || jsonb_build_object('minutes', support_req.requested_minutes);
      if event.event_type = 'support_access.approved' and support_req.starts_at is not null then
        ctx := ctx || jsonb_build_object(
          'approver', (
            select left(nullif(btrim(coalesce(prof.display_name, '')), ''), 120)
            from public.memberships member
            left join public.profiles prof on prof.id = member.user_id
            where member.id = support_req.approved_by_membership_id
              and member.organization_id = support_req.organization_id
          ),
          'minutes', round(extract(epoch from (support_req.ends_at - support_req.starts_at)) / 60)::integer,
          'ends_at', to_char(support_req.ends_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
          'time_zone', (select org.timezone from public.organizations org where org.id = event.organization_id)
        );
      end if;
      for rec in
        select lower(users.email) as email
        from public.memberships member
        join auth.users users on users.id = member.user_id
        where member.organization_id = event.organization_id
          and member.role = 'firm_owner'
          and member.status = 'active'
          and users.email is not null
        group by lower(users.email)
      loop
        perform app.queue_email_delivery(
          event.id, event.organization_id, rec.email, template, null, false, ctx, true
        );
      end loop;
    end if;
  -- consultation agreements: the booking's primary attendee gets EM08 with the booking's private
  -- signing link (the ref only; the worker builds the link). Sent only while that agreement is
  -- still unsigned and the consultation still ahead; never critical (no matter), and it honours
  -- "Email notices" like the other booking mail.
  elsif event.event_type = 'booking_agreement.sent' then
    critical := false;
    for rec in
      select attendee.email,
             booking.public_ref,
             agreement.status as agreement_status,
             booking.status as booking_status,
             booking.ends_at,
             pref.email_notices is distinct from false as email_notices
      from public.booking_agreements agreement
      join public.bookings booking
        on booking.id = agreement.booking_id
       and booking.organization_id = agreement.organization_id
      join public.booking_attendees attendee
        on attendee.booking_id = booking.id
       and attendee.organization_id = booking.organization_id
       and attendee.role = 'primary'
      left join public.person_contact_preferences pref
        on pref.person_id = attendee.person_id
      where agreement.id::text = event.payload ->> 'booking_agreement_id'
        and agreement.booking_id::text = event.payload ->> 'booking_id'
        and agreement.organization_id = event.organization_id
    loop
      ctx := ctx || jsonb_build_object('agreement_kind', 'consultation', 'signing_ref', rec.public_ref);
      send_ok := rec.email_notices
        and rec.agreement_status = 'sent'
        and rec.booking_status in ('held', 'pending_payment', 'confirmed')
        and rec.ends_at > statement_timestamp();
      perform app.queue_email_delivery(
        event.id, event.organization_id, rec.email, template, null, false, ctx, send_ok
      );
    end loop;
  -- signing flow: EX16 to the booking's primary attendee with the sealed code (the worker opens
  -- it; the database never holds the code). Sent only while that code is the newest, unexpired
  -- and unused, and the agreement unsigned; it honours "Email notices" like EM08.
  elsif event.event_type = 'booking_agreement.code' then
    critical := false;
    for rec in
      select attendee.email,
             code.id as code_id,
             code.expires_at,
             code.verified_at,
             agreement.status as agreement_status,
             not exists (
               select 1 from public.booking_agreement_codes newer
               where newer.booking_agreement_id = code.booking_agreement_id and newer.created_at > code.created_at
             ) as newest,
             pref.email_notices is distinct from false as email_notices
      from public.booking_agreement_codes code
      join public.booking_agreements agreement
        on agreement.id = code.booking_agreement_id
       and agreement.organization_id = code.organization_id
      join public.booking_attendees attendee
        on attendee.booking_id = agreement.booking_id
       and attendee.organization_id = agreement.organization_id
       and attendee.role = 'primary'
      left join public.person_contact_preferences pref
        on pref.person_id = attendee.person_id
      where code.id::text = event.payload ->> 'code_id'
        and code.booking_agreement_id::text = event.payload ->> 'booking_agreement_id'
        and code.organization_id = event.organization_id
    loop
      if length(coalesce(event.payload ->> 'sealed_code', '')) between 1 and 1024 then
        ctx := ctx || jsonb_build_object('sealed_code', event.payload ->> 'sealed_code', 'code_id', rec.code_id);
      end if;
      send_ok := rec.email_notices and rec.newest and rec.verified_at is null
        and rec.expires_at > statement_timestamp() and rec.agreement_status = 'sent';
      perform app.queue_email_delivery(
        event.id, event.organization_id, rec.email, template, null, false, ctx, send_ok
      );
    end loop;
  end if;

  if not exists (
    select 1 from public.email_deliveries delivery
    where delivery.outbox_event_id = event.id
      and delivery.status = 'sending'
  ) then
    perform app.mark_outbox_published(event.id, p_worker);
    -- sealed invitation link: nothing will be sent, so nothing needs it.
    perform app.scrub_invitation_link(event.id);
    perform app.record_audit_event(
      event.organization_id, 'email.skipped', 'public.outbox_events', event.id, 'success',
      jsonb_build_object('template', template, 'reason', 'no_recipient')
    );
    return jsonb_build_object('action', 'done', 'event_id', event.id, 'messages', '[]'::jsonb);
  end if;

  reply := app.firm_reply_address(event.organization_id, matter, domain);
  select coalesce(jsonb_agg(jsonb_build_object(
    'delivery_id', delivery.id,
    'to', delivery.recipient_email,
    'from_address', from_addr,
    'from_name', firm_name,
    'reply_to_address', reply,
    'reply_to_name', firm_name,
    'template', delivery.template,
    'context', delivery.context
  -- inbox replies: body, subject and headers of a staff email (empty for every other event).
  ) || extra), '[]'::jsonb)
  into messages
  from public.email_deliveries delivery
  where delivery.outbox_event_id = event.id
    and delivery.status = 'sending';

  return jsonb_build_object('action', 'send', 'event_id', event.id, 'messages', messages);
end;
$$;

revoke all on function public.claim_mail_events(text, integer) from public, anon, authenticated;
revoke all on function public.prepare_email_delivery(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.claim_mail_events(text, integer) to service_role;
grant execute on function public.prepare_email_delivery(uuid, text, text, text) to service_role;
