-- Scan retries always hit a cold scanner (bug report 2026-10-29, follow-up to #274).
--
-- The scan runner now lets the scanner Worker wake a sleeping instance and wait for clamd before
-- the scan (services/av-scanner/src/warm.ts; up to 90 s warm-up + 50 s scan per request,
-- RUNNER_SCAN_BUDGET in src/modules/documents/virus-scan.ts). pg_net closed the runner's request
-- after 55 s, and a Worker whose client disconnects may be cancelled
-- (https://developers.cloudflare.com/workers/platform/limits/, read 2026-10-29: "When the client
-- disconnects or the response is complete, tasks associated with that request may be canceled";
-- there is no duration limit while the client stays connected). So the kick now waits 240 s.
-- That stays under the claim lease (documents.virus_scan_retry lease_seconds, 300 s): a run
-- that is cut off never outlives the leases it took. Nothing reads the response: pg_net stores it
-- in net._http_response and the runner records each answer itself.
--
-- Redefines app.kick_document_scans, copied from its only definition in
-- 20261028130100_upload_virus_scan.sql. Only timeout_milliseconds changes (55000 -> 240000).

create or replace function app.kick_document_scans()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  url text;
  secret text;
begin
  if not exists (
    select 1 from public.document_versions v
    where v.upload_state in ('scanning', 'scan_failed')
      and coalesce(v.scan_next_attempt_at, '-infinity'::timestamptz) <= now()
  ) then
    return;
  end if;
  select decrypted_secret into url from vault.decrypted_secrets where name = 'email_dispatch_url';
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'email_dispatch_secret';
  if url is null or secret is null or url !~ '^https://[^/]+/api/email/dispatch$' then
    return;
  end if;
  perform net.http_post(
    url := regexp_replace(url, '/api/email/dispatch$', '/api/documents/scan/run'),
    headers := jsonb_build_object('Authorization', 'Bearer ' || secret, 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 240000
  );
end;
$$;
revoke all on function app.kick_document_scans() from public, anon, authenticated;
