"use client";

import { toast2 } from "@/components/port/kit";
import { moveClientCredit } from "@/modules/finance/staff-actions";
import { formatMoney } from "@/modules/finance/money";
import { CREDIT_DIALOG, EVIDENCE_DIALOG } from "@/modules/finance/credits-present";
import { financeNeedsStepUp, financeStepUpLocation, INVOICE_DRAFT_MS } from "@/modules/sheet/finance-present";

/**
 * The Refunds and disputes tab's live dialogs (FIN-13): a client credit's Refund or apply
 * (`#dlgCredit`) and Add evidence for a dispute (`#dlgEvidence`). The server and the database
 * decide; these only fill the dialogs, send them and survive a step-up round trip.
 */

type Router = { refresh: () => void; replace: (href: string) => void };

const CREDIT_DRAFT = "cv-credit-draft";

function field<T extends HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(root: ParentNode, id: string): T | null {
  return root.querySelector<T>(`#${id}`);
}

function value(root: ParentNode, id: string): string {
  return field(root, id)?.value ?? "";
}

/** Shows only the fields the chosen action needs; a bank refund is offered only when no card refund is pending. */
export function syncCreditMode(dialog: ParentNode) {
  const mode = value(dialog, "crM") || "apply";
  for (const group of dialog.querySelectorAll<HTMLElement>("[data-credit-for]")) group.hidden = group.dataset.creditFor !== mode;
}

type Target = { value: string; label: string; dueCents: number };

function targetsOf(opener: HTMLElement): Target[] {
  try {
    const parsed = JSON.parse(opener.dataset.targets ?? "[]") as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is Target => Boolean(item) && typeof item.value === "string" && typeof item.label === "string" && typeof item.dueCents === "number")
      : [];
  } catch {
    return [];
  }
}

/** A credit row's Refund or apply: fills `#dlgCredit` with that credit, its targets and what is left, then opens it. */
export function openCredit(opener: HTMLElement, root: ParentNode, open: (id: string) => void) {
  const dialog = root.querySelector<HTMLDialogElement>("dialog#dlgCredit");
  const submit = dialog?.querySelector<HTMLElement>("[data-credit-submit]");
  if (!dialog || !submit) return;
  const credit = opener.dataset.creditOpen ?? "";
  const max = Number(opener.dataset.available ?? "0");
  if (submit.dataset.credit !== credit) delete submit.dataset.key;
  submit.dataset.credit = credit;
  submit.dataset.max = String(Number.isSafeInteger(max) ? max : 0);
  const label = field<HTMLInputElement>(dialog, "crC");
  if (label) label.value = opener.dataset.label ?? "";
  const amount = field<HTMLInputElement>(dialog, "crA");
  if (amount) amount.value = opener.dataset.amount ?? "";
  const hint = dialog.querySelector<HTMLElement>("#crA-h");
  if (hint && Number.isSafeInteger(max) && max > 0) hint.textContent = `Up to ${formatMoney(max, "CAD")}, what is left on this credit.`;
  const targets = targetsOf(opener);
  const select = field<HTMLSelectElement>(dialog, "crT");
  if (select) {
    select.replaceChildren(
      ...(targets.length
        ? targets.map((target) => {
            const option = document.createElement("option");
            option.value = target.value;
            option.textContent = target.label;
            return option;
          })
        : [Object.assign(document.createElement("option"), { value: "", textContent: "No open invoice of this client" })]),
    );
  }
  const mode = field<HTMLSelectElement>(dialog, "crM");
  if (mode) {
    for (const option of mode.options) {
      if (option.value === "card") option.disabled = opener.dataset.card !== "1";
      if (option.value === "bank") option.disabled = opener.dataset.pendingCard === "1";
      if (option.value === "apply") option.disabled = targets.length === 0;
    }
    const first = [...mode.options].find((option) => !option.disabled);
    mode.value = first?.value ?? "apply";
  }
  syncCreditMode(dialog);
  open("dlgCredit");
}

function creditKey(button: HTMLElement): string {
  if (!button.dataset.key) button.dataset.key = `cc-${crypto.randomUUID()}`;
  return button.dataset.key;
}

function dropDialogParam(router: Router) {
  const params = new URLSearchParams(window.location.search);
  params.delete("dlg");
  const query = params.toString();
  router.replace(`${window.location.pathname}${query ? `?${query}` : ""}`);
  router.refresh();
}

