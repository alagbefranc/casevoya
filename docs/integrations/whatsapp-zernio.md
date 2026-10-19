# WhatsApp through Zernio

Decided by Francis 2026-10-19: **WhatsApp via Zernio; per-firm profile and own number; consent
required; no sensitive content in WhatsApp.** Status: built and tested with Zernio mocked
(branch `whatsapp-zernio`, migrations `20261019230000`–`20261019230200`); not applied live, not
configured, nothing sent.

## How it works

- **Firm number.** Each firm gets one Zernio profile (`POST /v1/profiles`, `externalId` = the
  firm's organization id), made the first time the owner clicks Connect in Settings >
  Integrations > WhatsApp. Connect opens Meta's Embedded Signup
  (`GET /v1/connect/whatsapp?profileId&redirect_url&onboarding=api`, Cloud API only, no
  coexistence) and comes back to `/sheet/settings?tab=integrations&wa=1&connected=whatsapp&accountId=…`.
  The server checks with `GET /v1/accounts?profileId&platform=whatsapp` that the account is on the
  firm's own profile before storing it. Firm owner only, with a recent step-up. The row shows the
  number and Meta's live status (`GET /v1/whatsapp/number-info`); Disconnect (owner, step-up)
  stops sending at once and removes the account from Zernio (`DELETE /v1/accounts/{id}`).
- **Consent.** A client turns on "WhatsApp notices" on the portal Account page (for the mobile
  number on their record). Consent is stored with the time, the source (portal / staff) and who
  recorded it; withdrawing keeps the history. No consent, no WhatsApp.
- **Notices.** When a client notice email is queued (document requested, invoice issued,
  payment problem, agreement to sign, new staff message, reminders, bookings), a WhatsApp
  notice is queued too for opted-in people. It is an approved UTILITY template carrying only the
  firm's name and the portal link:
  - `casevoya_portal_notice` (en): "Hello. {{1}} has a new item for you in your secure portal. Sign in to see it: https://app.casevoya.ca/portal"
  - `casevoya_portal_reminder` (en): "Hello. {{1}} has a reminder for you in your secure portal. Sign in to see it: https://app.casevoya.ca/portal"
- **Inbound.** A client's WhatsApp message to the firm's number is filed into their conversation
  on the matter (marked "WhatsApp") when it matches exactly one opted-in person on an open
  matter; otherwise it waits in `whatsapp_inbound_messages` for triage.
- **Replies.** A staff reply in the matter chat goes back on WhatsApp as text only within 24
  hours of the client's last WhatsApp message; outside that window the usual email notice (and
  the WhatsApp portal notice) goes instead. The chat says which.
