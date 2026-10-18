/** Pure helpers for the matter page's dialogs: what to save, and where to send a step-up. */
import { safeAccessError } from "@/lib/auth/step-up";
import { MATTER_STAGES } from "@/modules/sheet/present";

export type MatterDialog = "stage" | "hold" | "letter";

/** The matter actions turn a database step-up refusal into one of these messages. */
const STEP_UP_ERRORS = new Set([safeAccessError("step-up is required"), safeAccessError("aal2")]);

export function needsStepUp(error: string | null | undefined): boolean {
  return Boolean(error && STEP_UP_ERRORS.has(error));
}

/**
 * The step-up screen, coming back to this matter with the dialog open again
 * (`?dlg=` reopens it). Without a dialog the page simply reloads.
 */
export function stepUpLocation(pathname: string, search: string, dialog: MatterDialog | null): string {
  const params = new URLSearchParams(search);
  if (dialog) params.set("dlg", dialog);
  else params.delete("dlg");
  const query = params.toString();
  const next = `${pathname}${query ? `?${query}` : ""}`;
  return `/mfa?step=6&next=${encodeURIComponent(next)}`;
}

/** The same URL without `?dlg=`, so a refresh after saving does not reopen the dialog. */
export function withoutDialog(pathname: string, search: string): string {
  const params = new URLSearchParams(search);
  params.delete("dlg");
  const query = params.toString();
  return `${pathname}${query ? `?${query}` : ""}`;
}

/** The stage dialog's radios carry the stage's position in the Designer's list. */
export function stageAt(value: string | null | undefined): string | null {
  if (value == null || !/^\d+$/.test(value)) return null;
  return MATTER_STAGES[Number(value)] ?? null;
}

/** What each kind of government letter records as the matter's government status. */
const LETTER_STATUS: Record<string, string> = {
  "Request for documents": "additional_request_open",
  "Acknowledgement of receipt": "receipt_on_file",
  "Biometrics instruction": "processing_reported",
  "Procedural fairness letter": "additional_request_open",
  Decision: "decision_evidence_on_file",
};

export function letterStatus(type: string): string | null {
  return LETTER_STATUS[type] ?? null;
}

/** The history note for a recorded letter. Only what the person entered. */
export function letterNote(input: { type: string; receivedOn: string; via: string; deadline: string }): string {
  const parts = [`${input.type} letter`];
  if (input.receivedOn) parts.push(`received ${input.receivedOn}`);
  if (input.via) parts.push(`by ${input.via}`);
  const note = parts.join(", ");
  const deadline = input.deadline.trim();
  return deadline ? `${note}. Deadline in the letter: ${deadline}` : note;
}
