import "server-only";

import { safeAccessError } from "@/lib/auth/step-up";
import type { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import type { Json } from "@/types/database.types";
import { portalError } from "@/modules/portal-invitations/errors";
import type { PortalAcceptPayload } from "@/modules/portal-invitations/types";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type PortalAccepted = {
  organizationId: string | null;
  personId: string | null;
  invitation: unknown;
};

/**
 * public.accept_portal_invitation with the given client. A sign-up or sign-in in the same server
 * action holds its new session on this client, so the acceptance runs as that person.
 */
export async function acceptWithClient(
  supabase: Supabase,
  token: string,
  payload: PortalAcceptPayload,
): Promise<PortalAccepted | { error: string }> {
  const { data, error } = await supabase.rpc("accept_portal_invitation", {
    p_token: token,
    p_payload: payload as Json,
  });
  if (error) return { error: safeAccessError(error.message) };
  const result = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
  if (result.ok !== true) return { error: portalError(typeof result.error === "string" ? result.error : undefined) };
  const organizationId = typeof result.organization_id === "string" && isUuid(result.organization_id) ? result.organization_id : null;
  const personId = typeof result.person_id === "string" && isUuid(result.person_id) ? result.person_id : null;
  return { organizationId, personId, invitation: data };
}
