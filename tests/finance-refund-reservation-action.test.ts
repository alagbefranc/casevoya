import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * refundPayment reserves the amount in the database before Stripe is called, passes the same key
 * to Stripe, links the Stripe refund to the reservation, and releases it only when Stripe refused.
 * Mocked Stripe and database; no network.
 */

const ORG = "00000000-0000-4000-8000-000000000001";
const PAYMENT = "22222222-2222-4222-8222-222222222222";
const INVOICE = "33333333-3333-4333-8333-333333333333";
const RESERVATION = "44444444-4444-4444-8444-444444444444";
const RECORDED = "55555555-5555-4555-8555-555555555555";
const KEY = "rf-synthetic-key-0001";

type Call = { name: string; args: Record<string, unknown> };
type CreateOptions = { stripeAccount?: string; idempotencyKey?: string };

const state = vi.hoisted(() => ({
  calls: [] as { name: string; args: Record<string, unknown> }[],
  reserve: { data: null as unknown, error: null as null | { message: string } },
  stripe: null as null | { refunds: { create: (params: Record<string, unknown>, options: { stripeAccount?: string; idempotencyKey?: string }) => Promise<{ id: string }> } },
  stripeCalls: [] as { params: Record<string, unknown>; options: { stripeAccount?: string; idempotencyKey?: string } }[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getClaims: async () => ({ data: { claims: { sub: "owner-1", email: "owner@example.test" } } }) },
    rpc: async (name: string, args: Record<string, unknown>) => {
      state.calls.push({ name, args });
      if (name === "invoice_refund_context") {
        return {
          data: { payment_intent_id: "pi_3SynIntent01", account_id: "acct_1SynAccount01", currency: "CAD", refundable: 40_000, invoice_id: INVOICE, number: "INV-0001" },
          error: null,
        };
      }
      if (name === "reserve_invoice_refund" || name === "reserve_client_credit_refund") return state.reserve;
      if (name === "client_credit_refund_context") return { data: { payment_id: PAYMENT, refundable: 40_000, available: 5_000 }, error: null };
      if (name === "link_client_credit_refund") return { data: "66666666-6666-4666-8666-666666666666", error: null };
      if (name === "link_invoice_refund_reservation" || name === "release_invoice_refund_reservation") return { data: null, error: null };
      if (name === "record_invoice_refund") return { data: RECORDED, error: null };
      return { data: null, error: { message: `unexpected ${name}` } };
    },
  }),
}));
// Release and link run on the service client, bound to the signed-in user (security review R-1).
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      state.calls.push({ name: `service:${name}`, args });
      if (name === "service_link_invoice_refund_reservation") return { data: null, error: null };
      if (name === "service_release_invoice_refund_reservation") return { data: true, error: null };
      return { data: null, error: { message: `unexpected ${name}` } };
    },
  }),
}));
vi.mock("@/lib/stripe/server", () => ({
  stripeServer: () => state.stripe,
  stripeServerForMode: () => state.stripe,
  stripeLive: () => false,
}));

import { moveClientCredit, refundPayment } from "@/modules/finance/staff-actions";

function fakeStripe(result: { id: string } | Error) {
  return {
    refunds: {
      create: async (params: Record<string, unknown>, options: CreateOptions) => {
        state.stripeCalls.push({ params, options });
        if (result instanceof Error) throw result;
        return result;
      },
    },
  };
}

const refund = (amount = "100.00") => refundPayment({ organizationId: ORG, idempotencyKey: KEY, payment: PAYMENT, amount, reason: "requested_by_customer" });
const names = () => state.calls.map((call: Call) => call.name);

beforeEach(() => {
  state.calls = [];
  state.stripeCalls = [];
  state.reserve = { data: RESERVATION, error: null };
  state.stripe = fakeStripe({ id: "re_3SynRefund01" });
});

