"use client";

import { toast2 } from "@/components/port/kit";
import {
  approveAgreementTemplate,
  countersignAgreement,
  createAgreementTemplate,
  createAndSendAgreement,
  recordRepresentationAuthority,
  sendAgreementDraft,
  voidAgreementEnvelope,
} from "@/modules/agreements/staff-actions";
import {
  AGREEMENT_DIALOG,
  agreementStepUpLocation,
  AUTHORITY_DIALOG,
  COUNTERSIGN_DIALOG,
  countersignDialogId,
  countersignTarget,
  needsStepUp,
  readAuthority,
  readCountersign,
  readNewAgreement,
  readNewTemplate,
  readVoid,
  sentAgreementToast,
  TEMPLATE_DIALOG,
  VOID_DIALOG,
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

/** To the step-up screen, coming back to this page (and tab) with the dialog open again. */
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
  // Save as draft keeps it unsent (it waits under "Drafts not sent"); Create and send sends it.
  const draft = button.dataset.newAgreement === "draft";
  // The fee goes as typed; the server converts it to minor units and checks everything again.
  const result = await createAndSendAgreement({ organizationId: button.dataset.org ?? "", draft, ...fields });
  if ("error" in result) {
    if (needsStepUp(result.error)) {
      keep({ ...fields, dialog: AGREEMENT_DIALOG });
      stepUp(AGREEMENT_DIALOG);
      return;
    }
    toast2(result.error, {
      kind: "bad",
      sub: result.draftId ? "Saved as a draft. It was not sent; try again to send it." : draft ? "Nothing was saved." : "Nothing was sent.",
    });
    if (result.draftId) router.refresh();
    return;
  }
  dialog.close();
  if (draft) {
    toast2("Saved as a draft", { kind: "ok", sub: "Nobody was asked to sign. Open it from Drafts not sent to send it." });
  } else {
    const done = sentAgreementToast(result.sample);
    toast2(done.title, { kind: "ok", sub: done.sub });
  }
  settle(router);
}

/** An agreement's own view: Send for signature, for a draft saved without sending. */
export async function runAgreementSend(button: HTMLElement, router: Router) {
  const result = await sendAgreementDraft({ organizationId: button.dataset.org ?? "", agreementId: button.dataset.agreementSend ?? "" });
  if ("error" in result) {
    if (needsStepUp(result.error)) {
      stepUp(null);
      return;
    }
    toast2(result.error, { kind: "bad", sub: "Nothing was sent." });
    return;
  }
  const done = sentAgreementToast(result.sample);
  toast2(done.title, { kind: "ok", sub: done.sub });
  router.refresh();
}

/** Void envelope: the reason is required and kept with the envelope's events. */
export async function runAgreementVoid(button: HTMLElement, router: Router) {
  const dialog = button.closest("dialog");
  if (!dialog) return;
  const fields = { envelopeId: button.dataset.agreementVoid ?? "", reason: value(dialog, "voR") };
  const read = readVoid(fields);
  if ("error" in read) {
    toast2(read.error, { kind: "warn", sub: "Nothing was changed." });
    return;
  }
  const result = await voidAgreementEnvelope({ organizationId: button.dataset.org ?? "", ...read.input });
  if ("error" in result) {
    if (needsStepUp(result.error)) {
      keep({ reason: fields.reason, dialog: VOID_DIALOG });
      stepUp(VOID_DIALOG);
      return;
    }
    toast2(result.error, { kind: "bad", sub: "Nothing was changed." });
    return;
  }
  dialog.close();
  toast2("Envelope voided", { kind: "ok", sub: "Its history is kept. Send a new version when ready." });
  settle(router);
}

