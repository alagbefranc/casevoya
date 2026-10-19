"use server";

import { safeAccessError } from "@/lib/auth/step-up";
import { verifyTotpCode } from "@/lib/auth/verify-totp";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import { todayIso } from "@/modules/sheet/birth-date";
import { deadlineError } from "@/modules/sheet/new-deadline";
import { dependencyError, newTaskError, readNewTask, readTaskEdit, taskChangeError } from "@/modules/sheet/new-task";
import type { Database, Json } from "@/types/database.types";

type Audience = Database["public"]["Enums"]["task_audience"];
type Priority = Database["public"]["Enums"]["task_priority"];
type TaskStatus = Database["public"]["Enums"]["task_status"];
type DeadlineKind = Database["public"]["Enums"]["deadline_kind"];

const AUDIENCES: readonly Audience[] = ["internal", "client"];
const PRIORITIES: readonly Priority[] = ["low", "normal", "high", "critical"];
const STATUSES: readonly TaskStatus[] = ["open", "blocked", "done", "cancelled"];
const KINDS: readonly DeadlineKind[] = ["legal", "correspondence", "internal"];

async function clientFor(organizationId: string, code: string | null) {
  if (!isUuid(organizationId)) return { error: "Choose a firm." as const };
  const supabase = await createClient({ organizationId });
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return { error: "Sign in first." as const };
  if (code != null) {
    const verified = await verifyTotpCode(supabase, code);
    if (!verified.ok) return { error: verified.error };
  }
  return { supabase };
}

export async function createTask(input: {
  organizationId: string;
  matterId: string;
  audience: string;
  title: string;
  ownerMembershipId?: string | null;
  ownerPersonId?: string | null;
  priority?: string;
  dueOn?: string | null;
  dueAt?: string | null;
  dueTimezone?: string;
  estimatedMinutes?: number | null;
  intakeFieldKey?: string | null;
  checklist?: Json;
}) {
  if (!isUuid(input.matterId) || !AUDIENCES.includes(input.audience as Audience)) {
    return { error: "Choose a matter and whether the task is internal or for the client." };
  }
  if (input.ownerMembershipId && !isUuid(input.ownerMembershipId)) return { error: "Choose a staff owner." };
  if (input.ownerPersonId && !isUuid(input.ownerPersonId)) return { error: "Choose the client." };
  const priority = input.priority ?? "normal";
  if (!PRIORITIES.includes(priority as Priority)) return { error: "Choose a priority." };
  const session = await clientFor(input.organizationId, null);
  if ("error" in session) return { error: session.error };
  const { data, error } = await session.supabase.rpc("create_task", {
    p_matter_id: input.matterId,
    p_audience: input.audience as Audience,
    p_title: input.title,
    p_owner_membership_id: input.ownerMembershipId ?? null,
    p_owner_person_id: input.ownerPersonId ?? null,
    p_priority: priority as Priority,
    p_due_on: input.dueOn ?? null,
    p_due_at: input.dueAt ?? null,
    p_due_timezone: input.dueTimezone ?? "America/Toronto",
    p_estimated_minutes: input.estimatedMinutes ?? null,
    p_intake_field_key: input.intakeFieldKey ?? null,
    p_checklist: input.checklist ?? [],
  });
  if (error) return { error: safeAccessError(error.message) };
  if (typeof data !== "string" || !isUuid(data)) return { error: "The task was not created." };
  return { id: data };
}

/**
 * The Sheet's "New task": a task on a matter the signed-in staff member can read, saved through
 * create_task (security invoker, so RLS, the staff role check and sample mode decide). When the
 * dialog names a task it depends on, add_task_dependency links them; the task stays saved if
 * that link is refused, and the result says so.
 */
export async function createSheetTask(input: {
  organizationId: string;
  timezone: string;
  matterId: string;
  audience: string;
  title: string;
  ownerMembershipId: string | null;
  ownerPersonId: string | null;
  dueOn: string | null;
  dependsOnTaskId: string | null;
}): Promise<{ id: string; dependency: string | null } | { error: string }> {
  const timezone = typeof input.timezone === "string" && /^[A-Za-z0-9_+/-]{1,64}$/.test(input.timezone) ? input.timezone : "America/Toronto";
  const read = readNewTask({
    matter: input.matterId,
    title: input.title,
    kind: input.audience,
    owner: input.audience === "client" ? input.ownerPersonId : input.ownerMembershipId,
    due: input.dueOn,
    dependsOn: input.dependsOnTaskId,
    // A due date in the past is refused: the firm's today, in its timezone.
    today: todayIso(new Date(), timezone),
  });
  if ("error" in read) return { error: read.error };
  const session = await clientFor(input.organizationId, null);
  if ("error" in session) return { error: session.error ?? "Sign in first." };
  const task = read.input;
  const { data, error } = await session.supabase.rpc("create_task", {
    p_matter_id: task.matterId,
    p_audience: task.audience,
    p_title: task.title,
    p_owner_membership_id: task.ownerMembershipId,
    p_owner_person_id: task.ownerPersonId,
    p_priority: "normal",
    p_due_on: task.dueOn,
    p_due_at: null,
    p_due_timezone: timezone,
    p_estimated_minutes: null,
    p_intake_field_key: null,
    p_checklist: [],
  });
  if (error) return { error: newTaskError(error.message) };
  if (typeof data !== "string" || !isUuid(data)) return { error: "The task was not created." };
  if (!task.dependsOnTaskId) return { id: data, dependency: null };
  const linked = await session.supabase.rpc("add_task_dependency", {
    p_task_id: data,
    p_depends_on_task_id: task.dependsOnTaskId,
  });
  return { id: data, dependency: linked.error ? dependencyError(linked.error.message) : null };
}

