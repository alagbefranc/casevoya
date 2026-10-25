import { describe, expect, it } from "vitest";
import {
  DEFINITIONS,
  leadFunnel,
  median,
  monthLabel,
  monthsBetween,
  outstandingDocuments,
  rangeLabel,
  rangeStart,
  receivablesAgeing,
  stageAgeing,
  workload,
} from "@/modules/sheet/reports-present";
import { reportCsv, reportPdf, reportSections } from "@/modules/sheet/reports-export";
import { outcomeSegments, segmentsNote } from "@/modules/sheet/reports-outcomes";
import { dueBadge, orderQueue, queueItemId, ruleHours, waitingBadge, weekOf } from "@/modules/sheet/queue-present";
import { byteSize, exportError, exportState, jobSteps } from "@/modules/sheet/exports-present";
import { buildZip, crc32, readZip, safeZipPath } from "@/modules/exports/zip";
import { buildExportPackage, sha256Hex } from "@/modules/exports/package";
import { MATTER_STAGES } from "@/modules/sheet/present";
import { closurePanel } from "@/modules/sheet/closure-present";
import { closureError } from "@/modules/matters/closure";
import { MatterClosure } from "@/components/sheet/designer/matter";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

describe("Reports (REP-01..03)", () => {
  it("dates the period chips in the firm's own calendar", () => {
    expect(rangeStart("90d", "2026-10-16")).toBe("2026-07-19");
    expect(rangeStart("month", "2026-10-16")).toBe("2026-10-01");
    expect(rangeStart("year", "2026-10-16")).toBe("2026-01-01");
    expect(rangeLabel("2026-07-01", "2026-10-16")).toBe("1 Jul – 16 Oct 2026");
    expect(rangeLabel("2025-12-01", "2026-02-16")).toBe("1 Dec 2025 – 16 Feb 2026");
    expect(monthsBetween("2026-08-15", "2026-10-16")).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(monthLabel("2026-10", "2026-10-16")).toBe("October to date");
    expect(monthLabel("2025-12", "2026-01-16")).toBe("December 2025");
  });

  it("counts the consultation funnel without unpaid or expired holds", () => {
    const funnel = leadFunnel(
      [
        { id: "a", status: "completed", matterId: "m1" },
        { id: "b", status: "completed", matterId: null },
        { id: "c", status: "no_show", matterId: null },
        { id: "d", status: "held", matterId: null },
        { id: "e", status: "expired", matterId: null },
        { id: "f", status: "cancelled", matterId: "m2" },
      ],
      new Set(["b"]),
      new Set(["m1"]),
    );
    expect(funnel.bars.map((bar) => bar.count)).toEqual([4, 2, 2, 1]);
    expect(funnel.note).toBe("1 of 4 consultations led to an engaged matter (25%).");
    expect(funnel.attendance).toEqual({ booked: 4, attended: 2, rescheduled: 1, noShow: 1 });
  });

  it("ages open matters by days in their current stage, in stage order", () => {
    const rows = stageAgeing(
      [
        { id: "1", stage: "evidence_collection", createdAt: "2026-09-01T00:00:00Z", stageSince: "2026-10-01T00:00:00Z" },
        { id: "2", stage: "intake", createdAt: "2026-10-10T00:00:00Z", stageSince: null },
        { id: "3", stage: "evidence_collection", createdAt: "2026-09-01T00:00:00Z", stageSince: "2026-09-06T00:00:00Z" },
        { id: "4", stage: "closed", createdAt: "2026-01-01T00:00:00Z", stageSince: null },
      ],
      MATTER_STAGES,
      "2026-10-16T12:00:00Z",
    );
    expect(rows).toEqual([
      { stage: "Intake", matters: 1, median: "6", oldest: "6" },
      { stage: "Evidence collection", matters: 2, median: "15", oldest: "40" },
    ]);
    expect(median([1, 2, 3, 4])).toBe(2);
    expect(median([])).toBeNull();
  });

  it("measures workload for planning and outstanding documents by where they wait", () => {
    const rows = workload(
      [
        { id: "m1", name: "Dana Lee" },
        { id: "m2", name: "Ari Kim" },
      ],
      [
        { ownerMembershipId: "m1", matterId: "x", dueOn: "2026-10-01", status: "open" },
        { ownerMembershipId: "m1", matterId: "y", dueOn: null, status: "blocked" },
        { ownerMembershipId: "m2", matterId: "x", dueOn: "2026-10-30", status: "open" },
      ],
      [{ id: "z", consultantMembershipId: "m2" }],
      "2026-10-16",
    );
    expect(rows).toEqual([
      { person: "Ari Kim", open: 1, overdue: 0, matters: 2 },
      { person: "Dana Lee", open: 2, overdue: 1, matters: 2 },
    ]);
    const docs = outstandingDocuments(
      [
        { status: "open", expiresOn: null, reviewState: null, hasDocument: false },
        { status: "open", expiresOn: null, reviewState: "pending", hasDocument: true },
        { status: "open", expiresOn: null, reviewState: "rejected", hasDocument: true },
        { status: "open", expiresOn: "2026-10-01", reviewState: "pending", hasDocument: true },
        { status: "fulfilled", expiresOn: null, reviewState: "accepted", hasDocument: true },
      ],
      "2026-10-16",
    );
    expect(docs.map((bar) => bar.count)).toEqual([1, 1, 1, 1]);
  });

  it("ages open CAD receivables and leaves paid, draft and other-currency invoices out", () => {
    const base = { currency: "CAD", paidCents: 0, creditedCents: 0, issuedOn: "2026-09-01" };
    const buckets = receivablesAgeing(
      [
        { ...base, status: "issued", amountCents: 100000, dueOn: "2026-10-30" },
        { ...base, status: "partially_paid", amountCents: 100000, paidCents: 40000, dueOn: "2026-10-01" },
        { ...base, status: "issued", amountCents: 50000, dueOn: "2026-08-01" },
        { ...base, status: "paid", amountCents: 50000, dueOn: "2026-08-01" },
        { ...base, status: "draft", amountCents: 50000, dueOn: "2026-08-01" },
        { ...base, currency: "USD", status: "issued", amountCents: 50000, dueOn: "2026-08-01" },
      ],
      "2026-10-16",
    );
    expect(buckets.map((bucket) => [bucket.invoices, bucket.cents])).toEqual([
      [1, 100000],
      [1, 60000],
      [0, 0],
      [1, 50000],
      [0, 0],
    ]);
  });

  it("keeps pending files out of processing medians, hides small samples, and measures firm work time apart", () => {
    const decided = (n: number, days: number) =>
      Array.from({ length: n }, (_, index) => ({
        matterId: `m${index}`,
        program: "study_permit",
        createdAt: "2025-01-01T00:00:00Z",
        submittedAt: "2025-02-01T12:00:00Z",
        decidedAt: new Date(Date.parse("2025-02-01T12:00:00Z") + days * 86_400_000).toISOString(),
        outcome: "approved",
      }));
    const result = outcomeSegments(
      [
        ...decided(5, 60),
        { matterId: "p1", program: "study_permit", createdAt: "2025-01-01T00:00:00Z", submittedAt: "2025-03-01T12:00:00Z", decidedAt: null, outcome: null },
        { matterId: "n1", program: null, createdAt: "2026-01-01T00:00:00Z", submittedAt: "2026-02-01T12:00:00Z", decidedAt: "2026-03-01T12:00:00Z", outcome: "refused" },
        { matterId: "v1", program: "visitor", createdAt: "2026-01-01T00:00:00Z", submittedAt: null, decidedAt: null, outcome: null },
      ],
      { timeZone: "America/Toronto" },
    );
    expect(result.rows).toEqual([
      { program: "No program selected", cohort: "Submitted Jan–Mar 2026", decided: 1, median: "—", pending: 0, range: "— (1 timed)", outcomes: "—", estimate: null, programHref: null },
      { program: "Study permit", cohort: "Submitted Jan–Mar 2025", decided: 5, median: "60", pending: 1, range: "60–60 (5 timed)", outcomes: "5 approved", estimate: null, programHref: null },
    ]);
    expect(result.firm.find((row) => row.program === "Study permit")).toEqual({ program: "Study permit", cohort: "Submitted Jan–Mar 2025", files: 6, median: "31" });
    expect(segmentsNote(result.hidden, result.rows.length)).toMatch(/No program selected \(submitted jan–mar 2026\) has fewer than 5 decided files with a recorded decision date, so its median, range and outcome counts are hidden/);
    expect(DEFINITIONS.firm).toMatch(/not government processing/);
  });

  it("exports CSV with its filters first and neutralised formulas, and a PDF", async () => {
    const file = {
      title: "Operations report, Maple",
      meta: [
        ["Generated", "16 Oct, 09:00 America/Toronto"],
        ["Currency", "CAD"],
      ] as [string, string][],
      sections: reportSections("ops", {
        ops: {
          leads: { bars: [{ label: "=cmd()", count: 1, tone: "" }], note: "n", definition: "d" },
          ageing: { rows: [] },
          workload: { rows: [{ person: 'Dana "D" Lee', open: 1, overdue: 0, matters: 1 }] },
          documents: { bars: [] },
          attendance: { booked: 0, attended: 0, rescheduled: 0, noShow: 0 },
        },
      }),
    };
    const csv = reportCsv(file);
    expect(csv.startsWith('﻿"Operations report, Maple"\r\n"Generated","16 Oct, 09:00 America/Toronto"')).toBe(true);
    expect(csv).toContain(`"'=cmd()","1"`);
    expect(csv).toContain('"Dana ""D"" Lee"');
    const pdf = await reportPdf(file);
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe("%PDF-");
  });
});

