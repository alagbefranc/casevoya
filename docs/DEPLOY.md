# Deploy

Do not commit secrets. Copy the names below into the host environment. Account id and zone id are not secrets.

## App env

| Name | Role |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL. Public. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Browser key. Public. |
| `SUPABASE_SECRET_KEY` | Service role for mail dispatch, inbound intake, routing reconcile, and document upload completion (the server reads the stored file and calls `finish_verified_document_upload`). Without it, portal uploads cannot be completed. |
| `CLOUDFLARE_EMAIL_API_TOKEN` | Email Sending API. Not used for routing rules. |
| `CLOUDFLARE_ACCOUNT_ID` | Account that owns the zone. Default `c8010438fc56280e3ea5747a123e818a`. Sending uses it in the URL. Routing rules are zone-scoped, so reconcile does not send this id. |
| `CLOUDFLARE_EMAIL_FROM` | Outbound From address. Default `notices@casevoya.ca`. |
| `INBOUND_EMAIL_DOMAIN` | Firm addresses are `<slug>@` this domain. Default `docs.casevoya.ca`. |
| `EMAIL_DISPATCH_SECRET` | Bearer for `POST /api/email/dispatch`. Also the HKDF input for the AES-256-GCM key that seals invitation links into the outbox (`src/modules/email/invite-link-seal.ts`); rotating it makes unsent sealed links fall back to the linkless email. |
| `APP_URL` | Optional. Origin put in invitation email links. Default `https://app.casevoya.ca`. Not a secret. |
| `EMAIL_INBOUND_WEBHOOK_SECRET` | HMAC shared with the inbound Worker (`INBOUND_WEBHOOK_SECRET`). |
| `CLOUDFLARE_ROUTING_API_TOKEN` | Email Routing Rules Write on zone `303990065795d627a9fd337b01258024`. Creates and deletes per-firm rules. |
| `EMAIL_ROUTING_RECONCILE_SECRET` | Bearer for `POST /api/email/routing/reconcile`. |

## App Worker

`casevoya-app` is built with OpenNext and deployed with Wrangler from the repo root:

```
pnpm run deploy:app
```

- `wrangler.jsonc` mirrors the live Worker: compatibility date and flags, `ASSETS`, the `WORKER_SELF_REFERENCE` service binding, the custom domain `app.casevoya.ca`, `workers_dev = false`.
- `CASEVOYA_TARGET=workers` (set by `build:workers`) turns `cacheComponents` and `partialPrefetching` off until opennextjs-cloudflare#1318 is fixed. Local and CI builds keep them on.
- `.env.production` holds only the two public Supabase values, which Next.js inlines at build time.
- Secrets stay on the Worker (`wrangler secret put <NAME>`). Wrangler keeps existing secrets on deploy, and `keep_vars` keeps dashboard variables.
- Deploying needs `CLOUDFLARE_API_TOKEN` with Workers Scripts edit on the account.

`pnpm run deploy:inbound` deploys the inbound mail Worker below.

## Inbound Worker

`workers/inbound-email/wrangler.toml` sets `workers_dev = false`, so deploy does not publish a `workers.dev` hostname.

From the repo root, after the app origin is known:

```
pnpm exec wrangler deploy --config workers/inbound-email/wrangler.toml
pnpm exec wrangler secret put INBOUND_WEBHOOK_SECRET --config workers/inbound-email/wrangler.toml
```

Set the Worker var `INBOUND_WEBHOOK_URL` to the deployed app origin plus `/api/email/inbound` before the first real message. Do not commit the secret.

## Per-firm routing rules

Zone `303990065795d627a9fd337b01258024` (`casevoya.ca`).

When a firm claims a slug, the app creates one exact rule:

- Match: `<slug>@docs.casevoya.ca` (literal `to`)
- Action: Send to Worker `casevoya-inbound-email`
- Name: `casevoya-firm:<slug>`

A slug change creates the new rule first, then deletes the previous one. Releasing a slug deletes the owned rule. If Cloudflare errors, the claim still succeeds. The error is logged. Reconcile retries.

Subaddressing is already on. `<slug>+<32 hex>@docs.casevoya.ca` uses the base rule. Do not add a rule per matter token.

`POST /api/email/routing/reconcile` with `Authorization: Bearer $EMAIL_ROUTING_RECONCILE_SECRET` lists the zone's rules, adds a missing rule for each organization slug, and deletes stale rules. It only edits rules whose names start with `casevoya-firm:`. The `casevoya-test@docs.casevoya.ca` rule and the catch-all are left alone.

A body with `failures` is HTTP 502 so the caller can run it again. A clean run is HTTP 200.
