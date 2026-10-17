import { stripeWebhookSecret, verifyStripeSignature, type StripeEnv } from "@/modules/finance/stripe";

export type NormalizedStripeEvent = {
  eventId: string;
  accountId: string;
  eventType: string;
  organizationId: string | null;
  payload: Record<string, string>;
};

export type WebhookResult = {
  status: number;
  body: { received: boolean; result?: string; error?: string };
};

type RecordFn = (event: NormalizedStripeEvent) => Promise<string>;

/**
 * Verifies the Stripe signature, then maps the event onto the ledger's normalized
 * types. A bad signature is not recorded. Checkout completion is never a payment.
 */
export async function handleStripeWebhook(input: {
  raw: string;
  signature: string | null;
  env: StripeEnv;
  now: number;
  record: RecordFn;
}): Promise<WebhookResult> {
  let secret: string;
  try {
    secret = stripeWebhookSecret(input.env);
  } catch (error) {
    return { status: 500, body: { received: false, error: error instanceof Error ? error.message : "webhook secret missing" } };
  }
  if (!verifyStripeSignature(input.raw, input.signature, secret, input.now)) {
    return { status: 400, body: { received: false, error: "signature rejected" } };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.raw);
  } catch {
    return { status: 400, body: { received: false, error: "payload is not json" } };
  }
  const event = normalizeStripeEvent(parsed);
  if (!event) return { status: 400, body: { received: false, error: "event id missing" } };
  try {
    const result = await input.record(event);
    return { status: 200, body: { received: true, result } };
  } catch (error) {
    return { status: 500, body: { received: false, error: error instanceof Error ? error.message : "record failed" } };
  }
}

export function normalizeStripeEvent(value: unknown): NormalizedStripeEvent | null {
  if (!value || typeof value !== "object") return null;
  const event = value as Record<string, unknown>;
  const eventId = typeof event.id === "string" ? event.id : "";
  if (!eventId) return null;
  const accountId = typeof event.account === "string" ? event.account : "";
  const stripeType = typeof event.type === "string" ? event.type : "";
  const data = event.data && typeof event.data === "object" ? (event.data as Record<string, unknown>) : {};
  const object = data.object && typeof data.object === "object" ? (data.object as Record<string, unknown>) : {};
  const metadata = object.metadata && typeof object.metadata === "object" ? (object.metadata as Record<string, unknown>) : {};
  const meta = (key: string) => (typeof metadata[key] === "string" ? metadata[key] : "");
  const organizationId = meta("organization_id") || null;
  const currency = typeof object.currency === "string" ? object.currency.toLowerCase() : "";
  const amount = typeof object.amount === "number" ? String(object.amount) : "";
  const flow = meta("flow");

  if (stripeType === "payment_intent.succeeded" && flow === "platform_subscription") {
    return {
      eventId,
      accountId,
      eventType: "platform_subscription.activated",
      organizationId,
      payload: {
        flow,
        organization_id: meta("organization_id"),
        amount_cents: amount,
        currency,
        customer_id: typeof object.customer === "string" ? object.customer : "",
        subscription_id: meta("subscription_id") || (typeof object.id === "string" ? object.id : ""),
      },
    };
  }
  if (stripeType === "payment_intent.payment_failed" && flow === "platform_subscription") {
    return {
      eventId,
      accountId,
      eventType: "platform_subscription.past_due",
      organizationId,
      payload: { flow, organization_id: meta("organization_id"), amount_cents: amount, currency },
    };
  }
  if (stripeType === "payment_intent.canceled" && flow === "platform_subscription") {
    return {
      eventId,
      accountId,
      eventType: "platform_subscription.cancelled",
      organizationId,
      payload: { flow, organization_id: meta("organization_id") },
    };
  }
  if (stripeType === "payment_intent.succeeded" || stripeType === "payment_intent.payment_failed") {
    return {
      eventId,
      accountId,
      eventType: stripeType,
      organizationId,
      payload: {
        flow: flow || "client_fee",
        payment_id: meta("payment_id"),
        invoice_id: meta("invoice_id"),
        organization_id: meta("organization_id"),
        amount_cents: amount,
        currency,
      },
    };
  }
  if (stripeType === "refund.updated" || stripeType === "refund.created" || stripeType === "charge.refunded") {
    const status = typeof object.status === "string" ? object.status : "";
    if (stripeType !== "charge.refunded" && status !== "succeeded") {
      return ignored(eventId, accountId, organizationId, stripeType);
    }
    return {
      eventId,
      accountId,
      eventType: "refund.succeeded",
      organizationId,
      payload: {
        flow: "client_fee",
        refund_id: meta("refund_id"),
        provider_refund_id: typeof object.id === "string" ? object.id : "",
        payment_id: meta("payment_id"),
        amount_cents: amount,
        currency,
        organization_id: meta("organization_id"),
      },
    };
  }
  if (stripeType === "charge.dispute.created" || stripeType === "charge.dispute.updated") {
    return {
      eventId,
      accountId,
      eventType: "dispute.opened",
      organizationId,
      payload: {
        flow: "client_fee",
        payment_id: meta("payment_id"),
        provider_dispute_id: typeof object.id === "string" ? object.id : "",
        amount_cents: amount,
        currency,
        organization_id: meta("organization_id"),
      },
    };
  }
  if (stripeType === "account.updated") {
    const charges = object.charges_enabled === true;
    const requirements = object.requirements && typeof object.requirements === "object"
      ? (object.requirements as Record<string, unknown>)
      : {};
    const disabled = typeof requirements.disabled_reason === "string" && requirements.disabled_reason.length > 0;
    const connectStatus = disabled ? "restricted" : charges ? "enabled" : "pending";
    return {
      eventId,
      accountId: accountId || (typeof object.id === "string" ? object.id : ""),
      eventType: "connect.updated",
      organizationId,
      payload: {
        connect_status: connectStatus,
        organization_id: meta("organization_id"),
      },
    };
  }
  // checkout.session.completed and every other Stripe type are recorded as ignored.
  return ignored(eventId, accountId, organizationId, stripeType || "unknown");
}

function ignored(eventId: string, accountId: string, organizationId: string | null, stripeType: string): NormalizedStripeEvent {
  return {
    eventId,
    accountId,
    eventType: stripeType,
    organizationId,
    payload: { flow: "ignored", stripe_type: stripeType },
  };
}
