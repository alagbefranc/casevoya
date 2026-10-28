# Immigration Consultancy Platform Product Requirements

Working name Casevoya

Version 1.1 | 14 October 2026 | Product owner Francis Alagbe

This specification defines a complete subscription software platform for licensed immigration consultancies and their clients. It covers acquisition, consultation, engagement, intake, case preparation, documents, payments, authorized submission handoff, government correspondence, decisions, renewals, closure, and record retention. It is intended for the founder, product designer, engineering team, licensed practice reviewer, and implementation partners.

The recommended product is a multi-tenant B2B2C platform: consultancies purchase the software, their staff manage matters, and clients use a branded portal. The software company supplies technology and operational support. Each consultancy remains responsible for its professional services, advice, representation, fees, and client records. Government authorities determine immigration outcomes.

Canada is the proposed first jurisdiction. Other countries are supported through future jurisdiction packs rather than shared, hard-coded immigration rules. This document separates proposed product decisions from sourced regulatory context. Prices, timelines, and success targets are planning hypotheses, not market findings or contractual commitments. The complete scope is delivered in dependency-based releases; the early releases are not the final product.

## Document package and authority

This is the complete product specification in the six-file developer handoff. Read [RULES.md](RULES.md) first for the mandatory official-source policy; [MEMORY.md](MEMORY.md) records confirmed instructions and unresolved assumptions. [ARCHITECTURE.md](ARCHITECTURE.md) specifies implementation boundaries, [DESIGN.md](DESIGN.md) specifies the visual and interaction system, and [TASKS.md](TASKS.md) orders delivery. These documents describe proposed software; they do not certify an implemented or legally approved system.

Version 1.1 adds official-source publication gates and adopts the user's Refero reference. It supersedes version 1.0's navy/teal visual direction. Sections 1–28 preserve the full product scope; section 29 adds binding requirements for sourcing and design. The S-series research sources in section 28 remain a research record; the O-series source directory and ongoing evidence protocol live in RULES.md. A directory entry is not approval of every claim on that site.

## 1 Product strategy

### Problem and intended outcome

Consultancies often coordinate work across spreadsheets, email, messaging apps, calendars, payment tools, document folders, and government portals. Staff repeatedly request the same information, clients cannot distinguish a firm task from a government delay, and managers lack a reliable view of deadlines, incomplete files, and outstanding fees.

Casevoya should become the operational record for the practice and the client-facing place for every requested action. The product promise is clear next steps, accountable casework, and traceable records. It must never promise approval, preferential government treatment, or a guaranteed processing time.

### Target customers

- Primary buyer: owner or managing consultant of a Canadian immigration consultancy with 1 to 20 staff.
- Primary operators: licensed consultants, case managers, administrative assistants, finance staff, and practice managers.
- End users: applicants, sponsors, adult dependants, authorized guardians, and invited employer contacts.
- Secondary market: larger multi-office practices requiring SSO, granular permissions, integrations, and migration support.
- Later expansion: immigration lawyers and additional countries, each requiring its own professional and jurisdictional review.

### Product boundaries

The platform manages work and evidence; it does not become the client's immigration representative. Automated advice, autonomous government submissions, guaranteed eligibility, visa probability scores, an unrestricted public adviser marketplace, pooled client-money custody, and the sale of client data are excluded. Referral commissions are not part of the proposed business model. A future referral feature requires separate professional-conduct review.

The client relationship belongs to the consultancy. The platform's subscription contract is with the consultancy; the professional service agreement is between the consultancy or licensee and client. Clients accept portal terms and receive privacy information, but are not automatically customers of a separate immigration advisory service run by the software company.

### Competitive context and differentiation

Officio advertises Canadian immigration form population and case management. CaseEasy advertises client management, process automation, compliance features, and optional AI capabilities. ImmiCompliance advertises questionnaires, forms, reminders, and workflow management. These are vendor claims, not independently tested results. A generic CRM plus an AI chat window is therefore insufficient differentiation. [S9–S11]

The proposed advantage is the quality of the connected client journey: explainable next actions, structured family permissions, reusable verified information, document review with visible reasons, financial separation, decision follow-up, and a complete audit trail. Validate this advantage through observed pilot use; do not claim competitors lack these functions without testing them.

## 2 Naming and brand direction

### Preliminary shortlist

| Candidate | Meaning and fit | Screening outcome |
| --- | --- | --- |
| Casevoya | Case plus voyage; recognizable as case software and broad enough for expansion | Recommended working name; no obvious exact commercial match surfaced |
| Dossivana | Dossier inspired; distinctive and suited to professional records | No obvious exact commercial match surfaced; pronunciation needs testing |
| Retainivo | Retainer inspired; suitable for a professional practice platform | No obvious exact commercial match surfaced; less clearly immigration related |

On 14 October 2026, exact-name web searches and searches including the corresponding .com and .ca strings returned no obvious commercial match for the shortlisted names. This is an indexed-web screen only. Domain registration, reserved or premium domain status, corporate names, social handles, unindexed businesses, and trademark availability are unverified. None of these names is represented as legally available or reserved.

Retainora was rejected because an active business already uses that name. ImmiLoom was rejected because an immigration-related page already uses it. These examples demonstrate why invented-sounding names still require checking. [S14–S15]

Before brand investment, check live registrar availability for the preferred .com and .ca, relevant corporate registries, CIPO exact and confusingly similar marks, phonetic variants, French equivalents, and target-market trademark databases. CIPO recommends looking beyond exact names, including phonetic equivalents and translations. Obtain professional clearance where appropriate and register approved assets together. [S12]

### Proposed identity

Use Casevoya in product mockups until clearance. Suggested descriptor: Immigration practice management. Suggested value statement: Every client, document, deadline, and payment in one place. The visual direction follows the supplied Refero reference, adapted in DESIGN.md: warm off-white canvas, white panels, near-black text, restrained blue actions, thin borders, and status colors paired with labels. Avoid government seals, official-looking approval badges, and celebratory graphics on incomplete applications.

## 3 Commercial model and packaging

### Revenue structure

Sell a monthly or annual subscription per firm with included staff seats, active-matter capacity, storage, and metered AI or messaging allowances. Clients and invited family members should not consume paid staff seats. Charge separately for optional migration services, custom integrations, dedicated infrastructure, and additional usage. Clients pay professional fees to their consultancy; those payments are distinct from the consultancy's SaaS subscription.

Do not charge for an approval or take a percentage of government fees. Start without a payment transaction markup to keep the financial model simple. Any later platform payment fee requires transparent disclosure, processor approval, and review of the funds flow.

| Proposed plan | Monthly CAD hypothesis | Included staff | Active matters | Main fit |
| --- | --- | --- | --- | --- |
| Solo | 129 | 2 | 100 | Independent consultant and assistant |
| Practice | 299 | 6 | 500 | Growing practice |
| Firm | 599 | 15 | 1500 | Multi-team consultancy |
| Enterprise | Quoted | Contracted | Contracted | SSO and dedicated requirements |

An active matter is any matter not archived or closed; on-hold and government-processing matters count. Additional staff seats are proposed at CAD 25 per month. Storage allowances, archive retention costs, and AI quotas must be costed before final pricing. Do not advertise unlimited storage or unlimited AI. Essential security, client export, and required retention controls are available on all plans. Enterprise features add administration, not basic protection.

Offer a 14-day trial using sample data or a verified firm's controlled pilot. An unverified firm may explore a sandbox but cannot invite real clients. Trial expiry does not silently delete records. Annual discounts, migration fees, and grandfathering policies are configuration, not source-code constants.

### Business validation

Recruit 5 to 10 design-partner firms, including a solo practice and a team with finance staff. Observe existing intake and preparation workflows before setting baselines. Test willingness to pay with a concrete demonstration and paid pilot agreement. Track cost to serve by firm, particularly document storage, support, OCR, AI, and onboarding. Validate whether clients prefer browser access before investing in native mobile apps.

## 4 Product surfaces and information architecture

### Public marketing site

Required pages: home, product overview, consultant workspace, client portal, security and privacy, pricing, integrations, migration, demo booking, contact, help centre, terms, privacy notice, subprocessors, accessibility, and service status. The main actions are Book a demo and Start a trial. Demonstrations must use fictional data. Publish only verified customer testimonials and permissioned logos.

### Firm workspace

Primary navigation: Overview, Leads, Clients, Matters, Tasks, Calendar, Inbox, Documents, Agreements, Finance, Reports, Templates, and Settings. The overview prioritizes due tasks, blocked cases, documents awaiting review, unsigned agreements, unread client messages, and financial exceptions. Every queue supports owner, office, program, priority, and date filters.

The matter workspace contains Overview, People, Intake, Documents, Forms, Tasks, Messages, Agreements, Billing, Submissions, Decisions, and Audit. Display the responsible consultant, current stage, next action, blockers, nearest deadline, and last verified update at the top.

### Client portal

