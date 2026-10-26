/**
 * SEC-07: the deletion job runner. It is the only place stored files of an approved deletion job
 * are removed, and it runs only from POST /api/retention/run (the scheduler, service role), never
 * inside a person's request. For each job the database hands out (public.service_claim_deletion_job):
 *   storage items  re-check (public.service_deletion_item_ready: still running, no legal hold, still
 *                  eligible, not linked to another matter since approval), remove the object, record
 *                  it (public.service_record_deletion_item 'deleted', or 'missing' when the object
 *                  was already gone);
 *   database items (Vo readings, unsent Vo drafts) are removed by public.service_record_deletion_item
 *                  itself, after the same re-check.
 * Then public.service_finish_deletion_job writes the tombstone once nothing is pending. A storage
 * error stops that job for this run; its lease lapses and the next run resumes from the items still
 * pending. Pure apart from the injected database and storage calls, so tests use fakes.
 */

export type RpcResult<T> = { data: T | null; error: { message: string } | null };

export type DeletionItem = { id: string; kind: string; bucket: string | null; storage_key: string | null };
export type ClaimedJob = { job_id: string; organization_id: string; items: DeletionItem[] };

export type RunnerDeps = {
  claim: () => Promise<RpcResult<unknown>>;
  ready: (itemId: string) => Promise<RpcResult<boolean>>;
  record: (itemId: string, outcome: "deleted" | "missing") => Promise<RpcResult<boolean>>;
  finish: (jobId: string) => Promise<RpcResult<string>>;
  /** Removes one stored object: "deleted", "missing" (already gone) or "error". */
  remove: (bucket: string, key: string) => Promise<"deleted" | "missing" | "error">;
};

export type RunSummary = { jobs: { id: string; status: string; removed: number; skipped: number; error: string | null }[] };

/** The claim's JSON, or null when nothing waits or it isn't the expected shape. */
export function readClaim(value: unknown): ClaimedJob | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.job_id !== "string" || typeof row.organization_id !== "string" || !Array.isArray(row.items)) return null;
  const items: DeletionItem[] = [];
  for (const raw of row.items) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    if (typeof item.id !== "string" || typeof item.kind !== "string") continue;
    items.push({
      id: item.id,
      kind: item.kind,
      bucket: typeof item.bucket === "string" ? item.bucket : null,
      storage_key: typeof item.storage_key === "string" ? item.storage_key : null,
    });
  }
  return { job_id: row.job_id, organization_id: row.organization_id, items };
}

const STORAGE_BUCKETS = new Set(["documents", "matter-exports"]);

/** Runs up to `maxJobs` jobs. Never throws: a failure is reported and the job resumes next run. */
export async function runDeletionJobs(deps: RunnerDeps, options: { maxJobs?: number } = {}): Promise<RunSummary> {
  const summary: RunSummary = { jobs: [] };
  const maxJobs = options.maxJobs ?? 3;
  for (let n = 0; n < maxJobs; n += 1) {
    const claimed = await deps.claim();
    if (claimed.error) break;
    const job = readClaim(claimed.data);
    if (!job) break;
    let removed = 0;
    let skipped = 0;
    let error: string | null = null;
    for (const item of job.items) {
      if (item.bucket && item.storage_key) {
        if (!STORAGE_BUCKETS.has(item.bucket)) {
          error = "unknown bucket";
          break;
        }
        const ready = await deps.ready(item.id);
        if (ready.error) {
          error = "re-check failed";
          break;
        }
        if (ready.data !== true) {
          skipped += 1;
          continue;
        }
        const outcome = await deps.remove(item.bucket, item.storage_key);
        if (outcome === "error") {
          error = "storage delete failed";
          break;
        }
        const recorded = await deps.record(item.id, outcome);
        if (recorded.error) {
          error = "record failed";
          break;
        }
        if (recorded.data === true) removed += 1;
        else skipped += 1;
      } else {
        const recorded = await deps.record(item.id, "deleted");
        if (recorded.error) {
          error = "record failed";
          break;
        }
        if (recorded.data === true) removed += 1;
        else skipped += 1;
      }
    }
    if (error) {
      summary.jobs.push({ id: job.job_id, status: "running", removed, skipped, error });
      // The lease lapses and the next run resumes this job; try the next one now.
      continue;
    }
    const finished = await deps.finish(job.job_id);
    summary.jobs.push({ id: job.job_id, status: finished.data ?? "running", removed, skipped, error: finished.error ? "finish failed" : null });
  }
  return summary;
}
