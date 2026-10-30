/** Mirrors app.mfa_step_up_satisfied()'s default window. The database is authoritative. */
export const STEP_UP_WINDOW_SECONDS = 15 * 60;

/** Supabase rejects an amr timestamp more than a minute ahead of the server clock. */
const FUTURE_SKEW_SECONDS = 60;

export type AmrEntry = { method?: string; timestamp?: number };

function amrTimestampSeconds(timestamp: number): number {
  return timestamp > 100_000_000_000 ? timestamp / 1000 : timestamp;
}

/**
 * True when `method` appears in `amr` with a usable timestamp.
 * `windowSeconds` null means no lower bound (a passkey login stays assured until the token expires).
 * String-only entries have no timestamp, so they do not count.
 */
export function amrMethodIsFresh(
  amr: readonly (AmrEntry | string)[] | null | undefined,
  method: string,
  nowSeconds: number,
  windowSeconds: number | null,
): boolean {
  if (!Array.isArray(amr)) return false;
  for (const entry of amr) {
    if (typeof entry === "string" || entry.method !== method) continue;
    if (typeof entry.timestamp !== "number" || !Number.isFinite(entry.timestamp)) continue;
    const age = nowSeconds - amrTimestampSeconds(entry.timestamp);
    if (age < -FUTURE_SKEW_SECONDS) continue;
    if (windowSeconds == null || age <= windowSeconds) return true;
  }
  return false;
}

/**
 * True when a TOTP method in the Supabase `amr` claim was verified inside the window.
 * String-only entries have no timestamp, so they do not count.
 * A timestamp in the future does not count. The database allows up to 60 seconds of clock skew.
 */
export function totpStepUpIsFresh(
  amr: readonly (AmrEntry | string)[] | null | undefined,
  nowSeconds: number,
  windowSeconds = STEP_UP_WINDOW_SECONDS,
): boolean {
  if (!Array.isArray(amr)) return false;
  for (const entry of amr) {
    if (typeof entry === "string" || entry.method !== "totp") continue;
    if (typeof entry.timestamp !== "number" || !Number.isFinite(entry.timestamp)) continue;
    const age = nowSeconds - amrTimestampSeconds(entry.timestamp);
    if (age >= 0 && age <= windowSeconds) return true;
  }
  return false;
}

/** Passkey login (`amr` method `passkey`) is aal1. It still assures the staff session until the token expires. */
export function passkeySessionActive(
  amr: readonly (AmrEntry | string)[] | null | undefined,
  nowSeconds: number,
): boolean {
  return amrMethodIsFresh(amr, "passkey", nowSeconds, null);
}

/** A passkey verification inside the step-up window satisfies step-up without a TOTP factor. */
export function passkeyStepUpIsFresh(
  amr: readonly (AmrEntry | string)[] | null | undefined,
  nowSeconds: number,
  windowSeconds = STEP_UP_WINDOW_SECONDS,
): boolean {
  return amrMethodIsFresh(amr, "passkey", nowSeconds, windowSeconds);
}

/** User-facing message. Never pass a database error through. */
export function safeAccessError(message: string): string {
  if (/last firm owner/i.test(message)) {
    return "The firm needs another owner before that change.";
  }
  if (/step-up|recovery code/i.test(message)) {
    return "Confirm with your authenticator, passkey, or a recovery code, then try again.";
  }
  if (/aal2/i.test(message)) {
    return "Confirm your authenticator app before continuing.";
  }
  if (/only a firm owner/i.test(message)) {
    return "Only a firm owner can do that.";
  }
  if (/staff roles only/i.test(message)) {
    return "That role cannot be invited from this form.";
  }
  if (/email is invalid/i.test(message)) {
    return "Enter a valid email address.";
  }
  if (/invitation limit reached/i.test(message)) {
    return "Too many invitations were sent recently. Please wait and try again later.";
  }
  return "That action could not be completed.";
}
