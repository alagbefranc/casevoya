import { describe, expect, it } from "vitest";
import { GO_LIVE_HREF, goLiveBanner, goLivePanel, goLiveRefusal, readGoLiveStatus } from "@/modules/sheet/go-live-present";

const raw = (over: Record<string, unknown> = {}) => ({
  live: false,
  live_at: null,
  sample_mode: false,
  ready: false,
  owner: true,
  items: [
    { key: "licence", done: true },
    { key: "subscription", done: false },
    { key: "policies", done: true },
    { key: "card_payments", done: false },
  ],
  ...over,
});
const allDone = [
  { key: "licence", done: true },
  { key: "subscription", done: true },
  { key: "policies", done: true },
  { key: "card_payments", done: true },
];
const ctx = { firmName: "Test Firm", timeZone: "America/Winnipeg" };

describe("go live presenter", () => {
  it("reads the status, and never trusts ready over the items", () => {
    expect(readGoLiveStatus(null)).toBeNull();
    const status = readGoLiveStatus(raw({ ready: true }))!;
    expect(status.ready).toBe(false);
    expect(status.items.map((item) => item.key)).toEqual(["licence", "subscription", "policies", "card_payments"]);
    expect(readGoLiveStatus({ live: false, items: [{ key: "licence", done: true }] })!.items.filter((item) => item.done)).toHaveLength(1);
  });

  it("lists what's left with a link to fix each step", () => {
    const panel = goLivePanel(readGoLiveStatus(raw())!, ctx);
    expect(panel.badge).toBe("Test mode");
    expect(panel.progress).toBe("2 of 4 done");
    const left = panel.items.filter((item) => !item.done);
    expect(left.map((item) => item.href)).toEqual(["/sheet/settings?tab=billing&dlg=plan", "/sheet/settings?tab=billing#card-payments"]);
    expect(panel.why).toContain("Still to do: a plan with a card on file; live card payments (stripe)");
    expect(panel.data.join(" ")).toMatch(/Nothing is deleted/);
  });

  it("words a ready firm for the owner and for everyone else", () => {
    expect(goLivePanel(readGoLiveStatus(raw({ ready: true, items: allDone }))!, ctx).why).toMatch(/^Everything is done/);
    expect(goLivePanel(readGoLiveStatus(raw({ ready: true, owner: false, items: allDone }))!, ctx).why).toBe("Ready: only the firm owner can switch the firm to live.");
  });

  it("shows when the firm went live", () => {
    const panel = goLivePanel(readGoLiveStatus(raw({ live: true, live_at: "2026-10-30T23:00:00Z", ready: true, items: allDone }))!, ctx);
    expect(panel.live).toBe(true);
    expect(panel.badge).toBe("Live since 30 Oct 2026");
    expect(panel.why).toMatch(/only puts the Test mode badge back/);
  });

  it("shows the banner only in test mode, linked for the owner and finance", () => {
    const status = readGoLiveStatus(raw())!;
    expect(goLiveBanner(readGoLiveStatus(raw({ live: true }))!, { firmName: "Test Firm", canManage: true })).toBeNull();
    const banner = goLiveBanner(status, { firmName: "Test Firm", canManage: true })!;
    expect(banner.title).toBe("Test mode: Test Firm isn’t live yet");
    expect(banner.link).toEqual({ href: GO_LIVE_HREF, label: "See what’s left" });
    expect(goLiveBanner(status, { firmName: "Test Firm", canManage: false })!.link).toBeNull();
    expect(goLiveBanner(readGoLiveStatus(raw({ ready: true, items: allDone }))!, { firmName: "T", canManage: true })!.link!.label).toBe("Go live");
  });

  it("words refusals", () => {
    expect(goLiveRefusal({ message: "recent step-up required" }).stepUp).toBe(true);
    expect(goLiveRefusal({ missing: ["policies"] }).error).toBe("Still to do: client portal terms and privacy notice.");
    expect(goLiveRefusal({ message: "confirm switching back to test mode" }).error).toMatch(/Tick the box/);
  });
});
