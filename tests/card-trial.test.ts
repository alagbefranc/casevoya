import Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { readCatalog } from "@/modules/subscription/catalog";
import { billingBanner, BILLING_TAB, daysLeft, PLAN_DIALOG, type BillingBannerRow } from "@/modules/sheet/billing-banner";
import { foundingCents, readPublicPricing, trialDisclosure } from "@/modules/subscription/pricing";
import { pricingPage } from "@/modules/subscription/pricing-page";
import {
  BILLING_EVENTS,
  cardFingerprintHash,
  checkoutDisclosure,
  checkoutTrial,
  couponRefused,
  createSubscriptionCheckout,
  handleBillingWebhook,
  type BillingEventSummary,
  type BillingStripe,
} from "@/modules/subscription/stripe";

// custom_text.submit is "" | { message } in the SDK types.
function submitText(params: { custom_text?: { submit?: unknown } | null }): string {
  const submit = params.custom_text?.submit;
  return submit && typeof submit === "object" && "message" in submit ? String((submit as { message: unknown }).message) : "";
}

/** Synthetic test-mode values only. */
const SECRET = "whsec_syntheticCardTrialSecretForVitestOnly0";
const ORG = "33333333-3333-4333-8333-333333333333";
const crypto = Stripe.createSubtleCryptoProvider();
const NOW = new Date("2026-11-02T15:00:00Z");

const CATALOG = readCatalog({
  currency: "CAD",
  annual_months: 10,
  extra_seat_monthly_cents: 2500,
  solo: { monthly_cents: 9900, seats: 2, matters: 100, storage_gb: 25 },
  practice: { monthly_cents: 24900, seats: 6, matters: 500, storage_gb: 100 },
  firm: { monthly_cents: 54900, seats: 15, matters: 1500, storage_gb: 250 },
})!;

const PRICING_JSON = {
  catalog: {
    currency: "CAD",
    annual_months: 10,
    extra_seat_monthly_cents: 2500,
    solo: { monthly_cents: 9900, seats: 2, matters: 100, storage_gb: 25 },
    practice: { monthly_cents: 24900, seats: 6, matters: 500, storage_gb: 100 },
    firm: { monthly_cents: 54900, seats: 15, matters: 1500, storage_gb: 250 },
  },
  trial_days: 14,
  card_required: true,
  founding_offer: { active: true, percent_off: 25, months: 12, max_firms: 50 },
};

function fakeStripe(refuseCoupon = false) {
  const calls: { params: Stripe.Checkout.SessionCreateParams; options?: Stripe.RequestOptions }[] = [];
  const stripe: BillingStripe = {
    customers: { create: async () => ({ id: "cus_1Synthetic" }) },
    prices: {
      list: async (params) => {
        const key = params.lookup_keys?.[0] ?? "";
        const amount: Record<string, number> = { casevoya_practice_month: 24900, casevoya_solo_year: 99000, casevoya_seat_year: 25000 };
        return amount[key]
          ? { data: [{ id: `price_${key.replace(/_/g, "")}`, unit_amount: amount[key], currency: "cad", lookup_key: key, active: true, recurring: { interval: key.endsWith("_year") ? "year" : "month" } as Stripe.Price.Recurring }] }
          : { data: [] };
      },
    },
    checkout: {
      sessions: {
        create: async (params, options) => {
          calls.push({ params, options });
          if (refuseCoupon && params.discounts?.length) throw Object.assign(new Error("No such coupon"), { code: "resource_missing", param: "discounts[0][coupon]" });
          return { id: "cs_1Synthetic", url: "https://checkout.stripe.com/c/pay/cs_1Synthetic" };
        },
      },
    },
    billingPortal: { sessions: { create: async () => ({ url: "https://billing.stripe.com/p/session/synthetic" }) } },
  };
  return { stripe, calls };
}

const BASE = {
  organizationId: ORG,
  customerId: "cus_1Synthetic",
  plan: "practice" as const,
  interval: "month" as const,
  extraSeats: 0,
  catalog: CATALOG,
  idempotencyKey: "44444444-4444-4444-8444-444444444444",
  appOrigin: "https://app.casevoya.ca",
  mode: "test" as const,
};

