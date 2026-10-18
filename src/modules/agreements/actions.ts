"use server";

import { agreementError } from "@/modules/agreements/errors";
import { clientEvidence } from "@/modules/agreements/evidence";
import { sealEnvelope } from "@/modules/agreements/seal";
import { verifyTotpCode } from "@/lib/auth/verify-totp";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";

async function sessionFor(organizationId: string, code: string | null) {
  if (!isUuid(organizationId)) return { error: "Choose a firm." as const };
  const supabase = await createClient({ organizationId });
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return { error: "Sign in first." as const };
  if (code != null && code !== "") {
    const verified = await verifyTotpCode(supabase, code);
    if (!verified.ok) return { error: verified.error };
  }
  return { supabase };
}

export async function signAgreement(input: {
  organizationId: string;
  envelopeId: string;
  consent: boolean;
  code?: string | null;
}) {
  if (!isUuid(input.envelopeId)) return { error: "Choose the agreement to sign." };
  if (!input.consent) return { error: "Confirm that you agree to sign electronically." };
  const session = await sessionFor(input.organizationId, input.code ?? null);
  if ("error" in session) return { error: session.error };
  const evidence = await clientEvidence();
  const { data, error } = await session.supabase.rpc("sign_agreement", {
    p_envelope_id: input.envelopeId,
    p_consent: true,
    p_idempotency_key: `portal-sign-${input.envelopeId}-${crypto.randomUUID()}`,
    p_ip: evidence.ip,
    p_user_agent: evidence.userAgent,
  });
  if (error) return { error: agreementError(error.message) };
  const status = data && typeof data === "object" && !Array.isArray(data) ? data.status : null;
  if (status === "completed") {
    // The last signature completes the envelope; the laid-out sealed PDF is rendered here and
    // attached once. If this fails, the first download renders and attaches it instead.
    await sealEnvelope(input.envelopeId);
  }
  return { status: typeof status === "string" ? status : "signed" };
}

export async function declineAgreement(input: { organizationId: string; envelopeId: string; code?: string | null }) {
  if (!isUuid(input.envelopeId)) return { error: "Choose the agreement to decline." };
  const session = await sessionFor(input.organizationId, input.code ?? null);
  if ("error" in session) return { error: session.error };
  const evidence = await clientEvidence();
  const { error } = await session.supabase.rpc("decline_agreement", {
    p_envelope_id: input.envelopeId,
    p_idempotency_key: `portal-decline-${input.envelopeId}-${crypto.randomUUID()}`,
    p_ip: evidence.ip,
    p_user_agent: evidence.userAgent,
  });
  if (error) return { error: agreementError(error.message) };
  return { status: "declined" };
}

export async function acceptQuote(input: { organizationId: string; agreementId: string }) {
  if (!isUuid(input.agreementId)) return { error: "Choose the quote." };
  const session = await sessionFor(input.organizationId, null);
  if ("error" in session) return { error: session.error };
  const { error } = await session.supabase.rpc("accept_quote", { p_agreement_id: input.agreementId });
  if (error) return { error: agreementError(error.message) };
  return { status: "accepted" };
}
