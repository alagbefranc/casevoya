import "server-only";
import type { RbarData } from "@/components/sheet/designer/frame";
import type { HomeData, HomeTask } from "@/components/sheet/designer/home";
import { createClient } from "@/lib/supabase/server";
import { staffPerson } from "@/modules/sheet/avatar";
import { loadSheetChrome, matterNames, memberNames } from "@/modules/sheet/chrome-load";
import type { SheetStaff } from "@/modules/sheet/load";
import { missingPolicies } from "@/modules/portal-policies/defaults";
import { loadCurrentPolicies } from "@/modules/portal-policies/load";
import { NOTICE, ago, dayMonth, greeting, isoDate, localNow, monthGrid, summary, taskBadge, zoneCity } from "@/modules/sheet/home-present";
import {
  HOME_QUICK,
  HOME_TASK_READ,
  TASKS_PAGE,
  activityMatter,
  calendarDayHref,
  homeMonth,
  homeTaskTokens,
  monthNav,
  notificationHref,
} from "@/modules/sheet/home-controls";

const SOURCE: Record<string, string> = {
  document: "Documents",
  agreement: "Agreements",
  email: "Inbox",
  invitation: "Invitations",
  intake: "Intake",
  matter: "Matters",
  task: "Tasks",
  deadline: "Deadlines",
  firm: "Sample case",
};

const OPEN_TASK = ["open", "blocked"] as const;

function plural(count: number, one: string, many: string) {
  return count === 1 ? one : many;
}

/**
 * Everything the Designer's frame and home need, read as the signed-in staff member so
 * row-level security decides what is visible. Features without a backend yet (Vo drafts,
 * leads) report nothing rather than a made-up number. Financial exceptions are client-account
 * withdrawals past their CICC Code s. 32(g) date.
 *
 * `month` (`YYYY-MM`, from `?month=`) is the month the right column's calendar shows; its arrows
 * link to `path` with the month before and after.
 */
