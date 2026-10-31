import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Composio's Connect Link returns to Settings > Integrations on the configured app origin; a
// callback URL sent from the browser is ignored.

const state = vi.hoisted(() => ({ callbacks: [] as (string | undefined)[] }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    const query = {
      select: () => query,
      eq: () => query,
      order: () => query,
      limit: () => query,
      maybeSingle: async () => ({ data: { id: "m-1" }, error: null }),
    };
    return {
      auth: { getClaims: async () => ({ data: { claims: { sub: "u-1" } } }) },
      from: () => query,
      rpc: async () => ({ data: null, error: null }),
    };
  },
}));

vi.mock("@/modules/integrations/composio", () => ({
  composioConfigured: () => true,
  connectLink: async (_membershipId: string, _toolkit: string, callbackUrl?: string) => {
    state.callbacks.push(callbackUrl);
    return "https://connect.composio.example/link";
  },
  staffSession: async () => ({}),
  toolkitSession: async () => ({}),
}));

const { connectAccount } = await import("@/modules/integrations/actions");
const ORG = "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
let savedAppUrl: string | undefined;

beforeEach(() => {
  state.callbacks = [];
  savedAppUrl = process.env.APP_URL;
  process.env.APP_URL = "https://app.example.test";
});

afterEach(() => {
  if (savedAppUrl === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = savedAppUrl;
});

describe("connectAccount callback", () => {
  it("returns to Settings > Integrations on the app origin", async () => {
    expect(await connectAccount({ organizationId: ORG, toolkit: "gmail" })).toEqual({ ok: true, url: "https://connect.composio.example/link" });
    expect(state.callbacks).toEqual(["https://app.example.test/sheet/settings?tab=integrations&connected=gmail"]);
  });

  it("ignores a callback URL sent by the browser", async () => {
    for (const callbackUrl of ["https://evil.example/", "https://app.casevoya.ca/.//evil.example", "https://app.example.test/elsewhere"]) {
      await connectAccount({ organizationId: ORG, toolkit: "outlook_calendar", callbackUrl });
    }
    expect(state.callbacks).toEqual(Array(3).fill("https://app.example.test/sheet/settings?tab=integrations&connected=outlook_calendar"));
  });
});
