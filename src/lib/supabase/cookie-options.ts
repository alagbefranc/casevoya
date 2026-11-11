/**
 * Auth cookie settings shared by the three Supabase clients (server, proxy, browser).
 *
 * - secure: always in a production build, so a client-supplied forwarded host or protocol cannot
 *   drop the flag (TLS may end before the app). Outside production, on for https and off for
 *   plain http, including localhost, where a Secure cookie is not stored.
 * - sameSite: lax (the email links and the OAuth-style redirects are top-level GETs).
 * - httpOnly stays off. @supabase/ssr's browser client in this app reads and writes the
 *   session through document.cookie (src/lib/supabase/client.ts). An HttpOnly cookie is
 *   invisible there, and a script cannot set the HttpOnly flag, so the browser client
 *   would see no session and could not persist a new one.
 *   What reads or writes it in the browser:
 *   - src/lib/supabase/client.ts getAll/setAll via document.cookie (every browser client).
 *   - src/components/port/wire.ts watchForLinkSession calls auth.getSession() to notice an
 *     email-confirm session started in another tab.
 *   - src/components/port/wire.ts and src/app/mfa/passkey-button.tsx call signInWithPasskey(),
 *     which stores the new session through that cookie adapter.
 *   - src/components/portal/documents-live.tsx, src/components/portal/own-upload.ts,
 *     src/components/documents/staff-capture.tsx and src/components/sheet/gov-acts.ts build
 *     a browser client to upload to a signed storage URL. The signed URL carries its own
 *     token; the client still initialises auth from the cookie.
 *   There is no realtime .channel() subscriber in this repo. The cookie comment used to
 *   name realtime because the browser client is what would subscribe.
 *   A migration to HttpOnly would keep the server client (cookies() can set HttpOnly) and
 *   stop persisting sessions in the browser client. Passkey sign-in would have to hand the
 *   new tokens to a route that sets the cookie. watchForLinkSession would poll that route
 *   instead of getSession(). A later realtime client would call realtime.setAuth with a
 *   token from the same route and refresh it before expiry. Existing non-HttpOnly cookies
 *   would need one request through the server client to be rewritten. Until that exists,
 *   setting httpOnly here would break passkey sign-in and the cross-tab email confirm.
 * - maxAge: 30 days instead of @supabase/ssr's fixed 400. The refresh token itself does not expire
 *   (supabase/config.toml sets no [auth.sessions] timebox or inactivity timeout), and the cookie is
 *   written again on every token refresh (hourly while in use), so only a browser unused for 30
 *   days has to sign in again. @supabase/ssr overrides a maxAge passed in cookieOptions, so the cap
 *   is applied where the cookies are written (capAuthCookie).
 */

export const AUTH_COOKIE_MAX_AGE = 30 * 24 * 60 * 60;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function authCookieSecure(protocol: string, hostname: string, production = process.env.NODE_ENV === "production"): boolean {
  if (production) return true;
  if (protocol === "https:") return true;
  if (LOCAL_HOSTS.has(hostname.toLowerCase())) return false;
  return false;
}

export function authCookieOptions(secure: boolean) {
  return { secure, sameSite: "lax" as const, path: "/" };
}

/** Caps a written cookie's lifetime at 30 days; a removal (maxAge 0) is left alone. */
export function capAuthCookie<T extends { maxAge?: number }>(options: T): T {
  if (typeof options.maxAge === "number" && options.maxAge > AUTH_COOKIE_MAX_AGE) return { ...options, maxAge: AUTH_COOKIE_MAX_AGE };
  return options;
}
