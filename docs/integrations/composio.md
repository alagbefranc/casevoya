# Connected mail and calendar (Composio), and Casevoya's own mail

Owner's choice (2026-10-18): Casevoya's own mail and calendar are the default; a staff member may
also connect their own Gmail, Outlook / Microsoft 365 or Google Calendar through Composio.
Composio is **not in the PRD**; it needs a privacy review before any firm turns it on.
Status: **server side built and tested with Composio mocked; Settings → Integrations wired (2026-10-18); not configured.**

## Sources consulted (retrieved 2026-10-18)

- Composio agent skill (branch `composio-skill`): Composio **Platform** — project key
  `COMPOSIO_API_KEY`, SDK sessions keyed to our user identity, Connect Link for OAuth, never invent
  tool slugs.
- https://docs.composio.dev/docs/how-composio-works.md (via `src/modules/integrations/composio.ts`
  on main: one session per staff membership id, `session.toolkits()`, `session.authorize()`).
- https://docs.composio.dev/docs/configuring-sessions.md — `toolkits`, `sessionPreset:
  SessionPreset.DIRECT_TOOLS`, `manageConnections`, `sandbox: { enable: false }`, `session.tools()`,
  `session.toolkits()` (`connection.connectedAccount.id`), `session.authorize(toolkit, { callbackUrl })`.
- https://docs.composio.dev/examples/harness-integration.md — `session.execute(slug, args)` returns
  `{ data, error, logId }`.
- https://docs.composio.dev/docs/providers.md — no Claude Agent SDK provider is documented there, so
  Composio is not exposed to the Vo agent through a provider adapter.
- https://docs.composio.dev/toolkits/gmail.md — `GMAIL_FETCH_EMAILS(label_ids, max_results, ...)`,
  `GMAIL_LIST_LABELS`, `GMAIL_CREATE_EMAIL_DRAFT(recipient_email, subject, body, is_html,
  thread_id)`; send tools to block: `GMAIL_SEND_EMAIL`, `GMAIL_SEND_DRAFT`, `GMAIL_REPLY_TO_THREAD`,
  `GMAIL_FORWARD_MESSAGE` (and `GMAIL_IMPORT_MESSAGE`, `GMAIL_INSERT_MESSAGE`).
- https://docs.composio.dev/toolkits/outlook.md — `OUTLOOK_CREATE_DRAFT(to_recipients, subject,
  body, is_html)`; block `OUTLOOK_SEND_EMAIL`, `OUTLOOK_SEND_DRAFT`. Listing by folder was not on
  the part of the page we could read: Outlook reading is not wired.
- https://docs.composio.dev/toolkits/googlecalendar.md — `GOOGLECALENDAR_FREE_BUSY_QUERY(items,
  timeMin, timeMax)`; event, calendar, ACL and watch tools blocked.

## What exists

| Piece | Where |
| --- | --- |
| Connections: membership, toolkit, Composio connected-account id, status, Casevoya label. Never tokens. Owner or self read; self saves; self or owner disconnects. | `staff_connections`, migration `20261019207200` |
| Firm switch with disclosure: owner + MFA; `composio_accepted_by/at` recorded | `vo_settings.composio_*`, `public.set_composio_enabled` |
| Calendar busy times: times only, into `external_busy_blocks` (the slot engine already subtracts them); never writes the external calendar | `public.replace_external_busy_blocks`, `src/modules/integrations/calendar.ts` |
| Tool policy: discovered slugs classified read / draft / freebusy / blocked; send, reply, forward, delete, move, import, event writes blocked | `src/modules/integrations/composio-policy.ts` |
| Mail providers: `casevoya` (filed `inbound_emails`, RLS) default; `composio` (label-scoped Gmail read, Gmail/Outlook drafts) | `src/modules/integrations/mail/*` |
| Server actions: owner switch, Connect Link, refresh connection, disconnect, sync busy, save a Vo draft to the mailbox as a DRAFT | `src/modules/integrations/actions.ts` |

Without `COMPOSIO_API_KEY` every action answers "Not connected — Composio not configured" and
Casevoya mail and calendar work as before.

## Not built (open)

- 2026-10-18: Settings → Integrations is live (`src/components/sheet/designer/settings-integrations.tsx`,
  `src/modules/sheet/settings-integrations-present.ts`, `settings-integrations-acts.ts`): owner switch with the disclosure
  dialog, Connect / Reconnect / Disconnect per person, Sync busy times for Google Calendar, and the
  Connect Link callback `/sheet/settings?tab=integrations&connected=<toolkit>` → `refreshConnection`.
  Still open: the disclosure in Vo and AI → Settings; the owner sees only their own connections on
  that tab (the table lets them read the team's; no team list is shown).
- The Vo agent does not read connected mailboxes (no Composio tool in services/vo-agent).
- Outlook mail reading and Outlook calendar free/busy (arguments not confirmed in the docs we read).
- Revoking the Composio connected account on disconnect (we mark it disconnected and drop busy
  times; the account stays on Composio until revoked there).
- Casevoya-native outbound replies (Inbox Compose/Reply sending from the firm's identity with
  Reply-To = the matter reply address through the outbox) — needs a new outbox event, a
  `prepare_email_delivery` redefinition, a "staff reply" email design and a decision about putting
  message text in email (today's EX07 notice carries none). Left for a separate change.
- Inbound mail triggers from Composio (webhooks) are not set up.

## Privacy note for the reviewer

With connected accounts on, the content of mail in the staff member's Casevoya label and their
calendar busy times pass through Composio (United States) and, when Vo drafts from them, the AI
vendor. PRD S5 (OPC, "Guidelines for processing personal data across borders",
https://www.priv.gc.ca/en/privacy-topics/airports-and-borders/gl_dab_090127/) frames the
accountability review needed before any firm enables it. Default is off; only the owner can
turn it on, after accepting a disclosure, and each staff member connects their own account.
