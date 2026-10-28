/** Pure helpers for the Client-file exports page (T040). */
import type { ExportJobStep, ExportState } from "@/components/sheet/designer/exports";
import { safeAccessError } from "@/lib/auth/step-up";

/** Plain words for a refusal from the export functions. Never the database message itself. */
export function exportError(message: string): string {
  if (/step-up|aal2|recovery code/i.test(message)) return safeAccessError(message);
  if (/already building/i.test(message)) return "An export of this matter is already being built.";
  if (/was deleted/i.test(message)) return "This export’s file was deleted under the firm’s retention policy. It can’t be downloaded.";
  if (/expired/i.test(message)) return "That download link has expired. Start a new export.";
  if (/not ready/i.test(message)) return "That export isn’t ready yet.";
  if (/only a building export/i.test(message)) return "Only an export that is still being built can be cancelled.";
  if (/legal hold/i.test(message)) return "This matter is under a legal hold.";
  if (/denied|permission/i.test(message)) return "Your role can’t export this matter.";
  return "That didn’t work. Try again.";
}

/** The download route's HTTP status for a refusal: a deleted or expired export is gone (410). */
export function exportRefusalStatus(message: string): 403 | 410 {
  return /was deleted|expired/i.test(message) ? 410 : 403;
}

/** The download route's words when the ZIP is missing from storage (404), never a bare 502. */
export const EXPORT_FILE_MISSING = "This export’s file is no longer stored, so it can’t be downloaded. Start a new export.";

/** Whether a storage error means the object isn't there (Supabase answers 400 with statusCode "404", "Object not found"). */
export function storageObjectMissing(error: { message?: unknown; status?: unknown; statusCode?: unknown } | null | undefined): boolean {
  if (!error) return false;
  return String(error.statusCode ?? "") === "404" || error.status === 404 || /not\s*found/i.test(String(error.message ?? ""));
}

/** "41.2 MB", "820 KB", "512 B". */
export function byteSize(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export type ExportRowInput = {
  status: "building" | "ready" | "failed" | "cancelled";
  expiresAt: string | null;
  lastDownloadedOn: string | null;
  failureReason: string | null;
  expiresLabel: string | null;
  /** How many files the build left out (matter_exports.excluded). */
  excludedCount?: number;
  /** When the ZIP was deleted (matter_exports.removed_at, a retention deletion), as a short date. */
  removedOn?: string | null;
};

/** A ready export whose link is still open and whose file still exists: the only kind with a Download. */
export function exportDownloadable(row: { status: string; expiresAt: string | null; removedAt: string | null }, now: Date): boolean {
  return row.status === "ready" && row.removedAt === null && row.expiresAt !== null && Date.parse(row.expiresAt) > now.getTime();
}

/** "1 file left out" / "12 files left out". */
export function excludedLabel(count: number): string {
  return `${count} ${count === 1 ? "file" : "files"} left out`;
}

/**
 * The page warning when the latest ready export left files out, grouped by reason so a firm sees
 * at once that the copy is incomplete. Null when nothing was left out.
 */
export function excludedWarning(
  matter: string,
  excluded: readonly { path?: unknown; reason?: unknown }[],
): { title: string; copy: string; items: string[] } | null {
  if (!excluded.length) return null;
  const reasons = new Map<string, number>();
  for (const item of excluded) {
    const reason = typeof item.reason === "string" ? item.reason.replace(/^Not included:\s*/i, "").replace(/\.$/, "") : "not readable";
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  }
  return {
    title: `This export of ${matter} is incomplete: ${excludedLabel(excluded.length)}`,
    copy: "The manifest inside the ZIP lists each one. Download those files from the matter, or start a new export once the cause is fixed.",
    items: [...reasons].map(([reason, count]) => `${count} × ${reason.charAt(0).toUpperCase()}${reason.slice(1)}`),
  };
}

/** The history row's state badge. */
export function exportState(row: ExportRowInput, now: Date): ExportState {
  if (row.status === "building") return { tone: "blue", label: "Running" };
  if (row.status === "cancelled") return { tone: "gr", label: "Cancelled" };
  if (row.status === "failed") return { tone: "bad", label: "Stopped", detail: row.failureReason ?? "the build didn’t finish" };
  // #262: the ZIP was deleted under the firm's retention policy; it never reads as Ready again.
  if (row.removedOn) return { tone: "gr", label: "Deleted", detail: `file removed ${row.removedOn} under the firm’s retention policy` };
  const missing = row.excludedCount ?? 0;
  if (missing > 0) {
    const expiredIncomplete = !row.expiresAt || Date.parse(row.expiresAt) <= now.getTime();
    return {
      tone: "chg",
      label: expiredIncomplete ? "Incomplete" : row.lastDownloadedOn ? `Incomplete · downloaded ${row.lastDownloadedOn}` : "Incomplete",
      detail: `${excludedLabel(missing)}${expiredIncomplete ? ", link expired" : `, link open until ${row.expiresLabel}`}`,
    };
  }
  const expired = !row.expiresAt || Date.parse(row.expiresAt) <= now.getTime();
  if (expired) return row.lastDownloadedOn ? { tone: "ok", label: `Downloaded ${row.lastDownloadedOn}`, detail: "link expired" } : { tone: "gr", label: "Link expired" };
  return row.lastDownloadedOn
    ? { tone: "ok", label: `Downloaded ${row.lastDownloadedOn}`, detail: `link open until ${row.expiresLabel}` }
    : { tone: "ok", label: "Ready", detail: `link open until ${row.expiresLabel}` };
}

/** The running job's four steps, as the Designer shows them. The build writes 30, 60 and 85 as steps finish. */
export function jobSteps(input: { progress: number; status: string; files: number | null; started: string; ready: string | null }): ExportJobStep[] {
  const current = input.status === "ready" ? 4 : input.progress >= 85 ? 3 : input.progress >= 60 ? 2 : input.progress >= 30 ? 1 : 0;
  const state = (index: number): ExportJobStep["state"] => (index < current ? "done" : index === current ? "now" : "todo");
  return [
    { label: input.files !== null ? `Collect ${input.files} files` : "Collect the matter’s records and files", state: state(0), time: state(0) === "done" ? input.started : state(0) === "now" ? "in progress" : "" },
    { label: "Add audit trail and manifest", state: state(1), time: state(1) === "done" ? (input.ready ?? "") : state(1) === "now" ? "in progress" : "" },
    { label: "Package and store privately", state: state(2), time: state(2) === "done" ? (input.ready ?? "") : state(2) === "now" ? "in progress" : "" },
    { label: "Ready to download", state: state(3), time: state(3) === "done" ? (input.ready ?? "") : state(3) === "now" ? "in progress" : "" },
  ];
}
