import { z } from "zod";

/**
 * Designer firm-setup screen, reviewed 2026-10-17. Order and labels match that
 * screen. The HTML is a design reference and is not stored in this repo.
 */
export const FIRM_SETUP_STEPS = [
  "firm_details",
  "terms_and_privacy",
  "jurisdictions",
  "licence",
  "branding",
  "calendar_and_payments",
  "records_and_retention",
  "sample_case",
] as const;

export const FIRM_SETUP_STEP_LABELS: Record<(typeof FIRM_SETUP_STEPS)[number], { label: string; hint: string }> = {
  firm_details: { label: "Firm details", hint: "Name, office, contacts" },
  terms_and_privacy: { label: "Terms and privacy", hint: "Subscription, data processing" },
  jurisdictions: { label: "Where you practise", hint: "Jurisdictions" },
  licence: { label: "Your licence", hint: "Regulator and proof" },
  branding: { label: "Branding", hint: "Logo and colour" },
  calendar_and_payments: { label: "Calendar and payments", hint: "Connections" },
  records_and_retention: { label: "Records and retention", hint: "How long you keep files" },
  sample_case: { label: "Sample case", hint: "Try it before real clients" },
};

/**
 * The six key steps on the Sample case screen. Real client invitations also
 * need a good-standing licence check, and they stay locked after trial_ended.
 * Recording one does not claim the later module exists.
 */
export const SAMPLE_PROOF_STEPS = [
  "intake",
  "agreement",
  "upload",
  "reminder",
  "invoice",
  "export",
] as const;

export const SAMPLE_PROOF_LABELS: Record<(typeof SAMPLE_PROOF_STEPS)[number], string> = {
  intake: "Send an intake form",
  agreement: "Send a service agreement",
  upload: "Request and review an upload",
  reminder: "Schedule a reminder",
  invoice: "Issue an invoice",
  export: "Export the file",
};

export type FirmSetupStep = (typeof FIRM_SETUP_STEPS)[number];
export type SampleProofStep = (typeof SAMPLE_PROOF_STEPS)[number];

const email = z.string().trim().toLowerCase().max(320).regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/);

export const firmSetupPayloadSchema = z.discriminatedUnion("step", [
  z.strictObject({
    step: z.literal("firm_details"),
    legalName: z.string().trim().min(1).max(300),
    displayName: z.string().trim().min(1).max(200),
    locale: z.enum(["en-CA", "fr-CA"]),
    timezone: z.string().trim().regex(/^[A-Za-z_]+(\/[A-Za-z_]+){1,2}$/),
    billingContactName: z.string().trim().min(1).max(200),
    billingContactEmail: email,
  }),
  z.strictObject({
    step: z.literal("terms_and_privacy"),
    subscriptionTermsAccepted: z.literal(true),
    // Optional until a DPA is published (see legal.ts); recorded only when actually accepted.
    dpaAccepted: z.boolean(),
    privacyContactName: z.string().trim().min(1).max(200),
    privacyContactEmail: email,
    dpaVersion: z.string().trim().min(1).max(40).optional(),
    subscriptionTermsVersion: z.string().trim().min(1).max(40),
  }),
  z.strictObject({
    step: z.literal("jurisdictions"),
    codes: z.array(z.string().regex(/^[A-Z]{2}$/)).min(1),
  }),
  z.strictObject({ step: z.literal("licence") }),
  z.strictObject({
    step: z.literal("branding"),
    acknowledged: z.literal(true),
    logoLocator: z.string().trim().min(1).max(500).optional(),
    accent: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  }),
  z.strictObject({
    step: z.literal("calendar_and_payments"),
    acknowledged: z.literal(true),
  }),
  z.strictObject({
    step: z.literal("records_and_retention"),
    unit: z.literal("years"),
    count: z.number().int().min(1).max(100),
  }),
  z.strictObject({
    step: z.literal("sample_case"),
    acknowledged: z.literal(true),
  }),
]);

export type FirmSetupPayload = z.infer<typeof firmSetupPayloadSchema>;

/** JSON object stored by app.save_firm_setup. Keys match that function, not the camelCase action input. */
export function firmSetupDbPayload(payload: FirmSetupPayload): Record<string, unknown> {
  switch (payload.step) {
    case "firm_details":
      return {
        legal_name: payload.legalName,
        display_name: payload.displayName,
        locale: payload.locale,
        timezone: payload.timezone,
        billing_contact_name: payload.billingContactName,
        billing_contact_email: payload.billingContactEmail,
      };
    case "terms_and_privacy":
      return {
        subscription_terms_accepted: "true",
        privacy_contact_name: payload.privacyContactName,
        privacy_contact_email: payload.privacyContactEmail,
        subscription_terms_version: payload.subscriptionTermsVersion,
        ...(payload.dpaAccepted && payload.dpaVersion ? { dpa_accepted: "true", dpa_version: payload.dpaVersion } : {}),
      };
    case "jurisdictions":
      return { codes: payload.codes };
    case "licence":
      return {};
    case "branding":
      return {
        acknowledged: "true",
        logo_locator: payload.logoLocator ?? "",
        accent: payload.accent ?? "",
      };
    case "calendar_and_payments":
      return { acknowledged: "true" };
    case "records_and_retention":
      return { unit: payload.unit, count: payload.count };
    case "sample_case":
      return { acknowledged: "true" };
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
 * Real client invitations (decision 2026-10-19): a declared licence on the firm owner that is not
 * revoked, suspended, inactive or not entitled is enough. No practice steps and no wait for a
 * register check. A restricted firm and an ended trial still block. Same order as
 * app.real_client_invite_blockers. Staff invitations are a different path.
 */
export function realClientInviteBlockers(input: {
  verificationStatus: string | null;
  /** The firm owner's licence: none on file, one that is blocked, or one in good standing or awaiting the list check. */
  ownerLicence: "missing" | "blocked" | "ok";
  subscriptionStatus?: string | null;
}): string[] {
  if (input.verificationStatus == null) return ["firm_not_found"];
  const blockers: string[] = [];
  if (input.verificationStatus === "restricted") blockers.push("firm_restricted");
  if (input.ownerLicence === "missing") blockers.push("owner_licence_missing");
  else if (input.ownerLicence === "blocked") blockers.push("owner_licence_blocked");
  if (input.subscriptionStatus === "trial_ended") blockers.push("trial_ended");
  return blockers;
}
