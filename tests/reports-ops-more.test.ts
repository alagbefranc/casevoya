import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SheetReports, type ReportsData, type ReportsOps } from "@/components/sheet/designer/reports";
import { SheetDocuments } from "@/components/sheet/designer/documents";
import { filterHidden } from "@/modules/sheet/home-controls";
import { presetChipLabel } from "@/modules/sheet/filter-preset";
import { reportSections } from "@/modules/sheet/reports-export";
import {
  MORE_DEFINITIONS,
  REPORT_LINKS,
  WAITING_LABEL,
  intakeCompletion,
  opsMoreSections,
  overdueNote,
  overdueTasks,
  readiness,
  renewalWorkload,
  requestBars,
  requestWaiting,
  stageHref,
} from "@/modules/sheet/reports-ops-more";
import { outstandingDocuments, receivablesAgeing, workload } from "@/modules/sheet/reports-present";
import { isOverdue } from "@/modules/sheet/tasks-present";

const TODAY = "2026-10-25";
const NOW = new Date("2026-10-25T16:00:00Z");

describe("REP-01 overdue tasks", () => {
  const tasks = [
    { matterId: "m1", dueOn: "2026-10-20", dueAt: null, status: "open" },
    { matterId: "m1", dueOn: "2026-10-25", dueAt: null, status: "open" },
    { matterId: null, dueOn: null, dueAt: "2026-10-25T15:00:00Z", status: "blocked" },
    { matterId: "m2", dueOn: null, dueAt: "2026-10-25T18:00:00Z", status: "open" },
    { matterId: "m2", dueOn: null, dueAt: null, status: "open" },
    { matterId: "s1", dueOn: "2026-10-01", dueAt: null, status: "open" },
    { matterId: "m1", dueOn: "2026-10-01", dueAt: null, status: "done" },
  ];

  it("counts overdue open work by the Tasks page's rule, sample matters apart", () => {
    const result = overdueTasks(tasks, TODAY, NOW, new Set(["s1"]));
    expect(result).toEqual({ open: 5, overdue: 2, sample: 1 });
    expect(overdueNote(result)).toBe("2 of 5 open internal tasks are overdue. 1 more on sample matters is on the Tasks page but not counted here.");
    expect(overdueNote({ open: 0, overdue: 0, sample: 0 })).toBe("No open internal tasks.");
  });

  it("matches the Tasks page's Overdue chip (the card equals the list)", () => {
    // The Tasks page flags each open or blocked internal row with isOverdue and the Overdue chip
    // shows the rows carrying that flag (filterHidden). The card is the same rows.
    const open = tasks.filter((task) => task.status === "open" || task.status === "blocked");
    const flagged = open.map((task) => ({ text: "", flags: isOverdue(task.dueOn, task.dueAt, TODAY, NOW) ? "overdue" : "" }));
    const shown = filterHidden(flagged, "", "overdue").shown;
    const card = overdueTasks(tasks, TODAY, NOW);
    expect(card.overdue).toBe(shown);
    // With sample matters left out, the card plus the counted-apart sample rows is the list.
    const apart = overdueTasks(tasks, TODAY, NOW, new Set(["s1"]));
    expect(apart.overdue + apart.sample).toBe(shown);
    expect(REPORT_LINKS.overdue.href).toBe("/sheet/tasks?f=overdue");
  });

  it("turns on the chip a link names, and nothing for an unknown token", () => {
    const tokens = { Mine: "mine", Overdue: "overdue", Blocked: "blocked" };
    expect(presetChipLabel(tokens, ["All", "Mine", "Overdue", "Blocked"], "overdue")).toBe("Overdue");
    expect(presetChipLabel(tokens, ["All", "Mine"], "overdue")).toBeNull();
    expect(presetChipLabel(tokens, ["All", "Mine"], null)).toBeNull();
  });

  it("workload's overdue column uses the same rule when given now", () => {
    const rows = workload(
      [{ id: "a", name: "Ari Kim" }],
      [
        { ownerMembershipId: "a", matterId: null, dueOn: null, dueAt: "2026-10-25T15:00:00Z", status: "open" },
        { ownerMembershipId: "a", matterId: null, dueOn: "2026-10-24", dueAt: null, status: "open" },
      ],
      [],
      TODAY,
      NOW,
    );
    expect(rows).toEqual([{ person: "Ari Kim", open: 2, overdue: 2, matters: 0 }]);
  });
});

