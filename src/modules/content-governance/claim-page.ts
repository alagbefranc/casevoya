import { federalHost, readPageDates, type PageDates } from "./claim-capture";

/**
 * Fetches the official page a claim cites, server side (SRC-01): the SHA-256 of the bytes, the
 * retrieval time and the dates the page prints. Only canada.ca or gc.ca over https; a redirect must
 * stay on one. Any failure returns no snapshot and the reason: the claim is still kept for review,
 * and a licensed reviewer approves it only after attesting they opened the page themselves.
 */
export type ClaimSnapshot = { sha256: string; retrieved_at: string; final_url: string; http_status: number };

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function captureClaimPage(
  url: string,
  fetcher: typeof fetch,
  now: () => Date = () => new Date(),
): Promise<{ snapshot: ClaimSnapshot; dates: PageDates } | { snapshot: null; reason: string }> {
  if (!federalHost(url)) return { snapshot: null, reason: "Not an official Government of Canada page." };
  const page = url.split("#")[0];
  let response: Response;
  try {
    response = await fetcher(page, { redirect: "follow", signal: AbortSignal.timeout(15_000), headers: { accept: "text/html" } });
  } catch {
    return { snapshot: null, reason: "The page couldn’t be reached from Casevoya." };
  }
  const finalUrl = (response.url || page).split("#")[0];
  if (!response.ok || !federalHost(finalUrl)) return { snapshot: null, reason: "The page didn’t answer as expected." };
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength === 0 || bytes.byteLength > 10_000_000) return { snapshot: null, reason: "The page didn’t answer as expected." };
  const html = new TextDecoder("utf-8").decode(bytes);
  return {
    snapshot: { sha256: await sha256Hex(bytes), retrieved_at: now().toISOString(), final_url: finalUrl, http_status: response.status },
    dates: readPageDates(html),
  };
}
