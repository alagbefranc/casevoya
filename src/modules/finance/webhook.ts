import Stripe from "stripe";
import { secretList, verifyStripeEvent, type WebhookSecrets } from "@/modules/finance/webhook-verify";
import type { Json } from "@/types/database.types";

/**
 * Stripe webhooks (FIN-08). The signature is verified with Web Crypto (constructEventAsync and the
 * SubtleCrypto provider, so it runs on Cloudflare Workers). Only PaymentIntent, refund and dispute
 * events from a connected account are applied; the database (app.apply_stripe_payment_event,
 * app.apply_stripe_reversal_event) dedupes by provider, connected account and event id, and checks
 * account, amount and currency again.
 *
 * For payment_intent.succeeded, the card brand and last 4 (nothing else) are recorded first
 * (public.record_invoice_payment_card) so the receipt issued when the event is applied shows them.
 * That step is best effort: it never blocks or fails applying the payment.
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

/**
 * Refund and dispute events from a connected account (FIN-13), applied by
 * app.apply_stripe_reversal_event. `charge.refunded` is a check only: the charge's running total
 * includes pending refunds and names no refund, so the refund.* events move the money state.
 */
export const REVERSAL_EVENTS = new Set([
  "charge.refunded",
  "refund.created",
  "refund.updated",
  "refund.failed",
  "charge.dispute.created",
  "charge.dispute.updated",
  "charge.dispute.closed",
]);

export type ReversalEventArgs = {
  p_event_id: string;
  p_account_id: string;
  p_event_type: string;
  p_object_id: string;
  p_payment_intent_id: string;
  p_charge_id: string | null;
  p_amount_cents: number;
  p_currency: string;
  p_status: string | null;
  p_reason: string | null;
  p_failure_reason: string | null;
  p_evidence_due_by: string | null;
  p_amount_refunded_cents: number | null;
  p_event_created: number | null;
  p_livemode: boolean;
  p_payload: Json;
};

function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : typeof value.id === "string" ? value.id : null;
}

function short(value: string | null | undefined, max: number): string | null {
  return typeof value === "string" && value ? value.slice(0, max) : null;
}

/**
 * The database call for one refund, charge.refunded or dispute event, or null when it is not one
 * from a connected account with a PaymentIntent. The stored payload is a small summary: no card,
 * customer, evidence or billing details.
 */
export function reversalEventArgs(event: Stripe.Event): ReversalEventArgs | null {
  if (!REVERSAL_EVENTS.has(event.type)) return null;
  const account = typeof event.account === "string" ? event.account : "";
  if (!account.startsWith("acct_")) return null;
  const object = event.data.object as { object?: string; id?: unknown };
  if (!object || typeof object.id !== "string") return null;
  const base = {
    p_event_id: event.id,
    p_account_id: account,
    p_event_type: event.type,
    p_object_id: object.id,
    p_event_created: typeof event.created === "number" ? event.created : null,
    p_livemode: event.livemode === true,
  };
  if (object.object === "refund" && event.type.startsWith("refund.")) {
    const refund = event.data.object as Stripe.Refund;
    const intent = idOf(refund.payment_intent);
    if (!intent) return null;
    return {
      ...base,
      p_payment_intent_id: intent,
      p_charge_id: idOf(refund.charge),
      p_amount_cents: refund.amount,
      p_currency: refund.currency,
      p_status: short(refund.status, 40),
      p_reason: short(refund.reason, 60),
      p_failure_reason: short(refund.failure_reason, 120),
      p_evidence_due_by: null,
      p_amount_refunded_cents: null,
      p_payload: {
        id: event.id,
        type: event.type,
        created: event.created,
        refund: refund.id,
        payment_intent: intent,
        status: refund.status,
        amount: refund.amount,
        currency: refund.currency,
        reason: refund.reason ?? null,
        failure_reason: refund.failure_reason ?? null,
      },
    };
  }
  if (object.object === "charge" && event.type === "charge.refunded") {
    const charge = event.data.object as Stripe.Charge;
    const intent = idOf(charge.payment_intent);
    if (!intent) return null;
    return {
      ...base,
      p_payment_intent_id: intent,
      p_charge_id: charge.id,
      p_amount_cents: charge.amount,
      p_currency: charge.currency,
      p_status: short(charge.status, 40),
      p_reason: null,
      p_failure_reason: null,
      p_evidence_due_by: null,
      p_amount_refunded_cents: charge.amount_refunded,
      p_livemode: base.p_livemode || charge.livemode === true,
      p_payload: {
        id: event.id,
        type: event.type,
        created: event.created,
        charge: charge.id,
        payment_intent: intent,
        amount: charge.amount,
        amount_refunded: charge.amount_refunded,
        currency: charge.currency,
      },
    };
  }
  if (object.object === "dispute" && event.type.startsWith("charge.dispute.")) {
    const dispute = event.data.object as Stripe.Dispute;
    const intent = idOf(dispute.payment_intent);
    if (!intent) return null;
    const due = dispute.evidence_details?.due_by;
    return {
      ...base,
      p_payment_intent_id: intent,
      p_charge_id: idOf(dispute.charge),
      p_amount_cents: dispute.amount,
      p_currency: dispute.currency,
      p_status: short(dispute.status, 40),
      p_reason: short(dispute.reason, 60),
      p_failure_reason: null,
      p_evidence_due_by: typeof due === "number" && Number.isFinite(due) ? new Date(due * 1000).toISOString() : null,
      p_amount_refunded_cents: null,
      p_livemode: base.p_livemode || dispute.livemode === true,
      p_payload: {
        id: event.id,
        type: event.type,
        created: event.created,
        dispute: dispute.id,
        payment_intent: intent,
        status: dispute.status,
        amount: dispute.amount,
        currency: dispute.currency,
        reason: dispute.reason ?? null,
        evidence_due_by: typeof due === "number" ? due : null,
      },
    };
  }
  return null;
}

