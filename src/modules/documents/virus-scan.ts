import "server-only";

import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * #263-B: the app Worker's side of the virus scanner (services/av-scanner: ClamAV in a Cloudflare
 * Container, Francis's own Cloudflare account). Reached through the service binding AV_SCANNER
 * when the Worker has one, otherwise AV_SCANNER_URL (a private URL, for local development of the
 * service only). The file's bytes go in the request body; nothing else about the file or its
 * owner is sent. The answer is one of clean, infected (with the signature name) or error.
 *
 * Without a transport every scan is an error: uploads stay held ("scanning") and the retry job
 * eventually marks them scan_failed. Nothing here can mark a file clean on its own.
 *
 * A cold container (clamd still loading signatures) and a scanner that doesn't answer in time
 * are both errors. The file stays held and the retry job tries again. The retry job's requests
 * ask the scanner Worker to wake the instance and wait for clamd first (RUNNER_SCAN_BUDGET), so a
 * retry hours later, on an instance that has gone to sleep, still gets a real scan.
 */
type Fetcher = { fetch: (input: Request | string, init?: RequestInit) => Promise<Response> };

export type ScanTransport = { send: (path: string, init: RequestInit) => Promise<Response> } | null;

export type ScanOutcome =
  | { result: "clean"; engine: string | null }
  | { result: "infected"; signature: string; engine: string | null }
  | { result: "error"; reason: "unavailable" | "timeout" | "rejected" | "unreadable" | "scanner"; engine?: string | null };

function env(): Record<string, unknown> {
  try {
    return getCloudflareContext().env as unknown as Record<string, unknown>;
  } catch {
    return process.env as Record<string, unknown>;
  }
}

export function avScannerTransport(values: Record<string, unknown> = env()): ScanTransport {
  const binding = values.AV_SCANNER as Fetcher | undefined;
  if (binding && typeof binding.fetch === "function") return { send: (path, init) => binding.fetch(new Request(`https://av-scanner${path}`, init)) };
  const url = values.AV_SCANNER_URL ?? process.env.AV_SCANNER_URL;
  if (typeof url === "string" && /^https?:\/\//.test(url)) return { send: (path, init) => fetch(`${url.replace(/\/$/, "")}${path}`, init) };
  return null;
}

const SIGNATURE = /^[A-Za-z0-9._:/+ -]{1,200}$/;

function text(value: unknown, max: number): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim().slice(0, max) : null;
}

/** The scanner's JSON answer, or an error when it isn't one we understand. Never "clean" by default. */
export function readScanResponse(status: number, body: unknown): ScanOutcome {
  const row = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const engine = text(row.engine, 120);
  if (status === 503) return { result: "error", reason: "unavailable", engine };
  if (status === 413) return { result: "error", reason: "rejected", engine };
  if (status < 200 || status >= 300) return { result: "error", reason: "scanner", engine };
  if (row.result === "clean") return { result: "clean", engine };
  if (row.result === "infected") {
    const signature = text(row.signature, 200);
    // An infected answer without a usable name is still not clean: record it as a scanner error.
    if (!signature || !SIGNATURE.test(signature)) return { result: "error", reason: "scanner", engine };
    return { result: "infected", signature, engine };
  }
  return { result: "error", reason: "scanner", engine };
}

/** How long a scan itself may take once the scanner is warm. */
export const SCAN_TIMEOUT_MS = 50_000;

/**
 * Bug report 2026-10-29: the scanner Worker wakes a sleeping instance and waits for clamd before
 * forwarding the scan (services/av-scanner/src/warm.ts), up to the budget sent in this header.
 * Must match WARMUP_HEADER / WARMUP_MAX_MS there.
 */
export const SCANNER_WARMUP_HEADER = "x-av-warmup-ms";
export const SCANNER_WARMUP_MS = 90_000;

export type ScanBudget = { timeoutMs: number; warmupMs: number };

/**
 * The retry runner (cron, scan/run) lets the scanner warm up and then scan: a file in scan_failed
 * is retried every 6 hours, always on a sleeping instance, so without the warm-up it never passed.
 * The upload itself keeps its short wait and no warm-up: the person is waiting for the answer, and
 * a cold scanner simply leaves the file held for the runner.
 */
export const RUNNER_SCAN_BUDGET: ScanBudget = { timeoutMs: SCANNER_WARMUP_MS + SCAN_TIMEOUT_MS, warmupMs: SCANNER_WARMUP_MS };
export const INLINE_SCAN_BUDGET: ScanBudget = { timeoutMs: 20_000, warmupMs: 0 };

export async function scanWithAvScanner(
  bytes: Uint8Array,
  deps: { transport?: ScanTransport; timeoutMs?: number; warmupMs?: number } = {},
): Promise<ScanOutcome> {
  const transport = deps.transport === undefined ? avScannerTransport() : deps.transport;
  if (!transport) return { result: "error", reason: "unavailable" };
  try {
    const response = await transport.send("/v1/scan", {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        "content-length": String(bytes.byteLength),
        [SCANNER_WARMUP_HEADER]: String(deps.warmupMs ?? 0),
      },
      body: bytes as unknown as BodyInit,
      signal: AbortSignal.timeout(deps.timeoutMs ?? SCAN_TIMEOUT_MS),
    });
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return readScanResponse(response.status, body);
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    return { result: "error", reason: name === "TimeoutError" || name === "AbortError" ? "timeout" : "unavailable" };
  }
}
