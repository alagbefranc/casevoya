import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name === "database.types.ts") continue;
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) walk(path, out);
    else if (/\.(tsx|ts|css|html|js|svg|json)$/.test(name)) out.push(path);
  }
  return out;
}

const product = [...walk(join(ROOT, "src")), ...walk(join(ROOT, "public/find"))];

function text(path: string): string {
  return readFileSync(path, "utf8");
}

/** A family name used as the active face, not a substring of another word. */
const BANNED_FACE = /(?:font-family\s*:\s*["']?|font\s*:\s*[^;{]*?\s|family"\s*:\s*")(?:Inter|Geist|Space Grotesk|Space Grotesque)\b/;

describe("rejected interface habits", () => {
  it("does not set Inter, Geist, or Space Grotesk as an active face", () => {
    const hits = product.filter((path) => BANNED_FACE.test(text(path)));
    expect(hits).toEqual([]);
  });

  it("does not import Lucide", () => {
    const hits = product.filter((path) => /lucide-react|from ["']lucide["']/.test(text(path)));
    expect(hits).toEqual([]);
  });

  it("does not blur a panel into glass", () => {
    const hits = product.filter((path) => /backdrop-filter\s*:/.test(text(path)));
    expect(hits).toEqual([]);
  });

  it("does not lift or grow a control on hover", () => {
    const hits: string[] = [];
    for (const path of product.filter((item) => item.endsWith(".css") || item.endsWith(".ts") || item.endsWith(".tsx"))) {
      const rules = text(path).match(/[^{}]*:hover[^{]*\{[^}]*\}/g) ?? [];
      for (const rule of rules) {
        if (/translateY|scale\(/.test(rule)) hits.push(`${path}: ${rule.slice(0, 180)}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("does not paint cursor radial spotlights", () => {
    expect(text(join(ROOT, "src/styles/kit/base.css"))).not.toMatch(/\.rb-spot::before\{[^}]*radial-gradient/);
    expect(text(join(ROOT, "src/styles/kit/kit2.css"))).not.toMatch(/\.k2-spot::before\{[^}]*radial-gradient/);
  });

  it("hides sparkle sprites while leaving the control label", () => {
    const type = text(join(ROOT, "src/styles/kit/typography.css"));
    expect(type).toContain('svg:has(> use[href*="#i-sparkles"]){display:none}');
    expect(type).toContain('.opt .oi:has(use[href*="#i-sparkles"]){display:none}');
  });

  it("loads Source Sans 3 for interface text and keeps Erode for Find headings", () => {
    expect(text(join(ROOT, "src/app/globals.css"))).toContain("var(--font-source-sans)");
    const find = text(join(ROOT, "public/find/style.css"));
    expect(find).toContain('font-family:"Source Sans 3"');
    expect(find).toContain("font-family:Erode");
    expect(text(join(ROOT, "docs/spec/DESIGN.md"))).toContain("--font-ui: 'Source Sans 3'");
  });
});
