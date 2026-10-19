import "server-only";
import type { SecurityData, SettingsHeaderData, TeamData } from "@/components/sheet/designer/settings";
import type { ContinuityDialogData, MemberDialogData, OffboardDialogData } from "@/components/sheet/designer/settings-staff-admin";
import { createClient } from "@/lib/supabase/server";
import { loadSheetChrome } from "@/modules/sheet/chrome-load";
import type { SheetStaff } from "@/modules/sheet/load";
import { planPill, securityData, SIGN_IN_EVENT_ACTIONS, teamData, type MemberSecurity } from "@/modules/sheet/settings-present";
import { continuityDialog, memberDialog, offboardDialog, parseOffboardFacts, type OffboardFacts } from "@/modules/sheet/settings-staff-admin-present";
import { loadMembers } from "@/modules/sheet/staff-load";
import { EXPIRED_SHOWN_DAYS, type PendingInvitation } from "@/modules/sheet/staff-present";

type Client = Awaited<ReturnType<typeof createClient>>;

/** A firm's team and open invitations are small; this is a ceiling, not a page. */
const READ = 200;

/** Per-member sign-in security for a firm owner (public.firm_staff_security). Empty for anyone else. */
async function loadSecurity(supabase: Client, org: string, owner: boolean): Promise<MemberSecurity[] | null> {
  if (!owner) return null;
  const result = await supabase.rpc("firm_staff_security", { p_organization_id: org });
  if (result.error || !result.data) return null;
  return result.data.map((row) => ({
    membershipId: row.membership_id,
    secondFactor: row.second_factor,
    passkeys: row.passkeys,
    activeSessions: row.active_sessions,
    lastActiveAt: row.last_active_at,
  }));
}

/** What offboarding the first person would move (public.staff_offboarding_preview, firm owner). */
async function loadOffboardFacts(supabase: Client, org: string, membershipId: string | undefined): Promise<OffboardFacts | null> {
  if (!membershipId) return null;
  const result = await supabase.rpc("staff_offboarding_preview", { p_organization_id: org, p_membership_id: membershipId });
  return result.error ? null : parseOffboardFacts(result.data);
}

async function loadHeader(supabase: Client, staff: SheetStaff, tab: SettingsHeaderData["tab"]): Promise<SettingsHeaderData> {
  const subscription = await supabase.from("organization_subscriptions").select("status").eq("organization_id", staff.organizationId).maybeSingle();
  return { firmName: staff.organizationName, plan: planPill(subscription.data?.status), tab };
}

/**
 * Settings > Team and seats, read as the signed-in staff member so the database decides: the
 * directory gives emails and two-step state to a firm owner only, invitations are owner-only
 * (RLS), and firm_staff_security answers a firm owner only.
 */
export async function loadSheetSettingsTeam(staff: SheetStaff, now: Date = new Date()) {
  const supabase = await createClient({ organizationId: staff.organizationId });
  const org = staff.organizationId;
  const owner = staff.role === "firm_owner";
  const since = new Date(now.getTime() - EXPIRED_SHOWN_DAYS * 86_400_000).toISOString();
  const [chrome, header, members, security, invites, firm] = await Promise.all([
    loadSheetChrome(staff, "/sheet/settings"),
    loadHeader(supabase, staff, "team"),
    loadMembers(supabase, org),
    loadSecurity(supabase, org, owner),
    supabase
      .from("invitations")
      .select("id, email, role, expires_at, created_at")
      .eq("organization_id", org)
      .is("consumed_at", null)
      .is("revoked_at", null)
      .gte("expires_at", since)
      .order("created_at", { ascending: false })
      .limit(READ),
    supabase.from("organizations").select("continuity_contact_name, continuity_contact_email, succession_note").eq("id", org).maybeSingle(),
  ]);
  const others = members.filter((member) => member.membershipId !== staff.membershipId);
  const pending: PendingInvitation[] = (invites.data ?? []).map((row) => ({
    id: row.id,
    email: row.email,
    role: row.role,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  }));
  const continuity = {
    name: firm.data?.continuity_contact_name ?? null,
    email: firm.data?.continuity_contact_email ?? null,
    succession: firm.data?.succession_note ?? null,
  };
  const manage = owner && others.length > 0;
  const page: TeamData = teamData({
    members,
    security: security ?? [],
    invites: pending,
    continuity,
    canInvite: owner,
    canManage: manage,
    now,
    timeZone: staff.timezone,
  });
  // The owner's dialogs: the Designer's Offboard (#dlgOff), Change role or access, Continuity contact.
  let dialogs: { offboard: OffboardDialogData | null; member: MemberDialogData | null; continuity: ContinuityDialogData | null } | null = null;
  if (owner) {
    const facts = manage ? await loadOffboardFacts(supabase, org, others[0]?.membershipId) : null;
    const input = { organizationId: org, members, selfMembershipId: staff.membershipId };
    dialogs = {
      offboard: manage ? offboardDialog({ ...input, facts }) : null,
      member: manage ? memberDialog(input) : null,
      continuity: continuityDialog(org, continuity),
    };
  }
  return { chrome, header, page, dialogs };
}

/** Settings > Security: the firm's sign-in posture, with team-wide counts for a firm owner. */
export async function loadSheetSettingsSecurity(staff: SheetStaff, now: Date = new Date()) {
  const supabase = await createClient({ organizationId: staff.organizationId });
  const org = staff.organizationId;
  const owner = staff.role === "firm_owner";
  const since = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const [chrome, header, members, security, events] = await Promise.all([
    loadSheetChrome(staff, "/sheet/settings"),
    loadHeader(supabase, staff, "security"),
    loadMembers(supabase, org),
    loadSecurity(supabase, org, owner),
    owner
      ? supabase
          .from("audit_log")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", org)
          .in("action", [...SIGN_IN_EVENT_ACTIONS])
          .gte("occurred_at", since)
      : null,
  ]);
  const page: SecurityData = securityData({
    owner,
    members: members.length,
    security,
    events: events && !events.error ? (events.count ?? 0) : null,
    timeZone: staff.timezone,
  });
  return { chrome, header, page };
}
