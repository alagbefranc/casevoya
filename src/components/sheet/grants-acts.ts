"use client";

import { busyBtn, clearBtn, settleBtn, toast2 } from "@/components/port/kit";
import { grantDraftProblem } from "@/modules/sheet/grants-present";
import { createAccessGrant, revokeAccessGrant } from "@/modules/staff/grant-actions";
import { approveSupportAccess, declineSupportAccess, endSupportAccess, extendSupportAccess, type SupportResult } from "@/modules/staff/support-actions";

type Router = { refresh: () => void };
type Open = (id: string) => void;

const DRAFT = "cv-grant-draft";
export const GRANT_DIALOG = "grant";

function el<T extends HTMLElement = HTMLInputElement>(root: ParentNode, id: string): T | null {
  return root.querySelector<T>(`#${id}`);
}

/** New access grant (#dlgG): the database decides (firm owner, recent step-up). */
export async function runGrantCreate(button: HTMLElement, router: Router) {
  const dialog = button.closest("dialog");
  if (!dialog) return;
  const person = el<HTMLSelectElement>(dialog, "gW")?.selectedOptions[0];
  const scope = el<HTMLSelectElement>(dialog, "gS")?.selectedOptions[0];
  const draft = {
    personId: person?.dataset.person ?? "",
    matterId: scope?.dataset.matter ?? "",
    subjectId: scope?.dataset.subject ?? "",
    expires: el(dialog, "gE")?.value ?? "",
    reason: el(dialog, "gR")?.value ?? "",
  };
  if (!draft.personId || !draft.matterId) {
    toast2("Choose a person and what they can see", { kind: "warn", sub: "Only people with a portal login can be given access." });
    return;
  }
  // Check the form before asking for a step-up, so an empty form never leaves the page.
  const problem = grantDraftProblem(draft.expires, draft.reason, button.dataset.today || firmTodayIso());
  if (problem) {
    toast2(problem.title, { kind: "warn", sub: problem.sub });
    el(dialog, problem.field)?.focus();
    return;
  }
  const result = await createAccessGrant({ organizationId: button.dataset.org ?? "", ...draft });
  if ("error" in result) {
    if (result.stepUp) {
      try {
        sessionStorage.setItem(DRAFT, JSON.stringify(draft));
      } catch {
        // Storage can be unavailable; the person types it again.
      }
      const params = new URLSearchParams(window.location.search);
      params.set("dlg", GRANT_DIALOG);
      const next = `${window.location.pathname}?${params.toString()}`;
      toast2("Confirm it’s you", { kind: "warn", sub: "Then the dialog opens again with what you typed." });
      window.setTimeout(() => window.location.assign(`/mfa?step=6&next=${encodeURIComponent(next)}`), 900);
      return;
    }
    toast2(result.error, { kind: "bad", sub: "No access was given." });
    return;
  }
  for (const id of ["gE", "gR"]) {
    const input = el(dialog, id);
    if (input) input.value = "";
  }
  dialog.close();
  toast2(button.dataset.toast || "Grant created", { kind: "ok", sub: `Read only, until the end of ${draft.expires}. Logged in the audit trail.` });
  router.refresh();
}

/** Fallback when the page gave no firm day: the browser's date. The database checks the firm's day. */
function firmTodayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export const GRANT_REVOKE_DIALOG = "grant-revoke";
const REVOKE_DRAFT = "cv-grant-revoke-draft";

/** An active grant's row opens Revoke access grant (#dlgGX) for that grant. */
export function openGrantRevoke(row: HTMLElement, root: ParentNode, open: Open, reason = "") {
  const dialog = root.querySelector<HTMLDialogElement>("dialog#dlgGX");
  if (!dialog) return;
  dialog.dataset.grant = row.dataset.grantRow ?? "";
  const who = el<HTMLElement>(dialog, "gxW");
  if (who) who.textContent = `${row.dataset.grantLabel ?? ""} Revoking ends their access now; the grant stays on record.`;
  const input = el(dialog, "gxR");
  if (input) input.value = reason;
  open("dlgGX");
  input?.focus();
}

