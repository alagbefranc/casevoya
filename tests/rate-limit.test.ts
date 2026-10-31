import { beforeEach, describe, expect, it, vi } from "vitest";

// The Workers rate-limit helper: fails open without a binding, keys by binding name and visitor
// address (IPv6 as its /64), and the 429 answer carries Retry-After.

const state = vi.hoisted(() => ({
  env: null as Record<string, unknown> | null,
  headers: new Headers() as Headers | null,
}));

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => {
    if (!state.env) throw new Error("no Cloudflare context");
    return { env: state.env };
  },
}));
vi.mock("next/headers", () => ({
  headers: async () => {
    if (!state.headers) throw new Error("outside a request");
    return state.headers;
  },
}));

const { RATE_LIMIT_MESSAGE, clientIp, rateLimit, requestIp, tooManyRequests } = await import("@/lib/security/rate-limit");
const { ipKey } = await import("@/lib/security/client-address");
const { clientHash } = await import("@/modules/scheduling/public-api");

beforeEach(() => {
  state.env = null;
  state.headers = new Headers();
});

describe("rateLimit", () => {
  it("allows when there is no Cloudflare context or no binding", async () => {
    expect(await rateLimit("RL_AUTH", "203.0.113.9")).toBe(true);
    state.env = {};
    expect(await rateLimit("RL_AUTH", "203.0.113.9")).toBe(true);
  });

  it("returns false when the binding refuses, with the key prefixed by the binding name", async () => {
    const keys: string[] = [];
    state.env = {
      RL_VERIFY: {
        limit: async ({ key }: { key: string }) => {
          keys.push(key);
          return { success: false };
        },
      },
    };
    expect(await rateLimit("RL_VERIFY", "user:abc")).toBe(false);
    expect(keys).toEqual(["RL_VERIFY:user:abc"]);
  });

  it("allows when the binding answers success or throws", async () => {
    state.env = { RL_PUBLIC: { limit: async () => ({ success: true }) }, RL_PAYMENT: { limit: async () => Promise.reject(new Error("down")) } };
    expect(await rateLimit("RL_PUBLIC", "x")).toBe(true);
    expect(await rateLimit("RL_PAYMENT", "x")).toBe(true);
  });
});

describe("visitor address keys", () => {
  it("cuts IPv6 to its /64 and keeps IPv4", () => {
    expect(ipKey("203.0.113.9")).toBe("203.0.113.9");
    expect(ipKey("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toBe("2001:db8:1:2::/64");
    expect(ipKey("2001:0DB8:0001:0002::1")).toBe("2001:db8:1:2::/64");
    expect(ipKey("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(ipKey("::ffff:198.51.100.7")).toBe("198.51.100.7");
    expect(ipKey("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
  });

  it("reads cf-connecting-ip first, then x-forwarded-for, else unknown", () => {
    expect(requestIp(new Headers({ "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "198.51.100.1" }))).toBe("203.0.113.9");
    expect(requestIp(new Headers({ "x-forwarded-for": "198.51.100.1, 10.0.0.1" }))).toBe("198.51.100.1");
    expect(requestIp(new Headers({ "cf-connecting-ip": "2001:db8:1:2:3:4:5:6" }))).toBe("2001:db8:1:2::/64");
    expect(requestIp(new Headers({ "cf-connecting-ip": "not-an-ip" }))).toBe("unknown");
    expect(requestIp(new Headers())).toBe("unknown");
  });

  it("clientIp reads the server action's headers and falls back outside a request", async () => {
    state.headers = new Headers({ "cf-connecting-ip": "2001:db8:aa:bb::9" });
    expect(await clientIp()).toBe("2001:db8:aa:bb::/64");
    state.headers = null;
    expect(await clientIp()).toBe("unknown");
  });

  it("the booking and enquiry hash counts one IPv6 /64 as one address", async () => {
    const a = await clientHash("2001:db8:1:2::1", "salt");
    const b = await clientHash("2001:db8:1:2:ffff::9", "salt");
    const other = await clientHash("2001:db8:1:3::1", "salt");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(b);
    expect(a).not.toBe(other);
    expect(await clientHash("203.0.113.9", "salt")).not.toBe(await clientHash("203.0.113.10", "salt"));
  });
});

describe("countdown words", () => {
  it("an app limit counts down without claiming an email was sent", async () => {
    const { countdownText, rateLimitText, waitText } = await import("@/lib/auth/signup-errors");
    expect(countdownText(RATE_LIMIT_MESSAGE)).toBe(waitText);
    expect(countdownText(rateLimitText(16))).toBe(rateLimitText);
    expect(waitText(5)).toBe("Too many attempts. You can try again in 5 seconds.");
    expect(waitText(0)).toBe("You can try again now.");
  });
});

describe("tooManyRequests", () => {
  it("answers 429 JSON with Retry-After and no-store", async () => {
    const response = tooManyRequests();
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "rate_limited", message: RATE_LIMIT_MESSAGE });
    expect(tooManyRequests(600).headers.get("retry-after")).toBe("600");
  });
});
