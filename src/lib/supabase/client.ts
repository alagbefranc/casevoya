import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/database.types";
import { getPublicSupabaseEnv } from "@/lib/env";

/** Browser client (publishable key only). Singleton inside @supabase/ssr. */
export function createClient() {
  const { url, publishableKey } = getPublicSupabaseEnv();
  return createBrowserClient<Database>(url, publishableKey);
}