/** Revoke grant: reason first, then the database (firm owner, recent step-up). */
export async function runGrantRevoke(button: HTMLElement, router: Router) {
  const dialog = button.closest<HTMLDialogElement>("dialog");
  if (!dialog) return;
  const grantId = dialog.dataset.grant ?? "";
  const reason = el(dialog, "gxR")?.value.trim() ?? "";
  if (reason.length < 3) {
    toast2("Give a reason", { kind: "warn", sub: "At least 3 characters. It is kept in the audit trail." });
    el(dialog, "gxR")?.focus();
    return;
  }
  const result = await revokeAccessGrant({ organizationId: button.dataset.org ?? "", grantId, reason });
  if ("error" in result) {
    if (result.stepUp) {
      try {
        sessionStorage.setItem(REVOKE_DRAFT, JSON.stringify({ grantId, reason }));
      } catch {
        // Storage can be unavailable; the person types the reason again.
      }
      const params = new URLSearchParams(window.location.search);
      params.set("dlg", GRANT_REVOKE_DIALOG);
      const next = `${window.location.pathname}?${params.toString()}`;
      toast2("Confirm it’s you", { kind: "warn", sub: "Then the dialog opens again with your reason." });
      window.setTimeout(() => window.location.assign(`/mfa?step=6&next=${encodeURIComponent(next)}`), 900);
      return;
    }
    toast2(result.error, { kind: "bad", sub: "The grant is unchanged." });
    return;
  }
  dialog.close();
  toast2("Grant revoked", { kind: "ok", sub: "Their access ended now. Logged in the audit trail." });
  router.refresh();
}

/** ?dlg=grant-revoke (back from step-up) reopens Revoke for the same grant with the reason typed. */
function reopenGrantRevoke(root: ParentNode, open: Open) {
  let draft: { grantId?: string; reason?: string } = {};
  try {
    const raw = sessionStorage.getItem(REVOKE_DRAFT);
    sessionStorage.removeItem(REVOKE_DRAFT);
    draft = raw ? (JSON.parse(raw) as typeof draft) : {};
  } catch {
    draft = {};
  }
  const row = [...root.querySelectorAll<HTMLElement>("[data-grant-row]")].find((item) => item.dataset.grantRow === draft.grantId);
  if (row) openGrantRevoke(row, root, open, draft.reason ?? "");
}

// ---------------------------------------------------------------------------
// Support access (SEC-09): Approve, Decline (#dlgSX), End now, Extend 30 min.
// ---------------------------------------------------------------------------
export const SUPPORT_DIALOG = "support";
const SUPPORT_DRAFT = "cv-support-draft";

type SupportAct = "approve" | "decline" | "end" | "extend";

type SupportDraft = { act: SupportAct; requestId: string; reason?: string };

/** Confirm it's you, then come back to the Support access tab and finish the same action. */
function supportStepUp(draft: SupportDraft) {
  try {
    sessionStorage.setItem(SUPPORT_DRAFT, JSON.stringify(draft));
  } catch {
    // Storage can be unavailable; the person presses the button again.
  }
  const params = new URLSearchParams(window.location.search);
  params.set("tab", "support");
  params.set("dlg", SUPPORT_DIALOG);
  const next = `${window.location.pathname}?${params.toString()}`;
  toast2("Confirm it’s you", { kind: "warn", sub: draft.act === "decline" ? "Then the dialog opens again with your reason." : "Then this finishes on its own." });
  window.setTimeout(() => window.location.assign(`/mfa?step=6&next=${encodeURIComponent(next)}`), 900);
}

/** The waiting request's Decline opens the dialog for that request. */
export function openSupportDecline(button: HTMLElement, root: ParentNode, open: Open, reason = "") {
  const dialog = root.querySelector<HTMLDialogElement>("dialog#dlgSX");
  if (!dialog) return;
  dialog.dataset.request = button.dataset.supportId ?? "";
  const input = el(dialog, "sxR");
  if (input) input.value = reason;
  open("dlgSX");
  input?.focus();
}

function supportFailed(result: SupportResult, draft: SupportDraft, unchanged: string): result is { error: string; stepUp?: boolean } {
  if (!("error" in result)) return false;
  if (result.stepUp) supportStepUp(draft);
  else toast2(result.error, { kind: "bad", sub: unchanged });
  return true;
}