export type ApplyResult = { outcome: string } & Record<string, unknown>;

/**
 * Card brand and last four digits of a card payment (decided by Francis: a card receipt reads
 * "Visa ••••4242"). Nothing else about the card is ever read or kept.
 */
export type CardDetails = { brand: string; last4: string };

export type RecordCardArgs = {
  p_account_id: string;
  p_payment_intent_id: string;
  p_card_brand: string;
  p_card_last4: string;
  p_livemode: boolean;
};

/** Events whose PaymentIntent has a charge whose card is worth recording. */
export const CARD_EVENTS = new Set(["payment_intent.succeeded"]);

const BRAND = /^[a-z0-9_]{1,40}$/;
const LAST4 = /^[0-9]{4}$/;

/** Brand and last 4 from a card object shaped like `payment_method_details.card` or `PaymentMethod.card`. */
export function cardDetailsOf(card: unknown): CardDetails | null {
  if (!card || typeof card !== "object") return null;
  const { brand, last4 } = card as { brand?: unknown; last4?: unknown };
  const cleanBrand = typeof brand === "string" ? brand.trim().toLowerCase() : "";
  const cleanLast4 = typeof last4 === "string" ? last4.trim() : "";
  return BRAND.test(cleanBrand) && LAST4.test(cleanLast4) ? { brand: cleanBrand, last4: cleanLast4 } : null;
}

/**
 * The card of a PaymentIntent, when the object already carries it: `latest_charge` expanded (its
 * `payment_method_details.card`) or `payment_method` expanded (its `card`). Events deliver both as
 * ids, so for a webhook this is usually null and the caller looks the PaymentIntent up.
 */
export function cardFromPaymentIntent(intent: Pick<Stripe.PaymentIntent, "latest_charge" | "payment_method"> | null | undefined): CardDetails | null {
  if (!intent) return null;
  const charge = intent.latest_charge;
  if (charge && typeof charge === "object") {
    const fromCharge = cardDetailsOf(charge.payment_method_details?.card);
    if (fromCharge) return fromCharge;
  }
  const method = intent.payment_method;
  if (method && typeof method === "object") return cardDetailsOf(method.card);
  return null;
}

