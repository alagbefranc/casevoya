/** Mirrors app.mfa_step_up_satisfied()'s default window. The database is authoritative. */
export const STEP_UP_WINDOW_SECONDS = 15 * 60;

export type AmrEntry = { method?: string; timestamp?: number };

/**
 * True when a TOTP method in the Supabase `amr` claim was verified inside the window.
 * String-only entries have no timestamp, so they do not count.
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
    const seconds = entry.timestamp > 100_000_000_000 ? entry.timestamp / 1000 : entry.timestamp;
    const age = nowSeconds - seconds;
    if (age >= 0 && age <= windowSeconds) return true;
  }
  return false;
}

/** User-facing message. Never pass a database error through. */
export function safeAccessError(message: string): string {
  if (/last firm owner/i.test(message)) {
    return "The firm needs another owner before that change.";
  }
  if (/step-up/i.test(message)) {
    return "Enter a current authenticator code and try again.";
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
  return "That action could not be completed.";
}
