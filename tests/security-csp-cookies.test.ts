import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ENFORCED_CSP, applyContentSecurityPolicy, reportOnlyCsp } from "@/lib/security/csp";
import { applyFraming } from "@/lib/security/framing";
import { AUTH_COOKIE_MAX_AGE, authCookieOptions, authCookieSecure, capAuthCookie } from "@/lib/supabase/cookie-options";

// The app-wide CSP set by the proxy (report-only allowlist plus an enforced object-src/base-uri
// baseline, framing rules kept) and the Supabase auth cookie settings.

const ssr = vi.hoisted(() => ({ options: [] as { cookieOptions?: Record<string, unknown> }[] }));
vi.mock("@supabase/ssr", () => ({
  createServerClient: (_url: string, _key: string, options: { cookieOptions?: Record<string, unknown> }) => {
    ssr.options.push(options);
    return { auth: { getClaims: async () => ({ data: null }) }, rpc: async () => ({ data: null, error: null }) };
  },
}));

const ENV = { supabaseUrl: "https://proj.supabase.co", liveKitUrl: "wss://casevoya.livekit.cloud", dev: false };

function directive(policy: string, name: string): string {
  return policy.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name} `)) ?? "";
}

beforeEach(() => {
  ssr.options = [];
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://proj.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Content-Security-Policy", () => {
  it("report-only policy allows what the app loads and nothing broader", () => {
    const policy = reportOnlyCsp("/sheet", ENV);
    expect(directive(policy, "default-src")).toBe("default-src 'self'");
    expect(directive(policy, "script-src")).toContain("https://js.stripe.com");
    expect(directive(policy, "script-src")).not.toContain("'unsafe-eval'");
    expect(directive(policy, "connect-src")).toContain("https://proj.supabase.co");
    expect(directive(policy, "connect-src")).toContain("wss://proj.supabase.co");
    expect(directive(policy, "connect-src")).toContain("wss://casevoya.livekit.cloud");
    expect(directive(policy, "connect-src")).toContain("https://api.stripe.com");
    expect(directive(policy, "img-src")).toBe("img-src 'self' data: blob: https:");
    expect(directive(policy, "object-src")).toBe("object-src 'none'");
    expect(directive(policy, "base-uri")).toBe("base-uri 'self'");
    expect(directive(policy, "form-action")).toBe("form-action 'self'");
    expect(directive(policy, "frame-ancestors")).toBe("frame-ancestors 'self'");
    expect(directive(reportOnlyCsp("/sheet", { ...ENV, dev: true }), "script-src")).toContain("'unsafe-eval'");
    expect(directive(reportOnlyCsp("/sheet", { liveKitUrl: "not a url" }), "connect-src")).not.toContain("not");
  });

  it("keeps frame-ancestors * on the embedded enquiry form", () => {
    const headers = new Headers();
    applyFraming(headers, "/embed/enquiry/maple");
    applyContentSecurityPolicy(headers, "/embed/enquiry/maple", ENV);
    expect(headers.get("Content-Security-Policy")).toBe(`frame-ancestors *; ${ENFORCED_CSP}`);
    expect(headers.get("X-Frame-Options")).toBeNull();
    expect(directive(headers.get("Content-Security-Policy-Report-Only") ?? "", "frame-ancestors")).toBe("frame-ancestors *");
  });

  it("other pages enforce only the baseline beside X-Frame-Options; /api routes are left alone", () => {
    const page = new Headers();
    applyFraming(page, "/portal");
    applyContentSecurityPolicy(page, "/portal", ENV);
    expect(page.get("X-Frame-Options")).toBe("SAMEORIGIN");
    expect(page.get("Content-Security-Policy")).toBe("object-src 'none'; base-uri 'self'");
    expect(page.get("Content-Security-Policy-Report-Only")).toContain("default-src 'self'");
    applyContentSecurityPolicy(page, "/portal", ENV);
    expect(page.get("Content-Security-Policy")).toBe("object-src 'none'; base-uri 'self'");

    const api = new Headers();
    applyContentSecurityPolicy(api, "/api/documents/preview/x", ENV);
    expect(api.get("Content-Security-Policy")).toBeNull();
    expect(api.get("Content-Security-Policy-Report-Only")).toBeNull();
  });

  it("the proxy sends both headers on pages and keeps the embed framable", async () => {
    const { proxy } = await import("@/proxy");
    const sheet = await proxy(new NextRequest("https://app.casevoya.ca/sign-in"));
    expect(sheet.headers.get("Content-Security-Policy")).toBe(ENFORCED_CSP);
    expect(sheet.headers.get("Content-Security-Policy-Report-Only")).toContain("connect-src 'self' https://proj.supabase.co");
    expect(sheet.headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
  });
});

describe("auth cookie options", () => {
  it("is Secure on https and in production, not on plain-http localhost", () => {
    expect(authCookieSecure("https:", "app.casevoya.ca", false)).toBe(true);
    expect(authCookieSecure("https:", "localhost", false)).toBe(true);
    expect(authCookieSecure("http:", "localhost", true)).toBe(false);
    expect(authCookieSecure("http:", "127.0.0.1", false)).toBe(false);
    expect(authCookieSecure("", "localhost", true)).toBe(false);
    expect(authCookieSecure("http:", "app.casevoya.ca", true)).toBe(true);
    expect(authCookieSecure("http:", "192.168.1.5", false)).toBe(false);
    expect(authCookieOptions(true)).toEqual({ secure: true, sameSite: "lax", path: "/" });
  });

  it("caps the lifetime at 30 days and leaves removals alone", () => {
    expect(capAuthCookie({ maxAge: 400 * 24 * 60 * 60, httpOnly: false })).toEqual({ maxAge: AUTH_COOKIE_MAX_AGE, httpOnly: false });
    expect(capAuthCookie({ maxAge: 0 })).toEqual({ maxAge: 0 });
    expect(capAuthCookie<{ maxAge?: number; path?: string }>({ path: "/" })).toEqual({ path: "/" });
    expect(AUTH_COOKIE_MAX_AGE).toBe(30 * 24 * 60 * 60);
  });

  it("the proxy's Supabase client gets Secure lax cookies on https and not on http://localhost", async () => {
    const { proxy } = await import("@/proxy");
    await proxy(new NextRequest("https://app.casevoya.ca/sign-in"));
    await proxy(new NextRequest("http://localhost:3000/sign-in"));
    expect(ssr.options.map((options) => options.cookieOptions)).toEqual([
      { secure: true, sameSite: "lax", path: "/" },
      { secure: false, sameSite: "lax", path: "/" },
    ]);
  });
});
