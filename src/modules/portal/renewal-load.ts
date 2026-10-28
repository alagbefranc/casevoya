import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { PortalViewer } from "@/modules/portal/load";
import { portalRenewals, type PortalRenewalView } from "@/modules/renewals/present";

/**
 * DEC-02: the signed-in client's renewal reminders (public.portal_renewal_reminders), shown in the
 * portal only and only while their own contact choices allow reminders. A fee appears only while
 * it is in the firm's approved IRCC fee list. DES-04: an unreadable answer throws, so Home says the
 * reminders couldn't be shown instead of showing none; each reminder says when its official
 * timing or fee may be out of date.
 */
export async function loadPortalRenewals(viewer: PortalViewer): Promise<PortalRenewalView[]> {
  const supabase = await createClient({ organizationId: viewer.organizationId });
  const { data, error } = await supabase.rpc("portal_renewal_reminders", { p_org: viewer.organizationId });
  if (error) throw new Error("portal renewal reminders unreadable");
  return portalRenewals(data, viewer.organizationName, viewer.timezone, new Date());
}