Navigation: Home, My matters, Tasks, Documents, Messages, Appointments, Agreements, and Payments. The home page answers: What do I need to do, by when, who is working on my case, and what happens next? Show uploaded versus accepted documents separately. Use plain-language progress stages rather than an invented percentage of approval.

### Platform administration

It is a separate portal with its own codebase, deployment and sign-in (Francis, 2026-10-19; see `docs/DECISIONS.md` and `docs/integrations/support-access.md`), not part of the firm or client app. Navigation: Firms, Verification, Subscriptions, Usage, Service health, Support grants, Template releases, Incidents, Privacy requests, Audit, and Configuration. Platform employees normally see operational metadata only. Client files require an explicit time-limited support grant or a documented emergency procedure. There is no silent unrestricted impersonation button.

### Responsive design and accessibility

Support desktop firm operations and mobile-first client tasks from 360 px width. Target WCAG 2.2 AA, keyboard navigation, visible focus, screen-reader labels, accessible validation, and sufficient contrast. Every core screen requires loading, empty, error, denied, offline, and retry states. English and French are launch languages for the interface; translated professional templates require separate review. Store language and timezone per person.

## 5 Roles and authorization

Authorization combines organization membership, role permissions, matter assignment, person relationship, document audience, and explicit grants. Server checks apply to every read and write, search result, download, export, background job, and integration event.

| Role | Default access | Restricted operations |
| --- | --- | --- |
| Platform administrator | Firm configuration and service metadata | No routine client content or consultant decisions |
| Firm owner | Firm administration, billing, staffing and assigned access policies | Legal sign-off requires an appropriately authorized consultant role |
| Licensed consultant | Assigned matters, advice, review and release decisions | Cannot exceed recorded licence scope |
| Case manager | Assigned intake, documents, tasks and drafts | Cannot independently release professional advice or final submission |
| Assistant | Explicitly assigned operational work | No default access to restricted records or finance approvals |
| Finance user | Agreements needed for billing, invoices and ledgers | No default medical, criminal-history or narrative access |
| Client or adult dependant | Own authorized matters and audience-scoped records | No access to another adult's private data by household membership alone |
| Sponsor or employer contact | Specific requested fields and shared records | No automatic applicant-wide visibility |
| Guardian | Verified authority for identified dependent persons | Authority is scoped, reviewed and revocable |
| External collaborator | Named documents or tasks until expiry | No directory browsing or bulk export |

Owners may hold multiple roles but must have a verified licence for regulated actions. Permissions can be further restricted by office and team. Users belonging to multiple firms choose an active workspace; identities and client records are never silently merged across firms.

Adult dependants receive individual invitations and consent controls. Shared family views expose only approved shared information. A sponsor paying an invoice does not acquire access to the applicant's confidential records. When a child reaches the configured age-of-majority review trigger, create an authority-review task; do not assume the same age rule applies everywhere.

## 6 End to end journeys

### Firm activation

1. Owner creates an account, verifies email, enables MFA, and enters firm details.
2. Owner accepts subscription terms and data-processing terms, names a privacy contact, and selects jurisdictions.
3. Each consultant provides regulator, licence number, permitted scope, and verification evidence.
4. Platform reviewer records register-check result, source, timestamp, reviewer, and next review date.
5. Owner configures branding, roles, service templates, calendar, payment destination, and retention policy.
6. A sample case proves intake, agreement, upload, reminder, invoice, and export before real-client invitations are enabled.

### Client engagement through decision

1. Prospect submits minimal enquiry or staff create a lead with source and contact preference.
2. Staff complete a conflict screen and book an initial consultation where appropriate.
3. The firm issues the appropriate consultation agreement, collects payment if applicable, and records the consultation.
4. Consultant reviews facts and proposes a defined service. An accepted quote alone is not a signed service agreement.
5. Required parties sign the service agreement; the firm records representation authority and any advance payment in the appropriate workflow.
6. Staff create a matter from a versioned jurisdiction and program template, assign its consultant, and invite relevant people.
7. Clients complete questionnaires, upload evidence, review corrections, sign documents, and pay invoices.
8. Staff review information and resolve inconsistencies. The consultant approves the exact submission package version.
9. An authorized representative submits through the applicable official channel and records proof in Casevoya.
10. Staff record requests, deadlines, receipts, and verified updates; clients receive action requests and approved explanations.
11. Consultant verifies the decision and communicates next steps. Follow-up may include permits, conditions, document delivery, further services, or specialist referral.
12. The firm settles the file, completes closure requirements, exports the client copy, and applies retention.

### Refusal or withdrawal

A refusal is recorded with its decision document, received date, confirmed outcome, and responsible reviewer. Create an urgent consultant-review task for any possible deadline, but do not calculate appeal or judicial-review rights from a generic rule. Any reconsideration, appeal, review, or new application becomes a separately scoped linked matter. Withdrawal requires recorded instructions, consultant review, applicable government steps, and financial reconciliation; changing a CRM stage does not withdraw an official application.

## 7 Case states and transition rules

Lead lifecycle: New, Contacted, Consultation scheduled, Consultation completed, Qualified, Proposal sent, Converted, Lost, or Archived. Store lost reason separately. Multiple leads may relate to one person without automatically creating multiple people.

Matter stage describes firm work. Government status describes externally reported processing. Financial status, engagement status, and document completeness are independent dimensions. A paid invoice must never change a government outcome.

| Matter stage | Required entry evidence | Typical next stage |
| --- | --- | --- |
| Engagement pending | Named consultant and proposed scope | Intake |
| Intake | Executed service agreement or documented applicable exception | Evidence collection |
| Evidence collection | Questionnaire assigned | Preparation |
| Preparation | Required facts reviewed and blockers tracked | Consultant review |
| Consultant review | Draft package version and review checklist | Client confirmation or Preparation |
| Client confirmation | Consultant-reviewed package ready for client review | Ready to submit or Preparation |
| Ready to submit | Valid approvals, required authority and completed checklist | Submitted |
| Submitted | External reference, submission time and receipt evidence | Government processing |
| Government processing | Verified submission | Decision review or continuing processing |
| Decision review | Official decision evidence | Post decision |
| Post decision | Consultant-confirmed outcome and follow-up plan | Closed |
| Closed | Closure checklist complete and retention date calculated | Reopened through controlled action |

On hold is a separate flag with reason, owner, and review date, not a reason to stop government-deadline alerts. An additional document request creates a tracked event and response workstream while the government status remains distinct. Outcomes include Approved, Refused, Withdrawn, Returned or incomplete, Abandoned, and Other verified outcome. Pending is not an outcome.

Stage changes require permission, expected record version, timestamp, actor, and reason. Reversing a stage preserves history and cancels only obsolete future automation. Editing a reviewed field or document invalidates dependent approvals and requires a new package version. Reopening a closed file preserves its prior closure event and recalculates retention under the configured policy; a materially new service normally becomes a new linked matter.

## 8 Firm onboarding and licence controls

ORG-01: Create organizations with legal name, display name, office addresses, jurisdiction coverage, billing contact, privacy contact, locale, timezone, and custom branding. A unique organization ID is the tenant boundary.

ORG-02: Invite staff by email with expiring single-use invitations. Require MFA for staff and platform personnel. Support secure recovery with an audit record and session revocation.

ORG-03: Record consultant credentials separately from login identity. Capture regulator, licence number, authorized category or scope, verification status, last check, evidence, and review date. IRCC identifies authorized representative categories and recommends checking good standing. [S1]

ORG-04: Permit manual public-register verification at launch. Do not assume a register API or permission to scrape. Use a proposed monthly review cadence plus event-triggered review for reported changes; this cadence is a product control, not a claim about a statutory interval.

ORG-05: If credentials expire or adverse status is confirmed, suspend that individual's new engagements and professional-release actions, alert the owner, and reassign work through an approved process. Preserve authorized continuity access, client exports, and urgent deadline monitoring.

ORG-06: Maintain a named continuity contact and succession procedure for incapacity, closure, or staff departure. Revoke departing staff access, reassign open tasks and deadline ownership, and review client authority before moving matters. A receiving firm gets a permissioned export and separately verified onboarding; the platform does not transfer confidential records merely because another firm requests them.

Acceptance: An unverified firm can explore fictional cases but cannot invite a real client. A case manager cannot release a submission even if they are also a billing administrator. A credential suspension leaves existing evidence and audit history intact.

## 9 Lead management consultations and intake

CRM-01: Provide embeddable enquiry forms and a hosted firm-branded page. Collect name, preferred contact, broad service interest, current country, language, consent records, and source attribution. Defer passports and detailed sensitive histories until needed.

CRM-02: Support pipeline views, assignment, notes, tags, follow-up tasks, deduplication suggestions, opt-out status, and CSV import. Matching uses multiple attributes and human confirmation; never merge solely on a shared family email.

CRM-03: Provide appointments with staff availability, duration, buffer, timezone, rescheduling, cancellation, capacity, meeting link, and no-show status. Calendar connection is scoped to selected calendars. Concurrent booking must not allocate the same capacity twice.

