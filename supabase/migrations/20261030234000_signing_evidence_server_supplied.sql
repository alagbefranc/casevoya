-- E-sign evidence (IP address and user agent) is supplied by the server, not by the caller.
--
-- public.sign_agreement / public.decline_agreement (inet variants) took p_ip and p_user_agent
-- from a signed-in session, and public.sign_booking_agreement took them from anyone holding a
-- booking link, so a direct API call could record any address as signature evidence.
--
--   * Booking agreements: public.sign_booking_agreement (both overloads) is service role only.
--     It authenticates the booker by the link reference and the code-session hash, not by
--     auth.uid(), so src/modules/scheduling/agreement-sign.ts calls it with the service role
--     and every check in the function still applies.
--   * Envelope signing and declining keep running as the signer (auth.uid(), organization,
--     aal2 / step-up and identity checks in app.sign_agreement / app.decline_agreement are
--     unchanged). The server first records the address it observed with
--     public.issue_signing_evidence (service role only; bound to the signer and the envelope,
--     single use, ten minutes), then the signer's session calls the new overloads
--     public.sign_agreement(..., p_evidence_id) / public.decline_agreement(..., p_evidence_id),
--     which take the IP and user agent from that record. The inet overloads are no longer
--     granted to authenticated.
--
-- Bodies of app.sign_agreement (20261019020000_firm_countersign.sql) and app.decline_agreement
-- (20261017190100_inhouse_esign.sql) are not changed.

-- ---------------------------------------------------------------------------
-- Server-recorded evidence (no grants; read and written by definer functions only)
-- ---------------------------------------------------------------------------

create table if not exists app.signing_evidence (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  envelope_id uuid not null,
  ip inet not null,
  user_agent text not null check (length(user_agent) between 1 and 400),
  created_at timestamptz not null default statement_timestamp(),
  used_at timestamptz
);
alter table app.signing_evidence enable row level security;
alter table app.signing_evidence force row level security;
revoke all on table app.signing_evidence from public, anon, authenticated;
create index if not exists signing_evidence_created_idx on app.signing_evidence (created_at);

create or replace function public.issue_signing_evidence(
  p_envelope_id uuid,
  p_actor uuid,
  p_ip inet,
  p_user_agent text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform app.require_service_role();
  if p_envelope_id is null or p_actor is null then
    raise exception 'the signer and the agreement are required' using errcode = '22023';
  end if;
  if p_ip is null then
    raise exception 'signer IP is required' using errcode = '22023';
  end if;
  if p_user_agent is null or length(btrim(p_user_agent)) not between 1 and 400 then
    raise exception 'user agent is required' using errcode = '22023';
  end if;
  if not exists (select 1 from public.signature_envelopes where id = p_envelope_id) then
    raise exception 'agreement denied' using errcode = '42501';
  end if;
  delete from app.signing_evidence where created_at < statement_timestamp() - interval '1 day';
  insert into app.signing_evidence (user_id, envelope_id, ip, user_agent)
  values (p_actor, p_envelope_id, p_ip, left(btrim(p_user_agent), 400))
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.issue_signing_evidence(uuid, uuid, inet, text) from public, anon, authenticated;
grant execute on function public.issue_signing_evidence(uuid, uuid, inet, text) to service_role;

-- The signer's own unused evidence for this envelope, issued in the last ten minutes. Marked used.
create or replace function app.take_signing_evidence(p_evidence_id uuid, p_envelope_id uuid)
returns table (ip inet, user_agent text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row app.signing_evidence%rowtype;
begin
  update app.signing_evidence ev
     set used_at = statement_timestamp()
   where ev.id = p_evidence_id
     and ev.envelope_id = p_envelope_id
     and ev.user_id = (select auth.uid())
     and ev.used_at is null
     and ev.created_at > statement_timestamp() - interval '10 minutes'
  returning ev.* into v_row;
  if v_row.id is null then
    raise exception 'signing evidence not found' using errcode = '42501';
  end if;
  ip := v_row.ip;
  user_agent := v_row.user_agent;
  return next;
end;
$$;
revoke all on function app.take_signing_evidence(uuid, uuid) from public, anon;
grant execute on function app.take_signing_evidence(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Signer entry points with server-recorded evidence
-- ---------------------------------------------------------------------------

create or replace function public.sign_agreement(
  p_envelope_id uuid,
  p_consent boolean,
  p_idempotency_key text,
  p_evidence_id uuid
)
returns jsonb
language plpgsql
security invoker
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
security invoker
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

-- Caller-supplied evidence: no longer reachable from a session.
revoke all on function public.sign_agreement(uuid, boolean, text, inet, text) from public, anon, authenticated;
revoke all on function public.decline_agreement(uuid, text, inet, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Booking agreements: service role only
-- ---------------------------------------------------------------------------

revoke all on function public.sign_booking_agreement(text, text, boolean, text, inet, text) from public, anon, authenticated;
grant execute on function public.sign_booking_agreement(text, text, boolean, text, inet, text) to service_role;
revoke all on function public.sign_booking_agreement(text, text, boolean, text, inet, text, text, text, text) from public, anon, authenticated;
grant execute on function public.sign_booking_agreement(text, text, boolean, text, inet, text, text, text, text) to service_role;