describe("Team queue", () => {
  it("labels due dates and waiting money, and keeps ids stable", () => {
    expect(dueBadge("2026-10-15", "2026-10-16")).toEqual({ tone: "bad", label: "Overdue 1 day", overdue: true });
    expect(dueBadge("2026-10-16", "2026-10-16").label).toBe("Today");
    expect(dueBadge("2026-10-19", "2026-10-16")).toMatchObject({ tone: "rev", label: "Mon 19" });
    expect(dueBadge("2026-11-04", "2026-10-16")).toMatchObject({ tone: "gr", label: "4 Nov" });
    expect(dueBadge(null, "2026-10-16").label).toBe("No date");
    expect(waitingBadge("2026-10-12", "2026-10-16")).toEqual({ tone: "bad", label: "Waiting 4 days" });
    expect(queueItemId("task:1")).toBe(queueItemId("task:1"));
    expect(queueItemId("task:1")).not.toBe(queueItemId("task:2"));
    expect(queueItemId("task:1")).toMatch(/^rbl[0-9a-z]{7}$/);
    expect(weekOf("2026-10-18")).toEqual({ from: "2026-10-12", to: "2026-10-18" });
    expect(ruleHours("09:00:00", "12:30:00")).toBe(3.5);
  });

  it("puts the signed-in person's work first, then the soonest", () => {
    const item = (title: string, mine: boolean, sortOn: string | null) => ({ id: title, title, who: "", kind: "Task", owner: null, due: { tone: "gr" as const, label: "" }, mine, sortOn });
    expect(orderQueue([item("later", false, "2026-10-20"), item("mine", true, "2026-11-01"), item("sooner", false, "2026-10-10"), item("undated", false, null)]).map((row) => row.title)).toEqual([
      "mine",
      "sooner",
      "later",
      "undated",
    ]);
  });
});

