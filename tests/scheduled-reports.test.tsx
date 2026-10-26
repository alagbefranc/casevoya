import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SheetReports, type ReportsData } from "@/components/sheet/designer/reports";
import { ScheduleReportDialog } from "@/components/sheet/designer/scheduled-reports";
import { notificationParts, readItems, SYSTEM_KINDS } from "@/modules/sheet/notifications-present";
import { readRunSummary, runScheduledReports } from "@/modules/sheet/scheduled-reports-runner";
import {
  everyLabel,
  lastRunLabel,
  readScheduleOverview,
  scheduleDialog,
  scheduleError,
  scheduleInputError,
  scheduleMoment,
  scheduledLive,
  scheduledRows,
  scheduledUnavailable,
} from "@/modules/sheet/scheduled-reports-present";

/** REP-03 scheduled reports: presentation, the Scheduled tab's live parts, the runner, and the link-only notification. */

const ORG = "11111111-1111-4111-8111-111111111111";
const ME = "22222222-2222-4222-8222-222222222222";
const LEFT = "33333333-3333-4333-8333-333333333333";

const RAW = {
  timezone: "America/Toronto",
  me: ME,
  tabs: ["ops", "outcomes", "bogus"],
  staff: [
    { user_id: ME, name: "Synthetic Manager", tabs: ["ops", "outcomes"] },
    { user_id: LEFT, name: "Synthetic Colleague", tabs: [] },
    { name: "no id" },
  ],
  schedules: [
    {
      id: "44444444-4444-4444-8444-444444444444",
      title: "Monday workload",
      tab: "ops",
      range: "90d",
      frequency: "weekly",
      weekday: 1,
      month_day: null,
      send_time: "08:00",
      paused: false,
      next_run_at: "2026-10-26T12:00:00Z",
      version: 2,
      can_edit: true,
      recipients: [
        { user_id: ME, name: "Synthetic Manager", can_see: true },
        { user_id: LEFT, name: "Synthetic Colleague", can_see: false },
      ],
      last_run: { at: "2026-10-19T12:00:00Z", kind: "scheduled", delivered: 1, skipped: 1 },
    },
    { id: "55555555-5555-4555-8555-555555555555", title: "Paused", tab: "outcomes", range: "year", frequency: "monthly", weekday: null, month_day: 1, send_time: "07:00", paused: true, next_run_at: null, version: 1, can_edit: false, recipients: [], last_run: null },
    { id: "x", tab: "money", range: "nope", frequency: "weekly" },
  ],
};

