import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import { RATE_LIMIT_MESSAGE, RATE_LIMIT_RETRY_SECONDS, clientIp, rateLimit } from "./rate-limit";

/**
 * The database layer of the auth limits (app.auth_attempts, migration 20261031100000), through
 * the service-role functions public.auth_attempt_check / auth_attempt_record:
 *
 *   password    10 failed sign-ins per email in 15 minutes, then 15 minutes refused
 *   otp          5 failed email codes per email in 15 minutes, then 15 minutes refused
 *   totp         5 failed authenticator codes per user in 15 minutes, then 15 minutes refused
 *   email_send   3 auth emails per address per hour
 *
 * The key is sha256(kind:normalized email or user id); no email is stored. The refusal reads the
 * same whether or not an account exists. Without SUPABASE_SECRET_KEY, or when the call errors,
 * the attempt is allowed (and logged) so a database problem never locks everyone out; the Workers
 * limits in rate-limit.ts still apply.
 */
export type AuthAttemptKind = "password" | "otp" | "totp" | "email_send";

export type AttemptGate = { allowed: true } | { allowed: false; retryAfterSeconds: number };

export async function attemptKeyHash(kind: AuthAttemptKind, subject: string): Promise<string> {
  const data = new TextEncoder().encode(`${kind}:${subject.trim().toLowerCase()}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function usable(subject: string): boolean {
  return Boolean(subject.trim()) && Boolean(process.env.SUPABASE_SECRET_KEY);
}

export async function checkAuthAttempt(kind: AuthAttemptKind, subject: string): Promise<AttemptGate> {
  if (!usable(subject)) return { allowed: true };
  try {
    const { data, error } = await createServiceClient().rpc("auth_attempt_check", {
      p_kind: kind,
      p_key_hash: await attemptKeyHash(kind, subject),
    });
    if (error) throw new Error("auth_attempt_check failed");
    const row = (data && typeof data === "object" && !Array.isArray(data) ? data : {}) as { allowed?: unknown; retry_after_seconds?: unknown };
    if (row.allowed !== false) return { allowed: true };
    const seconds = Number(row.retry_after_seconds);
    return { allowed: false, retryAfterSeconds: Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : RATE_LIMIT_RETRY_SECONDS };
  } catch {
    console.warn("[auth-attempts] check unavailable; attempt allowed", { kind });
    return { allowed: true };
  }
}

/** Records one attempt. password/otp/totp count only failures; every email_send counts. Never throws. */
export async function recordAuthAttempt(kind: AuthAttemptKind, subject: string, failed: boolean): Promise<void> {
  if (!usable(subject)) return;
  try {
    const { error } = await createServiceClient().rpc("auth_attempt_record", {
      p_kind: kind,
      p_key_hash: await attemptKeyHash(kind, subject),
      p_failed: failed,
    });
    if (error) throw new Error("auth_attempt_record failed");
  } catch {
    console.warn("[auth-attempts] record unavailable", { kind });
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
 * the per-recipient hourly limit, and the send is counted.
 */
export async function authEmailGate(email: string): Promise<AttemptGate> {
  if (!(await rateLimit("RL_AUTH_EMAIL", await clientIp()))) return { allowed: false, retryAfterSeconds: RATE_LIMIT_RETRY_SECONDS };
  const gate = await checkAuthAttempt("email_send", email);
  if (!gate.allowed) return gate;
  await recordAuthAttempt("email_send", email, false);
  return { allowed: true };
}

/** Before an authenticator code is checked: the Workers limits per address and per user, then the user's failures. */
export async function totpGate(userId: string | null): Promise<AttemptGate> {
  const ipAllowed = await rateLimit("RL_VERIFY", `ip:${await clientIp()}`);
  const userAllowed = userId ? await rateLimit("RL_VERIFY", `user:${userId}`) : true;
  if (!ipAllowed || !userAllowed) return { allowed: false, retryAfterSeconds: RATE_LIMIT_RETRY_SECONDS };
  return userId ? checkAuthAttempt("totp", userId) : { allowed: true };
}
