import type Stripe from "stripe";
import { subscriptionSummary } from "@/modules/subscription/stripe";

/** The slice of the Stripe client Cancel subscription uses; tests pass a fake. */
export type CancelStripe = {
  subscriptions: { update(id: string, params: Stripe.SubscriptionUpdateParams, options?: Stripe.RequestOptions): Promise<Stripe.Subscription> };
};

/**
 * SEC-10: asks Stripe (test mode) to stop renewing at the end of the paid period, and returns the
 * date it will end as Stripe reports it (cancel_at, else the period end). Idempotent on the key the
 * database recorded with the request.
 */
export async function scheduleCancelAtPeriodEnd(stripe: CancelStripe, input: { subscriptionId: string; idempotencyKey: string }): Promise<{ cancelAt: string; periodEnd: string | null }> {
  const updated = await stripe.subscriptions.update(input.subscriptionId, { cancel_at_period_end: true }, { idempotencyKey: `casevoya-cancel-${input.idempotencyKey}` });
  const summary = subscriptionSummary(updated);
  const cancelAt = summary.cancel_at ?? summary.current_period_end;
  if (!cancelAt) throw new Error("Stripe returned no end date.");
  return { cancelAt, periodEnd: summary.current_period_end };
}
