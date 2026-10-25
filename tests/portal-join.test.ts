import { beforeEach, describe, expect, it, vi } from "vitest";

const TOKEN = "a".repeat(64);
const ORG = "00000000-0000-4000-8000-000000000001";
const PERSON = "00000000-0000-4000-8000-000000000002";
const PAYLOAD = {
  portal_terms_id: "00000000-0000-4000-8000-0000000000aa",
  privacy_notice_id: "00000000-0000-4000-8000-0000000000bb",
  locale: "en-CA" as const,
  email_notices: true,
  sms_notices: false,
  deadline_reminders: true,
  processing_consent: true,
};

type AuthError = { message: string; code?: string } | null;

const state = vi.hoisted(() => ({
  preview: {} as Record<string, unknown>,
  claims: null as { sub: string; email: string } | null,
  signUp: { session: null as unknown, user: null as unknown, error: null as AuthError },
  signIn: null as AuthError,
  verify: null as AuthError,
  calls: [] as string[],
  signUpArgs: null as unknown,
  verifyArgs: null as unknown,
  resendArgs: null as unknown,
  requests: [] as { purpose: string }[],
  previewArgs: [] as unknown[],
}));

vi.mock("@/lib/env", () => ({ hasPublicSupabaseEnv: () => true }));
vi.mock("@/modules/email/sync-routing", () => ({ syncClaimedFirmSlug: async () => undefined }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    const query = {
      select: () => query,
      eq: () => query,
      order: () => query,
      limit: async () => ({ data: state.requests, error: null }),
    };
    return {
      auth: {
        getClaims: async () => ({ data: state.claims ? { claims: state.claims } : null }),
        signUp: async (args: unknown) => {
          state.calls.push("signUp");
          state.signUpArgs = args;
          return { data: { session: state.signUp.session, user: state.signUp.user }, error: state.signUp.error };
        },
        signInWithPassword: async () => {
          state.calls.push("signIn");
          return { data: {}, error: state.signIn };
        },
        resend: async (args: unknown) => {
          state.calls.push("resend");
          state.resendArgs = args;
          return { data: {}, error: null };
        },
        verifyOtp: async (args: unknown) => {
          state.calls.push("verifyOtp");
          state.verifyArgs = args;
          return { data: {}, error: state.verify };
        },
      },
      from: () => query,
      rpc: async (name: string, args?: Record<string, unknown>) => {
        state.calls.push(name);
        if (name === "preview_portal_invitation") {
          state.previewArgs.push(args);
          return { data: state.preview, error: null };
        }
        if (name === "accept_portal_invitation") {
          return { data: { ok: true, organization_id: ORG, person_id: PERSON, role: "client" }, error: null };
        }
        return { data: null, error: null };
      },
    };
  },
}));

const { confirmPortalInvite, continuePortalInvite, joinPortalInvite, resendPortalInviteCode } = await import("@/app/auth/port-actions");

// The confirmation link comes back to the invitation's accept screen through /auth/confirm.
const REDIRECT = `https://app.casevoya.ca/auth/confirm?next=${encodeURIComponent(`/accept/client?token=${TOKEN}`)}`;

const GOOD = "Harbour-view-19";

