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

/** Mirrors app.licence_status_blocks() in the database. */
const BLOCKING_LICENCE_STATUSES: ReadonlySet<string> = new Set(["revoked", "suspended", "inactive", "not_entitled"]);

/** The consultant_credentials columns that decide whether an owner's licence counts. */
export const LICENCE_FACT_COLUMNS = "status, discipline_revoked, discipline_suspended, register_status, entitlement_to_practise";

export type LicenceFacts = {
  status: string;
  discipline_revoked: boolean;
  discipline_suspended: boolean;
  register_status: string | null;
  entitlement_to_practise: boolean | null;
};

/**
 * Mirrors app.membership_is_licensed() for an active membership: a licensed consultant, or a
 * firm owner whose own CICC credential is not revoked, suspended, inactive, or not entitled.
 * The database still decides every licensed action; this only chooses which controls to offer.
 */
export function isLicensedMembership(role: string, credential: LicenceFacts | null | undefined): boolean {
  if (role === "licensed_consultant") return true;
  if (role !== "firm_owner" || !credential) return false;
  return (
    !BLOCKING_LICENCE_STATUSES.has(credential.status) &&
    !credential.discipline_revoked &&
    !credential.discipline_suspended &&
    credential.register_status !== "inactive" &&
    credential.entitlement_to_practise !== false
  );
}
