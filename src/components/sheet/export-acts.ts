"use client";

import { toast2 } from "@/components/port/kit";

type Router = { refresh(): void };

async function post(url: string, body: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  try {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
    const data = ((await response.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
    return { ok: response.ok, data };
  } catch {
    return { ok: false, data: { error: "Check your connection and try again." } };
  }
}

function errorOf(data: Record<string, unknown>): string {
  return typeof data.error === "string" ? data.error : "That didn’t work. Try again.";
}

/**
 * The Client-file exports page. New export and a ready export's Download open the Designer's
 * "Confirm it's you" dialog (start or download mode); Confirm sends the authenticator code with the
 * request so the server can take the step-up the database requires; Cancel stops a build.
 */
export async function runExportAct(button: HTMLElement, root: HTMLElement, router: Router): Promise<void> {
  const act = button.dataset.exportAct;
  const dialog = root.querySelector<HTMLDialogElement>("dialog#dlgX");
  const confirm = dialog?.querySelector<HTMLElement>('[data-export-act="confirm"]');
  const org = confirm?.dataset.org ?? "";

  if (act === "new" || act === "download") {
    if (!dialog) return;
    dialog.dataset.mode = act === "new" ? "start" : "download";
    dialog.dataset.export = button.dataset.export ?? "";
    const field = dialog.querySelector<HTMLElement>("[data-export-matter-field]");
    if (field) field.hidden = act !== "new";
    const code = dialog.querySelector<HTMLInputElement>("#xC");
    if (code) code.value = "";
    if (!dialog.open) dialog.showModal();
    code?.focus();
    return;
  }

  if (act === "cancel") {
    const result = await post(`/api/exports/${button.dataset.export ?? ""}`, { organizationId: button.dataset.org ?? org, action: "cancel" });
    if (!result.ok) {
      toast2("Export not cancelled", { kind: "warn", sub: errorOf(result.data) });
      return;
    }
    toast2("Export cancelled", { sub: "Nothing was kept." });
    router.refresh();
    return;
  }

  if (act !== "confirm" || !dialog) return;
  const code = dialog.querySelector<HTMLInputElement>("#xC")?.value.trim() ?? "";
  if (!/^\d{6}$/.test(code)) {
    toast2("Enter the six-digit code", { kind: "warn", sub: "Use the code from your authenticator app." });
    return;
  }

  if (dialog.dataset.mode === "download") {
    const result = await post(`/api/exports/${dialog.dataset.export ?? ""}`, { organizationId: org, action: "download", code });
    if (!result.ok || typeof result.data.url !== "string") {
      toast2("Download didn’t start", { kind: "warn", sub: errorOf(result.data) });
      return;
    }
    dialog.close();
    toast2("Download started", { kind: "ok", sub: "The link works for one minute." });
    window.location.assign(result.data.url);
    router.refresh();
    return;
  }

  const matterId = button.dataset.matter || dialog.querySelector<HTMLSelectElement>("#xM")?.value || "";
  if (!matterId) {
    toast2("Choose a matter", { kind: "warn", sub: "Pick the client file to export." });
    return;
  }
  dialog.close();
  toast2("Export started", { kind: "ok", sub: "We’ll notify you when it’s ready." });
  const refresh = window.setTimeout(() => router.refresh(), 1500);
  const result = await post("/api/exports", { organizationId: org, matterId, code, key: crypto.randomUUID() });
  window.clearTimeout(refresh);
  router.refresh();
  if (!result.ok) {
    toast2("Export didn’t finish", { kind: "warn", sub: errorOf(result.data) });
    return;
  }
  toast2("Export ready", { kind: "ok", sub: "Download it from this page within 24 hours." });
}
