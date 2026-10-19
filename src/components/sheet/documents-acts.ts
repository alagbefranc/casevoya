"use client";

import { toast2 } from "@/components/port/kit";
import { authorizeDocumentDownload, reviewDocumentVersion, setDocumentExpiry } from "@/modules/documents/actions";
import { needsStepUp } from "@/modules/sheet/matter-wire";
import { readDocumentReview, reviewStepUpLocation } from "@/modules/sheet/documents-review";

type Router = { replace: (href: string) => void; refresh: () => void };

const DIALOG = "dlgDocRev";
const DRAFT = "casevoya.docReview";

function text(root: ParentNode, id: string, value: string) {
  const node = root.querySelector<HTMLElement>(`#${id}`);
  if (node) node.textContent = value;
}

function input(root: ParentNode, id: string) {
  return root.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`#${id}`);
}

/** A To review row's link: fills the review dialog for that version and opens it. */
export function openDocReview(link: HTMLElement, root: HTMLElement, openDialog: (id: string) => void) {
  const dialog = root.querySelector<HTMLDialogElement>(`#${DIALOG}`);
  if (!dialog) return;
  const data = link.dataset;
  dialog.dataset.doc = data.docReview ?? "";
  dialog.dataset.version = data.version ?? "";
  dialog.dataset.expires = data.expires ?? "";
  text(dialog, "drTitle", data.title ?? "");
  text(dialog, "drMeta", data.meta ?? "");
  const prev = dialog.querySelector<HTMLElement>("#drPrev");
  if (prev) prev.hidden = !data.prev;
  text(dialog, "drPrevReason", data.prev ?? "");
  const decision = input(dialog, "drD");
  if (decision) decision.value = "accepted";
  const reason = input(dialog, "drR");
  if (reason) reason.value = "";
  const expires = input(dialog, "drE");
  if (expires) expires.value = data.expires ?? "";
  openDialog(DIALOG);
}

/** Back from step-up (`?dlg=review&doc=`): reopen the same version with what was typed. */
export function reopenDocReview(root: HTMLElement, openDialog: (id: string) => void) {
  const params = new URLSearchParams(window.location.search);
  if (params.get("dlg") !== "review") return;
  const doc = params.get("doc");
  const link = [...root.querySelectorAll<HTMLElement>("[data-doc-review]")].find((item) => item.dataset.docReview === doc);
  if (!link) return;
  openDocReview(link, root, openDialog);
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(DRAFT) ?? "null") as { doc?: string; decision?: string; reason?: string; expires?: string } | null;
    if (saved?.doc === doc) {
      const dialog = root.querySelector<HTMLDialogElement>(`#${DIALOG}`);
      if (dialog) {
        const decision = input(dialog, "drD");
        if (decision && saved.decision) decision.value = saved.decision;
        const reason = input(dialog, "drR");
        if (reason) reason.value = saved.reason ?? "";
        const expires = input(dialog, "drE");
        if (expires && saved.expires !== undefined) expires.value = saved.expires;
      }
    }
    window.sessionStorage.removeItem(DRAFT);
  } catch {
    // A draft is a convenience; the dialog works without it.
  }
}

function keepDraft(doc: string, fields: { decision: string; reason: string; expires: string }) {
  try {
    window.sessionStorage.setItem(DRAFT, JSON.stringify({ doc, ...fields }));
  } catch {
    // Without storage the person types the reason again.
  }
}

/** Save review: the decision with its reason, then a new expiry date if one was changed. */
export async function runDocReview(button: HTMLElement, router: Router) {
  const dialog = button.closest("dialog");
  if (!dialog) return;
  const organizationId = button.dataset.org ?? "";
  const fields = {
    decision: input(dialog, "drD")?.value ?? "",
    reason: input(dialog, "drR")?.value ?? "",
    expires: input(dialog, "drE")?.value ?? "",
  };
  const read = readDocumentReview({ versionId: dialog.dataset.doc, version: dialog.dataset.version, ...fields, previousExpires: dialog.dataset.expires });
  if ("error" in read) {
    toast2(read.error, { kind: "warn", sub: "Nothing was saved." });
    return;
  }
  const reviewed = await reviewDocumentVersion({
    organizationId,
    versionId: read.input.versionId,
    expectedVersion: read.input.expectedVersion,
    decision: read.input.decision,
    reason: read.input.reason,
    code: "",
  });
  if ("error" in reviewed) {
    if (needsStepUp(reviewed.error)) {
      keepDraft(read.input.versionId, fields);
      window.location.assign(reviewStepUpLocation(window.location.pathname, window.location.search, read.input.versionId));
      return;
    }
    toast2(reviewed.error ?? "That action could not be completed.", { kind: "bad", sub: "Nothing was saved." });
    return;
  }
  let expiryNote = "";
  if (read.input.expiry !== undefined && typeof reviewed.version === "number") {
    const expiry = await setDocumentExpiry({ organizationId, versionId: read.input.versionId, expectedVersion: reviewed.version, expiresOn: read.input.expiry, code: "" });
    if ("error" in expiry) expiryNote = ` The expiry date wasn’t saved: ${expiry.error}`;
  }
  dialog.close();
  const accepted = read.input.decision === "accepted";
  toast2(accepted ? "Document accepted" : "New version requested", {
    kind: expiryNote ? "warn" : "ok",
    sub: `${accepted ? "Accepted for its purpose, not validated by the government." : "The client sees your reason and can upload a replacement."}${expiryNote}`,
  });
  const params = new URLSearchParams(window.location.search);
  params.delete("dlg");
  params.delete("doc");
  const query = params.toString();
  router.replace(`${window.location.pathname}${query ? `?${query}` : ""}`);
  router.refresh();
}

/** All documents: an accepted card opens its file, by a short-lived link after a fresh access check. */
export async function runDocOpen(card: HTMLElement) {
  const result = await authorizeDocumentDownload({ organizationId: card.dataset.org ?? "", versionId: card.dataset.docOpen ?? "" });
  if ("error" in result) {
    if (needsStepUp(result.error)) {
      window.location.assign(`/mfa?step=6&next=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}`);
      return;
    }
    toast2(result.error ?? "That file cannot be opened.", { kind: "bad" });
    return;
  }
  window.open(result.url, "_blank", "noopener,noreferrer");
}

/** Open file: a short-lived link after a fresh access check. */
export async function runDocFile(button: HTMLElement) {
  const dialog = button.closest("dialog");
  const versionId = dialog?.dataset.doc ?? "";
  const result = await authorizeDocumentDownload({ organizationId: button.dataset.org ?? "", versionId });
  if ("error" in result) {
    if (needsStepUp(result.error)) {
      window.location.assign(reviewStepUpLocation(window.location.pathname, window.location.search, versionId));
      return;
    }
    toast2(result.error ?? "That file cannot be opened.", { kind: "bad" });
    return;
  }
  window.open(result.url, "_blank", "noopener,noreferrer");
}
