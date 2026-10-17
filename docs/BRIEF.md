# Casevoya: Engineering Brief

Prepared 16 Oct 2026 from a full line-by-line read of `spec.md` (v1.0, 696 lines) and the six-file handoff in `zip/docs/` (PRD.md v1.1, ARCHITECTURE.md, RULES.md, DESIGN.md, TASKS.md, MEMORY.md, all v1.1, 14 Oct 2026). Owner: Francis Alagbe. Status: specs only. No code, database, provider account, deployed environment, source pack or professional approval exists yet.

---

## 0. Document set and precedence

### spec.md vs zip PRD.md
`spec.md` is **PRD v1.0**. `zip/docs/PRD.md` is **v1.1**. Sections 1–28 are word-for-word the same except for these changes:

| Change | spec.md (v1.0) | PRD.md (v1.1) |
|---|---|---|
| Version line | 1.0 | 1.1 |
| "Document package and authority" section | absent | added: names the six files, says to read RULES.md first, and says v1.1 supersedes the v1.0 navy/teal visuals. S-series sources = research record; O-series (in RULES.md) = operational source register |
| §2 Proposed identity | "warm white surfaces, deep navy text, restrained teal actions" | "follows the supplied Refero reference... warm off-white canvas, white panels, near-black text, restrained blue actions, thin borders" |
| §29 | absent | **new binding section**: SRC-01..SRC-12 (official-source governance), DES-01..DES-05 (design), extra release evidence, Refero URL |

**Takeaway:** treat PRD v1.1 (zip) as the canonical spec. spec.md is the older version, missing source governance and carrying the old palette.

### Precedence (MEMORY.md)
Read in this order: RULES → MEMORY → PRD → ARCHITECTURE → DESIGN → TASKS. When documents conflict, don't silently pick the easier reading. Confirmed user instructions and the evidence/security boundaries win. Record the resolution and update all affected docs together. DESIGN owns visual tokens; PRD owns product scope.

### Francis's later overrides (these beat DESIGN.md)
- **Action blue `#0075DE` on warm canvas `#F6F5F4`, ink `#111`.** These match DESIGN.md's `--action`, `--canvas` and `--text`, so the palette is confirmed.
- **Erode is the only typeface.** This replaces DESIGN.md's `Inter` (UI) and `Source Serif 4` (editorial). It conflicts with DESIGN.md's rule "never use decorative serif text for identity numbers, finance, or form controls" and with the requirement for tabular numerals. See Open Questions.

---

## 1. Product and boundaries

- **What it is:** multi-tenant B2B2C SaaS for licensed **Canadian immigration consultancies** (RCICs, firms of 1–20 staff). The firm buys it. Staff run matters. Clients, sponsors, dependants, guardians and employer contacts use a firm-branded portal. The scope runs from acquisition and consultation through engagement, intake, documents, payments, the authorized submission handoff, correspondence, decision, renewals, closure and retention.
- **Promise:** clear next steps, accountable casework, traceable records. It **never** promises approval, preferential treatment or processing times.
- **Excluded:** automated advice, autonomous government submission, guaranteed eligibility, visa-probability scores, an open adviser marketplace, pooled client-money custody, selling data, and referral commissions (any future referral feature needs a conduct review).
- **Relationships:** the subscription contract is platform↔firm. The service agreement is firm/licensee↔client. Clients accept portal terms but are not customers of a platform advisory service. The software company owns uptime, security, adapters and support. The consultancy owns advice, case accuracy, deadlines, client communications, financial authorization and professional obligations.
- **Jurisdiction:** Canada first. Other countries come later as **jurisdiction packs**, never as hard-coded shared rules.
- **Differentiation:** connected client journey, explainable next actions, family permissions, reusable verified facts, visible review reasons, financial separation, audit trail. Competitors (Officio, CaseEasy, ImmiCompliance) are known only from their own claims.
- **Commercial (hypotheses, kept in config and never in code):** Solo CAD 129/mo (2 staff, 100 active matters), Practice 299 (6/500), Firm 599 (15/1500), Enterprise quoted. Extra seat CAD 25. Clients don't use seats. "Active matter" means not closed or archived, so on-hold and government-processing matters count. 14-day trial. An unverified firm gets a sandbox only and can't invite real clients. Trial expiry never deletes data. Never advertise unlimited storage or AI. No fee on approvals, no percentage of government fees, no payment markup at the start.
- **Brand:** Casevoya is a working name. Dossivana and Retainivo are alternatives. Retainora and ImmiLoom were rejected. Nothing has been cleared or registered (T002).

### Surfaces / IA
- **Marketing:** home, product, consultant workspace, client portal, security, pricing, integrations, migration, demo, contact, help, terms, privacy, subprocessors, accessibility, status. CTAs: Book a demo / Start a trial. Fictional data only. Kept separate from authenticated data paths.
- **Firm workspace nav:** Overview, Leads, Clients, Matters, Tasks, Calendar, Inbox, Documents, Agreements, Finance, Reports, Templates, Settings. Every queue filters by owner, office, program, priority and date. The **matter workspace** has tabs Overview, People, Intake, Documents, Forms, Tasks, Messages, Agreements, Billing, Submissions, Decisions, Audit. Its header shows consultant, stage, next action, blockers, nearest deadline and last verified update.
- **Client portal nav:** Home, My matters, Tasks, Documents, Messages, Appointments, Agreements, Payments. Home answers: what do I do, by when, who's working on it, what happens next. Uploaded and accepted documents are shown separately. No approval percentages.
- **Platform admin:** Firms, Verification, Subscriptions, Usage, Service health, Support grants, Template releases, Incidents, Privacy requests, Audit, Configuration. Metadata only. **No silent impersonation.**
- **Responsive and a11y:** mobile-first client from 360 px, WCAG 2.2 AA. Every core screen has loading, empty, error, denied, offline and retry states. **EN + FR at launch.** Language and timezone stored per person.

---

## 2. Roles and permissions (PRD §5, ARCH §5)

Authorization = org membership + role + matter assignment + person relationship + data category + document audience + purpose + explicit time-limited grants. It is enforced **server-side on every read and write, search, download, export, job and integration event**.

| Role | Default access | Restricted |
|---|---|---|
| Platform admin | Firm config, service metadata | No routine client content or consultant decisions |
| Firm owner | Firm admin, billing, staffing, access policy | Not automatically a consultant; legal sign-off needs a licensed consultant role |
| Licensed consultant | Assigned matters; advice, review, release | Can't exceed recorded licence scope |
| Case manager | Assigned intake, documents, tasks, drafts | Can't release advice or final submission (even if also billing admin) |
| Assistant | Explicitly assigned ops work | No restricted records or finance approvals by default |
| Finance user | Agreements needed for billing, invoices, ledgers | No medical, criminal or narrative access by default (including via search index) |
| Client / adult dependant | Own matters, audience-scoped records | Household membership gives no access to another adult's data |
| Sponsor / employer | Requested fields and shared records | No applicant-wide visibility. **Paying an invoice grants nothing** |
| Guardian | Verified authority for identified dependants | Scoped, reviewed, revocable. Age-of-majority trigger creates an authority-review task (age rule is configurable) |
| External collaborator | Named docs or tasks until expiry | No browsing or bulk export |

