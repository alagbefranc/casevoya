import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { handleStripeWebhook } from "@/modules/finance/webhook";
import { isUuid } from "@/lib/tenant/context";

/** Stripe posts the raw body here. The signature is checked before any row is written. */
export async function POST(request: Request) {
  const raw = await request.text();
  const signature = request.headers.get("stripe-signature");
  const result = await handleStripeWebhook({
    raw,
    signature,
    env: process.env,
    now: Math.floor(Date.now() / 1000),
    record: async (event) => {
      const supabase = createServiceClient();
      const { data, error } = await supabase.rpc("record_stripe_event", {
        p_event_id: event.eventId,
        p_account_id: event.accountId,
        p_event_type: event.eventType,
        p_payload: event.payload,
        p_organization_id: event.organizationId && isUuid(event.organizationId) ? event.organizationId : null,
      });
      if (error) throw new Error(error.message);
      return typeof data === "string" ? data : "processed";
    },
  });
  return NextResponse.json(result.body, { status: result.status });
}