describe("REP-01 outstanding documents", () => {
  const inputs = [
    { status: "open", expiresOn: null, reviewState: null, hasDocument: false },
    { status: "open", expiresOn: null, reviewState: "pending", hasDocument: true },
    { status: "open", expiresOn: null, reviewState: "rejected", hasDocument: true },
    { status: "open", expiresOn: "2026-10-01", reviewState: "pending", hasDocument: true },
    { status: "open", expiresOn: null, reviewState: "accepted", hasDocument: true },
    { status: "fulfilled", expiresOn: null, reviewState: "accepted", hasDocument: true },
  ];

  it("classifies each request as the report's bars do, so the requests list and the card agree", () => {
    const waiting = inputs.map((row) => requestWaiting(row, TODAY));
    expect(waiting).toEqual(["missing", "review", "changes", "expired", "missing", null]);
    const listed = waiting.filter((value): value is NonNullable<typeof value> => value !== null).map((value) => ({ waiting: value }));
    expect(requestBars(listed)).toEqual(outstandingDocuments(inputs, TODAY));
    // The card's total is the list's length.
    expect(requestBars(listed).reduce((sum, bar) => sum + bar.count, 0)).toBe(listed.length);
    expect(REPORT_LINKS.documents.href).toBe("/sheet/documents?tab=all&view=requests");
  });

  it("renders the requests list with the report's words and an honest empty state", () => {
    const html = renderToStaticMarkup(
      createElement(SheetDocuments, {
        data: {
          tab: "all",
          pills: ["0 to review", "0 quarantined"],
          firmName: "Maple",
          all: {
            cards: [{ title: "Passport", thumb: { icon: "file" }, meta: { parts: ["NL-1", "Ana"] }, states: [{ tone: "chg", label: WAITING_LABEL.missing }] }],
            filter: { text: "Showing 1 open document request, the rows the Reports page counts.", clear: "/sheet/documents?tab=all" },
          },
        },
      }),
    );
    expect(html).toContain("Showing 1 open document request");
    expect(html).toContain("Requested, not uploaded");
    expect(html).toContain('href="/sheet/documents?tab=all"');
    const empty = renderToStaticMarkup(
      createElement(SheetDocuments, { data: { tab: "all", pills: [], firmName: "Maple", all: { cards: [], filter: { text: "Showing 0 open document requests.", clear: "/sheet/documents?tab=all" } } } }),
    );
    expect(empty).toContain("No open requests");
  });
});

describe("REP-01 intake, readiness and renewals", () => {
  it("counts intake forms sent, completed and waiting", () => {
    const result = intakeCompletion(
      [
        { submitted: true, dueOn: "2026-10-01" },
        { submitted: false, dueOn: "2026-10-01" },
        { submitted: false, dueOn: "2026-11-01" },
        { submitted: false, dueOn: null },
      ],
      TODAY,
    );
    expect(result.bars.map((bar) => bar.count)).toEqual([4, 1, 3, 1]);
    expect(result.note).toBe("1 of 4 intake forms sent in this period is completed (25%).");
    expect(intakeCompletion([], TODAY).note).toBe("No intake form was sent in this period.");
  });

  it("measures opening to Ready to submit, and says plainly when it isn't recorded", () => {
    const result = readiness(
      [
        { createdAt: "2026-09-01T12:00:00Z", readyAt: "2026-09-11T12:00:00Z" },
        { createdAt: "2026-08-01T12:00:00Z", readyAt: "2026-10-01T12:00:00Z" },
        { createdAt: "2026-10-01T12:00:00Z", readyAt: "2026-10-21T12:00:00Z" },
      ],
      2,
    );
    expect(result).toMatchObject({ matters: 3, median: "20", longest: "61", recorded: true });
    expect(result.note).toBe("3 matters reached Ready to submit in this period. 2 matters are past Ready to submit with no recorded move into it, so they aren’t counted.");
    const missing = readiness([], 1);
    expect(missing).toMatchObject({ matters: 0, median: "—", recorded: false });
    expect(missing.note).toMatch(/^Not recorded: /);
    expect(readiness([], 0).note).toBe("No matter reached Ready to submit in this period.");
  });

  it("buckets open renewal reviews by expiry and leaves cancelled or finished ones out", () => {
    const result = renewalWorkload(
      [
        { expiresOn: "2026-10-01", remindOn: "2026-09-01", taskOpen: true, cancelled: false },
        { expiresOn: "2026-11-10", remindOn: "2026-10-20", taskOpen: true, cancelled: false },
        { expiresOn: "2027-01-10", remindOn: "2026-11-10", taskOpen: true, cancelled: false },
        { expiresOn: "2027-03-10", remindOn: "2027-01-10", taskOpen: true, cancelled: false },
        { expiresOn: "2028-01-10", remindOn: "2027-10-10", taskOpen: true, cancelled: false },
        { expiresOn: "2026-11-10", remindOn: "2026-10-20", taskOpen: false, cancelled: false },
        { expiresOn: "2026-11-10", remindOn: "2026-10-20", taskOpen: true, cancelled: true },
      ],
      TODAY,
    );
    expect(result.bars.map((bar) => bar.count)).toEqual([1, 1, 1, 1, 1]);
    expect(result.note).toBe("5 renewal reviews are open; 2 have reached their reminder date.");
    expect(renewalWorkload([], TODAY).note).toBe("No open renewal reviews.");
  });
});

