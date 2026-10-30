import "server-only";
import { createServiceClient } from "@/lib/supabase/service";

/** A page the app server fetched and hashed itself (claim-page.ts, submissions/official-page.ts). */
export type FetchedPage = { sha256: string; retrieved_at: string; final_url: string; http_status: number };

/**
 * Stores a page Casevoya's server fetched as a server capture (public.service_store_page_capture,
 * service role) for a signed-in staff member of the firm, and returns the p_snapshot payload that
 * public.add_rule_claim and public.propose_submission_requirement accept. The database only treats
 * a named server capture as captured; anything else needs the reviewer's attestation. Returns null
 * when the capture can't be stored (no service key, or the database refused it).
 */
export async function storeServerCapture(input: {
  organizationId: string;
  actorUserId: string;
  sourceUrl: string;
  title: string | null;
  page: FetchedPage;
  dates?: { modifiedOn?: string | null; currentTo?: string | null };
}): Promise<{ snapshot_id: string } | null> {
  if (!process.env.SUPABASE_SECRET_KEY) return null;
  try {
    const { data, error } = await createServiceClient().rpc("service_store_page_capture", {
      p_org: input.organizationId,
      p_actor: input.actorUserId,
      p_source_url: input.sourceUrl,
      p_title: input.title as string,
      p_snapshot: {
        ...input.page,
        modified_on: input.dates?.modifiedOn ?? null,
        current_to: input.dates?.currentTo ?? null,
      },
    });
    if (error || typeof data !== "string") return null;
    return { snapshot_id: data };
  } catch {
    return null;
  }
}
