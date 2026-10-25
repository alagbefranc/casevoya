import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SheetSettingsSecurity } from "@/components/sheet/designer/settings";
import { durationLabel, monthLabel, parseServiceLevelReport, serviceLevelRows } from "@/modules/sheet/service-levels-present";
import { securityData } from "@/modules/sheet/settings-present";
import { parseArgs } from "../scripts/ops/service-levels.mjs";

// ADM-04: the service-level rows on Settings > Security, from public.service_level_report's jsonb.

const empty = (month: string) => ({ month, support: { received: 0, answered: 0, waiting: 0, median_seconds: null, longest_seconds: null } });

describe("Service-level report rows", () => {
  it("formats durations and months plainly", () => {
    expect(durationLabel(30)).toBe("under 1 min");
    expect(durationLabel(25 * 60)).toBe("25 min");
    expect(durationLabel(2 * 3600)).toBe("2 h");
    expect(durationLabel(2 * 3600 + 5 * 60)).toBe("2 h 5 min");
    expect(durationLabel(27 * 3600)).toBe("1 d 3 h");
    expect(monthLabel("2026-10")).toBe("October 2026");
  });

  it("shows uptime as not measured and no support figure when nothing is recorded", () => {
    const report = parseServiceLevelReport({ uptime: { measured: false }, months: ["2026-10", "2026-09", "2026-08"].map(empty) });
    const rows = serviceLevelRows(report);
    expect(rows.map((row) => row.title)).toEqual(["Uptime", "Support response time"]);
    expect(rows[0]).toEqual({
      title: "Uptime",
      detail: "Casevoya doesn’t monitor uptime yet. A figure appears once an external monitor checks the live site",
      badge: { tone: "gr", label: "Not measured yet" },
    });
    expect(rows[1].badge).toEqual({ tone: "gr", label: "None recorded" });
    expect(rows[1].detail).toBe(
      "Time from your request reaching Casevoya support to its first reply, by month in your timezone. Target: first response within 1 business day. No support requests from your firm are recorded in the last 3 months",
    );
    expect(JSON.stringify(rows)).not.toMatch(/\d+(\.\d+)?\s*%/);
  });

  it("shows median, longest, answered and waiting per month from real rows, newest first", () => {
    const report = parseServiceLevelReport({
      uptime: { measured: false },
      months: [
        { month: "2026-10", support: { received: 2, answered: 0, waiting: 2, median_seconds: null, longest_seconds: null } },
        { month: "2026-09", support: { received: 4, answered: 3, waiting: 1, median_seconds: 1800, longest_seconds: 3 * 3600 + 600 } },
        empty("2026-08"),
        { month: "2026-07", support: { received: 1, answered: 1, waiting: 0, median_seconds: 40, longest_seconds: 40 } },
      ],
    });
    const [, support] = serviceLevelRows(report);
    expect(support.detail).toBe(
      "Time from your request reaching Casevoya support to its first reply, by month in your timezone. Target: first response within 1 business day. " +
        "October 2026: 2 requests, none answered yet, 2 waiting · " +
        "September 2026: 4 requests, median 30 min, longest 3 h 10 min, 3 answered, 1 waiting · " +
        "July 2026: 1 request, median under 1 min, longest under 1 min, 1 answered",
    );
    // The badge is the latest month with an answer.
    expect(support.badge).toEqual({ tone: "gr", label: "Median 30 min" });

    const waitingOnly = serviceLevelRows(
      parseServiceLevelReport({ uptime: { measured: false }, months: [{ month: "2026-10", support: { received: 1, answered: 0, waiting: 1, median_seconds: null, longest_seconds: null } }] }),
    );
    expect(waitingOnly[1].badge).toEqual({ tone: "chg", label: "1 waiting" });
  });

  it("drops malformed input and shows nothing when the report couldn't be read", () => {
    expect(parseServiceLevelReport(null)).toBeNull();
    expect(parseServiceLevelReport({ months: "x" })).toBeNull();
    expect(serviceLevelRows(null)).toEqual([]);
    const report = parseServiceLevelReport({ uptime: { measured: "yes" }, months: [{ month: "Oct" }, { month: "2026-10", support: { received: -1, answered: 0, median_seconds: 50 } }] });
    expect(report).toEqual({ uptimeMeasured: false, months: [{ month: "2026-10", received: 0, answered: 0, waiting: 0, medianSeconds: null, longestSeconds: null }] });
  });

  it("adds the rows to the owner's Security tab after the Designer's rows, and the analytics row for everyone", () => {
    const rows = serviceLevelRows(parseServiceLevelReport({ uptime: { measured: false }, months: [empty("2026-10")] }));
    const owner = securityData({ owner: true, members: 1, security: null, events: null, timeZone: "America/Toronto", serviceLevels: rows });
    expect(owner.rows.slice(-3).map((row) => row.title)).toEqual(["Uptime", "Support response time", "Product analytics"]);
    const html = renderToStaticMarkup(createElement(SheetSettingsSecurity, { data: owner }));
    expect(html).toContain('<span class="bd gr"><i></i>Not measured yet</span>');

    const staff = securityData({ owner: false, members: 3, security: null, events: null, timeZone: "America/Toronto" });
    expect(staff.rows.map((row) => row.title)).not.toContain("Uptime");
    const analytics = staff.rows.at(-1);
    expect(analytics?.title).toBe("Product analytics");
    expect(analytics?.badge).toEqual({ tone: "gr", label: "None" });
    expect(analytics?.detail).toBe(
      "Casevoya runs no product analytics. If it ever does, it will use operational metadata only (actions, timings and counts, with pseudonymous ids), never immigration narratives, identity numbers, uploaded documents, message bodies, names, contact details or free text",
    );
  });
});

describe("scripts/ops/service-levels.mjs arguments", () => {
  const firm = "6f1c2a4e-1111-4222-8333-944455556666";
  const admin = "0a1b2c3d-1111-4222-8333-944455556666";

  it("reads record and report", () => {
    expect(parseArgs(["record", firm, "--ticket", " CS-1 ", "--received", "2026-10-25T14:05:00-04:00", "--recorded-by", admin])).toMatchObject({
      command: "record",
      ticket: "CS-1",
      responded: null,
      recordedBy: admin,
    });
    expect(parseArgs(["report", firm, "--months", "12"])).toMatchObject({ command: "report", months: 12 });
  });

  it("refuses missing or ambiguous input", () => {
    expect(() => parseArgs(["delete", firm])).toThrow(/Usage/);
    expect(() => parseArgs(["record", "acme"])).toThrow(/firm id/);
    expect(() => parseArgs(["record", firm, "--received", "2026-10-25T14:05:00-04:00", "--recorded-by", admin])).toThrow(/--ticket/);
    expect(() => parseArgs(["record", firm, "--ticket", "CS-1", "--received", "2026-10-25 14:05", "--recorded-by", admin])).toThrow(/UTC offset/);
    expect(() =>
      parseArgs(["record", firm, "--ticket", "CS-1", "--received", "2026-10-25T14:05:00Z", "--responded", "2026-10-25T13:00:00Z", "--recorded-by", admin]),
    ).toThrow(/before/);
    expect(() => parseArgs(["record", firm, "--ticket", "CS-1", "--received", "2026-10-25T14:05:00Z"])).toThrow(/--recorded-by/);
    expect(() => parseArgs(["report", firm, "--months", "30"])).toThrow(/1 to 24/);
  });
});
