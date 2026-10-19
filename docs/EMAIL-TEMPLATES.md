# Email templates

The approved Designer emails (export of 18 Oct 2026: 38 HTML emails, 3 SMS texts) are ported to
parameterized renderers. The markup, inline styles, spacing, fonts and colours are the Designer's;
example data (Northline Immigration, Amara Osei, …) is replaced by merge fields.

## Where things are

| What | Where |
|---|---|
| Shell (header, spot, heading, paragraph, button, footer, preheader, plain text) | `src/modules/email/designs/layout.ts` |
| Every template: typed context, subject, preheader, copy, button, status, trigger | `src/modules/email/designs/catalog.ts` |
| Date, role and number formatting | `src/modules/email/designs/format.ts` |
| Database template + context → design (what the mail worker calls) | `src/modules/email/templates.ts` (`renderEmail`, `designFor`) |
| Mail worker | `src/modules/email/dispatch.ts`, `run-dispatch.ts` (passes `appOrigin()`) |
| Database: new enum values, invoice/payment/refund events, mail context | `supabase/migrations/20261019170000_email_design_template_enum.sql`, `20261019170100_email_design_events.sql` |
| Database: consultation mail (EM16a–c) | `supabase/migrations/20261019180000_scheduling_enums.sql` (enum values), `20261019180200_scheduling_mail.sql` (claim/prepare, copied from 20261019170100), `20261019190000_booking_practice_pages.sql` (prepare: `portal`, `location_kind`, `address`, `booking_page`) |
| Review previews (synthetic data) | `docs/email/previews/*.html` (open `index.html`); French drafts `docs/email/previews/fr/*.html` |
| French (fr-CA): English source table, drafts with status and reviewer, parallel builders, sending gate | `designs/i18n-source.json`, `designs/fr-drafts.json`, `designs/localized.ts`, `designs/french.ts`; how-to in `docs/i18n/README.md`; review package `docs/i18n/email-fr-review.md` |
| Supabase Auth templates, ready to paste | `docs/email/supabase-auth/*.html` |
| Tests | `tests/email-designs.test.ts`, `tests/email-designs.rls.test.ts`, `tests/email-previews.test.ts` |

The renderers are plain TypeScript string code (no `fs`, no DOM), so they run in the Cloudflare
Worker. Previews and the Supabase files are file snapshots of the renderers: `pnpm email:previews`
rewrites them, and the test fails when a renderer changes and they were not refreshed.

## Rules the renderers enforce

- Every merge value is HTML-escaped (`& < > " '`) and collapsed to one line (no header injection
  through a subject). Numbers such as `INV-0001` / `RC-0001` must match their pattern or are left out.
- Buttons link only to absolute app URLs built from the app origin and a fixed path
  (`/portal/...`, `/sheet/...`). The only link taken from mail context is an invitation's private
  accept link, which the worker opens from its sealed form (unchanged mechanism); a link that is not
  absolute http(s) without credentials is dropped with its button. A `link` stored in the database is
  deleted before rendering, as before.
- Each email has a subject, a hidden preheader and a plain-text alternative (heading, paragraph,
  `Button label: URL`, footer line).
- Subjects and preheaders never carry an immigration program, a document name, an amount, a
  message body or a decision ("external notices avoid sensitive payloads", TASKS T034). Copy has no
  em dashes.
- Images: `https://<app origin>/assets/email/*.png` (with `@2x` srcset), fonts:
  `https://<app origin>/fonts/erode/Erode-*.woff2`. The origin is `APP_URL` through `appOrigin()`
  (default `https://app.casevoya.ca`), so images ship and version with the app (`public/assets/email`).
  `logo.png` / `logo@2x.png` were missing there and are added from the export; every other image
  was already present and byte-identical.
