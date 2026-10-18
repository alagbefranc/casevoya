import Stripe from "stripe";
import { describe, expect, it } from "vitest";
import {
  cardDetailsOf,
  cardFromPaymentIntent,
  handleStripeWebhook,
  paymentEventArgs,
  type CardDetails,
  type PaymentEventArgs,
  type RecordCardArgs,
  type WebhookDeps,
} from "@/modules/finance/webhook";

/** A synthetic test-mode secret. Never a real one. */
const SECRET = "whsec_syntheticTestSecretForVitestOnly0000";
const INVOICE = "11111111-1111-4111-8111-111111111111";
const crypto = Stripe.createSubtleCryptoProvider();

/** Shaped like Stripe's `payment_intent.succeeded` fixture, delivered to a Connect endpoint. */
function fixture(overrides: { id?: string; type?: string; account?: string | null; livemode?: boolean; amount?: number; received?: number } = {}) {
  return {
    id: overrides.id ?? "evt_3SyntheticFixture01",
    object: "event",
    api_version: "2026-09-30.endive",
    created: 1_792_000_000,
    livemode: overrides.livemode ?? false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: "casevoya-pi-synthetic" },
    type: overrides.type ?? "payment_intent.succeeded",
    ...(overrides.account === null ? {} : { account: overrides.account ?? "acct_1SyntheticFirm" }),
    data: {
      object: {
        id: "pi_3SyntheticIntent01",
        object: "payment_intent",
        amount: overrides.amount ?? 113000,
        amount_received: overrides.received ?? 113000,
        currency: "cad",
        livemode: overrides.livemode ?? false,
        status: "succeeded",
        metadata: { casevoya_invoice_id: INVOICE, casevoya_invoice_number: "INV-0001" },
        last_payment_error: null,
        payment_method: "pm_card_visa",
        receipt_email: "client@example.test",
      },
    },
  };
}

async function signed(payload: object, secret = SECRET) {
  const body = JSON.stringify(payload);
  const header = await Stripe.webhooks.generateTestHeaderStringAsync({ payload: body, secret, cryptoProvider: crypto });
  return { body, header };
}

/** The database's dedupe, modelled: an event id is applied once. */
function fakeDatabase() {
  const seen = new Set<string>();
  const calls: PaymentEventArgs[] = [];
  return {
    calls,
    apply: async (args: PaymentEventArgs) => {
      calls.push(args);
      const key = `${args.p_account_id}:${args.p_event_id}`;
      if (seen.has(key)) return { outcome: "duplicate" };
      seen.add(key);
      return { outcome: "applied" };
    },
  };
}

describe("Stripe webhook", () => {
  it("verifies the signature with Web Crypto and applies a connected-account payment event", async () => {
    const db = fakeDatabase();
    const { body, header } = await signed(fixture());
    const result = await handleStripeWebhook(body, header, { secret: SECRET, apply: db.apply, cryptoProvider: crypto });
    expect(result).toEqual({ status: 200, body: { received: true, outcome: "applied" } });
    expect(db.calls[0]).toMatchObject({
      p_event_id: "evt_3SyntheticFixture01",
      p_account_id: "acct_1SyntheticFirm",
      p_payment_intent_id: "pi_3SyntheticIntent01",
      p_amount_cents: 113000,
      p_amount_received_cents: 113000,
      p_currency: "cad",
      p_livemode: false,
      p_invoice_id: INVOICE,
    });
    // The stored payload keeps no card or contact details.
    expect(JSON.stringify(db.calls[0].p_payload)).not.toMatch(/pm_card|example\.test/);
  });

  it("is idempotent: a redelivered event is applied once", async () => {
    const db = fakeDatabase();
    const { body, header } = await signed(fixture());
    const first = await handleStripeWebhook(body, header, { secret: SECRET, apply: db.apply, cryptoProvider: crypto });
    const again = await handleStripeWebhook(body, header, { secret: SECRET, apply: db.apply, cryptoProvider: crypto });
    expect(first.body.outcome).toBe("applied");
    expect(again).toEqual({ status: 200, body: { received: true, outcome: "duplicate" } });
  });

  it("rejects a bad or missing signature without touching the database", async () => {
    const db = fakeDatabase();
    const { body } = await signed(fixture());
    const forged = await signed(fixture(), "whsec_someoneElsesSecret000000000000");
    expect((await handleStripeWebhook(body, forged.header, { secret: SECRET, apply: db.apply, cryptoProvider: crypto })).status).toBe(400);
    expect((await handleStripeWebhook(body, null, { secret: SECRET, apply: db.apply, cryptoProvider: crypto })).status).toBe(400);
    const tampered = await signed(fixture());
    const changed = tampered.body.replace("113000", "1");
    expect((await handleStripeWebhook(changed, tampered.header, { secret: SECRET, apply: db.apply, cryptoProvider: crypto })).status).toBe(400);
    expect(db.calls).toHaveLength(0);
  });

  it("says it is not configured without a webhook secret or database key", async () => {
    const { body, header } = await signed(fixture());
    expect((await handleStripeWebhook(body, header, { secret: null, apply: async () => ({ outcome: "x" }) })).status).toBe(503);
    expect((await handleStripeWebhook(body, header, { secret: SECRET, apply: null })).status).toBe(503);
  });

  it("acknowledges and ignores live-mode, platform and unrelated events", async () => {
    const db = fakeDatabase();
    for (const payload of [fixture({ livemode: true }), fixture({ account: null }), fixture({ type: "customer.created" })]) {
      const { body, header } = await signed(payload);
      const result = await handleStripeWebhook(body, header, { secret: SECRET, apply: db.apply, cryptoProvider: crypto });
      expect(result.status).toBe(200);
      expect(result.body.outcome).toBe("ignored");
    }
    expect(db.calls).toHaveLength(0);
  });

  it("asks Stripe to retry when the database fails", async () => {
    const { body, header } = await signed(fixture());
    const result = await handleStripeWebhook(body, header, {
      secret: SECRET,
      cryptoProvider: crypto,
      apply: async () => {
        throw new Error("down");
      },
    });
    expect(result.status).toBe(500);
  });

  it("drops an invoice id that is not a uuid", () => {
    const event = fixture() as unknown as Stripe.Event;
    (event.data.object as Stripe.PaymentIntent).metadata = { casevoya_invoice_id: "'; drop table invoices; --" };
    expect(paymentEventArgs(event)?.p_invoice_id).toBeNull();
  });
});

