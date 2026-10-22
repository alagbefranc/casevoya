import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The email confirmation link (/auth/confirm): a portal invitee comes back to their accept screen,
// signed in when the link was opened in the browser that signed up (PKCE code), or to sign in
// there with the password they chose when it was opened elsewhere.

const state = vi.hoisted(() => ({ exchange: null as { message: string } | null }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      verifyOtp: async () => ({ error: { message: "invalid" } }),
      exchangeCodeForSession: async () => ({ error: state.exchange }),
    },
  }),
}));

const { GET } = await import("@/app/auth/confirm/route");
const TOKEN = "a".repeat(64);
const NEXT = `/accept/client?token=${TOKEN}`;

function open(query: string) {
  return GET(new NextRequest(`https://app.casevoya.ca/auth/confirm?${query}`));
}

describe("/auth/confirm", () => {
  beforeEach(() => {
    state.exchange = null;
  });

  it("a sign-up link opened in the same browser lands back on the portal invitation, signed in", async () => {
    const response = await open(`code=pkce-code&next=${encodeURIComponent(NEXT)}`);
    expect(response.headers.get("location")).toBe(`https://app.casevoya.ca${NEXT}`);
  });

  it("opened elsewhere (no PKCE verifier) it still goes back to the portal invitation", async () => {
    state.exchange = { message: "code verifier missing" };
    const response = await open(`code=pkce-code&next=${encodeURIComponent(NEXT)}`);
    expect(response.headers.get("location")).toBe(`https://app.casevoya.ca${NEXT}`);
  });

  it("anything else that fails goes to sign-in", async () => {
    state.exchange = { message: "bad" };
    const response = await open(`code=pkce-code&next=${encodeURIComponent("/app")}`);
    expect(response.headers.get("location")).toBe("https://app.casevoya.ca/sign-in?error=link_invalid");
  });
});
