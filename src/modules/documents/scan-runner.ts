/**
 * #263-B: the virus scan runner. POST /api/documents/scan/run calls it with the service role
 * when pg_cron (app.kick_document_scans, every minute while a scan is due) asks, and the upload
 * action calls it for the one file it just finished, so most files are checked before the person
 * leaves the page. The database decides everything that matters: which files are due
 * (public.service_claim_document_scans counts each attempt and leases the file), and what an
 * answer does (public.service_record_document_scan: clean, quarantined, or retry with backoff and
 * finally scan_failed). This side only moves bytes: it reads the stored file and hands it to the
 * scanner. A file it can't read, or a scanner that doesn't answer, is recorded as an error, never
 * as clean.
 */
import type { ScanOutcome } from "@/modules/documents/virus-scan";

export type RpcResult<T> = { data: T | null; error: { message: string } | null };

export type ScanClaim = {
  versionId: string;
  bucket: string;
  storageKey: string;
  byteSize: number;
  attempt: number;
  backfill: boolean;
};

export type ScanRunnerDeps = {
  claim: (input: { limit: number; versionId: string | null; backfill: boolean }) => Promise<RpcResult<unknown>>;
  download: (bucket: string, key: string) => Promise<Uint8Array | null>;
  scan: (bytes: Uint8Array) => Promise<ScanOutcome>;
  record: (input: { versionId: string; outcome: "clean" | "infected" | "error"; signature: string | null; engine: string | null }) => Promise<RpcResult<unknown>>;
};

export type ScanRunSummary = {
  claimed: number;
  clean: number;
  infected: number;
  errors: number;
  /** Each claimed version's upload_state after its answer was recorded. */
  states: Record<string, string>;
};

/** The largest file the scanner is sent: the product's 100 MB ceiling (documents/files.ts). */
export const SCAN_MAX_BYTES = 104_857_600;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The claimed rows, or none when the database's answer isn't the expected shape. */
export function readClaims(value: unknown): ScanClaim[] {
  if (!Array.isArray(value)) return [];
  const claims: ScanClaim[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    if (typeof item.version_id !== "string" || !UUID.test(item.version_id)) continue;
    if (typeof item.storage_bucket !== "string" || typeof item.storage_key !== "string" || !item.storage_key) continue;
    claims.push({
      versionId: item.version_id,
      bucket: item.storage_bucket,
      storageKey: item.storage_key,
      byteSize: Number(item.byte_size) || 0,
      attempt: Number(item.attempt) || 0,
      backfill: item.backfill === true,
    });
  }
  return claims;
}

function stateOf(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const state = (value as Record<string, unknown>).upload_state;
  return typeof state === "string" ? state : null;
}

export async function runDocumentScans(
  deps: ScanRunnerDeps,
  options: { limit?: number; versionId?: string | null; backfill?: boolean } = {},
): Promise<ScanRunSummary> {
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 5), 1), 10);
  const claimed = await deps.claim({ limit, versionId: options.versionId ?? null, backfill: options.backfill === true });
  if (claimed.error) throw new Error("document scan claim failed");
  const claims = readClaims(claimed.data);
  const summary: ScanRunSummary = { claimed: claims.length, clean: 0, infected: 0, errors: 0, states: {} };
  for (const claim of claims) {
    let outcome: ScanOutcome;
    const bytes = claim.byteSize > SCAN_MAX_BYTES ? null : await deps.download(claim.bucket, claim.storageKey).catch(() => null);
    if (!bytes || bytes.byteLength > SCAN_MAX_BYTES) outcome = { result: "error", reason: "unreadable" };
    else outcome = await deps.scan(bytes).catch((): ScanOutcome => ({ result: "error", reason: "unavailable" }));
    const recorded = await deps.record({
      versionId: claim.versionId,
      outcome: outcome.result,
      signature: outcome.result === "infected" ? outcome.signature : null,
      engine: outcome.engine ?? null,
    });
    if (outcome.result === "clean") summary.clean++;
    else if (outcome.result === "infected") summary.infected++;
    else summary.errors++;
    const state = recorded.error ? null : stateOf(recorded.data);
    if (state) summary.states[claim.versionId] = state;
  }
  return summary;
}
