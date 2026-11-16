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

  it("hides every runtime sparkle sprite and keeps a word on the drafts tile", () => {
    const type = text(join(ROOT, "src/styles/kit/typography.css"));
    expect(type).toContain('svg:has(> use[href*="#i-sparkles"]){display:none}');
    expect(type).toContain('.opt .oi:has(use[href*="#i-sparkles"]){display:none}');
    expect(type).toContain('.tile:has(use[href*="#i-sparkles"])::before{content:"Vo"');
    expect(text(join(ROOT, "public/assets/icons-coreui/sprite.svg"))).toContain('id="i-sparkles"');

    const sources = [...walk(join(ROOT, "src")), ...walk(join(ROOT, "public"))].filter(
      (path) => !path.endsWith("sprite.svg") && !path.endsWith("sparkles.svg") && !path.includes(`${join("tests", "")}`),
    );
    const nameRe = /(?:name|icon)=\{?["']sparkles["']\}?/g;
    const hrefRe = /href\s*=\s*\{?["']([^"']*sparkles[^"']*)["']\}?/g;
    let names = 0;
    let hrefs = 0;
    const uncovered: string[] = [];
    for (const path of sources) {
      const source = text(path);
      if (!source.includes("sparkles")) continue;
      for (const match of source.matchAll(nameRe)) {
        names += 1;
        const line = source.slice(0, match.index ?? 0).split("\n").length;
        const around = source.slice(Math.max(0, (match.index ?? 0) - 80), (match.index ?? 0) + 40);
        if (/xlinkHref|xlink:href/.test(around)) uncovered.push(`${path}:${line} uses xlink for a sparkle name`);
      }
      for (const match of source.matchAll(hrefRe)) {
        hrefs += 1;
        const href = match[1] ?? "";
        const line = source.slice(0, match.index ?? 0).split("\n").length;
        if (!href.includes("#i-sparkles")) uncovered.push(`${path}:${line} href ${href} is not #i-sparkles`);
        const before = source.slice(0, match.index ?? 0);
        const svgAt = before.lastIndexOf("<svg");
        const useAt = before.lastIndexOf("<use");
        const between = svgAt >= 0 && useAt > svgAt ? before.slice(svgAt, useAt) : "";
        const openEnd = between.indexOf(">");
        const rest = openEnd >= 0 ? between.slice(openEnd + 1) : between;
        if (svgAt < 0 || useAt < svgAt || rest.trim() !== "") {
          uncovered.push(`${path}:${line} sparkle use is not a direct svg child, so the hide selector misses it`);
        }
      }
      if (/xlink:href\s*=\s*\{?["'][^"']*sparkles/.test(source)) uncovered.push(`${path} sets a sparkle xlink:href`);
    }
    expect(names).toBeGreaterThan(0);
    expect(hrefs).toBeGreaterThan(0);
    expect(uncovered).toEqual([]);
  });

  it("loads Source Sans 3 for interface text and keeps Erode for Find headings", () => {
    expect(text(join(ROOT, "src/app/globals.css"))).toContain("var(--font-source-sans)");
    const find = text(join(ROOT, "public/find/style.css"));
    expect(find).toContain('font-family:"Source Sans 3"');
    expect(find).toContain("font-family:Erode");
    expect(text(join(ROOT, "docs/spec/DESIGN.md"))).toContain("--font-ui: 'Source Sans 3'");
  });
});
