import Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { readCatalog } from "@/modules/subscription/catalog";
import {
  billingEventSummary,
  createBillingCustomer,
  createPortalSession,
  createSubscriptionCheckout,
  handleBillingWebhook,
  PriceResolutionError,
  readPriceCache,
  type BillingEventSummary,
  type BillingStripe,
} from "@/modules/subscription/stripe";

/** A synthetic test-mode secret. Never a real one. */
const SECRET = "whsec_syntheticBillingSecretForVitestOnly00";
const ORG = "22222222-2222-4222-8222-222222222222";
const crypto = Stripe.createSubtleCryptoProvider();
/** Stripe sends unix seconds; the summary carries ISO strings. */
const iso = (seconds: number) => new Date(seconds * 1000).toISOString();

const CATALOG = readCatalog({
  currency: "CAD",
  annual_months: 10,
  extra_seat_monthly_cents: 2500,
  solo: { monthly_cents: 12900, seats: 2, matters: 100, storage_gb: 25 },
  practice: { monthly_cents: 29900, seats: 6, matters: 500, storage_gb: 100 },
  firm: { monthly_cents: 59900, seats: 15, matters: 1500, storage_gb: 250 },
})!;

function event(type: string, object: Record<string, unknown>, overrides: { id?: string; livemode?: boolean; account?: string } = {}) {
  return {
    id: overrides.id ?? "evt_1SyntheticBilling01",
    object: "event",
    api_version: "2026-09-30.endive",
    created: 1_792_000_000,
    livemode: overrides.livemode ?? false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type,
    ...(overrides.account ? { account: overrides.account } : {}),
    data: { object },
  };
}

/** Shaped like Stripe's customer.subscription.updated fixture, with the Casevoya metadata and lookup keys. */
function subscriptionObject(overrides: Record<string, unknown> = {}) {
  return {
    id: "sub_1SyntheticSub01",
    object: "subscription",
    customer: "cus_1SyntheticFirm01",
    status: "active",
    livemode: false,
    cancel_at: null,
    canceled_at: null,
    metadata: { casevoya_organization_id: ORG, casevoya_plan: "practice", casevoya_interval: "month" },
    default_payment_method: { id: "pm_card_visa", card: { brand: "visa", last4: "4242", exp_year: 2034 } },
    items: {
      object: "list",
      data: [
        { id: "si_1", object: "subscription_item", quantity: 1, current_period_end: 1_794_600_000, price: { id: "price_1Plan", lookup_key: "casevoya_practice_month", unit_amount: 29900, currency: "cad" } },
        { id: "si_2", object: "subscription_item", quantity: 2, current_period_end: 1_794_600_000, price: { id: "price_1Seat", lookup_key: "casevoya_seat_month", unit_amount: 2500, currency: "cad" } },
      ],
    },
    ...overrides,
  };
}

function invoiceObject(overrides: Record<string, unknown> = {}) {
  return {
    id: "in_1SyntheticInvoice01",
    object: "invoice",
    customer: "cus_1SyntheticFirm01",
    number: "CV-0007",
    status: "paid",
    amount_due: 34900,
    amount_paid: 34900,
    currency: "cad",
    created: 1_792_000_000,
    period_start: 1_792_000_000,
    period_end: 1_794_600_000,
    hosted_invoice_url: "https://invoice.stripe.com/i/synthetic",
    invoice_pdf: "https://pay.stripe.com/invoice/synthetic/pdf",
    livemode: false,
    customer_email: "owner@example.test",
    customer_address: { line1: "1 Synthetic St" },
    parent: { type: "subscription_details", subscription_details: { subscription: "sub_1SyntheticSub01", metadata: { casevoya_organization_id: ORG } } },
    ...overrides,
  };
}

async function signed(payload: object, secret = SECRET) {
  const body = JSON.stringify(payload);
  const header = await Stripe.webhooks.generateTestHeaderStringAsync({ payload: body, secret, cryptoProvider: crypto });
  return { body, header };
}

function fakeDatabase() {
  const seen = new Set<string>();
  const calls: BillingEventSummary[] = [];
  return {
    calls,
    apply: async (summary: BillingEventSummary) => {
      calls.push(summary);
      if (seen.has(summary.id)) return { outcome: "duplicate" };
      seen.add(summary.id);
      return { outcome: "applied", status: "active" };
    },
  };
}

