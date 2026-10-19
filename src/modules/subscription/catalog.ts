/**
 * Pure: the Casevoya plan catalog as product_settings `subscription.plans` holds it (decision
 * 2026-10-19: prices are configuration, never code constants). Nothing here invents a price: a
 * catalog that lacks a plan or an amount yields null, and the page says so.
 */

export const PAID_PLANS = ["solo", "practice", "firm"] as const;
export type PaidPlan = (typeof PAID_PLANS)[number];
export type Plan = PaidPlan | "enterprise";
export type Interval = "month" | "year";

export type PlanTier = { monthlyCents: number; seats: number | null; matters: number | null; storageGb: number | null };

export type Catalog = {
  currency: string;
  annualMonths: number;
  extraSeatMonthlyCents: number | null;
  plans: Record<PaidPlan, PlanTier | null>;
};

export const PLAN_NAMES: Record<Plan, string> = { solo: "Solo", practice: "Practice", firm: "Firm", enterprise: "Enterprise" };

function positiveInt(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function nonNegativeInt(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

function tier(value: unknown): PlanTier | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const monthlyCents = positiveInt(row.monthly_cents);
  if (monthlyCents === null) return null;
  return { monthlyCents, seats: positiveInt(row.seats), matters: positiveInt(row.matters), storageGb: positiveInt(row.storage_gb) };
}

/** Reads the catalog JSON defensively; null when it is not an object. */
export function readCatalog(value: unknown): Catalog | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const currency = typeof row.currency === "string" && /^[A-Z]{3}$/.test(row.currency) ? row.currency : "CAD";
  return {
    currency,
    annualMonths: positiveInt(row.annual_months) ?? 12,
    extraSeatMonthlyCents: nonNegativeInt(row.extra_seat_monthly_cents),
    plans: { solo: tier(row.solo), practice: tier(row.practice), firm: tier(row.firm) },
  };
}

export function isPaidPlan(value: unknown): value is PaidPlan {
  return typeof value === "string" && (PAID_PLANS as readonly string[]).includes(value);
}

export function isPlan(value: unknown): value is Plan {
  return value === "enterprise" || isPaidPlan(value);
}

export function isInterval(value: unknown): value is Interval {
  return value === "month" || value === "year";
}

/** "CAD 299" or "CAD 1,290.50": whole dollars when there are no cents. */
export function money(cents: number, currency: string): string {
  const whole = cents % 100 === 0;
  const amount = (cents / 100).toLocaleString("en-CA", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
  return `${currency} ${amount}`;
}

/** The price of one plan for one interval, in cents; null when the catalog has none. */
export function planPriceCents(catalog: Catalog | null, plan: Plan, interval: Interval): number | null {
  if (!catalog || plan === "enterprise") return null;
  const row = catalog.plans[plan];
  if (!row) return null;
  return interval === "year" ? row.monthlyCents * catalog.annualMonths : row.monthlyCents;
}

/** The price of the extra seats for one interval, in cents; null when the catalog has no seat price. */
export function extraSeatsCents(catalog: Catalog | null, interval: Interval, extraSeats: number): number | null {
  if (!catalog || catalog.extraSeatMonthlyCents === null) return null;
  const perSeat = interval === "year" ? catalog.extraSeatMonthlyCents * catalog.annualMonths : catalog.extraSeatMonthlyCents;
  return perSeat * Math.max(0, extraSeats);
}

/** "Practice · CAD 299/month" or "Firm · CAD 5,990/year, plus 2 extra seats"; "Enterprise" has no price. */
export function planLabel(catalog: Catalog | null, plan: Plan, interval: Interval | null, extraSeats = 0): string {
  const name = PLAN_NAMES[plan];
  if (plan === "enterprise") return `${name} (arranged with Casevoya)`;
  const cents = interval ? planPriceCents(catalog, plan, interval) : null;
  const price = cents !== null && interval ? ` · ${money(cents, catalog?.currency ?? "CAD")}/${interval}` : "";
  const seats = extraSeats > 0 ? `, plus ${extraSeats} extra ${extraSeats === 1 ? "seat" : "seats"}` : "";
  return `${name}${price}${seats}`;
}

/** The total for one interval (plan plus extra seats), or null when any part has no price. */
export function totalCents(catalog: Catalog | null, plan: Plan, interval: Interval, extraSeats: number): number | null {
  const base = planPriceCents(catalog, plan, interval);
  if (base === null) return null;
  if (extraSeats <= 0) return base;
  const seats = extraSeatsCents(catalog, interval, extraSeats);
  return seats === null ? null : base + seats;
}

/**
 * Stripe Price lookup keys. The Prices exist already in the Casevoya Stripe account (test and
 * live), created at Francis's request: `casevoya_solo_month`, `casevoya_practice_year`,
 * `casevoya_seat_month`… The app never creates one; it resolves them by key and checks the amount
 * against the catalog.
 */
export function planLookupKey(plan: PaidPlan, interval: Interval): string {
  return `casevoya_${plan}_${interval}`;
}

export function seatLookupKey(interval: Interval): string {
  return `casevoya_seat_${interval}`;
}

/** The plan and interval a lookup key names, or null for keys that are not Casevoya's. */
export function parseLookupKey(key: string | null | undefined): { kind: "plan"; plan: PaidPlan; interval: Interval } | { kind: "seat"; interval: Interval } | null {
  const match = typeof key === "string" ? /^casevoya_(solo|practice|firm|seat)_(month|year)$/.exec(key) : null;
  if (!match) return null;
  const [, which, interval] = match;
  if (which === "seat") return { kind: "seat", interval: interval as Interval };
  return { kind: "plan", plan: which as PaidPlan, interval: interval as Interval };
}

/** Every lookup key with the amount (cents) the catalog says it must carry in Stripe; null when the catalog has no price for it. */
export function lookupKeyAmounts(catalog: Catalog | null): Record<string, number | null> {
  const amounts: Record<string, number | null> = {};
  for (const plan of PAID_PLANS) {
    for (const interval of ["month", "year"] as const) amounts[planLookupKey(plan, interval)] = planPriceCents(catalog, plan, interval);
  }
  for (const interval of ["month", "year"] as const) amounts[seatLookupKey(interval)] = extraSeatsCents(catalog, interval, 1);
  return amounts;
}
