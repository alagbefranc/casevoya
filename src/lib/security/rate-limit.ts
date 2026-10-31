import "server-only";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { headers } from "next/headers";
import { clientAddress, ipKey, isIpAddress } from "./client-address";

/**
 * App-owned request limits on top of Supabase Auth's own, through the Workers Rate Limiting
 * bindings in wrangler.jsonc (per Cloudflare location, approximate). Auth calls run on this
 * server, so Supabase sees Cloudflare's addresses, not the visitor's: these limits key on the
 * visitor's address (cf-connecting-ip) or the signed-in user.
 *
 *   RL_AUTH        20/min per address   password sign-in, sign-up, invitation sign-in/sign-up
 *   RL_AUTH_EMAIL   5/min per address   anything that makes Supabase send an email
 *   RL_VERIFY      15/min per address and per user   email codes, invitation codes, TOTP
 *   RL_PUBLIC      10/min per address   public booking hold and enquiry POSTs
 *   RL_PAYMENT     10/min per user      invoice card payment, subscription checkout and portal
 *
 * Fails open: without the binding (next dev, tests) or when it errors, the request is allowed.
 * The database counters (app.auth_attempts, the booking and enquiry limits) are the hard layer.
 */
export type RateLimitName = "RL_AUTH" | "RL_AUTH_EMAIL" | "RL_VERIFY" | "RL_PUBLIC" | "RL_PAYMENT";

export const RATE_LIMIT_MESSAGE = "Too many attempts. Please wait a minute and try again.";

/** Seconds the Workers limits ask a client to wait (their period). */
export const RATE_LIMIT_RETRY_SECONDS = 60;

type Limiter = { limit(options: { key: string }): Promise<{ success: boolean }> };

const reported = new Set<string>();

/** Logs once per isolate why a limit could not be applied (no secrets or keys are logged). */
function report(name: RateLimitName, reason: string): void {
  if (reason.startsWith("active_")) {
    if (reported.has(`${name}:${reason}`)) return;
    reported.add(`${name}:${reason}`);
    console.info("rate limit active", { binding: name, reason });
    return;
  }
  if (reported.has(`${name}:${reason}`)) return;
  reported.add(`${name}:${reason}`);
  console.warn("rate limit not applied; request allowed", { binding: name, reason });
}

function binding(name: RateLimitName): Limiter | null {
  try {
    const env = getCloudflareContext().env as unknown as Record<string, unknown>;
    const value = env?.[name] as Limiter | undefined;
    if (value && typeof value.limit === "function") return value;
    if (process.env.NODE_ENV === "production") report(name, value ? `binding_${typeof value.limit}` : "binding_missing");
    return null;
  } catch (error) {
    if (process.env.NODE_ENV === "production") report(name, `context_${error instanceof Error ? error.name : "unknown"}`);
    return null;
  }
}

/** True when the request may go ahead. The key is prefixed with the binding name. */
export async function rateLimit(name: RateLimitName, key: string): Promise<boolean> {
  const limiter = binding(name);
  if (!limiter) return true;
  try {
    const outcome = await limiter.limit({ key: `${name}:${key}` });
    const allowed = outcome?.success !== false;
    if (!allowed) console.warn("rate limited", { binding: name });
    else report(name, `active_${key === "unknown" ? "unknown_key" : "keyed"}`);
    return allowed;
  } catch (error) {
    report(name, `limit_${error instanceof Error ? error.name : "unknown"}`);
    return true;
  }
}

/** The visitor's address as a limit key (IPv6 as its /64), or "unknown". */
export function requestIp(source: Pick<Headers, "get">): string {
  const first = clientAddress(source)?.split(",")[0]?.trim() ?? "";
  return isIpAddress(first) ? ipKey(first) : "unknown";
}

/** requestIp for a server action, from the incoming request's headers. */
export async function clientIp(): Promise<string> {
  try {
    const incoming = await headers();
    return incoming && typeof incoming.get === "function" ? requestIp(incoming) : "unknown";
  } catch {
    return "unknown";
  }
}

/** A JSON 429 with Retry-After, for route handlers. */
export function tooManyRequests(retryAfterSeconds = RATE_LIMIT_RETRY_SECONDS): Response {
  const seconds = Math.max(1, Math.ceil(retryAfterSeconds));
  return new Response(JSON.stringify({ error: "rate_limited", message: RATE_LIMIT_MESSAGE }), {
    status: 429,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "Retry-After": String(seconds) },
  });
}
