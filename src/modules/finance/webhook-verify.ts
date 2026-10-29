import Stripe from "stripe";

/** One signing secret, or several (the live and the test destination of the same route). */
export type WebhookSecrets = string | string[] | null;

export function secretList(secret: WebhookSecrets): string[] {
  if (!secret) return [];
  return (Array.isArray(secret) ? secret : [secret]).filter((value) => typeof value === "string" && value.length > 0);
}

/**
 * Verifies a delivery against each secret in turn and returns the event, or null when no secret
 * matches (or the timestamp is outside Stripe's tolerance).
 */
export async function verifyStripeEvent(body: string, signature: string, secrets: string[], cryptoProvider?: Stripe.CryptoProvider): Promise<Stripe.Event | null> {
  const provider = cryptoProvider ?? Stripe.createSubtleCryptoProvider();
  for (const secret of secrets) {
    try {
      return await Stripe.webhooks.constructEventAsync(body, signature, secret, undefined, provider);
    } catch {
      // try the next destination's secret
    }
  }
  return null;
}
