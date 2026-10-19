import { describe, expect, it } from "vitest";
import {
  planTotalText,
  readFirmSubscription,
  readUsage,
  retentionPage,
  retentionVersion,
  storageSize,
  subscriptionPage,
  subscriptionPill,
  subscriptionState,
} from "@/modules/sheet/settings-billing-present";
import { retentionSaveError, retentionStepUpLocation } from "@/modules/settings/retention";
import { readCatalog } from "@/modules/subscription/catalog";
import { entitlementError, subscriptionActionError, subscriptionStepUpLocation } from "@/modules/subscription/errors";
import { teamSummary } from "@/modules/sheet/settings-present";
import { blockerStep, inviteBlockers } from "@/modules/sheet/setup-present";

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

  it("warns when the trial has ended, and never invents a price without the catalog", () => {
    const data = subscriptionPage({
      firmName: "Synthetic Firm",
      subscription: { status: "trial_ended", trial_started_at: "2026-09-01T12:00:00Z", trial_ends_at: "2026-09-15T12:00:00Z" },
      usage: readUsage({ seats_active: 1, storage_bytes: 2 * 1024 ** 3, month_start: "2026-10-01" }),
      timeZone: ZONE,
      now: NOW,
    });
    expect(data.alert?.title).toBe("Your trial has ended");
    expect(data.rows).toContainEqual(["State", "Trial ended 15 Sep 2026. Choose a plan to carry on."]);
    expect(data.rows).toContainEqual(["Storage", "2.0 GB of documents. No allowance is set."]);
    expect(data.rows).toContainEqual(["Plan", "None chosen yet."]);
    expect(data.buttons).toEqual([]);
    expect(JSON.stringify(data)).not.toMatch(/\$|CAD|\b(25|129|299|599)\b/);
  });

  const CATALOG = {
    currency: "CAD",
    annual_months: 10,
    extra_seat_monthly_cents: 2500,
    solo: { monthly_cents: 12900, seats: 2, matters: 100, storage_gb: 25 },
    practice: { monthly_cents: 29900, seats: 6, matters: 500, storage_gb: 100 },
    firm: { monthly_cents: 59900, seats: 15, matters: 1500, storage_gb: 250 },
  };

  function detail(overrides: { subscription?: Record<string, unknown>; entitlements?: Record<string, unknown>; catalog?: unknown; invoices?: unknown[] } = {}) {
    return readFirmSubscription({
      subscription: {
        status: "active", plan: "solo", billing_interval: "year", extra_seats: 0, trial_started_at: null, trial_ends_at: null, current_period_end: "2027-10-01T12:00:00Z",
        cancel_at: null, cancelled_at: null, past_due_since: null, restricted_at: null, archived_at: null, latest_invoice_status: "paid", latest_invoice_url: null,
        has_billing_account: true, has_stripe_subscription: true, ...overrides.subscription,
      },
      entitlements: { status: "active", plan: "solo", basis: "plan", seats: 2, matters: 100, storage_gb: 25, extra_seats: 0, new_work_blocked: false, ...overrides.entitlements },
      usage: { seats_active: 2, seats_invited: 0, active_matters: 4, sample_matters: 1, storage_bytes: 0, vo_runs_month: 0, emails_month: 0, month_start: "2026-10-01" },
      catalog: "catalog" in overrides ? overrides.catalog : CATALOG,
      grace: { past_due_days: 7, export_window_days: 90 },
      invoices: overrides.invoices ?? [],
    });
  }

  it("shows the plan and its price from the catalog, the allowances and the owner's buttons; prices never come from code", () => {
    const data = subscriptionPage({ firmName: "Synthetic Firm", subscription: { status: "active", trial_started_at: null, trial_ends_at: null, plan: "solo" }, usage: null, timeZone: ZONE, now: NOW, detail: detail(), canManage: true, organizationId: "org" });
    expect(data.rows.slice(0, 5)).toEqual([
      ["Plan", "Solo · CAD 1,290/year"],
      ["State", "Active, renews on 1 Oct 2027"],
      ["Seats", "2 of 2"],
      ["Active matters", "3 of 100 (1 sample, not counted)"],
      ["Storage", "0 of 25 GB"],
    ]);
    expect(data.buttons?.map((button) => [button.label, button.act])).toEqual([["Change plan", "portal"], ["Manage billing", "portal"], ["Cancel at period end", "portal"]]);
    expect(data.dialog).toBeNull();
    expect(data.note).toContain("Prices are in CAD and set by Casevoya");
    // A catalog with no prices shows no amount at all, and the dialog says "No price set".
    const bare = subscriptionPage({ firmName: "Synthetic Firm", subscription: { status: "trial", trial_started_at: null, trial_ends_at: null }, usage: null, timeZone: ZONE, now: NOW, detail: detail({ subscription: { status: "trial", plan: null, has_billing_account: false, has_stripe_subscription: false }, entitlements: { status: "trial", plan: null, basis: "trial" }, catalog: {} }), canManage: true, organizationId: "org" });
    expect(bare.rows[0]).toEqual(["Plan", "None chosen yet. Your trial has Solo allowances."]);
    expect(JSON.stringify(bare.rows)).not.toMatch(/CAD|\b(129|299|599)\b/);
    expect(bare.dialog?.plans.map((plan) => plan.allowances)).toEqual(["No price set", "No price set", "No price set", "Arranged with Casevoya: no limits set here"]);
    expect(planTotalText(null, "solo", "month", 0)).toBe("No price set");
    expect(planTotalText(readCatalog(CATALOG), "practice", "year", 2)).toBe("CAD 3,490/year");
    expect(planTotalText(readCatalog(CATALOG), "enterprise", "month", 0)).toBe("Arranged with Casevoya");
    // Finance sees everything but no buttons; a Change plan for an owner without a live subscription opens the dialog.
    const finance = subscriptionPage({ firmName: "Synthetic Firm", subscription: { status: "active", trial_started_at: null, trial_ends_at: null, plan: "solo" }, usage: null, timeZone: ZONE, now: NOW, detail: detail(), canManage: false, organizationId: "org" });
    expect(finance.buttons).toEqual([]);
    expect(finance.dialog).toBeNull();
    const cancelled = subscriptionPage({ firmName: "Synthetic Firm", subscription: { status: "cancelled", trial_started_at: null, trial_ends_at: null, plan: "solo" }, usage: null, timeZone: ZONE, now: NOW, detail: detail({ subscription: { status: "cancelled", cancelled_at: "2026-10-01T12:00:00Z" }, entitlements: { status: "cancelled", new_work_blocked: true } }), canManage: true, organizationId: "org" });
    expect(cancelled.buttons?.map((button) => [button.label, button.act])).toEqual([["Choose a plan again", "plan"], ["Manage billing", "portal"]]);
    expect(cancelled.dialog?.selected).toBe("solo");
    expect(cancelled.rows[1]).toEqual(["State", "Cancelled on 1 Oct 2026. Exports stay open at least until 30 Dec 2026."]);
    expect(cancelled.alert?.title).toBe("Your subscription is cancelled");
  });

  it("names the past due, restricted and archived states with their dates, and lists Casevoya's invoices", () => {
    const pastDue = subscriptionPage({ firmName: "F", subscription: { status: "past_due", trial_started_at: null, trial_ends_at: null, plan: "solo" }, usage: null, timeZone: ZONE, now: NOW, detail: detail({ subscription: { status: "past_due", past_due_since: "2026-10-16T12:00:00Z" }, entitlements: { status: "past_due" } }) });
    expect(pastDue.rows[1]).toEqual(["State", "Past due since 16 Oct 2026: the last payment failed. New work pauses on 23 Oct 2026 unless the payment goes through."]);
    expect(pastDue.alert?.title).toBe("The last payment failed");
    expect(subscriptionPill({ status: "past_due", trial_started_at: null, trial_ends_at: null, plan: "solo" }, NOW)).toBe("Plan: Solo");
    const restricted = subscriptionPage({ firmName: "F", subscription: { status: "restricted", trial_started_at: null, trial_ends_at: null, plan: "solo" }, usage: null, timeZone: ZONE, now: NOW, detail: detail({ subscription: { status: "restricted", restricted_at: "2026-10-18T12:00:00Z" }, entitlements: { status: "restricted", new_work_blocked: true } }) });
    expect(restricted.rows[1][1]).toMatch(/^Restricted since 18 Oct 2026: payment is overdue, so new work is paused\. Your records and exports stay open\.$/);
    expect(restricted.alert?.title).toBe("Payment is overdue, so new work is paused");
    const archived = subscriptionPage({ firmName: "F", subscription: { status: "archived", trial_started_at: null, trial_ends_at: null, plan: "solo" }, usage: null, timeZone: ZONE, now: NOW, detail: detail({ subscription: { status: "archived", archived_at: "2026-10-18T12:00:00Z" }, entitlements: { status: "archived", new_work_blocked: true } }) });
    expect(archived.rows[1]).toEqual(["State", "Archived on 18 Oct 2026. Nothing was deleted; choose a plan to carry on."]);
    expect(archived.alert?.tone).toBe("info");
    expect(subscriptionPill({ status: "archived", trial_started_at: null, trial_ends_at: null, plan: "solo" }, NOW)).toBe("Subscription: Archived");

    const invoices = subscriptionPage({
      firmName: "F", subscription: { status: "active", trial_started_at: null, trial_ends_at: null, plan: "solo" }, usage: null, timeZone: ZONE, now: NOW,
      detail: detail({
        invoices: [
          { id: "a", number: "CV-0002", status: "open", amount_due_cents: 12900, amount_paid_cents: 0, currency: "cad", hosted_invoice_url: "https://invoice.stripe.com/i/two", pdf_url: null, created_at: "2026-10-18T12:00:00Z" },
          { id: "b", number: "CV-0001", status: "paid", amount_due_cents: 12900, amount_paid_cents: 12900, currency: "cad", hosted_invoice_url: null, pdf_url: "https://pay.stripe.com/invoice/one/pdf", created_at: "2026-09-18T12:00:00Z" },
          { id: "bad", status: "paid" },
        ],
      }),
    });
    expect(invoices.invoices).toEqual([
      { text: "CV-0002 · 18 Oct 2026 · CAD 129 · Awaiting payment", href: "https://invoice.stripe.com/i/two" },
      { text: "CV-0001 · 18 Sep 2026 · CAD 129 · Paid", href: "https://pay.stripe.com/invoice/one/pdf" },
    ]);
    expect(invoices.rows).toContainEqual(["Invoices from Casevoya", "2 invoices"]);
    expect(readFirmSubscription({ subscription: null })).toBeNull();
    expect(readFirmSubscription(null)).toBeNull();
  });
});