/** A PaymentIntent retrieved with latest_charge expanded, shaped like Stripe's; synthetic values. */
function retrievedIntent(card: { brand?: unknown; last4?: unknown } | null = { brand: "visa", last4: "4242" }) {
  return {
    id: "pi_3SyntheticIntent01",
    object: "payment_intent",
    livemode: false,
    payment_method: "pm_1SyntheticMethod",
    latest_charge: {
      id: "ch_3SyntheticCharge01",
      object: "charge",
      payment_method_details: card
        ? { type: "card", card: { ...card, exp_month: 12, exp_year: 2034, fingerprint: "SyntheticFp", funding: "credit", country: "US" } }
        : { type: "acss_debit", acss_debit: { last4: "6789" } },
    },
  } as unknown as Stripe.PaymentIntent;
}

/** The webhook's database and Stripe, mocked: records the order of calls. */
function cardHarness(options: { recordOutcomes?: string[]; lookup?: () => Promise<CardDetails | null> } = {}) {
  const db = fakeDatabase();
  const order: string[] = [];
  const recorded: RecordCardArgs[] = [];
  const lookups: { accountId: string; paymentIntentId: string }[] = [];
  const outcomes = [...(options.recordOutcomes ?? ["recorded"])];
  return {
    db,
    order,
    recorded,
    lookups,
    deps: {
      secret: SECRET,
      cryptoProvider: crypto,
      apply: async (args: PaymentEventArgs) => {
        order.push("apply");
        return db.apply(args);
      },
      lookupCard: async (args: { accountId: string; paymentIntentId: string }) => {
        order.push("lookup");
        lookups.push(args);
        return options.lookup ? options.lookup() : cardFromPaymentIntent(retrievedIntent());
      },
      recordCard: async (args: RecordCardArgs) => {
        order.push("record");
        recorded.push(args);
        return { outcome: outcomes.shift() ?? "unchanged" };
      },
    } as WebhookDeps,
  };
}

