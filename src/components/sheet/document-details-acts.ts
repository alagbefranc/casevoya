"use client";

import { toast2 } from "@/components/port/kit";
import { DOC_DETAILS_DIALOG } from "@/components/sheet/designer/documents";
import { linkDocumentMatter, setDocumentClassification, setDocumentExpiry, setDocumentTranslation, unlinkDocumentMatter } from "@/modules/documents/actions";
import { languageLabel, type DocumentDetails } from "@/modules/sheet/documents-present";

type Router = { refresh: () => void };

function dialog(): HTMLDialogElement | null {
  return document.getElementById(DOC_DETAILS_DIALOG) as HTMLDialogElement | null;
}

function field<T extends HTMLElement = HTMLInputElement>(id: string): T | null {
  return dialog()?.querySelector<T>(`#${id}`) ?? null;
}

function options(select: HTMLSelectElement | null, items: { value: string; label: string }[], selected: string) {
  if (!select) return;
  select.replaceChildren(
    ...items.map((item) => {
      const option = document.createElement("option");
      option.value = item.value;
      option.textContent = item.label;
      option.selected = item.value === selected;
      return option;
    }),
  );
}

/** The document the dialog was opened for. */
function current(): DocumentDetails | null {
  try {
    const raw = dialog()?.dataset.current;
    return raw ? (JSON.parse(raw) as DocumentDetails) : null;
  } catch {
    return null;
  }
}

/** Details on an All documents card (DOC-06): fills the Document details dialog from the card's facts and opens it. */
export function openDocumentDetails(button: HTMLElement) {
  const box = dialog();
  const raw = button.dataset.docDetails;
  if (!box || !raw) return;
  let data: DocumentDetails;
  try {
    data = JSON.parse(raw) as DocumentDetails;
  } catch {
    return;
  }
  box.dataset.current = raw;
  const who = field<HTMLElement>("ddWho");
  if (who) who.textContent = `${data.title} · ${data.person}`;

  const refs = field<HTMLUListElement>("ddRefs");
  refs?.replaceChildren(
    ...(data.refs.length
      ? data.refs.map((ref) => {
          const item = document.createElement("li");
          const name = document.createElement("span");
          name.textContent = ref.label;
          const remove = document.createElement("button");
          remove.type = "button";
          remove.className = "btn s sm";
          remove.textContent = "Remove from this matter";
          remove.dataset.ddUnlink = ref.id;
          item.append(name, remove);
          return item;
        })
      : [Object.assign(document.createElement("li"), { textContent: "No matter uses it now. The file stays on the person’s record." })]),
  );
  const use = field<HTMLSelectElement>("ddUse");
  options(use, data.candidates.map((matter) => ({ value: matter.id, label: matter.label })), "");
  if (use) use.disabled = data.candidates.length === 0;
  const note = field<HTMLElement>("ddUseNote");
  if (note) note.textContent = data.linkNote ?? "It isn’t copied: every matter uses the same file, and access is checked for each.";
  const link = box.querySelector<HTMLButtonElement>("[data-dd-link]");
  if (link) link.disabled = data.candidates.length === 0;

  options(field<HTMLSelectElement>("ddOrig"), [{ value: "", label: "Not a translation" }, ...data.originals.map((item) => ({ value: item.versionId, label: item.label }))], data.translationOf ?? "");
  const lang = field<HTMLSelectElement>("ddLang");
  if (lang) lang.value = data.languageTag?.slice(0, 2) === "fr" ? "fr" : "en";
  const tr = field<HTMLElement>("ddTr");
  if (tr) {
    const original = data.originals.find((item) => item.versionId === data.translationOf)?.label;
    const parts = [
      data.translationOf ? `This is the ${languageLabel(data.languageTag)} translation of ${original ?? "another document"}.` : "",
      data.translations.length ? `Translations of this document: ${data.translations.join(", ")}.` : "",
    ].filter(Boolean);
    tr.textContent = parts.join(" ") || "Not marked as a translation, and nothing translates it.";
  }
  const purpose = field("ddPurpose");
  if (purpose) purpose.value = data.purpose;
  const sens = field<HTMLSelectElement>("ddSens");
  if (sens) sens.value = data.sensitivity;
  const exp = field("ddExp");
  if (exp) exp.value = data.expiresOn ?? "";
  const code = field("ddCode");
  if (code) code.value = "";
  const why = field("ddWhy");
  if (why) why.value = "";
  box.showModal();
}

