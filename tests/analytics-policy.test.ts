import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ANALYTICS_ALLOWED_FIELDS,
  ANALYTICS_BEACON_HOSTS,
  ANALYTICS_SDKS,
  operationalEvent,
  PRODUCT_ANALYTICS_COPY,
  PRODUCT_ANALYTICS_ENABLED,
} from "@/modules/analytics/policy";

// ADM-04: product analytics use operational metadata only. Casevoya runs none today; this guards
// that no analytics SDK or beacon arrives without going through src/modules/analytics/policy.ts.

const root = path.resolve(__dirname, "..");
const SOURCE_DIRS = ["src", "services/vo-agent/src", "workers", "scripts", "public"];
const SKIP = new Set(["node_modules", ".next", ".open-next", "dist", ".wrangler"]);
const SOURCE = /\.(ts|tsx|js|jsx|mjs|cjs|mts|html)$/;
const POLICY_FILE = path.join(root, "src/modules/analytics/policy.ts");

function files(dir: string): string[] {
  const full = path.join(root, dir);
  let entries: string[];
  try {
    entries = readdirSync(full);
  } catch {
    return [];
  }
  return entries.flatMap((name) => {
    if (SKIP.has(name)) return [];
    const at = path.join(full, name);
    if (statSync(at).isDirectory()) return files(path.join(dir, name));
    return SOURCE.test(name) ? [at] : [];
  });
}

function escape(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

const IMPORT = new RegExp(`(?:from\\s+|import\\s*\\(\\s*|require\\s*\\(\\s*|import\\s+)["'](?:${ANALYTICS_SDKS.map(escape).join("|")})(?:/[^"']*)?["']`);
const BEACON = new RegExp(ANALYTICS_BEACON_HOSTS.map(escape).join("|"));
const USES_POLICY = /["'](?:@\/modules\/analytics\/policy|(?:\.\.?\/)+(?:[\w-]+\/)*analytics\/policy)["']/;

describe("Product analytics policy", () => {
  it("lists no analytics SDK as a dependency while analytics is off", () => {
    for (const manifest of ["package.json", "services/vo-agent/package.json"]) {
      const pkg = JSON.parse(readFileSync(path.join(root, manifest), "utf8")) as Record<string, Record<string, string> | undefined>;
      const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies });
      const found = deps.filter((name) => (ANALYTICS_SDKS as readonly string[]).includes(name));
      if (!PRODUCT_ANALYTICS_ENABLED) expect(found, manifest).toEqual([]);
    }
  });

  it("finds no analytics SDK import or beacon outside a file that applies the allowlist", () => {
    const offenders = SOURCE_DIRS.flatMap(files)
      .filter((file) => file !== POLICY_FILE)
      .filter((file) => {
        const text = readFileSync(file, "utf8");
        return (IMPORT.test(text) || BEACON.test(text)) && !USES_POLICY.test(text);
      })
      .map((file) => path.relative(root, file));
    expect(offenders).toEqual([]);
  });

  it("the guard recognises an SDK import and a beacon tag", () => {
    expect(IMPORT.test(`import posthog from "posthog-js";`)).toBe(true);
    expect(IMPORT.test(`const { track } = await import("@vercel/analytics/react");`)).toBe(true);
    expect(IMPORT.test(`import { analyticsCopy } from "./analytics-copy";`)).toBe(false);
    expect(BEACON.test(`<script src="https://www.googletagmanager.com/gtag/js?id=G-1"></script>`)).toBe(true);
    expect(USES_POLICY.test(`import { operationalEvent } from "@/modules/analytics/policy";`)).toBe(true);
  });

  it("keeps only allowlisted operational fields with plain values", () => {
    const event = operationalEvent({
      event: "matter.stage_changed",
      route: "/sheet/matters/[id]",
      duration_ms: 420,
      count: 1,
      tenant_ref: "t_9f2",
      // Never forwarded: narratives, identity numbers, documents, message bodies, names.
      narrative: "We met in 2019 and married in Toronto",
      uci: "1234-5678",
      passport_number: "AB123456",
      document: { name: "passport.pdf", text: "..." },
      message_body: "Here is my police certificate",
      display_name: "Ada Applicant",
      result: { nested: true },
      app_version: "x".repeat(500),
    });
    expect(event).toEqual({ event: "matter.stage_changed", route: "/sheet/matters/[id]", duration_ms: 420, count: 1, tenant_ref: "t_9f2" });
    for (const field of Object.keys(event)) expect(ANALYTICS_ALLOWED_FIELDS).toContain(field);
  });

  it("tells the firm in Settings that Casevoya runs no product analytics and what any would exclude", () => {
    expect(PRODUCT_ANALYTICS_ENABLED).toBe(false);
    expect(PRODUCT_ANALYTICS_COPY.detail).toMatch(/^Casevoya runs no product analytics\./);
    for (const word of ["immigration narratives", "identity numbers", "uploaded documents", "message bodies"]) expect(PRODUCT_ANALYTICS_COPY.detail).toContain(word);
  });
});
