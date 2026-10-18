# Casevoya Implementation Tasks

Version 1.1 · 14 October 2026 · Planning backlog, not completed development.

## How to use this backlog

Read [RULES.md](RULES.md), [MEMORY.md](MEMORY.md), [PRD.md](PRD.md), [ARCHITECTURE.md](ARCHITECTURE.md), and [DESIGN.md](DESIGN.md) before starting. Requirement references below use PRD section numbers; SRC and DES IDs are defined in PRD section 29. Follow the listed dependencies, but independent work can proceed with synthetic data. Do not wait for professional rule approval to build generic tenant isolation or accessible components.

Statuses: TODO, IN_PROGRESS, BLOCKED, REVIEW, DONE. All T-series tasks start TODO. An implementation task is DONE only when its acceptance evidence exists, required reviewers have approved it, and MEMORY.md records material decisions. A mockup or happy-path demo cannot close a backend or security task. Split tasks into smaller issues at sprint planning while preserving IDs and dependency links.

Owners are role assignments to fill, not people already engaged: PO product owner; ENG engineering; UX design; PRO qualified immigration reviewer; SEC security/privacy; FIN finance/accounting reviewer; OPS operations. Source publication requires the qualified reviewer; an engineer's approval cannot substitute.

## Documentation baseline

| ID | Status | Deliverable |
| --- | --- | --- |
| D001 | DONE | Full PRD, source-governance requirements, and proposed commercial model documented. |
| D002 | DONE | Architecture and mandatory official-source rules documented. |
| D003 | DONE | Supplied Refero reference translated into a product design system. |
| D004 | DONE | Ordered backlog and durable project context documented. |

These completion marks mean documents were authored, not that the product, compliance, names, integrations, or rules were approved.

## Phase A — Scope and foundations

| ID | Owner | Depends on | Task and concrete acceptance evidence |
| --- | --- | --- | --- |
| T001 | PO, PRO | — | Confirm initial country, provinces, client segment, and first program(s). Record included/excluded case types, responsible reviewer, and pilot firms. Canada-first remains an assumption until recorded. PRD 1, 26. |
| T002 | PO | — | Conduct brand clearance for Casevoya and alternatives: exact/similar trademarks, business names, domains, social handles, language/pronunciation. Record dated outcomes; do not claim availability from web silence. PRD 2. |
| T003 | PO, PRO, FIN, SEC | T001 | Map responsibilities and contracts: software provider, consultancy, client, processors; review agreement/signature, client funds, privacy, retention, and record transfer requirements. Produce launch decision register with unresolved blockers. PRD 10, 13, 16. |
| T004 | UX, PO | — | Interview at least three target firms and test consultant/client workflow prototypes. Record findings and revise assumptions without reducing the authorized end-to-end scope silently. PRD 6, 22. |
| T005 | ENG | — | Establish repository, current supported dependency versions, CI, environment separation, migrations, secret management, and automated formatting/type checks. Document vendor-region decisions and dependency lockfiles. Architecture 1–3. |
| T006 | ENG, SEC | T005 | Implement identity, MFA for staff/admin, invitations, tenant membership, and session revocation. Verify expired/reused invite rejection and offboarding across active sessions. PRD 5, 16. |
| T007 | ENG, SEC | T006 | Implement tenant and matter authorization plus household/person grants. Negative tests cover URL guessing, exports, search, storage URLs, jobs, and adult dependant access. Prove cross-firm and ungranted family data stay inaccessible. PRD 5, 18. |
| T008 | ENG, SEC | T005 | Implement append-only business audit events with actor, tenant, object/version, action, reason, and time; restrict access and redact secrets. Prove changes and denied sensitive actions are traceable. PRD 16, 18. |
| T009 | UX, ENG | T005 | Implement DESIGN tokens, accessible primitives, firm/client shells, responsive navigation, error and loading patterns. Produce keyboard and contrast evidence for reference components. DES-01, 03, 04. |
| T010 | ENG, OPS | T005, T008 | Implement outbox, durable jobs, provider webhook verification, deduplication, retry/backoff, failure queue, and monitored replay. A duplicate event must produce one business effect. PRD 20. |

Gate A: isolated development/staging environments exist; tenant and household authorization tests pass; no production client records are required to demonstrate the foundation.

## Phase B — Official-source governance

