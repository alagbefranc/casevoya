import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { stripeCrypto, stripeWebhookSecret } from "@/lib/stripe/server";
import { handleStripeWebhook, type ApplyResult } from "@/modules/finance/webhook";

/**
 * Stripe Connect webhook endpoint (test mode). Configure a Connect event destination in the
 * Stripe test Dashboard for events from connected accounts, pointing at /api/stripe/webhook,
 * with payment_intent.processing, .succeeded, .payment_failed and .canceled; refund.created,
 * .updated and .failed; charge.refunded; and charge.dispute.created, .updated and .closed. Its
 * signing secret is STRIPE_WEBHOOK_SECRET. Money state changes only here, never from a browser
 * redirect or the refund request itself.
 */
export async function POST(request: Request) {
  const body = await request.text();
  const serviceKey = process.env.SUPABASE_SECRET_KEY;
  const result = await handleStripeWebhook(body, request.headers.get("stripe-signature"), {
    secret: stripeWebhookSecret(),
    cryptoProvider: stripeCrypto,
    apply: serviceKey
      ? async (args) => {
          const { data, error } = await createServiceClient().rpc("apply_stripe_payment_event", args);
          if (error) throw new Error("apply_stripe_payment_event failed");
          return (data ?? { outcome: "unknown" }) as ApplyResult;
        }
      : null,
    applyReversal: serviceKey
      ? async (args) => {
          const { data, error } = await createServiceClient().rpc("apply_stripe_reversal_event", args);
          if (error) throw new Error("apply_stripe_reversal_event failed");
          return (data ?? { outcome: "unknown" }) as ApplyResult;
        }
      : null,
  });
  return NextResponse.json(result.body, { status: result.status });
}
