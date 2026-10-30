/**
 * Reads an issuer's official page on the server when staff add the issuer (GOV-04, RULES: an
 * official source with the URL, retrieval time and a snapshot hash). Only Government of Canada
 * hosts on the official-source allowlist are fetched, every redirect hop must stay on one
 * (official-fetch.ts), and any failure returns null: the issuer is then recorded with the URL and
 * the date staff checked, marked "page not read", for the reviewer.
 */

import { fetchOfficialPage, officialFetchAllowed } from "@/modules/content-governance/official-fetch";
import { plainText } from "@/modules/billing/ircc-fee-list";
import { officialIssuerUrl, pageModifiedOn } from "@/modules/government/letters";

export type IssuerPageRead = {
  sha256: string;
  retrievedAt: string;
  modifiedOn: string | null;
  nameOnPage: boolean;
  finalUrl: string;
  httpStatus: number;
};

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const fold = (value: string) => value.normalize("NFKC").replace(/[’']/g, "'").replace(/\s+/g, " ").trim().toLowerCase();

export async function readIssuerPage(fetcher: typeof fetch, url: string, name: string, now: () => Date = () => new Date()): Promise<IssuerPageRead | null> {
  if (!officialIssuerUrl(url)) return null;
  const fetched = await fetchOfficialPage(url, fetcher, {
    maxBytes: 3_000_000,
    timeoutMs: 15_000,
    accept: "text/html",
    allow: (hop) => officialIssuerUrl(hop) && officialFetchAllowed(hop),
  });
  if (!fetched.ok || fetched.bytes.byteLength === 0) return null;
  const html = new TextDecoder("utf-8").decode(fetched.bytes);
  return {
    sha256: await sha256Hex(fetched.bytes),
    retrievedAt: now().toISOString(),
    modifiedOn: pageModifiedOn(html),
    nameOnPage: fold(plainText(html)).includes(fold(name)),
    finalUrl: fetched.finalUrl,
    httpStatus: fetched.status,
  };
}
