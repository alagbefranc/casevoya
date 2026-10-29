import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { stripeBillingWebhookSecrets, stripeCrypto, stripeLive } from "@/lib/stripe/server";
import { handleBillingWebhook, summaryJson, type ApplyResult } from "@/modules/subscription/stripe";

/**
 * Stripe PLATFORM-account webhook for Casevoya's own subscriptions. In test and in live mode add an
 * event destination for events on your account (not connected accounts) pointing
 * at /api/stripe/billing with checkout.session.completed, customer.subscription.created,
 * customer.subscription.updated, customer.subscription.deleted, invoice.paid and
 * invoice.payment_failed. Its signing secrets are STRIPE_BILLING_WEBHOOK_SECRET (test) and
 * STRIPE_LIVE_BILLING_WEBHOOK_SECRET (live), separate from the Connect destinations'; only events
 * of the server's Stripe mode are applied. Subscription state changes only here, never from
 * the browser redirect after Checkout. The Connect webhook (/api/stripe/webhook) is untouched.
 */
export async function POST(request: Request) {
  const body = await request.text();
  const serviceKey = process.env.SUPABASE_SECRET_KEY;
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
  });
  return NextResponse.json(result.body, { status: result.status });
}
