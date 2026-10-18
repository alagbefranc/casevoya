"use client";

import { toast2 } from "@/components/port/kit";
import { addConsultantLicence, reassignMatters, reportLicenceChange, type LicenceResult } from "@/modules/staff/licence-actions";
import { INVITE_SOMEONE } from "@/modules/sheet/licence-present";

type Router = { refresh: () => void; push: (href: string) => void };
type Open = (id: string) => void;

/** What was typed survives a step-up round trip in this tab only. */
const DRAFT = "cv-licence-draft";

export const LICENCE_DIALOGS = { add: "licence-add", change: "licence-change", reassign: "reassign" } as const;

function el<T extends HTMLElement = HTMLInputElement>(root: ParentNode, id: string): T | null {
  return root.querySelector<T>(`#${id}`);
}

function stepUp(dialog: string, draft: Record<string, unknown>) {
  try {
    sessionStorage.setItem(DRAFT, JSON.stringify({ dialog, ...draft }));
  } catch {
    // Storage can be unavailable; the person types it again.
  }
  const params = new URLSearchParams(window.location.search);
  params.set("dlg", dialog);
  const next = `${window.location.pathname}?${params.toString()}`;
  toast2("Confirm it’s you", { kind: "warn", sub: "Then the dialog opens again with what you typed." });
  window.setTimeout(() => window.location.assign(`/mfa?step=6&next=${encodeURIComponent(next)}`), 900);
}

function done(result: LicenceResult, dialog: string, draft: Record<string, unknown>): boolean {
  if ("error" in result) {
    if (result.stepUp) stepUp(dialog, draft);
    else toast2(result.error, { kind: "bad", sub: "Nothing was changed." });
    return false;
  }
  return true;
}

function organization(button: HTMLElement): string {
  return button.dataset.org ?? "";
}

// ---------------------------------------------------------------------------
// Add a licence (#dlgAdd)
// ---------------------------------------------------------------------------
export async function runLicenceAdd(button: HTMLElement, router: Router) {
  const dialog = button.closest("dialog");
  if (!dialog) return;
  const option = el<HTMLSelectElement>(dialog, "adP")?.selectedOptions[0];
  if (!option || option.textContent?.trim() === INVITE_SOMEONE) {
    dialog.close();
    router.push("/sheet/invitations?dlg=invite");
    return;
  }
  const regulator = el<HTMLSelectElement>(dialog, "adR")?.value ?? "";
  const collegeId = el(dialog, "adN")?.value ?? "";
  const draft = { membershipId: option.dataset.membership ?? "", regulator, collegeId };
  const result = await addConsultantLicence({ organizationId: organization(button), ...draft });
  if (!done(result, LICENCE_DIALOGS.add, draft)) return;
  const input = el(dialog, "adN");
  if (input) input.value = "";
  dialog.close();
  toast2(button.dataset.toast || "Licence added", { kind: "ok", sub: "A reviewer checks it by hand against the CICC public register." });
  router.refresh();
}

// ---------------------------------------------------------------------------
// Report a change (#dlgChg)
// ---------------------------------------------------------------------------
export function openLicenceReport(button: HTMLElement, root: ParentNode, open: Open) {
  const send = root.querySelector<HTMLElement>("#dlgChg [data-licence-send]");
  if (!send) return;
  send.dataset.credential = button.dataset.licenceReport ?? "";
  open("dlgChg");
}

export async function runLicenceReport(button: HTMLElement, router: Router) {
  const dialog = button.closest("dialog");
  if (!dialog) return;
  const detail = el<HTMLTextAreaElement>(dialog, "chW")?.value ?? "";
  const draft = { credentialId: button.dataset.credential ?? "", detail };
  const result = await reportLicenceChange({ organizationId: organization(button), ...draft });
  if (!done(result, LICENCE_DIALOGS.change, draft)) return;
  const area = el<HTMLTextAreaElement>(dialog, "chW");
  if (area) area.value = "";
  dialog.close();
  toast2(button.dataset.toast || "Change reported", { kind: "ok", sub: button.dataset.toastSub || "Logged. A reviewer re-checks the register." });
  router.refresh();
}