CRM-04: Support versioned consultation agreements, booking fees, reminders, recorded notes, and consultant-reviewed outcome summaries. The professional consultation agreement and later service agreement are distinct records. Current professional rules address both. [S2]

Any consultation charge collected before service delivery follows the advance-payment controls in section 13. Booking software must not bypass those controls by labelling an advance as an earned booking fee.

INT-01: A versioned form builder supports text, dates, country lists, addresses, repeatable histories, relationships, declarations, file requests, conditional sections, and multilingual labels. The form schema uses stable field keys independent of display labels.

INT-02: Include factual intake packs for temporary residence, study, work, permanent residence, sponsorship, citizenship, and provincial workflows. Published packs require a licensed reviewer and effective date. These are workflow categories, not a representation that every program or government form is already mapped.

INT-03: Autosave authenticated answers, display saved time, allow save-and-return, and show field-level errors. Support unknown, not applicable, and approximate dates distinctly. Never fabricate a complete date from a partial date.

INT-04: Record provenance for every material fact: person, field, raw value, normalized value, source document or answer, submitting actor, timestamp, review state, and superseded value. Reuse approved facts in later matters only after client reconfirmation and staff review where required.

INT-05: Flag overlapping or missing history periods, conflicting birth dates, inconsistent names, and expired evidence as review items. An inconsistency flag is not a fraud finding. Include aliases, transliterations, multiple passports, and changing addresses without overwriting history.

INT-06: Clients can request correction after submission. A correction produces a new version and alerts affected matters. Staff can freeze a submitted snapshot while the live person profile continues to change.

Acceptance: A conditional question becomes required only when its published rule applies. A saved draft survives interrupted connectivity. Changing a passport number creates a new fact version and flags any dependent prepared package. Two unrelated people sharing an email remain separate.

## 10 Engagement agreements and signatures

AGR-01: Build quotes with scope, services, exclusions, deliverables, professional fee structure, applicable taxes, disbursements, government fees, instalments, refund policy, and expiry. Government fees are dated references or manually entered amounts with source; never silently reused from an old schedule.

AGR-02: Generate agreements from approved templates with consultant identity, client parties, scope, responsibilities, communication terms, fee disclosures, complaints information, and termination provisions. A professional reviewer owns mandatory clauses; the platform does not certify an agreement's legal sufficiency. The Code requires written service agreements and addresses prescribed content, copies, and amendments. [S2]

AGR-03: Support multiple signers, signing order, signer authentication, consent to electronic signing, delivery evidence, document hash, signed PDF, completion certificate, and provider event IDs. Ordinary service agreements and government forms have separate signature rules; do not assume one e-sign method works for both.

AGR-04: Amendments create a new agreement version with a comparison and renewed signatures where required. The executed original cannot be edited. Declined, expired, voided, and partially signed envelopes retain their event history.

AGR-05: Representation authority is recorded independently from a commercial agreement, including scope, government form or authority evidence, effective date, and revocation. Signing a service agreement does not automatically prove government representation authority.

Acceptance: Changing fees after one signer has signed invalidates the current envelope and creates a new version. Duplicate signature webhooks cannot execute the agreement twice. Every party can retrieve the exact executed version they signed.

## 11 Documents evidence and case preparation

DOC-01: Generate per-person and per-matter checklists from program templates and conditional intake rules. Each item has type, explanation, owner, due date, acceptable formats, review criteria, optional expiry, and audience.

DOC-02: Accept PDF, JPEG, PNG, HEIC, and DOCX where appropriate. Default upload limit is 25 MB per file; administrators can configure up to 100 MB after infrastructure validation. Verify actual file type, quarantine for malware scanning, and retain originals. Convert previews separately. Do not execute macros or trust filename extensions.

DOC-03: Provide camera capture, multi-page assembly, rotation, ordering, and readable previews. Compression must not replace the original or make text illegible. A derivative keeps parent version and transformation metadata.

DOC-04: States are Requested, Uploaded, Quarantined, Awaiting review, Accepted, Changes requested, Expired, and Superseded. Each review includes actor, time, reason, and optional annotations. Accepted means accepted by the firm for the specified purpose, not validated by government.

DOC-05: Support OCR extraction with confidence and source-page anchors. Staff confirm identity numbers, names, and dates before they become approved facts. Unreadable fields remain unknown. AI or OCR never silently replaces source data.

DOC-06: Store document versions, hashes, classifications, translation relationship, person ownership, visibility, expiry, and retention link. The same verified evidence can be referenced in several matters with explicit access checks. Deleting one reference must not remove evidence still required by another matter.

DOC-07: Support secure preview, authorized download, short-lived retrieval links, download audit, redacted copies, and original-document custody tracking. Custody records include received date, location, purpose, recipient, return date, and acknowledgement.

PREP-01: Form templates carry jurisdiction, program, official form identifier, official URL, form version, mapping version, effective date, and supported output format. Publish a visible support catalogue. Unsupported or dynamic forms use manual completion and controlled upload.

PREP-02: Map approved facts into supported forms and show a source-to-field review screen. Do not claim universal support for barcode or dynamic government PDFs. Validate supported outputs in the official required tool or format before release; preserve barcode and validation behavior where applicable.

PREP-03: Assemble document indexes, cover letters, evidence bundles, and checklists. Consultant-reviewed narrative drafts must distinguish evidence from inference. Export naming and file-size rules are controlled by the selected channel template.

PREP-04: A package manifest records every included document version and hash, form version, approved facts snapshot, approval events, and export timestamp. Any material change invalidates the prior release approval.

Acceptance: A file uploaded with a misleading extension is rejected or quarantined. A replacement passport leaves the old submitted package reproducible. A new template release never silently modifies an existing package. A finance user cannot preview a restricted narrative through the document search index.

## 12 Tasks deadlines communication and automation

OPS-01: Tasks support owner, watcher, dependency, priority, due date, due timezone, checklist, estimated effort, status, blocker, and escalation. Separate client tasks from internal tasks. Reassignment preserves history and informs the new owner.

OPS-02: Deadlines store source evidence, event date, receipt date, timezone, rule version if derived, calculation explanation, verifying consultant, and verification status. OCR-extracted dates are tentative until confirmed. Display the local deadline and relevant official timezone together when they differ.

OPS-03: Provide proposed reminders at 14, 7, 3, and 1 days before a deadline, where those offsets remain in the future. For short-notice requests, create immediate escalation. Overdue critical tasks escalate to the responsible consultant and owner. Holiday and business-day calculations require a jurisdiction-specific reviewed calendar and rule.

OPS-04: Offer secure matter messaging, staff-only notes, announcements, and message templates. Every message shows audience before sending. Support attachments by permissioned link, translation drafts, unread status, and acknowledgements for critical instructions.

OPS-05: Email and SMS notifications contain minimal content and a portal link. Do not put passport numbers, refusal details, medical information, or full attachments into notification previews. Separate service communications from marketing preferences and consent.

OPS-06: Connected email imports require user-selected scope and a matching preview. Unknown threads enter a triage queue. Forwarded email is not automatically proof that its sender may access the case. Record delivery failure and create a staff follow-up when a critical notice bounces.

OPS-07: The automation builder uses event, conditions, actions, delay, owner, and stop rules. Allowed actions include creating tasks, assigning staff, requesting documents, and sending approved administrative templates. Legal advice, refunds, new bank destinations, final outcomes, and submission releases require human approval.

OPS-08: Run jobs through durable queues with a unique execution key, retry policy, dead-letter queue, and visible history. Cancel obsolete pending reminders after a task is completed. Enforce quiet hours for routine client reminders; critical exceptions are clearly configured.

Acceptance: Retried workers send one logical reminder. A date change reschedules future notifications. A completed task cannot trigger a stale overdue notice. A message addressed to an employer cannot include a document limited to the applicant.

## 13 Payments invoicing and client accounts

### Three separate money flows

FIN-01: Maintain separate records for SaaS subscription payments from firms to the platform, professional fees from clients to firms, and government fees or third-party disbursements. No payment implies immigration approval or government receipt.

FIN-02: Use each firm's approved processor account for earned-fee checkout, initially considering Stripe Connect direct charges. Stripe describes direct charges as charges on the connected account. Refund liability and loss handling depend on the selected Connect configuration and must be confirmed before contracting. [S13]

FIN-03: Advance payments require a different workflow. The professional Code addresses holding advance funds in a client account and issuing receipts. A processor balance is not automatically an approved client account. Keep advance-payment card collection disabled until the proposed processor, bank destination, settlement, refund, and fee arrangement are approved for the practice. Provide a complete manual bank-transfer recording and reconciliation workflow meanwhile. [S2]

FIN-04: The software company never receives pooled client advances in its operating account. SaaS charges and processor fees must not be deducted from a client's protected balance. Funds movement and accounting records remain distinct: a ledger entry alone does not prove a bank transfer occurred.

### Billing capabilities

