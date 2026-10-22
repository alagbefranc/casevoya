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
| `APP_URL` | Optional. Origin put in email links (invitations, portal and Sheet buttons) and the origin emails load their images (`/assets/email/*`) and Erode fonts from. Default `https://app.casevoya.ca`. Not a secret. |
| `EMAIL_INBOUND_WEBHOOK_SECRET` | HMAC shared with the inbound Worker (`INBOUND_WEBHOOK_SECRET`). |
| `CLOUDFLARE_ROUTING_API_TOKEN` | Email Routing Rules Write on zone `303990065795d627a9fd337b01258024`. Creates and deletes per-firm rules. |
| `EMAIL_ROUTING_RECONCILE_SECRET` | Bearer for `POST /api/email/routing/reconcile`. |
| `STRIPE_TEST_SECRET_KEY` | Stripe **test-mode** secret key (`sk_test_…`, or a restricted `rk_test_…` with Connect accounts (v2), Account Sessions and PaymentIntents write). Creates the firm's connected account, Account Sessions and PaymentIntents. A live key is refused: payments then show as not configured. |
| `STRIPE_WEBHOOK_SECRET` | Signing secret (`whsec_…`) of the test-mode Connect event destination that posts to `/api/stripe/webhook`. Applying events also needs `SUPABASE_SECRET_KEY`. |
| `STRIPE_BILLING_WEBHOOK_SECRET` | Signing secret (`whsec_…`) of the test-mode **platform-account** event destination that posts to `/api/stripe/billing` (Casevoya's own subscriptions: Checkout, subscription and invoice events). Separate from the Connect destination. Applying events needs `SUPABASE_SECRET_KEY`; caching resolved Price ids does too. |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe **test-mode** publishable key (`pk_test_…`). Public; Next.js inlines it at build time, so set it in the build environment (or `.env.production`). Without it the Payments pages say card payments aren't configured. |
| `ZERNIO_API_KEY` | Zernio API key for WhatsApp (docs/integrations/whatsapp-zernio.md). Without it WhatsApp shows "Not available" and `POST /api/whatsapp/dispatch` answers 503. The dispatcher reuses `EMAIL_DISPATCH_SECRET` as its bearer. |
| `ZERNIO_WEBHOOK_SECRET` | Secret registered with Zernio for `POST /api/zernio/webhook` (hex HMAC-SHA256 of the raw body in `X-Zernio-Signature`). |
| `LIVEKIT_URL` | LiveKit WebSocket URL (`wss://<project>.livekit.cloud`, or a self-hosted server). Not a secret, but kept with the two below. Without all three, the call page says video calls aren't set up and nothing is sent to LiveKit. |
| `LIVEKIT_API_KEY` | LiveKit API key (the issuer of every token Casevoya signs). |
| `LIVEKIT_API_SECRET` | LiveKit API secret. Signs join tokens and room calls, and verifies LiveKit webhooks. Never sent to the browser. |
| `STRIPE_CONNECT_DASHBOARD` | Optional. `none` (default: the firm uses Connect embedded components in Casevoya only) or `full` (the firm also gets the Stripe Dashboard), for new connected accounts. Not a secret. |

### Stripe (test mode only)

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
