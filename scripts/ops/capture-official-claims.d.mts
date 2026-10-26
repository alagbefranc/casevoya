import type { CapturedClaim, CapturedPage } from "../../src/modules/content-governance/captured-claims";

export type ClaimSpec = {
  key: string;
  program: string | null;
  page: string;
  claim?: string;
  /** Which file the claim is written to (OUTPUTS); "official" when absent. */
  out?: "official" | "canada";
  category?: "form" | "checklist" | "program";
  namedInRepo?: boolean;
  formNumber?: string;
  fee?: { anchor: string; name: string; group?: string; link?: string };
  law?: string;
  noValue?: boolean;
  form?: boolean;
  edition?: boolean;
  checklist?: { list: "Forms list" | "Documents list"; n: number };
  section?: { id: string; untilId?: string; startText?: string; name?: string };
  note?: string;
};
export type Missing = { missing: string };
export type ReadClaim = { sourceUrl: string; section: string; value: string | null; excerpt: string } | Missing;
export type PdfText = { raw: string; xfa: string | null; kind?: string };
export type { CapturedClaim, CapturedPage };

export const OUTPUTS: { official: string; canada: string };
export const PAGES: { url: string; publisher: string; title: string }[];
export const CLAIMS: ClaimSpec[];
export function excerpt(text: string): string;
export function readClaim(spec: ClaimSpec, html: string): ReadClaim;
export function readFormPage(
  spec: { page: string },
  html: string,
): { title: string; pdfUrl: string; claim: string; sourceUrl: string; section: string; value: string; excerpt: string } | Missing;
export function readEdition(
  spec: { formNumber: string },
  pdf: PdfText,
): { claim: string; section: string; value: string; excerpt: string; editionSource: string } | Missing;
export function readChecklistItems(raw: string, code: string): { list: string; heading: string; n: number; text: string }[];
export function sectionHtml(html: string, id: string, untilId?: string): string | null;
export function readProgramSection(
  spec: { page: string; section: { id: string; untilId?: string; startText?: string; name?: string } },
  html: string,
): { title: string; claim: string; sourceUrl: string; section: string; value: null; excerpt: string; sectionText: string } | Missing;
export type CaptureResult = { complete: boolean; missing: string[]; data: { capturedAt: string; pages: CapturedPage[]; claims: CapturedClaim[] } };
export function capture(options?: {
  fetcher?: typeof fetch;
  now?: () => Date;
  log?: (line: string) => void;
  delayMs?: number;
  pdfReader?: (bytes: Uint8Array) => PdfText;
  only?: "official" | "canada" | null;
}): Promise<{ official: CaptureResult; canada: CaptureResult }>;

export const ALL_SOURCES: string;
export type FeeRow = { path: string[]; anchor: string | null; groupId: string | null; names: string[]; text: string; amountCents: number; qualifier: string | null };
export type AllSourcesClaim = Record<string, unknown> & { key: string; category: string; page: string; sourceUrl: string; section: string; claim: string; value: string | null };
export type AllSourcesData = Record<string, unknown> & { pages: Record<string, unknown>[]; claims: AllSourcesClaim[] };
export function readFeeRows(html: string): FeeRow[];
export function centsOf(value: unknown): number | null;
export function matchFeeClaim(claim: { section: string }, rows: FeeRow[]): { row: FeeRow } | Missing;
export function refreshFeeClaim(claim: AllSourcesClaim, rows: FeeRow[], page: { sha256: string; retrievedAt: string }): { claim: AllSourcesClaim } | { refused: string };
export function refreshLawClaim(
  claim: AllSourcesClaim,
  html: string,
  page: { sha256: string; retrievedAt: string; currentTo: string | null; lastAmendedOn: string | null },
): { claim: AllSourcesClaim } | { refused: string };
export function splitSpousalRow(
  claim: AllSourcesClaim,
  rows: FeeRow[],
  page: { sha256: string; retrievedAt: string },
): { claims: AllSourcesClaim[]; notLoaded: { key: string; reason: string }[] };
export function refreshAllSources(
  data: AllSourcesData,
  options?: { fetcher?: typeof fetch; now?: () => Date; log?: (line: string) => void; delayMs?: number },
): Promise<{ data: AllSourcesData; report: { matched: { fee: number; law: number }; lawTextDiffers: string[]; refused: { key: string; reason: string }[]; notLoaded: { key: string; reason: string }[]; split: unknown[] } }>;
