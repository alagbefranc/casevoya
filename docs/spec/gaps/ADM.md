# ADM (Platform admin): partly built requirements

Requirements: ADM-04. Source: `docs/spec/PRD.md`, status from the PRD status review of main 6d5e54f (rechecked against aac7804, which adds only #173). UI checked on https://app.casevoya.ca on 2026-10-23.

Rules for whoever builds this: test mode only for Stripe (never live keys); new migrations go in `supabase/migrations/` and are applied by Francis, not by the builder; no invented immigration rules, fees or dates; wording follows `docs/spec/DECISIONS.md` and the design system.

## ADM-04: Onboarding, incidents, SLA

> **PRD ADM-04:** Support onboarding tasks, permissioned troubleshooting, tenant incident notices, and service-level reporting. Aggregate product analytics use operational metadata and exclude immigration narratives, identity numbers, uploaded documents, and message bodies.

**UI check:** partly present (route: /sheet/settings?tab=security, platform admin)

- What's there: Onboarding checklist for new firms; permissioned support access (grant/revoke, audited).
- What's missing on screen: No tenant incident / service notices shown to firms; no service-level (uptime/response) reporting; analytics exclusion not documented on screen.

**Built today**

- Firm onboarding (`src/modules/firm-onboarding/`)
- Support access grants

**Missing (acceptance criteria)**

- [ ] **Service notices**: platform staff post a notice (maintenance/incident) targeted to all or some firms; firms see a banner and a history page.
- [ ] **Service level report**: monthly uptime and support response times per firm (from real monitoring data or marked unavailable).
- [ ] Product analytics uses metadata only (documented in code and settings copy).

**Likely migration:** Yes: `service_notices` (+ reads).

**UI test steps**

1. Post a test notice to Test Firm only: banner appears for Test Firm staff, not other firms.

**Open PRs:** Not covered by any open PR.

![ADM-04](img/ADM-04.png)
![ADM-04-2](img/ADM-04-2.png)
