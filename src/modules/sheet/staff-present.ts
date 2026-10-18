/**
 * Pure helpers for the Sheet's Staff tab (People and invitations): the team and pending
 * staff invitations in the Designer's words, what the Invite staff dialog sends, how the
 * database's refusals read, and where a step-up goes. The database decides every invite.
 */
import type { StaffRow } from "@/components/sheet/designer/invitations";
import { safeAccessError } from "@/lib/auth/step-up";
import { staffPerson } from "@/modules/sheet/avatar";
import { dayMonth } from "@/modules/sheet/home-present";
import { isoDateInTimeZone, roleLabel } from "@/modules/sheet/present";

/**
 * The dialog's roles, in the Designer's order, and the staff role each one invites.
 * The Designer also lists "Practice manager", which is not a Casevoya role, so it is left out.
 * A firm owner is not invited from this dialog.
 */
export const STAFF_INVITE_ROLES = [
  ["Case manager", "case_manager"],
  ["Licensed consultant", "licensed_consultant"],
  ["Assistant", "assistant"],
  ["Finance", "finance_user"],
] as const;

export type StaffInviteRole = (typeof STAFF_INVITE_ROLES)[number][1];

/** Staff access is firm-wide: an invitation cannot be limited to one office. */
export const STAFF_INVITE_OFFICES = ["All offices"];

/** Expired invitations stay on the list this long, so they can be sent again. */
export const EXPIRED_SHOWN_DAYS = 30;

export const INVITE_DIALOG = "invite";

export type DirectoryMember = {
  membershipId: string;
  name: string | null;
  email: string | null;
  role: string;
  status: string;
  licensed: boolean;
  /** Null when the viewer may not see it (only a firm owner does). */
  twoStep: boolean | null;
};

export type PendingInvitation = {
  id: string;
  email: string;
  role: string;
  expiresAt: string;
  createdAt: string;
};

/** "Owner · Licensed consultant" for an owner who holds a licence; otherwise the role's own label. */
export function staffRoleCell(role: string, licensed: boolean): StaffRow["role"] {
  if (role === "firm_owner") return licensed ? { left: "Owner", right: "Licensed consultant" } : "Owner";
  return roleLabel(role);
}

function twoStepNote(value: boolean | null): string {
  if (value === true) return "Two-step on";
  if (value === false) return "Two-step not set up";
  return "Two-step required";
}

export function memberRow(member: DirectoryMember): StaffRow {
  const name = member.name || member.email || "Team member";
  return {
    person: staffPerson(name),
    name,
    email: member.email ?? "",
    role: staffRoleCell(member.role, member.licensed),
    state: member.status === "suspended" ? { tone: "chg", label: "Suspended" } : { tone: "ok", label: "Accepted" },
    note: twoStepNote(member.twoStep),
    action: { kind: "more" },
  };
}

/** Initials from the address's name part ("j.park@…" → "JP"): an invitee has no name yet. */
export function inviteePerson(email: string) {
  const local = email.split("@")[0] ?? "";
  return { name: local.replace(/[._+-]+/g, " ").trim() || email };
}

export function invitationRow(invite: PendingInvitation, now: Date, timeZone: string): StaffRow {
  const expires = dayMonth(isoDateInTimeZone(new Date(invite.expiresAt), timeZone));
  const expired = new Date(invite.expiresAt).getTime() <= now.getTime();
  return {
    person: inviteePerson(invite.email),
    name: invite.email,
    email: `Invited ${dayMonth(isoDateInTimeZone(new Date(invite.createdAt), timeZone))}`,
    role: roleLabel(invite.role),
    state: expired ? { tone: "chg", label: `Expired ${expires}` } : { tone: "rev", label: "Sent", detail: `expires ${expires}` },
    note: "Single use",
    action: expired ? { kind: "resend", invitationId: invite.id } : { kind: "revoke", invitationId: invite.id },
  };
}

