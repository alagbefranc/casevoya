# GOV (Government submissions): partly built requirements

Requirements: GOV-01, GOV-03, GOV-04, GOV-05. Source: `docs/spec/PRD.md`, status from the PRD status review of main 6d5e54f (rechecked against aac7804, which adds only #173). UI checked on https://app.casevoya.ca on 2026-10-23.

Rules for whoever builds this: test mode only for Stripe (never live keys); new migrations go in `supabase/migrations/` and are applied by Francis, not by the builder; no invented immigration rules, fees or dates; wording follows `docs/spec/DECISIONS.md` and the design system.

## GOV-01: Submission checklist

> **PRD GOV-01:** Create a submission checklist tailored to program and channel. Require current representation evidence, released package version, reviewed deadlines, required signatures, and confirmed fee handling. Show which actions occur outside Casevoya.

**UI check:** partly present (route: /sheet/matters/<matter id>?tab=submissions)

- What's there: Submissions tab records submissions (channel, reference, date) and shows "Submission unverified" until confirmed; package release exists (#16).
- What's missing on screen: No submission checklist (representation evidence current, released package version, reviewed deadlines, signatures, fee handling confirmed) and no list of steps that happen outside Casevoya before recording a submission.

**Built today**

- `src/modules/submissions/`, `src/modules/sheet/matter-submissions-*`
- Package release (#16)

**Missing (acceptance criteria)**

- [ ] Before **Record submission**, a **Submission checklist** card shows each gate with live status and a link: representation (Use of a Representative) current; package version released; deadlines reviewed; required signatures complete; fees handled/confirmed.
- [ ] A blocking gate prevents recording (owner can override with a reason, audited).
- [ ] "Done outside Casevoya" list for the channel (e.g. pay government fee in IRCC portal, upload in the portal), each tickable.

**Likely migration:** Probably none (checks derive from existing data); maybe a checklist-state table.

**UI test steps**

1. ON-2026-0002 Submissions: checklist shows representation and package gates; with no released package, Record submission is blocked; release a package: gate turns green.

**Open PRs:** Not covered by any open PR.

![GOV-01](img/GOV-01.png)

## GOV-03: Submission record, manifest, receipt

> **PRD GOV-03:** Record channel, application reference, submission timestamp, submitting representative, package manifest, receipt, and supporting evidence. Submission date and acknowledgment date are separate. If confirmation is missing, display Submission unverified rather than Submitted to government.

**UI check:** partly present (route: /sheet/matters/<matter id>?tab=submissions)

- What's there: Submission record: channel, application reference, submitted at, representative; "Submission unverified" vs confirmed; acknowledgment separate.
- What's missing on screen: No package manifest (list of files and hashes actually submitted) on the record; no receipt/evidence upload control shown.

**Built today**

- `src/modules/submissions/`

**Missing (acceptance criteria)**

- [ ] Recording a submission pins the **package manifest** (released package version, file list, SHA-256 per file) to the record, shown on screen and in the audit.
- [ ] **Add receipt / evidence**: upload the government confirmation; acknowledgment date entered separately; only then does it read Submitted to government.
- [ ] Without evidence it stays "Submission unverified".

**Likely migration:** Maybe: manifest snapshot column / table.

**UI test steps**

1. Record a submission on ON-2026-0002: manifest shows files and hashes; status Submission unverified; upload a receipt PDF + acknowledgment date: status Submitted to government.

**Open PRs:** Not covered by any open PR.

![GOV-03](img/GOV-03.png)

## GOV-04: Government correspondence

> **PRD GOV-04:** Staff record government correspondence through upload or reviewed email import. Store issuer, document date, received date, action requested, confirmed due date, evidence, and audience. One letter may create several tasks for different people.

**UI check:** partly present (route: /sheet/matters/<matter id>?tab=decisions (Record letter))

- What's there: Record a government letter dialog: upload, received date, action requested, due date, audience; letter can create a task.
- What's missing on screen: Dialog lacks **issuer** and **letter (document) date** even though the DB columns exist; one letter creates only one task (not several for different people); no reviewed email-import path.

**Built today**

- `government_correspondence` table with issuer / document_date columns
- `src/modules/decisions/` or correspondence actions

**Missing (acceptance criteria)**

- [ ] Letter dialog adds **Issuer** (e.g. IRCC, CBSA, a visa office) and **Letter date**, separate from received date.
- [ ] **Tasks from this letter**: add several tasks, each with owner (staff or client), due date and description.
- [ ] Optional: a letter from Triage/inbound email can be filed here after staff review (links to OPS-06).

**Likely migration:** Probably none (columns exist); maybe a letter→tasks link.

**UI test steps**

1. Record a letter on ON-2026-0002 with issuer IRCC, letter date 2026-10-20, received 2026-10-22, two tasks (one for the client): both tasks appear; the client sees theirs.

**Open PRs:** Not covered by any open PR.

![GOV-04](img/GOV-04.png)

## GOV-05: Government status provenance

> **PRD GOV-05:** Every government status has source, recorder, evidence, verified time, and last checked time. Client views clearly identify updates recorded by the firm. Do not display real-time tracking or automatic government synchronization unless an actual supported integration provides it.

**UI check:** partly present (route: /sheet/matters/<matter id>?tab=submissions, /portal (home))

- What's there: Staff record government status updates with source and recorder; portal shows status recorded by the firm; no real-time tracking claimed.
- What's missing on screen: No "verified at" / "last checked" times on screen; no evidence link per status; `share_government_record` (share with client) has no UI.

**Built today**

- Government status records and `share_government_record` function (DB)
- Portal home status

**Missing (acceptance criteria)**

- [ ] Each status shows source, recorder, evidence link, verified time and **last checked** time; **Mark checked** updates last checked.
- [ ] **Share with client** button (calls `share_government_record`) with preview of what the client will see; portal says "Recorded by <firm> on <date>".
- [ ] No wording implying automatic sync.

**Likely migration:** Probably none (function exists); maybe last_checked_at column.

**UI test steps**

1. Add a status on ON-2026-0002, Mark checked: last checked updates. Share with client: /portal shows "Recorded by Test Firm".

**Open PRs:** Not covered by any open PR.

![GOV-05](img/GOV-05.png)
![GOV-05-2](img/GOV-05-2.png)