describe("Subscription entitlements in the rest of the Sheet", () => {
  it("turns the database's refusals into plain words that name the limit and the fix", () => {
    expect(entitlementError("seat allowance reached: 2 of 2 staff seats are in use; add a seat in Settings > Subscription")).toBe(
      "Your plan's seat allowance is used: 2 of 2 staff seats are in use. Add a seat in Settings > Subscription.",
    );
    expect(entitlementError("active-matter allowance reached: 100 of 100 active matters are open; close a matter or change plan in Settings > Subscription")).toBe(
      "Your plan's active-matter allowance is used: 100 of 100 active matters are open. Close a matter or change plan in Settings > Subscription.",
    );
    expect(entitlementError("subscription paused: choose a plan in Settings > Subscription before inviting staff")).toMatch(/paused/);
    expect(entitlementError("firm owner step-up is required")).toBeNull();
    expect(subscriptionActionError("enterprise plans are arranged with Casevoya")).toMatch(/arranged with Casevoya/);
    expect(subscriptionActionError("the current subscription is changed in the billing portal")).toMatch(/Manage billing/);
    expect(subscriptionActionError("firm owner step-up is required")).toBeNull();
    expect(subscriptionStepUpLocation(true)).toBe("/mfa?step=6&next=%2Fsheet%2Fsettings%3Ftab%3Dbilling%26dlg%3Dplan");
  });

  it("shows the seat allowance on Team and seats, and a paused subscription on the setup banner", () => {
    const members = [{ status: "active" }, { status: "active" }, { status: "suspended" }] as unknown as Parameters<typeof teamSummary>[0];
    expect(teamSummary(members, 1, 6)).toBe("2 of 6 staff seats in use, 1 suspended, 1 invitation waiting. Clients and family don’t use a seat.");
    expect(teamSummary(members, 0, null)).toBe("2 staff seats in use, 1 suspended. Clients and family don’t use a seat.");
    const rows = { verificationStatus: "verified", credentials: [], subscriptionStatus: "cancelled" };
    expect(inviteBlockers(rows)).toEqual(["owner_licence_missing", "subscription_restricted"]);
    expect(inviteBlockers({ ...rows, subscriptionStatus: "trial_ended" })).toEqual(["owner_licence_missing", "trial_ended"]);
    expect(blockerStep("subscription_restricted")).toEqual({ key: "subscription", label: "Your subscription is paused: choose a plan", href: "/sheet/settings?tab=billing" });
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
