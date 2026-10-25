export type SupportCatalogueOptions = {
  by?: string;
  kind?: string;
  key?: string;
  label?: string;
  jurisdiction?: string;
  caseType?: string;
  url?: string;
  section?: string;
  officialName?: string;
  note?: string;
  position?: number;
  active: boolean;
  dryRun: boolean;
};
export function parseArgs(argv: string[]): { command: "capture" | "entry" | "list"; options: SupportCatalogueOptions };
export function isDeepOfficialUrl(raw: string): boolean;
export function parseDateModified(html: string): string | null;
export function parseHeading(html: string): string | null;
export function sha256Hex(bytes: Uint8Array): string;
export function captureRequest(options: SupportCatalogueOptions): {
  by: string | null;
  key: string;
  label: string;
  jurisdiction: string;
  caseType: string | null;
  url: string;
  section: string | null;
};
