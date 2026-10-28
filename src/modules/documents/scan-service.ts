import "server-only";

import type { createServiceClient } from "@/lib/supabase/service";
import type { ScanRunnerDeps } from "@/modules/documents/scan-runner";
import { scanWithAvScanner, type ScanTransport } from "@/modules/documents/virus-scan";

type ServiceClient = ReturnType<typeof createServiceClient>;

/** #263-B: the scan runner's database, storage and scanner calls, with the service role. */
export function serviceScanDeps(service: ServiceClient, options: { timeoutMs?: number; transport?: ScanTransport } = {}): ScanRunnerDeps {
  return {
    claim: async ({ limit, versionId, backfill }) =>
      service.rpc("service_claim_document_scans", {
        p_limit: limit,
        ...(versionId ? { p_version_id: versionId } : {}),
        p_backfill: backfill,
      }),
    download: async (bucket, key) => {
      const downloaded = await service.storage.from(bucket).download(key);
      if (downloaded.error || !downloaded.data) return null;
      return new Uint8Array(await downloaded.data.arrayBuffer());
    },
    scan: (bytes) => scanWithAvScanner(bytes, { timeoutMs: options.timeoutMs, transport: options.transport }),
    record: async ({ versionId, outcome, signature, engine }) =>
      service.rpc("service_record_document_scan", {
        p_version_id: versionId,
        p_outcome: outcome,
        ...(signature ? { p_signature: signature } : {}),
        ...(engine ? { p_engine: engine } : {}),
      }),
  };
}
