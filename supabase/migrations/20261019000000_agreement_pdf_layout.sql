-- Laid-out sealed agreement PDF and completion certificate, rendered by the app server.
--
-- Until now the last signature built both PDFs in SQL (app.build_text_pdf): one page of
-- ASCII-only text. From this migration the database still completes the envelope in the same
-- transaction as the last signature, but it no longer builds the PDF. The app server renders
-- the laid-out PDF and certificate from the envelope's immutable rows and attaches them ONCE
-- through public.attach_sealed_agreement, which only the service role can call:
--   * the attach refuses anything that is not a PDF and computes both SHA-256 values itself;
--   * the first attach wins; a later attach returns the stored hashes and changes nothing;
--   * the guard trigger now also refuses any change to the stored hashes, renderer,
--     storage keys and document versions once they are set (the bytes were already guarded).
-- The content SHA-256 (signature_envelopes.content_sha256 = SHA-256 of the locked canonical
-- text) is unchanged and still computed at send.
-- Envelopes completed before this migration keep their stored sealed bytes; nothing here
-- rewrites them, and downloads keep serving them as they are.
--
-- Replaced functions (copied from their latest definition, changes marked "laid-out seal"):
--   app.guard_esign_write  from 20261017190100_inhouse_esign.sql (its only definition)
--   app.sign_agreement     from 20261017190100_inhouse_esign.sql (its only definition)
-- New: app.agreement_seal_source / public.agreement_seal_source (service role only),
--      app.attach_sealed_agreement / public.attach_sealed_agreement (service role only).
-- Additive only.

alter table public.signature_envelopes
  add column if not exists sealed_renderer text
  check (sealed_renderer is null or sealed_renderer ~ '^[a-z0-9][a-z0-9.-]{0,59}$');
comment on column public.signature_envelopes.sealed_renderer is
  'Which renderer produced sealed_pdf and certificate_pdf. Null for envelopes sealed in SQL before 20261019000000.';

-- A completed envelope may wait briefly for its laid-out PDF. It still needs completed_at, and
-- the bytes and their hashes are only ever set together.
do $relax_completed_seal$
declare
  constraint_name text;
begin
  for constraint_name in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.signature_envelopes'::regclass
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%completed%'
      and pg_get_constraintdef(con.oid) ilike '%sealed_pdf IS NOT NULL%'
  loop
    execute format('alter table public.signature_envelopes drop constraint %I', constraint_name);
  end loop;
end
$relax_completed_seal$;

alter table public.signature_envelopes
  add constraint signature_envelopes_completed_at_ck
  check (status <> 'completed' or completed_at is not null);
alter table public.signature_envelopes
  add constraint signature_envelopes_sealed_pair_ck
  check ((sealed_pdf is null) = (sealed_sha256 is null)) not valid;
alter table public.signature_envelopes
  add constraint signature_envelopes_certificate_pair_ck
  check ((certificate_pdf is null) = (certificate_sha256 is null)) not valid;
alter table public.signature_envelopes
  add constraint signature_envelopes_sealed_complete_ck
  check (sealed_pdf is null or (status = 'completed' and certificate_pdf is not null)) not valid;

create or replace function app.guard_esign_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from app.esign_write_nonce nonce
    where nonce.object_id = new.id
      and nonce.txid = txid_current()
  ) then
    raise exception 'agreement changes go through an agreement function' using errcode = '42501';
  end if;
  if tg_table_name = 'agreement_versions' then
    if old.locked_at is not null then
      raise exception 'a locked agreement version cannot change' using errcode = '42501';
    end if;
  elsif tg_table_name = 'signature_envelopes' then
    if old.sealed_pdf is not null and new.sealed_pdf is distinct from old.sealed_pdf then
      raise exception 'a sealed agreement PDF cannot change' using errcode = '42501';
    end if;
    if old.certificate_pdf is not null and new.certificate_pdf is distinct from old.certificate_pdf then
      raise exception 'a completion certificate cannot change' using errcode = '42501';
    end if;
    -- laid-out seal: the hashes, renderer and stored copies are as immutable as the bytes.
    if (old.sealed_sha256 is not null and new.sealed_sha256 is distinct from old.sealed_sha256)
       or (old.certificate_sha256 is not null and new.certificate_sha256 is distinct from old.certificate_sha256)
       or (old.sealed_renderer is not null and new.sealed_renderer is distinct from old.sealed_renderer)
       or (old.sealed_storage_key is not null and new.sealed_storage_key is distinct from old.sealed_storage_key)
       or (old.certificate_storage_key is not null and new.certificate_storage_key is distinct from old.certificate_storage_key)
       or (old.sealed_document_version_id is not null and new.sealed_document_version_id is distinct from old.sealed_document_version_id)
       or (old.certificate_document_version_id is not null and new.certificate_document_version_id is distinct from old.certificate_document_version_id) then
      raise exception 'a sealed agreement PDF cannot change' using errcode = '42501';
    end if;
    if old.content_sha256 is distinct from new.content_sha256 then
      raise exception 'the signed content hash cannot change' using errcode = '42501';
    end if;
    if old.status = 'completed' and new.status is distinct from 'completed' then
      raise exception 'an executed envelope cannot change status' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function app.guard_esign_write() from public;
