"use client";

import { toast2 } from "@/components/port/kit";
import { invitePortalPerson } from "@/modules/sheet/actions";
import { needsStepUp } from "@/modules/sheet/matter-wire";
import { acceptPath, expiryLabel, inviteStepUpLocation, portalRoleFromLabel, withoutInvite } from "@/modules/sheet/portal-invite";

type Router = { replace: (href: string) => void; refresh: () => void };

const DIALOG = "dlgC";

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || "them";
}

/** Points "Preview their screens" at the accept screen for the chosen role. */
function syncPreview(dialog: HTMLElement) {
  const role = portalRoleFromLabel(dialog.querySelector<HTMLSelectElement>("#cR")?.value);
  const preview = dialog.querySelector<HTMLAnchorElement>(".df a.btn");
  if (role && preview) preview.setAttribute("href", acceptPath(role));
}

/** Opens the dialog for the person whose card was clicked: their role on the matter and their email. */
export function openPortalInvite(button: HTMLElement, root: HTMLElement) {
  const dialog = root.querySelector<HTMLDialogElement>(`#${DIALOG}`);
  if (!dialog) return;
  dialog.dataset.person = button.dataset.person ?? "";
  dialog.dataset.name = button.dataset.name ?? "";
  const role = dialog.querySelector<HTMLSelectElement>("#cR");
  if (role && button.dataset.role) role.value = button.dataset.role;
  const email = dialog.querySelector<HTMLInputElement>("#cE");
  if (email) email.value = button.dataset.email ?? "";
  // The date of birth field is only there when someone on the matter has none, and only shown for them.
  const birthField = dialog.querySelector<HTMLElement>("#cDF");
  if (birthField) {
    birthField.hidden = button.dataset.dob !== "missing";
    const birth = birthField.querySelector<HTMLInputElement>("#cD");
    if (birth) birth.value = "";
  }
  syncPreview(dialog);
  if (role && !role.dataset.wired) {
    role.dataset.wired = "1";
    role.addEventListener("change", () => syncPreview(dialog));
  }
  if (!dialog.open) dialog.showModal();
}

/** Coming back from step-up (`?dlg=invite&pid=`): reopen the dialog for the same person. */
export function reopenPortalInvite(root: HTMLElement, personId: string | null) {
  if (!personId) return;
  const button = [...root.querySelectorAll<HTMLElement>("[data-invite-open]")].find((item) => item.dataset.person === personId);
  if (button) openPortalInvite(button, root);
}

/** The typed date of birth when the dialog asks for one, otherwise undefined (not asked). */
function birthDateValue(dialog: HTMLElement): string | undefined {
  const field = dialog.querySelector<HTMLElement>("#cDF");
  if (!field || field.hidden) return undefined;
  return field.querySelector<HTMLInputElement>("#cD")?.value ?? "";
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Sends the invitation through the server action. The database decides; a step-up refusal
 * sends the person to /mfa?step=6 and back here with the dialog open for the same person.
 * The email carries their private link; it is also copied for the inviter, as a backup.
 */
export async function runPortalInvite(button: HTMLElement, router: Router) {
  const dialog = button.closest("dialog");
  if (!dialog) return;
  const personId = dialog.dataset.person ?? "";
  const result = await invitePortalPerson({
    organizationId: button.dataset.org ?? "",
    matterId: button.dataset.matter ?? "",
    personId,
    roleLabel: dialog.querySelector<HTMLSelectElement>("#cR")?.value ?? "",
    email: dialog.querySelector<HTMLInputElement>("#cE")?.value ?? "",
    dateOfBirth: birthDateValue(dialog),
  });
  if ("error" in result) {
    if (needsStepUp(result.error)) {
      window.location.assign(inviteStepUpLocation(window.location.pathname, window.location.search, personId));
      return;
    }
    toast2(result.error, { kind: "bad", sub: "No invitation was sent." });
    return;
  }
  const name = firstName(dialog.dataset.name ?? "");
  const expires = expiryLabel(result.expiresAt, Intl.DateTimeFormat().resolvedOptions().timeZone);
  const when = expires ? `It works once and expires ${expires}.` : "It works once and expires in 7 days.";
  dialog.close();
  const copied = await copy(result.link);
  if (result.emailLink) {
    toast2(`Invitation sent to ${name}`, {
      kind: "ok",
      sub: copied
        ? `The email contains their private link. Link also copied. ${when}`
        : `The email contains their private link. Here it is too: ${result.link} ${when}`,
      duration: copied ? 12000 : 60000,
    });
  } else if (copied) {
    toast2(`Invitation sent to ${name}`, { kind: "ok", sub: `Their private link is copied. The email goes without it this time, so give it to them yourself. ${when}`, duration: 12000 });
  } else {
    toast2(`Invitation sent to ${name}`, { kind: "ok", sub: `The email goes without the link this time. Give them this one yourself: ${result.link} ${when}`, duration: 60000 });
  }
  router.replace(withoutInvite(window.location.pathname, window.location.search));
  router.refresh();
}