// ---------------------------------------------------------------------------
// Reassign work (#dlgRe), on the licence-suspended home
// ---------------------------------------------------------------------------
export async function runReassign(button: HTMLElement, router: Router) {
  const dialog = button.closest("dialog");
  if (!dialog) return;
  const to = el<HTMLSelectElement>(dialog, "toC")?.selectedOptions[0]?.dataset.membership ?? "";
  const matterIds = [...dialog.querySelectorAll<HTMLInputElement>("label.check input[type=checkbox]")]
    .filter((box) => box.checked)
    .map((box) => box.dataset.matter ?? "");
  const reason = el<HTMLTextAreaElement>(dialog, "reN")?.value ?? "";
  const draft = { to, matterIds, reason };
  const result = await reassignMatters({ organizationId: organization(button), fromMembershipId: button.dataset.reassignFrom ?? "", toMembershipId: to, matterIds, reason });
  if (!done(result, LICENCE_DIALOGS.reassign, draft)) return;
  dialog.close();
  const count = "count" in result && result.count ? result.count : matterIds.length;
  const name = el<HTMLSelectElement>(dialog, "toC")?.selectedOptions[0]?.dataset.name ?? "them";
  toast2(`${count} matter${count === 1 ? "" : "s"} reassigned to ${name}`, { kind: "ok", sub: "Logged in the audit trail." });
  router.refresh();
}

/** Keeps the Reassign button's count in step with the ticked matters. */
export function syncReassign(dialog: ParentNode) {
  const button = dialog.querySelector<HTMLElement>("[data-reassign-from]");
  if (!button) return;
  const count = [...dialog.querySelectorAll<HTMLInputElement>("label.check input[type=checkbox]")].filter((box) => box.checked).length;
  button.textContent = `Reassign ${count} matter${count === 1 ? "" : "s"}`;
}

// ---------------------------------------------------------------------------
// Back from step-up: reopen the dialog with what was typed.
// ---------------------------------------------------------------------------
export function reopenLicenceDialog(root: ParentNode, open: Open) {
  const dialog = new URLSearchParams(window.location.search).get("dlg");
  if (!dialog || !(Object.values(LICENCE_DIALOGS) as string[]).includes(dialog)) return;
  let draft: Record<string, unknown> = {};
  try {
    const raw = sessionStorage.getItem(DRAFT);
    sessionStorage.removeItem(DRAFT);
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
    if (parsed && parsed.dialog === dialog) draft = parsed;
  } catch {
    draft = {};
  }
  const text = (key: string) => (typeof draft[key] === "string" ? (draft[key] as string) : "");
  if (dialog === LICENCE_DIALOGS.add && root.querySelector("#dlgAdd")) {
    const select = el<HTMLSelectElement>(root, "adP");
    const option = select ? [...select.options].find((item) => item.dataset.membership === text("membershipId")) : undefined;
    if (option) option.selected = true;
    const regulator = el<HTMLSelectElement>(root, "adR");
    if (regulator && text("regulator")) regulator.value = text("regulator");
    const number = el(root, "adN");
    if (number) number.value = text("collegeId");
    open("dlgAdd");
  }
  if (dialog === LICENCE_DIALOGS.change && root.querySelector("#dlgChg")) {
    const send = root.querySelector<HTMLElement>("#dlgChg [data-licence-send]");
    if (send) send.dataset.credential = text("credentialId");
    const area = el<HTMLTextAreaElement>(root, "chW");
    if (area) area.value = text("detail");
    if (text("credentialId")) open("dlgChg");
  }
  if (dialog === LICENCE_DIALOGS.reassign && root.querySelector("#dlgRe")) {
    const ids = Array.isArray(draft.matterIds) ? (draft.matterIds as unknown[]) : null;
    if (ids) {
      root.querySelectorAll<HTMLInputElement>("#dlgRe label.check input[type=checkbox]").forEach((box) => {
        box.checked = ids.includes(box.dataset.matter);
      });
    }
    const to = el<HTMLSelectElement>(root, "toC");
    const option = to ? [...to.options].find((item) => item.dataset.membership === text("to")) : undefined;
    if (option) option.selected = true;
    const reason = el<HTMLTextAreaElement>(root, "reN");
    if (reason && text("reason")) reason.value = text("reason");
    const dlg = root.querySelector("#dlgRe");
    if (dlg) syncReassign(dlg);
    open("dlgRe");
  }
}
