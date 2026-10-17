import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetCookieJar } from "./helpers/next-headers-stub";

type Factor = { id: string; factor_type: "totp"; status: "verified" | "unverified" };

const state = vi.hoisted(() => ({ factors: [] as Factor[], enrolled: 0, unenrolled: [] as string[] }));

vi.mock("@/lib/env", () => ({ hasPublicSupabaseEnv: () => true }));
vi.mock("@/modules/email/sync-routing", () => ({ syncClaimedFirmSlug: async () => undefined }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getClaims: async () => ({ data: { claims: { sub: "user-1" } } }),
      mfa: {
        listFactors: async () => ({ data: { all: state.factors } }),
        unenroll: async ({ factorId }: { factorId: string }) => {
          state.unenrolled.push(factorId);
          state.factors = state.factors.filter((factor) => factor.id !== factorId);
          return { error: null };
        },
        enroll: async () => {
          state.enrolled += 1;
          const id = `00000000-0000-4000-8000-00000000000${state.enrolled}`;
          state.factors.push({ id, factor_type: "totp", status: "unverified" });
          return {
            data: { id, type: "totp", totp: { secret: `SECRETAAAA${state.enrolled}`.replace(/[0-9]/g, "B"), qr_code: "<svg/>" } },
            error: null,
          };
        },
      },
    },
  }),
}));

const { enrollAuthenticator } = await import("@/app/auth/port-actions");

describe("authenticator setup on /mfa", () => {
  beforeEach(() => {
    resetCookieJar();
    state.factors = [];
    state.enrolled = 0;
    state.unenrolled = [];
  });

  it("returns the same pending factor on a reload instead of enrolling again", async () => {
    const first = await enrollAuthenticator();
    const second = await enrollAuthenticator();
    expect(first).not.toBeNull();
    expect(second).toEqual(first);
    expect(state.enrolled).toBe(1);
    expect(state.unenrolled).toEqual([]);
  });

  it("replaces an abandoned setup that this browser does not know about", async () => {
    state.factors = [{ id: "11111111-1111-4111-8111-111111111111", factor_type: "totp", status: "unverified" }];
    const started = await enrollAuthenticator();
    expect(state.unenrolled).toEqual(["11111111-1111-4111-8111-111111111111"]);
    expect(started?.factorId).toBe(state.factors[0].id);
  });

  it("does not start setup for someone who already has a verified authenticator", async () => {
    state.factors = [{ id: "22222222-2222-4222-8222-222222222222", factor_type: "totp", status: "verified" }];
    expect(await enrollAuthenticator()).toBeNull();
    expect(state.enrolled).toBe(0);
    expect(state.unenrolled).toEqual([]);
  });
});
