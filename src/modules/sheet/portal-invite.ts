/**
 * Pure helpers for the matter page's "Invite to the portal" dialog (the Designer's dialog
 * from Settings > People and invitations, opened from a person card on the People tab):
 * which role a participant is invited as, what the dialog sends, where the person accepts,
 * and where a step-up goes. public.create_portal_invitation decides every invitation.
 */
import type { PortalInviteRole } from "@/modules/portal-invitations/types";
import { readBirthDate, todayIso } from "@/modules/sheet/birth-date";
import { dayMonth } from "@/modules/sheet/home-present";
import { isoDateInTimeZone } from "@/modules/sheet/present";

/** The Designer's "Their role" options, in its order. The option text is what the dialog reads. */
export const PORTAL_ROLE_OPTIONS: readonly (readonly [PortalInviteRole, string])[] = [
  ["adult_dependant", "Adult dependant"],
  ["client", "Applicant"],
  ["sponsor", "Sponsor"],
  ["guardian", "Guardian"],
  ["employer_contact", "Employer contact"],
];

/** app.portal_role_party, the other way round: the portal role a matter participant is invited as. */
const PARTY_PORTAL_ROLE: Record<string, PortalInviteRole> = {
  applicant: "client",
  dependant: "adult_dependant",
  sponsor: "sponsor",
  employer: "employer_contact",
  guardian: "guardian",
};

export function portalRoleForParty(partyRole: string): PortalInviteRole | null {
  return PARTY_PORTAL_ROLE[partyRole] ?? null;
}

export function portalRoleLabel(role: PortalInviteRole): string {
  return PORTAL_ROLE_OPTIONS.find(([value]) => value === role)?.[1] ?? "";
}

export function portalRoleFromLabel(label: string | null | undefined): PortalInviteRole | null {
  const text = (label ?? "").trim();
  return PORTAL_ROLE_OPTIONS.find(([, name]) => name === text)?.[0] ?? null;
}

/** The accept screen for each role. Adult dependants, guardians and employer contacts use the family screen. */
export function acceptPath(role: PortalInviteRole): string {
  if (role === "client") return "/accept/client";
  if (role === "sponsor") return "/accept/sponsor";
  return "/accept/family";
}

/** The private link the invitee opens. The invitation email carries it sealed; the inviter gets it as a backup. */
export function acceptLink(origin: string, role: PortalInviteRole, token: string): string {
  const path = `${acceptPath(role)}?token=${encodeURIComponent(token)}`;
  return origin ? `${origin.replace(/\/+$/, "")}${path}` : path;
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PortalInviteInput = {
  personId: string;
  role: PortalInviteRole;
  email: string;
  /** `YYYY-MM-DD` to save on the person first, when they had none; otherwise null. */
  dateOfBirth: string | null;
};

/**
 * What the dialog sends, or the first thing to fix. The database checks all of it again.
 * `dateOfBirth` is a string only when the dialog asked for it (the person has none on file);
 * then it is required, because public.create_portal_invitation refuses anyone without one.
 */
export function readPortalInvite(fields: {
  personId?: string | null;
  roleLabel?: string | null;
  email?: string | null;
  dateOfBirth?: string | null;
  /** `YYYY-MM-DD`; defaults to today in UTC. */
  today?: string;
}): { input: PortalInviteInput } | { error: string } {
  const personId = (fields.personId ?? "").trim();
  const role = portalRoleFromLabel(fields.roleLabel);
  const email = (fields.email ?? "").trim().toLowerCase();
  if (!UUID.test(personId)) return { error: "Open the invitation from a person on this matter." };
  if (!role) return { error: "Choose their role." };
  if (!email) return { error: "Add their email address." };
  if (!EMAIL.test(email) || email.length > 320) return { error: "Enter a valid email address." };
  let dateOfBirth: string | null = null;
  if (typeof fields.dateOfBirth === "string") {
    const birth = readBirthDate(fields.dateOfBirth, fields.today ?? todayIso());
    if ("error" in birth) return { error: birth.error };
    if (!birth.date) return { error: "Add their date of birth. Only adults get a portal login." };
    dateOfBirth = birth.date;
  }
  return { input: { personId, role, email, dateOfBirth } };
}

/**
 * The minors a guardian on this matter is invited for: the matter's applicant or dependants who
 * are minors (the dialog has no field to pick them). The database checks each is a minor on
 * this matter, and the authority stops when they turn adult. At most 10, as the database allows.
 */
export function guardianSubjects(guardianId: string, minorsOnMatter: readonly string[]): string[] {
  return [...new Set(minorsOnMatter)].filter((id) => id !== guardianId).slice(0, 10);
}

/**
 * The step-up screen, coming back to this matter with the invitation open again for the
 * same person (`?dlg=invite&pid=`).
 */
export function inviteStepUpLocation(pathname: string, search: string, personId: string): string {
  const params = new URLSearchParams(search);
  params.set("dlg", "invite");
  params.set("pid", personId);
  return `/mfa?step=6&next=${encodeURIComponent(`${pathname}?${params.toString()}`)}`;
}

/** The same URL without the reopen flags. */
export function withoutInvite(pathname: string, search: string): string {
  const params = new URLSearchParams(search);
  params.delete("dlg");
  params.delete("pid");
  const query = params.toString();
  return `${pathname}${query ? `?${query}` : ""}`;
}

/** "25 Oct" from the invitation's expiry, as a calendar date in `timeZone`. */
export function expiryLabel(expiresAt: string | null | undefined, timeZone: string): string | null {
  if (!expiresAt) return null;
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) return null;
  try {
    return dayMonth(isoDateInTimeZone(date, timeZone));
  } catch {
    return null;
  }
}
