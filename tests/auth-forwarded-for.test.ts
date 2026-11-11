import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SB_FORWARDED_FOR, cloudflareConnectingIp, supabaseAuthForwardHeaders } from "@/lib/security/client-address";

const captured = vi.hoisted(() => ({ headers: [] as Record<string, string>[] }));

vi.mock("@supabase/ssr", () => ({
  createServerClient: (_url: string, _key: string, options: { global?: { headers?: Record<string, string> } }) => {
    captured.headers.push(options.global?.headers ?? {});
    return {
      auth: { getClaims: async () => ({ data: null }) },
      rpc: async () => ({ data: null, error: null }),
    };
  },
}));

const headerState = vi.hoisted(() => ({ current: new Headers() }));

vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [], set: () => undefined }),
  headers: async () => headerState.current,
}));

afterEach(() => {
  vi.unstubAllEnvs();
  captured.headers = [];
  headerState.current = new Headers();
});

describe("Supabase Auth client IP", () => {
  it("reads only cf-connecting-ip", () => {
    const both = new Headers({ "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "198.51.100.1", "x-real-ip": "198.51.100.2" });
    expect(cloudflareConnectingIp(both)).toBe("203.0.113.9");
    expect(supabaseAuthForwardHeaders(both)).toEqual({ [SB_FORWARDED_FOR]: "203.0.113.9" });
    expect(supabaseAuthForwardHeaders(new Headers({ "x-forwarded-for": "198.51.100.1", "x-real-ip": "198.51.100.2" }))).toEqual({});
    expect(supabaseAuthForwardHeaders(new Headers({ "cf-connecting-ip": "not-an-ip" }))).toEqual({});
    expect(supabaseAuthForwardHeaders(new Headers({ "cf-connecting-ip": "2001:db8::1" }))).toEqual({ [SB_FORWARDED_FOR]: "2001:db8::1" });
  });

  it("the server client forwards that address and ignores x-forwarded-for", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://proj.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    headerState.current = new Headers({ "cf-connecting-ip": "203.0.113.50", "x-forwarded-for": "198.51.100.8" });
    const { createClient } = await import("@/lib/supabase/server");
    await createClient();
    expect(captured.headers.at(-1)?.[SB_FORWARDED_FOR]).toBe("203.0.113.50");

    headerState.current = new Headers({ "x-forwarded-for": "198.51.100.8" });
    await createClient();
    expect(captured.headers.at(-1)?.[SB_FORWARDED_FOR]).toBeUndefined();
  });

  it("the proxy client forwards cf-connecting-ip on the session refresh", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://proj.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    const { proxy } = await import("@/proxy");
    await proxy(new NextRequest("https://app.casevoya.ca/sign-in", { headers: { "cf-connecting-ip": "203.0.113.77", "x-forwarded-for": "198.51.100.1" } }));
    expect(captured.headers.at(-1)?.[SB_FORWARDED_FOR]).toBe("203.0.113.77");
    await proxy(new NextRequest("https://app.casevoya.ca/sign-in", { headers: { "x-forwarded-for": "198.51.100.1" } }));
    expect(captured.headers.at(-1)?.[SB_FORWARDED_FOR]).toBeUndefined();
  });
});
