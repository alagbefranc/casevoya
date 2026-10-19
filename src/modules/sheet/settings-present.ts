/**
 * Pure helpers for the Sheet's Settings > Team and seats and Security tabs: the firm's team,
 * pending staff invitations, continuity contact and sign-in security in the Designer's words.
 * Nothing here invents a value: what the database doesn't hold is said plainly.
 */
import type { ContinuityData, SecurityData, SecurityRow, TeamData, TeamRow } from "@/components/sheet/designer/settings";
import { dayMonth } from "@/modules/sheet/home-present";
import { isoDateInTimeZone, roleLabel } from "@/modules/sheet/present";
import { orderedInvitations, type DirectoryMember, type PendingInvitation } from "@/modules/sheet/staff-present";

/** Staff access is firm-wide: no membership or invitation is tied to one office. */
export const ALL_OFFICES = "All offices";

/** One staff member's sign-in security (public.firm_staff_security, firm owner only). */
export type MemberSecurity = {
  membershipId: string;
  secondFactor: boolean;
  /** Null when the passkey table can't be read. */
  passkeys: number | null;
  activeSessions: number | null;
  lastActiveAt: string | null;
};

export type ContinuityFacts = {
  name: string | null;
  email: string | null;
  succession: string | null;
};

/** "Plan: Trial". No plan name is stored, so an active subscription shows no plan pill. */
export function planPill(status: string | null | undefined): string | null {
  if (status === "trial") return "Plan: Trial";
  if (status === "trial_ended") return "Plan: Trial ended";
  if (status === "cancelled") return "Plan: Cancelled";
  return null;
}

/** "On", "Passkey", "Not set up", or plain "Required" when the viewer can't see it. */
export function twoStepCell(member: DirectoryMember, security: MemberSecurity | undefined): TeamRow["twoStep"] {
  if (security) {
    if (security.secondFactor) return { badge: { tone: "ok", label: "On" } };
    if (security.passkeys && security.passkeys > 0) return { badge: { tone: "ok", label: "Passkey" } };
    if (security.passkeys === 0) return { badge: { tone: "chg", label: "Not set up" } };
    return { text: "Required" };
  }
  if (member.twoStep === true) return { badge: { tone: "ok", label: "On" } };
  return { text: "Required" };
}

function roleCell(role: string, licensed: boolean): TeamRow["role"] {
  if (role === "firm_owner") return licensed ? ["Owner", "Licensed consultant"] : "Owner";
  return roleLabel(role);
}

export function memberTeamRow(member: DirectoryMember, security: MemberSecurity | undefined): TeamRow {
  return {
    name: member.name || member.email || "Team member",
    role: roleCell(member.role, member.licensed),
    office: ALL_OFFICES,
    twoStep: twoStepCell(member, security),
    seat: member.status === "suspended" ? "Suspended" : "Staff seat",
  };
}

export function invitationTeamRow(invite: PendingInvitation, now: Date, timeZone: string): TeamRow {
  const expires = dayMonth(isoDateInTimeZone(new Date(invite.expiresAt), timeZone));
  const expired = new Date(invite.expiresAt).getTime() <= now.getTime();
  return {
    name: invite.email,
    role: roleLabel(invite.role),
    office: ALL_OFFICES,
    twoStep: { text: "Set up on joining" },
    seat: expired ? `Invitation expired ${expires}` : ["Invited", `expires ${expires}`],
  };
}

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * "4 staff seats in use, 1 invitation waiting. Clients and family don’t use a seat." No seat
 * allowance is stored for any plan, so none is claimed.
 */
export function teamSummary(members: readonly DirectoryMember[], openInvites: number): string {
  const active = members.filter((member) => member.status === "active").length;
  const suspended = members.length - active;
  const parts = [`${plural(active, "staff seat", "staff seats")} in use`];
  if (suspended) parts.push(`${suspended} suspended`);
  if (openInvites) parts.push(`${plural(openInvites, "invitation", "invitations")} waiting`);
  return `${parts.join(", ")}. Clients and family don’t use a seat.`;
}

/** `canEdit`: a firm owner, who changes it through the Continuity contact dialog (#dlgCont). */
export function continuityData(facts: ContinuityFacts, canEdit = false): ContinuityData {
  const contact = facts.name && facts.email ? [facts.name, facts.email] : facts.name || facts.email || "Not named yet";
  return {
    intro:
      "The person your firm names to look after client files if the owner can’t practise, or when the firm closes. Casevoya keeps the name on record; it never moves a client’s file on its own.",
    pairs: [
      { label: "Continuity contact", value: contact },
      { label: "Succession note", value: facts.succession?.trim() || "None recorded" },
    ],
    ...(canEdit ? { actions: { change: { dialog: "dlgCont" } } } : {}),
    note: canEdit
      ? "Changing it asks you to confirm it’s you, and the change is logged. Clients aren’t notified."
      : "Only a firm owner can change the continuity contact.",
  };
}

