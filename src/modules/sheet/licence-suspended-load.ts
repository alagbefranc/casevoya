import "server-only";
import type { SuspendedData, SuspendedTop } from "@/components/sheet/designer/licence-suspended";
import { createClient } from "@/lib/supabase/server";
import { matterNames } from "@/modules/sheet/chrome-load";
import { loadSheetHome } from "@/modules/sheet/home-load";
import { loadLicenceMembers } from "@/modules/sheet/licence-load";
import { SUSPENDED_NEW_TITLE, suspendedData, suspendedSummary, type SuspendedInput } from "@/modules/sheet/licence-suspended-present";
import type { SheetStaff } from "@/modules/sheet/load";
import { isoDateInTimeZone } from "@/modules/sheet/present";

const BLOCKED = ["revoked", "suspended", "inactive", "not_entitled"];
const READ = 200;

/** The signed-in staff member's own credential when its recorded check locks them, else null. */
export async function blockedCredential(staff: SheetStaff) {
  if (staff.role !== "licensed_consultant" && staff.role !== "firm_owner") return null;
  const supabase = await createClient({ organizationId: staff.organizationId });
  const { data } = await supabase
    .from("consultant_credentials")
    .select("status, college_id, checked_at, register_status, entitlement_to_practise, discipline_suspended, discipline_revoked")
    .eq("organization_id", staff.organizationId)
    .eq("membership_id", staff.membershipId)
    .maybeSingle();
  if (!data) return null;
  const blocked =
    BLOCKED.includes(data.status) ||
    data.discipline_revoked ||
    data.discipline_suspended ||
    data.register_status === "inactive" ||
    data.entitlement_to_practise === false;
  if (!blocked) return null;
  // The same precedence as app.record_licence_check, so the alert names the recorded result.
  const status = BLOCKED.includes(data.status)
    ? data.status
    : data.discipline_revoked
      ? "revoked"
      : data.discipline_suspended
        ? "suspended"
        : data.register_status === "inactive"
          ? "inactive"
          : "not_entitled";
  return { status, collegeId: data.college_id, checkedAt: data.checked_at };
}

/**
 * The Designer's licence-suspended home for a consultant (or licensed owner) whose own licence
 * check recorded an adverse result, or null when their licence does not lock them. Read as the
 * signed-in staff member: the matters are the ones they can read and are consultant on.
 */
export async function loadSheetLicenceSuspended(staff: SheetStaff, now: Date = new Date(), view: { month?: string; path?: string } = {}) {
  const credential = await blockedCredential(staff);
  if (!credential) return null;
  const supabase = await createClient({ organizationId: staff.organizationId });
  const org = staff.organizationId;
  const today = isoDateInTimeZone(now, staff.timezone);

  const [loaded, responsible, parties, members, credentials] = await Promise.all([
    loadSheetHome(staff, now, view),
    supabase.from("matters").select("id, reference").eq("organization_id", org).eq("responsible_consultant_membership_id", staff.membershipId).neq("stage", "closed").limit(READ),
    supabase.from("matter_participants").select("matter_id").eq("organization_id", org).eq("membership_id", staff.membershipId).eq("role", "consultant").limit(READ),
    loadLicenceMembers(supabase, org),
    supabase.from("consultant_credentials").select("membership_id, licence_type, status, checked_at").eq("organization_id", org).eq("status", "verified").limit(READ),
  ]);

  const ids = [...new Set([...(responsible.data ?? []).map((row) => row.id), ...(parties.data ?? []).map((row) => row.matter_id)])];
  const [open, deadlines, name] = await Promise.all([
    ids.length ? supabase.from("matters").select("id, reference").eq("organization_id", org).in("id", ids).neq("stage", "closed") : null,
    ids.length
      ? supabase.from("deadlines").select("matter_id, label, due_on").eq("organization_id", org).in("matter_id", ids).gte("due_on", today).order("due_on", { ascending: true }).limit(READ)
      : null,
    matterNames(supabase, org, ids),
  ]);
  const next = new Map<string, { label: string; dueOn: string }>();
  for (const row of deadlines?.data ?? []) {
    if (row.due_on && !next.has(row.matter_id)) next.set(row.matter_id, { label: row.label, dueOn: row.due_on });
  }

  const active = new Map(members.filter((member) => member.status === "active" && !member.isSelf).map((member) => [member.membershipId, member]));
  const input: SuspendedInput = {
    organizationId: org,
    membershipId: staff.membershipId,
    timeZone: staff.timezone,
    now,
    credential,
    matters: (open?.data ?? []).map((row) => ({ id: row.id, name: name(row.id), reference: row.reference, nextDeadline: next.get(row.id) ?? null })),
    targets: (credentials.data ?? [])
      .filter((row) => active.has(row.membership_id))
      .map((row) => ({ membershipId: row.membership_id, name: active.get(row.membership_id)?.name || "Consultant", licenceType: row.licence_type, checkedAt: row.checked_at })),
  };
  const suspended: SuspendedData = suspendedData(input);
  const top: SuspendedTop = { firmName: loaded.chrome.top.firmName, firmHref: loaded.chrome.top.firmHref, pills: loaded.chrome.top.pills.filter((pill): pill is string => typeof pill === "string"), newTitle: SUSPENDED_NEW_TITLE };
  return { ...loaded, home: { ...loaded.home, summary: suspendedSummary() }, suspended, top };
}
