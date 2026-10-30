# Deploy

Do not commit secrets. Copy the names below into the host environment. Account id and zone id are not secrets.

## App env

| Name | Role |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL. Public. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Browser key. Public. |
| `SUPABASE_SECRET_KEY` | Service role for mail dispatch, inbound intake, routing reconcile, and document upload completion (the server reads the stored file and calls `finish_verified_document_upload`). Without it, portal uploads cannot be completed. Also required by the public booking hold (`POST /api/book/<firm>/<event>/hold`) and the public enquiry form (`POST /api/enquiry/<firm>`): `booking_public_hold` and `submit_enquiry` are service role only so the client-address hash comes from the server; without the key both answer 502. |
| `BOOKING_CLIENT_SALT` | Optional but recommended. Salt for the SHA-256 client-address hash behind the per-address limits of the booking hold and the enquiry form (8 holds / 5 enquiries per address per 10 minutes). The address comes from `cf-connecting-ip` (else `x-real-ip`, `x-forwarded-for`); requests without one share a single bucket with the same limit. Secret. |
| `CLOUDFLARE_EMAIL_API_TOKEN` | Email Sending API. Not used for routing rules. |
| `CLOUDFLARE_ACCOUNT_ID` | Account that owns the zone. Default `c8010438fc56280e3ea5747a123e818a`. Sending uses it in the URL. Routing rules are zone-scoped, so reconcile does not send this id. |
| `CLOUDFLARE_EMAIL_FROM` | Outbound From address. Default `notices@casevoya.ca`. |
| `INBOUND_EMAIL_DOMAIN` | Firm addresses are `<slug>@` this domain. Default `docs.casevoya.ca`. |
| `EMAIL_DISPATCH_SECRET` | Root secret for two purposes, kept apart by HKDF-SHA-256 with distinct labels: (1) the AES-256-GCM key that seals invitation links and signing codes into the outbox (`src/modules/email/invite-link-seal.ts`, salt `casevoya.invitation-email-link`, info `aes-256-gcm v1`; rotating the secret makes unsent sealed links fall back to the linkless email); (2) the scheduler bearer for `POST /api/email/dispatch`, `/api/whatsapp/dispatch`, `/api/retention/run`, `/api/reports/scheduled/run`, `/api/documents/scan/run` and `/api/sources/recheck/run` (`src/modules/email/cron-auth.ts`). While `CRON_SECRET` is unset those routes accept the derived cron key (salt `casevoya.cron-auth`, info `casevoya/cron-auth/v1`) or, for the existing callers (pg_cron kicks through the Vault secret `email_dispatch_secret`, `scripts/rescan-legacy-documents.mjs`), the raw secret. No accepted bearer is ever a sealing key; the remaining overlap is that the raw secret (which is in Vault) is also the sealing root. See `CRON_SECRET` to remove it. |
| `CRON_SECRET` | Optional, at least 16 characters (shorter values are ignored). When set it is the **only** bearer the scheduler routes above accept (the raw and derived `EMAIL_DISPATCH_SECRET` values stop working there), so the value stored in Vault no longer opens sealed links. Switch over in one step: set the Worker secret, put the same value in the Vault secret `email_dispatch_secret` (`select vault.update_secret(id, '<value>') from vault.secrets where name = 'email_dispatch_secret';`), and use it as `CRON_SECRET` when running `scripts/rescan-legacy-documents.mjs`. Unset: the derived cron key or the raw `EMAIL_DISPATCH_SECRET` is accepted. A caller can move to the derived key before then: `node -e 'const c=require("crypto");process.stdout.write(Buffer.from(c.hkdfSync("sha256",process.env.EMAIL_DISPATCH_SECRET,"casevoya.cron-auth","casevoya/cron-auth/v1",32)).toString("base64url"))'`. |
| `APP_URL` | Optional. Origin put in email links (invitations, portal and Sheet buttons) and the origin emails load their images (`/assets/email/*`) and Erode fonts from. Default `https://app.casevoya.ca`. Not a secret. |
| `EMAIL_INBOUND_WEBHOOK_SECRET` | HMAC shared with the inbound Worker (`INBOUND_WEBHOOK_SECRET`). |
| `CLOUDFLARE_ROUTING_API_TOKEN` | Email Routing Rules Write on zone `303990065795d627a9fd337b01258024`. Creates and deletes per-firm rules. |
| `EMAIL_ROUTING_RECONCILE_SECRET` | Bearer for `POST /api/email/routing/reconcile`. |
| `STRIPE_SECRET_KEY` | Production Stripe secret key. A live key (`sk_live_…` / `rk_live_…`) puts the server in **live mode**; it wins over `STRIPE_TEST_SECRET_KEY`. Set but malformed: payments show as not configured (no fall back). Leave unset for local, CI and staging. |
| `STRIPE_TEST_SECRET_KEY` | Stripe **test-mode** secret key (`sk_test_…`, or a restricted `rk_test_…` with Connect accounts (v2), Account Sessions and PaymentIntents write). Used when `STRIPE_SECRET_KEY` is unset; a live key here is refused. Keep it in production after going live: links made in test mode are cleaned up with it when the firm disconnects them. |
| `STRIPE_PUBLISHABLE_KEY` | Publishable key read at request time (`pk_live_…` in production). Public. Wins over `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`; must be the same mode as the secret key, or card forms stay off. |
| `STRIPE_LIVE_WEBHOOK_SECRET` | Signing secret of the **live** Connect event destination (`/api/stripe/webhook`). The route verifies with the live and test secrets and applies only events of the server's mode; the other mode's events are answered 200 and ignored. |
| `STRIPE_LIVE_BILLING_WEBHOOK_SECRET` | Signing secret of the **live** platform destination (`/api/stripe/billing`). Same rule. |
| `STRIPE_BILLING_PORTAL_CONFIGURATION` | Optional `bpc_…`: the Billing Portal configuration to open. Without it Stripe uses the account's default (saved in Settings > Billing > Customer portal). Not a secret. |
| `STRIPE_WEBHOOK_SECRET` | Signing secret (`whsec_…`) of the test-mode Connect event destination that posts to `/api/stripe/webhook`. Applying events also needs `SUPABASE_SECRET_KEY`. |
| `STRIPE_BILLING_WEBHOOK_SECRET` | Signing secret (`whsec_…`) of the test-mode **platform-account** event destination that posts to `/api/stripe/billing` (Casevoya's own subscriptions: Checkout, subscription and invoice events). Separate from the Connect destination. Applying events needs `SUPABASE_SECRET_KEY`; caching resolved Price ids does too. |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe **test-mode** publishable key (`pk_test_…`), the fallback when `STRIPE_PUBLISHABLE_KEY` is unset. Public; Next.js inlines it at build time, so set it in the build environment (or `.env.production`). Without it the Payments pages say card payments aren't configured. |
| `ZERNIO_API_KEY` | Zernio API key for WhatsApp (docs/integrations/whatsapp-zernio.md). Without it WhatsApp shows "Not available" and `POST /api/whatsapp/dispatch` answers 503. The dispatcher uses the same scheduler bearer as mail dispatch (`CRON_SECRET`, else `EMAIL_DISPATCH_SECRET` or its derived cron key). |
| `ZERNIO_WEBHOOK_SECRET` | Secret registered with Zernio for `POST /api/zernio/webhook` (hex HMAC-SHA256 of the raw body in `X-Zernio-Signature`). |
| `LIVEKIT_URL` | LiveKit WebSocket URL (`wss://<project>.livekit.cloud`, or a self-hosted server). Not a secret, but kept with the two below. Without all three, the call page says video calls aren't set up and nothing is sent to LiveKit. |
| `LIVEKIT_API_KEY` | LiveKit API key (the issuer of every token Casevoya signs). |
| `LIVEKIT_API_SECRET` | LiveKit API secret. Signs join tokens and room calls, and verifies LiveKit webhooks. Never sent to the browser. |
| `STRIPE_CONNECT_DASHBOARD` | Optional. `none` (default: the firm uses Connect embedded components in Casevoya only) or `full` (the firm also gets the Stripe Dashboard), for new connected accounts. Not a secret. |
| `AV_SCANNER` (service binding) | Virus scanner (#263-B, `services/av-scanner`, ClamAV in a Cloudflare Container). Bound in `wrangler.jsonc`, so `casevoya-av-scanner` must be deployed before the app. Scanning starts only when the product setting `documents.accept_structural_inspection` is false; until then uploads are type-checked only. Steps: docs/integrations/av-scanner.md. `AV_SCANNER_URL` (optional) points a local `next dev` at a scanner run by hand; never set it in production. |

### Stripe (live in production since 2026-10-29; test everywhere else)

- Mode comes from the keys: `STRIPE_SECRET_KEY` live ⇒ live; else `STRIPE_TEST_SECRET_KEY` ⇒ test. Every Stripe row keeps the mode it was made in (`livemode`); an event or action of the other mode is ignored or refused. A firm linked in test mode sees "Reconnect" after going live: the owner disconnects it (open test requests are canceled with the test key) and sets up the live account. A billing customer made in test mode is replaced at the next Checkout (`public.replace_subscription_customer`, only before a subscription exists).
- Live and test destinations post to the same two URLs; each has its own signing secret.

- Firm = Stripe connected account (Accounts v2: merchant configuration with `card_payments`; Stripe collects fees and owns losses). Client payments are **direct charges** on that account, created as PaymentIntents and confirmed in the page with the Payment Element. No Checkout, no hosted pages.
- In the Stripe test Dashboard: enable Connect for the platform, then add an event destination for **connected accounts** with URL `https://<app>/api/stripe/webhook` and events `payment_intent.processing`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled`, `refund.created`, `refund.updated`, `refund.failed`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`. Put its signing secret in `STRIPE_WEBHOOK_SECRET`. A restricted `rk_test_…` key also needs Refunds write.
- A refund is recorded as pending when the firm asks Stripe for it; it turns succeeded or failed (and the invoice refunded) only when a verified refund event is applied (`app.apply_stripe_reversal_event`, service role, same dedupe).
- Locally: `stripe listen --forward-connect-to localhost:3000/api/stripe/webhook` prints a `whsec_…` to use as `STRIPE_WEBHOOK_SECRET`.
- **Casevoya subscription billing (T042)**: the firm's own plan is a subscription on the platform account (test mode), paid through Stripe Checkout and managed in the Billing Portal. In the Stripe test Dashboard add a second event destination for **events on your account** with URL `https://app.casevoya.ca/api/stripe/billing` and events `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`; put its signing secret in `STRIPE_BILLING_WEBHOOK_SECRET`. Enable the Billing Portal (Settings > Billing > Customer portal) with plan switching between the Casevoya products, quantity changes on the seat price, payment-method updates and cancel at period end. The Products and Prices exist already in test and live mode (lookup keys `casevoya_<solo|practice|firm>_<month|year>`, `casevoya_seat_<month|year>`, currency CAD); the app resolves them by lookup key, checks each amount against `product_settings` `subscription.plans` and refuses to check out on a mismatch. Locally: `stripe listen --forward-to localhost:3000/api/stripe/billing` for the platform events. `APP_URL` is where Checkout and the portal return (`/sheet/settings?tab=billing`).
- An invoice turns paid only when a verified webhook event is applied (`app.apply_stripe_payment_event`, service role, deduped on provider + connected account + event id). The browser redirect is never proof of payment.

### Video calls (LiveKit)

- Create a LiveKit project (LiveKit Cloud, or a self-hosted `livekit-server`; BUILD-SPEC §7.0) and set `LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` as Worker secrets.
- In the project settings add the webhook URL `https://app.casevoya.ca/api/video/livekit/webhook` signed with the same API key. Events used: `room_started`, `room_finished`, `participant_joined`, `participant_left`; others are recorded as ignored. Applying events needs `SUPABASE_SECRET_KEY`.
- Apply migration `20261022100000_video_calls.sql`. Booking types with "Video call in Casevoya" then open `/call/<booking reference>` from 15 minutes before the start.

## App Worker

`casevoya-app` is built with OpenNext and deployed with Wrangler from the repo root:

```
pnpm run deploy:app
```

- `wrangler.jsonc` mirrors the live Worker: compatibility date and flags, `ASSETS`, the `WORKER_SELF_REFERENCE` service binding, the custom domain `app.casevoya.ca`, `workers_dev = false`.
- Deploy from a clean checkout. Turbopack scans the project folder, so nested git worktrees (for example `.claude/worktrees/`, about 9 GB here) pushed the build past 15 GB and the kernel killed it; from a clean checkout the Workers build peaks near 5 GB. Do not switch the build to webpack: `globals.css` relies on Turbopack's Tailwind loader for its `@import ... layer(kit)` lines, and a webpack build ships the site without the kit CSS (tried and rolled back on 2026-10-19).
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

## Platform operations

Casevoya staff in `public.platform_admins` act through RPCs and service-role scripts in `scripts/ops/`; there is no platform admin web UI. Each script takes `--by <platform-admin-user-id>` (or `--imported-by`) so the audit trail names the person who acted, and needs `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SECRET_KEY` in the environment (never pasted into commands that are logged).

### Service notices (ADM-04)

`scripts/ops/service-notice.mjs` posts a maintenance, incident or information notice. Staff of the firms it reaches see a banner on every Sheet page while it is current, and it stays in Settings › Security › Service notices. Client (portal) users never see notices.

```
# Maintenance for one firm (times with an offset; firms see their own timezone)
node scripts/ops/service-notice.mjs post --by <admin-id> --kind maintenance --severity minor \
  --title "Scheduled maintenance" --body "Casevoya will be read-only while we upgrade the database." \
  --starts 2026-10-26T22:00:00-04:00 --ends 2026-10-27T00:00:00-04:00 --firm test-firm

# An incident for every firm, then its resolution
node scripts/ops/service-notice.mjs post --by <admin-id> --kind incident --severity major \
  --title "Email delays" --body "Some emails from Casevoya are arriving late." --all-firms
node scripts/ops/service-notice.mjs resolve <notice-id> --by <admin-id> --note "Email delivery caught up at 14:20."

# Change wording or times, publish a draft (--draft on post), list open notices (--all for resolved too)
node scripts/ops/service-notice.mjs update <notice-id> --by <admin-id> --ends 2026-10-27T01:00:00-04:00
node scripts/ops/service-notice.mjs list
```

`--firm` takes a firm's slug or id and repeats; `--dry-run` checks the arguments without sending. Notice text is plain text (title 3-120 characters, body up to 1000). Every post, update and resolve is audited (`service_notice.*`) with the acting admin.

### Support catalogue (SRC-12)

`scripts/ops/support-catalogue.mjs` keeps "What Casevoya supports" (`/supported`, and Practice › Templates in the Sheet). It never marks anything supported: a program is Supported only when an approved, sourced rule pack exists for it.

```
# A program from its own official page (a homepage or landing page is refused). Stores a platform
# source and a draft snapshot (SHA-256, the page's "Date modified" as shown) and IRCC's name from
# the page heading; the name and link show publicly once the snapshot is verified in source review.
node scripts/ops/support-catalogue.mjs capture --by <admin-id> --key <program_key> --label "Working label" \
  --jurisdiction CA --case-type ircc_application --url <official page URL> [--section <anchor>] [--dry-run]

# A program without a source yet (shows "Source not captured"), or a jurisdiction or case type
node scripts/ops/support-catalogue.mjs entry --by <admin-id> --kind program --key <program_key> --label "..." --jurisdiction CA
node scripts/ops/support-catalogue.mjs list
```

If the page can't be fetched nothing is saved. Every save is audited (`support_catalogue.saved`) with the acting admin.
