"use client";

import { toast2 } from "@/components/port/kit";
import { createInvoice, refundPayment } from "@/modules/finance/staff-actions";
import { formatMoney } from "@/modules/finance/money";
import {
  financeNeedsStepUp,
  financeStepUpLocation,
  INVOICE_DIALOG,
  INVOICE_DRAFT_MS,
  invoiceDialogOpening,
  readNewInvoice,
  readRefund,
  REFUND_DIALOG,
} from "@/modules/sheet/finance-present";

type Router = { refresh: () => void; replace: (href: string) => void };

/** What was typed, and the idempotency key, survive a step-up round trip in this tab only. */
const DRAFT = "cv-invoice-draft";

function value(root: ParentNode, id: string): string {
  return root.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`#${id}`)?.value ?? "";
}

function fields(root: ParentNode) {
  return { matter: value(root, "niC"), description: value(root, "niW"), amount: value(root, "niA"), currency: value(root, "niCur"), due: value(root, "niDue") };
}

/** One key per dialog opening: a double click or a retry after a network error makes one invoice. */
function keyFor(button: HTMLElement): string {
  if (!button.dataset.key) button.dataset.key = `inv-${crypto.randomUUID()}`;
  return button.dataset.key;
}

export async function runNewInvoice(button: HTMLElement, router: Router) {
  const dialog = button.closest("dialog");
  if (!dialog) return;
  const today = button.dataset.today ?? "";
  const typed = fields(dialog);
  const read = readNewInvoice(typed, today);
  if ("error" in read) {
    toast2(read.error, { kind: "warn", sub: "Nothing was issued." });
    return;
  }
  const idempotencyKey = keyFor(button);
  const result = await createInvoice({ organizationId: button.dataset.org ?? "", idempotencyKey, today, ...typed });
  if ("error" in result) {
    if (financeNeedsStepUp(result.error)) {
      try {
        sessionStorage.setItem(DRAFT, JSON.stringify({ ...typed, key: idempotencyKey, at: Date.now() }));
      } catch {
        // Storage can be unavailable; the person types it again.
      }
      window.location.assign(financeStepUpLocation(window.location.pathname, window.location.search, INVOICE_DIALOG, "invoice"));
      return;
    }
    toast2(result.error, { kind: "bad", sub: "Nothing was issued." });
    return;
  }
  delete button.dataset.key;
  dialog.close();
  toast2("Invoice issued", { kind: "ok", sub: "It is in the client’s portal. It is marked paid when Stripe confirms the payment." });
  const params = new URLSearchParams(window.location.search);
  params.delete("dlg");
  const query = params.toString();
  router.replace(`${window.location.pathname}${query ? `?${query}` : ""}`);
  router.refresh();
}

/**
 * `?dlg=invoice` opens New invoice: empty from a plain link (the home's Issue invoice), or, back
 * from a step-up, with what was typed and the same idempotency key.
 */
export function reopenInvoiceDialog(root: ParentNode, open: (id: string) => void) {
  if (new URLSearchParams(window.location.search).get("dlg") !== INVOICE_DIALOG) return;
  if (!root.querySelector("[data-new-invoice]")) return;
  let saved: Record<string, unknown> | null = null;
  try {
    const raw = sessionStorage.getItem(DRAFT);
    sessionStorage.removeItem(DRAFT);
    saved = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
  } catch {
    saved = null;
  }
  const { draft } = invoiceDialogOpening(window.location.search, saved, Date.now());
  const set = (id: string, next: unknown) => {
    const field = root.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`#${id}`);
    if (field && typeof next === "string" && next) field.value = next;
  };
  if (draft) {
    set("niC", draft.matter);
    set("niW", draft.description);
    set("niA", draft.amount);
    set("niCur", draft.currency);
    set("niDue", draft.due);
    const button = root.querySelector<HTMLElement>("[data-new-invoice]");
    if (button && typeof draft.key === "string") button.dataset.key = draft.key;
  }
  open("dlgInv");
}

/** The Refund dialog's draft (payment, amount, reason, key) survives a step-up round trip. */
const REFUND_DRAFT = "cv-refund-draft";

