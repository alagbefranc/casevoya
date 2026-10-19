import { beforeEach, describe, expect, it, vi } from "vitest";
import { SIGNUP_LICENCE_CLASSES, signupLicence } from "@/modules/firm-onboarding";

const state = vi.hoisted(() => ({ owner: false, created: 0, calls: [] as { name: string; args: unknown }[] }));

function chain(rows: () => unknown[]) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    limit: async () => ({ data: rows(), error: null }),
  };
  return builder;
}

vi.mock("@/lib/env", () => ({ hasPublicSupabaseEnv: () => true }));
vi.mock("@/modules/email/sync-routing", () => ({ syncClaimedFirmSlug: async () => undefined }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getClaims: async () => ({ data: { claims: { sub: "user-1", email: "owner@example.test" } } }),
      mfa: {
        listFactors: async () => ({ data: { all: [{ id: "f1", factor_type: "totp", status: "verified" }] } }),
        getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: "aal2" } }),
      },
    },
    from: (table: string) => chain(() => (table === "memberships" && state.owner ? [{ id: "m1" }] : [])),
    rpc: async (name: string, args: unknown) => {
      state.calls.push({ name, args });
      if (name === "create_firm_with_licence") {
        state.created += 1;
        state.owner = true;
        return { data: { id: "00000000-0000-4000-8000-000000000001", slug: "maple-test", sample_mode: false }, error: null };
      }
      return { data: null, error: null };
    },
  }),
}));

const { createTrialFirm } = await import("@/app/auth/port-actions");

const LICENSED = { firmName: "Maple Immigration", sampleMode: true, licenceNumber: " r512345 ", licenceClass: "RCIC-IRB" };

describe("trial firm creation", () => {
  beforeEach(() => {
    state.owner = false;
    state.created = 0;
    state.calls = [];
  });

  it("creates the firm once even when asked again by /setup or a second click", async () => {
    expect(await createTrialFirm(LICENSED)).toEqual({ ok: true, href: "/setup" });
    expect(await createTrialFirm(LICENSED)).toEqual({ ok: true, href: "/setup" });
    expect(state.created).toBe(1);
  });

  it("creates it with the owner's licence, live: no sample-mode switch", async () => {
    await createTrialFirm(LICENSED);
    const create = state.calls.find((call) => call.name === "create_firm_with_licence");
    expect(create?.args).toEqual({
      legal_name: "Maple Immigration",
      display_name: "Maple Immigration",
      slug: expect.any(String),
      licence_type: "RCIC",
      college_id: "R512345",
      licence_class: "RCIC-IRB",
    });
    expect(state.calls.map((call) => call.name)).not.toContain("set_sample_mode");
    expect(state.calls.map((call) => call.name)).not.toContain("create_organization");
  });

  it("sends a sign-up without a licence back to the start-trial screen, and refuses an unusable one", async () => {
    expect(await createTrialFirm({ firmName: "Maple Immigration", sampleMode: true })).toEqual({ ok: true, href: "/start-trial" });
    expect(await createTrialFirm({ ...LICENSED, licenceNumber: "R 512 345" })).toEqual({
      ok: false,
      message: "Enter your licence number as it appears on the public register, using letters, digits or hyphens.",
      state: undefined,
    });
    expect(await createTrialFirm({ ...LICENSED, licenceClass: "Lawyer" })).toEqual({ ok: false, message: "Choose your licence class.", state: undefined });
    expect(state.created).toBe(0);
  });
});

describe("the sign-up licence field", () => {
  it("offers the setup screen's licence classes", () => {
    expect([...SIGNUP_LICENCE_CLASSES]).toEqual(["RCIC", "RCIC-IRB"]);
  });

  it("uppercases the number within the College ID storage limit and maps RCIC-IRB to an RCIC licence", () => {
    expect(signupLicence("r512345", "RCIC")).toEqual({ ok: true, collegeId: "R512345", licenceType: "RCIC", licenceClass: "RCIC" });
    expect(signupLicence(" R512345 ", "RCIC-IRB")).toEqual({ ok: true, collegeId: "R512345", licenceType: "RCIC", licenceClass: "RCIC-IRB" });
  });

  it("asks for the number in the Designer's words when it is empty", () => {
    expect(signupLicence("  ", "RCIC")).toEqual({ ok: false, message: "Enter your licence number" });
    expect(signupLicence("R51#345", "RCIC").ok).toBe(false);
    expect(signupLicence("R512345", "").ok).toBe(false);
  });
});
