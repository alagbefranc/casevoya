import "server-only";
import type { GrantDialogData, GrantsData, GrantsTab } from "@/components/sheet/designer/grants";
import { createClient } from "@/lib/supabase/server";
import { loadSheetChrome } from "@/modules/sheet/chrome-load";
import { grantDialog, grantsData, readSupportAccess, type FirmGrant, type GrantChoice } from "@/modules/sheet/grants-present";
import { loadLicenceMembers } from "@/modules/sheet/licence-load";
import type { SheetStaff } from "@/modules/sheet/load";
import { isoDateInTimeZone } from "@/modules/sheet/present";

/**
 * The Designer's Access grants page, read as the signed-in staff member. The grant list, the
 * Support access tab (SEC-09) and the dialog's choices come from functions that answer a firm
 * owner at aal2 only; anyone else sees the honest empty states (and the database refuses their
 * writes).
 */
export async function loadSheetGrants(staff: SheetStaff, tab: GrantsTab, now: Date = new Date()) {
  const supabase = await createClient({ organizationId: staff.organizationId });
  const org = staff.organizationId;
  const owner = staff.role === "firm_owner";
  const [chrome, grants, choices, members, support] = await Promise.all([
    loadSheetChrome(staff, "/sheet/grants"),
    owner ? supabase.rpc("firm_access_grants", { p_organization_id: org }) : null,
    owner ? supabase.rpc("access_grant_choices", { p_organization_id: org }) : null,
    loadLicenceMembers(supabase, org),
    owner ? supabase.rpc("firm_support_access", { p_organization_id: org }) : null,
  ]);
  const rows: FirmGrant[] = (grants?.data ?? []).map((row) => ({
    id: row.id,
    kind: row.kind,
    granteeName: row.grantee_name,
    subjectName: row.subject_name,
    matterReference: row.matter_reference,
    purpose: row.purpose,
    grantedByName: row.granted_by_name,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  }));
  const options: GrantChoice[] = (choices?.data ?? []).map((row) => ({
    choice: row.choice,
    personId: row.person_id,
    personName: row.person_name,
    matterId: row.matter_id,
    matterReference: row.matter_reference,
  }));
  const supportAccess = support && !support.error ? readSupportAccess(support.data) : null;
  const page: GrantsData = grantsData(tab, rows, members, now, staff.timezone, supportAccess, owner ? org : undefined);
  const dialog: GrantDialogData = grantDialog(org, options, isoDateInTimeZone(now, staff.timezone));
  return { chrome, page, dialog };
}