export async function runCredit(button: HTMLElement, router: Router) {
  const dialog = button.closest("dialog");
  if (!dialog) return;
  const typed = {
    credit: button.dataset.credit ?? "",
    mode: value(dialog, "crM"),
    amount: value(dialog, "crA"),
    target: value(dialog, "crT"),
    method: value(dialog, "crB"),
    reference: value(dialog, "crR"),
    refundedOn: value(dialog, "crD"),
  };
  const max = Number(button.dataset.max ?? "");
  const today = field<HTMLInputElement>(dialog, "crD")?.max ?? "";
  const idempotencyKey = creditKey(button);
  const result = await moveClientCredit({ organizationId: button.dataset.org ?? "", idempotencyKey, today, maxCents: Number.isSafeInteger(max) ? max : null, ...typed });
  if ("error" in result) {
    if (financeNeedsStepUp(result.error)) {
      try {
        sessionStorage.setItem(CREDIT_DRAFT, JSON.stringify({ ...typed, key: idempotencyKey, at: Date.now() }));
      } catch {
        // Storage can be unavailable; the person opens the credit again.
      }
      window.location.assign(financeStepUpLocation(window.location.pathname, window.location.search, CREDIT_DIALOG));
      return;
    }
    toast2(result.error, { kind: "bad", sub: "Nothing was moved." });
    return;
  }
  delete button.dataset.key;
  dialog.close();
  toast2(
    result.mode === "apply" ? "Credit applied" : result.mode === "card" ? "Refund sent to Stripe" : "Bank refund recorded",
    {
      kind: "ok",
      sub:
        result.mode === "apply"
          ? "Both invoices show the link."
          : result.mode === "card"
            ? "It shows as processing until Stripe confirms it."
            : "The credit shows where the money went.",
    },
  );
  dropDialogParam(router);
}

/** After a step-up (`?dlg=credit`): reopen the same credit with what was typed and the same key. */
export function reopenCreditDialog(root: ParentNode, open: (id: string) => void) {
  if (new URLSearchParams(window.location.search).get("dlg") !== CREDIT_DIALOG) return;
  let draft: Record<string, unknown> | null = null;
  try {
    const raw = sessionStorage.getItem(CREDIT_DRAFT);
    sessionStorage.removeItem(CREDIT_DRAFT);
    draft = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
  } catch {
    draft = null;
  }
  const at = draft && typeof draft.at === "number" ? draft.at : null;
  const credit = draft && typeof draft.credit === "string" ? draft.credit : null;
  if (!draft || !credit || at === null || Date.now() - at < 0 || Date.now() - at > INVOICE_DRAFT_MS) return;
  const opener = [...root.querySelectorAll<HTMLElement>("[data-credit-open]")].find((item) => item.dataset.creditOpen === credit);
  if (!opener) return;
  openCredit(opener, root, open);
  const set = (id: string, next: unknown) => {
    const input = field(root, id);
    if (input && typeof next === "string" && next) input.value = next;
  };
  set("crM", draft.mode);
  set("crA", draft.amount);
  set("crT", draft.target);
  set("crB", draft.method);
  set("crR", draft.reference);
  set("crD", draft.refundedOn);
  const dialog = root.querySelector<HTMLDialogElement>("dialog#dlgCredit");
  if (dialog) syncCreditMode(dialog);
  const submit = root.querySelector<HTMLElement>("dialog#dlgCredit [data-credit-submit]");
  if (submit && typeof draft.key === "string") submit.dataset.key = draft.key;
}

/** Add evidence: posts the file and explanation; Stripe gets them through the firm's account. */
export async function runEvidence(button: HTMLElement, router: Router) {
  const dialog = button.closest("dialog");
  if (!dialog) return;
  const dispute = value(dialog, "evD");
  const file = field<HTMLInputElement>(dialog, "evF")?.files?.[0] ?? null;
  if (!dispute) {
    toast2("Choose the dispute.", { kind: "warn", sub: "Nothing was sent." });
    return;
  }
  if (!file) {
    toast2("Choose a file.", { kind: "warn", sub: "Nothing was sent." });
    return;
  }
  const form = new FormData();
  form.set("org", button.dataset.org ?? "");
  form.set("dispute", dispute);
  form.set("explanation", value(dialog, "evT"));
  form.set("file", file);
  let result: { ok?: boolean; error?: string };
  try {
    const response = await fetch("/api/stripe/dispute-evidence", { method: "POST", body: form, credentials: "same-origin" });
    result = (await response.json().catch(() => ({ error: "Stripe didn’t answer. Nothing was submitted; try again." }))) as { ok?: boolean; error?: string };
  } catch {
    result = { error: "The connection dropped. Nothing was submitted; try again." };
  }
  if (!result.ok) {
    const error = result.error ?? "Nothing was submitted; try again.";
    if (financeNeedsStepUp(error)) {
      window.location.assign(financeStepUpLocation(window.location.pathname, window.location.search, EVIDENCE_DIALOG));
      return;
    }
    toast2(error, { kind: "bad", sub: "Check the dispute before trying again." });
    return;
  }
  dialog.close();
  toast2("Evidence submitted to Stripe", { kind: "ok", sub: "Stripe sends it to the client’s bank. The dispute’s state updates when Stripe reports back." });
  dropDialogParam(router);
}

/** After a step-up (`?dlg=evidence`): reopen Add evidence (the file is chosen again; browsers don't keep it). */
export function reopenEvidenceDialog(root: ParentNode, open: (id: string) => void) {
  if (new URLSearchParams(window.location.search).get("dlg") !== EVIDENCE_DIALOG) return;
  if (!root.querySelector("dialog#dlgEvidence")) return;
  open("dlgEvidence");
}
