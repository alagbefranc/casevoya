"use client";

import { toast2 } from "@/components/port/kit";
import { recordPersonIdentity, resolvePersonFlag } from "@/modules/sheet/person-history-actions";

type Router = { refresh: () => void };

const KIND_WORD: Record<string, string> = { name: "Name", passport: "Passport", address: "Address" };

/** The `name`d fields of the Add form the button sits in: text and dates as strings, the checkbox as a boolean. */
function formData(scope: ParentNode): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  scope.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("[name]").forEach((node) => {
    if (node instanceof HTMLInputElement && node.type === "checkbox") data[node.name] = node.checked;
    else if (node.value.trim()) data[node.name] = node.value.trim();
  });
  return data;
}

/** Add a name, passport or address (`data-ph-add`): public.record_person_identity checks the fields. */
export async function runPersonAdd(button: HTMLElement, router: Router) {
  const form = button.closest("details");
  if (!form) return;
  const kind = button.dataset.phAdd ?? "";
  const result = await recordPersonIdentity({ organizationId: button.dataset.org ?? "", personId: button.dataset.person ?? "", kind, data: formData(form) });
  if ("error" in result) {
    toast2(result.error, { kind: "bad", sub: "Nothing was saved." });
    return;
  }
  form.open = false;
  toast2(`${KIND_WORD[kind] ?? "Entry"} added`, { kind: "ok", sub: "It’s on their record. Changes are kept as history." });
  router.refresh();
}

/** Remove (`data-ph-remove`): a new row marks the entry removed; the entry itself stays on record. */
export async function runPersonRemove(button: HTMLElement, router: Router) {
  const kind = button.dataset.kind ?? "";
  const result = await recordPersonIdentity({ organizationId: button.dataset.org ?? "", personId: button.dataset.person ?? "", kind, data: {}, replacesId: button.dataset.phRemove ?? "", retire: true });
  if ("error" in result) {
    toast2(result.error, { kind: "bad", sub: "Nothing was removed." });
    return;
  }
  toast2(`${KIND_WORD[kind] ?? "Entry"} removed`, { kind: "ok", sub: "It no longer counts, and stays on record as history." });
  router.refresh();
}

/** Resolve a flag (`data-ph-resolve`) with the note typed above the button. */
export async function runFlagResolve(button: HTMLElement, router: Router) {
  const form = button.closest("details");
  const note = form?.querySelector<HTMLTextAreaElement>("textarea[name=note]")?.value ?? "";
  const result = await resolvePersonFlag({ organizationId: button.dataset.org ?? "", personId: button.dataset.person ?? "", flagKey: button.dataset.phResolve ?? "", detail: button.dataset.detail ?? "", note });
  if ("error" in result) {
    toast2(result.error, { kind: "bad", sub: "The flag is still open." });
    return;
  }
  toast2("Flag resolved", { kind: "ok", sub: "Your note is kept with it and in the audit log." });
  router.refresh();
}
