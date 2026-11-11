import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CAPTCHA_MESSAGE, captchaMissing, captchaOptions, turnstileSiteKey } from "@/lib/auth/turnstile";
import { RecoveryMarkup } from "@/components/port/markup/recovery";
import { SignInMarkup } from "@/components/port/markup/sign-in";
import { StartTrialMarkup } from "@/components/port/markup/start-trial";
import { mountTurnstile } from "@/components/port/turnstile";

const auth = vi.hoisted(() => ({
  signIn: [] as { email: string; password: string; options?: { captchaToken?: string } }[],
  signUp: [] as { password: string; options?: { captchaToken?: string } }[],
  otp: [] as { options?: { captchaToken?: string; shouldCreateUser?: boolean } }[],
}));

vi.mock("@/lib/env", () => ({ hasPublicSupabaseEnv: () => true }));
vi.mock("@/lib/security/rate-limit", () => ({
  RATE_LIMIT_RETRY_SECONDS: 60,
  clientIp: async () => "203.0.113.9",
  rateLimit: async () => true,
}));
vi.mock("@/lib/security/auth-attempts", () => ({
  attemptWaitMessage: () => "Too many attempts. Please wait a minute and try again.",
  authEmailGate: async () => ({ allowed: true, attemptId: "attempt", retryAfterSeconds: 0 }),
  invalidCredentials: () => false,
  reserveAuthAttempt: async () => ({ allowed: true, attemptId: "attempt" }),
  resolveAuthAttempt: async () => undefined,
  totpGate: async () => ({ allowed: true, attemptId: "attempt" }),
}));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => ({ rpc: async () => ({ data: null, error: null }) }) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getClaims: async () => ({ data: { claims: { sub: "user-1", email: "person@example.test" } } }),
      signInWithPassword: async (input: (typeof auth.signIn)[number]) => {
        auth.signIn.push(input);
        return { data: {}, error: null };
      },
      signInWithOtp: async (input: (typeof auth.otp)[number]) => {
        auth.otp.push(input);
        return { data: {}, error: null };
      },
      signUp: async (input: (typeof auth.signUp)[number]) => {
        auth.signUp.push(input);
        return { data: { session: null, user: { identities: [{ id: "i1" }] } }, error: null };
      },
      mfa: { listFactors: async () => ({ data: { totp: [], all: [] }, error: null }) },
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: async () => ({ data: [], error: null }),
        }),
      }),
    }),
    rpc: async () => ({ data: null, error: null }),
  }),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  auth.signIn = [];
  auth.signUp = [];
  auth.otp = [];
});

describe("Turnstile flag", () => {
  it("stays off when the site key is absent", () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "");
    expect(turnstileSiteKey()).toBeNull();
    expect(captchaMissing(undefined)).toBe(false);
    expect(captchaMissing("")).toBe(false);
    expect(captchaOptions("token")).toEqual({});
    const root = { querySelectorAll: () => [{ dataset: {} }] } as unknown as ParentNode;
    expect(mountTurnstile(root)).toBe(false);
  });

  it("requires a token and mounts a slot when the site key is set", async () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "0x4AAAA-test");
    expect(turnstileSiteKey()).toBe("0x4AAAA-test");
    expect(captchaMissing("")).toBe(true);
    expect(captchaMissing("widget-token")).toBe(false);
    expect(captchaOptions("widget-token")).toEqual({ captchaToken: "widget-token" });
    const rendered: { sitekey?: string }[] = [];
    const slot = { dataset: {} as DOMStringMap };
    const root = { querySelectorAll: () => [slot] } as unknown as ParentNode;
    vi.stubGlobal("window", { turnstile: { render: (_el: unknown, options: { sitekey: string }) => rendered.push(options) } });
    vi.stubGlobal("document", { getElementById: () => null, createElement: () => ({}), head: { append: () => undefined } });
    expect(mountTurnstile(root)).toBe(true);
    await Promise.resolve();
    expect(rendered).toEqual([{ sitekey: "0x4AAAA-test" }]);
  });

  it("puts a slot on sign-in, sign-up and password reset", () => {
    expect(renderToStaticMarkup(createElement(SignInMarkup))).toContain("data-turnstile");
    expect(renderToStaticMarkup(createElement(StartTrialMarkup, {}))).toContain("data-turnstile");
    expect(renderToStaticMarkup(createElement(RecoveryMarkup))).toContain("data-turnstile");
  });
});

describe("auth actions and the challenge", () => {
  it("does not send captchaToken while the flag is off, including for an existing short password", async () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "");
    const { sendRecoveryEmail, signInWithPassword, signUpForTrial } = await import("@/app/auth/port-actions");
    const signedIn = await signInWithPassword("person@example.test", "short", "/app");
    expect(signedIn?.ok).toBe(true);
    expect(auth.signIn[0]?.password).toBe("short");
    expect(auth.signIn[0]?.options).toEqual({});

    const signedUp = await signUpForTrial({ name: "Ada Lovelace", email: "ada@example.test", password: `${"a".repeat(11)}1` });
    expect(signedUp?.ok).toBe(true);
    expect(auth.signUp[0]?.options?.captchaToken).toBeUndefined();
    const tooShort = await signUpForTrial({ name: "Ada Lovelace", email: "ada@example.test", password: `${"a".repeat(10)}1` });
    expect(tooShort).toEqual({ ok: false, message: "Check your name, email and password." });
    expect(auth.signUp).toHaveLength(1);

    const recovery = await sendRecoveryEmail("person@example.test");
    expect(recovery?.ok).toBe(true);
    expect(auth.otp[0]?.options).toEqual({ shouldCreateUser: false });
  });

  it("refuses the three forms without a token, and passes the token when one is present", async () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "0x4AAAA-test");
    const { sendRecoveryEmail, signInWithPassword, signUpForTrial } = await import("@/app/auth/port-actions");
    expect(await signInWithPassword("person@example.test", "Harbour-view-19", "/app")).toEqual({ ok: false, message: CAPTCHA_MESSAGE });
    expect(await signUpForTrial({ name: "Ada Lovelace", email: "ada@example.test", password: `${"a".repeat(11)}1` })).toEqual({ ok: false, message: CAPTCHA_MESSAGE });
    expect(await sendRecoveryEmail("person@example.test")).toEqual({ ok: false, message: CAPTCHA_MESSAGE });
    expect(auth.signIn).toHaveLength(0);
    expect(auth.signUp).toHaveLength(0);
    expect(auth.otp).toHaveLength(0);

    expect((await signInWithPassword("person@example.test", "short", "/app", "token-1"))?.ok).toBe(true);
    expect(auth.signIn[0]?.options).toEqual({ captchaToken: "token-1" });
    expect((await signUpForTrial({ name: "Ada Lovelace", email: "ada@example.test", password: `${"a".repeat(11)}1`, captchaToken: "token-2" }))?.ok).toBe(true);
    expect(auth.signUp[0]?.options?.captchaToken).toBe("token-2");
    expect((await sendRecoveryEmail("person@example.test", "token-3"))?.ok).toBe(true);
    expect(auth.otp[0]?.options?.captchaToken).toBe("token-3");
  });
});