/** The team (owners first), then open invitations newest first, then recently expired ones. */
export function teamData(input: {
  members: readonly DirectoryMember[];
  security: readonly MemberSecurity[];
  invites: readonly PendingInvitation[];
  continuity: ContinuityFacts;
  canInvite: boolean;
  /** A firm owner with someone else on the team: Offboard someone, and Change role or access. */
  canManage?: boolean;
  now: Date;
  timeZone: string;
}): TeamData {
  const security = new Map(input.security.map((row) => [row.membershipId, row]));
  // Ordered and de-duplicated the way the Staff tab shows them.
  const invites = orderedInvitations(input.invites, input.now);
  const open = invites.filter((invite) => new Date(invite.expiresAt).getTime() > input.now.getTime()).length;
  return {
    summary: teamSummary(input.members, open),
    rows: [
      ...input.members.map((member) => memberTeamRow(member, security.get(member.membershipId))),
      ...invites.map((invite) => invitationTeamRow(invite, input.now, input.timeZone)),
    ],
    invite: input.canInvite,
    ...(input.canManage ? { offboard: true, manage: true } : {}),
    continuity: continuityData(input.continuity, input.canInvite),
  };
}

function lastActive(rows: readonly MemberSecurity[], timeZone: string): string | null {
  const latest = rows.map((row) => row.lastActiveAt).filter((at): at is string => Boolean(at)).sort().pop();
  return latest ? dayMonth(isoDateInTimeZone(new Date(latest), timeZone)) : null;
}

/**
 * The Security tab. Staff MFA and the download audit are enforced by the database for every firm;
 * support access and an idle timeout are not built, and say so. A firm owner also sees how many of
 * the team have a second factor or passkey, open sign-in sessions, and recent sign-in events.
 */
export function securityData(input: {
  owner: boolean;
  /** Staff members on the team (active and suspended). */
  members: number;
  security: readonly MemberSecurity[] | null;
  /** Two-step resets and ended sessions in the audit trail, last 30 days. Null when not readable. */
  events: number | null;
  timeZone: string;
}): SecurityData {
  const security = input.security;
  const known = security && security.length === input.members && security.every((row) => row.secondFactor || row.passkeys !== null);
  const covered = security ? security.filter((row) => row.secondFactor || (row.passkeys ?? 0) > 0).length : 0;
  const mfaDetail =
    input.owner && known ? `Required for every staff account · ${covered} of ${input.members} set up` : "Required for every staff account";
  const rows: SecurityRow[] = [
    { title: "Staff multi-factor authentication", detail: mfaDetail, badge: { tone: "ok", label: "On" } },
    {
      title: "Passkeys",
      detail:
        input.owner && security && security.every((row) => row.passkeys !== null)
          ? `A passkey counts as two-step sign-in · ${plural(security.filter((row) => (row.passkeys ?? 0) > 0).length, "person uses one", "people use one")}`
          : "A passkey counts as two-step sign-in",
      badge: { tone: "ok", label: "Allowed" },
    },
    {
      title: "Support access grant",
      detail: "Casevoya support can’t open your client files. Support grants aren’t built yet",
      badge: { tone: "gr", label: "None active" },
    },
    {
      title: "Session timeout",
      detail: "No idle timeout yet. Sessions end at sign-out, or when revoked or reset",
      badge: { tone: "gr", label: "Off" },
    },
    { title: "Download audit", detail: "Every document download is logged", badge: { tone: "ok", label: "On" } },
  ];
  if (input.owner && security && security.every((row) => row.activeSessions !== null)) {
    const open = security.reduce((sum, row) => sum + (row.activeSessions ?? 0), 0);
    const last = lastActive(security, input.timeZone);
    rows.push({
      title: "Signed-in sessions",
      detail: last ? `Open sessions across your team · last activity ${last}` : "Open sessions across your team",
      badge: { tone: "gr", label: plural(open, "session", "sessions") },
    });
  }
  if (input.owner && input.events !== null) {
    rows.push({
      title: "Sign-in security events",
      detail: "Two-step resets and ended sessions in the last 30 days, from the audit trail",
      badge: input.events ? { tone: "chg", label: plural(input.events, "event", "events") } : { tone: "gr", label: "None" },
    });
  }
  return { intro: "Staff sign-in, support access and session rules.", rows };
}

/** The audit actions the Security tab counts. */
export const SIGN_IN_EVENT_ACTIONS = ["mfa.staff_reset", "mfa.reset_requested", "mfa.sessions_revoked", "mfa.session_revoked"] as const;
