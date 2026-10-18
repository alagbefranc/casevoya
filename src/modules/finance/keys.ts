/**
 * Stripe keys, TEST MODE ONLY. Casevoya reads only test keys and refuses anything else:
 * a live key (sk_live_, pk_live_, rk_live_) is treated as missing, so payments say they are
 * not configured instead of charging a real card.
 *
 * Server: STRIPE_TEST_SECRET_KEY (sk_test_… or a restricted rk_test_…), STRIPE_WEBHOOK_SECRET (whsec_…).
 * Browser: NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY (pk_test_…).
 */

const SECRET = /^(sk|rk)_test_[A-Za-z0-9]{8,}$/;
const PUBLISHABLE = /^pk_test_[A-Za-z0-9]{8,}$/;
const WEBHOOK = /^whsec_[A-Za-z0-9+/=]{8,}$/;

export type KeyCheck = { ok: true; key: string } | { ok: false; reason: "missing" | "not_test" | "malformed" };

function check(value: string | undefined | null, pattern: RegExp, testPrefixes: string[]): KeyCheck {
  const key = value?.trim() ?? "";
  if (!key) return { ok: false, reason: "missing" };
  if (/_live_/.test(key)) return { ok: false, reason: "not_test" };
  if (!testPrefixes.some((prefix) => key.startsWith(prefix))) return { ok: false, reason: "not_test" };
  if (!pattern.test(key)) return { ok: false, reason: "malformed" };
  return { ok: true, key };
}

export function checkSecretKey(value: string | undefined | null): KeyCheck {
  return check(value, SECRET, ["sk_test_", "rk_test_"]);
}

export function checkPublishableKey(value: string | undefined | null): KeyCheck {
  return check(value, PUBLISHABLE, ["pk_test_"]);
}

export function checkWebhookSecret(value: string | undefined | null): KeyCheck {
  return check(value, WEBHOOK, ["whsec_"]);
}

/** The browser's publishable key, or null when it is missing or not a test key. */
export function publishableKey(): string | null {
  const result = checkPublishableKey(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY);
  return result.ok ? result.key : null;
}
