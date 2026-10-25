"use client";

import { toast2 } from "@/components/port/kit";
import { authorizeDocumentDownload } from "@/modules/documents/actions";
import {
  addBankAccount,
  addReconciliationItem,
  recordClientAdvance,
  recordManualPayment,
  rejectManualPayment,
  removeReconciliationItem,
  reverseManualPayment,
  verifyManualPayment,
} from "@/modules/finance/manual-payment-actions";
import { ACCOUNTS_DIALOG, MANUAL_DIALOG, readAdvance, readManualPayment, readReconItem, readReverse } from "@/modules/finance/manual-payments-present";
import { financeNeedsStepUp, financeStepUpLocation } from "@/modules/sheet/finance-present";
import { chooseFile, uploadEvidence } from "./gov-acts";
import { acceptChosen, failUpload } from "./upload-failure";

/**
 * Manual payments (FIN-09), the reconciliation workspace's outstanding items (FIN-12) and the bank
 * account records: openers fill a dialog from their data attributes, submits call the server
 * actions. An evidence file is uploaded through the document path (staff-only, on the matter) before
 * the payment is recorded. A refusal that needs a step-up keeps what was typed and comes back with
 * the dialog open (`?dlg=manual` / `?dlg=accounts`); a chosen file has to be chosen again.
 */

type Router = { refresh: () => void; replace: (href: string) => void };
type Open = (id: string) => void;

const DRAFT = "cv-manual-draft";
const files = new Map<string, File>();

function value(root: ParentNode, id: string): string {
  return root.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`#${id}`)?.value ?? "";
}

function setText(root: ParentNode, id: string, text: string | undefined) {
  const node = root.querySelector<HTMLElement>(`#${id}`);
  if (node) node.textContent = text || "—";
}

function keyFor(button: HTMLElement, prefix: string): string {
  if (!button.dataset.key) button.dataset.key = `${prefix}-${crypto.randomUUID()}`;
  return button.dataset.key;
}