| ID | Owner | Depends on | Task and concrete acceptance evidence |
| --- | --- | --- | --- |
| T011 | ENG, PRO | T005, T008 | Implement source, snapshot, claim/evidence, rule version, reviewer, and rule-pack schemas. Validate mandatory metadata; preserve unknown dates without fabricating them. SRC-01, 02. |
| T012 | ENG, SEC | T010, T011 | Build allowlisted public-source retrieval with redirect/IP controls, bounded downloads, safe parsing, hash, retrieval status, and snapshot storage. Simulate SSRF, malicious page instructions, unavailable pages, and changed content. SRC-04, 09. |
| T013 | ENG, PRO | T006, T009, T011 | Build source-review workbench and enforced lifecycle. Only authorized qualified reviewers can approve; unresolved/conflicting evidence prevents publication through UI, API, import, and worker. SRC-03, 08. |
| T014 | PRO, PO | T001, T003, T013 | Prepare first program source pack from official sources, including applicable form versions, guidance, fees, and evidence requirements. Record exact scope and signed review. No sample rule becomes real through renaming. SRC-11, 12. |
| T015 | ENG, PRO | T011, T013 | Implement deterministic rule evaluation, explicit missing-input results, version-pinned matter bindings, and impact-preview migration. Cover branch boundaries and unsupported jurisdictions. SRC-05, 10, 12. |
| T016 | ENG, OPS, PRO | T010, T012, T015 | Schedule source monitoring and owner escalation. Demonstrate a changed fee/form flags dependencies, preserves old exports, and blocks only affected outputs pending review. SRC-04, 08, 11. |
| T017 | UX, ENG | T009, T013, T015 | Display source context and review state where regulated guidance appears. Clients see a clear explanation; staff can inspect exact evidence. Verify restricted case facts never leak through public sources. SRC-07. |

Gate B: source infrastructure can be tested with fictional content, but no production program-specific assessment or checklist launches until T014 is approved and affected lifecycle tests pass.

## Phase C — Onboarding, leads, intake, engagement

| ID | Owner | Depends on | Task and concrete acceptance evidence |
| --- | --- | --- | --- |
| T018 | ENG, PRO | T006, T007, T009 | Firm onboarding, staff roles, branding, declared/verified licence status and evidence, reviewer escalation. Do not present manual verification as live regulator synchronization. PRD 8. |
| T019 | ENG, UX | T007, T009 | Lead pipeline, consultation records, assignment, deduplication suggestions, and conversion to a matter. Preserve original consent and lead history; do not merge people automatically. PRD 9. |
| T020 | ENG, UX, PRO | T007, T009, T015 | Versioned conditional intake with draft autosave, resume, validation, household relationships, and restricted sensitive sections. Prove changed answers flag dependent tasks without erasing history. PRD 9. |
| T021 | ENG, SEC | T006, T007, T020 | Client invitations, granular adult/guardian/employer permissions, consent evidence, revocation, and mobile intake. Demonstrate a sponsor cannot access an adult dependant's restricted section without permission. PRD 5, 9. |
| T022 | ENG, PRO | T003, T008, T009, T018 | Service agreements with scope, fees, version locking, signer roles, provider evidence, refusal/expiry, and amendments. Verify signed content cannot silently change. PRD 10. |
| T023 | ENG | T019, T020, T022 | Matter creation, program selection, responsible consultant, stage transitions, and engagement prerequisites. Record every override and its permitted role. PRD 6, 7. |

Gate C: a fictional prospect can become an engaged client with a signed agreement, scoped household access, and resumable intake. Real regulated intake content also requires Gate B.

## Phase D — Evidence and preparation

