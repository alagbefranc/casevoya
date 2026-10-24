/**
 * Reads an issuer's official page on the server when staff add the issuer (GOV-04, RULES: an
 * official source with the URL, retrieval time and a snapshot hash). Only Government of Canada
 * hosts are fetched, redirects must stay on them, and any failure returns null: the issuer is then
 * recorded with the URL and the date staff checked, marked "page not read", for the reviewer.
 */

import { plainText } from "@/modules/billing/ircc-fee-list";
import { officialIssuerUrl, pageModifiedOn } from "@/modules/government/letters";

export type IssuerPageRead = { sha256: string; retrievedAt: string; modifiedOn: string | null; nameOnPage: boolean };

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const fold = (value: string) => value.normalize("NFKC").replace(/[’']/g, "'").replace(/\s+/g, " ").trim().toLowerCase();

export async function readIssuerPage(fetcher: typeof fetch, url: string, name: string, now: () => Date = () => new Date()): Promise<IssuerPageRead | null> {
  if (!officialIssuerUrl(url)) return null;
  let response: Response;
  try {
    response = await fetcher(url.split("#")[0], { redirect: "follow", signal: AbortSignal.timeout(15_000), headers: { accept: "text/html" } });
  } catch {
    return null;
  }
  if (!response.ok || (response.url && !officialIssuerUrl(response.url))) return null;
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength === 0 || bytes.byteLength > 3_000_000) return null;
  const html = new TextDecoder("utf-8").decode(bytes);
  return {
    sha256: await sha256Hex(bytes),
    retrievedAt: now().toISOString(),
    modifiedOn: pageModifiedOn(html),
    nameOnPage: fold(plainText(html)).includes(fold(name)),
  };
}
