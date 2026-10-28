/**
 * The `casevoya-av-scanner` Worker: the front of the virus scanner container (ClamAV, Cloudflare
 * Containers, https://developers.cloudflare.com/containers/api/container-class/, read
 * 2026-10-28). It has no route and workers_dev is off: only the app Worker reaches it, through
 * its service binding AV_SCANNER. It forwards POST /v1/scan and GET /healthz to a container
 * instance. No secrets: the container holds no credentials and returns only a verdict.
 */
import { Container, getRandom } from "@cloudflare/containers";

type Env = {
  AV_SCANNER: DurableObjectNamespace<AvScannerContainer>;
};

/** How many instances requests are spread over (wrangler.jsonc max_instances). */
const INSTANCES = 2;

export class AvScannerContainer extends Container<Env> {
  defaultPort = 8080;
  // Signatures load in about half a minute; keep a warm instance for a while after a scan.
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
    return container.fetch(request);
  },
};
