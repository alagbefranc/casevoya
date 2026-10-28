# Virus scanning for uploads (#263-B)

ClamAV runs in a Cloudflare Container in Casevoya's own Cloudflare account. No third-party
scanning service is used. Status: **built and tested with the scanner mocked; not deployed.**
Until it is deployed and switched on, uploads are type-checked only, exactly as before.

## Sources consulted (retrieved 2026-10-28)

- Cloudflare Containers: https://developers.cloudflare.com/containers/api/container-class/
  (`Container`, `defaultPort`, `sleepAfter`, `enableInternet`, `getRandom`),
  https://developers.cloudflare.com/containers/configuration/wrangler/ (`containers`,
  `durable_objects.bindings`, `exports`), https://developers.cloudflare.com/containers/platform/limits/
  (instance types: `standard-1` is 1/2 vCPU, 4 GiB, 8 GB disk).
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

The container gets only the file's bytes: no names, no ids, no credentials. It writes nothing to
disk (clamd reads the stream from its local socket).

## Fail closed

- Nobody can open a file that isn't `clean`: `authorize_document_download` (downloads, the secure
  preview, Vo's reads), the storage read policy and the exports all require `upload_state = 'clean'`.
  The version row stays readable so people see "Checking for viruses…".
- Scanner down, slow (20 s inline, 50 s in the runner), or an answer we don't understand: an error.
  The file stays held. Retries wait 1, 2, 4, 8 and 16 minutes (`documents.virus_scan_retry`); after
  the 6th failed attempt it is `scan_failed` ("Couldn't be checked yet"), staff who can open the matter
  get a notice, and it is tried again every 6 hours. A later clean scan releases it. Nothing marks a
  file clean without a scan.
- Staff uploads are held the same way as client uploads (decision below).
- A file too large or too deep to scan fully (`Heuristics.Limits.Exceeded`) is an error, not clean.
- Email attachments: an unsorted inbox file is "ready to file" after its type check; it is never
  opened as it is. Filing copies it into a document version, which is scanned like any upload.

## Switch

| Setting | Meaning |
| --- | --- |
| `AV_SCANNER` service binding on `casevoya-app` | Commented out in `wrangler.jsonc` until the scanner is deployed. |
| `documents.accept_structural_inspection` (product setting) | `true` (default): type check only, as before. `false`: every new upload waits for the scanner. |

Turn the setting off only after the binding is live. If the setting is off and the binding is
missing, uploads are held and become `scan_failed` after about 30 minutes, with a staff notice:
that is the fail-closed behaviour, not an outage of uploads themselves (files are stored).

## Deploy (swe; nothing here was deployed)

1. Build and deploy the scanner Worker and its image (Docker on the deploying machine):
   ```
   cd services/av-scanner
   pnpm install          # its own devDependencies (@cloudflare/containers, esbuild, wrangler)
   pnpm bundle           # dist/server.mjs
   pnpm exec wrangler deploy
   ```
   The image downloads the ClamAV signatures at build time (about 250 MB). First deploys of a
   container can take a few minutes to become ready.
2. Check it from a machine with Wrangler access: `pnpm exec wrangler tail casevoya-av-scanner` while
   the app runs the next step, or temporarily `wrangler dev` locally and `curl localhost:8787/healthz`
   (expects `{"ok":true,"engine":"ClamAV …"}`).
3. In the root `wrangler.jsonc` uncomment `{ "binding": "AV_SCANNER", "service": "casevoya-av-scanner" }`
   and deploy the app: `git checkout main && git pull && pnpm run deploy:app`.
4. Apply the migrations (Francis): `20261028130000_upload_virus_scan_enum.sql`, then
   `20261028130100_upload_virus_scan.sql`. The second schedules `casevoya-document-scans` in pg_cron;
   it reuses the vault secrets `email_dispatch_url` and `email_dispatch_secret` already used by the
   scheduled reports runner.
5. Switch on: `update public.product_settings set value = '{"enabled":false}' where key = 'documents.accept_structural_inspection';`
   (SQL editor, as the project owner).
6. Prove it with the EICAR test file (UI steps in the PR).
7. Optional, off-hours: rescan the files stored before scanning,
   `APP_URL=https://app.casevoya.ca EMAIL_DISPATCH_SECRET=… node scripts/rescan-legacy-documents.mjs`.

Rollback: set `documents.accept_structural_inspection` back to `true`. New uploads are then
type-checked only again; files already held stay held until a scan answers (the runner keeps going
while the binding is there).

## Signatures

Baked into the image at build time, then `freshclam` runs as a daemon inside each instance: it
checks the official mirror (`database.clamav.net`) at start and 12 times a day, and tells clamd to
reload. Instances sleep after 15 idle minutes, so every wake starts with an update check.
Rebuilding the image now and then keeps the baked copy fresh for a cold start without network.

## Health check

- `GET /healthz` on the scanner Worker: clamd answers `PING`; `{"ok":true,"engine":"ClamAV 1.x/NNNNN"}`
  or 503. The image also has a Docker `HEALTHCHECK` on the same path.
- Each scan's engine and signature database version is stored on the version
  (`document_versions.scan_engine_version`) and in the audit context.
