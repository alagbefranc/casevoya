"use client";

import { toast2 } from "@/components/port/kit";
import { inviteStaff, resendStaffInvitation, revokeStaffInvitation } from "@/modules/staff/actions";
import { inviteLink, needsStepUp, readStaffInvite, staffStepUpLocation } from "@/modules/sheet/staff-present";

type Router = { refresh: () => void };

/** The dialog's fields survive a step-up round trip in this tab only. */
const DRAFT = "cv-staff-invite";

function field(root: ParentNode, id: string): HTMLInputElement | HTMLSelectElement | null {
  return root.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`);
}

function organizationOf(root: ParentNode): string {
  return root.querySelector<HTMLElement>("#dlgS [data-org]")?.dataset.org ?? "";
}

function stepUp(reopen: boolean) {
  window.location.assign(staffStepUpLocation(window.location.pathname, window.location.search, reopen));
}

/**
 * The link goes to the owner, once: the invitation email does not carry it. It is copied when
 * the browser allows, and shown in the toast either way.
 */
async function shareLink(path: string, title: string) {
  const link = inviteLink(window.location.origin, path);
  let copied = false;
  try {
    await navigator.clipboard.writeText(link);
    copied = true;
  } catch {
    copied = false;
  }
  toast2(title, {
    kind: "ok",
    sub: copied
      ? `Link copied. Send it to them: the invitation email doesn’t include it. It works once and expires in 7 days. ${link}`
      : `Send them this link: the invitation email doesn’t include it. It works once and expires in 7 days. ${link}`,
    duration: 30_000,
  });
}

/** Saves the Invite staff dialog through the server action. The database decides. */
export async function runStaffInvite(button: HTMLElement, router: Router) {
  const dialog = button.closest("dialog");
  if (!dialog) return;
  const email = field(dialog, "sE")?.value ?? "";
  const role = field(dialog, "sR")?.value ?? "";
  const read = readStaffInvite({ email, role });
  if ("error" in read) {
    toast2(read.error, { kind: "warn", sub: "Nothing was sent." });
    return;
  }
  const result = await inviteStaff({ organizationId: button.dataset.org ?? "", email: read.input.email, role: read.input.role });
  if ("error" in result) {
    if (needsStepUp(result.error)) {
      try {
        sessionStorage.setItem(DRAFT, JSON.stringify({ email, role }));
      } catch {
        // Storage can be unavailable; the person types the address again.
      }
      stepUp(true);
      return;
    }
    toast2(result.error, { kind: "bad", sub: "Nothing was sent." });
    return;
  }
  const input = field(dialog, "sE");
  if (input) input.value = "";
  dialog.close();
  await shareLink(result.path, button.dataset.toast || "Invitation sent");
  router.refresh();
}

/** Puts back what the person typed before a step-up, then forgets it. */
export function restoreStaffInvite(root: ParentNode) {
  let draft: { email?: unknown; role?: unknown } | null = null;
  try {
    const raw = sessionStorage.getItem(DRAFT);
    sessionStorage.removeItem(DRAFT);
    draft = raw ? (JSON.parse(raw) as { email?: unknown; role?: unknown }) : null;
  } catch {
    draft = null;
  }
  if (!draft) return;
  const email = field(root, "sE");
  const role = field(root, "sR");
  if (email && typeof draft.email === "string") email.value = draft.email;
  if (role && typeof draft.role === "string" && [...(role as HTMLSelectElement).options].some((option) => option.value === draft.role)) {
    role.value = draft.role;
  }
}

/** Resend: a new invitation for the same person and role, with a new link. */
export async function runStaffResend(button: HTMLElement, root: ParentNode, router: Router) {
  const result = await resendStaffInvitation({ organizationId: organizationOf(root), invitationId: button.dataset.invitation ?? "" });
  if ("error" in result) {
    if (needsStepUp(result.error)) return stepUp(false);
    toast2(result.error, { kind: "bad", sub: "Nothing was sent." });
    return;
  }
  await shareLink(result.path, button.dataset.t || "Invitation sent again");
  router.refresh();
}

export async function runStaffRevoke(button: HTMLElement, root: ParentNode, router: Router) {
  const result = await revokeStaffInvitation({ organizationId: organizationOf(root), invitationId: button.dataset.invitation ?? "" });
  if ("error" in result) {
    if (needsStepUp(result.error)) return stepUp(false);
    toast2(result.error, { kind: "bad", sub: "The invitation still works." });
    return;
  }
  toast2(button.dataset.hold || "Invitation revoked", { kind: "ok", sub: "The link no longer works." });
  router.refresh();
}
