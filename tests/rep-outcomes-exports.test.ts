import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SheetReports, type ReportsData, type ReportsOutcomes } from "@/components/sheet/designer/reports";
import type { EstimateRow } from "@/modules/government/status-provenance";
import { exportMeta, exportStamp, reportCsv, reportPdf, reportSections } from "@/modules/sheet/reports-export";
import {
  NO_ESTIMATE_NOTE,
  OUTCOMES_DEFINITION,
  outcomeCounts,
  outcomeSegments,
  programEstimates,
  programFilter,
  quarterCohort,
  segmentsNote,
  type OutcomeRecord,
} from "@/modules/sheet/reports-outcomes";
import { pdfText } from "./helpers/pdf-text";

/**
 * REP-02 (program × quarter segments, durations with range and n, pending excluded, counts never
 * rates, IRCC's estimate apart) and REP-03 (each export carries its filters, generated time,
 * currency and who generated it). Synthetic test data only.
 */
const TZ = "America/Toronto";
const day = (iso: string, plus: number) => new Date(Date.parse(iso) + plus * 86_400_000).toISOString();

function decided(prefix: string, program: string | null, submittedAt: string, days: number[], outcomes: string[]): OutcomeRecord[] {
  return days.map((d, index) => ({
    matterId: `${prefix}${index}`,
    program,
    createdAt: day(submittedAt, -30),
    submittedAt,
    decidedAt: day(submittedAt, d),
    outcome: outcomes[index % outcomes.length],
  }));
}

function estimate(over: Partial<EstimateRow> & { matter_id: string }): EstimateRow & { matter_id: string } {
  return {
    id: "e",
    source_url: "https://www.canada.ca/en/immigration-refugees-citizenship/services/application/check-processing-times.html",
    application_type: "Synthetic application type",
    estimate_text: "Synthetic estimate A",
    checked_on: "2026-10-20",
    page_retrieved_at: null,
    snapshot_sha256: null,
    status: "approved",
    entered_by_membership_id: "m",
    reviewed_by_membership_id: "r",
    reviewed_at: "2026-10-21T00:00:00Z",
    created_at: "2026-10-20T00:00:00Z",
    version: 2,
    page_attested_by_membership_id: "r",
    page_attested_on: "2026-10-21",
    ...over,
  };
}