describe("card-required trial checkout", () => {
  it("takes a card for a $0 trial, turns on tax, applies the founding coupon and names the date and amount", async () => {
    const { stripe, calls } = fakeStripe();
    await createSubscriptionCheckout(stripe, null, { ...BASE, trial: { days: 14 }, foundingCoupon: "casevoya_founding_25", founding: { percent: 25, months: 12 }, timeZone: "America/Winnipeg" });
    expect(calls).toHaveLength(1);
    const params = calls[0].params;
    expect(params).toMatchObject({
      mode: "subscription",
      payment_method_collection: "always",
      billing_address_collection: "required",
      automatic_tax: { enabled: true },
      tax_id_collection: { enabled: true },
      customer_update: { address: "auto", name: "auto" },
      discounts: [{ coupon: "casevoya_founding_25" }],
      metadata: { casevoya_trial: "1" },
      subscription_data: { trial_period_days: 14, trial_settings: { end_behavior: { missing_payment_method: "cancel" } } },
    });
    expect(params.subscription_data?.metadata).not.toHaveProperty("casevoya_trial");
    const message = submitText(params);
    expect(message).toMatch(/^\$0 today\. Your free trial ends on /);
    expect(message).toContain("CAD 186.75/month (founding-firm price, 25% off for the first 12 months), then CAD 249/month");
    expect(message).toContain("plus applicable taxes");
    expect(message.length).toBeLessThanOrEqual(1200);
  });

  it("opens Checkout at the list price when Stripe refuses the founding coupon", async () => {
    const { stripe, calls } = fakeStripe(true);
    const session = await createSubscriptionCheckout(stripe, null, { ...BASE, trial: { days: 14 }, foundingCoupon: "casevoya_founding_25", founding: { percent: 25, months: 12 } });
    expect(session.id).toBe("cs_1Synthetic");
    expect(calls).toHaveLength(2);
    expect(calls[1].params.discounts).toBeUndefined();
    expect(calls[1].options).toEqual({ idempotencyKey: `casevoya-checkout-${BASE.idempotencyKey}-list` });
    expect(submitText(calls[1].params)).not.toContain("founding");
  });

  it("keeps a legacy trial's end date, and bills today without a trial", async () => {
    const end = new Date(Date.now() + 5 * 86_400_000).toISOString();
    const { stripe, calls } = fakeStripe();
    await createSubscriptionCheckout(stripe, null, { ...BASE, plan: "solo", interval: "year", extraSeats: 1, trial: { endAt: end } });
    expect(calls[0].params.subscription_data).toMatchObject({ trial_end: Math.floor(new Date(end).getTime() / 1000) });
    expect(calls[0].params.subscription_data).not.toHaveProperty("trial_period_days");
    expect(calls[0].params.line_items).toEqual([
      { price: "price_casevoyasoloyear", quantity: 1 },
      { price: "price_casevoyaseatyear", quantity: 1 },
    ]);
    const none = fakeStripe();
    await createSubscriptionCheckout(none.stripe, null, BASE);
    expect(none.calls[0].params.subscription_data).not.toHaveProperty("trial_settings");
    expect(none.calls[0].params.metadata).toMatchObject({ casevoya_trial: "0" });
    expect(submitText(none.calls[0].params)).toMatch(/^You are billed CAD 249\/month, plus applicable taxes, starting today/);
  });

  it("reads the trial: days, a remainder over 49 hours, or nothing", () => {
    expect(checkoutTrial({ days: 14 }, NOW)).toMatchObject({ days: 14, endSeconds: null });
    expect(checkoutTrial({ days: 0 }, NOW)).toBeNull();
    expect(checkoutTrial({ endAt: new Date(NOW.getTime() + 48 * 3_600_000).toISOString() }, NOW)).toBeNull();
    expect(checkoutTrial({ endAt: new Date(NOW.getTime() + 50 * 3_600_000).toISOString() }, NOW)?.endSeconds).toBe(Math.floor(NOW.getTime() / 1000) + 50 * 3600);
    expect(checkoutTrial(null, NOW)).toBeNull();
  });

  it("names the date in the firm's time zone", () => {
    const text = checkoutDisclosure({ cents: 9900, currency: "CAD", interval: "month", trialEnd: new Date("2026-11-16T03:00:00Z"), founding: null, timeZone: "America/Winnipeg" });
    expect(text).toContain("November 15, 2026");
    expect(text).toContain("CAD 99/month, plus applicable taxes");
  });

  it("recognises Stripe's coupon refusals only", () => {
    expect(couponRefused({ code: "coupon_expired" })).toBe(true);
    expect(couponRefused({ code: "resource_missing", param: "discounts[0][coupon]" })).toBe(true);
    expect(couponRefused({ code: "card_declined" })).toBe(false);
    expect(couponRefused(null)).toBe(false);
  });
});

