/**
 * Bug report 2026-10-29 (#274 follow-up): a scan_failed file is retried every 6 hours, always on a
 * scanner instance that has gone to sleep, and every retry answered 503 "starting". The scanner
 * Worker now wakes one instance and waits for clamd before forwarding the scan to that same
 * instance (services/av-scanner/src/warm.ts), and the retry runner's request leaves room for that
 * warm-up while the upload itself keeps its short wait. Nothing becomes clean without a scan.
 */
import { describe, expect, it, vi } from "vitest";
import { runDocumentScans, type ScanRunnerDeps } from "@/modules/documents/scan-runner";
import { serviceScanDeps } from "@/modules/documents/scan-service";
import {
  INLINE_SCAN_BUDGET,
  RUNNER_SCAN_BUDGET,
  SCAN_TIMEOUT_MS,
  SCANNER_WARMUP_HEADER,
  SCANNER_WARMUP_MS,
  scanWithAvScanner,
} from "@/modules/documents/virus-scan";
import { forwardScan, waitUntilWarm, warmupBudget, WARMUP_HEADER, WARMUP_MAX_MS, WARMUP_POLL_MS, type ScannerStub } from "../services/av-scanner/src/warm";

const V1 = "11111111-1111-4111-8111-111111111111";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** A virtual clock: sleep advances time at once, so the tests don't wait. */
function clock() {
  let t = 0;
  const sleeps: number[] = [];
  return {
    sleeps,
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
    sleep: async (ms: number, signal?: AbortSignal) => {
      if (signal) {
        // The deadline timer raced against a health check: it fires only if the check hasn't
        // answered by the next macrotask (a hung wake-up), and then the whole wait has passed.
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (!signal.aborted) t += ms;
        return;
      }
      sleeps.push(ms);
      t += ms;
    },
  };
}

/** One container instance: /healthz answers from `health`, /v1/scan from `scan`. */
function instance(health: (call: number) => number | Promise<number>, scan = () => json(200, { result: "clean", engine: "ClamAV 1.4.3/27800" })) {
  const calls: string[] = [];
  let healthCalls = 0;
  const stub: ScannerStub = {
    fetch: async (request: Request) => {
      const path = new URL(request.url).pathname;
      calls.push(`${request.method} ${path}`);
      if (path === "/healthz") return json(await health(healthCalls++), { ok: true });
      return scan();
    },
  };
  return { stub, calls };
}

const scanRequest = (warmup?: string) =>
  new Request("https://av-scanner/v1/scan", {
    method: "POST",
    headers: { "content-type": "application/octet-stream", ...(warmup === undefined ? {} : { [WARMUP_HEADER]: warmup }) },
    body: new Uint8Array([37, 80, 68, 70]),
  });

describe("scanner Worker warm-up (services/av-scanner/src/warm.ts)", () => {
  it("cold then warm: polls /healthz on one instance, then forwards the scan once to that same instance", async () => {
    const c = clock();
    // The first call is the wake-up (port check), then clamd loads: 503, 503, then 200.
    const { stub, calls } = instance((n) => (n < 3 ? 503 : 200));
    const request = scanRequest();
    const response = await forwardScan(stub, request, c);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: "clean", engine: "ClamAV 1.4.3/27800" });
    expect(calls).toEqual(["GET /healthz", "GET /healthz", "GET /healthz", "GET /healthz", "POST /v1/scan"]);
    expect(c.sleeps).toEqual([WARMUP_POLL_MS, WARMUP_POLL_MS, WARMUP_POLL_MS]);
  });

  it("never warm within the budget: 503 starting, the scan is not forwarded and the body is not read", async () => {
    const c = clock();
    const { stub, calls } = instance(() => 503);
    const request = scanRequest("6000");
    const response = await forwardScan(stub, request, c);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ result: "error", reason: "starting" });
    expect(calls.every((call) => call === "GET /healthz")).toBe(true);
    expect(calls.length).toBe(4);
    expect(request.bodyUsed).toBe(false);
    expect(c.now()).toBe(6000);
  });

  it("a wake-up that hangs past the budget (port check) is not warm", async () => {
    const c = clock();
    const stub: ScannerStub = { fetch: () => new Promise<Response>(() => undefined) };
    expect(await waitUntilWarm(stub, 5000, c)).toBe(false);
    expect(c.now()).toBe(5000);
    const failing: ScannerStub = { fetch: async () => Promise.reject(new Error("Failed to start container")) };
    expect(await waitUntilWarm(failing, 3000, c)).toBe(false);
  });

  it("warm at once: one health check, no wait, then the scan", async () => {
    const c = clock();
    const { stub, calls } = instance(() => 200);
    const response = await forwardScan(stub, scanRequest(), c);
    expect(response.status).toBe(200);
    expect(calls).toEqual(["GET /healthz", "POST /v1/scan"]);
    expect(c.sleeps).toEqual([]);
    expect(c.now()).toBe(0);
  });

  it("a budget of 0 (the upload itself) forwards at once, as before the fix", async () => {
    const c = clock();
    const { stub, calls } = instance(() => 503, () => json(503, { result: "error", reason: "starting" }));
    const response = await forwardScan(stub, scanRequest("0"), c);
    expect(response.status).toBe(503);
    expect(calls).toEqual(["POST /v1/scan"]);
  });

  it("reads the budget header, clamped to the Worker's maximum", () => {
    expect(warmupBudget(scanRequest())).toBe(WARMUP_MAX_MS);
    expect(warmupBudget(scanRequest("abc"))).toBe(WARMUP_MAX_MS);
    expect(warmupBudget(scanRequest("0"))).toBe(0);
    expect(warmupBudget(scanRequest("-5"))).toBe(0);
    expect(warmupBudget(scanRequest("1500.7"))).toBe(1500);
    expect(warmupBudget(scanRequest("99999999"))).toBe(WARMUP_MAX_MS);
  });
});

