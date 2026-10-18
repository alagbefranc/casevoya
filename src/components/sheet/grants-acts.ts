"use client";

import { toast2 } from "@/components/port/kit";
import { createAccessGrant } from "@/modules/staff/grant-actions";

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

/** ?dlg=grant (back from step-up) reopens New access grant with what was typed. */
export function reopenGrantDialog(root: ParentNode, open: Open) {
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
