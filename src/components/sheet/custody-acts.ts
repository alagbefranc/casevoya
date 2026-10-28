"use client";

import { toast2 } from "@/components/port/kit";
import { CUSTODY_DIALOG } from "@/components/sheet/designer/documents";
import { recordCustodyStep } from "@/modules/documents/actions";

type Router = { refresh: () => void };

const TITLE: Record<string, string> = { received: "Record an original", moved: "Move the original", returned: "Return the original", acknowledged: "Acknowledge the return" };
const DONE: Record<string, string> = { received: "Original recorded", moved: "Move recorded", returned: "Return recorded", acknowledged: "Acknowledgement recorded" };

function dialog(): HTMLDialogElement | null {
  return document.getElementById(CUSTODY_DIALOG) as HTMLDialogElement | null;
}

function value(id: string): string {
  return dialog()?.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`)?.value.trim() ?? "";
}

/** Record an original, Move, Return or Acknowledge (DOC-07): sets the step and shows its fields. */
export function openCustody(button: HTMLElement) {
  const box = dialog();
  if (!box) return;
  const kind = button.dataset.custodyOpen ?? "received";
  box.dataset.kind = kind;
  box.dataset.org = button.dataset.org ?? "";
  box.dataset.version = button.dataset.version ?? "";
  const heading = box.querySelector("#cuH");
  if (heading) heading.textContent = TITLE[kind] ?? "Custody";
  const what = box.querySelector("#cuWhat");
  if (what) what.textContent = button.dataset.title ?? "";
  box.querySelectorAll<HTMLElement>("[data-cu-for]").forEach((node) => {
    node.hidden = !(node.dataset.cuFor ?? "").split(" ").includes(kind);
  });
  const dateLabel = box.querySelector("#cuOnL");
  if (dateLabel) dateLabel.textContent = kind === "returned" ? "Returned on" : "Received on";
  box.querySelectorAll<HTMLInputElement>("input").forEach((input) => {
    input.value = "";
  });
  const today = new Date().toISOString().slice(0, 10);
  const on = box.querySelector<HTMLInputElement>("#cuOn");
  if (on) {
    on.value = today;
    on.max = today;
  }
  box.showModal();
}

export async function runCustodySave(router: Router) {
  const box = dialog();
  if (!box) return;
  const kind = box.dataset.kind ?? "received";
  const versionId = kind === "received" ? value("cuDoc") : (box.dataset.version ?? "");
  if (!versionId) {
    toast2("Choose the document.", { kind: "bad", sub: "Nothing was recorded." });
    return;
  }
  const result = await recordCustodyStep({
    organizationId: box.dataset.org ?? "",
    versionId,
    kind,
    on: kind === "received" || kind === "returned" ? value("cuOn") || null : null,
    location: kind === "received" || kind === "moved" ? value("cuLoc") || null : null,
    purpose: kind === "received" ? value("cuWhy") || null : null,
    recipient: kind === "returned" || kind === "acknowledged" ? value("cuTo") || null : null,
  });
  if ("error" in result) {
    toast2(result.error ?? "Nothing was recorded.", { kind: "bad", sub: "Nothing was recorded." });
    return;
  }
  box.close();
  toast2(DONE[kind] ?? "Recorded", { kind: "ok", sub: "It’s in the original’s history and the audit log." });
  router.refresh();
}
