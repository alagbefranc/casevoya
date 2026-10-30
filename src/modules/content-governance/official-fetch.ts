/**
 * The one way the app server fetches an official page (claims, submission steps, decisions,
 * renewals, privacy limits, form templates, issuers, estimates, the IRCC fee list and the source
 * re-check). Redirects are followed by hand and every hop, and the page that answers, must pass the
 * host check (by default: a federal host on the official-source allowlist). A declared
 * Content-Length over the limit is refused before reading, and the body is read as a stream that
 * stops at the limit. One timeout covers the whole fetch, redirects and body included.
 */
import { federalHost } from "./claim-capture";
import { officialUrlIsAllowlisted } from "./official-domains";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type OfficialFetch =
  | { ok: true; status: number; finalUrl: string; contentType: string | null; bytes: Uint8Array }
  | { ok: false; result: "failed" | "blocked"; code: string; status: number | null; finalUrl: string };

export type OfficialFetchOptions = {
  /** Largest body accepted, in bytes. */
  maxBytes?: number;
  timeoutMs?: number;
  maxHops?: number;
  accept?: string;
  userAgent?: string;
  /** Host check for each hop and the page that answers; defaults to officialFetchAllowed. */
  allow?: (url: string) => boolean;
};

/** canada.ca or a gc.ca site over https, and on the official-source allowlist. */
export function officialFetchAllowed(url: string): boolean {
  return federalHost(url) && officialUrlIsAllowlisted(url);
}

async function discard(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Nothing to release.
  }
}

/** The body, or null when it is (or declares itself) larger than maxBytes. */
export async function readBodyCapped(response: Response, maxBytes: number): Promise<Uint8Array | null> {
  const declared = Number(response.headers?.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    await discard(response);
    return null;
  }
  const body = response.body;
  if (!body || typeof body.getReader !== "function") {
    const bytes = new Uint8Array(await response.arrayBuffer());
    return bytes.byteLength > maxBytes ? null : bytes;
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        // Already closed.
      }
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function fetchOfficialPage(url: string, fetchImpl: FetchLike = fetch, options: OfficialFetchOptions = {}): Promise<OfficialFetch> {
  const allow = options.allow ?? officialFetchAllowed;
  const maxBytes = options.maxBytes ?? 1_500_000;
  const maxHops = options.maxHops ?? 4;
  const signal = AbortSignal.timeout(options.timeoutMs ?? 25_000);
  const headers: Record<string, string> = { accept: options.accept ?? "text/html,application/pdf" };
  if (options.userAgent) headers["user-agent"] = options.userAgent;

  let current = url.split("#")[0];
  for (let hop = 0; hop <= maxHops; hop += 1) {
    if (!allow(current)) return { ok: false, result: "blocked", code: "off_allowlist", status: null, finalUrl: current };
    let response: Response;
    try {
      response = await fetchImpl(current, { redirect: "manual", signal, headers });
    } catch {
      return { ok: false, result: "failed", code: "fetch_failed", status: null, finalUrl: current };
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers?.get("location");
      await discard(response);
      if (!location) return { ok: false, result: "failed", code: "redirect_without_location", status: response.status, finalUrl: current };
      try {
        current = new URL(location, current).toString().split("#")[0];
      } catch {
        return { ok: false, result: "failed", code: "bad_redirect", status: response.status, finalUrl: current };
      }
      continue;
    }
    // The page that answered must pass the same check (a runtime that followed a redirect itself).
    const landed = (response.url || current).split("#")[0];
    if (!allow(landed)) {
      await discard(response);
      return { ok: false, result: "blocked", code: "off_allowlist", status: response.status, finalUrl: landed };
    }
    if (!response.ok) {
      await discard(response);
      return { ok: false, result: "failed", code: `http_${response.status}`, status: response.status, finalUrl: landed };
    }
    let bytes: Uint8Array | null;
    try {
      bytes = await readBodyCapped(response, maxBytes);
    } catch {
      return { ok: false, result: "failed", code: "read_failed", status: response.status, finalUrl: landed };
    }
    if (!bytes) return { ok: false, result: "failed", code: "too_large", status: response.status, finalUrl: landed };
    return { ok: true, status: response.status, finalUrl: landed, contentType: response.headers?.get("content-type") ?? null, bytes };
  }
  return { ok: false, result: "failed", code: "too_many_redirects", status: null, finalUrl: current };
}
