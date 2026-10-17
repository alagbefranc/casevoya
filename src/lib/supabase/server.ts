import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/types/database.types";
import { getPublicSupabaseEnv } from "@/lib/env";
import { tenantHeaders } from "@/lib/tenant/context";

type Options = {
  /** Active workspace. The database only honours it if the user is an active member. */
  organizationId?: string | null;
  requestId?: string | null;
};

/**
 * Server client for Server Components, Server Actions and Route Handlers.
 * Acts as the signed-in user, so Postgres RLS applies to every query.
 * Create one per request.
 */
export async function createClient(options: Options = {}) {
  const cookieStore = await cookies();
  const { url, publishableKey } = getPublicSupabaseEnv();

  return createServerClient<Database>(url, publishableKey, {
    auth: { experimental: { passkey: true } },
    global: { headers: tenantHeaders(options.organizationId, options.requestId) },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options: cookieOptions }) =>
            cookieStore.set(name, value, cookieOptions),
          );
        } catch {
          // Called from a Server Component, which cannot write cookies.
          // The proxy refreshes the session on every request, so this is safe to ignore.
        }
      },
    },
  });
}
