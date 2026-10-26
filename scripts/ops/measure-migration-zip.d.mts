export type MeasureArgs = {
  mode: "local" | "stage" | "pilot" | "full";
  baseUrl: string | null;
  credentials: string | null;
  confirm: string | null;
  matter: string | null;
  person: string | null;
  pilot: number;
  files: number;
  mb: number;
  method: "deflate" | "stored";
  out: string | null;
};
export const ZIP_LIMIT_BYTES: number;
export function parseArgs(argv: string[]): MeasureArgs;
export function syntheticPdf(index: number, size: number, method?: "deflate" | "stored"): Buffer;
export function buildSyntheticZip(options?: { files?: number; targetBytes?: number; method?: "deflate" | "stored" }): { bytes: Uint8Array; names: string[] };
export function buildManifest(names: string[], options: { matter: string; person: string; day?: string }): string;
