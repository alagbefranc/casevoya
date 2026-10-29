/**
 * What the sign-up screens say when Supabase refuses or quietly ignores a sign-up (issue #259).
 * Pure, so the server actions and the screens share it and it is unit tested.
 */

/**
 * An address that already has a confirmed account. Supabase answers that sign-up with a fake
 * success (a user with no identities, no session) and sends nothing, so the screen must not move
 * on to the code step. Links use `[label](/path)`; the screen turns only those into links.
 */
export const EMAIL_TAKEN = "An account already uses this email. [Sign in](/sign-in) instead, or [reset your password](/recovery).";

/** The same, on a staff invitation's screen: the person signs in with the account they have. */
export const STAFF_EMAIL_TAKEN = "An account already uses this email. Enter that account’s password, or [reset your password](/recovery).";

type AuthErrorLike = { message?: string | null; code?: string | null; status?: number | null } | null | undefined;

/** A sign-up for an address that already has a confirmed account (fake success: no identities). */
export function signUpEmailTaken(data: { user?: { identities?: unknown[] | null } | null; session?: unknown } | null | undefined): boolean {
  return Boolean(data?.user && !data.session && Array.isArray(data.user.identities) && data.user.identities.length === 0);
}

/** Supabase refused because the address or this browser asked too often. */
export function isRateLimited(error: AuthErrorLike): boolean {
  if (!error) return false;
  if (error.status === 429) return true;
  if (error.code && /rate_limit|over_.*_limit/i.test(error.code)) return true;
  return /rate limit|too many|only request this after|security purposes/i.test(error.message ?? "");
}

/**
 * Seconds added to the wait Supabase names (issue #261). Supabase rounds its wait down to whole
 * seconds ("after 0 seconds" with up to a second still to go), so counting down only its number
 * re-enabled the button a moment too early.
 */
export const RATE_LIMIT_BUFFER_SECONDS = 2;

/**
 * How long to wait after Supabase's "you can only request this after 16 seconds": its number plus
 * the buffer. "After 0 seconds" is still a wait (issue #261). Null when it names no wait.
 */
export function rateLimitSeconds(error: AuthErrorLike): number | null {
  const match = /after\s+(\d{1,4})\s*seconds?/i.exec(error?.message ?? "");
  if (!match) return null;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds + RATE_LIMIT_BUFFER_SECONDS : null;
}

/** Whole seconds left until `until` (ms since the epoch), never below 0. The countdown runs off this clock, not timer ticks. */
export function secondsLeft(until: number, now: number): number {
  return Math.max(0, Math.ceil((until - now) / 1000));
}

/** The friendly words for a rate limit; with a wait, the screen counts it down. */
export function rateLimitText(seconds: number | null | undefined): string {
  if (seconds == null) return "We just sent you an email. Wait a minute, then try again.";
  if (seconds <= 0) return "You can try again now.";
  return `We just sent you an email. You can try again in ${seconds} ${seconds === 1 ? "second" : "seconds"}.`;
}

export type MessagePart = { text: string } | { text: string; href: string };

/** Splits `[label](/path)` links out of a message. Only same-site paths become links. */
export function messageParts(message: string): MessagePart[] {
  const parts: MessagePart[] = [];
  const link = /\[([^\]]{1,80})\]\((\/[A-Za-z0-9/_?=&.-]*)\)/g;
  let at = 0;
  for (const match of message.matchAll(link)) {
    const start = match.index ?? 0;
    if (start > at) parts.push({ text: message.slice(at, start) });
    if (match[2].startsWith("//")) parts.push({ text: match[1] });
    else parts.push({ text: match[1], href: match[2] });
    at = start + match[0].length;
  }
  if (at < message.length) parts.push({ text: message.slice(at) });
  return parts;
}

/** The message without its link markup, for toasts and screen readers. */
export function plainMessage(message: string): string {
  return messageParts(message).map((part) => part.text).join("");
}
