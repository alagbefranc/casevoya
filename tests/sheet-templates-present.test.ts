import { describe, expect, it } from "vitest";
import { designUse, messageRows, programRows, ruleDetail, sourceKpis, sourceRows, templatesData, type RuleRow } from "@/modules/sheet/templates-present";
import { EMAIL_TEMPLATES } from "@/modules/email/designs/catalog";

const RULE: RuleRow = {
  id: "r1",
  stableKey: "CA.EXAMPLE.RULE",
  versionNumber: 2,
  jurisdiction: "CA",
  programKey: null,
  status: "review_due",
  effectiveFrom: null,
  nextReviewAt: "2026-10-01T00:00:00Z",
  claim: null,
  applicabilityNote: null,
  reviewer: null,
  lastChecked: null,
  affected: 1,
  source: null,
};

describe("Templates page", () => {
  it("labels firm templates apart from central packs and counts pinned matters", () => {
    const rows = programRows(
      [{ id: "p1", programKey: "fictional_program", jurisdiction: "CA", packVersion: 3, status: "published", firm: false, nextReviewAt: null }],
      new Map([["p1", 2]]),
      [{ id: "a1", name: "Standard service agreement", kind: "service", status: "approved", approvedAt: "2026-10-02T12:00:00Z", approvedBy: "Dana Lee", version: 4 }],
      new Map([["a1", 5]]),
    );
    expect(rows[0]).toMatchObject({ template: "fictional_program", version: "v3", source: "Casevoya central", pinned: "2", reviewer: "—" });
    // An agreement template has no jurisdiction: its kind goes with its name, and the row opens it.
    expect(rows[1]).toMatchObject({
      template: "Standard service agreement (Service agreement)",
      jurisdiction: "—",
      source: "Firm template",
      reviewer: "Dana Lee",
      effective: "2 Oct 2026",
      pinned: "5",
      href: "/sheet/agreements?dlg=template",
    });
  });

  it("says from real deliveries whether each email was sent, when, and in which language", () => {
    const catalog = Object.values(EMAIL_TEMPLATES).map((template) => ({ id: template.id, name: template.name, audience: template.audience, status: template.status, frenchApproved: false }));
    const never = messageRows(catalog);
    expect(never).toHaveLength(Object.keys(EMAIL_TEMPLATES).length);
    expect(never.every((row) => ["Approved, not sent yet", "Approved, not in use yet", "Deferred"].includes(row.state.label))).toBe(true);
    expect(never[0].languages).toEqual({ left: "English", right: "French not approved yet" });
    expect(never[0].href).toBe(`/api/email-designs/preview?id=${catalog[0].id}`);

    const use = designUse([
      { template: "invite", context: { kind: "staff" }, updated_at: "2026-10-15T14:00:00Z" },
      { template: "invite", context: { kind: "staff", locale: "fr-CA" }, updated_at: "2026-10-17T14:00:00Z" },
      { template: "reminder", context: {}, updated_at: "2026-10-16T14:00:00Z" },
      { template: "nonsense", context: {}, updated_at: "2026-10-16T14:00:00Z" },
    ]);
    expect(use.get("EM01")).toMatchObject({ sent: 2, lastSentAt: "2026-10-17T14:00:00Z" });
    expect(use.get("EM07")).toMatchObject({ sent: 1 });
    const rows = messageRows(catalog, use, "America/Toronto");
    const em01 = rows[catalog.findIndex((row) => row.id === "EM01")];
    expect(em01.state).toEqual({ tone: "ok", label: "Sent 2 times", detail: "last 17 Oct" });
    const approvedFrench = messageRows([{ ...catalog[0], frenchApproved: true }]);
    expect(approvedFrench[0].languages).toEqual({ left: "English", right: "French approved" });
  });

  it("never fills a missing source, reviewer or date, and marks overdue reviews", () => {
    const [row] = sourceRows([RULE], "2026-10-18");
    expect(row).toMatchObject({ reviewer: "—", effective: "—", lastChecked: "—", nextReview: { num: { left: "Overdue", right: "1 Oct" } }, href: "?tab=rule&view=r1" });
    const kpis = sourceKpis([RULE], 0, "2026-10-18");
    expect(kpis[0]).toMatchObject({ value: "1", note: "1 overdue", warn: true });
    const detail = ruleDetail(RULE);
    expect(detail).toMatchObject({ claim: "No claim recorded yet.", source: null, actions: null, tests: null });
    const data = templatesData({ tab: "program", program: [], messages: [], rules: [RULE], packs: 0, selected: null, today: "2026-10-18" });
    expect(data.pills).toEqual(["1 source needs review"]);
    expect(data.checklists.cards).toEqual([]);
  });
});
