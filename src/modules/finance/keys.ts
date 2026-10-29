/**
 * Stripe keys and the server's Stripe mode (test or live).
 *
 * Server secret key, first match wins:
 * - STRIPE_SECRET_KEY: the production key. sk_live_… / rk_live_… puts the server in LIVE mode;
 *   a test key (sk_test_… / rk_test_…) here is allowed and means test mode. Set but malformed:
 *   payments say they are not configured (no silent fall back to another key).
 * - STRIPE_TEST_SECRET_KEY: test keys only (a live key here is refused). Local, CI and staging.
 *
 * Browser publishable key: STRIPE_PUBLISHABLE_KEY (read at request time), else
 * NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY (inlined at build). It must be the same mode as the secret
 * key; a mismatch is treated as missing, so a live page never loads with a test key or the reverse.
 *
 * Webhook signing secrets (whsec_…): the test destinations use STRIPE_WEBHOOK_SECRET (Connect) and
 * STRIPE_BILLING_WEBHOOK_SECRET (platform billing); the live destinations use
 * STRIPE_LIVE_WEBHOOK_SECRET and STRIPE_LIVE_BILLING_WEBHOOK_SECRET. A delivery signed by either is
 * verified, and only events of the server's own mode are applied (the other mode is answered 200
 * and ignored, so its destination stays healthy).
 */

export type StripeMode = "test" | "live";

const SECRET = /^(sk|rk)_(test|live)_[A-Za-z0-9]{8,}$/;
const PUBLISHABLE = /^pk_(test|live)_[A-Za-z0-9]{8,}$/;
const WEBHOOK = /^whsec_[A-Za-z0-9+/=]{8,}$/;

export type KeyCheck = { ok: true; key: string; mode: StripeMode } | { ok: false; reason: "missing" | "not_test" | "malformed" | "wrong_kind" };

type Env = Record<string, string | undefined>;

function check(value: string | undefined | null, pattern: RegExp, prefixes: string[], allowLive: boolean): KeyCheck {
  const key = value?.trim() ?? "";
  if (!key) return { ok: false, reason: "missing" };
  const live = /_live_/.test(key);
  if (live && !allowLive) return { ok: false, reason: "not_test" };
  if (!prefixes.some((prefix) => key.startsWith(prefix))) return { ok: false, reason: allowLive ? "wrong_kind" : "not_test" };
  if (!pattern.test(key)) return { ok: false, reason: "malformed" };
  return { ok: true, key, mode: live ? "live" : "test" };
}

/** A test-mode secret key (sk_test_ / rk_test_); live keys are refused. */
export function checkSecretKey(value: string | undefined | null): KeyCheck {
  return check(value, SECRET, ["sk_test_", "rk_test_"], false);
}

/** A secret key of either mode, for STRIPE_SECRET_KEY. */
export function checkAnySecretKey(value: string | undefined | null): KeyCheck {
  return check(value, SECRET, ["sk_test_", "rk_test_", "sk_live_", "rk_live_"], true);
}

/** A test-mode publishable key; live keys are refused. */
export function checkPublishableKey(value: string | undefined | null): KeyCheck {
  return check(value, PUBLISHABLE, ["pk_test_"], false);
}

/** A publishable key of either mode. */
export function checkAnyPublishableKey(value: string | undefined | null): KeyCheck {
  return check(value, PUBLISHABLE, ["pk_test_", "pk_live_"], true);
}

export function checkWebhookSecret(value: string | undefined | null): KeyCheck {
  const result = check(value, WEBHOOK, ["whsec_"], false);
  return result.ok ? { ...result, mode: "test" } : result;
}

/** The secret key the server uses and its mode, or null when payments are not configured. */
export function activeSecretKey(env: Env = process.env): { key: string; mode: StripeMode } | null {
  if (env.STRIPE_SECRET_KEY?.trim()) {
    const main = checkAnySecretKey(env.STRIPE_SECRET_KEY);
    return main.ok ? { key: main.key, mode: main.mode } : null;
  }
  const test = checkSecretKey(env.STRIPE_TEST_SECRET_KEY);
  return test.ok ? { key: test.key, mode: "test" } : null;
}

/** The server's Stripe mode, or null when no usable secret key is set. */
export function stripeMode(env: Env = process.env): StripeMode | null {
  return activeSecretKey(env)?.mode ?? null;
}

/** The secret key for one mode, when the server holds it (test-mode clean-up after going live). */
export function secretKeyForMode(mode: StripeMode, env: Env = process.env): string | null {
  const active = activeSecretKey(env);
  if (active?.mode === mode) return active.key;
  if (mode === "test") {
    const test = checkSecretKey(env.STRIPE_TEST_SECRET_KEY);
    return test.ok ? test.key : null;
  }
  return null;
}

/** The browser's publishable key, or null when it is missing or not the server's mode. */
export function publishableKey(env: Env = process.env): string | null {
  const mode = stripeMode(env);
  if (!mode) return null;
  // NEXT_PUBLIC_ values are inlined at build only when read as process.env.NEXT_PUBLIC_….
  const built = env === process.env ? process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY : env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  const runtime = env.STRIPE_PUBLISHABLE_KEY?.trim() ? env.STRIPE_PUBLISHABLE_KEY : built;
  const result = checkAnyPublishableKey(runtime);
  return result.ok && result.mode === mode ? result.key : null;
}

function webhookSecrets(names: string[], env: Env): string[] {
  const out: string[] = [];
  for (const name of names) {
    const result = checkWebhookSecret(env[name]);
    if (result.ok && !out.includes(result.key)) out.push(result.key);
  }
  return out;
}

/** Signing secrets of the Connect (firm payments) destinations, live first. */
export function connectWebhookSecrets(env: Env = process.env): string[] {
  return webhookSecrets(["STRIPE_LIVE_WEBHOOK_SECRET", "STRIPE_WEBHOOK_SECRET"], env);
}

/** Signing secrets of the platform billing (Casevoya subscription) destinations, live first. */
export function billingWebhookSecrets(env: Env = process.env): string[] {
  return webhookSecrets(["STRIPE_LIVE_BILLING_WEBHOOK_SECRET", "STRIPE_BILLING_WEBHOOK_SECRET"], env);
}
