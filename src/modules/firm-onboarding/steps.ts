import { z } from "zod";

/** Eight firm-setup steps. Labels follow the 2026-10-17 gap check and PRD ORG-01–06, pending the designer HTML. */
export const FIRM_SETUP_STEPS = [
  "firm_profile",
  "offices",
  "jurisdictions",
  "privacy_and_terms",
  "branding",
  "retention",
  "continuity",
  "licence",
] as const;

/** PRD §6 sample-case proofs. Recording one does not claim the later module exists. */
export const SAMPLE_PROOF_STEPS = [
  "intake",
  "agreement",
  "upload",
  "reminder",
  "invoice",
  "export",
] as const;

export type FirmSetupStep = (typeof FIRM_SETUP_STEPS)[number];
export type SampleProofStep = (typeof SAMPLE_PROOF_STEPS)[number];

const email = z.string().trim().toLowerCase().max(320).regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/);

export const firmSetupPayloadSchema = z.discriminatedUnion("step", [
  z.strictObject({
    step: z.literal("firm_profile"),
    legalName: z.string().trim().min(1).max(300),
    displayName: z.string().trim().min(1).max(200),
    locale: z.enum(["en-CA", "fr-CA"]),
    timezone: z.string().trim().regex(/^[A-Za-z_]+(\/[A-Za-z_]+){1,2}$/),
  }),
  z.strictObject({ step: z.literal("offices") }),
  z.strictObject({
    step: z.literal("jurisdictions"),
    codes: z.array(z.string().regex(/^[A-Z]{2}$/)).min(1),
  }),
  z.strictObject({
    step: z.literal("privacy_and_terms"),
    accepted: z.literal(true),
    privacyContactName: z.string().trim().min(1).max(200),
    privacyContactEmail: email,
    billingContactName: z.string().trim().min(1).max(200),
    billingContactEmail: email,
    dpaVersion: z.string().trim().min(1).max(40),
    subscriptionTermsVersion: z.string().trim().min(1).max(40),
  }),
  z.strictObject({
    step: z.literal("branding"),
    acknowledged: z.literal(true),
    logoLocator: z.string().trim().min(1).max(500).optional(),
    accent: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  }),
  z.strictObject({
    step: z.literal("retention"),
    unit: z.literal("years"),
    count: z.number().int().min(1).max(100),
  }),
  z.strictObject({
    step: z.literal("continuity"),
    contactName: z.string().trim().min(1).max(200),
    contactEmail: email,
    successionNote: z.string().trim().min(8).max(2000),
  }),
  z.strictObject({ step: z.literal("licence") }),
]);

export type FirmSetupPayload = z.infer<typeof firmSetupPayloadSchema>;

/** JSON object stored by app.save_firm_setup. Keys match that function, not the camelCase action input. */
export function firmSetupDbPayload(payload: FirmSetupPayload): Record<string, unknown> {
  switch (payload.step) {
    case "firm_profile":
      return {
        legal_name: payload.legalName,
        display_name: payload.displayName,
        locale: payload.locale,
        timezone: payload.timezone,
      };
    case "offices":
      return {};
    case "jurisdictions":
      return { codes: payload.codes };
    case "privacy_and_terms":
      return {
        accepted: "true",
        privacy_contact_name: payload.privacyContactName,
        privacy_contact_email: payload.privacyContactEmail,
        billing_contact_name: payload.billingContactName,
        billing_contact_email: payload.billingContactEmail,
        dpa_version: payload.dpaVersion,
        subscription_terms_version: payload.subscriptionTermsVersion,
      };
    case "branding":
      return {
        acknowledged: "true",
        logo_locator: payload.logoLocator ?? "",
        accent: payload.accent ?? "",
      };
    case "retention":
      return { unit: payload.unit, count: payload.count };
    case "continuity":
      return {
        contact_name: payload.contactName,
        contact_email: payload.contactEmail,
        succession_note: payload.successionNote,
      };
    case "licence":
      return {};
  }
}

export const officeInputSchema = z.strictObject({
  organizationId: z.uuid(),
  label: z.string().trim().min(1).max(120),
  addressLine: z.string().trim().min(1).max(300),
  locality: z.string().trim().min(1).max(120),
  region: z.string().trim().max(80).optional(),
  postalCode: z.string().trim().max(20).optional(),
  countryCode: z.string().trim().regex(/^[A-Za-z]{2}$/),
  isPrimary: z.boolean(),
  code: z.string().trim().min(6).max(12),
});

export const sampleProofInputSchema = z.strictObject({
  organizationId: z.uuid(),
  step: z.enum(SAMPLE_PROOF_STEPS),
  matterId: z.uuid(),
  code: z.string().trim().min(6).max(12),
});

export const reassignInputSchema = z.strictObject({
  organizationId: z.uuid(),
  fromMembershipId: z.uuid(),
  toMembershipId: z.uuid(),
  reason: z.string().trim().min(8).max(500),
  code: z.string().trim().min(6).max(12),
});

export const setupStepInputSchema = z.strictObject({
  organizationId: z.uuid(),
  payload: firmSetupPayloadSchema,
  code: z.string().trim().min(6).max(12),
});

/**
 * Real client invitations stay locked until the firm is verified, a manual
 * good-standing licence is on file, and every sample proof is recorded.
 * Staff invitations are a different path and are not in this list.
 */
export function realClientInviteBlockers(input: {
  verificationStatus: string | null;
  hasVerifiedLicence: boolean;
  completedSampleSteps: readonly string[];
}): string[] {
  if (input.verificationStatus == null) return ["firm_not_found"];
  const blockers: string[] = [];
  if (input.verificationStatus !== "verified") blockers.push("firm_unverified");
  if (!input.hasVerifiedLicence) blockers.push("licence_not_verified");
  for (const step of SAMPLE_PROOF_STEPS) {
    if (!input.completedSampleSteps.includes(step)) blockers.push(`sample_step_missing:${step}`);
  }
  return blockers;
}
