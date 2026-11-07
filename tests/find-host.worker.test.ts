import { request as httpRequest } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findAssetPath } from "@/modules/find/host";

/**
 * Host routing on the same workerd asset bucket the OpenNext worker uses.
 * A Next rewrite of find.casevoya.ca/ to /find/index.html 404s there, because
 * public files are served only when the request URL matches an asset. This
 * boots that asset binding and asks for the file the way the proxy now does.
 */

const root = path.resolve(import.meta.dirname, "..");
const dir = mkdtempSync(path.join(tmpdir(), "find-host-"));
const port = 8794;
let child: ChildProcess | null = null;

const worker = `
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host;
    const name = host.split(",")[0].trim().toLowerCase().replace(/:\\d+$/, "");
    const path = url.pathname;
    const assetPath = name === "find.casevoya.ca" && !path.startsWith("/api") && !path.startsWith("/_next") && !path.startsWith("/find")
      ? (path === "/" ? ${JSON.stringify(findAssetPath("/"))} : "/find" + path)
      : null;
    if (assetPath) {
      const assetUrl = new URL(request.url);
      assetUrl.pathname = assetPath;
      assetUrl.search = "";
      let asset = await env.ASSETS.fetch(new Request(assetUrl.toString(), { method: "GET" }));
      const hop = asset.status >= 300 && asset.status < 400 ? asset.headers.get("location") : null;
      if (hop) asset = await env.ASSETS.fetch(new Request(new URL(hop, assetUrl).toString(), { method: "GET" }));
      return new Response(asset.body, { status: asset.status, headers: asset.headers });
    }
    if (path === "/") return Response.redirect(new URL("/app", request.url), 307);
    if (path === "/sign-in") return new Response("<title>Sign in · Casevoya</title>", { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
    if (path === "/setup") return new Response("<title>Set up your firm · Casevoya</title>", { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
    return env.ASSETS.fetch(request);
  },
};
`;

async function ready(proc: ChildProcess): Promise<void> {
  let log = "";
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`wrangler did not start\n${log}`)), 30_000);
    const on = (chunk: Buffer) => {
      log += chunk.toString();
      if (log.includes("Ready on")) {
        clearTimeout(timer);
        resolve();
      }
    };
    proc.stdout?.on("data", on);
    proc.stderr?.on("data", on);
    proc.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`wrangler exited ${code}\n${log}`));
    });
  });
}

function get(host: string, pathname: string) {
  return new Promise<{ status: number; location: string; title: string; text: string }>((resolve, reject) => {
    const req = httpRequest({ hostname: "127.0.0.1", port, path: pathname, method: "GET", headers: { host } }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(chunk as Buffer));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve({
          status: response.statusCode ?? 0,
          location: String(response.headers.location ?? ""),
          title: text.match(/<title>(.*?)<\/title>/i)?.[1] ?? "",
          text,
        });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

beforeAll(async () => {
  writeFileSync(path.join(dir, "worker.js"), worker);
  writeFileSync(
    path.join(dir, "wrangler.jsonc"),
    JSON.stringify({
      name: "find-host-check",
      main: "worker.js",
      compatibility_date: "2026-10-17",
      compatibility_flags: ["nodejs_compat"],
      assets: { directory: path.join(root, "public"), binding: "ASSETS", html_handling: "none", not_found_handling: "none" },
    }),
  );
  child = spawn(path.join(root, "node_modules/.bin/wrangler"), ["dev", "--config", "wrangler.jsonc", "--local", "--port", String(port), "--ip", "127.0.0.1", "--persist-to", path.join(dir, "state")], {
    cwd: dir,
    env: { ...process.env, WRANGLER_SEND_METRICS: "false", CLOUDFLARE_API_TOKEN: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await ready(child);
}, 40_000);

afterAll(() => {
  child?.kill("SIGTERM");
  rmSync(dir, { recursive: true, force: true });
});

describe("find host on the asset worker", () => {
  it("serves the introduction page at / with the consent script, and does not send the app host there", async () => {
    const rootPage = await get("find.casevoya.ca", "/");
    expect(rootPage.status).toBe(200);
    expect(rootPage.title).toBe("A clearer way to Canada · Casevoya");
    expect(rootPage.text).toContain('<base href="/find/">');
    expect(rootPage.text).toContain('src="app.js"');
    expect(rootPage.text).not.toContain("404: This page could not be found.");

    const script = await get("find.casevoya.ca", "/find/app.js");
    expect(script.status).toBe(200);
    expect(script.text).toContain("I agree that Casevoya may read my request and share it with one licensed consultant who can help. Nothing is sent until I press Send.");

    const appRoot = await get("app.casevoya.ca", "/");
    expect(appRoot.status).toBe(307);
    expect(new URL(appRoot.location, "https://app.casevoya.ca").pathname).toBe("/app");
    expect(appRoot.title).not.toBe("A clearer way to Canada · Casevoya");

    expect((await get("app.casevoya.ca", "/sign-in")).title).toBe("Sign in · Casevoya");
    expect((await get("app.casevoya.ca", "/setup")).title).toBe("Set up your firm · Casevoya");
  });
});
