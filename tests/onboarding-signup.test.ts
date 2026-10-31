import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  EMAIL_TAKEN,
  STAFF_EMAIL_TAKEN,
  isRateLimited,
  messageParts,
  plainMessage,
  RATE_LIMIT_BUFFER_SECONDS,
  rateLimitSeconds,
  rateLimitText,
  secondsLeft,
  signUpEmailTaken,
} from "@/lib/auth/signup-errors";

// Issue #259 fixes 2 and 7: a sign-up for an address that already has an account, and Supabase's
// raw rate-limit text.

type AuthError = { message: string; code?: string; status?: number } | null;

const state = vi.hoisted(() => ({
  signUp: { session: null as unknown, user: null as unknown, error: null as AuthError },
  signIn: null as AuthError,
  calls: [] as string[],
  redirects: [] as (string | undefined)[],
}));

vi.mock("@/lib/env", () => ({ hasPublicSupabaseEnv: () => true }));
vi.mock("@/modules/email/sync-routing", () => ({ syncClaimedFirmSlug: async () => undefined }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getClaims: async () => ({ data: null }),
      signUp: async (input: { options?: { emailRedirectTo?: string } }) => {
        state.calls.push("signUp");
        state.redirects.push(input?.options?.emailRedirectTo);
        return { data: { session: state.signUp.session, user: state.signUp.user }, error: state.signUp.error };
      },
      signInWithPassword: async () => {
        state.calls.push("signIn");
        return { data: {}, error: state.signIn };
      },
      signOut: async () => ({ error: null }),
    },
    rpc: async (name: string) => {
      state.calls.push(name);
      if (name === "preview_invitation") return { data: [{ status: "valid", email: "staff@example.test" }], error: null };
      return { data: null, error: null };
    },
  }),
}));

const { joinStaffInvite, signUpForTrial } = await import("@/app/auth/port-actions");

const GOOD = "Harbour-view-19";
const TRIAL = { name: "Casey Owner", email: "owner@example.test", password: GOOD };
const RATE = { message: "For security purposes, you can only request this after 16 seconds.", code: "over_email_send_rate_limit", status: 429 };

beforeEach(() => {
  state.signUp = { session: null, user: { id: "u1", identities: [{ id: "i1" }] }, error: null };
  state.signIn = null;
  state.calls = [];
  state.redirects = [];
});

describe("start a trial with an email that already has an account (fix 2)", () => {
  it("a new email still gets its code: the screen moves on to the code step", async () => {
    expect(await signUpForTrial(TRIAL)).toEqual({ ok: true });
  });

  it("says the email is taken, with a link to sign in, instead of a code step that never gets a code", async () => {
    // Supabase's answer for a confirmed address: a user with no identities, no session, no email sent.
    state.signUp.user = { id: "u1", identities: [] };
    const result = await signUpForTrial(TRIAL);
    expect(result).toEqual({ ok: false, message: EMAIL_TAKEN, inline: true });
    expect(plainMessage(EMAIL_TAKEN)).toBe("An account already uses this email. Sign in instead, or reset your password.");
    expect(messageParts(EMAIL_TAKEN).filter((part) => "href" in part)).toEqual([
      { text: "Sign in", href: "/sign-in" },
      { text: "reset your password", href: "/recovery" },
    ]);
  });

  it("says the same when Supabase reports the user already exists", async () => {
    state.signUp = { session: null, user: null, error: { message: "User already registered", code: "user_already_exists" } };
    expect(await signUpForTrial(TRIAL)).toEqual({ ok: false, message: EMAIL_TAKEN, inline: true });
  });

  it("a staff invitation for an address with another password says the email is taken, not to confirm it", async () => {
    state.signUp.user = { id: "u1", identities: [] };
    state.signIn = { message: "Invalid login credentials", code: "invalid_credentials" };
    const result = await joinStaffInvite({ token: "a".repeat(64), name: "Sam Staff", email: "staff@example.test", password: GOOD });
    expect(result).toEqual({ ok: false, message: STAFF_EMAIL_TAKEN, inline: true });
    // Sign in first (#252): the existing account's own password is tried before anything is said.
    expect(state.calls).toEqual(["preview_invitation", "signUp", "signIn"]);
  });

  it("a staff invitation for a new, unconfirmed address still asks to confirm the email", async () => {
    state.signIn = { message: "Email not confirmed", code: "email_not_confirmed" };
    const result = await joinStaffInvite({ token: "a".repeat(64), name: "Sam Staff", email: "staff@example.test", password: GOOD });
    expect(result).toEqual({ ok: false, message: "Confirm your email, then open this invitation again." });
  });

  it("a staff invitation's confirmation link uses the configured app origin", async () => {
    const before = process.env.APP_URL;
    process.env.APP_URL = "https://app.example.test";
    try {
      state.signIn = { message: "Email not confirmed", code: "email_not_confirmed" };
      const token = "a".repeat(64);
      await joinStaffInvite({ token, name: "Sam Staff", email: "staff@example.test", password: GOOD });
      expect(state.redirects).toEqual([`https://app.example.test/auth/confirm?next=${encodeURIComponent(`/invite/${token}`)}`]);
    } finally {
      if (before === undefined) delete process.env.APP_URL;
      else process.env.APP_URL = before;
    }
  });

  it("a trial sign-up's confirmation link uses the configured app origin and returns to /start-trial", async () => {
    const before = process.env.APP_URL;
    process.env.APP_URL = "https://app.example.test";
    try {
      expect(await signUpForTrial(TRIAL)).toEqual({ ok: true });
      expect(state.redirects).toEqual([`https://app.example.test/auth/confirm?next=${encodeURIComponent("/start-trial")}`]);
    } finally {
      if (before === undefined) delete process.env.APP_URL;
      else process.env.APP_URL = before;
    }
  });

  it("only a user with an empty identities list and no session counts as taken", () => {
    expect(signUpEmailTaken({ user: { identities: [] }, session: null })).toBe(true);
    expect(signUpEmailTaken({ user: { identities: [{}] }, session: null })).toBe(false);
    expect(signUpEmailTaken({ user: { identities: [] }, session: {} })).toBe(false);
    expect(signUpEmailTaken({ user: null, session: null })).toBe(false);
  });
});

