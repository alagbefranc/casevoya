import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { handleStripeWebhook } from "@/modules/finance/webhook";
import { signStripePayload, stripeForm, stripeSecretKey, verifyStripeSignature } from "@/modules/finance/stripe";

const SECRET = "whsec_test_synthetic";
const NOW = 1_700_000_000;

describe("stripe mode and signatures", () => {
  it("reads the test secret and never the live key when STRIPE_MODE=test", () => {
    const env = {
      STRIPE_MODE: "test",
      STRIPE_TEST_SECRET_KEY: "sk_test_only",
      STRIPE_LIVE_SECRET_KEY: "sk_live_do_not_use",
    };
    expect(stripeSecretKey(env)).toBe("sk_test_only");
    expect(stripeSecretKey({ STRIPE_TEST_SECRET_KEY: "sk_test_only", STRIPE_LIVE_SECRET_KEY: "sk_live_do_not_use" })).toBe("sk_test_only");
    expect(() => stripeSecretKey({ STRIPE_MODE: "test", STRIPE_TEST_SECRET_KEY: "sk_live_smuggled" })).toThrow(/refuses a live/);
    expect(() => stripeSecretKey({ STRIPE_MODE: "test", STRIPE_TEST_SECRET_KEY: "rk_live_smuggled" })).toThrow(/refuses a live/);
  });

  it("accepts a fresh v1 signature and rejects a stale or altered one", () => {
    const payload = JSON.stringify({ id: "evt_1" });
    const header = signStripePayload(payload, SECRET, NOW);
    expect(verifyStripeSignature(payload, header, SECRET, NOW)).toBe(true);
    expect(verifyStripeSignature(payload, header, SECRET, NOW + 301)).toBe(false);
    expect(verifyStripeSignature(`${payload} `, header, SECRET, NOW)).toBe(false);
    expect(verifyStripeSignature(payload, "t=1,v1=abcd", SECRET, NOW)).toBe(false);
    const other = createHmac("sha256", "other").update(`${NOW}.${payload}`).digest("hex");
    expect(verifyStripeSignature(payload, `t=${NOW},v1=${other}`, SECRET, NOW)).toBe(false);
  });

  it("does not record an unverified event and never calls Checkout", async () => {
    const calls: string[] = [];
    const bad = await handleStripeWebhook({
      raw: "{}",
      signature: "t=1,v1=nope",
      env: { STRIPE_WEBHOOK_SECRET: SECRET },
      now: NOW,
      record: async () => {
        calls.push("record");
        return "processed";
      },
    });
    expect(bad.status).toBe(400);
    expect(calls).toEqual([]);

    const payload = JSON.stringify({
      id: "evt_pi",
      type: "checkout.session.completed",
      data: { object: { id: "cs_1", amount_total: 100, currency: "cad", metadata: { flow: "client_fee" } } },
    });
    const recorded = await handleStripeWebhook({
      raw: payload,
      signature: signStripePayload(payload, SECRET, NOW),
      env: { STRIPE_WEBHOOK_SECRET: SECRET },
      now: NOW,
      record: async (event) => {
        calls.push(event.eventType);
        return "ignored";
      },
    });
    expect(recorded.status).toBe(200);
    expect(recorded.body.result).toBe("ignored");
    expect(calls).toEqual(["checkout.session.completed"]);

    const paths: string[] = [];
    await expect(
      stripeForm({
        env: { STRIPE_MODE: "test", STRIPE_TEST_SECRET_KEY: "sk_test_only", STRIPE_LIVE_SECRET_KEY: "sk_live_do_not_use" },
        path: "/v1/checkout/sessions",
        body: { mode: "payment" },
        fetchImpl: async (url) => {
          paths.push(url);
          return { ok: true, status: 200, json: async () => ({}) };
        },
      }),
    ).rejects.toThrow(/Checkout/);
    expect(paths).toEqual([]);

    await stripeForm({
      env: { STRIPE_MODE: "test", STRIPE_TEST_SECRET_KEY: "sk_test_only", STRIPE_LIVE_SECRET_KEY: "sk_live_do_not_use" },
      path: "/v1/payment_intents",
      body: { amount: "100", currency: "cad" },
      idempotencyKey: "pay_1",
      stripeAccount: "acct_123",
      fetchImpl: async (url, init) => {
        paths.push(url);
        expect(init.headers.authorization).toBe("Bearer sk_test_only");
        expect(init.headers.authorization).not.toContain("sk_live");
        expect(init.headers["Idempotency-Key"]).toBe("pay_1");
        expect(init.headers["Stripe-Account"]).toBe("acct_123");
        expect(url).not.toContain("checkout");
        return { ok: true, status: 200, json: async () => ({ id: "pi_1", client_secret: "pi_1_secret" }) };
      },
    });
    expect(paths).toEqual(["https://api.stripe.com/v1/payment_intents"]);
  });

  it("maps a direct-charge PaymentIntent and a duplicate result to HTTP 200", async () => {
    const payload = JSON.stringify({
      id: "evt_ok",
      account: "acct_firm",
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: "pi_1",
          amount: 30000,
          currency: "cad",
          metadata: { flow: "client_fee", payment_id: "11111111-1111-4111-8111-111111111111", organization_id: "22222222-2222-4222-8222-222222222222", invoice_id: "33333333-3333-4333-8333-333333333333" },
        },
      },
    });
    const result = await handleStripeWebhook({
      raw: payload,
      signature: signStripePayload(payload, SECRET, NOW),
      env: { STRIPE_WEBHOOK_SECRET: SECRET },
      now: NOW,
      record: async (event) => {
        expect(event.eventType).toBe("payment_intent.succeeded");
        expect(event.accountId).toBe("acct_firm");
        expect(event.payload.amount_cents).toBe("30000");
        expect(event.payload.flow).toBe("client_fee");
        return "duplicate";
      },
    });
    expect(result.status).toBe(200);
    expect(result.body.result).toBe("duplicate");
  });
});
