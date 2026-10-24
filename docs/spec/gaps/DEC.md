# DEC (Decisions): partly built requirements

Requirements: DEC-02. Source: `docs/spec/PRD.md`, status from the PRD status review of main 6d5e54f (rechecked against aac7804, which adds only #173). UI checked on https://app.casevoya.ca on 2026-10-23.

Rules for whoever builds this: test mode only for Stripe (never live keys); new migrations go in `supabase/migrations/` and are applied by Francis, not by the builder; immigration content (rules, fees, forms, document lists, dates) is built from official IRCC / Government of Canada sources, with the source URL and retrieval date stored with each value (see **Official sources** below); wording follows `docs/spec/DECISIONS.md` and the design system.

## Official sources (applies to everything in this file)

Francis's direction: build the real content using accurate, current information from IRCC. Don't build placeholder, sample or example rules, fees, dates, forms or sources.

- Use only official IRCC / Government of Canada sources:
  - IRCC home: https://www.canada.ca/en/immigration-refugees-citizenship.html
  - Application forms and guides (form numbers and "date modified"): https://www.canada.ca/en/immigration-refugees-citizenship/services/application/application-forms-guides.html
  - IRCC fee list: https://ircc.canada.ca/english/information/fees/fees.asp
  - Processing times: https://www.canada.ca/en/immigration-refugees-citizenship/services/application/check-processing-times.html. IRCC says these times are "not a maximum or a guarantee", so show them as IRCC's estimate with the date checked.
  - Program pages and instruction guides on canada.ca for each program.
  - Where relevant, Justice Laws: IRPA https://laws-lois.justice.gc.ca/eng/acts/I-2.5/ and IRPR https://laws-lois.justice.gc.ca/eng/regulations/SOR-2002-227/. Record the "current to" date shown on the page.
- **Store the source with every value.** Every rule, fee, form, document list, deadline or date stores:
  - its official source URL, with the section or anchor;
  - the form number and the form's "date modified" where it applies;
  - the date it was retrieved, plus a snapshot hash;
  - the effective or "current to" date when the page states one.

  Store these with the rule or claim (SRC-01/02). Show them in the UI next to the value.
- **No invented values.** If something can't be found on an official page, leave it out, show it as Unknown where the UI needs a slot, and list it in your `## Handoff` comment. Don't guess.
- **Review before live.** Content goes live only through the licensed-reviewer approval (SRC-03). Matters pin the version they used (SRC-05). Vo cites these sources or abstains (SRC-09, AI-01).
- Spot check (retrieved 2026-10-23 from the fee list above):
  - "Study permit (including extensions) – per person" is $150.00.
  - "Right of permanent residence fee" is $600.00.

  Use the live page at build time, not these numbers.

## DEC-02: Approval follow-up

> **PRD DEC-02:** Approved matters receive a program-specific follow-up checklist, document-delivery record, conditions summary approved by the consultant, relevant expiry reminders, and closure tasks. Renewal reminders require valid contact preferences and clearly defined scope for any new service.

**UI check:** partly present (route: /sheet/matters/<matter id>?tab=decisions, /sheet/matters/<matter id>?tab=closure)

- What's there: Decisions tab records outcomes; Closure tab has closure tasks; expiry reminders exist for documents.
- What's missing on screen: On approval, no program follow-up checklist, no **conditions summary** approved by the consultant, no **document delivery record** (what was sent to the client and when), no successor (renewal) control respecting contact preferences.

**Built today**

- `src/modules/decisions/`, `src/modules/closure/`

**Missing (acceptance criteria)**

- [ ] Recording an approval adds a follow-up checklist to the matter.
- [ ] **Conditions summary**: staff drafts, licensed consultant approves; the client sees the approved text in the portal.
- [ ] **Delivery record**: which decision documents went to the client, how and when (with acknowledgement).
- [ ] **Renewal reminder / successor matter**: only if the client's contact preferences allow; scope of any new service stated; creates a lead or draft matter, never auto-bills.
- [ ] Program follow-up checklists, expiry reminders and renewal timing (e.g. PR card renewal, study/work permit extension windows, PR status, CoPR next steps) come from official IRCC program pages and guides, with the URL and retrieved date stored. If an official page doesn't state a timing, don't set a default; list it in the handoff.
- [ ] Renewal fee amounts shown to clients come from the IRCC fee list with the retrieved date.

**Likely migration:** Yes: conditions summary + delivery record tables.

**UI test steps**

1. Record an approval on ON-2026-0008: follow-up checklist appears; draft and approve a conditions summary; client sees it; record delivery of the decision letter; set a renewal reminder (client opted in).

**Open PRs:** Not covered by any open PR.

![DEC-02](img/DEC-02.png)
