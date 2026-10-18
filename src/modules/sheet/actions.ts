"use server";

import { clearMatterOnHold, overrideMatterStage, recordGovernmentStatus, recordMatterOutcome, setMatterOnHold } from "@/modules/matters/actions";

/**
 * The Designer matter page's dialogs. They send no authenticator code: the database
 * checks app.mfa_step_up_satisfied() on every one of these changes, and a refusal comes
 * back as the step-up message so the page can send the person to /mfa?step=6.
 */
type MatterRef = { organizationId: string; matterId: string; version: number };

export async function changeMatterStage(input: MatterRef & { toStage: string; reason: string }) {
  return overrideMatterStage({ organizationId: input.organizationId, matterId: input.matterId, toStage: input.toStage, expectedVersion: input.version, reason: input.reason, code: null });
}

export async function holdMatter(input: MatterRef & { reason: string; ownerMembershipId: string; reviewOn: string }) {
  return setMatterOnHold({
    organizationId: input.organizationId,
    matterId: input.matterId,
    expectedVersion: input.version,
    reason: input.reason,
    ownerMembershipId: input.ownerMembershipId,
    reviewOn: input.reviewOn,
    code: null,
  });
}

export async function resumeMatter(input: MatterRef) {
  return clearMatterOnHold({ organizationId: input.organizationId, matterId: input.matterId, expectedVersion: input.version, reason: "Resumed from the matter page", code: null });
}

export async function recordMatterLetter(input: MatterRef & { status: string; note: string }) {
  return recordGovernmentStatus({ organizationId: input.organizationId, matterId: input.matterId, status: input.status, expectedVersion: input.version, note: input.note, code: null });
}

export async function confirmMatterOutcome(input: MatterRef & { outcome: string; note: string }) {
  return recordMatterOutcome({ organizationId: input.organizationId, matterId: input.matterId, outcome: input.outcome, expectedVersion: input.version, note: input.note, code: null });
}
import { createTask, setTaskStatus } from "@/modules/tasks/actions";

function field(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function holdMatterFromSheet(form: FormData) {
  return setMatterOnHold({
    organizationId: field(form, "organizationId"),
    matterId: field(form, "matterId"),
    expectedVersion: Number(field(form, "version")),
    reason: field(form, "reason"),
    ownerMembershipId: field(form, "ownerMembershipId"),
    reviewOn: field(form, "reviewOn"),
    code: field(form, "code"),
  });
}

export async function stageMatterFromSheet(form: FormData) {
  return overrideMatterStage({
    organizationId: field(form, "organizationId"),
    matterId: field(form, "matterId"),
    toStage: field(form, "stage"),
    expectedVersion: Number(field(form, "version")),
    reason: field(form, "reason"),
    code: field(form, "code"),
  });
}

export async function governmentFromSheet(form: FormData) {
  return recordGovernmentStatus({
    organizationId: field(form, "organizationId"),
    matterId: field(form, "matterId"),
    status: field(form, "status"),
    expectedVersion: Number(field(form, "version")),
    note: field(form, "note"),
    code: field(form, "code"),
  });
}

export async function outcomeFromSheet(form: FormData) {
  return recordMatterOutcome({
    organizationId: field(form, "organizationId"),
    matterId: field(form, "matterId"),
    outcome: field(form, "outcome"),
    expectedVersion: Number(field(form, "version")),
    note: field(form, "note"),
    code: field(form, "code"),
  });
}

export async function taskFromSheet(form: FormData) {
  return createTask({
    organizationId: field(form, "organizationId"),
    matterId: field(form, "matterId"),
    audience: field(form, "audience") || "internal",
    title: field(form, "title"),
    ownerMembershipId: field(form, "ownerMembershipId") || null,
    dueOn: field(form, "dueOn") || null,
    priority: "normal",
  });
}

export async function completeTaskFromSheet(form: FormData) {
  return setTaskStatus({
    organizationId: field(form, "organizationId"),
    taskId: field(form, "taskId"),
    expectedVersion: Number(field(form, "version")),
    status: "done",
  });
}