describe("REP-02 cohorts and segments", () => {
  it("puts a submission in its quarter in the firm's timezone", () => {
    // 1 Jul 2026 02:00 UTC is still 30 June in Toronto.
    expect(quarterCohort("2026-07-01T02:00:00Z", TZ)).toEqual({ key: "2026-Q2", label: "Submitted Apr–Jun 2026" });
    expect(quarterCohort("2026-07-01T02:00:00Z", "UTC")).toEqual({ key: "2026-Q3", label: "Submitted Jul–Sep 2026" });
    expect(quarterCohort("2025-12-31T23:00:00Z", TZ).label).toBe("Submitted Oct–Dec 2025");
  });

  it("segments by program and quarter with median, range and n; pending files never counted", () => {
    const records: OutcomeRecord[] = [
      ...decided("a", "study_permit", "2026-02-10T15:00:00Z", [30, 40, 50, 60, 90], ["approved", "refused"]),
      // Same program, next quarter: a separate cohort.
      ...decided("b", "study_permit", "2026-05-10T15:00:00Z", [20, 25], ["approved"]),
      // Pending (no outcome) in the first cohort: counted apart only.
      { matterId: "p1", program: "study_permit", createdAt: "2026-01-01T00:00:00Z", submittedAt: "2026-02-11T15:00:00Z", decidedAt: null, outcome: null },
      { matterId: "p2", program: "study_permit", createdAt: "2026-01-01T00:00:00Z", submittedAt: "2026-02-12T15:00:00Z", decidedAt: "2026-04-12T15:00:00Z", outcome: null },
      // Decided but never moved to Decision review: decided, not timed.
      { matterId: "u1", program: "work_permit", createdAt: "2026-01-01T00:00:00Z", submittedAt: "2026-02-12T15:00:00Z", decidedAt: null, outcome: "withdrawn" },
      // Never submitted: not in the report.
      { matterId: "x1", program: "visitor_visa", createdAt: "2026-01-01T00:00:00Z", submittedAt: null, decidedAt: null, outcome: null },
    ];
    const result = outcomeSegments(records, { timeZone: TZ, linkFor: (key) => `/sheet/reports?tab=outcomes&program=${key}` });
    expect(result.rows.map((row) => [row.program, row.cohort, row.decided, row.median, row.pending, row.range, row.outcomes])).toEqual([
      ["Study permit", "Submitted Apr–Jun 2026", 2, "—", 0, "— (2 timed)", "—"],
      ["Study permit", "Submitted Jan–Mar 2026", 5, "50", 2, "30–90 (5 timed)", "3 approved, 2 refused"],
      ["Work permit", "Submitted Jan–Mar 2026", 1, "—", 0, "— (0 timed)", "—"],
    ]);
    expect(result.rows[0].programHref).toBe("/sheet/reports?tab=outcomes&program=study_permit");
    expect(result.hidden).toHaveLength(2);
    expect(segmentsNote(result.hidden, result.rows.length)).toMatch(/^2 rows have fewer than 5 decided files with a recorded decision date/);
    expect(result.firm.find((row) => row.cohort === "Submitted Jan–Mar 2026" && row.program === "Study permit")).toEqual({
      program: "Study permit",
      cohort: "Submitted Jan–Mar 2026",
      files: 7,
      median: "30",
    });

    const narrowed = outcomeSegments(records, { timeZone: TZ, program: "work_permit", linkFor: (key) => key });
    expect(narrowed.rows.map((row) => row.program)).toEqual(["Work permit"]);
    expect(narrowed.rows[0].programHref).toBeNull();
    const none = outcomeSegments([{ ...records[0], program: null }], { timeZone: TZ, program: "none" });
    expect(none.rows.map((row) => row.program)).toEqual(["No program selected"]);
  });

  it("counts outcomes, never shares; accepts only program-key filters", () => {
    expect(outcomeCounts(["refused", "approved", "approved", "other_verified"])).toBe("2 approved, 1 refused, 1 other");
    expect(outcomeCounts([])).toBe("—");
    expect(programFilter("study_permit")).toBe("study_permit");
    expect(programFilter("none")).toBe("none");
    for (const bad of ["", "Study permit", "a'b", "x".repeat(61), null, undefined]) expect(programFilter(bad)).toBeNull();
  });

  it("shows IRCC's estimate only from an approved entry, newest per program, with its date checked and source", () => {
    const programs = new Map<string, string | null>([
      ["m1", "study_permit"],
      ["m2", "study_permit"],
      ["m3", "work_permit"],
    ]);
    const map = programEstimates(
      [
        estimate({ matter_id: "m1", estimate_text: "Synthetic older", checked_on: "2026-09-01" }),
        estimate({ matter_id: "m2", estimate_text: "Synthetic newer", checked_on: "2026-10-20" }),
        estimate({ matter_id: "m3", estimate_text: "Synthetic pending", status: "pending_review", reviewed_by_membership_id: null, reviewed_at: null }),
        estimate({ matter_id: "other", estimate_text: "Synthetic not in report" }),
      ],
      programs,
    );
    expect([...map.keys()]).toEqual(["study_permit"]);
    expect(map.get("study_permit")?.text).toBe("Synthetic newer for Synthetic application type. IRCC’s estimate, checked 20 Oct 2026; not a maximum or a guarantee.");
    expect(map.get("study_permit")?.source).toMatch(/^Source: canada\.ca, checked 20 Oct 2026, page not captured by Casevoya, checked by a licensed member on 21 Oct 2026/);

    const rows = outcomeSegments(decided("a", "study_permit", "2026-02-10T15:00:00Z", [30, 40, 50, 60, 90], ["approved"]), { timeZone: TZ, estimates: map }).rows;
    // The firm's own figures are unchanged by the estimate.
    expect(rows[0]).toMatchObject({ median: "50", range: "30–90 (5 timed)" });
    expect(rows[0].estimate?.text).toContain("IRCC’s estimate, checked 20 Oct 2026");
  });
});