FIN-05: Invoices include unique firm-level number, matter, billing party, fee category, line description, quantity, unit amount, tax code, currency, issue date, due date, instalment link, and payment instructions. Store monetary values as integer minor units and an ISO currency code. Launch currency is CAD; data structures support other currencies without cross-currency allocation.

FIN-06: Support flat, hourly, milestone, and instalment billing, time entries, expenses, quotes, deposits recorded as advances, earned-fee invoices, credit notes, refunds, receipts, write-offs, disputes, and ageing reports. Tax rates and treatment are effective-dated and approved by the firm or its accountant.

FIN-07: Invoice states are Draft, Issued, Partially paid, Paid, Overdue, Voided, and Credited as applicable. Refunds and disputes have separate states. An issued invoice is immutable except through a permitted correction or credit-note process. Payment status is derived from allocations, not hand-entered text.

For the Canada RCIC configuration, an issued professional-services invoice requires recorded delivered services or incurred disbursements. Before that point, use a quote or advance-payment request rather than an earned-fee invoice. Advance receipts remain distinct. Add a dated follow-up for invoiced client-account withdrawals under the reviewed jurisdiction rule; do not automate transfers from a generic milestone alone. [S2]

FIN-08: Hosted checkout receives no sensitive case descriptions. Verify signed webhooks, processor account, amount, currency, and event identity. A successful browser redirect is not proof of payment. Deduplicate events by provider, connected account, and event ID; reconcile delayed and out-of-order events.

FIN-09: Manual payment entry requires method, external reference, received date, bank destination, evidence, amount, and reviewer. It remains pending verification until reconciled. Failed or reversed transfers reopen the relevant balance and create a task without silently changing the case stage.

### Client account subledger

FIN-10: Maintain per-client and per-matter subledgers, bank accounts, deposits, earned-fee transfers, refunds, and reconciliations. Every journal is balanced by currency and immutable once posted; corrections use reversing entries. No transaction may use one client's funds to cover another client's obligation.

FIN-11: Separate accrued earnings from transferred funds. A proposed earned-fee transfer references the invoice, service milestone, authorizing user, client balance, amount, and bank transaction. It cannot exceed available client funds or eligible earned charges. Two-person approval is default for firms with appropriate staffing; solo practices record a self-approval and explicit reason.

FIN-12: Provide a monthly three-way reconciliation workspace comparing adjusted bank balance, control ledger, and total client subledgers, with outstanding items and signed review. The accountant and practice reviewer must validate the chart of accounts and reports before financial production use.

FIN-13: Support partial refunds, processor failures, chargebacks, overpayments, and cancelled instalment schedules. Refunding a payment is not the same as crediting an invoice. Preserve allocation links and avoid duplicating a bank refund when a processor refund is pending.

Acceptance: Receiving CAD 1000 in advance creates a client-funds liability, not earned revenue. An authorized CAD 300 earned-fee transfer leaves CAD 700 available, assuming no other movements. A duplicate payment event does not double the balance. A CAD payment cannot pay a USD invoice. A disputed payment never causes automated deletion or withholding of required client records.

## 14 Government handoff decisions and post decision services

GOV-01: Create a submission checklist tailored to program and channel. Require current representation evidence, released package version, reviewed deadlines, required signatures, and confirmed fee handling. Show which actions occur outside Casevoya.

GOV-02: The authorized representative submits through the applicable official channel. IRCC documents representative portals used to prepare, submit, link, and pay for applications. That does not establish a third-party API available to this product. Treat direct integration as uncommitted until access, authorization, supported actions, and terms are verified. [S3]

GOV-03: Record channel, application reference, submission timestamp, submitting representative, package manifest, receipt, and supporting evidence. Submission date and acknowledgment date are separate. If confirmation is missing, display Submission unverified rather than Submitted to government.

GOV-04: Staff record government correspondence through upload or reviewed email import. Store issuer, document date, received date, action requested, confirmed due date, evidence, and audience. One letter may create several tasks for different people.

GOV-05: Every government status has source, recorder, evidence, verified time, and last checked time. Client views clearly identify updates recorded by the firm. Do not display real-time tracking or automatic government synchronization unless an actual supported integration provides it.

DEC-01: Record a decision only with evidence and consultant confirmation. Differentiate approval in principle, final approval, document issuance, landing or confirmation, and status expiry where relevant to the program. Templates must not collapse these milestones into one universal Approved state.

DEC-02: Approved matters receive a program-specific follow-up checklist, document-delivery record, conditions summary approved by the consultant, relevant expiry reminders, and closure tasks. Renewal reminders require valid contact preferences and clearly defined scope for any new service.

DEC-03: Refusal, returned application, withdrawal, and abandonment each have separate playbooks. Store the authority's stated reasons separately from the consultant's interpretation. Create time-sensitive review tasks and linked future matters without predicting eligibility or legal remedies.

Acceptance: A payment receipt alone cannot set Submitted. A client-uploaded decision remains unverified until reviewed. A refusal creates urgent review without promising appeal rights. A stale status shows its last verified date.

## 15 AI assistance and content governance

AI-01: Optional capabilities are document classification, OCR normalization, missing-field detection, inconsistency flags, matter summaries, administrative reply drafts, and first drafts of letters from approved facts. The firm can disable AI while using core functionality.

AI-02: Each run records tenant, matter scope, model and configuration version, prompt-template version, allowed source IDs, output, source anchors, actor, cost, and review result. Minimize retained prompts and redact data unnecessary for the task. Protect AI logs under the same access and retention controls as case content.

AI-03: Outputs are drafts. A reviewer accepts, edits, or rejects them. Sensitive legal conclusions and client advice require the responsible consultant's review. AI cannot sign, submit, change bank details, issue refunds, infer an official decision, or silently alter approved facts.

AI-04: Use a curated jurisdiction-specific reference library with official source, effective date, review date, owner, and superseded status. A legal-content answer must cite an approved source and identify uncertainty. If the source is absent or stale, escalate to a consultant rather than guess.

AI-05: Treat uploaded text as untrusted content. Instructions inside documents cannot alter system policy, access permissions, recipients, or tool capabilities. Restrict retrieval by tenant, matter, person, and audience before content reaches the model. Apply the same restrictions to embeddings and caches.

AI-06: Contractually evaluate vendor data use, retention, processing region, subprocessors, and deletion. Do not train on client records by default. AI must be independently switchable by firm and sensitive document category. A non-AI workflow remains available.

AI-07: Before release, evaluate at least 200 permissioned synthetic or de-identified examples across noisy scans, multiple names, inconsistent dates, and multilingual documents. Proposed gates: at least 98 percent precision for accepted high-confidence identity-field suggestions, source anchors for every extracted material fact, zero unauthorized tool actions, and zero cross-tenant retrieval in adversarial tests. Measure accuracy per field and language; no score removes human review.

## 16 Privacy security retention and continuity

### Regulatory context and product posture

Canadian privacy obligations depend on the organization, activity, and applicable federal or provincial law. PIPEDA guidance emphasizes accountability when processing is outsourced and does not impose a blanket prohibition on foreign processing. Canada-hosted core records are a proposed procurement and trust choice, not a claim that every private-sector dataset must stay in Canada. [S5]

For applicable Quebec operations, conduct the required privacy assessments and review transfers outside Quebec before enabling affected processing. The CAI describes privacy assessment obligations and conditions around external transfers. Province-specific launch review is required rather than a universal PIPEDA compliant badge. [S6]

The College's published client-file regulation specifies a minimum six-year period after file closure. Use that as the Canada RCIC baseline after professional validation, with longer holds where required. Maintain a distinct policy for other professions and jurisdictions. [S4]

### Required controls

SEC-01: Enforce MFA for staff, secure session cookies, session inventory and revocation, login rate limits, credential-stuffing protections, and step-up authentication for exports, payment configuration, role changes, and sensitive downloads. Client MFA is available and required for high-risk actions; recovery must not rely on easily known biographical answers.

SEC-02: Encrypt transport and stored data. Store secrets in a managed secrets service and use managed encryption keys with rotation. Mask identity numbers in lists and logs. Never expose government credentials, payment keys, or AI keys in the browser.

SEC-03: All tenant tables use organization-scoped access controls and database row-level security where applicable. Object retrieval requires a fresh authorization decision. Use short-lived links, private buckets, malware quarantine, cache isolation, and non-public search indexes.

SEC-04: Audit authentication, grants, reads of sensitive records, downloads, exports, changes, signatures, financial events, template publication, and support access. Store actor, tenant, object, action, time, result, request ID, and redacted change summary. Do not duplicate full sensitive values into the audit stream. Protect logs from routine modification and alert on bulk access.

SEC-05: Use purpose-specific notices and consent or other documented authority as appropriate. Separate core processing, optional AI, optional channels, and marketing. Withdrawal starts an impact review; it does not automatically destroy records subject to retention or hold. Decided 2026-10-28 (Francis): Vo skips the documents of clients without AI consent, existing clients included.

