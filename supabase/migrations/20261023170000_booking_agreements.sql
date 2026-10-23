-- Consultations: the consultation agreement, signed before the meeting (PRD CRM-04).
--
-- A consultation comes before any matter (lead -> consultation -> quote -> service agreement ->
-- matter), and a person who books on the public page has no portal login, so the matter-bound
-- agreements and envelopes (inhouse e-sign) can't carry it. A booking agreement is its own record:
-- the firm's approved consultation template, locked as sent (text and SHA-256), signed through a
-- private link that is the booking's own public reference (26 random base32 characters, the same
-- secret its call page uses). Signing records the typed name, the e-sign consent shown (the same
-- product setting as other agreements), when, the IP and browser the app server saw, and the hash
-- of the text signed. Matter agreements and their e-signing are unchanged.
--
-- New:
--   * public.booking_agreements: one live agreement per booking (sent or signed); a voided one
--     stays on record. Forced RLS: scheduling staff of the firm read them; nobody writes directly.
--   * public.send_booking_agreement(booking, template): scheduling staff; an approved
--     consultation template; an upcoming booking (held, awaiting payment or confirmed); none
--     already live. Audited booking_agreement.sent.
--   * public.void_booking_agreement(booking, reason): scheduling staff; a sent (unsigned) one.
--     Audited booking_agreement.voided.
--   * public.booking_agreement_for_signing(ref): anyone holding the link: the firm, the meeting,
--     the locked text, its hash, the consent text and the state. Nothing else about the booking.
--   * public.sign_booking_agreement(ref, name, consent, hash, ip, user_agent): anyone holding the
--     link, once; the hash must be the one shown. Audited booking_agreement.signed.

create table public.booking_agreements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  booking_id uuid not null,
  template_id uuid not null,
  template_version integer not null,
  title text not null check (length(btrim(title)) between 1 and 200),
  body text not null check (length(body) between 1 and 20000),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'sent' check (status in ('sent', 'signed', 'voided')),
  sent_by uuid not null,
  sent_at timestamptz not null default statement_timestamp(),
  signed_name text check (signed_name is null or length(btrim(signed_name)) between 1 and 200),
  signed_at timestamptz,
  signer_ip inet,
  signer_user_agent text check (signer_user_agent is null or length(signer_user_agent) <= 400),
  consent_version text,
  consent_text text,
  voided_by uuid,
  voided_at timestamptz,
  void_reason text check (void_reason is null or length(btrim(void_reason)) between 3 and 500),
  is_sample boolean not null default false,
  created_at timestamptz not null default statement_timestamp(),
  foreign key (booking_id, organization_id) references public.bookings (id, organization_id),
  foreign key (template_id, organization_id) references public.agreement_templates (id, organization_id),
  check (status <> 'signed' or (signed_name is not null and signed_at is not null and consent_text is not null)),
  check (status <> 'voided' or (voided_at is not null and void_reason is not null))
);
comment on table public.booking_agreements is
  'The consultation agreement of one booking: the approved template locked as sent, signed through the booking''s private link. Not a matter agreement.';
create unique index booking_agreements_live_idx on public.booking_agreements (booking_id) where status in ('sent', 'signed');
create index booking_agreements_org_fk_idx on public.booking_agreements (organization_id);
create index booking_agreements_booking_org_fk_idx on public.booking_agreements (booking_id, organization_id);
create index booking_agreements_template_org_fk_idx on public.booking_agreements (template_id, organization_id);

alter table public.booking_agreements enable row level security;
alter table public.booking_agreements force row level security;
create policy booking_agreements_select on public.booking_agreements
  for select to authenticated
  using (organization_id = (select app.current_organization_id()) and (select app.can_read_scheduling(organization_id)));
revoke all on public.booking_agreements from anon;
grant select on public.booking_agreements to authenticated;

