# Casevoya Project Memory

Version 1.1 · 14 October 2026 · Durable project context, not runtime storage for client records.

## Current state

The project is at specification and developer-handoff stage. Six Markdown documents have been authored. No application, database, provider account, government connection, deployed environment, production source pack, or professional approval is established by this package. Task status belongs in TASKS.md; do not infer implementation from the detail of the specifications.

## Confirmed user instructions

1. Build toward an end-to-end platform for licensed immigration consultants and their clients: intake, client management, documents, payments, case progression, and outcome.
2. The founder acts as the software provider; the consultancy supplies professional immigration services.
3. Produce a full PRD, proposed names, and the six files shown in the user's screenshot: PRD.md, ARCHITECTURE.md, RULES.md, DESIGN.md, TASKS.md, MEMORY.md.
4. Use https://styles.refero.design/style/2bf4c61f-de10-4614-ba1b-20c0453bd2a9 as the design reference.
5. Ground immigration-specific work in official immigration websites. RULES.md operationalizes this with exact evidence, applicability, versioning, review and release gates.

“Until approved” expresses the desired client journey, not a guarantee. The specification also handles refusal, withdrawal, requests for further information, reopening, renewals and closure.

## Proposed defaults — not confirmed facts

| Topic | Current proposal | Confirmation needed |
| --- | --- | --- |
| Working brand | Casevoya; alternatives Dossivana and Retainivo | Trademark, business-name, domain and linguistic clearance. No name is guaranteed available. |
| First market | Canadian licensed immigration consultancies, initially 1–20 staff | Country/province, first programs and pilot firms. |
| Product model | Multi-tenant B2B2C SaaS; firm pays, client uses invited portal | Buyer interviews, contracts and packaging validation. |
| Stack | TypeScript modular monolith, React/Next.js, PostgreSQL, private object storage, durable workers | Current supported versions, team experience, provider capabilities and residency. |
| Data location | Prefer Canadian hosting for initial market | Full processor/subprocessor review; location alone does not establish compliance. |
| Payments | Approved processor with consultancy beneficiary accounts and separate platform billing | Provider flow, legal/accounting review, client-fund treatment and reconciliation. |
| Government submission | Authorized professional uses the appropriate official channel; platform records handoff/evidence | Any later integration requires actual permission, current documentation and technical access. |
| AI | Optional evidence-based extraction/drafts, human review | Provider terms, data handling, evaluations and firm choice. |
| Pricing and timeline | PRD planning hypotheses | Willingness to pay, implementation estimates, team and launch scope. |

## Decisions recorded in this package

**DEC-001 — Professional responsibility.** Software coordinates work and records. Licensed professionals remain responsible for advice, representation and review; authorities decide outcomes. Do not market the software as a government representative or approval engine.

**DEC-002 — Source grounding is mandatory.** Every real immigration requirement must have exact official evidence and reviewed applicability. A generic IRCC link, model answer, competitor checklist, or client assertion is insufficient authority. Product choices and personal facts use their own appropriate evidence types.

**DEC-003 — Approved, versioned rule packs.** Store source snapshots, claim evidence and qualified review. Pin matter/package versions. Detect source changes, assess impact, and publish only after review; do not silently rewrite existing matters. **Exception (Francis, 2026-10-25):** a claim Casevoya captured from an official page (URL and section, page hash, retrieval time, printed dates) goes live when the operator's loader loads it; each firm's licensed members may edit their own firm's wording only (fresh step-up each time, stamped, kept); a changed re-capture goes live and flags firm edits; overdue sources stay blocked for Vo's fees and advice. Firm-entered claims, shared templates, package release approvals and the named content reviewer keep licensed review.

**DEC-004 — Narrow launch scope, complete journey.** First launch may support one reviewed program and a small pilot, while still covering intake through decision. Unsupported programs cannot silently reuse another pack. Scope details await T001.

**DEC-005 — Design reference supersedes original palette.** The supplied Refero page identifies a Notion-inspired style. DESIGN.md uses warm off-white, white panels, near-black text, blue actions, thin borders, rounded cards and restrained motion. This replaces the earlier navy/teal suggestion. Dashboard and portal layouts are original product adaptations. Do not copy proprietary fonts, illustrations or marks.

**DEC-006 — Separate access domains.** Firm membership does not confer every matter permission. Household relationship does not confer access to all adult relatives' data. Platform support uses bounded access, not standing document browsing.

**DEC-007 — Financial truth is independent.** Payment, ledger allocation, service delivery, package readiness, submission and immigration approval are distinct facts with separate evidence. A paid invoice never advances a case to approved. Client-money handling needs explicit review.

**DEC-008 — Manual handoff before assumed integration.** No government API, automatic portal access, polling or credential storage is assumed. Record authorized submission and correspondence evidence; describe manual updates honestly.

**DEC-009 — Documentation is not certification.** The source register is a directory plus research history. It does not approve production rules. Source age, jurisdiction, exact provisions and applicability must be reviewed for each implemented claim.

## Document map and conflict handling

| File | Owns |
| --- | --- |
| [RULES.md](RULES.md) | Mandatory grounding, evidence standard, review/publication process, engineering behavior. |
| [MEMORY.md](MEMORY.md) | Confirmed intent, assumptions, decisions and handoff state. |
| [PRD.md](PRD.md) | Product scope, roles, journeys, acceptance requirements, commercial hypotheses. |
| [ARCHITECTURE.md](ARCHITECTURE.md) | System boundaries, data model, authorization, jobs, integrations and operational design. |
| [DESIGN.md](DESIGN.md) | Tokens, typography, layouts, component behavior, accessibility and reference interpretation. |
| [TASKS.md](TASKS.md) | Ordered implementation work, dependencies, ownership and release gates. |