describe("Matter closure checklist (T040)", () => {
  const check = {
    stage: "post_decision",
    outcome: "approved",
    blocked: true,
    legal_hold: false,
    retention_policy: { unit: "years", count: 7 },
    blockers: { client_funds_held_cents: 150000, client_funds_pending_cents: 0, unpaid_invoices: [{ number: "INV-0004", owed_cents: 40000, currency: "CAD" }] },
  };
  const money = (cents: number) => `CAD ${(cents / 100).toFixed(2)}`;

  it("checks money, tasks and outcome, and shows the firm's retention setting without a legal minimum", () => {
    const panel = closurePanel({ check, openTasks: 2, consultant: "Dana Lee", outcome: "Approved", closed: false, closure: null, holdSince: null, money });
    expect(panel.items.map((item) => [item.label, item.done, item.note])).toEqual([
      ["Outcome confirmed by consultant", true, "Approved"],
      ["Follow-up tasks done or handed off", false, "2 open"],
      ["Client account balance is zero", false, "CAD 1500.00 held"],
      ["Issued invoices paid or credited", false, "INV-0004: CAD 400.00 owed"],
    ]);
    expect(panel.status).toEqual({ tone: "chg", label: "Not ready", detail: "items still open" });
    expect(panel.retention).toContainEqual(["Policy", "Firm setting: 7 years after closure"]);
    expect(panel.retention).toContainEqual(["Legal minimum", "Not supplied by Casevoya. Needs professional review."]);
    expect(panel.retention).toContainEqual(["Records kept until", "Closure date + 7 years"]);
  });

  it("is ready when everything is settled, and shows the closure once closed", () => {
    const settled = { ...check, blocked: false, blockers: { client_funds_held_cents: 0, client_funds_pending_cents: 0, unpaid_invoices: [] } };
    expect(closurePanel({ check: settled, openTasks: 0, consultant: null, outcome: "Approved", closed: false, closure: null, holdSince: null, money }).status.label).toBe("Ready");
    const closed = closurePanel({
      check: { ...settled, stage: "closed", legal_hold: true },
      openTasks: 0,
      consultant: null,
      outcome: "Approved",
      closed: true,
      closure: { closedOn: "2026-10-18", retentionOn: "2033-10-18", years: 7, overridden: false },
      holdSince: "2026-10-18T10:00:00Z",
      money,
    });
    expect(closed.status).toEqual({ tone: "ok", label: "Closed", detail: "18 Oct 2026" });
    expect(closed.retention).toContainEqual(["Records kept until", "18 Oct 2033"]);
    expect(closed.retention).toContainEqual(["Legal hold", "Active since 18 Oct"]);
  });

  it("refuses in plain words", () => {
    expect(closureError("closure blocked: client funds are held")).toMatch(/only the firm owner can close with a reviewed reason/);
    expect(closureError("set the firm retention period before closing a matter")).toMatch(/retention period in Settings/);
    expect(closureError("matter closure denied")).toBe("Your role can’t close this matter.");
  });

  it("renders the Designer's checklist markup with real values", () => {
    const panel = closurePanel({ check, openTasks: 0, consultant: "Dana Lee", outcome: "Approved", closed: false, closure: null, holdSince: null, money });
    const html = renderToStaticMarkup(createElement(MatterClosure, { closed: false, retention: null, panel }));
    expect(html).toContain('<ul class="clist"><li><span class="ck on" role="checkbox" aria-checked="true" aria-readonly="true" aria-label="Outcome confirmed by consultant"></span>');
    expect(html).toContain('<h3>This matter is still open</h3>');
    expect(html).toContain('<div class="kv" style="margin-top:14px"><span>Policy</span><b>Firm setting: 7 years after closure</b>');
  });
});

