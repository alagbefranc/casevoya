import { NextResponse } from "next/server";
import { readLimitedBody } from "@/lib/http/limited-body";
import { STRIPE_WEBHOOK_MAX_BYTES } from "@/lib/stripe/webhook-limits";
import { createServiceClient } from "@/lib/supabase/service";
import { stripeCrypto, stripeLive, stripeServer, stripeWebhookSecrets } from "@/lib/stripe/server";
import { cardFromPaymentIntent, handleStripeWebhook, type ApplyResult } from "@/modules/finance/webhook";

/**
 * Stripe Connect webhook endpoint. Configure a Connect event destination (in test and in live
 * mode) for events from connected accounts, pointing at /api/stripe/webhook,
 * with payment_intent.processing, .succeeded, .payment_failed and .canceled; refund.created,
 * .updated and .failed; charge.refunded; and charge.dispute.created, .updated and .closed. Its
 * signing secrets are STRIPE_WEBHOOK_SECRET (test) and STRIPE_LIVE_WEBHOOK_SECRET (live); only
 * events of the server's Stripe mode are applied. Money state changes only here, never from a browser
 * redirect or the refund request itself.
 *
 * For payment_intent.succeeded the card brand and last 4 (nothing else) are read from the
 * PaymentIntent on the connected account (latest_charge expanded, the server's key) and stored before
 * the event is applied, so the receipt shows "Visa ••••4242". A failed lookup never blocks the payment.
 */
export async function POST(request: Request) {
  // Stripe events are far below 1 MB; a larger body is refused before it is read in full. The
  // signature is still checked on every body that is read.
  const read = await readLimitedBody(request, STRIPE_WEBHOOK_MAX_BYTES);
  if (!read.ok) return NextResponse.json({ error: read.reason }, { status: read.reason === "too_large" ? 413 : 400 });
  const body = new TextDecoder().decode(read.bytes);
  const serviceKey = process.env.SUPABASE_SECRET_KEY;
  const stripe = stripeServer();
  const live = stripeLive();
  const result = await handleStripeWebhook(body, request.headers.get("stripe-signature"), {
    secret: stripeWebhookSecrets(),
    livemode: live,
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
    lookupCard: stripe
      ? async ({ accountId, paymentIntentId }) => {
          const intent = await stripe.paymentIntents.retrieve(
            paymentIntentId,
            { expand: ["latest_charge"] },
            { stripeAccount: accountId, timeout: 5_000, maxNetworkRetries: 1 },
          );
          return intent.livemode === live ? cardFromPaymentIntent(intent) : null;
        }
      : null,
    recordCard: serviceKey
      ? async (args) => {
          const { data, error } = await createServiceClient().rpc("record_invoice_payment_card", args);
          if (error) throw new Error("record_invoice_payment_card failed");
          return (data ?? { outcome: "unknown" }) as ApplyResult;
        }
      : null,
  });
  return NextResponse.json(result.body, { status: result.status });
}
