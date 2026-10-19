"use client";

import { toast2 } from "@/components/port/kit";
import { resendPortalInvitation, revokePortalInvitation } from "@/modules/portal-invitations/actions";
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
 * The invitation email carries their private link. The link also comes back to the owner, once,
 * as a backup: it is copied when the browser allows, and shown in the toast either way. When the
 * link could not be sealed into the email, the toast says so and the owner gives it themselves.
 */
async function shareLink(path: string, title: string, emailLink: boolean) {
  const link = inviteLink(window.location.origin, path);
  const expiry = "It works once and expires in 7 days.";
  // Say it was sent straight away; copying can wait on the browser (or never answer).
  toast2(title, {
    kind: "ok",
    sub: emailLink ? `The email contains their private link. Here it is too: ${link} ${expiry}` : `Send them this link: the email goes without it this time. ${link} ${expiry}`,
    duration: 30_000,
  });
  try {
    await Promise.race([navigator.clipboard.writeText(link), new Promise((_, reject) => window.setTimeout(() => reject(new Error("timeout")), 2000))]);
    toast2("Link copied", { kind: "ok", sub: "Paste it to them if the email doesn’t arrive." });
  } catch {
    // Copying isn't allowed here; the link is in the first message.
  }
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
  await shareLink(result.path, button.dataset.toast || "Invitation sent", result.emailLink);
  router.refresh();
}

/**
 * From Licences › Add a licence › Invite someone new: `role` picks Licensed consultant, and the
 * regulator and number typed there are named in the role hint (the invitee adds them on joining).
 */
export function applyInviteParams(root: ParentNode, search: string) {
  const params = new URLSearchParams(search);
  const role = field(root, "sR") as HTMLSelectElement | null;
  const wanted = params.get("role");
  if (role && wanted) {
    const label = wanted === "licensed_consultant" ? "Licensed consultant" : null;
    const option = label ? [...role.options].find((item) => (item.value || item.textContent) === label) : undefined;
    if (option) role.value = option.value;
  }
  const regulator = params.get("regulator");
  const college = params.get("college");
  const hint = role?.closest(".fld")?.querySelector<HTMLElement>(".hint");
  if (hint && (regulator || college)) {
    const licence = [regulator, college ? `number ${college}` : null].filter(Boolean).join(", ");
    hint.textContent = `They add their licence (${licence}) when they join. It’s checked against the CICC register list.`;
  }
}

/** Puts back what the person typed before a step-up, then forgets it. */
export function restoreStaffInvite(root: ParentNode) {
  applyInviteParams(root, window.location.search);
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
  if (button.dataset.portal) {
    const sent = await resendPortalInvitation({ organizationId: button.dataset.org ?? "", invitationId: button.dataset.invitation ?? "", code: null });
    if ("error" in sent) {
      if (needsStepUp(sent.error)) return stepUp(false);
      toast2(sent.error ?? "That didn’t work.", { kind: "bad", sub: "Nothing was sent." });
      return;
    }
    toast2("Invitation sent again", { kind: "ok", sub: "A new link went by email. It works once and expires in 7 days." });
    router.refresh();
    return;
  }
  const result = await resendStaffInvitation({ organizationId: organizationOf(root), invitationId: button.dataset.invitation ?? "" });
  if ("error" in result) {
    if (needsStepUp(result.error)) return stepUp(false);
    toast2(result.error, { kind: "bad", sub: "Nothing was sent." });
    return;
  }
  await shareLink(result.path, button.dataset.t || "Invitation sent again", result.emailLink);
  router.refresh();
}

export async function runStaffRevoke(button: HTMLElement, root: ParentNode, router: Router) {
  if (button.dataset.portal) {
    const revoked = await revokePortalInvitation({ organizationId: button.dataset.org ?? "", invitationId: button.dataset.invitation ?? "", code: null });
    if ("error" in revoked) {
      if (needsStepUp(revoked.error)) return stepUp(false);
      toast2(revoked.error ?? "That didn’t work.", { kind: "bad", sub: "The invitation still works." });
      return;
    }
    toast2("Invitation revoked", { kind: "ok", sub: "The link no longer works. It stays on this list, greyed." });
    router.refresh();
    return;
  }
  const result = await revokeStaffInvitation({ organizationId: organizationOf(root), invitationId: button.dataset.invitation ?? "" });
  if ("error" in result) {
    if (needsStepUp(result.error)) return stepUp(false);
    toast2(result.error, { kind: "bad", sub: "The invitation still works." });
    return;
  }
  toast2(button.dataset.hold || "Invitation revoked", { kind: "ok", sub: "The link no longer works. It stays on this list, greyed." });
  router.refresh();
}
