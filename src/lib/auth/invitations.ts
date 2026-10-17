export const INVITATION_TOKEN_RE = /^[0-9a-f]{64}$/;

export function isInvitationToken(value: string): boolean {
  return INVITATION_TOKEN_RE.test(value);
}

export function normalizeEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

const STAFF_INVITE_ROLES = [
  "firm_owner",
  "licensed_consultant",
  "case_manager",
  "assistant",
  "finance_user",
] as const;

export type StaffInviteRole = (typeof STAFF_INVITE_ROLES)[number];

export function isStaffInviteRole(value: string): value is StaffInviteRole {
  return (STAFF_INVITE_ROLES as readonly string[]).includes(value);
}
