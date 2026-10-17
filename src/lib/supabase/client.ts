import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/database.types";
import { getPublicSupabaseEnv } from "@/lib/env";

/**
 * Browser client (publishable key only). Singleton inside @supabase/ssr.
 * Passkeys are enabled. On `@supabase/supabase-js` 2.118 the experimental flag is ignored
 * and passkeys are on by default; it remains so older 2.10x clients still opt in.
 * A passkey login is aal1. Staff assurance is `app.staff_mfa_satisfied()`.
 */
export function createClient() {
  const { url, publishableKey } = getPublicSupabaseEnv();
  return createBrowserClient<Database>(url, publishableKey, {
    auth: { experimental: { passkey: true } },
  });
}
