import "server-only";
import type { RbarData, StatusbarData, TopBarData } from "@/components/sheet/designer/frame";
import type { HomeData, HomeTask } from "@/components/sheet/designer/home";
import type { SidebarData } from "@/components/sheet/designer/sidebar";
import { createClient } from "@/lib/supabase/server";
import type { SheetStaff } from "@/modules/sheet/load";
import { roleLabel } from "@/modules/sheet/present";
import { ago, dayMonth, greeting, isoDate, localNow, monthGrid, summary, taskBadge, zoneCity } from "@/modules/sheet/home-present";

export type SheetChrome = { sidebar: SidebarData; top: TopBarData; statusbar: StatusbarData };

/** What a firm activity looks like in the Designer's notification list. Other actions are not shown. */
export const NOTICE: Record<string, string> = {
  "document.uploaded": "Document uploaded",
  "document.reviewed": "Document reviewed",
  "document.request_created": "Document requested",
  "agreement.sent": "Agreement sent for signature",
  "agreement.signed": "Agreement signed",
  "agreement.executed": "Agreement fully signed",
  "agreement.quote_accepted": "Quote accepted",
  "email.received": "Email received",
  "email.bounced": "Email could not be delivered",
  "invitation.accepted": "Invitation accepted",
  "intake.submitted": "Questionnaire submitted",
  "matter.create": "Matter opened",
  "matter.stage_transition": "Matter stage changed",
  "matter.government_status_recorded": "Government status recorded",
  "task.overdue": "Task overdue",
  "deadline.confirmed": "Deadline confirmed",
};

const SOURCE: Record<string, string> = {
  document: "Documents",
  agreement: "Agreements",
  email: "Inbox",
  invitation: "Invitations",
  intake: "Intake",
  matter: "Matters",
  task: "Tasks",
  deadline: "Deadlines",
};

const OPEN_TASK = ["open", "blocked"] as const;

function plural(count: number, one: string, many: string) {
  return count === 1 ? one : many;
}

/**
 * Everything the Designer's frame and home need, read as the signed-in staff member so
 * row-level security decides what is visible. Features without a backend yet (Vo drafts,
 * leads, finance exceptions) report nothing rather than a made-up number.
 */
