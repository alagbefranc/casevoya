import { describe, expect, it } from "vitest";
import {
  clientState,
  dayLabel,
  deadlineSource,
  deadlineState,
  deadlineTime,
  dependsOnLabel,
  dueLabel,
  firstName,
  internalState,
  isOverdue,
  priorityChip,
  reminderOffsets,
  tasksTab,
  zoneAbbr,
} from "@/modules/sheet/tasks-present";

describe("Tasks page words", () => {
  it("picks a known tab and falls back to Internal", () => {
    expect(tasksTab(undefined)).toBe("internal");
    expect(tasksTab("client")).toBe("client");
    expect(tasksTab("deadlines")).toBe("deadlines");
    expect(tasksTab("bogus")).toBe("internal");
  });

  it("names priority and state the way the Designer does, without inventing progress", () => {
    expect(priorityChip("critical")).toEqual({ tone: "bad", label: "Critical" });
    expect(priorityChip("high")).toEqual({ tone: "chg", label: "High" });
    expect(priorityChip("normal")).toEqual({ tone: "gr", label: "Normal" });
    expect(internalState("open", null)).toBe("Open");
    expect(internalState("open", "2026-10-17T12:00:00Z")).toEqual({ tone: "bad", label: "Escalated" });
    expect(internalState("blocked", null)).toEqual({ tone: "gr", label: "Blocked" });
    expect(clientState("open")).toEqual({ tone: "rev", label: "Requested" });
    expect(clientState("done")).toEqual({ tone: "ok", label: "Done" });
    expect(deadlineState("confirmed")).toEqual({ tone: "ok", label: "Verified" });
    expect(deadlineState("tentative")).toEqual({ tone: "chg", label: "Tentative, confirm" });
  });

  it("writes due dates in the firm's words and zone", () => {
    expect(dayLabel("2026-10-19", "2026-10-18")).toBe("Mon 19 Oct");
    expect(dayLabel("2026-10-18", "2026-10-18")).toBe("Today");
    expect(dueLabel(null, null, "America/Toronto", "2026-10-18")).toBe("—");
    expect(dueLabel("2026-10-20", null, "America/Toronto", "2026-10-18")).toBe("Tue 20 Oct");
    expect(dueLabel(null, "2026-10-18T16:00:00Z", "America/Toronto", "2026-10-18")).toBe("Today 12:00 ET");
    expect(zoneAbbr("UTC")).toBe("UTC");
    expect(isOverdue("2026-10-17", null, "2026-10-18", new Date("2026-10-18T12:00:00Z"))).toBe(true);
    expect(isOverdue("2026-10-18", null, "2026-10-18", new Date("2026-10-18T12:00:00Z"))).toBe(false);
    expect(isOverdue(null, "2026-10-18T11:00:00Z", "2026-10-18", new Date("2026-10-18T12:00:00Z"))).toBe(true);
  });

  it("describes dependencies, reminders and deadline sources from the records only", () => {
    expect(dependsOnLabel([])).toBe("—");
    expect(dependsOnLabel([{ title: "Agreement signed", done: true }, { title: "Police certificate accepted", done: false }])).toBe(
      "Agreement signed ✓, Police certificate accepted",
    );
    expect(reminderOffsets([1, 7, null, 3, 7, 14])).toEqual([14, 7, 3, 1]);
    expect(deadlineSource({ sourceUrl: "https://www.canada.ca/en/x", retrievedOn: "2026-10-12", receiptOn: null, ruleVersion: false })).toBe(
      "canada.ca, retrieved 12 Oct",
    );
    expect(deadlineSource({ sourceUrl: null, retrievedOn: null, receiptOn: "2026-10-12", ruleVersion: false })).toBe("Letter received 12 Oct");
    expect(deadlineSource({ sourceUrl: null, retrievedOn: null, receiptOn: null, ruleVersion: false })).toBe("—");
    expect(deadlineTime({ dueOn: "2026-11-02", dueAt: null, timezone: "UTC" }, "America/Toronto", "2026-10-18")).toEqual({
      left: "Mon 2 Nov",
      right: "official time UTC",
    });
    expect(deadlineTime({ dueOn: "2026-10-30", dueAt: null, timezone: "America/Toronto" }, "America/Toronto", "2026-10-18").right).toBe("same zone");
    expect(firstName("Dana Lee")).toBe("Dana");
  });
});
