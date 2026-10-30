import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";
import type { Database } from "@/types/database.types";
import { getPublicSupabaseEnv } from "@/lib/env";
import { tenantHeaders } from "@/lib/tenant/context";
import { authCookieOptions, authCookieSecure, capAuthCookie } from "@/lib/supabase/cookie-options";

type Options = {
  /** Active workspace. The database only honours it if the user is an active member. */
  organizationId?: string | null;
  requestId?: string | null;
};

/** Whether this request is https (or production behind TLS), from the forwarded headers. */
async function requestIsSecure(): Promise<boolean> {
  const incoming = await headers();
  const proto = incoming.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  const host = (incoming.get("x-forwarded-host") ?? incoming.get("host") ?? "").split(",")[0]?.trim() ?? "";
  const hostname = host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.replace(/:\d+$/, "");
  return authCookieSecure(proto ? `${proto}:` : "", hostname);
}

/**
 * Server client for Server Components, Server Actions and Route Handlers.
 * Acts as the signed-in user, so Postgres RLS applies to every query.
 * Create one per request.
 */
export async function createClient(options: Options = {}) {
  const cookieStore = await cookies();
  const { url, publishableKey } = getPublicSupabaseEnv();
  const secure = await requestIsSecure();

  return createServerClient<Database>(url, publishableKey, {
    auth: { experimental: { passkey: true } },
    global: { headers: tenantHeaders(options.organizationId, options.requestId) },
    cookieOptions: authCookieOptions(secure),
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options: cookieOptions }) =>
            cookieStore.set(name, value, capAuthCookie(cookieOptions)),
          );
        } catch {
          // Called from a Server Component, which cannot write cookies.
          // The proxy refreshes the session on every request, so this is safe to ignore.
        }
      },
    },
  });
}
