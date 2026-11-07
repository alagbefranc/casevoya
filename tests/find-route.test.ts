import { beforeEach, describe, expect, it, vi } from "vitest";
import { FIND_NOT_SENT } from "@/modules/find/request";

const state = vi.hoisted(() => ({
  denied: false,
  id: "11111111-1111-4111-8111-111111111111" as string | null,
  error: null as { message: string } | null,
  calls: [] as string[],
}));

vi.mock("@/lib/security/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/security/rate-limit")>();
  return { ...actual, rateLimit: async () => !state.denied };
});

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    rpc: async (name: string) => {
      state.calls.push(name);
      return { data: state.id, error: state.error };
    },
  }),
}));

const route = await import("@/app/api/find/route");

const sample = {
  goal: "Study in Canada",
  country: "Nigeria",
  code: "NG",
  zone: "Africa/Lagos",
  language: "English",
  name: "Rohan",
  email: "rohan@example.com",
  consent: true,
};

function post(body: unknown) {
  return new Request("https://find.casevoya.ca/api/find", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.9" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  state.denied = false;
  state.id = "11111111-1111-4111-8111-111111111111";
  state.error = null;
  state.calls = [];
});

describe("POST /api/find", () => {
  it("stores an accepted request and does not return the row id", async () => {
    const response = await route.POST(post(sample));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(state.calls).toEqual(["submit_consultant_connect"]);
  });

  it("says it was not sent when consent is missing, and does not call the database", async () => {
    const response = await route.POST(post({ ...sample, consent: false }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "consent_required", message: FIND_NOT_SENT });
    expect(state.calls).toEqual([]);
  });

  it("says it was not sent when the database refuses", async () => {
    state.error = { message: "down" };
    const response = await route.POST(post(sample));
    expect(response.status).toBe(502);
    expect((await response.json()).message).toBe(FIND_NOT_SENT);
  });

  it("answers 429 before any database work when the address is over the edge limit", async () => {
    state.denied = true;
    const response = await route.POST(post(sample));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(state.calls).toEqual([]);
  });
});
