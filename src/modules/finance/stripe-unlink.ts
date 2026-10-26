import type Stripe from "stripe";

/**
 * Bug 8: after the firm's Stripe account is disconnected, the payment requests still open on it
 * (card payments a client started or that failed, of any age) are canceled at Stripe on that
 * connected account (Stripe-Account header), so a page left open can't pay an account Casevoya no
 * longer uses. TEST MODE ONLY; the account itself is never deleted or rejected.
 *
 * Casevoya's card payments are PaymentIntents on the connected account (the portal's Payment
 * Element). Casevoya creates no Checkout Sessions on connected accounts (its only Checkout Sessions
 * are the platform's own subscription billing), so there are none to expire.
 */

/** One open request, as app.unlink_stripe_account returns it. */
export type OpenRequest = { payment_id: string; payment_intent_id: string; invoice_number: string; amount_cents: number; currency: string };

export type RequestResult = "canceled" | "already_finished" | "failed";

export type ClosedRequest = OpenRequest & { result: RequestResult };

type IntentsApi = Pick<Stripe["paymentIntents"], "cancel" | "retrieve">;

const FINISHED = new Set<string>(["canceled", "succeeded"]);

/**
 * Cancels each open PaymentIntent on the disconnected account. Stripe refusing because the intent
 * already succeeded or was canceled is "already_finished" (its own webhook decides what Casevoya
 * records); anything else, or no Stripe client, is "failed".
 */
export async function closeOpenRequests(stripe: { paymentIntents: IntentsApi } | null, accountId: string, requests: OpenRequest[]): Promise<ClosedRequest[]> {
  const closed: ClosedRequest[] = [];
  for (const request of requests) {
    if (!stripe || !/^pi_[A-Za-z0-9]{6,250}$/.test(request.payment_intent_id)) {
      closed.push({ ...request, result: "failed" });
      continue;
    }
    const options = { stripeAccount: accountId };
    try {
      const canceled = await stripe.paymentIntents.cancel(request.payment_intent_id, {}, { ...options, idempotencyKey: `casevoya-unlink-${request.payment_intent_id}` });
      closed.push({ ...request, result: canceled.status === "canceled" ? "canceled" : FINISHED.has(canceled.status) ? "already_finished" : "failed" });
    } catch {
      try {
        const intent = await stripe.paymentIntents.retrieve(request.payment_intent_id, {}, options);
        closed.push({ ...request, result: FINISHED.has(intent.status) ? "already_finished" : "failed" });
      } catch {
        closed.push({ ...request, result: "failed" });
      }
    }
  }
  return closed;
}

/** The open requests in app.unlink_stripe_account's answer, ignoring anything malformed. */
export function readOpenRequests(value: unknown): OpenRequest[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const row = item as Partial<OpenRequest> | null;
    if (!row || typeof row.payment_id !== "string" || typeof row.payment_intent_id !== "string") return [];
    return [{
      payment_id: row.payment_id,
      payment_intent_id: row.payment_intent_id,
      invoice_number: typeof row.invoice_number === "string" ? row.invoice_number : "",
      amount_cents: Number(row.amount_cents ?? 0) || 0,
      currency: typeof row.currency === "string" ? row.currency : "CAD",
    }];
  });
}
