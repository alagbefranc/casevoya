/**
 * SEC-01 idle sign-out for staff. Pure helpers shared by the Sheet's idle guard, the activity
 * route and the proxy. The database (public.record_staff_activity) is the authority: it ends a
 * session whose last recorded activity is older than the firm's idle time. The browser timer only
 * warns two minutes before and signs out on time.
 */

import { safeRedirect } from "@/lib/auth/redirect";

/** The warning shows this long before sign-out. */
export const IDLE_WARNING_SECONDS = 120;

/** Activity is sent to the server at most this often while someone is working. */
export const ACTIVITY_BEAT_SECONDS = 60;

/** The firm setting's bounds, as public.set_staff_idle_timeout checks them. */
export const IDLE_MINUTES_MIN = 5;
export const IDLE_MINUTES_MAX = 480;
export const IDLE_MINUTES_DEFAULT = 30;

/** Shared between this person's open Sheet tabs: activity in one keeps the others signed in. */
export const IDLE_STORAGE_KEY = "cv-idle-last-activity";

export type ActivityState =
  | { state: "active"; timeoutMinutes: number; idleSeconds: number }
  | { state: "expired"; timeoutMinutes: number | null }
  | { state: "ended" }
  | { state: "none" };

/** public.record_staff_activity's answer, checked. Anything unexpected reads as "none" (no timer). */
export function readActivityState(value: unknown): ActivityState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { state: "none" };
  const row = value as Record<string, unknown>;
  const minutes = typeof row.timeout_minutes === "number" && Number.isInteger(row.timeout_minutes) ? row.timeout_minutes : null;
  if (row.state === "expired") return { state: "expired", timeoutMinutes: minutes };
  if (row.state === "ended") return { state: "ended" };
  if (row.state === "active" && minutes !== null) {
    const idle = typeof row.idle_seconds === "number" && Number.isFinite(row.idle_seconds) ? Math.max(0, Math.floor(row.idle_seconds)) : 0;
    return { state: "active", timeoutMinutes: minutes, idleSeconds: idle };
  }
  return { state: "none" };
}

/** What the activity route sends and the browser reads: the database's own shape, one contract end to end. */
export type ActivityPayload =
  | { state: "active"; timeout_minutes: number; idle_seconds: number }
  | { state: "expired"; timeout_minutes: number | null }
  | { state: "ended" }
  | { state: "none" };

/**
 * The activity route's answer to the browser. The idle guard reads it with readActivityState, the
 * same reader the route and the proxy use on public.record_staff_activity, so it keeps the
 * database's snake_case keys. (Sending the camelCase ActivityState read as "none" in the browser,
 * so no timer started and the warning never showed: #262.)
 */
export function activityPayload(state: ActivityState): ActivityPayload {
  if (state.state === "active") return { state: "active", timeout_minutes: state.timeoutMinutes, idle_seconds: state.idleSeconds };
  if (state.state === "expired") return { state: "expired", timeout_minutes: state.timeoutMinutes };
  return { state: state.state };
}

export type IdlePhase = { phase: "active" | "warn" | "expired"; secondsLeft: number };

/** Where a person is, from their last activity: working, in the two-minute warning, or past the time. */
export function idlePhase(lastActivityMs: number, nowMs: number, timeoutMinutes: number): IdlePhase {
  const secondsLeft = Math.ceil((lastActivityMs + timeoutMinutes * 60_000 - nowMs) / 1000);
  if (secondsLeft <= 0) return { phase: "expired", secondsLeft: 0 };
  if (secondsLeft <= IDLE_WARNING_SECONDS) return { phase: "warn", secondsLeft };
  return { phase: "active", secondsLeft };
}

/** "1:45" for the warning's countdown. */
export function countdown(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

/** Whole minutes, 5 to 480, or an error in plain words. */
export function readIdleMinutes(value: unknown): { minutes: number } | { error: string } {
  const minutes = typeof value === "number" ? value : Number(String(value ?? "").trim());
  if (!Number.isInteger(minutes) || minutes < IDLE_MINUTES_MIN || minutes > IDLE_MINUTES_MAX) {
    return { error: `Choose a whole number of minutes from ${IDLE_MINUTES_MIN} to ${IDLE_MINUTES_MAX}.` };
  }
  return { minutes };
}

/** The Security tab's line for the setting. */
export function idleDetail(minutes: number | null): string {
  if (minutes === null) return "Staff are signed out after a period with no activity, with a warning 2 minutes before";
  return `${minutes} minutes idle · staff get a warning 2 minutes before Casevoya signs them out`;
}

/**
 * Whether a proxied request is a full page load of the staff area, which counts as activity and is
 * checked against the idle time on the server. Prefetches and in-app data requests are not.
 */
export function isStaffPageLoad(input: { method: string; pathname: string; fetchDest: string | null; prefetch: boolean }): boolean {
  if (input.method !== "GET" || input.prefetch) return false;
  if (input.fetchDest !== "document") return false;
  const path = input.pathname;
  return path === "/sheet" || path.startsWith("/sheet/") || path === "/app" || path.startsWith("/app/");
}

/** Where an idle sign-out lands: sign in again, then back to the page. */
export function idleSignInLocation(next: string): string {
  const safe = safeRedirect(next, "/sheet");
  return `/sign-in?idle=1&next=${encodeURIComponent(safe)}`;
}