describe("Stripe billing webhook", () => {
  it("verifies the signature and applies a subscription event as a redacted summary", async () => {
    const db = fakeDatabase();
    const { body, header } = await signed(event("customer.subscription.updated", subscriptionObject()));
    const result = await handleBillingWebhook(body, header, { secret: SECRET, apply: db.apply, cryptoProvider: crypto });
    expect(result).toEqual({ status: 200, body: { received: true, outcome: "applied" } });
    expect(db.calls[0]).toEqual({
      id: "evt_1SyntheticBilling01",
      type: "customer.subscription.updated",
      created: 1_792_000_000,
      livemode: false,
      organization_id: ORG,
      customer: "cus_1SyntheticFirm01",
      subscription: {
        id: "sub_1SyntheticSub01",
        status: "active",
        plan: "practice",
        interval: "month",
        extra_seats: 2,
        current_period_end: iso(1_794_600_000),
        cancel_at: null,
        canceled_at: null,
      },
    });
    // No card, payment method or address reaches the database.
    expect(JSON.stringify(db.calls[0])).not.toMatch(/pm_card|4242|visa|Synthetic St/);
  });

  it("is idempotent, rejects bad signatures, and says when it is not configured", async () => {
    const db = fakeDatabase();
    const { body, header } = await signed(event("invoice.paid", invoiceObject()));
    expect((await handleBillingWebhook(body, header, { secret: SECRET, apply: db.apply, cryptoProvider: crypto })).body.outcome).toBe("applied");
    expect((await handleBillingWebhook(body, header, { secret: SECRET, apply: db.apply, cryptoProvider: crypto })).body.outcome).toBe("duplicate");
    const forged = await signed(event("invoice.paid", invoiceObject()), "whsec_someoneElsesSecret000000000000");
    expect((await handleBillingWebhook(body, forged.header, { secret: SECRET, apply: db.apply, cryptoProvider: crypto })).status).toBe(400);
    expect((await handleBillingWebhook(body, null, { secret: SECRET, apply: db.apply, cryptoProvider: crypto })).status).toBe(400);
    expect((await handleBillingWebhook(body, header, { secret: null, apply: db.apply, cryptoProvider: crypto })).status).toBe(503);
    expect((await handleBillingWebhook(body, header, { secret: SECRET, apply: null, cryptoProvider: crypto })).status).toBe(503);
    expect(db.calls).toHaveLength(2);
    const failing = await handleBillingWebhook(body, header, {
      secret: SECRET,
      cryptoProvider: crypto,
      apply: async () => {
        throw new Error("down");
      },
    });
    expect(failing.status).toBe(500);
  });

  it("acknowledges and ignores live-mode, connected-account and unrelated events", async () => {
    const db = fakeDatabase();
    for (const payload of [
      event("customer.subscription.updated", subscriptionObject(), { livemode: true }),
      event("customer.subscription.updated", subscriptionObject(), { account: "acct_1SyntheticFirm" }),
      event("payment_intent.succeeded", { id: "pi_1", object: "payment_intent" }),
      event("checkout.session.completed", { id: "cs_1", object: "checkout.session", mode: "payment", metadata: {} }),
    ]) {
      const { body, header } = await signed(payload);
      const result = await handleBillingWebhook(body, header, { secret: SECRET, apply: db.apply, cryptoProvider: crypto });
      expect(result.status).toBe(200);
      expect(result.body.outcome).toBe("ignored");
    }
    expect(db.calls).toHaveLength(0);
  });

  it("summarises Checkout completion, invoices and a deleted subscription; a bad org id is dropped", () => {
    const checkout = billingEventSummary(
      event("checkout.session.completed", {
        id: "cs_1Synthetic",
        object: "checkout.session",
        mode: "subscription",
        status: "complete",
        customer: "cus_1SyntheticFirm01",
        subscription: "sub_1SyntheticSub01",
        customer_details: { email: "owner@example.test", address: { line1: "1 Synthetic St" } },
        metadata: { casevoya_organization_id: ORG, casevoya_plan: "firm", casevoya_interval: "year", casevoya_extra_seats: "3" },
      }) as unknown as Stripe.Event,
    );
    expect(checkout).toMatchObject({ organization_id: ORG, customer: "cus_1SyntheticFirm01", subscription: { id: "sub_1SyntheticSub01", plan: "firm", interval: "year", extra_seats: 3 } });
    expect(JSON.stringify(checkout)).not.toMatch(/example\.test|Synthetic St/);

    const invoice = billingEventSummary(event("invoice.payment_failed", invoiceObject({ status: "open", amount_paid: 0 })) as unknown as Stripe.Event);
    expect(invoice).toEqual({
      id: "evt_1SyntheticBilling01",
      type: "invoice.payment_failed",
      created: 1_792_000_000,
      livemode: false,
      organization_id: ORG,
      customer: "cus_1SyntheticFirm01",
      invoice: {
        id: "in_1SyntheticInvoice01",
        number: "CV-0007",
        status: "open",
        amount_due: 34900,
        amount_paid: 0,
        currency: "cad",
        period_start: iso(1_792_000_000),
        period_end: iso(1_794_600_000),
        hosted_invoice_url: "https://invoice.stripe.com/i/synthetic",
        pdf_url: "https://pay.stripe.com/invoice/synthetic/pdf",
        created: iso(1_792_000_000),
      },
    });

    const deleted = billingEventSummary(
      event("customer.subscription.deleted", subscriptionObject({ status: "canceled", canceled_at: 1_794_600_000, metadata: { casevoya_organization_id: "'; drop table firms; --" } })) as unknown as Stripe.Event,
    );
    expect(deleted).toMatchObject({ organization_id: null, subscription: { status: "canceled", canceled_at: iso(1_794_600_000), plan: "practice" } });
    // An invoice with an http (not https) link keeps none.
    const plain = billingEventSummary(event("invoice.paid", invoiceObject({ hosted_invoice_url: "http://example.test/x", invoice_pdf: null })) as unknown as Stripe.Event);
    expect(plain?.invoice).toMatchObject({ hosted_invoice_url: null, pdf_url: null });
  });
});