export async function setTaskStatus(input: {
  organizationId: string;
  taskId: string;
  expectedVersion: number;
  status: string;
  blockerNote?: string | null;
}) {
  if (!isUuid(input.taskId) || !STATUSES.includes(input.status as TaskStatus)) return { error: "Choose a task and a status." };
  const session = await clientFor(input.organizationId, null);
  if ("error" in session) return { error: session.error };
  const { data, error } = await session.supabase.rpc("set_task_status", {
    p_task_id: input.taskId,
    p_expected_version: input.expectedVersion,
    p_status: input.status as TaskStatus,
    p_blocker_note: input.blockerNote ?? null,
  });
  if (error) return { error: safeAccessError(error.message) };
  return { version: data };
}

/**
 * The Sheet's task controls (Tasks page rows and the matter's Tasks tab): mark a task done.
 * public.set_task_status decides (role, version, open dependencies) and cancels its pending reminders.
 */
export async function completeSheetTask(input: { organizationId: string; taskId: string; version: number }): Promise<{ version: number } | { error: string }> {
  if (!isUuid(input.taskId) || !Number.isInteger(input.version)) return { error: "Choose a task." };
  const session = await clientFor(input.organizationId, null);
  if ("error" in session) return { error: session.error ?? "Sign in first." };
  const { data, error } = await session.supabase.rpc("set_task_status", {
    p_task_id: input.taskId,
    p_expected_version: input.version,
    p_status: "done",
    p_blocker_note: null,
  });
  if (error) return { error: taskChangeError(error.message) };
  return { version: typeof data === "number" ? data : input.version };
}

/**
 * The Task dialog's Save: the title and due date (public.update_task) and, when another staff
 * member is chosen, the owner (public.reassign_task, which needs a recent step-up: the refusal
 * comes back as the step-up message). Each change is checked again by the database.
 */
export async function saveSheetTask(input: {
  organizationId: string;
  taskId: string;
  version: number;
  timezone: string;
  title: string;
  due: string;
  ownerMembershipId: string | null;
  currentOwnerMembershipId: string | null;
  currentDueOn: string | null;
}): Promise<{ version: number; reassigned: boolean } | { error: string }> {
  if (!isUuid(input.taskId) || !Number.isInteger(input.version)) return { error: "Choose a task." };
  const read = readTaskEdit({ title: input.title, due: input.due });
  if ("error" in read) return { error: read.error };
  const timezone = /^[A-Za-z0-9_+/-]{1,64}$/.test(input.timezone ?? "") ? input.timezone : "America/Toronto";
  if (read.dueOn && read.dueOn !== input.currentDueOn && read.dueOn < todayIso(new Date(), timezone)) {
    return { error: "The due date can’t be in the past." };
  }
  if (input.ownerMembershipId && !isUuid(input.ownerMembershipId)) return { error: "Choose a staff owner." };
  const session = await clientFor(input.organizationId, null);
  if ("error" in session) return { error: session.error ?? "Sign in first." };
  let version = input.version;
  // The owner first: it is the change that can need a step-up, so a refusal leaves nothing half saved.
  const reassign = Boolean(input.ownerMembershipId && input.ownerMembershipId !== input.currentOwnerMembershipId);
  if (reassign) {
    const moved = await session.supabase.rpc("reassign_task", {
      p_task_id: input.taskId,
      p_expected_version: version,
      p_owner_membership_id: input.ownerMembershipId,
      p_owner_person_id: null,
    });
    if (moved.error) {
      return { error: /step-up|aal2/i.test(moved.error.message) ? safeAccessError(moved.error.message) : taskChangeError(moved.error.message) };
    }
    version = typeof moved.data === "number" ? moved.data : version;
  }
  const updated = await session.supabase.rpc("update_task", {
    p_task_id: input.taskId,
    p_expected_version: version,
    p_title: read.title,
    p_due_on: read.dueOn,
    p_priority: null,
  });
  if (updated.error) {
    const copy = taskChangeError(updated.error.message);
    return { error: reassign ? `The new owner was saved, but not the other changes: ${copy}` : copy };
  }
  version = typeof updated.data === "number" ? updated.data : version;
  return { version, reassigned: reassign };
}

