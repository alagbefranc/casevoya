# Casevoya handoff

You are the next developer on this repo. The product is multi-tenant practice management for licensed Canadian immigration consultancies. Immigration rules stay fictional until a licensed reviewer approves an official source. Read this file, then `docs/spec/RULES.md`, `docs/spec/MEMORY.md`, `docs/spec/PRD.md` (v1.1 governs), `docs/spec/ARCHITECTURE.md`, `docs/spec/DESIGN.md`, and `docs/spec/TASKS.md`. `docs/BRIEF.md` is the engineering summary. `docs/DATABASE.md` and `docs/DECISIONS.md` are the schema and the decision log. The README layout paragraph is older than the ports below.

`pnpm verify` is migration guard, lint, typecheck, and Vitest. CI's `verify` job also builds. Node 20 or newer, pnpm 10.34.6.

## State

Production app: https://app.casevoya.ca.

| Piece | What it is |
| --- | --- |
| App | Cloudflare Worker `casevoya-app`, deployed with OpenNext. `CASEVOYA_TARGET=workers` turns `cacheComponents` off because of [opennextjs-cloudflare#1318](https://github.com/opennextjs/opennextjs-cloudflare/pull/1318). |
| Committed config | `next.config.ts` on main sets `cacheComponents: true`. The workers override is a deploy setting. |
| Inbound mail | Worker `casevoya-inbound-email` in `workers/inbound-email`. `workers_dev = false`. Per-firm rules send `<slug>@docs.casevoya.ca` to that Worker. |
| Database | Supabase project `casevoya`, id `aqjtvqmojfamtspzyeqm`, region ca-central-1. `supabase/migrations` has 33 files, and those 33 are applied. |
| Marketing site | https://casevoya.ca is a separate Cloudflare Pages project. Leave it alone. |

## Merged pull requests #8–#18

| PR | What landed |
| --- | --- |
| [#8](https://github.com/alagbefranc/casevoya/pull/8) | Auth and firm-setup HTML ported into the App Router. |
| [#9](https://github.com/alagbefranc/casevoya/pull/9) | T021 portal invitations for clients, family, sponsors, and guardians. |
| [#10](https://github.com/alagbefranc/casevoya/pull/10) | Client portal port, and every practice jurisdiction stored. |
| [#11](https://github.com/alagbefranc/casevoya/pull/11) | T023 and T026: intake versions, matters, tasks, and deadlines. |
| [#12](https://github.com/alagbefranc/casevoya/pull/12) | T024 and T025: private documents, review, and requests. |
| [#13](https://github.com/alagbefranc/casevoya/pull/13) | Storage fix. The document migration no longer alters `storage.objects` RLS. |
| [#14](https://github.com/alagbefranc/casevoya/pull/14) | T022 in-house e-sign. |
| [#15](https://github.com/alagbefranc/casevoya/pull/15) | Staff Sheet and matter workspace port. |
| [#16](https://github.com/alagbefranc/casevoya/pull/16) | T010 and T034 mailer: outbound and inbound on Cloudflare Email. |
| [#17](https://github.com/alagbefranc/casevoya/pull/17) | Per-firm routing `<slug>@docs.casevoya.ca`. |
| [#18](https://github.com/alagbefranc/casevoya/pull/18) | Demo data stays inside sample mode. |

Earlier merged work, so you do not rebuild it: foundations, staff invites and MFA (#1), source governance (#4), PRD conformance for finance access, stages, birth dates, and MFA (#6), and licence checks with sample-mode gates (#7).

## Open pull requests

Only [#19](https://github.com/alagbefranc/casevoya/pull/19) is open. It is T030–T033: quotes, invoices, receipts, the client-funds ledger, PaymentIntents, and Stripe Connect embedded onboarding and payouts. Cards use the Payment Element. Connect uses embedded components. Checkout and hosted invoice pages are refused. `STRIPE_MODE` defaults to `test` and reads `STRIPE_TEST_SECRET_KEY`. The live key is for launch only. Its migrations are in the branch and are not applied to `aqjtvqmojfamtspzyeqm`. GitHub `verify` was still unconfirmed when that handoff stopped, and the pay, Connect, invoice, and receipt screens were not browser-tested while signed in. The rest of its leftovers are in journey 6 below.

The workspace shell and the create and edit flows have no pull request. Nothing was written. That work is the first task below.

The `/mfa` blank-page fix has no pull request either.

## Pages

Every shipped page is a Next.js App Router React port of the Designer's HTML. The markup and CSS match the design. None of these routes serve a static HTML file.

Routes in the repo: `/`, `/sign-in`, `/mfa`, `/recovery`, `/setup`, `/start-trial`, `/book`, `/enquiry`, `/invite/[token]`, `/accept/client`, `/accept/family`, `/accept/sponsor`, `/accept/staff`, `/help/client-home-screen`, `/app`, `/app/invitations`, `/sheet` and `/sheet/[page]`, `/sheet/matters` and `/sheet/matters/[id]`, and `/portal/[[...slug]]`. Sheet page ids live in `SHEET_PAGES` in `src/components/sheet/markup/registry.tsx`.

`loadSheetStaff` and `loadPortalViewer` return null while `organizations.sample_mode` is true, and for signed-out visitors. Those visits render the captured demo markup (Northline, Priya, Olena, Rafael). A signed-in firm that has left sample mode gets `LiveSheet` or `LivePortal`. `LiveSheet` is a plain list shell. It does not yet have the Designer sidebar icons, the top-bar search, `#newB`, or `#rbar`.

Wired to data today: auth and setup actions, the staff invite form on `/app/invitations`, and, once sample mode is off, the Sheet lists and the portal document and agreement reads those loaders cover. Still markup, or a slot that names a missing backend:

- Portal pages, including home, tasks, messages, appointments, pay, and the persona variants.
- Finance, messages, inbox, Vo, leads and pipeline, calendar, reports, automations, complaints, privacy, exports, and several settings tabs. `slotFor` in `src/modules/sheet/present.ts` names the missing ones.
- Create and edit flows. The staff invite is the one that exists, and it lives on `/app/invitations`, which `/app` does not link into the Sheet.

About 121 of the 151 designed pages are still to convert or to wire. The remainder is marketing, help, admin AD05, AD08, AD11, and AD12, emails, and errors. The Designer's next batch is `/workspace/casevoya-design/spec/handoff/03-new-screens.md` on Francis's machine. It is not in this repo. It covers invoice, receipt, Connect payouts, Email-in settings, Composio integrations, signed-out e-sign, and plan billing, plus 8 document thumbnails to copy into `public/assets/docs`. That folder already holds the earlier fictional previews. Copy only the eight that file names.

## Next tasks

Do these in order.

1. **Workspace shell and create and edit flows.** No branch exists. Build it, add component tests, and open a pull request.
   - The live Sheet gets the Designer shell: sidebar with icons, top bar with search and `#newB`, right `#rbar`, the same classes, filled with the firm's own rows. Build that shell. The captured demo markup in `src/components/sheet/markup/` fails the forbidden-name test (Northline and the other demo names, including the DocuSign notification).
   - Create and edit: a matter through `create_engaged_matter` with a licensed-consultant picker; a person; a document through intent, signed upload, and complete; a portal invite; a firm task through a new `create_firm_task` (that function is not in the schema yet); a deadline on a matter; an agreement; a licence; an office; firm name and timezone through `app.usable_timezone`; a staff invite inside the Sheet, with `/app/invitations` redirecting there; stage, hold, and government status on the matter detail.
   - `/app` links to `/sheet`.
   - Sample mode: an owner turns it off from a banner, with step-up, and the audit action is `firm.sample_mode_changed`. Verification gates only portal invites and e-sign sends, through a before-insert trigger on `signature_envelopes`.
   - Remove the `DocuSign` sentence from the demo home notifications in `src/components/sheet/markup/notifications.tsx`.
2. **Merge [#19](https://github.com/alagbefranc/casevoya/pull/19)** after `verify` is green, apply its migrations, and browser-test the signed-in flows in journey 6. Fix `/mfa` so the two-step screen renders, and browser-test that while signed in.
3. **T029 Vo.** Claude Agent SDK for the assistant, Composio for tools and for the firm's calendar and email connections. AI stays optional and off until the firm turns it on.
4. **Translation on Cloudflare Workers AI.** Gemma is primary, m2m100 is the fallback, IndicTrans2 is the check. Per-firm opt-in, off by default. Redact identifiers before the call. Label the result as machine translation. A machine translation is a draft (`docs/spec/RULES.md` §5).
5. **Remaining page wiring**, then the unconverted marketing, help, admin, email, and error screens. Leave the casevoya.ca Pages project alone.

## Decisions and defaults

| Topic | Default |
| --- | --- |
| T021 | Portal tokens last 7 days. The row stores `sha256(token)`. A missing date of birth blocks that person's login. Guardian subjects are minors. Section shares go to the applicant. A sponsor, payer, or household link does not open a restricted section. The real-client lock applies to every portal role. SMS numbers are E.164. |
| T023 | Matter reference is `{first jurisdiction code or CV}-{year in the firm timezone}-{sequence}`. Sequence width is 4 until 10000. It is not a government file number. |
| T026 | Reminder offsets 14, 7, 3, and 1 days, in `product_settings` key `reminders.proposed_offsets`, still `pending_confirmation`. A date-only deadline ends at the next local midnight. There is no holiday calendar. |
| T024 | Signed download lasts 120 seconds. Upload authorization lasts 15 minutes (`900` seconds). Default max is 25 MB. The ceiling is 100 MB, behind the firm flag. There is no malware scanner. Type and size checks are what reject a file. |
| T022 | Envelope life is 14 days (`agreements.envelope_days`, pending confirmation, clamped 1–90). At most 8 signers. Money is integer cents. Currency defaults to CAD. A government-fee note stores no amount. Provider is `in_house`. |
| Mail | From `notices@casevoya.ca`, firm display name on the From. Inbound domain `docs.casevoya.ca`. Hourly inbound cap 30 (`email.inbound_hourly_limit`). Reserved slugs: `support`, `billing`, `admin`, `hello`, `noreply`, `postmaster`, `abuse`, `security`, `help`, `info`, `team`. |
| Auth | Supabase Auth email codes are 6 digits. The site URL is `https://app.casevoya.ca`. Staff need `aal2` or the app's passkey and recovery path. Step-up is 15 minutes. |
| Sample mode | New organizations start with `sample_mode` true. The live Sheet and portal stay on demo markup until it is false. |

Several of the rows above are still `pending_confirmation` in `docs/DECISIONS.md`. Treat the table as the working default. A change needs Francis.

## Environment and secret names

Names only. Values stay in the host and in `.env.local`, never in git.

| Group | Names |
| --- | --- |
| Supabase | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` |
| Email | `CLOUDFLARE_EMAIL_API_TOKEN`, `CLOUDFLARE_ROUTING_API_TOKEN`, `EMAIL_DISPATCH_SECRET`, `EMAIL_INBOUND_WEBHOOK_SECRET`, `EMAIL_ROUTING_RECONCILE_SECRET` |
| Stripe | `STRIPE_TEST_SECRET_KEY`. [#19](https://github.com/alagbefranc/casevoya/pull/19) also uses `STRIPE_MODE`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, and `STRIPE_LIVE_SECRET_KEY` at launch. |
| Vo | `COMPOSIO_API_KEY`, `ANTHROPIC_API_KEY` |

`docs/DEPLOY.md` also lists `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_EMAIL_FROM`, and `INBOUND_EMAIL_DOMAIN`. The account id and the zone id `303990065795d627a9fd337b01258024` are not secrets.

## Known issues and test data

- Test organization slug `casevoya-test`, with a test user, and the routing rule `casevoya-test@docs.casevoya.ca`. Reconcile must leave that rule and the catch-all alone. It only edits rules named `casevoya-firm:`.
- Supabase advisor warnings on the live project: `SECURITY DEFINER` functions that `authenticated` can execute, and multiple permissive policies on the same table. Review them before launch. Do not grant `execute` more widely while you are in there.
- A new firm stays in sample mode, so `/sheet` keeps showing Northline, until sample mode is turned off. The shell task above is what puts the owner banner on the live chrome.
- `/mfa` can render blank. The route is `src/app/mfa/page.tsx` plus `TwoStepMarkup`. There is no fix branch.
- `workers/inbound-email/wrangler.toml` still has `INBOUND_WEBHOOK_URL = "https://REPLACE_ME.example/api/email/inbound"`. Set it to `https://app.casevoya.ca/api/email/inbound` before a real message.
- Login rate limits and idle timeout (T006) are still open in `docs/DECISIONS.md`.
- No production program pack is approved. O01–O15 are entry points, not seeded rules.

## Rules

- Forced RLS on every public table. `pnpm check:migrations` fails a table that lacks `ENABLE` and `FORCE ROW LEVEL SECURITY`.
- Never `ALTER` storage tables (`storage.objects` and the rest).
- Add enum labels in their own migration. A new label cannot be used until that statement commits.
- Apply a migration to the live project as the SQL file plus an insert into `schema_migrations`. Never edit a file that has been applied. Add a new file. Destructive SQL needs Francis's explicit approval.
- No force push. Changes go through pull requests.
- Keep the Core UI icon sprite private. `public/assets/icons-coreui/` is Francis's licensed kit. This repo stays private.

The app talks to Postgres as the signed-in user. `SUPABASE_SECRET_KEY` is for mail dispatch, inbound intake, and routing reconcile. It never gets a `NEXT_PUBLIC_` prefix.

## Definition of done: end-to-end

This is the ordered list of what is still required before Casevoya works end to end in production. It comes from `docs/spec/PRD.md` (especially §§4–17, 23, and 27), every task in `docs/spec/TASKS.md` that is not merged, and the gaps above. A row is done when the acceptance click passes, the server enforces the role, the action is audited, and the failure state is visible. A screen of demo markup is not done (PRD §27).

Tasks already merged, with the gaps called out in the journeys: T005, T006, T007, T008, T010, T011, T018, T021, T022, T023, T024, T025, T026, and the mail half of T034. Still open as tasks: T001, T002, T003, T004, T009, T012, T013, T014, T015, T016, T017, T019, T020, T027, T028, T029, T030, T031, T032, T033, T034's message UI, T035, T036, T037, T038, T039, T040, T041, T042, T043, T044, T045, T046, T047, T048, T049, T050.

Use fictional people. The test firm is `casevoya-test`.

### 1. Firm signup through setup, MFA, and verification

1. **Six-digit email codes are already set.** Sign up or request a sign-in code. The email shows a 6-digit code, and every link host is `https://app.casevoya.ca`.
2. **T001.** Record the launch country, provinces, client segment, first programs, excluded case types, the named reviewer, and the pilot firms. Open the decision log and see that record. Canada-first stays an assumption until it is written down.
3. **T002.** Record dated trademark, business-name, domain, and handle searches for Casevoya. The record states what was checked and the date. It does not say "available" because a search was quiet.
4. **Start a trial.** Open `/start-trial`, submit the firm form, and land in setup as the owner of a new organization whose `sample_mode` is true.
5. **Email verify and `/mfa`.** After the password step, `/mfa` shows the two-step screen (authenticator enrolment and a code field), not a blank page. Enter a valid TOTP code and reach the next setup step. There is no pull request for this fix yet.
6. **Recovery.** On `/recovery`, consume one app recovery code and sign in. Use the same code again and see it rejected. Five failures lock the factor for 15 minutes.
7. **Setup steps.** Walk firm details, terms and privacy, jurisdictions, licence, branding, calendar and payments acknowledgement, records and retention, and the sample case. Each saved step is still there after a reload. Calendar and payment connectors are acknowledged here. They are not connected yet.
8. **Licence evidence (T018).** Enter regulator, college id, licence type, and a proof file. A reviewer records register status, entitlement, and discipline flags. The screen says the check is manual. It does not say the CICC register was synced.
9. **Sample case before real clients.** From the sample workspace, send an intake, send a service agreement, request an upload, schedule a reminder, issue an invoice, and export the file. Each one is flagged sample. A real portal invite is still blocked.
10. **Leave sample mode.** As the owner, turn sample mode off from the banner, complete step-up, and see `firm.sample_mode_changed` in the audit. Reload `/sheet` and see the firm's own name in the Designer shell. Turn it back on and see the demo markup return.
11. **Verification gate.** With the firm unverified, insert a portal invite and an e-sign send. The before-insert trigger on `signature_envelopes` rejects the send, and the invite is rejected for every portal role. Sample-mode practice and ordinary staff work still save.
12. **Staff invite inside the Sheet.** Invite an assistant by email. Open the message, accept on `/accept/staff`, enrol MFA, and land on `/sheet` as that assistant. Open the raw token a second time and see it rejected. `/app/invitations` redirects to the Sheet invite screen. `/app` links to `/sheet`.
13. **Last owner.** Try to demote the only active `firm_owner`. The action is refused until a second active owner exists.
14. **Session revocation (T006).** Revoke the assistant's session. Their next click on `/sheet` returns them to `/sign-in`.
15. **Login rate limit and idle timeout.** Repeat a bad password and see the limit. Leave a staff session idle past the timeout and see it signed out. These two are still open in the decision log.

### 2. Staff workspace

1. **Designer shell.** Sign in as a verified firm that has left sample mode. `/sheet` shows the sidebar with Core UI icons, the top bar with search and `#newB`, and the right `#rbar`, using the Designer classes. Search for a matter reference and see that matter. The page text contains the firm's name and none of Northline, Priya, Olena, Rafael, or DocuSign.
2. **Home queues (PRD §4).** The overview lists due tasks, blocked matters, documents awaiting review, unsigned agreements, unread messages, and financial exceptions from the firm's rows. Filter a queue by owner, office, program, priority, and date, and see the list change.
3. **New matter.** From `#newB`, create a matter with `create_engaged_matter`, pick a licensed consultant, and see reference `{jurisdiction|CV}-{year}-{seq}` on the matter page. A case manager without a licence cannot be the releasing consultant.
4. **Person.** Add a person with a full date of birth and an email. Add a second person with no date of birth. Both appear on the matter. The second cannot be invited to their own login.
5. **Document create.** Start an upload (intent), PUT the file to the signed URL, and complete it. The document shows on the matter as awaiting review. A `.pdf` whose bytes are not a PDF is rejected.
6. **Portal invite.** Invite the adult applicant. They receive a 7-day link. Invite a minor's guardian and see the guardian grant. Try to invite the minor and see the block.
7. **Firm task.** Create a task with `create_firm_task`, assign it, and see it on `/sheet/tasks` and on the matter.
8. **Deadline.** Add a date-only deadline on the matter. It shows the local date and ends at the next midnight in the firm timezone. Reminders are scheduled at 14, 7, 3, and 1 days when those dates are still in the future.
9. **Agreement.** Create an agreement from a template, send it to at most 8 signers, and see the envelope in `in_house` with a 14-day expiry.
10. **Licence and office.** Add a second office and a second licence from the Sheet. Reload and see both.
11. **Firm name and timezone.** Change the display name and set the timezone through `app.usable_timezone`. An unknown timezone is rejected. The matter reference year follows the saved timezone.
12. **Stage, hold, and status.** On the matter, move stage with the required evidence, put it on hold with a reason, and set a government status. The audit has the actor and the version. A hold does not clear the deadline. A payment does not change the government status.
13. **Component tests.** The new shell and each create form have component tests. `pnpm test` covers them, and the forbidden-name check still fails if live UI renders demo markup.
14. **Remove DocuSign.** Open the signed-out demo home notifications. The DocuSign sentence is gone.
15. **T009 and DES-03.** Tab through the shell, the matter page, and one create form with the keyboard only. Focus is visible, names are announced, and contrast holds at 200% zoom.

### 3. Client intake, portal invite, and the portal

1. **T019 leads.** Submit `/enquiry` with name, contact preference, country, language, and consent. The lead appears in the pipeline as New. Staff assign it, add a note, and convert it to a person and a matter. Two people who share an email stay two people.
2. **Conflict and consultation (CRM-03, CRM-04).** Record a conflict screen, book a consultation in the firm's timezone, and reschedule it. A second booking in the same slot is refused. The consultation agreement is a different record from the later service agreement.
3. **T020 intake.** Open the client's questionnaire, answer a conditional question that the published rule turns on, and see it required. Kill the network, reload, and see the last saved draft and the saved time. Enter a year-only date and see it stored as approximate, not as 1 January. Change a passport number and see a new fact version.
4. **T021 accept.** Open the 7-day invite, accept as the applicant, and land in `/portal` on real rows. Open the same link again and see it expired. A sponsor's login does not show the applicant's restricted section. An adult dependant can share one section with the applicant and withhold another. A missing date of birth blocks the accept.
5. **T035 portal home.** On a phone-width window, `/portal` answers what to do, by when, who is working on the case, and what happens next, in the firm's name. Uploaded and accepted documents are separate counts. There is no approval percentage.
6. **Portal pages on real data.** Click My matters, Tasks, Documents, Messages, Appointments, Agreements, and Payments. Each page lists this client's rows or a true empty state. Olena and Rafael do not appear.
7. **Correction.** Submit a correction from the portal. Staff see a new version and the previous submitted snapshot still opens.
8. **Majority.** Set a minor's birthday so they reach the firm's age of majority. An authority-review task appears, and the guardian grant stops opening the file.
9. **Source pack before real program content (T012–T017, SRC-01–SRC-12).** Publish one fictional pack through the review workbench. A user who is not a `licensed_consultant` cannot approve it. A second pack with a missing date stays unpublished. Change the source hash and see an impact task, while the already submitted package still opens the old text. Clients see a plain source line. They do not see another client's facts. Unsupported provinces do not inherit the pack.
10. **T014.** The first real program pack has an official URL, section, hash, reviewer, and effective date. Until that record exists, client-facing program text stays labelled fictional.

### 4. Documents, email-in, and unsorted files

1. **Request (T025).** Staff request a passport scan with a due date and an audience of the applicant. The client sees the request on `/portal`. The sponsor does not.
2. **Upload.** The client uploads a JPEG under 25 MB. Staff accept it. The progress line counts it as accepted, not merely uploaded. A 30 MB file is rejected unless the firm flag allows up to 100 MB. There is no malware scanner. A file that fails the type check never becomes accepted evidence.
3. **Replace.** Upload a replacement. The previous submitted package still opens the old version and hash.
4. **Download.** Click download. The signed URL works, and a request after 120 seconds fails. The download is in the audit.
5. **Email-in settings.** Open the Email-in settings screen from the Designer's batch. It shows `<slug>@docs.casevoya.ca` and the matter plus-tag form. Copy stays on `docs.casevoya.ca`.
6. **Inbound delivery.** Send a message to the firm's slug. It appears in the unsorted queue within the hour, and the 31st message in that hour is `rate_limited`. A message to `casevoya-test@docs.casevoya.ca` still arrives and is not rewritten by reconcile.
7. **Assign unsorted.** Open an unsorted file, assign it to a person and a matter, and see it on that matter's documents. The other firm's staff cannot open it by id.
8. **Finance user.** Sign in as `finance_user` and open document search. A restricted narrative does not preview.
9. **T027 and T028.** Map an approved fact into a supported form, show the source beside the field, and build a package manifest of version hashes. Change one document after approval and see the manifest require a new approval. An assistant can prepare the package and cannot release it.

### 5. E-sign, including signed-out signers

1. **Send.** Staff send the service agreement. The envelope stores the document hash, the consent version `esign-consent-2026-10-17`, and an expiry 14 days out. A ninth signer is refused.
2. **Signed-in signer.** The client opens Agreements in the portal, accepts the consent, and signs. The envelope shows that signature, and the pending engagement records the agreement id. Stage does not change by itself, and representation authority stays a separate record.
3. **Signed-out signer.** Open the Designer's signed-out e-sign screen from the link in the email, while signed out. Sign, and see the completed PDF and the completion certificate. Reload the link after completion and see the executed copy, not a second signature.
4. **Decline and expiry.** Decline a second envelope and see the history kept. Advance the clock past 14 days and see the envelope expired, with no signature accepted after that.
5. **Amendment (AGR-04).** Change the fee after one signer has signed. The old envelope is voided or superseded, and everyone signs the new version. The executed PDF bytes are unchanged.
6. **Idempotency.** Replay the signature event. The agreement executes once.
7. **Unverified firm.** Sending an envelope before verification is rejected by the `signature_envelopes` trigger.

### 6. Finance ([#19](https://github.com/alagbefranc/casevoya/pull/19))

1. **Merge.** `verify` is green on the pull request. Merge it. Do not force-push the branch.
2. **Apply.** Run `20261017210000_finance_enums.sql` and `20261017210100_finance_ledger.sql` on `aqjtvqmojfamtspzyeqm`, and insert both versions into `schema_migrations`. `pnpm db:types` regenerates `src/types/database.types.ts`.
3. **Test env.** Set `STRIPE_MODE=test`, `STRIPE_TEST_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (a `pk_test_` key) on the Worker. A live secret is absent. Starting the app with a live key while mode is `test` fails closed.
4. **Webhook.** In the Stripe test dashboard, point the endpoint at `https://app.casevoya.ca/api/stripe/webhook`. Send `payment_intent.succeeded` twice. The invoice is paid once. A bad signature returns 400 and writes no row.
5. **Quote.** Issue a quote. It has no Pay button. Accepting it does not mark an agreement executed.
6. **Advance.** Record a manual CAD 1000 bank transfer, verify it, and see a client-funds liability. Card collection for the advance stays off. The case stage is unchanged.
7. **Invoice.** Issue a professional invoice with a delivered-service note of at least 8 characters. Open `/api/invoices/{id}/pdf` and see the Casevoya invoice. Government fees appear only as a note, with no amount in the total.
8. **Pay.** As the client, open portal pay. The Payment Element is on the page. Pay the test card. The invoice becomes paid only after the webhook, not when the browser returns. Checkout and a hosted invoice page never appear.
9. **Connect.** As the owner, after step-up, open Connect onboarding (`#cv-connect-onboarding`) and finish the embedded test account. Then open payouts (`#cv-connect-payouts`). The account stays `pending` until `connect.updated`. A direct charge uses the firm's account, application fee 0, and an idempotency key.
10. **Receipt.** Open `/api/receipts/{id}/pdf` after payment and see the receipt number `R-{year}-{seq}`.
11. **Plan.** On the firm plan screen, choose a plan with `#cv-plan-payment`. The amount matches the `billing.plans` snapshot. A webhook with the wrong amount does not set the subscription `active`.
12. **Earned fee.** Transfer CAD 300 of a reconciled advance to earned fees. The client balance shows CAD 700. A second approver is required when two billing staff are active. A solo firm self-approves with a reason of at least 8 characters.
13. **Refund and dispute.** Refund once and replay the webhook. The balance moves once. A dispute stores the row and does not delete the file.
14. **Currency.** Attempt to pay a CAD invoice with a USD event. It is refused.
15. **Leftovers from the pull request.** A dispute that arrives before `payment_intent.succeeded` is replayed or visibly held until the success event. `billing_plan_catalog` is not the UI path. Plan prices stay `pending_confirmation` until a buyer decision. The Designer invoice, receipt, and Connect screens from `03-new-screens.md` replace the slot notes.

### 7. Messages and notifications

1. **T034 matter message.** Staff send a message to the applicant with a permissioned attachment link. The client sees it under Messages. The audience was shown before send.
2. **Internal note.** Post a staff-only note. Sign in as the client and confirm that note is absent.
3. **Employer boundary.** Address a message to the employer contact and try to attach a document limited to the applicant. The send is refused.
4. **Email notice.** The client receives mail from `notices@casevoya.ca` with the firm name and a portal link. The body has no passport number and no attachment bytes.
5. **SMS.** Save an E.164 mobile and turn SMS notices on. A non-E.164 value is rejected. The text is a short pointer to the portal.
6. **Bounce.** Force a delivery failure on a critical reminder. Staff see a follow-up task. The client is not shown as notified.
7. **Quiet hours and dedupe.** Complete a task and see its pending reminder cancelled. Replay the job and see one reminder. A date change moves the future reminders.
8. **T010 operations.** The outbox, webhook dedupe, retry, and dead-letter queue are visible to an operator. A duplicate provider event has one business effect.

### 8. Vo (T029)

1. **Off by default.** Open Vo on a new firm. It says not connected, and core casework still works with `COMPOSIO_API_KEY` and `ANTHROPIC_API_KEY` unset.
2. **Connect.** Turn Vo on, connect the firm calendar and mailbox through Composio, and see connected, degraded, and disconnected states. Disconnect removes the grant.
3. **Draft.** Ask for a summary of one authorized document. The draft cites that document, names the model, and waits for a consultant to accept, edit, or reject. It does not sign, submit, or change a fact.
4. **Abstain.** Ask about a program with no approved source. The answer abstains and opens a review, and it does not invent a fee or a deadline.
5. **Injection.** Upload a file that tells the model to reveal another client's file and to send a message. The run has neither the other file nor a sent message.
6. **Cross-tenant.** Repeat the question as Firm B. Firm A's text never appears. Embeddings and caches follow the same rule.
7. **Evaluation.** Run the permissioned synthetic set in PRD §15 AI-07 and record precision, anchors, and the zero cross-tenant result before calling Vo released.

### 9. Translation on Workers AI

1. **Off by default.** Open a French document on a firm that has not opted in. You see the original, with no translation call.
2. **Opt in.** The owner turns translation on. A document translates with Gemma. If Gemma fails, m2m100 runs. IndicTrans2 runs as the check on the languages it covers.
3. **Label.** The translation is marked machine translation. Staff can accept or reject it. It does not replace the original and it is not an official-language publication.
4. **Redaction.** A passport number and other identifiers are removed before the Workers AI call. The audit records the model and the firm, not the raw identifier.
5. **Audience.** A sponsor cannot open a translation of a section the applicant did not share.

### 10. Admin, reports, automations, complaints, privacy, and exports

1. **T036 submission.** Record a submission with channel, representative, package version, external reference, time, and receipt. With no receipt, the matter says submission unverified. A payment receipt cannot set Submitted. There is no government write API.
2. **T037 correspondence.** Upload a government letter, record received date and due date, and see tasks for the people it names. A second letter does not overwrite the first.
3. **T038 decision.** Record a refusal with the decision document, received date, and reviewer. An urgent review task appears. The screen does not promise an appeal. A client upload stays unverified until the consultant confirms it. Approval, withdrawal, returned, abandoned, and other are separate outcomes.
4. **T039 follow-up.** Create a linked matter for a new service. It starts at engagement pending and does not copy the old program. Expiry reminders use the client's contact preference.
5. **T040 closure.** Close the matter, set a retention date, and export the client copy. A legal hold survives a deletion job. The export contains the executed agreement, package, correspondence, money, and closure note.
6. **T041 reports.** Open Reports as the owner and see workload, overdue tasks, receivables, and client-account balances with the metric definition on the page. A government-processing chart excludes pending cases from the completed denominator. An assistant without export permission cannot download it.
7. **Automations (OPS-07).** Build a rule that creates a task and sends an approved template. A rule that would submit, refund, or change a bank account is refused and stays for a person.
8. **Complaints (ADM-05).** File a complaint linked to the matter, acknowledge it, and resolve it. The client and unrelated staff do not see the register. A software incident stays a separate record.
9. **Privacy (SEC-05, SEC-06).** Record a subject-access request, export that person's authorized data, and see another adult's private section omitted. A correction request creates a new version. Withdrawal of consent does not delete a file that is under retention.
10. **T043 support grant.** A platform admin opens Firms and sees metadata. Opening a client file requires a 60-minute grant with a reason. The firm can see that access. When the clock ends, the file closes.
11. **Admin screens AD05, AD08, AD11, AD12.** Port and wire them. Each shows operational data or a true empty state, with loading, denied, and error states.
12. **T044 migration.** Dry-run an import, show duplicate suggestions, and require a person to confirm a merge. Counts and checksums match the source. Rollback returns the firm to the pre-import snapshot.

### 11. Marketing, help, errors, and emails

1. **Public pages (PRD §4).** Port home, product, workspace, portal, security and privacy, pricing, integrations, migration, book a demo, contact, help centre, terms, privacy notice, subprocessors, accessibility, and service status as App Router pages in this repo. The casevoya.ca Pages project stays untouched.
2. **Calls to action.** Book a demo opens `/book`. Start a trial opens `/start-trial`. Demo copy is labelled fictional.
3. **Help.** The help centre answers a client task in plain language and links into the portal. `/help/client-home-screen` is the one help page already ported.
4. **Errors.** Trigger 404, an expired invite, a denied matter id, an offline save, and a failed upload. Each page uses the Designer error markup and tells the person what to do next.
5. **Email templates.** Send each template to the test inbox. The From is `notices@casevoya.ca`, the body matches the template, and no template includes a document that the recipient cannot open.
6. **Thumbnails.** Copy the 8 thumbnails named in `03-new-screens.md` into `public/assets/docs`. The document preview uses those files.
7. **DES-04.** Every core screen has loading, empty, error, denied, offline, and retry. Missing data stays empty.

### 12. Launch

1. **T003 decision register.** Write the launch register for software provider, consultancy, client, and processors, covering the agreement, client funds, privacy, retention, and record transfer. Unresolved blockers are listed.
2. **T004.** Record interviews with at least three target firms and any scope change those interviews caused.
3. **Live Stripe key.** After the test journey in section 6 is signed off, set `STRIPE_MODE` so production reads `STRIPE_LIVE_SECRET_KEY`. A test webhook cannot mark a live invoice paid. Advance card collection stays off until the client-account arrangement is approved.
4. **T042 billing.** A firm can start a trial, choose a plan, pass due, restrict, cancel, and export. Cancelling does not delete matters. Platform subscription money is a different ledger from client professional fees. Prices stay pending until buyers confirm them.
5. **PIPEDA.** Publish the privacy notice, the processor list, and breach records. Cross-border processing is described as accountability, not as a Canada-only claim. Breach records include events below the reporting threshold and are kept at least 24 months.
6. **Quebec Law 25.** Complete the privacy impact assessment before a Quebec firm's data is processed, including transfers outside Quebec. The assessment is filed with the launch review. The product does not show a universal "PIPEDA compliant" badge.
7. **T045 security review.** An independent review covers authorization, uploads, SSRF on source fetch, signed links, webhooks, source poisoning, secrets, dependencies, logs, and exports. Critical and high findings are closed. The Supabase advisor warnings (security-definer functions executable by `authenticated`, and multiple permissive policies) are in that review, and each one is fixed or accepted in writing.
8. **T046 accessibility.** A keyboard and screen-reader pass completes invite, intake, upload, signature, and payment with no blocking defect. Record remaining limits.
9. **T047 backups and monitoring.** Restore the database and documents into a clean project. Manifest hashes, balances, permissions, holds, and deletion tombstones match. Measure RPO and RTO against 15 minutes and 4 hours before stating them. Alerts fire on a dead-letter job, a failed webhook, and Worker errors.
10. **Remove test data.** Delete or archive `casevoya-test` and any sample rows from the production project after the pilot evidence is copied out. Production screens show no Northline data.
11. **OpenNext `cacheComponents`.** After [opennextjs-cloudflare#1318](https://github.com/opennextjs/opennextjs-cloudflare/pull/1318) is fixed, redeploy `casevoya-app` with `cacheComponents` on and confirm `/mfa`, `/sheet`, and `/portal` still render for a signed-in user. Until that fix, production stays on `CASEVOYA_TARGET=workers` with the cache off.
12. **T048 sign-off.** The named professional, privacy, and finance reviewers sign the exact build, the source pack, the client-account workflow, and the list of exclusions.
13. **T049 pilot.** Named firms run intake through decision on synthetic or authorized cases. Record completion, errors, reconciliation, and client comments.
14. **T050 launch.** The exit review, rollback, limitations, operating cadence, and source owners are written down. Later countries and integrations are separate releases.

PRD §23 scenarios 1 through 20 are the regression pass over the journeys above. General availability also requires no open critical security defect, no known cross-tenant read, a certified ledger, a demonstrated restore, reviewed program packs, and a tested incident runbook.
