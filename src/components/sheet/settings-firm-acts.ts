"use client";

import { toast2 } from "@/components/port/kit";
import { removeFirmOffice, saveFirmBranding, saveFirmDetails, saveFirmOffice, saveTimezones, type FirmSettingsResult } from "@/modules/settings/firm-actions";
import { withoutDialog } from "@/modules/sheet/matter-wire";

type Router = { refresh: () => void; replace: (href: string) => void };
type Open = (id: string) => void;

/** What was typed survives a step-up round trip in this tab only. */
const DRAFT = "cv-firm-settings";

/** Every named field in the dialog: text values, and checkboxes as true/false. */
function fieldsOf(dialog: ParentNode): Record<string, string | boolean> {
  const fields: Record<string, string | boolean> = {};
  dialog.querySelectorAll<HTMLInputElement>("input[name]").forEach((input) => {
    if (input.type === "file") return;
    fields[input.name] = input.type === "checkbox" ? input.checked : input.value;
  });
  return fields;
}

function stepUp(dialogId: string, fields: Record<string, string | boolean>) {
  try {
    sessionStorage.setItem(DRAFT, JSON.stringify({ dialog: dialogId, fields }));
  } catch {
    // Storage can be unavailable; the person types it again.
  }
  const params = new URLSearchParams(window.location.search);
  params.set("dlg", dialogId);
  const next = `${window.location.pathname}?${params.toString()}`;
  toast2("Confirm it’s you", { kind: "warn", sub: "Then the dialog opens again with what you typed." });
  window.setTimeout(() => window.location.assign(`/mfa?step=6&next=${encodeURIComponent(next)}`), 900);
}

function finish(result: FirmSettingsResult, dialog: HTMLDialogElement, fields: Record<string, string | boolean>, done: { title: string; sub: string }, router: Router): void {
  if ("error" in result) {
    if (result.stepUp) stepUp(dialog.id, fields);
    else toast2(result.error, { kind: "bad", sub: "Nothing was changed." });
    return;
  }
  dialog.close();
  toast2(done.title, { kind: "ok", sub: done.sub });
  router.replace(withoutDialog(window.location.pathname, window.location.search));
  router.refresh();
}

/** Empties the Add an office dialog back to how the page drew it. */
export function clearNewOffice(dialog: ParentNode) {
  dialog.querySelectorAll<HTMLInputElement>("input[name]").forEach((input) => {
    if (input.type === "checkbox") input.checked = input.defaultChecked;
    else if (input.type !== "file") input.value = input.defaultValue;
  });
}

/** Uploads a chosen logo through /api/firm/logo and returns its locator, or an error. */
async function uploadLogo(file: File): Promise<{ locator: string } | { error: string }> {
  try {
    const response = await fetch("/api/firm/logo", { method: "POST", body: file, headers: { "content-type": file.type || "application/octet-stream" } });
    const body = (await response.json().catch(() => ({}))) as { locator?: string; error?: string };
    if (!response.ok || !body.locator) return { error: body.error || "The logo could not be stored. Try again." };
    return { locator: body.locator };
  } catch {
    return { error: "The logo could not be stored. Try again." };
  }
}

