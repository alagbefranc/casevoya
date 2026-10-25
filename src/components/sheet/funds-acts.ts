"use client";

import { toast2 } from "@/components/port/kit";
import {
  addClientAccount,
  approveClientTransfer,
  declineClientTransfer,
  recordClientDeposit,
  recordClientFundCorrection,
  recordClientRefund,
  recordClientTransferBank,
  rejectClientDeposit,
  requestClientTransfer,
  verifyClientDeposit,
} from "@/modules/finance/client-funds-actions";
import { FUNDS_DIALOG, readBankTransfer, readDeposit, readReason, readRefundToClient, readTransfer } from "@/modules/finance/client-funds-present";
import { financeNeedsStepUp, financeStepUpLocation } from "@/modules/sheet/finance-present";
import { runAdvance, syncReviewers } from "./manual-pay-acts";

/**
 * The Client funds tab's dialogs. Openers fill a dialog from their data attributes; submit buttons
 * call the server actions. A refusal that needs a step-up keeps what was typed (this tab only) and
 * comes back with the dialog open again.
 */

type Router = { refresh: () => void; replace: (href: string) => void };
type Open = (id: string) => void;

const DRAFT = "cv-funds-draft";

function value(root: ParentNode, id: string): string {
  return root.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`#${id}`)?.value ?? "";
}

function setText(root: ParentNode, id: string, text: string | undefined) {
  const node = root.querySelector<HTMLElement>(`#${id}`);
  if (node) node.textContent = text ?? "—";
}

/** One key per dialog opening: a double click or a retry records one entry. */
function keyFor(button: HTMLElement): string {
  if (!button.dataset.key) button.dataset.key = `cf-${crypto.randomUUID()}`;
  return button.dataset.key;
}

/** Narrows a dialog's invoice and entry choices to the chosen client ledger. */
export function syncFundsLedger(dialog: ParentNode) {
  const ledgerSelect = dialog.querySelector<HTMLSelectElement>("select[data-ledger-select]");
  const matter = ledgerSelect?.selectedOptions[0]?.dataset.matter ?? "";
  const narrow = (select: HTMLSelectElement | null, attribute: "matter" | "ledger", wanted: string) => {
    if (!select) return;
    let first: HTMLOptionElement | null = null;
    for (const option of select.options) {
      const show = !wanted || option.dataset[attribute] === wanted;
      option.hidden = !show;
      option.disabled = !show;
      if (show && !first) first = option;
    }
    if (select.selectedOptions[0]?.hidden !== false && first) select.value = first.value;
  };
  narrow(dialog.querySelector<HTMLSelectElement>("select[data-matter-filter]"), "matter", matter);
  const filtered = dialog.querySelector<HTMLSelectElement>("select[data-ledger-filter]");
  if (filtered) narrow(filtered, "ledger", filtered.dataset.ledger ?? "");
}

/** A ledger's Transfer earned fees, Refund or Correct an entry: picks that ledger, then opens the dialog. */
export function openFunds(opener: HTMLElement, root: ParentNode, open: Open) {
  const id = opener.dataset.fundsOpen ?? "";
  const dialog = root.querySelector<HTMLDialogElement>(`dialog#${CSS.escape(id)}`);
  if (!dialog) return;
  const ledger = opener.dataset.ledger ?? "";
  const select = dialog.querySelector<HTMLSelectElement>("select[data-ledger-select]");
  if (select && ledger && [...select.options].some((option) => option.value === ledger)) select.value = ledger;
  const filtered = dialog.querySelector<HTMLSelectElement>("select[data-ledger-filter]");
  if (filtered) filtered.dataset.ledger = ledger;
  syncFundsLedger(dialog);
  // An opener for one entry (Record bank transfer CF-0003) picks it.
  const entry = opener.dataset.entry ?? "";
  if (filtered && entry && [...filtered.options].some((option) => option.value === entry && !option.hidden)) filtered.value = entry;
  open(id);
}

