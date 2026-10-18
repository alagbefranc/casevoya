import { describe, expect, it } from "vitest";
import {
  readUsage,
  retentionPage,
  retentionVersion,
  storageSize,
  subscriptionPage,
  subscriptionPill,
  subscriptionState,
} from "@/modules/sheet/settings-billing-present";
import { retentionSaveError, retentionStepUpLocation } from "@/modules/settings/retention";

const NOW = new Date("2026-10-18T15:00:00Z");
const ZONE = "America/Toronto";

describe("Settings > Subscription", () => {
  it("names the stored state, and treats a trial past its end as ended", () => {
    expect(subscriptionState(null, NOW)).toBeNull();
    expect(subscriptionState({ status: "trial", trial_started_at: null, trial_ends_at: "2026-10-30T00:00:00Z" }, NOW)).toBe("trial");
    expect(subscriptionState({ status: "trial", trial_started_at: null, trial_ends_at: "2026-10-01T00:00:00Z" }, NOW)).toBe("trial_ended");
    expect(subscriptionState({ status: "active", trial_started_at: null, trial_ends_at: null }, NOW)).toBe("active");
    expect(subscriptionState({ status: "unknown", trial_started_at: null, trial_ends_at: null }, NOW)).toBeNull();
    expect(subscriptionPill({ status: "cancelled", trial_started_at: null, trial_ends_at: null }, NOW)).toBe("Subscription: Cancelled");
    expect(subscriptionPill(null, NOW)).toBe("Subscription: not available");
  });

  it("formats stored bytes and reads the usage JSON defensively", () => {
    expect(storageSize(500)).toBe("1 KB");
    expect(storageSize(340 * 1024 * 1024)).toBe("340.0 MB");
    expect(storageSize(6.2 * 1024 ** 3)).toBe("6.2 GB");
    expect(readUsage(null)).toBeNull();
    expect(readUsage({ seats_active: 2 })).toBeNull();
    expect(readUsage({ seats_active: "3", seats_invited: -1, month_start: "2026-10-01" })).toMatchObject({ seats_active: 3, seats_invited: 0, storage_bytes: 0 });
  });

  it("shows no usage rows to roles without usage access, and says who sees them", () => {
    const data = subscriptionPage({ firmName: "Synthetic Firm", subscription: null, usage: null, timeZone: ZONE, now: NOW });
    expect(data.rows.map(([term]) => term)).toEqual(["Plan", "State", "Invoices from Casevoya", "If you cancel"]);
    expect(data.rows[1][1]).toBe("Not available");
    expect(data.note).toContain("shown to the firm owner and finance");
  });

  it("warns when the trial has ended, and never invents a price", () => {
    const data = subscriptionPage({
      firmName: "Synthetic Firm",
      subscription: { status: "trial_ended", trial_started_at: "2026-09-01T12:00:00Z", trial_ends_at: "2026-09-15T12:00:00Z" },
      usage: readUsage({ seats_active: 1, storage_bytes: 2 * 1024 ** 3, month_start: "2026-10-01" }),
      timeZone: ZONE,
      now: NOW,
    });
    expect(data.alert?.title).toBe("Your trial has ended");
    expect(data.rows).toContainEqual(["State", "Trial ended 15 Sep 2026"]);
    expect(data.rows).toContainEqual(["Storage", "2.0 GB of documents. No allowance is set."]);
    expect(JSON.stringify(data)).not.toMatch(/\$|CAD|\b(25|129|299|599)\b/);
  });
});

describe("Settings > Retention", () => {
  it("counts the version the way set_firm_retention_policy does", () => {
    expect(retentionVersion(null, null)).toBe(0);
    expect(retentionVersion({ unit: "years", count: 7 }, null)).toBe(1);
    expect(retentionVersion({ unit: "years", count: 7 }, 2)).toBe(3);
    expect(retentionVersion({ unit: "years", count: 7, version: 2 }, 2)).toBe(2);
  });

  it("shows the approved version, the date it applies from and the legal holds", () => {
    const data = retentionPage({
      policy: { unit: "years", count: 10, version: 2 },
      latest: { version: 2, periodCount: 10, source: "settings", approvedAt: "2026-10-02T14:00:00Z", approvedBy: "Synthetic Owner" },
      setup: null,
      holds: { count: 5, references: ["CV-2026-0001", "CV-2026-0002", "CV-2026-0003", "CV-2026-0004"] },
      organizationId: "org",
      canSave: false,
      timeZone: ZONE,
    });
    expect(data.rows).toEqual([
      ["Policy version", ["R-2", "approved by Synthetic Owner, 2 Oct 2026"]],
      ["Applies to", ["Matters closed after 2 Oct 2026"]],
      ["Legal holds", ["5 active", "CV-2026-0001, CV-2026-0002, CV-2026-0003 and 2 more"]],
    ]);
    expect(data.slider).toEqual({ value: 10, min: 1, max: 15 });
    expect(data.save).toBeNull();
    expect(data.alert?.title).toBe("Only the firm owner can change this");
  });

  it("widens the slider for a period above 15 years and makes no statutory claim", () => {
    const data = retentionPage({
      policy: { unit: "years", count: 25, version: 1 },
      latest: { version: 1, periodCount: 25, source: "settings", approvedAt: "2026-10-02T14:00:00Z", approvedBy: null },
      setup: null,
      holds: { count: 0, references: [] },
      organizationId: "org",
      canSave: true,
      timeZone: ZONE,
    });
    expect(data.slider.max).toBe(25);
    expect(data.save).toEqual({ organizationId: "org", version: 1 });
    expect(data.rows[0][1]).toEqual(["R-1", "approved, 2 Oct 2026"]);
    expect(`${data.intro} ${data.note}`).not.toMatch(/six|6 years|RCIC|statut|baseline/i);
  });

  it("turns the database's refusals into plain words and comes back to the tab after step-up", () => {
    expect(retentionSaveError("retention policy version conflict")).toMatch(/Reload/);
    expect(retentionSaveError("that is already the firm retention period")).toMatch(/already/);
    expect(retentionSaveError("firm owner step-up is required")).toBeNull();
    expect(retentionStepUpLocation()).toBe("/mfa?step=6&next=%2Fsheet%2Fsettings%3Ftab%3Dretention");
  });
});