describe("rate limit (fix 7)", () => {
  it("replaces Supabase's raw text with a friendly message and the seconds to count down", async () => {
    state.signUp = { session: null, user: null, error: RATE };
    const result = await signUpForTrial(TRIAL);
    const wait = 16 + RATE_LIMIT_BUFFER_SECONDS;
    expect(result).toEqual({ ok: false, message: rateLimitText(wait), inline: true, retryAfter: wait });
    expect(JSON.stringify(result)).not.toContain("For security purposes");
  });

  it("falls back to plain words when Supabase names no wait", async () => {
    state.signUp = { session: null, user: null, error: { message: "Email rate limit exceeded", code: "over_email_send_rate_limit", status: 429 } };
    expect(await signUpForTrial(TRIAL)).toEqual({ ok: false, message: rateLimitText(null), inline: true, retryAfter: null });
  });

  it("reads the wait and counts it down in words", () => {
    expect(isRateLimited(RATE)).toBe(true);
    expect(isRateLimited({ message: "Invalid login credentials" })).toBe(false);
    expect(rateLimitSeconds(RATE)).toBe(16 + RATE_LIMIT_BUFFER_SECONDS);
    expect(rateLimitSeconds({ message: "Email rate limit exceeded" })).toBeNull();
    expect(rateLimitText(16)).toBe("We just sent you an email. You can try again in 16 seconds.");
    expect(rateLimitText(1)).toBe("We just sent you an email. You can try again in 1 second.");
    expect(rateLimitText(0)).toBe("You can try again now.");
    expect(rateLimitText(null)).toBe("We just sent you an email. Wait a minute, then try again.");
  });

  it("issue #261: the button waits until Supabase's wait has really passed", () => {
    // Supabase rounds its remaining wait down to whole seconds. Whatever is really left, the
    // countdown we start from its words must not end before it.
    for (const remainingMs of [50, 400, 999, 1000, 1001, 15_200, 15_999, 59_999]) {
      const named = Math.floor(remainingMs / 1000);
      const wait = rateLimitSeconds({ message: `For security purposes, you can only request this after ${named} seconds.` });
      expect(wait, `${remainingMs}ms left`).not.toBeNull();
      expect(wait! * 1000, `${remainingMs}ms left`).toBeGreaterThan(remainingMs);
    }
  });

  it("issue #261: a click that is still rate-limited restarts the countdown, not the generic words", async () => {
    state.signUp = { session: null, user: null, error: { ...RATE, message: "For security purposes, you can only request this after 0 seconds." } };
    const result = await signUpForTrial(TRIAL);
    expect(result).toEqual({ ok: false, message: rateLimitText(RATE_LIMIT_BUFFER_SECONDS), inline: true, retryAfter: RATE_LIMIT_BUFFER_SECONDS });
    expect(JSON.stringify(result)).not.toContain("Wait a minute");
  });

  it("issue #261: the countdown runs off the clock, so a late timer never re-enables early", () => {
    const until = 1_000_000 + 18_000;
    expect(secondsLeft(until, 1_000_000)).toBe(18);
    expect(secondsLeft(until, 1_000_000 + 17_001)).toBe(1);
    expect(secondsLeft(until, until - 1)).toBe(1);
    expect(secondsLeft(until, until)).toBe(0);
    expect(secondsLeft(until, until + 5_000)).toBe(0);
  });

  it("turns only same-site paths into links", () => {
    expect(messageParts("Go [here](//evil.example) or [there](https://evil.example)")).toEqual([
      { text: "Go " },
      { text: "here" },
      { text: " or [there](https://evil.example)" },
    ]);
    expect(messageParts("[a](/.//evil.example) [b](/a/..//evil.example)").filter((part) => "href" in part)).toEqual([]);
  });
});