describe("card-trial webhooks", () => {
  function subscription(status: string) {
    return {
      id: "sub_1SyntheticTrial01",
      object: "subscription",
      customer: "cus_1Synthetic",
      status,
      livemode: false,
      cancel_at: null,
      canceled_at: null,
      cancel_at_period_end: false,
      trial_start: 1_793_000_000,
      trial_end: 1_794_209_600,
      metadata: { casevoya_organization_id: ORG, casevoya_plan: "practice", casevoya_interval: "month" },
      default_payment_method: "pm_1Synthetic",
      items: { object: "list", data: [{ id: "si_1", object: "subscription_item", quantity: 1, current_period_end: 1_794_209_600, price: { id: "price_1Plan", lookup_key: "casevoya_practice_month", unit_amount: 24900, currency: "cad" } }] },
    };
  }
  async function deliver(type: string, object: object) {
    const body = JSON.stringify({ id: `evt_1Synthetic${type.replace(/\W/g, "")}`, object: "event", api_version: "2026-09-30.endive", created: 1_793_000_000, livemode: false, pending_webhooks: 1, request: { id: null, idempotency_key: null }, type, data: { object } });
    const header = await Stripe.webhooks.generateTestHeaderStringAsync({ payload: body, secret: SECRET, cryptoProvider: crypto });
    return { body, header };
  }

  it("subscribes to trial_will_end and payment_action_required", () => {
    expect(BILLING_EVENTS.has("customer.subscription.trial_will_end")).toBe(true);
    expect(BILLING_EVENTS.has("invoice.payment_action_required")).toBe(true);
    expect(BILLING_EVENTS.has("invoice.payment_failed")).toBe(true);
  });

  it("carries the trial dates and the hashed card, and ends a repeat trial now", async () => {
    const seen: BillingEventSummary[] = [];
    const ended: string[] = [];
    const hash = await cardFingerprintHash("fpSynthetic01");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain("fpSynthetic01");
    const { body, header } = await deliver("customer.subscription.created", subscription("trialing"));
    const res = await handleBillingWebhook(body, header, {
      secret: SECRET,
      cryptoProvider: crypto,
      apply: async (summary) => {
        seen.push(summary);
        return { outcome: "applied", end_trial: "sub_1SyntheticTrial01" };
      },
      cardHash: async () => hash,
      endTrial: async (id) => void ended.push(id),
    });
    expect(res.status).toBe(200);
    expect(seen[0].subscription).toMatchObject({
      status: "trialing",
      card_hash: hash,
      trial_start: new Date(1_793_000_000_000).toISOString(),
      trial_end: new Date(1_794_209_600_000).toISOString(),
      cancel_at_period_end: false,
    });
    expect(ended).toEqual(["sub_1SyntheticTrial01"]);
  });

  it("applies the event when the card lookup or the trial end fails", async () => {
    const { body, header } = await deliver("customer.subscription.trial_will_end", subscription("trialing"));
    const res = await handleBillingWebhook(body, header, {
      secret: SECRET,
      cryptoProvider: crypto,
      apply: async () => ({ outcome: "applied", end_trial: "sub_1SyntheticTrial01" }),
      cardHash: async () => {
        throw new Error("synthetic");
      },
      endTrial: async () => {
        throw new Error("synthetic");
      },
    });
    expect(res).toEqual({ status: 200, body: { received: true, outcome: "applied" } });
  });
});

