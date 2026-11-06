import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { setupCardFixtureHtml } from "./setup-card-fixture";

const WIDTHS = [320, 375, 390, 430, 768, 1280, 1440] as const;
const root = path.resolve(import.meta.dirname, "..");

function chromeBin(): string | null {
  for (const candidate of ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/local/bin/google-chrome"]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export type CardMeasure = {
  width: number;
  copyW: number;
  buttonW: number;
  cardW: number;
  copyH: number;
  overflow: number;
  cardUnderFooter: boolean;
  alertVisibleAboveFooter: number;
  alertH: number;
};

type Cdp = { send(method: string, params?: object): Promise<{ result?: Record<string, unknown> }> };

function startChrome(bin: string): Promise<{ proc: ChildProcess; cdp: Cdp }> {
  const proc = spawn(bin, ["--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--remote-debugging-port=9333", "about:blank"], {
    stdio: "ignore",
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Chrome did not open a debugging port")), 15_000);
    const wait = async () => {
      try {
        const version = (await fetch("http://127.0.0.1:9333/json/version").then((response) => response.json())) as { webSocketDebuggerUrl: string };
        clearTimeout(timer);
        const ws = new WebSocket(version.webSocketDebuggerUrl);
        await new Promise<void>((open, fail) => {
          ws.addEventListener("open", () => open());
          ws.addEventListener("error", () => fail(new Error("Chrome debugging socket failed")));
        });
        let id = 0;
        const pending = new Map<number, (message: { result?: Record<string, unknown> }) => void>();
        ws.addEventListener("message", (event) => {
          const message = JSON.parse(String(event.data)) as { id?: number; result?: Record<string, unknown> };
          if (message.id && pending.has(message.id)) {
            pending.get(message.id)?.(message);
            pending.delete(message.id);
          }
        });
        const cdp: Cdp = {
          send(method, params) {
            const messageId = ++id;
            return new Promise((done) => {
              pending.set(messageId, done);
              ws.send(JSON.stringify({ id: messageId, method, params }));
            });
          },
        };
        resolve({ proc, cdp });
      } catch {
        setTimeout(wait, 100);
      }
    };
    wait();
  });
}

/** Renders the fixture in headless Chrome at each width and reads the panel's laid-out boxes. */
export async function measureSetupCard(html: string, shots?: string): Promise<CardMeasure[]> {
  const chrome = chromeBin();
  if (!chrome) return [];
  const dir = path.join(tmpdir(), "setup-card-fixture");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "index.html");
  writeFileSync(file, html);
  if (shots) mkdirSync(shots, { recursive: true });
  const { proc } = await startChrome(chrome);
  try {
    const targets = (await fetch("http://127.0.0.1:9333/json/list").then((response) => response.json())) as { type: string; webSocketDebuggerUrl: string }[];
    const pageTarget = targets.find((item) => item.type === "page");
    if (!pageTarget) throw new Error("Chrome opened no page");
    const page = new WebSocket(pageTarget.webSocketDebuggerUrl);
    await new Promise<void>((open) => page.addEventListener("open", () => open()));
    let id = 0;
    const pending = new Map<number, (message: { result?: Record<string, unknown> }) => void>();
    page.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as { id?: number; result?: Record<string, unknown> };
      if (message.id && pending.has(message.id)) {
        pending.get(message.id)?.(message);
        pending.delete(message.id);
      }
    });
    const send = (method: string, params?: object) => {
      const messageId = ++id;
      return new Promise<{ result?: Record<string, unknown> }>((done) => {
        pending.set(messageId, done);
        page.send(JSON.stringify({ id: messageId, method, params }));
      });
    };
    const rows: CardMeasure[] = [];
    for (const width of WIDTHS) {
      const height = width >= 1280 ? 900 : 844;
      await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
      await send("Page.navigate", { url: `file://${file}` });
      let raw = "";
      let last = "";
      for (let attempt = 0; attempt < 40 && !raw; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        const evaluated = await send("Runtime.evaluate", {
          expression: "document.documentElement.dataset.measure || ''",
          returnByValue: true,
        });
        last = JSON.stringify(evaluated.result).slice(0, 240);
        const value = (evaluated.result?.result as { value?: string } | undefined)?.value;
        raw = typeof value === "string" ? value : "";
      }
      if (!raw) throw new Error(`no measurement at ${width}: ${last}`);
      const parsed = JSON.parse(raw) as Omit<CardMeasure, "width">;
      rows.push({ width, ...parsed });
      if (shots) {
        const shot = await send("Page.captureScreenshot", { format: "png" });
        const data = String((shot.result as { data?: string } | undefined)?.data || "");
        writeFileSync(path.join(shots, `${width}.png`), Buffer.from(data, "base64"));
      }
    }
    page.close();
    return rows;
  } finally {
    proc.kill();
  }
}

describe("setup sample-case add-card row", () => {
  const html = setupCardFixtureHtml();

  it("shows the trial panel inside the shared setup sheet", () => {
    expect(html).toContain("Fixture, not a live account");
    expect(html).toContain("Add a card to start your 30-day free trial");
    expect(html).toContain("$0 today. You choose a plan and add a card on Stripe’s secure page");
    expect(html).toContain("Send an intake form");
    expect(html).toContain("Send a service agreement");
    expect(html).toContain("Open my workspace");
    expect(html).toContain('class="wz-foot"');
    expect(html).toContain('data-step="7" class="on"');
    expect(html).not.toContain('data-step="0" class="on"');
    const css = readFileSync(path.join(root, "src/styles/kit/auth.css"), "utf8");
    expect(css).toContain(".conn{display:grid;grid-template-columns:44px 1fr auto");
    expect(css).toMatch(/\.conn\[data-setup-card\]\{[^}]*grid-template-columns:minmax\(0,1fr\) auto/);
  });

  const chrome = chromeBin();
  const shots = process.env.SETUP_CARD_SHOTS;
  it.skipIf(!chrome)("gives the copy the flexible column at phone, tablet, and desktop widths", async () => {
    const rows = await measureSetupCard(html, shots);
    if (shots) writeFileSync(path.join(shots, "measures.json"), JSON.stringify(rows, null, 2));
    expect(rows.map((row) => row.width)).toEqual([...WIDTHS]);
    for (const row of rows) {
      expect(row.copyW, `${row.width}px copy`).toBeGreaterThan(120);
      expect(row.copyW, `${row.width}px copy vs button`).toBeGreaterThan(row.buttonW);
      expect(row.overflow, `${row.width}px overflow`).toBeLessThanOrEqual(1);
      expect(row.cardUnderFooter, `${row.width}px card under footer`).toBe(false);
      expect(row.alertVisibleAboveFooter, `${row.width}px alert`).toBeGreaterThan(row.alertH * 0.6);
    }
  });
});
