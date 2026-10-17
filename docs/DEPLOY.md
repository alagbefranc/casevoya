# Deploy

Do not commit secrets. Copy the names below into the host environment. Account id and zone id are not secrets.

## App env

| Name | Role |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL. Public. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Browser key. Public. |
| `SUPABASE_SECRET_KEY` | Service role for mail dispatch, inbound intake, and routing reconcile. |
| `CLOUDFLARE_EMAIL_API_TOKEN` | Email Sending API. Not used for routing rules. |
| `CLOUDFLARE_ACCOUNT_ID` | Account that owns the zone. Default `c8010438fc56280e3ea5747a123e818a`. Sending uses it in the URL. Routing rules are zone-scoped, so reconcile does not send this id. |
| `CLOUDFLARE_EMAIL_FROM` | Outbound From address. Default `notices@casevoya.ca`. |
| `INBOUND_EMAIL_DOMAIN` | Firm addresses are `<slug>@` this domain. Default `docs.casevoya.ca`. |
| `EMAIL_DISPATCH_SECRET` | Bearer for `POST /api/email/dispatch`. |
| `EMAIL_INBOUND_WEBHOOK_SECRET` | HMAC shared with the inbound Worker (`INBOUND_WEBHOOK_SECRET`). |
| `CLOUDFLARE_ROUTING_API_TOKEN` | Email Routing Rules Write on zone `303990065795d627a9fd337b01258024`. Creates and deletes per-firm rules. |
| `EMAIL_ROUTING_RECONCILE_SECRET` | Bearer for `POST /api/email/routing/reconcile`. |
| `STRIPE_MODE` | `test` or `live`. Default `test`. Test mode reads only `STRIPE_TEST_SECRET_KEY` and refuses a live secret. |
| `STRIPE_TEST_SECRET_KEY` | Secret key used when `STRIPE_MODE=test`. Never a `sk_live` or `rk_live` key. |
| `STRIPE_LIVE_SECRET_KEY` | Secret key used when `STRIPE_MODE=live`. |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for `POST /api/stripe/webhook`. |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Browser key for the Payment Element and Connect embedded components. Public. |

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

A 409 from Cloudflare is `skipped` when the conflicting rule is not the canonical `casevoya-firm:<slug>` rule. It is `added` only when a re-list shows that owned rule. A slug change does not delete the previous rule when the new one is skipped.

## Stripe

Payments stay in Casevoya. The app uses PaymentIntents and the Payment Element. It does not create Checkout Sessions or hosted invoices.

`POST /api/stripe/webhook` reads the raw body, checks `Stripe-Signature` with `STRIPE_WEBHOOK_SECRET`, and records the event through `record_stripe_event`. A bad signature is HTTP 400 and is not stored. A duplicate event id is HTTP 200.

Firm payouts use a Stripe Connect Express account. Account onboarding and payouts mount in the app. Direct charges use the firm’s connected account and do not add an application fee.

Plan prices are the `product_settings` row `billing.plans`. They are not written into the app as constants.