describe("billing banner", () => {
  const row = (overrides: Partial<BillingBannerRow>): BillingBannerRow => ({
    status: "trial",
    trial_ends_at: null,
    card_required: false,
    cancel_at_period_end: false,
    past_due_since: null,
    stripe: false,
    ...overrides,
  });
  const base = { now: NOW, timeZone: "America/Winnipeg", canManage: true, isOwner: true };

  it("asks the owner for a card; staff see the words only", () => {
    expect(billingBanner(row({ card_required: true }), base)).toMatchObject({ title: "Add a card to start your 14-day free trial", link: { href: PLAN_DIALOG } });
    expect(billingBanner(row({ card_required: true }), { ...base, canManage: false, isOwner: false })?.link).toBeNull();
  });

  it("counts the days left in a Stripe trial and links to billing", () => {
    const banner = billingBanner(row({ stripe: true, trial_ends_at: "2026-11-12T15:00:00Z" }), base);
    expect(banner).toMatchObject({ title: "10 days left in your free trial", link: { href: BILLING_TAB, label: "Manage billing" } });
    expect(banner?.body).toContain("12 Nov 2026");
    expect(billingBanner(row({ stripe: true, trial_ends_at: "2026-11-12T15:00:00Z", cancel_at_period_end: true }), base)).toBeNull();
    expect(daysLeft("2026-11-03T14:00:00Z", NOW)).toBe(1);
    expect(daysLeft("2026-10-01T00:00:00Z", NOW)).toBe(0);
  });

  it("reminds a legacy trial only in its last week, and warns on a failed payment with the pause date", () => {
    expect(billingBanner(row({ trial_ends_at: "2026-11-30T00:00:00Z" }), base)).toBeNull();
    expect(billingBanner(row({ trial_ends_at: "2026-11-03T15:00:00Z" }), base)).toMatchObject({ tone: "warn", title: "1 day left in your trial" });
    const pastDue = billingBanner(row({ status: "past_due", past_due_since: "2026-11-01T15:00:00Z" }), base);
    expect(pastDue).toMatchObject({ tone: "warn", title: "The last Casevoya payment failed" });
    expect(pastDue?.body).toContain("8 Nov 2026");
    expect(billingBanner(row({ status: "active" }), base)).toBeNull();
    expect(billingBanner(null, base)).toBeNull();
  });
});

describe("public pricing", () => {
  it("reads the offer defensively", () => {
    expect(readPublicPricing(PRICING_JSON)).toMatchObject({ trialDays: 14, cardRequired: true, founding: { percent: 25, months: 12, maxFirms: 50 } });
    expect(readPublicPricing({ ...PRICING_JSON, founding_offer: { active: false, percent_off: 25, months: 12 } }).founding).toBeNull();
    expect(readPublicPricing({ ...PRICING_JSON, founding_offer: { active: true, percent_off: 250, months: 12 } }).founding).toBeNull();
    expect(readPublicPricing(null)).toEqual({ catalog: null, trialDays: 0, cardRequired: false, founding: null });
    expect(foundingCents(24900, 25)).toBe(18675);
    expect(trialDisclosure({ amount: "CAD 99", trialDays: 0, billedOn: null })).toBe("Billed CAD 99 today, + applicable taxes. Cancel anytime.");
  });

  it("shows three tiers by month and year, the founding price, taxes and the billing date", () => {
    const page = pricingPage(readPublicPricing(PRICING_JSON), NOW, "America/Toronto")!;
    expect(page.cards.map((card) => [card.plan, card.month.price, card.year.price])).toEqual([
      ["solo", "CAD 99", "CAD 990"],
      ["practice", "CAD 249", "CAD 2,490"],
      ["firm", "CAD 549", "CAD 5,490"],
    ]);
    expect(page.billedOn).toBe("November 16, 2026");
    expect(page.cards[0].month.disclosure).toBe("$0 today, billed CAD 74.25 on November 16, 2026 unless you cancel; cancel anytime. + applicable taxes.");
    expect(page.cards[1].year.saving).toBe("2 months free");
    expect(page.founding?.line).toContain("25% off your first 12 months for the first 50 firms");
    expect(page.extraSeat).toContain("CAD 25/month or CAD 250/year");
    expect(pricingPage(readPublicPricing({}), NOW)).toBeNull();
  });
});