- Multi-firm users pick an active workspace. Identities and records are never merged across firms. Sharing an email never merges people.
- Permissions can be narrowed further by office or team.
- Support access (SEC-09) is a scoped, justified grant, **60 min by default**, firm-approved unless the emergency procedure applies, visible to the firm and auto-revoked on expiry.

---

## 3. State machines

### Lead
New → Contacted → Consultation scheduled → Consultation completed → Qualified → Proposal sent → Converted | Lost (reason stored separately) | Archived. Several leads can map to one person without creating duplicate people.

### Matter stage (firm work)
| Stage | Entry evidence required | Typical next |
|---|---|---|
| Engagement pending | Named consultant + proposed scope | Intake |
| Intake | Executed service agreement (or documented exception) | Evidence collection |
| Evidence collection | Questionnaire assigned | Preparation |
| Preparation | Required facts reviewed, blockers tracked | Consultant review |
| Consultant review | Draft package version + review checklist | Client confirmation / back to Preparation |
| Client confirmation | Consultant-reviewed package ready for client | Ready to submit / back to Preparation |
| Ready to submit | Valid approvals, required authority, completed checklist | Submitted |
| Submitted | External reference, submission time, receipt evidence (otherwise shown as **"Submission unverified"**) | Government processing |
| Government processing | Verified submission | Decision review / continue |
| Decision review | Official decision evidence | Post decision |
| Post decision | Consultant-confirmed outcome + follow-up plan | Closed |
| Closed | Closure checklist + retention date calculated | Reopened only via controlled action |

**Independent dimensions:** matter stage, government status, engagement status, financial status, document completeness and outcome are all separate. A paid invoice never changes the government outcome or the stage.

- **On hold** is a flag (reason, owner, review date), not a stage. It never stops government-deadline alerts.
- **Outcomes:** Approved, Refused, Withdrawn, Returned/incomplete, Abandoned, Other verified. *Pending is not an outcome.* DEC-01 also requires sub-milestones: approval in principle, final approval, document issuance, landing/confirmation, status expiry. Don't collapse these into one "Approved".
- **Transition rules:** every transition needs permission, `expected_version` (409 if stale), timestamp, actor and reason. Going backwards keeps history and cancels only obsolete future automation. Editing a reviewed fact or document invalidates dependent approvals and forces a new package version. Reopening keeps the prior closure event and recalculates retention. Materially new work becomes a **new linked matter**, and so do appeals, reconsiderations and new applications.
- Refusal: record the decision document, received date, confirmed outcome and reviewer. Create an urgent consultant-review task. **Never calculate appeal or JR rights.** Withdrawal needs recorded instructions, consultant review, government steps and financial reconciliation. A CRM stage change is not a withdrawal.
- Example transition payload: `expected_version=12, target_stage=ready_to_submit, package_id, package_hash, client_confirmation_id, review_note`. The server checks that every reference belongs to the same tenant and matter. The client can never send `approved=true`.

### Other machines
- **Document:** Requested, Uploaded, Quarantined, Awaiting review, Accepted (by firm, for purpose), Changes requested, Expired, Superseded.
- **Signature envelope:** Draft → Sent → Partially signed → Completed, plus Declined, Expired and Voided branches.
- **Invoice:** Draft, Issued, Partially paid, Paid, Overdue, Voided, Credited. Refunds and disputes have their own states. Payment status is **derived from allocations**.
- **Client-facing refund:** Requested, Processing, Completed, Failed.
- **Subscription:** Trial, Active, Past due, Restricted, Cancelled, Archive.
- **Rule/source:** Draft → Evidence captured → Professional review → Approved → Published. Published can move to Review due, Suspended or Superseded. Rejected stays traceable. Published versions are immutable.
- **Integration adapter:** connected, degraded, expired, disconnected.

---

## 4. Modules and key requirements

### 4.1 Onboarding and licence controls (ORG-01..06)
- Organization (legal/display name, offices, jurisdictions, billing and privacy contacts, locale, TZ, branding). **`organization_id` is the tenant boundary.**
- Staff invites are expiring and single-use. **MFA is mandatory for staff and platform personnel.** Recovery is audited and revokes sessions.
- `ConsultantCredential` is separate from login: regulator, licence #, scope, status, last check, evidence, review date. Verification is **manual public-register check** at launch (no API or scraping assumed), with a monthly review cadence plus event-triggered reviews. That cadence is a product control.
- Expiry or adverse status suspends new engagements and professional-release actions, alerts the owner and drives reassignment. Continuity access, exports and deadline monitoring stay on. Evidence and audit stay intact.
- Continuity contact and succession; offboarding revokes access and reassigns tasks and deadlines. Transfers to another firm happen only through a permissioned export.
- Firm activation journey: account → email verify → MFA → firm details → subscription + DPA terms, privacy contact, jurisdictions → consultant credentials → platform review (result, source, timestamp, reviewer, next review) → branding, roles, templates, calendar, payment destination, retention → **a sample case proving intake, agreement, upload, reminder, invoice and export before real-client invites are enabled.**

### 4.2 Leads, consultations, intake (CRM-01..04, INT-01..06)
- Embeddable and hosted enquiry forms collect minimal data plus consent and source. Passports and sensitive history are deferred.
- Pipeline, assignment, notes, tags, follow-ups, dedupe *suggestions* (multi-attribute, human-confirmed, never on a shared family email), opt-out, CSV import.
- Appointments: availability, buffer, TZ, reschedule, cancel, capacity, meeting link, no-show. **Atomic capacity reservation.** Calendar sync scoped to selected calendars.
- Consultation agreement and service agreement are distinct versioned records. A booking fee collected before service follows the **advance-payment controls** and can't be relabelled as earned.
- Versioned form builder: stable field keys, conditional sections, repeatable histories, relationships, declarations, file requests, multilingual labels.
- Intake packs (TR, study, work, PR, sponsorship, citizenship, provincial) need a licensed reviewer and an effective date.
- Autosave with saved time, resume, field errors. **Unknown, N/A and approximate/partial dates are distinct. Never fabricate full dates.**
- **FactVersion provenance:** person, field, raw and normalized values, source doc or answer, actor, timestamp, review state, superseded value. Reuse across matters needs client reconfirmation and staff review.
- Inconsistency flags (overlaps, gaps, conflicting DOBs, names, expired evidence) are review items, not fraud findings. Aliases, transliterations, multiple passports and address history are kept.
- Post-submission corrections create new versions and alert affected matters. Submitted snapshots are frozen.

