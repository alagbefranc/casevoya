import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/email/routing/reconcile/route";
import {
  EMAIL_ROUTING_ZONE_ID,
  INBOUND_EMAIL_WORKER,
  applyFirmSlugRoute,
  firmRulePayload,
  provisionFirmSlug,
  reconcileFirmRoutes,
  type RoutingRule,
} from "@/modules/email/routing";

const ZONE = `https://api.cloudflare.com/client/v4/zones/${EMAIL_ROUTING_ZONE_ID}/email/routing/rules`;

type Call = { url: string; method: string; body?: string; authorization?: string };

function rule(partial: Partial<RoutingRule> & Pick<RoutingRule, "id" | "name">): RoutingRule {
  return {
    enabled: true,
    matchers: [],
    actions: [{ type: "worker", value: [INBOUND_EMAIL_WORKER] }],
    ...partial,
  };
}

function literal(address: string) {
  return [{ type: "literal", field: "to", value: address }];
}

function mockZone(initial: RoutingRule[], opts?: { failCreate?: boolean; throwOn?: string }) {
  const rules = initial.map((item) => ({ ...item }));
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
    calls.push({ url, method: init.method, body: init.body, authorization: init.headers.authorization });
    if (opts?.throwOn && init.method === opts.throwOn) throw new Error("socket");
    if (init.method === "GET") {
      const parsed = new URL(url);
      const page = Number(parsed.searchParams.get("page") ?? "1");
      const perPage = Number(parsed.searchParams.get("per_page") ?? "50");
      const start = (page - 1) * perPage;
      const slice = rules.slice(start, start + perPage);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          result: slice,
          result_info: { page, per_page: perPage, count: slice.length, total_count: rules.length },
        }),
      };
    }
    if (init.method === "POST") {
      if (opts?.failCreate) {
        return { ok: false, status: 500, json: async () => ({ success: false, errors: [{ message: "unavailable" }] }) };
      }
      const body = JSON.parse(init.body ?? "{}") as Record<string, unknown>;
      const created = { id: `created-${rules.length + 1}`, enabled: true, ...body };
      rules.push(created as RoutingRule);
      return { ok: true, status: 200, json: async () => ({ success: true, result: created }) };
    }
    if (init.method === "DELETE") {
      const id = decodeURIComponent(url.split("/").pop() ?? "");
      const index = rules.findIndex((item) => item.id === id);
      if (index < 0) {
        return { ok: false, status: 404, json: async () => ({ success: false, errors: [{ message: "not found" }] }) };
      }
      rules.splice(index, 1);
      return { ok: true, status: 200, json: async () => ({ success: true, result: { id } }) };
    }
    throw new Error(init.method);
  };
  return { fetchImpl, calls, rules };
}