create function public.send_booking_agreement(p_booking_id uuid, p_template_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  booking public.bookings%rowtype;
  tpl public.agreement_templates%rowtype;
  new_id uuid;
begin
  select * into booking from public.bookings where id = p_booking_id for update;
  if booking.id is null then
    raise exception 'booking denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(booking.organization_id, app.scheduling_staff_roles(), false);
  if booking.organization_id is distinct from app.current_organization_id() then
    raise exception 'booking denied' using errcode = '42501';
  end if;
  if booking.status not in ('held', 'pending_payment', 'confirmed') then
    raise exception 'only an upcoming consultation can get an agreement' using errcode = '22023';
  end if;
  select * into tpl from public.agreement_templates
  where id = p_template_id and organization_id = booking.organization_id;
  if tpl.id is null or tpl.kind is distinct from 'consultation' or tpl.status is distinct from 'approved' then
    raise exception 'choose an approved consultation agreement template' using errcode = '22023';
  end if;
  if exists (select 1 from public.booking_agreements where booking_id = booking.id and status in ('sent', 'signed')) then
    raise exception 'this consultation already has an agreement' using errcode = '22023';
  end if;
  insert into public.booking_agreements (
    organization_id, booking_id, template_id, template_version, title, body, content_sha256, sent_by, is_sample
  ) values (
    booking.organization_id, booking.id, tpl.id, tpl.version, tpl.name, tpl.body,
    app.portal_statement_hash(tpl.body), (select auth.uid()), booking.is_sample
  )
  returning id into new_id;
  perform app.record_audit_event(
    booking.organization_id, 'booking_agreement.sent', 'public.bookings', booking.id, 'success',
    jsonb_build_object('booking_agreement_id', new_id, 'template_id', tpl.id, 'template_version', tpl.version)
  );
  return new_id;
end;
$$;
comment on function public.send_booking_agreement(uuid, uuid) is
  'Locks the firm''s approved consultation template to an upcoming booking for the booker to sign through its private link. Scheduling staff.';
revoke all on function public.send_booking_agreement(uuid, uuid) from public, anon;
grant execute on function public.send_booking_agreement(uuid, uuid) to authenticated, service_role;

create function public.void_booking_agreement(p_booking_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  agreement public.booking_agreements%rowtype;
begin
  select * into agreement from public.booking_agreements where booking_id = p_booking_id and status = 'sent' for update;
  if agreement.id is null then
    raise exception 'there is no unsigned agreement to void' using errcode = '22023';
  end if;
  perform app.require_active_staff(agreement.organization_id, app.scheduling_staff_roles(), false);
  if agreement.organization_id is distinct from app.current_organization_id() then
    raise exception 'booking denied' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason, ''))) not between 3 and 500 then
    raise exception 'give a reason (3 to 500 characters)' using errcode = '22023';
  end if;
  update public.booking_agreements
  set status = 'voided', voided_by = (select auth.uid()), voided_at = statement_timestamp(), void_reason = btrim(p_reason)
  where id = agreement.id;
  perform app.record_audit_event(
    agreement.organization_id, 'booking_agreement.voided', 'public.bookings', agreement.booking_id, 'success',
    jsonb_build_object('booking_agreement_id', agreement.id)
  );
end;
$$;
revoke all on function public.void_booking_agreement(uuid, text) from public, anon;
grant execute on function public.void_booking_agreement(uuid, text) to authenticated, service_role;

create function public.booking_agreement_for_signing(p_ref text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  booking public.bookings%rowtype;
  agreement public.booking_agreements%rowtype;
  firm_name text;
  attendee text;
  consent jsonb := app.esign_consent();
begin
  if p_ref is null or p_ref !~ '^[a-z2-7]{26}$' then
    return jsonb_build_object('state', 'unavailable');
  end if;
  select * into booking from public.bookings where public_ref = p_ref;
  if booking.id is null then
    return jsonb_build_object('state', 'unavailable');
  end if;
  select * into agreement from public.booking_agreements
  where booking_id = booking.id and status in ('sent', 'signed')
  order by sent_at desc limit 1;
  if agreement.id is null then
    return jsonb_build_object('state', 'unavailable');
  end if;
  select coalesce(nullif(btrim(org.display_name), ''), org.legal_name) into firm_name from public.organizations org where org.id = booking.organization_id;
  select a.display_name into attendee from public.booking_attendees a where a.booking_id = booking.id and a.role = 'primary' limit 1;
  return jsonb_build_object(
    'state', case when agreement.status = 'signed' then 'signed'
                  when booking.status in ('cancelled', 'expired') then 'closed'
                  else 'open' end,
    'firm', firm_name,
    'attendee', attendee,
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
    'sample', booking.is_sample
  );
end;
$$;
comment on function public.booking_agreement_for_signing(text) is
  'What the holder of a booking''s private link may see to sign its consultation agreement: the firm, the meeting, the locked text and hash, the consent, the state.';
revoke all on function public.booking_agreement_for_signing(text) from public;
grant execute on function public.booking_agreement_for_signing(text) to anon, authenticated, service_role;

create function public.sign_booking_agreement(
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
declare
  booking public.bookings%rowtype;
  agreement public.booking_agreements%rowtype;
  consent jsonb := app.esign_consent();
  name_in text := btrim(coalesce(p_name, ''));
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
  if p_consent is distinct from true then
    raise exception 'electronic signature consent is required' using errcode = '22023';
  end if;
  if length(name_in) not between 2 and 200 then
    raise exception 'type your full name to sign' using errcode = '22023';
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
      consent_text = consent ->> 'text'
  where id = agreement.id;
  perform app.record_audit_event(
    agreement.organization_id, 'booking_agreement.signed', 'public.bookings', booking.id, 'success',
    jsonb_build_object('booking_agreement_id', agreement.id, 'sha256', agreement.content_sha256)
  );
  return jsonb_build_object('ok', true, 'replayed', false, 'signed_at', statement_timestamp());
end;
$$;
comment on function public.sign_booking_agreement(text, text, boolean, text, inet, text) is
  'Signs a booking''s consultation agreement through its private link: typed name, consent, the hash of the text shown, IP and browser. Once.';
revoke all on function public.sign_booking_agreement(text, text, boolean, text, inet, text) from public;
grant execute on function public.sign_booking_agreement(text, text, boolean, text, inet, text) to anon, authenticated, service_role;
