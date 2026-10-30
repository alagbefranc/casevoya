/**
 * Auth cookie settings shared by the three Supabase clients (server, proxy, browser).
 *
 * - secure: on every https request, and in production builds generally (TLS may end before the
 *   app); off only for plain-http localhost and development, where a Secure cookie isn't stored.
 * - sameSite: lax (the email links and the OAuth-style redirects are top-level GETs).
 * - httpOnly stays off: the browser client reads the session (passkeys, realtime, wire.ts).
 * - maxAge: 30 days instead of @supabase/ssr's fixed 400. The refresh token itself does not expire
 *   (supabase/config.toml sets no [auth.sessions] timebox or inactivity timeout), and the cookie is
 *   written again on every token refresh (hourly while in use), so only a browser unused for 30
 *   days has to sign in again. @supabase/ssr overrides a maxAge passed in cookieOptions, so the cap
 *   is applied where the cookies are written (capAuthCookie).
 */

export const AUTH_COOKIE_MAX_AGE = 30 * 24 * 60 * 60;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function authCookieSecure(protocol: string, hostname: string, production = process.env.NODE_ENV === "production"): boolean {
  if (protocol === "https:") return true;
  if (LOCAL_HOSTS.has(hostname.toLowerCase())) return false;
  return production;
}

export function authCookieOptions(secure: boolean) {
  return { secure, sameSite: "lax" as const, path: "/" };
}

/** Caps a written cookie's lifetime at 30 days; a removal (maxAge 0) is left alone. */
export function capAuthCookie<T extends { maxAge?: number }>(options: T): T {
  if (typeof options.maxAge === "number" && options.maxAge > AUTH_COOKIE_MAX_AGE) return { ...options, maxAge: AUTH_COOKIE_MAX_AGE };
  return options;
}
