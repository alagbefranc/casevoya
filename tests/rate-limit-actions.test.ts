import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Server actions behind the app rate limits: a Workers refusal or a database lockout answers with
// the friendly message and never reaches Supabase Auth; only failures are recorded.

type AuthError = { message: string; code?: string } | null;

const state = vi.hoisted(() => ({
  denied: new Set<string>(),
  limitCalls: [] as { name: string; key: string }[],
  check: { data: { allowed: true, retry_after_seconds: 0 } as unknown, error: null as { message: string } | null },
  serviceCalls: [] as { name: string; args: Record<string, unknown> }[],
  authCalls: [] as string[],
  signIn: null as AuthError,
  verify: null as AuthError,
  mfaVerify: null as AuthError,
  claims: { sub: "00000000-0000-4000-8000-0000000000u1" } as { sub: string } | null,
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
vi.mock("@/lib/env", () => ({ hasPublicSupabaseEnv: () => true }));
vi.mock("@/modules/email/sync-routing", () => ({ syncClaimedFirmSlug: async () => undefined }));
vi.mock("@/lib/stripe/server", () => ({ stripeServer: () => null, stripeLive: () => false }));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      state.serviceCalls.push({ name, args });
      if (name === "auth_attempt_check") return state.check;
      return { data: null, error: null };
    },
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getClaims: async () => ({ data: state.claims ? { claims: state.claims } : null }),
      signInWithPassword: async () => {
        state.authCalls.push("signIn");
        return { data: {}, error: state.signIn };
      },
      signInWithOtp: async () => {
        state.authCalls.push("signInWithOtp");
        return { data: {}, error: null };
      },
      verifyOtp: async () => {
        state.authCalls.push("verifyOtp");
        return { data: {}, error: state.verify };
      },
      mfa: {
        listFactors: async () => {
          state.authCalls.push("listFactors");
          return { data: { totp: [{ id: "f1", status: "verified" }], all: [] }, error: null };
        },
        challenge: async () => {
          state.authCalls.push("challenge");
          return { data: { id: "c1" }, error: null };
        },
        verify: async () => {
          state.authCalls.push("mfaVerify");
          return { data: {}, error: state.mfaVerify };
        },
        challengeAndVerify: async () => {
          state.authCalls.push("challengeAndVerify");
          return { data: {}, error: state.mfaVerify };
        },
      },
    },
    rpc: async (name: string) => {
      state.authCalls.push(`rpc:${name}`);
      return { data: null, error: null };
    },
  }),
}));

const { signInWithPassword, verifyEmailCode, sendRecoveryEmail, verifyTotpCode } = await import("@/app/auth/port-actions");
const { verifyTotpCode: verifyStepUpCode } = await import("@/lib/auth/verify-totp");
const { createInvoicePayment } = await import("@/modules/portal/actions");
const { RATE_LIMIT_MESSAGE } = await import("@/lib/security/rate-limit");

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const FACTOR = "00000000-0000-4000-8000-0000000000f1";