const client = (fetchImpl: ReturnType<typeof mockZone>["fetchImpl"]) => ({
  token: "routing-token",
  fetchImpl,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("firm routing rules", () => {
  it("builds one exact base rule and no plus-tag rule", () => {
    expect(firmRulePayload("northline", "docs.casevoya.ca")).toEqual({
      name: "casevoya-firm:northline",
      enabled: true,
      source: "api",
      matchers: [{ type: "literal", field: "to", value: "northline@docs.casevoya.ca" }],
      actions: [{ type: "worker", value: ["casevoya-inbound-email"] }],
    });
    expect(JSON.stringify(firmRulePayload("northline", "docs.casevoya.ca"))).not.toContain("+");
  });

  it("adds missing firm rules, removes stale owned rules, and leaves the test address and catch-all", async () => {
    const zone = mockZone([
      rule({
        id: "kept-firm",
        name: "casevoya-firm:northline",
        matchers: literal("northline@docs.casevoya.ca"),
      }),
      rule({
        id: "old-firm",
        name: "casevoya-firm:retired",
        matchers: literal("retired@docs.casevoya.ca"),
      }),
      rule({
        id: "plus-rule",
        name: "casevoya-firm:northline+tok",
        matchers: literal("northline+aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa@docs.casevoya.ca"),
      }),
      rule({
        id: "test-rule",
        name: "casevoya test inbox",
        matchers: literal("casevoya-test@docs.casevoya.ca"),
      }),
      rule({
        id: "catch-all",
        name: "catch-all",
        matchers: [{ type: "all" }],
      }),
    ]);
    const result = await reconcileFirmRoutes(["northline", "harbour", "support"], client(zone.fetchImpl));
    expect(result.failures).toEqual([]);
    expect(result.added).toEqual(["harbour"]);
    expect(result.removed.map((item) => item.id).sort()).toEqual(["old-firm", "plus-rule"]);
    expect(result.skipped).toEqual(["support"]);
    const ids = zone.rules.map((item) => item.id);
    expect(ids).toEqual(expect.arrayContaining(["kept-firm", "test-rule", "catch-all"]));
    expect(ids).not.toContain("old-firm");
    expect(ids).not.toContain("plus-rule");

    const post = zone.calls.find((call) => call.method === "POST");
    expect(post?.url).toBe(ZONE);
    expect(post?.authorization).toBe("Bearer routing-token");
    expect(post?.url).not.toContain("c8010438fc56280e3ea5747a123e818a");
    const body = JSON.parse(post?.body ?? "{}") as { matchers: { value: string }[] };
    expect(body.matchers[0].value).toBe("harbour@docs.casevoya.ca");
    expect(body.matchers[0].value).not.toContain("+");
    const deleted = zone.calls.filter((call) => call.method === "DELETE").map((call) => call.url);
    expect(deleted).not.toContain(`${ZONE}/test-rule`);
    expect(deleted).not.toContain(`${ZONE}/catch-all`);
  });

  it("pages through the zone list before deleting a stale rule", async () => {
    const fillers = Array.from({ length: 50 }, (_, index) =>
      rule({ id: `other-${index}`, name: `manual-${index}`, matchers: literal(`other-${index}@example.test`) }),
    );
    const zone = mockZone([
      ...fillers,
      rule({ id: "stale", name: "casevoya-firm:gone", matchers: literal("gone@docs.casevoya.ca") }),
    ]);
    const result = await reconcileFirmRoutes([], client(zone.fetchImpl));
    expect(result.removed).toEqual([{ id: "stale", name: "casevoya-firm:gone" }]);
    expect(zone.calls.filter((call) => call.method === "GET")).toHaveLength(2);
    expect(zone.calls.filter((call) => call.method === "DELETE")).toHaveLength(1);
  });

  it("does not delete from a partial list", async () => {
    const fetchImpl = async (url: string, init: { method: string; headers: Record<string, string> }) => {
      expect(init.method).toBe("GET");
      expect(url).toContain(EMAIL_ROUTING_ZONE_ID);
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, result: [], result_info: { page: 1, per_page: 50, total_count: 5000 } }),
      };
    };
    const result = await reconcileFirmRoutes(["northline"], { token: "routing-token", fetchImpl });
    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([]);
    expect(result.failures[0]?.op).toBe("list");
  });

  it("creates the new slug before deleting the old one, and keeps the old rule when create fails", async () => {
    const zone = mockZone([
      rule({ id: "old-firm", name: "casevoya-firm:retired", matchers: literal("retired@docs.casevoya.ca") }),
      rule({ id: "test-rule", name: "casevoya test inbox", matchers: literal("casevoya-test@docs.casevoya.ca") }),
    ]);
    const changed = await applyFirmSlugRoute({ claimed: "harbour", released: "retired" }, client(zone.fetchImpl));
    expect(changed.ok).toBe(true);
    const methods = zone.calls.map((call) => call.method);
    expect(methods.indexOf("POST")).toBeLessThan(methods.lastIndexOf("DELETE"));
    expect(zone.rules.map((item) => item.id)).toContain("test-rule");
    expect(zone.rules.map((item) => item.id)).not.toContain("old-firm");

    const blocked = mockZone(
      [rule({ id: "old-firm", name: "casevoya-firm:retired", matchers: literal("retired@docs.casevoya.ca") })],
      { failCreate: true },
    );
    const failed = await applyFirmSlugRoute({ claimed: "harbour", released: "retired" }, client(blocked.fetchImpl));
    expect(failed.ok).toBe(false);
    expect(failed.failures[0]).toMatchObject({ op: "create", slug: "harbour" });
    expect(blocked.calls.some((call) => call.method === "DELETE")).toBe(false);
    expect(blocked.rules.map((item) => item.id)).toContain("old-firm");
  });

  it("deletes only the owned rule when a slug is released", async () => {
    const zone = mockZone([
      rule({ id: "old-firm", name: "casevoya-firm:retired", matchers: literal("retired@docs.casevoya.ca") }),
      rule({ id: "catch-all", name: "catch-all", matchers: [{ type: "all" }] }),
    ]);
    const result = await applyFirmSlugRoute({ released: "retired" }, client(zone.fetchImpl));
    expect(result.ok).toBe(true);
    expect(zone.rules.map((item) => item.id)).toEqual(["catch-all"]);
  });

  it("logs a routing failure and still resolves so the slug claim can finish", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const zone = mockZone([], { throwOn: "POST" });
    await expect(provisionFirmSlug({ claimed: "harbour" }, client(zone.fetchImpl))).resolves.toBeUndefined();
    expect(errors).toHaveBeenCalled();
    expect(String(errors.mock.calls[0]?.join(" "))).toContain("harbour");

    const fetched = vi.fn();
    await provisionFirmSlug({ claimed: "harbour" }, { token: "  ", fetchImpl: fetched });
    expect(fetched).not.toHaveBeenCalled();
    expect(String(errors.mock.calls.at(-1)?.join(" "))).toContain("CLOUDFLARE_ROUTING_API_TOKEN");
  });

  it("rejects a reconcile call without the bearer secret", async () => {
    const previous = {
      secret: process.env.EMAIL_ROUTING_RECONCILE_SECRET,
      token: process.env.CLOUDFLARE_ROUTING_API_TOKEN,
      service: process.env.SUPABASE_SECRET_KEY,
    };
    process.env.EMAIL_ROUTING_RECONCILE_SECRET = "reconcile-secret";
    process.env.CLOUDFLARE_ROUTING_API_TOKEN = "routing-token";
    process.env.SUPABASE_SECRET_KEY = "service-key";
    const restore = (name: string, value: string | undefined) => {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    };
    try {
      const missing = await POST(new Request("https://app.example/api/email/routing/reconcile", { method: "POST" }));
      expect(missing.status).toBe(401);
      const wrong = await POST(
        new Request("https://app.example/api/email/routing/reconcile", {
          method: "POST",
          headers: { authorization: "Bearer other-secret" },
        }),
      );
      expect(wrong.status).toBe(401);
    } finally {
      restore("EMAIL_ROUTING_RECONCILE_SECRET", previous.secret);
      restore("CLOUDFLARE_ROUTING_API_TOKEN", previous.token);
      restore("SUPABASE_SECRET_KEY", previous.service);
    }
  });

  it("pins workers_dev off and does not alter storage in the search_path migration", () => {
    const root = path.resolve(import.meta.dirname, "..");
    const wrangler = readFileSync(path.join(root, "workers/inbound-email/wrangler.toml"), "utf8");
    expect(wrangler).toMatch(/workers_dev\s*=\s*false/);
    const sql = readFileSync(
      path.join(root, "supabase/migrations/20261017200300_reserved_firm_slugs_search_path.sql"),
      "utf8",
    );
    expect(sql).toMatch(/set search_path = ''/);
    expect(sql).toMatch(/pg_catalog\.text/);
    expect(sql.toLowerCase()).not.toMatch(/alter\s+table\s+storage/);
  });
});