### 4.3 Agreements and e-signatures (AGR-01..05)
- Quotes: scope, services, exclusions, deliverables, fee structure, taxes, disbursements, government fees (dated reference or manual entry with source, never silently reused), instalments, refund policy, expiry. **An accepted quote is not a signed agreement.**
- Agreements come from reviewed templates (consultant identity, parties, scope, responsibilities, communications, fee disclosures, complaints, termination). The platform doesn't certify legal sufficiency.
- Multiple signers, signing order, signer auth, e-sign consent, delivery evidence, **document hash**, signed PDF, completion certificate, provider event IDs. Government-form signatures follow separate rules.
- Amendments create a new version with a comparison and re-signing. **Executed originals are immutable.** Changing fees after a partial signature voids or supersedes the envelope and creates a new version. Duplicate webhooks can't execute twice.
- **Representation authority** is a separate record (scope, gov form/evidence, effective and revocation dates). A service agreement doesn't prove it.

### 4.4 Documents and preparation (DOC-01..07, PREP-01..04)
- Checklists per person and per matter come from templates and conditional rules (type, explanation, owner, due date, formats, criteria, expiry, audience).
- Accepted types: PDF, JPEG, PNG, HEIC, DOCX. **25 MB default, configurable to 100 MB.** Sniff the real type, quarantine and malware-scan, keep originals, render previews separately, never execute macros.
- Camera capture, multi-page assembly, rotate and reorder. Derivatives keep parent and transform metadata. Compression never replaces the original.
- OCR returns confidence plus page anchors. Staff confirm IDs, names and dates before they become facts. Unreadable fields stay unknown.
- Versions, hashes, classification, translation link, owner person, visibility, expiry, retention link. **One evidence source can be referenced by many matters.** Deleting a reference never deletes evidence another matter needs.
- Secure preview, short-lived URLs, download audit, redacted copies, **original-document custody tracking** (received, location, purpose, recipient, return, acknowledgement).
- FormTemplate: jurisdiction, program, official form ID and URL, form version, mapping version, effective date, output format. A public **support catalogue**; unsupported, dynamic or barcode forms use a manual workflow. Source-to-field review screen. Output is validated in the official tool.
- Bundles, indexes, cover letters. Narratives distinguish evidence from inference.
- **Package manifest:** every document version + hash, form version, fact snapshot, approval events, export time. Any material change invalidates release approval. Old packages stay reproducible.

### 4.5 Tasks, deadlines, comms, automation (OPS-01..08)
- Tasks: owner, watchers, dependencies, priority, due date + due TZ, checklist, effort, status, blocker, escalation. Client and internal tasks are separate. Reassignment keeps history.
- Deadlines: source evidence, event date, receipt date, TZ, rule version, calculation explanation, verifying consultant, status. OCR dates are tentative. Show local and official TZ together. **SRC-06:** label correspondence deadlines, source-derived legal deadlines and internal targets separately.
- Reminders at 14/7/3/1 days (only future offsets). Short notice escalates immediately. Overdue critical items go to the consultant and owner. Business-day math needs a reviewed jurisdiction calendar.
- Messaging: matter threads, staff-only notes, announcements, templates, **audience shown before send**, permissioned attachment links, acknowledgements.
- Email and SMS carry minimal content plus a portal link. No passport numbers, refusals, medical data or attachments. Service and marketing consent are separate.
- Email import: user-scoped, preview, triage queue. A bounce on a critical notice creates a staff task, and the client is not shown as notified.
- Automation: event, conditions, actions, delay, owner, stop rules. Allowed actions: create tasks, assign, request documents, send approved admin templates. **These need a human:** legal advice, refunds, new bank destinations, final outcomes, submission release.
- Durable queues: unique execution key, retries, DLQ, visible history. Completing a task cancels its stale reminders. Quiet hours for routine reminders.

### 4.6 Payments and trust separation (FIN-01..13)
- **Three money flows that never mix:** (1) SaaS firm→platform, (2) professional fees client→firm, (3) government fees and disbursements.
- Earned-fee checkout runs on the firm's processor account (**Stripe Connect direct charges** being considered; refund and loss liability must be confirmed).
- **Advance payments:** card collection stays disabled until processor, bank, settlement, refunds and fees are approved for the practice. Until then, a complete **manual bank-transfer recording and reconciliation** workflow is required. A processor balance is not a client trust account. The platform **never** holds pooled advances. SaaS and processor fees are never deducted from client funds.
- Invoices: firm-unique number, matter, billing party, fee category, lines, qty, unit, tax code, currency, dates, instalment link, instructions. **Integer minor units + ISO currency.** CAD at launch, multi-currency structures, **no cross-currency allocation**.
- Billing types: flat, hourly, milestone, instalment, time and expenses, quotes, deposits recorded as advances, credit notes, refunds, receipts, write-offs, disputes, ageing. Tax rules are effective-dated and firm/accountant-approved.
- Issued invoices are immutable; corrections go through credit notes. **RCIC rule:** an earned-fee invoice needs delivered services or incurred disbursements. Before that, use a quote or advance request. Transfers are never automated from a generic milestone.
- Checkout carries no case details. Verify signed webhooks, account, amount, currency and event ID. **A redirect is not proof of payment.** Dedupe on (provider, connected account, event ID). Handle late and out-of-order events.
- Manual payments are pending verification until reconciled. Reversals reopen balances and create tasks without moving the stage.
- **Client subledger:** per-client and per-matter ledgers, bank accounts, deposits, transfers, refunds. **Balanced, immutable journals; corrections by reversing entry.** One client's funds can never cover another's obligation.
- Earned-fee transfer references the invoice, milestone, authorizer, balance, amount and bank transaction. It can't exceed available funds or earned charges. **Two-person approval by default; solo firms record a self-approval with a reason.** Lock the balance during allocation.
- Monthly **three-way reconciliation**: adjusted bank balance vs control ledger vs sum of subledgers, with a signed review. The accountant validates the chart of accounts.
- Partial refunds, chargebacks, overpayments, cancelled instalments. A refund is not a credit note. Never double-refund via bank and processor.
- Acceptance examples: a CAD 1000 advance is a liability, not revenue. A CAD 300 transfer leaves 700. A duplicate event never doubles a balance. CAD can't pay USD. A dispute never deletes or withholds records.

### 4.7 Government handoff and decisions (GOV-01..05, DEC-01..03)
- Submission checklist per program and channel: representation evidence, released package version, reviewed deadlines, signatures, fee handling. Show which steps happen outside Casevoya.
- **Manual handoff only.** The representative uses the official channel (the IRCC APR portal exists but no third-party API is established). There is no government API, polling or credential storage.
- Submission record: channel, application ref, timestamp, representative, manifest, receipt, evidence. Submission and acknowledgement dates are separate. Without proof it shows **"Submission unverified"**. A payment receipt can never set Submitted.
- Correspondence: issuer, document date, received date, action, confirmed due date, evidence, audience. One letter can create many tasks. Client-uploaded letters stay unverified until reviewed.
- Every government status records source, recorder, evidence, verified time and last checked. Shown as "recorded by your firm". No real-time tracking claims. Stale statuses show their last verified date.
- Decisions need evidence plus consultant confirmation. Approved matters get a follow-up checklist, delivery record, consultant-approved conditions summary, expiry reminders and closure tasks. Renewals need valid contact preferences and a new scope.
- Refusal, returned, withdrawal and abandonment each have their own playbook. The authority's reasons are stored separately from the consultant's interpretation. No remedy predictions.

