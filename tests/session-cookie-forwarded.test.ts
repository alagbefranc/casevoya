import { afterEach, describe, expect, it, vi } from "vitest";
import { authCookieOptions, authCookieSecure } from "@/lib/supabase/cookie-options";

/**
 * Production must keep the session cookie Secure even when the request carries client-supplied
 * forwarding headers. httpOnly stays unset: the browser client reads the session.
 */

const headerState = vi.hoisted(() => ({ current: new Headers() }));
const captured = vi.hoisted(() => ({ options: [] as { cookieOptions?: Record<string, unknown> }[] }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [],
    set: () => undefined,
  }),
  headers: async () => headerState.current,
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: (_url: string, _key: string, options: { cookieOptions?: Record<string, unknown> }) => {
    captured.options.push(options);
    return { auth: { getClaims: async () => ({ data: null }) } };
  },
}));

afterEach(() => {
  vi.unstubAllEnvs();
  headerState.current = new Headers();
  captured.options = [];
});

describe("production session cookies ignore forwarded headers", () => {
  it("is Secure in production for plain-http localhost, the values those headers produce", () => {
    expect(authCookieSecure("http:", "localhost", true)).toBe(true);
    expect(authCookieSecure("", "localhost", true)).toBe(true);
    expect(authCookieSecure("http:", "127.0.0.1", true)).toBe(true);
    expect(authCookieSecure("http:", "app.casevoya.ca", true)).toBe(true);
    // Development still omits Secure on plain http, including localhost.
    expect(authCookieSecure("http:", "localhost", false)).toBe(false);
    expect(authCookieSecure("https:", "localhost", false)).toBe(true);
    expect(authCookieOptions(true)).toEqual({ secure: true, sameSite: "lax", path: "/" });
    expect(authCookieOptions(true)).not.toHaveProperty("httpOnly");
  });

  it("createClient keeps Secure when X-Forwarded-Proto and X-Forwarded-Host say http localhost", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://proj.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    headerState.current = new Headers({
      "x-forwarded-proto": "http, https",
      "x-forwarded-host": "localhost, app.casevoya.ca",
    });
    const { createClient } = await import("@/lib/supabase/server");
    await createClient();
    expect(captured.options.at(-1)?.cookieOptions).toEqual({ secure: true, sameSite: "lax", path: "/" });

    headerState.current = new Headers({
      "x-forwarded-proto": "https",
      "x-forwarded-host": "app.casevoya.ca",
    });
    await createClient();
    expect(captured.options.at(-1)?.cookieOptions).toEqual({ secure: true, sameSite: "lax", path: "/" });
  });
});
