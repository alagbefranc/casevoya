-- The firm countersigns service agreements in-house.
--
-- The Sheet now sends a service or consultation agreement to the clients first (applicant, then
-- sponsor) and then to the matter's responsible consultant, who countersigns last for the firm.
-- The envelope tables already took a staff signer (envelope_signers.membership_id, role
-- consultant or firm) and app.sign_agreement already required aal2 and a recent step-up for one.
-- What the database could not yet say:
--   * a consultant signer must be licensed (app.membership_is_licensed), both when the envelope
--     is sent and when they sign (a licence can lapse in between). The firm role is unchanged.
--   * nobody told a staff signer it was their turn. agreement.sent emails every signer at send,
--     which sent the consultant a "ready to sign in the portal" email before the clients signed.
--     Now agreement.sent emails the person signers only; when a staff signer becomes current
--     (at send, or after the signer before them) app.enqueue_event adds agreement.signer_turn,
--     and the mail worker sends that one staff member the agreement email with the Sheet link,
--     only while they are still the current signer of an open envelope. agreement.executed
--     still goes to everyone, staff included.
--   * the sealed PDF names the consultant but not their licence. app.agreement_seal_source now
--     adds the consultant signer's CICC licence (type and college id) for the renderer.
--
-- Replaced functions (copied from their latest definition, changes marked "firm countersign"):
--   app.send_agreement             from 20261017190100_inhouse_esign.sql (its only definition)
--   app.sign_agreement             from 20261019000000_agreement_pdf_layout.sql
--   public.claim_mail_events       from 20261018190100_invitation_email_link_mail_worker.sql
--   public.prepare_email_delivery  from 20261018190100_invitation_email_link_mail_worker.sql
--   app.agreement_seal_source      from 20261019000000_agreement_pdf_layout.sql (its only definition)
-- create or replace keeps each function's grants; they are restated below so this file reads on
-- its own. No table, policy or RLS setting changes. Additive only.

