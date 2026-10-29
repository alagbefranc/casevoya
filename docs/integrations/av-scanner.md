# Virus scanning for uploads (#263-B)

ClamAV runs in a Cloudflare Container in Casevoya's own Cloudflare account. No third-party
scanning service is used. The scanner Worker and the database changes are already on main
(#271). Scanning stays off (`documents.accept_structural_inspection` = true) until the steps
below have been run and the live checks pass. Until then, uploads are type-checked only.

## Why the first deploy stayed unhealthy

Read 2026-10-29 from the Container class and the limits page:

- https://developers.cloudflare.com/containers/api/container-class/ (`pingEndpoint` default `"ping"`, `defaultPort`, `getState`: `running` means the process has started and has not passed the health check; `healthy` means it is accepting requests).
- `@cloudflare/containers` 0.3.7 (`services/av-scanner/package.json`): `startAndWaitForPorts` fetches `http://${pingEndpoint}` on `defaultPort` and gives up after 20 seconds (`TIMEOUT_TO_GET_PORTS_MS`). Any HTTP response counts. Until that response arrives the Durable Object stays `running`. The dashboard's "active, 0 healthy" is that state: the VM is up, the check never passed.
- https://developers.cloudflare.com/containers/examples/status-hooks/ : the process must listen on `0.0.0.0`. `server.listen(port)` with no host binds `::`. The platform proxy and a health check to `127.0.0.1` are IPv4.
- https://developers.cloudflare.com/containers/platform/limits/ : `standard-1` is 1/2 vCPU, 4 GiB, 8 GB disk.
- ClamAV memory: https://docs.clamav.net/manual/Installing/Docker.html (3 GiB minimum, 4 GiB preferred for clamd alone; a second copy while freshclam tests a download, or a concurrent reload, is what exhausts that). A loaded engine is about 1.7 GiB (ClamAV, Dec 2025).

The entrypoint ran `freshclam --daemon` to completion before `exec node`. freshclam checks the mirror and downloads signatures before it daemonizes. On Cloudflare the baked database is behind the mirror, so port 8080 stayed closed past the 20 second check. The app then cancelled the scan at 50 seconds (`SCAN_TIMEOUT_MS` in `src/modules/documents/virus-scan.ts`; 20 seconds on the upload itself). The same image works on local Docker because a just-built image has nothing to download, so node binds at once, and the host accepts an IPv6 socket on IPv4.

The Dockerfile health check made the same mistake from the other side: it called `/healthz`, which is 503 until clamd answers `PING`. That is the clamd readiness probe, not "the process is up".

It was not a wrong instance size. `standard-1` holds the one engine. freshclam must not load a second copy (`TestDatabases no`, `ConcurrentDatabaseReload no`). If a later deploy's logs show clamd killed, change `instance_type` to `standard-2` (6 GiB, 1 vCPU) and redeploy the scanner before turning scanning on.

## Sources consulted

- Cloudflare Containers, as above, plus https://developers.cloudflare.com/containers/configuration/wrangler/ (`containers`, `durable_objects.bindings`, `exports`).
- ClamAV: clamd commands (`zPING`, `zVERSION`, `zINSTREAM`) and `clamd.conf` / `freshclam.conf`,
  https://docs.clamav.net/manual/Usage/Scanning.html and https://docs.clamav.net/manual/Usage/SignatureManagement.html.
- EICAR test file: https://www.eicar.org/download-anti-malware-testfile/.

The service copies the shape of `services/vo-agent` (a separate Worker with a Container class,
reached only by the app's service binding).

## Shape

```
browser ── completeDocumentUpload (app Worker): reads the stored file (service role), type check,
           finish_verified_document_upload → 'scanning' (when scanning is on)
           then at once: service_claim_document_scans(version) → download → AV_SCANNER
          ── casevoya-av-scanner Worker → AvScannerContainer (Node 22 + clamd + freshclam)
             POST /v1/scan (the bytes) → clamd INSTREAM → clean | infected + signature | error
          ←  service_record_document_scan(version, outcome, signature, engine)
             clean → 'clean' (document.uploaded: receipt, staff notice, Vo reading)
             infected → 'quarantined' (audit document.scan_infected, staff notice)
             error → stays 'scanning'; retried with backoff; then 'scan_failed' (staff notice)

pg_cron every minute (app.kick_document_scans, only while a scan is due)
          ── POST /api/documents/scan/run (bearer EMAIL_DISPATCH_SECRET) → the same runner
```

The container gets only the file's bytes: no names, no ids, no credentials. It writes nothing of
the file to disk (clamd reads the stream from its local socket).

## Fail closed

- Nobody can open a file that isn't `clean`: `authorize_document_download` (downloads, the secure
  preview, Vo's reads), the storage read policy and the exports all require `upload_state = 'clean'`.
  The version row stays readable so people see "Checking for viruses…".
- Scanner down, still starting (503), slow (20 s inline; 90 s warm-up + 50 s scan in the runner),
  or an answer we don't understand: an error. The file stays held. The upload itself does not wait
  out a cold start: `/v1/scan` returns 503 `{reason:"starting"}` and the runner retries. The runner's
  requests let the scanner Worker wake the instance and wait for clamd first (next section).
  Retries wait 1, 2, 4, 8 and 16 minutes (`documents.virus_scan_retry`); after
  the 6th failed attempt it is `scan_failed` ("Couldn't be checked yet"), staff who can open the matter
  get a notice, and it is tried again every 6 hours. A later clean scan releases it. Nothing marks a
  file clean without a scan.
- Staff uploads are held the same way as client uploads.
- A file too large or too deep to scan fully (`Heuristics.Limits.Exceeded`) is an error, not clean.
- Email attachments: an unsorted inbox file is "ready to file" after its type check; it is never
  opened as it is. Filing copies it into a document version, which is scanned like any upload.

## Why scan_failed retries never passed (2026-10-29)

Reported on the live project: two Test Firm versions stayed `scan_failed` with
`scanner_unavailable` after 9 attempts, while the dashboard showed 2 healthy instances and new
uploads passed on their 60 second retry.

- An instance sleeps after 15 idle minutes (`sleepAfter` in `runtime/worker.ts`).
- `/v1/scan` answers 503 `{reason:"starting"}` at once while clamd loads (#274), and the app
  records that as an error.
- A `scan_failed` version is retried every `failed_retry_seconds` (6 hours,
  `service_record_document_scan`). Every such retry found a sleeping instance, woke it, got
  "starting", and was pushed another 6 hours. A new upload escapes only because its 60 second
  retry finds the instance it just woke still awake.

The fix (no change to fail closed: nothing becomes clean without a real scan):

1. The scanner Worker (`src/warm.ts`) takes one instance for a `POST /v1/scan`, wakes it with
   `GET /healthz` (the Container class starts a sleeping container on any request) and polls every
   1.5 s until it is 200, then forwards the scan once to that same instance. The upload body is
   passed through untouched (never buffered or replayed; files go up to 100 MB). Budget: 90 s, the
   port check (20 s, `TIMEOUT_TO_GET_PORTS_MS`) plus clamd loading on half a vCPU (about a minute
   in the live checks). Not warm by then: the same 503 starting as before. The caller sets the
   budget with the `x-av-warmup-ms` header, clamped to 90 s; without it the full budget applies.
2. The app (`src/modules/documents/virus-scan.ts`): the retry runner (`/api/documents/scan/run`,
   from pg_cron) sends 90 s and waits up to 140 s per scan (`RUNNER_SCAN_BUDGET`). The upload
   itself sends 0 and keeps its 20 s wait (`INLINE_SCAN_BUDGET`), so a cold scanner never slows
   the person's upload; the file stays held and the runner picks it up a minute later.
3. Migration `20261029200100_document_scan_kick_timeout.sql`: `app.kick_document_scans` waits
   240 s instead of 55 s. Nothing reads pg_net's response (it lands in `net._http_response`; the
   runner records each answer itself), but the connection matters: Cloudflare may cancel a Worker
   when its client disconnects, and there is no duration limit while it stays connected
   (https://developers.cloudflare.com/workers/platform/limits/, read 2026-10-29). 240 s is below
   the 300 s claim lease, so a run that is cut off never outlives the leases it took. A service
   binding call has no separate time limit; a Durable Object call has none while the caller stays
   connected (same page). Each poll is a subrequest: at most about 60 per scan, far under the
   10,000 per request on the paid plan.

Deploy order: the migration, then the scanner Worker (`pnpm exec wrangler deploy` in
`services/av-scanner` after `pnpm install && pnpm bundle`; in the image only a comment changed),
then the app. Any order is safe: an old app sends no
header and gets the full warm-up (its 50 s timeout then cuts it, as today); an old scanner ignores
the header.

Live check: leave the scanner idle for 20 minutes or more (the instances sleep), with a file held in
`scan_failed`. Its next retry (or a due time brought forward, see "A held file now") wakes the
instance, waits, scans, and releases it: `clean` (or `quarantined`) within about two minutes.

### A held file now

The run endpoint does not take a version id: it claims what is due. A `scan_failed` version is due
at its `scan_next_attempt_at`. To retry one at once after the deploy, as the project owner in the
Supabase SQL editor (this only makes it due; only a scan can make it clean):

```
begin;
select app.open_document_write(id) from public.document_versions where id = '<version id>' and upload_state = 'scan_failed';
update public.document_versions set scan_next_attempt_at = now() where id = '<version id>' and upload_state = 'scan_failed';
select app.close_document_write(id) from public.document_versions where id = '<version id>';
commit;
```

pg_cron kicks the runner within a minute.

## Switch

| Setting | Meaning |
| --- | --- |
| `AV_SCANNER` service binding on `casevoya-app` | Set in the root `wrangler.jsonc`. The scanner Worker must be deployed before the app, or the binding has nothing to call. |
| `documents.accept_structural_inspection` (product setting) | `true` (current): type check only. `false`: every new upload waits for the scanner. |

Turn the setting off only after the live checks below pass. If the setting is off and the binding
is missing, uploads are held and become `scan_failed` after about 30 minutes, with a staff notice:
that is the fail-closed behaviour, not an outage of uploads themselves (files are stored).

## Deploy and switch on

No new migration. `20261028130000_upload_virus_scan_enum.sql` and
`20261028130100_upload_virus_scan.sql` shipped with #271. Do not re-apply them.
Nothing here is deployed by the change that fixed the startup check.

Container application id: `a03455cd`. Worker name: `casevoya-av-scanner`. Instance type stays
`standard-1`.

1. Build and deploy the scanner Worker and its image, from a machine with Docker and Wrangler
   logged into the Casevoya account. Do this before the app:
   ```
   cd services/av-scanner
   pnpm install
   pnpm bundle
   pnpm exec wrangler deploy
   ```
   The image downloads the ClamAV signatures at build time. The first start of an instance after
   this deploy is what the checks below look at. Old instances keep the old image until they stop;
   the dashboard may show them until they are replaced. Do not turn scanning on against the old image.
2. Run the live checks in the next section. Stop if `/healthz` does not reach `ok: true`, or if
   the EICAR string is not `infected`.
3. Deploy the app only if it is not already the build that contains the `AV_SCANNER` binding
   (it has been in `wrangler.jsonc` since #271): `git checkout main && git pull && pnpm run deploy:app`.
   The root `wrangler.jsonc` binds `AV_SCANNER` to `casevoya-av-scanner`, so a scanner deploy that
   failed must not be followed by an app deploy that expects it.
4. Switch on, in the Supabase SQL editor, as the project owner:
   ```
   update public.product_settings
      set value = '{"enabled":false}'
    where key = 'documents.accept_structural_inspection';
   ```
5. Prove an upload, with the EICAR Word file from `node scripts/make-eicar-test-docx.mjs`
   (it passes the type check, so it reaches the scanner) and a normal PDF. The Word file is
   blocked ("a virus was found") and the PDF becomes clean. A file uploaded while the scanner
   is still loading stays on "Checking for viruses…" and clears on its own; it must not open early.
6. Optional, off-hours: rescan files stored before scanning,
   `APP_URL=https://app.casevoya.ca EMAIL_DISPATCH_SECRET=… node scripts/rescan-legacy-documents.mjs`.

Rollback: set `documents.accept_structural_inspection` back to `{"enabled":true}`. New uploads are
then type-checked only again. Files already held stay held until a scan answers, as long as the
binding is still there. Redeploying the previous scanner image brings the startup bug back; leave
the new image in place even when scanning is off.

## Live checks

The Worker has no public route (`workers_dev` is false). From a machine logged into the account,
after step 1:

```
cd services/av-scanner
pnpm exec wrangler dev --remote --port 8787
```

In another terminal. The first `/healthz` can be 503 for a minute while clamd loads the signatures
on half a vCPU. Repeat it. Do not treat a single 503 as a failed deploy.

```
curl -sS http://127.0.0.1:8787/ping
# {"ok":true}

curl -sS http://127.0.0.1:8787/healthz
# {"ok":true,"engine":"ClamAV 1.x/NNNNN"}

printf '%s' 'not a virus, just bytes' > /tmp/casevoya-clean.bin
curl -sS --data-binary @/tmp/casevoya-clean.bin http://127.0.0.1:8787/v1/scan
# {"result":"clean","engine":"ClamAV 1.x/NNNNN"}

printf '%s' 'X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*' > /tmp/eicar.com
curl -sS --data-binary @/tmp/eicar.com http://127.0.0.1:8787/v1/scan
# {"result":"infected","signature":"Eicar-Test-Signature","engine":"ClamAV 1.x/NNNNN"}
# The Word file from scripts/make-eicar-test-docx.mjs reports the same signature on ClamAV 1.4.
```

Dashboard (Workers & Pages → Containers → `casevoya-av-scanner`, application `a03455cd`): after
those requests, at least one instance is healthy. "Active" with "0 healthy" means the port check
still is not passing; read the instance logs before turning scanning on.

`pnpm exec wrangler containers instances a03455cd` lists the same instances. `failed` or
`unhealthy` is a stop. `running` before any request is normal: nothing has started a container yet.

While `/healthz` is still 503, `POST /v1/scan` answers 503 `{"result":"error","reason":"starting"}`.
That is the cold start. The app records an error and leaves the file in `scanning`. It does not
mark the file clean.

## Signatures

Baked into the image at build time. After clamd answers `PING`, `freshclam` runs in the background:
it checks `database.clamav.net` and then 12 times a day, and tells clamd to reload.
`TestDatabases no` and `ConcurrentDatabaseReload no` keep that reload from holding two engines.
Instances sleep after 15 idle minutes, so every wake starts clamd from the baked copy and then
checks for an update. Rebuilding the image now and then keeps that copy from being far behind.

## Health check

- `GET /ping` on the scanner Worker: 200 `{"ok":true}` as soon as the server is listening. This is
  the check the Container class and the image `HEALTHCHECK` use.
- `GET /healthz`: clamd answers `PING`; 200 `{"ok":true,"engine":"ClamAV 1.x/NNNNN"}` or 503.
- Each scan's engine and signature database version is stored on the version
  (`document_versions.scan_engine_version`) and in the audit context.