export async function reassignTask(input: {
  organizationId: string;
  taskId: string;
  expectedVersion: number;
  ownerMembershipId?: string | null;
  ownerPersonId?: string | null;
  /** Null relies on the session's recent step-up; the database checks app.mfa_step_up_satisfied() either way. */
  code: string | null;
}) {
  if (!isUuid(input.taskId)) return { error: "Choose a task." };
  const session = await clientFor(input.organizationId, input.code);
  if ("error" in session) return { error: session.error };
  const { data, error } = await session.supabase.rpc("reassign_task", {
    p_task_id: input.taskId,
    p_expected_version: input.expectedVersion,
    p_owner_membership_id: input.ownerMembershipId ?? null,
    p_owner_person_id: input.ownerPersonId ?? null,
  });
  if (error) return { error: safeAccessError(error.message) };
  return { version: data };
}

export async function addTaskDependency(input: {
  organizationId: string;
  taskId: string;
  dependsOnTaskId: string;
}) {
  if (!isUuid(input.taskId) || !isUuid(input.dependsOnTaskId)) return { error: "Choose both tasks." };
  const session = await clientFor(input.organizationId, null);
  if ("error" in session) return { error: session.error };
  const { data, error } = await session.supabase.rpc("add_task_dependency", {
    p_task_id: input.taskId,
    p_depends_on_task_id: input.dependsOnTaskId,
  });
  if (error) return { error: safeAccessError(error.message) };
  if (typeof data !== "string" || !isUuid(data)) return { error: "The dependency was not added." };
  return { id: data };
}

export async function addTaskWatcher(input: { organizationId: string; taskId: string; membershipId: string }) {
  if (!isUuid(input.taskId) || !isUuid(input.membershipId)) return { error: "Choose a task and a staff member." };
  const session = await clientFor(input.organizationId, null);
  if ("error" in session) return { error: session.error };
  const { data, error } = await session.supabase.rpc("add_task_watcher", {
    p_task_id: input.taskId,
    p_membership_id: input.membershipId,
  });
  if (error) return { error: safeAccessError(error.message) };
  if (typeof data !== "string" || !isUuid(data)) return { error: "The watcher was not added." };
  return { id: data };
}

export async function recordDeadline(input: {
  organizationId: string;
  matterId: string;
  taskId?: string | null;
  kind: string;
  label: string;
  eventOn?: string | null;
  receiptOn?: string | null;
  dueOn?: string | null;
  dueAt?: string | null;
  timezone?: string;
  sourceUrl?: string | null;
  sourceRetrievedOn?: string | null;
  ruleVersionId?: string | null;
  calculationNote?: string | null;
  evidenceLocator?: string | null;
}) {
  if (!isUuid(input.matterId) || !KINDS.includes(input.kind as DeadlineKind)) {
    return { error: "Choose a matter and a deadline kind." };
  }
  if (input.taskId && !isUuid(input.taskId)) return { error: "Choose a task." };
  if (input.ruleVersionId && !isUuid(input.ruleVersionId)) return { error: "Choose a published rule version." };
  const session = await clientFor(input.organizationId, null);
  if ("error" in session) return { error: session.error };
  const { data, error } = await session.supabase.rpc("record_deadline", {
    p_matter_id: input.matterId,
    p_task_id: input.taskId ?? null,
    p_kind: input.kind as DeadlineKind,
    p_label: input.label,
    p_event_on: input.eventOn ?? null,
    p_receipt_on: input.receiptOn ?? null,
    p_due_on: input.dueOn ?? null,
    p_due_at: input.dueAt ?? null,
    p_timezone: input.timezone ?? "America/Toronto",
    p_source_url: input.sourceUrl ?? null,
    p_source_retrieved_on: input.sourceRetrievedOn ?? null,
    p_rule_version_id: input.ruleVersionId ?? null,
    p_calculation_note: input.calculationNote ?? null,
    p_evidence_locator: input.evidenceLocator ?? null,
  });
  if (error) return { error: deadlineError(error.message) };
  if (typeof data !== "string" || !isUuid(data)) return { error: "The deadline was not recorded." };
  return { id: data };
}

/**
 * Confirms a tentative deadline (public.confirm_deadline): a legal or letter date needs a licensed
 * member (an owner counts, decision 2026-10-19), an official source or published rule, and a
 * recent step-up; an internal target needs staff and a step-up. With `code` null the session's
 * recent step-up is relied on, and a refusal comes back as the step-up message.
 */