SEC-06: Maintain subject-access and correction workflows with identity verification, scope search, redaction of third-party information, reviewer, applicable due date, export, and delivery proof. Requests across firms are handled independently. A closed user login does not erase the firm's professional record.

SEC-07: At closure, set policy version, closure date, retention end, responsible custodian, and legal-hold status. Retained records are read-only except controlled annotations. Deletion requires eligibility checks and approval. Remove originals, derivatives, extracted text, embeddings, exports, and caches when appropriate; document backup expiry and reapply deletion tombstones after restore.

SEC-08: Provide incident detection, containment, investigation, impact assessment, tenant communications, reporting support, and breach records. PIPEDA guidance calls for records of all breaches, including those below the reporting threshold, and a minimum 24-month record period. Reporting depends on the real-risk-of-significant-harm test and must occur as soon as feasible where required. Do not substitute a generic 72-hour rule for Canadian obligations. [S7]

SEC-09: Support access is time-limited, scoped to a matter or record set, justified, and auditable. Default duration is 60 minutes. Firm approval is required unless an approved emergency procedure applies. Show the firm when access occurred and automatically revoke grants on expiry.

SEC-10: On subscription cancellation, stop new work after the contracted period, retain necessary continuity access and export, and provide a defined custodial archive or verified transfer arrangement. Proposed export window is at least 90 days, subject to the retention contract. This window is not a permission to delete six-year records. No routine cancellation or nonpayment process may silently destroy client records. Decided 2026-10-28 (Francis): after the paid period matters go read-only, exports stay open for 90 days, and nothing is deleted; archive-or-transfer has no automatic deletion, and the terms wording needs a lawyer's review before launch.

SEC-11: Maintain encrypted backups, point-in-time database recovery, object versioning, and quarterly restoration exercises. Proposed production objectives are recovery point within 15 minutes and recovery time within 4 hours for core records; verify both through exercises before promising them commercially.

## 17 Reports platform operations and subscriptions

REP-01: Firm reports include lead conversion, consultation attendance, intake completion, stage ageing, staff workload, outstanding documents, overdue tasks, time to internal readiness, invoiced and collected fees, receivables, client-account balances, reconciliation exceptions, and renewal workload.

REP-02: Government-processing duration and outcomes are descriptive reports segmented by program and cohort. Exclude pending cases from completed-outcome denominators and show sample size. Never present approval rates as an individual's chance of success or rank staff on raw approval rate without context.

REP-03: CSV and PDF exports preserve filters, generated time, currency, and authorization. Scheduled reports recheck recipients at send time. Do not put confidential report attachments into general email by default.

ADM-01: Platform operations manage tenant activation, credential-review queues, plan entitlements, quotas, subscription events, service health, delivery failures, integrations, and privacy incidents. Feature flags support tenant-specific rollout and rollback.

ADM-02: Track subscription states Trial, Active, Past due, Restricted, Cancelled, and Archive. Entitlement checks are server-side. A downgrade below current usage blocks additional consumption after notice rather than deleting existing cases or blocking required exports.

ADM-03: Permit versioned shared template publication with author, licensed reviewer, test evidence, effective date, changelog, and rollback. Firm overrides remain distinguishable from centrally reviewed content. Existing matters pin their template version.

ADM-04: Support onboarding tasks, permissioned troubleshooting, tenant incident notices, and service-level reporting. Aggregate product analytics use operational metadata and exclude immigration narratives, identity numbers, uploaded documents, and message bodies.

ADM-05: Provide a separate firm complaints register with complainant, matter link, issue, received date, owner, acknowledgement, review milestones, response, evidence, and resolution. Restrict visibility to designated staff. Distinguish complaints about professional service from software support incidents; route each to the responsible organization. Preserve related evidence under an appropriate hold when required.

## 18 Data model and invariants

### Shared conventions

Use UUID primary keys; timestamps are UTC instants with original timezone where material. Calendar dates and partial dates are separate types, not timestamps. Tenant-owned records include organization_id, created_at, updated_at, created_by, and version. Cross-table references use organization_id with foreign keys or equivalent enforced checks. Soft deletion is not a substitute for retention management.

Global identities authenticate users, while organization memberships grant access. Person records are tenant-specific and can exist without a login. A person may have many matters; a matter has many people through MatterParty. A household is a relationship grouping, not a permission boundary. Documents can have multiple authorized matter references while retaining a single versioned source.

| Entity | Key fields and purpose |
| --- | --- |
| Organization and Office | Legal name, locale, timezone, jurisdiction, branding, privacy contact, retention policy |
| User and Membership | Identity provider subject, organization, roles, status, MFA, office scope |
| ConsultantCredential | Membership, regulator, number, scope, verification evidence, status, checked_at |
| Person and PersonRelationship | Legal names, aliases, birth date precision, contacts, relationship type, authority evidence |
| Matter and MatterParty | Program, jurisdiction, assigned consultant, stage, outcome, party role and permitted scope |
| Lead and Appointment | Source, consent, pipeline, assigned user, booking slot, calendar reference |
| QuestionnaireVersion and Response | Schema version, person, matter, answers, completion, submitted snapshot |
| FactVersion | Field key, source, raw value, normalized value, review, supersession and validity |
| Agreement and SignatureEnvelope | Template, parties, amount terms, document hash, provider references and states |
| Document and DocumentVersion | Type, person, storage key, hash, scan status, expiry, audience and review |
| DocumentRequest | Matter, party, required evidence, due date, accepted version, reviewer |
| Task and Deadline | Owner, dependency, due source, timezone, verification and escalation |
| Conversation and Message | Audience, participants, body reference, attachment grants, sent and read events |
| FormTemplate and Package | Official version, mapping version, manifest, fact snapshot and approval hashes |
| Submission and GovernmentEvent | Channel, external reference, receipt, received date, verified status and evidence |
| Decision and FollowUp | Outcome subtype, official evidence, consultant confirmation and next service |
| Invoice and InvoiceLine | Number, billing party, currency, taxes, service category and immutable issued values |
| Payment and Allocation | Provider account, event reference, amount, state, invoice or client-funds allocation |
| CreditNote and Refund | Source invoice or payment, reason, approval, amount and processor or bank status |
| LedgerAccount and JournalEntry | Tenant, client, currency, balanced posting lines, source and reversal reference |
| Reconciliation | Bank account, period, statement, ledger comparison, exceptions and approval |
| Consent and AccessGrant | Subject, purpose, policy version, scope, authority, expiry and withdrawal |
| RetentionPolicy and LegalHold | Jurisdiction, trigger, period, effective version, hold reason and release |
| AuditEvent and SupportGrant | Actor, object, action, request ID, redacted changes, justification and expiry |
| WorkflowVersion and Execution | Trigger, conditions, permitted actions, deduplication key and run status |
| IntegrationConnection and WebhookEvent | Tenant credentials reference, scopes, provider account, event key and processing result |
| AIRun and Review | Model, prompt version, permitted sources, cost, output state and reviewer |
| Subscription and UsageEvent | Plan, entitlements, billing reference, measured unit and period |

### Integrity constraints

- A posted journal balances debits and credits by currency; posted lines cannot be edited.
- External payment and webhook identifiers are unique within provider and connected-account scope.
- A released package references immutable document and fact versions, never just current-document pointers.
- A professional approval requires an active authorized consultant role and a package hash matching the released package.
- A document download requires both tenant membership and applicable matter/person/audience authorization.
- A client balance cannot become available merely because an unverified manual payment was entered.
- A legal hold blocks destruction across linked originals, derivatives, and related records.
- A government reference is stored as text with restricted visibility; it is not globally unique unless the specific authority guarantees that.
- Concurrent changes use optimistic locking. A stale update returns a conflict instead of overwriting a colleague's work.

Index tenant plus frequent filters: matter stage and owner, task due date and state, document review state, invoice due date and state, and audit time. Partition high-volume audit and event tables when measured load justifies it. Encrypt particularly sensitive searchable identifiers with a reviewed lookup strategy; avoid plaintext identifiers in general full-text search.

## 19 Technical architecture and deployment

### Recommended implementation

Use a TypeScript modular monolith: Next.js for the web interface, a structured server application for domain logic and APIs, PostgreSQL for transactional records, private object storage for files, and dedicated workers for scanning, OCR, reminders, exports, and integrations. Modules are Identity, Organizations, CRM, Matters, Documents, Agreements, Finance, Workflow, Communications, Reporting, and Administration. Extract services only when operational evidence justifies separation.

Use a Canada-region production footprint for core application data, database, file storage, queues, and backups, subject to vendor verification. Keep the public marketing site separate from authenticated data paths. Third-party email, identity, signing, payment, observability, and AI services require their own residency and processing review; a Canadian database does not make the entire system Canada-only.

PostgreSQL can be managed on AWS or another approved Canadian-region provider. Neon is an alternative only if its available regions and contract satisfy the chosen data-location policy; the region list reviewed for this document did not list Canada. Do not promise Canadian database residency while selecting a non-Canadian project region. [S16]

