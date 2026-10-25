"use client";

import { toast2 } from "@/components/port/kit";
import type { QuoteInstalmentInput, QuoteLineInput } from "@/components/sheet/designer/agreements-quote";
import { createQuote, editAgreementClause, quoteToAgreement, saveQuote, sendQuote } from "@/modules/agreements/quote-actions";
import { agreementStepUpLocation, needsStepUp } from "@/modules/sheet/agreements-present";
import { agreementTabHref, readClauseEdit, readNewQuote, readQuoteConvert, readQuoteEdit } from "@/modules/sheet/agreements-views-present";

type Router = { refresh: () => void; replace: (href: string) => void; push: (href: string) => void };

/** What was typed survives a step-up round trip in this tab only. */
const DRAFT = "cv-quote-draft";

/** `?dlg=` values that reopen these dialogs after a step-up. */
export const QUOTE_EDIT_DIALOG = "quote-edit";
export const QUOTE_NEW_DIALOG = "quote-new";
export const QUOTE_CONVERT_DIALOG = "quote-convert";
export const CLAUSE_DIALOG = "clause";

function value(root: ParentNode, id: string): string {
  return root.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`#${CSS.escape(id)}`)?.value ?? "";
}

function keep(draft: Record<string, unknown>) {
  try {
    sessionStorage.setItem(DRAFT, JSON.stringify(draft));
  } catch {
    // Storage can be unavailable; the person types it again.
  }
}

function stepUp(dialog: string, extra: Record<string, string> = {}) {
  window.location.assign(agreementStepUpLocation(window.location.pathname, window.location.search, dialog, extra, "quote"));
}

/** A clean URL (no `?dlg=`, `?clause=`) so a refresh does not reopen the dialog. */
function settle(router: Router) {
  const params = new URLSearchParams(window.location.search);
  params.delete("dlg");
  params.delete("clause");
  const query = params.toString();
  router.replace(`${window.location.pathname}${query ? `?${query}` : ""}`);
  router.refresh();
}

