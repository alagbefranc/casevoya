"use client";

import { toast2 } from "@/components/port/kit";
import { approveDeletionJob, cancelSubscription, chooseEndArrangement, firmExportIndex } from "@/modules/settings/sec-actions";

/**
 * Settings > Retention (SEC-07: Approve deletion) and Settings > Subscription (SEC-10: Cancel
 * subscription, After the export window, Download firm index), firm owner. The database decides;
 * a step-up refusal sends the owner to confirm it's them and back to the same tab.
 */
type Router = { refresh: () => void };
type Open = (id: string) => void;

function stepUp() {
  toast2("Confirm it’s you", { kind: "warn", sub: "Then come back and try again." });
  const next = `${window.location.pathname}${window.location.search}`;
  window.setTimeout(() => window.location.assign(`/mfa?step=6&next=${encodeURIComponent(next)}`), 900);
}

function newKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

function save(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function runSecAct(button: HTMLElement, root: ParentNode, router: Router, open: Open): Promise<void> {
  const act = button.dataset.secAct;
  const organizationId = button.dataset.org ?? "";

  if (act === "open-delete") {
    const dialog = root.querySelector<HTMLDialogElement>("dialog#dlgDelete");
    if (!dialog) return;
    dialog.dataset.matter = button.dataset.matter ?? "";
    // One key per opening: a double click approves once.
    dialog.dataset.key = newKey();
    const label = dialog.querySelector("[data-del-label]");
    if (label) label.textContent = button.dataset.matterLabel ?? "";
    const reason = dialog.querySelector<HTMLTextAreaElement>("#delR");
    if (reason) reason.value = "";
    open("dlgDelete");
    reason?.focus();
    return;
  }

  if (act === "approve-delete") {
    const dialog = button.closest("dialog");
    if (!dialog) return;
    const result = await approveDeletionJob({
      organizationId,
      matterId: dialog.dataset.matter ?? "",
      reason: dialog.querySelector<HTMLTextAreaElement>("#delR")?.value ?? "",
      key: dialog.dataset.key ?? newKey(),
    });
    if ("error" in result) {
      if (result.stepUp) return stepUp();
      toast2(result.error, { kind: "bad", sub: "Nothing was deleted." });
      return;
    }
    dialog.close();
    toast2("Deletion approved", { kind: "ok", sub: "The deletion runner removes the files within minutes. The tombstone appears here when it’s done." });
    router.refresh();
    return;
  }

  if (act === "cancel-sub") {
    const dialog = button.closest("dialog");
    const result = await cancelSubscription({ organizationId });
    if ("error" in result) {
      if (result.stepUp) return stepUp();
      toast2(result.error, { kind: "bad", sub: "Your subscription is unchanged." });
      return;
    }
    dialog?.close();
    toast2("Subscription set to end", {
      kind: "ok",
      sub: result.ok.recorded ? "Nothing changes until the end of the paid period. Nothing is deleted." : "Stripe confirms it to Casevoya in a moment; this page updates when it does.",
    });
    router.refresh();
    return;
  }

  if (act === "arrangement") {
    const dialog = button.closest("dialog");
    if (!dialog) return;
    const arrangement = dialog.querySelector<HTMLInputElement>("input[name=earA]:checked")?.value ?? "";
    const transferId = dialog.querySelector<HTMLSelectElement>("#earT")?.value || null;
    const result = await chooseEndArrangement({ organizationId, arrangement, transferId });
    if ("error" in result) {
      if (result.stepUp) return stepUp();
      toast2(result.error, { kind: "bad", sub: "Nothing was changed." });
      return;
    }
    dialog.close();
    toast2("Saved", { kind: "ok", sub: arrangement === "transfer" ? "The transfer counts once you mark it completed." : "The records go into the custodial archive after the window." });
    router.refresh();
    return;
  }

  if (act === "firm-index") {
    const result = await firmExportIndex({ organizationId });
    if ("error" in result) {
      if (result.stepUp) return stepUp();
      toast2(result.error, { kind: "bad" });
      return;
    }
    save(`firm-export-index-${new Date().toISOString().slice(0, 10)}.json`, result.ok);
    toast2("Firm index downloaded", { kind: "ok", sub: "Keep it with the client-file packages: it lists each one with its SHA-256." });
  }
}
