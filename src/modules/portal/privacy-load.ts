import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { PortalViewer } from "./load";
import { portalPrivacyNotices, type PrivacyNotice } from "./privacy-notices";

/**
 * SEC-06: the signed-in person's privacy request notices on Home (an extension, or records ready to
 * download). Showing an extension records when they first saw it (the notice proof).
 */
export async function loadPortalPrivacyNotices(viewer: PortalViewer): Promise<PrivacyNotice[]> {
  try {
    const supabase = await createClient({ organizationId: viewer.organizationId });
    const { data, error } = await supabase.rpc("privacy_requests_for_me", { p_org: viewer.organizationId });
    if (error) return [];
    const notices = portalPrivacyNotices(data, viewer.organizationName, viewer.timezone);
    if (notices.some((notice) => !notice.download)) await supabase.rpc("mark_privacy_notices_seen", { p_org: viewer.organizationId });
    return notices;
  } catch {
    return [];
  }
}