describe("REP-01 receivables ageing", () => {
  it("ages open invoices 1–30, 31–60, 61–90 and over 90 days past due", () => {
    const base = { currency: "CAD", paidCents: 0, creditedCents: 0, issuedOn: "2026-01-01", status: "issued" };
    const buckets = receivablesAgeing(
      [
        { ...base, amountCents: 100, dueOn: "2026-10-30" },
        { ...base, amountCents: 200, dueOn: "2026-10-10" },
        { ...base, amountCents: 300, dueOn: "2026-09-10" },
        { ...base, amountCents: 400, dueOn: "2026-08-10" },
        { ...base, amountCents: 500, dueOn: "2026-06-10" },
      ],
      TODAY,
    );
    expect(buckets.map((bucket) => [bucket.age, bucket.invoices, bucket.cents])).toEqual([
      ["Not due", 1, 100],
      ["1–30 days overdue", 1, 200],
      ["31–60 days", 1, 300],
      ["61–90 days", 1, 400],
      ["Over 90 days", 1, 500],
    ]);
  });
});

describe("REP-01 report page and export", () => {
  const more = {
    overdue: { open: 5, overdue: 2, sample: 0, note: "2 of 5 open internal tasks are overdue.", definition: MORE_DEFINITIONS.overdue },
    intake: { ...intakeCompletion([{ submitted: true, dueOn: null }], TODAY), definition: MORE_DEFINITIONS.intake },
    readiness: { ...readiness([], 0), definition: MORE_DEFINITIONS.readiness },
    renewals: { ...renewalWorkload([], TODAY), definition: MORE_DEFINITIONS.renewals },
    links: { overdue: REPORT_LINKS.overdue, intake: REPORT_LINKS.intake, readiness: REPORT_LINKS.readiness, renewals: REPORT_LINKS.renewals },
  };
  const ops: ReportsOps = {
    leads: { bars: [], note: "n", link: REPORT_LINKS.leads },
    ageing: { rows: [{ stage: "Intake", matters: 1, median: "2", oldest: "2", href: stageHref("intake") }], link: REPORT_LINKS.ageing },
    workload: { rows: [], link: REPORT_LINKS.workload },
    documents: { bars: [], link: REPORT_LINKS.documents },
    attendance: { booked: 3, attended: 1, rescheduled: 0, noShow: 1, cancelled: 1, link: REPORT_LINKS.attendance },
    more,
  };
  const data: ReportsData = {
    tab: "ops",
    range: "90d",
    pills: ["a", "b"],
    ops,
    dialog: { filters: ["a", "b", "c"], timezone: "America/Toronto", currency: "CAD", note: "", toastSub: "" },
  };

  it("shows every added card with its figure, empty state and link to the filtered list", () => {
    const html = renderToStaticMarkup(createElement(SheetReports, { data }));
    for (const title of ["Intake completion", "Time to internal readiness", "Overdue tasks", "Renewal workload"]) expect(html).toContain(`</svg>${title}</h2>`);
    expect(html).toContain("2 overdue ");
    expect(html).toContain(" 5 open internal tasks");
    expect(html).toContain(" 1 cancelled");
    expect(html).toContain("No matter reached Ready to submit in this period.");
    expect(html).toContain('href="/sheet/tasks?f=overdue"');
    expect(html).toContain('href="/sheet/documents?tab=all&amp;view=requests"');
    expect(html).toContain('href="/sheet/matters?stage=ready_to_submit"');
    expect(html).toContain('href="/sheet/tasks?q=Renewal%20review"');
    expect(html).toContain('data-href="/sheet/matters?stage=intake"');
  });

  it("exports the added cards with their definitions", () => {
    const titles = reportSections("ops", { ops }).map((section) => section.title);
    expect(titles).toEqual([
      "Lead conversion",
      "Stage ageing, open matters",
      "Workload",
      "Outstanding documents",
      "Consultation attendance",
      "Overdue tasks",
      "Intake completion",
      "Time to internal readiness",
      "Renewal workload",
    ]);
    const readinessSection = opsMoreSections(more).find((section) => section.title === "Time to internal readiness");
    expect(readinessSection?.rows).toEqual([]);
    expect(readinessSection?.definition).toBe(MORE_DEFINITIONS.readiness);
    expect(opsMoreSections(null)).toEqual([]);
  });
});
