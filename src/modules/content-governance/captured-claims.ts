/**
 * Official content captured by scripts/ops/capture-official-claims.mjs (SRC-01), each claim with its
 * exact URL and section anchor (or named section), the page's SHA-256, retrieval time and the dates
 * the page prints:
 *   - captured-claims.json: IRCC fee list rows and the Justice Laws IRPR/IRPA sections the supported
 *     programs rely on (captured from the build machine);
 *   - captured-canada-ca.json: canada.ca form pages ("Last updated" badge) and their PDF editions,
 *     the IMM 5483 study permit checklist (its 16 items word for word) and program page sections
 *     (captured from a machine that reaches www.canada.ca; the build machine can't).
 * These are DRAFTS offered in Templates > Source review > Add claim; nothing here is used as a rule.
 * When staff add one, Casevoya fetches the page again on the server; this capture is used only if
 * that fetch fails. A licensed reviewer resolves applicability and approves it before it goes live.
 *
 * Processing times are not captured: staff enter them from the official page, and they need the
 * reviewer's attestation when Casevoya can't capture the page.
 *
 * `sha256Of` says what the hash covers: "bytes" (the response as received) or
 * "html-without-injected-scripts" (canada.ca's per-request CDN script removed; see claim-capture.ts).
 * The canada.ca HTML hashes in captured-canada-ca.json were taken over the bytes before that rule
 * existed, so they are point-in-time; the PDF hashes compare across fetches.
 */
import type { HashBasis } from "./claim-capture";
import official from "./captured-claims.json";
import canada from "./captured-canada-ca.json";

/** Every date the page prints, by its label; "Unknown" when the page doesn't print it. */
export type PrintedDates = {
  published: string;
  modified: string;
  lastAmended: string;
  effective: string;
  currentTo: string;
  retrieved: string;
  reviewed: string;
};

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
  contentType?: string | null;
  bytes?: number;
  sha256Of?: HashBasis;
  printedDates?: PrintedDates;
  /** A PDF: "static (pdftotext)" or "XFA (edition read from the form template)". */
  pdfKind?: string;
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
  /** canada.ca captures: "form", "checklist" or "program". */
  category?: string;
  /** Casevoya already names this form or page. */
  namedInRepo?: boolean;
  title?: string;
  /** "IMM 5476" for a form, its edition or a checklist item. */
  formNumber?: string | null;
  /** A form page: the PDF its download link points to. */
  pdfUrl?: string;
  /** A PDF edition: where it was read ("printed text (pdftotext)", "XFA template drawn text (formNum)", "XFA template metadata, not a drawn stamp"). */
  editionSource?: string;
  /** A checklist item: its list's heading as printed. */
  checklistHeading?: string;
  /** A program page section: its full text as published (the excerpt is cut at 600 characters). */
  sectionText?: string;
  note?: string;
};

export const CAPTURED_AT: string = official.capturedAt;
export const CANADA_CA_CAPTURED_AT: string = canada.capturedAt;
export const CAPTURED_PAGES: CapturedPage[] = [...(official.pages as CapturedPage[]), ...(canada.pages as CapturedPage[])];
export const CAPTURED_CLAIMS: CapturedClaim[] = [...(official.claims as CapturedClaim[]), ...(canada.claims as CapturedClaim[])];

export function capturedClaim(key: string | null | undefined): CapturedClaim | null {
  return (key && CAPTURED_CLAIMS.find((claim) => claim.key === key)) || null;
}

export function capturedPage(url: string): CapturedPage | null {
  return CAPTURED_PAGES.find((page) => page.url === url) ?? null;
}
