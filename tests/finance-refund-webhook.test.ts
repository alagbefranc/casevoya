import Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { handleStripeWebhook, REVERSAL_EVENTS, reversalEventArgs, type PaymentEventArgs, type ReversalEventArgs } from "@/modules/finance/webhook";

/** A synthetic test-mode secret. Never a real one. No network: headers come from Stripe's test generator. */
const SECRET = "whsec_syntheticTestSecretForVitestOnly0000";
const crypto = Stripe.createSubtleCryptoProvider();
const ACCOUNT = "acct_1SyntheticFirm";

type Overrides = { id?: string; type?: string; account?: string | null; livemode?: boolean; object?: Record<string, unknown> };

function event(type: string, object: Record<string, unknown>, overrides: Overrides = {}) {
  return {
    id: overrides.id ?? "evt_3SyntheticRefund01",
    object: "event",
    api_version: "2026-09-30.endive",
    created: 1_792_000_100,
    livemode: overrides.livemode ?? false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type,
    ...(overrides.account === null ? {} : { account: overrides.account ?? ACCOUNT }),
    data: { object: { ...object, ...overrides.object } },
  };
}

/** Shaped like Stripe's `refund.updated` fixture on a connected account. */
const refund = (overrides: Record<string, unknown> = {}) => ({
  id: "re_3SyntheticRefund01",
  object: "refund",
  amount: 13_000,
  balance_transaction: "txn_3Synthetic01",
  charge: "ch_3SyntheticCharge01",
  created: 1_792_000_050,
  currency: "cad",
  metadata: { casevoya_invoice_id: "11111111-1111-4111-8111-111111111111" },
  payment_intent: "pi_3SyntheticIntent01",
  payment_method: "pm_card_visa",
  reason: "requested_by_customer",
  receipt_number: null,
  status: "succeeded",
  ...overrides,
});

/** Shaped like Stripe's `charge.dispute.created` fixture. */
const dispute = (overrides: Record<string, unknown> = {}) => ({
  id: "du_1SyntheticDispute01",
  object: "dispute",
  amount: 113_000,
  charge: "ch_3SyntheticCharge01",
  currency: "cad",
  evidence: { customer_email_address: "client@example.test", customer_name: "Synthetic Client" },
  evidence_details: { due_by: 1_792_600_000, has_evidence: false, past_due: false, submission_count: 0 },
  livemode: false,
  payment_intent: "pi_3SyntheticIntent01",
  reason: "fraudulent",
  status: "needs_response",
  ...overrides,
});

const charge = (overrides: Record<string, unknown> = {}) => ({
  id: "ch_3SyntheticCharge01",
  object: "charge",
  amount: 113_000,
  amount_captured: 113_000,
  amount_refunded: 13_000,
  billing_details: { email: "client@example.test", name: "Synthetic Client" },
  currency: "cad",
  livemode: false,
  payment_intent: "pi_3SyntheticIntent01",
  payment_method_details: { card: { last4: "4242" } },
  refunded: false,
  status: "succeeded",
  ...overrides,
});

async function signed(payload: object, secret = SECRET) {
  const body = JSON.stringify(payload);
  const header = await Stripe.webhooks.generateTestHeaderStringAsync({ payload: body, secret, cryptoProvider: crypto });
  return { body, header };
}

/** The database's dedupe, modelled: an event id per account is applied once. */
function fakeDatabase() {
  const seen = new Set<string>();
  const payments: PaymentEventArgs[] = [];
  const reversals: ReversalEventArgs[] = [];
  const once = (account: string, id: string) => {
    const key = `${account}:${id}`;
    if (seen.has(key)) return { outcome: "duplicate" };
    seen.add(key);
    return { outcome: "applied" };
  };
  return {
    payments,
    reversals,
    deps: {
      secret: SECRET,
      cryptoProvider: crypto,
      apply: async (args: PaymentEventArgs) => {
        payments.push(args);
        return once(args.p_account_id, args.p_event_id);
      },
      applyReversal: async (args: ReversalEventArgs) => {
        reversals.push(args);
        return once(args.p_account_id, args.p_event_id);
      },
    },
  };
}

