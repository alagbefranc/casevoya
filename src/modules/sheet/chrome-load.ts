import "server-only";
import type { StatusbarData, TopBarData } from "@/components/sheet/designer/frame";
import type { SidebarData } from "@/components/sheet/designer/sidebar";
import { createClient } from "@/lib/supabase/server";
import { staffPerson } from "@/modules/sheet/avatar";
import type { SheetStaff } from "@/modules/sheet/load";
import { roleLabel } from "@/modules/sheet/present";

export type SheetChrome = { sidebar: SidebarData; top: TopBarData; statusbar: StatusbarData };

type Client = Awaited<ReturnType<typeof createClient>>;

const OPEN_TASK = ["open", "blocked"] as const;

/** Name each matter by its applicant, falling back to the matter title. */
export async function matterNames(supabase: Client, org: string, ids: string[]): Promise<(id: string | null) => string> {
  const matterIds = [...new Set(ids)];
  const [participants, titles] = await Promise.all([
    matterIds.length
      ? supabase.from("matter_participants").select("matter_id, person_id, role").eq("organization_id", org).in("matter_id", matterIds).not("person_id", "is", null)
      : null,
    matterIds.length ? supabase.from("matters").select("id, title").eq("organization_id", org).in("id", matterIds) : null,
  ]);
  const personIds = [...new Set((participants?.data ?? []).map((row) => row.person_id).filter((id): id is string => Boolean(id)))];
  const people = personIds.length ? await supabase.from("persons").select("id, display_name").eq("organization_id", org).in("id", personIds) : null;

  const personName = new Map((people?.data ?? []).map((row) => [row.id, row.display_name]));
  const matterTitle = new Map((titles?.data ?? []).map((row) => [row.id, row.title]));
  const applicant = new Map<string, string>();
  const ordered = [...(participants?.data ?? [])].sort((a, b) => Number(b.role === "applicant") - Number(a.role === "applicant"));
  for (const row of ordered) {
    const name = row.person_id ? personName.get(row.person_id) : undefined;
    if (name && !applicant.has(row.matter_id)) applicant.set(row.matter_id, name);
  }
  return (id) => (id ? applicant.get(id) || matterTitle.get(id) || "Matter" : "Firm task");
}

/** Display names for the firm's active staff, keyed by membership id. */
export async function memberNames(supabase: Client, org: string): Promise<Map<string, string>> {
  const members = await supabase.from("memberships").select("id, user_id").eq("organization_id", org).eq("status", "active");
  const userIds = [...new Set((members.data ?? []).map((row) => row.user_id))];
  const profiles = userIds.length ? await supabase.from("profiles").select("id, display_name").in("id", userIds) : null;
  const profileName = new Map((profiles?.data ?? []).map((row) => [row.id, row.display_name]));
  return new Map((members.data ?? []).map((row) => [row.id, profileName.get(row.user_id) || "Unassigned"]));
}

/**
 * The Designer's sidebar, top bar and status bar for a firm, read as the signed-in staff
 * member. Features without a backend yet (Vo drafts, leads, finance exceptions) show no count.
 */
export async function loadSheetChrome(staff: SheetStaff, active: string): Promise<SheetChrome> {
  const supabase = await createClient({ organizationId: staff.organizationId });
  const org = staff.organizationId;
  const count = { count: "exact" as const, head: true };
  const [matterCount, recentMatters, openCount, unsorted] = await Promise.all([
    supabase.from("matters").select("id", count).eq("organization_id", org).neq("stage", "closed"),
    supabase.from("matters").select("id").eq("organization_id", org).order("updated_at", { ascending: false }).limit(2),
    supabase.from("tasks").select("id", count).eq("organization_id", org).in("status", [...OPEN_TASK]),
    supabase.from("inbound_inbox_items").select("id", count).eq("organization_id", org).eq("upload_state", "clean"),
  ]);
  const pinned = (recentMatters.data ?? []).map((row) => row.id);
  const name = await matterNames(supabase, org, pinned);

  return {
    sidebar: {
      active,
      counts: { tasks: openCount.count ?? 0, inbox: unsorted.count ?? 0 },
      pinned: pinned.map((id) => ({ href: `/sheet/matters/${id}`, name: name(id) })),
      me: { ...staffPerson(staff.displayName), role: roleLabel(staff.role) },
      tiles: { documents: "/sheet/documents", invoices: "/sheet/finance" },
      newMatter: { href: "/sheet/matters?new=1" },
      createBoard: { href: "/sheet/queue" },
    },
    top: { firmName: staff.organizationName, pills: [`Your matters: ${matterCount.count ?? 0}`] },
    statusbar: {
      timezone: staff.timezone,
      sample: staff.sampleMode ? { label: "Sample mode", detail: "practice records are marked sample" } : null,
    },
  };
}