/** A Save (or Remove office) button in one of the Settings dialogs (`data-firm-save`). */
export async function runFirmSave(button: HTMLElement, router: Router) {
  const dialog = button.closest("dialog");
  if (!dialog) return;
  const organizationId = button.dataset.org ?? "";
  const kind = button.dataset.firmSave;
  const fields = fieldsOf(dialog);

  if (kind === "firm") {
    const text = Object.fromEntries(Object.entries(fields).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
    const result = await saveFirmDetails({ organizationId, fields: text });
    return finish(result, dialog, fields, { title: "Firm details saved", sub: "The change is in the audit log." }, router);
  }
  if (kind === "office") {
    const adding = !button.dataset.office;
    const result = await saveFirmOffice({ organizationId, officeId: button.dataset.office || null, fields });
    // Add an office starts empty next time, so saving again can't add the same office twice.
    if (adding && !("error" in result)) clearNewOffice(dialog);
    return finish(result, dialog, fields, { title: adding ? "Office added" : "Office saved", sub: "The change is in the audit log." }, router);
  }
  if (kind === "office-remove") {
    // Removing needs a second click within a few seconds: nothing is removed on the first.
    if (button.dataset.armed !== "1") {
      button.dataset.armed = "1";
      button.dataset.label = button.textContent ?? "";
      button.textContent = "Click again to remove";
      toast2("Remove this office?", { kind: "warn", sub: "Click Remove again to confirm. Staff and matters aren’t changed." });
      window.setTimeout(() => {
        if (button.dataset.armed !== "1") return;
        delete button.dataset.armed;
        button.textContent = button.dataset.label ?? "Remove office";
      }, 5000);
      return;
    }
    delete button.dataset.armed;
    button.textContent = button.dataset.label ?? "Remove office";
    const result = await removeFirmOffice({ organizationId, officeId: button.dataset.office ?? "" });
    return finish(result, dialog, fields, { title: "Office removed", sub: "The change is in the audit log." }, router);
  }
  if (kind === "brand") {
    const file = dialog.querySelector<HTMLInputElement>("input[type=file]")?.files?.[0] ?? null;
    let locator = typeof fields.logoLocator === "string" ? fields.logoLocator : "";
    if (file) {
      const uploaded = await uploadLogo(file);
      if ("error" in uploaded) {
        toast2(uploaded.error, { kind: "bad", sub: "Nothing was changed." });
        return;
      }
      locator = uploaded.locator;
      // Kept with the draft, so a step-up doesn't need the file again.
      fields.logoLocator = locator;
      const hidden = dialog.querySelector<HTMLInputElement>("input[name=logoLocator]");
      if (hidden) hidden.value = locator;
    }
    const result = await saveFirmBranding({ organizationId, logoLocator: locator, accent: typeof fields.accent === "string" ? fields.accent : "" });
    return finish(result, dialog, fields, { title: "Branding saved", sub: "The change is in the audit log." }, router);
  }
  if (kind === "timezone") {
    const firmInput = dialog.querySelector<HTMLInputElement>("input[name=firm]");
    const result = await saveTimezones({
      organizationId,
      mine: typeof fields.mine === "string" ? fields.mine : "",
      firm: firmInput ? firmInput.value : null,
      firmBefore: firmInput ? firmInput.defaultValue : null,
    });
    return finish(result, dialog, fields, { title: "Timezone saved", sub: "Your reminders and times use it from now on." }, router);
  }
}

/** Back from step-up (`?dlg=<dialog id>`): reopen that Settings dialog with what was typed. */
export function reopenFirmDialog(root: ParentNode, open: Open) {
  const id = new URLSearchParams(window.location.search).get("dlg");
  if (!id) return;
  const dialog = root.querySelector<HTMLDialogElement>(`dialog#${CSS.escape(id)}`);
  if (!dialog?.querySelector("[data-firm-save]")) return;
  let fields: Record<string, unknown> = {};
  try {
    const raw = sessionStorage.getItem(DRAFT);
    sessionStorage.removeItem(DRAFT);
    const parsed = raw ? (JSON.parse(raw) as { dialog?: unknown; fields?: Record<string, unknown> }) : null;
    if (parsed?.dialog === id && parsed.fields && typeof parsed.fields === "object") fields = parsed.fields;
  } catch {
    fields = {};
  }
  dialog.querySelectorAll<HTMLInputElement>("input[name]").forEach((input) => {
    const value = fields[input.name];
    if (input.type === "checkbox" && typeof value === "boolean" && !input.disabled) input.checked = value;
    else if (input.type !== "checkbox" && input.type !== "file" && typeof value === "string") input.value = value;
  });
  open(id);
}
