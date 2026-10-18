# French (fr-CA) in Casevoya

French is offered to clients because of Quebec's Charter of the French language as amended by
Bill 96 (the owner's reason, 2026-10-18; this file is not a legal analysis of what the Charter
requires). The project's own rules bind how: **machine translation is a draft and never becomes an
official-language publication** (`docs/spec/RULES.md` §5), and **translated professional templates
require separate review** (`docs/spec/PRD.md` §6). So nothing machine-translated reaches a client
unless a named person approved it.

There are two features:

1. **French emails**: every email design has a French draft; a French email is sent only after a
   named reviewer approves that template in the repository.
2. **"Draft in French"** for client-facing text staff write (today: the document review reason the
   client sees as "Why changes are needed"): a machine draft the staff member must check and edit
   before saving.

Model: `@cf/meta/llama-3.3-70b-instruct-fp8-fast` on Workers AI (comparison:
`docs/i18n/workers-ai-model-choice.md`). Prompt: `src/modules/i18n/fr-ca.json` (versioned).

## Where a person's language is stored

`person_contact_preferences.locale` (`en-CA` default, or `fr-CA`), chosen when the client accepts
the portal invitation and changed on the portal **Your account → Language** (English / Français).
Staff recipients fall back to `profiles.preferred_locale`. The mail worker reads it per delivery
with `public.email_delivery_locales` (migration `20261019200000_french_drafts.sql`).

## French emails

| What | Where |
|---|---|
| English source strings, with `{placeholders}` (one table, mirrors `catalog.ts`) | `src/modules/email/designs/i18n-source.json` |
| French drafts, status, reviewer, model, English hash | `src/modules/email/designs/fr-drafts.json` |
| Parallel builders (same branches as English, strings from the table) | `src/modules/email/designs/localized.ts` |
| The sending gate | `src/modules/email/designs/french.ts` |
| Drafting script | `scripts/i18n/draft-email-fr.mjs` |
| Review package for the translator | `docs/i18n/email-fr-review.md`, previews `docs/email/previews/fr/*.html` |
| Tests | `tests/email-french.test.ts`, `tests/email-fr-review.test.ts` |

`tests/email-french.test.ts` proves `buildLocalized(id, "en", …)` is identical to the approved
English builder for every template and branch, so the French builder of a template has exactly the
English branches, merge values, links and escaping. Dates and times in French are written by code
(`format.ts`: `6 novembre 2026`, `1er mai 2026`, `jeudi 22 octobre 2026 à 10 h 30`, `heure de
Toronto`) in the same time zone as English. The email shell (header tagline, footers) takes its
French from `_shared`; the Designer's markup and styles are unchanged.

### The gate

A delivery is rendered in French only when **all** of these hold (otherwise the English email):

1. the recipient's locale is `fr-CA`;
2. the template's entry in `fr-drafts.json` has `"status": "approved"`, a `"reviewer"` (name, and
   credential if any) and `"reviewedOn"` (`YYYY-MM-DD`);
3. `_shared` is approved the same way (its strings appear in every French email);
4. every string's `en` still equals the current English in `i18n-source.json` (not stale);
5. every French string carries exactly the English string's placeholders.

Every committed draft is `machine_draft`, so **production sends English to everyone today**
(tested).

### How to approve a template (the reviewer's sign-off is a reviewed change, on purpose)

1. Give the translator `docs/i18n/email-fr-review.md` and the previews in `docs/email/previews/fr/`.
2. Put their corrected French into `fr-drafts.json` under each string's `"fr"`, and set that
   string's `"origin"` to `"reviewer"` when they rewrote it. Keep every `{placeholder}`.
3. Set, for the template (and for `_shared` the first time):
   ```json
   "status": "approved",
   "reviewer": "Full name, OTTIAQ certified translator (member no. …)",
   "reviewedOn": "2026-11-02"
   ```
4. Run `pnpm email:previews` (regenerates the review package and previews) and `pnpm test`.
5. Open a pull request titled like "Approve French: EM06, EM07"; the approving reviewer's name is in
   the diff and the merge is the audit record. The coding agent never sets `approved`.

To withdraw an approval, set `"status"` back to `"in_review"` (or `"rejected"`).

### When the English changes (stale drafts)

Each template stores `sourceHash`, the SHA-256 of its English strings. If someone edits English in
`catalog.ts`, the parity test fails until `i18n-source.json` is updated to match; then
`tests/email-french.test.ts` ("every draft matches the current English source") fails until the
French is re-drafted:

```sh
node scripts/i18n/draft-email-fr.mjs --check   # no network: lists stale templates, exits 1
CLOUDFLARE_API_TOKEN=… node scripts/i18n/draft-email-fr.mjs   # re-drafts only what changed
```

A re-draft resets that template to `machine_draft` with no reviewer. Independently, the runtime
gate refuses a template whose stored English differs from the current English. Unchanged
templates keep their status. The script reads `CLOUDFLARE_API_TOKEN` (a token with Workers AI
access) and `CLOUDFLARE_ACCOUNT_ID` (defaults to the account in `wrangler.jsonc`) and prints
neither. It applies the deterministic OQLF typography pass (`src/modules/i18n/typography.ts`), keeps a
translation memory so identical English gets identical French, and keeps the hand drafts
(the earlier EM14a–c French, the role phrases, the zone label).

EM14a–c in the catalog are now previews of EM02/EM06/EM07's French drafts; they are not separate
sends.

## "Draft in French" (staff free text)

- **Field:** the review reason staff write when a document needs changes (portal Documents page,
  firm review form). It is the only free text staff write that the client sees today (request
  explanations are not shown to clients; OPS-04 messages are not built). The client sees it in
  the "Why changes are needed" alert.
- **UI:** "Draft in French" fills a French field from the English reason; after a machine draft it
  shows "Machine draft: check before sending" and a required "I checked this French" box. Staff
  may also type French themselves. Existing classes only; documented in
  `tests/designer-fidelity.test.tsx` as a live-only addition.
- **Storage:** `document_review_translations` (append-only) with `machine_drafted`, `model`, and
  `created_by`, the staff member who reviewed and saved it; audit event
  `document.review_translated` (languages, machine_drafted, model, reviewed_by; never the text).
- **Display:** a client whose language is `fr-CA` sees the French when it exists, otherwise the
  English (`src/modules/i18n/display.ts`).
- **Guards:** `draftInFrench` (`src/modules/i18n/actions.ts`) calls
  `public.consume_translation_draft` first: active firm owner, licensed consultant or case
  manager of that firm with staff MFA, **20 drafts an hour and 100 a day per person per firm**,
  max 4000 characters, empty refused; audited `i18n.draft_requested` with the length only. Saving
  the review still needs the usual step-up code. The text is never logged or stored by the draft
  call.
- **Runtime:** the Worker's Workers AI binding (`wrangler.jsonc`: `"ai": { "binding": "AI" }`),
  read with `getCloudflareContext()` from `@opennextjs/cloudflare`. **Outside the Worker** (`next
  dev`, `next start`, tests) there is no binding and the button says the feature is unavailable;
  staff can still type French. There is deliberately **no REST fallback**, so no Cloudflare API
  token sits in the app's environment. Tests mock the binding.
- Deploying needs nothing beyond the normal `pnpm deploy:app` (the binding is in `wrangler.jsonc`),
  and the migration applied first.
