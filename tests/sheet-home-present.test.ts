import { describe, expect, it } from "vitest";
import { gaugeArcs, percent } from "@/components/sheet/designer/home";
import { ago, dayMonth, greeting, localNow, monthGrid, summary, taskBadge, weekdayDay, zoneCity } from "@/modules/sheet/home-present";

describe("home presentation", () => {
  it("reads the date and hour in the firm's timezone", () => {
    // 2026-10-17 03:30 UTC is still 16 October in Toronto.
    const now = localNow("America/Toronto", new Date("2026-10-17T03:30:00Z"));
    expect(now).toMatchObject({ year: 2026, month: 10, day: 16, hour: 23, weekday: "Friday", monthName: "October" });
  });

  it("greets by time of day and first name", () => {
    expect(greeting(9, "Amara Osei")).toBe("Good morning, Amara.");
    expect(greeting(13, "Amara Osei")).toBe("Good afternoon, Amara.");
    expect(greeting(20, "")).toBe("Good evening.");
  });

  it("lays out October 2026 starting on a Thursday", () => {
    const grid = monthGrid(2026, 10, 16, new Set([20, 30]));
    expect(grid.month).toBe("October 2026");
    expect(grid.leading).toBe(3);
    expect(grid.days).toHaveLength(31);
    expect(grid.days[15]).toEqual({ day: 16, today: true });
    expect(grid.days[19]).toEqual({ day: 20, marked: true });
    expect(monthGrid(2027, 2, null, new Set()).days).toHaveLength(28);
  });

  it("formats dates and relative times like the Designer", () => {
    expect(dayMonth("2026-10-30")).toBe("30 Oct");
    expect(weekdayDay("2026-10-20")).toBe("Tue 20");
    expect(zoneCity("America/Toronto")).toBe("Toronto");
    expect(zoneCity("America/St_Johns")).toBe("St Johns");
    const now = new Date("2026-10-17T12:00:00Z");
    expect(ago("2026-10-17T11:52:00Z", now)).toBe("8 min");
    expect(ago("2026-10-17T11:00:00Z", now)).toBe("1 h");
    expect(ago("2026-10-14T12:00:00Z", now)).toBe("3 d");
  });

  it("labels open tasks by state and due date", () => {
    expect(taskBadge("blocked", "2026-10-20", "2026-10-17")).toEqual({ tone: "chg", label: "Blocked" });
    expect(taskBadge("open", "2026-10-16", "2026-10-17")).toEqual({ tone: "bad", label: "Overdue" });
    expect(taskBadge("open", "2026-10-17", "2026-10-17")).toEqual({ tone: "bad", label: "Today" });
    expect(taskBadge("open", "2026-10-20", "2026-10-17")).toEqual({ tone: "gr", label: "Tue 20" });
    expect(taskBadge("open", null, "2026-10-17")).toEqual({ tone: "gr", label: "No due date" });
  });

  it("only says what the records show", () => {
    const now = localNow("America/Toronto", new Date("2026-10-16T14:00:00Z"));
    expect(summary(now, "Toronto", 0, 0)).toBe("Friday 16 October, Toronto. Nothing is waiting for your review.");
    expect(summary(now, "Toronto", 2, 1)).toBe("Friday 16 October, Toronto. 2 documents are waiting for review, and one deadline needs confirming.");
    expect(summary(now, "Toronto", 1, 0)).toBe("Friday 16 October, Toronto. One document is waiting for review.");
  });

  it("draws the gauge from real counts, and an empty track with none", () => {
    const arcs = gaugeArcs([
      { label: "a", count: 96, color: "#1" },
      { label: "b", count: 23, color: "#2" },
      { label: "c", count: 11, color: "#3" },
    ]);
    expect(arcs[0].dash).toBe("181.59562753515087 251.32741228718345");
    expect(arcs[1].offset).toBe("-185.59562753515087");
    const empty = gaugeArcs([
      { label: "a", count: 0, color: "#1" },
      { label: "b", count: 0, color: "#2" },
      { label: "c", count: 0, color: "#3" },
    ]);
    expect(empty.map((arc) => arc.dash.split(" ")[0])).toEqual(["0", "0", "247.32741228718345"]);
    expect(percent(0, 0)).toBe("0%");
    expect(percent(23, 130)).toBe("18%");
  });
});
