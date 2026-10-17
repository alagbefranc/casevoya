import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CICC_PUBLIC_REGISTER_URL,
  CICC_RCIC_SEARCH_URL,
  CICC_REGISTER_RETRIEVED_ON,
  FIRM_SETUP_STEP_LABELS,
  FIRM_SETUP_STEPS,
  SAMPLE_PROOF_LABELS,
  SAMPLE_PROOF_STEPS,
  ciccRegisterHost,
  deriveLicenceCheck,
  firmSetupDbPayload,
  intervalFromSetting,
  licenceCheckInputSchema,
  realClientInviteBlockers,
} from "@/modules/firm-onboarding";

const migration = readFileSync(
  path.resolve(import.meta.dirname, "../supabase/migrations/20261017140700_firm_onboarding.sql"),
  "utf8",
);
const settingsSource = readFileSync(
  path.resolve(import.meta.dirname, "../src/modules/firm-onboarding/settings.ts"),
  "utf8",
);

function enumBody(typeName: string): string[] {
  const match = migration.match(new RegExp(`create type public\\.${typeName} as enum \\(([\\s\\S]*?)\\);`));
  if (!match) throw new Error(`missing enum ${typeName}`);
  return [...match[1].matchAll(/'([A-Za-z0-9_]+)'/g)].map((item) => item[1]);
}

describe("firm onboarding settings", () => {
  it("accepts any days or months count and does not treat one count as special", () => {
    expect(settingsSource).not.toMatch(/\b14\b/);
    expect(intervalFromSetting({ unit: "days", count: 7 })).toEqual({ unit: "days", count: 7 });
    expect(intervalFromSetting({ unit: "days", count: 30 })).toEqual({ unit: "days", count: 30 });
    expect(intervalFromSetting({ unit: "months", count: 2 })).toEqual({ unit: "months", count: 2 });
    expect(intervalFromSetting({ unit: "business_days", count: 1 })).toBeNull();
    expect(intervalFromSetting({ unit: "days", count: 0 })).toBeNull();
  });
});

