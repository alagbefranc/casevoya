import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getClaims: async () => ({ data: null }),
      getAuthenticatorAssuranceLevel: async () => ({ data: null }),
    },
    rpc: async () => ({ data: null, error: null }),
    from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) }),
  }),
}));

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://proj.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function rewritePath(response: Response): string {
  return response.headers.get("x-middleware-rewrite") ?? "";
}

describe("Find host routing", () => {
  it("sends an unauthenticated app /sheet to sign-in when X-Forwarded-Host says find.casevoya.ca", async () => {
    const { updateSession } = await import("@/lib/supabase/proxy");
    const response = await updateSession(
      new NextRequest("https://app.casevoya.ca/sheet", {
        headers: { host: "app.casevoya.ca", "x-forwarded-host": "find.casevoya.ca" },
      }),
    );
    expect(response.headers.get("location") ?? "").toContain("/sign-in");
    expect(rewritePath(response)).not.toContain("/find/sheet");
  });

  it("serves Find from the platform Host even when X-Forwarded-Host names another site", async () => {
    const { updateSession } = await import("@/lib/supabase/proxy");
    const plain = await updateSession(new NextRequest("https://find.casevoya.ca/", { headers: { host: "find.casevoya.ca" } }));
    expect(rewritePath(plain)).toContain("/find/index.html");
    expect(plain.headers.get("x-robots-tag")).toContain("noindex");
    expect(plain.headers.get("location")).toBeNull();

    const lied = await updateSession(
      new NextRequest("https://find.casevoya.ca/", {
        headers: { host: "find.casevoya.ca", "x-forwarded-host": "app.casevoya.ca" },
      }),
    );
    expect(rewritePath(lied)).toContain("/find/index.html");
    expect(lied.headers.get("location")).toBeNull();
  });
});
