-- SEC-01 + SEC-06 follow-up: downloading a delivered privacy response is a high-risk client action,
-- so it needs the client's two-step sign-in, set up and checked in the last 15 minutes
-- (app.client_step_up_satisfied from 20261025270100). DECISIONS 2026-10-24 (SEC-01 row) says
-- SEC-06's response delivery must use it.
--
-- Redefines app.authorize_privacy_response_download(uuid), copied from its only definition in
-- 20261025280000_sec_privacy_responses.sql; the two checks come after the ownership and expiry
-- checks, so someone else still gets "access denied". Nothing else changes; grants are kept.

create or replace function app.authorize_privacy_response_download(p_delivery_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delivery public.privacy_request_deliveries%rowtype;
  v_job public.privacy_request_responses%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  select delivery.* into v_delivery
  from public.privacy_request_deliveries delivery
  join public.persons person on person.id = delivery.person_id and person.organization_id = delivery.organization_id
  where delivery.id = p_delivery_id
    and person.user_id = (select auth.uid())
    and app.privacy_person_has_portal(delivery.organization_id, delivery.person_id)
  for update of delivery;
  if v_delivery.id is null then
    raise exception 'privacy response access denied' using errcode = '42501';
  end if;
  if v_delivery.expires_at < v_now then
    raise exception 'this download has expired: ask the firm for a new copy' using errcode = '22023';
  end if;
  -- SEC-01: a full privacy response is a high-risk client download. The person has two-step
  -- sign-in turned on and checked it in the last 15 minutes (app.client_step_up_satisfied).
  if not app.user_has_verified_totp((select auth.uid())) then
    raise exception 'two-step sign-in is required for this download' using errcode = '42501';
  end if;
  if not app.client_step_up_satisfied() then
    raise exception 'client step-up required: enter your two-step code' using errcode = '42501';
  end if;
  select * into v_job from public.privacy_request_responses where id = v_delivery.response_id;
  if v_job.storage_key is null then
    raise exception 'privacy response access denied' using errcode = '42501';
  end if;
  insert into public.privacy_response_downloads (organization_id, delivery_id, user_id, downloaded_at, sha256)
  values (v_delivery.organization_id, v_delivery.id, (select auth.uid()), v_now, v_job.sha256);
  update public.privacy_request_deliveries
  set download_count = download_count + 1,
      first_downloaded_at = coalesce(first_downloaded_at, v_now),
      last_downloaded_at = v_now
  where id = v_delivery.id;
  perform app.record_audit_event(
    v_delivery.organization_id, 'privacy.response_downloaded', 'public.privacy_request_deliveries', v_delivery.id, 'success',
    jsonb_build_object('request_id', v_delivery.request_id, 'sha256', v_job.sha256)
  );
  return jsonb_build_object('bucket', v_job.storage_bucket, 'storage_key', v_job.storage_key, 'seconds', 60, 'sha256', v_job.sha256);
end;
$$;

revoke all on function app.authorize_privacy_response_download(uuid) from public, anon;
grant execute on function app.authorize_privacy_response_download(uuid) to authenticated;
