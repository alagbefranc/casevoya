import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SheetQueue } from "@/components/sheet/designer/queue";
import { matterMatches } from "@/modules/sheet/present";

const TODAY = "2026-10-23";
const matter = (over: Partial<Parameters<typeof matterMatches>[0]> = {}) => ({
  onHold: false,
  stage: "in_progress",
  nextDue: "2026-10-25",
  nextTaskDue: null,
  pendingReview: true,
  mine: true,
  title: "Study permit",
  reference: "ON-2026-0001",
  ...over,
});

describe("Boards: Due this week and Awaiting my review", () => {
  it("lists an open matter with work due or waiting, and never a closed one", () => {
    expect(matterMatches(matter(), "due", undefined, TODAY)).toBe(true);
    expect(matterMatches(matter(), "review", undefined, TODAY)).toBe(true);
    expect(matterMatches(matter({ stage: "closed" }), "due", undefined, TODAY)).toBe(false);
    expect(matterMatches(matter({ stage: "closed" }), "review", undefined, TODAY)).toBe(false);
    // The full list still shows closed matters.
    expect(matterMatches(matter({ stage: "closed" }), undefined, undefined, TODAY)).toBe(true);
  });
});

describe("Boards: Team queue", () => {
  const data = { counts: { open: 0, overdue: 0, people: 1 }, load: [], items: [] };

  it("says the queue couldn't load instead of 'Nothing is waiting' when a read failed", () => {
    const failed = renderToStaticMarkup(createElement(SheetQueue, { data: { ...data, failed: true } }));
    expect(failed).toContain("The queue couldn’t load");
    expect(failed).not.toContain("Nothing is waiting");
    expect(renderToStaticMarkup(createElement(SheetQueue, { data }))).toContain("Nothing is waiting");
  });
});
