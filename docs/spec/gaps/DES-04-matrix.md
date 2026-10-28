# DES-04 state matrix

PRD DES-04: every page represents loading, empty, partial, permission-denied, stale-source, failed-payment and failed-upload states, and never fills missing real data with invented results. This file lists each staff (Sheet) page and each portal and public page against those seven states, with what is on screen today.

**Legend**

| Status | Meaning |
|---|---|
| **Built** | Already on main before this change. The cell names the component or copy. |
| **Built now** | Added by the DES-04 change. The cell names the component or copy. |
| **N/A** | The state can't happen on this page. The cell says why. |
| **Gap** | The state can happen and isn't handled yet. The cell says why it wasn't built. |

**States**

| State | What it means |
|---|---|
| loading | The page is on its way. |
| empty | There is nothing to show yet. |
| partial | Some sources failed to load, or a read hit its limit. |
| permission-denied | The person's role can't open the page or tab. |
| stale-source | The page shows official content, and a source is out of date: a rule version or program pack that is `review_due`, past its review date or expired, an official page whose last check failed or was blocked, or a newer reading still waiting for licensed review. |
| failed-payment | The page takes or shows payments. |
| failed-upload | The page uploads files. |

**Reading the cells.** Each cell is short. The section notes say where the shared pieces live.

## Staff pages

