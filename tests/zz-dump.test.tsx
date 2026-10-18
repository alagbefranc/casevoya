import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { writeFileSync } from "node:fs";
import { it } from "vitest";
import { SHEET_MARKUP } from "@/components/sheet/markup/registry";

const OUT = "/tmp/claude-0/-home-user-casevoya/f3840d9e-0117-5098-9a8f-476ff222b100/scratchpad/fmt/";
const INLINE = new Set(["span", "b", "i", "small", "a", "em", "strong", "code", "svg", "use", "img", "kbd", "label", "u", "s", "path", "option", "input", "br", "abbr", "time", "circle"]);

function pretty(html: string) {
  let depth = 0;
  let out = "";
  let line = "";
  const flush = () => {
    if (line.trim()) out += "  ".repeat(depth) + line.trim() + "\n";
    line = "";
  };
  for (const m of html.matchAll(/<\/?([a-zA-Z0-9-]+)[^>]*>|[^<]+/g)) {
    const t = m[0];
    const tag = m[1]?.toLowerCase();
    if (!tag || INLINE.has(tag)) {
      line += t;
      continue;
    }
    if (t.startsWith("</")) {
      flush();
      depth = Math.max(0, depth - 1);
      out += "  ".repeat(depth) + t + "\n";
    } else {
      flush();
      out += "  ".repeat(depth) + t + "\n";
      if (!t.endsWith("/>") && !["meta", "link", "hr", "col"].includes(tag)) depth++;
    }
  }
  flush();
  return out;
}

const PAGES: [string, string[]][] = [
  ["roles", ["default"]],
  ["licence", ["tab-lic", "tab-log"]],
  ["licence-suspended", ["default"]],
  ["grants", ["default", "tab-limits", "tab-support"]],
  ["privacy", ["default"]],
  ["templates", ["default", "tab-checklists", "tab-messages", "tab-rule", "tab-sources"]],
  ["intake-builder", ["default", "tab-preview"]],
  ["automations", ["default", "tab-runs"]],
];

it("dumps", () => {
  for (const [page, variants] of PAGES) {
    for (const variant of variants) {
      const html = renderToStaticMarkup(createElement(SHEET_MARKUP[page], { variant }));
      const start = html.indexOf('<header class="top"');
      const main = html.slice(start, html.indexOf("</main>"));
      const after = html.slice(html.indexOf("</footer>"));
      writeFileSync(`${OUT}${page}.${variant}.html`, pretty(main) + "\n==== AFTER FOOTER ====\n" + pretty(after));
    }
  }
});
