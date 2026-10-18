import "server-only";
import type { ClientTaskRow, DeadlineRow, InternalTaskRow, TasksData } from "@/components/sheet/designer/tasks";
import { createClient } from "@/lib/supabase/server";
import { staffPerson } from "@/modules/sheet/avatar";
import { loadSheetChrome, matterNames, memberNames } from "@/modules/sheet/chrome-load";
import { dayMonth, isoDate, localNow } from "@/modules/sheet/home-present";
import type { SheetStaff } from "@/modules/sheet/load";
import { clientOptions, dependsOnOptions, matterOptions, staffOptions } from "@/modules/sheet/new-task";
import { isoDateInTimeZone, plusDays, type SheetQuery } from "@/modules/sheet/present";
import {
  clientState,
  deadlineSource,
  deadlineState,
  deadlineTime,
  dependsOnLabel,
  dueLabel,
  firstName,
  internalState,
  isOverdue,
  priorityChip,
  reminderOffsets,
  TASKS_READ,
  tasksTab,
} from "@/modules/sheet/tasks-present";

type Client = Awaited<ReturnType<typeof createClient>>;

const OPEN_TASK = ["open", "blocked"] as const;
/** app.staff_roles(): who can own an internal task. */
const STAFF_ROLES = ["firm_owner", "licensed_consultant", "case_manager", "assistant", "finance_user"] as const;
/** Finished client tasks and past deadlines stay on the page this long. */
const RECENT_DAYS = 30;

/** Each matter's reference ("NL-2026-0142"), falling back to its applicant or title. */
async function matterLabels(supabase: Client, org: string, ids: (string | null)[]): Promise<(id: string | null) => string> {
  const matterIds = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  const [refs, name] = await Promise.all([
    matterIds.length ? supabase.from("matters").select("id, reference").eq("organization_id", org).in("id", matterIds) : null,
    matterNames(supabase, org, matterIds),
  ]);
  const reference = new Map((refs?.data ?? []).map((row) => [row.id, row.reference]));
  return (id) => (id ? reference.get(id) || name(id) : "—");
}

const matterHref = (id: string | null) => (id ? `/sheet/matters/${id}?tab=tasks` : undefined);

async function loadInternal(supabase: Client, staff: SheetStaff, today: string, now: Date): Promise<NonNullable<TasksData["internal"]>> {
  const org = staff.organizationId;
  const tasks = await supabase
    .from("tasks")
    .select("id, matter_id, title, priority, status, owner_membership_id, due_on, due_at, due_timezone, escalated_at")
    .eq("organization_id", org)
    .eq("audience", "internal")
    .in("status", [...OPEN_TASK])
    .order("due_on", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true })
    .limit(TASKS_READ);
  const rows = tasks.data ?? [];
  const ids = rows.map((row) => row.id);

  const deps = ids.length
    ? await supabase.from("task_dependencies").select("task_id, depends_on_task_id").eq("organization_id", org).in("task_id", ids)
    : null;
  const earlierIds = [...new Set((deps?.data ?? []).map((row) => row.depends_on_task_id))];
  const [earlier, matter, members] = await Promise.all([
    earlierIds.length ? supabase.from("tasks").select("id, title, status").eq("organization_id", org).in("id", earlierIds) : null,
    matterLabels(supabase, org, rows.map((row) => row.matter_id)),
    memberNames(supabase, org),
  ]);
  // A dependency the viewer cannot read is left out rather than named.
  const earlierTask = new Map((earlier?.data ?? []).map((row) => [row.id, row]));
  const dependsOn = new Map<string, { title: string; done: boolean }[]>();
  for (const dep of deps?.data ?? []) {
    const task = earlierTask.get(dep.depends_on_task_id);
    if (!task || task.status === "cancelled") continue;
    const list = dependsOn.get(dep.task_id) ?? [];
    list.push({ title: task.title, done: task.status === "done" });
    dependsOn.set(dep.task_id, list);
  }

  const table: InternalTaskRow[] = rows.map((row) => {
    const owner = row.owner_membership_id ? members.get(row.owner_membership_id) : undefined;
    const flags = [
      row.owner_membership_id === staff.membershipId ? "mine" : "",
      isOverdue(row.due_on, row.due_at, today, now) ? "overdue" : "",
      row.status === "blocked" ? "blocked" : "",
      row.priority === "high" || row.priority === "critical" ? "high" : "",
    ].filter(Boolean);
    return {
      href: matterHref(row.matter_id),
      flags,
      title: row.title,
      matter: matter(row.matter_id),
      owner: owner ? { person: staffPerson(owner), label: firstName(owner) } : null,
      due: dueLabel(row.due_on, row.due_at, row.due_timezone || staff.timezone, today),
      priority: priorityChip(row.priority),
      dependsOn: dependsOnLabel(dependsOn.get(row.id) ?? []),
      state: internalState(row.status, row.escalated_at),
    };
  });

  const escalated = rows
    .filter((row) => row.status === "open" && row.escalated_at)
    .sort((a, b) => (b.escalated_at ?? "").localeCompare(a.escalated_at ?? ""))[0];
  const ownerName = escalated?.owner_membership_id ? members.get(escalated.owner_membership_id) : undefined;
  const alert = escalated
    ? {
        title: escalated.title,
        detail: `Overdue ${escalated.priority === "critical" ? "critical " : ""}task${ownerName ? ` owned by ${ownerName}` : ""}, escalated ${dayMonth(isoDateInTimeZone(new Date(escalated.escalated_at ?? now), staff.timezone))}.`,
        href: matterHref(escalated.matter_id) ?? "/sheet/tasks",
      }
    : null;
  return { alert, rows: table };
}

