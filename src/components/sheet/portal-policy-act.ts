"use client";

import { toast2 } from "@/components/port/kit";
import { publishPortalPolicy } from "@/modules/portal-invitations/actions";
import { isPolicyKind, POLICY_DIALOG, POLICY_NAME, policyStepUpLocation, readPolicyDraft, type PolicyKind } from "@/modules/portal-policies/defaults";
import { needsStepUp, withoutDialog } from "@/modules/sheet/matter-wire";

type Router = { replace: (href: string) => void; refresh: () => void };

/** What was typed survives a step-up round trip in this tab only, per kind. */
const DRAFT = "cv-portal-policy";

const FIELDS: Record<PolicyKind, { version: string; title: string; body: string }> = {
  portal_terms: { version: "pTV", title: "pTN", body: "pTB" },
  privacy_notice: { version: "pPV", title: "pPN", body: "pPB" },
};

function field(root: ParentNode, id: string): HTMLInputElement | HTMLTextAreaElement | null {
  return root.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`);
}

function readFields(dialog: ParentNode, kind: PolicyKind) {
  const ids = FIELDS[kind];
  return {
    versionLabel: field(dialog, ids.version)?.value ?? "",
    title: field(dialog, ids.title)?.value ?? "",
    body: field(dialog, ids.body)?.value ?? "",
  };
}

/**
 * Publishes the dialog's version through the server action. The database decides; a step-up
 * refusal keeps the typed text in sessionStorage and goes to /mfa?step=6, which comes back here
 * with the same dialog open (`?tab=portal&dlg=terms|privacy`).
 */
export async function runPublishPolicy(button: HTMLElement, router: Router) {
  const kind = button.dataset.policy ?? "";
  const dialog = button.closest("dialog");
  if (!dialog || !isPolicyKind(kind)) return;
  const typed = readFields(dialog, kind);
  const read = readPolicyDraft({ kind, ...typed });
  if ("error" in read) {
    toast2(read.error, { kind: "warn", sub: "Nothing was published." });
    return;
  }
  const result = await publishPortalPolicy({ organizationId: button.dataset.org ?? "", ...read.input, code: null });
  if ("error" in result) {
    if (needsStepUp(result.error)) {
      try {
        sessionStorage.setItem(`${DRAFT}:${kind}`, JSON.stringify(typed));
      } catch {
        // Storage can be unavailable; the dialog then reopens with the text it started with.
      }
      window.location.assign(policyStepUpLocation(window.location.pathname, window.location.search, kind));
      return;
    }
    toast2(result.error, { kind: "bad", sub: "Nothing was published." });
    return;
  }
  dialog.close();
  toast2(`${POLICY_NAME[kind]} published`, { kind: "ok", sub: `Version ${read.input.versionLabel}. Clients accept it when they join.` });
  router.replace(withoutDialog(window.location.pathname, window.location.search));
  router.refresh();
}

/** Puts back what was typed before a step-up, then forgets it. */
export function restorePolicyDraft(dialog: ParentNode, kind: PolicyKind) {
  type Saved = { versionLabel?: unknown; title?: unknown; body?: unknown };
  let draft: Saved | null = null;
  try {
    const key = `${DRAFT}:${kind}`;
    const raw = sessionStorage.getItem(key);
    sessionStorage.removeItem(key);
    draft = raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    draft = null;
  }
  if (!draft) return;
  const ids = FIELDS[kind];
  const pairs: [string, unknown][] = [
    [ids.version, draft.versionLabel],
    [ids.title, draft.title],
    [ids.body, draft.body],
  ];
  for (const [id, value] of pairs) {
    const input = field(dialog, id);
    if (input && typeof value === "string") input.value = value;
  }
}

export function policyDialogId(kind: PolicyKind): string {
  return POLICY_DIALOG[kind].id;
}
