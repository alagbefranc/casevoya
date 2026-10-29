/**
 * The scanner Worker's warm-up before a scan (bug report 2026-10-29). An instance sleeps after 15
 * idle minutes (worker.ts sleepAfter). A file in scan_failed is retried every 6 hours, so every
 * such retry used to land on a sleeping instance: the container started, /v1/scan answered 503
 * {reason:"starting"} while clamd loaded, and the file was pushed another 6 hours, forever.
 *
 * Now the Worker takes ONE instance, wakes it with GET /healthz (the Container class starts a
 * sleeping container on any request) and polls until clamd answers (200), within a budget. Only
 * then is the scan forwarded, once, to that same instance. The upload body is never read here and
 * never buffered or replayed (files up to 100 MB): it is passed through untouched. If the instance
 * is still not warm when the budget runs out, the answer is the same 503 starting as before, and
 * the app holds the file (fail closed: nothing here can say clean).
 *
 * The app chooses the budget per request with the x-av-warmup-ms header: 0 on the upload itself
 * (the person is waiting; that path keeps today's behaviour), the full budget from the retry
 * runner. A request without the header gets the full budget.
 */

/** The request header carrying the caller's warm-up budget in milliseconds. */
export const WARMUP_HEADER = "x-av-warmup-ms";

/**
 * The longest warm-up the Worker allows. A cold start is the port check (the Container class gives
 * up after 20 s, TIMEOUT_TO_GET_PORTS_MS in @cloudflare/containers 0.3.7) plus clamd loading the
 * signatures on half a vCPU, which the live checks saw take up to about a minute
 * (docs/integrations/av-scanner.md). 90 s covers both with room to spare.
 */
export const WARMUP_MAX_MS = 90_000;

/** How often /healthz is asked while clamd loads. */
export const WARMUP_POLL_MS = 1_500;

export type ScannerStub = { fetch(request: Request): Promise<Response> };

export type WarmDeps = {
  now?: () => number;
  /** Resolves after ms, or early (and without firing) once signal aborts. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
};

const defaultSleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });

/** The caller's budget, clamped to 0..WARMUP_MAX_MS. Missing or unreadable: the full budget. */
export function warmupBudget(request: Request): number {
  const raw = request.headers.get(WARMUP_HEADER);
  if (raw === null || raw.trim() === "") return WARMUP_MAX_MS;
  const value = Number(raw);
  if (!Number.isFinite(value)) return WARMUP_MAX_MS;
  return Math.min(Math.max(Math.trunc(value), 0), WARMUP_MAX_MS);
}

/** The scanner's own "still starting" answer (runtime/server.ts), unchanged. */
export function startingResponse(): Response {
  return new Response(JSON.stringify({ result: "error", reason: "starting" }), {
    status: 503,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

/**
 * Polls this one instance's /healthz until it is 200 or the budget is spent. The first request
 * wakes a sleeping instance. A request that fails or doesn't answer in time counts as not warm.
 */
export async function waitUntilWarm(stub: ScannerStub, budgetMs: number, deps: WarmDeps = {}): Promise<boolean> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? defaultSleep;
  const deadline = now() + budgetMs;
  for (;;) {
    const remaining = deadline - now();
    if (remaining <= 0) return false;
    // The first request to a sleeping instance waits for its port (up to 20 s); never past the budget.
    const timer = new AbortController();
    const ok = await Promise.race([
      stub
        .fetch(new Request("http://av-scanner/healthz", { method: "GET" }))
        .then(async (response) => {
          await response.body?.cancel().catch(() => undefined);
          return response.status === 200;
        })
        .catch(() => false),
      sleep(remaining, timer.signal).then(() => false),
    ]);
    timer.abort();
    if (ok) return true;
    const left = deadline - now();
    if (left <= 0) return false;
    await sleep(Math.min(WARMUP_POLL_MS, left));
  }
}

/**
 * POST /v1/scan: wait for this instance to be warm (within the caller's budget), then forward the
 * original request to it, once. A budget of 0 forwards at once, as before the fix.
 */
export async function forwardScan(stub: ScannerStub, request: Request, deps: WarmDeps = {}): Promise<Response> {
  const budget = warmupBudget(request);
  if (budget > 0 && !(await waitUntilWarm(stub, budget, deps))) return startingResponse();
  return stub.fetch(request);
}
