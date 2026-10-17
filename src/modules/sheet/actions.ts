"use server";

import { overrideMatterStage, recordGovernmentStatus, recordMatterOutcome, setMatterOnHold } from "@/modules/matters/actions";
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