| ID | Owner | Depends on | Task and concrete acceptance evidence |
| --- | --- | --- | --- |
| T024 | ENG, SEC | T007, T010 | Private upload, malware quarantine, checksum, size/type constraints, versions, and short-lived authorized downloads. Failed/quarantined uploads cannot count as accepted evidence. PRD 11, 16. |
| T025 | ENG, UX, PRO | T015, T023, T024 | Rule-derived document requests, review, rejection reasons, replacement versions, expiry and translation metadata. Client progress uses accepted requirements, not raw upload count. PRD 11. Note 2026-10-18: the Sheet Documents page is live (firm-wide review queue with a review dialog, all documents, originals held). |
| T026 | ENG, PRO | T010, T023 | Task assignment, dependency tracking, calendar/reminders, and original deadline evidence. Distinguish legal/correspondence dates from internal targets; test timezone/date-only boundaries and escalation. PRD 12; SRC-06. |
| T027 | ENG, PRO | T015, T020, T025 | Case preparation workspace, conflict flags, consultant review notes, and controlled form-data mapping. Record form version and field provenance; never claim all government forms are supported. PRD 11. |
| T028 | ENG, PRO | T013, T015, T027 | Readiness checks and immutable package generation manifest. Confirm unresolved evidence, stale rules, pending signoffs, or wrong form versions block only the affected readiness step. PRD 11, 14. |
| T029 | ENG, SEC, PRO | T007, T017, T024, T027 | Optional assisted extraction/draft summaries with provenance, correction, reviewer approval, abstention and provider retention controls. Test prompt injection and hidden cross-client retrieval. AI is not a prerequisite to basic case management. PRD 15. |

Gate D: reviewer can trace each prepared item to client evidence or an approved official rule. Reopening a matter preserves previous package versions.

## Phase E — Finance and communication

| ID | Owner | Depends on | Task and concrete acceptance evidence |
| --- | --- | --- | --- |
| T030 | ENG, FIN | T003, T008, T023 | Implement quotes, invoices, service/advance/government-fee classification, tax configuration, credits, and immutable financial records. Verify currency precision, partial payments, and agreement consistency. PRD 13. |
| T031 | ENG, FIN, SEC | T003, T010, T030 | Configure approved payment provider flow and firm beneficiary accounts. Test signed webhooks, duplicate/out-of-order callbacks, pending/failed payments and chargebacks. Browser redirect alone never marks paid. PRD 13. |
| T032 | ENG, FIN, PRO | T030, T031 | Client-account ledger, allocation and earned-funds workflows, reconciliation and exception reporting according to reviewed firm obligations. Demonstrate separation of bookkeeping from actual custody; processor balance is not automatically a compliant client account. PRD 13. |
| T033 | ENG, FIN | T031, T032 | Installment plans, receipts, refunds, approval limits, disputes and reconciliation adjustments. Verify refund retries cannot duplicate funds movement and ledger balances remain explainable. PRD 13. |
| T034 | ENG, UX, SEC | T007, T009, T010, T023 | Matter messages, internal notes, attachments, notifications, preferences, delivery failure and escalation. Prove internal notes stay internal and external notices avoid sensitive payloads. PRD 12. Note 2026-10-18: the Sheet Inbox files or dismisses inbound email (consultant-scoped) and lists delivery problems; replies, internal notes and announcements are not built. |
| T035 | ENG, UX | T021, T025, T026, T030, T034 | Client home with next action, progress, documents, messages, agreement and payment history. Test mobile completion of requested actions with realistic long names and bilingual content. DES-02, 05. |

Gate E: reconcile provider events to invoices/ledger under duplicates and failure; professional and finance reviewers approve the chosen client-money workflow before real collection.

## Phase F — Submission, decisions and ongoing service

| ID | Owner | Depends on | Task and concrete acceptance evidence |
| --- | --- | --- | --- |
| T036 | ENG, PRO | T022, T028 | Authorized manual submission handoff with reviewer signoff, package version, submission reference, receipt and submitting actor. Case status cannot claim submission without evidence or an explicit audited exception policy. No assumed government write API. PRD 14. |
| T037 | ENG, PRO | T024, T026, T034, T036 | Government correspondence capture, acknowledgment, request deadlines, response tasks and evidence. Reconcile multiple requests without overwriting the original message or date. PRD 14. |
| T038 | ENG, UX, PRO | T036, T037 | Decision recording for approval, refusal, withdrawal, and other supported outcomes. Require evidence and consultant review; next steps are reviewed, scoped and sourced. Never convert payment or preparation completion to approval. PRD 7, 14. |
| T039 | ENG, PRO | T015, T026, T038 | Post-decision actions, document expiries, renewals and linked new matters. Require new scope/engagement where applicable; professional review determines options after refusal. PRD 14. |
| T040 | ENG, PRO, SEC | T003, T008, T024, T038 | Matter closure, portable file export, legal holds, approved retention clocks and deletion. Verify held records survive deletion jobs and exported files retain provenance with authorized access. PRD 16, 25. |

Gate F: demonstrate intake through decision and closure for a synthetic case, plus refusal and additional-document-request branches. Successful approval is one outcome, never an assumed terminal state.