describe("joinPortalInvite validation", () => {
  beforeEach(() => {
    state.preview = { status: "open", role: "client", invitee: { email: "Client@Example.test", display_name: "Ana Client" } };
    state.claims = null;
    state.signUp = { session: null, user: { id: "u1", identities: [{ id: "i1" }] }, error: null };
    // No account with this email and password yet (Create a password signs in first).
    state.signIn = { message: "Invalid login credentials", code: "invalid_credentials" };
    state.verify = null;
    state.calls = [];
    state.signUpArgs = null;
    state.verifyArgs = null;
    state.requests = [];
    state.previewArgs = [];
  });

  it("refuses a malformed token before touching Supabase", async () => {
    const result = await joinPortalInvite({ token: "nope", mode: "create", password: GOOD, payload: PAYLOAD });
    expect(result).toEqual({ ok: false, message: "That invitation link is not valid." });
    expect(state.calls).toEqual([]);
  });

  it("refuses a password that breaks the Designer rules", async () => {
    const result = await joinPortalInvite({ token: TOKEN, mode: "create", password: "short", payload: PAYLOAD });
    expect(result).toEqual({ ok: false, message: "Choose a password that meets all three rules" });
    expect(state.calls).toEqual([]);
  });

  it("refuses an unknown sign-in method (passkeys are not available)", async () => {
    const result = await joinPortalInvite({
      token: TOKEN,
      mode: "passkey" as unknown as "create",
      password: GOOD,
      payload: PAYLOAD,
    });
    expect(result?.ok).toBe(false);
    expect(state.calls).toEqual([]);
  });

  it("refuses a payload without the policy versions", async () => {
    const result = await joinPortalInvite({
      token: TOKEN,
      mode: "create",
      password: GOOD,
      payload: {} as typeof PAYLOAD,
    });
    expect(result?.ok).toBe(false);
    expect(state.calls).toEqual([]);
  });

  it("refuses an invitation that is no longer open", async () => {
    state.preview = { status: "accepted", invitee: { display_name: "Ana Client" } };
    const result = await joinPortalInvite({ token: TOKEN, mode: "create", password: GOOD, payload: PAYLOAD });
    expect(result).toEqual({ ok: false, message: "This invitation can no longer be used." });
    expect(state.calls).toEqual(["preview_portal_invitation"]);
  });

  it("refuses a session signed in with a different email", async () => {
    state.claims = { sub: "u2", email: "someone@else.test" };
    const result = await joinPortalInvite({ token: TOKEN, mode: "create", password: GOOD, payload: PAYLOAD });
    expect(result).toMatchObject({ ok: false, reason: "elsewhere" });
    expect(state.calls).not.toContain("signUp");
    expect(state.calls).not.toContain("accept_portal_invitation");
  });

  it("signs up with the invited email and asks for the code when confirmation is on", async () => {
    const result = await joinPortalInvite({ token: TOKEN, mode: "create", password: GOOD, payload: PAYLOAD });
    expect(result).toEqual({ ok: true, confirm: true });
    expect(state.signUpArgs).toEqual({
      email: "client@example.test",
      password: GOOD,
      options: { data: { display_name: "Ana Client" }, emailRedirectTo: REDIRECT },
    });
    expect(state.calls).not.toContain("accept_portal_invitation");
  });

  it("accepts at once when sign-up returns a session, with the first open request", async () => {
    state.signUp.session = { access_token: "x" };
    state.requests = [{ purpose: "Passport copy" }];
    const result = await joinPortalInvite({ token: TOKEN, mode: "create", password: GOOD, payload: PAYLOAD });
    expect(result).toEqual({ ok: true, firstRequest: { purpose: "Passport copy" } });
    expect(state.calls).toContain("accept_portal_invitation");
  });

  it("signs in instead when the email already has an account with that password", async () => {
    state.signIn = null;
    const result = await joinPortalInvite({ token: TOKEN, mode: "create", password: GOOD, payload: PAYLOAD });
    expect(result).toEqual({ ok: true, firstRequest: null });
    expect(state.calls).toEqual(["preview_portal_invitation", "signIn", "accept_portal_invitation"]);
  });

  it("says to sign in when the email already has an account with another password", async () => {
    state.signUp.user = { id: "u1", identities: [] };
    const result = await joinPortalInvite({ token: TOKEN, mode: "create", password: GOOD, payload: PAYLOAD });
    expect(result).toEqual({
      ok: false,
      message: "This email already has a Casevoya sign-in. Choose “Already have a Casevoya sign-in?” and use that password.",
    });
    expect(state.calls).not.toContain("accept_portal_invitation");
    expect(state.calls).not.toContain("resend");
  });

  it("re-reads the invitation without counting it as an open", async () => {
    await joinPortalInvite({ token: TOKEN, mode: "create", password: GOOD, payload: PAYLOAD });
    expect(state.previewArgs).toEqual([{ p_token: TOKEN, p_open: false }]);
  });

  it("says to wait, not that the invitation is dead, when it is rate-limited", async () => {
    state.preview = { status: "rate_limited" };
    const result = await joinPortalInvite({ token: TOKEN, mode: "create", password: GOOD, payload: PAYLOAD });
    expect(result).toEqual({ ok: false, message: "Too many tries. Please wait a few minutes and try again." });
    expect(await confirmPortalInvite({ token: TOKEN, code: "123456", payload: PAYLOAD })).toEqual({
      ok: false,
      message: "Too many tries. Please wait a few minutes and try again.",
    });
  });

  // Bug 5 (2026-10-25): each Continue emailed a new code, which made the one the client held stop working.
  it("Continue again with an account still unconfirmed reuses the code already sent (Create a password)", async () => {
    state.signIn = { message: "Email not confirmed", code: "email_not_confirmed" };
    const result = await joinPortalInvite({ token: TOKEN, mode: "create", password: GOOD, payload: PAYLOAD });
    expect(result).toEqual({ ok: true, confirm: true, reused: true });
    expect(state.calls).toEqual(["preview_portal_invitation", "signIn"]);
  });

  it("signs in an existing account and says so when the password is wrong", async () => {
    state.signIn = { message: "Invalid login credentials", code: "invalid_credentials" };
    const result = await joinPortalInvite({ token: TOKEN, mode: "existing", password: "old-password", payload: PAYLOAD });
    expect(result).toEqual({ ok: false, message: "That password didn’t match the Casevoya sign-in for this email." });
    expect(state.calls).not.toContain("signUp");
  });

  it("asks an existing account whose email was never confirmed for the code already sent, without sending another", async () => {
    state.signIn = { message: "Email not confirmed", code: "email_not_confirmed" };
    const result = await joinPortalInvite({ token: TOKEN, mode: "existing", password: GOOD, payload: PAYLOAD });
    expect(result).toEqual({ ok: true, confirm: true, reused: true });
    expect(state.calls).not.toContain("resend");
    expect(state.calls).not.toContain("signUp");
  });

  it("accepts for a session already signed in as the invitee", async () => {
    state.claims = { sub: "u1", email: "client@example.test" };
    const result = await joinPortalInvite({ token: TOKEN, mode: "create", password: GOOD, payload: PAYLOAD });
    expect(result).toEqual({ ok: true, firstRequest: null });
    expect(state.calls).not.toContain("signUp");
  });
});

