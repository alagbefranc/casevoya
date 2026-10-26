import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { loadSheetAccess } from "@/modules/sheet/load";
import { roleLabel } from "@/modules/sheet/present";
import { REPORT_TITLE, exportMeta, exportStamp, reportCsv, reportFilename, reportPdf, reportSections, type ReportFile } from "@/modules/sheet/reports-export";
import { canSeeTab, loadReportTab } from "@/modules/sheet/reports-load";
import { NO_PROGRAM, programFilter, programName } from "@/modules/sheet/reports-outcomes";
import { RANGE_LABEL, rangeLabel, reportRange, reportsTab } from "@/modules/sheet/reports-present";

/**
 * A report as CSV or PDF (REP-03), drawn on request from live records as the signed-in staff
 * member (RLS decides the rows). public.record_report_export checks the role for the tab and
 * writes the audit row (tab, period, format, segment; no figures) first; a refused audit means no
 * file. Each file starts with its filters, generated time in the firm's timezone, currency and who
 * generated it. Nothing is stored.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const tab = reportsTab(url.searchParams.get("tab") ?? undefined);
  const range = reportRange(url.searchParams.get("range") ?? undefined);
  const format = url.searchParams.get("format") === "pdf" ? "pdf" : "csv";
  const program = tab === "outcomes" ? programFilter(url.searchParams.get("program")) : null;
  if (tab === "scheduled") return NextResponse.json({ error: "There is nothing to export on this tab." }, { status: 400 });

  const access = await loadSheetAccess();
  if (access.kind !== "live" && access.kind !== "sample") return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const staff = access.staff;
  if (!canSeeTab(staff.role, tab)) return NextResponse.json({ error: "Your role can’t export this report." }, { status: 403 });

  const supabase = await createClient({ organizationId: staff.organizationId });
  const audit = await supabase.rpc("record_report_export", { p_organization_id: staff.organizationId, p_tab: tab, p_range: range, p_format: format, p_segment: program });
  if (audit.error) return NextResponse.json({ error: "Your role can’t export this report." }, { status: 403 });

  const now = new Date();
  const loaded = await loadReportTab(staff, tab, range, now, { program });
  const generated = exportStamp(now, staff.timezone);
  const file: ReportFile = {
    title: `${REPORT_TITLE[tab]}, ${staff.organizationName}`,
    meta: exportMeta({
      tab,
      period: tab === "outcomes" ? "All submitted files (cohorts by quarter of submission; the period chips don’t apply)" : `${RANGE_LABEL[range]} (${rangeLabel(loaded.from, loaded.today)})`,
      segment: program ? programName(program === NO_PROGRAM ? null : program) : null,
      scope: loaded.scope,
      generated,
      currency: "CAD",
      madeBy: staff.displayName,
      role: roleLabel(staff.role),
      reference: String(audit.data ?? ""),
      capped: loaded.capped,
      sampleMode: staff.sampleMode,
    }),
    sections: reportSections(tab, loaded),
    footer: `${REPORT_TITLE[tab]}, generated ${generated} by ${staff.displayName}`,
  };
  const filename = reportFilename(tab, loaded.today, format);
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