grant execute on function app.guard_esign_write() to authenticated, service_role;

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
    select id into next_signer
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
revoke all on function app.sign_agreement(uuid, boolean, text, inet, text) from public;
grant execute on function app.sign_agreement(uuid, boolean, text, inet, text) to authenticated, service_role;

-- Everything the renderer needs, read from rows that no longer change once the envelope is
-- completed. Service role only: it includes signer IP and user agent evidence.
create function app.agreement_seal_source(p_envelope_id uuid)
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
        'consent_text', signer.consent_text
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
revoke all on function app.agreement_seal_source(uuid) from public, anon, authenticated;
grant execute on function app.agreement_seal_source(uuid) to service_role;

-- Attaches the laid-out sealed PDF and certificate once. Service role only. The database
-- computes both hashes; the first attach wins and a later one changes nothing.
create function app.attach_sealed_agreement(
  p_envelope_id uuid,
  p_pdf bytea,
  p_certificate bytea,
  p_renderer text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  envelope public.signature_envelopes%rowtype;
  agreement public.agreements%rowtype;
  person_id uuid;
  pdf_sha text;
  certificate_sha text;
  sealed_version uuid;
  certificate_version uuid;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_renderer is null or p_renderer !~ '^[a-z0-9][a-z0-9.-]{0,59}$' then
    raise exception 'renderer name is required' using errcode = '22023';
  end if;
  select * into envelope from public.signature_envelopes where id = p_envelope_id for update;
  if envelope.id is null then
    raise exception 'agreement denied' using errcode = '42501';
  end if;
  if envelope.sealed_pdf is not null then
    return jsonb_build_object(
      'ok', true, 'attached', false, 'envelope_id', envelope.id,
      'sealed_sha256', envelope.sealed_sha256, 'certificate_sha256', envelope.certificate_sha256
    );
  end if;
  if envelope.status <> 'completed' then
    raise exception 'only a completed envelope is sealed' using errcode = '42501';
  end if;
  if p_pdf is null or substring(p_pdf from 1 for 5) <> '\x255044462d'::bytea
     or p_certificate is null or substring(p_certificate from 1 for 5) <> '\x255044462d'::bytea then
    raise exception 'sealed file is not a PDF' using errcode = '22023';
  end if;
  if octet_length(p_pdf) > 8 * 1024 * 1024 or octet_length(p_certificate) > 8 * 1024 * 1024 then
    raise exception 'sealed file is too large' using errcode = '22023';
  end if;
  select * into agreement from public.agreements where id = envelope.agreement_id;
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
  pdf_sha := encode(extensions.digest(p_pdf, 'sha256'), 'hex');
  certificate_sha := encode(extensions.digest(p_certificate, 'sha256'), 'hex');
  sealed_version := app.store_sealed_pdf(
    agreement.organization_id, agreement.matter_id, person_id,
    'Executed agreement', 'executed-agreement.pdf', p_pdf, pdf_sha
  );
  certificate_version := app.store_sealed_pdf(
    agreement.organization_id, agreement.matter_id, person_id,
    'Completion certificate', 'completion-certificate.pdf', p_certificate, certificate_sha
  );
  perform app.open_esign_write(envelope.id);
  update public.signature_envelopes
  set sealed_sha256 = pdf_sha,
      certificate_sha256 = certificate_sha,
      sealed_pdf = p_pdf,
      certificate_pdf = p_certificate,
      sealed_renderer = p_renderer,
      sealed_storage_key = (select storage_key from public.document_versions where id = sealed_version),
      certificate_storage_key = (select storage_key from public.document_versions where id = certificate_version),
      sealed_document_version_id = sealed_version,
      certificate_document_version_id = certificate_version
  where id = envelope.id;
  perform app.close_esign_write(envelope.id);
  perform app.record_audit_event(
    envelope.organization_id, 'agreement.sealed', 'public.signature_envelopes', envelope.id, 'success',
    jsonb_build_object(
      'content_sha256', envelope.content_sha256, 'sealed_sha256', pdf_sha,
      'certificate_sha256', certificate_sha, 'renderer', p_renderer
    )
  );
  return jsonb_build_object(
    'ok', true, 'attached', true, 'envelope_id', envelope.id,
    'sealed_sha256', pdf_sha, 'certificate_sha256', certificate_sha,
    'sealed_version_id', sealed_version, 'certificate_version_id', certificate_version
  );
end;
$$;
revoke all on function app.attach_sealed_agreement(uuid, bytea, bytea, text) from public, anon, authenticated;
grant execute on function app.attach_sealed_agreement(uuid, bytea, bytea, text) to service_role;

create function public.agreement_seal_source(p_envelope_id uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select app.agreement_seal_source(p_envelope_id); $$;
create function public.attach_sealed_agreement(p_envelope_id uuid, p_pdf bytea, p_certificate bytea, p_renderer text)
returns jsonb language sql security invoker set search_path = ''
as $$ select app.attach_sealed_agreement(p_envelope_id, p_pdf, p_certificate, p_renderer); $$;
revoke all on function public.agreement_seal_source(uuid) from public, anon, authenticated;
revoke all on function public.attach_sealed_agreement(uuid, bytea, bytea, text) from public, anon, authenticated;
grant execute on function public.agreement_seal_source(uuid) to service_role;
grant execute on function public.attach_sealed_agreement(uuid, bytea, bytea, text) to service_role;
