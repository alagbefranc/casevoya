"use server";

import { safeAccessError } from "@/lib/auth/step-up";
import { verifyTotpCode } from "@/lib/auth/verify-totp";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import { deadlineError } from "@/modules/sheet/new-deadline";
import { dependencyError, newTaskError, readNewTask } from "@/modules/sheet/new-task";
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
  const read = readNewTask({
    matter: input.matterId,
    title: input.title,
    kind: input.audience,
    owner: input.audience === "client" ? input.ownerPersonId : input.ownerMembershipId,
    due: input.dueOn,
    dependsOn: input.dependsOnTaskId,
  });
  if ("error" in read) return { error: read.error };
  const timezone = typeof input.timezone === "string" && /^[A-Za-z0-9_+/-]{1,64}$/.test(input.timezone) ? input.timezone : "America/Toronto";
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

export async function reassignTask(input: {
  organizationId: string;
  taskId: string;
  expectedVersion: number;
  ownerMembershipId?: string | null;
  ownerPersonId?: string | null;
  code: string;
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

export async function confirmDeadline(input: {
  organizationId: string;
  deadlineId: string;
  expectedVersion: number;
  code: string;
}) {
  if (!isUuid(input.deadlineId)) return { error: "Choose a deadline." };
  const session = await clientFor(input.organizationId, input.code);
  if ("error" in session) return { error: session.error };
  const { data, error } = await session.supabase.rpc("confirm_deadline", {
    p_deadline_id: input.deadlineId,
    p_expected_version: input.expectedVersion,
  });
  if (error) return { error: safeAccessError(error.message) };
  return { version: data };
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
