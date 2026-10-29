import "server-only";
import Stripe from "stripe";
import { activeSecretKey, billingWebhookSecrets, connectWebhookSecrets, secretKeyForMode, stripeMode, type StripeMode } from "@/modules/finance/keys";

/**
 * The platform's Stripe client in the server's mode (src/modules/finance/keys.ts): STRIPE_SECRET_KEY
 * (live in production) wins over STRIPE_TEST_SECRET_KEY (test only). A missing or malformed key
 * returns null so callers say payments are not configured. Uses fetch (Cloudflare Workers has no
 * Node http) and the SDK's pinned API version.
 */
export function stripeServer(): Stripe | null {
  const active = activeSecretKey();
  return active ? client(active.key) : null;
}

/**
 * A client for one mode, when the server holds that mode's key. Used to clean up objects of the
 * other mode, e.g. canceling test-mode payment requests when a test-mode link is disconnected
 * after the server went live.
 */
export function stripeServerForMode(mode: StripeMode): Stripe | null {
  const key = secretKeyForMode(mode);
  return key ? client(key) : null;
}

/** True when the server runs Stripe in live mode. */
export function stripeLive(): boolean {
  return stripeMode() === "live";
}

/** The short label pages show next to Stripe figures: "live" or "test mode". */
export function stripeModeLabel(): string {
  return stripeLive() ? "live" : "test mode";
}

function client(key: string): Stripe {
  return new Stripe(key, {
    httpClient: Stripe.createFetchHttpClient(),
    maxNetworkRetries: 2,
    appInfo: { name: "Casevoya" },
  });
}

/** Signing secrets of the Connect event destinations (/api/stripe/webhook), live and test. */
export function stripeWebhookSecrets(): string[] {
  return connectWebhookSecrets();
}

/** Signing secrets of the platform-account (Casevoya subscription) destinations: /api/stripe/billing. */
export function stripeBillingWebhookSecrets(): string[] {
  return billingWebhookSecrets();
}

/** Web Crypto (SubtleCrypto) signature checks: Workers cannot run Node's synchronous HMAC. */
export const stripeCrypto = Stripe.createSubtleCryptoProvider();
