import { NextResponse } from "next/server";
import { readLimitedBody } from "@/lib/http/limited-body";
import { STRIPE_WEBHOOK_MAX_BYTES } from "@/lib/stripe/webhook-limits";
import { createServiceClient } from "@/lib/supabase/service";
import { stripeBillingWebhookSecrets, stripeCrypto, stripeLive, stripeServer } from "@/lib/stripe/server";
import type Stripe from "stripe";
import { cardFingerprintHash, handleBillingWebhook, summaryJson, type ApplyResult } from "@/modules/subscription/stripe";

/**
 * Stripe PLATFORM-account webhook for Casevoya's own subscriptions. In test and in live mode add an
 * event destination for events on your account (not connected accounts) pointing
 * at /api/stripe/billing with checkout.session.completed, customer.subscription.created,
 * customer.subscription.updated, customer.subscription.deleted,
 * customer.subscription.trial_will_end, checkout.session.async_payment_succeeded,
 * checkout.session.async_payment_failed, invoice.paid, invoice.payment_failed and
 * invoice.payment_action_required. Its signing secrets are STRIPE_BILLING_WEBHOOK_SECRET (test) and
 * STRIPE_LIVE_BILLING_WEBHOOK_SECRET (live), separate from the Connect destinations'; only events
 * of the server's Stripe mode are applied. Subscription state changes only here, never from
 * the browser redirect after Checkout. The Connect webhook (/api/stripe/webhook) is untouched.
 */
export async function POST(request: Request) {
  // Stripe events are far below 1 MB; a larger body is refused before it is read in full. The
  // signature is still checked on every body that is read.
  const read = await readLimitedBody(request, STRIPE_WEBHOOK_MAX_BYTES);
  if (!read.ok) return NextResponse.json({ error: read.reason }, { status: read.reason === "too_large" ? 413 : 400 });
  const body = new TextDecoder().decode(read.bytes);
  const serviceKey = process.env.SUPABASE_SECRET_KEY;
  const stripe = stripeServer();
  const result = await handleBillingWebhook(body, request.headers.get("stripe-signature"), {
    secret: stripeBillingWebhookSecrets(),
    livemode: stripeLive(),
    cryptoProvider: stripeCrypto,
    apply: serviceKey
      ? async (summary) => {
          const { data, error } = await createServiceClient().rpc("apply_stripe_subscription_event", { p_event: summaryJson(summary) });
          if (error) throw new Error("apply_stripe_subscription_event failed");
          return (data ?? { outcome: "unknown" }) as ApplyResult;
        }
      : null,
    // Card trial: one trial per card. The card's fingerprint is hashed here; the card is never stored.
    cardHash: stripe ? (subscription) => trialCardHash(stripe, subscription) : undefined,
    checkoutCardHash: stripe ? async (id) => trialCardHash(stripe, await stripe.subscriptions.retrieve(id)) : undefined,
    endTrial: stripe
      ? async (id) => {
          await stripe.subscriptions.update(id, { trial_end: "now", proration_behavior: "none" }, { idempotencyKey: `casevoya-end-trial-${id}` });
        }
      : undefined,
    // A second subscription paid for while another is live: cancelled now (the stored one is kept).
    cancelSubscription: stripe
      ? async (id) => {
          await stripe.subscriptions.cancel(id, {}, { idempotencyKey: `casevoya-cancel-duplicate-${id}` });
        }
      : undefined,
  });
  return NextResponse.json(result.body, { status: result.status });
}

async function trialCardHash(stripe: Stripe, subscription: Stripe.Subscription): Promise<string | null> {
  let method = subscription.default_payment_method;
  if (!method && typeof subscription.id === "string") {
    method = (await stripe.subscriptions.retrieve(subscription.id)).default_payment_method;
  }
  if (!method) return null;
  const card = typeof method === "string" ? (await stripe.paymentMethods.retrieve(method)).card : method.card;
  return card?.fingerprint ? cardFingerprintHash(card.fingerprint) : null;
}