### 4.8 AI governance (AI-01..07, SRC-09, RULES §9)
- Optional and switchable **per firm and per sensitive document category**. The non-AI path always works. AI never blocks the manual lifecycle.
- Allowed uses: classification, OCR normalization, missing-field detection, inconsistency flags, summaries, admin reply drafts, letter drafts from approved facts.
- Each `AIRun` records tenant, matter scope, model and config version, prompt-template version, allowed source IDs, output, anchors, actor, cost, review result. Retained prompts are minimized. Logs get case-level access and retention controls.
- Output is draft-only and a reviewer accepts, edits or rejects it. **AI can't** sign, submit, change bank details, refund, change access, infer decisions or alter facts.
- Legal content must cite an approved, current source version, otherwise it returns a structured `needs_review`. Model-generated URLs are never accepted as citations.
- Uploaded and retrieved text is untrusted (prompt injection). Retrieval is filtered by tenant, matter, person and audience **before** content reaches the model, and the same applies to embeddings and caches.
- Vendor review covers data use, retention, region, subprocessors, deletion. No training on client data.
- Release gate: ≥200 synthetic or de-identified examples, ≥98% precision on accepted high-confidence identity fields, anchors on every material fact, 0 unauthorized tool actions, 0 cross-tenant retrievals. Measured per field and per language.
- Architecture: an AI gateway enforcing policy, minimization, freshness, output schemas and cost budgets.

### 4.9 Privacy, security, retention, continuity (SEC-01..11)
- Posture: PIPEDA accountability (no blanket ban on foreign processing). Canada hosting is a trust and procurement choice, not a legal claim. Quebec requires a PIA and transfer review. **Retention baseline: at least 6 years after closure** (CICC client-file regulation, to be revalidated), with longer holds where needed.
- SEC-01: staff MFA, secure cookies, session inventory and revocation, rate limits, credential-stuffing defence, **step-up auth** for exports, payment config, role changes and sensitive downloads. Client MFA is available and required for high-risk actions. No knowledge-based recovery.
- SEC-02: encryption in transit and at rest, managed secrets and KMS with rotation, identity numbers masked in lists and logs, no keys in the browser.
- SEC-03: org-scoped access + RLS, fresh authorization on every object fetch, short-lived links, private buckets, quarantine, cache isolation, private search indexes.
- SEC-04: audit covers auth, grants, sensitive reads, downloads, exports, changes, signatures, finance, template publishing and support access. Each entry has actor, tenant, object, action, time, result, request ID and a **redacted** diff. Logs are tamper-resistant with bulk-access alerts.
- SEC-05: purpose-specific consent (core, AI, channels and marketing kept separate). Withdrawal starts an impact review and doesn't auto-delete.
- SEC-06: subject access and correction: ID verification, scope search, third-party redaction, due date, delivery proof. Handled per firm.
- SEC-07: on closure record policy version, closure date, retention end, custodian, hold status. Retained records are read-only apart from annotations. Deletion needs approval and purges originals, derivatives, OCR text, embeddings, exports and caches. **Deletion tombstones are reapplied after restore.**
- SEC-08: incident handling. **All breaches recorded, kept ≥24 months.** Report under RROSH "as soon as feasible". No generic 72-hour rule.
- SEC-09: support grants (60 min default).
- SEC-10: cancellation stops new work after the contract term, keeps continuity and export (≥90-day export window), offers a custodial archive or transfer. **No silent destruction.**
- SEC-11: encrypted backups, PITR, object versioning, quarterly restore drills. RPO ≤15 min, RTO ≤4 h, proven by exercise.

### 4.10 Reports, platform ops, subscriptions (REP-01..03, ADM-01..05)
- Reports: lead conversion, attendance, intake completion, stage ageing, workload, outstanding docs, overdue tasks, time to readiness, invoiced vs collected, receivables, client-account balances, reconciliation exceptions, renewals.
- Outcome reports are descriptive: pending cases excluded from denominators, sample size shown. **Never an individual's chance of success.** Staff aren't ranked on raw approval rate.
- CSV/PDF exports keep filters, timestamp, currency and authorization. Scheduled reports recheck recipients at send time. No confidential attachments in plain email.
- Platform ops: activation, credential queue, entitlements, quotas, subscription events, health, delivery failures, integrations, incidents. **Per-tenant feature flags.**
- Server-side entitlements. A downgrade blocks new consumption after notice and never deletes data or blocks exports.
- Shared template publishing is versioned (author, licensed reviewer, test evidence, effective date, changelog, rollback). Firm overrides stay distinguishable. **Matters pin their template version.**
- Analytics are pseudonymous metadata only, with no narratives, IDs, docs or message bodies.
- **Complaints register** (ADM-05) is separate from support incidents and restricted to designated staff.

### 4.11 Migration (MIG-01..04)
Staged import with mapping, validation, sensitivity classification, dedupe and a row-level error preview. **No silent merges.** Pilot sample, then sign-off, then controlled run with counts, checksums and exceptions. Imported history keeps its original date plus `imported_at` and `source_system`, and is never presented as native audit. Financial opening balances are dated per bank, client, matter and currency, with no reconstruction from totals. Rehearse cutover, read-only period and rollback.

---

## 5. Data model and invariants (PRD §18, ARCH §6)

**Conventions:** UUID PKs. UTC instants plus original TZ where it matters. **Calendar dates and partial dates are their own types.** Every tenant row has `organization_id, created_at, updated_at, created_by, version`. Cross-table FKs include `organization_id`. Soft delete is no substitute for retention. Append-only histories for facts, approvals, posted journal lines, published templates and government-event verification.

**Identity:** a global `User` authenticates; a `Membership` grants org access. A `Person` is tenant-local and can exist without a login; linking to a user requires a verified invite. A Matter has many Persons through `MatterParty` (role + scope). A household is a grouping, **not** a permission boundary.

**Core entities:** Organization, Office · User, Membership · ConsultantCredential · Person, PersonRelationship · Matter, MatterParty · Lead, Appointment · QuestionnaireVersion, Response · FactVersion · Agreement, SignatureEnvelope · Document, DocumentVersion, MatterDocument (reference), DocumentRequest · Task, Deadline · Conversation, Message · FormTemplate, Package · Submission, GovernmentEvent · Decision, FollowUp · Invoice, InvoiceLine · Payment, Allocation · CreditNote, Refund · LedgerAccount, JournalEntry · Reconciliation · Consent, AccessGrant · RetentionPolicy, LegalHold · AuditEvent, SupportGrant · WorkflowVersion, Execution · IntegrationConnection, WebhookEvent · AIRun, Review · Subscription, UsageEvent. Also implied: RepresentationAuthority, Custody record, Complaint, Outbox/Inbox.

