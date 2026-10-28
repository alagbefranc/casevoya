import "server-only";
import { createClient } from "@/lib/supabase/server";
import { portalFollowUp, type PortalFollowUp } from "@/modules/decisions/present";
import type { PortalViewer } from "@/modules/portal/load";

/**
 * DEC-02: the client's part of the approval follow-up on one matter, through
 * public.portal_decision_follow_up (their own matters only): the current consultant-approved
 * conditions summary, and the decision documents the firm recorded as delivered. Null when there
 * is nothing. DES-04: an unreadable answer throws, so Home says it couldn't be shown.
 */
export async function loadPortalFollowUp(viewer: PortalViewer, matterId: string | null): Promise<PortalFollowUp | null> {
  if (!matterId) return null;
  const supabase = await createClient({ organizationId: viewer.organizationId });
  const { data, error } = await supabase.rpc("portal_decision_follow_up", { p_org: viewer.organizationId });
  if (error) throw new Error("portal decision follow-up unreadable");
  return portalFollowUp(data, matterId, viewer.organizationName, viewer.timezone);
}