function done(dialog: HTMLDialogElement, router: Router, title: string, sub: string) {
  for (const button of dialog.querySelectorAll<HTMLElement>("[data-key]")) delete button.dataset.key;
  for (const id of [...files.keys()]) if (dialog.querySelector(`#${CSS.escape(id)}`)) files.delete(id);
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
  for (const field of dialog.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input[id]:not([type=checkbox]), select[id], textarea[id]")) fields[field.id] = field.value;
  try {
    sessionStorage.setItem(DRAFT, JSON.stringify({ dialog: dialog.id, fields, payment: button.dataset.payment ?? null, key: button.dataset.key ?? null }));
  } catch {
    // Storage can be unavailable; the person opens the dialog again.
  }
  window.location.assign(financeStepUpLocation(window.location.pathname, window.location.search, flag, "manual_payment"));
}

function failed(dialog: HTMLDialogElement, button: HTMLElement, error: string, sub: string, flag = MANUAL_DIALOG): void {
  if (financeNeedsStepUp(error)) return stepUp(dialog, button, flag);
  toast2(error, { kind: "bad", sub });
}

// ---------------------------------------------------------------------------
// Evidence files
// ---------------------------------------------------------------------------

/** The evidence picker's Upload button: keeps the file for the dialog's submit and shows its name. */
export async function pickEvidence(button: HTMLElement) {
  const id = button.dataset.mpFile ?? "";
  const file = await chooseFile();
  if (!file || !id) return;
  // DES-04: a file this upload can't take is refused here, with a next step and a retry.
  if (!acceptChosen(button, file, "evidence", () => void pickEvidence(button))) {
    files.delete(id);
    return;
  }
  files.set(id, file);
  const label = button.closest(".fld")?.querySelector<HTMLElement>(`#${CSS.escape(`${id}F`)}`);
  if (label) label.textContent = file.name;
}

/** Uploads the chosen evidence file (if any) as a staff-only document on the matter. */
async function uploadChosen(fieldId: string, organizationId: string, matterId: string, purpose: string): Promise<{ versionId: string | null } | { error: string }> {
  const file = files.get(fieldId);
  if (!file) return { versionId: null };
  const uploaded = await uploadEvidence({ organizationId, matterId, file, purpose });
  if ("error" in uploaded) {
    // DES-04: the failure where the file was chosen, with Choose another file / Try again.
    const picker = document.querySelector<HTMLElement>(`[data-mp-file="${CSS.escape(fieldId)}"]`);
    if (picker && !financeNeedsStepUp(uploaded.error)) failUpload(picker, uploaded.error, "evidence", () => void pickEvidence(picker));
    return {
      error: financeNeedsStepUp(uploaded.error)
        ? uploaded.error
        : `${uploaded.error} Uploading needs a recent confirmation with your authenticator and permission to file documents on this matter. You can describe the evidence instead.`,
    };
  }
  return { versionId: uploaded.versionId };
}

/** Open the evidence file: a short-lived link after a fresh access check. */
export async function runEvidenceOpen(button: HTMLElement) {
  const result = await authorizeDocumentDownload({ organizationId: button.dataset.org ?? "", versionId: button.dataset.mpEvidence ?? "" });
  if ("error" in result) return void toast2(result.error ?? "That file cannot be opened.", { kind: "bad", sub: "Only staff who can read the matter’s documents open it." });
  window.open(result.url, "_blank", "noopener,noreferrer");
}

function showEvidenceButton(dialog: ParentNode, versionId: string | undefined) {
  const open = dialog.querySelector<HTMLElement>("[data-mp-evidence]");
  if (!open) return;
  open.dataset.mpEvidence = versionId ?? "";
  open.toggleAttribute("hidden", !versionId);
}

// ---------------------------------------------------------------------------
// Invoice manual payments
// ---------------------------------------------------------------------------

/** A Verify or Mark reversed or failed action: fills its dialog with that payment, then opens it. */
export function openManual(opener: HTMLElement, root: ParentNode, open: Open) {
  const data = opener.dataset;
  if (data.mpOpen === "verify") {
    const dialog = root.querySelector<HTMLDialogElement>("dialog#dlgMPV");
    if (!dialog) return;
    setText(dialog, "dlgMPVH", data.number ? `Verify ${data.number}` : "Verify a manual payment");
    setText(dialog, "mvA", data.amount);
    setText(dialog, "mvR", data.method);
    setText(dialog, "mvD", data.received);
    setText(dialog, "mvT", data.dest);
    setText(dialog, "mvE", data.evidence);
    setText(dialog, "mvB", data.by);
    setText(dialog, "mvV", data.reviewer);
    showEvidenceButton(dialog, data.evidenceFile);
    const check = dialog.querySelector<HTMLInputElement>("#mvOk");
    if (check) check.checked = false;
    const canVerify = data.canVerify !== "0";
    dialog.querySelector<HTMLElement>("#mvSelf")?.toggleAttribute("hidden", canVerify);
    const verify = dialog.querySelector<HTMLButtonElement>("[data-mp-verify]");
    if (verify) verify.disabled = !canVerify;
    for (const button of dialog.querySelectorAll<HTMLElement>("[data-mp-verify], [data-mp-reject]")) button.dataset.payment = data.payment ?? "";
    open("dlgMPV");
    return;
  }
  const dialog = root.querySelector<HTMLDialogElement>("dialog#dlgMPR");
  if (!dialog) return;
  setText(dialog, "mrS", data.summary);
  const outcome = dialog.querySelector<HTMLSelectElement>("#mrO");
  const verified = data.verified === "1";
  if (outcome) {
    const reversed = [...outcome.options].find((option) => option.value === "reversed");
    if (reversed) reversed.disabled = !verified;
    outcome.value = verified ? "reversed" : "failed";
  }
  const submit = dialog.querySelector<HTMLElement>("[data-mp-reverse]");
  if (submit) {
    submit.dataset.payment = data.payment ?? "";
    submit.dataset.verified = verified ? "1" : "0";
  }
  open("dlgMPR");
}

export async function runManualRecord(button: HTMLElement, router: Router) {
  const dialog = button.closest("dialog");
  if (!dialog) return;
  const today = button.dataset.today ?? "";
  const organizationId = button.dataset.org ?? "";
  const max = Number(button.dataset.max ?? "");
  const typed = {
    invoice: button.dataset.invoice ?? "",
    amount: value(dialog, "mxA"),
    method: value(dialog, "mxM"),
    reference: value(dialog, "mxR"),
    received: value(dialog, "mxD"),
    account: value(dialog, "mxB"),
    note: value(dialog, "mxE"),
    reviewer: value(dialog, "mxV"),
  };
  const read = readManualPayment(typed, today, files.has("mxE"), Number.isSafeInteger(max) ? max : null);
  if ("error" in read) return void toast2(read.error, { kind: "warn", sub: "Nothing was recorded." });
  const uploaded = await uploadChosen("mxE", organizationId, button.dataset.matter ?? "", `Payment evidence: ${typed.reference.trim()}`.slice(0, 200));
  if ("error" in uploaded) return failed(dialog, button, uploaded.error, "Nothing was recorded.");
  const result = await recordManualPayment({ organizationId, idempotencyKey: keyFor(button, "mp"), today, evidenceVersionId: uploaded.versionId, ...typed });
  if ("error" in result) return failed(dialog, button, result.error, "Nothing was recorded.");
  done(dialog, router, "Payment recorded", "Pending verification. The invoice isn’t marked paid until the reviewer verifies it.");
}

export async function runManualVerify(button: HTMLElement, router: Router) {
  const dialog = button.closest("dialog");
  if (!dialog) return;
  if (!dialog.querySelector<HTMLInputElement>("#mvOk")?.checked) return void toast2("Tick the check first", { kind: "warn", sub: "Verify only what matches the bank statement." });
  const result = await verifyManualPayment({ organizationId: button.dataset.org ?? "", paymentId: button.dataset.payment ?? "" });
  if ("error" in result) return failed(dialog, button, result.error, "Nothing changed.");
  done(
    dialog,
    router,
    result.selfVerified ? "Verified (your own entry)" : "Payment verified",
    result.invoiceStatus === "paid" ? "The invoice is paid." : "It counts on the invoice now.",
  );
}

export async function runManualReject(button: HTMLElement, router: Router) {
  const dialog = button.closest("dialog");
  if (!dialog) return;
  const reason = value(dialog, "mvW").trim();
  if (reason.length < 3) return void toast2("Give a short reason.", { kind: "warn", sub: "Say why it doesn’t match." });
  const result = await rejectManualPayment({ organizationId: button.dataset.org ?? "", paymentId: button.dataset.payment ?? "", reason });
  if ("error" in result) return failed(dialog, button, result.error, "Nothing changed.");
  done(dialog, router, "Payment rejected", "It stays on record and never counts.");
}

export async function runManualReverse(button: HTMLElement, router: Router) {
  const dialog = button.closest("dialog");
  if (!dialog) return;
  const wasVerified = button.dataset.verified === "1";
  const typed = { outcome: value(dialog, "mrO"), reason: value(dialog, "mrW") };
  const read = readReverse(typed, wasVerified);
  if ("error" in read) return void toast2(read.error, { kind: "warn", sub: "Nothing changed." });
  const result = await reverseManualPayment({ organizationId: button.dataset.org ?? "", paymentId: button.dataset.payment ?? "", wasVerified, ...typed });
  if ("error" in result) return failed(dialog, button, result.error, "Nothing changed.");
  done(
    dialog,
    router,
    result.status === "reversed" ? "Marked reversed" : "Marked failed",
    `${result.reopenedCents > 0 ? "The invoice shows as owing again. " : ""}A follow-up task was created for the matter’s consultant. The matter’s stage didn’t change.`,
  );
}

// ---------------------------------------------------------------------------
// Client-funds advances (#dlgPay)
// ---------------------------------------------------------------------------

/** Narrows #dlgPay's reviewers to the chosen matter: its firm owners and assigned finance users; the viewer only when no one else is. */
export function syncReviewers(dialog: ParentNode) {
  const select = dialog.querySelector<HTMLSelectElement>("select[data-reviewers]");
  if (!select) return;
  const matter = (dialog.querySelector<HTMLSelectElement>("#mpC")?.value ?? "").split(":")[0] ?? "";
  const eligible = [...select.options].filter((option) => {
    const matters = option.dataset.matters ?? "";
    return matters === "*" || (matter !== "" && matters.split(" ").includes(matter));
  });
  const others = eligible.filter((option) => option.dataset.self !== "1");
  const shown = new Set(others.length ? others : eligible);
  let first: HTMLOptionElement | null = null;
  for (const option of select.options) {
    const show = shown.has(option);
    option.hidden = !show;
    option.disabled = !show;
    if (show && !first) first = option;
  }
  if (select.selectedOptions[0]?.hidden !== false && first) select.value = first.value;
}

/**
 * #dlgPay's Record payment (the Client funds tab's submit). A refusal is returned to the caller,
 * which keeps the tab's own step-up draft; checks that fail before sending are shown here.
 */
export async function runAdvance(button: HTMLElement, router: Router): Promise<{ error: string } | null> {
  const dialog = button.closest("dialog");
  if (!dialog) return null;
  const today = button.dataset.today ?? "";
  const organizationId = button.dataset.org ?? "";
  const typed = {
    party: value(dialog, "mpC"),
    amount: value(dialog, "mpA"),
    method: value(dialog, "mpM"),
    reference: value(dialog, "mpR"),
    received: value(dialog, "mpD"),
    account: value(dialog, "mpB"),
    evidence: value(dialog, "mpE"),
    reviewer: value(dialog, "mpV"),
  };
  const read = readAdvance(typed, today, files.has("mpE"));
  if ("error" in read) {
    toast2(read.error, { kind: "warn", sub: "Nothing was recorded." });
    return null;
  }
  const uploaded = await uploadChosen("mpE", organizationId, read.input.matterId, `Advance evidence: ${read.input.reference}`.slice(0, 200));
  if ("error" in uploaded) return { error: uploaded.error };
  const result = await recordClientAdvance({ organizationId, idempotencyKey: keyFor(button, "cf"), today, evidenceVersionId: uploaded.versionId, ...typed });
  if ("error" in result) return { error: result.error };
  done(dialog, router, "Payment recorded", "Pending verification. It counts once the reviewer matches it to the bank statement.");
  return null;
}

// ---------------------------------------------------------------------------
// Reconciliation items and bank accounts
// ---------------------------------------------------------------------------

export async function runReconItem(button: HTMLElement, router: Router) {
  const dialog = button.closest("dialog");
  if (!dialog) return;
  const statement = button.dataset.statement ?? null;
  const typed = { kind: value(dialog, "riK"), description: value(dialog, "riD"), reference: value(dialog, "riR"), date: value(dialog, "riT"), amount: value(dialog, "riA") };
  const read = readReconItem(typed, statement);
  if ("error" in read) return void toast2(read.error, { kind: "warn", sub: "Nothing was added." });
  const result = await addReconciliationItem({ organizationId: button.dataset.org ?? "", reconciliationId: button.dataset.rec ?? "", statementDate: statement, ...typed });
  if ("error" in result) return failed(dialog, button, result.error, "Nothing was added.");
  done(dialog, router, read.input.kind === "deposit_in_transit" ? "Deposit in transit added" : "Outstanding cheque added", "The adjusted bank balance is updated.");
}

export async function runReconItemRemove(button: HTMLElement, router: Router) {
  const result = await removeReconciliationItem({ organizationId: button.dataset.org ?? "", itemId: button.dataset.recItemRemove ?? "" });
  if ("error" in result) return void toast2(result.error, { kind: "bad", sub: "Nothing changed." });
  toast2("Item removed", { kind: "ok", sub: "It stays on record; the adjusted bank balance is updated." });
  router.refresh();
}

export async function runBankAdd(button: HTMLElement, router: Router) {
  const dialog = button.closest("dialog");
  if (!dialog) return;
  const kind = button.dataset.bankAdd === "operating" ? "operating" : "client";
  const result = await addBankAccount({
    organizationId: button.dataset.org ?? "",
    kind,
    label: value(dialog, `${dialog.id}L`),
    institution: value(dialog, `${dialog.id}I`),
    last4: value(dialog, `${dialog.id}N`),
  });
  if ("error" in result) return failed(dialog, button, result.error, "Nothing was added.", ACCOUNTS_DIALOG);
  done(dialog, router, kind === "operating" ? "Operating account added" : "Client account added", kind === "operating" ? "Manual invoice payments can name it now." : "Record advances to it on Finance > Client funds.");
}

/** After a step-up (`?dlg=manual` or `?dlg=accounts`): reopen the same dialog, for the same payment, with what was typed. */
export function reopenManualDialog(root: ParentNode, open: Open) {
  const flag = new URLSearchParams(window.location.search).get("dlg");
  if (flag !== MANUAL_DIALOG && flag !== ACCOUNTS_DIALOG) return;
  let draft: { dialog?: unknown; fields?: unknown; payment?: unknown; key?: unknown } | null = null;
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
  const payment = typeof draft.payment === "string" ? draft.payment : "";
  if (dialog.id === "dlgMPV" || dialog.id === "dlgMPR") {
    const kind = dialog.id === "dlgMPV" ? "verify" : "reverse";
    const opener = [...root.querySelectorAll<HTMLElement>("[data-mp-open]")].find((item) => item.dataset.mpOpen === kind && item.dataset.payment === payment);
    if (!opener) return;
    openManual(opener, root, () => undefined);
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