export async function loadSheetHome(staff: SheetStaff, now: Date = new Date()) {
  const supabase = await createClient({ organizationId: staff.organizationId });
  const org = staff.organizationId;
  const local = localNow(staff.timezone, now);
  const today = isoDate(local.year, local.month, local.day);
  const monthStart = isoDate(local.year, local.month, 1);
  const monthEnd = isoDate(local.year, local.month, new Date(Date.UTC(local.year, local.month, 0)).getUTCDate());
  const count = { count: "exact" as const, head: true };

  const [matterCount, recentMatters, openTasks, openCount, dueToday, upcoming, monthDeadlines, tentative, accepted, awaiting, requested, onHold, unsorted, activity] =
    await Promise.all([
      supabase.from("matters").select("id", count).eq("organization_id", org).neq("stage", "closed"),
      supabase.from("matters").select("id, title").eq("organization_id", org).order("updated_at", { ascending: false }).limit(2),
      supabase
        .from("tasks")
        .select("id, matter_id, title, status, due_on, owner_membership_id")
        .eq("organization_id", org)
        .in("status", [...OPEN_TASK])
        .order("due_on", { ascending: true, nullsFirst: false })
        .limit(8),
      supabase.from("tasks").select("id", count).eq("organization_id", org).in("status", [...OPEN_TASK]),
      supabase.from("tasks").select("id", count).eq("organization_id", org).in("status", [...OPEN_TASK]).eq("due_on", today),
      supabase.from("deadlines").select("id, matter_id, label, due_on, verification").eq("organization_id", org).gte("due_on", today).order("due_on", { ascending: true }).limit(20),
      supabase.from("deadlines").select("due_on").eq("organization_id", org).gte("due_on", monthStart).lte("due_on", monthEnd).limit(200),
      supabase.from("deadlines").select("id", count).eq("organization_id", org).eq("verification", "tentative").gte("due_on", today),
      supabase.from("document_versions").select("id", count).eq("organization_id", org).eq("upload_state", "clean").eq("review_state", "accepted"),
      supabase.from("document_versions").select("id", count).eq("organization_id", org).eq("upload_state", "clean").eq("review_state", "pending"),
      supabase.from("document_requests").select("id", count).eq("organization_id", org).eq("status", "open"),
      supabase.from("matters").select("id", count).eq("organization_id", org).eq("on_hold", true),
      supabase.from("inbound_inbox_items").select("id", count).eq("organization_id", org).eq("upload_state", "clean"),
      supabase
        .from("audit_log")
        .select("action, occurred_at")
        .eq("organization_id", org)
        .in("action", Object.keys(NOTICE))
        .eq("result", "success")
        .order("occurred_at", { ascending: false })
        .limit(3),
    ]);

  const tasks = openTasks.data ?? [];
  const deadlines = upcoming.data ?? [];
  const matterIds = [
    ...new Set([...(recentMatters.data ?? []).map((row) => row.id), ...tasks.map((row) => row.matter_id), ...deadlines.map((row) => row.matter_id)].filter((id): id is string => Boolean(id))),
  ];

  // Name each matter by its applicant, falling back to the matter title.
  const [participants, titles, members] = await Promise.all([
    matterIds.length
      ? supabase.from("matter_participants").select("matter_id, person_id, role").eq("organization_id", org).in("matter_id", matterIds).not("person_id", "is", null)
      : null,
    matterIds.length ? supabase.from("matters").select("id, title").eq("organization_id", org).in("id", matterIds) : null,
    supabase.from("memberships").select("id, user_id").eq("organization_id", org).eq("status", "active"),
  ]);
  const personIds = [...new Set((participants?.data ?? []).map((row) => row.person_id).filter((id): id is string => Boolean(id)))];
  const userIds = [...new Set((members.data ?? []).map((row) => row.user_id))];
  const [people, profiles] = await Promise.all([
    personIds.length ? supabase.from("persons").select("id, display_name").eq("organization_id", org).in("id", personIds) : null,
    userIds.length ? supabase.from("profiles").select("id, display_name").in("id", userIds) : null,
  ]);

  const personName = new Map((people?.data ?? []).map((row) => [row.id, row.display_name]));
  const matterTitle = new Map((titles?.data ?? []).map((row) => [row.id, row.title]));
  const applicant = new Map<string, string>();
  const ordered = [...(participants?.data ?? [])].sort((a, b) => Number(b.role === "applicant") - Number(a.role === "applicant"));
  for (const row of ordered) {
    const name = row.person_id ? personName.get(row.person_id) : undefined;
    if (name && !applicant.has(row.matter_id)) applicant.set(row.matter_id, name);
  }
  const matterName = (id: string | null) => (id ? applicant.get(id) || matterTitle.get(id) || "Matter" : "Firm task");
  const profileName = new Map((profiles?.data ?? []).map((row) => [row.id, row.display_name]));
  const memberName = new Map((members.data ?? []).map((row) => [row.id, profileName.get(row.user_id) || "Unassigned"]));

  const total = (result: { count: number | null }) => result.count ?? 0;
  const toReview = total(awaiting);
  const due = total(dueToday);
  const held = total(onHold);

  const sidebar: SidebarData = {
    active: "/sheet",
    counts: { tasks: total(openCount), inbox: total(unsorted) },
    pinned: (recentMatters.data ?? []).map((row) => ({ href: `/sheet/matters/${row.id}`, name: matterName(row.id) })),
    me: { name: staff.displayName, role: roleLabel(staff.role) },
    tiles: { documents: "/sheet/documents", invoices: "/sheet/finance" },
    newMatter: { href: "/sheet/matters?new=1" },
    createBoard: { href: "/sheet/queue" },
  };

  const nextByMatter = new Map<string, string>();
  for (const row of deadlines) {
    if (row.due_on && !nextByMatter.has(row.matter_id)) nextByMatter.set(row.matter_id, row.due_on);
  }

  const homeTasks: HomeTask[] = tasks.map((row) => ({
    href: row.matter_id ? `/sheet/matters/${row.matter_id}?tab=tasks` : "/sheet/tasks",
    title: row.title,
    who: matterName(row.matter_id),
    when: row.due_on === today ? "Today" : row.due_on ? dayMonth(row.due_on) : "No due date",
    badge: taskBadge(row.status, row.due_on, today),
    owner: { name: (row.owner_membership_id && memberName.get(row.owner_membership_id)) || "Unassigned" },
  }));

  const home: HomeData = {
    greeting: greeting(local.hour, staff.displayName),
    summary: summary(local, zoneCity(staff.timezone), toReview, total(tentative)),
    quick: {
      lead: "/sheet/pipeline",
      document: "/sheet/documents",
      consultation: "/sheet/consultations",
      invoice: "/sheet/finance",
      draft: "/sheet/drafts",
    },
    gauge: [
      { label: "Accepted by firm", count: total(accepted), color: "#0075DE" },
      { label: "Awaiting review", count: toReview, color: "#62aef0" },
      { label: "Requested", count: total(requested), color: "#d9d5d0" },
    ],
    needs: [
      { href: "/sheet/tasks", count: due, label: plural(due, "task due today", "tasks due today") },
      { href: "/sheet/matters?view=review", count: toReview, label: plural(toReview, "document awaiting review", "documents awaiting review") },
      { href: "/sheet/matters?view=blocked", count: held, label: plural(held, "blocked matter", "blocked matters") },
      { href: "/sheet/finance", count: 0, label: "financial exceptions" },
    ],
    byDeadline: [...nextByMatter].slice(0, 5).map(([matter, date]) => ({ href: `/sheet/matters/${matter}`, name: matterName(matter), date: dayMonth(date) })),
    tasks: homeTasks,
  };

  const marked = new Set((monthDeadlines.data ?? []).map((row) => Number((row.due_on ?? "").slice(8, 10))).filter((day) => day > 0));
  const rbar: RbarData = {
    ...monthGrid(local.year, local.month, local.day, marked),
    today: deadlines
      .filter((row) => row.due_on === today)
      .map((row) => ({
        time: "Due",
        title: row.label,
        who: matterName(row.matter_id),
        note: row.verification === "tentative" ? "Date not confirmed yet" : "Confirmed deadline",
        tentative: row.verification === "tentative",
        href: `/sheet/matters/${row.matter_id}`,
      })),
    notifications: (activity.data ?? []).map((row) => ({
      title: NOTICE[row.action] ?? row.action,
      source: SOURCE[row.action.split(".")[0]] ?? "Activity",
      ago: ago(row.occurred_at, now),
    })),
    vo: null,
  };

  const chrome: SheetChrome = {
    sidebar,
    top: { firmName: staff.organizationName, pills: [`Your matters: ${total(matterCount)}`] },
    statusbar: {
      timezone: staff.timezone,
      sample: staff.sampleMode ? { label: "Sample mode", detail: "practice records are marked sample" } : null,
    },
  };
  return { chrome, rbar, home };
}