- **Delivery.** `POST /api/whatsapp/dispatch` (kicked every minute by pg_cron, the mail
  dispatcher's Vault URL and bearer) sends with idempotency key `casevoya-wa-<delivery id>`,
  retries with the outbox backoff and dead-letters after 8 tries. `message.delivered` /
  `message.read` / `message.failed` webhooks update `whatsapp_deliveries`.

## Environment (Cloudflare Worker secrets; names only)

| Name | Role |
|---|---|
| `ZERNIO_API_KEY` | Zernio API key (`Authorization: Bearer`). Without it the WhatsApp row says "Not available" and `/api/whatsapp/dispatch` answers 503. |
| `ZERNIO_WEBHOOK_SECRET` | The secret given to Zernio when the webhook is registered; `/api/zernio/webhook` verifies `X-Zernio-Signature` with it. 32+ random characters. |
| `EMAIL_DISPATCH_SECRET`, `SUPABASE_SECRET_KEY`, `APP_URL` | Already set for mail; reused (dispatch bearer, service role, the Embedded Signup return origin). |

## Go-live steps for Francis

1. Apply the three migrations (`20261019230000`, `20261019230100`, `20261019230200`) with
   `node scripts/ops/apply-migration.mjs …` in that order, then deploy the app.
2. Add the Worker secrets: `pnpm exec wrangler secret put ZERNIO_API_KEY` and
   `pnpm exec wrangler secret put ZERNIO_WEBHOOK_SECRET` (generate it, e.g. `openssl rand -hex 32`).
3. Register the webhook in Zernio, with the same secret in the shell:
   `ZERNIO_API_KEY=… ZERNIO_WEBHOOK_SECRET=… node scripts/ops/zernio-whatsapp.mjs register-webhook https://app.casevoya.ca --yes`
   (events `message.received`, `message.delivered`, `message.read`, `message.failed`; URL
   `https://app.casevoya.ca/api/zernio/webhook`). Or add it in the Zernio dashboard with the same
   URL, events and secret.
4. Each firm (Francis's first): **Meta Business verification** of the firm's Meta Business
   account (business.facebook.com > Security Center), and a payment method on its WhatsApp
   Business Account (Meta bills template messages to the WABA directly).
5. **Connect the number:** the firm owner opens Settings > Integrations > WhatsApp > Connect
   (confirm with the authenticator when asked) and completes Meta's Embedded Signup with the
   firm's own number. Zernio needs a payment method on Casevoya's Zernio account (a 402 otherwise).
6. **Template approval:** with the connected account id (Zernio dashboard, or
   `GET /v1/accounts?platform=whatsapp`), print then create the two templates:
   `node scripts/ops/zernio-whatsapp.mjs templates <account-id>` (dry run), then add `--yes`.
   Meta reviews them (up to 24 hours); check with `template-status <account-id>`. Until both are
   APPROVED, notices to that firm's clients fail at Zernio and are recorded as failed; nothing
   else breaks.
7. Clients opt in on the portal Account page ("WhatsApp notices").

## Production test on Zernio's free sandbox (only to Francis's phone, +1 431 275 3986)

The sandbox is one Zernio-owned number shared for testing: one test phone at a time, only its
locked `sandbox_start` template, free-form text inside the 24-hour window, 50 messages a day.

1. After steps 1–3 above: `node scripts/ops/zernio-whatsapp.mjs sandbox` (read-only
   `GET /v1/phone-numbers`): note `sandbox.phoneNumber` and `sandbox.accountId`.
2. In the Sheet of Francis's own test firm, make sure the matter's client person is Francis
   (mobile `+14312753986`, a portal login) on an **open, non-sample** matter.
3. Link the sandbox to that firm (testing only):
   `SUPABASE_ACCESS_TOKEN=… node scripts/ops/zernio-whatsapp.mjs link-sandbox <org-id> --yes`.
   Settings > Integrations > WhatsApp now shows the sandbox number with the tag "sandbox".
4. Start the sandbox session for Francis's phone only:
   `node scripts/ops/zernio-whatsapp.mjs sandbox-start +14312753986 --yes`. Zernio sends its
   `sandbox_start` template to that phone.
5. On the phone, **reply** to that WhatsApp message (any text). Check
   `node scripts/ops/zernio-whatsapp.mjs sandbox-sessions` shows `active`. Because the webhook is
   registered, the reply also arrives at `/api/zernio/webhook`; until step 6 it goes to triage
   (no opted-in person matches yet).
6. As Francis in the portal (Account > "WhatsApp notices" on, Save choices): consent is recorded
   for +14312753986.
7. **Inbound:** send another WhatsApp from the phone to the sandbox number. It appears in the
   matter's Messages tab (staff) and in the portal's Messages, marked "WhatsApp".
8. **Reply inside the window:** in the matter chat, staff reply in that conversation. The line
   under "Visible to" says the reply also goes on WhatsApp; within a minute the text arrives on
   the phone (`whatsapp_deliveries` row: kind `text`, status sent → delivered → read).
9. **Notice:** request a document from Francis on that matter (or send a staff message after the
   window closes). On the sandbox the notice goes as Zernio's `sandbox_start` template (the
   sandbox cannot send Casevoya's templates); its delivery status is recorded the same way.
10. Clean up: Settings > Integrations > WhatsApp > Disconnect (the sandbox account is unlinked,
    never deleted from Zernio), and revoke the sandbox session in the Zernio dashboard if wanted.

## Not confirmed from the docs

- The read-only GETs against the real API could not be run from the build session (the key in
  that environment was refused with 401 `invalid_credentials`), so response shapes come from the
  OpenAPI and the guide only.
- `POST /v1/inbox/conversations` (template send) does not list `Idempotency-Key` in the OpenAPI;
  the header is sent anyway. `POST /v1/inbox/conversations/{id}/messages` does support it.
- The redirect parameters after Embedded Signup (`connected`, `profileId`, `accountId`,
  `username`, or `error`) are from the `redirect_url` description of `GET /v1/connect/{platform}`.
  The WhatsApp "Connection & Setup" page itself was not in the provided docs.
- `GET /v1/accounts` returns `profileId` as an object in the example (`{ _id, name, slug }`);
  a string is also accepted.
- Whether a template body may carry the portal URL as plain text (rather than a URL button) is
  Meta's review decision; if Meta asks for a button, change the template components only.
- Inbound webhooks on the shared sandbox omit `account.profileId`; routing uses
  `account.accountId`, which the docs say is always present.

## Sources (read 2026-10-19)

- Zernio docs export (`llms-full`): "WhatsApp" (Quick reference, Before you start, Connect),
  "Phone Numbers" (number-info, liveness), "Pricing & Costs", "Sandbox", "Templates",
  "Webhooks" (signatures, retries, dedupe, routing), "Inbox webhooks" (message.received,
  delivered, read, failed), "WhatsApp webhooks".
- Zernio OpenAPI: `/v1/profiles`, `/v1/connect/{platform}`, `/v1/accounts`,
  `/v1/accounts/{accountId}`, `/v1/whatsapp/number-info`, `/v1/inbox/conversations`,
  `/v1/inbox/conversations/{conversationId}/messages`, `/v1/whatsapp/templates`,
  `/v1/webhooks/settings`, `/v1/phone-numbers`; schemas `InboxWebhookAccount`,
  `InboxWebhookConversation`, `WebhookProfiles`.