Shared pieces (all live-only additions, built from the Designer's System states parts in `src/components/sheet/markup/states.tsx`; words in `src/modules/sheet/states-present.ts`):

- **Loading.** Every `/sheet/*` page is Built:
  - `SheetLoader` (`src/components/sheet/sheet-loader.tsx`) shows on a first load (sign-in, refresh, a typed or emailed link).
  - `SheetNav`'s top progress bar (`sheet-nav.tsx`) shows on a client navigation; the current page stays on screen until the next one is ready.
  - Below, `L` means this Built state.
- **NoAccessPanel** (`designer/state-views.tsx`): the Designer's "No permission" panel. It shows Vo holding a lock, what is missing, who to ask, the person's role, and "See what each role can do" (`/sheet/roles`). It is used whenever a role can't open a page or tab:
  - inside the page's own header when the header has tabs;
  - otherwise through `NoAccessScreen` in `body.tsx`, in the firm's frame.
- **StateAlert** (`designer/state-views.tsx`): the Designer's `.alert` with `.acts`, at the top of the content. Its tones:
  - `warn` with a clock: stale-source;
  - `info`, or `bad` when a read failed: partial;
  - `bad`: failed-payment.
- **Failed upload**:
  - `src/modules/sheet/upload-failure.ts` holds the limits each server already applies, and the messages.
  - `src/components/sheet/upload-failure.ts` shows the Designer's red error line (`.lock`, x-circle) where the file was chosen, with "Choose another file" or "Try again".
  - The browser checks type, emptiness and size before sending. A refusal or dropped upload from the server reads the same way.
- **Stale-source data**: `src/modules/sheet/states-load.ts` reads `rule_versions`, `rule_pack_versions`, `rule_evidence` → `source_snapshots` → `official_sources` (`review_status`, `change_state`, `next_review_at`, and `last_attempt_result`, which the `source_check_attempts` trigger writes). Nothing is fetched from a government site, and nothing is invented.

| Page (route) | loading | empty | partial | permission-denied | stale-source | failed-payment | failed-upload |
|---|---|---|---|---|---|---|---|
| Home (`/sheet`) | Built (L) | Built: "Nothing needs you today" (`designer/home.tsx`); gauge and counts read 0 from real rows | N/A: counts only, each read on its own; no list to cap | N/A: every staff role opens Home; rows are row-level-security scoped | N/A: no official content | N/A: no payments | N/A: no uploads |
| Sample mode (`/sheet/sample-mode`) | Built (L) | Built: Home's empty states plus `SampleCasePanel` steps | N/A: as Home | N/A: every staff role | N/A | N/A | N/A |
| Licence suspended (`/sheet/licence-suspended`) | Built (L) | Built: `SuspendedPanel` from the consultant's own licence check; redirects to Licences when there is no adverse result | N/A | N/A: shown only to the consultant concerned (or the owner) | N/A: shows the firm's recorded register check, not IRCC content | N/A | N/A |
| All matters (`/sheet/matters`) | Built (L) | Built: "No matters yet"; filtered: "No matters match" (`designer/matters.tsx`) | Built: "Matters couldn't load" on a failed read. Gap: the list reads up to `MATTERS_READ` without saying so when capped (not reached by any firm today; left for a later pass) | N/A: every staff role; row-level security scopes the rows | N/A: program shown as a label only | N/A | N/A |
| Matter, Overview, Forms, Documents, Submissions, Tasks and deadlines (`/sheet/matters/[id]`) | Built (L) | Built: `MatterTabEmpty` and each tab's `Empty` (`designer/matter.tsx`) | Built: Messages tab `ChatError` "Nothing was lost. Try again"; Gap: tasks (100) and deadlines (50) reads don't say when capped | Built now: a matter the person can't open shows `NoAccessPanel` "This matter isn't open to you … It may not exist, or you aren't assigned to it" with All matters, not a 404 | Built: the SRC-05 rule pack panel on Overview (`designer/matter-rule-pin.tsx`) badges Review due, Source changed: recheck and No longer live; Built now: `StateAlert` for its pinned program pack and the rule versions its pack and deadlines came from, including review dates passed and failed or blocked page checks (`loadSourceStaleness` matter scope) | N/A: Billing tab below | Built now: Submissions and Decisions (government letter, submission receipt, status evidence; `gov-acts.ts`): wrong type, empty or too large refused with "Choose another file"; a server refusal or dropped upload shows the same line with a retry |
| Matter, Billing tab | Built (L) | Built: "No invoices yet" | N/A: one matter's invoices | Built now: `NoAccessPanel` "You don't have access to Billing on this matter" (the Designer's own example), replacing the empty panel | N/A | Built: an open invoice whose latest card attempt failed or was canceled shows the Payments tab's badge ("Payment failed", "Canceled") and "Card payment failed or declined <date>" before what is still owed (`matterBilling`, `failedPaymentWords`); a processing one shows "Payment processing"; the attempt never counts as paid (fix/des-billing-call) | N/A |
| Matter, People, Agreements, Messages, Closure, Timeline, Audit tabs | Built (L) | Built: each tab's `Empty` | N/A | Built: Audit events are owner-only (`eventsOwnerOnly`); Closure refusal keeps the Designer's plain view (`closure-load.ts`) | N/A | N/A | N/A: Messages attach existing documents (send failure has Retry in `chat.tsx`) |
| Tasks (`/sheet/tasks`) | Built (L) | Built: "No open tasks", "Nothing matches", "This list couldn't load" (`designer/tasks.tsx`) | Built: failed read says so; Gap: capped at `TASKS_READ` without a note | N/A: every staff role reads their tasks; create/edit buttons follow role | N/A | N/A | N/A |
| Team queue (`/sheet/queue`) | Built (L) | Built: "Nothing is waiting", "No active staff", "Nothing matches" | Built: "The queue couldn't load"; Built now: `StateAlert` when tasks, documents to review or deadlines to verify hit 300 | N/A: every staff role; Reassign follows role | N/A | N/A | N/A |
| Documents (`/sheet/documents`) | Built (L) | Built: "No documents waiting", "No originals held" | Built: "More requests exist than this page reads, so the list is partial" (`documents-load.ts`) | Built: review controls follow `REVIEW_ROLES`; the list is row-level-security scoped | N/A: checklist templates come with reviewed packs (none published) | N/A | N/A: staff review uploads; staff file evidence from the matter |
| Inbox (`/sheet/inbox`) | Built (L) | Built: "No conversations yet", "Nothing matches", Email to triage empty | Gap: reads 100 threads without a capped note | N/A: every staff role; send follows role | N/A | N/A | N/A: inbound files are saved from mail, not uploaded |
| Clients (`/sheet/clients`) | Built (L) | Built: "No clients yet", "Clients couldn't load" | Built: failed read; Gap: capped reads not noted | N/A: finance users see no people and aren't offered Add a client | N/A | N/A | N/A |
| Agreements (`/sheet/agreements`, all tabs) | Built (L) | Built: each tab's empty and pick list (`designer/agreements*.tsx`) | Gap: 500-row read not noted when capped | N/A: every staff role reads; send/quote/edit follow role | N/A: firm agreement templates are the firm's own | N/A: quotes are accepted, not paid, here | N/A: signatures are drawn or typed in the signing page |
| Finance, all tabs (`/sheet/finance`) | Built (L) | Built: "No invoices yet", "No card payments yet", "No refunds yet", "No disputes", funds and reconciliation empties | Built now: `StateAlert` when Invoices (500) or Card payments (500) hit their limit, or the payments read failed; Built: "Invoices couldn't load" | Built now: roles other than firm owner and finance user get `NoAccessPanel` "You don't have access to Finance" on every tab, instead of empty tables | Built now (Invoices): `StateAlert` when a newer reading of IRCC's fee list waits for licensed review while the approved one is used (`billing/load.ts`) | Built now (Payments): `StateAlert` naming invoices whose latest card payment Stripe reported failed, declined or canceled, and disputes still taking evidence, with the next step and Open INV-…; Built: row badge "Payment failed"; Refunds tab "Refund … failed" banner and dispute evidence deadlines | Built now: dispute evidence (Refunds, `credit-acts.ts`, PDF/JPEG/PNG under 4.5 MB) and manual-payment evidence (invoice tab, `manual-pay-acts.ts`) |
| Pipeline (`/sheet/pipeline`) | Built (L) | Built: "No leads yet", "No leads match", "No leads here yet." per column | Built: "Leads couldn't load" | N/A: every staff role | N/A | N/A | Built now: Import leads CSV: wrong type, empty or over 2 MB refused in the dialog with "Choose another file" |
| Lead (`/sheet/lead?id=`) | Built (L) | Built: each panel's empty | N/A | Built now: a lead the person can't open shows `NoAccessPanel` "This lead isn't open to you" with Pipeline, not a 404 | N/A | N/A: booking fees are paid on the public booking page (portal and public section) | Built: Vo call notes take .txt/.md only, with "paste the text" as the next step (`vo-crm-acts.ts`) |
| Consultations (`/sheet/consultations`) | Built (L) | Built: "No consultations yet" | N/A | Built: a record that isn't the host's (or the owner's) shows no Join | N/A | N/A: booking payments show on the public booking page | N/A |
| Calendar (`/sheet/calendar`) | Built (L) | Built: "No deadlines this week", "No upcoming deadlines" | N/A | N/A: every staff role | N/A: dates are the matter's recorded deadlines | N/A | N/A |
| Notifications (`/sheet/notifications`) | Built (L) | Built: "You're all caught up", "No mentions", "Nothing from the system" | Built: count reads 0 when it can't be read (chrome) | N/A: own notifications | N/A | N/A | N/A |
| Government status (`/sheet/government`) | Built (L) | Built: "No submissions or letters recorded yet" | Built: "This list couldn't load" row | Built now: a matter view the person can't open shows `NoAccessPanel` with Government status, not a 404 | Built now: `StateAlert` when a newer IRCC processing-time estimate waits for licensed review while the approved one shows; Built: "Waiting for licensed review" row; the Designer's "Record a check" stale state for status checks | N/A | Built now: Upload confirmation and status evidence (`gov-acts.ts`) |
| Reports (`/sheet/reports`) | Built (L) | Built: each tab's empties, definitions and freshness | Built: "Some sources passed the read limit, so these figures are partial" (`reports-load.ts`); Built now: "These figures couldn't load" instead of a denied panel when an allowed tab has no figures | Built now: the role-gated tabs (`DENIED` in `reports-load.ts`) render through `NoAccessPanel` | N/A: estimates are the approved ones only | N/A: money figures only | N/A |
| Exports (`/sheet/exports`) | Built (L) | Built: "No exports yet" | Built now: `StateAlert` when the history read failed or hit 50 | Built: New export disabled for roles outside `EXPORT_ROLES`; downloads only for the requester or the owner | N/A | N/A | N/A |
| Privacy requests (`/sheet/privacy`) | Built (L) | Built: "No privacy requests" | N/A | Built now: `NoAccessPanel` "You don't have access to Privacy requests" (it previously used an empty panel) | Built: legal time limits are the firm's own until a licensed member approves an official page | N/A | N/A |
| Complaints (`/sheet/complaints`) | Built (L) | Built: "No complaints recorded" | N/A | Built now: `NoAccessPanel` "You don't have access to Complaints" | N/A | N/A | N/A |
| Migration import (`/sheet/migration`) | Built (L) | Built: "No import in progress", "Row errors" empties | Built: preview and error rows show their counts | Built now: non-owners get `NoAccessPanel` "You don't have access to Migration import" | N/A | N/A | Built now: CSV (5 MB) and ZIP (25 MB) checked before sending; a server refusal shows in place with "Choose another file" or "Try again" (`migration-acts.ts`) |
| Vo drafts (`/sheet/drafts`) | Built (L) | Built: "No drafts waiting for you.", "Nothing to review" | N/A | N/A: every staff role; approvals follow role | Built: a draft whose matter changed is "Out of date" and can't be accepted as is (`vo-present.ts`) | N/A | N/A |
| Vo and AI (`/sheet/ai`, all tabs) | Built (L) | Built: each tab's empty | N/A | Built: settings edits are owner-only | Built (Sources): a source row is "Stale · Vo won't cite" or "Check failed" from `official_sources` | N/A | N/A |
| Templates, Program templates, Source review, Rule (`/sheet/templates`) | Built (L) | Built: "No program templates yet", "No rules to review", "No rule chosen" | Built now: `StateAlert` when program templates, rule versions, rule evidence or agreement templates failed or hit 200 | N/A: every staff role reads; Add claim and review follow role | Built now: `StateAlert` listing stale rule versions, packs and official pages (firm scope; one rule on the Rule tab); Built: Review required and Overdue in the register; Built now (#188): the Live official claims list and a claim's detail badge "Overdue for a re-check, last checked <date>" from the claim's source (`app.firm_rule_claim` stale), and "Source changed since your edit" on a firm edit whose official version was re-captured | N/A | N/A |
| Templates, What Casevoya supports (`?tab=support`) | Built (L) | Built: "No programs are catalogued yet" and the other tables' empties (`designer/support-catalogue.tsx`) | Built: "The catalogue couldn't be read just now" | N/A: every staff role reads it | Built now: `StateAlert` (firm scope) above the catalogue; Built: unsupported programs say "No approved, sourced rule pack" | N/A | N/A |
| Templates, Message templates and Checklists tabs | Built (L) | Built: "No checklist templates yet" (none published) | Built now: as above | N/A | N/A: the email catalog and firm messages aren't official content | N/A | N/A |
| Intake builder (`/sheet/intake-builder`) | Built (L) | Built: with no form, the builder opens empty and ready for a first field (`builderPage` in `intake-builder-present.ts`) | N/A | Built: editing follows role | N/A | N/A | N/A: the file field is shown disabled in preview |
| Automations (`/sheet/automations`) | Built (L) | Built: "No reminders yet" | N/A | Built: owner-only editing (`editable`) | N/A | N/A | N/A |
| Access grants (`/sheet/grants`) | Built (L) | Built: "No grants yet", "No support access" (for the owner) | N/A | Built now: non-owners get `NoAccessPanel` on Access grants and Support access (previously the same empty lists); Office and team limits stays open | N/A | N/A | N/A |
| Licences (`/sheet/licence`) | Built (L) | Built: "Nothing logged yet" | N/A | Built: register checks are recorded by the owner | N/A: the CICC register is checked by a person and recorded | N/A | N/A: licence proof uploads are on the licence card (`port/licence-proof-card.tsx`), with its own refusals |
| Roles (`/sheet/roles`) | Built (L) | N/A: a fixed table of what the server enforces | N/A | N/A: every staff role may read it | N/A | N/A | N/A |
| People and invitations (`/sheet/invitations`, Staff and Clients tabs) | Built (L) | Built: "No one to show yet", "No portal invitations yet" | Gap: 200-row reads not noted when capped | Built: invite and revoke follow role | N/A | N/A | N/A |
| Settings, Firm, Offices, Branding, Language (`/sheet/settings`) | Built (L) | N/A: forms with the firm's values | N/A | Built: edits owner-only (`owner`) | N/A | N/A | Built now: logo (Branding): PNG or JPG under 2 MB checked first; a refusal shows in the dialog with "Choose another file" |
| Settings, Client portal, Integrations, Notifications, Service notices, Team, Security | Built (L) | Built: "No notices yet", "No one to show yet", connection states | Built: "Service notices couldn't be read just now" | Built: owner-only actions | N/A | N/A | N/A |
| Settings, Subscription (`?tab=billing`) | Built (L) | Built: plan and usage from stored rows | N/A | Built now: roles other than firm owner and finance user get `NoAccessPanel` "You don't have access to Subscription" | N/A | Gap: Casevoya's own subscription payments are Stripe Billing in its portal, not shown here | N/A |
| Settings, Retention (`?tab=retention`) | Built (L) | Built: retention period and holds | N/A | Built: deletion panels owner-only (`loadRetentionDeletion`) | N/A | N/A | N/A |
| `/sheet/states`, `/sheet/404` | N/A | N/A: the Designer's reference gallery answers 404 by design | N/A | N/A | N/A | N/A | N/A |

**Gaps left on staff pages.** Each needs its own pass:

- **Silent read caps.**
  - The list pages below read up to a fixed number of rows and don't say when they hit it:
    - All matters, Tasks, Inbox, Clients, Agreements, invitations;
    - a matter's tasks and deadlines.
  - The pattern to copy is `partialAlert` with each read's `{ count, cap, failed }`, as Finance, Templates, Exports and the Team queue now do.
  - These weren't built here because those reads' caps (100 to 5,000) are far above any firm's current volume, and each loader would need its own count.
- **Settings › Subscription.** Casevoya's own Stripe Billing failures are handled in Stripe's customer portal; nothing on this page shows them.

**Official content still to capture.** None was needed for these states, and none was seeded.

- The stale-source banner reads only what reviewers recorded.
- Content that still comes from `www.canada.ca` (unreachable from the build machine on 2026-10-25) is listed in the SRC-01 decision row.

## Portal and public pages

DES-04 audit of the client portal (`/portal/*`) and the public pages, checked on branch `feat/des-states-portal` (from `main` at 07c054b). Statuses: **Built** (already there, with the component or copy), **Built now** (added on this branch), **N/A** (the state can't happen on that page, with why), **Gap** (not built, with why). Paths are under `src/`. The portal's shared states:

* Loading: `PortalLoading` (`components/portal/live.tsx`, the Suspense fallback of `app/portal/[[...slug]]/page.tsx`, from #173): a skeleton, never "No portal yet".
* Couldn't load (new): `PortalUnavailable` (`components/portal/states.tsx`). A page's loader now throws when its main query fails (`modules/documents/load.ts`, `finance/portal-load.ts`, `agreements/load.ts`, `scheduling/portal-load.ts`, `portal/tasks-load.ts`), and the page says "Your … couldn’t be shown just now. Nothing was lost, and nothing here means there are none" with Try again. Before, a failed read showed "Nothing to pay" or "No documents requested yet".
* Partial (new): `PartialNotice` (`components/portal/states.tsx`), named parts from `modules/portal/states.ts` (`PortalPart`).
* Permission-denied (new): `PortalDenied` (whole page) and `DeniedNotice` (banner), resolved by `deniedFor` (`modules/portal/states.ts`). Row-level security decides what a person reads; the words are the same whether the record exists or not.
* Failed upload (new): `checkUploadFile` / `uploadFailure` (`modules/portal/upload-failure.ts`), shown by `UploadFailed` (`components/portal/upload-failed.tsx`).
* Failed payment (new): `payFailure` (`modules/portal/pay-failure.ts`), shown by `PayFailed` (`components/portal/pay-live.tsx`). Stripe test mode only.
* Stale-source (new): `renewalStaleReasons` (`modules/renewals/present.ts`) on Home's renewal reminders; migration `20261025451000`.

### Client portal

| Page | Loading | Empty | Partial | Permission-denied | Stale-source | Failed-payment | Failed-upload |
|---|---|---|---|---|---|---|---|
| `/portal` (Home) | Built: `PortalLoading` | Built: calm hero and empty panels (`emptyHome`, "Nothing accepted yet", "No messages yet", "Nothing to pay") | Built now: `loadPortalHome` names tasks, documents, payments, messages, consultant, updates from your firm, renewal reminders and decision documents that didn't load (`HomeView.unavailable`); `PartialNotice` at the top and "… couldn’t be shown just now" where each part would be. Before, a failed part showed as empty | Built now: `?matter=` naming a matter that isn't theirs shows `DeniedNotice` ("That matter isn’t on your file"); before, it was silently ignored | Built now: a renewal reminder's IRCC timing or fee shows "May be out of date" with the reason (timing retired, official page suspended or due for review, change detected, last check failed, checked or retrieved over a year ago) | N/A: no payment taken here (the Pay link goes to `/portal/pay`) | N/A: no upload here |
| `/portal/matters` | Built | Built: "No matters yet" | Built now: tasks or consultant that didn't load (`loadPortalMatters` → `unavailable`, `PartialNotice`); before, cards silently lacked them | Built now: `?matter=` not theirs, banner | N/A: no official content | N/A | N/A |
| `/portal/tasks` | Built | Built: "You’re all caught up" (`tasks-live.tsx`) | N/A: one source | N/A: only the person's own tasks are listed (RLS); no record id in the address | N/A | N/A | N/A |
| `/portal/tasks` (couldn't load) | | Built now: `PortalUnavailable` "Your tasks couldn’t be shown just now"; before, a Stub titled "No tasks yet" | | | | | |
| `/portal/documents` | Built | Built: "No documents requested yet", "Nothing needs you", "Nothing accepted yet" (`documents-live.tsx`) | Built now: review notes (the firm's "Changes needed" reasons) that didn't load (`PortalDocuments.unavailable`) | N/A: RLS lists only the person's own and shared documents; downloads refused by `authorize_document_download` show its message | N/A: requests show the firm's words; a rule-linked request shows no official text to the client | N/A | Built: quarantined and checking labels on cards |
| `/portal/upload` | Built | Built: "Nothing to upload" | N/A: one source | N/A: only open requests for the person | N/A | N/A | Built now: wrong type (checked against the request's own formats before sending), too large (the firm's limit), the file check (quarantined: "We couldn’t accept this file"; check failed), an expired upload link (a new one is made on retry), the connection dropping (caught, not a stuck page). Each with "Choose another file" or "Try again" and "Ask your firm". Before: one line, no type check before sending, a thrown network error left the page on "Sending" |
| `/portal/messages` | Built | Built: "No messages yet" (`components/messages/chat.tsx`) | Built: `ChatError` "Messages didn’t load … Try again" | Built now: `?thread=` naming a conversation that isn't theirs shows `DeniedNotice`; before, their first thread opened silently | N/A | N/A | N/A: a client attaches documents already uploaded; no file upload in Messages |
| `/portal/appointments` | Built | Built: empty panels (`appointments-live.tsx`) | Built now: consultation summaries or change rules that didn't load (`PortalAppointments.unavailable`) | N/A: RLS lists only their bookings; `/call/<ref>` refuses others (`CallScreen` kind `refused`) | N/A | N/A: booking types with a price are not offered (paid booking isn't built) | N/A |
| `/portal/agreements` | Built | Built: "No agreements yet" | N/A: the main reads are one set; a failed one now shows `PortalUnavailable` | N/A: RLS; no record id in the address | N/A: the government fee note is the firm's own words, not official content | N/A: no payment here | N/A |
| `/portal/payments` | Built | Built: "Nothing to pay" | Built now: payment status (processing or pending verification), receipts, credit notes, client account (`PortalInvoices.unavailable`) | N/A: RLS lists only invoices on their matters | N/A: "Government fees are not on this invoice"; no IRCC value shown | N/A: links to `/portal/pay`; a processing payment shows Processing | N/A |
| `/portal/pay` | Built | Built: "Choose an invoice" without `?invoice=`; paid or closed: "This invoice is paid/closed" | Built now: same parts as Payments | Built now: `?invoice=` that isn't theirs shows `PortalDenied` "This invoice isn’t available to you … Nothing was charged"; before, "Choose an invoice" | N/A | Built now: the Designer's declined message for declined (4000 0000 0000 0002), insufficient funds (4000 0000 0000 9995), expired card (4000 0000 0000 0069), wrong CVC or number, the bank's check failed (3-D Secure, including `?redirect_status=failed`) and processing errors; each says nothing was charged and the next step (another card, or ask the firm for bank-transfer details). "The payment couldn’t start" now has Try again and "ask … another way to pay". Built already: card payments not configured, advance (trust) not payable by card, manual payment pending verification | N/A |
| `/portal/receipt` | Built | Built: "Receipt not found" without `?id=` | N/A: one read | Built now: `?id=` that isn't theirs (or can't be read) shows `PortalDenied` "This receipt isn’t available to you"; before, "Receipt not found" | N/A | N/A | N/A |
| `/portal/intake`, `/portal/correction` | Built | Built: forms list empty states (`intake-live.tsx`); `Sections` "Your forms couldn’t be shown just now" when unreadable | N/A | Built now: `?response=` naming a form that isn't theirs shows `DeniedNotice`; before, silently ignored | N/A: questions are the firm's form | N/A | Built now: a file answer or correction proof goes through `uploadOwnFile` (`components/portal/own-upload.ts`) with the same type and size check and named failures, shown on the field; a thrown network error is caught |
| `/portal/family`, `/portal/guardian` | Built | Built: "No people yet", "No guardian grants" | N/A: from the portal access read | N/A: RLS shows only shared sections and grants | N/A | N/A | N/A |
| `/portal/account` | Built | Built: "No person record" | N/A | N/A: only their own record | N/A | N/A | N/A |
| No portal access | Built | Built: `EmptyPortal` "No portal yet … This account isn’t linked to a client file" | | Built: signed-out redirects to sign-in; persona and unknown pages 404 | | | |

### Public pages

| Page | Loading | Empty | Partial | Permission-denied | Stale-source | Failed-payment | Failed-upload |
|---|---|---|---|---|---|---|---|
| `/book/[firm]` | Built: `QuietSheet` "Loading…" | Built: "No booking pages yet" | N/A: one read | N/A: public | N/A | N/A: no payment | N/A |
| `/book/[firm]` (couldn't load) | | Built now: "Booking isn’t available right now … Nothing was booked. Try again in a moment."; before, an error read as "No booking pages yet" | | | | | |
| `/book/[firm]/[event]` | Built: "Loading times…" | Built: "No times are open in the next four weeks" (`book-live.tsx`); unpublished: "This booking page isn’t available" | Built: "Times couldn’t be loaded" with a retry hint (`book-live.tsx`) | N/A: public; a practice page answers "not available" to anyone but the firm's staff | N/A | N/A: an event with a price shows "not available" (paid booking isn't built) | N/A |
| `/book/[firm]/[event]` (couldn't load) | | Built now: "Booking isn’t available right now"; before, "hasn’t published … or out of date" | | | | | |
| `/book` | Built | Designer demo only | N/A | N/A | N/A | N/A | N/A |
| `/enquiry/[firm]`, `/embed/enquiry/[firm]` | Built: "Loading…" (embed: transparent) | Built: closed form ("… isn’t taking enquiries", `ENQUIRY_CLOSED_COPY`); unknown firm 404s in `proxy.ts` | Built now: "This form isn’t available right now … Nothing was sent" when the firm's details couldn't be read (`loadEnquiryPage` → `"unavailable"`); before, it read as "hasn’t turned on its enquiry form" | N/A: public | N/A | N/A | N/A: the enquiry form takes no files |
| `/enquiry` | Built | `QuietSheet` | N/A | N/A | N/A | N/A | N/A |
| `/invite/[token]`, `/accept/staff` | Built: markup without the invitation's details | N/A | N/A | Built: expired or used invitation alerts (`data-show`, `components/port/wire.ts`) | N/A | N/A | N/A |
| `/accept/client`, `/accept/family`, `/accept/sponsor` | Built | N/A | N/A | Built: "This invitation can no longer be used" (`wire.ts`, `portalError`), "Too many tries. Please wait a few minutes and try again." (rate limit, `portalPreviewProblem`) | N/A | N/A | N/A |
| `/sign-in`, `/mfa`, `/recovery` | Built: Port screens and the `/mfa` Suspense fallback | N/A | N/A | Built: wrong password, unconfirmed email, locked ("Too many attempts. Wait and try again."), code errors (`app/auth/port-actions.ts`, `components/port/wire.ts`) | N/A | N/A | N/A |
| `/consultation/[ref]/agreement` | Built: `AgreementSignLoading` | N/A | N/A | Built: `AgreementSignError` | N/A | N/A | N/A |
| `/privacy/[firm]` | Built: "Loading…" | Built: `QuietSheet` when no published notice | N/A | N/A | N/A: the firm's own notice | N/A | N/A |
| `/booking/[ref]?t=` (Manage your booking, CRM-03, #197) | Built: `QuietSheet` "Loading…" (Suspense fallback); "Loading times…" while Change the time reads free times | Built: "No other times are free in the next four weeks. Contact the firm to find one." | N/A: one read | Built: a wrong, replaced or expired link shows "This link doesn’t work any more" (`MANAGE_GONE_COPY`); a cancelled or past booking says it can’t be changed here | N/A: no official content | N/A: booking types with a price are not offered | N/A |
| `/booking/[ref]?t=` (couldn't load) | | Built now: "Your booking isn’t available right now … Nothing was changed. Try again in a moment." (`loadManageView` → `unavailable`); a failed read no longer says the link stopped working | | | | | |
| `/call/[ref]` | Built: `CallLoading` (`components/video/call-loading.tsx`), the Suspense fallback: the call's card with `.sk` placeholders and "Opening the call…" for screen readers; before, a blank page (fix/des-billing-call) | N/A | N/A | Built: `CallScreen` kind `refused` | N/A | N/A | N/A |
| `/call/[ref]?t=` (guest from the Manage link, CRM-03, #198) | Built: the same `CallLoading` fallback | N/A | N/A | Built now: a wrong, replaced or expired link shows `CallScreen` kind `refused` with "This link doesn’t open the call … from the firm’s latest email" (`guestCallProblem(403)`), not "Sign in"; too many tries: "Too many tries" | N/A | N/A | N/A |
| `/call/[ref]?t=` (couldn't load) | | Built now: "The call isn’t available right now … Nothing was changed. Try again in a moment." (`guestCallProblem(500)`) | | | | | |
| `/supported` (SRC-12, merged in #241) | Built: `QuietSheet` "Loading…" | Built: "No programs are listed yet. A program is supported once Casevoya has live official claims for its forms or checklists."; couldn't load: "The catalogue couldn’t be read just now. Try again in a moment." | N/A: one read | N/A: public | Built now (#188, `20261025600100`): "Supported" needs live official claims for the program's forms or checklists (or a live rule pack); when one of those claims' official pages is overdue for a re-check (7, 14 or 30 days by kind, `source.recheck_interval.*`), the program says "May be out of date: an official page behind it is due for a re-check (oldest last check <date>)" (`public.support_catalogue` returns `stale` and `last_checked_at`); the staff page also lists the firm's edit stamps. IRCC's program name and link still show only from a verified snapshot | N/A | N/A |

Content still to capture for stale-source on client pages: none on this branch. The only official content clients see is a renewal reminder's IRCC timing and fee (DEC-02); its values come from the firm's own approved entries, nothing is seeded, and no IRCC value was added here.