describe("Stripe refund and dispute webhooks", () => {
  it("handles exactly the refund and dispute events", () => {
    expect([...REVERSAL_EVENTS].sort()).toEqual([
      "charge.dispute.closed",
      "charge.dispute.created",
      "charge.dispute.updated",
      "charge.refunded",
      "refund.created",
      "refund.failed",
      "refund.updated",
    ]);
  });

  it("verifies and applies a connected account's refund event, keeping no card or contact details", async () => {
    const db = fakeDatabase();
    const { body, header } = await signed(event("refund.updated", refund()));
    const result = await handleStripeWebhook(body, header, db.deps);
    expect(result).toEqual({ status: 200, body: { received: true, outcome: "applied" } });
    expect(db.payments).toHaveLength(0);
    expect(db.reversals[0]).toMatchObject({
      p_event_id: "evt_3SyntheticRefund01",
      p_account_id: ACCOUNT,
      p_event_type: "refund.updated",
      p_object_id: "re_3SyntheticRefund01",
      p_payment_intent_id: "pi_3SyntheticIntent01",
      p_charge_id: "ch_3SyntheticCharge01",
      p_amount_cents: 13_000,
      p_currency: "cad",
      p_status: "succeeded",
      p_reason: "requested_by_customer",
      p_event_created: 1_792_000_100,
      p_livemode: false,
    });
    expect(JSON.stringify(db.reversals[0].p_payload)).not.toMatch(/pm_card|example\.test|txn_/);
  });

  it("passes a failed refund's reason, and a PaymentIntent given as an object", async () => {
    const db = fakeDatabase();
    const failed = refund({ status: "failed", failure_reason: "expired_or_canceled_card", payment_intent: { id: "pi_3SyntheticIntent02", object: "payment_intent" } });
    const { body, header } = await signed(event("refund.failed", failed));
    await handleStripeWebhook(body, header, db.deps);
    expect(db.reversals[0]).toMatchObject({ p_event_type: "refund.failed", p_status: "failed", p_failure_reason: "expired_or_canceled_card", p_payment_intent_id: "pi_3SyntheticIntent02" });
  });

  it("passes charge.refunded's running total as a check", async () => {
    const db = fakeDatabase();
    const { body, header } = await signed(event("charge.refunded", charge(), { id: "evt_3SyntheticCharge01" }));
    await handleStripeWebhook(body, header, db.deps);
    expect(db.reversals[0]).toMatchObject({ p_event_type: "charge.refunded", p_object_id: "ch_3SyntheticCharge01", p_amount_refunded_cents: 13_000, p_amount_cents: 113_000 });
    expect(JSON.stringify(db.reversals[0].p_payload)).not.toMatch(/example\.test|4242|Synthetic Client/);
  });

  it("passes a dispute's status, reason and evidence deadline, and none of its evidence", async () => {
    const db = fakeDatabase();
    for (const type of ["charge.dispute.created", "charge.dispute.updated", "charge.dispute.closed"]) {
      const status = type.endsWith("closed") ? "lost" : type.endsWith("updated") ? "under_review" : "needs_response";
      const { body, header } = await signed(event(type, dispute({ status }), { id: `evt_${type.replaceAll(".", "_")}` }));
      expect((await handleStripeWebhook(body, header, db.deps)).status).toBe(200);
    }
    expect(db.reversals.map((args) => [args.p_event_type, args.p_status])).toEqual([
      ["charge.dispute.created", "needs_response"],
      ["charge.dispute.updated", "under_review"],
      ["charge.dispute.closed", "lost"],
    ]);
    expect(db.reversals[0]).toMatchObject({
      p_object_id: "du_1SyntheticDispute01",
      p_amount_cents: 113_000,
      p_reason: "fraudulent",
      p_evidence_due_by: new Date(1_792_600_000 * 1000).toISOString(),
    });
    expect(JSON.stringify(db.reversals[0].p_payload)).not.toMatch(/example\.test|Synthetic Client/);
  });

  it("is idempotent: a redelivered refund event is applied once", async () => {
    const db = fakeDatabase();
    const { body, header } = await signed(event("refund.updated", refund()));
    expect((await handleStripeWebhook(body, header, db.deps)).body.outcome).toBe("applied");
    expect((await handleStripeWebhook(body, header, db.deps)).body.outcome).toBe("duplicate");
  });

  it("rejects a forged or tampered refund event before the database", async () => {
    const db = fakeDatabase();
    const real = await signed(event("refund.updated", refund()));
    const forged = await signed(event("refund.updated", refund()), "whsec_someoneElsesSecret000000000000");
    expect((await handleStripeWebhook(real.body, forged.header, db.deps)).status).toBe(400);
    expect((await handleStripeWebhook(real.body.replace("13000", "130000"), real.header, db.deps)).status).toBe(400);
    expect(db.reversals).toHaveLength(0);
  });

  it("ignores live-mode, platform, and refund events without a PaymentIntent", async () => {
    const db = fakeDatabase();
    for (const payload of [
      event("refund.updated", refund(), { livemode: true }),
      event("refund.updated", refund(), { account: null }),
      event("refund.updated", refund({ payment_intent: null })),
      event("charge.dispute.created", dispute({ payment_intent: null })),
      event("refund.updated", charge()),
    ]) {
      const { body, header } = await signed(payload);
      const result = await handleStripeWebhook(body, header, db.deps);
      expect(result).toMatchObject({ status: 200, body: { outcome: "ignored" } });
    }
    expect(db.reversals).toHaveLength(0);
  });

  it("asks Stripe to retry when refunds can't be applied", async () => {
    const { body, header } = await signed(event("refund.updated", refund()));
    const db = fakeDatabase();
    expect((await handleStripeWebhook(body, header, { ...db.deps, applyReversal: null })).status).toBe(503);
    const failing = await handleStripeWebhook(body, header, {
      ...db.deps,
      applyReversal: async () => {
        throw new Error("down");
      },
    });
    expect(failing.status).toBe(500);
  });

  it("maps nothing for a payment event", () => {
    const paymentEvent = event("payment_intent.succeeded", { id: "pi_3SyntheticIntent01", object: "payment_intent", amount: 1, currency: "cad" });
    expect(reversalEventArgs(paymentEvent as unknown as Stripe.Event)).toBeNull();
  });
});
