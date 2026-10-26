import "server-only";
import type { QueueData, QueueLoad } from "@/components/sheet/designer/queue";
import type { SidebarPerson } from "@/components/sheet/designer/sidebar";
import { createClient } from "@/lib/supabase/server";
import { staffPerson } from "@/modules/sheet/avatar";
import { loadSheetChrome, matterNames, memberNames } from "@/modules/sheet/chrome-load";
import { isoDate, localNow } from "@/modules/sheet/home-present";
import type { SheetStaff } from "@/modules/sheet/load";
import { STAFF_ROLES, isoDateInTimeZone, plusDays, roleLabel } from "@/modules/sheet/present";
import { dueBadge, hours, orderQueue, queueItemId, ruleHours, waitingBadge, weekOf, type QueueEntry } from "@/modules/sheet/queue-present";
import { partialAlert } from "@/modules/sheet/states-present";

/** Who reassign_task lets reassign an internal task (it checks again). */
const REASSIGN_ROLES = new Set(["firm_owner", "licensed_consultant", "case_manager"]);

/** Rows read per source. */
const QUEUE_READ = 300;

/**
 * The Team queue for a firm, read as the signed-in staff member so RLS decides what is visible:
 * open internal tasks, uploads waiting for review, deadlines waiting for verification, and client
 * money waiting for a second person (only billing staff can read those). Nothing is invented: a
 * kind of work the firm doesn't record yet (leads, Vo drafts) simply isn't listed.
 */
