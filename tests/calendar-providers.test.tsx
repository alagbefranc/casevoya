import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CalendarRbarView, type CalendarProviders } from "@/components/sheet/designer/calendar";

const month = { month: "November 2026", leading: 6, days: [{ day: 1 }, { day: 6, today: true }] };

function rbar(providers: CalendarProviders) {
  return renderToStaticMarkup(
    createElement(CalendarRbarView, {
      data: {
        calendar: month,
        deadlines: [],
        calendars: [{ name: "Sola Alagbe", tool: "no calendar connected", logo: null, chip: { tone: "gr", label: "Not connected" } }],
        live: { emptyTitle: "No upcoming deadlines", emptyCopy: "Deadlines recorded on a matter appear here.", providers },
      },
    }),
  );
}

const off: CalendarProviders = { meet: "off", teams: "off", calendly: "off", organizationId: "org-1" };
const ready: CalendarProviders = {
  meet: "ready",
  teams: "ready",
  calendly: { syncedAt: "2026-11-06T12:00:00.000Z", count: 2, truncated: false, error: null, canImport: true },
  organizationId: "org-1",
};

describe("calendar provider sidebar", () => {
  it("keeps Meet, Teams and Calendly unavailable until that account can use them", () => {
    const html = rbar(off);
    expect(html).toContain("Casevoya video");
    expect(html).toContain("Not connected");
    expect(html).not.toContain("Import Calendly");
    expect(html).not.toContain(">Planned<");
    expect(html).toContain("A Calendly import is that person’s scheduled events");
    expect(html).toContain("Google Calendar still shares busy times only");
  });

  it("does not call a failed status read Ready or Not connected", () => {
    const html = rbar({ meet: "unknown", teams: "unknown", calendly: "unknown", organizationId: "org-1" });
    expect(html).toContain("Couldn’t check");
    expect(html).not.toContain(">Planned<");
    expect(html).not.toContain(">Ready<");
  });

  it("offers import only when Calendly is connected, and marks Meet and Teams ready", () => {
    const html = rbar(ready);
    expect(html).toContain(">Ready<");
    expect(html).toContain("Imported 2");
    expect(html).toContain('data-calendly-import="1"');
    expect(html).toContain('data-org="org-1"');
    expect(html).not.toContain(">Planned<");
  });
});

const out = "/opt/cursor/artifacts/calendar-providers";

function page(body: string) {
  const css = path.resolve(import.meta.dirname, "../src/styles/kit/kit2.css");
  return `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="file://${css}"><style>
    body{margin:0;background:#f6f4f1;font:15px/1.45 ui-sans-serif,system-ui,sans-serif;color:#1c1917}
    aside{display:block;padding:16px 18px 28px}
    h4{margin:18px 0 8px;font-size:13px;letter-spacing:.04em;text-transform:uppercase;color:#57534e}
    .bd{display:inline-flex;align-items:center;gap:6px;border-radius:99px;padding:2px 8px;font-size:12px;background:#eceae6}
    .bd.ok{background:#e5f6ec;color:#146c43}.bd.gr{color:#57534e}
    .btn{height:34px;border-radius:8px;border:1px solid #d6d3d1;background:#fff;padding:0 12px}
    .r{margin-left:auto}
    .fp-note{color:#57534e}
  </style></head><body><div style="width:340px">${body}</div></body></html>`;
}

const chrome = ["/usr/bin/google-chrome", "/usr/local/bin/google-chrome"].find((file) => existsSync(file));

describe("calendar provider screenshots", () => {
  // Four headless Chrome launches. The default 30s test limit is too tight when the runner is busy.
  it.skipIf(!chrome)("writes mobile and desktop shots of the disconnected and ready sidebars", { timeout: 90_000 }, () => {
    mkdirSync(out, { recursive: true });
    const shots: [string, string][] = [
      ["off-390", page(rbar(off))],
      ["ready-390", page(rbar(ready))],
    ];
    for (const [name, html] of shots) {
      const file = path.join(out, `${name}.html`);
      writeFileSync(file, html);
      for (const width of [390, 1280]) {
        const shot = path.join(out, `${name.split("-")[0]}-${width}.png`);
        const result = spawnSync(chrome ?? "google-chrome", ["--headless", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage", `--window-size=${width},900`, `--screenshot=${shot}`, file], { timeout: 20_000 });
        expect(result.status, result.stderr?.toString()).toBe(0);
      }
    }
  });
});
