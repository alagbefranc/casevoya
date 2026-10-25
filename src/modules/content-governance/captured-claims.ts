/**
 * Official content captured by scripts/ops/capture-official-claims.mjs (SRC-01): IRCC fee list rows
 * and the Justice Laws IRPR/IRPA sections the supported programs rely on, each with its exact URL
 * and section anchor, the page's SHA-256, retrieval time and the dates the page prints. These are
 * DRAFTS offered in Templates > Source review > Add claim; nothing here is used as a rule. When
 * staff add one, Casevoya fetches the page again on the server; this capture is used only if that
 * fetch fails. A licensed reviewer resolves applicability and approves it before it goes live.
 *
 * Not captured (www.canada.ca did not answer from the capture machine on 2026-10-25): IRCC forms
 * and guides (form numbers, "date modified"), document checklists such as IMM 5483, program pages
 * and processing times. Staff enter those from the official page; they need the reviewer's
 * attestation when Casevoya can't capture the page.
 */
import data from "./captured-claims.json";

export type CapturedPage = {
  url: string;
  publisher: string;
  title: string;
  finalUrl: string;
  httpStatus: number;
  retrievedAt: string;
  sha256: string;
  modifiedOn: string | null;
  lastAmendedOn: string | null;
  currentTo: string | null;
};

export type CapturedClaim = {
  key: string;
  program: string | null;
  jurisdiction: string;
  claim: string;
  page: string;
  sourceUrl: string;
  section: string;
  value: string | null;
  excerpt: string;
};

export const CAPTURED_AT: string = data.capturedAt;
export const CAPTURED_PAGES: CapturedPage[] = data.pages as CapturedPage[];
export const CAPTURED_CLAIMS: CapturedClaim[] = data.claims as CapturedClaim[];

export function capturedClaim(key: string | null | undefined): CapturedClaim | null {
  return (key && CAPTURED_CLAIMS.find((claim) => claim.key === key)) || null;
}

export function capturedPage(url: string): CapturedPage | null {
  return CAPTURED_PAGES.find((page) => page.url === url) ?? null;
}
