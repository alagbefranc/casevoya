"use client";

import { toast2 } from "@/components/port/kit";

/**
 * Reports > Export: the Designer's dialog asks the route for the chosen format, saves the file
 * on this device, closes the dialog and shows the Designer's "Export ready" toast. The route
 * audits the export before drawing it.
 */
export async function runReportExport(button: HTMLElement): Promise<void> {
  const href = button.dataset.reportExport;
  if (!href) return;
  const dialog = button.closest("dialog");
  const format = (dialog?.querySelector<HTMLSelectElement>("#exF")?.value ?? "CSV").toLowerCase() === "pdf" ? "pdf" : "csv";
  try {
    const response = await fetch(`${href}&format=${format}`, { credentials: "same-origin" });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      toast2("Export didn’t start", { kind: "warn", sub: body?.error ?? "Try again in a moment." });
      return;
    }
    const blob = await response.blob();
    const name = /filename="([^"]+)"/.exec(response.headers.get("Content-Disposition") ?? "")?.[1] ?? `report.${format}`;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
    dialog?.close();
    toast2("Export ready", { kind: "ok", sub: "Downloaded to this device." });
  } catch {
    toast2("Export didn’t start", { kind: "warn", sub: "Check your connection and try again." });
  }
}