/** A ledger's Verify button: fills #dlgVer with that payment. */
export function openVerify(opener: HTMLElement, root: ParentNode, open: Open) {
  const dialog = root.querySelector<HTMLDialogElement>("dialog#dlgVer");
  if (!dialog) return;
  const data = opener.dataset;
  setText(dialog, "dlgVerH", data.client ? `Verify ${data.client}’s payment` : "Verify a payment");
  setText(dialog, "vA", data.amount);
  setText(dialog, "vR", data.reference);
  setText(dialog, "vD", data.received);
  setText(dialog, "vE", data.evidence);
  setText(dialog, "vB", data.by);
  setText(dialog, "vV", data.reviewer);
  setText(dialog, "vT", data.dest);
  // FIN-09: the advance's evidence file, when one was uploaded.
  const file = dialog.querySelector<HTMLElement>("[data-mp-evidence]");
  if (file) {
    file.dataset.mpEvidence = data.evidenceFile ?? "";
    file.toggleAttribute("hidden", !data.evidenceFile);
  }
  const check = dialog.querySelector<HTMLInputElement>("#vOk");
  if (check) check.checked = false;
  // Second person: whoever recorded it can't verify it, unless they are the firm owner.
  const canVerify = data.canVerify !== "0";
  dialog.querySelector<HTMLElement>("#vSelf")?.toggleAttribute("hidden", canVerify);
  dialog.querySelector<HTMLElement>("#vOwn")?.toggleAttribute("hidden", data.ownEntry !== "1");
  const verify = dialog.querySelector<HTMLButtonElement>("[data-funds-verify]");
  if (verify) verify.disabled = !canVerify;
  for (const button of dialog.querySelectorAll<HTMLElement>("[data-funds-verify], [data-funds-reject]")) button.dataset.entry = data.fundsVerifyOpen ?? "";
  open("dlgVer");
}

/** A ledger's Review transfer button: fills #dlgTr, its Approve label and whether this person may approve. */
export function openReview(opener: HTMLElement, root: ParentNode, open: Open) {
  const dialog = root.querySelector<HTMLDialogElement>("dialog#dlgTr");
  if (!dialog) return;
  const data = opener.dataset;
  setText(dialog, "tF", data.from);
  setText(dialog, "tFor", data.for);
  setText(dialog, "tA", data.amount);
  setText(dialog, "tAp", data.approvals);
  const canApprove = data.canApprove === "1";
  dialog.querySelector<HTMLElement>("#tSelf")?.toggleAttribute("hidden", canApprove);
  const approve = dialog.querySelector<HTMLButtonElement>("[data-funds-approve]");
  if (approve) {
    approve.textContent = data.approveLabel ?? "Approve";
    approve.disabled = !canApprove;
  }
  for (const button of dialog.querySelectorAll<HTMLElement>("[data-funds-approve], [data-funds-decline]")) button.dataset.entry = data.fundsReview ?? "";
  open("dlgTr");
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

/** Keeps the dialog's fields and ticks, the entry and the key, then goes to the step-up screen. */
function stepUp(dialog: HTMLDialogElement, button: HTMLElement) {
  const fields: Record<string, string> = {};
  const checks: Record<string, boolean> = {};
  for (const field of dialog.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input[id], select[id], textarea[id]")) {
    if (field instanceof HTMLInputElement && field.type === "checkbox") checks[field.id] = field.checked;
    else fields[field.id] = field.value;
  }
  try {
    sessionStorage.setItem(DRAFT, JSON.stringify({ dialog: dialog.id, fields, checks, entry: button.dataset.entry ?? null, key: button.dataset.key ?? null }));
  } catch {
    // Storage can be unavailable; the person opens the dialog again.
  }
  window.location.assign(financeStepUpLocation(window.location.pathname, window.location.search, FUNDS_DIALOG, "client_funds"));
}

function failed(dialog: HTMLDialogElement, button: HTMLElement, error: string, sub: string): void {
  if (financeNeedsStepUp(error)) return stepUp(dialog, button);
  toast2(error, { kind: "bad", sub });
}

/**
 * After a step-up (`?dlg=funds`): reopen the same dialog, for the same entry, with what was typed and
 * ticked. The owner verifying their own entry comes back to #dlgVer for that payment, still ticked.
 */
export function reopenFundsDialog(root: ParentNode, open: Open) {
  if (new URLSearchParams(window.location.search).get("dlg") !== FUNDS_DIALOG) return;
  let draft: { dialog?: unknown; fields?: unknown; checks?: unknown; entry?: unknown; key?: unknown } | null = null;
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
  const entry = typeof draft.entry === "string" ? draft.entry : "";
  if (dialog.id === "dlgTr" || dialog.id === "dlgVer") {
    const attribute = dialog.id === "dlgTr" ? "data-funds-review" : "data-funds-verify-open";
    const opener = [...root.querySelectorAll<HTMLElement>(`[${attribute}]`)].find((item) => item.getAttribute(attribute) === entry);
    if (!opener) return;
    if (dialog.id === "dlgTr") openReview(opener, root, () => undefined);
    else openVerify(opener, root, () => undefined);
  }
  const fields = (draft.fields ?? {}) as Record<string, unknown>;
  for (const [id, saved] of Object.entries(fields)) {
    const field = dialog.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`#${CSS.escape(id)}`);
    if (field && typeof saved === "string") field.value = saved;
  }
  const checks = (draft.checks ?? {}) as Record<string, unknown>;
  for (const [id, saved] of Object.entries(checks)) {
    const field = dialog.querySelector<HTMLInputElement>(`input#${CSS.escape(id)}[type="checkbox"]`);
    if (field && typeof saved === "boolean") field.checked = saved;
  }
  syncFundsLedger(dialog);
  syncReviewers(dialog);
  if (typeof draft.key === "string") {
    for (const button of dialog.querySelectorAll<HTMLElement>(".df .btn.p")) button.dataset.key = draft.key;
  }
  open(dialog.id);
}