describe("Client-file exports (T040)", () => {
  it("writes a ZIP whose entries read back byte for byte with their CRC", () => {
    const entries = [
      { path: "records/matter.json", bytes: new TextEncoder().encode('{"a":1}') },
      { path: "../../etc/passwd", bytes: new Uint8Array([1, 2, 3]) },
    ];
    const zip = buildZip(entries);
    const read = readZip(zip);
    expect(read.map((entry) => entry.path)).toEqual(["records/matter.json", "etc/passwd"]);
    expect([...read[1].bytes]).toEqual([1, 2, 3]);
    expect(read[0].crc).toBe(crc32(entries[0].bytes));
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    expect(safeZipPath("documents/a:b/..//c.pdf")).toBe("documents/a_b/c.pdf");
  });

  it("packages records and files with a manifest of SHA-256 hashes and provenance", async () => {
    const pdf = new TextEncoder().encode("%PDF-1.4 synthetic");
    const built = await buildExportPackage(
      { exportId: "e1", firm: "Maple Immigration", matterReference: "CA-2026-0001", matterTitle: "Study permit", generatedAt: "2026-10-18T12:00:00.000Z", generatedBy: "Dana Lee", timezone: "America/Toronto" },
      [{ path: "records/tasks.json", source: "public.tasks", rows: [{ id: "t1" }, { id: "t2" }] }],
      [{ path: "documents/passport/v1-passport.pdf", bytes: pdf, source: "public.document_versions", sourceId: "v1", storedSha256: await sha256Hex(pdf), mediaType: "application/pdf" }],
      [{ path: "documents/big/v1-big.pdf", source: "public.document_versions", sourceId: "v2", reason: "Not included: over this export's size limit." }],
    );
    const entries = readZip(built.zip);
    expect(entries.map((entry) => entry.path)).toEqual(["records/tasks.json", "documents/passport/v1-passport.pdf", "manifest.json", "manifest.pdf"]);
    const manifest = JSON.parse(new TextDecoder().decode(entries[2].bytes));
    expect(manifest.files[1]).toMatchObject({ path: "documents/passport/v1-passport.pdf", sha256: await sha256Hex(pdf), source_id: "v1", matches_stored: true });
    expect(manifest.excluded).toHaveLength(1);
    expect(built.manifestSha256).toBe(await sha256Hex(entries[2].bytes));
    expect(built.sha256).toBe(await sha256Hex(built.zip));
    expect(built.recordCount).toBe(2);
    expect(built.contents).toEqual({ "public.tasks": 2, documents: 1 });
  });

  it("describes jobs and refusals in plain words", () => {
    const now = new Date("2026-10-18T12:00:00Z");
    expect(exportState({ status: "ready", expiresAt: "2026-10-19T09:00:00Z", lastDownloadedOn: null, failureReason: null, expiresLabel: "19 Oct 05:00" }, now)).toEqual({
      tone: "ok",
      label: "Ready",
      detail: "link open until 19 Oct 05:00",
    });
    expect(exportState({ status: "ready", expiresAt: "2026-10-17T09:00:00Z", lastDownloadedOn: "17 Oct", failureReason: null, expiresLabel: null }, now)).toEqual({
      tone: "ok",
      label: "Downloaded 17 Oct",
      detail: "link expired",
    });
    expect(exportState({ status: "failed", expiresAt: null, lastDownloadedOn: null, failureReason: "The build did not finish in time.", expiresLabel: null }, now).tone).toBe("bad");
    expect(byteSize(43_200_000)).toBe("41.2 MB");
    expect(exportError("step-up is required")).toMatch(/authenticator/);
    expect(exportError("export access denied")).toBe("Your role can’t export this matter.");
    expect(jobSteps({ progress: 60, status: "building", files: null, started: "09:41", ready: null }).map((step) => step.state)).toEqual(["done", "done", "now", "todo"]);
    expect(jobSteps({ progress: 100, status: "ready", files: 12, started: "09:41", ready: "09:43" }).map((step) => step.state)).toEqual(["done", "done", "done", "done"]);
  });
});
