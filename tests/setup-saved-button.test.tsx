import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { setupSavedButtonFixtureHtml } from "./setup-card-fixture";

function chromeBin(): string | null {
  for (const candidate of ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/local/bin/google-chrome"]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function channel(value: number): number {
  const s = value / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function contrast(foreground: string, background: string): number {
  const parse = (color: string) => color.match(/\d+/g)?.slice(0, 3).map(Number) ?? [0, 0, 0];
  const lum = (color: string) => {
    const [r, g, b] = parse(color);
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  const lighter = Math.max(lum(foreground), lum(background));
  const darker = Math.min(lum(foreground), lum(background));
  return (lighter + 0.05) / (darker + 0.05);
}

type Paint = { bg: string; color: string; mark: string; outline: string };

async function readSavedButton(html: string, shots?: string): Promise<Record<string, Paint>> {
  const chrome = chromeBin();
  if (!chrome) return {};
  const dir = path.join(tmpdir(), "setup-saved-button");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "index.html");
  writeFileSync(file, html);
  const proc: ChildProcess = spawn(chrome, ["--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--remote-debugging-port=9344", "about:blank"], { stdio: "ignore" });
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  try {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try {
        await fetch("http://127.0.0.1:9344/json/version");
        break;
      } catch {
        await sleep(80);
      }
    }
    const targets = (await fetch("http://127.0.0.1:9344/json/list").then((response) => response.json())) as { type: string; webSocketDebuggerUrl: string }[];
    const page = new WebSocket(targets.find((item) => item.type === "page")!.webSocketDebuggerUrl);
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
    const send = (method: string, params?: object) =>
      new Promise<{ result?: Record<string, unknown> }>((done) => {
        const messageId = ++id;
        pending.set(messageId, done);
        page.send(JSON.stringify({ id: messageId, method, params }));
      });
    await send("DOM.enable");
    await send("CSS.enable");
    await send("Page.enable");
    await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await send("Page.navigate", { url: `file://${file}` });
    await sleep(250);
    const doc = await send("DOM.getDocument");
    const root = (doc.result?.root as { nodeId: number }).nodeId;
    const found = await send("DOM.querySelector", { nodeId: root, selector: "#saved" });
    await send("CSS.forcePseudoState", { nodeId: found.result?.nodeId, forcedPseudoClasses: ["hover"] });
    await sleep(300);
    const evaluated = await send("Runtime.evaluate", { expression: "JSON.stringify(window.__readSaved())", returnByValue: true });
    const value = (evaluated.result?.result as { value?: string } | undefined)?.value;
    if (!value) throw new Error("Saved button fixture did not measure");
    if (shots) {
      mkdirSync(shots, { recursive: true });
      for (const [width, height] of [[390, 844], [1280, 900]] as const) {
        await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 900 });
        await send("Runtime.evaluate", { expression: "document.getElementById('saved').scrollIntoView({block:'center'})", returnByValue: true });
        await sleep(200);
        const shot = await send("Page.captureScreenshot", { format: "png" });
        const data = String((shot.result as { data?: string } | undefined)?.data || "");
        writeFileSync(path.join(shots, `${width}.png`), Buffer.from(data, "base64"));
      }
    }
    page.close();
    return JSON.parse(value) as Record<string, Paint>;
  } finally {
    proc.kill();
  }
}

describe("setup primary button Saved state", () => {
  const chrome = chromeBin();

  it.skipIf(!chrome)("keeps the check and Saved label readable on the blue button", async () => {
    const paints = await readSavedButton(setupSavedButtonFixtureHtml(), process.env.SETUP_SAVED_SHOTS);
    const savedText = contrast(paints.saved.color, paints.saved.bg);
    const savedIcon = contrast(paints.saved.mark, paints.saved.bg);
    const normalText = contrast(paints.normal.color, paints.normal.bg);
    const failText = contrast(paints.fail.color, paints.fail.bg);
    expect(savedText, `Saved text ${paints.saved.color} on ${paints.saved.bg}`).toBeGreaterThanOrEqual(4.5);
    expect(savedIcon, `Saved icon ${paints.saved.mark} on ${paints.saved.bg}`).toBeGreaterThanOrEqual(3);
    expect(normalText, `Continue ${paints.normal.color} on ${paints.normal.bg}`).toBeGreaterThanOrEqual(4.5);
    expect(failText, `Retry ${paints.fail.color} on ${paints.fail.bg}`).toBeGreaterThanOrEqual(4.5);
    expect(paints.saving.bg).toBe(paints.normal.bg);
    expect(paints.saved.color).toBe(paints.saved.mark);
  });
});