/** A fake Stripe client: the Prices Francis created, nothing else. Records every call. */
function fakeStripe(prices: Record<string, { id: string; unit_amount: number; currency?: string; interval?: "month" | "year" }>) {
  const calls: { method: string; params: unknown; options?: unknown }[] = [];
  const stripe: BillingStripe = {
    customers: {
      create: async (params, options) => {
        calls.push({ method: "customers.create", params, options });
        return { id: "cus_1SyntheticNew" };
      },
    },
    prices: {
      list: async (params) => {
        calls.push({ method: "prices.list", params });
        const key = params.lookup_keys?.[0] ?? "";
        const row = prices[key];
        return {
          data: row ? [{ id: row.id, unit_amount: row.unit_amount, currency: row.currency ?? "cad", lookup_key: key, active: true, recurring: { interval: row.interval ?? (key.endsWith("_year") ? "year" : "month") } as Stripe.Price.Recurring }] : [],
        };
      },
    },
    checkout: {
      sessions: {
        create: async (params, options) => {
          calls.push({ method: "checkout.sessions.create", params, options });
          return { id: "cs_1Synthetic", url: "https://checkout.stripe.com/c/pay/cs_1Synthetic" };
        },
      },
    },
    billingPortal: {
      sessions: {
        create: async (params) => {
          calls.push({ method: "billingPortal.sessions.create", params });
          return { url: "https://billing.stripe.com/p/session/synthetic" };
        },
      },
    },
  };
  return { stripe, calls };
}

const PRICES = {
  casevoya_practice_year: { id: "price_PracticeYear", unit_amount: 299000 },
  casevoya_seat_year: { id: "price_SeatYear", unit_amount: 25000 },
  casevoya_solo_month: { id: "price_SoloMonthWrong", unit_amount: 9900 },
};

