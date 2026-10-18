import Stripe from "stripe";
import type { Json } from "@/types/database.types";

/**
 * Stripe webhooks (FIN-08). The signature is verified with Web Crypto (constructEventAsync and the
 * SubtleCrypto provider, so it runs on Cloudflare Workers). Only PaymentIntent events from a
 * connected account are applied; the database (app.apply_stripe_payment_event) dedupes by
 * provider, connected account and event id, and checks account, amount and currency again.
 */

export const PAYMENT_EVENTS = new Set([
  "payment_intent.processing",
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
  "payment_intent.canceled",
]);

export type PaymentEventArgs = {
  p_event_id: string;
  p_account_id: string;
  p_event_type: string;
  p_payment_intent_id: string;
  p_amount_cents: number;
  p_amount_received_cents: number;
  p_currency: string;
  p_livemode: boolean;
  p_invoice_id: string | null;
  p_payload: Json;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * The database call for one event, or null when it is not a connected-account PaymentIntent event.
 * The stored payload is a small summary: no card, customer or billing details.
 */
export function paymentEventArgs(event: Stripe.Event): PaymentEventArgs | null {
  if (!PAYMENT_EVENTS.has(event.type)) return null;
  const account = typeof event.account === "string" ? event.account : "";
  if (!account.startsWith("acct_")) return null;
  const intent = event.data.object as Stripe.PaymentIntent;
  if (!intent || intent.object !== "payment_intent" || typeof intent.id !== "string") return null;
  const invoiceId = intent.metadata?.casevoya_invoice_id;
  return {
    p_event_id: event.id,
    p_account_id: account,
    p_event_type: event.type,
    p_payment_intent_id: intent.id,
    p_amount_cents: intent.amount,
    p_amount_received_cents: intent.amount_received ?? 0,
    p_currency: intent.currency,
    p_livemode: event.livemode === true || intent.livemode === true,
    p_invoice_id: invoiceId && UUID.test(invoiceId) ? invoiceId : null,
    p_payload: {
      id: event.id,
      type: event.type,
      created: event.created,
      payment_intent: intent.id,
      status: intent.status,
      amount: intent.amount,
      amount_received: intent.amount_received ?? 0,
      currency: intent.currency,
      last_payment_error: intent.last_payment_error?.code ?? null,
    },
  };
}

export type ApplyResult = { outcome: string } & Record<string, unknown>;

export type WebhookDeps = {
  secret: string | null;
  apply: ((args: PaymentEventArgs) => Promise<ApplyResult>) | null;
  cryptoProvider?: Stripe.CryptoProvider;
};

export type WebhookResponse = { status: number; body: Record<string, unknown> };

/**
 * Verifies and applies one delivery. 2xx tells Stripe to stop retrying: a verified event that is
 * not ours, a duplicate, or one the database refused for a mismatch. 5xx makes Stripe retry.
 */
export async function handleStripeWebhook(body: string, signature: string | null, deps: WebhookDeps): Promise<WebhookResponse> {
  if (!deps.secret || !deps.apply) return { status: 503, body: { error: "Stripe webhooks are not configured." } };
  if (!signature) return { status: 400, body: { error: "Missing Stripe-Signature." } };
  let event: Stripe.Event;
  try {
    event = await Stripe.webhooks.constructEventAsync(body, signature, deps.secret, undefined, deps.cryptoProvider ?? Stripe.createSubtleCryptoProvider());
  } catch {
    return { status: 400, body: { error: "Invalid signature." } };
  }
  if (event.livemode) return { status: 200, body: { received: true, outcome: "ignored", reason: "livemode" } };
  const args = paymentEventArgs(event);
  if (!args) return { status: 200, body: { received: true, outcome: "ignored" } };
  try {
    const result = await deps.apply(args);
    return { status: 200, body: { received: true, outcome: result.outcome } };
  } catch {
    return { status: 500, body: { error: "The event was not recorded." } };
  }
}
