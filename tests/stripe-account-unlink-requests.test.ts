import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Bug 8 follow-up: after the disconnect commits, the payment requests still open on the old
 * account are canceled at Stripe on that account (Stripe-Account header), with a mocked Stripe and
 * database; no network. A request that already finished is left alone; a Stripe failure leaves the
 * unlink in place, is listed for the dialog and is sent to the database (which opens the task).
 */

const ORG = "00000000-0000-4000-8000-000000000001";
const HISTORY = "44444444-4444-4444-8444-444444444444";
const OLD = "acct_1SyntheticOldAcct";

type Call = { name: string; args: Record<string, unknown> };

const state = vi.hoisted(() => ({
  rpcCalls: [] as Call[],
  unlink: null as unknown,
  recorded: { data: { canceled: 0, failed: 0, task_id: null } as unknown, error: null as null | { message: string } },
  stripe: null as null | {
    paymentIntents: {
      cancel: (id: string, params: unknown, options: { stripeAccount?: string; idempotencyKey?: string }) => Promise<{ status: string }>;
      retrieve: (id: string, params: unknown, options: { stripeAccount?: string }) => Promise<{ status: string }>;
    };
  },
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getClaims: async () => ({ data: { claims: { sub: "owner-1", email: "owner@example.test" } } }) },
    rpc: async (name: string, args: Record<string, unknown>) => {
      state.rpcCalls.push({ name, args });
      if (name === "unlink_stripe_account") return { data: state.unlink, error: null };
      if (name === "record_stripe_unlink_cancellations") return state.recorded;
      return { data: null, error: { message: `unexpected ${name}` } };
    },
    // The link is read before the unlink: its mode picks the Stripe key (test here).
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { account_id: OLD, livemode: false }, error: null }) }) }) }),
  }),
}));
vi.mock("@/lib/stripe/server", () => ({
  stripeServer: () => state.stripe,
  stripeServerForMode: (mode: string) => (mode === "test" ? state.stripe : null),
  stripeLive: () => false,
}));

import { disconnectStripeAccount } from "@/modules/finance/staff-actions";
import { closeOpenRequests, readOpenRequests, type OpenRequest } from "@/modules/finance/stripe-unlink";
import { openRequestLine } from "@/modules/finance/connect-present";

const request = (n: number, intent: string): OpenRequest => ({
  payment_id: `55555555-5555-4555-8555-55555555555${n}`,
  payment_intent_id: intent,
  invoice_number: `INV-000${n}`,
  amount_cents: 40_000,
  currency: "CAD",
});

const OPEN = request(1, "pi_3SynOpenOld");
const STALE = request(2, "pi_3SynStaleOld");
const DONE = request(3, "pi_3SynPaidOld");
const BROKEN = request(4, "pi_3SynBrokenOld");

/** A fake Stripe: cancels open intents, refuses finished ones (as Stripe does), fails on BROKEN. */
function fakeStripe() {
  const cancels: { id: string; account?: string; key?: string }[] = [];
  const statuses: Record<string, string> = { [OPEN.payment_intent_id]: "requires_payment_method", [STALE.payment_intent_id]: "requires_payment_method", [DONE.payment_intent_id]: "succeeded" };
  const stripe = {
    paymentIntents: {
      cancel: async (id: string, _params: unknown, options: { stripeAccount?: string; idempotencyKey?: string }) => {
        cancels.push({ id, account: options.stripeAccount, key: options.idempotencyKey });
        if (id === BROKEN.payment_intent_id) throw new Error("Stripe unreachable");
        if (statuses[id] === "succeeded") throw new Error("You cannot cancel this PaymentIntent because it has a status of succeeded.");
        statuses[id] = "canceled";
        return { status: "canceled" };
      },
      retrieve: async (id: string, _params: unknown, options: { stripeAccount?: string }) => {
        expect(options.stripeAccount).toBe(OLD);
        if (id === BROKEN.payment_intent_id) throw new Error("Stripe unreachable");
        return { status: statuses[id] };
      },
    },
  };
  return { stripe, cancels };
}

beforeEach(() => {
  state.rpcCalls = [];
  state.recorded = { data: { canceled: 0, failed: 0, task_id: null }, error: null };
  state.stripe = null;
});

