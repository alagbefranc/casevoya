import { beforeEach, describe, expect, it, vi } from "vitest";

// Public POST routes check the Workers limit (RL_PUBLIC, per visitor address) before any database
// work; database 429s carry Retry-After.

const state = vi.hoisted(() => ({
  denied: false,
  keys: [] as string[],
  dbCalls: [] as string[],
  submit: { data: { ok: true } as unknown, error: null },
}));

vi.mock("@/lib/security/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/security/rate-limit")>();
  return {
    ...actual,
    rateLimit: async (name: string, key: string) => {
      state.keys.push(`${name}:${key}`);
      return !state.denied;
    },
  };
});
vi.mock("@/modules/scheduling/public-deps", () => ({
  clientAddress: (headers: Headers) => headers.get("cf-connecting-ip"),
  sessionViewerWithAssurance: async () => null,
  publicDeps: async () => {
    state.dbCalls.push("publicDeps");
    throw new Error("no database in this test");
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: async (name: string) => {
      state.dbCalls.push(name);
      return { data: { firm_name: "Maple", firm_slug: "maple", practice: false, staff: false }, error: null };
    },
    auth: { getClaims: async () => ({ data: null }) },
  }),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    rpc: async (name: string) => {
      state.dbCalls.push(name);
      return state.submit;
    },
  }),
}));

const hold = await import("@/app/api/book/[firm]/[event]/hold/route");
const enquiry = await import("@/app/api/enquiry/[firm]/route");

const json = (body: unknown, ip = "2001:db8:1:2::7") =>
  new Request("https://app.test/x", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": ip }, body: JSON.stringify(body) });
const form = { name: "Wei Zhang", contact: "wei@example.test", reply: true, marketing: false, key: "k-12345678", elapsedMs: 9000, source: "web_form" };

beforeEach(() => {
  state.denied = false;
  state.keys = [];
  state.dbCalls = [];
  state.submit = { data: { ok: true }, error: null };
});

describe("POST /api/book/<firm>/<event>/hold", () => {
  it("answers 429 with Retry-After before any database work when the address is over the limit", async () => {
    state.denied = true;
    const response = await hold.POST(json({}), { params: Promise.resolve({ firm: "synthetic", event: "initial" }) });
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(await response.json()).toMatchObject({ error: "rate_limited" });
    expect(state.keys).toEqual(["RL_PUBLIC:2001:db8:1:2::/64"]);
    expect(state.dbCalls).toEqual([]);
  });

  it("goes on to the booking when allowed", async () => {
    const response = await hold.POST(json({}), { params: Promise.resolve({ firm: "synthetic", event: "initial" }) });
    expect(response.status).toBe(502);
    expect(state.dbCalls).toEqual(["publicDeps"]);
  });
});

describe("POST /api/enquiry/<firm>", () => {
  it("answers 429 with Retry-After before any database work when the address is over the limit", async () => {
    state.denied = true;
    const response = await enquiry.POST(json(form, "203.0.113.9"), { params: Promise.resolve({ firm: "maple" }) });
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(state.keys).toEqual(["RL_PUBLIC:203.0.113.9"]);
    expect(state.dbCalls).toEqual([]);
  });

  it("passes the database's own limit on with Retry-After 600", async () => {
    state.submit = { data: { ok: false, error: "enquiry_rate_limited" }, error: null };
    const response = await enquiry.POST(json(form, "203.0.113.9"), { params: Promise.resolve({ firm: "maple" }) });
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("600");
    expect(state.dbCalls).toEqual(["enquiry_public_firm", "submit_enquiry"]);
  });
});
