/**
 * Fetches the official page a staff member cites for a submission step or channel name, server
 * side, and hashes the bytes received (RULES: a snapshot hash with every value). Only a federal
 * official host (canada.ca or a gc.ca site) on the official-source allowlist, over https, is
 * fetched; every redirect hop must stay on one (official-fetch.ts). Any failure returns null with
 * the reason: the entry is still kept for review, but a licensed member can't approve it without a
 * snapshot. Nothing is read from the page; staff type the step as the page gives it.
 */
import { fetchOfficialPage } from "@/modules/content-governance/official-fetch";

export type PageSnapshot = { sha256: string; retrieved_at: string; final_url: string; http_status: number };

export function federalOfficialUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return parsed.protocol === "https:" && !parsed.port && !parsed.username && (host === "canada.ca" || host.endsWith(".canada.ca") || host.endsWith(".gc.ca"));
  } catch {
    return false;
  }
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function snapshotOfficialPage(
  url: string,
  fetcher: typeof fetch,
  now: () => Date = () => new Date(),
): Promise<{ snapshot: PageSnapshot } | { snapshot: null; reason: string }> {
  if (!federalOfficialUrl(url)) return { snapshot: null, reason: "Not an official Government of Canada page." };
  const fetched = await fetchOfficialPage(url, fetcher, { maxBytes: 10_000_000, timeoutMs: 15_000, accept: "text/html,application/pdf" });
  if (!fetched.ok) {
    if (fetched.code === "fetch_failed") return { snapshot: null, reason: "The page couldn’t be reached from Casevoya." };
    return { snapshot: null, reason: "The page didn’t answer as expected." };
  }
  if (fetched.bytes.byteLength === 0) return { snapshot: null, reason: "The page didn’t answer as expected." };
  return { snapshot: { sha256: await sha256Hex(fetched.bytes), retrieved_at: now().toISOString(), final_url: fetched.finalUrl, http_status: fetched.status } };
}
