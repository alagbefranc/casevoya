"use client";

import { toast2 } from "@/components/port/kit";
import { completeConsentReview, resetClientTwoStep } from "@/modules/sheet/person-consent-actions";
import { CONSENT_REVIEW_DIALOG, TWO_STEP_RESET_DIALOG, readIdentityMethod, readReviewNote } from "@/modules/sheet/person-consent-present";

type Router = { refresh: () => void };

function dialogById(id: string): HTMLDialogElement | null {
  return document.getElementById(id) as HTMLDialogElement | null;
}

/** "Mark review done" on a review: the dialog remembers which review and version, then opens. */
export function openConsentReview(button: HTMLElement) {
  const dialog = dialogById(CONSENT_REVIEW_DIALOG);
  if (!dialog) return;
  dialog.dataset.review = button.dataset.crOpen ?? "";
  dialog.dataset.version = button.dataset.crVersion ?? "";
  const note = dialog.querySelector<HTMLTextAreaElement>("#crNote");
  if (note) note.value = "";
  if (!dialog.open) dialog.showModal();
  note?.focus();
}

/** SEC-05: public.complete_consent_review checks who may, the version and the note. */
export async function runConsentReviewDone(button: HTMLElement, router: Router) {
  const dialog = dialogById(CONSENT_REVIEW_DIALOG);
  if (!dialog) return;
  const read = readReviewNote(dialog.querySelector<HTMLTextAreaElement>("#crNote")?.value ?? "");
  if ("error" in read) {
    toast2(read.error, { kind: "warn", sub: "The review is still open." });
    return;
  }
  const result = await completeConsentReview({
    organizationId: button.dataset.org ?? "",
    reviewId: dialog.dataset.review ?? "",
    version: Number(dialog.dataset.version ?? ""),
    note: read.note,
  });
  if ("error" in result) {
    toast2(result.error, { kind: "bad", sub: "The review is still open." });
    return;
  }
  dialog.close();
  toast2("Review done", { kind: "ok", sub: "Its task is complete. Your note is kept with the review and in the audit trail." });
  router.refresh();
}

/** SEC-01: the staff-assisted reset of a client's two-step, after a fresh code. */
export async function runClientTwoStepReset(button: HTMLElement, router: Router) {
  const dialog = dialogById(TWO_STEP_RESET_DIALOG);
  if (!dialog) return;
  const read = readIdentityMethod(dialog.querySelector<HTMLInputElement>("#tsrM")?.value ?? "");
  if ("error" in read) {
    toast2(read.error, { kind: "warn", sub: "Nothing was reset." });
    return;
  }
  const code = dialog.querySelector<HTMLInputElement>("#tsrC")?.value.trim() ?? "";
  if (!/^\d{6}$/.test(code)) {
    toast2("Enter the six-digit code from your authenticator app.", { kind: "warn", sub: "Nothing was reset." });
    return;
  }
  const result = await resetClientTwoStep({
    organizationId: button.dataset.org ?? "",
    personId: button.dataset.person ?? "",
    method: read.method,
    note: dialog.querySelector<HTMLTextAreaElement>("#tsrN")?.value ?? "",
    code,
  });
  if ("error" in result) {
    toast2(result.error, { kind: "bad", sub: "Nothing was reset." });
    return;
  }
  dialog.close();
  toast2("Two-step reset", { kind: "ok", sub: "The client’s sessions ended. They sign in with their password and can turn two-step on again." });
  router.refresh();
}
