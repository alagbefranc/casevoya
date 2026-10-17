import { z } from "zod";
import { hostMatchesAllowlist, officialUrlHost } from "@/modules/content-governance/official-domains";

/** English public-register entry page. Retrieved 2026-10-17. Not a licensee dump. */
export const CICC_PUBLIC_REGISTER_URL = "https://register.college-ic.ca/Public-Register-EN";

/** RCIC search page on the same register. Retrieved 2026-10-17. RISIAs are listed separately; no RISIA search URL is stored. */
export const CICC_RCIC_SEARCH_URL =
  "https://register.college-ic.ca/Public-Register-EN/RCIC_Search.aspx";

export const CICC_REGISTER_HOST = "register.college-ic.ca";

/** Calendar date the two entry pages above were retrieved. */
export const CICC_REGISTER_RETRIEVED_ON = "2026-10-17";

/**
 * Storage limit for a College ID. Uppercase letters, digits, and hyphens, at most 40.
 * This is not a published CICC number format.
 */
export const COLLEGE_ID_PATTERN = /^[A-Z0-9-]{1,40}$/;

export const licenceTypes = ["RCIC", "RISIA"] as const;
export const registerLicenceStatuses = ["active", "inactive"] as const;
export const licenceCheckResults = [
  "verified",
  "not_entitled",
  "inactive",
  "suspended",
  "revoked",
] as const;
export const credentialStatuses = [
  "declared",
  "verified",
  "not_entitled",
  "inactive",
  "suspended",
  "revoked",
] as const;

export type LicenceType = (typeof licenceTypes)[number];
export type RegisterLicenceStatus = (typeof registerLicenceStatuses)[number];
export type LicenceCheckResult = (typeof licenceCheckResults)[number];
export type CredentialStatus = (typeof credentialStatuses)[number];

const LOCKED: readonly CredentialStatus[] = ["revoked", "suspended", "inactive"];

export function licenceStatusBlocks(status: CredentialStatus): boolean {
  return LOCKED.includes(status);
}

/**
 * Host of a licence-evidence URL, or null.
 * The host must be register.college-ic.ca and still match the official-source allowlist.
 * www.college-ic.ca and canada.ca are not a licence check.
 */
export function ciccRegisterHost(raw: string): string | null {
  const host = officialUrlHost(raw);
  if (host !== CICC_REGISTER_HOST || !hostMatchesAllowlist(host)) return null;
  return host;
}

export type RegisterObservation = {
  registerStatus: RegisterLicenceStatus;
  entitlementToPractise: boolean;
  disciplineSuspended: boolean;
  disciplineRevoked: boolean;
  disciplineRestricted: boolean;
};

export type DerivedLicenceCheck = {
  result: LicenceCheckResult;
  status: CredentialStatus;
  locksRegulatedAction: boolean;
};

/**
 * Precedence: revoked, then suspended, then inactive, then not entitled, otherwise verified.
 * disciplineRestricted is kept on the record and does not change the result.
 * Must stay aligned with app.record_licence_check.
 */
export function deriveLicenceCheck(observation: RegisterObservation): DerivedLicenceCheck {
  let status: CredentialStatus;
  if (observation.disciplineRevoked) status = "revoked";
  else if (observation.disciplineSuspended) status = "suspended";
  else if (observation.registerStatus === "inactive") status = "inactive";
  else if (!observation.entitlementToPractise) status = "not_entitled";
  else status = "verified";
  return {
    result: status,
    status,
    locksRegulatedAction: licenceStatusBlocks(status),
  };
}

export function normalizeCollegeId(raw: string): string | null {
  const collegeId = raw.trim().toUpperCase();
  return COLLEGE_ID_PATTERN.test(collegeId) ? collegeId : null;
}

const proofLocator = z.string().trim().min(1).max(500);

export const declareCredentialInputSchema = z.strictObject({
  organizationId: z.uuid(),
  membershipId: z.uuid(),
  licenceType: z.enum(licenceTypes),
  collegeId: z.string().trim().min(1).max(40),
  scopeNote: z.string().trim().max(1000).optional(),
  proofLocator,
  code: z.string().trim().min(6).max(12),
});

export const licenceCheckInputSchema = z
  .strictObject({
    organizationId: z.uuid(),
    credentialId: z.uuid(),
    sourceUrl: z.string().min(12).max(2000),
    retrievedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/),
    registerStatus: z.enum(registerLicenceStatuses),
    entitlementToPractise: z.boolean(),
    disciplineSuspended: z.boolean(),
    disciplineRevoked: z.boolean(),
    disciplineRestricted: z.boolean(),
    proofLocator,
    notes: z.string().trim().max(500).optional(),
    code: z.string().trim().min(6).max(12),
  })
  .superRefine((value, ctx) => {
    if (ciccRegisterHost(value.sourceUrl) === null) {
      ctx.addIssue({
        code: "custom",
        path: ["sourceUrl"],
        message: "licence evidence must cite register.college-ic.ca",
      });
    }
  });

export type DeclareCredentialInput = z.infer<typeof declareCredentialInputSchema>;
export type LicenceCheckInput = z.infer<typeof licenceCheckInputSchema>;
