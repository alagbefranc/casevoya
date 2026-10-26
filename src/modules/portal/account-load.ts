import "server-only";
import { createClient } from "@/lib/supabase/server";
import { readConsents, readTwoStep, type PortalAccountExtras } from "@/modules/portal/account-present";
import type { PortalViewer } from "@/modules/portal/load";

/** /portal/account: the client's optional consents and two-step state, read as the client. */
export async function loadPortalAccountExtras(viewer: PortalViewer): Promise<PortalAccountExtras> {
  if (!viewer.person) return { consents: null, twoStep: null };
  const supabase = await createClient({ organizationId: viewer.organizationId });
  const [consents, twoStep] = await Promise.all([supabase.rpc("my_consents"), supabase.rpc("my_two_step_state")]);
  return { consents: consents.error ? null : readConsents(consents.data), twoStep: twoStep.error ? null : readTwoStep(twoStep.data) };
}
