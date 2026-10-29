/**
 * The scanner's HTTP API inside the container (Node 22, next to clamd). Reached only from the
 * casevoya-av-scanner Worker, which the app reaches only through its AV_SCANNER service binding.
 *
 *   GET  /ping      the Container class's startup check (pingEndpoint): the server is listening.
 *                   200 as soon as this process has bound 0.0.0.0:8080. clamd is not required.
 *   GET  /healthz   clamd answers PING; 200 {ok, engine} or 503 {ok: false}.
 *   POST /v1/scan   body: the file's bytes (application/octet-stream, at most 100 MB).
 *                   200 {result: "clean", engine} | 200 {result: "infected", signature, engine}
 *                   | 413/503 {result: "error", reason}. Nothing is written to disk; the bytes
 *                   go straight to clamd over its local socket and are dropped.
 *                   If clamd is still loading, this answers 503 immediately ({reason:"starting"}).
 *                   The app holds the file and retries; an unscanned file is never returned as clean.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { connect } from "node:net";
import { command, engineName, instreamFrames, parseScanReply, replyText, scanResponse } from "../src/clamd";

const PORT = Number(process.env.PORT ?? 8080);
const SOCKET = process.env.CLAMD_SOCKET ?? "/var/lib/clamav/clamd.ctl";
const MAX_BYTES = 104_857_600;
const SCAN_TIMEOUT_MS = 120_000;

function talk(parts: Iterable<Uint8Array>, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(SOCKET);
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => socket.destroy(new Error("clamd timeout")), timeoutMs);
    socket.on("connect", () => {
      for (const part of parts) socket.write(part);
    });
    socket.on("data", (data) => {
      chunks.push(data);
      // "z" commands end their single reply with NUL.
      if (data.includes(0)) socket.end();
    });
    socket.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    socket.on("close", () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
  });
}

async function ping(): Promise<boolean> {
  try {
    return replyText(await talk([command("PING")], 3_000)) === "PONG";
  } catch {
    return false;
  }
}

async function version(): Promise<string | null> {
  try {
    return engineName(await talk([command("VERSION")], 3_000));
  } catch {
    return null;
  }
}

function send(res: ServerResponse, status: number, body: Record<string, unknown>) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<Uint8Array | null> {
  const declared = Number(req.headers["content-length"] ?? "0");
  if (declared > MAX_BYTES) return null;
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    total += (chunk as Buffer).byteLength;
    if (total > MAX_BYTES) return null;
    chunks.push(chunk as Buffer);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

const server = createServer(async (req, res) => {
  const path = (req.url ?? "/").split("?")[0];
  try {
    // "/" is what the default pingEndpoint ("ping") requests: host "ping", path "/".
    if (req.method === "GET" && (path === "/ping" || path === "/")) return send(res, 200, { ok: true });
    if (req.method === "GET" && path === "/healthz") {
      const ok = await ping();
      return send(res, ok ? 200 : 503, { ok, engine: ok ? await version() : null });
    }
    if (req.method === "POST" && path === "/v1/scan") {
      const bytes = await readBody(req);
      if (!bytes) return send(res, 413, { result: "error", reason: "too_large" });
      if (bytes.byteLength === 0) return send(res, 400, { result: "error", reason: "empty" });
      // Don't hold the request while clamd loads. The Worker waits for /healthz before it
      // forwards a scan (src/warm.ts; none on the upload itself, which aborts at 20s). A scan
      // that still arrives cold gets 503 and the file stays held; clamd keeps loading.
      if (!(await ping())) return send(res, 503, { result: "error", reason: "starting" });
      const engine = await version();
      const reply = await talk([command("INSTREAM"), ...instreamFrames(bytes)], SCAN_TIMEOUT_MS);
      const answer = scanResponse(parseScanReply(reply), engine);
      return send(res, answer.status, answer.body);
    }
    return send(res, 404, { error: "not found" });
  } catch {
    return send(res, 503, { result: "error", reason: "clamd" });
  }
});

// 0.0.0.0, not the default "::". Cloudflare's container proxy and the Docker health check
// connect over IPv4 (127.0.0.1 / the instance address). A v6-only socket never answers them,
// so the instance stays active and unhealthy. https://developers.cloudflare.com/containers/examples/status-hooks/
server.listen(PORT, "0.0.0.0", () => {
  console.log(`av-scanner listening on 0.0.0.0:${PORT}`);
});
