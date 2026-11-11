import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HSTS, NOSNIFF, REFERRER_POLICY } from "@/lib/security/headers";

const calls = vi.hoisted(() => ({ claims: 0 }));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getClaims: async () => {
        calls.claims += 1;
        return { data: null };
      },
    },
    rpc: async () => ({ data: null, error: null }),
  }),
}));

beforeEach(() => {
  calls.claims = 0;
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://proj.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("security headers", () => {
  it("matches the Cloudflare edge values and limits camera and microphone to the call page", async () => {
    const { proxy } = await import("@/proxy");
    const page = await proxy(new NextRequest("https://app.casevoya.ca/sign-in"));
    expect(page.headers.get("X-Content-Type-Options")).toBe(NOSNIFF);
    expect(page.headers.get("Strict-Transport-Security")).toBe(HSTS);
    expect(page.headers.get("Strict-Transport-Security")).not.toContain("preload");
    expect(page.headers.get("Strict-Transport-Security")).not.toContain("includeSubDomains");
    expect(page.headers.get("Referrer-Policy")).toBe(REFERRER_POLICY);
    expect(page.headers.get("Permissions-Policy")).toBe("camera=(), microphone=()");
    expect(page.headers.get("Content-Security-Policy")).toBe("frame-ancestors 'self'");
    expect(page.headers.get("Content-Security-Policy-Report-Only")).toContain("script-src");

    const api = await proxy(new NextRequest("https://app.casevoya.ca/api/leads/move"));
    expect(api.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(api.headers.get("Strict-Transport-Security")).toBe("max-age=15552000");
    expect(api.headers.get("Content-Security-Policy")).toBe("frame-ancestors 'self'");
    expect(api.headers.get("Permissions-Policy")).toBe("camera=(), microphone=()");

    const call = await proxy(new NextRequest("https://app.casevoya.ca/call/abc"));
    expect(call.headers.get("Permissions-Policy")).toBe("camera=(self), microphone=(self)");
    expect(call.headers.get("location")).toContain("/sign-in");

    const mfa = await proxy(new NextRequest("https://app.casevoya.ca/mfa"));
    expect(mfa.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(mfa.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
});

describe("GET /api/health", () => {
  it("skips the auth client and is not redirected to sign-in", async () => {
    const { proxy } = await import("@/proxy");
    const response = await proxy(new NextRequest("https://app.casevoya.ca/api/health"));
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(calls.claims).toBe(0);
    const sheet = await proxy(new NextRequest("https://app.casevoya.ca/sheet"));
    expect(sheet.headers.get("location")).toContain("/sign-in");
    expect(calls.claims).toBeGreaterThan(0);
  });

  it("returns 200 with only status, build_id and time when the database answers", async () => {
    vi.stubEnv("CASEVOYA_BUILD_ID", "abc123");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("openapi", { status: 200 })),
    );
    const { GET } = await import("@/app/api/health/route");
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual(["build_id", "status", "time"]);
    expect(body).toMatchObject({ status: "ok", build_id: "abc123" });
    expect(body.time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(JSON.stringify(body)).not.toContain("sb_publishable_test");
    expect(JSON.stringify(body)).not.toContain("proj.supabase.co");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns 503 when the database does not answer in time", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("timeout");
      }),
    );
    const { GET } = await import("@/app/api/health/route");
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ status: "unavailable", build_id: "unknown" });
  });
});
