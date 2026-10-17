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