describe("CICC register evidence", () => {
  it("accepts the register host and rejects other college or government hosts", () => {
    expect(ciccRegisterHost(CICC_PUBLIC_REGISTER_URL)).toBe("register.college-ic.ca");
    expect(ciccRegisterHost(CICC_RCIC_SEARCH_URL)).toBe("register.college-ic.ca");
    expect(ciccRegisterHost("https://www.college-ic.ca/protecting-the-public/find-an-immigration-consultant")).toBeNull();
    expect(ciccRegisterHost("https://college-ic.ca/")).toBeNull();
    expect(ciccRegisterHost("https://canada.ca/en/immigration-refugees-citizenship.html")).toBeNull();
    expect(ciccRegisterHost("https://college-ic.ca.evil.com/Public-Register-EN")).toBeNull();
    expect(ciccRegisterHost("http://register.college-ic.ca/Public-Register-EN")).toBeNull();
  });

  it("locks revoked, suspended, inactive, and not entitled, and keeps a restriction unlocked", () => {
    expect(
      deriveLicenceCheck({
        registerStatus: "active",
        entitlementToPractise: true,
        disciplineSuspended: false,
        disciplineRevoked: false,
        disciplineRestricted: true,
      }),
    ).toEqual({ result: "verified", status: "verified", locksRegulatedAction: false });
    expect(
      deriveLicenceCheck({
        registerStatus: "active",
        entitlementToPractise: false,
        disciplineSuspended: false,
        disciplineRevoked: false,
        disciplineRestricted: false,
      }).locksRegulatedAction,
    ).toBe(true);
    expect(
      deriveLicenceCheck({
        registerStatus: "active",
        entitlementToPractise: false,
        disciplineSuspended: false,
        disciplineRevoked: false,
        disciplineRestricted: false,
      }).status,
    ).toBe("not_entitled");
    for (const status of ["inactive", "suspended", "revoked"] as const) {
      const observation = {
        registerStatus: status === "inactive" ? ("inactive" as const) : ("active" as const),
        entitlementToPractise: true,
        disciplineSuspended: status === "suspended",
        disciplineRevoked: status === "revoked",
        disciplineRestricted: false,
      };
      expect(deriveLicenceCheck(observation).locksRegulatedAction).toBe(true);
      expect(deriveLicenceCheck(observation).status).toBe(status);
    }
  });

  it("records the retrieved register URLs in the migration and does not scrape", () => {
    expect(CICC_REGISTER_RETRIEVED_ON).toBe("2026-10-17");
    expect(migration).toContain(CICC_PUBLIC_REGISTER_URL);
    expect(migration).toContain(CICC_RCIC_SEARCH_URL);
    expect(migration).toContain("2026-10-17");
    expect(migration).toContain("6f67a66ec8943dc1b19a508f0ab64eff0b97958e9639850b005d11e29d4314b7");
    expect(migration).toContain("ba9f947c589eefb8ba1baf9f50cc3e4640e79d8d0d4450b93c11920c5de2781c");
    expect(migration).not.toMatch(/pg_net|http_get|net\.http/);
    expect(migration).not.toContain("R712345");
    expect(migration).not.toMatch(/RISIA_Search/i);
  });

  it("rejects a licence check whose URL is not the register", () => {
    const parsed = licenceCheckInputSchema.safeParse({
      organizationId: "00000000-0000-4000-8000-000000000001",
      credentialId: "00000000-0000-4000-8000-000000000002",
      sourceUrl: "https://www.college-ic.ca/",
      retrievedAt: "2026-10-17T12:40:09Z",
      registerStatus: "active",
      entitlementToPractise: true,
      disciplineSuspended: false,
      disciplineRevoked: false,
      disciplineRestricted: false,
      proofLocator: "proof/synthetic",
      code: "123456",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("setup steps", () => {
  it("matches the SQL enums and the invite blockers", () => {
    expect(enumBody("firm_setup_step")).toEqual([...FIRM_SETUP_STEPS]);
    expect(enumBody("sample_proof_step")).toEqual([...SAMPLE_PROOF_STEPS]);
    expect(FIRM_SETUP_STEPS.map((step) => FIRM_SETUP_STEP_LABELS[step].label)).toEqual([
      "Firm details",
      "Terms and privacy",
      "Where you practise",
      "Your licence",
      "Branding",
      "Calendar and payments",
      "Records and retention",
      "Sample case",
    ]);
    expect(SAMPLE_PROOF_STEPS.map((step) => SAMPLE_PROOF_LABELS[step])).toEqual([
      "Send an intake form",
      "Send a service agreement",
      "Request and review an upload",
      "Schedule a reminder",
      "Issue an invoice",
      "Export the file",
    ]);
    expect(enumBody("licence_type")).toEqual(["RCIC", "RISIA"]);
    expect(
      firmSetupDbPayload({
        step: "firm_details",
        legalName: "Synthetic Legal",
        displayName: "Synthetic",
        locale: "en-CA",
        timezone: "America/Toronto",
        billingContactName: "Synthetic Billing",
        billingContactEmail: "billing@example.com",
      }),
    ).toMatchObject({ legal_name: "Synthetic Legal", locale: "en-CA" });
    expect(
      realClientInviteBlockers({
        verificationStatus: "verified",
        hasVerifiedLicence: true,
        completedSampleSteps: [...SAMPLE_PROOF_STEPS],
        subscriptionStatus: "trial_ended",
      }),
    ).toEqual(["trial_ended"]);
    expect(
      realClientInviteBlockers({
        verificationStatus: "pending_review",
        hasVerifiedLicence: false,
        completedSampleSteps: ["intake"],
      }),
    ).toEqual([
      "firm_unverified",
      "licence_not_verified",
      "sample_step_missing:agreement",
      "sample_step_missing:upload",
      "sample_step_missing:reminder",
      "sample_step_missing:invoice",
      "sample_step_missing:export",
    ]);
  });
});
