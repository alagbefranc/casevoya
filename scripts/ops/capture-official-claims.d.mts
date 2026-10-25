export type ClaimSpec = {
  key: string;
  program: string | null;
  page: string;
  claim: string;
  fee?: { anchor: string; name: string; group?: string; link?: string };
  law?: string;
  noValue?: boolean;
};
export type ReadClaim = { sourceUrl: string; section: string; value: string | null; excerpt: string } | { missing: string };
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
export const PAGES: { url: string; publisher: string; title: string }[];
export const CLAIMS: ClaimSpec[];
export function excerpt(text: string): string;
export function readClaim(spec: ClaimSpec, html: string): ReadClaim;
export function capture(options?: { fetcher?: typeof fetch; now?: () => Date; log?: (line: string) => void }): Promise<{
  capturedAt: string;
  pages: CapturedPage[];
  claims: ({ key: string; program: string | null; jurisdiction: string; claim: string; page: string } & Exclude<ReadClaim, { missing: string }>)[];
}>;