describe("refundPayment reserves before Stripe", () => {
  it("reserves, calls Stripe with the same key, links and records", async () => {
    expect(await refund()).toEqual({ id: RECORDED });
    expect(names()).toEqual(["invoice_refund_context", "reserve_invoice_refund", "service:service_link_invoice_refund_reservation", "record_invoice_refund"]);
    expect(state.calls[1].args).toEqual({ p_payment_id: PAYMENT, p_amount_cents: 10_000, p_currency: "CAD", p_livemode: false, p_idempotency_key: KEY });
    expect(state.stripeCalls).toHaveLength(1);
    expect(state.stripeCalls[0].options).toEqual({ stripeAccount: "acct_1SynAccount01", idempotencyKey: `casevoya-refund-${KEY}` });
    expect(state.stripeCalls[0].params).toMatchObject({ amount: 10_000, metadata: { casevoya_refund_reservation_id: RESERVATION } });
    expect(state.calls[2].args).toEqual({ p_reservation_id: RESERVATION, p_actor: "owner-1", p_refund_id: "re_3SynRefund01" });
    expect(state.calls[3].args).toMatchObject({ p_refund_id: "re_3SynRefund01", p_amount_cents: 10_000, p_idempotency_key: KEY });
  });

  it("does not call Stripe when the database refuses the reservation", async () => {
    state.reserve = { data: null, error: { message: "refund exceeds the amount received" } };
    expect(await refund()).toEqual({ error: "That’s more than is left to refund on this payment." });
    expect(state.stripeCalls).toHaveLength(0);
    state.reserve = { data: null, error: { message: "refund is already in progress" } };
    expect(await refund()).toEqual({ error: expect.stringMatching(/already being sent to Stripe/) });
    expect(state.stripeCalls).toHaveLength(0);
  });

  it("releases the reservation when Stripe refused, and keeps it when the answer is unknown", async () => {
    state.stripe = fakeStripe(Object.assign(new Error("declined"), { statusCode: 400, type: "StripeInvalidRequestError", code: "amount_too_large" }));
    expect(await refund()).toEqual({ error: "That’s more than Stripe can refund on this payment." });
    expect(names()).toEqual(["invoice_refund_context", "reserve_invoice_refund", "service:service_release_invoice_refund_reservation"]);
    expect(state.calls[2].args).toEqual({ p_reservation_id: RESERVATION, p_actor: "owner-1" });

    for (const failure of [
      Object.assign(new Error("network"), { type: "StripeConnectionError" }),
      Object.assign(new Error("server"), { statusCode: 500, type: "StripeAPIError" }),
      Object.assign(new Error("in flight"), { statusCode: 409, type: "StripeIdempotencyError" }),
      Object.assign(new Error("other params"), { statusCode: 400, type: "StripeIdempotencyError" }),
    ]) {
      state.calls = [];
      state.stripe = fakeStripe(failure);
      expect("error" in (await refund())).toBe(true);
      expect(names()).toEqual(["invoice_refund_context", "reserve_invoice_refund"]);
    }
  });

  it("reserves a client credit's card refund against the credit (20261031017000)", async () => {
    const CREDIT = "77777777-7777-4777-8777-777777777777";
    const move = () =>
      moveClientCredit({ organizationId: ORG, idempotencyKey: KEY, today: "", maxCents: null, credit: CREDIT, mode: "card", amount: "30.00", target: "", method: "", reference: "", refundedOn: "" });
    expect(await move()).toEqual({ mode: "card" });
    expect(names()).toEqual([
      "client_credit_refund_context",
      "invoice_refund_context",
      "reserve_client_credit_refund",
      "service:service_link_invoice_refund_reservation",
      "record_invoice_refund",
      "link_client_credit_refund",
    ]);
    expect(state.calls[2].args).toEqual({ p_credit_id: CREDIT, p_payment_id: PAYMENT, p_amount_cents: 3_000, p_currency: "CAD", p_livemode: false, p_idempotency_key: KEY });

    // The database refuses more than the credit has left: Stripe is not called.
    state.calls = [];
    state.stripeCalls = [];
    state.reserve = { data: null, error: { message: "amount is more than the credit available" } };
    expect(await move()).toEqual({ error: "That’s more than is left on this credit." });
    expect(state.stripeCalls).toHaveLength(0);
  });

  it("reserves nothing when Stripe isn't configured", async () => {
    state.stripe = null;
    expect("error" in (await refund())).toBe(true);
    expect(names()).toEqual(["invoice_refund_context"]);
  });
});