export type WebhookDeps = {
  /** The Connect destinations' signing secrets (live and test); any one may sign a delivery. */
  secret: WebhookSecrets;
  /** The server's Stripe mode: only events of this mode are applied. Defaults to test. */
  livemode?: boolean;
  apply: ((args: PaymentEventArgs) => Promise<ApplyResult>) | null;
  /** Refund and dispute events. Without it they are left for Stripe to retry (503). */
  applyReversal?: ((args: ReversalEventArgs) => Promise<ApplyResult>) | null;
  cryptoProvider?: Stripe.CryptoProvider;
  /**
   * Looks up the card of a PaymentIntent on the connected account (PaymentIntent with
   * latest_charge expanded). Optional; when missing, failing or returning nothing, the payment is
   * still applied and its card stays unknown.
   */
  lookupCard?: ((args: { accountId: string; paymentIntentId: string }) => Promise<CardDetails | null>) | null;
  /** Stores the card on the payment (public.record_invoice_payment_card). Failures never block. */
  recordCard?: ((args: RecordCardArgs) => Promise<ApplyResult>) | null;
};

export type WebhookResponse = { status: number; body: Record<string, unknown> };

/**
 * Verifies and applies one delivery. 2xx tells Stripe to stop retrying: a verified event that is
 * not ours, a duplicate, or one the database refused for a mismatch. 5xx makes Stripe retry.
 */
export async function handleStripeWebhook(body: string, signature: string | null, deps: WebhookDeps): Promise<WebhookResponse> {
  const secrets = secretList(deps.secret);
  if (!secrets.length || !deps.apply) return { status: 503, body: { error: "Stripe webhooks are not configured." } };
  if (!signature) return { status: 400, body: { error: "Missing Stripe-Signature." } };
  const event = await verifyStripeEvent(body, signature, secrets, deps.cryptoProvider);
  if (!event) return { status: 400, body: { error: "Invalid signature." } };
  // The other mode's destination (test while live, or the reverse): verified, not applied.
  if ((event.livemode === true) !== (deps.livemode === true)) return { status: 200, body: { received: true, outcome: "ignored", reason: "livemode" } };
  const args = paymentEventArgs(event);
  const reversal = args ? null : reversalEventArgs(event);
  if (!args && !reversal) return { status: 200, body: { received: true, outcome: "ignored" } };
  const applyReversal = deps.applyReversal;
  if (reversal && !applyReversal) return { status: 503, body: { error: "Stripe webhooks are not configured." } };
  const card = args ? await recordCardBeforeApply(event, args, deps) : null;
  try {
    const result = args ? await deps.apply(args) : reversal && applyReversal ? await applyReversal(reversal) : { outcome: "ignored" };
    // The payment's row did not exist yet (recovered from the PaymentIntent metadata by the event
    // just applied): record the card now. Its receipt was issued without it and is filled once.
    if (args && card?.pending && result.outcome === "applied") await recordCard(deps, card.args);
    return { status: 200, body: { received: true, outcome: result.outcome } };
  } catch {
    return { status: 500, body: { error: "The event was not recorded." } };
  }
}

async function recordCard(deps: WebhookDeps, args: RecordCardArgs): Promise<string | null> {
  if (!deps.recordCard) return null;
  try {
    return (await deps.recordCard(args)).outcome;
  } catch {
    return null;
  }
}

/**
 * For a succeeded card payment, stores the card brand and last 4 before the event is applied, so
 * the receipt issued when it is applied copies them. Never throws: any failure leaves the card
 * unknown and the payment is applied as usual.
 */
async function recordCardBeforeApply(
  event: Stripe.Event,
  args: PaymentEventArgs,
  deps: WebhookDeps,
): Promise<{ args: RecordCardArgs; pending: boolean } | null> {
  if (!CARD_EVENTS.has(args.p_event_type) || args.p_livemode !== (deps.livemode === true) || !deps.recordCard) return null;
  let card = cardFromPaymentIntent(event.data.object as Stripe.PaymentIntent);
  if (!card && deps.lookupCard) {
    try {
      card = cardDetailsOf(await deps.lookupCard({ accountId: args.p_account_id, paymentIntentId: args.p_payment_intent_id }));
    } catch {
      card = null;
    }
  }
  if (!card) return null;
  const recordArgs: RecordCardArgs = {
    p_account_id: args.p_account_id,
    p_payment_intent_id: args.p_payment_intent_id,
    p_card_brand: card.brand,
    p_card_last4: card.last4,
    p_livemode: args.p_livemode,
  };
  const outcome = await recordCard(deps, recordArgs);
  return { args: recordArgs, pending: outcome === "unknown_payment" };
}
