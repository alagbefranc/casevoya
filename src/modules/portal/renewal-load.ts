import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { PortalViewer } from "@/modules/portal/load";
import { portalRenewals, type PortalRenewalView } from "@/modules/renewals/present";

/**
 * DEC-02: the signed-in client's renewal reminders (public.portal_renewal_reminders), shown in the
 * portal only and only while their own contact choices allow reminders. A fee appears only while
 * it is in the firm's approved IRCC fee list. None when unreadable.
 */
export async function loadPortalRenewals(viewer: PortalViewer): Promise<PortalRenewalView[]> {
  try {
    const supabase = await createClient({ organizationId: viewer.organizationId });
    const { data, error } = await supabase.rpc("portal_renewal_reminders", { p_org: viewer.organizationId });
    if (error) return [];
    return portalRenewals(data, viewer.organizationName, viewer.timezone);
  } catch {
    return [];
  }
}