async function loadClient(supabase: Client, staff: SheetStaff, today: string): Promise<NonNullable<TasksData["client"]>> {
  const org = staff.organizationId;
  const since = `${plusDays(today, -RECENT_DAYS)}T00:00:00Z`;
  const tasks = await supabase
    .from("tasks")
    .select("id, matter_id, title, status, owner_person_id, due_on, due_at, due_timezone, completed_at")
    .eq("organization_id", org)
    .eq("audience", "client")
    .or(`status.in.(open,blocked),and(status.eq.done,completed_at.gte.${since})`)
    .order("due_on", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true })
    .limit(TASKS_READ);
  const rows = tasks.data ?? [];
  const ids = rows.map((row) => row.id);
  const personIds = [...new Set(rows.map((row) => row.owner_person_id).filter((id): id is string => Boolean(id)))];
  const [people, reminders] = await Promise.all([
    personIds.length ? supabase.from("persons").select("id, display_name").eq("organization_id", org).in("id", personIds) : null,
    ids.length ? supabase.from("reminder_schedules").select("task_id, offset_days").eq("organization_id", org).in("task_id", ids).neq("status", "cancelled") : null,
  ]);
  const person = new Map((people?.data ?? []).map((row) => [row.id, row.display_name]));
  const offsets = new Map<string, (number | null)[]>();
  for (const row of reminders?.data ?? []) {
    if (!row.task_id) continue;
    offsets.set(row.task_id, [...(offsets.get(row.task_id) ?? []), row.offset_days]);
  }

  // Open work first, then what was finished recently.
  const ordered = [...rows.filter((row) => row.status !== "done"), ...rows.filter((row) => row.status === "done")];
  const table: ClientTaskRow[] = ordered.map((row) => {
    const days = reminderOffsets(offsets.get(row.id) ?? []);
    return {
      href: matterHref(row.matter_id),
      title: row.title,
      person: (row.owner_person_id && person.get(row.owner_person_id)) || "—",
      due:
        row.status === "done" && row.completed_at
          ? `Done ${dayMonth(isoDateInTimeZone(new Date(row.completed_at), staff.timezone))}`
          : { num: dueLabel(row.due_on, row.due_at, row.due_timezone || staff.timezone, today) },
      // Quiet hours are a firm setting the page cannot read yet, so they are not claimed.
      reminders: days.length ? { offsets: days, quietHours: false } : null,
      state: clientState(row.status),
    };
  });
  return { rows: table };
}

async function loadDeadlines(supabase: Client, staff: SheetStaff, today: string): Promise<NonNullable<TasksData["deadlines"]>> {
  const org = staff.organizationId;
  const sinceDay = plusDays(today, -RECENT_DAYS);
  const deadlines = await supabase
    .from("deadlines")
    .select("id, matter_id, label, due_on, due_at, timezone, source_url, source_retrieved_on, receipt_on, rule_version_id, verifying_membership_id, verification")
    .eq("organization_id", org)
    .or(`due_on.gte.${sinceDay},due_at.gte.${sinceDay}T00:00:00Z`)
    .order("due_on", { ascending: true, nullsFirst: false })
    .limit(TASKS_READ);
  const rows = deadlines.data ?? [];
  const [matter, members] = await Promise.all([matterLabels(supabase, org, rows.map((row) => row.matter_id)), memberNames(supabase, org)]);
  const when = (row: (typeof rows)[number]) => row.due_on ?? (row.due_at ? isoDateInTimeZone(new Date(row.due_at), staff.timezone) : "");
  const table: DeadlineRow[] = [...rows]
    .sort((a, b) => when(a).localeCompare(when(b)))
    .map((row) => ({
      href: `/sheet/matters/${row.matter_id}`,
      label: row.label,
      matter: matter(row.matter_id),
      source: deadlineSource({ sourceUrl: row.source_url, retrievedOn: row.source_retrieved_on, receiptOn: row.receipt_on, ruleVersion: Boolean(row.rule_version_id) }),
      local: deadlineTime({ dueOn: row.due_on, dueAt: row.due_at, timezone: row.timezone }, staff.timezone, today),
      verifiedBy:
        row.verification === "confirmed" && row.verifying_membership_id ? members.get(row.verifying_membership_id) || "A former member" : "—",
      state: deadlineState(row.verification),
    }));
  return { rows: table };
}

