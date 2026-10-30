/**
 * Pure helpers for the Sheet's Staff tab (People and invitations): the team and pending
 * staff invitations in the Designer's words, what the Invite staff dialog sends, how the
 * database's refusals read, and where a step-up goes. The database decides every invite.
 */
import type { StaffRow } from "@/components/sheet/designer/invitations";
import { safeAccessError } from "@/lib/auth/step-up";
import { isAcceptableEmail } from "@/lib/auth/invitations";
import { staffPerson } from "@/modules/sheet/avatar";
import { dayMonth } from "@/modules/sheet/home-present";
import { isoDateInTimeZone, roleLabel } from "@/modules/sheet/present";
import { entitlementError } from "@/modules/subscription/errors";
import { stepUpHref } from "@/lib/auth/mfa-step";

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
  /** Set when the firm revoked it; kept on the list, greyed, for the record. */
  revokedAt?: string | null;
};

/** Why the invite dialog's Office field has one choice. */
export const STAFF_INVITE_OFFICE_HINT = "Staff access is firm-wide today, so an invitation isn’t tied to one office.";

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
    action: {
      kind: "more",
      go: `/sheet/settings?tab=team&dlg=dlgMem&member=${encodeURIComponent(member.membershipId)}`,
      title: "Change role or access in Settings › Team and seats",
    },
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
  const invited = `Invited ${dayMonth(isoDateInTimeZone(new Date(invite.createdAt), timeZone))}`;
  if (invite.revokedAt) {
    return {
      person: inviteePerson(invite.email),
      name: invite.email,
      email: invited,
      role: roleLabel(invite.role),
      state: { tone: "gr", label: `Revoked ${dayMonth(isoDateInTimeZone(new Date(invite.revokedAt), timeZone))}` },
      note: "The link no longer works",
      action: { kind: "none" },
      muted: true,
    };
  }
  return {
    person: inviteePerson(invite.email),
    name: invite.email,
    email: invited,
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

/**
 * Open invitations newest first, then the latest expired or revoked one per person and role.
 * A revoked invitation replaced by a newer one (Resend) isn't shown: the new one is.
 */
export function orderedInvitations(invites: readonly PendingInvitation[], now: Date): PendingInvitation[] {
  const at = now.getTime();
  const open = invites.filter((row) => !row.revokedAt && new Date(row.expiresAt).getTime() > at).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const openKey = new Set(open.map((row) => `${row.email}|${row.role}`));
  const ended = (row: PendingInvitation) => row.revokedAt ?? row.expiresAt;
  const expired = invites
    .filter((row) => (row.revokedAt || new Date(row.expiresAt).getTime() <= at) && !openKey.has(`${row.email}|${row.role}`))
    .sort((a, b) => ended(b).localeCompare(ended(a)));
  const seen = new Set<string>();
  const latestExpired = expired.filter((row) => {
    const key = `${row.email}|${row.role}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return [...open, ...latestExpired];
}

export type PortalInvitation = {
  id: string;
  personName: string | null;
  email: string;
  role: string;
  matterReference: string | null;
  expiresAt: string;
  createdAt: string;
  openedAt: string | null;
  consumedAt: string | null;
  revokedAt: string | null;
  declinedAt: string | null;
};

const PORTAL_ROLE: Record<string, string> = {
  client: "Applicant",
  adult_dependant: "Adult dependant",
  sponsor: "Sponsor",
  guardian: "Guardian",
  employer_contact: "Employer contact",
};

function portalRoleLabel(role: string): string {
  return PORTAL_ROLE[role] ?? role.replace(/_/g, " ").replace(/^./, (first) => first.toUpperCase());
}

/**
 * One client portal invitation on the Clients and family tab, in the Designer's words: accepted,
 * opened but not finished, sent (with its expiry), declined, expired (Resend) or revoked (greyed).
 */
export function portalInvitationRow(invite: PortalInvitation, organizationId: string, now: Date, timeZone: string): StaffRow {
  const day = (iso: string) => dayMonth(isoDateInTimeZone(new Date(iso), timeZone));
  const name = invite.personName || invite.email;
  const role = portalRoleLabel(invite.role);
  const base = {
    person: { name },
    name,
    email: invite.matterReference ? { left: role, right: invite.matterReference } : role,
    role,
  };
  if (invite.consumedAt) return { ...base, state: { tone: "ok", label: "Accepted" }, note: `Joined ${day(invite.consumedAt)}`, action: { kind: "none" } };
  if (invite.revokedAt) {
    return { ...base, state: { tone: "gr", label: `Revoked ${day(invite.revokedAt)}` }, note: "The link no longer works", action: { kind: "none" }, muted: true };
  }
  if (invite.declinedAt) return { ...base, state: { tone: "gr", label: `Declined ${day(invite.declinedAt)}` }, note: invite.email, action: { kind: "none" } };
  if (new Date(invite.expiresAt).getTime() <= now.getTime()) {
    return { ...base, state: { tone: "chg", label: `Expired ${day(invite.expiresAt)}` }, note: invite.email, action: { kind: "resend", invitationId: invite.id, portal: true, organizationId } };
  }
  return {
    ...base,
    state: invite.openedAt ? { tone: "unv", label: "Opened", detail: "not finished" } : { tone: "rev", label: "Sent", detail: `expires ${day(invite.expiresAt)}` },
    note: invite.email,
    action: { kind: "revoke", invitationId: invite.id, portal: true, organizationId },
  };
}

/** The firm's portal invitations, newest first. */
export function portalInvitationRows(invites: readonly PortalInvitation[], organizationId: string, now: Date, timeZone: string): StaffRow[] {
  return [...invites].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((row) => portalInvitationRow(row, organizationId, now, timeZone));
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

export function inviteRoleFor(label: string | null | undefined): StaffInviteRole | null {
  const match = STAFF_INVITE_ROLES.find(([name, role]) => name === label || role === label);
  return match ? match[1] : null;
}

/** What the dialog sends, or the first thing to fix. The database checks all of it again. */
export function readStaffInvite(fields: { email?: string | null; role?: string | null }): { input: { email: string; role: StaffInviteRole } } | { error: string } {
  const email = (fields.email ?? "").trim().toLowerCase();
  if (!email) return { error: "Add their work email." };
  if (!isAcceptableEmail(email)) return { error: "Enter a valid email address." };
  const role = inviteRoleFor((fields.role ?? "").trim());
  if (!role) return { error: "Choose a staff role." };
  return { input: { email, role } };
}

const STEP_UP_ERRORS = new Set([safeAccessError("step-up is required"), safeAccessError("aal2")]);

/** User-facing copy for a refused invite. Never passes a database message through. */
export function staffInviteError(message: string): string {
  const entitlement = entitlementError(message);
  if (entitlement) return entitlement;
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
  return stepUpHref(`${pathname}${query ? `?${query}` : ""}`, "staff_invite");
}

/** The invitation link. The invitation email carries it; the owner gets it as a backup. */
export function inviteLink(origin: string, path: string): string {
  return `${origin.replace(/\/+$/, "")}${path}`;
}
