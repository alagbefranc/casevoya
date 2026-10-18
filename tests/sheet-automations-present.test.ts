import { describe, expect, it } from "vitest";
import { automationsData, dayList, quietHours, reminderDays, runRow } from "@/modules/sheet/automations-present";

const NOW = new Date("2026-10-18T15:00:00Z");
const ZONE = "America/Toronto";

describe("Automations page", () => {
  it("uses the firm's reminder days, else the proposed ones, and says which", () => {
    expect(reminderDays([3, 10], { days: [14, 7, 3, 1] })).toEqual({ days: [10, 3], firmSet: true });
    expect(reminderDays([], { days: [14, 7, 3, 1] })).toEqual({ days: [14, 7, 3, 1], firmSet: false });
    expect(dayList([1, 14, 3, 7])).toBe("14, 7, 3 and 1");
    expect(quietHours("21:00:00", "08:00:00")).toBe("21:00–08:00");
    expect(quietHours(null, "08:00:00")).toBeNull();
  });

  it("states the rule as it runs: no approval step it doesn't have, no editor, and quiet hours only when set", () => {
    const data = automationsData({ tab: "builder", days: [14, 7, 3, 1], firmSet: false, quiet: null, runs: [], now: NOW, timeZone: ZONE });
    expect(data.steps.map((step) => step.title)).toEqual(["When", "If", "Then", "Stop when"]);
    expect(data.steps[2].text).toBe("Email client reminders 14, 7, 3 and 1 days before (proposed days)");
    expect(data.actions).toBeNull();
    expect(data.pills).toEqual(["Active", "Not run yet"]);
    const quiet = automationsData({ tab: "builder", days: [7], firmSet: true, quiet: "21:00–08:00", runs: [], now: NOW, timeZone: ZONE });
    expect(quiet.steps.map((step) => step.title)).toContain("And");
  });

  it("words each reminder run by its state", () => {
    const base = { kind: "routine", offsetDays: 7, scheduledFor: "2026-10-20T13:00:00Z", sentAt: null, createdAt: "2026-10-18T14:00:00Z", matterName: "Ana Diaz", reference: "CA-2026-0001" };
    expect(runRow({ ...base, status: "pending" }, NOW, ZONE)).toEqual({
      title: { left: "Ana Diaz", right: "CA-2026-0001" },
      note: { left: "Reminder 7 days before", right: "scheduled for 20 Oct" },
      state: { tone: "rev", label: "Scheduled" },
      when: "10:00",
    });
    expect(runRow({ ...base, status: "sent", sentAt: "2026-10-17T13:00:00Z" }, NOW, ZONE)).toMatchObject({ state: { label: "Sent" }, when: "17 Oct 09:00" });
    expect(runRow({ ...base, status: "cancelled" }, NOW, ZONE).state.label).toBe("Stopped");
  });
});
