import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { renderAgreementPdf, renderCertificatePdf, SEAL_RENDERER, type FirmLogo } from "@/modules/agreements/pdf-render";
import { parseSealSource, sha256Hex, type SealSource } from "@/modules/agreements/seal-source";
import { FIRM_LOGO_BUCKET, FIRM_LOGO_MAX_BYTES, firmLogoType, ownFirmLogoKey } from "@/modules/firm-onboarding/firm-logo";

type ServiceClient = ReturnType<typeof createServiceClient>;

export type SealResult =
  | { ok: true; attached: boolean; sealedSha256: string }
  | { ok: false; reason: "not_found" | "not_completed" | "unavailable" | "failed" };

function toHex(bytes: Uint8Array): string {
  let hex = "\\x";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

async function firmLogo(service: ServiceClient, source: SealSource): Promise<FirmLogo | null> {
  const key = source.organization.logoLocator ? ownFirmLogoKey(source.organization.logoLocator, source.organization.id) : null;
  if (!key) return null;
  try {
    const { data } = await service.storage.from(FIRM_LOGO_BUCKET).download(key);
    if (!data || data.size > FIRM_LOGO_MAX_BYTES) return null;
    const bytes = new Uint8Array(await data.arrayBuffer());
    const type = firmLogoType(bytes);
    return type ? { bytes, type } : null;
  } catch {
    return null;
  }
}

/**
 * Renders the laid-out sealed PDF and completion certificate for a completed envelope and
 * attaches them once. Safe to call more than once and from concurrent requests: the database
 * keeps the first attach and returns its hash to everyone after. An envelope sealed before the
 * laid-out renderer existed is left exactly as it is.
 *
 * Only call this after the caller has shown the person may read the envelope (or just signed it):
 * it runs with the service role.
 */
export async function sealEnvelope(envelopeId: string, client?: ServiceClient): Promise<SealResult> {
  let service: ServiceClient;
  try {
    service = client ?? createServiceClient();
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  const { data, error } = await service.rpc("agreement_seal_source", { p_envelope_id: envelopeId });
  if (error) return { ok: false, reason: "failed" };
  if (data == null) return { ok: false, reason: "not_found" };
  try {
    const source = parseSealSource(data);
    if (source.envelope.status !== "completed") return { ok: false, reason: "not_completed" };
    if (source.envelope.sealed) {
      const { data: row } = await service.from("signature_envelopes").select("sealed_sha256").eq("id", envelopeId).maybeSingle();
      return row?.sealed_sha256 ? { ok: true, attached: false, sealedSha256: row.sealed_sha256 } : { ok: false, reason: "failed" };
    }
    const logo = await firmLogo(service, source);
    const pdf = await renderAgreementPdf(source, logo);
    const sealedSha256 = await sha256Hex(pdf);
    const certificate = await renderCertificatePdf(source, sealedSha256, logo);
    const { data: attached, error: attachError } = await service.rpc("attach_sealed_agreement", {
      p_envelope_id: envelopeId,
      p_pdf: toHex(pdf),
      p_certificate: toHex(certificate),
      p_renderer: SEAL_RENDERER,
    });
    if (attachError) return { ok: false, reason: "failed" };
    const result = attached && typeof attached === "object" && !Array.isArray(attached) ? attached : {};
    const stored = typeof result.sealed_sha256 === "string" ? result.sealed_sha256 : null;
    if (!stored) return { ok: false, reason: "failed" };
    return { ok: true, attached: result.attached === true, sealedSha256: stored };
  } catch (cause) {
    console.error("agreement seal failed", { envelopeId, message: cause instanceof Error ? cause.message : "unknown" });
    return { ok: false, reason: "failed" };
  }
}
