import { createBrowserClient, parseCookieHeader, serializeCookieHeader } from "@supabase/ssr";
import type { Database } from "@/types/database.types";
import { getPublicSupabaseEnv } from "@/lib/env";
import { authCookieOptions, authCookieSecure, capAuthCookie } from "@/lib/supabase/cookie-options";

/**
 * Browser client (publishable key only). Singleton inside @supabase/ssr.
 * Passkeys are enabled. On `@supabase/supabase-js` 2.118 the experimental flag is ignored
 * and passkeys are on by default; it remains so older 2.10x clients still opt in.
 * A passkey login is aal1. Staff assurance is `app.staff_mfa_satisfied()`.
 * Cookies are read and written through document.cookie as @supabase/ssr does by default, with
 * the shared auth cookie settings (lib/supabase/cookie-options.ts).
 */
export function createClient() {
  const { url, publishableKey } = getPublicSupabaseEnv();
  const browser = typeof document !== "undefined";
  const secure = browser ? authCookieSecure(window.location.protocol, window.location.hostname) : true;
  return createBrowserClient<Database>(url, publishableKey, {
    auth: { experimental: { passkey: true } },
    cookieOptions: authCookieOptions(secure),
    cookies: {
      getAll() {
        if (!browser) return [];
        return parseCookieHeader(document.cookie);
      },
      setAll(cookiesToSet) {
        if (!browser) return;
        cookiesToSet.forEach(({ name, value, options }) => {
          document.cookie = serializeCookieHeader(name, value, capAuthCookie(options));
        });
      },
    },
  });
}