describe("REP-03 scheduled reports (presentation)", () => {
  const overview = readScheduleOverview(RAW);

  it("keeps only well-formed rows from the database", () => {
    expect(overview.tabs).toEqual(["ops", "outcomes"]);
    expect(overview.staff.map((person) => person.userId)).toEqual([ME, LEFT]);
    expect(overview.schedules.map((row) => row.title)).toEqual(["Monday workload", "Paused"]);
    expect(readScheduleOverview(null)).toEqual({ timezone: "America/Toronto", me: null, tabs: [], staff: [], schedules: [] });
  });

  it("fills the Designer's Scheduled columns: link only, next send on the firm's clock, skipped recipients named", () => {
    const rows = scheduledRows(overview);
    expect(rows[0]).toMatchObject({
      report: "Monday workload (Operations, last 90 days)",
      every: "Week, Mondays 08:00",
      recipients: "Synthetic Manager, Synthetic Colleague (no access now, skipped)",
      format: "Link only",
      next: "26 Oct 08:00",
    });
    expect(rows[1]).toMatchObject({ every: "Month, the 1st 07:00", next: "Paused", recipients: "No one" });
    expect(JSON.parse(rows[0].live!.form)).toMatchObject({ id: "44444444-4444-4444-8444-444444444444", version: 2, recipients: [ME, LEFT] });
    expect(everyLabel({ frequency: "monthly", weekday: null, monthDay: 22, sendTime: "09:15" })).toBe("Month, the 22nd 09:15");
    expect(scheduleMoment("2026-11-15T13:00:00Z", "America/Winnipeg")).toBe("15 Nov 07:00");
    expect(scheduleMoment("2026-11-02T13:00:00Z", "America/Winnipeg")).toBe("2 Nov 07:00");
    expect(lastRunLabel(overview.schedules[0], "America/Toronto")).toBe(
      "Monday workload: Sent 19 Oct 08:00 to 1 person; 1 skipped because they can no longer see this report.",
    );
  });

  it("renders the live Scheduled tab with actions only for schedules the person may change", () => {
    const live = scheduledLive(ORG, overview);
    const data = {
      tab: "scheduled",
      range: "90d",
      pills: ["1 Aug – 25 Oct 2026", "Matters you can see"],
      scheduled: { rows: scheduledRows(overview), live },
      freshness: null,
      dialog: { filters: ["Last 90 days", "all offices", "all owners"], timezone: "America/Toronto", currency: "CAD", note: "", toastSub: "" },
    } as unknown as ReportsData;
    const html = renderToStaticMarkup(createElement(SheetReports, { data }));
    expect(html).toContain('data-sched-act="new"');
    expect(html).toContain(`data-self="${ME}"`);
    expect(html.match(/data-sched-act="edit"/g)).toHaveLength(1);
    expect(html).toContain('data-sched-act="test"');
    expect(html).toContain("Run now (test)");
    expect(html).toContain("Made by a colleague");
    expect(html).toContain("No report, file or figures go in a message.");
    expect(html).toContain("1 skipped because they can no longer see this report");

    const empty = renderToStaticMarkup(createElement(SheetReports, { data: { ...data, scheduled: { rows: [], live } } as ReportsData }));
    expect(empty).toContain('class="emp"');
    expect(empty).toContain('data-sched-act="new"');
    const unavailable = renderToStaticMarkup(createElement(SheetReports, { data: { ...data, scheduled: { rows: [], live: scheduledUnavailable(ORG) } } as ReportsData }));
    expect(unavailable).toContain("couldn’t be read just now");
    expect(unavailable).not.toContain('data-sched-act="new"');
  });

  it("builds the schedule dialog from the Designer's dialog parts, listing staff with the tabs they see", () => {
    const html = renderToStaticMarkup(createElement(ScheduleReportDialog, { data: scheduleDialog(ORG, overview) }));
    expect(html).toContain('<dialog class="dlg" id="dlgSched"');
    expect(html).toContain('<option value="ops">Operations</option>');
    expect(html).not.toContain('value="money"');
    expect(html).toContain(`data-sched-person="ops outcomes"`);
    expect(html).toContain("In the firm’s timezone, America/Toronto.");
    expect(html).toContain("never the report itself");
  });

  it("checks the form and words the database's refusals plainly", () => {
    const ok = { title: "Weekly", tab: "ops", range: "90d", frequency: "weekly", weekday: 1, monthDay: null, sendTime: "08:00", recipients: [ME] };
    expect(scheduleInputError(ok)).toBeNull();
    expect(scheduleInputError({ ...ok, recipients: [] })).toBe("Choose at least one recipient.");
    expect(scheduleInputError({ ...ok, frequency: "monthly", monthDay: 30 })).toBe("Choose a day of the month from 1 to 28.");
    expect(scheduleInputError({ ...ok, sendTime: "25:00" })).toBe("Choose a time.");
    expect(scheduleInputError({ ...ok, tab: "scheduled" })).toBe("Choose a report.");
    expect(scheduleError("a recipient cannot see this report")).toMatch(/can’t see this report/);
    expect(scheduleError("a test was just sent; try again in a minute")).toBe("A test was just sent. Try again in a minute.");
    expect(scheduleError("something else")).toBeNull();
  });
});

describe("REP-03 scheduled reports runner (fake database)", () => {
  it("passes the limit and reads the summary", async () => {
    const calls: number[] = [];
    const summary = await runScheduledReports(async (limit) => {
      calls.push(limit);
      return { data: { schedules: 2, delivered: 3, skipped: 1 }, error: null };
    });
    expect(calls).toEqual([50]);
    expect(summary).toEqual({ schedules: 2, delivered: 3, skipped: 1 });
    expect(readRunSummary("nonsense")).toEqual({ schedules: 0, delivered: 0, skipped: 0 });
    await expect(runScheduledReports(async () => ({ data: null, error: { message: "boom" } }))).rejects.toThrow(/failed/);
  });
});

describe("REP-03 report notification (link only)", () => {
  it("is a system row whose sentence names the schedule and links to Reports", () => {
    const items = readItems([
      { id: "a", kind: "report", occurred_at: "2026-10-26T12:00:00Z", matter_id: null, actor_name: null, subject: "Monday workload", detail: "test", href: "/sheet/reports?tab=ops&view=90d", read: false },
      { id: "b", kind: "report", occurred_at: "2026-10-26T12:00:00Z", matter_id: null, actor_name: null, subject: "X", detail: "scheduled", href: "https://elsewhere.example/r.csv", read: false },
    ]);
    expect(items.map((item) => item.id)).toEqual(["a"]);
    expect(SYSTEM_KINDS.has("report")).toBe(true);
    expect(notificationParts(items[0], () => "")).toEqual(["Test of scheduled report ", { b: "Monday workload" }, " is ready to open in Reports"]);
  });
});