## Phase G — Operations and launch

| ID | Owner | Depends on | Task and concrete acceptance evidence |
| --- | --- | --- | --- |
| T041 | ENG, PO | T008, T023, T030, T038 | Consultant dashboards and reports with explicit metric definitions, role access, source freshness and export permissions. Distinguish firm work time from government processing. PRD 17, 22. |
| T042 | ENG, PO, FIN | T010, T018 | SaaS subscriptions, seats, entitlements, trial/conversion, cancellation, and data-export access. Separate platform subscription revenue from client immigration service payments. Validate proposed pricing with buyers. PRD 3, 17. |
| T043 | ENG, SEC, OPS | T006, T007, T008 | Platform support controls with time-limited, purpose-limited access grants, audit, revocation and incident workflow. No standing support ability to browse client documents. PRD 16, 17. |
| T044 | ENG, OPS, SEC | T007, T024, T040 | Migration with dry run, field mapping, duplicate review, checksum/count verification, permission mapping, and rollback. Pilot with an authorized limited dataset. PRD 25. |
| T045 | SEC, ENG | T007, T012, T024, T031, T043 | Independent security review and threat-model verification: authorization, upload abuse, SSRF, signed links, webhooks, source poisoning, secrets, dependency risks, logs and exports. Resolve critical/high findings before launch. PRD 16, 21. |
| T046 | UX, ENG | T035, T038 | Accessibility and responsive acceptance of critical consultant/client flows; test keyboard, screen reader, zoom, contrast and error recovery. Record fixes and remaining approved limitations. DES-03, 04, 05. |
| T047 | ENG, OPS | T010, T024, T040 | Backup/restore exercise, queue outage recovery, provider outage tests, load tests and operational alerts. Measure proposed RPO/RTO and latency targets with representative workload; do not claim achievement until measured. PRD 21. |
| T048 | PRO, FIN, SEC, PO | T014, T016, T032, T036, T040, T045 | Complete professional, privacy and financial release review for exact jurisdiction, program, providers and deployed version. Record signoffs and remaining exclusions. PRD 23, 26; SRC-11, 12. |
| T049 | PO, OPS | T041, T042, T044, T046, T047, T048 | Run controlled pilot with named firms, training, support ownership, incident contacts and success baseline. Review workflow completion, errors, reconciliation and client experience before expanding. PRD 22, 25. |
| T050 | PO, OPS, ENG | T049 | Launch only after pilot exit review; document rollback, limitations, operating cadence, source owners and maintenance responsibilities. Add later jurisdictions, enterprise features and integrations as separately reviewed releases. PRD 24, 27. |

## Prioritization and release planning

The smallest meaningful pilot covers an engaged client's intake, evidence, tasks, communication, approved financial workflow, preparation, manual submission evidence, and decision recording for a deliberately narrow reviewed program. Do not call a lead CRM the finished end-to-end platform. AI, automated extractions, advanced analytics, complex enterprise SSO and additional countries can follow without weakening core permissions or source gates.

The original PRD's staffing and delivery range are estimates to validate after T001/T004, technical discovery, and provider selection. Do not translate this task count directly into days. Review capacity, payment setup, real source packs, migrations and external integration access are schedule dependencies. Scope reductions require a recorded product decision.

## Ready and done checks

Before starting a task: name an owner, identify its PRD acceptance requirement, confirm dependencies, classify any regulated content, and choose review evidence. Use synthetic fixtures when real client data is unnecessary. For a blocked task, record what is missing and continue independent work.

Before closing: demonstrate the meaningful behavior and failure path, check authorization and affected source provenance, review required design states, add necessary tests rather than implementation-mirroring tests, record migrations/rollbacks where relevant, and update MEMORY with evidence. Label externally dependent work accurately; a stub is not a completed integration.

At each milestone, show a short product demo and retain a release evidence manifest containing environment/build identifier, checks run, results, reviewers, source-pack versions, material limitations and rollback procedure. Keep client secrets and personal records out of this public project documentation.

## Implementation notes

* 2026-10-18 (branch `sheet-firm-admin`): Sheet Roles, Licences (+ Review log), licence-suspended home, Access grants, Intake form builder, Templates and Automations are live on real data (T018 licence evidence and reassignment, T020 versioned builder, T043 grant controls in part). Privacy requests (SEC-06) stays the Designer demo: no register or recording dialog exists. Open items are in DECISIONS.md.