/** Approve, End now and Extend 30 min: the database decides (firm owner; step-up to approve or extend). */
export async function runSupportAct(button: HTMLElement, router: Router, root: ParentNode, open: Open) {
  const act = button.dataset.supportAct as SupportAct | undefined;
  const requestId = button.dataset.supportId ?? "";
  const organizationId = button.dataset.org ?? "";
  if (!act || !requestId) return;
  if (act === "decline") return openSupportDecline(button, root, open);
  const draft: SupportDraft = { act, requestId };
  if (act === "approve") {
    busyBtn(button);
    const result = await approveSupportAccess({ organizationId, requestId });
    if (supportFailed(result, draft, "Nothing opened.")) return clearBtn(button);
    await settleBtn(button, "ok");
    toast2(button.dataset.done || "Support access approved", { kind: "ok", sub: button.dataset.sub || "Ends automatically. You’ll see each thing they open." });
    router.refresh();
    return;
  }
  if (act === "end") {
    const result = await endSupportAccess({ organizationId, requestId });
    if (supportFailed(result, draft, "Support access is unchanged.")) return;
    toast2(button.dataset.toast || "Support access ended", { kind: "ok", sub: button.dataset.sub || "Logged in the audit trail." });
    router.refresh();
    return;
  }
  const result = await extendSupportAccess({ organizationId, requestId, minutes: 30 });
  if (supportFailed(result, draft, "Support access is unchanged.")) return;
  toast2("Support access extended by 30 minutes", { kind: "ok", sub: "Logged in the audit trail. 240 minutes in all at most." });
  router.refresh();
}

/** Decline request (#dlgSX): reason first, then the database (firm owner). */
export async function runSupportDecline(button: HTMLElement, router: Router) {
  const dialog = button.closest<HTMLDialogElement>("dialog");
  if (!dialog) return;
  const requestId = dialog.dataset.request ?? "";
  const reason = el(dialog, "sxR")?.value.trim() ?? "";
  if (reason.length < 3) {
    toast2("Give a reason", { kind: "warn", sub: "At least 3 characters. Support sees it with the decision." });
    el(dialog, "sxR")?.focus();
    return;
  }
  const result = await declineSupportAccess({ organizationId: button.dataset.org ?? "", requestId, reason });
  if (supportFailed(result, { act: "decline", requestId, reason }, "The request is still waiting.")) return;
  dialog.close();
  toast2("Request declined", { kind: "ok", sub: "Nothing opened. Logged in the audit trail." });
  router.refresh();
}

/** ?dlg=support (back from step-up): finish the pressed action, or reopen Decline with the reason. */
export function reopenSupport(root: ParentNode, open: Open, router: Router) {
  if (new URLSearchParams(window.location.search).get("dlg") !== SUPPORT_DIALOG) return;
  let draft: Partial<SupportDraft> = {};
  try {
    const raw = sessionStorage.getItem(SUPPORT_DRAFT);
    sessionStorage.removeItem(SUPPORT_DRAFT);
    draft = raw ? (JSON.parse(raw) as Partial<SupportDraft>) : {};
  } catch {
    draft = {};
  }
  if (!draft.act || !draft.requestId) return;
  const button = [...root.querySelectorAll<HTMLElement>("[data-support-act]")].find(
    (item) => item.dataset.supportAct === draft.act && item.dataset.supportId === draft.requestId,
  );
  if (!button) return;
  if (draft.act === "decline") return openSupportDecline(button, root, open, draft.reason ?? "");
  if (button.getAttribute("aria-busy") === "true") return;
  button.setAttribute("aria-busy", "true");
  void runSupportAct(button, router, root, open).finally(() => button.removeAttribute("aria-busy"));
}

/** ?dlg=grant (back from step-up) reopens New access grant with what was typed. */
export function reopenGrantDialog(root: ParentNode, open: Open) {
  if (new URLSearchParams(window.location.search).get("dlg") === GRANT_REVOKE_DIALOG) return reopenGrantRevoke(root, open);
  if (new URLSearchParams(window.location.search).get("dlg") !== GRANT_DIALOG || !root.querySelector("#dlgG")) return;
  let draft: Record<string, string> = {};
  try {
    const raw = sessionStorage.getItem(DRAFT);
    sessionStorage.removeItem(DRAFT);
    draft = raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    draft = {};
  }
  const person = el<HTMLSelectElement>(root, "gW");
  const personOption = person ? [...person.options].find((option) => option.dataset.person === draft.personId) : undefined;
  if (personOption) personOption.selected = true;
  const scope = el<HTMLSelectElement>(root, "gS");
  const scopeOption = scope ? [...scope.options].find((option) => option.dataset.matter === draft.matterId && option.dataset.subject === draft.subjectId) : undefined;
  if (scopeOption) scopeOption.selected = true;
  const expires = el(root, "gE");
  if (expires && typeof draft.expires === "string") expires.value = draft.expires;
  const reason = el(root, "gR");
  if (reason && typeof draft.reason === "string") reason.value = draft.reason;
  open("dlgG");
}
