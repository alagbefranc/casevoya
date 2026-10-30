export const INVITATION_TOKEN_RE = /^[0-9a-f]{64}$/;

export function isInvitationToken(value: string): boolean {
  return INVITATION_TOKEN_RE.test(value);
}

/** One address: local@domain.tld, no whitespace and no second @. */
const EMAIL_SHAPE_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/**
 * Characters an address may not contain (the database refuses the same set: app.email_chars_ok):
 * < > " ' ` ( ) ; , \ and control characters.
 */
const EMAIL_FORBIDDEN_RE = /[<>"'`();,\\]/;

function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

/** Whether `value` (already trimmed) is an address Casevoya stores and shows. */
export function isAcceptableEmail(value: string): boolean {
  return value.length <= 320 && EMAIL_SHAPE_RE.test(value) && !EMAIL_FORBIDDEN_RE.test(value) && !hasControlChar(value);
}

export function normalizeEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  if (!isAcceptableEmail(email)) return null;
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
