/** Pure helpers that turn matter records into the Designer Matters list's words. */
import type { MatterBadge } from "@/components/sheet/designer/matters";
import { governmentLabel } from "@/modules/sheet/present";

export const MATTERS_PAGE = 50;
/** A firm's whole list is read once so views and search see every matter, not one page. */
export const MATTERS_READ = 1000;

const GOVERNMENT_TONE: Record<string, MatterBadge["tone"]> = {
  not_recorded: "unv",
  receipt_on_file: "ok",
  processing_reported: "ok",
  additional_request_open: "chg",
  decision_evidence_on_file: "ok",
};

export function governmentBadge(status: string): MatterBadge {
  return { tone: GOVERNMENT_TONE[status] ?? "unv", label: governmentLabel(status) };
}

/** "express_entry_pr" → "Express entry pr". Programs are keyed by their rule pack. */
export function programLabel(key: string | null | undefined): string {
  if (!key) return "—";
  const words = key.replace(/[_-]+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : "—";
}

export function pageLimit(raw: string | undefined): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < MATTERS_PAGE) return MATTERS_PAGE;
  return Math.min(Math.floor(value / MATTERS_PAGE) * MATTERS_PAGE, MATTERS_READ);
}