- **Firm header.** `header-firm.png` has the example firm baked in and is never used. Firm emails
  draw the same header in HTML: a 52px rounded tile (`#0A4B93`) with the firm's initial, the firm's
  display name (Erode 22px, `#111`), "Your immigration file" right-aligned (13px, `#6b6862`) and the
  1px `#e6e2db` rule, 120px tall in all. Firm logos are in the private `firm-logos` bucket, so no
  logo image is used. Platform emails keep `header-platform.png`. Firm emails keep the
  "Sent by {firm} via Casevoya" footer; platform emails the Casevoya logo footer.

## Templates

Status: **wired** = the app sends it now; **ready-not-wired** = renderer, subject, preheader and
button are done, but no app event sends it yet; **deferred** = deliberately not sent.
Subjects show `{merge_field}` where a value is merged. "Honours email_notices" means a person whose
portal choice "Email notices" is off is recorded as `skipped`, not emailed.

| ID | Name | Trigger | Audience · header | Subject | Preheader | Button → target | Merge fields | Status |
|---|---|---|---|---|---|---|---|---|
| EM01 | Staff invite | Firm owner invites a staff member (outbox staff_invitation.email_requested, template invite, kind staff) | staff · platform | {inviter_name} invited you to {firm_name} (without an inviter name: You’re invited to join {firm_name}) | Accept your invitation to join {firm_name} on Casevoya. | Accept invitation → `Sealed accept link /invite/<token>` | `firm_name`, `inviter_name`, `role`, `accept_url (sealed)` | wired |
| EM02 | Client invite | Staff invite a client, sponsor, employer contact or guardian to the portal (outbox portal_invitation.email_requested) | client · firm | Your file with {firm_name} is ready | Open your private link to set up your portal login. | Open your portal → `Sealed accept link /accept/<role>?token=…` | `firm_name`, `inviter_name`, `accept_url (sealed)` | wired |
| EM03 | Verify email | Supabase Auth "Confirm signup" | staff, owner and client · platform | Verify your email | Confirm your email to finish signing in to Casevoya. | Verify email → `{{ .ConfirmationURL }}` | `{{ .Token }}`, `{{ .ConfirmationURL }}` | deferred (Supabase Auth; `docs/email/supabase-auth/confirm-signup.html`) |
| EM04 | Sign in code | Supabase Auth "Magic Link" (email OTP: recovery code, sign-in) | staff · platform | Your sign-in code | Use this code to finish signing in. | — | `{{ .Token }}` | deferred (Supabase Auth; `docs/email/supabase-auth/magic-link.html`) |
| EM05 | Sessions signed out | Password changed with “sign out everywhere” (revoke_other_sessions). No outbox event yet | staff · platform | Your other sessions were signed out | This follows your password change. | — | — | ready-not-wired |
| EM06 | Document requested | Staff create a document request (outbox document.request_created, template document_request) | client · firm | {firm_name} asked for a document | Upload it securely in your portal. | Open your portal → `/portal/documents` | `firm_name`, `due_on` | wired |
| EM07 | Deadline reminder | A reminder schedule comes due (outbox reminder.due, template reminder). Honours deadline_reminders and email_notices | client · firm | A step on your file is due {due_on: 30 Oct} (without a date: A reminder from {firm_name}) | Your portal shows what to do next. | Open your portal → `/portal` | `firm_name`, `due_on` | wired |
| EM08 | Agreement ready to sign | Staff send an agreement for signature (outbox agreement.sent, template agreement), to client signers | client · firm | An agreement from {firm_name} is ready to sign | Review it and sign in your portal. | Review and sign → `/portal/agreements` | `firm_name`, `agreement_kind` | wired |
| EM08-staff | Agreement: your turn to countersign (staff variant of EM08) | A staff signer’s turn comes (outbox agreement.signer_turn, template agreement, audience staff) | staff · platform | Your countersignature is needed at {firm_name} | Open Agreements in Casevoya to sign. | Open agreements → `/sheet/agreements` | `firm_name` | wired |
| EM09 | Agreement executed | The last signer signs (outbox agreement.executed, template signature), to client signers | client · firm | Your agreement with {firm_name} is signed | Your copy and the completion certificate are in your portal. | Download your copy → `/portal/agreements` | `firm_name` | wired |
| EM09-staff | Agreement executed (staff variant of EM09) | The last signer signs (outbox agreement.executed, template signature, audience staff), to staff signers | staff · platform | An agreement at {firm_name} is signed | The firm’s copy is on the matter in Casevoya. | Open agreements → `/sheet/agreements` | `firm_name` | wired |
| EM10 | Invoice issued | Billing staff issue an invoice (outbox invoice.issued, template invoice), to the matter’s applicants. Honours email_notices | client · firm | New invoice from {firm_name} | The amount and payment options are in your portal. | View invoice → `/portal/payments?invoice=<invoice id>` | `firm_name`, `invoice_id`, `invoice_number`, `due_on` | wired (new send) |
| EM11 | Payment receipt | An invoice payment receipt (`PR-0001`) or a client-funds advance receipt (`RC-0001`) is issued. Hook: template `payment_receipt`; needs its enum value and an outbox event from `app.issue_invoice_payment_receipt` | client · firm | {firm_name} received your payment | Your receipt is in your portal. | View receipt → `/portal/payments` | `firm_name`, `receipt_number`, `advance` | ready-not-wired |
| EM12 | Bounced notice staff follow up | A critical client email bounces (finish_email_delivery opens the “Email was not delivered” task). No email yet | staff · platform | A client notice was not delivered | A follow-up task is open in Casevoya. | Open task → `/sheet/tasks` | `matter_reference` | ready-not-wired |
| EM13a–c | SMS: deadline reminder, sign-in code, appointment | Telnyx is not wired for these | client / staff · SMS | — | — | — | see SMS below | deferred (document only) |
| EM14a | French client invite (draft) | Preview of EM02's French draft (`fr-drafts.json`, EM14a hand draft folded in). Sent as EM02 only to a French-preferring recipient after EM02's French is approved | client · firm | Votre dossier avec {firm_name} est prêt | Ouvrez votre lien privé pour créer votre accès au portail. | Ouvrir votre portail → `Sealed accept link` | as EM02 | deferred (preview) |
| EM14b | French document requested (draft) | Preview of EM06's French draft (EM14b hand draft folded in). Sent as EM06 only after approval | client · firm | {firm_name} vous demande un document | Téléversez-le en toute sécurité dans votre portail. | Ouvrir votre portail → `/portal/documents` | as EM06 | deferred (preview) |
| EM14c | French deadline reminder (draft) | Preview of EM07's French draft (EM14c hand draft folded in). Sent as EM07 only after approval | client · firm | as EM07 (draft: Une étape de votre dossier est prévue {short_date}) | Votre portail indique quoi faire. | Ouvrir votre portail → `/portal` | as EM07 | deferred (preview) |
| EM15 | Decision recorded | Staff record a government decision on the matter. No outbox mail event yet | client · firm | There’s news on your file | For your privacy, the details are in your portal. | Open your portal → `/portal` | `firm_name`, `consultant_name` | ready-not-wired |
| EM16a | Consultation booked | A consultation is booked on the public booking page (or a practice page in sample mode: a sample booking, mailed like other sample records) or by staff (outbox booking.confirmed, template consultation_booked), to the attendee. Honours email_notices when the attendee is linked to a person. Says how they meet: phone "{firm} will call you at the number you gave.", video or meeting link "{firm} will send you the meeting link." (never the link itself), in person "At {address}." or "{firm} will confirm the address.". Without a portal login it ends "To change or cancel, contact {firm}." | client · firm | Your consultation with {firm_name} is booked | Here’s when, and how you’ll meet. | View booking → `/portal/appointments`, only when `portal` is true; otherwise no button | `firm_name`, `starts_at`, `time_zone`, `consultant_name`, `portal`, `location_kind`, `address` | wired (new send) |
| EM16b | Consultation rescheduled | Staff move a confirmed consultation (outbox booking.rescheduled, template consultation_rescheduled), to the attendee. Without a portal login it ends "To change or cancel, contact {firm}." | client · firm | Your appointment with {firm_name} moved | The new time is in your portal. (no portal: Here’s the new time.) | View booking → `/portal/appointments`, only when `portal` is true; otherwise no button | `firm_name`, `starts_at`, `time_zone`, `portal` | wired (new send) |
| EM16c | Consultation cancelled | Staff cancel an upcoming confirmed consultation, or the attendee cancels it from their portal (outbox booking.cancelled, template consultation_cancelled; context `cancelled_by` says which), to the attendee. No booking-fee sentence until paid bookings exist. Without a portal and without a booking page it ends "To book another time, contact {firm}." When the attendee cancelled: subject "Your consultation with {firm_name} is cancelled", body "You cancelled your consultation on {date_time} ({time_zone_label}) with {firm_name}." | client · firm | {firm_name} cancelled your consultation (attendee cancelled: Your consultation with {firm_name} is cancelled) | You can book another time in your portal. (no portal: You can book another time online. / To book another time, contact the firm.) | Book another time → `/portal/appointments` when `portal` is true; otherwise `/book/<booking_page>` when the firm has a published page the attendee can use; otherwise no button | `firm_name`, `starts_at`, `time_zone`, `portal`, `booking_page` | wired (new send) |
| EM17 | Support access granted | A firm owner approves a Casevoya support access request. Support access is not built yet | firm owner · platform | You gave Casevoya support access | Every action is in your audit trail. You can end it now. | Review or end access → `/sheet/grants` | `firm_name`, `approver_name`, `minutes`, `ends_at`, `time_zone` | ready-not-wired |
| EM18a | Subscription past due | The Casevoya subscription payment fails. Subscription billing is not built yet | firm owner · platform | Your Casevoya subscription is past due | Nothing is deleted. Update billing to keep working. | Update billing → `/sheet/settings` | `firm_name` | ready-not-wired |
| EM18b | Workspace restricted | The subscription stays past due. Subscription billing is not built yet | firm owner · platform | {firm_name}’s workspace is restricted | Clients can still sign in, upload and pay. Nothing is deleted. | Update billing → `/sheet/settings` | `firm_name`, `days_past_due` | ready-not-wired |
| EM19a | Data export ready | A client-file export finishes. Exports are not built yet | staff · platform | Your export is ready | Sign in to download it. | Download export → `/sheet/exports` | `hours` | ready-not-wired |
| EM19b | Data export expiring | An unopened export nears expiry. Exports are not built yet | staff · platform | Your client-file export expires soon | Download it before the link expires. | Download export → `/sheet/exports` | `started_on`, `hours_left` | ready-not-wired |
| EX01 | Password reset | Supabase Auth "Reset Password" (`resetPasswordForEmail`; the app's recovery uses an email OTP today, see EM04) | staff and clients · platform | Reset your password | Use the code or the button to choose a new password. | Choose a new password → `{{ .ConfirmationURL }}` | `{{ .Token }}`, `{{ .ConfirmationURL }}` | deferred (Supabase Auth; `docs/email/supabase-auth/reset-password.html`) |
| EX02 | New sign in alert | A staff sign-in from a new device. No device tracking event yet | staff · platform | New sign-in to your Casevoya account | If it wasn’t you, sign out everywhere now. | Review sign-ins → `/sheet/settings` | `firm_name`, `device` | ready-not-wired |
| EX03 | Invitation expired | A staff invitation passes its 7 days unused. No expiry event yet | staff · platform | Your invitation to {firm_name} expired | Ask the firm to send a new one. | — | `firm_name`, `inviter_name` | ready-not-wired |
| EX04 | Dependant invite | Staff invite an adult dependant to their own login (portal_invitation.email_requested, role adult_dependant) | adult dependant · firm | {firm_name} opened your own login | Set up your login. You choose what you share. | Set up your login → `Sealed accept link /accept/family?token=…` | `firm_name`, `accept_url (sealed)` | wired |
| EX05 | Document needs another look | Staff reject a document version (outbox document.reviewed, decision not accepted). Currently skipped by prepare_email_delivery | client · firm | A document needs another look | The reason is in your portal. | Open your portal → `/portal/documents` | `firm_name` | ready-not-wired |
| EX06 | Document accepted | Staff accept a document version (outbox document.reviewed, decision accepted, template document_receipt) | client · firm | Your document was accepted | Accepted by {firm_name}, not by the government. | Open your portal → `/portal/documents` | `firm_name` | wired |
| EX06-received | Document received | A document upload passes the file check (outbox document.uploaded, template document_receipt) | client · firm | {firm_name} received your document | It’s in your portal. | Open your portal → `/portal/documents` | `firm_name` | wired |
| EX07 | New message | Staff send a matter message (outbox message.sent, template message), to each person the thread is addressed to. Honours email_notices. Firm name only: never the message text, an attachment name or the matter | client · firm | New message from {firm_name} | For your privacy, read it in your portal. | Read message → `/portal/messages` | `firm_name` | wired |
| EX08 | Payment failed | A card payment fails (Stripe payment_intent.payment_failed moves invoice_payments to failed; outbox invoice.payment_failed, template payment_failed). Honours email_notices | client · firm | Your payment to {firm_name} didn’t go through | You haven’t been charged. You can try again in your portal. | Open payments → `/portal/payments?invoice=<invoice id>` | `firm_name`, `invoice_id`, `invoice_number` | wired (new send) |
| EX09 | Refund started | Billing staff refund a card payment (invoice_refunds row recorded; outbox invoice.refund_started, template refund_started). Honours email_notices | client · firm | {firm_name} started a refund | Refunds usually take 5 to 10 business days to appear. | View payments → `/portal/payments` | `firm_name` | wired (new send) |
| EX10 | Refund complete | Stripe confirms the refund (refund.updated succeeded; outbox invoice.refund_succeeded, template refund_complete). Honours email_notices | client · firm | Your refund from {firm_name} is complete | The details are in your portal. | View payments → `/portal/payments` | `firm_name` | wired (new send) |
| EX11 | Support access requested | Casevoya support asks for access. Support access is not built yet | firm owner · platform | Casevoya support asked for access | Nothing opens unless you approve. | Review request → `/sheet/grants` | `firm_name`, `minutes` | ready-not-wired |
| EX12 | Licence check attention | The register re-check cannot confirm a consultant’s licence. Re-check reminders are not wired to email yet | firm owner · platform | A licence check needs attention | Open Licences in Casevoya to review it. | Open licences → `/sheet/licence` | `firm_name`, `consultant_name` | ready-not-wired |
| EX13 | Privacy request received | A client makes a privacy request. Privacy requests are not built yet | client · firm | {firm_name} received your privacy request | You can follow it in your portal. | Open your portal → `/portal` | `firm_name`, `reply_by` | ready-not-wired |
| EX14 | Complaint received | A client files a complaint. Complaints are not built yet | client · firm | {firm_name} received your complaint | We’ll respond in writing. | — | `firm_name`, `respond_by`, `handler_name` | ready-not-wired |
| EX15 | Message from staff (engineering-built at the owner's request 2026-10-19; copy pending Francis) | Staff reply to a client's email or write a new one from the Sheet Inbox (`send_matter_email`; outbox matter_email.sent, template staff_message), to one person on the matter at their stored address. The staff member's text verbatim; Reply-To the matter reply address; In-Reply-To/References on a reply. Never sent for a sample matter. English only | client · firm | Re: {original subject}, or Message from {firm_name} | Reply to this email to answer {firm_name}. | Open your portal → `/portal` (only with a portal login) | `firm_name`, `sender_name`, `body`, `subject`, `portal` | wired |

A database template the renderer does not know falls back to a neutral firm notice ("An update
from {firm_name}", button to `/portal`) instead of failing the send.

### French (fr-CA)

Every template above except EM14a–c and EX15 (sent as the staff member wrote it), plus the generic notice, has a French draft in
`src/modules/email/designs/fr-drafts.json`, built by a parallel builder (`localized.ts`) that the
tests prove has the same branches, values and links as the English. Drafted 2026-10-18 with
Workers AI `@cf/meta/llama-3.3-70b-instruct-fp8-fast` (prompt `fr-ca-2026-10-18.3`), with the
EM14a–c hand drafts folded in.

**French status of every template: `machine_draft`, no reviewer.** So every recipient, including
one who chose Français, gets the English email today. A template is sent in French only to a
recipient whose language is `fr-CA` and only after its status is `approved` with a named reviewer
and date (and the shared shell strings likewise), with English unchanged since. The current status
per template is the "Status" table of `docs/i18n/email-fr-review.md`; how to approve is in
`docs/i18n/README.md`. The mail worker gets each recipient's language from
`public.email_delivery_locales` (`20261019210000_french_drafts.sql`).

### How each database template maps to a design

| `email_template` | Context | Design |
|---|---|---|
| `invite` | `kind: staff` | EM01 |
| `invite` | `kind: portal`, `role: adult_dependant` | EX04 |
| `invite` | `kind: portal`, any other role | EM02 |
| `reminder` | | EM07 |
| `agreement` | `audience: staff` (agreement.signer_turn) | EM08-staff |
| `agreement` | | EM08 |
| `signature` | `audience: staff` (staff signer) | EM09-staff |
| `signature` | | EM09 |
| `document_request` | | EM06 |
| `document_receipt` | `status: accepted` (document.reviewed) | EX06 |
| `document_receipt` | `status: received` (document.uploaded) | EX06-received |
| `invoice` (new) | | EM10 |
| `payment_failed` (new) | | EX08 |
| `refund_started` (new) | | EX09 |
| `refund_complete` (new) | | EX10 |
| `message` (new) | firm name only | EX07 |
| `staff_message` (new) | `sender`, `portal`; the text, subject and threading headers come with the prepared message, not the context | EX15 |
| `payment_receipt` (hook, no enum value yet) | `receipt_number`, `advance` | EM11 |
| `consultation_booked` (new) | `starts_at` (UTC), `time_zone` (the attendee's), `consultant_name`, `portal` (the attendee's person has a portal login), `location_kind`, `address` (in person only) | EM16a |
| `consultation_rescheduled` (new) | `starts_at`, `time_zone`, `portal` | EM16b |
| `consultation_cancelled` (new) | `starts_at`, `time_zone`, `portal`, `booking_page` (the firm's slug, only without a portal and when the firm has a published page the attendee can use), `cancelled_by` (`client` when the attendee cancelled from their portal, else `staff`; 20261020150200) | EM16c |

### EM11 payment receipt hook

The renderer and copy are done; nothing sends it yet. Receipts are issued in one place,
`app.issue_invoice_payment_receipt` (`20261019150000_invoice_payment_receipts.sql`, numbers
`PR-0001`); client-funds advance receipts are `RC-0001` (`app.issue_client_fund_receipt`). To send:
add `payment_receipt` to `public.email_template` in its own migration; enqueue an outbox event (ids
only, for example `invoice.payment_receipt_issued`) where the receipt is issued; in
`prepare_email_delivery` map that event to `payment_receipt` and queue it to the payer with context
`receipt_number` and, for an advance receipt, `advance: true`, honouring `email_notices`; add the
event type to `claim_mail_events`. Copy both functions from their latest definition
(`20261019170100_email_design_events.sql`). `renderEmail` already maps `payment_receipt` to EM11.

## Supabase Auth emails (EM03, EM04, EX01): deferred, owner action

Supabase Auth sends these, not the mail worker. The approved designs with Supabase's template
variables are in `docs/email/supabase-auth/` (images load from `https://app.casevoya.ca`). They are
not switched on by this change. To use them, paste each into Supabase Dashboard → Authentication →
Email Templates, with the subject shown:

| File | Supabase template | Subject | Notes |
|---|---|---|---|
| `confirm-signup.html` | Confirm signup | Verify your email | Has both `{{ .Token }}` (the app's accept flows verify a 6-digit code with `type: signup`) and `{{ .ConfirmationURL }}`. |
| `magic-link.html` | Magic Link | Your sign-in code | The app's account recovery (`sendRecoveryEmail`) uses `signInWithOtp` and asks for the 6-digit `{{ .Token }}`. The design has no button. `src/app/sign-in/actions.ts` also calls `signInWithOtp` with `emailRedirectTo` (a link): if that path is used, add a `{{ .ConfirmationURL }}` button first. The copy says the code expires in 1 hour, matching the project's Email OTP expiry (3600 s). Live in Supabase since 18 Oct 2026. |
| `reset-password.html` | Reset Password | Reset your password | Only used if the app calls `resetPasswordForEmail`; it does not today. Says 1 hour, matching the project OTP expiry. |

## SMS (EM13): document only

Telnyx is not wired for these. If they are built, keep the firm name and a portal link only (no
case detail), for example:

| ID | Text |
|---|---|
| EM13a | `{firm_name}: a step on your file is due {due_on: 30 Oct}. Open your portal: {portal_url}` |
| EM13b | `Your Casevoya code is {code}. It expires in 10 minutes.` |
| EM13c | `{firm_name}: your consultation is {starts_at: Thu 22 Oct 10:30}. Details: {portal_url}` |

## Decisions for the owner

1. **Image origin.** Images and fonts load from the app origin (`APP_URL`, default
   `https://app.casevoya.ca`), not `casevoya.ca` as in the export, so they deploy with the app.
   `logo.png`/`logo@2x.png` reach `app.casevoya.ca` with the next app deploy.
2. **Document request emails no longer name the document** (the design's body did: "Please upload
   your police clearance certificate"). `prepare_email_delivery` stops copying `purpose` into the
   mail context. The portal shows the request.
3. **Invoice mail recipients** are the matter's applicants; payment-failed and refund mail go to
   the portal user who started the payment while they are still a party, else the applicants.
   A sponsor or other payer is not emailed. All four honour "Email notices". Sample matters are
   emailed like other mail events.
4. **Refund timing copy** ("usually take 5 to 10 business days") is the design's; confirm it.
5. **Payment failed** drops the design's "or pay by bank transfer": bank transfer is not a payment
   option the portal offers.
6. **EX05 (document needs another look)** stays unsent: `prepare_email_delivery` deliberately skips
   reviews that are not accepted (`review_not_accepted`). Removing that skip would wire EX05.
7. **Firm header** is text-only (logo bucket is private). A public, signed-at-send or proxied logo
   URL would be needed to show a firm's logo; the tile colour does not follow `branding.accent`.
8. **French** (decided 2026-10-18): every email has a French draft (see "French (fr-CA)" above);
   none is sent until a named reviewer approves the template in `fr-drafts.json`. A French email
   uses French for the header tagline and footers too (from `_shared`); markup and styles are the
   Designer's.
9. **Staff signers of an executed agreement** now get a staff copy (EM09-staff, Sheet link) instead
   of the client wording.
10. Supabase Auth templates are not switched; see the table above for the expiry settings.
