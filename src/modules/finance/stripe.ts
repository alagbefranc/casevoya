import { createHmac, timingSafeEqual } from "node:crypto";

const TOLERANCE_SECONDS = 300;

export type StripeEnv = Record<string, string | undefined>;

/** Test mode reads only STRIPE_TEST_SECRET_KEY and refuses a live key. */
export function stripeSecretKey(env: StripeEnv): string {
  const mode = (env.STRIPE_MODE ?? "test").trim();
  if (mode === "test") {
    const key = env.STRIPE_TEST_SECRET_KEY ?? "";
    if (!key) throw new Error("STRIPE_TEST_SECRET_KEY is not set.");
    if (key.startsWith("sk_live") || key.startsWith("rk_live")) {
      throw new Error("STRIPE_MODE=test refuses a live secret key.");
    }
    return key;
  }
  if (mode === "live") {
    const key = env.STRIPE_LIVE_SECRET_KEY ?? "";
    if (!key.startsWith("sk_live") && !key.startsWith("rk_live")) {
      throw new Error("STRIPE_MODE=live requires a live secret key.");
    }
    return key;
  }
  throw new Error("STRIPE_MODE must be test or live.");
}

export function stripePublishableKey(env: StripeEnv): string {
  const key = env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";
  if (!key) throw new Error("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is not set.");
  return key;
}

export function stripeWebhookSecret(env: StripeEnv): string {
  const secret = env.STRIPE_WEBHOOK_SECRET ?? "";
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET is not set.");
  return secret;
}

/** Stripe-Signature: t=<unix>,v1=<hex>. Any matching v1 within five minutes is accepted. */
export function verifyStripeSignature(
  payload: string,
  header: string | null,
  secret: string,
  nowSeconds: number,
): boolean {
  if (!header || !secret) return false;
  let timestamp = "";
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq < 1) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name === "t") timestamp = value;
    if (name === "v1" && value) signatures.push(value);
  }
  const issued = Number(timestamp);
  if (!timestamp || !Number.isFinite(issued) || Math.abs(nowSeconds - issued) > TOLERANCE_SECONDS) return false;
  if (signatures.length === 0) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  const expectedBuf = Buffer.from(expected);
  return signatures.some((signature) => {
    const got = Buffer.from(signature);
    if (got.length !== expectedBuf.length) return false;
    return timingSafeEqual(got, expectedBuf);
  });
}

export function signStripePayload(payload: string, secret: string, timestamp: number): string {
  const digest = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  return `t=${timestamp},v1=${digest}`;
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

/**
 * Form-encoded Stripe API call. Checkout sessions and hosted invoices are refused
 * before the request is sent. The secret is chosen by STRIPE_MODE.
 */
export async function stripeForm(input: {
  env: StripeEnv;
  path: string;
  body: Record<string, string>;
  idempotencyKey?: string;
  stripeAccount?: string;
  fetchImpl?: FetchLike;
}): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  if (input.path.includes("/v1/checkout/") || input.path.includes("/v1/invoices")) {
    throw new Error("Stripe Checkout and hosted invoices are not used.");
  }
  const key = stripeSecretKey(input.env);
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(`https://api.stripe.com${input.path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/x-www-form-urlencoded",
      ...(input.idempotencyKey ? { "Idempotency-Key": input.idempotencyKey } : {}),
      ...(input.stripeAccount ? { "Stripe-Account": input.stripeAccount } : {}),
    },
    body: new URLSearchParams(input.body).toString(),
  });
  let json: Record<string, unknown> = {};
  try {
    const parsed = await response.json();
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) json = parsed as Record<string, unknown>;
  } catch {
    json = {};
  }
  return { ok: response.ok, status: response.status, json };
}
