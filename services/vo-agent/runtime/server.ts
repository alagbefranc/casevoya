/**
 * The container's HTTP server (Node 20+). POST /v1/run runs one Vo task with the Claude Agent SDK;
 * GET /health answers 200. Listens on PORT (default 8080). No request body is ever logged.
 */
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
import Anthropic from "@anthropic-ai/sdk";
import { handleRun } from "../src/handler";
import type { AgentSdk } from "../src/task";
import type { DocModel, DocModelMessage } from "../src/vo-doc-read";

const sdk = { query, tool, createSdkMcpServer } as unknown as AgentSdk;
// Document reading: one Messages API call with the file as a PDF or image block (vo-doc-read.ts).
const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 140_000 }) : null;
const docModel: DocModel | null = anthropic
  ? { create: async (params) => (await anthropic.beta.messages.create(params as never)) as unknown as DocModelMessage }
  : null;
/** Busy or unreachable is "unavailable" (write it by hand, try later); anything else "failed". */
function classifyError(error: unknown): "unavailable" | "failed" {
  if (error instanceof Anthropic.RateLimitError || error instanceof Anthropic.InternalServerError || error instanceof Anthropic.APIConnectionError) return "unavailable";
  return "failed";
}
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
    handleRun({ method: req.method ?? "GET", headers, body: Buffer.concat(chunks).toString("utf8") }, { sdk, env: process.env, cwd, docModel, classifyError })
      .then((out) => res.writeHead(out.status, { "content-type": "application/json" }).end(JSON.stringify(out.body)))
      .catch(() => res.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ result: "failed", failure: "failed" })));
  });
});

server.listen(Number(process.env.PORT ?? 8080));
