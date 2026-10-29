/**
 * The `casevoya-av-scanner` Worker: the front of the virus scanner container (ClamAV, Cloudflare
 * Containers, https://developers.cloudflare.com/containers/api/container-class/, read
 * 2026-10-28). It has no route and workers_dev is off: only the app Worker reaches it, through
 * its service binding AV_SCANNER. It forwards POST /v1/scan and GET /healthz to a container
 * instance. Before a scan it wakes that one instance and waits (within the caller's budget) until
 * clamd answers, then forwards the scan to the same instance (src/warm.ts). No secrets: the container holds no credentials and returns only a verdict.
 */
import { Container, getRandom } from "@cloudflare/containers";
import { forwardScan } from "../src/warm";

// Workers runtime global. This package typechecks on its own, without @cloudflare/workers-types.
interface DurableObjectNamespace<T> {
  get(id: { toString(): string }): { fetch(request: Request): Promise<Response> };
}

type Env = {
  AV_SCANNER: DurableObjectNamespace<AvScannerContainer>;
};

/** How many instances requests are spread over (wrangler.jsonc max_instances). */
const INSTANCES = 2;

export class AvScannerContainer extends Container<Env> {
  defaultPort = 8080;
  // fetch(`http://${pingEndpoint}`) during startup. The default "ping" is host "ping", path "/".
  // Either path is fine: the server answers both 200 as soon as it is listening, which has to
  // happen within TIMEOUT_TO_GET_PORTS_MS (20s). A 503 from /healthz would also count (the class
  // does not check the status), but /ping does not wait on clamd.
  pingEndpoint = "127.0.0.1/ping";
  // clamd keeps loading after the port is open. Stay up long enough for the app's retry
  // (first wait is 60s) to find a warm engine.
  sleepAfter = "15m";
  // freshclam fetches signature updates from the ClamAV mirror (database.clamav.net).
  enableInternet = true;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const scan = url.pathname === "/v1/scan" && request.method === "POST";
    const health = url.pathname === "/healthz" && request.method === "GET";
    if (!scan && !health) return new Response(null, { status: 404 });
    const container = await getRandom(env.AV_SCANNER, INSTANCES);
    // One instance for both the warm-up and the scan: waking one and scanning on the other would
    // land on a cold engine again.
    if (scan) return forwardScan(container, request);
    return container.fetch(request);
  },
};