create or replace function app.send_agreement(
  p_agreement_id uuid,
  p_signers jsonb,
  p_idempotency_key text,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  agreement public.agreements%rowtype;
  ver public.agreement_versions%rowtype;
  matter public.matters%rowtype;
  existing public.signature_envelopes%rowtype;
  item jsonb;
  ordinal integer;
  signer_role public.agreement_signer_role;
  signer_person uuid;
  signer_membership uuid;
  signer_name text;
  envelope_id uuid;
  content_hash text;
  expires_at timestamptz;
  seen integer := 0;
  inserted_signer uuid;
  turn_signer uuid;
begin
  select * into agreement from public.agreements where id = p_agreement_id for update;
  if agreement.id is null or app.can_read_agreement(agreement.id) is distinct from true then
    raise exception 'agreement denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    agreement.organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[],
    true
  );
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 180 then
    raise exception 'an idempotency key is required' using errcode = '22023';
  end if;
  select * into existing
  from public.signature_envelopes
  where organization_id = agreement.organization_id
    and idempotency_key = p_idempotency_key;
  if existing.id is not null then
    perform app.record_audit_event(
      agreement.organization_id, 'signature.replayed', 'public.signature_envelopes', existing.id, 'success',
      jsonb_build_object('idempotency_key', p_idempotency_key)
    );
    return jsonb_build_object('ok', true, 'replayed', true, 'envelope_id', existing.id, 'status', existing.status, 'content_sha256', existing.content_sha256);
  end if;
  if agreement.kind <> 'quote' and agreement.status <> 'draft' then
    raise exception 'only a draft agreement can be sent' using errcode = '42501';
  end if;
  select * into matter from public.matters where id = agreement.matter_id;
  if app.sample_mode_blocks_real(matter.organization_id, matter.is_sample) then
    raise exception 'this firm is in sample mode; only sample matters accept new work' using errcode = '42501';
  end if;
  if app.responsible_licence_blocks_agreement(matter.id) then
    raise exception 'not entitled, revoked, suspended, or inactive licence blocks this agreement' using errcode = '42501';
  end if;
  select * into ver from public.agreement_versions where id = agreement.current_version_id for update;
  if agreement.kind = 'quote' and agreement.status in ('sent', 'accepted') then
    return jsonb_build_object('ok', true, 'replayed', true, 'status', agreement.status, 'content_sha256', ver.content_sha256);
  end if;
  if ver.id is null or ver.locked_at is not null then
    raise exception 'agreement denied' using errcode = '42501';
  end if;
  if agreement.kind = 'quote' then
    if agreement.status <> 'draft' then
      raise exception 'only a draft quote can be issued' using errcode = '42501';
    end if;
    content_hash := app.portal_statement_hash(ver.canonical_body);
    perform app.open_esign_write(ver.id);
    update public.agreement_versions
    set content_sha256 = content_hash, locked_at = statement_timestamp()
    where id = ver.id;
    perform app.close_esign_write(ver.id);
    perform app.open_esign_write(agreement.id);
    update public.agreements set status = 'sent' where id = agreement.id;
    perform app.close_esign_write(agreement.id);
    perform app.record_audit_event(
      agreement.organization_id, 'agreement.quote_issued', 'public.agreements', agreement.id, 'success',
      jsonb_build_object('content_sha256', content_hash)
    );
    return jsonb_build_object('ok', true, 'replayed', false, 'status', 'sent', 'content_sha256', content_hash);
  end if;
  if jsonb_typeof(p_signers) <> 'array' or jsonb_array_length(p_signers) not between 1 and 8 then
    raise exception 'at least one signer is required' using errcode = '22023';
  end if;

  content_hash := app.portal_statement_hash(ver.canonical_body);
  expires_at := coalesce(p_expires_at, app.envelope_default_expiry());
  if expires_at <= statement_timestamp() then
    raise exception 'envelope expiry must be in the future' using errcode = '22023';
  end if;

  perform app.open_esign_write(ver.id);
  update public.agreement_versions
  set content_sha256 = content_hash,
      locked_at = statement_timestamp()
  where id = ver.id;
  perform app.close_esign_write(ver.id);

  insert into public.signature_envelopes (
    organization_id, agreement_id, version_id, status, idempotency_key, expires_at, content_sha256
  ) values (
    agreement.organization_id, agreement.id, ver.id, 'sent', p_idempotency_key, expires_at, content_hash
  )
  returning id into envelope_id;

  for item, ordinal in
    select value, ordinality::integer
    from jsonb_array_elements(p_signers) with ordinality
  loop
    seen := seen + 1;
    if seen <> ordinal then
      raise exception 'signing order must be contiguous' using errcode = '22023';
    end if;
    begin
      signer_role := (item ->> 'role')::public.agreement_signer_role;
    exception when invalid_text_representation then
      raise exception 'signer role is not supported' using errcode = '22023';
    end;
    signer_name := btrim(coalesce(item ->> 'display_name', ''));
    if length(signer_name) not between 1 and 200 then
      raise exception 'signer name is required' using errcode = '22023';
    end if;
    signer_person := nullif(item ->> 'person_id', '')::uuid;
    signer_membership := nullif(item ->> 'membership_id', '')::uuid;
    if signer_role in ('consultant', 'firm') then
      if signer_membership is null or not exists (
        select 1 from public.memberships mem
        where mem.id = signer_membership
          and mem.organization_id = agreement.organization_id
          and mem.status = 'active'
          and mem.role in ('firm_owner', 'licensed_consultant', 'case_manager')
      ) then
        raise exception 'the firm signer must be an active staff member' using errcode = '42501';
      end if;
      -- firm countersign: the consultant countersigns for the firm, so they must be licensed.
      if signer_role = 'consultant' and app.membership_is_licensed(signer_membership) is distinct from true then
        raise exception 'the consultant signer must be licensed' using errcode = '42501';
      end if;
      signer_person := null;
    else
      if signer_person is null or not exists (
        select 1
        from public.matter_participants party
        where party.matter_id = agreement.matter_id
          and party.organization_id = agreement.organization_id
          and party.person_id = signer_person
      ) then
        raise exception 'the signer must be a person on the matter' using errcode = '42501';
      end if;
      signer_membership := null;
    end if;
    insert into public.envelope_signers (
      organization_id, envelope_id, signing_order, role, person_id, membership_id, display_name, status
    ) values (
      agreement.organization_id,
      envelope_id,
      ordinal,
      signer_role,
      signer_person,
      signer_membership,
      signer_name,
      case when ordinal = 1 then 'current'::public.agreement_signer_status else 'waiting'::public.agreement_signer_status end
    )
    returning id into inserted_signer;
    -- firm countersign: a staff member who signs first is told it is their turn.
    if ordinal = 1 and signer_membership is not null then
      turn_signer := inserted_signer;
    end if;
  end loop;

  perform app.open_esign_write(agreement.id);
  update public.agreements set status = 'sent' where id = agreement.id;
  perform app.close_esign_write(agreement.id);

  insert into public.signature_events (
    organization_id, envelope_id, kind, idempotency_key, actor_user_id, content_sha256, summary
  ) values (
    agreement.organization_id,
    envelope_id,
    'sent',
    p_idempotency_key || ':sent',
    (select auth.uid()),
    content_hash,
    jsonb_build_object('signers', seen)
  );
  perform app.enqueue_event(
    agreement.organization_id, 'agreement', agreement.id, 'agreement.sent',
    jsonb_build_object('agreement_id', agreement.id, 'envelope_id', envelope_id, 'matter_id', agreement.matter_id),
    ver.version_number,
    'agreement.sent:' || envelope_id::text,
    null
  );
  if turn_signer is not null then
    perform app.enqueue_event(
      agreement.organization_id, 'agreement', agreement.id, 'agreement.signer_turn',
      jsonb_build_object(
        'agreement_id', agreement.id, 'envelope_id', envelope_id, 'matter_id', agreement.matter_id,
        'signer_id', turn_signer
      ),
      ver.version_number,
      'agreement.signer_turn:' || turn_signer::text,
      null
    );
  end if;
  perform app.record_audit_event(
    agreement.organization_id, 'agreement.sent', 'public.signature_envelopes', envelope_id, 'success',
    jsonb_build_object('content_sha256', content_hash, 'signers', seen)
  );
  return jsonb_build_object('ok', true, 'replayed', false, 'envelope_id', envelope_id, 'status', 'sent', 'content_sha256', content_hash);
