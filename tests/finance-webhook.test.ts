import Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { handleStripeWebhook, paymentEventArgs, type PaymentEventArgs } from "@/modules/finance/webhook";

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
    for (const payload of [fixture({ livemode: true }), fixture({ account: null }), fixture({ type: "charge.refunded" })]) {
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
