import { federalHost, hashableBytes, readPageDates, type PageDates } from "./claim-capture";
import { fetchOfficialPage } from "./official-fetch";

/**
 * Fetches the official page a claim cites, server side (SRC-01): the SHA-256 of the bytes (an HTML
 * page without the CDN's per-request script, as `hashableBytes` in claim-capture.ts says), the
 * retrieval time and the dates the page prints. Only canada.ca or gc.ca hosts on the official-source
 * allowlist, over https; every redirect hop must stay on one (official-fetch.ts). Any failure
 * returns no snapshot and the reason: the claim is still kept for review, and a licensed reviewer
 * approves it only after attesting they opened the page themselves.
 */
export type ClaimSnapshot = { sha256: string; retrieved_at: string; final_url: string; http_status: number };

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function captureClaimPage(
  url: string,
  fetcher: typeof fetch,
  now: () => Date = () => new Date(),
): Promise<{ snapshot: ClaimSnapshot; dates: PageDates } | { snapshot: null; reason: string }> {
  if (!federalHost(url)) return { snapshot: null, reason: "Not an official Government of Canada page." };
  const fetched = await fetchOfficialPage(url, fetcher, { maxBytes: 10_000_000, timeoutMs: 15_000, accept: "text/html" });
  if (!fetched.ok) {
    if (fetched.code === "fetch_failed") return { snapshot: null, reason: "The page couldn’t be reached from Casevoya." };
    return { snapshot: null, reason: "The page didn’t answer as expected." };
  }
  if (fetched.bytes.byteLength === 0) return { snapshot: null, reason: "The page didn’t answer as expected." };
  const html = new TextDecoder("utf-8").decode(fetched.bytes);
  // Same hash as the capture script: without the CDN's per-request script (claim-capture.ts).
  const hashed = hashableBytes(fetched.bytes, fetched.contentType);
  return {
    snapshot: { sha256: await sha256Hex(hashed.bytes), retrieved_at: now().toISOString(), final_url: fetched.finalUrl, http_status: fetched.status },
    dates: readPageDates(html),
  };
}