### Runtime components

- Web application: responsive firm and client interfaces, server authorization, schema validation, and accessible design components.
- Transactional backend: domain services, PostgreSQL transactions, authorization policy layer, and an outbox for durable events.
- Workers: queue consumers with scoped service identities, retries, dead-letter queues, and resource limits.
- File pipeline: quarantine upload, malware scan, metadata extraction, preview generation, optional OCR, review, and authorized retrieval.
- Integrations: provider adapters for signatures, payments, email, calendars, and approved accounting exports.
- Observability: metrics, redacted logs, traces, audit sinks, dependency health, and actionable alerts.
- AI gateway: tenant policy enforcement, minimum-data payloads, source-scoped retrieval, cost budgets, and review queues.

### Security and delivery design

Separate development, staging, and production accounts and credentials. Use fictional or de-identified test data; never copy production client files into developer laptops or preview deployments. Infrastructure is version-controlled. CI runs type checks, migration checks, authorization tests, dependency scanning, and selected end-to-end tests. Deploy with database backward compatibility, feature flags, and documented rollback.

RLS is defense in depth, not the only authorization layer. Use a non-owner application role, scoped transaction context, and tests for connection-pool reuse. Workers must set tenant context from authenticated job metadata, not untrusted payload fields. Storage keys and cache keys include tenant scope, but a scoped key does not replace a permission check.

## 20 APIs events and external integrations

### API conventions

Use versioned JSON APIs under /api/v1. Determine the active tenant from authenticated membership and approved workspace context; do not trust an arbitrary organization ID in a request. Use cursor pagination, typed validation errors, request IDs, rate limits, and an Idempotency-Key for financial or workflow mutations. Return 409 for stale-version updates, 422 for semantic validation errors, and 429 for throttling. Apply a consistent resource-enumeration policy for unauthorized objects.

| Endpoint | Purpose and required safeguards |
| --- | --- |
| POST /leads | Create minimal enquiry with abuse controls and consent version |
| POST /appointments | Reserve capacity atomically and confirm timezone |
| POST /matters | Create from a published template with consultant assignment |
| PATCH /matters/{id} | Update allowed fields with expected version |
| POST /matters/{id}/transitions | Validate state gate, evidence and actor permission |
| PUT /responses/{id}/answers | Save schema-valid answer changes with version control |
| POST /documents/upload-intents | Authorize size, type, target person and matter before upload |
| POST /documents/{id}/complete | Verify storage object and enqueue quarantine processing |
| POST /documents/{id}/reviews | Record acceptance or changes requested with reason |
| POST /agreements/{id}/send | Freeze document and create signer envelope idempotently |
| POST /packages/{id}/approve | Bind authorized approval to exact manifest hash |
| POST /submissions | Record official handoff evidence; no implied government API |
| POST /government-events | Create reviewed correspondence and tentative tasks |
| POST /invoices/{id}/checkout | Use correct firm processor account and earned-fee policy |
| POST /payments/manual | Record unverified bank payment with reconciliation evidence |
| POST /transfers/{id}/approve | Validate earned amount, available funds and approver |
| POST /exports | Queue scoped export with step-up authentication and expiry |
| POST /webhooks/{provider} | Verify provider signature and deduplicate event processing |

Example transition payload: expected_version=12, target_stage=ready_to_submit, package_id, package_hash, client_confirmation_id, and review_note. The server verifies all referenced records belong to the same tenant and matter. The client cannot supply approved=true to bypass a review.

### Domain events

Events include lead.created, agreement.executed, intake.submitted, document.uploaded, document.reviewed, task.overdue, package.approved, submission.recorded, government_request.verified, decision.confirmed, payment.settled, refund.completed, matter.closed, and credential.restricted. Each event carries event_id, organization_id, aggregate_id, aggregate_version, event_type, occurred_at, schema_version, and minimum necessary references. Consumers deduplicate and tolerate out-of-order arrival. Do not put full documents or sensitive narratives on the event bus.

### Integration scope

Payments and signatures use verified webhooks and reconciliation. Google and Microsoft calendar/email connections use OAuth, narrow scopes, token encryption, and disconnect behavior. Accounting starts with reviewed exports and later adds supported sync with clear source-of-truth ownership. SMS is an optional reminder channel. WhatsApp integration is a later approved-channel feature, not informal scraping. Each adapter exposes connected, degraded, expired, and disconnected states with recovery actions.

If a provider is down, queue safe retries, display pending status, and allow appropriate manual workflows. An e-sign outage does not fabricate a signature; a payment outage does not mark an invoice paid. Unsupported IRCC automation remains outside the committed product.

## 21 Nonfunctional requirements

These are proposed acceptance targets for general availability. Measure them against an agreed load profile before sales commitments.

| Area | Target and measurement |
| --- | --- |
| Availability | 99.9 percent monthly for core portal operations; report planned and unplanned downtime |
| Interactive performance | P95 ordinary read API under 500 ms and write API under 1 s, excluding external providers and large transfers |
| User experience | P75 key authenticated pages usable within 2.5 s on the agreed midrange mobile and network profile |
| Initial load envelope | 500 firms, 100000 active matters and 2000 concurrent sessions with a representative tenant distribution |
| File processing | P95 scan and preview within 2 minutes for supported 25 MB files under tested normal load |
| Reminders | 99.9 percent of due jobs enqueued within 5 minutes; delivery failures visible and escalated |
| Recovery | RPO at most 15 minutes and RTO at most 4 hours for core records, proven in exercises |
| Exports | 95 percent of 1 GB matter exports ready within 15 minutes under tested load |
| Accessibility | WCAG 2.2 AA target with keyboard, screen-reader and mobile task testing |
| Auditability | Every privileged or material mutation has an actor, time, object and correlation ID |

Large exports, OCR, and AI are asynchronous with progress and cancellation. Apply per-tenant quotas and fair scheduling so one large practice cannot starve others. Document third-party dependency effects separately from platform reliability. Store no authenticated case pages or documents in public CDN caches.

## 22 Analytics and success criteria

Use pseudonymous tenant and user identifiers for product analytics. Events describe actions and durations, not answers or document contents. Metric definitions must remain stable across releases and record their source query version.

| Metric | Definition | Proposed pilot or GA target |
| --- | --- | --- |
| Firm activation | Verified firms completing a sample workflow within 7 days divided by verified new firms | At least 70 percent |
| Client activation | Invited clients completing their first assigned action within 72 hours | At least 80 percent |
| Intake completion time | Median invitation-to-complete duration for comparable service cohorts | 30 percent lower than measured baseline |
| Document chasing | Staff follow-up messages per accepted checklist | 40 percent lower than measured baseline |
| Internal readiness time | Engagement execution to consultant-ready package, excluding documented client holds | 25 percent lower than baseline |
| Financial accuracy | Reconciled posted payment events without unexplained variance | 100 percent in release certification |
| Critical deadline handling | Confirmed critical deadlines with owner, escalation and acknowledgement | 100 percent |
| Client clarity | Clients answering that they know their next action in a post-task survey | At least 85 percent |
| Retention | Paying firms still active at 90 days | At least 90 percent in early cohort |
| SaaS gross margin | Subscription revenue less hosting, vendors and delivery support costs | Target above 70 percent after onboarding stabilizes |

Targets are hypotheses to validate. Case approval rate is not the north-star metric because case mix and authority decisions are outside the software's control. Use completed, auditable casework and reduced operational effort as product success measures.

## 23 Acceptance scenarios and release evidence

QA must test successful flows and adversarial edge cases with realistic synthetic families, multiple firms, multiple currencies in fixtures, and interrupted providers. The release report maps requirement IDs to evidence, failures, and owner sign-off.

1. Tenant isolation: Firm A cannot retrieve Firm B's clients by guessed IDs, search, direct file URL, export, analytics, worker job, or AI retrieval. All paths deny access and log the attempt appropriately.
2. Family boundaries: An adult dependant can submit private documents that the sponsor cannot open. Shared household membership and invoice payment do not override this restriction.
3. Consultant scope: An assistant prepares a complete package but cannot release it. A credential-restricted consultant is blocked from new professional approvals.
4. Intake resilience: A client loses connectivity, resumes later, and sees the last confirmed saved state. Conflicting simultaneous edits produce a visible conflict rather than data loss.
5. Evidence review: OCR suggests the wrong birth date. The reviewer rejects it; the approved fact and generated forms retain the verified date.
6. Package integrity: A client replaces a document after approval. The old submission snapshot remains reproducible and the current package requires new approval.
7. Signatures: A partially signed agreement is changed. The old envelope is voided or superseded with history preserved, and all required parties sign the new version.
8. Deadline handling: A short-notice request crossing daylight-saving changes retains its official due instant and escalates without applying a blanket extension.
9. Payment ordering: Success, dispute, and refund events arrive twice and out of order. The ledger and invoice state converge once without double credit or refund.
10. Advance funds: A pending manual deposit cannot fund an earned-fee transfer. After reconciliation, the authorized partial transfer leaves the correct client balance.
11. Submission evidence: An operator records a reference without a receipt. The case remains submission-unverified until the required evidence and review are present.
12. Decision handling: A refusal creates a review task, preserves the official reasons, and does not generate an unsupported promise or deadline.
13. Template change: A new official form version flags affected draft matters but does not rewrite already submitted packages.
14. Cancellation: A firm cancels while cases are active. The continuity process preserves deadlines, exports, and retention commitments according to contract.
15. Privacy request: A client requests access. The export includes authorized data and excludes other adults' private records, with reviewer and delivery evidence.
16. Recovery: Restore the database and documents in a clean environment; verify manifest hashes, balances, permissions, holds, and deletion tombstones.
17. AI injection: A document instructs the model to reveal another client's files or send a message. The model has neither data access nor authority to carry it out.
18. Accessibility: A keyboard and screen-reader user completes invitation, intake, upload, signature handoff, and payment handoff without a blocking defect.
19. Notification failure: A critical reminder bounces. The responsible staff member sees a follow-up task and the client is not falsely shown as notified.
20. Original records: A closed matter can produce its executed agreement, submitted package, correspondence history, financial records, and closure notice without relying on live templates.

