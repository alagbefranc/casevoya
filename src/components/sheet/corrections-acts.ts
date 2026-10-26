"use client";

import { goStepUp } from "@/lib/auth/step-up-resume";
import { toast2 } from "@/components/port/kit";
import {
  declineCreditNote,
  discardReconciliation,
  issueCreditNote,
  prepareReconciliation,
  requestCreditNote,
  signReconciliation,
  voidInvoice,
} from "@/modules/finance/correction-actions";
import { CREDIT_NOTE_DIALOG, RECON_DIALOG, readCreditNote, readReasonText, readReconciliation, readSign } from "@/modules/finance/corrections-present";
import { formatMoney } from "@/modules/finance/money";
import { financeNeedsStepUp, financeStepUpLocation } from "@/modules/sheet/finance-present";

/**
 * The single-invoice tab's credit note and void dialogs, and the Reconciliation tab's dialogs.
 * Submit buttons call the server actions. A refusal that needs a step-up keeps what was typed (this
 * tab only) and comes back with the same dialog open, for the same credit note.
 */

type Router = { refresh: () => void; replace: (href: string) => void };
type Open = (id: string) => void;

const DRAFT = "cv-corrections-draft";

function value(root: ParentNode, id: string): string {
  return root.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`#${id}`)?.value ?? "";
}

function setText(root: ParentNode, id: string, text: string | undefined) {
  const node = root.querySelector<HTMLElement>(`#${id}`);
  if (node) node.textContent = text ?? "—";
}

/** One key per dialog opening: a double click or a retry drafts one note or prepares one reconciliation. */
function keyFor(button: HTMLElement, prefix: string): string {
  if (!button.dataset.key) button.dataset.key = `${prefix}-${crypto.randomUUID()}`;
  return button.dataset.key;
}

function done(dialog: HTMLDialogElement, router: Router, title: string, sub: string) {
  for (const button of dialog.querySelectorAll<HTMLElement>("[data-key]")) delete button.dataset.key;
  dialog.close();
  toast2(title, { kind: "ok", sub });
  const params = new URLSearchParams(window.location.search);
  params.delete("dlg");
  const query = params.toString();
  router.replace(`${window.location.pathname}${query ? `?${query}` : ""}`);
  router.refresh();
}