/** A Payments row's Refund: fills `#dlgRefund` with that payment and its refundable remainder, then opens it. */
export function openRefund(opener: HTMLElement, root: ParentNode, open: (id: string) => void) {
  const dialog = root.querySelector<HTMLDialogElement>("dialog#dlgRefund");
  const submit = dialog?.querySelector<HTMLElement>("[data-refund-submit]");
  if (!dialog || !submit) return;
  const payment = opener.dataset.refundOpen ?? "";
  const max = Number(opener.dataset.refundable ?? "0");
  if (submit.dataset.payment !== payment) delete submit.dataset.key;
  submit.dataset.payment = payment;
  submit.dataset.max = String(Number.isSafeInteger(max) ? max : 0);
  const label = dialog.querySelector<HTMLInputElement>("#rfP");
  if (label) label.value = opener.dataset.label ?? "";
  const amount = dialog.querySelector<HTMLInputElement>("#rfA");
  if (amount) amount.value = opener.dataset.amount ?? "";
  const hint = dialog.querySelector<HTMLElement>("#rfA-h");
  if (hint && Number.isSafeInteger(max) && max > 0) hint.textContent = `Up to ${formatMoney(max, "CAD")}, what is left to refund on this payment.`;
  open("dlgRefund");
}

/** One key per payment and dialog opening: a double click or a retry makes one Stripe refund. */
function refundKey(button: HTMLElement): string {
  if (!button.dataset.key) button.dataset.key = `rf-${crypto.randomUUID()}`;
  return button.dataset.key;
}

export async function runRefund(button: HTMLElement, router: Router) {
  const dialog = button.closest("dialog");
  if (!dialog) return;
  const typed = { payment: button.dataset.payment ?? "", amount: value(dialog, "rfA"), reason: value(dialog, "rfR") };
  const max = Number(button.dataset.max ?? "");
  const read = readRefund(typed, "CAD", Number.isSafeInteger(max) ? max : null);
  if ("error" in read) {
    toast2(read.error, { kind: "warn", sub: "Nothing was refunded." });
    return;
  }
  const idempotencyKey = refundKey(button);
  const result = await refundPayment({ organizationId: button.dataset.org ?? "", idempotencyKey, ...typed });
  if ("error" in result) {
    if (financeNeedsStepUp(result.error)) {
      try {
        sessionStorage.setItem(REFUND_DRAFT, JSON.stringify({ ...typed, key: idempotencyKey, at: Date.now() }));
      } catch {
        // Storage can be unavailable; the person opens the refund again.
      }
      window.location.assign(financeStepUpLocation(window.location.pathname, window.location.search, REFUND_DIALOG, "refund"));
      return;
    }
    toast2(result.error, { kind: "bad", sub: "Check the Refunds and disputes tab before trying again." });
    return;
  }
  delete button.dataset.key;
  dialog.close();
  toast2("Refund sent to Stripe", { kind: "ok", sub: "It shows as processing until Stripe confirms it." });
  const params = new URLSearchParams(window.location.search);
  params.delete("dlg");
  const query = params.toString();
  router.replace(`${window.location.pathname}${query ? `?${query}` : ""}`);
  router.refresh();
}

/** After a step-up (`?dlg=refund`): reopen Refund for the same payment, with what was typed and the same key. */
export function reopenRefundDialog(root: ParentNode, open: (id: string) => void) {
  if (new URLSearchParams(window.location.search).get("dlg") !== REFUND_DIALOG) return;
  let draft: Record<string, unknown> | null = null;
  try {
    const raw = sessionStorage.getItem(REFUND_DRAFT);
    sessionStorage.removeItem(REFUND_DRAFT);
    draft = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
  } catch {
    draft = null;
  }
  const payment = draft && typeof draft.payment === "string" ? draft.payment : null;
  // Only a fresh draft, like New invoice's: an old one left in the tab doesn't refill the dialog.
  const at = draft && typeof draft.at === "number" ? draft.at : null;
  if (!draft || !payment || at === null || Date.now() - at < 0 || Date.now() - at > INVOICE_DRAFT_MS) return;
  const opener = [...root.querySelectorAll<HTMLElement>("[data-refund-open]")].find((item) => item.dataset.refundOpen === payment);
  if (!opener) return;
  openRefund(opener, root, open);
  const amount = root.querySelector<HTMLInputElement>("#rfA");
  if (amount && typeof draft.amount === "string" && draft.amount) amount.value = draft.amount;
  const reason = root.querySelector<HTMLSelectElement>("#rfR");
  if (reason && typeof draft.reason === "string") reason.value = draft.reason;
  const submit = root.querySelector<HTMLElement>("dialog#dlgRefund [data-refund-submit]");
  if (submit && typeof draft.key === "string") submit.dataset.key = draft.key;
}
