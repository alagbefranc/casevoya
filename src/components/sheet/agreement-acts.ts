"use client";

import { toast2 } from "@/components/port/kit";
import { approveAgreementTemplate, createAgreementTemplate, createAndSendAgreement } from "@/modules/agreements/staff-actions";
import {
  AGREEMENT_DIALOG,
  agreementStepUpLocation,
  needsStepUp,
  readNewAgreement,
  readNewTemplate,
  TEMPLATE_DIALOG,
} from "@/modules/sheet/agreements-present";

type Router = { refresh: () => void; replace: (href: string) => void };

/** What was typed survives a step-up round trip in this tab only. */
const DRAFT = "cv-agreement-draft";

function value(root: ParentNode, id: string): string {
  return root.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`#${id}`)?.value ?? "";
}

function keep(draft: Record<string, string>) {
  try {
    sessionStorage.setItem(DRAFT, JSON.stringify(draft));
  } catch {
    // Storage can be unavailable; the person types it again.
  }
}

function stepUp(dialog: string | null) {
  window.location.assign(agreementStepUpLocation(window.location.pathname, window.location.search, dialog));
}

/** A clean URL (no `?dlg=`, `?matter=`) so a refresh does not reopen the dialog. */
function settle(router: Router) {
  const params = new URLSearchParams(window.location.search);
  params.delete("dlg");
  params.delete("matter");
  const query = params.toString();
  router.replace(`${window.location.pathname}${query ? `?${query}` : ""}`);
  router.refresh();
}

/** The New agreement dialog's term fields, by id, and the template option's `data-*` default for each. */
const TERM_FIELDS = [
  { id: "nqF", key: "fee" },
  { id: "nqCur", key: "currency" },
  { id: "nqX", key: "exclusions" },
  { id: "nqR", key: "refund" },
  { id: "nqG", key: "government" },
] as const;

function agreementFields(root: ParentNode) {
  return {
    matter: value(root, "nqC"),
    template: value(root, "nqT"),
    scope: value(root, "nqS"),
    fee: value(root, "nqF"),
    currency: value(root, "nqCur"),
    exclusions: value(root, "nqX"),
    refund: value(root, "nqR"),
    government: value(root, "nqG"),
  };
}

/**
 * Fills the term fields from the chosen template's defaults. A field the person changed (its
 * value is neither empty nor what was last filled in) keeps what they typed.
 */
export function prefillAgreementTerms(root: ParentNode) {
  const template = root.querySelector<HTMLSelectElement>("#nqT");
  const option = template?.selectedOptions[0];
  if (!option) return;
  for (const { id, key } of TERM_FIELDS) {
    const field = root.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`#${id}`);
    const next = option.dataset[key];
    if (!field || next === undefined) continue;
    const untouched = field.value === "" || field.value === (field.dataset.prefilled ?? "");
    if (!untouched) continue;
    if (field instanceof HTMLSelectElement && ![...field.options].some((choice) => choice.value === next)) continue;
    field.value = next;
    field.dataset.prefilled = next;
  }
}

/** New agreement: create from the chosen approved template, then send it. The database decides. */
export async function runNewAgreement(button: HTMLElement, router: Router) {
  const dialog = button.closest("dialog");
  if (!dialog) return;
  const fields = agreementFields(dialog);
  const read = readNewAgreement(fields);
  if ("error" in read) {
    toast2(read.error, { kind: "warn", sub: "Nothing was sent." });
    return;
  }
  // The fee goes as typed; the server converts it to minor units and checks everything again.
  const result = await createAndSendAgreement({ organizationId: button.dataset.org ?? "", ...fields });
  if ("error" in result) {
    if (needsStepUp(result.error)) {
      keep({ ...fields, dialog: AGREEMENT_DIALOG });
      stepUp(AGREEMENT_DIALOG);
      return;
    }
    toast2(result.error, {
      kind: "bad",
      sub: result.draftId ? "Saved as a draft. It was not sent; try again to send it." : "Nothing was sent.",
    });
    if (result.draftId) router.refresh();
    return;
  }
  dialog.close();
  toast2("Agreement sent for signature", {
    kind: "ok",
    sub: "The applicant signs in their portal. They get an email that it is ready.",
  });
  settle(router);
}