/**
 * The team first (owners first, as the database orders them), then open invitations newest
 * first, then expired ones. An expired invitation is dropped once the same person has a newer
 * one for the same role.
 */
export function staffRows(members: readonly DirectoryMember[], invites: readonly PendingInvitation[], now: Date, timeZone: string): StaffRow[] {
  return [...members.map(memberRow), ...orderedInvitations(invites, now).map((row) => invitationRow(row, now, timeZone))];
}

/** Open invitations newest first, then the latest expired one per person and role. */
export function orderedInvitations(invites: readonly PendingInvitation[], now: Date): PendingInvitation[] {
  const at = now.getTime();
  const open = invites.filter((row) => new Date(row.expiresAt).getTime() > at).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const openKey = new Set(open.map((row) => `${row.email}|${row.role}`));
  const expired = invites
    .filter((row) => new Date(row.expiresAt).getTime() <= at && !openKey.has(`${row.email}|${row.role}`))
    .sort((a, b) => b.expiresAt.localeCompare(a.expiresAt));
  const seen = new Set<string>();
  const latestExpired = expired.filter((row) => {
    const key = `${row.email}|${row.role}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return [...open, ...latestExpired];
}

/** "name@<domain>" from the signed-in person's own address, the way the Designer shows the firm's domain. */
export function emailPlaceholder(ownEmail: string | null | undefined): string {
  const domain = (ownEmail ?? "").split("@")[1]?.trim().toLowerCase();
  return domain && /^[^\s@]+\.[^\s@]+$/.test(domain) ? `name@${domain}` : "name@example.com";
}

/** When an invitation sent now expires ("24 Oct"): the database gives it 7 days. */
export function inviteExpiry(now: Date, timeZone: string): string {
  return dayMonth(isoDateInTimeZone(new Date(now.getTime() + 7 * 86_400_000), timeZone));
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function inviteRoleFor(label: string | null | undefined): StaffInviteRole | null {
  const match = STAFF_INVITE_ROLES.find(([name, role]) => name === label || role === label);
  return match ? match[1] : null;
}

/** What the dialog sends, or the first thing to fix. The database checks all of it again. */
export function readStaffInvite(fields: { email?: string | null; role?: string | null }): { input: { email: string; role: StaffInviteRole } } | { error: string } {
  const email = (fields.email ?? "").trim().toLowerCase();
  if (!email) return { error: "Add their work email." };
  if (email.length > 320 || !EMAIL.test(email)) return { error: "Enter a valid email address." };
  const role = inviteRoleFor((fields.role ?? "").trim());
  if (!role) return { error: "Choose a staff role." };
  return { input: { email, role } };
}

const STEP_UP_ERRORS = new Set([safeAccessError("step-up is required"), safeAccessError("aal2")]);

/** User-facing copy for a refused invite. Never passes a database message through. */
export function staffInviteError(message: string): string {
  if (/only a firm owner/i.test(message)) return "Only a firm owner can invite or remove staff.";
  if (/cannot be revoked/i.test(message)) return "That invitation was already used or revoked.";
  return safeAccessError(message);
}

export function needsStepUp(error: string | null | undefined): boolean {
  return Boolean(error && STEP_UP_ERRORS.has(error));
}

/** The step-up screen, coming back to the Staff tab with the dialog open again (`?dlg=invite`). */
export function staffStepUpLocation(pathname: string, search: string, reopen: boolean): string {
  const params = new URLSearchParams(search);
  if (reopen) params.set("dlg", INVITE_DIALOG);
  else params.delete("dlg");
  const query = params.toString();
  return `/mfa?step=6&next=${encodeURIComponent(`${pathname}${query ? `?${query}` : ""}`)}`;
}

/** The invitation link. The invitation email carries it; the owner gets it as a backup. */
export function inviteLink(origin: string, path: string): string {
  return `${origin.replace(/\/+$/, "")}${path}`;
}