**Source-governance tables (ARCH §6):** OfficialSource (global), SourceSnapshot, SourceDependency, RuleDefinition, RuleVersion (structured condition tree, effective range, status), RuleEvidence, ProfessionalReview (with reviewer credential snapshot), RulePackVersion, MatterRuleBinding, RuleImpact, SourceCheckAttempt. Public sources can be global. Firm overrides, bindings, reviews and impacts are tenant-scoped.

**Integrity constraints:**
1. A posted journal balances per currency; posted lines are immutable.
2. External payment and webhook IDs are unique per (provider, connected account).
3. A released package points to immutable document and fact versions, never "current" pointers.
4. Professional approval needs an active authorized consultant **and** a package hash that matches.
5. Download = tenant membership **and** matter/person/audience authorization.
6. An unverified manual payment never creates available balance.
7. A legal hold blocks destruction across originals, derivatives and related records.
8. A government reference is restricted text, not globally unique.
9. Optimistic locking everywhere; stale write → 409.
10. Only a published, applicable, reviewed RuleVersion can drive regulated automation. Never use `retrieved_at` as an effective date.

**Indexes:** tenant + (matter stage, owner), (task due, state), (doc review state), (invoice due, state), audit time. Partition audit and event tables when load justifies it. Sensitive searchable IDs encrypted with a reviewed lookup strategy (e.g. blind index). No plaintext IDs in FTS.

---

## 6. Architecture, stack, hosting, residency

- **TypeScript modular monolith.** Next.js/React web; route handlers call domain services; dedicated workers; PostgreSQL; private object storage; managed durable queue + DLQ. Split services only when measurements justify it. Pin current stable versions in a lockfile and keep Postgres portable.
- **Repo layout:** `apps/web` (marketing, firm, client and admin routes + API), `apps/worker`, `packages/{domain, db, ui, contracts, integrations, rule-packs, testing}`, `infra`, `docs`.
- **Module ownership:** Identity/tenancy · Practice · CRM/scheduling · Matters · Evidence · Content governance · Agreements · Preparation · Finance · Communications · Integrations · Administration. Each module has explicit "must not own" boundaries; for example, Matters doesn't own bank settlement and Finance never pools money.
- **Runtime:** web app; transactional backend with policy layer + **transactional outbox**; scoped workers; file pipeline (quarantine → scan → metadata → preview → optional OCR → review → authorized retrieval); provider adapters; observability (redacted logs, traces, audit sink); AI gateway.
- **Tenant isolation:** app authorization **plus** Postgres RLS (`ENABLE` + `FORCE`, policy on `current_setting('app.organization_id')`). A transaction-local tenant setting on a **non-owner** role; the app role never has `BYPASSRLS`. Migration credentials are separate and audited. Never trust a request-supplied org ID. Workers take tenant context from the stored job record, not the payload. Test pool reuse, search, exports, storage links, metrics and vector retrieval. Tenant-scoped storage and cache keys don't replace authorization checks.
- **Residency:** Canada-region compute, DB, storage, queues and backups (verify each vendor). Third-party identity, email, signing, payments, telemetry and AI each need their own residency review. **Neon showed no Canadian region when reviewed, so it isn't a default for Canada residency.** Don't claim "Canada-only" unless the whole data path is.
- **Delivery:** separate dev, staging and prod accounts. Synthetic data only, with no prod data on laptops or previews. IaC. CI runs typecheck, migration check, authz tests, dependency scan and E2E. Backward-compatible migrations, feature flags, rollback. Code rollback never erases financial or audit history.
- **Source ingestion:** allowlisted HTTPS fetcher with SSRF defences (IP and redirect validation at every hop, metadata endpoints blocked, size, type and time limits), inert parsing, malware scan, hashes. Changes produce a candidate and a review task. **Nothing auto-publishes.**
- **Deterministic rules:** schema-validated expression tree, **no eval of DB-stored JS**. Inputs are approved facts with explicit unknowns. Outputs carry rule IDs and source versions. Default result is `needs_review`.

---

## 7. APIs, events, integrations

**Conventions:** `/api/v1` JSON. Tenant comes from the authenticated membership and workspace. Cursor pagination, typed errors, request IDs, rate limits. **Idempotency-Key** on financial, workflow and externally visible mutations, scoped by tenant, actor, endpoint and payload hash (same key with a different payload → error). 409 stale, 422 semantic, 429 throttle. Consistent enumeration policy (e.g. 404 for unauthorized).

**Core endpoints:** POST /leads · POST /appointments (atomic capacity) · POST /matters · PATCH /matters/{id} · POST /matters/{id}/transitions · PUT /responses/{id}/answers · POST /documents/upload-intents · POST /documents/{id}/complete · POST /documents/{id}/reviews · POST /agreements/{id}/send (freeze + envelope, idempotent) · POST /packages/{id}/approve (bind to manifest hash) · POST /submissions · POST /government-events · POST /invoices/{id}/checkout · POST /payments/manual · POST /transfers/{id}/approve · POST /exports (step-up, expiry) · POST /webhooks/{provider}.

**Source-governance endpoints:** GET /official-sources · POST /source-checks · GET /rule-versions/{id}/evidence · POST /rule-versions · POST /rule-versions/{id}/reviews · POST /rule-packs/{id}/publish · GET /matters/{id}/rule-impact · POST /matters/{id}/rule-bindings · POST /packages/{id}/readiness. Readiness returns `ready, blockingIssues, warnings, checkedRuleVersionIds, packageHash, evaluatedAt`. **Final approval re-runs the checks inside its own transaction** and never trusts an old `ready=true`.

**Domain events:** lead.created, agreement.executed, intake.submitted, document.uploaded, document.reviewed, task.overdue, package.approved, submission.recorded, government_request.verified, decision.confirmed, payment.settled, refund.completed, matter.closed, credential.restricted, plus source.changed, source.check_failed, rule.review_due, rule.published, matter.rule_impact_detected. Envelope: `event_id, organization_id, aggregate_id, aggregate_version, event_type, occurred_at, schema_version` + minimal refs, with no documents or narratives. At-least-once delivery; consumers dedupe and tolerate reordering. Delayed jobs recheck task state, permissions, deadline, TZ, preferences and history before sending. Exports recheck access before delivery.

**Integrations:** payments and e-sign via verified webhooks + reconciliation (transactional inbox). Google and Microsoft calendar/email via OAuth with narrow scopes and encrypted tokens. Accounting starts as exports. SMS optional. WhatsApp later, through an approved channel only. Outages queue retries and show pending, and manual fallback is allowed. **Never fabricate a signature or payment.** No IRCC automation.

---

## 8. NFRs (GA targets, to be measured)

| Area | Target |
|---|---|
| Availability | 99.9% monthly, core portal |
| API latency | P95 read <500 ms, write <1 s (excluding external providers) |
| Page UX | P75 usable <2.5 s on midrange mobile |
| Load envelope | 500 firms, 100k active matters, 2k concurrent sessions |
| File processing | P95 scan + preview <2 min for 25 MB |
| Reminders | 99.9% of due jobs enqueued within 5 min |
| Recovery | RPO ≤15 min, RTO ≤4 h (exercised) |
| Exports | 95% of 1 GB matter exports within 15 min |
| Accessibility | WCAG 2.2 AA |
| Auditability | Every material mutation has actor, time, object, correlation ID |

