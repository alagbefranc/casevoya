import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Both recovery-code server actions sit behind the same per-address and per-user limits as an
// authenticator code: refused before the database is asked, and a rejected code stays counted.

const ATTEMPT = "00000000-0000-4000-8000-0000000000a1";
const USER = "00000000-0000-4000-8000-0000000000b1";
const CODE = "AAAA-BBBB-CCCC-DDDD-EEEE";

const state = vi.hoisted(() => ({
  denied: new Set<string>(),
  limitCalls: [] as { name: string; key: string }[],
  reserve: { data: null as unknown, error: null as { message: string } | null },
  serviceCalls: [] as { name: string; args: Record<string, unknown> }[],
  rpcCalls: [] as string[],
  consumed: { data: false as unknown, error: null as { message: string } | null },
}));

vi.mock("@/lib/security/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/security/rate-limit")>();
  return {
    ...actual,
    clientIp: async () => "203.0.113.9",
    rateLimit: async (name: string, key: string) => {
      state.limitCalls.push({ name, key });
      return !state.denied.has(name);
    },
  };
});
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock("@/lib/env", () => ({ hasPublicSupabaseEnv: () => true }));
vi.mock("@/modules/email/sync-routing", () => ({ syncClaimedFirmSlug: async () => undefined }));
vi.mock("@/lib/stripe/server", () => ({ stripeServer: () => null, stripeLive: () => false }));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      state.serviceCalls.push({ name, args });
      if (name === "auth_attempt_reserve") return state.reserve;
      return { data: null, error: null };
    },
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getClaims: async () => ({ data: { claims: { sub: USER } } }) },
    rpc: async (name: string) => {
      state.rpcCalls.push(name);
      if (name === "consume_recovery_code") return state.consumed;
      return { data: null, error: null };
    },
  }),
}));

const { redeemRecovery } = await import("@/app/auth/port-actions");
const { redeemRecoveryCode } = await import("@/app/mfa/actions");
const { RATE_LIMIT_MESSAGE } = await import("@/lib/security/rate-limit");

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const reserved = { name: "auth_attempt_reserve", args: { p_kind: "totp", p_key_hash: sha(`totp:${USER}`), p_scope_hash: null } };
const resolved = (failed: boolean) => ({ name: "auth_attempt_resolve", args: { p_id: ATTEMPT, p_failed: failed } });

function form(code: string) {
  const data = new FormData();
  data.set("code", code);
  data.set("next", "/sheet");
  return data;
}

async function redirectOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("REDIRECT:")) return message.slice("REDIRECT:".length);
    throw error;
  }
  throw new Error("expected a redirect");
}

beforeEach(() => {
  vi.stubEnv("SUPABASE_SECRET_KEY", "synthetic-service-key");
  state.denied = new Set();
  state.limitCalls = [];
  state.reserve = { data: { allowed: true, attempt_id: ATTEMPT, retry_after_seconds: 0 }, error: null };
  state.serviceCalls = [];
  state.rpcCalls = [];
  state.consumed = { data: false, error: null };
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("redeemRecovery (sign-in port)", () => {
  it("counts a rejected code per user and releases an accepted one", async () => {
    expect(await redeemRecovery(CODE)).toMatchObject({ ok: false, message: "That recovery code was not accepted." });
    expect(state.limitCalls).toEqual([
      { name: "RL_VERIFY", key: "ip:203.0.113.9" },
      { name: "RL_VERIFY", key: `user:${USER}` },
    ]);
    expect(state.serviceCalls).toEqual([reserved, resolved(true)]);

    state.serviceCalls = [];
    state.consumed = { data: true, error: null };
    expect(await redeemRecovery(CODE)).toEqual({ ok: true });
    expect(state.serviceCalls).toEqual([reserved, resolved(false)]);
  });

  it("refuses at the limit without asking the database", async () => {
    state.reserve = { data: { allowed: false, attempt_id: null, retry_after_seconds: 600 }, error: null };
    expect(await redeemRecovery(CODE)).toEqual({ ok: false, message: "Too many attempts. Please wait 10 minutes and try again." });
    expect(state.rpcCalls).toEqual([]);

    state.denied.add("RL_VERIFY");
    state.serviceCalls = [];
    expect(await redeemRecovery(CODE)).toEqual({ ok: false, message: RATE_LIMIT_MESSAGE });
    expect(state.serviceCalls).toEqual([]);
    expect(state.rpcCalls).toEqual([]);
  });
});

describe("redeemRecoveryCode (/mfa)", () => {
  it("counts a rejected code, and redirects on success with the reservation released", async () => {
    expect(await redirectOf(() => redeemRecoveryCode(form(CODE)))).toBe("/mfa?next=%2Fsheet&error=recovery_failed");
    expect(state.serviceCalls).toEqual([reserved, resolved(true)]);

    state.serviceCalls = [];
    state.consumed = { data: true, error: null };
    expect(await redirectOf(() => redeemRecoveryCode(form(CODE)))).toBe("/sheet");
    expect(state.serviceCalls).toEqual([reserved, resolved(false)]);
  });

  it("refuses at the limit without asking the database", async () => {
    state.reserve = { data: { allowed: false, attempt_id: null, retry_after_seconds: 600 }, error: null };
    expect(await redirectOf(() => redeemRecoveryCode(form(CODE)))).toBe("/mfa?next=%2Fsheet&error=rate_limited");
    expect(state.rpcCalls).toEqual([]);
  });
});
