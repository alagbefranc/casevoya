/**
 * REP-03: the scheduled reports runner. POST /api/reports/scheduled/run calls it with the service
 * role when pg_cron (app.kick_scheduled_reports, every 5 minutes while a schedule is due) asks.
 * The database does the work in public.service_run_scheduled_reports: once per due time it checks
 * every recipient again (still active staff of the firm, still in a role that sees the tab), logs
 * a skip for anyone who fails, and gives everyone else an in-app link to the report tab. Nothing
 * here reads or sends report figures; no email is sent (no approved design exists for it).
 */

export type RpcResult<T> = { data: T | null; error: { message: string } | null };

export type ScheduledRunSummary = { schedules: number; delivered: number; skipped: number };

function count(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

/** The database's summary, or zeros when it isn't the expected shape. */
export function readRunSummary(value: unknown): ScheduledRunSummary {
  const row = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  return { schedules: count(row.schedules), delivered: count(row.delivered), skipped: count(row.skipped) };
}

export async function runScheduledReports(run: (limit: number) => Promise<RpcResult<unknown>>, limit = 50): Promise<ScheduledRunSummary> {
  const result = await run(limit);
  if (result.error) throw new Error("scheduled reports run failed");
  return readRunSummary(result.data);
}