function field(row: Element, name: string): string {
  return row.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-field="${name}"]`)?.value ?? "";
}

/** The lines and instalments typed into the Edit quote dialog's tables. */
export function readQuoteTables(dialog: ParentNode): { lines: QuoteLineInput[]; instalments: QuoteInstalmentInput[] } {
  const lines = [...dialog.querySelectorAll("tr[data-quote-line]")].map((row) => ({
    category: field(row, "category"),
    description: field(row, "description"),
    amount: field(row, "amount"),
    taxRate: field(row, "taxRate"),
    sourceNote: field(row, "sourceNote"),
  }));
  const instalments = [...dialog.querySelectorAll("tr[data-quote-instalment]")].map((row) => ({
    label: field(row, "label"),
    amount: field(row, "amount"),
    paidAs: field(row, "paidAs"),
  }));
  return { lines, instalments };
}

function quoteFields(dialog: ParentNode) {
  return {
    scope: value(dialog, "qeS"),
    services: value(dialog, "qeV"),
    exclusions: value(dialog, "qeX"),
    deliverables: value(dialog, "qeD"),
    feeStructure: value(dialog, "qeF"),
    refund: value(dialog, "qeR"),
    expiry: value(dialog, "qeE"),
    government: value(dialog, "qeG"),
  };
}

/** Add a row (from the table's `<template>`) or remove one, inside the Edit quote dialog. */
export function editQuoteTable(target: HTMLElement): boolean {
  const add = target.closest<HTMLElement>("[data-quote-add]");
  if (add?.dataset.quoteAdd) {
    const table = document.getElementById(add.dataset.quoteAdd);
    const template = document.getElementById(add.dataset.quoteAdd === "qeLines" ? "qeLineRow" : "qeInstRow") as HTMLTemplateElement | null;
    const body = table?.querySelector("tbody");
    if (body && template) body.appendChild(template.content.cloneNode(true));
    return true;
  }
  const remove = target.closest<HTMLElement>("[data-quote-remove]");
  if (remove) {
    remove.closest("tr")?.remove();
    return true;
  }
  return false;
}

/** Save quote: the database totals the lines, in cents, and decides (in place, or a new version). */
export async function runQuoteSave(button: HTMLElement, router: Router) {
  const dialog = button.closest("dialog");
  if (!dialog) return;
  const fields = quoteFields(dialog);
  const tables = readQuoteTables(dialog);
  const read = readQuoteEdit(button.dataset.agreement, fields, tables.lines, tables.instalments);
  if ("error" in read) {
    toast2(read.error, { kind: "warn", sub: "Nothing was saved." });
    return;
  }
  const result = await saveQuote({ organizationId: button.dataset.org ?? "", agreementId: button.dataset.agreement ?? "", fields, ...tables });
  if ("error" in result) {
    if (needsStepUp(result.error)) {
      keep({ dialog: QUOTE_EDIT_DIALOG, fields, ...tables });
      stepUp(QUOTE_EDIT_DIALOG);
      return;
    }
    toast2(result.error, { kind: "bad", sub: "Nothing was saved." });
    return;
  }
  dialog.close();
  toast2("Quote saved", { kind: "ok", sub: "Totals are in the firm’s records. Send it when it is ready." });
  settle(router);
}

/** Send quote: locks the text with its hash; the client accepts in their portal. Nobody is emailed. */
export async function runQuoteSend(button: HTMLElement, router: Router) {
  const result = await sendQuote({ organizationId: button.dataset.org ?? "", agreementId: button.dataset.agreement ?? "" });
  if ("error" in result) {
    if (needsStepUp(result.error)) {
      stepUp("");
      return;
    }
    toast2(result.error, { kind: "bad", sub: "Nothing was sent." });
    return;
  }
  toast2("Quote sent", { kind: "ok", sub: "The client can accept it in their portal. Accepting doesn’t sign anything, and no email is sent for a quote yet." });
  router.refresh();
}

/** New quote: created on the matter, then opened in the Quote builder. */
export async function runQuoteNew(button: HTMLElement, router: Router) {
  const dialog = button.closest("dialog");
  if (!dialog) return;
  const fields = { matter: value(dialog, "nqC"), template: value(dialog, "nqT"), title: value(dialog, "nqN") };
  const read = readNewQuote(fields);
  if ("error" in read) {
    toast2(read.error, { kind: "warn", sub: "Nothing was created." });
    return;
  }
  const result = await createQuote({ organizationId: button.dataset.org ?? "", ...fields });
  if ("error" in result) {
    if (needsStepUp(result.error)) {
      keep({ dialog: QUOTE_NEW_DIALOG, ...fields });
      stepUp(QUOTE_NEW_DIALOG);
      return;
    }
    toast2(result.error, { kind: "bad", sub: "Nothing was created." });
    return;
  }
  dialog.close();
  toast2("Quote created", { kind: "ok", sub: "Add its scope, fees and instalments, then send it." });
  router.push(agreementTabHref("quote", result.agreementId));
  router.refresh();
}

/** Turn into agreement: a service-agreement draft opens in the editor. */
export async function runQuoteConvert(button: HTMLElement, router: Router) {
  const dialog = button.closest("dialog");
  if (!dialog) return;
  const fields = { agreementId: button.dataset.agreement ?? "", template: value(dialog, "qcT") };
  const read = readQuoteConvert(fields);
  if ("error" in read) {
    toast2(read.error, { kind: "warn", sub: "Nothing was created." });
    return;
  }
  const result = await quoteToAgreement({ organizationId: button.dataset.org ?? "", ...fields });
  if ("error" in result) {
    if (needsStepUp(result.error)) {
      keep({ dialog: QUOTE_CONVERT_DIALOG, template: fields.template });
      stepUp(QUOTE_CONVERT_DIALOG);
      return;
    }
    toast2(result.error, { kind: "bad", sub: "Nothing was created." });
    return;
  }
  dialog.close();
  toast2("Service agreement drafted", { kind: "ok", sub: "The quote’s scope and fees are carried over. Edit the clauses, then send it for signature." });
  router.push(agreementTabHref("editor", result.agreementId));
  router.refresh();
}

/** Save a clause: in place on an unsent draft, else a new version (an open envelope is superseded). */
export async function runClauseSave(button: HTMLElement, router: Router) {
  const dialog = button.closest("dialog");
  if (!dialog) return;
  const fields = { agreementId: button.dataset.agreement ?? "", clauseId: button.dataset.clause ?? "", body: value(dialog, `${dialog.id}B`) };
  const read = readClauseEdit(fields);
  if ("error" in read) {
    toast2(read.error, { kind: "warn", sub: "Nothing was saved." });
    return;
  }
  const result = await editAgreementClause({ organizationId: button.dataset.org ?? "", ...fields });
  if ("error" in result) {
    if (needsStepUp(result.error)) {
      keep({ dialog: CLAUSE_DIALOG, clause: dialog.id, body: fields.body });
      stepUp(CLAUSE_DIALOG, { clause: dialog.id });
      return;
    }
    toast2(result.error, { kind: "bad", sub: "Nothing was saved." });
    return;
  }
  dialog.close();
  toast2("Clause saved", { kind: "ok", sub: button.textContent?.includes("new version") ? "A new draft version was made. Send it again for signature." : "The draft’s wording changed in place." });
  settle(router);
}

/** After a step-up (`?dlg=quote-edit|quote-new|quote-convert|clause&clause=…`): reopen the dialog with what was typed. */
export function reopenQuoteDialogs(root: ParentNode, open: (id: string) => void) {
  const params = new URLSearchParams(window.location.search);
  const which = params.get("dlg");
  if (which !== QUOTE_EDIT_DIALOG && which !== QUOTE_NEW_DIALOG && which !== QUOTE_CONVERT_DIALOG && which !== CLAUSE_DIALOG) return;
  let draft: Record<string, unknown> | null = null;
  try {
    const raw = sessionStorage.getItem(DRAFT);
    sessionStorage.removeItem(DRAFT);
    draft = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
  } catch {
    draft = null;
  }
  const set = (id: string, next: unknown) => {
    const element = root.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`#${CSS.escape(id)}`);
    if (!element || typeof next !== "string") return;
    if (element instanceof HTMLSelectElement && ![...element.options].some((option) => option.value === next)) return;
    element.value = next;
  };
  if (which === QUOTE_NEW_DIALOG) {
    if (!root.querySelector("dialog#dlgNewQ [data-agreement-act]")) return;
    if (draft?.dialog === QUOTE_NEW_DIALOG) {
      set("nqC", draft.matter);
      set("nqT", draft.template);
      set("nqN", draft.title);
    }
    open("dlgNewQ");
    return;
  }
  if (which === QUOTE_CONVERT_DIALOG) {
    if (!root.querySelector("dialog#dlgQConv")) return;
    if (draft?.dialog === QUOTE_CONVERT_DIALOG) set("qcT", draft.template);
    open("dlgQConv");
    return;
  }
  if (which === CLAUSE_DIALOG) {
    const id = params.get("clause") ?? "";
    if (!id || !root.querySelector(`dialog#${CSS.escape(id)}`)) return;
    if (draft?.dialog === CLAUSE_DIALOG && draft.clause === id) set(`${id}B`, draft.body);
    open(id);
    return;
  }
  const dialog = root.querySelector<HTMLDialogElement>("dialog#dlgQEdit");
  if (!dialog) return;
  if (draft?.dialog === QUOTE_EDIT_DIALOG) {
    const fields = (draft.fields ?? {}) as Record<string, unknown>;
    set("qeS", fields.scope);
    set("qeV", fields.services);
    set("qeX", fields.exclusions);
    set("qeD", fields.deliverables);
    set("qeF", fields.feeStructure);
    set("qeR", fields.refund);
    set("qeE", fields.expiry);
    set("qeG", fields.government);
    restoreRows(dialog, "qeLines", "qeLineRow", "tr[data-quote-line]", Array.isArray(draft.lines) ? (draft.lines as Record<string, string>[]) : []);
    restoreRows(dialog, "qeInst", "qeInstRow", "tr[data-quote-instalment]", Array.isArray(draft.instalments) ? (draft.instalments as Record<string, string>[]) : []);
  }
  open("dlgQEdit");
}

function restoreRows(dialog: ParentNode, tableId: string, templateId: string, selector: string, rows: Record<string, string>[]) {
  const body = dialog.querySelector(`#${tableId} tbody`);
  const template = dialog.querySelector<HTMLTemplateElement>(`#${templateId}`);
  if (!body || !template) return;
  for (const row of [...body.querySelectorAll(selector)]) row.remove();
  for (const values of rows) {
    body.appendChild(template.content.cloneNode(true));
    const row = body.querySelector(`${selector}:last-of-type`);
    if (!row) continue;
    for (const [name, next] of Object.entries(values)) {
      const element = row.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-field="${name}"]`);
      if (element && typeof next === "string") element.value = next;
    }
  }
}