function outcomesData(outcomes: ReportsOutcomes): ReportsData {
  return {
    tab: "outcomes",
    range: "90d",
    pills: ["1 Jul – 25 Oct 2026", "All offices"],
    outcomes,
    dialog: { filters: ["All programs, by quarter submitted", "all offices", "all owners"], timezone: TZ, currency: "CAD", note: "n", toastSub: "t" },
  };
}

describe("REP-02 page and copy", () => {
  const records = decided("a", "study_permit", "2026-02-10T15:00:00Z", [30, 40, 50, 60, 90], ["approved", "refused"]);
  const estimates = programEstimates([estimate({ matter_id: "a0" })], new Map(records.map((record) => [record.matterId, record.program])));
  const result = outcomeSegments(records, { timeZone: TZ, estimates, linkFor: (key) => `/sheet/reports?tab=outcomes&program=${key}` });
  const outcomes: ReportsOutcomes = {
    rows: result.rows,
    note: segmentsNote(result.hidden, result.rows.length),
    definition: OUTCOMES_DEFINITION,
    firm: { rows: result.firm, definition: "Firm work time." },
    detail: true,
    estimateNote: null,
    segment: null,
  };

  it("renders range, counts and IRCC's estimate in its own labelled column, with n", () => {
    const html = renderToStaticMarkup(createElement(SheetReports, { data: outcomesData(outcomes) }));
    expect(html).toContain("Range in days (n timed)");
    expect(html).toContain("30–90 (5 timed)");
    expect(html).toContain("3 approved, 2 refused");
    expect(html).toContain("IRCC’s estimate, checked (not the firm’s figure)");
    expect(html).toContain('href="/sheet/reports?tab=outcomes&amp;program=study_permit"');
    expect(html).not.toMatch(/%/);
  });

  it("says when no estimate is approved, and names the program a narrowed table shows", () => {
    const html = renderToStaticMarkup(
      createElement(SheetReports, {
        data: outcomesData({
          ...outcomes,
          rows: outcomes.rows.map((row) => ({ ...row, estimate: null, programHref: null })),
          estimateNote: NO_ESTIMATE_NOTE,
          segment: { label: "Showing one program: Study permit", clearHref: "/sheet/reports?tab=outcomes" },
        }),
      }),
    );
    expect(html).not.toContain("IRCC’s estimate, checked (not");
    expect(html).toContain(NO_ESTIMATE_NOTE);
    expect(html).toContain("Showing one program: Study permit. ");
    expect(html).toContain("Show all programs");
  });

  it("never words a figure as a chance of success, a rate or a ranking of staff", () => {
    const FORBIDDEN = /\b(success|approval|acceptance|refusal|win) rates?\b|chances? of (approval|success)|likelihood|probabilit|\bodds\b|predict|leaderboard|top performer|\brank(s|ed|ing)?\b/i;
    const NEGATED = /aren’t|aren't|nobody|never|\bnot\b|\bno\b|isn’t/i;
    const files = [
      "src/modules/sheet/reports-outcomes.ts",
      "src/modules/sheet/reports-outcomes-load.ts",
      "src/modules/sheet/reports-present.ts",
      "src/modules/sheet/reports-load.ts",
      "src/modules/sheet/reports-export.ts",
      "src/components/sheet/designer/reports.tsx",
      "src/app/api/reports/export/route.ts",
    ];
    for (const file of files) {
      for (const line of readFileSync(file, "utf8").split("\n")) {
        if (FORBIDDEN.test(line)) expect({ file, line, negated: NEGATED.test(line) }).toMatchObject({ negated: true });
      }
    }
    const csv = reportCsv({ title: "t", meta: [], sections: reportSections("outcomes", { outcomes }) });
    expect(csv).not.toMatch(FORBIDDEN);
    expect(csv).not.toMatch(/%/);
  });
});

