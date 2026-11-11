/**
 * Response headers for pages and API routes. Cloudflare already sends
 * Strict-Transport-Security: max-age=15552000 and X-Content-Type-Options: nosniff
 * at the zone. These values match that edge policy so a second header does not disagree.
 * No preload and no includeSubDomains.
 *
 * Referrer-Policy defaults to strict-origin-when-cross-origin. A response that already
 * asked for no-referrer (invitation, recovery, and booking links carry a secret in the
 * address) keeps it.
 *
 * Camera and microphone are allowed on the LiveKit call page only (`/call` and `/call/…`),
 * and only for this origin. Every other response disables them.
 */

export const NOSNIFF = "nosniff";
export const HSTS = "max-age=15552000";
export const REFERRER_POLICY = "strict-origin-when-cross-origin";

export function isCallPath(pathname: string): boolean {
  return pathname === "/call" || pathname.startsWith("/call/");
}

/** Permissions-Policy: camera and microphone for the call page, neither anywhere else. */
export function permissionsPolicy(pathname: string): string {
  const allow = isCallPath(pathname) ? "self" : "";
  return `camera=(${allow}), microphone=(${allow})`;
}

export function applySecurityHeaders(headers: Headers, pathname: string): void {
  headers.set("X-Content-Type-Options", NOSNIFF);
  headers.set("Strict-Transport-Security", HSTS);
  if (headers.get("Referrer-Policy") !== "no-referrer") headers.set("Referrer-Policy", REFERRER_POLICY);
  headers.set("Permissions-Policy", permissionsPolicy(pathname));
}