describe("confirmPortalInvite", () => {
  beforeEach(() => {
    state.preview = { status: "open", role: "client", invitee: { email: "client@example.test", display_name: "Ana Client" } };
    state.claims = null;
    state.signIn = null;
    state.verify = null;
    state.calls = [];
    state.requests = [];
    state.resendArgs = null;
  });

  it("refuses anything but six digits", async () => {
    expect(await confirmPortalInvite({ token: TOKEN, code: "12345a", payload: PAYLOAD })).toEqual({
      ok: false,
      message: "That code didn’t match.",
    });
    expect(state.calls).toEqual([]);
  });

  it("checks the code against the invited email, then accepts", async () => {
    const result = await confirmPortalInvite({ token: TOKEN, code: "123456", payload: PAYLOAD });
    expect(result).toEqual({ ok: true, firstRequest: null });
    expect(state.verifyArgs).toEqual({ email: "client@example.test", token: "123456", type: "signup" });
    expect(state.calls).toContain("accept_portal_invitation");
  });

  it("does not accept when the code is wrong", async () => {
    state.verify = { message: "Token has expired or is invalid" };
    const result = await confirmPortalInvite({ token: TOKEN, code: "123456", payload: PAYLOAD });
    expect(result?.ok).toBe(false);
    expect(state.calls).not.toContain("accept_portal_invitation");
  });

  it("resends a code only for an open invitation", async () => {
    expect(await resendPortalInviteCode("bad")).toEqual({ ok: false, message: "That invitation link is not valid." });
    expect(await resendPortalInviteCode(TOKEN)).toEqual({ ok: true, confirm: true });
    expect(state.calls).toContain("resend");
  });

  it("a resent code's link also comes back to the invitation (sponsor screen for a sponsor)", async () => {
    state.preview = { ...state.preview, role: "sponsor" };
    await resendPortalInviteCode(TOKEN);
    expect(state.resendArgs).toEqual({
      type: "signup",
      email: "client@example.test",
      options: { emailRedirectTo: `https://app.casevoya.ca/auth/confirm?next=${encodeURIComponent(`/accept/sponsor?token=${TOKEN}`)}` },
    });
  });

  it("a used code after the email was confirmed by link signs in with the chosen password and accepts", async () => {
    state.verify = { message: "Token has expired or is invalid", code: "otp_expired" };
    const result = await confirmPortalInvite({ token: TOKEN, code: "123456", payload: PAYLOAD, password: GOOD });
    expect(result).toEqual({ ok: true, firstRequest: null });
    expect(state.calls).toEqual(["preview_portal_invitation", "verifyOtp", "signIn", "accept_portal_invitation"]);
  });

  it("a wrong code for an email still unconfirmed accepts nothing", async () => {
    state.verify = { message: "Token has expired or is invalid", code: "otp_expired" };
    state.signIn = { message: "Email not confirmed", code: "email_not_confirmed" };
    const result = await confirmPortalInvite({ token: TOKEN, code: "123456", payload: PAYLOAD, password: GOOD });
    expect(result).toEqual({ ok: false, message: "That code didn’t match. Use the newest code we emailed you." });
    expect(state.calls).not.toContain("accept_portal_invitation");
  });

  it("a used code says why when a new code won't help: another account here, too many attempts, the wrong password", async () => {
    state.verify = { message: "Token has expired or is invalid", code: "otp_expired" };
    state.claims = { sub: "u2", email: "someone@else.test" };
    expect(await confirmPortalInvite({ token: TOKEN, code: "123456", payload: PAYLOAD, password: GOOD })).toEqual({
      ok: false,
      message: "You’re signed in with a different email. Sign out, then open this invitation again.",
      reason: "elsewhere",
    });
    state.claims = null;
    state.signIn = { message: "Too many requests" };
    expect(await confirmPortalInvite({ token: TOKEN, code: "123456", payload: PAYLOAD, password: GOOD })).toEqual({
      ok: false,
      message: "Too many attempts. Wait and try again.",
    });
    state.signIn = { message: "Invalid login credentials", code: "invalid_credentials" };
    expect(await confirmPortalInvite({ token: TOKEN, code: "123456", payload: PAYLOAD, password: GOOD })).toEqual({
      ok: false,
      message: "That password didn’t match the Casevoya sign-in for this email.",
    });
    expect(state.calls).not.toContain("accept_portal_invitation");
  });

  it("Send a new code after the link was used: signed in and accepted instead (Supabase sends nothing for a confirmed email)", async () => {
    const result = await resendPortalInviteCode(TOKEN, { password: GOOD, payload: PAYLOAD });
    expect(result).toEqual({ ok: true, firstRequest: null });
    expect(state.calls).toEqual(["preview_portal_invitation", "signIn", "accept_portal_invitation"]);
    expect(state.calls).not.toContain("resend");
  });

  it("Send a new code while still unconfirmed sends one", async () => {
    state.signIn = { message: "Email not confirmed", code: "email_not_confirmed" };
    expect(await resendPortalInviteCode(TOKEN, { password: GOOD, payload: PAYLOAD })).toEqual({ ok: true, confirm: true });
    expect(state.calls).toContain("resend");
    expect(state.calls).not.toContain("accept_portal_invitation");
  });
});

