# Handoff: gap PR work paused at OPS (#179)

Written 2026-10-24 so another agent can pick up the gap PR work (#175–#189) where it stopped.

**The order of areas:** ORG, CRM, INT, DOC, OPS, FIN, GOV, DEC, AI, SEC, REP, ADM, MIG, SRC, DES.

**Where things stand:**
- **Finished:** ORG, CRM, INT and DOC are built as far as they can be without official IRCC pages.
- **Handoff comments:** each finished area has a `## Handoff` comment on its gap PR.
- **OPS:** not started; no OPS code has been written or pushed.

## 1. State of the PRs

### Merged
- #195
- #197 (CRM-03)
- #199 (CRM-01)
- #200 (INT-04 fact reuse)
- #201 (INT-05 identity history)

### Open drafts, CI green, waiting on Francis/@swe

| PR | Area | Branch | Base | Migration |
|----|------|--------|------|-----------|
| #174 | Portal follow-ups | `fix/portal-followups` | main | see PR |
| #193 | ORG-06 consultant-change notice | `feat/org-consultant-change-notice` | main | yes |
| #196 | CRM-01 enquiry staff email | `feat/crm-enquiry-staff-email` | #193 | see PR |
| #198 | CRM-03 call token | `feat/crm-call-token` | `feat/crm-booking-manage` (#197, now merged) | see PR |
| #202 | DOC-02 scan label, upload limit, macro refusal | `feat/doc-scan-limit` | main | `20261024200000` |
| #203 | DOC-06 evidence links, translations, classification | `feat/doc-evidence-links` | main | `20261024210000` |
| #204 | DOC-07 custody steps, watermarked preview | `feat/doc-custody-preview` | #203 | `20261024220000` |
| #205 | DOC-01 checklist templates, Apply checklist | `feat/doc-checklists` | #204 | `20261024230000` |
| #206 | DOC-05 read on upload, page link, DOCX reading | `feat/doc-vo-reading` | #205 | `20261025000000` |

**Merge order:** the DOC stack must merge in order, #203 → #204 → #205 → #206.

**Retarget #198:** its base branch is merged, so point #198 at `main` before merging it.

### Last commit
`837cced` on #206 lets Vo read DOCX files (DOC-05 criterion 4). Only the text of `word/document.xml` reaches the model.

| Part | Where |
|------|-------|
| Text extraction | `src/modules/vo/docx-text.ts` |
| `docx` media kind and ZIP check | `src/modules/vo/vo-doc.ts` |
| Agent change | `services/vo-agent/src/vo-doc-read.ts` |

The Vo agent lives in `services/vo-agent`; its `package.json` says "Not deployed". The DOCX change only takes effect once that container is rebuilt and redeployed.

## 2. Blocked or deliberately not built

**Needs official IRCC pages.** canada.ca is blocked by this session's network policy. Never invent IRCC content.
- INT-04 criterion 4
- INT-05 criterion 4
- DOC-01 criterion 4
- DOC-05 criterion 5 (map fields to the current IRCC form)
- CRM-01 criterion 5

**Infrastructure choices for Francis:**
- **HEIC to JPEG:** there is no decoder in the repo.
- **Malware scanner:** none is in place.
- **True redaction:** pdf-lib leaves the text extractable, so it can't redact.
- **Unattended Vo reading at client upload:** this needs a service identity in the agent.

## 3. Next task: OPS-01 (task detail)

**Spec:**
```
git fetch origin refs/pull/179/head:refs/remotes/pr/179
git show pr/179:docs/spec/gaps/OPS.md
```

**Branch:** `feat/ops-task-detail`, from `main`.

### Already in the database (reuse, don't rebuild)
- **Task functions:** `add_task_watcher`, `add_task_dependency`, `update_task`, `reassign_task` and `escalate_overdue_work` exist.
- **Dependency check:** `app.set_task_status` already refuses to complete a task while its dependencies are still open.

### To build
1. **Task detail drawer:** watchers, depends on, checklist, estimate and blocker.
2. **Watcher notifications:** add a `'task'` kind branch to `app.staff_notification_items`, and add the kind to `KINDS` in `notifications-present.ts`.
   - Copy the function's latest definition, in `supabase/migrations/20261020180100_intake_delivery_notifications.sql`, into a new migration and edit it there.
3. **Recurrence:** needs a migration.
4. **Filters:** Blocked and Watching.
5. **Due dates:** shown in the firm's timezone. Use `app.firm_today(org)`, never the server date; a test enforces this.
6. **Escalation:** notifies the matter's responsible consultant.
7. **Reassignment:** sends a reassign notification.

### After OPS-01
1. OPS-04, then OPS-06.
2. Post the OPS `## Handoff` comment on #179.
3. Then work through FIN (#180), GOV (#181), DEC (#182), AI (#183), SEC (#184), REP (#185), ADM (#186), MIG (#187), SRC (#188) and DES (#189).

**For each area:**
- Build the unchecked acceptance criteria in `docs/spec/gaps/<AREA>.md`.
- Read it from the gap PR's head as shown above.

## 4. How each PR is written
- **First line:** `Migration: yes` or `Migration: no`.
- **"Test, merge and deploy (@swe)" section**, containing:
  - the PR facts;
  - numbered checks, each with a *Pass:* line;
  - migration notes;
  - the deploy command `git checkout main && git pull && pnpm run deploy:app`;
  - "If a check fails".
- **Draft:** create it as a draft and subscribe to its activity.
- **Migrations:** Francis applies them. Never run them against prod.
- **Payments:** Stripe test mode only.
- **Honest state:** never show something as working when it isn't.
- **Never:**
  - write credentials (for example LiveKit) to files, commits or PRs;
  - put model IDs in commits or PRs.

## 5. Conventions that caused failures
- **SECURITY DEFINER functions:** set `search_path=''`. To change a function, copy its latest definition into a new migration.
- **`pnpm check:migrations`:** forbids `drop` and `delete from` outside function bodies.
- **plpgsql variable names:** don't reuse column names such as `key`, `at`, `purpose` or `field_key`; they are ambiguous.
- **Document updates:** wrap them in `app.open_document_write(id)` / `close_document_write`.
- **Audit table:** it is `audit_log`, keyed by `object_id`.
- **`src/modules/sheet/use-sheet.ts`:** put click handlers after `const busyRun` (around line 722), or you get a TDZ error.
- **Fidelity tests:** live-only props must be optional.
- **Formatting:** don't run prettier; the repo isn't prettier-formatted.
- **Database tests (PGlite):** `createTestDb`, `asUser`, `asMaintenance`, `expectDbError`.

## 6. Checks before every push
```
rm -rf .next/types && pnpm exec next typegen
NODE_OPTIONS=--max-old-space-size=6144 pnpm exec tsc --noEmit -p .
pnpm lint                      # 2 known warnings
pnpm check:migrations
NODE_OPTIONS=--max-old-space-size=6144 timeout 590 pnpm exec vitest run
```

**Known errors on `main`:** `services/vo-agent` typecheck shows 2 errors in `runtime/worker.ts`. They are already on `main`, so they are not a regression.
