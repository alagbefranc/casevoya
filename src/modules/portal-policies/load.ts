import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { currentPolicies, POLICY_KINDS, type CurrentPolicies } from "@/modules/portal-policies/defaults";

type Client = Awaited<ReturnType<typeof createClient>>;

/**
 * The firm's current portal terms and privacy notice (the newest published row of each kind,
 * ordered as app.current_portal_policy orders them), read as the signed-in member so row-level
 * security decides. A failed read reports the kind as missing rather than guessing.
 */
export async function loadCurrentPolicies(supabase: Client, organizationId: string): Promise<CurrentPolicies> {
  const reads = await Promise.all(
    POLICY_KINDS.map((kind) =>
      supabase
        .from("portal_policy_documents")
        .select("id, kind, version_label, title, body, published_at")
        .eq("organization_id", organizationId)
        .eq("kind", kind)
        .order("published_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(1),
    ),
  );
  return currentPolicies(reads.flatMap((read) => read.data ?? []));
}