General-availability gates: no unresolved critical security defect; no known cross-tenant exposure; financial reconciliation certified against fixtures; restoration objectives demonstrated; core journeys accepted by pilot firms; published program packs reviewed; privacy, client-account, and professional-contract review completed for the launch jurisdiction; operational support and incident runbooks tested.

## 24 Delivery roadmap and staffing

### Planning assumptions

A proposed 24 to 32 week initial delivery window assumes a product owner, product designer, two frontend/full-stack engineers, two backend/full-stack engineers, QA automation support, part-time infrastructure/security support, and a licensed immigration practice reviewer. This is an estimate for the defined product with a limited, explicitly published program/form catalogue; broad jurisdiction or form coverage increases the work. Validate effort after discovery and technical spikes. A smaller team should extend the schedule rather than silently omit finance, privacy, or authorization controls.

| Release | Indicative timing | Deliverables and exit gate |
| --- | --- | --- |
| Discovery and specification | Weeks 1 to 3 | Workflow observation, jurisdiction decisions, signed-off data and funds-flow design |
| Secure foundation | Weeks 4 to 7 | Tenancy, roles, onboarding, credential review, audit and backup proof |
| Client engagement | Weeks 8 to 12 | CRM, booking, agreements, intake, documents and client portal |
| Casework and finance | Weeks 13 to 18 | Versioned workflows, deadlines, preparation, invoicing, ledger and reconciliation |
| Decisions and operations | Weeks 19 to 23 | Submission evidence, correspondence, outcomes, closure, reports and admin |
| Validation and launch | Weeks 24 to 28 | Migration rehearsal, pilot use, load tests, privacy review and incident exercise |
| Contingency and advanced scope | Weeks 29 to 32 | Pilot corrections, selected AI and integration expansion |

AI and unsupported integrations must not block delivery of the complete manual case lifecycle. Enterprise SSO, additional accounting adapters, more languages, and more jurisdiction packs follow explicit contractual priorities. Native iOS and Android apps are later products; the initial client portal is responsive web.

### Dependency order

Tenant isolation precedes sensitive client data. Person relationships precede family portals. Fact and document versioning precede form population. Agreement execution precedes engagement gates. The ledger precedes payment automation. The outbox and durable queues precede critical reminders. Package manifests precede submission release. Retention and export precede production onboarding. AI uses these established controls rather than introducing a separate data path.

## 25 Migration onboarding and operating model

MIG-01: Import clients, matters, people relationships, documents, notes, tasks, dates, and financial opening balances through a staged mapping process. Validate formats, classify sensitivity, detect duplicates, and provide a preview with row-level errors. Never merge records silently.

MIG-02: Pilot a small sample, obtain firm sign-off, then run a controlled migration with source counts, checksums, record totals, and exception reports. Imported historical events retain their original date plus imported_at and source_system; do not present imported history as a native audit event.

MIG-03: Financial migration requires a dated opening balance by bank, client, matter, and currency with reconciliation approval. Do not reconstruct unknown historical transactions from a total balance. Missing provenance remains explicitly identified.

MIG-04: Rehearse cutover, read-only period, reconciliation, user training, and rollback before switching the firm. Keep a verified source export until the agreed acceptance and retention arrangements are complete. Remove temporary migration copies according to the migration policy.

Operational ownership: the software team owns uptime, security, provider adapters, releases, and support; the consultancy owns advice, case accuracy, deadlines, client communications, financial authorization, and professional obligations. A named content reviewer owns each jurisdiction pack. Accounting specialists approve ledger treatment and reconciliation. These responsibilities appear in onboarding and contractual documents.

Support priorities: suspected exposure, missing critical records, payment-integrity failures, and deadline-system failure are urgent incidents. Individual portal confusion is normal support. Provide in-app reporting, support hours, escalation contacts, incident notices, and a public status page. Proposed urgent acknowledgement is within 30 minutes only where staffed and contractually offered; otherwise publish honest coverage.

## 26 Risks decisions and unresolved items

| Risk or decision | Proposed handling | Accountable owner |
| --- | --- | --- |
| Country and professional scope | Canada RCIC first; approve province and licence coverage before live use | Founder and practice reviewer |
| Client advances and processor suitability | Manual compliant-bank workflow available; automated collection gated | Finance and professional adviser |
| Government integration expectations | Evidence-based manual handoff until supported access is confirmed | Product lead |
| Regulatory and form changes | Versioned sources, reviewed releases, impact notifications | Content owner |
| Family confidentiality | Person-level grants, separate adult identities and audience review | Product and security |
| Brand availability | Registrar, corporate registry and trademark clearance before purchase | Founder |
| Retention cost after cancellation | Contracted archive or verified custodian transfer, costed upfront | Founder and operations |
| AI accuracy and data transfer | Optional drafts, approved vendor terms and human review | Security and practice reviewer |
| Migration confidence | Staged import, reconciliation and signed acceptance | Implementation lead |
| Competing feature parity | Validate client experience and operational savings with paid pilots | Product lead |

Decisions required before engineering commitments: exact launch jurisdictions; which 3 to 5 program packs receive initial deep coverage; accepted government form output formats; payment provider and client-account arrangement; signing provider; Canadian hosting procurement; support coverage; final pricing allowances; and confirmed brand name. The core architecture and user journeys do not depend on the final name.