/**
 * Record a bank payment (#dlgPay). With the FIN-09 fields (a Reviewer select is in the dialog) it
 * records an advance with its reference, evidence file or note and reviewer (`record_client_advance`);
 * otherwise the plain deposit, as before.
 */
export async function runDeposit(button: HTMLElement, router: Router) {
  const dialog = button.closest("dialog");
  if (!dialog) return;
  if (dialog.querySelector("select[data-reviewers]")) {
    const refused = await runAdvance(button, router);
    if (refused) failed(dialog, button, refused.error, "Nothing was recorded.");
    return;
  }
  const today = button.dataset.today ?? "";
  const typed = { party: value(dialog, "mpC"), amount: value(dialog, "mpA"), method: value(dialog, "mpM"), reference: value(dialog, "mpR"), received: value(dialog, "mpD"), account: value(dialog, "mpB"), evidence: value(dialog, "mpE") };
  const read = readDeposit(typed, today);
  if ("error" in read) return void toast2(read.error, { kind: "warn", sub: "Nothing was recorded." });
  const result = await recordClientDeposit({ organizationId: button.dataset.org ?? "", idempotencyKey: keyFor(button), today, ...typed });
  if ("error" in result) return failed(dialog, button, result.error, "Nothing was recorded.");
  done(dialog, router, "Payment recorded", "Pending verification. It counts once it matches the bank statement.");
}

export async function runVerify(button: HTMLElement, router: Router) {
  const dialog = button.closest("dialog");
  if (!dialog) return;
  if (!dialog.querySelector<HTMLInputElement>("#vOk")?.checked) return void toast2("Tick the check first", { kind: "warn", sub: "Verify only what matches the bank statement." });
  const result = await verifyClientDeposit({ organizationId: button.dataset.org ?? "", entryId: button.dataset.entry ?? "" });
  if ("error" in result) return failed(dialog, button, result.error, "Nothing changed.");
  done(dialog, router, "Payment verified", "It now counts in the client’s ledger, and the client’s receipt is ready.");
}

export async function runReject(button: HTMLElement, router: Router) {
  const dialog = button.closest("dialog");
  if (!dialog) return;
  const reason = readReason(value(dialog, "vWhy"));
  if ("error" in reason) return void toast2(reason.error, { kind: "warn", sub: "Say why it doesn’t match." });
  const result = await rejectClientDeposit({ organizationId: button.dataset.org ?? "", entryId: button.dataset.entry ?? "", reason: reason.reason });
  if ("error" in result) return failed(dialog, button, result.error, "Nothing changed.");
  done(dialog, router, "Payment rejected", "It stays on the ledger and never counts.");
}

export async function runApprove(button: HTMLElement, router: Router) {
  const dialog = button.closest("dialog");
  if (!dialog) return;
  const result = await approveClientTransfer({ organizationId: button.dataset.org ?? "", entryId: button.dataset.entry ?? "" });
  if ("error" in result) return failed(dialog, button, result.error, "Nothing was approved.");
  done(
    dialog,
    router,
    result.ownSelf ? "Approved by owner (own request)" : "Transfer approved",
    "The invoice is paid from client funds. Record the bank transfer next, once the bank has sent it.",
  );
}

export async function runDecline(button: HTMLElement, router: Router) {
  const dialog = button.closest("dialog");
  if (!dialog) return;
  const reason = readReason(value(dialog, "tWhy"));
  if ("error" in reason) return void toast2(reason.error, { kind: "warn", sub: "Say why it’s declined." });
  const result = await declineClientTransfer({ organizationId: button.dataset.org ?? "", entryId: button.dataset.entry ?? "", reason: reason.reason });
  if ("error" in result) return failed(dialog, button, result.error, "Nothing changed.");
  done(dialog, router, "Transfer declined", "Funds stay in the client account.");
}