describe("Stripe webhook: card brand and last 4 for the receipt", () => {
  it("reads the card from the PaymentIntent on the connected account and stores it before applying the payment", async () => {
    const h = cardHarness();
    const { body, header } = await signed(fixture());
    const result = await handleStripeWebhook(body, header, h.deps);
    expect(result).toEqual({ status: 200, body: { received: true, outcome: "applied" } });
    expect(h.order).toEqual(["lookup", "record", "apply"]);
    expect(h.lookups).toEqual([{ accountId: "acct_1SyntheticFirm", paymentIntentId: "pi_3SyntheticIntent01" }]);
    expect(h.recorded).toEqual([
      { p_account_id: "acct_1SyntheticFirm", p_payment_intent_id: "pi_3SyntheticIntent01", p_card_brand: "visa", p_card_last4: "4242", p_livemode: false },
    ]);
    // Brand and last 4 only: nothing else about the card reaches the database.
    expect(JSON.stringify(h.recorded)).not.toMatch(/2034|SyntheticFp|credit|exp_/);
    expect(JSON.stringify(h.db.calls[0].p_payload)).not.toMatch(/visa|4242/);
  });

  it("uses a card already on the event's PaymentIntent without a lookup", async () => {
    const h = cardHarness();
    const payload = fixture();
    Object.assign(payload.data.object, { latest_charge: retrievedIntent({ brand: "mastercard", last4: "4444" }).latest_charge });
    const { body, header } = await signed(payload);
    await handleStripeWebhook(body, header, h.deps);
    expect(h.order).toEqual(["record", "apply"]);
    expect(h.recorded[0]).toMatchObject({ p_card_brand: "mastercard", p_card_last4: "4444" });
  });

  it("still applies the payment when the Stripe lookup fails, finds no card, or the record call fails", async () => {
    for (const lookup of [
      async () => {
        throw new Error("Stripe is down");
      },
      async () => null,
      async () => cardFromPaymentIntent(retrievedIntent(null)),
      async () => ({ brand: "visa", last4: "42" }),
    ]) {
      const h = cardHarness({ lookup });
      const { body, header } = await signed(fixture());
      expect(await handleStripeWebhook(body, header, h.deps)).toEqual({ status: 200, body: { received: true, outcome: "applied" } });
      expect(h.order).toEqual(["lookup", "apply"]);
      expect(h.recorded).toEqual([]);
    }
    const failing = cardHarness();
    failing.deps.recordCard = async () => {
      failing.order.push("record");
      throw new Error("database down");
    };
    const { body, header } = await signed(fixture());
    expect(await handleStripeWebhook(body, header, failing.deps)).toEqual({ status: 200, body: { received: true, outcome: "applied" } });
    expect(failing.order).toEqual(["lookup", "record", "apply"]);
    // Without a Stripe client or a record function the payment is applied as before.
    const bare = cardHarness();
    const second = await signed(fixture({ id: "evt_3SyntheticFixture02" }));
    expect((await handleStripeWebhook(second.body, second.header, { ...bare.deps, lookupCard: null })).body.outcome).toBe("applied");
    expect((await handleStripeWebhook(second.body, second.header, { ...bare.deps, recordCard: null })).body.outcome).toBe("duplicate");
    expect(bare.order).toEqual(["apply", "apply"]);
  });

  it("records the card again after the event created the payment's row (recovered from metadata)", async () => {
    const h = cardHarness({ recordOutcomes: ["unknown_payment", "recorded"] });
    const { body, header } = await signed(fixture());
    expect((await handleStripeWebhook(body, header, h.deps)).body.outcome).toBe("applied");
    expect(h.order).toEqual(["lookup", "record", "apply", "record"]);
    // Not again when the event was not applied (a duplicate).
    const dup = cardHarness({ recordOutcomes: ["unknown_payment"] });
    dup.deps.apply = async () => {
      dup.order.push("apply");
      return { outcome: "duplicate" };
    };
    await handleStripeWebhook(body, header, dup.deps);
    expect(dup.order).toEqual(["lookup", "record", "apply"]);
  });

  it("never looks up a card for live-mode events or other payment events", async () => {
    const h = cardHarness();
    for (const payload of [
      fixture({ livemode: true }),
      fixture({ type: "payment_intent.processing", id: "evt_3SyntheticFixture03" }),
      fixture({ type: "payment_intent.payment_failed", id: "evt_3SyntheticFixture04" }),
    ]) {
      const { body, header } = await signed(payload);
      await handleStripeWebhook(body, header, h.deps);
    }
    expect(h.lookups).toEqual([]);
    expect(h.recorded).toEqual([]);
    // A live-mode PaymentIntent inside a test-mode event is not looked up either.
    const live = fixture({ id: "evt_3SyntheticFixture05" });
    live.data.object.livemode = true;
    const { body, header } = await signed(live);
    await handleStripeWebhook(body, header, h.deps);
    expect(h.lookups).toEqual([]);
    expect(h.recorded).toEqual([]);
  });

  it("reads brand and last 4 from an expanded charge or payment method only", () => {
    expect(cardFromPaymentIntent(retrievedIntent())).toEqual({ brand: "visa", last4: "4242" });
    expect(cardFromPaymentIntent({ latest_charge: "ch_1", payment_method: "pm_1" } as Stripe.PaymentIntent)).toBeNull();
    expect(cardFromPaymentIntent({ latest_charge: null, payment_method: { card: { brand: "AMEX", last4: "0005" } } } as unknown as Stripe.PaymentIntent)).toEqual({
      brand: "amex",
      last4: "0005",
    });
    expect(cardDetailsOf({ brand: "visa; drop", last4: "4242" })).toBeNull();
    expect(cardDetailsOf({ brand: "visa", last4: "42424" })).toBeNull();
    expect(cardDetailsOf(null)).toBeNull();
  });
});