**Launch decisions (Francis, 2026-10-28, issue #263; details in `docs/DECISIONS.md`).** (1) #163 and #164 ship on automated checks; Francis does the MFA-only live checks himself. (2) Staff idle sign-out defaults to 30 minutes, range 5 to 480 (SEC-01). (3) Vo skips the documents of clients without AI consent, existing clients included (SEC-05). (4) After the paid period, matters go read-only, exports stay open for 90 days, and nothing is deleted (SEC-10). (5) Archive-or-transfer has no automatic deletion; the terms wording needs a lawyer's review before launch (SEC-10). (6) The privacy-request download window is 30 days, as built (SEC-06). (7) The reports cohort, export header and definitions are accepted as built (REP-01..03). (8) The first program is Study permit, with a named licensed reviewer (to be named by Francis). (9) Platform admin is Francis only, to start, set up through the separate admin portal; this repo creates no `platform_admins` rows. (10) Stripe goes live only after an accountant signs off on the client-money flow (including tax on professional-fee lines) and the must-fix bugs ship; on 2026-10-28 Francis reported the accountant's sign-off, and the must-fix bugs (#262, PR #266) are not yet merged. In progress: a privacy notice per firm (PR #264), upload virus scanning, and a possible-match Link for public bookings that use a portal client's email.

## 27 Engineering handoff and definition of done

The design handoff must include the marketing site, firm onboarding, verification, staff login and recovery, client invitation, dashboards, lead pipeline, booking, matter workspace, questionnaires, document review, signing states, finance screens, government events, decision flows, reports, settings, platform administration, and all permission and error states. Provide tokens, reusable components, mobile layouts, empty states, and accessible interactions.

The engineering handoff must include schema migrations, authorization policies, seeded synthetic firms and families, versioned form schemas, program templates, API contracts, event schemas, financial fixtures, integration adapters, operational dashboards, export format, backup and recovery procedure, migration tools, and release evidence. No undocumented privileged bypass is acceptable.

A feature is done when its acceptance criteria pass, permitted roles are enforced on the server, material actions are audited, client-visible copy is clear, failure and retry behavior are implemented, localization keys exist, accessibility is checked, observability is live, and relevant operating documentation is updated. A UI-only implementation with simulated payments or local-only storage is not complete.

### Builder instruction

Implement this specification as a production-oriented multi-tenant application in the stated dependency order. Preserve the separation between software administration and professional immigration decisions. Build the complete case lifecycle, including refusals, withdrawal, follow-up, financial reconciliation, closure, export, and retention. Use real persistence and explicit integration adapters. Where external approval or vendor access is pending, ship a clearly labelled manual workflow rather than pretending an integration exists. Keep names, prices, programs, templates, deadlines, and tax settings configurable. Require human authorization for legal conclusions, sensitive financial actions, and submission release. Map each release to the requirement IDs and acceptance scenarios in this document.

## 28 Research sources and verification record

Research reviewed on 14 October 2026. Sources below support the regulatory context, vendor descriptions, and architecture constraints cited in the document. Product behavior, targets, pricing, and implementation choices are proposed requirements. Before launch, the relevant professional, privacy, and financial reviewers must confirm the applicable current requirements and record their approval against the version being released.

S1. IRCC. Find out if your representative is authorized. https://www.canada.ca/en/immigration-refugees-citizenship/services/immigration-citizenship-representative/choose/authorized.html

S2. Justice Laws. Code of Professional Conduct for College of Immigration and Citizenship Consultants Licensees, SOR/2022-128, particularly sections 23, 24, 32, and 33. The retrieved consolidated page stated current to 21 September 2026. https://laws-lois.justice.gc.ca/eng/regulations/sor-2022-128/FullText.html

S3. IRCC. How to use the Authorized Paid Representatives Portal. https://www.canada.ca/en/immigration-refugees-citizenship/corporate/partners-service-providers/authorized-paid-representatives-portal/user-guide.html

S4. College of Immigration and Citizenship Consultants. Client File Management Regulation, section 7.2. https://college-ic.ca/ICCRC/Assets/Documents/Regulations/Client%20File%20Management%20Regulation.pdf

S5. Office of the Privacy Commissioner of Canada. Guidelines for processing personal data across borders. https://www.priv.gc.ca/en/privacy-topics/airports-and-borders/gl_dab_090127/

S6. Commission d'accès à l'information du Québec. Utilisation et communication des renseignements personnels, private enterprises. https://www.cai.gouv.qc.ca/protection-renseignements-personnels/information-entreprises-privees/utilisation-communication-renseignements-personnels

S7. Office of the Privacy Commissioner of Canada. What you need to know about mandatory reporting of breaches of security safeguards. https://www.priv.gc.ca/en/privacy-topics/privacy-for-businesses/privacy-breaches-at-your-business/gd_pb_201810/

S8. College of Immigration and Citizenship Consultants. Guide for developing your service agreement. https://www.college-ic.ca/ICCRC/Assets/Documents/Guides/SERVICE_AGREEMENT_GUIDE_EN.pdf

S9. Officio. Immigration software. https://officio.ca/immigration-software.html

S10. CaseEasy. Client management and optional AI capabilities. https://caseeasy.ca/Product/ClientManagement and https://support.caseeasy.ca/en/articles/17190293-caseeasy-ai-current-capabilities-what-s-next

S11. ImmiCompliance. Immigration software features. https://immicompliance.com/immigration-compliance-management-software-for-features-list.php

S12. Canadian Intellectual Property Office. Additional search options and trademarks guide. https://www.ised-isde.canada.ca/site/canadian-intellectual-property-office/en/trademarks/additional-search-options and https://ised-isde.canada.ca/site/canadian-intellectual-property-office/en/trademarks/trademarks-guide

S13. Stripe. Direct charges and loss considerations. https://docs.stripe.com/connect/direct-charges and https://support.stripe.com/questions/what-should-i-know-about-using-direct-charges

S14. Retainora. Existing commercial use observed. https://www.retainora.com/

S15. ImmiLoom. Existing immigration-related page observed in search results. https://www.facebook.com/61575140241238/

S16. Neon. Regions. https://neon.com/docs/introduction/regions

Name-screen queries included exact names Casevoya, Dossivana, and Retainivo, followed by exact .com and .ca strings and company/software modifiers. The result is a shortlist for clearance, not a domain or trademark availability report. No name or domain was purchased, reserved, or registered.


## 29 Official-source governance and design requirements

These requirements apply across all releases, including demonstrations that present real immigration information. Engineering can proceed with clearly fictional fixtures while production rule packs await review. No real eligibility rule, government fee, required-document list, legal deadline, or program-specific form mapping ships merely because it appears plausible.

| ID | Requirement | Acceptance criteria |
| --- | --- | --- |
| SRC-01 | Store claim-level evidence | Each immigration claim resolves to jurisdiction, program/context, exact official URL and section, snapshot/hash, retrieval date, applicability, reviewer, and version. A homepage link alone fails. |
| SRC-02 | Separate authority from observation | Record published, modified, effective, consolidation-current-to, retrieved, and reviewed dates separately. Missing dates remain unknown; a reviewer must explicitly resolve applicability before publication. Never invent a date. |
| SRC-03 | Gate publication | Only a qualified authorized reviewer can approve the immutable rule version for its scope. Draft, unresolved, rejected, suspended, or expired review status cannot become live through an import, API, AI response, or background job. Exception (decision 2026-10-25): a claim Casevoya captured from an official page, with its URL, section, page hash and retrieval time, goes live when the operator's loader loads it in a database maintenance session; a firm's licensed member edits only their firm's wording, with a fresh step-up each time and a stamp ("Edited by <name>, licence <number>, <date>"). Firm-entered claims keep licensed review with a step-up. |
| SRC-04 | Detect and assess change | Scheduled checks record failures and content changes. A change creates an impact task identifying dependent rules, forms, matter checklists, and exports; it does not silently rewrite guidance. A changed re-capture of an official claim goes live and supersedes the old version; a firm's edit of it is kept and flagged "Source changed since your edit" (decision 2026-10-25). |
| SRC-05 | Pin and migrate matter versions | A matter and each generated package record rule-pack and form versions. Upgrades require an impact preview and an audited decision; original evidence and exports remain reproducible. |
| SRC-06 | Distinguish deadline origins | Label government correspondence deadlines, source-derived legal deadlines, and internal target dates separately. Keep original correspondence and timezone/date interpretation. Internal reminders never masquerade as legal obligations. |
| SRC-07 | Expose source context | Staff can inspect evidence and review history from any regulated requirement. Clients see a plain explanation, appropriate official reference, and whether consultant review is pending. Restricted client evidence is never exposed through a public source link. |
| SRC-08 | Fail safely and locally | Unresolved source conflicts block the affected assessment or publication, explain why, and create a review task. Unrelated messaging, file access, and general case administration continue. A retrieval outage is not evidence of a legal change. A firm's edit of an official claim whose source changed is flagged, not blocked; a fee or advice-like official claim whose source is overdue for a re-check is not cited by Vo (decision 2026-10-25). |
| SRC-09 | Ground AI outputs | AI can draft from authorized matter evidence and approved source versions only. It cites supporting evidence or abstains. Human review is required for advice-like communications and submission material. Retrieved text cannot authorize tools or override project rules. |
| SRC-10 | Test rule boundaries | Every executable rule includes supported, unsupported, missing-input, jurisdiction-mismatch, stale-source, and superseded-version cases as relevant. Prove prohibited versions cannot reach client output. |
| SRC-11 | Maintain source stewardship | Assign a source owner and professional reviewer; record review deadlines and escalation. A program cannot launch without an approved source pack, named owner, and change-response procedure. |
| SRC-12 | Keep scope honest | Jurisdiction and program support are visible. Unsupported provinces, tribunals, countries, or case types cannot inherit another pack by default. No government integration, licence verification, approval, or processing guarantee may be claimed without corresponding evidence. |
| DES-01 | Apply the reference-based design system | Use DESIGN.md tokens, spacing, typography, component states, and responsive patterns consistently across the firm and client workspaces. Do not reproduce proprietary reference assets. |
| DES-02 | Make action and status clear | Every matter shows its current stage, responsible party, next action, and known deadline. Unknown government progress stays unknown. Financial and immigration statuses remain separate. |
| DES-03 | Meet inclusive interaction requirements | Critical flows work using keyboard, visible focus, labelled controls, non-color status cues, accessible error summaries, and mobile layouts; verify WCAG 2.2 AA criteria in the release checklist. |
| DES-04 | Represent incomplete and failed states | Provide useful loading, empty, partial, permission-denied, stale-source, failed-payment, and failed-upload states. Never fill missing real data with invented results. |
| DES-05 | Validate both primary personas | A consultant can identify blocked matters and review evidence; a client can complete an intake step, upload a document, understand a payment, and locate their next action without interpreting internal terminology. |

### Additional release evidence

The release packet must include the approved source-pack manifest, professional review record, source-change simulation, tenant/household access test results, critical-flow accessibility findings, payment reconciliation results, and submission evidence checks. Technical readiness does not replace professional content review. A staging demo using fictional cases is not a production source pack.

The Refero design reference is https://styles.refero.design/style/2bf4c61f-de10-4614-ba1b-20c0453bd2a9, reviewed 14 October 2026. DESIGN.md documents the interpretation and original application-specific decisions. Naming candidates remain provisional: no brand, domain, or trademark clearance has been obtained.