export async function loadSheetHome(staff: SheetStaff, now: Date = new Date(), view: { month?: string; path?: string } = {}) {
  const supabase = await createClient({ organizationId: staff.organizationId });
  const org = staff.organizationId;
  const local = localNow(staff.timezone, now);
  const today = isoDate(local.year, local.month, local.day);
  const shown = homeMonth(view.month, { year: local.year, month: local.month });
  const thisMonth = shown.year === local.year && shown.month === local.month;
  const monthStart = isoDate(shown.year, shown.month, 1);
  const monthEnd = isoDate(shown.year, shown.month, new Date(Date.UTC(shown.year, shown.month, 0)).getUTCDate());
  const count = { count: "exact" as const, head: true };
  // Clients can't accept an invitation until the firm publishes both portal documents.
  const policies = loadCurrentPolicies(supabase, org);

  const [chrome, openTasks, dueToday, upcoming, monthDeadlines, tentative, accepted, awaiting, requested, onHold, activity, withdrawals] =
    await Promise.all([
      loadSheetChrome(staff, "/sheet"),
      supabase
        .from("tasks")
        .select("id, matter_id, title, status, due_on, owner_membership_id")
        .eq("organization_id", org)
        .in("status", [...OPEN_TASK])
        .order("due_on", { ascending: true, nullsFirst: false })
        // Enough for the task bar's Mine and Today to find the viewer's tasks; it shows 8 at once.
        .limit(HOME_TASK_READ),
      supabase.from("tasks").select("id", count).eq("organization_id", org).in("status", [...OPEN_TASK]).eq("due_on", today),
      supabase.from("deadlines").select("id, matter_id, label, due_on, verification").eq("organization_id", org).gte("due_on", today).order("due_on", { ascending: true }).limit(20),
      supabase.from("deadlines").select("due_on").eq("organization_id", org).gte("due_on", monthStart).lte("due_on", monthEnd).limit(200),
      supabase.from("deadlines").select("id", count).eq("organization_id", org).eq("verification", "tentative").gte("due_on", today),
      supabase.from("document_versions").select("id", count).eq("organization_id", org).eq("upload_state", "clean").eq("review_state", "accepted"),
      supabase.from("document_versions").select("id", count).eq("organization_id", org).eq("upload_state", "clean").eq("review_state", "pending"),
      supabase.from("document_requests").select("id", count).eq("organization_id", org).eq("status", "open"),
      supabase.from("matters").select("id", count).eq("organization_id", org).eq("on_hold", true),
      supabase
        .from("audit_log")
        .select("action, occurred_at, object_table, object_id, context")
        .eq("organization_id", org)
        .in("action", Object.keys(NOTICE))
        .eq("result", "success")
        .order("occurred_at", { ascending: false })
        .limit(3),
      supabase.rpc("list_client_fund_withdrawals"),
    ]);
  const overdueWithdrawals = (withdrawals.data ?? []).filter((row) => row.organization_id === org && row.overdue).length;

  const tasks = openTasks.data ?? [];
  const deadlines = upcoming.data ?? [];
  const [matterName, memberName] = await Promise.all([
    matterNames(supabase, org, [...tasks.map((row) => row.matter_id), ...deadlines.map((row) => row.matter_id)].filter((id): id is string => Boolean(id))),
    memberNames(supabase, org),
  ]);
  const ownerOf = (id: string | null) => {
    const name = id ? memberName.get(id) : undefined;
    return name ? staffPerson(name) : { name: "Unassigned" };
  };

  const total = (result: { count: number | null }) => result.count ?? 0;
  const toReview = total(awaiting);
  const due = total(dueToday);
  const held = total(onHold);

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
    owner: ownerOf(row.owner_membership_id),
    f: homeTaskTokens(row, staff.membershipId, today),
  }));

  const home: HomeData = {
    greeting: greeting(local.hour, staff.displayName),
    summary: summary(local, zoneCity(staff.timezone), toReview, total(tentative)),
    quick: { ...HOME_QUICK },
    gauge: [
      { label: "Accepted by firm", count: total(accepted), color: "#0075DE" },
      { label: "Awaiting review", count: toReview, color: "#62aef0" },
      { label: "Requested", count: total(requested), color: "#d9d5d0" },
    ],
    needs: [
      { href: "/sheet/tasks", count: due, label: plural(due, "task due today", "tasks due today") },
      { href: "/sheet/matters?view=review", count: toReview, label: plural(toReview, "document awaiting review", "documents awaiting review") },
      { href: "/sheet/matters?view=blocked", count: held, label: plural(held, "blocked matter", "blocked matters") },
      // Client-account withdrawals past the CICC Code s. 32(g) date (invoice date + 30 days). Billing
      // staff only: the function returns no rows to anyone else.
      { href: "/sheet/finance?tab=funds", count: overdueWithdrawals, label: plural(overdueWithdrawals, "financial exception", "financial exceptions") },
    ],
    byDeadline: [...nextByMatter].slice(0, 5).map(([matter, date]) => ({ href: `/sheet/matters/${matter}`, name: matterName(matter), date: dayMonth(date) })),
    tasks: homeTasks,
    bar: { filterHref: TASKS_PAGE },
  };

  const marked = new Set((monthDeadlines.data ?? []).map((row) => Number((row.due_on ?? "").slice(8, 10))).filter((day) => day > 0));
  const grid = monthGrid(shown.year, shown.month, thisMonth ? local.day : null, marked);
  const rbar: RbarData = {
    ...grid,
    days: grid.days.map((cell) => ({ ...cell, href: calendarDayHref(shown.year, shown.month, cell.day) })),
    nav: monthNav(view.path ?? "/sheet", shown.year, shown.month),
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
      href: notificationHref(row.action, activityMatter(row)),
    })),
    vo: null,
  };

  return { chrome, rbar, home, missingPolicies: missingPolicies(await policies) };
}
