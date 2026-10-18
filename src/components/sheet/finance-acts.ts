"use client";

import { toast2 } from "@/components/port/kit";
import { createInvoice } from "@/modules/finance/staff-actions";
import { financeNeedsStepUp, financeStepUpLocation, INVOICE_DIALOG, readNewInvoice } from "@/modules/sheet/finance-present";

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
        sessionStorage.setItem(DRAFT, JSON.stringify({ ...typed, key: idempotencyKey }));
      } catch {
        // Storage can be unavailable; the person types it again.
      }
      window.location.assign(financeStepUpLocation(window.location.pathname, window.location.search, INVOICE_DIALOG));
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

/** After a step-up (`?dlg=invoice`): reopen New invoice with what was typed. */
export function reopenInvoiceDialog(root: ParentNode, open: (id: string) => void) {
  if (new URLSearchParams(window.location.search).get("dlg") !== INVOICE_DIALOG) return;
  if (!root.querySelector("[data-new-invoice]")) return;
  let draft: Record<string, unknown> | null = null;
  try {
    const raw = sessionStorage.getItem(DRAFT);
    sessionStorage.removeItem(DRAFT);
    draft = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
  } catch {
    draft = null;
  }
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
