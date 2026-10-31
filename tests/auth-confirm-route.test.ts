import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The email confirmation link (/auth/confirm): a portal invitee comes back to their accept screen,
// signed in when the link was opened in the browser that signed up (PKCE code), or to sign in
// there with the password they chose when it was opened elsewhere. A token_hash link only starts
// a session after a same-origin Continue post.

const state = vi.hoisted(() => ({
  exchange: null as { message: string } | null,
  verify: { message: "invalid" } as { message: string } | null,
  verifyCalls: [] as { type: string; token_hash: string }[],
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      verifyOtp: async (input: { type: string; token_hash: string }) => {
        state.verifyCalls.push(input);
        return { error: state.verify };
      },
      exchangeCodeForSession: async () => ({ error: state.exchange }),
    },
  }),
}));

const { GET, POST } = await import("@/app/auth/confirm/route");
const TOKEN = "a".repeat(64);
const NEXT = `/accept/client?token=${TOKEN}`;
const ORIGIN = "https://app.casevoya.ca";

function open(query: string) {
  return GET(new NextRequest(`${ORIGIN}/auth/confirm?${query}`));
}

function post(fields: Record<string, string>, origin: string | null = ORIGIN, fetchSite?: string) {
  const body = new URLSearchParams(fields);
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
  if (origin) headers.origin = origin;
  if (fetchSite) headers["sec-fetch-site"] = fetchSite;
  return POST(new NextRequest(`${ORIGIN}/auth/confirm`, { method: "POST", body, headers }));
}

describe("/auth/confirm", () => {
  beforeEach(() => {
    state.exchange = null;
    state.verify = { message: "invalid" };
    state.verifyCalls = [];
  });

  it("a sign-up link opened in the same browser lands back on the portal invitation, signed in", async () => {
    const response = await open(`code=pkce-code&next=${encodeURIComponent(NEXT)}`);
    expect(response.headers.get("location")).toBe(`${ORIGIN}${NEXT}`);
  });

  it("opened elsewhere (no PKCE verifier) it still goes back to the portal invitation", async () => {
    state.exchange = { message: "code verifier missing" };
    const response = await open(`code=pkce-code&next=${encodeURIComponent(NEXT)}`);
    expect(response.headers.get("location")).toBe(`${ORIGIN}${NEXT}`);
  });

  it("anything else that fails goes to sign-in", async () => {
    state.exchange = { message: "bad" };
    const response = await open(`code=pkce-code&next=${encodeURIComponent("/app")}`);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/sign-in?error=link_invalid`);
  });

  it("a token_hash link does not verify on GET: it shows a Continue form that posts back here", async () => {
    state.verify = null;
    const response = await open(`token_hash=pkce_abc123&type=magiclink&next=${encodeURIComponent("/app/matters")}`);
    expect(state.verifyCalls).toHaveLength(0);
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("Referrer-Policy")).toBe("same-origin");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const html = await response.text();
    expect(html).toContain('<meta name="referrer" content="same-origin">');
    expect(html).not.toContain("no-referrer");
    expect(html).toContain('<form method="post" action="/auth/confirm">');
    expect(html).toContain('name="token_hash" value="pkce_abc123"');
    expect(html).toContain('name="type" value="magiclink"');
    expect(html).toContain('name="next" value="/app/matters"');
    expect(html).toContain(">Continue</button>");
  });

  it("refuses an unexpected type or a malformed token on GET without a form", async () => {
    for (const query of ["token_hash=abc&type=sms", "token_hash=abc&type=phone_change", 'token_hash=%22%3E%3Cscript%3E&type=email']) {
      const response = await open(query);
      expect(response.headers.get("location")).toBe(`${ORIGIN}/sign-in?error=link_invalid`);
    }
    expect(state.verifyCalls).toHaveLength(0);
  });

  it("an unsafe next falls back to /app in the form", async () => {
    const response = await open(`token_hash=abc&type=recovery&next=${encodeURIComponent("//evil.example")}`);
    expect(await response.text()).toContain('name="next" value="/app"');
  });

  it("Continue from this site verifies the token and goes to next", async () => {
    state.verify = null;
    const response = await post({ token_hash: "pkce_abc123", type: "signup", next: "/app/matters" });
    expect(state.verifyCalls).toEqual([{ type: "signup", token_hash: "pkce_abc123" }]);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/app/matters`);
  });

  it("refuses a post from another site or with no Origin", async () => {
    state.verify = null;
    expect((await post({ token_hash: "abc", type: "email" }, "https://attacker.example")).status).toBe(403);
    expect((await post({ token_hash: "abc", type: "email" }, null)).status).toBe(403);
    expect((await post({ token_hash: "abc", type: "email" }, "null")).status).toBe(403);
    expect(state.verifyCalls).toHaveLength(0);
  });

  it("accepts Origin null or absent only when Sec-Fetch-Site is same-origin", async () => {
    state.verify = null;
    const nullOrigin = await post({ token_hash: "abc", type: "email", next: "/app" }, "null", "same-origin");
    expect(nullOrigin.status).toBe(303);
    expect(nullOrigin.headers.get("location")).toBe(`${ORIGIN}/app`);
    const noOrigin = await post({ token_hash: "abc", type: "email", next: "/app" }, null, "same-origin");
    expect(noOrigin.status).toBe(303);
    expect(state.verifyCalls).toHaveLength(2);
    state.verifyCalls = [];
    expect((await post({ token_hash: "abc", type: "email" }, "null", "cross-site")).status).toBe(403);
    expect((await post({ token_hash: "abc", type: "email" }, "null", "same-site")).status).toBe(403);
    expect((await post({ token_hash: "abc", type: "email" }, null, "none")).status).toBe(403);
    // A foreign Origin is refused even if Sec-Fetch-Site claims same-origin.
    expect((await post({ token_hash: "abc", type: "email" }, "https://attacker.example", "same-origin")).status).toBe(403);
    expect(state.verifyCalls).toHaveLength(0);
  });

  it("refuses an unexpected type on post, and keeps next safe", async () => {
    state.verify = null;
    const response = await post({ token_hash: "abc", type: "sms", next: "/app" });
    expect(state.verifyCalls).toHaveLength(0);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/sign-in?error=link_invalid`);
    const unsafe = await post({ token_hash: "abc", type: "email", next: "https://evil.example/x" });
    expect(unsafe.headers.get("location")).toBe(`${ORIGIN}/app`);
  });

  it("dot segments in next never redirect off this site", async () => {
    for (const next of ["/.//evil.example", "/%2e//evil.example", "/a/..//evil.example", "/a/%2e%2e//evil.example"]) {
      state.exchange = null;
      const viaCode = await open(`code=pkce-code&next=${encodeURIComponent(next)}`);
      expect(viaCode.headers.get("location"), next).toBe(`${ORIGIN}/app`);
      state.verify = null;
      const viaPost = await post({ token_hash: "abc", type: "email", next });
      expect(viaPost.headers.get("location"), next).toBe(`${ORIGIN}/app`);
    }
  });

  it("a failed verification sends an invitee back to the invitation, anyone else to sign-in", async () => {
    expect((await post({ token_hash: "abc", type: "signup", next: NEXT })).headers.get("location")).toBe(`${ORIGIN}${NEXT}`);
    expect((await post({ token_hash: "abc", type: "signup", next: "/app" })).headers.get("location")).toBe(`${ORIGIN}/sign-in?error=link_invalid`);
  });
});