describe("REP-03 export stamp", () => {
  const meta = (tab: "ops" | "money" | "outcomes", segment: string | null = null) =>
    exportMeta({
      tab,
      period: "Last 90 days (28 Jul – 25 Oct 2026)",
      segment,
      scope: "All offices",
      generated: exportStamp(new Date("2026-10-25T18:02:00Z"), TZ),
      currency: "CAD",
      madeBy: "Synthetic Owner",
      role: "Firm owner",
      reference: "00000000-0000-0000-0000-000000000001",
      capped: true,
      sampleMode: false,
    });

  it("records the report, filters, segment, generated time with year and zone, currency and who generated it", () => {
    expect(exportStamp(new Date("2026-10-25T18:02:00Z"), TZ)).toBe("25 Oct 2026, 14:02 (America/Toronto)");
    expect(Object.fromEntries(meta("money"))).toMatchObject({
      Report: "Money",
      Period: "Last 90 days (28 Jul – 25 Oct 2026)",
      Filters: "all offices, all owners",
      Generated: "25 Oct 2026, 14:02 (America/Toronto)",
      Currency: "CAD",
      "Generated by": "Synthetic Owner (Firm owner)",
      "Who can see this report": "Firm owner and finance staff",
      Note: "Some sources passed the read limit, so these figures are partial.",
    });
    expect(meta("money").some(([key]) => key === "Segment")).toBe(false);
    expect(Object.fromEntries(meta("outcomes", "Study permit"))).toMatchObject({ Segment: "Program: Study permit", Currency: "CAD (this report has no money figures)" });
    expect(Object.fromEntries(meta("outcomes"))).toMatchObject({ Segment: "All programs, by program and quarter submitted" });
  });

  it("puts the stamp first in the CSV and on every PDF page, with IRCC's estimate in its own table", async () => {
    const records = decided("a", "study_permit", "2026-02-10T15:00:00Z", [30, 40, 50, 60, 90], ["approved"]);
    const estimates = programEstimates([estimate({ matter_id: "a0" })], new Map(records.map((record) => [record.matterId, record.program])));
    const result = outcomeSegments(records, { timeZone: TZ, estimates });
    const sections = reportSections("outcomes", {
      outcomes: { rows: result.rows, note: "n", definition: OUTCOMES_DEFINITION, detail: true, firm: { rows: result.firm, definition: "f" } },
    });
    expect(sections.map((section) => section.title)).toEqual([
      "Government processing, decided files only",
      "IRCC’s estimate, checked (not the firm’s figure)",
      "Firm work time, opened to submitted",
    ]);
    expect(sections[0].head).not.toContain("IRCC’s estimate");
    expect(sections[1].rows[0][2]).toMatch(/^https:\/\/www\.canada\.ca\/.*check-processing-times\.html \(canada\.ca, checked 20 Oct 2026/);

    const file = { title: "Processing and outcomes report, Synthetic Firm", meta: meta("outcomes", "Study permit"), sections, footer: "Processing and outcomes report, generated 25 Oct 2026, 14:02 (America/Toronto) by Synthetic Owner" };
    const csv = reportCsv(file);
    const lines = csv.slice(1).split("\r\n");
    expect(lines[1]).toBe('"Report","Processing and outcomes"');
    expect(lines.slice(1, 10).join("\n")).toMatch(/"Segment","Program: Study permit"[\s\S]*"Generated","25 Oct 2026, 14:02 \(America\/Toronto\)"[\s\S]*"Generated by","Synthetic Owner \(Firm owner\)"/);

    const pdf = await reportPdf(file);
    const text = pdfText(pdf);
    expect(text).toContain("Generated: 25 Oct 2026, 14:02 (America/Toronto)");
    expect(text).toContain("Segment: Program: Study permit");
    expect(text).toContain("Generated by: Synthetic Owner (Firm owner)");
    expect(text).toMatch(/by Synthetic Owner - page 1 of \d+/);
  });
});