Read in the table's order. If documents conflict, do not silently select the easier interpretation. Confirmed user instructions and mandatory evidence/security boundaries govern; record a resolution and update affected documents together. DESIGN.md owns detailed visual tokens; PRD owns product scope. New facts can revise a proposal, but cannot erase recorded evidence or falsely claim an approval.

## Research context

Research and reference review are recorded as of 14 October 2026. RULES.md contains official entry points for IRCC programs, forms, fees, processing-time tools, instructions, federal legislation, CICC and applicable privacy authorities. PRD section 28 retains the initial S-series research sources. These identifiers are separate namespaces; never assume O01 means S1.

The Refero page was read as a style reference, not as a regulatory source. The initial name screen found no obvious exact commercial collision for shortlisted candidates, but did not establish domain or trademark availability. No name was registered or purchased.

## Open decisions and immediate next work

- T001: Confirm jurisdiction, initial programs, pilot firms and qualified review owner.
- T002: Clear a final brand before buying domains or publishing marketing under it.
- T003: Review professional service, signature, privacy, retention and client-money requirements for the selected scope.
- T004: Validate navigation and daily workflows with consultants and clients.
- T005–T010: Begin generic engineering foundations and design components using synthetic data; do not wait for legal content to build isolation and auditability.
- T011–T017: Build official-source governance before shipping real program-specific logic. T014 cannot be marked complete by an AI or by documentation alone.

No blocking question is needed to use this specification as a planning baseline. These open decisions are release/implementation inputs, not permission to invent their answers.

## Continuation instructions for a developer or coding agent

Start by reading the six documents. Report the actual repository state before proposing an implementation task; there is no app implied by this handoff. Select the earliest unblocked task, inspect current official vendor documentation for technical integrations, and follow RULES.md for all immigration content. Implement a reviewable increment with necessary verification, then record evidence and remaining limitations. Do not announce integration, legal approval, deployment, or test success unless it occurred.

If source evidence is unavailable or conflicts, preserve the unresolved condition, block the affected regulated behavior, and continue unrelated work. Do not populate a real client checklist from general knowledge. If a source changes, preserve the historical snapshot and queue impact review. If the user changes jurisdiction or design direction, update PRD, architecture, design, tasks and memory consistently.

## Memory maintenance protocol

After a material decision or milestone, append a dated entry with: decision/change, rationale, evidence or pull-request/build reference, affected documents, verification performed, unresolved issues, and next action. Separate proposed, accepted, implemented, tested and deployed states. Keep original decisions in history when superseded.

Never put passwords, tokens, client names, passports, medical facts, banking information or private case files here. Link only to appropriately permissioned operational records when necessary. Keep this file short enough to read at the start of a session; move implementation details to the owning document.

### Handoff entry — 17 October 2026

T022 in-house electronic signatures are in the repository and are not applied on the live database. Evidence is migrations `20261017190000_esign_consent_purpose.sql` and `20261017190100_inhouse_esign.sql`, `tests/agreements.rls.test.ts`, and the portal agreements screen wired through the same classes as the demo markup. Provider is `in_house`. Defaults still pending confirmation: envelope life 14 days, consent version `esign-consent-2026-10-17`. Signing a service agreement on proposed scope sets engagement to engaged and does not record representation authority or change matter stage. The platform does not certify legal sufficiency of the wording.

### Handoff entry — 14 October 2026

Authored the six-file specification package, incorporating the full prior PRD, the supplied design reference, official-source governance, implementation architecture and 50-task backlog. The package is ready for product and engineering review. Source packs, branding clearance, production software and professional launch approvals remain uncompleted.

### Handoff entry — 18 October 2026

Finance (T030–T033, partial) is implemented, tested and deployed to app.casevoya.ca in **Stripe test mode only**; no live key is used. Evidence: PRs #63, #69, #70, #71, #72 and #74, with additive migrations `20261019100000`–`20261019140000` applied to the live database.

- **Card payments:** invoices, an in-portal Payment Element, a firm-owned Accounts v2 connected account with direct charges, and signed and deduplicated webhooks. Browser-tested end to end: INV-0001, CAD 450, card 4242, marked paid by the webhook.
- **Payments tab:** a Designer port. Stripe's own screens appear only for onboarding and KYC, in a dialog.
- **Refunds and disputes:** refunds are full or partial, owner or finance user with step-up, and the database refuses an over-refund. Disputes are recorded only; evidence submission is not built. Browser-tested with RF-0001, CAD 100.
- **Client funds (T032, manual ledger):** Casevoya records the firm's own client account and never holds money. It covers deposits through verification, per-client and per-matter balances that can't go negative, earned-fee transfers to issued invoices on the same matter, refunds, and reversing corrections.
- **Client-funds approvals (decided by Francis):**
  - The owner may approve their own transfer.
  - A non-owner who recorded a deposit can't verify it; the owner can verify their own deposit, with a fresh step-up.
- **CICC Code SOR/2022-128 controls**, cited in `docs/legal/client-account-sources.md`:
  - advance receipts RC-xxxx (s. 32(b))
  - a 30-day withdraw-by date, shown but not enforced (s. 32(g))
  - a recorded bank-transfer step after approval

**Verification:** CI on each PR; PGlite RLS tests; browser tests against the production database as the synthetic Walk Test owner and client Priya, both flagged is_sample.

**Unresolved:**
- Payment receipts (s. 33(3)) are in progress.
- Receipt emails wait on the owner's HTML email templates, not yet supplied.
- Reconciliation, credit notes and voids, and multi-line or tax invoices are not built.
- Stripe live mode needs professional, finance and legal review (T048). Gate E remains open: no finance reviewer has approved the client-money workflow.

**Next:** finish payment receipts, then the calendar and bookings work from PR #73's spec.
