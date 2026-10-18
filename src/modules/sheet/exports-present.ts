/** Pure helpers for the Client-file exports page (T040). */
import type { ExportJobStep, ExportState } from "@/components/sheet/designer/exports";
import { safeAccessError } from "@/lib/auth/step-up";

/** Plain words for a refusal from the export functions. Never the database message itself. */
export function exportError(message: string): string {
  if (/step-up|aal2|recovery code/i.test(message)) return safeAccessError(message);
  if (/already building/i.test(message)) return "An export of this matter is already being built.";
  if (/expired/i.test(message)) return "That download link has expired. Start a new export.";
  if (/not ready/i.test(message)) return "That export isn’t ready yet.";
  if (/only a building export/i.test(message)) return "Only an export that is still being built can be cancelled.";
  if (/legal hold/i.test(message)) return "This matter is under a legal hold.";
  if (/denied|permission/i.test(message)) return "Your role can’t export this matter.";
  return "That didn’t work. Try again.";
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
};

/** The history row's state badge. */
export function exportState(row: ExportRowInput, now: Date): ExportState {
  if (row.status === "building") return { tone: "blue", label: "Running" };
  if (row.status === "cancelled") return { tone: "gr", label: "Cancelled" };
  if (row.status === "failed") return { tone: "bad", label: "Stopped", detail: row.failureReason ?? "the build didn’t finish" };
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