beforeEach(() => {
  vi.stubEnv("SUPABASE_SECRET_KEY", "synthetic-service-key");
  state.denied = new Set();
  state.limitCalls = [];
  state.check = { data: { allowed: true, retry_after_seconds: 0 }, error: null };
  state.serviceCalls = [];
  state.authCalls = [];
  state.signIn = null;
  state.verify = null;
  state.mfaVerify = null;
  state.claims = { sub: "00000000-0000-4000-8000-0000000000u1" };
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("password sign-in", () => {
  it("a Workers refusal answers the friendly message and never calls Supabase", async () => {
    state.denied.add("RL_AUTH");
    const result = await signInWithPassword("person@example.test", "Harbour-view-19", "/app");
    expect(result).toEqual({ ok: false, message: RATE_LIMIT_MESSAGE, inline: true, retryAfter: 60 });
    expect(state.limitCalls).toEqual([{ name: "RL_AUTH", key: "203.0.113.9" }]);
    expect(state.authCalls).toEqual([]);
    expect(state.serviceCalls).toEqual([]);
  });

  it("a database lockout names the wait and never calls Supabase Auth", async () => {
    state.check = { data: { allowed: false, retry_after_seconds: 840 }, error: null };
    const result = await signInWithPassword(" Person@Example.test ", "Harbour-view-19", "/app");
    expect(result).toEqual({ ok: false, message: "Too many attempts. Please wait 14 minutes and try again.", inline: true, retryAfter: 840 });
    expect(state.authCalls).toEqual([]);
    expect(state.serviceCalls).toEqual([
      { name: "auth_attempt_check", args: { p_kind: "password", p_key_hash: sha("password:person@example.test") } },
    ]);
  });

  it("records a wrong password as a failure, and nothing for other refusals or a success", async () => {
    state.signIn = { message: "Invalid login credentials", code: "invalid_credentials" };
    const wrong = await signInWithPassword("person@example.test", "Harbour-view-19", "/app");
    expect(wrong).toMatchObject({ ok: false, state: "error" });
    expect(state.serviceCalls.map((call) => call.name)).toEqual(["auth_attempt_check", "auth_attempt_record"]);
    expect(state.serviceCalls[1].args).toEqual({ p_kind: "password", p_key_hash: sha("password:person@example.test"), p_failed: true });

    state.serviceCalls = [];
    state.signIn = { message: "Email not confirmed", code: "email_not_confirmed" };
    await signInWithPassword("person@example.test", "Harbour-view-19", "/app");
    expect(state.serviceCalls.map((call) => call.name)).toEqual(["auth_attempt_check"]);
  });

  it("allows the sign-in when the database check errors", async () => {
    state.check = { data: null, error: { message: "connection reset" } };
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    state.signIn = { message: "Invalid login credentials", code: "invalid_credentials" };
    const result = await signInWithPassword("person@example.test", "Harbour-view-19", "/app");
    expect(result).toMatchObject({ ok: false, state: "error", message: "Email or password didn’t match" });
    expect(state.authCalls).toEqual(["signIn"]);
  });
});

describe("email codes and auth emails", () => {
  it("a wrong email code is recorded; a lockout refuses before Supabase", async () => {
    state.verify = { message: "Token has expired or is invalid" };
    expect(await verifyEmailCode("person@example.test", "123456", "recovery")).toMatchObject({ ok: false, message: "That code didn’t match." });
    expect(state.serviceCalls.at(-1)).toEqual({ name: "auth_attempt_record", args: { p_kind: "otp", p_key_hash: sha("otp:person@example.test"), p_failed: true } });

    state.authCalls = [];
    state.check = { data: { allowed: false, retry_after_seconds: 30 }, error: null };
    expect(await verifyEmailCode("person@example.test", "123456", "recovery")).toEqual({ ok: false, message: RATE_LIMIT_MESSAGE, inline: true, retryAfter: 30 });
    expect(state.authCalls).toEqual([]);

    state.denied.add("RL_VERIFY");
    state.serviceCalls = [];
    expect(await verifyEmailCode("person@example.test", "123456", "signup")).toMatchObject({ ok: false, message: RATE_LIMIT_MESSAGE });
    expect(state.serviceCalls).toEqual([]);
  });

  it("a recovery email is counted before it is sent and refused at the hourly limit", async () => {
    expect(await sendRecoveryEmail("person@example.test")).toEqual({ ok: true });
    expect(state.serviceCalls.map((call) => [call.name, call.args.p_kind, call.args.p_failed])).toEqual([
      ["auth_attempt_check", "email_send", undefined],
      ["auth_attempt_record", "email_send", false],
    ]);
    expect(state.authCalls).toEqual(["signInWithOtp"]);

    state.authCalls = [];
    state.check = { data: { allowed: false, retry_after_seconds: 1800 }, error: null };
    expect(await sendRecoveryEmail("person@example.test")).toMatchObject({ ok: false, message: "Too many attempts. Please wait 30 minutes and try again." });
    expect(state.authCalls).toEqual([]);

    state.denied.add("RL_AUTH_EMAIL");
    state.serviceCalls = [];
    expect(await sendRecoveryEmail("person@example.test")).toMatchObject({ ok: false, message: RATE_LIMIT_MESSAGE });
    expect(state.serviceCalls).toEqual([]);
  });
});

describe("authenticator codes", () => {
  it("the sign-in TOTP is limited per address and per user, and failures are recorded per user", async () => {
    state.mfaVerify = { message: "Invalid TOTP code entered" };
    expect(await verifyTotpCode(FACTOR, "123456")).toMatchObject({ ok: false, message: "That code didn’t match." });
    expect(state.limitCalls).toEqual([
      { name: "RL_VERIFY", key: "ip:203.0.113.9" },
      { name: "RL_VERIFY", key: `user:${state.claims?.sub}` },
    ]);
    expect(state.serviceCalls.at(-1)).toEqual({ name: "auth_attempt_record", args: { p_kind: "totp", p_key_hash: sha(`totp:${state.claims?.sub}`), p_failed: true } });

    state.authCalls = [];
    state.check = { data: { allowed: false, retry_after_seconds: 600 }, error: null };
    expect(await verifyTotpCode(FACTOR, "123456")).toEqual({ ok: false, message: "Too many attempts. Please wait 10 minutes and try again." });
    expect(state.authCalls).toEqual([]);
  });

  it("the step-up check refuses before asking Supabase when limited", async () => {
    state.denied.add("RL_VERIFY");
    const supabase = (await (await import("@/lib/supabase/server")).createClient()) as never;
    expect(await verifyStepUpCode(supabase, "123456")).toEqual({ ok: false, error: RATE_LIMIT_MESSAGE });
    expect(state.authCalls).toEqual([]);

    state.denied.clear();
    expect(await verifyStepUpCode(supabase, "123456")).toEqual({ ok: true });
    expect(state.authCalls).toEqual(["listFactors", "challengeAndVerify"]);
  });
});

describe("portal invoice payment", () => {
  it("is limited per user before anything else is asked", async () => {
    state.denied.add("RL_PAYMENT");
    const result = await createInvoicePayment({
      organizationId: "00000000-0000-4000-8000-000000000001",
      invoiceId: "00000000-0000-4000-8000-000000000002",
    });
    expect(result).toEqual({ error: RATE_LIMIT_MESSAGE });
    expect(state.limitCalls).toEqual([{ name: "RL_PAYMENT", key: `user:${state.claims?.sub}` }]);
    expect(state.authCalls).toEqual([]);
  });
});