end;
$$;

create or replace function app.sign_agreement(
  p_envelope_id uuid,
  p_consent boolean,
  p_idempotency_key text,
  p_ip inet,
  p_user_agent text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  envelope public.signature_envelopes%rowtype;
  agreement public.agreements%rowtype;
  ver public.agreement_versions%rowtype;
  signer public.envelope_signers%rowtype;
  prior public.signature_events%rowtype;
  consent jsonb;
  v_consent_text text;
  v_consent_version text;
  next_signer uuid;
  next_membership uuid;
  remaining integer;
  person_id uuid;
begin
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 180 then
    raise exception 'an idempotency key is required' using errcode = '22023';
  end if;
  if p_user_agent is null or length(btrim(p_user_agent)) not between 1 and 400 then
    raise exception 'user agent is required' using errcode = '22023';
  end if;
  if p_ip is null then
    raise exception 'signer IP is required' using errcode = '22023';
  end if;
  select * into envelope from public.signature_envelopes where id = p_envelope_id for update;
  if envelope.id is null then
    raise exception 'agreement denied' using errcode = '42501';
  end if;
  select * into agreement from public.agreements where id = envelope.agreement_id;
  if agreement.organization_id is distinct from (select app.current_organization_id()) then
    raise exception 'agreement denied' using errcode = '42501';
  end if;
  select * into prior
  from public.signature_events
  where organization_id = envelope.organization_id
    and idempotency_key = p_idempotency_key;
  if prior.id is not null then
    perform app.record_audit_event(
      envelope.organization_id, 'signature.replayed', 'public.signature_events', prior.id, 'success',
      jsonb_build_object('envelope_id', envelope.id)
    );
    return jsonb_build_object(
      'ok', true, 'replayed', true, 'envelope_id', envelope.id, 'status', envelope.status,
      'content_sha256', envelope.content_sha256, 'sealed_sha256', envelope.sealed_sha256,
      'event_id', prior.id
    );
  end if;
  if envelope.status in ('voided', 'superseded', 'declined', 'expired', 'completed') then
    raise exception 'this envelope is no longer open' using errcode = '42501';
  end if;
  if envelope.expires_at <= statement_timestamp() then
    perform app.open_esign_write(envelope.id);
    update public.signature_envelopes set status = 'expired' where id = envelope.id;
    perform app.close_esign_write(envelope.id);
    perform app.open_esign_write(agreement.id);
    update public.agreements set status = 'expired' where id = agreement.id and status in ('sent', 'partially_signed');
    perform app.close_esign_write(agreement.id);
    insert into public.signature_events (
      organization_id, envelope_id, kind, idempotency_key, actor_user_id, content_sha256, summary
    ) values (
      envelope.organization_id, envelope.id, 'expired', p_idempotency_key, (select auth.uid()), envelope.content_sha256,
      jsonb_build_object('reason', 'expiry')
    );
    raise exception 'envelope expired' using errcode = '42501';
  end if;
  if p_consent is distinct from true then
    raise exception 'electronic signature consent is required' using errcode = '42501';
  end if;

  select * into signer
  from public.envelope_signers
  where envelope_id = envelope.id
    and status = 'current'
  for update;
  if signer.id is null then
    raise exception 'it is not your turn to sign' using errcode = '42501';
  end if;
  if signer.membership_id is not null then
    perform app.require_active_staff(
      envelope.organization_id,
      array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[],
      true
    );
    if not exists (
      select 1 from public.memberships mem
      where mem.id = signer.membership_id
        and mem.user_id = (select auth.uid())
        and mem.status = 'active'
    ) then
      raise exception 'signer identity does not match' using errcode = '42501';
    end if;
    -- firm countersign: the consultant signs for the firm only while licensed.
    if signer.role = 'consultant' and app.membership_is_licensed(signer.membership_id) is distinct from true then
      raise exception 'the consultant signer must be licensed' using errcode = '42501';
    end if;
  else
    if not exists (
      select 1 from public.persons person
      where person.id = signer.person_id
        and person.organization_id = envelope.organization_id
        and person.user_id = (select auth.uid())
    ) then
      raise exception 'signer identity does not match' using errcode = '42501';
    end if;
  end if;

  consent := app.esign_consent();
  v_consent_text := left(coalesce(consent ->> 'text', ''), 500);
  v_consent_version := coalesce(consent ->> 'version', 'esign-consent-2026-10-17');
  if length(v_consent_text) < 1 then
    raise exception 'electronic signature consent text is not configured' using errcode = '22023';
  end if;

  perform app.open_esign_write(signer.id);
  update public.envelope_signers
  set status = 'signed',
      consent_accepted = true,
      consent_version = v_consent_version,
      consent_text = v_consent_text,
      signed_at = statement_timestamp(),
      signer_user_id = (select auth.uid()),
      ip = p_ip,
      user_agent = left(btrim(p_user_agent), 400)
  where id = signer.id;
  perform app.close_esign_write(signer.id);

  if signer.person_id is not null then
    insert into public.consent_records (
      organization_id, person_id, matter_id, purpose, policy_version, scope,
      statement_text, statement_sha256, granted
    ) values (
      envelope.organization_id,
      signer.person_id,
      agreement.matter_id,
      'electronic_signature',
      v_consent_version,
      'electronic_signature',
      v_consent_text,
      app.portal_statement_hash(v_consent_text),
      true
    );
  end if;

  insert into public.signature_events (
    organization_id, envelope_id, signer_id, kind, idempotency_key, actor_user_id, ip, user_agent,
    consent_accepted, consent_version, content_sha256, summary
  ) values (
    envelope.organization_id, envelope.id, signer.id, 'signed', p_idempotency_key, (select auth.uid()),
    p_ip, left(btrim(p_user_agent), 400), true, v_consent_version, envelope.content_sha256,
    jsonb_build_object('signing_order', signer.signing_order, 'role', signer.role)
  );

  select count(*) into remaining
  from public.envelope_signers
  where envelope_id = envelope.id
    and status in ('waiting', 'current');
  if remaining > 0 then
    select id, membership_id into next_signer, next_membership
    from public.envelope_signers
    where envelope_id = envelope.id
      and status = 'waiting'
    order by signing_order
    limit 1;
    perform app.open_esign_write(next_signer);
    update public.envelope_signers set status = 'current' where id = next_signer;
    perform app.close_esign_write(next_signer);
    perform app.open_esign_write(envelope.id);
    update public.signature_envelopes set status = 'partially_signed' where id = envelope.id;
    perform app.close_esign_write(envelope.id);
    perform app.open_esign_write(agreement.id);
    update public.agreements set status = 'partially_signed' where id = agreement.id;
    perform app.close_esign_write(agreement.id);
    -- firm countersign: when the next signer is staff (the consultant), tell them it is their turn.
    if next_membership is not null then
      perform app.enqueue_event(
        envelope.organization_id, 'agreement', agreement.id, 'agreement.signer_turn',
        jsonb_build_object(
          'agreement_id', agreement.id, 'envelope_id', envelope.id, 'matter_id', agreement.matter_id,
          'signer_id', next_signer
        ),
        null,
        'agreement.signer_turn:' || next_signer::text,
        null
      );
    end if;
    perform app.record_audit_event(
      envelope.organization_id, 'agreement.signed', 'public.envelope_signers', signer.id, 'success',
      jsonb_build_object('envelope_id', envelope.id, 'partial', true)
    );
    return jsonb_build_object(
      'ok', true, 'replayed', false, 'envelope_id', envelope.id, 'status', 'partially_signed',
      'content_sha256', envelope.content_sha256
    );
  end if;

  select * into ver from public.agreement_versions where id = envelope.version_id;
  -- laid-out seal: the sealed copy is filed under a person on the matter; refuse completion
  -- without one, exactly as before, so the attach that follows cannot fail for that reason.
  select signer_row.person_id into person_id
  from public.envelope_signers signer_row
  where signer_row.envelope_id = envelope.id
    and signer_row.person_id is not null
  order by signer_row.signing_order
  limit 1;
  if person_id is null then
    select party.person_id into person_id
    from public.matter_participants party
    where party.matter_id = agreement.matter_id
      and party.person_id is not null
    limit 1;
  end if;
  if person_id is null then
    raise exception 'a sealed agreement needs a person on the matter' using errcode = '42501';
  end if;
  -- laid-out seal: no PDF is built here. The app server renders the laid-out PDF and
  -- certificate from these immutable rows and attaches them once (app.attach_sealed_agreement).
  perform app.open_esign_write(envelope.id);
  update public.signature_envelopes
  set status = 'completed',
      completed_at = statement_timestamp()
  where id = envelope.id;
  perform app.close_esign_write(envelope.id);
  perform app.open_esign_write(agreement.id);
  update public.agreements set status = 'completed' where id = agreement.id;
  perform app.close_esign_write(agreement.id);
  insert into public.signature_events (
    organization_id, envelope_id, kind, idempotency_key, actor_user_id, content_sha256, summary
  ) values (
    envelope.organization_id, envelope.id, 'completed', p_idempotency_key || ':completed', (select auth.uid()),
    envelope.content_sha256, jsonb_build_object('seal', 'pending')
  );
  if agreement.kind = 'service' then
    perform app.advance_engagement_from_signature(agreement.matter_id, agreement.id, ver.scope_summary);
  end if;
  perform app.enqueue_event(
    agreement.organization_id, 'agreement', agreement.id, 'agreement.executed',
    jsonb_build_object(
      'agreement_id', agreement.id, 'envelope_id', envelope.id, 'matter_id', agreement.matter_id,
      'content_sha256', envelope.content_sha256
    ),
    ver.version_number,
    'agreement.executed:' || envelope.id::text,
    null
  );
  perform app.record_audit_event(
    envelope.organization_id, 'agreement.completed', 'public.signature_envelopes', envelope.id, 'success',
    jsonb_build_object('content_sha256', envelope.content_sha256, 'seal', 'pending')
  );
  return jsonb_build_object(
    'ok', true, 'replayed', false, 'envelope_id', envelope.id, 'status', 'completed',
    'content_sha256', envelope.content_sha256, 'sealed_sha256', null, 'seal_pending', true
  );
end;
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
      'document.reviewed'
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
    perform app.queue_email_delivery(
      event.id, event.organization_id, event.payload ->> 'recipient_email',
      template, matter, true, ctx, true
    );
  elsif event.event_type = 'staff_invitation.email_requested' then
    ctx := ctx || jsonb_build_object('kind', 'staff', 'role', event.payload ->> 'role');
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
      select lower(coalesce(person.email, users.email)) as email
      from public.envelope_signers signer
      left join public.persons person on person.id = signer.person_id
      left join public.memberships membership on membership.id = signer.membership_id
      left join auth.users users on users.id = membership.user_id
      where signer.envelope_id::text = event.payload ->> 'envelope_id'
        and signer.organization_id = event.organization_id
        -- firm countersign: staff signers hear when it is their turn (agreement.signer_turn), not at send.
        and (event.event_type = 'agreement.executed' or signer.person_id is not null)
    loop
      perform app.queue_email_delivery(
        event.id, event.organization_id, rec.email, template, matter, true, ctx, true
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
    ctx := ctx || jsonb_build_object(
      'purpose', left(coalesce(event.payload ->> 'purpose', ''), 200),
      'due_on', event.payload ->> 'due_on'
    );
    perform app.queue_email_delivery(
      event.id, event.organization_id,
      (select person.email from public.persons person where person.id::text = event.payload ->> 'person_id'),
      template, matter, true, ctx, true
    );
  elsif event.event_type in ('document.uploaded', 'document.reviewed') then
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
  )), '[]'::jsonb)
  into messages
  from public.email_deliveries delivery
  where delivery.outbox_event_id = event.id
    and delivery.status = 'sending';

  return jsonb_build_object('action', 'send', 'event_id', event.id, 'messages', messages);
