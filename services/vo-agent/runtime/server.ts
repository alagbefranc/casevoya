/**
 * The container's HTTP server (Node 20+). POST /v1/run runs one Vo task with the Claude Agent SDK;
 * GET /health answers 200. Listens on PORT (default 8080). No request body is ever logged.
 */
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
import { handleRun } from "../src/handler";
import type { AgentSdk } from "../src/task";

const sdk = { query, tool, createSdkMcpServer } as unknown as AgentSdk;
// An empty scratch directory: the agent has no filesystem tools, and nothing of ours is in it.
const cwd = mkdtempSync(join(tmpdir(), "vo-"));
const MAX_BODY = 64 * 1024;

const server = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "text/plain" }).end("ok");
    return;
  }
  if (req.url !== "/v1/run") {
    res.writeHead(404).end();
    return;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  req.on("data", (chunk: Buffer) => {
    size += chunk.length;
    if (size > MAX_BODY) req.destroy();
    else chunks.push(chunk);
  });
  req.on("end", () => {
    const headers = Object.fromEntries(Object.entries(req.headers).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]));
    handleRun({ method: req.method ?? "GET", headers, body: Buffer.concat(chunks).toString("utf8") }, { sdk, env: process.env, cwd })
      .then((out) => res.writeHead(out.status, { "content-type": "application/json" }).end(JSON.stringify(out.body)))
      .catch(() => res.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ result: "failed", failure: "failed" })));
  });
});

server.listen(Number(process.env.PORT ?? 8080));