describe("Checkout and portal", () => {
  it("resolves existing Prices by lookup key, checks the amounts against the catalog, caches the ids and never creates one", async () => {
    const { stripe, calls } = fakeStripe(PRICES);
    const cached: Record<string, string>[] = [];
    const cache = { get: () => null, put: async (prices: Record<string, string>) => void cached.push(prices) };
    const session = await createSubscriptionCheckout(stripe, cache, {
      organizationId: ORG,
      customerId: "cus_1SyntheticFirm01",
      plan: "practice",
      interval: "year",
      extraSeats: 2,
      catalog: CATALOG,
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
      appOrigin: "https://app.casevoya.ca",
      mode: "test",
    });
    expect(session).toEqual({ id: "cs_1Synthetic", url: "https://checkout.stripe.com/c/pay/cs_1Synthetic" });
    expect(calls.map((call) => call.method)).toEqual(["prices.list", "prices.list", "checkout.sessions.create"]);
    expect(cached).toEqual([{ casevoya_practice_year: "price_PracticeYear", casevoya_seat_year: "price_SeatYear" }]);
    const create = calls[2] as { params: Stripe.Checkout.SessionCreateParams; options: Stripe.RequestOptions };
    expect(create.params).toMatchObject({
      mode: "subscription",
      customer: "cus_1SyntheticFirm01",
      line_items: [
        { price: "price_PracticeYear", quantity: 1 },
        { price: "price_SeatYear", quantity: 2 },
      ],
      success_url: "https://app.casevoya.ca/sheet/settings?tab=billing&checkout=success",
      cancel_url: "https://app.casevoya.ca/sheet/settings?tab=billing&checkout=cancelled",
      metadata: { casevoya_organization_id: ORG, casevoya_plan: "practice", casevoya_interval: "year", casevoya_extra_seats: "2" },
      subscription_data: { metadata: { casevoya_organization_id: ORG, casevoya_plan: "practice" } },
      client_reference_id: ORG,
    });
    expect(create.options).toEqual({ idempotencyKey: "casevoya-checkout-11111111-1111-4111-8111-111111111111" });

    // A cached id skips the lookup; no seat line without extra seats.
    const again = fakeStripe(PRICES);
    await createSubscriptionCheckout(again.stripe, { get: (key) => (key === "casevoya_practice_year" ? "price_Cached" : null), put: async () => undefined }, {
      organizationId: ORG,
      customerId: "cus_1SyntheticFirm01",
      plan: "practice",
      interval: "year",
      extraSeats: 0,
      catalog: CATALOG,
      idempotencyKey: "k",
      appOrigin: "https://app.casevoya.ca",
      mode: "test",
    });
    expect(again.calls.map((call) => call.method)).toEqual(["checkout.sessions.create"]);
    expect((again.calls[0].params as Stripe.Checkout.SessionCreateParams).line_items).toEqual([{ price: "price_Cached", quantity: 1 }]);
  });

  it("stops honestly when a Price is missing or its amount differs from the catalog", async () => {
    const { stripe, calls } = fakeStripe(PRICES);
    const base = { organizationId: ORG, customerId: "cus_1SyntheticFirm01", extraSeats: 0, catalog: CATALOG, idempotencyKey: "k", appOrigin: "https://app.casevoya.ca", mode: "test" as const };
    await expect(createSubscriptionCheckout(stripe, null, { ...base, plan: "firm", interval: "month" })).rejects.toThrow(PriceResolutionError);
    await expect(createSubscriptionCheckout(stripe, null, { ...base, plan: "solo", interval: "month" })).rejects.toThrow(/does not match the catalog/);
    expect(calls.map((call) => call.method)).toEqual(["prices.list", "prices.list"]);
  });

  it("creates the firm's customer once by firm id and opens the portal back to the Subscription tab", async () => {
    const { stripe, calls } = fakeStripe({});
    expect(await createBillingCustomer(stripe, { organizationId: ORG, name: "Synthetic Firm", email: "owner@example.test" })).toBe("cus_1SyntheticNew");
    expect(calls[0]).toEqual({
      method: "customers.create",
      params: { name: "Synthetic Firm", email: "owner@example.test", metadata: { casevoya_organization_id: ORG } },
      options: { idempotencyKey: `casevoya-customer-${ORG}` },
    });
    expect(await createPortalSession(stripe, { customerId: "cus_1SyntheticFirm01", appOrigin: "https://app.casevoya.ca" })).toBe("https://billing.stripe.com/p/session/synthetic");
    expect(calls[1].params).toEqual({ customer: "cus_1SyntheticFirm01", return_url: "https://app.casevoya.ca/sheet/settings?tab=billing" });
  });

  it("reads the per-mode price cache defensively", () => {
    expect(readPriceCache({ test: { casevoya_solo_month: "price_1SoloMonth", bogus_key: "price_1X", casevoya_seat_month: "not a price" }, live: { casevoya_solo_month: "price_Live" } }, "test")).toEqual({
      casevoya_solo_month: "price_1SoloMonth",
    });
    expect(readPriceCache(null, "test")).toEqual({});
    expect(readPriceCache({ test: [] }, "test")).toEqual({});
  });
});

describe("billing webhook: live mode", () => {
  const LIVE_SECRET = "whsec_syntheticLiveBillingSecretForVitest0";

  it("applies live events on a live server and ignores the test destination's", async () => {
    const db = fakeDatabase();
    const deps = { secret: [LIVE_SECRET, SECRET], livemode: true, apply: db.apply, cryptoProvider: crypto };
    const live = await signed(event("customer.subscription.updated", subscriptionObject({ livemode: true }), { id: "evt_1SyntheticLiveBill1", livemode: true }), LIVE_SECRET);
    expect((await handleBillingWebhook(live.body, live.header, deps)).body.outcome).toBe("applied");
    expect(db.calls.at(-1)).toMatchObject({ id: "evt_1SyntheticLiveBill1", livemode: true });
    const test = await signed(event("customer.subscription.updated", subscriptionObject(), { id: "evt_1SyntheticTestBill1" }));
    expect((await handleBillingWebhook(test.body, test.header, deps)).body).toEqual({ received: true, outcome: "ignored", reason: "livemode" });
    expect(db.calls).toHaveLength(1);
  });
});
