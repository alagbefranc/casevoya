import "server-only";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import { memberNames } from "@/modules/sheet/chrome-load";
import { loadSheetAccess } from "@/modules/sheet/load";
import { isoDateInTimeZone } from "@/modules/sheet/present";
import { exportStamp, reportCsv, reportPdf } from "@/modules/sheet/reports-export";
import { readRunReport, runReportFile, runReportFilename } from "./report";

/**
 * MIG-02: a finished import's run report as CSV or PDF, for the firm owner. The download is audited
 * by the database (public.record_migration_report_download) before the file is drawn; a refusal
 * means no file. The report holds counts, checksums and exceptions (column and problem, never a
 * value from the file).
 */
export async function migrationReportResponse(batchId: string, format: "csv" | "pdf"): Promise<Response> {
  const json = (error: string, status: number) => Response.json({ error }, { status });
  if (!isUuid(batchId)) return json("Choose an import.", 400);
  const access = await loadSheetAccess();
  if (access.kind !== "live" && access.kind !== "sample") return json("Sign in first.", 401);
  const staff = access.staff;
  if (staff.role !== "firm_owner") return json("Only the firm owner can download an import’s report.", 403);
  const supabase = await createClient({ organizationId: staff.organizationId });
  const audit = await supabase.rpc("record_migration_report_download", { p_org: staff.organizationId, p_batch: batchId, p_format: format });
  if (audit.error) return json("That report isn’t available. Reload the page.", 404);
  const batch = await supabase
    .from("migration_batches")
    .select("file_name, run_report, exceptions, pilot_signed_off_by")
    .eq("organization_id", staff.organizationId)
    .eq("id", batchId)
    .maybeSingle();
  const report = readRunReport(batch.data?.run_report);
  if (!batch.data || !report) return json("That report isn’t available. Reload the page.", 404);

  let signedOffBy: string | null = null;
  if (batch.data.pilot_signed_off_by) {
    const member = await supabase
      .from("memberships")
      .select("id")
      .eq("organization_id", staff.organizationId)
      .eq("user_id", batch.data.pilot_signed_off_by)
      .limit(1)
      .maybeSingle();
    if (member.data) signedOffBy = (await memberNames(supabase, staff.organizationId)).get(member.data.id) ?? null;
  }
  const now = new Date();
  const file = runReportFile({
    report,
    exceptions: Array.isArray(batch.data.exceptions) ? (batch.data.exceptions as { row?: number; column?: string; problem?: string; fix?: string }[]) : [],
    firm: staff.organizationName,
    timeZone: staff.timezone,
    generated: exportStamp(now, staff.timezone),
    madeBy: staff.displayName,
    signedOffBy,
  });
  const filename = runReportFilename(batch.data.file_name, isoDateInTimeZone(now, staff.timezone), format);
  const headers = {
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (format === "pdf") {
    const bytes = await reportPdf(file);
    return new Response(Buffer.from(bytes), { headers: { ...headers, "Content-Type": "application/pdf" } });
  }
  return new Response(reportCsv(file), { headers: { ...headers, "Content-Type": "text/csv; charset=utf-8" } });
}
