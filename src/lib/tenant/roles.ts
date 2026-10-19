import type { Database } from "@/types/database.types";

export type OrgRole = Database["public"]["Enums"]["org_role"];

/** Mirrors app.staff_roles() in the database. */
export const STAFF_ROLES = [
  "firm_owner",
  "licensed_consultant",
  "case_manager",
  "assistant",
  "finance_user",
] as const satisfies readonly OrgRole[];

export function isStaffRole(role: OrgRole): boolean {
  return (STAFF_ROLES as readonly OrgRole[]).includes(role);
}

/** Roles app.membership_is_licensed() counts (decision 2026-10-19: owners are regulated consultants). */
const LICENSED_ROLES: ReadonlySet<string> = new Set(["licensed_consultant", "firm_owner"]);

/** The consultant_credentials columns the Sheet reads for a member's licence. */
export const LICENCE_FACT_COLUMNS = "status, discipline_revoked, discipline_suspended, register_status, entitlement_to_practise";

export type LicenceFacts = {
  status: string;
  discipline_revoked: boolean;
  discipline_suspended: boolean;
  register_status: string | null;
  entitlement_to_practise: boolean | null;
};

/**
 * Mirrors app.membership_is_licensed() for an active membership: a licensed consultant or a firm
 * owner. Owners are regulated consultants and have every staff ability, regulated actions included
 * (decision 2026-10-19). As for a licensed consultant, a blocked credential (revoked, suspended,
 * inactive, not entitled) is still refused by the database's licence locks. The database decides
 * every licensed action; this only chooses which controls to offer.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept so callers that fetch the credential stay unchanged
export function isLicensedMembership(role: string, _credential?: LicenceFacts | null): boolean {
  return LICENSED_ROLES.has(role);
}
