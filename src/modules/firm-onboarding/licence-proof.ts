/** Licence proof files: what is accepted and where it is kept. Pure; the route and setup use it. */
import { detectMediaType } from "@/modules/documents/files";

export const LICENCE_PROOF_BUCKET = "licence-proofs";
/** A register screenshot or certificate. Matches the bucket's own limit. */
export const LICENCE_PROOF_MAX_BYTES = 10 * 1024 * 1024;

const EXTENSION = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png" } as const;
export type LicenceProofType = keyof typeof EXTENSION;

/** The file's real type from its bytes. Only PDF, JPEG and PNG are accepted. */
export function licenceProofType(bytes: Uint8Array): LicenceProofType | null {
  const type = detectMediaType(bytes);
  return type && type in EXTENSION ? (type as LicenceProofType) : null;
}

export function licenceProofKey(organizationId: string, membershipId: string, fileId: string, type: LicenceProofType): string {
  return `${organizationId}/${membershipId}/${fileId}.${EXTENSION[type]}`;
}

/** What the credential stores: bucket and key. */
export function licenceProofLocator(key: string): string {
  return `${LICENCE_PROOF_BUCKET}/${key}`;
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** The storage key inside a locator, only when it is this membership's own proof file. */
export function ownLicenceProofKey(locator: string, organizationId: string, membershipId: string): string | null {
  const pattern = new RegExp(`^${LICENCE_PROOF_BUCKET}/(${organizationId}/${membershipId}/${UUID}\\.(pdf|jpg|png))$`, "i");
  const match = pattern.exec(locator.trim());
  return match ? match[1] : null;
}

/** A display name for the card: no path, no control characters, at most 120 characters. */
export function proofDisplayName(raw: string | null): string {
  const base = (raw ?? "").split(/[\\/]/).pop() ?? "";
  const clean = base.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 120);
  return clean || "Licence proof";
}