/** Record representation authority: saved to public.representation_authorities. The database decides. */
export async function runAuthoritySave(button: HTMLElement, router: Router) {
  const dialog = button.closest("dialog");
  if (!dialog) return;
  const fields = { client: value(dialog, "raC"), scope: value(dialog, "raS"), evidence: value(dialog, "raE"), effective: value(dialog, "raD") };
  const read = readAuthority(fields);
  if ("error" in read) {
    toast2(read.error, { kind: "warn", sub: "Nothing was saved." });
    return;
  }
  const result = await recordRepresentationAuthority({ organizationId: button.dataset.org ?? "", ...fields });
  if ("error" in result) {
    if (needsStepUp(result.error)) {
      keep({ ...fields, dialog: AUTHORITY_DIALOG });
      stepUp(AUTHORITY_DIALOG);
      return;
    }
    toast2(result.error, { kind: "bad", sub: "Nothing was saved." });
    return;
  }
  dialog.close();
  toast2("Authority recorded", { kind: "ok", sub: "It is on file for this matter. A submission can be signed off once it is in effect." });
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
 * Countersign: the consent box ticked, then the signed-in consultant signs this envelope. A
 * step-up refusal goes to /mfa?step=6 and comes back here with this envelope's dialog open.
 */
export async function runCountersign(button: HTMLElement, router: Router) {
  const dialog = button.closest("dialog");
  if (!dialog) return;
  const envelopeId = button.dataset.countersign ?? "";
  const consent = Boolean(dialog.querySelector<HTMLInputElement>('input[type="checkbox"][data-consent]')?.checked);
  const read = readCountersign({ envelopeId, consent });
  if ("error" in read) {
    toast2(read.error, { kind: "warn", sub: "Nothing was signed." });
    return;
  }
  const result = await countersignAgreement({ organizationId: button.dataset.org ?? "", envelopeId, consent });
  if ("error" in result) {
    if (needsStepUp(result.error)) {
      window.location.assign(
        agreementStepUpLocation(window.location.pathname, window.location.search, COUNTERSIGN_DIALOG, { envelope: envelopeId }),
      );
      return;
    }
    toast2(result.error, { kind: "bad", sub: "Nothing was signed." });
    return;
  }
  dialog.close();
  toast2(result.status === "completed" ? "Agreement countersigned" : "Signed for the firm", {
    kind: "ok",
    sub:
      result.status === "completed"
        ? "Everyone has signed. The sealed copy and completion certificate are stored on the matter."
        : "The next signer can sign now.",
  });
  const params = new URLSearchParams(window.location.search);
  params.delete("dlg");
  params.delete("envelope");
  const query = params.toString();
  router.replace(`${window.location.pathname}${query ? `?${query}` : ""}`);
  router.refresh();
}

/** `?dlg=countersign&envelope=…` (back from step-up, or from the "your turn" email): reopen that dialog. */
export function reopenCountersign(root: ParentNode, open: (id: string) => void) {
  const envelopeId = countersignTarget(window.location.search);
  if (!envelopeId) return;
  if (root.querySelector(`dialog#${CSS.escape(countersignDialogId(envelopeId))}`)) open(countersignDialogId(envelopeId));
}

/**
 * After a step-up (`?dlg=agreement` or `?dlg=template`), or from a matter page
 * (`?dlg=agreement&matter=…`): reopen the dialog with what was typed, or with the matter chosen.
 */
export function reopenAgreementDialogs(root: ParentNode, open: (id: string) => void) {
  const params = new URLSearchParams(window.location.search);
  const which = params.get("dlg");
  if (which !== AGREEMENT_DIALOG && which !== TEMPLATE_DIALOG && which !== AUTHORITY_DIALOG && which !== VOID_DIALOG) return;
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
  if (which === AUTHORITY_DIALOG) {
    if (!root.querySelector("dialog#dlgAuth")) return;
    if (draft?.dialog === AUTHORITY_DIALOG) {
      set("raC", draft.client);
      set("raS", draft.scope);
      set("raE", draft.evidence);
      set("raD", draft.effective);
    }
    open("dlgAuth");
    return;
  }
  if (which === VOID_DIALOG) {
    if (!root.querySelector("dialog#dlgVoid [data-agreement-void]")) return;
    if (draft?.dialog === VOID_DIALOG) set("voR", draft.reason);
    open("dlgVoid");
    return;
  }
  if (draft?.dialog === TEMPLATE_DIALOG) {
    set("tpK", draft.kind);
    set("tpN", draft.name);
    set("tpB", draft.body);
  }
  open("dlgTpl");
}
