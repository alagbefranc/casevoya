import { describe, expect, it } from "vitest";
import { messageRows, programRows, ruleDetail, sourceKpis, sourceRows, templatesData, type RuleRow } from "@/modules/sheet/templates-present";
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
    expect(rows[1]).toMatchObject({ jurisdiction: { left: "Firm", right: "Service agreement" }, source: "Firm template", reviewer: "Dana Lee", effective: "2 Oct 2026", pinned: "5" });
  });

  it("lists every approved email design with its real state", () => {
    const rows = messageRows(Object.values(EMAIL_TEMPLATES).map((template) => ({ name: template.name, audience: template.audience, status: template.status })));
    expect(rows).toHaveLength(Object.keys(EMAIL_TEMPLATES).length);
    expect(rows.every((row) => ["Approved, in use", "Approved, not sent yet", "Deferred"].includes(row.state.label))).toBe(true);
    expect(rows[0].languages).toEqual({ left: "English", right: "French deferred" });
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
