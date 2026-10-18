/**
 * Report exports (REP-03): CSV and PDF from the same figures the page shows. Each file starts
 * with what it was made from: report, filters, generated time and timezone, currency, who made
 * it and who can see the report. Nothing is stored; the download is audited by the database
 * (public.record_report_export) before the file is drawn.
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { ReportsMoney, ReportsOps, ReportsOutcomes, ReportsTab } from "@/components/sheet/designer/reports";

export type ReportSection = { title: string; head: string[]; rows: string[][]; definition?: string; note?: string };

export type ReportFile = {
  title: string;
  meta: [string, string][];
  sections: ReportSection[];
};

export const REPORT_TITLE: Record<ReportsTab, string> = {
  ops: "Operations report",
  money: "Money report",
  outcomes: "Processing and outcomes report",
  scheduled: "Scheduled reports",
};

export function reportSections(tab: ReportsTab, data: { ops?: ReportsOps | null; money?: ReportsMoney | null; outcomes?: ReportsOutcomes | null }): ReportSection[] {
  if (tab === "ops" && data.ops) {
    const ops = data.ops;
    return [
      { title: "Lead conversion", head: ["Step", "Count"], rows: ops.leads.bars.map((bar) => [bar.label, String(bar.count)]), note: ops.leads.note, definition: ops.leads.definition },
      { title: "Stage ageing, open matters", head: ["Stage", "Matters", "Median days", "Oldest"], rows: ops.ageing.rows.map((row) => [row.stage, String(row.matters), row.median, row.oldest]), definition: ops.ageing.definition },
      {
        title: "Workload",
        head: ["Person", "Open tasks", "Overdue", "Matters"],
        rows: ops.workload.rows.map((row) => [row.person, String(row.open), String(row.overdue), String(row.matters)]),
        note: "Workload is shown for planning, not ranking. Nobody is ranked by approval rate.",
        definition: ops.workload.definition,
      },
      { title: "Outstanding documents", head: ["State", "Requests"], rows: ops.documents.bars.map((bar) => [bar.label, String(bar.count)]), definition: ops.documents.definition },
      {
        title: "Consultation attendance",
        head: ["Booked", "Attended", "Rescheduled", "No-show"],
        rows: [[String(ops.attendance.booked), String(ops.attendance.attended), String(ops.attendance.rescheduled), String(ops.attendance.noShow)]],
        definition: ops.attendance.definition,
      },
    ];
  }
  if (tab === "money" && data.money) {
    const money = data.money;
    return [
      {
        title: "Receivables ageing",
        head: ["Age", "Invoices", "CAD"],
        rows: [...money.ageing.rows.map((row) => [row.age, String(row.invoices), row.amount]), ["Total", String(money.ageing.total.invoices), money.ageing.total.amount]],
        definition: money.ageing.definition,
      },
      { title: "Invoiced and collected", head: ["Month", "Invoiced (CAD)", "Collected (CAD)"], rows: money.months.rows.map((row) => [row.month, row.invoiced, row.collected]), definition: money.months.definition },
      { title: "Client-account balances", head: ["Client", "Held (CAD)", "Pending (CAD)"], rows: money.balances.rows.map((row) => [row.client, row.held, row.pending]), definition: money.balances.definition },
      { title: "Reconciliation exceptions", head: ["Summary"], rows: [[money.recon.text]], definition: money.recon.definition },
    ];
  }
  if (tab === "outcomes" && data.outcomes) {
    const outcomes = data.outcomes;
    const sections: ReportSection[] = [
      {
        title: "Government processing, decided files only",
        head: ["Program", "Cohort", "Decided files", "Median days to decision", "Still pending (not counted)"],
        rows: outcomes.rows.map((row) => [row.program, row.cohort, String(row.decided), row.median, String(row.pending)]),
        note: outcomes.note,
        definition: outcomes.definition,
      },
    ];
    if (outcomes.firm) {
      sections.push({
        title: "Firm work time, opened to submitted",
        head: ["Program", "Cohort", "Submitted files", "Median days, opened to submitted"],
        rows: outcomes.firm.rows.map((row) => [row.program, row.cohort, String(row.files), row.median]),
        definition: outcomes.firm.definition,
      });
    }
    return sections;
  }
  return [];
}

function cell(value: string): string {
  // Quote every cell; neutralise spreadsheet formulas (CSV injection).
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function reportCsv(file: ReportFile): string {
  const lines: string[] = [cell(file.title)];
  for (const [key, value] of file.meta) lines.push(`${cell(key)},${cell(value)}`);
  for (const section of file.sections) {
    lines.push("");
    lines.push(cell(section.title));
    lines.push(section.head.map(cell).join(","));
    for (const row of section.rows) lines.push(row.map(cell).join(","));
    if (!section.rows.length) lines.push(cell("No rows"));
    if (section.note) lines.push(cell(section.note));
    if (section.definition) lines.push(cell(section.definition));
  }
  return `﻿${lines.join("\r\n")}\r\n`;
}

/** WinAnsi-safe text for the standard PDF fonts. */
function ascii(text: string): string {
  return text
    .replaceAll("–", "-")
    .replaceAll("—", "-")
    .replaceAll("’", "'")
    .replaceAll("“", '"')
    .replaceAll("”", '"')
    .replaceAll("›", ">")
    .replace(/[^\x20-\x7e -ÿ]/g, "?");
}

function wrap(text: string, width: number, size: number, measure: (s: string, size: number) => number): string[] {
  const words = ascii(text).split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (measure(next, size) > width && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

export async function reportPdf(file: ReportFile): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(ascii(file.title));
  pdf.setProducer("Casevoya");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 612;
  const H = 792;
  const M = 48;
  let page = pdf.addPage([W, H]);
  let y = H - M;
  const ink = rgb(0.1, 0.1, 0.1);
  const grey = rgb(0.38, 0.36, 0.34);
  const need = (h: number) => {
    if (y - h < M) {
      page = pdf.addPage([W, H]);
      y = H - M;
    }
  };
  const text = (value: string, size: number, f = font, color = ink, x = M) => {
    for (const line of wrap(value, W - M - x, size, (s, z) => f.widthOfTextAtSize(s, z))) {
      need(size + 4);
      page.drawText(line, { x, y: y - size, size, font: f, color });
      y -= size + 4;
    }
  };
  text(file.title, 18, bold);
  y -= 4;
  for (const [key, value] of file.meta) text(`${key}: ${value}`, 9, font, grey);
  for (const section of file.sections) {
    y -= 12;
    text(section.title, 12, bold);
    const cols = section.head.length;
    const colW = (W - 2 * M) / cols;
    const row = (cells: string[], f = font) => {
      const wrapped = cells.map((c) => wrap(c, colW - 6, 9, (s, z) => f.widthOfTextAtSize(s, z)));
      const h = Math.max(1, ...wrapped.map((l) => l.length)) * 13;
      need(h);
      wrapped.forEach((lines, index) => lines.forEach((line, n) => page.drawText(line, { x: M + index * colW, y: y - 9 - n * 13, size: 9, font: f, color: ink })));
      y -= h;
    };
    row(section.head, bold);
    if (!section.rows.length) row(["No rows"]);
    for (const cells of section.rows) row(cells);
    if (section.note) text(section.note, 9, font, grey);
    if (section.definition) text(section.definition, 8, font, grey);
  }
  return pdf.save();
}

export function reportFilename(tab: ReportsTab, today: string, format: "csv" | "pdf"): string {
  return `casevoya-${tab}-report-${today}.${format}`;
}
