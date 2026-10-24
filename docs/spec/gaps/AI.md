# AI (AI (Vo)): partly built requirements

Requirements: AI-01, AI-06. Source: `docs/spec/PRD.md`, status from the PRD status review of main 6d5e54f (rechecked against aac7804, which adds only #173). UI checked on https://app.casevoya.ca on 2026-10-23.

Rules for whoever builds this: test mode only for Stripe (never live keys); new migrations go in `supabase/migrations/` and are applied by Francis, not by the builder; no invented immigration rules, fees or dates; wording follows `docs/spec/DECISIONS.md` and the design system.

## AI-01: Optional AI capabilities

> **PRD AI-01:** Optional capabilities are document classification, OCR normalization, missing-field detection, inconsistency flags, matter summaries, administrative reply drafts, and first drafts of letters from approved facts. The firm can disable AI while using core functionality.

**UI check:** partly present (route: /sheet/settings (Vo), /sheet/matters/<matter id> (Vo panel))

- What's there: Vo: document classification and reading, missing-field and inconsistency flags, matter summary, reply drafts; firm switch to turn Vo off (core works without it).
- What's missing on screen: Not built: first drafts of **letters** from approved facts (e.g. submission/cover letter), **lead follow-up** drafts, **call notes** summaries.

**Built today**

- `src/modules/vo/` (#106, #118)

**Missing (acceptance criteria)**

- [ ] **Draft letter with Vo** on the matter (Drafts): uses only approved facts, cites each fact, labelled draft, licensed review required before release.
- [ ] **Lead follow-up draft** on a Lead page (respects marketing consent).
- [ ] **Call notes**: after a Casevoya video call, staff can paste/upload notes and get a summary draft (no recording unless CRM-03 recording exists).
- [ ] All respect the firm AI switch and category switches (AI-06).

**Likely migration:** Maybe: drafts table additions for source citations.

**UI test steps**

1. In a Vo-on test firm, Draft letter on a matter: draft lists cited facts; can't be released without licensed review. Turn Vo off: the buttons disappear; manual drafting works.

**Open PRs:** Not covered by any open PR.

![AI-01](img/AI-01.png)

## AI-06: AI vendor terms and switches

> **PRD AI-06:** Contractually evaluate vendor data use, retention, processing region, subprocessors, and deletion. Do not train on client records by default. AI must be independently switchable by firm and sensitive document category. A non-AI workflow remains available.

**UI check:** partly present (route: /sheet/settings (Vo / Integrations))

- What's there: Firm AI switch and sensitive-category switches; non-AI workflow remains; no training by default.
- What's missing on screen: No vendor-terms panel showing the AI vendor's data use, retention, processing region, subprocessors and deletion terms.

**Built today**

- Vo switches in `src/modules/vo/`

**Missing (acceptance criteria)**

- [ ] Settings > Vo: **AI vendor terms** panel (read from a reviewed config, not invented): vendor, data use (no training), retention, processing region, subprocessors, deletion; last reviewed date; link to the full terms.
- [ ] Owner must acknowledge the panel before first turning Vo on (audited).

**Likely migration:** Maybe: acknowledgement column.

**UI test steps**

1. Settings > Vo shows the panel; turning Vo on asks for acknowledgement once; audit row.

**Open PRs:** Not covered by any open PR.

![AI-06](img/AI-06.png)
