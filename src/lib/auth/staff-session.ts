import { STAFF_ROLES } from "@/lib/tenant/roles";

/** Firm workspace routes. Portal-only sessions are not redirected here. */
const STAFF_AREA_PREFIXES = ["/app"];

const MFA_PATH = "/mfa";

export function isStaffRoleName(role: string): boolean {
  return (STAFF_ROLES as readonly string[]).includes(role);
}

export function isStaffArea(pathname: string): boolean {
  return STAFF_AREA_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/**
 * Optimistic gate for the proxy. Returns a /mfa redirect when a signed-in user
 * holds an active staff role and the session is not assured.
 * Assurance is aal2, or `public.session_mfa_satisfied()` (passkey login or a
 * consumed recovery code). Clients are not redirected. RLS remains the authority.
 */
export function staffMfaRedirectPath(input: {
  pathname: string;
  signedIn: boolean;
  currentAal: string | null | undefined;
  activeRoles: readonly string[];
  /** True when the database says this session already satisfies staff MFA. */
  mfaSatisfied?: boolean;
}): string | null {
  if (!input.signedIn) return null;
  if (!isStaffArea(input.pathname)) return null;
  if (input.currentAal === "aal2" || input.mfaSatisfied) return null;
  if (!input.activeRoles.some((role) => isStaffRoleName(role))) return null;
  const next = input.pathname.startsWith("/") && !input.pathname.startsWith("//") ? input.pathname : "/app";
  return `${MFA_PATH}?next=${encodeURIComponent(next)}`;
}
