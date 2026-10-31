import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import { RATE_LIMIT_MESSAGE, RATE_LIMIT_RETRY_SECONDS, clientIp, rateLimit } from "./rate-limit";

/**
 * The database layer of the auth limits (app.auth_attempts, migration 20261031100000), through
 * the service-role functions public.auth_attempt_reserve / auth_attempt_resolve:
 *
 *   password    10 failed sign-ins per (email, address) and 50 per email in 15 minutes
 *   otp          5 failed email codes per (email, address) and 20 per email in 15 minutes
 *   totp         5 failed authenticator codes per user in 15 minutes
 *   email_send   3 auth emails per (recipient, address) and 10 per recipient in an hour
 *
 * An attempt is reserved before Supabase is asked (the reservation counts while in flight) and
 * resolved afterwards: kept as counted for a failure or an email sent, deleted otherwise. The key
 * is sha256(kind:normalized email or user id) and the scope sha256(kind:subject:address key); no
 * email or address is stored. The refusal reads the same whether or not an account exists.
 * Without SUPABASE_SECRET_KEY, or when the call errors, the attempt is allowed (and logged) so a
 * database problem never locks everyone out; the Workers limits in rate-limit.ts still apply.
 */
export type AuthAttemptKind = "password" | "otp" | "totp" | "email_send";

/** `attemptId` is null when nothing was reserved (no service key, or the database call failed). */
export type AttemptGate = { allowed: true; attemptId: string | null } | { allowed: false; retryAfterSeconds: number };

const ALLOWED_UNRESERVED: AttemptGate = { allowed: true, attemptId: null };

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizedSubject(subject: string): string {
  return subject.trim().toLowerCase();
}

export async function attemptKeyHash(kind: AuthAttemptKind, subject: string): Promise<string> {
  return sha256Hex(`${kind}:${normalizedSubject(subject)}`);
}

/** The subject seen from one client address (rate-limit.ts clientIp: an IPv4, an IPv6 /64, or "unknown"). */
export async function attemptScopeHash(kind: AuthAttemptKind, subject: string, address: string): Promise<string> {
  return sha256Hex(`${kind}:${normalizedSubject(subject)}:${address}`);
}

function usable(subject: string): boolean {
  return Boolean(subject.trim()) && Boolean(process.env.SUPABASE_SECRET_KEY);
}

/** Reserves one attempt, or refuses at a limit. Resolve the reservation with resolveAuthAttempt. */
export async function reserveAuthAttempt(kind: AuthAttemptKind, subject: string): Promise<AttemptGate> {
  if (!usable(subject)) return ALLOWED_UNRESERVED;
  try {
    const { data, error } = await createServiceClient().rpc("auth_attempt_reserve", {
      p_kind: kind,
      p_key_hash: await attemptKeyHash(kind, subject),
      p_scope_hash: kind === "totp" ? null : await attemptScopeHash(kind, subject, await clientIp()),
    });
    if (error) throw new Error("auth_attempt_reserve failed");
    const row = (data && typeof data === "object" && !Array.isArray(data) ? data : {}) as {
      allowed?: unknown;
      attempt_id?: unknown;
      retry_after_seconds?: unknown;
    };
    if (row.allowed !== false) return { allowed: true, attemptId: typeof row.attempt_id === "string" ? row.attempt_id : null };
    const seconds = Number(row.retry_after_seconds);
    return { allowed: false, retryAfterSeconds: Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : RATE_LIMIT_RETRY_SECONDS };
  } catch {
    console.warn("[auth-attempts] reserve unavailable; attempt allowed", { kind });
    return ALLOWED_UNRESERVED;
  }
}

/**
 * Resolves a reservation. `counted` true keeps it (a failed password/code, or an auth email that
 * was sent); false deletes it (a success, or no email sent). Never throws.
 */
export async function resolveAuthAttempt(gate: AttemptGate, counted: boolean): Promise<void> {
  if (!gate.allowed || !gate.attemptId) return;
  try {
    const { error } = await createServiceClient().rpc("auth_attempt_resolve", { p_id: gate.attemptId, p_failed: counted });
    if (error) throw new Error("auth_attempt_resolve failed");
  } catch {
    console.warn("[auth-attempts] resolve unavailable");
  }
}

/** The refusal with the time left, in whole minutes past the first. */
export function attemptWaitMessage(seconds: number): string {
  if (!(seconds > RATE_LIMIT_RETRY_SECONDS)) return RATE_LIMIT_MESSAGE;
  const minutes = Math.ceil(seconds / 60);
  return `Too many attempts. Please wait ${minutes} minutes and try again.`;
}

/** Whether Supabase refused the sign-in for a wrong email or password (the only failure counted). */
export function invalidCredentials(error: { message?: string | null; code?: string | null } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "invalid_credentials" || /invalid login credentials/i.test(error.message ?? "");
}

/**
 * Before Supabase is asked to send an auth email to `email`: the per-address Workers limit, then
 * the per-recipient hourly limits. Resolve with resolveAuthAttempt(gate, sent): only an email that
 * was actually sent stays counted.
 */
export async function authEmailGate(email: string): Promise<AttemptGate> {
  if (!(await rateLimit("RL_AUTH_EMAIL", await clientIp()))) return { allowed: false, retryAfterSeconds: RATE_LIMIT_RETRY_SECONDS };
  return reserveAuthAttempt("email_send", email);
}

/**
 * Before an authenticator code is checked: the Workers limits per address and per user, then the
 * user's failures. Resolve with resolveAuthAttempt(gate, codeRejected).
 */
export async function totpGate(userId: string | null): Promise<AttemptGate> {
  const ipAllowed = await rateLimit("RL_VERIFY", `ip:${await clientIp()}`);
  const userAllowed = userId ? await rateLimit("RL_VERIFY", `user:${userId}`) : true;
  if (!ipAllowed || !userAllowed) return { allowed: false, retryAfterSeconds: RATE_LIMIT_RETRY_SECONDS };
  return userId ? reserveAuthAttempt("totp", userId) : ALLOWED_UNRESERVED;
}