Exports, OCR and AI run async with progress and cancel. Per-tenant quotas and fair scheduling. No authenticated pages in a public CDN cache. **Definition of done:** acceptance criteria pass, server-side role enforcement, audit, clear copy, failure and retry paths, i18n keys, a11y checked, observability live, docs updated. **UI-only, simulated payments or local-only storage doesn't count as done.**

**20 acceptance scenarios (§23):** tenant isolation across every path; family boundaries; consultant scope; intake resilience/conflict; OCR rejection; package integrity; partial-signature change; DST deadline; duplicate/out-of-order payments; pending deposit can't fund a transfer; reference without receipt stays unverified; refusal handling; template change; cancellation continuity; privacy request; restore verification (hashes, balances, holds, tombstones); AI injection; keyboard/SR journey; bounced critical reminder; closed-matter original records.

**Analytics targets (hypotheses):** firm activation ≥70% in 7d; client first action ≥80% in 72h; intake time −30%; doc chasing −40%; readiness −25%; financial accuracy 100%; critical deadlines 100%; client clarity ≥85%; 90-day retention ≥90%; gross margin >70%. Approval rate is not the north-star metric.

---

## 9. RULES.md source-governance gates

- **Core rule:** every immigration-specific claim (requirement, checklist, form mapping, fee, eligibility, deadline, processing time, client explanation) must come from the applicable **official source**. Never from model memory, competitors or blogs. This covers code, fixtures that represent real rules, tooltips, marketing, templates, notifications, forms, prompts and letters. Fictional demos must say they're fictional.
- **Four information kinds:** immigration requirement (official source + reviewed applicability), client fact (client input or evidence), product decision (labelled spec + owner), design reference (Refero + adaptation). Don't demand IRCC citations for product choices or personal facts.
- **Authority:** legislation and regulations → program guidance, MIs, public policies, form instructions → regulator (CICC) for professional rules. Provincial programs need the provincial authority; Quebec may need Quebec sources too; IRB and courts need their own rules plus a reviewer. An official domain alone isn't enough.
- **Source register O01–O15** (entry points only, not approvals): IRCC forms, fees (no numeric fee seeded), processing times (no durations seeded), operational instructions, PR programs, IRPA, IRPR (current to 2026-09-21), authorized reps, APR portal, CICC regs, Professional Code SOR/2022-128, CICC file regulation, OPC cross-border, OPC breach, Quebec CAI. O-IDs ≠ S-IDs.
- **Evidence record** per rule (YAML in RULES §5): rule_id, version, classification, jurisdiction, program_key, applicant_context, claim, source_* (id, url, title, section, publisher, language, published_at, modified_at, current_to), effective_from/to, retrieved_at, content_hash, evidence locator, interpretation_notes, status, reviewed_by/at, next_review_at, supersedes_version, test_case_ids. **The sample is intentionally incomplete and must fail the publication validator.** Null beats an invented value. Multiple sources go through evidence links.
- **Publication workflow:** identify scope → read current source → record provenance → draft rule + unknown behaviour → tests (positive, negative, boundary date, missing info, exception) → **qualified reviewer approves the exact version (a coding agent can't approve itself)** → publish a versioned pack → impact analysis on active matters; submitted packages stay untouched. Conflicts block that rule only; unrelated work continues.
- **Freshness (product controls):** fees, program status and public policies monitored daily; forms and checklists daily; eligibility guidance weekly; processing times refreshed when displayed or linked; professional and privacy rules monthly; case instructions on receipt. A monitoring failure doesn't reset last-checked. An unchanged hash doesn't prove linked forms are unchanged. **Overdue review blocks** new automated advice, fee issuance and package release that depend on the stale rule. No generic override checkbox.
- **Specific product rules:** no hard-coded fees, scores, thresholds, processing times or deadlines in UI; internal vs official dates kept apart; source + checked date shown beside guidance; checklists tied to program, context and version; real form IDs; no implied live IRCC sync; money flows split; packages pin everything; PFLs and refusals go to consultant review; no government branding.
- **SRC-01..12 (PRD §29):** claim-level evidence; authority dates vs observation dates; publication gate (no draft goes live via import, API, AI or job); change detection → impact task; pinned matter versions + audited upgrades; deadline origins; source context in UI; fail safely and locally; grounded AI; boundary tests (supported, unsupported, missing input, jurisdiction mismatch, stale, superseded); stewardship (owner + reviewer + change procedure before launch); honest scope (no pack inheritance).
- **Pre-merge checklist (RULES §11):** official evidence for immigration changes; effective dates or a blocking unresolved state; licensed review where required; tests + affected-matter analysis; historical reproducibility; UI separates internal, official and firm-recorded; uniform permissions across access, family, downloads, exports and AI; finance tolerates duplicates and reordering; DESIGN.md compliance; docs and TASKS updated.
- **Engineering rules:** server-side authz; no real client data anywhere in dev; no frontend keys; scope storage, cache, queues, search and AI by org; idempotency on payments, approvals, jobs and callbacks; versioned migrations; resolve conflicts explicitly; **never weaken safety controls to make tests pass**; no secrets or personal data in MEMORY.md.

---

## 10. Design system (DESIGN.md + Francis's overrides)

**Reference:** Refero "Notion" style (https://styles.refero.design/style/2bf4c61f-de10-4614-ba1b-20c0453bd2a9). Inspiration only: no proprietary fonts (NotionInter, Lyon), art or copy. It supersedes v1.0 navy/teal.

**Overrides from Francis (authoritative):** action `#0075DE`, canvas `#F6F5F4`, ink `#111111`, **Erode for all type**. Those colours already match DESIGN.md tokens. The font stack changes from Inter / Source Serif 4 to Erode.

**Tokens (DESIGN.md, CSS custom properties as the source of truth):**
- Surfaces: canvas `#f6f5f4`, surface `#ffffff`, surface-muted `#efeeec`. Text `#111111`, secondary `#615d59`, muted `#69635e`. Border `#dedbd7`, border-strong `#8c8781` (use it for input borders; a hairline alone is never the affordance), divider `rgba(0,0,0,.08)`.
- Action `#0075de` / hover `#0065bf` / active `#0055a1`, on-action `#fff`, tint `#e6f3fe`, tint-text `#075b9f`, focus `#075b9f`, selection `#dceeff`. If white on `#0075de` fails contrast in a given use, switch to the darker action token.
- Semantic bg/text: success `#e7f3ec/#205c38`, warning `#fff2d2/#704b00`, danger `#fde9e5/#a12c20`, info `#e6f3fe/#075b9f`, neutral `#efeeec/#514c47`.
- Marketing-only accents: amber `#ffb110`, coral `#f64932`, sky `#62aef0`, midnight `#02093a`.
- Radius: 4 / 8 (controls) / 12 (panels) / pill. Spacing on a 4 px unit: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80.
- Motion: 120 ms / 200 ms ease. Overlay shadow `0 12px 32px rgba(17,17,17,.12)`. Respect `prefers-reduced-motion`. No confetti, no countdowns on unverified deadlines.

**Type scale:** marketing hero clamp 48–72/1.08 (mobile 36–44), section 40/1.2 (28), app H1 28/1.25 (24), panel 18/1.4, body and input 16/1.5, table 14/1.45, meta 12/1.5. Weights 600 for headings, 400 body. **Tabular numerals for money.** Prose 65–75 ch. Never truncate deadlines, fees or instructions.

**Layout:** marketing max 1200 inside 1440, gutters 24–48 (mobile 16–20), sections 64–80; app panels 24–32. **Firm shell ≥1280:** 240 px sidebar, 64 px top bar, 32 px padding. Sidebar groups: Work (Overview, Leads, Clients, Matters, Tasks, Calendar), Records (Inbox, Documents, Agreements, Finance), Practice (Reports, Templates, Settings). Source review sits under Templates with an attention count. Firm switcher. Permission-scoped search. Quick-create only offers allowed actions. 768–1279 px: rail or drawer; <768 px: drawer with one column and no page overflow. **Client shell:** firm logo, matter switcher, one next-action panel; mobile nav Home/Tasks/Messages/More; everything within 2 taps; locked family records say permission is needed without revealing content. **Admin shell:** labelled header, ops cards; client content is never the landing view.

**Components:** primary button 44 px tall, one per task, with states default, hover, focus-visible, pressed, disabled (with reason), loading (blocks double-submit), success, retryable failure. Panels: white, 12 px radius, 24 px padding, no shadow. Status badges always carry a label. Tables: 48 px rows (40 px dense staff mode), captions, sortable headers, "select page" distinct from "select all matching". Drawers protect unsaved changes. Modals trap focus. Plus Source details, Alert (persistent while action is needed), Toast (supplementary only), File card, Timeline event. Icons are 20 px line style.

**Status colours:** neutral (draft, archived), blue (current work, "Submitted by firm"), amber (attention, due soon, source review required), red (failure, overdue), green (verified completion of the named task: signed, reconciled, "accepted by firm"). Green is not approval. Refusals are shown respectfully, with no red page backgrounds.

**Screens specified:** landing page, firm overview (4 counts: tasks due, docs awaiting review, blocked matters, financial exceptions; no approval-rate KPI), matter overview (stage, gov status and finance status visually separate), client home and intake (never "70% approved"), document upload/review (split view), source review and template editor (Capture evidence / Request review / Approve / Publish / Suspend; **no generic Verified switch**), agreements and finance (separate tabs; Paid ≠ Reconciled), correspondence and decisions.

**A11y and i18n:** contrast 4.5:1 text, 3:1 large text and UI, 2 px focus ring with offset, 44×44 targets, error summaries, live regions, no drag-only interactions, layouts tolerate 30% FR text expansion, CAD shown where ambiguous, client language kept separate from source language. Every screen has loading, empty, filtered-empty, validation, provider-failure, denied, offline and stale states. Saved status only after the server confirms. **Deliverables:** 1440 desktop and 390 mobile, validated at 360/768/1024/1280.

---

## 11. TASKS backlog (T001–T050)

D001–D004 are DONE (documents only). Owners: PO, ENG, UX, PRO (qualified immigration reviewer), SEC, FIN, OPS. Statuses: TODO / IN_PROGRESS / BLOCKED / REVIEW / DONE.

**Phase A: Scope and foundations**
| ID | Owner | Deps | Task |
|---|---|---|---|
| T001 | PO, PRO | — | Confirm country, provinces, segment, first program(s), reviewer, pilot firms |
| T002 | PO | — | Brand clearance |
| T003 | PO, PRO, FIN, SEC | T001 | Responsibilities and contracts; agreements, client funds, privacy, retention review; decision register |
| T004 | UX, PO | — | Interview ≥3 firms, test prototypes |
| T005 | ENG | — | Repo, deps, CI, env separation, migrations, secrets, lint/typecheck, region decisions |
| T006 | ENG, SEC | T005 | Identity, staff/admin MFA, invites, membership, session revocation |
| T007 | ENG, SEC | T006 | Tenant + matter authz + household/person grants; negative tests |
| T008 | ENG, SEC | T005 | Append-only audit events |
| T009 | UX, ENG | T005 | Design tokens, accessible primitives, shells, error/loading patterns |
| T010 | ENG, OPS | T005, T008 | Outbox, durable jobs, webhook verify, dedupe, retry, DLQ, replay |

Gate A: isolated dev/staging; tenant + household authz tests pass; no prod data needed.

**Phase B: Official-source governance**
| T011 | ENG, PRO | T005, T008 | Source/snapshot/evidence/rule-version/reviewer/pack schemas |
| T012 | ENG, SEC | T010, T011 | Allowlisted fetcher with SSRF controls, hashing, snapshots |
| T013 | ENG, PRO | T006, T009, T011 | Source-review workbench + enforced lifecycle |
| T014 | PRO, PO | T001, T003, T013 | First real program source pack (signed review) |
| T015 | ENG, PRO | T011, T013 | Deterministic rule engine, missing-input results, pinned bindings, impact preview |
| T016 | ENG, OPS, PRO | T010, T012, T015 | Scheduled monitoring + escalation |
| T017 | UX, ENG | T009, T013, T015 | Source context in UI |

Gate B: fictional content OK; no production program logic until T014 is approved.

**Phase C: Onboarding, leads, intake, engagement**
| T018 | ENG, PRO | T006, T007, T009 | Firm onboarding, roles, branding, licence evidence |
| T019 | ENG, UX | T007, T009 | Lead pipeline, consultations, dedupe suggestions, conversion |
| T020 | ENG, UX, PRO | T007, T009, T015 | Versioned conditional intake, autosave, household, restricted sections |
| T021 | ENG, SEC | T006, T007, T020 | Client invites, adult/guardian/employer permissions, consent, mobile |
| T022 | ENG, PRO | T003, T008, T009, T018 | Service agreements, signatures, amendments |
| T023 | ENG | T019, T020, T022 | Matter creation, program, consultant, **stage transitions**, engagement prerequisites |

Gate C: fictional prospect → engaged client with signed agreement, scoped household, resumable intake.

**Phase D: Evidence and preparation**
| T024 | ENG, SEC | T007, T010 | Private upload, quarantine, checksum, versions, signed downloads |
| T025 | ENG, UX, PRO | T015, T023, T024 | Rule-derived doc requests, review, versions, expiry, translation |
| T026 | ENG, PRO | T010, T023 | Tasks, dependencies, reminders, deadline evidence, TZ tests |
| T027 | ENG, PRO | T015, T020, T025 | Preparation workspace, conflict flags, form mapping |
| T028 | ENG, PRO | T013, T015, T027 | Readiness checks, immutable manifest |
| T029 | ENG, SEC, PRO | T007, T017, T024, T027 | Optional AI extraction/drafts |

Gate D: every prepared item traces to evidence or an approved rule; reopening keeps package versions.

**Phase E: Finance and communication**
| T030 | ENG, FIN | T003, T008, T023 | Quotes, invoices, classifications, tax, credits |
| T031 | ENG, FIN, SEC | T003, T010, T030 | Payment provider, firm accounts, webhooks |
| T032 | ENG, FIN, PRO | T030, T031 | Client-account ledger, transfers, reconciliation |
| T033 | ENG, FIN | T031, T032 | Instalments, receipts, refunds, disputes |
| T034 | ENG, UX, SEC | T007, T009, T010, T023 | Messaging, notes, notifications, delivery failure |
| T035 | ENG, UX | T021, T025, T026, T030, T034 | Client home |

Gate E: reconciliation under duplicates and failures; PRO + FIN approve the client-money workflow before real collection.

**Phase F: Submission, decisions, ongoing service**
| T036 | ENG, PRO | T022, T028 | Manual submission handoff with evidence |
| T037 | ENG, PRO | T024, T026, T034, T036 | Correspondence, requests, deadlines |
| T038 | ENG, UX, PRO | T036, T037 | Decision recording |
| T039 | ENG, PRO | T015, T026, T038 | Post-decision, expiries, renewals, linked matters |
| T040 | ENG, PRO, SEC | T003, T008, T024, T038 | Closure, export, legal holds, retention, deletion |

Gate F: synthetic case from intake to closure, plus refusal and additional-document-request branches.

**Phase G: Operations and launch**
| T041 | ENG, PO | T008, T023, T030, T038 | Dashboards and reports |
| T042 | ENG, PO, FIN | T010, T018 | SaaS subscriptions, seats, entitlements |
| T043 | ENG, SEC, OPS | T006, T007, T008 | Support grants, incident workflow |
| T044 | ENG, OPS, SEC | T007, T024, T040 | Migration tooling |
| T045 | SEC, ENG | T007, T012, T024, T031, T043 | Independent security review |
| T046 | UX, ENG | T035, T038 | Accessibility acceptance |
| T047 | ENG, OPS | T010, T024, T040 | Backup/restore, outage, load tests |
| T048 | PRO, FIN, SEC, PO | T014, T016, T032, T036, T040, T045 | Professional, privacy, finance release review |
| T049 | PO, OPS | T041, T042, T044, T046, T047, T048 | Controlled pilot |
| T050 | PO, OPS, ENG | T049 | Launch |

Smallest meaningful pilot: one narrow reviewed program, covering intake → evidence → tasks → comms → approved finance workflow → preparation → manual submission → decision. A lead CRM alone is not the product.

**Roadmap (PRD §24, estimates):** Discovery wk 1–3 · Secure foundation 4–7 · Client engagement 8–12 · Casework and finance 13–18 · Decisions and ops 19–23 · Validation and launch 24–28 · Contingency and AI 29–32. Assumed team: PO, designer, 2 FE, 2 BE, QA, part-time infra/sec, licensed reviewer. A smaller team should **extend the schedule rather than cut controls**.

**PRD dependency chain:** tenant isolation → sensitive data; person relationships → family portal; fact/doc versioning → form population; agreement execution → engagement gates; ledger → payment automation; outbox/queues → critical reminders; package manifests → submission release; retention/export → production onboarding; AI reuses all existing controls.

---

## 12. Open decisions and risks

**Decisions the PRD requires before engineering commitments (§26):** launch jurisdictions/provinces; 3–5 deep program packs; government form output formats; payment provider and client-account arrangement; signing provider; Canadian hosting procurement; support coverage; pricing allowances; brand name (architecture doesn't depend on the name).

**Risk register:** professional scope (founder + reviewer); client advances and processor suitability (manual workflow first); government integration expectations (manual handoff); regulatory and form drift (versioned sources); family confidentiality (person-level grants); brand; retention cost after cancellation; AI accuracy and data transfer; migration confidence; feature parity (paid pilots).

**Engineering-specific risks I'd flag:**
- **Neon vs Canada residency.** Francis has a Neon connection, but the spec says Neon had no Canadian region when reviewed. Choosing Neon contradicts "Canada-region DB" unless a Canadian region or a contract exists. AWS RDS/Aurora ca-central-1 is the obvious default.
- **Erode-only typography** clashes with DESIGN.md (no decorative serif for IDs, finance or forms; tabular numerals; 16 px inputs). Erode also needs a licence check for self-hosting (Fontshare/ITF terms) and confirmed tabular-figure support.
- The RLS + connection pooling (transaction-local `SET LOCAL`) pattern has to be proven early, along with any pooler such as PgBouncer in transaction mode.
- Next.js server components/route handlers must never become a second authorization path. Keep all policy in `packages/domain`.
- Partial-date, date-only and TZ types need to be settled in the schema on day one; retrofitting them is expensive.
- Finance ledger design needs accountant review (FIN-12) before production. Building against synthetic fixtures is fine.
- The staffing assumption is 4 engineers + QA + reviewer. With fewer people the schedule stretches.

---

## 13. Proposed engineering start order

Everything below can start with **synthetic data and no immigration content**, so it isn't blocked by T001/T014.

1. **T005 Repo and platform skeleton:** pnpm/turbo monorepo with the ARCH layout; TS strict; lint and format; CI (typecheck, migration check, tests, dependency scan); env separation; secrets manager; migration tool (e.g. Drizzle/Kysely + SQL migrations); Postgres in the chosen region (or local Docker until hosting is decided). Record region and vendor decisions in MEMORY.md.
2. **DB foundations:** shared column conventions, `version` + optimistic-lock helper, `organization_id` composite FKs, RLS policies + non-owner app role + `withTenant(tx)` wrapper, pool-reuse leak tests. Date, partial-date, money (minor units + currency) and instant types.
3. **T008 Audit events:** append-only table, redacted diff, request/correlation ID middleware, denied-access logging.
4. **T006 Identity:** global User, Membership, invites (expiring, single-use), staff MFA (TOTP/WebAuthn), session inventory and revocation, step-up hook. Decide build vs IdP (Clerk is connected, but its residency needs review).
5. **T007 Authorization policy engine** in `packages/domain`: role + assignment + relationship + audience + grant evaluation. A negative test suite for URL guessing, search, export, storage and jobs. Household ≠ permission.
6. **T010 Outbox, jobs, webhooks inbox:** transactional outbox, worker with idempotency keys, retry/backoff, DLQ, replay, provider event dedupe on (provider, account, event_id). API conventions (Idempotency-Key, 409/422/429, cursor pagination, request IDs).
7. **T009 in parallel with the designer:** tokens as CSS variables (#0075DE / #F6F5F4 / #111, Erode), primitives, firm and client shells.
8. **Then T011 (source-governance schemas, publication validator that rejects the RULES §5 sample), T023 matter + stage state machine** (transition table with entry-evidence guards, `expected_version`, reason, history, on-hold flag, independent dimensions) **plus T018/T019**, followed by T024 uploads and the T030–T032 ledger core against fixtures.

Gate A evidence to produce: isolated dev/staging, a passing cross-tenant and household authz test suite, audit trail demo, duplicate webhook → one effect.
