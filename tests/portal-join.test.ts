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
  requests: [] as { purpose: string }[],
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
        resend: async () => {
          state.calls.push("resend");
          return { data: {}, error: null };
        },
        verifyOtp: async (args: unknown) => {
          state.calls.push("verifyOtp");
          state.verifyArgs = args;
          return { data: {}, error: state.verify };
        },
      },
      from: () => query,
      rpc: async (name: string) => {
        state.calls.push(name);
        if (name === "preview_portal_invitation") return { data: state.preview, error: null };
        if (name === "accept_portal_invitation") {
          return { data: { ok: true, organization_id: ORG, person_id: PERSON, role: "client" }, error: null };
        }
        return { data: null, error: null };
      },
    };
  },
}));

const { confirmPortalInvite, joinPortalInvite, resendPortalInviteCode } = await import("@/app/auth/port-actions");

const GOOD = "Harbour-view-19";

describe("joinPortalInvite validation", () => {
  beforeEach(() => {
    state.preview = { status: "open", invitee: { email: "Client@Example.test", display_name: "Ana Client" } };
    state.claims = null;
    state.signUp = { session: null, user: { id: "u1", identities: [{ id: "i1" }] }, error: null };
    state.signIn = null;
    state.verify = null;
    state.calls = [];
    state.signUpArgs = null;
    state.verifyArgs = null;
    state.requests = [];
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
    expect(result?.ok).toBe(false);
    expect(state.calls).not.toContain("signUp");
    expect(state.calls).not.toContain("accept_portal_invitation");
  });

  it("signs up with the invited email and asks for the code when confirmation is on", async () => {
    const result = await joinPortalInvite({ token: TOKEN, mode: "create", password: GOOD, payload: PAYLOAD });
    expect(result).toEqual({ ok: true, confirm: true });
    expect(state.signUpArgs).toEqual({
      email: "client@example.test",
      password: GOOD,
      options: { data: { display_name: "Ana Client" } },
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

  it("signs in instead when the email already has an account", async () => {
    state.signUp.user = { id: "u1", identities: [] };
    const result = await joinPortalInvite({ token: TOKEN, mode: "create", password: GOOD, payload: PAYLOAD });
    expect(result).toEqual({ ok: true, firstRequest: null });
    expect(state.calls).toEqual(["preview_portal_invitation", "signUp", "signIn", "accept_portal_invitation"]);
  });

  it("signs in an existing account and says so when the password is wrong", async () => {
    state.signIn = { message: "Invalid login credentials", code: "invalid_credentials" };
    const result = await joinPortalInvite({ token: TOKEN, mode: "existing", password: "old-password", payload: PAYLOAD });
    expect(result).toEqual({ ok: false, message: "That password didn’t match the Casevoya sign-in for this email." });
    expect(state.calls).not.toContain("signUp");
  });

  it("sends a code to an existing account whose email was never confirmed", async () => {
    state.signIn = { message: "Email not confirmed", code: "email_not_confirmed" };
    const result = await joinPortalInvite({ token: TOKEN, mode: "existing", password: GOOD, payload: PAYLOAD });
    expect(result).toEqual({ ok: true, confirm: true });
    expect(state.calls).toContain("resend");
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
    state.preview = { status: "open", invitee: { email: "client@example.test", display_name: "Ana Client" } };
    state.verify = null;
    state.calls = [];
    state.requests = [];
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
});