export async function runTransfer(button: HTMLElement, router: Router) {
  const dialog = button.closest("dialog");
  if (!dialog) return;
  const typed = { ledger: value(dialog, "tnL"), invoice: value(dialog, "tnI"), amount: value(dialog, "tnA"), note: value(dialog, "tnN") };
  const ledgerOption = dialog.querySelector<HTMLSelectElement>("#tnL")?.selectedOptions[0];
  const invoiceOption = dialog.querySelector<HTMLSelectElement>("#tnI")?.selectedOptions[0];
  const limits = [Number(ledgerOption?.dataset.available), Number(invoiceOption?.dataset.due)].filter((limit) => Number.isSafeInteger(limit));
  const read = readTransfer(typed, limits.length ? Math.min(...limits) : null);
  if ("error" in read) return void toast2(read.error, { kind: "warn", sub: "Nothing was asked for." });
  const result = await requestClientTransfer({ organizationId: button.dataset.org ?? "", idempotencyKey: keyFor(button), ...typed });
  if ("error" in result) return failed(dialog, button, result.error, "Nothing was asked for.");
  done(dialog, router, "Transfer waiting for approval", "Its amount is held until it’s approved or declined.");
}

export async function runRefundToClient(button: HTMLElement, router: Router) {
  const dialog = button.closest("dialog");
  if (!dialog) return;
  const today = button.dataset.today ?? "";
  const typed = { ledger: value(dialog, "roL"), amount: value(dialog, "roA"), method: value(dialog, "roM"), reference: value(dialog, "roR"), paid: value(dialog, "roD"), reason: value(dialog, "roW") };
  const available = Number(dialog.querySelector<HTMLSelectElement>("#roL")?.selectedOptions[0]?.dataset.available);
  const read = readRefundToClient(typed, today, Number.isSafeInteger(available) ? available : null);
  if ("error" in read) return void toast2(read.error, { kind: "warn", sub: "Nothing was recorded." });
  const result = await recordClientRefund({ organizationId: button.dataset.org ?? "", idempotencyKey: keyFor(button), today, ...typed });
  if ("error" in result) return failed(dialog, button, result.error, "Nothing was recorded.");
  done(dialog, router, "Refund recorded", "It’s on the client’s ledger.");
}

export async function runCorrection(button: HTMLElement, router: Router) {
  const dialog = button.closest("dialog");
  if (!dialog) return;
  const reason = readReason(value(dialog, "rcW"));
  if ("error" in reason) return void toast2(reason.error, { kind: "warn", sub: "Say what was wrong." });
  const result = await recordClientFundCorrection({ organizationId: button.dataset.org ?? "", idempotencyKey: keyFor(button), entryId: value(dialog, "rcE"), reason: reason.reason });
  if ("error" in result) return failed(dialog, button, result.error, "Nothing was recorded.");
  done(dialog, router, "Reversing entry added", "Both entries stay on the ledger.");
}

export async function runClientAccount(button: HTMLElement, router: Router) {
  const dialog = button.closest("dialog");
  if (!dialog) return;
  const result = await addClientAccount({ organizationId: button.dataset.org ?? "", label: value(dialog, "caL"), institution: value(dialog, "caI"), last4: value(dialog, "caN") });
  if ("error" in result) return failed(dialog, button, result.error, "Nothing was added.");
  done(dialog, router, "Client account added", "Record advances to it with Record a payment.");
}

export async function runBankTransfer(button: HTMLElement, router: Router) {
  const dialog = button.closest("dialog");
  if (!dialog) return;
  const today = button.dataset.today ?? "";
  const typed = { entry: value(dialog, "bkE"), transferred: value(dialog, "bkD"), reference: value(dialog, "bkR"), note: value(dialog, "bkN") };
  const earliest = dialog.querySelector<HTMLSelectElement>("#bkE")?.selectedOptions[0]?.dataset.earliest ?? null;
  const read = readBankTransfer(typed, today, earliest);
  if ("error" in read) return void toast2(read.error, { kind: "warn", sub: "Nothing was recorded." });
  const result = await recordClientTransferBank({ organizationId: button.dataset.org ?? "", today, ...typed });
  if ("error" in result) return failed(dialog, button, result.error, "Nothing was recorded.");
  done(dialog, router, "Bank transfer recorded", "The transfer now reads Transferred.");
}