export async function confirmDeadline(input: {
  organizationId: string;
  deadlineId: string;
  expectedVersion: number;
  code: string | null;
}) {
  if (!isUuid(input.deadlineId) || !Number.isInteger(input.expectedVersion)) return { error: "Choose a deadline." };
  const session = await clientFor(input.organizationId, input.code);
  if ("error" in session) return { error: session.error ?? "Sign in first." };
  const { data, error } = await session.supabase.rpc("confirm_deadline", {
    p_deadline_id: input.deadlineId,
    p_expected_version: input.expectedVersion,
  });
  if (error) return { error: confirmDeadlineError(error.message) };
  return { version: data };
}

/** User-facing copy for a refused confirmation. Never passes a database message through. */
function confirmDeadlineError(message: string): string {
  if (/stays tentative without an official source/i.test(message)) {
    return "A legal or letter deadline stays tentative until it cites its official source or a published rule.";
  }
  if (/allowlisted official url|published rule version/i.test(message)) return "Its source isn’t an accepted official page, so it can’t be confirmed.";
  if (/licence blocks/i.test(message)) return "Your licence status blocks this consultant action.";
  if (/version conflict/i.test(message)) return "Someone changed this deadline since you opened it. Reload and try again.";
  if (/staff access denied|confirmation denied/i.test(message)) {
    return "Your role can’t confirm this deadline. A licensed consultant or the firm owner confirms legal and letter deadlines.";
  }
  return safeAccessError(message);
}

export async function scheduleDeadlineReminders(input: {
  organizationId: string;
  deadlineId: string;
  asOf: string;
}) {
  if (!isUuid(input.deadlineId)) return { error: "Choose a deadline." };
  const session = await clientFor(input.organizationId, null);
  if ("error" in session) return { error: session.error };
  const { data, error } = await session.supabase.rpc("schedule_deadline_reminders", {
    p_deadline_id: input.deadlineId,
    p_as_of: input.asOf,
  });
  if (error) return { error: safeAccessError(error.message) };
  return { scheduled: data };
}

export async function reviseDeadlineDue(input: {
  organizationId: string;
  deadlineId: string;
  expectedVersion: number;
  dueOn?: string | null;
  dueAt?: string | null;
  timezone: string;
  code: string;
}) {
  if (!isUuid(input.deadlineId)) return { error: "Choose a deadline." };
  const session = await clientFor(input.organizationId, input.code);
  if ("error" in session) return { error: session.error };
  const { data, error } = await session.supabase.rpc("revise_deadline_due", {
    p_deadline_id: input.deadlineId,
    p_expected_version: input.expectedVersion,
    p_due_on: input.dueOn ?? null,
    p_due_at: input.dueAt ?? null,
    p_timezone: input.timezone,
  });
  if (error) return { error: safeAccessError(error.message) };
  return { version: data };
}

export async function escalateOverdueWork(input: { organizationId: string; asOf: string }) {
  const session = await clientFor(input.organizationId, null);
  if ("error" in session) return { error: session.error };
  const { data, error } = await session.supabase.rpc("escalate_overdue_work", { p_as_of: input.asOf });
  if (error) return { error: safeAccessError(error.message) };
  return { count: data };
}

export async function setQuietHours(input: {
  organizationId: string;
  start: string | null;
  end: string | null;
  /** Null when the session already holds a recent step-up (Settings > Notifications). */
  code: string | null;
}) {
  const session = await clientFor(input.organizationId, input.code);
  if ("error" in session) return { error: session.error };
  const { error } = await session.supabase.rpc("set_quiet_hours", { p_start: input.start, p_end: input.end });
  if (error) return { error: safeAccessError(error.message) };
  return { ok: true as const };
}

export async function setFirmReminderOffsets(input: { organizationId: string; days: number[]; code: string }) {
  const session = await clientFor(input.organizationId, input.code);
  if ("error" in session) return { error: session.error };
  const { error } = await session.supabase.rpc("set_firm_reminder_offsets", { p_days: input.days });
  if (error) return { error: safeAccessError(error.message) };
  return { ok: true as const };
}

export async function openMajorityReviewTask(input: { organizationId: string; personId: string }) {
  if (!isUuid(input.personId)) return { error: "Choose a person." };
  const session = await clientFor(input.organizationId, null);
  if ("error" in session) return { error: session.error };
  const { data, error } = await session.supabase.rpc("open_majority_review_task", { p_person_id: input.personId });
  if (error) return { error: safeAccessError(error.message) };
  if (typeof data !== "string" || !isUuid(data)) return { error: "The majority review was not opened." };
  return { id: data };
}