end;
$$;

create or replace function app.agreement_seal_source(p_envelope_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  envelope public.signature_envelopes%rowtype;
  agreement public.agreements%rowtype;
  ver public.agreement_versions%rowtype;
  matter public.matters%rowtype;
  org public.organizations%rowtype;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  select * into envelope from public.signature_envelopes where id = p_envelope_id;
  if envelope.id is null then
    return null;
  end if;
  select * into agreement from public.agreements where id = envelope.agreement_id;
  select * into ver from public.agreement_versions where id = envelope.version_id;
  select * into matter from public.matters where id = agreement.matter_id;
  select * into org from public.organizations where id = envelope.organization_id;
  return jsonb_build_object(
    'organization', jsonb_build_object(
      'id', org.id,
      'display_name', org.display_name,
      'legal_name', org.legal_name,
      'timezone', org.timezone,
      'logo_locator', org.branding ->> 'logo_locator',
      'accent', org.branding ->> 'accent'
    ),
    'matter', jsonb_build_object('id', matter.id, 'reference', matter.reference, 'title', matter.title),
    'agreement', jsonb_build_object('id', agreement.id, 'kind', agreement.kind, 'title', agreement.title),
    'version', jsonb_build_object(
      'id', ver.id,
      'version_number', ver.version_number,
      'canonical_body', ver.canonical_body,
      'scope_summary', ver.scope_summary,
      'exclusions', ver.exclusions,
      'refund_policy', ver.refund_policy,
      'fee_cents', ver.fee_cents,
      'currency', ver.currency,
      'government_fee_note', ver.government_fee_note,
      'comparison_note', ver.comparison_note,
      'content_sha256', ver.content_sha256,
      'locked_at', ver.locked_at
    ),
    'envelope', jsonb_build_object(
      'id', envelope.id,
      'status', envelope.status,
      'provider', envelope.provider,
      'content_sha256', envelope.content_sha256,
      'sent_at', envelope.sent_at,
      'completed_at', envelope.completed_at,
      'sealed', envelope.sealed_pdf is not null
    ),
    'signers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', signer.id,
        'signing_order', signer.signing_order,
        'role', signer.role,
        'display_name', signer.display_name,
        'status', signer.status,
        'signed_at', signer.signed_at,
        'ip', host(signer.ip),
        'user_agent', signer.user_agent,
        'consent_version', signer.consent_version,
        'consent_text', signer.consent_text,
        -- firm countersign: the consultant's CICC licence, printed under their signature.
        'licence', case when signer.role = 'consultant' then (
          select credential.licence_type::text || ' ' || credential.college_id
          from public.consultant_credentials credential
          where credential.membership_id = signer.membership_id
            and credential.organization_id = signer.organization_id
          order by credential.declared_at desc
          limit 1
        ) end
      ) order by signer.signing_order)
      from public.envelope_signers signer
      where signer.envelope_id = envelope.id
    ), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', event.kind,
        'occurred_at', event.occurred_at,
        'signing_order', signer.signing_order,
        'ip', host(event.ip),
        'consent_version', event.consent_version
      ) order by event.occurred_at, event.created_at, event.id)
      from public.signature_events event
      left join public.envelope_signers signer on signer.id = event.signer_id
      where event.envelope_id = envelope.id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function app.send_agreement(uuid, jsonb, text, timestamptz) from public;
grant execute on function app.send_agreement(uuid, jsonb, text, timestamptz) to authenticated, service_role;
revoke all on function app.sign_agreement(uuid, boolean, text, inet, text) from public;
grant execute on function app.sign_agreement(uuid, boolean, text, inet, text) to authenticated, service_role;
revoke all on function public.claim_mail_events(text, integer) from public, anon, authenticated;
grant execute on function public.claim_mail_events(text, integer) to service_role;
revoke all on function public.prepare_email_delivery(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.prepare_email_delivery(uuid, text, text, text) to service_role;
revoke all on function app.agreement_seal_source(uuid) from public, anon, authenticated;
grant execute on function app.agreement_seal_source(uuid) to service_role;