/** New agreement template: saved as a draft for a licensed consultant to approve. */
export async function runNewTemplate(button: HTMLElement, router: Router) {
  const dialog = button.closest("dialog");
  if (!dialog) return;
  const fields = { kind: value(dialog, "tpK"), name: value(dialog, "tpN"), body: value(dialog, "tpB") };
  const read = readNewTemplate(fields);
  if ("error" in read) {
    toast2(read.error, { kind: "warn", sub: "Nothing was saved." });
    return;
  }
  const result = await createAgreementTemplate({ organizationId: button.dataset.org ?? "", ...read.input });
  if ("error" in result) {
    if (needsStepUp(result.error)) {
      keep({ ...fields, dialog: TEMPLATE_DIALOG });
      stepUp(TEMPLATE_DIALOG);
      return;
    }
    toast2(result.error, { kind: "bad", sub: "Nothing was saved." });
    return;
  }
  dialog.close();
  toast2("Template saved as a draft", { kind: "ok", sub: "A licensed consultant approves it before it can be sent." });
  settle(router);
}

export async function runApproveTemplate(button: HTMLElement, router: Router) {
  const result = await approveAgreementTemplate({ organizationId: button.dataset.org ?? "", templateId: button.dataset.approveTemplate ?? "" });
  if ("error" in result) {
    if (needsStepUp(result.error)) {
      stepUp(TEMPLATE_DIALOG);
      return;
    }
    toast2(result.error, { kind: "bad", sub: "The template is still a draft." });
    return;
  }
  button.closest("dialog")?.close();
  toast2("Template approved", { kind: "ok", sub: "It can now be used for new agreements." });
  settle(router);
}

/**
 * After a step-up (`?dlg=agreement` or `?dlg=template`), or from a matter page
 * (`?dlg=agreement&matter=…`): reopen the dialog with what was typed, or with the matter chosen.
 */
export function reopenAgreementDialogs(root: ParentNode, open: (id: string) => void) {
  const params = new URLSearchParams(window.location.search);
  const which = params.get("dlg");
  if (which !== AGREEMENT_DIALOG && which !== TEMPLATE_DIALOG) return;
  let draft: Record<string, unknown> | null = null;
  try {
    const raw = sessionStorage.getItem(DRAFT);
    sessionStorage.removeItem(DRAFT);
    draft = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
  } catch {
    draft = null;
  }
  // `blank`: an emptied field (no fee, no refund policy) comes back empty, not refilled.
  const set = (id: string, next: unknown, blank = false) => {
    const field = root.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`#${id}`);
    if (!field || typeof next !== "string" || (!next && !blank)) return;
    if (field instanceof HTMLSelectElement && ![...field.options].some((option) => option.value === next)) return;
    field.value = next;
  };
  if (which === AGREEMENT_DIALOG) {
    set("nqC", params.get("matter") ?? "");
    if (draft?.dialog === AGREEMENT_DIALOG) {
      set("nqC", draft.matter);
      set("nqT", draft.template);
      prefillAgreementTerms(root);
      set("nqS", draft.scope);
      set("nqF", draft.fee, true);
      set("nqCur", draft.currency);
      set("nqX", draft.exclusions, true);
      set("nqR", draft.refund, true);
      set("nqG", draft.government, true);
    }
    open("dlgNewQ");
    return;
  }
  if (draft?.dialog === TEMPLATE_DIALOG) {
    set("tpK", draft.kind);
    set("tpN", draft.name);
    set("tpB", draft.body);
  }
  open("dlgTpl");
}