describe("app scan budgets (src/modules/documents/virus-scan.ts, scan-service.ts)", () => {
  it("app and Worker agree on the header and the warm-up budget", () => {
    expect(SCANNER_WARMUP_HEADER).toBe(WARMUP_HEADER);
    expect(SCANNER_WARMUP_MS).toBe(WARMUP_MAX_MS);
  });

  it("the runner waits for warm-up plus a scan; the upload keeps its short wait and asks for no warm-up", () => {
    expect(RUNNER_SCAN_BUDGET).toEqual({ warmupMs: SCANNER_WARMUP_MS, timeoutMs: SCANNER_WARMUP_MS + SCAN_TIMEOUT_MS });
    expect(INLINE_SCAN_BUDGET).toEqual({ warmupMs: 0, timeoutMs: 20_000 });
    // The pg_net kick (20261029200100) waits 240 s; the runner's first scan fits inside it.
    expect(RUNNER_SCAN_BUDGET.timeoutMs).toBeLessThan(240_000);
  });

  it("sends the runner's warm-up by default and none from the upload", async () => {
    const headers: (string | null)[] = [];
    const transport = {
      send: async (_path: string, init: RequestInit) => {
        headers.push(new Headers(init.headers).get(SCANNER_WARMUP_HEADER));
        return json(200, { result: "clean", engine: "ClamAV" });
      },
    };
    const service = {} as Parameters<typeof serviceScanDeps>[0];
    await serviceScanDeps(service, { transport }).scan(new Uint8Array([1]));
    await serviceScanDeps(service, { transport, budget: INLINE_SCAN_BUDGET }).scan(new Uint8Array([1]));
    expect(headers).toEqual([String(SCANNER_WARMUP_MS), "0"]);
  });

  it("a scanner that is still starting after the warm-up, or never answers, is an error, never clean", async () => {
    const bytes = new Uint8Array([1, 2]);
    const c = clock();
    const { stub } = instance(() => 503);
    const viaWorker = { send: (path: string, init: RequestInit) => forwardScan(stub, new Request(`https://av-scanner${path}`, init), c) };
    const outcome = await scanWithAvScanner(bytes, { transport: viaWorker, warmupMs: 3000 });
    expect(outcome).toMatchObject({ result: "error", reason: "unavailable" });

    const hang = {
      send: (_path: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true })),
    };
    expect(await scanWithAvScanner(bytes, { transport: hang, timeoutMs: 30, warmupMs: 90_000 })).toEqual({ result: "error", reason: "timeout" });

    const recorded: string[] = [];
    const deps: ScanRunnerDeps = {
      claim: async () => ({ data: [{ version_id: V1, storage_bucket: "documents", storage_key: "k", byte_size: 2, attempt: 7, backfill: false }], error: null }),
      download: async () => bytes,
      scan: vi.fn(async () => outcome),
      record: async (input) => {
        recorded.push(input.outcome);
        return { data: { upload_state: "scan_failed" }, error: null };
      },
    };
    expect(await runDocumentScans(deps, { versionId: V1 })).toMatchObject({ clean: 0, errors: 1, states: { [V1]: "scan_failed" } });
    expect(recorded).toEqual(["error"]);
  });
});