/** The Designer's Tasks page for a firm, read as the signed-in staff member so RLS decides what is visible. */
export async function loadSheetTasks(staff: SheetStaff, query: SheetQuery, now: Date = new Date()) {
  const supabase = await createClient({ organizationId: staff.organizationId });
  const org = staff.organizationId;
  const local = localNow(staff.timezone, now);
  const today = isoDate(local.year, local.month, local.day);
  const tab = tasksTab(query.tab);
  const count = { count: "exact" as const, head: true };

  const [chrome, open, escalated, dialog, internal, client, deadlines] = await Promise.all([
    loadSheetChrome(staff, "/sheet/tasks"),
    supabase.from("tasks").select("id", count).eq("organization_id", org).in("status", [...OPEN_TASK]),
    supabase.from("tasks").select("id", count).eq("organization_id", org).eq("status", "open").not("escalated_at", "is", null),
    loadNewTask(supabase, staff),
    tab === "internal" ? loadInternal(supabase, staff, today, now) : undefined,
    tab === "client" ? loadClient(supabase, staff, today) : undefined,
    tab === "deadlines" ? loadDeadlines(supabase, staff, today) : undefined,
  ]);

  const tasks: TasksData = {
    tab,
    counts: { open: open.count ?? 0, escalated: escalated.count ?? 0 },
    internal,
    client,
    deadlines,
    dialog,
  };
  return { chrome, tasks };
}

/** Matters offered in New task. RLS decides which a staff member can read; closed matters are left out. */
const NEW_TASK_MATTERS = 200;

/**
 * The New task dialog, read as the signed-in staff member: the matters they can read, the
 * firm's active staff (internal owners), each matter's people (client owners, sample matching
 * the matter, as create_task requires) and each matter's tasks (what a task can depend on).
 */
async function loadNewTask(supabase: Client, staff: SheetStaff): Promise<TasksData["dialog"]> {
  const org = staff.organizationId;
  const [matters, staffRows, members] = await Promise.all([
    supabase
      .from("matters")
      .select("id, reference, is_sample")
      .eq("organization_id", org)
      .neq("stage", "closed")
      .order("updated_at", { ascending: false })
      .limit(NEW_TASK_MATTERS),
    supabase.from("memberships").select("id").eq("organization_id", org).eq("status", "active").in("role", [...STAFF_ROLES]),
    memberNames(supabase, org),
  ]);
  const matterRows = matters.data ?? [];
  const ids = matterRows.map((row) => row.id);
  const [name, participants, earlier] = await Promise.all([
    matterNames(supabase, org, ids),
    ids.length
      ? supabase.from("matter_participants").select("matter_id, person_id").eq("organization_id", org).in("matter_id", ids).not("person_id", "is", null)
      : null,
    ids.length
      ? supabase
          .from("tasks")
          .select("id, title, matter_id")
          .eq("organization_id", org)
          .in("matter_id", ids)
          .neq("status", "cancelled")
          .order("created_at", { ascending: false })
          .limit(TASKS_READ)
      : null,
  ]);
  const personIds = [...new Set((participants?.data ?? []).map((row) => row.person_id).filter((id): id is string => Boolean(id)))];
  const people = personIds.length ? await supabase.from("persons").select("id, display_name, is_sample").eq("organization_id", org).in("id", personIds) : null;
  const person = new Map((people?.data ?? []).map((row) => [row.id, row]));
  const sample = new Map(matterRows.map((row) => [row.id, row.is_sample]));

  const staffOwners = staffOptions((staffRows.data ?? []).map((row) => ({ id: row.id, name: members.get(row.id) || "Unassigned" })));
  const clientOwners = clientOptions(
    (participants?.data ?? []).flatMap((row) => {
      const found = row.person_id ? person.get(row.person_id) : undefined;
      if (!found || found.is_sample !== sample.get(row.matter_id)) return [];
      return [{ matterId: row.matter_id, personId: found.id, name: found.display_name }];
    }),
  );
  return {
    owners: [...staffOwners, ...clientOwners],
    dependsOn: dependsOnOptions(earlier?.data ?? []),
    wire: {
      organizationId: org,
      timezone: staff.timezone,
      matters: matterOptions(matterRows, name),
      owner: staff.membershipId,
    },
  };
}
