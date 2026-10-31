import "server-only";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { headers } from "next/headers";
import { createServiceClient } from "@/lib/supabase/service";
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
 * When the Worker context exists (production), a request the binding allows (or with the binding
 * missing or erroring) is also counted exactly in the database (public.request_window_hit,
 * migration 20261031100100) with the same limit and period, keyed by sha256(name:key). Keys of
 * an unknown address skip the database count (they would all share one window).
 *
 * Fails open: without the Worker context (next dev, tests), without the service key, or when the
 * binding or the database errors, the request is allowed. The database counters
 * (app.auth_attempts, the booking and enquiry limits) are the hard layer for their flows.
 */
export type RateLimitName = "RL_AUTH" | "RL_AUTH_EMAIL" | "RL_VERIFY" | "RL_PUBLIC" | "RL_PAYMENT";

/** Limit and period (seconds) of each binding; must match "ratelimits" in wrangler.jsonc. */
export const RATE_LIMITS: Readonly<Record<RateLimitName, { readonly limit: number; readonly period: 10 | 60 | 600 | 3600 }>> = {
  RL_AUTH: { limit: 20, period: 60 },
  RL_AUTH_EMAIL: { limit: 5, period: 60 },
  RL_VERIFY: { limit: 15, period: 60 },
  RL_PUBLIC: { limit: 10, period: 60 },
  RL_PAYMENT: { limit: 10, period: 60 },
};

export const RATE_LIMIT_MESSAGE = "Too many attempts. Please wait a minute and try again.";

/** Seconds the Workers limits ask a client to wait (their period). */
export const RATE_LIMIT_RETRY_SECONDS = 60;

export type RateLimitOutcome = { allowed: true } | { allowed: false; retryAfterSeconds: number };

type Limiter = { limit(options: { key: string }): Promise<{ success: boolean }> };

const ALLOWED: RateLimitOutcome = { allowed: true };

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

/** The Worker env, or null outside a Worker (next dev, tests). */
function workerEnv(name: RateLimitName): Record<string, unknown> | null {
  try {
    const env = getCloudflareContext().env as unknown as Record<string, unknown> | undefined;
    return env && typeof env === "object" ? env : {};
  } catch (error) {
    if (process.env.NODE_ENV === "production") report(name, `context_${error instanceof Error ? error.name : "unknown"}`);
    return null;
  }
}

function binding(name: RateLimitName, env: Record<string, unknown>): Limiter | null {
  const value = env[name] as Limiter | undefined;
  if (value && typeof value.limit === "function") return value;
  report(name, value ? `binding_${typeof value.limit}` : "binding_missing");
  return null;
}

/** A key without a known subject ("unknown", "ip:unknown"). */
function unknownKey(key: string): boolean {
  return key === "unknown" || key.endsWith(":unknown");
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The exact fixed-window count in the database. Fails open. */
async function databaseWindow(name: RateLimitName, key: string): Promise<RateLimitOutcome> {
  if (!process.env.SUPABASE_SECRET_KEY) {
    report(name, "db_no_service_key");
    return ALLOWED;
  }
  try {
    const { limit, period } = RATE_LIMITS[name];
    const { data, error } = await createServiceClient().rpc("request_window_hit", {
      p_bucket: name,
      p_key_hash: await sha256Hex(`${name}:${key}`),
      p_limit: limit,
      p_window_seconds: period,
    });
    if (error) throw new Error("request_window_hit failed");
    const row = (data && typeof data === "object" && !Array.isArray(data) ? data : {}) as {
      allowed?: unknown;
      retry_after_seconds?: unknown;
    };
    if (row.allowed !== false) return ALLOWED;
    const seconds = Number(row.retry_after_seconds);
    return { allowed: false, retryAfterSeconds: Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : period };
  } catch {
    report(name, "db_unavailable");
    return ALLOWED;
  }
}

/** rateLimit with the wait when refused. The key is prefixed with the binding name. */
export async function rateLimitOutcome(name: RateLimitName, key: string): Promise<RateLimitOutcome> {
  const env = workerEnv(name);
  if (!env) return ALLOWED;
  const limiter = binding(name, env);
  if (limiter) {
    try {
      const outcome = await limiter.limit({ key: `${name}:${key}` });
      if (outcome?.success === false) {
        console.warn("rate limited", { binding: name });
        return { allowed: false, retryAfterSeconds: RATE_LIMIT_RETRY_SECONDS };
      }
      report(name, `active_${unknownKey(key) ? "unknown_key" : "keyed"}`);
    } catch (error) {
      report(name, `limit_${error instanceof Error ? error.name : "unknown"}`);
    }
  }
  if (unknownKey(key)) return ALLOWED;
  const counted = await databaseWindow(name, key);
  if (!counted.allowed) console.warn("rate limited", { binding: name, layer: "database" });
  return counted;
}

/** True when the request may go ahead. The key is prefixed with the binding name. */
export async function rateLimit(name: RateLimitName, key: string): Promise<boolean> {
  return (await rateLimitOutcome(name, key)).allowed;
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