export async function loadSheetQueue(staff: SheetStaff, now: Date = new Date()) {
  const supabase = await createClient({ organizationId: staff.organizationId });
  const org = staff.organizationId;
  const local = localNow(staff.timezone, now);
  const today = isoDate(local.year, local.month, local.day);
  const week = weekOf(today);

  const [chrome, members, staffRows, tasks, versions, deadlines, entries] = await Promise.all([
    loadSheetChrome(staff, "/sheet/queue"),
    memberNames(supabase, org),
    supabase.from("memberships").select("id, role").eq("organization_id", org).eq("status", "active").in("role", [...STAFF_ROLES]),
    supabase
      .from("tasks")
      .select("id, matter_id, title, owner_membership_id, due_on, version")
      .eq("organization_id", org)
      .eq("audience", "internal")
      .in("status", ["open", "blocked"])
      // Soonest (and overdue) first, so a capped read keeps the work that matters most.
      .order("due_on", { ascending: true, nullsFirst: false })
      .limit(QUEUE_READ),
    supabase
      .from("document_versions")
      .select("id, document_id, request_id, created_at")
      .eq("organization_id", org)
      .eq("review_state", "pending")
      .eq("upload_state", "clean")
      .is("superseded_at", null)
      .order("created_at", { ascending: true })
      .limit(QUEUE_READ),
    supabase
      .from("deadlines")
      .select("id, matter_id, label, due_on, due_at, timezone")
      .eq("organization_id", org)
      .eq("verification", "tentative")
      .in("kind", ["legal", "correspondence"])
      .order("due_on", { ascending: true, nullsFirst: false })
      .limit(QUEUE_READ),
    supabase
      .from("client_fund_entries")
      .select("id, matter_id, person_id, number, kind, status, amount_cents, created_at")
      .eq("organization_id", org)
      .in("status", ["pending_verification", "pending_approval"])
      .order("created_at", { ascending: true })
      .limit(QUEUE_READ),
  ]);

  // Documents: their owner (a person), purpose, the matter they are filed on, and any request's due date.
  const versionRows = versions.data ?? [];
  const documentIds = [...new Set(versionRows.map((row) => row.document_id))];
  const requestIds = [...new Set(versionRows.map((row) => row.request_id).filter((id): id is string => Boolean(id)))];
  const [documents, refs, requests] = await Promise.all([
    documentIds.length ? supabase.from("documents").select("id, person_id, purpose").eq("organization_id", org).in("id", documentIds) : null,
    documentIds.length ? supabase.from("document_matter_refs").select("document_id, matter_id").eq("organization_id", org).in("document_id", documentIds).is("removed_at", null) : null,
    requestIds.length ? supabase.from("document_requests").select("id, due_on, matter_id").eq("organization_id", org).in("id", requestIds) : null,
  ]);
  const documentById = new Map((documents?.data ?? []).map((row) => [row.id, row]));
  const matterOfDocument = new Map<string, string>();
  for (const row of refs?.data ?? []) if (!matterOfDocument.has(row.document_id)) matterOfDocument.set(row.document_id, row.matter_id);
  const requestById = new Map((requests?.data ?? []).map((row) => [row.id, row]));

  const entryRows = entries.data ?? [];
  const matterIds = [
    ...new Set(
      [
        ...(tasks.data ?? []).map((row) => row.matter_id),
        ...[...matterOfDocument.values()],
        ...(deadlines.data ?? []).map((row) => row.matter_id),
        ...entryRows.map((row) => row.matter_id),
      ].filter((id): id is string => Boolean(id)),
    ),
  ];
  const personIds = [
    ...new Set([...(documents?.data ?? []).map((row) => row.person_id), ...entryRows.map((row) => row.person_id)].filter((id): id is string => Boolean(id))),
  ];
  const [name, matters, people] = await Promise.all([
    matterNames(supabase, org, matterIds),
    matterIds.length ? supabase.from("matters").select("id, responsible_consultant_membership_id").eq("organization_id", org).in("id", matterIds) : null,
    personIds.length ? supabase.from("persons").select("id, display_name").eq("organization_id", org).in("id", personIds) : null,
  ]);
  const consultantOf = new Map((matters?.data ?? []).map((row) => [row.id, row.responsible_consultant_membership_id]));
  const personName = new Map((people?.data ?? []).map((row) => [row.id, row.display_name]));
  const owner = (membershipId: string | null | undefined): SidebarPerson | null => {
    const found = membershipId ? members.get(membershipId) : undefined;
    return found ? staffPerson(found) : null;
  };
  const entriesOut: QueueEntry[] = [];
  const add = (key: string, entry: Omit<QueueEntry, "id">) => entriesOut.push({ id: queueItemId(key), ...entry });
  const flags = (...list: (string | false)[]) => list.filter((flag): flag is string => Boolean(flag));

  for (const task of tasks.data ?? []) {
    const due = dueBadge(task.due_on, today);
    add(`task:${task.id}`, {
      title: task.title,
      who: name(task.matter_id),
      kind: "Task",
      owner: owner(task.owner_membership_id),
      due: { tone: due.tone, label: due.label },
      flags: flags(due.overdue && "overdue", !task.owner_membership_id && "unassigned"),
      href: task.matter_id ? `/sheet/matters/${task.matter_id}?tab=tasks` : "/sheet/tasks",
      mine: task.owner_membership_id === staff.membershipId,
      sortOn: task.due_on,
      task: { id: task.id, version: task.version },
    });
  }
  for (const version of versionRows) {
    const document = documentById.get(version.document_id);
    if (!document) continue;
    const request = version.request_id ? requestById.get(version.request_id) : undefined;
    const matterId = matterOfDocument.get(document.id) ?? request?.matter_id ?? null;
    const consultant = matterId ? consultantOf.get(matterId) : null;
    const due = request?.due_on ? dueBadge(request.due_on, today) : { ...waitingBadge(isoDateInTimeZone(new Date(version.created_at), staff.timezone), today), overdue: false };
    add(`review:${version.id}`, {
      title: `Review ${document.purpose}`,
      who: personName.get(document.person_id) ?? (matterId ? name(matterId) : "Client"),
      kind: "Review",
      owner: owner(consultant),
      due: { tone: due.tone, label: due.label },
      flags: flags(due.overdue && "overdue", !consultant && "unassigned"),
      href: matterId ? `/sheet/matters/${matterId}?tab=documents` : undefined,
      mine: Boolean(consultant && consultant === staff.membershipId),
      sortOn: request?.due_on ?? isoDateInTimeZone(new Date(version.created_at), staff.timezone),
    });
  }
  for (const deadline of deadlines.data ?? []) {
    const dueOn = deadline.due_on ?? (deadline.due_at ? isoDateInTimeZone(new Date(deadline.due_at), deadline.timezone || staff.timezone) : null);
    const due = dueBadge(dueOn, today);
    const consultant = consultantOf.get(deadline.matter_id);
    add(`deadline:${deadline.id}`, {
      title: `Verify deadline: ${deadline.label}`,
      who: name(deadline.matter_id),
      kind: "Government",
      owner: owner(consultant),
      due: { tone: due.tone, label: due.label },
      flags: flags(due.overdue && "overdue", !consultant && "unassigned", "government"),
      // The matter's Tasks and deadlines tab, where the deadline's Confirm control is.
      href: `/sheet/matters/${deadline.matter_id}?tab=tasks`,
      mine: Boolean(consultant && consultant === staff.membershipId),
      sortOn: dueOn,
    });
  }
  for (const entry of entryRows) {
    const since = isoDateInTimeZone(new Date(entry.created_at), staff.timezone);
    const waiting = waitingBadge(since, today);
    const deposit = entry.kind === "deposit";
    add(`money:${entry.id}`, {
      title: deposit ? `Verify deposit ${entry.number}` : `Approve ${entry.kind === "transfer" ? "earned-fee transfer" : entry.kind} ${entry.number} (2nd approver)`,
      who: personName.get(entry.person_id) ?? name(entry.matter_id),
      kind: "Money",
      owner: null,
      due: waiting,
      flags: flags(waiting.tone === "bad" && "overdue", "unassigned", "money"),
      href: "/sheet/finance?tab=funds",
      mine: false,
      sortOn: since,
    });
  }
  const items = orderQueue(entriesOut);

  // Load this week: consultations booked against each person's default working hours.
  const staffList = staffRows.data ?? [];
  const staffIds = staffList.map((row) => row.id);
  const [schedules, bookings] = await Promise.all([
    staffIds.length ? supabase.from("availability_schedules").select("id, membership_id").eq("organization_id", org).eq("is_default", true).in("membership_id", staffIds) : null,
    staffIds.length
      ? supabase
          .from("bookings")
          .select("host_membership_id, starts_at, ends_at")
          .eq("organization_id", org)
          .in("status", ["confirmed", "completed", "no_show"])
          // A day either side: the week is the firm's, and each booking is kept by its local date below.
          .gte("starts_at", `${plusDays(week.from, -1)}T00:00:00Z`)
          .lte("starts_at", `${plusDays(week.to, 1)}T23:59:59Z`)
          .in("host_membership_id", staffIds)
      : null,
  ]);
  const scheduleIds = (schedules?.data ?? []).map((row) => row.id);
  const rules = scheduleIds.length ? await supabase.from("availability_rules").select("schedule_id, start_local, end_local").eq("organization_id", org).in("schedule_id", scheduleIds) : null;
  const scheduleOf = new Map((schedules?.data ?? []).map((row) => [row.membership_id, row.id]));
  const available = new Map<string, number>();
  for (const rule of rules?.data ?? []) available.set(rule.schedule_id, (available.get(rule.schedule_id) ?? 0) + ruleHours(rule.start_local, rule.end_local));
  const booked = new Map<string, number>();
  for (const booking of bookings?.data ?? []) {
    const local = isoDateInTimeZone(new Date(booking.starts_at), staff.timezone);
    if (local < week.from || local > week.to) continue;
    const length = (Date.parse(booking.ends_at) - Date.parse(booking.starts_at)) / 3_600_000;
    booked.set(booking.host_membership_id, (booked.get(booking.host_membership_id) ?? 0) + Math.max(0, length));
  }
  const load: QueueLoad[] = staffList
    .map((row) => {
      const schedule = scheduleOf.get(row.id);
      return {
        person: staffPerson(members.get(row.id) || "Unassigned"),
        role: roleLabel(row.role),
        bookedHours: hours(booked.get(row.id) ?? 0),
        availableHours: hours(schedule ? (available.get(schedule) ?? 0) : 0),
      };
    })
    .sort((a, b) => a.person.name.localeCompare(b.person.name));

  const queue: QueueData = {
    // A failed read is said as such, not as "Nothing is waiting".
    failed: Boolean(tasks.error || versions.error || deadlines.error || entries.error),
    counts: { open: items.length, overdue: items.filter((item) => item.flags?.includes("overdue")).length, people: staffList.length },
    load,
    items,
    // Reassign (tasks only): reassign_task decides who may, with a recent step-up.
    reassign: REASSIGN_ROLES.has(staff.role)
      ? {
          organizationId: org,
          people: staffList
            .map((row) => ({ value: row.id, label: members.get(row.id) || "Staff member" }))
            .sort((a, b) => a.label.localeCompare(b.label)),
        }
      : null,
  };
  // DES-04: each list reads the soonest QUEUE_READ rows; say when one was capped (a failed read shows as failed above).
  const partial = partialAlert([
    { label: "Open tasks", count: (tasks.data ?? []).length, cap: QUEUE_READ, order: "soonest" },
    { label: "Documents to review", count: (versions.data ?? []).length, cap: QUEUE_READ, order: "oldest" },
    { label: "Deadlines to verify", count: (deadlines.data ?? []).length, cap: QUEUE_READ, order: "soonest" },
  ]);
  return { chrome, queue, partial };
}