function stepUp(dialog: HTMLDialogElement, button: HTMLElement, flag: string) {
  const fields: Record<string, string> = {};
  for (const field of dialog.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input[id], select[id], textarea[id]")) fields[field.id] = field.value;
  try {
    sessionStorage.setItem(DRAFT, JSON.stringify({ dialog: dialog.id, fields, note: button.dataset.note ?? null, key: button.dataset.key ?? null }));
  } catch {
    // Storage can be unavailable; the person opens the dialog again.
  }
  goStepUp(financeStepUpLocation(window.location.pathname, window.location.search, flag, flag === RECON_DIALOG ? "reconciliation" : "credit_note"));
}

function failed(dialog: HTMLDialogElement, button: HTMLElement, error: string, sub: string, flag: string): void {
  if (financeNeedsStepUp(error)) return stepUp(dialog, button, flag);
  toast2(error, { kind: "bad", sub });
}

// ---------------------------------------------------------------------------
// Credit notes and voids (single-invoice tab)
// ---------------------------------------------------------------------------

export async function runCreditDraft(button: HTMLElement, router: Router) {
  const dialog = button.closest("dialog");
  if (!dialog) return;
  const max = Number(button.dataset.max ?? "");
  const typed = { invoice: button.dataset.invoice ?? "", amount: value(dialog, "cnA"), reason: value(dialog, "cnR") };
  const read = readCreditNote(typed, Number.isSafeInteger(max) ? max : null);
  if ("error" in read) return void toast2(read.error, { kind: "warn", sub: "Nothing was drafted." });
  const result = await requestCreditNote({ organizationId: button.dataset.org ?? "", idempotencyKey: keyFor(button, "cn"), ...typed });
  if ("error" in result) return failed(dialog, button, result.error, "Nothing was drafted.", CREDIT_NOTE_DIALOG);
  done(dialog, router, "Credit note drafted", "Someone other than you reviews it before it’s issued. Nothing changes on the invoice until then.");
}

/** A draft's Review: fills `#dlgCNR` with that credit note and whether this person may issue it. */
export function openCreditReview(opener: HTMLElement, root: ParentNode, open: Open) {
  const dialog = root.querySelector<HTMLDialogElement>("dialog#dlgCNR");
  if (!dialog) return;
  const data = opener.dataset;
  setText(dialog, "cnrN", data.number);
  setText(dialog, "cnrA", data.amount);
  setText(dialog, "cnrR", data.reason);
  setText(dialog, "cnrB", data.by);
  const canIssue = data.canIssue !== "0";
  dialog.querySelector<HTMLElement>("#cnrSelf")?.toggleAttribute("hidden", canIssue);
  dialog.querySelector<HTMLElement>("#cnrOwn")?.toggleAttribute("hidden", data.own !== "1");
  const issue = dialog.querySelector<HTMLButtonElement>("[data-cn-issue]");
  if (issue) {
    issue.disabled = !canIssue;
    issue.textContent = data.own === "1" ? "Issue as owner (own draft)" : "Issue credit note";
  }
  for (const button of dialog.querySelectorAll<HTMLElement>("[data-cn-issue], [data-cn-decline]")) button.dataset.note = data.cnReview ?? "";
  open("dlgCNR");
}

export async function runCreditIssue(button: HTMLElement, router: Router) {
  const dialog = button.closest("dialog");
  if (!dialog) return;
  const result = await issueCreditNote({ organizationId: button.dataset.org ?? "", creditNoteId: button.dataset.note ?? "" });
  if ("error" in result) return failed(dialog, button, result.error, "Nothing was issued.", CREDIT_NOTE_DIALOG);
  done(
    dialog,
    router,
    result.ownSelf ? `${result.number} issued by owner (own draft)` : `Credit note ${result.number} issued`,
    result.creditBalanceCents > 0
      ? `${formatMoney(result.creditBalanceCents, "CAD")} is more than was owed: refund it separately. A credit note doesn’t move money.`
      : "It reduces what the client owes. The client sees it in their portal.",
  );
}

export async function runCreditDecline(button: HTMLElement, router: Router) {
  const dialog = button.closest("dialog");
  if (!dialog) return;
  const reason = readReasonText(value(dialog, "cnrW"));
  if ("error" in reason) return void toast2(reason.error, { kind: "warn", sub: "Say why it’s declined." });
  const result = await declineCreditNote({ organizationId: button.dataset.org ?? "", creditNoteId: button.dataset.note ?? "", reason: reason.reason });
  if ("error" in result) return failed(dialog, button, result.error, "Nothing changed.", CREDIT_NOTE_DIALOG);
  done(dialog, router, "Credit note declined", "It stays on record; the invoice is unchanged.");
}

export async function runVoid(button: HTMLElement, router: Router) {
  const dialog = button.closest("dialog");
  if (!dialog) return;
  const reason = readReasonText(value(dialog, "vdW"));
  if ("error" in reason) return void toast2(reason.error, { kind: "warn", sub: "Say why it’s voided." });
  const result = await voidInvoice({ organizationId: button.dataset.org ?? "", invoiceId: button.dataset.invoice ?? "", reason: reason.reason });
  if ("error" in result) return failed(dialog, button, result.error, "Nothing changed.", CREDIT_NOTE_DIALOG);
  done(
    dialog,
    router,
    "Invoice voided",
    result.notCanceled > 0
      ? "A card payment the client started couldn’t be canceled in Stripe. If it still goes through, it shows here to refund."
      : "It stays on record and can’t be paid. Nothing changes on the matter.",
  );
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

export async function runRecPrepare(button: HTMLElement, router: Router) {
  const dialog = button.closest("dialog");
  if (!dialog) return;
  const today = button.dataset.today ?? "";
  const typed = { account: value(dialog, "rcA"), date: value(dialog, "rcD"), balance: value(dialog, "rcB"), note: value(dialog, "rcN") };
  const after = dialog.querySelector<HTMLSelectElement>("#rcA")?.selectedOptions[0]?.dataset.after ?? null;
  const read = readReconciliation(typed, today, after);
  if ("error" in read) return void toast2(read.error, { kind: "warn", sub: "Nothing was prepared." });
  const result = await prepareReconciliation({ organizationId: button.dataset.org ?? "", idempotencyKey: keyFor(button, "rec"), today, ...typed });
  if ("error" in result) return failed(dialog, button, result.error, "Nothing was prepared.", RECON_DIALOG);
  done(dialog, router, "Reconciliation prepared", "Someone other than you signs it. The figures are checked again then.");
}

export async function runRecSign(button: HTMLElement, router: Router) {
  const dialog = button.closest("dialog");
  if (!dialog) return;
  const difference = Number(button.dataset.difference ?? "");
  const typed = { outcome: value(dialog, "rsO"), notes: value(dialog, "rsN") };
  const read = readSign(typed, Number.isSafeInteger(difference) ? difference : null);
  if ("error" in read) return void toast2(read.error, { kind: "warn", sub: "Nothing was signed." });
  const result = await signReconciliation({ organizationId: button.dataset.org ?? "", reconciliationId: button.dataset.rec ?? "", ...typed });
  if ("error" in result) return failed(dialog, button, result.error, "Nothing was signed.", RECON_DIALOG);
  done(
    dialog,
    router,
    result.status === "exceptions" ? "Signed with exceptions" : result.ownSelf ? "Reconciled (owner, own preparation)" : "Reconciled",
    "It’s kept as signed and can’t be changed.",
  );
}

export async function runRecDiscard(button: HTMLElement, router: Router) {
  const dialog = button.closest("dialog");
  if (!dialog) return;
  const reason = readReasonText(value(dialog, "rsN"));
  if ("error" in reason) return void toast2("Give the reason to discard it in the notes.", { kind: "warn", sub: "Nothing was discarded." });
  const result = await discardReconciliation({ organizationId: button.dataset.org ?? "", reconciliationId: button.dataset.rec ?? "", reason: reason.reason });
  if ("error" in result) return failed(dialog, button, result.error, "Nothing was discarded.", RECON_DIALOG);
  done(dialog, router, "Reconciliation discarded", "It stays on record. Prepare a new one from the statement.");
}

/** After a step-up (`?dlg=credit` or `?dlg=recon`): reopen the same dialog, for the same credit note, with what was typed. */
export function reopenCorrectionsDialog(root: ParentNode, open: Open) {
  const flag = new URLSearchParams(window.location.search).get("dlg");
  if (flag !== CREDIT_NOTE_DIALOG && flag !== RECON_DIALOG) return;
  let draft: { dialog?: unknown; fields?: unknown; note?: unknown; key?: unknown } | null = null;
  try {
    const raw = sessionStorage.getItem(DRAFT);
    sessionStorage.removeItem(DRAFT);
    draft = raw ? JSON.parse(raw) : null;
  } catch {
    draft = null;
  }
  if (!draft || typeof draft.dialog !== "string") return;
  const dialog = root.querySelector<HTMLDialogElement>(`dialog#${CSS.escape(draft.dialog)}`);
  if (!dialog) return;
  const note = typeof draft.note === "string" ? draft.note : "";
  if (dialog.id === "dlgCNR") {
    const opener = [...root.querySelectorAll<HTMLElement>("[data-cn-review]")].find((item) => item.dataset.cnReview === note);
    if (!opener) return;
    openCreditReview(opener, root, () => undefined);
  }
  for (const [id, saved] of Object.entries((draft.fields ?? {}) as Record<string, unknown>)) {
    const field = dialog.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`#${CSS.escape(id)}`);
    if (field && typeof saved === "string") field.value = saved;
  }
  if (typeof draft.key === "string") {
    for (const button of dialog.querySelectorAll<HTMLElement>(".df .btn.p")) button.dataset.key = draft.key;
  }
  open(dialog.id);
}
