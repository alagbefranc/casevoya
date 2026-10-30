import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

/** A page the app server fetched and hashed itself (claim-page.ts, submissions/official-page.ts). */
export type FetchedPage = { sha256: string; retrieved_at: string; final_url: string; http_status: number };

type SessionClient = Awaited<ReturnType<typeof createClient>>;

/** The roles public.service_store_page_capture stores a capture for. */
const CAPTURE_ROLES = ["firm_owner", "licensed_consultant", "case_manager"] as const;

/** What an action uses in place of a fetch when the signed-in member can't store a capture. */
export const NOT_FETCHED = { snapshot: null, reason: "Casevoya fetches the page only for the firm’s staff who can store a capture." } as const;

/**
 * Checked before any outbound fetch: is the signed-in user an active member of this firm with a
 * role the capture service accepts? Read through the member's own session (RLS). False on any error.
 */
export async function mayStoreServerCapture(supabase: SessionClient, organizationId: string, userId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("memberships")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .eq("status", "active")
      .in("role", [...CAPTURE_ROLES])
      .limit(1)
      .maybeSingle();
    return !error && Boolean(data);
  } catch {
    return false;
  }
}

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

/**
 * Records whether the issuer's name is in the text of the page the server captured
 * (public.service_record_issuer_name_on_page, service role). Returns the stored value, or null
 * when it couldn't be stored.
 */
export async function storeIssuerNameCheck(input: {
  organizationId: string;
  actorUserId: string;
  issuerId: string;
  nameOnPage: boolean;
}): Promise<boolean | null> {
  if (!process.env.SUPABASE_SECRET_KEY) return null;
  try {
    const { data, error } = await createServiceClient().rpc("service_record_issuer_name_on_page", {
      p_org: input.organizationId,
      p_actor: input.actorUserId,
      p_issuer_id: input.issuerId,
      p_name_on_page: input.nameOnPage,
    });
    if (error || typeof data !== "boolean") return null;
    return data;
  } catch {
    return null;
  }
}
