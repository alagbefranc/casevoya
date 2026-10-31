import Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { billingCustomerOfFirm, handleBillingWebhook, type BillingEventSummary, type BillingStripe } from "@/modules/subscription/stripe";

/** Synthetic test-mode values only; Stripe is never called. */
const SECRET = "whsec_syntheticDuplicateSubSecretForVitest0";
const ORG = "55555555-5555-4555-8555-555555555555";
const crypto = Stripe.createSubtleCryptoProvider();
const EXTRA = "sub_1SyntheticExtra01";

async function deliver(type: string, object: object) {
  const body = JSON.stringify({ id: `evt_1Syn${type.replace(/\W/g, "")}`, object: "event", api_version: "2026-09-30.endive", created: 1_793_000_000, livemode: false, pending_webhooks: 1, request: { id: null, idempotency_key: null }, type, data: { object } });
  const header = await Stripe.webhooks.generateTestHeaderStringAsync({ payload: body, secret: SECRET, cryptoProvider: crypto });
  return { body, header };
}

function session(trial: boolean) {
  return {
    id: "cs_1Synthetic",
    object: "checkout.session",
    mode: "subscription",
    status: "complete",
    payment_status: trial ? "no_payment_required" : "paid",
    livemode: false,
    customer: "cus_1Synthetic",
    subscription: EXTRA,
    metadata: { casevoya_organization_id: ORG, casevoya_plan: "practice", casevoya_interval: "month", casevoya_extra_seats: "0", casevoya_trial: trial ? "1" : "0" },
  };
}

describe("billing webhook: duplicate subscription", () => {
  it("cancels the subscription the database names, and asks Stripe to retry when that fails", async () => {
    const { body, header } = await deliver("checkout.session.completed", session(false));
    const cancelled: string[] = [];
    const apply = async () => ({ outcome: "ignored", cancel_subscription: EXTRA });
    const ok = await handleBillingWebhook(body, header, { secret: SECRET, cryptoProvider: crypto, apply, cancelSubscription: async (id) => void cancelled.push(id) });
    expect(ok).toEqual({ status: 200, body: { received: true, outcome: "ignored" } });
    expect(cancelled).toEqual([EXTRA]);

    const failed = await handleBillingWebhook(body, header, {
      secret: SECRET,
      cryptoProvider: crypto,
      apply,
      cancelSubscription: async () => {
        throw new Error("synthetic");
      },
    });
    expect(failed.status).toBe(500);
    expect((await handleBillingWebhook(body, header, { secret: SECRET, cryptoProvider: crypto, apply })).status).toBe(503);
  });

  it("cancels nothing without an instruction or with a malformed id", async () => {
    const { body, header } = await deliver("checkout.session.completed", session(false));
    const cancelled: string[] = [];
    for (const answer of [{ outcome: "applied" }, { outcome: "ignored", cancel_subscription: "not-a-sub" }]) {
      const res = await handleBillingWebhook(body, header, { secret: SECRET, cryptoProvider: crypto, apply: async () => answer, cancelSubscription: async (id) => void cancelled.push(id) });
      expect(res.status).toBe(200);
    }
    expect(cancelled).toEqual([]);
  });
});

describe("billing webhook: trial Checkout card hash", () => {
  it("adds the hashed card of the subscription a trial Checkout created; not for a paid one", async () => {
    const hash = "b".repeat(64);
    const looked: string[] = [];
    const seen: BillingEventSummary[] = [];
    const deps = {
      secret: SECRET,
      cryptoProvider: crypto,
      apply: async (summary: BillingEventSummary) => {
        seen.push(summary);
        return { outcome: "applied" };
      },
      checkoutCardHash: async (id: string) => {
        looked.push(id);
        return hash;
      },
    };
    const trial = await deliver("checkout.session.completed", session(true));
    await handleBillingWebhook(trial.body, trial.header, deps);
    const paid = await deliver("checkout.session.completed", session(false));
    await handleBillingWebhook(paid.body, paid.header, deps);
    expect(looked).toEqual([EXTRA]);
    expect(seen[0].subscription).toMatchObject({ trial: true, card_hash: hash });
    expect(seen[1].subscription?.card_hash).toBeUndefined();
  });
});

describe("billing customer check", () => {
  const stripe = (customer: { id: string; deleted?: boolean; metadata?: Record<string, string> } | null): BillingStripe => ({
    customers: { create: async () => ({ id: "cus_1Synthetic" }), ...(customer ? { retrieve: async () => customer } : {}) },
    prices: { list: async () => ({ data: [] }) },
    checkout: { sessions: { create: async () => ({ id: "cs_1", url: null }) } },
    billingPortal: { sessions: { create: async () => ({ url: "https://billing.stripe.com/p/session/synthetic" }) } },
  });

  it("accepts only a live customer whose metadata names the firm", async () => {
    expect(await billingCustomerOfFirm(stripe({ id: "cus_1Synthetic", metadata: { casevoya_organization_id: ORG } }), "cus_1Synthetic", ORG)).toBe(true);
    expect(await billingCustomerOfFirm(stripe({ id: "cus_1Synthetic", metadata: { casevoya_organization_id: "66666666-6666-4666-8666-666666666666" } }), "cus_1Synthetic", ORG)).toBe(false);
    expect(await billingCustomerOfFirm(stripe({ id: "cus_1Synthetic", metadata: {} }), "cus_1Synthetic", ORG)).toBe(false);
    expect(await billingCustomerOfFirm(stripe({ id: "cus_1Synthetic", deleted: true, metadata: { casevoya_organization_id: ORG } }), "cus_1Synthetic", ORG)).toBe(false);
    expect(await billingCustomerOfFirm(stripe(null), "cus_1Synthetic", ORG)).toBe(false);
  });
});
