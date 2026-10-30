import "server-only";

import { headers } from "next/headers";
import { clientIp } from "@/lib/security/client-address";
import { createServiceClient } from "@/lib/supabase/service";

/** The signer's IP and user agent as this server received them, recorded with each signature. */
export async function clientEvidence(): Promise<{ ip: string; userAgent: string }> {
  const incoming = await headers();
  const ip = clientIp(incoming);
  const userAgent = (incoming.get("user-agent") ?? "unknown").slice(0, 400);
  return { ip, userAgent };
}

/**
 * Records this request's IP and user agent for one signature or decline by `actor` on the
 * envelope (service role; single use, ten minutes). The signer's own session then passes the
 * returned id to sign_agreement / decline_agreement, which read the evidence from the database.
 */
export async function issueSigningEvidence(envelopeId: string, actor: string): Promise<{ id: string } | { error: string }> {
  const evidence = await clientEvidence();
  const { data, error } = await createServiceClient().rpc("issue_signing_evidence", {
    p_envelope_id: envelopeId,
    p_actor: actor,
    p_ip: evidence.ip,
    p_user_agent: evidence.userAgent,
  });
  if (error || typeof data !== "string") return { error: "The signature could not be recorded. Try again." };
  return { id: data };
}
