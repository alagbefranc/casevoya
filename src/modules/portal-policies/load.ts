import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { currentPolicies, POLICY_KINDS, type CurrentPolicies } from "@/modules/portal-policies/defaults";
import type { PublicPagesState } from "@/modules/portal-policies/public-pages";

type Client = Awaited<ReturnType<typeof createClient>>;

/**
 * The firm's current portal terms and privacy notice (the newest published row of each kind,
 * ordered as app.current_portal_policy orders them, skipping an unpublished privacy notice), read
 * as the signed-in member so row-level security decides. A failed read reports the kind as missing rather than guessing.
 */
export async function loadCurrentPolicies(supabase: Client, organizationId: string): Promise<CurrentPolicies> {
  // #263-A: an unpublished privacy notice (organizations.privacy_notice_withdrawn_at) is not current.
  const [org, reads] = await Promise.all([
    supabase.from("organizations").select("privacy_notice_withdrawn_at").eq("id", organizationId).maybeSingle(),
    Promise.all(
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
    ),
  ]);
  return currentPolicies(reads.flatMap((read) => read.data ?? []), { privacyWithdrawnAt: org.data?.privacy_notice_withdrawn_at ?? null });
}

/**
 * #263-A: what the firm's public pages need from its privacy notice: whether one is current, the
 * enquiry page switch, how many live booking pages it has and the end of its warning period. Read
 * as the signed-in member; a failed read counts as nothing on, so no banner is invented.
 */
export async function loadPublicPagesState(supabase: Client, organizationId: string, current: CurrentPolicies): Promise<PublicPagesState> {
  const [org, types] = await Promise.all([
    supabase.from("organizations").select("enquiry_page_enabled, privacy_notice_due_at").eq("id", organizationId).maybeSingle(),
    supabase
      .from("booking_event_types")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("is_published", true)
      .eq("is_sample", false)
      .is("archived_at", null),
  ]);
  return {
    noticePublished: current.privacy_notice !== null,
    enquiryOn: org.data?.enquiry_page_enabled === true,
    liveBookingPages: types.error ? 0 : (types.count ?? 0),
    dueAt: org.data?.privacy_notice_due_at ?? null,
  };
}