describe("continuePortalInvite (I used the email link)", () => {
  beforeEach(() => {
    state.preview = { status: "open", role: "client", invitee: { email: "client@example.test", display_name: "Ana Client" } };
    state.claims = null;
    state.signIn = null;
    state.calls = [];
    state.requests = [];
  });

  it("accepts with the session the link started in this browser, without a password", async () => {
    state.claims = { sub: "u1", email: "Client@example.test" };
    const result = await continuePortalInvite({ token: TOKEN, payload: PAYLOAD });
    expect(result).toEqual({ ok: true, firstRequest: null });
    expect(state.calls).toEqual(["preview_portal_invitation", "accept_portal_invitation"]);
  });

  it("signs in with the chosen password when the link was opened elsewhere, then accepts", async () => {
    state.requests = [{ purpose: "Passport copy" }];
    const result = await continuePortalInvite({ token: TOKEN, password: GOOD, payload: PAYLOAD });
    expect(result).toEqual({ ok: true, firstRequest: { purpose: "Passport copy" } });
    expect(state.calls).toEqual(["preview_portal_invitation", "signIn", "accept_portal_invitation"]);
  });

  it("says so when the email isn't confirmed yet", async () => {
    state.signIn = { message: "Email not confirmed", code: "email_not_confirmed" };
    const result = await continuePortalInvite({ token: TOKEN, password: GOOD, payload: PAYLOAD });
    expect(result?.ok).toBe(false);
    expect(result && !result.ok ? result.message : "").toMatch(/isn’t confirmed yet/);
    expect(state.calls).not.toContain("accept_portal_invitation");
  });

  it("refuses a session for someone else and a missing password without accepting", async () => {
    state.claims = { sub: "u2", email: "someone@else.test" };
    expect((await continuePortalInvite({ token: TOKEN, password: GOOD, payload: PAYLOAD }))?.ok).toBe(false);
    state.claims = null;
    expect((await continuePortalInvite({ token: TOKEN, payload: PAYLOAD }))?.ok).toBe(false);
    expect(state.calls).not.toContain("signIn");
    expect(state.calls).not.toContain("accept_portal_invitation");
  });

  it("refuses a malformed token before touching Supabase", async () => {
    expect(await continuePortalInvite({ token: "nope", password: GOOD, payload: PAYLOAD })).toEqual({ ok: false, message: "That invitation link is not valid." });
    expect(state.calls).toEqual([]);
  });
});
