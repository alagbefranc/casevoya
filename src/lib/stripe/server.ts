import "server-only";
import Stripe from "stripe";
import { checkSecretKey, checkWebhookSecret } from "@/modules/finance/keys";

/**
 * The platform's Stripe client, TEST MODE ONLY. It reads STRIPE_TEST_SECRET_KEY and nothing
 * else; a missing, live or malformed key returns null so callers say payments are not
 * configured. Uses fetch (Cloudflare Workers has no Node http) and the SDK's pinned API version.
 */
export function stripeServer(): Stripe | null {
  const key = checkSecretKey(process.env.STRIPE_TEST_SECRET_KEY);
  if (!key.ok) return null;
  return new Stripe(key.key, {
    httpClient: Stripe.createFetchHttpClient(),
    maxNetworkRetries: 2,
    appInfo: { name: "Casevoya" },
  });
}

export function stripeWebhookSecret(): string | null {
  const secret = checkWebhookSecret(process.env.STRIPE_WEBHOOK_SECRET);
  return secret.ok ? secret.key : null;
}

/** The platform-account (Casevoya subscription) event destination's signing secret: /api/stripe/billing. */
export function stripeBillingWebhookSecret(): string | null {
  const secret = checkWebhookSecret(process.env.STRIPE_BILLING_WEBHOOK_SECRET);
  return secret.ok ? secret.key : null;
}

/** Web Crypto (SubtleCrypto) signature checks: Workers cannot run Node's synchronous HMAC. */
export const stripeCrypto = Stripe.createSubtleCryptoProvider();