describe("closing the old account's open payment requests (bug 8)", () => {
  it("cancels open intents on the old account, and leaves one that already finished alone", async () => {
    const { stripe, cancels } = fakeStripe();
    const closed = await closeOpenRequests(stripe as never, OLD, [OPEN, STALE, DONE]);
    expect(closed.map((item) => [item.payment_intent_id, item.result])).toEqual([
      [OPEN.payment_intent_id, "canceled"],
      [STALE.payment_intent_id, "canceled"],
      [DONE.payment_intent_id, "already_finished"],
    ]);
    expect(cancels.every((call) => call.account === OLD)).toBe(true);
    expect(cancels[0].key).toBe(`casevoya-unlink-${OPEN.payment_intent_id}`);
  });

  it("marks a request failed when Stripe can't be reached or isn't configured", async () => {
    const { stripe } = fakeStripe();
    expect((await closeOpenRequests(stripe as never, OLD, [BROKEN]))[0].result).toBe("failed");
    expect((await closeOpenRequests(null, OLD, [OPEN]))[0].result).toBe("failed");
    expect(readOpenRequests([OPEN, { nope: true }, null])).toEqual([OPEN]);
    expect(readOpenRequests("x")).toEqual([]);
    expect(openRequestLine(BROKEN)).toBe("Card payment request on INV-0004, CAD 400.00 (pi_3SynBrokenOld)");
  });

  it("cancels right after the unlink commits and records each result", async () => {
    const { stripe, cancels } = fakeStripe();
    state.stripe = stripe;
    state.unlink = { unlinked: true, history_id: HISTORY, account_id: OLD, open_requests: [OPEN, STALE, DONE] };
    state.recorded = { data: { canceled: 2, failed: 0, task_id: null }, error: null };
    const result = await disconnectStripeAccount({ organizationId: ORG, accountId: OLD, confirmation: "DISCONNECT", reason: "Moving accounts" });
    expect(result).toEqual({ ok: true, notCanceled: [], taskCreated: false });
    expect(state.rpcCalls.map((call) => call.name)).toEqual(["unlink_stripe_account", "record_stripe_unlink_cancellations"]);
    expect(cancels.map((call) => call.id)).toEqual([OPEN.payment_intent_id, STALE.payment_intent_id, DONE.payment_intent_id]);
    expect(state.rpcCalls[1].args).toEqual({
      p_history_id: HISTORY,
      p_results: [
        { payment_id: OPEN.payment_id, result: "canceled" },
        { payment_id: STALE.payment_id, result: "canceled" },
        { payment_id: DONE.payment_id, result: "already_finished" },
      ],
    });
  });

  it("keeps the unlink when Stripe fails, lists what wasn't canceled and reports the task", async () => {
    const { stripe } = fakeStripe();
    state.stripe = stripe;
    state.unlink = { unlinked: true, history_id: HISTORY, account_id: OLD, open_requests: [OPEN, BROKEN] };
    state.recorded = { data: { canceled: 1, failed: 1, task_id: "66666666-6666-4666-8666-666666666666" }, error: null };
    const result = await disconnectStripeAccount({ organizationId: ORG, accountId: OLD, confirmation: "DISCONNECT", reason: "Moving accounts" });
    expect(result).toMatchObject({ ok: true, taskCreated: true, notCanceled: [{ ...BROKEN, result: "failed" }] });
    expect(state.rpcCalls[1].args.p_results).toEqual([
      { payment_id: OPEN.payment_id, result: "canceled" },
      { payment_id: BROKEN.payment_id, result: "failed" },
    ]);
  });

  it("calls Stripe for nothing when the database refuses or nothing is open", async () => {
    const { stripe, cancels } = fakeStripe();
    state.stripe = stripe;
    state.unlink = { unlinked: false, blockers: [{ kind: "refund", number: "RF-0001", invoice_number: "INV-0001", amount_cents: 100, currency: "CAD", status: "pending" }] };
    expect(await disconnectStripeAccount({ organizationId: ORG, accountId: OLD, confirmation: "DISCONNECT", reason: "Moving accounts" })).toMatchObject({ blockers: [{ number: "RF-0001" }] });
    state.unlink = { unlinked: true, history_id: HISTORY, account_id: OLD, open_requests: [] };
    expect(await disconnectStripeAccount({ organizationId: ORG, accountId: OLD, confirmation: "DISCONNECT", reason: "Moving accounts" })).toEqual({ ok: true, notCanceled: [], taskCreated: false });
    expect(cancels).toEqual([]);
    expect(state.rpcCalls.map((call) => call.name)).toEqual(["unlink_stripe_account", "unlink_stripe_account"]);
  });
});
