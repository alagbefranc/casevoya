import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ owner: false, created: 0 }));

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
    rpc: async (name: string) => {
      if (name === "create_organization") {
        state.created += 1;
        state.owner = true;
        return { data: { id: "00000000-0000-4000-8000-000000000001", slug: "maple-test" }, error: null };
      }
      return { data: null, error: null };
    },
  }),
}));

const { createTrialFirm } = await import("@/app/auth/port-actions");

describe("trial firm creation", () => {
  beforeEach(() => {
    state.owner = false;
    state.created = 0;
  });

  it("creates the firm once even when asked again by /setup or a second click", async () => {
    expect(await createTrialFirm({ firmName: "Maple Immigration", sampleMode: true })).toEqual({ ok: true, href: "/setup" });
    expect(await createTrialFirm({ firmName: "Maple Immigration", sampleMode: true })).toEqual({ ok: true, href: "/setup" });
    expect(state.created).toBe(1);
  });
});