function done(title: string, sub: string, router: Router) {
  dialog()?.close();
  toast2(title, { kind: "ok", sub });
  router.refresh();
}

/** Use in this matter. */
export async function runDocumentLink(router: Router) {
  const data = current();
  const matterId = field<HTMLSelectElement>("ddUse")?.value ?? "";
  if (!data || !matterId) return;
  const result = await linkDocumentMatter({ organizationId: data.organizationId, documentId: data.documentId, matterId });
  if ("error" in result) {
    toast2(result.error ?? "Nothing changed.", { kind: "bad", sub: "Nothing changed." });
    return;
  }
  done("Used in another matter", "The same file, not a copy. Access is checked on each matter.", router);
}

/** Remove from this matter: needs a reason and the six-digit code; the file is never deleted. */
export async function runDocumentUnlink(button: HTMLElement, router: Router) {
  const data = current();
  if (!data) return;
  const reason = field("ddWhy")?.value.trim() ?? "";
  const code = field("ddCode")?.value.trim() ?? "";
  if (reason.length < 3) {
    toast2("Say why it’s removed from this matter.", { kind: "bad", sub: "Nothing changed." });
    field("ddWhy")?.focus();
    return;
  }
  if (!/^\d{6}$/.test(code)) {
    toast2("Enter the six-digit code from your authenticator app.", { kind: "bad", sub: "Nothing changed." });
    field("ddCode")?.focus();
    return;
  }
  const result = await unlinkDocumentMatter({ organizationId: data.organizationId, refId: button.dataset.ddUnlink ?? "", reason, code });
  if ("error" in result) {
    toast2(result.error ?? "Nothing changed.", { kind: "bad", sub: "Nothing changed." });
    return;
  }
  const others = data.refs.length - 1;
  done("Removed from the matter", others > 0 ? `Still used on ${others} other matter${others === 1 ? "" : "s"}, so the file is kept.` : "No matter uses it now. The file stays on the person’s record.", router);
}

/** Save translation (or clear it). */
export async function runDocumentTranslation(router: Router) {
  const data = current();
  if (!data) return;
  const original = field<HTMLSelectElement>("ddOrig")?.value || null;
  const languageTag = original ? (field<HTMLSelectElement>("ddLang")?.value ?? null) : null;
  const result = await setDocumentTranslation({ organizationId: data.organizationId, versionId: data.versionId, expectedVersion: data.versionRow, originalVersionId: original, languageTag });
  if ("error" in result) {
    toast2(result.error ?? "Nothing changed.", { kind: "bad", sub: "Nothing changed." });
    return;
  }
  done(original ? "Marked as a translation" : "No longer marked as a translation", "Both documents show the link.", router);
}

/** Save details: type and sensitivity, then expiry when it changed. */
export async function runDocumentClassify(router: Router) {
  const data = current();
  if (!data) return;
  const purpose = field("ddPurpose")?.value.trim() ?? "";
  const sensitivity = field<HTMLSelectElement>("ddSens")?.value ?? data.sensitivity;
  const expiresOn = field("ddExp")?.value || null;
  const code = field("ddCode")?.value.trim() ?? "";
  const needsCode = sensitivity !== data.sensitivity || expiresOn !== data.expiresOn;
  if (needsCode && !/^\d{6}$/.test(code)) {
    toast2("Enter the six-digit code from your authenticator app.", { kind: "bad", sub: "A change of sensitivity or expiry needs it." });
    field("ddCode")?.focus();
    return;
  }
  if (purpose !== data.purpose || sensitivity !== data.sensitivity) {
    const result = await setDocumentClassification({ organizationId: data.organizationId, documentId: data.documentId, expectedVersion: data.documentVersion, purpose, sensitivity, code });
    if ("error" in result) {
      toast2(result.error ?? "Nothing changed.", { kind: "bad", sub: "Nothing changed." });
      return;
    }
  }
  if (expiresOn !== data.expiresOn) {
    const result = await setDocumentExpiry({ organizationId: data.organizationId, versionId: data.versionId, expectedVersion: data.versionRow, expiresOn, code: purpose !== data.purpose || sensitivity !== data.sensitivity ? "" : code });
    if ("error" in result) {
      toast2(result.error ?? "The expiry didn’t change.", { kind: "bad", sub: "The expiry didn’t change." });
      router.refresh();
      return;
    }
  }
  done("Details saved", "The change is in the audit log.", router);
}
