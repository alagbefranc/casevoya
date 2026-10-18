import "server-only";
import type { StaffData, StaffInviteDialogData } from "@/components/sheet/designer/invitations";
import { createClient } from "@/lib/supabase/server";
import { loadSheetChrome } from "@/modules/sheet/chrome-load";
import type { SheetStaff } from "@/modules/sheet/load";
import {
  EXPIRED_SHOWN_DAYS,
  STAFF_INVITE_OFFICES,
  STAFF_INVITE_ROLES,
  emailPlaceholder,
  inviteExpiry,
  staffRows,
  type DirectoryMember,
  type PendingInvitation,
} from "@/modules/sheet/staff-present";

type Client = Awaited<ReturnType<typeof createClient>>;

/** Rows read. A firm's team and open invitations are small; this is a ceiling, not a page. */
const READ = 200;

/**
 * The firm's staff through public.firm_staff_directory (names, roles, licence; emails and
 * two-step status for a firm owner). Until that function is deployed, the memberships and
 * profiles the viewer can read stand in, without emails.
 */
export async function loadMembers(supabase: Client, org: string): Promise<DirectoryMember[]> {
  const directory = await supabase.rpc("firm_staff_directory", { p_organization_id: org });
  if (!directory.error && directory.data) {
    return directory.data.map((row) => ({
      membershipId: row.membership_id,
      name: row.display_name,
      email: row.email,
      role: row.role,
      status: row.status,
      licensed: row.is_licensed,
      twoStep: row.two_step,
    }));
  }
  const members = await supabase
    .from("memberships")
    .select("id, user_id, role, status")
    .eq("organization_id", org)
    .in("role", ["firm_owner", "licensed_consultant", "case_manager", "assistant", "finance_user"])
    .in("status", ["active", "suspended"])
    .order("created_at", { ascending: true })
    .limit(READ);
  const rows = members.data ?? [];
  const userIds = [...new Set(rows.map((row) => row.user_id))];
  const profiles = userIds.length ? await supabase.from("profiles").select("id, display_name").in("id", userIds) : null;
  const name = new Map((profiles?.data ?? []).map((row) => [row.id, row.display_name]));
  return [...rows]
    .sort((a, b) => Number(b.role === "firm_owner") - Number(a.role === "firm_owner"))
    .map((row) => ({
      membershipId: row.id,
      name: name.get(row.user_id) ?? null,
      email: null,
      role: row.role,
      status: row.status,
      licensed: row.role === "licensed_consultant",
      twoStep: null,
    }));
}

/**
 * The Designer's Staff tab for a firm, read as the signed-in staff member so the database
 * decides what is visible: only a firm owner reads invitations (RLS) and staff emails.
 */
export async function loadSheetStaffTab(staff: SheetStaff, now: Date = new Date()) {
  const supabase = await createClient({ organizationId: staff.organizationId });
  const org = staff.organizationId;
  const since = new Date(now.getTime() - EXPIRED_SHOWN_DAYS * 86_400_000).toISOString();

  const [chrome, members, invites, claims] = await Promise.all([
    loadSheetChrome(staff, "/sheet/invitations"),
    loadMembers(supabase, org),
    supabase
      .from("invitations")
      .select("id, email, role, expires_at, created_at")
      .eq("organization_id", org)
      .is("consumed_at", null)
      .is("revoked_at", null)
      .gte("expires_at", since)
      .order("created_at", { ascending: false })
      .limit(READ),
    supabase.auth.getClaims(),
  ]);

  const pending: PendingInvitation[] = (invites.data ?? []).map((row) => ({
    id: row.id,
    email: row.email,
    role: row.role,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  }));
  const ownEmail = typeof claims.data?.claims?.email === "string" ? claims.data.claims.email : null;

  const page: StaffData = {
    firmName: staff.organizationName,
    rows: staffRows(members, pending, now, staff.timezone),
  };
  const dialog: StaffInviteDialogData = {
    organizationId: org,
    placeholder: emailPlaceholder(ownEmail),
    roles: STAFF_INVITE_ROLES.map(([label]) => label),
    offices: STAFF_INVITE_OFFICES,
    expires: inviteExpiry(now, staff.timezone),
  };
  return { chrome, page, dialog };
}
