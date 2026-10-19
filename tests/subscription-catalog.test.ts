import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { lookupKeyAmounts, money, parseLookupKey, planLabel, planLookupKey, readCatalog, seatLookupKey, totalCents } from "@/modules/subscription/catalog";

/** The seeded catalog, read from the migration so this test follows the configuration. */
function seededCatalog() {
  const sql = readFileSync(path.resolve(import.meta.dirname, "../supabase/migrations/20261020160100_subscription_billing.sql"), "utf8");
  const match = /'subscription\.plans',\s*'(\{[^']+\})'::jsonb/.exec(sql);
  if (!match) throw new Error("subscription.plans row not found in the migration");
  return readCatalog(JSON.parse(match[1]));
}

describe("subscription catalog", () => {
  it("reads the seeded plans: PRD prices, CAD, annual = 10 × monthly, extra seat 25", () => {
    const catalog = seededCatalog();
    expect(catalog).toEqual({
      currency: "CAD",
      annualMonths: 10,
      extraSeatMonthlyCents: 2500,
      plans: {
        solo: { monthlyCents: 12900, seats: 2, matters: 100, storageGb: 25 },
        practice: { monthlyCents: 29900, seats: 6, matters: 500, storageGb: 100 },
        firm: { monthlyCents: 59900, seats: 15, matters: 1500, storageGb: 250 },
      },
    });
  });

  it("names every Stripe lookup key with the amount the catalog says it carries (the Prices Francis created)", () => {
    expect(lookupKeyAmounts(seededCatalog())).toEqual({
      casevoya_solo_month: 12900,
      casevoya_solo_year: 129000,
      casevoya_practice_month: 29900,
      casevoya_practice_year: 299000,
      casevoya_firm_month: 59900,
      casevoya_firm_year: 599000,
      casevoya_seat_month: 2500,
      casevoya_seat_year: 25000,
    });
    expect(planLookupKey("practice", "year")).toBe("casevoya_practice_year");
    expect(seatLookupKey("month")).toBe("casevoya_seat_month");
    expect(parseLookupKey("casevoya_firm_month")).toEqual({ kind: "plan", plan: "firm", interval: "month" });
    expect(parseLookupKey("casevoya_seat_year")).toEqual({ kind: "seat", interval: "year" });
    expect(parseLookupKey("casevoya_solo_month_12900")).toBeNull();
    expect(parseLookupKey("someone_else")).toBeNull();
  });

  it("labels plans from the catalog and never invents a price when the catalog lacks one", () => {
    const catalog = seededCatalog();
    expect(planLabel(catalog, "practice", "month")).toBe("Practice · CAD 299/month");
    expect(planLabel(catalog, "firm", "year", 2)).toBe("Firm · CAD 5,990/year, plus 2 extra seats");
    expect(planLabel(catalog, "enterprise", "month")).toBe("Enterprise (arranged with Casevoya)");
    expect(totalCents(catalog, "solo", "month", 3)).toBe(12900 + 3 * 2500);
    expect(totalCents(catalog, "solo", "year", 1)).toBe(129000 + 25000);
    expect(money(129000, "CAD")).toBe("CAD 1,290");
    expect(money(12950, "CAD")).toBe("CAD 129.50");
    const bare = readCatalog({ currency: "CAD", solo: { seats: 2 } });
    expect(bare?.plans.solo).toBeNull();
    expect(planLabel(bare, "solo", "month")).toBe("Solo");
    expect(totalCents(bare, "solo", "month", 0)).toBeNull();
    expect(readCatalog(null)).toBeNull();
    expect(lookupKeyAmounts(null).casevoya_solo_month).toBeNull();
  });
});
